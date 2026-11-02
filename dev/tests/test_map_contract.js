'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const paletteSource=fs.readFileSync('app/static/maps.js','utf8').match(/const palettes=(.*);\n/)[1],palettes=JSON.parse(paletteSource);
const luminance=h=>h.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
for(const theme of Object.values(palettes))for(const text of ['city_label','roads_label_minor','state_label'])for(const background of ['earth','water','park_b']){const a=luminance(theme[text]),b=luminance(theme[background]);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'map labels keep readable contrast');}
// The darker light basemap must retain the original route contrast, including translucent heatmap lines.
const previousLight={"background":"#F3F5F7","earth":"#EDF0F3","park_a":"#E4EBE7","park_b":"#D4E1D9","wood_a":"#E1E8E1","wood_b":"#D3E2D3","scrub_a":"#E7ECE4","scrub_b":"#DCE5DA","water":"#D6E4EC","buildings":"#DDE2E6","minor_service_casing":"#e0e0e0","minor_casing":"#e0e0e0","link_casing":"#e0e0e0","major_casing_early":"#e0e0e0","major_casing_late":"#e0e0e0","highway_casing_early":"#e0e0e0","highway_casing_late":"#e0e0e0","other":"#ebebeb","minor_service":"#ebebeb","minor_a":"#ebebeb","landcover.grassland":"#E5EBE5","landcover.farmland":"#E5EBE5","landcover.forest":"#E5EBE5","landcover.scrub":"#E5EBE5","landcover.urban_area":"#EDF0F3","landcover.barren":"#EDF0F3"};
const tokens=JSON.parse(fs.readFileSync('docs/design-tokens.json','utf8'));
const blend=(bg,fg,a)=>'#'+bg.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-a)+parseInt(fg.slice(1).match(/../g)[i],16)*a).toString(16).padStart(2,'0')).join('');
const ratio=(a,b)=>{a=luminance(a);b=luminance(b);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
assert(fs.readFileSync('app/static/style.css','utf8').split('@media')[0].includes('--route: var(--color-brand)'),'Light routes use the existing stronger brand blue');
for(const [key,before] of Object.entries(previousLight))for(const alpha of [.35,.95,1]){
 const after=key.split('.').reduce((p,k)=>p[k],palettes.light);
 assert(ratio(after,blend(after,tokens.light.brand,alpha))>=ratio(before,blend(before,tokens.light.action,alpha)),key+' preserves route contrast at opacity '+alpha);
}
let host='https://one.example.test',reads=0;
const c={Native:{base:host},location:{origin:host},document:{documentElement:{dataset:{}}},matchMedia:()=>({matches:false}),esc:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),Date,AbortController,setTimeout,clearTimeout,fetch:async(path,opts)=>{assert.equal(path,host+'/api/map-config');assert.equal(opts.credentials,'omit');reads++;return {ok:true,json:async()=>({kind:'pmtiles',url:host+'/region.pmtiles'})};}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/maps.js','utf8')+'\nthis.maps=MapTiles',c);
(async()=>{
 assert.equal((await c.maps.config()).url,host+'/region.pmtiles');await c.maps.config();assert.equal(reads,1,'configuration shared across map surfaces');
 host='https://two.example.test';c.Native.base=host;assert.equal((await c.maps.config()).url,host+'/region.pmtiles');assert.equal(reads,2,'server switches cannot reuse another operator config');
 assert.equal(c.maps.tileUrl({url:'https://tiles.example.test/light/{z}/{x}/{y}.png',dark_url:'https://tiles.example.test/dark/{z}/{x}/{y}.png'},4,2,3,true),'https://tiles.example.test/dark/4/2/3.png');
 assert.match(c.maps.attribution({attribution:'Fictional <tiles>',attribution_url:''}),/&lt;tiles>/);assert.match(c.maps.attribution({}),/https:\/\/www.openstreetmap.org\/copyright/);
 for(const name of fs.readdirSync('app/static').filter(n=>n.endsWith('.js')))assert(!fs.readFileSync('app/static/'+name,'utf8').includes('tile.openstreetmap.org'),name+' cannot bypass the map configuration');
 console.log('Map contract: shared config, server isolation, real raster dark URL, escaped linked credit and no hard-coded public tile requests PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
