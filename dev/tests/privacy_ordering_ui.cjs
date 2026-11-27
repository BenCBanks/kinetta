// Actual server tickets + delayed fictional browser requests; no mocked saved-state responses.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  if(process.env.PRIVACY_ORDERING_ONE&&(mode!=='web'||theme!=='light'))continue;
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}});
  assert.equal(login.status(),200);const credentials=await login.json(),headers=mode==='bridge'?{Authorization:'Bearer '+credentials.token,Origin:base}:{Origin:base};
  if(mode==='bridge')await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token:credentials.token});
  const initial=(await(await c.request.get(base+'/api/sharing',{headers})).json()).default;
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  let held=null,settingWrites=0;
  await c.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
   if(u.pathname==='/api/sharing'&&q.method()==='PUT'){
    settingWrites++;held={body:q.postDataJSON(),ticket:q.headers()['x-kinetta-privacy-ticket']};
    await new Promise(resolve=>setTimeout(resolve,800));return r.abort().catch(()=>{});
   }
   return r.continue();
  });
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`ordering-${mode}-${theme}-${name}.png`)});}};
  try{
   assert((await c.request.put(base+'/api/sharing',{headers,data:{default:'me'}})).ok());
   await p.goto(base+'/me/sharing');await p.locator('[data-vis=me][aria-checked=true]').waitFor();
   // Shorten only the UI wait; the real server ticket still has its normal validity window.
   await p.evaluate(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000?500:ms,...args);});
   await p.locator('[data-vis=everyone]').click();await p.locator('[data-sharing-state=unknown]').waitFor();
   assert(held?.ticket);assert.equal(held.body.default,'everyone');
   assert(!await p.locator('[data-vis=me]').isVisible());await shot('pending');
   // The unsafe readback really would still say Only me before the delayed request arrives.
   assert.equal((await(await c.request.get(base+'/api/sharing',{headers})).json()).default,'me');
   await p.goto(base+'/me/sharing');await p.locator('.load-error').waitFor();
   assert.equal(await p.locator('[data-vis=me]').count(),0,'reloaded route cannot claim private while the old public request is valid');
   const pendingRead=p.waitForResponse(r=>r.url().includes('/api/privacy-save?')&&r.status()===409);await p.locator('.load-error button').click();await pendingRead;await p.waitForFunction(()=>App.pageReady);await p.locator('.load-error').waitFor();
   assert.equal(settingWrites,1,'Retry/reload never repeats a setting write');await shot('returned');
   // Deliver the old request after timeout/navigation. The API must not report settlement before this.
   const late=await c.request.put(base+'/api/sharing',{headers:{...headers,'X-Kinetta-Privacy-Ticket':held.ticket},data:held.body});
   assert.equal(late.status(),200,await late.text());
   assert.equal((await c.request.get(base+'/api/privacy-save?ticket='+encodeURIComponent(held.ticket),{headers})).status(),200,'late endpoint is consumed before retry');
   await p.locator('.load-error button').click();await p.locator('[data-vis=everyone][aria-checked=true]').waitFor();await shot('confirmed');
   assert.equal(settingWrites,1);assert.equal((await(await c.request.get(base+'/api/sharing',{headers})).json()).default,'everyone');
   const reserve=async()=>{const r=await c.request.post(base+'/api/privacy-save',{headers,data:{path:'/api/sharing',method:'PUT'}});assert(r.ok());return(await r.json()).ticket;};
   const older=await reserve(),newer=await reserve();
   assert.equal((await c.request.put(base+'/api/sharing',{headers:{...headers,'X-Kinetta-Privacy-Ticket':newer},data:{default:'me'}})).status(),200);
   assert.equal((await c.request.put(base+'/api/sharing',{headers:{...headers,'X-Kinetta-Privacy-Ticket':older},data:{default:'everyone'}})).status(),409);
   assert.equal((await(await c.request.get(base+'/api/sharing',{headers})).json()).default,'me');
   assert.deepEqual(errors,[]);console.log('Privacy ordering',mode,theme,': timeout/navigation/reload, GET-only Retry, delayed commit and older-public rejection PASS');
  }catch(e){await shot('error');console.error(await p.locator('#page').innerText());throw e;}finally{await c.request.put(base+'/api/sharing',{headers,data:{default:initial}});await c.close();}
 }
};
