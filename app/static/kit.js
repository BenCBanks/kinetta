// One private conversation across the app. Numbers and proposed writes remain server-validated.
'use strict';
const KitChat = (() => {
  const screens={me:['Me','/me'],nutrition:['Nutrition','/food'],activity:['Activity','/activity'],progress:['Progress','/progress'],plan:['Plan','/plan'],strength:['Track','/track'],track:['Track','/track']};
  const actions={food:['Add food','/food?add=1'],nutrition:['Nutrition','/food'],record:['Record a workout','/track'],activities:['Your activities','/activity?view=mine'],plan:['Training plan','/plan'],progress:['Progress','/progress'],strength:['Record strength','/track'],recipes:['Recipes & foods','/food/meals'],goals:['Goals & profile','/me'],connections:['Connections','/me/connections']};
  const starters={
    me:[['Review my progress','What stands out in my recent training and nutrition, and what should I focus on next?'],['Plan my next step','Given my goals and recent activity, what would be a useful next step?'],['Help me use Kinetta','What can I do in Kinetta to track my fitness and nutrition?']],
    nutrition:[['Look at my food today','Review my logged food today. What is known, what is missing, and what could I focus on?'],['What could I eat next?','Using my saved foods and remaining targets today, suggest a meal I can review before logging.'],['Talk about my diet','Help me think through a sustainable diet for my goals. Ask me what you need to know.']],
    activity:[['Review this workout','Review the activity in the current screen context against my own recent workouts. What should I take from it?'],['Review my training','Review my recent workouts across all sports. What stands out, and what is missing?'],['Help with recovery','What should I consider for recovery given my recent training?']],
    progress:[['Am I improving?','Review my progress across my recorded workouts, strength and nutrition. Be clear about what the data can show.'],['Look at my consistency','How consistent have my recorded workouts and food logs been recently?'],['Choose a focus','Given my goals and recent records, what should I focus on next?']],
    plan:[['Review my upcoming week','Review my upcoming training using my current plan, recent load and permitted plan options.'],['Help me adjust my plan','Do any permitted plan adjustments fit my recent training? Show a proposal for review if useful.'],['Explain my training','Explain the purpose of my upcoming workouts and how they relate to my goal.']],
    strength:[['Review my strength work','Review my recorded completed strength sets. What progress can I verify?'],['Plan my next step','What should I consider for my next strength session given my records and goals?'],['Help me record sets','How do I record strength exercises and sets in Kinetta?']],
    track:[['Choose a workout','Given my current plan and recent training, what should I consider doing next?'],['Help me record','How do I record a workout or strength session in Kinetta?'],['Talk about exercise','Help me choose exercise that fits my goals. Ask me what you need to know.']]};
  let current,entryDraft;
  const owner=()=>App.me&&JSON.stringify([Native.base||location.origin,App.me.id]);
  const key=(o,k)=>'fit.kit.'+k+':'+o;
  const active=c=>current===c&&c.el.isConnected&&c.owner===owner()&&c.session===readOwner();
  const save=(c,k,v)=>{localStorage.setItem(key(c.owner,k),JSON.stringify(v));};
  const status=(c,text)=>{if(active(c))$('#kit-status',c.el).textContent=text||'';};
  function href(screen='me',activityId=null,question=null){const q=new URLSearchParams({from:Object.hasOwn(screens,screen)?screen:'me'});if(activityId)q.set('activity',activityId);if(question)q.set('question',question.slice(0,1500));return '/me/kit?'+q;}
  function open(screen='me',activityId=null,question=null){
    const o=owner();
    if(o&&question){
      if(store.get(key(o,'draft')))toast('Your existing Kit draft is kept.');
      else try{localStorage.setItem(key(o,'draft'),JSON.stringify(question.slice(0,1500)));}catch{entryDraft={owner:o,question:question.slice(0,1500)};}
    }
    go(href(screen,activityId));
  }
  function context(){const q=new URLSearchParams(location.search),screen=Object.hasOwn(screens,q.get('from'))?q.get('from'):q.get('review')==='plan'?'plan':'me';const id=Number(q.get('activity'));return {screen,activity_id:Number.isSafeInteger(id)&&id>0?id:null};}
  const questionFor=(c,i)=>c.context.screen==='activity'&&i===0&&!c.context.activity_id?'Review my latest own workout against my recent history. Use the workout date to find the latest one, rather than the upload order.':starters[c.context.screen][i]?.[1];
  function controls(c){
    const busy=c.sending||c.messages.some(m=>['pending','running'].includes(m.state));
    $('#kit-send',c.el).disabled=!c.loaded||busy||!aiCan('coach')||!$('#kit-text',c.el).value.trim();
    $$('[data-kit-start]',c.el).forEach(b=>b.disabled=!c.loaded||busy||!aiCan('coach'));
  }
  function factLabel(f){
    const labels={kcal:'Calories (kcal)',protein_g:'Protein (g)',carbs_g:'Carbohydrates (g)',fat_g:'Fat (g)',fiber_g:'Fiber (g)',sodium_mg:'Sodium (mg)',sugar_g:'Sugar (g)',saturated_fat_g:'Saturated fat (g)',protein_target:'Protein goal (g)',kcal_target:'Calorie goal (kcal)',distance_m:'Distance (m)',moving_s:'Moving time (seconds)'};
    const path=f.path||[],last=path.at(-1),prefix={known_totals:'Known total',totals:'Total',average_per_logged_day:'Average per logged day',foods:'Food entry',activities:'Workout'}[path[0]];
    return labels[last]?(prefix?prefix+' · ':'')+labels[last]:f.label;
  }
  function draw(c){
    if(!active(c))return;
    const list=$('#thread-messages',c.el),pending=c.job&&!c.messages.some(m=>String(m.client_id)===c.job.client_id);
    const has=c.messages.length||pending;
    list.innerHTML=c.messages.map(m=>{
      const a=m.answer, failed=m.state==='failed'||c.answerErrors?.[m.client_id];
      return `<article data-kit-id="${esc(String(m.client_id))}"><div class="thread-user"><p>${esc(m.question)}</p></div>${a?`<div class="thread-card kit-answer"><p>${esc(a.interpretation)}</p>${a.facts?.length?`<dl class="kit-facts">${a.facts.map(f=>`<div><dt>${esc(factLabel(f))}</dt><dd>${esc(String(f.value))}</dd></div>`).join('')}</dl>`:''}${a.limitations?.length?`<details><summary>What Kit could check</summary>${[...new Set(a.limitations)].map(l=>`<p class="small muted">${esc(l)}</p>`).join('')}</details>`:''}${a.selection?'<button type="button" class="ghost wide" data-kit-review>Review proposed change</button>':''}${a.actions?.filter(x=>Object.hasOwn(actions,x)).map(x=>`<a class="linkbtn kit-action" href="${actions[x][1]}">${actions[x][0]} ${svg('chev')}</a>`).join('')||''}</div>`:failed?`<div class="thread-card"><p class="err">${esc(c.answerErrors?.[m.client_id]||m.error||'Kit could not finish. Your question is saved.')}</p><button type="button" class="ghost" data-kit-retry>Retry</button></div>`:`<div class="thread-card thread-thinking"><div class="thread-typing" role="status" aria-label="Kit is checking your records"><span></span><span></span><span></span></div></div>`}</article>`;
    }).join('')+(pending?`<article><div class="thread-user"><p>${esc(c.job.question)}</p></div><div class="thread-card"><p>${esc(c.jobError||'Sending your question…')}</p>${c.jobError?'<button type="button" class="ghost" id="kit-retry-send">Retry sending</button>':''}</div></article>`:'');
    $('#kit-intro',c.el).hidden=!!has;
    $('#kit-older',c.el).hidden=!c.before;
    $$('[data-kit-retry]',list).forEach(b=>b.onclick=()=>answer(c,b.closest('[data-kit-id]').dataset.kitId));
    $$('[data-kit-review]',list).forEach(b=>b.onclick=()=>{const m=c.messages.find(m=>String(m.client_id)===b.closest('[data-kit-id]').dataset.kitId);kitReview(m.answer.selection,{scopeKey:'kit:'+m.client_id,conversation:true,onSaved:()=>status(c,'Saved. You can ask Kit to check your updated records.'),onStale:()=>status(c,'Your records changed. Ask Kit again before confirming this proposal.')});});
    const retry=$('#kit-retry-send',list);if(retry)retry.onclick=()=>deliver(c);
    controls(c);c.view?.pin();
  }
  async function refresh(c,before=null){
    const data=await api('/api/coach/conversation'+(before?'?before='+before:''));if(!active(c))return;
    if(c.generation&&c.generation!==data.generation){if(c.job&&!$('#kit-text',c.el).value){$('#kit-text',c.el).value=c.job.question;try{save(c,'draft',c.job.question);}catch{}}c.messages=[];c.job=null;c.sending=false;c.answerErrors={};store.del(key(c.owner,'pending'));status(c,'This chat was cleared on another device. Your draft is kept.');}
    c.generation=data.generation;c.ready=data.ready;c.before=data.before;c.loaded=true;
    const rows=before?[...data.messages,...c.messages]:data.messages;
    c.messages=[...new Map(rows.map(m=>[m.client_id,m])).values()].sort((a,b)=>a.id-b.id);
    if(c.job&&c.job.generation!==c.generation){c.job=null;store.del(key(c.owner,'pending'));}
    const accepted=c.job&&c.messages.find(m=>m.client_id===c.job.client_id&&m.question===c.job.question);
    if(accepted){
      const field=$('#kit-text',c.el);if(field.value.trim()===c.job.question){field.value='';field.style.height='';store.del(key(c.owner,'draft'));}
      c.job=null;store.del(key(c.owner,'pending'));
    }

    if(!c.ready)status(c,'Kit chat is awaiting reviewed evaluation on this server. Your normal app tools remain available.');
    draw(c);
    const waiting=c.messages.find(m=>m.state==='pending');
    if(waiting&&!c.sending&&!c.answerErrors?.[waiting.client_id])answer(c,waiting.client_id);
    else if(c.messages.some(m=>m.state==='running'))later(c);
  }
  const later=c=>{clearTimeout(c.timer);c.timer=setTimeout(()=>{if(active(c))refresh(c).catch(e=>status(c,e.message));},2500);};
  async function answer(c,id){
    if(!active(c)||c.sending)return;c.answerErrors||={};delete c.answerErrors[id];c.sending=true;const generation=c.generation,valid=()=>active(c)&&c.generation===generation;controls(c);
    try{
      const row=await api('/api/coach/conversation/messages/'+id+'/answer',json('POST',{generation}));if(!valid())return;
      if(row.cancelled){await refresh(c);return;}
      c.messages=c.messages.map(m=>String(m.client_id)===String(id)?row:m);draw(c);
      if(row.state==='running')later(c);else await refresh(c).catch(()=>status(c,'Your answer is saved. Return when online to refresh the full history.'));
    }catch(e){if(valid()){c.answerErrors[id]=e.message;status(c,e.message);await refresh(c).catch(()=>{});draw(c);}}
    finally{if(valid())c.sending=false;if(valid()){controls(c);if(c.messages.some(m=>m.state==='running'))later(c);}}
  }
  async function deliver(c){
    if(!active(c)||c.sending||!c.job)return;c.sending=true;const generation=c.generation,valid=()=>active(c)&&c.generation===generation;c.jobError='';draw(c);
    try{
      const m=await api('/api/coach/conversation/messages',json('POST',c.job));if(!valid())return;
      c.messages=[...c.messages.filter(x=>x.client_id!==m.client_id),m].sort((a,b)=>a.id-b.id);
      const field=$('#kit-text',c.el);if(field.value.trim()===c.job.question){field.value='';field.style.height='';store.del(key(c.owner,'draft'));}
      c.job=null;store.del(key(c.owner,'pending'));c.view.pin(true);draw(c);
      c.sending=false;await answer(c,m.client_id);
    }catch(e){if(valid()){c.jobError=e.message;status(c,e.message);if(e.status===409)await refresh(c).catch(()=>{});draw(c);}}
    finally{if(valid())c.sending=false;if(valid())controls(c);}
  }
  async function send(c,text){
    if(!active(c)||!c.loaded||c.sending)return;
    const question=(text??$('#kit-text',c.el).value).trim();if(question.length<3)return;
    if(c.job){status(c,'Retry the saved question before sending another.');return;}
    const job={client_id:newId(),generation:c.generation,question,context:c.context};
    try{save(c,'pending',job);c.job=job;await deliver(c);}catch(e){status(c,'This phone could not save your question. Keep it here and try again.');}
  }
  async function mount(el){
    const ctx=context(),back=screens[ctx.screen],c={el,context:ctx,owner:owner(),session:readOwner(),messages:[],loaded:false,sending:false};current=c;
    el.classList.add('food-thread','kit-chat');
    el.innerHTML=`<header class="thread-heading"><a class="back" href="${back[1]}">${svg('back')}${back[0]}</a><h1>Ask Kit</h1><button type="button" class="icon-btn kit-settings" id="kit-settings" aria-label="Kit chat settings">${svg('more')}</button></header><button class="linkbtn" id="kit-older" type="button" hidden>Earlier messages</button><div id="thread-messages" aria-live="off"></div><section id="kit-intro"><div class="kit-mark" aria-hidden="true">${svg('sparkle')}</div><h2>What’s on your mind?</h2><p>Training, food, progress, or your next step. Let’s look at what works for you.</p><div class="kit-starters">${starters[ctx.screen].map(([label],i)=>`<button type="button" class="ghost" data-kit-start="${i}">${esc(ctx.screen==='activity'&&i===0&&!ctx.activity_id?'Review my latest workout':label)}${svg('chev')}</button>`).join('')}</div></section><form id="kit-composer" class="thread-composer"><div class="thread-compose-row kit-compose-row"><label class="vh" for="kit-text">Message Kit</label><textarea id="kit-text" rows="1" maxlength="1500" enterkeyhint="send" placeholder="Message Kit…"></textarea><button class="primary thread-send" id="kit-send" aria-label="Send to Kit">${svg('send')}</button></div><p id="kit-status" role="status" aria-live="polite"></p></form>`;
    const field=$('#kit-text',el);field.value=store.get(key(c.owner,'draft'))||(entryDraft?.owner===c.owner?entryDraft.question:null)||new URLSearchParams(location.search).get('question')?.slice(0,1500)||'';entryDraft=null;c.job=store.get(key(c.owner,'pending'));
    const resize=()=>{field.style.height='auto';field.style.height=Math.min(field.scrollHeight,140)+'px';};
    field.oninput=()=>{try{save(c,'draft',field.value);}catch(e){status(c,'Your draft could not be saved on this phone.');}resize();controls(c);};
    field.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();send(c);}};
    $('#kit-composer',el).onsubmit=e=>{e.preventDefault();send(c);};
    $$('[data-kit-start]',el).forEach(b=>b.onclick=()=>send(c,questionFor(c,+b.dataset.kitStart)));
    $('#kit-older',el).onclick=async()=>{const list=$('#thread-messages',el),h=list.scrollHeight,y=list.scrollTop;try{await refresh(c,c.before);list.scrollTop=y+list.scrollHeight-h;}catch(e){status(c,e.message);}};
    $('#kit-settings',el).onclick=()=>sheet('Kit chat',`<p>One private conversation across Kinetta. Kit checks your own records when needed. Apple Health sharing follows your connection permissions.</p><a class="linkbtn wide" href="/me#ai">Kit & data permissions</a><button type="button" class="ghost wide danger" id="kit-clear">Clear chat</button><p class="small muted">Clears Kit’s conversation on all your devices. Your food log, workouts, plans and goals stay saved.</p>`,(body,close)=>{$('#kit-clear',body).onclick=()=>{close();sheet('Clear Kit chat?','<p>Your records stay saved. This conversation will be removed on all your devices.</p><button type="button" class="primary wide danger" id="kit-clear-confirm">Clear chat</button>',(body,dismiss)=>{$('#kit-clear-confirm',body).onclick=async e=>{e.target.disabled=true;try{const data=await api('/api/coach/conversation/clear',json('POST',{generation:c.generation,confirmed:true}));if(!active(c))return;clearTimeout(c.timer);c.generation=data.generation;c.sending=false;c.answerErrors={};c.messages=[];c.job=null;c.jobError='';store.del(key(c.owner,'pending'));store.del(key(c.owner,'draft'));field.value='';dismiss();status(c,'');draw(c);}catch(x){if(active(c)){status(c,x.message);e.target.disabled=false;}}};});};});
    c.view=foodChatViewport({list:$('#thread-messages',el),composer:$('#kit-composer',el),field,send:$('#kit-send',el),active:()=>active(c)});
    const events=new AbortController();document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active(c))refresh(c).catch(e=>status(c,e.message));},{signal:events.signal});
    viewResources.set(el,()=>{clearTimeout(c.timer);events.abort();c.view.dispose();});
    controls(c);resize();
    try{await refresh(c);if(active(c)&&c.job){c.jobError='A saved question is ready to retry.';draw(c);}}catch(e){status(c,e.message);$('#kit-intro',el).insertAdjacentHTML('beforeend','<button class="ghost wide" id="kit-load-retry">Try loading again</button>');$('#kit-load-retry',el).onclick=()=>refresh(c).catch(x=>status(c,x.message));}
    if(active(c))c.view.pin(true);
  }
  function eraseDevice(){const o=owner();entryDraft=null;if(current){clearTimeout(current.timer);current.view?.dispose();current=null;}if(o){for(const k of ['draft','pending'])localStorage.removeItem(key(o,k));for(const k of Object.keys(localStorage))if(k.startsWith('fit.kit.proposal:'+o+':'))localStorage.removeItem(k);}}
  function entry(el,path){
    const screen=/^\/track\/lift\/\d+$/.test(path)?'strength':{'/me':'me','/food':'nutrition','/activity':'activity','/progress':'progress','/track':'track','/plan':'plan'}[path];
    if(!screen||!aiCan('coach')||el.querySelector('.kit-help'))return;
    const heading=el.querySelector('.top');if(!heading)return;
    const link=document.createElement('a');link.className='icon-btn kit-help';link.href=href(screen);link.setAttribute('aria-label','Ask Kit');link.innerHTML=svg('sparkle');
    (heading.querySelector('.acts')||heading).append(link);
  }
  return {mount,href,open,entry,eraseDevice,starters,actions};
})();
route(/^\/me\/kit$/,()=>({nutrition:'food',activity:'activity',progress:'progress',track:'track',strength:'track'}[new URLSearchParams(location.search).get('from')]||'me'),el=>KitChat.mount(el));
function kitReview(selection, options = {}) {
  const candidate = selection.candidate;
  sheet('Review proposed change', `<p class="small">Nothing changes until you confirm.</p>
    ${selection.kind === 'plan' ? `<p>${esc(candidate.reason)}</p>${candidate.changes.map((w) => `<div class="card"><b>${esc(w.title)}</b><p class="small">${esc(w.day)} · ${esc(w.detail)}</p></div>`).join('')}`
      : `<p class="small">${esc(selection.day)}</p>${candidate.foods.map((f) => `<div class="kv"><span>${esc(f.name)}<small> ${esc(f.amount)} ${esc(f.unit)}</small></span><b>${r0(f.kcal)} kcal</b></div>`).join('')}
        ${nutGrid(candidate.totals)}<label>Log to<select id="kit-meal">${Object.entries(MEAL_NAMES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>`}
    <p class="err" role="alert"></p><button class="primary wide" id="kit-confirm">${selection.kind === 'plan' ? 'Confirm plan adjustment' : 'Confirm and log food'}</button>`, (body, close) => {
    const confirm = $('#kit-confirm', body), error = $('.err', body), owner = readOwner();
    const key=options.scopeKey?'fit.kit.proposal:'+JSON.stringify([Native.base||location.origin,App.me.id])+':'+options.scopeKey:null;
    let proposal = key?store.get(key):null; // Keep the same proposal ID when an acknowledgement is lost; confirmation is idempotent.
    const meal=$('#kit-meal',body);if(meal&&proposal){meal.value=proposal.payload.meal;meal.disabled=true;}
    const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
    confirm.onclick = async () => {
      if (owner !== readOwner()) { close(); return; }
      confirm.disabled = true; error.textContent = ''; confirm.textContent = 'Checking and saving…';
      try {
        if (!proposal) proposal = await api('/api/coach/proposals', json('POST', {kind: selection.kind, candidate_id: selection.candidate_id,
          ...(selection.day ? {day: selection.day, meal: $('#kit-meal', body).value} : {})}));
        if (owner !== readOwner()) return;
        if(meal){meal.value=proposal.payload.meal;meal.disabled=true;}
        if(key){try{localStorage.setItem(key,JSON.stringify(proposal));}catch(e){throw Error('This phone could not keep the confirmation. Free some storage, or log from your usuals.');}}
        // The proposal endpoint recomputes current candidates. Never apply a different proposal from the one shown.
        if (JSON.stringify(stable(proposal.payload.candidate)) !== JSON.stringify(stable(candidate))) throw Object.assign(new Error('The proposal changed. Ask Kit again to review the latest version.'),{status:409});
        const saved=await api(`/api/coach/proposals/${proposal.id}/confirm${selection.kind==='food'&&options.scopeKey&&!options.conversation?'?thread=true':''}`, json('POST', {confirmed: true}));
        if (owner !== readOwner()) return;
        if(key)store.del(key);proposal=null;
        close(); invalidate('/api/'); toast(selection.kind==='plan'?'Plan adjustment saved':saved.removed_after_apply?'Already confirmed; that food was removed later.':'Food logged');
        if(options.onSaved)await options.onSaved(saved);else go(selection.kind === 'plan' ? '/plan' : '/food');
      } catch (e) { if(e.status===409){if(key)store.del(key);proposal=null;if(options.onStale){close();await options.onStale();return;}} if (owner === readOwner()) { error.textContent = e.message; confirm.disabled = false; confirm.textContent = 'Try confirmation again'; } }
    };
  });
}
