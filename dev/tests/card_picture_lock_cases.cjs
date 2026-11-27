'use strict';
// Real card handlers; fictional card/settings/image responses, no provider or device.
const assert=require('node:assert/strict');
module.exports=async(browser,base)=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  let releasePicture;
  try{
   const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}});assert(login.ok());
   const {token}=await login.json();
   if(mode==='bridge'){await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
   const response=await c.request.get(base+'/api/card',{headers:token?{Authorization:'Bearer '+token}:{}});assert(response.ok());
   let card=await response.json(),sharing={share_achievements:true},writes=[],signalPicture=()=>{};
   card={...card,enabled:true};const p=await c.newPage(),errors=[];p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/card/image.png'){await new Promise(resolve=>{releasePicture=resolve;signalPicture();});return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64')});}
    if(u.pathname==='/api/card'){if(q.method()==='PUT'){writes.push(u.pathname);card={...card,...q.postDataJSON()};}return r.fulfill({json:card});}
    if(u.pathname==='/api/sharing'){if(q.method()==='PUT'){writes.push(u.pathname);sharing={...sharing,...q.postDataJSON()};}return r.fulfill({json:sharing});}
    if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();
   });
   const nextPicture=()=>{let timer;return Promise.race([new Promise(resolve=>signalPicture=()=>{clearTimeout(timer);resolve();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Card picture request did not arrive')),10000);})]);};
   const ready=async()=>{releasePicture();releasePicture=null;await p.waitForFunction(()=>{const n=document.querySelector('#card-photo');return n&&!n.hasAttribute('aria-disabled')&&document.querySelector('#card-picture')?.naturalWidth>0;});};
   const locked=async label=>{
    const photo=p.locator('#card-photo');await photo.focus();
    const before=await p.locator('.sheet input').evaluateAll(ns=>ns.map(n=>[n.id||n.value,n.checked]));
    assert(await p.locator('.sheet input').evaluateAll(ns=>ns.every(n=>n.getAttribute('aria-disabled')==='true'&&n.classList.contains('setting-locked')&&!n.disabled)),label+' visibly locks every choice without removing focus');
    const count=writes.length;
    await p.locator('.sheet input').evaluateAll(ns=>ns.forEach(n=>n.click()));await p.keyboard.press('Space');
    assert.deepEqual(await p.locator('.sheet input').evaluateAll(ns=>ns.map(n=>[n.id||n.value,n.checked])),before,label+' regular and achievement choices cannot change while their writes would be dropped');
    assert.equal(writes.length,count,label+' blocked changes send no write');assert(await photo.evaluate(n=>n===document.activeElement),label+' preserves input focus');
   };
   await p.goto(base+'/me');await p.waitForFunction(()=>App.pageReady);let held=nextPicture();await p.evaluate(()=>KinettaCard.open());await held;await locked('initial picture');await ready();
   for(const [selector,endpoint,key] of [['#card-photo','/api/card','photo'],['#card-achievements','/api/sharing','share_achievements']]){
    const input=p.locator(selector),before=await input.isChecked(),count=writes.length;await input.focus();held=nextPicture();await input.click();await held;
    assert(await input.evaluate(n=>n===document.activeElement&&!n.disabled),'save-to-picture transition keeps focus');await locked(selector+' refreshed picture');await ready();
    assert.equal(writes.length,count+1,'one accepted change produces one write');assert.equal(writes.at(-1),endpoint);assert.equal((key==='photo'?card:sharing)[key],!before);assert.equal(await input.isChecked(),!before,'choice matches the saved value');
   }
   assert.deepEqual(errors,[]);console.log('Card picture lock',mode,theme,'PASS: initial/regular/achievement loads block changes, retain focus, unlock and save once');
  }finally{releasePicture?.();await c.close();}
 }
};
if(require.main===module)(async()=>{const b=await require('playwright').chromium.launch();try{await module.exports(b,process.env.KINETTA_URL||'http://localhost:8798');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
