// Drive the production gesture/control code without a browser or network.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},notices=[],toasts=[],invalidations=[];let rendered=0,finish,blocked=false,owner='one';
const c={pendingReads:new Map(),IC:{},App:{me:{id:1},scroll:{}},location:{pathname:'/activity',search:'?view=mine'},scrollY:0,readOwner:()=>owner,toast:t=>toasts.push(t),invalidate:(...args)=>invalidations.push(args),render:()=>{rendered++;return new Promise(r=>finish=r)},$$:()=>[],getSelection:()=>({toString:()=>''}),document:{documentElement:{classList:{contains:()=>false}},querySelector:()=>blocked,addEventListener:(n,fn)=>handlers[n]=fn,createElement:()=>({setAttribute(){},style:{},hidden:false}),body:{append:el=>notices.push(el)}}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/refresh.js','utf8')+'\nglobalThis.refresh=PageRefresh;',c);
const target={closest:()=>false,parentElement:null,scrollTop:0};
let touchTarget=target;const start=(x=30,y=50)=>handlers.touchstart({touches:[{clientX:x,clientY:y}],target:touchTarget});
let prevented=0;const move=(x,y)=>handlers.touchmove({touches:[{clientX:x,clientY:y}],cancelable:true,preventDefault:()=>prevented++});
assert(!fs.readFileSync('app/static/refresh.js','utf8').includes("document.createElement('button')"),'no header refresh control is injected');
(async()=>{
 start();move(32,190);assert.equal(notices[0].textContent,'Release to refresh');handlers.touchend();assert.equal(rendered,1);assert.equal(invalidations[0][0],'/api/');assert.equal(invalidations[0][1].keepData,true);assert.equal(invalidations[0][1].health,false,'refresh never initiates Health writes');await c.refresh.run();assert.equal(rendered,1,'repeated pulls join the in-flight refresh');finish();await new Promise(setImmediate);assert.equal(toasts.at(-1),'Up to date');
 start();move(180,80);handlers.touchend();assert.equal(rendered,1,'horizontal media gestures are not a refresh');
 c.scrollY=50;start();move(30,250);handlers.touchend();assert.equal(rendered,1,'scroll to top first');c.scrollY=0;
 blocked=true;start();move(30,250);handlers.touchend();assert.equal(rendered,1,'sheets protect editors');blocked=false;
 c.location.pathname='/me/kit';start();move(30,250);handlers.touchend();assert.equal(rendered,1,'chat history has its own gestures');c.location.pathname='/activity';
 start();move(30,250);handlers.touchcancel();handlers.touchend();assert.equal(rendered,1,'cancelled gestures never refresh');
 const task=c.refresh.run();c.refresh.failed(Error('offline'));finish();await task;assert(toasts.at(-1).includes('saved view'));
 const before=toasts.length;let finishRead;const reading=new Promise(ok=>finishRead=ok).finally(()=>c.pendingReads.clear());c.pendingReads.set(JSON.stringify([owner,'/api/home-card']),reading);const cards=c.refresh.run();finish();await new Promise(setImmediate);assert.equal(toasts.length,before,'home-card reads finish before reporting Up to date');finishRead({});await cards;assert.equal(toasts.at(-1),'Up to date');
 const previous=toasts.length,late=c.refresh.run();owner='two';finish();await late;assert.equal(toasts.length,previous,'late refresh feedback cannot appear on another account');
 // The activity title/numbers occupy a large link; allow vertical pulls there.
 let selector='';touchTarget={...target,closest:s=>{selector=s;return null;}};
 start();move(30,145);assert.equal(notices[0].textContent,'Release to refresh','a 95px pull reaches the release threshold');handlers.touchend();assert(selector.includes('a:not(.post-link)'),'ordinary links stay excluded while the card link allows pulls');finish();await new Promise(setImmediate);
 let swallowed=false;handlers.click({detail:1,preventDefault(){swallowed=true;},stopImmediatePropagation(){}});assert(swallowed,'a post-drag synthetic click cannot open the activity');
 start();handlers.touchend();swallowed=false;handlers.click({detail:1,preventDefault(){swallowed=true;},stopImmediatePropagation(){}});assert(!swallowed,'a new intentional tap still opens its link');
 start();move(30,90);handlers.touchend();swallowed=false;handlers.click({detail:0,preventDefault(){swallowed=true;},stopImmediatePropagation(){}});assert(!swallowed,'keyboard activation survives a cancelled short pull');
 touchTarget={...target,closest:()=>({})};const blockedBefore=rendered;start();move(30,250);handlers.touchend();assert.equal(rendered,blockedBefore,'controls and media retain their gestures');
 assert(prevented>0);console.log('Page refresh: threshold/direction/top/sheet/chat/cancel guards, single request, retained-cache epochs, read-only refresh and stale-account feedback PASS');
})().catch(e=>{console.error(e);process.exit(1)});
