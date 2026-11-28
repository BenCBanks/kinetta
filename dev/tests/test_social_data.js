// Exercise the actual account-scoped read coordinator; no server/provider/device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
let owner='fictional-session-one',now=0;const requests=[];
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),get length(){return storage.size;},key:i=>[...storage.keys()][i]??null},App={me:{id:1}},Native={base:''},location={origin:'https://example.test'};
const ctx={App,Native,location,localStorage,newId:require('node:crypto').randomUUID,readOwner:()=>owner,Date:{now:()=>now},Map,Set,Promise,api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',ctx);const data=ctx.data;
const draftKeys=()=>[...storage.keys()].filter(k=>k.startsWith('fit.comment-draft:'));
const entryKey=id=>draftKeys().find(k=>k.endsWith(':'+id));
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
 assert(!localStorage.getItem(entryKey(70)).includes(owner),'session identity is not persisted');
 const reload={...ctx};vm.createContext(reload);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',reload);
 assert.equal(reload.data.draft(70),'Fictional offline draft','reload restores own-account unsent text');
 assert.equal(reload.data.draftRequest(70,'Fictional offline draft'),request,'reload retry retains original request ID');
 assert.equal(reload.data.draftRequest(70,' Fictional offline draft '),request,'whitespace edit keeps the same server request');
 const changed=reload.data.draftRequest(70,'A different intention');assert.notEqual(changed,request,'edited body gets another request ID');
 reload.data.draft(70,'');assert.equal(reload.data.draft(70),'');assert.equal(entryKey(70),undefined,'successful submit clears only that activity key');
 data.draft(72,'Do not cross servers');Native.base='https://other.example.test';owner='other-server';assert.equal(data.draft(72),'');assert.equal(data.draft(70),'','changing server cannot read another server account namespace');
 data.draft(73,'Expire this draft');now+=7*86400000+1;assert.equal(data.draft(73),'','draft expires after seven days');
 localStorage.setItem(entryKey(73),'broken json');assert.equal(data.draft(74),'','corrupt storage does not prevent commenting');
 const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota')};data.draft(74,'Storage unavailable');assert.equal(data.draft(74),'Storage unavailable','quota failure retains memory draft');localStorage.setItem=original;
 // Existing storage must not roll back newer memory when quota rejects subsequent writes.
 data.draft(75,'Old persisted intention');const oldKey=data.draftRequest(75,'Old persisted intention');
 localStorage.setItem=()=>{throw Error('quota');};
 const changedKey=data.draftRequest(75,'New fictional intention');assert.notEqual(changedKey,oldKey);
 for(let i=0;i<4;i++)assert.equal(data.draftRequest(75,'New fictional intention'),changedKey,'quota retry never mints another ID');
 data.draft(75,'');assert.equal(data.draft(75),'','failed persistence cannot resurrect a cleared in-memory draft');
 localStorage.setItem=original;
 // Two tabs sharing storage. Test the synchronous fence before delivering the storage event.
 const listeners=[];
 function tab(extra={}){const t={...ctx,...extra,addEventListener:(name,fn)=>{if(name==='storage')listeners.push(fn);}};vm.createContext(t);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8')+'\nglobalThis.data=SocialData;',t);return t;}
 const parallelOne=tab(),parallelTwo=tab();parallelOne.data.peek(99);parallelTwo.data.peek(99);parallelOne.data.draft(99,'First tab');assert.equal(parallelTwo.data.draft(99,'Second tab'),'Second tab','opening a second tab is not a sign-out');
 // Both tabs hydrate before either types; each write must preserve the other activity.
 const activityA=tab(),activityB=tab();activityA.data.draft(101);activityB.data.draft(102);
 const aKey=activityA.data.draftRequest(101,'Fictional draft A'),bKey=activityB.data.draftRequest(102,'Fictional draft B');
 let restored=tab();assert.equal(restored.data.draft(101),'Fictional draft A','typing B cannot erase A');assert.equal(restored.data.draft(102),'Fictional draft B');
 assert.equal(restored.data.draftRequest(101,'Fictional draft A'),aKey);assert.equal(restored.data.draftRequest(102,'Fictional draft B'),bKey);
 // A peer with an old in-memory copy must not restore a draft cleared elsewhere.
 activityA.data.draft(101,'');restored.data.draft(102,'Fictional revised B');
 assert.equal(tab().data.draft(101),'','writing B cannot resurrect cleared A');
 // Quota retries touch only their activity and retain identity alongside a peer's draft.
 const writeDraft=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};
 const pendingKey=activityA.data.draftRequest(103,'Fictional pending A');localStorage.setItem=writeDraft;
 activityB.data.draft(104,'Fictional separate B');assert.equal(activityA.data.draftRequest(103,'Fictional pending A'),pendingKey);
 restored=tab();assert.equal(restored.data.draftRequest(103,'Fictional pending A'),pendingKey);assert.equal(restored.data.draft(104),'Fictional separate B');
 for(const reason of ['sign-out','deletion'])for(const quota of [false,true]){
   const clearer=tab(),peer=tab();peer.data.draft(81,'Old-tab '+reason+' text');
   const before=localStorage.getItem('fit.comment-drafts-generation');assert(before);
   const write=localStorage.setItem;
   if(quota)localStorage.setItem=(k,v)=>{if(k==='fit.comment-drafts-generation')throw Error('quota during clear');return write(k,v);};
   const helper=fs.readFileSync('app/static/app.js','utf8').split('function clearCommentDrafts() {')[1].split('\nlet pendingDishEntry')[0];
   vm.runInContext('function clearCommentDrafts() {'+helper+'\nclearCommentDrafts();',clearer);
   localStorage.setItem=write;
   assert.notEqual(localStorage.getItem('fit.comment-drafts-generation'),before,'clear changes or removes the fence even under quota');
   assert.equal(peer.data.draft(81,'Must never be rewritten'),'');
   assert.equal(peer.data.draftRequest(81,'Must never send'),null);
   assert.deepEqual(draftKeys(),[],'stale tab cannot repopulate cleared disk state before event delivery');
   listeners.forEach(fn=>fn({key:'fit.comment-drafts-generation'}));
   assert.equal(peer.data.draft(81),'','clear event removes memory');
   assert.equal(clearer.data.draft(81,'Still stale'),'','cleared session stays revoked');
 }
 // Deterministically interleave another tab inside set/remove, before the first operation commits.
 const writerA=tab(),writerB=tab();writerA.data.draft(201);writerB.data.draft(202);
 const setBeforeRace=localStorage.setItem;let interleaved=false;
 localStorage.setItem=(k,v)=>{if(k.startsWith('fit.comment-draft:')&&!interleaved){interleaved=true;writerB.data.draft(202,'Interleaved B');}return setBeforeRace(k,v);};
 writerA.data.draft(201,'Interleaved A');localStorage.setItem=setBeforeRace;
 assert.equal(tab().data.draft(201),'Interleaved A');assert.equal(tab().data.draft(202),'Interleaved B','interleaved writes never replace another activity');
 // Delete A inside B's write: B must not resurrect A from stale memory.
 const stale=tab();stale.data.draft(201);interleaved=false;
 localStorage.setItem=(k,v)=>{if(k.startsWith('fit.comment-draft:')&&!interleaved){interleaved=true;writerA.data.draft(201,'');}return setBeforeRace(k,v);};
 stale.data.draft(202,'B during A deletion');localStorage.setItem=setBeforeRace;
 assert.equal(tab().data.draft(201),'');assert.equal(tab().data.draft(202),'B during A deletion');
 // Write B inside A's delete: removing A must not remove B's new value.
 writerA.data.draft(201,'A before delete');const removeBeforeRace=localStorage.removeItem;interleaved=false;
 localStorage.removeItem=k=>{if(k===entryKey(201)&&!interleaved){interleaved=true;writerB.data.draft(202,'B during removal');}return removeBeforeRace(k);};
 writerA.data.draft(201,'');localStorage.removeItem=removeBeforeRace;
 assert.equal(tab().data.draft(201),'');assert.equal(tab().data.draft(202),'B during removal');
 // An old-session write cannot clobber or remove a newer session's same-activity key.
 const racing=tab();racing.data.draft(83,'Prior session draft');const oldStoredKey=entryKey(83),writeBeforeClear=localStorage.setItem;
 const newerKey=oldStoredKey.replace(':'+encodeURIComponent(localStorage.getItem('fit.comment-drafts-generation'))+':',':new-session:');
 const newer=JSON.stringify({text:'Current session draft',client_id:require('node:crypto').randomUUID(),at:now});
 localStorage.setItem=(k,v)=>{writeBeforeClear(k,v);if(k===oldStoredKey){writeBeforeClear('fit.comment-drafts-generation','new-session');writeBeforeClear(newerKey,newer);}};
 assert.equal(racing.data.draftRequest(83,'Prior session retry'),null);localStorage.setItem=writeBeforeClear;
 assert.equal(localStorage.getItem(oldStoredKey),null);assert.equal(localStorage.getItem(newerKey),newer,'stale cleanup cannot remove a newer session write');
 // Scan bounds/expiry/corruption apply only to the current account/session namespace.
 storage.clear();const bounded=tab();
 for(let id=3000;id<3041;id++){now++;bounded.data.draft(id,'Bounded fictional '+id);}
 assert.equal(draftKeys().length,41,'fallback skips cap eviction');assert(entryKey(3000));assert(entryKey(3040));
 const latestKey=entryKey(3040),latest=JSON.parse(localStorage.getItem(latestKey));
 const expiredKey=latestKey.replace(':3040',':9998'),corruptKey=latestKey.replace(':3040',':9999');
 localStorage.setItem(expiredKey,JSON.stringify({...latest,at:now-7*86400000}));localStorage.setItem(corruptKey,'broken json');
 const anotherAccount=latestKey.replace(encodeURIComponent(JSON.stringify([Native.base||location.origin,App.me.id])),encodeURIComponent(JSON.stringify([Native.base||location.origin,999])));
 localStorage.setItem(anotherAccount,JSON.stringify({...latest,text:'Other account fictional draft'}));
 const scanned=tab();assert.equal(scanned.data.draft(3040),'Bounded fictional 3040');assert.equal(scanned.data.draft(9998),'');
 assert.equal(localStorage.getItem(expiredKey),null);assert.equal(localStorage.getItem(corruptKey),'broken json','fallback does not remove an unverified corrupt key');assert(localStorage.getItem(anotherAccount),'scan does not delete other account keys');
 assert.equal(localStorage.getItem('fit.comment-drafts'),null,'no shared draft map is stored');
 assert(!draftKeys().some(k=>decodeURIComponent(k).includes(owner)),'storage keys never contain the session token');
 const clearSource=fs.readFileSync('app/static/app.js','utf8').split('function clearCommentDrafts() {')[1].split('\nlet pendingDishEntry')[0];
 App.me=null;vm.runInContext('function clearCommentDrafts() {'+clearSource+'\nclearCommentDrafts();',scanned);
 assert.deepEqual(draftKeys(),[],'sign-out clears all account namespaces, including when App.me is already gone');
 App.me={id:2};
 // Fallback expiry rechecks the value immediately before removal.
 storage.clear();const expiry=tab();expiry.data.draft(401,'Expired candidate');const expiryKey=entryKey(401);
 now+=7*86400000+1;const freshValue=JSON.stringify({text:'Peer rewrote expired draft',client_id:require('node:crypto').randomUUID(),at:now});
 const readBeforeExpiry=localStorage.getItem;let expiryReads=0;
 localStorage.getItem=k=>{if(k===expiryKey&&++expiryReads===3)localStorage.setItem(k,freshValue);return readBeforeExpiry(k);};
 tab().data.draft(402);localStorage.getItem=readBeforeExpiry;
 assert.equal(localStorage.getItem(expiryKey),freshValue,'expiry must not remove a value changed before its final read');
 // All content writes and cleanup run under the same shared Web Lock.
 storage.clear();let lockTail=Promise.resolve(),held=false;
 const locks={request:(name,fn)=>{assert.equal(name,'fit.comment-drafts');const job=lockTail.then(async()=>{held=true;try{return await fn();}finally{held=false;}});lockTail=job.catch(()=>{});return job;}};
 const lockedOne=tab({navigator:{locks}}),lockedTwo=tab({navigator:{locks}}),setUnlocked=localStorage.setItem,removeUnlocked=localStorage.removeItem;
 const contentKey=k=>k==='fit.comment-drafts'||k.startsWith('fit.comment-draft:');
 localStorage.setItem=(k,v)=>{if(contentKey(k))assert(held,'draft writes require the shared lock');return setUnlocked(k,v);};
 localStorage.removeItem=k=>{if(contentKey(k))assert(held,'cleanup requires the shared lock');return removeUnlocked(k);};
 for(let id=5000;id<5041;id++){now++;lockedOne.data.draft(id,'Locked draft '+id);}
 await lockedOne.data.draftsSettled();assert.equal(draftKeys().length,40);assert.equal(entryKey(5000),undefined);
 let unlock,entered;const admitted=new Promise(r=>entered=r),holding=locks.request('fit.comment-drafts',()=>{entered();return new Promise(r=>unlock=r);});await admitted;
 now++;lockedTwo.data.draft(5001,'Peer refreshed oldest');now++;lockedOne.data.draft(5041,'New draft triggers cleanup');
 assert.equal(JSON.parse(localStorage.getItem(entryKey(5001))).text,'Locked draft 5001','writer waits behind an existing lock');
 unlock();await holding;await Promise.all([lockedOne.data.draftsSettled(),lockedTwo.data.draftsSettled()]);
 assert.equal(JSON.parse(localStorage.getItem(entryKey(5001))).text,'Peer refreshed oldest','cleanup cannot evict a just-rewritten draft');assert.equal(draftKeys().length,40);
 let releaseClear,readyClear;const clearReady=new Promise(r=>readyClear=r),heldClear=locks.request('fit.comment-drafts',()=>{readyClear();return new Promise(r=>releaseClear=r);});await clearReady;
 lockedOne.data.draft(6000,'Queued before sign-out');
 const clearing=vm.runInContext('function clearCommentDrafts() {'+clearSource+'\nclearCommentDrafts();',lockedOne);
 assert.equal(lockedOne.data.draftRequest(6000,'Cannot persist after sign-out'),null,'generation fences before lock admission');
 releaseClear();await heldClear;await clearing;await lockedOne.data.draftsSettled();
 assert.deepEqual(draftKeys(),[],'queued old writes cannot survive locked sign-out cleanup');
 localStorage.setItem=setUnlocked;localStorage.removeItem=removeUnlocked;
 // A first draft with a completely unavailable store remains stable in memory,
 // and cannot later write unfenced text after another tab clears the account.
 storage.clear();
 const write=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};const memoryOnly=tab();
 const memoryKey=memoryOnly.data.draftRequest(82,'Memory-only fictional draft');assert(memoryKey);
 for(let i=0;i<4;i++)assert.equal(memoryOnly.data.draftRequest(82,'Memory-only fictional draft'),memoryKey);
 localStorage.setItem=write;memoryOnly.data.draft(82,'Memory-only fictional draft');
 assert.deepEqual(draftKeys(),[],'restored quota cannot persist a session without a clearing fence');
 console.log('Social reads: prefetch/in-flight dedupe, mutation ordering, retained drafts/failures, permission clearing, same-login session isolation and refresh epochs PASS');
 { // Keep privacy fixture storage separate from the preceding draft fixtures.
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
 // Admission feedback remains visible while saved-state recovery forbids replay.
 for(const status of [429,503]){
  const root=new Node(),field=new Node();root.append(field);let writes=0,reads=0;
  const message=status===429?'Too many requests. Try again in 37 seconds.':'Kinetta is busy. Try again in 2 seconds.';
  ctx.api=async()=>{writes++;throw Object.assign(Error(message),{status,retryAfter:status===429?37:2});};
  ctx.apiRequest=async()=>{reads++;return {visibility:'me'};};
  const recovery=data.confirmSetting(root,{path:'/saved',paint:()=>{}});
  await recovery.save('/save',{method:'PUT'});
  const note=root.children.find(n=>n.dataset.sharingState);
  assert.equal(note.children[0].textContent,message+' ','show the numeric retry delay immediately');
  assert.equal(field.getAttribute('aria-disabled'),'true');assert.equal(reads,0);assert(!recovery.known);
  await recovery.save('/save',{method:'PUT'});assert.equal(writes,1,'a retry cannot bypass saved-state admission');
  await advance(25001);await recovery.read();assert.equal(writes,1);assert(reads>0);assert(recovery.known);
 }
 // Memory/profile surfaces redraw children after a confirmed read; the next uncertainty must still be recoverable.
 const redrawRoot=new Node();redrawRoot.append(new Node());let readableAgain=true;
 ctx.api=async()=>{};ctx.apiRequest=async()=>{if(!readableAgain)throw Error('offline');return {enabled:true};};
 const redraw=data.confirmSetting(redrawRoot,{path:'/saved',paint:()=>{},after:()=>{redrawRoot.children.forEach(n=>n.parentElement=null);redrawRoot.children=[];redrawRoot.append(new Node());}});
 await redraw.read();readableAgain=false;await redraw.save('/save',{method:'PUT'});
 const redrawNote=redrawRoot.children.find(n=>n.dataset.sharingState);assert.equal(redrawNote.dataset.sharingState,'unknown','redraw does not lose the retry status');
 readableAgain=true;now+=25001;await redrawNote.children[1].onclick();assert(redraw.known,'redrawn roots recover through GET only');
 const invalidRoot=new Node(),invalidField=new Node();invalidRoot.append(invalidField);ctx.api=async()=>{};ctx.apiRequest=async()=>({});
 const invalid=data.confirmSetting(invalidRoot,{path:'/saved',paint:fresh=>{if(typeof fresh.enabled!=='boolean')throw Error('invalid');}});await invalid.save('/save',{method:'PUT'});assert(!invalid.known&&invalidField.getAttribute('aria-disabled')==='true','successful transport with invalid readback never paints a private default');
 now+=25001;
 const detachedRoot=new Node();detachedRoot.append(new Node());let settle,cacheValue=null,detachedPaint=false;
 ctx.api=()=>new Promise(resolve=>settle=resolve);ctx.apiRequest=async()=>({enabled:true});
 const detached=data.confirmSetting(detachedRoot,{path:'/saved',cache:fresh=>cacheValue=fresh.enabled,paint:()=>detachedPaint=true});
 const detaching=detached.save('/save',{method:'PUT'});await new Promise(setImmediate);detachedRoot.isConnected=false;settle();await detaching;
 assert.equal(cacheValue,true,'same-account saved consent reconciles even after dismissal');assert(!detachedPaint,'dismissed UI is never painted');
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
 owner='restored-group-choice';const restoredRoot=new Node();restoredRoot.append(new Node());let restoredWrites=0;
 ctx.api=async()=>{restoredWrites++;};ctx.apiRequest=async()=>({member:true,share_total:true});
 const initialAttempt={path:'/api/group-invites/fictional/accept',options:ctx.json('POST',{share_total:false}),error:null};
 const restoredChoice=data.confirmSetting(restoredRoot,{path:'/state',initialAttempt,paint:()=>{}});await restoredChoice.read();
 assert.match(restoredChoice.failure.message,/Not saved/);assert.equal(restoredChoice.attempted,initialAttempt);assert.equal(restoredWrites,0,'restored choice is reconciled with GET only');
 ctx.apiRequest=async()=>({member:true,share_total:false});await restoredChoice.read();assert.equal(restoredChoice.failure,null);assert.equal(restoredWrites,0);
 console.log('Rejected settings: requested value and error survive GET-only Retry; mismatches stay visible, committed lost replies confirm PASS');
 owner='storage-unavailable-session';const blockedRoot=new Node();blockedRoot.append(new Node());let blockedWrites=0;
 ctx.localStorage.setItem=()=>{throw Error('Storage blocked');};ctx.api=async()=>blockedWrites++;
 const blocked=data.confirmSetting(blockedRoot,{path:'/saved',paint:()=>{}});await blocked.save('/save',{method:'PUT'});
 assert.equal(blockedWrites,0,'expiry must persist before a possibly-outstanding write');
 console.log('Expiring uncertainty: delayed readback, early GET-only Retry, navigation/full reload, stale-owner/read guards PASS');
 console.log('Uncertain privacy: lost reply/offline/503, stable disabled controls, same-account dismissal cache recovery PASS');
 const persisted=new Map(),choiceContext={Native:{base:''},location:{origin:'https://example.test'},App:{me:{id:1}},localStorage:{getItem:k=>persisted.get(k)||null,setItem:(k,v)=>persisted.set(k,v),removeItem:k=>persisted.delete(k)}};
 vm.createContext(choiceContext);const socialSource=fs.readFileSync('app/static/social.js','utf8');
 vm.runInContext(socialSource.slice(socialSource.indexOf('function groupInvitationChoice('),socialSource.indexOf('function recoverGroupInvitation(')),choiceContext);
 const choose=choiceContext.groupInvitationChoice,invite='/api/group-invites/fictional';choose(invite,{action:'accept',share_total:false});
 assert.equal(choose(invite).share_total,false);assert.equal(choose('/api/group-friend-invites/77'),null,'invite paths have independent choices');
 choiceContext.App.me.id=2;assert.equal(choose(invite),null,'another account cannot inherit the sharing choice');choiceContext.App.me.id=1;choiceContext.Native.base='https://other.example.test';assert.equal(choose(invite),null,'server scopes remain separate');choiceContext.Native.base='';
 const reloadedContext=vm.createContext({...choiceContext});vm.runInContext(socialSource.slice(socialSource.indexOf('function groupInvitationChoice('),socialSource.indexOf('function recoverGroupInvitation(')),reloadedContext);assert.equal(reloadedContext.groupInvitationChoice(invite).share_total,false,'fresh helper restores an explicit off');
 choose(invite,null);assert.equal(choose(invite),null);choiceContext.localStorage.setItem=()=>{throw Error('Quota exceeded');};assert.throws(()=>choose(invite,{action:'accept',share_total:true}),/Quota/);
 console.log('Social reads/cache/drafts/account isolation PASS');
 }
})().catch(e=>{console.error(e);process.exit(1)});
