// The deferred media renderer loads only for routes that render activity cards/maps.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',password='green teapot on the hill';
const idsPath=path.join(os.tmpdir(),`kinetta-media-routes-${process.pid}.json`);
const detailFixture=path.join(__dirname,'activity_detail_fixture.py');
async function login(context,user){const response=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:user,password}});assert.equal(response.status(),200,`fictional account ${user} logs in`);}
async function ready(page,selector){await page.waitForFunction(selector=>App.pageReady&&!!document.querySelector(selector),selector,{timeout:20000});}
async function mediaBeforeRender(page,requests,label){
 await ready(page,'.activity-media');
 const mediaIndex=requests.findIndex(x=>x==='/static/media.js'),renderIndex=requests.findIndex(x=>x==='/api/activities'||x.startsWith('/api/shared/')||x.includes('/profile'));
 assert(mediaIndex>=0,`${label} requests the deferred media bundle`);
 assert(renderIndex<0||mediaIndex<renderIndex,`${label} requests media before activity data/rendering: ${JSON.stringify(requests)}`);
 assert(await page.evaluate(()=>typeof activityMedia==='function'),`${label} renderer is available`);
}
(async()=>{
 try{cp.execFileSync('python3',[detailFixture],{env:{...process.env,KINETTA_DETAIL_IDS:idsPath},stdio:'inherit'});}catch(e){throw Error(`Fictional activity fixture failed: ${e.message}`);}
 const ids=JSON.parse(fs.readFileSync(idsPath,'utf8')),browser=await chromium.launch();
 try{
  const auth=await browser.newContext();await login(auth,'zz_test_detail_owner');const state=await auth.storageState(),me=await(await auth.request.get(base+'/api/me')).json();await auth.close();
  // Let the ordinary post-Me Social warmup run and finish its badge refresh. It must not fetch media.
  {
   const c=await browser.newContext({storageState:state,viewport:{width:390,height:844},serviceWorkers:'block'}),p=await c.newPage(),requests=[];
   p.on('request',r=>{const u=new URL(r.url());if(u.origin===base)requests.push(u.pathname);});
   await p.goto(base+'/me');await ready(p,'.me-card-sections[aria-busy="false"]');
   await p.waitForFunction(()=>classicScriptsLoaded.has(SOCIAL_ROUTE_ASSET)&&Social.at>0,{timeout:20000});
   await p.waitForResponse(r=>new URL(r.url()).pathname==='/api/notifications/count'&&r.request().method()==='GET',{timeout:10000});
   assert.equal(requests.includes('/static/media.js'),false,'cold Me stays media-free after the real scheduled Social warmup');
   assert.equal(await p.locator('script[src*="/static/media.js"]').count(),0,'Me has no eager media tag');await c.close();
  }
  // Home/feed, own and shared detail, person profile, legacy redirect and Track all wait for media before rendering.
  const cases=[
   {user:'zz_test_detail_owner',path:'/activity',selector:'.activity-media'},
   {user:'zz_test_detail_owner',path:`/activity/${ids.run}`,selector:'.activity-media'},
   {user:'zz_test_detail_friend',path:`/activity/friends/${ids.run}`,selector:'.activity-media'},
   {user:'zz_test_detail_owner',path:'/people/zz_test_detail_owner',selector:'.activity-media'},
   {user:'zz_test_detail_owner',path:'/me/activities',selector:'.activity-media'},
  ];
  for(const item of cases){
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,item.user);const p=await c.newPage(),requests=[];
   p.on('request',r=>{const u=new URL(r.url());if(u.origin===base)requests.push(u.pathname);});
   await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='POST'&&u.pathname==='/api/challenges/signup/continue')return r.fulfill({status:204});if(!['GET','HEAD'].includes(q.method()))return r.abort();return r.continue();});
   await p.goto(base+item.path);await mediaBeforeRender(p,requests,item.path);
   if(item.path==='/me/activities')assert.equal(new URL(p.url()).pathname,'/people/zz_test_detail_owner','legacy activity alias redirects to the owner profile');
   await c.close();
  }
  {
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await login(c,'zz_test_detail_owner');
   const p=await c.newPage(),requests=[],recording=require('../demo/track_session.cjs')('paused');
   await c.addInitScript(({uid,origin,recording})=>localStorage.setItem('kinetta.track:'+JSON.stringify([origin,uid]),JSON.stringify(recording)),{uid:me.id,origin:base,recording});
   p.on('request',r=>{const u=new URL(r.url());if(u.origin===base)requests.push(u.pathname);});
   await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='POST'&&u.pathname==='/api/challenges/signup/continue')return r.fulfill({status:204});if(!['GET','HEAD'].includes(q.method()))return r.abort();return r.continue();});
   await p.goto(base+'/track');await p.waitForFunction(()=>App.pageReady&&!!document.querySelector('#track-map-wrap'),null,{timeout:20000});
   const mediaIndex=requests.findIndex(x=>x==='/static/media.js');assert(mediaIndex>=0,'Track loads media for a restored GPS review map');
   assert(await p.evaluate(()=>classicScriptsLoaded.has(MEDIA_ROUTE_ASSET)),'Track completes the media bundle before drawing the restored review');
   assert(await p.locator('#track-map-wrap .map-full').count()===1,'restored Track map wires its full-map controls');await c.close();
  }
  console.log('Media routes: cold Me after Social warmup, Activity/detail/shared/profile/legacy routes and restored Track map load media before rendering PASS');
 }finally{await browser.close();fs.rmSync(idsPath,{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
