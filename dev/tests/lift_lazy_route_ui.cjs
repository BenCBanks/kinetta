// First-use lifting route behavior with fictional records and all write requests intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',pw='green teapot on the hill';
const startTime=new Date(Date.now()-60_000).toISOString(),savedId=990000010;
async function until(page,predicate,label,arg){for(let i=0;i<200;i++){try{if(await page.evaluate(predicate,arg))return;}catch(_){}await page.waitForTimeout(100);}throw Error(label);}
async function ready(page,selector,label){await until(page,s=>!!document.querySelector(s)&&App.pageReady,label||`ready: ${selector}`,selector);}
async function login(context,name='zz_test_lift_compact'){
 const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:name,password:pw}});
 assert.equal(response.status(),200,`fictional lifting account ${name} logs in`);
}
function dataFor(ids){return {open:true,start_time:startTime,lastTick:null,exercises:[{exercise_id:ids.exercise,name:'Squat',kind:'weight',sets:[{kg:null,reps:null,secs:null,warmup:false,done:false}],last:{activity_id:savedId,start_time:'2026-10-30T12:00:00Z',sets:[{kg:50,reps:8}]},sessions_before:1}]};}
function savedSessions(){return [{id:savedId,name:'Fictional squat routine',start_time:'2026-10-30T12:00:00Z',exercises:['Fictional squat'],sets:3,volume:1200,lift_open:false}];}
async function installRoutes(context,{ids,sessionId,failBundleFirst=false,holdBundle=false,holdLiftWrites=false,failLiftWrites=0}={}){
 const openData=dataFor(ids),starts=[],scripts=[],liftWrites=[],unexpectedWrites=[];let opened=false,liftWritesHeld=holdLiftWrites,releaseBundle,enteredBundle;
 const gate=new Promise(resolve=>releaseBundle=resolve),entered=new Promise(resolve=>enteredBundle=resolve);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/lift-routes.js'){
   scripts.push(url.href);
   if(failBundleFirst&&scripts.length===1)return route.abort();
   if(holdBundle){const response=await route.fetch(),body=await response.text();enteredBundle();await gate;await route.fulfill({response,body});return;}
   return route.continue();
  }
  if(url.pathname==='/api/challenges/signup/continue'&&method==='POST')return route.fulfill({json:{}});
  if(url.pathname==='/api/lifts/sessions'&&method==='GET'){
   if(url.searchParams.get('limit')==='30')return route.fulfill({json:savedSessions()});
   if(url.searchParams.get('limit')==='1')return route.fulfill({json:opened?[{id:sessionId,name:'Fictional lifting session',start_time:startTime,sets:1,lift_open:true,exercises:['Squat']}]:[]});
  }
  if(url.pathname==='/api/lifts/start'&&method==='POST'){
   starts.push(request.postDataJSON());opened=true;return route.fulfill({json:{id:sessionId,resumed:false}});
  }
  if(url.pathname===`/api/activities/${sessionId}/lifts`&&method==='GET')return route.fulfill({json:JSON.parse(JSON.stringify(openData))});
  if(url.pathname===`/api/activities/${sessionId}/lifts`&&method==='PUT'){
   const body=request.postDataJSON();liftWrites.push(body);
   if(liftWritesHeld||failLiftWrites>0){if(failLiftWrites>0)failLiftWrites--;return route.fulfill({status:503,json:{detail:'Fictional lifting save unavailable'}});}
   return route.fulfill({json:{open:!body.finish,start_time:startTime,exercises:body.exercises.map(e=>({...openData.exercises.find(x=>x.exercise_id===e.exercise_id),...e,sets:e.sets.map(s=>({...s,pr:[]}))}))}});
  }
  if(!['GET','HEAD'].includes(method)){unexpectedWrites.push(`${method} ${url.pathname}`);return route.fulfill({status:403,json:{detail:'Fictional test write blocked'}});}
  return route.continue();
 });
 return {starts,scripts,liftWrites,unexpectedWrites,waitBundle:()=>entered,releaseBundle,releaseLiftWrites:()=>{liftWritesHeld=false;},opened:()=>opened};
}
async function startFromTrack(browser,ids,{mode,sessionId,failBundleFirst=false,holdBundle=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'UTC'});
 await login(context);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
 const routes=await installRoutes(context,{ids,sessionId,failBundleFirst,holdBundle});
 await page.goto(base+'/me');await ready(page,'.me-card-sections[aria-busy="false"]','initial Me readiness');
 assert.equal(routes.scripts.length,0,'initial Me does not request the deferred lifting routes');
 await page.goto(base+'/track');await ready(page,'#track-start','Track readiness');
 await page.locator('#track-start').click();await page.locator('#sl-new').waitFor();
 if(mode==='repeat'){
  await page.locator(`[data-copy="${savedId}"]`).waitFor();
  await page.locator(`[data-copy="${savedId}"]`).click();
 }else await page.locator('#sl-new').click();
 if(holdBundle)await page.locator('.lazy-route-loading').waitFor();
 else if(failBundleFirst)await page.locator('#lazy-route-retry').waitFor();
 return {context,page,routes,errors};
}
(async()=>{
 const output=cp.execFileSync('python3',[path.join(__dirname,'lift_compact_fixture.py')],{env:process.env,encoding:'utf8'});
 console.log(output.trim());const ids=JSON.parse(output.trim().split('\n').at(-1)),browser=await chromium.launch(),contexts=[];
 try{
  for(const [mode,sessionId] of [['start',990001001],['repeat',990001002]]){
   const run=await startFromTrack(browser,ids,{mode,sessionId,failBundleFirst:true});contexts.push(run.context);
   assert.equal(run.routes.starts.length,1,`${mode} sends exactly one session-start request before retry`);
   if(mode==='repeat')assert.equal(run.routes.starts[0].copy_from,savedId,'Repeat preserves the selected saved session');
   else assert.deepEqual(run.routes.starts[0],{},'Start creates an empty session');
   assert.equal(new URL(run.page.url()).pathname,`/track/lift/${sessionId}`,'the first route load stays on the new session id');
   assert.equal(run.routes.scripts.length,1,'the first-use route requests its lazy module once');
   assert(await run.page.locator('#lazy-route-retry').isVisible(),'a failed first module load offers explicit retry');
   await run.page.locator('#lazy-route-retry').click();await ready(run.page,'.lift-ex',`${mode} logger after retry`);
   assert.equal(run.routes.scripts.length,2,'explicit retry requests the failed module again');
   assert.equal(new URL(run.page.url()).pathname,`/track/lift/${sessionId}`,'retry reopens the same session id');
   assert.equal(run.routes.starts.length,1,'retry never posts a second session start');
   assert.deepEqual(run.errors,[],`${mode} retry has no page errors`);assert.deepEqual(run.routes.unexpectedWrites,[],`${mode} blocks every unrelated browser write`);
   console.log(`Lifting first-use ${mode}: cold Me, one start, blocked module, explicit same-id retry PASS`);
   await run.context.close();contexts.splice(contexts.indexOf(run.context),1);
  }

  const carryContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'UTC'});contexts.push(carryContext);
  await login(carryContext);const carryPage=await carryContext.newPage(),carryErrors=[];carryPage.on('pageerror',e=>carryErrors.push(e.message));
  await carryContext.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  const carryRoutes=await installRoutes(carryContext,{ids,sessionId:990001003,failBundleFirst:true,holdLiftWrites:true});
  await carryPage.goto(base+'/me');await ready(carryPage,'.me-card-sections[aria-busy="false"]','carry fixture Me readiness');assert.equal(carryRoutes.scripts.length,0);
  await carryPage.goto(base+'/track');await ready(carryPage,'#track-start','carry fixture Track readiness');await carryPage.locator('#track-start').click();await carryPage.locator('#sl-new').waitFor();await carryPage.locator('#sl-new').click();
  await carryPage.locator('#lazy-route-retry').waitFor();assert.equal(carryRoutes.starts.length,1);await carryPage.locator('#lazy-route-retry').click();await ready(carryPage,'.lift-ex','carry fixture logger');
  const reps=carryPage.locator('.lift-ex [data-row="0"] [data-k="reps"]');await reps.fill('7');
  await carryPage.evaluate(()=>{let hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});window.__fixtureVisibility=value=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};window.__fixtureVisibility(true);});
  await until(carryPage,()=>document.querySelector('#lf-save')?.textContent==='Not saved'&&JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fit.lift:')))||'null')?.unsent===true,'failed visibility flush keeps an unsent local draft');
  const draft=await carryPage.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fit.lift:')))));
  assert.equal(draft.data.exercises[0].sets[0].reps,7,'the unsent fictional value is stored locally');
  await carryPage.locator('nav.tabs a[data-tab="me"]').click();await ready(carryPage,'.me-card-sections[aria-busy="false"]','Me after leaving the logger');
  await carryPage.locator('nav.tabs a[data-tab="track"]').click();await ready(carryPage,'#track-start','Track after leaving the logger');await carryPage.locator('.lift-now').waitFor();
  assert.match(await carryPage.locator('.lift-now').innerText(),/Carry on/,'Track offers the existing session as Carry on');
  await carryPage.locator('.lift-now').click();await ready(carryPage,'.lift-ex','logger after Track Carry on');
  assert.equal(new URL(carryPage.url()).pathname,'/track/lift/990001003','Carry on keeps the same open session id');
  assert.equal(await carryPage.locator('.lift-ex [data-row="0"] [data-k="reps"]').inputValue(),'7','Carry on restores the failed local draft');
  await until(carryPage,()=>document.querySelector('#lf-save')?.textContent==='Not saved'&&JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fit.lift:')))||'null')?.unsent===true,'automatic reopen keeps the failed draft local');
  const writesBeforeResume=carryRoutes.liftWrites.length;carryRoutes.releaseLiftWrites();await carryPage.evaluate(()=>window.__fixtureVisibility(false));
  await until(carryPage,()=>carryRoutes.liftWrites.length>writesBeforeResume&&document.querySelector('#lf-save')?.textContent==='Saved','visibility resume flushes the restored draft');
  assert.equal(carryRoutes.liftWrites.at(-1).exercises[0].sets[0].reps,7,'visibility resume sends the same local draft');
  const savedDraft=await carryPage.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fit.lift:')))));
  assert.equal(savedDraft.unsent,false,'successful resume flush marks the local draft synced');
  assert.equal(carryRoutes.starts.length,1,'Carry on and visibility resume never start a second session');
  assert.deepEqual(carryErrors,[]);assert.deepEqual(carryRoutes.unexpectedWrites,[]);
  console.log('Lifting carry-on: failed local draft survives navigation, restores on same-id Carry on, and visibility resume saves it PASS');

  const stale=await startFromTrack(browser,ids,{mode:'start',sessionId:990001004,holdBundle:true});contexts.push(stale.context);
  assert.equal(stale.routes.starts.length,1);await stale.routes.waitBundle();await stale.page.locator('.lazy-route-loading').waitFor();
  await stale.page.locator('nav.tabs a[data-tab="me"]').click();await ready(stale.page,'.me-card-sections[aria-busy="false"]','Me after route path changes');
  await login(stale.context,'zz_test_lift_compact_fresh');
  const profileResponse=await stale.context.request.get(base+'/api/me');assert.equal(profileResponse.status(),200,'second fictional owner profile is available');
  const second=await profileResponse.json();await stale.page.evaluate(profile=>refreshMe(profile),second);
  await until(stale.page,()=>App.me?.login==='zz_test_lift_compact_fresh'&&!!document.querySelector('.me-card-sections[aria-busy="false"]'),'new fictional account owns Me after route change');
  stale.routes.releaseBundle();await stale.page.waitForTimeout(150);
  assert.equal(new URL(stale.page.url()).pathname,'/me','the delayed start route cannot override the newer path');
  assert.equal(await stale.page.locator('#lf-list').count(),0,'the delayed module cannot mount a stale logger after path/account change');
  assert.equal(await stale.page.evaluate(()=>App.me.login),'zz_test_lift_compact_fresh');
  assert.equal(stale.routes.starts.length,1,'a stale module response does not repeat session start');
  assert.deepEqual(stale.errors,[]);assert.deepEqual(stale.routes.unexpectedWrites,[]);
  console.log('Lifting delayed module: path and account change prevent stale logger mount PASS');
 }finally{
  for(const context of contexts)await context.close();
  const cleanup=await browser.newContext();
  try{for(const name of ['zz_test_lift_compact','zz_test_lift_compact_fresh']){const result=await cleanup.request.post(base+'/api/login',{headers:{Origin:base},data:{login:name,password:pw}});if(result.ok())await cleanup.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}}
  finally{await cleanup.close();await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
