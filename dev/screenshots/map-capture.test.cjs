'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const {waitForMaps,installArchiveRelay,closeCaptureContext}=require('./map-capture.cjs');
const {prepareArchive,openArchiveCache}=require('./archive-cache.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
  const browser=await chromium.launch();
  let server;
  try{
    const context=await browser.newContext(),page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
    await page.setContent('<style>.leaflet-container{width:300px;height:120px}</style><div id="one"></div><div id="two"></div>');
    await page.addStyleTag({path:path.resolve('app/static/vendor/leaflet.css')});
    await page.addScriptTag({path:path.resolve('app/static/vendor/leaflet.js')});
    await page.evaluate(()=>{
      window.release=[];
      for(const id of ['one','two']){
        const layer=L.gridLayer();
        layer.createTile=(coords,done)=>{
          const tile=document.createElement('canvas');tile.width=tile.height=256;
          const finish=()=>{tile.getContext('2d').fillRect(0,0,256,256);done(null,tile);};
          if(id==='two')release.push(finish);else setTimeout(finish,0);
          return tile;
        };
        layer.addTo(L.map(id,{zoomControl:false,attributionControl:false}).setView([0,0],0));
      }
    });
    // The second map completes AFTER the first map advances the frozen fade clock.
    // A once-per-page advancement strands its tiles at opacity zero.
    const fixed=page.clock.setFixedTime.bind(page.clock);let advances=0;
    page.clock.setFixedTime=async instant=>{
      await fixed(instant);
      if(++advances===1)await page.evaluate(()=>release.splice(0).forEach(finish=>finish()));
    };
    await waitForMaps(page,{advanceMapFade:true,requireMap:true});
    assert.equal(advances,2,'each asynchronously completed map receives its own fade advancement');
    assert(await page.locator('.leaflet-tile').evaluateAll(tiles=>tiles.length>1&&tiles.every(tile=>tile.classList.contains('leaflet-tile-loaded')&&+getComputedStyle(tile).opacity>=.999)));
    await page.locator('#two').evaluate(el=>el.insertAdjacentHTML('beforeend','<div class="map-unavailable">Unavailable</div>'));
    await assert.rejects(waitForMaps(page,{advanceMapFade:true,requireMap:true}),/Visible basemap unavailable/);
    await page.setContent('<p>No maps</p>');
    await assert.rejects(waitForMaps(page,{requireMap:true}),/did not appear/);
    await closeCaptureContext(context);

    const received=deferred(),release=deferred(),logs=[],errors=[];
    server=http.createServer(async(req,res)=>{
      assert.equal(req.headers.range,'bytes=0-126');
      assert.equal(req.headers.origin,'https://login.example.test');
      received.resolve();await release.promise;
      res.writeHead(206,{'Content-Range':'bytes 0-126/1000','Content-Type':'application/octet-stream'});res.end(Buffer.alloc(127));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    const relayContext=await browser.newContext();
    await installArchiveRelay(relayContext,{archiveOrigin:origin,publishedOrigin:'https://login.example.test',browserOrigin:'http://capture.example.test',log:line=>logs.push(JSON.parse(line)),onError:error=>errors.push(error)});
    const relayPage=await relayContext.newPage();
    await relayPage.route('http://capture.example.test/**',route=>route.fulfill({body:'<!doctype html><p>Fictional capture</p>',contentType:'text/html'}));
    await relayPage.goto('http://capture.example.test/');
    await relayPage.evaluate(url=>{window.rangeRead=fetch(url,{headers:{Range:'bytes=0-126'}}).then(r=>r.arrayBuffer()).then(b=>b.byteLength).catch(()=>0);},origin+'/archive.pmtiles');
    await received.promise;
    const order=[];
    const unroute=relayContext.unrouteAll.bind(relayContext);
    relayContext.unrouteAll=async options=>{assert.equal(logs.length,1,'Range response finishes before route removal');order.push('unroute');return unroute(options);};
    const closing=closeCaptureContext(relayContext).then(()=>order.push('closed'));
    // Let cleanup enter its drain, then release the actual held-open HTTP response.
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,[]);
    release.resolve();await closing;
    assert.deepEqual(order,['unroute','closed']);assert.deepEqual(errors,[]);
    assert.equal(logs[0].status,206);assert.equal(logs[0].contentRange,'bytes 0-126/1000');assert.equal(logs[0].mapRange,'bytes=0-126');assert(Number.isFinite(logs[0].elapsedMs));
    assert.equal(logs[0].attempt,1);
    const cacheRoot=fs.mkdtempSync(path.join(os.tmpdir(),'kinetta-capture-relay-'));
    try{
      const cacheURL='https://archive.example.test/fixture.pmtiles',cacheDir=path.join(cacheRoot,'ranges');
      await prepareArchive(cacheDir,{approvedURL:cacheURL,plan:{url:cacheURL,ranges:['bytes=0-3']},log:()=>{},
        fetcher:async()=>new Response(Buffer.from([1,2,3,4]),{status:206,headers:{etag:'"fixture"','content-range':'bytes 0-3/100','content-type':'application/octet-stream'}})});
      const cachedContext=await browser.newContext(),cachedErrors=[],cacheLogs=[];
      await installArchiveRelay(cachedContext,{archiveOrigin:new URL(cacheURL).origin,publishedOrigin:'https://login.example.test',browserOrigin:'http://capture.example.test',
        cache:openArchiveCache(cacheDir,cacheURL,line=>cacheLogs.push(JSON.parse(line))),onError:error=>cachedErrors.push(error)});
      const cachedPage=await cachedContext.newPage();
      await cachedPage.route('http://capture.example.test/**',route=>route.fulfill({body:'<!doctype html><p>Fictional cached capture</p>',contentType:'text/html'}));
      await cachedPage.goto('http://capture.example.test/');
      const result=await cachedPage.evaluate(async url=>{const r=await fetch(url,{headers:{Range:'bytes=0-3'}});return {status:r.status,range:r.headers.get('content-range'),etag:r.headers.get('etag'),bytes:[...new Uint8Array(await r.arrayBuffer())]};},cacheURL);
      assert.deepEqual(result,{status:206,range:'bytes 0-3/100',etag:'"fixture"',bytes:[1,2,3,4]});
      assert.deepEqual(cachedErrors,[]);assert.equal(cacheLogs.filter(row=>row.mapCache==='hit').length,1);
      await closeCaptureContext(cachedContext);
    }finally{fs.rmSync(cacheRoot,{recursive:true,force:true});}
    const workflow=fs.readFileSync('.github/workflows/screenshots.yml','utf8');
    assert.equal(workflow.split("contains(github.event.pull_request.labels.*.name, 'homepage-capture')").length-1,2);
    assert.equal(workflow.split('github.event.pull_request.head.repo.full_name == github.repository').length-1,2);
    assert(workflow.includes("if: github.event_name != 'pull_request'\n        env:\n          PUBLISH_BRANCH:"),'PR capture never commits generated assets');
    assert(workflow.includes('node dev/screenshots/archive-cache.cjs "$RUNNER_TEMP/homepage-map-ranges"'));
    console.log('Map capture: delayed real Leaflet fades, unavailable/required assertions, held Range drain, validated cached bytes/CORS, status/timing logs and same-repo Draft opt-in PASS');
  }finally{
    await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
