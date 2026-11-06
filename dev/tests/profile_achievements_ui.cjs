'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');

const makeTrack=(code,label,level,value,displayValue,displayUnit,tiers,next)=>({code,label,level,value,display_value:displayValue,display_unit:displayUnit,tiers,next});
const tier=(rank,label,threshold,day,activity_id)=>({rank,label,title:label,threshold,unit:'count',day,activity_id});
const stripCss='.profile-achievement-level-strip{padding:24px 16px}.profile-achievement-level-strip h1{margin:0 0 8px;font-size:1.35rem}.profile-achievement-level-strip>p{max-width:340px;margin:0 0 20px;color:var(--tx2)}.profile-achievement-level-swatches{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;max-width:358px}.profile-achievement-level-swatch{--achievement-hue:270;display:flex;flex-direction:column;align-items:center;gap:7px}.profile-achievement-level-swatch .profile-achievement-medallion{flex-basis:34px;width:34px;height:34px}.profile-achievement-level-swatch .profile-achievement-icon{width:16px;height:16px}.profile-achievement-level-swatch small{color:var(--tx2);font-size:.7rem}.profile-achievement-level-swatch .profile-achievement-value,.profile-achievement-level-swatch .profile-achievement-level{display:none}';
const achievementFixture={pending:false,tracks:[
 makeTrack('journey','Journey',4,6099414,3790,'mi',[
  tier(1,'Marathon',42195,'2026-10-10',1001),tier(2,'Lake Tahoe loop',114000,'2026-10-17',1002),
  tier(3,'Length of the UK',1407000,'2026-10-28',1003),tier(4,'Across the US',4000000,'2026-11-05',1004)],
  {label:'Length of Africa',threshold:7400000,display_threshold:4598.1,display_unit:'mi'}),
 makeTrack('workouts','Workouts',6,1120,1120,'workouts',[tier(6,'1,000 workouts',1000,'2026-11-04',1101)],
  {label:'1,500 workouts',threshold:1500,display_threshold:1500,display_unit:'workouts'}),
 makeTrack('lifted','Lifted',2,56700,125000,'lb',[tier(2,'An elephant',6000,'2026-11-03',1201)],
  {label:'A blue whale',threshold:150000,display_threshold:330693,display_unit:'lb'}),
 makeTrack('sport:run','Run',4,80000,49.7,'mi',[tier(4,'Marathon',42195,'2026-11-02',1301)],
  {label:'84.4 km',threshold:84390,display_threshold:52.4,display_unit:'mi'}),
 makeTrack('active_time','Active time',6,3960000,1100,'h',[tier(6,'1,000 active hours',3600000,'2026-11-01',1401)],
  {label:'1,500 active hours',threshold:5400000,display_threshold:1500,display_unit:'h'}),
 makeTrack('years_active','Years active',5,5,5,'years',[tier(5,'5 years active',5,'2026-10-31',1501)],
  {label:'6 years active',threshold:6,display_threshold:6,display_unit:'years'}),
 makeTrack('consistency','Consistency',3,22,22,'weeks',[tier(3,'20 active weeks',20,'2026-10-30',1601)],
  {label:'52 active weeks',threshold:52,display_threshold:52,display_unit:'weeks'}),
 makeTrack('climbing','Climbing',3,17000,55774,'ft',[tier(3,'1 Everest',8849,'2026-10-29',1701)],
  {label:'2 Everests',threshold:17698,display_threshold:58064,display_unit:'ft'}),
 makeTrack('personal_bests','Personal bests',3,10,10,'bests',[tier(3,'10 personal bests',10,'2026-10-27',1801)],
  {label:'25 personal bests',threshold:25,display_threshold:25,display_unit:'bests'}),
 makeTrack('sport:ride','Ride',3,100000,62.1,'mi',[tier(3,'100 km',100000,'2026-10-26',1901)],
  {label:'200 km',threshold:200000,display_threshold:124.3,display_unit:'mi'}),
 makeTrack('sport:walk-hike','Walk & hike',3,30000,18.6,'mi',[tier(3,'Half marathon',21097.5,'2026-10-25',2001)],
  {label:'42.2 km',threshold:42195,display_threshold:26.2,display_unit:'mi'}),
 makeTrack('sport:swim','Swim',2,6000,3.7,'mi',[tier(2,'5 km',5000,'2026-10-24',2101)],
  {label:'10 km',threshold:10000,display_threshold:6.2,display_unit:'mi'}),
 makeTrack('sport:lift','Lift',3,22,22,'sessions',[tier(3,'10 lift sessions',10,'2026-10-23',2201)],
  {label:'25 lift sessions',threshold:25,display_threshold:25,display_unit:'sessions'})
]};

