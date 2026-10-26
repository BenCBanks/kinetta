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
