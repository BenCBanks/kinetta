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
  console.log('Lazy route: own asset hash, direct link, retry, one-time scroll, old-page cleanup, pending navigation and account guard PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
