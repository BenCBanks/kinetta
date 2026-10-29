// Actual activity views and chart controls; fictional API replies, no activity or reaction writes.
// NODE_PATH=<Playwright install> KINETTA_URL=http://localhost:8798 node dev/tests/activity_ui.cjs
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
async function ready(page){for(let i=0;i<150;i++){if(await page.evaluate(()=>App.pageReady&&!document.querySelector('#page[data-home-loading]')))return;await page.waitForTimeout(100);}throw Error('Activity did not settle');}
(async()=>{
 const browser=await chromium.launch();
 try{
  const login=await browser.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  const sample=await(await login.request.get(base+'/api/activities/1')).json(),social=await(await login.request.get(base+'/api/activities/1/social')).json(),state=await login.storageState();await login.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[];
   p.on('pageerror',e=>errors.push(e.message));await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const chart={t:[0,60,120,180,240,300,360,420],speed:[2,3,4,null,null,4,5,4],hr:[120,130,140,145,140,145,150,140],alt:[10,12,15,18,15,12,11,10],power:[100,120,130,140,125,130,140,120],cad:[70,75,80,85,80,85,90,80]};
   const activity={...sample,id:999941,name:'Fictional chart ride',line:null,track_lines:[],route_id:null,photos:[],chart,zones:null,power_curve:[],start_time:'2026-09-01T12:00:00Z',lifts:false,has_intervals:false};
   const variants={999941:activity,999943:{...activity,id:999943,chart:null},999944:{...activity,id:999944,chart:{t:chart.t,hr:[null,130,null,null,null,null,null,null]}},999945:{...activity,id:999945,name:'Fictional indoor ride',speed_available:false,max_speed:null,distance_m:0,chart:{t:chart.t,hr:chart.hr}}};
   for(const [id,data] of Object.entries(variants)){
    await c.route(base+'/api/activities/'+id,r=>r.fulfill({json:data}));
    await c.route(base+'/api/activities/'+id+'/social',r=>r.fulfill({json:social}));
   }
   const shared={...activity,id:999946,social:{...social,mine:false},owner:{login:'zz_test_chart_friend',name:'Demo Friend'},shares:{pace:false,map:false},speed_available:false,max_speed:null,chart:{t:chart.t,hr:chart.hr}};
   await c.route(base+'/api/shared/999946',r=>r.fulfill({json:shared}));
   await c.route(base+'/api/shared/999947',r=>r.fulfill({json:{...shared,id:999947,chart:null,avg_hr:null,max_hr:null,zones:null}}));
   const writes=[];await c.route('**/api/**',r=>{if(new URL(r.request().url()).pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(['GET','HEAD','OPTIONS'].includes(r.request().method()))return r.fallback();writes.push(r.request().method()+' '+r.request().url());return r.abort();});
   await p.goto(base+'/activity/999941');await ready(p);await p.locator('#d-charts .chartbox').first().waitFor();
   assert.equal(await p.locator('[role=tab][aria-selected=true]').innerText(),'Charts');assert(await p.locator('[data-pane=overview]').isHidden());
   assert.equal(await p.locator('#d-charts .chartbox').count(),5);
   const svg=p.locator('#d-charts svg').first();await svg.focus();await svg.press('Home');assert.equal(await p.locator('#d-charts .readout > span').innerText(),'0:00');await svg.press('End');assert.equal(await p.locator('#d-charts .readout > span').innerText(),'7:00');
   await p.getByRole('button',{name:'Reset chart inspection'}).click();assert((await p.locator('#d-charts .chartbox [data-chart-value]').first().innerText()).startsWith('Avg'));
   const gaps=await p.locator('#d-charts .chartbox').first().locator('.sample-area').getAttribute('d');assert.equal((gaps.match(/Z/g)||[]).length,2,'Missing samples split the fill into honest separate areas');
   await p.getByRole('tab',{name:'Details',exact:true}).click();assert(new URL(p.url()).searchParams.get('tab')==='overview');assert(await p.locator('[data-pane=charts]').isHidden());assert(await p.locator('[data-pane=overview]').isVisible());
   await p.getByRole('tab',{name:'Details',exact:true}).press('ArrowLeft');assert.equal(await p.locator('[role=tab][aria-selected=true]').innerText(),'Charts');
   await p.evaluate(()=>go('/activity/999941?tab=overview',{replace:true}));await ready(p);assert.equal(await p.locator('[role=tab][aria-selected=true]').innerText(),'Details');
   for(const id of [999943,999944]){await p.evaluate(id=>go('/activity/'+id,{replace:true}),id);await ready(p);assert.equal(await p.locator('[role=tab][aria-selected=true]').innerText(),'Details');assert.equal(await p.getByRole('tab',{name:'Charts',exact:true}).count(),0);}
   await p.evaluate(()=>go('/activity/999945',{replace:true}));await ready(p);await p.locator('#d-charts .chartbox').waitFor();assert.deepEqual(await p.locator('#d-charts .lbl > span:first-child').allTextContents(),['Heart rate']);
   await p.evaluate(()=>go('/activity/friends/999946',{replace:true}));await ready(p);await p.locator('#s-charts .chartbox').waitFor();assert.equal(await p.locator('[role=tab][aria-selected=true]').innerText(),'Charts');assert.deepEqual(await p.locator('#s-charts .lbl > span:first-child').allTextContents(),['Heart rate']);
   await p.getByRole('tab',{name:'Details',exact:true}).click();assert(await p.locator('[data-pane=charts]').isHidden());await p.getByRole('tab',{name:'Charts',exact:true}).click();assert(await p.locator('#s-charts svg').isVisible());
   await p.evaluate(()=>go('/activity/friends/999947',{replace:true}));await ready(p);assert.equal(await p.getByRole('tab',{name:'Charts',exact:true}).count(),0);assert.equal(await p.locator('#s-charts').count(),0);
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'Tab/chart inspection must not write records');await c.close();console.log(`Activity chart-first/tabs/inspection/gaps/privacy: ${size.width}px/${size.root}px ${theme} PASS`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
