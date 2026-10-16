// Exercise the real setup-card function with native/browser/history/target states.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync('app/static/pages.js','utf8');
const fn=text.slice(text.indexOf('function getStarted('),text.indexOf('\nroute(',text.indexOf('function getStarted(')));
const c={App:{me:{kcal_target:2000}},Native:{on:true},navigator:{userAgent:'iPhone'},window:{navigator:{}},matchMedia:()=>({matches:false}),svg:()=>''};
vm.createContext(c);vm.runInContext(fn,c);
assert.match(c.getStarted(false,true),/Connect Apple Health · optional/);
assert.match(c.getStarted(false,true),/Bring in workouts and weight from Apple Health/);
assert.equal(c.getStarted(true,true),'','No empty Finish setup card when every step is complete');
c.Native.on=false;c.navigator.userAgent='Desktop';assert.equal(c.getStarted(false,true),'');
c.App.me.kcal_target=null;assert.match(c.getStarted(false,true),/Set a nutrition goal/);
assert.match(c.getStarted(false,false),/Log something you ate/);
c.Native.on=true;assert.match(c.getStarted(false,false),/Connect Apple Health/);
console.log('onboarding setup card: native optional Health, complete/empty, goal and new-account cases passed');

// The real route renders without writes and its Not now path only navigates. Draft choices survive a visit away.
const calls=[], nodes=new Map();let setup;
const element={isConnected:true,innerHTML:''};
const field=value=>({value});
const f={elements:{weight:field(''),height:field(''),birth_year:field(''),sex:field(''),goal:field('maintain'),pace_percent:field('0.5'),activity_factor:field('1.2')},reportValidity:()=>true};
nodes.set('#gs-form',f);nodes.set('#gs-pace',{});nodes.set('#gs-skip',{});
const context={App:{me:{id:1}},Native:{haptic(){}},readOwner:()=> 'fictional-account',route:(re,tab,fn)=>{setup=fn},
  $:(selector)=>nodes.get(selector)||null,imp:()=>false,esc:String,backBtn:()=>'',wireBack(){},svg:()=>'',
  go:path=>calls.push(['go',path]),api:(...args)=>{calls.push(['api',...args]);throw Error('Unexpected write')},Map,Date,Number,console};
vm.createContext(context);vm.runInContext(fs.readFileSync('app/static/onboarding.js','utf8'),context);
(async()=>{
 await setup(element);assert.match(element.innerHTML,/Nothing has been saved|See my estimate/);assert.equal(calls.length,0,'Opening setup never writes');
 f.elements.goal.value='lose_weight';f.oninput();nodes.get('#gs-skip').onclick();assert.deepEqual(calls,[['go','/food']],'Skip does not request/save targets or Health permissions');
 await setup(element);assert.match(element.innerHTML,/value="lose_weight" checked/,'Draft goal resumes within the signed-in session');
 console.log('onboarding skip: real route opens and skips without any API call; draft resumes');
})().catch(e=>{console.error(e);process.exitCode=1});
