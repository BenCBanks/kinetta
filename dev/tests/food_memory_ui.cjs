'use strict';
// Browser plugin unavailable; local fictional account, only review staging allowed.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch();let cases=0;
 try{for(const width of [390,330]){for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'});
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
   const checkpoint=process.env.KINETTA_CHECKPOINT_ONLY==='1',showOtherDay=checkpoint&&width===330;
   const route=showOtherDay?'/food/describe?d=2026-11-03&meal=lunch':'/food/describe?meal=breakfast';
   await p.goto(base+route);await p.locator('#thread-text').waitFor();await until(p,()=>App.pageReady,'Food entry ready');
   const context=p.locator('#thread-context'),header=p.locator('.thread-heading'),expectedTitle=showOtherDay?'Tue · Lunch ⌄':'Breakfast ⌄',expectedAria=showOtherDay?'Logging to Lunch, Tue. Change day or meal.':'Logging to Breakfast, today. Change day or meal.';
   assert.equal((await context.innerText()).replace(/\s+/g,' ').trim(),expectedTitle);assert.equal(await context.getAttribute('aria-label'),expectedAria);
   const boxes=await p.evaluate(()=>{const rect=s=>{const r=s.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};},row=document.querySelector('.thread-heading');return{row:rect(row),back:rect(row.querySelector('.back')),title:rect(row.querySelector('#thread-context')),gear:rect(row.querySelector('#thread-settings')),label:(()=>{const r=row.querySelector('.thread-context-label');return{width:r.clientWidth,scrollWidth:r.scrollWidth};})()};});
   assert(boxes.row.height<=46,'food chat header stays one 44 px row');assert(boxes.back.height>=44&&boxes.title.height>=44&&boxes.gear.height>=44,'all header actions meet the 44 px target');
   assert(boxes.title.y>=boxes.row.y-1&&boxes.title.bottom<=boxes.row.bottom+1,'title stays in the header row');assert(boxes.title.x>=boxes.back.right+7&&boxes.gear.x>=boxes.title.right+7,'center title keeps 8 px gaps from both sides');
   assert(boxes.label.scrollWidth<=boxes.label.width+1,'the destination title fits without truncation');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const today=await p.evaluate(()=>isoDay(new Date(),deviceTimeZone())),pickerDay=showOtherDay?'2026-11-03':today,pickerMeal=showOtherDay?'lunch':'breakfast';
   await context.tap();const picker=p.getByRole('dialog');await picker.waitFor();assert.equal(await picker.locator('[data-meal="'+pickerMeal+'"]').getAttribute('aria-pressed'),'true');assert.equal(await picker.locator('input[name="date"]').inputValue(),pickerDay);await picker.locator('[data-close]').first().click();
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'food-header-'+width+'-'+theme+'.png')});}
   cases+=6;
   if(process.env.KINETTA_CHECKPOINT_ONLY==='1'){assert.deepEqual(errors,[]);console.log('Food header '+width+' '+theme+': destination title, picker and one-row geometry PASS');continue;}
   const field=p.locator('#thread-text');await field.fill('la');await p.waitForTimeout(120);await field.fill('latte');await p.waitForTimeout(120);assert.equal(queries.length,0,'400ms debounce');
   await p.locator('.thread-reuse button').first().waitFor();assert.equal(await p.locator('.thread-reuse button').count(),3);
   const layout=await p.locator('.thread-reuse button').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),pill=n.firstElementChild;return {h:r.height,w:r.width,left:r.left,right:r.right,font:parseFloat(s.fontSize),weight:s.fontWeight,pill:pill.getBoundingClientRect().height,clipped:pill.scrollWidth>pill.clientWidth+1};}));
   assert(layout.every(r=>r.h>=44&&r.w>=44&&r.left>=0&&r.right<=width&&r.font>=15&&r.weight==='500'&&!r.clipped));assert(layout.some(r=>r.pill<=36));assert.equal(await p.locator('.thread-reuse').evaluate(n=>parseFloat(getComputedStyle(n).gap)),8);
   assert.equal(await p.locator('.thread-reuse').evaluate(n=>n.scrollWidth>n.clientWidth),false);assert.match(await p.locator('.thread-reuse').innerText(),/Vanilla and cinnamon breakfast latte/);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert(await field.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
   await field.focus();await context.tap();assert.equal(await field.inputValue(),'latte');assert.equal(await field.evaluate(n=>document.activeElement===n),false);await p.getByRole('dialog').locator('[data-close]').first().click();cases+=3;
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'reuse-chips-'+width+'-'+theme+'.png')});}
   const chip=p.locator('.thread-reuse button').filter({hasText:'Wooden robot latte'});await chip.click();await until(p,()=>document.querySelector('#thread-status')?.textContent.length>0,'Lost-response error remains retryable');
   assert.equal(await field.inputValue(),'latte');await chip.click();await p.locator('#review-foods').waitFor();assert.equal(reuse.length,2);assert.equal(reuse[0].client_id,reuse[1].client_id,'Lost reply retries the same request');
   assert.match(await p.locator('#review-foods').innerText(),/Nutrition from: Wooden robot latte/);assert.match(await p.locator('#review-foods').innerText(),/180/);cases+=3;
   if(out)await p.screenshot({path:path.join(out,'reuse-review-'+width+'-'+theme+'.png')});
   await p.getByRole('dialog').locator('[data-close]').first().click();assert.equal(await field.inputValue(),'latte');assert.equal(await p.locator('.thread-reuse button').count(),0);
   assert.deepEqual(errors,[]);console.log('Food memory '+width+' '+theme+': real own chips,44/8 spacing, keyboard/draft, lost-response replay and provenance review PASS');
  }finally{await c.close();}
 }}}finally{await browser.close();}
 console.log('Food memory: '+cases+' rendered checks PASS');
})().catch(e=>{console.error(e);process.exit(1);});
