// Real fictional accounts and real overview responses. No production data or AI/provider calls.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,key:App.page?.key,ready:App.pageReady,body:document.body.textContent.slice(0,200)}))));}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'test_progress_overview.py')],{env:{...process.env,KINETTA_KEEP_PROGRESS:'1'},stdio:'inherit'});
 const b=await chromium.launch(),cleanup=[];
 try{
 for(const who of ['empty','runner','food']){
  const login=await b.newContext();const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_overview_'+who,password:'green teapot on the hill'}});assert.equal(signed.status(),200,'fixture login: '+await signed.text());const state=await login.storageState();cleanup.push(login);
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
   if(process.env.KINETTA_PROGRESS_CASE&&process.env.KINETTA_PROGRESS_CASE!==`${who}-${size.width}-${theme}`)continue;
   const c=await b.newContext({storageState:state,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];let notificationCount=0;
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/notifications/count')return r.fulfill({json:{unread:notificationCount,friend_requests:0,friend_count:0}});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>App.pageReady&&App.page?.key===location.pathname+location.search,'ready');
   const home=async()=>{if(p.url()==='about:blank')await p.goto(base+'/progress');else await p.evaluate(()=>go('/progress'));await p.waitForURL(base+'/progress');await ready();await p.waitForSelector('#p-explore a');};
   const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-${who}-${name}-${theme}.png`,fullPage:true});}};
   const fits=async label=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),label+' has no overflow');
   await home();assert.equal(await p.locator('h1').innerText(),'Progress');
   if(size.width===390&&size.root===16){
    for(const [count,label] of [[1,'one'],[10,'many'],[0,'none']]){
     notificationCount=count;await p.evaluate(()=>{Social.at=0;Social.refresh();});
     await until(p,n=>{const dot=document.querySelector('.bell-dot');return dot&&(n===0?dot.hidden:!dot.hidden&&dot.textContent.trim()===(n>9?'9+':String(n)))&&document.querySelector('.bell')?.getAttribute('aria-label')===`Notifications${n?`, ${n} new`:''}`;},'live notification badge '+label,count);
     const geometry=await p.locator('.bell').evaluate(link=>{const a=link.getBoundingClientRect(),d=link.querySelector('.bell-dot').getBoundingClientRect();return{button:{x:a.x,y:a.y,width:a.width,height:a.height},badge:{x:d.x,y:d.y,width:d.width,height:d.height,hidden:link.querySelector('.bell-dot').hidden}};});
     assert(geometry.button.width>=44&&geometry.button.height>=44,'bell remains a 44px target');
     if(count){assert(geometry.badge.x>=geometry.button.x&&geometry.badge.y>=geometry.button.y&&geometry.badge.x+geometry.badge.width<=geometry.button.x+geometry.button.width&&geometry.badge.y+geometry.badge.height<=geometry.button.y+geometry.button.height,'badge stays inside the bell button');}
     if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-bell-${label}-${theme}.png`,clip:{x:0,y:0,width:390,height:115}});}
    }
   }
   assert(await p.locator('.progress-summary h2').evaluateAll(nodes=>nodes.every(n=>{const r=document.createRange();r.selectNodeContents(n);const ink=r.getBoundingClientRect(),card=n.closest('.card').getBoundingClientRect();return ink.left>=card.left-1&&ink.right<=card.right+1;})),'Progress card headings fit inside their cards');assert.equal(await p.locator('.progress-focus, .view-nav, .pbar').count(),0,'no global control rows');
   assert.equal(await p.locator('#p-explore a').count(),8);assert.equal(await p.locator('.progress-food-summary').count(),who==='food'?1:0);assert.equal(await p.locator('[data-progress-feature=weight]').count(),1,'Weight is always discoverable');assert.equal(await p.locator('[data-progress-feature=weight]').getAttribute('href'),'/progress/weight');assert.match(await p.locator('[data-progress-feature=weight]').innerText(),who==='food'?/latest/:/first weigh-in/);
   assert.equal(await p.locator('#p-sport').evaluate(n=>!!n.closest('.card')),true,'sport inside the chart card');
   for(const btn of await p.locator('[data-progress-period]').all())assert((await btn.boundingBox()).height>=44);
   if(who==='empty'){assert.equal(await p.locator('[data-progress-table]').count(),0,'empty Totals has no dead Table action');assert(!/0 (activities mapped|loops|segment bests)/.test(await p.locator('#p-explore').innerText()));assert.equal(await p.locator('.progress-new:not(.seen)').count(),8);}
   if(who==='runner'){assert.match(await p.locator('#p-explore a').first().innerText(),/Heatmap[\s\S]*2 activities mapped/);assert.equal(await p.locator('[data-progress-feature="heatmap"] .progress-new:not(.seen)').count(),0);assert.match(await p.locator('[data-progress-record]').innerText(),/5K/);}
   if(who==='food'){assert.match(await p.locator('[data-progress-food]').innerText(),/Protein goal 1 of 7 days.*weight/);}
   if(size.root===16){const height=(await p.locator('#p-home-totals .card').first().boundingBox()).height;assert(height<=(who==='empty'||who==='food'?150:330),'compact totals: '+height);assert.equal(await p.locator('.progress-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2);if(who==='runner')assert.match(await p.locator('[data-progress-fitness]').innerText(),/(Fresh|Tired|Training steadily)[\s\S]*estimate/);assert.equal(await p.locator('#p-home-totals .legend').isVisible().catch(()=>false),false,'home average is labelled once');}
   if(who==='runner')await until(p,()=>document.querySelectorAll('#p-home-totals .stats3 .stat>b').length===3,'three loaded overview values');
   const metricY=await p.locator('#p-home-totals .stats3 .stat>b').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().top));if(metricY.length>1)assert(Math.max(...metricY)-Math.min(...metricY)<=2,'summary metric values share one baseline');
   await fits('home');await shot('home');
   await p.locator('[data-progress-period="month"]').click();await ready();assert.equal(await p.locator('[data-progress-period="month"]').getAttribute('aria-pressed'),'true');
   await p.locator('#p-sport').click();await p.locator('[data-pk="all"]').click();await ready();assert.equal(await p.evaluate(()=>localStorage.getItem('fit.psport')),'all');
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
   // Every tile has a direct destination and every Progress detail has a Home arrow, including old addresses.
   for(const url of ['/progress/weight','/progress?view=fitness','/progress?view=records','/progress?view=lifting','/progress/trends','/progress/calendar','/progress/routes','/progress/segments','/progress/heatmap','/progress?section=food','/progress?section=food&foodview=weight','/progress?view=heatmap']){
    if(['/progress?view=fitness','/progress?section=food','/progress/heatmap'].includes(url))await p.goto(base+url);else await p.evaluate(url=>go(url),url);await ready();const weight=new URL(p.url()).pathname==='/progress/weight';assert.equal(await p.locator(weight?'.weight-heading [data-back]':'.progress-back[href^="/progress"]').count(),1,url+' home navigation');assert.equal(await p.locator('.progress-focus').count(),0);await fits(url);
    if(url==='/progress/segments'){assert.equal(await p.locator('#sg-sport').evaluate(n=>!!n.closest('.card')),true,'segment sport is inside its first card');await p.locator('#sg-sport').click();await p.locator('[data-pk=run]').click();await ready();assert.match(new URL(p.url()).search,/sport=run/);}
    if(url.includes('view=fitness')||url.includes('/trends'))assert.equal(await p.locator('#p-rng button').count(),1,'years filter survives first-card refresh');
    await p.locator(weight?'.weight-heading [data-back]':'.progress-back').click();await p.waitForURL(base+'/progress');await p.waitForSelector('.progress-home');await ready();assert.equal(await p.locator('.progress-home').count(),1);
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
 }finally{for(const c of cleanup){await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:'green teapot on the hill'}});await c.close();}await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
