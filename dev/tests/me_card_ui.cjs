// Rendered Me weekly card: current-week numbers, selectable 12-week chart and optional trend slots.
// All names and values are fictional; requests that could write data are intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
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
 for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
  const c=await b.newContext({storageState,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
  let slotFixture='both',zeroDistanceFixture=false,seriesFixture;
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/api/**',async r=>{
   const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
   if(u.pathname==='/api/me'){const resp=await r.fetch(),j=await resp.json();j.bio='Fictional trails and weekend rides.';return r.fulfill({response:resp,json:j});}
   if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:6,friend_requests:0,friend_count:2}});
   if(u.pathname==='/api/stats'){const resp=await r.fetch(),j=await resp.json();j.week_streak=slotFixture==='short-streak'?1:12;return r.fulfill({response:resp,json:j});}
   if(u.pathname.endsWith('/profile')){
    const resp=await r.fetch(),j=await resp.json(),series=chartFixture(j.mileage.today);seriesFixture=series;
    // Fictional stand-ins prove that all-time data stays off Me. They remain on the full profile.
    j.overview={...j.overview,activities:3044,distance_m:18964000,time_s:5568300};
    j.sports=[{sport:'run',activities:2938},{sport:'walk',activities:70},{sport:'ride',activities:19},{sport:'hike',activities:9}];
    j.person={...j.person,bio:'Fictional trails and weekend rides.'};j.bio='Fictional trails and weekend rides.';
    if(zeroDistanceFixture)series.weeks=series.weeks.map((w,i)=>({...w,distance_m:0,activities:i===11?2:0,time_s:i===11?1200:0}));
    j.mileage=series;
    if(slotFixture!=='no-close-to')j.close_to='One more walk to match last week.';
    return r.fulfill({response:resp,json:j});
   }
   return r.continue();
  });
  await p.goto(base+'/me');await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  const weekly=p.locator('.me-card-weekly'),label=p.locator('[data-week-label]'),chart=p.locator('.me-card-bars'),weeks=p.locator('.me-week');
  const profileLink=p.locator('.me-card-profile-link'),linkBox=await profileLink.boundingBox();
  assert.equal(await profileLink.getAttribute('aria-label'),`View your full profile: ${await profileLink.locator('h2').innerText().then(n=>n.replace(/\s+›$/,''))}, ${await profileLink.locator('.me-card-meta').innerText()}`,'the link label identifies the action and includes the visible name and handle');
  assert(linkBox.height>=44,'the full-profile header link is at least 44px tall');
  assert.equal(await profileLink.locator('.me-card-avatar').count(),1);assert.match(await profileLink.locator('h2').innerText(),/Alex Rivera\s+›$/);
  const nameLine=await profileLink.locator('h2').evaluate(node=>({height:node.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(node).lineHeight),bottom:node.getBoundingClientRect().bottom})),chevronBox=await profileLink.locator('.me-profile-chevron').boundingBox();
  const maxNameLines=size.width===390&&size.root===16?1:2;
  assert(nameLine.height<=nameLine.lineHeight*maxNameLines+1&&chevronBox.y+chevronBox.height<=nameLine.bottom+1,'profile chevron stays with the name at this text size '+JSON.stringify({nameLine,chevronBox}));
  assert.equal(await profileLink.locator('.me-card-meta').innerText(),'@alex');
  assert.equal(await profileLink.locator('.me-profile-chevron').evaluate(n=>getComputedStyle(n).fontSize),'15px');
  assert.equal(await profileLink.locator('.me-profile-chevron').evaluate(n=>getComputedStyle(n).color),await profileLink.locator('.me-card-meta > span').evaluate(n=>getComputedStyle(n).color),'chevron uses the secondary text color');
  assert.equal(await p.locator('.me-card-id > .me-friends-link').count(),1,'friend navigation remains a separate link');
  assert.equal(await profileLink.locator('.me-friends-link').count(),0,'friend navigation is not nested inside the profile link');
  const divider=p.locator('.me-divider'),dividerBox=await divider.boundingBox();
  assert.equal(await divider.getAttribute('aria-hidden'),'true');assert(Math.abs(dividerBox.height-1)<.1,'the private section boundary is a hairline');
  assert.equal(await divider.locator('span').count(),0,'the divider has no label');
  await weeks.first().waitFor();assert.equal(await weeks.count(),12,'Me has one 12-week chart');
  assert.equal(await p.locator('.me-period,.me-distance.days,.me-card-figures,.me-card-note,.me-sport-chips,.me-profile-bio,.me-about').count(),0,'Me hides the Days toggle, daily chart, bio, all-time totals, sport rows and privacy footer');
  assert.doesNotMatch(await p.locator('.me-card').innerText(),/3,044|11,784|1,546|Fictional trails and weekend rides|2,938/,'Me does not leak the full-profile bio, lifetime totals or sport counts');
  assert.equal(await weekly.locator('[data-week-stat]').count(),3,'the weekly card has distance, workout and time values');
  for(const stat of ['distance','activities','time'])assert(await weekly.locator(`[data-week-stat="${stat}"]`).count()===1,`current week exposes ${stat}`);
  const currentStats=await weekly.locator('[data-week-stat]').allTextContents();assert(currentStats.every(value=>value.trim()),'This week has visible distance, workout and time totals');
  assert.equal(await label.locator('span').innerText(),'This week','current week is the default selection');
  assert.equal(await p.locator('.me-week-streak[data-week-streak="12"]').count(),1,'streak appears at twelve weeks');
  assert.equal(await p.locator('.me-close-to,[data-close-to]').count(),0,'close-to stays hidden until the milestone design is ready');
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
  const screenshot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${size.width}-${size.root}-${theme}.png`,animations:'disabled'});}};
  await checkChart();await checkTargets();
  const current=weeks.last();assert((await chartState()).atEnd,'This week is visible at the right edge');
  if(size.width===390&&size.root===16)await screenshot('me-card-current-week');
  if(size.width===330&&size.root===24)await screenshot('me-card-large-text');
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
  // Optional slots have independent visibility rules and disappear when their own source data is absent.
  slotFixture='short-streak';await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  assert.equal(await p.locator('.me-week-streak').count(),0,'streaks shorter than two weeks stay hidden');assert.equal(await p.locator('.me-close-to,[data-close-to]').count(),0,'close-to stays hidden when the API supplies placeholder text');
  slotFixture='no-close-to';await clearProfileCache(p);await p.reload();await waitApp(p);await p.locator('.me-card-weekly').waitFor();
  assert.equal(await p.locator('.me-week-streak[data-week-streak="12"]').count(),1,'eligible streak remains visible');assert.equal(await p.locator('.me-close-to,[data-close-to]').count(),0,'close-to stays hidden without API text');
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
