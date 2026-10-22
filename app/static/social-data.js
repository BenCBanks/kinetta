// Session-scoped social reads and drafts. Never shared between accounts or logins.
'use strict';
const SocialData=(()=>{
  let owner=null,epoch=0;const cache=new Map(),pending=new Map(),versions=new Map(),drafts=new Map(),watchers=new Map();
  const scope=()=>{const next=readOwner();if(next!==owner){owner=next;epoch++;cache.clear();pending.clear();versions.clear();drafts.clear();watchers.clear();}return next;};
  const key=id=>String(id);
  function remember(id,data){scope();if(!Array.isArray(data?.cheers)||!Array.isArray(data?.comments))return;
    const k=key(id),changed=JSON.stringify(cache.get(k)?.data)!==JSON.stringify(data);versions.set(k,(versions.get(k)||0)+1);cache.delete(k);cache.set(k,{data,at:Date.now()});
    if(cache.size>40)cache.delete(cache.keys().next().value);
    if(changed)for(const fn of watchers.get(k)||[])if(fn(data)===false)watchers.get(k).delete(fn);
  }
  function peek(id){scope();const hit=cache.get(key(id));return hit&&Date.now()-hit.at<60000?hit.data:null;}
  function forget(id){scope();const k=key(id);cache.delete(k);versions.set(k,(versions.get(k)||0)+1);for(const fn of watchers.get(k)||[])if(fn(null)===false)watchers.get(k).delete(fn);}
  function invalidate(){scope();epoch++;cache.clear();pending.clear();versions.clear();}
  function read(id){const account=scope(),k=key(id),hit=cache.get(k);
    if(hit&&Date.now()-hit.at<1000)return Promise.resolve(hit.data);
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
    return ()=>set.delete(fn);
  }
  const prefetch=id=>{read(id).catch(()=>{});};
  function warm(button,id){if(button.dataset.socialWarm)return;button.dataset.socialWarm='1';
    for(const event of ['pointerenter','pointerdown','focus'])button.addEventListener(event,()=>prefetch(id),{passive:true});
  }
  function draft(id,text){scope();if(arguments.length>1){text?drafts.set(key(id),text):drafts.delete(key(id));}return drafts.get(key(id))||'';}
  return {remember,peek,read,forget,invalidate,prefetch,warm,draft,watch};
})();
