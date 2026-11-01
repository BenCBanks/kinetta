// Observe the real production appearance code with plain and Capacitor-style proxy bridges.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const install=require('./native-ui/display-diagnostics.js'),appearance=fs.readFileSync('app/static/appearance.js','utf8');
const flush=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({proxy=false,read=()=>Promise.resolve({reduceTransparency:false,increaseContrast:false}),start=true,missing=false,locked=false}={}){
 const classes=new Set(['native']),observers=[],events=new Map(),documentEvents=new Map(),nativeEvents={},timers=new Map(),requests=[];let clock=0,timer=0,removed=0;
 const emit=(map,name,value)=>{for(const fn of map.get(name)||[])fn(value);};
 const changed=()=>observers.forEach(fn=>fn());
 const root={classList:{contains:key=>classes.has(key),add:key=>{classes.add(key);changed();},remove:key=>{classes.delete(key);changed();},toggle:(key,on)=>{on?classes.add(key):classes.delete(key);changed();}}};
 const handle={remove:()=>{removed++;return Promise.resolve();}},registered=Promise.resolve(handle);
 let raw;
 const methods={getState:function(...args){assert.equal(this,raw);requests.push(args);return read(...args);},addListener:function(event,fn){nativeEvents[event]=fn;return registered;}};
 raw=proxy?new Proxy({},{get:(_,key)=>methods[key]}):methods;
 const untouched={get:()=>Promise.resolve({value:null})},registry={KinettaDisplayPreferences:missing?undefined:raw,App:{addListener:function(event,fn){nativeEvents[event]=fn;return registered;}},Preferences:untouched};
 const cap={isNativePlatform:()=>true,PluginHeaders:[{name:'KinettaDisplayPreferences',methods:[{name:'getState'}]}],Plugins:registry};
 if(locked)Object.defineProperty(cap,'Plugins',{value:registry,writable:false,configurable:false});
 const cfg={},c={Capacitor:cap,KinettaUIFixture:cfg,performance:{now:()=>clock},Promise,
  document:{documentElement:root,visibilityState:'visible',addEventListener:(name,fn)=>{documentEvents.set(name,[...(documentEvents.get(name)||[]),fn]);}},
  MutationObserver:class{constructor(fn){this.fn=fn;}observe(){observers.push(this.fn);}},
  addEventListener:(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]),setTimeout:(fn,ms)=>{assert.equal(ms,2000);timers.set(++timer,fn);return timer;},clearTimeout:n=>timers.delete(n)};
 install(cfg,c);assert.equal(requests.length,0,'Installing diagnostics must not invoke the bridge');assert.equal(Object.keys(nativeEvents).length,0,'Installing diagnostics adds no native subscription');
 vm.createContext(c);if(start)vm.runInContext(appearance,c);
 return {c,cfg,classes,requests,raw,registered,handle,untouched,nativeEvents,timers,removed:()=>removed,clock:value=>clock=value,emit:(name,value)=>emit(events,name,value),visibility:()=>emit(documentEvents,'visibilitychange')};
}
(async()=>{
 for(const proxy of [false,true]){
  const pending=deferred(),f=fixture({proxy,read:()=>pending.promise,start:false});
  const result=f.c.Capacitor.Plugins.KinettaDisplayPreferences.getState('fictional-argument');assert.equal(result,pending.promise,'Original promise identity survives');assert.deepEqual(f.requests,[['fictional-argument']]);
  assert.equal(f.c.Capacitor.Plugins.Preferences,f.untouched,'Unrelated plugins remain untouched');
  const state={reduceTransparency:false,increaseContrast:false,privateValue:'fictional-private-marker'};pending.resolve(state);assert.equal(await result,state);await flush();assert(!f.classes.has('native-display-ready'),'Observation never supplies readiness');
  assert.equal(f.cfg.displayDiagnostics().events.find(x=>x.event==='read-end').reduceTransparencyType,'boolean');assert(!JSON.stringify(f.cfg.displayDiagnostics()).includes('fictional-private-marker'));
  let received,receiver;const context={from:'native'};const callback=function(value){received=value;receiver=this;};
  const registration=f.c.Capacitor.Plugins.KinettaDisplayPreferences.addListener('changed',callback);assert.equal(registration,f.registered,'Original registration promise survives');f.nativeEvents.changed.call(context,state);assert.equal(received,state);assert.equal(receiver,context);assert.equal(await registration,f.handle);
  let replacements=0;const replacement={getState:()=>{replacements++;return Promise.resolve(state);}};f.c.Capacitor.Plugins.KinettaDisplayPreferences=replacement;assert.equal(await f.c.Capacitor.Plugins.KinettaDisplayPreferences.getState(),state);assert.equal(replacements,1,'A later registration uses its actual new plugin');
  const custom={value:'explicit-receiver'};f.c.Capacitor.Plugins.KinettaDisplayPreferences={getState:function(value){assert.equal(this,custom);return value;},addListener:function(event,fn){assert.equal(this,custom);return fn;}};const observed=f.c.Capacitor.Plugins.KinettaDisplayPreferences;assert.equal(observed.getState.call(custom,state),state,'Explicit receiver also survives');assert.equal(observed.addListener.call(custom,'other',callback),callback);
  const normal=fixture({proxy});await flush();assert(normal.classes.has('native-display-ready'));assert.equal(normal.requests.length,1);assert(normal.cfg.displayDiagnostics().events.some(x=>x.event==='classes'&&x.ready));
  normal.nativeEvents.changed({reduceTransparency:true,increaseContrast:false});assert(normal.classes.has('native-reduce-transparency'));normal.nativeEvents.appStateChange({isActive:true});await flush();assert.equal(normal.requests.length,2,'Only the existing foreground handler reads again');assert(normal.cfg.displayDiagnostics().events.some(x=>x.event==='event'&&x.active===true));
  normal.emit('pagehide');assert.equal(normal.removed(),2,'Real production cleanup still removes both handles');assert(normal.cfg.displayDiagnostics().events.some(x=>x.event==='pagehide'));
 }
 for(const proxy of [false,true]){
 const late=deferred(),f=fixture({proxy,read:()=>late.promise});await flush();f.clock(2001);for(const fn of [...f.timers.values()])fn();await flush();assert(!f.classes.has('native-display-ready'));assert.equal(f.cfg.displayDiagnostics().pending[0].elapsed,2001);
 f.clock(3000);late.resolve({reduceTransparency:false,increaseContrast:false});await flush();assert(f.classes.has('native-display-ready'),'A real valid late success applies after the fallback watchdog');assert.equal(f.requests.length,1,'Diagnostics never retries');assert.equal(f.cfg.displayDiagnostics().events.find(x=>x.event==='read-end').elapsed,3000);
 assert.equal(f.cfg.displayDiagnostics().pending.length,0);assert(f.cfg.displayDiagnostics().events.some(x=>x.event==='classes'&&x.ready),'Only the actual production reply supplies readiness');
 }
 const malformed=fixture({read:()=>Promise.resolve({reduceTransparency:'false',increaseContrast:false})});await flush();assert(!malformed.classes.has('native-display-ready'));assert.equal(malformed.cfg.displayDiagnostics().events.find(x=>x.event==='read-end').reduceTransparencyType,'string');
 const error=Object.assign(Error('fictional-secret-url'),{code:'UNIMPLEMENTED'}),rejected=fixture({read:()=>Promise.reject(error)});await flush();assert(!rejected.classes.has('native-display-ready'));assert.equal(rejected.cfg.displayDiagnostics().events.find(x=>x.event==='read-reject').errorCode,'UNIMPLEMENTED');assert(!JSON.stringify(rejected.cfg.displayDiagnostics()).includes('fictional-secret-url'));
 const thrown=TypeError('fictional-secret'),sync=fixture({start:false,read:()=>{throw thrown;}});assert.throws(()=>sync.c.Capacitor.Plugins.KinettaDisplayPreferences.getState(),value=>value===thrown);assert.equal(sync.cfg.displayDiagnostics().pending.length,0);
 const missing=fixture({missing:true});await flush();assert(!missing.classes.has('native-display-ready'));assert.equal(missing.cfg.displayDiagnostics().presence.plugin,false);
 const locked=fixture({locked:true});await flush();assert(locked.classes.has('native-display-ready'),'An unavailable observer cannot break the real bridge');assert(locked.cfg.displayDiagnostics().events.some(x=>x.event==='registry-unavailable'));
 const bounded=fixture({start:false});for(let n=0;n<100;n++)bounded.visibility();assert.equal(bounded.cfg.displayDiagnostics().events.length,64);assert(bounded.cfg.displayDiagnostics().dropped>0);
 console.log('Native display diagnostics: real promises/receivers/listeners, proxy replacement, watchdog fallback then real late readiness, malformed/rejected/missing bridges, bounded safe metadata and production cleanup PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
