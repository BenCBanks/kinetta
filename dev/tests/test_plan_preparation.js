// The production plan handoff selects a run; it never begins a recording or changes plan completion.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/track.js','utf8'),writes=[],c={JSON,Number,Error,session:null,planIntent:null,revision:'one',scope:'kinetta.track:fictional-one',sync(){},accountKey:()=>c.scope,readOwner:()=>c.revision,OUTDOOR:[['run','Run'],['ride','Ride']],HAND_KINDS:[['Cardio',[['run','Run'],['run','Treadmill run','Treadmill'],['ride','Ride']]]],TrackNative:{supported:true},pullNative:async()=>{},store:{set:(k,v)=>writes.push([k,v])},Intervals:{removeSelection:()=>true,usePlan:async()=>true}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  const recordingChoices='),source.indexOf('  // One-tap shortcuts'))+'\nglobalThis.prepare=preparePlan;',c);
const w={day:'2026-11-03',type:'easy',status:'upcoming',title:'Fictional easy run'};
(async()=>{
 let loaded=await c.prepare(w,4);assert.equal(loaded.index,0);assert.equal(writes.at(-1)[1],0);assert.equal(c.planIntent.workout.title,w.title);w.title='Changed';assert.equal(c.planIntent.workout.title,'Fictional easy run','saved intent is independent of the old page object');
 const nativeWrites=writes.length;c.pullNative=async()=>{c.session={id:'native-restored'};};await assert.rejects(c.prepare(w,4),/current recording/);assert.equal(writes.length,nativeWrites,'restored native recording keeps its selection');c.session=null;c.pullNative=async()=>{};
 c.TrackNative.supported=false;loaded=await c.prepare(w,4);assert.equal(loaded.index,1,'browser Run follows Lift, rather than using native index zero');
 c.session={id:'existing'};await assert.rejects(c.prepare(w,4),/current recording/);c.session=null;
 await assert.rejects(c.prepare(w,0),/choose the workout/);
 const before=writes.length;assert.equal(await c.prepare(w,4,{active:()=>false}),null);assert.equal(writes.length,before);
 let release;const gate=new Promise(ok=>release=ok);c.Intervals.usePlan=async()=>{await gate;return true;};const late=c.prepare({...w,track_intervals:{run_min:1,walk_min:1.5,repeat:8}},4);c.revision='two';release();assert.equal(await late,null);assert.equal(writes.length,before,'late account reply cannot set a choice');
 c.revision='one';c.Intervals.removeSelection=()=>false;await assert.rejects(c.prepare(w,4),/could not keep/);assert.equal(writes.length,before);
 for(const bad of [{...w,type:'rest'},{...w,status:'done'},{...w,day:'bad'}])await assert.rejects(c.prepare(bad,4),/choose the workout/);
 console.log('Plan handoff: native/browser sport index, cloned intent, active recording, cancelled navigation, late account reply, storage failure and unavailable workout guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Run the real overview renderer: frozen prescription paces must survive loss of current fitness.
{
 const plan=fs.readFileSync('app/static/plan.js','utf8'),nodes=new Map(),box={classList:{add(){}},innerHTML:''};
 const ctx={Object,Map,Set,Number,planWeekOpen:new Map(),readOwner:()=> 'fictional-owner',esc:x=>String(x??''),pday:x=>x,dur:x=>String(x),stat:()=>'',planWeekRows:()=>'',wireWorkouts(){},$$:()=>[],$:selector=>selector==='[data-plan-start]'?null:nodes.get(selector)||nodes.set(selector,{}).get(selector)};
 vm.createContext(ctx);vm.runInContext(plan.slice(plan.indexOf('function planOverview('),plan.indexOf('function planActions(')),ctx);
 const d={plan:{id:1,race:'5k',race_name:'5K',level:'beginner',level_name:'Beginner',unit:'mi',weeks:8,runs:3,start_day:'2027-03-08',race_day:'2027-05-02'},weeks:[{n:1,start:'2027-03-08',workouts:[]}],today:'2027-03-01',days_to_race:62,vdot:null,prescription_version:2,paces:{easy:['9:21/mi','10:18/mi'],'5k':'8:10/mi'}};
 ctx.planOverview(box,d);assert.match(box.innerHTML,/9:21–10:18\/mi/);assert.match(box.innerHTML,/8:10\/mi/);assert.match(box.innerHTML,/when this plan was created/);
 ctx.planOverview(box,{...d,paces:{}});assert(!box.innerHTML.includes('class="pace-row"'),'a saved effort-only plan never fabricates numeric paces');
 ctx.planOverview(box,{...d,prescription_version:1});assert(!box.innerHTML.includes('class="pace-row"'),'legacy plans retain their current-fitness rule');
 console.log('Plan overview: saved paces render without current VDOT; effort-only and legacy fallback PASS');
}
