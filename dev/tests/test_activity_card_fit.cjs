'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pages=fs.readFileSync('app/static/pages.js','utf8'),app=fs.readFileSync('app/static/app.js','utf8');
const block=pages.slice(pages.indexOf('function activityCardInsets('),pages.indexOf('// Cheers straight from a feed card:'));
const cleanup=app.slice(app.indexOf('function cleanViews('),app.indexOf('function loadLeaflet('));
let headerBottom=116,dots=false,controls=false,disconnected=0,fitCalls=0;
const props=new Map(),style={setProperty:(key,value)=>props.set(key,value)};
const picture={style,getBoundingClientRect:()=>({top:0,bottom:346,width:346})};
const header={getBoundingClientRect:()=>({bottom:headerBottom})},metrics={getClientRects:()=>[{}],getBoundingClientRect:()=>({top:282})},credit={getClientRects:()=>[{}],getBoundingClientRect:()=>({top:326})},dot={getClientRects:()=>[{}],getBoundingClientRect:()=>({top:244})};
const el={isConnected:true,clientWidth:346,clientHeight:346,style,closest:selector=>selector==='.activity-picture'?picture:{}};
const context={Number,Math,Object,Map,document:{fonts:{ready:Promise.resolve()}},headerObservers:new Map(),viewResources:new Map(),
 $:selector=>selector==='.post-hd'?header:selector==='.post-map-metrics'?metrics:selector==='.media-controls'&&controls?{}:null,
 $$:selector=>selector==='.post-led .fmap'?[el]:[metrics,credit,...dots?[dot]:[]],
 ResizeObserver:class{observe(){}disconnect(){disconnected++;}}
};
vm.createContext(context);vm.runInContext(block+'\n'+cleanup,context);
const view={group:{getBounds:()=>({isValid:()=>true})},map:{invalidateSize:()=>{},fitBounds:(_bounds,options)=>{fitCalls++;assert(options.paddingTopLeft[1]+options.paddingBottomRight[1]<el.clientHeight,'a finite clear route area remains');}}};
assert.deepEqual({...context.activityCardInsets(el)},{top:132,bottom:80,side:24});
dots=true;controls=true;assert.deepEqual({...context.activityCardInsets(el)},{top:132,bottom:118,side:64},'carousel dots and arrows reserve real clearance');
context.measureActivityPictures({});assert.equal(context.headerObservers.size,1);assert.equal(props.get('--picture-min-height'),'314px','long/enlarged overlays reserve at least64px for the route');
context.fitActivityCardMap(el,view);assert.equal(fitCalls,1);el._activityMapFit();assert.equal(fitCalls,1,'unchanged refresh does not move the route');
el.clientWidth=330;el.clientHeight=330;el._activityMapFit();assert.equal(fitCalls,2,'changed geometry refits once');
headerBottom=NaN;assert.equal(context.activityCardInsets(el),null,'non-finite geometry is rejected');el._activityMapFit();assert.equal(fitCalls,2);
headerBottom=300;el._activityMapFit();assert.equal(fitCalls,2,'overlays with no usable map area cannot trigger a bad fit');
el.isConnected=false;context.cleanViews();assert.equal(context.headerObservers.size,0);assert.equal(disconnected,1,'navigation disconnects the card observer');el._activityMapFit();assert.equal(fitCalls,2,'detached cards cannot refit');
console.log('Activity card fit: measured overlays, finite usable bounds, stable refresh, resize and navigation cleanup PASS');
