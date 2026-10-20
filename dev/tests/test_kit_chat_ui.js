'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync('app/static/kit.js','utf8');
const c={route(){},URLSearchParams,App:{me:{id:7}},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid'},localStorage:{removeItem(){}},Map,Set};vm.createContext(c);vm.runInContext(source+'\nglobalThis.Kit=KitChat;',c);
assert.equal(c.Kit.href('nutrition'),'/me/kit?from=nutrition');assert.equal(c.Kit.href('activity',42),'/me/kit?from=activity&activity=42');assert.equal(c.Kit.href('javascript:bad'),'/me/kit?from=me');
for(const group of Object.values(c.Kit.starters))assert.equal(group.length,3);
for(const [,path] of Object.values(c.Kit.actions))assert(path.startsWith('/')&&!path.startsWith('//'));
const accountKeys=[];c.localStorage.removeItem=k=>accountKeys.push(k);c.Kit.eraseDevice();assert.equal(accountKeys.length,2);assert(accountKeys.every(k=>k.endsWith('["https://fictional.invalid",7]')));
const pick=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
// Shared chat entries appear only when the server's reviewed Kit gate is on; otherwise older Kit reviews stay.
{const explore=fs.readFileSync('app/static/explore.js','utf8'),gate=explore.slice(explore.indexOf('function aiCan('),explore.indexOf('route(/^\\/me\\/explore$/'));
 const g={App:{me:{ai_ok:true,coach:true,ai_access:{coach:{available:true,entitled:true}}}}};vm.createContext(g);vm.runInContext(gate,g);
 assert.equal(g.kitChatOn(),false,'no Kit chat until the server reports kit_chat');g.App.me.kit_chat=true;assert.equal(g.kitChatOn(),true);g.App.me.ai_ok=false;assert.equal(g.kitChatOn(),false,'consent off hides Kit chat');
 let made=0;const e={kitChatOn:()=>false,href:s=>'/me/kit?from='+s,document:{createElement(){made++;return {setAttribute(){}}}},svg:()=>''};vm.createContext(e);vm.runInContext(source.slice(source.indexOf('  function entry(el,path){'),source.indexOf('  return {mount,')).replace('function entry','globalThis.entry=function'),e);
 const page={querySelector:s=>s==='.top'?{querySelector:()=>null,append(){}}:null};e.entry(page,'/food');assert.equal(made,0,'gated Kit adds no tab-home entry');e.kitChatOn=()=>true;e.entry(page,'/food');assert.equal(made,1);
 for(const [file,needle] of [['app/static/pages.js',"kitChatOn() ? go(KitChat.href('activity'"],['app/static/food.js','if (kitChatOn()) { box.innerHTML'],['app/static/plan.js',"kitChatOn() ? '<a class=\"ghost\" href=\"/me/kit?from=plan\">"],['app/static/thread.js',"!kitChatOn()||!(r.offer_kit"]])
   assert(fs.readFileSync(file,'utf8').includes(needle),file+' gates its Kit chat entry');}
(async()=>{
 let saved,delivered=0,status='',field={value:'My unsent question'};
 const sender={active:()=>true,$:()=>field,newId:()=> 'stable-uuid',save:(ctx,k,v)=>{saved=v},deliver:async()=>delivered++,status:(ctx,v)=>status=v};vm.createContext(sender);vm.runInContext(pick('  async function send(c,text){','  async function mount(el){'),sender);
 const ctx={loaded:true,ready:true,sending:false,generation:'generation-a',context:{screen:'nutrition'}};await sender.send(ctx);assert.equal(saved.question,'My unsent question');assert.equal(saved.client_id,'stable-uuid');assert.equal(saved.generation,'generation-a');assert.equal(delivered,1);await sender.send(ctx);assert.equal(delivered,1,'current-visit durable question is retried, never duplicated');
 ctx.job=null;sender.save=()=>{throw Error('quota')};await sender.send(ctx);assert.equal(field.value,'My unsent question');assert.equal(delivered,1);assert(status.includes('could not save'));
 ctx.job=null;ctx.ready=false;await sender.send(ctx);assert.equal(delivered,1);assert.equal(field.value,'My unsent question');assert(status.includes('isn’t available'));
 // A server-accepted message after a lost acknowledgement reconciles the durable local send.
 const removed=[];field={value:'Accepted earlier',style:{}};
 const loader={aiCan:()=>true,App:{me:{ai_ok:true}},api:async()=>({generation:'generation-a',messages:[{id:1,client_id:'accepted',question:'Accepted earlier',state:'answered'}],ready:true,before:null}),active:()=>true,$:()=>field,store:{del:k=>removed.push(k)},key:(o,k)=>k,draw(){},status(){},Map,answer(){throw Error('Answered messages cannot call the model again')},later(){}};
 vm.createContext(loader);vm.runInContext(pick('  async function refresh(c,before=null){','  const later='),loader);
 const resumed={generation:'generation-a',owner:'one',messages:[],job:{client_id:'accepted',question:'Accepted earlier',generation:'generation-a'}};
 await loader.refresh(resumed);assert.equal(resumed.job,null);assert.equal(field.value,'');assert(removed.includes('pending')&&removed.includes('draft'));
 // Reorder the actual answer handler across Clear and account changes.
 let finish,draws=0,active=true,refreshes=0;
 const answerer={active:()=>active,controls(){},api:()=>new Promise(resolve=>finish=resolve),json:(m,b)=>b,draw:()=>draws++,later(){},refresh:async()=>refreshes++,status(){}};vm.createContext(answerer);vm.runInContext(pick('  async function answer(c,id){','  async function deliver(c){'),answerer);
 const chat={generation:'old',messages:[{client_id:'same',state:'pending'}],sending:false};const task=answerer.answer(chat,'same');chat.generation='new';chat.messages=[];chat.sending=false;finish({client_id:'same',state:'answered',answer:{interpretation:'late'}});await task;assert.equal(chat.messages.length,0);assert.equal(draws,0);assert.equal(chat.sending,false);assert.equal(refreshes,0,'a cleared result cannot refresh over the new chat');
 chat.generation='current';chat.visit_id='first-visit';chat.messages=[{client_id:'same',state:'pending'}];const ended=answerer.answer(chat,'same');chat.visit_id='next-visit';chat.messages=[];finish({client_id:'same',state:'answered'});await ended;assert.equal(draws,0,'a late answer from an ended visit cannot enter a fresh visit');
 chat.generation='current';chat.messages=[{client_id:'same',state:'pending'}];const next=answerer.answer(chat,'same');active=false;finish({client_id:'same',state:'answered'});await next;assert.equal(chat.messages[0].state,'pending');assert.equal(draws,0,'another session never renders the old answer');
 console.log('Kit UI: shared safe entry URLs/actions, account-scoped cleanup, durable-before-send/storage failure, duplicate-send prevention and late clear/account response fences PASS');
})().catch(e=>{console.error(e);process.exit(1)});
