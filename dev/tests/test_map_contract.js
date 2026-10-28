'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const paletteSource=fs.readFileSync('app/static/maps.js','utf8').match(/const palettes=(.*);\n/)[1],palettes=JSON.parse(paletteSource);
const luminance=h=>h.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
for(const theme of Object.values(palettes))for(const text of ['city_label','roads_label_minor','state_label'])for(const background of ['earth','water','park_b']){const a=luminance(theme[text]),b=luminance(theme[background]);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'map labels keep readable contrast');}
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
