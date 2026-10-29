// Nearby segments/live tracks add route lines after map configuration and appearance changes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/app.js','utf8');
(async()=>{
 const events={},layers=[],layerEvents={};const map={on:(k,fn)=>events[k]=fn,fitBounds(){},setView(){},attributionControl:{setPrefix(){}}};
 const group={addTo(){return this;},on:(k,fn)=>layerEvents[k]=fn,setStyle:s=>layers.forEach(l=>l.setStyle(s))};
 const polyline=()=>({style:{},setStyle(s){Object.assign(this.style,s);},addTo(g){layers.push(this);layerEvents.layeradd?.({layer:this});return this;}});
 const L={map:()=>map,latLngBounds:x=>x,featureGroup:()=>group,polyline};
 const c={loadLeaflet:async()=>L,cleanViews(){},viewResources:new Map(),MapTiles:{mount(){}},col:n=>n==='--route'?'light-blue':'dark-blue',decode:x=>x};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function mapInto('),source.indexOf('\nfunction feedMaps(')),c);
 await c.mapInto({isConnected:true},[[[1,2],[3,4]]],{still:true,ends:false});events.basemaptheme({light:true});
 assert.equal(layers[0].style.color,'dark-blue');const late=polyline().addTo(group);assert.equal(late.style.color,'dark-blue','A late route must use the settled light-basemap contrast');
 events.basemaptheme({light:false});assert.equal(late.style.color,'light-blue');assert.equal(polyline().addTo(group).style.color,'light-blue');
 console.log('Map: existing and late route layers follow settled basemap contrast and later appearance changes PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
