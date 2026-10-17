// The food outbox is separate from optional caches: Send succeeds locally only
// after a committed IndexedDB transaction. Keys contain server/account IDs, never tokens.
'use strict';
const ThreadDB = (() => {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const r = indexedDB.open('kinetta-food-thread', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('jobs', {keyPath:'key'}); r.result.createObjectStore('state', {keyPath:'key'}); };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = null; }; resolve(r.result); };
      r.onerror = () => { opening = null; reject(Error("This phone couldn't open its food outbox. Keep your message and try again.")); };
    });
    return opening;
  }
  async function tx(name, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite'), s = t.objectStore(name); let value;
      t.oncomplete = () => resolve(value);
      t.onabort = t.onerror = () => reject(Error("This phone couldn't save the food message. Keep it here and try again."));
      try { action(s, v => { value = v; }); } catch (e) { t.abort(); }
    });
  }
  const key = (owner,id) => JSON.stringify([owner,id]);
  return {
    erase: owner => tx('jobs',s=>{const r=s.openCursor();r.onsuccess=()=>{const cursor=r.result;if(cursor){if(cursor.value.owner===owner)cursor.delete();cursor.continue();}};}),
    list: owner => tx('jobs',(s,done) => { const r=s.getAll();r.onsuccess=()=>done(r.result.filter(j=>j.owner===owner).sort((a,b)=>a.at.localeCompare(b.at))); }),
    put: (owner,id,value) => tx('jobs',(s) => s.put({...value,owner,id,key:key(owner,id)})),
    update: (owner,id,fn) => tx('jobs',(s,done)=>{const r=s.get(key(owner,id));r.onsuccess=()=>{if(!r.result){done(null);return;}const value=fn(r.result);s.put(value);done(value);};}),
    remove: (owner,id) => tx('jobs',s=>s.delete(key(owner,id))),
    read: owner => tx('state',(s,done)=>{const r=s.get(owner);r.onsuccess=()=>done(r.result || {});}),
    patch: (owner,patch) => tx('state',s=>{const r=s.get(owner);r.onsuccess=()=>s.put({...r.result,...patch,key:owner});}),
  };
})();

// Injected transport/storage allow tests to reorder responses and switch accounts
// through the same state machine the app uses. Every network step is replay-safe.
function foodOutbox({db,request,session,changed,online=()=>navigator.onLine}) {
  const busy = new Set();
  return {
    async flush(owner) {
      if (busy.has(owner) || !online()) return;
      const guard=session();busy.add(owner);
      try {
        for (let job of await db.list(owner)) {
          if (session()!==guard || !online()) break;
          if (job.error && job.phase!=='cancel') break; // Preserve conversational order until Retry or Cancel.
          const write = async patch => {
            job=await db.update(owner,job.id,current=>current.phase==='cancel'?current:{...current,...patch});
            if(!job||job.phase==='cancel')throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
          };
          const call = async (path,body) => {
            if(session()!==guard)throw Object.assign(Error('The account changed.'),{stale:true});
            const r=await request(path,body);
            if(session()!==guard)throw Object.assign(Error('The account changed.'),{stale:true});
            await changed(owner,r);return r;
          };
          try {
            if(job.offline)await db.update(owner,job.id,current=>({...current,offline:false}));
            if (job.phase==='cancel') { await call('/api/food/thread/cancel',{client_id:job.id});await db.remove(owner,job.id);continue; }
            if (!job.mid) {
              const r=await call('/api/food/thread/messages',{client_id:job.id,body:job.body,captured_at:job.at,media:job.media||'text',...(job.day?{day:job.day}:{}),...(job.meal?{meal:job.meal}:{}),...(job.context?{context:job.context}:{}),...(job.barcode?{barcode:job.barcode}:{})});
              await write({mid:r.message.id,phase:'process'});
            }
            let r;
            if(job.phase==='process') {
              r=await call(`/api/food/thread/messages/${job.mid}/process`,{});
              const result=(r.messages||[]).find(m=>m.reply_to===job.mid)?.result || {};
              if(result.can_resolve)await write({phase:'resolve'});
              else {await db.remove(owner,job.id);continue;}
            }
            if(job.phase==='resolve') {
              r=await call(`/api/food/thread/messages/${job.mid}/resolve`,{...(job.images?.length?{images:job.images}:{}),retry:!!job.retry});
              const result=(r.messages||[]).find(m=>m.reply_to===job.mid)?.result || {};
              if(r.processing||result.processing)break; // Another request holds the bounded server lease.
              await db.remove(owner,job.id); // Source errors remain on the server card with explicit Retry.
            }
          } catch(e) {
            if(job.phase==='cancel' && e.status===409){await db.remove(owner,job.id);continue;}
            if(e.code==='message_cancelled'){await db.remove(owner,job.id);continue;}
            if(e.offline)await db.update(owner,job.id,current=>current.phase==='cancel'?current:{...current,offline:true});
            if(!e.offline&&!e.stale&&!e.interrupted) {
              await db.update(owner,job.id,current=>current.phase==='cancel'?current:{...current,error:e.message});
            }
            break;
          }
        }
      } finally {busy.delete(owner);}
    },
  };
}
