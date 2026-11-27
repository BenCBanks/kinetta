// Fictional browser/bridge evidence; real iOS keyboard animation and panning need a device.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function({browser,base,state,login,password,out=null}){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));let cases=0;
 const signin=await browser.newContext();const response=await signin.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password,app:true}});assert.equal(response.status(),200);const auth=await response.json();await signin.close();
 for(const mode of ['native','resize','overlay'])for(const width of [320,390])for(const theme of ['light','dark']){
  const height=width===320?568:844,keyboard=291,edge=height-keyboard;
  const c=await browser.newContext({storageState:state,viewport:{width,height},colorScheme:theme,isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'}),p=await c.newPage(),errors=[],writes=[];
  try{
   p.on('pageerror',e=>errors.push(e.message));
   await c.addInitScript(({mode,base,token,theme,width,height})=>{
    localStorage.setItem('theme',theme);
    if(mode==='native'){const preferences={server:base,token};window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'ios',isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:preferences[key]??null}),set:async({key,value})=>preferences[key]=value,remove:async({key})=>delete preferences[key]}}};}
    if(mode==='overlay'){const vv=Object.assign(new EventTarget(),{width,height,scale:1,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0});Object.defineProperty(window,'visualViewport',{value:vv});}
    document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px');
   },{mode,base,token:auth.token,theme,width,height});
   await c.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/signup')return r.fulfill({json:{open:true,full:false}});
    if(u.pathname==='/api/beta')return r.fulfill({json:{open:false}});
    if(u.pathname==='/api/contacts/settings'&&q.method()==='GET')return r.fulfill({json:{phone_e164:null}});
    if(['/api/features/open','/api/challenges/signup/continue'].includes(u.pathname))return r.fulfill({json:{}});
    if(!['GET','HEAD'].includes(q.method())){writes.push({path:u.pathname,method:q.method()});return r.fulfill({status:503,json:{detail:'Fictional save failure'}});}
    if(u.pathname.endsWith('.css')&&mode==='native'){
     const response=await r.fetch();let body=await response.text();
     if(mode==='native')body=body.replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g,'20px').replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g,'0px');
     return r.fulfill({response,body});
    }return r.continue();
   });
   const settle=async()=>{await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
   const setKeyboard=async open=>{
    if(mode==='resize')await p.setViewportSize({width,height:open?edge:height});
    else await p.evaluate(({mode,open,keyboard,height})=>{
     if(mode==='native')for(const name of open?['keyboardWillShow','keyboardDidShow']:['keyboardWillHide','keyboardDidHide'])dispatchEvent(Object.assign(new Event(name),{keyboardHeight:open?keyboard:0}));
     else{visualViewport.height=open?height-keyboard:height;visualViewport.dispatchEvent(new Event('resize'));}
     let mask=document.querySelector('#keyboard-fixture');if(!open){mask?.remove();return;}
     if(!mask){mask=document.createElement('div');mask.id='keyboard-fixture';mask.textContent='Keyboard stand-in';mask.style.cssText=`position:fixed;z-index:99999;inset:auto 0 0;height:${keyboard}px;background:#9ca3af;color:#111;text-align:center;padding-top:20px;font:16px sans-serif`;document.body.append(mask);}
    },{mode,open,keyboard,height});
    await settle();
   };
   const visible=async(selector,label)=>{
    const m=await p.locator(selector).evaluate((n,edge)=>{
     const r=n.getBoundingClientRect(),ys=[r.top+4,r.top+r.height/2,r.bottom-4],x=r.left+r.width/2;
     return {x:r.left,y:r.top,w:r.width,h:r.height,viewport:innerWidth,hit:ys.every(y=>{const hit=document.elementFromPoint(x,y);return hit===n||n.contains(hit);}),edge};
    },edge);
    assert(m.y>=-1&&m.y+m.h<=edge+1&&m.x>=-1&&m.x+m.w<=width+1&&m.hit,`${mode} ${width} ${theme} ${label}: ${JSON.stringify(m)}`);return m;
   };
   for(const scene of ['login','profile','phone']){
    await p.goto(base+'/welcome?step='+(scene==='login'?'profile':scene));await p.locator('#wc-next').waitFor();
    if(scene==='phone')await p.locator('[name=phone_e164]:enabled').waitFor();
    if(scene==='login')await p.evaluate(base=>{Native.server=base;showLogin();},base);
    const fields=scene==='login'?{'input[name=login]':'fictional_member','input[name=password]':'fictional private password'}:scene==='profile'?{'#wc-form input[name=name]':'Fictional Review','#wc-form textarea':'Fictional weekend walks and training with friends.'}:{'input[name=phone_e164]':'+15550101234'};
    for(const [selector,value]of Object.entries(fields))await p.locator(selector).fill(value);
    const primary=scene==='login'?'.login button[type=submit]':'#wc-next';
    const closed=await p.locator(scene==='login'?'.login':'.welcome-actions').evaluate(n=>({position:getComputedStyle(n).position,bottom:getComputedStyle(n).bottom}));
    const navBefore=await p.locator('nav.tabs').count()?await p.locator('nav.tabs').evaluate(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize})):null;
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${mode}-${width}-${theme}-${scene}-closed.png`)});}
    await setKeyboard(true);
    for(const selector of Object.keys(fields)){
     await p.locator(selector).focus();await settle();
     const f=await visible(selector,scene+' focused field'),b=await visible(primary,scene+' primary');assert(f.y+f.h<=b.y-3||b.y+b.h<=f.y,'field and action do not overlap');
    }
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow');
    if(out)await p.screenshot({path:path.join(out,`${mode}-${width}-${theme}-${scene}-keyboard.png`)});
    await p.locator(primary).click();await p.waitForFunction(selector=>!document.querySelector(selector)?.disabled,primary);await settle();
    await visible(primary,scene+' retry');
    for(const [selector,value]of Object.entries(fields))assert.equal(await p.locator(selector).inputValue(),value,'failed submit retains the field');
    await p.locator(Object.keys(fields).at(-1)).focus();await settle();await visible(Object.keys(fields).at(-1),scene+' retry focus');
    await setKeyboard(false);await p.locator(Object.keys(fields)[0]).evaluate(n=>n.blur());await settle();
    assert.deepEqual(await p.locator(scene==='login'?'.login':'.welcome-actions').evaluate(n=>({position:getComputedStyle(n).position,bottom:getComputedStyle(n).bottom})),closed,'closed layout restored');
    if(navBefore)assert.deepEqual(await p.locator('nav.tabs').evaluate(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize})),navBefore,'fixed-size tab bar restored');
    cases++;
   }
   await p.evaluate(()=>showNewAccount({title:'Create your account',intro:'Fictional sign-up',button:'Create account',signup:true,send:async()=>{throw Error('No signup writes');}}));
   await p.locator('input[name=password]').focus();await setKeyboard(true);
   for(const selector of ['.login','.login button[type=submit]'])assert.notEqual(await p.locator(selector).evaluate(n=>getComputedStyle(n).position),'fixed','sign-up keeps its existing keyboard layout');
   await setKeyboard(false);
   assert.deepEqual(writes.map(w=>w.path),['/api/login','/api/account','/api/contacts/settings'],'only intercepted explicit submissions');assert.deepEqual(errors,[]);
  }finally{await c.close();}
 }
 console.log(`Keyboard forms: ${cases} login/profile/phone cases at320/390,root16,both themes,native/resize/overlay PASS;physical iPhone still needed`);
};
