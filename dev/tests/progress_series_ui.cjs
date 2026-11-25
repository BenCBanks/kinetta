// Fictional weekly-series responses; no provider requests or personal data.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
function fixture(metric,aggregate,state){
 const points=Array.from({length:12},(_,i)=>{const d=new Date('2026-09-07T12:00:00Z');d.setUTCDate(d.getUTCDate()+i*7);return {start:d.toISOString().slice(0,10),value:state==='empty'?aggregate==='sum'?0:null:state==='thin'&&i!==11?null:metric==='pace'?330-i*2:metric==='avg_hr'?142+i%3:metric==='time'?5400+i*300:metric==='workouts'?2+i%3:metric==='ascent'?110+i*12:12000+i*1000,n:state==='empty'?0:state==='thin'&&i!==11?0:2+i%3,missing:0,in_progress:i===11};});
 const values=points.filter(p=>p.value!=null&&p.n).map(p=>p.value);
 return {metric,aggregate,group_by:'week',period_unit:'weeks',period_count:12,sport:'run',start:points[0].start,end:'2026-11-25',points,truncated:false,workouts:points.reduce((s,p)=>s+p.n,0),missing:0,summary:{overall:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,first:values[0]??null,last:values.at(-1)??null,highest:values.length?Math.max(...values):null,lowest:values.length?Math.min(...values):null,change:values.length>1?values.at(-1)-values[0]:null,direction:'up'}};
}
(async()=>{const b=await chromium.launch();try{
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await b.newContext({viewport:{width,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200);
  let state='ready';const requests=[],errors=[];const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/progress/series'){requests.push(Object.fromEntries(u.searchParams));return r.fulfill({json:fixture(u.searchParams.get('metric'),u.searchParams.get('aggregate'),state)});}if(!['GET','HEAD'].includes(r.request().method()))return r.fulfill({json:{}});return r.continue();});
  const ready=async()=>{await p.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady);await p.locator('#p-home-totals #m-chart').waitFor();};
  const shot=async(name)=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${width}-${theme}.png`,animations:'disabled'});}};
  await p.goto(base+'/progress');await ready();await p.locator('#m-chart svg').waitFor();
  const metric=p.locator('[data-progress-series-metric]');assert.match(await metric.innerText(),/Distance/);assert((await metric.boundingBox()).height>=44);
  await metric.click();await p.locator('.sheet [data-pk="climb-average"]').waitFor();
  assert.deepEqual(await p.locator('.sheet [data-pk] .grow>span').allTextContents(),['Distance','Time','Climb','Climb per run','Pace','Heart rate','Workouts']);
  assert.equal(await p.locator('.sheet .tick').count(),1);for(const row of await p.locator('.sheet [data-pk]').all())assert((await row.boundingBox()).height>=44);
  await shot('metric-sheet');await p.locator('.sheet [data-pk="climb-average"]').click();await p.waitForURL('**metric=climb-average');await ready();await p.locator('#m-chart svg').waitFor();
  assert(requests.some(r=>r.metric==='ascent'&&r.aggregate==='average'&&r.group_by==='week'),'Climb per run asks for grouped average ascent');await shot('climb-per-run');
  const bars=p.locator('#m-chart .period-column');assert.equal(await bars.count(),12);
  await bars.nth(10).click();assert.match(await p.locator('#m-chart .readout').innerText(),/workouts/);await bars.nth(10).press('ArrowRight');assert.equal(await bars.nth(11).evaluate(n=>n===document.activeElement),true);await bars.nth(11).press('Escape');
  for(const key of ['time','pace','avg_hr','workouts']){await p.locator('[data-progress-series-metric]').click();await p.locator(`.sheet [data-pk="${key}"]`).click();await p.waitForURL('**metric='+key);await ready();await p.locator('#m-chart svg').waitFor();}
  for(const next of ['empty','thin']){state=next;await p.goto(base+'/progress?metric=climb-average');await ready();await p.locator('.progress-series-empty').waitFor();assert.equal(await p.locator('#m-chart svg').count(),0,'no invented axes with fewer than two measurements');assert.match(await p.locator('#m-chart').innerText(),next==='empty'?/No runs/:/Not enough data yet/);await shot(next);}
  assert.deepEqual(errors,[]);console.log(`Progress series ${width} ${theme}: metric sheet, apply, average-climb request, bars, keyboard and sparse states PASS`);await c.close();
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
