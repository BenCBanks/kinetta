// Actual history and prepared segment metadata; writes remain blocked by the calling Fitness fixture.
'use strict';
const assert=require('node:assert/strict');
module.exports=async function polishChecks(p,{size,theme}){
 const base=new URL(p.url()).origin,until=async(fn,label,arg)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);};
 await p.goto(base+'/progress/trends?sport=run');await p.locator('#g-wk .readout').waitFor({state:'attached'});assert.match(await p.locator('#g-wk .readout').innerText(),/\/week/);assert.match(await p.locator('#g-wk .readout').innerText(),/so far/);
 const loop={id:999999,name:'Fictional repeated route',sport:'run',fastest_id:20003,line:null,pace_trend:{start:600,end:600,slope_per_day:0},efficiency_trend:{slope_per_day:0},activities:[600,610,590].map((moving_s,n)=>({id:20001+n,name:'Fictional timed run',start_time:`2026-10-${String(n+1).padStart(2,'0')}T12:00:00Z`,distance_m:1000,moving_s,avg_hr:150}))};
 await p.route('**/api/routes/999999',r=>r.fulfill({json:loop}));try{await p.goto(base+'/route/999999');await p.locator('#r-chart .dotp.best').waitFor({state:'attached'});assert.match(await p.locator('#page').innerText(),/distance per heartbeat is unchanged/);assert.doesNotMatch(await p.locator('#page').innerText(),/you’re fitter|you're fitter/);assert(await p.evaluate(()=>{const key=getComputedStyle(document.querySelector('.route-fastest-key')),point=getComputedStyle(document.querySelector('#r-chart .dotp.best'));return [point.fill,point.stroke].includes(key.color);}), 'Fastest key matches its gold point');}finally{await p.unroute('**/api/routes/999999');}
 const history=await p.evaluate(()=>api('/api/records/history?sport=run&distance_m=5000'));
 await p.goto(base+'/records/run/5000');await p.locator('#h-all .record-effort').first().waitFor();
 assert.equal(await p.getByRole('heading',{name:'PR progression',exact:true}).count(),0,'one history list');
 assert.equal(await p.locator('.record-effort').count(),Math.min(10,history.length));
 await p.locator('[data-record-filter=prs]').click();const prs=new Set(history.filter(r=>r.pr).map(r=>'/activity/'+r.activity_id));
 assert.equal(await p.locator('.record-effort').count(),Math.min(10,prs.size));for(const url of await p.locator('.record-effort').evaluateAll(ns=>ns.map(n=>n.getAttribute('href'))))assert(prs.has(url));
 await p.locator('[data-record-filter=all]').click();if(history.length>10){await p.locator('#h-more').click();assert.equal(await p.locator('.record-effort').count(),history.length);}
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'history fits');
 await p.route('**/api/segments?*',r=>r.fulfill({json:[]}));
 try{
  await p.goto(base+'/progress/segments?f=near&q=fictional-no-match');await p.locator('#sg-list .empty').waitFor();assert(await p.locator('#sg-map').isHidden());assert.match(await p.locator('#sg-list').innerText(),/No matching segments.*Try another search/s);assert.doesNotMatch(await p.locator('#sg-list').innerText(),/Move the map/);
  await p.evaluate(()=>{window.polishMapInto=mapInto;mapInto=async()=>null;});
  for(const filter of ['mine','saved','near']){
   await p.evaluate(filter=>go('/progress/segments?f='+filter),filter);await until(()=>App.pageReady&&!!document.querySelector('#sg-list .empty'),'segment empty state');
   const copy=await p.locator('#sg-list').innerText();assert.match(copy,filter==='mine'?/Create a segment/:filter==='saved'?/tap Save/:/Try a search/);assert.doesNotMatch(copy,/Move the map/);
   if(filter==='mine'){
    assert.equal(await p.locator('[data-f=mine]').innerText(),'Mine');
    const targets=await p.locator('.progress-segment-controls').evaluate(n=>{const r=n.getBoundingClientRect();return [...n.querySelectorAll('[data-f]')].map(b=>{const x=b.getBoundingClientRect();return {label:b.innerText,left:x.left,right:x.right,width:x.width,height:x.height,inside:x.left>=r.left-.1&&x.right<=r.right+.1};});});assert(targets.every(x=>x.inside&&x.width>=44&&x.height>=44),'whole filter targets fit '+JSON.stringify(targets));
   }
  }
  const course={id:999999,name:'Fictional fixed course',sport:'run',distance_m:1200,created:'2026-10-25T12:00:00Z',status:'active',audience:'me',mine:true,saved:false,line:'????'};
  await p.route('**/api/segments/999999',r=>r.fulfill({json:course}));
  let board={public:false,paused:false,me:{private_best:600},rows:[],count:0};
  await p.route('**/api/segments/999999/leaderboard',r=>r.fulfill({json:board}));
  await p.evaluate(()=>go('/segments/999999'));await p.locator('.seg-me').waitFor();const publish=p.locator('#sg-pub');assert.equal(await publish.innerText(),'Publish');assert.equal(await publish.getAttribute('aria-label'),'Publish to everyone');assert(await publish.evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length===1;}),'Publish stays on one line');
  await p.locator('.seg-rules summary').click();assert.match(await p.locator('.seg-rules').innerText(),/can’t be edited/);assert.match(await p.locator('.seg-rules').innerText(),/Everyone.*motor assistance/s);
  await publish.click();await p.locator('#pb-ok').waitFor();assert(!(await p.locator('#pb-ok').isChecked()));assert(await p.locator('#pb-go').isDisabled());assert.match(await p.locator('.sheet').innerText(),/Publishing can’t be undone/);assert.match(await p.locator('.sheet').innerText(),/Nothing about your own activities is shared/);await p.locator('#pb-ok').check();assert(await p.locator('#pb-go').isEnabled());await p.locator('.sheet').getByRole('button',{name:'Cancel',exact:true}).click();
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'segment detail fits');
  course.audience='everyone';course.mine=false;await p.route('**/api/segment-settings',r=>r.fulfill({json:{joined:false}}));
  for(const [name,me,paused,message] of [['empty',{joined:false},false,'No public times yet.'],['excluded',{joined:true,private_best:600,why_not:'activity_private'},false,'This activity isn’t shared with Everyone'],['paused',{joined:true,private_best:600},true,'Leaderboards are paused']]){
   board={public:true,paused,me,rows:[],count:0,scope:'Fictional local scope',processing:paused,matching_update:paused};
   await p.evaluate(name=>go('/segments/999999?case='+name),name);await until(msg=>document.querySelector('#sg-tab')?.innerText.includes(msg),'current board status',message);
   assert.match(await p.locator('#sg-tab').innerText(),/Fictional local scope/);
   if(name==='empty'){assert.equal((await p.locator('#sg-tab').innerText()).match(/No public times yet/g).length,1);await p.locator('#lb-join').click();await p.locator('#lj').waitFor();assert(!(await p.locator('#lj').isChecked()));const text=await p.locator('.sheet').innerText();assert.match(text,/past eligible activities/);assert.match(text,/heart rate, notes, exact start times/);assert.match(text,/privacy settings hide stay private/);assert.match(text,/Leave any time/);await p.locator('.sheet').getByRole('button',{name:'Done',exact:true}).click();}
   if(paused){assert.match(await p.locator('#sg-tab').innerText(),/matching update is available/);assert.match(await p.locator('#sg-tab').innerText(),/Checking activities/);}
  }

 }finally{
  await p.evaluate(()=>{if(window.polishMapInto){mapInto=window.polishMapInto;delete window.polishMapInto;}});
  await p.unroute('**/api/segments?*');await p.unroute('**/api/segments/999999');await p.unroute('**/api/segments/999999/leaderboard');await p.unroute('**/api/segment-settings');
 }
 console.log(`Progress polish ${size.width}/${size.root} ${theme}: single record history, retained PRs, bounded filters, truthful empty states and unchanged Publish confirmation PASS`);
};
