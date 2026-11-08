// Permanent food conversation. Numbers and writes stay in authenticated server code;
// the outbox keeps user intent durable before clearing the composer.
'use strict';
// Keep a texting conversation at the latest message through keyboard/composer
// resizes, unless the person deliberately scrolls back to read older messages.
function foodChatViewport({list,composer,field,send,active,resizeField=()=>{}}) {
  let following=true,frame,touchY=null;
  const events=new AbortController(),options={passive:true,signal:events.signal};
  const pin=(force=false)=>{
    if(force)following=true;
    if(!following||!active())return;
    list.scrollTop=list.scrollHeight;
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(following&&active())list.scrollTop=list.scrollHeight;});
  };
  send.addEventListener('pointerdown',e=>{if(e.button===0&&e.isPrimary!==false&&document.activeElement===field)e.preventDefault();},{signal:events.signal});
  list.addEventListener('wheel',e=>{if(e.deltaY<0)following=false;},options);
  list.addEventListener('touchstart',e=>{touchY=e.touches.length===1?e.touches[0].clientY:null;},options);
  list.addEventListener('touchmove',e=>{if(touchY!==null&&e.touches.length===1){if(e.touches[0].clientY-touchY>6)following=false;touchY=e.touches[0].clientY;}},options);
  list.addEventListener('scroll',()=>{if(list.scrollHeight-list.clientHeight-list.scrollTop<40)following=true;},options);
  list.addEventListener('keydown',e=>{if(['PageUp','Home','ArrowUp'].includes(e.key))following=false;},{signal:events.signal});
  // Re-pin as the keyboard starts moving and once the chat's height animation ends, so the newest message is never
  // left behind the strip or composer (owner screenshot, 20 Oct 2026).
  const resized=()=>{if(active()){resizeField();pin();}};
  for(const event of ['resize','keyboardWillShow','keyboardDidShow','keyboardWillHide','keyboardDidHide'])addEventListener(event,resized,options);
  document.addEventListener?.('transitionend',e=>{if(e.target===list.closest?.('.shell'))pin();},options);
  window.visualViewport?.addEventListener('resize',resized,options);
  window.visualViewport?.addEventListener('scroll',()=>pin(),options);
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(resized):null;
  observer?.observe(list);observer?.observe(composer);
  resized();
  return {pin,resize:resized,dispose(){events.abort();observer?.disconnect();cancelAnimationFrame(frame);}};
}

// Finished photo previews live only in this WebView's memory, scoped to the account.
// Pending full images remain in the durable outbox only until acknowledged/cancelled.
function foodChatPhotoCache(){
  const owners=new Map();
  return {
    put(owner,id,draft,images){
      if(!images?.length)return;
      let rows=owners.get(owner);if(!rows){rows=new Map();owners.set(owner,rows);}
      rows.delete(id);rows.set(id,{draft,images:images.slice(0,6),at:Date.now()});
      while(rows.size>40)rows.delete(rows.keys().next().value);
    },
    get(owner,id){const row=owners.get(owner)?.get(id);return row&&Date.now()-row.at<86400000?row.images:[];},
    remove(owner,id){owners.get(owner)?.delete(id);},
    clear(owner,draft){if(!draft){owners.delete(owner);return;}const rows=owners.get(owner);for(const [id,row] of rows||[])if(row.draft===draft)rows.delete(id);},
    prune(owner,ids){const rows=owners.get(owner);for(const [id,row] of rows||[])if(!ids.has(id)||Date.now()-row.at>=86400000)rows.delete(id);},
  };
}

