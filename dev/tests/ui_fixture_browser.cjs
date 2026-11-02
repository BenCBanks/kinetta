// Guarded fictional browser contexts shared by spacing, accessibility and review evidence.
'use strict';
const assert=require('node:assert/strict');
const {initialize,notificationState,modalState}=require('./spacing_screens.cjs');
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function until(p,fn,label){for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);}
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
   sessions.set(key,{token,id:me.id,storageState:await c.storageState()});
  }finally{await c.close();}}
 return sessions;
}
async function fixturePage(browser,base,fixtures,sessions,scene,size,theme){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Disposable local server only');
   const auth=scene.signup?{id:null,storageState:{cookies:[],origins:[]}}:sessions.get(scene.login+(scene.native?':native':'')),c=await browser.newContext({storageState:auth.storageState,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:'UTC'}),writes=[],pageErrors=[];
   try{
    const liftData=scene.lift?await(await c.request.get(base+'/api/activities/'+scene.lift+'/lifts')).json():null;
    await c.addInitScript(initialize,{root:size.root,native:!!scene.native,base,token:auth.token,id:auth.id,lift:scene.lift,liftData});
    await c.route('**/*',r=>{const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();if(scene.signup&&request.method()==='GET'&&u.pathname==='/api/signup')return r.fulfill({json:{open:true,full:false}});if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(request.method())){writes.push(u.pathname);return r.abort();}
     if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/__spacing_tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:'Demo tiles'}});
     if(u.pathname.startsWith('/__spacing_tiles/'))return r.fulfill({contentType:'image/png',body:tile});
     if(scene.recap&&u.pathname==='/api/recaps')return r.fulfill({json:fixtures.recaps.matrix.typical[u.searchParams.get('period')]});
     if(scene.notifications&&u.pathname==='/api/notifications/personal')return r.fulfill({json:{plan:true,weekly:true,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
     if(scene.notifications&&u.pathname==='/api/food/reminders')return r.fulfill({json:{enabled:true,tz:'UTC',push_ready:true,device_ready:true,times:['breakfast','lunch','dinner'].map(meal=>({meal,ready:true,time:'12:15'}))}});
     return r.continue();
    });
    const p=await c.newPage();p.on('pageerror',e=>pageErrors.push(e.message));if(scene.recap)await p.clock.setFixedTime(new Date(fixtures.recaps.now));
    await p.goto(base+scene.route);if(!scene.signup)await until(p,()=>typeof App!=='undefined'&&App.pageReady,'Page route settles');await p.locator(scene.entryReady||scene.ready).first().waitFor({state:'attached'});
    if(scene.modal){await modalState(p,scene.modal);await p.locator(scene.ready).first().waitFor({state:'attached'});}
    if(scene.notifications)await notificationState(p);
    if(scene.recap){await p.locator('#recap-entry').click();await until(p,()=>document.querySelector('#recap-preview')?.naturalWidth>0&&!document.querySelector('.recap-preview.busy'),'Recap picture ready');}
    await p.evaluate(()=>document.fonts.ready);
    return {c,p,auth,writes,pageErrors};
   }catch(error){await c.close();throw error;}
}
module.exports={until,settle,fixtureSessions,fixturePage};
