// One private conversation across the app. Numbers and proposed writes remain server-validated.
'use strict';
Object.assign(KitChat, (() => {
  const screens={me:['Me','/me'],nutrition:['Nutrition','/food'],activity:['Home','/activity'],progress:['Progress','/progress'],plan:['Plan','/plan'],strength:['Track','/track'],track:['Track','/track']};
  const actions={food:['Add food','/food?add=1'],nutrition:['Nutrition','/food'],record:['Record a workout','/track'],activities:['Your activities','/me/activities'],plan:['Training plan','/plan'],progress:['Progress','/progress'],strength:['Record strength','/track'],recipes:['Recipes & foods','/food/meals'],goals:['Goals & profile','/me'],connections:['Connections','/me/connections']};
  const foodWords=/\b(?:apple|applesauce|avocado|bacon|bagel|banana|beans|beef|berries|bread|broccoli|burger|burrito|butter|cake|cereal|cheese|chicken|chips|chocolate|coffee|cookie|coke|corn|crackers|cream|cucumber|egg|eggs|fish|fries|fruit|granola|grapes|ham|hamburger|hot dogs?|juice|kale|lettuce|milk|muffin|noodles|oatmeal|onion|orange|pancake|pasta|peanut|pear|pizza|potato|quinoa|rice|salad|salmon|sandwich|sausage|smoothie|soup|spinach|steak|toast|tomato|tuna|turkey|yogurt)\b/i;
  function foodIntent(text,awaiting=false){
    const value=String(text||'').trim();if(!value)return null;
    if(awaiting){if(/\?/.test(value)||/^(?:what|when|where|which|who|why|how|should|could|can|do|did|is|are|will)\b/i.test(value))return null;return {kind:'food',body:value};}
    const command=value.match(/^(?:(?:can|could|would)\s+you\s+|please\s+|i(?:'d| would) like you to\s+|i want you to\s+)?(?:log|add|record|track)\s+(?:my\s+)?(?:(?:food|meal|breakfast|lunch|dinner|snacks?)\s*)?(?::|—|-)?\s*(.*)$/i);
    if(command){const body=command[1].replace(/[\s.!?]+$/,'').trim(),explicit=/\b(?:food|meal|breakfast|lunch|dinner|snacks?)\b/i.test(value);if(!body||/^(?:please|my food|my meal)$/i.test(body))return explicit?{kind:'prompt'}:null;if(!explicit&&!foodWords.test(body))return null;return {kind:'food',body};}
    if(/\?/.test(value)||/^(?:what|when|where|which|who|why|how|should|could|can|do|did|is|are|will)\b/i.test(value))return null;
    if(/^(?:same as|repeat|reuse)\b.*\b(?:yesterday|last night|breakfast|lunch|dinner|snack)\b/i.test(value))return {kind:'food',body:value};
    if(/^(?:i\s+(?:ate|had|drank)\s+)/i.test(value)&&foodWords.test(value)||/^(?:ate|had|drank|for\s+)?\s*(?:my\s+)?(?:breakfast|lunch|dinner|snack|food|meal)\b/i.test(value))return {kind:'food',body:value};
    if(foodWords.test(value)&&!/^help me (?:with|understand)\b/i.test(value))return {kind:'food',body:value};
    return null;
  }
  const starters={
    me:[['Review my progress','What stands out in my recent training and nutrition, and what should I focus on next?'],['Plan my next step','Given my goals and recent activity, what would be a useful next step?'],['Help me use Kinetta','What can I do in Kinetta to track my fitness and nutrition?']],
    nutrition:[['Look at my food today','Review my logged food today. What is known, what is missing, and what could I focus on?'],['What could I eat next?','Using my saved foods and remaining targets today, suggest a meal I can review before logging.'],['Talk about my diet','Help me think through a sustainable diet for my goals. Ask me what you need to know.']],
    activity:[['Review this workout','Review the activity in the current screen context against my own recent workouts. What should I take from it?'],['Review my training','Review my recent workouts across all sports. What stands out, and what is missing?'],['Help with recovery','What should I consider for recovery given my recent training?']],
    progress:[['Am I improving?','Review my progress across my recorded workouts, strength and nutrition. Be clear about what the data can show.'],['Look at my consistency','How consistent have my recorded workouts and food logs been recently?'],['Choose a focus','Given my goals and recent records, what should I focus on next?']],
    plan:[['Review my upcoming week','Review my upcoming training using my current plan, recent load and permitted plan options.'],['Help me adjust my plan','Do any permitted plan adjustments fit my recent training? Show a proposal for review if useful.'],['Explain my training','Explain the purpose of my upcoming workouts and how they relate to my goal.']],
    strength:[['Review my strength work','Review my recorded completed strength sets. What progress can I verify?'],['Plan my next step','What should I consider for my next strength session given my records and goals?'],['Help me record sets','How do I record strength exercises and sets in Kinetta?']],
    track:[['Choose a workout','Given my current plan and recent training, what should I consider doing next?'],['Help me record','How do I record a workout or strength session in Kinetta?'],['Talk about exercise','Help me choose exercise that fits my goals. Ask me what you need to know.']]};
  const starterIcons={me:['trophy','calendar','help'],nutrition:['food','pot','help'],activity:['run','calendar','heart'],progress:['trophy','calendar','sparkle'],plan:['calendar','edit','help'],strength:['workout','calendar','edit'],track:['run','edit','heart']};
  let current,entryDraft;
  const tabEntryUsers=new Set(),activityEntryUsers=new Map(),activityEntryRequests=new Map();
  const owner=()=>App.me&&JSON.stringify([Native.base||location.origin,App.me.id]);
  const key=(o,k)=>'fit.kit.'+k+':'+o;
  function entryRelevant(path,enabled=kitChatOn()){
    const o=owner();if(o&&['/food','/activity','/track'].includes(path))tabEntryUsers.add(o);
    return enabled||!!(App.me?.food_user||App.me?.kcal_target)||!!o&&(tabEntryUsers.has(o)||activityEntryUsers.get(o)===true);
  }
  function checkActivityEntry(el,path){
    const o=owner();if(!o||activityEntryUsers.has(o))return Promise.resolve(false);
    if(activityEntryRequests.has(o))return activityEntryRequests.get(o);
    const cached=App.cache?.get('/api/activities?limit=1')?.data||kept('/api/activities?limit=1');
    if(Array.isArray(cached)){
      const used=cached.length>0;activityEntryUsers.set(o,used);
      if(used){const page=document.querySelector('#page');if(page?.isConnected)entry(page,location.pathname);}
      return Promise.resolve(used);
    }
    const pending=readOnce('/api/activities?limit=1').then(rows=>{
      const used=Array.isArray(rows)&&rows.length>0;if(owner()!==o)return false;activityEntryUsers.set(o,used);
      if(used){const page=document.querySelector('#page');if(page?.isConnected)entry(page,location.pathname);}
      return used;
    }).catch(()=>{if(owner()===o)activityEntryUsers.set(o,false);return false;}).finally(()=>activityEntryRequests.delete(o));
    activityEntryRequests.set(o,pending);return pending;
  }
  const active=c=>current===c&&!c.closed&&c.el.isConnected&&c.owner===owner()&&c.session===readOwner();
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
  const providerName=()=>App.me?.ai_provider||"Google's Gemini";
  const shortProvider=()=>providerName().replace(/^Google's Gemini$/,'Gemini').replace(/^Anthropic's Claude$/,'Claude');
  const questionFor=(c,i)=>c.context.screen==='activity'&&i===0&&!c.context.activity_id?'Review my latest own workout against my recent history. Use the workout date to find the latest one, rather than the upload order.':starters[c.context.screen][i]?.[1];
  function controls(c){
    const busy=c.sending||c.messages.some(m=>['pending','running'].includes(m.state));
    $('#kit-send',c.el).disabled=!c.loaded||!c.ready||busy||!kitChatOn()||!$('#kit-text',c.el).value.trim();
    $$('[data-kit-start]',c.el).forEach(b=>b.disabled=!c.loaded||!c.ready||busy||!kitChatOn());
  }
  function factLabel(f){
    const labels={kcal:'Calories (kcal)',protein_g:'Protein (g)',carbs_g:'Carbohydrates (g)',fat_g:'Fat (g)',fiber_g:'Fiber (g)',sodium_mg:'Sodium (mg)',sugar_g:'Sugar (g)',saturated_fat_g:'Saturated fat (g)',protein_target:'Protein goal (g)',kcal_target:'Calorie goal (kcal)',distance_m:'Distance (m)',moving_s:'Moving time (seconds)'};
    const path=f.path||[],last=path.at(-1),prefix={known_totals:'Known total',totals:'Total',average_per_logged_day:'Average per logged day',foods:'Food entry',activities:'Workout'}[path[0]];
    return labels[last]?(prefix?prefix+' · ':'')+labels[last]:f.label;
  }
  function draw(c){
    if(!active(c))return;
    const list=$('#kit-messages',c.el),foodHost=c.foodHost;
    if(foodHost?.isConnected)foodHost.remove();
    const pending=c.job&&!c.messages.some(m=>String(m.client_id)===c.job.client_id);
    const messages=[...c.messages,...(c.localMessages||[])],has=messages.length||pending||c.foodStarted;
    list.innerHTML=messages.map(m=>{
      const a=m.answer,facts=(a?.facts||[]).filter(f=>!['id','source_id','route_id','candidate_id'].includes(f.path?.at(-1))), failed=m.state==='failed'||c.answerErrors?.[m.client_id];
      return `<article data-kit-id="${esc(String(m.client_id))}"><div class="thread-user"><p>${esc(m.question)}</p></div>${a?`<div class="thread-card kit-answer"><p>${esc(a.interpretation)}</p>${facts.length?`<dl class="kit-facts">${facts.map(f=>`<div><dt>${esc(factLabel(f))}</dt><dd>${esc(String(f.value))}</dd></div>`).join('')}</dl>`:''}${a.limitations?.length?`<details><summary>What Kit could check</summary>${[...new Set(a.limitations)].map(l=>`<p class="small muted">${esc(l)}</p>`).join('')}</details>`:''}${a.selection?'<button type="button" class="ghost wide" data-kit-review>Review proposed change</button>':''}${a.actions?.filter(x=>Object.hasOwn(actions,x)).map(x=>`<a class="linkbtn kit-action" href="${x==='activities'?profileHref(App.me):actions[x][1]}">${actions[x][0]} ${svg('chev')}</a>`).join('')||''}</div>`:failed?`<div class="thread-card"><p class="err">${esc(c.answerErrors?.[m.client_id]||m.error||'Kit could not finish. Your question is saved.')}</p>${kitChatOn()&&c.ready?'<button type="button" class="ghost" data-kit-retry>Retry</button>':''}</div>`:`<div class="thread-card thread-thinking"><div class="thread-typing" role="status" aria-label="Kit is checking your records"><span></span><span></span><span></span></div></div>`}</article>`;
    }).join('')+(pending?`<article><div class="thread-user"><p>${esc(c.job.question)}</p></div><div class="thread-card"><p>${esc(c.jobError||'Sending your question…')}</p>${c.jobError&&kitChatOn()&&c.ready?'<button type="button" class="ghost" id="kit-retry-send">Retry sending</button>':''}</div></article>`:'')+(c.foodStarted?'<div id="kit-food-slot"></div>':'');
    if(foodHost&&c.foodStarted)$('#kit-food-slot',list)?.append(foodHost);
    $('#kit-intro',c.el).hidden=!!has;
    $('#kit-fine',c.el).hidden=!!has;
    $('#kit-older',c.el).hidden=!c.before;
    $$('[data-kit-retry]',list).forEach(b=>b.onclick=()=>answer(c,b.closest('[data-kit-id]').dataset.kitId));
    $$('[data-kit-review]',list).forEach(b=>b.onclick=()=>{const m=c.messages.find(m=>String(m.client_id)===b.closest('[data-kit-id]').dataset.kitId);kitReview(m.answer.selection,{scopeKey:'kit:'+m.client_id,conversation:true,onSaved:()=>status(c,'Saved. You can ask Kit to check your updated records.'),onStale:()=>status(c,'Your records changed. Ask Kit again before confirming this proposal.')});});
    const retry=$('#kit-retry-send',list);if(retry)retry.onclick=()=>deliver(c);
    controls(c);c.view?.pin();
  }
  async function mountFoodThread(c){
    if(c.foodHost?.isConnected)return c.foodHost;
    if(typeof FoodThread==='undefined')await loadClassicScript(THREAD_ROUTE_ASSET);
    if(typeof FoodThread==='undefined')throw Error('Food logging is unavailable right now. Your message is still here.');
    await FoodThread.prepare();if(!active(c))return null;
    c.foodStarted=true;draw(c);const slot=$('#kit-food-slot',c.el),host=document.createElement('section');
    host.className='shell kit-food-inline';host.setAttribute('aria-label','Food log');slot.append(host);c.foodHost=host;
    try{await FoodThread.page(host,{});if(!active(c)||!host.isConnected){if(c.foodHost===host){host.remove();c.foodHost=null;c.foodStarted=false;if(active(c))draw(c);}return null;}draw(c);return host;}
    catch(error){if(c.foodHost===host){host.remove();c.foodHost=null;c.foodStarted=false;draw(c);}throw error;}
  }
  function clearDraft(c,field,submitted){
    if(submitted!=null&&field.value.trim()!==submitted.trim())return false;
    field.value='';field.style.height='';store.del(key(c.owner,'draft'));return true;
  }
  async function sendFood(c,text){
    const host=await mountFoodThread(c);if(!host)return false;const field=$('#thread-text',host),form=$('#thread-composer',host),notice=$('#thread-status',host);
    if(!field||!form)throw Error('Food logging could not open. Your message is still here.');
    if(field.value.trim()&&field.value.trim()!==text){status(c,'Your saved food draft is kept in the food log. Finish it before adding another.');return false;}
    field.value=text;field.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();
    const end=Date.now()+2500;
    while(active(c)&&Date.now()<end){
      if(!field.value.trim())return true;
      if(notice.textContent.trim())throw Error(notice.textContent.trim());
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    if(!field.value.trim())return true;
    throw Error(notice.textContent.trim()||'Food is still being saved on this phone. Keep this chat open and try again.');
  }
  async function refresh(c,before=null){
    const data=await api('/api/coach/conversation?visit_id='+encodeURIComponent(c.visit_id)+(before?'&before='+before:''));if(!active(c))return;
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

    if(!c.ready)status(c,'Kit chat isn’t available yet. Your food log and other app tools still work.');
    else if(!kitChatOn())status(c,App.me?.ai_ok?'Kit is unavailable. Your saved answers and draft are kept.':'Kit is off. Turn it on in Settings to chat.');
    draw(c);
    const waiting=c.messages.find(m=>m.state==='pending');
    if(c.ready&&kitChatOn()&&waiting&&!c.sending&&!c.answerErrors?.[waiting.client_id])answer(c,waiting.client_id);
    else if(c.messages.some(m=>m.state==='running'))later(c);
  }
  const later=c=>{clearTimeout(c.timer);c.timer=setTimeout(()=>{if(active(c))refresh(c).catch(e=>status(c,e.message));},2500);};
  async function answer(c,id){
    if(!active(c)||c.sending||!c.ready||!kitChatOn())return;c.answerErrors||={};delete c.answerErrors[id];c.sending=true;const generation=c.generation,visit_id=c.visit_id,valid=()=>active(c)&&c.generation===generation&&c.visit_id===visit_id;controls(c);
    try{
      const row=await api('/api/coach/conversation/messages/'+id+'/answer',json('POST',{generation,visit_id}));if(!valid())return;
      if(row.cancelled){await refresh(c);return;}
      c.messages=c.messages.map(m=>String(m.client_id)===String(id)?row:m);draw(c);
      if(row.state==='running')later(c);else await refresh(c).catch(()=>status(c,'Your answer is saved. Return when online to refresh the full history.'));
    }catch(e){if(valid()){c.answerErrors[id]=e.message;status(c,e.message);await refresh(c).catch(()=>{});draw(c);}}
    finally{if(valid())c.sending=false;if(valid()){controls(c);if(c.messages.some(m=>m.state==='running'))later(c);}}
  }
  async function deliver(c){
    if(!active(c)||c.sending||!c.job||!c.ready||!kitChatOn())return;c.sending=true;const generation=c.generation,visit_id=c.visit_id,valid=()=>active(c)&&c.generation===generation&&c.visit_id===visit_id;c.jobError='';draw(c);
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
    const question=(text??$('#kit-text',c.el).value).trim();if(!question)return;
    const field=$('#kit-text',c.el),intent=foodIntent(question,c.awaitingFood);
    if(intent?.kind==='prompt'){
      c.awaitingFood=true;c.localMessages||=[];c.localMessages.push({client_id:'local-'+Date.now(),question,answer:{interpretation:'What did you have?'},state:'answered'});
      clearDraft(c,field,question);draw(c);return;
    }
    if(intent?.kind==='food'){
      c.sending=true;controls(c);
      try{if(await sendFood(c,intent.body)){c.awaitingFood=false;clearDraft(c,field,question);status(c,'');}}
      catch(e){status(c,e.message);}
      finally{if(active(c)){c.sending=false;controls(c);draw(c);}}
      return;
    }
    c.awaitingFood=false;
    if(!kitChatOn()){status(c,'Kit is unavailable. Your draft is kept.');return;}
    if(!c.ready){status(c,'Kit chat isn’t available yet. Your draft is kept.');return;}
    if(c.job){status(c,'Retry the saved question before sending another.');return;}
    const job={client_id:newId(),generation:c.generation,visit_id:c.visit_id,question,context:c.context};
    try{save(c,'pending',job);c.job=job;await deliver(c);}catch(e){status(c,'This phone could not save your question. Keep it here and try again.');}
  }
  function savedReviews(){
    const session=readOwner();
    sheet('Earlier Kit reviews','<div id="kit-saved-reviews"><p class="muted">Loading saved reviews…</p></div>',body=>{
      Promise.allSettled([api('/api/coach/week'),api('/api/food/review')]).then(results=>{
        if(session!==readOwner()||!body.isConnected)return;
        const week=results[0].status==='fulfilled'?results[0].value.latest:null,food=results[1].status==='fulfilled'?results[1].value.latest:null;
        $('#kit-saved-reviews',body).innerHTML=(week?`<section><h3>Training</h3><p class="small muted">${esc(week.period_start||'')}</p><p>${esc(week.text||'')}</p></section>`:'')+(food?`<section><h3>Nutrition</h3><p class="small muted">${esc(food.day||'')}</p><p>${esc(food.headline||'')}</p><p>${esc(food.text||'')}</p>${[...(food.going_well||[]),...(food.try_next||[])].map(t=>`<p>${esc(t)}</p>`).join('')}${food.watch?`<p>${esc(food.watch)}</p>`:''}</section>`:'')+(!week&&!food?'<p>No earlier reviews are saved. Your workout notes remain on the individual activities.</p>':'')+(results.some(r=>r.status==='rejected')?'<p class="muted">Some saved reviews could not load. Close and try again when online.</p>':'');
      });
    });
  }
  function leave(c){
    if(c.closed)return;
    const field=$('#kit-text',c.el),waiting=c.job?.question||c.messages.findLast(m=>['pending','running'].includes(m.state))?.question;
    if(!field?.value&&waiting)try{save(c,'draft',waiting);}catch{}
    c.closed=true;clearTimeout(c.timer);store.del(key(c.owner,'pending'));
    if(c.session===readOwner())api('/api/coach/conversation/visits/'+c.visit_id+'/end',{method:'POST',keepalive:true}).catch(()=>{});
  }
  async function begin(c){
    c.closed=false;c.loaded=false;c.messages=[];c.job=null;c.sending=false;c.before=null;c.answerErrors={};c.visit_id=newId();
    const visit=c.visit_id;draw(c);status(c,'Opening a fresh chat…');
    const start=async()=>{
      const data=await api('/api/coach/conversation/visits',json('POST',{visit_id:visit}));
      if(!active(c)||c.visit_id!==visit)return;
      c.generation=data.generation;status(c,'');await refresh(c);
      if(active(c)&&c.visit_id===visit&&typeof FeatureUsage!=='undefined')void FeatureUsage.event('kit_conversation');
    };
    try{await start();}catch(e){if(active(c)&&c.visit_id===visit){status(c,e.message);const retry=$('#kit-load-retry',c.el);retry.hidden=false;retry.onclick=async()=>{retry.hidden=true;try{await start();}catch(x){if(active(c)){status(c,x.message);retry.hidden=false;}}};}}
  }
  function memorySettings(){
    const session=readOwner();
    sheet('What Kit remembers','<div id="kit-memory"><p class="muted">Loading memory…</p></div>',body=>{
      const box=$('#kit-memory',body),valid=()=>session===readOwner()&&body.isConnected;
      const draw=async()=>{
        try{
          const data=await api('/api/coach/conversation/memory');if(!valid())return;
          box.innerHTML=`<p>Kit can keep short statements you share about your preferences, goals and routines, in your own words. It keeps up to twelve for six months. Current records and what you say now take priority.</p><label class="check"><input type="checkbox" id="kit-memory-on" ${data.enabled?'checked':''}>Remember useful details</label><p class="small muted">Turning this off also removes saved memories. Removing a memory stops its use in future chats; messages in your current chat stay until you leave.</p><div class="kit-memories">${data.memories.length?data.memories.map(m=>`<article class="card"><p>${esc(m.text)}</p><button type="button" class="linkbtn danger" data-kit-forget="${m.id}">Forget this</button></article>`).join(''):'<p class="muted">No saved memories yet.</p>'}</div>${data.memories.length?'<button type="button" class="ghost wide danger" id="kit-forget-all">Forget all memories</button>':''}<p class="err" id="kit-memory-error" role="alert"></p>`;
          $('#kit-memory-on',box).onchange=async e=>{
            if(!valid())return;
            const enabled=e.target.checked;
            const toggle=e.target;if(!enabled&&(!await confirmSheet('Turn off Kit memory?',{body:'Everything Kit remembers is removed. Your records stay saved.',action:'Turn off'})||!valid())){toggle.checked=true;return;}
            e.target.disabled=true;
            try{await api('/api/coach/conversation/memory',json('PUT',{enabled}));if(valid())await draw();}catch(x){if(valid()){$('#kit-memory-error',box).textContent=x.message;e.target.checked=!enabled;e.target.disabled=false;}}
          };
          $$('[data-kit-forget]',box).forEach(button=>button.onclick=async()=>{
            if(!valid())return;
            button.disabled=true;try{await api('/api/coach/conversation/memory/'+button.dataset.kitForget,{method:'DELETE'});if(valid())await draw();}catch(x){if(valid()){$('#kit-memory-error',box).textContent=x.message;button.disabled=false;}}
          });
          const all=$('#kit-forget-all',box);if(all)all.onclick=async()=>{
            if(!valid())return;
            if(!await confirmSheet('Forget all Kit memories?',{body:'Your records and current chat stay saved.',action:'Forget all'})||!valid())return;
            all.disabled=true;try{await api('/api/coach/conversation/memory',{method:'DELETE'});if(valid())await draw();}catch(x){if(valid()){$('#kit-memory-error',box).textContent=x.message;all.disabled=false;}}
          };
        }catch(e){if(valid())box.innerHTML=`<p class="err">${esc(e.message)}</p><button class="ghost wide" id="kit-memory-retry">Try again</button>`;const retry=$('#kit-memory-retry',box);if(retry)retry.onclick=draw;}
      };draw();
    });
  }
  async function mount(el){
    if(typeof FoodThread==='undefined')await loadClassicScript(THREAD_ROUTE_ASSET);
    const ctx=context(),back=screens[ctx.screen],c={el,context:ctx,owner:owner(),session:readOwner(),messages:[],localMessages:[],loaded:false,sending:false,awaitingFood:false,foodStarted:false};current=c;
    el.classList.add('food-thread','kit-chat');
    el.innerHTML=`<header class="thread-heading"><a class="back" href="${back[1]}">${svg('back')}${back[0]}</a><h1>Ask Kit</h1><div class="kit-chat-actions"><button type="button" class="icon-btn" id="kit-saved" aria-label="Earlier Kit reviews" title="Earlier Kit reviews">${svg('list')}</button><button type="button" class="icon-btn kit-settings" id="kit-settings" aria-label="Kit chat settings">${svg('more')}</button></div></header><p id="kit-status" role="status" aria-live="polite"></p><button class="linkbtn" id="kit-older" type="button" hidden>Earlier messages</button><div id="kit-messages" aria-live="off"></div><section id="kit-intro"><h2><span class="kit-mark" aria-hidden="true">${svg('sparkle')}</span>What can I help with?</h2><div class="kit-starters">${starters[ctx.screen].map(([label],i)=>`<button type="button" data-kit-start="${i}">${svg(starterIcons[ctx.screen][i])}<span>${esc(ctx.screen==='activity'&&i===0&&!ctx.activity_id?'Review my latest workout':label)}</span></button>`).join('')}</div><button class="ghost wide" id="kit-load-retry" hidden>Try loading again</button></section><form id="kit-composer" class="thread-composer"><div class="thread-compose-row kit-compose-row"><label class="vh" for="kit-text">Message Kit</label><textarea id="kit-text" rows="1" maxlength="1500" enterkeyhint="send" placeholder="Message Kit…"></textarea><button class="primary thread-send" id="kit-send" aria-label="Send to Kit">${svg('send')}</button></div><p class="kit-fine" id="kit-fine">${esc(shortProvider())} · <button type="button" class="linkbtn" id="kit-footer-memory">Memory</button></p></form>`;
    const field=$('#kit-text',el),oldJob=store.get(key(c.owner,'pending'));
    field.value=store.get(key(c.owner,'draft'))||(entryDraft?.owner===c.owner?entryDraft.question:null)||oldJob?.question||new URLSearchParams(location.search).get('question')?.slice(0,1500)||'';
    entryDraft=null;store.del(key(c.owner,'pending'));
    const resize=()=>{field.style.height='auto';field.style.height=Math.min(field.scrollHeight,140)+'px';};
    field.oninput=()=>{try{save(c,'draft',field.value);}catch(e){status(c,'Your draft could not be saved on this phone.');}resize();controls(c);};
    field.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();send(c);}};
    $('#kit-composer',el).onsubmit=e=>{e.preventDefault();send(c);};
    $$('[data-kit-start]',el).forEach(b=>b.onclick=()=>send(c,questionFor(c,+b.dataset.kitStart)));
    $('#kit-footer-memory',el).onclick=memorySettings;
    $('#kit-older',el).onclick=async()=>{const list=$('#kit-messages',el),h=list.scrollHeight,y=list.scrollTop;try{await refresh(c,c.before);list.scrollTop=y+list.scrollHeight-h;}catch(e){status(c,e.message);}};
    $('#kit-saved',el).onclick=savedReviews;
    $('#kit-settings',el).onclick=()=>sheet('Kit chat',`<button type="button" class="linkbtn wide" id="kit-about-open">About Kit</button><button type="button" class="linkbtn wide" id="kit-memory-open">What Kit remembers</button><a class="linkbtn wide" href="/me/settings#ai" data-close>Kit & data permissions</a><button type="button" class="ghost wide" id="kit-clear">Start a new chat</button><p class="small muted">Your food, workouts, plans, goals and saved memories stay available.</p>`,(body,close)=>{
      $('#kit-about-open',body).onclick=()=>{close();sheet('About Kit',`<p>New chat each visit.</p><p>Uses ${esc(providerName())}.</p><p>Kit checks your own records when needed and can keep useful details you share.</p>`);};
      $('#kit-memory-open',body).onclick=()=>{close();memorySettings();};
      $('#kit-clear',body).onclick=async e=>{
        if(!active(c)||!c.loaded)return;e.target.disabled=true;
        const previousVisit=c.visit_id;
        try{const data=await api('/api/coach/conversation/clear',json('POST',{generation:c.generation,visit_id:previousVisit,confirmed:true}));if(!active(c)||c.visit_id!==previousVisit)return;clearTimeout(c.timer);c.visit_id=data.visit_id;c.generation=data.generation;c.sending=false;c.answerErrors={};c.messages=[];c.before=null;c.job=null;c.jobError='';store.del(key(c.owner,'pending'));store.del(key(c.owner,'draft'));field.value='';close();status(c,'');draw(c);}catch(x){if(active(c)){status(c,x.message);e.target.disabled=false;}}
      };
    });
    c.view=foodChatViewport({list:$('#kit-messages',el),composer:$('#kit-composer',el),field,send:$('#kit-send',el),active:()=>active(c)});
    const events=new AbortController();
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){leave(c);return;}
      if(current===c&&c.el.isConnected&&c.owner===owner()&&c.session===readOwner()){
        if(c.closed){field.value=store.get(key(c.owner,'draft'))||field.value;resize();begin(c);}else refresh(c).catch(e=>status(c,e.message));
      }
    },{signal:events.signal});
    window.addEventListener('pagehide',()=>leave(c),{signal:events.signal});
    window.addEventListener('pageshow',()=>{if(current===c&&c.closed&&c.el.isConnected&&c.session===readOwner())begin(c);},{signal:events.signal});
    viewResources.set(el,()=>{leave(c);events.abort();c.view.dispose();});
    controls(c);resize();await begin(c);
    if(active(c))c.view.pin(true);
  }
  function eraseDevice(){const o=owner();entryDraft=null;if(current){clearTimeout(current.timer);current.view?.dispose();current=null;}if(o){tabEntryUsers.delete(o);activityEntryUsers.delete(o);activityEntryRequests.delete(o);for(const k of ['draft','pending'])localStorage.removeItem(key(o,k));for(const k of Object.keys(localStorage))if(k.startsWith('fit.kit.proposal:'+o+':'))localStorage.removeItem(k);}}
  function entry(el,path){
    const screen=/^\/track\/lift\/\d+$/.test(path)?'strength':{'/me':'me','/food':'nutrition','/food/insights':'nutrition','/activity':'activity','/progress':'progress','/track':'track','/plan':'plan'}[path];
    if(!el||!screen)return;
    const insights=path==='/food'&&new URLSearchParams(globalThis.location?.search).get('view')==='overview';
    const heading=insights?el.querySelector('#nt-coach'):el.querySelector('.top,.me-top');if(!heading)return;
    const enabled=kitChatOn();
    if(!entryRelevant(path,enabled)){el.querySelector('[data-kit-entry]')?.remove();return checkActivityEntry(el,path);}
    let link=el.querySelector('[data-kit-entry]');
    if(!link){link=document.createElement('a');link.className='icon-btn kit-help';link.setAttribute('data-kit-entry','');link.innerHTML=svg('sparkle');(heading.querySelector('.acts,.me-profile-tools')||heading).append(link);}
    link.href=enabled?href(screen):'/food?add=1';link.setAttribute('aria-label',enabled?'Ask Kit':'Add food');link.title=enabled?'Ask Kit':'Add food';
    if(insights)heading.classList.add('insights-kit-entry');
  }
  return {loaded:true,mount,href,open,entry,entryRelevant,eraseDevice,starters,actions,memorySettings,savedReviews,foodIntent};
})());
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
