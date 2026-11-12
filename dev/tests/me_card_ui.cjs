// Rendered Me weekly card: current-week numbers, selectable 12-week chart and optional trend slots.
// All names and values are fictional; requests that could write data are intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const SCREENSHOT_CLOCK=require('../screenshots/fixture-time.json'),SCREENSHOT_NOW=new Date(SCREENSHOT_CLOCK.instant);
const todayOnly=process.env.KINETTA_ME_TODAY_ONLY==='1';
const featuredHeadingOnly=process.env.KINETTA_ME_FEATURED_HEADING_ONLY==='1';
const todayInNewYork=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:SCREENSHOT_CLOCK.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(SCREENSHOT_NOW),v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;};
const addDays=(day,count)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);};
const chartFixture=today=>{
 const noon=new Date(today+'T12:00:00Z'),sunday=addDays(today,-noon.getUTCDay());
 const values=[0,1800,6200,100,0,4300,2700,900,0,5500,3200,7800];
 return {today,weeks:values.map((distance_m,i)=>{
  const d=addDays(sunday,(i-11)*7),end=addDays(d,6),activities=distance_m?i%4+1:0;
  return {d,end,distance_m,activities,time_s:activities?1800+i*120:0,today:i===11};
 })};
};
const waitApp=async p=>{for(let i=0;i<150;i++){if(await p.evaluate(()=>typeof App!=='undefined'&&App.pageReady).catch(()=>false))return;await p.waitForTimeout(100);}throw Error('Me route did not initialize');};
const clearProfileCache=p=>p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k);});
(async()=>{
 const b=await chromium.launch(),login=await b.newContext();
 await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
 const storageState=await login.storageState();
 const sizes=[{width:390,height:844,root:16},{width:330,height:667,root:16}],themes=['light','dark'];
 for(const size of sizes)for(const theme of themes){
  const c=await b.newContext({storageState,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:SCREENSHOT_CLOCK.timezone}),p=await c.newPage(),errors=[],writes=[];
  await p.clock.setFixedTime(SCREENSHOT_NOW);
  let slotFixture='both',todayFixture='both',zeroDistanceFixture=false,seriesFixture;
  let showcaseFixture={items:[],pinned:[],day_streak:0},shareAchievementsEnabled=false,showcasePins=[],pinOrderRequests=[],failFeatureSave=false,achievementFixture=null;const sharedShowcaseRequests=[];
  const featureTrack=(code,label,value,display_unit)=>({code,label,value,display_value:value,display_unit,tiers:[{rank:1,day:'2026-11-06'}]});
  const featuredFixture={pending:false,tracks:[featureTrack('journey','Journey',6099414,'mi'),featureTrack('workouts','Workouts',1120,'workouts'),featureTrack('lifted','Lifted',300000,'lb'),featureTrack('sport:run','Run',80000,'mi'),featureTrack('active_time','Active time',3960000,'h'),featureTrack('climbing','Climbing',17000,'ft'),featureTrack('consistency','Consistency',22,'weeks')]};
  const earnedFixture=['journey','workouts','lifted','sport:run','climbing','consistency'].map(code=>({code,rank:1}));
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/api/**',async r=>{
   const q=r.request(),u=new URL(q.url());
   if(q.method()==='PUT'&&u.pathname==='/api/achievements/showcase/pins'){
    const body=q.postDataJSON();if(failFeatureSave){failFeatureSave=false;return r.fulfill({status:503,json:{detail:'Fictional save failure'}});}
    pinOrderRequests.push(body.pinned);showcasePins=[...body.pinned];return r.fulfill({json:{pinned:showcasePins}});
   }
   if(q.method()==='POST'&&u.pathname==='/api/achievements/showcase/pin'){
    const body=q.postDataJSON();let replaced=false;if(body.pinned){if(!showcasePins.includes(body.code)){if(showcasePins.length>=4){showcasePins.shift();replaced=true;}showcasePins.push(body.code);}}
    else showcasePins=showcasePins.filter(code=>code!==body.code);return r.fulfill({json:{pinned:showcasePins,replaced}});
   }
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
   if(u.pathname==='/api/achievements'){
    if(achievementFixture)return r.fulfill({json:{...featuredFixture,tracks:achievementFixture.tracks}});
    return r.fulfill({json:featuredFixture});
   }
   if(u.pathname==='/api/achievements/showcase'){
    if(u.searchParams.has('login')){sharedShowcaseRequests.push(u.searchParams.get('login'));return r.fulfill({json:showcaseFixture});}
    return r.fulfill({json:{...showcaseFixture,pinned:showcasePins,available:earnedFixture}});
   }
   if(u.pathname==='/api/sharing')return r.fulfill({json:{share_achievements:shareAchievementsEnabled}});
   if(u.pathname==='/api/me'){const resp=await r.fetch(),j=await resp.json();j.bio='Fictional trails and weekend rides.';j.kcal_target=null;j.protein_target=null;j.units='imperial';j.friend_count=2;j.friend_requests=0;return r.fulfill({response:resp,json:j});}
   if(u.pathname==='/api/activities'&&u.searchParams.has('limit')){
    const day=todayInNewYork(),hasActivity=['both','activity','activity-multiple','food-error'].includes(todayFixture),yesterday=todayFixture==='activity-empty';
    const row={id:918204,sport:'run',start_time:`${day}T12:12:00Z`,distance_m:9656.064,moving_s:3120,elapsed_s:3180};
    if(u.searchParams.has('after'))return r.fulfill({json:hasActivity?[row,...(todayFixture==='activity-multiple'?[{id:918205,sport:'walk',start_time:`${day}T10:00:00Z`,distance_m:1609.344,moving_s:900,elapsed_s:900}]:[])]:[]});
    return r.fulfill({json:hasActivity?[row]:yesterday?[{...row,id:918203,start_time:`${addDays(day,-1)}T12:12:00Z`}]:[]});
   }
   if(u.pathname==='/api/plans/current'){
    const planned=['planned','planned-distance','rest'].includes(todayFixture),day=todayInNewYork();
    const today_workout=todayFixture==='planned-distance'?{type:'run',title:'Tempo run 4 mi',dist:4,day}:{type:todayFixture==='rest'?'rest':'run',title:'Easy run',minutes:30,day};
    return r.fulfill({json:planned?{today:day,plan:{id:9101,race_day:addDays(day,20),unit:'mi'},today_workout}:{plan:null}});
   }
   if(u.pathname==='/api/food/history'){
    const hasFood=['both','food','estimate','food-error'].includes(todayFixture);
    return r.fulfill({json:hasFood?[{day:todayInNewYork(),kcal:1250,protein_g:70,carbs_g:120,fat_g:40,n:1}]:[]});
   }
   if(u.pathname==='/api/food/day'){
    if(todayFixture==='food-error')return r.fulfill({status:503,json:{detail:'Fictional food source failure'}});
    const day=u.searchParams.get('d')||todayInNewYork(),hasFood=['both','food','estimate'].includes(todayFixture),logged=['both','estimate'].includes(todayFixture);
    const entries=logged?[{id:90001,name:'Fictional oats',source:todayFixture==='estimate'?'ai':'manual',kcal:1250,protein_g:70,carbs_g:120,fat_g:40,ref:{}}]:[];
    return r.fulfill({json:{day,entries,totals:{kcal:logged?1250:0,protein_g:logged?70:0,carbs_g:logged?120:0,fat_g:logged?40:0,fiber_g:0},unknown_nutrients:{kcal:0,protein_g:0,carbs_g:0,fat_g:0,fiber_g:0},targets:{kcal_target:2100,protein_target:130},has_history:hasFood,food_user:hasFood,meal_hours:{}}});
   }
   if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:6,friend_requests:0,friend_count:2}});
   if(u.pathname==='/api/stats'){
    const resp=await r.fetch(),j=await resp.json();
    j.week_streak=slotFixture==='short-streak'?1:['both','streak-only'].includes(slotFixture)?12:0;
    j.close_to=['both','target-only'].includes(slotFixture)?'18 mi to 1,000 mi this year':null;
    return r.fulfill({response:resp,json:j});
   }
   if(u.pathname.endsWith('/profile')){
    const resp=await r.fetch(),j=await resp.json(),series=chartFixture(j.mileage.today);seriesFixture=series;
    // Fictional stand-ins prove that all-time data stays off Me. They remain on the full profile.
    j.overview={...j.overview,activities:3044,distance_m:18964000,time_s:5568300};
    j.sports=[{sport:'run',activities:2938},{sport:'walk',activities:70},{sport:'ride',activities:19},{sport:'hike',activities:9}];
    j.person={...j.person,bio:'Fictional trails and weekend rides.'};j.bio='Fictional trails and weekend rides.';
    if(zeroDistanceFixture)series.weeks=series.weeks.map((w,i)=>({...w,distance_m:0,activities:i===11?2:0,time_s:i===11?1200:0}));
    j.mileage=series;
    return r.fulfill({response:resp,json:j});
   }
   return r.continue();
  });
  const featuredEditor=async({checkpoint=false}={})=>{
   achievementFixture=null;showcasePins=['journey','workouts','lifted'];showcaseFixture={items:['journey','workouts','lifted','sport:run','climbing'].map((code,index)=>({code,rank:index+1})),pinned:showcasePins,day_streak:0};shareAchievementsEnabled=true;failFeatureSave=false;
   await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-card-edit]').click();
   const list=p.locator('[data-featured-list]');await list.waitFor();await p.waitForFunction(()=>document.querySelector('[data-featured-list]')?.getAttribute('aria-busy')==='false');await list.scrollIntoViewIfNeeded();
   const selected=()=>p.locator('.me-featured-selected [data-featured-toggle]');
   const waitForSelected=expected=>p.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.me-featured-selected [data-featured-toggle]')].map(n=>n.dataset.featuredToggle))===JSON.stringify(expected),expected,{timeout:5000});
   assert.deepEqual(await selected().evaluateAll(nodes=>nodes.map(n=>n.dataset.featuredToggle)),['journey','workouts','lifted'],`Edit profile shows the saved featured order: ${await list.innerText()}; page errors: ${JSON.stringify(errors)}`);
   assert.equal(await p.locator('.me-featured-editor [data-featured-toggle="active_time"]').count(),0,'the editor offers only tracks in the server earned set');
   assert.match(await p.locator('.me-editor-featured-note').innerText(),/save with your profile; Cancel discards/i,'the copy explains featured changes wait for Save');
   const heights=await list.locator('.me-featured-choice,.me-featured-order .icon-btn').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
   assert(heights.length&&heights.every(height=>height>=44),'featured choices and reorder controls have 44px targets '+JSON.stringify(heights));
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${size.width}px featured editor has no page overflow`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/featured-editor-${size.width}-${theme}.png`,animations:'disabled'});}
   if(checkpoint)return;
   const save=p.locator('[data-card-save]');assert(await save.isDisabled(),'Save starts disabled until a profile or achievement choice changes');
   await p.locator('[data-featured-toggle="sport:run"]').click();await waitForSelected(['journey','workouts','lifted','sport:run']);assert.equal(await save.isDisabled(),false,'adding an achievement enables Save');
   assert.equal(pinOrderRequests.length,0,'editing achievements does not write before Save');
   await p.locator('[data-featured-move="workouts"][data-step="-1"]').click();await waitForSelected(['workouts','journey','lifted','sport:run']);
   await p.locator('.me-featured-selected [data-featured-toggle="lifted"]').click();await waitForSelected(['workouts','journey','sport:run']);
   assert.equal(await save.isDisabled(),false,'reordering and removing keep Save enabled');
   if(out)await p.screenshot({path:`${out}/featured-editor-changed-${size.width}-${theme}.png`,animations:'disabled'});
   const waitSave=()=>p.waitForResponse(response=>response.url()===base+'/api/achievements/showcase/pins'&&response.request().method()==='PUT');
   let response=waitSave();await save.click();assert.equal((await response).status(),200);
   await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});
   assert.deepEqual(pinOrderRequests.at(-1),['workouts','journey','sport:run'],'Save stores the changed ordered pins once');
   assert.equal(await p.locator('.me-featured-item').count(),3,'the Me card updates from the saved choices');
   if(out&&size.width===390&&theme==='light')await screenshot('me-featured-saved');
   await p.locator('[data-card-edit]').click();await p.locator('[data-featured-list][aria-busy="false"]').waitFor();
   assert.deepEqual(await p.locator('.me-featured-selected [data-featured-toggle]').evaluateAll(nodes=>nodes.map(n=>n.dataset.featuredToggle)),['workouts','journey','sport:run'],'saved pins persist after reopening the editor');
   const retrySave=p.locator('[data-card-save]');
   await p.locator('[data-featured-toggle="climbing"]').click();assert.equal(await retrySave.isDisabled(),false);
   failFeatureSave=true;response=waitSave();await retrySave.click();assert.equal((await response).status(),503);
   await p.waitForFunction(()=>document.querySelector('[data-card-status]')?.textContent==='Fictional save failure');
   assert.deepEqual(await p.locator('.me-featured-selected [data-featured-toggle]').evaluateAll(nodes=>nodes.map(n=>n.dataset.featuredToggle)),['workouts','journey','sport:run','climbing'],'a failed Save keeps the pending selection for retry');
   assert.equal(await retrySave.isDisabled(),false,'a failed Save leaves the retry enabled');
   await p.locator('[data-card-cancel]').click();await p.locator('[data-confirm-ok]').click();await p.locator('[data-card-edit]').click();await p.locator('[data-featured-list][aria-busy="false"]').waitFor();
   assert.deepEqual(await p.locator('.me-featured-selected [data-featured-toggle]').evaluateAll(nodes=>nodes.map(n=>n.dataset.featuredToggle)),['workouts','journey','sport:run'],'Cancel discards the failed pending selection');await p.locator('[data-card-cancel]').click();
  };
  if(featuredHeadingOnly){
   showcaseFixture={items:[{code:'journey',rank:4},{code:'sport:run',rank:4}],pinned:[],day_streak:0};shareAchievementsEnabled=true;
   await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();const heading=p.locator('.me-featured-title'),title=heading.locator(':scope > span'),link=heading.locator(':scope > a');
   assert.equal(await title.innerText(),'Featured achievements','Me names the featured-achievements section');
   const metrics=await heading.evaluate(node=>{const title=node.querySelector(':scope > span'),link=node.querySelector(':scope > a'),range=document.createRange();range.selectNodeContents(title);const t=title.getBoundingClientRect(),a=link.getBoundingClientRect(),h=node.getBoundingClientRect(),ts=getComputedStyle(title),as=getComputedStyle(link),referenceBox=document.createElement('div');referenceBox.className='me-card-label';referenceBox.style.cssText='position:absolute;visibility:hidden;pointer-events:none';referenceBox.innerHTML='<span>All time</span>';node.closest('.me-card').append(referenceBox);const ref=getComputedStyle(referenceBox.querySelector('span')),probe=document.createElement('i');probe.style.color='var(--accent)';node.append(probe);const accent=getComputedStyle(probe).color;probe.remove();const result={font:ts.fontSize,weight:ts.fontWeight,referenceFont:ref.fontSize,referenceWeight:ref.fontWeight,lines:new Set([...range.getClientRects()].map(rect=>Math.round(rect.top*2)/2)).size,whiteSpace:ts.whiteSpace,linkFont:as.fontSize,linkWeight:as.fontWeight,linkColor:as.color,accent,rightGap:h.right-a.right,noOverlap:t.right<=a.left+1,sameRow:Math.abs(t.top+t.height/2-a.top-a.height/2)<2};referenceBox.remove();return result;});
   assert.equal(metrics.font,metrics.referenceFont,'Me heading matches the All time label size');assert.equal(metrics.weight,metrics.referenceWeight,'Me heading matches the card-label weight');assert.equal(metrics.lines,1,'Me heading stays on one line');assert.equal(metrics.whiteSpace,'nowrap');
   assert.equal(metrics.linkFont,'14px','Me link uses the normal link size');assert.equal(metrics.linkWeight,'600');assert.equal(metrics.linkColor,metrics.accent,'Me link uses the app blue');assert(Math.abs(metrics.rightGap)<1&&metrics.noOverlap&&metrics.sameRow,`Me link sits to the right: ${JSON.stringify(metrics)}`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.locator('.me-featured-achievements').screenshot({path:`${out}/me-featured-heading-${size.width}-${theme}.png`,animations:'disabled'});}
   assert.deepEqual(errors,[]);await c.close();continue;
  }
  if(process.env.KINETTA_ME_FEATURED_CHECKPOINT==='1'){await featuredEditor({checkpoint:true});await c.close();continue;}
  await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  const weekly=p.locator('.me-card-weekly'),label=p.locator('[data-week-label]'),chart=p.locator('.me-card-bars'),weeks=p.locator('.me-week');
  await p.locator('.me-featured-slot[data-loaded="true"]').waitFor();await p.locator('.me-featured-achievements').waitFor();
  const profileLink=p.locator('.me-card-open-link'),linkBox=await profileLink.boundingBox(),cardBox=await p.locator('.me-card').boundingBox(),featuredBox=await p.locator('.me-featured-achievements').boundingBox();
  assert.equal(await profileLink.getAttribute('aria-label'),'Open my profile','the profile link has the approved VoiceOver label');
  assert.match(await profileLink.getAttribute('href'),/^\/people\/alex(?:\?|$)/,'the profile link opens the owner profile');
  assert(Math.abs(linkBox.x-cardBox.x)<1&&Math.abs(linkBox.y-cardBox.y)<1&&Math.abs(linkBox.width-cardBox.width)<1,'the profile link covers the card width from its top edge');
  assert(featuredBox.y-(linkBox.y+linkBox.height)>=7.98,`the profile link leaves 8px before the Featured entry and medals (${featuredBox.y-(linkBox.y+linkBox.height)}px)`);
  const identity=p.locator('.me-card-profile-link');
  assert.equal(await identity.locator('.me-card-avatar').count(),1);assert.equal(await identity.locator('h2').innerText(),'Alex Rivera');
  assert.equal(await identity.locator('.me-card-meta').innerText(),'@alex');
  const chevron=p.locator('.me-profile-chevron'),arrow=await chevron.locator('svg').boundingBox(),heading=await p.locator('.me-card-name-heading').boundingBox(),title=await identity.locator('h2').boundingBox();
  assert.equal(await chevron.count(),1,'one decorative chevron sits beside the owner name');
  const chevronStyle=await chevron.evaluate(n=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderWidth,pointer:getComputedStyle(n).pointerEvents}));
  assert(Math.abs(arrow.width-20)<.1&&Math.abs(arrow.height-20)<.1,'the profile chevron is about 20px');
  assert(arrow.x+arrow.width<=heading.x+heading.width+.5&&arrow.x+arrow.width>=heading.x+heading.width-22,'the chevron is at the right end of the name row '+JSON.stringify({arrow,heading,title}));
  assert(Math.abs(arrow.y+arrow.height/2-(title.y+title.height/2))<2,'the chevron is level with Alex Rivera');
  assert(chevronStyle.color!=='rgb(255, 255, 255)'&&chevronStyle.background==='rgba(0, 0, 0, 0)'&&chevronStyle.border==='0px'&&chevronStyle.pointer==='none','the chevron is mid-grey, unboxed and decorative '+JSON.stringify(chevronStyle));
  const arrowHit=await p.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.me-card-open-link'),{x:arrow.x+arrow.width/2,y:arrow.y+arrow.height/2});
  assert(arrowHit,'tapping the decorative chevron reaches the whole-card profile link');
  assert.equal(await p.locator('.me-card-id > .me-friends-link').count(),1,'friend navigation remains a separate link');
  assert.equal(await profileLink.locator('.me-friends-link').count(),0,'friend navigation is not nested inside the profile link');
  for(const [selector,label] of [['.me-card-banner [data-card-edit]','Edit'],['.me-card-banner [data-card-share]','Share'],['.me-card [data-card-preview]','View as friend'],['.me-card-id > .me-friends-link .me-friends-count','friends'],['.me-card-id > .me-friends-link .badge.alert','waiting chip'],['.me-card .me-milestone-all','Recent milestones']]){
   const target=p.locator(selector).first();if(await target.count()&&await target.isVisible()){const box=await target.boundingBox(),cardLinkAtCenter=await p.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.me-card-open-link'),{x:box.x+box.width/2,y:box.y+box.height/2});assert(!cardLinkAtCenter,`${label} remains its own tap target above the profile link`);}
  }
  assert.equal(await p.locator('.me-divider').count(),0,'no hairline divider separates the Me card and Today');
  await weeks.first().waitFor();assert.equal(await weeks.count(),12,'Me has one 12-week chart');
  assert.equal(await p.locator('.me-period,.me-distance.days,.me-card-figures,.me-card-note,.me-sport-chips,.me-profile-bio,.me-about').count(),0,'Me hides the Days toggle, daily chart, bio, all-time totals, sport rows and privacy footer');
  assert.doesNotMatch(await p.locator('.me-card').innerText(),/3,044|11,784|1,546|Fictional trails and weekend rides|2,938/,'Me does not leak the full-profile bio, lifetime totals or sport counts');
  assert.equal(await weekly.locator('[data-week-stat]').count(),3,'the weekly card has distance, workout and time values');
  for(const stat of ['distance','activities','time'])assert(await weekly.locator(`[data-week-stat="${stat}"]`).count()===1,`current week exposes ${stat}`);
  const currentStats=await weekly.locator('[data-week-stat]').allTextContents();assert(currentStats.every(value=>value.trim()),'This week has visible distance, workout and time totals');
  assert.equal(await label.locator('span').innerText(),'This week','current week is the default selection');
  assert.equal(await p.locator('.me-week-streak[data-week-streak="12"]').count(),1,'streak appears at twelve weeks');
  assert.equal(await p.locator('.me-card-close-to[data-close-to]').innerText(),'Only you\n18 mi to 1,000 mi this year','private close-to text has the owner label and profile units');
  assert.equal(await p.locator('.me-owner-only').count(),2,'private streak and close-to use the same visible Only you label');
  assert.equal(await weekly.locator('[data-week-stat]').count(),3,'the close-to line adds no number row');
  const closeGeometry=await p.locator('.me-card-close-to').evaluate(n=>{const r=n.getBoundingClientRect(),bar=document.querySelector('.me-card-bars').getBoundingClientRect(),s=getComputedStyle(n);return{top:r.top,barBottom:bar.bottom,font:parseFloat(s.fontSize),border:s.borderWidth,background:s.backgroundColor};});
  assert(closeGeometry.top>=closeGeometry.barBottom&&closeGeometry.font>=13&&closeGeometry.border==='0px'&&closeGeometry.background==='rgba(0, 0, 0, 0)','close-to remains plain 13px secondary text under the bars '+JSON.stringify(closeGeometry));
  await screenshot('me-card-both');if(size.width===330||size.width===390){const feature=p.locator('.me-featured-achievements');await feature.evaluate(n=>n.scrollIntoView({block:'start',behavior:'instant'}));const visible=await p.evaluate(()=>{const featured=document.querySelector('.me-featured-achievements').getBoundingClientRect(),tab=document.querySelector('.bottom-nav,nav').getBoundingClientRect();return{top:featured.top,bottom:featured.bottom,tabTop:tab.top};});assert(visible.top>=-1&&visible.bottom<=visible.tabTop+1,`${size.width}px Featured rail scrolls fully above the fixed tab bar `+JSON.stringify(visible));if(out)await p.screenshot({path:`${out}/me-featured-visible-${size.width}-${theme}.png`,animations:'disabled'});await p.locator('.me-top').evaluate(n=>n.scrollIntoView({block:'start',behavior:'instant'}));}
  assert.equal(await p.locator('.me-week-streak').getAttribute('aria-label'),'12-week activity streak. Only you can see this.');
  assert.equal(await p.locator('.me-week-streak > span[aria-hidden="true"]').innerText(),'12-week streak');
  assert.equal(await p.locator('.me-week-streak .me-owner-only').innerText(),'Only you');
  assert.equal(await p.locator('.me-week-streak .me-owner-only').evaluate(n=>getComputedStyle(n).fontSize),'13px','owner-only labels use the same readable secondary type');
  assert.equal(await p.locator('.me-week-streak svg').count(),1,'streak flame remains visible without relying on a device emoji font');
  const streakLayout=await p.locator('.me-week-streak').evaluate(node=>({right:node.getBoundingClientRect().right,headRight:node.parentElement.getBoundingClientRect().right,textAlign:getComputedStyle(node).textAlign}));
  assert(Math.abs(streakLayout.right-streakLayout.headRight)<1&&streakLayout.textAlign==='right','streak is right-aligned in the This week row');
  await p.waitForFunction(()=>typeof App!=='undefined'&&App.me?.notifications===6);
  assert.equal(await p.locator('.me-top a[aria-label="Settings"]').count(),1,'Me header shows Settings');
  assert.equal(await p.locator('.me-top .bell').count(),0,'the notification bell belongs to Home, not the Me header');

  const chartState=()=>chart.evaluate(n=>({left:n.scrollLeft,max:n.scrollWidth-n.clientWidth,atEnd:n.scrollWidth-n.clientWidth-n.scrollLeft<1}));
  const checkChart=async()=>{
   const labelGaps=await p.locator('.me-week-month').evaluateAll(nodes=>{const labels=nodes.filter(n=>n.textContent.trim()).map(n=>n.getBoundingClientRect());return labels.slice(1).map((r,i)=>r.left-labels[i].right);});
   assert(labelGaps.length>0&&labelGaps.every(gap=>gap>=1.5),'adjacent month labels have at least 1.5px separation '+JSON.stringify(labelGaps));
   if(size.width!==390||size.root!==16)return;
   const g=await p.evaluate(()=>{
    const rail=document.querySelector('.me-card-bars'),buttons=[...rail.querySelectorAll('.me-week')],bars=buttons.map(n=>n.querySelector('span[data-h],span:not(.me-week-month)'));
    const zero=buttons.find(n=>n.classList.contains('zero')),low=buttons.find(n=>!n.classList.contains('zero')&&!n.classList.contains('now'));
    const current=buttons.find(n=>n.classList.contains('now')),zeroBar=zero?.querySelector('span[data-h],span:not(.me-week-month)'),currentBar=current?.querySelector('span[data-h],span:not(.me-week-month)');
    const transitions=buttons.map((n,i)=>{const label=n.querySelector('.me-week-month');return label?.textContent.trim()?i:-1;}).filter(i=>i>=0);
    return {width:rail.clientWidth,content:rail.scrollWidth,bars:bars.map(n=>n.getBoundingClientRect().width),visibleGaps:bars.slice(1).map((n,i)=>n.getBoundingClientRect().left-bars[i].getBoundingClientRect().right),
     zero:zeroBar&&[zeroBar.getBoundingClientRect().width,zeroBar.getBoundingClientRect().height],low:low?.querySelector('span[data-h],span:not(.me-week-month)').getBoundingClientRect().height,
     current:getComputedStyle(currentBar).opacity,baseline:getComputedStyle(rail,'::after').height,transitions};
   });
   assert(g.content<=g.width+1,'all weekly bars fit without horizontal scrolling '+JSON.stringify(g));
   assert(g.bars.every(w=>w>0&&w<=18.1),'weekly bars are at most 18px wide '+JSON.stringify(g));
   assert(g.visibleGaps.every(w=>w>=5.9),'weekly bars keep 6px visual gaps '+JSON.stringify(g));
   assert.deepEqual(g.zero,[2,2],'zero weeks use a 2px tick');assert(g.low>=4,'nonzero weeks remain at least 4px high '+JSON.stringify(g));
   assert(Math.abs(Number(g.current)-.6)<.05,'current week is shown at about 60% opacity '+JSON.stringify(g));
   const expected=seriesFixture.weeks.map((w,i)=>i===0||w.d.slice(8,10)==='01'||w.d.slice(0,7)!==w.end.slice(0,7)?i:-1).filter(i=>i>=0);
   assert.deepEqual(g.transitions,expected,'month labels appear under the week containing each month start');
  };
  const checkTargets=async()=>{
   const geometry=await weeks.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,label:n.getAttribute('aria-label')};}));
   for(let i=0;i<geometry.length;i++){assert(geometry[i].height>=44&&geometry[i].label,'each week has a labelled 44px target');if(i){assert(Math.abs(geometry[i].y-geometry[i-1].y)<.02,'weeks stay on one row');assert(Math.abs(geometry[i].x-geometry[i-1].x-geometry[i-1].width)<.02,'week hit targets have no gaps or overlap');}}
  };
  async function screenshot(name){
   if(!out)return;fs.mkdirSync(out,{recursive:true});
   await p.locator('.me-top').evaluate(n=>n.scrollIntoView({block:'start',inline:'nearest'}));
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await p.evaluate(()=>{const header=document.querySelector('.me-top').getBoundingClientRect(),card=document.querySelector('.me-card').getBoundingClientRect();return{headerTop:header.top,headerBottom:header.bottom,cardTop:card.top,cardBottom:card.bottom,scrollHeight:document.scrollingElement.scrollHeight};});
   assert(layout.headerTop>=0&&layout.headerTop<48,`Screenshot starts with the Me header visible (${layout.headerTop}px)`);
   assert(layout.cardTop>=layout.headerBottom-1&&layout.cardBottom<=layout.scrollHeight+1,`Screenshot starts the Me card below its header and keeps the full card in the scroll range (${JSON.stringify(layout)})`);
   await p.screenshot({path:`${out}/${name}-${size.width}-${size.root}-${theme}.png`,animations:'disabled'});
  };
  if(todayOnly||size.width===390&&size.root===16&&theme==='light'){
   await p.locator('#t-today[data-loaded-day]').waitFor({state:'attached'});
   const sectionGap=await p.evaluate(()=>{const card=document.querySelector('.me-card').getBoundingClientRect(),today=document.querySelector('.me-today').getBoundingClientRect();return today.top-card.bottom;});
   assert(Math.abs(sectionGap-16)<1,`Me card and Today use a 16px section gap (${sectionGap}px)`);
   const meCard=p.locator('.me-card'),share=p.locator('[data-card-share]');
   const waitFeatured=()=>meCard.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});
   await waitFeatured();
   const meCardSnapshot=()=>meCard.evaluate(n=>{
    const copy=n.cloneNode(true);
    // Milestones.mount is a separate async page component inside the profile card.
    copy.querySelector('[data-me-milestones]')?.remove();
    return copy.outerHTML;
   });
   const meCardBefore=await meCardSnapshot();
   const shareLabel=await share.getAttribute('aria-label');assert.equal(shareLabel,'Share your profile');
   const checkTodayState=async(state)=>{
    if(state!==todayFixture){todayFixture=state;await p.goto(base+'/me');await waitApp(p);await p.locator('#t-today[data-loaded-day]').waitFor({state:'attached'});await p.locator('.me-card-weekly .me-week').nth(11).waitFor();await waitFeatured();}
    const today=p.locator('#t-today'),section=today.locator('.me-today'),activity=today.locator('[data-today-activity]'),food=today.locator('[data-today-food]');
    assert.equal(await meCardSnapshot(),meCardBefore,'Today state changes leave Me card markup unchanged (milestones load separately)');
    assert.equal(await share.getAttribute('aria-label'),shareLabel,'the Me card share control stays unchanged');
    assert.equal(await today.locator('.me-today-head h2').count(),state==='neither'?0:1,'Today is hidden entirely when neither source applies');
    assert.equal(await today.locator('.me-today p').count(),0,'Today has no connecting sentence or explainer line');
    assert.doesNotMatch(await today.innerText(),/left to eat|deficit|burned|only|streak/i,'Today has no pressure wording');
    if(state==='neither'){
     assert.equal(await today.innerHTML(),'','neither-users have no empty Today placeholder');assert.equal(await activity.count(),0);assert.equal(await food.count(),0);assert((await p.locator('#t-start').innerText()).includes('Get started'),'Get started replaces Today for a neither-user');
    }else{
     const activityUser=['both','activity','activity-multiple','planned','planned-distance','rest','activity-empty','food-error'].includes(state),foodUser=['both','food','estimate','food-error'].includes(state);
     assert.equal(await activity.count(),activityUser?1:0,`activity row visibility matches ${state} (${size.width}px ${theme})`);
     assert.equal(await food.count(),foodUser?1:0,`food row visibility matches ${state} (${size.width}px ${theme})`);
     assert.equal(await section.locator('.me-today-date').count(),1,'Today date is shown at the right of the header');
     const rows=await section.locator('.me-today-row').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,text:n.innerText,href:n.getAttribute('href')})));
     assert(rows.every(row=>row.height>=62),`Today rows are at least 62px tall: ${JSON.stringify(rows)}`);
     for(const copy of await section.locator('.me-today-copy').all()){
      const type=await copy.evaluate(n=>{const main=n.querySelector('b'),detail=n.querySelector('small');return{main:main&&parseFloat(getComputedStyle(main).fontSize),detail:detail&&parseFloat(getComputedStyle(detail).fontSize),gap:main&&detail?detail.getBoundingClientRect().top-main.getBoundingClientRect().bottom:null};});
      if(type.main!==null)assert(type.main<=16,`Today main text respects the 16px spacing cap (${type.main}px)`);
      if(type.detail!==null)assert(type.detail<=14,`Today secondary text respects the 14px spacing cap (${type.detail}px)`);
      if(type.gap!==null)assert(type.gap>=8,`Today text lines have an 8px visual gap (${type.gap}px)`);
     }
     if(['both','activity','food-error'].includes(state)){
      assert.match(await activity.innerText(),/Run · 6\.0 mi · 53 min/);assert.match(await activity.innerText(),/7:12 AM/);assert.doesNotMatch(await activity.innerText(),/Today at/);assert.equal(await activity.getAttribute('href'),'/activity/918204');assert(await activity.boundingBox().then(box=>box.height>=56),'activity row is the 56px workout target');
     }
     if(state==='activity-multiple')assert.match(await activity.innerText(),/2 workouts · 7\.0 mi[\s\S]*Run, Walk/,'the date-window query retains every workout from today');
     if(state==='both'){
      assert.match(await food.innerText(),/1,250 \/ 2,100 kcal/);assert.match(await food.innerText(),/70 \/ 130 g protein/);
     }
     if(state==='food')assert.match(await food.innerText(),/No food logged today/);
     if(state==='planned'){
      assert.match(await activity.innerText(),/Easy run · 30 min/);assert.match(await activity.innerText(),/On your plan/);assert.equal(await activity.getAttribute('href'),'/plan');
     }
     if(state==='planned-distance'){
      assert.match(await activity.innerText(),/Tempo run 4 mi/);assert.doesNotMatch(await activity.innerText(),/4 mi · 4 mi/,'distance already shown in a plan title is not repeated');assert.equal(await activity.getAttribute('href'),'/plan');
     }
     if(state==='rest'){
      assert.match(await activity.innerText(),/Rest day/);assert.match(await activity.innerText(),/On your plan/);assert.equal(await activity.getAttribute('href'),'/plan');
     }
     if(state==='activity-empty'){assert.match(await activity.innerText(),/No workout yet today/);assert.equal(await activity.getAttribute('href'),'/track');}
     if(state==='estimate')assert.match(await food.innerText(),/≈ 1,250 \/ 2,100 kcal/,'AI food estimates are marked with ≈');
     if(state==='food-error'){
      assert.match(await food.innerText(),/Couldn't load · Try again/);const retry=await food.locator('[data-today-retry]').boundingBox();assert(retry.height>=44,'failed food row keeps a 44px retry target');
     }
     if(['both','food','estimate'].includes(state)){
      const add=food.locator('[data-today-add]'),box=await add.boundingBox();assert(box.width>=44&&box.height>=44,'food quick action meets the 44px target');assert.equal(await food.locator('.me-today-copy').getAttribute('href'),`/food?d=${todayInNewYork()}`,'food text opens today’s Nutrition day');
     }
    }
    await screenshot(`today-${state}`);
   };
   for(const state of ['both','activity','activity-multiple','food','planned','planned-distance','rest','activity-empty','estimate','food-error','neither'])await checkTodayState(state);
   if(todayOnly){assert.deepEqual(errors,[],'Today fixture renders without browser errors');assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[],'Today fixture blocks every write beyond the existing challenge stub');console.log(`Today ${size.width}px ${theme} states: eleven fictional activity, food, plan and visibility states; Me card unchanged PASS`);await c.close();continue;}
  }
  await checkChart();await checkTargets();
  const current=weeks.last();assert((await chartState()).atEnd,'This week is visible at the right edge');
  if(size.width===390&&size.root===16)await screenshot('me-card-current-week');
  if(size.width===390&&size.root===16&&theme==='light'){
   if(out)await p.locator('.me-top').screenshot({path:`${out}/me-header-${size.width}-${theme}.png`,animations:'disabled'});
   await p.mouse.click(arrow.x+arrow.width/2,arrow.y+arrow.height/2);await p.waitForURL('**/people/alex');await p.locator('#person-profile').waitFor();
   await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  }

  await p.evaluate(()=>{window.__meChartHaptics=[];Native.haptic=kind=>window.__meChartHaptics.push(kind);});
  const currentStatsBefore=await weekly.locator('[data-week-stat]').allTextContents();
  await weeks.nth(2).tap();
  assert.equal(await weeks.nth(2).getAttribute('aria-pressed'),'true','tapping a past week selects it');
  assert.notEqual(await label.locator('span').innerText(),'This week','selected week is named');
  const pastStats=await weekly.locator('[data-week-stat]').allTextContents();assert.notDeepEqual(pastStats,currentStatsBefore,'distance, workouts and time update to the selected week');
  assert.deepEqual(await p.evaluate(()=>window.__meChartHaptics),['light'],'tapping a week gives a light haptic');
  const pickedStyle=await weeks.nth(2).locator('span[data-h],span:not(.me-week-month)').evaluate(n=>({shadow:getComputedStyle(n).boxShadow,opacity:getComputedStyle(n).opacity}));
  assert.equal(pickedStyle.shadow,'none','selected bar has no outline');assert.equal(pickedStyle.opacity,'1','selected bar is solid accent');
  if(size.width===390&&size.root===16)await screenshot('me-card-selected-past-week');
  await p.locator('[data-week-label]').click();assert.equal(await label.locator('span').innerText(),'This week','tapping outside the chart restores the current week');

  // Locate by the actual zero class to keep the selector independent of fixture ordering.
  const zeroWeek=chart.locator('.me-week.zero').first();assert.equal(await zeroWeek.count(),1,'fictional series includes an empty week');
  await zeroWeek.tap();assert.equal(await zeroWeek.getAttribute('aria-pressed'),'true','a zero week can be selected');
  const zeroStats=await weekly.locator('[data-week-stat]').allTextContents();assert(zeroStats.every(value=>/0/.test(value)&&!/[1-9]/.test(value)),'zero week shows zero distance, workouts and time '+JSON.stringify(zeroStats));
  if(size.width===390&&size.root===16)await screenshot('me-card-zero-week');
  await p.locator('[data-week-label]').click();assert.equal(await current.getAttribute('aria-pressed'),'false','outside tap clears the selected zero week');

  await p.evaluate(()=>{window.__meChartHaptics=[];});
  await chart.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
  const box0=await weeks.nth(0).boundingBox(),box3=await weeks.nth(3).boundingBox();
  await p.mouse.move(box0.x+box0.width/2,box0.y+box0.height/2);await p.mouse.down();
  await p.mouse.move(box3.x+box3.width/2,box3.y+box3.height/2,{steps:5});await p.mouse.up();
  assert.equal(await weeks.nth(3).getAttribute('aria-pressed'),'true','drag selects the week under the pointer');
  const dragHaptics=await p.evaluate(()=>window.__meChartHaptics);assert(dragHaptics.length>=2&&dragHaptics.every(kind=>kind==='light'),'drag gives a light haptic at each selection change '+JSON.stringify(dragHaptics));
  await weeks.nth(6).focus();await p.keyboard.press('Enter');assert.equal(await weeks.nth(6).getAttribute('aria-pressed'),'true','keyboard activates a focused week');
  assert.equal(await weeks.evaluateAll(nodes=>nodes.filter(n=>n.getAttribute('aria-pressed')==='true').length),1,'only one week can be selected');
  // The two approved slots have independent visibility rules; neither adds another number row.
  for(const fixture of ['streak-only','target-only','neither']){
   slotFixture=fixture;await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();
   assert.equal(await p.locator('.me-week-streak').count(),fixture==='streak-only'?1:0,fixture+' streak visibility');
   assert.equal(await p.locator('.me-card-close-to').count(),fixture==='target-only'?1:0,fixture+' close-to visibility');
   assert.equal(await weekly.locator('[data-week-stat]').count(),3,fixture+' keeps the three existing numbers');
   if(fixture==='streak-only')await screenshot('me-card-streak-only');
   if(fixture==='target-only')await screenshot('me-card-target-only');
   if(fixture==='neither')await screenshot('me-card-neither');
  }
  slotFixture='short-streak';await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  assert.equal(await p.locator('.me-week-streak').count(),0,'streaks shorter than two weeks stay hidden');
  assert.equal(await p.locator('.me-card-close-to').count(),0,'neither-source state hides the line when a one-week streak has no target');
  if(size.width===390&&size.root===16&&theme==='light'){
   zeroDistanceFixture=true;await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();
   assert.equal(await p.locator('.me-week').count(),12,'lifting-only history still shows all twelve weeks');assert.equal(await p.locator('.me-week.zero').count(),12,'zero-distance history keeps the zero baseline ticks');
   assert.equal(await p.locator('[data-week-stat="distance"] .me-metric-value').innerText(),'0');assert.equal(await p.locator('[data-week-stat="activities"] .me-metric-value').innerText(),'2');assert.equal(await p.locator('[data-week-stat="time"] .me-metric-value').innerText(),'20m');
   await screenshot('me-card-zero-distance-workouts');
  }
  if(size.width===390&&size.root===16){
   await p.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});
   assert.equal(await p.locator('.me-featured-item').count(),4,'earned achievements fill an unpinned Featured rail automatically');
   assert.equal(await p.locator('.me-showcase-streak').count(),0,'an inactive day streak stays hidden');
   await screenshot('me-featured-zero');
   showcaseFixture={items:[],pinned:[],day_streak:1};showcasePins=[];achievementFixture={tracks:[]};shareAchievementsEnabled=true;await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});
   assert.equal(await p.locator('.me-featured-achievements').count(),0,'the Me card hides Featured when there are no earned medals');assert.equal(await p.locator('.me-featured-item').count(),0,'an empty automatic Showcase has no medals');
   const fallbackTracks=[
    {code:'sport:run',label:'Run',level:9,_sharedAchievement:true,display_value:9000,display_unit:'mi',tiers:[{rank:9,day:'2026-11-08'}]},
    {code:'sport:ride',label:'Ride',level:9,_sharedAchievement:true,display_value:8000,display_unit:'mi',tiers:[{rank:9,day:'2026-11-09'}]},
    {code:'workouts',label:'Workouts',level:10,_sharedAchievement:true,display_value:100,display_unit:'workouts',tiers:[{rank:10,day:'2026-11-07'}]},
    {code:'lifted',label:'Lifted',level:7,_sharedAchievement:true,display_value:200000,display_unit:'lb',tiers:[{rank:7,day:'2026-11-06'}]},
    {code:'journey',label:'Journey',level:6,_sharedAchievement:true,display_value:4000,display_unit:'mi',tiers:[{rank:6,day:'2026-11-10'}]}
   ];
   showcaseFixture={items:[],pinned:[],day_streak:1};showcasePins=[];achievementFixture={tracks:fallbackTracks};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor();
   assert.deepEqual(await p.locator('.me-featured-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.showcaseCode)),['workouts','sport:ride','sport:run','lifted'],'an empty unpinned Showcase fills with the four highest earned levels, with recent earning as the tie-break');
   const automaticItems=[{code:'journey',rank:4},{code:'sport:run',rank:2}],automaticTracks=[{code:'journey',label:'Journey',display_value:27111,display_unit:'mi'},{code:'sport:run',label:'Run',display_value:11427.5,display_unit:'mi'}];
   showcaseFixture={items:automaticItems,pinned:[],day_streak:1};showcasePins=[];achievementFixture={tracks:automaticTracks};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor();
   assert.deepEqual(await p.locator('.me-featured-item').evaluateAll(nodes=>nodes.map(n=>n.dataset.showcaseCode)),['journey','sport:run'],'no pins use the server automatic top medals');await screenshot('me-featured-automatic');
   showcaseFixture={items:[{code:'sport:run',rank:2}],pinned:['sport:run'],day_streak:1};showcasePins=['sport:run'];achievementFixture={tracks:[{code:'sport:run',label:'Run',display_value:11427.5,display_unit:'mi'}]};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor();
   assert.equal(await p.locator('.me-featured-item').count(),1,'a single pinned achievement overrides the automatic medals');
   assert.equal(await p.locator('.profile-achievement-value').innerText(),'11.4k mi','the shared medal uses the same compact value as a friend profile');assert.match(await p.locator('.me-featured-item').getAttribute('aria-label'),/11,427\.5 mi/,'the full value remains available to screen readers');
   assert.equal(await p.locator('.me-showcase-streak').count(),0,'a one-day streak stays hidden');
   const onePlacement=await p.locator('.me-featured-achievements').evaluate(n=>{const item=n.querySelector('.me-featured-item').getBoundingClientRect(),chart=n.closest('.me-card-sections').querySelector('.me-card-weekly').getBoundingClientRect();return{itemTop:item.top,chartBottom:chart.bottom,medal:n.querySelector('.profile-achievement-medallion').getBoundingClientRect().width};});
   assert(onePlacement.itemTop>onePlacement.chartBottom&&onePlacement.medal>=68&&onePlacement.medal<=72,'one featured medal uses the responsive 390px size as a friend profile '+JSON.stringify(onePlacement));await screenshot('me-featured-one');
   const featuredItems=[{code:'journey',rank:4},{code:'sport:run',rank:2},{code:'workouts',rank:3},{code:'climbing',rank:3}],featuredTracks=[{code:'journey',label:'Journey',value:4828032,display_value:27111,display_unit:'mi',tiers:[{rank:4,day:'2026-11-09'}]},{code:'sport:run',label:'Run',value:3218688,display_value:11427.5,display_unit:'mi',tiers:[{rank:2,day:'2026-11-08'}]},{code:'workouts',label:'Workouts',value:12345,display_value:12345,display_unit:'workouts',tiers:[{rank:3,day:'2026-11-07'}]},{code:'climbing',label:'Climbing',value:12210,display_value:12210,display_unit:'ft',tiers:[{rank:3,day:'2026-11-06'}]}];
   achievementFixture={tracks:featuredTracks};showcasePins=['sport:run'];await screenshot('me-showcase-one-medal');
   for(const count of [2,3]){showcasePins=featuredItems.slice(0,count).map(item=>item.code);showcaseFixture={items:featuredItems.slice(0,count),pinned:showcasePins,day_streak:12};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('.me-featured-item').nth(count-1).waitFor();assert.equal(await p.locator('.me-featured-item').count(),count,`${count} pinned achievements fit in the grid`);await screenshot(`me-featured-${count}-${theme}`);}
   showcasePins=featuredItems.map(item=>item.code);showcaseFixture={items:featuredItems,pinned:showcasePins,day_streak:12};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('.me-featured-item').nth(3).waitFor();
   assert.equal(await p.locator('.me-featured-item').count(),4,'all four pinned achievements fit in one row');
   const featuredHits=[];for(const item of await p.locator('.me-featured-item').all()){await item.scrollIntoViewIfNeeded();featuredHits.push(await item.evaluate(n=>{const r=n.querySelector('.profile-achievement-medallion').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:n.getAttribute('aria-label'),target:hit?.closest('.me-featured-item')===n,clearOfProfile:!hit?.closest('.me-card-open-link')};}));}assert(featuredHits.every(item=>item.target&&item.clearOfProfile),'each Featured medal remains its own top hit target outside the card profile link '+JSON.stringify(featuredHits));
   assert.equal(await p.locator('.me-showcase-streak').innerText(),'12-day streak','a live day streak sits beside the medals, labelled');
   const streakFont=await p.locator('.me-showcase-streak').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(streakFont>=15,'the compact streak number meets the minimum readable type size ('+streakFont+'px)');
   const grid=await p.locator('.me-featured-achievements .profile-achievement-list').evaluate(n=>{const box=n.getBoundingClientRect(),nodes=[...n.children],items=nodes.map(x=>x.getBoundingClientRect()),medals=nodes.map(x=>x.querySelector('.profile-achievement-medallion').getBoundingClientRect()),style=getComputedStyle(n);return{display:style.display,columns:style.gridTemplateColumns.split(' ').length,overflow:style.overflowX,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,centers:medals.map(x=>x.x+x.width/2),medalSizes:medals.map(x=>[x.width,x.height]),box:{left:box.left,right:box.right},items:items.map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom}))};});
   const medalBounds=size.width===330?[56,60]:[68,72];assert.equal(grid.display,'grid');assert.equal(grid.columns,4);assert.equal(grid.overflow,'visible');assert(grid.scrollWidth<=grid.clientWidth+1&&grid.centers.length===4&&grid.centers.every((x,i)=>!i||x>grid.centers[i-1])&&grid.items.every(item=>Math.abs(item.top-grid.items[0].top)<1&&item.left>=grid.box.left-1&&item.right<=grid.box.right+1&&item.bottom-item.top>=44)&&grid.medalSizes.every(([w,h])=>w>=medalBounds[0]&&w<=medalBounds[1]&&w===h),'featured medals fit four across with responsive size, wrapped labels and 44px+ link targets '+JSON.stringify(grid));
   const medalReadability=await p.locator('.me-featured-item').evaluateAll(nodes=>nodes.map(node=>{const medal=node.querySelector('.profile-achievement-medallion'),icon=medal.querySelector('.profile-achievement-icon').getBoundingClientRect(),value=medal.querySelector('.profile-achievement-value').getBoundingClientRect(),level=medal.querySelector('.profile-achievement-level')?.getBoundingClientRect(),multiple=medal.querySelector('.profile-achievement-multiple')?.getBoundingClientRect(),overlap=(a,b)=>a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return{name:node.querySelector('.profile-achievement-name').textContent.trim(),value:medal.querySelector('.profile-achievement-value').textContent.trim(),aria:node.getAttribute('aria-label'),badgesClear:[level,multiple].filter(Boolean).every(b=>!overlap(b,icon)&&!overlap(b,value)&&(!level||!multiple||!overlap(level,multiple)))};}));assert(medalReadability.every(item=>item.badgesClear),'level/multiple badges stay clear of icons and values '+JSON.stringify(medalReadability));const journey=medalReadability.find(item=>item.name==='Journey');assert.equal(journey.value,'27.1k mi');assert.match(journey.aria,/27,111 mi/,'Journey aria-label keeps the exact value');assert.equal(medalReadability.find(item=>item.name==='Workouts').name,'Workouts','workout label remains intact');
   const fitted=await p.locator('.profile-achievement-name,.profile-achievement-next').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1&&!/…|\.\.\./.test(n.textContent)));assert(fitted,'long achievement labels wrap without clipping or ellipsis');await screenshot(`me-featured-four-${theme}`);
   const medalLink=p.locator('.me-featured-item').first();assert.equal(await medalLink.getAttribute('href'),'/me/achievements/journey','a featured medal links directly to its own track detail');
   await medalLink.click();await p.waitForURL('**/me/achievements/journey');await p.locator('.profile-achievement-history-head[data-achievement-code="journey"]').waitFor();
   await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();
   shareAchievementsEnabled=false;await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});
   assert.equal(await p.locator('.me-featured-achievements').count(),1,'the owner keeps the Featured entry point when sharing is off');assert.equal(await p.locator('.me-featured-item').count(),4,'the private owner card retains its pinned medals');await screenshot(`me-featured-sharing-off-${theme}`);
   await p.locator('[data-card-share]').click();await p.locator('[data-unified-share]').waitFor();
   assert(!(await p.locator('.share-picture-label').allInnerTexts()).includes('Achievements'),'the picture sheet hides achievements when sharing is off');
   await screenshot('me-showcase-shared-off');await p.keyboard.press('Escape');
  shareAchievementsEnabled=true;showcasePins=[];showcaseFixture={items:featuredItems,pinned:[],day_streak:12};await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();await p.locator('[data-me-featured][data-loaded="true"]').waitFor({state:'attached'});await p.locator('[data-card-share]').click();await p.locator('[data-unified-share]').waitFor();
   const achievementPicture=p.locator('[data-share-choice]').filter({hasText:'Achievements'});await achievementPicture.waitFor();await achievementPicture.click();
   const achievementIndex=await achievementPicture.getAttribute('data-share-choice'),achievementImage=p.locator(`[data-share-image="${achievementIndex}"]`);await p.waitForFunction(index=>{const image=document.querySelector(`[data-share-image="${index}"]`);return image?.complete&&image.naturalWidth===1080;},achievementIndex);
   const earnedAlt=await achievementImage.getAttribute('alt');assert.match(earnedAlt,/^Earned achievements:/,'achievement sharing renders the earned-medal print');for(const track of featuredTracks)assert(earnedAlt.includes(track.label+', Level '),`the earned print includes ${track.label}`);assert.equal(await p.evaluate(()=>window.__sharePictureDiagnostic?.achievementCount),featuredTracks.length,'the print contains every earned fixture track');assert.doesNotMatch(earnedAlt,/@alex|Alex Rivera/,'the earned-medal print omits account identity');assert.equal(await p.locator('[data-share-control="identity"]').count(),0,'the earned-medal print has no identity field');
   await screenshot('me-showcase-shared-on');
  }
  await featuredEditor();
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow,'no horizontal page overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);
  console.log(`Me weekly card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();
 }
 await login.close();await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
