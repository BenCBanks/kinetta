// Execute the production outbox with durable stand-in storage and reordered transport.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={console,navigator:{onLine:true},AbortController,setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/thread-store.js','utf8'),ctx);
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
 f=fixture();await f.db.put('owner-a','photo-id',{body:'Half a turkey sub, no mayo',media:'photo',itemize:true,images:['fictional-jpeg'],phase:'process'});await f.outbox.flush('owner-a');assert.equal(f.calls[0].body.itemize,true);assert.equal(f.calls[0].body.body,'Half a turkey sub, no mayo');assert.equal(f.calls[2].body.itemize,true);assert.equal(f.calls[2].body.images[0],'fictional-jpeg');
 f=fixture();await f.add();f.setFail({offline:true});await f.outbox.flush('owner-a');assert.equal(f.rows.size,1);assert(!f.rows.get('stable-id').error);f.setFail(null);await f.outbox.flush('owner-a');assert.equal(f.calls[1].body.client_id,'stable-id','lost response resumes same UUID');
 f=fixture();await f.add();f.setFail(Error('Check that portion'));await f.outbox.flush('owner-a');await f.outbox.flush('owner-a');assert.equal(f.calls.length,1);assert.equal(f.rows.get('stable-id').error,'Check that portion');
 f=fixture();await f.add();let release;f.releases.push(()=>new Promise(r=>release=r));let pending=f.outbox.flush('owner-a');await new Promise(setImmediate);f.setSession('account-b');release({message:{id:7}});await pending;assert.equal(f.calls.length,1);assert.equal(f.rows.size,1,'account switch cannot advance/send another phase');
 f=fixture();await f.add();f.releases.push(()=>new Promise(r=>release=r));pending=f.outbox.flush('owner-a');await new Promise(setImmediate);await f.db.update('owner-a','stable-id',j=>({...j,phase:'cancel'}));release({message:{id:7}});await pending;assert.equal(f.rows.get('stable-id').phase,'cancel','in-flight append cannot resurrect cancelled work');await f.outbox.flush('owner-a');assert(f.calls[1].path.endsWith('/cancel'));assert.equal(f.rows.size,0);
 f=fixture();await f.add();f.setFail({code:'message_cancelled'});await f.outbox.flush('owner-a');assert.equal(f.rows.size,0,'server tombstone clears a stale queued upload');
 f=fixture();await f.add();f.releases.push(()=>new Promise(r=>release=r));pending=f.outbox.flush('owner-a');await new Promise(setImmediate);await f.outbox.flush('owner-a');assert.equal(f.calls.length,1,'same-session flushes serialize');release({message:{id:7}});await pending;
 f=fixture();await f.add();await f.db.update('owner-a','stable-id',j=>({...j,phase:'cancel'}));await f.db.put('owner-a','next-id',{body:'Next food',at:'2026-10-17T09:00:00Z',phase:'process'});f.releases.push(()=>{throw {status:409}});await f.outbox.flush('owner-a');assert.equal(f.rows.size,0,'already-saved cancel409 never blocks later messages');
 f=fixture();await f.add();await f.db.update('owner-a','stable-id',j=>({...j,day:'2026-10-16',meal:'dinner',offline:true}));f.releases.push(()=>({message:{id:7}}));await f.outbox.flush('owner-a');assert.equal(f.calls[0].body.day,'2026-10-16');assert.equal(f.calls[0].body.meal,'dinner');assert.equal(f.rows.size,0);
 f=fixture();const ingredients=[{name:'Fictional soup',kcal:400}];await f.db.put('owner-a','manual-id',{items:ingredients,draft_id:'draft-one',phase:'process'});f.setFail({offline:true});await f.outbox.flush('owner-a');assert.equal(f.rows.size,1);f.setFail(null);await f.outbox.flush('owner-a');assert.equal(f.rows.size,0);assert.equal(f.calls[1].path,'/api/food/thread/reviews/items');assert.equal(f.calls[1].body.client_id,'manual-id');assert.equal(f.calls[1].body.draft_id,'draft-one');assert.deepEqual(f.calls[1].body.items,ingredients);
 f=fixture();await f.db.put('owner-a','recipe-id',{dish:{did:12,portion:{grams:100}},draft_id:'draft-two',phase:'process'});await f.outbox.flush('owner-a');assert.equal(f.calls[0].path,'/api/food/thread/reviews/dish');assert.equal(f.calls[0].body.did,12);assert.equal(f.rows.size,0);
 // Mixed native/server versions must keep the original request intact and never
 // fall back to the legacy endpoint that can log without review.
 f=fixture();await f.add();await f.db.update('owner-a','stable-id',j=>({...j,body:'Taco',review_only:true,draft_id:'draft-three'}));
 f.setFail({status:422,message:'Extra inputs are not permitted; Extra inputs are not permitted',detail:[{type:'extra_forbidden',loc:['body','review_only']},{type:'extra_forbidden',loc:['body','draft_id']}]});
 await f.outbox.flush('owner-a');assert.equal(f.calls.length,1);assert.match(f.rows.get('stable-id').error,/server update/);assert.equal(f.rows.get('stable-id').review_only,true);assert.equal(f.rows.get('stable-id').draft_id,'draft-three');
 await f.outbox.flush('owner-a');assert.equal(f.calls.length,1,'mismatch waits for explicit Retry');
 await f.db.update('owner-a','stable-id',j=>({...j,error:null}));f.setFail(null);await f.outbox.flush('owner-a');assert.equal(f.rows.size,0);assert.deepEqual(f.calls[1].body,f.calls[0].body,'after server update Retry retains UUID and review contract');
 assert.match(ctx.foodThreadError({status:404,message:'Not Found'},'/api/food/thread/reviews/draft/example'),/server update/);
 assert.equal(ctx.foodThreadError({status:404,message:'Food not found'},'/api/food/thread/messages/7'),'Food not found');
 assert.equal(ctx.foodThreadError({status:404,message:'Recipe not found',detail:'Recipe not found'},'/api/food/thread/reviews/dish'),'Recipe not found');
 assert.equal(ctx.foodThreadError({status:422,message:'Enter a portion',detail:[{type:'greater_than',loc:['body','amount']}]},'/api/food/thread/messages'),'Enter a portion');
 console.log('food outbox: stable UUID/capture, offline replay, retained errors, account switches, cancellation races, tombstones and serialization PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
