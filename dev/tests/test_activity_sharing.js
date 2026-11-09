// Activity picture choices use fictional owner data and stubbed transports only.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('function shareOut(a)'),end=source.indexOf('// cut `m` metres',start);
const activity={id:7,name:'Fictional run',sport:'run',line:'fictional-line',start_time:'2026-10-23T10:00:00Z',distance_m:5000,moving_s:1500,avg_hr:152,calories:400,ascent_m:30};
const sharing={details:{map:true,pace:true,heart_rate:false,elevation:false,calories:false},trim_m:400};
function fixture(social=sharing){
 const calls={route:[],simple:[],api:[]},ctx={owner:'zz_test_owner_a',App:{me:{units:'metric'}},SPORT_NAMES:{run:'Run'},readOwner:()=>ctx.owner,
   api:async url=>{calls.api.push(url);return url.endsWith('/social')?{...social,details:{...social.details}}:{...activity};},
   decode:()=>[[40,-75],[40.05,-75.05],[40.1,-75.1]],trimRoute:(points,metres)=>metres?points.slice(1,-1):points,
   rate:()=>({label:'Pace',v:'5:00',u:'/km'}),dur:n=>n+' seconds',fdate:()=> 'Oct 23, 2026',U:{dist:n=>n+' km',du:()=> 'km',time:n=>n+' seconds'},
   routePicture:async(...args)=>{calls.route.push(args);return new Blob(['activity']);},
   ShareArt:{simplePicture:async options=>{calls.simple.push(options);return{blob:new Blob(['simple']),alt:'Fictional picture'};}},
   ShareSheet:{open:options=>{ctx.options=options;}},toast:message=>{ctx.toast=message;}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return{ctx,calls};
}
const tick=()=>new Promise(setImmediate),plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 let f=fixture();f.ctx.sharePicture(7);await tick();let items=f.ctx.options.items;
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Route map','Stats']);assert.equal(items[0].controls[0].checked,true,'endpoint trimming is checked by default');
 await items[0].build({hideEnds:true});assert.equal(f.calls.route.at(-1)[1],400,'the activity card keeps the default 400 m endpoint trim');assert.equal(f.calls.route.at(-1)[2].heart_rate,false,'hidden heart rate stays out of the existing activity picture');
 await items[0].build({hideEnds:false});assert.equal(f.calls.route.at(-1)[1],0,'the explicit checkbox choice reaches the existing generator');
 await items[1].build({hideEnds:true});assert.deepEqual(plain(f.calls.simple.at(-1).routePoints),[[40.05,-75.05]],'the map option uses the trimmed points');assert.equal(f.calls.simple.at(-1).routeTrimmed,true);
 await items[1].build({hideEnds:false});assert.deepEqual(plain(f.calls.simple.at(-1).routePoints),[[40,-75],[40.05,-75.05],[40.1,-75.1]]);assert.equal(f.calls.simple.at(-1).routeTrimmed,false,'untrimmed map alt text matches the visible endpoints');
 await items[2].build({});assert(f.calls.simple.at(-1).facts.some(x=>x.startsWith('Time:')));assert(!f.calls.simple.at(-1).facts.some(x=>/heart rate|calories/i.test(x)),'disabled details do not appear in Stats');
 console.log('Activity share: activity card, trimmed/full route map, stats and detail switches PASS');

 f=fixture({...sharing,trim_m:0});f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;
 assert.equal(items[0].controls[0].checked,true,'a saved zero still opens with endpoint trimming checked');await items[0].build({hideEnds:true});assert.equal(f.calls.route.at(-1)[1],400,'zero falls back to the safe 400 m trim');
 console.log('Activity share privacy: saved zero trim restores the safe checked default PASS');

 f=fixture({trim_m:0,details:{map:false,pace:false,heart_rate:false,elevation:false,calories:false}});f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Stats'],'the map option is omitted when the map detail is off');assert.equal(items[0].controls.length,0);await items[0].build({});assert.equal(f.calls.route.at(-1)[0].line,null);assert.equal(f.calls.route.at(-1)[1],0,'a hidden map never reaches the picture generator');
 await items[1].build({});assert.deepEqual(plain(f.calls.simple.at(-1).facts),['Time: 1500 seconds'],'hidden stats remain out of the image');
 console.log('Activity share privacy: hidden map/details stay out of every picture PASS');

 f=fixture();const known={...activity};f.ctx.shareOut(known);await tick();
 assert.deepEqual(f.calls.api,['/api/activities/7/social'],'activity detail reuses the activity but still fetches missing sharing preferences');assert.deepEqual(plain(known._social),plain(sharing));assert.equal(f.ctx.options.items[0].controls[0].checked,true);
 f=fixture();f.ctx.shareOut({...activity,_social:sharing});await tick();assert.deepEqual(f.calls.api,[],'the cached detail social settings avoid a redundant request');
 console.log('Activity detail sharing: cached workout takes the detail path and fetches missing privacy settings only PASS');

 f=fixture();let resolveSocial;f.ctx.api=url=>{f.calls.api.push(url);return new Promise(resolve=>resolveSocial=resolve);};f.ctx.shareOut({...activity});f.ctx.owner='zz_test_owner_b';resolveSocial(sharing);await tick();assert.equal(f.ctx.options,undefined,'a late social response cannot open a previous account’s share sheet');
 console.log('Activity share: account switch blocks a late privacy-settings result PASS');

 const native=fs.readFileSync('app/static/native.js','utf8'),block=native.slice(native.indexOf('  N.activityShareSupported'),native.indexOf('  N.headers ='));
 const bridgeCalls=[],old={on:false,P:{},N:{}};vm.createContext(old);vm.runInContext(block,old);assert.equal(old.N.activityShareSupported,false);await old.N.stopActivityShare();
 const bridge={on:true,P:{KinettaActivityShare:{share:async value=>bridgeCalls.push(value),cancel:async()=>bridgeCalls.push('cancel')}},N:{token:'fictional-token',base:'https://fictional.test'}};
 vm.createContext(bridge);vm.runInContext(block,bridge);assert.equal(bridge.N.activityShareSupported,true);await bridge.N.shareActivityPicture('fictional-image','instagram');assert.deepEqual(JSON.parse(JSON.stringify(bridgeCalls[0])),{image:'fictional-image',destination:'instagram'});await bridge.N.stopActivityShare();assert.equal(bridgeCalls[1],'cancel');
 console.log('Native share bridge: capability gate, image/destination payload and cancellation PASS');

 const app=fs.readFileSync('app/static/app.js','utf8'),closeCalls=[];
 const account={App:{me:{id:1},cache:{clear(){}}},readSessions:new WeakMap(),Native:{stopActivityShare:async()=>closeCalls.push('native')},keep(){},forgetKept(){},render(){}};
 account.App.mediaMapBack=()=>closeCalls.push('map');account.App.closeActivityShare=()=>closeCalls.push('picture');vm.createContext(account);
 vm.runInContext(app.slice(app.indexOf('function refreshMe('),app.indexOf('// ---------- offline:')),account);account.refreshMe({id:2});assert.equal(closeCalls.join(','),'map,picture,native');closeCalls.length=0;account.refreshMe({id:2});assert.equal(closeCalls.length,0,'same-account refresh keeps its interaction');
 console.log('Account replacement closes private map/picture/native handoffs; same-account refresh retains interaction PASS');
})().catch(error=>{console.error(error);process.exit(1)});
