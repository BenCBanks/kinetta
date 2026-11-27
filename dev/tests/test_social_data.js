// Exercise the actual account-scoped read coordinator; no server/provider/device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
let owner='fictional-session-one',now=0;const requests=[];
const ctx={readOwner:()=>owner,Date:{now:()=>now},Map,Set,Promise,api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',ctx);const data=ctx.data;
const state=n=>({cheers:[{login:'fictional',name:'Demo',kind:'cheer'}],comments:Array.from({length:n},(_,i)=>({id:i,text:'Fictional comment'})),reactions:{cheer:1}});
(async()=>{
 const one=data.read(7),two=data.read(7);assert.equal(one,two);assert.equal(requests.length,1);requests.shift().resolve(state(1));await one;assert.equal(data.peek(7).comments.length,1);await data.read(7);assert.equal(requests.length,0,'a just-completed prefetch is reused');
 now=2000;const old=data.read(7);data.remember(7,state(2));requests.shift().resolve(state(1));assert.equal((await old).comments.length,2,'a late GET cannot overwrite a mutation');
 let updates=0;data.watch(7,fresh=>{updates++;});data.remember(7,state(3));assert.equal(updates,1,'active sheets receive new state without another read');data.remember(7,state(3));assert.equal(updates,1,'identical data does not redraw sheets');
 data.draft(7,'A draft to retain');now=4000;const failure=data.read(7);requests.shift().reject(Object.assign(Error('offline'),{status:503}));await assert.rejects(failure);assert.equal(data.peek(7).comments.length,3);assert.equal(data.draft(7),'A draft to retain');
 const denied=data.read(7);requests.shift().reject(Object.assign(Error('no longer shared'),{status:404}));await assert.rejects(denied);assert.equal(data.peek(7),null,'permission loss clears cached people/comments');assert.equal(data.draft(7),'A draft to retain');
 const late=data.read(7);owner='fictional-session-two';assert.equal(data.peek(7),null);assert.equal(data.draft(7),'');requests.shift().resolve(state(3));assert.equal(await late,null);assert.equal(data.peek(7),null,'late reply never reaches another account/session');
 const invalidated=data.read(7);data.invalidate();const fresh=data.read(7);assert.equal(requests.length,2);requests.shift().resolve(state(1));assert.equal(await invalidated,null);assert.equal(data.read(7),fresh,'old cleanup cannot remove a new pending request');requests.shift().resolve(state(4));await fresh;assert.equal(data.peek(7).comments.length,4);
 const events={};const button={dataset:{},addEventListener:(name,fn)=>events[name]=fn};now=6000;data.warm(button,7);events.pointerdown();events.focus();assert.equal(requests.length,1,'warm and open share one read');requests.shift().resolve(state(4));await new Promise(setImmediate);
 data.remember(11,{...state(1),visibility:'me',details:{map:false},trim_m:800});data.remember(11,state(2));assert.equal(data.peek(11).trim_m,800,'reaction/comment replies preserve existing owner sharing metadata');assert.equal(data.peek(11).details.map,false);
 data.remember(12,state(1));const ownerRead=data.read(12,{ownerDetails:true});assert.equal(requests.length,1,'a summary-only mutation cache cannot replace the owner sharing read');requests.shift().resolve({...state(1),visibility:'me',details:{map:false},trim_m:800});await ownerRead;assert.equal(data.peek(12).trim_m,800);
 let disposed=0;const stop=data.watch(15,()=>{disposed++;});stop();data.remember(15,state(1));assert.equal(disposed,0,'a disposed view no longer receives social updates');
 data.remember(9,{reactions:{cheer:1}});assert.equal(data.peek(9),null,'summary counts are not a complete comments cache');
 // Failed writes may already be saved; never restore an optimistic/previous privacy claim.
 class Node {constructor(){this.children=[];this.hidden=false;this.dataset={};this.isConnected=true;}setAttribute(){}append(...nodes){this.children.push(...nodes);}prepend(node){this.children.unshift(node);}}
 Object.assign(ctx,{document:{createElement:()=>new Node()},AbortController,setTimeout,clearTimeout});
 for(const fault of ['lost reply','offline','503']){
  const root=new Node(),field=new Node(),alreadyHidden=new Node();alreadyHidden.hidden=true;root.append(field,alreadyHidden);
  let saved='me',shown='me',reads=0,writes=0,readable=true;
  ctx.api=async()=>{writes++;assert(field.hidden,'hide private claim before the request');if(fault==='lost reply')saved='everyone';throw Error(fault);};
  ctx.apiRequest=async(path,opts)=>{reads++;assert.equal(opts.cache,'no-store');if(!readable)throw Error('offline');return {visibility:saved};};
  const confirmation=data.confirmSetting(root,{path:'/saved',paint:fresh=>{if(!fresh.visibility)throw Error('invalid');shown=fresh.visibility;}});
  await confirmation.save('/save',{method:'PUT'});assert.equal(shown,saved);assert.equal(field.hidden,false);assert.equal(alreadyHidden.hidden,true);assert.equal(reads,1);
  readable=false;await confirmation.save('/save',{method:'PUT'});assert(field.hidden,'unavailable readback conceals all stale choices');assert.equal(confirmation.known,false);
  const note=root.children[0];assert.equal(note.dataset.sharingState,'unknown');assert.equal(note.children[0].textContent,'Not confirmed. ');assert.equal(note.children[1].hidden,false);
  readable=true;saved='everyone';await note.children[1].onclick();assert.equal(writes,2,'Retry reads without replaying a write');assert.equal(shown,'everyone');assert(confirmation.known);assert(!field.hidden);
 }
 const invalidRoot=new Node(),invalidField=new Node();invalidRoot.append(invalidField);ctx.api=async()=>{};ctx.apiRequest=async()=>({});
 const invalid=data.confirmSetting(invalidRoot,{path:'/saved',paint:fresh=>{if(typeof fresh.enabled!=='boolean')throw Error('invalid');}});await invalid.save('/save',{method:'PUT'});assert(!invalid.known&&invalidField.hidden,'successful transport with invalid readback never paints a private default');
 const root=new Node(),field=new Node();root.append(field);let release,painted=false;
 ctx.api=async()=>{};ctx.apiRequest=()=>new Promise(resolve=>release=resolve);
 const confirmation=data.confirmSetting(root,{path:'/saved',paint:()=>painted=true});
 const saving=confirmation.save('/save',{method:'PUT'});await new Promise(setImmediate);owner='another-fictional-session';release({visibility:'everyone'});await saving;
 assert.equal(painted,false,'late sharing reads never reach another account');assert(field.hidden);
 console.log('Uncertain privacy: committed lost reply/offline/503, concealed unreadable values, GET-only retry and account isolation PASS');
 console.log('Social reads: prefetch/in-flight dedupe, mutation ordering, retained drafts/failures, permission clearing, same-login session isolation and refresh epochs PASS');
})().catch(e=>{console.error(e);process.exit(1)});
