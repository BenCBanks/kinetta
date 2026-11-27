'use strict';
// Fictional account only. The API response is intercepted to hold, fail, or
// return controlled lists. Retry cases create and clean up fictional comments.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_COMMENTS_STATES_SHOTS,pw='green teapot on the hill';
const wait=async(page,fn,label)=>{
 for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}
 const state=await page.evaluate(()=>({skeletonRows:document.querySelectorAll('.comment-skeleton-row').length,busy:document.querySelector('.comments')?.getAttribute('aria-busy'),body:document.body.innerText.slice(-180)}));
 throw Error(label+' '+JSON.stringify(state));
};
const waitForCount=async(page,locator,count,label)=>{for(let i=0;i<150;i++){if(await locator.count()===count)return;await page.waitForTimeout(100);}throw Error(label+`: expected ${count}, got ${await locator.count()}`);};
const commentList=Array.from({length:16},(_,i)=>({id:9000+i,login:`fictional_${i}`,name:`Fictional runner ${i+1}`,text:`Fictional comment ${i+1} for a long activity thread.`,created:new Date(Date.UTC(2026,10,22,12,i)).toISOString(),can_delete:false}));
(async()=>{
 const browser=await chromium.launch();
 try{
  if(!process.env.KINETTA_COMMENTS_RETRY_ONLY)for(const theme of ['light','dark'])for(const width of [390,330])for(const state of ['loading','error','empty','newest']){
   if(process.env.KINETTA_COMMENTS_STATE_CASE&&!process.env.KINETTA_COMMENTS_STATE_CASE.split(',').includes(`${state}-${width}-${theme}`))continue;
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
   try{
    assert.equal((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_inline_owner',password:pw}})).status(),200);
    const activities=await(await context.request.get(base+'/api/activities?limit=100')).json(),activity=activities.find(row=>row.name==='Fictional empty run');assert(activity,'Fictional owner activity exists');
    const social=await(await context.request.get(base+`/api/activities/${activity.id}/social`)).json();
    if(state==='empty')social.comments=[];
    if(state==='newest'||state==='error')social.comments=commentList;
    let attempt=0,release,commentsOpen=false;
    const page=await context.newPage();
    await page.route(`**/api/activities/${activity.id}/social`,async route=>{
     if(!commentsOpen)return route.continue();
     attempt++;
     if(state==='loading'&&attempt===1)await new Promise(resolve=>release=resolve);
     if(state==='error'&&attempt===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Fictional test failure'})});
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(social)});
    });
    await page.goto(base+'/me/activities');await page.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady);
    const card=page.locator('article.post').filter({hasText:'Fictional empty run'});await card.waitFor();
    await page.evaluate(()=>{SocialData.invalidate();SocialData.peek=()=>null;SocialData.remember=()=>{};});
    commentsOpen=true;
    await card.locator('.activity-comments').click();const sheet=page.locator('.scrim:has(.social-sheet)');await sheet.waitFor();
    const list=sheet.locator('.comments'),status=sheet.locator('.social-read-status');
    if(state==='loading'){
     const skeletonRows=list.locator('.comments-skeleton .comment-skeleton-row');await waitForCount(page,skeletonRows,3,'Three comment skeleton rows render');assert.equal(await list.getAttribute('aria-busy'),'true');
     if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`comments-loading-${width}-${theme}.png`),animations:'disabled'});}
     release();await wait(page,()=>document.querySelector('.comments')?.getAttribute('aria-busy')==='false','Loading comments resolve');
    }else if(state==='error'){
     await status.locator('[data-retry]').waitFor();assert.equal((await status.innerText()).replace(/\s+/g,' ').trim(),"Couldn't load comments Retry");
     if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`comments-error-${width}-${theme}.png`),animations:'disabled'});}
     await status.locator('[data-retry]').click();await wait(page,()=>document.querySelector('.comments')?.getAttribute('aria-busy')==='false'&&document.querySelector('.comment[data-comment-id]'),'Retry loads comments');
    }else if(state==='empty'){
     await sheet.getByText('No comments yet',{exact:true}).waitFor();assert.equal(await list.locator('.comment[data-comment-id]').count(),0);assert.equal(await list.getAttribute('aria-busy'),'false');
     await sheet.locator('.c-quick').waitFor({state:'visible'});await sheet.locator('.c-form textarea').waitFor({state:'visible'});
     if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`comments-empty-${width}-${theme}.png`),animations:'disabled'});}
    }else{
     await list.locator('.comment[data-comment-id]').last().waitFor();const position=await list.evaluate(n=>({top:n.scrollTop,client:n.clientHeight,height:n.scrollHeight,last:n.lastElementChild?.dataset.commentId}));assert.equal(position.last,'9015');assert(position.top+position.client+1>=position.height,`List opens at newest comment: ${JSON.stringify(position)}`);
     if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`comments-newest-${width}-${theme}.png`),animations:'disabled'});}
    }
    assert.equal(await sheet.locator('header h2').innerText(),'Comments');assert.equal(await sheet.locator('.social-reactions').count(),0,'Comments sheet has no reaction row');
    console.log(`Comments ${state} ${width}px ${theme}: PASS`);
   }finally{await context.close();}
  }
  await retryChecks(browser);
  console.log('Comments loading/error/empty/newest and durable retry states: fictional browser checks PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

async function retryChecks(browser){
 for(const native of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const created=[];let release,token;
  try{
   const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_inline_owner',password:pw,app:native}});assert.equal(signed.status(),200);
   token=(await signed.json()).token;
   if(native)await context.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false,Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});
   const rows=await(await context.request.get(base+'/api/activities?limit=100',{headers:{...(native?{Authorization:'Bearer '+token}:{})}})).json(),aid=rows.find(r=>r.name==='Fictional empty run').id,url=base+`/api/activities/${aid}/comments`;
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let fault=null,attempts=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==new URL(base).origin)return route.abort();return route.continue();});
   await page.route(url,async route=>{
    if(route.request().method()!=='POST')return route.continue();attempts.push(route.request().postDataJSON());
    if(fault==='lost'){fault=null;const saved=await route.fetch();assert.equal(saved.status(),200);return route.abort();}
    if(fault==='timeout'){fault=null;await new Promise(r=>release=r);return route.abort();}
    if(fault==='503'){fault=null;return route.fulfill({status:503,json:{detail:'Fictional outage'}});}
    return route.continue();
   });
   const open=async()=>{await page.goto(base+'/me/activities');await page.waitForFunction(()=>App.pageReady);await page.locator('article.post').filter({hasText:'Fictional empty run'}).locator('.activity-comments').click();await page.locator('.c-form textarea').waitFor();};
   const count=async text=>{const social=await(await context.request.get(base+`/api/activities/${aid}/social`,{headers:{...(native?{Authorization:'Bearer '+token}:{})}})).json();const matches=social.comments.filter(r=>r.text===text);for(const row of matches)if(!created.includes(row.id))created.push(row.id);return matches.length;};
   const shot=async(name,selector)=>{if(!out)return;fs.mkdirSync(out,{recursive:true});for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.locator(selector).screenshot({path:path.join(out,`${native?'bridge':'web'}-${name}-${theme}.png`),animations:'disabled'});}await page.emulateMedia({colorScheme:'light'});};
   await open();const field=page.locator('.c-form textarea'),post=page.locator('.c-send'),text='Fictional retry '+Date.now().toString(36);await field.fill(text);fault='lost';await post.click();await page.locator('.comment-retry').waitFor();assert.equal(await count(text),1);
   const key=attempts.at(-1).client_id;assert.match(key,/^[0-9a-f-]{36}$/);await shot('lost-reply','.sheet');
   await open();assert.equal(await field.inputValue(),text,'reload retains unsent text');await shot('reload','.sheet');await post.click();await page.getByText('Comment posted.',{exact:true}).waitFor();assert.equal(await count(text),1,'reload retry never duplicates');assert.equal(attempts.at(-1).client_id,key);await shot('posted','.sheet');assert.equal(await page.evaluate(()=>localStorage.getItem('fit.comment-drafts')),null);
   const held='Fictional held '+Date.now().toString(36);await field.fill(held);await page.clock.install();fault='timeout';await post.click();await page.waitForFunction(()=>document.querySelector('.c-send')?.dataset.posting==='1');await page.clock.runFor(20001);await page.locator('.comment-retry').waitFor();assert.equal(await field.inputValue(),held);assert(await post.isEnabled());await shot('comment-timeout','.sheet');release();release=null;await page.locator('.comment-retry').click();await page.getByText('Comment posted.',{exact:true}).waitFor();assert.equal(await count(held),1);await page.clock.resume();
   const offline='Fictional draft '+Date.now().toString(36);await field.fill(offline);fault='503';await post.click();await page.locator('.comment-retry').waitFor();await open();assert.equal(await field.inputValue(),offline);await page.locator('.sheet').evaluate(n=>n.requestClose());await page.locator('.scrim').waitFor({state:'detached'});await page.evaluate(()=>{App.me=null;App.pageReady=false;App.page=null;history.replaceState(null,'','/login');showLogin();});assert.equal(await page.evaluate(()=>localStorage.getItem('fit.comment-drafts')),null,'sign-in clears prior draft');
   const login=page.locator('.login input[name=login]'),password=page.locator('.login input[name=password]'),button=page.locator('.login button[type=submit]');await login.fill('zz_test_inline_owner');await password.fill(pw);let loginCalls=0;
   await page.route('**/api/login',async route=>{loginCalls++;if(loginCalls===1){await new Promise(r=>release=r);return route.abort();}return route.continue();});
   await button.click();await button.evaluate(n=>{n.form.requestSubmit();n.form.requestSubmit();});await page.clock.runFor(20001);await page.getByText('Sign-in is temporarily unavailable. Please try again.',{exact:true}).waitFor();assert(await button.isEnabled());assert.equal(await login.inputValue(),'zz_test_inline_owner');assert.equal(await password.inputValue(),pw);await shot('login-timeout','.login form');release();release=null;await page.clock.resume();await button.click();await page.waitForFunction(()=>App.me&&App.pageReady);assert.equal(loginCalls,2);assert.deepEqual(errors,[]);
   console.log(`Durable comments/lost-reply/reload/timeout + sign-in timeout/retry ${native?'bridge':'web'} PASS`);
  }finally{
   release?.();for(const id of created)await context.request.delete(base+'/api/comments/'+id,{headers:{Origin:base,...(native?{Authorization:'Bearer '+token}:{})}});await context.close();
  }
 }
}
