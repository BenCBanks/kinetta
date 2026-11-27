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
  await crossTabDraftChecks(browser);
  if(process.env.KINETTA_COMMENTS_DRAFTS_ONLY)return;
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
   await open();const field=page.locator('.c-form textarea'),post=page.locator('.c-send'),text='Fictional retry '+Date.now().toString(36);
   await field.fill('Old fictional intention');
   await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreDraftStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k.startsWith('fit.comment-draft:'))throw new DOMException('Fictional quota','QuotaExceededError');return original.call(this,k,v);};});
   await field.fill(text);fault='lost';await post.click();await page.locator('.comment-retry').waitFor();assert.equal(await count(text),1);
   const quotaKey=attempts.at(-1).client_id;
   for(let n=0;n<2;n++){fault='lost';await page.locator('.comment-retry').click();await page.locator('.comment-retry').waitFor();assert.equal(attempts.at(-1).client_id,quotaKey,'quota plus repeated lost replies keeps one intention');assert.equal(await count(text),1);}
   await page.evaluate(aid=>{window.restoreDraftStorage();SocialData.draft(aid,SocialData.draft(aid));},aid);
   const key=attempts.at(-1).client_id;assert.match(key,/^[0-9a-f-]{36}$/);await shot('lost-reply','.sheet');
   await open();assert.equal(await field.inputValue(),text,'reload retains unsent text');await shot('reload','.sheet');await post.click();await page.getByText('Comment posted.',{exact:true}).waitFor();assert.equal(await count(text),1,'reload retry never duplicates');assert.equal(attempts.at(-1).client_id,key);await shot('posted','.sheet');assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('fit.comment-draft:'))),[]);
   const held='Fictional held '+Date.now().toString(36);await field.fill(held);await page.clock.install();fault='timeout';await post.click();await page.waitForFunction(()=>document.querySelector('.c-send')?.dataset.posting==='1');await page.clock.runFor(20001);await page.locator('.comment-retry').waitFor();assert.equal(await field.inputValue(),held);assert(await post.isEnabled());await shot('comment-timeout','.sheet');release();release=null;await page.locator('.comment-retry').click();await page.getByText('Comment posted.',{exact:true}).waitFor();assert.equal(await count(held),1);await page.clock.resume();
   const offline='Fictional draft '+Date.now().toString(36);await field.fill(offline);fault='503';await post.click();await page.locator('.comment-retry').waitFor();await open();assert.equal(await field.inputValue(),offline);await page.locator('.sheet').evaluate(n=>n.requestClose());await page.locator('.scrim').waitFor({state:'detached'});await page.evaluate(()=>{App.me=null;App.pageReady=false;App.page=null;history.replaceState(null,'','/login');showLogin();});assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('fit.comment-draft:'))),[],'sign-in clears prior draft');
   const login=page.locator('.login input[name=login]'),password=page.locator('.login input[name=password]'),button=page.locator('.login button[type=submit]');await login.fill('zz_test_inline_owner');await password.fill(pw);let loginCalls=0;
   await page.route('**/api/login',async route=>{loginCalls++;if(loginCalls===1){await new Promise(r=>release=r);return route.abort();}return route.continue();});
   await button.click();await button.evaluate(n=>{n.form.requestSubmit();n.form.requestSubmit();});await page.clock.runFor(20001);await page.getByText('Sign-in is temporarily unavailable. Please try again.',{exact:true}).waitFor();assert(await button.isEnabled());assert.equal(await login.inputValue(),'zz_test_inline_owner');assert.equal(await password.inputValue(),pw);await shot('login-timeout','.login form');release();release=null;await page.clock.resume();await button.click();await page.waitForFunction(()=>App.me&&App.pageReady);assert.equal(loginCalls,2);assert.deepEqual(errors,[]);
   // Clean the fictional comments while this test session is still authenticated.
   for(const id of created)assert.equal((await context.request.delete(base+'/api/comments/'+id,{headers:{Origin:base,'Content-Type':'application/json',...(native?{Authorization:'Bearer '+token}:{})},data:{}})).status(),200);created.length=0;
   // Two real tabs, plus a suspended-tab stand-in with all clear events blocked.
   const peers=[];
   try{
    for(const sleeping of [false,true]){
     const peer=await context.newPage();peer.on('pageerror',e=>errors.push(e.message));peers.push(peer);
     if(sleeping)await peer.addInitScript(()=>{window.BroadcastChannel=undefined;window.addEventListener('storage',e=>e.stopImmediatePropagation(),{capture:true});});
     await peer.goto(base+'/me/activities');await peer.waitForFunction(()=>App.pageReady);
     await peer.locator('article.post').filter({hasText:'Fictional empty run'}).locator('.activity-comments').click();
     await peer.locator('.c-form textarea').fill('Fictional stale tab');
    }
    await page.evaluate(async()=>{
     await api('/api/logout',json('POST',{}));
     const original=Storage.prototype.setItem;
     Storage.prototype.setItem=function(k,v){if(k==='fit.comment-drafts-generation')throw new DOMException('Fictional quota','QuotaExceededError');return original.call(this,k,v);};
     try{App.me=null;showLogin();}finally{Storage.prototype.setItem=original;}
    });
    await peers[0].waitForFunction(()=>document.querySelector('.c-form textarea')?.value==='');
    for(const peer of peers){assert.equal(await peer.evaluate(aid=>SocialData.draftRequest(aid,'Never rewrite after logout'),aid),null);assert.deepEqual(await peer.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('fit.comment-draft:'))),[]);assert(await peer.locator('.c-send').isDisabled());}
   }finally{for(const peer of peers)await peer.close();}
   assert.deepEqual(errors,[]);
   console.log(`Durable comments/quota/lost-reply/reload + cross-tab logout/quota fence + sign-in timeout/retry ${native?'bridge':'web'} PASS`);
  }finally{
   release?.();for(const id of created)await context.request.delete(base+'/api/comments/'+id,{headers:{Origin:base,'Content-Type':'application/json',...(native?{Authorization:'Bearer '+token}:{})},data:{}});await context.close();
  }
 }
}

