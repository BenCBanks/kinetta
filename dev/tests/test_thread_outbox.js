// Execute the production outbox with durable stand-in storage and reordered transport.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={console,navigator:{onLine:true}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/thread-store.js','utf8'),ctx);
function fixture(){
 const rows=new Map();let session='account-a',calls=[],releases=[],fail=null;
 const db={list:async owner=>[...rows.values()].filter(j=>j.owner===owner),put:async(owner,id,v)=>rows.set(id,{...v,owner,id}),remove:async(owner,id)=>rows.delete(id),update:async(owner,id,fn)=>{if(!rows.has(id))return null;const v=fn(rows.get(id));rows.set(id,v);return v;}};
 const request=async(path,body)=>{calls.push({path,body});if(fail)throw fail;if(releases.length)return releases.shift()(path,body);if(path.endsWith('/messages'))return {message:{id:7}};if(path.endsWith('/process'))return {messages:[{reply_to:7,result:{can_resolve:true}}]};return {messages:[{reply_to:7,result:{kind:'log'}}]};};
 const outbox=ctx.foodOutbox({db,request,session:()=>session,changed:async()=>{}});
 const add=()=>db.put('owner-a','stable-id',{body:'A bowl of fictional oats',at:'2026-10-17T08:00:00Z',phase:'process'});
 return {rows,db,outbox,calls,releases,add,setSession:v=>session=v,setFail:v=>fail=v};
}
(async()=>{
 let f=fixture();await f.add();await f.outbox.flush('owner-a');assert.equal(f.calls.length,3);assert.equal(f.calls[0].body.client_id,'stable-id');assert.equal(f.calls[0].body.captured_at,'2026-10-17T08:00:00Z');assert.equal(f.rows.size,0);
 f=fixture();await f.add();f.setFail({offline:true});await f.outbox.flush('owner-a');assert.equal(f.rows.size,1);assert(!f.rows.get('stable-id').error);f.setFail(null);await f.outbox.flush('owner-a');assert.equal(f.calls[1].body.client_id,'stable-id','lost response resumes same UUID');
 f=fixture();await f.add();f.setFail(Error('Check that portion'));await f.outbox.flush('owner-a');await f.outbox.flush('owner-a');assert.equal(f.calls.length,1);assert.equal(f.rows.get('stable-id').error,'Check that portion');
 f=fixture();await f.add();let release;f.releases.push(()=>new Promise(r=>release=r));let pending=f.outbox.flush('owner-a');await new Promise(setImmediate);f.setSession('account-b');release({message:{id:7}});await pending;assert.equal(f.calls.length,1);assert.equal(f.rows.size,1,'account switch cannot advance/send another phase');
 f=fixture();await f.add();f.releases.push(()=>new Promise(r=>release=r));pending=f.outbox.flush('owner-a');await new Promise(setImmediate);await f.db.update('owner-a','stable-id',j=>({...j,phase:'cancel'}));release({message:{id:7}});await pending;assert.equal(f.rows.get('stable-id').phase,'cancel','in-flight append cannot resurrect cancelled work');await f.outbox.flush('owner-a');assert(f.calls[1].path.endsWith('/cancel'));assert.equal(f.rows.size,0);
 f=fixture();await f.add();f.setFail({code:'message_cancelled'});await f.outbox.flush('owner-a');assert.equal(f.rows.size,0,'server tombstone clears a stale queued upload');
 f=fixture();await f.add();f.releases.push(()=>new Promise(r=>release=r));pending=f.outbox.flush('owner-a');await new Promise(setImmediate);await f.outbox.flush('owner-a');assert.equal(f.calls.length,1,'same-session flushes serialize');release({message:{id:7}});await pending;
 console.log('food outbox: stable UUID/capture, offline replay, retained errors, account switches, cancellation races, tombstones and serialization PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
