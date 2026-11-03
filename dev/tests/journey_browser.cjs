// Mutation mode is available only after the independent Docker/checkout boundary passes.
'use strict';
const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const {until,settle,fixtureSessions}=require('./ui_fixture_browser.cjs');
const trackSession=require('../demo/track_session.cjs');
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function boundary(){cp.execFileSync('python3',[path.join(__dirname,'journeys_guard.py')],{env:process.env,stdio:'inherit'});}
function initialize({base,token,native,seed}){
 const goTargets=[];window.journeyGoTargets=goTargets;
 document.addEventListener('DOMContentLoaded',()=>{if(typeof go==='function'){const original=go;go=(url,...args)=>{const target=new URL(String(url),location.href);goTargets.push(target.origin===location.origin?target.pathname+target.search+target.hash:target.href);return original(url,...args);};}});
 Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>1,clearWatch:()=>{},getCurrentPosition:()=>{}}});
 if(!native)return;
 const preferences={server:base,token};let session=null;
 const snapshot=()=>({session:session?structuredClone(session):null,lapSupport:1,routePlanSupport:1});
 window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:name=>['Preferences','App','KinettaTrack','KinettaDisplayPreferences'].includes(name),Plugins:{
  Preferences:{get:async({key})=>({value:preferences[key]??null}),set:async({key,value})=>{preferences[key]=value;},remove:async({key})=>{delete preferences[key];}},
  App:{getInfo:async()=>({version:'1.0',build:'999'}),addListener:async()=>({remove(){}})},
  KinettaDisplayPreferences:{getState:async()=>({reduceTransparency:false,increaseContrast:false}),addListener:async()=>({remove(){}})},
  KinettaTrack:{attach:async()=>snapshot(),detach:async()=>({}),status:async()=>snapshot(),intervalCapabilities:async()=>({intervalCapabilities:{outdoor:true}}),
   locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:5,timestamp:Date.now()}),
   start:async args=>{session={...structuredClone(seed),id:args.id,sport:args.sport,label:args.label,native:true,state:'recording',activeSeconds:seed.activeMs/1000,elapsedSeconds:(Date.now()-seed.start)/1000,pointOffset:0,autoPausedNow:false};return snapshot();},
   pause:async()=>{session.state='paused';return snapshot();},finish:async()=>{session.state='review';return snapshot();},clear:async()=>{session=null;return snapshot();}}
 }};
}
async function context(browser,base,fixtures,sessions,test,theme='light'){
 const auth=sessions.get(test.login+(test.native?':native':''));assert(auth,'Fictional login exists');
 const c=await browser.newContext({storageState:auth.storageState,viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});
 await c.addInitScript(initialize,{base,token:auth.token,native:!!test.native,seed:trackSession('recording')});
 const errors=[],httpErrors=[],writes=[];let current=test,saved=null;
 await c.route('**/*',async route=>{
  const q=route.request(),u=new URL(q.url()),method=q.method();
  if(u.origin!==base)return route.abort();
  if(u.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/__journey_tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:'Fictional demo tiles'}});
  if(u.pathname.startsWith('/__journey_tiles/'))return route.fulfill({contentType:'image/png',body:tile});
  if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{}});
  if(current.id?.startsWith('notification-')&&u.pathname==='/api/notifications')return route.fulfill({json:{items:fixtures.journey.notifications,unread:0,push:{},push_ready:false}});
  if(current.kit&&u.pathname==='/api/me'){
   const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,kit_chat:true,ai_ok:true,ai_paused:false,coach:true,ai_access:{...me.ai_access,coach:{available:true,entitled:true}}}});
  }
  if(current.kit&&u.pathname.startsWith('/api/coach/conversation')){
   const allowed=u.pathname==='/api/coach/conversation'||u.pathname==='/api/coach/conversation/visits'||/^\/api\/coach\/conversation\/visits\/[^/]+\/end$/.test(u.pathname);
   assert(allowed,'Journey never sends a question or changes memory');
   return route.fulfill({json:{messages:[],before:null,ready:true,generation:'fictional-journey'}});
  }
  if(!['GET','HEAD'].includes(method)){
   if(current.action==='record'&&method==='POST'&&u.pathname==='/api/activities/track'){
    writes.push(u.pathname);const response=await route.fetch();assert.equal(response.status(),200,await response.text());saved=(await response.json()).id;return route.fulfill({response});
   }
   if(current.action==='uncertainSave'&&u.pathname==='/api/activities/track')return route.fulfill({status:503,json:{detail:'Fictional unconfirmed save stand-in'}});
   if(current.action==='food'&&method==='POST'&&/^\/api\/food\/thread\/(?:messages(?:\/\d+\/process)?|reviews(?:\/\d+\/confirm)?)$/.test(u.pathname)){writes.push(u.pathname);return route.continue();}
   // Optional usage/read markers are deliberately not persisted during navigation checks.
   if(['/api/notifications/read','/api/features/usage'].includes(u.pathname))return route.fulfill({json:{unread:0}});
   return route.fulfill({json:{}});
  }
  return route.continue();
 });
 const p=await c.newPage();p.setDefaultTimeout(8000);p.on('pageerror',error=>errors.push(error.message));
 p.on('response',response=>{const u=new URL(response.url());if(u.pathname.startsWith('/api/')&&response.status()>=400&&!(current.action==='uncertainSave'&&u.pathname==='/api/activities/track'&&response.status()===503))httpErrors.push({path:u.pathname,status:response.status()});});
 return {c,p,auth,errors,httpErrors,writes,get saved(){return saved;},test(value){current=value;errors.length=0;httpErrors.length=0;writes.length=0;}};
}
async function ready(p){await until(p,()=>typeof App!=='undefined'&&App.pageReady&&!document.querySelector('#page[data-home-loading]'),'Journey page ready');}
async function visibleTitles(p,selector='#page h1,.profile-page-title,.me-card-editor h2,.scrim:not([inert]) .sheet h2'){return p.locator(selector).filter({visible:true}).allTextContents();}
async function closeSheets(p){
 while(await p.locator('.scrim:not([inert]):visible').count()){
  const sheet=p.locator('.scrim:not([inert]):visible').last(),handle=await sheet.elementHandle();
  await sheet.locator('header [data-close]').click();await handle.waitForElementState('hidden');await handle.dispose();
 }
}
async function assertDestination(p,expected,values={}){
 const url=expected.url.replace('{saved}',String(values.saved)).replace('{day}',String(values.day));
 await p.waitForURL(actual=>actual.pathname+actual.search===url);await ready(p);
 await p.locator(expected.ready).first().waitFor({state:'visible'});
 const titles=expected.titleValue?[await p.locator(expected.titleSelector).filter({visible:true}).inputValue()]:await visibleTitles(p,expected.titleSelector);
 assert(titles.some(title=>title.toLowerCase().includes(expected.title.toLowerCase())),`Expected title ${expected.title} at ${url}; saw ${titles.join(' / ')}`);
 if(expected.text)assert.equal(await p.locator(expected.ready).first().innerText(),expected.text,'The intended original activity is present');
 assert(await p.evaluate(()=>App.pages.some(page=>page.re.test(location.pathname))),'Destination must be registered, never the unknown-route fallback');
}
module.exports={boundary,context,fixtureSessions,ready,assertDestination,visibleTitles,closeSheets,until,settle};
