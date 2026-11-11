// Real invitation controller with a fake native bridge, private device preferences and no Apple/network calls.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/push-invitation.js','utf8'),appSource=fs.readFileSync('app/static/app.js','utf8'),DAY=864e5;
const routeDeclarations=appSource.match(/const PUSH_INVITATION_ROUTE_ASSET = [^\n]+\nconst PUSH_INVITATION_HOMES = [^\n]+/)?.[0];
const routeHelperStart=appSource.indexOf('function loadPushInvitationForRoute(isCurrent) {');
const routeHelperEnd=appSource.indexOf('\nconst loadWeeklyRecapShareItem',routeHelperStart);
assert(routeDeclarations&&routeHelperStart>=0&&routeHelperEnd>routeHelperStart,'the actual app route gate source is present');
const routeHelperSource=appSource.slice(routeHelperStart,routeHelperEnd);
function fixture(overrides={}){
 let now=40*DAY,shows=0,enabled=0,settings=0;const records=new Map(),nodes=[],events={},controls={},timers=new Map();let timer=0;
 const doc={hidden:false,documentElement:{classList:{contains:()=>false}},querySelectorAll:()=>nodes.filter(n=>n.isConnected),addEventListener:(k,fn)=>events[k]=fn};
 const c={App:{me:{id:1},pageReady:true},location:{pathname:'/me',search:''},document:doc,Track:{active:false},Map,Set,Promise,JSON,Error,Date:class extends Date{static now(){return now;}},window:{addEventListener:(k,fn)=>events[k]=fn},MutationObserver:class{constructor(fn){events.mutation=fn;}observe(){}},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),invalidate(){},api:async path=>path.includes('/lifts/')?[]:{push_ready:true}};
 const key=()=>JSON.stringify([c.Native.base,c.App.me?.id]);
 c.Native={on:true,base:'https://example.test',token:'fictional-session',pushEntryBlocked:false,pushNavigationReady:Promise.resolve(),readPushInvitation:async()=>records.get(key())||null,writePushInvitation:async(choice,owner)=>{assert.equal(owner,key());records.set(owner,{...choice});},pushStatus:async()=>({supported:true,enabled:false,denied:false}),enablePush:async()=>{enabled++;},openPushSettings:async()=>{settings++;}};
 c.readOwner=()=>JSON.stringify([key(),c.Native.token]);
 c.sheet=(title,html,mount)=>{shows++;const node={isConnected:true},body={closest:()=>node};nodes.push(node);const close=()=>node.isConnected=false;controls.enable={textContent:html.includes('Open iPhone Settings')?'Open iPhone Settings':'Turn on notifications'};controls.later={};controls.error={};controls.explanation={};c.$=selector=>({'#pi-enable':controls.enable,'#pi-later':controls.later,'#pi-error':controls.error,'#pi-explanation':controls.explanation}[selector]);mount(body,close);return close;};
 Object.assign(c,overrides);vm.createContext(c);vm.runInContext(source+'\nglobalThis.invitation=PushInvitation;',c);
 return {c,records,controls,nodes,events,key,shows:()=>shows,enabled:()=>enabled,settings:()=>settings,setTime:v=>now=v,entry:async()=>{doc.hidden=true;events.visibilitychange?.();doc.hidden=false;events.visibilitychange?.();await c.invitation.consider();}};
}
function routeGate({pathname='/me',search='',native=true,signedIn=true,ready=true,load=()=>Promise.resolve()}={}){
 const loads=[];let considers=0;
 const c={location:{pathname,search},Native:{on:native,base:'https://fictional.test',token:native?'fictional-native-token':null},App:{me:signedIn?{id:1}:null,pageReady:ready},
  loadClassicScript(asset){loads.push(asset);return load(asset);},PushInvitation:{consider(){considers++;}}};
 c.readOwner=()=>JSON.stringify([c.Native.base,c.Native.token,c.App.me?.id]);
 vm.createContext(c);vm.runInContext(`${routeDeclarations}\n${routeHelperSource}\nglobalThis.invokeRouteGate=loadPushInvitationForRoute;`,c);
 return {c,loads,considers:()=>considers,invoke:current=>c.invokeRouteGate(current||(()=>true))};
}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
(async()=>{
 for(const [name,change] of [
  ['web',f=>f.c.Native.on=false],['signed out',f=>f.c.App.me=null],['not loaded',f=>f.c.App.pageReady=false],
  ['deeper page',f=>f.c.location.pathname='/track/health'],['query view',f=>f.c.location.search='?view=weight'],
  ['another sheet',f=>f.nodes.push({isConnected:true})],['keyboard',f=>f.c.document.documentElement.classList.contains=()=>true],
  ['focused text field',f=>f.c.document.activeElement={matches:()=>true}],['recording',f=>f.c.Track.active=true],['Health connection',f=>f.c.Native.connecting={}],['Health food connection',f=>f.c.Native.healthSetup=1],
  ['Health resting connection',f=>f.c.Native.restingConnecting={}],['hidden',f=>f.c.document.hidden=true],
  ['notification/deep entry',f=>f.c.Native.pushEntryBlocked=true],['native external entry',f=>f.c.Native.pushStatus=async()=>({supported:true,externalEntry:true})],
  ['not configured',f=>f.c.api=async path=>path.includes('/lifts/')?[]:{push_ready:false}],
  ['unsupported',f=>f.c.Native.pushStatus=async()=>({supported:false})],['already enabled',f=>f.c.Native.pushStatus=async()=>({supported:true,enabled:true})],
  ['lifting underway',f=>f.c.api=async path=>path.includes('/lifts/')?[{lift_open:true,start_time:new Date(40*DAY).toISOString()}]:{push_ready:true}],
 ]){const f=fixture();change(f);await f.c.invitation.consider();assert.equal(f.shows(),0,name+' must not show');}
 let f=fixture();await f.c.invitation.consider();assert.equal(f.shows(),1,'existing signed-in app open is eligible');assert.equal(f.records.get(f.key()).asks,1);f.controls.later.onclick();await f.c.invitation.consider();assert.equal(f.shows(),1,'Not now never immediately repeats');f.setTime(69*DAY);await f.entry();assert.equal(f.shows(),1,'29 days stays quiet');f.setTime(70*DAY);await f.entry();assert.equal(f.shows(),2,'30 days allows second ask');f.controls.later.onclick();f.setTime(150*DAY);await f.entry();assert.equal(f.shows(),2,'at most two asks');
 f=fixture();await f.c.invitation.consider();f.controls.later.onclick();f.c.App.me={id:2};f.c.Native.token='second-session';await f.c.invitation.consider();assert.equal(f.shows(),2,'second account gets its own invitation');assert.equal(f.records.size,2);assert([...f.records.values()].every(r=>r.asks===1));
 f=fixture();f.c.Native.pushStatus=async()=>({supported:true,denied:true});await f.c.invitation.consider();assert.equal(f.controls.enable.textContent,'Open iPhone Settings');await f.controls.enable.onclick();assert.equal(f.settings(),1);assert.equal(f.enabled(),0);assert(f.records.get(f.key()).done);
 f=fixture();await f.c.invitation.consider();await f.controls.enable.onclick();assert.equal(f.enabled(),1);assert(f.records.get(f.key()).done);await f.entry();assert.equal(f.shows(),1,'accepted choice is not asked again');
 f=fixture();f.c.Native.enablePush=async()=>{throw Error('Not allowed');};await f.c.invitation.consider();f.c.Native.pushStatus=async()=>({supported:true,denied:true});await f.controls.enable.onclick();assert.equal(f.controls.enable.textContent,'Open iPhone Settings');assert(f.controls.explanation.textContent.includes('blocked'));await f.controls.enable.onclick();assert.equal(f.settings(),1,'denial transitions to Settings instead of silently failing');
 f=fixture();let release;f.c.Native.pushStatus=()=>new Promise(r=>release=r);const read=f.c.invitation.consider();await new Promise(setImmediate);f.c.App.me={id:2};release({supported:true,enabled:false});await read;assert.equal(f.shows(),0,'old-account eligibility cannot show in a new account');
 f=fixture();await f.c.invitation.consider();f.c.Native.writePushInvitation=async()=>{f.c.App.me={id:2};};await f.controls.enable.onclick();assert.equal(f.enabled(),0,'account change while accepting cannot request permission for new account');
 f=fixture();await f.c.invitation.consider();f.c.document.documentElement.classList.contains=()=>true;await f.c.invitation.consider();assert.equal(f.nodes[0].isConnected,false,'keyboard appearing dismisses the invitation');
 f=fixture();f.c.Native.writePushInvitation=async()=>{throw Error('Storage unavailable');};await f.c.invitation.consider();assert.equal(f.shows(),0,'cannot reserve a durable ask: stay quiet');
 assert(f.c.invitation.shouldAsk({asks:1,lastAsked:0},30*DAY));assert(!f.c.invitation.shouldAsk({asks:1,lastAsked:0},29*DAY));
 for(const [name,options] of [
  ['web',{native:false}],['logged out',{signedIn:false}],['query route',{search:'?view=weight'}],
  ['profile',{pathname:'/people/fictional'}],['Contacts',{pathname:'/me/friends/contacts'}],
  ['profile settings',{pathname:'/me/settings'}],
 ]){const gate=routeGate(options);gate.invoke();await settle();assert.deepEqual(gate.loads,[],`${name} does not request the invitation module`);}
 for(const path of ['/me','/activity','/track','/progress','/food']){const gate=routeGate({pathname:path});gate.invoke();await settle();assert.deepEqual(gate.loads,['/static/push-invitation.js?v=__ASSET_HASH__'],`${path} requests the stamped module once`);assert.equal(gate.considers(),1,`${path} considers the invitation after loading`);}
 for(const [name,change] of [
  ['owner',gate=>{gate.c.App.me={id:2};}],['path',gate=>{gate.c.location.pathname='/activity';}],['readiness',gate=>{gate.c.App.pageReady=false;}],
 ]){
  let release;const gate=routeGate({load:()=>new Promise(resolve=>{release=resolve;})});gate.invoke();await settle();assert.equal(gate.loads.length,1,`${name} case starts the lazy request`);change(gate);release();await settle();assert.equal(gate.considers(),0,`a held load cannot consider after ${name} changes`);
 }
 let attempts=0;const retryGate=routeGate({load:()=>++attempts===1?Promise.reject(new Error('offline')):Promise.resolve()});
 retryGate.invoke();await settle();retryGate.invoke();await settle();assert.equal(attempts,2,'a rejected helper load can be requested again on the next eligible route');assert.equal(retryGate.considers(),1,'the successful retry considers once');
 console.log('Native push invitation: show/exclusion matrix, existing login, 30-day/two-ask limits, denied/Settings, native enable, owner changes, overlays and storage failures PASS');
 console.log('App push-invitation route gate: exact homes, web/login/query/profile/Contacts exclusions, stale owner/path/readiness and retry PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
