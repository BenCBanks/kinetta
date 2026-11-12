'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('app/static/app.js','utf8'),pages=fs.readFileSync('app/static/pages.js','utf8'),progress=fs.readFileSync('app/static/progress-routes.js','utf8');
const ctx={FOOT:['run','walk','hike'],MI:1609.344,imp:()=>false,dur:s=>s+'s',esc:String,fdate:()=> 'Jan 1',route:()=>{},U:{dist:n=>String(n),du:()=> 'm',speed:n=>String(n*3.6),su:()=> 'km/h',pace:n=>String(n),pu:()=> '/km',swim:s=>{const n=Math.round(s/10);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;},swu:()=> '/100m',time:s=>s+'s',eu:()=> 'm'}};
vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function rate(a)'),app.indexOf('// ---------- icons'))+'\n'+pages.slice(pages.indexOf('const stat ='),pages.indexOf('// One card'))+'\n'+pages.slice(pages.indexOf('function sharedHeadline'),pages.indexOf('// Cheers straight'))+'\n'+pages.slice(pages.indexOf('function similarHtml'),pages.indexOf('function editActivity'))+'\n'+pages.slice(pages.indexOf('const ZN ='),pages.indexOf('route(/^\\/activity',pages.indexOf('const ZN =')))+'\n'+pages.slice(pages.indexOf('function routeActivityRate'),pages.indexOf('route(/^\\/route')),ctx);
const ride={sport:'ride',distance_m:10000,moving_s:1800,avg_hr:131,speed_available:false,shares:{pace:true}};
assert.equal(ctx.rate(ride).label,'Time');assert(!ctx.headline(ride).includes('Speed'));assert(ctx.headline(ride).includes('Avg HR'));assert.equal((ctx.headline(ride).match(/<small>Time<\/small>/g)||[]).length,1);
assert(!ctx.sharedHeadline(ride).includes('Speed'));assert.equal((ctx.sharedHeadline(ride).match(/<small>Time<\/small>/g)||[]).length,1);
assert.equal(ctx.rate({...ride,elapsed_s:1800,speed_available:true}).label,'Speed');assert.equal(ctx.rate({...ride,sport:'run',elapsed_s:1800,speed_available:true}).label,'Pace');
const paused={sport:'run',distance_m:8046.72,moving_s:2400,elapsed_s:3000,speed_available:true,shares:{pace:true}};
assert.equal(ctx.rate(paused).v,ctx.U.pace(3000/8046.72*1000),'5 mi at 50:00 uses elapsed pace, not 40:00 moving pace');
assert(ctx.headline(paused).includes('3000s'));assert(ctx.sharedHeadline(paused).includes('3000s'),'feed and permitted friend summary use elapsed duration');
assert.match(ctx.sportStats({...paused,elapsed_s:3000,moving_s:3000}),/Elapsed time/);assert.match(ctx.sportStats({...paused,elapsed_s:3000,moving_s:3000}),/Moving time/,'equal times both remain visible');
assert.match(ctx.sportStats({...paused,elapsed_s:3000,moving_s:2985}),/Moving time/,'a difference under 30 seconds still shows moving time');
const unknown={...paused,elapsed_s:null,moving_s:2400};assert.deepEqual(JSON.parse(JSON.stringify(ctx.rate(unknown))),{label:'Time',v:'–',u:''});assert(ctx.headline(unknown).includes('–'));assert.match(ctx.sportStats(unknown),/Moving time/);assert.doesNotMatch(ctx.sportStats(unknown),/Elapsed time/);
for(const elapsed of [0,-1,Infinity,-Infinity,NaN]){
 const activity={...paused,elapsed_s:elapsed},rate=ctx.rate(activity);
 assert.deepEqual(JSON.parse(JSON.stringify(rate)),{label:'Time',v:'–',u:''},`elapsed ${String(elapsed)} remains unavailable`);
 assert(Object.is(activity.elapsed_s,elapsed));assert.equal(activity.moving_s,2400);assert.equal(activity.distance_m,8046.72);
 assert.doesNotMatch(`${rate.label} ${rate.v} ${rate.u}`,/NaN|Infinity/);
}
const missingElapsed={sport:'run',distance_m:8046.72,moving_s:2400},missingElapsedRate=ctx.rate(missingElapsed);
assert.deepEqual(JSON.parse(JSON.stringify(missingElapsedRate)),{label:'Time',v:'–',u:''},'missing elapsed time stays unavailable');
assert.equal(missingElapsed.moving_s,2400);assert.equal(missingElapsed.distance_m,8046.72);
for(const item of [
 {name:'zero',value:0},{name:'negative',value:-1},{name:'NaN',value:NaN},
 {name:'positive infinity',value:Infinity},{name:'missing',missing:true}
]){
 const activity={...paused};if(item.missing)delete activity.distance_m;else activity.distance_m=item.value;
 const originalDistance=activity.distance_m,rate=ctx.rate(activity);
 assert.deepEqual(JSON.parse(JSON.stringify(rate)),{label:'Time',v:'3000s',u:''},`${item.name} distance keeps elapsed duration without a fabricated rate`);
 assert(!/NaN|Infinity/.test(`${rate.label} ${rate.v} ${rate.u}`));
 assert(Object.is(activity.distance_m,originalDistance));assert.equal(activity.moving_s,2400);assert.equal(activity.elapsed_s,3000);
}
const pausedSwim={sport:'swim',distance_m:500,moving_s:540,elapsed_s:720,speed_available:true},swimRate=ctx.rate(pausedSwim);
assert.deepEqual(JSON.parse(JSON.stringify(swimRate)),{label:'Pace',v:'2:24',u:'/100m'},'paused swim pace uses elapsed time per 100 m');
assert.equal(pausedSwim.distance_m,500);assert.equal(pausedSwim.elapsed_s,720);assert.equal(pausedSwim.moving_s,540);
assert.doesNotMatch(ctx.sharedHeadline({...paused,shares:{pace:false}}),/<small>Pace<\/small>/,'friend pace remains private');
assert.equal(ctx.routeActivityRate({elapsed_s:3000,distance_m:8046.72},'run'),ctx.U.pace(3000/8046.72*1000)+ctx.U.pu(),'matched-route activity rate receives route sport and formats run pace');
const rideCompare={distance_m:10000,elapsed_s:1000,sport:'ride'},similar=effort=>ctx.similarHtml({...rideCompare,similar:[{id:2,name:'Ride',start_time:'2026-01-01',distance_m:10000,elapsed_s:effort}]});
assert.match(similar(1001),/same pace/,'ride comparison uses an appropriately small speed threshold');assert.doesNotMatch(similar(1010),/same pace/,'material ride speed differences are not rounded to same pace');
const elapsedTrendRows=[{pace_d:10000,pace_t:3600,pd:20000,pt:2000,hr_t:2000,hr_w:300000}];
assert.equal(ctx.elapsedActivityRate(elapsedTrendRows,'ride').label,'Average speed');assert.equal(ctx.elapsedActivityRate(elapsedTrendRows,'ride').value,10000/3600,'Ride insight shows elapsed based speed even when moving totals imply another speed');
assert.equal(ctx.elapsedActivityRate(elapsedTrendRows,'run').label,'Average pace');assert.equal(ctx.elapsedActivityRate(elapsedTrendRows,'run').value,360,'pTrends shows elapsed based pace');
assert.match(progress,/elapsedActivityRate\(rows,sport\)/,'pTrends uses elapsed pace totals');assert.match(pages,/elapsedActivityRate\(recent,sport\)/,'Ride insight uses elapsed pace totals');
assert.match(progress,/Pace = total elapsed time ÷ total distance/);assert.match(progress,/Speed = total distance ÷ total elapsed time/);assert.match(progress,/weighted by moving time/);
console.log('Activity summary: elapsed-first paused run, equal/close durations, unknown elapsed and friend pace privacy PASS');
