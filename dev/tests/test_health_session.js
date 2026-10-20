// Actual session/deletion handlers with fictional local failures; no device or network.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('app/static/app.js','utf8'),pages=fs.readFileSync('app/static/pages.js','utf8');
(async()=>{
 for(const failure of ['throw','never']){
  const c={AbortController,setTimeout,clearTimeout,App:{me:{id:1}},Native:{base:'',on:true,headers:()=>({}),pauseHealth:()=>{if(failure==='throw')throw Error('stop failed');return new Promise(()=>{});}},FormData:class{},fetch:async()=>({ok:false,status:401,json:async()=>({detail:'Expired'})}),showLogin:()=>c.loginShown=true,readOwner:()=>String(c.App.me?.id)};
  vm.createContext(c);vm.runInContext(app.slice(app.indexOf('async function api('),app.indexOf('const json =')),c);
  await assert.rejects(c.api('/api/me'),e=>e.status===401);assert.equal(c.App.me,null);assert(c.loginShown,'401 always shows login despite native failure');
 }
 for(const wrong of [true,false]){
  const calls=[],button={disabled:false},form={pw:{value:'fictional password',focus(){}}},c={App:{me:{id:1,login:'fictional'},cache:new Map()},readOwner:()=>String(c.App.me?.id),esc:s=>s,json:(method,body)=>({method,body}),toast(){},showLogin:()=>calls.push('login'),netbar:()=>{calls.push('netbar');throw Error('layout failure');},history:{replaceState:()=>calls.push('history')},Q:{all:()=>{calls.push('queue');return [];}},store:{set:()=>{}},forgetKept:()=>{calls.push('kept');throw Error('storage failed');},FoodThread:{eraseDevice:()=>{calls.push('chat');throw Error('IDB failed');}},RecipeImport:{eraseDevice:()=>{calls.push('recipe');throw Error('draft failed');}},Track:{forgetDraft:()=>calls.push('track')},Native:{on:true,pauseHealth:async()=>calls.push('pause'),resumeHealth:()=>calls.push('resume'),forget:async()=>{calls.push('forget');throw Error('native failed');}},api:async()=>{calls.push('delete');if(wrong)throw Error('Incorrect password');},sheet:(title,html,ready)=>ready({},()=>calls.push('close')),$:selector=>selector==='#del'?form:button};
  vm.createContext(c);vm.runInContext(pages.slice(pages.indexOf('function deleteSheet()'),pages.indexOf('function passwordSheet()')),c);c.deleteSheet();await form.onsubmit({preventDefault(){}});
  if(wrong){assert.deepEqual(calls,['pause','delete','resume']);assert(c.App.me);assert.equal(button.disabled,false);}
  else{for(const step of ['forget','chat','recipe','track','queue','kept','close','netbar','history','login'])assert(calls.includes(step),step+' still runs after independent failure');assert.equal(c.App.me,null);}
 }
 console.log('Health session: throwing/hung stop cannot suppress 401; wrong delete password resumes preserved setup; successful delete runs every cleanup despite failures PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
