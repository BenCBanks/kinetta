// DOM subset for isolated setting-handler tests; browser suites verify real layout/focus.
'use strict';
function decorate(node,tag='div'){
 if(!node||node.settingDOM)return node;node.settingDOM=true;node.tag??=tag;node.children??=[];node.isConnected??=true;node.hidden??=false;node.dataset??={};node.style??={visibility:''};node.classList??={add(){},remove(){}};
 const attrs=new Map(),set=node.setAttribute;
 node.setAttribute=(k,v)=>{attrs.set(k,String(v));set?.call(node,k,v);};node.getAttribute??=k=>attrs.get(k)??null;node.hasAttribute??=k=>node.getAttribute(k)!==null;node.removeAttribute??=k=>attrs.delete(k);
 node.contains??=n=>node===n||node.children.some(c=>decorate(c).contains(n));node.matches??=selector=>['button','input','select','textarea'].includes(node.tag)&&selector.includes(node.tag);
 node.querySelectorAll??=selector=>node.children.flatMap(c=>[...(decorate(c).matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);
 node.addEventListener??=()=>{};node.append??=(...nodes)=>{for(const n of nodes){decorate(n);node.children.push(n);n.parentElement=node;}};
 node.prepend??=n=>{decorate(n);node.children=node.children.filter(c=>c!==n);node.children.unshift(n);n.parentElement=node;};
 node.children.forEach(c=>decorate(c));return node;
}
module.exports=decorate;
