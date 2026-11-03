'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
(async()=>{const browser=await chromium.launch();try{
 for(const size of [{width:390,height:844},{width:330,height:667}])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(base+'/api/connections/garmin/callback?state=fictional-expired');
  assert.equal(response.status(),400);assert.equal(await page.locator('h1').innerText(),'That link has expired');
  const layout=await page.locator('main').evaluate(main=>({width:main.getBoundingClientRect().width,bodyWidth:document.body.scrollWidth,font:parseFloat(getComputedStyle(document.body).fontSize)}));
  assert(layout.width<=420&&layout.bodyWidth<=innerWidth+1&&layout.font>=17,'standalone callback remains readable without horizontal overflow');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Garmin standalone callback layout 390/330 light/dark PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
