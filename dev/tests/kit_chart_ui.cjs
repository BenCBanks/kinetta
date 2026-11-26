// Fictional, intercepted Kit answers only; no AI/provider requests or app writes.
'use strict';
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const chart={metric:'ascent',aggregate:'average',group_by:'week',sport:'run',period_count:3,period_unit:'weeks',timezone:'America/New_York',start:'2026-11-10',end:'2026-11-26',axis_unit:'ft',workouts:8,missing:1,truncated:false,
 points:[{start:'2026-11-10',plot_value:125,display_value:'125 ft',n:4,missing:1},{start:'2026-11-17',plot_value:171,display_value:'171 ft',n:3,missing:0},{start:'2026-11-24',plot_value:200,display_value:'200 ft',n:1,missing:0,in_progress:true}]};
(async()=>{const browser=await (process.env.KIT_UI_BROWSER==='webkit'?webkit:chromium).launch(),login=await browser.newContext();try{
 assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
 const state=await login.storageState();
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'}),p=await c.newPage(),errors=[],writes=[];
  let selected=structuredClone(chart),interpretation='Your recorded climb rose across these weeks so far.';
  p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
   if(u.pathname==='/api/me'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false}});}
   if(u.pathname==='/api/coach/conversation/visits')return route.fulfill({json:{visit_id:req.postDataJSON().visit_id,generation:'chart-fixture',ready:true}});
   if(u.pathname==='/api/coach/conversation')return route.fulfill({json:{generation:'chart-fixture',ready:true,messages:[{id:1,client_id:'fictional-chart',question:'Show my average climb per run for the last three weeks.',state:'answered',answer:{chart:selected,answer_blocks:[{kind:'paragraph',text:interpretation}],interpretation,facts:[{label:'Should be hidden',display_value:'999 ft'}],follow_ups:['I want to compare my recent runs','I want to see my recorded pace']}}]}});
   if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{joined:null}});
   if(['POST','PUT','PATCH','DELETE'].includes(req.method())){writes.push(u.pathname);return route.fulfill({json:{}});}return route.continue();
  });
  const load=async()=>{await p.goto(base+'/me/kit?from=progress');await p.locator('.kit-chart').waitFor();await p.waitForFunction(()=>document.fonts.status==='loaded');};
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${name}-${width}-${theme}.png`),animations:'disabled'});}};
  await load();assert.equal(await p.locator('.kit-chart rect').count(),3);assert.equal(await p.locator('.kit-answer>.kit-facts').count(),0);
  const slider=p.getByRole('slider');await slider.focus();await p.keyboard.press('ArrowLeft');assert.equal(await slider.getAttribute('aria-valuenow'),'1');assert.match(await slider.getAttribute('aria-valuetext'),/171 ft/);
  await p.keyboard.press('Home');assert.equal(await slider.getAttribute('aria-valuenow'),'0');await p.keyboard.press('End');assert.match(await slider.getAttribute('aria-valuetext'),/so far/);
  const rect=await slider.boundingBox();await p.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);assert.equal(await slider.getAttribute('aria-valuenow'),'1');
  await p.keyboard.press('End');await slider.blur();assert.equal(await p.locator('.kit-chart-grid').count(),3);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal clipping');await shot('bars');
  selected={...structuredClone(chart),metric:'pace',axis_unit:'/mi',points:chart.points.map((v,i)=>({...v,plot_value:600-i*30,display_value:['10:00/mi','9:30/mi','9:00/mi'][i]}))};
  interpretation='Your recorded pace became faster across these weeks so far.';await load();assert.equal(await p.locator('.kit-chart circle').count(),3);const ys=await p.locator('.kit-chart circle').evaluateAll(els=>els.map(e=>Number(e.getAttribute('cy'))));assert(ys[2]<ys[0],'faster pace is higher');await shot('pace');
  selected.points[1]={...selected.points[1],plot_value:null,display_value:'Unknown'};interpretation='There are too few recorded runs to compare so far.';await load();assert.equal(await p.locator('.kit-chart circle').count(),2);assert.equal((await p.locator('.kit-chart-line').getAttribute('d')).match(/M/g).length,2,'a missing value breaks the line');await shot('gap');
  selected={...structuredClone(chart),workouts:0,points:[]};interpretation='There are no recorded runs in this period.';await load();assert.equal(await p.locator('.kit-chart svg').count(),0);assert.match(await p.locator('.kit-chart').innerText(),/No runs in the last 3 weeks/);assert.doesNotMatch(await p.locator('.kit-answer').innerText(),/There are no recorded/,'empty app copy is not repeated by the model');await shot('empty');
  selected={...structuredClone(chart),workouts:1,missing:0,points:[{...chart.points[0],n:1,missing:0}]};interpretation='Only one recorded run is available in this period.';await load();assert.equal(await p.locator('.kit-chart svg').count(),0);assert.equal(await p.locator('.kit-chart .kit-facts').count(),1);await shot('single');
  selected={...structuredClone(chart),group_by:'workout',start:'2026-10-28',truncated:true,workouts:30,missing:0,points:Array.from({length:30},(_,i)=>({start:new Date(Date.UTC(2026,9,28+i)).toISOString(),plot_value:100+i,display_value:`${100+i} ft`,n:1,missing:0}))};await load();assert.equal(await p.locator('.kit-chart circle').count(),30);assert.match(await p.locator('.kit-chart-note').innerText(),/Latest 30 runs/);await shot('truncated');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();
 }
 console.log('Kit chart bars/pace/gaps/empty/single: 390/330 light/dark; drag+keyboard, no clipping or writes PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1);});
