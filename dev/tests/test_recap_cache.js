'use strict';
// Exercise the real private read function with controlled transport and owner-scoped storage.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.RECAP_SOURCE||'app/static/recaps.js','utf8').replace('return{open,entry,offer','return{read,open,entry,offer');
function fixture(zone='UTC'){
 let clock='2026-11-01T00:30:00Z',owner='server-a/account-one';const saved=new Map();
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return Date.parse(clock);}}
 const c={Date:FixedDate,Intl,App:{me:{id:1,tz:zone}},readOwner:()=>owner,serverKey:()=> 'server-a',store:{get:()=>null},api:async()=>{throw Error('Offline');}};
 c.keep=(key,data)=>saved.set(owner+'|'+key,data);c.kept=key=>saved.get(owner+'|'+key);
 vm.createContext(c);vm.runInContext(source+'\nthis.recaps=Recaps;',c);
 return{c,saved,time:value=>clock=value,owner:value=>owner=value};
}
const facts=(extra={})=>({period:'this_month',start:'2026-11-01',tz:'UTC',...extra});
(async()=>{
 let f=fixture();f.time('2026-10-31T23:59:59Z');f.c.api=async()=>{f.time('2026-11-01T00:00:01Z');return facts();};await f.c.recaps.read('this_month');f.c.api=async()=>{throw Error('Offline');};assert.equal((await f.c.recaps.read('this_month')).from_cache,true,'Response after midnight is saved under its returned period');
 assert([...f.saved.keys()].some(k=>k.includes('start=2026-11-01&tz=UTC')));
 f=fixture(undefined);delete f.c.App.me.tz;f.c.api=async()=>facts({tz:'Pacific/Kiritimati'});await f.c.recaps.read('this_month');f.c.api=async()=>{throw Error('Offline');};assert.equal((await f.c.recaps.read('this_month')).tz,'Pacific/Kiritimati','Unknown profile learns the owner-scoped server timezone');
 f=fixture();f.c.keep('/api/recaps?period=this_month&start=2026-11-01',facts());assert.equal((await f.c.recaps.read('this_month')).from_cache,true,'Compatible old cache remains usable');
 f.c.keep('/api/recaps?period=this_month&start=2026-11-01',facts({period:'last_month'}));await assert.rejects(f.c.recaps.read('this_month'),/Offline/,'Wrong cached period is rejected');
 f=fixture();let finish;f.c.api=()=>new Promise(resolve=>finish=resolve);let pending=f.c.recaps.read('this_month');f.c.App.me.tz='Pacific/Kiritimati';finish(facts());await assert.rejects(pending,/time zone changed/);assert.equal(f.saved.size,0,'Changed timezone cannot save or return old response');
 f=fixture();f.c.api=()=>new Promise(resolve=>finish=resolve);pending=f.c.recaps.read('this_month');f.owner('server-b/account-two');finish(facts());await assert.rejects(pending,/account or time zone changed/);assert.equal(f.saved.size,0,'Changed account/server cannot keep the old response');
 f=fixture();f.c.keep('/api/recaps?period=this_month&start=2026-11-01',facts());f.c.api=async()=>{throw Object.assign(Error('Forbidden'),{status:403});};await assert.rejects(f.c.recaps.read('this_month'),/Forbidden/,'Authentication/permission failures never use cached data');
 console.log('Recap cache: returned range, midnight crossing, learned timezone, legacy cache, range validation and owner/timezone/permission fences PASS');
})().catch(error=>{console.error(error);process.exit(1);});
