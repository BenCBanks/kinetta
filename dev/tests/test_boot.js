// Actual startup recovery: a required-script failure is recoverable, while later maps/photos keep their own UI.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
function fixture(){
 let launch=true,page=false,reloads=0,handler;const button={},root={innerHTML:''};
 const c={document:{querySelector:()=>launch, getElementById:id=>id==='app'?root:id==='page'?(page?{}:null):button},location:{reload:()=>reloads++},addEventListener:(type,fn)=>handler=fn};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/boot.js','utf8'),c);
 return {c,root,button,emit:e=>handler(e),ready:()=>{launch=false;page=true;},reloads:()=>reloads};
}
let f=fixture();f.emit({target:{tagName:'IMG'}});assert.equal(f.c.KinettaBoot.failed,false,'A photo error cannot replace startup');
f.emit({target:{tagName:'SCRIPT'}});assert.equal(f.c.KinettaBoot.failed,true);assert(f.root.innerHTML.includes('Try again'));f.button.onclick();assert.equal(f.reloads(),1);
f=fixture();f.emit({target:{},filename:'fictional-required-script.js'});assert.equal(f.c.KinettaBoot.failed,true,'A startup syntax/runtime error also gives recovery');
f=fixture();f.ready();f.emit({target:{tagName:'SCRIPT'}});assert.equal(f.c.KinettaBoot.failed,false);assert.equal(f.root.innerHTML,'','An active screen is never replaced by a dynamic resource failure');
console.log('Startup: required-script failure offers reload; normal startup, photos and active-screen resources remain separate PASS');
