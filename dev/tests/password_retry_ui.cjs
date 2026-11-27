'use strict';
// Actual form handlers, API decoder and native sign-in; fictional responses, no external server.
const {chromium,webkit}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('app/static/app.js','utf8'),pages=fs.readFileSync('app/static/pages.js','utf8');
const part=(text,a,b)=>text.slice(text.indexOf(a),text.indexOf(b));
// Include the real eager sign-out cleanup used by showLogin; the deferred social bundle is absent.
const handlers=part(app,'function clearCommentDrafts()','let pendingDishEntry')+
 part(app,'const newId =','// change a day of the food log')+
 part(app,'async function apiRequest(','function aiCan(')+
 part(app,'function accountSupportError(','// The phone\'s own time zone')+
 part(app,'function phoneDefaults(','// Email-first')+
 part(app,'const namePrivacy =','function showSignupPending(')+
 part(app,'async function showReset(','async function showConfirmEmail(')+
 part(pages,'function passwordSheet()','route(/^\\/me\\/people');
const busy='Kinetta is busy. Please try again in a few seconds.';
(async()=>{
 let checked=0;
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{for(const native of [false,true])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme});
   try{
    await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<main id="app"></main><p id="toast" role="status"></p>'}):r.abort());
    const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto('http://127.0.0.1:9259/');
    await p.evaluate(({native,busy})=>{
     globalThis.route=()=>{};globalThis.root=document.querySelector('#app');globalThis.App={me:null,cache:new Map()};
     globalThis.$=(s,el=document)=>el.querySelector(s);globalThis.$$=(s,el=document)=>[...el.querySelectorAll(s)];
     globalThis.BRAND='Kinetta';globalThis.esc=s=>String(s??'').replace(/[<>&"]/g,'');
     globalThis.readOwner=()=> 'fictional-owner';globalThis.api=(path,opts)=>apiRequest(path,opts);
     globalThis.store={get(){},set(){},del(){}};globalThis.enrollmentView=()=>()=>true;globalThis.enrollmentStatus=()=>{root.textContent='Checking';};
     globalThis.cleanViews=()=>{};globalThis.lazyUsernameAvailability=()=>null;globalThis.forgetKept=()=>{};
     // Route prefetch is outside this isolated form fixture; native sign-in clears it.
     globalThis.discardRouteReads=()=>{};
     globalThis.start=()=>{throw Error('busy request must not sign in');};globalThis.getAppFirst=()=>false;
     globalThis.toast=s=>document.querySelector('#toast').textContent=s;
     globalThis.sheet=(title,html,mount)=>{root.innerHTML=html;mount(root,()=>{throw Error('busy must keep sheet');});};
     globalThis.fetch=async(url,options={})=>{
      const path=String(url).replace(/^https?:\/\/[^/]+/,'');
      if(path==='/api/password/reset/check')return new Response(JSON.stringify({login:'fictional_member'}));
      if(!options.method)return new Response(JSON.stringify({open:false}));
      globalThis.posts=(globalThis.posts||0)+1;
      return new Promise(resolve=>{globalThis.finishBusy=()=>resolve(new Response(JSON.stringify({detail:busy}),{status:503,headers:native?{}:{'Retry-After':'2'}}));});
     };
     const prefs=new Map([['server','https://example.test']]);globalThis.savedPreferences=prefs;
     if(native)globalThis.Capacitor={isNativePlatform:()=>true,Plugins:{Preferences:{get:async({key})=>({value:prefs.get(key)??null}),set:async({key,value})=>prefs.set(key,value),remove:async({key})=>prefs.delete(key)}}};
    },{native,busy});
    await p.addScriptTag({content:fs.readFileSync('app/static/native.js','utf8')});
    await p.addScriptTag({content:handlers});
    await p.evaluate(async()=>{await Native.ready;Native.stopActivityShare=async()=>{};Native.disconnectPush=async()=>{};Native.disconnectHealth=async()=>[];});
    for(const mode of ['login','signup','reset','temporary','change']){
     await p.evaluate(async mode=>{
      App.me=null;globalThis.finishBusy=null;document.querySelector('#toast').textContent='';
      if(mode==='login')showLogin();
      if(mode==='signup')showNewAccount({title:'Create account',intro:'Fictional test',button:'Create account',signup:true,send:body=>Native.on?Native.signup(body):api('/api/signup',json('POST',body))});
      if(mode==='reset')await showReset('fictional-token');
      if(mode==='temporary')showTemporaryPassword('fictional-challenge');
      if(mode==='change'){App.me={login:'fictional_member',id:1};passwordSheet();}
     },mode);
     const values={login:'fictional_member',password:'fictional maple kettle password',confirm:'fictional maple kettle password',
      first_name:'Fictional',last_name:'Runner',email:'fictional@example.test',cur:'fictional old password',n1:'fictional maple kettle password',n2:'fictional maple kettle password'};
     for(const [name,value] of Object.entries(values))if(await p.locator(`form input[name=${name}]:visible`).count())await p.locator(`form input[name=${name}]:visible`).fill(value);
     if(await p.locator('input[name=age_ok]').count())await p.locator('input[name=age_ok]').check();
     const before=await p.locator('form').evaluate(f=>[...f.elements].filter(e=>e.tagName==='INPUT').map(e=>[e.name,e.value,e.checked]));
     const button=p.locator('form button.primary').first(),posts=await p.evaluate(()=>globalThis.posts||0);await button.click();
     const state=await p.waitForFunction(()=>{
      if(typeof finishBusy==='function')return {pending:true};
      const error=document.querySelector('form .err, .field-err')?.textContent||document.querySelector('#toast')?.textContent;
      if(error)return {error};
     });
     assert.deepEqual(await state.jsonValue(),{pending:true},`${engine.name()} ${native?'bridge':'web'} ${theme} ${mode}: request must start`);
     await state.dispose();assert(await button.isDisabled(),mode+' is disabled while pending');
     await p.evaluate(()=>finishBusy());await p.waitForFunction(()=>document.body.textContent.includes('Kinetta is busy.'));
     assert.equal(await button.isDisabled(),false,mode+' can retry');
     assert.equal(await p.evaluate(()=>globalThis.posts),posts+1,'no automatic password retry');
     assert.deepEqual(await p.locator('form').evaluate(f=>[...f.elements].filter(e=>e.tagName==='INPUT').map(e=>[e.name,e.value,e.checked])),before,mode+' retains inputs');
     assert.equal(await p.evaluate(()=>savedPreferences.has('token')),false,'503 never stores a native session');
     if(process.env.SHOT_DIR&&mode==='login')await p.screenshot({path:`${process.env.SHOT_DIR}/retry-${engine.name()}-${native?'bridge':'web'}-${theme}.png`});
     checked++;
    }
    // Native CORS need not expose Retry-After; the fixed safe message still works.
    // Other server errors still hide diagnostics.
    await p.evaluate(()=>{globalThis.fetch=async()=>new Response(JSON.stringify({detail:'private diagnostic'}),{status:503});});
    assert.equal(await p.evaluate(async()=>{try{await apiRequest('/api/login',{method:'POST'});}catch(e){return e.message;}}),'Kinetta is having trouble right now. Please try again.');
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
 console.log(`PASS ${checked} password retry form checks: Chromium/WebKit, web/iPhone bridge, light/dark; no providers`);
})().catch(e=>{console.error(e);process.exitCode=1;});
