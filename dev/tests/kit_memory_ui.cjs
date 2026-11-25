// Fictional memory editor, served in the actual Kit shell; no provider requests.
'use strict';
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
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
     if(u.pathname==='/static/critical-shell.css')return route.fulfill({contentType:'text/css',body:['theme.css','paint-gate.css','style.css','password-visibility.css','username-availability.css','email-account.css','login.css'].map(name=>fs.readFileSync('app/static/'+name,'utf8')).join('\n')});
     if(u.pathname==='/static/kit.js'||u.pathname==='/static/style.css')return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync('app'+u.pathname,'utf8')});
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
    assert.equal(await p.locator('.kit-memory-actions button').first().evaluate(n=>n.getBoundingClientRect().height>=44),true);
    assert((await p.locator('#kit-memory').innerText()).includes('From your chat'));
    await shot('list');
    await p.locator('[data-kit-edit="1"]').click();await p.locator('#kit-memory-text').fill('I want to finish a 10 km race comfortably.');
    await p.locator('#kit-memory-kind').selectOption('goal');await p.locator('#kit-memory-text').blur();await shot('edit');
    failSave=true;await p.locator('#kit-memory-save').click();await p.locator('#kit-memory-error').getByText('Kit memory changed. Reload before saving.').waitFor();
    assert.equal(await p.locator('#kit-memory-text').inputValue(),'I want to finish a 10 km race comfortably.');await shot('error');
    failSave=false;await p.locator('#kit-memory-save').click();await p.getByText('I want to finish a 10 km race comfortably.',{exact:true}).waitFor();
    await p.locator('#kit-memory-add').click();await p.locator('#kit-memory-text').fill('I prefer a short walk after lunch.');await p.locator('#kit-memory-save').click();await p.getByText('I prefer a short walk after lunch.',{exact:true}).waitFor();
    await p.locator('[data-kit-forget="4"]').click();await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(memories.length,4);
    await p.locator('[data-kit-forget="4"]').click();await p.getByRole('button',{name:'Forget',exact:true}).last().click();await p.locator('[data-kit-forget="4"]').waitFor({state:'detached'});
    await p.locator('#kit-forget-all').click();await p.getByRole('button',{name:'Forget all',exact:true}).click();await p.getByText('No saved details yet.',{exact:true}).waitFor();await shot('empty');
    await p.locator('#kit-memory-on').uncheck();await p.getByRole('button',{name:'Turn off',exact:true}).click();await p.locator('#kit-memory-add').waitFor({state:'detached'});await shot('off');
    const box=await p.locator('#kit-memory').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,right:n.getBoundingClientRect().right}));assert(!box.overflow&&box.right<=width);
    assert.equal(writes.filter(w=>w.method==='PATCH').length,2);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   }finally{await c.close();}
  }
  console.log('Kit memory editor: 390/330 light/dark; source/date, edit/add, conflict draft, confirmed forget/all, off, bounds and zero provider calls PASS');
};
