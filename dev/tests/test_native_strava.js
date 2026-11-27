'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/native.js','utf8');
const adapter=source.slice(source.indexOf('  // Session plumbing only:'),source.indexOf('  // ---------- Native iPhone notifications'));
function client(){
 const events=[],plugin={addListener(){},bind:async data=>events.push(['bind',data.userID,data.server]),stop:async()=>events.push(['stop']),resume:async()=>events.push(['resume']),pick:async()=>events.push(['pick']),review:async()=>{},status:async()=>({state:'empty'})};
 const ctx={N:{base:'https://one.example.test',token:'fictional-session-one'},P:{KinettaStravaImport:plugin},App:{me:{id:1,login:'fictional'}}};vm.createContext(ctx);vm.runInContext(adapter,ctx);return {ctx,plugin,events};
}
(async()=>{
 let {ctx,events}=client();await ctx.N.pickStravaArchive();assert.deepEqual(events.map(e=>e[0]),['bind','pick']);
 assert.equal(events.filter(e=>e[0]==='upload').length,0,'picking is never upload authorization');
 await ctx.N.bindStravaImport();assert.equal(events.at(-1)[0],'resume','foreground can resume only already-confirmed native work');
 await ctx.N.stopStravaImport();assert.equal(events.at(-1)[0],'stop');
 ctx.App.me=null;await ctx.N.bindStravaImport();assert.equal(events.at(-1)[0],'stop','signed-out state cannot bind');
 let f=client(),release;f.plugin.bind=()=>new Promise(resolve=>release=resolve);
 const pending=f.ctx.N.pickStravaArchive();f.ctx.App.me={id:2,login:'other'};f.ctx.N.token='fictional-session-two';release();
 await assert.rejects(pending,/account changed/);assert(!f.events.some(e=>e[0]==='pick'));assert.equal(f.events.at(-1)[0],'stop');
 f=client();let stop;f.plugin.stop=()=>new Promise(resolve=>stop=resolve);let finished=false;
 const stopping=f.ctx.N.stopStravaImport().then(()=>finished=true);await Promise.resolve();assert.equal(finished,false,'session cleanup waits for native cancellation');stop();await stopping;assert.equal(finished,true);
 f=client();f.plugin.stop=async()=>{throw Error('Still stopping');};await assert.rejects(f.ctx.N.stopStravaImport(),/Still stopping/);
 const signIn=source.slice(source.indexOf('  const signIn ='),source.indexOf('  N.login ='));
 assert(signIn.indexOf('await N.stopStravaImport()')<signIn.indexOf('N.base = N.address(server)'),'cancel old transfers before changing server');
 const logout=source.slice(source.indexOf('  N.forget ='),source.indexOf('  // Session plumbing only:'));
 assert(logout.indexOf('N.stopStravaImport()')<logout.indexOf('N.token=null'),'binding disabled before clearing token');
 // Execute the real forget body as well as the real adapter, including held and
 // rejected native cancellation. autoSync's entry call is bindStravaImport.
 const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
 for(const fails of [false,true]){
  f=client();const held=deferred(),saved=new Map([['token','fictional-session-one']]);
  f.plugin.stop=()=>{f.events.push(['stop']);return held.promise;};
  Object.assign(f.ctx,{on:true,put:async(key,value)=>value==null?saved.delete(key):saved.set(key,value)});
  Object.assign(f.ctx.N,{clearPictures(){},stopActivityShare:async()=>{},stopFoodEntry:async()=>{},disconnectPush:async()=>{},disconnectHealth:async()=>[],healthCall:promise=>promise});
  vm.runInContext(logout,f.ctx);
  const forgetting=f.ctx.N.forget();
  await Promise.resolve();assert.equal(f.ctx.N.token,null,'web token revoked before native cleanup resolves');
  // Even if another stale caller still carries both old values, binding must
  // remain disabled for the entire transition and after cleanup.
  f.ctx.N.token='fictional-session-one';await f.ctx.N.bindStravaImport();
  assert(!f.events.some(e=>e[0]==='bind'||e[0]==='resume'));
  f.ctx.N.token=null;
  if(fails)held.reject(Error('Still stopping'));else held.resolve();
  await forgetting;
  assert.equal(f.ctx.N.token,null);assert(!saved.has('token'),'native failure cannot retain persisted token');
  await f.ctx.N.bindStravaImport();assert.equal(f.events.filter(e=>e[0]==='stop').length,1,'auto bind cannot supersede native stop');
 }
 f=client();const held=deferred();f.plugin.stop=()=>held.promise;
 const cancel=f.ctx.N.stopStravaImport();await Promise.resolve();await f.ctx.N.bindStravaImport();
 assert(!f.events.some(e=>e[0]==='bind'));held.resolve();await cancel;
 await f.ctx.N.bindStravaImport();assert(!f.events.some(e=>e[0]==='bind'),'completion alone cannot reopen old binding');
 f.ctx.N.enableStravaImport();await f.ctx.N.bindStravaImport();assert.equal(f.events.at(-1)[0],'bind','completed explicit sign-in can enable current session');
 console.log('Native Strava adapter: no automatic upload, confirmed-only resume, stale binding fence, awaited cleanup/refusal PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
