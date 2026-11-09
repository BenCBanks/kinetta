// Activity picture options reuse the established generators and owner sharing preferences.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('function sharePicture('),end=source.indexOf('// cut `m` metres',start);
const activity={id:7,name:'Fictional run',sport:'run',line:'fictional-line',start_time:'2026-10-23T10:00:00Z',distance_m:5000,moving_s:1500,avg_hr:152,calories:400,ascent_m:30};
const sharing={details:{map:true,pace:true,heart_rate:false,elevation:false,calories:false},trim_m:400};
function fixture(){
 const calls={route:[],simple:[]},ctx={owner:'zz_test_owner_a',App:{me:{units:'metric'}},SPORT_NAMES:{run:'Run'},readOwner:()=>ctx.owner,
   api:async url=>url.endsWith('/social')?{...sharing,details:{...sharing.details}}:{...activity},decode:()=>[[40,-75],[40.05,-75.05],[40.1,-75.1]],trimRoute:(points,metres)=>{calls.trim=metres;return metres?points.slice(1,-1):points;},
   rate:()=>({label:'Pace',v:'5:00',u:'/km'}),dur:n=>n+' seconds',fdate:()=> 'Oct 23, 2026',U:{dist:n=>n+' km',du:()=> 'km'},
   routePicture:async(...args)=>{calls.route.push(args);return new Blob(['activity'])},ShareArt:{simplePicture:async options=>{calls.simple.push(options);return{blob:new Blob(['simple']),alt:'Fictional picture'}}},
   ShareSheet:{open:options=>{ctx.options=options}},toast:message=>{ctx.toast=message}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return{ctx,calls};
}
const tick=()=>new Promise(setImmediate),plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 let f=fixture();f.ctx.sharePicture(7);await tick();let items=f.ctx.options.items;
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Route map','Stats']);assert.equal(items[0].controls[0].checked,true,'saved route trim is selected by default');
 await items[0].build({hideEnds:true});assert.equal(f.calls.route.at(-1)[1],400,'the activity card keeps the saved endpoint trim');assert.equal(f.calls.route.at(-1)[2].heart_rate,false,'hidden heart rate stays out of the existing activity picture');
 await items[0].build({hideEnds:false});assert.equal(f.calls.route.at(-1)[1],0,'the explicit checkbox choice reaches the existing generator');
 await items[1].build({hideEnds:true});assert.deepEqual(plain(f.calls.simple.at(-1).routePoints),[[40.05,-75.05]],'the map option uses the trimmed points');
 await items[2].build({});assert(f.calls.simple.at(-1).facts.some(x=>x.startsWith('Time:')));assert(!f.calls.simple.at(-1).facts.some(x=>/heart rate|calories/i.test(x)),'disabled details do not appear in Stats');
 console.log('Activity Share options: activity, trimmed route, stats and detail switches PASS');

 f=fixture();f.ctx.api=async url=>url.endsWith('/social')?{trim_m:0,details:{map:false,pace:false,heart_rate:false,elevation:false,calories:false}}:{...activity};f.ctx.sharePicture(7);await tick();items=f.ctx.options.items;
 assert.deepEqual(plain(items.map(item=>item.label)),['Activity card','Stats'],'the map option is omitted when the map detail is off');assert.equal(items[0].controls.length,0);await items[0].build({});assert.equal(f.calls.route.at(-1)[0].line,null);assert.equal(f.calls.route.at(-1)[1],0,'a saved zero trim remains zero');
 await items[1].build({});assert.deepEqual(plain(f.calls.simple.at(-1).facts),['Time: 1500 seconds'],'hidden stats remain out of the image');
 console.log('Activity Share privacy: hidden map/details and zero trim remain respected PASS');
})().catch(error=>{console.error(error);process.exit(1)});
