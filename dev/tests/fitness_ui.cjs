// Actual private fictional histories and production predictions; no providers/devices or unrelated writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
function duration(seconds){seconds=Math.round(seconds);const hours=Math.floor(seconds/3600),minutes=Math.floor((seconds%3600)/60),rest=seconds%60;return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}`:`${minutes}:${String(rest).padStart(2,'0')}`;}
async function until(p,fn,label){for(let i=0;i<180;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}const state=await p.evaluate(()=>({url:location.href,ready:typeof App==='undefined'?null:App.pageReady,key:typeof App==='undefined'?null:App.page?.key,body:document.body.innerText.slice(0,240)})).catch(e=>({pageError:e.message}));throw Error(label+' '+JSON.stringify(state));}
async function predictionTable(p,data){
 const card=p.locator('#fi-pred .fitness-predictions'),rows=card.locator('[data-prediction-row]');
 assert.equal(await card.count(),1,'Card B is present when current predictions exist');
 assert.equal(await rows.count(),data.predictions.length,'one compact row per supported race distance');
 assert.equal(await card.locator('.fitness-run-score small').innerText(),'Run score');
 assert.equal(await card.locator('.fitness-run-score b').innerText(),String(Math.round(data.vdot_now)),'Card B shows the rounded current Run score once');
 assert.equal(await card.locator('.prediction-table-head').innerText(),`Distance\nNow\nPace ${await p.evaluate(()=>U.pu())}\nBest`,'pace unit appears in its column heading');
 for(let i=0;i<data.predictions.length;i++){
  const pred=data.predictions[i],row=rows.nth(i),distance=pred.label==='Half marathon'?'Half':pred.label,best=Number.isFinite(pred.best_s)&&pred.best_s>0?duration(pred.best_s):'–';
  assert.equal(await row.locator('[role=cell]').nth(0).innerText(),distance);
  assert.equal(await row.locator('.prediction-time').innerText(),'≈'+duration(pred.seconds));
  assert.equal(await row.locator('.prediction-pace').innerText(),await p.evaluate(v=>U.pace(v),pred.seconds/pred.distance_m*1000));
  assert.equal(await row.locator('.prediction-best').innerText(),best,'missing bests use a dash and dated years stay out of the table');
  const box=await row.boundingBox();assert(box.height>=44,`${pred.label} row keeps a 44px tap target`);
  if(pred.from?.activity_id){assert.equal(await row.evaluate(n=>n.tagName),'A');assert.equal(await row.getAttribute('href'),`/activity/${pred.from.activity_id}`,'linked prediction row opens its source activity');}
  else {assert.equal(await row.evaluate(n=>n.tagName),'DIV','row without a linked activity is not presented as an action');}
 }
 const info=card.locator('#fitness-estimates-info'),target=await info.boundingBox();assert(target.width>=44&&target.height>=44,'How estimates work icon keeps a 44px target');
 await info.click();await p.locator('.sheet h2').getByText('How estimates work').waitFor();
 assert.match(await p.locator('.sheet').innerText(),/past 90 days.*last 8 weeks of running mileage/);
 assert.equal(await p.locator('.sheet .prediction-source').count(),data.predictions.length,'the sheet lists the actual recent efforts used');
 if(out&&await p.evaluate(()=>innerWidth===390)){fs.mkdirSync(out,{recursive:true});const theme=await p.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');await p.screenshot({path:`${out}/race-predictions-info-390-${theme}.png`,animations:'disabled'});}
 assert.equal(await card.locator('.prediction-method').count(),0,'Card B has no inline expander');
 await p.locator('.sheet [data-close]').click();assert.equal(await p.locator('.sheet').count(),0,'the explanation sheet closes cleanly');
}
async function fitnessWarning(p,ramp){
 const warning=p.locator('[data-progress-chart="training-load"] .fitness-ramp-warning');
 assert.equal(await warning.count(),ramp>8?1:0,'load warning appears only above the high-ramp threshold');
 if(ramp>8){assert(await warning.isVisible(),'high load has a visible warning');assert.doesNotMatch(await warning.innerText(),/\bramp\b|\b8\.1\b/i,'warning hides the raw load increase');}
}
async function fitnessLanguage(p,data){
 const last=data.days.at(-1),load=p.locator('[data-progress-chart="training-load"]'),score=p.locator('#fi-pred .fitness-run-score');
 assert.deepEqual(await load.locator('.stat-row-item small').allTextContents(),['Fitness','Fatigue','Form']);
 const values=await load.locator('.stat-row-item b').allTextContents(),formValue=(last.form>0?'+':'')+Math.round(last.form);
 assert.equal(values[0],String(Math.round(last.fitness)),'Fitness retains its API value');
 assert.equal(values[1],String(Math.round(last.fatigue)),'Fatigue retains its API value');
 assert.equal(values[2],formValue,'Form retains its signed API value');
 assert.equal(await score.count(),1,'the current Run score is shown only in Card B');
 assert.equal(await p.locator('[data-progress-chart="run-score"]').count(),0,'there is no repeated standalone Run score card');
 assert.doesNotMatch(await p.locator('#fi-pred,#fi-body').allInnerTexts().then(texts=>texts.join('\n')),/\b(?:VDOT|ramp)\b/i,'visible Fitness wording uses Run score and hides raw internals');
 await fitnessWarning(p,data.ramp_7d);
}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'subpages_fixture.py')],{env:{...process.env,KINETTA_URL:base},stdio:'inherit'});
 const oldBestSetup=`from app import db