const FoodThread = (() => {
  let current = null, privacyEpoch = 0, pendingNativeMountRetry = null;
  const photos=foodChatPhotoCache();
  const ownerKey = () => App.me ? JSON.stringify([Native.base || location.origin, App.me.id]) : null;
  const uuid = () => { if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
  const cacheKey = owner => 'fit.thread.history:'+owner;
  const contextKey = owner => 'fit.thread.context:'+owner;
  const draftKey = owner => 'fit.thread.draft:'+owner;
  const reviewDraftKey=owner=>'fit.food.review.draft:'+owner;
  const nativeKey = owner => 'fit.thread.native:'+owner;
  const active = ctx => current===ctx && ctx.el.isConnected && ctx.owner===ownerKey() && ctx.session===readOwner();
  function remember(ctx) { store.set(cacheKey(ctx.owner),ctx.messages.slice(-80)); }
  function saveReviewDraft(ctx,inProgress=false) { const value={id:ctx.draftId,day:ctx.day,meal:ctx.meal,explicitDay:!!ctx.explicitDay,active:!!inProgress};if(ctx.reviewForm)value.form=ctx.reviewForm;store.set(reviewDraftKey(ctx.owner),value); }
  async function merge(owner,data,write=true,outboxGuard=null) {
    const mergeEpoch=privacyEpoch;
    const rowsIn=[...(data.messages||[]),...(data.message?[data.message]:[]),...(data.updated_message?[data.updated_message]:[])];
    let jobs=[];
    try{jobs=await ThreadDB.list(owner);}catch(e){if(outboxGuard)return;/* server-confirmed data remains readable without the outbox */}
    const guardedJob=rows=>{
      if(!outboxGuard)return true;
      const job=rows.find(j=>j.id===outboxGuard.id);
      return owner===ownerKey()&&outboxGuard.session===readOwner()+':'+privacyEpoch&&job&&job.phase===outboxGuard.phase&&
        (Number(job.version)||0)===(Number(outboxGuard.version)||0);
    };
    if(mergeEpoch!==privacyEpoch||!guardedJob(jobs))return;
    if(write&&owner===ownerKey()&&!outboxGuard)invalidate('/api/food');
    // Forget pixels as soon as a confirmed server response arrives, even if the
    // optional device outbox cannot be read. Saved food must not look unsaved.
    for(const m of rowsIn.filter(m=>m.kind==='user')){
      const reply=rowsIn.find(r=>r.reply_to===m.id),r=reply?.result||{},job=jobs.find(j=>j.id===m.client_id);
      if((m.state==='cancelled'||reply?.entries?.length||r.cancelled||['reviewed','undone','cancelled'].includes(r.kind))&&(!job||job.phase!=='remove'))photos.remove(owner,m.client_id);
      if(r.food_review&&r.confirmed&&(!job||job.phase!=='remove'))photos.clear(owner,m.result?.draft_id);
    }
    for(const m of rowsIn.filter(m=>m.kind==='user')){
      const reply=rowsIn.find(r=>r.reply_to===m.id),r=reply?.result||{},job=jobs.find(j=>j.id===m.client_id);
      if(m.state==='cancelled'||reply?.entries?.length||r.cancelled||['reviewed','undone','cancelled'].includes(r.kind)){
        let clean=!job;
        if(job)await ThreadDB.update(owner,job.id,j=>{
          if(j.phase==='remove'||j.phase==='remove-failed'||j.phase==='complete')return j;
          clean=true;return {...j,images:undefined,previews:undefined};
        });
        if(clean)photos.remove(owner,m.client_id);
      }else if(job?.previews?.length&&job.phase!=='cancel'&&job.phase!=='remove')photos.put(owner,job.id,job.draft_id,job.previews);
      if(r.food_review&&r.confirmed){
        photos.clear(owner,m.result?.draft_id);
        for(const j of jobs)if(j.draft_id===m.result?.draft_id)await ThreadDB.update(owner,j.id,v=>['remove','remove-failed','complete'].includes(v.phase)?v:{...v,images:undefined,previews:undefined});
      }
    }
    if(outboxGuard){
      try{jobs=await ThreadDB.list(owner);}catch(e){return;}
      if(mergeEpoch!==privacyEpoch||!guardedJob(jobs))return;
      if(write&&owner===ownerKey())invalidate('/api/food');
    }
    const ctx=current;
    if(!ctx || ctx.owner!==owner || !active(ctx))return;
    if(write)ctx.epoch++;
    const rows=[...(data.messages||[]),...(data.message?[data.message]:[]),...(data.updated_message?[data.updated_message]:[])];
    for(const m of rows){if(write&&m.kind==='user')ctx.visibleClients.add(m.client_id);const i=ctx.messages.findIndex(x=>x.id===m.id);if(i<0)ctx.messages.push(m);else ctx.messages[i]=m;}
    ctx.messages.sort((a,b)=>a.id-b.id);
    const completed=rows.find(m=>m.kind==='user'&&m.result?.draft_id===ctx.draftId&&rows.some(r=>r.reply_to===m.id&&r.result?.food_review&&r.result?.confirmed));
    const loggedClients=rows.filter(m=>m.kind==='reply'&&m.result?.completed_review)
      .map(reply=>rows.find(root=>root.kind==='user'&&root.id===reply.reply_to)?.client_id).filter(Boolean);
    if(ctx.context&&loggedClients.includes(ctx.context)){ctx.context=null;store.del(contextKey(ctx.owner));}
    if(completed){
      ctx.reviewForm=null;
      if(hasDraftWork(ctx))saveReviewDraft(ctx,true);
      else{ctx.draftId=uuid();ctx.context=null;saveReviewDraft(ctx,false);store.del(contextKey(ctx.owner));}
    }
    remember(ctx);draw(ctx);
  }
  const outbox=foodOutbox({db:ThreadDB,request:(path,body,options)=>api(path,{...json('POST',body),...options}),session:()=>readOwner()+':'+privacyEpoch,changed:(owner,data,guard)=>merge(owner,data,true,guard),onCompleted:async(owner,id)=>photos.remove(owner,id),progress:async owner=>{const ctx=current;if(ctx&&active(ctx)&&ctx.owner===owner){ctx.jobs=await ThreadDB.list(owner);if(active(ctx))draw(ctx);}}});
  const removalSession=()=>readOwner()+':'+privacyEpoch;
  const removalAccount=token=>token===removalSession()?ownerKey():null;
  const removalDb={
    list:async token=>{const owner=removalAccount(token);return owner?ThreadDB.list(owner):[];},
    update:async(token,id,fn)=>{const owner=removalAccount(token);return owner?ThreadDB.update(owner,id,fn):null;},
    ensure:async(token,id,value)=>{const owner=removalAccount(token);if(owner)await ThreadDB.ensure(owner,id,value);},
    remove:async(token,id)=>{const owner=removalAccount(token);if(owner)await ThreadDB.remove(owner,id);},
  };
  const foodRemoval=foodThreadRemoval({db:removalDb,session:removalSession,
    request:(path,options,token)=>{
      if(!removalAccount(token))throw Object.assign(Error('The account changed.'),{stale:true});
      return api(path,options?.method==='DELETE'?{method:'DELETE'}:json('POST',options));
    },
    photos:{remove:async(token,id)=>{const owner=removalAccount(token);if(owner)photos.remove(owner,id);}},
    onChange:async(token,id,event)=>{
      const owner=removalAccount(token),ctx=current;if(!owner||!ctx||!active(ctx)||ctx.owner!==owner)return;
      ctx.jobs=await ThreadDB.list(owner);if(!active(ctx))return;
      const job=ctx.jobs.find(j=>j.id===id);
      if(event==='completed'){
        const root=ctx.messages.find(m=>m.kind==='user'&&m.client_id===id);
        if(root)ctx.messages=ctx.messages.filter(m=>m.id!==root.id&&m.reply_to!==root.id);
        ctx.visibleClients.delete(id);remember(ctx);
        if(ctx.removeNotice?.id===id)clearRemovalNotice(ctx);
        if(active(ctx))draw(ctx);
        return;
      }
      if(job?.removeError){draw(ctx);await refresh(ctx);if(active(ctx))draw(ctx);return;}
      if(job?.phase==='remove'&&!job.removal?.commitStarted){
        if(ctx.pendingRemovalAnimation===id)await new Promise(resolve=>setTimeout(resolve,150));
        if(!active(ctx))return;
        showRemovalNotice(ctx,id,job.removal.undoUntil);
      }else{
        if(ctx.removeNotice?.id===id)clearRemovalNotice(ctx);
        if(job&&!job.removeError&&!['remove','remove-failed','complete'].includes(job.phase))outbox.flush(owner);
      }
      if(ctx.pendingRemovalAnimation===id)ctx.pendingRemovalAnimation=null;
      if(active(ctx))draw(ctx);
    },
  });
  async function flush(ctx=null,force=false) {
    const owner=ctx?.owner||ownerKey();
    if(!owner||owner!==ownerKey()||(ctx&&ctx.session!==readOwner()))return;
    try {await outbox.flush(owner,{force});await foodRemoval.flush(removalSession());const view=current;if(view&&active(view)&&view.owner===owner){view.jobs=await ThreadDB.list(owner);draw(view);refreshAnother(view);}}
    catch(e){if(current&&active(current))status(current,e.message);}
  }
  function status(ctx,text){if(!active(ctx))return;const box=$('#thread-status',ctx.el);box.textContent=text;clearTimeout(ctx.statusTimer);if(['Saved.','Food removed.'].includes(text))ctx.statusTimer=setTimeout(()=>{if(box.textContent===text)box.textContent='';},2500);}
  function clearRemovalNotice(ctx){
    clearTimeout(ctx.removeNoticeTimer);ctx.removeNotice=null;
    const notice=$('#thread-remove-notice',ctx.el);if(notice){notice.hidden=true;const undo=$('[data-removal-undo]',notice);if(undo)undo.onclick=null;}
  }
  function showRemovalNotice(ctx,id,undoUntil){
    clearTimeout(ctx.removeNoticeTimer);ctx.removeNotice={id,undoUntil};
    const notice=$('#thread-remove-notice',ctx.el);if(!notice)return;const button=$('[data-removal-undo]',notice);if(!button)return;
    notice.hidden=false;
    button.onclick=async()=>{
      if(!active(ctx)||ctx.removeNotice?.id!==id)return;
      button.disabled=true;
      try{await foodRemoval.undo(removalSession(),id);}finally{if(button.isConnected)button.disabled=false;}
    };
    ctx.removeNoticeTimer=setTimeout(()=>{if(ctx.removeNotice?.id===id)clearRemovalNotice(ctx);},Math.max(0,(undoUntil||Date.now()+5000)-Date.now()));
  }
  function removeButtonMarkup(floating=true){return `<button type="button" class="thread-remove-unlogged${floating?' thread-remove-floating':''}" data-unlogged-remove aria-label="Remove this food">×</button>`;}
  function beginRemovalCollapse(ctx,id,node){
    ctx.pendingRemovalAnimation=id;const article=node?.matches?.('article')?node:node?.closest?.('article');
    if(!article)return;
    article.classList.add('thread-removing');void article.offsetHeight;
    requestAnimationFrame(()=>{if(article.isConnected)article.classList.add('is-collapsing');});
  }
  async function removeUnlogged(ctx,node,m,job){
    if(!active(ctx)||ctx.preparingReview||pendingReview())return;
    const id=job?.id||m?.client_id;if(!id)return;
    const button=$('[data-unlogged-remove]',node);if(button)button.disabled=true;
    Native.haptic('light');beginRemovalCollapse(ctx,id,node);
    try{
      const savedMid=m?.id||job?.mid;
      const removed=Number.isSafeInteger(Number(savedMid))&&Number(savedMid)>0
        ?await foodRemoval.removeSaved(removalSession(),id,savedMid,m?.captured_at||job?.at)
        :await foodRemoval.remove(removalSession(),id);
      if(!removed){ctx.pendingRemovalAnimation=null;const article=node.matches?.('article')?node:node.closest?.('article');article?.classList.remove('thread-removing','is-collapsing');draw(ctx);}
    }catch(error){ctx.pendingRemovalAnimation=null;const article=node.matches?.('article')?node:node.closest?.('article');article?.classList.remove('thread-removing','is-collapsing');if(button?.isConnected)button.disabled=false;status(ctx,error.message);}
  }
  function removalFailureHtml(){return `<div class="thread-remove-failed"><span>Couldn't remove this food.</span><button type="button" class="linkbtn" data-removal-retry>Try again</button></div>`;}
  async function retryRemoval(ctx,node,id){
    if(!active(ctx)||!id)return;
    const button=$('[data-removal-retry]',node);if(button)button.disabled=true;
    try{await foodRemoval.retry(removalSession(),id);}catch(error){status(ctx,error.message);}
    finally{if(button?.isConnected)button.disabled=false;}
  }
  function source(entry) {
    const ref=entry.ref||{},origin=ref.origin;
    const names={usda:'USDA',off:'Open Food Facts',quick:'Your numbers',custom:'My foods',dish:'My Recipes',recent:'Your food log',ai:'Kit’s estimate'};
    let label=origin==='ai'?'Kit’s estimate':origin==='label'?'Nutrition label':names[ref.origin_ref?.source||ref.source||entry.source]||'Your food log';
    if(ref.nutrition_from){const from=ref.nutrition_from;label='Nutrition from: '+from.name;
      if(/^\d{4}-\d{2}-\d{2}$/.test(from.day||''))label+=' ('+new Date(from.day+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'})+')';}
    if(ref.estimated_from)label='Estimated from '+ref.estimated_from+(ref.typical_portion?' · typical '+ref.typical_portion:'');
    if(ref.estimated_portion)label+=' · estimated portion';
    if(ref.origin_edited)label+=' · Edited';
    return label;
  }
  function food(entry,index,hideNotes=false,pending=null) {
    const unknown=entry.ref?.unknown_nutrients||[],macros=!entry.id?`<small class="tf-macros">${esc(FoodNutrition.macros(entry))}</small>`:'';
    const inner=`<span class="tf-main"><strong>${esc(entry.name)}</strong>${macros}<small>${esc(threadAmount(entry))} · ${esc(source(entry))}${entry.id&&!nutrientKnown(entry,'protein_g')?' · protein unknown':''}</small>${!hideNotes&&entry.ref?.origin_notes?`<small>${esc(entry.ref.origin_notes)}</small>`:''}</span><span class="tf-kcal num">${entry.kcal==null||unknown.includes('kcal')?'Unknown':homeCalories(entry.kcal)+'<small> kcal</small>'}</span>`;
    if(entry.id)return `<button type="button" class="thread-food" data-entry="${index}" aria-label="Edit ${esc(entry.name)}, about ${homeCalories(entry.kcal)} kcal">${inner}</button>`;
    return pending?`<button type="button" class="thread-food" ${nutritionAttr(pending)}>${inner}</button>`:`<div class="thread-food">${inner}</div>`;
  }
  const nutritionAttr=(row,label)=>`data-food-nutrition="${esc(JSON.stringify({part:row.part,entry:row.entry}))}" aria-haspopup="dialog" aria-label="${esc(label||`Nutrition for ${row.e.name}, ${FoodNutrition.macros(row.e)}`)}"`;
  function choices(result) {
    if(result.correction==='recent_reuse'&&result.choices?.length)return `<div class="thread-choices thread-reuse-choices">${result.choices.map((c,i)=>`<button type="button" class="thread-reuse-choice" data-choice="${esc(JSON.stringify({select:i}))}"><span class="thread-reuse-choice-name">${esc(c.name)}</span><time class="thread-reuse-choice-time" datetime="${esc(c.created||'')}">${esc(new Date(c.created).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}</time></button>`).join('')}</div>`;
    if(result.correction&&result.choices?.length)return `<div class="thread-choices">${result.choices.map((c,i)=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify({select:i}))}">${esc(c.name)}${c.created?' · '+esc(new Date(c.created).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()})):''}${c.day?' · '+esc(dayLabel(c.day))+' · '+esc(MEAL_NAMES[c.meal]||c.meal):''}</button>`).join('')}</div>`;
    const parts=result.parts || (result.resolution?.items||[]).map((item,index)=>({index,status:item.status,item}));
    // One clarification at a time; the original card retains all pending parts.
    const part=parts.find(p=>p.status!=='ready'&&!p.logged);if(!part){const numbers=parts.find(p=>p.entered_numbers&&!p.logged);return numbers?`<button type="button" class="linkbtn" data-manual="${numbers.index}">Review numbers</button>`:'';}
    // Short food questions are answered in the composer, or with one tap on a suggested reply.
    if(part.description&&!part.item?.choices?.length)return part.replies?.length?`<div class="thread-choices thread-replies">${part.replies.map(r=>`<button type="button" class="ghost" data-reply="${esc(r)}">${esc(r)}</button>`).join('')}</div>`:'';
    const item=part.item||{},options=[];
    for(const c of item.choices||[])options.push([c.name,{part:part.index,pick:{kind:c.kind,id:c.id}}]);
    for(const [i,f] of (part.catalog||[]).entries())options.push([f.name,{part:part.index,catalog:i}]);
    for(const o of item.options||[])options.push([o.label,{part:part.index,portion:o.portion}]);
    for(const o of part.scale_options||[])options.push([o.label,{part:part.index,factor:o.factor}]);
    if(item.new_ok)options.push([item.new_name?item.new_name+' (new food)':'Something new',{part:part.index,new:true}]);
    return `<div class="thread-choices">${options.map(([label,value])=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify(value))}">${esc(label)}</button>`).join('')}${!part.drafts&&!item.kind&&['choose','quantity','unknown'].includes(part.status)?aiCan('food')?`<button type="button" class="ghost" data-estimate="${part.index}">Estimate calories with Kit</button>`:aiOffer('food')?`<button type="button" class="ghost" data-kit-on="${part.index}">Turn on Kit to estimate</button>`:'':''}${part.entered_numbers?'':`<button type="button" class="linkbtn" data-portion="${part.index}">Change amount</button>`}<button type="button" class="linkbtn" data-manual="${part.index}">Enter nutrition</button></div>`;
  }
  function changedNumbers(result,entries){
    if(!entries.length)return false;const keys=['kcal','protein_g','carbs_g','fat_g','fiber_g'];
    const rows=result.parts?.flatMap(p=>p.logged?(p.entries||[]):[])||result.resolution?.items?.map(i=>i.totals).filter(Boolean)||[];
    const basis=result.logged_totals||rows.reduce((a,r)=>{for(const k of keys)a[k]=(a[k]||0)+(r[k]||0);return a;},{});
    if(Object.keys(basis).some(k=>basis[k]!=null&&Math.abs(entries.reduce((n,e)=>n+(e[k]||0),0)-basis[k])>.1))return true;
    const missing=(e,k)=>e[k]==null||(Array.isArray(e.ref?.unknown_nutrients)&&e.ref.unknown_nutrients.includes(k));
    if(Array.isArray(result.logged_unknown))return Object.keys(basis).some(k=>result.logged_unknown.includes(k)!==entries.some(e=>missing(e,k)));
    return rows.length?Object.keys(basis).some(k=>rows.some(e=>missing(e,k))!==entries.some(e=>missing(e,k))):false;
  }
  function kitHtml(r){
    const k=r.kit;
    if(k)return `<section class="thread-kit"><h3>Kit’s view</h3><p>${esc(k.interpretation)}</p>${k.facts?.length?`<details><summary>Verified food records</summary><dl>${k.facts.map(f=>`<div class="kv"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl></details>`:''}${k.limitations?.length?`<details><summary>Data limits</summary>${k.limitations.map(l=>`<p>${esc(l)}</p>`).join('')}</details>`:''}${k.selection?.kind==='food'?'<button type="button" class="ghost" data-kit-review>Review proposed meal</button>':''}</section>`;
    if(r.daily_note||!kitChatOn()||!(r.offer_kit||r.intent==='review'))return '';
    return `<a class="linkbtn" href="/me/kit?from=nutrition">Ask Kit about nutrition ${svg('chev')}</a>`;
  }
  function missingBarcodeActions(index=0,showRemove=false,showMore=true){
    const estimate=aiCan('food')?`<button type="button" class="primary wide" data-estimate="${index}">Estimate with Kit</button>`:
      aiOffer('food')?`<button type="button" class="primary wide" data-kit-on="${index}">Turn on Kit to estimate</button>`:'';
    const manual=estimate?`<button type="button" class="linkbtn" data-manual="${index}">Enter nutrition</button>`:
      `<button type="button" class="primary wide" data-manual="${index}">Enter nutrition</button>`;
    return `<div class="thread-choices barcode-choices">${estimate||manual}<div class="barcode-choice-row">${estimate?manual:''}<button type="button" class="linkbtn" data-action="resolve">Try again</button>${showRemove?removeButtonMarkup(false):showMore?`<button type="button" class="icon-btn thread-more" data-more aria-label="More food options">${svg('more')}</button>`:''}</div></div>`;
  }
  function foodActionTitle(root,reply){
    const entries=reply?.entries?.length?reply.entries:reply?.result?.parts?.flatMap(part=>part.entries||[])||[];
    const name=entries.find(entry=>entry?.name)?.name;
    if(name)return String(name).trim().slice(0,64);
    if(root?.result?.input?.kind==='barcode')return 'Food details';
    return String(root?.body||'Food details').replace(/\s+/g,' ').trim().slice(0,64)||'Food details';
  }
  function foodActionCopy(root,reply){
    const entries=reply?.entries?.length?reply.entries:reply?.result?.parts?.flatMap(part=>part.entries||[])||[];
    return {title:foodActionTitle(root,reply),change:'Change it',remove:'Remove from chat',note:entries.length?'Food already in your log stays.':'This removes the food details from this chat.'};
  }
  function barcodeChatInput(code){return {body:'Scanned a barcode',media:'barcode',barcode:String(code)};}
  function foodMessageBody(message){
    const body=String(message?.body||'');
    return message?.media==='barcode'||message?.result?.input?.kind==='barcode'||/^Scanned product \d{6,14}$/.test(body)?'Scanned a barcode':body;
  }
  function foodReplyBody(reply){
    const body=String(reply?.body||'');
    if(['Cancelled this food message.','Cancelled. Nothing from this message was logged.'].includes(body))return 'This food was removed before it was logged.';
    if(['Stopped checking. Saved food is kept; use Undo to remove it.','Stopped checking the remaining food. Already logged food is kept; use Undo to remove it.'].includes(body))return 'The remaining food wasn’t checked. Logged food stays in your log.';
    return kitFoodWords(body);
  }
  function isBarcodeNotFound(message){return message==="We couldn't find this barcode."||message==='Not found in the food database';}
  function loggedFood(reply){const r=reply?.result||{};return !!(reply?.entries?.length||r.entry_ids?.length||r.parts?.some(p=>p.logged));}
  function removableFood(root,reply){const r=reply?.result||{};return !loggedFood(reply)&&!r.cancelled&&root?.state!=='cancelled'&&!root?.result?.receipt&&!r.daily_note;}
  function loggedReplyHtml(root,entries,day,meal,result={}){
    const where=MEAL_NAMES[meal]||'Food log',target=`/food${day?'?d='+encodeURIComponent(day):''}${day?'&':'?'}meal=${encodeURIComponent(meal||'snacks')}`;
    const name=e=>String(e.name||'Food'),amount=e=>threadAmount(e),kcal=e=>e.kcal==null||e.ref?.unknown_nutrients?.includes('kcal')?'Unknown':`${homeCalories(e.kcal)} kcal`;
    const known=entries.every(e=>e.kcal!=null&&!e.ref?.unknown_nutrients?.includes('kcal'));
    const total=known?`≈ ${homeCalories(entries.reduce((sum,e)=>sum+Number(e.kcal),0))} kcal`:'Incomplete';
    const details=entries.map(e=>`<div class="thread-logged-detail"><span>${esc(name(e))} · ${esc(amount(e))}</span><span class="num">${esc(kcal(e))}</span></div>`).join('');
    const repeated=!!result.same_as,repeatedTotal=known?`${homeCalories(entries.reduce((sum,e)=>sum+Number(e.kcal),0))} kcal`:'Incomplete';
    const summary=repeated?`<span class="thread-repeat-label">${esc(result.reuse_label||'Another '+name(entries[0]))}</span><span class="thread-logged-repeat-kcal"> · ${esc(repeatedTotal)}</span>`:null;
    const sameAs=repeated?`<div class="thread-logged-meta"><span>same as ${esc(new Date(result.same_as).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}</span><a class="thread-logged-change" href="${esc(target)}">Change</a></div>`:'';
    const cardClass=`thread-card thread-logged-card${repeated?' thread-logged-repeat':''}`;
    if(entries.length===1){const e=entries[0];return `<div class="${cardClass}" data-mid="${root.id}"><a class="thread-logged-line thread-logged-single" href="${esc(target)}" aria-label="Open ${esc(name(e))} in the ${esc(where)} diary"><span class="thread-logged-summary"><span class="logged-check" aria-hidden="true">✓</span><span class="logged-foods">${summary||`${esc(name(e))} · ${esc(amount(e))} · ${esc(kcal(e))}`}</span></span><span class="thread-logged-destination">${esc(where)} ›</span></a>${sameAs}</div>`;}
    const detailsId=`thread-logged-details-${root.id}`;
    return `<div class="${cardClass}" data-mid="${root.id}"><div class="thread-logged-line"><button type="button" class="thread-logged-summary" data-logged-expand aria-expanded="false" aria-controls="${detailsId}"><span class="logged-check" aria-hidden="true">✓</span><span class="logged-foods">${summary||`${entries.length} foods · ${esc(total)}`}</span><span class="thread-logged-chevron" aria-hidden="true">⌄</span></button><a class="thread-logged-destination" href="${esc(target)}">${esc(where)} ›</a></div>${sameAs}<div class="thread-logged-details" id="${detailsId}" hidden>${details}</div></div>`;
  }
  function replyHtml(root,reply,showRemove=removableFood(root,reply),showMore=true,removalFailure='') {
    const r=reply?.result||{},entries=reply?.entries||[];
    if(r.completed_review)return '';
    const missingBarcode=root.result?.input?.kind==='barcode'&&isBarcodeNotFound(r.error?.message)&&!r.parts?.some(p=>p.status==='ready'&&p.entries?.length);
    const working=!!(r.processing||r.can_resolve),partial=r.parts?.some(p=>p.status==='ready'&&p.entries?.length&&!p.logged);
    if(!r.error&&!r.cancelled&&!entries.length&&!partial&&root.state!=='cancelled'&&(!reply&&root.state==='pending'||working))return `<div class="thread-card thread-thinking" data-mid="${root.id}"><div class="thread-typing" role="status" aria-label="Checking your food"><span></span><span></span><span></span></div>${removalFailure}</div>`;
    const day=entries[0]?.day||r.day,meal=entries[0]?.meal||r.meal;
    if((root.result?.review_only||r.same_as)&&r.kind==='log'&&entries.length)return loggedReplyHtml(root,entries,day,meal,r);
    const rows=entries.length?null:previewRows(root,r),preview=r.parts?.flatMap(p=>p.logged?[]:(p.entries||[]))||r.resolution?.items?.flatMap(i=>i.preview_entries||[])||[];
    const visible=entries.length?entries:(['preview','needs'].includes(r.kind)||r.pending_count||r.parts?.some(p=>p.status==='ready'&&!p.logged)?preview:[]),changed=changedNumbers(r,entries),removed=r.kind==='log'&&!entries.length&&r.entry_ids?.length;
    const notes=[...new Set(visible.map(e=>e.ref?.origin_notes).filter(Boolean))];
    const sharedNote=visible.length>1&&notes.length===1?notes[0]:null;
    const canLog=!root.result?.review_only&&!r.cancelled&&(r.kind==='preview'||r.parts?.some(p=>p.status==='ready'&&!p.logged));
    const compact=!!(root.result?.review_only&&rows?.length&&!entries.length),stripTotal=compact&&r.parts.every(p=>p.logged||p.status==='ready')&&visible.every(e=>e.kcal!=null&&!e.ref?.unknown_nutrients?.includes('kcal'));
    const recentReuse=r.correction==='recent_reuse';
    return `<div class="thread-card${compact?' compact-thread-card':''}" data-mid="${root.id}">${showRemove&&!compact&&!missingBarcode&&!recentReuse?removeButtonMarkup():''}${r.daily_note?`<h3>Your daily food summary</h3><p class="small muted">As of ${esc(new Date(r.as_of).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}. Later food is kept in your log.</p>`:''}${meal&&day&&!removed&&(!root.result?.review_only||entries.length)?`<button type="button" class="linkbtn thread-destination" data-destination>${esc(MEAL_NAMES[meal])} · ${esc(dayLabel(day))} ${svg('chev')}</button>`:''}
      ${!compact&&root.result?.review_only&&visible.length&&r.kind!=='answer'&&!r.food_review&&!['reviewed','continued','cancelled'].includes(r.kind)?'<p class="small muted">Not logged yet</p>':''}${r.updated||changed?'<p class="thread-updated">Updated</p>':''}${!compact&&visible.length?`<p class="thread-breakdown-title">${r.parts?.some(p=>p.estimated)?'Estimate breakdown':'Food breakdown'}</p>`:''}${rows?.length?rows.map(row=>stepRow({...row,hideNotes:!!sharedNote,hideItemRemove:!compact&&rows.length===1})).join(''):visible.map((e,i)=>food(e,i,!!sharedNote)).join('')}${sharedNote?`<p class="small muted thread-assumptions">${esc(sharedNote)}</p>`:''}${!stripTotal&&visible.length?`<p class="thread-total"><span>Total</span><b class="num">${visible.every(e=>e.kcal!=null&&!e.ref?.unknown_nutrients?.includes('kcal'))?'≈ '+homeCalories(visible.reduce((n,e)=>n+e.kcal,0))+' kcal':'Incomplete'}</b></p>`:''}${!missingBarcode&&!(working&&partial)&&(!visible.length||r.pending_count||r.kind==='answer'||r.kind==='edit'||(r.food_review&&r.confirmed)||r.parts?.some(p=>p.entered_numbers&&!p.logged))?`<p>${esc(removed?'This food was removed from your log.':foodReplyBody(reply)||(root.state==='cancelled'?'This food was removed before logging.':root.state==='answered'?'Food details were removed from this chat. Any food already in your log stays.':'Your food is waiting to be checked…'))}</p>`:''}
      ${r.breakdown?.length?`<dl class="photo-breakdown">${r.breakdown.map(e=>`<div><dt>${esc(e.name)}${e.amount?`<small>${esc(e.amount)}</small>`:''}</dt><dd class="num">${e.kcal==null?'Unknown':`≈ ${esc(e.kcal)} kcal`}</dd></div>`).join('')}<div class="photo-breakdown-total"><dt>Total</dt><dd class="num">${r.breakdown_total==null?'Incomplete':`≈ ${esc(r.breakdown_total)} kcal`}</dd></div></dl>`:''}${r.breakdown_notes?.map(note=>`<p class="small muted">${esc(note)}</p>`).join('')||''}${r.photo_itemize&&App.me?.food_photo_itemize&&aiCan('food')?`<button type="button" class="ghost wide" data-photo-itemize="${r.photo_itemize}">Add photo for ingredient breakdown</button>`:''}
      ${working&&partial?'<p class="small muted" role="status">Checking the other foods…</p>':''}${r.assumed&&!entries.length?`<p class="small muted thread-assumed">${esc(r.assumed)}</p>`:''}${r.feedback&&!changed&&!removed?`<p class="thread-feedback">${esc(typeof r.feedback==='string'?r.feedback:r.feedback.text||'')}</p>`:''}
      ${r.error?`<p class="${missingBarcode?'thread-barcode-not-found':'thread-error'}"${missingBarcode?' role="status"':''}>${esc(missingBarcode?"We couldn't find this barcode.":kitFoodWords(r.error.message||r.error))}</p>`:''}${missingBarcode?missingBarcodeActions(r.parts?.[0]?.index??0,showRemove,showMore):!r.cancelled&&(r.kind==='needs'||r.pending_count||r.parts?.some(p=>p.entered_numbers&&!p.logged))?choices(r):''}
      ${kitHtml(r)}${missingBarcode?'':`<div class="thread-actions">${canLog?'<button type="button" class="ghost" data-action="log">Log these foods</button>':''}${entries.length?'<button type="button" class="linkbtn" data-action="undo">Undo</button>':''}${!missingBarcode&&(r.error||r.parts?.some(p=>p.needs_photo))?(root.result?.input?.kind==='photo'?'<button type="button" class="linkbtn" data-reattach>Add the photo again</button>':'<button type="button" class="linkbtn" data-action="resolve">Retry lookup</button>'):''}${compact||showRemove||!showMore?'':`<button type="button" class="icon-btn thread-more" data-more aria-label="More food options">${svg('more')}</button>`}</div>`}${removalFailure}</div>`;
  }
  // A "typing" bubble replaces interim text while food is checked (owner, 19 Oct 2026).
  // A "typing" bubble while the food is being checked, instead of interim text (owner, 19 Oct 2026).
  // Unconfirmed foods get − / + so amounts change right in the chat; each row knows its part and estimate.
  function previewRows(root,r){
    if(!root.result?.review_only||r.cancelled||r.food_review||!r.parts)return null;
    const rows=[];
    for(const p of r.parts){if(p.logged)continue;(p.entries||[]).forEach((e,j)=>{const d=p.entry_drafts?.[j];rows.push({e,part:p.index,entry:j,draft:d,remove:p.remove_entries?.includes(j)||p.remove_token?{part:p.index,entry:j,expected:p.remove_token}:null,step:p.status==='ready'&&(d!=null?!!p.drafts?.[d]:!!p.item?.kind&&!p.templates)});});}
    return rows;
  }
  function threadAmount(e){
    if(e.unit!=='serving')return fmtAmount(e);
    const n=Number(Number(e.amount).toFixed(3)),label=e.ref?.serving?.label?.trim();
    if(!label||/^1?$/.test(label)||/^1?\s*servings?$/i.test(label))return `${n} serving${n===1?'':'s'}`;
    if(/^1?\s*portions?$/i.test(label))return `${n} portion${n===1?'':'s'}`;
    if(/^1 estimated portions?$/i.test(label))return `${n} portion${n===1?'':'s'}`;
    const units={cup:'cups',bowl:'bowls',slice:'slices',piece:'pieces',bottle:'bottles',can:'cans',glass:'glasses',bar:'bars',scoop:'scoops',packet:'packets',mug:'mugs',taco:'tacos',apple:'apples','hot dog':'hot dogs',tablespoon:'tablespoons',teaspoon:'teaspoons'};
    const match=label.match(/^1 (.+)$/i),unit=match?.[1].toLowerCase();
    const singular=unit&&(Object.hasOwn(units,unit)?unit:Object.keys(units).find(key=>units[key]===unit));
    if(singular)return `${n} ${n===1?singular:units[singular]}`;
    if(n===1)return label;
    // Complex source labels stay intact. A count must never become "2 × 1" or imply a weight.
    return `${n} servings · ${label} each`;
  }
  function stepRow(row){
    const {e}=row,data=`data-part="${row.part}"${row.draft!=null?` data-draft="${row.draft}"`:''}`,notes=row.hideNotes?null:e.ref?.origin_notes;
    const countUnit=!['g','kg','oz','lb'].includes(e.unit),atOne=countUnit&&Math.abs(Number(e.amount)-1)<.001,remove=row.remove&&!row.hideItemRemove?`<button type="button" class="icon-btn thread-remove" data-remove-food="${esc(JSON.stringify(row.remove))}" aria-label="Remove ${esc(e.name)}">${svg('trash')}</button>`:'';
    const less=row.step?(atOne&&remove?remove:`<button type="button" class="icon-btn" data-step="-1" ${data} aria-label="Less ${esc(e.name)}">−</button>`):remove,origin=source(e),sourceLine=origin==='Kit’s estimate'?'':`<small class="tf-source">${esc(origin)}</small>`;
    return `<div class="thread-food compact-food${row.step?' has-stepper':''}"><div class="compact-food-title"><button type="button" class="tf-inspect" ${nutritionAttr(row)}><strong>${esc(e.name)}</strong></button></div>
      <div class="compact-food-meta"><button type="button" class="thread-amount num" ${nutritionAttr(row,`Change amount of ${e.name}: ${threadAmount(e)}`)} data-amount-editor>${esc(threadAmount(e))}</button>${sourceLine}</div><span class="tf-kcal num">${e.kcal==null||e.ref?.unknown_nutrients?.includes('kcal')?'Unknown':homeCalories(e.kcal)+'<small> kcal</small>'}</span>
      <div class="thread-food-controls"><span class="thread-stepper">${less||''}${row.step?`<button type="button" class="icon-btn" data-step="1" ${data} aria-label="More ${esc(e.name)}">+</button>`:''}</span></div>${notes?`<small class="tf-notes">${esc(notes)}</small>`:''}</div>`;
  }

  const queuedReview=()=>Q.mine().some(op=>/^\/api\/food\/thread\/reviews\/\d+\/confirm$/.test(op.path));
  const pendingReview=()=>(typeof FoodReview!=='undefined'&&FoodReview.busy())||queuedReview();
  const waitingJobs=ctx=>ctx.jobs.some(j=>j.draft_id===ctx.draftId&&!j.error&&!['remove','remove-failed','complete'].includes(j.phase));
  function held(ctx){
    // A food still waiting on a question stays in the draft while ready parts can be selected safely.
    const ids=[],foods=[],selections=[];let ready=0,open=0,kcal=0,kcalKnown=true,partial=false;
    for(const m of ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.review_only&&m.result?.draft_id===ctx.draftId&&!ctx.jobs.some(j=>j.id===m.client_id&&(j.error||j.phase==='remove')))){
      const r=ctx.messages.find(x=>x.reply_to===m.id)?.result||{};
      if(r.food_review||['reviewed','undone','cancelled'].includes(r.kind)||m.state==='cancelled')continue;
      const parts=r.parts||[];
      const waiting=parts.filter(p=>!p.logged&&!(p.status==='ready'&&(!p.entered_numbers||p.manual)));
      if(waiting.length){open++;partial=true;}
      if(parts.some(p=>p.logged))partial=true;
      const done=parts.filter(p=>!p.logged&&p.status==='ready'&&(!p.entered_numbers||p.manual));if(done.length){ids.push(m.id);selections.push({message:m.id,parts:done.map(p=>p.index)});for(const p of done){ready+=Math.max(1,(p.entries||[]).length);for(const e of p.entries||[]){foods.push(e);const value=Number(e.kcal),known=e.kcal!=null&&Number.isFinite(value)&&!(e.ref?.unknown_nutrients||[]).includes('kcal');if(known)kcal+=value;else kcalKnown=false;}}}
    }
    return {ids,ready,open,kcal,kcalKnown:foods.length>0&&kcalKnown,foods,selections:partial?selections:null};
  }
  const hasDraftWork=ctx=>!!ctx.reviewForm||!!ctx.context||!!String($('#thread-text',ctx.el)?.value||'').trim()||held(ctx).ready>0||held(ctx).open>0||waitingJobs(ctx);
  function primary(ctx){
    if(!active(ctx))return;const state=held(ctx),strip=$('#thread-review',ctx.el),add=$('#thread-review-add',ctx.el),sum=$('#thread-review-sum',ctx.el);
    strip.hidden=!state.ready;
    const blocked=!!ctx.preparingReview||waitingJobs(ctx)||pendingReview();
    const waiting=queuedReview()?'Waiting to sync':waitingJobs(ctx)?'Checking food…':null;
    add.disabled=blocked||!state.kcalKnown;sum.disabled=blocked;strip.setAttribute('aria-busy',String(!!ctx.preparingReview));
    add.textContent=ctx.preparingReview?'Adding…':'Add to log';
    sum.innerHTML=waiting?`<span class="thread-review-count">${esc(waiting)}</span>`:`<span class="thread-review-count">${state.ready} food${state.ready===1?'':'s'} ·</span> <span class="thread-review-kcal">${state.kcalKnown?'≈ '+homeCalories(state.kcal)+' kcal':'Incomplete'}</span>`;
    sum.setAttribute('aria-label',`Review ${state.ready} food${state.ready===1?'':'s'}${state.kcalKnown?', about '+homeCalories(state.kcal)+' calories':''}`);
    const where=MEAL_NAMES[ctx.meal]||'your log',what=state.kcalKnown?`Add ${state.ready} food${state.ready===1?'':'s'} to ${where}: about ${homeCalories(state.kcal)} calories`:'Calories are incomplete. Edit the food details to add missing values before adding to your log.';
    add.setAttribute('aria-label',`${blocked?waiting||'Adding food':what}`+(state.open?`. ${state.open} unanswered food${state.open===1?' stays':'s stay'} in the chat.`:''));
    const send=$('#thread-send',ctx.el),field=$('#thread-text',ctx.el),hasText=!!String(field?.value||'').trim();
    send.classList.toggle('primary',hasText);send.classList.toggle('ghost',!hasText);send.disabled=!hasText||!!ctx.sendingText;send.setAttribute('aria-label','Send message');
  }
  async function review(ctx,{saveRecipe=ctx.saveRecipe,allowUnsent=false,quickConfirm=false}={}){
    if(!active(ctx)||ctx.preparingReview)return;
    if(!allowUnsent&&$('#thread-text',ctx.el).value.trim()){status(ctx,'Send your unsent text first, or clear it to review the foods already added.');return;}
    const state=held(ctx);if(!state.ready||waitingJobs(ctx)||pendingReview()){status(ctx,'Finish the food details before reviewing.');return;}
    const requestState={draftId:ctx.draftId,meal:ctx.meal,day:ctx.day,session:ctx.session};
    ctx.preparingReview=true;primary(ctx);
    try {
      await FoodReview.open({done:result=>{if(!result.queued&&active(ctx)){const typed=$('#thread-text',ctx.el).value;saveDraft(ctx,typed);saveReviewDraft(ctx,hasDraftWork(ctx));ctx.chatView?.resize();}},notifySuccess:(message,result,reviewMessageId)=>{if(!result?.queued&&(message.startsWith('Added to ')||message==='Recipe saved and added to your log')){const where=message.startsWith('Added to ')?message.slice('Added to '.length):MEAL_NAMES[requestState.meal]||'your log';toast(`Added to ${where} ·`,()=>undoLogged(ctx,[reviewMessageId]));}else toast(message);},messages:state.ids,selection:state.selections,expectedFoods:state.foods,quickConfirm,draftId:requestState.draftId,meal:requestState.meal,day:requestState.day,session:requestState.session,current:()=>ctx.draftId===requestState.draftId&&ctx.meal===requestState.meal&&ctx.day===requestState.day&&ctx.session===requestState.session,location:()=>ctx.meal===requestState.meal&&ctx.day===requestState.day&&ctx.session===requestState.session,saveRecipe,draftForm:ctx.reviewForm,rememberForm:form=>{ctx.reviewForm=form;saveReviewDraft(ctx,true);},active:()=>active(ctx),accept:data=>merge(ctx.owner,data)});
    } finally {ctx.preparingReview=false;primary(ctx);}
  }
  async function stage(items,{dish=null}={}){
    const ctx=current;if(!ctx||!active(ctx))throw Error('Open food entry to add these foods.');
    if(ctx.preparingReview||pendingReview())throw Error('Your food review is still saving. Wait or reconnect before adding more foods.');
    const id=uuid(),job={id,body:dish?'Recipe portion':items.map(e=>e.name).join(', '),at:new Date().toISOString(),phase:'process',draft_id:ctx.draftId,...(dish?{dish}:{items:items.map(foodStorage)})};saveReviewDraft(ctx,true);
    await ThreadDB.put(ctx.owner,id,job);ctx.visibleClients.add(id);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);await flush(ctx);
    return {held:true,queued:(await ThreadDB.list(ctx.owner)).some(j=>j.id===id)};
  }
  async function reuse(ctx,item){
    if(!active(ctx)||ctx.preparingReview||pendingReview())return;
    const draft=ctx.draftId,request={draft_id:draft,kind:item.kind,id:item.id,expected:item.expected,
      portion:item.canonical_portion,day:ctx.day,meal:ctx.meal||'snacks'};
    const key=JSON.stringify(request);ctx.reuseAttempts??=new Map();
    if(!ctx.reuseAttempts.has(key))ctx.reuseAttempts.set(key,uuid());
    const id=ctx.reuseAttempts.get(key);ctx.preparingReview=true;primary(ctx);
    try{
      const data=await api('/api/food/thread/reviews/reuse',json('POST',{...request,client_id:id}));
      if(!active(ctx)||ctx.draftId!==draft)return;
      ctx.visibleClients.add(id);await merge(ctx.owner,data);ctx.reuseAttempts.delete(key);ctx.reuseChips?.clear();
    }catch(error){if(active(ctx))status(ctx,error.message);return;}
    finally{ctx.preparingReview=false;if(active(ctx))primary(ctx);}
    if(active(ctx)&&ctx.draftId===draft)await review(ctx,{allowUnsent:true});
  }
  function hideAnother(ctx){
    if(!ctx.anotherBox)return;
    ctx.anotherReadVersion=(ctx.anotherReadVersion||0)+1;
    ctx.anotherBox.replaceChildren();ctx.anotherBox.hidden=true;
  }
  async function refreshAnother(ctx){
    const box=ctx.anotherBox,field=$('#thread-text',ctx.el);
    if(!box||!active(ctx))return;
    const version=(ctx.anotherReadVersion||0)+1;ctx.anotherReadVersion=version;
    if(field.value.trim()||ctx.sendingText||ctx.preparingReview||pendingReview()){
      box.replaceChildren();box.hidden=true;return;
    }
    box.replaceChildren();box.hidden=true;
    try{
      const query=new URLSearchParams({day:ctx.day||isoDay(new Date()),meal:ctx.meal||guessMeal()});
      const data=await api('/api/food/thread/recent-reuse?'+query);
      if(!active(ctx)||ctx.anotherReadVersion!==version||field.value.trim())return;
      const item=data.item;if(!item)return;
      const button=document.createElement('button');button.type='button';button.className='thread-another-chip';
      const plus=document.createElement('span');plus.className='reuse-add-icon';plus.innerHTML=svg('plus');
      const label=document.createElement('span');label.textContent=`Another ${item.label}?`;button.append(plus,label);
      button.setAttribute('aria-label',`Log another ${item.label}`);
      button.onclick=()=>{if(!active(ctx)||ctx.sendingText||ctx.preparingReview)return;hideAnother(ctx);send(ctx,{body:`Another ${item.label}`,repeatEntryId:item.entry_id});};
      box.append(button);box.hidden=false;
    }catch(_){box.replaceChildren();box.hidden=true;}
  }
  function photoHtml(ctx,id){
    const job=ctx.jobs.find(j=>j.id===id),images=['cancel','remove'].includes(job?.phase)?[]:job?.previews||photos.get(ctx.owner,id);
    return images.length?`<div class="thread-photos">${images.map((url,i)=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url)?`<img src="${url}" alt="Your food photo${images.length>1?' '+(i+1):''}" width="240" height="180">`:'').join('')}</div>`:'';
  }
  function draw(ctx) {
    if(!active(ctx))return;
    const list=$('#thread-messages',ctx.el),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
    const allRoots=ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.kind!=='food_review').sort((a,b)=>a.captured_at.localeCompare(b.captured_at)||a.id-b.id);
    const roots=allRoots.filter(m=>ctx.jobs.find(j=>j.id===m.client_id)?.phase!=='remove'),ids=new Set();let anchor=list.firstElementChild,lastDay=null;
    for(const m of roots) {
      const reply=ctx.messages.find(r=>r.reply_to===m.id),job=ctx.jobs.find(j=>j.id===m.client_id);
      const id='message-'+m.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);
      const separator=m.local_day!==lastDay?`<h2 class="thread-day">${esc(dayLabel(m.local_day))}</h2>`:'';lastDay=m.local_day;
      const user=job?.removeError||m.result?.review_request?'':`<div class="thread-user">${photoHtml(ctx,m.client_id)}<p>${esc(foodMessageBody(m))}</p><time class="vh" datetime="${esc(m.captured_at)}">${esc(dayLabel(m.local_day))} · ${esc(new Date(m.captured_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}</time></div>`;
      const replied=replyHtml(m,reply,!job?.removeError&&removableFood(m,reply),!job?.removeError,job?.removeError?removalFailureHtml():'');let waiting=job&&!job.removeError?pendingHtml(job,outbox.isSending(ctx.owner,job.id)):'';
      if(replied.includes('thread-thinking')&&waiting.includes('thread-thinking'))waiting='';   // one typing bubble, not two
      const html=`${separator}${m.result?.receipt||m.result?.daily_note?'':user}${replied}${waiting}`;
      if(!node){node=document.createElement('article');node.dataset.key=id;}
      if(node===anchor)anchor=anchor.nextElementSibling;else list.insertBefore(node,anchor);
      if(node._html!==html){node.innerHTML=html;node._html=html;wireCard(ctx,node,m,reply,job);if(job)wirePending(ctx,node,job);}
    }
    const queued=ctx.jobs.filter(j=>!allRoots.some(m=>m.client_id===j.id)&&j.phase!=='remove');
    for(const j of queued){const id='queued-'+j.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);if(!node){node=document.createElement('article');node.dataset.key=id;list.append(node);}const html=j.removeError?`<div class="thread-card thread-pending-card">${removalFailureHtml()}</div>`:`<div class="thread-user">${photoHtml(ctx,j.id)}<p>${esc(j.body)}</p></div>${pendingHtml(j,outbox.isSending(ctx.owner,j.id),true)}`;if(node._html!==html){node.innerHTML=html;node._html=html;wirePending(ctx,node,j);const remove=$('[data-unlogged-remove]',node);if(remove)remove.onclick=()=>removeUnlogged(ctx,node,null,j);const retry=$('[data-removal-retry]',node);if(retry)retry.onclick=()=>retryRemoval(ctx,node,j.id);}}
    for(const node of [...list.children])if(!ids.has(node.dataset.key))node.remove();
    // Failed local messages keep their original place; a fresh reply belongs at
    // the bottom, rather than above an appended block of older failures.
    const order=[...roots.map(m=>({key:'message-'+m.id,at:m.captured_at})),...queued.map(j=>({key:'queued-'+j.id,at:j.at}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key));
    const nodes=new Map([...list.children].map(node=>[node.dataset.key,node]));
    order.forEach((row,index)=>{const node=nodes.get(row.key);if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);});
    ctx.el.classList.toggle('has-messages',!!roots.length||!!queued.length);
    list.hidden=!roots.length&&!queued.length;
    $('#thread-empty',ctx.el).hidden=!list.hidden;
    $('#thread-older',ctx.el).hidden=true;
    if(!ctx.pauseFollow){if(ctx.chatView)ctx.chatView.pin(ctx.follow||ctx.initial);else if(bottom||ctx.follow||ctx.initial)list.scrollTop=list.scrollHeight;if(list.children.length)ctx.initial=false;}
    ctx.follow=false;primary(ctx);
  }
  function pendingHtml(job,sending=false,showRemove=false){
    if(job.phase==='remove'||job.removeError)return '';
    if(!job.error&&job.phase!=='cancel'&&(sending||job.mid)&&!job.offline&&navigator.onLine)return `<div class="thread-card thread-thinking"><div class="thread-typing" role="status" aria-label="Checking your food"><span></span><span></span><span></span></div></div>`;
    const text=job.error||(job.phase==='cancel'?'Stopping this food check when you reconnect…':sending?(job.mid?'Checking your food…':'Sending your food…'):job.offline||!navigator.onLine?'Your food is waiting to send when you’re back online.':job.mid?'Your food is waiting to be checked.':'Your food is waiting to send.');
    return `<div class="thread-card thread-pending-card">${showRemove?removeButtonMarkup():''}<div class="thread-pending"><p>${esc(text)}</p>${job.phase!=='cancel'&&!sending?'<button type="button" class="linkbtn" data-retry>Retry</button>':''}</div></div>`;
  }
  function wirePending(ctx,node,job){
    const retry=$('[data-retry]',node);if(retry)retry.onclick=async()=>{if(!active(ctx))return;
      if(job.draft_id&&job.draft_id!==ctx.draftId){
        const state=held(ctx);if(state.ready||state.open||waitingJobs(ctx)||$('#thread-text',ctx.el).value.trim()){status(ctx,'Finish your current food review before retrying this older message.');return;}
        ctx.draftId=job.draft_id;ctx.context=null;ctx.reviewForm=null;saveReviewDraft(ctx,true);store.del(contextKey(ctx.owner));
      }
      await ThreadDB.update(ctx.owner,job.id,j=>({...j,error:null,offline:false}));flush(ctx,true);};
    const cancel=$('[data-cancel]',node);if(cancel)cancel.onclick=async()=>{if(!active(ctx))return;try{
      await ThreadDB.update(ctx.owner,job.id,j=>({...j,error:null,phase:'cancel',images:undefined,previews:undefined}));
      photos.remove(ctx.owner,job.id);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);
      if(navigator.onLine){try{await api('/api/food/thread/cancel',json('POST',{client_id:job.id}));await ThreadDB.remove(ctx.owner,job.id);}catch(e){if(e.status===409){await ThreadDB.remove(ctx.owner,job.id);toast(e.message);}else throw e;}}
      const root=ctx.messages.find(m=>m.client_id===job.id);if(root){root.state='cancelled';const reply=ctx.messages.find(m=>m.reply_to===root.id);if(reply){reply.result={...reply.result,cancelled:true};reply.body=reply.entries?.length?'The remaining food wasn’t checked. Logged food stays in your log.':'This food was removed before it was logged.';}}ctx.jobs=await ThreadDB.list(ctx.owner);remember(ctx);draw(ctx);
      await refresh(ctx);flush(ctx);
    }catch(e){status(ctx,e.message);}};
  }
  async function action(ctx,mid,path,body,method='POST') {
    if(!active(ctx))return;
    status(ctx,'Saving…');
    try{const r=await api(`/api/food/thread/messages/${mid}/${path}`,json(method,body));await merge(ctx.owner,r);
      const result=(r.messages||[]).find(m=>m.reply_to===mid)?.result;
      if(result && !result.processing && !result.can_resolve && !result.pending_count){for(const j of await ThreadDB.list(ctx.owner))if(j.mid===mid)await ThreadDB.remove(ctx.owner,j.id);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);}
      status(ctx,path==='undo'?'Food removed.':'Saved.');return r;}
    catch(e){if(e.code==='preview_changed')await merge(ctx.owner,e.payload);else if(e.status===409)await refresh(ctx);status(ctx,e.message);throw e;}
  }
  async function undoLogged(ctx,ids){
    if(!active(ctx))return;
    for(const mid of [...new Set(ids)].reverse()){
      try{await action(ctx,mid,'undo',{});}catch(error){if(active(ctx))toast(error.message);return;}
    }
  }
  function pendingRow(ctx,m,key){
    if(!active(ctx))return null;
    const root=ctx.messages.find(x=>x.id===m.id),r=ctx.messages.find(x=>x.reply_to===m.id)?.result;
    if(!root?.result?.review_only||root.state==='cancelled'||r?.food_review||r?.cancelled)return null;
    const part=r?.parts?.find(p=>p.index===key.part),e=part?.entries?.[key.entry];
    return e&&!part.logged?{e,part,expected:part.remove_token}:null;
  }
  async function changePending(ctx,m,key,row,body){
    if(!active(ctx)||ctx.preparingReview||pendingReview())throw Error('Wait for the current food change to finish.');
    ctx.preparingReview=true;primary(ctx);
    try{return await action(ctx,m.id,'edit-food',{...key,expected:row.expected,...body});}
    finally{ctx.preparingReview=false;primary(ctx);}
  }
  const reviewDestination = ctx => foodDestination({meal:Object.hasOwn(MEAL_NAMES,ctx.reviewForm?.meal)?ctx.reviewForm.meal:ctx.meal||guessMeal(deviceTimeZone()),day:ctx.day,timeZone:deviceTimeZone()});
  function pendingFood(ctx,m,key,{amount=false}={}){
    let row=pendingRow(ctx,m,key);if(!row)return;let portion=foodPortion(row.e);
    sheet(row.e.name,`${reviewDestination(ctx)}<div id="pending-nutrition" tabindex="-1" role="group" aria-label="Nutrition comparison"></div><div class="food-label-actions">
      <button type="button" class="ghost wide" id="pending-amount">Change amount</button>
      <form class="form" id="pending-amount-form" hidden><div class="two"><label>Amount<input name="amount" inputmode="decimal" type="number" min="0.01" max="100000" step="any" required value="${portion.format()}"></label><label>Unit<select name="unit">${portionOptions(portion)}</select></label></div>${portionWeightNote(portion)}<p class="err" role="status"></p><button class="primary wide">Use this amount</button></form>
      <button type="button" class="linkbtn" id="pending-label">Enter nutrition</button>
      <button type="button" class="linkbtn danger" id="pending-remove">Remove food</button></div>`,(b,close)=>{
      guardFoodSheet(b,close,ctx.session);
      const valid=()=>active(ctx)&&b.isConnected,form=$('#pending-amount-form',b),input=form.elements.amount;
      const draw=e=>$('#pending-nutrition',b).innerHTML=FoodNutrition.html(e,source(e),`${portion.format()} ${portion.unit}`);draw(row.e);
      $('#pending-amount',b).onclick=()=>{form.prepend($('.portion-context',b));form.hidden=false;input.focus();input.select();};
      if(amount)$('#pending-amount',b).click();
      input.oninput=()=>{portion.input(input.value);if(portion.amount>0)draw(FoodNutrition.scale(row.e,portion.amount,!!row.part.drafts));};
      form.elements.unit.onchange=()=>{portion.select(form.elements.unit.value);form.elements.unit.value=portion.unit;input.value=portion.format();if(portion.amount>0)draw(FoodNutrition.scale(row.e,portion.amount,!!row.part.drafts));};
      form.onsubmit=async ev=>{
        ev.preventDefault();if(!valid())return;const button=$('button',form);button.disabled=true;$('.err',form).textContent='';
        try{if(!(portion.amount>0))throw Error('Enter an amount');await changePending(ctx,m,key,row,{amount:portion.amount});if(!valid())return;portion.remember();row=pendingRow(ctx,m,key);if(!row){close();return;}portion=foodPortion(row.e);input.value=portion.format();form.elements.unit.innerHTML=portionOptions(portion);b.prepend($('.portion-context',form));form.hidden=true;draw(row.e);$('#pending-nutrition',b).focus({preventScroll:true});b.closest('.sheet').scrollTop=0;}
        catch(e){if(valid())$('.err',form).textContent=e.message;}
        finally{button.disabled=false;}
      };
      $('#pending-label',b).onclick=()=>{if(valid()){close();pendingLabel(ctx,m,key,row);}};
      $('#pending-remove',b).onclick=async()=>{
        if(!valid()||ctx.preparingReview||pendingReview())return;
        const button=$('#pending-remove',b);button.disabled=true;ctx.preparingReview=true;primary(ctx);
        try{await action(ctx,m.id,'remove-food',{...key,expected:row.expected});if(valid())close();}
        catch(e){if(valid())toast(e.message);}
        finally{ctx.preparingReview=false;primary(ctx);if(button.isConnected)button.disabled=false;}
      };
    });
  }
  function pendingLabel(ctx,m,key,row){
    const basis=FoodNutrition.basis(row.e),factor=basis.factor>0?basis.factor:1,values=basis.factor>0?basis.values:FoodNutrition.values(row.e),label=basis.factor>0?basis.label:fmtAmount(row.e);
    sheet('Enter nutrition',`<form class="form" id="pending-label-form"><label>Food<input name="name" value="${esc(row.e.name)}" maxlength="200" required></label>
      <p>Numbers for ${esc(label)}. Leave a value blank if it is unknown.</p>${macroInputs(values)}
      <p class="small muted">Changes only this food in your draft.</p><p class="err" role="status"></p><button class="primary wide">Use these numbers</button></form>`,(b,close)=>{
      guardFoodSheet(b,close,ctx.session);const f=$('#pending-label-form',b);
      f.onsubmit=async ev=>{
        ev.preventDefault();if(!active(ctx)||!b.isConnected)return;
        const item={name:f.elements.name.value,amount:1,unit:'serving'};
        for(const k of FOOD_NUTRIENTS){const text=f.elements[k].value.trim();item[k]=text===''?null:Number(text.replace(',','.'));}
        if(item.kcal==null||!Number.isFinite(item.kcal)||item.kcal<0){$('.err',f).textContent='Enter calories before using these numbers.';return;}
        const button=$('button',f);button.disabled=true;
        try{await changePending(ctx,m,key,row,{item,basis_amount:row.e.amount/factor,basis_label:label,
          basis_g:row.e.unit==='g'?row.e.amount/factor:null});if(active(ctx)&&b.isConnected){close();pendingFood(ctx,m,key);}}
        catch(e){if(b.isConnected)$('.err',f).textContent=e.message;}
        finally{button.disabled=false;}
      };
    });
  }
  function wireCard(ctx,node,m,reply,job=null){
    const r={...(reply?.result||{}),...(reply?.entries?.[0]?{day:reply.entries[0].day,meal:reply.entries[0].meal}:{})};
    const remove=$('[data-unlogged-remove]',node);if(remove)remove.onclick=()=>removeUnlogged(ctx,node,m,job);
    const removeRetry=$('[data-removal-retry]',node);if(removeRetry)removeRetry.onclick=()=>retryRemoval(ctx,node,job?.id||m.client_id);
    const itemize=$('[data-photo-itemize]',node);if(itemize)itemize.onclick=()=>{ctx.photoRetry={id:+itemize.dataset.photoItemize,itemize:true};const file=$('#ql-file',ctx.el);file.removeAttribute('capture');file.click();};
    const reattach=$('[data-reattach]',node);if(reattach)reattach.onclick=()=>{ctx.photoRetry=m.id;const file=$('#ql-file',ctx.el);file.removeAttribute('capture');file.click();};
    $$('[data-action]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,b.dataset.action,b.dataset.action==='log'?{confirm:true}:b.dataset.action==='resolve'?{retry:true}:{});}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    const kit=$('[data-kit]',node);if(kit)kit.onclick=async()=>{if(!active(ctx))return;kit.disabled=true;status(ctx,'Checking your food records…');try{const data=await action(ctx,m.id,'kit',{});status(ctx,data.processing?'Kit is still checking. Tap Check Kit answer shortly.':'Answer saved.');}catch(e){toast(e.message);}finally{if(kit.isConnected)kit.disabled=false;}};
    const review=$('[data-kit-review]',node);if(review)review.onclick=()=>{if(!active(ctx))return;kitReview(r.kit.selection,{scopeKey:m.client_id,onStale:async()=>{await action(ctx,m.id,'kit',{refresh:true});},onSaved:async data=>{if(active(ctx)){await merge(ctx.owner,data);await refresh(ctx);}}});};
    $$('[data-choice]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,'choose',JSON.parse(b.dataset.choice));}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    $$('[data-entry]',node).forEach(b=>b.onclick=()=>{entrySheet(reply.entries[+b.dataset.entry],reply.entries[+b.dataset.entry].day);});
    $$('[data-food-nutrition]',node).forEach(b=>b.onclick=()=>pendingFood(ctx,m,JSON.parse(b.dataset.foodNutrition),{amount:b.hasAttribute('data-amount-editor')}));
    const dest=$('[data-destination]',node);if(dest)dest.onclick=()=>destination(ctx,m,r);
    const expand=$('[data-logged-expand]',node);if(expand)expand.onclick=()=>{const details=$('.thread-logged-details',node);if(!details)return;details.hidden=!details.hidden;expand.setAttribute('aria-expanded',String(!details.hidden));$('.thread-logged-chevron',expand).textContent=details.hidden?'⌄':'⌃';};
    $$('[data-remove-food]',node).forEach(b=>b.onclick=async()=>{
      if(!active(ctx)||ctx.preparingReview||pendingReview())return;
      // Keep this card and the review strip still while its removal is saving.
      const controls=$$('button',node);controls.forEach(c=>c.disabled=true);ctx.preparingReview=true;primary(ctx);
      try{await action(ctx,m.id,'remove-food',JSON.parse(b.dataset.removeFood));status(ctx,'Food removed.');}
      catch(e){toast(e.message);}
      finally{ctx.preparingReview=false;if(node.isConnected)controls.forEach(c=>c.disabled=false);primary(ctx);}
    });
    $$('[data-step]',node).forEach(b=>b.onclick=async()=>{
      if(!active(ctx)||ctx.preparingReview||pendingReview())return;
      const p=r.parts?.find(x=>x.index===+b.dataset.part);if(!p)return;const up=+b.dataset.step>0;
      const old=b.dataset.draft!=null?p.drafts?.[+b.dataset.draft]?.portion:p.item?.portion;if(!old)return;
      const next=old.grams?null:old.count>1||up?Math.max(.5,(old.count>=1?Math.round(old.count):old.count)+(up?1:-1)):old.count/2;
      const factor=old.grams?(up?1.25:.8):next/old.count;if(!(factor>0)||next!=null&&next<.25)return;
      b.disabled=true;Native.haptic('selection');
      const body=b.dataset.draft!=null?{part:p.index,draft:+b.dataset.draft,factor}:{part:p.index,portion:old.grams?{grams:Math.round(old.grams*factor)}:{count:next,...(old.unit?{unit:old.unit}:{})}};
      // Show calories and macros together immediately; failed saves restore the
      // authoritative card. The final review cannot race this pending amount.
      const ratio=body.portion?.grams?body.portion.grams/old.grams:factor;
      const preview={...p,entries:(p.entries||[]).map((e,i)=>b.dataset.draft==null||p.entry_drafts?.[i]===+b.dataset.draft?FoodNutrition.scale(e,e.amount*ratio,true):e)};
      const card=$('.thread-card',node);if(card)card.outerHTML=replyHtml(m,{...reply,result:{...r,parts:r.parts.map(x=>x.index===p.index?preview:x)}},removableFood(m,reply));
      $$('button',node).forEach(control=>control.disabled=true);ctx.preparingReview=true;primary(ctx);
      try{await action(ctx,m.id,'choose',body);}catch(e){if(active(ctx))toast(e.message);}
      finally{ctx.preparingReview=false;node._html=null;draw(ctx);}
    });
    $$('[data-reply]',node).forEach(b=>b.onclick=()=>{if(!$('#thread-text',ctx.el).value.trim())send(ctx,{body:b.dataset.reply});else status(ctx,'Send or clear your typed message first.');});
    $$('[data-estimate]',node).forEach(b=>b.onclick=()=>action(ctx,m.id,'resolve',{retry:true,allow_brand_estimate:true,part:+b.dataset.estimate}).catch(()=>{}));
    // A food nobody could match while Kit was off (28 October 2026): turn it on (with its 18+ confirmation), then estimate.
    $$('[data-kit-on]',node).forEach(b=>b.onclick=()=>aiSheet(()=>{if(active(ctx))action(ctx,m.id,'resolve',{retry:true,allow_brand_estimate:true,part:+b.dataset.kitOn}).catch(()=>{});}));
    $$('[data-portion]',node).forEach(b=>b.onclick=()=>portion(ctx,m,+b.dataset.portion));
    $$('[data-manual]',node).forEach(b=>b.onclick=()=>manual(ctx,m,+b.dataset.manual,r));
    const more=$('[data-more]',node);if(more)more.onclick=()=>{const copy=foodActionCopy(m,reply);sheet(copy.title,`<button type="button" class="ghost wide" id="thread-correct">${copy.change}</button><button type="button" class="linkbtn danger" id="thread-delete">${copy.remove}</button><p>${copy.note}</p>`,(b,close)=>{
      $('#thread-correct',b).onclick=()=>{ctx.context=m.client_id;store.set(contextKey(ctx.owner),ctx.context);close();$('#thread-text',ctx.el).focus();status(ctx,'Try “make it half” or name the food you want to change.');};
      $('#thread-delete',b).onclick=async()=>{if(!active(ctx))return;try{await api(`/api/food/thread/messages/${m.id}`,{method:'DELETE'});await ThreadDB.remove(ctx.owner,m.client_id);photos.remove(ctx.owner,m.client_id);ctx.jobs=await ThreadDB.list(ctx.owner);ctx.epoch++;ctx.messages=ctx.messages.filter(x=>x.id!==m.id&&x.reply_to!==m.id);remember(ctx);draw(ctx);close();}catch(e){toast(e.message);}};
    });};
  }
  function destination(ctx,m,r,onSave=null){foodDestinationPicker(r,async next=>{if(onSave){if(!active(ctx))return;onSave(next);}else await action(ctx,m.id,'destination',next,'PUT');},'thread-destination');}
  function foodContextLabel(ctx){const zone=deviceTimeZone(),today=isoDay(new Date(),zone),meal=MEAL_NAMES[ctx.meal]||'Choose a meal',day=ctx.day&&ctx.day!==today?(dayLabel(ctx.day,zone)==='Yesterday'?'Yesterday':new Date(ctx.day+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short'})):null,spoken=day?`${meal}, ${day}`:`${meal}, today`;return {title:[day,meal].filter(Boolean).join(' · ')||meal,ariaLabel:`Logging to ${spoken}. Change day or meal.`,dated:!!day};}
  function drawFoodContext(ctx){const button=$('#thread-context',ctx.el);if(!button)return;const label=foodContextLabel(ctx),title=$('.thread-context-label',button),inline=!!ctx.el.closest('.kit-chat');if(title)title.textContent=inline&&!label.dated?`${label.title} · Today`:label.title;button.setAttribute('aria-label',label.ariaLabel);const heading=$('.thread-heading',ctx.el);if(heading)heading.classList.toggle('thread-heading-dated-context',label.dated);const back=$('.thread-heading .back',ctx.el);if(back){back.href='/food?d='+encodeURIComponent(ctx.day);back.setAttribute('aria-label','Back to Nutrition');}}
  function editFoodContext(ctx){destination(ctx,null,{day:ctx.day,meal:ctx.meal},next=>{ctx.day=next.day;ctx.historyDay=next.day;ctx.meal=next.meal;ctx.explicitDay=true;saveReviewDraft(ctx,hasDraftWork(ctx));const query=new URLSearchParams(location.search);query.set('d',ctx.day);query.set('meal',ctx.meal);history.replaceState(null,'',`${location.pathname}?${query}`);drawFoodContext(ctx);refreshAnother(ctx);});}
  function portion(ctx,m,index){sheet('Set portion',reviewDestination(ctx)+'<form class="form" id="thread-portion"><label>Amount<input name="amount" type="number" min="0.01" step="any" required inputmode="decimal"></label><label>Unit<select name="unit"><option value="count">Servings</option><option value="grams">Grams</option><option value="share">Share of the whole (0.5 = half)</option></select></label><button class="primary wide">Use this portion</button></form>',(b,close)=>{$('#thread-portion',b).onsubmit=async e=>{e.preventDefault();try{await action(ctx,m.id,'choose',{part:index,portion:{[e.target.unit.value]:+e.target.amount.value}});close();}catch(e){toast(e.message);}};});}
  function manual(ctx,m,index,result={}){const supplied=result.parts?.find(p=>p.index===index)?.entered_numbers,values=supplied?.values||{};sheet('Enter nutrition',`<form class="form" id="thread-manual"><label>Food<input name="name" value="${esc(supplied?.name||m.body.slice(0,200))}" maxlength="200" required></label>${macroInputs(values)}<p>Enter calories. Leave nutrients blank if you don’t know them; blank means unknown.</p><button class="primary wide">Use these numbers</button></form>`,(b,close)=>{guardFoodSheet(b,close,ctx.session);$('#thread-manual',b).onsubmit=async e=>{e.preventDefault();const f=e.target,item={name:f.name.value,amount:1,unit:'serving'};for(const k of FOOD_NUTRIENTS)item[k]=f[k].value.trim()===''?null:Number(f[k].value);if(item.kcal===null||!Number.isFinite(item.kcal)||item.kcal<0){f.kcal.setCustomValidity('Enter calories before logging.');f.kcal.reportValidity();f.kcal.oninput=()=>f.kcal.setCustomValidity('');return;}try{await action(ctx,m.id,'manual',{part:index,items:[item],confirm:true});close();}catch(e){toast(e.message);}};});}
  async function refresh(ctx,before=null){
    if(!active(ctx))return;
    const epoch=ctx.epoch,version=++ctx.readVersion;
    try{const data=await api('/api/food/thread/reviews/draft/'+ctx.draftId);if(!active(ctx)||ctx.epoch!==epoch||ctx.readVersion!==version)return;ctx.before=data.before;ctx.preferences=data.preferences;
      if(!before){const first=data.messages[0]?.id;ctx.messages=data.has_more?ctx.messages.filter(m=>m.id<first):[];}
      for(const m of data.messages||[])if(m.kind==='user'&&m.result?.draft_id===ctx.draftId)ctx.visibleClients.add(m.client_id);
      await merge(ctx.owner,data,false);photos.prune(ctx.owner,new Set(ctx.messages.filter(m=>m.kind==='user').map(m=>m.client_id)));const restored=await restoreFoodPending({db:ThreadDB,owner:ctx.owner,draftId:ctx.draftId,messages:data.messages||[]});if(!active(ctx))return;ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);refreshAnother(ctx);status(ctx,'');if(restored)flush(ctx);}
    catch(e){status(ctx,e.offline?'Offline. Your saved conversation and pending messages stay on this phone.':foodThreadError(e,'/api/food/thread/reviews/draft/'+ctx.draftId));}
  }
  function latestContext(ctx){
    const previous=ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.draft_id===ctx.draftId&&!ctx.jobs.some(j=>j.id===m.client_id&&j.error)&&['log','needs','preview','undone'].includes(m.result?.kind)).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at)||a.id-b.id).at(-1);
    const pending=ctx.jobs.filter(j=>j.phase!=='cancel'&&!j.error&&j.draft_id===ctx.draftId).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
    return pending&&(!previous||Date.parse(pending.at)>Date.parse(previous.captured_at))?pending.id:previous?.client_id;
  }
  async function send(ctx,{body,media='text',barcode,images,itemize=false,replaceDraft,repeatEntryId}={}) {
    if(!active(ctx))return;const field=$('#thread-text',ctx.el),text=(body||field.value).trim();if(!text)return;
    if(ctx.preparingReview||pendingReview()){status(ctx,'Your food review is still saving. Wait or reconnect before adding more foods.');return;}
    if(text.length>4000){status(ctx,'Keep this message under 4,000 characters.');return;}
    // A self context prevents the server from falling back to a previous visit's food.
    const context=ctx.jobs.some(j=>j.id===ctx.context&&j.error)?null:ctx.context;
    const consumesDraft=!body||field.value.trim()===text||replaceDraft!==undefined&&field.value===replaceDraft;
    const draftId=ctx.draftId,previews=images?.length?await Promise.all(images.map(image=>shrinkPhoto(image,480))):undefined;
    if(!active(ctx)||ctx.draftId!==draftId)return;
    const id=uuid(),job={id,previews,body:text,itemize,at:new Date().toISOString(),media,barcode,images,review_only:true,draft_id:ctx.draftId,phase:'process',context:context||latestContext(ctx)||id,day:ctx.day||isoDay(new Date()),...(ctx.meal?{meal:ctx.meal}:{}),...(repeatEntryId?{repeat_entry_id:repeatEntryId}:{})};saveReviewDraft(ctx,true);
    if(ctx.sendingText)return;ctx.sendingText=true;primary(ctx);
    try{if(consumesDraft){finishNativeDraft(ctx);saveDraft(ctx,'');}await ThreadDB.put(ctx.owner,job.id,job);if(ctx.draftId!==draftId){await ThreadDB.remove(ctx.owner,job.id);return;}if(!active(ctx))return;if(previews)photos.put(ctx.owner,job.id,ctx.draftId,previews);ctx.visibleClients.add(job.id);
      if(consumesDraft){field.value='';ctx.chatView?.resize();store.del(draftKey(ctx.owner));}ctx.context=null;ctx.reviewForm=null;store.del(contextKey(ctx.owner));
      ctx.jobs=await ThreadDB.list(ctx.owner);ctx.follow=true;draw(ctx);status(ctx,'');Native.haptic();flush(ctx);
    }catch(e){status(ctx,e.message);}finally{ctx.sendingText=false;if(active(ctx))primary(ctx);}
  }
  function preferences(ctx){if(!ctx.preferences){status(ctx,'Wait for food chat settings to load, then try again.');return;}const p=ctx.preferences;sheet('Food chat settings',`<button type="button" class="ghost wide danger" id="thread-clear">Clear chat</button><p class="small muted">Clears the conversation on this and your other devices. Food you’ve logged stays in your log. The chat also starts fresh each day.</p><form class="form" id="thread-preferences"><p>Choose Add to log to save food. Logged cards have Undo and Edit.</p><label>Feedback<select name="tone"><option value="supportive"${p.tone==='supportive'?' selected':''}>Supportive</option><option value="numbers"${p.tone==='numbers'?' selected':''}>Just the numbers</option></select></label><button class="primary wide">Save settings</button></form>`,(b,close)=>{$('#thread-clear',b).onclick=()=>clearChat(ctx,close);$('#thread-preferences',b).onsubmit=async e=>{e.preventDefault();if(!active(ctx))return;try{const value={tone:e.target.tone.value,daily_note:'off'};const saved=await api('/api/food/thread/preferences',json('PUT',value));if(!active(ctx))return;ctx.preferences=saved;close();toast('Food chat settings saved');}catch(e){toast(e.message);}};});}
  // Clear the conversation on the server and this phone. Logged food is never touched.
  async function wipe(ctx){
    if(!active(ctx))return;
    photos.clear(ctx.owner);
    try{await api('/api/food/thread/clear',json('POST',{confirm:true}));}catch(e){return;}   // a failed clear just leaves the chat as it was
    privacyEpoch++;photos.clear(ctx.owner);await ThreadDB.erase(ctx.owner);store.del(cacheKey(ctx.owner));store.del(contextKey(ctx.owner));
    ctx.messages=[];ctx.jobs=[];ctx.visibleClients=new Set();ctx.context=null;ctx.reviewForm=null;ctx.draftId=uuid();ctx.epoch++;
    saveReviewDraft(ctx,false);if(active(ctx))draw(ctx);
  }
  async function clearChat(ctx,close){
    if(!active(ctx))return;
    if(ctx.preparingReview||pendingReview()){status(ctx,'Wait for your food to finish saving, then clear the chat.');return;}
    close();
    sheet('Clear chat?','<p>The conversation is removed on all your devices. Food you’ve logged stays in your log.</p><button type="button" class="primary wide danger" id="thread-clear-yes">Clear chat</button>',(b,done)=>{$('#thread-clear-yes',b).onclick=async()=>{
    if(!active(ctx))return;
    try{await api('/api/food/thread/clear',json('POST',{confirm:true}));
      privacyEpoch++;photos.clear(ctx.owner);await ThreadDB.erase(ctx.owner);store.del(cacheKey(ctx.owner));store.del(contextKey(ctx.owner));store.del(draftKey(ctx.owner));
      ctx.messages=[];ctx.jobs=[];ctx.visibleClients=new Set();ctx.context=null;ctx.reviewForm=null;ctx.draftId=uuid();ctx.epoch++;
      saveReviewDraft(ctx,false);$('#thread-text',ctx.el).value='';ctx.chatView?.resize();draw(ctx);done();toast('Chat cleared');}
    catch(e){toast(e.message);}};});
  }
  function page(el,{day,meal}={}){
    if(current){current.removeEvents?.abort();current.chatView?.dispose();clearTimeout(current.removeNoticeTimer);}
    if(new URLSearchParams(location.search).get('save')==='1'){el.innerHTML=`<header class="thread-heading">${backBtn('My Recipes')}<h1>Create recipe</h1></header><button type="button" class="primary wide" id="recipe-start">Create recipe</button>`;wireBack(el,'/food/meals');const button=$('#recipe-start',el);button.onclick=()=>newDish(button);newDish(button);return;}
    const owner=ownerKey(),resume=store.get(reviewDraftKey(owner)),resumeId=typeof resume==='string'?resume:resume?.id,localTimeZone=deviceTimeZone(),profileTimeZone=App.me?.tz||localTimeZone,hasDay=/^\d{4}-\d{2}-\d{2}$/.test(day),hasMeal=Object.hasOwn(MEAL_NAMES,meal),cached=store.get(cacheKey(owner)),resumeContext=store.get(contextKey(owner)),unsent=String(store.get(draftKey(owner))||'').trim(),cachedWork=Array.isArray(cached)&&cached.some(m=>m.kind==='user'&&m.result?.draft_id===resumeId),resumeActive=!!resume&&(resume.active===true||!!resume.form||!!resumeContext||!!unsent||cachedWork),resumeHasDay=/^\d{4}-\d{2}-\d{2}$/.test(resume?.day),resumeExplicitDay=resume?.explicitDay===true&&resumeHasDay,resumeExplicitActive=resumeActive&&resumeExplicitDay,initialDay=hasDay?day:resumeExplicitActive?resume.day:isoDay(new Date(),localTimeZone),historyDay=hasDay||resumeExplicitActive?initialDay:(initialDay>isoDay(new Date(),profileTimeZone)?initialDay:isoDay(new Date(),profileTimeZone)),ctx={el,owner,day:initialDay,historyDay,meal:hasMeal?meal:resumeExplicitActive&&Object.hasOwn(MEAL_NAMES,resume?.meal)?resume.meal:guessMeal(localTimeZone),explicitDay:hasDay||resumeExplicitActive,session:readOwner(),draftId:resumeActive&&resumeId||uuid(),saveRecipe:new URLSearchParams(location.search).get('save')==='1',reviewForm:resumeActive?resume?.form||null:null,messages:[],visibleClients:new Set(),context:resumeActive?resumeContext:null,jobs:[],before:null,follow:false,initial:true,epoch:0,readVersion:0,removeEvents:new AbortController(),resumeId};current=ctx;saveReviewDraft(ctx,resumeActive);
    el.classList.add('food-thread');el.setAttribute('aria-live','off');
    const tile=(attr,ico,label)=>`<button type="button" ${attr}>${svg(ico)}<span>${label}</span></button>`;
    el.innerHTML=`<header class="thread-heading"><a class="back" href="${ctx.day?'/food?d='+encodeURIComponent(ctx.day):'/food'}" aria-label="Back to Nutrition">${svg('back')}<span class="thread-back-label">Nutrition</span></a><h1 class="vh">Add food</h1><button type="button" id="thread-context" class="thread-title thread-context" aria-haspopup="dialog"><span class="thread-context-label" data-type="section"></span><span class="thread-context-chevron" aria-hidden="true">⌄</span></button><button type="button" class="icon-btn" id="thread-settings" aria-label="Food chat settings">${svg('more')}</button></header><button type="button" class="linkbtn" id="thread-older" hidden>Earlier messages</button><div id="thread-messages" aria-live="off"></div><div id="thread-empty"><h2><span class="kit-mark" aria-hidden="true">${svg('sparkle')}</span>What did you eat?</h2></div><form id="thread-composer" class="thread-composer"><div id="thread-shared-recipes"></div><div class="thread-menu" id="thread-menu" hidden><div class="thread-tools">${tile('data-tool="snap"','camera','Camera')}${tile('data-tool="library"','image','Photo')}${tile('data-tool="scan"','barcode','Barcode')}${tile('id="thread-search"','search','Search')}${tile('id="thread-usuals"','clock','Usuals')}${tile('id="thread-recipes"','pot','Recipes')}${tile('id="thread-manual-add"','edit','Manual')}</div></div><label class="vh" for="thread-text">Message about your food</label><div class="thread-review-strip" id="thread-review" hidden><button type="button" id="thread-review-sum" class="thread-review-sum" aria-label="Review food details"></button><button type="button" id="thread-review-add" class="thread-review-add">Add to log</button></div><div class="kit-starters thread-quick-actions" role="group" aria-label="Quick food actions">${tile('data-thread-quick="recipes"','pot','My Recipes')}${tile('data-thread-quick="snap"','camera','Take a photo')}${tile('data-thread-quick="scan"','barcode','Scan a barcode')}${tile('data-thread-quick="search"','search','Search foods')}</div><div id="thread-remove-notice" class="thread-remove-notice" hidden><span class="vh" role="status" aria-live="polite">Food removed. Undo available.</span><span aria-hidden="true">Food removed</span><button type="button" class="linkbtn" data-removal-undo>Undo</button></div><div class="thread-compose-row"><button type="button" class="icon-btn thread-plus" id="thread-plus" aria-label="More ways to add food" aria-expanded="false" aria-controls="thread-menu">${svg('plus')}</button><textarea id="thread-text" rows="1" maxlength="4000" enterkeyhint="send" placeholder="What did you eat?"></textarea><button class="ghost thread-send" id="thread-send" aria-label="Send message">${svg('send')}</button></div><p id="thread-status" role="status" aria-live="polite"></p><input type="file" id="ql-file" accept="image/*" multiple hidden></form>`;
    drawFoodContext(ctx);$('#thread-context',el).onclick=()=>editFoodContext(ctx);
    // The + menu holds every other way to add food, so the bar stays one line like a messaging app.
    // + opens the tools as an ordinary bottom sheet (owner: the inline panel looked out of place). The tool
    // buttons keep living in the hidden menu, so the sheet shows clones that click the real ones.
    const menu=$('#thread-menu',el),plus=$('#thread-plus',el),openMenu=open=>{if(!open)return;Native.haptic('selection');field.blur();
      sheet('Add food',`<div class="thread-tools thread-tools-sheet">${$$('.thread-tools button',menu).map((b,i)=>`<button type="button" data-clone="${i}">${b.innerHTML}</button>`).join('')}</div>`,(b,close)=>{
        $$('[data-clone]',b).forEach(x=>x.onclick=()=>{const target=$$('.thread-tools button',menu)[+x.dataset.clone];
          // Camera and Photo hand control to the native picker. Close the flow first so
          // cancelling that picker cannot strand an inert Add food sheet underneath it.
          if(target?.dataset.tool==='snap'||target?.dataset.tool==='library'){close.closeAll(true);}
          target?.click();
        });},{flow:'new'});};
    plus.onclick=()=>openMenu(true);
    $('#thread-review-add',el).onclick=()=>review(ctx,{allowUnsent:true,quickConfirm:!ctx.reviewForm&&!ctx.saveRecipe});
    $('#thread-review-sum',el).onclick=()=>review(ctx,{allowUnsent:true});
    $('#thread-manual-add',el).onclick=()=>typeSheet('', '', async values=>{
      const {grams,...nutrition}=values;
      await stage([{...nutrition,day:ctx.day||isoDay(new Date()),meal:ctx.meal||'snacks',amount:grams||1,unit:grams?'g':'serving',source:'quick'}]);return true;
    },{flow:'auto'});
    const field=$('#thread-text',el);field.value=String(store.get(draftKey(owner))||'');
    const reuseBox=document.createElement('div');reuseBox.className='thread-reuse';reuseBox.hidden=true;
    reuseBox.setAttribute('role','group');reuseBox.setAttribute('aria-label','Reuse your foods');
    $('.thread-compose-row',el).before(reuseBox);
    const anotherBox=document.createElement('div');anotherBox.className='thread-another';anotherBox.id='thread-another';anotherBox.hidden=true;
    anotherBox.setAttribute('role','group');anotherBox.setAttribute('aria-label','Repeat a recent food');
    $('.thread-compose-row',el).before(anotherBox);ctx.anotherBox=anotherBox;
    $('.thread-compose-row',el).before($('#thread-remove-notice',el));
    ctx.reuseChips=foodReuseChips({box:reuseBox,field,live:()=>active(ctx),choose:item=>reuse(ctx,item),day:()=>ctx.historyDay,excluded:()=>{const current=held(ctx).foods.map(e=>e.name),last=[...ctx.messages].reverse().find(m=>m.kind==='reply'&&m.result?.kind==='log'&&m.entries?.length);return [...current,...(last?.entries.map(e=>e.name)||[])];}});
    ctx.nativeEntries=(store.get(nativeKey(owner))||[]).filter(x=>x&&x.at>Date.now()-86400000).slice(-100);
    let fitKey='';
    const grow=()=>{
      // Keyboard animation resizes the list repeatedly; refit only when text, type size or width changes.
      const style=getComputedStyle(field),key=JSON.stringify([field.clientWidth,style.fontSize,style.lineHeight,field.value,field.placeholder]);
      if(key===fitKey)return;fitKey=key;
      field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';
    };
    field.addEventListener('input',grow);
    field.addEventListener('input',()=>{if(ctx.removeNotice)clearRemovalNotice(ctx);});
    el.addEventListener('click',event=>{if(ctx.removeNotice&&!event.target.closest('[data-removal-undo],[data-unlogged-remove]'))clearRemovalNotice(ctx);},{signal:ctx.removeEvents.signal});
    field.oninput=()=>{if(!field.value.trim()){ctx.context=null;store.del(contextKey(owner));refreshAnother(ctx);}else{hideAnother(ctx);if(!ctx.context){ctx.context=latestContext(ctx);if(ctx.context)store.set(contextKey(owner),ctx.context);}}primary(ctx);try{saveDraft(ctx,field.value);saveReviewDraft(ctx,hasDraftWork(ctx));}catch(e){status(ctx,'Draft storage is full. Keep this screen open until you send.');}};
    ctx.chatView=foodChatViewport({list:$('#thread-messages',el),composer:$('#thread-composer',el),field,send:$('#thread-send',el),active:()=>active(ctx),resizeField:grow});
    field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#thread-composer',el).requestSubmit();}});
    $('#thread-composer',el).onsubmit=e=>{e.preventDefault();send(ctx);};
    $('#thread-settings',el).onclick=()=>preferences(ctx);
    $('#thread-usuals',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal());
    $('#thread-recipes',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),'','saved');
    $$('[data-thread-quick]',el).forEach(button=>button.onclick=()=>{const key=button.dataset.threadQuick,target=key==='recipes'?'#thread-recipes':key==='search'?'#thread-search':`[data-tool="${key}"]`;$(target,el).click();});
    $('#thread-search',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),'','search');
    $('#thread-older',el).onclick=async()=>{const list=$('#thread-messages',el),h=list.scrollHeight,y=list.scrollTop;ctx.pauseFollow=true;try{await refresh(ctx,ctx.before);if(active(ctx))list.scrollTop=y+list.scrollHeight-h;}finally{ctx.pauseFollow=false;}};
    const file=$('#ql-file',el);file.onchange=()=>{const files=[...file.files];file.value='';const pending=ctx.photoRetry;ctx.photoRetry=null;
      const retry=typeof pending==='number'?{id:pending}:pending,replaceDraft=field.value;
      const prior=retry?ctx.messages.find(m=>m.reply_to===retry.id)?.result:null;
      const original=retry?prior?.photo_request_note??prior?.parts?.find(p=>p.photo_description)?.photo_description??ctx.messages.find(m=>m.id===retry.id)?.body??'':replaceDraft;
      const itemize=retry?.itemize??prior?.photo_request_itemize??!!(prior?.parts?.some(p=>p.photo_itemized)||ctx.messages.find(m=>m.id===retry?.id)?.result?.input?.itemize);
      const draftId=ctx.draftId;
      reviewFoodPhotos(files,async(images,details)=>{
        try{
          if(!retry){await send(ctx,{body:details.note||'Photo of food',media:'photo',images,replaceDraft});return;}
          const previews=await Promise.all(images.map(image=>shrinkPhoto(image,480)));
          if(!active(ctx)||ctx.draftId!==draftId)return;
          const root=ctx.messages.find(m=>m.id===retry.id);if(!root)return;
          await ThreadDB.put(ctx.owner,root.client_id,{id:root.client_id,mid:root.id,body:root.body,at:root.captured_at,media:'photo',phase:'resolve',retry:true,note:details.note,images,previews,review_only:true,draft_id:draftId});
          if(ctx.draftId!==draftId){await ThreadDB.remove(ctx.owner,root.client_id);return;}if(!active(ctx))return;photos.put(ctx.owner,root.client_id,draftId,previews);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);flush(ctx);
        }catch(e){status(ctx,e.message);}
      },{description:original==='Photo of food'?'':original,itemize,active:()=>active(ctx)&&ctx.draftId===draftId});
    };
    $$('[data-tool]',el).forEach(b=>b.onclick=()=>{const tool=b.dataset.tool;
      if(tool==='snap'||tool==='library'){if(!aiCan('food')){status(ctx,'Food photos need Kit access and your consent. You can type, search or enter numbers instead.');return;}if(tool==='snap')file.setAttribute('capture','environment');else file.removeAttribute('capture');file.click();}
      if(tool==='scan')scanSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),null,code=>send(ctx,barcodeChatInput(code)));
    });
    draw(ctx);const tool=new URLSearchParams(location.search).get('tool');
    if(tool&&['snap','scan','library'].includes(tool)){const url=new URL(location.href);url.searchParams.delete('tool');history.replaceState(history.state,'',url.pathname+url.search+url.hash);$('[data-tool="'+tool+'"]',el).click();}else if(field.value.trim())field.focus({preventScroll:true});
    ThreadDB.list(owner).then(jobs=>{if(active(ctx)){ctx.jobs=jobs;for(const job of jobs)ctx.visibleClients.add(job.id);if(!resumeActive&&!hasDay&&!hasMeal&&resumeId&&jobs.some(job=>job.draft_id===resumeId&&!['remove','remove-failed','complete'].includes(job.phase))){ctx.draftId=resumeId;if(resumeExplicitDay){ctx.day=resume.day;if(Object.hasOwn(MEAL_NAMES,resume.meal))ctx.meal=resume.meal;ctx.explicitDay=true;}ctx.historyDay=ctx.day;ctx.reuseChips.refresh();saveReviewDraft(ctx,true);drawFoodContext(ctx);}draw(ctx);flush(ctx);foodRemoval.flush(removalSession());}}).catch(e=>status(ctx,e.message));
    refresh(ctx);
    retryPendingNativeEntryAfterMount(ctx);
  }
  addEventListener('food:review-state',()=>{if(current&&active(current))primary(current);});
  addEventListener('online',()=>flush());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current&&active(current)){const ctx=current;refresh(ctx);sharedRecipes($('#thread-shared-recipes',ctx.el),()=>({day:ctx.day||isoDay(new Date()),meal:ctx.meal||guessMeal()}),()=>refresh(ctx),()=>active(ctx));flush(ctx);}});
  setInterval(()=>flush(),5000);
  function saveDraft(ctx,text){
    if(text)localStorage.setItem(draftKey(ctx.owner),JSON.stringify(text));else localStorage.removeItem(draftKey(ctx.owner));
  }
  function nativeReceipts(ctx){localStorage.setItem(nativeKey(ctx.owner),JSON.stringify(ctx.nativeEntries.slice(-100)));}
  function finishNativeDraft(ctx){
    if(!ctx.nativeEntries?.some(x=>x.pending))return;
    const old=ctx.nativeEntries;ctx.nativeEntries=old.map(({id,at})=>({id,at}));
    try{nativeReceipts(ctx);}catch(e){ctx.nativeEntries=old;throw e;}
  }
  function retryPendingNativeEntryAfterMount(ctx){
    const request=pendingNativeMountRetry;if(!request)return;pendingNativeMountRetry=null;
    if(request.owner!==ctx.owner||request.session!==ctx.session||!active(ctx)||location.pathname!=='/food/describe'||typeof Native.autoFoodEntry!=='function')return;
    const retry=()=>{if(active(ctx)&&location.pathname==='/food/describe')Native.autoFoodEntry();};
    const pending=Native.foodEntryTask;
    if(pending)pending.then(retry,retry).catch(()=>{});else retry();
  }
  function receiveNative(entry){
    const ctx=current;if(!ctx||!active(ctx)){
      if(location.pathname==='/food/describe'){
        const owner=ownerKey(),session=readOwner();if(owner&&session)pendingNativeMountRetry={owner,session};
      }
      return false;
    }
    if(!entry||typeof entry.id!=='string'||!/^[-a-f0-9]{36}$/i.test(entry.id)||!['shortcut','quick-action'].includes(entry.source)||(entry.text!=null&&(typeof entry.text!=='string'||entry.text.length>4000))){status(ctx,'A Shortcut entry was skipped because it was invalid.');return 'skip';}
    const field=$('#thread-text',ctx.el),id=entry.id.toLowerCase(),previous=field.value;
    ctx.nativeEntries=ctx.nativeEntries||[];
    let receipt=ctx.nativeEntries.find(x=>x.id===id);
    if(receipt&&!receipt.pending){field.focus({preventScroll:true});return true;}
    if(entry.text){
      const next=receipt?.pending?.next||(previous?previous+'\n'+entry.text:entry.text);
      if(next.length>4000){status(ctx,'A Shortcut was skipped because it would exceed 4,000 characters. Your existing draft is kept.');return 'skip';}
      if(receipt?.pending&&previous!==receipt.pending.before&&previous!==next){status(ctx,'Your edited draft is kept. Send or clear it before retrying the waiting Shortcut.');return false;}
      try{
        if(!receipt){receipt={id,at:Date.now(),pending:{before:previous,next}};const old=ctx.nativeEntries;ctx.nativeEntries=[...old,receipt];try{nativeReceipts(ctx);}catch(e){ctx.nativeEntries=old;throw e;}}
        saveDraft(ctx,next);field.value=next;saveReviewDraft(ctx,true);
        // The pending receipt makes a crash between these writes replay-safe.
        const old=ctx.nativeEntries;ctx.nativeEntries=old.map(x=>x.id===id?{id:x.id,at:x.at}:x);try{nativeReceipts(ctx);}catch(e){ctx.nativeEntries=old;/* durable text plus pending journal complete safely on retry */}
      }catch(error){status(ctx,'This phone could not save the Shortcut draft. It stays waiting; later entries can still be reviewed.');return false;}
      primary(ctx);status(ctx,previous?'Shortcut text added to your draft. Review it, then Send.':'Shortcut text ready. Review it, then Send.');
    }
    field.focus({preventScroll:true});return true;
  }
  async function pendingCount(){const owner=ownerKey();return owner?(await ThreadDB.list(owner)).length+(String(store.get(draftKey(owner))||'').trim()?1:0):0;}
  async function eraseDevice(){const owner=ownerKey();if(!owner)return;if(pendingNativeMountRetry?.owner===owner)pendingNativeMountRetry=null;privacyEpoch++;photos.clear(owner);const view=current;if(view?.owner===owner){view.messages=[];view.jobs=[];view.el.replaceChildren();current=null;}let failure;try{await ThreadDB.erase(owner);}catch(e){failure=e;}finally{let keys=[];try{keys=Object.keys(localStorage).filter(key=>key.startsWith('fit.kit.proposal:'+owner+':'));}catch(e){failure=failure||e;}for(const key of [...keys,cacheKey(owner),draftKey(owner),contextKey(owner),nativeKey(owner),reviewDraftKey(owner)]){try{localStorage.removeItem(key);}catch(e){failure=failure||e;}}}if(failure)throw failure;}
  return {collecting:()=>!!current&&active(current)&&location.pathname==='/food/describe',stage,stageDish:(did,portion)=>stage([],{dish:{did,portion}}),review:options=>current&&review(current,options),page,eraseDevice,pendingCount,receiveNative,accept:data=>merge(ownerKey(),data),refresh:()=>current&&refresh(current),send,ownerKey,source};
})();
