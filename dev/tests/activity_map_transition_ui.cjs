// Fictional Home card -> Activity detail shared-map transition. No real account or provider data.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const fixtureInstant=new Date(require('../screenshots/fixture-time.json').instant);
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_EVIDENCE||path.join('/tmp','kinetta-map-transition');
const pw='green teapot on the hill';
const mapLines=new Map();
const tile='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#edf1ec"/><path d="M-20 34H276M-20 116H276M-20 218H276M38 -20V276M142 -20V276M232 -20V276" stroke="#cbd4db" stroke-width="2"/><path d="M-20 188C38 162 76 184 112 143S189 84 276 103" fill="none" stroke="#a7cbdc" stroke-width="12"/></svg>';
async function until(page,fn,label){for(let i=0;i<180;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}const state=await page.evaluate(()=>({path:location.pathname,pending:App.activityMapTransition,ready:App.pageReady,me:App.me?.login,page:document.querySelector('#page')?.innerText.slice(0,300),detail:document.querySelector('#d-map')?.style.viewTransitionName,styles:[...document.querySelectorAll('[style]')].map(n=>n.style.viewTransitionName).filter(Boolean)})).catch(()=>null);throw Error(`${label} ${JSON.stringify(state)}`);}
(async()=>{
  cp.execFileSync('python3',[path.join(__dirname,'activity_fixture.py')],{env:process.env,stdio:'inherit'});
  const project=process.env.KINETTA_PROJECT;assert(project,'disposable fixture project is required');
  const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC',reducedMotion:'no-preference'});
  const errors=[],writes=[];
  await context.addInitScript(()=>{
    globalThis.__KINETTA_SCREENSHOT_MODE__=true;
    const native=document.startViewTransition?.bind(document);
    if(native)document.startViewTransition=update=>native(()=>{
      const names=()=>[...document.querySelectorAll('.fmap,#d-map,#s-map,.map-head .map.lead')].map(node=>node.style.viewTransitionName).filter(Boolean);
      (window.__mapTransitionRecords??=[]).push({phase:'before-update',names:names()});
      const result=update();
      (window.__mapTransitionRecords??=[]).push({phase:'after-update',names:names()});
      return result;
    });
  });
  const page=await context.newPage();await page.clock.setFixedTime(fixtureInstant);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/mock-map/{z}/{x}/{y}.svg',dark_url:base+'/mock-map/{z}/{x}/{y}.svg',max_zoom:18,attribution:'Fictional map tiles'}});
    if(url.pathname.startsWith('/mock-map/'))return route.fulfill({status:200,contentType:'image/svg+xml',body:tile});
    if(request.method()==='GET'&&url.pathname==='/api/activities'&&url.searchParams.has('limit')){
      const response=await route.fetch(),data=await response.json(),rows=Array.isArray(data)?data:(data.rows||[]);
      for(const row of rows)if(row.line)mapLines.set(String(row.id),row.line);
      return route.fulfill({response,json:data});
    }
    if(request.method()==='GET'&&/^\/api\/activities\/\d+$/.test(url.pathname)){
      const response=await route.fetch(),data=await response.json(),line=mapLines.get(String(data.id));
      if(line){data.line=line;data.track_lines=[line];}
      return route.fulfill({response,json:data});
    }
    if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);if(/\/api\/activities\/\d+\/reaction$/.test(url.pathname))return route.continue();return route.fulfill({json:{}});}
    return route.continue();
  });
  assert.equal((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_feed_typical',password:pw}})).status(),200);
  await page.goto(base+'/activity');try{await until(page,()=>App.pageReady&&!!document.querySelector('#ff-list .activity-card[data-href^="/activity/"]'),'Home feed ready');}catch(error){throw Error(`${error.message}; errors=${JSON.stringify(errors)}`);}
  const card=page.locator('#ff-list .activity-card').filter({hasText:'Fictional short route'}).filter({has:page.locator('.fmap')}).first();await card.waitFor();
  const id=await card.getAttribute('data-href').then(href=>href.split('/').pop());
  assert.match(await card.getAttribute('data-href'),/^\/activity\/\d+$/,'the morph uses the owner activity detail');
  const mapLine=await card.locator('.fmap').getAttribute('data-line');assert(mapLine,'the feed has a fictional polyline');
  await page.evaluate(()=>[...document.querySelectorAll('.fmap')].every(node=>!node.style.viewTransitionName));
  fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'map-morph-start-390.png'),animations:'disabled'});
  const title=card.locator('.post-title-link');await title.scrollIntoViewIfNeeded();const box=await title.boundingBox();assert(box,'activity title is visible');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(30);assert.equal(await card.locator('.fmap').evaluate(node=>node.style.viewTransitionName),'','name is not assigned before the tap transition');await page.mouse.up();
  await page.screenshot({path:path.join(out,'map-morph-mid-390.png'),animations:'allow'});
  await until(page,()=>App.pageReady&&!!document.querySelector('.activity-detail'),'Activity detail ready');await until(page,()=>App.activityMapTransition===null&&document.querySelector('#d-map')?.style.viewTransitionName==='','map transition finished');assert.equal(await page.locator('#d-map').getAttribute('data-line'),mapLine,'detail uses the exact same fictional polyline as the card');await page.screenshot({path:path.join(out,'map-morph-end-390.png'),animations:'disabled'});
  const records=await page.evaluate(()=>window.__mapTransitionRecords||[]);assert(records.some(record=>record.phase==='before-update'&&record.names.includes(`map-${id}`)),`the tapped card is the only old shared map name: ${JSON.stringify(records)}`);assert(records.some(record=>record.phase==='after-update'&&record.names.includes(`map-${id}`)),`the destination map receives the matching name during the update: ${JSON.stringify(records)}`);assert.equal(await page.locator('#d-map').evaluate(node=>node.style.viewTransitionName),'','the destination name is cleared after the transition');assert.deepEqual(errors,[],'View Transition path has no browser errors');assert.deepEqual(writes.filter(path=>!['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(path)&&!/\/api\/activities\/\d+\/reaction$/.test(path)),[],'transition proof is read-only');
  await page.goBack();await until(page,()=>App.pageReady&&!!document.querySelector('#ff-list'),'back map morph returns to Home');await until(page,()=>App.activityMapTransition===null,'back map transition finished');const backRecords=await page.evaluate(()=>window.__mapTransitionRecords||[]);assert(backRecords.some(record=>record.phase==='before-update'&&record.names.includes(`map-${id}`))&&backRecords.some(record=>record.phase==='after-update'&&record.names.includes(`map-${id}`)),'back navigation assigns the same unique name to the detail map and returning feed card');assert.equal(await page.locator(`#ff-list .activity-card[data-href="/activity/${id}"] .fmap`).evaluate(node=>node.style.viewTransitionName),'','the returning feed card name is cleared');
  const videoDir=process.env.KINETTA_VIDEO_DIR||path.join(out,'video'),videoPath=process.env.KINETTA_VIDEO_PATH||path.join(out,'map-morph-forward-back-390-light.webm');fs.mkdirSync(videoDir,{recursive:true});
  const videoContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC',reducedMotion:'no-preference',recordVideo:{dir:videoDir,size:{width:390,height:844}}});
  await videoContext.addInitScript(()=>{globalThis.__KINETTA_SCREENSHOT_MODE__=true;});
  const videoLines=new Map();await videoContext.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/mock-map/{z}/{x}/{y}.svg',dark_url:base+'/mock-map/{z}/{x}/{y}.svg',max_zoom:18,attribution:'Fictional map tiles'}});if(url.pathname.startsWith('/mock-map/'))return route.fulfill({status:200,contentType:'image/svg+xml',body:tile});if(request.method()==='GET'&&url.pathname==='/api/activities'&&url.searchParams.has('limit')){const response=await route.fetch(),data=await response.json(),rows=Array.isArray(data)?data:(data.rows||[]);for(const row of rows)if(row.line)videoLines.set(String(row.id),row.line);return route.fulfill({response,json:data});}if(request.method()==='GET'&&/^\/api\/activities\/\d+$/.test(url.pathname)){const response=await route.fetch(),data=await response.json(),line=videoLines.get(String(data.id));if(line){data.line=line;data.track_lines=[line];}return route.fulfill({response,json:data});}if(!['GET','HEAD'].includes(request.method())){if(/\/api\/activities\/\d+\/reaction$/.test(url.pathname))return route.continue();return route.fulfill({json:{}});}return route.continue();});
  const videoPage=await videoContext.newPage();await videoPage.clock.setFixedTime(fixtureInstant);await videoContext.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_feed_typical',password:pw}});await videoPage.goto(base+'/activity');await until(videoPage,()=>App.pageReady&&!!document.querySelector('#ff-list .activity-card'),'video Home feed ready');await videoPage.waitForTimeout(160);
  const videoCard=videoPage.locator('#ff-list .activity-card').filter({hasText:'Fictional short route'}).filter({has:videoPage.locator('.fmap')}).first();await videoCard.locator('.post-title-link').click();await until(videoPage,()=>App.pageReady&&!!document.querySelector('.activity-detail'),'video forward morph complete');await videoPage.waitForTimeout(240);await videoPage.goBack();await until(videoPage,()=>App.pageReady&&!!document.querySelector('#ff-list .activity-card'),'video reverse morph complete');await videoPage.waitForTimeout(240);
  const video=videoPage.video();await videoContext.close();const recordedPath=await video.path();fs.copyFileSync(recordedPath,videoPath);const videoStat=fs.statSync(videoPath);assert(videoStat.size<5*1024*1024,`forward/back video stays under 5 MB: ${videoStat.size}`);
  await page.evaluate(()=>{document.startViewTransition=undefined;});const fallbackCard=page.locator(`#ff-list .activity-card[data-href="/activity/${id}"]`);await fallbackCard.locator('.post-title-link').click();await until(page,()=>App.pageReady&&!!document.querySelector('.activity-detail'),'plain fallback detail ready');assert.equal(await page.evaluate(()=>App.activityMapTransition),null,'unsupported browsers use plain swap and leave no pending transition name');
  console.log(`Activity map View Transition 390px: forward/back video ${videoPath} (${videoStat.size} bytes), matched polyline, tapped-only name and plain fallback PASS`);
  await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}}).catch(()=>{});
  await context.close();await browser.close();
})().catch(async error=>{console.error(error);process.exitCode=1;});
