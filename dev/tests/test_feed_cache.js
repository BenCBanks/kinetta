// Real feed rendering function with controlled latency/data, no real users or maps.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/social.js','utf8');
let calls=0,draws=0,owner='one',resolve,epoch=0;const saved=new Map();   // stand-in for the phone's saved copies
const list={isConnected:true,_html:'',set innerHTML(v){this._html=v;draws++;},get innerHTML(){return this._html;},insertAdjacentHTML(){}},more={};
const ctx={App:{cache:new Map()},kept:(k)=>saved.get(k)||null,keep:(k,v)=>saved.set(k,v),readOwner:()=>owner,readEpoch:()=>epoch,readOnce:async()=>{calls++;return [];},$:(s)=>s==='#ff-list'?list:more,actTop:()=>'',whoseSeg:()=>'',wireWhose(){},skel:()=>'',postCard:()=>'',startCta:()=>'',feedMaps(){},wireCheers(){},route(){},console,Date,URLSearchParams};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const FEED_N'),source.indexOf('// ---------- someone else'))+'\nglobalThis.feed=homeFeed;globalThis.warm=warmFeed;',ctx);
(async()=>{
 await ctx.feed({});assert.equal(calls,2);assert.equal(draws,1);
 await ctx.feed({});assert.equal(calls,2,'fresh return needs zero network requests');assert.equal(draws,2,'cached rows render once');
 ctx.App.cache.get('feed:home').at=0;await ctx.feed({});assert.equal(calls,4);assert.equal(draws,3,'unchanged stale refresh does not rebuild maps/cards twice');
 ctx.App.cache.clear();saved.clear();ctx.readOnce=()=>new Promise(r=>{resolve=r;});
 // One shared resolver cannot resolve both calls, so use an explicit pending list.
 const pending=[];ctx.readOnce=()=>new Promise(r=>pending.push(r));const wait=ctx.feed({});owner='two';pending.forEach(r=>r([]));await wait;
 assert.equal(ctx.App.cache.has('feed:home'),false,'previous account response cannot refill feed cache');
 ctx.App.cache.clear();saved.clear();const next=[];ctx.readOnce=()=>new Promise(r=>next.push(r));const stale=ctx.feed({});epoch++;next.forEach(r=>r([]));await stale;assert.equal(ctx.App.cache.has('feed:home'),false,'an invalidated merged feed cannot refill its cache');
 // Reopened app: memory is empty but the phone kept the last feed, so it draws before any request returns.
 owner='one';epoch=0;ctx.App.cache.clear();saved.set('feed:home',{rows:[{start_time:'2026-10-16T09:00:00Z'}],more:false,friends:0});
 const slow=[];ctx.readOnce=()=>new Promise(r=>slow.push(r));draws=0;const reopen=ctx.feed({});await new Promise(setImmediate);
 assert.equal(draws,1,'saved copy shows at once');slow.forEach(r=>r([]));await reopen;assert.deepEqual(saved.get('feed:home').rows,[],'fresh feed replaces the saved copy');
 // Background warm-up after opening: fills memory and the saved copy once; skipped when already cached; ignores a changed account.
 ctx.App.cache.clear();saved.clear();calls=0;ctx.readOnce=async()=>{calls++;return [];};ctx.warm();await new Promise(setImmediate);
 assert.equal(calls,2);assert.equal(ctx.App.cache.has('feed:home'),true);assert.equal(saved.has('feed:home'),true);
 ctx.warm();await new Promise(setImmediate);assert.equal(calls,2,'warm-up skips a cached feed');
 ctx.App.cache.clear();saved.clear();const late=[];ctx.readOnce=()=>new Promise(r=>late.push(r));ctx.warm();owner='three';late.forEach(r=>r([]));await new Promise(setImmediate);
 assert.equal(ctx.App.cache.has('feed:home')||saved.has('feed:home'),false,'warm-up for a previous account is dropped');
 console.log('Feed: first load2 requests, warm return0, unchanged refresh1 render, late account response ignored; saved copy shows at once; warm-up fills once and ignores account changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
