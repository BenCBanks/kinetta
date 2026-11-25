// Fictional Kit answer: plain training verdicts and user-voice replies at phone widths.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kit-answer-ui';
const generation='fixture-kit-ask-detail-generation';
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
   let serverEndedVisit=null,serverEndReported=false,fixtureAccountId=null,overflowMode=false,forceEmpty=false;
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
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET'){const id=u.searchParams.get('visit_id');conversationReads.push(id);if(id===serverEndedVisit&&!serverEndReported){serverEndReported=true;return route.fulfill({status:409,json:{detail:'This Kit visit has ended. Open a fresh chat; your draft is kept.'}});}const responseMessage=overflowMode?{...message,answer:{...message.answer,follow_ups:['Would you like to review your latest completed workouts from this training block and compare how they fit my plan?','Compare every recorded workout this month with my plan and explain the differences in effort, distance, pace and consistency.']}}:message;return route.fulfill({json:{generation,ready:true,before:null,messages:!forceEmpty&&id===visitRequests[0]?[responseMessage]:[]}});}
    if(u.pathname==='/api/coach/conversation/clear'&&req.method()==='POST'){const body=req.postDataJSON();clearRequests.push(body.visit_id);return route.fulfill({json:{visit_id:'cleared-kit-visit',generation,ready:true,messages:[]}});}
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(u.pathname==='/__fixture-keyboard.css')return route.fulfill({status:200,contentType:'text/css',body:'#fixture-keyboard{position:fixed;z-index:2000;top:540px;right:0;bottom:0;left:0;background:#d7dbe0;border-top:1px solid #aeb5bd;}@media(prefers-color-scheme:dark){#fixture-keyboard{background:#343a40;border-color:#555d65;}}'});
    if(req.method()==='POST'||req.method()==='PUT'||req.method()==='PATCH'||req.method()==='DELETE'){
     unexpectedWrites.push(u.pathname);return route.fulfill({json:{}});
    }
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');
   await p.locator('.kit-suggested-reply').first().waitFor({state:'visible'});
   await p.waitForFunction(()=>document.fonts.status==='loaded');
   const composer=await p.locator('.kit-compose-row').evaluate(row=>{
    const field=row.querySelector('#kit-text'),send=row.querySelector('#kit-send'),r=row.getBoundingClientRect(),b=send.getBoundingClientRect();
    return{height:r.height,send:{width:b.width,height:b.height,visible:getComputedStyle(send,'::before').width},fieldHeight:field.getBoundingClientRect().height};
   });
   assert.equal(composer.height,44,`${width}px ${theme}: composer is 44px tall: ${JSON.stringify(composer)}`);
   assert.equal(composer.send.width,44,`${width}px ${theme}: Send retains a 44px touch target`);
   assert.equal(composer.send.visible,'32px',`${width}px ${theme}: visible Send circle is 32px`);
   assert(composer.fieldHeight===44,`${width}px ${theme}: one-line field fits the 44px composer`);
   const closedDock=await p.locator('.kit-chat').evaluate(shell=>({padding:getComputedStyle(shell).paddingBottom,fieldBottom:shell.querySelector('.kit-compose-row').getBoundingClientRect().bottom,viewport:innerHeight}));
   assert.equal(closedDock.padding,'8px',`${width}px ${theme}: Ask Kit reserves only 8px below its dock: ${JSON.stringify(closedDock)}`);
   assert(closedDock.viewport-closedDock.fieldBottom<=8.5,`${width}px ${theme}: answered composer sits just above the home indicator: ${JSON.stringify(closedDock)}`);
   await p.locator('#kit-text').focus();
   const focus=await p.locator('.kit-compose-row').evaluate(row=>{const rules=[];const walk=items=>{for(const rule of items){if(rule.cssRules)walk(rule.cssRules);else if(rule.selectorText)try{if(row.matches(rule.selectorText)||rule.selectorText.includes('.kit-compose-row:focus-within')){const s=rule.style;if(s.getPropertyValue('border')||s.getPropertyValue('border-width')||s.getPropertyValue('outline'))rules.push({selector:rule.selectorText,border:s.getPropertyValue('border'),width:s.getPropertyValue('border-width'),outline:s.getPropertyValue('outline')});}}catch{}}};for(const sheet of document.styleSheets)try{walk(sheet.cssRules)}catch{}const s=getComputedStyle(row);return{focused:row.matches(':focus-within'),active:document.activeElement?.id,border:s.borderTopWidth,color:s.borderTopColor,outline:s.outlineStyle,outlineWidth:s.outlineWidth,outlineOffset:s.outlineOffset,outlineColor:s.outlineColor,shadow:s.boxShadow,rules};});
   assert.equal(focus.outline,'solid',`${width}px ${theme}: focus uses one brand outline: ${JSON.stringify(focus)}`);
   assert(['1px','1.5px'].includes(focus.outlineWidth),`${width}px ${theme}: rendered outline stays thin: ${JSON.stringify(focus)}`);
   assert(['-1px','-1.5px'].includes(focus.outlineOffset),`${width}px ${theme}: outline sits on the composer edge: ${JSON.stringify(focus)}`);
   assert.notEqual(focus.outlineColor,'rgba(0, 0, 0, 0)',`${width}px ${theme}: focus outline remains visible in the brand color`);
   assert.equal(focus.shadow,'none',`${width}px ${theme}: focus adds no blue box shadow`);
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
    return{box,text:span.innerText,lines,minHeight:s.minHeight,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,border:s.borderTopWidth,borderRadius:s.borderTopLeftRadius,shadow:s.boxShadow,background:s.backgroundColor,color:s.color,arrow:rect(button.querySelector('svg'))};
    });
    return{column:rect(article),card:rect(card),reason:rect(reason),facts:rect(facts),details:rect(details),rows,replies:rect(replies),buttons,cardText:card.innerText,cardHasReply:!!card.querySelector('.kit-suggested-replies')};
   });
   assert(metrics.details.top-metrics.reason.bottom>=11.5,`${width}px ${theme}: verdict rows have 12px separation from the explanation`);
   assert(metrics.rows.length===2,`${width}px ${theme}: missing training values are not replaced with placeholders`);
   assert(metrics.rows.every(row=>row.height>=44&&row.border==='1px'),`${width}px ${theme}: both detail rows keep 44px height and inset dividers`);
   assert(Math.abs(metrics.rows[0].height-metrics.rows[1].height)<=1,`${width}px ${theme}: training rows have equal height: ${JSON.stringify(metrics.rows.map(row=>row.height))}`);
   assert.equal(metrics.rows[0].label.width>0,true,`${width}px ${theme}: Recent training label is visible`);
   assert.equal(metrics.rows[0].verdict.width>0,true,`${width}px ${theme}: Recent training verdict is visible`);
   assert.equal(metrics.rows[0].color,await p.locator('.kit-answer').evaluate(n=>getComputedStyle(n).color),`${width}px ${theme}: verdict uses plain text color`);
   assert(metrics.cardText.includes('Recent training')&&metrics.cardText.includes('Heavier than usual')&&metrics.cardText.includes('≈ 61 vs ≈ 48 usual'),`${width}px ${theme}: concise whole-number recent-training row is shown`);
   assert(metrics.cardText.includes('Freshness')&&metrics.cardText.includes('Fresh')&&metrics.cardText.includes('≈ +9'),`${width}px ${theme}: whole-number freshness row is shown`);
   assert(!/\b(?:Fatigue|Fitness|Form)\b/.test(metrics.cardText),`${width}px ${theme}: technical training-load labels are absent`);
   if(width===330)assert(metrics.rows.every(row=>row.verdict.y>=row.label.y+row.label.height-1),`${width}px ${theme}: verdict stacks below its label`);
   assert.equal(metrics.cardHasReply,false,`${width}px ${theme}: suggested replies sit outside the answer card`);
   assert.equal(metrics.buttons.length,2,`${width}px ${theme}: two short replies show: ${JSON.stringify(metrics.buttons.map(button=>({text:button.text,lines:button.lines.length,box:button.box})))}`);
   assert(metrics.replies.left>=metrics.column.left&&metrics.replies.right<=metrics.column.right+1,`${width}px ${theme}: reply bubbles stay within the message column`);
   for(const [i,b] of metrics.buttons.entries()){
    assert(b.box.height>=44,`${width}px ${theme}: reply ${i+1} has a 44px target`);
    assert(b.box.width<=metrics.column.width*.92+1,`${width}px ${theme}: reply ${i+1} stays inside the message column`);
    assert.equal(b.border,'0px',`${width}px ${theme}: reply ${i+1} has no border`);
    assert.equal(b.shadow,'none',`${width}px ${theme}: reply ${i+1} has no shadow`);
    assert(b.lines.length>0&&b.arrow.width===16,`${width}px ${theme}: reply ${i+1} wraps beside the send arrow`);
    for(const line of b.lines)assert(line.top>=b.box.top+1&&line.bottom<=b.box.bottom-1&&line.left>=b.box.left+1&&line.right<=b.box.right-1,`${width}px ${theme}: reply text stays inside its bubble: ${JSON.stringify({line,box:b.box})}`);
   }
   assert(metrics.buttons.every(button=>button.lines.length<=2),`${width}px ${theme}: each reply stays within two lines`);
   assert.deepEqual(await p.locator('.kit-suggested-reply').allTextContents().then(rows=>rows.map(s=>s.trim())),[
    'Compare my workouts','My legs feel heavy today'
   ],`${width}px ${theme}: question-form replies are rewritten and unsupported questions dropped`);
   assert(await p.locator('.kit-suggested-reply').evaluateAll(rows=>rows.every(row=>!row.innerText.includes('…'))),`${width}px ${theme}: replies are never ellipsis-truncated`);
   assert.equal(await p.locator('.kit-facts > div').count(),2,`${width}px ${theme}: unrelated facts remain visible`);
   assert.deepEqual(errors,[],`${width}px ${theme}: no page errors`);
   assert.deepEqual(unexpectedWrites,[],`${width}px ${theme}: fixture answer makes no writes or provider requests`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-ask-detail-${width}-${theme}.png`),animations:'disabled'});}
   await p.evaluate(()=>{document.documentElement.classList.add('keyboard-open');document.documentElement.style.setProperty('--chat-height','540px');const link=document.createElement('link');link.rel='stylesheet';link.href='/__fixture-keyboard.css';document.head.append(link);const keyboard=document.createElement('div');keyboard.id='fixture-keyboard';keyboard.setAttribute('aria-hidden','true');document.body.append(keyboard);});
   const keyboardDock=await p.locator('.kit-chat').evaluate(shell=>({bottom:shell.querySelector('.kit-compose-row').getBoundingClientRect().bottom,viewport:shell.getBoundingClientRect().bottom,padding:getComputedStyle(shell).paddingBottom,fine:getComputedStyle(shell.querySelector('#kit-fine')).display}));
   assert.equal(keyboardDock.padding,'8px',`${width}px ${theme}: keyboard dock keeps 8px: ${JSON.stringify(keyboardDock)}`);
   assert(Math.abs(keyboardDock.viewport-keyboardDock.bottom-8)<=1,`${width}px ${theme}: composer sits 8px above keyboard: ${JSON.stringify(keyboardDock)}`);
   assert.equal(keyboardDock.fine,'none',`${width}px ${theme}: the provider footer clears the keyboard gap`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-ask-keyboard-${width}-${theme}.png`),animations:'disabled'});}
   await p.evaluate(()=>{document.documentElement.classList.remove('keyboard-open');document.documentElement.style.removeProperty('--chat-height');document.querySelector('#fixture-keyboard')?.remove();});
   forceEmpty=true;await p.reload();await p.locator('#kit-starters button').first().waitFor({state:'visible'});
   assert.equal(await p.locator('#kit-messages article').count(),0,`${width}px ${theme}: empty state has no answer card`);
   const emptyDock=await p.locator('.kit-chat').evaluate(shell=>({padding:getComputedStyle(shell).paddingBottom,formBottom:shell.querySelector('#kit-composer').getBoundingClientRect().bottom,viewport:innerHeight,fine:getComputedStyle(shell.querySelector('#kit-fine')).display}));
   assert.equal(emptyDock.padding,'8px',`${width}px ${theme}: empty Ask Kit keeps the safe-area dock: ${JSON.stringify(emptyDock)}`);
   assert(emptyDock.viewport-emptyDock.formBottom<=8.5,`${width}px ${theme}: empty composer footer is docked above the home indicator: ${JSON.stringify(emptyDock)}`);
   assert.notEqual(emptyDock.fine,'none',`${width}px ${theme}: Memory footer remains available in empty state`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-ask-empty-${width}-${theme}.png`),animations:'disabled'});}
   forceEmpty=false;overflowMode=true;await p.reload();await p.locator('.kit-suggested-reply').first().waitFor({state:'visible'});
   assert.equal(await p.locator('.kit-suggested-reply').count(),1,`${width}px ${theme}: an unrewriteable reply beyond two lines is dropped`);
   assert.equal((await p.locator('.kit-suggested-reply').first().innerText()).trim(),'Compare my workouts');
   overflowMode=false;
   await p.reload();await p.locator('.kit-answer').waitFor({state:'visible'});
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
  for(const width of [390,330])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,reducedMotion:theme==='dark'?'reduce':'no-preference',serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],unexpectedWrites=[];contexts.push(c);
   let row=null,failOnRead=false,question='';
   const visit='fixture-kit-wait-'+theme,gen='fixture-kit-wait-generation-'+theme;
   await p.clock.install({time:new Date('2026-11-24T12:00:00Z')});
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});}
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:visit,generation:gen,ready:true}});
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation:gen,ready:true,before:null,messages:row?[{...row,state:failOnRead?'failed':'running',error:failOnRead?'raw model/provider detail must stay hidden':null}]:[]}});
    if(u.pathname==='/api/coach/conversation/messages'&&req.method()==='POST'){const body=req.postDataJSON();question=body.question;row={id:1,client_id:body.client_id,generation:gen,visit_id:visit,question,state:'pending',answer:null,error:null};return route.fulfill({json:row});}
    if(/^\/api\/coach\/conversation\/messages\/[^/]+\/answer$/.test(u.pathname)&&req.method()==='POST')return route.fulfill({json:{...row,state:'running'}});
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(['POST','PUT','PATCH','DELETE'].includes(req.method())){unexpectedWrites.push(u.pathname);return route.fulfill({json:{}});}
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=activity');await p.locator('#kit-text').fill(theme==='light'?'Review my latest workout':'Check my records');await p.locator('#kit-send').click();
   await p.locator('.kit-waiting-bubble .thread-typing').waitFor({state:'visible'});
   await p.waitForFunction(()=>{const el=document.querySelector('.kit-waiting-bubble'),rect=el?.getBoundingClientRect();return rect?.width>0&&rect?.height>0;},null,{timeout:2000});
   assert.equal(question,theme==='light'?'Review my latest workout':'Check my records');
   const typingBox=await p.locator('.kit-waiting-bubble').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),typing=el.querySelector('.thread-typing'),tr=typing?.getBoundingClientRect();return{width:r.width,height:r.height,x:r.x,radius:s.borderTopLeftRadius,border:s.borderTopWidth,display:s.display,cls:el.className,typingBox:tr&&{width:tr.width,height:tr.height}};});
   assert.equal(typingBox.width,48,`${width}px ${theme}: typing pill is 48px wide: ${JSON.stringify(typingBox)}`);
   assert.equal(typingBox.height,28,`${width}px ${theme}: typing pill is 28px high: ${JSON.stringify(typingBox)}`);
   assert(typingBox.x<=24&&typingBox.radius==='14px'&&typingBox.border==='0px',`${width}px ${theme}: typing pill is rounded and left aligned: ${JSON.stringify(typingBox)}`);
   const dots=p.locator('.kit-waiting-bubble .thread-typing span');
   let initialDots=await dots.evaluateAll(spans=>spans.map(node=>({name:getComputedStyle(node).animationName,width:getComputedStyle(node).width,height:getComputedStyle(node).height,duration:getComputedStyle(node).animationDuration,transform:getComputedStyle(node).transform,
    running:node.getAnimations().some(animation=>animation.animationName==='kit-typing'&&animation.playState==='running')})));
   assert(initialDots.length===3,`${theme}: the compact wait bubble has three dots`);
   assert(initialDots.every(dot=>dot.width==='6px'&&dot.height==='6px'),`${theme}: dots measure 6px`);
   assert(initialDots.every(dot=>dot.transform==='none'),`${theme}: dot animation does not translate`);
   const dotLayout=await p.locator('.kit-waiting-bubble .thread-typing').evaluate(el=>({width:getComputedStyle(el).width,gap:getComputedStyle(el).gap}));
   assert.deepEqual(dotLayout,{width:'30px',gap:'6px'},`${width}px ${theme}: dots have 6px gaps`);
   if(theme==='dark')assert(initialDots.every(dot=>!dot.running),'reduced motion keeps the three dots static');
   else{
    assert(initialDots.every(dot=>dot.duration==='1.2s'),`${theme}: dot fade cycle is 1.2s`);
    const deadline=Date.now()+2000;
    while(!initialDots.every(dot=>dot.name==='kit-typing'&&dot.running)&&Date.now()<deadline){
     await p.waitForTimeout(25);
     initialDots=await dots.evaluateAll(spans=>spans.map(node=>({name:getComputedStyle(node).animationName,
      running:node.getAnimations().some(animation=>animation.animationName==='kit-typing'&&animation.playState==='running')})));
    }
    assert(initialDots.every(dot=>dot.name==='kit-typing'&&dot.running),'normal motion starts the typing-dot animation within 2s');
   }
   const capture=async state=>{if(out){await p.evaluate(()=>{document.scrollingElement?.scrollTo(0,0);document.querySelector('#kit-messages')?.scrollTo(0,0);});fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-waiting-${width}-${theme}-${state}.png`),animations:'disabled'});}};
   await capture('sending');
   await p.clock.fastForward(4000);
   await p.locator('.kit-waiting-copy').waitFor({state:'visible'});
   const workCopy=await p.locator('.kit-waiting-copy').innerText();
   assert.equal(workCopy,theme==='light'?'Looking at your recent workouts…':'Checking your data…',`${theme}: waiting copy matches the question`);
   await capture('4s');
   const statusBox=await p.locator('.kit-waiting-bubble').boundingBox();
   await p.clock.fastForward(16000);
   await p.getByText('Still working…',{exact:true}).waitFor({state:'visible'});
   await capture('20s');
   if(width===390){
    failOnRead=true;
    await p.clock.fastForward(2500);
    await p.locator('.kit-error-bubble').waitFor({state:'visible'});
    const errorText=await p.locator('.kit-error-bubble').innerText(),errorBox=await p.locator('.kit-error-bubble').boundingBox();
    assert(errorText.includes("Kit couldn't check that answer. Try a simpler question or Retry."),`${theme}: error uses the helpful client message`);
    assert(!errorText.includes('raw model/provider detail'),`${theme}: raw server error is hidden`);
    assert.equal(await p.locator('.kit-error-retry').innerText(),'Retry',`${theme}: Retry is the primary action`);
    assert(Math.abs(errorBox.height-statusBox.height)<=6&&Math.abs(errorBox.y-statusBox.y)<=1&&Math.abs(errorBox.x-statusBox.x)<=1,`${theme}: replacing the wait bubble with an error does not jump: ${JSON.stringify({statusBox,errorBox})}`);
    await capture('error');
   }
   assert.deepEqual(errors,[],`${theme}: no page exceptions`);
   assert.deepEqual(unexpectedWrites,[],`${theme}: fixtures make no unexpected writes or provider calls`);
   await c.close();contexts.pop();
  }
  for(const width of [390,330])for(const theme of ['light','dark']){
   const insufficient=width===330&&theme==='dark';
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),p=await c.newPage(),compareCalls=[],kitMessagePosts=[],unexpectedWrites=[];contexts.push(c);
   await p.clock.install({time:new Date('2026-11-24T12:00:00Z')});
   p.on('pageerror',e=>unexpectedWrites.push('pageerror:'+e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,units:theme==='light'?'imperial':'metric',ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});}
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:'fixture-workout-review',generation:'fixture-workout-review',ready:true}});
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation:'fixture-workout-review',ready:true,before:null,messages:[]}});
    if(u.pathname==='/api/activities'&&req.method()==='GET')return route.fulfill({json:[{id:insufficient?43:42,sport:'run',start_time:'2026-11-23T12:00:00Z'}]});
    if(u.pathname==='/api/kit/workout-compare'&&req.method()==='POST'){
     compareCalls.push({method:req.method(),body:req.postDataJSON()});
     const response=insufficient?{status:'not_enough_similar',current:{distance_m:5000,moving_s:1800,pace_s_per_km:null,speed_mps:null,avg_hr:null,ascent_m:null},baseline_count:1,baseline_medians:{},deltas:{},relations:{},notable:'none',same_route_count:0}:{status:'compared',current:{distance_m:8046.72,moving_s:2340,pace_s_per_km:300,speed_mps:null,avg_hr:150,ascent_m:100,avg_temp_c:22},baseline_count:3,baseline_medians:{pace_s_per_km:312,avg_hr:153,ascent_m:60},deltas:{pace_s_per_km:-12,avg_hr:-3,ascent_m:40},relations:{pace_s_per_km:'faster',avg_hr:'lower'},notable:'hillier',same_route_count:1};
     return route.fulfill({json:response});
    }
    if(u.pathname==='/api/coach/conversation/messages'&&req.method()==='POST')kitMessagePosts.push(req.postDataJSON());
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(['POST','PUT','PATCH','DELETE'].includes(req.method()))unexpectedWrites.push(u.pathname);
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=activity');
   const starter=p.locator('#kit-starters button').filter({hasText:'Review my latest workout'});await starter.waitFor({state:'visible'});await starter.click();
   const comparison=p.locator('.kit-workout-comparison');await comparison.waitFor({state:'visible'});
   assert.deepEqual(compareCalls,[{method:'POST',body:{activity_id:insufficient?43:42}}],`${width}px ${theme}: tapping the starter requests the latest activity ID once`);
   assert.deepEqual(kitMessagePosts,[],`${width}px ${theme}: app comparison is not sent to Kit`);
   assert.deepEqual(unexpectedWrites,[],`${width}px ${theme}: comparison makes no writes or page errors`);
   const text=await comparison.innerText();
   if(insufficient){
    assert(text.includes('5 km · 30 min'),`${width}px ${theme}: thin-history state keeps the available summary`);
    assert(text.includes('vs your last 1 run of similar distance')&&text.includes('Not enough similar runs yet to compare.'),`${width}px ${theme}: under-two message appears with its summary context`);
    assert.equal(await p.locator('.kit-workout-rows').count(),0,`${width}px ${theme}: missing pace, heart rate and climb rows stay hidden`);
    assert.equal(await p.locator('.kit-workout-notable').count(),0,`${width}px ${theme}: absent notable is hidden`);
   }else{
    assert(text.includes(theme==='light'?'5 mi · 39 min · 8:03 /mi':'8 km · 39 min · 5:00 /km'),`${width}px ${theme}: summary uses profile units`);
    assert(text.includes('vs your last 3 runs of similar distance')&&text.includes(theme==='light'?'19 s/mi faster':'12 s/km faster'),`${width}px ${theme}: comparison rows are rendered in profile units`);
    assert(text.includes('Heart rate')&&text.includes(theme==='light'?'131 ft more':'40 m more'),`${width}px ${theme}: comparison rows express climb as a delta`);
    assert.equal(await p.locator('.kit-workout-notable').innerText(),'Hillier than usual',`${width}px ${theme}: the app-selected notable appears under the rows`);
    assert.equal(await p.locator('.kit-workout-rows>div').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height>=44)),true,`${width}px ${theme}: comparison rows retain 44px targets`);
   }
   await c.close();contexts.pop();
  }
  console.log('Ask Kit detail, wait/error and workout comparisons: 390/330 light/dark; notable and climb delta; no Kit message or writes/provider calls.');
 }finally{for(const c of contexts)await c.close().catch(()=>{});await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
