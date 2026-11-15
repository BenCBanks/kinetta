// The activity card can hide geographic labels without changing interactive maps.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(kind){
 const fetches=[],styles=[],P={paintRules:()=>[],labelRules:()=>[{name:'place labels',visible:true}],Static:class{
   constructor(options){styles.push(options);const source={get:async()=>new Map()};this.views=new Map([['fixture',{tileCache:{source}}]]);this.source=source;}
   async drawContext(){await this.source.get();}
 }};
 const context={window:{protomapsL:P},location:{origin:'https://fictional.test'},document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}})})},fetch:async url=>{fetches.push(url);return{ok:true,json:async()=>({kind,url:'/fictional-tiles',max_zoom:18})};},setTimeout,clearTimeout,AbortController};
 vm.createContext(context);vm.runInContext(fs.readFileSync('app/static/maps.js','utf8')+'\nthis.tiles=MapTiles;',context);
 return{tiles:context.tiles,fetches,styles};
}
(async()=>{
 const vector=fixture('vector'),g={drawImage(){}},box={x:0,y:0,w:256,h:256},geometry={z:1,k:1,n:512,cx:256,cy:256,mx:128,my:128,tx0:0,tx1:0,ty0:0,ty1:0,zf:1};
 assert.equal(await vector.tiles.paint(g,[],box,geometry,{hideLabels:true}),1);assert.deepEqual(JSON.parse(JSON.stringify(vector.styles[0].labelRules)),[{name:'place labels',visible:false}],'activity card vector basemap suppresses every geographic label');
 assert.equal(await vector.tiles.paint(g,[],box,geometry),1);assert.equal(vector.styles[1].labelRules[0].visible,true,'interactive/default map style remains unchanged');
 const raster=fixture('raster');assert.equal(await raster.tiles.paint(g,[],box,geometry,{hideLabels:true}),0,'raster exports are omitted when they cannot guarantee label removal');assert.deepEqual(raster.fetches,['/api/map-config'],'no labelled raster tile is requested for the share picture');
 console.log('Activity map export privacy: vector labels suppressed, default map unchanged, labelled raster fallback omitted PASS');
})().catch(error=>{console.error(error);process.exit(1)});
