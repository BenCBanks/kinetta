// Real sheet lifecycle: animation must not delay cleanup/focus or break rapid replacement/reduced motion.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/app.js','utf8');
function setup(reduced=false){
 const sheets=[],timers=new Map(),events=new Map(),documentEvents=new Map();let timerId=0,focuses=0,disposed=0;
 const classes=()=>{const values=new Set();return {add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)};};
 const element=()=>({style:{setProperty(k,v){this[k]=v;}},classList:classes(),listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},setAttribute(k,v){this[k]=v;},remove(){this.isConnected=false;},contains(){return false;}});
 const notice=element();notice.classList.add('on');notice.undo=false;
 const previous={isConnected:true,focus(options){assert.equal(options.preventScroll,true);focuses++;}};
 const document={activeElement:previous,body:{classList:classes(),append:s=>{s.isConnected=true;sheets.push(s);}},
  createElement:()=>{const s=element();s.sh=element();s.body=element();s.classList.add('scrim');s.contains=el=>el.sheet===s;return s;},
  querySelector:()=>sheets.find(s=>s.isConnected),querySelectorAll:()=>sheets.filter(s=>s.isConnected),
  addEventListener:(k,f)=>documentEvents.set(k,f),removeEventListener:k=>documentEvents.delete(k)};
 const ctx={document,console,window:{},matchMedia:()=>({matches:reduced}),getComputedStyle:el=>({transform:'matrix(1, 0, 0, 1, 0, 19)',opacity:el.sh?'.7':'.8'}),esc:String,svg:()=>'',innerHeight:844,
  addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k),requestAnimationFrame:f=>f(),
  setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id),
  $:(selector,parent)=>selector==='#toast'?notice:selector==='button'&&parent===notice?(notice.undo?{}:null):selector==='.sheet'?parent.sh:selector==='.sbody'?parent.body:null,
  $$:()=>sheets.filter(s=>s.isConnected&&s.classList.contains('is-closing'))};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('const viewResources ='),source.indexOf('async function mapInto'))+'\nglobalThis.resources=viewResources;',ctx);
 vm.runInContext(source.slice(source.indexOf('function sheet('),source.indexOf('// ---------- router')),ctx);
 function open(){const close=ctx.sheet('Demo','<p>Fictional</p>');const s=sheets.at(-1),resource={sheet:s,get isConnected(){return s.isConnected;}};ctx.resources.set(resource,()=>disposed++);return {close,s};}
 return {ctx,open,sheets,timers,events,documentEvents,document,notice,get focuses(){return focuses;},get disposed(){return disposed;}};
}
{
 const t=setup(),{close,s}=t.open();let mapRemoved=0;
 const map={sheet:s,get isConnected(){return s.isConnected;}};t.ctx.resources.set(map,Object.assign(()=>mapRemoved++,{keepVisual:true}));
 assert(!t.notice.classList.contains('on'),'plain notice cannot cover a new sheet');assert(t.documentEvents.has('keydown'));close();close();assert.equal(mapRemoved,0,'maps retain their picture during exit');
 assert(s.isConnected&&s.inert,'closing shell is kept only for visual motion');assert.equal(s['aria-hidden'],'true');
 assert.equal(t.focuses,1);assert.equal(t.disposed,1,'social resources stop at logical close, before the exit ends');assert.equal(t.timers.size,1,'closing twice cannot schedule duplicate work');assert(!t.documentEvents.has('keydown'));assert(!t.events.has('mousemove'));assert(!t.events.has('kinetta:keyboard'));
 assert.equal(s.sh.style['--sheet-from'],'matrix(1, 0, 0, 1, 0, 19)','an interrupted entrance/drag keeps its current position');assert.equal(s.style['--scrim-from'],'.7');
 s.listeners.animationend({target:s.sh,animationName:'sheet-out'});assert(!s.isConnected);assert.equal(mapRemoved,1,'map releases after the visual exit');assert.equal(t.disposed,1,'social resources release once');assert.equal(t.timers.size,0);assert(!t.document.body.classList.contains('has-sheet'));
}
{
 const t=setup(),first=t.open();first.close();const second=t.open();assert(!first.s.isConnected);assert(second.s.isConnected);assert.equal(t.disposed,1,'replacement clears detached social subscriptions before mounting its own');const before=t.focuses;
 for(const f of t.timers.values())f();assert.equal(t.focuses,before,'old exit cannot steal replacement focus');assert(second.s.isConnected);assert(t.document.body.classList.contains('has-sheet'),'old cleanup cannot unlock a new sheet');
}
{
 const t=setup(true),{close,s}=t.open();close();assert(!s.isConnected,'reduced motion removes immediately');assert.equal(t.timers.size,0);assert.equal(t.disposed,1);assert.equal(t.focuses,1);
}
{const t=setup();t.notice.undo=true;t.open();assert(t.notice.classList.contains('on'),'opening a sheet preserves the offered Undo');}
console.log('Sheet motion: interrupted start, inert exit, immediate focus/handler release, animation cleanup, rapid replacement/resource bounds and instant reduced-motion close PASS');
