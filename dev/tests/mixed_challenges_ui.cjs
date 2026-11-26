// Fictional responses; actual served app assets. No provider or account writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out)=>{
 const gid='10000000-0000-4000-8000-000000000001',qid='20000000-0000-4000-8000-000000000001';
 const me={id:101,login:'alex',name:'Alex Rivera',units:'metric',tz:'America/New_York',created:'2025-01-01T00:00:00Z',ai_ok:false,needs_email_confirm:false,notify:{},share_achievements:true};
 const group={id:gid,title:'Saturday crew',time_zone:'America/New_York',event_state:'ongoing',members:[{username:'alex',organizer:true},{username:'zoes'}],member_count:2,is_organizer:true,closed:false,updates:[]};
 const detail={id:qid,group_id:gid,title:'November miles',metric:'distance',target:100,unit:'km',sports:['run'],start_date:'2026-11-01',end_date:'2026-11-30',time_zone:group.time_zone,share_total:true,total:42,your_total:12,members:[{username:'alex',value:12,shares_total:true},{username:'zoes',value:30,shares_total:true}]};
 const grouped={id:qid,group_id:gid,group_name:group.title,title:detail.title,kind:'distance',target:100,unit:'km',start:detail.start_date,end:detail.end_date,member:true,group_total:42,self:{value:12,finished:false,complete:false,days_left:4}};
 const personal={code:'fictional-solo',kind:'distance',target:50,unit:'km',start:'2026-11-01',end:'2026-11-28',member:true,self:{value:18,finished:false,complete:false,days_left:2}};
 const assets=process.env.KINETTA_STATIC_DIR;
 const {collectSpacing}=require('./spacing_dom.cjs'),{audit}=require('./spacing_geometry.cjs'),rules=require('./spacing_exceptions.json');
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage();p.setDefaultTimeout(8000);
  let mode='mixed';const errors=[],writes=[],reads=[];p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(()=>localStorage.setItem('kinetta.firstRunSeen','1'));
  try{
   await c.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());assert.equal(u.origin,base,'no external requests');
    if(u.pathname.startsWith('/api/')){
     if(req.method()!=='GET')writes.push(u.pathname);else reads.push(u.pathname+u.search);
     let json={};
     if(u.pathname==='/api/me')json=me;
     else if(u.pathname==='/api/setup')json={needed:false};
     else if(u.pathname==='/api/signup')json={open:true,full:false};
     else if(u.pathname==='/api/community/terms')json={required:false};
     else if(u.pathname==='/api/challenges')json=mode==='empty'?[]:[{...grouped,id:'open',title:'Keep moving',end:null},grouped,personal,{...grouped,id:'ended',title:'October outings',end:'2026-10-31',self:{...grouped.self,finished:true}}];
     else if(u.pathname==='/api/groups')json=[group];
     else if(u.pathname===`/api/groups/${gid}`)json=group;
     else if(u.pathname===`/api/groups/${gid}/challenges/${qid}`)json=detail;
     else if(u.pathname==='/api/notifications/count')json={count:0};
     return r.fulfill({json});
    }
    if(!assets)return r.continue();
    const file=u.pathname.startsWith('/static/')?path.join(assets,u.pathname.slice(8)):path.join(assets,'index.html');
    if(!fs.existsSync(file))return r.fulfill({status:404,body:''});
    return r.fulfill({body:fs.readFileSync(file),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});
   });
   const save=async name=>{await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming()?.iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');if(['list','ended','empty','add-choice','group-picker'].includes(name)){const spacing=audit(await p.evaluate(collectSpacing,{screen:'challenges',rules}),rules);assert.deepEqual(spacing.violations,[],name+' spacing '+width+' '+theme);}if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`mixed-${name}-${width}-${theme}.png`),animations:'disabled'});}};
   await p.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
   await p.goto(base+'/me/challenges');await p.locator('.challenge-list-row').first().waitFor();
   assert(reads.includes('/api/challenges?include_groups=true'));
   const rows=p.locator('#challenge-list .challenge-list-row');assert.equal(await rows.count(),3);
   assert.match(await rows.nth(0).innerText(),/18 of 50 km/);assert.match(await rows.nth(1).innerText(),/You 12 km · Group 42 of 100 km/);assert.match(await rows.nth(1).innerText(),/Saturday crew/);assert.match(await rows.nth(2).innerText(),/No end date/);
   assert.equal(await rows.nth(1).locator('.challenge-group-name circle').count(),2,'people icon available on cold route');
   assert.equal(await p.locator('#challenge-list .inset-group').count(),1);await save('list');
   await p.locator('[data-challenge-state=ended]').click();assert.equal(await p.locator('.challenge-list-row').count(),1);assert.match(await p.locator('.challenge-list-row').innerText(),/October outings/);await save('ended');
   await p.locator('[data-challenge-state=active]').click();await p.locator(`a[href*="/challenges/${qid}"]`).click();await p.locator('[data-challenge-sharing]').waitFor();
   assert.equal(await p.locator('[data-back]').getAttribute('aria-label'),'Back to Challenges');assert.equal(await p.locator('nav.tabs [data-tab=activity]').getAttribute('aria-current'),'page');await save('back');
   await p.locator('[data-back]').click();await p.locator('.challenge-list-row').first().waitFor();assert.equal(new URL(p.url()).pathname,'/me/challenges');
   await p.locator('#challenge-start').click();await p.locator('[data-challenge-scope=me]').waitFor();await save('add-choice');
   await p.locator('[data-challenge-scope=group]').click();await p.locator('[data-challenge-group]').waitFor();await save('group-picker');
   await p.locator('[data-challenge-group]').click();await p.locator('.group-challenge-form').waitFor();assert.equal(await p.locator('.group-challenge-form [name=title]').getAttribute('placeholder'),'Name');assert.equal(await p.locator('.group-challenge-form [name=title]').inputValue(),'');await save('add-group');
   await p.keyboard.press('Escape');await p.evaluate(()=>groupCreateSheet());await p.locator('.group-create-form').waitFor();assert.equal(await p.locator('.group-create-form [name=title]').getAttribute('placeholder'),'Name');assert.equal(await p.locator('.group-create-form [name=title]').inputValue(),'');await save('create-group');await p.keyboard.press('Escape');await p.locator('#challenge-start').click();await p.locator('[data-challenge-scope=me]').click();await p.locator('[data-challenge-kind=distance]').waitFor();await p.keyboard.press('Escape');
   // Exercise Home's real renderer with the combined payload, without a second summary read.
   await p.evaluate(async()=>{await loadClassicScript(SOCIAL_ROUTE_ASSET);const el=document.createElement('div');el.innerHTML='<div id="feed-top"><div class="top"><h1>Home</h1><div class="acts"></div></div></div><div id="feed-tools"></div>';document.body.append(el);await feedTools(el,()=>true).refresh();globalThis.mixedHomeLabel=el.querySelector('.challenge-summary').textContent;el.remove();});
   assert.match(await p.evaluate(()=>mixedHomeLabel),/3 challenges/);
   await p.goto(base+`/groups/${gid}/challenges/${qid}?from=challenges`);await p.locator('[data-challenge-sharing]').waitFor();await p.locator('[data-back]').click();await p.locator('.challenge-list-row').first().waitFor();assert.equal(new URL(p.url()).pathname,'/me/challenges','cold detail Back returns to Challenges');
   mode='empty';await p.goto(base+'/me/challenges');await p.locator('.challenge-empty').waitFor();await save('empty');await p.locator('#challenge-first').click();await p.locator('[data-challenge-scope=me]').click();await p.locator('.challenge-templates').waitFor();await p.keyboard.press('Escape');
   assert.deepEqual(errors,[]);assert(writes.every(v=>v==='/api/challenges/signup/continue'),'no data-changing/provider calls');
  }finally{await c.close();}
 }
 console.log('Mixed challenges: 390/330 light/dark; sort/open end, privacy labels, Active/Ended, choices, Back and Home count PASS');
};
