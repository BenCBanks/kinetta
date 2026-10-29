// Actual startup recovery: a required-script failure is recoverable, while later maps/photos keep their own UI.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
function fixture(styles=[{sheet:{}}]){
 let launch=true,page=false,reloads=0,handlers={};const button={},root={innerHTML:''};
 const c={document:{querySelector:()=>launch,querySelectorAll:()=>styles, getElementById:id=>id==='app'?root:id==='page'?(page?{}:null):button},location:{reload:()=>reloads++},addEventListener:(type,fn)=>handlers[type]=fn};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/boot.js','utf8'),c);
 return {c,root,button,emit:e=>handlers.error(e),loaded:()=>handlers.DOMContentLoaded(),ready:()=>{launch=false;page=true;},reloads:()=>reloads};
}
let f=fixture();f.emit({target:{tagName:'IMG'}});assert.equal(f.c.KinettaBoot.failed,false,'A photo error cannot replace startup');
f.emit({target:{tagName:'SCRIPT'}});assert.equal(f.c.KinettaBoot.failed,true);assert(f.root.innerHTML.includes('Try again'));f.button.onclick();assert.equal(f.reloads(),1);
f=fixture();f.emit({target:{},filename:'fictional-required-script.js'});assert.equal(f.c.KinettaBoot.failed,true,'A startup syntax/runtime error also gives recovery');
f=fixture();f.ready();f.emit({target:{tagName:'SCRIPT'}});assert.equal(f.c.KinettaBoot.failed,false);assert.equal(f.root.innerHTML,'','An active screen is never replaced by a dynamic resource failure');
f=fixture();f.loaded();assert.equal(f.c.KinettaBoot.failed,false,'Loaded styles keep startup usable');
f=fixture([{sheet:null}]);f.loaded();assert.equal(f.c.KinettaBoot.failed,true,'An earlier failed stylesheet gives reload rather than a broken layout');assert(f.root.innerHTML.includes('Try again'));
f=fixture();f.emit({target:{tagName:'LINK',rel:'stylesheet'}});assert.equal(f.c.KinettaBoot.failed,true);
f=fixture([{sheet:null}]);f.ready();f.loaded();assert.equal(f.c.KinettaBoot.failed,false,'A later style check cannot replace the active screen');
console.log('Startup: required scripts/styles offer reload; normal startup, photos and active-screen resources remain separate PASS');
