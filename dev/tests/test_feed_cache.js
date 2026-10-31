// Real feed rendering function with controlled latency/data, no real users or maps.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/social.js','utf8');
let calls=0,draws=0,owner='one',resolve,epoch=0;const saved=new Map();   // stand-in for the phone's saved copies
const list={isConnected:true,_html:'',set innerHTML(v){this._html=v;draws++;},get innerHTML(){return this._html;},insertAdjacentHTML(){}},more={};
const ctx={App:{cache:new Map()},kept:(k)=>saved.get(k)||null,keep:(k,v)=>saved.set(k,v),readOwner:()=>owner,readEpoch:()=>epoch,readOnce:async()=>{calls++;return [];},$:(s)=>s==='#ff-list'?list:more,svg:()=>'',actTop:()=>'',whoseSeg:()=>'',wireWhose(){},skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',postCard:()=>'',startCta:()=>'',feedMaps(){},wireCheers(){},feedPeople(){},inviteFriends(){},route(){},console,Date,URLSearchParams};
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
 // Extra pages survive detail visits; expired views revalidate their full visible depth.
 owner='paged';epoch=0;ctx.App.cache.clear();saved.clear();const paths=[];
 const rows=Array.from({length:120},(_,i)=>({id:i+1,visibility:'friends',start_time:new Date(Date.UTC(2026,0,15,12)-i*3600000).toISOString()}));
 ctx.readOnce=async path=>{paths.push(path);const q=new URL('https://example.test'+path).searchParams,limit=+q.get('limit');assert(limit<=50,'both feed APIs support this page size');if(path.startsWith('/api/feed/'))return [];return rows.filter(r=>!q.get('before')||r.start_time<q.get('before')).slice(0,limit);};
 await ctx.feed({});assert.equal(ctx.App.cache.get('feed:home').data.rows.length,15);
 await more.onclick();assert.equal(ctx.App.cache.get('feed:home').data.rows.length,30,'Show more updates the session cache');assert.equal(saved.get('feed:home').rows.length,15,'only the small opening page is persisted');
 const beforeReturn=paths.length;await ctx.feed({});assert.equal(paths.length,beforeReturn,'fresh return uses every loaded card with no GET');
 await more.onclick();await more.onclick();assert.equal(ctx.App.cache.get('feed:home').data.rows.length,60);
 ctx.App.cache.get('feed:home').at=0;await ctx.feed({});assert.equal(ctx.App.cache.get('feed:home').data.rows.length,60,'stale return revalidates deeper than a single API page');assert.equal(saved.get('feed:home').rows.length,15);
 const normalReads=ctx.readOnce,was=ctx.App.cache.get('feed:home'),latePages=[];ctx.readOnce=()=>new Promise(r=>latePages.push(r));const loading=more.onclick();epoch++;latePages.forEach(r=>r([]));await loading;assert.equal(ctx.App.cache.get('feed:home'),was,'invalidated pagination cannot overwrite a newer view');
 assert.equal(more.disabled,false,'invalidated pagination still releases its button');
 ctx.readOnce=normalReads;await more.onclick();assert.equal(ctx.App.cache.get('feed:home').data.rows.length,75,'a new revision can keep browsing after a reaction/edit');
 // Cached Show more responds even while a slow first-page revalidation is pending.
 ctx.App.cache.get('feed:home').at=0;const delayed=[];ctx.readOnce=path=>new Promise(resolve=>delayed.push({path,resolve}));
 const opening=ctx.feed({});assert.equal(typeof more.onclick,'function');const loadingMore=more.onclick();assert.equal(delayed.length,4);
 delayed[2].resolve(rows.slice(75,90));delayed[3].resolve([]);await loadingMore;assert.equal(ctx.App.cache.get('feed:home').data.rows.length,90);
 delayed[0].resolve(rows.slice(0,50));delayed[1].resolve([]);await opening;assert.equal(ctx.App.cache.get('feed:home').data.rows.length,90,'a late first-page refresh cannot remove newly loaded cards');
 // A saved opening view has the same metadata as a live first page, so unchanged
 // records do not rebuild cards/maps just because older friends exist beyond it.
 owner='saved';epoch=0;ctx.App.cache.clear();saved.clear();
 ctx.readOnce=async path=>path.startsWith('/api/feed/')?rows.slice(90,105).map(r=>({...r,owner:{login:'fictional-friend'}})):rows.slice(0,15);
 await ctx.feed({});ctx.App.cache.clear();draws=0;await ctx.feed({});assert.equal(draws,1,'unchanged saved opening view renders once, without a metadata-only rebuild');
 // Shared timestamps cross both readers; cursor identity must reach both APIs.
 owner='ties';epoch=0;ctx.App.cache.clear();saved.clear();const tied=Array.from({length:40},(_,i)=>({id:40-i,visibility:i%2?'friends':i%4?'everyone':'me',start_time:'2026-10-20T12:00:00Z',...(i%2?{owner:{login:'friend'}}:{})}));ctx.readOnce=async path=>{const q=new URL('https://example.test'+path).searchParams,isFriend=path.startsWith('/api/feed/');return tied.filter(row=>!!row.owner===isFriend&&(!q.has('before_id')||row.id<+q.get('before_id'))).slice(0,+q.get('limit'));};await ctx.feed({});await more.onclick();await more.onclick();assert.deepEqual(JSON.parse(JSON.stringify(ctx.App.cache.get('feed:home').data.rows.map(row=>row.id))),tied.map(row=>row.id),'same-start activities are never skipped across merged pages');
 // Old account-scoped caches include own private/unclassified rows; never paint another person’s explicit private row.
 owner='own-private';ctx.App.me={login:'fictional-self'};ctx.App.cache.clear();const painted=[];ctx.postCard=a=>{painted.push(a.id);return '<article>'+a.id+'</article>';};
 ctx.App.cache.set('feed:home',{at:Date.now(),data:{rows:[{id:1,visibility:'me'},{id:2,visibility:'friends'},{id:3,owner:{login:'fictional-friend'}},{id:4},{id:5,owner:{login:'fictional-other'},visibility:'me'},{id:6,owner:{login:'fictional-self'},visibility:'me'}],more:false,friends:1}});
 await ctx.feed({});assert.deepEqual(painted,[1,2,3,4,6],'own private and legacy rows paint; another person’s private row never does');
 console.log('Feed: first load2 requests, warm return0, unchanged refresh1 render, late account response ignored; saved copy shows at once; warm-up fills once and ignores account changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
