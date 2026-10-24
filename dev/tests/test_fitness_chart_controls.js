// Exercise the real chart renderers and gesture controller with fictional values.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),source=fs.readFileSync('app/static/app.js','utf8');
const c={Date,Math,Number,WeakMap,Map,esc:String,fdate:(d)=>d.slice(0,10),$: (selector,box)=>box.nodes[selector],$$:(selector,box)=>box.badges};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('const chartViews ='),source.indexOf('// running total per day'))+'\nglobalThis.state=box=>chartViews.get(box).state();',c);
vm.runInContext(source.slice(source.indexOf('function loadChart('),source.indexOf('// an AI request that failed')),c);
function fixture(width=320){
 const handlers={},captured=new Set(),attrs=()=>({values:{},setAttribute(k,v){this.values[k]=String(v)},getAttribute(k){return this.values[k]||'Chart'}});
 const graph={...attrs(),innerHTML:'',getBoundingClientRect:()=>({left:0,width}),addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),focus(){this.focused=true}};
 const ro={innerHTML:'',get textContent(){return this.innerHTML.replace(/<[^>]*>/g,' ')},get children(){return [{textContent:this.textContent}]}},reset={hidden:true};
 const box={clientWidth:width,nodes:{svg:graph,'.xh':attrs(),'.xdot':attrs(),'.readout':ro,'.chart-reset':reset},badges:Array.from({length:3},()=>({classList:{add(){}}}))};
 const emit=(name,data={})=>handlers[name]({pointerId:1,pointerType:'touch',button:0,clientX:150,clientY:100,deltaX:0,deltaY:0,deltaMode:0,preventDefault(){this.prevented=true},...data});
 return {box,graph,ro,reset,handlers,captured,emit,state:()=>c.state(box)};
}
const months=[42,46,null,44,48,45,47].map((y,i)=>({d:new Date(2026,i,1),label:['January','February','March','April','May','June','July'][i]+' 2026',y}));
let t=fixture();c.trendLine(t.box,months,{fmt:v=>v.toFixed(1),interactive:true});assert(!t.box.innerHTML.includes('type="range"'));assert.equal(t.state().index,6);
t.emit('pointermove',{pointerType:'mouse',clientX:34});assert.equal(t.state().index,0);assert(t.ro.innerHTML.includes('January 2026'));assert(t.ro.innerHTML.includes('42.0'));assert(t.graph.values['aria-label'].includes('42.0'));
t.emit('pointerdown',{clientX:120});t.emit('pointerdown',{pointerId:2,clientX:200});t.emit('pointermove',{pointerId:2,clientX:280});assert(t.state().to-t.state().from<6,'pinch changes date range');assert.equal(t.reset.hidden,false);t.emit('pointerup',{pointerId:2});t.emit('pointerup');
const unmodified=t.state();t.emit('keydown',{key:'Home',altKey:true});assert.deepEqual(t.state(),unmodified,'browser modifier shortcuts stay available');t.emit('keydown',{key:'Home'});assert.equal(t.state().index,0);t.emit('keydown',{key:'ArrowRight'});assert.equal(t.state().index,1);assert(t.ro.innerHTML.includes('February'));assert(t.ro.innerHTML.includes('46.0'));t.emit('keydown',{key:'ArrowRight'});assert(t.ro.innerHTML.includes('March'));assert(t.ro.innerHTML.includes('–'),'missing month is not invented');
t.reset.onclick();assert.equal(t.state().from,0);assert.equal(t.state().to,6);assert(t.graph.focused);assert(t.reset.hidden);
const days=Array.from({length:150},(_,i)=>({d:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),fitness:i+10,fatigue:i+20,form:-10}));
t=fixture();c.loadChart(t.box,days,{interactive:true});assert(!t.box.innerHTML.includes('type="range"'));t.emit('wheel',{deltaY:-120});const span=t.state().to-t.state().from;assert(span<149);
t.emit('pointerdown',{clientX:180});t.emit('pointermove',{clientX:290});assert(t.state().from>=0);t.emit('pointermove',{clientX:-4000});assert.equal(t.state().to,149,'pan clamps at newest date');t.emit('pointercancel');assert.equal(t.captured.size,0);
t.emit('wheel',{deltaX:-10000});assert.equal(t.state().from,0,'sideways scroll clamps at oldest date');
t.emit('wheel',{deltaY:-200});t.emit('wheel',{deltaY:-200});t.emit('wheel',{deltaY:-200});assert(t.state().to-t.state().from>=7-1e-8,'daily pinch has a useful minimum range');
t.emit('keydown',{key:'End'});assert.equal(t.state().index,149);assert(t.ro.innerHTML.includes('159.0'));assert(t.ro.innerHTML.includes('169.0'));assert(t.ro.innerHTML.includes('-10.0'));
const saved=t.state(),resized=fixture(700);c.loadChart(resized.box,days,{interactive:true,view:saved});assert.deepEqual(resized.state(),saved,'resize preserves zoom and selected day');assert(resized.graph.innerHTML.includes('clipPath'));assert(!resized.graph.innerHTML.includes('NaN'));
t.emit('keydown',{key:'0'});assert.equal(t.state().from,0);assert.equal(t.state().to,149);
t=fixture();c.loadChart(t.box,days);assert(!t.handlers.wheel,'inline graph leaves page scroll alone');t.emit('pointerdown',{clientX:30});assert.equal(t.state().index,0);assert.equal(t.captured.size,0);
t=fixture();c.loadChart(t.box,[]);assert(t.box.innerHTML.includes('Needs activities'));c.trendLine(t.box,months.map(p=>({...p,y:null})),{fmt:String});assert(t.box.innerHTML.includes('Not enough data'));
console.log('Fitness: no sliders; exact hover/touch/missing values; pinch/drag/wheel bounds; keyboard/reset; zoom/date restoration; inline scrolling and empty states PASS');
