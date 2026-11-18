'use strict';
// Removal contract: no meal reminder settings or requests; ordinary phone alerts still work.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label){for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(75);}throw Error(label+' did not settle');}
async function shot(p,name){if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}}
(async()=>{const browser=await chromium.launch();try{
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'}),p=await c.newPage(),errors=[],requests=[],writes=[],saved=[];
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  assert.equal((await c.request.get(base+'/api/food/reminders')).status(),404,'removed meal reminder API no longer exists');
  await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/food/reminders')requests.push(r.method());});
  let phone={enabled:false,denied:false},push={friends:true,cheers:true,comments:true,dishes:true,activities:true,milestones:true,challenge_joins:true,challenge_reminders:true,challenge_finished:true};
  await c.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();
   if(u.pathname==='/api/notifications')return route.fulfill({json:{items:[],unread:0,push:{...push},push_ready:true}});
   if(u.pathname==='/api/notifications/personal')return route.fulfill({json:{plan:false,weekly:true,streak:false,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
   if(u.pathname==='/api/notifications/settings'&&q.method()==='PUT'){const data=q.postDataJSON();saved.push(data);push={...push,...data};return route.fulfill({json:{push:{...push}}});}
   if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{}});
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return route.fulfill({status:204,body:''});}
   return route.continue();
  });
  try{
   await p.goto(base+'/me/notifications');await until(p,()=>typeof App!=='undefined'&&App.pageReady&&!!document.querySelector('#nt-push .card'),'notification page');
   assert.equal(await p.locator('[data-meal-reminders],.meal-reminders,#np-meal-reminders').count(),0,'settings contains no meal reminder controls');
   assert.equal(await p.locator('[data-monthly-summary]').count(),1,'weekly/monthly personal notification settings remain');
   assert.equal(requests.length,0,'opening settings makes no meal reminder request');
   await p.evaluate(async()=>{Native.on=true;Native.pushSupported=true;Native.haptic=()=>{};Native.pushStatus=async()=>({...window.fixturePhone});Native.enablePush=async()=>{window.fixturePhone.enabled=true;};Native.disconnectPush=async()=>{window.fixturePhone.enabled=false;};window.fixturePhone={enabled:false,denied:false};window.fixturePush={push_ready:true,push:Object.fromEntries(Object.keys(PUSH_NAMES).map(k=>[k,true]))};await pushCard(document.querySelector('#nt-push'),fixturePush);});
   await p.locator('#np-on').waitFor({state:'visible'});await p.locator('#np-on').click();await until(p,()=>!!document.querySelector('#np-off'),'phone alerts enabled');await p.locator('#np-kinds').waitFor();
   assert.equal(await p.locator('#np-kinds input[role=switch]').count(),9,'all non-meal alert types remain available');
   assert.equal(await p.locator('#np-kinds input[name=challenge_reminders]').count(),1,'challenge reminders remain distinct and available');
   assert.equal(await p.locator('[data-meal-reminders],.meal-reminders,#np-meal-reminders').count(),0,'enabling phone alerts does not restore meal reminders');
   await p.locator('#np-kinds input[name=cheers]').uncheck();await until(p,()=>!!document.querySelector('#np-kinds input[name=cheers]')&&!document.querySelector('#np-kinds input[name=cheers]').disabled,'social preference save');assert(saved.some(x=>x.cheers===false));assert.equal(push.cheers,false);
   assert.equal(requests.length,0,'phone permission and other alert settings make no meal reminder request');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'only the mocked notification preference endpoint receives writes');
   await shot(p,`notifications-${width}-${theme}`);
   console.log(`Notification settings ${width} ${theme}: no meal-reminder UI/request; phone permission, social and personal alert settings PASS`);
  }finally{await c.close();}
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
