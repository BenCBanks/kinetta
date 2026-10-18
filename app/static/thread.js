// Permanent food conversation. Numbers and writes stay in authenticated server code;
// the outbox keeps user intent durable before clearing the composer.
'use strict';
const FoodThread = (() => {
  let current = null, privacyEpoch = 0;
  const ownerKey = () => App.me ? JSON.stringify([Native.base || location.origin, App.me.id]) : null;
  const uuid = () => { if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
  const cacheKey = owner => 'fit.thread.history:'+owner;
  const contextKey = owner => 'fit.thread.context:'+owner;
  const draftKey = owner => 'fit.thread.draft:'+owner;
  const nativeKey = owner => 'fit.thread.native:'+owner;
  const active = ctx => current===ctx && ctx.el.isConnected && ctx.owner===ownerKey() && ctx.session===readOwner();
  function remember(ctx) { store.set(cacheKey(ctx.owner),ctx.messages.slice(-80)); }
  async function merge(owner,data,write=true) {
    if(write&&owner===ownerKey())invalidate('/api/food');
    const ctx=current;
    if(!ctx || ctx.owner!==owner || !active(ctx))return;
    if(write)ctx.epoch++;
    const rows=[...(data.messages||[]),...(data.message?[data.message]:[]),...(data.updated_message?[data.updated_message]:[])];
    for(const m of rows){const i=ctx.messages.findIndex(x=>x.id===m.id);if(i<0)ctx.messages.push(m);else ctx.messages[i]=m;}
    ctx.messages.sort((a,b)=>a.id-b.id);remember(ctx);draw(ctx);
  }
  const outbox=foodOutbox({db:ThreadDB,request:(path,body)=>api(path,json('POST',body)),session:()=>readOwner()+':'+privacyEpoch,changed:merge});
  async function flush(ctx=null) {
    const owner=ctx?.owner||ownerKey();
    if(!owner||owner!==ownerKey()||(ctx&&ctx.session!==readOwner()))return;
    try {await outbox.flush(owner);const view=current;if(view&&active(view)&&view.owner===owner){view.jobs=await ThreadDB.list(owner);draw(view);}}
    catch(e){if(current&&active(current))status(current,e.message);}
  }
  function status(ctx,text){if(active(ctx))$('#thread-status',ctx.el).textContent=text;}
  function source(entry) {
    const ref=entry.ref||{},origin=ref.origin;
    const names={usda:'USDA',off:'Open Food Facts',quick:'Your numbers',custom:'My foods',dish:'My Recipes',recent:'Your food log',ai:'AI estimate'};
    let label=origin==='ai'?'AI estimate':origin==='label'?'Nutrition label':names[ref.origin_ref?.source||ref.source||entry.source]||'Your food log';
    if(ref.estimated_portion)label+=' · estimated portion';
    if(ref.origin_edited)label+=' · Edited';
    return label;
  }
  function food(entry,index) {
    const unknown=entry.ref?.unknown_nutrients||[],protein=unknown.includes('protein_g')||entry.protein_g==null?'Protein unknown':`${r1(entry.protein_g)} g protein`;
    return `<div class="thread-food"><div><strong>${esc(entry.name)}</strong><span>${esc(fmtAmount(entry))} · ${esc(source(entry))}</span><span>About ${homeCalories(entry.kcal)} kcal · ${esc(protein)}</span>${entry.ref?.origin_notes?`<span>${esc(entry.ref.origin_notes)}</span>`:''}</div>${entry.id?`<button type="button" class="linkbtn" data-entry="${index}">Edit</button>`:''}</div>`;
  }
  function choices(result) {
    if(result.correction&&result.choices?.length)return `<div class="thread-choices">${result.choices.map((c,i)=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify({select:i}))}">${esc(c.name)}${c.day?' · '+esc(dayLabel(c.day))+' · '+esc(MEAL_NAMES[c.meal]||c.meal):''}</button>`).join('')}</div>`;
    const parts=result.parts || (result.resolution?.items||[]).map((item,index)=>({index,status:item.status,item}));
    // One clarification at a time; the original card retains all pending parts.
    const part=parts.find(p=>p.status!=='ready'&&!p.logged);if(!part){const numbers=parts.find(p=>p.entered_numbers&&!p.logged);return numbers?`<button type="button" class="linkbtn" data-manual="${numbers.index}">Review numbers</button>`:'';}
    const item=part.item||{},options=[];
    for(const c of item.choices||[])options.push([c.name,{part:part.index,pick:{kind:c.kind,id:c.id}}]);
    for(const [i,f] of (part.catalog||[]).entries())options.push([f.name,{part:part.index,catalog:i}]);
    for(const o of item.options||[])options.push([o.label,{part:part.index,portion:o.portion}]);
    for(const o of part.scale_options||[])options.push([o.label,{part:part.index,factor:o.factor}]);
    if(item.new_ok)options.push(['Something new',{part:part.index,new:true}]);
    return `<div class="thread-choices">${options.map(([label,value])=>`<button type="button" class="ghost" data-choice="${esc(JSON.stringify(value))}">${esc(label)}</button>`).join('')}${part.entered_numbers?'':`<button type="button" class="linkbtn" data-portion="${part.index}">Set portion</button>`}<button type="button" class="linkbtn" data-manual="${part.index}">Enter numbers</button></div>`;
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
    if(k)return `<section class="thread-kit"><h3>Kit · AI interpretation</h3><p>${esc(k.interpretation)}</p>${k.facts?.length?`<details><summary>Verified food records</summary><dl>${k.facts.map(f=>`<div class="kv"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl></details>`:''}${k.limitations?.length?`<details><summary>Data limits</summary>${k.limitations.map(l=>`<p>${esc(l)}</p>`).join('')}</details>`:''}${k.selection?.kind==='food'?'<button type="button" class="ghost" data-kit-review>Review proposed meal</button>':''}</section>`;
    if(r.daily_note&&r.kit_attempted&&!r.kit_processing)return r.kit_error?`<p class="thread-error">${esc(r.kit_error)}</p>`:'';
    if(r.daily_note&&current?.preferences?.daily_note!=='ai')return '';
    if(!(r.offer_kit||r.intent==='review')||!App.me?.food_coach_tools||!aiCan('coach'))return '';
    return `<div class="thread-kit">${r.kit_error?`<p class="thread-error">${esc(r.kit_error)}</p>`:''}<button type="button" class="linkbtn" data-kit>${r.kit_processing?'Check Kit answer':'Ask Kit for a food suggestion'}</button><p class="small muted">Optional AI answer using your food records. It won’t log a meal.</p></div>`;
  }
  function replyHtml(root,reply) {
    const r=reply?.result||{},entries=reply?.entries||[],preview=r.parts?.flatMap(p=>p.logged?[]:(p.entries||[]))||r.resolution?.items?.flatMap(i=>i.preview_entries||[])||[];
    const visible=entries.length?entries:(['preview','needs'].includes(r.kind)||r.pending_count||r.parts?.some(p=>p.status==='ready'&&!p.logged)?preview:[]),changed=changedNumbers(r,entries),removed=r.kind==='log'&&!entries.length&&r.entry_ids?.length;
    const day=entries[0]?.day||r.day,meal=entries[0]?.meal||r.meal;
    const canLog=!r.cancelled&&(r.kind==='preview'||r.parts?.some(p=>p.status==='ready'&&!p.logged));
    return `<div class="thread-card" data-mid="${root.id}">${r.daily_note?`<h3>Your daily food note</h3><p class="small muted">As of ${esc(new Date(r.as_of).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}. Later food is kept in your log.</p>`:''}${meal&&day&&!removed?`<button type="button" class="linkbtn thread-destination" data-destination>${esc(MEAL_NAMES[meal])} · ${esc(dayLabel(day))} ${svg('chev')}</button>`:''}
      ${r.updated||changed?'<p class="thread-updated">Updated</p>':''}${visible.map(food).join('')}${!visible.length||r.pending_count||r.kind==='answer'||r.kind==='edit'||r.parts?.some(p=>p.entered_numbers&&!p.logged)?`<p>${esc(removed?'This food was removed from your log.':reply?.body||(root.state==='cancelled'?'Cancelled message.':root.state==='answered'?'Reply text removed. Your saved food is kept.':'Saved on this phone. Waiting to send…'))}</p>`:''}
      ${r.feedback&&!changed&&!removed?`<p class="thread-feedback">${esc(typeof r.feedback==='string'?r.feedback:r.feedback.text||'')}</p>`:''}
      ${r.error?`<p class="thread-error">${esc(r.error.message||r.error)}</p>`:''}${!r.cancelled&&(r.kind==='needs'||r.pending_count||r.parts?.some(p=>p.entered_numbers&&!p.logged))?choices(r):''}
      ${kitHtml(r)}<div class="thread-actions">${canLog?'<button type="button" class="ghost" data-action="log">Log these foods</button>':''}${entries.length?'<button type="button" class="linkbtn" data-action="undo">Undo</button>':''}${r.error||r.parts?.some(p=>p.needs_photo)?(root.result?.input?.kind==='photo'?'<button type="button" class="linkbtn" data-reattach>Add the photo again</button>':'<button type="button" class="linkbtn" data-action="resolve">Retry lookup</button>'):''}<button type="button" class="linkbtn" data-more>More</button></div></div>`;
  }
  function primary(ctx){
    if(!active(ctx))return;$('#thread-suggestions',ctx.el).hidden=!!$('#thread-text',ctx.el).value.trim();const logs=$$('[data-action="log"]',ctx.el),held=!$('#thread-text',ctx.el).value.trim()?logs.at(-1):null;
    for(const b of logs){b.classList.toggle('primary',b===held);b.classList.toggle('ghost',b!==held);}
    $('#thread-send',ctx.el).classList.toggle('primary',!held);$('#thread-send',ctx.el).classList.toggle('ghost',!!held);
  }
  function draw(ctx) {
    if(!active(ctx))return;
    const list=$('#thread-messages',ctx.el),bottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
    const roots=ctx.messages.filter(m=>m.kind==='user').sort((a,b)=>a.captured_at.localeCompare(b.captured_at)||a.id-b.id),ids=new Set();let anchor=list.firstElementChild,lastDay=null;
    for(const m of roots) {
      const reply=ctx.messages.find(r=>r.reply_to===m.id),job=ctx.jobs.find(j=>j.id===m.client_id);
      const id='message-'+m.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);
      const separator=m.local_day!==lastDay?`<h2 class="thread-day">${esc(dayLabel(m.local_day))}</h2>`:'';lastDay=m.local_day;
      const user=`<div class="thread-user"><p>${esc(m.body)}</p><time datetime="${esc(m.captured_at)}">${esc(dayLabel(m.local_day))} · ${esc(new Date(m.captured_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:tz()}))}</time></div>`;
      const html=`${separator}${m.result?.receipt||m.result?.daily_note?'':user}${replyHtml(m,reply)}${job?pendingHtml(job):''}`;
      if(!node){node=document.createElement('article');node.dataset.key=id;}
      if(node===anchor)anchor=anchor.nextElementSibling;else list.insertBefore(node,anchor);
      if(node._html!==html){node.innerHTML=html;node._html=html;wireCard(ctx,node,m,reply);if(job)wirePending(ctx,node,job);}
    }
    for(const j of ctx.jobs.filter(j=>!roots.some(m=>m.client_id===j.id))){const id='queued-'+j.id;ids.add(id);let node=list.querySelector(`[data-key="${id}"]`);if(!node){node=document.createElement('article');node.dataset.key=id;list.append(node);}const html=`<div class="thread-user"><p>${esc(j.body)}</p></div>${pendingHtml(j)}`;if(node._html!==html){node.innerHTML=html;node._html=html;wirePending(ctx,node,j);}}
    for(const node of [...list.children])if(!ids.has(node.dataset.key))node.remove();
    ctx.el.classList.toggle('has-messages',!!roots.length||!!ctx.jobs.length);
    list.hidden=!roots.length&&!ctx.jobs.length;
    $('#thread-empty',ctx.el).hidden=!list.hidden;
    $('#thread-older',ctx.el).hidden=!ctx.before;
    if(!ctx.pauseFollow&&(bottom||ctx.follow||ctx.initial)){list.scrollTop=list.scrollHeight;if(list.children.length)ctx.initial=false;}
    ctx.follow=false;primary(ctx);
  }
  function pendingHtml(job){return `<div class="thread-pending"><p>${esc(job.error|| (job.phase==='cancel'?'Cancelling when connected…':job.offline||!navigator.onLine?'Saved on this phone · waiting for connection':job.phase==='resolve'?'Checking food…':'Saved on this phone · waiting to send'))}</p>${job.error?'<button type="button" class="linkbtn" data-retry>Retry</button>':''}<button type="button" class="linkbtn" data-cancel>Cancel</button></div>`;}
  function wirePending(ctx,node,job){
    const retry=$('[data-retry]',node);if(retry)retry.onclick=async()=>{if(!active(ctx))return;await ThreadDB.update(ctx.owner,job.id,j=>({...j,error:null}));flush(ctx);};
    $('[data-cancel]',node).onclick=async()=>{if(!active(ctx))return;try{
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
    const reattach=$('[data-reattach]',node);if(reattach)reattach.onclick=()=>{ctx.photoRetry=m.id;const file=$('#ql-file',ctx.el);file.removeAttribute('capture');file.click();};
    $$('[data-action]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,b.dataset.action,b.dataset.action==='log'?{confirm:true}:b.dataset.action==='resolve'?{retry:true}:{});}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    const kit=$('[data-kit]',node);if(kit)kit.onclick=async()=>{if(!active(ctx))return;kit.disabled=true;status(ctx,'Checking your food records…');try{const data=await action(ctx,m.id,'kit',{});status(ctx,data.processing?'Kit is still checking. Tap Check Kit answer shortly.':'Answer saved.');}catch(e){toast(e.message);}finally{if(kit.isConnected)kit.disabled=false;}};
    const review=$('[data-kit-review]',node);if(review)review.onclick=()=>{if(!active(ctx))return;kitReview(r.kit.selection,{scopeKey:m.client_id,onStale:async()=>{await action(ctx,m.id,'kit',{refresh:true});},onSaved:async data=>{if(active(ctx)){await merge(ctx.owner,data);await refresh(ctx);}}});};
    $$('[data-choice]',node).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await action(ctx,m.id,'choose',JSON.parse(b.dataset.choice));}catch(e){toast(e.message);}finally{if(b.isConnected)b.disabled=false;}});
    $$('[data-entry]',node).forEach(b=>b.onclick=()=>{entrySheet(reply.entries[+b.dataset.entry],reply.entries[+b.dataset.entry].day);});
    const dest=$('[data-destination]',node);if(dest)dest.onclick=()=>destination(ctx,m,r);
    $$('[data-portion]',node).forEach(b=>b.onclick=()=>portion(ctx,m,+b.dataset.portion));
    $$('[data-manual]',node).forEach(b=>b.onclick=()=>manual(ctx,m,+b.dataset.manual,r));
    $('[data-more]',node).onclick=()=>sheet('Food message',`<button type="button" class="ghost wide" id="thread-correct">Correct in chat</button><button type="button" class="linkbtn danger" id="thread-delete">Delete message text</button><p>Deleting the message keeps saved food. Use Undo to remove its food.</p>`,(b,close)=>{
      $('#thread-correct',b).onclick=()=>{ctx.context=m.client_id;store.set(contextKey(ctx.owner),ctx.context);close();$('#thread-text',ctx.el).focus();status(ctx,'Try “make it half” or name the food you want to change.');};
      $('#thread-delete',b).onclick=async()=>{if(!active(ctx))return;try{await api(`/api/food/thread/messages/${m.id}`,{method:'DELETE'});await ThreadDB.remove(ctx.owner,m.client_id);ctx.jobs=await ThreadDB.list(ctx.owner);ctx.epoch++;ctx.messages=ctx.messages.filter(x=>x.id!==m.id&&x.reply_to!==m.id);remember(ctx);draw(ctx);close();}catch(e){toast(e.message);}};
    });
  }
  function destination(ctx,m,r){sheet('Meal and day',`<form class="form" id="thread-destination"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k,v])=>`<option value="${k}"${k===r.meal?' selected':''}>${v}</option>`).join('')}</select></label><label>Day<input name="day" type="date" value="${esc(r.day)}" required></label><button class="primary wide">Save</button></form>`,(b,close)=>{$('#thread-destination',b).onsubmit=async e=>{e.preventDefault();try{await action(ctx,m.id,'destination',{meal:e.target.meal.value,day:e.target.day.value},'PUT');close();}catch(e){toast(e.message);}};});}
  function portion(ctx,m,index){sheet('Set portion','<form class="form" id="thread-portion"><label>Amount<input name="amount" type="number" min="0.01" step="any" required inputmode="decimal"></label><label>Unit<select name="unit"><option value="count">Servings</option><option value="grams">Grams</option><option value="share">Share of the whole (0.5 = half)</option></select></label><button class="primary wide">Use this portion</button></form>',(b,close)=>{$('#thread-portion',b).onsubmit=async e=>{e.preventDefault();try{await action(ctx,m.id,'choose',{part:index,portion:{[e.target.unit.value]:+e.target.amount.value}});close();}catch(e){toast(e.message);}};});}
  function manual(ctx,m,index,result={}){const supplied=result.parts?.find(p=>p.index===index)?.entered_numbers,values=supplied?.values||{};sheet('Enter nutrition',`<form class="form" id="thread-manual"><label>Food<input name="name" value="${esc(supplied?.name||m.body.slice(0,200))}" maxlength="200" required></label>${macroInputs(values)}<p>Enter calories. Leave nutrients blank if you don’t know them; blank means unknown.</p><button class="primary wide">Log these numbers</button></form>`,(b,close)=>{guardFoodSheet(b,close,ctx.session);$('#thread-manual',b).onsubmit=async e=>{e.preventDefault();const f=e.target,item={name:f.name.value,amount:1,unit:'serving'};for(const k of FOOD_NUTRIENTS)item[k]=f[k].value.trim()===''?null:Number(f[k].value);if(item.kcal===null||!Number.isFinite(item.kcal)||item.kcal<0){f.kcal.setCustomValidity('Enter calories before logging.');f.kcal.reportValidity();f.kcal.oninput=()=>f.kcal.setCustomValidity('');return;}try{await action(ctx,m.id,'manual',{part:index,items:[item],confirm:true});close();}catch(e){toast(e.message);}};});}
  async function refresh(ctx,before=null){
    if(!active(ctx))return;
    const epoch=ctx.epoch,version=++ctx.readVersion;
    try{const data=await api('/api/food/thread'+(before?'?before='+before:''));if(!active(ctx)||ctx.epoch!==epoch||ctx.readVersion!==version)return;ctx.before=data.before;ctx.preferences=data.preferences;$('#thread-daily-note',ctx.el).hidden=!ctx.preferences?.daily_note||ctx.preferences.daily_note==='off';
      if(!before){const first=data.messages[0]?.id;ctx.messages=data.has_more?ctx.messages.filter(m=>m.id<first):[];}
      await merge(ctx.owner,data,false);ctx.jobs=await ThreadDB.list(ctx.owner);draw(ctx);status(ctx,'');if(!before)daily(ctx);}
    catch(e){status(ctx,e.offline?'Offline. Your saved conversation and pending messages stay on this phone.':e.message);}
  }
  function latestContext(ctx){
    const previous=ctx.messages.filter(m=>m.kind==='user'&&['log','needs','preview','undone'].includes(m.result?.kind)).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at)||a.id-b.id).at(-1);
    const pending=ctx.jobs.filter(j=>j.phase!=='cancel').sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
    return pending&&(!previous||Date.parse(pending.at)>Date.parse(previous.captured_at))?pending.id:previous?.client_id;
  }
  async function send(ctx,{body,media='text',barcode,images}={}) {
    if(!active(ctx))return;const field=$('#thread-text',ctx.el),text=(body||field.value).trim();if(!text)return;
    if(text.length>4000){status(ctx,'Keep this message under 4,000 characters.');return;}
    const job={id:uuid(),body:text,at:new Date().toISOString(),media,barcode,images,phase:'process',context:ctx.context||latestContext(ctx),...(ctx.day?{day:ctx.day}:{}),...(ctx.meal?{meal:ctx.meal}:{})};
    const button=$('#thread-send',ctx.el);if(button.disabled)return;button.disabled=true;
    try{if(!body||field.value.trim()===text){finishNativeDraft(ctx);saveDraft(ctx,'');}await ThreadDB.put(ctx.owner,job.id,job);if(!active(ctx))return;
      if(!body||field.value.trim()===text){field.value='';store.del(draftKey(ctx.owner));}ctx.context=null;store.del(contextKey(ctx.owner));
      ctx.jobs=await ThreadDB.list(ctx.owner);ctx.follow=true;draw(ctx);status(ctx,'Saved on this phone.');Native.haptic();flush(ctx);
    }catch(e){status(ctx,e.message);}finally{if(active(ctx))button.disabled=false;}
  }
  async function daily(ctx,explicit=false){
    if(!active(ctx)||!ctx.preferences?.daily_note||ctx.preferences.daily_note==='off'||ctx.dailyBusy)return;
    const day=isoDay(new Date()),hour=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:tz()}).format(new Date()));
    if(!explicit&&(hour<20||ctx.dailyDay===day))return;
    ctx.dailyBusy=true;if(explicit)status(ctx,'Preparing today’s note…');
    try{const data=await api('/api/food/thread/daily-note',json('POST',{}));if(!active(ctx))return;ctx.dailyDay=day;await merge(ctx.owner,data);if(explicit)status(ctx,data.deleted?'Today’s note was deleted. Another will be available tomorrow.':'Today’s note is saved.');}
    catch(e){ctx.dailyDay=day;if(explicit)status(ctx,e.message);}finally{ctx.dailyBusy=false;}
  }
  function preferences(ctx){if(!ctx.preferences){status(ctx,'Wait for food chat settings to load, then try again.');return;}const p=ctx.preferences;sheet('Food chat settings',`<form class="form" id="thread-preferences"><label class="check"><input type="checkbox" name="auto"${p.auto_log?' checked':''}>Log ready foods automatically</label><p>Uncertain food waits for a detail. Every logged card has Undo and Edit.</p><label>Feedback<select name="tone"><option value="supportive"${p.tone==='supportive'?' selected':''}>Supportive</option><option value="numbers"${p.tone==='numbers'?' selected':''}>Just the numbers</option></select></label><label>Daily food note<select name="daily_note"><option value="off"${!p.daily_note||p.daily_note==='off'?' selected':''}>Off</option><option value="code"${p.daily_note==='code'?' selected':''}>Code summary</option><option value="ai"${p.daily_note==='ai'?' selected':''}>Code summary + optional Kit</option></select></label><p>Off by default. When on, a code note appears after 8 pm when you visit food chat, or tap Daily note. Kit still needs a separate tap, AI access and consent, at most once a day. Nothing is pushed to your phone.</p><button class="primary wide">Save settings</button></form>`,(b,close)=>{$('#thread-preferences',b).onsubmit=async e=>{e.preventDefault();if(!active(ctx))return;try{const value={auto_log:e.target.auto.checked,tone:e.target.tone.value,daily_note:e.target.daily_note.value};const saved=await api('/api/food/thread/preferences',json('PUT',value));if(!active(ctx))return;ctx.preferences=saved;$('#thread-daily-note',ctx.el).hidden=value.daily_note==='off';close();daily(ctx);toast('Food chat settings saved');}catch(e){toast(e.message);}};});}
  function page(el,{day,meal}={}){
    const owner=ownerKey(),ctx={el,owner,day:/^\d{4}-\d{2}-\d{2}$/.test(day||'')?day:null,meal:Object.hasOwn(MEAL_NAMES,meal)?meal:null,session:readOwner(),messages:store.get(cacheKey(owner))||[],context:store.get(contextKey(owner)),jobs:[],before:null,follow:false,initial:true,epoch:0,readVersion:0};current=ctx;
    el.classList.add('food-thread');el.setAttribute('aria-live','off');
    el.innerHTML=`<header class="thread-heading"><a class="back" href="/food">${svg('back')}Nutrition</a><button type="button" class="linkbtn" id="thread-settings">Settings</button></header><h1>Food chat</h1><p class="thread-intro">${ctx.day||ctx.meal?`Logging to ${esc(MEAL_NAMES[ctx.meal]||'your chosen meal')} · ${esc(dayLabel(ctx.day||isoDay(new Date())))}`:'Your food, in your words.'}</p><button type="button" class="linkbtn" id="thread-older" hidden>Earlier messages</button><div id="thread-messages" aria-live="off"></div><div id="thread-empty"><h2>What did you eat?</h2><p>Say “2 eggs and toast” or ask how your day is going. Use your keyboard’s microphone to dictate.</p></div><form id="thread-composer" class="thread-composer"><div id="thread-shared-recipes"></div><div class="thread-shortcuts" id="thread-suggestions"><button type="button" class="linkbtn" id="thread-daily-note" hidden>Daily note</button><div id="thread-usual-suggestion"></div><button type="button" class="ghost" id="thread-usuals">Your usuals</button><button type="button" class="ghost" id="thread-recipes">My Recipes</button></div><div class="thread-tools"><button type="button" class="linkbtn" data-tool="snap">${svg('camera')}Snap</button><button type="button" class="linkbtn" data-tool="library">Photo library</button><button type="button" class="linkbtn" data-tool="scan">${svg('barcode')}Scan</button><button type="button" class="linkbtn" data-tool="paste">Paste</button><button type="button" class="linkbtn" id="thread-search">${svg('search')}Search foods</button></div><label class="vh" for="thread-text">Message about your food</label><div class="thread-compose-row"><textarea id="thread-text" rows="2" maxlength="4000" enterkeyhint="enter" placeholder="What did you eat?"></textarea><button class="primary" id="thread-send">Send</button></div><p id="thread-status" role="status" aria-live="polite"></p><input type="file" id="ql-file" accept="image/*" multiple hidden></form>`;
    const field=$('#thread-text',el),oldDraft=store.get(draftKey(owner));field.value=typeof oldDraft==='string'?oldDraft:oldDraft?.text||'';
    ctx.nativeEntries=(store.get(nativeKey(owner))||[]).filter(x=>x&&x.at>Date.now()-86400000).slice(-100);
    field.oninput=()=>{if(!field.value.trim()){ctx.context=null;store.del(contextKey(owner));}else if(!ctx.context){ctx.context=latestContext(ctx);if(ctx.context)store.set(contextKey(owner),ctx.context);}primary(ctx);try{saveDraft(ctx,field.value);}catch(e){status(ctx,'Draft storage is full. Keep this screen open until you send.');}};
    $('#thread-composer',el).onsubmit=e=>{e.preventDefault();send(ctx);};
    $('#thread-daily-note',el).onclick=()=>daily(ctx,true);
    $('#thread-settings',el).onclick=()=>preferences(ctx);
    $('#thread-usuals',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal());
    $('#thread-recipes',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),'','saved');
    $('#thread-search',el).onclick=()=>addSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),'','search');
    $('#thread-older',el).onclick=async()=>{const list=$('#thread-messages',el),h=list.scrollHeight,y=list.scrollTop;ctx.pauseFollow=true;try{await refresh(ctx,ctx.before);if(active(ctx))list.scrollTop=y+list.scrollHeight-h;}finally{ctx.pauseFollow=false;}};
    const file=$('#ql-file',el);file.onchange=()=>{const files=[...file.files];file.value='';const retry=ctx.photoRetry;ctx.photoRetry=null;reviewFoodPhotos(files,images=>retry?action(ctx,retry,'resolve',{retry:true,images}).catch(e=>toast(e.message)):send(ctx,{body:field.value.trim()||'Photo of food',media:'photo',images}),{active:()=>active(ctx)});};
    $$('[data-tool]',el).forEach(b=>b.onclick=()=>{const tool=b.dataset.tool;
      if(tool==='snap'||tool==='library'){if(!aiCan('food')){status(ctx,'Food photos need AI access and your consent. You can type, search or enter numbers instead.');return;}if(tool==='snap')file.setAttribute('capture','environment');else file.removeAttribute('capture');file.click();}
      if(tool==='scan')scanSheet(ctx.day||isoDay(new Date()),ctx.meal||guessMeal(),null,code=>send(ctx,{body:'Scanned product '+code,media:'barcode',barcode:code}));
      if(tool==='paste'){field.focus();status(ctx,'Paste text with your keyboard, or choose a photo from Photo library.');if(navigator.clipboard?.readText)navigator.clipboard.readText().then(text=>{if(active(ctx)&&text){field.value=(field.value+text).slice(0,4000);field.oninput();}}).catch(()=>{});}
    });
    draw(ctx);const tool=new URLSearchParams(location.search).get('tool');
    if(tool&&['snap','scan','library'].includes(tool)){const url=new URL(location.href);url.searchParams.delete('tool');history.replaceState(history.state,'',url.pathname+url.search+url.hash);$('[data-tool="'+tool+'"]',el).click();}else field.focus({preventScroll:true});
    ThreadDB.list(owner).then(jobs=>{if(active(ctx)){ctx.jobs=jobs;draw(ctx);flush(ctx);}}).catch(e=>status(ctx,e.message));
    api('/api/food/usual').then(foods=>{if(!active(ctx)||!foods.length)return;const food=foods[0],box=$('#thread-usual-suggestion',el);box.innerHTML=`<button type="button" class="ghost">Log ${esc(food.name)} · ${esc(fmtAmount(food))}</button>`;box.querySelector('button').onclick=async e=>{if(!active(ctx))return;const button=e.currentTarget;button.disabled=true;try{const {name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref}=food;const result=await addEntries([{day:ctx.day||isoDay(new Date()),meal:ctx.meal||guessMeal(),name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source:'recent',ref}],{thread:true});toast(result.queued?'Usual portion saved on this phone · waiting to send':'Usual portion logged. Undo is on its card.');}catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}};}).catch(()=>{});
    refresh(ctx);
  }
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
  async function eraseDevice(){const owner=ownerKey();if(!owner)return;privacyEpoch++;const view=current;if(view?.owner===owner){view.messages=[];view.jobs=[];view.el.replaceChildren();current=null;}let failure;try{await ThreadDB.erase(owner);}catch(e){failure=e;}finally{let keys=[];try{keys=Object.keys(localStorage).filter(key=>key.startsWith('fit.kit.proposal:'+owner+':'));}catch(e){failure=failure||e;}for(const key of [...keys,cacheKey(owner),draftKey(owner),contextKey(owner),nativeKey(owner)]){try{localStorage.removeItem(key);}catch(e){failure=failure||e;}}}if(failure)throw failure;}
  return {page,eraseDevice,pendingCount,receiveNative,accept:data=>merge(ownerKey(),data),refresh:()=>current&&refresh(current),send,ownerKey,source};
})();
