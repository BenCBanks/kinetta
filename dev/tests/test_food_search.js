// Actual food-search renderer, controlled timers and delayed requests; no providers.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const input={value:'',isConnected:true,blur(){}},out={innerHTML:'',insertAdjacentHTML(_,s){this.innerHTML+=s;}},form={},body={};
let timer,release,calls=0;
const ctx={console,$:s=>s==='input'?input:s==='#ts-r'?out:form,$$:()=>[],softFocus(){},setTimeout:fn=>(timer=fn),clearTimeout(){},esc:s=>s,recentToFood:x=>x,foodRow:f=>f.name,api:()=>{calls++;return new Promise(r=>release=r)}};
vm.createContext(ctx);const source=fs.readFileSync('app/static/food.js','utf8');vm.runInContext(source.slice(source.indexOf('function tSearch('),source.indexOf('function recentToFood')),ctx);
(async()=>{ctx.tSearch(body,()=>({}),()=>{});input.value='old';input.oninput();const old=timer();input.value='new';input.oninput();release({mine:[{name:'OLD RESULT'}],recent:[]});await old;assert.ok(!out.innerHTML.includes('OLD RESULT'),'old response cannot appear during the new query debounce');assert.equal(calls,1,'old local response cannot start a stale external search');input.value='';input.oninput();assert.equal(out.innerHTML,'','clearing search removes old results');input.isConnected=false;await timer();assert.equal(calls,1,'closed search does not run queued requests');console.log('Food search: query changes invalidate immediately; clear/closed sheets discard stale results and queued reads');})().catch(e=>{console.error(e);process.exitCode=1});
