'use strict';
// Actual app/admin forms, with email/reset/enrollment gates and writes stood in.
// Passwords below are fictional; never log a field value or send a real account action.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
const cases=[['signin',1],['signup',1],['invite',1],['temporary',2],['reset',1],['email',1],['delete',1],['change',3],['admin-signin',1],['admin-member',1],['admin-fallback',1]];
(async()=>{
 const browser=await chromium.launch();let tested=0;
 try{
  for(const theme of ['light','dark'])for(const size of [{width:390,root:15},{width:330,root:24}])for(const [kind,count] of cases){
   if(process.env.CASE&&process.env.CASE!==kind)continue;
   const c=await browser.newContext({viewport:{width:size.width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
   try{
    const admin=kind.startsWith('admin-');if(!admin)assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
    await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
    const p=await c.newPage(),errors=[];let writes=0;p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',r=>{const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(request.method())){writes++;return r.fulfill({status:503,json:{detail:'Fictional test failure'}});}if(u.pathname.startsWith('/api/password/reset/'))return r.fulfill({json:{login:'zz_test_password_eye'}});return r.continue();});
    await p.goto(base+(admin?'/admin':'/me/settings'));
    if(admin){await until(p,()=>revision>0&&who===null,'Initial signed-out admin check settled');await p.locator('#login input[type=password]').waitFor();if(kind==='admin-member')await p.evaluate(()=>createMember());if(kind==='admin-fallback')await p.evaluate(()=>account({id:999999,login:'zz_test_password_eye',name:'Fictional Member'},'password'));}
    else{await until(p,()=>App.pageReady,'App ready');await p.evaluate(kind=>{
     if(kind==='signin')showLogin();
     if(kind==='signup'||kind==='invite')showNewAccount({title:kind==='signup'?'Create your account':'Join Kinetta',intro:'Fictional test enrollment',button:'Create my account',signup:kind==='signup',email:kind==='signup',send:async()=>{throw Error('Fictional enrollment failure');}});
     if(kind==='temporary')showTemporaryPassword('fictional-change-token');
     if(kind==='reset')return showReset('fictional-reset-token');
     if(kind==='email'){App.me.mail_ready=true;emailSheet();}
     if(kind==='delete')deleteSheet();
     if(kind==='change')passwordSheet();
    },kind);}
    const fields=admin?p.locator(kind==='admin-signin'?'#login .password-input':'#dialog .password-input'):p.locator('.password-input');
    await fields.first().waitFor();assert.equal(await fields.count(),count,kind+' expected password fields');
    if(['temporary','reset','delete','change'].includes(kind))assert(await fields.first().evaluate(n=>n===document.activeElement),'Initial password focus survives enhancement');
    await fields.first().evaluate(n=>{for(const field of n.form.elements){if(field.tagName!=='INPUT'||field.type==='password'||field.type==='hidden')continue;if(field.type==='checkbox'){if(field.required)field.checked=true;continue;}if(!field.value&&['text','email'].includes(field.type))field.value=field.type==='email'?'fictional@example.invalid':field.name==='confirm'?'zz_test_password_eye':field.name==='name'?'Alex Example':'zz_test_password_eye';}});
    for(const field of await fields.all())await field.fill('fictional passphrase');
    // Every original password input remains the same element in the same label and form.
    for(let i=0;i<count;i++){
     const input=fields.nth(i),button=input.locator('..').locator('.password-visibility-button');await button.waitFor();
     const before=await input.evaluate(n=>({name:n.name,id:n.id,autocomplete:n.autocomplete,form:n.form,labels:[...n.labels]}));
     await input.evaluate(n=>{n._fixtureForm=n.form;n._fixtureLabels=[...n.labels];});
     assert.equal(await input.getAttribute('type'),'password');assert.equal(await button.getAttribute('aria-label'),'Show password');assert.equal(await button.getAttribute('aria-pressed'),'false');
     assert.equal(await input.getAttribute('autocapitalize'),'off');assert.equal(await input.getAttribute('autocorrect'),'off');assert.equal(await input.getAttribute('spellcheck'),'false');
     assert(await input.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));const rect=await button.boundingBox();assert(rect.width>=44&&rect.height>=44);assert(await input.evaluate(n=>parseFloat(getComputedStyle(n).paddingRight)>=52));
     await input.fill('fictional passphrase');await input.evaluate(n=>n.setSelectionRange(2,7,'forward'));const sent=writes;
     await button.tap();assert.equal(writes,sent,'Eye never submits');assert.equal(await input.getAttribute('type'),'text');assert.equal(await input.inputValue(),'fictional passphrase');assert(await input.evaluate(n=>n===document.activeElement&&n.selectionStart===2&&n.selectionEnd===7));assert.equal(await button.getAttribute('aria-label'),'Hide password');assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await button.locator('svg').count(),1);
     assert(await input.evaluate((n,b)=>n.name===b.name&&n.id===b.id&&n.autocomplete===b.autocomplete&&n.form===n._fixtureForm&&[...n.labels].every((label,i)=>label===n._fixtureLabels[i]),{name:before.name,id:before.id,autocomplete:before.autocomplete}));
     if(out&&i===0&&size.width===390&&['signin','change'].includes(kind)){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${kind}-shown-${theme}-390.png`)});}
     await button.tap();assert.equal(await input.getAttribute('type'),'password');assert.equal(await button.getAttribute('aria-label'),'Show password');assert.equal(await input.inputValue(),'fictional passphrase');
     if(out&&i===0&&size.width===390&&['signin','change'].includes(kind))await p.screenshot({path:path.join(out,`${kind}-hidden-${theme}-390.png`)});
     await button.focus();await p.keyboard.press('Enter');assert.equal(await input.getAttribute('type'),'text');assert(await input.evaluate(n=>n===document.activeElement),'Keyboard activation returns focus to input');assert.equal(writes,sent);
     // The form's real submit handler runs behind a failed stand-in; the eye re-hides first.
     await input.evaluate(n=>n.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
     assert.equal(await input.getAttribute('type'),'password');assert.equal(await button.getAttribute('aria-pressed'),'false');assert.equal(await button.locator('svg').count(),1,'Submit handler keeps the eye control intact');
     tested++;
    }
    const first=fields.first(),handle=await first.elementHandle();await first.fill('fictional passphrase');await first.locator('..').locator('.password-visibility-button').tap();
    if(admin&&kind!=='admin-signin')await p.locator('#close').click();
    else if(!admin&&['email','delete','change'].includes(kind))await p.locator('.sheet header [data-close]').click();
    else if(admin)await p.evaluate(()=>document.querySelector('#login').hidden=true);
    else await p.evaluate(()=>showLogin());
    await until(p,()=>!document.querySelector('.password-input[type=text]'),'Close/replacement re-hides');assert.equal(await handle.evaluate(n=>n.type),'password','Detached original starts hidden if reused');assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);console.log(`Password visibility ${kind} ${size.width}/${size.root}px ${theme}: all${count} fields, tap/keyboard/value/focus/selection/identity/submit/close PASS`);
   }finally{await c.close();}
  }
 }finally{await browser.close();}
 console.log(`Password visibility: ${tested} rendered field cases PASS; writes stood in, physical Keychain not exercised`);
})().catch(error=>{console.error(error);process.exitCode=1;});
