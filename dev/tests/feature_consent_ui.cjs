'use strict';
// Real renderer + fictional account. Permission transport is a stand-in; SQL/API consent has separate tests.
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const until=async(p,fn)=>{for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error('Consent state did not settle');};
(async()=>{
 const browser=await chromium.launch();let checks=0;
 try{for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_feature_consent',password:'green teapot on the hill'}})).status(),200);
   let participating=false,fail=false,drop=false,failState=false,hold=false,release=null,seen=null,stateGets=0,slowState=false,releaseState=null;const requests=[],errors=[];
   await c.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/features/state'){stateGets++;if(slowState)await new Promise(r=>releaseState=r);if(failState){failState=false;return route.fulfill({status:503,json:{detail:'State unavailable'}});}return route.fulfill({json:{available:true,participating,enabled:participating,version:'2026-11-01-v1'}});}
    if(u.pathname==='/api/features/preferences'){
     const value=r.postDataJSON();requests.push(value);seen?.();if(hold)await new Promise(r=>release=r);
     if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Please retry this setting.'}});}
     participating=value.enabled;if(drop){drop=false;return route.abort('connectionfailed');}return route.fulfill({json:{participating,enabled:participating,version:'2026-11-01-v1'}});
    }
    if(!['GET','HEAD'].includes(r.method()))return route.abort();return route.continue();
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/welcome');await p.locator('#feature-metrics summary').first().waitFor();assert.equal(await p.locator('#feature-metrics>section>details').getAttribute('open'),null);await p.locator('#feature-metrics summary').first().click();await p.locator('#feature-metrics-choice').waitFor();assert.equal(await p.locator('#feature-metrics-choice').isChecked(),false);checks++;if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#feature-metrics').evaluate(e=>window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-80));await p.waitForTimeout(100);await p.screenshot({path:path.join(out,`welcome-consent-390-${theme}.png`)});}await p.evaluate(()=>go('/me/settings'));
   const choice=p.locator('#feature-metrics-choice');await choice.waitFor();assert.equal(await choice.isChecked(),false);assert.equal(await choice.getAttribute('role'),'switch');checks++;
   drop=true;await choice.check();await until(p,()=>document.querySelector('#feature-metrics-status')?.textContent.includes('taking part'));assert.equal(requests.at(-1).version,'2026-11-01-v1');checks++;
   fail=true;await choice.uncheck();await until(p,()=>document.querySelector('#feature-metrics-status')?.textContent.includes('retry'));assert.equal(await choice.isChecked(),true);checks++;
   await choice.uncheck();await until(p,()=>document.querySelector('#feature-metrics-status')?.textContent.includes('are off'));assert.equal(await choice.isChecked(),false);checks++;
   await p.locator('#feature-metrics summary').click();assert(await p.locator('#feature-metrics').innerText().then(t=>t.includes('13 months')&&t.includes('Turning this off')));checks++;
   const fit=await p.locator('#feature-metrics').evaluate(e=>({height:e.querySelector('label').getBoundingClientRect().height,font:parseFloat(getComputedStyle(e.querySelector('label')).fontSize),overflow:document.documentElement.scrollWidth>innerWidth+1}));assert(fit.height>=44);assert(fit.font>=15);assert.equal(fit.overflow,false);checks++;
   if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#feature-metrics').evaluate(e=>window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-80));await p.waitForTimeout(100);await p.locator('#feature-metrics').screenshot({path:path.join(out,`consent-390-${theme}.png`)});}
   drop=true;failState=true;await choice.check();await until(p,()=>document.querySelector('#feature-metrics-status')?.textContent.includes('unknown'));assert.equal(await choice.isVisible(),false);checks++;const retry=p.locator('#feature-metrics section>button'),beforeGets=stateGets;assert.equal(await retry.innerText(),'Check setting');slowState=true;await retry.click();assert.equal(await retry.isDisabled(),true);await retry.evaluate(b=>{b.click();b.click();});for(let n=0;n<50&&!releaseState;n++)await p.waitForTimeout(20);assert(releaseState);assert.equal(stateGets,beforeGets+1);slowState=false;releaseState();await choice.waitFor();assert.equal(await choice.isChecked(),true);checks++;await choice.uncheck();await until(p,()=>document.querySelector('#feature-metrics-status')?.textContent.includes('are off'));
   hold=true;const pending=new Promise(r=>seen=r);await choice.check();await pending;await p.evaluate(()=>go('/me'));release();await p.locator('#feature-metrics').waitFor({state:'detached'});assert.equal(await p.locator('#feature-metrics-choice').count(),0);assert.deepEqual(errors,[]);checks++;
   console.log(`Optional analytics ${theme}: default-off, explicit versioned permission, failed withdrawal/retry, retention explanation and late-view fencing PASS (transport stand-in)`);
  }finally{await c.close();}
 }}finally{await browser.close();}
 console.log(`Optional analytics consent: ${checks} rendered checks PASS`);
})().catch(e=>{console.error(e);process.exit(1);});
