// Exercise the actual account-scoped read coordinator; no server/provider/device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
let owner='fictional-session-one',now=0;const requests=[];
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},App={me:{id:1}},Native={base:''},location={origin:'https://example.test'};
const ctx={App,Native,location,localStorage,newId:require('node:crypto').randomUUID,readOwner:()=>owner,Date:{now:()=>now},Map,Set,Promise,api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',ctx);const data=ctx.data;
const state=n=>({cheers:[{login:'fictional',name:'Demo',kind:'cheer'}],comments:Array.from({length:n},(_,i)=>({id:i,text:'Fictional comment'})),reactions:{cheer:1}});
(async()=>{
 const one=data.read(7),two=data.read(7);assert.equal(one,two);assert.equal(requests.length,1);requests.shift().resolve(state(1));await one;assert.equal(data.peek(7).comments.length,1);await data.read(7);assert.equal(requests.length,0,'a just-completed prefetch is reused');
 now=2000;const old=data.read(7);data.remember(7,state(2));requests.shift().resolve(state(1));assert.equal((await old).comments.length,2,'a late GET cannot overwrite a mutation');
 let updates=0;data.watch(7,fresh=>{updates++;});data.remember(7,state(3));assert.equal(updates,1,'active sheets receive new state without another read');data.remember(7,state(3));assert.equal(updates,1,'identical data does not redraw sheets');
 data.draft(7,'A draft to retain');now=4000;const failure=data.read(7);requests.shift().reject(Object.assign(Error('offline'),{status:503}));await assert.rejects(failure);assert.equal(data.peek(7).comments.length,3);assert.equal(data.draft(7),'A draft to retain');
 const denied=data.read(7);requests.shift().reject(Object.assign(Error('no longer shared'),{status:404}));await assert.rejects(denied);assert.equal(data.peek(7),null,'permission loss clears cached people/comments');assert.equal(data.draft(7),'A draft to retain');
 const late=data.read(7);owner='fictional-session-two';App.me={id:2};assert.equal(data.peek(7),null);assert.equal(data.draft(7),'');requests.shift().resolve(state(3));assert.equal(await late,null);assert.equal(data.peek(7),null,'late reply never reaches another account/session');
 const invalidated=data.read(7);data.invalidate();const fresh=data.read(7);assert.equal(requests.length,2);requests.shift().resolve(state(1));assert.equal(await invalidated,null);assert.equal(data.read(7),fresh,'old cleanup cannot remove a new pending request');requests.shift().resolve(state(4));await fresh;assert.equal(data.peek(7).comments.length,4);
 const events={};const button={dataset:{},addEventListener:(name,fn)=>events[name]=fn};now=6000;data.warm(button,7);events.pointerdown();events.focus();assert.equal(requests.length,1,'warm and open share one read');requests.shift().resolve(state(4));await new Promise(setImmediate);
 data.remember(11,{...state(1),visibility:'me',details:{map:false},trim_m:800});data.remember(11,state(2));assert.equal(data.peek(11).trim_m,800,'reaction/comment replies preserve existing owner sharing metadata');assert.equal(data.peek(11).details.map,false);
 data.remember(12,state(1));const ownerRead=data.read(12,{ownerDetails:true});assert.equal(requests.length,1,'a summary-only mutation cache cannot replace the owner sharing read');requests.shift().resolve({...state(1),visibility:'me',details:{map:false},trim_m:800});await ownerRead;assert.equal(data.peek(12).trim_m,800);
 let disposed=0;const stop=data.watch(15,()=>{disposed++;});stop();data.remember(15,state(1));assert.equal(disposed,0,'a disposed view no longer receives social updates');
 data.remember(9,{reactions:{cheer:1}});assert.equal(data.peek(9),null,'summary counts are not a complete comments cache');
 // Persist the request identity as well as text; no token/session identity enters storage.
 data.draft(70,'Fictional offline draft');const request=data.draftRequest(70,'Fictional offline draft');
 assert(!localStorage.getItem('fit.comment-drafts').includes(owner),'session identity is not persisted');
 const reload={...ctx};vm.createContext(reload);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',reload);
 assert.equal(reload.data.draft(70),'Fictional offline draft','reload restores own-account unsent text');
 assert.equal(reload.data.draftRequest(70,'Fictional offline draft'),request,'reload retry retains original request ID');
 assert.equal(reload.data.draftRequest(70,' Fictional offline draft '),request,'whitespace edit keeps the same server request');
 const changed=reload.data.draftRequest(70,'A different intention');assert.notEqual(changed,request,'edited body gets another request ID');
 reload.data.draft(70,'');assert.equal(reload.data.draft(70),'');assert.equal(localStorage.getItem('fit.comment-drafts'),null,'successful submit clears durable draft');
 data.draft(72,'Do not cross servers');Native.base='https://other.example.test';owner='other-server';assert.equal(data.draft(72),'');assert.equal(localStorage.getItem('fit.comment-drafts'),null,'changing server clears saved drafts');
 data.draft(73,'Expire this draft');now+=7*86400000+1;assert.equal(data.draft(73),'','draft expires after seven days');
 localStorage.setItem('fit.comment-drafts','broken json');assert.equal(data.draft(74),'','corrupt storage does not prevent commenting');
 const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota')};data.draft(74,'Storage unavailable');assert.equal(data.draft(74),'Storage unavailable','quota failure retains memory draft');localStorage.setItem=original;
 console.log('Social reads: prefetch/in-flight dedupe, mutation ordering, retained drafts/failures, permission clearing, same-login session isolation and refresh epochs PASS');
 // Failed writes may already be saved; never restore an optimistic/previous privacy claim.
 class Node {
  constructor(tag='button'){this.tag=tag;this.children=[];this.hidden=false;this.dataset={};this.isConnected=true;this.attrs=new Map();this.style={visibility:''};this.classList={add(){},remove(){}};}
  matches(selector){return selector.includes(this.tag)&&['button','input','select','textarea'].includes(this.tag);}
  querySelectorAll(selector){return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
  contains(node){return this===node||this.children.some(n=>n.contains(node));}
  addEventListener(){}setAttribute(k,v){this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}hasAttribute(k){return this.attrs.has(k);}removeAttribute(k){this.attrs.delete(k);}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parentElement=this;}
  prepend(node){this.children=this.children.filter(n=>n!==node);this.children.unshift(node);node.parentElement=this;}
 }
 const timers=new Map();let timerId=0;
 const fakeTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:now+ms});return id;};
 const advance=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await new Promise(setImmediate);};

 const storage=new Map();ctx.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 ctx.json=(method,body)=>({method,body:JSON.stringify(body)});
 Object.assign(ctx,{window:{scrollX:0,scrollY:0},document:{createElement:tag=>new Node(tag)},AbortController,setTimeout:fakeTimeout,clearTimeout:id=>timers.delete(id)});
 for(const fault of ['lost reply','offline','503']){
  const root=new Node(),field=new Node(),alreadyHidden=new Node();alreadyHidden.hidden=true;root.append(field,alreadyHidden);
  let saved='me',shown='me',reads=0,writes=0,readable=true;
  ctx.api=async()=>{writes++;assert.equal(field.getAttribute('aria-disabled'),'true','affected control blocked before the request');assert.equal(field.hidden,false,'row remains in layout');if(fault==='lost reply')saved='everyone';throw Error(fault);};
  ctx.apiRequest=async(path,opts)=>{reads++;assert.equal(opts.cache,'no-store');if(!readable)throw Error('offline');return {visibility:saved};};
  const confirmation=data.confirmSetting(root,{path:'/saved',paint:fresh=>{if(!fresh.visibility)throw Error('invalid');shown=fresh.visibility;}});
  await confirmation.save('/save',{method:'PUT'});assert(!confirmation.known);assert.equal(reads,0,'no read before the maximum');now+=25001;await confirmation.read();assert.equal(shown,saved);assert.equal(field.hidden,false);assert.equal(alreadyHidden.hidden,true);assert.equal(reads,1);
  readable=false;await confirmation.save('/save',{method:'PUT'});assert.equal(field.getAttribute('aria-disabled'),'true','unavailable readback blocks uncertain controls');assert.equal(confirmation.known,false);
  const note=root.children.find(n=>n.dataset.sharingState);assert.equal(note.dataset.sharingState,'unknown');assert.equal(note.children[0].textContent,'Not confirmed. ');assert.equal(note.children[1].hidden,false);
  readable=true;saved='everyone';await note.children[1].onclick();assert(!confirmation.known,'early Retry never paints old private');assert.equal(note.dataset.sharingState,'checking');await advance(25001);assert.equal(writes,2,'Retry reads without replaying a write');assert.equal(shown,'everyone');assert(confirmation.known);assert.equal(field.getAttribute('aria-disabled'),null);
 }
 now+=25001;
 const invalidRoot=new Node(),invalidField=new Node();invalidRoot.append(invalidField);ctx.api=async()=>{};ctx.apiRequest=async()=>({});
 const invalid=data.confirmSetting(invalidRoot,{path:'/saved',paint:fresh=>{if(typeof fresh.enabled!=='boolean')throw Error('invalid');}});await invalid.save('/save',{method:'PUT'});assert(!invalid.known&&invalidField.getAttribute('aria-disabled')==='true','successful transport with invalid readback never paints a private default');
 const root=new Node(),field=new Node();root.append(field);let release,painted=false;
 ctx.api=async()=>{};ctx.apiRequest=()=>new Promise(resolve=>release=resolve);
 const confirmation=data.confirmSetting(root,{path:'/saved',paint:()=>painted=true});
 const saving=confirmation.save('/save',{method:'PUT'});await new Promise(setImmediate);owner='another-fictional-session';release({visibility:'everyone'});await saving;
 assert.equal(painted,false,'late sharing reads never reach another account');assert.equal(field.getAttribute('aria-disabled'),'true');
 // The timestamp expires without a status/reservation GET. Navigation shares only the deadline.
 owner='deadline-session';let serverValue='me',sent=0,savedReads=0;
 ctx.api=async()=>{sent++;throw Error('HTTP timeout');};ctx.apiRequest=async()=>{savedReads++;return {visibility:serverValue};};
 const oldRoot=new Node();oldRoot.append(new Node());
 const timed=data.confirmSetting(oldRoot,{path:'/saved',paint:r=>serverValue=r.visibility});
 await timed.save('/save',{method:'PUT'});assert(!timed.known&&oldRoot.children[0].getAttribute('aria-disabled')==='true');assert.equal(savedReads,0);
 oldRoot.isConnected=false;const newRoot=new Node(),newField=new Node();newRoot.append(newField);let shownValue=null;
 const reopened=data.confirmSetting(newRoot,{path:'/saved',paint:r=>shownValue=r.visibility});
 assert(newField.getAttribute('aria-disabled')==='true'&&!reopened.known,'navigation cannot instantiate a private claim during uncertainty');
 await newRoot.children.find(n=>n.dataset.sharingState).children[1].onclick();assert.equal(sent,1);assert.equal(savedReads,0,'early Retry does not read stale private');
 serverValue='everyone';now+=25001;await newRoot.children.find(n=>n.dataset.sharingState).children[1].onclick();
 assert.equal(shownValue,'everyone');assert(reopened.known&&!newField.hidden);assert.equal(sent,1);
 // Full script reload, same storage: expiry alone recovers without a reservation or status endpoint.
 ctx.api=async()=>{sent++;throw Error('lost');};await reopened.save('/save',{method:'PUT'});
 vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8').replace('const SocialData=', 'globalThis.reloadedData='),ctx);
 const reloadRoot=new Node(),reloadField=new Node();reloadRoot.append(reloadField);let reloadedPaint=null;
 const reloaded=ctx.reloadedData.confirmSetting(reloadRoot,{path:'/saved',paint:r=>reloadedPaint=r.visibility});
 assert.equal(reloadField.getAttribute('aria-disabled'),'true');await reloaded.read();assert.equal(reloadedPaint,null);
 now+=25001;await reloaded.read();assert.equal(reloadedPaint,'everyone');assert.equal(sent,2);
 // A stale read from an earlier helper cannot replace a later operation.
 owner='late-read-session';ctx.api=async()=>{};let releaseRead;
 ctx.apiRequest=()=>new Promise(resolve=>releaseRead=resolve);
 const earlyRoot=new Node();earlyRoot.append(new Node());let stalePaint=false;
 const early=data.confirmSetting(earlyRoot,{path:'/saved',paint:()=>stalePaint=true});
 const firstRead=early.read();await new Promise(setImmediate);
 ctx.apiRequest=async()=>({visibility:'me'});
 const laterRoot=new Node();laterRoot.append(new Node());let latestPaint=false;
 const later=data.confirmSetting(laterRoot,{path:'/saved',paint:()=>latestPaint=true});await later.save('/save',{method:'PUT'});
 releaseRead({visibility:'everyone'});await firstRead;assert(latestPaint);assert(!stalePaint);
 owner='unknown-repaint-session';let retryWrites=0;ctx.api=async()=>{retryWrites++;throw Error('lost reply');};ctx.apiRequest=async()=>({visibility:'everyone'});
 const uncertainRoot=new Node();uncertainRoot.append(new Node());const uncertainSetting=data.confirmSetting(uncertainRoot,{path:'/saved',paint:()=>{}});
 await uncertainSetting.save('/save',{method:'POST'});now+=25001;await uncertainSetting.save('/save',{method:'POST'});
 assert.equal(retryWrites,1,'an expired deadline permits readback, never a new write from an uncertain repainted control');assert(uncertainSetting.known);
 owner='replacement-session';ctx.api=async()=>{};ctx.apiRequest=async()=>({visibility:'everyone'});
 const sameRoot=new Node(),sameField=new Node();sameRoot.append(sameField);
 data.confirmSetting(sameRoot,{path:'/saved',paint:()=>{}});
 const replacement=data.confirmSetting(sameRoot,{path:'/saved',paint:()=>{}});await replacement.save('/save',{method:'PUT'});
 assert(replacement.known);assert.equal(sameField.getAttribute('aria-disabled'),null,'a retired helper cannot leave replacement controls locked');
 // Retry retains the original requested value/error, and compares it with saved state.
 for(const [path,body,saved] of [
  ['/api/sharing',{default:'me'},{sharing:{default:'everyone'}}],
  ['/api/sharing',{details:{map:false}},{details:{map:true}}],
  ['/api/contacts/settings',{find_by_phone:false},{contacts:{find_by_phone:true}}],
  ['/api/card',{photo:false},{card:{photo:true}}],
  ['/api/profile',{ai_ok:false},{ai_ok:true}],
  ['/api/groups/demo/sharing',{level:'just_in'},{sharing_level:'total_shared'}],
  ['/api/groups/demo/recap-consent',{consent:false},{recap_consent:true}],
 ]){
  owner='rejected-'+path;let submitted=0;const target=new Node();target.append(new Node());
  const error=Object.assign(Error('Fictional rejected choice'),{status:400});
  ctx.api=async()=>{submitted++;throw error;};ctx.apiRequest=async()=>saved;
  const changes=data.confirmSetting(target,{path,paint:()=>{}}),options=ctx.json('PUT',body);
  await changes.save(path,options);assert.equal(changes.failure,error);
  const requested=changes.attempted;now+=25001;const note=target.children.find(n=>n.dataset.sharingState);
  await note.children[1].onclick();assert(changes.known,'readback confirms the stored value, not the rejected attempt');
  assert.equal(changes.attempted,requested,'Retry keeps the attempted change');assert.equal(changes.attempted.options,options);
  assert.match(changes.failure.message,/Not saved/);assert.equal(changes.attempted.error,error,'original write error survives readback');assert.equal(note.hidden,false);
  assert.match(note.children[0].textContent,/Not saved/);assert.equal(submitted,1,'Retry only reads');
 }
 owner='matched-lost-reply';const matchRoot=new Node();matchRoot.append(new Node());
 ctx.api=async()=>{throw Error('Lost reply');};ctx.apiRequest=async()=>({visibility:'everyone'});
 const matched=data.confirmSetting(matchRoot,{path:'/saved',paint:()=>{}});await matched.save('/save',ctx.json('PUT',{visibility:'everyone'}));now+=25001;
 const confirmed=await matched.read();assert.equal(confirmed.failure,null,'a saved requested value wins over a lost transport reply');assert.equal(matched.failure,null);
 owner='successful-mismatch';const mismatchRoot=new Node();mismatchRoot.append(new Node());ctx.api=async()=>{};ctx.apiRequest=async()=>({visibility:'everyone'});
 const mismatch=data.confirmSetting(mismatchRoot,{path:'/saved',paint:()=>{}});await mismatch.save('/save',ctx.json('PUT',{visibility:'me'}));
 assert.match(mismatch.failure.message,/Not saved/,'a successful HTTP reply cannot conceal a mismatched saved value');
 const replaced=data.confirmSetting(mismatchRoot,{path:'/saved',paint:()=>{}});assert.match(replaced.failure.message,/Not saved/,'same-surface repaints retain the rejected attempt');
 owner='different-repaint-account';const clean=data.confirmSetting(mismatchRoot,{path:'/saved',paint:()=>{}});assert.equal(clean.failure,null,'an account switch never inherits another account attempt or error');
 console.log('Rejected settings: requested value and error survive GET-only Retry; mismatches stay visible, committed lost replies confirm PASS');
 owner='storage-unavailable-session';const blockedRoot=new Node();blockedRoot.append(new Node());let blockedWrites=0;
 ctx.localStorage.setItem=()=>{throw Error('Storage blocked');};ctx.api=async()=>blockedWrites++;
 const blocked=data.confirmSetting(blockedRoot,{path:'/saved',paint:()=>{}});await blocked.save('/save',{method:'PUT'});
 assert.equal(blockedWrites,0,'expiry must persist before a possibly-outstanding write');
 console.log('Expiring uncertainty: delayed readback, early GET-only Retry, navigation/full reload, stale-owner/read guards PASS');
 console.log('Uncertain privacy: lost reply/offline/503, stable disabled controls, same-account dismissal cache recovery PASS');
 console.log('Social reads/cache/drafts/account isolation PASS');
})().catch(e=>{console.error(e);process.exit(1)});
