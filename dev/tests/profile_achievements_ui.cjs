'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');

const makeTrack=(code,label,level,value,displayValue,displayUnit,tiers,next)=>({code,label,level,value,display_value:displayValue,display_unit:displayUnit,tiers,next});
const tier=(rank,label,threshold,day,activity_id)=>({rank,label,title:label,threshold,unit:'count',day,activity_id});
const stripCss='.profile-achievement-level-strip{padding:24px 16px}.profile-achievement-level-strip h1{margin:0 0 8px;font-size:1.35rem}.profile-achievement-level-strip>p{max-width:340px;margin:0 0 20px;color:var(--tx2)}.profile-achievement-level-swatches{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;max-width:358px}.profile-achievement-level-swatch{display:flex;flex-direction:column;align-items:center;gap:7px}.profile-achievement-level-swatch .profile-achievement-medallion{flex-basis:34px;width:34px;height:34px}.profile-achievement-level-swatch .profile-achievement-ring{inset:0}.profile-achievement-level-swatch .profile-achievement-icon{width:16px;height:16px}.profile-achievement-level-swatch small{color:var(--tx2);font-size:.7rem}.profile-achievement-level-swatch .profile-achievement-value,.profile-achievement-level-swatch .profile-achievement-level{display:none}';
const paletteCss=String.raw`
:root[data-achievement-palette] .profile-achievement-medallion { --achievement-palette-base:var(--color-brand); --palette-strength:22%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="1"] { --palette-strength:22%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="2"] { --palette-strength:32%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="3"] { --palette-strength:42%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="4"] { --palette-strength:52%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="5"] { --palette-strength:62%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="6"] { --palette-strength:72%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="7"] { --palette-strength:84%; }
:root[data-achievement-palette] .profile-achievement-medallion[data-level="8"] { --palette-strength:96%; }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="sport:run"] .profile-achievement-medallion,
:root[data-achievement-palette="p2"] .profile-achievement-level-swatch[data-achievement-code="sport:run"] .profile-achievement-medallion { --achievement-palette-base:var(--run); }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="sport:ride"] .profile-achievement-medallion { --achievement-palette-base:var(--ride); }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="sport:walk-hike"] .profile-achievement-medallion { --achievement-palette-base:var(--walk); }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="sport:swim"] .profile-achievement-medallion { --achievement-palette-base:var(--swim); }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="sport:lift"] .profile-achievement-medallion,
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="lifted"] .profile-achievement-medallion { --achievement-palette-base:var(--workout); }
:root[data-achievement-palette="p2"] .profile-achievement[data-achievement-code="climbing"] .profile-achievement-medallion { --achievement-palette-base:var(--hike); }
:root[data-achievement-palette="p1"] .profile-achievement-medallion,
:root[data-achievement-palette="p2"] .profile-achievement-medallion { --achievement-color:color-mix(in srgb,var(--achievement-palette-base) var(--palette-strength),var(--color-canvas)); }
:root[data-achievement-palette="p1"] .profile-achievement-ring-progress,
:root[data-achievement-palette="p2"] .profile-achievement-ring-progress { stroke:var(--color-on-action); }
:root[data-achievement-palette="p1"] .profile-achievement-medallion[data-level="6"],
:root[data-achievement-palette="p1"] .profile-achievement-medallion[data-level="7"],
:root[data-achievement-palette="p1"] .profile-achievement-medallion[data-level="8"],
:root[data-achievement-palette="p2"] .profile-achievement-medallion[data-level="6"],
:root[data-achievement-palette="p2"] .profile-achievement-medallion[data-level="7"],
:root[data-achievement-palette="p2"] .profile-achievement-medallion[data-level="8"] { box-shadow:0 0 18px 2px color-mix(in srgb,var(--achievement-palette-base) 38%,transparent),0 1px 4px color-mix(in srgb,var(--achievement-palette-base) 34%,transparent); }
:root[data-achievement-palette="p3"] .profile-achievement-medallion { --achievement-color:var(--color-soft); }
:root[data-achievement-palette="p3"] .profile-achievement-ring-base { stroke:var(--color-outline); opacity:.65; }
:root[data-achievement-palette="p3"] .profile-achievement-ring-progress { stroke:color-mix(in srgb,var(--color-brand-soft) calc(100% - var(--palette-strength)),var(--color-brand) var(--palette-strength)); }
:root[data-achievement-palette="p3"] .profile-achievement-level { background:var(--color-soft); border-color:color-mix(in srgb,var(--color-brand-soft) calc(100% - var(--palette-strength)),var(--color-brand) var(--palette-strength)); color:color-mix(in srgb,var(--color-brand-soft) calc(100% - var(--palette-strength)),var(--color-brand) var(--palette-strength)); }
:root[data-achievement-palette="p3"] .profile-achievement-medallion[data-level="6"],
:root[data-achievement-palette="p3"] .profile-achievement-medallion[data-level="7"],
:root[data-achievement-palette="p3"] .profile-achievement-medallion[data-level="8"] { box-shadow:0 1px 4px color-mix(in srgb,var(--color-text) 16%,transparent); }
:root[data-achievement-palette="p3"] .profile-achievement-icon { color:var(--color-on-action); filter:drop-shadow(0 0 1px var(--color-text)) drop-shadow(0 1px 2px color-mix(in srgb,var(--color-text) 55%,transparent)); }
:root[data-achievement-palette="p3"] .profile-achievement-value { color:var(--color-on-action); text-shadow:0 0 1px var(--color-text),0 0 2px color-mix(in srgb,var(--color-text) 70%,transparent); }
:root[data-achievement-evidence="all-tracks"] nav.tabs { display:none !important; }
@media(prefers-color-scheme:dark){
 :root[data-achievement-palette="p1"] .profile-achievement-medallion,
 :root[data-achievement-palette="p2"] .profile-achievement-medallion { --achievement-color:color-mix(in srgb,var(--achievement-palette-base) calc(100% - var(--palette-strength)),var(--color-canvas) var(--palette-strength)); }
}
`;
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
const screenshot=async(page,dir,name,options={})=>{if(!dir)return;fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`,animations:'disabled',...options});};
const brightness=color=>{const channels=(color.match(/[\d.]+/g)||[]).slice(0,3).map(Number);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
const assertRingText=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-value').evaluateAll(nodes=>nodes.map(node=>{
  const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()];
  return{code:node.closest('[data-achievement-code]')?.dataset.achievementCode||'history',text:node.textContent.trim(),fontSize:parseFloat(getComputedStyle(node).fontSize),lines:new Set(rects.map(r=>Math.round(r.top*2)/2)).size};
 }));
 assert(metrics.length,`${label} includes medallion values`);
 assert(metrics.every(m=>m.fontSize>=12&&m.lines<=2),`${label} values are at least 12px and at most two lines: ${JSON.stringify(metrics)}`);
};

module.exports=async({browser,storageState,base,shots})=>{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'});
  const page=await context.newPage(),errors=[],writes=[];let journeyLandmark='Across the US';
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.__achievementVibrations=0;const original=navigator.vibrate?.bind(navigator);navigator.vibrate=(...args)=>{window.__achievementVibrations++;return original?original(...args):false;};});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base)return route.abort();
   if(request.method()==='GET'&&url.pathname.endsWith('/profile.css')){const response=await route.fetch();return route.fulfill({response,body:(await response.text())+'\n'+paletteCss+'\n'+stripCss});}
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
  const profileList=page.locator('.profile-achievements .profile-achievement-list');
  assert.equal(await profileList.locator('.profile-achievement').count(),13,'the profile shows every started track in its sideways rail');
  assert(await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(n=>n.classList.contains('is-level-up')),'a previously seen level increase animates');
  const rail=await profileList.evaluate(n=>{const r=n.getBoundingClientRect(),first=n.querySelector('.profile-achievement').getBoundingClientRect(),fourth=n.querySelectorAll('.profile-achievement')[3].getBoundingClientRect();return{listLeft:r.left,listRight:r.right,firstLeft:first.left,fourthLeft:fourth.left,fourthRight:fourth.right,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,scrollPaddingLeft:getComputedStyle(n).scrollPaddingLeft};});
  assert.equal(Math.round(rail.firstLeft-rail.listLeft),16,'the first profile medallion has a 16px inset');
  assert.equal(parseFloat(rail.scrollPaddingLeft),16,'horizontal snap alignment preserves the 16px inset');
  assert(rail.fourthLeft<rail.listRight&&rail.fourthRight>rail.listRight,'the next medallion peeks in from the right');
  assert(rail.scrollWidth>rail.clientWidth,'the profile rail remains horizontally scrollable');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="journey"] .profile-achievement-value').innerText(),'3,790 mi','Journey follows the owner’s miles');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="climbing"] .profile-achievement-value').innerText(),'1.9 Everests','Climbing stays in Everest counts');
  const iconMap=await page.locator('.profile-achievement[data-achievement-code]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.achievementCode,n.querySelector('[data-achievement-icon]')?.dataset.achievementIcon])));
  assert.deepEqual(iconMap,{journey:'bridge',workouts:'lightning',lifted:'kettlebell','sport:run':'runner',active_time:'stopwatch',years_active:'calendar',consistency:'flame',climbing:'mountain',personal_bests:'trophy','sport:ride':'bike','sport:walk-hike':'footprints','sport:swim':'waves','sport:lift':'kettlebell'});
  const kettlebell=await page.locator('.profile-achievement[data-achievement-code="lifted"] .profile-achievement-icon').evaluate(svg=>{const paths=[...svg.querySelectorAll('path')];return{pathCount:paths.length,archedHandle:paths[0]?.getAttribute('stroke-linecap')==='round'&&paths[0]?.getAttribute('fill')==='none',flatBase:paths[1]?.getAttribute('d').includes('H8.3')};});
  assert.deepEqual(kettlebell,{pathCount:2,archedHandle:true,flatBase:true},`Lifted uses a distinct arched kettlebell handle and rounded body with a flat base: ${JSON.stringify(kettlebell)}`);
  assert.doesNotMatch(await page.locator('.profile-achievements').innerText(),/[\u{1F300}-\u{1FAFF}]/u,'achievement labels contain no emoji');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="workouts"] .profile-achievement-medallion').getAttribute('data-level-tone'),'deep','level six uses the saturated tone');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the profile rail does not widen the page');
  await assertRingText(profileList,'profile');
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(saved.workouts,6,'the last seen level updates once');
  assert.equal(await page.evaluate(()=>window.__achievementVibrations),0,'a web level up does not vibrate');
  let levelUpAnimations=0;
  if(theme==='light'&&shots){
   await page.evaluate(()=>document.documentElement.dataset.achievementPalette='p1');
   levelUpAnimations=await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(card=>{const animations=card.getAnimations({subtree:true});for(const animation of animations){animation.pause();animation.currentTime=300;}return animations.length;});
   assert(levelUpAnimations>=2,'the captured level-up frame pauses both medallion pop and ring fill');
  }
  await page.locator('.profile-achievements').scrollIntoViewIfNeeded();
  if(theme==='light'&&shots){
   await screenshot(page,shots,'profile-level-up-frame-390-light',{animations:'allow'});
   await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(card=>card.getAnimations({subtree:true}).forEach(animation=>animation.cancel()));
  }

  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const list=page.locator('#profile-achievement-page .profile-achievement-list');
  assert.equal(await list.locator('.profile-achievement').count(),13,'See all opens the complete started-track list');
  assert((await list.getAttribute('class')).split(/\s+/).includes('is-grid'),'all tracks use the vertical grid variant');
  assert.equal(await list.getAttribute('role'),'list');
  const grid=await list.evaluate(n=>{const cards=[...n.querySelectorAll('.profile-achievement')],tops=cards.map(c=>c.getBoundingClientRect().top);return{display:getComputedStyle(n).display,overflowX:getComputedStyle(n).overflowX,columns:getComputedStyle(n).gridTemplateColumns.split(/\s+/).length,firstRowSame:Math.max(...tops.slice(0,3))-Math.min(...tops.slice(0,3))<1,nextRowBelow:tops[3]>tops[2]};});
  assert.equal(grid.display,'grid','all tracks are arranged vertically');assert.equal(grid.columns,3,'all tracks use three columns');
  assert.equal(grid.firstRowSame,true,'three tracks share each grid row');assert.equal(grid.nextRowBelow,true,'the fourth track begins the next row');
  const gridFitsPage=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  assert(grid.overflowX==='visible'&&gridFitsPage,'the grid is vertical and does not widen the page');
  await assertRingText(list,'all-tracks grid');
  await page.evaluate(()=>document.documentElement.dataset.achievementPalette='p1');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');
  await screenshot(page,shots,`achievement-grid-390-${theme}`,{fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  const journey=list.locator('[data-achievement-code="journey"]');assert.match(await journey.getAttribute('href'),/\/me\/achievements\/journey$/,'each medallion links to its history');
  await journey.click();await page.waitForURL('**/me/achievements/journey');
  const history=page.locator('.profile-achievement-history-head');await history.waitFor();assert.equal(await history.locator('h1').innerText(),'Journey');assert.equal(await history.locator('.profile-achievement-current').innerText(),'Level 4 · 3,790 mi');
  await assertRingText(page.locator('#profile-achievement-page'),'Journey history');
  await page.evaluate(()=>document.documentElement.dataset.achievementPalette='p1');
  const dateGeometry=await page.locator('.profile-achievement-history li').first().evaluate(li=>{const date=li.querySelector('time').getBoundingClientRect(),chevron=li.querySelector('.profile-achievement-history-chevron').getBoundingClientRect();return{dateRight:date.right,chevronLeft:chevron.left};});
  assert(dateGeometry.dateRight<=dateGeometry.chevronLeft+1,'history dates sit before the chevron');
  await screenshot(page,shots,`achievement-history-390-${theme}`);

  for(const [landmark,icon] of [['Marathon','medal'],['Lake Tahoe loop','waves'],['Length of the UK','castle'],['Across the US','bridge'],['Length of Africa','acacia'],['Around the world','globe'],['To the Moon','moon']]){
   journeyLandmark=landmark;await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('[data-achievement-code="journey"] [data-achievement-icon]').getAttribute('data-achievement-icon'),icon,`Journey uses ${icon} at ${landmark}`);
  }

  for(const palette of ['p1','p2','p3']){
   journeyLandmark='Across the US';await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
   await page.evaluate(p=>{document.documentElement.dataset.achievementPalette=p;},palette);
   const paletteColors=await page.locator('.profile-achievement[data-achievement-code="journey"] .profile-achievement-medallion').evaluate(journey=>({journey:getComputedStyle(journey).backgroundColor,run:getComputedStyle(document.querySelector('.profile-achievement[data-achievement-code="sport:run"] .profile-achievement-medallion')).backgroundColor}));
   if(palette==='p2')assert.notEqual(paletteColors.journey,paletteColors.run,'P2 gives the sport track its existing run colour while general tracks stay brand blue');
   else assert.equal(paletteColors.journey,paletteColors.run,`${palette.toUpperCase()} gives same-level tracks one palette family`);
   await page.locator('.profile-achievements').scrollIntoViewIfNeeded();await screenshot(page,shots,`palette-${palette}-profile-390-${theme}`);
   await page.evaluate(()=>{
    const runner='<circle cx="15.5" cy="4.5" r="2.5"/><path d="m12 8 4 1 2.2 3.2 3.2 1.1-.7 2-4-1.4-2-2.4-2 2.2 3.6 2.4 2.1 5.2h-2.3l-1.7-4-4.4-2.4-2.9 3.8H4.5l3.8-5.7 3.1-3.1-1.1-.6-2.4 2.5-3.3-.5.3-2.1 2.4.3L10 9.1A3 3 0 0 1 12 8Z"/>';
    const cards=Array.from({length:8},(_,i)=>{
     const level=i+1,tone=level>=6?'deep':String(level);
     return `<div class="profile-achievement-level-swatch" data-achievement-code="sport:run"><span class="profile-achievement-medallion" data-level="${level}" data-level-tone="${tone}" aria-hidden="true"><svg class="profile-achievement-ring" viewBox="0 0 104 104"><circle class="profile-achievement-ring-base" cx="52" cy="52" r="47"/><circle class="profile-achievement-ring-progress" cx="52" cy="52" r="47" stroke-dasharray="221.5 295.3" transform="rotate(-90 52 52)"/></svg><svg class="profile-achievement-icon" viewBox="0 0 24 24">${runner}</svg><span class="profile-achievement-value">49.7 mi</span><span class="profile-achievement-level">Lv ${level}</span></span><small>Lv ${level}</small></div>`;
    }).join('');
    document.body.innerHTML=`<main class="profile-achievement-level-strip"><h1>Run · level colours</h1><p>Fictional progression through Lv 1–8 using the selected palette.</p><div class="profile-achievement-level-swatches">${cards}</div></main>`;
   });
   const levelColors=await page.locator('.profile-achievement-level-swatch .profile-achievement-medallion').evaluateAll(nodes=>nodes.map(node=>({fill:getComputedStyle(node).backgroundColor,ring:getComputedStyle(node.querySelector('.profile-achievement-ring-progress')).stroke})));
   if(palette==='p3'){
    assert(levelColors.every(color=>color.fill===levelColors[0].fill),'P3 keeps every medallion graphite');
    const towardBrand=await page.evaluate(()=>{
     const ctx=document.createElement('canvas').getContext('2d'),rgb=color=>{ctx.fillStyle='#000';ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return[...ctx.getImageData(0,0,1,1).data].slice(0,3);};
     const brand=rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-brand'));
     return [...document.querySelectorAll('.profile-achievement-level-swatch .profile-achievement-ring-progress')].map(node=>{
      const color=rgb(getComputedStyle(node).stroke);return Math.hypot(color[0]-brand[0],color[1]-brand[1],color[2]-brand[2]);
     });
    });
    assert(towardBrand[7]<towardBrand[0],'P3 brand ring grows stronger toward the brand token through levels');
   }else assert(brightness(levelColors[0].fill)>brightness(levelColors[7].fill),`${palette.toUpperCase()} medallions deepen from Lv 1 to Lv 8 in ${theme}`);
   if(shots){fs.mkdirSync(shots,{recursive:true});await page.locator('.profile-achievement-level-strip').screenshot({path:`${shots}/palette-${palette}-levels-390-${theme}.png`,animations:'disabled'});}
  }
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
