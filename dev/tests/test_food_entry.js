'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync('app/static/thread.js','utf8');
let owner='a',full=false;const saved=new Map(),field={value:'Existing draft',focus(){}},ctx={owner:'a',nativeEntries:[],el:{}};
const c={current:ctx,Date,active:x=>x.owner===owner,$:()=>field,draftKey:o=>'draft:'+o,nativeKey:o=>'native:'+o,primary(){},localStorage:{setItem:(k,v)=>{if(full)throw Error('Fictional storage full');saved.set(k,v);},removeItem:k=>saved.delete(k)},status:()=>{}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function saveDraft'),source.indexOf('  async function pendingCount')),c);
const id='aaaaaaaa-1111-4111-8111-111111111111';assert(c.receiveNative({id,source:'quick-action'}));assert.equal(field.value,'Existing draft');assert.equal(saved.size,0);
assert(c.receiveNative({id,source:'shortcut',text:'Fictional eggs and toast'}));assert.equal(field.value,'Existing draft\nFictional eggs and toast');const draft=JSON.parse(saved.get('draft:a'));assert.equal(typeof draft,'string');assert.equal(JSON.parse(saved.get('native:a'))[0].id,id);
assert(c.receiveNative({id,source:'shortcut',text:'Fictional eggs and toast'}));assert.equal(field.value,draft,'replayed delivery does not duplicate text');
field.value='';c.saveDraft(ctx,'');assert(c.receiveNative({id,source:'shortcut',text:'Fictional eggs and toast'}));assert.equal(field.value,'','separate receipt survives sending/clearing draft');assert(!saved.has('draft:a'));
field.value='Keep this';full=true;assert.equal(c.receiveNative({id:'bbbbbbbb-1111-4111-8111-111111111111',source:'shortcut',text:'Waiting text'}),false);assert.equal(field.value,'Keep this');assert.equal(ctx.nativeEntries.length,1);full=false;
field.value='x'.repeat(3999);assert.equal(c.receiveNative({id:'cccccccc-1111-4111-8111-111111111111',source:'shortcut',text:'too long'}),'skip');assert.equal(field.value.length,3999);
// Crash between receipt journal and draft write recovers exactly once.
const pending={id:'dddddddd-1111-4111-8111-111111111111',at:Date.now(),pending:{before:'Old',next:'Old\nNew'}};ctx.nativeEntries.push(pending);field.value='Old';assert(c.receiveNative({id:pending.id,source:'shortcut',text:'New'}));assert.equal(field.value,'Old\nNew');assert(!ctx.nativeEntries.at(-1).pending);
owner='b';assert.equal(c.receiveNative({id,source:'shortcut',text:'Old account'}),false);
console.log('Food entry composer: separate receipt journal, plain draft, no implicit send, replay/after-send/crash dedupe, storage-full retry, overflow skip and owner guard PASS');
const native=fs.readFileSync('app/static/native.js','utf8');
function client(){let who='a',received=0;const calls=[],entry={id,source:'shortcut',text:'Fictional lunch'};const plugin={bind:async()=>calls.push('bind'),pending:async()=>({entries:[entry]}),acknowledge:async x=>calls.push(['ack',x.id]),stop:async x=>calls.push(['stop',x.clear]),addListener(){}};const x={N:{token:'a-token',healthCall:async p=>p},P:{KinettaFoodEntry:plugin},App:{me:{id:1}},owner:()=>who,location:{pathname:'/me'},go:path=>{x.location.pathname=path;calls.push('open')},FoodThread:{receiveNative:()=>{received++;calls.push('draft');return true}},toast:()=>{}};vm.createContext(x);vm.runInContext(native.slice(native.indexOf('  // ---------- Native home-screen / Shortcuts'),native.indexOf('  // quietly, when the app opens')),x);return {x,plugin,calls,received:()=>received,switch:()=>{who='b';x.N.token='b-token';x.App.me={id:2};}};}
(async()=>{let f=client();await f.x.N.consumeFoodEntries();assert(f.calls.indexOf('draft')<f.calls.findIndex(x=>x[0]==='ack'));
 f=client();f.plugin.pending=async()=>{f.switch();return {entries:[]};};await assert.rejects(f.x.N.consumeFoodEntries(),/account changed/);assert.equal(f.received(),0);
 f=client();f.x.App.me=null;await f.x.N.consumeFoodEntries();assert.equal(f.calls.length,0);
 f=client();f.x.N.pauseFoodEntry();await f.x.N.consumeFoodEntries();assert.equal(f.calls.length,0,'pause preserves inbox without consuming it');f.x.N.resumeFoodEntry();await f.x.N.consumeFoodEntries();assert(f.calls.some(x=>x[0]==='ack'));
 f=client();await f.x.N.stopFoodEntry({clear:true});assert(f.calls.some(x=>x[0]==='stop'&&x[1]===true));
 f=client();const second='eeeeeeee-1111-4111-8111-111111111111';f.plugin.pending=async()=>({entries:[{id,source:'shortcut',text:'Oversized'},{id:second,source:'quick-action'}]});let n=0;f.x.FoodThread.receiveNative=()=>++n===1?'skip':true;await f.x.N.consumeFoodEntries();assert.equal(f.calls.filter(x=>x[0]==='ack').length,2,'skipped oversized entry cannot block later ones');
 f=client();f.x.FoodThread.receiveNative=()=>false;await f.x.N.consumeFoodEntries();assert(!f.calls.some(x=>x[0]==='ack'),'unsaved entries remain pending');
 console.log('Food entry client: offline owner-bound draft without network, signed-out no-op, account guard, pause preserves inbox, explicit clear, skip/continue and save-before-ack PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

(async()=>{let puts=0;const field={value:'Sent Shortcut text'},button={disabled:false};const ctx={owner:'a',el:{},messages:[],jobs:[]};
 const c={active:()=>true,pendingReview:()=>false,$:s=>s==='#thread-text'?field:button,uuid:()=> 'stable-job',Date,isoDay:()=> '2026-10-18',latestContext:()=>null,finishNativeDraft:()=>{},saveDraft:()=>{throw Error('Fictional draft cleanup failure')},ThreadDB:{put:async()=>puts++},status:()=>{}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  async function send('),source.indexOf('  async function daily(')),c);await c.send(ctx);assert.equal(puts,0,'draft cleanup failure cannot leave a saved upload plus a reappearing draft');assert.equal(field.value,'Sent Shortcut text');console.log('Food send: failed draft cleanup prevents upload and retains visible text PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
