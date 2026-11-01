// Fictional recording and tile replies. All device access and API writes are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('../demo/track_session.cjs'),base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_EVIDENCE;
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function geometry(p){
 return p.evaluate(()=>{
  const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON(),box=rect('#track-map'),note=rect('#track-map .map-unavailable'),credit=rect('#track-map .leaflet-control-attribution');
  const named=[['Retry',note],['attribution',credit],['GPS',rect('#track-gps-live')],['route',rect('#track-follow')],['expand',rect('#track-map-wrap .map-full')]],overlaps=[];
  const inside=r=>r.left>=box.left-.5&&r.right<=box.right+.5&&r.top>=box.top-.5&&r.bottom<=box.bottom+.5;
  for(let i=0;i<named.length;i++)for(let j=i+1;j<named.length;j++){const[a,r]=named[i],[b,s]=named[j];if(Math.min(r.right,s.right)>Math.max(r.left,s.left)+.5&&Math.min(r.bottom,s.bottom)>Math.max(r.top,s.top)+.5)overlaps.push([a,b]);}
  const hits=[...document.querySelectorAll('#track-map .map-unavailable button,#track-follow,#track-map-wrap .map-full')].map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===n};});
  const controls=rect('.track-controls'),nav=rect('nav.tabs');return{box,note,credit,overlaps,inside:named.every(([,r])=>inside(r)),hits,controlsAboveTabs:controls.bottom<=nav.top+.5};
 });
}
(async()=>{
 const b=await chromium.launch();let count=0;
 try{
  const a=await b.newContext();assert.equal((await a.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  const me=await(await a.request.get(base+'/api/me')).json(),state=await a.storageState();await a.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:330,height:667,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark'])for(const credit of ['', 'Demo tiles','Demo mapping and terrain tiles']){
   const c=await b.newContext({storageState:state,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'});let requests=0,successes=0,recover=false;const writes=[],errors=[];
   try{
    await c.addInitScript(({uid,root,recording})=>{localStorage.setItem('kinetta.track:'+JSON.stringify([location.origin,uid]),JSON.stringify(recording));Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>1,clearWatch:()=>{}}});document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');},{uid:me.id,root:size.root,recording:fixture()});
    await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin===base&&u.pathname.startsWith('/test-map-tiles/')){requests++;if(recover){successes++;return r.fulfill({contentType:'image/png',body:tile});}return r.abort();}if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(req.method())){writes.push(u.pathname);return r.abort();}if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/test-map-tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:credit,attribution_url:'https://example.invalid/credit'}});return r.continue();});
    const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/track');await until(p,()=>!!document.querySelector('#track-map .map-unavailable:not([hidden])'),'failed tile feedback');await p.evaluate(()=>document.fonts.ready);
    const g=await geometry(p);if(credit==='Demo mapping and terrain tiles'&&size.width===330)assert(g.credit.height>24,'Long credit really wraps');assert(g.inside&&!g.overlaps.length&&g.controlsAboveTabs,JSON.stringify({size,theme,credit,...g}));assert(g.hits.every(h=>h.width>=44&&h.height>=44&&h.hit),'map actions keep accessible hit targets');
    await p.locator('#track-pause').click();await until(p,()=>!!document.querySelector('.track-live.is-recording .map-unavailable:not([hidden])'),'recording map feedback');const recording=await geometry(p);assert(recording.inside&&!recording.overlaps.length&&recording.controlsAboveTabs,JSON.stringify({size,theme,creditText:credit,recording}));assert(recording.hits.every(h=>h.width>=44&&h.height>=44&&h.hit));await p.locator('#track-pause').click();await until(p,()=>!!document.querySelector('.track-live.is-paused .map-unavailable:not([hidden])'),'paused map feedback');
    assert.equal(await p.locator('#track-follow').getAttribute('aria-label'),'Whole route');assert.equal(await p.getByRole('button',{name:'Retry map',exact:true}).count(),1);
    const previous=requests;await p.getByRole('button',{name:'Retry map',exact:true}).click();for(let n=0;n<100&&requests===previous;n++)await p.waitForTimeout(50);assert(requests>previous,'Retry requests the basemap again');
    if(out&&credit&&size.width===330&&size.root===24&&size.height===667){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`map-feedback-${theme}.png`)});}
    await p.locator('#track-map-wrap .map-full').click();await until(p,()=>!!document.querySelector('#track-map-wrap.full'),'expanded map');
    const expanded=await p.evaluate(()=>{const n=document.querySelector('.map-unavailable').getBoundingClientRect(),c=document.querySelector('.track-full-controls').getBoundingClientRect(),a=document.querySelector('.leaflet-control-attribution').getBoundingClientRect();return{note:n.toJSON(),controls:c.toJSON(),credit:a.toJSON()};});assert(expanded.note.bottom<=expanded.controls.top&&expanded.credit.bottom<=expanded.controls.top,'expanded feedback and credits stay above recording controls');
    await p.keyboard.press('Escape');recover=true;await p.getByRole('button',{name:'Retry map',exact:true}).click();let stable=0;for(let n=0;n<150&&stable<3;n++){const loaded=await p.evaluate(()=>{const tiles=[...document.querySelectorAll('#track-map .leaflet-tile')];return tiles.length>0&&tiles.every(t=>t.classList.contains('leaflet-tile-loaded'))&&!!document.querySelector('.map-unavailable[hidden]');});stable=successes>0&&loaded?stable+1:0;if(stable<3)await p.waitForTimeout(100);}assert.equal(stable,3,'A settled successful tile batch removes failure feedback');assert.equal(await p.locator('#track-follow span').evaluate(n=>n.getBoundingClientRect().width>1),true,'route label returns after recovery');
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);count++;
   }finally{await c.close();}
  }
 }finally{await b.close();}
 console.log(`Offline map feedback: ${count} size/theme/credit cases, Retry, full-screen and recovery passed`);
})().catch(e=>{console.error(e);process.exit(1);});
