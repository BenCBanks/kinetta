// Drive the actual memory controls, including an account switch while a sheet is open.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/kit.js','utf8'),code=source.slice(source.indexOf('  function memorySettings(){'),source.indexOf('  async function mount(el){'));
const tick=()=>new Promise(setImmediate);
(async()=>{
 let owner='one',calls=[],fail=false;const box={innerHTML:''},body={isConnected:true},toggle={checked:true,disabled:false},one={dataset:{kitForget:'7'}},all={},error={textContent:''};
 const c={readOwner:()=>owner,sheet:(t,h,ready)=>ready(body),esc:String,confirm:()=>true,$:s=>({'#kit-memory':box,'#kit-memory-on':toggle,'#kit-forget-all':all,'#kit-memory-error':error})[s],$$:()=>[one],api:async(path,opts)=>{calls.push({path,opts});if(fail&&opts)throw Error('Fictional failed save');return {enabled:true,memories:[{id:7,text:'I prefer evening walks.'}]};},json:(method,body)=>({method,body})};vm.createContext(c);vm.runInContext(code,c);
 c.memorySettings();await tick();assert(box.innerHTML.includes('I prefer evening walks.'));owner='two';
 await one.onclick();await all.onclick();await toggle.onchange({target:toggle});assert.equal(calls.length,1,'old sheet cannot delete memories or change another account settings');
 owner='one';fail=true;toggle.checked=false;await toggle.onchange({target:toggle});assert.equal(toggle.checked,true,'failed memory-off does not claim it succeeded');assert.equal(toggle.disabled,false);assert(error.textContent.includes('failed save'));
 let finish;box.innerHTML='Loading';owner='one';c.api=()=>new Promise(ok=>finish=ok);c.memorySettings();owner='two';finish({enabled:true,memories:[{id:8,text:'Previous account detail'}]});await tick();assert.equal(box.innerHTML,'Loading','a late memory read cannot paint another account');
 console.log('Kit memory UI: actual saved/off controls, failed-save rollback, stale-account reads and writes PASS');
})().catch(e=>{console.error(e);process.exit(1)});
