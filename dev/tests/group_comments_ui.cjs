// Actual member app and route, fictional own-account responses; no external services.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 const gid='00000000-0000-4000-8000-000000000001',route='/groups/'+gid,endpoint='/api/groups/'+gid;
 for(const mode of ['web','bridge'])for(const theme of ['light','dark'])for(const width of [320,330,375,390,440,1280,1440]){
  if(mode==='bridge'&&width>440)continue;
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:width<600,hasTouch:width<600});
  try{
   await c.addInitScript(({base,mode})=>{
    if(mode==='bridge'){const values={server:base,token:'fictional-token'};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};}
    else{const vv=Object.assign(new EventTarget(),{height:844,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{value:vv});window.testViewport=vv;}
   },{base,mode});
   let fail=true,closed=false,rows=[],posts=[];
   await c.route('**/*',r=>{
    const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
    if(u.pathname==='/api/me')return r.fulfill({json:{id:999,login:'alex',name:'Alex Rivera',units:'metric',created:'2026-01-01T00:00:00Z',community_terms_version:1,needs_email_confirm:false}});
    if(u.pathname===endpoint)return r.fulfill({json:{id:gid,title:'Saturday crew',member_count:1,members:[{username:'alex',organizer:true}],is_organizer:true,closed,updates:rows,sharing_level:'just_in'}});
    if(u.pathname===endpoint+'/challenges'||u.pathname==='/api/groups')return r.fulfill({json:[]});
    if(u.pathname===endpoint+'/updates'){
     const body=r.request().postDataJSON();posts.push(body);
     if(fail)return r.fulfill({status:503,json:{detail:'Please try again.'}});
     const row={id:7003,username:'alex',text:body.text,created:'2026-11-27T12:00:00Z',can_delete:true,reactions:{}};rows.unshift(row);return r.fulfill({json:row});
    }
    return r.fulfill({json:{}});
   });
   const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   const visit=async()=>{await p.goto(base+route);await p.waitForFunction(()=>App.pageReady);await p.evaluate(()=>document.fonts.ready);};
   const shot=async state=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${mode}-${theme}-${width}-${state}.png`),animations:'disabled'});}};
   await visit();const field=p.locator('#group-update-text'),send=p.getByRole('button',{name:'Post comment',exact:true});
   assert.equal(await p.locator('.group-updates-section>h2').innerText(),'Comments');assert.equal(await field.getAttribute('placeholder'),'Add a comment…');
   assert.equal(await p.getByRole('button',{name:'Invite',exact:true}).count(),1);assert.equal(await p.locator('[data-group-invite],.group-updates .group-update-empty').count(),0);
   const geometry=await p.evaluate(()=>{const f=document.querySelector('#group-update-text').getBoundingClientRect(),b=document.querySelector('.group-update-form button').getBoundingClientRect(),h=document.querySelector('.group-updates-section>h2').getBoundingClientRect(),card=document.querySelector('.group-updates').getBoundingClientRect();return{field:f.height,button:b.height,buttonWidth:b.width,delta:Math.abs(f.top-b.top),gap:card.top-h.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};});
   assert(geometry.field>=44&&geometry.field<=48&&geometry.button>=44&&geometry.buttonWidth>=44&&geometry.delta<=1&&geometry.gap===8&&!geometry.overflow,JSON.stringify({mode,theme,width,geometry}));assert(await send.isDisabled());
   await shot('empty');
   await field.fill('Fictional trail plans.\nMeet at the park.\nBring water.');assert((await field.boundingBox()).height>geometry.field,'composer grows with text');assert(await send.isEnabled());
   await send.click();await p.locator('.group-update-status:not(:empty)').waitFor();await p.waitForFunction(()=>!document.querySelector('.group-update-form button').disabled);
   assert.equal(await field.inputValue(),'Fictional trail plans.\nMeet at the park.\nBring water.','failed submit retains the whole draft');assert.match(await p.locator('.group-update-status').innerText(),/try again/i);
   if(width===390)await shot('error');
   fail=false;await send.click();await p.locator('[data-group-update="7003"]').waitFor();assert.equal(posts.length,2);assert.equal(posts[0].text,posts[1].text);assert.equal(await field.inputValue(),'');
   if(width===390)await shot('posted');
   // A long thread can always scroll its final card above the floating tabs.
   rows=Array.from({length:8},(_,i)=>({id:8000+i,username:'alex',text:'Fictional Saturday plans '+i,created:'2026-11-27T12:00:00Z',can_delete:true,reactions:{}}));await visit();
   await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
   assert(await p.locator('.group-updates').evaluate(card=>{const tabs=document.querySelector('nav.tabs');return !tabs||card.getBoundingClientRect().bottom<=tabs.getBoundingClientRect().top-8;}),'last card clears tabs');
   if(width===390)await shot('thread-end');
   if(width<600){
    await field.focus();
    if(mode==='bridge')await p.evaluate(()=>{for(const name of ['keyboardWillShow','keyboardDidShow']){const e=new Event(name);e.keyboardHeight=344;dispatchEvent(e);}});
    else{await p.setViewportSize({width,height:500});await p.evaluate(()=>{testViewport.height=500;testViewport.dispatchEvent(new Event('resize'));});}
    await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    await p.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
    assert(!(await p.locator('nav.tabs').isVisible()),'software keyboard hides tabs');
    assert(await field.evaluate(f=>{const r=f.getBoundingClientRect();return r.top>=0&&r.bottom<=500;}),'focused field clears keyboard');assert(await send.evaluate(b=>b.getBoundingClientRect().bottom<=500),'Post clears keyboard');
    if(width===390)await shot('keyboard');
   }
   assert.deepEqual(errors,[],JSON.stringify({mode,theme,width,errors}));
   if(width===390){closed=true;rows=[];await visit();assert.equal(await p.locator('.group-update-form').count(),0);assert.equal(await p.locator('.group-updates .group-update-empty').innerText(),'No comments yet.','closed empty group retains a readable state');}
  }finally{await c.close();}
 }
 console.log('Group comments:24 web/bridge width/theme cases;grow/retry/post/scroll/keyboard/closed PASS');
};
