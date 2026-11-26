// Consent/registration proof against actual native.js; no device, server or provider calls.
'use strict';
const assert=require('node:assert/strict');
module.exports=async function pushConsentChecks(device){
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 async function fixture(){
  const listeners={},calls=[],server=new Set();let allowed=true,denied=false,phoneFailure=false,serverFailure=false,token='aa'.repeat(32),clock=Date.now();
  const push={status:async()=>({allowed,denied}),register:async({request})=>{calls.push(['register',request]);if(phoneFailure||!allowed)throw Error('Fictional registration unavailable');return{token,environment:'sandbox'};},unregister:async()=>calls.push(['unregister']),openSettings:async()=>calls.push(['settings']),takePending:async()=>({url:''}),addListener:(name,fn)=>{listeners[name]=fn;}};
  const d=device(null,push),n=d.n;await n.ready;n.base='https://example.test';n.token='fictional-login';
  d.ctx.Date=class extends Date{static now(){return clock;}};
  d.ctx.api=async(path,opts)=>{assert.equal(path,'/api/push/ios');calls.push([opts.method]);if(serverFailure)throw Object.assign(Error('Fictional server registration failure'),{status:typeof serverFailure==='number'?serverFailure:503});if(opts.method==='POST')server.add(JSON.parse(opts.body).token);else server.clear();return{ok:true};};
  const owner=JSON.stringify([n.base,1]),sync=async()=>{n.syncPush();await n.pushNavigationReady;};
  const back=async()=>{d.events.focus();await n.pushNavigationReady;};
  const visible=async()=>{d.ctx.document.hidden=false;d.events.visibilitychange();await n.pushNavigationReady;};
  return{...d,owner,calls,server,sync,back,visible,advance:()=>{clock+=60001;},permission:(a,b=false)=>{allowed=a;denied=b;},phoneFailure:v=>{phoneFailure=v;},serverFailure:v=>{serverFailure=v;},rotate:async value=>{token=value;listeners.tokenChanged({token,environment:'sandbox'});await tick();},postCount:()=>calls.filter(c=>c[0]==='POST').length};
 }
 const f=await fixture();await f.n.enablePush();assert.equal(f.saved.get('push.owner'),f.owner);assert.equal(f.saved.get('push.wanted'),f.owner);
 await f.n.disconnectPush({forget:true});const off=f.postCount();assert(!f.saved.has('push.owner'));assert(!f.saved.has('push.wanted'));
 await f.back();await f.visible();await f.rotate('bb'.repeat(32));assert.equal(f.postCount(),off,'focus/return/token change never re-enroll an old app opt-out');
 // A settings link is not an opt-in, even if Apple permission is subsequently granted.
 f.permission(false,true);await f.n.openPushSettings();assert(!f.saved.has('push.wanted'));f.permission(true);await f.back();await f.visible();assert.equal(f.postCount(),off);assert(!(await f.n.pushStatus()).enabled);
 // enable:true is the explicit opt-in invitation path, not the passive Settings link.
 f.permission(false,true);await f.n.openPushSettings({enable:true});assert.equal(f.saved.get('push.wanted'),f.owner);assert(!f.saved.has('push.owner'));await f.back();assert.equal(f.postCount(),off);
 f.permission(true);await f.back();assert.equal(f.postCount(),off+1);assert.equal(f.saved.get('push.owner'),f.owner);assert((await f.n.pushStatus()).enabled);
 assert(f.calls.filter(c=>c[0]==='register').slice(-1).every(c=>c[1]===false),'return from Settings never prompts Apple');
 f.permission(false,true);f.advance();await f.visible();const denied=f.postCount();assert(!(await f.n.pushStatus()).enabled);assert.equal(f.saved.get('push.owner'),f.owner);assert.equal(f.saved.get('push.wanted'),f.owner);
 f.permission(true);f.advance();await f.visible();assert.equal(f.postCount(),denied+1,'existing consent resumes after OS permission is restored');
 await f.rotate('cc'.repeat(32));assert(f.server.has('cc'.repeat(32)),'APNs token replacement is posted for the consenting account');
 // A server-pruned invalid token is not an opt-out: retained consent permits repair.
 f.server.clear();assert((await f.n.pushStatus()).enabled,'pushStatus is local Apple permission + owner, not a server-delivery guarantee');f.advance();await f.back();assert(f.server.has('cc'.repeat(32)));assert.equal(f.saved.get('push.wanted'),f.owner);
 const bearerPosts=f.postCount();f.n.token='replacement-fictional-session';f.advance();await f.back();assert.equal(f.postCount(),bearerPosts+1,'same-account replacement bearer rebinds with retained consent');assert.equal(f.saved.get('push.wanted'),f.owner);
 const retained=f.postCount();f.server.clear();f.serverFailure(401);f.advance();await f.back();assert.equal(f.postCount(),retained+1);assert.equal(f.server.size,0);assert.equal(f.saved.get('push.owner'),f.owner);assert.equal(f.saved.get('push.wanted'),f.owner);
 f.serverFailure(false);await f.back();assert(f.server.has('cc'.repeat(32)),'failed automatic repair can retry without changing saved intent');
 const fresh=await fixture();fresh.phoneFailure(true);await assert.rejects(fresh.n.enablePush(),/registration unavailable/);assert(!fresh.saved.has('push.owner'));assert(!fresh.saved.has('push.wanted'));await fresh.back();assert.equal(fresh.postCount(),0);
 fresh.phoneFailure(false);fresh.serverFailure(true);await assert.rejects(fresh.n.enablePush(),/server registration failure/);assert(!fresh.saved.has('push.owner'));assert(!fresh.saved.has('push.wanted'));await fresh.back();assert.equal(fresh.postCount(),1,'failed first enrollment creates no automatic opt-in');
 fresh.serverFailure(false);await fresh.n.enablePush();assert.equal(fresh.saved.get('push.owner'),fresh.owner);assert.equal(fresh.saved.get('push.wanted'),fresh.owner);
 // Retained markers are scoped to server/account; explicit old opt-outs have neither.
 const legacy=await fixture();legacy.saved.set('push.owner',legacy.owner);await legacy.sync();assert.equal(legacy.postCount(),1,'a retained owner is legacy consent');assert.equal(legacy.saved.get('push.wanted'),legacy.owner);
 const wanted=await fixture();wanted.saved.set('push.wanted',wanted.owner);await wanted.sync();assert.equal(wanted.postCount(),1,'explicit pending intent may complete once Apple allows it');
 wanted.ctx.App.me={id:2};wanted.advance();const before=wanted.postCount();await wanted.back();await wanted.rotate('dd'.repeat(32));assert.equal(wanted.postCount(),before,'other accounts cannot inherit markers');
 console.log('Native push consent: old opt-out, Settings return, explicit invitation, retained markers, rotation, first/repair failure and server-pruned token PASS');
};
