// Durable six-second removal for an unlogged food chat message. The outbox
// owns transport; this module owns the reversible local removal window.
'use strict';
function foodThreadRemoval({db,request,session,photos={remove:async()=>{}},onChange=async()=>{},now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,online=()=>navigator.onLine,undoMs=6000}) {
  const timers=new Map(),busy=new Set(),rerun=new Set();
  const key=(owner,id)=>JSON.stringify([owner,id]);
  async function read(owner,id){return (await db.list(owner)).find(j=>j.id===id)||null;}
  async function notify(owner,id){if(session()===owner)await onChange(owner,id);}
  function clear(owner,id){const k=key(owner,id),timer=timers.get(k);if(timer!==undefined){clearTimer(timer);timers.delete(k);}}
  function schedule(owner,id,delay){clear(owner,id);const timer=setTimer(()=>{timers.delete(key(owner,id));return flush(owner);},Math.max(0,delay));timers.set(key(owner,id),timer);}

  async function remove(owner,id){
    if(session()!==owner)return false;
    const before=await read(owner,id);if(!before||before.phase==='cancel'||before.phase==='remove')return false;
    const version=Number(before.version)||0,undoUntil=now()+undoMs;let started=false;
    const saved=await db.update(owner,id,current=>{
      if(current.phase==='cancel'||current.phase==='remove'||(Number(current.version)||0)!==version)return current;
      started=true;
      return {...current,phase:'remove',version:version+1,
        removal:{previousPhase:current.phase||'process',undoUntil,commitStarted:false}};
    });
    if(!started||saved?.phase!=='remove'||saved.version!==version+1)return false;
    schedule(owner,id,undoUntil-now());await notify(owner,id);return true;
  }

  async function undo(owner,id){
    if(session()!==owner)return false;
    const before=await read(owner,id),removal=before?.removal;
    if(before?.phase!=='remove'||!removal||removal.commitStarted||now()>=removal.undoUntil)return false;
    const version=Number(before.version)||0;let restored=false;
    const saved=await db.update(owner,id,current=>{
      if(current.phase!=='remove'||current.removal?.commitStarted||current.removal?.undoUntil!==removal.undoUntil||
         (Number(current.version)||0)!==version||now()>=current.removal.undoUntil)return current;
      restored=true;
      const next={...current,phase:current.removal.previousPhase||'process',version:version+1};
      delete next.removal;return next;
    });
    if(!restored||!saved||saved.phase==='remove')return false;
    clear(owner,id);await notify(owner,id);return true;
  }

  async function owns(owner,id,version){
    if(session()!==owner)return false;
    const current=await read(owner,id);
    return !!current&&current.phase!=='remove'&&(Number(current.version)||0)===(Number(version)||0);
  }

  async function flush(owner){
    if(session()!==owner)return;
    if(busy.has(owner)){
      // A timer can expire outside the current snapshot while a request is in flight.
      rerun.add(owner);return;
    }
    busy.add(owner);
    try{
      do{
        rerun.delete(owner);
        for(const job of await db.list(owner)){
          if(session()!==owner)break;
          if(job.phase!=='remove'||!job.removal)continue;
          if(!job.removal.commitStarted&&now()<job.removal.undoUntil){
            if(!timers.has(key(owner,job.id)))schedule(owner,job.id,job.removal.undoUntil-now());
            continue;
          }
          const version=Number(job.version)||0;let claimed=false;
          const current=await db.update(owner,job.id,row=>{
            if(row.phase!=='remove'||!row.removal||(Number(row.version)||0)!==version||
               (!row.removal.commitStarted&&now()<row.removal.undoUntil))return row;
            claimed=true;
            return {...row,images:undefined,previews:undefined,offline:false,
              removal:{...row.removal,commitStarted:true}};
          });
          if(!claimed||current?.phase!=='remove')continue;
          // Once Undo expires, remove photo bytes locally even if the phone is
          // offline. Keep only the tombstone intent so a later retry is safe.
          await photos.remove(owner,job.id);
          if(session()!==owner)continue;
          if(!online()){
            await db.update(owner,job.id,row=>row.phase==='remove'&&row.removal?.commitStarted?{...row,offline:true}:row);
            await notify(owner,job.id);continue;
          }
          let completed=false;
          try{await request('/api/food/thread/cancel',{client_id:job.id});completed=true;}
          catch(error){
            if(error.code==='message_cancelled'||(error.status===409&&/already saved/i.test(error.message||'')))completed=true;
            else if(session()===owner)await db.update(owner,job.id,row=>row.phase==='remove'&&row.removal?.commitStarted?
              {...row,offline:!!error.offline,error:error.offline?null:error.message}:row);
          }
          if(session()!==owner)continue;
          if(completed){await db.remove(owner,job.id);clear(owner,job.id);await photos.remove(owner,job.id);}
          await notify(owner,job.id);
        }
      }while(session()===owner&&rerun.has(owner));
    }finally{busy.delete(owner);rerun.delete(owner);}
  }

  return {remove,undo,flush,owns};
}
