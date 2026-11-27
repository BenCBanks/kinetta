'use strict';
// Hold fictional enrollment replies: never create an account or send email.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function enrollmentTimeout(browser,base){
 const out=process.env.KINETTA_LIMIT_SHOTS;
 for(const native of [false,true])for(const theme of ['light','dark'])for(const flow of ['signup','login']){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
  let release;
  try{
   await context.addInitScript(({base,native})=>{
    localStorage.setItem('kinetta.firstRunWelcomeSeen','true');
    if(native){const values={server:base};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false,Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};}
   },{base,native});
   const page=await context.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/'+flow&&req.method()==='POST'){
     calls.push(req.postDataJSON());
     if(calls.length===1){await new Promise(r=>release=r);return route.abort().catch(()=>{});}
     return route.fulfill({status:429,json:{detail:'Too many tries. Wait a minute and try again.'}});
    }
    if(u.pathname==='/api/terms')return route.fulfill({json:{version:null,draft:true}});
    if(u.pathname==='/api/signup'&&req.method()==='GET')return route.fulfill({json:{open:true,full:false,email:true}});
    if(u.pathname.includes('/username-availability'))return route.fulfill({json:{available:true,login:'fictional_timeout'}});
    if(u.pathname==='/api/me')return route.fulfill({status:401,json:{detail:'Not signed in'}});
    if(req.method()!=='GET')return route.fulfill({status:503,json:{detail:'Unrelated test write blocked'}});
    return route.continue();
   });
   await page.goto(base+'/'+flow);
   if(flow==='signup'){
    await page.locator('[name=first_name]').fill('Jordan');await page.locator('[name=last_name]').fill('Example');
    await page.locator('[name=email]').fill('fictional@example.com');await page.locator('[name=age_ok]').check();
    if(await page.locator('[name=terms_ok]').count())await page.locator('[name=terms_ok]').check();
   }
   await page.locator('input[name=login]').fill('fictional_timeout');await page.locator('input[name=password]').fill('green teapot on the hill');
   const fields=()=>page.locator('input,select').evaluateAll(ns=>ns.filter(n=>n.type!=='hidden').map(n=>[n.name,n.type==='checkbox'?n.checked:n.value]));
   const before=await fields();await page.clock.install();const button=page.locator('button[type=submit]');await button.click();
   if(flow==='signup'){const use=page.getByRole('button',{name:'Use this address',exact:true});await use.waitFor();await use.click();}
   for(let i=0;i<100&&!calls.length;i++)await page.waitForTimeout(20);assert.equal(calls.length,1,flow+'/'+native+' '+await page.locator('body').innerText());
   await page.clock.runFor(20001);
   const message=flow==='signup'?'This is taking too long. Please try again.':'Sign-in is temporarily unavailable. Please try again.';
   await page.getByText(message,{exact:true}).waitFor();assert(await button.isEnabled());assert.deepEqual(await fields(),before,'timeout preserves every field and checkbox');assert.equal(calls.length,1,'timeout never automatically replays enrollment');
   await page.evaluate(()=>document.activeElement?.blur());
   if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${native?'bridge':'web'}-${flow}-${theme}.png`),animations:'disabled'});}
   release();release=null;await page.clock.resume();await button.click();await page.getByText('Too many tries. Wait a minute and try again.',{exact:true}).waitFor();
   assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0],'explicit retry keeps enrollment input');assert.deepEqual(await fields(),before);assert(await button.isEnabled());assert.deepEqual(errors,[]);
  }finally{release?.();await context.close();}
 }
 console.log('Enrollment timeout: 8 web/bridge light/dark cases; kept fields, manual retry, 429 recovery and no automatic replay PASS');
};
if(require.main===module)(async()=>{const browser=await require('playwright').chromium.launch();try{await module.exports(browser,process.env.KINETTA_URL||'http://localhost:8798');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
