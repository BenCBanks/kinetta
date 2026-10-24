// Drive the production monthly chart: pointer and keyboard controls must describe the same selection.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),source=fs.readFileSync('app/static/app.js','utf8');
const handlers={},ro={innerHTML:''},attrs=()=>({values:{},setAttribute(k,v){this.values[k]=v}}),xh=attrs(),dot=attrs(),slider={...attrs(),_value:2,get value(){return String(this._value)},set value(v){this._value=+v}};
const graph={getBoundingClientRect:()=>({left:0,width:320}),addEventListener:(event,fn)=>handlers[event]=fn},box={clientWidth:320,insertAdjacentHTML(){}};
const nodes={'svg':graph,'.xh':xh,'.xdot':dot,'.readout':ro,'input':slider,'input[type=range]':slider};
const c={Date,Math,esc:String,$:selector=>nodes[selector]};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function trendLine('),source.indexOf('// running total per day')),c);
const points=[42,46,44].map((y,i)=>({d:new Date(2026,5+i,1),label:['June 2026','July 2026','August 2026'][i],y}));
c.trendLine(box,points,{fmt:v=>v.toFixed(1)});assert.equal(slider.value,'2');
handlers.pointermove({clientX:34});assert.equal(slider.value,'0','hover updates the selected month, not just the text');assert.equal(slider.values['aria-valuetext'],'June 2026');assert(ro.innerHTML.includes('42.0'));
slider.value=1;slider.oninput();assert(ro.innerHTML.includes('July 2026'));assert(ro.innerHTML.includes('46.0'));assert.equal(slider.values['aria-valuetext'],'July 2026');
handlers.pointerdown({clientX:314});assert.equal(slider.value,'2');assert(ro.innerHTML.includes('August 2026'));
console.log('Fitness monthly chart: hover/touch and slider share date, exact values and accessible month label PASS');
