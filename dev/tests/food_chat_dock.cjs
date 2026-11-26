// App-rendered fictional states with simulated iPhone safe areas and keyboard height.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function(browser,base){
 const out=process.env.SHOT_DIR,measurements=[],failures=[],safeBottom=Number(process.env.KINETTA_DOCK_SAFE_BOTTOM??34);
 const day='2026-11-02',draft='00000000-0000-4000-8000-000000000099';
 for(const width of [390,330])for(const theme of ['light','dark'])for(const state of ['empty','logged','review','shared','recipe','kit','kit-answered','comments']){
  const c=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});
  try{
   const r=require('./native-ui/appstore.cjs')(true).responses,blocked=[],errors=[];
   const kit=state.startsWith('kit');
   if(kit)r['/api/me']={...r['/api/me'],ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{coach:{available:true,entitled:true}}};
   const original=r['/api/food/thread'],entries=r['/api/food/day'].entries.map(e=>({...e,id:null,amount:1,unit:'serving',source:'ai',ref:{origin:'ai',estimated_portion:true}}));
   r['/api/food/thread']={...original,messages:state==='logged'?original.messages:[]};
   if(state==='review')r['/api/food/thread'].messages=[{id:10,client_id:draft,kind:'user',body:'Oatmeal with blueberries and a chicken salad bowl',state:'answered',created:day+'T12:00Z',local_day:day,result:{review_only:true,draft_id:draft}},{id:11,reply_to:10,kind:'assistant',body:'Check the portions before adding.',state:'answered',created:day+'T12:00:01Z',result:{kind:'preview',day,meal:'lunch',parts:[{index:0,status:'ready',estimated:true,entries,drafts:entries}]}}];
   r['/api/dishes/shared']=state==='shared'?[{id:2,name:'Sesame noodle bowl',owner:{login:'jordan',name:'Jordan Example'},serving:'one',totals:{kcal:420}}]:[];
   const nutrients={kcal:450,protein_g:30,carbs_g:40,fat_g:19};
   r['/api/dishes/1']={id:1,name:'Chicken rice bowl',mine:true,items:[],known:nutrients,totals:nutrients,recipe_source:{},serving:'one',serving_count:2,shared_with:[],owner:r['/api/me']};
   r['/api/activities/1']={...r['/api/activities/1'],line:null,chart:null};
   await c.route('**/*',async route=>{
    const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();
    if(u.pathname.endsWith('.css')){const response=await route.fetch();const body=(await response.text()).replace(/env\(safe-area-inset-top[^)]*\)/g,'59px').replace(/env\(safe-area-inset-bottom[^)]*\)/g,`${safeBottom}px`);return route.fulfill({response,body});}
    if(!u.pathname.startsWith('/api/'))return route.continue();
    const key=u.pathname.startsWith('/api/food/thread/reviews/draft/')?'/api/food/thread':u.pathname;
    if(state==='recipe'&&key==='/api/dishes/1/say'&&q.method()==='POST')return route.fulfill({json:{dish:r['/api/dishes/1'],reply:'Fictional ingredient checked.',added:[]}});
    if(kit&&key==='/api/coach/conversation/threads'&&q.method()==='GET')return route.fulfill({json:{enabled:false}});
    if(kit&&key==='/api/coach/conversation/visits'&&q.method()==='POST')return route.fulfill({json:{visit_id:q.postDataJSON().visit_id,generation:'dock-fixture',ready:true}});
    if(kit&&key==='/api/coach/conversation'&&q.method()==='GET')return route.fulfill({json:{generation:'dock-fixture',ready:true,before:null,messages:state==='kit-answered'?[{id:1,client_id:draft,question:'How was my training?',state:'answered',answer:{verdict:'Your records show a steady week.',reason:'Your fictional workouts were spread through the week.',facts:[],follow_ups:[]}}]:[]}});
    if(state==='review'&&key==='/api/food/thread/reviews'&&q.method()==='POST')return route.fulfill({json:{id:9,review:{foods:entries}}});
    if(q.method()!=='GET'&&!['/api/milestones/celebrate','/api/challenges/signup/continue'].includes(key)){blocked.push(q.method()+' '+key);return route.abort();}
    if(['/api/milestones/celebrate','/api/challenges/signup/continue'].includes(key))return route.fulfill({json:{items:[],pending:false}});
    if(key==='/api/food/thread'){
     const data=structuredClone(r[key]);for(const m of data.messages)if(m.kind==='user'){m.captured_at=m.created;m.result={...m.result,review_only:true,draft_id:u.pathname.split('/').at(-1)};}
     return route.fulfill({json:data});
    }
    if(!Object.hasOwn(r,key)){blocked.push('GET '+key);return route.fulfill({status:404,json:{detail:'Unprovided fictional fixture'}});}
    return route.fulfill({json:r[key]});
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date(day+'T12:00Z'));
   await p.goto(base+(kit?'/me/kit':state==='recipe'?'/food/cook/1':state==='comments'?'/activity/1':'/food/describe?meal=lunch'));
   await p.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady);
   const field=kit?'#kit-composer':state==='recipe'?'#dk-add':state==='comments'?'.c-field':'.thread-compose-row';
   if(state==='comments')await p.locator('[data-ttalk]').first().click();
   await p.locator(field).waitFor();
   if(state==='review')await p.locator('#thread-review:not([hidden])').waitFor();
   if(state==='shared')await p.locator('[data-shared-recipe]').waitFor();
   if(state==='logged')await p.locator('.thread-logged-card').first().waitFor();
   if(kit)await p.waitForFunction(()=>!document.querySelector('#kit-send').disabled||document.querySelector('#kit-status').textContent==='');
   if(state==='kit-answered')await p.locator('.kit-answer').waitFor();
   if(!kit&&!['recipe','comments'].includes(state))assert.equal(await p.locator('#thread-status').innerText(),'','fixture conversation loads without an error status');
   await p.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
   if(['empty','recipe','kit-answered'].includes(state))await require('./chat_composer_shape.cjs')(p,state,width,theme,out);
   for(const keyboard of [false,true]){
    await p.evaluate(open=>{
     const input=document.querySelector('#thread-text,#dk-t,#kit-text,.c-field textarea');if(open)input?.focus({preventScroll:true});else input?.blur();
     const root=document.documentElement;root.classList.toggle('keyboard-open',open);root.style.setProperty('--chat-height',(open?innerHeight-260:innerHeight)+'px');
     if(open){window.KinettaKeyboard={height:260};const n=document.createElement('div');n.id='dock-keyboard';n.style='position:fixed;z-index:100000;bottom:0;left:0;right:0;height:260px;background:#aeb6c0;';document.body.append(n);}else{window.KinettaKeyboard={height:0};document.querySelector('#dock-keyboard')?.remove();}
     dispatchEvent(new CustomEvent('kinetta:keyboard',{detail:{height:open?260:0}}));
     // Mirror the native keyboard helper's keepVisible step after the chat shrinks.
     if(open)requestAnimationFrame(()=>{if(input.getBoundingClientRect().bottom>innerHeight-268)input.scrollIntoView({block:'nearest'});});
    },keyboard);
    await p.waitForTimeout(300);
    const geometry=await p.locator(field).evaluate((n,keyboard)=>{const box=n.getBoundingClientRect(),shell=document.querySelector('#page'),css=getComputedStyle(shell);return{gap:innerHeight-(keyboard?260:0)-box.bottom,shellPadding:parseFloat(css.paddingBottom),height:box.height,overflow:document.documentElement.scrollWidth>innerWidth+1};},keyboard);
    const row={state,width,theme,keyboard,...geometry};measurements.push(row);
    // Comments are a separate sheet; record their existing geometry during the audit.
    if(state!=='comments'&&(Math.abs(geometry.gap-(keyboard?8:Math.max(8,safeBottom-8)))>1||geometry.overflow))failures.push(row);
    if(state==='comments')assert(geometry.gap>=0&&geometry.gap<=(keyboard?8:safeBottom+16)&&!geometry.overflow,'comments have no extra dock band');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${state}-${width}-${theme}-${keyboard?'keyboard':'closed'}.png`)});}
   }
   if(state==='review'){
    await p.evaluate(()=>{document.activeElement?.blur();document.documentElement.classList.remove('keyboard-open');document.documentElement.style.setProperty('--chat-height',innerHeight+'px');window.KinettaKeyboard={height:0};document.querySelector('#dock-keyboard')?.remove();dispatchEvent(new CustomEvent('kinetta:keyboard',{detail:{height:0}}));});
    await p.locator('#thread-review-sum').click();await p.locator('#food-final-review').waitFor();
    for(const saveRecipe of [false,true]){
     if(saveRecipe)await p.locator('[name=save_recipe]').check();
     // Review is the existing scrolling sheet, rather than a chat composer.
     await p.locator('.scrim:not(.is-closing) .sheet').evaluate(async n=>{await Promise.all(n.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));n.scrollTop=n.scrollHeight;});
     const gap=await p.locator('#review-confirm').evaluate(n=>innerHeight-n.getBoundingClientRect().bottom);
     assert(Math.abs(gap-(safeBottom+20))<=1,'review and save-recipe keep the standard sheet safe inset + 20px');
     if(out)await p.screenshot({path:path.join(out,`${saveRecipe?'save-recipe':'final-review'}-${width}-${theme}.png`)});
    }
   }
   assert.deepEqual(errors,[],state+' page exceptions');assert.deepEqual(blocked,[],state+' unprovided API or write');
  }finally{await c.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'dock-measurements.json'),JSON.stringify(measurements,null,2));
 assert.deepEqual(failures,[],'Food, recipe and Ask Kit docks use max(8px, safe inset - 8px) closed, or 8px above keyboard');
 console.log('Chat dock: 390/330 light/dark, Food/recipe/Ask Kit empty and answered, keyboard, save-recipe and comments audit PASS');
};
