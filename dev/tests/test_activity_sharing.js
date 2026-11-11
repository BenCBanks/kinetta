// Activity picture choices use fictional owner data and stubbed transports only.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/pages.js','utf8'),socialSource=fs.readFileSync('app/static/social.js','utf8'),start=source.indexOf('function shareOut(a)'),end=source.indexOf('// cut `m` metres',start);
const activity={id:7,name:'Fictional paused run',sport:'run',line:'fictional-line',start_time:'2026-10-23T10:00:00Z',distance_m:8046.72,moving_s:2400,elapsed_s:3000,avg_hr:152,calories:400,ascent_m:30};
const sharing={details:{map:true,pace:true,heart_rate:false,elevation:false,calories:false},trim_m:400};
function fixture(social=sharing,act=activity){
 const calls={route:[],simple:[],api:[],leaf:[],toasts:[]},sourceContext={isConnected:true};let leafFailure=null;
 const ctx={owner:'zz_test_owner_a',App:{me:{units:'metric'}},SPORT_NAMES:{run:'Run'},location:{pathname:'/activity/7',search:''},root:sourceContext,document:{querySelector:()=>sourceContext},readOwner:()=>ctx.owner,
   api:async url=>{calls.api.push(url);return url.endsWith('/social')?{...social,details:{...social.details}}:{...act};},
   decode:()=>[[40,-75],[40.05,-75.05],[40.1,-75.1]],trimRoute:(points,metres)=>metres?points.slice(1,-1):points,
   rate:a=>{const elapsed=Number(a.elapsed_s),distance=Number(a.distance_m);if(!Number.isFinite(elapsed)||elapsed<=0)return{label:'Time',v:'–',u:''};if(!Number.isFinite(distance)||distance<=0)return{label:'Time',v:`${elapsed} seconds`,u:''};const pace=Math.round(elapsed/(distance/1609.344)),min=Math.floor(pace/60),sec=String(pace%60).padStart(2,'0');return{label:'Pace',v:`${min}:${sec}`,u:'/mi'};},activityElapsedText:a=>Number.isFinite(Number(a.elapsed_s))&&Number(a.elapsed_s)>0?`${a.elapsed_s} seconds`:'–',dur:n=>n+' seconds',fdate:()=> 'Oct 23, 2026',stat:(label,value,unit='')=>`<span><small>${label}</small><b>${value}${unit}</b></span>`,U:{dist:n=>n+' m',du:()=> 'm',time:n=>n+' seconds'},
   routePicture:async(...args)=>{calls.route.push(args);return new Blob(['activity']);},
   ShareArt:{simplePicture:async options=>{calls.simple.push(options);return{blob:new Blob(['simple']),alt:'Fictional picture'};}},
   loadShareArt:async()=>{calls.leaf.push('load');if(leafFailure)throw leafFailure;},
   ShareSheet:{open:options=>{ctx.options=options;}},toast:message=>{calls.toasts.push(message);ctx.toast=message;},setLeafFailure:error=>{leafFailure=error;},sourceContext};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\n'+socialSource.slice(socialSource.indexOf('function sharedActivityHero'),socialSource.indexOf('function drawShared')),ctx);return{ctx,calls};
}
const tick=()=>new Promise(setImmediate),plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 let f=fixture();f.ctx.sharePicture(7);await tick();let items=f.ctx.options.items;
 const sharedHero=f.ctx.sharedActivityHero(activity);assert.match(sharedHero,/Elapsed time/);assert.doesNotMatch(sharedHero,/Moving time/);assert.match(sharedHero,/Pace/,'shared activity hero prioritizes elapsed time and matching pace');
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Route map','Stats']);assert.equal(items[0].controls[0].checked,true,'endpoint trimming is checked by default');
 await items[0].build({hideEnds:true});assert.equal(f.calls.route.at(-1)[1],400,'the activity card keeps the default 400 m endpoint trim');assert.equal(f.calls.route.at(-1)[2].heart_rate,false,'hidden heart rate stays out of the existing activity picture');
 await items[0].build({hideEnds:false});assert.equal(f.calls.route.at(-1)[1],0,'the explicit checkbox choice reaches the existing generator');
 await items[1].build({hideEnds:true});assert.deepEqual(plain(f.calls.simple.at(-1).routePoints),[[40.05,-75.05]],'the map option uses the trimmed points');assert.equal(f.calls.simple.at(-1).routeTrimmed,true);
 await items[1].build({hideEnds:false});assert.deepEqual(plain(f.calls.simple.at(-1).routePoints),[[40,-75],[40.05,-75.05],[40.1,-75.1]]);assert.equal(f.calls.simple.at(-1).routeTrimmed,false,'untrimmed map alt text matches the visible endpoints');
 await items[2].build({});assert(f.calls.simple.at(-1).facts.includes('Elapsed time: 3000 seconds'));assert(f.calls.simple.at(-1).facts.includes('Pace: 10:00 /mi'));assert.equal(f.calls.simple.at(-1).value,'8046.72 m');assert.equal(f.calls.route.at(-1)[0].moving_s,2400);assert.equal(f.calls.route.at(-1)[0].elapsed_s,3000);assert(!f.calls.simple.at(-1).facts.some(x=>/heart rate|calories/i.test(x)),'disabled details do not appear in Stats');
 console.log('Activity share: activity card, trimmed/full route map, stats and detail switches PASS');

 f=fixture({...sharing,trim_m:0});f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;
 assert.equal(items[0].controls[0].checked,true,'a saved zero still opens with endpoint trimming checked');await items[0].build({hideEnds:true});assert.equal(f.calls.route.at(-1)[1],400,'zero falls back to the safe 400 m trim');
 console.log('Activity share privacy: saved zero trim restores the safe checked default PASS');

 f=fixture({trim_m:0,details:{map:false,pace:false,heart_rate:false,elevation:false,calories:false}});f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Stats'],'the map option is omitted when the map detail is off');assert.equal(items[0].controls.length,0);await items[0].build({});assert.equal(f.calls.route.at(-1)[0].line,null);assert.equal(f.calls.route.at(-1)[1],0,'a hidden map never reaches the picture generator');
 await items[1].build({});assert.deepEqual(plain(f.calls.simple.at(-1).facts),['Elapsed time: 3000 seconds'],'hidden stats remain out of the image');
 console.log('Activity share privacy: hidden map/details stay out of every picture PASS');

 f=fixture(sharing,{...activity,elapsed_s:null});f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;await items[0].build({});await items[2].build({});const unknown=f.calls.simple.at(-1);assert.equal(unknown.value,'8046.72 m');assert.deepEqual(plain(unknown.facts),['Elapsed time: –'],'unknown elapsed time never falls back to moving time');assert.equal(f.calls.route.at(-1)[0].moving_s,2400,'moving duration remains preserved in activity-card input');
 console.log('Activity share: unknown elapsed remains unavailable while moving duration stays distinct PASS');

 f=fixture();const known={...activity};f.ctx.shareOut(known);await tick();
 assert.deepEqual(f.calls.api,['/api/activities/7/social'],'activity detail reuses the activity but still fetches missing sharing preferences');assert.deepEqual(plain(known._social),plain(sharing));assert.equal(f.ctx.options.items[0].controls[0].checked,true);
 f=fixture();f.ctx.shareOut({...activity,_social:sharing});await tick();assert.deepEqual(f.calls.api,[],'the cached detail social settings avoid a redundant request');
 console.log('Activity detail sharing: cached workout takes the detail path and fetches missing privacy settings only PASS');

 f=fixture();let resolveSocial;f.ctx.api=url=>{f.calls.api.push(url);return new Promise(resolve=>resolveSocial=resolve);};f.ctx.shareOut({...activity});f.ctx.owner='zz_test_owner_b';resolveSocial(sharing);await tick();assert.equal(f.ctx.options,undefined,'a late social response cannot open a previous account’s share sheet');
 console.log('Activity share: account switch blocks a late privacy-settings result PASS');

 f=fixture();const knownForRetry={...activity,_social:sharing};f.ctx.setLeafFailure(Error('Fictional share leaf failure'));f.ctx.shareOut(knownForRetry);await tick();assert.equal(f.ctx.options,undefined,'a failed leaf load cannot open an incomplete share sheet');assert.match(f.ctx.toast,/Fictional share leaf failure/);f.ctx.setLeafFailure(null);f.ctx.shareOut(knownForRetry);await tick();assert(f.ctx.options,'retry after a failed leaf load reaches the existing share sheet');assert.equal(f.calls.leaf.length,2,'each action retries the loader after its failure');
 console.log('Activity share: failed leaf load reports an error and the next action retries PASS');

 f=fixture();let releaseLeaf;f.ctx.loadShareArt=()=>{f.calls.leaf.push('load');return new Promise(resolve=>releaseLeaf=resolve);};f.ctx.shareOut({...activity,_social:sharing});while(!releaseLeaf)await tick();f.ctx.location.pathname='/me';releaseLeaf();await tick();assert.equal(f.ctx.options,undefined,'a late leaf load cannot open a share sheet after route navigation');
 console.log('Activity share: route change during leaf load blocks the stale sheet PASS');

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
