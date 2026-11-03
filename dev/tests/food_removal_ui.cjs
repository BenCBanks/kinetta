// 390 px regression for unlogged food removal and its five visible states.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',pw='green teapot on the hill',people=['empty','one','three','photo','clarify','actions','nullable','logged'];
async function until(page,fn,label){for(let i=0;i<120;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error(label);}
(async()=>{
  if(process.env.KINETTA_FIXTURE_READY!=='1')cp.execFileSync('python3',[path.join(__dirname,'food_entry_fixture.py')],{env:process.env,stdio:'inherit'});
  const browser=await chromium.launch(),contexts=[];
  async function open(who,theme){
    const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(context);
    const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_food_compact_'+who,password:pw}});assert.equal(login.status(),200);
    const me=await(await context.request.get(base+'/api/me')).json(),history=await(await context.request.get(base+'/api/food/thread')).json();
    const root=history.messages.find(m=>m.kind==='user');assert(root,'fixture has a fictional food card');
    const resume={id:root.result.draft_id,meal:'lunch',day:root.local_day};
    await context.addInitScript(({base,id,resume})=>localStorage.setItem('fit.food.review.draft:'+JSON.stringify([base,id]),JSON.stringify(resume)),{base,id:me.id,resume});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/Failed to load resource/.test(message.text()))errors.push(message.text());});
    let rejectRemoval=false;
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==base)return route.abort();
      if(rejectRemoval&&request.method()==='DELETE'&&/^\/api\/food\/thread\/messages\/\d+\/unlogged$/.test(url.pathname))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Fictional refusal'})});
      return route.continue();
    });
    await page.goto(base+'/food/describe?meal=lunch');await until(page,()=>App.pageReady&&!!document.querySelector('#thread-text'),'food screen ready');
    await page.locator('.thread-card:not(.thread-thinking)').first().waitFor();
    return {context,page,errors,setReject:value=>{rejectRemoval=value;},root};
  }
  function screenshot(page,name,theme){if(!process.env.SHOT_DIR)return Promise.resolve();fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});return page.screenshot({path:path.join(process.env.SHOT_DIR,`food-removal-${name}-${theme}.png`)});}
  try{
    for(const theme of ['light','dark']){
      const state=await open('one',theme),{page,context,errors}=state;
      const card=page.locator('.thread-card:not(.thread-thinking)').first(),article=page.locator('#thread-messages article').first();
      const before=await card.innerText(),bubble=await article.locator('.thread-user').innerText();
      const remove=page.locator('[data-unlogged-remove]');assert.equal(await remove.count(),1,'one-tap remove replaces the menu on unlogged food');
      assert.equal(await page.locator('[data-more]').count(),0,'unlogged food has no overflow menu');
      const geometry=await remove.evaluate(node=>({rect:node.getBoundingClientRect().toJSON(),style:getComputedStyle(node)}));
      assert.equal(geometry.rect.width,44);assert.equal(geometry.rect.height,44);assert.equal(geometry.style.fontSize,'18px');assert.equal(geometry.style.backgroundColor,'rgba(0, 0, 0, 0)');assert.equal(geometry.style.borderTopWidth,'0px');
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no horizontal overflow at 390 px');
      await screenshot(page,'unlogged',theme);

      await remove.click();await page.locator('#thread-remove-notice').waitFor({state:'visible'});
      await until(page,()=>!document.querySelector('#thread-messages article'),'removed card collapses');
      assert(await page.locator('#thread-review').isHidden(),'a removed food cannot remain in the review total');
      assert.equal(await page.locator('#thread-remove-notice [aria-live=polite]').innerText(),'Food removed. Undo available.');
      assert.equal(await page.locator('#thread-remove-notice [aria-hidden=true]').innerText(),'Food removed');
      assert.equal(await page.locator('#thread-remove-notice [data-removal-undo]').innerText(),'Undo');
      assert.equal(await page.locator('.scrim').count(),0,'removal does not open a sheet');
      await screenshot(page,'removed-undo',theme);

      await page.locator('[data-removal-undo]').click();await page.locator('[data-unlogged-remove]').waitFor();
      assert.equal(await page.locator('#thread-messages article').first().locator('.thread-card:not(.thread-thinking)').innerText(),before,'Undo restores the original card exactly');
      assert.equal(await page.locator('#thread-messages article').first().locator('.thread-user').innerText(),bubble,'Undo restores the original food text');
      await screenshot(page,'after-undo',theme);

      state.setReject(true);await context.setOffline(true);await page.locator('[data-unlogged-remove]').click();
      await page.locator('#thread-remove-notice').waitFor({state:'visible'});await until(page,()=>!document.querySelector('#thread-messages article'),'offline removal hides the card');
      await page.waitForTimeout(5100);await context.setOffline(false);
      await page.locator('.thread-remove-failed').waitFor({timeout:5000});
      assert.equal(await page.locator('.thread-remove-failed span').innerText(),'Couldn’t remove this food.');
      assert.equal(await page.locator('.thread-remove-failed button').innerText(),'Try again');
      assert.equal(await page.locator('[data-unlogged-remove]').count(),0,'a refused removal offers Retry without leaving a second remove action');
      assert.equal(await page.locator('.thread-remove-failed').evaluate(node=>getComputedStyle(node).color),await page.locator('.thread-card').first().evaluate(node=>getComputedStyle(node).color),'failure uses normal text colour');
      assert.equal(await page.locator('#thread-messages .thread-user').count(),0,'failure state does not repeat the original food text');
      await screenshot(page,'offline-failure',theme);
      await page.locator('.thread-remove-failed button').click();await page.locator('#thread-remove-notice').waitFor({state:'visible'});
      await until(page,()=>!document.querySelector('#thread-messages article'),'Try again retries the one-tap removal');
      await page.locator('[data-removal-undo]').click();await page.locator('[data-unlogged-remove]').waitFor();
      assert.equal(await page.locator('.thread-remove-failed').count(),0,'Undo after Try again returns to the original card');
      assert.deepEqual(errors,[],'no browser errors in removal states');await context.close();contexts.splice(contexts.indexOf(context),1);

      const logged=await open('logged',theme),lp=logged.page;
      await lp.locator('.thread-card [data-more]').waitFor();
      assert.equal(await lp.locator('[data-unlogged-remove]').count(),0,'logged food retains its existing ••• menu');
      assert(await lp.locator('.thread-card [data-more]').isVisible());
      await screenshot(lp,'logged-menu',theme);
      assert.deepEqual(logged.errors,[],'logging the fictional fixture has no browser errors');
      await logged.context.close();contexts.splice(contexts.indexOf(logged.context),1);
      console.log(`Food removal ${theme}: unlogged, removed/Undo, restored, offline refusal, logged ••• PASS`);
    }
    const success=await open('three','light'),successPage=success.page;
    await successPage.locator('[data-unlogged-remove]').click();await successPage.locator('#thread-remove-notice').waitFor({state:'visible'});
    await successPage.waitForTimeout(5200);
    assert(await successPage.locator('#thread-remove-notice').isHidden(),'the notice expires after a successful removal');
    assert.equal(await successPage.locator('#thread-messages article').count(),0,'a completed removal does not redraw the stale card');
    await successPage.reload();await until(successPage,()=>App.pageReady&&!!document.querySelector('#thread-text'),'food screen reloads');
    assert.equal(await successPage.locator('#thread-messages article').count(),0,'a completed removal stays gone after refresh');
    assert.deepEqual(success.errors,[],'successful removal has no browser errors');
    await success.context.close();contexts.splice(contexts.indexOf(success.context),1);
    console.log('Food removal expiry: successful server delete stays absent after redraw and refresh PASS');
  }finally{
    for(const context of contexts)await context.close();
    for(const who of people){const context=await browser.newContext();try{const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_food_compact_'+who,password:pw}});if(response.ok())await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await context.close();}}
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
