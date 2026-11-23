// Fictional saved Kit answer rendered by the real app shell; no provider request or data write.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kit-answer-ui';
const visitId='fixture-kit-visit',generation='fixture-kit-generation';
const message={id:1,client_id:'fixture-kit-answer',question:'Look at my consistency',state:'answered',answer:{
 verdict:'Your workout logging was steady across the last month.',
 reason:'You recorded workouts across 20 recorded workout days and logged food across 2 food-log days.',
 interpretation:'This combined text must not be rendered twice.',
 facts:[{label:'Recorded workout days',value:20,display_value:'20'},{label:'Food-log days',value:2,display_value:'2'}],
 follow_ups:[
  'Would you like to review your latest completed workouts from this training block and compare how they fit your plan?',
  'What should I focus on next week?',
  'How can I make food logging easier?'
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
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){
     const response=await route.fetch(),me=await response.json();
     return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});
    }
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:visitId,generation,ready:true}});
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation,ready:true,before:null,messages:[message]}});
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(req.method()==='POST'||req.method()==='PUT'||req.method()==='PATCH'||req.method()==='DELETE'){
     unexpectedWrites.push(u.pathname);return route.fulfill({json:{}});
    }
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');
   await p.locator('.kit-answer-followups button').first().waitFor({state:'visible'});
   await p.waitForFunction(()=>document.fonts.status==='loaded');
   const metrics=await p.locator('.kit-answer').evaluate(card=>{
    const facts=card.querySelector('.kit-facts'),reason=card.querySelector('.kit-reason'),group=card.querySelector('.kit-answer-followups');
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
    const buttons=[...group.querySelectorAll('button')].map(button=>{
     const span=button.querySelector('span'),range=document.createRange();range.selectNodeContents(span);
     const lines=[...range.getClientRects()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right})),b=rect(button),s=getComputedStyle(button);
     return{box:b,lines,minHeight:s.minHeight,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,border:s.borderTopWidth,borderRadius:s.borderTopLeftRadius,shadow:s.boxShadow,pseudo:getComputedStyle(button,'::before').content};
    });
    return{reason:rect(reason),facts:rect(facts),factsMarginTop:getComputedStyle(facts).marginTop,factsMarginBottom:getComputedStyle(facts).marginBottom,group:rect(group),buttons};
   });
   assert(metrics.facts.top-metrics.reason.bottom>=11.5,`${width}px ${theme}: fact summary has 12px above it: ${JSON.stringify(metrics)}`);
   assert(metrics.group.top-metrics.facts.bottom>=11.5,`${width}px ${theme}: fact summary has 12px below it: ${JSON.stringify(metrics)}`);
   assert.equal(metrics.buttons.length,3,`${width}px ${theme}: all three follow-ups remain visible`);
   const firstX=metrics.buttons[0].box.x,firstWidth=metrics.buttons[0].box.width;
   for(const [i,b] of metrics.buttons.entries()){
    assert(b.box.height>=44,`${width}px ${theme}: follow-up ${i+1} is at least 44px tall`);
    assert(Math.abs(b.box.x-firstX)<.5&&Math.abs(b.box.width-firstWidth)<.5,`${width}px ${theme}: follow-up pills share one left edge and width`);
    assert(parseFloat(b.paddingTop)>=12&&parseFloat(b.paddingBottom)>=12,`${width}px ${theme}: follow-up ${i+1} keeps 12px vertical padding`);
    assert.equal(b.border,'1px',`${width}px ${theme}: follow-up ${i+1} has one direct border`);
    assert.equal(b.pseudo,'none',`${width}px ${theme}: follow-up ${i+1} has no second pseudo border`);
    assert.equal(b.shadow,'none',`${width}px ${theme}: follow-up ${i+1} has no shadow`);
    assert(b.lines.length>0,`${width}px ${theme}: follow-up ${i+1} has visible text`);
    for(const line of b.lines)assert(line.top>=b.box.top+1&&line.bottom<=b.box.bottom-1&&line.left>=b.box.left+1&&line.right<=b.box.right-1,`${width}px ${theme}: follow-up ${i+1} text stays inside its pill: ${JSON.stringify({line,box:b.box})}`);
   }
   assert(metrics.buttons[0].lines.length>=2,`${width}px ${theme}: long first follow-up wraps naturally`);
   assert.equal(await p.locator('.kit-answer').innerText().then(t=>t.includes('This combined text must not be rendered twice.')),false,'the stored paragraph remains the only answer paragraph');
   assert.equal(await p.locator('.kit-facts > div').count(),2,'summary facts remain visible');
   assert.deepEqual(errors,[],`${width}px ${theme}: no page errors`);
   assert.deepEqual(unexpectedWrites,[],`${width}px ${theme}: fixture answer makes no writes or provider requests`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-followups-${width}-${theme}.png`),animations:'disabled'});}
   await c.close();contexts.pop();
  }
  console.log('Kit answer follow-ups: long text wraps inside full-width 44px+ single-border pills; fact summary spacing passes at 390/330 light/dark; no writes/provider calls.');
 }finally{for(const c of contexts)await c.close().catch(()=>{});await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
