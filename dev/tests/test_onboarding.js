// Exercise the real setup-card function with native/browser/history/target states.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync('app/static/pages.js','utf8');
const fn=text.slice(text.indexOf('function getStarted('),text.indexOf('\nroute(',text.indexOf('function getStarted(')));
const c={App:{me:{kcal_target:2000}},Native:{on:true},navigator:{userAgent:'iPhone'},window:{navigator:{}},matchMedia:()=>({matches:false}),svg:()=>'',esc:String,profileHref:()=>'/people/demo',pendingEmail:()=>false,foodUser:()=>!!c.App.me.kcal_target};
vm.createContext(c);vm.runInContext(fn,c);
assert.match(c.getStarted(false,true),/Finish setting up/);assert.match(c.getStarted(false,true),/href="\/track\/health"[^]*Connect Apple Health/,'native app offers Health while it is not connected');
assert.match(c.getStarted(true,true),/Connect Apple Health<span class="vh">, done/,'connected Health is ticked off, never asked again');
assert.match(c.getStarted(true,true),/2 of 4 done/,'progress counts done and optional steps');
c.App.me={kcal_target:2000,setup_skipped:['health']};assert.doesNotMatch(c.getStarted(false,true),/Apple Health/,'a skipped step leaves the list');assert.match(c.getStarted(false,true),/1 of 3 done/,'and the count');
assert.match(c.getStarted(false,true),/data-setup-skip="photo"[^>]*aria-label="Skip Add a profile photo"/,'each open step has its own Skip');
c.App.me={kcal_target:2000,photo:'1',friend_count:2,setup_skipped:['health']};assert.equal(c.getStarted(false,true),'','done plus skipped steps finish the list');
c.App.me={kcal_target:2000,photo:'1',friend_count:2};assert.equal(c.getStarted(true,true),'','No checklist once every step is complete');
c.App.me={kcal_target:null};c.Native.on=false;c.navigator.userAgent='Desktop';
assert.doesNotMatch(c.getStarted(false,true),/Apple Health|nutrition goal/,'browsers get no Health step; non-food users no goal step');
c.App.me.setup_hidden=true;assert.equal(c.getStarted(false,true),'','Hidden checklist stays hidden');c.App.me.setup_hidden=false;
c.navigator.userAgent='iPhone';
assert.match(c.getStarted(false,false),/Record an activity/);assert.doesNotMatch(c.getStarted(false,false),/Log something you ate|nutrition goal/);
c.Native.on=true;assert.match(c.getStarted(false,false),/Bring in workouts/);assert.match(c.getStarted(false,false),/Apple Health or Garmin/);assert.equal((c.getStarted(false,false).match(/href="\/track\/connections"/g)||[]).length,1,'Fresh setup has one connection step');assert(!c.getStarted(false,false).includes('href="/track/health"'),'Fresh setup does not duplicate Apple Health');
c.App.me.setup_hidden=true;assert.equal(c.getStarted(false,false),'','Optional setup dismissal survives missing Health and fresh history');c.App.me.setup_hidden=false;assert.match(c.getStarted(false,false),/Hide tips/);
console.log('onboarding setup: checklist ticks off Health and finished steps, hides when complete or dismissed; activity-first new-account cases passed');

// The real route renders without writes and its Not now path only navigates. Draft choices survive a visit away.
const calls=[], nodes=new Map();let setup;
const element={isConnected:true,innerHTML:''};
const field=value=>({value});
const f={elements:{weight:field(''),height:field(''),birth_year:field(''),sex:field(''),goal:field('maintain'),pace_percent:field('0.5'),activity_factor:field('1.2')},reportValidity:()=>true};
nodes.set('#gs-form',f);nodes.set('#gs-pace',{});nodes.set('#gs-skip',{});
const context={ACTIVITY_LEVELS:[[1.2,'Mostly sitting'],[1.3,'Some walking'],[1.45,'On my feet']],Set,App:{me:{id:1}},Native:{haptic(){}},readOwner:()=> 'fictional-account',route:(re,tab,fn)=>{setup=fn},
  $:(selector)=>nodes.get(selector)||null,imp:()=>false,esc:String,backBtn:()=>'',wireBack(){},svg:()=>'',
  go:path=>calls.push(['go',path]),api:(...args)=>{calls.push(['api',...args]);throw Error('Unexpected write')},Map,Date,Number,console};
vm.createContext(context);vm.runInContext(fs.readFileSync('app/static/onboarding.js','utf8'),context);
(async()=>{
 await setup(element);assert.match(element.innerHTML,/Nothing has been saved|See my estimate/);assert.equal(calls.length,0,'Opening setup never writes');
 f.elements.goal.value='lose_weight';f.oninput();nodes.get('#gs-skip').onclick();assert.deepEqual(calls,[['go','/food']],'Skip does not request/save targets or Health permissions');
 await setup(element);assert.match(element.innerHTML,/value="lose_weight" checked/,'Draft goal resumes within the signed-in session');
 context.App.me.weight_kg=80;context.App.me.activity_factor=1.2999999523;
 await setup(element);assert.match(element.innerHTML,/value="1.3" selected/);
 assert.equal(vm.runInContext('goalDraft().weight_kg',context),80);
 assert.equal(vm.runInContext('Object.hasOwn(goalPayload(goalDraft()),"weight_kg")',context),false,'Untouched body fields never overwrite later server edits');
 console.log('onboarding skip: real route opens and skips without any API call; draft resumes');
})().catch(e=>{console.error(e);process.exitCode=1});
