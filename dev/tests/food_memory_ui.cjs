'use strict';
// Browser plugin unavailable; local fictional account, only review staging allowed.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch();let cases=0;
 try{for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
  try{
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_food_memory_ui',password:'green teapot on the hill'}})).status(),200);
   const p=await c.newPage(),errors=[],queries=[],reuse=[];let lose=true;
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/food/meals-chat/reuse')queries.push(u.searchParams.get('q'));
    if(req.method()==='POST'&&u.pathname==='/api/food/thread/reviews/reuse'){
     reuse.push(req.postDataJSON());if(lose){lose=false;await r.fetch();return r.abort();}return r.continue();
    }
    if(!['GET','HEAD'].includes(req.method())&&u.pathname!=='/api/food/thread/reviews')return r.fulfill({status:503,json:{detail:'Fictional test: writes blocked'}});
    return r.continue();
   });
   await p.goto(base+'/food/describe');await p.locator('#thread-text').waitFor();await until(p,()=>App.pageReady,'Food entry ready');
   const field=p.locator('#thread-text');await field.fill('la');await p.waitForTimeout(120);await field.fill('latte');await p.waitForTimeout(120);assert.equal(queries.length,0,'400ms debounce');
   await p.locator('.thread-reuse button').first().waitFor();assert.equal(await p.locator('.thread-reuse button').count(),3);
   const layout=await p.locator('.thread-reuse button').evaluateAll(ns=>ns.map(n=>({h:n.getBoundingClientRect().height,w:n.getBoundingClientRect().width})));
   assert(layout.every(r=>r.h>=44&&r.w>=44));assert.equal(await p.locator('.thread-reuse').evaluate(n=>parseFloat(getComputedStyle(n).gap)),8);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert(await field.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
   await field.focus();await p.locator('.thread-heading h1').tap();assert.equal(await field.inputValue(),'latte');assert.equal(await field.evaluate(n=>document.activeElement===n),false);cases+=3;
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'reuse-chips-'+theme+'.png')});}
   const chip=p.locator('.thread-reuse button').filter({hasText:'Wooden robot latte'});await chip.click();await until(p,()=>document.querySelector('#thread-status')?.textContent.length>0,'Lost-response error remains retryable');
   assert.equal(await field.inputValue(),'latte');await chip.click();await p.locator('#review-foods').waitFor();assert.equal(reuse.length,2);assert.equal(reuse[0].client_id,reuse[1].client_id,'Lost reply retries the same request');
   assert.match(await p.locator('#review-foods').innerText(),/Nutrition from: Wooden robot latte/);assert.match(await p.locator('#review-foods').innerText(),/180/);cases+=3;
   if(out)await p.screenshot({path:path.join(out,'reuse-review-'+theme+'.png')});
   await p.getByRole('dialog').locator('[data-close]').first().click();assert.equal(await field.inputValue(),'latte');assert.equal(await p.locator('.thread-reuse button').count(),0);
   assert.deepEqual(errors,[]);console.log('Food memory390 '+theme+': real own chips,44/8 spacing, keyboard/draft, lost-response replay and provenance review PASS');
  }finally{await c.close();}
 }}finally{await browser.close();}
 console.log('Food memory: '+cases+' rendered checks PASS');
})().catch(e=>{console.error(e);process.exit(1);});
