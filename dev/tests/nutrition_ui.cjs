// Real fictional accounts and server data; media/AI availability stand-ins never send photos or provider work.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(p.nutritionDiagnostics)+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,ready:App.pageReady,bootFailed:globalThis.KinettaBoot?.failed,assets:globalThis.nutritionBootAssets,assetErrors:globalThis.nutritionAssetErrors,text:document.body.textContent.slice(-600)}))));}
(async()=>{
 const fixtureOutput=cp.execFileSync('python3',['dev/tests/nutrition_fixture.py'],{env:process.env,encoding:'utf8'});
 process.stdout.write(fixtureOutput);
 const fixture=JSON.parse(fixtureOutput.trim().split(/\r?\n/).at(-1)),FIXTURE_NOW=new Date(fixture.now);
 const b=await chromium.launch(),cleanup=[];
 try{
 for(const who of ['empty','typical','heavy']){
  const auth=await b.newContext();assert.equal((await auth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_nutrition_'+who,password:'green teapot on the hill'}})).status(),200);cleanup.push(auth);const storage=await auth.storageState();
  let savedMealAdded=false;const sizes=who==='empty'?[{width:390,height:844,root:16}]:[{width:390,height:844,root:16},{width:330,height:844,root:16}];
  for(const size of sizes)for(const theme of ['light','dark']){
   if(process.env.KINETTA_NUTRITION_CASE&&process.env.KINETTA_NUTRITION_CASE!==`${who}-${size.width}-${theme}`)continue;
   const c=await b.newContext({storageState:storage,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:fixture.timezone}),p=await c.newPage(),errors=[],consoleErrors=[],writes=[],failed=[];await p.clock.setFixedTime(FIXTURE_NOW);p.nutritionDiagnostics={errors,consoleErrors,failed};p.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
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
   const compactReadout=async selector=>{
    const details=await p.locator(selector+' .chart-fact-readout').evaluate(n=>({
     rows:[...n.children].map(row=>row.className),
     background:getComputedStyle(n).backgroundColor,
     border:getComputedStyle(n).borderTopWidth,
     radius:getComputedStyle(n).borderTopLeftRadius,
     padding:getComputedStyle(n).padding,
     labels:[...n.querySelectorAll('.chart-fact-label')].map(s=>({size:getComputedStyle(s).fontSize,weight:getComputedStyle(s).fontWeight})),
     values:[...n.querySelectorAll('.chart-fact b')].map(s=>({size:getComputedStyle(s).fontSize,weight:getComputedStyle(s).fontWeight})),
     columns:getComputedStyle(n.querySelector('.chart-fact-grid')).gridTemplateColumns.split(' ').length,
     factBoxes:[...n.querySelectorAll('.chart-fact')].map(f=>({x:f.getBoundingClientRect().x,y:f.getBoundingClientRect().y,labelX:f.querySelector('.chart-fact-label').getBoundingClientRect().x,valueX:f.querySelector('b')?.getBoundingClientRect().x})),
     headingLine:(()=>{const h=n.querySelector('.chart-fact-heading'),d=h.querySelector('.chart-fact-date'),t=[...d.childNodes].find(x=>x.nodeType===Node.TEXT_NODE),r=document.createRange();r.selectNodeContents(t);const box=x=>({x:x.x,y:x.y,width:x.width,height:x.height}),date=r.getBoundingClientRect(),hint=h.querySelector('.readout-hint')?.getBoundingClientRect(),edit=h.querySelector('.ro-edit')?.getBoundingClientRect();return{line:box(h.getBoundingClientRect()),date:box(date),hint:hint&&box(hint),edit:edit&&box(edit)};})(),
     text:n.textContent,
     width:n.getBoundingClientRect().width,scroll:n.scrollWidth
    }));
    assert.equal(details.rows.length,2,selector+' readout has a date/action header and a fact grid');
    assert(details.rows[0].includes('chart-fact-heading')&&details.rows[1].includes('chart-fact-grid'),selector+' readout sections stay ordered');
    assert.equal(details.background,'rgba(0, 0, 0, 0)',selector+' readout is borderless and unfilled');
    assert.equal(details.border,'0px');assert.equal(details.radius,'0px');assert.equal(details.padding,'0px');
    assert(details.labels.length&&details.labels.every(s=>s.size==='13px'&&s.weight==='500'),selector+' labels follow the 13px/500 standard');
    assert(details.values.length&&details.values.every(s=>s.size==='15px'&&s.weight==='600'),selector+' values use 15px semibold type');
    assert(details.scroll<=details.width+1,selector+' readout does not overflow its chart');
    assert(!details.text.includes('<'),selector+' readout text contains no raw HTML');
    assert(details.factBoxes.every(f=>Math.abs(f.x-f.labelX)<1&&(f.valueX==null||Math.abs(f.x-f.valueX)<1)),selector+' fact labels and values share a left-aligned column');
    assert(details.columns>=1,selector+' fact grid has columns');
    return details;
   };
   await home();
   assert.equal(await p.locator('h1').innerText(),'Nutrition');assert.equal(await p.locator('.view-nav,.pbar,.food-library-link,.backtoday,.mealact').count(),0,'no stacked navigation or meal footer');
   assert.equal(await p.locator('#nutrition-explore a').count(),8);assert.equal(await p.locator('#fd-explore h2').innerText(),'Explore your food');
   assert.deepEqual(await p.locator('#nutrition-explore').evaluate(n=>{const rows=[...n.querySelectorAll('.progress-tile')],s=getComputedStyle(rows[0]);return{list:getComputedStyle(n).display,fill:s.backgroundColor,hairline:s.borderBottomStyle,full:rows.every(r=>Math.abs(r.getBoundingClientRect().width-n.getBoundingClientRect().width)<1)};}),{list:'flex',fill:'rgba(0, 0, 0, 0)',hairline:'solid',full:true},'Explore your food is plain full-width rows with hairlines (#764)');
   assert(await p.locator('#nutrition-explore .small').evaluateAll(ns=>ns.length>0&&ns.every(n=>{const s=getComputedStyle(n);return s.display==='block'&&s.overflow==='visible'&&s.webkitLineClamp==='none'&&n.scrollHeight<=n.clientHeight+1;})),'Explore food details wrap without truncation');assert(await p.locator('#nutrition-explore .small').evaluateAll(ns=>ns.every(n=>!/→\s*$/.test(n.textContent.trim()))),'Explore food details omit the redundant terminal arrow');
   for(const selector of ['#fq-add','#fq-photo','#fq-scan','#fd-prev','#fd-next','[data-add]','[data-more]','#nutrition-explore a'])for(const el of await p.locator(selector).all()){
    const rect=await el.boundingBox();assert(rect.height>=44,selector+' target height');assert(rect.width>=44,selector+' target width');
   }
   for(const group of await p.locator('.meal-actions').all()){
    const add=group.locator('[data-add]'),more=group.locator('[data-more]');
    const addBox=await add.boundingBox();assert(addBox.height>=44&&addBox.width>=44,'meal plus keeps a 44px target');assert.match(await add.getAttribute('aria-label'),/^Add food to /,'meal plus has a spoken label');
    if(await more.count()){const moreBox=await more.boundingBox();assert(Math.abs(addBox.y-moreBox.y)<1,'meal actions stay together when wrapping');}
   }
   assert(await p.locator('#fd-meals .meal > h2').evaluateAll(ns=>ns.every(n=>getComputedStyle(n,'::before').display==='none')),'Nutrition meal headings have no decorative grey dot');
   for(const title of await p.locator('.progress-tile-name').all())assert(await title.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'tile title fits without clipping');
   assert.equal(await p.locator('.nutrition-date-row #fd-date').count(),1);assert.equal(await p.locator('#fq-add').count(),1);
   if(who!=='empty'){const facts=await(await c.request.get(base+'/api/progress/overview')).json();assert.match(await p.locator('[data-nutrition-feature=overview]').innerText(),new RegExp('Protein goal '+facts.food.protein_days+'/7'),'tile agrees with own facts after earlier confirmed food saves, including zero');}
   if(who==='empty'){
    assert.equal(await p.locator('.nutrition-start').count(),1);assert.equal(await p.locator('.nutrition-body-prompt').count(),1);assert.equal(await p.locator('#nutrition-explore .progress-new:not(.seen)').count(),8);
    assert(!/0 (saved|logged)/.test(await p.locator('#nutrition-explore').innerText()));
   }else{
    assert.match(await p.locator('[data-nutrition-feature=recipes]').innerText(),new RegExp(((who==='typical'?4:13)+(savedMealAdded?1:0))+' saved'));
    assert.match(await p.locator('[data-nutrition-feature=weight]').innerText(),/(last logged|trend)/);
    assert.equal(await p.locator('[data-nutrition-feature=weight] .progress-new:not(.seen)').count(),0);
    const macros=await p.locator('.nutrition-summary-link .macro').evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector('.macro-line b').textContent.trim(),state:n.dataset.targetState,color:getComputedStyle(n.querySelector('.macro-target-bar')).backgroundColor,height:n.querySelector('.macro .track')?.getBoundingClientRect().height||n.querySelector('.track').getBoundingClientRect().height})));assert.deepEqual(macros.map(m=>m.name),['Protein','Carbs','Fat'],'Nutrition summary has three labeled macros');assert.deepEqual(macros.map(m=>m.state),who==='typical'?['under','under','under']:['over','over','over'],'macro bar state follows each saved target');assert(macros.every(m=>m.height<=4.5),'macro bars stay slim');const statusColors=await p.evaluate(()=>{const n=document.createElement('i');document.body.append(n);n.style.backgroundColor='var(--prog)';const under=getComputedStyle(n).backgroundColor;n.style.backgroundColor='var(--alert)';const over=getComputedStyle(n).backgroundColor;n.remove();return{under,over};});assert(macros.every(m=>m.color===statusColors[who==='typical'?'under':'over']),'macro fill color identifies under or over target');
    const goals=p.locator('#fd-goal'),goalBox=await goals.boundingBox(),goalStyle=await goals.evaluate(n=>({border:getComputedStyle(n).borderTopWidth,background:getComputedStyle(n).backgroundColor}));assert.equal(await goals.evaluate(n=>n.tagName),'A','Goals is a link');assert.equal(await goals.getAttribute('href'),'/food/setup');assert(goalBox.height>=44&&goalStyle.border==='0px'&&goalStyle.background==='rgba(0, 0, 0, 0)','Goals remains a plain 44px text link');
    if(size.root===16){const lunch=await p.locator('.meal-lunch').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();if(who==='typical')assert(lunch.y+lunch.height<nav.y-8,'Breakfast and Lunch clear the tab bar');}
    assert.equal(await p.locator('.meal-calories').first().evaluate(n=>getComputedStyle(n.querySelector('small')).display),'inline');
   }
   if(who==='empty'&&size.width===390&&theme==='light'){
    await c.route('**/api/food/check-in',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable check-in'}}));
    await c.route('**/api/food/weekly-review',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable weekly review'}}));
    await p.evaluate(()=>{App.cache.delete('/api/food/check-in');App.cache.delete('/api/food/weekly-review');go('/food?view=overview&from=progress');});await ready();
    const checkinFold=p.locator('.insights-review').filter({hasText:'Your weekly check-in'});await checkinFold.locator('summary').click();
    const checkinRetry=p.locator('[data-checkin-retry]');await checkinRetry.waitFor({state:'visible'});assert.match(await checkinFold.innerText(),/Couldn’t load your weekly check-in\. Your food log is still available\./);assert.equal(await checkinRetry.innerText(),'Try again');
    await checkinRetry.click();await checkinRetry.waitFor({state:'visible'});
    const weeklyFold=p.locator('.insights-review').filter({hasText:'Your week in food'});await weeklyFold.locator('summary').click();
    const weeklyRetry=p.locator('[data-weekly-retry]');await weeklyRetry.waitFor({state:'visible'});assert.match(await weeklyFold.innerText(),/Couldn’t load your weekly food review\./);assert.equal(await weeklyRetry.innerText(),'Try again');
    await weeklyRetry.click();await weeklyRetry.waitFor({state:'visible'});await c.unroute('**/api/food/check-in');await c.unroute('**/api/food/weekly-review');await home();
   }
   if(who!=='empty'){
    const details=p.locator('#fd-details details.bd');
    if(await details.count()){
     if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
     assert.equal(await details.locator('summary').evaluate(n=>getComputedStyle(n).display),'flex');
     assert((await details.locator('summary').boundingBox()).height>=44,'energy disclosure keeps a44px target');
     assert(await details.locator('summary').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=15),'energy disclosure keeps readable type');
     for(const row of await details.locator('.brow').all()){
      const label=await row.locator(':scope > span').boundingBox(),value=await row.locator(':scope > b').boundingBox();
      assert(label.x+label.width<=value.x-4,'energy label/qualification and amount stay in separate columns');
     }
     for(const icon of await details.locator('.exi svg').all()){const r=await icon.boundingBox();assert(r.width<=16.1&&r.height<=16.1,'energy workout icon stays16px');}
     await details.locator('summary').click();await p.evaluate(()=>scrollTo(0,0));
    }
   }
   await fits('home');if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(350);await p.screenshot({path:`${out}/nutrition-${who}-${size.width}-${theme}.png`,fullPage:true,animations:'disabled'});}
   if(who==='typical'&&size.width===390&&theme==='light'){
    const day=await(await c.request.get(base+'/api/food/day?d='+fixture.today)).json();assert(day.entries.length,'fixture has a food to save');
    const saved=await c.request.post(base+'/api/food/meals',{headers:{Origin:base},data:{name:'Fictional saved meal',entry_ids:[day.entries[0].id]}});assert.equal(saved.status(),200,'fictional meal fixture saves');savedMealAdded=true;
    await p.evaluate(()=>go('/food/meals'));await ready();const heading=p.locator('.library-section h2').filter({hasText:'Saved combinations'});await heading.waitFor();assert.equal(await p.getByText('Saved combinations',{exact:true}).count(),1);assert.equal(await p.getByText('Saved meals',{exact:true}).count(),0);
    await p.locator('[data-meal]').first().click();await p.locator('#sv-del').click();const ask=p.locator('.confirm-sheet');await ask.waitFor();
    assert.equal(await p.getByRole('alertdialog',{name:'Delete “Fictional saved meal”?'}).count(),1);assert.match(await ask.innerText(),/removed from Saved combinations\. Food already in your food log stays\./);await p.locator('[data-confirm-cancel]').click();await p.locator('.confirm-sheet').waitFor({state:'detached'});assert.equal(await p.locator('#sv').count(),1,'cancel keeps the saved combination portion sheet open');await p.locator('.sheet [data-close]').click();await home();
   }
   // One summary leads to the same analysis used by legacy Progress links; all options live in cards.
   if(who!=='empty'){
    const summary=await p.locator('.nutrition-day-summary').boundingBox();await p.mouse.click(summary.x+6,summary.y+summary.height/2);await ready();assert.equal(await p.locator('h1').innerText(),'Insights');
    await until(p,()=>!!document.querySelector('.insights-range #n-range'),'range precedes overview content');
    await p.locator('#n-range').click();await p.locator('[data-pk="7"]').click();await ready();assert.equal(new URL(p.url()).searchParams.get('r'),'7');
    await p.locator('.nutrition-back').click();await ready();await home();
    await p.locator('#fd-goal').click();await p.waitForSelector('#tg');assert.equal(await p.locator('.sheet h2').innerText(),'Goals');
    for(const input of await p.locator('#tg input').all())assert(Number.parseFloat(await input.evaluate(n=>getComputedStyle(n).fontSize))>=16);
    await p.locator('.sheet [data-close]').click();
   }
   for(const view of ['overview','energy','macros','weight','needs','weeks','calendar','trends']){
    await p.evaluate(view=>go('/food?view='+view),view);await ready();const weight=view==='weight';assert.equal(await p.locator(weight?'.weight-heading [data-back]':'.nutrition-back').count(),1,view+' back');if(weight){assert.equal(new URL(p.url()).pathname,'/progress/weight');assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'progress');}assert.equal(await p.locator('.view-nav,.pbar').count(),0,view+' no global bars');await fits(view);
    if(view==='weeks'){assert.equal(new URL(p.url()).searchParams.get('view'),'overview');assert(await p.locator('#nt-weeks-fold').evaluate(n=>n.open),'Old weekly links open the folded table in Insights');if(who==='empty'){await p.locator('#nt-weeks .empty').waitFor();assert.match(await p.locator('#nt-weeks').innerText(),/No food logged yet/);}else{await p.locator('#nt-weeks .tbl').waitFor();assert.match(await p.locator('#nt-weeks').innerText(),/Last 26 weeks.*separate from the selected chart range/s);const fixed=await p.locator('#nt-weeks th').first().boundingBox();await p.locator('#nt-weeks .tblwrap').evaluate(n=>n.scrollLeft=n.scrollWidth);const scrolled=await p.locator('#nt-weeks th').first().boundingBox();assert(Math.abs(fixed.x-scrolled.x)<2,'Weekly date stays fixed while amounts scroll');}}
    if(view==='calendar'){assert.equal(await p.locator('.food-calendar').count(),0,'No90-tile calendar');assert(await p.locator('.food-history-date input').isVisible());const dates=await p.locator('.food-day-list a').evaluateAll(ns=>ns.map(n=>new URL(n.href).searchParams.get('d')));assert.deepEqual(dates,dates.slice().sort().reverse(),'Logged dates stay newest first');assert(dates.length<=35,'Only logged dates are listed');assert.equal(dates.length,who==='empty'?0:who==='typical'?7:35);const chosen=dates.at(-1)||'2026-01-01';await p.locator('.food-history-date input').fill(chosen);await ready();assert.equal(new URL(p.url()).searchParams.get('d'),chosen,'Date picker opens the chosen log day');await p.evaluate(()=>go('/food?view=calendar'));await ready();}
    if(view==='macros'&&who==='typical'){await compactReadout('#nt-protein');const fit=await p.locator('#nt-protein').evaluate(box=>{const svg=box.querySelector('svg'),view=svg?.viewBox.baseVal,bad=[];for(const node of box.querySelectorAll('.yl,.period-tick,.avgline-label')){const b=node.getBBox();if(b.x<-.5||b.y<-.5||b.x+b.width>(view?.width||0)+.5||b.y+b.height>(view?.height||0)+.5)bad.push({className:node.getAttribute('class'),box:{x:b.x,y:b.y,width:b.width,height:b.height}});}return bad;});assert.deepEqual(fit,[],'protein chart labels stay inside the SVG at 16px');if(out&&process.env.KINETTA_TOTALS_CAPTURE_SET==='1'){fs.mkdirSync(out,{recursive:true});await p.locator('#nt-protein').screenshot({path:`${out}/protein-${size.width}-${theme}.png`});}}
    if(view==='energy'&&who==='typical'){const readout=await compactReadout('#nt-energychart');assert(readout.headingLine.hint&&Math.abs(readout.headingLine.date.y-readout.headingLine.hint.y)<1,'date and hint share the header line');assert(readout.headingLine.edit&&Math.abs(readout.headingLine.date.y-readout.headingLine.edit.y)<1,'Edit stays on the right of the header line');assert(readout.headingLine.edit.x+readout.headingLine.edit.width>=readout.headingLine.line.x+readout.headingLine.line.width-1,'Edit aligns to the right edge');assert.equal(await p.locator('#nt-energychart .chart-fact-heading .ro-edit').innerText(),'Edit this day ›','daily edit label stays clear');assert(await p.locator('#nt-energychart .chart-fact-grid .chart-fact-label').count()>=4,'energy readout labels each fact');assert.match(await p.locator('#nt-energychart .chart-fact-grid .chart-fact').filter({hasText:'Weight'}).locator('.chart-fact-detail').innerText(),/Trend/,'weight trend sits below its value');const factRows=new Set(readout.factBoxes.map(f=>f.y));if(size.width===330)assert.equal(factRows.size,2,'energy facts wrap to exactly two rows at 330px');if(size.width===390)assert.equal(factRows.size,1,'energy facts stay on one row at 390px');
     const disclosures=p.locator('.estimate-disclosure');assert.equal(await disclosures.count(),2,'both chart explanations use disclosures');const expectedSummary='ⓘ How this is estimated';
     for(let i=0;i<2;i++){const disclosure=disclosures.nth(i),summary=disclosure.locator('summary'),copy=disclosure.locator('p'),text=await copy.textContent();assert.equal(await summary.innerText(),expectedSummary);assert((await summary.boundingBox()).height>=44,'estimate disclosure keeps a 44px target');assert.equal(await disclosure.evaluate(n=>n.open),false,'estimate disclosure starts closed');assert.equal(await summary.evaluate(n=>getComputedStyle(n).fontSize),'13px');assert.equal(await summary.evaluate(n=>getComputedStyle(n).color),await copy.evaluate(n=>getComputedStyle(n).color),'disclosure label is muted like its explanation');assert(text.length>60,'explanation remains available inside the disclosure');if(i===0)assert.match(text,/The goal line is your food target; eating below it does not by itself establish a calorie deficit/);else assert.match(text,/^Adds estimated burn minus logged food/);await summary.evaluate(n=>n.click());assert.equal(await disclosure.evaluate(n=>n.open),true);assert(await copy.isVisible());await summary.evaluate(n=>n.click());assert.equal(await disclosure.evaluate(n=>n.open),false);}
     if(out&&process.env.KINETTA_READOUT_CAPTURE_SET==='1'){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/energy-card-${size.width}-${theme}.png`,fullPage:true,animations:'disabled'});}}
    if(view==='trends'&&who==='typical'&&await p.locator('#nt-cum .chart-fact-readout').count()){await compactReadout('#nt-cum');const detail=p.locator('#nt-cum .chart-fact-detail');assert.match(await detail.innerText(),/^Day: [\d,]+ kcal (deficit|surplus)$/,'running deficit detail formats the daily amount as kcal');assert.equal(await detail.locator('b').evaluate(n=>getComputedStyle(n).fontWeight),'600','running deficit daily amount is semibold');}
    await p.locator(weight?'.weight-heading [data-back]':'.nutrition-back').click();await ready();
   }
   for(const address of ['/food/weight','/progress?section=food','/progress?section=food&foodview=calendar','/progress?section=food&foodview=weight']){
    const origin=new URL(p.url()).pathname+new URL(p.url()).search,weight=address==='/food/weight'||address.endsWith('foodview=weight');await p.evaluate(url=>go(url),address);await ready();assert.equal(new URL(p.url()).pathname,weight?'/progress/weight':'/food','legacy address reaches its canonical implementation');assert.equal(await p.locator(weight?'.weight-heading [data-back]':'.nutrition-back').count(),1);await fits(address);if(weight){assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'progress');await p.locator('.weight-heading [data-back]').click();await ready();assert.equal(new URL(p.url()).pathname+new URL(p.url()).search,origin,'Legacy Weight Back retains its actual origin');}
   }
   await home();await p.locator('[data-nutrition-feature=needs]').click();await ready();await p.locator('.nutrition-back').click();await ready();await home();assert.equal(await p.locator('[data-nutrition-feature=needs] .progress-new:not(.seen)').count(),0,'opened tool stays seen');
   // Date picker/arrows and the same-row Today chip retain the selected day on returning from Add food.
   await p.locator('#fd-prev').click();await ready();const past=new URL(p.url()).searchParams.get('d');assert(past);assert.equal(await p.locator('.nutrition-date-row #fd-today').count(),1);
   await p.locator('.meal-breakfast [data-add]').click();await until(p,()=>App.pageReady&&!!document.querySelector('#thread-text'),'food entry');assert.equal(new URL(p.url()).searchParams.get('d'),past);assert.equal(new URL(p.url()).searchParams.get('meal'),'breakfast');
   const draft='Fictional unsent lunch note';await p.locator('#thread-text').fill(draft);await p.locator('#thread-context').click();await p.locator('#thread-destination').waitFor();assert.equal(await p.locator('#thread-text').inputValue(),draft);await p.locator('.scrim:has(#thread-destination) [data-close]').click();await p.locator('.scrim').waitFor({state:'detached'});
   assert.equal(await p.locator('#thread-text').evaluate(n=>document.activeElement===n),false,'background dismisses keyboard focus');
   assert.equal(await p.locator('.keyboard-done,.keyboard-done-bar').count(),0);assert(Number.parseFloat(await p.locator('#thread-text').evaluate(n=>getComputedStyle(n).fontSize))>=16);
   await p.locator('.thread-heading .back').click();await ready();assert.equal(new URL(p.url()).searchParams.get('d'),past);await p.locator('.meal-breakfast [data-add]').click();await until(p,()=>App.pageReady&&!!document.querySelector('#thread-text'),'return to draft');assert.equal(await p.locator('#thread-text').inputValue(),draft);await p.locator('#thread-text').fill('');
   if(who==='typical'){
    // Entered numbers cannot call a catalog/model. One-tap Add keeps the chosen day.
    await p.locator('#thread-plus').click();await p.locator('.sheet .thread-tools button',{hasText:'Manual'}).click();await p.waitForSelector('#ty');
    await p.locator('#ty [name=name]').fill('Fictional past-day meal');await p.locator('#ty [name=kcal]').fill('180');await p.locator('#ty [name=protein_g]').fill('10');await p.locator('#ty button.primary').click();
    await until(p,()=>!!document.querySelector('#thread-review:not([hidden]):not([disabled])'),'ready for review');
    await p.goto(base+'/food/describe');await until(p,()=>App.pageReady&&!!document.querySelector('#thread-review:not([hidden]):not([disabled])'),'resume review without date in URL');await p.locator('#thread-review-add').click();await until(p,()=>document.querySelector('#toast')?.textContent.includes('Added to Breakfast'),'quick Add keeps the selected day and meal');
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
   await c.route('**/api/progress/overview',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable facts'}}));await p.evaluate(()=>App.cache.delete('/api/progress/overview'));await home();assert.equal(await p.locator('#nutrition-explore a').count(),8);assert.equal(await p.locator('.error-page').count(),0);
   await fits('final');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert(!writes.some(w=>/photo|estimate|resolve/.test(w)),'no photo/provider work');console.log(`Nutrition ${who} ${size.width}/${size.root} ${theme}: compact log, own discovery, details/legacy/back, date/draft/media and unavailable PASS`);await c.close();
  }
 }
 }finally{for(const c of cleanup){await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:'green teapot on the hill'}});await c.close();}await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
