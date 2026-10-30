// The real launch page and fictional API data; an idle native stand-in records calls without GPS/Health effects.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'track_fixture.py')],{env:process.env,stdio:'inherit'});
 const b=await chromium.launch(),cleanup=[];
 try{for(const who of ['empty','runner','lifter'])for(const native of [true,false])for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
  if(process.env.KINETTA_TRACK_CASE&&process.env.KINETTA_TRACK_CASE!==`${who}-${native?'native':'browser'}-${size.width}-${theme}`)continue;
  const c=await b.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});cleanup.push(c);
  const signed=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_'+who,password:pw,app:native}});assert.equal(signed.status(),200);
  const token=(await signed.json()).token,auth=native?{Authorization:'Bearer '+token}:{},get=url=>c.request.get(base+url,{headers:auth}),me=await(await get('/api/me')).json(),rows=await(await get('/api/interval-presets')).json(),saved=rows.find(r=>r.definition.name==='Fictional 3 / 1');
  await c.addInitScript(({base,token,native,root,saved,id,who})=>{
   window.trackFixtureCalls=[];document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
   if(!native)return;const prefs={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>['KinettaTrack','Preferences'].includes(n),Plugins:{Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}},KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({routePlanSupport:1}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()}),intervalCapabilities:async()=>({intervalCapabilities:{outdoor:true}}),start:async args=>{trackFixtureCalls.push(['start',args]);throw Error('Fictional recording blocked');}}}};
   const scope=JSON.stringify([base,id]);if(who==='runner')localStorage.setItem('intervals:'+scope+':selected',JSON.stringify(saved));if(who==='lifter')localStorage.setItem('kinetta.track:'+scope+':choice','10');
  },{base,token,native,root:size.root,saved,id:me.id,who});
  const p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(q.method()==='PUT'&&u.pathname.startsWith('/api/interval-presets/'))return r.continue();return r.fulfill({json:{}});}return r.continue();});
  await p.goto(base+'/track');const ready=()=>until(p,()=>App.pageReady&&!!document.querySelector('#track-start')&&document.querySelector('#track-explore')?.getAttribute('aria-busy')==='false','launch ready');await ready();
  assert.equal(await p.locator('h1').innerText(),'Track');assert.equal(await p.locator('#track-explore a').count(),native?4:3);assert.equal(await p.locator('#track-kind,.track-other').count(),0,'no extra global choice row');
  assert.equal(await p.locator('#track-explore').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2);
  assert(!/0 connected/.test(await p.locator('#track-explore').innerText()));assert.equal(await p.locator('#track-route').count(),0,'retired picker is not resurrected');
  for(const button of await p.locator('.track-quick button,.track-recording-options button').all())if(await button.isVisible()){const r=await button.boundingBox();assert(r.height>=44,'44px control');}
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no document overflow');
  if(size.root===16){const start=await p.locator('#track-start').boundingBox(),nav=await p.locator('nav.tabs').boundingBox(),more=await p.locator('#track-other').boundingBox();assert(start.y+start.height<nav.y,'Start above tabs');assert(more.x>=0&&more.x+more.width<=size.width,'More remains visible');if(!native){const first=await p.locator('#track-explore a').first().boundingBox();assert(first.y+first.height<nav.y,'browser first tile row visible');}}
  if(native&&who==='runner')await until(p,()=>!document.querySelector('#track-plan').hidden,'today workout');
  else assert(await p.locator('#track-plan').isHidden());
  if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${native?'native':'browser'}-${who}-${theme}.png`,fullPage:true,animations:'disabled'});}
  await p.locator('#track-other').click();await p.waitForSelector('.pick-list');await p.locator('.pick-list [data-pk]').last().click();assert.equal(await p.locator('#track-other').getAttribute('aria-pressed'),'true');
  await p.locator('[data-quick]').first().click();
  if(native){
   await p.locator('#track-options').click();await p.waitForSelector('#track-voice');await p.locator('#track-voice').uncheck();await p.keyboard.press('Escape');assert.match(await p.locator('#track-options').innerText(),/Voice off/);
   await p.locator('#interval-open').click();await p.waitForSelector('#interval-library');if(who==='runner'){await p.locator('[data-remove]').click();assert.match(await p.locator('#interval-open').innerText(),/Intervals/);}await p.keyboard.press('Escape');
   if(who==='runner'){
    const before=(await(await get('/api/interval-presets')).json()).length;
    await p.locator('[data-plan-use]').click();await until(p,()=>Intervals.selected()?.definition.name.includes('Run/walk'),'plan snapshot loaded');
    assert.equal(await p.evaluate(()=>Intervals.selected().totals.seconds),1800);assert.deepEqual(await p.evaluate(()=>trackFixtureCalls),[],'Use does not start GPS');
    await p.locator('[data-plan-use]').click();await until(p,()=>!document.querySelector('[data-plan-use]').disabled,'repeat Use');const after=(await(await get('/api/interval-presets')).json()).length;assert(after<=before+1,'repeated Use creates no second preset');
    await p.locator('#track-start').click();await until(p,()=>document.querySelector('#track-ready-error').textContent.includes('Fictional recording blocked'),'stand-in blocked start');const call=await p.evaluate(()=>trackFixtureCalls[0]);assert.equal(call[1].sport,'run');assert.equal(call[1].intervalVoice,false);assert.equal(call[1].autoPause,false);
   }
   await p.locator('[data-track-feature=import]').click();await p.waitForSelector('.sheet a[target=_blank]');assert.equal(new URL(p.url()).pathname,'/track');assert.match(await p.locator('.sheet').innerText(),/browser/);await p.keyboard.press('Escape');
  }
  await p.locator('[data-track-feature=past]').click();await p.waitForSelector('#ma');assert.equal(new URL(p.url()).pathname,'/track');await p.keyboard.press('Escape');await p.evaluate(()=>render());await ready();assert.equal(await p.locator('[data-track-feature=past] .progress-new:not(.seen)').count(),0,'visited marker is remembered');
  assert.equal((await get('/api/planned-routes')).status(),404,'parked API remains closed');
  assert.deepEqual(errors,[]);assert(!writes.some(w=>!w.startsWith('/api/interval-presets/')&&w!=='/api/challenges/signup/continue'),'no activity/Health/provider writes');console.log(`Track ${who} ${native?'native':'browser'} ${size.width}/${size.root} ${theme}: compact launch, choices, plan/intervals, settings and discovery PASS`);await c.close();cleanup.pop();
 }
 }finally{for(const c of cleanup)await c.close();for(const who of ['empty','runner','lifter']){const c=await b.newContext();try{const r=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_'+who,password:pw}});if(r.ok())await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
