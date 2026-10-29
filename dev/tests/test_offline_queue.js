// Actual queue/API code: failed writes survive reloads, races and account/server changes.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function client(storage=new Map()) {
 const c={document:{querySelector:()=>null,addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},location:{origin:'https://fictional.invalid'},Native:{base:'',token:'fictional-never-store',headers:()=>({})},navigator:{onLine:true},addEventListener(){},setInterval(){},console,URLSearchParams,FormData,AbortController,setTimeout,clearTimeout,crypto:{randomUUID:require('node:crypto').randomUUID}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/app.js','utf8')+'\nglobalThis.ui={App,Q,sendOrQueue,api,keep,kept};',c);
 c.ui.App.me={id:1,login:'zz_test_one'};c.netbar=()=>{};c.netState=()=>{};c.toast=()=>{};c.render=()=>{};return c;
}
(async()=>{
 let storage=new Map(),c=client(storage),calls=[];
 c.ui.Q.add({path:'/api/food/entries',method:'POST',body:[{client_id:'fictional-stable-id'}],label:'Lunch'});
 c.api=async(p,o)=>{calls.push(JSON.parse(o.body));throw Object.assign(Error('Please check the portion.'),{status:422})};
 await c.ui.Q.flush();assert.equal(c.ui.Q.mine().length,1);assert.match(c.ui.Q.mine()[0].error,/portion/);
 await c.ui.Q.flush();assert.equal(calls.length,1,'rejected writes wait for explicit retry, avoiding a retry storm');
 c=client(storage);assert.equal(c.ui.Q.mine().length,1,'reload retains failure and body');
 c.ui.App.me={id:2,login:'zz_test_two'};c.api=async()=>{throw Error('must not send')};await c.ui.Q.flush();assert.equal(c.ui.Q.mine().length,0);
 c.ui.App.me={id:1,login:'zz_test_one'};c.Native.base='https://other.invalid';await c.ui.Q.flush();assert.equal(c.ui.Q.mine().length,0,'same account number on another server is isolated');
 c.Native.base='';let op=c.ui.Q.all()[0];c.localStorage.setItem('fit.queue',JSON.stringify([{...op,error:null}]));
 let release;c.api=()=>new Promise(r=>release=r);let pending=c.ui.Q.flush();
 c.ui.Q.add({path:'/api/food/weights',method:'PUT',body:{kg:70},label:'Weight'});c.ui.App.me={id:2,login:'zz_test_two'};
 release({});await pending;assert.equal(c.ui.Q.all().length,1,'acknowledged original removed without dropping a concurrent addition');assert.equal(c.ui.Q.all()[0].label,'Weight');
 c=client();c.api=async()=>{throw Object.assign(Error('offline'),{offline:true})};await c.ui.sendOrQueue('/api/food/entries','POST',[],'Food');assert.equal(c.ui.Q.mine().length,1);
 c=client();c.api=()=>new Promise((r,reject)=>release=reject);pending=c.ui.sendOrQueue('/api/food/entries','POST',[],'Food');c.ui.App.me={id:2,login:'zz_test_two'};release(Object.assign(Error('offline'),{offline:true}));await assert.rejects(pending,e=>e.stale);assert.equal(c.ui.Q.all().length,0,'network failure after switch cannot enqueue under new identity');
 c=client();c.localStorage.setItem=()=>{throw Error('quota')};c.navigator.onLine=false;await assert.rejects(c.ui.sendOrQueue('/api/food/entries','POST',[],'Food'),/couldn't save/);
 c=client();let headers;c.fetch=async(p,o)=>{headers=o.headers;return {ok:false,status:409,json:async()=>({detail:{code:'account_changed',message:'Return to the original account.'}})}};
 await assert.rejects(c.ui.api('/api/food/entries'),e=>e.code==='account_changed'&&e.message.includes('original'));assert.equal(headers['X-Kinetta-Account'],'1');
 c.fetch=async(p,o)=>{headers=o.headers;return {ok:true,json:async()=>({})}};await c.ui.api('/api/me');assert.equal(headers['X-Kinetta-Account'],undefined,'identity discovery must read actual cookie account');
 storage=new Map();c=client(storage);c.ui.keep('/api/me',c.ui.App.me);assert.equal(c.ui.kept('/api/me').id,1);c.Native.base='https://other.invalid';assert.equal(c.ui.kept('/api/me'),null,'cached profile cannot cross servers');
 c=client();c.localStorage.setItem('fit.queue',JSON.stringify([{who:'zz_test_one',path:'/api/food/entries',method:'POST',body:[],label:'Legacy food'}]));let sent=0;c.api=async()=>sent++;await c.ui.Q.flush();assert.equal(sent,1,'legacy browser queue safely migrates on its origin');
 c=client();c.Native.on=true;c.localStorage.setItem('fit.queue',JSON.stringify([{who:'zz_test_one',path:'/api/food/entries',method:'POST',body:[],label:'Legacy native food'}]));c.api=async()=>{throw Error('must not send')};await c.ui.Q.flush();assert.equal(c.ui.Q.mine().length,1,'legacy native items are visible to review/logout warnings');assert.equal(c.ui.Q.all()[0].owner,undefined,'visibility does not bind or send legacy items');assert.equal(c.ui.Q.all().length,1,'unbound legacy native queue retained without sending to an unknown server');
 for(const failure of [{status:401},{status:409,code:'account_changed'}]) {
  c=client();c.ui.Q.add({path:'/api/food/entries',method:'POST',body:[],label:'Food'});c.api=async()=>{throw Object.assign(Error('Sign in again'),failure)};await c.ui.Q.flush();assert.equal(c.ui.Q.mine()[0].error,null);let sent=0;c.api=async()=>{sent++;return {}};await c.ui.Q.flush();assert.equal(sent,1);assert.equal(c.ui.Q.mine().length,0);
 }
 for(const native of [false,true]){
  c=client();c.Native.on=native;let attempts=0;c.ui.Q.add({path:'/api/food/entries',method:'POST',body:[{name:'Fictional retained food'}],label:'Food'});
  c.fetch=async()=>({ok:false,status:403,json:async()=>({detail:'Kit access is blocked by the administrator.'})});
  await assert.rejects(c.ui.api('/api/food/photo'),e=>e.status===403);assert(c.ui.App.me,'A 403 cannot log out the account');
  c.api=async()=>{attempts++;throw Object.assign(Error('Access denied'),{status:403})};await c.ui.Q.flush();await c.ui.Q.flush();
  assert.equal(attempts,1,'A denied queued write waits for explicit retry');assert.equal(c.ui.Q.mine()[0].body[0].name,'Fictional retained food');assert.equal(c.ui.Q.mine()[0].error,'Access denied');
 }
 c=client();c.ui.Q.add({path:'/api/food/entries',method:'POST',body:[],label:'Committed food'});c.api=async()=>({messages:[{}]});c.FoodThread={accept:async()=>{throw Error('Fictional render/quota failure')}};await c.ui.Q.flush();assert.equal(c.ui.Q.all().length,0,'post-commit drawing errors do not requeue saved food');
 c=client();let redraws=0;c.PageRefresh={available:()=>false};c.render=()=>redraws++;c.ui.Q.add({path:'/api/food/entries',method:'POST',body:[],label:'Queued food'});c.api=async()=>({});await c.ui.Q.flush();assert.equal(redraws,0,'background queue delivery preserves an active chat or editor');
 assert([...storage.values()].every(v=>!v.includes('fictional-never-store')),'credentials never persist in owner keys');
 console.log('offline queue: failures/reload, explicit retry, owner/server binding, in-flight races, storage quota, API identity constraint and legacy compatibility PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
