'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const password='green teapot on the hill';
const user='zz_test_explore_new';
const meReady='.me-card-sections[aria-busy="false"]';
async function login(context,loginName=user){const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:loginName,password}});assert.equal(response.status(),200,`fictional Explore account ${loginName} logs in`);}
async function until(page,predicate,label,arg){
  for(let i=0;i<150;i++){
    try{if(await page.evaluate(predicate,arg))return;}catch(_){/* navigation can replace the document between polls */}
    await page.waitForTimeout(100);
  }
  const diagnostics=await page.evaluate(()=>{
    let ready=null;try{ready=App.pageReady;}catch(_){}
    return {path:location.pathname,pageReady:ready,pageText:document.querySelector('#page')?.textContent?.trim().slice(0,180)||'',bodyText:document.body?.textContent?.trim().slice(0,240)||''};
  }).catch(error=>({diagnosticError:error.message}));
  throw new Error(`Timed out: ${label}; diagnostics=${JSON.stringify(diagnostics)}`);
}
async function ready(page,selector,label=`page ready with ${selector}`){await until(page,s=>{try{return App.pageReady&&!!document.querySelector(s);}catch(_){return false;}},label,selector);}
async function fixtureContext(browser){return browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});}
async function filterRequests(page,explore){await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/static/explore.js')return explore(route);if(!['GET','HEAD'].includes(request.method()))return route.abort();return route.continue();});}
async function holdExplore(page,{instrument=false}={}){
  let openGate,finishRequest;
  const gate=new Promise(resolve=>{openGate=resolve;}),done=new Promise(resolve=>{finishRequest=resolve;});
  let requests=0;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/static/explore.js'){
      requests++;
      if(instrument){
        const response=await route.fetch(),body=await response.text();await gate;
        const probe='\n;(()=>{const entry=App.pages.find(page=>page.re.test("/me/explore"));const original=entry.fn;entry.fn=(...args)=>{window.testExploreOwners.push(App.me.login);return original(...args);};})();';
        await route.fulfill({response,body:body+probe});
      }else{await gate;await route.continue();}
      finishRequest();return;
    }
    if(!['GET','HEAD'].includes(request.method()))return route.abort();
    return route.continue();
  });
  return {release:openGate,count:()=>requests,done};
}
const notificationItems=[
  {id:1,kind:'monthly_summary',period_type:'month',period:'2026-10',text:'Your October summary is ready',detail:'Fictional month',link:'/notifications?summary=2026-10',created:'2026-10-31T12:00:00Z',read:true,who:{name:'Kinetta'}},
  {id:2,kind:'monthly_summary',period_type:'year',period:'2025',text:'Your 2025 summary is ready',detail:'Fictional year',link:'/notifications?year=2025',created:'2026-01-01T12:00:00Z',read:true,who:{name:'Kinetta'}},
];
async function notificationRoutes(context,{failFirst=false,hold=false,recordOwner=false}={}){
  const scriptRequests=[],writes=[],apiOwners=[];let attempts=0,releaseHeld,finishHeld,heldOnce=false;
  const held=new Promise(resolve=>{releaseHeld=resolve;}),done=new Promise(resolve=>{finishHeld=resolve;});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/static/social-notifications.js'){
      attempts++;scriptRequests.push(url.href);
      if(failFirst&&attempts===1)return route.abort();
      const response=await route.fetch(),source=await response.text();
      if(hold&&!heldOnce){heldOnce=true;await held;}
      const ownerProbe=recordOwner?`(()=>{const page=App.pages.find(item=>item.re.test('/me/notifications')),original=page.fn;page.fn=(...args)=>{window.__notificationRouteOwners.push(App.me.login);return original(...args);};})();`:'';
      await route.fulfill({response,body:source+`\n;window.__notificationSummaryCalls=[];window.__notificationRouteOwners=[];Recaps.open=options=>window.__notificationSummaryCalls.push(options);${ownerProbe}\n`});
      if(hold)finishHeld();
      return;
    }
    if(url.pathname==='/api/notifications'&&request.method()==='GET'){
      apiOwners.push(request.headers()['x-kinetta-account']||'');
      return route.fulfill({json:{items:notificationItems,unread:0,push:{},push_ready:true}});
    }
    if(url.pathname==='/api/notifications/count'&&request.method()==='GET')return route.fulfill({json:{unread:3,friend_requests:0}});
    if(url.pathname==='/api/challenges/signup/continue'&&request.method()==='POST')return route.fulfill({json:{}});
    if(url.pathname==='/api/notifications/personal')return route.fulfill({json:{plan:false,weekly:false,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
    if(url.pathname==='/api/food/reminders')return route.fulfill({json:{enabled:false,tz:'UTC',push_ready:true,device_ready:true,times:[]}});
    if(url.pathname==='/api/account/signin-email')return route.fulfill({json:{on:false}});
    if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:204,body:''});}
    return route.continue();
  });
  return {scriptRequests,writes,apiOwners,release:releaseHeld,done};
}
async function notificationFixture(browser,loginName=user,options={}){
  const context=await fixtureContext(browser);await login(context,loginName);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const routes=await notificationRoutes(context,options);return {context,page,errors,routes};
}
(async()=>{const browser=await chromium.launch();try{
  const context=await fixtureContext(browser);
  try{
    await login(context);const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests.push(route.request().url());return route.continue();});
    await page.goto(base+'/me');await ready(page,meReady);assert.equal(requests.length,0,'Explore is absent from the initial Me load');
    await page.goto(base+'/me/explore');await ready(page,'#guide-results details','cold direct Explore route');assert.equal(requests.length,1,'cold direct links load Explore once');
    const lazyURL=new URL(requests[0]);assert.match(lazyURL.searchParams.get('v')||'',/^[0-9a-f]{32}$/,'the deferred bundle has its own build-stamped URL');
    assert.equal(new URL(page.url()).pathname,'/me/explore');assert.deepEqual(await page.evaluate(()=>[typeof aiCan,typeof aiOffer,typeof kitChatOn]),['function','function','function'],'shared AI/Kit helpers stay eager');
    assert.deepEqual(errors,[],'Me and Explore load without browser errors');
  }finally{await context.close();}

  const retryContext=await fixtureContext(browser);
  try{
    await login(retryContext);const page=await retryContext.newPage(),errors=[];let requests=0;page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests++;return requests===1?route.abort():route.continue();});
    await page.goto(base+'/me/explore',{waitUntil:'domcontentloaded'});await page.locator('.lazy-route-error').waitFor();
    assert.equal(new URL(page.url()).pathname,'/me/explore','a failed bundle does not fall back to Me');assert(await page.locator('#lazy-route-retry').isVisible());
    await page.locator('#lazy-route-retry').click();await ready(page,'#guide-results details','Explore after explicit retry');assert.equal(requests,2,'retry clears the failed promise and requests the bundle again');assert.deepEqual(errors,[]);
  }finally{await retryContext.close();}

  const scrollContext=await fixtureContext(browser);
  try{
    await login(scrollContext);const page=await scrollContext.newPage();
    await page.goto(base+'/me');await ready(page,meReady);
    await page.evaluate(()=>{App.scroll['/me/explore']=120;});
    await page.locator('a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    await ready(page,'#guide-results details','deferred Explore with saved scroll');
    assert.equal(await page.evaluate(()=>scrollY),120,'the deferred render restores the saved route position once');
  }finally{await scrollContext.close();}

  const navigationContext=await fixtureContext(browser);
  try{
    await login(navigationContext);const page=await navigationContext.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdExplore(page);
    await page.goto(base+'/me');await ready(page,meReady);
    await page.evaluate(()=>{
      const old=document.querySelector('#page');window.delayedOldPage=old;window.delayedOldPageCleaned=false;
      viewResources.set(old,()=>{window.delayedOldPageCleaned=true;});
      window.finishDelayedOldPage=()=>{if(old.isConnected)old.innerHTML='<p id="stale-old-page">Late former page response</p>';};
    });
    await page.locator('a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.delayedOldPage.isConnected,window.delayedOldPageCleaned]),[false,true],'the prior main is unmounted through normal view cleanup before the bundle wait');
    await page.evaluate(()=>window.finishDelayedOldPage());
    assert.equal(await page.locator('#stale-old-page').count(),0,'a delayed former-page response cannot write into the loading shell');
    assert(await page.locator('.lazy-route-loading').isVisible());
    await page.locator('nav.tabs a[data-tab="me"]').click();await ready(page,meReady,'new Me route while Explore is pending');
    const finished=page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/static/explore.js');delayed.release();await finished;await delayed.done;await page.waitForTimeout(100);
    assert.equal(delayed.count(),1);assert.equal(new URL(page.url()).pathname,'/me');assert.equal(await page.locator('#guide-results').count(),0,'a stale route cannot replace newer Me navigation');assert.deepEqual(errors,[]);
  }finally{await navigationContext.close();}

  const accountContext=await fixtureContext(browser);
  try{
    await login(accountContext);const page=await accountContext.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdExplore(page,{instrument:true});
    await page.goto(base+'/me');await ready(page,meReady);
    await page.evaluate(()=>{
      window.testExploreOwners=[];window.testDeferredPositions=[];
      const original=render;
      window.render=options=>{
        if(options?.routePosition)window.testDeferredPositions.push(options.routePosition.owner===readOwner());
        return original(options);
      };
    });
    await page.locator('a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    await login(accountContext,'zz_test_explore_typical');
    const meResponse=await accountContext.request.get(base+'/api/me');assert.equal(meResponse.status(),200,'second fictional account profile loads');
    await page.evaluate(me=>refreshMe(me),await meResponse.json());
    await until(page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new account owns the pending Explore shell');
    delayed.release();await delayed.done;await ready(page,'#guide-results details','Explore after account change');
    assert.deepEqual(await page.evaluate(()=>window.testDeferredPositions),[true],'only the current account’s deferred continuation reaches render');
    assert.deepEqual(await page.evaluate(()=>window.testExploreOwners),['zz_test_explore_typical'],'Explore mounts for the current fictional account');
    assert.equal(new URL(page.url()).pathname,'/me/explore');assert.deepEqual(errors,[]);
  }finally{await accountContext.close();}

  // The two notification routes stay absent from the opening Me bundle and share one lazy asset.
  const normal=await notificationFixture(browser);
  try{
    await normal.page.goto(base+'/activity');await ready(normal.page,'#feed-tools');
    assert.equal(normal.routes.scriptRequests.length,0,'notification code is absent from the initial Activity/Me shell');
    assert.deepEqual(await normal.page.evaluate(()=>[typeof Social.badge,typeof noteRow,App.pageReady]),['function','undefined',true],'badge stays eager while notification rows are deferred');
    await normal.page.waitForFunction(()=>App.me.notifications===3);
    await normal.page.evaluate(()=>Social.badge());
    assert.equal(await normal.page.locator('.bell').getAttribute('aria-label'),'Notifications, 3 new','the eager bell still reflects the Social badge');
    await normal.page.locator('.bell').click();await ready(normal.page,'#nt-list','normal bell opens the lazy notification list');
    assert.equal(normal.routes.scriptRequests.length,1,'the bell route loads the bundle once');
    assert.match(new URL(normal.routes.scriptRequests[0]).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'the lazy notification asset has its own content hash');
    assert.equal(await normal.page.locator('[data-summary-type="month"]').count(),1);assert.equal(await normal.page.locator('[data-summary-type="year"]').count(),1);
    await normal.page.locator('[data-summary-type="month"]').click();
    assert.deepEqual(await normal.page.evaluate(()=>window.__notificationSummaryCalls.at(-1)),{period:'month',offset:1},'the month row opens its exact period');
    await normal.page.locator('[data-summary-type="year"]').click();
    assert.deepEqual(await normal.page.evaluate(()=>window.__notificationSummaryCalls.at(-1)),{period:'year',offset:1},'the year row opens its exact period');
    await normal.page.evaluate(()=>go('/me/settings'));await ready(normal.page,'a[href="/me/notifications"]','Settings route');
    await normal.page.locator('a[href="/me/notifications"]').click();await normal.page.locator('[data-meal-reminders]').waitFor();
    assert.equal(normal.routes.scriptRequests.length,1,'Settings reuses the already loaded notification bundle');
    assert.deepEqual(normal.errors,[]);assert.deepEqual(normal.routes.writes,[]);
  }finally{await normal.context.close();}

  for(const [path,selector] of [['/notifications','#nt-list'],['/me/notifications','#nt-push']]){
    const direct=await notificationFixture(browser);
    try{
      await direct.page.goto(base+path);await ready(direct.page,selector,`cold direct ${path}`);
      assert.equal(direct.routes.scriptRequests.length,1,`${path} loads the deferred module once`);
      assert.deepEqual(direct.errors,[]);assert.deepEqual(direct.routes.writes,[]);
    }finally{await direct.context.close();}
  }

  for(const [query,period] of [['?summary=2026-10','month'],['?year=2025','year']]){
    const direct=await notificationFixture(browser);
    try{
      await direct.page.goto(base+'/notifications'+query);await ready(direct.page,'#nt-list',`cold summary link ${query}`);
      const call=await direct.page.evaluate(()=>window.__notificationSummaryCalls[0]);
      assert.equal(call?.period,period,`${query} opens the requested summary through the deferred route`);
      assert.equal(call?.offset,period==='month'?1:1,`${query} keeps its summary period`);
      assert.deepEqual(direct.errors,[]);
    }finally{await direct.context.close();}
  }

  const retry=await notificationFixture(browser,user,{failFirst:true});
  try{
    await retry.page.goto(base+'/notifications',{waitUntil:'domcontentloaded'});await retry.page.locator('.lazy-route-error').waitFor();
    assert.equal(retry.routes.scriptRequests.length,1);await retry.page.locator('#lazy-route-retry').click();
    await ready(retry.page,'#nt-list','notification list after explicit retry');assert.equal(retry.routes.scriptRequests.length,2,'failed notification bundle is requested again');
    assert.deepEqual(retry.errors,[]);assert.deepEqual(retry.routes.writes,[]);
  }finally{await retry.context.close();}

  const stalePath=await notificationFixture(browser,user,{hold:true});
  try{
    await stalePath.page.goto(base+'/notifications',{waitUntil:'domcontentloaded'});await stalePath.page.locator('.lazy-route-loading').waitFor();
    await stalePath.page.locator('nav.tabs a[data-tab="me"]').click();await ready(stalePath.page,meReady,'Me while notifications are loading');
    stalePath.routes.release();await stalePath.routes.done;await stalePath.page.waitForTimeout(100);
    assert.equal(new URL(stalePath.page.url()).pathname,'/me');assert.equal(await stalePath.page.locator('#nt-list').count(),0,'a late notification bundle cannot replace newer navigation');
    assert.deepEqual(stalePath.errors,[]);
  }finally{stalePath.routes.release();await stalePath.context.close();}

  const staleOwner=await notificationFixture(browser,user,{hold:true,recordOwner:true});
  try{
    await staleOwner.page.goto(base+'/me/notifications',{waitUntil:'domcontentloaded'});await staleOwner.page.locator('.lazy-route-loading').waitFor();
    await login(staleOwner.context,'zz_test_explore_typical');
    const meResponse=await staleOwner.context.request.get(base+'/api/me');assert.equal(meResponse.status(),200);
    const me=await meResponse.json();await staleOwner.page.evaluate(profile=>refreshMe(profile),me);
    await until(staleOwner.page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new account owns the pending notification shell');
    staleOwner.routes.release();await staleOwner.routes.done;await staleOwner.page.locator('[data-meal-reminders]').waitFor();
    assert.deepEqual(await staleOwner.page.evaluate(()=>window.__notificationRouteOwners),['zz_test_explore_typical'],'the deferred settings route mounts only for the current fictional owner');
    assert(staleOwner.routes.apiOwners.length>=1&&staleOwner.routes.apiOwners.every(id=>id===String(me.id)),'notification data is requested for the current owner only');
    assert.deepEqual(staleOwner.errors,[]);assert.deepEqual(staleOwner.routes.writes,[]);
  }finally{staleOwner.routes.release();await staleOwner.context.close();}

  console.log('Lazy route: own asset hash, direct link, retry, one-time scroll, old-page cleanup, pending navigation and account guard PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
