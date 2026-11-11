// Me has a weekly summary; the full profile keeps its shared bio, all-time totals, sports and activities.
// Fictional demo accounts (Alex, friend Jordan, Sam waiting for approval); writes are intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const compositionOnly=process.env.KINETTA_PROFILE_VIEW_COMPOSITION_ONLY==='1';
const milestoneOffers=[{id:'22222222-2222-4222-8222-222222222222',kind:'year_distance',title:'100 miles this year',day:'2026-10-31',occurred:'2026-10-31T12:00:00Z',rank:500,private_activity:false,details:{amount:100,unit:'mi',garmin_sources:[]}},{id:'11111111-1111-4111-8111-111111111111',kind:'first_distance',title:'First 5K',day:'2026-11-01',occurred:'2026-11-01T12:00:00Z',rank:10,private_activity:true,details:{distance_m:5000,seconds:1800,sport:'run',garmin_sources:[]}}];
const friendRanks=[['journey','Journey',7,'mi'],['workouts','Workouts',8,'workouts'],['lifted','Weight lifted',7,'lb'],['sport:run','Running',4,'mi']];
const friendShowcase={items:friendRanks.map(([code,,rank])=>({code,rank})),pinned:friendRanks.map(([code])=>code),day_streak:123};
const friendAchievements={pending:false,tracks:friendRanks.map(([code,label,rank,unit])=>({code,label,unit,tiers:Array.from({length:rank},(_,index)=>({rank:index+1,day:'2026-11-01'}))}))};
const addDays=(day,count)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);};
const chartFixture=today=>{const noon=new Date(today+'T12:00:00Z'),sunday=addDays(today,-noon.getUTCDay()),values=[0,1800,6200,100,0,4300,2700,900,0,5500,3200,7800];return{today,weeks:values.map((distance_m,i)=>{const d=addDays(sunday,(i-11)*7),end=addDays(d,6),activities=distance_m?i%4+1:0;return{d,end,distance_m,activities,time_s:activities?1800+i*120:0,today:i===11};})};};
// Poll with page.evaluate: the app's Content Security Policy forbids the string evaluation waitForFunction uses.
async function until(page,fn,label,arg){for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);}
async function sportChecks(p){
 await p.evaluate(()=>document.fonts.ready);const rail=p.locator('.me-card .me-sport-chips');
 await until(p,()=>{const n=document.querySelector('.me-card .me-sport-chips'),r=n.getBoundingClientRect();return [...n.children].filter(x=>!x.hidden).every(x=>{const b=x.getBoundingClientRect();return b.left>=r.left-.1&&b.right<=r.right+.1;});},'whole sports labels fit');
 const all=await rail.locator('.me-sport-ico').evaluateAll(nodes=>nodes.map(n=>n.dataset.sport)),shown=await rail.locator('.me-sport-chip:visible .me-sport-ico').evaluateAll(nodes=>nodes.map(n=>n.dataset.sport));assert.deepEqual(all,['run','walk','ride','hike','swim'],'default order is most-used first, with no four-sport cutoff');assert.deepEqual(shown,all.slice(0,shown.length),'whole visible prefix keeps the order');assert(shown.length<=3,'at most three sports');
 const more=rail.locator('.me-sport-more'),omitted=all.length-shown.length;assert.equal(await more.isVisible(),omitted>0);if(omitted){assert.equal(await more.locator('[aria-hidden=true]').innerText(),'+'+omitted);assert.match(await more.ariaSnapshot(),/more sports?/,'omitted labels remain available to screen readers');}
 assert(await rail.evaluate(n=>n.scrollWidth<=n.clientWidth+1&&getComputedStyle(n).overflowX==='visible'&&n.tabIndex<0),'sports never scroll or clip');
}
async function numberChecks(p,period='totals'){
 const card=p.locator('.me-card'),figures=card.locator('.me-card-figures');assert.equal(await figures.count(),1,'one full-profile totals section');assert.equal(await card.locator('table').count(),0,'snapshot has no table');assert.equal(await figures.getAttribute('data-card-period'),period);
 assert.deepEqual(await figures.locator('dt > span').allTextContents(),['Activities','Distance','Time']);assert.equal(await figures.locator('.me-metric-value').count(),3,'three visible headline numbers');assert.match((await figures.locator('dt small').allTextContents()).join(' '),/\((mi|km)\).*\(h\)/,'units stay under the numbers');
 const geometry=await figures.locator('[data-card-stat]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),value=n.querySelector('b').getBoundingClientRect(),label=n.querySelector('dt').getBoundingClientRect(),text=document.createRange();text.selectNodeContents(n.querySelector('b'));return {top:value.top,width:r.width,valueWidth:value.width,labelGap:label.top-value.bottom,contained:value.left>=r.left-.1&&value.right<=r.right+.1,lines:text.getClientRects().length,below:label.top>=value.bottom+3};}));assert(geometry.every(x=>x.contained&&x.lines===1&&x.below),'unbroken values fit, with labels below '+JSON.stringify(geometry));assert(Math.max(...geometry.map(x=>x.top))-Math.min(...geometry.map(x=>x.top))<.1,'all three numbers share one row');
 assert(await figures.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'headline numbers do not scroll');assert.match(await figures.locator('[data-card-stat=time] dd').ariaSnapshot(),period==='recent'?/21h\s*46m/:/1[,\s]547h/,'precise time remains accessible');if(period==='recent')assert.match(await figures.getAttribute('aria-label'),/Last 30 days, .+ – .+/,'recent range retained');
}
async function cardChecks(p,size){
 const card=p.locator('.me-card');await numberChecks(p);
 assert.match(await p.locator('.me-card-figures').innerText(),/3,045/,'full profile retains all-time activity totals');
 assert.match(await p.locator('body').innerText(),/2,939/,'full profile retains featured sport counts');
 const friends=card.locator('a.me-friends-link'),target=await friends.boundingBox();assert(target.width>=44&&target.height>=44);assert.equal(await friends.evaluate(n=>getComputedStyle(n).pointerEvents),'auto','inline friends remains tappable');
 await sportChecks(p);
 if(size.root===16&&size.width>=390){const meta=await card.locator('.me-card-meta').evaluate(n=>[...n.children].map(x=>{const r=x.getBoundingClientRect();return [r.top,r.bottom]}));assert(Math.max(...meta.map(x=>x[0]))<Math.min(...meta.map(x=>x[1])),'friends and handle share a line');}
 const bars=await card.locator('.me-week').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,label:n.getAttribute('aria-label')})));assert.equal(bars.length,12);assert(bars.every(r=>r.width>0&&r.height>=44&&r.label),'all twelve weeks have tall, labelled selection targets');assert(await card.locator('.me-card-bars').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'all weeks fit without horizontal scrolling');assert.equal(await card.locator('.me-chart-scroll').evaluate(n=>getComputedStyle(n,'::before').backgroundImage),'none','scroll cue does not fade a bar');
 assert.equal(await card.locator('.me-card-weekly').count(),0,'the redesigned weekly-only card stays exclusive to Me');
 assert.equal(await card.locator('[data-week-label] span').innerText(),'This week');assert.equal(await card.locator('[data-week-label] small').innerText(),await card.locator('.me-week.now').getAttribute('data-dist'),'full profile retains the existing current distance chart');
 const padding=await card.evaluate(n=>{const b=n.querySelector('.me-card-body'),r=b.getBoundingClientRect(),s=getComputedStyle(b),rail=n.querySelector('.me-card-bars').getBoundingClientRect();return rail.left>=r.left+parseFloat(s.paddingLeft)-.1&&rail.right<=r.right-parseFloat(s.paddingRight)+.1});assert(padding,'chart rail remains inside card padding');
 assert.equal(await card.locator('.me-card-note').count(),0,'privacy note is kept out of the profile card and shown in Share');
 assert.match(await p.locator('body').innerText(),/Fictional trails and weekend rides\./,'bio remains on the full profile');
}
async function weeklyCardChecks(p){
 const card=p.locator('.me-card');assert.equal(await card.locator('.me-card-weekly').count(),1,'Me shows the weekly summary card');
 assert.equal(await card.locator('.me-week').count(),12,'Me shows twelve weeks');
 assert.equal(await card.locator('.me-card-figures,.me-sport-chips,.me-profile-bio,.me-about,.me-card-note,.me-period,.me-distance.days').count(),0,'Me omits profile bio, all-time totals, sports, privacy note and daily/period controls');
 assert.equal(await card.locator('.me-card-weekly [data-week-stat]').count(),3,'Me shows distance, workouts and time for the week');
 assert.equal(await card.locator('[data-week-label] span').innerText(),'This week','Me starts on the current week');
 assert.equal(await card.locator('.me-week-streak').getAttribute('aria-label'),'12-week activity streak. Only you can see this.','the owner-only streak is labelled');
}
async function milestoneChecks(p){
 const row=p.locator('.me-card .me-milestone-row');await row.waitFor();assert.equal(await row.count(),1,'one compact milestone row');assert.equal((await row.locator('.me-milestone-latest > span:not(.vh)').innerText()).trim(),'First 5K','latest occurrence leads without a second privacy label');assert.doesNotMatch(await row.locator('.me-milestone-latest').innerText(),/Only you/,'the milestone row omits privacy noise while the share sheet keeps its Only me reminder');assert.equal(await row.locator('.me-milestone-all').innerText(),'Recent milestones','the separate milestone list is named so it cannot read as another achievement entry');assert((await row.boundingBox()).height<=55,'one quiet line including its separator');
 await row.locator('.me-milestone-latest').click();await p.locator('[data-unified-share]').waitFor();await until(p,()=>document.querySelector('[data-share-image="0"]')?.naturalWidth>0,'milestone share picture');assert(!(await p.locator('[data-share-control=identity]').isChecked()),'identity remains off');assert.match(await p.locator('[data-share-note]').innerText(),/Only me/,'Only-me sharing reminder retained');await p.keyboard.press('Escape');
 await row.locator('.me-milestone-all').click();await p.locator('.sheet').getByRole('heading',{name:'Recent milestones',exact:true}).waitFor();assert.equal(await p.locator('[data-milestone]').count(),2,'Recent milestones opens its own list');await p.locator('[data-milestone]').last().click();await until(p,()=>document.querySelector('[data-share-image="0"]')?.naturalWidth>0,'another offer share picture');await p.keyboard.press('Escape');
 await p.goto(base+'/me/milestones');await p.waitForURL('**/me');await until(p,()=>App.pageReady,'legacy milestone link returns ready Me');await p.locator('.me-card-sections[aria-busy=false]').waitFor();
}
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
 const sizes=compositionOnly?[{width:390,height:844,root:16}]:[{width:320,height:667,root:16},{width:330,height:844,root:16},{width:390,height:844,root:16},{width:430,height:932,root:16},{width:600,height:900,root:16,locale:'fr-FR'}];
 for(const size of sizes)for(const theme of compositionOnly?['light']:['light','dark']){
 const c=await b.newContext({storageState:st,viewport:{width:size.width,height:size.height},locale:size.locale||'en-US',colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
 let cardState='heavy',cardLayout=null,profileHidden=false,refuseOwnerProfile=false;const blocked=new Set(),previewReads=[],statsReads=[],ownerAchievementReads=[],sharedAchievementReads=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.text()==='Service Worker registration blocked by Playwright'||m.text()==='Failed to load resource: net::ERR_FAILED'&&blocked.has(m.location().url))return;if(['error','warning'].includes(m.type()))errors.push(m.text()+' ('+m.location().url+')')});
 await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
 await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base){blocked.add(q.url());return r.abort();}if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
  if(u.pathname==='/api/me'){const response=await r.fetch(),j=await response.json();j.bio='Fictional trails and weekend rides.';if(cardLayout)j.profile_layout=cardLayout;if(cardState==='new'){j.friend_count=0;j.friend_requests=0;j.notifications=0;}return r.fulfill({response,json:j});}
  if(['/api/achievements','/api/achievements/showcase'].includes(u.pathname))(u.searchParams.has('login')?sharedAchievementReads:ownerAchievementReads).push(u.href);
  if(u.pathname==='/api/achievements/showcase')return r.fulfill({json:['jordan','alex'].includes(u.searchParams.get('login'))?friendShowcase:{items:[],pinned:[],day_streak:0}});
  if(u.pathname==='/api/achievements'&&['jordan','alex'].includes(u.searchParams.get('login')))return r.fulfill({json:friendAchievements});
  if(cardState==='new'&&u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:0,friend_requests:0,friend_count:0}});
  if(cardState==='new'&&u.pathname==='/api/goals')return r.fulfill({json:[]});
  if(u.pathname==='/api/stats'){statsReads.push(u.href);const response=await r.fetch(),j=await response.json();j.week_streak=12;return r.fulfill({response,json:j});}
  if(u.pathname==='/api/milestones'){const items=cardState==='heavy'?milestoneOffers:[],id=u.searchParams.get('milestone_id');return r.fulfill({json:{pending:false,items:id?items.filter(m=>m.id===id):items}});}
  if(u.pathname==='/api/people/alex/profile'){
   if(u.searchParams.get('preview')==='member')previewReads.push(u.searchParams.toString());
   const response=await r.fetch(),j=await response.json(),empty=cardState==='new',series=chartFixture(j.mileage.today);
   const memberPreview=u.searchParams.get('preview')==='member';j.profile_hidden=profileHidden;
   if(memberPreview){j.mine=true;j.week_streak=99;j.close_to='PRIVATE-ONLY fictional preview marker';}else if(refuseOwnerProfile)j.mine=false;
   j.overview={...j.overview,activities:empty?0:memberPreview?77:3045,distance_m:empty?0:memberPreview?321000:18968840,time_s:empty?0:memberPreview?7200:5569200,active_days:empty?0:memberPreview?12:468};
   j.recent.current={activities:empty?0:memberPreview?7:32,distance_m:empty?0:memberPreview?18000:259102,time_s:empty?0:memberPreview?1800:78360,active_days:empty?0:memberPreview?4:18};
   j.sports=empty?[]:memberPreview?[{sport:'run',activities:7}]:[{sport:'hike',activities:9},{sport:'swim',activities:8},{sport:'ride',activities:19},{sport:'run',activities:2939},{sport:'walk',activities:70}];
   j.person={...j.person,bio:'Fictional trails and weekend rides.'};if(!memberPreview)j.close_to='One more walk to match last week.';
   // The public-member preview omits private-only current-week activity; the owner view retains the friend-filtered fixture.
   if(memberPreview)series.weeks[11]={...series.weeks[11],distance_m:1200,activities:1,time_s:600};
   j.mileage=series;
   if(cardState!=='heavy'){j.items=[];j.shared_count=0;}if(empty)j.mileage.weeks=[];if(cardState==='tiny'){j.overview=j.recent.current={activities:1,distance_m:0,time_s:1,active_days:1};j.mileage.weeks=[];j.sports=[{sport:'run',activities:1}];}if(cardLayout)j.layout=cardLayout;
   return r.fulfill({response,json:j});
  }
  if(u.pathname==='/api/people/jordan/profile'){
   const response=await r.fetch(),j=await response.json();j.mine=true;j.week_streak=99;j.close_to='PRIVATE-ONLY fictional friend marker';return r.fulfill({response,json:j});
  }
  return r.continue();});
 const shot=async name=>{if(out&&size.root===16&&(size.width===390||(size.width===330&&['profile-friend','profile-preview'].includes(name)))){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${size.width}-${size.root}-${theme}.png`,animations:'disabled'});}};
 const settled=()=>p.waitForSelector('.me-card-sections[aria-busy=false]',{state:'attached',timeout:15000});
 const noOverflow=async where=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no overflow on '+where);

 // Me: the weekly summary stays on the card, with private insights below it.
 await p.goto(base+'/me');await until(p,()=>App.pageReady,'1');await settled();
 if(size.locale){await p.goto(base+'/people/alex');await until(p,()=>App.pageReady,'French full profile');await settled();await numberChecks(p);assert.match(await p.locator('[data-card-stat=time] dt').innerText(),/Time\s*\(h\)/);assert.deepEqual(errors,[]);console.log('French full-profile grouping and labelled hours PASS');await c.close();continue;}
 await weeklyCardChecks(p,size);
 if(size.width===330||size.width===390){
  const previousReads=previewReads.length,previewStats=statsReads.length,previewOwnerAchievements=ownerAchievementReads.length,previewSharedAchievements=sharedAchievementReads.length;await p.locator('[data-card-preview]').click();const previewSheet=p.locator('.sheet');await previewSheet.getByRole('heading',{name:'This is what friends see',exact:true}).waitFor();
  const preview=p.locator('[data-profile-preview]');await preview.locator('.me-card-sections[aria-busy=false]').waitFor();await preview.locator('[data-me-featured][data-loaded="true"]').waitFor();
  assert.equal(previewReads.length,previousReads+1,'View as friend requests the existing member-filtered profile route');assert.match(previewReads.at(-1),/as_friend=true.*preview=member/);
  const previewCard=preview.locator('.me-card');assert.equal(await previewCard.locator('.me-card-figures').count(),1,'preview shows only the profile route’s shared totals');assert.equal(await previewCard.locator('[data-card-edit],[data-card-share],[data-card-preview],[data-person-manage],[data-person-report]').count(),0,'friend preview is read-only');
  assert.equal(await preview.locator('.me-featured-achievements').count(),1,'the preview shares the same Featured block as a friend profile');assert.equal(await preview.locator('.profile-achievement[data-achievement-code]').count(),4,'the preview uses the same medals as the friend profile');
  const medalRange=size.width===330?[56,60]:[68,72],previewMedal=await preview.locator('.profile-achievement-medallion').first().evaluate(n=>n.getBoundingClientRect().width);assert(previewMedal>=medalRange[0]&&previewMedal<=medalRange[1],`preview medal fits the responsive friend size (${previewMedal}px)`);
  const featuredSpacing=await preview.locator('.me-featured-achievements').evaluate(n=>{const heading=n.querySelector('.me-featured-title'),list=n.querySelector('.profile-achievement-list'),first=list.firstElementChild,medal=first.querySelector('.profile-achievement-medallion');return{vertical:first.getBoundingClientRect().top-heading.getBoundingClientRect().bottom,horizontal:parseFloat(getComputedStyle(list).columnGap),medalOverflow:medal.scrollWidth-medal.clientWidth,text:[...first.querySelectorAll('.profile-achievement-name,.profile-achievement-next,.profile-achievement-value,.profile-achievement-level')].map(x=>({className:[...x.classList].find(name=>/^profile-achievement-(name|next|value|level)$/.test(name)),fontSize:parseFloat(getComputedStyle(x).fontSize)}))};});
  assert(featuredSpacing.vertical>=7.98&&featuredSpacing.horizontal>=7.98,`Featured medals keep 8px gaps in the friend preview: ${JSON.stringify(featuredSpacing)}`);assert(featuredSpacing.medalOverflow<=1,`medal labels stay inside their circles: ${JSON.stringify(featuredSpacing)}`);assert(featuredSpacing.text.every(({className,fontSize})=>fontSize>=(className==='profile-achievement-name'?11:className==='profile-achievement-next'?12:10)),`featured labels and values remain readable: ${JSON.stringify(featuredSpacing)}`);
  assert.doesNotMatch(await preview.innerText(),/Only you|PRIVATE-ONLY/,'owner-only labels and ambiguous private fields are absent from the friend preview');
  assert.equal(statsReads.length,previewStats,'View-as-friend never fetches owner weekly stats');assert.equal(ownerAchievementReads.length,previewOwnerAchievements,'View-as-friend never fetches owner achievement endpoints');assert(sharedAchievementReads.slice(previewSharedAchievements).some(url=>url.includes('login=alex')),'View-as-friend fetches the filtered shared achievement payload');
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${size.width}px friend preview has no page overflow`);await shot('profile-preview');if(out&&size.root===16&&(size.width===390||size.width===330)){fs.mkdirSync(out,{recursive:true});await preview.locator('.me-card').screenshot({path:`${out}/profile-preview-card-${size.width}-${size.root}-${theme}.png`,animations:'disabled'});}await p.keyboard.press('Escape');await previewSheet.waitFor({state:'detached'});
 }
 await milestoneChecks(p);
 if(out&&(size.width===330||size.width===390)&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.locator('.me-card').screenshot({path:`${out}/me-card-recent-milestones-${size.width}-${theme}.png`,animations:'disabled'});}
 if(size.width===390)await require('./milestone_picture_ui.cjs')(p,theme,out);
 await p.waitForSelector('.me-insights',{timeout:15000});
 assert.equal(await p.locator('#me-distance, .mileage-heading').count(),0,'no second distance chart on Me');
 assert.equal(await p.locator('.me-form').count(),0,'Fitness & freshness has moved off Me');
 assert.match(await p.locator('.me-insights').innerText(),/This week[\s\S]*of [\d.,]+ (?:mi|km) usual week/);
 const insightRows=p.locator('.me-insight-row');assert(await insightRows.count()>0&&await insightRows.count()<=4,'Me shows only applicable insights, capped at four');
 assert(await insightRows.evaluateAll(rows=>rows.every(row=>row.getAttribute('href')?.startsWith('/progress')&&row.querySelector('.me-insight-copy b')?.textContent.trim()&&row.querySelector('.me-insight-copy small')?.textContent.trim()&&row.querySelector('.me-insight-value')?.textContent.trim())), 'each insight has a title, quiet subtitle, bold right value and Progress destination');
 assert(await insightRows.evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height>=44)),'insight rows retain 44px tap targets');
 const insightGaps=await insightRows.evaluateAll(rows=>rows.slice(1).map((row,i)=>row.getBoundingClientRect().top-rows[i].getBoundingClientRect().bottom));assert(insightGaps.every(gap=>Math.abs(gap-8)<.5),'insight rows keep 8px gaps between tap targets');
 await shot('me-insights');
 assert.equal(await p.locator('.me-card .me-period,.me-distance.days').count(),0,'Days / Weeks and daily bars are removed from Me');
 await p.locator('.me-card a.me-friends-link').click();await p.waitForURL('**/me/friends');await until(p,()=>App.pageReady,'inline friends destination');await p.goto(base+'/me');await until(p,()=>App.pageReady,'Me return');await settled();
 if(size.width===390&&size.root===16&&theme==='light'){
  // Each fictional server-state change starts without a stale offline copy; real save/reload is covered below.
  for(const state of ['new','private','tiny']){
   cardState=state;await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'card state');await settled();assert.equal(await p.locator('.me-card .post').count(),0,'no individual activity details on the card');
   if(state==='new'){
    assert.match(await p.locator('.me-card-empty').innerText(),/totals appear here/);assert.equal(await p.locator('.me-card-figures').count(),0);assert.equal(await p.locator('[data-friend-count]').innerText(),'No friends yet');
    const goal=p.locator('.me-card-empty a[href="/me/goals?new=1"]');assert((await goal.boundingBox()).height>=44);assert.equal(await goal.evaluate(n=>getComputedStyle(n).backgroundColor),"rgba(0, 0, 0, 0)","first Goal is a plain action, without a grey pill");await goal.click();await p.locator('.sheet').getByRole('heading',{name:'New goal',exact:true}).waitFor();await until(p,()=>App.pageReady,'one-tap Goal ready');assert.equal(new URL(p.url()).searchParams.has('new'),false,'auto-open flag consumed');assert(!writes.includes('/api/goals'),'opening does not save a goal');
    await p.locator('.sheet').getByRole('button',{name:'Cancel',exact:true}).click();await p.reload();await until(p,()=>App.pageReady,'Goals reload');assert.equal(await p.locator('.sheet').count(),0,'reload does not reopen Goal add');await p.locator('[data-back]').click();await p.waitForURL('**/me');await until(p,()=>App.pageReady,'Goal returns to Me');await settled();
   }else{assert.equal(await p.locator('.me-card-figures,.me-sport-chips,.me-profile-bio,.me-about').count(),0,'private and tiny fixture totals stay off Me');assert.doesNotMatch(await p.locator('.me-card').innerText(),/3,045|Fictional trails and weekend rides/,'Me omits full-profile figures and bio');}
   assert(await p.locator('[data-me-milestones]').isHidden(),'no empty milestone box');await noOverflow(state);
  }
  cardState='heavy';cardLayout=null;await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});
 }
 await noOverflow('Me');

 // Your profile keeps the established totals, sports and bio; Share retains its audience-filtered profile card.
 await p.goto(base+'/people/alex');await until(p,()=>App.pageReady,'3');await settled();
 await cardChecks(p,size);
 assert.equal(await p.locator('[data-me-milestones]').count(),0,'private milestone row is absent from full profiles');
 assert.equal(await p.locator('.profile-page-title').innerText(),'Your profile');
 assert.equal(await p.locator('#person-profile .me-card-open-link,.me-card .me-profile-chevron').count(),0,'the full profile does not link back to itself');
 assert.equal(await p.locator('#person-profile .me-card [data-card-edit]').count(),1);assert.equal(await p.locator('#person-profile .me-card [data-card-share]').count(),1);
 assert.equal(await p.locator('#pf-card, #pf-edit-profile, #pf-share').count(),0,'old profile parts are gone');
 assert.equal(await p.locator('#person-profile .me-card-row').count(),0,'no link row back to the same page');
 assert.equal(await p.locator('#person-profile .me-week').count(),12,'same distance chart as Me');
 assert((await p.locator('#person-activities .post, #person-activities .card').count())>0,'activities follow the card');
 await p.locator('.me-card-figures[data-card-period=totals]').scrollIntoViewIfNeeded();await shot('profile-all-time-totals');
 await p.locator('#person-profile').evaluate(n=>n.scrollIntoView({block:'start',behavior:'instant'}));await shot('profile-own');
 await p.locator('[data-card-share]').click();const share=p.locator('.sheet');await share.locator('[data-unified-share]').waitFor();
 const preview=share.locator('[data-share-image="0"]');await preview.waitFor({state:'visible'});await p.waitForFunction(()=>{const n=document.querySelector('[data-share-image="0"]');return n?.complete&&n.naturalWidth===1080;});
 const labels=await share.locator('.share-picture-label').allInnerTexts();assert.equal(labels[0],'Me card');assert(!labels.includes('Public link & QR'),'the unrequested public QR picture is omitted');
 assert.equal(await share.locator('[data-share-send]').innerText().then(t=>t.trim()),'Share');assert.equal(await share.locator('[data-share-save]').innerText(),'Save image');
 assert.equal(await share.locator('[data-share-note]').innerText(),'Private workouts count, but stay hidden');assert.match(await share.locator('[data-share-description]').innerText(),/Friends see the totals, not the workouts/);
 assert.equal(await share.locator('[data-card-edit],[data-card-share],.me-card-note').count(),0,'the unified sheet has no nested profile or card controls');
 assert.doesNotMatch(await share.innerText(),/PRIVATE-ONLY|See what others see|Previewing as|View full profile/);if(size.width===390)await shot('profile-share-sheet');
 await p.keyboard.press('Escape');await share.waitFor({state:'detached'}).catch(()=>{});
 profileHidden=true;const visibilityCheck=p.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/people/alex/profile'&&url.searchParams.get('preview')==='member';});await p.locator('[data-card-share]').click();await visibilityCheck;assert.equal(await p.locator('[data-unified-share]').count(),0,'a hidden profile cannot open picture sharing');profileHidden=false;
 // Edit happens in place on the card, exactly as on Me; Cancel leaves everything as it was.
 await p.locator('[data-card-edit]').click();await p.waitForSelector('#person-profile .me-card.editing');
 assert.equal(await p.locator('#person-activities').evaluate(n=>!!n.closest('[inert]')),true,'activities dimmed while editing');
 await p.locator('[data-card-cancel]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'4')
 await noOverflow('own profile');
 if(compositionOnly){const deniedStats=statsReads.length,deniedOwnerAchievements=ownerAchievementReads.length;refuseOwnerProfile=true;await p.goto(base+'/people/alex');await until(p,()=>App.pageReady,'server-denied owner profile');await settled();assert.equal(await p.locator('#person-profile .me-card [data-card-edit]').count(),0,'a URL matching the signed-in account does not override server mine=false');assert.equal(await p.locator('#person-profile .me-card [data-person-report]').count(),1,'server-denial keeps the card in shared viewer mode');assert.equal(statsReads.length,deniedStats,'server-denied owner profile does not fetch owner weekly stats');assert.equal(ownerAchievementReads.length,deniedOwnerAchievements,'server-denied owner profile does not fetch owner achievement endpoints');refuseOwnerProfile=false;}

 // Someone else's profile: the same card; the friendship button and ⋯ sit where Edit and Share are.
 const friendStats=statsReads.length,friendOwnerAchievements=ownerAchievementReads.length,friendSharedAchievements=sharedAchievementReads.length;
 await p.goto(base+'/people/jordan');await until(p,()=>App.pageReady,'6');await settled();await p.locator('#person-profile [data-me-featured][data-loaded="true"]').waitFor();
 if((size.width===330||size.width===390)&&size.root===16){const featured=p.locator('#person-profile .me-featured-achievements');await featured.waitFor();assert.equal(await featured.locator('.profile-achievement[data-achievement-code]').count(),4,'shared profile fixture shows four featured achievements');assert.equal(await featured.locator('h3.me-featured-title > span').first().innerText(),'Featured achievements','the shared profile uses the compact featured section heading');const geometry=await featured.locator('.profile-achievement-list').evaluate(n=>{const r=n.getBoundingClientRect(),card=n.closest('.me-card').getBoundingClientRect(),style=getComputedStyle(n),items=[...n.children].map(x=>({box:x.getBoundingClientRect(),medal:x.querySelector('.profile-achievement-medallion').getBoundingClientRect()}));return{left:r.left-card.left,right:card.right-r.right,display:style.display,columns:style.gridTemplateColumns.split(' ').length,overflow:style.overflowX,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,items:items.map(({box,medal})=>({top:box.top,height:box.height,medal:medal.width}))};});const medalRange=size.width===330?[56,60]:[68,72];assert(geometry.left>=16&&geometry.right>=16&&geometry.display==='grid'&&geometry.columns===4&&geometry.overflow==='visible'&&geometry.scrollWidth<=geometry.clientWidth+1&&geometry.items.every(item=>item.top===geometry.items[0].top&&item.height>=44&&item.medal>=medalRange[0]&&item.medal<=medalRange[1]),`the ${size.width}px friend profile fits four responsive medals in one row: ${JSON.stringify(geometry)}`);}
 assert.equal(await p.locator('.profile-page-title').innerText(),'Profile');
 assert.equal(await p.locator('.me-card-banner [data-person-manage]').count(),1);assert.equal(await p.locator('.me-card-banner [data-person-report]').count(),1);
 assert.equal(await p.locator('.me-card [data-card-edit], .me-card-note').count(),0,'no owner controls or owner note');
 assert.equal(await p.locator('[data-me-milestones]').count(),0,'other people never receive the private row');
 assert.doesNotMatch(await p.locator('#person-profile').innerText(),/Only you|PRIVATE-ONLY/,'friend profile strips ambiguous owner-only fields');assert.equal(statsReads.length,friendStats,'friend profile never fetches owner weekly stats');assert.equal(ownerAchievementReads.length,friendOwnerAchievements,'friend profile never fetches owner achievement endpoints');assert(sharedAchievementReads.slice(friendSharedAchievements).some(url=>url.includes('login=jordan')),'friend profile uses filtered shared achievement endpoints');
 if(compositionOnly){
  const probeShared=sharedAchievementReads.length,probeOwner=ownerAchievementReads.length;
  await p.evaluate(()=>{const root=document.createElement('div');root.id='profile-view-shared-probe';root.innerHTML='<section class="me-card"><div data-me-featured></div></section>';document.body.append(root);ProfileLayout.mount(root,{mine:true,person:{login:'jordan',name:'Jordan Fixture'},layout:{sections:[],stats:['activities'],sports:[]},mileage:{},items:[]},{shared:true});});
  await p.locator('#profile-view-shared-probe [data-me-featured][data-loaded="true"]').waitFor();assert.equal(ownerAchievementReads.length,probeOwner,'explicit shared mode overrides an ambiguous mine=true payload');assert(sharedAchievementReads.slice(probeShared).some(url=>url.includes('login=jordan')),'shared helper consumes its explicit shared option');await p.locator('#profile-view-shared-probe').evaluate(n=>n.remove());
  assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);await c.close();
  const prior=process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY;process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY='1';
  try{await require('./profile_achievements_ui.cjs')({browser:b,storageState:st,base,shots:out});}finally{if(prior===undefined)delete process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY;else process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY=prior;}
  console.log('Profile viewer composition: owner landing/full, friend, preview, ambiguous mine privacy, and empty/off achievement states PASS');await l.close();await b.close();return;
 }
 await shot('profile-friend');
 await p.goto(base+'/people/sam');await until(p,()=>App.pageReady,'7');await settled();
 assert.equal(await p.locator('.me-card-empty a[href^="/me/goals"]').count(),0,'private setup is absent from other people’s cards');
 const approve=p.locator('.me-card-banner [data-person-action="accept"]');assert.equal(await approve.count(),1);assert((await approve.boundingBox()).height>=44);
 await noOverflow('request profile');
 assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);
 console.log(`Profile card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await inlineEditorChecks(b);await require('./me_polish_ui.cjs')({browser:b,storageState:st,base,shots:out});await require('./profile_achievements_ui.cjs')({browser:b,storageState:st,base,shots:out});await b.close();})().catch(e=>{console.error(e);process.exit(1);});

async function inlineEditorChecks(browser){
 const cp=require('node:child_process'),path=require('node:path'),pw='green teapot on the hill';
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_card_editor');person('zz_test_card_other')"],{cwd:path.join(__dirname,'../..'),env:process.env,stdio:'inherit'});
 const auth=await browser.newContext(),login=(c,n)=>c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:n,password:pw}});
 const layout={sections:['recent','mileage','totals','sports','activities'],stats:['activities','distance','time'],sports:[]};
 await login(auth,'zz_test_card_editor');const storage=await auth.storageState();
 try{
 for(const size of [{width:390,height:844,root:16}])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState:storage,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],puts=[];let fail=false,hold=false,held;
  await c.request.put(base+'/api/account',{headers:{Origin:base},data:{name:'River Fixture',bio:'',profile_layout:layout}});
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='PUT'&&u.pathname==='/api/account'){puts.push(q.postDataJSON());if(fail){fail=false;return r.fulfill({status:503,json:{detail:'Fictional save failed'}});}if(hold){held=r;return;}return r.continue();}if(q.method()==='PUT'&&u.pathname==='/api/me/photo')return r.continue();if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();});
  const ready=()=>until(p,()=>App.pageReady,'editor route ready');
  const open=async()=>{await p.locator('[data-card-edit]').click();await p.waitForSelector('.me-card.editing');};
  const close=async()=>{await p.locator('[data-card-cancel]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'editor closed');};
  await p.goto(base+'/me');await ready();await p.waitForSelector('.me-card-sections[aria-busy=false]');await open();
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.show),'totals','Edit pill focuses the first section switch');
  assert(await p.locator('[data-card-save]').isDisabled());assert.equal(await p.locator('#pf-editor,#pf-draft,[data-card-identity],.me-card-actions').count(),0,'old sheet and bottom Save removed');
  assert.equal(await p.locator('[data-show][role=switch]').count(),4);assert(await p.locator('[data-move=totals][data-step="-1"]').isDisabled());assert(await p.locator('[data-move=activities][data-step="1"]').isDisabled());
  const targets=await p.locator('[data-number-period]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));assert(targets.every(r=>r.width>=44&&r.height>=44),'period choices retain 44px targets');assert((targets[1].y>=targets[0].bottom?targets[1].y-targets[0].bottom:targets[1].x-targets[0].right)>=7.98,'period choices retain 8px gaps');
  const card=p.locator('.me-card'),header=p.locator('.me-editor-head');
  assert.equal(await card.locator('.me-card-preview-row').isVisible(),false,'View as friend stays out of the editor layout');
  if(size.root===16){const h=(await card.boundingBox()).height;assert(h<=size.height*1.3,`default editor is compact: ${h}px`);}
  await card.scrollIntoViewIfNeeded();await p.evaluate(()=>scrollTo(0,document.querySelector('.me-card').offsetTop));
  if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/card-editor-default-${theme}.png`});}
  const countBox=await p.locator('[data-card-bio-count]').boundingBox(),bioBox=await p.locator('#card-bio').boundingBox();assert(countBox.y>=bioBox.y+bioBox.height,'bio counter belongs below the bio');
  assert.equal(await p.locator('.me-card-note').count(),0,'privacy explanation stays in the Share sheet, outside the editor card');
  await p.evaluate(()=>scrollBy(0,180));assert((await header.boundingBox()).y<=2,'header remains pinned');
  await p.locator('#card-name').fill('');await p.locator('[data-card-save]').click();assert.match(await p.locator('#card-name-error').innerText(),/1 and 60/);assert.equal(puts.length,0,'empty name writes nothing');
  await p.locator('#card-name').fill('Brook Fixture');await p.locator('#card-bio').fill('Fictional trails and weekend rides.');
  assert.equal(await p.locator('[data-number-period=totals]').getAttribute('aria-pressed'),'true');await p.locator('[data-number-period=recent]').click();
  await p.locator('[data-show=activities]').uncheck();await p.locator('[data-move=recent][data-step="1"]').click();
  await p.locator('[data-stat=time]').click();await p.locator('[data-stat=active_days]').click();await p.locator('[data-sport=run]').click();
  assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  assert.match(await p.locator('[data-card-bio-count]').innerText(),/35\/280/);
  // Cancelling is deliberate; rejecting the dialog retains every draft field and layout choice.
  await p.locator('[data-card-cancel]').click();await p.getByRole('alertdialog',{name:'Discard your changes?'}).waitFor();await p.locator('[data-confirm-cancel]').click();await p.locator('.confirm-sheet').waitFor({state:'detached'});assert(await p.locator('.me-card.editing').count());
  // The existing photo picker opens inside this editor without losing drafts.
  await p.locator('[data-card-photo]').click();await p.waitForSelector('#pp-file',{state:'attached'});const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.fillStyle='#2563eb';g.fillRect(0,0,128,128);return c.toDataURL('image/png').split(',')[1];});await p.locator('#pp-file').setInputFiles({name:'fictional-avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForSelector('.sheet',{state:'detached'});await p.waitForSelector('[data-card-photo] img');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  fail=true;await p.locator('[data-card-save]').click();await until(p,()=>document.querySelector('[data-card-status]')?.textContent.includes('Fictional save failed'),'inline save error');assert(await p.locator('[data-card-status]').isVisible(),'save failure stays under the pinned header');assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert(!(await p.locator('[data-card-save]').isDisabled()));
  await p.locator('[data-card-save]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'save closes editor');await p.waitForSelector('.me-card-name h2');assert.equal(await p.locator('.me-card-name h2').evaluate(n=>n.firstChild.textContent.trim()),'Brook Fixture');
  assert.deepEqual(Object.keys(puts.at(-1)).sort(),['bio','name','profile_layout']);assert.deepEqual(puts.at(-1).profile_layout.sections.filter(k=>k==='recent'||k==='totals'),['recent'],'editor saves exactly one chosen period');
  await p.reload();await ready();assert.equal(await p.locator('.me-card-name h2').evaluate(n=>n.firstChild.textContent.trim()),'Brook Fixture');await open();assert.equal(await p.locator('[data-number-period=recent]').getAttribute('aria-pressed'),'true','chosen period survives reload');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert.equal(await p.locator('.me-edit-row').first().locator('[data-show]').getAttribute('data-show'),'mileage');await close();
  await p.evaluate(()=>go('/me/settings'));await p.waitForURL('**/me/settings');await ready();assert.equal(await p.locator('#m-profile').innerText(),'Edit profile');await p.locator('#m-profile').click();await p.waitForURL('**/me?edit=profile');await p.waitForSelector('.me-card.editing');await until(p,()=>document.activeElement.id==='card-name','Settings focuses Name');assert.equal(await p.locator('#pf-editor').count(),0);await close();await p.waitForURL('**/me');await ready();
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no enlarged-text overflow');
  // A delayed save response cannot update the account or editor that is now signed in.
  await p.waitForSelector('.me-card-sections[aria-busy=false]');await open();await p.locator('#card-name').fill('Delayed Fixture');hold=true;await p.locator('[data-card-save]').click();for(let i=0;i<100&&!held;i++)await p.waitForTimeout(50);assert(held);assert(await p.locator('[data-card-cancel]').isDisabled(),'Cancel cannot discard a pending Save');await p.locator('[data-card-cancel]').evaluate(n=>n.click());assert.equal(await p.locator('.me-card.editing').count(),1);
  await login(c,'zz_test_card_other');await p.evaluate(async()=>refreshMe(await api('/api/me')));await until(p,()=>App.me.login==='zz_test_card_other','new account');const other=await p.evaluate(()=>App.me.name);await held.fulfill({json:{name:'Old response',profile_layout:layout}});await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>App.me.name),other);assert.equal(await p.locator('.me-card.editing').count(),0);
  assert.deepEqual(errors,[]);console.log(`Inline card editor ${size.width}/${size.root} ${theme}: pinned header, height, atomic retry/reload, drafts/cancel, Settings focus and stale account PASS`);await c.close();
 }
 }finally{for(const n of ['zz_test_card_editor','zz_test_card_other']){await login(auth,n);await auth.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}await auth.close();}
}
