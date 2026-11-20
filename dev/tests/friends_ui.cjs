// Fictional guarded accounts; real friend/search APIs, no providers or real devices.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill',viewportWidth=Number(process.env.KINETTA_FRIEND_WIDTH||390);
assert([330,390].includes(viewportWidth),'Friends UI width is 330px or 390px');
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
(async()=>{
 const inviteOnly=process.env.KINETTA_FRIEND_CASE==='invite';
 if(!inviteOnly&&process.env.KINETTA_FRIEND_SKIP_FIXTURE!=='1'){const fixture=cp.execFileSync('python3',[path.join(__dirname,'friends_compact_fixture.py')],{env:process.env,encoding:'utf8'});console.log(fixture.trim());}
 const browser=await chromium.launch(),contexts=[];
 async function open(state,theme,size={width:viewportWidth,height:844},initialPath='/me/friends?find=1',options={}){
  const c=await browser.newContext({viewport:size,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_fc_'+state,password:pw}})).status(),200);
  await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  const p=await c.newPage(),errors=[],writes=[],searches=[],qrRequests=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  p.on('request',r=>{if(new URL(r.url()).pathname==='/static/vendor/qrcode.js')qrRequests.push(r.url());});
  p.on('request',r=>{const u=new URL(r.url());if(u.origin===base&&u.pathname==='/api/people/search')searches.push(u.searchParams.get('q')||'');});
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='GET'&&u.pathname==='/api/groups')return r.fulfill({json:[{id:'00000000-0000-4000-8000-000000000091',title:'Fictional walk group',event_date:'2026-12-01',time_zone:'UTC',member_count:2,closed:false},{id:'00000000-0000-4000-8000-000000000092',title:'Closed fictional group',event_date:'2026-12-02',time_zone:'UTC',member_count:2,closed:true}]});if(options.noRequests&&q.method()==='GET'&&u.pathname==='/api/friends'){const response=await r.fetch(),data=await response.json();return r.fulfill({response,json:{...data,incoming:[],outgoing:[]}});}if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(u.pathname==='/api/friends'||u.pathname.startsWith('/api/friends/zz_test_fc_')||u.pathname.startsWith('/api/people/zz_test_fc_'))return r.continue();return r.fulfill({json:{}});}return r.continue();});
  if(state==='typical'&&initialPath.includes('find=1')){
   await p.route('**/api/people/suggested',async route=>{const response=await route.fetch(),rows=await response.json();return route.fulfill({response,json:rows.map(person=>person.login==='zz_test_fc_peer01'?{...person,photo:'fixture-avatar-v1'}:person)});});
   await p.route('**/api/people/zz_test_fc_peer01/photo?v=fixture-avatar-v1',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#7c3aed"/><circle cx="20" cy="15" r="8" fill="#fff"/><path d="M5 40c1-10 7-15 15-15s14 5 15 15" fill="#fff"/></svg>'}));
  }
  const homeRoute=initialPath==='/activity',friends=homeRoute?null:p.waitForResponse(r=>new URL(r.url()).pathname==='/api/friends'&&r.request().method()==='GET');
  const suggested=initialPath.includes('find=1')?p.waitForResponse(r=>new URL(r.url()).pathname==='/api/people/suggested'&&r.request().method()==='GET'):null;
  await p.goto(base+initialPath);if(friends)await friends;if(suggested)await suggested;
  const readySelector=homeRoute?'#feed-top .acts':initialPath.includes('find=1')?'.friends-page #fr-invite':'#fr-own-list';await until(p,selector=>App.pageReady&&!!document.querySelector(selector),homeRoute?'Home ready':initialPath.includes('find=1')?'Find friends ready':'My friends ready',readySelector);await p.evaluate(()=>document.fonts.ready.then(()=>true));
  if(suggested)await until(p,()=>{const box=document.querySelector('#fr-suggest');return box&&((box.parentElement.hidden)||box.querySelector('.pym-row,.friend-state-message'));},'suggestions loaded');
  return{c,p,errors,writes,searches,qrRequests};
 }
 async function close(c){await c.close();contexts.splice(contexts.indexOf(c),1);}
 async function closeSheet(p){await p.locator('[data-close]').last().click();await until(p,()=>!document.querySelector('[role="dialog"]'),'sheet closed');}
 async function settle(p){await p.evaluate(async()=>{await document.fonts.ready;const animations=[...document.querySelectorAll('.scrim,.sheet')].flatMap(el=>el.getAnimations());await Promise.all(animations.map(a=>a.finished.catch(()=>{})));});}
 async function capture(p,name){if(!out)return;await settle(p);fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
 try{
  for(const state of ['empty','typical','heavy'])for(const theme of ['light','dark']){
   const name=`${state}-${viewportWidth}-${theme}`;if(process.env.KINETTA_FRIEND_CASE&&process.env.KINETTA_FRIEND_CASE!==name)continue;
   const expectedIncoming={empty:0,typical:1,heavy:3}[state],expectedSuggestions={empty:0,typical:5,heavy:1}[state];
   const {c,p,errors,writes,searches}=await open(state,theme);
   assert.equal(await p.locator('#fr-title').innerText(),'Find friends');assert.equal(await p.locator('#fr-title').evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length;}),1,'complete heading stays on one line');
   for(const selector of ['#fr-own-list','#fr-lists','.friend-empty','#fr-sharing','.friend-footer','a[aria-label="Your profile"]','a[href="/me/sharing"]'])assert.equal(await p.locator(selector).count(),0,`removed from Find friends: ${selector}`);
   assert(!/Your friends will appear here|New activities:\s*Everyone/.test(await p.locator('#page').innerText()),'no friends explainer or sharing setting');
   assert.equal(await p.locator('#fr-find input').getAttribute('aria-label'),'Search name or @username');assert.equal(await p.locator('#fr-invite').count(),1);
   assert.equal(await p.locator('#fr-contacts').getAttribute('href'),'/me/friends/contacts');assert.equal(await p.locator('#fr-groups-discover').getAttribute('href'),'/me/groups');assert.equal(await p.locator('#fr-sent-toggle').innerText(),state==='typical'?'Sent requests · 1':state==='heavy'?'Sent requests · 2':'Sent requests');
   const moreOrder=await p.evaluate(()=>{const ids=['#fr-discover','#fr-requests','#fr-suggest','#fr-invite','.friend-more-ways'];const nodes=ids.map(id=>document.querySelector(id));return nodes.every((node,i)=>node&&(!i||nodes[i-1].compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING));});assert(moreOrder,'search, Waiting, Suggested, Invite and More ways follow the approved order');
   const waitTitle=p.locator('#fr-waiting-title'),searchRect=await p.locator('.people-search').boundingBox();if(state==='empty')assert.equal(await waitTitle.count(),0,'no Waiting heading without incoming requests');else{assert.equal((await waitTitle.innerText()).replace(/\s+/g,' ').trim(),`Waiting for you ${expectedIncoming}`);const gap=await waitTitle.evaluate(el=>el.getBoundingClientRect().top)-searchRect.y-searchRect.height;assert(gap>=26,`Waiting heading has the requested extra space below search: ${gap}px`);}
   assert.equal(await p.locator('#fr-find input').evaluate(el=>document.activeElement===el),false,'Find friends search does not autofocus');
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Find friends has no horizontal overflow');
   const outgoing={empty:0,typical:1,heavy:2}[state];
   if(expectedIncoming){assert.equal(await p.locator('.friend-inline-accept').count(),expectedIncoming);assert.equal(await p.locator('[data-request-decline]').count(),expectedIncoming);assert.equal(await p.locator('.friend-request-count').innerText(),String(expectedIncoming));assert.equal(await p.locator('.friend-request-section').count(),1,'Waiting for you is one plain section');}else assert.equal(await waitTitle.count(),0,'no empty request section');
   if(outgoing)assert.equal(await p.locator('#fr-sent-toggle').innerText(),`Sent requests · ${outgoing}`);else assert.equal(await p.locator('#fr-sent-toggle').innerText(),'Sent requests');
   const suggestions=p.locator('#fr-suggest .pym-row');
   if(expectedSuggestions){
    assert.equal(await suggestions.count(),expectedSuggestions,state==='typical'?'suggestions are capped at five':'mutual connections explain every suggestion');assert.match(await p.locator('#fr-suggest').innerText(),/1 mutual/);assert(!/New on Kinetta/.test(await p.locator('#fr-suggest').innerText()));
    const suggestTitle=p.locator('#fr-suggest > .friend-suggest-title'),suggestGroup=p.locator('#fr-suggest .friend-suggestion-group');assert.equal(await suggestTitle.innerText(),'Suggested');const titleStyle=await suggestTitle.evaluate(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color,body:getComputedStyle(document.body).color}));assert.equal(`${titleStyle.size}/${titleStyle.weight}`,'17px/600','Suggested uses the standard primary section heading style');assert.equal(titleStyle.color,titleStyle.body,'Suggested heading uses primary text');const suggestStyle=await suggestGroup.evaluate(el=>({shadow:getComputedStyle(el).boxShadow,radius:getComputedStyle(el).borderRadius,bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopWidth,rows:[...el.children].map(row=>({height:row.getBoundingClientRect().height,border:getComputedStyle(row).borderTopWidth}))}));assert.equal(suggestStyle.shadow,'none');assert.equal(suggestStyle.radius,'0px');assert.equal(suggestStyle.bg,'rgba(0, 0, 0, 0)');assert.equal(suggestStyle.border,'0px');assert(suggestStyle.rows.every((row,index)=>row.height>=56&&row.height<=60&&row.border===(index?'1px':'0px')),`suggested rows use plain 60px rows with inset dividers: ${JSON.stringify(suggestStyle.rows)}`);
    for(const row of await suggestions.all()){
     assert.equal(await row.locator('.pym-actions > *').count(),1,'one trailing Add action per suggestion');assert.equal(await row.locator('[data-hide]').count(),0);
     assert.equal(await row.locator('[data-add] svg').count(),1,'suggestion action uses the supported plus icon');const box=await row.locator('[data-add]').boundingBox();assert(box.width>=44&&box.height>=44,'suggestion plus keeps a 44px hit area');const addStyle=await row.locator('[data-add]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,border:getComputedStyle(el).borderRadius}));assert.equal(addStyle.background,'rgba(0, 0, 0, 0)','suggestion plus is a bare text action');assert.notEqual(addStyle.color,await row.locator('[data-add]').evaluate(el=>getComputedStyle(document.body).color));assert.equal(addStyle.border,'0px','suggestion plus has no pill');
     const readable=await row.locator('.person-link b').evaluate(el=>({text:el.textContent,overflow:el.scrollWidth>el.clientWidth+1,ellipsis:getComputedStyle(el).textOverflow}));assert(readable.text.length&& !readable.overflow&&readable.ellipsis!=='ellipsis','suggestion names stay readable');
    }
    if(state==='typical'){
     const photoRow=p.locator('.pym-row[data-login="zz_test_fc_peer01"] .av'),fallbackRow=p.locator('.pym-row[data-login="zz_test_fc_peer02"] .av');
     await photoRow.locator('img').waitFor({state:'visible'});assert(await photoRow.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),'suggested people show their uploaded photo through the shared avatar helper');
     assert.equal(await fallbackRow.locator('img').count(),0,'people without a photo keep the shared initials fallback');assert.equal((await fallbackRow.innerText()).trim(),'FF','initials remain visible when there is no photo');
    }
    if(state==='typical'){
     if(out)await capture(p,`find-friends-suggested-${viewportWidth}-${theme}`);
     const incoming=p.locator('#fr-requests .fr-request');assert.equal(await incoming.count(),1);assert.equal(await incoming.locator('[data-request-accept]').innerText(),'Accept');assert.equal(await incoming.locator('[data-request-decline]').innerText(),'Decline');assert.equal(await p.getByRole('dialog',{name:'Requests'}).count(),0,'request actions stay inline on the page');if(viewportWidth===330){const layout=await incoming.first().evaluate(row=>({copyWidth:row.querySelector('.person-link .grow').getBoundingClientRect().width,actionHeights:[...row.querySelectorAll('.friend-inline-actions button')].map(el=>el.getBoundingClientRect().height)}));assert(layout.copyWidth>=160,`incoming requester copy has room to stay readable at 330px: ${JSON.stringify(layout)}`);assert(layout.actionHeights.every(height=>height>=44),'request actions retain 44px targets at 330px');}
     if(out)await capture(p,`find-friends-requests-${viewportWidth}-${theme}`);
    }
   }else assert.equal(await suggestions.count(),0,'no suggestions without a real connection');
   if(state==='empty'){
    assert.equal(await p.locator('#fr-find input').evaluate(n=>document.activeElement===n),false,'Find friends does not autofocus search on entry');
    assert.equal(await p.locator('#fr-waiting-title').count(),0,'empty discovery has no Waiting for you heading');assert.equal(await p.locator('#fr-requests .fr-request').count(),0,'empty discovery has no request rows');
    if(out)await capture(p,`find-friends-empty-${viewportWidth}-${theme}`);
    await p.goto(base+'/activity');await until(p,()=>App.pageReady&&!!document.querySelector('#ff-list')&&document.querySelector('#feed-tools')?.getAttribute('aria-busy')==='false','empty Activity ready');
    const rootActions=p.locator('#feed-top .shell-topbar-root .shell-topbar-actions');assert.equal(await rootActions.locator(':is(a,button)').count(),3,'Home keeps Find friends, Notifications and Record or import');assert.equal(await rootActions.getByRole('link',{name:'Find friends'}).count(),1,'Home friend search is named');assert.equal(await rootActions.getByRole('link',{name:/^Notifications(?:, \d+ new)?$/}).count(),1,'Home Notifications keep the live count');assert.equal(await rootActions.getByRole('link',{name:'Record or import a workout'}).count(),1,'Home recorder is named');assert.equal(await p.locator('#feed-tools .feed-find-friends').count(),0,'Find friends is not duplicated in the feed tools');assert.equal(await p.locator('#ff-list .feed-empty').count(),1,'fictional account has an empty feed');
    if(out){await settle(p);fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,`activity-header-root-actions-${viewportWidth}-${theme}.png`),clip:{x:0,y:0,width:viewportWidth,height:160}});await capture(p,`activity-empty-feed-${viewportWidth}-${theme}`);}
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
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='no-requests')for(const theme of ['light','dark']){
   const {c,p,errors,writes}=await open('typical',theme,{width:viewportWidth,height:844},'/me/friends?find=1',{noRequests:true});
   assert.equal(await p.locator('#fr-waiting-title').count(),0,'no-request state hides Waiting for you');assert.equal(await p.locator('#fr-requests .fr-request').count(),0,'no-request state has no request rows');assert.equal(await p.locator('#fr-sent-toggle').innerText(),'Sent requests','no-request state has no sent requests');assert.equal(await p.locator('#fr-suggest .pym-row').count(),5,'suggestions remain available when there are no requests');
   if(out)await capture(p,`find-friends-no-requests-${viewportWidth}-${theme}`);assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'no-request discovery remains read-only');await close(c);console.log(`Find friends no-requests ${viewportWidth}px ${theme}: suggestions without request sections PASS`);
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='pr2-states')for(const theme of ['light','dark']){
   {
    const {c,p}=await open('typical',theme);await p.locator('#fr-find input').fill('Fictional Sent 1');await until(p,()=>document.querySelector('#fr-found [data-request-menu]'),'Requested connection state');await until(p,()=>document.querySelector('#fr-status')?.textContent==='1 person found','connection result count settles');if(out)await capture(p,`find-friends-connection-${viewportWidth}-${theme}`);await close(c);
   }
   {
    const {c,p}=await open('empty',theme);await p.route('**/api/people/search*',route=>route.fulfill({json:[]}));
    await p.locator('#fr-find input').fill('Missing Fictional Person');await until(p,()=>document.querySelector('#fr-found')?.textContent.includes('No one found for'),'no-results copy');
    assert.match(await p.locator('#fr-found').innerText(),/Check the spelling or invite them/);assert.equal(await p.locator('#fr-found [data-no-results-invite]').innerText(),'Invite a friend');const inviteGap=await p.locator('#fr-found [data-no-results-invite]').evaluate(button=>button.getBoundingClientRect().top-button.previousElementSibling.getBoundingClientRect().bottom);assert(inviteGap>=16,`no-results copy has 16px separation from Invite: ${inviteGap}px`);
    if(out)await capture(p,`find-friends-no-results-${viewportWidth}-${theme}`);await close(c);
   }
   {
    const {c,p}=await open('typical',theme);let fail=true;await p.route('**/api/people/search*',route=>{if(fail){fail=false;return route.fulfill({status:503,json:{message:'fixture failure'}});}return route.continue();});
    await p.locator('#fr-find input').fill('Fictional Friend 07');await until(p,()=>document.querySelector('#fr-found')?.textContent.includes("Search isn't working right now."),'search error copy');
    assert.equal(await p.locator('#fr-found [data-retry]').innerText(),'Try again');if(out)await capture(p,`find-friends-search-error-${viewportWidth}-${theme}`);
    await p.locator('#fr-found [data-retry]').click();await until(p,()=>document.querySelector('#fr-found')?.getAttribute('aria-busy')==='false'&&document.querySelector('#fr-found')?.textContent.includes('Fictional Friend 07'),'search retry succeeds');await close(c);
   }
   {
    const {c,p}=await open('retry',theme),targetLogin=theme==='light'?'zz_test_fc_peer19':'zz_test_fc_peer20',targetName=theme==='light'?'Fictional Friend 20':'Fictional Friend 21';let fail=true;
    await p.route('**/api/friends',route=>{if(fail&&route.request().method()==='POST'&&route.request().postDataJSON().login===targetLogin){fail=false;return route.fulfill({status:503,json:{message:'fixture failure'}});}return route.continue();});
    await p.locator('#fr-find input').fill(targetName);await until(p,()=>document.querySelector('#fr-found [data-add]'),'Add error target');await p.locator('#fr-found [data-add]').click();await until(p,()=>document.querySelector('#fr-found .friend-row-error')?.textContent==="Couldn't send. Try again.",'Add error copy');assert.equal(await p.locator('#fr-found [data-add]').isDisabled(),false,'failed Add returns to an enabled action');
    if(out)await capture(p,`find-friends-add-error-${viewportWidth}-${theme}`);await p.locator('#fr-found [data-add]').click();await until(p,()=>document.querySelector('#fr-found [data-request-menu]'),'Add retry shows Requested');await close(c);
   }
   {
    const {c,p}=await open('typical',theme);await c.setOffline(true);await p.waitForFunction(()=>navigator.onLine===false);await p.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await until(p,()=>document.querySelector('#fr-suggest')?.textContent.includes('You’re offline'),'offline suggestion placeholder');
    assert.equal(await p.locator('#fr-requests [data-request-accept]').isDisabled(),true,'offline Accept is disabled');
    if(out)await capture(p,`find-friends-offline-${viewportWidth}-${theme}`);await close(c);
   }
   console.log(`Find friends PR2 empty/error/offline ${viewportWidth}px ${theme}: copy, retry and disabled actions PASS`);
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='pr2-actions'||process.env.KINETTA_FRIEND_CASE==='pr2-states'){
   const {c,p}=await open('actions','light');
   await p.locator('#fr-find input').fill('Fictional Action Friend');await until(p,()=>document.querySelector('#fr-found')?.textContent.includes('Fictional Action Friend'),'existing friend search');assert.equal((await p.locator('#fr-found .friend-status').innerText()).replace(/\s+/g,' ').trim(),'✓ Friends');
   await p.locator('#fr-find input').fill('Fictional Sent 1');await until(p,()=>document.querySelector('#fr-found [data-request-menu]'),'sent request search');await p.locator('#fr-found [data-request-menu]').click();assert.equal(await p.locator('#fr-found [data-request-cancel]').innerText(),'Cancel');assert.equal(await p.locator('#fr-found [data-request-keep]').innerText(),'Keep');await p.locator('#fr-found [data-request-keep]').click();assert.equal(await p.locator('#fr-found [data-request-menu]').isVisible(),true,'Keep restores Requested');await p.locator('#fr-found [data-request-menu]').click();await p.locator('#fr-found [data-request-cancel]').click();await until(p,()=>document.querySelector('#fr-found [data-add]'),'Cancel restores Add');
   await p.locator('#fr-find input').fill('Casey Request 1');await until(p,()=>document.querySelector('#fr-found [data-friend-accept]'),'incoming request search');await p.locator('#fr-found [data-friend-accept]').click();await until(p,()=>document.querySelector('#fr-found .friend-status')?.textContent.includes('Friends'),'search Accept refreshes to Friends');
   await close(c);console.log('Find friends PR2 action states: Friends, Requested/Keep and incoming Accept PASS');
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='list'){
   for(const state of ['empty','typical','heavy'])for(const theme of ['light','dark']){
    const {c,p,errors,writes}=await open(state,theme,{width:viewportWidth,height:844},'/me/friends');
    await p.goto(base+'/me/friends');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-own-list'),'My friends ready');
    assert.equal(await p.locator('#fr-title').innerText(),'Friends','Me → Friends opens the friends list');assert.equal(await p.locator('.top .back').getAttribute('aria-label'),'Back to Me');
    assert.equal(await p.locator('#fr-find').count(),0,'the friends list has no discovery search');assert.equal(await p.locator('.pym-tile').count(),0,'suggestions stay on Find friends');
    const friendRows=p.locator('#fr-own-list .fr-friend'),expectedFriends={empty:0,typical:1,heavy:40}[state],expectedRequests={empty:0,typical:2,heavy:5}[state],expectedIncoming={empty:0,typical:1,heavy:3}[state];
    assert.equal(await friendRows.count(),expectedFriends,'Me → Friends shows existing friends');
    const listSearch=p.locator('#fr-list-find'),searchInput=listSearch.locator('input');assert.equal(await listSearch.count(),1,'Me → Friends has one visible search row');assert.equal(await searchInput.getAttribute('placeholder'),'Name or @username');assert.equal(await searchInput.getAttribute('aria-label'),'Search name or @username');assert.equal(await p.locator('#fr-browse').count(),0,'the redundant header icon is removed');const searchBox=await listSearch.boundingBox();assert(searchBox.width>=44&&searchBox.height>=44,'Friends search is a 44px-or-larger target');
    const add=p.locator('#fr-list-add');assert.equal(await add.innerText(),'Add','Friends uses one clear invite action in the title bar');const addBox=await add.boundingBox();assert(addBox.width>=44&&addBox.height>=44,'Add keeps a 44px target');assert.equal(await p.locator('#fr-list-invite').count(),0,'the title-bar action is not repeated below Requests');
    assert.equal(await p.locator('.large-title-heading').innerText(),'Friends');assert.equal(await p.locator('.large-title-heading').getAttribute('data-type'),'title');assert.equal(await p.locator('.large-title-heading').evaluate(el=>getComputedStyle(el).fontSize),'28px','the page starts with a large title');
    if(state==='heavy'&&theme==='light'){assert.equal(await p.locator('.top.large-title h1').evaluate(el=>getComputedStyle(el).opacity),'0','the compact title stays quiet while the large title is visible');await p.evaluate(()=>window.scrollTo(0,400));await p.waitForFunction(()=>getComputedStyle(document.querySelector('.top.large-title h1')).opacity==='1');await p.evaluate(()=>window.scrollTo(0,0));await p.waitForFunction(()=>getComputedStyle(document.querySelector('.top.large-title h1')).opacity==='0');}
    const groups=p.locator('#fr-social-links');assert.equal(await groups.locator('#fr-groups .grow b').innerText(),'Groups');assert.equal(await groups.locator('#fr-groups .grow small').innerText(),'Private groups and events','Groups row has a concrete subtitle');const groupsCopy=await groups.locator('#fr-groups .grow').evaluate(el=>({titleDisplay:getComputedStyle(el.querySelector('b')).display,subtitleDisplay:getComputedStyle(el.querySelector('small')).display,subtitleGap:getComputedStyle(el.querySelector('small')).marginTop}));assert.equal(groupsCopy.titleDisplay,'block');assert.equal(groupsCopy.subtitleDisplay,'block');assert.equal(groupsCopy.subtitleGap,'2px');assert.equal(await groups.locator('#fr-groups svg circle').count(),2,'the Friends list uses the group icon');const groupStyle=await groups.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius,border:getComputedStyle(el).borderTopWidth,shadow:getComputedStyle(el).boxShadow,iconBg:getComputedStyle(el.querySelector('.ri')).backgroundColor}));assert.notEqual(groupStyle.bg,'rgba(0, 0, 0, 0)');assert.equal(groupStyle.radius,'18px');assert.equal(groupStyle.border,'1px');assert.equal(groupStyle.shadow,'none');assert.notEqual(groupStyle.iconBg,'rgba(0, 0, 0, 0)');
    const manage=p.locator('#fr-own-list [data-manage]');assert.equal(await manage.count(),expectedFriends);assert(await manage.evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;})),'friend management remains reachable from each row');
    assert(await friendRows.evaluateAll(nodes=>nodes.every(row=>getComputedStyle(row.querySelector('.fr-friend-link'),'::after').content==='none'&&!!row.querySelector('[data-manage]'))),'friend rows keep one visible manage affordance without a duplicate chevron');
    if(expectedRequests){const row=p.locator('#fr-requests-open');assert.equal(await row.getAttribute('aria-label'),'Review friend requests');assert((await row.boundingBox()).height>=44,'Requests summary is a full-width action');assert.equal(await row.locator('.count').count(),expectedIncoming?1:0,'only requests awaiting me are counted');if(expectedIncoming)assert.equal(await row.locator('.count').innerText(),String(expectedIncoming));assert.equal(await row.locator('.grow small').count(),0,'no waiting/sent subtitle duplicates the badge');const title=await row.locator('.grow b').evaluate(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight,body:getComputedStyle(document.body).color}));assert.equal(title.color,title.body,'request title is neutral in the Friends list');assert.equal(title.weight,'600');}
    else assert.equal(await p.locator('#fr-requests-open').count(),0,'no empty Requests row');
    if(state==='empty'){
     const empty=p.locator('.friend-empty');assert.equal(await empty.locator('b').innerText(),'No friends yet');assert.equal(await empty.locator('p').innerText(),'Search by name or @username, or tap Add to share an invite link.');assert.equal(await empty.locator('b').evaluate(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color,body:getComputedStyle(document.body).color})).then(x=>`${x.size}/${x.weight}/${x.color===x.body}`),'15px/600/true','the empty-state title is inset and uses primary text');assert.equal(await empty.evaluate(el=>getComputedStyle(el).padding),'14px 16px','the empty-state copy has comfortable card padding');assert.equal(await empty.locator('p').evaluate(el=>getComputedStyle(el).fontSize),'14px','the next-step copy stays readable');assert.equal(await p.locator('#fr-empty-browse').count(),0,'the search and Add actions are named in the copy, without duplicate rows');
    }else assert.equal(await friendRows.first().locator('.person-link').getAttribute('href'),'/people/zz_test_fc_peer00','a friend row opens that friend’s profile');
    assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'My friends has no horizontal overflow');
    if(out&&(state==='typical'||state==='empty'))await capture(p,`my-friends-${state}-${viewportWidth}-${theme}`);
    if(state==='typical'&&theme==='light'){await add.click();await p.getByRole('dialog',{name:'Invite friends'}).waitFor();await closeSheet(p);}
    if(state==='typical'){
     await p.locator('#fr-requests-open').click();const inline=p.locator('#fr-requests-content');await inline.waitFor({state:'visible'});assert.equal(await inline.locator('.fr-request').count(),2);assert.equal(await inline.locator('[data-request-cancel]').innerText(),'Cancel');assert.equal(await p.getByRole('dialog',{name:'Requests'}).count(),0,'requests expand inline');if(out)await capture(p,`my-friends-requests-${viewportWidth}-${theme}`);
    }
    if(state==='typical'&&theme==='light')await searchInput.fill('Fictional Friend 07');await searchInput.press('Enter');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-invite')&&new URLSearchParams(location.search).get('find')==='1','Find friends search opens discovery');if(state==='typical'&&theme==='light'){assert.equal(new URL(p.url()).searchParams.get('q'),'Fictional Friend 07');await until(p,()=>document.querySelector('#fr-found')?.getAttribute('aria-busy')==='false'&&document.querySelector('#fr-found')?.textContent.includes('Fictional Friend 07'),'quick search results');assert.equal(await p.locator('#fr-found .person').count(),1,'quick search carries the typed name into directory results');assert.equal(await p.locator('#fr-find input').evaluate(el=>document.activeElement===el),false,'search route does not open the keyboard unexpectedly');}
    assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'viewing the friends list has no write side effects');await close(c);console.log(`My friends ${state} ${theme}: list, Requests, Find friends and 44px actions PASS`);
   }
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE.startsWith('home-search'))for(const width of [390,330])for(const theme of ['light','dark']){
   const name=`home-search-${width}-${theme}`;if(process.env.KINETTA_FRIEND_CASE&&process.env.KINETTA_FRIEND_CASE!=='home-search'&&process.env.KINETTA_FRIEND_CASE!==name)continue;
   const {c,p,errors,writes}=await open('empty',theme,{width,height:844},'/activity'),entry=p.locator('#feed-top a.home-find-friends');
   assert.equal(await entry.getAttribute('aria-label'),'Find friends','Home exposes a named friend-search action');assert.equal(await entry.innerText(),'','the magnifier has no visible text label');
   const action=await entry.boundingBox(),header=await p.locator('#feed-top .top').boundingBox(),titleLines=await p.locator('#feed-top h1').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;});
   assert(action&&action.width>=44&&action.height>=44,'the magnifier has a 44px touch target');assert(header&&action.x+action.width<=header.x+header.width+1,`Home actions fit the ${width}px header`);assert.equal(titleLines,1,'Home title stays on one line');
   assert.equal(await p.locator('#feed-tools .feed-find-friends').count(),0,'the header search is not duplicated in Feed tools');assert.equal(await p.locator('.feed-empty a[href="/me/friends?find=1"]').count(),1,'the existing empty-feed entry remains intact');
   await entry.click();await p.waitForURL('**/me/friends?find=1&from=home');
   const search=p.locator('#fr-find input');await search.waitFor({state:'visible'});assert.equal(await search.evaluate(el=>document.activeElement===el),false,'Find friends opens without unexpectedly focusing the keyboard');
   const back=p.locator('#page [data-back]');assert.equal((await back.innerText()).trim(),'Home','the Find friends back label names Home');assert.equal(await back.getAttribute('aria-label'),'Back to Home');
   await back.click();await p.waitForURL('**/activity');assert.equal(await p.locator('#feed-top h1').innerText(),'Home');assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'opening Find friends and returning Home is read-only');
   await close(c);console.log(`Home friend search ${width}px ${theme}: 44px label, unfocused search and Home back PASS`);
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='actions'){
   for(const theme of ['light','dark']){
    const state=theme==='light'?'typical':'empty',targetLogin=theme==='light'?'zz_test_fc_peer06':'zz_test_fc_peer07',targetName=theme==='light'?'Fictional Friend 07':'Fictional Friend 08';
    const {c,p,errors}=await open(state,theme);
    if(theme==='light'){const accept=p.locator('#fr-requests [data-request-accept]');assert.equal(await accept.count(),1,'incoming request actions are visible inline');const acceptBox=await accept.boundingBox();assert(acceptBox.width>=44&&acceptBox.height>=44,'Accept is a 44px target');await accept.click();await until(p,()=>!document.querySelector('#fr-requests [data-request-accept]')&&document.querySelector('#fr-sent-toggle')?.textContent.includes('Sent requests'),'accepted request refresh');
     await p.locator('#fr-sent-toggle').click();const sent=p.locator('#fr-sent');await sent.waitFor({state:'visible'});const cancel=sent.locator('[data-request-cancel]');assert.equal(await cancel.count(),1,'sent requests appear under More ways');await cancel.click();await until(p,()=>document.querySelector('#fr-sent-toggle')?.textContent==='Sent requests'&&!document.querySelector('#fr-sent [data-request-cancel]'),'cancelled sent request refresh');
     await p.goto(base+'/me/friends?find=1');await until(p,()=>App.pageReady&&!!document.querySelector('#fr-invite'),'Find friends restored after requests');}
    await p.locator('#fr-find input').fill(targetName);await until(p,name=>document.querySelector('#fr-found')?.getAttribute('aria-busy')==='false'&&document.querySelector('#fr-found')?.textContent.includes(name),'search Add target',targetName);assert.equal(await p.locator('#fr-status').innerText(),'1 person found','the live result count is the only heading');assert.equal(await p.locator('#fr-found h2').count(),0,'search results have no duplicate People heading');assert.equal(await p.locator('#fr-found > .card').count(),0,'search results have no card wrapper');assert.equal(await p.locator('#fr-found > .person').count(),1,'search result is a plain row');const rowStyle=await p.locator('#fr-found > .person').evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],shadow:s.boxShadow};});assert.equal(rowStyle.background,'rgba(0, 0, 0, 0)','search result row has no filled box');assert.deepEqual(rowStyle.borders,['0px','0px','0px','0px'],'search result row has no border');assert.equal(rowStyle.shadow,'none','search result row has no box shadow');assert.equal(await p.locator('#fr-found [data-add] svg').count(),1,'search action uses the supported plus icon');const searchBox=await p.locator('#fr-found [data-add]').boundingBox();assert(searchBox.width>=44&&searchBox.height>=44,'search action keeps a 44px target');await p.locator('#fr-title').scrollIntoViewIfNeeded();await capture(p,`find-friends-search-${viewportWidth}-${theme}`);
    let resolveAdd,addWrites=[];const add=p.locator('#fr-found [data-add]').first();await p.route('**/api/friends',async r=>{if(r.request().method()==='POST'&&r.request().postDataJSON().login===targetLogin){addWrites.push(r.request().url());await new Promise(resolve=>resolveAdd=resolve);return r.continue();}return r.continue();});
    const click=add.click();await until(p,()=>document.querySelector('#fr-found [data-add]')?.classList.contains('is-pending'),'Add enters pending');assert.equal(typeof resolveAdd,'function','the pending Add request is held for the style check');const pendingStyle=await add.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,busy:el.getAttribute('aria-busy'),label:el.getAttribute('aria-label'),icon:!!el.querySelector('svg')}));assert.notEqual(pendingStyle.background,'rgba(0, 0, 0, 0)','pending Add fills with accent');assert.equal(pendingStyle.color,'rgb(255, 255, 255)','pending Add uses white text');assert.equal(pendingStyle.busy,'true');assert.match(pendingStyle.label,/Sending request to/);assert.equal(pendingStyle.icon,true,'pending Add keeps the plus inside its 44px circle');await capture(p,`find-friends-add-pending-${viewportWidth}-${theme}`);resolveAdd();await click;
    await until(p,()=>document.querySelector('#fr-found [data-request-menu]')?.textContent==='Requested','request becomes the Requested action');const status=await p.locator('#fr-found [data-request-menu]').evaluate(el=>({text:el.textContent,color:getComputedStyle(el).color,body:getComputedStyle(document.body).color,background:getComputedStyle(el).backgroundColor,borderRadius:getComputedStyle(el).borderRadius}));assert.equal(status.text,'Requested');assert.notEqual(status.color,status.body,'Requested stays secondary to the person name');assert.equal(status.background,'rgba(0, 0, 0, 0)','Requested stays unfilled');assert.equal(status.borderRadius,'0px','Requested is not a pill');await capture(p,`find-friends-requested-${viewportWidth}-${theme}`);
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
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='qr'){
   const {c,p,errors,writes,qrRequests}=await open('empty','light');
   assert.equal(qrRequests.length,0,'loading Social for Find friends does not preload QR');
   await p.locator('#fr-invite').click();await p.getByRole('dialog',{name:'Invite friends'}).waitFor();
   await p.locator('#iv-qr').click();await p.locator('#iv-qr-code svg[aria-label="QR code for your Kinetta invite link"]').waitFor();
   assert.equal(qrRequests.length,1,'the invite action loads QR on demand');await p.locator('#iv-qr').click();assert.equal(qrRequests.length,1,'repeated QR action reuses the loaded script and graphic');
   assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(x=>!x.endsWith('/api/challenges/signup/continue')),[],'QR generation has no write side effects');await close(c);
   const stale=await open('empty','light');assert.equal(stale.qrRequests.length,0);await stale.p.locator('#fr-invite').click();await stale.p.getByRole('dialog',{name:'Invite friends'}).waitFor();
   await stale.p.evaluate(()=>{window.__pendingInviteQrBox=document.querySelector('#iv-qr-code');});let qrStarted=false,releaseQr;
   await stale.p.route('**/static/vendor/qrcode.js*',async route=>{qrStarted=true;await new Promise(resolve=>{releaseQr=resolve;});await route.continue();});await stale.p.locator('#iv-qr').click();
   for(let attempt=0;attempt<100&&!qrStarted;attempt++)await stale.p.waitForTimeout(20);assert(qrStarted,'the invite QR action starts its lazy request');
   assert.equal((await stale.c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_fc_typical',password:pw}})).status(),200,'second fictional owner signs in');
   const newOwner=await(await stale.c.request.get(base+'/api/me')).json();await stale.p.evaluate(me=>refreshMe(me),newOwner);
   await until(stale.p,()=>App.pageReady&&App.me?.login==='zz_test_fc_typical','second fictional owner becomes current');releaseQr();
   let qrLoaded=false;for(let attempt=0;attempt<100;attempt++){qrLoaded=await stale.p.evaluate(()=>classicScriptsLoaded.has(QR_CODE_ASSET));if(qrLoaded)break;await stale.p.waitForTimeout(20);}
   assert(qrLoaded,'the invite QR script load and stale callback complete after owner change');
   assert.equal(stale.qrRequests.length,1,'the old invite QR request completes after owner change');assert.equal(await stale.p.evaluate(()=>window.__pendingInviteQrBox?.querySelector('svg')||null),null,'old-owner invite does not render after its deferred load');
   assert.equal(await stale.p.locator('#iv-qr-code svg').count(),0,'new owner has no stale invite QR');assert.deepEqual(stale.errors,[]);await close(stale.c);
   console.log('Find friends QR: action-only load, deduplication and late old-owner guard PASS');
  }
  if(!process.env.KINETTA_FRIEND_CASE||process.env.KINETTA_FRIEND_CASE==='invite'){
   async function openInvite(theme,width){
    const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
    assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
    await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));return{c,p,errors};
   }
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {c,p,errors}=await openInvite(theme,width);let accepted=0;
    await p.route('**/api/friend-links/invite-ui-test',route=>{
     if(route.request().method()==='POST'){accepted++;return route.fulfill({json:{status:'friends',name:'Fictional Sender',login:'zz_test_fc_sender',new:true}});}
     return route.fulfill({json:{name:'@river'}});
    });
    await p.goto(base+'/add/invite-ui-test');await p.locator('#af-yes').waitFor();
    assert.equal(await p.locator('.friend-invite-screen h1').innerText(),'River');assert.equal(await p.locator('.friend-invite-handle').innerText(),'@river');
    assert.equal(await p.locator('.friend-invite-screen .av').evaluate(el=>{const r=el.getBoundingClientRect();return[r.width,r.height]}).then(box=>box.join(',')),'72,72');
    assert.equal(await p.locator('.friend-invite-caption').innerText(),'You’ll see each other’s shared workouts.');assert.equal(await p.locator('#af-yes').innerText(),'Add friend');assert.equal(await p.locator('.friend-invite-later').innerText(),'Not now');
    assert(await p.locator('#af-yes').evaluate((el,min)=>{const r=el.getBoundingClientRect();return r.width>=min&&r.height>=44;},width-90),'Add friend is a full-width touch target');assert(await p.locator('.friend-invite-later').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44&&getComputedStyle(el).fontSize==='15px'&&getComputedStyle(el).fontWeight==='600'&&getComputedStyle(el).color===getComputedStyle(document.body).color;}),'Not now is 15px/600 primary text with a 44px target');
    assert.equal(await p.locator('#af-yes').evaluate(el=>getComputedStyle(el).backgroundColor),theme==='light'?'rgb(37, 99, 235)':'rgb(47, 100, 216)','invite action uses the solid, contrast-safe action token in both themes');
    assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Friend invite fits ${width}px (${theme})`);await capture(p,`friend-invite-${width}-${theme}`);await p.locator('#af-yes').click();await p.waitForURL('**/people/zz_test_fc_sender');assert.equal(accepted,1,'Add friend accepts the existing invite exactly once');assert.deepEqual(errors,[]);await close(c);
   }
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {c,p,errors}=await openInvite(theme,width);
    await p.route('**/api/friend-links/invite-expired',route=>route.fulfill({status:404,json:{detail:'This invite link has expired or was replaced. Ask for a new one.'}}));
    await p.goto(base+'/add/invite-expired');await p.locator('.friend-invite-unavailable').waitFor();const text=await p.locator('.friend-invite-unavailable').innerText();
    assert.equal(text.replace(/\n+/g,'\n'),'This invite isn’t available\nGo home','invalid link has one generic line and a home action');assert(!text.includes('expired')&&!text.includes('replaced'),'invalid state does not reveal token status');await capture(p,`friend-invite-invalid-${width}-${theme}`);assert.deepEqual(errors,[]);await close(c);
   }
   console.log('Friend invite 390/330 light/dark: accept, unavailable and 44px actions PASS');
  }
 }finally{for(const c of contexts)await c.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
