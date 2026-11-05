// Fictional preferences and native-method stand-ins. No real preference writes or phone actions.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const selectedStates=(process.env.NOTIFICATION_UI_STATES||'empty,typical,heavy').split(','),selectedRoots=(process.env.NOTIFICATION_UI_ROOTS||'15,16').split(',').map(Number),selectedThemes=(process.env.NOTIFICATION_UI_THEMES||'light,dark').split(',');
async function until(p,fn,arg){for(let n=0;n<160;n++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(75);}throw Error('Notification state did not settle');}
async function shot(p,name){if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}}
async function installPhoneFixture(p){return p.evaluate(async()=>{
 window.fixturePhone={enabled:true,denied:false};window.fixtureStatusFailure=false;window.fixturePhoneCommands=[];
 Native.on=true;Native.pushSupported=true;Native.haptic=()=>{};
 Native.pushStatus=async()=>{if(fixtureStatusFailure)throw Error('Fictional phone status unavailable');return {...fixturePhone};};
 Native.enablePush=async()=>{fixturePhoneCommands.push('enable');fixturePhone.enabled=true;};
 Native.disconnectPush=async()=>{fixturePhoneCommands.push('off');fixturePhone.enabled=false;};
 Native.openPushSettings=async()=>fixturePhoneCommands.push('settings');
 window.fixturePush={push_ready:true,push:Object.fromEntries(Object.keys(PUSH_NAMES).map(k=>[k,true]))};
 await pushCard(document.querySelector('#nt-push'),fixturePush);return fixturePush.push;
});}
(async()=>{const browser=await chromium.launch();try{
for(const state of selectedStates)for(const size of [{width:390,height:844,root:15},{width:390,height:844,root:16}].filter(s=>selectedRoots.includes(s.root)))for(const theme of selectedThemes){
 const c=await browser.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[],puts=[];let releaseMeal,holdMeal=false,failMeal=false,failKind=false;
 let meal={enabled:state!=='empty',tz:'UTC',push_ready:state!=='empty',device_ready:state!=='empty',times:['breakfast','lunch','dinner'].map((meal,i)=>({meal,ready:state==='heavy'||state==='typical'&&i===1,time:'12:15'}))};
 let personal={plan:state!=='empty',weekly:state==='heavy',plan_time:'08:00',tz:'UTC',push_ready:state!=='empty',device_ready:state!=='empty'},push={};
 assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
 await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);p.on('pageerror',e=>errors.push(e.message));
 await c.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();const key=u.pathname;
  if(key==='/api/challenges/signup/continue')return r.fulfill({json:{}});
  if(key==='/api/notifications/personal')return r.fulfill({json:personal});
  if(key==='/api/food/reminders'){
   if(q.method()==='PUT'){const data=q.postDataJSON();puts.push({kind:'meal',data});if(holdMeal)await new Promise(resolve=>releaseMeal=resolve);if(failMeal){failMeal=false;return r.fulfill({status:503,json:{detail:'Fictional reminder save unavailable'}});}meal={...meal,enabled:data.enabled};}
   return r.fulfill({json:meal});
  }
  if(key==='/api/notifications/settings'){
   const data=q.postDataJSON();puts.push({kind:'social',data});if(failKind){failKind=false;return r.fulfill({status:503,json:{detail:'Fictional category save unavailable'}});}push={...push,...data};return r.fulfill({json:{push}});
  }
  if(!['GET','HEAD'].includes(q.method())){writes.push(key);return r.abort();}return r.continue();
 });
 await p.goto(base+'/me/notifications');await until(p,()=>App.pageReady&&!!document.querySelector('[data-meal-reminders]'));
 if(state!=='empty')push=await installPhoneFixture(p);
 if(state==='typical'&&size.root===16){
  await p.evaluate(async()=>{fixturePhone={enabled:false,denied:true};await pushCard(document.querySelector('#nt-push'),fixturePush);});
  await p.locator('#np-settings').waitFor({state:'visible'});await p.evaluate(()=>document.querySelector('#np-settings')?.click());await until(p,()=>fixturePhoneCommands.includes('settings'));
  await p.evaluate(async()=>{fixturePhone.denied=false;await pushCard(document.querySelector('#nt-push'),fixturePush);});await p.locator('#np-on').waitFor({state:'visible'});await p.evaluate(()=>document.querySelector('#np-on')?.click());await until(p,()=>fixturePhone.enabled&&!!document.querySelector('#np-off'));
  await p.evaluate(()=>document.querySelector('#np-off')?.click());await until(p,()=>!fixturePhone.enabled&&!!document.querySelector('#np-on'));assert.deepEqual(await p.evaluate(()=>fixturePhoneCommands),['settings','enable','off'],'only stand-in native actions run');
  await p.evaluate(async()=>{Native.pushSupported=false;await pushCard(document.querySelector('#nt-push'),fixturePush);});assert(await p.getByText('Update Kinetta in TestFlight to enable phone alerts.',{exact:true}).isVisible());
  await p.evaluate(async()=>{Native.pushSupported=true;fixturePhone={enabled:true,denied:false};await pushCard(document.querySelector('#nt-push'),fixturePush);});await p.locator('#np-kinds').waitFor();
 }
 const monthly=p.locator('[data-monthly-summary]');await monthly.waitFor();assert(await monthly.isChecked(),'Monthly summary is on by default beside Weekly summary');
 assert.equal(await p.locator('#np-kinds input[name=monthly_summary]').count(),0,'Monthly summary is not an Alert type');
 assert(await monthly.evaluate(n=>n.closest('.personal-notifications')?.querySelector('h2')?.textContent==='Training & progress'),'Monthly summary is in Training & progress');
 assert(await monthly.evaluate(n=>n.closest('.personal-notice-choice')?.previousElementSibling?.querySelector('[data-personal="weekly"]')!==null),'Monthly summary sits beside Weekly summary');
 assert.equal(puts.length,0,'view never opts in');
 if(state==='typical'&&size.root===16){
  failKind=true;await monthly.click();await p.locator('[data-personal-status]').filter({hasText:'Fictional category save unavailable'}).waitFor();assert(await monthly.isChecked(),'a failed monthly save restores the previous On state');
  await p.locator('.personal-notifications').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await shot(p,`monthly-error-${size.width}-${size.root}-${theme}`);
  await monthly.uncheck();await until(p,()=>{const input=document.querySelector('[data-monthly-summary]');return !!input&&!input.disabled;});assert.equal(puts.at(-1).data.monthly_summary,false,'Monthly summary saves to the existing preference endpoint');
  await p.locator('.personal-notifications').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await shot(p,`monthly-off-${size.width}-${size.root}-${theme}`);
  await monthly.check();await until(p,()=>{const input=document.querySelector('[data-monthly-summary]');return !!input&&!input.disabled;});assert.equal(puts.at(-1).data.monthly_summary,true);
  await p.locator('.personal-notifications').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await shot(p,`monthly-on-${size.width}-${size.root}-${theme}`);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200,'refresh fictional session before existing meal/category checks');
  await p.goto(base+'/me/notifications');await until(p,()=>App.pageReady&&!!document.querySelector('[data-meal-reminders]'));push=await installPhoneFixture(p);
 }
 await p.locator('[data-meal-reminders]').waitFor();assert.equal(await p.locator('[data-meal-reminders]').getAttribute('role'),'switch');
 assert(await p.locator('.meal-reminders').evaluate(n=>n.querySelector('button,input,select')===n.querySelector('[data-meal-reminders]')),'meal switch is first control');
 assert.equal(await p.locator('.meal-reminder-details').count(),state==='empty'?0:1);assert.equal(await p.locator('[data-personal=plan_time]').count(),state==='empty'?0:1);
 await p.locator('.personal-notifications').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await shot(p,`${state}-monthly-${size.width}-${size.root}-${theme}`);
 assert.equal(await p.locator('.meal-reminders').getByText('Learning your usual times.',{exact:true}).count(),state==='typical'?1:0);
 if(state==='typical'){assert.equal(await p.locator('.meal-reminders dt').innerText(),'Lunch');assert(!/Breakfast|Dinner/.test(await p.locator('.meal-reminders dl').innerText()));}
 const metrics=await p.locator('.notification-settings .switch-row').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),input=n.querySelector('input');return {h:r.height,w:r.width,font:parseFloat(s.fontSize),role:input.getAttribute('role'),parent:n.parentElement.className,y:r.y,b:r.bottom};}));
 for(let i=0;i<metrics.length;i++){const m=metrics[i];assert(m.w>=44&&m.h>=56&&m.font>=15&&m.role==='switch','readable full-label switch target');if(i&&m.parent==='notification-choices'&&metrics[i-1].parent===m.parent)assert(m.y-metrics[i-1].b>=8-.1,'8px between type switches');}
 const geometry=await p.evaluate(()=>{
  const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,b:r.bottom,w:r.width,h:r.height};};
  return {cards:[...document.querySelectorAll('.notification-settings .card')].map(n=>({padding:['Top','Right','Bottom','Left'].map(side=>parseFloat(getComputedStyle(n)['padding'+side]))})),targets:[...document.querySelectorAll('.notification-settings .switch-row,.notification-settings .personal-notice-time select,.notification-settings .reminder-how summary,.notification-settings .notification-phone-action button')].map(box)};
 });
 assert(geometry.cards.every(n=>n.padding.every(v=>v>=16)),'16px card padding');
 for(let i=0;i<geometry.targets.length;i++){const a=geometry.targets[i];assert(a.w>=44&&a.h>=44);for(let j=i+1;j<geometry.targets.length;j++){const b=geometry.targets[j];if(Math.min(a.b,b.b)>Math.max(a.y,b.y)+1)assert(Math.max(a.x,b.x)-Math.min(a.right,b.right)>=8-.1,'8px horizontal gap');else if(Math.min(a.right,b.right)>Math.max(a.x,b.x)+1)assert(Math.max(a.y,b.y)-Math.min(a.b,b.b)>=8-.1,'8px vertical gap');}}
 for(const label of await p.locator('.notification-settings .switch-row').all()){await label.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));assert(await label.evaluate(n=>{const r=n.getBoundingClientRect();return document.elementFromPoint(r.left+4,r.top+r.height/2)?.closest('label')===n;}),'whole label owns its touch target');}
 console.log('Notification row geometry',state,size.width,size.root,theme,JSON.stringify(metrics));
 assert(await p.locator('.notification-settings .subpage-header h1').evaluate(n=>n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().height<parseFloat(getComputedStyle(n).fontSize)*1.7),'Notifications title stays complete on one line');
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'no horizontal overflow');await p.evaluate(()=>scrollTo(0,0));await shot(p,`${state}-${size.width}-${size.root}-${theme}`);
 await p.locator('.meal-reminders').scrollIntoViewIfNeeded();await shot(p,`${state}-meal-${size.width}-${size.root}-${theme}`);
 if(state==='typical'&&size.root===16){
  holdMeal=true;failMeal=true;await p.locator('.meal-reminders .switch-row > span').click();await until(p,()=>document.querySelector('[data-meal-status]')?.textContent==='Saving…');
  for(let n=0;n<100&&!releaseMeal;n++)await p.waitForTimeout(30);assert(releaseMeal);
  await p.evaluate(async()=>{window.fixtureStatusFailure=true;await pushCard(document.querySelector('#nt-push'),fixturePush);});
  assert(await p.locator('[data-meal-reminders]').isDisabled(),'phone failure keeps pending meal control');assert(await p.locator('#np-retry').isVisible());holdMeal=false;releaseMeal();
  await p.locator('.meal-reminders .err').filter({hasText:'Fictional reminder save unavailable'}).waitFor();assert(await p.locator('[data-meal-reminders]').isChecked(),'failed save restores On through parent failure');
  await p.evaluate(()=>window.fixtureStatusFailure=false);await p.locator('#np-retry').click();await p.locator('#np-kinds').waitFor();
  await p.locator('[data-meal-reminders]').uncheck();await until(p,()=>!document.querySelector('[data-meal-reminders]').disabled&&!document.querySelector('.meal-reminder-details'));assert.equal(puts.at(-1).data.confirmed,false);
  await p.locator('[data-meal-reminders]').check();await until(p,()=>!document.querySelector('[data-meal-reminders]').disabled&&!!document.querySelector('.meal-reminder-details'));assert.equal(puts.at(-1).data.confirmed,true);
  meal={...meal,push_ready:false,device_ready:false};await p.evaluate(()=>mealReminderCard(document.querySelector('#np-meal-reminders')));assert(!(await p.locator('[data-meal-reminders]').isDisabled()),'enabled but unready can turn Off');await p.locator('[data-meal-reminders]').uncheck();await until(p,()=>document.querySelector('[data-meal-reminders]').disabled&&!document.querySelector('[data-meal-reminders]').checked);
  failKind=true;await p.locator('#np-kinds input[name=cheers]').click();await p.locator('#np-error').filter({hasText:'Fictional category save unavailable'}).waitFor();assert(await p.locator('#np-kinds input[name=cheers]').isChecked());
  await p.locator('#np-kinds input[name=cheers]').uncheck();await until(p,()=>!document.querySelector('#np-kinds input[name=cheers]').disabled);assert.equal(await p.locator('#np-error').innerText(),'','successful retry clears old error');assert.equal(push.cheers,false);assert(puts.filter(x=>x.kind==='social'&&!Object.hasOwn(x.data,'monthly_summary')).every(x=>Object.keys(x.data).join()==='cheers'));
  await p.locator('[data-meal-reminders]').waitFor();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Notification switches ${state} ${size.width}/${size.root} ${theme}: layout/readiness/details/confirmed writes/failure/refresh/native stand-ins PASS`);
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
