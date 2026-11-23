'use strict';
// Fictional account only. The API response is intercepted to hold, fail, or
// return controlled comment lists without creating or changing real comments.
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
  for(const theme of ['light','dark'])for(const width of [390,330])for(const state of ['loading','error','empty','newest']){
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
  console.log('Comments loading/error/empty/newest states: fictional browser checks PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
