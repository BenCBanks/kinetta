// Actual private fictional histories and production predictions; no providers/devices or unrelated writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
function duration(seconds){seconds=Math.round(seconds);const hours=Math.floor(seconds/3600),minutes=Math.floor((seconds%3600)/60),rest=seconds%60;return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}`:`${minutes}:${String(rest).padStart(2,'0')}`;}
async function until(p,fn,label){for(let i=0;i<180;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);}
async function fitnessWarning(p,ramp){
 const warning=p.locator('#fi-summary .fitness-current .callout.warn');
 assert.equal(await warning.count(),ramp>8?1:0,'load warning appears only above the high-ramp threshold');
 if(ramp>8){assert(await warning.isVisible(),'high load has a visible warning');assert.doesNotMatch(await warning.innerText(),/\bramp\b|\b8\.1\b/i,'warning hides the raw load increase');}
}
async function fitnessLanguage(p,data){
 const last=data.days.at(-1),form=(last.form>0?'+':'')+Math.round(last.form),summary=p.locator('#fi-summary .fitness-current');
 assert.deepEqual(await summary.locator('.me-form-nums small').allTextContents(),['Fitness','Form',...(data.vdot_now?['Run score']:[])]);
 assert.deepEqual(await summary.locator('.me-form-nums b').allTextContents(),[String(Math.round(last.fitness)),form,...(data.vdot_now?[String(data.vdot_now)]:[])],'summary values retain their API meaning');
 const running=p.locator('.fitness-running'),load=p.locator('#fi-body > .card').last();
 assert.match(await running.locator('.stat small').first().innerText(),/\bRun score\b/);
 assert.equal(await running.locator('.stat b').first().innerText(),String(data.vdot_now||'–'),'Run score retains its API value');
 assert.deepEqual(await load.locator('.stat small').allTextContents(),['Fitness','Form']);
 assert.deepEqual(await load.locator('.stat b').allTextContents(),[String(Math.round(last.fitness)),form],'Form means fitness minus fatigue in both places');
 assert.doesNotMatch(await p.locator('#fi-summary,#fi-pred,#fi-body').allInnerTexts().then(texts=>texts.join('\n')),/\b(?:VDOT|ramp)\b/i,'visible Fitness wording uses Run score and hides raw internals');
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
  for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:15},{width:390,height:844,root:16}]){
   const c=await b.newContext({storageState:auth,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(req.method())){if(u.pathname!=='/api/challenges/signup/continue')writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>App.pageReady&&!!document.querySelector('#fi-pred .card')&&!document.querySelector('#fi-body .skeleton'),'Fitness ready');await p.goto(base+'/progress?view=fitness');await ready();await p.evaluate(()=>document.fonts.ready);
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'root does not overflow');assert((await p.evaluate(()=>document.documentElement.clientWidth))<=size.width+1,'configured viewport stays fixed');
   for(const card of await p.locator('#fi-pred > .card,#fi-body > .card').all())assert(await card.evaluate(n=>{const s=getComputedStyle(n);return [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].every(v=>parseFloat(v)>=16);}), '16px on every Fitness card');
   if(size.root<=16)for(const h of await p.locator('#fi-pred h2,#fi-body h2').all()){const v=await h.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(v>=17&&v<=20,'section heading scale');}
   assert.equal(await p.locator('.discovery-grid').count(),0);assert.equal(await p.locator('#p-rng button').count(),0,'fitness range is not above predictions');assert.equal(await p.locator('#fi-range button').count(),1,'date range stays with Running fitness');
   assert(await p.locator('#fi-body .fitness-running #fi-range').count()===1,'range control belongs to the Running fitness card');assert((await p.locator('#fi-range').boundingBox()).y>(await p.locator('#fi-pred').boundingBox()).y,'range control sits below predictions');
   if(state==='empty'){await p.locator('#p-load .chart-expand').waitFor({state:'attached'});assert(await p.locator('#p-load .chart-expand').isHidden(),'empty load has no full-screen/zoom affordance');assert.equal(await p.locator('.pred').count(),0);assert.match(await p.locator('#fi-pred').innerText(),/Run a mile or more/);}
   else{
    assert.equal(await p.locator('.prediction-cell').count(),4);assert.equal(await p.locator('.fitness-predictions a').count(),0,'prediction card has no source links or blue source text');assert.equal(await p.locator('.prediction-current').count(),0,'separate current-fitness line is removed');assert.equal(await p.locator('.prediction-note').innerText(),'Estimates from current fitness, not target paces.');const bestRows=data.predictions.filter(row=>Number.isFinite(row.best_s)&&row.best_s>0),expectedBests=bestRows.map(row=>'Best '+duration(row.best_s)+(Number.isInteger(row.best_year)?' · '+row.best_year:''));assert.deepEqual(await p.locator('.prediction-best').allTextContents(),expectedBests,'only available exact-distance bests are shown');assert.equal(await p.locator('.fitness-predictions').getByText('Best not recorded').count(),0,'missing records do not add a Best line');if(state==='typical')assert.equal(expectedBests[0],'Best 19:30 · 2024');
    const shown=await p.locator('.prediction-time').allTextContents(),expected=await p.evaluate(rows=>rows.map(x=>dur(x.seconds)),data.predictions);assert.deepEqual(shown,expected,'displayed times equal unchanged API predictions');
    const paces=await p.locator('.prediction-pace').allTextContents(),expectedPaces=await p.evaluate(rows=>rows.map(x=>U.pace(x.seconds/x.distance_m*1000)+U.pu()),data.predictions);assert.deepEqual(paces,expectedPaces,'pace respects the person’s units');assert.match(paces[0],state==='typical'?/\/km$/:/\/mi$/);
    assert.equal(await p.locator('.prediction-method').getAttribute('open'),null);assert.equal(await p.locator('.prediction-note').count(),1);
    assert.equal(await p.locator('.pred').evaluate(n=>getComputedStyle(n).gridTemplateColumns.trim().split(/\s+/).length),2,'two-column prediction grid at 390px');assert.equal(await p.locator('.prediction-cell.pr').count(),0,'no best-beating highlight');
    const geometry=await p.evaluate(()=>{const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,h:r.height,w:r.width,b:r.bottom};},card=document.querySelector('.fitness-predictions'),grid=card.querySelector('.pred'),s=getComputedStyle(card),g=getComputedStyle(grid);return {padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),gap:[g.rowGap,g.columnGap].map(parseFloat),rows:[...grid.children].map(box),bad:[...grid.querySelectorAll('b')].filter(n=>n.scrollWidth>n.clientWidth+1).length};});assert(geometry.padding.every(v=>v>=16),'card padding: '+JSON.stringify(geometry));assert(geometry.gap.every(v=>v>=8));assert.equal(geometry.bad,0,'complete prediction times fit');assert(Math.abs(geometry.rows[0].y-geometry.rows[1].y)<1&&Math.abs(geometry.rows[2].y-geometry.rows[3].y)<1,'each pair shares a row');for(const a of await p.locator('.prediction-method > summary').all())assert((await a.boundingBox()).height>=44,'help disclosure44px target');
    if(size.root<=16){const type=await p.locator('.prediction-time').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(type>=20&&type<=24);const running=p.locator('#fi-body .card').first(),vdot=await running.locator('.bigstat').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(vdot.y+vdot.height<nav.y,'Running fitness and current VDOT remain on the first screen');}
    console.log('Fitness spacing',state,size.width,size.root,theme,JSON.stringify(geometry));
    await p.locator('.prediction-method summary').click();assert(await p.locator('.prediction-method').evaluate(n=>n.open));assert.match(await p.locator('.prediction-method').innerText(),/90 days/);assert.equal(await p.locator('.prediction-method .prediction-source').count(),4,'source details are tucked inside the explanation');assert.equal(await p.locator('.prediction-method a').count(),0,'source details remain plain text');await p.evaluate(()=>{const r=document.querySelector('.prediction-source:last-child').getBoundingClientRect(),n=document.querySelector('nav.tabs').getBoundingClientRect();window.scrollBy(0,Math.max(0,r.bottom-n.top+8));});const lastSource=await p.locator('.prediction-method .prediction-source').last().boundingBox(),tabs=await p.locator('nav.tabs').boundingBox();assert(lastSource.y+lastSource.height<=tabs.y,'the last source stays reachable above the tab bar when scrolled');await p.locator('.prediction-method summary').click();
    assert.match(await p.locator('#fi-body .card').first().innerText(),/Run score · 90 days/i);assert.match(await p.locator('#p-vdot .legend').innerText(),/6-month average of monthly bests/);
    const swatches=await p.locator('#p-vdot .sw').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).backgroundColor));assert(swatches.length===2&&swatches.every(c=>c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'),'fitness keys have a visible color');
    await p.locator('#p-vdot .chart-expand').click();await until(p,()=>!!document.querySelector('.fitness-inspect svg'),'full Run score chart');assert.doesNotMatch(await p.locator('.sheet').innerText(),/\bVDOT\b/i,'expanded chart keeps the Run score name');await p.locator('.sheet [data-close]').click();assert.equal(await p.locator('.fitness-inspect').count(),0);
   }
   if(out&&state==='typical'&&size.width===390&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+'/race-predictions-390-'+theme+'.png'});}
   if(state==='typical'&&size.root===16){
    await fitnessLanguage(p,data);
    // Keep the fictional history and predictions; change only the browser response's load increase.
    let ramp=8,served=0;
    await c.route('**/api/fitness?*',r=>{served++;return r.fulfill({json:{...data,ramp_7d:ramp}});});
    for(const value of [8,8.1]){ramp=value;const previous=served;await p.reload();await ready();assert(served>previous,'load-warning variant uses the browser-local response');await fitnessWarning(p,ramp);}
    if(out){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+'/fitness-high-load-390-'+theme+'.png'});}
   }
   if(state==='heavy')await require('./progress_polish_ui.cjs')(p,{size,theme});
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Fitness ${state} ${size.width}/${size.root} ${theme} PASS`);
  }
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
