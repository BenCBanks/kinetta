// Real saved-state HTTP + delayed fictional browser requests; no ticket/status protocol.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const expire=require('./privacy_recovery_fixture.cjs');
module.exports=async(browser,base,out='')=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  if(process.env.PRIVACY_ORDERING_ONE&&(mode!=='web'||theme!=='light'))continue;
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}});
  assert.equal(login.status(),200);const credentials=await login.json(),headers=mode==='bridge'?{Authorization:'Bearer '+credentials.token,Origin:base}:{Origin:base};
  if(mode==='bridge')await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token:credentials.token});
  const initial=(await(await c.request.get(base+'/api/sharing',{headers})).json()).default;
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  let held=null,settingWrites=0,protocolRequests=0;
  await c.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
   if(u.pathname==='/api/privacy-save')protocolRequests++;
   if(u.pathname==='/api/sharing'&&q.method()==='PUT'){
    settingWrites++;held=q.postDataJSON();return r.abort();
   }
   return r.continue();
  });
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`bounded-${mode}-${theme}-${name}.png`)});}};
  try{
   assert((await c.request.put(base+'/api/sharing',{headers,data:{default:'me'}})).ok());
   await p.goto(base+'/me/sharing');await p.locator('[data-vis=me][aria-checked=true]').waitFor();
   await p.locator('[data-vis=everyone]').click();await p.locator('[data-sharing-state=unknown]').waitFor();
   assert.equal(held.default,'everyone');assert(!await p.locator('[data-vis=me]').isVisible());await shot('pending');
   assert.equal((await(await c.request.get(base+'/api/sharing',{headers})).json()).default,'me');
   // Ordinary app GETs still run while this setting is uncertain.
   assert.equal(await p.evaluate(async()=>typeof (await api('/api/me')).id),'number');
   await p.goto(base+'/me/sharing');await p.locator('[data-sharing-state=unknown]').waitFor();
   assert(!await p.locator('[data-vis=me]').isVisible(),'reload conceals private during the finite grace period');
   let readbacks=0;const count=q=>{if(new URL(q.url()).pathname==='/api/sharing'&&q.method()==='GET')readbacks++;};p.on('request',count);
   await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=unknown]').waitFor();
   assert.equal(readbacks,0,'early Retry cannot read the stale private snapshot');assert.equal(settingWrites,1);await shot('returned');
   // A lost request arrives within the documented admission/grace limit.
   const late=await c.request.put(base+'/api/sharing',{headers,data:held});assert.equal(late.status(),200,await late.text());
   await expire(p);await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-vis=everyone][aria-checked=true]').waitFor();
   assert.equal(readbacks,1);await shot('confirmed');assert.equal(settingWrites,1);assert.equal(protocolRequests,0);
   // A full navigation after expiry also recovers without a special endpoint.
   await p.goto(base+'/me/sharing');await p.locator('[data-vis=everyone][aria-checked=true]').waitFor();
   assert.deepEqual(errors,[]);console.log('Bounded privacy',mode,theme,': lost reply/navigation/reload, unrestricted GETs, expiry + GET-only Retry PASS');
  }catch(e){await shot('error');console.error(await p.locator('#page').innerText());throw e;}finally{await c.request.put(base+'/api/sharing',{headers,data:{default:initial}});await c.close();}
 }
};
