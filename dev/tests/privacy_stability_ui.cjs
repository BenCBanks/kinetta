// Fictional disposable accounts; actual setting handlers and validation, no provider calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  assert((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}})).ok());
  if(mode==='bridge'){const r=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:true}}),{token}=await r.json();await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));let fault='',writes=0,reads=0;
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/sharing'){
   if(q.method()==='GET')reads++;
   if(q.method()==='PUT'){writes++;if(fault==='lost'){await r.fetch();return r.abort();}if(fault==='503')return r.fulfill({status:503,json:{detail:'Fictional outage'}});if(fault==='offline')return r.abort();}
  }return r.continue();});
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`stable-${mode}-${theme}-${name}.png`)});}};
  const geometry=()=>p.evaluate(()=>({height:document.documentElement.scrollHeight,scroll:scrollY,rows:[...document.querySelectorAll('#sh-body h2,[data-vis],#sh-contact-phone')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})}));
  try{
   await p.goto(base+'/me/sharing');await p.locator('[data-vis]').first().waitFor();await p.evaluate(()=>document.fonts.ready);
   const current=await p.locator('[data-vis][aria-checked=true]').getAttribute('data-vis'),pick=current==='everyone'?'friends':'everyone';
   const phone=p.locator('[name=phone_e164]');await phone.fill('+1 555 010 4242');
   const button=p.locator(`[data-vis=${pick}]`);await button.scrollIntoViewIfNeeded();await button.focus();const before=await geometry();await shot('before');
   fault='lost';await button.click();await p.locator('[data-sharing-state=unknown]').waitFor();
   assert.deepEqual(await geometry(),before,'lost reply keeps all rows, height and scroll fixed');assert.equal(await button.evaluate(n=>n===document.activeElement),true,'focus remains on submitted control');
   assert.equal(await phone.inputValue(),'+1 555 010 4242','unrelated save preserves unsent phone draft');assert.equal(await phone.getAttribute('aria-disabled'),null,'unrelated phone field stays editable');
   assert.equal(await button.getAttribute('aria-checked'),'mixed','unknown value has no selected private claim');assert.match(await p.locator('[data-sharing-state=unknown]').innerText(),/Sharing not confirmed/);await shot('unknown');
   const beforeRead=reads;await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=checking]').waitFor();assert.equal(reads,beforeRead,'early retry never reads before the bound');await shot('checking');
   await require('./privacy_recovery_fixture.cjs')(p);await p.locator(`[data-vis=${pick}][aria-checked=true]`).waitFor();assert.equal(writes,1,'automatic recovery is GET-only');assert.equal(reads,beforeRead+1,'one automatic read after the deadline');assert.equal(await phone.inputValue(),'+1 555 010 4242');await shot('confirmed');
   fault='';const other=p.locator(`[data-vis=${current}]`);await other.focus();const normal=await geometry();await other.click();await p.locator(`[data-vis=${current}][aria-checked=true]`).waitFor();assert.deepEqual(await geometry(),normal,'successful save keeps layout/scroll');assert(await other.evaluate(n=>n===document.activeElement),'successful save keeps focus');
   await phone.fill('not-a-number');await p.locator('#sh-phone-save').click();await p.locator('[data-sharing-state=unknown]').waitFor();assert.equal(await phone.inputValue(),'not-a-number');assert.equal(await p.locator('#sh-contact-status').innerText(),'Enter a phone number with a country code.','actual validation is shown');await shot('phone-error');
   await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=confirmed]').waitFor({state:'attached'});assert.equal(await phone.inputValue(),'not-a-number','readback after failed phone submit retains draft');
   for(fault of ['503','offline']){await other.click();await p.locator('[data-sharing-state=unknown]').waitFor();assert(await other.isVisible());assert.equal(await phone.inputValue(),'not-a-number');await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator(`[data-vis=${current}][aria-checked=true]`).waitFor();}
   fault='';
   for(const phase of ['paint','after'])assert(await p.evaluate(async({phase,current})=>{
    const root=document.createElement('section');document.querySelector('#page').append(root);
    const draw=()=>{root.innerHTML='<button id="stable-repaint-control" type="button">Saved setting</button>';SocialData.confirmSetting(root,{path:'/api/sharing',paint:()=>{}});};
    root.innerHTML='<button id="stable-repaint-control" type="button">Saved setting</button>';
    const saved=SocialData.confirmSetting(root,{read:async()=>({default:current}),paint:()=>{if(phase==='paint')draw();},after:()=>{if(phase==='after')draw();}});
    const input=root.querySelector('button');input.focus({preventScroll:true});const top=scrollY;
    await saved.save('/api/sharing',json('PUT',{default:current}));const result=document.activeElement?.id==='stable-repaint-control'&&scrollY===top;root.remove();return result;
   },{phase,current}),phase+' replacement preserves the equivalent focused control and scroll');
   assert.deepEqual(errors,[]);console.log('Stable privacy',mode,theme,'PASS: rows/scroll/focus; affected-only lock; automatic GET Retry; phone draft/400; offline/503');
  }finally{await c.close();}
 }
};
