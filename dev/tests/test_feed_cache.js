// Real feed rendering function with controlled latency/data, no real users or maps.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/social.js','utf8');
let calls=0,draws=0,owner='one',resolve,epoch=0;
const list={isConnected:true,_html:'',set innerHTML(v){this._html=v;draws++;},get innerHTML(){return this._html;},insertAdjacentHTML(){}},more={};
const ctx={App:{cache:new Map()},readOwner:()=>owner,readEpoch:()=>epoch,readOnce:async()=>{calls++;return [];},$:(s)=>s==='#ff-list'?list:more,actTop:()=>'',whoseSeg:()=>'',wireWhose(){},skel:()=>'',postCard:()=>'',startCta:()=>'',feedMaps(){},wireCheers(){},route(){},console,Date,URLSearchParams};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const FEED_N'),source.indexOf('// ---------- someone else'))+'\nglobalThis.feed=homeFeed;',ctx);
(async()=>{
 await ctx.feed({});assert.equal(calls,2);assert.equal(draws,1);
 await ctx.feed({});assert.equal(calls,2,'fresh return needs zero network requests');assert.equal(draws,2,'cached rows render once');
 ctx.App.cache.get('feed:home').at=0;await ctx.feed({});assert.equal(calls,4);assert.equal(draws,3,'unchanged stale refresh does not rebuild maps/cards twice');
 ctx.App.cache.clear();ctx.readOnce=()=>new Promise(r=>{resolve=r;});
 // One shared resolver cannot resolve both calls, so use an explicit pending list.
 const pending=[];ctx.readOnce=()=>new Promise(r=>pending.push(r));const wait=ctx.feed({});owner='two';pending.forEach(r=>r([]));await wait;
 assert.equal(ctx.App.cache.has('feed:home'),false,'previous account response cannot refill feed cache');
 ctx.App.cache.clear();const next=[];ctx.readOnce=()=>new Promise(r=>next.push(r));const stale=ctx.feed({});epoch++;next.forEach(r=>r([]));await stale;assert.equal(ctx.App.cache.has('feed:home'),false,'an invalidated merged feed cannot refill its cache');
 console.log('Feed: first load2 requests, warm return0, unchanged refresh1 render, late account response ignored');
})().catch(e=>{console.error(e);process.exitCode=1;});
