'use strict';
// Fictional read-only recap intent checks; the caller supplies its disposable browser and origin.
const assert=require('node:assert/strict');
const now=new Date('2026-11-15T12:00:00Z');
function facts(query){
 const requested=query.get('period'),alias={this_week:['week',0],last_week:['week',1],this_month:['month',0],last_month:['month',1],this_year:['year',0]}[requested],period=alias?.[0]||requested,offset=alias?.[1]??Number(query.get('offset')||0),start=new Date(now);
 if(period==='week')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7-7*offset);
 else if(period==='year'){start.setUTCMonth(0,1);start.setUTCFullYear(start.getUTCFullYear()-offset);}
 else{start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-offset);}
 const end=new Date(start);period==='week'?end.setUTCDate(end.getUTCDate()+7):period==='year'?end.setUTCFullYear(end.getUTCFullYear()+1):end.setUTCMonth(end.getUTCMonth()+1);
 return{period:requested,offset:alias?0:offset,start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),today:'2026-11-15',tz:'UTC',units:'imperial',activities:2,active_days:2,distance_m:8046.72,time_s:3000,top_sport:'run',days:[],highlights:[],streak_weeks:2,food:{logged_days:0,protein_goal_days:null},garmin_sources:[],monthly_offer:false};
}
async function fixture(browser,base,{hold=false,failFirst=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'UTC'});
 const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200);
 const page=await context.newPage(),assets=[],reads=[],errors=[],writes=[];let release,signalHeld,heldOnce=false;
 const gate=new Promise(resolve=>release=resolve),held=new Promise(resolve=>signalHeld=resolve);page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(now);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/recap-editor.js'){
   assets.push(url.href);if(failFirst&&assets.length===1)return route.abort();
   if(hold&&!heldOnce){heldOnce=true;signalHeld();await gate;}return route.continue();
  }
  if(url.pathname==='/api/recaps'){reads.push(url.search);return route.fulfill({json:facts(url.searchParams)});}
  if(url.pathname==='/api/notifications'&&request.method()==='GET')return route.fulfill({json:{items:[],unread:0,push:{},push_ready:false}});
  if(url.pathname==='/api/challenges/signup/continue'&&request.method()==='POST')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(request.method()+' '+url.pathname);return route.abort();}
  return route.continue();
 });
 const ready=async path=>{await page.goto(base+path);await page.waitForFunction(()=>App.pageReady);await page.evaluate(()=>{App.me.tz='UTC';});};
 const sheetReady=async()=>{await page.locator('.recap-sheet #recap-status[data-ready="true"]').waitFor({state:'attached'});assert.equal(await page.locator('#recap-status').innerText(),'','recap facts loaded');};
 return{context,page,assets,reads,errors,writes,held,release,ready,sheetReady};
}
module.exports=async function recapLeafChecks(browser,base){
 const cold=await fixture(browser,base);
 try{
  for(const path of ['/me','/progress','/notifications']){await cold.ready(path);assert.equal(cold.assets.length,0,`${path} leaves the editor unloaded`);assert.equal(await cold.page.evaluate(()=>typeof Recaps.today==='function'&&typeof Recaps.summary==='function'),true);}
  assert.deepEqual(cold.errors,[]);assert.deepEqual(cold.writes,[]);
 }finally{await cold.context.close();}
 const concurrent=await fixture(browser,base,{hold:true});
 try{
  await concurrent.ready('/progress');await concurrent.page.evaluate(()=>{void Recaps.open({period:'year',offset:3});void Recaps.open({period:'year',offset:3});});await concurrent.held;
  assert.equal(concurrent.assets.length,1,'concurrent first intents load one script');assert.equal(concurrent.reads.length,0,'no recap read precedes owner/route recheck');assert.equal(await concurrent.page.locator('.recap-sheet').count(),0);
  concurrent.release();await concurrent.sheetReady();assert.equal(await concurrent.page.locator('.recap-sheet').count(),1);assert.equal(await concurrent.page.locator('#recap-period-label').innerText(),'2023');assert.equal(concurrent.reads.length,1);assert.match(new URL(concurrent.assets[0]).searchParams.get('v'),/^[0-9a-f]{32}$/);assert.deepEqual(concurrent.errors,[]);assert.deepEqual(concurrent.writes,[]);
 }finally{concurrent.release();await concurrent.context.close();}
 const retry=await fixture(browser,base,{failFirst:true});
 try{
  await retry.ready('/progress');await retry.page.locator('#recap-entry').click();await retry.page.locator('#toast').filter({hasText:'Tap Share to try again'}).waitFor();assert.equal(await retry.page.locator('.recap-sheet').count(),0);
  await retry.page.locator('#recap-entry').click();await retry.sheetReady();assert.equal(retry.assets.length,2,'next Share retries failed script');assert.equal(retry.reads.length,1);assert.deepEqual(retry.errors,[]);assert.deepEqual(retry.writes,[]);
 }finally{await retry.context.close();}
 for(const kind of ['owner','timezone','path']){
  const stale=await fixture(browser,base,{hold:true});
  try{
   await stale.ready('/progress');await stale.page.locator('#recap-entry').click();await stale.held;
   await stale.page.evaluate(kind=>{if(kind==='owner')App.me={...App.me,id:987654};else if(kind==='timezone')App.me.tz='Pacific/Kiritimati';else go('/me');},kind);
   stale.release();await stale.page.waitForFunction(()=>typeof RecapEditor==='object');await stale.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await stale.page.locator('.recap-sheet').count(),0,`${kind} change suppresses a late sheet`);assert.equal(stale.reads.length,0,`${kind} change suppresses old-intent recap reads`);assert.deepEqual(stale.errors,[]);assert.deepEqual(stale.writes,[]);
  }finally{stale.release();await stale.context.close();}
 }
 for(const [type,period,path,label] of [['month','2026-09','/notifications','September 2026'],['year','2024','/notifications','2024'],['month','2020-01','/progress','This month']]){
  const note=await fixture(browser,base,{hold:true});
  try{
   await note.ready('/notifications');await note.page.evaluate(({type,period})=>openSummary(type,period),{type,period});await note.held;assert.equal(new URL(note.page.url()).pathname,path,'notification keeps exact or fallback destination');if(path==='/progress')await note.page.waitForFunction(()=>App.pageReady&&location.pathname==='/progress');note.release();await note.sheetReady();assert.equal(await note.page.locator('#recap-period-label').innerText(),label);assert.equal(note.assets.length,1);assert.deepEqual(note.errors,[]);assert.deepEqual(note.writes,[]);
  }finally{note.release();await note.context.close();}
 }
 console.log('Recap editor lazy leaf: cold roots, one concurrent request/sheet, retry, stale owner/timezone/path, exact month/year and old-notification Progress fallback PASS');
};
