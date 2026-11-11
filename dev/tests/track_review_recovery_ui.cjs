// Confirmed TrackReview requests survive reload and retry exactly once with fictional data.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',password='green teapot on the hill';
const fixture=require('../demo/track_session.cjs');
(async()=>{
 const browser=await chromium.launch();let context=null,fixtureReady=false,testFailure=null;const cleanupErrors=[];
 try{
  context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',timezoneId:'UTC'});
  cp.execFileSync('python3',[path.join(__dirname,'track_fixture.py')],{env:process.env,stdio:'inherit'});fixtureReady=true;
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_runner',password}});assert.equal(login.status(),200,'fictional TrackReview account logs in');
  const me=await(await context.request.get(base+'/api/me')).json(),recording=fixture('review');
  const journalKey='kinetta.track:'+JSON.stringify([base,me.id]);
  await context.addInitScript(({journalKey,recording})=>{const marker='kinetta.track-review-recovery.seeded';if(sessionStorage.getItem(marker)==='1')return;localStorage.setItem(journalKey,JSON.stringify(recording));sessionStorage.setItem(marker,'1');},{journalKey,recording});
  const attempts=[],blockedWrites=[],errors=[],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(request.method()==='POST'&&url.pathname==='/api/activities/track'){
    attempts.push(JSON.parse(request.postData()||'{}'));
    return attempts.length===1?route.fulfill({status:503,json:{detail:'Fictional temporary outage'}}):route.fulfill({status:201,json:{id:990358,duplicate:false}});
   }
   if(request.method()==='POST'&&url.pathname==='/api/milestones/celebrate')return route.fulfill({json:{items:[],pending:false}});
   if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
   if(!['GET','HEAD'].includes(request.method())){blockedWrites.push(`${request.method()} ${url.pathname}`);return route.abort();}
   return route.continue();
  });
  await page.goto(base+'/track');await page.locator('#track-save').waitFor();
  await page.locator('#track-save').click();
  await page.waitForFunction(()=>document.querySelector('#track-save')?.textContent==='Retry save'&&!document.querySelector('#track-save').disabled,null,{timeout:15000});
  assert.equal(attempts.length,1,'the first intercepted save reaches the expected uncertain outcome');
  assert.equal(await page.locator('#track-save-error').innerText(),'Save not confirmed. Draft kept.');
  const pending=await page.evaluate(async()=>TrackReviewStore.pending('kinetta.track:'+JSON.stringify([location.origin,App.me.id])));
  assert(pending?.request,'the confirmed request is persisted locally after the uncertain response');
  assert.deepEqual(JSON.parse(JSON.stringify(pending.request)),attempts[0],'the stored request matches the intercepted body');
  assert.equal(pending.id,recording.id,'the stored request retains the original recording identity');

  assert.equal(await page.evaluate(key=>{localStorage.removeItem(key);return localStorage.getItem(key);},journalKey),null,'remove only the fictional owner Track journal before reload');
  await page.reload();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('kinetta.track-review-recovery.seeded')),'1','reload retains the one-shot seed marker');
  await page.waitForFunction(()=>document.querySelector('#track-save')?.textContent==='Retry save'&&!document.querySelector('#track-save').disabled,null,{timeout:15000});
  const restored=await page.evaluate(async()=>TrackReviewStore.pending('kinetta.track:'+JSON.stringify([location.origin,App.me.id])));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.request)),attempts[0],'reload restores the exact confirmed request');
  await page.locator('#track-save').click();await page.locator('.track-saved').waitFor();
  assert.equal(attempts.length,2,'explicit Retry sends one second request');
  assert.deepEqual(attempts[1],attempts[0],'Retry preserves identical client ID and request body');
  assert.equal(await page.evaluate(async()=>TrackReviewStore.pending('kinetta.track:'+JSON.stringify([location.origin,App.me.id]))),null,'intercepted success clears the pending confirmed request');
  assert.deepEqual(blockedWrites,[],'the case blocks every other application write');
  assert.deepEqual(errors,[],'TrackReview recovery has no page errors');
  console.log('TrackReview recovery: confirmed payload survives reload, Retry is identical, success clears pending; fictional 390px light PASS');
 }catch(error){testFailure=error;
 }finally{
  if(context&&fixtureReady){
   for(const who of ['empty','runner','lifter']){
    try{
     const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:`zz_test_track_${who}`,password}});
     assert.equal(login.status(),200,`cleanup login succeeds for fictional ${who} account`);
     const removed=await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password}});
     assert.equal(removed.status(),200,`cleanup deletes fictional ${who} account`);
    }catch(error){cleanupErrors.push(`${who}: ${error.message}`);}
   }
  }
  if(context)try{await context.close();}catch(error){cleanupErrors.push(`context close: ${error.message}`);}
  try{await browser.close();}catch(error){cleanupErrors.push(`browser close: ${error.message}`);}
 }
 if(testFailure)throw testFailure;
 if(cleanupErrors.length)throw Error('Track fixture/browser cleanup failed: '+cleanupErrors.join('; '));
})().catch(error=>{console.error(error);process.exitCode=1;});
