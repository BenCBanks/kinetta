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
   const page=await context.newPage(),errors=[],previews=[],writes=[];let failNext=false;page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/plans/preview'){previews.push(q.postDataJSON());if(failNext){failNext=false;return r.fulfill({status:503,json:{detail:'Please try again.'}});}}if(!['GET','HEAD'].includes(q.method())&&u.pathname!='/api/plans/preview'){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   await page.goto(base+'/plan');await page.locator('[data-logs=yes]').waitFor();
   const capture=async name=>{assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'fits viewport');if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,`${name}-${width}-${theme}-full.png`),fullPage:true,animations:'disabled'});if(name==='questions')await page.evaluate(()=>scrollTo(0,0));else await page.locator('#ps-prev').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,`${name}-${width}-${theme}.png`),animations:'disabled'});}};
   assert.equal(await page.locator('#ps-go').innerText(),'Answer running questions');await page.locator('#ps-go').click();assert.equal(previews.length,0,'unanswered questions never call preview');for(const button of await page.locator('[data-logs],[data-break]').all())assert((await button.boundingBox()).height>=44,'new readiness controls have phone touch targets');await capture('questions');
   await page.locator('[data-level=beginner]').click();
   assert.match(await page.locator('[data-level=beginner]').innerText(),/At least.*long run/);
   await page.locator('[data-logs=missing]').click();await page.locator('[data-break="0"]').click();
   assert.equal(await page.locator('#ps-go').innerText(),'Start run/walk plan');assert(await page.locator('#ps-go').isEnabled());assert.match(await page.locator('#ps-prev').innerText(),/missing runs/);await capture('missing-logs');await page.locator('#ps-go').click();await page.locator('#ps-prev .pw').first().waitFor();assert.match(await page.locator('#ps-go').innerText(),/9-week/);assert.equal(previews.at(-1).level,'first');await page.locator('[data-race=half]').click();
   await page.locator('[data-logs=yes]').click();await page.locator('#ps-prev .pw').first().waitFor();assert(await page.locator('#ps-go').isEnabled());await capture('ready');
   await page.locator('[data-break="14"]').click();await page.waitForFunction(()=>document.querySelector('#ps-prev .err')?.textContent.includes('after time off'));
   assert.equal(await page.locator('#ps-go').innerText(),'Start run/walk plan');assert(await page.locator('#ps-go').isEnabled());await capture('returning');
   await page.locator('[data-logs=none]').click();await page.locator('#ps-go').click();
   await page.locator('#ps-prev .pw').first().waitFor();assert(await page.locator('#ps-go').isEnabled());
   assert.match(await page.locator('#ps-go').innerText(),/9-week/);assert.doesNotMatch(await page.locator('#pl').innerText(),/without getting hurt|undefined|suggested for you/);await capture('runwalk');
   assert.equal(previews.at(-1).break_days,14,'run/walk keeps the reported time off');
   const row=page.locator('#ps-prev [data-wday]').first(),day=await row.getAttribute('data-wday');
   for(const item of await page.locator('#ps-prev .pw').all())assert((await item.boundingBox()).height<=46,'preview workouts stay in a single 44px row');
   await row.click();await page.locator('.sheet').waitFor();assert.match(await page.locator('.sheet').innerText(),/What to do/i);assert.equal(await page.locator('#pw-done,#pw-undo').count(),0);if(shots)await page.screenshot({path:path.join(shots,`detail-${width}-${theme}.png`),animations:'disabled'});await page.keyboard.press('Escape');await page.locator('.scrim').waitFor({state:'detached'});
   await page.locator('[data-race=half]').click();await page.locator('[data-logs=yes]').click();await page.locator('[data-break="0"]').click();await page.locator('#ps-prev .pw').first().waitFor();
   const tomorrow=await page.evaluate(()=>addDays(new Date().toISOString().slice(0,10),1));await page.locator('[name=race_day]').fill(tomorrow);await page.locator('[name=race_day]').dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('#ps-go')?.textContent==='Adjust race date');await page.locator('#ps-go').click();assert.equal(await page.evaluate(()=>document.activeElement.name),'race_day');await capture('date-error');await page.locator('#ps-nodate').click();await page.locator('#ps-prev .pw').first().waitFor();
   failNext=true;await page.locator('[data-runs]').first().click();await page.waitForFunction(()=>document.querySelector('#ps-go')?.textContent==='Try again');await page.locator('#ps-go').click();await page.locator('#ps-prev .pw').first().waitFor();assert(await page.locator('#ps-go').isEnabled(),'retry restores the checked preview');
   assert.equal(await page.locator('.plan-scope-note').innerText(),'Training guidance, not medical advice.');
   const posted=await context.request.get(base+'/api/plans/current');assert.equal((await posted.json()).plan,null,'preview never starts a plan');assert(!writes.includes('/api/plans'),'next-step actions never create an unchecked plan');assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 console.log('Plan readiness: 390/330 light/dark unanswered/missing/ready/returning/runwalk, strict nine weeks, no plan writes PASS');
}finally{
 for(const state of ['base','empty']){const c=await browser.newContext();try{await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_plan_ready_'+state,password:pw}});await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}
 await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
