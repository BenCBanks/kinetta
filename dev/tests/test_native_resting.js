// Actual native client with deterministic Health callbacks; no real device or Health data.
const assert=require('assert'),vm=require('vm'),fs=require('fs');
(async()=>{let complete,posts=[],permissionCount=0;const saved=new Map();
const plugin={requestRestingPermissions:async()=>{permissionCount++},restingEnergy:()=>new Promise(r=>complete=r)};
const ctx={console,Date,Map,JSON,Error,Promise,setTimeout,clearTimeout,location:{pathname:'/food'},
App:{me:{id:1,tz:'UTC',resting_source:'apple_health'},cache:new Map()},route(){},forgetKept(){},invalidate(){},toast(){},render(){},
document:{documentElement:{},addEventListener(){}},MutationObserver:class{observe(){}},json:(method,body)=>({method,body}),
window:{addEventListener(){},Capacitor:{isNativePlatform:()=>true,Plugins:{KinettaHealthSync:plugin,Preferences:{get:async({key})=>({value:saved.get(key)||null}),set:async({key,value})=>saved.set(key,value),remove:async({key})=>saved.delete(key)}}}},
api:async(path,opts)=>{posts.push({path,who:ctx.App.me.id,body:opts.body});return{ok:true,received:opts.body.days.length,days:opts.body.days.map(r=>r.day)}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/native.js','utf8')+'\nglobalThis.N=Native;',ctx);const n=ctx.N;await n.ready;n.base='https://fictional.invalid';n.token='fake';
const tick=()=>new Promise(r=>setImmediate(r)),payload={tz:'UTC',observed_at:new Date().toISOString(),days:[{day:new Date().toISOString().slice(0,10),resting_kcal:1234}]};
assert.equal(await n.restingOn(),false);assert.equal(await n.syncRestingEnergy(),null);assert.equal(posts.length,0);
await n.connectRestingEnergy();assert.equal(permissionCount,1);assert(await n.restingOn());
let p=n.syncRestingEnergy();while(!complete)await tick();complete(payload);assert.deepEqual(await p,{days:1});assert.equal(posts.length,1);assert(!('active_kcal' in posts[0].body));assert.equal(posts[0].body.days[0].resting_kcal,1234);
complete=null;p=n.syncRestingEnergy();while(!complete)await tick();ctx.App.me={id:2,tz:'UTC',resting_source:'apple_health'};complete(payload);await assert.rejects(p,/changed/);assert.equal(posts.length,1);assert.equal(await n.restingOn(),false,'new account does not inherit resting consent');
ctx.App.me={id:1,tz:'UTC',resting_source:'apple_health'};await n.connectRestingEnergy();complete=null;p=n.syncRestingEnergy();while(!complete)await tick();ctx.App.me.resting_source='formula';complete(payload);await assert.rejects(p,/changed/);assert.equal(posts.length,1,'disable prevents a late upload');
ctx.App.me.resting_source='apple_health';complete=null;p=n.syncRestingEnergy();while(!complete)await tick();ctx.App.me.tz='America/New_York';complete(payload);await assert.rejects(p,/changed/);assert.equal(posts.length,1,'time-zone change prevents a late upload');
await n.stopRestingEnergy();assert.equal(await n.restingOn(),false);// HealthKit aborts the app when a query's handler is replaced after execute (TestFlight crash, build 286).
for(const f of fs.readdirSync('mobile/ios/App/App').filter(f=>f.endsWith('.swift')))assert(!/\.\w*(ResultsHandler|updateHandler)\s*=\s*nil/.test(fs.readFileSync('mobile/ios/App/App/'+f,'utf8')),f+' must not change a Health query handler after execute');
console.log('PASS native Resting Energy: explicit account consent, passive-only payload, acknowledgement, stale account/source/time-zone callbacks blocked, no Health handler changes after execute');
})().catch(e=>{console.error(e);process.exit(1)});
