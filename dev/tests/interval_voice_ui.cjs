// Voice cue preferences on fictional accounts. Native methods are stand-ins; no recording, GPS, or speech is started.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label);}
(async()=>{
 const names=['zz_test_interval_voice','zz_test_interval_other'];
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_interval_voice');person('zz_test_interval_other')"],{cwd:path.join(__dirname,'../..'),env:process.env,stdio:'inherit'});
 const browser=await chromium.launch(),admin=await browser.newContext(),contexts=[];
 const signin=(context,name)=>context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:name,password:pw}});
 try{
  const login=await signin(admin,names[0]);assert.equal(login.status(),200,'fictional test account signs in');
  const me=await(await admin.request.get(base+'/api/me')).json(),state=await admin.storageState(),token=state.cookies.find(c=>/sess|login|token/i.test(c.name))?.value;assert(token,'native stand-in has a test login token');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/interval_presets.json'),'utf8'))[0];
  const definition=JSON.parse(JSON.stringify(fixture.pin.definition));definition.name='Fictional voice settings';
  const presetId=crypto.randomUUID(),mutationId=crypto.randomUUID();
  const created=await admin.request.put(base+'/api/interval-presets/'+presetId,{headers:{Origin:base},data:{mutation_id:mutationId,expected_version:null,definition}});
  assert.equal(created.status(),200,'fixture interval set is created');const saved=await created.json();assert(saved.content_hash,'fixture has a stable preset hash');
  for(const size of [{width:390,height:844,root:16,screenshots:true},{width:330,height:667,root:24,screenshots:false}])for(const theme of ['light','dark']){
   const context=await browser.newContext({storageState:state,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'America/New_York'});contexts.push(context);
   const page=await context.newPage(),errors=[],writes=[],nativeCalls=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
   await context.addInitScript(({base,id,saved,root,token})=>{
    const scope=JSON.stringify([base,id]),trackKey='kinetta.track:'+scope;
    const prefs={server:base,token};
    window.intervalFixtureCalls=[];
    window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='KinettaTrack'||n==='Preferences',Plugins:{
     Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}},
     KinettaTrack:{
      attach:async()=>{intervalFixtureCalls.push({method:'attach'});return{session:null,routePlanSupport:1,lapSupport:1};},
      detach:async()=>{intervalFixtureCalls.push({method:'detach'});return{};},
      status:async()=>{intervalFixtureCalls.push({method:'status'});return{session:null,routePlanSupport:1,lapSupport:1};},
      locate:async()=>{intervalFixtureCalls.push({method:'locate'});return{lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()};},
      intervalCapabilities:async()=>{intervalFixtureCalls.push({method:'intervalCapabilities'});return{intervalCapabilities:{outdoor:true}};},
      start:async args=>{intervalFixtureCalls.push({method:'start',args});throw Error('Fictional recording blocked');},
      intervalTest:async()=>{intervalFixtureCalls.push({method:'intervalTest'});throw Error('Fictional alert test blocked');},
      intervalAlerts:async()=>{intervalFixtureCalls.push({method:'intervalAlerts'});throw Error('Fictional alert change blocked');}
     }
    }};
    localStorage.setItem(trackKey+':voice','false'); // Legacy Spoken updates off; no interval master has been saved yet.
    localStorage.setItem('intervals:'+scope+':selected',JSON.stringify(saved));
    document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
   },{base,id:me.id,saved,root:size.root,token});
   await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(!['GET','HEAD'].includes(request.method())){writes.push(request.method()+' '+url.pathname);return route.fulfill({json:{}});}
    return route.continue();
   });
   const ready=()=>until(page,()=>App.pageReady&&!!document.querySelector('#track-start'),'Track ready');
   const openEditor=async()=>{
    await page.locator('#interval-open').click();await page.waitForSelector('#interval-library');
    const row=page.locator('#interval-library [data-open]').filter({hasText:saved.definition.name}).first();await row.click();
    await page.waitForSelector('[data-edit]');assert.equal(await page.locator('.sheet h2').innerText(),saved.definition.name,'opens the existing saved set');
    await page.locator('[data-edit]').click();await page.waitForSelector('#interval-editor');
    assert.equal(await page.locator('.sheet h2').innerText(),'Edit intervals','existing set uses Edit, not New');
   };
   const switches={
    master:()=>page.locator('#interval-editor [data-interval-master]'),
    total:()=>page.locator('#interval-editor [data-interval-voice=\"total\"]'),
    pace:()=>page.locator('#interval-editor [data-interval-voice=\"pace\"]'),
    children:()=>page.locator('#interval-editor .interval-voice-children')
   };
   const noOverflow=async()=>{
    const sizes=await page.evaluate(()=>({document:document.documentElement.scrollWidth-innerWidth,sheet:document.querySelector('.sheet')?.scrollWidth-document.querySelector('.sheet')?.clientWidth}));
    assert(sizes.document<=1,'no horizontal document overflow: '+JSON.stringify(sizes));assert(sizes.sheet<=1,'no horizontal sheet overflow: '+JSON.stringify(sizes));
   };
   const checkRows=async()=>{
    const rows=await page.locator('#interval-editor .interval-voice-controls .switch-row:visible').evaluateAll(nodes=>nodes.map(row=>{
     const r=row.getBoundingClientRect(),input=row.querySelector('input[type=checkbox]'),s=input.getBoundingClientRect();
     return{height:r.height,display:getComputedStyle(row).display,centerDelta:Math.abs((r.top+r.bottom-s.top-s.bottom)/2),rightGap:r.right-s.right};
    }));
    const order=await page.locator('#interval-editor').evaluate(el=>{const c=[...el.children];return{extras:c.findIndex(n=>n.classList.contains('interval-extras')),cues:c.findIndex(n=>n.classList.contains('interval-voice-controls')),name:c.findIndex(n=>n.classList.contains('interval-name'))};});
    assert(order.extras>=0&&order.extras<order.cues&&order.cues<order.name,'Voice cues are the last option block before the name and save area: '+JSON.stringify(order));
    assert(rows.length>=1,'master switch row exists');for(const row of rows){assert(Math.abs(row.height-44)<=1,'switch row is 44px high: '+JSON.stringify(row));assert.equal(row.display,'flex','label and switch form one aligned row');assert(row.centerDelta<=2,'switch is vertically centered in its row: '+JSON.stringify(row));assert(row.rightGap>=-1&&row.rightGap<=2,'switch is aligned at the row end: '+JSON.stringify(row));}
   };
   const snap=async name=>{
    if(!out||!size.screenshots)return;fs.mkdirSync(out,{recursive:true});await page.waitForTimeout(100);
    await page.screenshot({path:path.join(out,'interval-'+name+'-390-'+theme+'.png'),animations:'disabled'});
   };
   await page.goto(base+'/track');await ready();
   const trackKey='kinetta.track:'+JSON.stringify([base,me.id]);
   assert.equal(await page.evaluate(k=>localStorage.getItem(k+':interval-voice'),trackKey),null,'legacy interval master starts unset');
   await openEditor();
   assert.equal(await page.evaluate(()=>Intervals.voicePreferences().voice),false,'legacy Spoken updates setting is off');
   assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k+':interval-voice')),trackKey),false,'legacy master is seeded from Spoken updates');
   assert.equal(await page.getByRole('switch',{name:'Voice cues'}).isChecked(),false,'legacy off state is clear');
   assert(await switches.children().isHidden(),'off master collapses child settings');
   assert(await switches.total().isChecked());assert(await switches.pace().isChecked(),'child defaults remain on while hidden');
   assert.equal(await page.locator('#interval-editor [data-interval-voice]').evaluateAll(nodes=>nodes.every(n=>n.tagName==='INPUT'&&n.type==='checkbox')) ,true,'children are switches, not chips');
   await noOverflow();await checkRows();await snap('master-off-collapsed');

   await page.getByRole('switch',{name:'Voice cues'}).check();
   assert(await switches.children().isVisible(),'master reveals child switches');assert(await page.getByRole('switch',{name:'Say total time'}).isChecked());assert(await page.getByRole('switch',{name:'Say average pace'}).isChecked());
   await noOverflow();await checkRows();await snap('master-on-both');
   await page.getByRole('switch',{name:'Say average pace'}).uncheck();
   assert(await page.getByRole('switch',{name:'Voice cues'}).isChecked());assert(await page.getByRole('switch',{name:'Say total time'}).isChecked());assert.equal(await page.getByRole('switch',{name:'Say average pace'}).isChecked(),false);
   await noOverflow();await checkRows();await snap('pace-off');
   await page.getByRole('switch',{name:'Voice cues'}).uncheck();assert(await switches.children().isHidden(),'master off collapses without deleting child choices');
   assert.equal(await switches.pace().isChecked(),false,'hidden pace choice is preserved');await snap('master-off-collapsed-after-change');
   await page.getByRole('switch',{name:'Voice cues'}).check();assert(await switches.children().isVisible());assert.equal(await switches.pace().isChecked(),false,'reopening restores the saved pace choice');
   assert.equal(await page.evaluate(()=>Intervals.selected().content_hash),saved.content_hash,'editing cue preferences does not change the selected preset hash');

   const bridged=await page.evaluate(async()=>Intervals.startOptions({sport:'run',gps:true}));
   assert.equal(await page.evaluate(()=>Intervals.voicePreferences().voice),false,'split announcements remain off');
   assert.equal(bridged.intervalVoice,true,'interval voice is sent on independently of split announcements');
   assert.equal(bridged.intervalSayTotal,true);assert.equal(bridged.intervalSayPace,false);
   assert.equal(bridged.intervals.content_hash,saved.content_hash,'start options keep the checked preset content');
   await page.keyboard.press('Escape');await page.waitForSelector('.sheet',{state:'detached'});
   await page.reload();await ready();await openEditor();
   assert(await page.getByRole('switch',{name:'Voice cues'}).isChecked(),'master survives reload');
   assert(await page.getByRole('switch',{name:'Say total time'}).isChecked(),'total choice survives reload');
   assert.equal(await page.getByRole('switch',{name:'Say average pace'}).isChecked(),false,'pace choice survives reload');
   await noOverflow();await checkRows();await snap('existing-set-edit');
   await page.keyboard.press('Escape');await page.waitForSelector('.sheet',{state:'detached'});
   await page.locator('#interval-open').click();await page.waitForSelector('#interval-library');await page.locator('#interval-library [data-new]').click();await page.waitForSelector('#interval-editor');
   assert.equal(await page.locator('.sheet h2').innerText(),'New intervals','new builder also has the Voice cues block');
   assert(await page.getByRole('switch',{name:'Voice cues'}).isChecked(),'new builder uses the saved independent master');
   assert(await page.getByRole('switch',{name:'Say total time'}).isChecked());assert.equal(await page.getByRole('switch',{name:'Say average pace'}).isChecked(),false,'new builder uses saved child choices');
   await noOverflow();await checkRows();await snap('new-set-create');
   const isolation=await page.evaluate(otherId=>{
    const current=App.me,mine=Intervals.voicePreferences();App.me={...current,id:otherId};const other=Intervals.voicePreferences();App.me=current;
    return{mine,other,restored:Intervals.voicePreferences()};
   },me.id+100000000);
   assert.deepEqual(isolation.mine,{voice:false,intervalVoice:true,total:true,pace:false});
   assert.deepEqual(isolation.other,{voice:true,intervalVoice:true,total:true,pace:true},'another account sees independent defaults');
   assert.deepEqual(isolation.restored,isolation.mine,'returning to the original account restores its preferences');
   assert.deepEqual(await page.evaluate(()=>Intervals.selected().content_hash),saved.content_hash);
   nativeCalls.push(...await page.evaluate(()=>intervalFixtureCalls));
   assert(!nativeCalls.some(call=>['start','intervalTest','intervalAlerts'].includes(call.method)),'test never starts recording or native alerts');
   assert.deepEqual(writes.filter(write=>!write.endsWith(' /api/challenges/signup/continue')),[],'UI makes no preset, activity, Health, provider, or unrelated writes: '+JSON.stringify(writes));
   assert.deepEqual(errors,[],'no browser errors');
   const currentPresets=await(await admin.request.get(base+'/api/interval-presets')).json(),current=currentPresets.find(item=>item.id===saved.id);
   assert(current,'existing preset remains in the library');assert.equal(current.content_hash,saved.content_hash,'UI preferences never mutate the server preset');
   console.log('Interval Voice cues '+size.width+'/'+size.root+' '+theme+': defaults, switches, edit, persistence, bridge, isolation and no-write checks PASS');
   await context.close();contexts.splice(contexts.indexOf(context),1);
  }
 }finally{
  for(const context of contexts)await context.close().catch(()=>{});
  for(const name of names){const c=await browser.newContext();try{const response=await signin(c,name);if(response.ok())await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}
  await admin.close();await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1);});
