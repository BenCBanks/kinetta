'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const s=fs.readFileSync('app/static/food.js','utf8');
(async()=>{
 let owner='A',ops=[],calls=[],fail=false,reply={queued:true},day={entries:[],totals:{kcal:0,sodium_mg:0},unknown_nutrients:{}};
 const c={Set,readOwner:()=>owner,Q:{all:()=>ops,save:x=>{ops=x},owns:o=>o.owner===owner},netbar(){},patchDay:(_,fn)=>fn(day),FOOD_NUTRIENTS:['kcal','protein_g','sodium_mg'],sendOrQueue:async(path,method,body)=>{calls.push({path,method,body});if(fail)throw Error('disk full');ops.push({owner,path,body});return reply},FoodThread:{accept:async()=>{}},refresh(){},render(){},toast:(text,undo)=>{c.last={text,undo}},location:{pathname:'/food'},console};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function foodUploadUndo'),s.indexOf('async function copyDay')),c);
 const a={client_id:'upload-a',day:'2026-10-17',kcal:500,sodium_mg:300},b={client_id:'upload-b',day:a.day,kcal:100};
 ops=[{owner:'A',path:'/api/food/entries?thread=true',body:[a,b]},{owner:'B',path:'/api/food/entries',body:[a]}];day.entries=[a,b];day.totals={kcal:600,sodium_mg:300};
 const undo=c.foodUploadUndo([a],'A');await undo();assert.equal(calls.length,1);assert.equal(calls[0].body.confirm,true);assert.deepEqual([...calls[0].body.client_ids],['upload-a']);assert.equal(ops[0].body.length,1);assert.equal(ops[0].body[0].client_id,'upload-b');assert.equal(ops[1].body.length,1);assert.equal(ops[2].path,'/api/food/entries/undo');assert.equal(day.entries.length,1);assert.equal(day.totals.kcal,100);assert.equal(day.totals.sodium_mg,0);await undo();assert.equal(calls.length,1);
 const blocked=c.foodUploadUndo([b],'A');owner='B';await blocked();assert.equal(calls.length,1);owner='A';
 const retry=c.foodUploadUndo([b],'A');fail=true;const before=JSON.stringify(ops);await retry();assert.equal(JSON.stringify(ops),before,'failed durable cancel must preserve original upload');assert.equal(typeof c.last.undo,'function');fail=false;await retry();assert(!ops.some(o=>o.owner==='A'&&o.path.startsWith('/api/food/entries?')));
 // A response after an account change cannot erase a different owner's queued items.
 const stale=c.foodUploadUndo([a],'A');c.sendOrQueue=async()=>{owner='B';return {}};const old=JSON.stringify(ops);await stale();assert.equal(JSON.stringify(ops),old);
 console.log('Food upload Undo client: durable cancellation before removal, partial batch/other-owner preservation,8nutrient optimistic reversal, duplicate tap, storage failure retry and stale account PASS');
})().catch(e=>{console.error(e);process.exit(1)});