// Real independent browser tabs, actual draft coordinator, fictional stand-in shell.
// No API/provider calls: storage behaviour is identical on the web and bridge.
async function crossTabDraftChecks(browser){
 const source=fs.readFileSync('app/static/social-data.js','utf8');
 const clear=fs.readFileSync('app/static/app.js','utf8').split('function clearCommentDrafts() {')[1].split('\nlet pendingDishEntry')[0];
 for(const native of [false,true]){
  const context=await browser.newContext({serviceWorkers:'block'});
  try{
   await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fictional draft storage check</title>'}):route.abort());
   await context.addInitScript(`window.App={me:{id:1}};window.Native={base:${JSON.stringify(native?'https://bridge.example.test':'')}};window.readOwner=()=> 'fictional-session';window.newId=()=>crypto.randomUUID();`+source+'\nwindow.SocialData=SocialData;\nfunction clearCommentDrafts() {'+clear+'\nwindow.clearCommentDrafts=clearCommentDrafts;');
   const one=await context.newPage(),two=await context.newPage();
   await one.goto('http://drafts.localhost/');await two.goto('http://drafts.localhost/');
   await one.evaluate(()=>SocialData.draft(101));await two.evaluate(()=>SocialData.draft(102));
   const a=await one.evaluate(()=>SocialData.draftRequest(101,'Fictional draft A'));
   const b=await two.evaluate(()=>SocialData.draftRequest(102,'Fictional draft B'));
   for(const page of [one,two]){
    await page.reload();
    assert.deepEqual(await page.evaluate(()=>[SocialData.draft(101),SocialData.draft(102)]),['Fictional draft A','Fictional draft B']);
    assert.deepEqual(await page.evaluate(()=>[SocialData.draftRequest(101,'Fictional draft A'),SocialData.draftRequest(102,'Fictional draft B')]),[a,b]);
   }
   await one.evaluate(()=>SocialData.draft(101,''));await two.evaluate(()=>SocialData.draft(102,'Fictional revised B'));
   await one.reload();assert.deepEqual(await one.evaluate(()=>[SocialData.draft(101),SocialData.draft(102)]),['','Fictional revised B'],'stale memory cannot restore another activity cleared elsewhere');
   const pending=await one.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('Fictional quota');};try{return SocialData.draftRequest(103,'Fictional pending A');}finally{Storage.prototype.setItem=set;}});
   await two.evaluate(()=>SocialData.draft(104,'Fictional separate B'));await one.evaluate(()=>SocialData.draftRequest(103,'Fictional pending A'));
   await two.reload();assert.deepEqual(await two.evaluate(()=>[SocialData.draftRequest(103,'Fictional pending A'),SocialData.draft(104)]),[pending,'Fictional separate B']);
   // Concurrent calls from distinct real tabs; neither operation writes the peer's key.
   for(let n=0;n<12;n++)await Promise.all([
    one.evaluate(n=>SocialData.draft(201,'Concurrent A '+n),n),
    two.evaluate(n=>SocialData.draft(202,'Concurrent B '+n),n)
   ]);
   await one.reload();await two.reload();
   assert.deepEqual(await one.evaluate(()=>[SocialData.draft(201),SocialData.draft(202)]),['Concurrent A 11','Concurrent B 11']);
   // A's delete overlaps B's edit, including a stale in-memory copy of A in B's tab.
   await Promise.all([one.evaluate(()=>SocialData.draft(201,'')),two.evaluate(()=>SocialData.draft(202,'B while A deleted'))]);
   await one.reload();await two.reload();
   assert.deepEqual(await two.evaluate(()=>[SocialData.draft(201),SocialData.draft(202)]),['','B while A deleted']);
   // Suppress clear events so the stale tab must use the synchronous generation fence.
   await two.evaluate(()=>{window.addEventListener('storage',e=>e.stopImmediatePropagation(),{capture:true});});
   await one.evaluate(()=>clearCommentDrafts());
   assert.equal(await two.evaluate(()=>SocialData.draftRequest(102,'Must not restore after sign-out')),null);
   assert.deepEqual(await two.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('fit.comment-draft:'))),[]);
   console.log(`Two-tab per-activity drafts/reload/clear/quota/generation ${native?'bridge':'web'} PASS`);
  }finally{await context.close();}
 }
}
