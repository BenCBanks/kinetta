// Guarded fictional browser contexts shared by spacing, accessibility and review evidence.
'use strict';
const assert=require('node:assert/strict');
const {initialize,notificationState,modalState}=require('./spacing_screens.cjs');
const {seedWeeklyRecapDismissal,personaClockInstant}=require('./weekly_recap_fixture.cjs');
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function until(p,fn,label,timeout=30000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  if(await p.evaluate(fn))return;
  const login=await p.evaluate(()=>document.querySelector('#login,.login')?.innerText||'');
  if(login)throw Error(`${label}: login screen shown (${login.trim().slice(0,120)})`);
  await p.waitForTimeout(100);
 }
 throw Error(`${label} after ${Math.round(timeout/1000)} seconds`);
}
async function settle(p){
 let previous='',stable=0;
 for(let n=0;n<100&&stable<3;n++){
  const now=await p.evaluate(()=>JSON.stringify([document.fonts.status,document.documentElement.scrollHeight,...[...document.querySelectorAll('button,input,select,textarea')].filter(n=>n.getBoundingClientRect().width).map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})]));
  stable=now===previous?stable+1:0;previous=now;if(stable<3)await p.waitForTimeout(100);
 }
 assert.equal(stable,3,'Measured control layout settles');
}
async function fixtureSessions(browser,base,selected){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Disposable local server only');
 const sessions=new Map();
  // Reuse login state across sizes/themes to avoid needless sessions and login-rate pressure.
  for(const scene of selected){if(scene.signup)continue;assert(scene.login==='alex'||scene.login.startsWith('zz_test_'),'Fictional fixture accounts only');const key=scene.login+(scene.native?':native':'');if(sessions.has(key))continue;const c=await browser.newContext();try{
   const response=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:scene.login,password:scene.login==='alex'?'blue kettle morning run':'green teapot on the hill',app:!!scene.native}});assert.equal(response.status(),200,'Fixture login');
   const token=(await response.json()).token,headers=scene.native?{Authorization:'Bearer '+token}:{},me=await(await c.request.get(base+'/api/me',{headers})).json();
   sessions.set(key,{token,id:me.id,tz:me.tz,storageState:await c.storageState()});
  }finally{await c.close();}}
 return sessions;
}
async function fixturePage(browser,base,fixtures,sessions,scene,size,theme){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Disposable local server only');
   const auth=scene.signup?{id:null,storageState:{cookies:[],origins:[]}}:sessions.get(scene.login+(scene.native?':native':'')),clockMode=process.env.KINETTA_SPACING_CLOCK,clockTime=clockMode?personaClockInstant(clockMode,auth.tz||'UTC'):scene.todayPlan&&fixtures.me_today?.now?new Date(fixtures.me_today.now):scene.dismissWeeklyRecap?new Date():null,c=await browser.newContext({storageState:auth.storageState,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:clockMode?(auth.tz||'UTC'):'UTC'}),writes=[],pageErrors=[];
   try{
    const liftData=scene.lift?await(await c.request.get(base+'/api/activities/'+scene.lift+'/lifts')).json():null;
    await c.addInitScript(initialize,{root:size.root,native:!!scene.native,base,token:auth.token,id:auth.id,lift:scene.lift,liftData});
    if(scene.dismissWeeklyRecap)await seedWeeklyRecapDismissal(c,{id:auth.id,tz:auth.tz},base,clockTime);
    await c.route('**/*',r=>{const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();if(scene.signup&&request.method()==='GET'&&u.pathname==='/api/signup')return r.fulfill({json:{open:true,full:false}});if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(request.method()==='POST'&&u.pathname==='/api/milestones/celebrate')return r.fulfill({json:{items:[],pending:false}});if(!['GET','HEAD'].includes(request.method())){writes.push(u.pathname);return r.abort();}
     if(scene.groups&&u.pathname==='/api/groups')return r.fulfill({json:[]});
     if(scene.group==='empty'&&u.pathname==='/api/groups/00000000-0000-4000-8000-000000000001')return r.fulfill({json:require('./spacing_screens.cjs').GROUP_EMPTY});
     if(scene.group==='full'&&u.pathname==='/api/groups/00000000-0000-4000-8000-000000000050')return r.fulfill({json:require('./spacing_screens.cjs').GROUP_FULL});
     if(scene.invite&&u.pathname==='/api/group-invites/0123456789abcdef0123456789abcdef')return r.fulfill({json:{available:true}});
     if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/__spacing_tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:'Demo tiles'}});
     if(u.pathname.startsWith('/__spacing_tiles/'))return r.fulfill({contentType:'image/png',body:tile});
     if(scene.recap&&u.pathname==='/api/recaps')return r.fulfill({json:fixtures.recaps.matrix.typical[u.searchParams.get('period')]});
     if(scene.notifications&&u.pathname==='/api/notifications/personal')return r.fulfill({json:{plan:true,weekly:true,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
     if(scene.notifications&&u.pathname==='/api/food/reminders')return r.fulfill({json:{enabled:true,tz:'UTC',push_ready:true,device_ready:true,times:['breakfast','lunch','dinner'].map(meal=>({meal,ready:true,time:'12:15'}))}});
     return r.continue();
    });
    const p=await c.newPage();p.on('pageerror',e=>pageErrors.push(e.message));
    // Matrix scenarios shift the browser calendar while Date and timers keep advancing.
    if(clockMode)await p.clock.setSystemTime(clockTime);else if(clockTime)await p.clock.setFixedTime(clockTime);
    if(scene.recap)await p.clock.setFixedTime(new Date(fixtures.recaps.now));
    await p.goto(base+scene.route);if(!scene.signup)await until(p,()=>typeof App!=='undefined'&&App.pageReady,'Page route settles');await p.locator(scene.entryReady||scene.ready).first().waitFor({state:'attached'});
    if(scene.name==='Progress'){assert.deepEqual(await p.evaluate(()=>App.me?.feature_flags),{progress_calendar:false,progress_segments:false},'spacing/accessibility Progress fixture uses the default-off flags');assert.equal(await p.locator('[data-progress-feature="calendar"],[data-progress-feature="segments"]').count(),0,'audit Progress scene has no disabled Calendar or Segments links');}
    if(scene.modal==='share-card'||scene.modal==='card')await p.waitForFunction(()=>typeof KinettaCard!=='undefined',null,{timeout:10000});
    if(scene.modal){await modalState(p,scene.modal);await p.locator(scene.ready).first().waitFor({state:'attached'});}
    if(scene.notifications)await notificationState(p);
    if(scene.recap){await p.locator('#recap-entry').click();await until(p,()=>{const button=document.querySelector('#recap-share');return button&&!button.disabled;},'Recap data ready');await p.locator('#recap-share').click();await until(p,()=>{const image=document.querySelector('[data-share-image="0"]');return image?.complete&&image.naturalWidth>0;},'Recap picture ready');}
    await p.evaluate(()=>document.fonts.ready);
    return {c,p,auth,writes,pageErrors};
   }catch(error){await c.close();throw error;}
}
module.exports={until,settle,fixtureSessions,fixturePage};
