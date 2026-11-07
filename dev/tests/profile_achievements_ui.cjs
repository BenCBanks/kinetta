'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../../app/static/profile.achievement-levels.json'),'utf8'));
assert.equal(catalog.version,3,'the profile uses Sage/Ben catalog v3');
for(const [code,track] of Object.entries(catalog.tracks)){
 const glyphs=track.levels.map(row=>row.emoji);
 for(let i=0;i<glyphs.length;i++){const nearby=glyphs.slice(i,i+3);assert.equal(new Set(nearby).size,nearby.length,`${code} level icon differs from the next two levels`);}
 for(const row of track.levels){const file=path.join(__dirname,'../../app/static',row.icon.replace(/^\/static\//,'').split('?')[0]);assert(fs.existsSync(file),`${code}/${row.name} has a local Fluent Flat SVG`);}
}
assert.deepEqual(catalog.tracks.workouts.levels.slice(0,2).map(row=>[row.name,row.asset_name]),[['First workout','Seedling'],['Sprig','Herb']],'Workouts early icons follow the seedling family');
assert.deepEqual(catalog.tracks.active_time.levels.slice(-2).map(row=>row.name),['A working year','Mastery']);
assert.doesNotMatch(JSON.stringify(catalog),/A year of days|Century club|blue whales ×/i);
assert.deepEqual(catalog.tracks.lifted.levels.slice(3,5).map(row=>row.name),['A school bus','A loaded semi truck']);
assert.equal(catalog.tracks.lifted.levels[7].name,'A jumbo jet');
assert.equal(catalog.tracks.journey.levels[0].canonical_value,10);
assert.equal(catalog.tracks['sport:ride'].levels[4].name,'Metric century');
assert.equal(catalog.tail.first_multiple,2);

const makeTrack=(code,label,level,value,displayValue,displayUnit,tiers,next)=>({code,label,level,value,display_value:displayValue,display_unit:displayUnit,tiers,next});
const tier=(rank,label,threshold,day,activity_id)=>({rank,label,title:label,threshold,unit:'count',day,activity_id});
const catalogValue=level=>{
 const value=Number(level.canonical_value)||0;
 return level.canonical_unit==='km'?value*1000:level.canonical_unit==='hours'?value*3600:value;
};
const v2History=(code,overrides={})=>{
 const definition=catalog.tracks[code],track=achievementFixture.tracks.find(row=>row.code===code);
 if(!definition||!track)return{code,tiers:[],pending:false};
 const value=Number(overrides[code]??track.value)||0;
 const levels=definition.levels.map((level,index)=>({rank:index+1,name:level.name,threshold:catalogValue(level)})).filter(level=>level.threshold<=value);
 const last=definition.levels.at(-1),base=catalogValue(last);let multiple=Math.max(2,Number(catalog.tail.first_multiple)||2);
 while(base>0&&base*multiple<=value&&levels.length<10000){levels.push({rank:levels.length+1,name:`${last.name} ×${multiple}`,threshold:base*multiple});multiple++;}
 return{code,pending:false,tiers:levels.map((level,index)=>({...level,day:new Date(Date.UTC(2026,9,1+index)).toISOString().slice(0,10),activity_id:3000+index,date_source:'activity'}))};
};
const stripCss='.profile-achievement-level-strip{padding:24px 16px}.profile-achievement-level-strip h1{margin:0 0 8px;font-size:1.35rem}.profile-achievement-level-strip>p{max-width:340px;margin:0 0 20px;color:var(--tx2)}.profile-achievement-level-swatches{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;max-width:358px}.profile-achievement-level-swatch{--achievement-palette-base:var(--run);display:flex;flex-direction:column;align-items:center;gap:7px}.profile-achievement-level-swatch .profile-achievement-medallion{flex-basis:34px;width:34px;height:34px}.profile-achievement-level-swatch .profile-achievement-ring{inset:0}.profile-achievement-level-swatch .profile-achievement-icon{width:16px;height:16px}.profile-achievement-level-swatch small{color:var(--tx2);font-size:.7rem}.profile-achievement-level-swatch .profile-achievement-value,.profile-achievement-level-swatch .profile-achievement-level{display:none}:root[data-achievement-evidence="all-tracks"] nav.tabs,:root[data-achievement-evidence="track"] nav.tabs{display:none!important}';
const achievementFixture={pending:false,tracks:[
 makeTrack('journey','Journey',4,6099414,3790,'mi',[
  tier(1,'Marathon',42195,'2026-10-10',1001),tier(2,'Lake Tahoe loop',114000,'2026-10-17',1002),
  tier(3,'Length of the UK',1407000,'2026-10-28',1003),tier(4,'Across the US',4000000,'2026-11-05',1004)],
  {label:'Length of Africa',threshold:7400000,display_threshold:4598.1,display_unit:'mi'}),
 makeTrack('workouts','Workouts',8,1120,1120,'workouts',[tier(8,'Grove',1000,'2026-11-04',1101)],
  {label:'Forest',threshold:1500,display_threshold:1500,display_unit:'workouts'}),
 makeTrack('lifted','Lifted',4,300000,661387,'lb',[tier(1,'A car',1500,'2026-09-10',1200),tier(2,'An elephant',6000,'2026-10-10',1201),tier(3,'A blue whale',150000,'2026-10-20',1202),tier(4,'2 blue whales',300000,'2026-11-03',1203)],
  {label:'3 blue whales',threshold:450000,display_threshold:992080,display_unit:'lb'}),
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
const historyUnits={consistency:'weeks',years_active:'years',workouts:'workouts',active_time:'seconds',journey:'m',climbing:'m',lifted:'kg',personal_bests:'bests','sport:run':'m','sport:ride':'m','sport:walk-hike':'m','sport:swim':'m','sport:lift':'sessions'};
const displayHistoryTier=(code,value,units)=>{
 if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(code))return units==='imperial'?[value/1609.344,'mi']:[value/1000,'km'];
 if(code==='climbing')return units==='imperial'?[value*3.28084,'ft']:[value,'m'];
 if(code==='lifted')return units==='imperial'?[value*2.2046226218,'lb']:[value,'kg'];
 if(code==='active_time')return [value/3600,'h'];
 return [value,historyUnits[code]||'count'];
};

const until=async(page,fn,label,arg)=>{for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);};
const screenshot=async(page,dir,name,options={})=>{if(!dir)return;fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`,animations:'disabled',...options});};
const brightness=color=>{const channels=(color.match(/[\d.]+/g)||[]).slice(0,3).map(Number);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
const assertRingText=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-value').evaluateAll(nodes=>nodes.map(node=>{
  const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()],badge=node.closest('.profile-achievement-medallion').getBoundingClientRect();
  return{code:node.closest('[data-achievement-code]')?.dataset.achievementCode||'history',text:node.textContent.trim(),fontSize:parseFloat(getComputedStyle(node).fontSize),lines:new Set(rects.map(r=>Math.round(r.top*2)/2)).size,fits:node.scrollWidth<=node.clientWidth+1&&rects.every(r=>r.left>=badge.left-1&&r.right<=badge.right+1&&r.top>=badge.top-1&&r.bottom<=badge.bottom+1)};
 }));
 assert(metrics.length,`${label} includes medallion values`);
 assert(metrics.every(m=>m.fontSize>=10&&m.lines<=2&&m.fits),`${label} values stay within the medal at 10px or larger: ${JSON.stringify(metrics)}`);
};
const assertLargeTextFit=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-value').evaluateAll(nodes=>nodes.map(node=>{
  node.style.fontSize='22px';delete node.dataset.fitTextMax;const fontSize=window.KinettaTextFit.fitElement(node),range=document.createRange();range.selectNodeContents(node);
  const badge=node.closest('.profile-achievement-medallion').getBoundingClientRect(),rects=[...range.getClientRects()];
  return{fontSize,width:node.clientWidth,scrollWidth:node.scrollWidth,lines:new Set(rects.map(r=>Math.round(r.top*2)/2)).size,fits:rects.every(r=>r.left>=badge.left-1&&r.right<=badge.right+1&&r.top>=badge.top-1&&r.bottom<=badge.bottom+1)};
 }));
 assert(metrics.length,`${label} includes medallion values`);
 assert(metrics.every(m=>m.fontSize>=10&&m.fontSize<=22&&m.scrollWidth<=m.width+1&&m.lines<=2&&m.fits),`${label} values fit at large text without going below 10px: ${JSON.stringify(metrics)}`);
 assert(metrics.some(m=>m.fontSize<22),`${label} scales a long value down in steps`);
};
const assertCompactFallback=async(page,label)=>{
 const result=await page.evaluate(()=>{const value=document.createElement('span');value.className='profile-achievement-value';value.style.width='50px';value.textContent='1,120 workouts';document.body.append(value);const fontSize=window.KinettaTextFit.fitElement(value),result={fontSize,text:value.textContent,source:value.dataset.fitTextSource};value.remove();return result;});
 assert.equal(result.text,'1.1k workouts',`${label} abbreviates when the full value would need text below 10px`);
 assert.equal(result.source,'1,120 workouts',`${label} preserves the complete source value for later resizing`);
 assert(result.fontSize>=10,`${label} never uses text below 10px`);
};
const assert330AchievementViews=async(page,base,setUnits,theme,shots)=>{
 await page.setViewportSize({width:330,height:844});await setUnits('metric');
 await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
 await assertRingText(page.locator('.profile-achievements'),'330px profile');await screenshot(page,shots,`achievement-profile-330-${theme}`);
 await assertLargeTextFit(page.locator('.profile-achievements'),'330px large-text profile');await assertCompactFallback(page,'330px profile');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'330px profile has no page-level horizontal overflow');
 await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
 await assertRingText(page.locator('#profile-achievement-page'),'330px achievements grid');await screenshot(page,shots,`achievement-grid-330-${theme}`);
 await assertLargeTextFit(page.locator('#profile-achievement-page'),'330px large-text achievements grid');
 await page.goto(base+'/me/achievements/journey');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
 assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current-value').innerText(),'6,099.4 km','the long history value stays in metric units');
 await assertRingText(page.locator('#profile-achievement-page'),'330px track history');await screenshot(page,shots,`achievement-history-330-${theme}`);
 await assertLargeTextFit(page.locator('#profile-achievement-page'),'330px large-text track history');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'330px track history has no page-level horizontal overflow');
 console.log(`Achievement medallions 330 ${theme}: profile, grid and track history fit normal and large text`);
};

module.exports=async({browser,storageState,base,shots})=>{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'});
  const page=await context.newPage(),errors=[],writes=[],pinRequests=[];let journeyValue=6099414,workoutValue=1120,unitMode='imperial',unitLabelValues=null,showcasePins=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.__achievementVibrations=0;const original=navigator.vibrate?.bind(navigator);navigator.vibrate=(...args)=>{window.__achievementVibrations++;return original?original(...args):false;};});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base)return route.abort();
   if(request.method()==='GET'&&url.pathname.endsWith('/profile.css')){const response=await route.fetch();return route.fulfill({response,body:(await response.text())+'\n'+stripCss});}
   if(request.method()==='GET'&&url.pathname==='/api/me'){const response=await route.fetch(),data=await response.json();data.units=unitMode;return route.fulfill({response,json:data});}
   if(request.method()==='GET'&&url.pathname==='/api/achievements'){
    const data=JSON.parse(JSON.stringify(achievementFixture)),journey=data.tracks.find(t=>t.code==='journey'),workouts=data.tracks.find(t=>t.code==='workouts');
    if(journey){journey.value=journeyValue;journey.display_value=unitMode==='imperial'?journeyValue/1609.344:journeyValue/1000;journey.display_unit=unitMode==='imperial'?'mi':'km';}
    if(workouts){workouts.value=workoutValue;workouts.display_value=workoutValue;}
    for(const track of data.tracks)if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(track.code)){const value=Number(track.value)||0;track.display_value=unitMode==='imperial'?value/1609.344:value/1000;track.display_unit=unitMode==='imperial'?'mi':'km';}
    for(const item of unitLabelValues||[]){const track=data.tracks.find(row=>row.code===item.code);if(track){track.display_value=item.value;track.display_unit=item.unit;}}
    for(const track of data.tracks)for(const item of track.tiers){const [shown,shownUnit]=displayHistoryTier(track.code,Number(item.threshold)||0,unitMode);item.unit=historyUnits[track.code]||item.unit;item.display_threshold=shown;item.display_unit=shownUnit;}
    return route.fulfill({json:data});
   }
   if(request.method()==='GET'&&url.pathname==='/api/achievements/showcase')return route.fulfill({json:{items:[],pinned:showcasePins,day_streak:0}});
   if(request.method()==='POST'&&url.pathname==='/api/achievements/showcase/pin'){
    const body=request.postDataJSON();pinRequests.push(body);let replaced=false;
    if(body.pinned){if(!showcasePins.includes(body.code)){if(showcasePins.length>=4){showcasePins.shift();replaced=true;}showcasePins.push(body.code);}}
    else showcasePins=showcasePins.filter(code=>code!==body.code);
    return route.fulfill({json:{pinned:showcasePins,replaced}});
   }
   if(request.method()==='GET'&&url.pathname.startsWith('/api/achievement-history/')){
    const code=decodeURIComponent(url.pathname.slice('/api/achievement-history/'.length));
    return route.fulfill({json:v2History(code,{'journey':journeyValue,'workouts':workoutValue})});
   }
   if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{}});}
   return route.continue();
  });
  const setUnits=async units=>{unitMode=units;await page.evaluate(units=>{App.me.units=units;keep('/api/me',App.me);},units);};
  await page.goto(base+'/me');await until(page,()=>App.pageReady,'fixture login');await setUnits('imperial');
  const keys=await page.evaluate(()=>{const scope=`${Native.base||location.origin}:${App.me.id}`;return{key:`kinetta.achievement-levels.v3:${scope}`,legacyKey:`kinetta.achievement-levels.v2:${scope}`};});
  const {key,legacyKey}=keys;
  await page.evaluate(({key,legacyKey})=>{localStorage.removeItem(key);localStorage.setItem(legacyKey,JSON.stringify({journey:3,workouts:5}));},{key,legacyKey});
  const webHaptic=await page.evaluate(()=>Native.achievementLevelUp());
  assert.equal(webHaptic,false,'the achievement success feedback is disabled on web');

  await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  const profileList=page.locator('.profile-achievements .profile-achievement-list');
  assert.equal(await profileList.locator('.profile-achievement').count(),13,'the profile shows every started track in its sideways rail');
  assert.deepEqual(await profileList.locator('.profile-achievement').evaluateAll(nodes=>nodes.slice(0,4).map(n=>n.dataset.achievementCode)),['journey','workouts','lifted','sport:run'],'the profile rail keeps most-recent-progress order');
  assert(await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(n=>n.classList.contains('is-level-up')),'a previously seen level increase animates');
  const rail=await profileList.evaluate(n=>{const r=n.getBoundingClientRect(),first=n.querySelector('.profile-achievement').getBoundingClientRect(),fourth=n.querySelectorAll('.profile-achievement')[3].getBoundingClientRect();return{listLeft:r.left,listRight:r.right,firstLeft:first.left,fourthLeft:fourth.left,fourthRight:fourth.right,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,scrollPaddingLeft:getComputedStyle(n).scrollPaddingLeft};});
  assert.equal(Math.round(rail.firstLeft-rail.listLeft),16,'the first profile medallion has a 16px inset');
  assert.equal(parseFloat(rail.scrollPaddingLeft),16,'horizontal snap alignment preserves the 16px inset');
  assert(rail.fourthLeft<rail.listRight&&rail.fourthRight>rail.listRight,'the next medallion peeks in from the right');
  assert(rail.scrollWidth>rail.clientWidth,'the profile rail remains horizontally scrollable');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="journey"] .profile-achievement-value').innerText(),'3,790 mi','Journey follows the owner’s miles');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="climbing"] .profile-achievement-value').innerText(),'55,774 ft','Climbing follows the existing feet preference');
  const iconMap=await page.locator('.profile-achievement[data-achievement-code]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.achievementCode,n.querySelector('[data-achievement-icon]')?.dataset.achievementIcon])));
  assert.deepEqual(iconMap,{journey:'Bridge at night',workouts:'National park',lifted:'Statue of liberty','sport:run':'Trophy',active_time:'Hiking boot',years_active:'Hand with fingers splayed',consistency:'Fire',climbing:'Airplane',personal_bests:'Notebook','sport:ride':'Chequered flag','sport:walk-hike':'Sports medal','sport:swim':'Dolphin','sport:lift':'Flexed biceps'});
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="climbing"] .profile-achievement-medallion').getAttribute('data-level'),'10','17,000 m maps to catalog Level 10, Cruising altitude');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="climbing"] .profile-achievement-name').innerText(),'Climbing');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="lifted"] .profile-achievement-medallion').getAttribute('data-level'),'7','300,000 kg maps to catalog Level 7, Statue of Liberty');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="lifted"] [data-achievement-icon]').getAttribute('data-achievement-icon'),'Statue of liberty');
  const paletteTokens={journey:'--color-brand',workouts:'--color-brand',lifted:'--color-workout','sport:run':'--color-run',active_time:'--color-brand',years_active:'--color-brand',consistency:'--color-brand',climbing:'--color-hike',personal_bests:'--color-brand','sport:ride':'--color-ride','sport:walk-hike':'--color-walk','sport:swim':'--color-swim','sport:lift':'--color-workout'};
  const paletteMatches=await page.evaluate(expected=>{
   const resolve=(context,token)=>{const probe=document.createElement('i');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none';probe.style.color=`var(${token})`;context.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;};
   return Object.entries(expected).map(([code,token])=>{const card=document.querySelector(`.profile-achievement[data-achievement-code="${CSS.escape(code)}"]`);return{code,actual:resolve(card,'--achievement-palette-base'),expected:resolve(document.documentElement,token)};});
  },paletteTokens);
  assert.equal(paletteMatches.length,13,'every started track has a P2 palette token');
  assert(paletteMatches.every(match=>match.actual===match.expected),`sport tracks use their existing sport colours; general tracks use brand blue: ${JSON.stringify(paletteMatches)}`);
  const artwork=await page.locator('.profile-achievement[data-achievement-code] .profile-achievement-icon').evaluateAll(nodes=>nodes.map(n=>({name:n.dataset.achievementIcon,width:n.naturalWidth,height:n.naturalHeight,source:new URL(n.src).pathname})));
  assert(artwork.every(icon=>icon.width>0&&icon.height>0&&icon.source.startsWith('/static/profile.fluent-emoji/flat/')),'every started track uses a locally vendored Fluent Flat SVG');
  assert.doesNotMatch(await page.locator('.profile-achievements').innerText(),/[\u{1F300}-\u{1FAFF}]/u,'achievement labels contain no emoji');
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="workouts"] .profile-achievement-medallion').getAttribute('data-level-tone'),'deep','level eight uses the saturated tone');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the profile rail does not widen the page');
  await assertRingText(profileList,'profile');
  assert.match(await page.locator('.profile-achievement[data-achievement-code="workouts"]').getAttribute('aria-label'),/1,120 workouts/,'the accessible label keeps the full workout count');
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(saved.workouts,8,'the migrated level updates once');
  assert.equal(await page.evaluate(()=>window.__achievementVibrations),0,'a web level up does not vibrate');
  await page.locator('.profile-achievements').scrollIntoViewIfNeeded();
  await screenshot(page,shots,`achievement-profile-390-${theme}`);
  if(process.env.KINETTA_ACHIEVEMENT_FIT_ONLY==='1'){await assert330AchievementViews(page,base,setUnits,theme,shots);await context.close();continue;}
  let levelUpAnimations=0;
  if(theme==='light'&&shots){
   levelUpAnimations=await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(card=>{const animations=card.getAnimations({subtree:true});for(const animation of animations){animation.pause();animation.currentTime=300;}return animations.length;});
   assert(levelUpAnimations>=2,'the captured level-up frame pauses both medallion pop and ring fill');
  }
  if(theme==='light'&&shots){
   await screenshot(page,shots,'achievement-level-up-frame-390-light',{animations:'allow'});
   await page.locator('.profile-achievement[data-achievement-code="workouts"]').evaluate(card=>card.getAnimations({subtree:true}).forEach(animation=>animation.cancel()));
  }

  unitLabelValues=[['consistency',1,'weeks'],['active_time',1,'h'],['workouts',1,'workouts'],['sport:lift',1,'sessions'],['years_active',1,'years']].map(([code,value,unit])=>({code,value,unit}));
  await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  for(const [code,label] of [['consistency','1 week'],['active_time','1 hour'],['workouts','1 workout'],['sport:lift','1 session'],['years_active','1 year']]){
   assert.equal(await page.locator(`.profile-achievement[data-achievement-code="${code}"] .profile-achievement-value`).innerText(),label,`${code} uses its singular unit`);
  }
  unitLabelValues=[['consistency',2,'weeks'],['active_time',2,'h'],['workouts',2,'workouts'],['sport:lift',2,'sessions'],['years_active',2,'years']].map(([code,value,unit])=>({code,value,unit}));
  await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  for(const [code,label] of [['consistency','2 weeks'],['active_time','2 hours'],['workouts','2 workouts'],['sport:lift','2 sessions'],['years_active','2 years']]){
   assert.equal(await page.locator(`.profile-achievement[data-achievement-code="${code}"] .profile-achievement-value`).innerText(),label,`${code} uses its plural unit`);
  }
  unitLabelValues=null;

  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const groups=page.locator('#profile-achievement-page .profile-achievement-group');
  assert.equal(await groups.count(),3,'started tracks are grouped into Overall, Distance and Strength');
  assert.deepEqual(await groups.locator('.profile-achievement-group-title').allTextContents(),['Overall','Distance','Strength'],'group headings use the requested order');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement').count(),13,'See all opens every started track');
  const groupCodes=[];
  for(let i=0;i<await groups.count();i++){
   const group=groups.nth(i),list=group.locator('.profile-achievement-list');
   assert.equal(await list.getAttribute('role'),'list');
   const grid=await list.evaluate(n=>{const cards=[...n.querySelectorAll('.profile-achievement')],tops=cards.map(c=>c.getBoundingClientRect().top);return{display:getComputedStyle(n).display,overflowX:getComputedStyle(n).overflowX,columns:getComputedStyle(n).gridTemplateColumns.split(/\s+/).length,firstRowSame:tops.length<3||Math.max(...tops.slice(0,3))-Math.min(...tops.slice(0,3))<1};});
   assert.equal(grid.display,'grid','each group keeps a vertical grid');assert.equal(grid.columns,4,'each group uses four columns at 390px');assert.equal(grid.firstRowSame,true,'each group begins with a four-column row');assert.equal(grid.overflowX,'visible','group grids do not scroll sideways');
   groupCodes.push(await list.locator('.profile-achievement').evaluateAll(nodes=>nodes.map(n=>n.dataset.achievementCode)));
  }
  assert.deepEqual(groupCodes,[
   ['workouts','active_time','consistency','years_active','personal_bests'],
   ['sport:run','climbing','journey','sport:walk-hike','sport:swim','sport:ride'],
   ['sport:lift','lifted']
  ],'each section sorts tracks by most progress first, without changing the profile rail');
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="sport:lift"] .profile-achievement-name').innerText(),'Lift sessions','the grouped grid uses the requested Lift sessions track name');
  const gridFitsPage=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  assert(gridFitsPage,'the grouped grid does not widen the page');
  await assertRingText(page.locator('#profile-achievement-page'),'grouped achievements grid');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');
  await screenshot(page,shots,`achievement-grid-390-${theme}`,{fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  const holdToPin=async code=>{
   const medal=page.locator('#profile-achievement-page .profile-achievement[data-achievement-code="'+code+'"]');await medal.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rect=await medal.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.waitForTimeout(570);await page.mouse.up();
   const action=page.locator('[data-showcase-pin-action]');await action.waitFor();return action;
  };
  const waitForPin=async(code,pinned)=>{const selector='#profile-achievement-page .profile-achievement[data-achievement-code="'+code+'"]';await until(page,state=>document.querySelector(state.selector)?.dataset.showcasePinned===state.pinned,'Showcase pin update',{selector,pinned:String(pinned)});};
  let pinAction=await holdToPin('workouts');assert.equal(await pinAction.innerText(),'Pin to profile','a long press opens the pin action');
  await screenshot(page,shots,'achievement-pin-action-390-'+theme);await pinAction.click();await page.locator('.sheet').waitFor({state:'detached'});
  await waitForPin('workouts',true);
  assert.deepEqual(showcasePins,['workouts'],'pinning stores the selected track');assert.match(await page.locator('#profile-achievement-page [data-achievement-code="workouts"]').getAttribute('aria-label'),/Pinned to profile/);
  assert.equal(new URL(page.url()).pathname,'/me/achievements','holding to pin does not open medal history');
  for(const code of ['journey','lifted','sport:run']){pinAction=await holdToPin(code);if(code==='sport:run')assert.equal(await pinAction.innerText(),'Pin to profile');await pinAction.click();await page.locator('.sheet').waitFor({state:'detached'});await waitForPin(code,true);}
  assert.deepEqual(showcasePins,['journey','lifted','sport:run'],'a fourth pin replaces the oldest pin');
  assert.equal(pinRequests.length,4,'each pin action sends one owner-scoped update');
  const journey=page.locator('#profile-achievement-page [data-achievement-code="journey"]');assert.match(await journey.getAttribute('href'),/\/me\/achievements\/journey$/,'each medallion links to its history');
  await setUnits('metric');
  await journey.click();await page.waitForURL('**/me/achievements/journey');
  const history=page.locator('.profile-achievement-history-head');await history.waitFor();assert.equal(await history.locator('h1').innerText(),'Journey');assert.equal(await page.locator('.profile-achievement-current').innerText(),'Level 7 · Across the US');assert.equal(await page.locator('.profile-achievement-current-value').innerText(),'6,099.4 km','the amount appears on its own header line');
  const journeyLevels=page.locator('.profile-achievement-levels');assert.equal(await journeyLevels.locator('h2').innerText(),'Levels');assert.equal(await journeyLevels.locator('ol').count(),1,'the track page has one level list');
  assert.doesNotMatch(await page.locator('#profile-achievement-page').innerText(),/Up next|And beyond|All levels/,'duplicate look-ahead and disclosure labels are removed');
  assert.equal(await journeyLevels.locator('li.is-current .profile-achievement-level-here').innerText(),'You are here','the reached level has a subtle current marker');
  const levelTone=await journeyLevels.evaluate(list=>({earned:getComputedStyle(list.querySelector('li.is-earned')).opacity,current:getComputedStyle(list.querySelector('li.is-current')).opacity,locked:getComputedStyle(list.querySelector('li.is-upcoming')).opacity}));
  assert.equal(levelTone.earned,'1','earned levels stay in full colour');assert.equal(levelTone.current,'1','the current level stays in full colour');assert(Number(levelTone.locked)<1,'locked levels are dimmed');
  assert.match(await journeyLevels.innerText(),/After the named levels, the last icon repeats at each multiple\./,'the tail note sits below the Levels list');
  await assertRingText(page.locator('#profile-achievement-page'),'Journey history');
  assert.deepEqual(await page.locator('.profile-achievement-history li a>span:first-child').allTextContents(),['Across the US','Length of Britain','Ironman 140.6','Ironman 70.3','Marathon','Across the city','Round the town'],'history shows catalog levels in first-crossing order');
  const dateGeometry=await page.locator('.profile-achievement-history li').first().evaluate(li=>{const date=li.querySelector('time').getBoundingClientRect(),chevron=li.querySelector('.profile-achievement-history-chevron').getBoundingClientRect();return{dateRight:date.right,chevronLeft:chevron.left};});
  assert(dateGeometry.dateRight<=dateGeometry.chevronLeft+1,'history dates sit before the chevron');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');
  await screenshot(page,shots,`achievement-history-390-${theme}`,{fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  const fixedMarathon=page.locator('.profile-achievement-levels li[data-level="3"]');
  assert.equal(await fixedMarathon.locator('b').innerText(),'Marathon','the race name stays fixed in metric mode');
  assert.equal(await fixedMarathon.locator('small').innerText(),'42.195 km','the fixed race subtitle keeps the canonical metric distance');
  await page.goto(base+'/me/achievements/sport%3Arun');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="2"] .profile-achievement-level-title b').innerText(),'First 1.6 km','the metric mile level uses the requested rounded name');
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="2"] .profile-achievement-level-copy>small').innerText(),'1.6 km','the metric mile threshold is rounded once');
  await setUnits('imperial');
  await page.goto(base+'/me/achievements/sport%3Arun');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const runningLevels=page.locator('.profile-achievement-levels ol');
  assert.equal(await runningLevels.locator('li[data-level="2"] .profile-achievement-level-title b').innerText(),'First mile','imperial keeps Wren’s canonical Run name');
  for(const [level,name,distance] of [[3,'5K','3.1 mi'],[4,'10K','6.2 mi'],[5,'Half marathon','13.1 mi'],[6,'Marathon','26.2 mi']]){
   assert.equal(await runningLevels.locator(`li[data-level="${level}"] .profile-achievement-level-title b`).innerText(),name,`${name} keeps its race name in miles mode`);
   assert.equal(await runningLevels.locator(`li[data-level="${level}"] .profile-achievement-level-copy>small`).innerText(),distance,`${name} shows its converted distance in miles`);
  }
  assert.equal(await page.locator('.profile-achievement-current').innerText(),'Level 6 · Marathon');assert.equal(await page.locator('.profile-achievement-current-value').innerText(),'49.7 mi');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-levels-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  await page.goto(base+'/me/achievements/sport%3Aride');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="5"] .profile-achievement-level-title b').innerText(),'Metric century');
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="5"] .profile-achievement-level-copy>small').innerText(),'62.1 mi','the Metric century name stays fixed while its subtitle follows miles');
  await page.goto(base+'/me/achievements/sport%3Aswim');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="5"] .profile-achievement-level-title b').innerText(),'Marathon swim (10K)');
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="5"] .profile-achievement-level-copy>small').innerText(),'6.2 mi','the 10K swim keeps its name and converted distance in miles mode');

  journeyValue=113137;await setUnits('imperial');await page.goto(base+'/me/achievements/journey');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'),'4','Journey switches to the reached catalog level');
  assert.equal(await page.locator('.profile-achievement-history-head [data-achievement-icon]').getAttribute('data-achievement-icon'),'Person swimming','the current Journey level supplies its own icon');
  workoutValue=4500;await page.goto(base+'/me/achievements/workouts');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'),'11','the tail starts at twice the last named threshold');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Level 11 · Old-growth forest ×2');assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current-value').innerText(),'4,500 workouts');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-multiple').innerText(),'×2','the medal shows the tail multiplier badge');
  assert.equal(await page.locator('.profile-achievement-levels li[data-level="12"] .profile-achievement-level-title b').innerText(),'Old-growth forest ×3');

  workoutValue=1120;journeyValue=6099414;await setUnits('imperial');await page.goto(base+'/me/achievements/lifted');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current').innerText(),'Level 7 · Statue of Liberty');assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current-value').innerText(),'661,387 lb');
  const liftedLevels=page.locator('.profile-achievement-levels ol');assert.equal(await liftedLevels.locator('li').count(),11,'the single Levels list includes the full named track');
  assert.equal(await liftedLevels.locator('li[data-level="8"] .profile-achievement-level-copy>small').innerText(),'875,000 lb','Lifted uses pounds in the existing miles preference');
  assert.deepEqual(await page.locator('.profile-achievement-history li a>span:first-child').allTextContents(),['Statue of Liberty','A blue whale','A loaded semi truck','A school bus','An elephant','A car','A grand piano'],'Lifted history shows each crossed catalog level');
  assert.doesNotMatch(await page.locator('.profile-achievement-history').innerText(),/\d[\d,]*\.\d+\s*(?:lb|kg|mi|km|ft|m)\b/,'history never renders decimal amount fallbacks');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-lifted-levels-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);

  const allFixtureTracks=achievementFixture.tracks;
  achievementFixture.tracks=[
   makeTrack('workouts','Workouts',1,2,2,'workouts',[{...tier(1,'First workout',1,'2026-11-07',2301),trigger:'first_activity',quiet:true}],null),
   makeTrack('consistency','Consistency',1,1,1,'weeks',[{...tier(1,'First week',1,'2026-11-07',2301),trigger:'first_activity',quiet:true}],null),
   makeTrack('active_time','Active time',1,7200,2,'h',[{...tier(1,'First hour',3600,'2026-11-07',2301),quiet:true}],null),
   makeTrack('sport:run','Run',2,1609.344,1,'mi',[
    {...tier(1,'First run',1,'2026-11-07',2300),trigger:'first_activity',quiet:true},
    {...tier(2,'First mile',1609.344,'2026-11-07',2300),quiet:true}],null),
   makeTrack('sport:lift','Lift sessions',1,1,1,'sessions',[tier(1,'First set',1,'2026-11-07',2301)],null)
  ];
  // One run plus one lifting session gives the new account two total workouts.
  workoutValue=2;await setUnits('metric');await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('kinetta.achievement-levels.v'))localStorage.removeItem(key);});
  await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  const earlyShowcase=page.locator('.profile-achievements');
  assert.match(await earlyShowcase.innerText(),/First 1\.6 km|5K/,'the new-run Showcase has the metric First mile level');
  assert.match(await earlyShowcase.innerText(),/First workout|Sprig/,'the new-workout Showcase shows the early workout level');
  assert.match(await earlyShowcase.locator('[data-achievement-code="sport:run"]').getAttribute('aria-label'),/First 1\.6 km/,'the run medal uses its metric display name');
  assert.equal(await earlyShowcase.locator('[data-achievement-code="sport:run"] .profile-achievement-value').innerText(),'1.6 km','the run medal value follows the metric preference');
  assert.match(await earlyShowcase.locator('[data-achievement-code="workouts"]').getAttribute('aria-label'),/First workout/,'the first workout is recognized as its own level');
  assert.equal(await earlyShowcase.locator('[data-achievement-code="workouts"] [data-achievement-icon]').getAttribute('data-achievement-icon'),'Seedling','the first Workouts medal uses the seedling art');
  assert.equal(catalog.tracks.workouts.levels[0].asset_name,'Seedling','the First workout icon is the approved catalog override');
  assert.equal(catalog.tracks.workouts.levels[3].asset_name,'Seedling','the existing Sprout retains its catalog art');
  if(shots){fs.mkdirSync(shots,{recursive:true});await earlyShowcase.screenshot({path:`${shots}/achievement-early-showcase-390-${theme}.png`,animations:'disabled'});}
  achievementFixture.tracks=allFixtureTracks;
  const allFixtureTracksForFilter=achievementFixture.tracks;achievementFixture.tracks=allFixtureTracksForFilter.filter(track=>['lifted','sport:lift'].includes(track.code));
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.deepEqual(await page.locator('.profile-achievement-group-title').allTextContents(),['Strength'],'empty Overall and Distance sections are hidden');
  assert.equal(await page.locator('.profile-achievement-group .profile-achievement').count(),2,'only the two started Strength tracks remain');
  achievementFixture.tracks=allFixtureTracks;

  workoutValue=1120;journeyValue=6099414;await page.goto(base+'/people/alex');await page.locator('.profile-achievements .profile-achievement-list').waitFor();
  await page.evaluate(()=>{
   const runner='<circle cx="15.5" cy="4.5" r="2.5"/><path d="m12 8 4 1 2.2 3.2 3.2 1.1-.7 2-4-1.4-2-2.4-2 2.2 3.6 2.4 2.1 5.2h-2.3l-1.7-4-4.4-2.4-2.9 3.8H4.5l3.8-5.7 3.1-3.1-1.1-.6-2.4 2.5-3.3-.5.3-2.1 2.4.3L10 9.1A3 3 0 0 1 12 8Z"/>';
   const cards=Array.from({length:8},(_,i)=>{
    const level=i+1,tone=level>=6?'deep':String(level);
    return `<div class="profile-achievement-level-swatch"><span class="profile-achievement-medallion" data-level="${level}" data-level-tone="${tone}" aria-hidden="true"><svg class="profile-achievement-ring" viewBox="0 0 104 104"><circle class="profile-achievement-ring-base" cx="52" cy="52" r="47"/><circle class="profile-achievement-ring-progress" cx="52" cy="52" r="47" stroke-dasharray="221.5 295.3" transform="rotate(-90 52 52)"/></svg><svg class="profile-achievement-icon" viewBox="0 0 24 24">${runner}</svg><span class="profile-achievement-value">49.7 mi</span><span class="profile-achievement-level">Lv ${level}</span></span><small>Lv ${level}</small></div>`;
   }).join('');
   document.body.innerHTML=`<main class="profile-achievement-level-strip"><h1>Run · selected sport colour</h1><p>Fictional progression through Lv 1–8 in Ben’s selected P2 palette.</p><div class="profile-achievement-level-swatches">${cards}</div></main>`;
  });
  const levelColors=await page.locator('.profile-achievement-level-swatch .profile-achievement-medallion').evaluateAll(nodes=>nodes.map(node=>({fill:getComputedStyle(node).backgroundColor,ring:getComputedStyle(node.querySelector('.profile-achievement-ring-progress')).stroke,shadow:getComputedStyle(node).boxShadow})));
  const levelBrightness=levelColors.map(color=>brightness(color.fill));
  assert(levelBrightness.every((value,index)=>index===0||value<levelBrightness[index-1]),`P2 run medallions deepen at each level in ${theme}: ${JSON.stringify({levelBrightness,levelColors})}`);
  assert(!levelColors[4].shadow.includes('18px')&&levelColors.slice(5).every(color=>color.shadow.includes('18px')),'P2 adds the soft token-coloured glow from Lv 6 onward');
  if(shots){fs.mkdirSync(shots,{recursive:true});await page.locator('.profile-achievement-level-strip').screenshot({path:`${shots}/palette-p2-levels-390-${theme}.png`,animations:'disabled'});}
  await assert330AchievementViews(page,base,setUnits,theme,shots);
  assert.deepEqual(errors,[],`no browser errors in ${theme}`);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[],`no unmocked writes in ${theme}`);
  console.log(`Achievement medallions 390 ${theme}: profile, all tracks, history, units, icons and web haptic guard PASS`);
  await context.close();
 }
 if(process.env.KINETTA_ACHIEVEMENT_FIT_ONLY==='1')return;
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
