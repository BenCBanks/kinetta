'use strict';
// Fictional 500 bodies must not reach users; the failed sign-in and Share remain retryable.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const marker='FICTIONAL_INTERNAL_TRACE_MARKER';
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [390,330])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage();
   let loginAttempts=0;
   await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/setup')return route.fulfill({json:{needed:false}});
    if(url.pathname==='/api/beta')return route.fulfill({json:{open:false}});
    if(url.pathname==='/api/signup')return route.fulfill({json:{open:false}});
    if(url.pathname==='/api/me')return route.fulfill({status:401,json:{detail:'Not logged in'}});
    if(url.pathname==='/api/login'&&request.method()==='POST'){loginAttempts++;return route.fulfill({status:500,json:{detail:marker}});}
    return route.continue();
   });
   await page.goto(base+'/');
   await page.locator('#first-run-login').click();
   const login=page.locator('input[name=login]'),password=page.locator('input[name=password]');
   await login.fill('runner@example.test');await password.fill('fictional-passphrase');await page.getByRole('button',{name:'Log in'}).click();
   await page.getByRole('alert').filter({hasText:'Sign-in is temporarily unavailable'}).waitFor();
   const message=await page.getByRole('alert').innerText();
   assert.doesNotMatch(message,new RegExp(marker),'sign-in never displays the server trace marker');
   assert.equal(await login.inputValue(),'runner@example.test','failed sign-in keeps the entered username');
   assert.equal(await password.inputValue(),'fictional-passphrase','failed sign-in keeps the entered password');
   assert.equal(await page.getByRole('button',{name:'Log in'}).isEnabled(),true,'failed sign-in can be retried');
   assert.equal(loginAttempts,1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'sign-in error fits without horizontal clipping');
   if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SHOT_DIR,`signin-error-${theme}-${width}.png`)});}
   await context.close();
  }
  for(const width of [390,330])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage();
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
   assert.equal(signed.status(),200,'fictional disposable demo account signs in');
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await page.goto(base+'/activity');
   const card=page.locator('#ff-list .post').filter({hasText:'Strength A'}).filter({has:page.locator('[data-share-picture]')}).first();
   await card.waitFor();const share=card.locator('[data-share-picture]'),shareId=await share.getAttribute('data-share-picture');let socialReads=0;
   await page.route('**/api/activities/*/social',route=>{
    const url=new URL(route.request().url());
    if(url.pathname!==`/api/activities/${shareId}/social`)return route.fallback();
    socialReads++;return socialReads===1?route.fulfill({status:500,json:{detail:marker}}):route.fallback();
   });
   await share.click();
   await page.getByText('Couldn’t load sharing right now. Tap Share to try again.').waitFor();
   assert.doesNotMatch(await page.locator('body').innerText(),new RegExp(marker),'share never displays the server trace marker');
   assert.equal(await page.locator('.sheet').count(),0,'failed social read leaves the current screen available');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'share retry message fits without horizontal clipping');
   if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await card.evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForTimeout(100);await page.screenshot({path:path.join(process.env.SHOT_DIR,`share-error-${theme}-${width}.png`)});}
   await share.click();
   await page.locator('.sheet').waitFor();
   assert.equal(socialReads,2,'the second Share tap repeats the failed request');
   assert.equal(await page.locator('[data-unified-share] [data-share-format-label]').innerText(),'Stats','retry opens the no-GPS activity share preview on the same screen');
   assert.equal(new URL(page.url()).pathname,'/activity','retry keeps the feed beneath the sheet');
   await context.close();
  }
 }finally{await browser.close();}
 console.log('User-safe 500 sign-in and retryable activity share PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
