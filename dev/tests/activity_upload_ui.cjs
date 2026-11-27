// Fictional server stand-ins: no archive, workout or provider writes reach the server.
'use strict';
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),chunk=8388608,bytes=Buffer.alloc(chunk*2+137,57),digest=hash(bytes);
const recording={name:'fictional-run.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from('<gpx/>')},archive={name:'fictional-history.zip',mimeType:'application/zip',buffer:bytes};
async function observed(request){let timer;try{await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected upload request was not received within 15s')),15000);})]);}finally{clearTimeout(timer);}}
(async()=>{
  cp.execFileSync('python3',['dev/tests/track_fixture.py'],{stdio:'inherit',env:process.env});
  if(out)fs.mkdirSync(out,{recursive:true});
  const browser=await(process.env.KINETTA_BROWSER==='webkit'?webkit:chromium).launch();
  try{
    for(const width of [390,1280])for(const theme of ['light','dark']){
      const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block'});
      try{
        assert.equal((await c.request.post(base+'/api/login',{data:{login:'zz_test_track_empty',password:'green teapot on the hill'}})).status(),200);
        let upload=null,audience='friends',legacy=0,confirms=0,finalizes=0,lost=true,failPoll=false,hold=false,holdPoll=false,releasePoll,pollEntered,holdReserve=false,releaseReserve,reserveEntered,rejectConfirm=true,pieces=[],calls=[],account=(await(await c.request.get(base+'/api/me')).json()).id;
        const newUpload=(body)=>({id:body.id,state:'uploading',size:body.size,received:0,sha256:body.sha256,expires:new Date(Date.now()+86400000).toISOString(),preview:null,result:null,error_code:null});
        await c.route('**/*',async route=>{
          const req=route.request(),u=new URL(req.url()),path=u.pathname,method=req.method();
          if(u.origin!==base)return route.abort();
          if(path.startsWith('/api/strava-import')){
            calls.push(method+' '+path);assert.equal(req.headers()['x-kinetta-account'],String(account));
            if(path.endsWith('/stage'))return route.fulfill({json:{upload,current_audience:audience,chunk_size:chunk,max_size:2147483648}});
            if(method==='POST'&&path.endsWith('/uploads')){const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['id','sha256','size']);assert.equal(body.sha256,digest);if(holdReserve)await new Promise(resolve=>{releaseReserve=resolve;reserveEntered();});upload=newUpload(body);return route.fulfill({json:upload});}
            if(method==='PUT'){
              const offset=Number(path.split('/').pop()),body=req.postDataBuffer();assert(body.length<=chunk);assert.equal(req.headers()['content-type'],'application/octet-stream');assert.equal(req.headers()['x-content-sha256'],hash(body));assert(body.equals(bytes.subarray(offset,offset+body.length)));pieces.push(offset);
              upload.received=offset+body.length;
              if(lost){lost=false;return route.abort('failed');}if(hold)await new Promise(resolve=>setTimeout(resolve,300));
              return route.fulfill({json:upload});
            }
            if(path.endsWith('/finalize')){finalizes++;upload.state='review';upload.preview={added:120,already_here:4,unreadable:1};return route.fulfill({json:upload});}
            if(path.endsWith('/confirm')){assert.deepEqual(req.postDataJSON(),{confirm:true,audience});if(rejectConfirm){rejectConfirm=false;audience='everyone';return route.fulfill({status:409,json:{detail:'Your activity privacy changed. Review it again before importing.'}});}confirms++;upload.state='importing';upload.result={added:40,already_here:1,unreadable:0};return route.fulfill({json:upload});}
            if(method==='DELETE'){upload=null;return route.fulfill({json:{ok:true}});}
            if(failPoll)return route.abort('failed');
            if(holdPoll)await new Promise(resolve=>{releasePoll=resolve;pollEntered();});
            return route.fulfill({json:upload});
          }
          if(path==='/api/import'){legacy++;assert.match(req.headers()['content-type'],/^multipart\/form-data/);assert(['fictional-run.gpx','fictional-run.fit','fictional-run.tcx'].some(name=>req.postDataBuffer().includes(Buffer.from(name))));return route.fulfill({json:{ok:true}});}
          if(path==='/api/imports')return route.fulfill({json:[]});
          if(path==='/api/challenges/signup/continue')return route.fulfill({json:{}});
          if(!['GET','HEAD'].includes(method))throw Error('Unexpected write '+method+' '+path);
          return route.continue();
        });
        const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/track/import');await page.locator('#u-file').waitFor({state:'attached'});await page.waitForFunction(()=>!document.querySelector('#u-file').disabled);
        account=await page.evaluate(()=>App.me.id);
        await page.locator('[data-upload="retry"]').count().then(async n=>{if(n)await page.locator('[data-upload="retry"]').click();});
        const shot=async name=>{if(out)await page.screenshot({path:`${out}/${name}-${width}-${theme}.png`});};
        await page.waitForFunction(()=>!document.querySelector('#u-file').disabled);await shot('after-empty');
        for(const extension of ['gpx','fit','tcx']){const sent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/import');await page.locator('#u-file').setInputFiles({...recording,name:'fictional-run.'+extension});await sent;await page.locator('#u-text').filter({hasText:'Uploaded.'}).waitFor();}assert.equal(legacy,3,'single GPX/FIT/TCX keep legacy upload');
        await page.locator('#u-file').setInputFiles(archive);
        await page.locator('[data-upload="resume"]').waitFor();await page.locator('.upload-error').waitFor();assert.equal(upload.received,chunk);assert.equal(confirms,0);assert.equal(finalizes,0);await shot('after-retry');
        // Reload requires the same file again; the committed first piece is not resent.
        await page.reload();await page.locator('[data-upload="resume"]').waitFor();assert.match(await page.locator('[data-upload="resume"]').innerText(),/Choose ZIP/);
        await page.locator('#u-file').setInputFiles({...archive,name:'different.zip',buffer:Buffer.from('different')});await page.locator('.upload-error').filter({hasText:'different ZIP'}).waitFor();assert.equal(pieces.length,1);
        await page.locator('#u-file').setInputFiles(archive);await page.locator('[data-upload="confirm"]').waitFor();assert.deepEqual(pieces,[0,chunk,chunk*2]);assert.equal(legacy,3,'ZIP never uses the one-request importer');assert.equal(confirms,0,'preview never confirms automatically');assert.equal(finalizes,1);await shot('after-review');
        // Another tab can replace the saved archive while this tab still displays A.
        const archiveA=upload.id,posts=calls.filter(call=>call.endsWith('/confirm')).length;
        upload={...upload,id:crypto.randomUUID(),sha256:hash(Buffer.from('another fictional archive')),preview:{added:72,already_here:4,unreadable:1}};
        const archiveB=upload.id;await page.locator('[data-upload="confirm"]').click();
        await page.locator('.upload-error').filter({hasText:'archive changed'}).waitFor();
        assert.equal(calls.filter(call=>call.endsWith('/confirm')).length,posts,'A preview cannot confirm B');
        assert.equal(await page.locator('.upload-counts dd').first().innerText(),'72','the replacement preview is displayed');
        // A setting change requires another explicit tap after showing the new audience.
        audience='me';await page.locator('[data-upload="confirm"]').click();await page.locator('.upload-error').filter({hasText:'privacy changed'}).waitFor();assert.equal(confirms,0);assert.match(await page.locator('.upload-privacy').innerText(),/Only me/);
        await page.locator('[data-upload="confirm"]').click();await page.locator('.upload-error').filter({hasText:'privacy changed'}).waitFor();assert.equal(confirms,0,'a server-side stale review needs another tap');assert.match(await page.locator('.upload-privacy').innerText(),/Everyone/);
        holdPoll=true;const importingPoll=new Promise(resolve=>{pollEntered=resolve;});
        await page.locator('[data-upload="confirm"]').click();await page.locator('.upload-status').filter({hasText:'Importing'}).waitFor();assert.equal(confirms,1);await shot('after-progress');
        assert(!calls.includes('POST /api/strava-import/uploads/'+archiveA+'/confirm'));
        await observed(importingPoll);await page.waitForFunction(()=>document.querySelector('#u-file').disabled);
        assert.equal(await page.locator('[data-upload="pause"]').count(),0,'no Pause during an importing status request');
        upload.state='done';upload.result={...upload.preview};holdPoll=false;releasePoll();await page.locator('.upload-status').filter({hasText:'Import complete'}).waitFor();
        assert(!calls.some(call=>call.includes('reminder')),'no email opt-in');
        // A delayed preview poll also keeps updating without a Pause/resume dead end.
        upload.state='preview_queued';holdPoll=true;const previewPoll=new Promise(resolve=>{pollEntered=resolve;});
        await page.reload();await observed(previewPoll);await page.waitForFunction(()=>document.querySelector('#u-file').disabled);
        assert.equal(await page.locator('[data-upload="pause"]').count(),0,'no Pause during a preview status request');
        upload.state='review';holdPoll=false;releasePoll();await page.locator('[data-upload="confirm"]').waitFor();
        // Restored job polling failures remain retryable, with no duplicate confirmation.
        upload.state='preview_queued';failPoll=true;await page.reload();await page.locator('.upload-error').waitFor();await page.locator('[data-upload="retry"]').click();failPoll=false;
        upload.state='review';await page.locator('[data-upload="confirm"]').waitFor();assert.equal(confirms,1);
        await page.locator('[data-upload="cancel"]').click();await page.locator('#u-zip').waitFor({state:'hidden'});assert.equal(upload,null);
        // A paused piece / navigation cannot finalize or leak work into a different owner.
        hold=true;holdReserve=true;const reservation=new Promise(resolve=>{reserveEntered=resolve;});await page.locator('#u-file').setInputFiles(archive);await observed(reservation);
        assert.equal(await page.locator('[data-upload="pause"]').count(),0,'Pause ends when hashing finishes, before waiting for reservation');holdReserve=false;releaseReserve();await page.waitForFunction(()=>document.querySelector('.upload-status')?.textContent.includes('Uploading'));
        await page.locator('[data-upload="pause"]').click();await page.locator('[data-upload="resume"]').waitFor();assert.equal(finalizes,1);
        const before=calls.length;await page.evaluate(()=>{forgetKept();App.me=null;});await page.waitForTimeout(500);assert.equal(calls.length,before,'owner change stops upload/poll work');
        assert.deepEqual(errors,[]);console.log(`PASS activity upload ${width} ${theme}`);
      }finally{await c.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
