// Durable-history API stand-ins only: no provider calls or real account records.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,state,base,out)=>{
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),A=uuid(1),B=uuid(2),C=uuid(3),D=uuid(37);
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),p=await c.newPage();
  const errors=[],requests=[],deleted=[],unexpected=[];let gen=900,next=10,failDelete=false,failList=false,delayRead=false,releaseOld=null,otherOwner=false,staleResume=true,step='initial';
  const records=new Map([[A,{title:'Planning my next week',text:'Keep the next run easy.'}],[B,{title:'Food logs and energy for my upcoming training week',text:'Your recorded meals are a starting point.'}],[C,{title:'An earlier training question',text:'Leave time for rest.'}]]);
  for(let i=20;i<38;i++)records.set(uuid(i),{title:'Training question '+(i-19),text:'Keep a comfortable effort.'});
  const message=(id,text)=>({id,client_id:'fictional-history-'+id,question:'A saved question',state:'answered',answer:{answer_blocks:[{kind:'paragraph',text}],interpretation:text,facts:[]}});
  const envelope=(id,visit=null,before=false)=>({conversation_id:id,generation:uuid(gen),visit_id:visit,ready:true,before:before?null:id===B?10:null,messages:before?[message(1,'Earlier saved answer.')]:records.get(id)?.title?[message(11,records.get(id).text)]:[]});
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-history-${name}-${width}-${theme}.png`),animations:'disabled'});}};
  p.on('pageerror',e=>{console.error('History page exception at '+step+':',e.stack);errors.push(e.message);});
  try{
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),method=req.method(),prefix='/api/coach/conversation/threads';if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&method==='GET'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,...(otherOwner?{id:Number(me.id)+1}:{}),ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});}
    if(u.pathname.startsWith(prefix)){
     requests.push({path:u.pathname,method,body:method==='POST'?req.postDataJSON():null});
     const id=u.pathname.slice(prefix.length+1).split('/')[0];
     if(method==='GET'&&u.pathname===prefix){
      if(failList)return route.fulfill({status:503,json:{detail:'Chats could not load.'}});
      const all=otherOwner?[]:[...records].map(([conversation_id,row])=>({conversation_id,title:row.title,created:'2026-11-20T12:00:00Z',updated:'2026-11-25T12:00:00Z',message_count:row.title?1:0}));
      return route.fulfill({json:{enabled:true,retention:'until_deleted',generation:uuid(gen),conversations:u.searchParams.has('before')?all.slice(20):all.slice(0,20),before:!u.searchParams.has('before')&&all.length>20?all[19].conversation_id:null}});
     }
     if(method==='POST'){
      const body=req.postDataJSON();assert.equal(body.generation,uuid(gen),'create/resume uses the latest deletion-fenced generation');
      if(staleResume){staleResume=false;gen++;return route.fulfill({status:409,json:{detail:'Generation changed'}});}
      if(u.pathname===prefix){const newId=body.conversation_id;records.set(newId,{title:'',text:''});next++;return route.fulfill({json:envelope(newId,body.visit_id)});}
      if(!records.has(id))return route.fulfill({status:404,json:{detail:'Chat unavailable'}});
      return route.fulfill({json:envelope(id,body.visit_id)});
     }
     if(method==='DELETE'){
      if(failDelete){failDelete=false;return route.fulfill({status:503,json:{detail:'Deletion could not finish.'}});}
      deleted.push(id||'all');gen++;if(id)records.delete(id);else records.clear();return route.fulfill({json:{ok:true,generation:uuid(gen)}});
     }
     if(!records.has(id))return route.fulfill({status:404,json:{detail:'Chat unavailable'}});
     if(delayRead&&id===A){delayRead=false;await new Promise(resolve=>releaseOld=resolve);}
     return route.fulfill({json:envelope(id,null,u.searchParams.has('before'))});
    }
    if(u.pathname.endsWith('/end')&&method==='POST')return route.fulfill({json:{ok:true}});
    if(u.pathname==='/api/challenges/signup/continue'&&method==='POST')return route.fulfill({json:{joined:null}});
    if(u.pathname.startsWith('/api/coach/conversation')||method!=='GET'){unexpected.push(method+' '+u.pathname);return route.fulfill({json:{}});}
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');await p.locator('.kit-answer').waitFor();
   assert.equal(requests.filter(r=>r.method==='POST').length,2,'a generation conflict refreshes the list once before resuming');
   assert.equal(await p.locator('.kit-answer').innerText(),'Keep the next run easy.','the most recent saved chat resumes on a fresh device');
   const history=p.getByRole('button',{name:'Chats',exact:true});await p.locator('#kit-text').fill('Draft for my training chat');
   await history.click();await p.locator('[data-kit-chat]').first().waitFor();assert.equal(await p.locator('[data-kit-chat]').count(),20);
   const geometry=await p.locator('.kit-history-row').first().evaluate(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el.querySelector('strong')).fontSize,options:el.querySelector('[data-kit-options]').getBoundingClientRect().width}));
   assert(Math.abs(geometry.height-56)<.5,'chat rows use a 56px target');assert.equal(geometry.font,'16px');assert(Math.abs(geometry.options-44)<.5,'row overflow stays 44px');
   assert.equal(await p.getByRole('button',{name:'Delete',exact:true}).count(),0,'Delete is hidden until swipe or menu');
   assert.equal(await p.locator('.kit-history-open[aria-current] svg').count(),1,'a tick marks the current chat');
   assert.equal(await p.locator('#kit-earlier-reviews,#kit-delete-all,#kit-more-chats').count(),0,'secondary actions stay out of the list');
   assert(await p.locator('.kit-history-sheet').evaluate(el=>el.getBoundingClientRect().height>innerHeight-20),'many chats use full available height');
   await shot('list');await p.locator('#kit-chats').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});await p.locator(`[data-kit-chat="${D}"]`).waitFor();
   assert.equal(await p.locator('[data-kit-chat]').count(),21,'scrolling appends older chats in the same list');
   await p.getByRole('button',{name:'Close',exact:true}).click();
   delayRead=true;const oldRead=p.waitForRequest(r=>new URL(r.url()).pathname.endsWith('/threads/'+A)&&r.method()==='GET');
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await oldRead;
   await history.click();await p.locator(`[data-kit-chat="${B}"]`).click();await p.waitForFunction(()=>document.querySelector('.kit-answer')?.textContent.includes('recorded meals'));
   const oldDone=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/threads/'+A));releaseOld();releaseOld=null;await (await oldDone).finished();await p.waitForFunction(()=>document.querySelector('#kit-text').value==='');
   assert.equal(await p.locator('.kit-answer').innerText(),'Your recorded meals are a starting point.','a late old-chat read cannot replace the resumed chat');
   // Restore the real visibility getter before navigation; a pinned false getter makes WebKit fetch during unload.
   await p.evaluate(()=>{delete document.hidden;});
   const olderRead=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/threads/'+B)&&new URL(r.url()).searchParams.has('before'));
   await p.locator('#kit-older').click();await (await olderRead).finished();await p.waitForFunction(()=>document.querySelectorAll('.kit-answer').length===2);
   step='reload B';await p.locator('#kit-text').fill('Draft for my food chat');await p.reload();await p.locator('.kit-answer').first().waitFor();
   assert.equal(await p.locator('#kit-text').inputValue(),'Draft for my food chat','a discarded WebView restores that conversation draft');
   step='resume A';await history.click();await p.locator(`[data-kit-chat="${A}"]`).click();await p.waitForFunction(()=>document.querySelector('#kit-text').value==='Draft for my training chat');
   step='expiry reload A';const oldVisit=await p.evaluate(()=>JSON.parse(localStorage.getItem('fit.kit.visit:'+JSON.stringify([Native.base||location.origin,App.me.id]))).visit_id);
   await p.evaluate(()=>{const key='fit.kit.visit:'+JSON.stringify([Native.base||location.origin,App.me.id]),v=JSON.parse(localStorage.getItem(key));v.created_at=Date.now()-25*60*60*1000;localStorage.setItem(key,JSON.stringify(v));window.dispatchEvent(new PageTransitionEvent('pagehide'));});
   await p.reload();await p.locator('.kit-answer').waitFor();
   assert.equal(requests.filter(r=>r.method==='POST').at(-1).path.endsWith('/'+A+'/resume'),true,'24h temporary-visit expiry resumes the durable conversation');
   assert.notEqual(requests.filter(r=>r.method==='POST').at(-1).body.visit_id,oldVisit);assert.deepEqual(deleted,[],'backgrounding/reload/expiry never deletes history');
   await shot('resumed');
   await history.click();await p.locator(`[data-kit-chat="${B}"]`).waitFor();
   const swipeRow=p.locator(`[data-kit-chat="${B}"]`).locator('..').locator('..');
   await swipeRow.evaluate(el=>{const touch=(type,touches)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:touches});el.dispatchEvent(e);};touch('touchstart',[{clientX:250,clientY:150}]);touch('touchmove',[{clientX:140,clientY:151}]);touch('touchend',[]);});
   await p.locator('.kit-history-row.is-revealed [data-kit-delete]').waitFor({state:'visible'});await shot('swipe');
   const swipeGeometry=await swipeRow.evaluate(row=>{const button=row.querySelector('[data-kit-delete]'),front=row.querySelector('.kit-history-front'),title=row.querySelector('strong'),r=button.getBoundingClientRect(),t=title.getBoundingClientRect(),bounds=row.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(button).borderRadius,slide:new DOMMatrix(getComputedStyle(front).transform).m41,titleLeft:t.left,rowLeft:bounds.left,ellipsis:getComputedStyle(title).textOverflow,shortened:title.scrollWidth>title.clientWidth,icon:!!button.querySelector('svg'),label:button.getAttribute('aria-label'),right:r.right,rowRight:bounds.right,center:r.y+r.height/2,rowCenter:bounds.y+bounds.height/2};});
   assert.equal(swipeGeometry.width,44);assert.equal(swipeGeometry.height,44);assert.equal(swipeGeometry.radius,'50%');assert.equal(swipeGeometry.slide,-56);
   assert(Math.abs(swipeGeometry.titleLeft-swipeGeometry.rowLeft)<.5,'swiping never clips the title on the left');assert.equal(swipeGeometry.ellipsis,'ellipsis');assert(swipeGeometry.shortened,'long titles use an ellipsis');
   assert.equal(await swipeRow.locator('[data-kit-options]').isVisible(),false,'a swiped row exposes only the trash action');
   assert(swipeGeometry.icon);assert.equal(swipeGeometry.label,'Delete');assert(Math.abs(swipeGeometry.center-swipeGeometry.rowCenter)<.5&&swipeGeometry.right<=swipeGeometry.rowRight,'trash circle is vertically centered inside the right margin');
   await p.locator(`[data-kit-delete="${B}"]`).click();await p.locator('[data-confirm-cancel]').click();assert.deepEqual(deleted,[],'single deletion requires confirmation');
   await swipeRow.evaluate(el=>{const touch=(type,touches)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:touches});el.dispatchEvent(e);};touch('touchstart',[{clientX:140,clientY:150}]);touch('touchmove',[{clientX:250,clientY:151}]);touch('touchend',[]);});
   await swipeRow.locator('[data-kit-options]').waitFor({state:'visible'});assert.equal(await p.getByRole('button',{name:'Delete',exact:true}).count(),0,'closing the row restores overflow and hides trash');
   step='failed delete B';failDelete=true;await p.locator(`[data-kit-options="${B}"]`).click();await p.locator('#kit-row-delete').click();await p.locator('[data-confirm-ok]').click();await p.waitForFunction(()=>document.querySelector('#kit-history-error')?.textContent.includes('Kinetta is having trouble'));
   assert.equal(await p.locator(`[data-kit-chat="${B}"]`).count(),1,'a failed deletion keeps the row');
   await p.locator(`[data-kit-options="${B}"]`).click();await p.locator('#kit-row-delete').click();assert.equal(await p.locator('.confirm-sheet p').innerText(),"This can't be undone.");await shot('delete-confirm');await p.locator('[data-confirm-ok]').click();await p.locator(`[data-kit-chat="${B}"]`).waitFor({state:'detached'});
   await p.waitForFunction(()=>document.querySelector('#kit-status')?.textContent==='');assert.deepEqual(deleted,[B]);
   await p.getByRole('button',{name:'Chat history options',exact:true}).click();await shot('options');await p.locator('#kit-delete-all').click();await p.locator('[data-confirm-cancel]').click();assert.deepEqual(deleted,[B],'delete-all cancellation makes no request');
   await p.getByRole('button',{name:'Chat history options',exact:true}).click();await p.locator('#kit-delete-all').click();await p.locator('[data-confirm-ok]').click();await p.waitForFunction(()=>document.querySelector('#kit-chats')?.textContent.includes('No saved chats yet.'));
   assert.deepEqual(deleted,[B,'all']);await shot('empty');await p.getByRole('button',{name:'Close',exact:true}).click();
   assert.equal(await p.locator('#kit-text').inputValue(),'Draft for my training chat','deletion keeps the unsent draft in the fresh chat');
   step='account change';const cutoff=requests.length;await p.evaluate(()=>KitChat.eraseDevice());otherOwner=true;await p.reload();await history.waitFor();await p.waitForFunction(()=>!document.querySelector('#kit-send').disabled||document.querySelector('#kit-starters button')?.disabled===false);
   assert(requests.slice(cutoff).filter(r=>r.method==='POST').every(r=>![A,B,C].some(id=>r.path.includes(id))),'another account never resumes the former account conversation');
   assert.equal(await p.locator('#kit-text').inputValue(),'','another account never sees the former drafts');
   failList=true;await history.click();await p.locator('#kit-history-retry').waitFor();failList=false;await p.locator('#kit-history-retry').click();await p.locator('#kit-new-chat').waitFor();
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[],'history operations never call message generation or unrelated writes');
  }catch(e){await shot('failure');throw e;}finally{if(releaseOld)releaseOld();await c.close();}
 }
 console.log('Kit history: 390/330 light/dark; list/message paging, resume/reload/expiry, isolated drafts, deletion confirm/failure and account/late-read fences pass without generation.');
};
