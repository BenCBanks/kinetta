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
      r.onerror = () => { opening = null; reject(Error("This phone couldn't load your saved food yet. Keep this page open and try again.")); };
    });
    return opening;
  }
  async function tx(name, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite'), s = t.objectStore(name); let value;
      t.oncomplete = () => resolve(value);
      t.onabort = t.onerror = () => reject(Error("This phone couldn't save this food yet. Keep this page open and try again."));
      try { action(s, v => { value = v; }); } catch (e) { t.abort(); }
    });
  }
  const key = (owner,id) => JSON.stringify([owner,id]);
  return {
    erase: owner => tx('jobs',s=>{const r=s.openCursor();r.onsuccess=()=>{const cursor=r.result;if(cursor){if(cursor.value.owner===owner)cursor.delete();cursor.continue();}};}),
    list: owner => tx('jobs',(s,done) => { const r=s.getAll();r.onsuccess=()=>done(r.result.filter(j=>j.owner===owner).sort((a,b)=>a.at.localeCompare(b.at))); }),
    put: (owner,id,value) => tx('jobs',(s) => s.put({...value,owner,id,key:key(owner,id)})),
    ensure: (owner,id,value) => tx('jobs',s=>{const r=s.get(key(owner,id));r.onsuccess=()=>{if(!r.result)s.put({...value,owner,id,key:key(owner,id)});};}),
    update: (owner,id,fn) => tx('jobs',(s,done)=>{const r=s.get(key(owner,id));r.onsuccess=()=>{if(!r.result){done(null);return;}const value=fn(r.result);s.put(value);done(value);};}),
    removeIfCurrent: (owner,id,phase,expectedVersion) => tx('jobs',(s,done)=>{const r=s.get(key(owner,id));r.onsuccess=()=>{const current=r.result;if(!current||current.phase!==phase||(Number(current.version)||0)!==expectedVersion||['remove','remove-failed','complete'].includes(current.phase)||current.removeError){done(false);return;}s.delete(key(owner,id));done(true);};}),
    remove: (owner,id) => tx('jobs',s=>s.delete(key(owner,id))),
    read: owner => tx('state',(s,done)=>{const r=s.get(owner);r.onsuccess=()=>done(r.result || {});}),
    patch: (owner,patch) => tx('state',s=>{const r=s.get(owner);r.onsuccess=()=>s.put({...r.result,...patch,key:owner});}),
  };
})();

// A native bundle can reach an older server version. Keep review metadata:
// removing it to retry could let that server log food without confirmation.
function foodThreadError(error,path) {
  const extra=error.detail || error.payload?.detail;
  const oldMessage=path==='/api/food/thread/messages' && error.status===422 &&
    Array.isArray(extra) && extra.some(e=>e.type==='extra_forbidden' &&
      ['review_only','draft_id'].includes(e.loc?.[1]));
  const oldReview=error.status===404 && (extra || error.message)==='Not Found' &&
    path.startsWith('/api/food/thread/reviews/');
  if(oldMessage||oldReview)return 'Food review needs a server update. Your draft is kept on this phone. Ask the server owner to update Kinetta, then try again.';
  return error.message;
}

// Resume only authenticated review drafts; legacy auto-log messages must never
// be replayed as a side effect of opening this screen. No photo pixels are rebuilt.
async function restoreFoodPending({db,owner,draftId,messages}) {
  let restored=false;
  for(const m of messages) {
    const meta=m.result||{};
    if(m.kind!=='user'||m.state!=='pending'||meta.review_only!==true||meta.draft_id!==draftId||messages.some(r=>r.reply_to===m.id))continue;
    await db.ensure(owner,m.client_id,{id:m.client_id,mid:m.id,body:m.body,at:m.captured_at,
      phase:'process',review_only:true,draft_id:draftId,media:meta.input?.kind||'text',itemize:!!meta.input?.itemize,
      ...(meta.input?.barcode?{barcode:meta.input.barcode}:{}),...(meta.destination||{})});
    restored=true;
  }
  return restored;
}

