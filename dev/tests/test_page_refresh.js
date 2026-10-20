// Drive the production gesture/control code without a browser or network.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},notices=[],toasts=[],invalidations=[];let rendered=0,finish,blocked=false,owner='one';
const c={IC:{},App:{me:{id:1},scroll:{}},location:{pathname:'/activity',search:'?view=mine'},scrollY:0,readOwner:()=>owner,toast:t=>toasts.push(t),invalidate:(...args)=>invalidations.push(args),render:()=>{rendered++;return new Promise(r=>finish=r)},$$:()=>[],getSelection:()=>({toString:()=>''}),document:{documentElement:{classList:{contains:()=>false}},querySelector:()=>blocked,addEventListener:(n,fn)=>handlers[n]=fn,createElement:()=>({setAttribute(){},style:{},hidden:false}),body:{append:el=>notices.push(el)}}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/refresh.js','utf8')+'\nglobalThis.refresh=PageRefresh;',c);
const target={closest:()=>false,parentElement:null,scrollTop:0};
const start=(x=30,y=50)=>handlers.touchstart({touches:[{clientX:x,clientY:y}],target});
let prevented=0;const move=(x,y)=>handlers.touchmove({touches:[{clientX:x,clientY:y}],cancelable:true,preventDefault:()=>prevented++});
(async()=>{
 start();move(32,190);assert.equal(notices[0].textContent,'Release to refresh');handlers.touchend();assert.equal(rendered,1);assert.equal(invalidations[0][0],'/api/');assert.equal(invalidations[0][1].keepData,true);assert.equal(invalidations[0][1].health,false,'refresh never initiates Health writes');await c.refresh.run();assert.equal(rendered,1,'repeated pulls join the in-flight refresh');finish();await new Promise(setImmediate);assert.equal(toasts.at(-1),'Up to date');
 start();move(180,80);handlers.touchend();assert.equal(rendered,1,'horizontal media gestures are not a refresh');
 c.scrollY=50;start();move(30,250);handlers.touchend();assert.equal(rendered,1,'scroll to top first');c.scrollY=0;
 blocked=true;start();move(30,250);handlers.touchend();assert.equal(rendered,1,'sheets protect editors');blocked=false;
 c.location.pathname='/me/kit';start();move(30,250);handlers.touchend();assert.equal(rendered,1,'chat history has its own gestures');c.location.pathname='/activity';
 start();move(30,250);handlers.touchcancel();handlers.touchend();assert.equal(rendered,1,'cancelled gestures never refresh');
 const task=c.refresh.run();c.refresh.failed(Error('offline'));finish();await task;assert(toasts.at(-1).includes('saved view'));
 const previous=toasts.length,late=c.refresh.run();owner='two';finish();await late;assert.equal(toasts.length,previous,'late refresh feedback cannot appear on another account');
 assert(prevented>0);console.log('Page refresh: threshold/direction/top/sheet/chat/cancel guards, single request, retained-cache epochs, read-only refresh and stale-account feedback PASS');
})().catch(e=>{console.error(e);process.exit(1)});
