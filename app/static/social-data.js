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
  // Server tickets survive navigation/reload; they contain no setting value or personal content.
  const fences=new Map(),fenceViews=new Map();
  const fenceKey=()=>JSON.stringify([typeof Native==='undefined'?'':Native.base,typeof App==='undefined'?readOwner():App.me?.id]);
  function fence(){const key=fenceKey();if(!fences.has(key)){let saved=null;try{saved=JSON.parse(localStorage.getItem('kinetta.privacy-pending:'+key));}catch(_){}fences.set(key,saved);}return fences.get(key);}
  function setFence(value,required=false){const key=fenceKey();fences.set(key,value);try{value?localStorage.setItem('kinetta.privacy-pending:'+key,JSON.stringify({ticket:value.ticket,settled:!!value.settled})):localStorage.removeItem('kinetta.privacy-pending:'+key);}catch(error){if(required)throw Error('Saved setting cannot be confirmed on this device.');} }
  async function settled(){
    const pending=fence(),account=readOwner();if(!pending||pending.settled)return;
    if(!pending.ticket)throw Object.assign(Error('Saved setting not confirmed. Retry.'),{code:'privacy_save_pending'});
    const result=await (pending.check||(pending.check=apiRequest('/api/privacy-save?ticket='+encodeURIComponent(pending.ticket),{cache:'no-store'}).finally(()=>pending.check=null)));
    if(account!==readOwner()||fence()!==pending||result?.settled!==true)throw Object.assign(Error('Saved setting not confirmed. Retry.'),{code:'privacy_save_pending'});
    pending.settled=true;setFence(pending);
    // The token is now consumed, superseded or expired; it cannot apply a delayed write.
  }
  // A failed write may already be saved. The status fence must settle before any fresh saved-value read.
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
    const views=fenceViews.get(key)||new Set();fenceViews.set(key,views);
    views.add(()=>{if(!live())return false;conceal();if(!busy){note.dataset.sharingState='unknown';text.textContent='Not confirmed. ';retry.hidden=false;}return true;});
    async function run(writePath,options){
      if(busy||!live())return null;busy=true;conceal();let failure=null,expected=fence(),previous=expected;
      try{
        if(writePath){
          setFence({ticket:null});expected=fence();
          for(const notify of views)if(notify()===false)views.delete(notify);
          // Clear kept/cached pages before a possibly-public write; reopened screens must re-read.
          if(typeof invalidate==='function')invalidate('/api/');
          if(typeof App!=='undefined')App.cache?.clear();
          try{for(const name of Object.keys(localStorage))if(name.startsWith('fit.c:'))localStorage.removeItem(name);}catch(_){}
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
          try{
            const reservation=await apiRequest('/api/privacy-save',{...json('POST',{path:writePath.split('?')[0],method:(options?.method||'POST').toUpperCase()}),signal:controller.signal});
            if(account!==readOwner()||expected!==fence())return null;if(typeof reservation?.ticket!=='string')throw Error('Setting unavailable');
            expected.ticket=reservation.ticket;setFence(expected,true);
            await api(writePath,{...options,signal:controller.signal,headers:{...options?.headers,'X-Kinetta-Privacy-Ticket':reservation.ticket}});
          }catch(error){failure=error;if(expected===fence()&&!expected.ticket){setFence(previous);expected=fence();}}finally{clearTimeout(timer);}
        }
        if(account!==readOwner()||expected!==fence())return null;
        await settled();
        const data=await (fetchSaved?fetchSaved():apiRequest(path,{cache:'no-store'}));
        if(account!==readOwner()||expected!==fence())return null;
        await saveCache(data);if(!live()||expected!==fence())return {data,failure};
        await paint(data);if(!live()||expected!==fence())return null;
        known=true;await after(data);if(!live()||expected!==fence())return null;
        setFence(null);for(const [node,was] of hidden)node.hidden=was;hidden.clear();known=true;
        note.dataset.sharingState='confirmed';note.hidden=!failure;text.textContent=failure?'Saved setting shown. ':'';retry.hidden=true;
        return {data,failure};
      }catch(error){
        if(live()){conceal();note.dataset.sharingState='unknown';text.textContent='Not confirmed. ';retry.hidden=false;}
        return null;
      }finally{busy=false;}
    }
    retry.onclick=()=>run();
    if(fence()&&!fence().settled){conceal();Promise.resolve().then(()=>run());}
    return {save:run,read:()=>run(),get known(){return known;}};
  }
  return {remember,peek,read,forget,invalidate,prefetch,warm,draft,watch,confirmSetting,settled,privacyFence:fence};
})();
