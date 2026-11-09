'use strict';
// Browser plugin unavailable. Controlled uniqueness cases plus one isolated, email-free real invitation.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const login='zz_test_username_ui',password='green teapot on the hill',token='fictional_signup_invitation';
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error(label);};
(async()=>{
 const fixture=JSON.parse(fs.readFileSync(process.env.KINETTA_SIGNUP_FLOW_FIXTURE||'/tmp/'+(process.env.KINETTA_PROJECT||'kinettatest')+'-signup-flow.json','utf8'));
 assert.equal(fixture.base,base);assert.equal(fixture.project,process.env.KINETTA_PROJECT||'kinettatest');assert.equal(fixture.login,'walkthrough_demo');assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
 const browser=await chromium.launch();let cases=0;
 try{for(const theme of ['light','dark'])for(const width of [390,330]){
  if(process.env.THEME&&process.env.THEME!==theme||process.env.WIDTH&&Number(process.env.WIDTH)!==width)continue;
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
  try{
   const p=await c.newPage(),errors=[],checks=[],signups=[],accepts=[],joins=[],resends=[],forgot=[];let oldRelease=null,saveRelease=null,saveFailure=true,closed=true;
   p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource'))errors.push(m.text());});
   await c.route('**/*',async r=>{
    const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/signup'&&request.method()==='GET')return r.fulfill({json:{open:!closed,full:false}});
    if(u.pathname==='/api/account/username-availability'){
     const value=u.searchParams.get('login');checks.push(value);
     if(value==='old_choice')return new Promise(resolve=>{oldRelease=()=>r.fulfill({json:{login:value,available:false,reason:'taken',suggestion:'old_choice2'}}).catch(()=>{}).then(resolve);});
     return r.fulfill({json:value==='taken_name'?{login:value,available:false,reason:'taken',suggestion:'taken_name2'}:value==='admin'?{login:value,available:false,reason:'reserved',message:'That username is reserved. Choose another.'}:{login:value.trim().toLowerCase(),available:true}});
    }
    if(u.pathname==='/api/signup'&&request.method()==='POST'){
     const body=request.postDataJSON();signups.push(body);
     if(body.email==='casey@gmial.com')return r.fulfill({json:{ok:true,pending:body.email,login:'fictional_casey'}});
     if(body.email==='fresh@example.com')return r.fulfill({json:{ok:true,pending:body.email,login:'fictional_casey'}});
     const pending=body.email==='pending@example.com';return r.fulfill({status:409,json:{detail:{code:pending?'email_waiting_for_confirmation':'email_exists',message:pending?'This email is waiting for confirmation.':"There's already a Kinetta account with this email"}}});
    }
    if(u.pathname==='/api/account/email/resend'&&request.method()==='POST'){resends.push(request.postDataJSON());return r.fulfill({json:{ok:true,message:'If that account is waiting for confirmation, we’ve sent a new link. Check your inbox and spam folder.'}});}
    if(u.pathname==='/api/password/forgot'&&request.method()==='POST'){forgot.push(request.postDataJSON());return r.fulfill({json:{ok:true,message:'If that matches an account, we’ve sent a link to reset the password. Check your inbox and spam folder.'}});}
    if(u.pathname==='/api/login'){
     const body=request.postDataJSON();
     if(body.login==='pending@example.com')return r.fulfill({status:409,json:{detail:{code:'email_waiting_for_confirmation',message:'This account is waiting for email confirmation.'}}});
     if(body.login==='mail-unavailable@example.com')return r.fulfill({status:409,json:{detail:{code:'email_confirmation_unavailable',message:'Email confirmation is pending, but email is not available on this Kinetta. Sign in with your @username or ask the person who runs it for help.'}}});
     assert.equal(body.login,login);assert.equal(body.password,password);
     const response=await c.request.post(base+'/api/login',{headers:{Origin:base},data:body});return r.fulfill({response});
    }
    if(u.pathname==='/api/join/'+token)return r.fulfill({json:{email:true,inviter:'@casey',card:null,challenge:null}});
    if(u.pathname==='/api/join'&&request.method()==='POST'){joins.push(request.postDataJSON());return r.fulfill({status:400,json:{detail:'Kinetta is for people 16 or older'}});}
    if(u.pathname==='/api/join/existing'){accepts.push(request.postDataJSON());return r.fulfill({json:{ok:true,already_accepted:false}});}
    if(u.pathname==='/api/account'&&request.method()==='PUT'){
     if(saveFailure)return r.fulfill({status:409,json:{detail:'That username is taken'}});
     const body=request.postDataJSON();return new Promise(resolve=>{saveRelease=()=>r.fulfill({json:{ok:true,login:body.login.trim().toLowerCase()}}).then(resolve);});
    }
    if(!['GET','HEAD'].includes(request.method()))return r.fulfill({status:503,json:{detail:'Fictional test: write blocked'}});
    return r.continue();
   });
   const shot=async name=>{if(out&&width===390){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${name}-${theme}.png`),fullPage:name.startsWith('signup')});}};
   const fit=async()=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No horizontal overflow');
   await p.goto(base+fixture.friend_path);await p.locator('#iv-login').waitFor();assert.equal(await p.locator('#iv-signup').count(),0);assert(!((await p.locator('.form').innerText()).includes('Create an account')));assert.match(await p.locator('.form').innerText(),/account invitation/);
   assert(await p.evaluate(w=>{const h=document.querySelector('h1').getBoundingClientRect(),body=document.querySelector('.form>p').getBoundingClientRect();return document.documentElement.scrollWidth<=w+1&&h.left>=0&&h.right<=w&&body.left>=0&&body.right<=w;},width),'Long inviter heading and body stay within viewport');await shot('friend-invitation-closed');closed=false;cases++;
   await p.evaluate(()=>store.del('kinetta.friendLink'));await p.goto(base+'/signup');await p.locator('details.username-choice').waitFor();assert.equal(checks.length,0,'No checks before typing');
   const passwordField=p.locator('input[name=password]'),passwordToggle=p.locator('.password-visibility-button');
   assert.equal(await passwordToggle.count(),1,'Signup has one show-password control');
   assert.equal(await p.locator('.password-toggle').count(),0,'Signup does not add a duplicate password control');
   const eye=await passwordToggle.boundingBox();assert(eye.width>=44&&eye.height>=44,'Show-password control meets the touch target');
   await shot('signup-form');await passwordField.fill('fictional long passphrase');
   await passwordField.evaluate(n=>n.setSelectionRange(2,9,'forward'));await passwordToggle.tap();assert.equal(await passwordField.getAttribute('type'),'text');assert.equal(await passwordField.inputValue(),'fictional long passphrase');assert(await passwordField.evaluate(n=>n===document.activeElement&&n.selectionStart===2&&n.selectionEnd===9));assert.equal(await passwordToggle.getAttribute('aria-pressed'),'true');
   await passwordToggle.tap();assert.equal(await passwordField.getAttribute('type'),'password');assert.equal(await passwordToggle.getAttribute('aria-label'),'Show password');
   await p.locator('details.username-choice summary').click();const field=p.locator('input[name=login]');
   await field.fill('a');await p.waitForTimeout(100);await field.fill('available_name');await p.waitForTimeout(150);assert.equal(checks.length,0,'400ms debounce');
   await until(p,()=>document.querySelector('.username-status')?.textContent.includes('Available'),'Available feedback');assert.equal(checks.length,1);
   const identity=await field.evaluate(n=>{window.originalUsername=n;return n.getAttribute('autocomplete');});assert.equal(identity,'username');
   await field.fill('taken_name');assert.equal(await p.locator('.username-status').textContent(),'');await until(p,()=>document.querySelector('.username-status')?.textContent.includes('Try @taken_name2'),'Taken suggestion');await shot('signup-taken');cases+=2;
   await field.fill('old_choice');for(let n=0;n<100&&!oldRelease;n++)await p.waitForTimeout(20);assert(oldRelease);
   await field.fill('new_choice');await until(p,()=>document.querySelector('.username-status')?.textContent.includes('@new_choice'),'Newer availability');await oldRelease();await p.waitForTimeout(100);assert.match(await p.locator('.username-status').textContent(),/@new_choice/);assert(await field.evaluate(n=>n===window.originalUsername));cases++;
   await p.locator('input[name=name]').fill('Casey Example');await p.locator('input[name=email]').fill('casey@gmial.com');
   await p.getByRole('button',{name:'Keep my address'}).waitFor();assert.match(await p.locator('.email-address-suggestion').innerText(),/Did you mean gmail\.com\?/);await shot('signup-typo-choice');
   await p.getByRole('button',{name:'Keep my address'}).click();assert.equal(await p.locator('.email-address-suggestion').count(),0,'choosing to keep the address dismisses the suggestion');
   await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=age_ok]').check();
   await p.locator('button[type=submit]').click();await p.locator('.email-address-review').waitFor();assert.match(await p.locator('.email-address-value').innerText(),/casey@gmial\.com/);assert.equal(signups.length,0,'the final review appears before signup');
   await p.locator('[data-email-use]').click();await p.locator('#signup-continue').waitFor();assert.equal(signups.length,1);assert.equal(signups[0].email,'casey@gmial.com');assert.equal(signups[0].confirm_typo,true,'the server receives the explicit Keep my address choice');cases++;
   await p.evaluate(()=>{history.replaceState(null,'','/signup');showSignup();});await p.locator('details.username-choice').waitFor();signups.length=0;
   await p.locator('input[name=name]').fill('Casey Example');await p.locator('details.username-choice summary').click();await p.locator('input[name=login]').fill('new_choice');await p.locator('input[name=email]').fill('pending@example.com');await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=age_ok]').check();
   await p.locator('button[type=submit]').click();await p.locator('.email-address-review').waitFor();await p.locator('[data-email-use]').click();await p.locator('[data-email-reset]').waitFor();assert.equal(signups.length,1);assert.equal(signups[0].login,'new_choice');assert.equal(await p.locator('input[name=password]').inputValue(),'fictional long passphrase');assert.equal(await p.locator('#enrollment-email-exists').getAttribute('aria-live'),'polite');assert.equal(await p.locator('[data-email-login]').count(),0,'pending duplicate exposes only reset');assert.equal(await p.locator('[data-email-resend]').count(),0,'pending duplicate cannot resend');assert.equal(await p.locator('[data-email-reset]').count(),1);assert(await p.locator('[data-email-reset]').evaluate(n=>n.getBoundingClientRect().height>=44),'reset target is at least 44 px');await shot('signup-email-pending');await fit();cases++;
   await p.locator('[data-email-reset]').click();await p.locator('input[name=login]').waitFor();assert.equal(await p.locator('input[name=login]').inputValue(),'pending@example.com');assert.equal(forgot.length,0);cases++;
   await p.evaluate(()=>{history.replaceState(null,'','/signup');showSignup();});await p.locator('details.username-choice').waitFor();
   await p.locator('input[name=name]').fill('New Member');await p.locator('input[name=email]').fill('fresh@example.com');await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=age_ok]').check();
   await p.locator('button[type=submit]').click();await p.locator('.email-address-review').waitFor();await p.locator('[data-email-use]').click();await p.locator('#signup-continue').waitFor();assert.match(await p.locator('.signup-login-note').innerText(),/@fictional_casey/);assert.match(await p.locator('.signup-login-note').innerText(),/Log in with your email or @fictional_casey/);await shot('signup-confirmation');await fit();cases++;
   await p.locator('#signup-resend').click();await p.locator('#signup-resend-status').filter({hasText:'we’ve sent a new link'}).waitFor();assert.deepEqual(resends.at(-1),{login:'fresh@example.com'});
   await p.goto(base+'/');await p.locator('input[name=login]').waitFor();await p.locator('input[name=login]').fill('pending@example.com');await p.locator('input[name=password]').fill('fictional long passphrase');
   await p.locator('button[type=submit]').click();await p.locator('#l-resend').waitFor();assert.equal(await p.locator('#l-reset').count(),1);assert(await p.locator('#l-recovery a').evaluate(n=>n.getBoundingClientRect().height>=44),'reset target is at least 44 px');await shot('login-pending');await fit();cases++;
   await p.locator('#l-resend').click();await p.locator('#l-recovery-status').filter({hasText:'we’ve sent a new link'}).waitFor();assert.deepEqual(resends.at(-1),{login:'pending@example.com'});
   await p.locator('#l-reset').click();await p.locator('input[name=login]').waitFor();assert.equal(await p.locator('input[name=login]').inputValue(),'pending@example.com');cases++;
   await p.goto(base+'/');await p.locator('input[name=login]').waitFor();await p.locator('input[name=login]').fill('mail-unavailable@example.com');await p.locator('input[name=password]').fill('fictional long passphrase');
   await p.locator('button[type=submit]').click();await p.locator('.err').filter({hasText:'email is not available'}).waitFor();assert.equal(await p.locator('#l-recovery a, #l-recovery button').count(),0,'no unusable recovery links when mail is unavailable');assert.match(await p.locator('.err').innerText(),/Sign in with your @username or ask the person who runs it/);await shot('login-mail-unavailable');await fit();cases++;
   // Password-recovery navigation keeps only the validated local invitation origin.
   await p.goto(base+'/join/'+token);await p.locator('#j-login').waitFor();assert.equal(accepts.length,0);
   await p.locator('input[name=name]').fill('Invite Example');await p.locator('input[name=email]').fill('invited@example.com');await p.locator('input[name=password]').fill(password);
   await p.locator('button[type=submit]').click();await p.locator('.email-address-review').waitFor();await p.locator('[data-email-use]').click();await p.locator('input[name=age_ok][aria-invalid=true]').waitFor();assert.equal(joins.length,0,'Unticked invite sends no request');await shot('invite-age-required');
   await p.locator('input[name=age_ok]').check();await p.locator('button[type=submit]').click();await until(p,()=>document.querySelector('input[name=age_ok]')?.getAttribute('aria-invalid')==='true','Age error targets checkbox');assert.equal(joins.length,1);assert.equal(joins[0].age_ok,true);assert.equal(await p.evaluate(()=>store.get('kinetta.joinReturn')),'/join/'+token,'Failed create keeps invitation');cases+=2;
   await p.locator('#j-login').click();await p.locator('#l-forgot').click();await p.locator('#f-back').click();assert.equal(new URL(p.url()).pathname,'/join/'+token);
   await p.locator('input[name=login]').fill(login);await p.locator('input[name=password]').fill(password);await p.locator('button[type=submit]').click();await p.locator('#j-accept').waitFor();assert.equal(accepts.length,0,'Authentication alone does not accept');await shot('existing-invitation');
   await p.locator('#j-accept').click();await p.locator('#j-open').waitFor();assert.deepEqual(accepts,[{token}]);await p.locator('#j-open').click();await until(p,()=>App.pageReady,'Existing account opens after acceptance');cases+=2;
   await p.evaluate(()=>go('/me/settings'));await until(p,()=>App.pageReady&&location.pathname==='/me/settings','Settings ready');if(width===390&&theme==='light'){const download=p.waitForEvent('download');await p.locator('#m-export').click();assert.match((await download).suggestedFilename(),/\.zip$/);assert.equal(new URL(p.url()).pathname,'/me/settings');cases++;}await p.evaluate(()=>accountSheet('login'));await p.locator('#ac input').waitFor();
   assert.equal(await p.locator('#ac .username-status').textContent(),'','No edit error before typing');await p.locator('#ac input').fill('taken_name');await until(p,()=>document.querySelector('#ac .username-status')?.textContent.includes('Taken'),'Edit feedback');await shot('edit-username-taken');
   await p.locator('#ac button.primary').click();await until(p,()=>document.querySelector('#ac .username-status')?.textContent==='That username is taken','Authoritative save conflict replaces availability');assert.equal(await p.locator('#ac input').inputValue(),'taken_name');cases+=2;
   // Saving into the current same-account profile preserves a concurrent profile refresh.
   saveFailure=false;await p.locator('#ac input').fill('new_profile_name');await p.locator('#ac button.primary').click();for(let n=0;n<100&&!saveRelease;n++)await p.waitForTimeout(20);assert(saveRelease);
   await p.evaluate(()=>refreshMe({...App.me,units:'metric',bio:'Fictional refreshed profile'}));await saveRelease();await until(p,()=>App.me.login==='new_profile_name','Current profile updated');assert.equal(await p.evaluate(()=>App.me.bio),'Fictional refreshed profile');assert.equal(await p.evaluate(()=>kept('/api/me').login),'new_profile_name');cases++;
   // A removed form never starts a delayed lookup.
   await p.evaluate(()=>accountSheet('login'));await p.locator('#ac input').fill('detached_choice');const before=checks.length;await p.getByRole('dialog').locator('[data-close]').first().click();await p.waitForTimeout(500);assert.equal(checks.length,before);cases++;
   await fit();assert.deepEqual(errors,[]);console.log(`Signup uniqueness ${width}px ${theme}: debounce, stale replies, duplicate links, recovery/explicit invitation, edit conflict/refresh/detach PASS`);
  }finally{await c.close();}
 }
 // Real fresh-account journey, bound to the disposable fixture; no mail or consent/provider writes.
 const c=await browser.newContext({viewport:{width:330,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});let created=false;
 try{
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(['GET','HEAD'].includes(q.method()))return r.continue();if(u.pathname==='/api/join'){const body=q.postDataJSON();assert.equal(body.login,fixture.login);assert.equal(body.token,fixture.invite_path.split('/').pop());assert.equal(body.age_ok,true);assert.equal(body.share_default,'me');assert(!body.email);return r.continue();}return r.fulfill({status:503,json:{detail:'Real signup test: unrelated write blocked'}});});
  await p.goto(base+fixture.invite_path);await p.locator('input[name=age_ok]').waitFor();await p.locator('input[name=name]').fill('Welcome Example');await p.locator('input[name=login]').fill(fixture.login);await p.locator('input[name=password]').fill(password);await p.locator('select[name=share_default]').selectOption('me');await p.locator('input[name=age_ok]').check();
  const joined=p.waitForResponse(r=>r.url()===base+'/api/join'&&r.request().method()==='POST');await p.locator('button[type=submit]').click();assert.equal((await joined).status(),200);created=true;
  await p.locator('#wc-form').waitFor();assert.equal(new URL(p.url()).pathname,'/welcome');assert.equal(await p.evaluate(()=>store.get('kinetta.joinReturn')),null,'Redeemed invite cannot hijack welcome');
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,name+'-330-light.png'),fullPage:true});}};await shot('real-welcome-profile');
  await p.locator('#wc-next').click();if(await p.locator('[name=ai_adult]').count()){assert.equal(await p.locator('[name=ai_adult]').isChecked(),false);await p.locator('#wc-skip').click();}
  await p.locator('input[name=aud][value=me]').waitFor();assert(await p.locator('input[name=aud][value=me]').isChecked());await p.locator('#wc-next').click();await p.getByRole('button',{name:'Done',exact:true}).waitFor();await shot('real-welcome-done');await p.locator('#wc-next').click();await until(p,()=>App.pageReady&&location.pathname==='/me','Welcome Done opens Me');
  const me=await (await c.request.get(base+'/api/me')).json(),sharing=await (await c.request.get(base+'/api/sharing')).json();assert.equal(me.login,fixture.login);assert.equal(me.is_admin,false);assert.equal(me.ai_ok,false);assert.equal(me.health_ai_ok,false);assert.equal(me.garmin_ai_ok,false);assert.equal(sharing.default,'me');await shot('real-welcome-me');assert.deepEqual(errors,[]);cases++;
  console.log('Real email-free invite → create → welcome → Done → Me, private audience and Kit off PASS');
 }finally{if(created){const me=await (await c.request.get(base+'/api/me')).json();assert.equal(me.login,fixture.login);const removed=await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password}});assert.equal(removed.status(),200);assert.equal((await c.request.get(base+'/api/me')).status(),401);}await c.close();}
 }finally{await browser.close();}
 console.log(`Signup uniqueness: ${cases} rendered journey checks passed`);
})().catch(error=>{console.error(error);process.exit(1);});
