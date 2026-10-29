// Exercise the real logger's event handlers with controlled saves; no network, clock or DOM dependency.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('app/static/lift.js','utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness({imperial=false}={}) {
  const elements=new Map(),timers=new Map(),disk=new Map(),requests=[],summaries=[],navigation=[],notices=[];
  let owner='session-a',number=0,held=null,failFinish=false;
  function node(id='') {return {id,isConnected:true,disabled:false,innerHTML:'',textContent:'',hidden:false,value:'',placeholder:'',dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},focus(){},select(){},contains(){return false;},scrollIntoView(){},closest(){return null;},insertAdjacentHTML(){}};}
  const el=node('page'),list=node('lf-list'),card=node('card'),row=node('row');
  card.dataset.i='0';
  const kg=node(),reps=node(),tick=node(),prev=node(),add=node(),menu=node(),set=node();
  for (const input of [kg,reps]) { let v=''; Object.defineProperty(input,'value',{get:()=>v,set:x=>v=String(x)}); }
  kg.dataset={j:'0',k:'kg'};kg.placeholder=imperial?'132.3':'60';reps.dataset={j:'0',k:'reps'};reps.placeholder='8';tick.dataset.tick='0';tick.closest=()=>row;prev.dataset.prev='0';set.dataset.set='0';
  elements.set('#lf-list',list);for(const id of ['#lf-save','#lf-time','#lf-restbox','#lf-rest','#lf-finish','#lf-done','#lf-add','#lf-discard','#ff-yes','#ld-keep','#ld-del'])elements.set(id,node(id));
  const $=(q,root)=>q==='[data-addset]'?add:q==='[data-exmenu]'?menu:elements.get(q)||null;
  const $$=(q,root)=>q==='.lift-ex'?[card]:q==='.lift-in'||q==='.lift-in[data-j="0"]'?[kg,reps]:q==='[data-tick]'?[tick]:q==='[data-prev]'?[prev]:q==='[data-set]'?[set]:q==='button,input'?[kg,reps,tick,prev,add,menu,elements.get('#lf-finish')]:[];
  const ctx={console,Promise,Map,Date,JSON,Math,Number,String,Error,Set,location:{origin:'https://demo.invalid'},Native:{base:''},App:{me:{id:1},cache:new Map()},readOwner:()=>owner,store:{get:k=>disk.has(k)?JSON.parse(disk.get(k)):null,set:(k,v)=>disk.set(k,JSON.stringify(v)),del:k=>disk.delete(k)},
    $, $$, route(){},wireBack(){},backBtn(){return '';},svg(){return '';},esc:String,skel(){return '';},dur:String,fdate:()=>'',imp:()=>imperial,viewResources:new Map(),document:{activeElement:null,addEventListener(){},removeEventListener(){}},addEventListener(){},removeEventListener(){},localStorage:{getItem(){return null;}},
    setTimeout:f=>{timers.set(++number,f);return number;},clearTimeout:n=>timers.delete(n),setInterval:()=>++number,clearInterval(){},invalidate(){},toast:t=>notices.push(t),go:p=>navigation.push(p),json:(method,b)=>({method,body:JSON.stringify(b)}),
    sheet:(title,html,mount)=>{ctx.dialog={title,html};mount(node(),()=>{});},pickSheet(){},
    api:async(path,opts)=>{const body=opts.method==='DELETE'?{method:'DELETE'}:JSON.parse(opts.body);requests.push(body);if(held){const h=held;held=null;await h.promise;}if(body.method==='DELETE')return {ok:true};if(body.finish&&failFinish)throw Object.assign(Error('offline'),{offline:true});return {open:!body.finish,start_time:'2026-10-29T10:00:00Z',exercises:body.exercises.map(e=>({...e,sets:e.sets.map(s=>({...s,pr:[]})),last:null}))};}};
  vm.createContext(ctx);vm.runInContext(source,ctx);ctx.liftSummary=(el,aid,r)=>summaries.push(r);
  const data={open:true,start_time:'2026-10-29T10:00:00Z',exercises:[{exercise_id:7,name:'Bench',kind:'weight',sets:[{kg:null,reps:null,done:false}],last:{activity_id:3,start_time:'2026-10-20',sets:[{kg:60,reps:8}]}}]};
  ctx.liftLogger(el,42,data);
  return {ctx,el,kg,reps,tick,prev,requests,summaries,navigation,notices,disk,elements,timers,
    hold(){let resolve;held={promise:new Promise(r=>resolve=r)};return resolve;},failFinish:v=>failFinish=v,changeOwner:()=>owner='session-b',
    draft:()=>[...disk.values()].map(JSON.parse)[0],flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}},cleanup(){for(const fn of ctx.viewResources.values())fn();}};
}
(async()=>{
  for(const imperial of [false,true]){
    const h=harness({imperial}),release=h.hold();h.prev.onclick();h.tick.onclick();await turn();
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].exercises[0].sets[0].kg,60,'previous weight preserves authoritative kg in either unit');
    await h.elements.get('#lf-finish').onclick();await turn();assert.equal(h.summaries.length,0,'Finish waits for autosave');
    release();await turn();await turn();assert.equal(h.requests.length,2);assert.equal(h.requests[1].finish,true);assert.equal(h.summaries.length,1);assert.equal(h.summaries[0].open,false);assert.equal(h.navigation.length,0,'Finish opens summary rather than claiming an open session is saved');h.cleanup();
  }
  {
    const h=harness({imperial:true});h.tick.onclick();await turn();assert.equal(h.requests[0].exercises[0].sets[0].kg,60,'ticking a blank lb placeholder also preserves authoritative kg');h.cleanup();
  }
  {
    const h=harness(),release=h.hold();h.prev.onclick();h.tick.onclick();await turn();h.reps.value='9';h.reps.oninput();release();await turn();
    assert.equal(h.draft().unsent,true,'old acknowledgement cannot mark newer typing saved');assert.equal(h.draft().data.exercises[0].sets[0].reps,9);
    h.flush();await turn();assert.equal(h.requests.at(-1).exercises[0].sets[0].reps,9);assert.equal(h.draft().unsent,false);h.cleanup();
  }
  {
    const h=harness();h.reps.value='12';h.reps.oninput();h.changeOwner();h.flush();await turn();assert.equal(h.requests.length,0,'deferred save never follows a changed account');assert.equal(h.draft().unsent,true);h.cleanup();
  }
  {
    const h=harness();h.reps.value='7';h.reps.oninput();h.failFinish(true);await h.elements.get('#lf-finish').onclick();h.elements.get('#ff-yes').onclick();await turn();await turn();
    assert.equal(h.summaries.length,0);assert.equal(h.elements.get('#lf-finish').disabled,false);assert.equal(h.draft().data.exercises[0].sets[0].reps,7,'failed Finish retains unticked planned values');
    await h.elements.get('#lf-finish').onclick();assert.match(h.ctx.dialog.html,/1 set/,'planned set still appears after failure');h.cleanup();
  }
  {
    const h=harness();h.reps.value='11';h.reps.oninput();h.el.isConnected=false;h.cleanup();await turn();assert.equal(h.requests[0].exercises[0].sets[0].reps,11,'navigation flushes pending typing');
    const key=vm.runInContext('liftKey(42)',h.ctx);h.ctx.App.me={id:2};assert.notEqual(vm.runInContext('liftKey(42)',h.ctx),key);h.ctx.App.me={id:1};h.ctx.Native.base='https://other.invalid';assert.notEqual(vm.runInContext('liftKey(42)',h.ctx),key,'drafts are scoped by chosen server');
  }
  {
    const h=harness(),release=h.hold();h.prev.onclick();h.tick.onclick();await turn();h.elements.get('#lf-discard').onclick();
    const deletion=h.elements.get('#ld-del').onclick({target:h.elements.get('#ld-del')});await turn();assert.equal(h.requests.length,1,'delete waits for pending PUT');release();await deletion;
    assert.equal(h.requests.at(-1).method,'DELETE');assert.equal(h.disk.size,0,'successful discard removes the scoped draft');assert.equal(h.navigation.at(-1),'/track');h.cleanup();
  }
  {
    const h=harness();h.ctx.store={get:()=>null,set(){},del(){}};h.prev.onclick();h.tick.onclick();await turn();assert.equal(h.elements.get('#lf-save').textContent,'Saved','successful network saves work when device storage is full');h.cleanup();
  }
  {
    const h=harness();const body=vm.runInContext("setsText([{reps:8,kg:10},{reps:6,kg:5}], 'body')",h.ctx);assert.equal(body,'8 +10, 6 +5 kg','varied weighted bodyweight sets do not duplicate weight as reps');
    const override=vm.runInContext("hasWeight({kind:'body',addWeight:false,sets:[],last:{sets:[{kg:10}]}})",h.ctx);assert.equal(override,false);h.cleanup();
  }
  console.log('PASS lifting lifecycle: queued Finish, exact copied kg/lb, newer draft, account/server scope, failed Finish, navigation flush and bodyweight summaries');
})().catch(e=>{console.error(e);process.exitCode=1;});
