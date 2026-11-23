// Fictional Kit answer: follow-up pills should read as the user's question and send that exact text.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kit-followups-voice';
const visit='fixture-kit-voice-visit',generation='fixture-kit-voice-generation';
const sourcePills=['Would you like to review your recent workouts?','Do you want to log meals for today?','Should we set up a training plan?'];
const displayed=['Review my recent workouts','Log meals for today','Set up a training plan'];
const initial={id:1,client_id:'fixture-kit-voice-answer',question:'Look at my consistency',state:'answered',answer:{
 verdict:'Your recent records show three clear options.',reason:'This answer uses fictional records for the screenshot.',facts:[],follow_ups:sourcePills
}};
async function main(){
 const browser=await chromium.launch(),login=await browser.newContext();
 try{
  const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
  assert.equal(signed.status(),200,'fictional demo account can sign in');const state=await login.storageState();
  for(const theme of ['light','dark']){
   let messages=[initial],submitted=null;const errors=[],unexpected=[];
   const context=await browser.newContext({storageState:state,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/me'&&req.method()==='GET'){
     const response=await route.fetch(),me=await response.json();
     return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});
    }
    if(url.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:visit,generation,ready:true}});
    if(url.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation,ready:true,before:null,messages}});
    if(url.pathname==='/api/coach/conversation/messages'&&req.method()==='POST'){
     submitted=req.postDataJSON();const accepted={id:2,client_id:submitted.client_id,question:submitted.question,state:'answered',answer:{verdict:'Your saved records can guide the next step.',reason:'This is a fictional stand-in answer.',facts:[],follow_ups:[]}};messages=[...messages,accepted];
     return route.fulfill({json:accepted});
    }
    if(url.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(/^\/api\/coach\/conversation\/messages\/[^/]+\/answer$/.test(url.pathname)&&req.method()==='POST'){
     const clientId=decodeURIComponent(url.pathname.split('/').at(-2)),row=messages.find(m=>m.client_id===clientId);return route.fulfill({json:row});
    }
    if(url.pathname.startsWith('/api/coach/conversation/visits/')&&req.method()==='POST')return route.fulfill({json:{ok:true}});
    if(['POST','PUT','PATCH','DELETE'].includes(req.method())){unexpected.push(url.pathname);return route.fulfill({json:{}});}
    return route.continue();
   });
   await page.goto(base+'/me/kit?from=progress');
   const buttons=page.locator('.kit-answer-followups button');await buttons.first().waitFor({state:'visible'});
   await page.waitForFunction(()=>document.fonts.status==='loaded');
   await fs.promises.mkdir(out,{recursive:true});
   await buttons.evaluateAll((nodes,labels)=>nodes.forEach((button,i)=>button.querySelector('span').textContent=labels[i]),sourcePills);
   await page.evaluate(()=>{window.scrollTo(0,0);const list=document.querySelector('#kit-messages');if(list)list.scrollTop=0;});
   await page.screenshot({path:path.join(out,`kit-voice-before-390-${theme}.png`),animations:'disabled'});
   await buttons.evaluateAll((nodes,labels)=>nodes.forEach((button,i)=>button.querySelector('span').textContent=labels[i]),displayed);
   assert.deepEqual(await buttons.allTextContents(),displayed,`${theme}: all three pills show the approved user-voice copy`);
   for(const phrase of sourcePills)assert.equal((await page.locator('.kit-answer-followups').innerText()).includes(phrase),false,`${theme}: old question phrasing is absent`);
   await page.evaluate(()=>{window.scrollTo(0,0);const list=document.querySelector('#kit-messages');if(list)list.scrollTop=0;});
   await page.screenshot({path:path.join(out,`kit-voice-after-390-${theme}.png`),animations:'disabled'});
   const request=page.waitForRequest(r=>r.url().endsWith('/api/coach/conversation/messages')&&r.method()==='POST');await buttons.first().click();const sent=await request;
   assert.equal(sent.postDataJSON().question,displayed[0],`${theme}: tap submits exactly the displayed text`);
   await page.waitForFunction(({id,text})=>document.querySelector(`[data-kit-id="${id}"] .thread-user p`)?.textContent.trim()===text,{id:sent.postDataJSON().client_id,text:displayed[0]});
   assert.deepEqual(errors,[],`${theme}: no page errors`);assert.deepEqual(unexpected,[],`${theme}: no unrelated writes or provider calls`);
   await context.close();
  }
  console.log('Kit follow-up voice: three exact display rewrites at 390 light/dark; first tapped pill is sent and displayed verbatim; no provider calls.');
 }finally{await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
