// Real client handlers with a fictional persisted server model; no providers or devices.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const specs=[
  {name:'welcome',route:'/welcome?step=audience',write:'/api/sharing',read:'/api/sharing',target:'#wc-aud',
   change:async p=>{await p.locator('[name=aud][value=me]').check();await p.locator('#wc-next').click();},
   check:async(p,s)=>{if(new URL(p.url()).searchParams.get('step')==='audience')assert(await p.locator('[name=aud][value='+s.default+']').isChecked());else assert.equal(new URL(p.url()).searchParams.get('step'),'phone');}},
  {name:'kit',route:'/me/settings',write:'/api/profile',read:'/api/me',control:'[data-ai="0"]',target:'.seg[aria-label="AI features"]',
   ready:async p=>{await p.locator('#m-kit').click();await p.locator('[data-ai="0"]').waitFor();},
   check:async(p,s)=>assert.equal(await p.locator('[data-ai="0"]').getAttribute('aria-pressed'),String(!s.ai_ok))},
  {name:'garmin',route:'/me/settings/connections',write:'/api/profile',read:'/api/me',control:'#gc-ai',target:'#gc-ai',
   ready:async p=>{await p.locator('#gc-manage').click();await p.locator('#gc-ai').waitFor();},check:async(p,s)=>assert.equal(await p.locator('#gc-ai').isChecked(),s.garmin_ai_ok)},
  {name:'health',route:'/me/settings/connections',write:'/api/profile',read:'/api/me',control:'[data-health-kit-consent]',target:'[data-health-kit-consent]',
   ready:async p=>{await p.locator('#gc-manage').waitFor();return p.evaluate(()=>{const box=document.querySelector('#page');box.innerHTML='<h1>Apple Health</h1><label class="inset-row switch-row"><span>Let Kit use my health data</span><input type="checkbox" data-health-kit-consent checked></label>';bindHealthKitConsent(box,()=>box.isConnected);});},
   check:async(p,s)=>assert.equal(await p.locator('[data-health-kit-consent]').isChecked(),s.health_ai_ok)},
  {name:'memory',route:'/me',write:'/api/coach/conversation/memory',read:'/api/coach/conversation/memory',target:'#kit-memory-on',
   ready:async p=>{await p.evaluate(async()=>{await loadClassicScript(KIT_ROUTE_ASSET);KitChat.memorySettings();});await p.locator('#kit-memory-on').waitFor();},
   change:async p=>{await p.locator('#kit-memory-on').uncheck();await p.getByRole('button',{name:'Turn off',exact:true}).click();},
   check:async(p,s)=>{assert.equal(await p.locator('#kit-memory-on').isChecked(),s.enabled);assert.equal(await p.locator('.kit-memory-row').count(),s.memories.length);}},
  {name:'leaderboards',route:'/me/sharing',write:'/api/segment-settings',read:'/api/segment-settings',control:'#lj',target:'#lj',
   ready:async p=>{await p.locator('#sh-trim-open').waitFor();await p.evaluate(()=>{const box=document.createElement('section');document.querySelector('#page').append(box);Segments.settingsRow(box);});await p.locator('#sg-set').click();await p.locator('#lj').waitFor();},check:async(p,s)=>assert.equal(await p.locator('#lj').isChecked(),s.joined)},
  {name:'exclusion',route:'/me/sharing',write:'/api/activities/777/leaderboards',read:'/api/activities/777/segment-efforts',control:'#sa-ex',target:'#sa-ex',
   ready:async p=>{await p.locator('#sh-trim-open').waitFor();return p.evaluate(async()=>{const box=document.createElement('section');document.querySelector('#page').append(box);await Segments.activityCard(box,777);});},
   change:async p=>p.locator('#sa-ex').click(),check:async(p,s)=>assert.equal(await p.locator('#sa-ex').isChecked(),s.excluded)},
  {name:'kit-enable',route:'/me/settings',write:'/api/profile',read:'/api/me',target:'#ai-yes',initial:{ai_ok:false},
   ready:async p=>p.evaluate(()=>aiSheet()),change:async p=>{await p.locator('[name=ai_adult]').check();await p.locator('#ai-yes').click();},
   check:async(p,s)=>assert.equal(await p.evaluate(()=>App.me.ai_ok),s.ai_ok)},
  {name:'pin-menu',route:'/me/achievements#overall',write:'/api/achievements/showcase/pin',read:'/api/achievements/showcase',target:'[data-showcase-pin-action]',
   ready:async p=>{const anchor=p.locator('[data-achievement-pin-target="true"][data-achievement-code=workouts]').first();await anchor.waitFor();await anchor.dispatchEvent('contextmenu');await p.locator('[data-showcase-pin-action]').waitFor();},
   change:async p=>p.locator('[data-showcase-pin-action]').click(),check:async(p,s)=>assert.equal(await p.locator('[data-achievement-pin-target="true"][data-achievement-code=workouts]').first().getAttribute('data-showcase-pinned'),String(s.pinned.includes('workouts')))},
  {name:'featured',route:'/me?edit=profile',write:'/api/achievements/showcase/pins',read:'/api/achievements/showcase',target:'[data-featured-list]',
   change:async p=>{await p.locator('[data-featured-toggle=workouts]').click();await p.locator('[data-card-save]').click();},
   check:async(p,s)=>{const toggle=p.locator('[data-featured-toggle=workouts]');if(await toggle.count())assert.equal(await toggle.getAttribute('aria-pressed'),String(s.pinned.includes('workouts')));}},
  {name:'profile',route:'/me?edit=profile',write:'/api/account',read:'/api/me',target:'[data-card-sections]',
   change:async p=>{await p.locator('[data-show=sports]').uncheck();await p.locator('[data-card-save]').click();},
   check:async(p,s)=>{if(await p.locator('[data-show=sports]').count())assert.equal(await p.locator('[data-show=sports]').isChecked(),s.profile_layout.sections.includes('sports'));}}
 ];
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block'});
  const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}});assert(login.ok());
  if(mode==='bridge'){const {token}=await login.json();await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  let spec=null,state={},armed=false,unreadable=false,fault='',writes=0;
  await c.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),method=q.method();if(u.origin!==base)return r.abort();
   if(armed&&method==='GET'&&u.pathname===spec.read&&unreadable)return fault==='offline'?r.abort():r.fulfill({status:503,json:{detail:'Fictional outage'}});
   if(armed&&method!=='GET'&&u.pathname===spec.write){writes++;if(fault.startsWith('lost')){const body=q.postDataJSON();if(spec.name==='pin-menu')state.pinned=body.pinned?[...state.pinned,body.code]:state.pinned.filter(code=>code!==body.code);else Object.assign(state,body);if(body.enabled===false)state.memories=[];return r.abort();}return fault==='offline'?r.abort():r.fulfill({status:503,json:{detail:'Fictional outage'}});}
   if(u.pathname==='/api/me'){const reply=await r.fetch();return r.fulfill({response:reply,json:{...await reply.json(),...state,created:'2026-01-01T12:00:00Z',coach:true,ai_paused:false}});}
   if(u.pathname==='/api/sharing')return r.fulfill({json:{default:state.default,details:{},trim_m:400,trims:[0,400]}});
   if(u.pathname==='/api/activities/777/segment-efforts')return r.fulfill({json:{efforts:[],excluded:state.excluded,assistance:'unassisted',assistance_revision:1}});
   if(u.pathname==='/api/segment-settings')return r.fulfill({json:{joined:state.joined}});
   if(u.pathname==='/api/coach/conversation/memory')return r.fulfill({json:{enabled:state.enabled,version:4,memories:state.memories}});
   if(u.pathname==='/api/achievements/showcase')return r.fulfill({json:{pinned:state.pinned,available:[{code:'workouts'}]}});
   if(u.pathname==='/api/achievements')return r.fulfill({json:{tracks:[{code:'workouts',label:'Workouts',value:10,tiers:[{rank:1,day:'2026-11-25'}]}],pending:false}});
   if(u.pathname==='/api/connections')return r.fulfill({json:{garmin_connect_available:true,garmin_connect:{last_sync:null,status:'connected'}}});
   if(method!=='GET')return r.fulfill({json:{}});return r.continue();
  });
  try{for(const item of specs){if(process.env.CONSENT_ONLY&&item.name!==process.env.CONSENT_ONLY)continue;for(fault of ['lost','503','offline',...(['garmin','health','leaderboards'].includes(item.name)?['lost-on']:[])]){
   spec=item;armed=false;unreadable=false;writes=0;state={default:'everyone',ai_ok:true,garmin_ai_ok:true,health_ai_ok:true,health_weight_ai_ok:true,enabled:true,joined:true,
    excluded:false,pinned:['workouts'],memories:[{id:1,text:'I prefer morning walks.',kind:'routine',updated:'2026-11-25'}],profile_layout:{sections:['totals','sports','activities'],stats:['activities','distance','time'],sports:[]},...spec.initial};if(fault==='lost-on')Object.assign(state,{garmin_ai_ok:false,health_ai_ok:false,health_weight_ai_ok:false,joined:false});
   await p.goto(base+spec.route);await p.locator('nav.tabs').waitFor();if(spec.ready)await spec.ready(p);await p.locator(spec.target).waitFor();await wait(200);
   if(out&&mode==='web'&&fault==='offline'){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${spec.name}-${theme}-before.png`)});}
   armed=true;unreadable=!fault.startsWith('lost');
   if(spec.change)await spec.change(p);else if(spec.name==='kit')await p.locator(spec.control).click();else await p.locator(spec.control).click();
   for(let n=0;n<100&&writes===0;n++)await wait(20);assert.equal(writes,1,spec.name+' write');await wait(300);
   {const note=p.locator('[data-sharing-state=unknown]').last();await note.waitFor();assert.match(await note.innerText(),/Not confirmed.*Retry/);assert(!await p.locator(spec.target).isVisible(),spec.name+' hides stale consent');
    if(out&&mode==='web')await p.screenshot({path:path.join(out,`${spec.name}-${theme}-unknown.png`)});
    unreadable=false;await require('./privacy_recovery_fixture.cjs')(p);await note.getByRole('button',{name:'Retry',exact:true}).click();await wait(250);assert.equal(writes,1,'Retry never repeats the write');}
   await spec.check(p,state);if(await p.locator(spec.target).count())assert(await p.locator(spec.target).evaluate(node=>{for(let p=node.parentElement;p;p=p.parentElement){const note=p.querySelector(':scope > [data-sharing-state]');if(note)return note.dataset.sharingState==='confirmed';}return true;}),spec.name+' affected control reconciled; other controls remain masked until their own readback');
   if(out&&mode==='web'&&fault==='offline')await p.screenshot({path:path.join(out,`${spec.name}-${theme}-confirmed.png`)});
   console.log('Consent readback',mode,theme,spec.name,fault,'PASS');
  }}assert.deepEqual(errors,[]);}finally{await c.close();}
 }
};
