// Rendered Me weekly card: current-week numbers, selectable 12-week chart and optional trend slots.
// All names and values are fictional; requests that could write data are intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const todayOnly=process.env.KINETTA_ME_TODAY_ONLY==='1';
const todayInNewYork=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;};
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
  const c=await b.newContext({storageState,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
  let slotFixture='both',todayFixture='both',zeroDistanceFixture=false,seriesFixture;
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/api/**',async r=>{
   const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
   if(u.pathname==='/api/me'){const resp=await r.fetch(),j=await resp.json();j.bio='Fictional trails and weekend rides.';j.kcal_target=null;j.protein_target=null;j.units='imperial';return r.fulfill({response:resp,json:j});}
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
  await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  const weekly=p.locator('.me-card-weekly'),label=p.locator('[data-week-label]'),chart=p.locator('.me-card-bars'),weeks=p.locator('.me-week');
  const profileLink=p.locator('.me-card-open-link'),linkBox=await profileLink.boundingBox(),cardBox=await p.locator('.me-card').boundingBox();
  assert.equal(await profileLink.getAttribute('aria-label'),'Open my profile','the whole-card link has the approved VoiceOver label');
  assert.match(await profileLink.getAttribute('href'),/^\/people\/alex(?:\?|$)/,'the whole card opens the owner profile');
  assert(Math.abs(linkBox.x-cardBox.x)<1&&Math.abs(linkBox.y-cardBox.y)<1&&Math.abs(linkBox.width-cardBox.width)<1&&Math.abs(linkBox.height-cardBox.height)<1,'the profile target covers the whole Me card');
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
  for(const [selector,label] of [['.me-card-banner [data-card-edit]','Edit'],['.me-card-banner [data-card-share]','Share'],['.me-card-id > .me-friends-link .me-friends-count','friends'],['.me-card-id > .me-friends-link .badge.alert','waiting chip'],['.me-card .me-milestone-all','See all']]){
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
  assert.equal(await p.locator('.me-card-close-to[data-close-to]').innerText(),'18 mi to 1,000 mi this year','close-to follows the owner’s profile units');
  assert.equal(await weekly.locator('[data-week-stat]').count(),3,'the close-to line adds no number row');
  const closeGeometry=await p.locator('.me-card-close-to').evaluate(n=>{const r=n.getBoundingClientRect(),bar=document.querySelector('.me-card-bars').getBoundingClientRect(),s=getComputedStyle(n);return{top:r.top,barBottom:bar.bottom,font:parseFloat(s.fontSize),border:s.borderWidth,background:s.backgroundColor};});
  assert(closeGeometry.top>=closeGeometry.barBottom&&closeGeometry.font>=13&&closeGeometry.border==='0px'&&closeGeometry.background==='rgba(0, 0, 0, 0)','close-to remains plain 13px secondary text under the bars '+JSON.stringify(closeGeometry));
  await screenshot('me-card-both');
  assert.equal(await p.locator('.me-week-streak').getAttribute('aria-label'),'🔥 12 weeks');
  assert.equal(await p.locator('.me-week-streak > span[aria-hidden="true"]').innerText(),'12 weeks');
  assert.equal(await p.locator('.me-week-streak svg').count(),1,'streak flame remains visible without relying on a device emoji font');
  const streakLayout=await p.locator('.me-week-streak').evaluate(node=>({right:node.getBoundingClientRect().right,headRight:node.parentElement.getBoundingClientRect().right,textAlign:getComputedStyle(node).textAlign}));
  assert(Math.abs(streakLayout.right-streakLayout.headRight)<1&&streakLayout.textAlign==='right','streak is right-aligned in the This week row');
  await p.locator('.me-top .bell-dot').waitFor({state:'visible'});assert.equal(await p.locator('.me-top .bell-dot').innerText(),'6');
  const bell=await p.locator('.me-top .bell').evaluate(node=>{const icon=node.querySelector('svg').getBoundingClientRect(),badge=node.querySelector('.bell-dot').getBoundingClientRect();return{visible:!node.querySelector('.bell-dot').hidden,text:node.querySelector('.bell-dot').textContent.trim(),icon:{left:icon.left,right:icon.right,top:icon.top,bottom:icon.bottom},badge:{left:badge.left,right:badge.right,top:badge.top,bottom:badge.bottom},overlap:{x:Math.min(icon.right,badge.right)-Math.max(icon.left,badge.left),y:Math.min(icon.bottom,badge.bottom)-Math.max(icon.top,badge.top)}};});
  assert(bell.visible&&bell.text==='6','fictional unread count is shown on the Me bell');
  assert(bell.overlap.x>0&&bell.overlap.y>0&&bell.overlap.x<=4.5&&bell.overlap.y<=4.5,'unread badge overlaps only the bell glyph’s top-right corner');

  const chartState=()=>chart.evaluate(n=>({left:n.scrollLeft,max:n.scrollWidth-n.clientWidth,atEnd:n.scrollWidth-n.clientWidth-n.scrollLeft<1}));
  const checkChart=async()=>{
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
   const layout=await p.evaluate(()=>{const header=document.querySelector('.me-top').getBoundingClientRect(),card=document.querySelector('.me-card').getBoundingClientRect();return{headerTop:header.top,headerBottom:header.bottom,cardTop:card.top,cardBottom:card.bottom,viewport:innerHeight};});
   assert(layout.headerTop>=0&&layout.headerTop<48,`Screenshot starts with the Me header visible (${layout.headerTop}px)`);
   assert(layout.cardTop>=layout.headerBottom-1&&layout.cardBottom<=layout.viewport+1,`Screenshot keeps the full Me card in view (${JSON.stringify(layout)})`);
   await p.screenshot({path:`${out}/${name}-${size.width}-${size.root}-${theme}.png`,animations:'disabled'});
  };
  if(todayOnly||size.width===390&&size.root===16&&theme==='light'){
   await p.locator('#t-today[data-loaded-day]').waitFor({state:'attached'});
   const sectionGap=await p.evaluate(()=>{const card=document.querySelector('.me-card').getBoundingClientRect(),today=document.querySelector('.me-today').getBoundingClientRect();return today.top-card.bottom;});
   assert(Math.abs(sectionGap-16)<1,`Me card and Today use a 16px section gap (${sectionGap}px)`);
   const meCard=p.locator('.me-card'),share=p.locator('[data-card-share]');
   const meCardSnapshot=()=>meCard.evaluate(n=>{
    const copy=n.cloneNode(true);
    // Milestones.mount is a separate async page component inside the profile card.
    copy.querySelector('[data-me-milestones]')?.remove();
    return copy.outerHTML;
   });
   const meCardBefore=await meCardSnapshot();
   const shareLabel=await share.getAttribute('aria-label');assert.equal(shareLabel,'Share your profile');
   const checkTodayState=async(state)=>{
    if(state!==todayFixture){todayFixture=state;await p.goto(base+'/me');await waitApp(p);await p.locator('#t-today[data-loaded-day]').waitFor({state:'attached'});await p.locator('.me-card-weekly .me-week').nth(11).waitFor();}
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
      assert.match(await activity.innerText(),/Run · 6\.0 mi · 52 min/);assert.match(await activity.innerText(),/7:12 AM/);assert.doesNotMatch(await activity.innerText(),/Today at/);assert.equal(await activity.getAttribute('href'),'/activity/918204');assert(await activity.boundingBox().then(box=>box.height>=56),'activity row is the 56px workout target');
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
   if(out)await p.locator('.me-top').screenshot({path:`${out}/bell-badge-${size.width}-${theme}.png`,animations:'disabled'});
   await profileLink.click();await p.waitForURL('**/people/alex');await p.locator('#person-profile').waitFor();
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
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow,'no horizontal page overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);
  console.log(`Me weekly card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();
 }
 await login.close();await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
