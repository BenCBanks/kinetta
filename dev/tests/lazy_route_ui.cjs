'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setProgressFlags}=require('./progress_flags_fixture.cjs');
const trackFixture=require('../demo/track_session.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const password='green teapot on the hill';
const user='zz_test_explore_new';
const meReady='.me-card-sections[aria-busy="false"]';
async function login(context,loginName=user){const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:loginName,password}});assert.equal(response.status(),200,`fictional Explore account ${loginName} logs in`);}
async function until(page,predicate,label,arg){
  for(let i=0;i<150;i++){
    try{if(await page.evaluate(predicate,arg))return;}catch(_){/* navigation can replace the document between polls */}
    await page.waitForTimeout(100);
  }
  const diagnostics=await page.evaluate(()=>{
    let ready=null;try{ready=App.pageReady;}catch(_){}
    return {path:location.pathname,pageReady:ready,pageText:document.querySelector('#page')?.textContent?.trim().slice(0,180)||'',bodyText:document.body?.textContent?.trim().slice(0,240)||''};
  }).catch(error=>({diagnosticError:error.message}));
  throw new Error(`Timed out: ${label}; diagnostics=${JSON.stringify(diagnostics)}`);
}
async function ready(page,selector,label=`page ready with ${selector}`){await until(page,s=>{try{return App.pageReady&&!!document.querySelector(s);}catch(_){return false;}},label,selector);}
async function fixtureContext(browser){return browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});}
async function filterRequests(page,explore){await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/static/explore.js')return explore(route);if(!['GET','HEAD'].includes(request.method()))return route.abort();return route.continue();});}
async function filterFoodRequests(page,food,blockedWrites=[]){await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/static/food-import.js')return food(route);if(!['GET','HEAD'].includes(request.method())){if(!(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue'))blockedWrites.push(`${request.method()} ${url.pathname}`);return route.abort();}return route.continue();});}
async function welcomeFixture(browser,loginName=user,{failFirst=false,hold=false}={}){
 const context=await fixtureContext(browser);await login(context,loginName);
 const page=await context.newPage(),requests=[],writes=[],errors=[];let releaseHeld=()=>{},finishHeld=()=>{},heldOnce=false;
 const held=new Promise(resolve=>{releaseHeld=resolve;}),done=new Promise(resolve=>{finishHeld=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/welcome.js'){
   requests.push(url.href);
   if(failFirst&&requests.length===1)return route.abort();
   if(hold&&!heldOnce){heldOnce=true;finishHeld();await held;}
   return route.continue();
  }
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return {context,page,requests,writes,errors,release:()=>releaseHeld(),done};
}
async function holdExplore(page,{instrument=false}={}){
  let openGate,finishRequest;
  const gate=new Promise(resolve=>{openGate=resolve;}),done=new Promise(resolve=>{finishRequest=resolve;});
  let requests=0;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/static/explore.js'){
      requests++;
      if(instrument){
        const response=await route.fetch(),body=await response.text();await gate;
        const probe='\n;(()=>{const entry=App.pages.find(page=>page.re.test("/me/explore"));const original=entry.fn;entry.fn=(...args)=>{window.testExploreOwners.push(App.me.login);return original(...args);};})();';
        await route.fulfill({response,body:body+probe});
      }else{await gate;await route.continue();}
      finishRequest();return;
    }
    if(!['GET','HEAD'].includes(request.method()))return route.abort();
    return route.continue();
  });
  return {release:openGate,count:()=>requests,done};
}
async function holdFood(page,{instrument=false,blockedWrites=[]}={}){
  let openGate,finishRequest;
  const gate=new Promise(resolve=>{openGate=resolve;}),done=new Promise(resolve=>{finishRequest=resolve;});
  let requests=0;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/static/food-import.js'){
      requests++;
      if(instrument){
        const response=await route.fetch(),body=await response.text();await gate;
        const probe='\n;(()=>{const entry=App.pages.find(page=>page.re.test("/food/import"));const original=entry.fn;entry.fn=(...args)=>{window.testFoodOwners.push(App.me.login);return original(...args);};})();';
        await route.fulfill({response,body:body+probe});
      }else{await gate;await route.continue();}
      finishRequest();return;
    }
    if(!['GET','HEAD'].includes(request.method())){if(!(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue'))blockedWrites.push(`${request.method()} ${url.pathname}`);return route.abort();}
    return route.continue();
  });
  return {release:openGate,count:()=>requests,done};
}
async function foodRouteFixture(browser,{hold=false,failFirst=false,instrument=false,idleGate=false,holdAsset=null,failAsset=null,fakeDishCreation=false}={}){
 const context=await fixtureContext(browser);await login(context);
 const page=await context.newPage(),assets=[],errors=[],writes=[],attempts=new Map();let heldOnce=false,releaseHeld=()=>{},signalHeld=()=>{},finishHeld=()=>{},dishCreations=0;
 const heldPath=holdAsset||(hold?'/static/food.js':null),failedPath=failAsset||(failFirst?'/static/food.js':null);
 const gate=new Promise(resolve=>{releaseHeld=resolve;}),held=new Promise(resolve=>{signalHeld=resolve;}),done=new Promise(resolve=>{finishHeld=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 if(idleGate)await page.addInitScript(()=>{window.__foodIdleCallbacks=[];let id=0;window.requestIdleCallback=callback=>{window.__foodIdleCallbacks.push(callback);return ++id;};window.cancelIdleCallback=()=>{};});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base)return route.abort();
  if(['/static/food.js','/static/kit.js','/static/cook.js','/static/recipe-import.js','/static/onboarding.js'].includes(url.pathname)){
   assets.push(url.pathname);
   const count=(attempts.get(url.pathname)||0)+1;attempts.set(url.pathname,count);
   if(url.pathname===failedPath&&count===1)return route.abort();
   if(url.pathname===heldPath&&!heldOnce){heldOnce=true;let response,body;if(instrument&&url.pathname==='/static/food.js'){response=await route.fetch();body=await response.text();}signalHeld();await gate;
     if(instrument&&url.pathname==='/static/food.js'){const probe='\n;(()=>{const entry=App.pages.find(page=>page.re.test("/food"));const original=entry.fn;entry.fn=(...args)=>{window.testFoodOwners.push(App.me.login);return original(...args);};})();';await route.fulfill({response,body:body+probe});}
     else await route.continue();finishHeld();return;
   }
   return route.continue();
  }
  if(fakeDishCreation&&request.method()==='POST'&&url.pathname==='/api/dishes'){
   dishCreations++;return route.fulfill({status:201,json:{id:900001}});
  }
  if(fakeDishCreation&&request.method()==='GET'&&url.pathname==='/api/dishes/900001')return route.fulfill({status:404,json:{error:'Fictional recipe not found'}});
  if(request.method()==='POST'&&url.pathname==='/api/coach/conversation/visits'){
   writes.push(`${request.method()} ${url.pathname}`);
   return route.fulfill({json:{visit_id:request.postDataJSON().visit_id,generation:'11111111-1111-4111-8111-111111111111',ready:true}});
  }
  if(request.method()==='GET'&&url.pathname==='/api/coach/conversation'){
   return route.fulfill({json:{visit_id:url.searchParams.get('visit_id'),generation:'11111111-1111-4111-8111-111111111111',messages:[],before:null,ready:true}});
  }
  if(request.method()==='POST'&&/^\/api\/coach\/conversation\/visits\/[^/]+\/end$/.test(url.pathname)){
   writes.push(`${request.method()} ${url.pathname}`);
   return route.fulfill({json:{ok:true}});
  }
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return {context,page,assets,errors,writes,held,done,release:()=>releaseHeld(),foodAttempts:()=>attempts.get('/static/food.js')||0,assetAttempts:path=>attempts.get(path)||0,dishCreations:()=>dishCreations};
}

const notificationItems=[
  {id:1,kind:'monthly_summary',period_type:'month',period:'2026-10',text:'Your October summary is ready',detail:'Fictional month',link:'/notifications?summary=2026-10',created:'2026-10-31T12:00:00Z',read:true,who:{name:'Kinetta'}},
  {id:2,kind:'monthly_summary',period_type:'year',period:'2025',text:'Your 2025 summary is ready',detail:'Fictional year',link:'/notifications?year=2025',created:'2026-01-01T12:00:00Z',read:true,who:{name:'Kinetta'}},
];
async function notificationRoutes(context,{failFirst=false,hold=false,recordOwner=false}={}){
  const scriptRequests=[],writes=[],apiOwners=[];let attempts=0,releaseHeld,finishHeld,heldOnce=false;
  const held=new Promise(resolve=>{releaseHeld=resolve;}),done=new Promise(resolve=>{finishHeld=resolve;});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/static/social-notifications.js'){
      attempts++;scriptRequests.push(url.href);
      if(failFirst&&attempts===1)return route.abort();
      const response=await route.fetch(),source=await response.text();
      if(hold&&!heldOnce){heldOnce=true;await held;}
      const ownerProbe=recordOwner?`(()=>{const page=App.pages.find(item=>item.re.test('/me/notifications')),original=page.fn;page.fn=(...args)=>{window.__notificationRouteOwners.push(App.me.login);return original(...args);};})();`:'';
      await route.fulfill({response,body:source+`\n;window.__notificationSummaryCalls=[];window.__notificationRouteOwners=[];Recaps.open=options=>window.__notificationSummaryCalls.push(options);${ownerProbe}\n`});
      if(hold)finishHeld();
      return;
    }
    if(url.pathname==='/api/notifications'&&request.method()==='GET'){
      apiOwners.push(request.headers()['x-kinetta-account']||'');
      return route.fulfill({json:{items:notificationItems,unread:0,push:{},push_ready:true}});
    }
    if(url.pathname==='/api/notifications/count'&&request.method()==='GET')return route.fulfill({json:{unread:3,friend_requests:0}});
    if(url.pathname==='/api/challenges/signup/continue'&&request.method()==='POST')return route.fulfill({json:{}});
    if(url.pathname==='/api/notifications/personal')return route.fulfill({json:{plan:false,weekly:false,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
    if(url.pathname==='/api/food/reminders')return route.fulfill({json:{enabled:false,tz:'UTC',push_ready:true,device_ready:true,times:[]}});
    if(url.pathname==='/api/account/signin-email')return route.fulfill({json:{on:false}});
    if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:204,body:''});}
    return route.continue();
  });
  return {scriptRequests,writes,apiOwners,release:releaseHeld,done};
}
async function notificationFixture(browser,loginName=user,options={}){
  const context=await fixtureContext(browser);await login(context,loginName);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-11-05T12:00:00Z')});
  const routes=await notificationRoutes(context,options);return {context,page,errors,routes};
}
async function socialFixture(browser,{failFirst=false,failFriendsFirst=false,idleGate=false}={}){
 const context=await fixtureContext(browser);await login(context);
 const page=await context.newPage(),assets=[],friendsAssets=[],routeAssets=[],errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
 if(idleGate)await page.addInitScript(()=>{window.__socialIdleCallbacks=[];window.requestIdleCallback=callback=>{window.__socialIdleCallbacks.push(callback);return window.__socialIdleCallbacks.length;};window.cancelIdleCallback=()=>{};});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/social.js'){
   assets.push(url.pathname);routeAssets.push(url.pathname);if(failFirst&&assets.length===1)return route.abort();
  }
  if(url.pathname==='/static/friends-ui.js'){
   friendsAssets.push(url.pathname);routeAssets.push(url.pathname);if(failFriendsFirst&&friendsAssets.length===1)return route.abort();
  }
  if(url.pathname==='/api/notifications/count')return route.fulfill({json:{unread:3,friend_requests:2,friend_count:2}});
  if(request.method()==='POST'&&['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(url.pathname))return route.fulfill({status:204,body:''});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return {context,page,assets,friendsAssets,routeAssets,errors,writes};
}
async function friendsLeafChecks(browser){
 const me=await socialFixture(browser,{idleGate:true});
 try{
  await me.page.goto(base+'/me');await ready(me.page,meReady,'Me before FriendsUI route entry');
  await me.page.waitForFunction(()=>window.__socialIdleCallbacks.length>0);
  assert.deepEqual(me.friendsAssets,[],'FriendsUI is absent from the cold Me request sequence');
  assert.equal(await me.page.evaluate(()=>typeof FriendsUI),'undefined','Me does not evaluate the FriendsUI leaf');
  const routing=await me.page.evaluate(()=>['/me/friends','/me/friends/contacts','/me/groups'].map(path=>{
   const bundle=lazyRouteBundles.find(item=>item.re.test(path));
   return [path,!!bundle&&bundle.scripts.includes(FRIENDS_UI_ASSET)];
  }));
  assert.deepEqual(routing,[['/me/friends',true],['/me/friends/contacts',false],['/me/groups',false]],'only the Friends page route owns the FriendsUI leaf');
  await me.page.goto(base+'/me/friends/contacts');await ready(me.page,'#contacts-not-now','direct Contacts route without FriendsUI');
  assert.deepEqual(me.friendsAssets,[],'Contacts loads without requesting FriendsUI');
  assert.equal(await me.page.evaluate(()=>typeof ContactsUI),'object','ContactsUI remains available on its existing eager path');
  assert.deepEqual(me.writes,[],'opening Contacts did not trigger a write before its explicit action');
  assert.deepEqual(me.errors,[]);
 }finally{await me.context.close();}

 const retry=await socialFixture(browser,{failFriendsFirst:true});
 try{
  await retry.page.goto(base+'/me/friends?find=1',{waitUntil:'domcontentloaded'});await retry.page.locator('.load-error').waitFor();
  assert.deepEqual(retry.routeAssets,['/static/social.js','/static/friends-ui.js'],'direct Friends loads Social before its dependent UI leaf');
  await retry.page.locator('#retry').click();await ready(retry.page,'#fr-invite','Friends after leaf retry');
  assert.equal(new URL(retry.page.url()).pathname,'/me/friends','retry preserves the direct Friends route');
  assert.deepEqual(retry.routeAssets,['/static/social.js','/static/friends-ui.js','/static/friends-ui.js'],'failed FriendsUI load retries without reloading Social');
  assert.deepEqual(retry.friendsAssets,['/static/friends-ui.js','/static/friends-ui.js']);
  assert.equal(await retry.page.evaluate(()=>typeof FriendsUI),'object');
  assert.equal(await retry.page.locator('#fr-find input').count(),1,'Find friends search remains available after route load');
  assert.equal(await retry.page.locator('#fr-invite').count(),1,'Invite action remains available after route load');
  assert.deepEqual(retry.errors,[]);assert.deepEqual(retry.writes,[],'loading and retrying Friends performs no writes');
 }finally{await retry.context.close();}
}
async function progressFixture(browser,{fail=null,hold=null,loginName=user}={}){
 const context=await fixtureContext(browser);await login(context,loginName);
 const page=await context.newPage(),assets=[],errors=[],writes=[],previews=[];let heldOnce=false,releaseHeld=()=>{},signalHeld=()=>{};
 const gate=new Promise(resolve=>{releaseHeld=resolve;}),held=new Promise(resolve=>{signalHeld=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(['/static/intervals.js','/static/plan.js','/static/planner.js','/static/progress-routes.js','/static/segments.js'].includes(url.pathname)){
   assets.push(url.pathname);const attempts=assets.filter(path=>path===url.pathname).length;
   if(fail===url.pathname&&attempts===1)return route.abort();
   if(hold===url.pathname&&!heldOnce){heldOnce=true;signalHeld();await gate;}
   return route.continue();
  }
  if(request.method()==='POST'&&url.pathname==='/api/plans/preview'){
   previews.push(url.pathname);return route.continue();
  }
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return {context,page,assets,errors,writes,previews,held,release:()=>releaseHeld()};
}
async function activeIntervalFixture(browser){
 const context=await fixtureContext(browser);await login(context);
 const me=await(await context.request.get(base+'/api/me')).json(),page=await context.newPage(),assets=[],errors=[],writes=[];
 const preset=require('./fixtures/interval_presets.json')[0],recording=trackFixture();
 recording.native=true;recording.gps=false;recording.points=[];recording.distance=0;recording.splits=[];recording.state='recording';recording.intervals={pin:preset.pin,phases:preset.expected_steps,index:0,status:'running',time:30,distance:90,phase_time:0,phase_distance:0,phase_ignored_distance:0,results:[],effects:[]};
 await page.addInitScript(({base,id,recording})=>localStorage.setItem('kinetta.track:'+JSON.stringify([base,id]),JSON.stringify(recording)),{base,id:me.id,recording});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/intervals.js')assets.push(url.pathname);
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return{context,page,assets,errors,writes,recording};
}
async function getAppLogoutFixture(browser){
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
 await login(context);const me=await(await context.request.get(base+'/api/me')).json(),page=await context.newPage(),assets=[],errors=[];
 const ownKey='intervals:'+JSON.stringify([base,me.id])+':selected',foreignKey='intervals:'+JSON.stringify([base,me.id+1])+':selected',ownValue=JSON.stringify({fixture:'own'}),foreignValue=JSON.stringify({fixture:'foreign'});
 await page.addInitScript(({ownKey,foreignKey,ownValue,foreignValue})=>{localStorage.setItem('kinetta.getApp',JSON.stringify('1'));localStorage.setItem(ownKey,ownValue);localStorage.setItem(foreignKey,foreignValue);},{ownKey,foreignKey,ownValue,foreignValue});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(url.pathname==='/static/intervals.js'){assets.push(url.pathname);return route.abort();}
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())&&url.pathname!=='/api/logout')return route.abort();
  return route.continue();
 });
 return{context,page,assets,errors,ownKey,foreignKey,ownValue,foreignValue};
}
async function activitySegmentFixture(browser,{failPlannerFirst=false}={}){
 const context=await fixtureContext(browser);await login(context);
 const page=await context.newPage(),assets=[],errors=[],writes=[];let plannerAttempts=0;
 const activityId='987654321',line='_p~iF~ps|U_ulLnnqC_mqNvxq`@';
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(['/static/intervals.js','/static/planner.js','/static/segments.js'].includes(url.pathname)){
   assets.push(url.pathname);
   if(url.pathname==='/static/planner.js'&&++plannerAttempts===1&&failPlannerFirst)return route.abort();
   return route.continue();
  }
  if(url.pathname===`/api/activities/${activityId}/segment-efforts`)return route.fulfill({json:{processing:false,efforts:[],assistance:'unassisted',assistance_revision:1,excluded:false}});
  if(url.pathname===`/api/activities/${activityId}/sections`)return route.fulfill({json:{sport:'run',sections:[{line,distance_m:1200}]}});
  if(url.pathname===`/api/activities/${activityId}`)return route.fulfill({json:{id:Number(activityId),name:'Fictional test run',sport:'run',sport_label:'Run',start_time:'2026-10-30T12:00:00Z',created:'2026-10-30T12:00:00Z',distance_m:1200,moving_s:360,elapsed_s:365,line,visibility:'me',source:'manual',splits_km:[],splits_mi:[],efforts:[],photos:[],summary_overrides:{}}});
  if(request.method()==='POST'&&url.pathname==='/api/milestones/celebrate')return route.fulfill({status:204});
  if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});
  if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  return route.continue();
 });
 return {context,page,assets,errors,writes,activityId};
}
(async()=>{const browser=await chromium.launch();try{
  if(process.env.KINETTA_FRIENDS_LAZY_ONLY==='1'){
    await friendsLeafChecks(browser);console.log('FriendsUI lazy leaf: cold Me, direct route order/retry and Contacts independence PASS');return;
  }
  const socialMe=await socialFixture(browser,{idleGate:true});
  try{
    await socialMe.page.goto(base+'/me');await ready(socialMe.page,meReady,'Me without the social bundle');
    await socialMe.page.waitForFunction(()=>window.__socialIdleCallbacks.length>0);
    assert.deepEqual(socialMe.assets,[],'social.js does not delay the first useful Me screen');
    assert.equal(await socialMe.page.evaluate(()=>typeof Social),'undefined','Me renders before the social routes are loaded');
    assert.equal(await socialMe.page.evaluate(()=>typeof weeklyRecapShareItem),'function','the Me card share action can load its recap on first tap');
    assert.deepEqual(await socialMe.page.evaluate(()=>[typeof profileHref,friendCountText(0)]),['function','No friends yet'],'Me keeps its small profile-link and friend-count helpers eager');
    const mapped=await socialMe.page.evaluate(()=>[
      '/activity','/activity/123','/activity/friends/123','/people/zz_test_friend','/add/fictional-token','/me/explore','/food/cook/42','/progress',
      '/me/friends','/me/friends/contacts','/me/groups','/groups/12345678-1234-1234-1234-123456789012',
      '/group-invite/fictional-token','/me/sharing','/notifications','/me/notifications',
    ].map(path=>{const bundle=lazyRouteBundles.find(item=>item.re.test(path));return [path,!!bundle&&bundle.scripts.includes(SOCIAL_ROUTE_ASSET)];}));
    assert(mapped.every(([,included])=>included),`routes that render Social-owned icons or controls load social.js first: ${JSON.stringify(mapped)}`);
    const unrelated=await socialMe.page.evaluate(()=>[
      '/me/challenges','/challenge/fictional-code','/food/recipe-link','/track/lift/42','/lift/ex/42',
    ].map(path=>{const bundle=lazyRouteBundles.find(item=>item.re.test(path));return [path,!!bundle&&bundle.scripts.includes(SOCIAL_ROUTE_ASSET)];}));
    assert(unrelated.every(([,included])=>!included),`unrelated lazy routes do not load social.js: ${JSON.stringify(unrelated)}`);
    await socialMe.page.evaluate(()=>window.__socialIdleCallbacks.splice(0).forEach(callback=>callback({didTimeout:false,timeRemaining:()=>50})));
    await socialMe.page.waitForFunction(()=>typeof Social==='object');
    assert.equal(socialMe.assets.length,1,'social.js warms after Me is useful');
    assert.deepEqual(socialMe.friendsAssets,[],'the released Social warmup still does not load FriendsUI');
    assert.equal(await socialMe.page.evaluate(()=>typeof FriendsUI),'undefined','Me remains FriendsUI-free after Social warmup');
    await socialMe.page.waitForFunction(()=>App.me.notifications===3&&App.me.friend_requests===2,null,{timeout:8000});
    assert.deepEqual(await socialMe.page.evaluate(()=>{
      const badge=document.querySelector('nav.tabs a[data-tab="me"] .tab-n');
      return {friendCount:badge?.firstChild?.textContent.trim(),accessible:badge?.textContent.trim()};
    }),{friendCount:'2',accessible:'2 new friend requests'},'idle warmup restores the friend-request badge');
    await socialMe.page.evaluate(()=>go('/activity'));await ready(socialMe.page,'#feed-tools','Home after its social bundle is warm');
    assert.equal(await socialMe.page.locator('.bell').getAttribute('aria-label'),'Notifications, 3 new','Home shows the unread count after Social warmup');
    assert.equal(await socialMe.page.locator('.bell-dot').textContent(),'3');
    assert.equal(socialMe.assets.length,1,'Home reuses the warmed bundle');
    assert.deepEqual(socialMe.errors,[]);assert.deepEqual(socialMe.writes,[]);
  }finally{await socialMe.context.close();}

  const socialFirstTap=await socialFixture(browser,{idleGate:true});
  try{
    await socialFirstTap.page.goto(base+'/me');await ready(socialFirstTap.page,meReady,'Me before first Social tap');
    await socialFirstTap.page.waitForFunction(()=>window.__socialIdleCallbacks.length>0);
    assert.equal(socialFirstTap.assets.length,0,'Social is still idle when Me becomes useful');
    assert.equal(await socialFirstTap.page.evaluate(()=>typeof Social),'undefined');
    await socialFirstTap.page.locator('.me-friends-link').click();
    await ready(socialFirstTap.page,'#fr-own-list','Friends opens before idle warmup');
    assert.equal(socialFirstTap.assets.length,1,'the Friends tap loads Social directly without waiting for idle');
    assert.deepEqual(socialFirstTap.errors,[]);assert.deepEqual(socialFirstTap.writes,[]);
  }finally{await socialFirstTap.context.close();}

  const socialRetry=await socialFixture(browser,{failFirst:true});
  try{
    await socialRetry.page.goto(base+'/activity',{waitUntil:'domcontentloaded'});await socialRetry.page.locator('.load-error').waitFor();
    assert(await socialRetry.page.locator('#retry').isVisible(),'a failed Home bundle shows a visible retry');
    await socialRetry.page.locator('#retry').click();await ready(socialRetry.page,'#feed-tools','Home after social retry');
    assert.equal(socialRetry.assets.length,2,'retry clears the failed promise and requests social.js again');
    assert.deepEqual(socialRetry.errors,[]);assert.deepEqual(socialRetry.writes,[]);
  }finally{await socialRetry.context.close();}

  await friendsLeafChecks(browser);

  const context=await fixtureContext(browser);
  try{
    await login(context);const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests.push(route.request().url());return route.continue();});
    await page.goto(base+'/me');await ready(page,meReady);assert.equal(requests.length,0,'Explore is absent from the initial Me load');assert.equal(await page.locator('.me-tools a[href="/me/explore"]').count(),1,'Explore remains available from Me');
    await page.goto(base+'/me/explore');await ready(page,'#guide-results details','cold direct Explore route');assert.equal(requests.length,1,'cold direct links load Explore once');
    const lazyURL=new URL(requests[0]);assert.match(lazyURL.searchParams.get('v')||'',/^[0-9a-f]{32}$/,'the deferred bundle has its own build-stamped URL');
    assert.equal(new URL(page.url()).pathname,'/me/explore');assert.equal(await page.locator('nav.tabs a[data-tab="track"][aria-current="page"]').count(),1,'legacy Explore opens under Track');assert.deepEqual(await page.evaluate(()=>[typeof aiCan,typeof aiOffer,typeof kitChatOn]),['function','function','function'],'shared AI/Kit helpers stay eager');
    assert.deepEqual(errors,[],'Me and Explore load without browser errors');
  }finally{await context.close();}

  const retryContext=await fixtureContext(browser);
  try{
    await login(retryContext);const page=await retryContext.newPage(),errors=[];let requests=0;page.on('pageerror',error=>errors.push(error.message));
    await filterRequests(page,route=>{requests++;return requests===1?route.abort():route.continue();});
    await page.goto(base+'/me/explore',{waitUntil:'domcontentloaded'});await page.locator('.load-error').waitFor();
    assert.equal(new URL(page.url()).pathname,'/me/explore','a failed bundle keeps the legacy Explore URL');assert.equal(await page.locator('nav.tabs a[data-tab="track"][aria-current="page"]').count(),1,'the failed page remains in Track');assert(await page.locator('#retry').isVisible());
    await page.locator('#retry').click();await ready(page,'#guide-results details','Explore after explicit retry');assert.equal(requests,2,'retry clears the failed promise and requests the bundle again');assert.deepEqual(errors,[]);
  }finally{await retryContext.close();}

  const scrollContext=await fixtureContext(browser);
  try{
    await login(scrollContext);const page=await scrollContext.newPage();
    await page.goto(base+'/track');await ready(page,'#track-start');assert.equal(await page.locator('#track-explore a[href="/me/explore"]').count(),0,'Track no longer duplicates Explore');
    await page.goto(base+'/me');await ready(page,meReady,'Me entry for Explore');
    await page.evaluate(()=>{App.scroll['/me/explore']=120;});
    await page.locator('.me-tools a[href="/me/explore"]').click();
    await ready(page,'#guide-results details','deferred Explore with saved scroll');
    assert.equal(await page.evaluate(()=>scrollY),120,'the deferred render restores the saved route position once');
  }finally{await scrollContext.close();}

  const navigationContext=await fixtureContext(browser);
  try{
    await login(navigationContext);const page=await navigationContext.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdExplore(page);
    await page.goto(base+'/me');await ready(page,meReady,'Me before deferred Explore');
    await page.evaluate(()=>{
      const old=document.querySelector('#page');window.delayedOldPage=old;window.delayedOldPageCleaned=false;
      viewResources.set(old,()=>{window.delayedOldPageCleaned=true;});
      window.finishDelayedOldPage=()=>{if(old.isConnected)old.innerHTML='<p id="stale-old-page">Late former page response</p>';};
    });
    await page.locator('.me-tools a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.delayedOldPage.isConnected,window.delayedOldPageCleaned]),[false,true],'the prior main is unmounted through normal view cleanup before the bundle wait');
    await page.evaluate(()=>window.finishDelayedOldPage());
    assert.equal(await page.locator('#stale-old-page').count(),0,'a delayed former-page response cannot write into the loading shell');
    assert(await page.locator('.lazy-route-loading').isVisible());
    await page.locator('nav.tabs a[data-tab="me"]').click();await ready(page,meReady,'new Me route while Explore is pending');
    const finished=page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/static/explore.js');delayed.release();await finished;await delayed.done;await page.waitForTimeout(100);
    assert.equal(delayed.count(),1);assert.equal(new URL(page.url()).pathname,'/me');assert.equal(await page.locator('#guide-results').count(),0,'a stale route cannot replace newer Me navigation');assert.deepEqual(errors,[]);
  }finally{await navigationContext.close();}

  const accountContext=await fixtureContext(browser);
  try{
    await login(accountContext);const page=await accountContext.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdExplore(page,{instrument:true});
    await page.goto(base+'/me');await ready(page,meReady,'Me before account-change Explore');
    await page.evaluate(()=>{
      window.testExploreOwners=[];window.testDeferredPositions=[];
      const original=render;
      window.render=options=>{
        if(options?.routePosition)window.testDeferredPositions.push(options.routePosition.owner===readOwner());
        return original(options);
      };
    });
    await page.locator('.me-tools a[href="/me/explore"]').click();await page.locator('.lazy-route-loading').waitFor();
    await login(accountContext,'zz_test_explore_typical');
    const meResponse=await accountContext.request.get(base+'/api/me');assert.equal(meResponse.status(),200,'second fictional account profile loads');
    await page.evaluate(me=>refreshMe(me),await meResponse.json());
    await until(page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new account owns the pending Explore shell');
    delayed.release();await delayed.done;await ready(page,'#guide-results details','Explore after account change');
    assert.deepEqual(await page.evaluate(()=>window.testDeferredPositions),[true],'only the current account’s deferred continuation reaches render');
    assert.deepEqual(await page.evaluate(()=>window.testExploreOwners),['zz_test_explore_typical'],'Explore mounts for the current fictional account');
    assert.equal(new URL(page.url()).pathname,'/me/explore');assert.deepEqual(errors,[]);
  }finally{await accountContext.close();}

  const foodContext=await fixtureContext(browser);
  try{
    await login(foodContext);const page=await foodContext.newPage(),errors=[],assets=[],blockedWrites=[];page.on('pageerror',error=>errors.push(error.message));
    await filterFoodRequests(page,route=>{assets.push(route.request().url());return route.continue();},blockedWrites);
    await page.goto(base+'/me');await ready(page,meReady);assert.equal(assets.length,0,'Food import is absent from the initial Me load');
    await page.goto(base+'/food/import');await ready(page,'#hi-pick','cold direct Food import route');
    assert.equal(new URL(page.url()).pathname,'/food/import');assert.equal(assets.length,1,'a cold direct link loads Food import once');
    assert.equal(await page.locator('#page').evaluate(el=>el._backFallback),'/food?view=overview','direct Food import keeps its Nutrition Back fallback');
    assert.match(new URL(assets[0]).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'Food import uses its own build-stamped URL');
    assert.deepEqual(blockedWrites,[],'opening Food import attempts no writes');assert.deepEqual(errors,[]);
  }finally{await foodContext.close();}

  const foodMenuContext=await fixtureContext(browser);
  try{
    await login(foodMenuContext);const page=await foodMenuContext.newPage(),assets=[],cookAssets=[],blockedWrites=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname==='/static/cook.js')cookAssets.push(request.url());});
    await filterFoodRequests(page,route=>{assets.push(route.request().url());return route.continue();},blockedWrites);
    await page.goto(base+'/food');await ready(page,'a[href="/food/import"]','Food home with Add past days link');
    assert.equal(await page.evaluate(()=>typeof swipeRows==='function'),true,'Food keeps its shared row-swipe helper without eager Cook');
    assert.equal(cookAssets.length,0,'the Food home helper does not load Cook');
    await page.locator('a[href="/food/import"]').click();await ready(page,'#hi-pick','Food import opened from Nutrition');
    assert.equal(new URL(page.url()).pathname,'/food/import');assert.equal(assets.length,1,'the Nutrition menu link loads Food import once');
    assert.equal(cookAssets.length,0,'Food import also leaves Cook deferred');
    assert.deepEqual(blockedWrites,[],'menu navigation attempts no writes');assert.deepEqual(errors,[]);
  }finally{await foodMenuContext.close();}

  const foodRetryContext=await fixtureContext(browser);
  try{
    await login(foodRetryContext);const page=await foodRetryContext.newPage(),errors=[],blockedWrites=[];let requests=0;page.on('pageerror',error=>errors.push(error.message));
    await filterFoodRequests(page,route=>{requests++;return requests===1?route.abort():route.continue();},blockedWrites);
    await page.goto(base+'/food/import',{waitUntil:'domcontentloaded'});await page.locator('.load-error').waitFor();
    assert.equal(new URL(page.url()).pathname,'/food/import');assert(await page.locator('#retry').isVisible());
    await page.locator('#retry').click();await ready(page,'#hi-pick','Food import after explicit retry');
    assert.equal(requests,2,'retry requests Food import again after a failed bundle');assert.deepEqual(blockedWrites,[]);assert.deepEqual(errors,[]);
  }finally{await foodRetryContext.close();}

  const foodNavigationContext=await fixtureContext(browser);
  try{
    await login(foodNavigationContext);const page=await foodNavigationContext.newPage(),errors=[],blockedWrites=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdFood(page,{blockedWrites});
    await page.goto(base+'/food');await ready(page,'a[href="/food/import"]');
    await page.locator('a[href="/food/import"]').click();await page.locator('.lazy-route-loading').waitFor();
    await page.locator('nav.tabs a[data-tab="me"]').click();await ready(page,meReady,'Me while Food import is pending');
    const finished=page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/static/food-import.js');delayed.release();await finished;await delayed.done;await page.waitForTimeout(100);
    assert.equal(delayed.count(),1);assert.equal(new URL(page.url()).pathname,'/me');assert.equal(await page.locator('#hi-f').count(),0,'a stale Food import cannot replace newer Me navigation');assert.deepEqual(blockedWrites,[]);assert.deepEqual(errors,[]);
  }finally{await foodNavigationContext.close();}

  const foodAccountContext=await fixtureContext(browser);
  try{
    await login(foodAccountContext);const page=await foodAccountContext.newPage(),errors=[],blockedWrites=[];page.on('pageerror',error=>errors.push(error.message));
    const delayed=await holdFood(page,{instrument:true,blockedWrites});
    await page.goto(base+'/food');await ready(page,'a[href="/food/import"]');
    await page.evaluate(()=>{window.testFoodOwners=[];});
    await page.locator('a[href="/food/import"]').click();await page.locator('.lazy-route-loading').waitFor();
    await login(foodAccountContext,'zz_test_explore_typical');
    const meResponse=await foodAccountContext.request.get(base+'/api/me');assert.equal(meResponse.status(),200,'second fictional account profile loads');
    await page.evaluate(me=>refreshMe(me),await meResponse.json());
    await until(page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new account owns the pending Food import shell');
    delayed.release();await delayed.done;await ready(page,'#hi-pick','Food import after account change');
    assert.deepEqual(await page.evaluate(()=>window.testFoodOwners),['zz_test_explore_typical'],'Food import mounts for the current fictional account only');
    assert.equal(new URL(page.url()).pathname,'/food/import');assert.deepEqual(blockedWrites,[]);assert.deepEqual(errors,[]);
  }finally{await foodAccountContext.close();}

  const foodNativeContext=await fixtureContext(browser);
  try{
    await login(foodNativeContext);const page=await foodNativeContext.newPage(),errors=[],historyCalls=[],blockedWrites=[];page.on('pageerror',error=>errors.push(error.message));
    await filterFoodRequests(page,route=>route.continue(),blockedWrites);
    await page.route('**/api/food/history**',route=>{const request=route.request(),url=new URL(request.url()),todayRead=request.method()==='GET'&&url.pathname==='/api/food/history'&&url.search==='?days=30';if(!todayRead)historyCalls.push(`${request.method()} ${url.pathname}`);return request.method()==='GET'?route.continue():route.abort();});
    await page.goto(base+'/me');await ready(page,meReady);
    await page.evaluate(()=>{Native.on=true;});assert.equal(await page.evaluate(()=>Native.on),true,'native redirect fixture is enabled');
    await page.evaluate(()=>go('/food/import'));
    await until(page,()=>location.pathname==='/food','native Food import redirects to Nutrition');
    assert.deepEqual(historyCalls,[],'native redirect makes no import history preview/day/summary calls');assert.deepEqual(blockedWrites,[]);assert.deepEqual(errors,[]);
  }finally{await foodNativeContext.close();}

  // The two notification routes stay absent from the opening Me bundle and share one lazy asset.
  const normal=await notificationFixture(browser);
  try{
    await normal.page.goto(base+'/activity');await ready(normal.page,'#feed-tools');
    assert.equal(normal.routes.scriptRequests.length,0,'notification code is absent from the initial Activity/Me shell');
    assert.deepEqual(await normal.page.evaluate(()=>[typeof Social.badge,typeof noteRow,App.pageReady]),['function','undefined',true],'the Home badge controller is available while notification rows stay deferred');
    await normal.page.waitForFunction(()=>App.me.notifications===3);
    await normal.page.evaluate(()=>Social.badge());
    assert.equal(await normal.page.locator('.bell').getAttribute('aria-label'),'Notifications, 3 new','the eager bell still reflects the Social badge');
    await normal.page.locator('.bell').click();await ready(normal.page,'#nt-list','normal bell opens the lazy notification list');
    assert.equal(normal.routes.scriptRequests.length,1,'the bell route loads the bundle once');
    assert.match(new URL(normal.routes.scriptRequests[0]).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'the lazy notification asset has its own content hash');
    assert.equal(await normal.page.locator('[data-summary-type="month"]').count(),1);assert.equal(await normal.page.locator('[data-summary-type="year"]').count(),1);
    await normal.page.locator('[data-summary-type="month"]').click();
    assert.deepEqual(await normal.page.evaluate(()=>window.__notificationSummaryCalls.at(-1)),{period:'month',offset:1},'the month row opens its exact period');
    await normal.page.locator('[data-summary-type="year"]').click();
    assert.deepEqual(await normal.page.evaluate(()=>window.__notificationSummaryCalls.at(-1)),{period:'year',offset:1},'the year row opens its exact period');
    await normal.page.evaluate(()=>go('/me/settings'));await ready(normal.page,'a[href="/me/notifications"]','Settings route');
    await normal.page.locator('a[href="/me/notifications"]').click();await normal.page.locator('[data-meal-reminders]').waitFor();
    assert.equal(normal.routes.scriptRequests.length,1,'Settings reuses the already loaded notification bundle');
    assert.deepEqual(normal.errors,[]);assert.deepEqual(normal.routes.writes,[]);
  }finally{await normal.context.close();}

  for(const [path,selector] of [['/notifications','#nt-list'],['/me/notifications','#nt-push']]){
    const direct=await notificationFixture(browser);
    try{
      await direct.page.goto(base+path);await ready(direct.page,selector,`cold direct ${path}`);
      assert.equal(direct.routes.scriptRequests.length,1,`${path} loads the deferred module once`);
      assert.deepEqual(direct.errors,[]);assert.deepEqual(direct.routes.writes,[]);
    }finally{await direct.context.close();}
  }

  for(const [query,period] of [['?summary=2026-10','month'],['?year=2025','year']]){
    const direct=await notificationFixture(browser);
    try{
      await direct.page.goto(base+'/notifications'+query);await ready(direct.page,'#nt-list',`cold summary link ${query}`);
      const call=await direct.page.evaluate(()=>window.__notificationSummaryCalls[0]);
      assert.equal(call?.period,period,`${query} opens the requested summary through the deferred route`);
      assert.equal(call?.offset,period==='month'?1:1,`${query} keeps its summary period`);
      assert.deepEqual(direct.errors,[]);
    }finally{await direct.context.close();}
  }

  const retry=await notificationFixture(browser,user,{failFirst:true});
  try{
    await retry.page.goto(base+'/notifications',{waitUntil:'domcontentloaded'});await retry.page.locator('.load-error').waitFor();
    assert.equal(retry.routes.scriptRequests.length,1);await retry.page.locator('#retry').click();
    await ready(retry.page,'#nt-list','notification list after explicit retry');assert.equal(retry.routes.scriptRequests.length,2,'failed notification bundle is requested again');
    assert.deepEqual(retry.errors,[]);assert.deepEqual(retry.routes.writes,[]);
  }finally{await retry.context.close();}

  const stalePath=await notificationFixture(browser,user,{hold:true});
  try{
    await stalePath.page.goto(base+'/notifications',{waitUntil:'domcontentloaded'});await stalePath.page.locator('.lazy-route-loading').waitFor();
    await stalePath.page.locator('nav.tabs a[data-tab="me"]').click();await ready(stalePath.page,meReady,'Me while notifications are loading');
    stalePath.routes.release();await stalePath.routes.done;await stalePath.page.waitForTimeout(100);
    assert.equal(new URL(stalePath.page.url()).pathname,'/me');assert.equal(await stalePath.page.locator('#nt-list').count(),0,'a late notification bundle cannot replace newer navigation');
    assert.deepEqual(stalePath.errors,[]);
  }finally{stalePath.routes.release();await stalePath.context.close();}

  const staleOwner=await notificationFixture(browser,user,{hold:true,recordOwner:true});
  try{
    await staleOwner.page.goto(base+'/me/notifications',{waitUntil:'domcontentloaded'});await staleOwner.page.locator('.lazy-route-loading').waitFor();
    await login(staleOwner.context,'zz_test_explore_typical');
    const meResponse=await staleOwner.context.request.get(base+'/api/me');assert.equal(meResponse.status(),200);
    const me=await meResponse.json();await staleOwner.page.evaluate(profile=>refreshMe(profile),me);
    await until(staleOwner.page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new account owns the pending notification shell');
    staleOwner.routes.release();await staleOwner.routes.done;await staleOwner.page.locator('[data-meal-reminders]').waitFor();
    assert.deepEqual(await staleOwner.page.evaluate(()=>window.__notificationRouteOwners),['zz_test_explore_typical'],'the deferred settings route mounts only for the current fictional owner');
    assert(staleOwner.routes.apiOwners.length>=1&&staleOwner.routes.apiOwners.every(id=>id===String(me.id)),'notification data is requested for the current owner only');
    assert.deepEqual(staleOwner.errors,[]);assert.deepEqual(staleOwner.routes.writes,[]);
  }finally{staleOwner.routes.release();await staleOwner.context.close();}

  const welcomeInitial=await welcomeFixture(browser);
  try{
    await welcomeInitial.page.goto(base+'/me');await welcomeInitial.page.locator(meReady).waitFor();
    assert.equal(welcomeInitial.requests.length,0,'Welcome is absent from the initial Me request path');
    assert.equal(await welcomeInitial.page.locator('script[src*="/static/welcome.js"]').count(),0,'Me has no eager Welcome script tag');
    await welcomeInitial.page.evaluate(()=>go('/welcome?step=profile'));await welcomeInitial.page.locator('.lazy-route-loading').waitFor();
    await until(welcomeInitial.page,()=>!!document.querySelector('#wc-form'),'Welcome after normal Me navigation');
    assert.equal(welcomeInitial.requests.length,1,'normal navigation loads Welcome once');
    assert.match(new URL(welcomeInitial.requests[0]).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'Welcome uses its build-stamped URL');
    await welcomeInitial.page.evaluate(()=>go('/me'));await welcomeInitial.page.locator(meReady).waitFor();
    await welcomeInitial.page.evaluate(()=>go('/welcome?step=profile'));await until(welcomeInitial.page,()=>!!document.querySelector('#wc-form'),'Welcome reopened');
    assert.equal(welcomeInitial.requests.length,1,'reopening uses the loaded Welcome script');
    assert.deepEqual(welcomeInitial.errors,[]);assert.deepEqual(welcomeInitial.writes,[]);
  }finally{await welcomeInitial.context.close();}

  const welcomeDirect=await welcomeFixture(browser);
  try{
    await welcomeDirect.page.goto(base+'/welcome?step=profile',{waitUntil:'domcontentloaded'});
    await until(welcomeDirect.page,()=>!!document.querySelector('#wc-form'),'cold direct Welcome route');
    assert.equal(new URL(welcomeDirect.page.url()).pathname,'/welcome','cold direct path stays on Welcome');
    assert.equal(welcomeDirect.requests.length,1,'cold direct path loads the Welcome script once');
    assert.deepEqual(welcomeDirect.errors,[]);assert.deepEqual(welcomeDirect.writes,[]);
  }finally{await welcomeDirect.context.close();}

  const welcomeRetry=await welcomeFixture(browser,user,{failFirst:true});
  try{
    await welcomeRetry.page.goto(base+'/welcome?step=profile',{waitUntil:'domcontentloaded'});await welcomeRetry.page.locator('.load-error').waitFor();
    assert.equal(new URL(welcomeRetry.page.url()).pathname,'/welcome','a failed Welcome bundle does not fall back to Me');
    assert(await welcomeRetry.page.locator('#retry').isVisible());assert.equal(welcomeRetry.requests.length,1);
    await welcomeRetry.page.locator('#retry').click();await until(welcomeRetry.page,()=>!!document.querySelector('#wc-form'),'Welcome after explicit retry');
    assert.equal(welcomeRetry.requests.length,2,'retry clears the rejected promise and fetches Welcome again');
    assert.deepEqual(welcomeRetry.errors,[]);assert.deepEqual(welcomeRetry.writes,[]);
  }finally{await welcomeRetry.context.close();}

  const welcomeNavigation=await welcomeFixture(browser,user,{hold:true});
  try{
    await welcomeNavigation.page.goto(base+'/welcome?step=profile',{waitUntil:'domcontentloaded'});await welcomeNavigation.page.locator('.lazy-route-loading').waitFor();await welcomeNavigation.done;
    await welcomeNavigation.page.locator('nav.tabs a[data-tab="me"]').click();await welcomeNavigation.page.locator(meReady).waitFor();
    welcomeNavigation.release();await welcomeNavigation.page.waitForTimeout(100);
    assert.equal(new URL(welcomeNavigation.page.url()).pathname,'/me','late Welcome response cannot replace a newer route');
    assert.equal(await welcomeNavigation.page.locator('#wc-form').count(),0);
    await welcomeNavigation.page.evaluate(()=>go('/welcome?step=profile'));await until(welcomeNavigation.page,()=>!!document.querySelector('#wc-form'),'Welcome after leaving during load');
    assert.equal(welcomeNavigation.requests.length,1,'the completed in-flight Welcome bundle is reused');
    assert.deepEqual(welcomeNavigation.errors,[]);assert.deepEqual(welcomeNavigation.writes,[]);
  }finally{welcomeNavigation.release();await welcomeNavigation.context.close();}

  const welcomeOwner=await welcomeFixture(browser,user,{hold:true});
  try{
    await welcomeOwner.page.goto(base+'/welcome?step=profile',{waitUntil:'domcontentloaded'});await welcomeOwner.page.locator('.lazy-route-loading').waitFor();await welcomeOwner.done;
    const oldName=await welcomeOwner.page.evaluate(()=>App.me.name);
    await login(welcomeOwner.context,'zz_test_explore_typical');
    const meResponse=await welcomeOwner.context.request.get(base+'/api/me');assert.equal(meResponse.status(),200);const me=await meResponse.json();
    await welcomeOwner.page.evaluate(profile=>refreshMe(profile),me);
    await until(welcomeOwner.page,()=>App.me?.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new fictional owner holds the Welcome route');
    welcomeOwner.release();await welcomeOwner.page.locator('#wc-form').waitFor();
    const visibleName=await welcomeOwner.page.locator('#wc-form [name="name"]').inputValue();
    assert.equal(visibleName,me.name,'Welcome renders the current owner after a delayed load');assert.notEqual(visibleName,oldName,'the previous owner’s profile does not leak');
    assert.equal(welcomeOwner.requests.length,1,'account change shares the same in-flight script request');
    assert.deepEqual(welcomeOwner.errors,[]);assert.deepEqual(welcomeOwner.writes,[]);
  }finally{welcomeOwner.release();await welcomeOwner.context.close();}

  const foodWarm=await foodRouteFixture(browser,{idleGate:true});
  try{
    await foodWarm.page.goto(base+'/me');await ready(foodWarm.page,meReady,'Me before Food warm-up');
    assert.deepEqual(foodWarm.assets,[],'Food and Kit route bundles are absent before useful Me is ready');
    assert.equal(foodWarm.assetAttempts('/static/onboarding.js'),0,'cold Me does not request the optional Food setup route');
    assert.equal(await foodWarm.page.locator('script[src*="/static/onboarding.js"]').count(),0,'onboarding.js is not an eager script tag');
    assert.equal(await foodWarm.page.evaluate(()=>App.pages.some(item=>item.re.test('/food/setup'))),false,'the setup route registers only when opened');
    assert.deepEqual(await foodWarm.page.evaluate(()=>[typeof kitFoodWords,typeof weightAddress,typeof refreshWeightData,typeof guardFoodSheet,typeof KitChat.href,KitChat.loaded]),['function','function','function','function','function',false],'small shared Food and Kit entry seams stay eager');
    await foodWarm.page.evaluate(()=>{window.__foodWarmCalls=0;const original=loadClassicScript;window.loadClassicScript=asset=>{if(asset===FOOD_ROUTE_ASSET)window.__foodWarmCalls++;return original(asset);};});
    const warmed=foodWarm.page.waitForRequest(request=>new URL(request.url()).pathname==='/static/food.js');
    await foodWarm.page.locator('a[data-tab="food"]').evaluate(tab=>{
      const touch=new Touch({identifier:1,target:tab,clientX:1,clientY:1});
      tab.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch],targetTouches:[touch],changedTouches:[touch]}));
    });
    await warmed;await foodWarm.page.waitForFunction(()=>classicScriptsLoaded.has(FOOD_ROUTE_ASSET));
    const tab=foodWarm.page.locator('a[data-tab="food"]');
    await tab.evaluate(el=>el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'})));
    await tab.focus();await until(foodWarm.page,()=>window.__foodWarmCalls>=3,'touch, hover and keyboard focus warm Nutrition');
    await foodWarm.page.waitForFunction(()=>window.__foodIdleCallbacks.length>=1);
    assert.equal(await foodWarm.page.evaluate(()=>window.__foodIdleCallbacks.length),2,'Me schedules Nutrition and Social warm-ups; Kit is not needed in its header');
    await foodWarm.page.evaluate(()=>window.__foodIdleCallbacks.splice(0).forEach(callback=>callback({didTimeout:false,timeRemaining:()=>50})));
    await foodWarm.page.waitForFunction(()=>classicScriptsLoaded.has(FOOD_ROUTE_ASSET));
    assert.equal(await foodWarm.page.evaluate(()=>KitChat.loaded),false,'Kit stays deferred on Me');
    assert.equal(foodWarm.assets.filter(path=>path==='/static/kit.js').length,0,'Me does not fetch the Kit bundle');
    await tab.click();await ready(foodWarm.page,'#page h1','Nutrition after tab warm-up');
    await foodWarm.page.waitForFunction(()=>window.__foodIdleCallbacks.length>=1);
    await foodWarm.page.evaluate(()=>window.__foodIdleCallbacks.splice(0).forEach(callback=>callback({didTimeout:false,timeRemaining:()=>50})));
    await foodWarm.page.waitForFunction(()=>KitChat.loaded&&classicScriptsLoaded.has(KIT_ROUTE_ASSET));
    assert.equal(foodWarm.assets.filter(path=>path==='/static/food.js').length,1,'tab intent and idle deduplicate Food loading');
    assert.equal(foodWarm.assets.filter(path=>path==='/static/kit.js').length,1,'Kit loads after Me is ready, not on its initial path');
    assert.equal(foodWarm.assetAttempts('/static/onboarding.js'),0,'opening Nutrition does not load the separate setup route');
    assert.equal(new URL(foodWarm.page.url()).pathname,'/food');assert.deepEqual(foodWarm.errors,[]);assert.deepEqual(foodWarm.writes,[]);
  }finally{foodWarm.release();await foodWarm.context.close();}

  const onboardingDirect=await foodRouteFixture(browser);
  try{
    await onboardingDirect.page.goto(base+'/food/setup?source=me',{waitUntil:'domcontentloaded'});
    await ready(onboardingDirect.page,'#gs-form','cold direct Food setup route');
    assert.equal(new URL(onboardingDirect.page.url()).pathname,'/food/setup');
    assert.equal(new URL(onboardingDirect.page.url()).search,'?source=me','direct setup preserves its query string');
    assert.deepEqual(onboardingDirect.assets,['/static/food.js','/static/onboarding.js'],'setup loads Food globals before the onboarding route');
    assert.equal(await onboardingDirect.page.locator('nav.tabs a[data-tab="food"]').getAttribute('aria-current'),'page','direct setup keeps Nutrition selected');
    const scriptUrl=await onboardingDirect.page.locator('script[src*="/static/onboarding.js"]').evaluate(el=>el.src);
    assert.match(new URL(scriptUrl).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'onboarding uses its build-stamped asset URL');
    await onboardingDirect.page.locator('input[name="goal"][value="fuel_training"]').check();
    assert.deepEqual(onboardingDirect.writes,[],'opening and editing setup does not write before an explicit save');
    assert.deepEqual(onboardingDirect.errors,[]);
  }finally{onboardingDirect.release();await onboardingDirect.context.close();}

  const onboardingRetry=await foodRouteFixture(browser,{failAsset:'/static/onboarding.js'});
  try{
    await onboardingRetry.page.goto(base+'/food/setup?source=me',{waitUntil:'domcontentloaded'});await onboardingRetry.page.locator('.load-error').waitFor();
    assert.equal(new URL(onboardingRetry.page.url()).pathname,'/food/setup','a failed setup bundle keeps the direct route');
    assert.equal(onboardingRetry.assetAttempts('/static/food.js'),1,'retryable setup keeps its Food prerequisite loaded');
    assert.equal(onboardingRetry.assetAttempts('/static/onboarding.js'),1);assert(await onboardingRetry.page.locator('#retry').isVisible());
    await onboardingRetry.page.locator('#retry').click();await ready(onboardingRetry.page,'#gs-form','Food setup after explicit retry');
    assert.deepEqual(onboardingRetry.assets,['/static/food.js','/static/onboarding.js','/static/onboarding.js'],'retry requests only the failed onboarding script');
    assert.deepEqual(onboardingRetry.writes,[],'retrying setup still performs no write before Save');
    assert.deepEqual(onboardingRetry.errors,[]);
  }finally{onboardingRetry.release();await onboardingRetry.context.close();}

  const foodSkeleton=await foodRouteFixture(browser,{hold:true});
  try{
    await foodSkeleton.page.goto(base+'/food',{waitUntil:'domcontentloaded'});await foodSkeleton.page.locator('.food-route-loading .sk-card').first().waitFor({state:'visible'});await foodSkeleton.held;
    assert.equal(await foodSkeleton.page.locator('.food-route-loading [role="status"]').textContent(),'Loading Nutrition…');
    assert(await foodSkeleton.page.locator('.food-route-loading .sk-card').count()>=1,'a delayed Nutrition route shows shaped skeleton cards');
    const finished=foodSkeleton.page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/static/food.js');foodSkeleton.release();await finished;
    await ready(foodSkeleton.page,'#page h1','Nutrition after delayed route script');
    assert.equal(new URL(foodSkeleton.page.url()).pathname,'/food');assert.deepEqual(foodSkeleton.errors,[]);assert.deepEqual(foodSkeleton.writes,[]);
  }finally{foodSkeleton.release();await foodSkeleton.context.close();}

  const foodRetry=await foodRouteFixture(browser,{failFirst:true});
  try{
    await foodRetry.page.goto(base+'/food',{waitUntil:'domcontentloaded'});await foodRetry.page.locator('.load-error').waitFor();
    assert(await foodRetry.page.locator('#retry').isVisible(),'failed Nutrition load offers retry');
    await foodRetry.page.locator('#retry').click();await ready(foodRetry.page,'#page h1','Nutrition after explicit retry');
    assert.equal(foodRetry.foodAttempts(),2,'retry clears the rejected Food promise and requests it again');
    assert.deepEqual(foodRetry.errors,[]);assert.deepEqual(foodRetry.writes,[]);
  }finally{foodRetry.release();await foodRetry.context.close();}

  const foodNavigation=await foodRouteFixture(browser,{hold:true});
  try{
    await foodNavigation.page.goto(base+'/food',{waitUntil:'domcontentloaded'});await foodNavigation.page.locator('.food-route-loading').waitFor();await foodNavigation.held;
    await foodNavigation.page.locator('nav.tabs a[data-tab="me"]').click();await ready(foodNavigation.page,meReady,'Me after leaving a pending Nutrition load');
    const finished=foodNavigation.page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/static/food.js');foodNavigation.release();await finished;await foodNavigation.page.waitForTimeout(80);
    assert.equal(new URL(foodNavigation.page.url()).pathname,'/me','a late Food response cannot replace newer navigation');
    assert.equal(await foodNavigation.page.locator('.food-route-loading').count(),0);assert.deepEqual(foodNavigation.errors,[]);assert.deepEqual(foodNavigation.writes,[]);
  }finally{foodNavigation.release();await foodNavigation.context.close();}

  const foodOwner=await foodRouteFixture(browser,{hold:true,instrument:true});
  try{
    await foodOwner.page.goto(base+'/food',{waitUntil:'domcontentloaded'});await foodOwner.page.locator('.food-route-loading').waitFor();await foodOwner.held;
    await foodOwner.page.evaluate(()=>{window.testFoodOwners=[];});
    await login(foodOwner.context,'zz_test_explore_typical');const meResponse=await foodOwner.context.request.get(base+'/api/me');assert.equal(meResponse.status(),200);const me=await meResponse.json();
    await foodOwner.page.evaluate(profile=>refreshMe(profile),me);
    await until(foodOwner.page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.food-route-loading'),'new owner holds the pending Nutrition shell');
    foodOwner.release();await ready(foodOwner.page,'#page h1','Nutrition after account change');
    assert.deepEqual(await foodOwner.page.evaluate(()=>window.testFoodOwners),['zz_test_explore_typical'],'Food mounts only for the current owner');
    assert.equal(foodOwner.foodAttempts(),1,'owner change reuses the one in-flight Food script');assert.deepEqual(foodOwner.errors,[]);assert.deepEqual(foodOwner.writes,[]);
  }finally{foodOwner.release();await foodOwner.context.close();}

  const kitDirect=await foodRouteFixture(browser);
  try{
    await kitDirect.page.goto(base+'/me/kit',{waitUntil:'domcontentloaded'});await ready(kitDirect.page,'#kit-text','Kit after deferred direct route');
    assert.deepEqual(kitDirect.assets.slice(0,2),['/static/food.js','/static/kit.js'],'Kit loads Food dependencies before the chat route');
    assert.equal(await kitDirect.page.locator('#kit-load-retry').isVisible(),false,'fictional conversation startup succeeds without the retry error');
    assert.doesNotMatch(await kitDirect.page.locator('#kit-status').textContent(),/Cannot read properties/,'Kit renders without an initialization exception');
    assert.deepEqual(kitDirect.errors,[]);assert(kitDirect.writes.some(path=>path==='POST /api/coach/conversation/visits'),'the fictional Kit start write is intercepted by the test route');
  }finally{kitDirect.release();await kitDirect.context.close();}

  const cookInitial=await foodRouteFixture(browser);
  try{
    await cookInitial.page.goto(base+'/me');await ready(cookInitial.page,meReady,'Me before opening Cook');
    assert.equal(await cookInitial.page.locator('script[src*="/static/cook.js"]').count(),0,'Cook has no eager script tag');
    assert.equal(await cookInitial.page.locator('script[src*="/static/recipe-import.js"]').count(),0,'recipe import has no eager script tag');
    assert.equal(cookInitial.assets.some(path=>path==='/static/cook.js'||path==='/static/recipe-import.js'),false,'Cook and recipe import stay off the useful-Me path');
  }finally{cookInitial.release();await cookInitial.context.close();}

  const cookDirect=await foodRouteFixture(browser);
  try{
    await cookDirect.page.goto(base+'/food/cook/999999',{waitUntil:'domcontentloaded'});await ready(cookDirect.page,'.recipe-page .empty','cold direct Cook route');
    assert.equal(new URL(cookDirect.page.url()).pathname,'/food/cook/999999');
    assert.deepEqual(cookDirect.assets,['/static/food.js','/static/cook.js'],'Cook loads Food helpers before its route module once');
    const url=await cookDirect.page.locator('script[src*="/static/cook.js"]').evaluate(el=>el.src);
    assert.match(new URL(url).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'Cook uses its own content hash');
    assert.deepEqual(cookDirect.errors,[]);assert.deepEqual(cookDirect.writes,[]);
  }finally{cookDirect.release();await cookDirect.context.close();}

  const cookLoading=await foodRouteFixture(browser,{holdAsset:'/static/cook.js'});
  try{
    await cookLoading.page.goto(base+'/food/cook/999999',{waitUntil:'domcontentloaded'});await cookLoading.page.locator('.food-route-loading').waitFor();await cookLoading.held;
    assert.equal(new URL(cookLoading.page.url()).pathname,'/food/cook/999999');
    assert.equal(await cookLoading.page.evaluate(()=>App.pageReady),false,'Cook waits behind the existing Food loading shell');
    assert.equal(await cookLoading.page.locator('.recipe-page').count(),0,'no fallback page flashes before Cook is registered');
    cookLoading.release();await cookLoading.done;await ready(cookLoading.page,'.recipe-page .empty','Cook after delayed bundle');
    assert.deepEqual(cookLoading.errors,[]);assert.deepEqual(cookLoading.writes,[]);
  }finally{cookLoading.release();await cookLoading.context.close();}

  const cookRetry=await foodRouteFixture(browser,{failAsset:'/static/cook.js'});
  try{
    await cookRetry.page.goto(base+'/food/cook/999999',{waitUntil:'domcontentloaded'});await cookRetry.page.locator('.load-error').waitFor();
    assert.equal(new URL(cookRetry.page.url()).pathname,'/food/cook/999999');assert(await cookRetry.page.locator('#retry').isVisible());
    await cookRetry.page.locator('#retry').click();await ready(cookRetry.page,'.recipe-page .empty','Cook after explicit retry');
    assert.equal(cookRetry.assetAttempts('/static/food.js'),1);assert.equal(cookRetry.assetAttempts('/static/cook.js'),2);
    assert.deepEqual(cookRetry.errors,[]);assert.deepEqual(cookRetry.writes,[]);
  }finally{cookRetry.release();await cookRetry.context.close();}

  const recipeDirect=await foodRouteFixture(browser,{fakeDishCreation:true});
  try{
    await recipeDirect.page.goto(base+'/food/recipe-link',{waitUntil:'domcontentloaded'});await ready(recipeDirect.page,'#recipe-url-form','cold direct recipe-import route');
    assert.equal(new URL(recipeDirect.page.url()).pathname,'/food/recipe-link');
    assert.deepEqual(recipeDirect.assets,['/static/food.js','/static/cook.js','/static/recipe-import.js'],'recipe import loads Food and Cook dependencies first');
    assert.equal(await recipeDirect.page.evaluate(()=>typeof newDish==='function'&&typeof RECIPE_SOURCE_LABELS==='object'),true,'recipe creation helpers are ready on first open');
    const url=await recipeDirect.page.locator('script[src*="/static/recipe-import.js"]').evaluate(el=>el.src);
    assert.match(new URL(url).searchParams.get('v')||'',/^[0-9a-f]{32}$/,'recipe import uses its own content hash');
    await recipeDirect.page.locator('#recipe-type').click();await ready(recipeDirect.page,'.recipe-page .empty','Cook after create from recipe import');
    assert.equal(recipeDirect.dishCreations(),1,'the first action creates one fictional recipe');
    assert.equal(recipeDirect.assetAttempts('/static/cook.js'),1,'Cook is not requested twice');
    assert.equal(recipeDirect.assetAttempts('/static/recipe-import.js'),1);
    assert.deepEqual(recipeDirect.errors,[]);assert.deepEqual(recipeDirect.writes,[]);
  }finally{recipeDirect.release();await recipeDirect.context.close();}

  const recipeRetry=await foodRouteFixture(browser,{failAsset:'/static/recipe-import.js'});
  try{
    await recipeRetry.page.goto(base+'/food/recipe-link',{waitUntil:'domcontentloaded'});await recipeRetry.page.locator('.load-error').waitFor();
    assert.equal(new URL(recipeRetry.page.url()).pathname,'/food/recipe-link');assert(await recipeRetry.page.locator('#retry').isVisible());
    await recipeRetry.page.locator('#retry').click();await ready(recipeRetry.page,'#recipe-url-form','recipe import after explicit retry');
    assert.equal(recipeRetry.assetAttempts('/static/food.js'),1);assert.equal(recipeRetry.assetAttempts('/static/cook.js'),1);assert.equal(recipeRetry.assetAttempts('/static/recipe-import.js'),2);
    assert.deepEqual(recipeRetry.errors,[]);assert.deepEqual(recipeRetry.writes,[]);
  }finally{recipeRetry.release();await recipeRetry.context.close();}

  const recipeLoading=await foodRouteFixture(browser,{holdAsset:'/static/recipe-import.js'});
  try{
    await recipeLoading.page.goto(base+'/food/recipe-link',{waitUntil:'domcontentloaded'});await recipeLoading.page.locator('.food-route-loading').waitFor();await recipeLoading.held;
    assert.equal(new URL(recipeLoading.page.url()).pathname,'/food/recipe-link');
    assert.equal(await recipeLoading.page.evaluate(()=>App.pageReady),false,'recipe import waits behind the existing Food loading shell');
    assert.equal(await recipeLoading.page.locator('#recipe-url-form').count(),0,'the form waits for its module');
    recipeLoading.release();await recipeLoading.done;await ready(recipeLoading.page,'#recipe-url-form','recipe import after delayed bundle');
    assert.deepEqual(recipeLoading.errors,[]);assert.deepEqual(recipeLoading.writes,[]);
  }finally{recipeLoading.release();await recipeLoading.context.close();}

  const cookFirstTap=await foodRouteFixture(browser,{holdAsset:'/static/cook.js',fakeDishCreation:true});
  try{
    await cookFirstTap.page.goto(base+'/food/meals');await ready(cookFirstTap.page,'#tm-new','Recipes & foods with New action');
    await cookFirstTap.page.locator('#tm-new').click();await cookFirstTap.page.locator('#tm-dish').click();await cookFirstTap.held;
    assert.equal(new URL(cookFirstTap.page.url()).pathname,'/food/meals','the first recipe tap stays on the current route while Cook loads');
    assert.equal(await cookFirstTap.page.locator('.lazy-route-loading').count(),0,'the action does not flash a fallback route');
    assert.equal(cookFirstTap.dishCreations(),0,'creation waits for Cook');
    cookFirstTap.release();await cookFirstTap.done;await ready(cookFirstTap.page,'.recipe-page .empty','Cook opened from New on first tap');
    assert.equal(cookFirstTap.dishCreations(),1);assert.equal(cookFirstTap.assetAttempts('/static/cook.js'),1,'the first tap loads Cook exactly once');
    assert.deepEqual(cookFirstTap.errors,[]);assert.deepEqual(cookFirstTap.writes,[]);
  }finally{cookFirstTap.release();await cookFirstTap.context.close();}

  const cookFirstTapRetry=await foodRouteFixture(browser,{failAsset:'/static/cook.js',fakeDishCreation:true});
  try{
    await cookFirstTapRetry.page.goto(base+'/food/meals');await ready(cookFirstTapRetry.page,'#tm-new','Recipes & foods with New action');
    await cookFirstTapRetry.page.locator('#tm-new').click();await cookFirstTapRetry.page.locator('#tm-dish').click();
    await cookFirstTapRetry.page.locator('#toast.on').waitFor();
    assert.match(await cookFirstTapRetry.page.locator('#toast').innerText(),/Recipe tools could not load.*try again/i,'failed first tap explains how to retry');
    assert.equal(new URL(cookFirstTapRetry.page.url()).pathname,'/food/meals');
    assert.equal(await cookFirstTapRetry.page.locator('#tm-new').isEnabled(),true,'New remains enabled after Cook fails');
    assert.equal(cookFirstTapRetry.dishCreations(),0,'a failed load does not start recipe creation');
    await cookFirstTapRetry.page.locator('#tm-new').click();await cookFirstTapRetry.page.locator('#tm-dish').click();
    await ready(cookFirstTapRetry.page,'.recipe-page .empty','Cook opened after retry from New');
    assert.equal(cookFirstTapRetry.assetAttempts('/static/cook.js'),2,'the second tap retries the failed Cook request once');
    assert.equal(cookFirstTapRetry.dishCreations(),1,'retry creates one fictional recipe');
    assert.deepEqual(cookFirstTapRetry.errors,[]);assert.deepEqual(cookFirstTapRetry.writes,[]);
  }finally{cookFirstTapRetry.release();await cookFirstTapRetry.context.close();}

  const cookManualRetry=await foodRouteFixture(browser,{failAsset:'/static/cook.js'});
  try{
    await cookManualRetry.page.goto(base+'/food/describe',{waitUntil:'domcontentloaded'});await ready(cookManualRetry.page,'#thread-plus','Food chat with deferred Cook');
    assert.equal(cookManualRetry.assetAttempts('/static/cook.js'),0,'Cook stays deferred until a Cook helper is needed');
    const tapManual=async()=>{await cookManualRetry.page.locator('#thread-plus').click();await cookManualRetry.page.locator('.thread-tools-sheet button').filter({hasText:'Manual'}).click();};
    await tapManual();await cookManualRetry.page.locator('#toast.on').waitFor();
    assert.match(await cookManualRetry.page.locator('#toast').innerText(),/Recipe tools could not load.*try again/i,'failed Manual tap tells the person to retry');
    assert.equal(cookManualRetry.assetAttempts('/static/cook.js'),1,'Manual makes one first Cook request');
    await tapManual();await ready(cookManualRetry.page,'#ty','manual food form after Cook retry');
    assert.equal(cookManualRetry.assetAttempts('/static/cook.js'),2,'Manual retries the failed Cook request once');
    assert.deepEqual(cookManualRetry.errors,[]);assert.deepEqual(cookManualRetry.writes,[]);
  }finally{cookManualRetry.release();await cookManualRetry.context.close();}

  console.log('Cook and recipe-import lazy routes: first tap, dependencies, retry and no duplicate loads PASS');

  // These lazy-route checks exercise feature-on Calendar and Segments; progress_ui.cjs owns the default-off assertions.
  setProgressFlags(true);
  try{
  const homeInitial=await progressFixture(browser);
  try{
    await homeInitial.page.goto(base+'/activity');await ready(homeInitial.page,'#ff-list .post, #ff-list .feed-empty','Home feed before the plan route is opened');
    assert.equal(homeInitial.assets.filter(file=>file==='/static/plan.js').length,0,'Home does not request the Training plan bundle');
    assert.equal(await homeInitial.page.locator('script[src*="/static/plan.js"]').count(),0,'Home has no Training plan script element');
    assert.equal(await homeInitial.page.evaluate(()=>App.pages.some(item=>item.re.test('/plan'))),false,'Training plan is registered only when its route opens');
    assert.deepEqual(homeInitial.errors,[]);assert.deepEqual(homeInitial.writes,[]);assert.deepEqual(homeInitial.previews,[]);
  }finally{await homeInitial.context.close();}

  const progressMe=await progressFixture(browser);
  try{
    await progressMe.page.goto(base+'/me');await ready(progressMe.page,meReady,'Me before Progress and Segments routes');
    assert.deepEqual(progressMe.assets,[],'secondary Progress routes, Segments and intervals are absent from initial Me');
    assert.equal(await progressMe.page.evaluate(()=>typeof Intervals),'undefined','cold Me has no intervals code');
    assert.equal(await progressMe.page.locator('script[src*="/static/intervals.js"]').count(),0,'intervals has no eager script tag');
    assert.equal(await progressMe.page.evaluate(()=>typeof clearSegmentDrafts),'function','account cleanup stays eager without Planner');
    assert.equal(await progressMe.page.locator('script[src*="/static/segments.js"]').count(),0,'Segments has no eager script tag');
    assert.equal(await progressMe.page.locator('script[src*="/static/planner.js"]').count(),0,'Planner has no eager script tag');
    assert.equal(await progressMe.page.locator('script[src*="/static/plan.js"]').count(),0,'Training plan has no eager script tag');
    assert.equal(await progressMe.page.evaluate(()=>App.pages.some(item=>item.re.test('/plan'))),false,'Training plan route registers on demand');
    assert.equal(await progressMe.page.evaluate(()=>App.pages.some(item=>item.re.test('/progress/trends'))),false,'secondary Progress routes register only after their bundle loads');
    await progressMe.page.evaluate(()=>go('/me/settings'));
    await until(progressMe.page,()=>App.pageReady&&location.pathname==='/me/settings'&&typeof Intervals==='object','settings cleanup dependency');
    assert.deepEqual(progressMe.assets,['/static/intervals.js'],'Settings loads interval cleanup only when needed');
    assert.equal(await progressMe.page.evaluate(()=>typeof Intervals.clear),'function','account deletion can still clear interval storage');
    const cleanup=await progressMe.page.evaluate(()=>{
      const server=serverKey(),id=App.me.id,other=String(id+1);
      const mine=`kinetta.planDraft:${server}:${id}:segment-new`,foreign=`kinetta.planDraft:${server}:${other}:segment-new`;
      localStorage.setItem(mine,'mine');localStorage.setItem(foreign,'foreign');localStorage.setItem(`kinetta.mapArea:${server}:${id}`,'mine-map');
      localStorage.setItem(`kinetta.mapArea:${server}:${other}`,'foreign-map');sessionStorage.setItem(`kinetta.segmentReview:${server}:${id}`,'mine-review');
      clearSegmentDrafts();
      return {mine:localStorage.getItem(mine),foreign:localStorage.getItem(foreign),map:localStorage.getItem(`kinetta.mapArea:${server}:${id}`),foreignMap:localStorage.getItem(`kinetta.mapArea:${server}:${other}`),review:sessionStorage.getItem(`kinetta.segmentReview:${server}:${id}`)};
    });
    assert.deepEqual(cleanup,{mine:null,foreign:'foreign',map:null,foreignMap:'foreign-map',review:null},'Planner cleanup removes only the signed-in account drafts');
  }finally{await progressMe.context.close();}

  const intervalResume=await activeIntervalFixture(browser);
  try{
    await intervalResume.page.goto(base+'/me');await ready(intervalResume.page,meReady,'cold Me with a fictional active native interval workout');
    assert.deepEqual(intervalResume.assets,[],'cold Me does not load interval code for native resume state');
    assert.equal(await intervalResume.page.evaluate(()=>typeof Intervals),'undefined','native workout restoration does not need the interval bundle');
    assert.equal(await intervalResume.page.evaluate(()=>Track.active),true,'Track.sync restores the existing native interval session on cold Me');
    await intervalResume.page.evaluate(()=>go('/track'));await ready(intervalResume.page,'#interval-live .interval-current','Track after restoring the native interval session');
    assert.deepEqual(intervalResume.assets,['/static/intervals.js'],'Track loads interval rendering once on demand');
    assert.equal(await intervalResume.page.evaluate(()=>Track.active),true,'loading interval rendering leaves the workout active');
    assert.equal(await intervalResume.page.evaluate(()=>JSON.parse(localStorage.getItem('kinetta.track:'+JSON.stringify([location.origin,App.me.id]))).intervals.index),0,'the active interval step survives route loading');
    assert.deepEqual(intervalResume.errors,[]);assert.deepEqual(intervalResume.writes,[]);
  }finally{await intervalResume.context.close();}

  const getAppLogout=await getAppLogoutFixture(browser);
  try{
    await getAppLogout.page.goto(base+'/me');await getAppLogout.page.locator('#ga-out').waitFor();
    assert.equal(await getAppLogout.page.evaluate(()=>typeof Intervals),'undefined','Get App logout starts with the lazy bundle unloaded');
    const loggedOut=getAppLogout.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/logout'&&response.request().method()==='POST');
    await getAppLogout.page.locator('#ga-out').click();await loggedOut;
    assert.deepEqual(await getAppLogout.page.evaluate(({ownKey,foreignKey})=>[localStorage.getItem(ownKey),localStorage.getItem(foreignKey)],{ownKey:getAppLogout.ownKey,foreignKey:getAppLogout.foreignKey}),[null,getAppLogout.foreignValue],'logout clears only the current owner interval key without loading the bundle');
    assert.deepEqual(getAppLogout.assets,[],'logout does not fetch intervals.js');assert.deepEqual(getAppLogout.errors,[]);
  }finally{await getAppLogout.context.close();}

  const planDirect=await progressFixture(browser);
  try{
    await planDirect.page.goto(base+'/plan');await ready(planDirect.page,'.plan-page','direct Training plan route');
    assert.equal(new URL(planDirect.page.url()).pathname,'/plan');
    assert.deepEqual(planDirect.assets,['/static/intervals.js','/static/plan.js'],'direct Training plan loads interval support before Plan');
    assert.deepEqual(planDirect.previews,['/api/plans/preview'],'the preview request is read-only and distinct from saving a plan');
    assert.deepEqual(planDirect.errors,[]);assert.deepEqual(planDirect.writes,[]);
  }finally{await planDirect.context.close();}

  const planFromMe=await progressFixture(browser);
  try{
    await planFromMe.page.goto(base+'/me');await ready(planFromMe.page,meReady,'Me before Training plan navigation');
    const link=planFromMe.page.locator('.me-tools a[href="/plan"]');assert.equal(await link.count(),1,'Me keeps its Training plan entry');
    await link.click();await ready(planFromMe.page,'.plan-page','Training plan after an in-app Me tap');
    assert.equal(new URL(planFromMe.page.url()).pathname,'/plan');
    assert.deepEqual(planFromMe.assets,['/static/intervals.js','/static/plan.js'],'in-app navigation loads interval support before Training plan');
    assert.deepEqual(planFromMe.previews,['/api/plans/preview'],'in-app Plan opening only computes its read-only preview');
    assert.deepEqual(planFromMe.errors,[]);assert.deepEqual(planFromMe.writes,[]);
  }finally{await planFromMe.context.close();}

  const planRetry=await progressFixture(browser,{fail:'/static/plan.js'});
  try{
    await planRetry.page.goto(base+'/plan',{waitUntil:'domcontentloaded'});await planRetry.page.locator('.load-error').waitFor();
    assert.equal(new URL(planRetry.page.url()).pathname,'/plan','a failed direct Training plan load keeps its route');
    await planRetry.page.locator('#retry').click();await ready(planRetry.page,'.plan-page','Training plan after explicit retry');
    assert.deepEqual(planRetry.assets,['/static/intervals.js','/static/plan.js','/static/plan.js'],'Training plan retries its failed bundle without reloading intervals');
    assert.deepEqual(planRetry.previews,['/api/plans/preview'],'retry computes the preview without saving a plan');
    assert.deepEqual(planRetry.errors,[]);assert.deepEqual(planRetry.writes,[]);
  }finally{await planRetry.context.close();}

  const intervalsRetry=await progressFixture(browser,{fail:'/static/intervals.js'});
  try{
    await intervalsRetry.page.goto(base+'/plan',{waitUntil:'domcontentloaded'});await intervalsRetry.page.locator('.load-error').waitFor();
    assert.deepEqual(intervalsRetry.assets,['/static/intervals.js'],'Plan waits for its interval dependency before requesting Plan');
    await intervalsRetry.page.locator('#retry').click();await ready(intervalsRetry.page,'.plan-page','Plan after interval dependency retry');
    assert.deepEqual(intervalsRetry.assets,['/static/intervals.js','/static/intervals.js','/static/plan.js'],'a failed interval dependency retries first, then loads Plan once');
    assert.deepEqual(intervalsRetry.errors,[]);assert.deepEqual(intervalsRetry.writes,[]);
  }finally{await intervalsRetry.context.close();}

  const trackRoute=await progressFixture(browser);
  try{
    await trackRoute.page.goto(base+'/track');await ready(trackRoute.page,'#track-start','Track after its interval dependency');
    assert.deepEqual(trackRoute.assets,['/static/intervals.js'],'Track loads interval controls before rendering');
    assert.equal(await trackRoute.page.evaluate(()=>typeof Intervals.startOptions),'function');
    assert.deepEqual(trackRoute.errors,[]);assert.deepEqual(trackRoute.writes,[]);
  }finally{await trackRoute.context.close();}

  const activitySegment=await activitySegmentFixture(browser,{failPlannerFirst:true});
  try{
    await activitySegment.page.goto(base+`/activity/${activitySegment.activityId}`);await ready(activitySegment.page,'.compact-detail-title','activity detail before its segment action');
    assert.equal(await activitySegment.page.evaluate(()=>typeof Intervals.history),'function','Activity detail has its interval history renderer');
    await activitySegment.page.locator('#d-segments').scrollIntoViewIfNeeded();await activitySegment.page.locator('#sa-seg').waitFor();
    assert.deepEqual(activitySegment.assets,['/static/segments.js','/static/intervals.js'],'Activity detail loads interval history after Segments without eagerly loading Planner');
    const iconSnapshot=await activitySegment.page.evaluate(()=>({icons:Object.fromEntries(['route','info','list','up','flag'].map(key=>[key,IC[key]])),other:IC.other}));
    const sharedIcons=iconSnapshot.icons;
    assert(Object.values(sharedIcons).every(icon=>icon&&icon!==iconSnapshot.other),'route/action icons have eager shared paths before Planner loads');
    assert.match(sharedIcons.flag,/M5 21V4.*M5 4h12/,'the single eager flag icon is not overwritten by Track');
    await activitySegment.page.locator('#sa-seg').click();await activitySegment.page.locator('#toast.on').waitFor();
    assert.match(await activitySegment.page.locator('#toast').innerText(),/Segment tools could not load.*tap again to retry/i,'failed Planner load leaves a visible retry message');
    assert.equal(activitySegment.assets.filter(path=>path==='/static/planner.js').length,1,'the first tap attempts the deferred Planner bundle');
    await activitySegment.page.locator('#sa-seg').click();await activitySegment.page.locator('#st-use').waitFor();
    assert.deepEqual(activitySegment.assets,['/static/segments.js','/static/intervals.js','/static/planner.js','/static/planner.js'],'the second tap retries Planner after interval history is loaded and opens the stretch sheet');
    assert.deepEqual(await activitySegment.page.evaluate(()=>Object.fromEntries(['route','info','list','up','flag'].map(key=>[key,IC[key]]))),sharedIcons,'loading Planner does not replace shared eager icons');
    assert.deepEqual(activitySegment.errors,[],'Activity first-tap and retry have no uncaught browser errors');assert.deepEqual(activitySegment.writes,[]);
  }finally{await activitySegment.context.close();}

  const directProgress=[
    ['/progress/routes','/progress/routes','/static/progress-routes.js'],
    ['/progress/trends','/progress/trends','/static/progress-routes.js'],
    ['/progress/calendar','/progress/calendar','/static/progress-routes.js'],
    ['/progress/heatmap','/progress/heatmap','/static/progress-routes.js'],
    ['/progress/segments','/progress/segments','/static/segments.js',['/static/planner.js','/static/segments.js']],
    ['/progress/weight','/progress/weight',null],
    ['/me/sharing','/me/sharing','/static/segments.js'],
    ['/segments','/progress/segments','/static/segments.js',['/static/planner.js','/static/segments.js']],
    ['/segments/new','/segments/new','/static/segments.js',['/static/planner.js','/static/segments.js']],
    ['/segments/review','/progress/segments','/static/segments.js',['/static/planner.js','/static/segments.js']],
    ['/segments/999999','/segments/999999','/static/segments.js',['/static/planner.js','/static/segments.js']],
    ['/routes?view=segments','/progress/segments','/static/planner.js',['/static/planner.js','/static/segments.js']],
  ];
  for(const [path,expected,asset,ordered] of directProgress){
    const fixture=await progressFixture(browser);
    try{
      await fixture.page.goto(base+path,{waitUntil:'domcontentloaded'});
      if(path==='/segments/999999')await until(fixture.page,()=>App.pageReady&&/Segment not found/.test(document.querySelector('#page')?.textContent||''),`direct ${path} not-found route`);
      else await ready(fixture.page,'#page h1',`direct ${path}`);
      assert.equal(new URL(fixture.page.url()).pathname,expected,`${path} keeps its feature-on destination`);
      assert.equal(asset?fixture.assets.filter(file=>file===asset).length:0,asset?1:0,`${path} requests only its required lazy asset once`);
      if(ordered)assert.deepEqual(fixture.assets,ordered,`${path} loads its dependencies in order`);
      assert.deepEqual(fixture.errors,[],`${path} has no page errors`);assert.deepEqual(fixture.writes,[],`${path} makes no unapproved writes`);
    }finally{await fixture.context.close();}
  }

  const progressHistory=await progressFixture(browser);
  try{
    await progressHistory.page.goto(base+'/me');await ready(progressHistory.page,meReady,'Me before history navigation');
    await progressHistory.page.evaluate(()=>go('/progress/routes'));await ready(progressHistory.page,'#page h1','Progress routes after in-app navigation');
    await progressHistory.page.evaluate(()=>go('/progress/segments'));await ready(progressHistory.page,'#page h1','Segments after in-app navigation');
    await progressHistory.page.evaluate(()=>history.back());await until(progressHistory.page,p=>App.pageReady&&location.pathname===p&&!!document.querySelector('#page h1'),'browser Back restores Progress routes','/progress/routes');
    await progressHistory.page.evaluate(()=>history.back());await until(progressHistory.page,p=>App.pageReady&&location.pathname===p&&!!document.querySelector('.me-card-sections'),'browser Back restores Me','/me');
    await progressHistory.page.evaluate(()=>history.forward());await until(progressHistory.page,p=>App.pageReady&&location.pathname===p&&!!document.querySelector('#page h1'),'browser Forward restores Progress routes','/progress/routes');
    await progressHistory.page.evaluate(()=>history.forward());await until(progressHistory.page,p=>App.pageReady&&location.pathname===p&&!!document.querySelector('#page h1'),'browser Forward restores Segments','/progress/segments');
    assert.equal(progressHistory.assets.filter(file=>file==='/static/progress-routes.js').length,1,'history reuses the loaded Progress routes');
    assert.equal(progressHistory.assets.filter(file=>file==='/static/segments.js').length,1,'history reuses the loaded Segments bundle');
    assert.deepEqual(progressHistory.errors,[]);assert.deepEqual(progressHistory.writes,[]);
  }finally{await progressHistory.context.close();}

  for(const [path,asset] of [['/progress/trends','/static/progress-routes.js'],['/progress/segments','/static/planner.js'],['/progress/segments','/static/segments.js']]){
    const retry=await progressFixture(browser,{fail:asset});
    try{
      await retry.page.goto(base+path,{waitUntil:'domcontentloaded'});await retry.page.locator('.load-error').waitFor();
      assert.equal(new URL(retry.page.url()).pathname,path,'a failed direct deep link stays on its route');
      await retry.page.locator('#retry').click();await ready(retry.page,'#page h1',`${path} after explicit retry`);
      assert.equal(new URL(retry.page.url()).pathname,path,`${path} stays on its feature-on route after retry`);
      assert.equal(retry.assets.filter(file=>file===asset).length,2,`${path} retries its failed lazy asset`);
      if(asset==='/static/planner.js')assert.equal(retry.assets.filter(file=>file==='/static/segments.js').length,1,'Planner retry still loads Segments once after its dependency succeeds');
      assert.deepEqual(retry.errors,[]);assert.deepEqual(retry.writes,[]);
    }finally{await retry.context.close();}
  }

  const progressStale=await progressFixture(browser,{hold:'/static/segments.js'});
  try{
    await progressStale.page.goto(base+'/progress/segments',{waitUntil:'domcontentloaded'});await progressStale.page.locator('.lazy-route-loading').waitFor();await progressStale.held;
    await progressStale.page.locator('nav.tabs a[data-tab="me"]').click();await ready(progressStale.page,meReady,'Me while Segments is loading');
    progressStale.release();await progressStale.page.waitForTimeout(100);
    assert.equal(new URL(progressStale.page.url()).pathname,'/me','a late Segments bundle cannot replace newer navigation');
    assert.equal(await progressStale.page.locator('#sg-list').count(),0);assert.deepEqual(progressStale.errors,[]);assert.deepEqual(progressStale.writes,[]);
  }finally{progressStale.release();await progressStale.context.close();}

  const intervalsStalePath=await progressFixture(browser,{hold:'/static/intervals.js'});
  try{
    await intervalsStalePath.page.goto(base+'/track',{waitUntil:'domcontentloaded'});await intervalsStalePath.page.locator('.lazy-route-loading').waitFor();await intervalsStalePath.held;
    await intervalsStalePath.page.locator('nav.tabs a[data-tab="me"]').click();await ready(intervalsStalePath.page,meReady,'Me while intervals is loading for Track');
    intervalsStalePath.release();await until(intervalsStalePath.page,()=>classicScriptsLoaded.has(INTERVALS_ROUTE_ASSET),'interval script completion after leaving Track');
    assert.equal(new URL(intervalsStalePath.page.url()).pathname,'/me','a late intervals bundle cannot replace newer navigation');
    assert.equal(await intervalsStalePath.page.locator('#track-start').count(),0);assert.deepEqual(intervalsStalePath.errors,[]);assert.deepEqual(intervalsStalePath.writes,[]);
  }finally{intervalsStalePath.release();await intervalsStalePath.context.close();}

  const intervalsStaleOwner=await progressFixture(browser,{hold:'/static/intervals.js'});
  try{
    await intervalsStaleOwner.page.goto(base+'/plan',{waitUntil:'domcontentloaded'});await intervalsStaleOwner.page.locator('.lazy-route-loading').waitFor();await intervalsStaleOwner.held;
    await intervalsStaleOwner.page.evaluate(()=>{window.intervalRouteOwners=[];const original=render;window.render=options=>{if(options?.routePosition)window.intervalRouteOwners.push({login:App.me.login,ownerMatches:options.routePosition.owner===readOwner()});return original(options);};});
    await login(intervalsStaleOwner.context,'zz_test_explore_typical');
    const meResponse=await intervalsStaleOwner.context.request.get(base+'/api/me');assert.equal(meResponse.status(),200);
    const me=await meResponse.json();await intervalsStaleOwner.page.evaluate(profile=>refreshMe(profile),me);
    await until(intervalsStaleOwner.page,()=>App.me.login==='zz_test_explore_typical'&&!!document.querySelector('.lazy-route-loading'),'new owner while intervals is loading');
    intervalsStaleOwner.release();await ready(intervalsStaleOwner.page,'.plan-page','Plan for the current fictional owner');
    assert.deepEqual(intervalsStaleOwner.assets,['/static/intervals.js','/static/plan.js'],'one shared interval request completes before Plan mounts for the new owner');
    assert.deepEqual(await intervalsStaleOwner.page.evaluate(()=>window.intervalRouteOwners),[{login:'zz_test_explore_typical',ownerMatches:true}],'the stale owner continuation never renders, and the new owner gets one guarded render');
    assert.deepEqual(intervalsStaleOwner.errors,[]);assert.deepEqual(intervalsStaleOwner.writes,[]);
  }finally{intervalsStaleOwner.release();await intervalsStaleOwner.context.close();}
  console.log('Progress/Segments lazy routes: cold deep links, back/forward, retries and stale navigation PASS');
  }finally{setProgressFlags(false);}

  console.log('Lazy routes: direct, normal navigation, retry, memoized reload, stale-path and owner guards PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
