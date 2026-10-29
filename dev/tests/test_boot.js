// Actual startup recovery: a required-script failure is recoverable, while later maps/photos keep their own UI.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
function fixture(styles=[{sheet:{},href:'/static/style.css'}],href='https://fictional.invalid/'){
 let launch=true,page=false,reloads=0,handlers={};const button={},root={innerHTML:''},timers=[];
 const c={URL,document:{querySelector:()=>launch,querySelectorAll:()=>styles, getElementById:id=>id==='app'?root:id==='page'?(page?{}:null):button},location:{href,reload:()=>reloads++},addEventListener:(type,fn)=>handlers[type]=fn,setTimeout:(fn,ms)=>{assert.equal(ms,20000);timers.push(fn);}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/boot.js','utf8'),c);
 return {c,root,button,emit:e=>handlers.error(e),loaded:()=>handlers.DOMContentLoaded(),ready:()=>{launch=false;page=true;},timeout:()=>timers.forEach(fn=>fn()),reloads:()=>reloads};
}
let f=fixture();f.emit({target:{tagName:'IMG'}});assert.equal(f.c.KinettaBoot.failed,false,'A photo error cannot replace startup');
f.emit({target:{tagName:'SCRIPT',src:'/static/app.js?v=1'}});assert.equal(f.c.KinettaBoot.failed,true);assert(f.root.innerHTML.includes('Try again'));f.button.onclick();assert.equal(f.reloads(),1);
f=fixture();f.emit({target:{},filename:'fictional-optional-script.js'});assert.equal(f.c.KinettaBoot.failed,false,'An incidental runtime error must not poison otherwise successful startup');f.ready();assert.equal(f.root.innerHTML,'');
f=fixture();f.ready();f.emit({target:{tagName:'SCRIPT',src:'/static/app.js'}});assert.equal(f.c.KinettaBoot.failed,false);assert.equal(f.root.innerHTML,'','An active screen is never replaced by a dynamic resource failure');
f=fixture();f.loaded();assert.equal(f.c.KinettaBoot.failed,false,'Loaded styles keep startup usable');
f=fixture();f.loaded();f.timeout();assert(f.root.innerHTML.includes('Try again'),'A syntax failure or stalled launch eventually offers recovery');assert.equal(f.c.KinettaBoot.failed,false,'A slow successful startup may still finish');
f=fixture();f.loaded();f.ready();f.timeout();assert.equal(f.root.innerHTML,'','The delayed guard must never replace a successfully loaded screen');
f=fixture([{sheet:null,href:'/static/style.css'}]);f.loaded();assert.equal(f.c.KinettaBoot.failed,true,'An earlier failed stylesheet gives reload rather than a broken layout');assert(f.root.innerHTML.includes('Try again'));
f=fixture();f.emit({target:{tagName:'LINK',rel:'stylesheet',href:'/static/style.css'}});assert.equal(f.c.KinettaBoot.failed,true);
f=fixture([{sheet:null,href:'/static/style.css'}]);f.ready();f.loaded();assert.equal(f.c.KinettaBoot.failed,false,'A later style check cannot replace the active screen');
for(const href of ['https://fictional.invalid/','capacitor://localhost/']){
 for(const src of ['https://optional.invalid/static/beacon.js','https://localhost/static/beacon.js','http://fictional.invalid/static/beacon.js','/analytics.js','data:text/javascript,','']){
  f=fixture(undefined,href);f.emit({target:{tagName:'SCRIPT',src}});f.loaded();assert.equal(f.c.KinettaBoot.failed,false,href+' ignores optional '+src);assert.equal(f.root.innerHTML,'');
 }
 f=fixture([{sheet:null,href:'https://optional.invalid/static/style.css'},{sheet:{},href:'/static/style.css'}],href);
 f.emit({target:{tagName:'LINK',rel:'stylesheet',href:'https://optional.invalid/static/style.css'}});f.loaded();assert.equal(f.c.KinettaBoot.failed,false,'An optional stylesheet cannot block startup');
 for(const src of ['/static/app.js?v=1',new URL('/static/app.js',href).href]){
  f=fixture(undefined,href);f.emit({target:{tagName:'SCRIPT',src}});assert.equal(f.c.KinettaBoot.failed,true,href+' detects required '+src);
 }
 f=fixture([{sheet:null,href:new URL('/static/style.css',href).href}],href);f.loaded();assert.equal(f.c.KinettaBoot.failed,true,href+' detects missing bundled stylesheet');
}
console.log('Startup: required web/native scripts and styles offer reload; optional proxy assets, photos and active screens remain separate PASS');
