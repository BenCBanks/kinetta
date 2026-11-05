'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const user='zz_test_explore_new',password='green teapot on the hill';
async function login(context){const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:user,password}});assert.equal(response.status(),200,'fictional Explore account logs in');}
async function ready(page,selector){await page.waitForFunction(s=>App.pageReady&&!!document.querySelector(s),selector);}
async function fixtureContext(browser){return browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});}
async function filterRequests(page,explore){await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/static/explore.js')return explore(route);if(!['GET','HEAD'].includes(request.method()))return route.abort();return route.continue();});}
(async()=>{const browser=await chromium.launch();try{
  const context=await fixtureContext(browser);
  try{
    await login(context);const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests.push(route.request().url());return route.continue();});
    await page.goto(base+'/me');await ready(page,'#t-week');assert.equal(requests.length,0,'Explore is absent from the initial Me load');
    await page.goto(base+'/me/explore');await ready(page,'#guide-results details');assert.equal(requests.length,1,'cold direct links load Explore once');
    assert.equal(new URL(page.url()).pathname,'/me/explore');assert.deepEqual(await page.evaluate(()=>[typeof aiCan,typeof aiOffer,typeof kitChatOn]),['function','function','function'],'shared AI/Kit helpers stay eager');
    assert.deepEqual(errors,[],'Me and Explore load without browser errors');
  }finally{await context.close();}

  const retryContext=await fixtureContext(browser);
  try{
    await login(retryContext);const page=await retryContext.newPage(),errors=[];let requests=0;page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests++;return requests===1?route.abort():route.continue();});
    await page.goto(base+'/me/explore',{waitUntil:'domcontentloaded'});await page.locator('.lazy-route-error').waitFor();
    assert.equal(new URL(page.url()).pathname,'/me/explore','a failed bundle does not fall back to Me');assert(await page.locator('#lazy-route-retry').isVisible());
    await page.locator('#lazy-route-retry').click();await ready(page,'#guide-results details');assert.equal(requests,2,'retry clears the failed promise and requests the bundle again');assert.deepEqual(errors,[]);
  }finally{await retryContext.close();}

  const navigationContext=await fixtureContext(browser);
  try{
    await login(navigationContext);const page=await navigationContext.newPage(),errors=[];let requests=0;page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,async route=>{requests++;await new Promise(resolve=>setTimeout(resolve,700));return route.continue();});
    await page.goto(base+'/me');await ready(page,'#t-week');await page.locator('a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    await page.locator('nav.tabs a[data-tab="me"]').click();await ready(page,'#t-week');await page.waitForTimeout(900);
    assert.equal(requests,1);assert.equal(new URL(page.url()).pathname,'/me');assert.equal(await page.locator('#guide-results').count(),0,'a stale route cannot replace newer Me navigation');assert.deepEqual(errors,[]);
  }finally{await navigationContext.close();}
  console.log('Lazy route: eager Me, Explore deep link, retry after load failure, and stale navigation PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
