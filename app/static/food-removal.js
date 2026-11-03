// Durable, reversible removal for an unlogged food chat card.
'use strict';
function foodThreadRemoval({db,request,session,photos={remove:async()=>{}},onChange=async()=>{},now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,online=()=>navigator.onLine,undoMs=5000,leaseMs=30000}) {
  const timers=new Map(),busy=new Set(),rerun=new Set();
  const claimOwner=`${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const key=(owner,id)=>JSON.stringify([owner,id]);
  async function read(owner,id){return (await db.list(owner)).find(j=>j.id===id)||null;}
  async function notify(owner,id,event='changed'){if(session()===owner)await onChange(owner,id,event);}
  function clear(owner,id){const k=key(owner,id),timer=timers.get(k);if(timer!==undefined){clearTimer(timer);timers.delete(k);}}
  function schedule(owner,id,delay){clear(owner,id);const timer=setTimer(()=>{timers.delete(key(owner,id));return flush(owner);},Math.max(0,delay));timers.set(key(owner,id),timer);}

  async function remove(owner,id){
    if(session()!==owner)return false;
    const before=await read(owner,id);if(!before||['cancel','remove','complete'].includes(before.phase))return false;
    const version=Number(before.version)||0,undoUntil=now()+undoMs;
    const previousPhase=before.phase==='remove-failed'?(before.removal?.previousPhase||'saved'):before.phase;
    let started=false;
    const saved=await db.update(owner,id,current=>{
      if(['cancel','remove','complete'].includes(current.phase)||(Number(current.version)||0)!==version)return current;
      started=true;
      const next={...current,phase:'remove',version:version+1,
        removal:{previousPhase,previousError:current.removeError?(current.removal?.previousError??current.error):current.error,
          previousOffline:current.removeError?current.removal?.previousOffline:current.offline,
          previousRemoveError:!!current.removeError,undoUntil,commitStarted:false,commitOwner:null,commitUntil:0,synthetic:false}};
      delete next.error;delete next.offline;delete next.removeError;delete next.removeFailure;
      return next;
    });
    if(!started||saved?.phase!=='remove'||saved.version!==version+1)return false;
    schedule(owner,id,undoUntil-now());await notify(owner,id,'pending');return true;
  }

  async function removeSaved(owner,id,mid,at){
    if(session()!==owner)return false;
    const messageId=Number(mid);
    if(!id||!Number.isSafeInteger(messageId)||messageId<1)return false;
    const before=await read(owner,id);
    const capturedAt=typeof at==='string'&&Number.isFinite(Date.parse(at))?at:new Date(now()).toISOString();
    const undoUntil=now()+undoMs;
    if(before){
      if(before.mid!=null&&Number(before.mid)!==messageId)return false;
      const version=Number(before.version)||0;let started=false;
      const updated=await db.update(owner,id,current=>{
        if(current.phase==='remove'||(current.phase==='remove-failed'&&!current.removal?.synthetic)||(Number(current.version)||0)!==version||
           (current.mid!=null&&Number(current.mid)!==messageId))return current;
        started=true;
        const previousPhase=current.phase==='complete'?'complete':current.phase==='remove-failed'?(current.removal?.previousPhase||'saved'):current.phase;
        const next={...current,mid:messageId,savedMessage:true,phase:'remove',version:version+1,
          removal:{previousPhase,previousError:current.removeError?(current.removal?.previousError??current.error):current.error,
            previousOffline:current.removeError?current.removal?.previousOffline:current.offline,
            previousRemoveError:!!current.removeError,undoUntil,commitStarted:false,commitOwner:null,commitUntil:0,
            synthetic:current.phase==='remove-failed'&&!!current.removal?.synthetic}};
        delete next.error;delete next.offline;delete next.removeError;delete next.removeFailure;
        return next;
      });
      if(!started||updated?.phase!=='remove'||updated.version!==version+1)return false;
    }else{
      await db.ensure(owner,id,{at:capturedAt,mid:messageId,savedMessage:true,phase:'remove',version:1,
        removal:{previousPhase:'saved',previousError:null,previousOffline:false,previousRemoveError:false,undoUntil,commitStarted:false,commitOwner:null,commitUntil:0,synthetic:true}});
    }
    const saved=await read(owner,id),removal=saved?.removal;
    if(saved?.phase!=='remove'||!saved.savedMessage||Number(saved.mid)!==messageId)return false;
    schedule(owner,id,removal.undoUntil-now());await notify(owner,id,'pending');return true;
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
      if(current.removal.synthetic)return {...current,phase:'complete',version:version+1};
      const next={...current,phase:current.removal.previousPhase||'process',version:version+1,
        error:current.removal.previousError,offline:current.removal.previousOffline,removeError:current.removal.previousRemoveError};
      delete next.removal;delete next.removeFailure;delete next.savedMessage;
      if(next.error==null)delete next.error;if(next.offline==null)delete next.offline;if(!next.removeError)delete next.removeError;
      return next;
    });
    if(!restored||!saved||saved.phase==='remove')return false;
    clear(owner,id);
    if(before.removal.synthetic)await db.remove(owner,id);
    await notify(owner,id,'undo');return true;
  }

  async function owns(owner,id,version){
    if(session()!==owner)return false;
    const current=await read(owner,id);
    return !!current&&!['remove','remove-failed','complete'].includes(current.phase)&&!current.removeError&&
      (Number(current.version)||0)===(Number(version)||0);
  }

  async function fail(owner,job,token){
    let failed=false;
    const saved=await db.update(owner,job.id,row=>{
      if(row.phase!=='remove'||!row.removal?.commitStarted||row.removal.commitOwner!==token||
         (Number(row.version)||0)!==(Number(job.version)||0))return row;
      failed=true;
      const removal=row.removal;
      if(removal.synthetic)return {...row,phase:'remove-failed',removeError:true,removeFailure:true,error:null,offline:false,
        removal:{...removal,commitStarted:false,commitOwner:null,commitUntil:0}};
      const next={...row,phase:removal.previousPhase||'process',version:(Number(row.version)||0)+1,
        error:removal.previousError,offline:removal.previousOffline,removeError:true,removeFailure:true};
      delete next.removal;
      if(next.error==null)delete next.error;if(next.offline==null)delete next.offline;
      return next;
    });
    if(failed&&saved)await notify(owner,job.id,'failed');
  }

  async function markOffline(owner,job,token){
    let changed=false;
    const saved=await db.update(owner,job.id,row=>{
      if(row.phase!=='remove'||!row.removal?.commitStarted||row.removal.commitOwner!==token||
         (Number(row.version)||0)!==(Number(job.version)||0))return row;
      changed=true;return {...row,offline:true,removal:{...row.removal,commitOwner:null,commitUntil:0}};
    });
    if(changed&&saved)await notify(owner,job.id,'offline');
  }

  async function retry(owner,id){
    const job=await read(owner,id);
    return job?.savedMessage&&job.mid?removeSaved(owner,id,job.mid,job.at):remove(owner,id);
  }

  async function flush(owner){
    if(session()!==owner)return;
    if(busy.has(owner)){rerun.add(owner);return;}
    busy.add(owner);
    try{
      do{
        rerun.delete(owner);
        for(const job of await db.list(owner)){
          if(session()!==owner)break;
          if(job.phase!=='remove'||!job.removal)continue;
          if(!job.removal.commitStarted&&now()<job.removal.undoUntil){
            if(!timers.has(key(owner,job.id))){schedule(owner,job.id,job.removal.undoUntil-now());await notify(owner,job.id);}
            continue;
          }
          const version=Number(job.version)||0;let claimed=false;
          const current=await db.update(owner,job.id,row=>{
            if(row.phase!=='remove'||!row.removal||(Number(row.version)||0)!==version||
               (!row.removal.commitStarted&&now()<row.removal.undoUntil)||
               (row.removal.commitStarted&&row.removal.commitOwner&&row.removal.commitUntil>now()))return row;
            claimed=true;
            return {...row,offline:false,removal:{...row.removal,commitStarted:true,commitOwner:claimOwner,commitUntil:now()+leaseMs}};
          });
          if(!claimed||current?.phase!=='remove'){
            const until=current?.removal?.commitUntil||0;
            if(current?.phase==='remove'&&current.removal?.commitStarted&&until>now())schedule(owner,job.id,until-now());
            continue;
          }
          const token=claimOwner;
          if(!online()){
            await markOffline(owner,job,token);continue;
          }
          let completed=false;
          const savedMessage=Number.isSafeInteger(Number(job.mid))&&Number(job.mid)>0;
          const path=savedMessage?`/api/food/thread/messages/${job.mid}/unlogged`:'/api/food/thread/cancel';
          const options=savedMessage?{method:'DELETE'}:{client_id:job.id};
          try{await request(path,options,owner);completed=true;}
          catch(error){
            if(error.code==='message_cancelled')completed=true;
            else if(error.offline&&session()===owner)await markOffline(owner,job,token);
            else if(session()===owner)await fail(owner,job,token);
          }
          if(session()!==owner)continue;
          if(completed){
            const latest=await read(owner,job.id);
            if(latest?.phase==='remove'&&latest.removal?.commitOwner===token&&(Number(latest.version)||0)===version){
              await db.remove(owner,job.id);clear(owner,job.id);await photos.remove(owner,job.id);await notify(owner,job.id,'completed');
            }
          }
        }
      }while(session()===owner&&rerun.has(owner));
    }finally{busy.delete(owner);rerun.delete(owner);}
  }

  return {remove,removeSaved,undo,flush,owns,retry};
}
