// Real GPS/review controls with fictional demo fixes and intercepted save replies. No device actions or API writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const fixture=require('../demo/track_session.cjs'),base=process.env.KINETTA_URL || 'http://localhost:8798',out=process.env.KINETTA_EVIDENCE;
async function until(page,fn,label){for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error(label);}
(async()=>{
 const b=await chromium.launch();
 try {
  const auth=await b.newContext();assert.equal((await auth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  const me=await(await auth.request.get(base+'/api/me')).json(),state=await auth.storageState();await auth.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:330,height:667,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']) {
   const c=await b.newContext({storageState:state,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[],writes=[],saves=[];
   p.on('pageerror',e=>errors.push(e.message));
   await c.addInitScript(({recording,uid,base,root})=>{
    const key='kinetta.track:'+JSON.stringify([base,uid]);if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(recording));
    Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>1,clearWatch:()=>{}}});
    document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
   },{recording:fixture(),uid:me.id,base,root:size.root});
   let saveMode='offline';
   await c.route('**/*',r=>{const req=r.request(),url=new URL(req.url());if(url.origin!==base)return r.abort();if(url.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(req.method())){if(url.pathname==='/api/activities/track'){saves.push(req.postDataJSON());return saveMode==='offline'?r.abort('internetdisconnected'):r.fulfill({json:{id:999942,duplicate:false}});}writes.push(url.pathname);return r.abort();}return r.continue();});
   const snap=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${size.width}x${size.height}-${size.root}-${theme}-${name}.png`)});}};
   await p.goto(base+'/track');await p.locator('#track-pause').waitFor();await p.locator('#track-pause').click();await p.locator('#track-lap').waitFor();
   await until(p,()=>!!document.querySelector('#track-map .leaflet-pane'),'live map');
   assert((await p.locator('.track-live-metrics').innerText()).includes('Avg pace'));assert.notEqual(await p.locator('#track-lap-pace').innerText(),'—','new journal knows its current mile pace');
   const controls=await p.evaluate(()=>{const r=document.querySelector('#track-pause').closest('.track-controls').getBoundingClientRect(),nav=document.querySelector('nav.tabs').getBoundingClientRect();return {top:r.top,bottom:r.bottom,nav:nav.top};});assert(controls.top>=0 && controls.bottom<=controls.nav,'live controls and captions stay above tabs, including enlarged text');
   await snap('01-live');
   await p.locator('#track-map-wrap .map-full').click();assert(await p.locator('#track-map-wrap.full').isVisible());
   assert(await p.locator('#track-map-wrap.full [data-track-lap]').isVisible());assert(await p.locator('nav.tabs').isHidden());
   await p.locator('#track-map-wrap.full [data-track-lap]').click();assert(await p.locator('#track-map-wrap.full').isVisible(),'Lap leaves the expanded map open');
   const first=await p.evaluate(()=>JSON.parse(localStorage.getItem('kinetta.track:'+JSON.stringify([location.origin,App.me.id]))));
   assert.equal(first.laps.length,1);assert.equal(first.laps[0].distance,first.distance,'first manual lap starts at activity start');assert(first.laps[0].distance>1609.344);
   await snap('02-map-manual');await p.keyboard.press('Escape');assert.equal(await p.locator('#track-map-wrap.full').count(),0);assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Full-screen map');
   await p.locator('#track-map-wrap .map-full').click();await p.goBack();await until(p,()=>!document.querySelector('#track-map-wrap.full'),'map Back');assert.equal(new URL(p.url()).pathname,'/track');
   await p.locator('#track-pause').click();await p.locator('#track-finish').click();await until(p,()=>!!document.querySelector('#track-photos-add:not(:disabled)'),'review/photo storage');
   assert.equal(await p.locator('.top h1').innerText(),'Review activity');assert(await p.locator('#track-review-charts .chartbox').count()>=1);
   await p.locator('input[name=activity_name]').fill('Fictional weekend run');const mapBeforePhoto=await p.locator('#track-map').elementHandle();
   await p.locator('#track-photos-file').setInputFiles(path.resolve('dev/demo/photos/curry-rice-bowl.jpg'));await until(p,()=>document.querySelectorAll('.track-photo-list figure').length===1 && !document.querySelector('#track-save').disabled,'local photo review');
   assert.equal(saves.length,0,'photos stay local until explicit Save');assert.equal(await p.locator('input[name=activity_name]').inputValue(),'Fictional weekend run');
   assert(await p.evaluate(node=>document.querySelector('#track-map')===node,mapBeforePhoto),'photo preparation preserves the loaded map');
   await snap('03-review');
   await p.locator('.track-review-details summary').click();assert(await p.locator('.track-review-details .tblwrap').isVisible());
   const svg=p.locator('#track-review-charts .chartbox svg').first();await svg.scrollIntoViewIfNeeded();await svg.focus();await p.keyboard.press('End');assert(await p.locator('#track-review-charts .readout button').isVisible());await p.locator('#track-review-charts .readout button').click();
   await snap('04-charts-details');
   await p.reload();await until(p,()=>document.querySelectorAll('.track-photo-list figure').length===1 && !document.querySelector('#track-save').disabled,'retained photo draft');
   assert.equal(await p.locator('input[name=activity_name]').inputValue(),'Fictional weekend run');
   await p.locator('#track-save').click();await until(p,()=>document.querySelector('#track-save')?.textContent==='Retry save' && !document.querySelector('#track-save').disabled,'uncertain save');
   assert.equal(saves.length,1);assert.equal(saves[0].photos.length,1);assert.equal(saves[0].laps.length,1);assert.equal(saves[0].review_version,1);
   assert(await p.locator('input[name=activity_name]').isDisabled());assert.equal(await p.locator('#track-continue').count(),0);assert.equal(await p.locator('#track-save-error').innerText(),'Save not confirmed. Draft kept.');
   await snap('05-retry');await p.reload();await until(p,()=>document.querySelector('#track-save')?.textContent==='Retry save' && !document.querySelector('#track-save').disabled,'confirmed request recovery');
   await p.evaluate(()=>{App.me.share_default='everyone';Track.draw();});assert.equal(await p.locator('select[name=visibility]').inputValue(),'me','retry displays the originally confirmed audience');
   const fit=await p.evaluate(()=>{const save=document.querySelector('#track-save'),r=save.getBoundingClientRect(),nav=document.querySelector('nav.tabs').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,top:r.top,bottom:r.bottom,navTop:nav.top,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id};});
   assert(!fit.overflow);assert(fit.top>=0 && fit.bottom<=fit.navTop+1,'Save stays above tabs');assert.equal(fit.hit,'track-save');
   saveMode='ok';await p.locator('#track-save').click();await p.locator('.track-saved').waitFor();assert.equal(saves.length,2);assert.deepEqual(saves[1],saves[0],'Retry sends exactly the confirmed photos/laps/audience');
   assert.equal(await p.evaluate(()=>Track.active),false);assert.equal(await p.evaluate(()=>TrackReviewStore.pending('kinetta.track:'+JSON.stringify([location.origin,App.me.id]))),null,'acknowledged saves remove their local confirmed request');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`GPS lap/map/photo/chart/save/recovery: ${size.width}x${size.height}px/${size.root}px ${theme} PASS`);
  }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
