'use strict';
// Fictional 500 bodies must not reach users; the failed sign-in and Share remain retryable.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const marker='FICTIONAL_INTERNAL_TRACE_MARKER';
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage();
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
   await page.goto(base+'/',{waitUntil:'networkidle'});
   const login=page.locator('input[name=login]'),password=page.locator('input[name=password]');
   await login.fill('runner@example.test');await password.fill('fictional-passphrase');await page.getByRole('button',{name:'Log in'}).click();
   await page.getByRole('alert').filter({hasText:'Sign-in is temporarily unavailable'}).waitFor();
   const message=await page.getByRole('alert').innerText();
   assert.doesNotMatch(message,new RegExp(marker),'sign-in never displays the server trace marker');
   assert.equal(await login.inputValue(),'runner@example.test','failed sign-in keeps the entered username');
   assert.equal(await password.inputValue(),'fictional-passphrase','failed sign-in keeps the entered password');
   assert.equal(await page.getByRole('button',{name:'Log in'}).isEnabled(),true,'failed sign-in can be retried');
   assert.equal(loginAttempts,1);
   if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SHOT_DIR,`signin-error-${theme}-390.png`)});}
   await context.close();
  }
  for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage();
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
   assert.equal(signed.status(),200,'fictional disposable demo account signs in');
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await page.goto(base+'/activity');
   await page.locator('#ff-list .post [data-share-picture]').first().waitFor();
   const share=page.locator('#ff-list .post [data-share-picture]').first(),shareId=await share.getAttribute('data-share-picture');let socialReads=0;
   await page.route('**/api/activities/*/social',route=>{
    const url=new URL(route.request().url());
    if(url.pathname!==`/api/activities/${shareId}/social`)return route.fallback();
    socialReads++;return socialReads===1?route.fulfill({status:500,json:{detail:marker}}):route.fallback();
   });
   await share.click();
   await page.getByText('Couldn’t load sharing right now. Tap Share to try again.').waitFor();
   assert.doesNotMatch(await page.locator('body').innerText(),new RegExp(marker),'share never displays the server trace marker');
   assert.equal(await page.locator('.sheet').count(),0,'failed social read leaves the current screen available');
   if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SHOT_DIR,`share-error-${theme}-390.png`)});}
   await share.click();
   await page.locator('.sheet').waitFor();
   assert.equal(socialReads,2,'the second Share tap repeats the failed request');
   assert.equal(await page.getByRole('tab',{name:'Card',exact:true}).count(),1,'retry opens the share sheet on the same screen');
   await context.close();
  }
 }finally{await browser.close();}
 console.log('User-safe 500 sign-in and retryable activity share PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
