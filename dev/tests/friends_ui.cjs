// Fictional guarded accounts; real friend/search APIs, no providers or real devices.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
(async()=>{
 const fixture=cp.execFileSync('python3',[path.join(__dirname,'friends_compact_fixture.py')],{env:process.env,encoding:'utf8'});console.log(fixture.trim());const browser=await chromium.launch(),contexts=[];
 async function open(state,theme,size={width:390,height:844}){
  const c=await browser.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_fc_'+state,password:pw}})).status(),200);
  await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  const p=await c.newPage(),errors=[],writes=[],searches=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  p.on('request',r=>{const u=new URL(r.url());if(u.origin===base&&u.pathname==='/api/people/search')searches.push(u.searchParams.get('q')||'');});
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='GET'&&u.pathname==='/api/groups')return r.fulfill({json:[{id:'00000000-0000-4000-8000-000000000091',title:'Fictional walk group',event_date:'2026-12-01',time_zone:'UTC',member_count:2,closed:false},{id:'00000000-0000-4000-8000-000000000092',title:'Closed fictional group',event_date:'2026-12-02',time_zone:'UTC',member_count:2,closed:true}]});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(u.pathname==='/api/friends'||u.pathname.startsWith('/api/friends/zz_test_fc_')||u.pathname.startsWith('/api/people/zz_test_fc_'))return r.continue();return r.fulfill({json:{}});}return r.continue();});
  const friends=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/friends'&&r.request().method()==='GET');
  const suggested=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/people/suggested'&&r.request().method()==='GET');
  await p.goto(base+'/me/friends?find=1');await Promise.all([friends,suggested]);
  await until(p,()=>App.pageReady&&!!document.querySelector('.friends-page #fr-invite'),'Find friends ready');await p.evaluate(()=>document.fonts.ready.then(()=>true));
  await until(p,()=>{const box=document.querySelector('#fr-suggest');return box&&((box.parentElement.hidden)||box.querySelector('.pym-row'));},'suggestions loaded');
  return{c,p,errors,writes,searches};
 }
 async function close(c){await c.close();contexts.splice(contexts.indexOf(c),1);}
 async function closeSheet(p){await p.locator('[data-close]').last().click();await until(p,()=>!document.querySelector('[role="dialog"]'),'sheet closed');}
 async function settle(p){await p.evaluate(async()=>{await document.fonts.ready;const animations=[...document.querySelectorAll('.scrim,.sheet')].flatMap(el=>el.getAnimations());await Promise.all(animations.map(a=>a.finished.catch(()=>{})));});}
 async function capture(p,name){if(!out)return;await settle(p);fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
 try{
  for(const state of ['empty','typical','heavy'])for(const theme of ['light','dark']){
   const name=`${state}-390-${theme}`;if(process.env.KINETTA_FRIEND_CASE&&process.env.KINETTA_FRIEND_CASE!==name)continue;
   const {c,p,errors,writes,searches}=await open(state,theme);
   assert.equal(await p.locator('#fr-title').innerText(),'Find friends');assert.equal(await p.locator('#fr-title').evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length;}),1,'complete heading stays on one line');
   for(const selector of ['#fr-own-list','#fr-lists','.friend-empty','#fr-sharing','.friend-footer','a[aria-label="Your profile"]','a[href="/me/sharing"]'])assert.equal(await p.locator(selector).count(),0,`removed from Find friends: ${selector}`);
   assert(!/Your friends will appear here|New activities:\s*Everyone/.test(await p.locator('#page').innerText()),'no friends explainer or sharing setting');
   assert.equal(await p.locator('#fr-find input').getAttribute('aria-label'),'Search name or @username');assert.equal(await p.locator('#fr-invite').count(),1);
   await p.waitForFunction(()=>document.querySelector('#fr-groups-count')?.textContent==='1 active group');
   assert.equal(await p.locator('#fr-groups-discover').getAttribute('href'),'/me/groups');assert.equal(await p.locator('#fr-groups-discover svg').count(),1,'the linked row has only its calendar icon, with no redundant chevron');assert.equal(await p.locator('#fr-group-create').innerText(),'Create');assert.equal(await p.locator('#fr-group-create svg').count(),0);assert.equal(await p.locator('#fr-group-create').getAttribute('href'),'/me/groups?create=1');
   const groupOrder=await p.evaluate(()=>!!(document.querySelector('#fr-discover').compareDocumentPosition(document.querySelector('#fr-groups-shortcut'))&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(document.querySelector('#fr-groups-shortcut').compareDocumentPosition(document.querySelector('#fr-found'))&Node.DOCUMENT_POSITION_FOLLOWING));assert(groupOrder,'Groups sits directly below search and above results');
   const groupsLayout=await p.locator('#fr-groups-shortcut').evaluate(el=>{const r=el.getBoundingClientRect(),row=el.querySelector('#fr-groups-discover').getBoundingClientRect(),create=el.querySelector('#fr-group-create').getBoundingClientRect();return{width:r.width,scrollWidth:el.scrollWidth,row:{width:row.width,height:row.height},create:{x:create.x,right:create.right,width:create.width,height:create.height},viewport:innerWidth};});assert(groupsLayout.scrollWidth<=groupsLayout.width+1&&groupsLayout.create.width>=44&&groupsLayout.create.height>=44&&groupsLayout.create.right<=groupsLayout.viewport+1,`Groups entry fits at 390px with a visible 44px Create action: ${JSON.stringify(groupsLayout)}`);
   if(state==='typical')await capture(p,`find-friends-groups-390-${theme}`);
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Find friends has no horizontal overflow');
   const expectedRequests={empty:0,typical:2,heavy:5}[state],expectedSuggestions={empty:0,typical:5,heavy:1}[state],requestRow=p.locator('#fr-requests-open');
   if(expectedRequests){assert.equal(await requestRow.innerText(),`Requests (${expectedRequests})`);assert(await requestRow.locator('svg').count());}
   else assert.equal(await requestRow.count(),0,'no empty Requests row');
   if(expectedRequests&&await p.locator('#fr-suggest').count())assert(await p.evaluate(()=>document.querySelector('#fr-requests').compareDocumentPosition(document.querySelector('.friend-more'))&Node.DOCUMENT_POSITION_FOLLOWING),'Requests precede Suggested');
   const suggestions=p.locator('#fr-suggest .pym-row');
   if(expectedSuggestions){
    assert.equal(await suggestions.count(),expectedSuggestions,state==='typical'?'suggestions are capped at five':'mutual connections explain every suggestion');assert.match(await p.locator('#fr-suggest').innerText(),/1 mutual/);assert(!/New on Kinetta/.test(await p.locator('#fr-suggest').innerText()));
    for(const row of await suggestions.all()){
     assert.equal(await row.locator('.pym-actions > *').count(),1,'one trailing Add action per suggestion');assert.equal(await row.locator('[data-hide]').count(),0);
     assert.equal(await row.locator('[data-add] svg').count(),1,'suggestion action uses the supported plus icon');const box=await row.locator('[data-add]').boundingBox();assert.equal(box.width,44,'suggestion action is a 44px circle');assert.equal(box.height,44,'suggestion action is a 44px circle');const tint=await row.locator('[data-add]').evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(tint,'rgba(0, 0, 0, 0)','suggestion action has a quiet tinted background');
     const readable=await row.locator('.person-link b').evaluate(el=>({text:el.textContent,overflow:el.scrollWidth>el.clientWidth+1,ellipsis:getComputedStyle(el).textOverflow}));assert(readable.text.length&& !readable.overflow&&readable.ellipsis!=='ellipsis','suggestion names stay readable');
    }
    if(state==='typical'){
     if(out)await capture(p,`find-friends-suggested-390-${theme}`);
     await requestRow.click();const dialog=p.getByRole('dialog',{name:'Requests'});await dialog.waitFor();assert.equal(await dialog.locator('.fr-request').count(),1);assert.equal(await dialog.locator('[data-request-cancel]').count(),1);assert((await dialog.innerText()).includes('Waiting for you'));assert((await dialog.innerText()).includes('You sent'));
     if(out)await capture(p,`find-friends-requests-390-${theme}`);await closeSheet(p);
    }
   }else assert.equal(await suggestions.count(),0,'no suggestions without a real connection');
   if(state==='empty'){
    assert.equal(await p.locator('#fr-find input').evaluate(n=>document.activeElement===n),true,'Find friends entry focuses search');
    if(out)await capture(p,`find-friends-empty-390-${theme}`);
    await p.goto(base+'/activity');await until(p,()=>App.pageReady&&!!document.querySelector('#ff-list')&&document.querySelector('#feed-tools')?.getAttribute('aria-busy')==='false','empty Activity ready');
    assert.equal(await p.locator('#feed-top a[aria-label="Find friends"] svg').count(),1,'Activity header has the person-plus entry');assert.equal(await p.locator('#feed-tools .feed-find-friends').innerText(),'Find friends');assert.equal(await p.locator('#ff-list .feed-empty').count(),1,'fictional account has an empty feed');
    if(out){await settle(p);fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,`activity-header-find-friends-390-${theme}.png`),clip:{x:0,y:0,width:390,height:160}});await capture(p,`activity-empty-find-friends-390-${theme}`);}
    if(theme==='light'){
     await p.goto(base+'/me/friends?find=1');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-invite'),'Find friends restored');
     await p.locator('#fr-find input').fill('F');await p.waitForTimeout(240);assert(!searches.includes('F'),'one character does not query the directory');assert.match(await p.locator('#fr-status').innerText(),/2 characters/);
     await p.locator('#fr-find input').fill('Fictional Friend 03');await until(p,()=>document.querySelector('#fr-found')?.getAttribute('aria-busy')==='false'&&document.querySelector('#fr-found')?.textContent.includes('Fictional Friend 03'),'live search result');
     const result=p.locator('#fr-found .person').first();assert.equal(await result.locator('.btnrow > *').count(),1,'search results also have one trailing action');assert.equal(await result.locator('[data-hide]').count(),0);
     await p.locator('#fr-clear').click();await p.locator('#fr-invite').click();await p.getByRole('dialog',{name:'Invite friends'}).waitFor();await p.locator('#iv-qr').click();await p.locator('#iv-qr-code svg[aria-label="QR code for your Kinetta invite link"]').waitFor();await closeSheet(p);
    }
   }
   assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'opening and reviewing the screens has no write side effects');await close(c);console.log(`Find friends ${name}: privacy, compact requests, connection-only suggestions and 44px actions PASS`);
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='list'){
   for(const state of ['empty','typical','heavy'])for(const theme of ['light','dark']){
    const {c,p,errors,writes}=await open(state,theme);
    await p.goto(base+'/me/friends');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-own-list'),'My friends ready');
    assert.equal(await p.locator('#fr-title').innerText(),'Friends','Me → Friends opens the friends list');assert.equal(await p.locator('.top .back').getAttribute('aria-label'),'Back to Me');
    assert.equal(await p.locator('#fr-find').count(),0,'the friends list has no discovery search');assert.equal(await p.locator('.pym-tile').count(),0,'suggestions stay on Find friends');
    const friendRows=p.locator('#fr-own-list .fr-friend'),expectedFriends={empty:0,typical:1,heavy:40}[state],expectedRequests={empty:0,typical:2,heavy:5}[state];
    assert.equal(await friendRows.count(),expectedFriends,'Me → Friends shows existing friends');
    const find=p.locator('#fr-browse'),findBox=await find.boundingBox();assert.equal(await find.getAttribute('aria-label'),'Find friends');assert.equal(await find.getAttribute('href'),'/me/friends?find=1');assert(findBox.width>=44&&findBox.height>=44,'Find friends stays a 44px action');
    const manage=p.locator('#fr-own-list [data-manage]');assert.equal(await manage.count(),expectedFriends);assert(await manage.evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;})),'friend management remains reachable from each row');
    if(expectedRequests){const row=p.locator('#fr-requests-open');assert.equal((await row.innerText()).trim(),`Requests (${expectedRequests})`);assert((await row.boundingBox()).height>=44,'Requests summary is a full-width action');}
    else assert.equal(await p.locator('#fr-requests-open').count(),0,'no empty Requests row');
    if(state==='empty'){
     assert.match(await p.locator('.friend-empty').innerText(),/No friends yet/);const emptyFind=await p.locator('#fr-empty-browse').boundingBox();assert(emptyFind.width>=44&&emptyFind.height>=44,'empty state keeps a 44px Find friends action');
    }else assert.equal(await friendRows.first().locator('.person-link').getAttribute('href'),'/people/zz_test_fc_peer00','a friend row opens that friend’s profile');
    assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'My friends has no horizontal overflow');
    if(out&&(state==='typical'||state==='empty'))await capture(p,`my-friends-${state}-390-${theme}`);
    if(state==='typical'){
     await p.locator('#fr-requests-open').click();const dialog=p.getByRole('dialog',{name:'Requests'});await dialog.waitFor();assert.equal(await dialog.locator('.fr-request').count(),1);assert.equal(await dialog.locator('[data-request-cancel]').count(),1);await closeSheet(p);
    }
    await find.click();await until(p,()=>App.pageReady&&!!document.querySelector('#fr-invite'),'Find friends action opens discovery');
    assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'viewing the friends list has no write side effects');await close(c);console.log(`My friends ${state} ${theme}: list, Requests, Find friends and 44px actions PASS`);
   }
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='actions'){
   for(const theme of ['light','dark']){
    const state=theme==='light'?'typical':'empty',targetLogin=theme==='light'?'zz_test_fc_peer06':'zz_test_fc_peer07',targetName=theme==='light'?'Fictional Friend 07':'Fictional Friend 08';
    const {c,p,errors}=await open(state,theme);
    if(theme==='light'){await p.locator('#fr-requests-open').click();let dialog=p.getByRole('dialog',{name:'Requests'});await dialog.waitFor();await dialog.locator('[data-request-accept]').click();await until(p,()=>!document.querySelector('[role="dialog"]')&&document.querySelector('#fr-requests-open')?.textContent.includes('Requests (1)'),'accepted request refresh');
     await p.locator('#fr-requests-open').click();dialog=p.getByRole('dialog',{name:'Requests'});await dialog.waitFor();await dialog.locator('[data-request-cancel]').click();await until(p,()=>!document.querySelector('[role="dialog"]')&&!document.querySelector('#fr-requests-open'),'cancelled request refresh');
     await p.goto(base+'/me/friends?find=1');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-invite'),'Find friends restored after requests');}
    await p.locator('#fr-find input').fill(targetName);await until(p,name=>document.querySelector('#fr-found')?.getAttribute('aria-busy')==='false'&&document.querySelector('#fr-found')?.textContent.includes(name),'search Add target',targetName);assert.equal(await p.locator('#fr-status').innerText(),'1 person found','the live result count is the only heading');assert.equal(await p.locator('#fr-found h2').count(),0,'search results have no duplicate People heading');assert.equal(await p.locator('#fr-found > .card').count(),0,'search results have no card wrapper');assert.equal(await p.locator('#fr-found > .person').count(),1,'search result is a plain row');const rowStyle=await p.locator('#fr-found > .person').evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],shadow:s.boxShadow};});assert.equal(rowStyle.background,'rgba(0, 0, 0, 0)','search result row has no filled box');assert.deepEqual(rowStyle.borders,['0px','0px','0px','0px'],'search result row has no border');assert.equal(rowStyle.shadow,'none','search result row has no box shadow');assert.equal(await p.locator('#fr-found [data-add] svg').count(),1,'search action uses the supported plus icon');const searchBox=await p.locator('#fr-found [data-add]').boundingBox();assert.equal(searchBox.width,44,'search action keeps a 44px target');assert.equal(searchBox.height,44,'search action keeps a 44px target');await capture(p,`find-friends-search-390-${theme}`);
    let resolveAdd,addWrites=[];const add=p.locator('#fr-found [data-add]').first();await p.route('**/api/friends',async r=>{if(r.request().method()==='POST'&&r.request().postDataJSON().login===targetLogin){addWrites.push(r.request().url());await new Promise(resolve=>resolveAdd=resolve);return r.continue();}return r.continue();});
    const click=add.click();await until(p,()=>document.querySelector('#fr-found [data-add]')?.classList.contains('is-pending'),'Add enters pending');assert.equal(typeof resolveAdd,'function','the pending Add request is held for the style check');const pendingStyle=await add.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,busy:el.getAttribute('aria-busy'),label:el.getAttribute('aria-label'),icon:!!el.querySelector('svg')}));assert.notEqual(pendingStyle.background,'rgba(0, 0, 0, 0)','pending Add fills with accent');assert.equal(pendingStyle.color,'rgb(255, 255, 255)','pending Add uses white text');assert.equal(pendingStyle.busy,'true');assert.match(pendingStyle.label,/Sending request to/);assert.equal(pendingStyle.icon,true,'pending Add keeps the plus inside its 44px circle');await capture(p,`find-friends-add-pending-390-${theme}`);resolveAdd();await click;
    await until(p,()=>document.querySelector('#fr-found .friend-status')?.textContent.includes('Requested'),'request becomes a quiet Requested tick');const status=await p.locator('#fr-found .friend-status').evaluate(el=>({color:getComputedStyle(el).color,tick:getComputedStyle(el.querySelector('span')).color}));assert.equal(status.color,status.tick,'Requested uses one muted grey tick and label');await capture(p,`find-friends-requested-390-${theme}`);
    assert(addWrites.some(url=>new URL(url).pathname==='/api/friends'),'Add sends one explicit friend request');assert.deepEqual(errors,[]);await close(c);console.log(`Find friends actions ${theme}: search, pending accent plus and muted Requested tick PASS`);
   }
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='management'){
   for(const theme of ['light','dark']){
    const {c,p,errors,writes}=await open('typical',theme);
    await p.goto(base+'/people/zz_test_fc_peer00');await until(p,()=>App.pageReady&&!!document.querySelector('#person-profile [data-person-manage]'),'friend profile Manage action');
    await p.locator('#person-profile [data-person-manage]').click();await p.locator('[data-remove]').waitFor();await p.locator('[data-block]').waitFor();
    await p.locator('[data-remove]').click();await p.locator('[data-confirm]').waitFor();assert.equal(await p.locator('[data-confirm]').innerText(),'Remove','Remove is reachable through a friend profile');await p.locator('[data-keep]').click();await until(p,()=>!document.querySelector('[data-confirm]'),'Remove confirmation closes');
    await p.locator('#person-profile [data-person-manage]').click();await p.locator('[data-block]').waitFor();await p.locator('[data-block]').click();await p.locator('[data-confirm]').waitFor();assert.equal(await p.locator('[data-confirm]').innerText(),'Block','Block is reachable through a friend profile');await p.locator('[data-keep]').click();
    assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'friend management sheets do not write until confirmation');await close(c);console.log(`Find friends management ${theme}: Remove and Block are reachable from a friend's profile PASS`);
   }
  }
 }finally{for(const c of contexts)await c.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
