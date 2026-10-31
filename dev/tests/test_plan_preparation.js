// The production plan handoff selects a run; it never begins a recording or changes plan completion.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/track.js','utf8'),writes=[],c={JSON,Number,Error,session:null,planIntent:null,revision:'one',scope:'kinetta.track:fictional-one',sync(){},accountKey:()=>c.scope,readOwner:()=>c.revision,OUTDOOR:[['run','Run'],['ride','Ride']],HAND_KINDS:[['Cardio',[['run','Run'],['run','Treadmill run','Treadmill'],['ride','Ride']]]],TrackNative:{supported:true},store:{set:(k,v)=>writes.push([k,v])},Intervals:{removeSelection:()=>true,usePlan:async()=>true}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  const recordingChoices='),source.indexOf('  // One-tap shortcuts'))+'\nglobalThis.prepare=preparePlan;',c);
const w={day:'2026-11-03',type:'easy',status:'upcoming',title:'Fictional easy run'};
(async()=>{
 let loaded=await c.prepare(w,4);assert.equal(loaded.index,0);assert.equal(writes.at(-1)[1],0);assert.equal(c.planIntent.workout.title,w.title);w.title='Changed';assert.equal(c.planIntent.workout.title,'Fictional easy run','saved intent is independent of the old page object');
 c.TrackNative.supported=false;loaded=await c.prepare(w,4);assert.equal(loaded.index,1,'browser Run follows Lift, rather than using native index zero');
 c.session={id:'existing'};await assert.rejects(c.prepare(w,4),/current recording/);c.session=null;
 await assert.rejects(c.prepare(w,0),/choose the workout/);
 const before=writes.length;assert.equal(await c.prepare(w,4,{active:()=>false}),null);assert.equal(writes.length,before);
 let release;const gate=new Promise(ok=>release=ok);c.Intervals.usePlan=async()=>{await gate;return true;};const late=c.prepare({...w,track_intervals:{run_min:1,walk_min:1.5,repeat:8}},4);c.revision='two';release();assert.equal(await late,null);assert.equal(writes.length,before,'late account reply cannot set a choice');
 c.revision='one';c.Intervals.removeSelection=()=>false;await assert.rejects(c.prepare(w,4),/could not keep/);assert.equal(writes.length,before);
 for(const bad of [{...w,type:'rest'},{...w,status:'done'},{...w,day:'bad'}])await assert.rejects(c.prepare(bad,4),/choose the workout/);
 console.log('Plan handoff: native/browser sport index, cloned intent, active recording, cancelled navigation, late account reply, storage failure and unavailable workout guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
