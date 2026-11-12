// Monthly summary bell, recap destination and notification switch. The fixture is fictional; writes/delivery are stubbed.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8807',out=process.env.KINETTA_SHOTS;
const theme=process.env.KINETTA_THEME||'light',fixtureNow=new Date('2026-11-30T23:59:00-05:00');
function dateInZone(zone,now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>parts.find(p=>p.type===k).value;
 return`${get('year')}-${get('month')}-${get('day')}`;
}
function periodInZone(zone,now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit'}).formatToParts(now),get=k=>parts.find(p=>p.type===k).value;
 let y=Number(get('year')),m=Number(get('month'))-1;if(m===0){y--;m=12;}return`${y}-${String(m).padStart(2,'0')}`;
}
function nextMonth(period){const [y,m]=period.split('-').map(Number);return m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`;}
function monthAtOffset(period,offset){const [y,m]=period.split('-').map(Number);return new Date(Date.UTC(y,m-1-offset,1)).toISOString().slice(0,7);}
function monthStart(period){return period+'-01';}
function titleFor(period){return`Your ${new Date(period+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long'})} summary is ready`;}
async function shot(page,name,fullPage=false){if(!out)return;fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled',fullPage});}
async function ready(page){for(let i=0;i<120;i++){if(await page.evaluate(()=>App.pageReady))return;await page.waitForTimeout(100);}throw Error('Page did not finish loading');}
(async()=>{
  const zone='America/New_York',period=periodInZone(zone,fixtureNow),end=nextMonth(period),browser=await chromium.launch();
 try{
  const auth=await browser.newContext();assert.equal((await auth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const state=await auth.storageState();await auth.close();
  const context=await browser.newContext({storageState:state,viewport:{width:390,height:844},colorScheme:theme,timezoneId:zone,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[],puts=[];
  let push=Object.fromEntries(['friends','cheers','comments','dishes','activities','milestones','challenge_joins','challenge_reminders','challenge_finished','monthly_summary'].map(k=>[k,k==='monthly_summary']));
   const summary={id:54701,kind:'monthly_summary',period_type:'month',period,text:titleFor(period),detail:'112 mi · 18 workouts',link:`/notifications?summary=${period}`,created:fixtureNow.toISOString(),read:false,who:{login:'',name:'Kinetta',photo:null}};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
   if(pathname==='/api/challenges/signup/continue'&&request.method()==='POST')return route.fulfill({json:{}});
  if(pathname==='/api/notifications'&&request.method()==='GET')return route.fulfill({json:{items:[summary],unread:summary.read?0:1,push:{...push},push_ready:true}});
   if(pathname==='/api/notifications/read'&&request.method()==='POST'){writes.push('read');return route.fulfill({json:{unread:0}});}
   if(pathname==='/api/notifications/settings'&&request.method()==='PUT'){
    const data=request.postDataJSON();puts.push(data);push={...push,...data};return route.fulfill({json:{push:{...push}}});
   }
   if(pathname==='/api/recaps'&&request.method()==='GET'){
    const query=new URL(request.url()).searchParams,requested=query.get('period')||'last_month',offset=requested==='last_month'?1:Number(query.get('offset')||0),target=monthAtOffset(nextMonth(period).slice(0,7),offset),start=monthStart(target),days=Array.from({length:18},(_,i)=>({day:start,activities:i===0?18:0,distance_m:i===0?180246:0,time_s:i===0?36000:0}));
     return route.fulfill({json:{period:requested,offset:requested==='last_month'?0:offset,start,end:nextMonth(target),today:dateInZone(zone,fixtureNow),tz:zone,units:'imperial',activities:18,active_days:12,distance_m:180246,time_s:36000,top_sport:'run',days,highlights:[],streak_weeks:2,food:{logged_days:0,protein_goal_days:null},garmin_sources:[],monthly_offer:false}});
   }
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes.push(`${request.method()} ${pathname}`);return route.fulfill({status:204,body:''});}
   return route.continue();
  });
   await page.clock.setFixedTime(fixtureNow);await page.goto(base+'/notifications');await ready(page);await page.locator('[data-summary-period]').waitFor();
  await page.evaluate(()=>{App.me.tz='America/New_York';});
  assert.equal(await page.locator('.note-t').innerText(),titleFor(period));assert.equal(await page.locator('.note-q').innerText(),'112 mi · 18 workouts');
  await shot(page,`monthly-summary-bell-390-${theme}`);
  await page.locator('[data-summary-period]').click();await page.locator('.recap-sheet').waitFor();
  await page.locator('.recap-sheet #recap-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#recap-status').innerText(),'','recap data loaded without an error');
  const label=await page.locator('#recap-period-label').innerText();assert(label.includes(new Date(period+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long'})),'Bell item opens the same month');
  assert.equal(new URL(page.url()).pathname,'/notifications');await shot(page,`monthly-summary-sheet-390-${theme}`);
  await page.locator('.recap-sheet [data-close]').click();await page.locator('.recap-sheet').waitFor({state:'detached'});summary.read=true;
  await page.goto(base+'/notifications?summary=2020-10');await ready(page);await page.locator('.recap-sheet').waitFor();
  await page.locator('.recap-sheet #recap-status[data-ready="true"]').waitFor();assert.equal(await page.locator('#recap-status').innerText(),'','recap data loaded without an error');
  assert.equal(new URL(page.url()).pathname,'/progress','summaries older than 24 months open Progress → Share');
  assert(!/2020/.test(await page.locator('#recap-period-label').innerText()),'old summaries do not open a capped, incorrect month');
  await shot(page,`monthly-summary-old-period-fallback-390-${theme}`);
  await context.close();
  const settingsAuth=await browser.newContext();assert.equal((await settingsAuth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const settingsState=await settingsAuth.storageState();await settingsAuth.close();
  const settingsContext=await browser.newContext({storageState:settingsState,viewport:{width:390,height:844},colorScheme:theme,timezoneId:zone,serviceWorkers:'block',reducedMotion:'reduce'}),settingsPage=await settingsContext.newPage(),settingsErrors=[],settingsWrites=[],settingsPuts=[];
  let settingsPush={...push};settingsPage.on('pageerror',error=>settingsErrors.push(error.message));
  await settingsContext.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   if(pathname==='/api/challenges/signup/continue'&&request.method()==='POST')return route.fulfill({json:{}});
   if(pathname==='/api/notifications'&&request.method()==='GET')return route.fulfill({json:{items:[],unread:0,push:{...settingsPush},push_ready:true}});
   if(pathname==='/api/notifications/settings'&&request.method()==='PUT'){
    const data=request.postDataJSON();settingsPuts.push(data);settingsPush={...settingsPush,...data};return route.fulfill({json:{push:{...settingsPush}}});
   }
   if(pathname==='/api/notifications/personal')return route.fulfill({json:{plan:false,weekly:false,plan_time:'08:00',tz:zone,push_ready:true,device_ready:true}});
   if(pathname==='/api/food/reminders')return route.fulfill({json:{enabled:false,tz:zone,push_ready:true,device_ready:true,times:[]}});
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){settingsWrites.push(`${request.method()} ${pathname}`);return route.fulfill({status:204,body:''});}
   return route.continue();
  });
   await settingsPage.clock.setFixedTime(fixtureNow);await settingsPage.goto(base+'/me/notifications');await ready(settingsPage);await settingsPage.locator('#nt-push').waitFor();
  await settingsPage.evaluate(async()=>{
   Native.on=true;Native.pushSupported=true;Native.haptic=()=>{};Native.pushStatus=async()=>({enabled:true,denied:false});
   window.fixturePush={push_ready:true,push:{...Object.fromEntries(Object.keys(PUSH_NAMES).map(k=>[k,true]))}};
   await pushCard(document.querySelector('#nt-push'),fixturePush);
  });
  const toggle=settingsPage.locator('[data-monthly-summary]');await toggle.waitFor();assert(await toggle.isChecked(),'Monthly summary defaults on beside Weekly summary');
  await settingsPage.locator('.personal-notifications').evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await shot(settingsPage,`monthly-summary-switch-390-${theme}`);
  await toggle.uncheck();await settingsPage.waitForFunction(()=>{const input=document.querySelector('[data-monthly-summary]');return !!input&&!input.disabled;});assert.equal(settingsPuts.at(-1).monthly_summary,false);
  await toggle.check();await settingsPage.waitForFunction(()=>{const input=document.querySelector('[data-monthly-summary]');return !!input&&!input.disabled;});assert.equal(settingsPuts.at(-1).monthly_summary,true);
  assert.deepEqual(errors,[]);assert.deepEqual(settingsErrors,[]);assert.deepEqual(writes,['read']);assert.deepEqual(settingsWrites,[]);
  await settingsContext.close();console.log(`Monthly summary bell, exact-month Recaps.open sheet, default-on switch and blocked writes PASS; captures at 390px ${theme}.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
