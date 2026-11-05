// Fictional Activity cards only. Basemap tiles are stand-ins; device writes/external requests are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL,out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
assert(out&&base&&['localhost','127.0.0.1'].includes(new URL(base).hostname));fs.mkdirSync(out,{recursive:true});
const tile=dark=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="${dark?'#20262b':'#edf1ec'}"/><path d="M0 40H256M0 120H256M0 210H256M40 0V256M140 0V256M230 0V256" stroke="${dark?'#39434a':'#fff'}" stroke-width="10"/><path d="M-10 180Q80 180 120 120T266 90" fill="none" stroke="${dark?'#254454':'#b9d9e7'}" stroke-width="22"/></svg>`;
async function until(p,fn,label,arg){for(let n=0;n<150;n++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
async function capture(p,card,name,pending=false){
 await card.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
 const map=card.locator('.fmap');
 if(!pending&&await map.count())await until(p,href=>{const el=[...document.querySelectorAll('.activity-card')].find(n=>n.dataset.href===href)?.querySelector('.fmap'),tiles=[...(el?.querySelectorAll('.leaflet-tile')||[])];return el?.classList.contains('ready')&&tiles.length&&tiles.every(n=>n.classList.contains('leaflet-tile-loaded'));},'complete fictional basemap',await card.getAttribute('data-href'));
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);
 const box=await card.boundingBox(),nav=await p.locator('nav.tabs').boundingBox(),head=await card.locator('.post-hd').boundingBox();
 assert(box.y>=0&&box.y+box.height<=nav.y,'complete card is visible above tabs');
 assert(head.y>=box.y&&head.y+head.height<=box.y+box.height,'complete header is inside card');
 for(const target of await card.locator('.post-title-link,.post-name,.post-av,.reaction-more,.activity-comments,.activity-share').all()){if(!await target.isVisible())continue;const r=await target.boundingBox();assert(r.width>=43.98&&r.height>=43.98,`separate controls retain44px targets: ${await target.getAttribute('class')} ${JSON.stringify(r)}`);}
 assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'no horizontal overflow');
 if(await card.locator('.activity-picture').count()){
  const picture=await card.locator('.activity-picture').boundingBox();assert(picture.height>=picture.width-1,'square frame grows only when identity needs extra clearance');
  assert.equal(await card.locator('.post-map-metrics').count(),1,'numbers appear once');
  assert.equal(await card.locator('.activity-picture > .post-hd').count(),1,'identity is anchored outside the moving rail');
  assert.equal(await card.locator(':scope > .post-hd').count(),0,'no duplicate header above media');
 }
 await p.screenshot({path:path.join(out,name+'.png'),clip:box,animations:'disabled'});
}
(async()=>{
 const env={...process.env};if(env.KINETTA_ACTIVITY_FIXTURE_TMPDIR)env.TMPDIR=env.KINETTA_ACTIVITY_FIXTURE_TMPDIR;
 if(process.env.KINETTA_MAP_FIXTURE_READY!=='1')cp.execFileSync('python3',['dev/tests/activity_fixture.py'],{env,stdio:'inherit'});
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import login;assert login('zz_test_feed_friend1').put('/api/sharing',{'details':{'pace':False}})[0]==200"],{env,stdio:'inherit'});
 const b=await chromium.launch();try{
  for(const width of process.env.KINETTA_MAP_MATRIX==='1'?[390,330]:[390])for(const theme of ['light','dark']){
   if(process.env.KINETTA_MAP_INTERACTIONS==='1'&&theme==='dark')continue;
   const c=await b.newContext({viewport:{width,height:1000},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'});
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_feed_heavy',password:pw}})).status(),200);
   let tileMode='ready',releaseTiles;const tileGate=new Promise(resolve=>releaseTiles=resolve);
   await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{window.cardViews=new Map();const original=window.mapInto;window.mapInto=async(...args)=>{const view=await original(...args);if(view)window.cardViews.set(args[0],view);return view;};}));
   const errors=[];await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/fictional-map/{z}/{x}/{y}.svg',max_zoom:18,attribution:'Fictional test basemap'}});if(u.pathname.startsWith('/fictional-map/')){if(tileMode==='hold')await tileGate;if(tileMode==='fail')return r.fulfill({status:503,body:'Fictional tile failure'});return r.fulfill({contentType:'image/svg+xml',body:tile(theme==='dark')});}if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();});
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
   await p.goto(base+'/activity');await until(p,()=>App.pageReady&&document.querySelector('#feed-tools')?.getAttribute('aria-busy')==='false','Activity ready');assert.equal(await p.locator('h1').innerText(),'Activity');
   const own=p.locator('#ff-list .post[data-href^="/activity/"]:not([data-href^="/activity/friends/"])').filter({hasText:'Fictional short route'}).first();
   await capture(p,own,'own-map-'+width+'-'+theme);
   if(theme==='light'){
    const friend=p.locator('#ff-list .post[data-href^="/activity/friends/"]').filter({has:p.locator('.post-name[href="/people/zz_test_feed_friend1"]')}).first();
    assert.doesNotMatch(await friend.locator('.post-map-metrics').innerText(),/pace|\/mi|\/km/i,'hidden friend pace stays out of rendered/accessible metadata');assert.equal(await friend.locator('[data-share-picture]').count(),0,'sharing stays owner-only');
    await capture(p,friend,'friend-hidden-pace-'+width+'-light');
    const noMap=p.locator('#ff-list .post').filter({hasText:'Fictional treadmill workout'});assert.equal(await noMap.locator('.activity-picture,.fmap').count(),0,'no media means no blank square');assert.equal(await noMap.locator('.post-summary .stat').count(),3,'mapless meaningful metrics retained');await capture(p,noMap,'no-map-'+width+'-light');
   }
   if(process.env.KINETTA_MAP_INTERACTIONS==='1'){
    const identity=await own.locator('.post-hd').elementHandle(),numbers=await own.locator('.post-map-metrics').innerText();
    await own.locator('[data-media-step="1"]').click();await until(p,()=>document.querySelector('#ff-list .post-led[data-href^="/activity/"]:not([data-href^="/activity/friends/"]) [data-media-dot="1"]')?.classList.contains('current'),'carousel photo selected');
    assert(await identity.evaluate(n=>n.isConnected),'carousel retains the identity node');assert.equal(await own.locator('.post-map-metrics').innerText(),numbers,'carousel retains one permitted metric set');
    await own.locator('[data-media-photo]').first().click();await p.locator('.ph-view').waitFor();await p.keyboard.press('Escape');assert.equal(new URL(p.url()).pathname,'/activity','photo viewer closes back to the same Activity path');
    await own.locator('.media-track').focus();await p.keyboard.press('Home');await until(p,()=>document.querySelector('#ff-list .post-led[data-href^="/activity/"]:not([data-href^="/activity/friends/"]) [data-media-dot="0"]')?.classList.contains('current'),'keyboard returns to map');
    const popup=await Promise.all([c.waitForEvent('page'),own.locator('.leaflet-control-attribution a').first().click()]);assert.equal(new URL(p.url()).pathname,'/activity','provider link does not trigger card navigation');await popup[0].close();
    await own.locator('.post-name').click();await p.locator('#person-activities').waitFor();assert.equal(new URL(p.url()).pathname,'/people/zz_test_feed_heavy','profile name keeps its existing destination');
    await p.goto(base+'/activity');await until(p,()=>App.pageReady&&document.querySelector('#feed-tools')?.getAttribute('aria-busy')==='false','Activity returns');const href=await own.getAttribute('data-href');await own.locator('.post-title-link').click();await until(p,href=>location.pathname===href&&App.pageReady,'title opens activity',href);
    console.log('Map-led interactions: carousel, keyboard, photo viewer, attribution, profile and activity destinations PASS');
   }
   if(process.env.KINETTA_MAP_MATRIX==='1'){
    const all=await(await c.request.get(base+'/api/activities?limit=100')).json(),seed=all.find(a=>a.name==='Fictional short route');assert(seed);
    const render=async(change)=>{await p.evaluate(a=>{const box=document.querySelector('#ff-list');box.innerHTML=postCard(a,{compact:true});wireCheers(box);feedMaps(box);}, {...seed,...change});return p.locator('#ff-list .post').first();};
    const checkFit=async card=>{
      await card.locator('.fmap.ready').waitFor();await p.waitForTimeout(150);
      const geometry=await card.locator('.fmap').evaluate(el=>{const view=window.cardViews.get(el),inset=activityCardInsets(el),pts=decode(el.dataset.line).map(x=>view.map.latLngToContainerPoint(x));const before=[view.map.getCenter().lat,view.map.getCenter().lng,view.map.getZoom()];for(let n=0;n<4;n++){measureActivityPictures(el.closest('#ff-list'));el._activityMapFit();}return{inset,width:el.clientWidth,height:el.clientHeight,minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxY:Math.max(...pts.map(p=>p.y)),before,after:[view.map.getCenter().lat,view.map.getCenter().lng,view.map.getZoom()]};});
      const g=geometry;assert(g.minX>=g.inset.side-1&&g.width-g.maxX>=g.inset.side-1&&g.minY>=g.inset.top-1&&g.height-g.maxY>=g.inset.bottom-1,'loaded route/endpoints clear measured overlays: '+JSON.stringify(g));assert.deepEqual(g.before,g.after,'repeated unchanged refresh leaves route fixed');
      return geometry;
    };
    const encode=points=>{let lat=0,lng=0,out='';for(const [a,b] of points){for(let delta of [Math.round(a*1e5)-lat,Math.round(b*1e5)-lng]){delta=delta<0?~(delta<<1):delta<<1;while(delta>=32){out+=String.fromCharCode((32|(delta&31))+63);delta>>=5;}out+=String.fromCharCode(delta+63);}lat=Math.round(a*1e5);lng=Math.round(b*1e5);}return out;};
    const routes={tall:[[40.77,-73.96],[40.79,-73.959],[40.81,-73.96]],flat:[[40.78,-73.99],[40.781,-73.96],[40.78,-73.93]],loop:[[40.77,-73.97],[40.78,-73.95],[40.79,-73.97],[40.78,-73.99],[40.77,-73.97]]};
    const fits={};for(const [name,pts] of Object.entries(routes)){const card=await render({name:'Fictional '+name+' route',line:encode(pts)});fits[name]=await checkFit(card);await capture(p,card,name+'-'+width+'-'+theme);}
    fs.writeFileSync(path.join(out,'fit-'+width+'-'+theme+'.json'),JSON.stringify(fits,null,2));
    const long=await render({name:'Fictional long morning run through the park and along the river',sport_label:'Long fictional trail running label',owner:{...seed.owner,login:'zz_test_feed_friend1',name:'River Runner With a Long Fictional Name'},shares:{pace:false},visibility:'friends'});await checkFit(long);await capture(p,long,'long-'+width+'-'+theme);
    const photo=await render({line:null,photos:seed.photos});await capture(p,photo,'photo-only-'+width+'-'+theme);
    const hit=photo.locator('[data-media-photo]').first(),r=await hit.boundingBox();assert(r.width>=44&&r.height>=44,'clear photo action retains44px');
    for(const control of await photo.locator('.post-hd a,[data-media-step]').all()){if(!await control.isVisible())continue;const b=await control.boundingBox();assert(r.x+r.width+7.98<=b.x||b.x+b.width+7.98<=r.x||r.y+r.height+7.98<=b.y||b.y+b.height+7.98<=r.y,'photo action has8px gap from identity/carousel targets');}
    await hit.focus();await p.keyboard.press('Enter');await p.locator('.ph-view').waitFor();await p.keyboard.press('Escape');
    const lift=await render({name:'Fictional strength session',sport:'lift',line:null,photos:[],distance_m:null,lifts:{sets:12,volume:4800,exercises:3,names:['Squat','Bench press','Row']}});assert.equal(await lift.locator('.activity-picture').count(),0);assert.match(await lift.innerText(),/Sets|Squat/);await capture(p,lift,'lifting-'+width+'-'+theme);
    tileMode='hold';const loading=await render({line:encode(routes.tall)});await loading.locator('.fmap.ready').waitFor();await capture(p,loading,'loading-'+width+'-'+theme,true);tileMode='fail';releaseTiles();await loading.locator('.map-unavailable:not([hidden])').waitFor();await capture(p,loading,'tile-error-'+width+'-'+theme,true);
    tileMode='ready';await loading.locator('.map-unavailable button').click();await capture(p,loading,'tile-recovered-'+width+'-'+theme);assert.equal(await loading.locator('.map-unavailable:not([hidden])').count(),0,'quiet retry recovers map');
   }
   releaseTiles();assert.deepEqual(errors,[]);console.log('Map-led checkpoint390 '+theme+': identity, square, targets, privacy and no-media PASS');await c.close();
  }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
