// Fictional saved numbers; actual welcome handler and web/native transport stand-in.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,login,password,out='')=>{
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block'});
  const auth=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password,app:mode==='bridge'}});assert(auth.ok());
  if(mode==='bridge'){const {token}=await auth.json();await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
  const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));let stored=null,fault='',unreadable=false,writes=0;
  await c.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
   if(u.pathname==='/api/contacts/settings'){
    if(q.method()==='GET')return r.fulfill({status:unreadable?503:200,json:unreadable?{detail:'Fictional outage'}:{phone_e164:stored}});
    writes++;const body=q.postDataJSON();if(fault==='lost'){stored=body.phone_e164;return r.abort();}
    if(fault==='503'||fault==='422')return r.fulfill({status:Number(fault),json:{detail:fault==='422'?'Include + and your country code.':'Fictional outage'}});
    if(fault!=='mismatch')stored=body.phone_e164?.replace(/[\s().-]/g,'')||null;
    return r.fulfill({json:{phone_e164:stored}});
   }
   if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();
  });
  try{for(fault of ['503','422','mismatch','lost']){
   stored=fault==='503'?null:'+15550101111';unreadable=false;writes=0;
   await p.goto(base+'/welcome?step=phone');const input=p.locator('[name=phone_e164]'),summary=p.locator('#wc-phone-saved');await input.locator('..').waitFor();await p.locator('[name=phone_e164]:enabled').waitFor();
   const draft=fault==='lost'?'+15550102222':'+1 (555) 010-2222';await input.fill(draft);await p.locator('#wc-next').click();
   if(fault!=='mismatch'){
    await p.locator('[data-sharing-state=unknown]').waitFor();assert(await summary.isHidden(),'uncertain read cannot claim a saved number');
    await require('./privacy_recovery_fixture.cjs')(p);
    if(fault==='503'){
     unreadable=true;await p.locator('[data-sharing-state=unknown] button').click();await p.locator('[data-sharing-state=unknown]').waitFor();assert(await summary.isHidden(),'failed read keeps saved number unknown');unreadable=false;
    }
    await p.locator('[data-sharing-state=unknown] button').click();
   }
   await p.locator('[data-sharing-state=confirmed]').waitFor({state:'attached'});
   if(fault==='lost'){
    assert(await summary.isHidden(),'confirmed success removes failure-only saved summary');assert.equal(await input.inputValue(),stored);await p.locator('#wc-next').click();await p.locator('#wc-connections').waitFor();
   }else{
    const note=p.locator('[data-sharing-state=confirmed]');await note.waitFor({state:'visible'});assert.match(await note.innerText(),/Not saved/);if(fault==='422')assert.match(await note.innerText(),/Include \+ and your country code/);
    assert.equal(await input.inputValue(),draft,'failed save retains typed draft');assert.equal(await summary.innerText(),'Saved number: '+(stored||'None')+'.','saved value is separate from draft');assert(!/Saved number shown/.test(await p.locator('.welcome').innerText()));assert.equal(await p.locator('#wc-err').innerText(),'','one accurate failure message');
    if(out&&mode==='web'&&fault==='422'){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'phone-saved-'+theme+'.png')});}
    fault='retry';await p.locator('#wc-next').click();await p.locator('#wc-connections').waitFor();assert.equal(stored,'+15550102222');
   }
   assert.equal(writes,fault==='lost'?1:2);console.log('Welcome phone recovery '+mode+' '+theme+' '+fault+' PASS');
  }assert.deepEqual(errors,[]);}finally{await c.unrouteAll({behavior:'wait'});await c.close();}
 }
};
