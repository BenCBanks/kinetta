'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const thread=fs.readFileSync('app/static/thread.js','utf8'),food=fs.readFileSync('app/static/food.js','utf8');
const c={};vm.createContext(c);vm.runInContext(food.match(/function kitFoodWords[^\n]+/)[0],c);assert.equal(c.kitFoodWords('Use an AI estimate instead'),'Use Kit’s estimate instead');vm.runInContext(thread.slice(thread.indexOf('  function source('),thread.indexOf('  function food(')),c);
assert.equal(c.source({source:'recent',ref:{source:'usda'}}),'USDA');assert.equal(c.source({source:'custom',ref:{origin:'ai',origin_edited:true}}),'Kit’s estimate · Edited');assert.equal(c.source({source:'recent',ref:{origin:'catalog',origin_ref:{source:'off'}}}),'Open Food Facts');assert.equal(c.source({source:'custom',ref:{origin:'label'}}),'Nutrition label');
let owner='a',closed=0,prevented=0,stopped=0;const handlers=[];c.readOwner=()=>owner;c.toast=()=>{};vm.runInContext(food.slice(food.indexOf('function guardFoodSheet'),food.indexOf('function addSheet')),c);c.guardFoodSheet({addEventListener:(event,fn,capture)=>{assert(capture);handlers.push(fn)}},()=>closed++,'a');const event={preventDefault(){prevented++},stopImmediatePropagation(){stopped++}};handlers[0](event);assert.equal(closed,0);owner='b';handlers[0](event);handlers[1](event);assert.equal(closed,2);assert.equal(prevented,2);assert.equal(stopped,2);
console.log('food sources: provenance survives recent reuse/AI edits/labels; stale food-sheet clicks and submits blocked before writes PASS');

vm.runInContext(thread.slice(thread.indexOf('  function changedNumbers('),thread.indexOf('  function replyHtml(')),c);
assert.equal(c.changedNumbers({logged_totals:{kcal:200,protein_g:10}},[{kcal:200,protein_g:10}]),false);
assert.equal(c.changedNumbers({logged_totals:{kcal:200,protein_g:10}},[{kcal:100,protein_g:5}]),true);
assert.equal(c.changedNumbers({parts:[{logged:true,entries:[{kcal:200}]},{logged:false,entries:[{kcal:300}]}]},[{kcal:200}]),false);
vm.runInContext(thread.slice(thread.indexOf('  function latestContext('),thread.indexOf('  async function send(')),c);
const context={visibleClients:new Set(['visible-newer','late-upload-older']),messages:[{id:2,kind:'user',client_id:'visible-newer',captured_at:'2026-10-16T12:00:00-04:00',result:{kind:'log'}},{id:3,kind:'user',client_id:'late-upload-older',captured_at:'2026-10-16T14:00:00Z',result:{kind:'log'}}],jobs:[{id:'old-pending',at:'2026-10-16T13:00:00Z',phase:'resolve'}]};
assert.equal(c.latestContext(context),'visible-newer');context.jobs.push({id:'new-pending',at:'2026-10-16T17:00:00Z',phase:'process'});assert.equal(c.latestContext(context),'new-pending');
console.log('food cards: changed nutrition suppresses stale feedback; held items are not edits; correction context follows capture time rather than late delivery PASS');

const app=fs.readFileSync('app/static/app.js','utf8');c.Native={base:'',headers:()=>({})};c.App={me:{id:1}};c.FormData=FormData;c.AbortController=AbortController;c.setTimeout=setTimeout;c.clearTimeout=clearTimeout;c.fetch=async()=>({ok:false,status:409,json:async()=>({changed:true,messages:[]})});vm.runInContext(app.slice(app.indexOf('async function api('),app.indexOf('const json =')),c);
(async()=>{await assert.rejects(c.api('/api/food/thread/messages/1/log'),e=>e.code==='preview_changed'&&e.message.includes('tap Log again'));await assert.rejects(c.api('/api/activities/1'),e=>!e.code&&e.message==='Error 409');console.log('changed food preview gets a clear second-tap message; other API errors retain their meaning PASS');})().catch(e=>{console.error(e);process.exitCode=1});

assert.equal(c.changedNumbers({logged_totals:{kcal:200,protein_g:0},logged_unknown:['protein_g']},[{kcal:200,protein_g:0,ref:{unknown_nutrients:[]}}]),true,'providing a known zero changes the meaning of an unknown nutrient');

// Each Send consumes an explicit correction context, even when the textarea keeps another draft.
const sendContext={};vm.createContext(sendContext);let saved;const field={value:'Unsent next draft'},button={disabled:false};Object.assign(sendContext,{pendingReview:()=>false,active:()=>true,$:selector=>selector==='#thread-text'?field:button,uuid:()=> 'fictional-send',isoDay:()=> '2026-10-18',latestContext:()=> 'latest',ThreadDB:{put:async(owner,id,job)=>saved=job,list:async()=>[]},store:{del(){}},draftKey:()=> 'draft',contextKey:()=> 'context',draw(){},status(){},Native:{haptic(){}},flush(){}});vm.runInContext(thread.slice(thread.indexOf('  async function send('),thread.indexOf('  function preferences(')),sendContext);
(async()=>{for(const media of ['text','photo','barcode']){const ctx={owner:'fictional-owner',el:{},visibleClients:new Set(),context:'explicit-old-card',jobs:[]};await sendContext.send(ctx,{body:'A new '+media,media,images:media==='photo'?['fictional-image']:undefined});assert.equal(ctx.context,null);assert.equal(saved.context,'explicit-old-card');assert.equal(field.value,'Unsent next draft');}console.log('food send: text/photo/barcode consume explicit context without clearing a separate draft PASS')})().catch(e=>{console.error(e);process.exitCode=1});

// Household estimate units survive both preview and persisted-food rendering.
c.r1=v=>Math.round(v*10)/10;
vm.runInContext(food.slice(food.indexOf('function servingAmount('),food.indexOf('const fmtAmount =')),c);
for (const [amount,label,expected] of [[2,'1 tacos','2 tacos'],[.5,'1 cup','0.5 cup'],[.75,'1 cup','0.75 cup'],[20,'1 fl oz','20 fl oz'],[1.5,'1 bowl','1.5 bowl'],[.5,'2 eggs (100 g)','0.5 × 2 eggs (100 g)'],[1,'a small apple','a small apple'],[2,'1 serving','2 servings']]) {
 assert.equal(c.servingAmount({amount,ref:{serving:{label}}}),expected);
}
assert.equal(c.servingAmount({amount:2}),'2 servings','legacy unknown portions stay generic');
console.log('food amounts: cups/fl oz/fractions and original serving descriptions retained without changing nutrition PASS');

// A confirmation still in flight must block new capture just like a durable offline confirmation.
{
 let sending=false,queued=[];const gate={Q:{mine:()=>queued},FoodReview:{busy:()=>sending}};vm.createContext(gate);vm.runInContext(thread.slice(thread.indexOf('  const pendingReview='),thread.indexOf('  function held('))+'\nglobalThis.waiting=pendingReview;',gate);
 assert.equal(gate.waiting(),false);sending=true;assert.equal(gate.waiting(),true);sending=false;queued=[{path:'/api/food/thread/reviews/7/confirm'}];assert.equal(gate.waiting(),true);queued=[{path:'/api/food/entries'}];assert.equal(gate.waiting(),false);
 console.log('Food review gate: active confirmation and offline final review block a new draft; unrelated queued writes do not PASS');
}
