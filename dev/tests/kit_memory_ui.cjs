// Fictional memory editor, served in the actual Kit shell; no provider requests.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,state,base,out)=>{
  for(const width of [390,330])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:2}),p=await c.newPage();
   let version=4,enabled=true,failSave=false,failRead=false;
   let memories=[{id:1,text:'I want to finish my first half marathon comfortably.',kind:'goal',source:'chat',updated:'2026-11-24T12:00:00Z'},
    {id:2,text:'I prefer vegetarian meals.',kind:'preference',source:'user',updated:'2026-11-25T12:00:00Z'},
    {id:3,text:'I train on Tuesday, Thursday and Sunday.',kind:'routine',source:'edit',updated:'2026-11-25T12:00:00Z'}];
   const errors=[],writes=[],unexpected=[];p.on('pageerror',e=>errors.push(e.message));
   const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-memory-${name}-${width}-${theme}.png`),animations:'disabled'});}};
   try{
    await c.route('**/*',async route=>{
     const req=route.request(),u=new URL(req.url()),method=req.method();if(u.origin!==base)return route.abort();
     if(u.pathname==='/api/me'&&method==='GET'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false}});}
     const root='/api/coach/conversation/memory';
     if(u.pathname.startsWith(root)){
      if(method==='GET')return route.fulfill(failRead?{status:503,json:{detail:'Memory could not load.'}}:{json:{enabled,version,memories}});
      writes.push({method,path:u.pathname,body:req.postData()?req.postDataJSON():null});
      if(failSave)return route.fulfill({status:409,json:{detail:'Kit memory changed. Reload before saving.'}});
      const payload=req.postData()?req.postDataJSON():{},id=Number(u.pathname.slice(root.length+1));
      if(method==='POST'||method==='PATCH'){
       assert.equal(payload.version,version);assert(Object.keys(payload).every(k=>['text','kind','version'].includes(k)));
       const row={id:id||4,text:payload.text,kind:payload.kind,source:id?'edit':'user',updated:'2026-11-25T14:00:00Z'};
       memories=id?memories.map(m=>m.id===id?row:m):[...memories,row];
      }
      if(method==='DELETE')memories=id?memories.filter(m=>m.id!==id):[];
      if(method==='PUT'){enabled=payload.enabled;if(!enabled)memories=[];}
      return route.fulfill({json:{ok:true,version:++version}});
     }
     if(u.pathname==='/api/coach/conversation/threads')return route.fulfill({json:{enabled:false}});
     if(u.pathname==='/api/coach/conversation/visits')return route.fulfill({json:{visit_id:'fixture-visit',generation:'fixture-gen',ready:true}});
     if(u.pathname==='/api/coach/conversation')return route.fulfill({json:{generation:'fixture-gen',ready:true,messages:[]}});
     if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{joined:null}});
     if(method!=='GET'){unexpected.push(u.pathname);return route.fulfill({json:{}});}
     return route.continue();
    });
    await p.goto(base+'/me/kit');await p.locator('#kit-footer-memory').click();
    await p.getByText(memories[0].text,{exact:true}).waitFor();
    assert.equal(await p.locator('.kit-memory-row').count(),3);
    assert.equal(await p.locator('#kit-memory').evaluate(n=>n.firstElementChild.id),'kit-memory-add','Add is the first row');
    assert.equal(await p.locator('.kit-memory-row .linkbtn').count(),0,'no Edit/Forget links clutter the list');
    assert.equal(await p.getByRole('button',{name:'Delete',exact:true}).count(),0,'trash is inaccessible until revealed');
    assert((await p.locator('.kit-memory-row small').first().innerText()).includes('Goal · Nov 24'));
    const initial=await p.locator('.kit-memory-row').first().evaluate(row=>({height:row.getBoundingClientRect().height,font:getComputedStyle(row.querySelector('strong')).fontSize}));
    assert.equal(initial.height,56);assert.equal(initial.font,'16px');
    const sw=p.getByRole('switch',{name:'Remember useful details'});
    assert.deepEqual(await sw.evaluate(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})),{w:51,h:31});
    assert.equal(await p.locator('#kit-memory>p:not(.err),#kit-memory-form>p:not(.err)').count(),0,'no standing explainer paragraphs');
    await shot('list');
    await p.locator('[data-kit-edit="1"]').click();await p.getByRole('heading',{name:'Edit detail',exact:true}).waitFor();
    assert.equal(await p.locator('#kit-memory-form select').count(),0);
    assert.equal(await p.locator('[data-kit-kind]').count(),3);
    await p.locator('#kit-memory-text').fill('I want to finish a 10 km race comfortably.');
    await p.locator('[data-kit-kind="routine"]').click();assert.equal(await p.locator('[data-kit-kind="routine"]').getAttribute('aria-pressed'),'true');
    await p.locator('[data-kit-kind="goal"]').click();await p.locator('#kit-memory-text').blur();await shot('edit');
    assert.equal(await p.getByRole('button',{name:'Delete',exact:true}).count(),1,'desktop/keyboard delete is available inside the editor');
    failSave=true;await p.locator('#kit-memory-save').click();await p.locator('#kit-memory-error').getByText('Kit memory changed. Reload before saving.').waitFor();
    assert.equal(await p.locator('#kit-memory-text').inputValue(),'I want to finish a 10 km race comfortably.');await shot('error');
    failSave=false;await p.locator('#kit-memory-save').click();await p.getByText('I want to finish a 10 km race comfortably.',{exact:true}).waitFor();
    await p.locator('#kit-memory-add').click();await p.getByRole('heading',{name:'Add a detail',exact:true}).waitFor();
    await p.locator('#kit-memory-text').fill('I prefer a short walk after lunch.');await p.locator('#kit-memory-save').click();await p.getByText('I prefer a short walk after lunch.',{exact:true}).waitFor();
    await p.locator('[data-kit-edit="4"]').click();await p.locator('#kit-memory-cancel').click();await p.locator('[data-kit-edit="4"]').waitFor();assert.equal(memories.length,4,'Cancel does not delete or edit');
    await p.locator('[data-kit-edit="4"]').click();failSave=true;await p.locator('#kit-memory-delete').click();await p.locator('#kit-memory-error').getByText('Kit memory changed. Reload before saving.').waitFor();assert.equal(memories.length,4,'failed Delete retains the row');
    failSave=false;await p.locator('#kit-memory-delete').click();await p.locator('[data-kit-edit="4"]').waitFor({state:'detached'});
    const row=p.locator('[data-kit-edit="2"]').locator('..').locator('..');
    await row.evaluate(el=>{const touch=(type,touches)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:touches});el.dispatchEvent(e);};touch('touchstart',[{clientX:250,clientY:150}]);touch('touchmove',[{clientX:140,clientY:151}]);touch('touchend',[]);});
    await p.waitForFunction(()=>{const n=document.querySelector('.kit-memory-row.is-revealed .kit-history-front');return n&&Math.abs(new DOMMatrix(getComputedStyle(n).transform).m41+56)<.1&&Math.abs(new DOMMatrix(getComputedStyle(n.querySelector('.kit-history-open')).transform).m41-56)<.1;});
    const geometry=await row.evaluate(n=>{const button=n.querySelector('[data-kit-forget]'),r=button.getBoundingClientRect(),t=n.querySelector('strong').getBoundingClientRect(),b=n.getBoundingClientRect();return {w:r.width,h:r.height,radius:getComputedStyle(button).borderRadius,left:t.left-b.left,right:b.right-r.right,center:r.y+r.height/2-b.y-b.height/2};});
    assert.equal(geometry.w,44);assert.equal(geometry.h,44);assert.equal(geometry.radius,'50%');assert(Math.abs(geometry.left)<.5&&Math.abs(geometry.right)<.5&&Math.abs(geometry.center)<=.5,'trash is centred and the title keeps its left edge: '+JSON.stringify(geometry));await shot('swipe');
    await row.getByRole('button',{name:'Delete',exact:true}).click();await p.locator('[data-kit-edit="2"]').waitFor({state:'detached'});
    assert.equal(await p.locator('#kit-memory #kit-forget-all').count(),0,'Forget all stays in header overflow');
    await p.getByRole('button',{name:'Memory options',exact:true}).click();await shot('options');
    await p.locator('#kit-forget-all').click();await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(memories.length,2,'Forget all cancellation preserves notes');
    await p.locator('#kit-forget-all').click();await p.getByRole('button',{name:'Forget all',exact:true}).click();await p.getByText('No saved details yet.',{exact:true}).waitFor();await shot('empty');
    await sw.uncheck();await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await sw.isChecked(),true,'cancelled opt-out restores the switch');
    await sw.uncheck();await p.getByRole('button',{name:'Turn off',exact:true}).click();await p.locator('#kit-memory-add').waitFor({state:'detached'});await shot('off');
    const box=await p.locator('#kit-memory').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,right:n.getBoundingClientRect().right}));assert(!box.overflow&&box.right<=width);
    assert.equal(writes.filter(w=>w.method==='PATCH').length,2);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   }finally{await c.close();}
  }
  console.log('Kit memory editor: 390/330 light/dark; tap/edit/type tabs, iOS switch, compact swipe trash, header delete-all, retained failures, off, bounds and zero provider calls PASS');
};
