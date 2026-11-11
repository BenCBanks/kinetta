// Execute the actual presentation boundary with fictional own records; no browser, model or device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/milestones.js','utf8');let owner='fictional-owner',captured,resolve,leafLoads=0,leafError=null,leafWait=null,leafStarted=false,opened=null,toastText='';
const location={pathname:'/me',search:''},context={URLSearchParams,AbortController,setTimeout,clearTimeout,Intl,Date,Math,Symbol,console,location,App:{me:{units:'metric',login:'fictional_login',name:'PRIVATE REAL NAME'}},SPORT_NAMES:{run:'Run'},readOwner:()=>owner,loadShareArt:async()=>{leafLoads++;if(leafError)throw leafError;if(leafWait){leafStarted=true;await leafWait;}},ShareSheet:{open:options=>{opened=options;}},sheet(_title,_html,handler){handler({isConnected:true,querySelector:()=>null},()=>{});},toast:value=>{toastText=value;},route:()=>{},dur:n=>String(n)+' seconds',ShareArt:{simplePicture:async options=>(captured=options)},api:async()=>({items:[]})};
vm.createContext(context);vm.runInContext(source+'\nglobalThis.subject=Milestones;',context);
(async()=>{
 const M=context.subject;
 const food={kind:'food_days',title:'Logged food on 7 days',day:'2026-10-28',details:{amount:7,calories:9999,weight:123,private_note:'PRIVATE NOTE',garmin_sources:[]}};
 await M.picture(food);assert.equal(captured.value,'7');assert.equal(captured.identity,false);assert(!JSON.stringify(captured).includes('PRIVATE'));assert(!JSON.stringify(captured).includes('9999'));assert(!JSON.stringify(captured).includes('streak'));
 const year={...food,kind:'year_distance',details:{amount:250,unit:'mi',garmin_sources:['Garmin Forerunner 965']}};await M.picture(year,true);assert.equal(captured.unit,'mi');assert.equal(captured.identity,true);assert.deepEqual(Array.from(captured.sources),['Garmin Forerunner 965']);
 const activity={...food,kind:'first_distance',details:{distance_m:10000,seconds:3600,sport:'run'}};await M.picture(activity);assert.equal(captured.value,'10.0');assert.equal(captured.unit,'km');context.App.me.units='imperial';await M.picture(activity);assert.equal(captured.value,'6.2');assert.equal(captured.unit,'mi');
 const unknown={...activity,details:{distance_m:null,seconds:null,sport:'run'}};await M.picture(unknown);assert.equal(captured.value,'Run');assert.equal(captured.unit,'');assert.equal(captured.facts.length,0);
 const view={isConnected:true,querySelector:()=>null};context.api=async()=>({items:[food]});leafError=Error('fictional leaf failure');await M.open(food,null,view);assert.match(toastText,/Tap Share to try again/,'failed first load leaves the existing milestone action retryable');assert.equal(opened,null);leafError=null;await M.open(food,null,view);assert.equal(leafLoads,2);assert(opened?.items?.length===1,'the milestone sheet opens only after the leaf loads');
 opened=null;let releaseLeaf;leafWait=new Promise(resolve=>{releaseLeaf=resolve;});leafStarted=false;const late=M.open(food,null,view);while(!leafStarted)await Promise.resolve();location.pathname='/activity';releaseLeaf();await late;assert.equal(opened,null,'a stale route cannot open the milestone sheet after the leaf arrives');leafWait=null;location.pathname='/me';
 // Fresh owner-only route lookup; aggregation IDs never opt totals into a map.
 let calls=[],trimmed;const line=[[40,-75],[40.01,-75],[40.02,-75],[40.03,-75]],shared={visibility:'friends',details:{map:true},trim_m:0};
 context.decode=encoded=>{assert.equal(encoded,'fictional-line');return line;};context.trimRoute=(points,trim)=>{trimmed=trim;assert.equal(points,line);return points.slice(1,-1);};
 let detail={line:'fictional-line',visibility:'friends'},sharing=shared;
 context.api=async url=>{calls.push(url);return url.endsWith('/social')?sharing:detail;};
 const single={...activity,activity_id:13};
 assert.equal((await M.routePoints(single)).length,2);assert.equal(trimmed,400,'saved zero retains activity-picture default');assert.deepEqual(calls,['/api/activities/13','/api/activities/13/social']);
 sharing={...shared,trim_m:800};await M.routePoints(single);assert.equal(trimmed,800);
 for(const item of [{...year,activity_id:13},{...single,kind:'activity_weeks'},{...single,private_activity:true},{...single,activity_id:null}]){calls=[];assert.equal((await M.routePoints(item)).length,0);assert.equal(calls.length,0);}
 for(const policy of [{...shared,details:{map:false}},{...shared,details:{}},{...shared,visibility:'me'}]){sharing=policy;assert.equal((await M.routePoints(single)).length,0);}
 sharing=shared;detail={...detail,visibility:'me'};assert.equal((await M.routePoints(single)).length,0,'split-read privacy transition fails closed');
 detail={visibility:'everyone',line:null};assert.equal((await M.routePoints(single)).length,0,'missing GPS');
 context.api=async()=>{throw Error('offline');};await assert.rejects(M.routePoints(single),/offline/,'privacy fetch failure cannot export a stale map');
 detail={visibility:'everyone',line:'fictional-line'};context.api=url=>url.endsWith('/social')?new Promise(ok=>resolve=ok):Promise.resolve(detail);
 const lateRouteRead=M.routePoints(single);owner='new-account';resolve(shared);await assert.rejects(lateRouteRead,/account changed/);
 owner='fictional-owner';
 // Exercise the real activity-picture crop rather than the mocked boundary above.
 vm.runInContext(fs.readFileSync('app/static/pages.js','utf8').match(/function trimRoute\(pts, m\) \{[\s\S]*?\n\}/)[0],context);
 context.api=async url=>url.endsWith('/social')?shared:{visibility:'friends',line:'fictional-line'};
 context.decode=()=>[[40,-75],[40.003,-75],[40.006,-75]];
 assert.equal((await M.routePoints(single)).length,0,'under 2 × 400 m + 200 m cannot show a route');
 let path;context.api=async url=>{path=url;return {items:[food]}};assert.equal((await M.read({activity_id:13})).items.length,1);assert.equal(path,'/api/milestones?activity_id=13');
 context.api=()=>new Promise(ok=>resolve=ok);const pending=M.read();owner='another-account';resolve({items:[food]});await assert.rejects(pending,/account changed/);
 console.log('Milestones: actual picture boundary, fixed counts, unknowns, units, safe credits, identity off, map policy/cropping and late account isolation PASS');
})().catch(e=>{console.error(e);process.exit(1)});
