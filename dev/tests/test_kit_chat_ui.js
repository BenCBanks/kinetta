'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync('app/static/kit.js','utf8');
const c={route(){},URLSearchParams,App:{me:{id:7}},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid'},localStorage:{removeItem(){}},Map,Set};vm.createContext(c);vm.runInContext(source+'\nglobalThis.Kit=KitChat;',c);
assert.equal(c.Kit.href('nutrition'),'/me/kit?from=nutrition');assert.equal(c.Kit.href('activity',42),'/me/kit?from=activity&activity=42');assert.equal(c.Kit.href('javascript:bad'),'/me/kit?from=me');
for(const group of Object.values(c.Kit.starters))assert.equal(group.length,3);
for(const [,path] of Object.values(c.Kit.actions))assert(path.startsWith('/')&&!path.startsWith('//'));
const accountKeys=[];c.localStorage.removeItem=k=>accountKeys.push(k);c.Kit.eraseDevice();assert.equal(accountKeys.length,2);assert(accountKeys.every(k=>k.endsWith('["https://fictional.invalid",7]')));
const pick=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
(async()=>{
 let saved,delivered=0,status='',field={value:'My unsent question'};
 const sender={active:()=>true,$:()=>field,newId:()=> 'stable-uuid',save:(ctx,k,v)=>{saved=v},deliver:async()=>delivered++,status:(ctx,v)=>status=v};vm.createContext(sender);vm.runInContext(pick('  async function send(c,text){','  async function mount(el){'),sender);
 const ctx={loaded:true,sending:false,generation:'generation-a',context:{screen:'nutrition'}};await sender.send(ctx);assert.equal(saved.question,'My unsent question');assert.equal(saved.client_id,'stable-uuid');assert.equal(saved.generation,'generation-a');assert.equal(delivered,1);await sender.send(ctx);assert.equal(delivered,1,'existing durable question is retried, never duplicated');
 ctx.job=null;sender.save=()=>{throw Error('quota')};await sender.send(ctx);assert.equal(field.value,'My unsent question');assert.equal(delivered,1);assert(status.includes('could not save'));
 // Reorder the actual answer handler across Clear and account changes.
 let finish,draws=0,active=true,refreshes=0;
 const answerer={active:()=>active,controls(){},api:()=>new Promise(resolve=>finish=resolve),json:(m,b)=>b,draw:()=>draws++,later(){},refresh:async()=>refreshes++,status(){}};vm.createContext(answerer);vm.runInContext(pick('  async function answer(c,id){','  async function deliver(c){'),answerer);
 const chat={generation:'old',messages:[{client_id:'same',state:'pending'}],sending:false};const task=answerer.answer(chat,'same');chat.generation='new';chat.messages=[];chat.sending=false;finish({client_id:'same',state:'answered',answer:{interpretation:'late'}});await task;assert.equal(chat.messages.length,0);assert.equal(draws,0);assert.equal(chat.sending,false);assert.equal(refreshes,0,'a cleared result cannot refresh over the new chat');
 chat.generation='current';chat.messages=[{client_id:'same',state:'pending'}];const next=answerer.answer(chat,'same');active=false;finish({client_id:'same',state:'answered'});await next;assert.equal(chat.messages[0].state,'pending');assert.equal(draws,0,'another session never renders the old answer');
 console.log('Kit UI: shared safe entry URLs/actions, account-scoped cleanup, durable-before-send/storage failure, duplicate-send prevention and late clear/account response fences PASS');
})().catch(e=>{console.error(e);process.exit(1)});
