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
 c.apiRequest=(path)=>path==='/api/privacy-save'?Promise.resolve({ticket:'fictional-ticket'}):path.startsWith('/api/privacy-save?')?Promise.resolve({settled:true}):c.api(path);
 c.refreshMe??=(me)=>{c.App.me=me;};
 const helper={localStorage:{getItem:()=>null,setItem(){},removeItem(){}},json:c.json,readOwner:()=>c.readOwner(),api:(...args)=>c.api(...args),apiRequest:(...args)=>c.apiRequest(...args),
  document:{createElement:()=>new Node()},AbortController,setTimeout,clearTimeout};
 vm.createContext(helper);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nthis.confirm=SocialData.confirmSetting;',helper);
 c.SocialData={confirmSetting:(root,config)=>{
  root.children??=[];root.isConnected??=true;root.prepend??=Node.prototype.prepend;
  return helper.confirm(root,config);
 }};
};
