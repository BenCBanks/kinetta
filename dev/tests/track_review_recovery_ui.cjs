// Confirmed TrackReview requests survive reload and retry exactly once with fictional data.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',password='green teapot on the hill';
const fixture=require('../demo/track_session.cjs');
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'track_fixture.py')],{env:process.env,stdio:'inherit'});
 const browser=await chromium.launch();let context=null;
 try{
  context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',timezoneId:'UTC'});
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_runner',password}});assert.equal(login.status(),200,'fictional TrackReview account logs in');
  const me=await(await context.request.get(base+'/api/me')).json(),recording=fixture('review');
  await context.addInitScript(({server,uid,recording})=>localStorage.setItem('kinetta.track:'+JSON.stringify([server,uid]),JSON.stringify(recording)),{server:base,uid:me.id,recording});
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

  await page.reload();
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
 }finally{
  if(context){
   for(const who of ['empty','runner','lifter']){
    const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:`zz_test_track_${who}`,password}});
    if(login.ok())await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password}});
   }
   await context.close();
  }
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
