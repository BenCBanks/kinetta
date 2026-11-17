// Real logger and CSS with fictional API replies; no session is written to the server.
// NODE_PATH=<Playwright install> KINETTA_URL=http://localhost:8798 node dev/tests/lift_ui.cjs
'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict');
const fixtureInstant=new Date(require('../screenshots/fixture-time.json').instant);
const base=process.env.KINETTA_URL||'http://localhost:8798';
const shots=process.env.KINETTA_LIFT_SHOTS;
async function until(page,fn){for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error('Lifting UI did not settle');}
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[];await p.clock.setFixedTime(fixtureInstant);
   p.on('pageerror',e=>errors.push(e.message));await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await p.goto(base+'/me');await until(p,()=>App.pageReady);
   const exerciseFixture={mine:Array.from({length:9},(_,i)=>({id:998800+i,name:`Fictional exercise ${i+1}`,sessions:2,last:'2026-10-30',kind:'weight',best_kg:20+i,best_reps:8}))};
   await c.route(url=>url.origin===base&&url.pathname==='/api/lifts/exercises',r=>r.fulfill({json:exerciseFixture}));
   await c.route(url=>url.origin===base&&url.pathname==='/api/lifts/sessions'&&url.searchParams.get('limit')==='5',r=>r.fulfill({json:[]}));
   await p.goto(base+'/progress?view=lifting');await p.locator('#lv-q').waitFor();
   await p.locator('#lv-q').fill('Fictional name with no match');assert(await p.locator('#lv-search-empty').isVisible(),'a no-match exercise search explains the blank result');
   const clearSearch=p.locator('#lv-search-clear');assert.equal(await clearSearch.innerText(),'Clear search');assert((await clearSearch.boundingBox()).height>=44,'clear-search action is at least 44px');
   if(shots&&size.width===390){require('node:fs').mkdirSync(shots,{recursive:true});await p.screenshot({path:require('node:path').join(shots,`lift-exercise-search-empty-${theme}.png`),fullPage:true,animations:'disabled'});}
   await clearSearch.click();assert.equal(await p.locator('#lv-ex .row-link:visible').count(),9,'clearing search restores all exercise rows');
   // The logger now lives in the guarded lift-routes bundle; load it through a real deferred route before
   // exercising its controls directly below. The eager Me/Track summary seam has already been checked above.
   await p.goto(base+'/lift/ex/999905');await until(p,()=>App.pageReady);
   const fixtureNow=fixtureInstant;
   const fixtureDay=daysAgo=>{const d=new Date(fixtureNow);d.setUTCDate(d.getUTCDate()-daysAgo);return d.toISOString().slice(0,10);};
   const fixtureStamp=daysAgo=>`${fixtureDay(daysAgo)}T12:00:00Z`;
   const start=fixtureNow.toISOString(),past=fixtureStamp(30);
   const exercises=[{exercise_id:999902,name:'Fictional bench press',kind:'weight',sets:[{kg:null,reps:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{kg:60,reps:8}]}},
     {exercise_id:999903,name:'Fictional push-up',kind:'body',sets:[{reps:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{reps:12}]}},
     {exercise_id:999904,name:'Fictional hold',kind:'time',sets:[{secs:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{secs:45}]}}];
   const workoutHistory={name:'Fictional Full Body',sessions:[
    {activity_id:999908,start_time:fixtureStamp(0),exercises:[{exercise_id:999902,name:'Fictional bench press',kind:'weight',sets:[{n:1,kg:60,reps:8},{n:2,kg:55,reps:10}]},{exercise_id:999903,name:'Fictional push-up',kind:'body',sets:[{n:1,reps:12}]}]},
    {activity_id:999907,start_time:fixtureStamp(7),exercises:[{exercise_id:999902,name:'Fictional bench press',kind:'weight',sets:[{n:1,kg:55,reps:9}]}]},
   ]};
   await c.route('**/api/lifts/sessions/999908/history',r=>r.fulfill({json:workoutHistory}));
   await p.goto(base+'/lift/history/workout/999908');await until(p,()=>App.pageReady&&!!document.querySelector('.compact-lift-history .lift-history-list'));
   assert.equal((await p.locator('.lift-history-date').count()),2,'workout history shows the saved session and one previous session');
   assert.equal((await p.locator('.lift-history-name').count()),3,'workout history links each exercise to its history');
   assert.equal((await p.locator('.lift-history input,.lift-history button[data-set],.lift-history .lift-tick,.lift-history .lift-addset').count()),0,'saved workout history has no editing controls');
   assert.equal((await p.locator('.compact-lift-history [data-back]').innerText()).trim(),'Track','saved workout history has a labelled back');
   const shot=async state=>{if(shots&&size.width<=390){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(shots,{recursive:true});await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.screenshot({path:path.join(shots,`lift-${state}-${size.width}-${theme}.png`),animations:'disabled'});}};
   await p.evaluate(start=>liftLogger(document.querySelector('#page'),999906,{open:true,start_time:start,exercises:[]}),start);
   assert(await p.locator('#lf-empty-add').isVisible());assert(await p.locator('#lf-add').isHidden());
   assert.equal((await p.locator('.lift-back').innerText()).trim(),'Lift','active logger has a visible labelled back');
   assert.notEqual(await p.locator('#lf-empty-add').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','Add exercise keeps its action fill');
   assert.equal(await p.locator('#lf-empty-add').evaluate(e=>getComputedStyle(e).backgroundImage),'none','Add exercise has a flat fill, not a gradient');
   assert.equal(await p.locator('#lf-empty-add').evaluate(e=>getComputedStyle(e).boxShadow),'none','Add exercise has no gradient elevation shadow');
   await shot('empty');
   await p.evaluate(()=>{App.me.units='imperial';});
   const historyExercises=exercises.map(e=>({...e,sets:e.kind==='weight'?[{kg:60,reps:8,done:true}]:e.kind==='time'?[{secs:45,done:true}]:[{reps:12,done:true}]}));
   await p.evaluate(({start,exercises})=>liftLogger(document.querySelector('#page'),999907,{open:false,start_time:start,exercises}),{start,exercises:historyExercises});
   assert.equal(await p.locator('.lift-in').count(),0,'history has read-only values');assert.equal(await p.locator('.lift-tick,[data-set]').count(),0,'history has no checkboxes or set menus');assert(await p.locator('#lf-add').isHidden());
   assert.equal((await p.locator('.lift-back').innerText()).trim(),'Progress','history has a visible labelled back');
   assert.equal(await p.locator('#lf-done').count(),0,'finished logger does not repeat the Done action');
   assert.equal(await p.locator('.lift-row.lh .lh-prev').count(),0,'finished logger omits the Last column');
   assert.equal(await p.locator('.lift-read-value[data-k="kg"]').first().innerText(),'132.3','finished logger shows the weight unit once in the column label');
   assert.equal(await p.locator('.lift-row.lh').first().evaluate(e=>Math.round(e.getBoundingClientRect().height)),28,'column labels share one compact baseline');
   assert.equal(await p.locator('.lift-n').first().evaluate(e=>Math.round(e.getBoundingClientRect().height)),44,'set picker keeps a 44px target');
   const setEdges=await p.locator('.lift-row.lh').first().evaluate(e=>{const h=e.querySelector('.lh-n'),v=e.parentElement.querySelector('.lift-n.readonly'),edge=n=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect().left;};return [edge(h),edge(v)];});
   assert(Math.abs(setEdges[0]-setEdges[1])<=1,`finished Set values align with the Set header (${setEdges.join(' vs ')})`);
   assert.equal(await p.locator('.lift-ex').first().evaluate(e=>getComputedStyle(e).paddingLeft),await p.locator('.lift-ex').first().evaluate(e=>getComputedStyle(e).paddingRight),'exercise card has equal horizontal insets');
   assert.equal(await p.locator('.lift-read-value[data-k="kg"]').first().evaluate(e=>getComputedStyle(e).color),await p.locator('.lift-n').first().evaluate(e=>getComputedStyle(e).color),'typed values use primary text');
   assert.equal(await p.locator('.lift-read-value[data-k="kg"]').first().evaluate(e=>getComputedStyle(e).fontWeight),'600','read-only values stay prominent');
   assert(await p.locator('.lift-row.lh').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth)),'headers fit in the available card width');
   assert(await p.locator('.lift-name').first().evaluate(e=>e.scrollWidth<=e.clientWidth),'long exercise names wrap instead of clipping');
   await shot('history');
   let release,first=true;const writes=[];
   await c.route('**/api/activities/999901/lifts',async r=>{
    assert.equal(r.request().method(),'PUT');const body=r.request().postDataJSON();writes.push(body);
    if(first){first=false;await new Promise(ok=>release=ok);}
    await r.fulfill({json:{open:!body.finish,start_time:start,exercises:body.exercises.map(e=>({...exercises.find(x=>x.exercise_id===e.exercise_id),...e,sets:e.sets.map(s=>({...s,pr:[]}))}))}});
   });
   await c.route('**/api/activities/999901',r=>r.fulfill({json:{id:999901,name:'Fictional lifting session',sport:'workout',sport_label:'Strength',elapsed_s:1234,moving_s:1234,start_time:start,visibility:'me',calories:120}}));
   await p.evaluate(({start,exercises})=>{App.me.units='imperial';liftLogger(document.querySelector('#page'),999901,{open:true,start_time:start,lastTick:new Date(start).getTime()-62000,exercises});},{start,exercises});
   assert(await p.locator('#lf-restbox').isVisible(),'rest appears beneath the running clock');assert(await p.locator('#lf-finish').isVisible());
   assert.equal(await p.locator('.lift-row[data-row]').first().evaluate(n=>Math.round(n.getBoundingClientRect().height)),48,'set rows stay 48px');
   assert.equal(await p.locator('.lift-tick').first().evaluate(n=>Math.round(n.getBoundingClientRect().width)),44,'check target remains 44px');
   assert(await p.locator('.lift-tick').first().evaluate(n=>Math.round(n.getBoundingClientRect().height)>=44),'check target remains at least 44px tall');
   assert.equal(await p.locator('.lift-tick').first().evaluate(n=>Math.round(parseFloat(getComputedStyle(n,'::before').width))),28,'check mark is a 28px circle inside its target');
   await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await shot('live');
   const clearance=await p.evaluate(()=>{const add=document.querySelector('.compact-lift #lf-add'),nav=document.querySelector('nav.tabs');const a=add.getBoundingClientRect(),n=nav.getBoundingClientRect();return {gap:Math.round(n.top-a.bottom),visible:a.bottom<=n.top-15};});
   assert(clearance.visible,`last Lift action clears floating tab bar by 16px (gap ${clearance.gap}px)`);
   if(process.env.KINETTA_LIFT_CAPTURE_ONLY==='1'){await c.close();continue;}
   const clipped=await p.locator('.lift-in').evaluateAll(es=>es.flatMap(e=>{const s=getComputedStyle(e),g=document.createElement('canvas').getContext('2d');g.font=s.font;const max=e.dataset.k==='kg'?'2204.6':e.dataset.k==='secs'?'86400':'1000',space=e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),needed=g.measureText(max).width;return needed>space+1?[{field:e.dataset.k,space,needed}]:[];}));
   assert.deepEqual(clipped,[],'Supported numeric values must fit without hiding decimals');
   await p.evaluate(()=>{window.liftHapticCalls=[];Native.haptic=kind=>window.liftHapticCalls.push(kind);});
   await p.locator('.lift-ex').first().locator('[data-tick="0"]').click();
   assert.deepEqual(await p.evaluate(()=>liftHapticCalls),['light'],'logging a valid completed set gives one light haptic when the native bridge is present');
   await until(p,()=>document.querySelector('#lf-save')?.textContent==='Saving…');
   await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await p.locator('#lf-finish').click();await p.locator('#ff-yes').click();
   assert.equal(await p.locator('#lf-sum').count(),0,'Finish waits for its outstanding write');release();await p.locator('#lf-sum').waitFor();
   assert.equal(writes.length,2);assert.equal(writes[0].exercises[0].sets[0].kg,60);assert.equal(writes[1].finish,true);
   assert.equal(await p.evaluate(()=>scrollY),0,'Summary opens at the title, not the previous scroll position');
   await p.waitForTimeout(350);
   const overlap=await p.locator('.track-review-stats > div').evaluateAll(es=>es.flatMap((e,i)=>{const a=e.getBoundingClientRect(),b=e.querySelector('b').getBoundingClientRect();return b.right>a.right+1||b.left<a.left-1||e.querySelector('b').scrollWidth>e.querySelector('b').clientWidth+1?[i]:[];}));
   assert.deepEqual(overlap,[],'Enlarged summary numbers must fit their own cell');
   await p.evaluate(async()=>{await liftSummary(document.querySelector('#page'),999901,{exercises:[{name:'Squat',kind:'weight',sets:[{kg:20,reps:8,warmup:true},{kg:30,reps:5,warmup:true},{kg:40,reps:5,warmup:true,done:false}]}]});});
   assert((await p.locator('.lift-review').innerText()).includes('Warm-up only'));assert.equal(await p.locator('.track-review-stats > div').filter({hasText:'Exercise'}).innerText(),'1\nExercise');assert.equal(await p.locator('.track-review-stats > div').filter({hasText:'Warm-up sets'}).innerText(),'2\nWarm-up sets');assert.equal(await p.locator('.track-review-stats').getByText('Working sets',{exact:true}).count(),0,'warm-up-only summary never claims zero working sets');assert((await p.locator('.lift-review-ex').innerText()).includes('2 warm-up sets'),'exercise detail labels its completed warm-ups');
   // The paired day/time fields use the same responsive form layout as other app sheets.
   await p.evaluate(()=>addActivitySheet(null,'workout'));await p.locator('#ma').waitFor();
   const daySelect=p.locator('#ma select[name=day]'),yesterday=await daySelect.locator('option').evaluateAll(options=>options.find(option=>option.textContent.trim()==='Yesterday')?.value);
   assert(yesterday,'day picker exposes Yesterday by semantic label');await daySelect.selectOption(yesterday);
   assert.equal(await daySelect.evaluate(select=>select.selectedOptions[0]?.textContent.trim()),'Yesterday','the selected day is Yesterday');
   const clippedChoices=await p.locator('#ma .two select').evaluateAll(es=>es.flatMap(e=>{const s=getComputedStyle(e),g=document.createElement('canvas').getContext('2d');g.font=s.font;const text=e.selectedOptions[0].text,space=e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),needed=g.measureText(text).width;return needed>space+1?[{text,space,needed}]:[];}));
   assert.deepEqual(clippedChoices,[],'Day and time choices must remain readable when enlarged');
   await p.keyboard.press('Escape');
   const chartDays=[0,1,2,3].map(i=>fixtureDay(3+i));
   await p.evaluate(days=>{
    const realChart=dotChart;window.bodyChartPoints=null;dotChart=(el,points,options)=>{if(el.id==='lx-chart')window.bodyChartPoints=points.map(p=>p.y);return realChart(el,points,options);};window.restoreBodyChart=()=>{dotChart=realChart;};
    const history={exercise:{id:999905,name:'Fictional push-up',kind:'body',sessions:4,last:days[0],note:''},records:{reps:{value:10,activity_id:999914,start_time:days[0]}},sessions:[10,9,8,7].map((best,i)=>({activity_id:999914-i,start_time:`${days[i]}T12:00:00Z`,reps:best*2-1,best_reps:best,top:{kg:30,reps:best-1},sets:[{reps:best,kg:0,done:true},{reps:best-1,kg:30,done:true}]}))};window.bodyChartHistory=history;drawExercise(document.querySelector('#page'),history);
   },chartDays);
   await until(p,()=>!!document.querySelector('#lx-chart svg')&&!!window.bodyChartPoints);assert.deepEqual(await p.evaluate(()=>bodyChartPoints),[7,8,9,10],'bodyweight chart plots the best single set, not session totals');assert(await p.getByRole('heading',{name:'Most reps in a set',exact:true}).isVisible());assert((await p.locator('.lx-rec').innerText()).includes('10'),'single-set record stays10');await p.evaluate(()=>{for(const s of bodyChartHistory.sessions){delete s.best_reps;s.sets.push({reps:90,done:true,warmup:true},{reps:99,done:false});}window.bodyChartPoints=null;drawExercise(document.querySelector('#page'),bodyChartHistory);});await until(p,()=>!!window.bodyChartPoints);assert.deepEqual(await p.evaluate(()=>bodyChartPoints),[7,8,9,10],'older-server fallback ignores warm-up and unfinished sets');await p.evaluate(()=>restoreBodyChart());
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);await c.close();console.log(`Lifting writes/values/summary: ${size.width}px/${size.root}px ${theme} PASS`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
