// The deferred media renderer loads only for routes that render activity cards/maps.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',password='green teapot on the hill';
const idsPath=path.join(os.tmpdir(),`kinetta-media-routes-${process.pid}.json`);
const detailFixture=path.join(__dirname,'activity_detail_fixture.py');
async function login(context,user){const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:user,password}});assert.equal(response.status(),200,`fictional account ${user} logs in`);}
async function ready(page,selector,label,{errors=[],networkIssues=[]}={}){
 try{await page.waitForFunction(selector=>App.pageReady&&!!document.querySelector(selector),selector,{timeout:20000});}
 catch(error){
  const state=await page.evaluate(()=>({path:location.pathname,appPageReady:typeof App!=='undefined'&&App.pageReady,mediaCount:document.querySelectorAll('.activity-media').length,loadError:document.querySelector('.load-error')?.textContent.trim()||''})).catch(()=>({path:page.url(),appPageReady:null,mediaCount:null,loadError:''}));
  throw Error(`Case ${label}: waiting for ${selector} failed; evidence=${JSON.stringify({...state,pageErrors:errors,networkIssues})}; ${error.message}`);
 }
}
async function previewSettled(page,errors,label){
 try{await page.waitForFunction(()=>{const host=document.querySelector('[data-profile-preview]');return host?.getAttribute('aria-busy')==='false'&&!!host.querySelector('.me-card-sections[aria-busy="false"]');},null,{timeout:20000});}
 catch(error){const state=await page.evaluate(()=>{const host=document.querySelector('[data-profile-preview]'),sections=host?[...host.querySelectorAll('.me-card-sections')]:[];return{hostPresent:!!host,hostConnected:!!host?.isConnected,hostBusy:host?.getAttribute('aria-busy')??null,sectionCount:sections.length,settledSections:sections.filter(section=>section.getAttribute('aria-busy')==='false').length,profileCardPresent:!!host?.querySelector('.me-card'),alertPresent:!!host?.querySelector('[role="alert"]')};}).catch(()=>({stateUnavailable:true}));throw Error(`Case ${label}: preview did not settle; state=${JSON.stringify({...state,pageErrors:errors})}; ${error.message}`);}
}
async function guard(page,requests,errors,networkIssues){
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const u=new URL(request.url());if(u.origin===base)requests.push(u.pathname);});
 page.on('response',response=>{const u=new URL(response.url());if(u.origin===base&&response.status()>=400)networkIssues.push(`HTTP ${response.status()} ${u.pathname}`);});
 page.on('requestfailed',request=>{const u=new URL(request.url());if(u.origin===base)networkIssues.push(`Failed ${u.pathname}`);});
 await page.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();if(q.method()==='POST'&&u.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});if(!['GET','HEAD'].includes(q.method()))return route.abort();return route.continue();});
}
async function mediaBeforeRender(page,requests,label,renderPaths,errors,networkIssues){
 await ready(page,'.activity-media',label,{errors,networkIssues});
 const mediaIndex=requests.findIndex(x=>x==='/static/media.js'),renderIndex=requests.findIndex(x=>renderPaths.some(path=>x===path||x.startsWith(path+'?')));
 assert(mediaIndex>=0,`${label} requests the deferred media bundle`);
 assert(renderIndex>=0,`${label} observes its expected render data request ${JSON.stringify(renderPaths)}: ${JSON.stringify(requests)}`);
 assert(mediaIndex<renderIndex,`${label} requests media before activity data/rendering: ${JSON.stringify(requests)}`);
 assert(await page.evaluate(()=>typeof activityMedia==='function'),`${label} renderer is available`);
}
(async()=>{
 try{cp.execFileSync('python3',[detailFixture],{env:{...process.env,KINETTA_DETAIL_IDS:idsPath},stdio:'inherit'});}catch(e){throw Error(`Fictional activity fixture failed: ${e.message}`);}
 const ids=JSON.parse(fs.readFileSync(idsPath,'utf8')),browser=await chromium.launch();
 try{
  const auth=await browser.newContext();await login(auth,'zz_test_detail_owner');const state=await auth.storageState(),me=await(await auth.request.get(base+'/api/me')).json();await auth.close();
  const mediaCase=process.env.KINETTA_MEDIA_CASE||'';
  if(mediaCase&&!['preview','preview-stale'].includes(mediaCase))throw Error(`Unknown KINETTA_MEDIA_CASE ${mediaCase}`);
  // Selectors run only new Me-preview groups; unset means all existing route coverage still runs.
  if(!mediaCase||mediaCase==='preview'){
  // Let the ordinary post-Me Social warmup run and finish its badge refresh. It must not fetch media.
  {
   const c=await browser.newContext({storageState:state,viewport:{width:390,height:844},serviceWorkers:'block'}),p=await c.newPage(),requests=[],errors=[],networkIssues=[];
   await guard(p,requests,errors,networkIssues);const socialRefresh=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/notifications/count'&&r.request().method()==='GET',{timeout:20000});
   console.log('Media route case start: cold Me with scheduled Social warmup');await p.goto(base+'/me');await ready(p,'.me-card-sections[aria-busy="false"]','cold Me with scheduled Social warmup',{errors,networkIssues});
   await socialRefresh;await p.waitForFunction(()=>classicScriptsLoaded.has(SOCIAL_ROUTE_ASSET)&&Social.at>0,null,{timeout:20000});
   assert.equal(requests.includes('/static/media.js'),false,'cold Me stays media-free after the real scheduled Social warmup');
   assert.equal(await p.locator('script[src*="/static/media.js"]').count(),0,'Me has no eager media tag');
   await p.locator('[data-card-preview]').click();const preview=p.locator('[data-profile-preview]');await preview.locator('.me-card-sections[aria-busy="false"]').waitFor();
   await previewSettled(p,errors,'cold Me preview');
   assert.equal(requests.filter(x=>x==='/static/media.js').length,1,'View as friend demand-loads media on first action after cold Me');
   assert(await p.evaluate(()=>classicScriptsLoaded.has(MEDIA_ROUTE_ASSET)&&typeof wireActivityMedia==='function'),'the media script and activity-card wiring function are available after preview settles');
   assert.equal(await preview.locator('[role="alert"]').count(),0,'the settled card-only preview has no retry alert');
   assert.equal(await preview.locator('[data-card-edit],[data-card-share],[data-card-preview],[data-person-manage],[data-person-report]').count(),0,'the preview remains read-only');
   assert.doesNotMatch(await preview.innerText(),/Only you|PRIVATE-ONLY|Fictional run session|Fictional treadmill session|Fictional lifting session/,'the card-only preview excludes private content and owner-only controls');
   assert.deepEqual(errors,[],'cold Me and its card-only preview have no page errors');await c.close();
  }
  // The Me preview uses the same explicit retry when its action-time media dependency fails.
  {
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,'zz_test_detail_owner');
   const p=await c.newPage(),requests=[],errors=[],networkIssues=[],attempts={media:0};let previewFetches=0;await guard(p,requests,errors,networkIssues);p.on('request',request=>{const u=new URL(request.url());if(u.origin===base&&u.pathname==='/api/people/zz_test_detail_owner/profile'&&u.searchParams.get('as_friend')==='true'&&u.searchParams.get('preview')==='member')previewFetches++;});await p.unroute('**/*');
   await p.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();if(u.pathname==='/static/media.js'&&++attempts.media===1)return route.abort();if(q.method()==='POST'&&u.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});if(!['GET','HEAD'].includes(q.method()))return route.abort();return route.continue();});
   await p.goto(base+'/me');await ready(p,'.me-card-sections[aria-busy="false"]','Me before preview media retry',{errors,networkIssues});
   await p.locator('[data-card-preview]').click();const preview=p.locator('[data-profile-preview]');await preview.locator('[role="alert"]').waitFor();
   assert.equal(attempts.media,1,'the preview media request fails once');assert(await preview.locator('[data-profile-preview-retry]').isVisible(),'media failure keeps the existing explicit Try again action');
   await preview.locator('[data-profile-preview-retry]').click();await previewSettled(p,errors,'preview retry');
   assert.equal(attempts.media,2,'the same preview action retries the rejected media loader');
   assert(await p.evaluate(()=>classicScriptsLoaded.has(MEDIA_ROUTE_ASSET)&&typeof wireActivityMedia==='function'),'retry settles after the media script and activity-card wiring load');
   assert.equal(await preview.locator('[role="alert"]').count(),0,'successful explicit retry clears the prior media error');
   assert.equal(previewFetches,2,'initial action and explicit retry each request the member-filtered preview');assert.deepEqual(errors,[],'preview loader failure and retry cause no browser exception');await c.close();
  }
  }
  if(!mediaCase||mediaCase==='preview'||mediaCase==='preview-stale'){
  // Pending action-time loads cannot paint into a changed query, owner or detached preview host.
  for(const stale of ['query','owner','detached']){
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,'zz_test_detail_owner');
   const p=await c.newPage(),errors=[],networkIssues=[];await guard(p,[],errors,networkIssues);let entered,release;
   const mediaEntered=new Promise(resolve=>{entered=resolve;}),mediaGate=new Promise(resolve=>{release=resolve;});
   await p.route('**/static/media.js*',async route=>{entered();await mediaGate;return route.continue();});
   await p.goto(base+'/me');await ready(p,'.me-card-sections[aria-busy="false"]','Me before stale preview '+stale,{errors,networkIssues});
   await p.locator('[data-card-preview]').click();const host=p.locator('[data-profile-preview]'),hostHandle=await host.elementHandle();await mediaEntered;
   if(stale==='query')await p.evaluate(()=>history.pushState({fixture:'stale-preview'},'',location.pathname+'?previewFixture=stale'));
   if(stale==='owner')await p.evaluate(()=>{window.__previewOwner=App.me;App.me={...App.me,id:'fictional-preview-owner-change'};});
   if(stale==='detached')await hostHandle.evaluate(node=>node.remove());
   try{const mediaLoaded=p.waitForResponse(response=>new URL(response.url()).pathname==='/static/media.js',{timeout:20000});release();await mediaLoaded;await p.waitForFunction(()=>classicScriptsLoaded.has(MEDIA_ROUTE_ASSET),null,{timeout:20000});}catch(error){const state=await hostHandle.evaluate(node=>({connected:node.isConnected,busy:node.getAttribute('aria-busy'),sectionCount:node.querySelectorAll('.me-card-sections').length,settledSections:[...node.querySelectorAll('.me-card-sections')].filter(section=>section.getAttribute('aria-busy')==='false').length,profileCardPresent:!!node.querySelector('.me-card'),alertPresent:!!node.querySelector('[role="alert"]')})).catch(()=>({stateUnavailable:true}));throw Error(`Case stale ${stale}: media load did not settle; state=${JSON.stringify({...state,pageErrorCount:errors.length,networkIssueCount:networkIssues.length})}; ${error.message}`);}await p.waitForTimeout(100);
   assert.equal(await hostHandle.evaluate(node=>node.querySelectorAll('.me-card-sections').length),0,stale+' response is ignored before composition');
   if(stale==='detached')assert.equal(await hostHandle.evaluate(node=>node.isConnected),false,'the detached preview stays detached');
   else assert.equal(await hostHandle.evaluate(node=>node.isConnected),true,stale+' preview host remains connected without stale content');
   if(stale==='owner')await p.evaluate(()=>{App.me=window.__previewOwner;delete window.__previewOwner;});
   assert.deepEqual(errors,[],stale+' preview load causes no browser exception');await c.close();
  }
  }
  if(mediaCase==='preview'||mediaCase==='preview-stale')return;
  // Home/feed, own and shared detail, person profile, legacy redirect and Track all wait for media before rendering.
  const cases=[
   {user:'zz_test_detail_owner',path:'/activity',renderPaths:['/api/activities','/api/feed/friends']},
   {user:'zz_test_detail_owner',path:`/activity/${ids.run}`,renderPaths:[`/api/activities/${ids.run}`]},
   {user:'zz_test_detail_friend',path:`/activity/friends/${ids.run}`,renderPaths:[`/api/shared/${ids.run}`]},
   {user:'zz_test_detail_owner',path:'/people/zz_test_detail_owner',renderPaths:['/api/people/zz_test_detail_owner/profile']},
   {user:'zz_test_detail_owner',path:'/me/activities',renderPaths:['/api/people/zz_test_detail_owner/profile']},
  ];
  for(const item of cases){
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,item.user);const p=await c.newPage(),requests=[],errors=[],networkIssues=[];await guard(p,requests,errors,networkIssues);
   console.log(`Media route case start: ${item.path}`);await p.goto(base+item.path);await mediaBeforeRender(p,requests,item.path,item.renderPaths,errors,networkIssues);
   if(item.path==='/me/activities')assert.equal(new URL(p.url()).pathname,'/people/zz_test_detail_owner','legacy activity alias redirects to the owner profile');
   assert.deepEqual(errors,[],`${item.path} has no page errors`);
   await c.close();
  }
  // A failed media request offers an explicit retry. Earlier dependencies stay cached and the route renders once.
  {
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,'zz_test_detail_owner');
   const p=await c.newPage(),requests=[],errors=[],networkIssues=[],attempts={};await guard(p,requests,errors,networkIssues);
   await p.unroute('**/*');await p.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();if(u.pathname==='/static/media.js'){attempts.media=(attempts.media||0)+1;if(attempts.media===1)return route.abort();}if(q.method()==='POST'&&u.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});if(!['GET','HEAD'].includes(q.method()))return route.abort();return route.continue();});
   console.log(`Media route case start: media failure/retry on /activity/${ids.run}`);await p.goto(base+`/activity/${ids.run}`);await p.locator('.load-error').waitFor();assert.equal(attempts.media,1,'first media load fails once');assert(await p.locator('#retry').isVisible(),'media failure exposes explicit retry');
   await p.locator('#retry').click();await ready(p,'.activity-media',`media retry /activity/${ids.run}`,{errors,networkIssues});assert.equal(attempts.media,2,'retry requests media again');
   assert.equal(requests.filter(x=>x==='/static/social.js').length,1,'retry reuses the already loaded Social prerequisite');
   assert.equal(requests.filter(x=>x==='/static/segments.js').length,1,'retry reuses the already loaded Segments prerequisite');
   assert.equal(requests.filter(x=>x===`/api/activities/${ids.run}`).length,1,'activity renderer runs once after successful retry');assert.deepEqual(errors,[]);await c.close();
  }
  {
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,'zz_test_detail_owner');
   const p=await c.newPage(),requests=[],errors=[],networkIssues=[],recording=require('../demo/track_session.cjs')('paused');await guard(p,requests,errors,networkIssues);
   await c.addInitScript(({uid,origin,recording})=>localStorage.setItem('kinetta.track:'+JSON.stringify([origin,uid]),JSON.stringify(recording)),{uid:me.id,origin:base,recording});
   console.log('Media route case start: restored Track review map');await p.goto(base+'/track');await ready(p,'#track-map-wrap','restored Track review map',{errors,networkIssues});
   const mediaIndex=requests.findIndex(x=>x==='/static/media.js');assert(mediaIndex>=0,'Track loads media for a restored GPS review map');
   assert(await p.evaluate(()=>classicScriptsLoaded.has(MEDIA_ROUTE_ASSET)),'Track completes the media bundle before drawing the restored review');
   assert(await p.locator('#track-map-wrap .map-full').count()===1,'restored Track map wires its full-map controls');assert.deepEqual(errors,[],'restored Track has no page errors');await c.close();
  }
  console.log('Media routes: cold Me after Social warmup, Activity/detail/shared/profile/legacy routes and restored Track map load media before rendering PASS');
 }finally{
  for(const user of ['owner','friend']){
   const context=await browser.newContext();
   try{const loginResponse=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:`zz_test_detail_${user}`,password}});if(loginResponse.ok())await context.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password}});}
   finally{await context.close();}
  }
  await browser.close();
  fs.rmSync(idsPath,{force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