with db.connect() as c:
    user=c.execute('SELECT id FROM users WHERE login=%s',('zz_test_subpages_typical',)).fetchone()
    row=c.execute(\"SELECT activity_id FROM best_efforts WHERE user_id=%s AND sport='run' AND label='5K' ORDER BY start_time LIMIT 1\",(user['id'],)).fetchone()
    assert row
    result=c.execute(\"UPDATE best_efforts SET elapsed_s=%s,start_time=%s WHERE user_id=%s AND activity_id=%s AND sport='run' AND label='5K'\",(1170,'2024-05-01T12:00:00Z',user['id'],row['activity_id']))
    assert result.rowcount==1
`;
 cp.execFileSync('docker',['compose','-p',process.env.KINETTA_PROJECT||'kinettatest','exec','-T','app','python','-c',oldBestSetup],{stdio:'inherit'});
 const b=await chromium.launch();try{
 for(const state of ['empty','typical','heavy']){
  const login=await b.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_subpages_'+state,password:'green teapot on the hill'}})).status(),200);const units=state==='typical'?'metric':'imperial',unitUpdate=await login.request.put(base+'/api/profile',{data:{units}});assert.equal(unitUpdate.status(),200,'fictional runner units update');const auth=await login.storageState(),data=await(await login.request.get(base+'/api/fitness?days=3650')).json();await login.close();
  if(state!=='empty')assert(data.predictions.every(row=>'best_year'in row),'every prediction carries a dated all-time-best reference');
  if(state==='typical'){const five=data.predictions.find(row=>row.label==='5K');assert(five&&five.seconds>five.best_s&&five.best_s===1170&&five.best_year===2024,'slower current 5K estimate keeps the faster 2024 record as a reference');assert.equal(data.predictions.find(row=>row.label==='10K').best_s,null,'a prediction can have no recorded best at its exact distance');}
  for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:15},{width:390,height:844,root:16},...(state==='typical'?[{width:330,height:844,root:16}]:[])]){
   const c=await b.newContext({storageState:auth,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(req.method())){if(u.pathname!=='/api/challenges/signup/continue')writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>App.pageReady&&!!document.querySelector('#fi-pred .card')&&!document.querySelector('#fi-body .skeleton'),'Fitness ready');await p.goto(base+'/progress?view=fitness');await ready();await p.evaluate(()=>document.fonts.ready);
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'root does not overflow');assert((await p.evaluate(()=>document.documentElement.clientWidth))<=size.width+1,'configured viewport stays fixed');
   for(const card of await p.locator('#fi-pred > .card,#fi-body > .card').all())assert(await card.evaluate(n=>{const s=getComputedStyle(n);return [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].every(v=>parseFloat(v)>=16);}), '16px on every Fitness card');
   if(size.root<=16){for(const h of await p.locator('#fi-pred h2').all()){const v=await h.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(v>=17&&v<=20,'prediction heading scale');}for(const h of await p.locator('.progress-chart-heading h2').all())assert.equal(await h.evaluate(n=>getComputedStyle(n).fontSize),'15px','ChartCard title uses the compact hierarchy');}
   assert.equal(await p.locator('.discovery-grid').count(),0);assert.equal(await p.locator('#p-rng button').count(),0,'fitness range is not above predictions');
   const loadRanges=p.locator('#fi-range [data-fitness-range]');
   if(state==='empty')assert.equal(await loadRanges.count(),0,'training-load ranges stay hidden without history');
   else{
    assert.equal(await p.locator('#fi-range .underline-tabs').count(),1,'training load uses the plain tab row');
    assert.deepEqual(await loadRanges.allTextContents(),['1M','3M','1Y','All'],'training load offers the four plain range choices');
    assert.equal(await loadRanges.count(),4,'training load keeps four range choices');
    for(const button of await loadRanges.all()){const target=await button.boundingBox();assert(target.height>=44&&target.width>=44,'training-load range tabs keep 44px targets');}
   }
   assert.equal(await p.locator('#fi-range-score').count(),0,'only Card A has range tabs');
   if(state!=='empty')assert((await p.locator('#fi-range').boundingBox()).y<(await p.locator('#fi-pred').boundingBox()).y,'Fitness range controls stay with the chart above predictions');
   if(state==='empty'){assert.equal(await p.locator('#p-load .chart-expand').count(),0,'empty Fitness has no full-screen/zoom affordance');assert.equal(await p.locator('#fi-body .fitness-card-empty').count(),1,'empty Fitness shows one calm message instead of a chart');assert.equal(await p.locator('#fi-pred').isHidden(),true,'race predictions stay hidden until there is activity data');assert.equal(await p.locator('.pred').count(),0);}
   else{
    await predictionTable(p,data);
    if(state==='typical'&&size.width===390&&size.root===16&&theme==='light'){
     const firstLinked=p.locator('.prediction-table-row[href]').first(),linkedHref=await firstLinked.getAttribute('href');assert(linkedHref,'fixture includes a prediction with a linked best activity');await Promise.all([p.waitForURL('**'+linkedHref),firstLinked.click()]);assert.equal(new URL(p.url()).pathname,linkedHref,'selecting a linked race row opens its best activity');await p.goto(base+'/progress?view=fitness');await ready();
    }
    assert.equal(await p.locator('.prediction-table-row').count(),data.predictions.length,'predicted times are listed only once');
    assert.equal(await p.locator('.prediction-method,.prediction-note,.prediction-current').count(),0,'no inline explanation, footnote or duplicate current score remains');
    const geometry=await p.evaluate(()=>{const card=document.querySelector('.fitness-predictions'),s=getComputedStyle(card),rows=[...card.querySelectorAll('[data-prediction-row]')].map(n=>{const r=n.getBoundingClientRect(),cells=[...n.querySelectorAll('[role="cell"]')].map(c=>{const b=c.getBoundingClientRect();return{x:b.x,right:b.right,scroll:c.scrollWidth,client:c.clientWidth};});return{x:r.x,right:r.right,y:r.y,height:r.height,cells};}),head=card.querySelector('.prediction-table-head').getBoundingClientRect();return{padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),rows,headRight:head.right,cardRight:card.getBoundingClientRect().right};});assert(geometry.padding.every(v=>v>=16),'Card B has 16px insets');assert(geometry.rows.every(r=>r.height>=44&&r.x>=geometry.rows[0].x&&r.right<=geometry.cardRight+1),'prediction rows fit without clipping');for(const row of geometry.rows){assert(row.cells.every((c,i)=>c.scroll<=c.client+1&&(i===0||row.cells[i-1].right<=c.x+1)),`prediction values fit distinct columns: ${JSON.stringify(row.cells)}`);}
    if(size.root<=16){const type=await p.locator('.prediction-time').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(type<=22,'prediction times respect the compact type scale');const cardA=p.locator('[data-progress-chart="training-load"]'),cardBox=await cardA.boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(await cardA.isVisible(),'the Fitness Card A chart is visible');if(size.width===390)assert(cardBox.y+cardBox.height<nav.y,'Fitness Card A remains above the tab bar on the initial phone screen');}
    console.log('Fitness spacing',state,size.width,size.root,theme,JSON.stringify(geometry));
    assert.equal(await p.locator('[data-progress-chart="run-score"],#p-vdot,#fi-range-score').count(),0,'the third Run score chart is absent');assert.equal(await p.locator('#fi-pred .fitness-run-score').count(),1,'the score appears once beside Race predictions');
   }
   if(out&&state==='empty'&&size.width===390&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+'/race-predictions-empty-390-'+theme+'.png'});}
   if(out&&state==='typical'&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.locator('#fi-pred').screenshot({path:out+`/race-predictions-${size.width}-${theme}.png`,animations:'disabled'});}
   if(state==='typical'&&size.root===16){
    await fitnessLanguage(p,data);
    // Keep the fictional history and predictions; change only the browser response's load increase.
    let ramp=8,served=0;
    await c.route('**/api/fitness?*',r=>{served++;return r.fulfill({json:{...data,ramp_7d:ramp}});});
    for(const value of [8,8.1]){ramp=value;const previous=served;await p.reload();await ready();assert(served>previous,'load-warning variant uses the browser-local response');await fitnessWarning(p,ramp);}
    if(size.width===390&&size.root===16){
     const noLinkData={...data,predictions:data.predictions.map((row,index)=>index===0?{...row,from:{...row.from,activity_id:null}}:row)};
     await c.route('**/api/fitness?*',r=>r.fulfill({json:noLinkData}));await p.reload();await ready();await predictionTable(p,noLinkData);assert.equal(await p.locator('.prediction-table-row').first().evaluate(n=>n.tagName),'DIV','a best without an activity id is not rendered as a link');
     await c.route('**/api/fitness?*',r=>r.fulfill({json:{...data,vdot_now:null,predictions:[]}}));await p.reload();await ready();assert.equal(await p.locator('#fi-pred').isHidden(),true,'Card B stays hidden when there are no recent runs');assert.equal(await p.locator('.fitness-card-empty').count(),0,'old activity data still renders Card A rather than an empty state');assert.equal(await p.locator('#p-load .fitness-load-line').count(),1,'Fitness history remains visible without recent race efforts');if(out){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+`/fitness-no-recent-runs-390-${theme}.png`,fullPage:true,animations:'disabled'});}
    }
   }
   if(state==='heavy')await require('./progress_polish_ui.cjs')(p,{size,theme});
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Fitness ${state} ${size.width}/${size.root} ${theme} PASS`);
  }
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