const until=async(page,fn,label)=>{for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);};
const screenshot=async(page,dir,name)=>{if(!dir)return;fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`,animations:'disabled'});};

module.exports=async({browser,storageState,base,shots})=>{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'});
  const page=await context.newPage(),errors=[],writes=[];let journeyLandmark='Across the US';
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.__achievementVibrations=0;const original=navigator.vibrate?.bind(navigator);navigator.vibrate=(...args)=>{window.__achievementVibrations++;return original?original(...args):false;};});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base)return route.abort();
   if(request.method()==='GET'&&url.pathname==='/__achievement-level-strip.css')return route.fulfill({status:200,contentType:'text/css',body:stripCss});
   if(request.method()==='GET'&&url.pathname==='/api/achievements'){
    const data=JSON.parse(JSON.stringify(achievementFixture)),journey=data.tracks.find(t=>t.code==='journey');journey.tiers.at(-1).label=journeyLandmark;journey.tiers.at(-1).title=journeyLandmark;
    return route.fulfill({json:data});
   }
   if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{}});}
   return route.continue();
  });
  await page.goto(base+'/me');await until(page,()=>App.pageReady,'fixture login');
  const key=await page.evaluate(()=>`kinetta.achievement-levels.v1:${Native.base||location.origin}:${App.me.id}`);
  await page.evaluate(({key})=>localStorage.setItem(key,JSON.stringify({journey:3,workouts:5})),{key});
  const webHaptic=await page.evaluate(()=>Native.achievementLevelUp());
  assert.equal(webHaptic,false,'the achievement success feedback is disabled on web');

  await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  assert.equal(await page.locator('.profile-achievements .profile-achievement').count(),13,'the profile shows every started track in its sideways rail');
  assert(await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(n=>n.classList.contains('is-level-up')),'a previously seen level increase animates');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="journey"] .profile-achievement-value').innerText(),'3,790 mi','Journey follows the owner’s miles');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="climbing"] .profile-achievement-value').innerText(),'1.9 Everests','Climbing stays in Everest counts');
  const iconMap=await page.locator('.profile-achievement[data-achievement-code]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.achievementCode,n.querySelector('[data-achievement-icon]')?.dataset.achievementIcon])));
  assert.deepEqual(iconMap,{journey:'bridge',workouts:'lightning',lifted:'kettlebell','sport:run':'runner',active_time:'stopwatch',years_active:'calendar',consistency:'flame',climbing:'mountain',personal_bests:'trophy','sport:ride':'bike','sport:walk-hike':'footprints','sport:swim':'waves','sport:lift':'kettlebell'});
  assert.doesNotMatch(await page.locator('.profile-achievements').innerText(),/[\u{1F300}-\u{1FAFF}]/u,'achievement labels contain no emoji');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="workouts"] .profile-achievement-medallion').getAttribute('data-level-tone'),'deep','level six uses the saturated tone');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the profile rail does not widen the page');
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(saved.workouts,6,'the last seen level updates once');
  assert.equal(await page.evaluate(()=>window.__achievementVibrations),0,'a web level up does not vibrate');
  await page.locator('.profile-achievements').scrollIntoViewIfNeeded();await screenshot(page,shots,`profile-achievements-390-${theme}`);

  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const list=page.locator('#profile-achievement-page .profile-achievement-list');
  assert.equal(await list.locator('.profile-achievement').count(),13,'See all opens the complete started-track list');
  assert.equal(await list.getAttribute('role'),'list');
  await list.evaluate(n=>{n.scrollLeft=0;});await screenshot(page,shots,`achievement-list-start-390-${theme}`);
  await list.evaluate(n=>{n.scrollLeft=Math.max(0,n.clientWidth-30);});await page.waitForTimeout(100);await screenshot(page,shots,`achievement-list-middle-a-390-${theme}`);
  await list.evaluate(n=>{n.scrollLeft=Math.min(n.scrollWidth-n.clientWidth,2*(n.clientWidth-30)+128);});await page.waitForTimeout(100);await screenshot(page,shots,`achievement-list-middle-b-390-${theme}`);
  await list.evaluate(n=>{n.scrollLeft=n.scrollWidth;});await page.waitForTimeout(100);await screenshot(page,shots,`achievement-list-end-390-${theme}`);
  const journey=list.locator('[data-achievement-code="journey"]');assert.match(await journey.getAttribute('href'),/\/me\/achievements\/journey$/,'each medallion links to its history');
  await list.evaluate(n=>{n.scrollLeft=0;});await journey.click();await page.waitForURL('**/me/achievements/journey');
  const history=page.locator('.profile-achievement-history-head');await history.waitFor();assert.equal(await history.locator('h1').innerText(),'Journey');assert.equal(await history.locator('.profile-achievement-current').innerText(),'Level 4 · 3,790 mi');
  const dateGeometry=await page.locator('.profile-achievement-history li').first().evaluate(li=>{const date=li.querySelector('time').getBoundingClientRect(),chevron=li.querySelector('.profile-achievement-history-chevron').getBoundingClientRect();return{dateRight:date.right,chevronLeft:chevron.left};});
  assert(dateGeometry.dateRight<=dateGeometry.chevronLeft+1,'history dates sit before the chevron');
  await screenshot(page,shots,`achievement-history-390-${theme}`);

  for(const [landmark,icon] of [['Marathon','medal'],['Lake Tahoe loop','waves'],['Length of the UK','castle'],['Across the US','bridge'],['Length of Africa','acacia'],['Around the world','globe'],['To the Moon','moon']]){
   journeyLandmark=landmark;await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('[data-achievement-code="journey"] [data-achievement-icon]').getAttribute('data-achievement-icon'),icon,`Journey uses ${icon} at ${landmark}`);
  }

  await page.evaluate(()=>{
   const cards=Array.from({length:8},(_,i)=>{const level=i+1,tone=level>=6?'deep':String(level);return `<div class="profile-achievement-level-swatch" data-achievement-code="workouts"><span class="profile-achievement-medallion" data-level="${level}" data-level-tone="${tone}" aria-hidden="true"><svg class="profile-achievement-icon" viewBox="0 0 24 24"><path d="M13.5 1.5 4 13.4a1 1 0 0 0 .8 1.6h5.6l-.9 7.5 10.6-13a1 1 0 0 0-.8-1.6h-5.7l.9-6.4a.6.6 0 0 0-1-.5Z"/></svg></span><small>Lv ${level}</small></div>`;}).join('');
   document.body.innerHTML=`<main class="profile-achievement-level-strip"><h1>Workouts · level colour</h1><p>Fictional progression from pale Lv 1 to the saturated glow at Lv 6+.</p><div class="profile-achievement-level-swatches">${cards}</div></main>`;
  });
  await page.evaluate(()=>new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/__achievement-level-strip.css';link.onload=resolve;link.onerror=reject;document.head.append(link);}));
  await screenshot(page,shots,`achievement-level-strip-390-${theme}`);
  assert.deepEqual(errors,[],`no browser errors in ${theme}`);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[],`no unmocked writes in ${theme}`);
  console.log(`Achievement medallions 390 ${theme}: profile, all tracks, history, units, icons and web haptic guard PASS`);
  await context.close();
 }
 const nativeContext=await browser.newContext(),nativePage=await nativeContext.newPage();
 await nativeContext.addInitScript(()=>{
  window.__achievementHaptics=[];
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',Plugins:{Preferences:{get:async()=>({value:null}),set:async()=>{},remove:async()=>{}},KinettaHaptics:{tap:async({kind})=>{window.__achievementHaptics.push(kind);}}}};
 });
 await nativePage.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD'].includes(request.method()))return route.fulfill({json:{}});return route.continue();});
 await nativePage.goto(base+'/');
 const nativeResult=await nativePage.evaluate(()=>Native.achievementLevelUp());
 for(let i=0;i<20&&!(await nativePage.evaluate(()=>window.__achievementHaptics.length));i++)await nativePage.waitForTimeout(10);
 assert.equal(nativeResult,true,'the existing iOS Capacitor plugin is used when available');
 assert.deepEqual(await nativePage.evaluate(()=>window.__achievementHaptics),['success'],'a level up requests light success feedback once');
 await nativeContext.close();
 console.log('Achievement native bridge: mocked iPhone plugin receives one success haptic');
};
