// The profile page is the Me card at full size, then the shared activities; the card's distance chart switches between
// days and weeks; Me's private area shows insights instead of a second chart (Ben, 30 Oct 2026). Fictional demo accounts
// (Alex, friend Jordan, Sam waiting for approval). Every write is intercepted, so nothing is saved.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const milestoneOffers=[{id:'22222222-2222-4222-8222-222222222222',kind:'year_distance',title:'100 miles this year',day:'2026-10-31',occurred:'2026-10-31T12:00:00Z',rank:500,private_activity:false,details:{amount:100,unit:'mi',garmin_sources:[]}},{id:'11111111-1111-4111-8111-111111111111',kind:'first_distance',title:'First 5K',day:'2026-11-01',occurred:'2026-11-01T12:00:00Z',rank:10,private_activity:true,details:{distance_m:5000,seconds:1800,sport:'run',garmin_sources:[]}}];
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
 const card=p.locator('.me-card'),figures=card.locator('.me-card-figures');assert.equal(await figures.count(),1,'one period only');assert.equal(await card.locator('table').count(),0,'snapshot has no table');assert.equal(await figures.getAttribute('data-card-period'),period);
 assert.deepEqual(await figures.locator('dt > span').allTextContents(),['Activities','Distance','Time']);assert.equal(await figures.locator('.me-metric-value').count(),3,'three visible headline numbers');assert.match((await figures.locator('dt small').allTextContents()).join(' '),/\((mi|km)\).*\(h\)/,'units stay under the numbers');
 const geometry=await figures.locator('[data-card-stat]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),value=n.querySelector('b').getBoundingClientRect(),label=n.querySelector('dt').getBoundingClientRect(),text=document.createRange();text.selectNodeContents(n.querySelector('b'));return {top:value.top,width:r.width,valueWidth:value.width,labelGap:label.top-value.bottom,contained:value.left>=r.left-.1&&value.right<=r.right+.1,lines:text.getClientRects().length,below:label.top>=value.bottom+3};}));assert(geometry.every(x=>x.contained&&x.lines===1&&x.below),'unbroken values fit, with labels below '+JSON.stringify(geometry));assert(Math.max(...geometry.map(x=>x.top))-Math.min(...geometry.map(x=>x.top))<.1,'all three numbers share one row');
 assert(await figures.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'headline numbers do not scroll');assert.match(await figures.locator('[data-card-stat=time] dd').ariaSnapshot(),period==='recent'?/21h\s*46m/:/1547h/,'precise time remains accessible');if(period==='recent')assert.match(await figures.getAttribute('aria-label'),/Last 30 days, .+ – .+/,'recent range retained');
}
async function cardChecks(p,size){
 const card=p.locator('.me-card');await numberChecks(p);
 const friends=card.locator('a.me-friends-link'),target=await friends.boundingBox();assert(target.width>=44&&target.height>=44);assert.equal(await friends.evaluate(n=>getComputedStyle(n).pointerEvents),'auto','inline friends remains tappable');
 await sportChecks(p);
 if(size.root===16&&size.width>=390){const meta=await card.locator('.me-card-meta').evaluate(n=>[...n.children].map(x=>{const r=x.getBoundingClientRect();return [r.top,r.bottom]}));assert(Math.max(...meta.map(x=>x[0]))<Math.min(...meta.map(x=>x[1])),'friends and handle share a line');}
 const bars=await card.locator('.me-week').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.equal(bars.length,7);assert(bars.every(r=>r.width>=44&&r.height>=44));assert.equal(await card.locator('.me-chart-scroll').evaluate(n=>getComputedStyle(n,'::before').backgroundImage),'none','scroll cue does not fade a bar');
 const padding=await card.evaluate(n=>{const b=n.querySelector('.me-card-body'),r=b.getBoundingClientRect(),s=getComputedStyle(b),rail=n.querySelector('.me-card-bars').getBoundingClientRect();return rail.left>=r.left+parseFloat(s.paddingLeft)-.1&&rail.right<=r.right-parseFloat(s.paddingRight)+.1});assert(padding,'chart rail remains inside card padding');
 const note=card.locator('.me-card-note');assert.match(await note.innerText(),/Private workouts count, but stay hidden/);assert.match(await note.ariaSnapshot(),/Totals include your private workouts\. Friends see the totals, not the workouts\./,"complete privacy explanation reaches the accessibility tree");assert(await note.evaluate(n=>n.scrollWidth<=n.clientWidth+1),"privacy footer fits the card");if(size.width===390&&size.root===16)assert(await note.locator('span[aria-hidden=true]').evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length===1;}),'plain privacy footer remains one line at390');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await note.evaluate(n=>{n.scrollIntoView({block:'end',behavior:'instant'});scrollBy({top:n.getBoundingClientRect().bottom-document.querySelector('nav.tabs').getBoundingClientRect().top+8,behavior:'instant'})});
 const clearance=await note.evaluate(n=>{const r=n.getBoundingClientRect(),nav=document.querySelector('nav.tabs').getBoundingClientRect();return {top:r.top,bottom:r.bottom,navTop:nav.top}});assert(clearance.top>=0&&clearance.bottom<=clearance.navTop-7,'complete privacy note clears the tab bar '+JSON.stringify(clearance));
}
async function milestoneChecks(p){
 const row=p.locator('.me-card .me-milestone-row');await row.waitFor();assert.equal(await row.count(),1,'one compact milestone row');assert.match(await row.locator('.me-milestone-latest').innerText(),/Only you[\s\S]*First 5K/,'latest occurrence leads, independently of rank');assert((await row.boundingBox()).height<=55,'one quiet line including its separator');
 await row.locator('.me-milestone-latest').click();await p.locator('#milestone-picture').waitFor();await until(p,()=>document.querySelector('#milestone-picture')?.naturalWidth>0,'milestone share picture');assert(!(await p.locator('#milestone-identity').isChecked()),'identity remains off');assert(await p.locator('.milestone-private').isVisible(),'Only-me sharing reminder retained');await p.keyboard.press('Escape');
 await row.locator('.me-milestone-all').click();await p.locator('.sheet').getByRole('heading',{name:'Recent milestones',exact:true}).waitFor();assert.equal(await p.locator('[data-milestone]').count(),2,'See all uses a sheet');await p.locator('[data-milestone]').last().click();await until(p,()=>document.querySelector('#milestone-picture')?.naturalWidth>0,'another offer share picture');await p.keyboard.press('Escape');
 await p.goto(base+'/me/milestones');await p.waitForURL('**/me');await until(p,()=>App.pageReady,'legacy milestone link returns ready Me');await p.locator('.me-card-sections[aria-busy=false]').waitFor();
}
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
for(const size of [{width:320,height:667,root:16},{width:390,height:844,root:16},{width:430,height:932,root:16},{width:330,height:667,root:24},{width:600,height:900,root:16,locale:'fr-FR'}])for(const theme of ['light','dark']){
 const c=await b.newContext({storageState:st,viewport:{width:size.width,height:size.height},locale:size.locale||'en-US',colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
 let cardState='heavy',cardLayout=null;const blocked=new Set();
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.text()==='Service Worker registration blocked by Playwright'||m.text()==='Failed to load resource: net::ERR_FAILED'&&blocked.has(m.location().url))return;if(['error','warning'].includes(m.type()))errors.push(m.text()+' ('+m.location().url+')')});
 await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
 await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base){blocked.add(q.url());return r.abort();}if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
  if(u.pathname==='/api/me'&&(cardLayout||cardState==='new')){const response=await r.fetch(),j=await response.json();if(cardLayout)j.profile_layout=cardLayout;if(cardState==='new'){j.friend_count=0;j.friend_requests=0;j.notifications=0;}return r.fulfill({response,json:j});}
  if(cardState==='new'&&u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:0,friend_requests:0,friend_count:0}});
  if(cardState==='new'&&u.pathname==='/api/goals')return r.fulfill({json:[]});
  if(u.pathname==='/api/milestones'){const items=cardState==='heavy'?milestoneOffers:[],id=u.searchParams.get('milestone_id');return r.fulfill({json:{pending:false,items:id?items.filter(m=>m.id===id):items}});}
  if(u.pathname==='/api/people/alex/profile'){
   const response=await r.fetch(),j=await response.json(),empty=cardState==='new';j.overview={...j.overview,activities:empty?0:3045,distance_m:empty?0:18968840,time_s:empty?0:5569200,active_days:empty?0:468};j.recent.current={activities:empty?0:32,distance_m:empty?0:259102,time_s:empty?0:78360,active_days:empty?0:18};j.sports=empty?[]:[{sport:'hike',activities:9},{sport:'swim',activities:8},{sport:'ride',activities:19},{sport:'run',activities:2939},{sport:'walk',activities:70}];if(cardState!=='heavy'){j.items=[];j.shared_count=0;}if(empty)j.mileage.weeks=[];if(cardState==='tiny'){j.overview=j.recent.current={activities:1,distance_m:0,time_s:1,active_days:1};j.mileage.weeks=[];j.sports=[{sport:'run',activities:1}];}if(cardLayout)j.layout=cardLayout;return r.fulfill({response,json:j});
  }return r.continue();});
 const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${theme}.png`});}};
 const settled=()=>p.waitForSelector('.me-card-sections[aria-busy=false]',{state:'attached',timeout:15000});
 const noOverflow=async where=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no overflow on '+where);

 // Me: one distance chart (on the card), private insights below the line.
 await p.goto(base+'/me');await until(p,()=>App.pageReady,'1');await settled();
 if(size.locale){assert.match(await p.locator('[data-card-stat=time] b').innerText(),/^1[\u00a0\u202f]547$/,'locale grouping retained');assert.match(await p.locator('[data-card-stat=time] dt').innerText(),/Time\s*\(h\)/);assert.deepEqual(errors,[]);console.log('French snapshot grouping and labelled hours PASS');await c.close();continue;}
 await cardChecks(p,size);
 if(size.width===390&&theme==='light'){await p.setViewportSize({width:600,height:844});await until(p,()=>document.querySelectorAll('.me-sport-chip:not([hidden])').length===3,'wide row caps at three');await sportChecks(p);await p.setViewportSize({width:330,height:844});await sportChecks(p);await p.setViewportSize({width:390,height:844});await until(p,()=>document.querySelectorAll('.me-sport-chip:not([hidden])').length===3,'sports recover on wider phone');await sportChecks(p);}
 await milestoneChecks(p);
 if(size.width===390)await require('./milestone_picture_ui.cjs')(p,theme,out);
 await p.waitForSelector('.me-insights',{timeout:15000});
 assert.equal(await p.locator('#me-distance, .mileage-heading').count(),0,'no second distance chart on Me');
 assert.match(await p.locator('.me-insights').innerText(),/This week so far[\s\S]*of your usual/);
 assert.equal(await p.locator('.me-insights a[href^="/progress"]').count(),1);
 // The week bar is drawn to scale inside its track (not squashed to a sliver).
 const [bar,track]=await p.$$eval('.me-insights .track, .me-insights .track .bar',e=>e.map(x=>x.getBoundingClientRect().width).reverse());assert(track>100&&bar<=track,'week track spans the card');
 // Days / Weeks on the card: seven bars either way, days carry weekday letters, a tap shows that day.
 const toggle=p.locator('.me-card .me-period [data-period="days"]');assert((await toggle.boundingBox()).height>=44,'44px toggle target');
 await toggle.click();await p.waitForSelector('.me-distance.days');
 assert.equal(await p.locator('.me-distance .me-week').count(),7);assert.equal(await p.locator('.me-distance .me-week i').count(),7,'weekday letters');
 assert.match(await p.locator('[data-week-label] span').innerText(),/This week/i);
 await p.locator('.me-distance .me-week.now').click();assert.match(await p.locator('[data-week-label] span').innerText(),/\d/,'tapped day shows its date');
 await p.locator('.me-card').scrollIntoViewIfNeeded();await shot('me-card-days');
 await p.locator('.me-card .me-period [data-period="weeks"]').click();await until(p,()=>!document.querySelector('.me-distance.days'),'2')
 assert.equal(await p.locator('.me-distance .me-week i').count(),0);
 await p.locator('.me-card a.me-friends-link').click();await p.waitForURL('**/me/friends');await until(p,()=>App.pageReady,'inline friends destination');await p.goto(base+'/me');await until(p,()=>App.pageReady,'Me return');await settled();
 if(size.root===24){
  // Each fictional server-state change starts without a stale offline copy; real save/reload is covered below.
  for(const state of ['new','private','tiny']){
   cardState=state;await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'card state');await settled();assert.equal(await p.locator('.me-card .post').count(),0,'no individual activity details on the card');
   if(state==='new'){
    assert.match(await p.locator('.me-card-empty').innerText(),/totals appear here/);assert.equal(await p.locator('.me-card-figures').count(),0);assert.equal(await p.locator('[data-friend-count]').innerText(),'No friends yet');
    const goal=p.locator('.me-card-empty a[href="/me/goals?new=1"]');assert((await goal.boundingBox()).height>=44);assert.equal(await goal.evaluate(n=>getComputedStyle(n).backgroundColor),"rgba(0, 0, 0, 0)","first Goal is a plain action, without a grey pill");await goal.click();await p.locator('.sheet').getByRole('heading',{name:'New goal',exact:true}).waitFor();await until(p,()=>App.pageReady,'one-tap Goal ready');assert.equal(new URL(p.url()).searchParams.has('new'),false,'auto-open flag consumed');assert(!writes.includes('/api/goals'),'opening does not save a goal');
    await p.locator('.sheet').getByRole('button',{name:'Cancel',exact:true}).click();await p.reload();await until(p,()=>App.pageReady,'Goals reload');assert.equal(await p.locator('.sheet').count(),0,'reload does not reopen Goal add');await p.locator('[data-back]').click();await p.waitForURL('**/me');await until(p,()=>App.pageReady,'Goal returns to Me');await settled();
   }else if(state==='private'){assert.match((await p.locator('.me-card-figures[data-card-period=totals] .me-metric-value').allTextContents()).join(' '),/3,045/);assert.equal(await p.locator('.me-card-row').count(),0,'private aggregates do not add a redundant shared-count row');}else{const time=p.locator('[data-card-stat=time] b');assert.deepEqual(await time.allTextContents(),['<0.01'],'positive short durations do not become zero');assert.match(await time.first().locator('..').ariaSnapshot(),/01s/,'precise short duration retained');}
   assert(await p.locator('[data-me-milestones]').isHidden(),'no empty milestone box');await noOverflow(state);
  }
  cardState='heavy';cardLayout={sections:['totals','sports','recent'],stats:['time','active_days'],sports:['hike','run']};await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'custom card');await settled();
  assert.deepEqual(await p.locator('.me-card-sections > .me-card-sec').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardPeriod||'sports')),['totals','sports'],'legacy duplicate period becomes one numbers section');
  assert.deepEqual((await p.locator('.me-card-figures dt').allTextContents()).map(s=>s.replace(' (h)','')),['Time','Active days']);assert.deepEqual(await p.locator('.me-sport-ico').evaluateAll(nodes=>nodes.map(n=>n.dataset.sport)),['hike','run']);assert.equal(await p.locator('.me-distance,.me-card-row').count(),0,'hidden sections stay hidden');
  assert.equal(await p.locator('.me-sport-chip:visible').count(),2,'saved sport order remains fully visible when it fits');assert(await p.locator('.me-sport-more').isHidden());
  cardLayout={sections:['recent','sports'],stats:['activities','distance','time'],sports:[]};await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'recent-only layout');await settled();await numberChecks(p,'recent');assert.equal(await p.locator('[data-card-stat=activities] b').innerText(),'32');
  cardLayout={sections:['totals','recent'],stats:['active_days'],sports:[]};await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'legacy periods');await settled();assert.equal(await p.locator('.me-card-figures').count(),1);assert.equal(await p.locator('.me-card-figures').getAttribute('data-card-period'),'totals');assert.equal(await p.locator('.me-card-figures dt').innerText(),'Active days');
  cardLayout={sections:[],stats:['time'],sports:[]};await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});await p.reload();await until(p,()=>App.pageReady,'identity-only card');await settled();assert.equal(await p.locator('.me-card-sec,.me-card-row').count(),0,'identity-only choice retained');await noOverflow('saved choices');cardLayout=null;await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('fit.c:'))localStorage.removeItem(k)});
 }
 await noOverflow('Me');

 // Your profile: the same card with Edit / Share pills, a slim preview switch, then the activities. No separate
 // Public card link; the card stays one tap inside Share.
 await p.goto(base+'/people/alex');await until(p,()=>App.pageReady,'3');await settled();
 await cardChecks(p,size);
 assert.equal(await p.locator('[data-me-milestones]').count(),0,'private milestone row is absent from full profiles');
 assert.equal(await p.locator('.profile-page-title').innerText(),'Your profile');
 assert.equal(await p.locator('#person-profile .me-card [data-card-edit]').count(),1);assert.equal(await p.locator('#person-profile .me-card [data-card-share]').count(),1);
 assert.equal(await p.locator('#pf-card, #pf-edit-profile, #pf-share, .profile-progress, .profile-mileage').count(),0,'old profile parts are gone');
 assert.equal(await p.locator('#person-profile .me-card-row').count(),0,'no link row back to the same page');
 assert.equal(await p.locator('#person-profile .me-week').count(),7,'same distance chart as Me');
 assert((await p.locator('#person-activities .post, #person-activities .card').count())>0,'activities follow the card');
 await shot('profile-own');
 await p.locator('[data-card-share]').click();const share=p.locator('.sheet');await share.waitFor();
 assert.match(await share.innerText(),/Public card/);assert.equal(await share.locator('[data-card-preview]').count(),1);assert.equal(await share.locator('[data-card-preview]').innerText(),'See what others see');assert.doesNotMatch(await share.innerText(),/View full profile/);
 await p.keyboard.press('Escape');await share.waitFor({state:'detached'}).catch(()=>{});
 // Edit happens in place on the card, exactly as on Me; Cancel leaves everything as it was.
 await p.locator('[data-card-edit]').click();await p.waitForSelector('#person-profile .me-card.editing');
 assert.equal(await p.locator('#person-activities').evaluate(n=>!!n.closest('[inert]')),true,'activities dimmed while editing');
 await p.locator('[data-card-cancel]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'4')
 await p.locator('[data-card-share]').click();await p.locator('[data-card-preview]').click();await until(p,()=>new URLSearchParams(location.search).get('preview')==='friend','Friends preview');await settled();assert.match(await p.locator('.profile-preview-bar').innerText(),/Previewing as Friends/);assert.equal(await p.locator('[data-card-edit],[data-card-share],.me-card-note,#person-sport').count(),0,'preview contains only the audience projection');
 await p.locator('[data-audience="member"]').click();await until(p,()=>new URLSearchParams(location.search).get('preview')==='member','member preview');await settled();await p.locator('.profile-preview-bar').scrollIntoViewIfNeeded();await shot('profile-own-preview');await p.locator('[data-audience="you"]').click();await until(p,()=>!new URLSearchParams(location.search).has('preview'),'preview Done');await settled();assert.equal(await p.locator('.profile-preview-bar').count(),0);
 await noOverflow('own profile');

 // Someone else's profile: the same card; the friendship button and ⋯ sit where Edit and Share are.
 await p.goto(base+'/people/jordan');await until(p,()=>App.pageReady,'6');await settled();
 assert.equal(await p.locator('.profile-page-title').innerText(),'Profile');
 assert.equal(await p.locator('.me-card-banner [data-person-manage]').count(),1);assert.equal(await p.locator('.me-card-banner [data-person-report]').count(),1);
 assert.equal(await p.locator('.me-card [data-card-edit], .me-card-note').count(),0,'no owner controls or owner note');
 assert.equal(await p.locator('[data-me-milestones]').count(),0,'other people never receive the private row');
 await shot('profile-friend');
 await p.goto(base+'/people/sam');await until(p,()=>App.pageReady,'7');await settled();
 assert.equal(await p.locator('.me-card-empty a[href^="/me/goals"]').count(),0,'private setup is absent from other people’s cards');
 const approve=p.locator('.me-card-banner [data-person-action="accept"]');assert.equal(await approve.count(),1);assert((await approve.boundingBox()).height>=44);
 await noOverflow('request profile');
 assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);
 console.log(`Profile card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await inlineEditorChecks(b);await require('./me_polish_ui.cjs')({browser:b,storageState:st,base});await b.close();})().catch(e=>{console.error(e);process.exit(1);});

