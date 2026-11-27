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
 class Node {constructor(){this.children=[];this.hidden=false;this.dataset={};this.isConnected=true;}setAttribute(){}append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parentElement=this;}prepend(node){this.children=this.children.filter(n=>n!==node);this.children.unshift(node);node.parentElement=this;}}
 // Default ticket protocol stand-in; cases below still exercise the real coordinator.
 let providerRead,protocolRead=async()=>({settled:true}),ticketNumber=0,protocolReserve=async()=>({ticket:'fictional-ticket-'+(++ticketNumber)});
 Object.defineProperty(ctx,'apiRequest',{configurable:true,set:fn=>providerRead=fn,get:()=>async(path,options)=>{
  if(path==='/api/privacy-save')return protocolReserve();
  if(path.startsWith('/api/privacy-save?'))return protocolRead(path);
  return providerRead(path,options);
 }});
 ctx.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
 ctx.json=(method,body)=>({method,body:JSON.stringify(body)});
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
 // An aborted HTTP wait says nothing about whether the server endpoint is still running.
 owner='deadline-session';let outstanding=true,serverValue='me',sent=0;
 protocolRead=async()=>{if(outstanding)throw Error('pending server transaction');return {settled:true};};
 ctx.api=async()=>{sent++;throw Error('HTTP timeout');};ctx.apiRequest=async()=>({visibility:serverValue});
 const oldRoot=new Node();oldRoot.append(new Node());
 const timed=data.confirmSetting(oldRoot,{path:'/saved',paint:r=>serverValue=r.visibility});
 await timed.save('/save',{method:'PUT'});assert(!timed.known&&oldRoot.children[1].hidden);
 oldRoot.isConnected=false;const newRoot=new Node(),newField=new Node();newRoot.append(newField);let shownValue=null;
 const reopened=data.confirmSetting(newRoot,{path:'/saved',paint:r=>shownValue=r.visibility});await new Promise(setImmediate);
 assert(newField.hidden&&!reopened.known,'navigation cannot instantiate an independent private claim');
 await newRoot.children[0].children[1].onclick();assert.equal(sent,1,'Retry while an old write is pending is GET-only');
 assert.equal(shownValue,null,'old private snapshot is never painted while public can still commit');
 serverValue='everyone';outstanding=false;await newRoot.children[0].children[1].onclick();
 assert.equal(shownValue,'everyone');assert(reopened.known&&!newField.hidden);assert.equal(sent,1);
 // Late reservations/reads from an earlier helper must not replace the newer account fence.
 let releaseReservation;protocolReserve=()=>new Promise(resolve=>releaseReservation=resolve);
 const earlyRoot=new Node();earlyRoot.append(new Node());let stalePaint=false;
 const early=data.confirmSetting(earlyRoot,{path:'/saved',paint:()=>stalePaint=true});
 const firstWrite=early.save('/save',{method:'PUT'});await new Promise(setImmediate);
 protocolReserve=async()=>({ticket:'latest-ticket'});ctx.api=async()=>{sent++;};
 const laterRoot=new Node();laterRoot.append(new Node());let latestPaint=false;
 const later=data.confirmSetting(laterRoot,{path:'/saved',paint:()=>latestPaint=true});
 await new Promise(setImmediate);await later.save('/save',{method:'PUT'});
 releaseReservation({ticket:'earlier-ticket'});await firstWrite;
 assert(latestPaint);assert(!stalePaint,'old helper cannot paint after a newer operation');assert.equal(sent,2,'late reservation never dispatches its obsolete write');
 owner='storage-unavailable-session';const blockedRoot=new Node();blockedRoot.append(new Node());let blockedWrites=0;
 ctx.localStorage.setItem=()=>{throw Error('Storage blocked');};ctx.api=async()=>blockedWrites++;
 const blocked=data.confirmSetting(blockedRoot,{path:'/saved',paint:()=>{}});await blocked.save('/save',{method:'PUT'});
 assert.equal(blockedWrites,0,'a ticket must persist before dispatching a write that could outlive reload');
 ctx.localStorage.setItem=()=>{};
 console.log('Outstanding write fences: timeout + navigation + GET-only Retry + stale reservation ordering PASS');
 console.log('Uncertain privacy: committed lost reply/offline/503, concealed unreadable values, GET-only retry and account isolation PASS');
 console.log('Social reads: prefetch/in-flight dedupe, mutation ordering, retained drafts/failures, permission clearing, same-login session isolation and refresh epochs PASS');
})().catch(e=>{console.error(e);process.exit(1)});
