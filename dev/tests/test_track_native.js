// Actual native bridge adapter, with deterministic platform callbacks. No device/GPS data.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
(async()=>{
 const App={me:{id:1}},Native={on:true,base:'https://fictional.invalid',healthCall:p=>p};let revision=1,seen=[],pending;
 const plugin={attach:async a=>{seen.push(['attach',a.owner]);return{}},status:a=>new Promise(r=>pending=r),detach:async a=>{seen.push(['detach',a.owner]);return{}}};
 const ctx={App,Native,window:{Capacitor:{Plugins:{KinettaTrack:plugin},isPluginAvailable:()=>true}},readOwner:()=>String(revision),Promise,Error,JSON};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('app/static/track-native.js','utf8')+'\nglobalThis.T=TrackNative;',ctx);
 const p=ctx.T.call('status');while(!pending)await new Promise(r=>setImmediate(r));
 App.me={id:2};revision++;pending({session:{id:'old-account'}});
 await assert.rejects(p,/account changed/);
 await ctx.T.call('attach');
 const expected=JSON.stringify([Native.base,2]);
 const detach=ctx.T.detach();App.me=null;revision++;await detach;
 assert.equal(seen.at(-1)[0],'detach');assert.equal(seen.at(-1)[1],expected,'logout captures old owner before auth is cleared');
 assert(!seen.some(([kind,owner])=>kind==='detach'&&owner.includes('null')));
 console.log('PASS native recording bridge: delayed account results rejected and logout stops the captured owner');
})().catch(e=>{console.error(e);process.exit(1)});
