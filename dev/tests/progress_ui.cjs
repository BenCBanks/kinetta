// Real fictional accounts and real overview responses. No production data or AI/provider calls.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,project=process.env.KINETTA_PROJECT||'kinettatest';
function setProgressFlags(enabled){const value=enabled?'true':'false';cp.execFileSync('docker',['compose','-p',project,'exec','-T','db','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-At'],{input:`INSERT INTO feature_switches (name, enabled) VALUES ('progress_calendar', ${value}), ('progress_segments', ${value}) ON CONFLICT (name) DO UPDATE SET enabled=EXCLUDED.enabled;\n`,encoding:'utf8'});}
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,...(typeof App==='undefined'?{}:{key:App.page?.key,ready:App.pageReady}),body:document.body.textContent.slice(0,200)}))));}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'test_progress_overview.py')],{env:{...process.env,KINETTA_KEEP_PROGRESS:'1'},stdio:'inherit'});
 const b=await chromium.launch(),cleanup=[];
 try{
 setProgressFlags(false);
 const offLogin=await b.newContext(),offSigned=await offLogin.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_overview_runner',password:'green teapot on the hill'}});assert.equal(offSigned.status(),200,'feature-flag fixture login: '+await offSigned.text());
 const offState=await offLogin.storageState(),offRows=await offLogin.request.get(base+'/api/activities?limit=100').then(r=>r.json()),offActivity=offRows.find(a=>a.line);assert(offActivity,'feature-flag fixture needs a GPS activity');
 for(const theme of ['light','dark']){
  const c=await b.newContext({storageState:offState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:0,friend_requests:0,friend_count:0}});if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();});
  const ready=()=>until(p,()=>typeof App!=='undefined'&&App.pageReady&&App.page?.key===location.pathname+location.search,'feature flags ready');
  await p.goto(base+'/progress');await ready();await p.waitForSelector('#p-explore a');assert.deepEqual(await p.evaluate(()=>App.me.feature_flags),{progress_calendar:false,progress_segments:false});assert.equal(await p.locator('#p-explore a').count(),6,'disabled Progress features have no tiles');assert.equal(await p.locator('[data-progress-feature="calendar"],[data-progress-feature="segments"]').count(),0,'disabled Progress features have no links');
  if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-${theme}.png`,fullPage:true});}
  await p.goto(base+'/me/sharing');await ready();assert.equal(await p.locator('#sh-segments').count(),0,'disabled Segments has no Sharing & privacy settings row');assert.equal(await p.getByText('Segment leaderboards',{exact:true}).count(),0,'disabled Segment settings are absent from the page');
  await p.goto(base+'/me/explore');await ready();assert.equal(await p.locator('#guide-results summary b').filter({hasText:/^Calendar$/}).count(),0,'disabled Calendar has no Me guide entry');
  for(const path of ['/progress/calendar?month=2026-10','/progress/segments','/progress?view=calendar','/progress?view=segments','/segments/123','/segments/new','/segments/review']){await p.goto(base+path);await ready();assert.equal(new URL(p.url()).pathname,'/progress',path+' redirects to Progress when disabled');}
  await p.goto(base+'/activity/'+offActivity.id);await ready();assert.equal(await p.locator('#d-segments').count(),0,'disabled Segments has no activity-detail card');if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/activity-detail-${theme}.png`,fullPage:true});}assert.deepEqual(errors,[]);await c.close();
 }
 await offLogin.close();setProgressFlags(true);
 const onContext=await b.newContext({storageState:offState,viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),onPage=await onContext.newPage(),onErrors=[];
 onPage.on('pageerror',e=>onErrors.push(e.message));await onContext.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:0,friend_requests:0,friend_count:0}});if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();});
 const onReady=()=>until(onPage,()=>typeof App!=='undefined'&&App.pageReady&&App.page?.key===location.pathname+location.search,'enabled feature flags ready');
 await onPage.goto(base+'/progress');await onReady();await onPage.waitForSelector('#p-explore a');assert.deepEqual(await onPage.evaluate(()=>App.me.feature_flags),{progress_calendar:true,progress_segments:true});assert.equal(await onPage.locator('#p-explore a').count(),8,'enabled Progress features return');assert.equal(await onPage.locator('[data-progress-feature="calendar"],[data-progress-feature="segments"]').count(),2,'enabled Progress links return');
 for(const path of ['/progress/calendar','/progress/segments']){await onPage.goto(base+path);await onReady();assert.equal(new URL(onPage.url()).pathname,path,path+' opens when enabled');}
 await onPage.goto(base+'/activity/'+offActivity.id);await onReady();assert.equal(await onPage.locator('#d-segments').count(),1,'enabled Segments returns to activity detail');
 await onPage.goto(base+'/me/sharing');await onReady();assert.equal(await onPage.locator('#sh-segments').count(),1,'enabled Segment leaderboards return to Sharing & privacy');
 await onPage.goto(base+'/me/explore');await onReady();assert.equal(await onPage.locator('#guide-results summary b').filter({hasText:/^Calendar$/}).count(),1,'enabled Calendar returns to the Me guide');assert.deepEqual(onErrors,[]);await onContext.close();
 for(const who of ['empty','runner','food']){
  const login=await b.newContext();const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_overview_'+who,password:'green teapot on the hill'}});assert.equal(signed.status(),200,'fixture login: '+await signed.text());cleanup.push(login);
  const overviewResponse=await login.request.get(base+'/api/progress/overview');assert.equal(overviewResponse.status(),200,'fixture date: '+await overviewResponse.text());let overviewFixture=await overviewResponse.json(),fixtureToday=overviewFixture.today;assert.match(fixtureToday,/^\d{4}-\d{2}-\d{2}$/,'fixture exposes its account-local current date');
  if(who==='runner'){
   assert(overviewFixture.record?.start_time,'runner fixture provides its dated 5K record');
   assert.equal(new Date(overviewFixture.record.start_time).toLocaleDateString('sv-SE',{timeZone:'Pacific/Kiritimati'}),fixtureToday,'backend record matches its original UTC+14 account day');
   const timezoneUpdate=await login.request.put(base+'/api/profile',{headers:{Origin:base},data:{tz:'UTC'}});assert.equal(timezoneUpdate.status(),200,'browser fixture uses UTC so Records and Pace share a timezone');
   const utcOverview=await login.request.get(base+'/api/progress/overview');assert.equal(utcOverview.status(),200,'UTC fixture date: '+await utcOverview.text());overviewFixture=await utcOverview.json();fixtureToday=overviewFixture.today;
  }
  const state=await login.storageState();
  for(const size of [{width:390,height:844,root:16}])for(const theme of ['light','dark']){
   if(process.env.KINETTA_PROGRESS_CASE&&process.env.KINETTA_PROGRESS_CASE!==`${who}-${size.width}-${theme}`)continue;
   const c=await b.newContext({storageState:state,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];let notificationCount=0;
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:notificationCount,friend_requests:0,friend_count:0}});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>typeof App!=='undefined'&&App.pageReady&&App.page?.key===location.pathname+location.search,'ready');
   const home=async()=>{if(p.url()==='about:blank')await p.goto(base+'/progress');else await p.evaluate(()=>go('/progress'));await p.waitForURL(base+'/progress');await ready();await p.waitForSelector('#p-explore a');};
   const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-${who}-${name}-${theme}.png`,fullPage:true});}};
   const fits=async label=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),label+' has no overflow');
   await home();assert.equal(await p.locator('h1').innerText(),'Progress');
   if(size.width===390&&size.root===16){
    for(const [count,label] of [[1,'one'],[10,'many'],[0,'none']]){
     notificationCount=count;await p.evaluate(()=>{Social.at=0;Social.refresh();});
     await until(p,n=>{const dot=document.querySelector('.bell-dot');return dot&&(n===0?dot.hidden:!dot.hidden&&dot.textContent.trim()===(n>9?'9+':String(n)))&&document.querySelector('.bell')?.getAttribute('aria-label')===`Notifications${n?`, ${n} new`:''}`;},'live notification badge '+label,count);
     const geometry=await p.locator('.bell').evaluate(link=>{const a=link.getBoundingClientRect(),i=link.querySelector('svg').getBoundingClientRect(),d=link.querySelector('.bell-dot').getBoundingClientRect();return{button:{x:a.x,y:a.y,width:a.width,height:a.height},icon:{left:i.left,right:i.right,top:i.top,bottom:i.bottom},badge:{x:d.x,y:d.y,width:d.width,height:d.height,hidden:link.querySelector('.bell-dot').hidden},overlap:{x:Math.min(i.right,d.right)-Math.max(i.left,d.left),y:Math.min(i.bottom,d.bottom)-Math.max(i.top,d.top)}};});
     assert(geometry.button.width>=44&&geometry.button.height>=44,'bell remains a 44px target');
     if(count){assert.equal(geometry.badge.width,count>9?22:18,'badge stays compact for one or many unread items');assert.equal(geometry.badge.height,18);assert(Math.abs(geometry.overlap.x-4)<.5&&Math.abs(geometry.overlap.y-4)<.5,'badge covers only the bell glyph corner');assert(Math.abs(geometry.badge.y-(geometry.button.y-2))<.5,'badge sits above the bell’s upper edge');assert(Math.abs(geometry.badge.x+geometry.badge.width-(geometry.button.x+geometry.button.width+(count>9?6:2)))<.5,'badge sits at the bell’s upper-right corner');}
     if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-bell-${label}-${theme}.png`,clip:{x:0,y:0,width:390,height:115}});}
    }
   }
   assert(await p.locator('.progress-summary h2').evaluateAll(nodes=>nodes.every(n=>{const r=document.createRange();r.selectNodeContents(n);const ink=r.getBoundingClientRect(),card=n.closest('.card').getBoundingClientRect();return ink.left>=card.left-1&&ink.right<=card.right+1;})),'Progress card headings fit inside their cards');assert.equal(await p.locator('.progress-focus, .view-nav, .pbar').count(),0,'no global control rows');
   assert.equal(await p.locator('#p-explore a').count(),8);assert.equal(await p.locator('.progress-food-summary').count(),who==='food'?1:0);assert.equal(await p.locator('[data-progress-feature=weight]').count(),1,'Weight is always discoverable');assert.equal(await p.locator('[data-progress-feature=weight]').getAttribute('href'),'/progress/weight');assert.match(await p.locator('[data-progress-feature=weight]').innerText(),who==='food'?/latest/:/first weigh-in/);
   assert.equal(await p.locator('#p-sport').evaluate(n=>!!n.closest('.card')),true,'sport inside the chart card');
   for(const btn of await p.locator('[data-progress-period]').all())assert((await btn.boundingBox()).height>=44);
   assert.equal(await p.locator('[data-progress-metric]').count(),3,'Run totals offer Distance, Time and Pace');assert.equal(await p.locator('[data-progress-metric="distance"]').getAttribute('aria-pressed'),'true','Distance remains the default metric');
   for(const btn of await p.locator('[data-progress-metric]').all())assert((await btn.boundingBox()).height>=44,'metric choices keep 44px targets');
   if(who==='empty'){assert.equal(await p.locator('[data-progress-table]').count(),0,'empty Totals has no dead Table action');assert(!/0 (activities mapped|loops|segment bests)/.test(await p.locator('#p-explore').innerText()));assert.equal(await p.locator('.progress-new:not(.seen)').count(),8);}
   if(who==='runner'){
    assert.match(await p.locator('#p-explore a').first().innerText(),/Heatmap[\s\S]*2 activities mapped/);assert.equal(await p.locator('[data-progress-feature="heatmap"] .progress-new:not(.seen)').count(),0);assert.match(await p.locator('[data-progress-record]').innerText(),/5K/);
    const record=overviewFixture.record;assert(record?.start_time,'runner fixture provides its dated 5K record');
    const recordDay=await p.evaluate(start=>new Date(start).toLocaleDateString('sv-SE',{timeZone:App.me.tz}),record.start_time);assert(recordDay<=fixtureToday,`record date is not after the account-local Progress fixture day: ${recordDay} <= ${fixtureToday}`);
    const expected=await p.evaluate(start=>new Date(start).toLocaleDateString([],{timeZone:App.me.tz,month:'short',day:'numeric',year:'numeric'}),record.start_time);
    assert.equal((await p.locator('[data-progress-record] small').innerText()).trim(),expected,'Records card uses the matching account-local fixture date');
   }
   if(who==='food'){assert.match(await p.locator('[data-progress-food]').innerText(),/Protein goal 1 of 7 days.*weight/);}
   if(size.root===16){const height=(await p.locator('#p-home-totals .card').first().boundingBox()).height;assert(height<=(who==='empty'||who==='food'?150:330),'compact totals: '+height);assert.equal(await p.locator('.progress-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2);if(who==='runner')assert.match(await p.locator('[data-progress-fitness]').innerText(),/(Fresh|Tired|Training steadily)[\s\S]*estimate/);assert.equal(await p.locator('#p-home-totals .legend').isVisible().catch(()=>false),false,'home average is labelled once');}
   if(who==='runner')await until(p,()=>document.querySelectorAll('#p-home-totals .stats3 .stat>b').length===3,'three loaded overview values');
   const metricY=await p.locator('#p-home-totals .stats3 .stat>b').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().top));if(metricY.length>1)assert(Math.max(...metricY)-Math.min(...metricY)<=2,'summary metric values share one baseline');
   await fits('home');await shot('home');
   await p.locator('[data-progress-period="month"]').click();await ready();assert.equal(await p.locator('[data-progress-period="month"]').getAttribute('aria-pressed'),'true');
   await p.locator('#p-sport').click();await p.locator('[data-pk="all"]').click();await ready();assert.equal(await p.evaluate(()=>localStorage.getItem('fit.psport')),'all');
   if(who==='runner'){
    await until(p,()=>document.querySelector('#m-chart .distance-column[role="button"]'),'all sports distance chart');
    assert(await p.locator('#m-chart .distance-column[role="button"]').count(),'all sports uses the distance chart');
    await p.locator('#p-sport').click();await p.locator('[data-pk="run"]').click();await ready();
    await p.waitForSelector('#m-chart .period-column');
   }
   assert.equal(await p.locator('.progress-totals-title').getAttribute('href'),null,'Totals is on Progress, with no second page');
   if(who==='runner'){
    const table=p.locator('#m-table'),toggle=p.locator('[data-progress-table]'),chart=p.locator('#m-chart');
    assert(await toggle.evaluate(n=>!!n.closest('#p-home-totals .card')),'Table action stays inside Totals');
    const placement=await toggle.evaluate(n=>{const r=n.getBoundingClientRect(),chart=document.querySelector('#m-chart').getBoundingClientRect(),card=n.closest('.card').getBoundingClientRect();return {width:r.width,height:r.height,gap:r.left-chart.right,bottom:r.bottom,chartBottom:chart.bottom,inside:r.left>=card.left&&r.right<=card.right};});
    assert(placement.inside&&placement.width>=44&&placement.height>=44&&placement.gap>=8&&Math.abs(placement.bottom-placement.chartBottom)<2,'Table stays at chart bottom-right without another row');
    assert(await table.isHidden());await toggle.click();assert(await table.isVisible());assert(await chart.isHidden());assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert(await table.locator('tbody tr').count()>0);await fits('open Totals table');
    await p.evaluate(async()=>{const totals=document.querySelector('#p-home-totals');await pMileage(totals,new URLSearchParams(location.search),{home:true});});
    await until(p,()=>document.querySelector('[data-progress-table]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('#m-table')?.hidden&&document.activeElement===document.querySelector('[data-progress-table]'),'table choice and keyboard focus survive refreshed chart');
    assert(await chart.isHidden());await toggle.click();assert(await chart.isVisible());assert(await table.isHidden());assert.equal(await toggle.getAttribute('aria-pressed'),'false');
    const selected=p.locator('#m-chart .period-column').filter({has:p.locator('.bar-seg')}).first();assert(await selected.count(),'fixture has a non-empty period to select');
    const before=await p.locator('#m-chart svg').boundingBox(),defaultLabel=await p.locator('.progress-total-stats .stat:first-child small').innerText();
    assert.equal(await p.locator('#m-chart svg').getAttribute('role'),'listbox');assert.equal(await p.locator('#m-chart svg').getAttribute('aria-orientation'),'horizontal');assert.equal(await selected.getAttribute('role'),'option');assert.match(await selected.getAttribute('aria-label'),/: [\d.]+ mi$/);assert.equal(await selected.getAttribute('aria-selected'),'false');
    await selected.click();await until(p,()=>document.querySelector('#m-chart .period-column[aria-selected="true"]')!==null,'selected Progress total');
    assert.equal(await selected.getAttribute('aria-selected'),'true');assert.equal(await p.locator('#m-chart svg').getAttribute('aria-activedescendant'),await selected.getAttribute('id'));
    const selectionLabel=await p.locator('.progress-total-stats .stat:first-child small').innerText(),after=await p.locator('#m-chart svg').boundingBox();
    assert.notEqual(selectionLabel,defaultLabel,'selected period replaces the first total label');assert.deepEqual({x:after.x,y:after.y,width:after.width,height:after.height},{x:before.x,y:before.y,width:before.width,height:before.height},'selection keeps chart in place');
    if(out&&size.width===390&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-selected-total-${theme}.png`,fullPage:true});}
    await selected.click();await until(p,()=>document.querySelector('#m-chart .period-column[aria-selected="true"]')===null,'tap selected period to clear');assert.equal(await selected.getAttribute('aria-selected'),'false');assert.equal(await p.locator('.progress-total-stats .stat:first-child small').innerText(),defaultLabel);
    const svg=p.locator('#m-chart svg');await svg.focus();await p.keyboard.press('Home');let active=await svg.getAttribute('aria-activedescendant');assert.equal(await p.locator('#'+active).getAttribute('aria-selected'),'false','Home previews without selecting');await p.keyboard.press('Space');assert.equal(await p.locator('#'+active).getAttribute('aria-selected'),'true','Space selects the active period');await p.keyboard.press('End');const lastId=await svg.getAttribute('aria-activedescendant');assert.equal(await p.locator('#'+lastId).getAttribute('aria-selected'),'true','End moves an existing selection to the last period');await p.keyboard.press('Escape');assert.equal(await p.locator('#m-chart .period-column[aria-selected="true"]').count(),0,'Escape clears selection');assert.equal(await p.locator('.progress-total-stats .stat:first-child small').innerText(),defaultLabel);
    await p.locator('.progress-totals-title').click();await until(p,()=>document.querySelector('#m-chart .period-column[aria-selected="true"]')===null,'tap outside chart to clear');assert.equal(await p.locator('.progress-total-stats .stat:first-child small').innerText(),defaultLabel);
   }
   for(const legacy of ['totals','mileage','training']){await p.goto(base+`/progress?view=${legacy}&period=month&sport=all`);await ready();assert.equal(new URL(p.url()).searchParams.get('view'),null);assert.equal(new URL(p.url()).searchParams.get('period'),'month');assert.equal(new URL(p.url()).searchParams.get('sport'),'all');assert.equal(await p.locator('.progress-home').count(),1,'old Totals links resolve to the home card');}await home();
   if(who==='runner'){
    const monday=day=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);};
    const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    await c.route('**/api/progress/volume?*',r=>{const period=new URL(r.request().url()).searchParams.get('period'),rows=[];
     if(period==='week'){const start=monday(fixtureToday);for(let i=11;i>=0;i--){const p=addDays(start,-i*7),d=5200+i*180,t=d/1000*(440-i*2);rows.push({p,s:'run',d,t,n:2,a:0});const rd=22000+i*450;rows.push({p,s:'ride',d:rd,t:rd/(7+i*.04),n:1,a:0});}}
     else if(period==='month'){const [year,month]=fixtureToday.split('-').map(Number);for(let i=11;i>=0;i--){const date=new Date(Date.UTC(year,month-1-i,1)),p=date.toISOString().slice(0,10),d=16000+i*700,t=d/1000*(438-i*2);rows.push({p,s:'run',d,t,n:8,a:0});const rd=68000+i*3000;rows.push({p,s:'ride',d:rd,t:rd/(7+i*.05),n:4,a:0});}}
     else rows.push({p:'2026-01-01',s:'run',d:120000,t:52000,n:30,a:0});
     return r.fulfill({json:{period,today:fixtureToday,rows}});
    });
    await p.evaluate(()=>{for(const period of ['week','month']){const path=`/api/progress/volume?period=${period}`;App.cache.delete(path);localStorage.removeItem('fit.c:'+path);}});
    await p.evaluate(()=>go('/progress?sport=run&metric=pace'));await ready();await p.locator('#m-chart svg').waitFor();
    const assertPacePlotWidth=async label=>{const g=await p.locator('#m-chart svg').evaluate(svg=>{const line=svg.querySelector('.dotline'),rect=svg.getBoundingClientRect(),card=svg.closest('.card').getBoundingClientRect(),view=svg.viewBox.baseVal,last=line.points[line.points.numberOfItems-1].x;return{rightGap:card.right-(rect.left+last/view.width*rect.width),cardWidth:card.width,svgWidth:rect.width};});assert(g.rightGap<=32,`${label} pace plot fills its card: ${JSON.stringify(g)}`);};
    assert.equal(await p.locator('[data-progress-metric="pace"]').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('#m-chart .dotp').count(),12,'weekly pace chart covers 12 weeks');assert.match(await p.locator('#m-chart svg').getAttribute('aria-label'),/last 12 weeks/);assert.match(await p.locator('.progress-pace-window').innerText(),/Weekly averages · last 12 weeks/);assert.equal(await p.locator('[data-progress-table]').count(),0,'pace chart has no distance table');await assertPacePlotWidth('weekly');await fits('weekly pace');await shot('pace-week');
    await p.locator('[data-progress-period="month"]').click();await ready();await p.locator('#m-chart svg').waitFor();assert.equal(await p.locator('#m-chart .dotp').count(),12,'monthly pace chart covers 12 months');assert.match(await p.locator('#m-chart svg').getAttribute('aria-label'),/last 12 months/);await assertPacePlotWidth('monthly');await shot('pace-month');
    await p.locator('#p-sport').click();await p.locator('[data-pk="ride"]').click();await ready();assert.equal(await p.locator('[data-progress-metric="speed"]').getAttribute('aria-pressed'),'true','sport change maps pace to speed for rides');await p.locator('[data-progress-metric="speed"]').click();await ready();assert.match(await p.locator('#m-chart svg').getAttribute('aria-label'),/Average speed/);assert.equal(await p.locator('#m-chart .dotp').count(),12);
    await p.locator('#p-sport').click();await p.locator('[data-pk="all"]').click();await ready();assert.equal(await p.locator('[data-progress-metric]').count(),2,'mixed sports do not offer a combined pace');assert.equal(await p.locator('[data-progress-metric="distance"]').getAttribute('aria-pressed'),'true','unsupported speed resets to distance');await fits('all-sports totals');
   }
   // Every tile has a direct destination and every Progress detail has a Home arrow, including old addresses.
   for(const url of ['/progress/weight','/progress?view=fitness','/progress?view=records','/progress?view=lifting','/progress/trends','/progress/calendar','/progress/routes','/progress/segments','/progress/heatmap','/progress?section=food','/progress?section=food&foodview=weight','/progress?view=heatmap']){
    if(['/progress?view=fitness','/progress?section=food','/progress/heatmap'].includes(url))await p.goto(base+url);else await p.evaluate(url=>go(url),url);await ready();const weight=new URL(p.url()).pathname==='/progress/weight';assert.equal(await p.locator(weight?'.weight-heading [data-back]':'.progress-back[href^="/progress"]').count(),1,url+' home navigation');assert.equal(await p.locator('.progress-focus').count(),0);await fits(url);
    if(url==='/progress/segments'){assert.equal(await p.locator('#sg-sport').evaluate(n=>!!n.closest('.card')),true,'segment sport is inside its first card');await p.locator('#sg-sport').click();await p.locator('[data-pk=run]').click();await ready();assert.match(new URL(p.url()).search,/sport=run/);}
    if(url.includes('view=fitness')){await until(p,()=>!!document.querySelector('#fi-range .range-btn'),'years filter rendered beside Running fitness');assert.equal(await p.locator('#fi-range button').count(),1,'years filter stays with Running fitness after first-card refresh');if(who==='runner'){assert.equal(await p.locator('#fi-summary .fitness-current').count(),1,'Fitness & freshness now leads Progress → Fitness');assert((await p.locator('#fi-summary .fitness-current').boundingBox()).y<(await p.locator('#fi-pred').boundingBox()).y,'moved summary appears before predictions');}}
    if(url.includes('/trends'))assert.equal(await p.locator('#p-rng button').count(),1,'years filter remains on the separate Trends view');
    await p.locator(weight?'.weight-heading [data-back]':'.progress-back').click();await p.waitForURL(url=>url.pathname==='/progress');await p.waitForSelector('.progress-home');await ready();assert.equal(await p.locator('.progress-home').count(),1);
   }
   await home();await p.evaluate(()=>document.addEventListener('click',e=>{if(e.target.closest('[data-progress-feature="lifting"]'))globalThis.progressLeaveScroll=scrollY;},{capture:true}));await p.locator('[data-progress-feature="lifting"]').click();await p.waitForURL('**/progress?view=lifting');await ready();const y=await p.evaluate(()=>globalThis.progressLeaveScroll);await p.locator('.progress-back').click();await p.waitForURL(base+'/progress');await p.waitForSelector('.progress-home');await ready();await until(p,target=>Math.abs(scrollY-Math.min(target,document.documentElement.scrollHeight-innerHeight))<8,'home preserves available scroll',y);
   assert.equal(await p.locator('[data-progress-feature="lifting"] .progress-new:not(.seen)').count(),0,'visited tile drops New');
   // Failed overview/fitness/volume requests retain descriptions and navigation, without an error banner.
   await c.route('**/api/progress/overview',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await c.route('**/api/fitness?*',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await c.route('**/api/progress/volume?*',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await p.goto(base+'/progress');await ready();assert.equal(await p.locator('#p-explore a').count(),8);assert.equal(await p.locator('.err, .error-page').count(),0);await fits('unavailable');
   assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Progress ${who} ${size.width}/${size.root} ${theme}: cards, filters, legacy addresses, scroll, New and unavailable PASS`);await c.close();
  }
 }
 }finally{try{setProgressFlags(false);}catch(_){}for(const c of cleanup){await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:'green teapot on the hill'}});await c.close();}await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
