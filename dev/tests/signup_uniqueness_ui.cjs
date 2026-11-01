'use strict';
// Browser plugin unavailable. Fictional account; availability and writes are controlled stand-ins.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const login='zz_test_username_ui',password='green teapot on the hill',token='fictional_signup_invitation';
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch();let cases=0;
 try{for(const theme of ['light','dark'])for(const width of [390,330]){
  if(process.env.THEME&&process.env.THEME!==theme||process.env.WIDTH&&Number(process.env.WIDTH)!==width)continue;
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
  try{
   const p=await c.newPage(),errors=[],checks=[],signups=[],accepts=[];let oldRelease=null,saveRelease=null,saveFailure=true;
   p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource'))errors.push(m.text());});
   await c.route('**/*',async r=>{
    const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/signup'&&request.method()==='GET')return r.fulfill({json:{open:true,full:false}});
    if(u.pathname==='/api/account/username-availability'){
     const value=u.searchParams.get('login');checks.push(value);
     if(value==='old_choice')return new Promise(resolve=>{oldRelease=()=>r.fulfill({json:{login:value,available:false,reason:'taken',suggestion:'old_choice2'}}).catch(()=>{}).then(resolve);});
     return r.fulfill({json:value==='taken_name'?{login:value,available:false,reason:'taken',suggestion:'taken_name2'}:value==='admin'?{login:value,available:false,reason:'reserved',message:'That username is reserved. Choose another.'}:{login:value.trim().toLowerCase(),available:true}});
    }
    if(u.pathname==='/api/signup'&&request.method()==='POST'){signups.push(request.postDataJSON());return r.fulfill({status:409,json:{detail:{code:'email_exists',message:"There's already a Kinetta account with this email"}}});}
    if(u.pathname==='/api/login'){
     const body=request.postDataJSON();assert.equal(body.login,login);assert.equal(body.password,password);
     const response=await c.request.post(base+'/api/login',{headers:{Origin:base},data:body});return r.fulfill({response});
    }
    if(u.pathname==='/api/join/'+token)return r.fulfill({json:{email:true,inviter:'@casey',card:null,challenge:null}});
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
   await p.goto(base+'/signup');await p.locator('details.username-choice').waitFor();assert.equal(checks.length,0,'No checks before typing');
   await p.locator('details.username-choice summary').click();const field=p.locator('input[name=login]');
   await field.fill('a');await p.waitForTimeout(100);await field.fill('available_name');await p.waitForTimeout(150);assert.equal(checks.length,0,'400ms debounce');
   await until(p,()=>document.querySelector('.username-status')?.textContent.includes('Available'),'Available feedback');assert.equal(checks.length,1);
   const identity=await field.evaluate(n=>{window.originalUsername=n;return n.getAttribute('autocomplete');});assert.equal(identity,'username');
   await field.fill('taken_name');assert.equal(await p.locator('.username-status').textContent(),'');await until(p,()=>document.querySelector('.username-status')?.textContent.includes('Try @taken_name2'),'Taken suggestion');await shot('signup-taken');cases+=2;
   await field.fill('old_choice');for(let n=0;n<100&&!oldRelease;n++)await p.waitForTimeout(20);assert(oldRelease);
   await field.fill('new_choice');await until(p,()=>document.querySelector('.username-status')?.textContent.includes('@new_choice'),'Newer availability');await oldRelease();await p.waitForTimeout(100);assert.match(await p.locator('.username-status').textContent(),/@new_choice/);assert(await field.evaluate(n=>n===window.originalUsername));cases++;
   await p.locator('input[name=name]').fill('Casey Example');await p.locator('input[name=email]').fill('registered@example.invalid');await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=age_ok]').check();
   await p.locator('button[type=submit]').click();await p.locator('[data-email-login]').waitFor();assert.equal(signups.length,1);assert.equal(signups[0].login,'new_choice');assert.equal(await p.locator('input[name=password]').inputValue(),'fictional long passphrase');assert.equal(await p.locator('#enrollment-email-exists').getAttribute('aria-live'),'polite');await shot('signup-email-exists');await fit();cases++;
   await p.locator('[data-email-login]').click();await p.locator('input[name=login]').waitFor();assert.equal(await p.locator('input[name=login]').inputValue(),'registered@example.invalid');cases++;
   // Password-recovery navigation keeps only the validated local invitation origin.
   await p.goto(base+'/join/'+token);await p.locator('#j-login').waitFor();assert.equal(accepts.length,0);await p.locator('#j-login').click();await p.locator('#l-forgot').click();await p.locator('#f-back').click();assert.equal(new URL(p.url()).pathname,'/join/'+token);
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
 }}finally{await browser.close();}
 console.log(`Signup uniqueness: ${cases} rendered journey checks passed`);
})().catch(error=>{console.error(error);process.exit(1);});
