// Real builder/pre-start controls, fictional accounts. Never starts GPS, speaks or writes a preset from the page.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label);}
(async()=>{
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_interval_voice');person('zz_test_interval_other')"],{cwd:path.join(__dirname,'../..'),env:process.env,stdio:'inherit'});
 const b=await chromium.launch(),admin=await b.newContext();
 const signin=(context,name)=>context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:name,password:pw}});
 await signin(admin,'zz_test_interval_voice');const me=await(await admin.request.get(base+'/api/me')).json(),st=await admin.storageState(),token=st.cookies.find(k=>/sess|login|token/i.test(k.name))?.value;assert(token,'fictional native login');
 const pin=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/interval_presets.json'),'utf8'))[0].pin;
 const saved=await(await admin.request.put(base+'/api/interval-presets/'+pin.id,{headers:{Origin:base},data:{mutation_id:require('node:crypto').randomUUID(),expected_version:null,definition:pin.definition}})).json();
 assert(saved.content_hash,'real saved preset fixture');
 try{
 for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
  const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(({base,id,saved,root,token})=>{const prefs={server:base,token:localStorage.getItem('fixture.native.token')||token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='KinettaTrack'||n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;if(key==='token')localStorage.setItem('fixture.native.token',value);},remove:async({key})=>{delete prefs[key];}},KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()})}}};localStorage.setItem('intervals:'+JSON.stringify([base,id])+':selected',JSON.stringify(saved));document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');},{base,id:me.id,saved,root:size.root,token});
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/login')return r.continue();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
  const ready=()=>until(p,()=>App.pageReady,'ready');
  const prefs=async()=>{await p.locator('#track-settings').click();await p.waitForSelector('#track-voice');};
  const total=()=>p.locator('[data-interval-voice="total"]'),pace=()=>p.locator('[data-interval-voice="pace"]');
  const close=async()=>{await p.keyboard.press('Escape');await p.waitForSelector('.sheet',{state:'detached'});};
  const snap=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(350);await p.screenshot({path:`${out}/interval-${name}-${theme}.png`,animations:'disabled'});}};
  await p.goto(base+'/track');await ready();await prefs();assert(await total().getAttribute('aria-pressed').then(v=>v==='true'));assert(await pace().getAttribute('aria-pressed').then(v=>v==='true'));
  await snap('recording-settings');await close();await p.locator('#interval-open').click();await p.waitForSelector('[data-open]');await p.locator('[data-open]').first().click();await p.locator('[data-edit]').click();await p.waitForSelector('#interval-editor');assert(await total().getAttribute('aria-pressed').then(v=>v==='true'));assert(await pace().getAttribute('aria-pressed').then(v=>v==='true'));await snap('builder');await close();await prefs();await total().click();await close();
  await p.locator('#interval-open').click();await p.waitForSelector('[data-open]');await p.locator('[data-open]').first().click();await p.locator('[data-edit]').click();await p.waitForSelector('#interval-editor');
  assert(!(await total().getAttribute('aria-pressed').then(v=>v==='true')));assert(await pace().getAttribute('aria-pressed').then(v=>v==='true'));await pace().click();
  const amount=p.locator('[data-amount="run"]');await amount.fill('4');await p.locator('#interval-sum').click();assert.equal(await amount.inputValue(),'4','background dismissal keeps builder input');assert(!(await amount.evaluate(n=>n===document.activeElement)),'background dismisses focused input');
  await total().scrollIntoViewIfNeeded();if(size.root===16){const a=await total().boundingBox(),b=await pace().boundingBox();assert(Math.abs(a.y-b.y)<2,'voice choices share one row');const w=await p.locator('[data-extra=warm]').boundingBox(),c=await p.locator('[data-extra=cool]').boundingBox();assert(Math.abs(w.y-c.y)<2,'warm/cool share one row');}
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'builder no overflow');assert(await p.locator('.sheet').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'sheet has no overflow');
  assert(await total().evaluate(n=>n.getBoundingClientRect().height>=44));
  await close();await prefs();assert(!(await total().getAttribute('aria-pressed').then(v=>v==='true')));assert(!(await pace().getAttribute('aria-pressed').then(v=>v==='true')));
  await p.locator('#track-voice').uncheck();assert(await total().isDisabled());assert(await pace().isDisabled());assert(await p.locator('.interval-voice-preferences.settings').isHidden());assert.equal(await p.evaluate(()=>Intervals.voicePreferences().voice),false);await snap('recording-settings-off');await close();await p.locator('#interval-open').click();await p.waitForSelector('[data-open]');await p.locator('[data-open]').first().click();await p.locator('[data-edit]').click();await p.waitForSelector('#interval-editor');assert.match(await p.locator('.voice-chip-label').innerText(),/Also say · voice is off/);assert(await total().isDisabled());assert.equal(await p.locator('.voice-chip-row').getAttribute('aria-disabled'),'true');await close();await p.reload();await ready();await prefs();assert(!(await total().getAttribute('aria-pressed').then(v=>v==='true')));assert(!(await pace().getAttribute('aria-pressed').then(v=>v==='true')));assert(!(await p.locator('#track-voice').isChecked()));await close();
  // The same browser keeps independent defaults for another account; changing an extra never changes the preset hash.
  await p.evaluate(async({base,pw})=>{await Native.login(base,'zz_test_interval_other',pw);await start();},{base,pw});await ready();assert.deepEqual(await p.evaluate(()=>Intervals.voicePreferences()),{voice:true,total:true,pace:true});
  await p.evaluate(async({base,pw})=>{await Native.login(base,'zz_test_interval_voice',pw);await start();},{base,pw});await ready();assert.deepEqual(await p.evaluate(()=>Intervals.voicePreferences()),{voice:false,total:false,pace:false});
  assert.equal(await p.evaluate(()=>Intervals.selected().content_hash),saved.content_hash);
  assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Interval voice ${size.width}/${size.root} ${theme}: defaults/shared switches/reload/account isolation/draft/hash PASS`);await c.close();
 }
 }finally{
 for(const name of ['zz_test_interval_voice','zz_test_interval_other']){await signin(admin,name);await admin.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}await admin.close();await b.close();
 }
})().catch(e=>{console.error(e);process.exit(1);});
