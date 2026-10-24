// Exercise the real settings route and logout safeguards with fictional local drafts.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf("route(/^\\/me\\/settings$/"),end=source.indexOf('// heart rate, body and time zone',start);
function fixture(pending=0,accept=true){
 let route,writes=[],forgot=0,login=0,erased=0;const nodes=new Map(),el={innerHTML:''};
 const c={App:{me:{id:1,name:'Fictional Person',login:'zz_test_settings',units:'imperial'},cache:new Map()},
  URLSearchParams,location:{search:''},route:(re,tab,fn)=>route=fn,svg:()=>'',esc:String,backBtn:()=>'<button data-back>Back</button>',wireBack(){},profileHref:()=>'/people/zz_test_settings',
  $:sel=>{if(!nodes.has(sel))nodes.set(sel,{});return nodes.get(sel)},$$:()=>[],kitChatOn:()=>false,
  Q:{mine:()=>pending?[{who:'zz_test_settings'}]:[],all:()=>[{who:'zz_test_settings'},{who:'zz_test_other'}]},
  FoodThread:{pendingCount:async()=>0,eraseDevice:async()=>{erased++}},KitChat:{eraseDevice(){},memorySettings(){}},
  Native:{on:false,foodEntryPendingCount:async()=>0,forget:async()=>{forgot++}},Track:{pause:async()=>{}},
  confirm:()=>accept,api:async(...args)=>writes.push(args),json:(method,body)=>({method,body}),store:{set:(...args)=>writes.push(args)},forgetKept(){},netbar(){},history:{replaceState(){}},showLogin:()=>{login++},toast(){}};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 return {c,el,nodes,writes,run:()=>route(el),counts:()=>({forgot,login,erased})};
}
(async()=>{
 let f=fixture();await f.run();assert(f.el.innerHTML.includes('<h1>Settings</h1>'));assert(!f.el.innerHTML.includes('<details class="me-settings"'));assert(f.el.innerHTML.indexOf('id="logout"')<f.el.innerHTML.indexOf('Connections'),'logout is visible before the long settings list');
 await f.nodes.get('#logout').onclick();assert.equal(f.c.App.me,null);assert.equal(f.counts().login,1);assert.equal(f.counts().forgot,1);assert(f.writes.some(w=>w[0]==='/api/logout'));const queue=f.writes.find(w=>w[0]==='fit.queue')[1];assert.equal(queue.length,1);assert.equal(queue[0].who,'zz_test_other','another account’s queue is preserved');
 f=fixture(1,false);await f.run();await f.nodes.get('#logout').onclick();assert(f.c.App.me);assert.equal(f.counts().erased,0);assert.equal(f.writes.length,0,'declining unsent-data warning never clears drafts or logs out');
 f=fixture();f.c.FoodThread.pendingCount=async()=>{throw Error('Fictional storage error')};await f.run();await f.nodes.get('#logout').onclick();assert(f.c.App.me);assert.equal(f.writes.length,0,'failed pending check keeps the account and drafts');
 console.log('Settings: visible logout, successful sign-out/session cleanup, other-account queue preserved, cancelled/failed pending check retains drafts PASS');
})().catch(e=>{console.error(e);process.exit(1)});