async function inlineEditorChecks(browser){
 const cp=require('node:child_process'),path=require('node:path'),pw='green teapot on the hill';
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_card_editor');person('zz_test_card_other')"],{cwd:path.join(__dirname,'../..'),env:process.env,stdio:'inherit'});
 const auth=await browser.newContext(),login=(c,n)=>c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:n,password:pw}});
 const layout={sections:['recent','mileage','totals','sports','activities'],stats:['activities','distance','time'],sports:[]};
 await login(auth,'zz_test_card_editor');const storage=await auth.storageState();
 try{
 for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
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
  if(size.root===16){const h=(await card.boundingBox()).height;assert(h<=size.height*1.3,`default editor is compact: ${h}px`);}
  await card.scrollIntoViewIfNeeded();await p.evaluate(()=>scrollTo(0,document.querySelector('.me-card').offsetTop));
  if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/card-editor-default-${theme}.png`});}
  const countBox=await p.locator('[data-card-bio-count]').boundingBox(),bioBox=await p.locator('#card-bio').boundingBox();assert(countBox.y>=bioBox.y+bioBox.height,'bio counter belongs below the bio');
  await p.evaluate(()=>{const note=document.querySelector('.me-card-note');scrollTo(0,note.getBoundingClientRect().bottom+scrollY-innerHeight*.6);});const noteBox=await p.locator('.me-card-note').boundingBox(),navBox=await p.locator('nav.tabs').boundingBox();assert(noteBox.y+noteBox.height<navBox.y-8,'privacy note scrolls fully above navigation');if(out&&size.root===16)await p.screenshot({path:`${out}/card-editor-bottom-${theme}.png`});
  await p.evaluate(()=>scrollBy(0,180));assert((await header.boundingBox()).y<=2,'header remains pinned');
  await p.locator('#card-name').fill('');await p.locator('[data-card-save]').click();assert.match(await p.locator('#card-name-error').innerText(),/1 and 60/);assert.equal(puts.length,0,'empty name writes nothing');
  await p.locator('#card-name').fill('Brook Fixture');await p.locator('#card-bio').fill('Fictional trails and weekend rides.');
  assert.equal(await p.locator('[data-number-period=totals]').getAttribute('aria-pressed'),'true');await p.locator('[data-number-period=recent]').click();
  await p.locator('[data-show=activities]').uncheck();await p.locator('[data-move=recent][data-step="1"]').click();
  await p.locator('[data-stat=time]').click();await p.locator('[data-stat=active_days]').click();await p.locator('[data-sport=run]').click();
  assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  assert.match(await p.locator('[data-card-bio-count]').innerText(),/35\/280/);
  // Cancelling is deliberate; rejecting the dialog retains every draft field and layout choice.
  p.once('dialog',async d=>{assert.equal(d.message(),'Discard your changes?');await d.dismiss();});await p.locator('[data-card-cancel]').click();assert(await p.locator('.me-card.editing').count());
  // The existing photo picker opens inside this editor without losing drafts.
  await p.locator('[data-card-photo]').click();await p.waitForSelector('#pp-file',{state:'attached'});const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.fillStyle='#2563eb';g.fillRect(0,0,128,128);return c.toDataURL('image/png').split(',')[1];});await p.locator('#pp-file').setInputFiles({name:'fictional-avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForSelector('.sheet',{state:'detached'});await p.waitForSelector('[data-card-photo] img');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  fail=true;await p.locator('[data-card-save]').click();await until(p,()=>document.querySelector('[data-card-status]')?.textContent.includes('Fictional save failed'),'inline save error');assert(await p.locator('[data-card-status]').isVisible(),'save failure stays under the pinned header');assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert(!(await p.locator('[data-card-save]').isDisabled()));
  await p.locator('[data-card-save]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'save closes editor');await p.waitForSelector('.me-card-name h2');assert.equal(await p.locator('.me-card-name h2').innerText(),'Brook Fixture');
  assert.deepEqual(Object.keys(puts.at(-1)).sort(),['bio','name','profile_layout']);assert.deepEqual(puts.at(-1).profile_layout.sections.filter(k=>k==='recent'||k==='totals'),['recent'],'editor saves exactly one chosen period');
  await p.reload();await ready();assert.equal(await p.locator('.me-card-name h2').innerText(),'Brook Fixture');await open();assert.equal(await p.locator('[data-number-period=recent]').getAttribute('aria-pressed'),'true','chosen period survives reload');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert.equal(await p.locator('.me-edit-row').first().locator('[data-show]').getAttribute('data-show'),'mileage');await close();
  await p.evaluate(()=>go('/me/settings'));await p.waitForURL('**/me/settings');await ready();assert.equal(await p.locator('#m-profile').innerText(),'Edit profile');await p.locator('#m-profile').click();await p.waitForURL('**/me?edit=profile');await p.waitForSelector('.me-card.editing');await until(p,()=>document.activeElement.id==='card-name','Settings focuses Name');assert.equal(await p.locator('#pf-editor').count(),0);await close();await p.waitForURL('**/me');await ready();
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no enlarged-text overflow');
  // A delayed save response cannot update the account or editor that is now signed in.
  await p.waitForSelector('.me-card-sections[aria-busy=false]');await open();await p.locator('#card-name').fill('Delayed Fixture');hold=true;await p.locator('[data-card-save]').click();for(let i=0;i<100&&!held;i++)await p.waitForTimeout(50);assert(held);assert(await p.locator('[data-card-cancel]').isDisabled(),'Cancel cannot discard a pending Save');await p.locator('[data-card-cancel]').evaluate(n=>n.click());assert.equal(await p.locator('.me-card.editing').count(),1);
  await login(c,'zz_test_card_other');await p.evaluate(async()=>refreshMe(await api('/api/me')));await until(p,()=>App.me.login==='zz_test_card_other','new account');const other=await p.evaluate(()=>App.me.name);await held.fulfill({json:{name:'Old response',profile_layout:layout}});await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>App.me.name),other);assert.equal(await p.locator('.me-card.editing').count(),0);
  assert.deepEqual(errors,[]);console.log(`Inline card editor ${size.width}/${size.root} ${theme}: pinned header, height, atomic retry/reload, drafts/cancel, Settings focus and stale account PASS`);await c.close();
 }
 }finally{for(const n of ['zz_test_card_editor','zz_test_card_other']){await login(auth,n);await auth.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}await auth.close();}
}
