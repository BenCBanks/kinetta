'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/recaps.js','utf8');
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
 let owner='fictional-server/account-one',loads=0,currentGate=gate();const calls=[],toasts=[],saved=new Map(),nodes=new Map();
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-01T12:00:00Z']));}}
 const c={Date:FixedDate,Intl,Promise,App:{me:{id:1,tz:'UTC'}},location:{pathname:'/progress',search:''},readOwner:()=>owner,serverKey:()=> 'fictional-server',store:{get:()=>null,set(){}},keep:(key,data)=>saved.set(key,data),kept:key=>saved.get(key),toast:text=>toasts.push(text),esc:String,svg:()=>'',document:{createElement:()=>({setAttribute(){}})},$:selector=>nodes.get(selector),loadRecapEditor:()=>{loads++;return currentGate.promise;},RecapEditor:{create(deps){return{open:(initial,callback)=>calls.push({initial,callback,deps}),draw:async(data,options)=>({data,options})};}}};
 vm.createContext(c);vm.runInContext(source+'\nthis.recaps=Recaps;',c);
 return{c,calls,toasts,nodes,loads:()=>loads,owner:value=>owner=value,release:()=>currentGate.resolve(),fail:()=>currentGate.reject(Error('Fictional offline bundle')),retry:()=>{currentGate=gate();}};
}
(async()=>{
 let f=fixture();assert.equal(f.c.recaps.today(),'2026-11-01');assert.equal(f.c.recaps.startFor('last_month'),'2026-10-01');assert.equal(f.loads(),0,'date helpers need no editor request');
 let callback=()=>{},first=f.c.recaps.open({period:'year',offset:3},callback),second=f.c.recaps.open({period:'year',offset:3},callback);assert.equal(first,second,'concurrent taps share the pending intent');await Promise.resolve();assert.equal(f.loads(),1);f.release();await first;assert.equal(f.calls.length,1);assert.equal(f.calls[0].initial.period,'year');assert.equal(f.calls[0].initial.offset,3);assert.equal(f.calls[0].callback,callback,'share/save callback survives deferred opening');
 await f.c.recaps.open('last_month');assert.equal(f.loads(),1,'loaded leaf remains memoized');assert.equal(f.calls[1].initial,'last_month');
 for(const change of [x=>x.owner('fictional-server/account-two'),x=>x.c.App.me.tz='Pacific/Kiritimati',x=>x.c.location.pathname='/food']){
  f=fixture();first=f.c.recaps.open('week');await Promise.resolve();change(f);f.release();await first;assert.equal(f.calls.length,0,'late leaf cannot open after account, timezone or route change');assert.deepEqual(f.toasts,[]);
 }
 f=fixture();first=f.c.recaps.open('month');await Promise.resolve();f.fail();await first;assert.equal(f.calls.length,0);assert.equal(f.toasts.length,1,'failed UI intent is handled without an unhandled rejection');f.retry();second=f.c.recaps.open('month');await Promise.resolve();assert.equal(f.loads(),2,'next tap retries failed leaf');f.release();await second;assert.equal(f.calls.length,1);
 f=fixture();let button;f.nodes.set('.progress-heading .acts',{prepend:b=>button=b});f.c.recaps.entry({});first=button.onclick();await Promise.resolve();assert.equal(f.loads(),1,'Progress entry uses deferred facade');f.release();await first;assert.equal(f.calls.length,1);
 f=fixture();let reads=0;f.c.api=async()=>{reads++;return{period:'last_month',start:'2026-10-01',end:'2026-11-01',tz:'UTC',monthly_offer:true};};const monthButton={},dismissButton={},box={isConnected:true,innerHTML:''};f.nodes.set('[data-recap-month]',monthButton);f.nodes.set('[data-recap-dismiss]',dismissButton);await f.c.recaps.offer(box);assert.equal(reads,1,'monthly offer retains the shell private read');assert.equal(f.loads(),0,'offer eligibility does not load editor');first=monthButton.onclick();await Promise.resolve();assert.equal(f.loads(),1,'monthly offer uses deferred facade');f.release();await first;assert.equal(f.calls[0].initial.period,'month');assert.equal(f.calls[0].initial.offset,1);assert.equal(reads,1,'loading editor adds no duplicate offer read');f.calls[0].callback({period:'month',offset:1,start:'2026-10-01'});assert.equal(box.innerHTML,'','successful exact-month callback keeps offer dismissal');
 f=fixture();first=f.c.recaps.draw({period:'week'},{totals:true});await Promise.resolve();f.owner('fictional-server/account-two');f.release();await assert.rejects(first,/account or time zone changed/,'draw cannot resume for old owner');
 console.log('Recap loader: eager dates, one pending intent, aliases/offset/callback, failure retry, owner/timezone/route fences, Progress/monthly entry and draw owner guard PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
