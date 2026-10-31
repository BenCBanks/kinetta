// Real shared chart output: overview presentation is opt-in; detail defaults keep burn/weight interaction.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/app.js','utf8'),handlers={},readout={innerHTML:''},highlight={setAttribute(){}};
const svg={addEventListener:(name,fn)=>{handlers[name]=fn;},getBoundingClientRect:()=>({left:0,width:340})};
const context={Math,esc:String,$:()=>readout,$$:selector=>selector==='svg'?[svg]:[highlight]};vm.createContext(context);
vm.runInContext(source.match(/^const niceStep = .*$/m)[0]+'\n'+source.slice(source.indexOf('function energyChart('),source.indexOf('// fitness / fatigue / form lines')),context);
const columns=[{day:'2026-10-26',label:'Monday',tick:'Mon',eaten:1800,goal:1900,burned:9000,weight:70,trend:70},{day:'2026-10-27',label:'Tuesday',tick:'Tue',eaten:2200,goal:2100,burned:8500,partial:true,counted:false,weight:69.9,trend:69.95}],original=JSON.stringify(columns),box={clientWidth:340,innerHTML:''};
context.energyChart(box,columns,{burned:false,interactive:false});
assert.match(box.innerHTML,/Calories eaten versus goal/);assert.doesNotMatch(box.innerHTML,/Burned|class="ln k-run"|class="readout|>10k</);assert.match(box.innerHTML,/partial/);assert.deepEqual(Object.keys(handlers),[],'overview anchor owns the tap');
const goal=box.innerHTML.match(/class="ln goal-ln" d="([^"]+)"/)[1],ys=[...goal.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m=>m[1]);assert.equal(ys.length,2);assert.notEqual(ys[0],ys[1],'each day keeps its actual goal');
context.energyChart(box,columns,{weight:{axis:v=>v.toFixed(1),fmt:v=>v.toFixed(1),unit:'kg'}});
assert.match(box.innerHTML,/Calories eaten and burned/);assert.match(box.innerHTML,/class="ln k-run"/);assert.match(box.innerHTML,/>10k</);assert.match(box.innerHTML,/Weight trend/);assert.match(box.innerHTML,/Weigh-ins/);assert.deepEqual(Object.keys(handlers).sort(),['pointerdown','pointermove']);
handlers.pointerdown({currentTarget:svg,clientX:100});assert.match(readout.innerHTML,/Burned/);assert.match(readout.innerHTML,/Deficit/);assert.match(readout.innerHTML,/Weight/);
handlers.pointerdown({currentTarget:svg,clientX:270});assert.doesNotMatch(readout.innerHTML,/Deficit|Surplus/,'partly logged days do not establish balance');assert.match(readout.innerHTML,/so far/);
assert.equal(JSON.stringify(columns),original,'presentation does not mutate facts');context.energyChart(box,[]);assert.match(box.innerHTML,/Log some food/);
console.log('Shared energy chart: opt-in eaten/actual-goal overview, unchanged burn/weight defaults, partial-day and non-mutation contracts PASS');
