// Fictional Kit answer: plain training verdicts and user-voice replies at phone widths.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kit-answer-ui';
const visitId='fixture-kit-ask-detail-visit',generation='fixture-kit-ask-detail-generation';
const message={id:1,client_id:'fixture-kit-ask-detail',question:'How was my recent training?',state:'answered',answer:{
 verdict:'Your recent records show heavier training this week.',reason:'This fictional example uses workout effort and your usual training.',
 facts:[
  {path:['days',13,'fatigue'],value:61.4},{path:['days',13,'fitness'],value:48.4},{path:['days',13,'form'],value:8.7},
  {label:'Recorded workouts',value:6,display_value:'6'},{label:'Run distance',value:8046.7,display_value:'5.0 mi',path:['totals','distance_m']}
 ],
 follow_ups:[
  'Would you like to review your latest completed workouts from this training block and compare how they fit your plan?',
  'Are your legs feeling heavy or fatigued today?',
  'Do you feel ready to train again?'
 ]
}};
async function main(){
 const browser=await chromium.launch(),login=await browser.newContext(),contexts=[];
 try{
  const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
  assert.equal(signed.status(),200,'fictional demo account can sign in: '+await signed.text());
  const state=await login.storageState();
  for(const width of [390,330])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],unexpectedWrites=[];contexts.push(c);
   const visitRequests=[],endRequests=[],conversationReads=[],clearRequests=[];
   let serverEndedVisit=null,serverEndReported=false,fixtureAccountId=null;
   if(width===390&&theme==='light')await p.clock.install({time:new Date('2026-11-24T12:00:00Z')});
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){
     const response=await route.fetch(),me=await response.json();
     return route.fulfill({response,json:{...me,...(fixtureAccountId==null?{}:{id:fixtureAccountId}),ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});
    }
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST'){const id=req.postDataJSON().visit_id;visitRequests.push(id);return route.fulfill({json:{visit_id:id,generation,ready:true}});}
    if(/^\/api\/coach\/conversation\/visits\/[^/]+\/end$/.test(u.pathname)&&req.method()==='POST'){endRequests.push(decodeURIComponent(u.pathname.split('/').at(-2)));return route.fulfill({json:{ok:true}});}
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET'){const id=u.searchParams.get('visit_id');conversationReads.push(id);if(id===serverEndedVisit&&!serverEndReported){serverEndReported=true;return route.fulfill({status:409,json:{detail:'This Kit visit has ended. Open a fresh chat; your draft is kept.'}});}return route.fulfill({json:{generation,ready:true,before:null,messages:id===visitRequests[0]?[message]:[]}});}
    if(u.pathname==='/api/coach/conversation/clear'&&req.method()==='POST'){const body=req.postDataJSON();clearRequests.push(body.visit_id);return route.fulfill({json:{visit_id:'cleared-kit-visit',generation,ready:true,messages:[]}});}
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(req.method()==='POST'||req.method()==='PUT'||req.method()==='PATCH'||req.method()==='DELETE'){
     unexpectedWrites.push(u.pathname);return route.fulfill({json:{}});
    }
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');
   await p.locator('.kit-suggested-reply').first().waitFor({state:'visible'});
   await p.waitForFunction(()=>document.fonts.status==='loaded');
   const metrics=await p.locator('#kit-messages article').evaluate(article=>{
    const card=article.querySelector('.kit-answer'),reason=card.querySelector('.kit-reason'),facts=card.querySelector('.kit-facts'),details=card.querySelector('.kit-training-details'),replies=article.querySelector('.kit-suggested-replies');
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
    const rows=[...details.querySelectorAll('.kit-training-row')].map(row=>{
     const label=row.querySelector('dt'),verdict=row.querySelector('strong'),detail=row.querySelector('small'),box=rect(row),s=getComputedStyle(row);
     return{box,label:rect(label),verdict:rect(verdict),detail:rect(detail),height:box.height,border:s.borderTopWidth,color:getComputedStyle(verdict).color};
    });
    const buttons=[...replies.querySelectorAll('button')].map(button=>{
     const span=button.querySelector('span'),range=document.createRange();range.selectNodeContents(span);
     const lines=[...range.getClientRects()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right})),box=rect(button),s=getComputedStyle(button);
     return{box,lines,minHeight:s.minHeight,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,border:s.borderTopWidth,borderRadius:s.borderTopLeftRadius,shadow:s.boxShadow,background:s.backgroundColor,color:s.color,arrow:rect(button.querySelector('svg'))};
    });
    return{column:rect(article),card:rect(card),reason:rect(reason),facts:rect(facts),details:rect(details),rows,replies:rect(replies),buttons,cardText:card.innerText,cardHasReply:!!card.querySelector('.kit-suggested-replies')};
   });
   assert(metrics.details.top-metrics.reason.bottom>=11.5,`${width}px ${theme}: verdict rows have 12px separation from the explanation`);
   assert(metrics.rows.length===2,`${width}px ${theme}: missing training values are not replaced with placeholders`);
   assert(metrics.rows.every(row=>row.height>=44&&row.border==='1px'),`${width}px ${theme}: both detail rows keep 44px height and inset dividers`);
   assert.equal(metrics.rows[0].label.width>0,true,`${width}px ${theme}: Recent training label is visible`);
   assert.equal(metrics.rows[0].verdict.width>0,true,`${width}px ${theme}: Recent training verdict is visible`);
   assert.equal(metrics.rows[0].color,await p.locator('.kit-answer').evaluate(n=>getComputedStyle(n).color),`${width}px ${theme}: verdict uses plain text color`);
   assert(metrics.cardText.includes('Recent training')&&metrics.cardText.includes('Heavier than usual')&&metrics.cardText.includes('≈ 61 this week vs ≈ 48 usual'),`${width}px ${theme}: whole-number recent-training row is shown`);
   assert(metrics.cardText.includes('Freshness')&&metrics.cardText.includes('Fresh')&&metrics.cardText.includes('≈ +9'),`${width}px ${theme}: whole-number freshness row is shown`);
   assert(!/\b(?:Fatigue|Fitness|Form)\b/.test(metrics.cardText),`${width}px ${theme}: technical training-load labels are absent`);
   if(width===330)assert(metrics.rows.every(row=>row.verdict.y>=row.label.y+row.label.height-1),`${width}px ${theme}: verdict stacks below its label`);
   assert.equal(metrics.cardHasReply,false,`${width}px ${theme}: suggested replies sit outside the answer card`);
   assert.equal(metrics.buttons.length,2,`${width}px ${theme}: at most two replies show`);
   assert(metrics.replies.left>=metrics.column.left&&metrics.replies.right<=metrics.column.right+1,`${width}px ${theme}: reply bubbles stay within the message column`);
   for(const [i,b] of metrics.buttons.entries()){
    assert(b.box.height>=44,`${width}px ${theme}: reply ${i+1} has a 44px target`);
    assert(b.box.width<=metrics.column.width*.8+1,`${width}px ${theme}: reply ${i+1} stays within 80% width`);
    assert.equal(b.border,'0px',`${width}px ${theme}: reply ${i+1} has no border`);
    assert.equal(b.shadow,'none',`${width}px ${theme}: reply ${i+1} has no shadow`);
    assert(b.lines.length>0&&b.arrow.width===16,`${width}px ${theme}: reply ${i+1} wraps beside the send arrow`);
    for(const line of b.lines)assert(line.top>=b.box.top+1&&line.bottom<=b.box.bottom-1&&line.left>=b.box.left+1&&line.right<=b.box.right-1,`${width}px ${theme}: reply text stays inside its bubble: ${JSON.stringify({line,box:b.box})}`);
   }
   assert(metrics.buttons[0].lines.length>=2,`${width}px ${theme}: long reply wraps naturally`);
   assert.deepEqual(await p.locator('.kit-suggested-reply').allTextContents().then(rows=>rows.map(s=>s.trim())),[
    'Review my latest completed workouts from this training block and compare how they fit my plan','My legs feel heavy today'
   ],`${width}px ${theme}: question-form replies are rewritten and unsupported questions dropped`);
   assert.equal(await p.locator('.kit-facts > div').count(),2,`${width}px ${theme}: unrelated facts remain visible`);
   assert.deepEqual(errors,[],`${width}px ${theme}: no page errors`);
   assert.deepEqual(unexpectedWrites,[],`${width}px ${theme}: fixture answer makes no writes or provider requests`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-ask-detail-${width}-${theme}.png`),animations:'disabled'});}
   if(width===390&&theme==='light'){
    await p.locator('#kit-text').fill('Unsent question kept for later');
    const originalVisit=visitRequests[0];assert(originalVisit,'the first chat creates a server visit');
    await p.evaluate(()=>{
     Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
     window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
     Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
     window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    });
    assert.deepEqual(endRequests,[],'backgrounding and pagehide do not end the Kit visit');
    await p.reload();await p.locator('.kit-answer').waitFor({state:'visible'});
    assert.equal(visitRequests.at(-1),originalVisit,'a discarded WebView resumes with the same server visit_id');
    assert.equal(conversationReads.at(-1),originalVisit,'messages reload from the same visit');
    assert.equal(await p.locator('.kit-answer').innerText().then(t=>t.includes('Your recent records show heavier training')),true,'the saved conversation returns after reload');
    assert.equal(await p.locator('#kit-text').inputValue(),'Unsent question kept for later','unsent draft survives app/page return');
    await p.locator('.thread-heading .back').click();await p.waitForURL(/\/progress(?:\?.*)?$/);
    await p.clock.fastForward(30*60*1000+50);
    for(let i=0;i<50&&!endRequests.includes(originalVisit);i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(endRequests,[originalVisit],'leaving Ask Kit for thirty minutes ends that visit');
    const expiredVisit='expired-kit-visit',owner=await p.evaluate(()=>JSON.stringify([Native.base||location.origin,App.me.id]));
    await p.evaluate(({owner,expiredVisit})=>localStorage.setItem('fit.kit.visit:'+owner,JSON.stringify({visit_id:expiredVisit,created_at:Date.now()-24*60*60*1000-1,left_at:null})),{owner,expiredVisit});
    await p.goto(base+'/me/kit?from=progress');await p.locator('#kit-text').waitFor({state:'visible'});
    assert.notEqual(visitRequests.at(-1),expiredVisit,'a server-age-expired visit is replaced by a fresh visit id');
    assert.deepEqual(endRequests,[originalVisit],'the client does not try to end a visit beyond the server 24-hour limit');
    const serverExpired='server-expired-kit-visit',savedDraft='Keep this draft after the server ends the visit';
    await p.locator('#kit-text').fill(savedDraft);
    await p.evaluate(({owner,serverExpired})=>localStorage.setItem('fit.kit.visit:'+owner,JSON.stringify({visit_id:serverExpired,created_at:Date.now()-60_000,left_at:null})), {owner,serverExpired});
    serverEndedVisit=serverExpired;serverEndReported=false;
    const startsBeforeRecovery=visitRequests.length;
    const freshHistory=p.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/coach/conversation'&&url.searchParams.get('visit_id')!==serverExpired;},{timeout:8000});
    await p.goto(base+'/me/kit?from=progress');
    assert.equal((await freshHistory).status(),200,'a server-ended response is followed by a successful fresh history load');
    await p.locator('#kit-starters button').first().waitFor({state:'visible'});
    assert.equal(serverEndReported,true,'the fixture returned the server ended-visit 409');
    assert.equal(visitRequests[startsBeforeRecovery],serverExpired,'the returning chat first resumes its saved, server-ended visit');
    assert.notEqual(visitRequests[startsBeforeRecovery+1],serverExpired,'a 409 visit-ended response starts a fresh server visit');
    assert.equal(conversationReads.at(-1),visitRequests[startsBeforeRecovery+1],'fresh chat history loads under the replacement visit id');
    assert.equal(await p.locator('.kit-answer').count(),0,'the server-ended chat does not reappear in the fresh chat');
    assert.equal(await p.locator('#kit-text').inputValue(),savedDraft,'the draft survives server-side visit expiry');
    assert.equal(await p.locator('#kit-status').innerText(),'','expired visit recovery does not leave an error message');
    await p.locator('#kit-settings').click();await p.locator('#kit-clear').click();
    await p.waitForFunction(()=>localStorage.getItem('fit.kit.visit:'+JSON.stringify([Native.base||location.origin,App.me.id]))?.includes('cleared-kit-visit'));
    assert.equal(clearRequests.at(-1),visitRequests.at(-1),'New chat explicitly clears the current visit');
    const firstOwnerData=await p.evaluate(()=>({id:App.me.id,key:JSON.stringify([Native.base||location.origin,App.me.id])})),firstOwnerId=firstOwnerData.id,firstOwner=firstOwnerData.key,firstOwnerVisit=visitRequests.at(-1);
    await p.locator('#kit-text').fill('A draft that logout must clear');
    await p.evaluate(()=>KitChat.eraseDevice());
    assert.equal(await p.evaluate(owner=>localStorage.getItem('fit.kit.visit:'+owner),firstOwner),null,'logout cleanup removes the prior account visit id');
    assert.equal(await p.evaluate(owner=>localStorage.getItem('fit.kit.draft:'+owner),firstOwner),null,'logout cleanup removes the prior account draft');
    fixtureAccountId=Number(firstOwnerId)+1;
    const requestsBeforeAccountSwitch=visitRequests.length,readsBeforeAccountSwitch=conversationReads.length;
    const newAccountHistory=p.waitForResponse(response=>response.url().includes('/api/coach/conversation?visit_id=')&&response.request().method()==='GET');
    await p.reload();assert.equal((await newAccountHistory).status(),200,'the next account history loads successfully');
    await p.locator('#kit-text').waitFor({state:'visible'});
    const secondOwner=await p.evaluate(()=>JSON.stringify([Native.base||location.origin,App.me.id]));
    assert.notEqual(secondOwner,firstOwner,'the next sign-in has a distinct storage owner');
    assert.notEqual(visitRequests.at(-1),firstOwnerVisit,'the next account starts its own visit');
    assert.equal(conversationReads.at(-1),visitRequests.at(-1),'the next account reads only its own visit history');
    assert(!visitRequests.slice(requestsBeforeAccountSwitch).includes(firstOwnerVisit),'the prior account visit is never sent after owner change');
    assert(!conversationReads.slice(readsBeforeAccountSwitch).includes(firstOwnerVisit),'the prior account history is never requested after owner change');
    assert.equal(await p.locator('#kit-text').inputValue(),'','the prior account draft is not shown to the next account');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'kit-visit-retained-390-light.png'),animations:'disabled'});}
   }
      await c.close();contexts.pop();
  }
  console.log('Ask Kit detail UI and #1493 visit retention: 390/330 light/dark; background/reload retains visit+draft; explicit/30m/24h paths pass; no writes/provider calls.');
 }finally{for(const c of contexts)await c.close().catch(()=>{});await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
