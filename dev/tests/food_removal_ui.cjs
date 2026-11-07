// 390 px regression for removing an unlogged food through its quantity stepper.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',pw='green teapot on the hill',fixedFoodTime='2026-11-06T17:00:00.000Z';
async function until(page,fn,label){for(let i=0;i<120;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error(label);}
(async()=>{
  if(process.env.KINETTA_FIXTURE_READY!=='1')cp.execFileSync('python3',[path.join(__dirname,'food_entry_fixture.py')],{env:process.env,stdio:'inherit'});
  const browser=await chromium.launch(),contexts=[];
  async function open(who,theme){
    const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(context);
    const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_food_compact_'+who,password:pw}});assert.equal(login.status(),200);
    const me=await(await context.request.get(base+'/api/me')).json(),history=await(await context.request.get(base+'/api/food/thread')).json();
    const root=history.messages.find(message=>message.kind==='user');assert(root,'fixture has a fictional food card');
    const resume={id:root.result.draft_id,meal:'lunch',day:root.local_day,active:true};
    await context.addInitScript(({base,id,resume})=>localStorage.setItem('fit.food.review.draft:'+JSON.stringify([base,id]),JSON.stringify(resume)),{base,id:me.id,resume});
    const page=await context.newPage(),errors=[];await page.clock.setFixedTime(new Date(fixedFoodTime));page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
    await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await page.goto(base+'/food/describe?meal=lunch');await until(page,()=>App.pageReady&&!!document.querySelector('#thread-text'),'food screen ready');
    return {context,page,errors,root};
  }
  try{
    for(const [who,theme] of [['one','light'],['6381d','dark']]){
      const single=await open(who,theme),page=single.page,row=page.locator('.compact-food').first();
      assert.equal(await page.locator('.compact-food').count(),1,'the fictional single-food card starts with one food');
      assert.equal(await row.locator('.compact-food-title [data-remove-food]').count(),0,'the title row has no separate × action');
      const minus=row.locator('.thread-stepper [data-step="-1"]');assert.equal(await minus.count(),1,'minus stays beside the amount while the food has two portions');
      await minus.click();await until(page,()=>document.querySelector('.compact-food .thread-amount')?.textContent.trim()==='1 portion','minus reduces the food to one portion');
      assert.equal(await row.locator('.thread-stepper [data-step="-1"]').count(),0,'minus disappears at one portion');
      const trash=row.locator('.thread-stepper [data-remove-food]');assert.equal(await trash.count(),1,'trash replaces minus at one portion');assert.match(await trash.getAttribute('aria-label'),/^Remove /);
      await trash.click();await until(page,()=>document.querySelectorAll('.compact-food').length===0,'trash removes the food');
      assert(await page.locator('#thread-review').isHidden(),'removing the last food hides the review action');
      const after=(await(await single.context.request.get(base+'/api/food/thread')).json()).messages.find(message=>message.reply_to===single.root.id);
      const remaining=(after?.result?.parts||[]).flatMap(part=>part.entries||[]);
      assert.equal(remaining.length,0,'the server draft no longer contains the removed food');
      assert.equal((await(await single.context.request.get(base+'/api/food/day')).json()).entries.length,0,'removal does not create a diary row');
      assert.deepEqual(single.errors,[],'single-food removal has no browser errors');await single.context.close();contexts.splice(contexts.indexOf(single.context),1);
      console.log(`Food removal ${theme}: minus becomes quantity-one trash and removes the draft food PASS`);
    }

    const multi=await open('three','light'),rows=multi.page.locator('.compact-food');
    assert.equal(await rows.count(),3,'the fictional multi-food card has three rows');
    assert.equal(await multi.page.locator('.compact-thread-card [data-unlogged-remove]').count(),0,'the ready card has no separate whole-card ×');
    for(const row of await rows.all()){
      assert.equal(await row.locator('.compact-food-title [data-remove-food]').count(),0,'food removal stays in the stepper');
      const amount=await row.locator('.thread-amount').innerText();
      if(/^1\b/.test(amount)){assert.equal(await row.locator('.thread-stepper [data-step="-1"]').count(),0);assert.equal(await row.locator('.thread-stepper [data-remove-food]').count(),1,'a one-portion row uses trash');}
      else {assert.equal(await row.locator('.thread-stepper [data-step="-1"]').count(),1,'a multi-portion row keeps minus');assert.equal(await row.locator('.thread-stepper [data-remove-food]').count(),0);}
    }
    assert.deepEqual(multi.errors,[],'multi-food removal controls render without browser errors');await multi.context.close();contexts.splice(contexts.indexOf(multi.context),1);

    const logged=await open('logged','light');await logged.page.locator('.thread-card [data-more]').waitFor();
    assert.equal(await logged.page.locator('[data-unlogged-remove]').count(),0,'logged food does not show an unlogged remove action');
    assert(await logged.page.locator('.thread-card [data-more]').isVisible(),'the logged card keeps its existing menu');
    assert.deepEqual(logged.errors,[],'logged food has no browser errors');await logged.context.close();contexts.splice(contexts.indexOf(logged.context),1);
    console.log('Food removal: single and multi-food stepper contract, logged menu PASS');
  }finally{
    for(const context of contexts)await context.close();
    for(const who of ['one','6381d','three','logged']){const context=await browser.newContext();try{const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_food_compact_'+who,password:pw}});if(response.ok())await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await context.close();}}
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
