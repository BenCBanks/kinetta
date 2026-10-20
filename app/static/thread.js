// Permanent food conversation. Numbers and writes stay in authenticated server code;
// the outbox keeps user intent durable before clearing the composer.
'use strict';
// Keep a texting conversation at the latest message through keyboard/composer
// resizes, unless the person deliberately scrolls back to read older messages.
function foodChatViewport({list,composer,field,send,active}) {
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
  for(const event of ['resize','keyboardWillShow','keyboardDidShow','keyboardWillHide','keyboardDidHide'])addEventListener(event,()=>pin(),options);
  document.addEventListener?.('transitionend',e=>{if(e.target===list.closest?.('.shell'))pin();},options);
  window.visualViewport?.addEventListener('resize',()=>pin(),options);
  window.visualViewport?.addEventListener('scroll',()=>pin(),options);
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>pin()):null;
  observer?.observe(list);observer?.observe(composer);
  return {pin,dispose(){events.abort();observer?.disconnect();cancelAnimationFrame(frame);}};
}

const FoodThread = (() => {
  let current = null, privacyEpoch = 0;
  const ownerKey = () => App.me ? JSON.stringify([Native.base || location.origin, App.me.id]) : null;
  const uuid = () => { if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
  const cacheKey = owner => 'fit.thread.history:'+owner;
  const contextKey = owner => 'fit.thread.context:'+owner;
  const draftKey = owner => 'fit.thread.draft:'+owner;
  const reviewDraftKey=owner=>'fit.food.review.draft:'+owner;
  const nativeKey = owner => 'fit.thread.native:'+owner;
  const active = ctx => current===ctx && ctx.el.isConnected && ctx.owner===ownerKey() && ctx.session===readOwner();
  function remember(ctx) { store.set(cacheKey(ctx.owner),ctx.messages.slice(-80)); }
  async function merge(owner,data,write=true) {
    if(write&&owner===ownerKey())invalidate('/api/food');
    const ctx=current;
    if(!ctx || ctx.owner!==owner || !active(ctx))return;
    if(write)ctx.epoch++;
    const rows=[...(data.messages||[]),...(data.message?[data.message]:[]),...(data.updated_message?[data.updated_message]:[])];
    for(const m of rows){if(write&&m.kind==='user')ctx.visibleClients.add(m.client_id);const i=ctx.messages.findIndex(x=>x.id===m.id);if(i<0)ctx.messages.push(m);else ctx.messages[i]=m;}
    ctx.messages.sort((a,b)=>a.id-b.id);
    const completed=rows.find(m=>m.kind==='user'&&m.result?.draft_id===ctx.draftId&&rows.some(r=>r.reply_to===m.id&&r.result?.food_review&&r.result?.confirmed));
    if(completed){ctx.draftId=uuid();store.set(reviewDraftKey(ctx.owner),{id:ctx.draftId,meal:ctx.meal});ctx.context=null;ctx.reviewForm=null;store.del(contextKey(ctx.owner));}
    remember(ctx);draw(ctx);
  }
  const outbox=foodOutbox({db:ThreadDB,request:(path,body,options)=>api(path,{...json('POST',body),...options}),session:()=>readOwner()+':'+privacyEpoch,changed:merge,progress:async owner=>{const ctx=current;if(ctx&&active(ctx)&&ctx.owner===owner){ctx.jobs=await ThreadDB.list(owner);if(active(ctx))draw(ctx);}}});
  async function flush(ctx=null,force=false) {
    const owner=ctx?.owner||ownerKey();
    if(!owner||owner!==ownerKey()||(ctx&&ctx.session!==readOwner()))return;
    try {await outbox.flush(owner,{force});const view=current;if(view&&active(view)&&view.owner===owner){view.jobs=await ThreadDB.list(owner);draw(view);}}
    catch(e){if(current&&active(current))status(current,e.message);}
  }
  function status(ctx,text){if(!active(ctx))return;const box=$('#thread-status',ctx.el);box.textContent=text;clearTimeout(ctx.statusTimer);if(['Saved.','Food removed.'].includes(text))ctx.statusTimer=setTimeout(()=>{if(box.textContent===text)box.textContent='';},2500);}
  function source(entry) {
    const ref=entry.ref||{},origin=ref.origin;
    const names={usda:'USDA',off:'Open Food Facts',quick:'Your numbers',custom:'My foods',dish:'My Recipes',recent:'Your food log',ai:'Kit’s estimate'};
    let label=origin==='ai'?'Kit’s estimate':origin==='label'?'Nutrition label':names[ref.origin_ref?.source||ref.source||entry.source]||'Your food log';
    if(ref.estimated_portion)label+=' · estimated portion';
    if(ref.origin_edited)label+=' · Edited';
    return label;
  }
  function food(entry,index) {
    const unknown=entry.ref?.unknown_nutrients||[],protein=unknown.includes('protein_g')||entry.protein_g==null?'Protein unknown':`${r1(entry.protein_g)} g protein`;
    // Simple chat rows (2026-10-18, owner: "busy and messy"): tap a logged food to edit it; calories sit on the right.
    const inner=`<span class="tf-main"><strong>${esc(entry.name)}</strong><small>${esc(fmtAmount(entry))} · ${esc(source(entry))}${protein==='Protein unknown'?' · protein unknown':''}</small>${entry.ref?.origin_notes?`<small>${esc(entry.ref.origin_notes)}</small>`:''}</span><span class="tf-kcal num">${homeCalories(entry.kcal)}<small> kcal</small></span>`;
    return entry.id?`<button type="button" class="thread-food" data-entry="${index}" aria-label="Edit ${esc(entry.name)}, about ${homeCalories(entry.kcal)} kcal">${inner}</button>`:`<div class="thread-food">${inner}</div>`;
  }
  function choices(result) {
    if(result.correction&&result.choices?.length)return `<div class="thread-choices">${result.choices.map((c,i)=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify({select:i}))}">${esc(c.name)}${c.day?' · '+esc(dayLabel(c.day))+' · '+esc(MEAL_NAMES[c.meal]||c.meal):''}</button>`).join('')}</div>`;
    const parts=result.parts || (result.resolution?.items||[]).map((item,index)=>({index,status:item.status,item}));
    // One clarification at a time; the original card retains all pending parts.
    const part=parts.find(p=>p.status!=='ready'&&!p.logged);if(!part){const numbers=parts.find(p=>p.entered_numbers&&!p.logged);return numbers?`<button type="button" class="linkbtn" data-manual="${numbers.index}">Review numbers</button>`:'';}
    // Short food questions are answered in the composer, or with one tap on a suggested reply.
    if(part.description)return part.replies?.length?`<div class="thread-choices thread-replies">${part.replies.map(r=>`<button type="button" class="ghost" data-reply="${esc(r)}">${esc(r)}</button>`).join('')}</div>`:'';
    const item=part.item||{},options=[];
    for(const c of item.choices||[])options.push([c.name,{part:part.index,pick:{kind:c.kind,id:c.id}}]);
    for(const [i,f] of (part.catalog||[]).entries())options.push([f.name,{part:part.index,catalog:i}]);
    for(const o of item.options||[])options.push([o.label,{part:part.index,portion:o.portion}]);
    for(const o of part.scale_options||[])options.push([o.label,{part:part.index,factor:o.factor}]);
    if(item.new_ok)options.push(['Something new',{part:part.index,new:true}]);
    return `<div class="thread-choices">${options.map(([label,value])=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify(value))}">${esc(label)}</button>`).join('')}${aiCan('food')&&!part.drafts&&!item.kind&&['choose','quantity'].includes(part.status)?`<button type="button" class="ghost" data-estimate="${part.index}">Estimate calories with Kit</button>`:''}${part.entered_numbers?'':`<button type="button" class="linkbtn" data-portion="${part.index}">Change amount</button>`}<button type="button" class="linkbtn" data-manual="${part.index}">Enter nutrition</button></div>`;
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
  function replyHtml(root,reply) {
    const r=reply?.result||{},entries=reply?.entries||[];
    if(!r.error&&!r.cancelled&&!entries.length&&root.state!=='cancelled'&&(!reply&&root.state==='pending'||r.processing||r.can_resolve))return `<div class="thread-card thread-thinking" data-mid="${root.id}"><div class="thread-typing" role="status" aria-label="Checking your food"><span></span><span></span><span></span></div></div>`;
    const rows=entries.length?null:previewRows(root,r),preview=r.parts?.flatMap(p=>p.logged?[]:(p.entries||[]))||r.resolution?.items?.flatMap(i=>i.preview_entries||[])||[];
    const visible=entries.length?entries:(['preview','needs'].includes(r.kind)||r.pending_count||r.parts?.some(p=>p.status==='ready'&&!p.logged)?preview:[]),changed=changedNumbers(r,entries),removed=r.kind==='log'&&!entries.length&&r.entry_ids?.length;
    const day=entries[0]?.day||r.day,meal=entries[0]?.meal||r.meal;
    const canLog=!root.result?.review_only&&!r.cancelled&&(r.kind==='preview'||r.parts?.some(p=>p.status==='ready'&&!p.logged));
    return `<div class="thread-card" data-mid="${root.id}">${r.daily_note?`<h3>Your daily food summary</h3><p class="small muted">As of ${esc(new Date(r.as_of).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}. Later food is kept in your log.</p>`:''}${meal&&day&&!removed&&(!root.result?.review_only||entries.length)?`<button type="button" class="linkbtn thread-destination" data-destination>${esc(MEAL_NAMES[meal])} · ${esc(dayLabel(day))} ${svg('chev')}</button>`:''}
      ${root.result?.review_only&&visible.length&&r.kind!=='answer'&&!r.food_review&&!['reviewed','continued','cancelled'].includes(r.kind)?'<p class="small muted">Not logged yet</p>':''}${r.updated||changed?'<p class="thread-updated">Updated</p>':''}${rows?.length?rows.map(stepRow).join(''):visible.map(food).join('')}${visible.length>1?`<p class="thread-total"><span>Total</span><b class="num">≈ ${homeCalories(visible.reduce((n,e)=>n+(e.kcal||0),0))} kcal</b></p>`:''}${!visible.length||r.pending_count||r.kind==='answer'||r.kind==='edit'||(r.food_review&&r.confirmed)||r.parts?.some(p=>p.entered_numbers&&!p.logged)?`<p>${esc(removed?'This food was removed from your log.':kitFoodWords(reply?.body)||(root.state==='cancelled'?'Cancelled message.':root.state==='answered'?'Reply text removed. Your saved food is kept.':'Message received. Waiting to check your food…'))}</p>`:''}
      ${r.breakdown?.length?`<dl class="photo-breakdown">${r.breakdown.map(e=>`<div><dt>${esc(e.name)}${e.amount?`<small>${esc(e.amount)}</small>`:''}</dt><dd class="num">${e.kcal==null?'Unknown':`≈ ${esc(e.kcal)} kcal`}</dd></div>`).join('')}<div class="photo-breakdown-total"><dt>Total</dt><dd class="num">${r.breakdown_total==null?'Incomplete':`≈ ${esc(r.breakdown_total)} kcal`}</dd></div></dl>`:''}${r.breakdown_notes?.map(note=>`<p class="small muted">${esc(note)}</p>`).join('')||''}${r.photo_itemize?`<button type="button" class="ghost wide" data-photo-itemize="${r.photo_itemize}">Add photo for ingredient breakdown</button>`:''}
      ${r.assumed&&!entries.length?`<p class="small muted thread-assumed">${esc(r.assumed)}</p>`:''}${r.feedback&&!changed&&!removed?`<p class="thread-feedback">${esc(typeof r.feedback==='string'?r.feedback:r.feedback.text||'')}</p>`:''}
      ${r.error?`<p class="thread-error">${esc(kitFoodWords(r.error.message||r.error))}</p>`:''}${!r.cancelled&&(r.kind==='needs'||r.pending_count||r.parts?.some(p=>p.entered_numbers&&!p.logged))?choices(r):''}
      ${kitHtml(r)}<div class="thread-actions">${canLog?'<button type="button" class="ghost" data-action="log">Log these foods</button>':''}${entries.length?'<button type="button" class="linkbtn" data-action="undo">Undo</button>':''}${r.error||r.parts?.some(p=>p.needs_photo)?(root.result?.input?.kind==='photo'?'<button type="button" class="linkbtn" data-reattach>Add the photo again</button>':'<button type="button" class="linkbtn" data-action="resolve">Retry lookup</button>'):''}<button type="button" class="icon-btn thread-more" data-more aria-label="More options for this message">${svg('more')}</button></div></div>`;
  }
  // A "typing" bubble replaces interim text while food is checked (owner, 19 Oct 2026).
  // A "typing" bubble while the food is being checked, instead of interim text (owner, 19 Oct 2026).
  // Unconfirmed foods get − / + so amounts change right in the chat; each row knows its part and estimate.
  function previewRows(root,r){
    if(!root.result?.review_only||r.cancelled||r.food_review||!r.parts)return null;
    const rows=[];
    for(const p of r.parts){if(p.logged)continue;(p.entries||[]).forEach((e,j)=>{const d=p.entry_drafts?.[j];rows.push({e,part:p.index,draft:d,step:p.status==='ready'&&(d!=null?!!p.drafts?.[d]:!!p.item?.kind&&!p.templates)});});}
    return rows;
  }
  function stepRow(row){
    // The amount sits between − and +, like a quantity control: "− 3 servings +".
    const {e}=row;if(!row.step)return food(e);
    const data=`data-part="${row.part}"${row.draft!=null?` data-draft="${row.draft}"`:''}`,notes=e.ref?.origin_notes;
    return `<div class="thread-food has-stepper"><span class="tf-main"><strong>${esc(e.name)}</strong><span class="thread-stepper"><button type="button" class="icon-btn" data-step="-1" ${data} aria-label="Less ${esc(e.name)}">−</button><span class="num">${esc(fmtAmount(e))}</span><button type="button" class="icon-btn" data-step="1" ${data} aria-label="More ${esc(e.name)}">+</button></span><small>${esc(source(e))}${notes?' · '+esc(notes):''}</small></span><span class="tf-kcal num">${homeCalories(e.kcal)}<small> kcal</small></span></div>`;
  }

  const pendingReview=()=>(typeof FoodReview!=='undefined'&&FoodReview.busy())||Q.mine().some(op=>/^\/api\/food\/thread\/reviews\/\d+\/confirm$/.test(op.path));
  const waitingJobs=ctx=>ctx.jobs.some(j=>j.draft_id===ctx.draftId&&!j.error);
  function held(ctx){
    // A food still waiting on a question is left out of the review rather than blocking the others.
    const ids=[];let ready=0,open=0,kcal=0;
    for(const m of ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.review_only&&m.result?.draft_id===ctx.draftId&&!ctx.jobs.some(j=>j.id===m.client_id&&j.error))){
      const r=ctx.messages.find(x=>x.reply_to===m.id)?.result||{};
      if(r.food_review||['reviewed','undone','cancelled'].includes(r.kind)||m.state==='cancelled')continue;
      const parts=r.parts||[];
      const waiting=parts.filter(p=>!p.logged&&!(p.status==='ready'&&(!p.entered_numbers||p.manual)));
      if(waiting.length){open++;continue;}
      const done=parts.filter(p=>!p.logged);if(done.length){ids.push(m.id);for(const p of done){ready+=Math.max(1,(p.entries||[]).length);for(const e of p.entries||[])kcal+=Number(e.kcal)||0;}}
    }
    return {ids,ready,open,kcal};
  }
  function primary(ctx){
    // A slim strip on the composer (owner, 19 Oct 2026: the full-width button looked out of place).
    if(!active(ctx))return;const state=held(ctx),button=$('#thread-review',ctx.el),sum=$('#thread-review-sum',ctx.el);
    button.hidden=!state.ready;button.disabled=!!ctx.preparingReview||waitingJobs(ctx)||pendingReview();button.setAttribute('aria-busy',String(!!ctx.preparingReview));
    const what=`${state.ready} food${state.ready===1?'':'s'} · ≈ ${homeCalories(state.kcal)} kcal`;
    sum.textContent=ctx.preparingReview?'Preparing your review…':pendingReview()?'Your review is waiting to save…':button.disabled?`${what} · checking…`:what;
    // Unanswered foods stay visible as question cards; the strip says only what will be reviewed.
    button.setAttribute('aria-label',`Add to log: ${sum.textContent}`+(state.open?`. ${state.open} unanswered food${state.open===1?' is':'s are'} not included.`:''));
    $('#thread-send',ctx.el).classList.add('primary');$('#thread-send',ctx.el).classList.remove('ghost');
  }
  async function review(ctx,{saveRecipe=ctx.saveRecipe}={}){
    if(!active(ctx)||ctx.preparingReview)return;
    if($('#thread-text',ctx.el).value.trim()){status(ctx,'Send your unsent text first, or clear it to review the foods already added.');return;}
    const state=held(ctx);if(!state.ready||waitingJobs(ctx)||pendingReview()){status(ctx,'Finish the food details before reviewing.');return;}
    ctx.preparingReview=true;primary(ctx);
    try {
      await FoodReview.open({done:result=>{if(!result.queued)wipe(ctx);},messages:state.ids,draftId:ctx.draftId,meal:ctx.meal,saveRecipe,draftForm:ctx.reviewForm,rememberForm:form=>{ctx.reviewForm=form;store.set(reviewDraftKey(ctx.owner),{id:ctx.draftId,meal:ctx.meal,form});},active:()=>active(ctx),accept:data=>merge(ctx.owner,data)});
    } finally {ctx.preparingReview=false;primary(ctx);}
  }
  async function stage(items,{dish=null}={}){
    const ctx=current;if(!ctx||!active(ctx))throw Error('Open food entry to add these foods.');
    if(ctx.preparingReview||pendingReview())throw Error('Your food review is still saving. Wait or reconnect before adding more foods.');
    const id=uuid(),job={id,body:dish?'Recipe portion':items.map(e=>e.name).join(', '),at:new Date().toISOString(),phase:'process',draft_id:ctx.draftId,...(dish?{dish}:{items:items.map(foodStorage)})};
    await ThreadDB.put(ctx.owner,id,job);ctx.visibleClients.add(id);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);await flush(ctx);
    return {held:true,queued:(await ThreadDB.list(ctx.owner)).some(j=>j.id===id)};
  }
  function draw(ctx) {
    if(!active(ctx))return;
    const list=$('#thread-messages',ctx.el),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
    const roots=ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.kind!=='food_review').sort((a,b)=>a.captured_at.localeCompare(b.captured_at)||a.id-b.id),ids=new Set();let anchor=list.firstElementChild,lastDay=null;
    for(const m of roots) {
      const reply=ctx.messages.find(r=>r.reply_to===m.id),job=ctx.jobs.find(j=>j.id===m.client_id);
      const id='message-'+m.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);
      const separator=m.local_day!==lastDay?`<h2 class="thread-day">${esc(dayLabel(m.local_day))}</h2>`:'';lastDay=m.local_day;
      const user=`<div class="thread-user"><p>${esc(m.body)}</p><time class="vh" datetime="${esc(m.captured_at)}">${esc(dayLabel(m.local_day))} · ${esc(new Date(m.captured_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}</time></div>`;
      const replied=replyHtml(m,reply);let waiting=job?pendingHtml(job,outbox.isSending(ctx.owner,job.id)):'';
      if(replied.includes('thread-thinking')&&waiting.includes('thread-thinking'))waiting='';   // one typing bubble, not two
      const html=`${separator}${m.result?.receipt||m.result?.daily_note?'':user}${replied}${waiting}`;
      if(!node){node=document.createElement('article');node.dataset.key=id;}
      if(node===anchor)anchor=anchor.nextElementSibling;else list.insertBefore(node,anchor);
      if(node._html!==html){node.innerHTML=html;node._html=html;wireCard(ctx,node,m,reply);if(job)wirePending(ctx,node,job);}
    }
    for(const j of ctx.jobs.filter(j=>!roots.some(m=>m.client_id===j.id))){const id='queued-'+j.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);if(!node){node=document.createElement('article');node.dataset.key=id;list.append(node);}const html=`<div class="thread-user"><p>${esc(j.body)}</p></div>${pendingHtml(j,outbox.isSending(ctx.owner,j.id))}`;if(node._html!==html){node.innerHTML=html;node._html=html;wirePending(ctx,node,j);}}
    for(const node of [...list.children])if(!ids.has(node.dataset.key))node.remove();
    // Failed local messages keep their original place; a fresh reply belongs at
    // the bottom, rather than above an appended block of older failures.
    const order=[...roots.map(m=>({key:'message-'+m.id,at:m.captured_at})),...ctx.jobs.filter(j=>!roots.some(m=>m.client_id===j.id)).map(j=>({key:'queued-'+j.id,at:j.at}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key));
    const nodes=new Map([...list.children].map(node=>[node.dataset.key,node]));
    order.forEach((row,index)=>{const node=nodes.get(row.key);if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);});
    ctx.el.classList.toggle('has-messages',!!roots.length||!!ctx.jobs.length);
    list.hidden=!roots.length&&!ctx.jobs.length;
    $('#thread-empty',ctx.el).hidden=!list.hidden;
    $('#thread-older',ctx.el).hidden=true;
    if(!ctx.pauseFollow){if(ctx.chatView)ctx.chatView.pin(ctx.follow||ctx.initial);else if(bottom||ctx.follow||ctx.initial)list.scrollTop=list.scrollHeight;if(list.children.length)ctx.initial=false;}
    ctx.follow=false;primary(ctx);
  }
  function pendingHtml(job,sending=false){
    if(!job.error&&job.phase!=='cancel'&&(sending||job.mid)&&!job.offline&&navigator.onLine)return '<div class="thread-card thread-thinking"><div class="thread-typing" role="status" aria-label="Checking your food"><span></span><span></span><span></span></div></div>';
    const text=job.error||(job.phase==='cancel'?'Cancelling when connected…':sending?(job.mid?'Checking food…':'Sending…'):job.offline||!navigator.onLine?'Saved on this phone · waiting for connection':job.mid?'Message received · waiting to check your food':'Saved on this phone · waiting to send');
    return `<div class="thread-pending"><p>${esc(text)}</p>${job.phase!=='cancel'&&!sending?'<button type="button" class="linkbtn" data-retry>Retry</button>':''}<button type="button" class="linkbtn" data-cancel>Cancel</button></div>`;
  }
  function wirePending(ctx,node,job){
    const retry=$('[data-retry]',node);if(retry)retry.onclick=async()=>{if(!active(ctx))return;
      if(job.draft_id&&job.draft_id!==ctx.draftId){
        const state=held(ctx);if(state.ready||state.open||waitingJobs(ctx)||$('#thread-text',ctx.el).value.trim()){status(ctx,'Finish your current food review before retrying this older message.');return;}
        ctx.draftId=job.draft_id;ctx.context=null;ctx.reviewForm=null;store.set(reviewDraftKey(ctx.owner),{id:ctx.draftId,meal:ctx.meal});store.del(contextKey(ctx.owner));
      }
      await ThreadDB.update(ctx.owner,job.id,j=>({...j,error:null,offline:false}));flush(ctx,true);};
    const cancel=$('[data-cancel]',node);if(cancel)cancel.onclick=async()=>{if(!active(ctx))return;try{
      await ThreadDB.update(ctx.owner,job.id,j=>({...j,error:null,phase:'cancel',images:undefined}));
      ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);
      if(navigator.onLine){try{await api('/api/food/thread/cancel',json('POST',{client_id:job.id}));await ThreadDB.remove(ctx.owner,job.id);}catch(e){if(e.status===409){await ThreadDB.remove(ctx.owner,job.id);toast(e.message);}else throw e;}}
      const root=ctx.messages.find(m=>m.client_id===job.id);if(root){root.state='cancelled';const reply=ctx.messages.find(m=>m.reply_to===root.id);if(reply){reply.result={...reply.result,cancelled:true};reply.body=reply.entries?.length?'Stopped checking. Saved food is kept; use Undo to remove it.':'Cancelled this food message.';}}ctx.jobs=await ThreadDB.list(ctx.owner);remember(ctx);draw(ctx);
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
  function wireCard(ctx,node,m,reply){
    const r={...(reply?.result||{}),...(reply?.entries?.[0]?{day:reply.entries[0].day,meal:reply.entries[0].meal}:{})};
    const itemize=$('[data-photo-itemize]',node);if(itemize)itemize.onclick=()=>{ctx.photoRetry={id:+itemize.dataset.photoItemize,itemize:true};const file=$('#ql-file',ctx.el);file.removeAttribute('capture');file.click();};
    const reattach=$('[data-reattach]',node);if(reattach)reattach.onclick=()=>{ctx.photoRetry=m.id;const file=$('#ql-file',ctx.el);file.removeAttribute('capture');file.click();};
    $$('[data-action]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,b.dataset.action,b.dataset.action==='log'?{confirm:true}:b.dataset.action==='resolve'?{retry:true}:{});}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    const kit=$('[data-kit]',node);if(kit)kit.onclick=async()=>{if(!active(ctx))return;kit.disabled=true;status(ctx,'Checking your food records…');try{const data=await action(ctx,m.id,'kit',{});status(ctx,data.processing?'Kit is still checking. Tap Check Kit answer shortly.':'Answer saved.');}catch(e){toast(e.message);}finally{if(kit.isConnected)kit.disabled=false;}};
    const review=$('[data-kit-review]',node);if(review)review.onclick=()=>{if(!active(ctx))return;kitReview(r.kit.selection,{scopeKey:m.client_id,onStale:async()=>{await action(ctx,m.id,'kit',{refresh:true});},onSaved:async data=>{if(active(ctx)){await merge(ctx.owner,data);await refresh(ctx);}}});};
    $$('[data-choice]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,'choose',JSON.parse(b.dataset.choice));}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    $$('[data-entry]',node).forEach(b=>b.onclick=()=>{entrySheet(reply.entries[+b.dataset.entry],reply.entries[+b.dataset.entry].day);});
    const dest=$('[data-destination]',node);if(dest)dest.onclick=()=>destination(ctx,m,r);
    $$('[data-step]',node).forEach(b=>b.onclick=async()=>{
      const p=r.parts?.find(x=>x.index===+b.dataset.part);if(!p)return;const up=+b.dataset.step>0;
      const old=b.dataset.draft!=null?p.drafts?.[+b.dataset.draft]?.portion:p.item?.portion;if(!old)return;
      const next=old.grams?null:old.count>1||up?Math.max(.5,(old.count>=1?Math.round(old.count):old.count)+(up?1:-1)):old.count/2;
      const factor=old.grams?(up?1.25:.8):next/old.count;if(!(factor>0)||next!=null&&next<.25)return;
      b.disabled=true;Native.haptic('selection');
      const body=b.dataset.draft!=null?{part:p.index,draft:+b.dataset.draft,factor}:{part:p.index,portion:old.grams?{grams:Math.round(old.grams*factor)}:{count:next,...(old.unit?{unit:old.unit}:{})}};
      try{await action(ctx,m.id,'choose',body);}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}
    });
    $$('[data-reply]',node).forEach(b=>b.onclick=()=>{if(!$('#thread-text',ctx.el).value.trim())send(ctx,{body:b.dataset.reply});else status(ctx,'Send or clear your typed message first.');});
    $$('[data-estimate]',node).forEach(b=>b.onclick=()=>action(ctx,m.id,'resolve',{retry:true,allow_brand_estimate:true,part:+b.dataset.estimate}).catch(()=>{}));
    $$('[data-portion]',node).forEach(b=>b.onclick=()=>portion(ctx,m,+b.dataset.portion));
    $$('[data-manual]',node).forEach(b=>b.onclick=()=>manual(ctx,m,+b.dataset.manual,r));
    const more=$('[data-more]',node);if(more)more.onclick=()=>sheet('Food message',`<button type="button" class="ghost wide" id="thread-correct">Correct in chat</button><button type="button" class="linkbtn danger" id="thread-delete">Delete message text</button><p>Deleting the message keeps saved food. Use Undo to remove its food.</p>`,(b,close)=>{
      $('#thread-correct',b).onclick=()=>{ctx.context=m.client_id;store.set(contextKey(ctx.owner),ctx.context);close();$('#thread-text',ctx.el).focus();status(ctx,'Try “make it half” or name the food you want to change.');};
      $('#thread-delete',b).onclick=async()=>{if(!active(ctx))return;try{await api(`/api/food/thread/messages/${m.id}`,{method:'DELETE'});await ThreadDB.remove(ctx.owner,m.client_id);ctx.jobs=await ThreadDB.list(ctx.owner);ctx.epoch++;ctx.messages=ctx.messages.filter(x=>x.id!==m.id&&x.reply_to!==m.id);remember(ctx);draw(ctx);close();}catch(e){toast(e.message);}};
    });
  }
  function destination(ctx,m,r){sheet('Meal and day',`<form class="form" id="thread-destination"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k,v])=>`<option value="${k}"${k===r.meal?' selected':''}>${v}</option>`).join('')}</select></label><label>Day<input name="day" type="date" value="${esc(r.day)}" required></label><button class="primary wide">Save</button></form>`,(b,close)=>{$('#thread-destination',b).onsubmit=async e=>{e.preventDefault();try{await action(ctx,m.id,'destination',{meal:e.target.meal.value,day:e.target.day.value},'PUT');close();}catch(e){toast(e.message);}};});}
  function portion(ctx,m,index){sheet('Set portion','<form class="form" id="thread-portion"><label>Amount<input name="amount" type="number" min="0.01" step="any" required inputmode="decimal"></label><label>Unit<select name="unit"><option value="count">Servings</option><option value="grams">Grams</option><option value="share">Share of the whole (0.5 = half)</option></select></label><button class="primary wide">Use this portion</button></form>',(b,close)=>{$('#thread-portion',b).onsubmit=async e=>{e.preventDefault();try{await action(ctx,m.id,'choose',{part:index,portion:{[e.target.unit.value]:+e.target.amount.value}});close();}catch(e){toast(e.message);}};});}
  function manual(ctx,m,index,result={}){const supplied=result.parts?.find(p=>p.index===index)?.entered_numbers,values=supplied?.values||{};sheet('Enter nutrition',`<form class="form" id="thread-manual"><label>Food<input name="name" value="${esc(supplied?.name||m.body.slice(0,200))}" maxlength="200" required></label>${macroInputs(values)}<p>Enter calories. Leave nutrients blank if you don’t know them; blank means unknown.</p><button class="primary wide">Use these numbers</button></form>`,(b,close)=>{guardFoodSheet(b,close,ctx.session);$('#thread-manual',b).onsubmit=async e=>{e.preventDefault();const f=e.target,item={name:f.name.value,amount:1,unit:'serving'};for(const k of FOOD_NUTRIENTS)item[k]=f[k].value.trim()===''?null:Number(f[k].value);if(item.kcal===null||!Number.isFinite(item.kcal)||item.kcal<0){f.kcal.setCustomValidity('Enter calories before logging.');f.kcal.reportValidity();f.kcal.oninput=()=>f.kcal.setCustomValidity('');return;}try{await action(ctx,m.id,'manual',{part:index,items:[item],confirm:true});close();}catch(e){toast(e.message);}};});}
  async function refresh(ctx,before=null){
    if(!active(ctx))return;
    const epoch=ctx.epoch,version=++ctx.readVersion;
    try{const data=await api('/api/food/thread/reviews/draft/'+ctx.draftId);if(!active(ctx)||ctx.epoch!==epoch||ctx.readVersion!==version)return;ctx.before=data.before;ctx.preferences=data.preferences;
      if(!before){const first=data.messages[0]?.id;ctx.messages=data.has_more?ctx.messages.filter(m=>m.id<first):[];}
      for(const m of data.messages||[])if(m.kind==='user'&&m.result?.draft_id===ctx.draftId)ctx.visibleClients.add(m.client_id);
      await merge(ctx.owner,data,false);const restored=await restoreFoodPending({db:ThreadDB,owner:ctx.owner,draftId:ctx.draftId,messages:data.messages||[]});if(!active(ctx))return;ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);status(ctx,'');if(restored)flush(ctx);}
    catch(e){status(ctx,e.offline?'Offline. Your saved conversation and pending messages stay on this phone.':foodThreadError(e,'/api/food/thread/reviews/draft/'+ctx.draftId));}
  }
  function latestContext(ctx){
    const previous=ctx.messages.filter(m=>m.kind==='user'&&ctx.visibleClients.has(m.client_id)&&m.result?.draft_id===ctx.draftId&&!ctx.jobs.some(j=>j.id===m.client_id&&j.error)&&['log','needs','preview','undone'].includes(m.result?.kind)).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at)||a.id-b.id).at(-1);
    const pending=ctx.jobs.filter(j=>j.phase!=='cancel'&&!j.error&&j.draft_id===ctx.draftId).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
    return pending&&(!previous||Date.parse(pending.at)>Date.parse(previous.captured_at))?pending.id:previous?.client_id;
  }
  async function send(ctx,{body,media='text',barcode,images,itemize=false,replaceDraft}={}) {
    if(!active(ctx))return;const field=$('#thread-text',ctx.el),text=(body||field.value).trim();if(!text)return;
    if(ctx.preparingReview||pendingReview()){status(ctx,'Your food review is still saving. Wait or reconnect before adding more foods.');return;}
    if(text.length>4000){status(ctx,'Keep this message under 4,000 characters.');return;}
    // A self context prevents the server from falling back to a previous visit's food.
    const context=ctx.jobs.some(j=>j.id===ctx.context&&j.error)?null:ctx.context;
    const consumesDraft=!body||field.value.trim()===text||replaceDraft!==undefined&&field.value===replaceDraft;
    const id=uuid(),job={id,body:text,itemize,at:new Date().toISOString(),media,barcode,images,review_only:true,draft_id:ctx.draftId,phase:'process',context:context||latestContext(ctx)||id,day:isoDay(new Date()),...(ctx.meal?{meal:ctx.meal}:{})};
    const button=$('#thread-send',ctx.el);if(button.disabled)return;button.disabled=true;
    try{if(consumesDraft){finishNativeDraft(ctx);saveDraft(ctx,'');}await ThreadDB.put(ctx.owner,job.id,job);if(!active(ctx))return;ctx.visibleClients.add(job.id);
      if(consumesDraft){field.value='';field.style.height='';store.del(draftKey(ctx.owner));}ctx.context=null;ctx.reviewForm=null;store.del(contextKey(ctx.owner));
      ctx.jobs=await ThreadDB.list(ctx.owner);ctx.follow=true;draw(ctx);status(ctx,'');Native.haptic();flush(ctx);
    }catch(e){status(ctx,e.message);}finally{if(active(ctx))button.disabled=false;}
  }
  function preferences(ctx){if(!ctx.preferences){status(ctx,'Wait for food chat settings to load, then try again.');return;}const p=ctx.preferences;sheet('Food chat settings',`<button type="button" class="ghost wide danger" id="thread-clear">Clear chat</button><p class="small muted">Clears the conversation on this and your other devices. Food you’ve logged stays in your log. The chat also starts fresh each day.</p><form class="form" id="thread-preferences"><p>Food waits for the final review before it is logged. Logged cards have Undo and Edit.</p><label>Feedback<select name="tone"><option value="supportive"${p.tone==='supportive'?' selected':''}>Supportive</option><option value="numbers"${p.tone==='numbers'?' selected':''}>Just the numbers</option></select></label><button class="primary wide">Save settings</button></form>`,(b,close)=>{$('#thread-clear',b).onclick=()=>clearChat(ctx,close);$('#thread-preferences',b).onsubmit=async e=>{e.preventDefault();if(!active(ctx))return;try{const value={tone:e.target.tone.value,daily_note:'off'};const saved=await api('/api/food/thread/preferences',json('PUT',value));if(!active(ctx))return;ctx.preferences=saved;close();toast('Food chat settings saved');}catch(e){toast(e.message);}};});}
  // Clear the conversation on the server and this phone. Logged food is never touched.
  async function wipe(ctx){
    if(!active(ctx))return;
    try{await api('/api/food/thread/clear',json('POST',{confirm:true}));}catch(e){return;}   // a failed clear just leaves the chat as it was
    await ThreadDB.erase(ctx.owner);store.del(cacheKey(ctx.owner));store.del(contextKey(ctx.owner));
    ctx.messages=[];ctx.jobs=[];ctx.visibleClients=new Set();ctx.context=null;ctx.reviewForm=null;ctx.draftId=uuid();ctx.epoch++;
    store.set(reviewDraftKey(ctx.owner),{id:ctx.draftId,meal:ctx.meal});if(active(ctx))draw(ctx);
  }
  async function clearChat(ctx,close){
    if(!active(ctx))return;
    if(ctx.preparingReview||pendingReview()){status(ctx,'Wait for your food to finish saving, then clear the chat.');return;}
    close();
    sheet('Clear chat?','<p>The conversation is removed on all your devices. Food you’ve logged stays in your log.</p><button type="button" class="primary wide danger" id="thread-clear-yes">Clear chat</button>',(b,done)=>{$('#thread-clear-yes',b).onclick=async()=>{
    try{await api('/api/food/thread/clear',json('POST',{confirm:true}));
      await ThreadDB.erase(ctx.owner);store.del(cacheKey(ctx.owner));store.del(contextKey(ctx.owner));store.del(draftKey(ctx.owner));
      ctx.messages=[];ctx.jobs=[];ctx.visibleClients=new Set();ctx.context=null;ctx.reviewForm=null;ctx.draftId=uuid();ctx.epoch++;
      store.set(reviewDraftKey(ctx.owner),{id:ctx.draftId,meal:ctx.meal});$('#thread-text',ctx.el).value='';draw(ctx);done();toast('Chat cleared');}
    catch(e){toast(e.message);}};});
  }
  function page(el,{day,meal}={}){
    const owner=ownerKey(),resume=store.get(reviewDraftKey(owner)),ctx={el,owner,meal:Object.hasOwn(MEAL_NAMES,meal)?meal:(Object.hasOwn(MEAL_NAMES,resume?.meal)?resume.meal:null),session:readOwner(),draftId:(typeof resume==='string'?resume:resume?.id)||uuid(),saveRecipe:new URLSearchParams(location.search).get('save')==='1',reviewForm:resume?.form||null,messages:[],visibleClients:new Set(),context:resume?store.get(contextKey(owner)):null,jobs:[],before:null,follow:false,initial:true,epoch:0,readVersion:0};current?.chatView?.dispose();current=ctx;store.set(reviewDraftKey(owner),{id:ctx.draftId,meal:ctx.meal,form:ctx.reviewForm});
    el.classList.add('food-thread');el.setAttribute('aria-live','off');
    const tile=(attr,ico,label)=>`<button type="button" ${attr}>${svg(ico)}<span>${label}</span></button>`;
    el.innerHTML=`<header class="thread-heading"><a class="back" href="/food">${svg('back')}Nutrition</a><h1>Add food</h1><button type="button" class="icon-btn" id="thread-settings" aria-label="Food chat settings">${svg('more')}</button></header><button type="button" class="linkbtn" id="thread-older" hidden>Earlier messages</button><div id="thread-messages" aria-live="off"></div><div id="thread-empty"><h2>What did you eat?</h2><p>Just tell me, like “2 eggs and toast”. I’ll estimate it, you can adjust the amounts, then tap Add to log. Use + for photos, barcodes and search.</p></div><form id="thread-composer" class="thread-composer"><div id="thread-shared-recipes"></div><div class="thread-menu" id="thread-menu" hidden><div class="thread-tools">${tile('data-tool="snap"','camera','Camera')}${tile('data-tool="library"','image','Photo')}${tile('data-tool="scan"','barcode','Barcode')}${tile('id="thread-search"','search','Search')}${tile('id="thread-usuals"','clock','Usuals')}${tile('id="thread-recipes"','pot','Recipes')}${tile('id="thread-manual-add"','edit','Manual')}</div></div><label class="vh" for="thread-text">Message about your food</label><button type="button" class="thread-review-strip" id="thread-review" hidden><span id="thread-review-sum"></span><span class="thread-review-go">Add to log ›</span></button><div class="thread-compose-row"><button type="button" class="icon-btn thread-plus" id="thread-plus" aria-label="More ways to add food" aria-expanded="false" aria-controls="thread-menu">${svg('plus')}</button><textarea id="thread-text" rows="1" maxlength="4000" enterkeyhint="send" placeholder="What did you eat?"></textarea><button class="primary thread-send" id="thread-send" aria-label="Send">${svg('send')}</button></div><p id="thread-status" role="status" aria-live="polite"></p><input type="file" id="ql-file" accept="image/*" multiple hidden></form>`;
    // The + menu holds every other way to add food, so the bar stays one line like a messaging app.
    // + opens the tools as an ordinary bottom sheet (owner: the inline panel looked out of place). The tool
    // buttons keep living in the hidden menu, so the sheet shows clones that click the real ones.
    const menu=$('#thread-menu',el),plus=$('#thread-plus',el),openMenu=open=>{if(!open)return;Native.haptic('selection');field.blur();
      sheet('Add food',`<div class="thread-tools thread-tools-sheet">${$$('.thread-tools button',menu).map((b,i)=>`<button type="button" data-clone="${i}">${b.innerHTML}</button>`).join('')}</div>`,(b,close)=>{
        $$('[data-clone]',b).forEach(x=>x.onclick=()=>{close();const target=$$('.thread-tools button',menu)[+x.dataset.clone];setTimeout(()=>target.click(),0);});});};
    plus.onclick=()=>openMenu(true);
    $('#thread-review',el).onclick=()=>review(ctx);
    $('#thread-manual-add',el).onclick=()=>typeSheet('', '', async values=>{
      const {grams,...nutrition}=values;
      await stage([{...nutrition,day:isoDay(new Date()),meal:ctx.meal||'snacks',amount:grams||1,unit:grams?'g':'serving',source:'quick'}]);return true;
    });
    const field=$('#thread-text',el);field.value=String(store.get(draftKey(owner))||'');
    ctx.nativeEntries=(store.get(nativeKey(owner))||[]).filter(x=>x&&x.at>Date.now()-86400000).slice(-100);
    const grow=()=>{field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';};
    field.addEventListener('input',grow);
    field.oninput=()=>{if(!field.value.trim()){ctx.context=null;store.del(contextKey(owner));}else if(!ctx.context){ctx.context=latestContext(ctx);if(ctx.context)store.set(contextKey(owner),ctx.context);}primary(ctx);try{saveDraft(ctx,field.value);}catch(e){status(ctx,'Draft storage is full. Keep this screen open until you send.');}};
    ctx.chatView=foodChatViewport({list:$('#thread-messages',el),composer:$('#thread-composer',el),field,send:$('#thread-send',el),active:()=>active(ctx)});
    field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#thread-composer',el).requestSubmit();}});
    $('#thread-composer',el).onsubmit=e=>{e.preventDefault();send(ctx);};
    $('#thread-settings',el).onclick=()=>preferences(ctx);
    $('#thread-usuals',el).onclick=()=>addSheet(isoDay(new Date()),ctx.meal||guessMeal());
    $('#thread-recipes',el).onclick=()=>addSheet(isoDay(new Date()),ctx.meal||guessMeal(),'','saved');
    $('#thread-search',el).onclick=()=>addSheet(isoDay(new Date()),ctx.meal||guessMeal(),'','search');
    $('#thread-older',el).onclick=async()=>{const list=$('#thread-messages',el),h=list.scrollHeight,y=list.scrollTop;ctx.pauseFollow=true;try{await refresh(ctx,ctx.before);if(active(ctx))list.scrollTop=y+list.scrollHeight-h;}finally{ctx.pauseFollow=false;}};
    const file=$('#ql-file',el);file.onchange=()=>{const files=[...file.files];file.value='';const pending=ctx.photoRetry;ctx.photoRetry=null;
      const retry=typeof pending==='number'?{id:pending}:pending,replaceDraft=field.value;
      const prior=retry?ctx.messages.find(m=>m.reply_to===retry.id)?.result:null;
      const original=retry?prior?.photo_request_note||prior?.parts?.find(p=>p.photo_description)?.photo_description||ctx.messages.find(m=>m.id===retry.id)?.body||'':replaceDraft;
      reviewFoodPhotos(files,(images,details)=>retry?action(ctx,retry.id,'resolve',{retry:true,images,note:details.note,itemize:details.itemize}).catch(e=>toast(e.message)):send(ctx,{body:details.note||'Photo of food',media:'photo',images,itemize:details.itemize,replaceDraft}),{description:original==='Photo of food'?'':original,itemize:!!(retry?.itemize||prior?.parts?.some(p=>p.photo_itemized)||ctx.messages.find(m=>m.id===retry?.id)?.result?.input?.itemize),active:()=>active(ctx)});
    };
    $$('[data-tool]',el).forEach(b=>b.onclick=()=>{const tool=b.dataset.tool;
      if(tool==='snap'||tool==='library'){if(!aiCan('food')){status(ctx,'Food photos need Kit access and your consent. You can type, search or enter numbers instead.');return;}if(tool==='snap')file.setAttribute('capture','environment');else file.removeAttribute('capture');file.click();}
      if(tool==='scan')scanSheet(isoDay(new Date()),ctx.meal||guessMeal(),null,code=>send(ctx,{body:'Scanned product '+code,media:'barcode',barcode:code}));
      if(tool==='paste'&&false){field.focus();status(ctx,'Paste text with your keyboard, or choose a photo from Photo library.');if(navigator.clipboard?.readText)navigator.clipboard.readText().then(text=>{if(active(ctx)&&text){field.value=(field.value+text).slice(0,4000);field.oninput();}}).catch(()=>{});}
    });
    draw(ctx);const tool=new URLSearchParams(location.search).get('tool');
    if(tool&&['snap','scan','library'].includes(tool)){const url=new URL(location.href);url.searchParams.delete('tool');history.replaceState(history.state,'',url.pathname+url.search+url.hash);$('[data-tool="'+tool+'"]',el).click();}else field.focus({preventScroll:true});
    ThreadDB.list(owner).then(jobs=>{if(active(ctx)){ctx.jobs=jobs;for(const job of jobs)ctx.visibleClients.add(job.id);draw(ctx);flush(ctx);}}).catch(e=>status(ctx,e.message));
    refresh(ctx);
  }
  addEventListener('food:review-state',()=>{if(current&&active(current))primary(current);});
  addEventListener('online',()=>flush());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current&&active(current)){const ctx=current;refresh(ctx);sharedRecipes($('#thread-shared-recipes',ctx.el),()=>({day:isoDay(new Date()),meal:guessMeal()}),()=>refresh(ctx),()=>active(ctx));flush(ctx);}});
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
  function receiveNative(entry){
    const ctx=current;if(!ctx||!active(ctx))return false;
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
        saveDraft(ctx,next);field.value=next;
        // The pending receipt makes a crash between these writes replay-safe.
        const old=ctx.nativeEntries;ctx.nativeEntries=old.map(x=>x.id===id?{id:x.id,at:x.at}:x);try{nativeReceipts(ctx);}catch(e){ctx.nativeEntries=old;/* durable text plus pending journal complete safely on retry */}
      }catch(error){status(ctx,'This phone could not save the Shortcut draft. It stays waiting; later entries can still be reviewed.');return false;}
      primary(ctx);status(ctx,previous?'Shortcut text added to your draft. Review it, then Send.':'Shortcut text ready. Review it, then Send.');
    }
    field.focus({preventScroll:true});return true;
  }
  async function pendingCount(){const owner=ownerKey();return owner?(await ThreadDB.list(owner)).length+(String(store.get(draftKey(owner))||'').trim()?1:0):0;}
  async function eraseDevice(){const owner=ownerKey();if(!owner)return;privacyEpoch++;const view=current;if(view?.owner===owner){view.messages=[];view.jobs=[];view.el.replaceChildren();current=null;}let failure;try{await ThreadDB.erase(owner);}catch(e){failure=e;}finally{let keys=[];try{keys=Object.keys(localStorage).filter(key=>key.startsWith('fit.kit.proposal:'+owner+':'));}catch(e){failure=failure||e;}for(const key of [...keys,cacheKey(owner),draftKey(owner),contextKey(owner),nativeKey(owner),reviewDraftKey(owner)]){try{localStorage.removeItem(key);}catch(e){failure=failure||e;}}}if(failure)throw failure;}
  return {collecting:()=>!!current&&active(current)&&location.pathname==='/food/describe',stage,stageDish:(did,portion)=>stage([],{dish:{did,portion}}),review:options=>current&&review(current,options),page,eraseDevice,pendingCount,receiveNative,accept:data=>merge(ownerKey(),data),refresh:()=>current&&refresh(current),send,ownerKey,source};
})();
