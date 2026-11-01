// Exercise the production loader with a small Leaflet/DOM boundary, never a provider request.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let layer,note,position,requests=[],hold=false;
 const node=()=>({hidden:false,append(){},setAttribute(){},getContext:()=>({drawImage(){}})});
 const listeners={},map={fire(name,value){listeners[name]?.(value)},on(name,fn){listeners[name]=fn},once(name,fn){listeners[name]=fn},setMaxZoom(){},removeLayer(){}};
 const L={control(options){position=options.position;const control={addTo(){note=control.onAdd()},getContainer:()=>note};return control},DomUtil:{create:node},DomEvent:{disableClickPropagation(){}},GridLayer:{extend(methods){return class{constructor(){Object.assign(this,methods);this.events={};layer=this}on(name,fn){this.events[name]=fn;return this}addTo(){this.events.loading?.()}}}}};
 const c={AbortController,setTimeout,clearTimeout,queueMicrotask,Date,Map,console,location:{origin:'https://app.example.test'},Native:{base:''},esc:String,
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},window:{addEventListener(){},removeEventListener(){}},
  document:{documentElement:{dataset:{}},createElement:node},URL:{createObjectURL:()=> 'blob:fictional',revokeObjectURL(){}},Image:class{async decode(){}},
  fetch:async(url,opts)=>{if(url.endsWith('/api/map-config'))return{ok:true,json:async()=>({kind:'raster',url:'https://tiles.example.test/{z}/{x}/{y}.png',max_zoom:19})};requests.push(opts);if(hold)return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('unloaded'),{name:'AbortError'}))));return{ok:requests.length!==1,blob:async()=>({size:10})}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/maps.js','utf8')+'\nthis.subject=MapTiles;',c);
 let style;map.on('basemaptheme',value=>style=value);await c.subject.mount(map,L,{isConnected:true,classList:{contains:()=>false}});await tick();assert.equal(position,'bottomleft');assert(layer);assert.equal(style.light,true);
 const tile=()=>new Promise(resolve=>layer.createTile({x:1,y:1,z:3},resolve));
 await tile();assert.equal(note.hidden,false,'An entirely failed batch offers Retry');
 await tile();await tile();assert.equal(requests.length,3,'One failed tile cannot stop other downloads');assert.equal(note.hidden,true,'Mostly successful maps keep usable tiles without an unavailable overlay');
 hold=true;let completed=false;const canvas=layer.createTile({x:2,y:2,z:3},()=>completed=true);await tick();layer.events.tileunload({tile:canvas});await tick();assert.equal(requests.at(-1).signal.aborted,true);assert.equal(completed,false,'An unloaded tile cannot paint into the next view');
 await c.subject.mount(map,L,{isConnected:true,classList:{contains:name=>name==='live-record-map'}});assert.equal(position,'bottomright','Recording Retry shares the attribution corner');
 console.log('Map failure isolation, majority recovery, light-raster route palette and off-screen abort PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
