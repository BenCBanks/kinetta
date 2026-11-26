// Actual native.js with a fictional Capacitor push bridge. No device or APNs traffic.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function nativeNotificationChecks(browser,{base,out}={}){
 const login=await browser.newContext();let token,me;
 try{const r=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:true}});assert(r.ok());({token}=await r.json());assert(token);me=await(await login.request.get(base+'/api/me',{headers:{Authorization:'Bearer '+token}})).json();
  // This endpoint saves choices independently of device registration/Apple permission.
  const existing=await(await login.request.get(base+'/api/notifications',{headers:{Authorization:'Bearer '+token}})).json();assert((await login.request.put(base+'/api/notifications/settings',{headers:{Origin:base,Authorization:'Bearer '+token},data:{cheers:existing.push.cheers}})).ok());
 }finally{await login.close();}
 const cases=[['enabled',true,false,true],['denied',false,true,false],['not-asked',false,false,false],['previously-off',true,false,false]];
 for(const width of [390,330])for(const theme of ['light','dark'])for(const [name,allowed,denied,registered]of cases){
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[],unexpected=[],saved=[],posts=[];
  let push={friends:true,cheers:true,comments:false,dishes:true,activities:true,milestones:false,challenge_joins:true,challenge_reminders:true,challenge_finished:false,monthly_summary:false},deviceReady=registered,failSave=false;
  try{
   await c.addInitScript(({base,token,id,allowed,denied,registered})=>{
    const owner=JSON.stringify([base,id]),prefs={server:base,token,...(registered?{'push.owner':owner,'push.wanted':owner}:{})};
    window.pushFixture={allowed,denied,registers:[],opens:0,prefs};
    window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',isPluginAvailable:n=>['Preferences','KinettaPush'].includes(n),Plugins:{
     Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}},
     KinettaPush:{status:async()=>({allowed:pushFixture.allowed,denied:pushFixture.denied}),register:async({request})=>{pushFixture.registers.push(request);if(pushFixture.denied)throw Error('Allow Kinetta notifications in iPhone Settings.');if(!pushFixture.allowed&&!request)throw Error('Permission was not requested');pushFixture.allowed=true;return{token:'ab'.repeat(32),environment:'sandbox'};},unregister:async()=>{throw Error('The settings screen must not unregister this phone');},openSettings:async()=>{pushFixture.opens++;},takePending:async()=>({url:''}),setBadge:async()=>{},addListener:async()=>({remove:async()=>{}})}
    }};
   },{base,token,id:me.id,allowed,denied,registered});
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});
    if(u.pathname==='/api/notifications')return r.fulfill({json:{items:[],unread:0,push_ready:true,push}});
    if(u.pathname==='/api/notifications/personal')return r.fulfill({json:{plan:false,weekly:false,streak:false,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:deviceReady}});
    if(u.pathname==='/api/notifications/settings'&&q.method()==='PUT'){saved.push(q.postDataJSON());if(failSave){failSave=false;return r.fulfill({status:503,json:{detail:'Fictional preference failure'}});}push={...push,...q.postDataJSON()};return r.fulfill({json:{push}});}
    if(u.pathname==='/api/push/ios'&&q.method()==='POST'){posts.push(q.postDataJSON());deviceReady=true;return r.fulfill({json:{ok:true}});}
    if(!['GET','HEAD'].includes(q.method())){unexpected.push(u.pathname);return r.fulfill({json:{}});}
    return r.continue();
   });
   await p.goto(base+'/me/notifications');await p.locator('#np-kinds').waitFor();await p.locator('[data-monthly-summary]').waitFor();
   assert.equal(await p.locator('#np-off').count(),0,'there is no in-app all-off action');
   const choices=p.locator('#np-kinds input[role=switch]');assert.equal(await choices.count(),9);assert.equal(await p.locator('#np-kinds input:disabled').count(),0,'all saved types editable with any permission state');
   assert(!(await p.locator('[data-monthly-summary]').isDisabled()),'monthly preference can be saved without phone permission');
   assert.equal(await p.locator('#nt-personal [data-saved-alert]').count(),0,'read-only values are web only');
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`native-${name}-${width}-${theme}.png`),animations:'disabled'});await p.locator('#np-kinds input[name=challenge_finished]').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await p.screenshot({path:path.join(out,`native-${name}-types-${width}-${theme}.png`),animations:'disabled'});}
   await p.locator('#np-kinds input[name=cheers]').uncheck();await p.waitForFunction(()=>!document.querySelector('#np-kinds input[name=cheers]').disabled);assert(saved.some(v=>v.cheers===false));assert.equal(push.cheers,false);
   // Failed preference saves restore the prior choice even when Apple permission is off.
   failSave=true;await p.locator('#np-kinds input[name=comments]').check();await p.locator('#np-error').filter({hasText:'Kinetta is having trouble'}).waitFor();assert(!(await p.locator('#np-kinds input[name=comments]').isChecked()));
   await p.evaluate(async()=>pushCard(document.querySelector('#nt-push'),await api('/api/notifications')));assert(!(await p.locator('#np-kinds input[name=cheers]').isChecked()),'saved type survives a status refresh');
   await p.locator('[data-monthly-summary]').check();await p.waitForFunction(()=>!document.querySelector('[data-monthly-summary]').disabled);assert.equal(push.monthly_summary,true);
   if(name==='enabled'||name==='denied'){
    assert.equal(await p.locator('#np-on').count(),0);await p.locator('#np-settings').click();assert.equal(await p.evaluate(()=>pushFixture.opens),1,'opens native Settings bridge');assert.equal(await p.evaluate(()=>pushFixture.registers.filter(Boolean).length),0,'opening Settings never asks iOS for permission');
   }else{
    assert.equal(await p.evaluate(()=>pushFixture.registers.length),0,'not asked/previously disabled stays unregistered until tap');
    await p.locator('#np-on').click();await p.locator('#np-settings').waitFor();assert.equal(await p.locator('#np-on').count(),0);assert.equal(await p.evaluate(()=>pushFixture.registers.filter(Boolean).length),1);assert(posts.length>0,'explicit enable posts the device again');assert(await p.evaluate(async()=>(await Native.pushStatus()).enabled),'old app-disabled phone can register with existing Apple permission');
   }
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);console.log(`Native push bridge ${name}: ${width}px ${theme}; types/save recovery/settings/registration PASS`);
  }finally{await c.close();}
 }
};
if(require.main===module){const{chromium}=require('playwright');(async()=>{const b=await chromium.launch();try{await module.exports(b,{base:process.env.KINETTA_URL,out:process.env.KINETTA_COPY_SHOTS});}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});}
