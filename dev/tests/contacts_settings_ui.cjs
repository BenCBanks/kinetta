"use strict";
// Sharing & privacy controls against the disposable demo app. All fixture data is fictional and API writes are intercepted.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const base=(process.env.KINETTA_URL||'http://localhost:8798').replace(/\/$/,''),out=process.env.KINETTA_CONTACTS_OUT||'';
const pw='blue kettle morning run';

async function runTheme(browser,theme){
  let state={phone_e164:null,email_ready:true,find_by_email:true,find_by_phone:true},shareAchievements=false,shareWrites=[],sharingState={default:'everyone',findable:true,trim_m:400,trims:[0,200,400,800]},blocked=[{login:'zz_test_blocked',name:'Riley Sample',photo:null}];
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'UTC'});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/sharing'){
      if(request.method()==='GET'){const response=await route.fetch(),data=await response.json();return route.fulfill({response,json:{...data,...sharingState,share_achievements:shareAchievements}});}
      if(request.method()==='PUT'){const body=request.postDataJSON();shareWrites.push(body);if(typeof body.share_achievements==='boolean')shareAchievements=body.share_achievements;sharingState={...sharingState,...body};return route.fulfill({json:{ok:true}});}
    }
    if(url.pathname==='/api/contacts/settings'){
      if(request.method()==='GET')return route.fulfill({json:state});
      if(request.method()==='PUT'){
        const body=request.postDataJSON();
        if(Object.hasOwn(body,'phone_e164'))body.phone_e164=body.phone_e164?.replace(/[\s().-]/g,'')||null;
        state={...state,...body};
        return route.fulfill({json:state});
      }
    }
    if(url.pathname==='/api/blocks'&&request.method()==='GET')return route.fulfill({json:blocked});
    if(url.pathname==='/api/account/devices'&&request.method()==='GET')return route.fulfill({json:[]});
    if(url.pathname==='/api/people/zz_test_blocked/block'&&request.method()==='DELETE'){blocked=[];return route.fulfill({json:{ok:true}});}
    if(!['GET','HEAD','POST'].includes(request.method())&&url.pathname!=='/api/login')return route.fulfill({status:200,json:{ok:true}});
    return route.continue();
  });
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:pw}});
  assert.equal(login.status(),200,'fictional demo login');
  const page=await context.newPage(),errors=[];
  const clearToast=async()=>page.evaluate(async()=>{const until=Date.now()+4000;while(document.querySelector('#toast.on')&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/me/devices');await page.locator('.device-empty').waitFor();
  assert.match(await page.locator('.device-empty').innerText(),/Sign in on another phone or browser/,'the empty device state gives the right next step');
  assert.equal(await page.locator('#dv-retry').count(),0,'an empty device list does not offer a meaningless refresh');
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`devices-empty-390-${theme}.png`),animations:'disabled'});}
  await page.goto(base+'/me/settings');
  await page.locator('a[href="/me/sharing"]').waitFor();
  await page.locator('a[href="/me/sharing"]').click();
  await page.locator('#sh-contact-discovery').waitFor();
  const disclosure=page.locator('#sharing-default-disclosure');
  assert.equal(await disclosure.innerText(),'New accounts share activities and achievements with everyone signed in. You can change this here any time.','Sharing & privacy preserves the accurate default note');
  assert.equal(await page.locator('[data-vis][role=radio]').count(),3,'audience is a three-row radio list');
  assert.equal(await page.locator('[data-vis="everyone"]').getAttribute('aria-checked'),'true','default audience shows the selected check');
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'sharing-main-390-'+theme+'.png'),animations:'disabled'});}
  await page.setViewportSize({width:330,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no page overflow at 330px');
  if(out)await page.screenshot({path:path.join(out,'sharing-main-330-'+theme+'.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  const friendsPick=page.waitForResponse(r=>r.url()===base+'/api/sharing'&&r.request().method()==='PUT');
  await page.locator('[data-vis="friends"]').click();assert.deepEqual((await friendsPick).request().postDataJSON(),{default:'friends'});
  assert.equal(await page.locator('[data-vis="friends"]').getAttribute('aria-checked'),'true','audience row updates selection');
  const achievementsCard=page.locator('#sh-achievements-card'),achievementsSwitch=page.locator('#sh-achievements');
  assert.equal(await achievementsSwitch.isChecked(),false,'achievement sharing starts off in the settings fixture');
  assert.equal(await page.locator('#sh-achievements-help').innerText(),'Distance, time and type are always shown. Splits need pace. Private notes stay private; featured achievements follow this setting.');
  const frameAchievements=async()=>page.evaluate(()=>{const el=document.querySelector('#sh-achievements-card');window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top-100,behavior:'instant'});});
  await page.evaluate(()=>document.fonts.ready.then(()=>true));
  const achievementGeometry=await achievementsCard.locator('.switch-row').evaluate(row=>{const text=row.querySelector('span'),control=row.querySelector('input'),box=control.getBoundingClientRect(),r=row.getBoundingClientRect();return{height:r.height,textFits:text.scrollWidth<=text.clientWidth+1,controlInside:box.left>=r.left-1&&box.right<=r.right+1};});
  assert(achievementGeometry.height>=44&&achievementGeometry.textFits&&achievementGeometry.controlInside,`achievement switch has a 44px target and fits: ${JSON.stringify(achievementGeometry)}`);
  await frameAchievements();
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`sharing-achievements-off-390-${theme}.png`),animations:'disabled',style:'#toast{display:none!important}'});}
  await page.setViewportSize({width:330,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  const narrowGeometry=await achievementsCard.locator('.switch-row').evaluate(row=>{const text=row.querySelector('span'),control=row.querySelector('input'),box=control.getBoundingClientRect(),r=row.getBoundingClientRect();return{height:r.height,textFits:text.scrollWidth<=text.clientWidth+1,controlInside:box.left>=r.left-1&&box.right<=r.right+1};});
  assert(narrowGeometry.height>=44&&narrowGeometry.textFits&&narrowGeometry.controlInside,`330px achievement switch fits: ${JSON.stringify(narrowGeometry)}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no page overflow at 330px');
  await frameAchievements();
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`sharing-achievements-off-330-${theme}.png`),animations:'disabled',style:'#toast{display:none!important}'});}
  await page.setViewportSize({width:390,height:844});
  const sharingOn=page.waitForResponse(r=>r.url()===base+'/api/sharing'&&r.request().method()==='PUT');
  await achievementsSwitch.check();
  const sharingOnResponse=await sharingOn;assert.equal(sharingOnResponse.status(),200);
  assert.deepEqual(sharingOnResponse.request().postDataJSON(),{share_achievements:true});
  assert.equal(await achievementsSwitch.isChecked(),true,'turning the setting on updates the switch');
  await page.reload();await page.locator('#sh-contact-discovery').waitFor();
  assert.equal(await page.locator('#sharing-default-disclosure').count(),1,'the default note stays visible on repeat visits');
  assert.equal(await page.locator('#sharing-default-disclosure').innerText(),'New accounts share activities and achievements with everyone signed in. You can change this here any time.');
  assert.equal(await achievementsSwitch.isChecked(),true,'the settings switch reads the shared API value after reload');
  await frameAchievements();
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`sharing-achievements-on-390-${theme}.png`),animations:'disabled'});}
  const sharingOff=page.waitForResponse(r=>r.url()===base+'/api/sharing'&&r.request().method()==='PUT');
  await achievementsSwitch.uncheck();
  const sharingOffResponse=await sharingOff;assert.equal(sharingOffResponse.status(),200);
  assert.deepEqual(sharingOffResponse.request().postDataJSON(),{share_achievements:false});
  assert.equal(await achievementsSwitch.isChecked(),false,'turning sharing off updates the switch');
  assert.deepEqual(shareWrites.filter(body=>Object.hasOwn(body,'share_achievements')),[{share_achievements:true},{share_achievements:false}],'the setting reuses the API field shared with the card sheet');
  assert.equal(await page.locator('#sh-find-email').isChecked(),true,'email discovery defaults on');
  assert.equal(await page.locator('#sh-find-phone').isChecked(),true,'phone discovery defaults on');
  assert.equal(await page.locator('#sh-phone-save').isDisabled(),true,'empty optional phone has no pending save');
  const discovery=page.locator('#sh-contact-discovery');
  const frameCard=async()=>page.evaluate(()=>{const el=document.querySelector('#sh-contact-discovery');window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top-70,behavior:'instant'});});
  await frameCard();await page.evaluate(()=>document.fonts.ready.then(()=>true));
  const geometry=await discovery.evaluate(card=>{const right=card.getBoundingClientRect().right,switches=[...card.querySelectorAll('.switch-row')].map(row=>{const text=row.querySelector('span'),control=row.querySelector('input'),box=control.getBoundingClientRect();return{textFits:text.scrollWidth<=text.clientWidth+1,controlInside:box.right<=right+1,target:row.getBoundingClientRect().height};});return{switches,phoneLabelSize:parseFloat(getComputedStyle(card.querySelector('#sh-contact-phone > label.form')).fontSize)};});
  assert(geometry.switches.every(row=>row.textFits&&row.controlInside&&row.target>=44)&&geometry.phoneLabelSize>=15,`contact settings text and controls fit: ${JSON.stringify(geometry)}`);
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`contacts-settings-empty-390-${theme}.png`),animations:'disabled'});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at 390px');

  const emailSave=page.waitForResponse(r=>r.url()===base+'/api/contacts/settings'&&r.request().method()==='PUT');
  await page.locator('#sh-find-email').uncheck();
  const emailResponse=await emailSave;assert.equal(emailResponse.status(),200);
  assert.deepEqual(emailResponse.request().postDataJSON(),{find_by_email:false});
  assert.equal(await page.locator('#sh-find-email').isChecked(),false,'email opt-out is reflected');
  await clearToast();

  await page.locator('#sh-trim-open').click();await page.locator('#sh-trim-options [data-trim]').first().waitFor();
  assert.equal(await page.locator('#sh-trim-options [data-trim]').count(),4,'route privacy opens a separate check-row list');
  if(out)await page.screenshot({path:path.join(out,`sharing-route-trim-390-${theme}.png`),animations:'disabled'});
  await page.setViewportSize({width:330,height:844});if(out)await page.screenshot({path:path.join(out,`sharing-route-trim-330-${theme}.png`),animations:'disabled'});await page.setViewportSize({width:390,height:844});
  const trimSave=page.waitForResponse(r=>r.url()===base+'/api/sharing'&&r.request().method()==='PUT');
  await page.locator('#sh-trim-options [data-trim="200"]').click();assert.deepEqual((await trimSave).request().postDataJSON(),{trim_m:200});
  await page.locator('#sh-trim-open').waitFor();assert((await page.locator('#sh-trim-open').innerText()).includes('⅛ mi'),'saved trim returns to Sharing & privacy');await clearToast();
  await page.locator('a[href="/me/sharing/blocked"]').click();await page.locator('#sh-blocked-list [data-unblk]').waitFor();
  assert((await page.locator('#sh-blocked-list').innerText()).includes('Riley Sample'),'blocked people is a separate screen');
  if(out)await page.screenshot({path:path.join(out,`sharing-blocked-390-${theme}.png`),animations:'disabled'});
  await page.setViewportSize({width:330,height:844});if(out)await page.screenshot({path:path.join(out,`sharing-blocked-330-${theme}.png`),animations:'disabled'});await page.setViewportSize({width:390,height:844});
  await page.locator('#sh-blocked-list [data-unblk]').click();await page.getByText('No blocked people',{exact:true}).waitFor();
  await page.goto(base+'/me/sharing');await page.locator('#sh-contact-discovery').waitFor();

  const phone=page.locator('#sh-contact-phone input[name="phone_e164"]');
  await phone.fill('+1 555 010 1234');
  assert.equal(await page.locator('#sh-phone-save').isDisabled(),false,'phone edit enables Save');
  const phoneSave=page.waitForResponse(r=>r.url()===base+'/api/contacts/settings'&&r.request().method()==='PUT');
  await page.locator('#sh-phone-save').click();
  const phoneResponse=await phoneSave;assert.equal(phoneResponse.status(),200);
  assert.deepEqual(phoneResponse.request().postDataJSON(),{phone_e164:'+1 555 010 1234'});
  assert.equal(await page.locator('#sh-contact-status').innerText(),'Phone number saved.');
  await clearToast();
  await page.reload();await page.locator('#sh-contact-discovery').waitFor();await frameCard();
  if(out)await page.screenshot({path:path.join(out,`contacts-settings-saved-390-${theme}.png`),animations:'disabled'});
  assert.deepEqual(errors,[],'no browser errors');
  await context.close();
}

(async()=>{
  const browser=await chromium.launch();
  try{for(const theme of ['light','dark'])await runTheme(browser,theme);}
  finally{await browser.close();}
  console.log('Sharing Settings: achievement switch API sync, contact choices, phone save, 330/390px light/dark, all writes intercepted PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
