'use strict';
// Real owner/friend APIs and the real native push JavaScript with a bridge stand-in.
// Fictional data only; blocks device/provider calls and all UI writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest',password='green teapot on the hill';
const until=async(p,fn,label,arg)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);};
(async()=>{
 const output=cp.execFileSync('python3',[path.join(__dirname,'activity_detail_fixture.py')],{env:{...process.env,KINETTA_URL:base,KINETTA_PROJECT:project},encoding:'utf8'});
 const ids=JSON.parse(output.trim().split('\n').at(-1)),id=ids.run;
 cp.execFileSync('docker',['exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],{input:`INSERT INTO notifications(user_id,actor_id,kind,activity_id) SELECT user_id,user_id,'activity_ready',id FROM activities WHERE id=${Number(id)};`});
 const browser=await chromium.launch();let count=0;
 async function open(theme,size,{native=false,friend=false,pending=''}={}){
  const context=await browser.newContext({viewport:size,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_'+(friend?'friend':'owner'),password,app:native}});assert.equal(login.status(),200);
  const token=native?(await login.json()).token:null;if(native)await context.clearCookies();
  await context.addInitScript(({root,native,base,token,pending})=>{
   document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
   if(!native)return;
   let path=sessionStorage.getItem('fixture-push-consumed')?'':pending;const callbacks={};window.fixturePush=callbacks;
   window.fixtureOpenNotification=url=>{path=url;callbacks.notificationOpened?.();};
   window.Capacitor={isNativePlatform:()=>true,Plugins:{
    Preferences:{get:async({key})=>({value:key==='server'?base:key==='token'?token:null}),set:async()=>{},remove:async()=>{}},
    App:{getInfo:async()=>({version:'1.0',build:'999'}),addListener:async()=>({remove(){}})},
    KinettaDisplayPreferences:{getState:async()=>({reduceTransparency:false,increaseContrast:false}),addListener:async()=>({remove(){}})},
    KinettaPush:{status:async()=>({allowed:false}),addListener:(name,fn)=>callbacks[name]=fn,takePending:async()=>{const url=path;path='';if(url)sessionStorage.setItem('fixture-push-consumed','1');return {url,server:base};}},
   }};
  },{root:size.root,native,base,token,pending});
  const page=await context.newPage(),errors=[],writes=[],responses=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(new URL(r.url()).pathname===`/api/activities/${id}`)responses.push(r.status());});
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{unread:0}});}return route.continue();});
  return {context,page,errors,writes,responses};
 }
 try{
  for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const entry of ['direct','list','native']){
   const f=await open(theme,size,{native:entry==='native',pending:entry==='native'?`/activity/${id}?edit=1`:''}),p=f.page;
   try{
    await p.goto(base+(entry==='list'?'/notifications':entry==='native'?'/activity':`/activity/${id}?edit=1&tab=overview`));
    if(entry==='list'){const link=p.locator(`#nt-list a[href="/activity/${id}?edit=1"]`);await link.waitFor();assert.match(await link.innerText(),/run|Run/);await link.click();}
    const sheet=p.locator('.sheet[aria-label="Edit activity"]');await sheet.waitFor();await until(p,()=>App.pageReady,'Consumed address retains page readiness');
    assert.equal(await p.locator('#e-form input[name=name]').inputValue(),'Fictional run session');
    assert.equal(await p.evaluate(()=>new URLSearchParams(location.search).has('edit')),false);assert.equal(new URL(p.url()).pathname,`/activity/${id}`);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    for(const control of await sheet.locator('header button').all()){const box=await control.boundingBox();assert(box.width>=44&&box.height>=44&&box.x>=0&&box.x+box.width<=size.width+1,'Visible44px editor actions');}
    assert(await sheet.locator('header').evaluate(header=>{const [cancel,save]=header.querySelectorAll('button'),title=header.querySelector('h2'),a=cancel.getBoundingClientRect(),b=save.getBoundingClientRect(),t=title.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(title);const ink=range.getBoundingClientRect();return a.right+7<=t.left&&t.right+7<=b.left&&ink.left>=t.left-1&&ink.right<=t.right+1;}),'Title and actions do not overlap at enlarged text');
    assert(await p.locator('#e-form input[name=name]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
    if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.SHOT_DIR,`${entry}-${size.width}-${theme}.png`)});}
    await sheet.locator('header button[data-close]').click();await until(p,()=>!document.querySelector('.sheet'),'Close editor');assert(await p.locator('.compact-detail-title').isVisible());
    await p.reload();await until(p,()=>App.pageReady&&!!document.querySelector('.compact-detail-title'),'Detail reload');assert.equal(await p.locator('#e-form').count(),0,'Reload does not reopen consumed edit');
    assert.deepEqual(f.errors,[]);assert(f.writes.every(url=>['/api/notifications/read','/api/challenges/signup/continue'].includes(url)),'No editor save/device/push write: '+JSON.stringify(f.writes));count++;
   }finally{await f.context.close();}
  }
  for(const theme of ['light','dark'])for(const shared of [false,true]){
   const f=await open(theme,{width:390,height:844,root:16},{friend:true});
   try{
    await f.page.goto(base+`/activity/${shared?'friends/':''}${id}?edit=1`);await until(f.page,()=>App.pageReady,'Friend/missing page ready');
    if(shared)assert(await f.page.locator('.detail-owner').isVisible());else assert(f.responses.includes(404),'Own-only endpoint rejects another person’s ID');
    assert.equal(await f.page.locator('#e-form,[data-detail-edit]').count(),0);assert.deepEqual(f.errors,[]);count++;
   }finally{await f.context.close();}
  }
  for(const theme of ['light','dark']){
   const f=await open(theme,{width:390,height:844,root:16});let release,seen=false;
   try{
    await f.context.route(`**/api/activities/${id}`,async route=>{seen=true;await new Promise(r=>release=r);await route.continue();});
    await f.page.goto(base+`/activity/${id}?edit=1`,{waitUntil:'domcontentloaded'});await until(f.page,()=>!!App.me,'Signed in');for(let n=0;n<100&&!seen;n++)await f.page.waitForTimeout(50);assert(seen);
    await f.page.evaluate(()=>go('/me'));release();await until(f.page,()=>App.pageReady&&location.pathname==='/me','New view ready');
    await f.page.waitForTimeout(200);assert.equal(await f.page.locator('#e-form').count(),0,'Late result does not open editor over another view');assert.deepEqual(f.errors,[]);count++;
   }finally{if(release)release();await f.context.close();}
  }
  for(const theme of ['light','dark']){
   const f=await open(theme,{width:390,height:844,root:16},{native:true,pending:`/activity/${id}?edit=1`}),p=f.page;
   try{
    await p.goto(base+'/activity');await p.locator('#e-form').waitFor();await until(p,()=>App.pageReady,'First editor ready');
    await p.locator('#e-form input[name=name]').fill('Keep my current draft');p.once('dialog',dialog=>dialog.dismiss());
    await p.evaluate(async url=>{fixtureOpenNotification(url);await Native.pushNavigationReady;},`/activity/${ids.treadmill}?edit=1`);
    assert.equal(await p.locator('#e-form').count(),1);assert.equal(await p.locator('#e-form input[name=name]').inputValue(),'Keep my current draft');assert.equal(new URL(p.url()).pathname,`/activity/${id}`);
    p.once('dialog',dialog=>dialog.accept());await p.evaluate(async url=>{fixtureOpenNotification(url);await Native.pushNavigationReady;},`/activity/${ids.treadmill}?edit=1`);
    await until(p,()=>document.querySelector('#e-form input[name=name]')?.value==='Fictional treadmill session','Confirmed replacement editor');
    assert.equal(await p.locator('#e-form').count(),1);assert(await p.locator('.sheet button[form="e-form"]').evaluate(button=>button.form===button.closest('.sheet').querySelector('#e-form')),'Save targets its own single form');
    assert.deepEqual(f.errors,[]);count++;
   }finally{await f.context.close();}
  }
  for(const theme of ['light','dark']){
   const f=await open(theme,{width:390,height:844,root:16}),p=f.page;let release;
   try{
    await p.goto(base+`/activity/${id}`);await until(p,()=>App.pageReady,'Warm detail cache');await p.evaluate(id=>App.cache.get('/api/activities/'+id).at=0,id);
    await f.context.route(`**/api/activities/${id}`,async route=>{await new Promise(r=>release=r);await route.continue();});
    await p.evaluate(url=>{go(url);},`/activity/${id}?edit=1`);await p.locator('#e-form').waitFor();
    await p.locator('.sheet header button[data-close]').click();await until(p,()=>!document.querySelector('.sheet'),'Close cached editor');
    await p.locator('[data-dt=overview]').click();for(let n=0;n<100&&!release;n++)await p.waitForTimeout(50);assert(release);release();
    await until(p,()=>App.pageReady,'Cached refresh and changed tab retain readiness');assert.equal(await p.locator('#e-form').count(),0);assert.equal(await p.locator('[data-dt=overview]').getAttribute('aria-selected'),'true');
    assert(await p.evaluate(()=>App.page.key===location.pathname+location.search));assert.deepEqual(f.errors,[]);count++;
   }finally{if(release)release();await f.context.close();}
  }
  console.log(`Notification Edit rendered: ${count} web/direct/list/native-bridge, close/reload, other-owner/shared and late-view cases PASS`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
