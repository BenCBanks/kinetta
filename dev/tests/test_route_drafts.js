// Exercise production device-storage helpers with account/server changes and deletion. No devices or network.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/planner.js','utf8');
const localStorage={},sessionStorage={removeItem(k){delete this[k]}};
Object.defineProperty(localStorage,'removeItem',{enumerable:false,value(k){delete this[k]}});
const c={App:{me:{id:1}},server:'first',serverKey:()=>c.server,localStorage,sessionStorage,Segments:{pending:{}},store:{
 get(k){return localStorage[k]?JSON.parse(localStorage[k]):null},set(k,v){localStorage[k]=JSON.stringify(v)},del(k){delete localStorage[k]}}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const planDraftKey'),source.indexOf('// ---------- the map editor')),c);
vm.runInContext('this.track=PlanTrack;this.draftKey=planDraftKey',c);
const own=c.draftKey('new');c.store.set(own,{name:'Private route'});c.track.set({name:'Private overlay'});
sessionStorage['kinetta.segmentReview:first:1']='private segment';
c.App.me={id:2};assert.notEqual(c.draftKey('new'),own);assert.equal(c.store.get(c.draftKey('new')),null);assert.equal(c.track.get(),null);
const other=c.draftKey('new');c.store.set(other,{name:'Other route'});c.track.set({name:'Other overlay'});
c.App.me={id:1};c.server='second';assert.equal(c.store.get(c.draftKey('new')),null);assert.equal(c.track.get(),null);
c.server='first';assert.equal(c.track.get().name,'Private overlay');c.track.eraseDevice();
assert.equal(localStorage[own],undefined);assert.equal(c.track.get(),null);assert.equal(sessionStorage['kinetta.segmentReview:first:1'],undefined);assert.equal(c.Segments.pending,null);
assert.equal(c.store.get(other).name,'Other route');c.App.me={id:2};assert.equal(c.track.get().name,'Other overlay');
c.App.me=null;assert.equal(c.track.key(),null);assert.equal(c.draftKey('new'),null);c.track.set({name:'Unsigned'});assert.equal(localStorage.null,undefined);
console.log('PASS route device storage: account/server isolation, own deletion, anonymous writes refused');

// A completed save drains older autosaves before deleting; an old timer cannot recreate a saved-route draft.
(async()=>{
 let owner='A',pending,calls=[],local=new Map(),cancelled=[];
 const context={Promise,readOwner:()=>owner,api_state:()=>({name:'Fictional draft'}),planDraftKey:k=>owner+':'+k,
  keepDraft(){local.set(owner+':new','draft');return true;},store:{del:k=>local.delete(k)},json:(method,body)=>({method,body}),
  api:(path,opts)=>{calls.push([path,opts.method]);if(opts.method==='PUT')return new Promise(resolve=>pending=resolve);return Promise.resolve({});},
  clearTimeout:id=>cancelled.push(id),drawStatus(){}};
 vm.createContext(context);vm.runInContext("let S={owner:'A',key:'new'},saveT=12,elevT=13,autosave='';this.state=()=>S;this.change=()=>S={owner:'B',key:'new'};"+source.slice(source.indexOf('  async function persist()'),source.indexOf('  function saveSheet(')),context);
 const first=context.persist();await Promise.resolve();await Promise.resolve();assert.equal(calls.length,1);
 const queued=context.persist(),done=context.forget();await Promise.resolve();assert.equal(context.state().key,null);assert.equal(calls.length,1,'DELETE waits for the in-flight write');await context.persist();assert.equal(calls.length,1);
 pending();await Promise.all([first,queued,done]);assert.deepEqual(calls,[['/api/route-drafts/new','PUT'],['/api/route-drafts/new','DELETE']]);assert.equal(local.size,0);assert.deepEqual(cancelled,[12,13]);
 // A captured owner's cleanup cannot delete the new owner's draft after an account switch.
 calls=[];vm.runInContext("S={owner:'A',key:'new'}",context);const writing=context.persist();await Promise.resolve();await Promise.resolve();const removing=context.forget();owner='B';context.change();pending();await Promise.all([writing,removing]);assert.deepEqual(calls,[['/api/route-drafts/new','PUT']]);
 console.log('PASS route draft completion: serialized writes, drained deletion, cancelled timers, no resurrection and no late new-owner cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
