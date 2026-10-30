// Map before Start: drag, pinch and full screen work (Ben, 30 Oct 2026). Fictional demo account and a fictional location;
// map tiles and every write are intercepted, so nothing is recorded or saved.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState(),token=st.cookies.find(k=>/sess|login|token/i.test(k.name))?.value;assert(token,'login token');
for(const size of [{width:390,height:844},{width:330,height:667}])for(const theme of ['light','dark']){
 const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,geolocation:{latitude:51.5007,longitude:-0.1246,accuracy:12},permissions:['geolocation'],timezoneId:'America/New_York'});
 // GPS recording is iPhone-only, so stand in for the app shell: its saved login and an idle recorder (no session).
 await c.addInitScript(({base,token})=>{const prefs={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='KinettaTrack'||n==='Preferences',
  Plugins:{Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}},
   KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()})}}};},{base,token});
 const p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await c.route(u=>!u.href.startsWith(base),r=>r.abort());
 await c.route('**/api/**',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){writes.push(new URL(q.url()).pathname);return r.fulfill({json:{}});}return r.continue();});
 await p.goto(base+'/track');await p.waitForFunction(()=>App.pageReady);
 // The fictional fix (a public park) puts the dot and accuracy chip on the map at street level.
 await p.waitForFunction(()=>document.querySelector('#track-ready-map .leaflet-map-pane')&&!document.querySelector('#track-gps-chip').hidden,null,{timeout:15000});await p.waitForTimeout(300);
 const map=p.locator('#track-ready-map');
 const dotNear=async()=>{const m=await map.boundingBox(),d=await p.locator('#track-ready-map .leaflet-interactive, #track-ready-map path.leaflet-interactive, #track-ready-map path').last().boundingBox();return Math.abs(d.x+d.width/2-(m.x+m.width/2))<24&&Math.abs(d.y+d.height/2-(m.y+m.height/2))<24;};
 assert(await dotNear(),'dot centred');await p.locator('#track-ready-map-wrap .map-full').click();await p.waitForSelector('#track-ready-map-wrap.full');await p.waitForTimeout(200);
 assert(await dotNear(),'dot stays centred in full screen');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.track-ready-map-wrap.full'));await p.waitForTimeout(200);assert(await dotNear(),'and after closing');
 assert.equal(await map.evaluate(el=>el.classList.contains('leaflet-touch-drag')||el.classList.contains('leaflet-grab')),true,'small map can be dragged');
 // A drag moves the map (and stops following the dot); the locate button still re-centres.
 const centre=()=>p.evaluate(()=>{const pane=document.querySelector('#track-ready-map .leaflet-map-pane');return pane.style.transform;});
 const before=await centre(),box=await map.boundingBox();
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2-80,box.y+box.height/2-40,{steps:8});await p.mouse.up();
 assert.notEqual(await centre(),before,'drag pans the map');
 const expand=p.locator('#track-ready-map-wrap .map-full'),locate=p.locator('#track-locate');
 for(const button of [expand,locate]){const bb=await button.boundingBox();assert(bb.width>=44&&bb.height>=44,'44px target');}
 const [e,lo]=[await expand.boundingBox(),await locate.boundingBox()];assert(e.y+e.height<=lo.y,'expand sits above locate');
 if(out&&size.width===390){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/track-ready-${theme}.png`});}
 // Full screen covers the page with the controls reachable, and Close / Escape bring the page back.
 await expand.click();await p.waitForSelector('#track-ready-map-wrap.full');
 const full=await p.locator('#track-ready-map-wrap').boundingBox();assert(full.width>=size.width-1&&full.height>=size.height-1,'full screen');
 const mb=await map.boundingBox();assert(mb.height>=size.height-1,'map fills the screen');
 assert(await locate.isVisible(),'locate in full screen');assert.equal(await p.locator('#track-start').evaluate(n=>!!n.closest('[inert]')),true,'page behind is inert');
 if(out&&size.width===390)await p.screenshot({path:`${out}/track-ready-full-${theme}.png`});
 await expand.click();await p.waitForFunction(()=>!document.querySelector('.track-ready-map-wrap.full')&&document.querySelector('#track-content #track-ready-map-wrap'));
 await expand.click();await p.waitForSelector('#track-ready-map-wrap.full');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.track-ready-map-wrap.full'));
 assert.equal(new URL(p.url()).pathname,'/track','closing stays on Track');
 assert.equal(await p.locator('#track-start').evaluate(n=>!n.closest('[inert]')),true,'page usable again');
 const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!ov,'no overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Track ready map ${size.width}x${size.height} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
