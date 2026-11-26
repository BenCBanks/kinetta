// One private conversation across the app. Numbers and proposed writes remain server-validated.
'use strict';
if (typeof IC !== 'undefined') Object.assign(IC, {
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 12z"/><path d="M8 9h.01M12 9h.01M16 9h.01"/>',
});
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
  const followupVerbs=new Set(['add','adjust','analyze','build','calculate','check','choose','compare','consider','create','describe','estimate','explain','explore','find','focus','get','go','help','identify','improve','include','keep','learn','list','log','look','make','measure','open','pick','plan','record','review','save','see','set','show','start','summarize','switch','tell','think','track','try','understand','update','use','view']);
  function rewriteFollowup(text){
    const original=String(text??''),trimmed=original.trim();
    if(/^would you like to review your latest completed workouts from this training block and compare how they fit (?:my|your) plan\?$/i.test(trimmed))return 'Compare my workouts';
    const feeling=trimmed.match(/^are your (legs|arms|feet|shoulders|hips) feeling (heavy|tired|fatigued)(?: or (?:heavy|tired|fatigued))? today\?$/i);
    if(feeling)return `My ${feeling[1].toLowerCase()} feel ${feeling[2].toLowerCase()==='fatigued'?'tired':feeling[2].toLowerCase()} today`;
    const match=trimmed.match(/^(?:would\s+you\s+like\s+to|do\s+you\s+want\s+to|should\s+we|shall\s+we|can\s+we|want\s+to)\s+(.+?)\?$/i);
    if(!match){
      if(/^(?:are your|do you|did you|have you|how are you|how do your)\b/i.test(trimmed)&&trimmed.endsWith('?'))return null;
      return original;
    }
    let result=match[1].trim();if(!result)return original;
    result=result.replace(/\b(yourself|your|you|we)\b(?!['’])/gi,word=>({yourself:'myself',your:'my',you:'I',we:'I'})[word.toLowerCase()]);
    result=result[0].toUpperCase()+result.slice(1);
    const first=result.match(/^([\p{L}]+)/u)?.[1];
    return first&&followupVerbs.has(first.toLowerCase())?result:original;
  }
  function pruneLongSuggestions(root){
    const prune=()=>$$('.kit-suggested-reply',root).forEach(button=>{
        const text=button.querySelector('span'),range=document.createRange();range.selectNodeContents(text);
        const lines=[...range.getClientRects()].map(rect=>Math.round(rect.top*10)/10);
        if(new Set(lines).size>2)button.remove();
      });
    if(document.fonts?.status==='loading')document.fonts.ready.then(prune);else prune();
  }
  const starters={
    me:['Review my progress','Plan my next step','Help me use Kinetta'],
    nutrition:['Look at my food today','What could I eat next?','Talk about my diet'],
    activity:['Review this workout','Review my training','Help with recovery'],
    progress:['Am I improving?','Look at my consistency','Choose a focus','Review my week'],
    plan:['Review my upcoming week','Help me adjust my plan','Explain my training'],
    strength:['Review my strength work','Plan my next step','Help me record sets'],
    track:['Choose a workout','Help me record','Talk about exercise']};
  const starterIcons={me:['trophy','calendar','help'],nutrition:['food','pot','chat'],activity:['run','calendar','heart'],progress:['trophy','calendar','sparkle','calendar'],plan:['calendar','edit','help'],strength:['workout','calendar','edit'],track:['run','edit','heart']};
  let current,entryDraft;
  const VISIT_MAX_AGE=24*60*60*1000,ROUTE_IDLE_LIMIT=30*60*1000,visitExpiryTimers=new Map();
  const tabEntryUsers=new Set(),activityEntryUsers=new Map(),activityEntryRequests=new Map();
  const owner=()=>App.me&&JSON.stringify([Native.base||location.origin,App.me.id]);
  const key=(o,k)=>'fit.kit.'+k+':'+o;
  function readVisit(o){try{const v=JSON.parse(localStorage.getItem(key(o,'visit'))||'null');return v&&typeof v.visit_id==='string'&&Number.isFinite(v.created_at)?v:null;}catch{return null;}}
  function writeVisit(o,v){localStorage.setItem(key(o,'visit'),JSON.stringify(v));}
  function cancelVisitExpiry(o){const timer=visitExpiryTimers.get(o);if(timer!=null)clearTimeout(timer);visitExpiryTimers.delete(o);}
  async function endVisit(o,record){
    if(owner()!==o||!record?.visit_id)return;
    try{await api('/api/coach/conversation/visits/'+encodeURIComponent(record.visit_id)+'/end',{method:'POST'});}catch{}
    const latest=readVisit(o);if(owner()===o&&latest?.visit_id===record.visit_id)store.del(o,'visit');
  }
  function scheduleVisitExpiry(o,record){
    cancelVisitExpiry(o);if(!record?.left_at)return;
    const wait=Math.max(0,ROUTE_IDLE_LIMIT-(Date.now()-record.left_at));
    visitExpiryTimers.set(o,setTimeout(()=>{const latest=readVisit(o);if(latest?.visit_id===record.visit_id&&latest.left_at===record.left_at)void endVisit(o,latest);},wait));
  }
  function keepDraft(c){const field=$('#kit-text',c.el);if(field?.value)try{save(c,'draft',field.value);}catch{}}
  function leaveRoute(c){
    if(c.closed)return;c.closed=true;clearTimeout(c.timer);c.streamController?.abort();keepDraft(c);
    const visit=readVisit(c.owner);if(visit?.visit_id!==c.visit_id)return;
    const record=visit.left_at?visit:{...visit,left_at:Date.now()};
    if(!visit.left_at)writeVisit(c.owner,record);scheduleVisitExpiry(c.owner,record);
  }
  function suspend(c){keepDraft(c);c.suspended=true;}
  function resume(c){if(!active(c)||!c.suspended)return;c.suspended=false;refresh(c).catch(e=>status(c,e.message));}
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
  const chatKey=(c,k)=>key(c.owner,c.conversation_id&&['draft','pending'].includes(k)?k+':'+c.conversation_id:k);
  const save=(c,k,v)=>{localStorage.setItem(chatKey(c,k),JSON.stringify(v));};
  const status=(c,text)=>{if(active(c))$('#kit-status',c.el).textContent=text||'';};
  function clearWait(c){if(c.waitTimer)clearTimeout(c.waitTimer);c.waitTimer=null;c.waiting=null;}
  function waitBubble(c,target){
    if(!target||c.jobError||c.answerErrors?.[target.id]){clearWait(c);return '';}
    if(c.waiting?.id!==target.id){clearWait(c);c.waiting={id:target.id,startedAt:Date.now()};}
    const elapsed=Date.now()-c.waiting.startedAt;
    if(elapsed<20000&&!c.waitTimer)c.waitTimer=setTimeout(()=>{c.waitTimer=null;if(active(c))draw(c);},Math.max(0,(elapsed<4000?4000:20000)-elapsed));
    if(elapsed<4000)return '<div class="kit-status-bubble kit-waiting-bubble" role="status" aria-label="Kit is checking your data"><div class="thread-typing" aria-hidden="true"><span></span><span></span><span></span></div></div>';
    const work=/\b(?:workouts?|training|exercise|runs?|rides?|walks?|cycles?|sessions?|activity|lifting|strength)\b/i.test(target.question||'');
    const message=work?'Looking at your recent workouts…':'Checking your data…';
    return `<div class="kit-status-bubble kit-waiting-bubble" role="status" aria-live="polite"><div class="kit-waiting-copy"><p>${message}</p>${elapsed>=20000?'<p class="kit-still-working">Still working…</p>':''}</div></div>`;
  }
  const errorBubble=(message,retry)=>`<div class="kit-status-bubble kit-error-bubble" role="alert"><p>${message}</p>${retry}</div>`;
  function href(screen='me',activityId=null,question=null){const q=new URLSearchParams({from:Object.hasOwn(screens,screen)?screen:'me'});if(activityId)q.set('activity',activityId);if(question)q.set('question',question.slice(0,1500));return '/me/kit?'+q;}
  function open(screen='me',activityId=null,question=null){
    const o=owner();
    if(o&&question){
      if(store.get(key(o,'draft'))||store.get(key(o,'conversation'))&&store.get(key(o,'draft:'+store.get(key(o,'conversation')))))toast('Your existing Kit draft is kept.');
      else try{localStorage.setItem(key(o,'draft'),JSON.stringify(question.slice(0,1500)));}catch{entryDraft={owner:o,question:question.slice(0,1500)};}
    }
    go(href(screen,activityId));
  }
  function context(){const q=new URLSearchParams(location.search),screen=Object.hasOwn(screens,q.get('from'))?q.get('from'):q.get('review')==='plan'?'plan':'me';const id=Number(q.get('activity'));return {screen,activity_id:Number.isSafeInteger(id)&&id>0?id:null};}
  const providerName=()=>App.me?.ai_provider||"Google's Gemini";
  const shortProvider=()=>providerName().replace(/^Google's Gemini$/,'Gemini').replace(/^Anthropic's Claude$/,'Claude');
  function controls(c){
    const busy=c.sending||c.messages.some(m=>['pending','running'].includes(m.state));
    $('#kit-send',c.el).disabled=!c.loaded||!c.ready||busy||!kitChatOn()||!$('#kit-text',c.el).value.trim();
    $$('[data-kit-start],[data-kit-followup]',c.el).forEach(b=>b.disabled=!c.loaded||!c.ready||busy||!kitChatOn());
  }
  function factLabel(f){
    if(f.display_value!=null&&f.label)return f.label;
    const labels={kcal:'Calories',protein_g:'Protein',carbs_g:'Carbohydrates',fat_g:'Fat',fiber_g:'Fibre',sodium_mg:'Sodium',sugar_g:'Sugar',saturated_fat_g:'Saturated fat',protein_target:'Protein goal',kcal_target:'Calorie goal',distance_m:'Distance',moving_s:'Moving time',elapsed_s:'Elapsed time',duration_s:'Duration',pace_s_per_km:'Pace',workouts:'Workouts',count:'Workouts',kg:'Weight',avg_hr:'Heart rate'};
    const path=f.path||[],last=path.at(-1),prefix=path.includes('average_per_logged_day')?'Average per logged day':path.includes('known_totals')?'Known total':path.some(k=>['totals','totals_by_sport'].includes(k))?'Total':'';
    return labels[last]?(prefix?prefix+' · ':'')+labels[last]+(path.includes('per_serving')?' per serving':''):String(f.label||last||'Recorded value').replace(/[_–-]+/g,' ');
  }
  function factValue(f){
    if(f.display_value!=null)return String(f.display_value);
    const n=f.value,field=f.path?.at(-1),imperial=App.me?.units==='imperial';
    if(typeof n!=='number'||!Number.isFinite(n))return '–';
    const rounded=v=>Number(v.toFixed(1)).toLocaleString();
    if(field==='distance_m')return rounded(n/(imperial?1609.344:1000))+' '+(imperial?'mi':'km');
    if(['moving_s','elapsed_s','duration_s'].includes(field))return Math.round(n/60).toLocaleString()+' min';
    if(field==='kg')return rounded(n*(imperial?2.2046226218:1))+' '+(imperial?'lb':'kg');
    const unit=field?.endsWith('_g')||field==='protein_target'?'g':field?.endsWith('_mg')?'mg':['kcal','kcal_target'].includes(field)?'kcal':field==='avg_hr'?'bpm':'';
    return rounded(n)+(unit?' '+unit:'');
  }
  function answerBlocks(a){
    // Weekly/workout reviews keep their dedicated presentation, including saved older answers.
    if(a?.weekly_review||a?.workout_review)return null;
    const blocks=a?.answer_blocks,text=(value,limit)=>typeof value==='string'&&!!value.trim()&&[...value].length<=limit;
    if(!Array.isArray(blocks)||!blocks.length||blocks.length>10||!blocks.every(block=>block&&(
      block.kind==='paragraph'?text(block.text,1600):block.kind==='list'&&Array.isArray(block.items)&&block.items.length&&block.items.length<=6&&block.items.every(item=>text(item,600))
    )))return null;
    return blocks;
  }
  function answerBlocksHtml(blocks){
    return `<div class="kit-answer-blocks">${blocks.map(block=>block.kind==='paragraph'
      ?`<p>${esc(block.text)}</p>`:`<ul>${block.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`).join('')}</div>`;
  }
  function answerCopy(a){
    const blocks=answerBlocks(a);
    if(blocks)return blocks.flatMap(block=>block.kind==='paragraph'?[block.text]:block.items).join(' ');
    return [a?.verdict,a?.reason,a?.interpretation,a?.weekly_review?.what_went_well,a?.weekly_review?.what_to_change,a?.weekly_review?.next_week_focus]
      .filter(v=>typeof v==='string'&&v.trim()).join(' ');
  }
  function copyIncludesValue(copy,value){
    const normalize=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/(?<=\d),(?=\d)/g,'').replace(/(\d+)\.0+(?=\D|$)/g,'$1').replace(/\bmins?\b/g,'minutes').replace(/\bhrs?\b/g,'hours').replace(/\s*\/mi\b/g,' per mile').replace(/\s*\/km\b/g,' per km');
    const candidate=normalize(value).trim();
    if(!candidate||candidate==='–')return false;
    const escaped=candidate.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,'u').test(normalize(copy));
  }
  function factSource(f){
    const explicit=String(f.source_label||f.source||'').trim().toLowerCase();
    if(explicit==='this run'||explicit==='current'||explicit==='run')return 'This run';
    if(explicit==='last run on this route'||explicit==='previous'||explicit==='route')return 'Last run on this route';
    const path=f.path||[];
    if(path[0]==='efforts'||path[0]==='previous'||path[0]==='comparable_routes')return 'Last run on this route';
    if(path[0]==='runs'||path[0]==='activity'||path[0]==='activities'||path[0]==='current')return 'This run';
    return '';
  }
  function isBareEffort(f){
    return f.path?.at(-1)==='effort'||String(f.label||'').trim().toLowerCase()==='effort';
  }
  function isFirstPersonFollowup(text){
    return /\b(?:i|me|my|mine|we|us|our|ours|let['’]s)\b/i.test(text)&&!/\b(?:you|your|yours|yourself|yourselves)\b/i.test(text);
  }
  function trainingDetails(facts){
    const groups=new Map();
    for(const fact of facts||[]){
      const path=fact.path||[],field=path.at(-1),value=fact.value;
      if(!['fitness','fatigue','form'].includes(field)||typeof value!=='number'||!Number.isFinite(value))continue;
      const dayPath=path[0]==='days'&&Number.isInteger(path[1])?`day:${path[1]}`:path[0]==='facts'&&path[1]==='latest_load'?'latest':null;
      if(dayPath==null)continue;
      const row=groups.get(dayPath)||{};row[field]=value;row.index=path[0]==='days'?path[1]:-1;groups.set(dayPath,row);
    }
    const rows=[...groups.values()].sort((a,b)=>b.index-a.index),latest=rows[0]||{};
    const round=value=>Math.round(value).toLocaleString('en-US');
    const out=[];
    if(Number.isFinite(latest.fatigue)&&Number.isFinite(latest.fitness)&&Math.round(latest.fitness)>0){
      const fatigue=Math.round(latest.fatigue),fitness=Math.round(latest.fitness),ratio=fatigue/fitness;
      const verdict=ratio<.8?'Lighter than usual':ratio>1.2?'Heavier than usual':'About usual';
      out.push({label:'Recent training',verdict,detail:`≈ ${round(fatigue)} vs ≈ ${round(fitness)} usual`});
    }
    if(Number.isFinite(latest.form)){
      const form=Math.round(latest.form),verdict=form < -10?'Carrying tiredness':form>5?'Fresh':'Balanced';
      const value=round(Math.abs(form)),number=form>0?`+${value}`:form<0?`−${value}`:value;
      out.push({label:'Freshness',verdict,detail:`≈ ${number}`});
    }
    return out;
  }
  function workoutDuration(seconds){
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0)return null;
    const minutes=Math.round(seconds/60),hours=Math.floor(minutes/60),rest=minutes%60;
    return hours?`${hours} hr ${rest} min`:`${minutes} min`;
  }
  function workoutDistance(meters,imperial){
    if(typeof meters!=='number'||!Number.isFinite(meters)||meters<=0)return null;
    const value=meters/(imperial?1609.344:1000),digits=value>=100?0:1;
    return `${Number(value.toFixed(digits)).toLocaleString()} ${imperial?'mi':'km'}`;
  }
  function workoutPace(secondsPerKm,imperial){
    if(typeof secondsPerKm!=='number'||!Number.isFinite(secondsPerKm)||secondsPerKm<=0)return null;
    const seconds=Math.round(secondsPerKm*(imperial?1.609344:1));
    return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} /${imperial?'mi':'km'}`;
  }
  function workoutSport(sport){
    return ({run:['run','runs'],walk:['walk','walks'],hike:['hike','hikes'],ride:['ride','rides'],swim:['swim','swims'],row:['rowing workout','rowing workouts'],ski:['ski workout','ski workouts']})[sport]||['workout','workouts'];
  }
  function workoutRelation(relation,delta,kind,imperial){
    if(relation==='about_the_same')return 'about the same';
    if(!['faster','slower','higher','lower'].includes(relation)||typeof delta!=='number'||!Number.isFinite(delta))return null;
    if(kind==='pace')return `${Math.max(1,Math.round(Math.abs(delta)*(imperial?1.609344:1)))} s/${imperial?'mi':'km'} ${relation}`;
    if(kind==='speed')return `${(Math.abs(delta)*(imperial?2.236936:3.6)).toFixed(1)} ${imperial?'mph':'km/h'} ${relation}`;
    if(kind==='hr')return `${Math.max(1,Math.round(Math.abs(delta)))} bpm ${relation}`;
    return null;
  }
  function workoutComparisonHtml(data){
    if(!data)return '';
    const current=data.current||{},deltas=data.deltas||{},relations=data.relations||{},imperial=App.me?.units==='imperial',sport=workoutSport(data.sport),count=Number.isInteger(data.baseline_count)?data.baseline_count:0;
    const pace=workoutPace(current.pace_s_per_km,imperial),speed=typeof current.speed_mps==='number'&&Number.isFinite(current.speed_mps)?`${(current.speed_mps*(imperial?2.236936:3.6)).toFixed(1)} ${imperial?'mph':'km/h'}`:null;
    const summary=[workoutDistance(current.distance_m,imperial),workoutDuration(current.moving_s),pace||speed].filter(Boolean).join(' · ');
    const rows=[];
    if(count>=2){
      if(pace&&relations.pace_s_per_km){const value=workoutRelation(relations.pace_s_per_km,deltas.pace_s_per_km,'pace',imperial);if(value)rows.push(['Pace',value]);}
      else if(speed&&relations.speed_mps){const value=workoutRelation(relations.speed_mps,deltas.speed_mps,'speed',imperial);if(value)rows.push(['Speed',value]);}
      if(relations.avg_hr){const value=workoutRelation(relations.avg_hr,deltas.avg_hr,'hr',imperial);if(value)rows.push(['Heart rate',value]);}
      if(data.notable==='hillier'&&typeof deltas.ascent_m==='number'&&Number.isFinite(deltas.ascent_m)){
        const climb=Math.round(Math.abs(deltas.ascent_m)*(imperial?3.28084:1)),unit=imperial?'ft':'m';
        const description=deltas.ascent_m>0?`${climb.toLocaleString()} ${unit} more`:deltas.ascent_m<0?`${climb.toLocaleString()} ${unit} less`:'About the same';
        rows.push(['Climb',description]);
      }
    }
    const notable=({hillier:'Hillier than usual',hotter:'Hotter than usual',personal_record:'Personal record',longest_90d:`Longest ${sport[0]} in 90 days`})[data.notable]||null;
    return `<section class="kit-workout-comparison" aria-label="Workout comparison">${summary?`<p class="kit-workout-summary">${esc(summary)}</p>`:''}<p class="kit-workout-baseline">vs your last ${count} ${sport[count===1?0:1]} of similar distance</p>${count<2?'<p class="kit-workout-empty">Not enough similar runs yet to compare.</p>':rows.length?`<dl class="kit-workout-rows">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}${notable?`<p class="kit-workout-notable">${esc(notable)}</p>`:''}</section>`;
  }
  function reviewLatestWorkout(c){return send(c,'Review my latest workout',0);}
  function chartHtml(chart){
    const points=chart.points||[],known=points.filter(p=>p.plot_value!=null&&p.n>p.missing),
      nouns={all:'Workouts',run:'Runs',ride:'Rides',walk:'Walks',hike:'Hikes',swim:'Swims',strength:'Strength workouts'},
      noun=nouns[chart.sport]||'Workouts',metric={distance:'distance',time:'time',pace:'pace',ascent:'climb',avg_hr:'heart rate',calories:'calories',workouts:'workouts'}[chart.metric]||'measurement',
      title=`${{sum:'Total',average:'Average',max:chart.metric==='pace'?'Fastest':'Highest'}[chart.aggregate]} ${metric}${chart.aggregate==='average'&&!['pace','avg_hr'].includes(chart.metric)?' per '+({run:'run',ride:'ride',walk:'walk',hike:'hike',swim:'swim'}[chart.sport]||'workout'):''} · ${{day:'daily',week:'weekly',month:'monthly',workout:'per workout'}[chart.group_by]}`,
      date=value=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',timeZone:chart.timezone}).format(new Date(value.length===10?value+'T12:00:00Z':value)),
      notes=[chart.missing?`${chart.missing} ${chart.missing===1?({all:'workout',run:'run',ride:'ride',walk:'walk',hike:'hike',swim:'swim',strength:'strength workout'}[chart.sport]||'workout'):noun.toLowerCase()} without ${metric} ${chart.missing===1?'isn’t':'aren’t'} counted.`:'',chart.truncated?`Latest ${points.length} ${noun.toLowerCase()}.`:''].filter(Boolean).map(t=>`<p class="kit-chart-note">${esc(t)}</p>`).join('');
    if(!chart.workouts)return `<section class="kit-chart"><p>No ${esc(noun.toLowerCase())} in the last ${esc(String(chart.period_count))} ${esc(chart.period_unit)}.</p></section>`;
    const header=`<h3>${esc(title)}</h3><p class="kit-chart-subtitle">${esc(noun)} · ${esc(date(chart.start))} – ${esc(date(chart.end))}</p>`;
    if(known.length<2)return `<section class="kit-chart">${header}${known.length?`<dl class="kit-facts"><div><dt>${esc(date(known[0].start))}</dt><dd>${esc(known[0].display_value)}</dd></div></dl>`:''}${notes}</section>`;
    const values=known.map(p=>p.plot_value),line=chart.group_by==='workout'||['pace','avg_hr'].includes(chart.metric),
      max=Math.max(...values,1),min=line?Math.min(...values)*.9:0,range=Math.max(max-min,1),
      x=i=>18+i*284/Math.max(points.length-1,1),y=v=>chart.metric==='pace'?20+(v-min)*110/range:130-(v-min)*110/range,
      step=points.length>12?4:points.length>6?2:1;
    let connected=false,path='';
    const marks=points.map((p,i)=>{
      if(p.plot_value==null){connected=false;return '';}
      const px=x(i),py=y(p.plot_value);path+=(connected?' L':' M')+px+','+py;connected=true;
      const label=`${date(p.start)}, ${p.display_value}, ${p.n} ${noun.toLowerCase()}${p.in_progress?', so far':''}`;
      return line?`<circle data-point="${i}" cx="${px}" cy="${py}" r="3"><title>${esc(label)}</title></circle>`:
        `<rect data-point="${i}" x="${px-Math.min(20,100/points.length)/2}" y="${py}" width="${Math.min(20,100/points.length)}" height="${Math.max(1,130-py)}" rx="2"><title>${esc(label)}</title></rect>`;
    }).join('');
    return `<section class="kit-chart" data-kit-chart>${header}<div class="kit-chart-selection" aria-live="polite"><span></span></div><div class="kit-chart-plot" role="slider" tabindex="0" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="${points.length-1}" aria-valuenow="${points.length-1}"><span class="kit-chart-unit">${esc(chart.axis_unit)}</span><svg viewBox="0 0 320 158" aria-hidden="true">${[20,75,130].map(y=>`<line class="kit-chart-grid" x1="10" x2="310" y1="${y}" y2="${y}"/>`).join('')}${line?`<path class="kit-chart-line" d="${path}"/>`:''}${marks}${points.map((p,i)=>i%step===0||i===points.length-1?`<text x="${x(i)}" y="153" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(date(p.start))}</text>`:'').join('')}</svg></div>${notes}</section>`;
  }
  function bindChart(host,chart){
    const plot=$('.kit-chart-plot',host);if(!plot)return;
    let index=chart.points.findLastIndex(p=>p.plot_value!=null);
    const select=i=>{
      index=Math.max(0,Math.min(chart.points.length-1,i));const p=chart.points[index],date=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',timeZone:chart.timezone}).format(new Date(p.start.length===10?p.start+'T12:00:00Z':p.start)),text=`${date} · ${p.display_value}${p.in_progress?' so far':''}`;
      const value=$('.kit-chart-selection span',host),percent=(18+index*284/Math.max(chart.points.length-1,1))/3.2;value.textContent=text;value.style.left=percent+'%';value.style.transform=`translateX(-${percent}%)`; plot.setAttribute('aria-valuenow',String(index));plot.setAttribute('aria-valuetext',`${text}, ${p.n} recorded workouts`);
      $$('[data-point]',host).forEach(el=>el.classList.toggle('selected',Number(el.dataset.point)===index));
    };
    const pointer=e=>{const r=plot.getBoundingClientRect();select(Math.round(((e.clientX-r.left)/r.width*320-18)/284*(chart.points.length-1)));};
    plot.onpointerdown=e=>{plot.setPointerCapture(e.pointerId);pointer(e);};plot.onpointermove=e=>{if(plot.hasPointerCapture(e.pointerId))pointer(e);};
    plot.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?chart.points.length-1:index+(e.key==='ArrowLeft'?-1:1));}};
    select(index);
  }
  function draw(c){
    if(!active(c))return;
    const list=$('#kit-messages',c.el),foodHost=c.foodHost;
    if(foodHost?.isConnected)foodHost.remove();
    const pending=c.job&&!c.messages.some(m=>String(m.client_id)===c.job.client_id);
    const messages=[...c.messages,...(c.localMessages||[])],has=messages.length||pending||c.foodStarted;
    const busy=c.sending||pending||messages.some(m=>['pending','running'].includes(m.state));
    const waitingMessage=pending?c.job:messages.findLast(m=>['pending','running'].includes(m.state)),
      waitingTarget=waitingMessage&&!c.jobError&&!c.answerErrors?.[waitingMessage.client_id]?{id:String(waitingMessage.client_id),question:waitingMessage.question}:null;
    const waitingHtml=waitBubble(c,waitingTarget);
    list.innerHTML=messages.map((m,index)=>{
      const a=m.answer,blocks=answerBlocks(a),workoutMode=!!a?.workout_review,verdict=a?.workout_review?.verdict||a?.verdict,reason=a?.workout_review?.next_step||a?.reason,copy=answerCopy(a),rawFacts=a?.chart?[]:a?.facts||[],detailRows=trainingDetails(rawFacts),
        comparison=a?.workout_comparison?workoutComparisonHtml(a.workout_comparison):'',
        facts=workoutMode?[]:rawFacts.filter(f=>!['id','source_id','route_id','candidate_id','unlogged_days','food_unlogged_days','fitness','fatigue','form','activities_without_effort'].includes(f.path?.at(-1))&&!isBareEffort(f)&&!copyIncludesValue(copy,factValue(f))).slice(0,3),
        followups=index===messages.length-1&&!busy&&Array.isArray(a?.follow_ups)?a.follow_ups.map(rewriteFollowup).filter(Boolean).filter(q=>workoutMode||isFirstPersonFollowup(q)).slice(0,2):[],
        failed=m.state==='failed'||c.answerErrors?.[m.client_id];
      const retry=kitChatOn()&&c.ready?'<button type="button" class="primary kit-error-retry" data-kit-retry>Retry</button>':'';
      return `<article data-kit-id="${esc(String(m.client_id))}"><div class="thread-user"><p>${esc(m.question)}</p></div>${a?`<div class="thread-card kit-answer">${a.chart?chartHtml(a.chart):''}${a.chart?.workouts===0?'':blocks?answerBlocksHtml(blocks):verdict?`<p class="kit-verdict">${esc(verdict)}</p>`:a.interpretation?`<p>${esc(a.interpretation)}</p>`:''}${workoutMode?comparison:''}${!blocks&&reason?`<p class="kit-reason">${esc(reason)}</p>`:''}${!workoutMode?comparison:''}${a.weekly_review?`<div class="kit-weekly-review"><p class="kit-weekly-period">${esc(a.weekly_period?.label||'')}</p><section><h3>What went well</h3><p>${esc(a.weekly_review.what_went_well)}</p></section><section><h3>What to change</h3><p>${esc(a.weekly_review.what_to_change)}</p></section><section><h3>Next week’s focus</h3><p>${esc(a.weekly_review.next_week_focus)}</p></section></div>`:''}${detailRows.length?`<dl class="kit-training-details">${detailRows.map(row=>`<div class="kit-training-row"><dt>${row.label}</dt><dd><strong>${esc(row.verdict)}</strong><small>${esc(row.detail)}</small></dd></div>`).join('')}</dl>`:''}${facts.length?`<dl class="kit-facts">${facts.map(f=>{const source=factSource(f);return `<div><dt>${esc(factLabel(f))}${source?`<small class="kit-fact-source">${esc(source)}</small>`:''}</dt><dd>${esc(factValue(f))}</dd></div>`;}).join('')}</dl>`:''}${a.selection?'<button type="button" class="ghost wide" data-kit-review>Review proposed change</button>':''}${!a.follow_ups?.length&&a.actions?.some(x=>Object.hasOwn(actions,x))?`<div class="kit-starters kit-answer-followups" aria-label="Next steps">${a.actions.filter(x=>Object.hasOwn(actions,x)).slice(0,3).map(x=>`<a class="kit-action" href="${x==='activities'?profileHref(App.me):actions[x][1]}"><span>${actions[x][0]}</span></a>`).join('')}</div>`:''}</div>${followups.length?`<div class="kit-suggested-replies" aria-label="Suggested replies">${followups.map(q=>`<button type="button" class="kit-suggested-reply" data-kit-followup aria-label="Send: ${esc(q)}"><span>${esc(q)}</span>${svg('send')}</button>`).join('')}</div>`:''}`:failed?errorBubble("Kit couldn't check that answer. Try a simpler question or Retry.",retry):waitingTarget?.id===String(m.client_id)?waitingHtml:''}</article>`;
    }).join('')+(pending?`<article><div class="thread-user"><p>${esc(c.job.question)}</p></div>${c.jobError?errorBubble("Your question couldn't be sent. Try again.",kitChatOn()&&c.ready?'<button type="button" class="primary kit-error-retry" id="kit-retry-send">Retry</button>':''):waitingHtml}</article>`:'')+(c.foodStarted?'<div id="kit-food-slot"></div>':'');
    if(foodHost&&c.foodStarted)$('#kit-food-slot',list)?.append(foodHost);
    $$('[data-kit-chart]',list).forEach(host=>{const message=messages.find(m=>String(m.client_id)===host.closest('[data-kit-id]').dataset.kitId);bindChart(host,message.answer.chart);});
    pruneLongSuggestions(list);
    $('#kit-starters',c.el).hidden=!!has;
    $('#kit-intro',c.el).hidden=!!has;
    $('#kit-fine',c.el).hidden=!!has;
    $('#kit-older',c.el).hidden=!c.before;
    $$('[data-kit-retry]',list).forEach(b=>b.onclick=()=>answer(c,b.closest('[data-kit-id]').dataset.kitId));
    $$('[data-kit-workout-retry]',list).forEach(b=>b.onclick=()=>reviewLatestWorkout(c));
    $$('[data-kit-followup]',list).forEach(b=>b.onclick=()=>send(c,b.querySelector('span')?.textContent.trim()||''));
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
    field.value='';field.style.height='';store.del(chatKey(c,'draft'));return true;
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
  async function refresh(c,before=null,recovering=false){
    if(!before&&Date.now()-c.visit_created_at>=VISIT_MAX_AGE){await begin(c,true);return;}
    const visit=c.visit_id,thread=c.conversation_id,generation=c.generation;let data;
    try{data=await api(c.historyEnabled?'/api/coach/conversation/threads/'+encodeURIComponent(thread)+(before?'?before='+encodeURIComponent(before):''):'/api/coach/conversation?visit_id='+encodeURIComponent(visit)+(before?'&before='+before:''));}
    catch(e){if(!active(c)||c.visit_id!==visit||c.conversation_id!==thread||c.generation!==generation)return;if(!before&&!recovering&&(e.status===409||c.historyEnabled&&e.status===404)){await beginThreadOrVisit(c,e.status===404);return;}throw e;}
    if(!active(c)||c.visit_id!==visit||c.conversation_id!==thread||c.generation!==generation)return;
    if(c.generation&&c.generation!==data.generation){if(c.job&&!$('#kit-text',c.el).value){$('#kit-text',c.el).value=c.job.question;try{save(c,'draft',c.job.question);}catch{}}c.messages=[];c.job=null;c.sending=false;c.answerErrors={};store.del(chatKey(c,'pending'));status(c,'This chat was cleared on another device. Your draft is kept.');}
    c.generation=data.generation;c.ready=data.ready;c.streamSupported=data.stream_supported===true;c.before=data.before;c.loaded=true;
    const rows=before?[...data.messages,...c.messages]:data.messages;
    c.messages=[...new Map(rows.map(m=>[m.client_id,m])).values()].sort((a,b)=>a.id-b.id);
    if(c.job&&c.job.generation!==c.generation){c.job=null;store.del(chatKey(c,'pending'));}
    const accepted=c.job&&c.messages.find(m=>m.client_id===c.job.client_id&&m.question===c.job.question);
    if(accepted){
      const field=$('#kit-text',c.el);if(field.value.trim()===c.job.question){field.value='';field.style.height='';store.del(chatKey(c,'draft'));}
      c.job=null;store.del(chatKey(c,'pending'));
    }

    if(!c.ready)status(c,'Kit chat isn’t available yet. Your food log and other app tools still work.');
    else if(!kitChatOn())status(c,App.me?.ai_ok?'Kit is unavailable. Your saved answers and draft are kept.':'Kit is off. Turn it on in Settings to chat.');
    const waiting=c.messages.find(m=>m.state==='pending');
    if(c.historyEnabled&&waiting&&!c.sending)c.answerErrors[waiting.client_id]=true;
    draw(c);
    if(!c.historyEnabled&&c.ready&&kitChatOn()&&waiting&&!c.sending&&!c.answerErrors?.[waiting.client_id])answer(c,waiting.client_id);
    else if(c.messages.some(m=>m.state==='running'))later(c);
  }
  const later=c=>{clearTimeout(c.timer);c.timer=setTimeout(()=>{if(active(c))refresh(c).catch(e=>status(c,e.message));},2500);};
  async function streamAnswer(c,id,body,valid){
    const controller=new AbortController();c.streamController=controller;
    const timeout=setTimeout(()=>controller.abort(),305000);
    let reader;
    try{
      const response=await fetch(Native.base+'/api/coach/conversation/messages/'+id+'/stream',{
        ...json('POST',body),credentials:Native.on?'omit':'same-origin',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-Kinetta-Account':String(App.me.id),...Native.headers()}});
      if(!valid())return {cancelled:true};
      if([404,405].includes(response.status))return null; // Older server: ordinary answer route owns generation.
      if(!response.ok||!response.body||!response.headers.get('Content-Type')?.startsWith('text/event-stream'))throw Error('stream_failed');
      reader=response.body.getReader();const decoder=new TextDecoder(),blocks=[];let pending='',complete=null;
      while(!complete){
        const {done,value}=await reader.read();if(done)break;
        if(!valid())return {cancelled:true};
        pending+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
        if(pending.length>131072)throw Error('stream_failed');
        let end;
        while((end=pending.indexOf('\n\n'))>=0){
          const frame=pending.slice(0,end);pending=pending.slice(end+2);
          const event=frame.split('\n').find(line=>line.startsWith('event: '))?.slice(7);
          if(!event)continue;
          const data=JSON.parse(frame.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n'));
          if(event==='error'){
            const rejected=data.restore_draft===true&&((data.code==='rate_limited'&&data.status===429)||(data.code==='unavailable'&&data.status===503));
            const error=Error(rejected?(data.status===429?'Kit has reached its limit. Your question is kept; try again later.':'Kit is unavailable right now. Your question is kept. Try again later.'):'Your question is kept. Try again.');
            if(rejected){error.status=data.status;error.restoreDraft=true;}throw error;
          }
          if(event==='block'){
            if(!Number.isInteger(data.index)||data.index!==blocks.length||!answerBlocks({answer_blocks:[data.block]}))throw Error('stream_failed');
            blocks.push(data.block);if(blocks.length>10)throw Error('stream_failed');
            // Transient display only: follow-ups/actions arrive in the authoritative complete envelope.
            c.messages=c.messages.map(m=>String(m.client_id)===String(id)?{...m,answer:{answer_blocks:[...blocks],facts:[]}}:m);draw(c);
            await new Promise(resolve=>requestAnimationFrame(resolve));
          }else if(event==='complete'){
            if(String(data.message?.client_id)!==String(id)||data.message.state!=='answered')throw Error('stream_failed');
            complete=data.message;break;
          }else if(event!=='start')throw Error('stream_failed');
        }
      }
      if(!complete)throw Error('stream_failed');return complete;
    }finally{clearTimeout(timeout);await reader?.cancel().catch(()=>{});if(c.streamController===controller)c.streamController=null;}
  }
  async function answer(c,id){
    if(!active(c)||c.sending||!c.ready||!kitChatOn())return;c.answerErrors||={};delete c.answerErrors[id];c.sending=true;const generation=c.generation,visit_id=c.visit_id,valid=()=>active(c)&&c.generation===generation&&c.visit_id===visit_id;controls(c);clearTimeout(c.timer);
    const pendingQuestion=c.messages.find(m=>String(m.client_id)===String(id)&&m.state==='pending')?.question;
    try{
      const row=(c.streamSupported?await streamAnswer(c,id,{generation,visit_id},valid):null)??await api('/api/coach/conversation/messages/'+id+'/answer',json('POST',{generation,visit_id}));if(!valid())return;
      if(row.cancelled){await refresh(c);return;}
      c.messages=c.messages.map(m=>String(m.client_id)===String(id)?row:m);draw(c);
      if(row.state==='running')later(c);else await refresh(c).catch(()=>status(c,'Your answer is saved. Return when online to refresh the full history.'));
    }catch(error){if(valid()){
      c.messages=c.messages.map(m=>String(m.client_id)===String(id)?{...m,answer:null}:m);
      // A pre-provider rejection can delete an accepted turn (and its empty thread).
      // Carry its question through refresh/new-thread recovery, never over a newer draft.
      const question=pendingQuestion,field=$('#kit-text',c.el);
      const restored=c.historyEnabled&&question&&!field.value.trim();
      if(restored){field.value=question;try{save(c,'draft',question);}catch{}field.dispatchEvent(new Event('input'));}
      c.answerErrors[id]=true;let refreshed=false;try{await refresh(c);refreshed=true;}catch{}
      if(valid()){
        if(restored&&refreshed&&c.messages.some(m=>String(m.client_id)===String(id))&&field.value===question){field.value='';store.del(chatKey(c,'draft'));field.dispatchEvent(new Event('input'));}
        status(c,error.message||'Your question is kept. Try again.');draw(c);
      }
    }}
    finally{if(valid())c.sending=false;if(valid()){controls(c);if(c.messages.some(m=>m.state==='running'))later(c);}}
  }
  async function deliver(c){
    if(!active(c)||c.sending||!c.job||!c.ready||!kitChatOn())return;c.sending=true;const generation=c.generation,visit_id=c.visit_id,valid=()=>active(c)&&c.generation===generation&&c.visit_id===visit_id;c.jobError='';clearWait(c);draw(c);
    try{
      const m=await api('/api/coach/conversation/messages',json('POST',c.job));if(!valid())return;
      c.messages=[...c.messages.filter(x=>x.client_id!==m.client_id),m].sort((a,b)=>a.id-b.id);
      const field=$('#kit-text',c.el);if(field.value.trim()===c.job.question){field.value='';field.style.height='';store.del(chatKey(c,'draft'));}
      c.job=null;store.del(chatKey(c,'pending'));c.view.pin(true);draw(c);
      c.sending=false;await answer(c,m.client_id);
    }catch(e){if(valid()){c.jobError=true;if(e.status===409)await beginThreadOrVisit(c).catch(()=>{});draw(c);}}
    finally{if(valid())c.sending=false;if(valid())controls(c);}
  }
  function sendStarter(c,button){
    const index=Number(button.dataset.kitStart),label=button.querySelector('span')?.textContent||'';
    if(c.context.screen==='activity'&&!c.context.activity_id&&index===0&&label==='Review my latest workout')return reviewLatestWorkout(c);
    return send(c,label,index);
  }
  async function send(c,text,starterIndex=null){
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
    const context={...c.context};delete context.starter_index;if(Number.isInteger(starterIndex)&&starterIndex>=0&&starterIndex<starters[c.context.screen].length)context.starter_index=starterIndex;
    const job={client_id:newId(),generation:c.generation,visit_id:c.visit_id,question,context};
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
  const THREADS='/api/coach/conversation/threads';
  async function threadList(c,before=null){
    const visit=c.visit_id,generation=c.generation,data=await api(THREADS+(before?'?before='+encodeURIComponent(before):''));
    if(active(c)&&c.visit_id===visit&&c.generation===generation&&data.enabled)c.historyGeneration=data.generation;
    return data;
  }
  async function beginThreadOrVisit(c,missing=false){
    return c.historyEnabled?beginThread(c,missing?null:c.conversation_id,$('#kit-text',c.el).value):begin(c,true);
  }
  async function beginThread(c,id=null,carryDraft=null){
    if(!active(c))return;keepDraft(c);clearTimeout(c.timer);c.streamController?.abort();clearWait(c);cancelVisitExpiry(c.owner);
    const request=c.historyRequest=(c.historyRequest||0)+1,field=$('#kit-text',c.el),bootDraft=!c.historyOpened?field.value:'',thread=id||newId(),visit=newId();
    c.historyOpened=true;c.conversation_id=thread;c.visit_id=visit;c.closed=false;c.loaded=false;c.ready=false;
    c.messages=[];c.localMessages=[];c.job=null;c.sending=false;c.before=null;c.answerErrors={};c.jobError='';
    if(c.foodHost){viewResources.get(c.foodHost)?.();viewResources.delete(c.foodHost);c.foodHost.remove();c.foodHost=null;}c.foodStarted=false;
    field.value=store.get(chatKey(c,'draft'))||carryDraft||bootDraft||store.get(chatKey(c,'pending'))?.question||'';
    field.style.height='';save(c,'draft',field.value);store.del(chatKey(c,'pending'));save(c,'conversation',thread);
    const valid=()=>active(c)&&c.historyRequest===request&&c.visit_id===visit&&c.conversation_id===thread;
    draw(c);status(c,'Opening your chat…');
    const start=async(retry=true)=>{
      try{
        const data=await api(id?THREADS+'/'+encodeURIComponent(thread)+'/resume':THREADS,json('POST',{...(id?{}:{conversation_id:thread}),visit_id:visit,generation:c.historyGeneration}));
        if(!valid())return;
        c.generation=data.generation;c.historyGeneration=data.generation;c.visit_id=data.visit_id;c.visit_created_at=Date.now();
        writeVisit(c.owner,{visit_id:c.visit_id,created_at:c.visit_created_at,left_at:null});
        c.messages=data.messages;c.before=data.before;c.ready=data.ready;c.streamSupported=data.stream_supported===true;c.loaded=true;
        for(const row of c.messages)if(row.state==='pending')c.answerErrors[row.client_id]=true;
        store.del(key(c.owner,'draft'));status(c,'');draw(c);field.dispatchEvent(new Event('input'));c.view?.pin(true);
        if(c.messages.some(row=>row.state==='running'))later(c);
      }catch(e){
        if(!valid())return;
        if(retry&&e.status===409){await threadList(c);if(valid())return start(false);return;}
        if(id&&e.status===404){await threadList(c);if(valid())return beginThread(c,null,field.value);return;}
        throw e;
      }
    };
    try{await start();}catch(e){if(valid()){status(c,e.message);const retry=$('#kit-load-retry',c.el);retry.hidden=false;retry.onclick=()=>beginThread(c,id,field.value);}}
  }
  function threadHistory(c){
    if(!active(c))return;
    sheet('Chats','<div id="kit-chats"><p class="muted">Loading chats…</p></div>',(body,close)=>{
      const box=$('#kit-chats',body),sh=body.closest('.sheet'),valid=()=>active(c)&&body.isConnected;
      let rows=[],before=null,sequence=0,loading=false,swipe=null,suppressTap=false;
      sh.classList.add('kit-history-sheet');
      const menu=document.createElement('button');menu.className='icon-btn kit-history-menu';menu.type='button';
      menu.setAttribute('aria-label','Chat history options');menu.innerHTML=svg('more');$('header',sh).prepend(menu);
      menu.onclick=()=>sheet('Chat history options',`<button class="linkbtn wide kit-history-action" id="kit-earlier-reviews">Earlier Kit reviews</button>${rows.length?'<button class="linkbtn wide danger kit-history-action" id="kit-delete-all">Delete all chats</button>':''}`,(b,done)=>{
        $('#kit-earlier-reviews',b).onclick=()=>{done();close();savedReviews();};
        const all=$('#kit-delete-all',b);if(all)all.onclick=()=>{done();void remove(null);};
      });
      const reveal=(row,on)=>{row.classList.toggle('is-revealed',on);const button=$('[data-kit-delete]',row);button.inert=!on;button.setAttribute('aria-hidden',String(!on));};
      const render=()=>{
        const top=box.scrollTop;sh.classList.toggle('kit-history-tall',!!before||rows.length>=8);
        box.innerHTML=`<button class="linkbtn kit-history-action" id="kit-new-chat">${svg('plus')}<span>New chat</span></button><div class="kit-history-list">${rows.map(row=>`<div class="kit-history-row"><button class="kit-history-delete" data-kit-delete="${esc(row.conversation_id)}" aria-label="Delete" aria-hidden="true" inert>${svg('trash')}</button><div class="kit-history-front"><button class="kit-history-open" data-kit-chat="${esc(row.conversation_id)}" ${row.conversation_id===c.conversation_id?'aria-current="true"':''}><span><strong>${esc(row.title||'New chat')}</strong><small>${esc(Number.isFinite(Date.parse(row.updated))?new Date(row.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'')}</small></span>${row.conversation_id===c.conversation_id?svg('check'):''}</button><button class="icon-btn kit-history-options" data-kit-options="${esc(row.conversation_id)}" aria-label="Chat options: ${esc(row.title||'New chat')}">${svg('more')}</button></div></div>`).join('')}</div>${!rows.length?'<p>No saved chats yet.</p>':''}<p class="err" id="kit-history-error" role="alert"></p><button class="linkbtn kit-history-action" id="kit-history-retry" hidden>Try again</button>`;
        box.scrollTop=top;
        $('#kit-new-chat',box).onclick=()=>{close();void beginThread(c);};
        $$('[data-kit-chat]',box).forEach(b=>b.onclick=()=>{if(suppressTap)return;if(b.closest('.is-revealed')){reveal(b.closest('.kit-history-row'),false);return;}close();void beginThread(c,b.dataset.kitChat);});
        $$('[data-kit-delete]',box).forEach(b=>b.onclick=()=>remove(b.dataset.kitDelete));
        $$('[data-kit-options]',box).forEach(b=>b.onclick=()=>sheet('Chat options','<button class="linkbtn danger kit-history-action" id="kit-row-delete">Delete chat</button>',(bdy,done)=>{$('#kit-row-delete',bdy).onclick=()=>{done();void remove(b.dataset.kitOptions);};}));
      };
      // Horizontal touch is a shortcut; every row also has a keyboard-accessible menu.
      box.addEventListener('touchstart',e=>{e.stopPropagation();const row=e.target.closest('.kit-history-row');swipe=e.touches.length===1&&row?{row,x:e.touches[0].clientX,y:e.touches[0].clientY,horizontal:false}:null;},{passive:true});
      box.addEventListener('touchmove',e=>{e.stopPropagation();if(!swipe)return;const dx=e.touches[0].clientX-swipe.x,dy=e.touches[0].clientY-swipe.y;if(!swipe.horizontal&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){swipe=null;return;}if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){swipe.horizontal=true;e.preventDefault();e.stopPropagation();$$('.is-revealed',box).forEach(row=>reveal(row,false));reveal(swipe.row,dx<0);}},{passive:false});
      box.addEventListener('touchend',e=>{e.stopPropagation();if(swipe?.horizontal){e.preventDefault();e.stopPropagation();suppressTap=true;setTimeout(()=>suppressTap=false,250);}swipe=null;},{passive:false});
      box.addEventListener('touchcancel',()=>{swipe=null;});
      box.addEventListener('scroll',()=>{if(before&&!loading&&box.scrollHeight-box.scrollTop-box.clientHeight<80)void load(true);},{passive:true});
      const load=async(append=false)=>{
        const request=++sequence;loading=true;
        try{const data=await threadList(c,append?before:null);if(!valid()||request!==sequence)return;
          if(!data.enabled){box.innerHTML='<p>Chat history is unavailable. Your saved chats are kept.</p>';return;}
          rows=[...new Map((append?[...rows,...data.conversations]:data.conversations).map(row=>[row.conversation_id,row])).values()];before=data.before;render();
        }catch(e){if(valid()){if(!$('#kit-history-error',box))box.innerHTML='<p class="err" id="kit-history-error" role="alert"></p><button class="linkbtn kit-history-action" id="kit-history-retry">Try again</button>';$('#kit-history-error',box).textContent=e.message;const retry=$('#kit-history-retry',box);if(retry){retry.hidden=false;retry.onclick=()=>load(append);}}}
        finally{if(request===sequence)loading=false;}
      };
      const remove=async id=>{
        if(!valid()||!await confirmSheet(id?'Delete this chat?':'Delete all Kit chats?',{body:"This can't be undone.",action:id?'Delete chat':'Delete all chats'})||!valid())return;
        $$('button',box).forEach(b=>b.disabled=true);
        try{
          const data=await api(THREADS+(id?'/'+encodeURIComponent(id):''),{method:'DELETE'});if(!valid())return;
          c.historyRequest=(c.historyRequest||0)+1;c.generation=data.generation;c.historyGeneration=data.generation;clearTimeout(c.timer);
          const draft=$('#kit-text',c.el).value,currentId=c.conversation_id;
          for(const k of Object.keys(localStorage))if((k.startsWith('fit.kit.draft:')||k.startsWith('fit.kit.pending:'))&&k.endsWith(':'+c.owner)&&(!id||k===key(c.owner,'draft:'+id)||k===key(c.owner,'pending:'+id)))localStorage.removeItem(k);
          if(!id||id===currentId){c.conversation_id=null;c.job=null;}
          rows=id?rows.filter(row=>row.conversation_id!==id):[];before=null;render();
          await load();if(!valid())return;
          await beginThread(c,!id||id===currentId?null:currentId,draft);
        }catch(e){if(valid()){$('#kit-history-error',box).textContent=e.message;$$('button',box).forEach(b=>b.disabled=false);}}
      };
      void load();
    });
  }
  async function begin(c,forceFresh=false){
    if(c.historyEnabled==null){
      try{const data=await threadList(c);if(!active(c))return;
        if(data.enabled!==false&&!(data.enabled===true&&data.retention==='until_deleted'&&typeof data.generation==='string'))throw Error('Chat history could not load. Try again.');
        c.historyEnabled=data.enabled===true;c.initialThreads=data.conversations||[];
      }catch(e){if(!active(c))return;if(e.status===404||e.status===405)c.historyEnabled=false;else{status(c,e.message);const retry=$('#kit-load-retry',c.el);retry.hidden=false;retry.onclick=()=>begin(c);return;}}
    }
    if(c.historyEnabled){const button=$('#kit-saved',c.el);button.setAttribute('aria-label','Chats');button.title='Chats';return beginThread(c,c.conversation_id||store.get(key(c.owner,'conversation'))||c.initialThreads?.[0]?.conversation_id);}
    c.closed=false;c.loaded=false;c.messages=[];c.job=null;c.sending=false;c.before=null;c.answerErrors={};
    let record=forceFresh?null:readVisit(c.owner),now=Date.now();
    if(record&&now-record.created_at>=VISIT_MAX_AGE){cancelVisitExpiry(c.owner);store.del(c.owner,'visit');record=null;}
    if(record?.left_at&&now-record.left_at>=ROUTE_IDLE_LIMIT){cancelVisitExpiry(c.owner);await endVisit(c.owner,record);record=null;}
    if(!record){record={visit_id:newId(),created_at:now,left_at:null};writeVisit(c.owner,record);}
    else if(record.left_at){cancelVisitExpiry(c.owner);record={...record,left_at:null};writeVisit(c.owner,record);}
    c.visit_id=record.visit_id;c.visit_created_at=record.created_at;
    const visit=c.visit_id;draw(c);status(c,'Opening your chat…');
    const start=async()=>{
      const data=await api('/api/coach/conversation/visits',json('POST',{visit_id:visit}));
      if(!active(c)||c.visit_id!==visit)return;
      c.generation=data.generation;status(c,'');await refresh(c,null,true);
      if(active(c)&&c.visit_id===visit&&typeof FeatureUsage!=='undefined')void FeatureUsage.event('kit_conversation');
    };
    try{await start();}catch(e){
      if(active(c)&&c.visit_id===visit&&record.left_at==null&&e.status===409&&!forceFresh){
        store.del(c.owner,'visit');await begin(c,true);return;
      }
      if(active(c)&&c.visit_id===visit){status(c,e.message);const retry=$('#kit-load-retry',c.el);retry.hidden=false;retry.onclick=async()=>{retry.hidden=true;try{await start();}catch(x){if(active(c)){status(c,x.message);retry.hidden=false;}}};}
    }
  }
  function memorySettings(){
    const session=readOwner();
    sheet('What Kit remembers','<div id="kit-memory"><p class="muted">Loading memory…</p></div>',body=>{
      const box=$('#kit-memory',body),sh=body.closest('.sheet'),valid=()=>session===readOwner()&&body.isConnected;
      const title=$('h2',sh),labels={goal:'Goal',preference:'Preference',routine:'Routine'};
      const date=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
      let data=null,swipe=null,suppressTap=false;
      sh.classList.add('kit-history-sheet');
      const menu=document.createElement('button');menu.className='icon-btn kit-history-menu';menu.type='button';
      menu.setAttribute('aria-label','Memory options');menu.innerHTML=svg('more');$('header',sh).prepend(menu);
      const remove=async(id,button)=>{
        if(!valid())return;
        button.disabled=true;
        try{await api('/api/coach/conversation/memory'+(id?'/'+id:''),{method:'DELETE'});if(valid())await draw();}
        catch(error){if(valid()){$('#kit-memory-error',box).textContent=error.message;button.disabled=false;}}
      };
      menu.onclick=()=>{
        if(!valid())return;
        sheet('Memory options','<button type="button" class="linkbtn wide danger kit-history-action" id="kit-forget-all">Forget all memories</button>',(b,done)=>{
          $('#kit-forget-all',b).onclick=async event=>{
            if(!valid())return;
            const button=event.currentTarget;
            if(!await confirmSheet('Forget all memories?',{body:'Kit will stop remembering these details.',action:'Forget all'})||!valid())return;
            done();await remove(null,button);
          };
        });
      };
      const reveal=(row,on)=>{row.classList.toggle('is-revealed',on);const button=$('[data-kit-forget]',row);button.inert=!on;button.setAttribute('aria-hidden',String(!on));};
      // Keep list swipes out of the sheet's vertical-dismiss gesture; row taps also work with a keyboard.
      box.addEventListener('touchstart',e=>{e.stopPropagation();const row=e.target.closest('.kit-memory-row');swipe=e.touches.length===1&&row?{row,x:e.touches[0].clientX,y:e.touches[0].clientY,horizontal:false}:null;},{passive:true});
      box.addEventListener('touchmove',e=>{e.stopPropagation();if(!swipe)return;const dx=e.touches[0].clientX-swipe.x,dy=e.touches[0].clientY-swipe.y;if(!swipe.horizontal&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){swipe=null;return;}if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){swipe.horizontal=true;e.preventDefault();$$('.is-revealed',box).forEach(row=>reveal(row,false));reveal(swipe.row,dx<0);}},{passive:false});
      box.addEventListener('touchend',e=>{e.stopPropagation();if(swipe?.horizontal){e.preventDefault();suppressTap=true;setTimeout(()=>suppressTap=false,250);}swipe=null;},{passive:false});
      box.addEventListener('touchcancel',()=>{swipe=null;});
      const edit=memory=>{
        if(!valid())return;
        const editable=Number.isSafeInteger(data.version)&&data.enabled;let kind=memory?.kind||'preference';
        title.textContent=memory?'Edit detail':'Add a detail';menu.hidden=true;
        box.innerHTML=`<form id="kit-memory-form"><div class="underline-tabs" role="group" aria-label="Type">${Object.entries(labels).map(([key,label])=>`<button type="button" data-kit-kind="${key}" aria-pressed="${kind===key}" ${editable?'':'disabled'}>${label}</button>`).join('')}</div><label class="vh" for="kit-memory-text">Detail</label><textarea id="kit-memory-text" rows="3" maxlength="400" required placeholder="I prefer morning runs." ${editable?'':'readonly'}>${esc(memory?.text||'')}</textarea><p class="err" id="kit-memory-error" role="alert"></p><div class="kit-memory-edit-actions"><button type="button" class="ghost" id="kit-memory-cancel">Cancel</button>${editable?'<button type="submit" class="primary" id="kit-memory-save">Save</button>':''}</div>${memory?'<button type="button" class="linkbtn wide danger kit-history-action" id="kit-memory-delete">Delete</button>':''}</form>`;
        $$('[data-kit-kind]',box).forEach(button=>button.onclick=()=>{
          if(!valid())return;kind=button.dataset.kitKind;$$('[data-kit-kind]',box).forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));
        });
        $('#kit-memory-cancel',box).onclick=()=>{if(valid())draw();};
        const del=$('#kit-memory-delete',box);if(del)del.onclick=()=>remove(memory.id,del);
        $('#kit-memory-form',box).onsubmit=async event=>{
          event.preventDefault();if(!valid()||!editable)return;
          const text=$('#kit-memory-text',box).value.trim();if(!text)return;
          const save=$('#kit-memory-save',box);save.disabled=true;
          try{
            await api('/api/coach/conversation/memory'+(memory?'/'+memory.id:''),json(memory?'PATCH':'POST',{text,kind,version:data.version}));
            if(valid())await draw();
          }catch(error){if(valid()){$('#kit-memory-error',box).textContent=error.message;save.disabled=false;}}
        };
      };
      const draw=async()=>{
        try{
          const next=await api('/api/coach/conversation/memory');if(!valid())return;data=next;
          title.textContent='What Kit remembers';menu.hidden=!data.memories.length;
          const editable=Number.isSafeInteger(data.version)&&data.enabled;
          box.innerHTML=`${editable&&data.memories.length<12?`<button type="button" class="linkbtn kit-history-action" id="kit-memory-add">${svg('plus')}<span>Add a detail</span></button>`:''}<label class="switch-row kit-memory-switch"><span>Remember useful details</span><input type="checkbox" role="switch" id="kit-memory-on" ${data.enabled?'checked':''}></label><div class="kit-memories">${data.memories.length?data.memories.map(m=>`<div class="kit-history-row kit-memory-row"><button type="button" class="kit-history-delete" data-kit-forget="${m.id}" aria-label="Delete" aria-hidden="true" inert>${svg('trash')}</button><div class="kit-history-front"><button type="button" class="kit-history-open" data-kit-edit="${m.id}"><span><strong>${esc(m.text)}</strong><small>${esc([labels[m.kind]||'Detail',date(m.updated)].filter(Boolean).join(' · '))}</small></span></button></div></div>`).join(''):'<p class="muted kit-memory-empty">No saved details yet.</p>'}</div><p class="err" id="kit-memory-error" role="alert"></p>`;
          const add=$('#kit-memory-add',box);if(add)add.onclick=()=>edit(null);
          $$('[data-kit-edit]',box).forEach(button=>button.onclick=()=>{
            if(!valid()||suppressTap)return;const row=button.closest('.kit-memory-row');if(row.classList.contains('is-revealed')){reveal(row,false);return;}
            edit(data.memories.find(m=>String(m.id)===button.dataset.kitEdit));
          });
          $$('[data-kit-forget]',box).forEach(button=>button.onclick=()=>remove(button.dataset.kitForget,button));
          $('#kit-memory-on',box).onchange=async e=>{
            if(!valid())return;
            const toggle=e.target,enabled=toggle.checked;
            if(!enabled&&(!await confirmSheet('Turn off Kit memory?',{body:'Kit will forget your saved details.',action:'Turn off'})||!valid())){toggle.checked=true;return;}
            toggle.disabled=true;
            try{await api('/api/coach/conversation/memory',json('PUT',{enabled}));if(valid())await draw();}
            catch(error){if(valid()){$('#kit-memory-error',box).textContent=error.message;toggle.checked=!enabled;toggle.disabled=false;}}
          };
        }catch(error){if(valid())box.innerHTML=`<p class="err">${esc(error.message)}</p><button class="ghost wide" id="kit-memory-retry">Try again</button>`;const retry=$('#kit-memory-retry',box);if(retry)retry.onclick=draw;}
      };draw();
    });
  }
  async function mount(el){
    if(globalThis.EmailConfirmation?.required()){
      current=null;const back=screens[context().screen];
      el.innerHTML=`<header class="thread-heading"><a class="back" href="${back[1]}" aria-label="Back">${svg('back')}</a><h1>Ask Kit</h1></header>${EmailConfirmation.markup()}`;
      EmailConfirmation.wire(el);return;
    }
    if(typeof FoodThread==='undefined')await loadClassicScript(THREAD_ROUTE_ASSET);
    const ctx=context(),back=screens[ctx.screen],c={el,context:ctx,owner:owner(),session:readOwner(),messages:[],localMessages:[],loaded:false,sending:false,awaitingFood:false,foodStarted:false};current=c;
    el.classList.add('food-thread','kit-chat');
    el.innerHTML=`<header class="thread-heading"><a class="back" href="${back[1]}" aria-label="Back">${svg('back')}</a><h1>Ask Kit</h1><div class="kit-chat-actions"><button type="button" class="icon-btn" id="kit-saved" aria-label="Earlier Kit reviews" title="Earlier Kit reviews">${svg('list')}</button><button type="button" class="icon-btn kit-settings" id="kit-settings" aria-label="Kit chat settings">${svg('more')}</button></div></header><p id="kit-status" role="status" aria-live="polite"></p><button class="linkbtn" id="kit-older" type="button" hidden>Earlier messages</button><div id="kit-messages" aria-live="off"></div><section id="kit-intro"><button class="ghost wide" id="kit-load-retry" hidden>Try loading again</button></section><form id="kit-composer" class="thread-composer"><div class="kit-starters chat-suggestions" id="kit-starters" role="group" aria-label="Suggestions">${starters[ctx.screen].map((label,i)=>`<button type="button" data-kit-start="${i}">${svg(starterIcons[ctx.screen][i])}<span>${esc(ctx.screen==='activity'&&i===0&&!ctx.activity_id?'Review my latest workout':label)}</span></button>`).join('')}</div><div class="thread-compose-row kit-compose-row"><label class="vh" for="kit-text">Message Kit</label><textarea id="kit-text" rows="1" maxlength="1500" enterkeyhint="send" placeholder="Message Kit…"></textarea><button class="primary thread-send" id="kit-send" aria-label="Send to Kit">${svg('send')}</button></div><p class="kit-fine" id="kit-fine">${esc(shortProvider())} · <button type="button" class="linkbtn" id="kit-footer-memory">Memory</button></p></form>`;
    const field=$('#kit-text',el),oldJob=store.get(key(c.owner,'pending'));
    field.value=store.get(key(c.owner,'draft'))||(entryDraft?.owner===c.owner?entryDraft.question:null)||oldJob?.question||new URLSearchParams(location.search).get('question')?.slice(0,1500)||'';el.classList.toggle('has-draft',!!field.value.trim());$('#kit-starters',el).inert=!!field.value.trim();
    entryDraft=null;store.del(chatKey(c,'pending'));
    const resize=()=>{field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';};
    field.oninput=()=>{const drafted=!!field.value.trim();el.classList.toggle('has-draft',drafted);$('#kit-starters',el).inert=drafted;try{save(c,'draft',field.value);}catch(e){status(c,'Your draft could not be saved on this phone.');}resize();controls(c);};
    field.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();send(c);}};
    $('#kit-composer',el).onsubmit=e=>{e.preventDefault();send(c);};
    $$('[data-kit-start]',el).forEach(b=>b.onclick=()=>sendStarter(c,b));
    $('#kit-footer-memory',el).onclick=memorySettings;
    $('#kit-older',el).onclick=async()=>{const list=$('#kit-messages',el),h=list.scrollHeight,y=list.scrollTop;try{await refresh(c,c.before);list.scrollTop=y+list.scrollHeight-h;}catch(e){status(c,e.message);}};
    $('#kit-saved',el).onclick=()=>c.historyEnabled?threadHistory(c):savedReviews();
    $('#kit-settings',el).onclick=()=>sheet('Kit chat',`<button type="button" class="linkbtn wide" id="kit-about-open">About Kit</button><button type="button" class="linkbtn wide" id="kit-memory-open">What Kit remembers</button><a class="linkbtn wide" href="/me/settings#ai" data-close>Kit & data permissions</a><button type="button" class="ghost wide" id="kit-clear">Start a new chat</button><p class="small muted">Your food, workouts, plans, goals and saved memories stay available.</p>`,(body,close)=>{
      $('#kit-about-open',body).onclick=()=>{close();sheet('About Kit',`<p>${c.historyEnabled?'Your chats stay until you delete them. Start a new one anytime.':'Your chat stays while you switch apps. Start a new one anytime.'}</p><p>Uses ${esc(providerName())}.</p><p>Kit checks your own records when needed and can keep useful details you share.</p>`);};
      $('#kit-memory-open',body).onclick=()=>{close();memorySettings();};
      $('#kit-clear',body).onclick=async e=>{
        if(!active(c)||!c.loaded)return;e.target.disabled=true;
        if(c.historyEnabled){close();await beginThread(c);return;}
        const previousVisit=c.visit_id;
        try{const data=await api('/api/coach/conversation/clear',json('POST',{generation:c.generation,visit_id:previousVisit,confirmed:true}));if(!active(c)||c.visit_id!==previousVisit)return;clearTimeout(c.timer);cancelVisitExpiry(c.owner);c.visit_id=data.visit_id;c.visit_created_at=Date.now();writeVisit(c.owner,{visit_id:c.visit_id,created_at:c.visit_created_at,left_at:null});c.generation=data.generation;c.sending=false;c.answerErrors={};c.messages=[];c.before=null;c.job=null;c.jobError='';store.del(chatKey(c,'pending'));store.del(chatKey(c,'draft'));field.value='';close();status(c,'');draw(c);}catch(x){if(active(c)){status(c,x.message);e.target.disabled=false;}}
      };
    });
    c.view=foodChatViewport({list:$('#kit-messages',el),composer:$('#kit-composer',el),field,send:$('#kit-send',el),suggestions:$('#kit-starters',el),header:$('.thread-heading',el),active:()=>active(c),resizeField:resize});
    const events=new AbortController();
    $('.thread-heading .back',el)?.addEventListener('click',()=>leaveRoute(c),{capture:true,signal:events.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend(c);else resume(c);},{signal:events.signal});
    window.addEventListener('pagehide',()=>suspend(c),{signal:events.signal});
    window.addEventListener('pageshow',()=>resume(c),{signal:events.signal});
    viewResources.set(el,()=>{leaveRoute(c);events.abort();c.view.dispose();});
    controls(c);resize();await begin(c);
    if(active(c))c.view.pin(true);
  }
  function eraseDevice(){const o=owner();entryDraft=null;if(current){clearTimeout(current.timer);current.view?.dispose();current=null;}if(o){cancelVisitExpiry(o);tabEntryUsers.delete(o);activityEntryUsers.delete(o);activityEntryRequests.delete(o);for(const k of ['draft','pending','visit','conversation'])localStorage.removeItem(key(o,k));for(const k of Object.keys(localStorage))if((k.startsWith('fit.kit.draft:')||k.startsWith('fit.kit.pending:'))&&k.endsWith(':'+o))localStorage.removeItem(k);for(const k of Object.keys(localStorage))if(k.startsWith('fit.kit.proposal:'+o+':'))localStorage.removeItem(k);}}
  function entry(el,path){
    const screen=/^\/track\/lift\/\d+$/.test(path)?'strength':{'/me':'me','/food':'nutrition','/food/insights':'nutrition','/activity':'activity','/progress':'progress','/track':'track','/plan':'plan'}[path];
    if(!el||!screen)return;
    if(path==='/activity'){
      const enabled=kitChatOn();
      if(!entryRelevant(path,enabled)){el.querySelector('[data-kit-entry]')?.remove();checkActivityEntry(el,path);return;}
      const heading=el.querySelector('#feed-top .shell-topbar-root');
      if(!heading)return;
      syncKitEntry(el,heading.querySelector('.shell-topbar-actions'),enabled?href('activity'):'/food?add=1',enabled?'Ask Kit':'Kit, Add food');
      return;
    }
    const heading=el.querySelector('.top,.me-top');if(!heading)return;
    if(heading.classList.contains('progress-no-kit-entry')){el.querySelector('[data-kit-entry]')?.remove();return;}
    const enabled=kitChatOn();
    if(!entryRelevant(path,enabled)){el.querySelector('[data-kit-entry]')?.remove();return checkActivityEntry(el,path);}
    const slot=heading.querySelector('.acts,.me-profile-tools')||heading;
    syncKitEntry(el,slot,enabled?href(screen):'/food?add=1',enabled?'Ask Kit':'Kit, Add food');
  }
  return {loaded:true,mount,href,open,entry,entryRelevant,eraseDevice,starters,actions,memorySettings,savedReviews,foodIntent,rewriteFollowup};
})());
route(/^\/me\/kit$/,()=>({nutrition:'food',activity:'activity',progress:'progress',track:'track',strength:'track'}[new URLSearchParams(location.search).get('from')]||'me'),el=>KitChat.mount(el));
function kitReview(selection, options = {}) {
  if(selection.kind==='goal'){
    const owner=readOwner();
    return loadClassicScript('/static/kit-goal-ui.js?v=__ASSET_HASH__')
      .then(()=>{if(owner===readOwner())kitGoalReview(selection,options);})
      .catch(e=>{if(owner===readOwner())toast(e.message);});
  }
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
