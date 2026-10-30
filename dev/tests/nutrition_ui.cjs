// Real fictional accounts and server data; media/AI availability stand-ins never send photos or provider work.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(p.nutritionDiagnostics)+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,ready:App.pageReady,bootFailed:globalThis.KinettaBoot?.failed,assets:globalThis.nutritionBootAssets,assetErrors:globalThis.nutritionAssetErrors,text:document.body.textContent.slice(-600)}))));}
(async()=>{
 cp.execFileSync('python3',['dev/tests/nutrition_fixture.py'],{env:process.env,stdio:'inherit'});
 const b=await chromium.launch(),cleanup=[];
 try{
 for(const who of ['empty','typical','heavy']){
  const auth=await b.newContext();assert.equal((await auth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_nutrition_'+who,password:'green teapot on the hill'}})).status(),200);cleanup.push(auth);const storage=await auth.storageState();
  for(const size of [{width:390,height:844,root:16},{width:330,height:740,root:24}])for(const theme of ['light','dark']){
   if(process.env.KINETTA_NUTRITION_CASE&&process.env.KINETTA_NUTRITION_CASE!==`${who}-${size.width}-${theme}`)continue;
   const c=await b.newContext({storageState:storage,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],consoleErrors=[],writes=[],failed=[];p.nutritionDiagnostics={errors,consoleErrors,failed};p.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
   p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/net::ERR_FAILED|net::ERR_ABORTED|503/.test(m.text()))consoleErrors.push(m.text());});
   await c.addInitScript(root=>{
    addEventListener('error',e=>{if(['LINK','SCRIPT'].includes(e.target?.tagName))(globalThis.nutritionAssetErrors||=[]).push(e.target.src||e.target.href);},true);
    document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=root+'px';globalThis.nutritionBootAssets=[...document.querySelectorAll('link[rel=stylesheet]')].map(n=>({url:n.href,sheet:!!n.sheet}));});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw Error('Fictional camera stand-in: no device capture');}}});
   },size.root);
   await c.route('**/*',r=>{
    const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(u.pathname.startsWith('/api/food/thread/'))return r.continue();return r.fulfill({json:{}});}
    return r.continue();
   });
   const ready=()=>until(p,()=>App.pageReady&&App.page?.key===location.pathname+location.search,'page ready');
   const home=async()=>{if(p.url()==='about:blank')await p.goto(base+'/food');else await p.evaluate(()=>go('/food'));await ready();await until(p,()=>document.querySelector('#nutrition-explore')?.getAttribute('aria-busy')==='false','food facts');};
   const fits=async label=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),label+' has no horizontal overflow');
   await home();assert.equal(await p.locator('h1').innerText(),'Nutrition');assert.equal(await p.locator('.view-nav,.pbar,.food-library-link,.backtoday,.mealact').count(),0,'no stacked navigation or meal footer');
   assert.equal(await p.locator('#nutrition-explore a').count(),7);assert.equal(await p.locator('#fd-explore h2').innerText(),'Explore your food');
   assert.equal(await p.locator('#nutrition-explore').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2);
   for(const selector of ['#fq-add','#fq-photo','#fq-scan','#fd-prev','#fd-next','[data-add]','[data-more]','#nutrition-explore a'])for(const el of await p.locator(selector).all()){
    const rect=await el.boundingBox();assert(rect.height>=44,selector+' target height');assert(rect.width>=44,selector+' target width');
   }
   for(const group of await p.locator('.meal-actions').all()){
    const buttons=await group.locator('button').all(),one=await buttons[0].boundingBox(),two=await buttons[1].boundingBox();assert(Math.abs(one.y-two.y)<1,'meal actions stay together when wrapping');
   }
   for(const title of await p.locator('.progress-tile-name').all())assert(await title.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'tile title fits without clipping');
   assert.equal(await p.locator('.nutrition-date-row #fd-date').count(),1);assert.equal(await p.locator('#fq-add').count(),1);
   if(who==='empty'){
    assert.equal(await p.locator('.nutrition-start').count(),1);assert.equal(await p.locator('.nutrition-body-prompt').count(),1);assert.equal(await p.locator('#nutrition-explore .progress-new:not(.seen)').count(),7);
    assert(!/0 (saved|logged)/.test(await p.locator('#nutrition-explore').innerText()));
   }else{
    assert.match(await p.locator('[data-nutrition-feature=recipes]').innerText(),new RegExp((who==='typical'?'4':'13')+' saved'));
    assert.match(await p.locator('[data-nutrition-feature=weight]').innerText(),/(last logged|trend)/);
    assert.equal(await p.locator('[data-nutrition-feature=weight] .progress-new:not(.seen)').count(),0);
    const barWidths=await p.locator('.nutrition-summary-link .track').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));assert.equal(barWidths.length,2);assert(Math.abs(barWidths[0]-barWidths[1])<2,'calorie and protein tracks match');
    if(size.root===16){const lunch=await p.locator('.meal-lunch').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();if(who==='typical')assert(lunch.y+lunch.height<nav.y-8,'Breakfast and Lunch clear the tab bar');}
    assert.equal(await p.locator('.meal-calories').first().evaluate(n=>getComputedStyle(n.querySelector('small')).display),'inline');
   }
   await fits('home');if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(350);await p.screenshot({path:`${out}/nutrition-${who}-${theme}.png`,fullPage:true,animations:'disabled'});}
   // One summary leads to the same analysis used by legacy Progress links; all options live in cards.
   if(who!=='empty'){
    const summary=await p.locator('.nutrition-day-summary').boundingBox();await p.mouse.click(summary.x+6,summary.y+summary.height/2);await ready();assert.equal(await p.locator('h1').innerText(),'Insights');
    await until(p,()=>!!document.querySelector('#nt-body .card #n-range'),'range belongs to chart card');
    await p.locator('#n-range').click();await p.locator('[data-pk="7"]').click();await ready();assert.equal(new URL(p.url()).searchParams.get('r'),'7');
    await p.locator('.nutrition-back').click();await ready();await home();
    await p.locator('#fd-goal').click();await p.waitForSelector('#tg');assert.equal(await p.locator('.sheet h2').innerText(),'Goals');
    for(const input of await p.locator('#tg input').all())assert(Number.parseFloat(await input.evaluate(n=>getComputedStyle(n).fontSize))>=16);
    await p.locator('.sheet [data-close]').click();
   }
   for(const view of ['overview','energy','macros','weight','needs','weeks','calendar','trends']){
    await p.evaluate(view=>go('/food?view='+view),view);await ready();assert.equal(await p.locator('.nutrition-back').count(),1,view+' back');assert.equal(await p.locator('.view-nav,.pbar').count(),0,view+' no global bars');await fits(view);
    await p.locator('.nutrition-back').click();await ready();
   }
   for(const address of ['/food/weight','/progress?section=food','/progress?section=food&foodview=calendar','/progress?section=food&foodview=weight']){
    await p.evaluate(url=>go(url),address);await ready();assert.equal(new URL(p.url()).pathname,'/food','legacy address reaches the single food implementation');assert.equal(await p.locator('.nutrition-back').count(),1);await fits(address);
   }
   await home();await p.locator('[data-nutrition-feature=needs]').click();await ready();await p.locator('.nutrition-back').click();await ready();await home();assert.equal(await p.locator('[data-nutrition-feature=needs] .progress-new:not(.seen)').count(),0,'opened tool stays seen');
   // Date picker/arrows and the same-row Today chip retain the selected day on returning from Add food.
   await p.locator('#fd-prev').click();await ready();const past=new URL(p.url()).searchParams.get('d');assert(past);assert.equal(await p.locator('.nutrition-date-row #fd-today').count(),1);
   await p.locator('.meal-breakfast [data-add]').click();await until(p,()=>App.pageReady&&!!document.querySelector('#thread-text'),'food entry');assert.equal(new URL(p.url()).searchParams.get('d'),past);assert.equal(new URL(p.url()).searchParams.get('meal'),'breakfast');
   const draft='Fictional unsent lunch note';await p.locator('#thread-text').fill(draft);await p.locator('.thread-heading h1').click();assert.equal(await p.locator('#thread-text').inputValue(),draft);
   assert.equal(await p.locator('#thread-text').evaluate(n=>document.activeElement===n),false,'background dismisses keyboard focus');
   assert.equal(await p.locator('.keyboard-done,.keyboard-done-bar').count(),0);assert(Number.parseFloat(await p.locator('#thread-text').evaluate(n=>getComputedStyle(n).fontSize))>=16);
   await p.locator('.thread-heading .back').click();await ready();assert.equal(new URL(p.url()).searchParams.get('d'),past);await p.locator('.meal-breakfast [data-add]').click();await until(p,()=>App.pageReady&&!!document.querySelector('#thread-text'),'return to draft');assert.equal(await p.locator('#thread-text').inputValue(),draft);await p.locator('#thread-text').fill('');
   if(who==='typical'&&size.root===16){
    // Entered numbers cannot call a catalog/model. The final explicit confirmation must keep the chosen day.
    await p.locator('#thread-plus').click();await p.locator('.sheet .thread-tools button',{hasText:'Manual'}).click();await p.waitForSelector('#ty');
    await p.locator('#ty [name=name]').fill('Fictional past-day meal');await p.locator('#ty [name=kcal]').fill('180');await p.locator('#ty [name=protein_g]').fill('10');await p.locator('#ty button.primary').click();
    await until(p,()=>!!document.querySelector('#thread-review:not([hidden]):not([disabled])'),'ready for review');
    await p.goto(base+'/food/describe');await until(p,()=>App.pageReady&&!!document.querySelector('#thread-review:not([hidden]):not([disabled])'),'resume review without date in URL');await p.locator('#thread-review').click();await p.waitForSelector('#food-final-review');assert.match(await p.locator('.review-where').innerText(),/Yesterday/);
    await p.locator('#review-confirm').click();await p.waitForSelector('#food-final-review',{state:'detached'});
    const day=await c.request.get(base+'/api/food/day?d='+past);assert.equal(day.status(),200);const savedDay=await day.json(),entries=savedDay.entries.filter(e=>e.name==='Fictional past-day meal');assert.equal(savedDay.day,past);assert(entries.some(e=>e.meal==='breakfast'),'confirmed food is on the selected day and meal');
    const today=await(await c.request.get(base+'/api/food/day')).json();assert(!today.entries.some(e=>e.name==='Fictional past-day meal'),'past-day food cannot appear in today’s log');
   }
   await home();await p.locator('#fd-prev').click();await ready();await p.locator('#fd-today').click();await ready();assert.equal(await p.locator('#fd-today').count(),0);
   // Media entry points use the existing tools; camera and AI availability are stand-ins for this check only.
   await p.evaluate(()=>{App.me.ai_ok=true;App.me.ai_access={...(App.me.ai_access||{}),food:{available:true,entitled:true}};});
   const chooser=p.waitForEvent('filechooser');await p.locator('#fq-photo').click();const photo=await chooser;assert.equal(await photo.element().getAttribute('capture'),'environment');await photo.setFiles([]);await home();await p.locator('#fq-scan').click();await p.waitForSelector('#sc-f');await p.locator('.sheet [data-close]').click();
   const signedNative=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_nutrition_'+who,password:'green teapot on the hill',app:true}});assert.equal(signedNative.status(),200);const nativeToken=(await signedNative.json()).token;assert(nativeToken);
   await p.evaluate(({token,base})=>{App.me.ai_ok=false;Native.on=true;Native.base=base;Native.token=token;Native.foodHealthOn=async()=>false;},{token:nativeToken,base});await home();assert.equal(await p.locator('[data-nutrition-feature=health]').count(),1);assert.equal(await p.locator('[data-nutrition-feature=import]').count(),0);await p.evaluate(()=>{Native.on=false;Native.base='';Native.token=null;});
   // An unavailable summary still leaves every discovery link usable and no invented count.
   await c.route('**/api/progress/overview',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable facts'}}));await p.evaluate(()=>App.cache.delete('/api/progress/overview'));await home();assert.equal(await p.locator('#nutrition-explore a').count(),7);assert.equal(await p.locator('.error-page').count(),0);
   await fits('final');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert(!writes.some(w=>/photo|estimate|resolve/.test(w)),'no photo/provider work');console.log(`Nutrition ${who} ${size.width}/${size.root} ${theme}: compact log, own discovery, details/legacy/back, date/draft/media and unavailable PASS`);await c.close();
  }
 }
 }finally{for(const c of cleanup){await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:'green teapot on the hill'}});await c.close();}await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
