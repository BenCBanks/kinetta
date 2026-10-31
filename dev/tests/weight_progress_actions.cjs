'use strict';
// Delayed real writes on one fictional account; every unrelated write is blocked.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798',foodOnly=process.env.FOOD_ONLY==='1';
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label+' '+JSON.stringify(await p.evaluate(()=>({weight:App.me.weight_kg,height:App.me.height_cm,toast:document.querySelector('#toast')?.textContent}))));};
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
   try{
    assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_weight_actions',password:'green teapot on the hill'}})).status(),200);
    const today=new Date().toISOString().slice(0,10);await c.request.delete(base+'/api/food/weights/'+today,{headers:{Origin:base}});
    const p=await c.newPage(),errors=[];let hold='',release,seen=false,profileWrite,holdProfile=false,profileRead,profileRelease;
    p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',async route=>{
     const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();
     if(holdProfile&&r.method()==='GET'&&u.pathname==='/api/me'){holdProfile=false;const response=await route.fetch();profileRead=true;await new Promise(resolve=>profileRelease=resolve);return route.fulfill({response});}
     if(r.method()===hold&&u.pathname.startsWith('/api/food/weights')){seen=true;await new Promise(resolve=>release=resolve);}
     if(r.method()==='PUT'&&u.pathname==='/api/profile')profileWrite=r.postDataJSON();
     if(!['GET','HEAD'].includes(r.method())&&!((r.method()==='PUT'&&['/api/food/weights','/api/profile'].includes(u.pathname))||(r.method()==='DELETE'&&u.pathname.startsWith('/api/food/weights/'))))return route.fulfill({json:{}});
     return route.continue();
    });
    await p.goto(base+'/progress/weight');await p.locator('.wform input').waitFor();
    hold='PUT';await p.locator('.wform input').fill('170');await p.locator('.wform button').click();
    for(let n=0;n<100&&!seen;n++)await p.waitForTimeout(50);assert(seen,'PUT held');await p.evaluate(()=>go('/progress'));release();hold='';
    await until(p,()=>Math.abs(App.me.weight_kg-170/2.20462)<.01,'Same-owner save refreshes after leaving Weight');
    if(!foodOnly)await until(p,()=>/170/.test(document.querySelector('[data-progress-feature=weight]')?.textContent||''),'Progress tile has the saved weigh-in');
    assert(await p.evaluate(()=>kept('/api/me').weight_kg===App.me.weight_kg),'Offline profile is updated');
    if(foodOnly)await p.evaluate(()=>go('/progress/weight'));else await p.locator('[data-progress-feature=weight]').click();await p.locator(`button[data-del="${today}"]`).waitFor();
    seen=false;hold='DELETE';await p.locator(`button[data-del="${today}"]`).click();for(let n=0;n<100&&!seen;n++)await p.waitForTimeout(50);assert(seen,'DELETE held');
    await p.evaluate(()=>go('/me/settings'));release();hold='';await until(p,()=>Math.abs(App.me.weight_kg-75)<.01,'Delete refreshes after leaving Weight');
    await p.locator('#m-body').click();assert.equal(await p.locator('#m-form input[name=weight]').inputValue(),'165.3');await p.locator('.sheet header button[data-close]').click();
    if(foodOnly){assert.deepEqual(errors,[]);console.log('Weight Food-stage '+theme+': delayed real PUT/DELETE after navigation refresh/persist current profile PASS');continue;}
    // An unchanged stale weight field must not overwrite a later saved weigh-in.
    await p.evaluate(()=>go('/progress/weight'));await p.locator('.wform input').waitFor();seen=false;hold='PUT';
    await p.locator('.wform input').fill('172');await p.locator('.wform button').click();for(let n=0;n<100&&!seen;n++)await p.waitForTimeout(50);assert(seen);
    await p.evaluate(()=>go('/me/settings'));await p.locator('#m-body').click();await p.locator('#m-form input[name=height]').fill('6 1');release();hold='';
    await until(p,()=>Math.abs(App.me.weight_kg-172/2.20462)<.01,'Background save refreshes profile without replacing a draft');assert.equal(await p.locator('#m-form input[name=height]').inputValue(),'6 1');
    await p.locator('#m-form button[type=submit],#m-form button.primary').click();await until(p,()=>!document.querySelector('#m-form'),'Body settings saved');
    assert(profileWrite&&!Object.hasOwn(profileWrite,'weight_kg'),'Unchanged stale weight is omitted from settings save');
    const me=await (await c.request.get(base+'/api/me')).json();assert(Math.abs(me.weight_kg-172/2.20462)<.01);assert.equal(me.height_cm,185.42);
    // A stale full /me read must not roll back a newer Body save.
    await p.evaluate(()=>go('/progress/weight'));await p.locator('.wform input').waitFor();seen=false;hold='PUT';await p.locator('.wform input').fill('173');await p.locator('.wform button').click();for(let n=0;n<100&&!seen;n++)await p.waitForTimeout(50);assert(seen);
    await p.evaluate(()=>go('/me/settings'));await p.locator('#m-body').click();await p.locator('#m-form input[name=height]').fill('5 9');holdProfile=true;release();hold='';for(let n=0;n<100&&!profileRead;n++)await p.waitForTimeout(50);assert(profileRead,'Older profile response held');
    await p.locator('#m-form button.primary').click();await until(p,()=>Math.abs(App.me.height_cm-175.26)<.001,'Body saved before old response');profileRelease();await until(p,()=>Math.abs(App.me.weight_kg-173/2.20462)<.01,'Late weight read completes');assert(Math.abs(await p.evaluate(()=>App.me.height_cm)-175.26)<.001,'Newer height survives older profile');
    // A deliberate Body weight edit also outranks an earlier weight-refresh snapshot.
    await p.evaluate(()=>go('/progress/weight'));await p.locator('.wform input').waitFor();seen=false;profileRead=false;hold='PUT';await p.locator('.wform input').fill('175');await p.locator('.wform button').click();for(let n=0;n<100&&!seen;n++)await p.waitForTimeout(50);assert(seen);await p.evaluate(()=>go('/me/settings'));await p.locator('#m-body').click();await p.locator('#m-form input[name=weight]').fill('176');holdProfile=true;release();hold='';for(let n=0;n<100&&!profileRead;n++)await p.waitForTimeout(50);assert(profileRead);await p.locator('#m-form button.primary').click();await until(p,()=>Math.abs(App.me.weight_kg-176/2.20462)<.01,'Intentional Body weight saved');const oldReadDone=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/me');profileRelease();await oldReadDone;await p.waitForTimeout(100);assert(Math.abs(await p.evaluate(()=>App.me.weight_kg)-176/2.20462)<.01,'Newer Body weight survives old read');
    // Exercise actual normal-motion close; its retiring scrim must not suppress refresh.
    await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('#m-body').click();await p.getByRole('button',{name:'Log weight',exact:true}).click();await p.locator('#quick-weight input').fill('174');await p.locator('#quick-weight button.primary').click();await until(p,()=>Math.abs(App.me.weight_kg-174/2.20462)<.01&&App.pageReady,'Quick log profile/Settings ready');await until(p,()=>!document.querySelector('.scrim:not(.is-closing)'),'Quick log closes');await p.locator('#m-body').click();assert.equal(await p.locator('#m-form input[name=weight]').inputValue(),'174.0');await p.locator('.sheet:not(.is-closing) header [data-close]').last().click();assert.deepEqual(errors,[]);
    console.log('Weight actions '+theme+': delayed PUT/DELETE across navigation, fresh persisted profile, protected body draft and no stale-weight overwrite PASS');
   }finally{await c.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
