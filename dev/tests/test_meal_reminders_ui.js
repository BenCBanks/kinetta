'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/social.js','utf8');let account='a',requests=[],toggle={checked:false,disabled:false},error={textContent:''},retry={};
const context={readOwner:()=>account,api:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),MEAL_NAMES:{breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner'},esc:String,skel:()=>'',Native:{haptic(){}},json:(method,body)=>({method,body}),$:selector=>selector==='[data-meal-reminders]'?toggle:selector==='.err'?error:retry};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function mealReminderCard')),context);
const state={enabled:false,push_ready:true,device_ready:true,tz:'UTC',times:[{meal:'lunch',ready:true,time:'12:15'}]};
(async()=>{
 const box={isConnected:true,innerHTML:''};let p=context.mealReminderCard(box);assert.equal(requests.length,1);requests.shift().resolve(state);await p;assert(box.innerHTML.includes('Off by default'));assert(box.innerHTML.includes('Around'));assert(!requests.length,'opening settings never saves');
 toggle.checked=true;p=toggle.onchange();const save=requests.shift();assert.equal(save.options.body.enabled,true);assert.equal(save.options.body.confirmed,true);save.resolve({...state,enabled:true});await new Promise(setImmediate);requests.shift().resolve({...state,enabled:true});await p;
 toggle.checked=false;p=toggle.onchange();const off=requests.shift();assert.equal(off.options.body.enabled,false);off.reject(Error('Fictional offline'));await p;assert.equal(toggle.checked,true);assert.match(error.textContent,/Fictional offline/);
 const old=context.mealReminderCard(box),request=requests.shift();account='b';request.resolve({...state,enabled:false});await old;const oldToggle=toggle.onchange;toggle.checked=false;await oldToggle();assert.equal(requests.length,0,'stale account checkbox cannot write');
 account='a';const detached={isConnected:true,innerHTML:''};p=context.mealReminderCard(detached);const pending=requests.shift();detached.isConnected=false;pending.resolve(state);await p;assert.equal(detached.innerHTML,'');
 p=context.mealReminderCard(box);requests.shift().resolve({...state,push_ready:false});await p;assert(box.innerHTML.includes(' disabled'));assert(box.innerHTML.includes('setup is not complete'));
 p=context.mealReminderCard(box);requests.shift().reject(Error('Fictional status failure'));await p;assert(box.innerHTML.includes('Try again'));p=retry.onclick();requests.shift().resolve(state);await p;assert(box.innerHTML.includes('Meal-time reminders'));
 const food=fs.readFileSync('app/static/food.js','utf8'),clock={App:{},tz:()=> 'America/Los_Angeles',Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-10-17T15:00:00Z']));}}};vm.createContext(clock);vm.runInContext(food.slice(food.indexOf('function guessMeal'),food.indexOf('const homeCalories')),clock);assert.equal(clock.guessMeal(),'breakfast');clock.App.mealHours={8:'dinner'};assert.equal(clock.guessMeal(),'dinner');
 console.log('Reminder UI: no implicit save, explicit opt-in/off, failure retains setting, stale account/detached guards, unavailable APNs/Retry, profile-local usual meal time PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
