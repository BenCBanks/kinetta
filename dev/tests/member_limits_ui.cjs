'use strict';
// Fictional comments, intercepted responses and native-bridge stand-ins only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initialize}=require('./spacing_screens.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_MEMBER_LIMIT_SHOTS;
(async()=>{
 const browser=await chromium.launch();
 try{for(const native of [false,true])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_inline_owner',password:'green teapot on the hill',app:native}});assert.equal(signed.status(),200);
   const {token}=await signed.json();await context.addInitScript(initialize,{root:16,native,base,token});
   await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
   const page=await context.newPage(),errors=[],attempts=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/me/activities');await page.waitForFunction(()=>App.pageReady);
   await page.locator('article.post').filter({hasText:'Fictional empty run'}).locator('.activity-comments').click();await page.locator('.c-form textarea').waitFor();
   let fault='limit';
   await page.route('**/api/activities/*/comments',route=>{
    if(route.request().method()!=='POST')return route.continue();attempts.push(route.request().postDataJSON());
    return route.fulfill({status:fault==='limit'?429:503,headers:{'Retry-After':fault==='limit'?'37':'2'},json:{detail:fault==='limit'?'Too many requests. Try again in 37 seconds.':'Kinetta is busy. Please try again shortly.'}});
   });
   const text='Fictional trail looks lovely.',field=page.locator('.c-form textarea');await field.fill(text);await page.locator('.c-send').click();
   await page.getByText('Too many requests. Try again in 37 seconds.',{exact:true}).waitFor();assert.equal(await field.inputValue(),text);assert(await page.locator('.c-send').isEnabled());
   const key=attempts[0].client_id;assert.match(key,/^[a-f0-9-]{36}$/);
   if(out){fs.mkdirSync(out,{recursive:true});await page.locator('.sheet').screenshot({path:path.join(out,`${native?'bridge':'web'}-limited-${theme}.png`),animations:'disabled'});}
   await page.locator('.comment-retry').click();await page.getByText('Too many requests. Try again in 37 seconds.',{exact:true}).waitFor();assert.equal(attempts[1].client_id,key);
   fault='busy';await page.locator('.comment-retry').click();await page.getByText('Kinetta is busy. Try again in 2 seconds.',{exact:true}).waitFor();assert.equal(attempts[2].client_id,key);assert.equal(await field.inputValue(),text);assert(await page.locator('.c-send').isEnabled());
   // The shared error path must retain the numeric delay, including read errors.
   await page.route('**/api/member-limit-fixture',route=>route.fulfill({status:429,headers:{'Retry-After':'19'},json:{detail:'Too many requests.'}}));
   const feedback=await page.evaluate(async()=>{try{await api('/api/member-limit-fixture');}catch(e){return {status:e.status,delay:e.retryAfter,message:e.message,read:loadErrorCopy(e)};}});
   assert.deepEqual(feedback,{status:429,delay:19,message:'Too many requests. Try again in 19 seconds.',read:'Too many requests. Try again in 19 seconds.'});assert.deepEqual(errors,[]);
   console.log(`Member limits + busy retry, retained text/request key ${native?'bridge':'web'} 390 ${theme}: PASS`);
  }finally{await context.close();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
