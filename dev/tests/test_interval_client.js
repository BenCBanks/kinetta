// Exercise the real builder contract and account/capability guards without a browser, provider or device.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 let revision=1,resolveCapabilities,calls=[];
 const storage={};Object.defineProperties(storage,{getItem:{value(k){return this[k]??null}},setItem:{value(k,v){this[k]=String(v)}},removeItem:{value(k){delete this[k]}}});
 const ctx={console,JSON,Math,Number,Array,Object,Set,Map,Promise,Error,String,crypto,location:{origin:'https://fictional.invalid'},Native:{base:'https://fictional.invalid'},App:{me:{id:1}},localStorage:storage,store:{get:k=>{try{return JSON.parse(storage.getItem(k));}catch{return null;}}},readOwner:()=>revision,TrackNative:{supported:false,call:method=>{calls.push(method);return new Promise(r=>resolveCapabilities=r)}},toast:()=>{}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/intervals.js','utf8'),ctx);const I=ctx.Intervals;
 const fixtures=JSON.parse(fs.readFileSync('dev/tests/fixtures/interval_presets.json','utf8'));
 for(const fixture of fixtures){const p=I.expand(fixture.pin.definition);assert.deepStrictEqual(JSON.parse(JSON.stringify(p.steps)),fixture.expected_steps);}
 const fixture=fixtures[0],prefix='intervals:'+JSON.stringify(['https://fictional.invalid',1])+':';storage.setItem(prefix+'selected',JSON.stringify({...fixture.pin,...I.expand(fixture.pin.definition)}));
 assert.equal(I.selected().definition.name,fixture.pin.definition.name);
 await assert.rejects(I.startOptions({sport:'workout',gps:false}),/outdoor Run or Walk/);assert.deepStrictEqual(calls,[],'Unsupported start has no native effects');
 ctx.TrackNative.supported=true;await assert.rejects(I.startOptions({sport:'run',gps:true}),/review the early-build/);assert.deepStrictEqual(calls,[]);
 storage.setItem(prefix+'alerts',JSON.stringify({voice:true,vibration:false,autoPause:false,acknowledged:true}));
 const ready=I.startOptions({sport:'run',gps:true});resolveCapabilities({intervalCapabilities:{outdoor:true}});const options=await ready;
 assert.equal(options.intervals.content_hash,fixture.pin.content_hash);assert.equal(options.autoPause,false);assert.equal(options.intervalVoice,true);assert.equal(options.intervalVibration,false);assert(!calls.includes('start')&&!calls.includes('locate'),'Preload/capability query starts no GPS');
 const pending=I.startOptions({sport:'walk',gps:true});ctx.App.me={id:2};revision++;resolveCapabilities({intervalCapabilities:{outdoor:true}});await assert.rejects(pending,/account changed/);assert.equal(I.selected(),null,'Second account cannot read first selection');
 ctx.App.me={id:1};revision++;ctx.api=async()=>({});await assert.rejects(I.verifySaveSupport(),/Update this server/);ctx.api=async()=>{throw Error('offline')};await assert.rejects(I.verifySaveSupport(),/could not confirm/);ctx.api=async()=>({schema:1,private_results:1});await I.verifySaveSupport();const compact=I.resultPayload({pin:fixture.pin,status:'finished',results:[],effects:[],phases:['must not upload runtime state'],phase_distance:999});assert.deepStrictEqual(Object.keys(compact).sort(),['effects','effects_omitted','pin','results','status']);
 I.clear();assert.equal(storage.getItem(prefix+'selected'),null,'Sign-out/deletion clears only this account cache');
 console.log('PASS interval client shared expansion, unsupported and unacknowledged modes, independent alerts, unchanged sport, owner switch, compact results and cache erasure');
})().catch(e=>{console.error(e);process.exit(1)});
