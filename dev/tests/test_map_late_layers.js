// Nearby segments/live tracks add route lines after map configuration and appearance changes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/app.js','utf8');
(async()=>{
 const events={},layers=[],layerEvents={};const map={once:(k,fn)=>events[k]=fn,on:(k,fn)=>{const prior=events[k];events[k]=prior?e=>{prior(e);fn(e);}:fn;},fitBounds(){},setView(){},attributionControl:{setPrefix(){}}};
 const group={addTo(){return this;},on:(k,fn)=>layerEvents[k]=fn,setStyle:s=>layers.forEach(l=>l.setStyle(s)),eachLayer:fn=>layers.forEach(fn)};
 let last;const polyline=(points,style={})=>(last={style:{...style},setStyle(s){Object.assign(this.style,s);},setLatLngs(){},addTo(g){if(g===group){layers.push(this);layerEvents.layeradd?.({layer:this});}return this;}});
 const L={map:()=>map,latLngBounds:x=>x,featureGroup:()=>group,polyline};
 const c={loadLeaflet:async()=>L,cleanViews(){},viewResources:new Map(),MapTiles:{mount(){}},col:n=>n==='--route'?'light-blue':n==='--color-action'?'dark-blue':'muted',decode:x=>x};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function mapInto('),source.indexOf('\nfunction feedMaps(')),c);
 const result=await c.mapInto({isConnected:true},[[[1,2],[3,4]]],{still:true,ends:false});events.basemaptheme({light:true});assert.equal(result.routeColor(),'dark-blue','Crop overlays use the current contrast too');
 assert.equal(layers[0].style.color,'dark-blue');const late=polyline().addTo(group);assert.equal(late.style.color,'dark-blue','A late route must use the settled light-basemap contrast');
 events.basemaptheme({light:false});assert.equal(late.style.color,'light-blue');assert.equal(polyline().addTo(group).style.color,'light-blue');
 const nodes=Object.fromEntries(['#st-map','#st-a','#st-b','#st-a-v','#st-b-v','#st-sum','#st-use'].map(k=>[k,{value:k==='#st-b'?'100':'0'}]));let mounted;
 Object.assign(c,{mapInto:async()=>result,Plan:{length:()=>100,slice:x=>x},sheet:(title,html,mount)=>mounted=mount({},()=>{}),$:s=>nodes[s],U:{dist:String,du:()=> 'km'},document:{activeElement:null}});
 const planner=fs.readFileSync('app/static/planner.js','utf8');vm.runInContext(planner.slice(planner.indexOf('function stretchSheet('),planner.indexOf('// Retired links')),c);
 c.stretchSheet('Fictional crop',[[1,2],[3,4]],{onUse(){}});await mounted;const selected=last;assert.equal(selected.style.color,'light-blue');events.basemaptheme({light:true});assert.equal(selected.style.color,'dark-blue');assert(layers.every(l=>l.style.color==='muted'),'Unselected crop context stays dim after a theme change');
 map._animatingZoom=true;events.unload();assert.equal(map._animatingZoom,false,'Unloading cancels a pending Leaflet zoom-end callback');
 console.log('Map: existing and late route layers follow settled basemap contrast and later appearance changes PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
