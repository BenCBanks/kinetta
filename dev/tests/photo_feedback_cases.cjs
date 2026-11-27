'use strict';
// Actual upload handlers, fictional pixels, and controlled API failures. No provider calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function photoFeedback(browser,base,{login='alex',password='blue kettle morning run'}={}){
 const out=process.env.KINETTA_LIMIT_SHOTS;
 for(const native of [false,true])for(const theme of ['light','dark'])for(const flow of ['profile','activity','label'])for(const failure of ['429','offline','503','400']){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password,app:native}});assert.equal(signed.status(),200);
   const token=(await signed.json()).token;
   if(native)await context.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false,Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});
   const page=await context.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
   const target=flow==='profile'?'/api/me/photo':flow==='activity'?'/api/activities/987654/photos':'/api/food/label';
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(u.pathname===target&&req.method()!=='GET'){
     calls.push(req.postDataJSON());
     if(calls.length===1){if(failure==='offline')return route.abort();return route.fulfill({status:Number(failure),json:{detail:failure==='400'?'Choose a smaller photo.':'Too many photo uploads. Wait a minute and try again.'}});}
     return route.fulfill({json:flow==='label'?{name:'Fictional food',serving:{label:'100 g',g:100},per100:{kcal:55},per_serving:{kcal:55,protein_g:1,carbs_g:10,fat_g:1}}:flow==='profile'?{photo:null}:{id:987654,w:1,h:1}});
    }
    if(u.pathname==='/api/me'){
     const response=await route.fetch();return route.fulfill({response,json:{...await response.json(),coach:true,ai_ok:true,food_ai_ok:true,ai_paused:false,created:"2026-01-01T00:00:00Z"}});
    }
    if(req.method()!=='GET')return route.fulfill({status:503,json:{detail:'Unrelated test write blocked'}});
    return route.continue();
   });
   await page.goto(base+'/me?edit=profile');await page.waitForFunction(()=>App.pageReady);
   if(flow==='profile')await page.locator('[data-card-photo]').click();
   else if(flow==='activity'){await page.evaluate(()=>loadClassicScript(SOCIAL_ROUTE_ASSET));await page.evaluate(()=>sheet('Activity photos','<div id="test-photos"></div>',b=>photoStrip(b.querySelector('#test-photos'),{id:987654,photos:[]},true)));}
   else {
    await page.goto(base+'/food/recipe-link');await page.waitForFunction(()=>App.pageReady&&typeof labelButton==='function');
    await page.evaluate(()=>sheet('Fictional recipe','<input id="dk-label-file" type="file" accept="image/*" hidden>',b=>labelButton(b,{id:987654},()=>{})));
   }
   const field=page.locator(flow==='profile'?'#pp-file':flow==='activity'?'[data-phfile]':'#dk-label-file');
   await field.setInputFiles({name:'fictional.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64')});
   if(flow==='label')await page.locator('#photos-use').click();
   const notice=page.locator(flow==='label'?'#lb-box .err':'#toast.on');await notice.waitFor();
   const accessible=await notice.evaluate(n=>{
    const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {visible:r.width>0&&r.height>0&&r.y>=0&&r.bottom<=innerHeight,covered:!(hit===n||n.contains(hit)),inert:!!n.closest('[inert]'),role:n.getAttribute('role'),dialog:!!n.closest('[aria-modal="true"]')};
   });
   assert.deepEqual(accessible,{visible:true,covered:false,inert:false,role:flow==='label'?'alert':'status',dialog:true},`${flow}/${failure} feedback is visible and announced within active dialog`);
   if(out&&failure==='429'){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${native?'bridge':'web'}-${flow}-${theme}.png`),animations:'disabled'});}
   if(flow==='profile'&&failure==='429'){
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>sheet('Nested photo test','<div style="height:1200px">Fictional scrolling content</div>'));
    await page.waitForTimeout(500);
    await page.evaluate(()=>{document.querySelector('.scrim:last-child .sheet').scrollTop=900;toast('Fictional nested photo error.');});
    const nested=page.locator('#toast.on');await nested.waitFor();
    assert(await nested.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !n.closest('[inert]')&&n.closest('[aria-modal="true"]')&&r.y>=0&&(hit===n||n.contains(hit));}),'nested scrolling sheet does not clip or inert its notice');
    await page.locator('.scrim:last-child [data-close]').click();await page.locator('.scrim').nth(1).waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'reduce'});
   }
   const retry=page.getByRole('button',{name:flow==='label'?(failure==='400'?'Try another photo':'Retry photo'):failure==='400'?(flow==='profile'?'Choose a photo':'Add photos'):'Retry photo',exact:true});await retry.waitFor();assert(await retry.isEnabled());
   if(failure!=='400'){
    await retry.click();await page.waitForFunction(()=>!document.querySelector('#pp-pick')||document.querySelector('#pp-pick')?.textContent!=='Saving…');
    for(let i=0;i<100&&calls.length<2;i++)await page.waitForTimeout(20);
    assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0],'manual retry sends the same prepared pixels');
    if(flow==='label')await page.locator('#lb input[name=name]').waitFor();
   }
   assert.deepEqual(errors,[]);
  }catch(e){throw Error(`${native?'bridge':'web'}/${theme}/${flow}/${failure}: ${e.message}\n${await context.pages()[0]?.locator('body').innerText()}`);}finally{await context.close();}
 }
 console.log('Photo errors: 48 web/bridge light/dark cases; live modal feedback, 429/offline/503 exact retry and invalid-photo replacement PASS');
};
if(require.main===module)(async()=>{const browser=await require('playwright').chromium.launch();try{await module.exports(browser,process.env.KINETTA_URL||'http://localhost:8798',{login:process.env.KINETTA_TEST_LOGIN||'alex',password:process.env.KINETTA_TEST_PASSWORD||'blue kettle morning run'});}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
