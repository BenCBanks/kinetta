// Real logger and CSS with fictional API replies; no session is written to the server.
// NODE_PATH=<Playwright install> KINETTA_URL=http://localhost:8798 node dev/tests/lift_ui.cjs
'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
async function until(page,fn){for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error('Lifting UI did not settle');}
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[];
   p.on('pageerror',e=>errors.push(e.message));await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await p.goto(base+'/me');await until(p,()=>App.pageReady);
   const start=new Date().toISOString(),past='2026-09-01T12:00:00Z';
   const exercises=[{exercise_id:999902,name:'Fictional bench press',kind:'weight',sets:[{kg:null,reps:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{kg:60,reps:8}]}},
     {exercise_id:999903,name:'Fictional push-up',kind:'body',sets:[{reps:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{reps:12}]}},
     {exercise_id:999904,name:'Fictional hold',kind:'time',sets:[{secs:null,done:false}],last:{activity_id:999900,start_time:past,sets:[{secs:45}]}}];
   let release,first=true;const writes=[];
   await c.route('**/api/activities/999901/lifts',async r=>{
    assert.equal(r.request().method(),'PUT');const body=r.request().postDataJSON();writes.push(body);
    if(first){first=false;await new Promise(ok=>release=ok);}
    await r.fulfill({json:{open:!body.finish,start_time:start,exercises:body.exercises.map(e=>({...exercises.find(x=>x.exercise_id===e.exercise_id),...e,sets:e.sets.map(s=>({...s,pr:[]}))}))}});
   });
   await c.route('**/api/activities/999901',r=>r.fulfill({json:{id:999901,name:'Fictional lifting session',sport:'workout',sport_label:'Strength',elapsed_s:1234,moving_s:1234,start_time:start,visibility:'me',calories:120}}));
   await p.evaluate(({start,exercises})=>{App.me.units='imperial';liftLogger(document.querySelector('#page'),999901,{open:true,start_time:start,exercises});},{start,exercises});
   const clipped=await p.locator('.lift-in').evaluateAll(es=>es.flatMap(e=>{const s=getComputedStyle(e),g=document.createElement('canvas').getContext('2d');g.font=s.font;const max=e.dataset.k==='kg'?'2204.6':e.dataset.k==='secs'?'86400':'1000',space=e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),needed=g.measureText(max).width;return needed>space+1?[{field:e.dataset.k,space,needed}]:[];}));
   assert.deepEqual(clipped,[],'Supported numeric values must fit without hiding decimals');
   await p.locator('.lift-ex').first().locator('[data-tick="0"]').click();await until(p,()=>document.querySelector('#lf-save')?.textContent==='Saving…');
   await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await p.locator('#lf-finish').click();await p.locator('#ff-yes').click();
   assert.equal(await p.locator('#lf-sum').count(),0,'Finish waits for its outstanding write');release();await p.locator('#lf-sum').waitFor();
   assert.equal(writes.length,2);assert.equal(writes[0].exercises[0].sets[0].kg,60);assert.equal(writes[1].finish,true);
   assert.equal(await p.evaluate(()=>scrollY),0,'Summary opens at the title, not the previous scroll position');
   await p.waitForTimeout(350);
   const overlap=await p.locator('.track-review-stats > div').evaluateAll(es=>es.flatMap((e,i)=>{const a=e.getBoundingClientRect(),b=e.querySelector('b').getBoundingClientRect();return b.right>a.right+1||b.left<a.left-1||e.querySelector('b').scrollWidth>e.querySelector('b').clientWidth+1?[i]:[];}));
   assert.deepEqual(overlap,[],'Enlarged summary numbers must fit their own cell');
   // The paired day/time fields use the same responsive form layout as other app sheets.
   await p.evaluate(()=>addActivitySheet(null,'workout'));await p.locator('#ma').waitFor();
   const yesterday=await p.locator('#ma select[name=day] option').nth(1).getAttribute('value');await p.locator('#ma select[name=day]').selectOption(yesterday);
   const clippedChoices=await p.locator('#ma .two select').evaluateAll(es=>es.flatMap(e=>{const s=getComputedStyle(e),g=document.createElement('canvas').getContext('2d');g.font=s.font;const text=e.selectedOptions[0].text,space=e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),needed=g.measureText(text).width;return needed>space+1?[{text,space,needed}]:[];}));
   assert.deepEqual(clippedChoices,[],'Day and time choices must remain readable when enlarged');
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);await c.close();console.log(`Lifting writes/values/summary: ${size.width}px/${size.root}px ${theme} PASS`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
