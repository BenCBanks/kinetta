// Fictional disposable accounts; actual setting handlers and validation, no provider calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  assert((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}})).ok());
  if(mode==='bridge'){const r=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:true}}),{token}=await r.json();await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));let fault='',writes=0,reads=0,phoneWrites=0,releaseWrite;
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
   if(u.pathname==='/api/card/new'&&q.method()==='POST'&&fault==='rotate-rejected'){writes++;return r.fulfill({status:400,json:{detail:'Fictional link change rejected'}});}
   if(u.pathname==='/api/card'&&q.method()==='PUT'&&fault==='card-rejected'){writes++;await new Promise(resolve=>releaseWrite=resolve);return r.fulfill({status:400,json:{detail:'Fictional card choice rejected'}});}
if(u.pathname==='/api/contacts/settings'&&q.method()==='PUT')phoneWrites++;if(u.pathname==='/api/sharing'){
   if(q.method()==='GET')reads++;
   if(q.method()==='PUT'){writes++;if(fault==='held-lost'){await r.fetch();await new Promise(resolve=>releaseWrite=resolve);return r.abort();}if(fault==='lost'){await r.fetch();return r.abort();}if(fault==='rejected')return r.fulfill({status:400,json:{detail:'Fictional rejected choice'}});if(fault==='mismatch')return r.fulfill({json:{ok:true}});if(fault==='503')return r.fulfill({status:503,json:{detail:'Fictional outage'}});if(fault==='offline')return r.abort();}
  }return r.continue();});
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`stable-${mode}-${theme}-${name}.png`)});}};
  const geometry=()=>p.evaluate(()=>({height:document.documentElement.scrollHeight,scroll:scrollY,rows:[...document.querySelectorAll('#sh-body h2,[data-vis],#sh-contact-phone')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})}));
  try{
   await p.goto(base+'/me/sharing');await p.locator('[data-vis]').first().waitFor();await p.evaluate(()=>document.fonts.ready);
   const current=await p.locator('[data-vis][aria-checked=true]').getAttribute('data-vis'),pick=current==='everyone'?'friends':'everyone';
   const phone=p.locator('[name=phone_e164]');await phone.fill('+1 555 010 4242');
   const button=p.locator(`[data-vis=${pick}]`);await button.scrollIntoViewIfNeeded();await button.focus();const before=await geometry();await shot('before');
   fault='held-lost';await button.click();await p.locator('[data-sharing-state=checking]').waitFor();
   for(let i=0;i<100&&!releaseWrite;i++)await p.waitForTimeout(20);assert(releaseWrite);
   const sibling=p.locator('#sh-d input').first(),savedSibling=await sibling.isChecked();
   const blockedInteractions=async()=>{
    assert.equal(await sibling.getAttribute('aria-disabled'),'true');assert.equal(await phone.getAttribute('aria-disabled'),'true');assert.equal(await p.locator('#sh-phone-save').getAttribute('aria-disabled'),'true');
    assert(await sibling.evaluate(n=>n.classList.contains('setting-locked')),'sibling lock is visible');
    await p.evaluate(()=>{document.querySelector('#sh-d input').click();document.querySelector('#sh-contact-phone').requestSubmit();});
    assert.equal(await sibling.isChecked(),savedSibling,'a blocked switch cannot display an unsaved value');assert.equal(writes,1);assert.equal(phoneWrites,0,'blocked phone submission sends nothing');assert.equal(await phone.inputValue(),'+1 555 010 4242');
   };
   await blockedInteractions();assert(await button.evaluate(n=>n===document.activeElement),'sibling attempts retain focus');await shot('pending');releaseWrite();releaseWrite=null;await p.locator('[data-sharing-state=unknown]').waitFor();await blockedInteractions();
   assert.deepEqual(await geometry(),before,'lost reply keeps all rows, height and scroll fixed');assert.equal(await button.evaluate(n=>n===document.activeElement),true,'focus remains on submitted control');
   assert.equal(await phone.inputValue(),'+1 555 010 4242','unrelated save preserves unsent phone draft');assert.equal(await phone.getAttribute('aria-disabled'),'true','phone draft stays visibly locked until readback');
   assert.equal(await button.getAttribute('aria-checked'),'mixed','unknown value has no selected private claim');assert.match(await p.locator('[data-sharing-state=unknown]').innerText(),/Sharing not confirmed/);await shot('unknown');
   assert(await p.locator('.setting-recovery').evaluate(note=>{const r=note.getBoundingClientRect();return [...note.parentElement.querySelectorAll('input,select,button')].filter(n=>!note.contains(n)).every(n=>{const b=n.getBoundingClientRect();return b.bottom<=r.top||b.top>=r.bottom||b.right<=r.left||b.left>=r.right;});}),'recovery has its own space and covers no control, including Calories');
   const beforeRead=reads;await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=checking]').waitFor();assert.equal(reads,beforeRead,'early retry never reads before the bound');await shot('checking');
   await require('./privacy_recovery_fixture.cjs')(p);await p.locator(`[data-vis=${pick}][aria-checked=true]`).waitFor();await p.locator('[data-sharing-state=confirmed]').waitFor({state:'attached'});assert.equal(writes,1,'automatic recovery is GET-only');assert(await button.evaluate(n=>n===document.activeElement),'Retry returns focus to the original setting');assert.equal(reads,beforeRead+1,'one automatic read after the deadline');assert.equal(await phone.inputValue(),'+1 555 010 4242');await shot('confirmed');assert.equal(await phone.getAttribute('aria-disabled'),null);assert.equal(await sibling.getAttribute('aria-disabled'),null);
   fault='';const other=p.locator(`[data-vis=${current}]`);await other.focus();const normal=await geometry();await other.click();await p.locator(`[data-vis=${current}][aria-checked=true]`).waitFor();assert.deepEqual(await geometry(),normal,'successful save keeps layout/scroll');assert(await other.evaluate(n=>n===document.activeElement),'successful save keeps focus');
   await phone.fill('not-a-number');await p.locator('#sh-phone-save').click();await p.locator('[data-sharing-state=unknown]').waitFor();assert.equal(await phone.inputValue(),'not-a-number');assert.equal(await p.locator('#sh-contact-status').innerText(),'Enter a phone number with a country code.','actual validation is shown');await shot('phone-error');
   await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=confirmed]').waitFor({state:'attached'});assert.equal(await phone.inputValue(),'not-a-number','readback after failed phone submit retains draft');assert.match(await p.locator('[data-sharing-state=confirmed]').innerText(),/Not saved.*Enter a phone number with a country code/,'Retry retains the real validation failure');assert.equal(await p.locator('#sh-contact-status').innerText(),'Enter a phone number with a country code.');
   for(fault of ['503','offline']){await other.click();await p.locator('[data-sharing-state=unknown]').waitFor();assert(await other.isVisible());assert.equal(await phone.inputValue(),'not-a-number');await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator(`[data-vis=${current}][aria-checked=true]`).waitFor();}
   for(fault of ['rejected','mismatch']){
    const attempted=p.locator(`[data-vis=${pick}]`),count=writes;await attempted.focus();await attempted.click();
    if(fault==='rejected'){await p.locator('[data-sharing-state=unknown]').waitFor();await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();}
    const note=p.locator('[data-sharing-state=confirmed]');await note.waitFor({state:'visible'});
    assert.match(await note.innerText(),/Not saved\. You chose/);assert.equal(await p.locator(`[data-vis=${current}]`).getAttribute('aria-checked'),'true','only the saved audience is selected');assert.equal(writes,count+1);assert(await attempted.evaluate(n=>n===document.activeElement),'rejected Retry restores the setting focus');await shot('rejected-'+fault);
   }
   fault='';await p.goto(base+'/me');await p.waitForFunction(()=>App.pageReady);await p.evaluate(()=>KinettaCard.open());
   const photo=p.locator('#card-photo');await photo.waitFor();await p.waitForFunction(()=>document.querySelector('#card-picture')?.naturalWidth>0);
   const savedPhoto=await photo.isChecked();fault='card-rejected';const count=writes;await photo.focus();await photo.click();await p.locator('[data-sharing-state=checking]').waitFor();
   for(let i=0;i<100&&!releaseWrite;i++)await p.waitForTimeout(20);assert(releaseWrite);assert(await photo.evaluate(n=>n===document.activeElement&&!n.disabled),'card lock retains focused input before the response');await shot('card-pending');releaseWrite();releaseWrite=null;
   await p.locator('[data-sharing-state=unknown]').waitFor();assert(await photo.evaluate(n=>n===document.activeElement&&!n.disabled),'uncertain card input keeps focus');await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();
   const cardStatus=p.locator('[data-sharing-state=confirmed]');await cardStatus.waitFor({state:'visible'});assert.match(await cardStatus.innerText(),/Not saved.*Fictional card choice rejected/);assert.equal(await photo.isChecked(),savedPhoto);assert(await photo.evaluate(n=>n===document.activeElement),'card Retry returns focus to the input');assert.equal(writes,count+1);await shot('card-rejected');fault='rotate-rejected';await p.locator('#card-new').click();await p.locator('#card-rotate').waitFor();await p.locator('#card-rotate').focus();await p.locator('#card-rotate').click();await p.locator('[data-sharing-state=unknown]').waitFor();await require('./privacy_recovery_fixture.cjs')(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=confirmed]').waitFor({state:'visible'});assert.match(await p.locator('[data-sharing-state=confirmed]').innerText(),/Not saved.*Fictional link change rejected/);assert(await p.locator('#card-rotate').isVisible(),'a rejected new-link request stays open with its failure');assert(await p.locator('#card-rotate').evaluate(n=>n===document.activeElement),'link Retry restores focus');fault='';await p.goto(base+'/me/sharing');await p.locator('[data-vis]').first().waitFor();
   for(const phase of ['paint','after'])assert(await p.evaluate(async({phase,current})=>{
    const root=document.createElement('section');root.style.cssText='position:fixed;top:50px;left:22px;z-index:9999';document.body.append(root);
    const draw=()=>{root.innerHTML='<button id="stable-repaint-control" type="button">Saved setting</button>';SocialData.confirmSetting(root,{path:'/api/sharing',paint:()=>{}});};
    root.innerHTML='<button id="stable-repaint-control" type="button">Saved setting</button>';
    const saved=SocialData.confirmSetting(root,{read:async()=>({default:current}),paint:()=>{if(phase==='paint')draw();},after:()=>{if(phase==='after')draw();}});
    const input=root.querySelector('#stable-repaint-control');input.focus({preventScroll:true});const top=scrollY;
    await saved.save('/api/sharing',json('PUT',{default:current}));const result=document.activeElement?.id==='stable-repaint-control'&&scrollY===top;root.remove();return result;
   },{phase,current}),phase+' replacement preserves the equivalent focused control and scroll');
   assert.deepEqual(errors,[]);console.log('Stable privacy',mode,theme,'PASS: rows/scroll/focus; surface lock without dropped changes; reserved status; automatic GET Retry; phone draft/400; offline/503');
  }finally{releaseWrite?.();await c.close();}
 }
};
