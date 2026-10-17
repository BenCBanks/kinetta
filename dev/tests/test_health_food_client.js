'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/native.js','utf8');
function fixture(){
 let uid='a',versionToken='token-a',readResolve=null,writeResolve=null;const saved=new Map(),calls=[];
 const state={weight:{enabled:true,epoch:'weight-epoch',tz:'UTC'},nutrition:{enabled:true,epoch:'nutrition-epoch',tz:'UTC'}};
 const batch={batch:'batch-a',observed_at:'2026-10-17T12:00:00Z',samples:[{sample_id:'sample-a'}],deleted:['deleted-a'],more:false};
 const plugin={bind:async x=>calls.push(['bind',x]),stop:async()=>calls.push(['stop']),requestWeightPermission:async()=>calls.push(['weight-permission']),requestNutritionPermission:async()=>calls.push(['nutrition-permission']),readWeight:async()=>batch,acknowledgeWeight:async x=>calls.push(['ack',x]),status:async()=>({cursor:0,allowed:['kcal'],blocked:['protein_g','carbs_g','fat_g','fiber_g']}),writeNutrition:async x=>calls.push(['write',x])};
 const c={N:{token:versionToken,healthCall:async p=>p,healthPermissionTimeout:100},P:{KinettaHealthFood:plugin},on:true,owner:()=>uid,App:{me:{id:1,health_nutrition_write:true}},get:async k=>saved.get(k),put:async(k,v)=>v==null?saved.delete(k):saved.set(k,v),json:(method,body)=>({method,body}),invalidate:()=>{},setTimeout,clearTimeout,Date,console};
 c.refreshMe=me=>{c.App.me=me;};
 c.api=async(path,options)=>{
  calls.push(['api',path,options]);
  if(path.endsWith('/preferences')){const kind=path.includes('/weights/')?'weight':'nutrition';state[kind].enabled=options.body.enabled;return state[kind];}
  if(path==='/api/health/weights'&&options){return {ok:true,epoch:state.weight.epoch,received:batch.samples.length,deleted:batch.deleted.length,sample_ids:batch.samples.map(s=>s.sample_id),deleted_ids:batch.deleted};}
  if(path==='/api/me')return {id:1,health_nutrition_write:true};
  if(path==='/api/health/weights')return {...state.weight};
  if(path==='/api/health/nutrition')return {...state.nutrition};
  if(path.startsWith('/api/health/nutrition/days'))return {...state.nutrition,days:[{day:'2026-10-17',revision:1}],next:1,more:false};
  throw Error('Unexpected API path');
 };
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  // ---------- Optional Health weight/nutrition'),source.indexOf('  // quietly, when the app opens')),c);
 return {c,N:c.N,plugin,state,batch,calls,saved,connect:kind=>saved.set('health.food.'+kind,uid),switch:()=>{uid='b';c.N.token='token-b';c.App.me={id:2,health_nutrition_write:true};}};
}
(async()=>{
 let f=fixture();assert.equal(await f.N.syncFoodHealth(),null);assert.equal(f.calls.length,0,'no opted-in category does nothing');
 f.connect('weight');const successful=await f.N.syncFoodHealth();assert(!successful.weight.error);const post=f.calls.findIndex(x=>x[0]==='api'&&x[1]==='/api/health/weights'&&x[2]),ack=f.calls.findIndex(x=>x[0]==='ack');assert(post>=0&&ack>post,'anchor only after acknowledged upload');
 f=fixture();f.connect('weight');f.batch.samples[0].sample_id='ABCDEFAB-1111-4111-8111-111111111111';f.batch.deleted=['ABCDEFAB-2222-4222-8222-222222222222'];const original=f.c.api;f.c.api=async(p,o)=>{const r=await original(p,o);if(p==='/api/health/weights'&&o){r.sample_ids=r.sample_ids.map(s=>s.toLowerCase());r.deleted_ids=r.deleted_ids.map(s=>s.toLowerCase());}return r;};await f.N.syncFoodHealth();assert(f.calls.some(x=>x[0]==='ack'),'Apple uppercase UUID matches normalized server UUID');
 f=fixture();f.connect('weight');const api=f.c.api;f.c.api=async(p,o)=>p==='/api/health/weights'&&o?{ok:false}:api(p,o);await f.N.syncFoodHealth();assert(!f.calls.some(x=>x[0]==='ack'));assert(f.N.foodHealthResult.weight.error);
 f=fixture();f.connect('weight');f.plugin.readWeight=async()=>{f.switch();return f.batch;};await assert.rejects(f.N.syncFoodHealth(),/account or settings changed/);assert(!f.calls.some(x=>x[0]==='ack'||x[0]==='api'&&x[2]),'new account never uploads or acknowledges old sample');
 f=fixture();f.connect('weight');f.plugin.readWeight=async()=>{f.state.weight.epoch='new-epoch';return f.batch;};await f.N.syncFoodHealth();assert(!f.calls.some(x=>x[0]==='ack'));assert(f.N.foodHealthResult.weight.error.includes('changed'));
 f=fixture();f.connect('weight');f.connect('nutrition');f.plugin.readWeight=async()=>{throw Error('Fictional locked weight read');};const result=await f.N.syncFoodHealth();assert(result.weight.error);assert.equal(result.nutrition.allowed.length,1);assert.equal(result.nutrition.blocked.length,4);assert(f.calls.some(x=>x[0]==='write'),'failed weight does not block separately allowed nutrition');
 f=fixture();f.connect('nutrition');f.plugin.status=async()=>{f.switch();return {cursor:0,allowed:['kcal'],blocked:[]};};await assert.rejects(f.N.syncFoodHealth(),/account or settings changed/);assert(!f.calls.some(x=>x[0]==='write'));
 f=fixture();f.connect('nutrition');const previous=f.c.api;f.c.api=async(p,o)=>{const r=await previous(p,o);if(p.includes('/days?'))f.state.nutrition.enabled=false;return r;};await f.N.syncFoodHealth();assert(!f.calls.some(x=>x[0]==='write'));assert(f.N.foodHealthResult.nutrition.error.includes('changed'));
 f=fixture();await f.N.connectFoodHealth('nutrition');assert(f.calls.some(x=>x[0]==='nutrition-permission'));assert(!f.calls.some(x=>x[0]==='weight-permission'));assert(f.calls.findIndex(x=>x[0]==='nutrition-permission')<f.calls.findIndex(x=>typeof x[1]==='string'&&x[1].endsWith('/preferences')));
 f=fixture();f.connect('weight');f.connect('nutrition');await f.N.disableFoodHealth('weight');assert(!await f.N.foodHealthOn('weight'));assert(await f.N.foodHealthOn('nutrition'));assert(!f.state.weight.enabled);assert(f.calls.findIndex(x=>x[0]==='stop')<f.calls.findIndex(x=>typeof x[1]==='string'&&x[1].endsWith('/preferences')));
 f=fixture();f.connect('nutrition');f.plugin.writeNutrition=async()=>{throw Error('Fictional Health write failure');};await f.N.syncFoodHealth();assert(f.N.foodHealthResult.nutrition.error);assert.equal(f.calls.filter(x=>x[0]==='write').length,0);
 console.log('Health food client: separate explicit permissions/default no-op, receipt-before-anchor, partial grant status, isolated failures, account/token/settings guards, stop-before-off and no late upload/write PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
