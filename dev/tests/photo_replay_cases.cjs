'use strict';
// Real own-account upload, committed response discarded, then explicit retry. Fictional data only.
const assert=require('node:assert/strict');
module.exports=async function photoReplay(browser,base,{login='alex',password='blue kettle morning run'}={}){
 for(const native of [false,true])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  let photo=null,token;
  try{
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password,app:native}});assert.equal(signed.status(),200);token=(await signed.json()).token;
   const headers={...(native?{Authorization:'Bearer '+token}:{}),Origin:base,'Content-Type':'application/json'};
   const rows=await(await context.request.get(base+'/api/activities?limit=100',{headers})).json();const activity=rows[0];assert(activity?.id,'fictional own activity fixture');
   if(native)await context.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false,Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});
   const page=await context.newPage(),errors=[],bodies=[],replies=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const target=base+`/api/activities/${activity.id}/photos`;
   await page.route(target,async route=>{
    if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postDataJSON());
    const response=await route.fetch();assert.equal(response.status(),200);const saved=await response.json();replies.push(saved);photo=saved.id;
    if(bodies.length===1)return route.abort();return route.fulfill({response});
   });
   await page.goto(base+'/activity/'+activity.id);await page.waitForFunction(()=>App.pageReady&&typeof photoStrip==='function');
   await page.evaluate(aid=>sheet('Activity photos','<div id="replay-photos"></div>',b=>photoStrip(b.querySelector('#replay-photos'),{id:aid,photos:[]},true)),activity.id);
   await page.locator('[data-phfile]').setInputFiles({name:'fictional.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64')});
   const retry=page.getByRole('button',{name:'Retry photo',exact:true});await retry.waitFor();assert.equal(bodies.length,1);await retry.click();
   await page.locator('[data-ph="0"]').waitFor();assert.equal(bodies.length,2);assert.deepEqual(bodies[1],bodies[0]);assert.match(bodies[0].client_id,/^[0-9a-f-]{36}$/);assert.deepEqual(replies[1],replies[0]);
   const detail=await(await context.request.get(base+'/api/activities/'+activity.id,{headers})).json();assert.equal(detail.photos.filter(p=>p.id===photo).length,1,'one committed photo after a lost reply and retry');
   assert.equal((await context.request.delete(base+'/api/activity-photos/'+photo,{headers,data:{}})).status(),200);photo=null;
   const removed=await context.request.post(target,{headers,data:bodies[0]});assert.equal(removed.status(),410,'deleted committed photo is not recreated by stale retry');assert.deepEqual(errors,[]);
  }finally{
   if(photo)await context.request.delete(base+'/api/activity-photos/'+photo,{headers:{Origin:base,'Content-Type':'application/json',...(native?{Authorization:'Bearer '+token}:{})},data:{}});
   await context.close();
  }
 }
 console.log('Photo replay: real committed/lost response, one saved photo, unchanged retry ID and deletion tombstone; 4 web/bridge light/dark PASS');
};
if(require.main===module)(async()=>{const browser=await require('playwright').chromium.launch();try{await module.exports(browser,process.env.KINETTA_URL||'http://localhost:8798');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
