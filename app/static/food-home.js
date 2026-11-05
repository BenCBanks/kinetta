// Shared Food helpers required by Me/Today and other eager app areas.
// Keep this file before food.js until a later closed-leaf split proves a smaller eager boundary.
'use strict';

const r0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
const isoDay = (d, timeZone = tz()) => d.toLocaleDateString('en-CA', {timeZone});
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
const dayLabel = (iso, timeZone = tz()) => { const t = isoDay(new Date(),timeZone); return iso === t ? 'Today' : iso === addDays(t, -1) ? 'Yesterday' : iso === addDays(t, 1) ? 'Tomorrow' : new Date(iso + 'T12:00:00Z').toLocaleDateString([], {timeZone:'UTC',weekday: 'short', month: 'short', day: 'numeric', ...(iso.slice(0,4) !== t.slice(0,4) ? {year:'numeric'} : {})}); };
function guessMeal(timeZone = tz()) {   // the meal you usually log at this hour (learned from your log), else a sensible clock guess
  const h = Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',hourCycle:'h23'}).format(new Date())), mine = timeZone === tz() && App.mealHours && App.mealHours[h]; // learned hours use the profile zone; while travelling, use the local clock instead
  return mine || (h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snacks' : h < 21 ? 'dinner' : 'snacks');
}
// Displayed energy rounds to 5 kcal.
const homeCalories = v => Math.round((v || 0) / 5) * 5;
function syncCheckinPrimary(page){
  if(!page)return;const log=$('#tf-add',page);
  if(log){const pending=page.dataset.checkinPending==='true';log.classList.toggle('primary',!pending);log.classList.toggle('ghost',pending);}
  const primary=!!$('#nt-checkin .primary',page);
  if(primary)$$('#nt-body .primary',page).forEach(b=>{b.dataset.checkinQuiet='1';b.classList.replace('primary','ghost');});
  else $$('#nt-body [data-checkin-quiet]',page).forEach(b=>{delete b.dataset.checkinQuiet;b.classList.replace('ghost','primary');});
}
function checkinDetails(row,actions=false){
  const d=row.data,convert=kg=>imp()?kg*2.20462:kg,unit=imp()?'lb':'kg';
  const sgn=v=>v>0?'+':v<0?'−':'';
  const trend=Math.abs(convert(d.trend_kg_per_week))<.05?0:convert(d.trend_kg_per_week);
  const rate=d.trend_kg_per_week,requested=convert(d.requested_kg_per_week||0);
  const aim=requested>=.05&&['lose_weight','build_muscle'].includes(d.goal)?`For your goal of ${d.goal==='lose_weight'?'losing':'gaining'} about ${requested.toFixed(1)} ${unit} a week, `:'For your current goal, ';
  return `<section class="card checkin-card" data-checkin="${esc(row.id)}"><h2>Your weekly check-in</h2><p class="small muted">Week of ${esc(new Date(row.week+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}))} · last 28 completed days · as of ${esc(new Date(row.updated).toLocaleDateString([],{month:'short',day:'numeric',timeZone:tz()}))}</p>
    <dl class="checkin-numbers"><div><dt>Average calories logged</dt><dd><b>${r0(homeCalories(d.avg_intake))}</b><small>kcal / logged day</small></dd></div><div><dt>Weight trend</dt><dd><b>${sgn(trend)}${Math.abs(trend).toFixed(1)}</b><small>${unit} / week</small></dd></div><div><dt>Estimated daily calorie use</dt><dd><b>${r0(homeCalories(d.observed_burn))}</b><small>kcal / day · from food and weight</small></dd></div></dl>
    <p>${actions?esc(aim)+'try ':'Saved suggestion: '}<b>${r0(d.suggested_kcal)} kcal a day</b>.</p>${d.floor_applied?'<p class="small">This suggestion cannot go below the calories your body needs at rest, so your weight may change more slowly than you chose.</p>':''}
    <p class="small muted">${d.logged_days} complete food days · ${d.weigh_ins} weigh-ins over ${d.weigh_in_span_days} days. Another estimate from your body details is about ${r0(homeCalories(d.estimated_burn))} kcal / day.${d.unknown_calorie_days?' Days with unknown calories are left out.':''}</p>
    ${actions?'<div class="checkin-actions"><button type="button" class="primary" data-checkin-accept>Accept</button><button type="button" class="ghost" data-checkin-later>Not now</button></div>':`<p class="small">${row.state==='accepted'?'Accepted · calorie target updated at that time.':row.state==='deferred'?'Hidden on Me until next week.':'Previous suggestion · not applied.'}</p>`}
    <button type="button" class="linkbtn" data-checkin-help>How this works</button><p class="err" role="status" data-checkin-status></p></section>`;
}
async function weeklyCheckinCard(box,{home=false,onReady}={}){
  if(!box?.isConnected)return;const owner=readOwner(),valid=()=>box.isConnected&&owner===readOwner();
  if(!home)box.innerHTML=skel(1);
  const draw=data=>{
    if(!valid())return;try { const row=data.current,pending=row?.state==='pending';
    const page=box.closest('#page');if(home&&page){page.dataset.checkinPending=String(!!pending);syncCheckinPrimary(page);}
    if(home&&!pending){box.innerHTML='';return;}
    if(row)box.innerHTML=checkinDetails(row,pending);
    else{const r=data.readiness||{},action=r.action||'food';box.innerHTML=`<section class="card checkin-card"><h2>Your weekly check-in</h2><p>${esc(r.reason||'Not enough data yet.')}</p>${action==='weight'?'<button class="primary wide" type="button" data-checkin-weight>Log weight</button>':`<a class="primary wide" href="${action==='goal'?'/food/setup':'/food/describe'}">${action==='goal'?'Choose a goal':'Log food'}</a>`}</section>`;const weight=$('[data-checkin-weight]',box);if(weight)weight.onclick=()=>{if(valid())quickWeighIn();};}
    if(!home){const history=(data.history||[]).filter(r=>r.id!==row?.id&&r.week<data.week);if(history.length)box.insertAdjacentHTML('beforeend',`<details class="checkin-history"><summary>Previous check-ins</summary>${history.map(r=>checkinDetails(r)).join('')}</details>`);}
    $$('[data-checkin-help]',box).forEach(b=>b.onclick=()=>{if(!valid())return;sheet('How your check-in works',`<div class="checkin-explanation"><p>We use the last 28 completed days. At least 7 complete food days and 3 weigh-ins spanning 10 days are needed. Very partial days and today are left out.</p><p>We compare the food you logged with how your weight changed to estimate the calories you use each day. This estimate includes your usual workouts, but it is not a direct measurement. We also show an estimate based on your body details.</p><p>Your goal and pace shape the calorie suggestion. It cannot go below the calories your body needs at rest. Water changes, missing food and scale variation can affect the result.</p><p>Accept changes only your calorie target. Your resting-calorie source and nutrient goals stay the same. Not now hides the card on Me until next week; you can still find this check-in in Progress.</p><p>No Kit or watch is needed. You can change your goal or target any time.</p></div>`);});
    syncCheckinPrimary(page);
    for(const [selector,action]of [['[data-checkin-accept]','accept'],['[data-checkin-later]','later']]){const button=$(selector,box);if(button)button.onclick=async()=>{
      if(!valid())return;$$('.checkin-actions button',box).forEach(b=>b.disabled=true);const status=$('[data-checkin-status]',box);status.textContent=action==='accept'?'Updating your calorie target…':'Saving your choice…';
      try{const result=await api(`/api/food/check-in/${row.id}/${action}`,json('POST',action==='accept'?{baseline:row.baseline,confirmed:true}:{}));if(!valid())return;
        invalidate('/api/food');if(result.kcal_target!=null)refreshMe({...App.me,kcal_target:result.kcal_target});toast(result.already_decided?(result.current?.state==='accepted'?'You already accepted this check-in; your target is unchanged.':'You already chose to hide this check-in until next week.'):result.current?.state==='accepted'?'Calorie target saved.':'Check-in hidden until next week.');render();
      }catch(e){if(!valid())return;if(e.status===409){invalidate('/api/food/check-in');await weeklyCheckinCard(box,{home});toast(e.message);}else{status.textContent=e.message;$$('.checkin-actions button',box).forEach(b=>b.disabled=false);}}
    };}
    } finally { onReady?.(); }
  };
  try{await load('/api/food/check-in',draw,{maxAge:0});}catch(e){if(valid()){if(home){const page=box.closest('#page');if(page){page.dataset.checkinPending='false';syncCheckinPrimary(page);}}box.innerHTML=home?'':`<section class="card checkin-card"><h2>Your weekly check-in</h2><p>Couldn’t load your weekly check-in. Your food log is still available.</p><button class="ghost wide" type="button" data-checkin-retry>Try again</button></section>`;const retry=$('[data-checkin-retry]',box);if(retry)retry.onclick=()=>weeklyCheckinCard(box,{home});}}
}
// The photo is shrunk on the phone (max 1280 px JPEG), sent with the optional description, never stored.
async function shrinkPhoto(file, max = 1280) {
  const url = typeof file==='string'?file:URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { if(typeof file!=='string')URL.revokeObjectURL(url); }
}
function describeSheet(day, meal, tool) {
  const q=new URLSearchParams();if(day)q.set('d',day);if(meal)q.set('meal',meal);if(tool)q.set('tool',tool);
  go('/food/describe'+(q.toString()?'?'+q:''));
}