// Injected transport/storage allow tests to reorder responses and switch accounts
// through the same state machine the app uses. Every network step is replay-safe.
function foodOutbox({db,request,session,changed,progress=async()=>{},onCompleted=async()=>{},online=()=>navigator.onLine,timeoutMs=path=>path.endsWith('/resolve')?180000:30000}) {
  const busy = new Set(), sending = new Set(), rerun = new Map();
  const version = job => Number(job.version)||0;
  return {
    isSending: (owner,id)=>sending.has(JSON.stringify([owner,id])),
    async flush(owner,{force=false}={}) {
      if (busy.has(owner)){rerun.set(owner,!!force||rerun.get(owner));return;}
      if (!online()&&!force) return;
      const guard=session();busy.add(owner);
      try {
        do {
        if(rerun.get(owner))force=true;
        rerun.delete(owner);
        for (let job of await db.list(owner)) {
          if (session()!==guard || (!online()&&!force)) break;
          if(['remove','remove-failed','complete'].includes(job.phase)||job.removeError)continue;
          if (job.error && job.phase!=='cancel') continue; // Failed messages keep Retry without blocking new messages.
          const owns = async () => {
            if(session()!==guard)return false;
            const current=(await db.list(owner)).find(row=>row.id===job.id);
            return !!current&&current.phase===job.phase&&version(current)===version(job);
          };
          const write = async patch => {
            const expectedPhase=job.phase,expectedVersion=version(job);let changed=false;
            const current=await db.update(owner,job.id,row=>{
              if(row.phase!==expectedPhase||row.phase==='cancel'||['remove','remove-failed','complete'].includes(row.phase)||row.removeError||version(row)!==expectedVersion)return row;
              changed=true;return {...row,...patch};
            });
            if(!changed||!current||current.phase==='cancel'||['remove','remove-failed','complete'].includes(current.phase)||current.removeError||version(current)!==expectedVersion)
              throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
            job=current;
          };
          const finish = async () => {
            const expectedPhase=job.phase,expectedVersion=version(job);
            if(!await db.removeIfCurrent(owner,job.id,expectedPhase,expectedVersion))throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
            try{await onCompleted(owner,job.id);}catch{}
          };
          const call = async (path,body) => {
            if(session()!==guard)throw Object.assign(Error('The account changed.'),{stale:true});
            let r,timer;const controller=new AbortController();
            const sendingKey=JSON.stringify([owner,job.id]);sending.add(sendingKey);await progress(owner);
            try{
              if(!await owns())throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
              r=await Promise.race([request(path,body,{signal:controller.signal}),new Promise((_,reject)=>{
                timer=setTimeout(()=>{reject(Object.assign(Error('Sending took too long. Your food is still on this phone. Tap Retry to try again.'),{timeout:true}));controller.abort();},timeoutMs(path));
              })]);
            }catch(e){e.message=foodThreadError(e,path);throw e;}
            finally{clearTimeout(timer);sending.delete(sendingKey);await progress(owner);}
            if(session()!==guard)throw Object.assign(Error('The account changed.'),{stale:true});
            if(!await owns())throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
            await changed(owner,r,{id:job.id,version:version(job),phase:job.phase,session:guard});
            if(!await owns())throw Object.assign(Error('Stopped sending this message.'),{interrupted:true});
            return r;
          };
          try {
            if(job.offline)await write({offline:false});
            if (job.phase==='cancel') { await call('/api/food/thread/cancel',{client_id:job.id});await finish();continue; }
            if(job.items||job.dish){
              await call('/api/food/thread/reviews/'+(job.items?'items':'dish'),{client_id:job.id,draft_id:job.draft_id,...(job.items?{items:job.items}:job.dish)});
              await finish();continue;
            }
            if (!job.mid) {
              const r=await call('/api/food/thread/messages',{client_id:job.id,body:job.body,captured_at:job.at,media:job.media||'text',...(job.itemize?{itemize:true}:{}),...(job.review_only?{review_only:true}:{}),...(job.draft_id?{draft_id:job.draft_id}:{}),...(job.day?{day:job.day}:{}),...(job.meal?{meal:job.meal}:{}),...(job.context?{context:job.context}:{}),...(job.barcode?{barcode:job.barcode}:{})});
              await write({mid:r.message.id,phase:'process'});
            }
            let r;
            if(job.phase==='process') {
              r=await call(`/api/food/thread/messages/${job.mid}/process`,{});
              const result=(r.messages||[]).find(m=>m.reply_to===job.mid)?.result || {};
              if(r.processing||result.processing)break;
              if(result.can_resolve)await write({phase:'resolve'});
              else {await finish();continue;}
            }
            if(job.phase==='resolve') {
              r=await call(`/api/food/thread/messages/${job.mid}/resolve`,{...(job.images?.length?{images:job.images}:{}),retry:!!job.retry,...(job.note!==undefined?{note:job.note}:{}),...(job.itemize?{itemize:true}:{})});
              const result=(r.messages||[]).find(m=>m.reply_to===job.mid)?.result || {};
              if(r.processing||result.processing)break; // Another request holds the bounded server lease.
              await finish(); // Source errors remain on the server card with explicit Retry.
            }
          } catch(e) {
            if(job.phase==='cancel' && e.status===409){try{await finish();}catch{}continue;}
            if(e.code==='message_cancelled'){try{await finish();}catch{}continue;}
            if(e.offline)await db.update(owner,job.id,current=>current.phase!==job.phase||['remove','remove-failed','complete'].includes(current.phase)||current.removeError||version(current)!==version(job)?current:{...current,offline:true});
            if(!e.offline&&!e.stale&&!e.interrupted) {
              await db.update(owner,job.id,current=>current.phase!==job.phase||current.phase==='cancel'||['remove','remove-failed','complete'].includes(current.phase)||current.removeError||version(current)!==version(job)?current:{...current,error:e.message});
            }
            await progress(owner);if(e.stale||e.interrupted)break;
          }
        }
        } while(session()===guard&&rerun.has(owner));
      } finally {busy.delete(owner);rerun.delete(owner);}
    },
  };
}
