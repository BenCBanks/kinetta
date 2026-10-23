// Run the production map overlay with deterministic DOM/history/Leaflet stand-ins.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/media.js','utf8');
function fixture(){
 const classes=new Set(),attributes=new Map([['role','img']]),events={},windowEvents={},refits=[],moves=[],track={scrollLeft:0};
 const background=[{inert:false},{inert:true}],spot={isConnected:false,replaceWith(){spot.isConnected=false;box.isConnected=true}},ctx={};
 const button={disabled:false,getClientRects:()=>[1],setAttribute:(k,v)=>attributes.set('button-'+k,v),focus(){ctx.document.activeElement=button}},link={disabled:false,getClientRects:()=>[1],focus(){ctx.document.activeElement=link}};
 const box={isConnected:true,classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),replaceWith(){box.isConnected=false;spot.isConnected=true},remove(){box.isConnected=false},closest:()=>track,querySelectorAll:()=>[button,link],addEventListener:(k,fn)=>events[k]=fn};
 let historyIndex=0;const states=[{tab:'charts'}];
 Object.assign(ctx,{App:{},slide:()=>{ctx.routed=true},window:{addEventListener:(k,fn)=>windowEvents[k]=fn},Date,Math,Array,Map,console,location:{pathname:'/activity/7',search:'?tab=charts',href:'https://fictional.test/activity/7?tab=charts'},viewResources:new Map(),$:()=>button,svg:String,
  decode:line=>line==='a'?[[1,2],[3,4]]:[[5,6],[7,8]],
  addEventListener:(k,fn)=>windowEvents[k]=fn,removeEventListener:(k,fn)=>{if(windowEvents[k]===fn)delete windowEvents[k]},
  document:{activeElement:null,createComment:()=>spot,body:{children:background,classList:{add:k=>moves.push(k),remove:k=>moves.push('-'+k)},append(n){n.isConnected=true;if(!this.children.includes(n))this.children.push(n)}}},
  history:{get state(){return states[historyIndex]},pushState(s){states[++historyIndex]=s},replaceState(s){states[historyIndex]=s},back(){assert(historyIndex>0);historyIndex--;const e={stopImmediatePropagation(){ctx.stopped=true}};windowEvents.popstate?.(e)}},
 });
 const mapObject={map:{invalidateSize(){},fitBounds:b=>refits.push(b),dragging:{enable:()=>moves.push('drag-on'),disable:()=>moves.push('drag-off')},touchZoom:{enable:()=>moves.push('zoom-on'),disable:()=>moves.push('zoom-off')}},L:{latLngBounds:x=>x}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/app.js','utf8').split('\n').find(line=>line.startsWith("window.addEventListener('popstate'")),ctx);vm.runInContext(source.slice(source.indexOf('function wireMediaMapFull('),source.indexOf('\nfunction wireActivityMedia')),ctx);
 ctx.wireMediaMapFull(box,()=>mapObject,['a','b'],true);
 const target={closest:()=>null},event=(extra={})=>({isPrimary:true,button:0,pointerId:1,clientX:20,clientY:30,target,stopPropagation(){},...extra});
 const tap=()=>{events.pointerdown(event());events.pointerup(event());events.click(event())};
 return {ctx,box,button,link,events,windowEvents,background,spot,attributes,classes,refits,moves,event,tap,history:()=>historyIndex};
}
let f=fixture();f.tap();assert(f.classes.has('full'));assert.equal(f.attributes.get('role'),'dialog');assert.equal(f.attributes.get('aria-modal'),'true');assert(f.background.slice(0,2).every(n=>n.inert));assert.equal(f.history(),1);assert.equal(f.refits.at(-1).length,4,'bounds include every route segment');
f.windowEvents.keydown({key:'Tab',preventDefault(){}});assert.equal(f.ctx.document.activeElement,f.link,'focus remains in modal map');
f.windowEvents.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert(!f.classes.has('full'));assert(!f.ctx.routed,'Back closes modal without router navigation');assert.equal(f.history(),0);assert.deepEqual(f.background.slice(0,2).map(n=>n.inert),[false,true]);assert.equal(f.ctx.document.activeElement,f.button);assert.equal(f.attributes.get('role'),'img');assert(!f.ctx.viewResources.size);
f.tap();f.ctx.history.back();assert(!f.classes.has('full'));assert(f.moves.includes('drag-on')&&f.moves.includes('drag-off'));
console.log('Map: surface tap, all-segment bounds, modal focus/inert state, Escape/Back and original interaction state restored PASS');
for(const kind of ['drag','pinch','cancel','control','rail']){
 f=fixture();f.events.pointerdown(f.event());
 if(kind==='drag')f.events.pointermove(f.event({clientX:50}));
 if(kind==='pinch')f.events.pointerdown(f.event({isPrimary:false,pointerId:2}));
 if(kind==='cancel')f.events.pointercancel(f.event());
 if(kind==='rail')f.box.closest().scrollLeft=100;
 f.events.pointerup(f.event());f.events.click(f.event(kind==='control'?{target:{closest:()=>({})}}:{}));assert(!f.classes.has('full'),kind+' must not open map');
}
f=fixture();f.button.onclick(f.event());assert(f.classes.has('full'),'existing keyboard-accessible expand button retained');f.spot.isConnected=false;[...f.ctx.viewResources.values()][0]();assert(!f.box.isConnected);assert(!f.classes.has('full'));assert.equal(f.history(),1,'navigation cleanup never navigates backwards');assert.equal(f.ctx.history.state.tab,'charts');assert(!f.ctx.history.state.kinettaMap);assert(!f.windowEvents.keydown&&!f.ctx.App.mediaMapBack);
console.log('Map: drag/pinch/cancel/controls/rail guards, expand button and disconnected-route cleanup PASS');
