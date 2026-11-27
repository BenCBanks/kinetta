'use strict';
const assert=require('node:assert/strict');
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};

// Exercise the shipped API/route/native lifecycle, with held fictional replies.
// Never contact a bridge/device/provider or write personal data.
module.exports=async function routeReadSafety(browser,base){
 const password='green teapot on the hill';
 const feed=url=>['/api/activities','/api/feed/friends'].includes(url.pathname)&&url.searchParams.get('limit')==='15';
 async function fixture({native=false,holdMe=false,unauthorized=false,failRead=false,holdReads=false,ignoreAbort=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_explore_new',password,app:native}});
  assert.equal(signed.status(),200);
  const token=(await signed.json()).token;
  if(native)await context.addInitScript(({base,token})=>{
   const prefs={server:base,token};
   window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'ios',Plugins:{Preferences:{
    get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}
   }}};
  },{base,token});
  if(ignoreAbort)await context.addInitScript(()=>{
   const original=window.fetch;
   window.fetch=(url,options)=>/\/api\/(?:activities|feed\/friends)\?/.test(String(url))
    ?original(url,{...options,signal:undefined}):original(url,options);
  });
  const page=await context.newPage(),meGate=deferred(),cssGate=deferred(),readsGate=deferred(),requests=[],errors=[];
  let meRequests=0,cssRequests=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/me'){
    meRequests++;
    if(holdMe)await meGate.promise;
    if(unauthorized)return route.fulfill({status:401,json:{detail:'Please log in'}});
   }
   if(url.pathname==='/static/route-screens.css'){cssRequests++;await cssGate.promise;}
   if(feed(url)){
    requests.push({path:url.pathname,headers:request.headers()});
    if(holdReads)await readsGate.promise;
    if(failRead==='offline')return route.abort('internetdisconnected');
    if(failRead==='401')return route.fulfill({status:401,json:{detail:'Please log in'}});
    // Deliberately recognizable stale data; it must never enter a new owner's cache/DOM.
    return route.fulfill({json:[{id:987654321,name:'Previous account sentinel'}]});
   }
   if(!['GET','HEAD'].includes(request.method()))return route.fulfill({status:204});
   return route.continue();
  });
  await page.goto(base+'/activity',{waitUntil:'domcontentloaded'});
  return {context,page,requests,errors,token,meGate,cssGate,readsGate,meRequests:()=>meRequests,cssRequests:()=>cssRequests,
   close:async()=>{meGate.release();cssGate.release();readsGate.release();await context.close();}};
 }
 async function started(f,expected=2){
  await f.page.waitForFunction(()=>earlyRouteReads.size===2);
  // Map entries are created before Playwright dispatches their network callbacks.
  // Observe both actual requests before checking count and owner headers.
  const until=Date.now()+5000;
  while(f.requests.length<expected&&Date.now()<until)await f.page.waitForTimeout(20);
  assert.equal(f.requests.length,expected,'both early reads reach the routing fixture');
 }
 async function empty(f){await f.page.waitForFunction(()=>earlyRouteReads.size===0&&routeReadJobs.size===0);}

 // No GET before the fresh server identity returns, on web and native bearer auth.
 for(const native of [false,true]){
  const f=await fixture({native,holdMe:true,holdReads:true});
  try{
   await f.page.waitForFunction(()=>typeof startRouteReads==='function');
   await f.page.evaluate(()=>startRouteReads('/activity',readOwner(),()=>true));
   assert.equal(await f.page.evaluate(()=>routeReadJobs.size),0,'unconfirmed session schedules no early read jobs');
   assert.equal(f.requests.length,0,'unconfirmed session cannot start early reads');
   assert.equal(await f.page.evaluate(()=>confirmedRouteOwner),null);
   f.meGate.release();await started(f);
   const id=await f.page.evaluate(()=>String(App.me.id));
   await f.page.evaluate(()=>refreshMe({...App.me}));
   assert.equal(await f.page.evaluate(()=>routeReadJobs.size),2,'same-session profile refresh preserves valid reads');
   for(const request of f.requests){
    assert.equal(request.headers['x-kinetta-account'],id,'every early read carries the confirmed owner');
    assert.equal(request.headers.authorization,native?'Bearer '+f.token:undefined,'native bearer stays on its server');
   }
  }finally{await f.close();}
 }
 const denied=await fixture({unauthorized:true});
 try{
  await denied.page.locator('#page').waitFor({state:'detached'});
  await denied.page.locator('.first-run-welcome, .login').first().waitFor();
  assert.equal(denied.requests.length,0,'401 bootstrap never starts feed reads');
  await denied.page.evaluate(()=>{App.me={id:999999,login:'fictional-saved-profile'};startRouteReads('/activity',readOwner(),()=>true);});
  assert.equal(denied.requests.length,0,'a saved profile alone cannot admit speculative reads');
 }finally{await denied.close();}

 for(const boundary of ['signout','switch','401','offline-event','offline-response','native-forget','native-token','native-signin']){
  const f=await fixture({native:boundary.startsWith('native'),holdReads:true,ignoreAbort:['switch','offline-event'].includes(boundary),failRead:boundary==='401'?'401':boundary==='offline-response'?'offline':false});
  try{
   await started(f);
   const oldOwner=await f.page.evaluate(()=>readOwner());
   // Keep references even after the map is cleared, proving ignored-abort late
   // responses reject rather than merely disappearing from the lookup table.
   await f.page.evaluate(()=>{window.__earlyResults=Promise.allSettled([api('/api/activities?limit=15'),...earlyRouteReads.values()].map(entry=>entry.promise||entry));});
   if(boundary==='signout')await f.page.evaluate(()=>{forgetKept();App.me=null;showLogin();});
   if(boundary==='switch'){
    assert.equal((await f.context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_explore_typical',password}})).status(),200);
    const me=await (await f.context.request.get(base+'/api/me?refresh=1')).json();
    await f.page.evaluate(me=>{history.replaceState(null,'','/me');refreshMe(me);},me);
   }
   if(boundary==='offline-event')await f.page.evaluate(()=>dispatchEvent(new Event('offline')));
   if(boundary==='native-signin')await f.page.evaluate(base=>{Native.disconnectHealth=()=>new Promise(()=>{});Native.login(base,'zz_test_explore_new','green teapot on the hill').catch(()=>{});},base);
   if(boundary==='native-forget')await f.page.evaluate(()=>Native.forget());
   if(boundary==='native-token')await f.page.evaluate(()=>{Native.token='fictional-replacement-token';readOwner();});
   f.readsGate.release();await empty(f);
   const results=await f.page.evaluate(()=>window.__earlyResults.then(results=>results.map(r=>({status:r.status,stale:r.reason?.stale}))));
   assert.ok(results.every(r=>r.status==='rejected'),`${boundary} discards all outstanding early results`);
   assert.equal(await f.page.evaluate(()=>JSON.stringify([...App.cache.values()]).includes('Previous account sentinel')),false);
   assert.equal(await f.page.locator('body').innerText().then(text=>text.includes('Previous account sentinel')),false);
   if(boundary==='401')assert.equal(await f.page.evaluate(()=>App.me),null,'401 ends the confirmed session');
   if(boundary==='offline-event'){const before=f.requests.length;await f.page.evaluate(()=>startRouteReads('/activity',readOwner(),()=>true));assert.equal(f.requests.length,before,'offline does not start another speculative read');}
   if(['signout','401','native-forget','native-token','native-signin'].includes(boundary))assert.equal(await f.page.evaluate(()=>confirmedRouteOwner),null);
   if(boundary==='switch'){
    assert.notEqual(await f.page.evaluate(()=>readOwner()),oldOwner);
    const before=f.requests.length;
    await f.page.evaluate(()=>startRouteReads('/activity',readOwner(),()=>true));
    await started(f,before+2);
    assert.equal(f.requests.at(-1).headers['x-kinetta-account'],await f.page.evaluate(()=>String(App.me.id)));
   }
   assert.deepEqual(f.errors,[],`${boundary}: no unhandled errors`);
  }finally{await f.close();}
 }
 console.log('Early route reads: confirmed owner, web/native auth, signout/switch late replies, 401/offline/bridge discard PASS');
};
