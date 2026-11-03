// Durable removal and Undo stay scoped to a fictional account and outbox job.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={setTimeout,clearTimeout,navigator:{onLine:true}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/food-removal.js','utf8'),ctx);
function fixture(){
  const rows=new Map(),photoRows=new Map(),calls=[],changes=[],timers=new Map();
  let account='owner-a',clock=1000,connected=true,nextTimer=0,requestHandler=null;
  const key=(owner,id)=>JSON.stringify([owner,id]);
  const db={
    list:async owner=>[...rows.values()].filter(j=>j.owner===owner).sort((a,b)=>a.at.localeCompare(b.at)),
    put:async(owner,id,value)=>rows.set(key(owner,id),{...value,owner,id}),
    update:async(owner,id,fn)=>{const k=key(owner,id),current=rows.get(k);if(!current)return null;const value=fn(current);rows.set(k,value);return value;},
    remove:async(owner,id)=>rows.delete(key(owner,id)),
  };
  function createRemoval(){return ctx.foodThreadRemoval({db,session:()=>account,now:()=>clock,undoMs:6000,
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
  return {rows,photoRows,calls,changes,timers,db,get removal(){return removal;},add,advance,
    setAccount:v=>account=v,setOnline:v=>connected=v,setRequestHandler:v=>requestHandler=v,
    getNow:()=>clock,dropTimers:()=>timers.clear(),reload:()=>{timers.clear();removal=createRemoval();},
  };
}
(async()=>{
  let f=fixture();await f.add();
  const originalVersion=f.rows.get(JSON.stringify(['owner-a','stable-id'])).version||0;
  assert.equal(await f.removal.remove('owner-a','stable-id'),true);
  let job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'remove');assert.equal(job.removal.undoUntil,f.getNow()+6000);
  assert.equal(job.version,originalVersion+1);assert.deepEqual(job.images,['fictional-jpeg']);
  assert.deepEqual(f.photoRows.get(JSON.stringify(['owner-a','stable-id'])),['fictional-preview']);
  assert.equal(await f.removal.owns('owner-a','stable-id',originalVersion),false,'removal invalidates in-flight work');
  await f.removal.flush('owner-a');assert.equal(f.calls.length,0,'the outbox waits through the Undo window');

  // A reload loses JavaScript timers but not the durable deadline; startup
  // schedules finalization again from the stored removal intent.
  f.reload();await f.removal.flush('owner-a');assert.equal(f.timers.size,1);
  await f.advance(5999);assert.equal(f.calls.length,0);
  await f.advance(1);assert.equal(f.calls.length,1);

  f=fixture();await f.add();assert.equal(await f.removal.remove('owner-a','stable-id'),true);
  await f.advance(1500);assert.equal(await f.removal.undo('owner-a','stable-id'),true);
  job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'process');assert.equal(job.version,2);assert.equal(job.removal,undefined);
  assert.equal(job.id,'stable-id');assert.deepEqual(job.images,['fictional-jpeg']);
  assert.deepEqual(f.photoRows.get(JSON.stringify(['owner-a','stable-id'])),['fictional-preview']);
  assert.equal(await f.removal.owns('owner-a','stable-id',originalVersion),false,'Undo cannot authorize an older response');
  assert.equal(await f.removal.undo('owner-a','stable-id'),false,'a stale Undo callback is harmless');
  assert.equal(f.calls.length,0);

  f=fixture();await f.add();await f.removal.remove('owner-a','stable-id');await f.advance(6000);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/food/thread/cancel');
  assert.equal(f.calls[0].body.client_id,'stable-id');
  assert.equal(f.rows.has(JSON.stringify(['owner-a','stable-id'])),false);
  assert.equal(f.photoRows.has(JSON.stringify(['owner-a','stable-id'])),false);

  // Expiry while offline clears photos but keeps a durable cancellation intent.
  f=fixture();await f.add();await f.removal.remove('owner-a','stable-id');f.setOnline(false);await f.advance(6000);
  job=f.rows.get(JSON.stringify(['owner-a','stable-id']));
  assert.equal(job.phase,'remove');assert.equal(job.removal.commitStarted,true);assert.equal(job.images,undefined);
  assert.equal(job.previews,undefined);assert.equal(job.offline,true);assert.equal(f.photoRows.has(JSON.stringify(['owner-a','stable-id'])),false);
  assert.equal(f.calls.length,0);
  // A newly created controller over the same durable row resumes the tombstone.
  f.setOnline(true);await f.removal.flush('owner-a');
  assert.equal(f.calls.length,1);assert.equal(f.rows.has(JSON.stringify(['owner-a','stable-id'])),false);

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
  f.setAccount('owner-a');f.setRequestHandler(null);await f.removal.flush('owner-a');
  assert.equal(f.rows.has(JSON.stringify(['owner-a','switch-id'])),false);

  // A server-side tombstone is an idempotent completion, never a restored job.
  f=fixture();await f.add('owner-a','tombstone-id');await f.removal.remove('owner-a','tombstone-id');
  f.setRequestHandler(()=>{throw Object.assign(Error('This message was cancelled'),{code:'message_cancelled'});});
  await f.advance(6000);assert.equal(f.rows.has(JSON.stringify(['owner-a','tombstone-id'])),false);
  console.log('food removal: durable pause, Undo, expiry, photos, stale responses, offline retry and owner isolation PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
