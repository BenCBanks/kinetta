// Run the actual Save handler: pending work must not disappear behind recipe review.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/cook.js','utf8');
const code=source.slice(source.indexOf("  $('#dk-done', el).onclick"),source.indexOf('  // the name, edited in place'));
(async()=>{
 let pending=false,finished=0,saved=0;const log=[],button={disabled:false},input={value:'',focus(){}},match={hasChildNodes:()=>pending,scrollIntoView(){}};
 const c={el:{},d:{id:7,named:true},has:true,CHATS:new Map([[7,log]]),measureSave:Promise.resolve(true),active:()=>true,saveName:async()=>{saved++;return true;},finishDish:()=>finished++,toast(){},$:(s)=>({'#dk-done':button,'#dk-t':input,'#dk-match':match}[s])};
 vm.createContext(c);vm.runInContext(code,c);
 log.push({wait:true});await button.onclick();assert.equal(finished,0);assert.equal(saved,0);assert(!button.disabled);
 log.length=0;pending=true;await button.onclick();assert.equal(finished,0);assert.equal(saved,0);assert(!button.disabled);
 pending=false;input.value='Unsaved ingredient';await button.onclick();assert.equal(finished,0);assert(!button.disabled);
 input.value='';await button.onclick();assert.equal(finished,1);assert.equal(saved,1);
 let release;c.measureSave=new Promise(ok=>release=ok);button.disabled=false;const saving=button.onclick();pending=true;release(true);await saving;assert.equal(finished,1,'An ingredient started during a measurement/title save must also block review');
 console.log('Recipe Save: waits for requests, requires add/cancel for unresolved matches, retains unsent text, then opens review PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
