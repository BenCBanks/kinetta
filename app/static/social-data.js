// Session-scoped reads; short-lived own-account comment drafts survive reload.
'use strict';
const SocialData=(()=>{
  let owner=null,epoch=0,hydrated=false,revoked=false,draftGeneration=null;const cache=new Map(),pending=new Map(),versions=new Map(),drafts=new Map(),dirtyDrafts=new Set(),watchers=new Map();
  const scope=()=>{const next=readOwner();if(next!==owner){owner=next;epoch++;cache.clear();pending.clear();versions.clear();drafts.clear();dirtyDrafts.clear();watchers.clear();hydrated=false;revoked=false;draftGeneration=generation();}return next;};
  const key=id=>String(id);
  function remember(id,data){scope();if(!Array.isArray(data?.cheers)||!Array.isArray(data?.comments))return;
    const k=key(id);data={...cache.get(k)?.data,...data};
    const changed=JSON.stringify(cache.get(k)?.data)!==JSON.stringify(data);versions.set(k,(versions.get(k)||0)+1);cache.delete(k);cache.set(k,{data,at:Date.now()});
    if(cache.size>40)cache.delete(cache.keys().next().value);
    if(changed)for(const fn of watchers.get(k)||[])if(fn(data)===false)watchers.get(k).delete(fn);
  }
  function peek(id){scope();const hit=cache.get(key(id));return hit&&Date.now()-hit.at<60000?hit.data:null;}
  function forget(id){scope();const k=key(id);cache.delete(k);versions.set(k,(versions.get(k)||0)+1);for(const fn of watchers.get(k)||[])if(fn(null)===false)watchers.get(k).delete(fn);}
  function invalidate(){scope();epoch++;cache.clear();pending.clear();versions.clear();}
  function read(id,{ownerDetails=false}={}){const account=scope(),k=key(id),hit=cache.get(k);
    if(hit&&Date.now()-hit.at<1000&&(!ownerDetails||(hit.data.visibility&&hit.data.details)))return Promise.resolve(hit.data);
    if(pending.has(k))return pending.get(k);
    const version=versions.get(k)||0,generation=epoch;
    const promise=api(`/api/activities/${id}/social`).then(data=>{
      if(account!==readOwner()||generation!==epoch)return null;
      if((versions.get(k)||0)!==version)return cache.get(k)?.data||null;
      remember(id,data);return data;
    }).catch(error=>{if(account===readOwner()&&[401,403,404].includes(error.status))forget(id);throw error;})
      .finally(()=>{if(pending.get(k)===promise)pending.delete(k);});
    pending.set(k,promise);return promise;
  }
  function watch(id,fn){scope();const k=key(id),set=watchers.get(k)||new Set();watchers.set(k,set);
    for(const old of set)if(old(peek(id))===false)set.delete(old);set.add(fn);
    return ()=>{set.delete(fn);if(!set.size&&watchers.get(k)===set)watchers.delete(k);};
  }
  const prefetch=id=>{read(id).catch(()=>{});};
  function warm(button,id){if(button.dataset.socialWarm)return;button.dataset.socialWarm='1';
    for(const event of ['pointerenter','pointerdown','focus'])button.addEventListener(event,()=>prefetch(id),{passive:true});
  }
  const draftKey='fit.comment-drafts',generationKey=draftKey+'-generation',draftTTL=7*86400000;
  function generation(){try{return localStorage.getItem(generationKey);}catch(_){return null;}}
  // Establish one shared epoch before any tab scopes its reads or drafts.
  try{if(!generation())localStorage.setItem(generationKey,newId());}catch(_){}
  function revokeDrafts(){
    scope();if(revoked)return;revoked=true;hydrated=true;drafts.clear();dirtyDrafts.clear();
    globalThis.dispatchEvent?.(new Event('comment-drafts-cleared'));
  }
  globalThis.addEventListener?.('storage',event=>{if(event.key===generationKey||event.key===null)revokeDrafts();});
  try{if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('fit.comment-drafts');channel.onmessage=revokeDrafts;}}catch(_){/* Storage checks also revoke suspended tabs. */}
  const validDraft=row=>row&&typeof row.text==='string'&&row.text.length<=500&&/^[0-9a-f-]{36}$/i.test(row.client_id)&&Number.isFinite(row.at)&&Date.now()-row.at<draftTTL;
  function savedDrafts(){
    scope();
    // Check synchronously too: a suspended tab may write before its storage event is delivered.
    if(generation()!==draftGeneration)revokeDrafts();
    for(const [id,row] of drafts)if(Date.now()-row.at>=draftTTL)drafts.delete(id);
    // Never persist readOwner: it includes a bearer token.
    const account=typeof App!=='undefined'&&App.me?JSON.stringify([Native.base||location.origin,App.me.id]):null;
    if(revoked||hydrated)return revoked?null:account;
    hydrated=true; // Hydrate once: failed writes must never let older storage replace newer memory.
    try{
      const saved=JSON.parse(localStorage.getItem(draftKey)||'null');
      if(!account||saved?.account!==account||(saved.generation??null)!==draftGeneration)localStorage.removeItem(draftKey);
      else for(const [id,row] of Object.entries(saved.rows||{}))if(validDraft(row))drafts.set(id,row);
    }catch(_){/* A full/disabled store still allows an in-memory draft. */}
    // Establish the fence before any durable write. Without it, stay memory-only:
    // logout can revoke old tabs by changing OR removing this fixed-size marker.
    if(!draftGeneration)try{const next=newId();localStorage.setItem(generationKey,next);draftGeneration=next;}catch(_){}
    return account;
  }
  function persistDrafts(account){try{
    if(revoked||generation()!==draftGeneration){revokeDrafts();return;}
    if(!draftGeneration)return; // Quota failure must not create unfenced durable text.
    // Merge only this tab's pending activity changes into the latest saved map.
    // Hydrated copies of unrelated activities may be stale or cleared by another tab.
    let saved;try{saved=JSON.parse(localStorage.getItem(draftKey)||'null');}catch(_){}
    const rows=saved?.account===account&&saved.generation===draftGeneration
      ?Object.fromEntries(Object.entries(saved.rows||{}).filter(([,row])=>validDraft(row))):{};
    for(const id of dirtyDrafts){if(validDraft(drafts.get(id)))rows[id]=drafts.get(id);else delete rows[id];}
    const bounded=Object.fromEntries(Object.entries(rows).sort((a,b)=>a[1].at-b[1].at).slice(-40));
    if(account&&Object.keys(bounded).length)localStorage.setItem(draftKey,JSON.stringify({account,generation:draftGeneration,rows:bounded}));else localStorage.removeItem(draftKey);
    dirtyDrafts.clear(); // Retain pending changes when storage rejects a write.
    // A clear between the check and write cannot leave this old generation's text on disk.
    if(generation()!==draftGeneration){try{if(JSON.parse(localStorage.getItem(draftKey)||'null')?.generation===draftGeneration)localStorage.removeItem(draftKey);}finally{revokeDrafts();}}
  }catch(_){/* Saving a comment must not depend on device storage. */}}
  function draft(id,text){const account=savedDrafts(),k=key(id);if(revoked||!account)return '';if(arguments.length>1){
    const old=drafts.get(k);
    if(text){if(old?.text!==text)drafts.set(k,{text,client_id:old?.text.trim()===text.trim()?old.client_id:newId(),at:old?.text.trim()===text.trim()?old.at:Date.now()});}else drafts.delete(k);
    dirtyDrafts.add(k);persistDrafts(account);
  }return drafts.get(k)?.text||'';}
  function draftRequest(id,text){draft(id,text);return drafts.get(key(id))?.client_id||null;}
  // Only an expiry timestamp persists: no reservation can strand ordinary reads.
  // 15s phone wait + 8s admitted server request + 2s margin. Upstream delays are not ordered.
  const RECOVERY_MS=25000,viewsByOwner=new Map(),generations=new Map(),settingsByRoot=new WeakMap();
  const fenceKey=()=>JSON.stringify([typeof Native==='undefined'?'':Native.base,typeof App==='undefined'?readOwner():App.me?.id]);
  const storageKey=()=> 'kinetta.privacy-until:'+fenceKey();
  const generation=()=>generations.get(fenceKey())||0;
  function pendingUntil(){
    let until=0;try{until=Number(localStorage.getItem(storageKey()));}catch(_){}
    if(!Number.isFinite(until)||until<=Date.now()){try{localStorage.removeItem(storageKey());}catch(_){}return 0;}
    return until;
  }
  function setUntil(until,required=false){try{until?localStorage.setItem(storageKey(),String(until)):localStorage.removeItem(storageKey());}catch(error){if(required)throw Error('Saved setting cannot be confirmed on this device.');}}
  // Compare only the requested settings with their authoritative readback, not the whole response.
  function requestedSetting(data,attempt){
    if(!attempt?.options?.body)return null;
    let wanted;try{wanted=JSON.parse(attempt.options.body);}catch(_){return null;}
    const path=attempt.path;
    if(path==='/api/sharing')data=data.sharing||data;
    else if(path==='/api/contacts/settings')data=data.contacts||data;
    else if(path.startsWith('/api/card'))data=data.card||data;
    else if(path==='/api/account'||path==='/api/profile')data=data.me||data;
    else if(path.startsWith('/api/achievements/showcase'))data=data.showcase||data;
    if(path==='/api/profile'){wanted={...wanted};delete wanted.ai_adult;}
    if(/\/groups\/[^/]+\/sharing$/.test(path))wanted={sharing_level:wanted.level};
    if(/\/recap-consent$/.test(path))wanted={recap_consent:wanted.consent};
    if(wanted.usual_details){wanted={...wanted,custom:false};delete wanted.usual_details;}
    if(Object.hasOwn(wanted,'phone_e164'))wanted={...wanted,phone_e164:wanted.phone_e164?.replace(/[\s()-]/g,'')||null};
    const keys=Object.keys(wanted);if(!keys.length||keys.some(k=>!Object.hasOwn(data||{},k)))return null;
    const equal=(saved,value)=>value&&typeof value==='object'?Array.isArray(value)?JSON.stringify(saved)===JSON.stringify(value):Object.keys(value).every(k=>equal(saved?.[k],value[k])):saved===value;
    return keys.every(k=>equal(data[k],wanted[k]));
  }
  // A failed write may already be saved. Only this control delays readback until a possibly outstanding write is bounded.
  function confirmSetting(root,{path,read:fetchSaved,paint,cache:saveCache=()=>{},mask=()=>[...root.querySelectorAll('input,select,textarea,button:not(.back):not([data-close]),.vis-note,.card-preview,#card-counts')],uncertain=()=>{},after=()=>{},unknownText='Not confirmed.',matches=requestedSetting}){
    const prior=settingsByRoot.get(root),previous=prior?.account===readOwner()?prior.result:null,view={account:readOwner(),result:previous},account=readOwner(),key=fenceKey(),note=document.createElement('p'),text=document.createElement('span'),retry=document.createElement('button');
    note.className='setting-recovery small';note.setAttribute('role','status');note.dataset.sharingState='confirmed';note.hidden=true;
    retry.type='button';retry.className='linkbtn';retry.textContent='Retry';retry.hidden=true;
    note.append(text,retry);root.append(note);
    settingsByRoot.get(root)?.retire?.();settingsByRoot.set(root,view);
    const live=()=>root.isConnected&&account===readOwner()&&settingsByRoot.get(root)===view;let busy=false,known=true,lastError=null,waiting=null,affected=null,attempt=previous?.attempt||null,returnFocus=false;lastError=previous?.failure||null;
    const held=new Map(),controlSelector='button,input,select,textarea,[role="radio"],[role="switch"]';
    // aria-disabled plus event guards keeps keyboard focus on the original control.
    // Clear selection indicators, not rows: an uncertain value must not look private/off.
    function conceal(){
      if(note.parentElement!==root)root.append(note);
      for(const node of (affected||mask()).filter(n=>n&&n!==note&&!note.contains(n))){
        const controls=[...(node.matches(controlSelector)?[node]:[]),...node.querySelectorAll(controlSelector)].filter(n=>!note.contains(n));
        for(const field of controls){
          if(held.has(field))continue;
          held.set(field,{aria:field.getAttribute('aria-disabled'),checked:field.getAttribute('aria-checked'),pressed:field.getAttribute('aria-pressed'),indeterminate:field.indeterminate,readOnly:field.readOnly});
          field.setAttribute('aria-disabled','true');field.classList.add('setting-unconfirmed');
          if(field.matches('input[type=checkbox],input[type=radio]'))field.indeterminate=true;
          if(field.hasAttribute('aria-checked'))field.setAttribute('aria-checked','mixed');
          if(field.hasAttribute('aria-pressed'))field.setAttribute('aria-pressed','mixed');
          if(field.matches('input:not([type=checkbox]):not([type=radio]),textarea'))field.readOnly=true;
        }
        // Non-control saved summaries retain their exact space without making stale claims.
        if(!controls.length&&!held.has(node)){held.set(node,{visibility:node.style.visibility});node.style.visibility='hidden';}
      }
      // This surface has one write at a time. Lock sibling controls before any
      // browser toggle/submit can present a second, unsaved choice as confirmed.
      // Their saved presentation and text drafts stay in place until readback.
      for(const field of root.querySelectorAll('input,select,textarea,button:not(.back):not([data-close]):not(.sharing-nav),[role="radio"],[role="switch"]')){
        if(note.contains(field))continue;
        if(!held.has(field))held.set(field,{aria:field.getAttribute('aria-disabled'),checked:field.getAttribute('aria-checked'),pressed:field.getAttribute('aria-pressed'),indeterminate:field.indeterminate,readOnly:field.readOnly});
        field.setAttribute('aria-disabled','true');field.classList.add('setting-locked');
        if(field.matches('input:not([type=checkbox]):not([type=radio]),textarea'))field.readOnly=true;
      }
      uncertain();known=false;
    }
    function restore(){
      for(const [node,was] of held){
        if(Object.hasOwn(was,'visibility')){node.style.visibility=was.visibility;continue;}
        for(const [name,value] of [['aria-disabled',was.aria],['aria-checked',was.checked],['aria-pressed',was.pressed]]){if(name!=='aria-disabled'&&node.getAttribute(name)!=='mixed')continue;value===null?node.removeAttribute(name):node.setAttribute(name,value);}
        if(was.indeterminate!==undefined)node.indeterminate=was.indeterminate;
        if(was.readOnly!==undefined)node.readOnly=was.readOnly;
        node.classList.remove('setting-unconfirmed','setting-locked');
      }
      held.clear();
    }
    view.retire=()=>{restore();note.hidden=true;note.remove?.();if(waiting)clearTimeout(waiting);};
    const block=event=>{if([...held.keys()].some(node=>node===event.target||node.contains(event.target)||(event.type==='submit'&&event.target.contains(node)))){event.preventDefault();event.stopImmediatePropagation();}};
    for(const type of ['click','pointerdown','change','beforeinput','submit'])root.addEventListener(type,block,true);
    root.addEventListener('keydown',event=>{if([' ','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))block(event);},true);
    function state(checking){note.hidden=false;note.dataset.sharingState=checking?'checking':'unknown';text.textContent=checking?'Checking… ':unknownText+' ';retry.hidden=checking;}
    const views=viewsByOwner.get(key)||new Set();viewsByOwner.set(key,views);
    views.add(()=>{if(!live())return false;conceal();if(!busy)state(false);return true;});
    function schedule(){
      if(waiting)return;
      state(true);
      const check=()=>{
        waiting=null;if(!live())return;
        const remaining=pendingUntil()-Date.now();
        if(remaining>0){waiting=setTimeout(check,Math.min(remaining,1000));return;}
        run();
      };
      waiting=setTimeout(check,Math.min(Math.max(1,pendingUntil()-Date.now()),1000));
    }
    async function run(writePath,options){
      if(busy||!live())return null;
      // A repainted list must reconcile uncertainty before accepting another write.
      if(writePath&&!known){await run();return null;}
      if(waiting){clearTimeout(waiting);waiting=null;}
      busy=true;
      if(writePath&&known){
        lastError=null;view.result=null;affected=mask(writePath,options);
        attempt={path:writePath,options,focus:document.activeElement,error:null};
      }
      conceal();state(true);let failure=attempt?.error||lastError,expected=generation();
      try{
        if(writePath){
          if(pendingUntil()){schedule();return null;}
          setUntil(Date.now()+RECOVERY_MS,true);
          expected=generation()+1;generations.set(key,expected);
          for(const notify of views)if(notify()===false)views.delete(notify);
          if(typeof invalidate==='function')invalidate('/api/');
          if(typeof App!=='undefined')App.cache?.clear();
          try{for(const name of Object.keys(localStorage))if(name.startsWith('fit.c:'))localStorage.removeItem(name);}catch(_){}
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
          try{
            await api(writePath,{...options,signal:controller.signal});
            if(account===readOwner()&&expected===generation())setUntil(0);
          }catch(error){failure=lastError=attempt.error=error;}finally{clearTimeout(timer);}
        }
        if(account!==readOwner()||expected!==generation())return null;
        if(pendingUntil()){state(false);return null;}
        const data=await (fetchSaved?fetchSaved():apiRequest(path,{cache:'no-store'}));
        if(account!==readOwner()||expected!==generation())return null;
        if(pendingUntil()){state(false);return null;}
        if(settingsByRoot.get(root)!==view)return null;
        await saveCache(data);if(!live()||expected!==generation())return {data,failure};
        // Keep uncertain summaries neutral until asynchronous saved-state paints finish.
        // Keep scroll and the equivalent focused control through a saved-state repaint.
        const matched=attempt?matches(data,attempt):null;
        if(matched===true){failure=lastError=null;attempt.error=null;}
        else if(attempt&&(matched===false||failure)){
          let detail=failure?.message?.replace(/^Not saved\. /,'')||'Your requested change was not applied.';
          const wanted=JSON.parse(attempt.options?.body||'{}'),labels={me:'Only me',friends:'Approved friends',everyone:'Everyone on Kinetta'},value=wanted.default??wanted.visibility,saved=data.sharing||data;
          if(Object.hasOwn(labels,value))detail=`You chose ${labels[value]}. Saved: ${labels[saved.default??saved.visibility]||'a different choice'}.`;
          failure=lastError=Object.assign(Error((matched===false||failure?.status>=400&&failure.status<500?'Not saved. ':'Request not confirmed. ')+detail),{status:failure?.status});
        }
        view.result={attempt,failure};
        const focused=returnFocus&&attempt?.focus?attempt.focus:document.activeElement,scrollX=window.scrollX,scrollY=window.scrollY;
        const identity=focused?.id?['id',focused.id]:[...(focused?.attributes||[])].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])[0];
        const focusPath=[];let cursor=focused;
        while(cursor&&cursor!==root){const parent=cursor.parentElement;if(!parent)break;focusPath.unshift([...parent.children].indexOf(cursor));cursor=parent;}
        const hadFocus=cursor===root,scrollers=[];for(let node=focused?.parentElement;node;node=node.parentElement)if(node.scrollTop)scrollers.push([node,node.scrollTop]);
        const restorePosition=()=>{
          if(!root.isConnected||account!==readOwner()||expected!==generation())return;
          if(hadFocus&&(returnFocus||!focused.isConnected)){let replacement=focused.isConnected?focused:identity?root.querySelector(`[${identity[0]}="${CSS.escape(identity[1])}"]`):null;if(!replacement){replacement=root;for(const index of focusPath)replacement=replacement?.children[index];}replacement?.focus?.({preventScroll:true});}
          for(const [node,top] of scrollers)if(node.isConnected)node.scrollTop=top;
          if(window.scrollX!==scrollX||window.scrollY!==scrollY)window.scrollTo(scrollX,scrollY);
        };
        await paint(data,{failure});if(!live()||expected!==generation()){restorePosition();return null;}
        known=true;await after(data,{failure});if(!live()||expected!==generation()){restorePosition();return null;}restore();restorePosition();
        setUntil(0);affected=null;if(note.parentElement!==root)root.append(note);note.dataset.sharingState='confirmed';note.hidden=!failure;text.textContent=failure?.message||'';retry.hidden=true;
        returnFocus=false;return {data,failure};
      }catch(error){
        lastError=failure||error;if(live()){conceal();state(false);}return null;
      }finally{busy=false;}
    }
    retry.onclick=()=>{returnFocus=true;if(pendingUntil()){schedule();return Promise.resolve(null);}return run();};
    if(pendingUntil()){conceal();state(false);}else if(lastError){note.hidden=false;text.textContent=lastError.message;retry.hidden=true;}
    return {save:run,read:()=>run(),get known(){return known;},get failure(){return lastError;},get attempted(){return attempt;}};
  }

  return {remember,peek,read,forget,invalidate,prefetch,warm,draft,draftRequest,revokeDrafts,watch,confirmSetting};
})();
