// Session-scoped social reads and drafts. Never shared between accounts or logins.
'use strict';
const SocialData=(()=>{
  let owner=null,epoch=0;const cache=new Map(),pending=new Map(),versions=new Map(),drafts=new Map(),watchers=new Map();
  const scope=()=>{const next=readOwner();if(next!==owner){owner=next;epoch++;cache.clear();pending.clear();versions.clear();drafts.clear();watchers.clear();}return next;};
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
  function draft(id,text){scope();if(arguments.length>1){text?drafts.set(key(id),text):drafts.delete(key(id));}return drafts.get(key(id))||'';}
  // Only an expiry timestamp persists: no reservation can strand ordinary reads.
  // 15s phone wait + 8s admitted server request + 2s margin. Upstream delays are not ordered.
  const RECOVERY_MS=25000,viewsByOwner=new Map(),generations=new Map();
  const fenceKey=()=>JSON.stringify([typeof Native==='undefined'?'':Native.base,typeof App==='undefined'?readOwner():App.me?.id]);
  const storageKey=()=> 'kinetta.privacy-until:'+fenceKey();
  const generation=()=>generations.get(fenceKey())||0;
  function pendingUntil(){
    let until=0;try{until=Number(localStorage.getItem(storageKey()));}catch(_){}
    if(!Number.isFinite(until)||until<=Date.now()){try{localStorage.removeItem(storageKey());}catch(_){}return 0;}
    return until;
  }
  function setUntil(until,required=false){try{until?localStorage.setItem(storageKey(),String(until)):localStorage.removeItem(storageKey());}catch(error){if(required)throw Error('Saved setting cannot be confirmed on this device.');}}
  // A failed write may already be saved. Only this control delays readback until a possibly outstanding write is bounded.
  function confirmSetting(root,{path,read:fetchSaved,paint,cache:saveCache=()=>{},mask=()=>[...root.children],uncertain=()=>{},after=()=>{}}){
    const account=readOwner(),key=fenceKey(),note=document.createElement('p'),text=document.createElement('span'),retry=document.createElement('button');
    note.className='small muted';note.setAttribute('role','status');note.dataset.sharingState='confirmed';note.hidden=true;
    retry.type='button';retry.className='linkbtn';retry.textContent='Retry';retry.hidden=true;
    note.append(text,retry);root.prepend(note);
    const live=()=>root.isConnected&&account===readOwner();let busy=false,known=true,hidden=new Map();
    function conceal(){
      if(note.parentElement!==root)root.prepend(note);
      for(const node of mask().filter(n=>n&&n!==note)){if(!hidden.has(node))hidden.set(node,node.hidden);node.hidden=true;}
      uncertain();known=false;note.hidden=false;note.dataset.sharingState='checking';text.textContent='Checking saved setting… ';retry.hidden=true;
    }
    const views=viewsByOwner.get(key)||new Set();viewsByOwner.set(key,views);
    views.add(()=>{if(!live())return false;conceal();if(!busy){note.dataset.sharingState='unknown';text.textContent='Not confirmed. ';retry.hidden=false;}return true;});
    async function run(writePath,options){
      if(busy||!live())return null;busy=true;conceal();let failure=null,expected=generation();
      try{
        if(writePath){
          if(pendingUntil())throw Error('Setting not confirmed. Retry.');
          setUntil(Date.now()+RECOVERY_MS,true);
          expected=generation()+1;generations.set(key,expected);
          for(const notify of views)if(notify()===false)views.delete(notify);
          // Clear kept/cached pages before a possibly-public write; reopened screens must re-read.
          if(typeof invalidate==='function')invalidate('/api/');
          if(typeof App!=='undefined')App.cache?.clear();
          try{for(const name of Object.keys(localStorage))if(name.startsWith('fit.c:'))localStorage.removeItem(name);}catch(_){}
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
          try{
            await api(writePath,{...options,signal:controller.signal});
            if(account===readOwner()&&expected===generation())setUntil(0);
          }catch(error){failure=error;}finally{clearTimeout(timer);}
        }
        if(account!==readOwner()||expected!==generation())return null;
        if(pendingUntil())throw Error('Setting not confirmed. Retry.');
        const data=await (fetchSaved?fetchSaved():apiRequest(path,{cache:'no-store'}));
        if(account!==readOwner()||expected!==generation())return null;
        if(pendingUntil())throw Error('Setting not confirmed. Retry.');
        await saveCache(data);if(!live()||expected!==generation())return {data,failure};
        await paint(data);if(!live()||expected!==generation())return null;
        known=true;await after(data);if(!live()||expected!==generation())return null;
        setUntil(0);for(const [node,was] of hidden)node.hidden=was;hidden.clear();known=true;
        note.dataset.sharingState='confirmed';note.hidden=!failure;text.textContent=failure?'Saved setting shown. ':'';retry.hidden=true;
        return {data,failure};
      }catch(error){
        if(live()){conceal();note.dataset.sharingState='unknown';text.textContent='Not confirmed. ';retry.hidden=false;}
        return null;
      }finally{busy=false;}
    }
    retry.onclick=()=>run();
    if(pendingUntil()){conceal();note.dataset.sharingState='unknown';text.textContent='Not confirmed. ';retry.hidden=false;}
    return {save:run,read:()=>run(),get known(){return known;}};
  }
  return {remember,peek,read,forget,invalidate,prefetch,warm,draft,watch,confirmSetting};
})();
