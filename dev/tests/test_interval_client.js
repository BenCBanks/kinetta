// Exercise the real builder contract and account/capability guards without a browser, provider or device.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
(async()=>{
 let revision=1,resolveCapabilities,calls=[],notices=[];
 const storage={};Object.defineProperties(storage,{getItem:{value(k){return this[k]??null}},setItem:{value(k,v){this[k]=String(v)}},removeItem:{value(k){delete this[k]}}});
 const ctx={console,JSON,Math,Number,Array,Object,Set,Map,Promise,Error,String,crypto,location:{origin:'https://fictional.invalid'},Native:{base:'https://fictional.invalid'},App:{me:{id:1}},localStorage:storage,store:{get:k=>{try{return JSON.parse(storage.getItem(k));}catch{return null;}}},readOwner:()=>revision,TrackNative:{supported:false,call:method=>{calls.push(method);return new Promise(r=>resolveCapabilities=r)}},toast:text=>notices.push(text)};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/intervals.js','utf8'),ctx);const I=ctx.Intervals;
 const fixtures=JSON.parse(fs.readFileSync('dev/tests/fixtures/interval_presets.json','utf8'));
 for(const fixture of fixtures){const p=I.expand(fixture.pin.definition);assert.deepStrictEqual(JSON.parse(JSON.stringify(p.steps)),fixture.expected_steps);}
 const fixture=fixtures[0],prefix='intervals:'+JSON.stringify(['https://fictional.invalid',1])+':';storage.setItem(prefix+'selected',JSON.stringify({...fixture.pin,...I.expand(fixture.pin.definition)}));
 assert.equal(I.selected().definition.name,fixture.pin.definition.name);
 await assert.rejects(I.startOptions({sport:'workout',gps:false}),/outdoor Run or Walk/);assert.deepStrictEqual(calls,[],'Unsupported start has no native effects');
 ctx.TrackNative.supported=true;
 const ready=I.startOptions({sport:'run',gps:true});resolveCapabilities({intervalCapabilities:{outdoor:true}});const options=await ready;
 assert.equal(options.intervalSayTotal,true);assert.equal(options.intervalSayPace,true);
 assert.equal(options.intervals.content_hash,fixture.pin.content_hash);assert.equal(options.autoPause,false);assert.equal(options.intervalVoice,true);assert.equal(options.intervalVibration,false);assert(!calls.includes('start')&&!calls.includes('locate'),'Preload/capability query starts no GPS');
 // Spoken prompts only (27 October 2026): no acknowledgement step, and older saved alert choices can't turn voice off or vibration on.
 storage.setItem(prefix+'alerts',JSON.stringify({voice:false,vibration:true,autoPause:true}));
 let request=I.startOptions({sport:'run',gps:true});resolveCapabilities({intervalCapabilities:{outdoor:true,vibrationAvailable:true}});let voiceOnly=await request;
 assert.equal(voiceOnly.intervalVoice,true);assert.equal(voiceOnly.intervalVibration,false);assert.equal(voiceOnly.autoPause,false);
 request=I.startOptions({sport:'walk',gps:true});resolveCapabilities({});await assert.rejects(request,/Update the iPhone app/,'An older iPhone app is asked to update');
 // Account-scoped Track settings are shared by builder/pre-start and never added to the preset.
 const trackPrefix='kinetta.track:'+JSON.stringify(['https://fictional.invalid',1])+':';
 storage.setItem(trackPrefix+'interval-total','false');storage.setItem(trackPrefix+'interval-pace','false');storage.setItem(trackPrefix+'voice','false');
 request=I.startOptions({sport:'run',gps:true});resolveCapabilities({intervalCapabilities:{outdoor:true}});const quiet=await request;
 assert.equal(quiet.intervalVoice,false);assert.equal(quiet.intervalSayTotal,false);assert.equal(quiet.intervalSayPace,false);
 assert.equal(JSON.stringify(quiet.intervals),JSON.stringify(options.intervals),'voice preferences cannot change checked preset content');
 storage.setItem(trackPrefix+'voice','true');storage.setItem(trackPrefix+'interval-total','true');
 request=I.startOptions({sport:'run',gps:true});resolveCapabilities({intervalCapabilities:{outdoor:true}});const justTime=await request;
 assert.equal(justTime.intervalVoice,true);assert.equal(justTime.intervalSayTotal,true);assert.equal(justTime.intervalSayPace,false);
 ctx.App.me={id:2};assert.deepStrictEqual(JSON.parse(JSON.stringify(I.voicePreferences())),{voice:true,total:true,pace:true});ctx.App.me={id:1};
 assert.equal(I.voicePreferences().pace,false,'switching back restores only this account’s saved choices');
 // Simple builder: Run/Walk/Repeat with optional warm-up and cool-down round-trips; other shapes are not opened in it.
 const B=I.builder,ids={wb:'wb',warm:'w',main:'m',run:'r',walk:'k',cb:'cb',cool:'c'};
 const form={name:'',run:{amount:'3',unit:'min'},walk:{amount:'90',unit:'s'},repeat:'4',warm:{amount:'5',unit:'min'},cool:null};
 const built=I.expand(B.build(form,ids));assert.equal(built.steps.length,9);assert.equal(built.totals.seconds,5*60+4*(180+90));assert.equal(built.definition.name,'Run 3 min / Walk 90 sec ×4');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(B.simpleOf(built.definition))),{...form,name:'Run 3 min / Walk 90 sec ×4'});
 const miles=I.expand(B.build({...form,run:{amount:'0.25',unit:'mi'},warm:null},ids));assert.equal(miles.mixed,true);assert.equal(miles.steps[0].kind,'distance');
 assert.throws(()=>I.expand(B.build({...form,repeat:'0'},ids)),/whole number/);assert.throws(()=>I.expand(B.build({...form,run:{amount:'',unit:'min'}},ids)),/positive target/);
 assert.equal(B.simpleOf({...built.definition,blocks:[...built.definition.blocks,built.definition.blocks[1]]}),null,'Other shapes are previewed, not edited');
 storage.setItem(prefix+'alerts',JSON.stringify({voice:true,vibration:false,acknowledged:true}));
 const pending=I.startOptions({sport:'walk',gps:true});ctx.App.me={id:2};revision++;resolveCapabilities({intervalCapabilities:{outdoor:true}});await assert.rejects(pending,/account changed/);assert.equal(I.selected(),null,'Second account cannot read first selection');
 ctx.App.me={id:1};revision++;ctx.api=async()=>({});await assert.rejects(I.verifySaveSupport(),/Update this server/);ctx.api=async()=>{throw Error('offline')};await assert.rejects(I.verifySaveSupport(),/could not confirm/);ctx.api=async()=>({schema:1,private_results:1});await I.verifySaveSupport();const compact=I.resultPayload({pin:fixture.pin,status:'finished',results:[],effects:[],phases:['must not upload runtime state'],phase_distance:999});assert.deepStrictEqual(Object.keys(compact).sort(),['effects','effects_omitted','pin','results','status']);
 // Use today: a lost acknowledgement reuses the same definition/save identity, then loads only the bound owner.
 const planWorkout={day:'2026-10-31',title:'Run/walk 8 x 1 min',track_intervals:{run_min:1,walk_min:1.5,repeat:8}},planCalls=[];ctx.json=(method,body)=>({method,body});let lost=true;
 ctx.api=async(path,request)=>{planCalls.push({path,request:JSON.parse(JSON.stringify(request))});if(lost){lost=false;throw Error('Lost reply');}return {id:path.split('/').at(-1),version:1,content_hash:'a'.repeat(64),...I.expand(request.body.definition)};};
 const previous=I.selected().content_hash;await assert.rejects(I.usePlan(planWorkout,17),/Lost reply/);assert.equal(I.selected().content_hash,previous,'failed Use preserves the loaded preset');
 assert(await I.usePlan(planWorkout,17));assert.deepStrictEqual(planCalls[0],planCalls[1],'retry identity and pinned content are unchanged');assert.equal(I.selected().totals.seconds,1800,'5 minute walks surround 8 x (1 + 1.5 minutes)');assert(!calls.includes('start'),'Use never starts recording');
 assert(await I.usePlan(planWorkout,17));assert.equal(planCalls[2].path,planCalls[1].path,'repeated Use reuses its saved snapshot');
 const beforeSwitch=I.selected().content_hash;let finishPlan;ctx.api=()=>new Promise(r=>finishPlan=r);const loading=I.usePlan({...planWorkout,day:'2026-11-01'},17);ctx.App.me={id:2};revision++;finishPlan({});await assert.rejects(loading,/account changed/);assert.equal(I.selected(),null,'late old-owner result cannot load into another account');ctx.App.me={id:1};revision++;assert.equal(I.selected().content_hash,beforeSwitch);
 assert(I.removeSelection());assert.equal(I.selected(),null,'Use on a plain run can explicitly remove loaded intervals');
 I.clear();assert.equal(storage.getItem(prefix+'selected'),null,'Sign-out/deletion clears only this account cache');
 console.log('PASS voice-only start (no vibration/acknowledgement), older-app update prompt, simple builder round-trip/validation, shared expansion, unsupported modes, owner switch, compact results and cache erasure');
})().catch(e=>{console.error(e);process.exit(1)});
