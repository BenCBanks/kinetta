// Durable removal and Undo stay scoped to a fictional account and outbox job.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={setTimeout,clearTimeout,navigator:{onLine:true}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/food-removal.js','utf8'),ctx);
function fixture(){
  const rows=new Map(),photoRows=new Map(),calls=[],changes=[],timers=new Map();
  let account='owner-a',clock=1000,connected=true,nextTimer=0,requestHandler=null,updateRace=null;
  const key=(owner,id)=>JSON.stringify([owner,id]);
  const db={
    list:async owner=>[...rows.values()].filter(j=>j.owner===owner).sort((a,b)=>a.at.localeCompare(b.at)),
    put:async(owner,id,value)=>rows.set(key(owner,id),{...value,owner,id}),
    ensure:async(owner,id,value)=>{const k=key(owner,id);if(!rows.has(k))rows.set(k,{...value,owner,id});},
    update:async(owner,id,fn)=>{if(updateRace){const race=updateRace;updateRace=null;await race();}const k=key(owner,id),current=rows.get(k);if(!current)return null;const value=fn(current);rows.set(k,value);return value;},
    remove:async(owner,id)=>rows.delete(key(owner,id)),
  };
  function createRemoval(){return ctx.foodThreadRemoval({db,session:()=>account,now:()=>clock,undoMs:5000,leaseMs:5000,
    photos:{remove:async(owner,id)=>photoRows.delete(key(owner,id))},
    request:async(path,body)=>{calls.push({path,body});return requestHandler?requestHandler(path,body):{cancelled:true};},
    onChange:async(owner,id)=>changes.push({owner,id}),online:()=>connected,
    setTimer:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,due:clock+delay});return id;},
    clearTimer:id=>timers.delete(id),
  });}
  let removal=createRemoval();
  async function add(owner='owner-a',id='stable-id',extra={}){
    await db.put(owner,id,{body:'A fictional bowl of oats',at:'2026-10-17T08:00:00Z',phase:'process',images:['fictional-jpeg'],previews:['fictional-preview'],...extra});
    photoRows.set(key(owner,id),['fictional-preview']);
  }
  async function advance(ms){
    clock+=ms;
    const due=[...timers].filter(([,t])=>t.due<=clock);
    for(const [id,timer] of due){timers.delete(id);await timer.fn();}
  }
  async function fireTimer(id){const timer=timers.get(id);if(!timer)return;timers.delete(id);return timer.fn();}
  return {rows,photoRows,calls,changes,timers,db,get removal(){return removal;},createRemoval,add,advance,fireTimer,setClock:v=>clock=v,
    setAccount:v=>account=v,setOnline:v=>connected=v,setRequestHandler:v=>requestHandler=v,
    getNow:()=>clock,dropTimers:()=>timers.clear(),raceUpdate:fn=>{updateRace=fn;},reload:()=>{timers.clear();removal=createRemoval();},
  };
}
async function run(){
  let f=fixture();await f.add();
  const originalVersion=f.rows.get(JSON.stringify(['owner-a','stable-id'])).version||0;
  assert.equal(await f.removal.remove('owner-a','stable-id'),true);
  let job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'remove');assert.equal(job.removal.undoUntil,f.getNow()+5000);
  assert.equal(job.version,originalVersion+1);assert.deepEqual(job.images,['fictional-jpeg']);
  assert.deepEqual(f.photoRows.get(JSON.stringify(['owner-a','stable-id'])),['fictional-preview']);
  assert.equal(await f.removal.owns('owner-a','stable-id',originalVersion),false,'removal invalidates in-flight work');
  await f.removal.flush('owner-a');assert.equal(f.calls.length,0,'the outbox waits through the Undo window');

  // A reload loses JavaScript timers but not the durable deadline; startup
  // schedules finalization again from the stored removal intent.
  f.reload();await f.removal.flush('owner-a');assert.equal(f.timers.size,1);
  await f.advance(4999);assert.equal(f.calls.length,0);
  await f.advance(1);assert.equal(f.calls.length,1);

  // A timer that fires during another slow cancellation schedules a second
  // pass so a newly added expired removal is not stranded outside the snapshot.
  f=fixture();await f.add('owner-a','slow-id');await f.removal.remove('owner-a','slow-id');
  f.setClock(f.getNow()+5000);
  const slowTimer=[...f.timers.keys()][0];let releaseSlow;
  f.setRequestHandler(()=>new Promise(resolve=>releaseSlow=resolve));
  const slowFlush=f.fireTimer(slowTimer);await new Promise(setImmediate);
  assert.equal(f.calls.length,1,'first cancellation is in flight');f.setRequestHandler(null);
  await f.add('owner-a','late-id');assert.equal(await f.removal.remove('owner-a','late-id'),true);
  f.setClock(f.getNow()+5000);const lateTimer=[...f.timers.keys()][0];await f.fireTimer(lateTimer);
  releaseSlow({cancelled:true});await slowFlush;
  assert.equal(f.calls.length,2,'the busy flush retries newly expired removals');
  assert.equal(f.rows.has(JSON.stringify(['owner-a','slow-id'])),false);
  assert.equal(f.rows.has(JSON.stringify(['owner-a','late-id'])),false,'the late removal is not stranded');
  assert.equal(f.photoRows.has(JSON.stringify(['owner-a','late-id'])),false);

  // Repeated taps do not extend the Undo deadline or resubmit cancellation.
  f=fixture();await f.add();await f.removal.remove('owner-a','stable-id');
  const firstDeadline=f.rows.get(JSON.stringify(['owner-a','stable-id'])).removal.undoUntil;
  await f.advance(4000);assert.equal(await f.removal.remove('owner-a','stable-id'),false);
  assert.equal(f.rows.get(JSON.stringify(['owner-a','stable-id'])).removal.undoUntil,firstDeadline);
  await f.advance(1000);assert.equal(f.calls.length,1);

  f=fixture();await f.add('owner-a','complete-id',{phase:'complete'});
  assert.equal(await f.removal.remove('owner-a','complete-id'),false,'completion cannot race into a new removal window');
  assert.equal(f.rows.get(JSON.stringify(['owner-a','complete-id'])).phase,'complete');

  f=fixture();await f.add('owner-a','complete-race');
  f.raceUpdate(async()=>{await f.db.update('owner-a','complete-race',row=>({...row,phase:'complete'}));});
  assert.equal(await f.removal.remove('owner-a','complete-race'),false,'the atomic update also rejects a completion race');
  assert.equal(f.rows.get(JSON.stringify(['owner-a','complete-race'])).phase,'complete');

  f=fixture();await f.add();assert.equal(await f.removal.remove('owner-a','stable-id'),true);
  await f.advance(1500);assert.equal(await f.removal.undo('owner-a','stable-id'),true);
  job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'process');assert.equal(job.version,2);assert.equal(job.removal,undefined);
  assert.equal(job.id,'stable-id');assert.deepEqual(job.images,['fictional-jpeg']);
  assert.deepEqual(f.photoRows.get(JSON.stringify(['owner-a','stable-id'])),['fictional-preview']);
  assert.equal(await f.removal.owns('owner-a','stable-id',originalVersion),false,'Undo cannot authorize an older response');
  assert.equal(await f.removal.undo('owner-a','stable-id'),false,'a stale Undo callback is harmless');
  assert.equal(f.calls.length,0);

  // Undo after a reload restores the stored phase, error and photo payload.
  f=fixture();await f.add('owner-a','retry-id',{phase:'resolve',mid:23,version:4,error:'Check the portion',offline:true});
  await f.removal.remove('owner-a','retry-id');f.reload();
  assert.equal(await f.removal.undo('owner-a','retry-id'),true);
  job=f.rows.get(JSON.stringify(['owner-a','retry-id']));
  assert.equal(job.phase,'resolve');assert.equal(job.mid,23);assert.equal(job.version,6);
  assert.equal(job.error,'Check the portion');assert.equal(job.offline,true);
  assert.deepEqual(job.images,['fictional-jpeg']);assert.deepEqual(job.previews,['fictional-preview']);
  assert.deepEqual(f.photoRows.get(JSON.stringify(['owner-a','retry-id'])),['fictional-preview']);

  f=fixture();await f.add();await f.removal.remove('owner-a','stable-id');await f.advance(5000);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/food/thread/cancel');
  assert.equal(f.calls[0].body.client_id,'stable-id');
  assert.equal(f.rows.has(JSON.stringify(['owner-a','stable-id'])),false);
  assert.equal(f.photoRows.has(JSON.stringify(['owner-a','stable-id'])),false);

  // Expiry while offline keeps photos for a possible server refusal and stores
  // a durable cancellation intent.
  f=fixture();await f.add();await f.removal.remove('owner-a','stable-id');f.setOnline(false);await f.advance(5000);
  job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'remove');assert.equal(job.removal.commitStarted,true);assert.deepEqual(job.images,['fictional-jpeg']);
  assert.deepEqual(job.previews,['fictional-preview']);assert.equal(job.offline,true);assert.equal(f.photoRows.has(JSON.stringify(['owner-a','stable-id'])),true);
  assert.equal(f.calls.length,0);
  // A newly created controller over the same durable row resumes the tombstone.
  f.setOnline(true);await f.removal.flush('owner-a');
  assert.equal(f.calls.length,1);assert.equal(f.rows.has(JSON.stringify(['owner-a','stable-id'])),false);

  // A server-backed outbox row uses the guarded DELETE and Undo restores its phase.
  f=fixture();await f.add('owner-a','processing-id',{mid:41,phase:'resolve',version:4});
  assert.equal(await f.removal.removeSaved('owner-a','processing-id',41),true);
  job=f.rows.get(JSON.stringify(['owner-a','processing-id']));assert.equal(job.savedMessage,true);assert.equal(job.mid,41);
  assert.equal(await f.removal.undo('owner-a','processing-id'),true);
  job=f.rows.get(JSON.stringify(['owner-a','processing-id']));assert.equal(job.phase,'resolve');assert.equal(job.version,6);assert.equal(job.savedMessage,undefined);
  assert.equal(f.calls.length,0,'Undo restores a mid-bearing outbox row without sending a request');

  // A still-unsent local message keeps the established cancel endpoint.
  f=fixture();await f.add('owner-a','processing-id');await f.removal.remove('owner-a','processing-id');
  await f.advance(5000);assert.equal(f.calls[0].path,'/api/food/thread/cancel');
  assert.equal(f.calls[0].body.client_id,'processing-id');

  // A saved but unlogged chat message gets durable Undo even after its outbox job is gone.
  f=fixture();await f.add('owner-a','other-id');
  const savedPhotoKey=JSON.stringify(['owner-a','saved-id']);f.photoRows.set(savedPhotoKey,['fictional-preview']);
  assert.equal(await f.removal.removeSaved('owner-a','saved-id',42,'2026-10-17T08:30:00Z'),true);
  job=f.rows.get(savedPhotoKey);assert.equal(job.savedMessage,true);assert.equal(job.mid,42);
  assert.equal(job.at,'2026-10-17T08:30:00Z','synthetic rows remain sortable with normal outbox jobs');
  assert.deepEqual(f.photoRows.get(savedPhotoKey),['fictional-preview'],'photos remain available through Undo');
  await f.removal.flush('owner-a');assert.equal(f.calls.length,0,'the saved message remains available during Undo');
  assert.equal(await f.removal.undo('owner-a','saved-id'),true);
  assert.equal(f.rows.has(JSON.stringify(['owner-a','saved-id'])),false,'Undo removes only the synthetic local hold');
  assert.equal(f.calls.length,0,'Undo does not delete the server message');

  f=fixture();const expiringPhotoKey=JSON.stringify(['owner-a','saved-id']);f.photoRows.set(expiringPhotoKey,['fictional-preview']);
  assert.equal(await f.removal.removeSaved('owner-a','saved-id',42),true);
  f.setRequestHandler((path,options)=>({deleted:true,path,options}));await f.advance(5000);
  assert.equal(f.calls[0].path,'/api/food/thread/messages/42/unlogged');assert.equal(f.calls[0].body.method,'DELETE');
  assert.equal(f.rows.has(expiringPhotoKey),false,'expiry deletes the saved chat message hold');
  assert.equal(f.photoRows.has(expiringPhotoKey),false,'expiry cleans saved-message photos');

  // A lost acknowledgement retries the same message; the idempotent DELETE confirms it is gone.
  f=fixture();await f.removal.removeSaved('owner-a','retry-saved',43);let deleted=false;
  f.setRequestHandler(()=>{if(!deleted){deleted=true;throw Object.assign(Error('The response was lost'),{offline:true});}
    return {deleted:true,food_kept:false,already_removed:true};});
  await f.advance(5000);assert.equal(f.rows.get(JSON.stringify(['owner-a','retry-saved'])).removal.commitStarted,true);
  await f.removal.flush('owner-a');assert.equal(f.calls.length,2);assert.equal(f.rows.has(JSON.stringify(['owner-a','retry-saved'])),false);

  // A generic 404 can mean the server is too old to know this route; retain the card for retry.
  f=fixture();await f.removal.removeSaved('owner-a','old-server',45);f.setRequestHandler(()=>{throw Object.assign(Error('Not Found'),{status:404});});
  await f.advance(5000);assert.equal(f.rows.get(JSON.stringify(['owner-a','old-server'])).phase,'remove-failed');

  // Separate tabs share the IndexedDB lease, so only one sends while the first request is active.
  f=fixture();await f.add('owner-a','shared-tab',{phase:'remove',version:1,removal:{previousPhase:'process',undoUntil:0,commitStarted:true,commitOwner:null,commitUntil:0}});
  let releaseRemoval;f.setRequestHandler(()=>new Promise(resolve=>releaseRemoval=resolve));
  const first=f.removal.flush('owner-a');await new Promise(setImmediate);const second=f.createRemoval();
  await second.flush('owner-a');assert.equal(f.calls.length,1,'the active lease blocks a second tab');
  releaseRemoval({deleted:true});await first;assert.equal(f.rows.has(JSON.stringify(['owner-a','shared-tab'])),false);

  // A tab that crashed leaves a finite lease; another tab retries after it expires.
  f=fixture();await f.add('owner-a','expired-lease',{phase:'remove',version:1,removal:{previousPhase:'process',undoUntil:0,commitStarted:true,commitOwner:'closed-tab',commitUntil:2000}});
  await f.removal.flush('owner-a');assert.equal(f.calls.length,0);
  f.setClock(2001);await f.createRemoval().flush('owner-a');assert.equal(f.calls.length,1);
  assert.equal(f.rows.has(JSON.stringify(['owner-a','expired-lease'])),false);

  f=fixture();await f.removal.removeSaved('owner-a','logged-race',44);f.setRequestHandler(()=>{throw Object.assign(Error('This food was logged before it could be removed.'),{status:409});});
  await f.advance(5000);job=f.rows.get(JSON.stringify(['owner-a','logged-race']));
  assert.equal(job.phase,'remove-failed');assert.equal(job.removeError,true,'a concurrent log refuses unlogged deletion');
  f.setRequestHandler(null);assert.equal(await f.removal.retry('owner-a','logged-race'),true);await f.advance(5000);
  assert.equal(f.rows.has(JSON.stringify(['owner-a','logged-race'])),false,'explicit retry can complete when the server later accepts');

  // A user switch cannot Undo or flush another account's removal.
  f=fixture();await f.add('owner-a','same-id');await f.removal.remove('owner-a','same-id');
  await f.add('owner-b','same-id');f.setAccount('owner-b');
  assert.equal(await f.removal.undo('owner-a','same-id'),false);
  await f.removal.flush('owner-a');assert.equal(f.calls.length,0);
  assert.equal(f.rows.get(JSON.stringify(['owner-a','same-id'])).phase,'remove');
  assert.equal(f.rows.get(JSON.stringify(['owner-b','same-id'])).phase,'process');

  // If the account changes during the cancel request, its late response cannot
  // erase either account's durable row; owner A can retry it safely later.
  f=fixture();await f.add('owner-a','switch-id',{phase:'remove',version:1,removal:{previousPhase:'process',undoUntil:0,commitStarted:true}});
  let release;f.setRequestHandler(()=>new Promise(resolve=>release=resolve));
  const pending=f.removal.flush('owner-a');await new Promise(setImmediate);f.setAccount('owner-b');release({cancelled:true});await pending;
  assert.equal(f.rows.has(JSON.stringify(['owner-a','switch-id'])),true);
  assert.equal(f.rows.has(JSON.stringify(['owner-b','switch-id'])),false);
  f.setAccount('owner-a');f.setRequestHandler(null);f.setClock(6001);await f.removal.flush('owner-a');
  assert.equal(f.rows.has(JSON.stringify(['owner-a','switch-id'])),false);

  // A server-side tombstone is an idempotent completion, never a restored job.
  f=fixture();await f.add('owner-a','tombstone-id');await f.removal.remove('owner-a','tombstone-id');
  f.setRequestHandler(()=>{throw Object.assign(Error('This message was cancelled'),{code:'message_cancelled'});});
  await f.advance(5000);assert.equal(f.rows.has(JSON.stringify(['owner-a','tombstone-id'])),false);

  // If a food becomes logged during the Undo window, the server's 409 is a
  // refusal: restore the card and retain its local photo data.
  f=fixture();await f.add('owner-a','saved-race');await f.removal.remove('owner-a','saved-race');
  f.setRequestHandler(()=>{throw Object.assign(Error('This food is already saved. Use Undo on its card to remove it.'),{status:409});});
  await f.advance(5000);assert.equal(f.rows.get(JSON.stringify(['owner-a','saved-race'])).phase,'process');
  assert.equal(f.rows.get(JSON.stringify(['owner-a','saved-race'])).removeError,true);
  assert.equal(f.photoRows.has(JSON.stringify(['owner-a','saved-race'])),true);
  assert.equal(f.changes.at(-1).id,'saved-race');

  // A server refusal waits for explicit retry. Retrying reuses the stable id
  // and starts a new five-second Undo window.
  f=fixture();await f.add('owner-a','refused-id');await f.removal.remove('owner-a','refused-id');
  f.setRequestHandler(()=>{throw Object.assign(Error('server refused'),{status:500});});
  await f.advance(5000);assert.equal(f.rows.get(JSON.stringify(['owner-a','refused-id'])).removeError,true);
  await f.removal.flush('owner-a');assert.equal(f.calls.length,1,'stored refusal does not auto-retry');
  f.setRequestHandler(null);assert.equal(await f.removal.retry('owner-a','refused-id'),true);
  assert.equal(f.rows.get(JSON.stringify(['owner-a','refused-id'])).phase,'remove');
  await f.advance(5000);assert.equal(f.rows.has(JSON.stringify(['owner-a','refused-id'])),false);
  console.log('food removal: durable pause, Undo, expiry, photos, stale responses, offline retry and owner isolation PASS');
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports=run;
