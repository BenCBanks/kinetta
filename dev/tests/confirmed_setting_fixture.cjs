// Minimal DOM for existing isolated handler tests, running the real readback coordinator.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),decorate=require('./setting_dom_fixture.cjs');
class Node {
 constructor(){this.children=[];this.hidden=false;this.dataset={};this.isConnected=true;}
 setAttribute(){}
 append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
 prepend(node){this.children=this.children.filter(n=>n!==node);this.children.unshift(node);node.parentElement=this;}
}
module.exports=c=>{
 const dollar=c.$,dollars=c.$$;if(dollar)c.$=(...args)=>decorate(dollar(...args));if(dollars)c.$$=(...args)=>dollars(...args).map(n=>decorate(n));
 if(c.document?.createElement){const create=c.document.createElement;c.document.createElement=(...args)=>decorate(create(...args),args[0]);}
 c.apiRequest=(path)=>c.api(path);
 c.refreshMe??=(me)=>{c.App.me=me;};
 // Existing isolated handler cases model a reply lost for longer than the recovery window.
 // Timestamp boundaries/navigation are exercised separately by test_social_data and browser tests.
 let elapsed=0;const storage=new Map();
 const helper={Date:{now:()=>Date.now()+elapsed},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},json:c.json,readOwner:()=>c.readOwner(),api:async(...args)=>{try{return await c.api(...args);}catch(error){elapsed+=25001;throw error;}},apiRequest:(...args)=>c.apiRequest(...args),
  window:{scrollX:0,scrollY:0},document:{createElement:tag=>decorate(new Node(),tag)},AbortController,setTimeout,clearTimeout};
 vm.createContext(helper);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nthis.confirm=SocialData.confirmSetting;',helper);
 c.SocialData={confirmSetting:(root,config)=>{
  decorate(root);if(config.mask){const mask=config.mask;config={...config,mask:(...args)=>mask(...args).map(n=>decorate(n))};}
  return helper.confirm(root,config);
 }};
};
