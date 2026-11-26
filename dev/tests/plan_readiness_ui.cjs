// Actual setup + APIs; fictional accounts; no providers, device actions or plan writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const base=process.env.KINETTA_URL,pw='green teapot on the hill',shots=process.env.KINETTA_CAPTURE_DIR;
cp.execFileSync('python3',[path.join(__dirname,'plan_readiness_fixture.py')],{env:process.env,stdio:'inherit'});
(async()=>{const browser=await chromium.launch();try{
 for(const width of [390,330])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});
  try{
   assert((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_plan_ready_base',password:pw}})).ok());
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())&&u.pathname!='/api/plans/preview')return r.fulfill({json:{}});return r.continue();});
   await page.goto(base+'/plan');await page.locator('[data-logs=yes]').waitFor();
   const capture=async name=>{assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'fits viewport');if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,`${name}-${width}-${theme}-full.png`),fullPage:true,animations:'disabled'});if(name==='questions')await page.evaluate(()=>scrollTo(0,0));else await page.locator('#ps-prev').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,`${name}-${width}-${theme}.png`),animations:'disabled'});}};
   assert(await page.locator('#ps-go').isDisabled());for(const button of await page.locator('[data-logs],[data-break]').all())assert((await button.boundingBox()).height>=44,'new readiness controls have phone touch targets');await capture('questions');
   await page.locator('[data-level=beginner]').click();
   assert.match(await page.locator('[data-level=beginner]').innerText(),/consistent runners logging at least.*long run/);
   await page.locator('[data-logs=missing]').click();await page.locator('[data-break="0"]').click();
   assert(await page.locator('#ps-go').isDisabled());assert.match(await page.locator('#ps-prev').innerText(),/Add missing runs/);await capture('missing-logs');
   await page.locator('[data-logs=yes]').click();await page.locator('#ps-prev .pw').first().waitFor();assert(await page.locator('#ps-go').isEnabled());await capture('ready');
   await page.locator('[data-break="14"]').click();await page.waitForFunction(()=>document.querySelector('#ps-prev .err')?.textContent.includes('After time off'));
   assert(await page.locator('#ps-go').isDisabled());await capture('returning');
   await page.locator('[data-logs=none]').click();await page.locator('#ps-runwalk').click();
   await page.locator('#ps-prev .pw').first().waitFor();assert(await page.locator('#ps-go').isEnabled());
   assert.match(await page.locator('#ps-go').innerText(),/9-week/);assert.doesNotMatch(await page.locator('#pl').innerText(),/without getting hurt|undefined|suggested for you/);await capture('runwalk');
   const posted=await context.request.get(base+'/api/plans/current');assert.equal((await posted.json()).plan,null,'preview never starts a plan');assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 console.log('Plan readiness: 390/330 light/dark unanswered/missing/ready/returning/runwalk, strict nine weeks, no plan writes PASS');
}finally{
 for(const state of ['base','empty']){const c=await browser.newContext();try{await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_plan_ready_'+state,password:pw}});await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}
 await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
