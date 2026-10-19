// Exercise the actual quick-log sender and context selection with yesterday's URL/history.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/thread.js','utf8');
const pending=[],field={value:'2 eggs',style:{}},button={disabled:false};
const ctx={draftId:'draft-one',day:'2026-10-17',meal:'lunch',owner:'fictional',visibleClients:new Set(),messages:[{kind:'user',client_id:'previous-visit',captured_at:'2026-10-18T12:00:00Z',result:{kind:'log'}}],jobs:[]};
const c={pendingReview:()=>false,Set,Date,Object,isoDay:()=> '2026-10-18',uuid:()=> 'fresh-message',active:()=>true,$:id=>id==='#thread-text'?field:button,ThreadDB:{put:async(owner,id,job)=>pending.push(job),list:async()=>pending},draftKey:()=>'draft',contextKey:()=>'context',finishNativeDraft(){},saveDraft(){},store:{del(){}},draw(){},status(){},Native:{haptic(){}},flush(){}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function latestContext('),source.indexOf('  async function daily(')),c);
(async()=>{
 assert.equal(c.latestContext(ctx),undefined,'a fresh visit must not attach old conversation context');
 await c.send(ctx);
 assert.equal(pending.length,1);assert.equal(pending[0].review_only,true);assert.equal(pending[0].draft_id,'draft-one');assert.equal(pending[0].day,'2026-10-18','capture binds Today, ignoring yesterday context');assert.equal(pending[0].meal,'lunch');assert.equal(pending[0].context,'fresh-message','self context prevents server fallback to a hidden previous visit');assert(ctx.visibleClients.has('fresh-message'));assert.equal(field.value,'');
 assert.equal(c.latestContext(ctx),'fresh-message','follow-up can refer to this visit’s pending food');
 ctx.context='failed-old';ctx.jobs=[{id:'failed-old',error:'Old error',draft_id:'draft-one',phase:'process',at:'2026-10-19T13:00:00Z'}];ctx.messages.push({kind:'user',client_id:'failed-old',captured_at:'2026-10-19T13:00:00Z',result:{kind:'needs',draft_id:'draft-one'}});assert.equal(c.latestContext(ctx),undefined);field.value='Taco';c.uuid=()=> 'independent-new';await c.send(ctx);assert.equal(pending.at(-1).context,'independent-new','new text does not inherit the earlier failed message, even when typing captured that context');
 field.value='new food';c.ThreadDB.put=async()=>{throw Error('storage unavailable')};await c.send(ctx);assert.equal(field.value,'new food','storage failure keeps unsent words');
 console.log('quick food visit: Today capture, fresh context, within-visit follow-up, durable queue and failed-save draft PASS');
})().catch(e=>{console.error(e);process.exit(1)});
