// Run production erasure with unavailable IndexedDB/localStorage; never leave private rendered text.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const values=new Map(),owner=JSON.stringify(['https://fictional.invalid',1]);let fails=false,removed=false;
const c={App:{me:{id:1}},Native:{base:''},location:{origin:'https://fictional.invalid'},ThreadDB:{list:async()=>[{images:['fictional-photo']}],erase:async()=>{if(fails)throw Error('DB unavailable')}},store:{get:k=>values.get(k)},localStorage:{removeItem:k=>values.delete(k)},foodOutbox:()=>({flush:async()=>{}}),readOwner:()=>owner,addEventListener(){},document:{addEventListener(){}},setInterval(){},console};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/thread.js','utf8').replace('return {collecting:','return {testCurrent:v=>current=v,collecting:')+'\nglobalThis.thread=FoodThread',c);
(async()=>{for(const fail of [false,true]){fails=fail;removed=false;values.set('fit.thread.history:'+owner,['Private fictional history']);values.set('fit.thread.draft:'+owner,'Unsent words');values.set('fit.thread.context:'+owner,'old-card');values.set('fit.food.review.draft:'+owner,'private-draft-id');values.set('other-owner','Keep');assert.equal(await c.thread.pendingCount(),2);c.thread.testCurrent({owner,messages:['Private fictional history'],jobs:[{}],el:{replaceChildren:()=>removed=true}});if(fail)await assert.rejects(c.thread.eraseDevice(),/DB unavailable/);else await c.thread.eraseDevice();assert(removed);assert.equal(values.has('fit.thread.history:'+owner),false);assert.equal(values.has('fit.thread.draft:'+owner),false);assert.equal(values.has('fit.thread.context:'+owner),false);assert.equal(values.has('fit.food.review.draft:'+owner),false);assert.equal(values.get('other-owner'),'Keep');}console.log('thread privacy: pending photos+draft warning count, erasure success/failure clears rendered history and draft, other owner preserved PASS')})().catch(e=>{console.error(e);process.exit(1)});

// Temporary previews have no persistent storage; owner isolation and lifecycle use the real cache.
vm.runInContext('globalThis.photoCache=foodChatPhotoCache()',c);
const photos=c.photoCache;
photos.put('a','photo','draft-a',['data:image/jpeg;base64,/9j/']);
photos.put('b','photo','draft-b',['data:image/jpeg;base64,/9j/']);
assert.equal(photos.get('a','photo').length,1);assert.equal(photos.get('other','photo').length,0);
photos.clear('a','different-draft');assert.equal(photos.get('a','photo').length,1);
photos.clear('a','draft-a');assert.equal(photos.get('a','photo').length,0);assert.equal(photos.get('b','photo').length,1);
photos.put('a','cancelled','d',['preview']);photos.remove('a','cancelled');assert.equal(photos.get('a','cancelled').length,0);
photos.put('a','expired','d',['preview']);photos.prune('a',new Set());assert.equal(photos.get('a','expired').length,0);
photos.clear('b');assert.equal(photos.get('b','photo').length,0);
console.log('temporary photo previews: per-owner memory only, matching draft cleanup, cancellation and remote clear pruning PASS');

// Run actual confirmation merging with no mounted chat, including failed device storage.
(async()=>{
 let unreadable=false,job={id:'photo',draft_id:'draft-a',images:['full-image'],previews:['thumbnail']};
 const env={...c,invalidate(){},ThreadDB:{list:async()=>{if(unreadable)throw Error('Device storage unavailable');return job?[job]:[];},update:async(owner,id,fn)=>job=fn(job)}};
 vm.createContext(env);vm.runInContext(fs.readFileSync('app/static/thread.js','utf8').replace('return {collecting:','return {testPhotos:photos,collecting:')+'\nglobalThis.thread=FoodThread',env);
 const root={id:10,client_id:'photo',kind:'user',result:{draft_id:'draft-a'}};
 env.thread.testPhotos.put(owner,'photo','draft-a',['thumbnail']);
 await env.thread.accept({messages:[root,{reply_to:10,result:{kind:'reviewed'}}]});
 assert.equal(env.thread.testPhotos.get(owner,'photo').length,0);assert.equal(job.images,undefined);assert.equal(job.previews,undefined);
 unreadable=true;env.thread.testPhotos.put(owner,'photo','draft-a',['thumbnail']);
 await env.thread.accept({messages:[root,{reply_to:10,result:{kind:'log',food_review:true,confirmed:'saved'},entries:[{id:1}]}]});
 assert.equal(env.thread.testPhotos.get(owner,'photo').length,0,'confirmed logging erases memory even when IndexedDB cannot open');
 console.log('photo confirmation merge: cleanup while chat unmounted, pending pixel removal and unavailable IndexedDB PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
