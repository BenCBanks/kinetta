// Fictional Kit follow-up: the user-style bubble sends exactly its visible rewrite.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const visit='fixture-kit-voice-visit',generation='fixture-kit-voice-generation';
const sourceReplies=[
 'Would you like to review your latest completed workouts from this training block and compare how they fit your plan?',
 'Are your legs feeling heavy or fatigued today?',
 'Do you feel ready to train again?'
];
const displayedReplies=[
 'Review my latest completed workouts from this training block and compare how they fit my plan',
 'My legs feel heavy today'
];
const initial={id:1,client_id:'fixture-kit-voice-answer',question:'Look at my consistency',state:'answered',answer:{
 verdict:'Your recent records show two options.',reason:'This fixture uses fictional training facts.',facts:[],follow_ups:sourceReplies
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
   const buttons=page.locator('.kit-suggested-reply');await buttons.first().waitFor({state:'visible'});
   assert.equal(await buttons.count(),2,`${theme}: no more than two replies are shown`);
   assert.deepEqual(await buttons.allTextContents().then(rows=>rows.map(s=>s.trim())),displayedReplies,`${theme}: only safe user-voice rewrites remain`);
   assert.equal(await buttons.first().getAttribute('aria-label'),'Send: '+displayedReplies[0],`${theme}: each bubble names its send action`);
   for(const phrase of sourceReplies)assert.equal((await page.locator('.kit-suggested-replies').innerText()).includes(phrase),false,`${theme}: original question wording is hidden`);
   const request=page.waitForRequest(r=>r.url().endsWith('/api/coach/conversation/messages')&&r.method()==='POST');await buttons.first().click();const sent=await request;
   assert.equal(sent.postDataJSON().question,displayedReplies[0],`${theme}: tap submits exactly the displayed text`);
   await page.waitForFunction(({id,text})=>document.querySelector(`[data-kit-id="${id}"] .thread-user p`)?.textContent.trim()===text,{id:sent.postDataJSON().client_id,text:displayedReplies[0]});
   await page.waitForFunction(()=>document.querySelectorAll('.kit-suggested-reply').length===0,`${theme}: suggestions disappear after send`);
   assert.deepEqual(errors,[],`${theme}: no page errors`);assert.deepEqual(unexpected,[],`${theme}: no unrelated writes or provider calls`);
   assert.equal(submitted.question,displayedReplies[0]);await context.close();
  }
  console.log('Kit suggested reply: user-voice rewrite, unsupported question drop, immediate exact send and removal pass in light/dark.');
 }finally{await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
