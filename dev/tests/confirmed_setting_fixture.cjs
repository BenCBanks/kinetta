// Minimal DOM for existing isolated handler tests, running the real readback coordinator.
'use strict';
const fs=require('node:fs'),vm=require('node:vm');
class Node {
 constructor(){this.children=[];this.hidden=false;this.dataset={};this.isConnected=true;}
 setAttribute(){}
 append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
 prepend(node){this.children=this.children.filter(n=>n!==node);this.children.unshift(node);node.parentElement=this;}
}
module.exports=c=>{
 c.apiRequest=(path)=>c.api(path);
 c.refreshMe??=(me)=>{c.App.me=me;};
 // Existing isolated handler cases model a reply lost for longer than the recovery window.
 // Timestamp boundaries/navigation are exercised separately by test_social_data and browser tests.
 let elapsed=0;const storage=new Map();
 const helper={Date:{now:()=>Date.now()+elapsed},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},json:c.json,readOwner:()=>c.readOwner(),api:async(...args)=>{try{return await c.api(...args);}catch(error){elapsed+=25001;throw error;}},apiRequest:(...args)=>c.apiRequest(...args),
  document:{createElement:()=>new Node()},AbortController,setTimeout,clearTimeout};
 vm.createContext(helper);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nthis.confirm=SocialData.confirmSetting;',helper);
 c.SocialData={confirmSetting:(root,config)=>{
  root.children??=[];root.isConnected??=true;root.prepend??=Node.prototype.prepend;
  return helper.confirm(root,config);
 }};
};
