"use strict";
// Sharing & privacy contact controls against the disposable demo app. All contact data is fictional and API writes are intercepted.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const base=(process.env.KINETTA_URL||'http://localhost:8798').replace(/\/$/,''),out=process.env.KINETTA_CONTACTS_OUT||'';
const pw='blue kettle morning run';

async function runTheme(browser,theme){
  let state={phone_e164:null,email_ready:true,find_by_email:true,find_by_phone:true};
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'UTC'});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/contacts/settings'){
      if(request.method()==='GET')return route.fulfill({json:state});
      if(request.method()==='PUT'){
        const body=request.postDataJSON();
        if(Object.hasOwn(body,'phone_e164'))body.phone_e164=body.phone_e164?.replace(/[\s().-]/g,'')||null;
        state={...state,...body};
        return route.fulfill({json:state});
      }
    }
    if(!['GET','HEAD','POST'].includes(request.method())&&url.pathname!=='/api/login')return route.fulfill({status:200,json:{ok:true}});
    return route.continue();
  });
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:pw}});
  assert.equal(login.status(),200,'fictional demo login');
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/me/settings');
  await page.locator('a[href="/me/sharing"]').waitFor();
  await page.locator('a[href="/me/sharing"]').click();
  await page.locator('#sh-contact-discovery').waitFor();
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

  const phone=page.locator('#sh-contact-phone input[name="phone_e164"]');
  await phone.fill('+1 555 010 1234');
  assert.equal(await page.locator('#sh-phone-save').isDisabled(),false,'phone edit enables Save');
  const phoneSave=page.waitForResponse(r=>r.url()===base+'/api/contacts/settings'&&r.request().method()==='PUT');
  await page.locator('#sh-phone-save').click();
  const phoneResponse=await phoneSave;assert.equal(phoneResponse.status(),200);
  assert.deepEqual(phoneResponse.request().postDataJSON(),{phone_e164:'+1 555 010 1234'});
  assert.equal(await page.locator('#sh-contact-status').innerText(),'Phone number saved.');
  await page.reload();await page.locator('#sh-contact-discovery').waitFor();await frameCard();
  if(out)await page.screenshot({path:path.join(out,`contacts-settings-saved-390-${theme}.png`),animations:'disabled'});
  assert.deepEqual(errors,[],'no browser errors');
  await context.close();
}

(async()=>{
  const browser=await chromium.launch();
  try{for(const theme of ['light','dark'])await runTheme(browser,theme);}
  finally{await browser.close();}
  console.log('Contacts Settings: default-on privacy choices, phone save, 390px light/dark, no contact data submitted to the server fixture PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
