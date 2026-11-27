// Real web/native signup + waitlist handlers; fictional 429s; no account/mail/device writes.
'use strict';
const assert=require('node:assert/strict');
const {initialize}=require('./spacing_screens.cjs');
async function run(browser,base){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Disposable server only');
 for(const native of [false,true])for(const path of ['/signup','/beta']){
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',isMobile:true,hasTouch:true});
  try{
   await c.addInitScript(initialize,{root:16,native,base,token:null,id:null});
   let message='Too many sign-up attempts from this network. Please wait and try again.';
   const sent=[],errors=[];
   await c.route('**/*',r=>{
    const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(q.method()==='GET'&&u.pathname==='/api/signup')return r.fulfill({json:{open:true,full:false}});
    if(q.method()==='GET'&&u.pathname==='/api/beta')return r.fulfill({json:{open:true}});
    if(q.method()==='GET'&&u.pathname==='/api/terms')return r.fulfill({json:{version:null}});
    if(q.method()==='GET'&&u.pathname==='/api/account/username-availability')return r.fulfill({json:{available:true}});
    if(q.method()==='POST'&&['/api/signup','/api/beta'].includes(u.pathname)){
     sent.push({path:u.pathname,body:q.postDataJSON()});
     return r.fulfill({status:429,headers:{'Retry-After':'1'},json:{detail:message}});
    }
    if(!['GET','HEAD'].includes(q.method()))throw Error('Unexpected fixture write '+u.pathname);
    return r.continue();
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+path);
   await p.locator('form [name=email]').waitFor();
   assert.equal(await p.evaluate(()=>Native.on),native);
   const values=path==='/signup'?{first_name:'Riley',last_name:'Example',login:'fictionalr',email:'fictional@example.com',password:'fictional private passphrase'}:{name:'Riley Example',email:'fictional@example.com',watch:'Fictional watch',note:'Keep this draft'};
   for(const [name,value] of Object.entries(values))await p.locator(`[name=${name}]`).fill(value);
   if(path==='/signup'){await p.locator('[name=age_ok]').check();await p.locator('[name=share_default]').selectOption('friends');}
   else await p.locator('[name=phone]').selectOption('iphone');
   for(const text of [message,'Sign-up is busy. Please try again.']){
    message=text;
    await p.locator('form button[type=submit]').click();
    const review=p.locator('[data-email-use]:visible');
    if(await review.count())await review.click();
    await p.locator('form .err').filter({hasText:text}).waitFor({timeout:5000}).catch(async error=>{throw Error(`${native?'native':'web'} ${path}: ${error.message}; ${await p.locator('form').innerText()}; sent=${sent.length}`);});
    assert.equal(await p.locator('form button[type=submit]').isEnabled(),true,'429 permits an explicit retry');
    for(const [name,value] of Object.entries(values))assert.equal(await p.locator(`[name=${name}]`).inputValue(),value,name+' retained');
    if(path==='/signup'){assert(await p.locator('[name=age_ok]').isChecked());assert.equal(await p.locator('[name=share_default]').inputValue(),'friends');}
    else assert.equal(await p.locator('[name=phone]').inputValue(),'iphone');
   }
   assert.equal(sent.length,2,'no automatic retry');
   assert(sent.every(x=>x.path==='/api'+path));
   if(native&&path==='/signup')assert(sent.every(x=>x.body.app===true),'actual native signup transport');
   assert.deepEqual(errors,[]);
  }finally{await c.unrouteAll({behavior:'wait'});await c.close();}
 }
 console.log('Enrollment 429: web/native signup+waitlist, plain limit/busy messages, retained fields/choices and explicit retries PASS');
}
module.exports={run};
if(require.main===module)(async()=>{const browser=await require('playwright').chromium.launch();try{await run(browser,process.env.KINETTA_URL||'http://localhost:8798');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
