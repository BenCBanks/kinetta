// Kinetta — Food log pages. Fast logging: search (own foods + recent first, then Open Food Facts + USDA),
// barcode, quick add, photo (Gemini estimate), saved meals, copy a day. Every entry editable; deletes have Undo.
'use strict';
const MEAL_NAMES = {breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks'};
const MACROS = [['protein_g', 'Protein', 'P'], ['carbs_g', 'Carbs', 'C'], ['fat_g', 'Fat', 'F']];
const r0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
const r1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString());
// a food's numbers in full, shown when you tap it (rows show calories only; 2026-10-12: "1P 50C 1F" meant nothing)
const nutGrid = (v) => `<div class="nut"><span><b class="num">${r0(v.kcal)}</b><small>Calories</small></span>${MACROS.map(([k, n]) =>
  `<span><b class="num">${(v.ref?.unknown_nutrients||[]).includes(k)?'Unknown':r1(v[k])+' g'}</b><small>${n}</small></span>`).join('')}</div>`;
const EXTRA_NUTRIENTS = [['sodium_mg','Sodium','mg','sodium_target_mg'],['sugar_g','Total sugar','g','sugar_target_g'],['saturated_fat_g','Saturated fat','g','saturated_fat_target_g']];
const FOOD_NUTRIENTS = ['kcal','protein_g','carbs_g','fat_g','fiber_g',...EXTRA_NUTRIENTS.map(([k])=>k)];
const nutrientKnown = (v,k) => v[k]!=null && !(v.ref?.unknown_nutrients||[]).includes(k);
function nutrientNumber(v,unit){if(v==null)return 'Unknown';if(v===0)return '0 '+unit;return v<(unit==='mg'?1:.1)?'&lt;'+(unit==='mg'?'1':'.1')+' '+unit:(unit==='mg'?r0(v):r1(v))+' '+unit;}
function nutrientSource(v){const r=v.ref||{},origin=r.origin||v.origin,source=r.origin_ref?.source||r.source||v.source;return (origin==='ai'?'AI estimate':origin==='label'?'Nutrition label':({usda:'USDA',off:'Open Food Facts',label:'Nutrition label',quick:'Entered by you',dish:'Saved recipe',custom:'My food'}[source]||''))+((r.origin_edited||v.origin_edited)?' · Edited':'');}
function extraInputs(v={},targets=false){return `<details class="extra-nutrients extra-inputs"><summary>${targets?'Optional nutrient limits':'More nutrients'}</summary><p class="small muted">${targets?'Leave these unset unless you want your own daily limits. These do not change your calorie goal.':'For this amount of food. Leave a value blank if you don’t know it; a reported zero stays zero.'}</p>${!targets&&nutrientSource(v)?`<p class="small muted">Source: ${esc(nutrientSource(v))}</p>`:''}<div class="extra-fields">${EXTRA_NUTRIENTS.map(([key,label,unit,target])=>{const k=targets?target:key;return `<label>${label} (${unit})<input name="${k}" inputmode="decimal" value="${esc((targets||nutrientKnown(v,k))?v[k]??'':'')}" aria-label="${label} ${targets?'daily limit in ': 'in '}${unit}"></label>`;}).join('')}</div></details>`;}
function extraFormValues(f,targets=false){return Object.fromEntries(EXTRA_NUTRIENTS.map(([key,, ,target])=>{const k=targets?target:key,raw=f.elements.namedItem(k)?.value.trim()??'',value=raw===''?null:Number(raw.replace(',','.'));if(value!==null&&(!Number.isFinite(value)||value<0))throw Error('Enter a positive number or zero, or leave the nutrient blank.');return [k,value];}));}
function foodStorage(entry){const missing=FOOD_NUTRIENTS.filter(k=>!nutrientKnown(entry,k));if(missing.includes('kcal'))throw Error('Add calories before logging this food.');const out={...entry,ref:{...(entry.ref||{}),unknown_nutrients:missing}};for(const k of FOOD_NUTRIENTS)if(missing.includes(k))out[k]=['kcal','protein_g','carbs_g','fat_g'].includes(k)?0:null;return out;}
function extraCoverage(entries,targets={}){return Object.fromEntries(EXTRA_NUTRIENTS.map(([k,,,target])=>{const known=entries.filter(e=>nutrientKnown(e,k));return [k,{recorded:known.length?known.reduce((n,e)=>n+Number(e[k]),0):null,known_count:known.length,unknown_count:entries.length-known.length,complete:!!entries.length&&known.length===entries.length,target:targets[target]}];}));}
function extraTotals(values,{period=false}={}){return `<details class="extra-nutrients"><summary>More nutrients${period?' · this range':''}</summary><dl>${EXTRA_NUTRIENTS.map(([k,label,unit])=>{const v=values?.[k]||{};return `<div><dt>${label}</dt><dd><b class="num">${nutrientNumber(v.recorded,unit)}</b>${v.recorded!=null&&!v.complete?'<small>Known subtotal · incomplete</small>':''}${v.unknown_count?`<small>${v.unknown_count} food${v.unknown_count===1?'':'s'} with no value</small>`:''}${!period&&v.target!=null?`<small>Your limit: ${nutrientNumber(v.target,unit)}</small>`:''}</dd></div>`;}).join('')}</dl><p class="small muted">${period?'Recorded totals across this date range. ':''}Missing values are unknown, not zero. Total sugar includes naturally occurring sugar.</p></details>`;}
function extraFood(v){return `<details class="extra-nutrients"><summary>More nutrients</summary><dl>${EXTRA_NUTRIENTS.map(([k,label,unit])=>`<div><dt>${label}</dt><dd class="num">${nutrientNumber(nutrientKnown(v,k)?v[k]:null,unit)}</dd></div>`).join('')}</dl><p class="small muted">For this portion, using its recorded source values. Estimates stay estimates; missing values are unknown.</p></details>`;}
const isoDay = (d) => d.toLocaleDateString('en-CA', {timeZone: tz()});
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const dayLabel = (iso) => { const t = isoDay(new Date()); return iso === t ? 'Today' : iso === addDays(t, -1) ? 'Yesterday' : iso === addDays(t, 1) ? 'Tomorrow' : new Date(iso + 'T12:00').toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'}); };
function guessMeal() {   // the meal you usually log at this hour (learned from your log), else a sensible clock guess
  const h = new Date().getHours(), mine = App.mealHours && App.mealHours[h];
  return mine || (h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snacks' : h < 21 ? 'dinner' : 'snacks');
}

// Me leads with food even when there are no workouts or meals yet.
const homeCalories = v => Math.round((v || 0) / 5) * 5;
function macroTotal(D,k,target){const missing=D.unknown_nutrients?.[k]||0;if(missing)return missing>=D.entries.length?'Unknown':`${r0(D.totals[k])} g known · incomplete`;return `${r0(D.totals[k])} g${target?' / '+r0(target)+' g':''}`;}
function syncCheckinPrimary(page){
  if(!page)return;const log=$('#tf-add',page);
  if(log){const pending=page.dataset.checkinPending==='true';log.classList.toggle('primary',!pending);log.classList.toggle('ghost',pending);}
  const primary=!!$('#nt-checkin .primary',page);
  if(primary)$$('#nt-body .primary',page).forEach(b=>{b.dataset.checkinQuiet='1';b.classList.replace('primary','ghost');});
  else $$('#nt-body [data-checkin-quiet]',page).forEach(b=>{delete b.dataset.checkinQuiet;b.classList.replace('ghost','primary');});
}
function checkinDetails(row,actions=false){
  const d=row.data,convert=kg=>imp()?kg*2.20462:kg,unit=imp()?'lb':'kg';
  const rate=d.trend_kg_per_week,requested=convert(d.requested_kg_per_week||0);
  const aim=requested>=.05&&['lose_weight','build_muscle'].includes(d.goal)?`For your goal of ${d.goal==='lose_weight'?'losing':'gaining'} about ${requested.toFixed(1)} ${unit} a week, `:'For your current goal, ';
  return `<section class="card checkin-card" data-checkin="${esc(row.id)}"><h2>Your weekly check-in</h2><p class="small muted">Week of ${esc(dayLabel(row.week))} · last 28 completed days · as of ${esc(new Date(row.updated).toLocaleDateString([],{month:'short',day:'numeric',timeZone:tz()}))}</p>
    <dl class="checkin-numbers"><div><dt>Average eaten</dt><dd><b>${r0(homeCalories(d.avg_intake))}</b><small>kcal / logged day</small></dd></div><div><dt>Weight trend</dt><dd><b>${rate>0?'+':''}${convert(rate).toFixed(1)}</b><small>${unit} / week</small></dd></div><div><dt>Observed burn</dt><dd><b>${r0(homeCalories(d.observed_burn))}</b><small>kcal / day · inferred</small></dd></div></dl>
    <p>${actions?esc(aim)+'try ':'Saved suggestion: '}<b>${r0(d.suggested_kcal)} kcal a day</b>.</p>${d.floor_applied?'<p class="small">The estimated resting-burn floor limits this suggestion; the requested pace may be slower.</p>':''}
    <p class="small muted">${d.logged_days} fully logged days · ${d.weigh_ins} weigh-ins over ${d.weigh_in_span_days} days. Formula estimate: about ${r0(homeCalories(d.estimated_burn))} kcal / day.${d.unknown_calorie_days?' Days with unknown calories are left out.':''}</p>
    ${actions?'<div class="checkin-actions"><button type="button" class="primary" data-checkin-accept>Accept</button><button type="button" class="ghost" data-checkin-later>Not now</button></div>':`<p class="small">${row.state==='accepted'?'Accepted · calorie target updated at that time.':row.state==='deferred'?'Not now · hidden on Me until next week.':'Previous suggestion · not applied.'}</p>`}
    <button type="button" class="linkbtn" data-checkin-help>How this works</button><p class="err" role="status" data-checkin-status></p></section>`;
}
async function weeklyCheckinCard(box,{home=false}={}){
  if(!box?.isConnected)return;const owner=readOwner(),valid=()=>box.isConnected&&owner===readOwner();
  if(!home)box.innerHTML=skel(1);
  const draw=data=>{
    if(!valid())return;const row=data.current,pending=row?.state==='pending';
    const page=box.closest('#page');if(home&&page){page.dataset.checkinPending=String(!!pending);syncCheckinPrimary(page);}
    if(home&&!pending){box.innerHTML='';return;}
    if(row)box.innerHTML=checkinDetails(row,pending);
    else{const r=data.readiness||{},action=r.action||'food';box.innerHTML=`<section class="card checkin-card"><h2>Your weekly check-in</h2><p>${esc(r.reason||'Not enough data yet.')}</p>${action==='weight'?'<button class="primary wide" type="button" data-checkin-weight>Log weight</button>':`<a class="primary wide" href="${action==='goal'?'/food/setup':'/food/describe'}">${action==='goal'?'Choose a goal':'Log food'}</a>`}<p class="small muted">No watch or AI needed. Suggestions wait for complete enough food and weight records.</p></section>`;const weight=$('[data-checkin-weight]',box);if(weight)weight.onclick=()=>{if(valid())quickWeighIn();};}
    if(!home){const history=(data.history||[]).filter(r=>r.id!==row?.id&&r.week<data.week);if(history.length)box.insertAdjacentHTML('beforeend',`<details class="checkin-history"><summary>Previous check-ins</summary>${history.map(r=>checkinDetails(r)).join('')}</details>`);}
    $$('[data-checkin-help]',box).forEach(b=>b.onclick=()=>{if(!valid())return;sheet('How your check-in works',`<div class="checkin-explanation"><p>We use the last 28 completed days. At least 7 fully logged food days and 3 weigh-ins spanning 10 days are needed. Very partial days and today are left out.</p><p>Average food minus the energy equivalent of your weight trend gives an observed daily burn estimate. It includes your usual workouts; it is not a direct measurement. The formula estimate is shown for comparison.</p><p>Your chosen goal and pace shape the calorie suggestion. It cannot go below estimated resting burn. Water changes, missing food and scale variation can affect the result.</p><p>Accept changes only your calorie target. Your chosen resting-calorie source and macro targets stay as set. Not now hides the card on Me until next week; this record remains in Progress.</p><p>No AI or watch is needed. You can change your goal or target any time.</p></div>`);});
    syncCheckinPrimary(page);
    for(const [selector,action]of [['[data-checkin-accept]','accept'],['[data-checkin-later]','later']]){const button=$(selector,box);if(button)button.onclick=async()=>{
      if(!valid())return;$$('.checkin-actions button',box).forEach(b=>b.disabled=true);const status=$('[data-checkin-status]',box);status.textContent=action==='accept'?'Updating your calorie target…':'Saving your choice…';
      try{const result=await api(`/api/food/check-in/${row.id}/${action}`,json('POST',action==='accept'?{baseline:row.baseline,confirmed:true}:{}));if(!valid())return;
        invalidate('/api/food');if(result.kcal_target!=null)refreshMe({...App.me,kcal_target:result.kcal_target});draw(result);toast(result.already_decided?(result.current?.state==='accepted'?'Already accepted. Your current target is unchanged.':'Already set aside until next week.'):result.current?.state==='accepted'?'Calorie target saved.':'Check-in hidden until next week.');render();
      }catch(e){if(!valid())return;if(e.status===409){invalidate('/api/food/check-in');await weeklyCheckinCard(box,{home});toast(e.message);}else{status.textContent=e.message;$$('.checkin-actions button',box).forEach(b=>b.disabled=false);}}
    };}
  };
  try{await load('/api/food/check-in',draw,{maxAge:30000});}catch(e){if(valid()){if(home){const page=box.closest('#page');if(page){page.dataset.checkinPending='false';syncCheckinPrimary(page);}}box.innerHTML=home?'':`<section class="card checkin-card"><h2>Your weekly check-in</h2><p>Check-in could not load. Your food log is still available.</p><button class="ghost wide" type="button" data-checkin-retry>Retry</button></section>`;const retry=$('[data-checkin-retry]',box);if(retry)retry.onclick=()=>weeklyCheckinCard(box,{home});}}
}

function todayFoodCard(box, {onHistory} = {}) {
  return load('/api/food/day', (D) => {
    if (!box.isConnected) return;
    onHistory?.(!!D.has_history || D.entries.length>0);
    App.mealHours = D.meal_hours || App.mealHours;
    const g = D.goal?.kcal, T = D.totals, left = g == null ? null : g - T.kcal;
    const meal = [guessMeal(), ...Object.keys(MEAL_NAMES)].find(m => !D.entries.some(e => e.meal === m));
    const workouts = D.burned?.items || [];
    const macroEnergy = (T.protein_g || 0)*4 + (T.carbs_g || 0)*4 + (T.fat_g || 0)*9;
    box.innerHTML = `<section class="card home-today" aria-label="Today’s food"><h2>Today<a class="more" href="/food">Food log ›</a></h2>
      ${D.entries.length || g != null ? `<div class="home-energy"><small>${g == null ? 'Eaten' : left < 0 ? 'Above goal' : 'Calories left'}</small><div class="hero-num num">${r0(homeCalories(g == null ? T.kcal : Math.abs(left)))}<i>kcal</i></div>
      <p class="small muted">${r0(homeCalories(T.kcal))} eaten${g == null ? '' : ` · ${r0(homeCalories(g))} goal`}</p></div>` : '<p>Make room for what you enjoy. Start with something you ate.</p>'}
      ${g == null ? '<a class="linkbtn home-set-goal" href="/food/setup">Set a goal · optional</a>' : ''}
      ${D.entries.length ? `<div class="split home-macro-bar"${MACROS.some(([k])=>D.unknown_nutrients?.[k])?' hidden':''} aria-hidden="true">${MACROS.map(([k]) => `<i class="m-${k}" data-w="${macroEnergy ? ((T[k] || 0)*(k === 'fat_g' ? 9 : 4)/macroEnergy).toFixed(3) : 0}"></i>`).join('')}</div><div class="home-macros" aria-label="Macros eaten">${MACROS.map(([k,n]) => `<span><b>${n}</b><span class="num">${macroTotal(D,k,D.targets?.[k.replace('_g','_target')])}</span></span>`).join('')}</div>` : ''}
      <button class="primary wide" id="tf-add">${svg('plus')} Log food</button>
      <div class="home-food-ways" role="group" aria-label="Ways to log food">${[['describe','Describe','comment'],['snap','Snap','camera'],['scan','Scan','barcode'],['usual','Usual','food']].map(([k,n,ico]) => `<button class="ghost" data-home-food="${k}">${svg(ico)}${n}</button>`).join('')}</div>
      ${meal ? `<div class="home-empty-meal"><span>${esc(MEAL_NAMES[meal])} · nothing yet</span><button class="linkbtn" id="tf-yesterday">Same as yesterday</button></div>` : ''}
      ${workouts.map(w => `<a class="home-workout" href="/activity/${w.id}">${svg(w.sport || 'activity')}<span>${esc(w.name)}${w.distance_m ? ` · ${U.dist(w.distance_m)} ${U.du()}` : ''}<small>+${r0(homeCalories(w.kcal))} kcal burned${w.estimated ? ' · estimated' : ''}</small></span>${svg('chev')}</a>`).join('')}
      ${D.entries.some(e => e.pending) ? '<p class="small muted" role="status">Some foods are waiting to send.</p>' : ''}</section>`;
    syncCheckinPrimary(box.closest?.('#page'));
    const day = D.day, expected = guessMeal();
    $('#tf-add', box).onclick = () => describeSheet(day, expected);
    $$('[data-home-food]', box).forEach(b => b.onclick = () => {
      Native.haptic('selection');
      if (b.dataset.homeFood === 'usual') addSheet(day, expected);
      else if (['scan','snap'].includes(b.dataset.homeFood) && typeof FoodThread!=='undefined') go('/food/describe?tool='+b.dataset.homeFood);
      else if (b.dataset.homeFood === 'scan') scanSheet(day, expected, product => amountSheet(product, {day, meal:expected}));
      else { describeSheet(day, expected); if (b.dataset.homeFood === 'snap') { const f = $('#ql-file'); if (f) { f.setAttribute('capture','environment'); if (aiCan('food')) f.click(); else toast('Enable food photo estimates in Me, or describe your food'); } } }
    });
    const yesterday = $('#tf-yesterday', box);
    if (yesterday) yesterday.onclick = () => yesterdayMeal(D.day, meal);
  }, {maxAge: 5000});
}
function yesterdayMeal(day, meal) {
  const owner = readOwner();
  sheet(`Yesterday’s ${MEAL_NAMES[meal].toLowerCase()}`, skel(1), (b, close) => {
    api(`/api/food/day?d=${addDays(day,-1)}`).then(D => {
      if (!b.isConnected || readOwner() !== owner) return;
      const rows = D.entries.filter(e => e.meal === meal && !e.pending);
      b.innerHTML = rows.length ? `<p>Log these foods for ${esc(MEAL_NAMES[meal].toLowerCase())} today?</p><ul>${rows.map(e => `<li>${esc(e.name)} · ${esc(fmtAmount(e))}</li>`).join('')}</ul><button class="primary wide" id="ym-save">Log this meal</button>` : '<p>No foods were logged for this meal yesterday.</p><button class="primary wide" id="ym-usual">Choose from your usuals</button>';
      if (!rows.length) { $('#ym-usual', b).onclick = () => { close(); addSheet(day, meal); }; return; }
      $('#ym-save', b).onclick = async e => {
        e.currentTarget.disabled = true;
        const items = rows.map(({name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,source,ref}) => ({day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,source,ref}));
        try {
          const result = await addEntries(items);
          if (readOwner() !== owner) return;
          close(); Native.haptic('light');
          if (!result.queued) {
            let busy = false, done = false;
            const undo = async () => {
              if (busy || done || readOwner() !== owner) return;
              busy = true;
              try { await Promise.all(result.ids.map(id => api(`/api/food/entries/${id}`, {method:'DELETE'}))); done = true; refresh(); toast('Meal removed'); }
              catch(x) { if (readOwner() === owner) toast('Could not undo · try again',undo); }
              finally { busy = false; }
            };
            toast('Meal logged',undo);
          }
        }
        catch(x) { if (b.isConnected) { $('#ym-save',b).disabled = false; toast(x.message); } }
      };
    }).catch(x => { if (b.isConnected && readOwner() === owner) { b.innerHTML = '<p>Yesterday could not load.</p><button class="primary wide" id="ym-retry">Try again</button>'; $('#ym-retry',b).onclick = () => { close(); yesterdayMeal(day,meal); }; } });
  });
}

// nutrition for an amount of a normalised food (per100 / per_serving + serving grams)
function scaleFood(f, amount, unit) {
  const out = {};
  for (const k of FOOD_NUTRIENTS) {
    let v = null;
    if (f._unit && !f.per100 && f.per_serving) v = f.per_serving[k] == null ? null : f.per_serving[k] * amount;    // a recent food: per the unit it was logged in
    else if (unit === 'g' && f.per100 && f.per100[k] != null) v = f.per100[k] * amount / 100;
    else if (unit !== 'g' && f.per_serving && f.per_serving[k] != null) v = f.per_serving[k] * amount;
    else if (unit !== 'g' && f.per100 && f.per100[k] != null) v = f.per100[k] * (f.serving && f.serving.g ? f.serving.g : 100) / 100 * amount;
    out[k] = (f.unknown_nutrients||f._last?.ref?.unknown_nutrients||[]).includes(k)?null:v==null?null:Math.round(v*10000)/10000;
  }
  return out;
}

// ---------- day page ----------
// the energy-balance breakdown stays open or closed the way you left it (on this phone)
const bdOpen = () => { try { return localStorage.getItem('fit.bd') === '1'; } catch (e) { return false; } };
// Nutrition (2026-10-12 redesign, Ben: "like you did the Progress tab"): one row of small buttons. View ▾ holds the food
// log and the progress views (each a short page instead of one long scroll); beside it, the day (log) or the time range.
const NLOG = [['log', 'Food log', 'What you ate, day by day', 'food', 'c-green']];
const NPROG = [['overview', 'Overview', 'Averages, insights and Kit', 'sparkle', 'c-purple'],
  ['energy', 'Calories & weight', 'Eaten vs burned, and your running deficit', 'flame', 'c-orange'],
  ['macros', 'Protein & macros', 'Protein, carbs and fat, and your top foods', 'progress', 'c-red'],
  ['weight', 'Weight', 'Log a weigh-in and see your trend', 'scale', 'c-purple'],
  ['needs', 'Calorie needs', 'What you burn, and your daily target', 'target', 'c-brand'],
  ['weeks', 'Week by week', 'Every week in one table', 'calendar', 'c-blue']];
const NMORE = [['import', 'Add past days', 'Weight and calories from another app', 'upload', 'c-grey']];
const NRANGED = ['overview', 'energy', 'macros'];
function nHead(el, view, filters) {
  const v = [...NLOG, ...NPROG].find((m) => m[0] === view), inProgress = location.pathname === '/progress';
  el.innerHTML = `<div class="top"><h1>${inProgress ? 'Progress' : 'Nutrition'}</h1><div class="acts"><button class="icon-btn" id="n-help" aria-label="Nutrition help">${svg('help')}</button>${bellBtn()}</div></div>
    ${inProgress ? progressSwitch('food') + `<nav class="view-nav" aria-label="Food and weight views">${[['overview','Overview'],['weight','Weight'],['calendar','Calendar']].map(([k,n]) => `<a href="${nutritionHref(k)}"${view === k ? ' aria-current="page"' : ''}>${n}</a>`).join('')}${pillBtn('n-view', '', 'More', 'More food and weight views')}</nav>` : `<nav class="view-nav" aria-label="Nutrition views">${[['log','Food log'],['overview','Overview'],['weight','Weight']].map(([k,n]) => `<a href="${k === 'log' ? '/food' : '/food?view=' + k}"${view === k ? ' aria-current="page"' : ''}>${n}</a>`).join('')}${pillBtn('n-view', '', 'More', 'More nutrition views')}</nav>`}<div class="pbar nbar">${filters}</div><div id="n-body"></div>`;
  $('#n-help', el).onclick = () => sheet('About your nutrition', `<p>For more accurate calorie estimates, update your weight, height, birth year (age) and sex in <a href="/me?setup=body">Me → Body &amp; heart rate</a>.</p><p class="small muted">Your daily balance compares food logged with estimated burn for the whole day. It becomes useful when you’ve finished logging.</p><p class="small">Edit ingredients and totals in <a href="/food/meals">My Recipes</a>. Tap a logged food to change just that entry.</p>`, (b, close) => $$('a', b).forEach(a => a.addEventListener('click', close)));
  $('#n-view', el).onclick = () => pickSheet('Show', `<h3 class="ghead">Your log</h3>${pickRows(NLOG, view)}<h3 class="ghead">Progress</h3>${pickRows(NPROG, view)}<h3 class="ghead">More</h3>${pickRows(NMORE, view)}`,
    (k) => (k === 'import' ? go('/food/import') : go(k === 'log' ? '/food' : nutritionHref(k), {replace: true})));
  if (inProgress) el.addEventListener('click', e => { const a = e.target.closest('a[href^="/food?view="]'); if (!a) return; e.preventDefault(); e.stopPropagation(); const u = new URL(a.href); const v = u.searchParams.get('view'); u.searchParams.delete('view'); go(nutritionHref(v,u.searchParams.toString())); });
  return $('#n-body', el);
}
route(/^\/food$/, 'food', async (el) => {
  const q = new URLSearchParams(location.search), v0 = q.get('view') || 'log';
  const view = v0 === 'trends' ? 'overview' : [...NLOG, ...NPROG].some((m) => m[0] === v0) ? v0 : 'log';   // "trends": the old address
  if (view !== 'log') return nutritionView(el, view, q);
  const day = q.get('d') || isoDay(new Date()), today = isoDay(new Date());
  const body = nHead(el, 'log', `<label class="range-btn daypick">${svg('calendar')}<span>${esc(dayLabel(day))}</span><input type="date" id="fd-date" value="${esc(day)}" aria-label="Pick a day to log or edit"></label>
      <span class="nbar-arrows"><button class="icon-btn sm" id="fd-prev" aria-label="Previous day">${svg('back')}</button><button class="icon-btn sm" id="fd-next" aria-label="Next day">${svg('chev')}</button></span>`);
  body.innerHTML = `${day === today ? '' : '<p class="center backtoday"><button class="linkbtn" id="fd-today">Back to today</button></p>'}<div class="quick"><button class="primary" id="fq-add">${svg('search')} Add food</button></div>
    <p class="small food-library-link"><a href="/food/meals">My Recipes &amp; foods · edit or create</a> · <a href="/food/setup">${App.me.kcal_target ? 'Review goal' : 'Set a goal'}</a></p><div id="fd-sum">${skel(1)}</div><div id="fd-meals"></div>`;
  $('#fd-prev', el).onclick = () => go(`/food?d=${addDays(day, -1)}`, {replace: true});
  $('#fd-next', el).onclick = () => go(`/food?d=${addDays(day, 1)}`, {replace: true});
  const bt = $('#fd-today', el); if (bt) bt.onclick = () => go('/food', {replace: true});
  // tap the date: a calendar to jump to any day, to log it or fix it
  const dp = $('#fd-date', el);
  dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* the browser opens its own picker */ } };
  dp.onchange = () => { if (dp.value) go(dp.value === today ? '/food' : `/food?d=${dp.value}`, {replace: true}); };
  $('#fq-add', el).onclick = () => addSheet(day, guessMeal());
  await load(`/api/food/day?d=${day}`, (D) => drawDay(el, D), {maxAge: 5000});
  if (q.get('add') === '1' && el.isConnected) {
    history.replaceState(null, '', '/food'); addSheet(day, guessMeal());
  }
});

// someone who has never logged food (2026-10-12): three steps instead of a page of zeros
function firstFood(box, day) {
  box.innerHTML = '';
  api('/api/food/recent').then((rows) => {
    if (rows.length || !box.isConnected) return;
    const step = (id, ico, c, label, sub) => `<button class="row-link" id="${id}"><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}<small class="muted gs-sub">${sub}</small></span><span class="chev">${svg('chev')}</span></button>`;
    box.innerHTML = `<h2 class="sec-head">Start your food log</h2><div class="card list first-food">
      ${step('ff-goal', 'target', 'c-brand', 'Set your daily targets', 'An optional estimate for calories and protein. You choose what to save.')}
      ${step('ff-log', 'search', 'c-green', 'Log something you ate', 'Search, scan a barcode or snap a photo.')}
      ${step('ff-dish', 'pot', 'c-orange', 'Save a meal you eat often', 'A smoothie or a family recipe: built once, logged in a tap.')}</div>`;
    $('#ff-goal', box).onclick = () => go('/food/setup');
    $('#ff-log', box).onclick = () => addSheet(day, guessMeal());
    $('#ff-dish', box).onclick = (e) => newDish(e.currentTarget);
  }).catch(() => {});
}
function ring(v, target, label) {
  const pct = target ? Math.min(1.25, v / target) : 0, R = 34, C = 2 * Math.PI * R;
  const over = target && v > target * 1.05;
  // a white dot marks where the eaten part ends (2026-10-13)
  const a = Math.min(pct, 1) * 2 * Math.PI - Math.PI / 2, knob = pct > .04 && pct < 1 ? `<circle class="rk" cx="${(40 + R * Math.cos(a)).toFixed(1)}" cy="${(40 + R * Math.sin(a)).toFixed(1)}" r="2.6"/>` : '';
  return `<div class="ring${over ? ' over' : ''}"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="rb"/>
    ${pct > 0 ? `<circle cx="40" cy="40" r="${R}" class="rf" stroke-dasharray="${(Math.min(pct, 1) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/>` : ''}${knob}</svg>
    <div><b class="num">${r0(target ? Math.abs(target - v) : v)}</b><small>${target ? (v > target ? 'over' : 'left') : label}</small></div></div>`;
}
// a small ring per macro beside the calorie ring (2026-10-13, Ben picked option D): grams left in the middle (like the calorie ring), a darker
// second lap once over the target; with no target the ring stays empty and the middle shows grams eaten
function macroRing(k, name, v, tg) {
  const R = 20, C = 2 * Math.PI * R, p = tg ? v / tg : 0, over = tg && v > tg * 1.02;
  const arc = (x, cls) => `<circle cx="24" cy="24" r="${R}" class="${cls}" stroke-dasharray="${(Math.min(x, 1) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/>`;
  return `<div class="mring m-${k}${over ? ' over' : ''}${tg ? '' : ' none'}" role="img" aria-label="${name} ${r0(v)} g${tg ? ` of ${r0(tg)}, ${r0(Math.abs(tg - v))} ${v > tg ? 'over' : 'left'}` : ', no target'}">
    <div class="mr-c"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="${R}" class="rb"/>${p > 0 ? arc(p, 'rf') : ''}${p > 1 ? arc(p - 1, 'rf2') : ''}</svg>
      <div><b class="num">${r0(tg ? Math.abs(tg - v) : v)}</b><small>${tg ? (v > tg ? 'over' : 'left') : 'eaten'}</small></div></div>
    <div class="mr-t"><small>${name}</small><span class="num">${tg ? `${r0(v)} of ${r0(tg)} g` : `${r0(v)} g`}</span>${tg ? '' : '<i>no target</i>'}</div></div>`;
}
function drawDay(el, D) {
  App.mealHours = D.meal_hours || App.mealHours;
  const t = D.targets || {}, T = D.totals, B = D.burned || {kcal: 0, n: 0, items: []}, G = D.goal || {}, today = dayLabel(D.day) === 'Today';
  const watchResting = B.source === 'apple_health';
  const eaten = T.kcal, goal = G.kcal, left = goal != null ? goal - eaten : null, sofar = today ? ' so far' : '';
  const goalNote = goal == null ? 'No calorie goal yet. Tap Set goal to add one.'
    : G.custom != null ? `Goal set for this day${G.default ? ` (your usual is ${r0(G.default)})` : ''}.`
    : G.extra ? `Your daily target ${r0(G.default)} + ${r0(G.extra)} for ${today ? "today's" : "this day's"} extra training.` : '';
  // signs (2026-10-13, Ben): what you eat counts up (+), what you burn counts down (−), so the deficit comes out negative
  const neg = (v) => (Math.round(v) ? '−' : '') + r0(Math.abs(v)), pos = (v) => (Math.round(v) ? '+' : '') + r0(v);
  const row = (label, v, cls = '', sub = '') => `<div class="brow ${cls}"><span>${label}${sub ? `<small class="muted">${sub}</small>` : ''}</span><b class="num">${v}</b></div>`;
  // one card (2026-10-12 redesign): calories, macros, then the day's balance, with how it adds up folded underneath
  $('#fd-sum', el).innerHTML = `<div class="card tcard balance">
      <div class="nutrition-summary"><div><small class="eyebrow">${left == null ? 'Calories eaten' : left < 0 ? 'Above goal' : 'Calories remaining'}</small><div class="hero-num">${r0(left == null ? eaten : Math.abs(left))}<i>kcal</i></div>${goal == null ? '' : `<p class="small muted">${r0(eaten)} eaten of ${r0(goal)}</p>`}</div>
        <button class="ghost" id="fd-goal" aria-label="Set the calorie goal for this day">${svg('edit')} ${goal == null ? 'Set goal' : 'Goal'}</button></div>
      ${goal ? `<div class="track"><div class="bar${left < 0 ? ' over' : ''}" data-w="${Math.min(1,eaten/goal).toFixed(3)}"></div></div>` : ''}
      <div class="macro-bars">${MACROS.map(([k,n]) => { const target = t[k.replace('_g','_target')], v = T[k] || 0; return `<div><div class="macro-line"><b>${n}</b><span class="num">${macroTotal(D,k,target)}</span></div>${target && !D.unknown_nutrients?.[k] ? `<div class="track"><div class="bar m-${k}" data-w="${Math.min(1,v/target).toFixed(3)}"></div></div>` : ''}</div>`; }).join('')}</div>
      ${D.entries.length?extraTotals(extraCoverage(D.entries,t)):''}
      ${goalNote ? `<p class="small muted tc-note">${esc(goalNote)}</p>` : ''}
      ${!t.protein_target ? '<button class="linkbtn tc-settg" id="fd-targets">Set macro targets</button>' : ''}
      ${!watchResting && B.deficit == null ? '<p class="small muted tc-bal">Log food to see your deficit for this day.</p>' : B.day_burn == null ? `<p class="small muted tc-bal">Resting calories have not synced for this day. Activities: ${r0(B.kcal)} kcal. Total burn is waiting for resting data.</p>`
        : `<details class="bd tc-bal"${!today && bdOpen() ? ' open' : ''}><summary><span>${today ? watchResting ? 'Energy balance so far' : 'Daily energy breakdown' : B.deficit == null ? 'Energy breakdown' : B.deficit >= 0 ? 'Deficit' : 'Surplus'}<small class="muted">${watchResting ? ' · Health resting + activities' : ' · estimate'}</small></span>
            <b class="num ${today ? 'day-balance-detail' : ''} ${B.partly ? '' : B.deficit >= 0 ? 'good' : 'bad'}">${B.deficit == null ? neg(B.day_burn) : B.deficit >= 0 ? neg(B.deficit) : pos(-B.deficit)}<i> kcal</i></b><span class="chev">${svg('chev')}</span></summary>
        ${B.partly ? '<p class="small muted">Looks only partly logged, so this day is left out of your averages and totals. Add the rest and it counts.</p>' : ''}
        ${row(watchResting ? 'Resting calories · Apple Health' : 'Resting burn (BMR)', neg(B.bmr), '', watchResting ? `${today ? 'synced so far' : 'synced daily total'}${B.observed_at ? ` · read ${esc(when(B.observed_at))}` : ''}` : B.bmr_exact ? 'Kinetta estimate' : 'rough guess · <a href="/me">add height & age</a>')}
        ${watchResting ? '' : row('Everyday activity', neg(B.daily_life), '', `${esc((B.activity || '').toLowerCase())} · <a href="/food?view=needs">change</a>`)}
        ${B.items.length ? B.items.map((a) => row(`<a href="/activity/${a.id}"><span class="exi sp ${esc(a.sport)}">${svg(a.sport)}</span>${esc(a.name)}</a>`, neg(a.kcal) + (a.estimated ? '*' : ''), 'ex', a.distance_m ? `${U.dist(a.distance_m, 1)} ${U.du()}` : '')).join('')
                         : row('Exercise', '0', 'ex', 'no workouts this day')}
        ${row(today ? watchResting ? 'Burned so far' : 'Burned by end of day' : 'Total burned', neg(B.day_burn), 'sum', today ? watchResting ? 'synced resting calories + activities already in Kinetta' : 'estimate for the whole day' : '')}
        ${row('Eaten' + sofar, pos(eaten))}
        ${!watchResting && G.deficit != null && (today || D.entries.length) ? `<p class="small muted">Eating exactly your goal would be a ${G.deficit >= 0 ? 'deficit' : 'surplus'} of ${r0(Math.abs(G.deficit))} kcal.${B.items.some((a) => a.estimated) ? ' * exercise estimated from distance/time and weight.' : ''}</p>` : ''}
        ${watchResting ? `<p class="small muted">Your food goal stays independent of calories burned.${today ? ' Resting calories build throughout the day; this is not a full-day projection.' : ''}${B.items.some(a=>a.estimated) ? ' * Activity calories are estimated when no recorded value is available.' : ''}</p>` : ''}<a class="small more-link" href="/food?view=energy">Running total ›</a></details>`}<a class="small more-link" id="fd-resting-source" href="/food?view=needs">Resting calories: ${watchResting ? 'Apple Health' : 'Kinetta estimate'} · change ›</a></div>`;
  const tb = $('#fd-targets', el); if (tb) tb.onclick = () => targetsSheet();
  const bd = $('details.bd', el); if (bd) bd.ontoggle = () => { try { localStorage.setItem('fit.bd', bd.open ? '1' : ''); } catch (e) { /* no storage */ } };
  $('#fd-goal', el).onclick = () => goalSheet(D);
  const by = {breakfast: [], lunch: [], dinner: [], snacks: []}; for (const e of D.entries) by[e.meal].push(e);
  $('#fd-meals', el).innerHTML = Object.keys(MEAL_NAMES).map((m) => {
    const list = by[m], kc = list.reduce((s, e) => s + e.kcal, 0);
    if (!list.length) return `<section class="card meal empty-meal meal-${m}"><h2>${MEAL_NAMES[m]}<button class="linkbtn" data-add="${m}" aria-label="Add food to ${MEAL_NAMES[m].toLowerCase()}">+ Add</button></h2>
      </section>`;
    return `<section class="card meal meal-${m}"><h2>${MEAL_NAMES[m]}<span class="muted small num">${list.length ? r0(kc) + ' kcal' : ''}</span></h2>
      ${list.map((e) => { const fe = `<button class="fe${e.pending ? ' pending' : ' sw-row'}" data-id="${e.id}" aria-label="Edit ${esc(e.name)} in ${MEAL_NAMES[m]}"><div><b>${esc(e.name)}</b><small class="muted">${e.pending ? 'Waiting to send · ' : ''}${esc(fmtAmount(e))}${e.brand ? ' · ' + esc(e.brand) : ''}</small></div>
        <div class="r"><b class="num">${r0(e.kcal)}</b><small class="muted">kcal</small></div></button>`;
        // swipe left to remove (with Undo); Remove is also in the food's editor and the meal's Edit menu
        return e.pending ? fe : `<div class="swipe"><button type="button" class="sw-del" data-del="${e.id}" tabindex="-1">${svg('trash')}Remove</button>${fe}</div>`; }).join('')}
      <div class="mealact"><button class="linkbtn" data-add="${m}" aria-label="Add food to ${MEAL_NAMES[m].toLowerCase()}">+ Add</button>${list.length ? `<button class="linkbtn" data-more="${m}" aria-label="Edit ${MEAL_NAMES[m].toLowerCase()}">${svg('edit')}Edit</button>` : ''}</div></section>`;
  }).join('') + (D.entries.length ? '' : `<p class="small muted center">Nothing logged ${dayLabel(D.day) === 'Today' ? 'yet today' : 'this day'}. <button class="linkbtn" id="fd-copy">Copy yesterday</button></p>`);
  $$('[data-add]', el).forEach((b) => b.onclick = () => addSheet(D.day, b.dataset.add));
  $$('[data-more]', el).forEach((b) => b.onclick = () => mealMenu(D, b.dataset.more));
  $$('.meal', el).forEach((card) => swipeRows(card, (id) => removeFoodEntry(D.entries.find((e) => String(e.id) === id), {button: $(`.sw-del[data-del="${id}"]`, card)})));
  $$('[data-id]', el).forEach((b) => b.onclick = () => {
    const e = D.entries.find((x) => String(x.id) === b.dataset.id);
    if (e.pending) { toast('Saved on this phone - it sends when you are back online'); return; }
    entrySheet(e, D.day);
  });
  const cp = $('#fd-copy', el); if (cp) cp.onclick = () => copyDay(addDays(D.day, -1), D.day);
}
const fmtAmount = (e) => (e.unit === 'g' ? `${r1(e.amount)} g` : /^of /.test(e.unit) ? `${r1(e.amount)} ${e.unit}` : e.unit === 'serving' ? `${r1(e.amount)} serving${e.amount === 1 ? '' : 's'}` : `${r1(e.amount)} × ${e.unit === 'dish' ? 'meal' : e.unit}`);
const refresh = () => { invalidate('/api/food'); if (location.pathname !== '/food/describe') render(); else if(typeof FoodThread!=='undefined')FoodThread.refresh(); }; // keep a live full-page food conversation until its own confirmation navigates

async function addEntries(items) {   // each item gets a client_id, so a resend after a lost connection never doubles it
  items = items.map((it) => ({...foodStorage(it), client_id: it.client_id || newId()}));
  const r = await sendOrQueue('/api/food/entries?thread=true&captured_at='+encodeURIComponent(new Date().toISOString()), 'POST', items, items.length === 1 ? items[0].name : `${items.length} foods`);
  if (r.queued) {   // offline: show them now, marked "waiting to send"
    for (const it of items) patchDay(it.day, (d) => {
      d.entries.push({...it, id: 'q-' + it.client_id, pending: true});
      for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']) d.totals[k] = (d.totals[k] || 0) + (it[k] || 0);
    });
    if(location.pathname!=='/food/describe')render(); toast('Saved on this phone - it sends when you are back online'); return {queued: true};
  }
  if(typeof FoodThread!=='undefined'&&r.messages)await FoodThread.accept(r);
  refresh(); return r;
}
async function copyDay(from, to, meal) {
  try { const r = await api('/api/food/copy', json('POST', {from_day: from, to_day: to, meal: meal || null})); refresh(); toast(r.copied ? `Copied ${r.copied} item${r.copied > 1 ? 's' : ''}` : 'Nothing to copy'); }
  catch (x) { toast(x.message); }
}
// Meal actions are scoped to the selected meal and day (a past meal can be copied to today).
function mealMenu(D, meal) {
  const list = D.entries.filter(e => e.meal === meal && !e.pending);
  const totals = Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g'].map(k => [k, list.reduce((n, e) => n + (e[k] || 0), 0)]));
  sheet(`Edit ${MEAL_NAMES[meal].toLowerCase()}`, `<p class="small muted">${esc(dayLabel(D.day))} · ${list.length} food${list.length === 1 ? '' : 's'}. Edit an item’s amount or nutrition, or remove it below.</p>
    ${nutGrid(totals)}<div class="card list mm-list">${list.map(e => `<div class="logged-food"><button class="fe" data-me="${e.id}" aria-label="Edit ${esc(e.name)} in ${MEAL_NAMES[meal]}"><div><b>${esc(e.name)}</b><small class="muted">${esc(fmtAmount(e))} · Edit</small></div>
      <div class="r"><b class="num">${r0(e.kcal)}</b><small class="muted">kcal</small></div></button><button class="linkbtn danger remove-food" data-remove-food="${e.id}" aria-label="Remove ${esc(e.name)} from ${MEAL_NAMES[meal]}">${svg('trash')}Remove</button></div>`).join('')}</div>
    <div class="btncol"><button class="primary" id="mm-add">${svg('plus')}Add food to ${MEAL_NAMES[meal]}</button>
    ${D.day !== isoDay(new Date()) && list.length ? `<button class="ghost" id="mm-copy">Copy ${MEAL_NAMES[meal].toLowerCase()} to today</button>` : ''}
    <button class="ghost" id="mm-save"${list.length ? '' : ' disabled'}>Save these foods as a combination</button></div>`, (b, close) => {
    $$('[data-me]', b).forEach(x => x.onclick = () => { close(); entrySheet(list.find(e => String(e.id) === x.dataset.me), D.day); });
    $$('[data-remove-food]', b).forEach(x => x.onclick = () => removeFoodEntry(list.find(e => String(e.id) === x.dataset.removeFood), {button: x, after: close}));
    $('#mm-add', b).onclick = () => { close(); addSheet(D.day, meal); };
    const cp = $('#mm-copy', b); if (cp) cp.onclick = () => { close(); copyDay(D.day, isoDay(new Date()), meal); };
    // naming happens right here (the phone's own pop-up box looked out of place in the iPhone app)
    $('#mm-save', b).onclick = () => {
      $('#mm-save', b).outerHTML = `<form class="form mm-name" id="mm-name"><label>Name this combination<input name="name" maxlength="80" value="${esc(MEAL_NAMES[meal])} favourite" enterkeyhint="done" autocomplete="off"></label>
        <button class="primary">Save combination</button></form>`;
      const form = $('#mm-name', b); form.name.select(); form.name.focus();
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const name = form.name.value.trim(), btn = $('button', form); if (!name || btn.disabled) return;
        const owner = readOwner(); btn.disabled = true;
        try { await api('/api/food/meals', json('POST', {name, from_day: D.day, meal})); if (owner !== readOwner()) return; invalidate('/api/food/meals'); close(); toast('Combination saved'); }
        catch (x) { if (owner === readOwner()) { toast(x.message); if (btn.isConnected) btn.disabled = false; } }
      };
    };
  });
}

// The same one-item removal is available from the log, meal menu and entry editor.
// Keep the deleted row until Undo succeeds, with one stable retry ID.
async function removeFoodEntry(e, {button, after} = {}) {
  if (!e || e.pending || button?.disabled) return false;
  const owner = readOwner(), label = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = 'Removing…'; }
  try {
    const r = await api(`/api/food/entries/${e.id}`, {method: 'DELETE'});
    if (readOwner() !== owner) return false;
    if (after) after(); refresh();
    const entry = {...r.deleted, ref: r.deleted.ref || null, client_id: newId()};
    let restoring = false, restored = false;
    const undo = async () => {
      if (restoring || restored || readOwner() !== owner) return;
      restoring = true;
      try { await addEntries([entry]); restored = true; }
      catch (x) { if (readOwner() === owner) toast(`Couldn’t restore ${e.name}: ${x.message}`, undo); }
      finally { restoring = false; }
    };
    toast(`Removed ${e.name} from ${MEAL_NAMES[e.meal]}`, undo);
    return true;
  } catch (x) { if (readOwner() === owner) toast(x.message); return false; }
  finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = label; } }
}

// ---------- edit an entry ----------
function entrySheet(e, day) {
  const owner = readOwner();
  const ref = e.ref;
  sheet('Edit food', `<p class="entry-context"><b>${esc(e.name)}</b><small class="muted">${MEAL_NAMES[e.meal]} · ${esc(dayLabel(day))}</small></p><div id="es-nut">${nutGrid(e)}</div><form class="form" id="es">
    <label>Name<input name="name" value="${esc(e.name)}" maxlength="200"></label>
    <div class="two"><label>Amount<input name="amount" inputmode="decimal" value="${r1(e.amount)}"></label>
      <label>Unit<select name="unit">${unitOptions(ref, e.unit)}</select></label></div>
    ${macroInputs({...e,...Object.fromEntries((e.ref?.unknown_nutrients||[]).map(k=>[k,null]))})}
    <details class="entry-move"><summary>Move this food</summary><div class="two entry-when"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === e.meal ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Day<input class="datefield" name="day" type="date" value="${esc(day)}"></label></div></details>
    <div class="actions"><button class="primary wide">Save changes</button></div></form>
    <div class="entry-more"><button type="button" class="linkbtn" id="es-again">${svg('plus')}Log again today</button>
      <button type="button" class="linkbtn danger" id="es-del">${svg('trash')}Remove from ${MEAL_NAMES[e.meal]}</button></div>`, (b, close) => {
    guardFoodSheet(b,close,owner);const f = $('#es', b);
    // On a phone, opening the editor shouldn't pop the keyboard up over the numbers.
    if (matchMedia('(pointer: coarse)').matches) b.closest('.sheet').querySelector('[data-close]').focus({preventScroll: true});
    else softFocus(f.name);
    const rescale = () => {   // changing the amount rescales the numbers when we know the food's per-100 g / per-serving values
      const a = parseFloat(f.amount.value);
      if (!(a > 0)) return;
      let v;
      if (ref && (ref.per100 || ref.per_serving)) v = scaleFood(ref, a, f.unit.value);
      else if (e.amount > 0 && f.unit.value === e.unit) { const k = a / e.amount; v = Object.fromEntries(FOOD_NUTRIENTS.map(key=>[key,nutrientKnown(e,key)?e[key]*k:null])); }
      if (v) for (const k of FOOD_NUTRIENTS) if (f[k]) f[k].value = (e.ref?.unknown_nutrients||[]).includes(k) || v[k] == null ? '' : String(Math.round(v[k]*10000)/10000);
      if (v) $('#es-nut', b).innerHTML = nutGrid({...v,ref:e.ref});
    };
    f.amount.oninput = rescale; f.unit.onchange = rescale;
    f.onsubmit = async (ev) => {
      ev.preventDefault(); if(owner!==readOwner()){close();return;}
      const n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
      const body = {name: f.name.value.trim() || e.name, amount: n(f.amount) || e.amount, unit: f.unit.value, meal: f.meal.value, day: f.day.value,
        kcal: n(f.kcal) || 0, protein_g: n(f.protein_g), carbs_g: n(f.carbs_g), fat_g: n(f.fat_g), fiber_g: n(f.fiber_g),...extraFormValues(f)};
      try { await api(`/api/food/entries/${e.id}`, json('PATCH', body)); close(); refresh(); } catch (x) { toast(x.message); }
    };
    $('#es-del', b).onclick = () => {if(owner!==readOwner()){close();return;}removeFoodEntry(e, {button: $('#es-del', b), after: close});};
    $('#es-again', b).onclick = async () => {   // the same food and amount, today in the meal for now
      if(owner!==readOwner()){close();return;}
      const btn = $('#es-again', b); if (btn.disabled) return; btn.disabled = true;
      try { await addEntries([{day: isoDay(new Date()), meal: guessMeal(), name: e.name, brand: e.brand, amount: e.amount, unit: e.unit, kcal: e.kcal,
        protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g,...Object.fromEntries(EXTRA_NUTRIENTS.map(([k])=>[k,e[k]??null])), source: e.source, ref: e.ref}]); close(); toast(`Logged ${e.name} again today`); }
      catch (x) { toast(x.message); if (btn.isConnected) btn.disabled = false; }
    };
  });
}
function unitList(ref, cur) {      // [[key, label]]: servings, grams when the food has per-100 g values, and the unit it was logged in
  const opts = [['serving', ref && ref.serving ? `serving (${ref.serving.label})` : 'serving']];
  if (!ref || ref.per100) opts.push(['g', 'grams']);
  if (cur && !opts.some(([k]) => k === cur)) opts.push([cur, cur]);
  return opts;
}
function unitOptions(ref, cur) {
  return unitList(ref, cur).map(([k, n]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
const macroInputs = (e = {}) => `<div class="mac4">
  <label>Calories<input name="kcal" inputmode="decimal" value="${e.kcal != null ? r1(e.kcal) : ''}"></label>
  <label>Protein g<input name="protein_g" inputmode="decimal" value="${e.protein_g != null ? r1(e.protein_g) : ''}"></label>
  <label>Carbs g<input name="carbs_g" inputmode="decimal" value="${e.carbs_g != null ? r1(e.carbs_g) : ''}"></label>
  <label>Fat g<input name="fat_g" inputmode="decimal" value="${e.fat_g != null ? r1(e.fat_g) : ''}"></label>
  <label>Fiber g<input name="fiber_g" inputmode="decimal" value="${e.fiber_g != null ? r1(e.fiber_g) : ''}"></label></div>${extraInputs(e)}`;

// ---------- add: usuals / saved dishes / search / quick ----------
function guardFoodSheet(body,close,owner){const guard=e=>{if(owner===readOwner())return;e.preventDefault();e.stopImmediatePropagation();close();toast('The account changed. Open this again.');};body.addEventListener('click',guard,true);body.addEventListener('submit',guard,true);body.addEventListener('submit',e=>{for(const input of $$('.extra-inputs input',body)){const value=input.value.trim();if(value!==''&&(!Number.isFinite(Number(value.replace(',','.')))||Number(value.replace(',','.'))<0)){e.preventDefault();e.stopImmediatePropagation();input.focus();toast('Enter a positive number or zero, or leave the nutrient blank.');return;}}},true);
  if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>{if(!body.isConnected){observer.disconnect();return;}if(owner!==readOwner()){observer.disconnect();close();}});observer.observe(root,{childList:true,subtree:true});}
}
function addSheet(day, meal, find = '', tab = find ? 'search' : 'usuals') {
  const owner=readOwner();
  // One suggestions list inside Add food; meal cards show only what was actually logged.
  sheet('Add food', `<div class="where"><span class="muted">Adding to</span>
      <span class="pill-sel"><select id="as-meal" aria-label="Meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === meal ? ' selected' : ''}>${n}</option>`).join('')}</select>${svg('chev')}</span>
      <span class="pill-sel daypick">${svg('calendar')}<span id="as-dayl">${esc(dayLabel(day))}</span><input id="as-day" type="date" value="${esc(day)}" aria-label="Day"></span></div>
    <div class="ways food-ways"><button class="way" id="as-photo">${svg('comment')}<b>Describe, Snap or Scan</b></button>
      <button class="way" id="as-dish">${svg('pot')}<b>Create a Recipe</b></button></div>
    <div class="seg wide" role="tablist">${[['usuals', 'Your usuals'], ['saved', 'My Recipes'], ['search', 'Search'], ['quick', 'Quick']]
    .map(([k, n], i) => `<button data-t="${k}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
    <div id="as-body"></div>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const dp = $('#as-day', b);     // a short label ("Today", "Sat, Oct 10") over the native picker: the full date field didn't fit
    dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* the browser opens its own picker */ } };
    dp.onchange = () => { if (dp.value) $('#as-dayl', b).textContent = dayLabel(dp.value); };
    const body = $('#as-body', b);
    const where = () => ({day: $('#as-day', b).value, meal: $('#as-meal', b).value});
    const tabs = {search: tSearch, usuals: tUsuals, saved: tSaved, quick: tQuick};
    const show = (k) => { $$('[data-t]', b).forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === k)); tabs[k](body, where, close); };
    $$('[data-t]', b).forEach((x) => x.onclick = () => show(x.dataset.t));
    const photo = $('#as-photo', b); if (photo) photo.onclick = () => {   // saved-meal lookup is local; model estimates separately require access and consent
      const w = where(); close();
      describeSheet(w.day, w.meal);
    };
    $('#as-dish', b).onclick = (e) => { close(); newDish(e.currentTarget); };     // a saved dish is logged from Saved Dishes
    show(tab);
    if (find) { const q = $('#as-body input[type=search]', b); if (q) { q.value = find; q.oninput(); } }
  });
}
const foodRow = (f, i) => `<button class="fe" data-i="${i}"><div><b>${esc(f.name)}</b><small class="muted">${esc([f.brand, f.serving && f.serving.label, f.source === 'usda' ? 'USDA' : f.source === 'off' ? 'Open Food Facts' : f.origin==='ai'?'AI estimate'+(f.origin_edited?' · Edited':''):f.origin==='label'?'Nutrition label':f.source === 'custom' ? 'My food' : ''].filter(Boolean).join(' · '))}</small></div>
  <div class="r"><b class="num">${r0(f.per_serving ? f.per_serving.kcal : f.per100 && f.serving ? f.per100.kcal * (f.serving.g || 100) / 100 : f.kcal)}</b><small class="muted">kcal</small></div></button>`;
function tSearch(body, where, close) {
  body.innerHTML = `<form id="ts-f" role="search"><input type="search" name="q" placeholder="Search foods, brands…" aria-label="Search foods and brands" autocomplete="off" enterkeyhint="search"></form><div id="ts-r" class="results"><p class="small muted">Your own foods and recent items come first, then USDA and Open Food Facts.</p></div>`;
  const inp = $('input', body), out = $('#ts-r', body); softFocus(inp);
  let timer, seq = 0, all = [];
  const draw = (groups) => {
    all = []; let html = '';
    for (const [title, list] of groups) if (list.length) { html += `<h3 class="ghead">${title}</h3>`; for (const f of list) { html += foodRow(f, all.length); all.push(f); } }
    out.innerHTML = html || '<p class="small muted">No matches yet…</p>';
    $$('[data-i]', out).forEach((x) => x.onclick = () => amountSheet(all[+x.dataset.i], where(), close));
  };
  const run = async (q) => {
    const my = ++seq; if (!inp.isConnected) return; out.innerHTML = ''; if (q.length < 2) { out.innerHTML = ''; return; }
    try {   // fast local results first, then the databases
      const local = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=mine`);
      if (my !== seq || !inp.isConnected) return;
      const recent = local.recent.map(recentToFood);
      draw([['My foods', local.mine], ['Recent', recent]]);
      out.insertAdjacentHTML('beforeend', '<p class="small muted" id="ts-load">Searching food databases…</p>');
      const ext = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=off,usda`);
      if (my !== seq || !inp.isConnected) return;
      draw([['My foods', local.mine], ['Recent', recent], ['USDA', ext.usda], ['Open Food Facts', ext.off]]);
    } catch (x) { if (my === seq) {
      $('#ts-load', out)?.remove();
      out.insertAdjacentHTML('beforeend', `<p class="err" role="alert">${esc(x.message)}</p><button class="ghost wide" id="ts-retry">Retry search</button>`);
      $('#ts-retry', out).onclick = () => { out.innerHTML = ''; run(inp.value.trim()); };
    } }
  };
  inp.oninput = () => {
    clearTimeout(timer); ++seq; all = [];
    const q = inp.value.trim();
    out.innerHTML = q.length < 2 ? '' : '<p class="small muted" role="status">Searching…</p>';
    timer = setTimeout(() => run(q), 300);
  };
  $('#ts-f', body).onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); run(inp.value.trim()); inp.blur(); };
}
const recentToFood = (r) => (r.ref ? {...r.ref, name: r.name, brand: r.brand, _last: r} :
  {source: 'recent', name: r.name, brand: r.brand, per_serving: {kcal: r.kcal / r.amount, protein_g: r.protein_g / r.amount, carbs_g: r.carbs_g / r.amount, fat_g: r.fat_g / r.amount, fiber_g: r.fiber_g == null ? null : r.fiber_g / r.amount},
   serving: {label: r.unit === 'serving' ? '1 serving' : `1 ${r.unit}`, g: null}, _last: r, _unit: r.unit});
async function tUsuals(body, where, close) {
  body.innerHTML = skel(1);
  try {
    const usual = await api('/api/food/usual');
    const foods = usual.map(recentToFood);
    const quick = (f, i) => `<div class="usual">${foodRow(f, i)}<button class="icon-btn qadd" data-q="${i}" aria-label="Log ${esc(f.name)} now (${esc(fmtAmount(f._last))})">${svg('plus')}</button></div>`;
    body.innerHTML = usual.length ? `<p class="small muted">+ logs your usual amount</p><div class="results">${usual.map((_, i) => quick(foods[i], i)).join('')}</div>`
      : '<p class="small muted">Foods you log often will appear here. Search to add something new.</p><div class="btncol"><button class="ghost" id="tr-search">Search for a food</button></div>';
    const ts = $('#tr-search', body); if (ts) ts.onclick = () => $('.sheet [data-t=search]').click();
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close));
    $$('[data-q]', body).forEach((x) => x.onclick = async () => {
      const f = foods[+x.dataset.q], l = f._last, w = where(); x.disabled = true;
      try { const result=await addEntries([{...w, name: l.name, brand: l.brand, amount: l.amount, unit: l.unit, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g,
        fat_g: l.fat_g, fiber_g: l.fiber_g, source: 'recent', ref: l.ref || null}]); close(); toast(result.queued?'Saved on this phone · waiting to send':`Added ${l.name} to ${MEAL_NAMES[w.meal].toLowerCase()}`); }
      catch (e) { toast(e.message); x.disabled = false; }
    });
  } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
// Saved Dishes (2026-10-12; was two tabs, Mine and Meals): your dishes, dishes friends shared, saved meals and your own
// foods in one list. Each opens a sheet to say how much before it's logged (dishes: dishLogSheet in cook.js).
async function tSaved(body, where, close) {
  body.innerHTML = skel(1);
  try {
    const [dishes, meals, foods] = await Promise.all([api('/api/dishes').catch(() => []), api('/api/food/meals'), api('/api/food/foods')]);
    const mine = dishes.filter((d) => d.mine !== false), theirs = dishes.filter((d) => d.mine === false);
    const row = (kind, i, name, sub, kcal, unit = 'kcal') => `<button class="fe" data-${kind}="${i}"><div><b>${esc(name)}</b><small class="muted">${esc(sub)}</small></div>
      <div class="r"><b class="num">${r0(kcal)}</b><small class="muted">${unit}</small></div></button>`;
    const dishRow = (d, i) => row('dish', i, d.name, d.mine === false ? `From ${d.owner.name.split(' ')[0]}` : d.items.length ? listOf(d.items.map((x) => x.name)) : 'Total typed in',
      (d.serving === 'one' && d.recipe_source?.servings ? d.per_serving.kcal : d.totals.kcal), d.serving === 'one' ? 'kcal a serving' : 'kcal total');
    body.innerHTML = `<p class="small muted">Tap a recipe to log a portion. Use Edit to change its ingredients, weight or nutrition for next time.</p><div class="btncol recipe-library-actions"><button class="ghost wide" id="tm-link">Recipe from a link</button><button class="linkbtn" id="tm-dish">+ Create a Recipe</button></div>
      ${mine.length ? `<h3 class="ghead">Your recipes</h3><div class="results">${mine.map((d) => `<div class="meal-library-row">${dishRow(d, dishes.indexOf(d))}<button type="button" class="ghost sm" data-edit-meal="${d.id}" aria-label="Edit ${esc(d.name)}">${svg('edit')} Edit</button></div>`).join('')}</div>` : '<p class="small muted">No saved recipes yet. Create one below, with or without AI.</p>'}
      ${theirs.length ? `<h3 class="ghead">From friends</h3><div class="results">${theirs.map((d) => dishRow(d, dishes.indexOf(d))).join('')}</div>` : ''}
      ${meals.length ? `<h3 class="ghead">Saved combinations</h3><div class="results">${meals.map((m, i) => row('meal', i, m.name, listOf(m.items.map((x) => x.name)), m.totals.kcal)).join('')}</div>` : ''}
      <h3 class="ghead ghead-act">My foods<button class="linkbtn" id="tm-food">New food</button></h3><p class="small muted">Tap a food to log it, or choose Edit to change its saved nutrition.</p><div class="results">${foods.map((f,i) => `<div class="meal-library-row">${foodRow(f,i)}<button class="ghost sm" data-edit-food="${i}">Edit</button></div>`).join('')}</div>
      <div class="btncol"><button class="ghost wide" id="tm-describe">Describe what you ate</button></div>
`;
    const again = () => tSaved(body, where, close);
    $('#tm-describe', body).onclick = () => { const w = where(); close(); describeSheet(w.day, w.meal); };
    $$('[data-edit-food]', body).forEach(x => x.onclick = () => foodEditor(foods[+x.dataset.editFood], again));
    $('#tm-food', body).onclick = () => foodEditor(null, again);
    $('#tm-link', body).onclick = () => { close(); go('/food/recipe-link'); };
    $('#tm-dish', body).onclick = (e) => { close(); newDish(e.currentTarget); };
    $$('[data-edit-meal]', body).forEach((b) => b.onclick = () => { close(); go('/food/cook/' + b.dataset.editMeal); });
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close, () => foodEditor(foods[+x.dataset.i], again)));
    $$('[data-dish]', body).forEach((x) => x.onclick = () => dishLogSheet(dishes[+x.dataset.dish], where(), (editing) => close()));
    $$('[data-meal]', body).forEach((x) => x.onclick = () => savedSheet(meals[+x.dataset.meal], where(), close, again));
  } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
route(/^\/food\/meals$/, 'food', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>My Recipes</h1><div id="meal-library"></div>`;
  wireBack(el, '/food');
  await tSaved($('#meal-library', el), () => ({day: isoDay(new Date()), meal: guessMeal()}), () => {});
});
// How much of a saved meal: grams (when every food in it is in grams) or servings. A saved meal is 1 serving as saved
// ("½" or "2" scale every food in it).
function savedSheet(m, w, closeParent, after) {
  const T = m.totals, weight = m.items.every((it) => it.unit === 'g') ? m.items.reduce((a, it) => a + it.amount, 0) : null;
  sheet(m.name, `<form class="form" id="sv">
    <p class="small muted">${esc(m.items.map((x) => x.name).join(', '))}</p>
    ${weight ? `<label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="${Math.round(weight)}" aria-label="Your portion in grams"><span>g</span></span></label>` : ''}
    <div class="share-line">${weight ? '<span class="muted">or</span>' : ''}<input name="n" inputmode="decimal" value="1" aria-label="Servings"><span>servings</span></div>
    <div class="portion-out" aria-live="polite"></div>
    <div class="actions"><button type="button" class="ghost danger" id="sv-del">Delete</button>${aiCan('coach') || m.review ? `<button type="button" class="ghost" id="sv-ai" aria-label="Kit’s take on ${esc(m.name)}">${svg('sparkle')}</button>` : ''}<span class="spacer"></span>
      <button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}</button></div></form>`, (b, close) => {
    const f = $('#sv', b), out = $('.portion-out', f), num = (x) => (x ? +x.value.replace(',', '.') : 0);
    let mode = 'n';
    const factor = () => {      // the share of the saved meal being logged
      if (mode === 'g') { const g = num(f.g); return g > 0 && weight ? g / weight : null; }
      const n = num(f.n); return n > 0 ? n : null;
    };
    const show = () => { const k = factor(); out.innerHTML = k ? nutGrid(Object.fromEntries(['kcal', ...MACROS.map((x) => x[0])].map((x) => [x, (T[x] || 0) * k]))) : ''; };
    const byN = () => { mode = 'n'; const k = factor(); if (f.g) f.g.value = k ? Math.round(weight * k) : ''; show(); };
    if (f.g) f.g.oninput = () => { mode = 'g'; show(); };
    f.n.oninput = byN; byN();
    f.onsubmit = async (e) => {
      e.preventDefault(); const k = factor();
      if (!k) { toast('How many servings?'); return; }
      const sc = (v) => (v == null ? null : v * k);
      const items = m.items.map((it) => ({...it, ...w, amount: it.amount * k, kcal: sc(it.kcal), protein_g: sc(it.protein_g), carbs_g: sc(it.carbs_g), fat_g: sc(it.fat_g), fiber_g: sc(it.fiber_g), ref: it.ref || null, source: 'meal'}));
      try { await addEntries(items); close(); closeParent(); toast(`Added ${m.name}`); } catch (x) { toast(x.message); }
    };
    $('#sv-del', b).onclick = async () => {
      if (!confirm(`Delete the saved meal ${m.name}?`)) return;
      try { await api(`/api/food/meals/${m.id}`, {method: 'DELETE'}); close(); toast('Deleted'); after(); } catch (x) { toast(x.message); }
    };
    const ai = $('#sv-ai', b); if (ai) ai.onclick = () => mealCoach(m);
  });
}
function tQuick(body, where, close) {
  body.innerHTML = `<form class="form" id="tq"><label>Name<input name="name" placeholder="e.g. Restaurant salad" maxlength="200"></label>${macroInputs()}
    <p class="small muted">Enter calories, or all three macros to work them out. Other blank nutrients stay unknown.</p>
    <div class="actions"><button class="primary">Add</button></div></form>`;
  guardFoodSheet(body,close,readOwner());const f = $('#tq', body); softFocus(f.name);
  const clientId=newId();
  f.onsubmit = async (e) => {
    e.preventDefault();const button=$('button.primary',f);if(button.disabled)return;
    const missing=['protein_g','carbs_g','fat_g','fiber_g'].filter(k=>!f[k].value.trim());
    if(!f.kcal.value.trim()&&missing.some(k=>k!=='fiber_g')){toast('Enter calories, or fill in protein, carbs and fat.');return;}
    const n = (x) => (x.value.trim() === '' ? 0 : parseFloat(x.value) || 0);
    const it = {...extraFormValues(f),client_id:clientId,ref:{origin:'manual',unknown_nutrients:missing},name: f.name.value.trim() || 'Quick add', amount: 1, unit: 'serving', protein_g: n(f.protein_g), carbs_g: n(f.carbs_g), fat_g: n(f.fat_g), fiber_g: f.fiber_g.value ? n(f.fiber_g) : null, source: 'quick'};
    it.kcal = f.kcal.value.trim() ? n(f.kcal) : Math.round(it.protein_g * 4 + it.carbs_g * 4 + it.fat_g * 9);
    if (!it.kcal && !it.protein_g) { toast('Enter calories or macros'); return; }
    button.disabled=true;
    try { const result=await addEntries([{...it, ...where()}]); close(); toast(result.queued?'Saved on this phone · waiting to send':`Added ${it.name}`); } catch (x) { toast(x.message);button.disabled=false; }
  };
}

// choose an amount for a food (live numbers), then add
// How much (2026-10-12, Ben: the unit dropdown was big and odd, "Amount" unclear, a scanned product's name tiny): the
// product's full name as the title (brand + name), its serving size underneath, "Servings" with - and +, and small
// buttons for the other units (grams) when the food has them.
function amountSheet(f, w, closeParent, onEditFood) {
  const owner=readOwner();
  const last = f._last;
  const startUnit = last ? last.unit : f._unit || 'serving', startAmt = last ? last.amount : 1;
  const nm = f.name && f.name !== 'Unnamed product' ? f.name : '', br = f.brand || '';
  const title = br && nm && !nm.toLowerCase().includes(br.toLowerCase().split(',')[0].trim()) ? `${br.split(',')[0].trim()} ${nm}` : nm || br || 'Food';
  // a recent food without a database entry only knows the unit it was logged in: no made-up serving size, no other units
  const plain = f._unit && !f.per100;
  const sub = !plain && f.serving && f.serving.label ? `1 serving = ${f.serving.label}${f.serving.g && !/\d\s*g\b/.test(f.serving.label) ? ` (${r1(f.serving.g)} g)` : ''}` : '';
  const units = plain ? [startUnit] : unitList(f.per100 || f.per_serving ? f : null, startUnit).map(([k]) => k);
  const uName = (u) => (u === 'serving' ? 'Servings' : u === 'g' ? 'Grams' : u.charAt(0).toUpperCase() + u.slice(1));
  sheet(title, `<form class="form" id="am">
    ${sub ? `<p class="am-sub">${esc(sub)}</p>` : ''}${nutrientSource(f)?`<p class="small muted">Source: ${esc(nutrientSource(f))}</p>`:''}
    <div class="am-amt"><button type="button" class="icon-btn" data-step="-1" aria-label="Less">${svg('minus')}</button>
      <label><input name="amount" inputmode="decimal" value="${r1(startAmt)}" aria-describedby="am-u"><small id="am-u">${esc(uName(startUnit))}</small></label>
      <button type="button" class="icon-btn" data-step="1" aria-label="More">${svg('plus')}</button></div>
    <input type="hidden" name="unit" value="${esc(startUnit)}">
    ${units.length > 1 ? `<div class="seg wide am-units" role="group" aria-label="Unit">${units.map((u) => `<button type="button" data-unit="${esc(u)}" aria-pressed="${u === startUnit}">${esc(uName(u))}</button>`).join('')}</div>` : ''}
    <div class="macpreview" id="am-p"></div>
    <div class="actions">${onEditFood ? '<button type="button" class="ghost" id="am-edit">Edit food</button><span class="spacer"></span>' : ''}<button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const fm = $('#am', b);
    const calc = () => { const a = parseFloat(fm.amount.value) || 0; const v = f.per100 || f.per_serving ? scaleFood(f, a, fm.unit.value) : Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,null]));
      $('#am-p', b).innerHTML = `<div><b class="num">${r0(v.kcal)}</b><small>kcal</small></div>${MACROS.map(([k, , s]) => `<div><b class="num">${v[k]==null?'Unknown':r1(v[k])}</b><small>${s === 'P' ? 'protein' : s === 'C' ? 'carbs' : 'fat'} g</small></div>`).join('')}${extraFood(v)}`; return v; };
    fm.amount.oninput = calc; calc();
    $$('[data-step]', fm).forEach((x) => x.onclick = () => {      // ½ a serving at a time, or 10 g
      const st = fm.unit.value === 'g' ? 10 : 0.5, a = (parseFloat(fm.amount.value) || 0) + st * +x.dataset.step;
      if (a > 0) { fm.amount.value = r1(a); calc(); }     // minus never goes to zero (or up)
    });
    $$('[data-unit]', fm).forEach((x) => x.onclick = () => {
      const u = x.dataset.unit, was = fm.unit.value; if (u === was) return;
      const g1 = f.serving && f.serving.g, a = parseFloat(fm.amount.value) || 0;
      if (g1 && was === 'serving' && u === 'g') fm.amount.value = r1(a * g1);       // keep the same amount of food
      else if (g1 && was === 'g' && u === 'serving') fm.amount.value = r1(a / g1);
      else fm.amount.value = u === 'g' ? 100 : 1;
      fm.unit.value = u; $('#am-u', fm).textContent = uName(u);
      $$('[data-unit]', fm).forEach((y) => y.setAttribute('aria-pressed', String(y === x))); calc();
    });
    if (onEditFood) $('#am-edit', b).onclick = () => { close(); onEditFood(); };
    fm.onsubmit = async (e) => {
      e.preventDefault(); const a = parseFloat(fm.amount.value); if (!(a > 0)) { toast('Enter an amount'); return; }
      const v = calc();
      const ref = {origin:f.origin,origin_notes:f.origin_notes,origin_model:f.origin_model,origin_edited:f.origin_edited,origin_ref:f.origin_ref,unknown_nutrients:f.unknown_nutrients||f._last?.ref?.unknown_nutrients,source: f.source, id: f.id, per100: f.per100 || null, per_serving: f.per_serving || null, serving: f.serving || null};
      try { const result=await addEntries([{...w, name: nm || br || f.name, brand: f.brand || null, amount: a, unit: fm.unit.value, ...v, source: f.source === 'recent' ? 'recent' : f.source || 'search', ref}]);
        close(); closeParent(); toast(result.queued?'Saved on this phone · waiting to send':`Added ${title}`); } catch (x) { toast(x.message); }
    };
  });
}
function foodEditor(food, after) {
  const owner=readOwner();
  const ps = food && food.per_serving || {};
  sheet(food ? 'Edit my food' : 'New food', `${food?.origin==='ai'?`<p class="small">AI estimate${food.origin_edited?' · Edited':''}. ${esc(food.origin_notes||'Check the numbers and portion before using them.')}</p>`:''}<form class="form" id="fe">
    <label>Name<input name="name" required maxlength="200" value="${esc(food ? food.name : '')}"></label>
    <div class="two"><label>Brand<input name="brand" value="${esc(food && food.brand || '')}"></label><label>Barcode<input name="barcode" inputmode="numeric" value="${esc(food && food.barcode || '')}"></label></div>
    <div class="two"><label>Serving<input name="serving_label" value="${esc(food && food.serving ? food.serving.label : '1 serving')}"></label><label>Serving grams<input name="serving_g" inputmode="decimal" value="${food && food.serving && food.serving.g ? r1(food.serving.g) : ''}"></label></div>
    <p class="small muted">Nutrition per serving:</p>${macroInputs({...ps,source:food?.source,origin:food?.origin,origin_edited:food?.origin_edited})}
    <label class="check"><input type="checkbox" name="favorite"${food && food.favorite ? ' checked' : ''}> Favourite (shows first)</label>
    <div class="actions">${food ? '<button type="button" class="ghost danger" id="fe-del">Delete</button><span class="spacer"></span>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const f = $('#fe', b), n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {name: f.name.value.trim(), brand: f.brand.value.trim() || null, barcode: f.barcode.value.trim() || null, serving_label: f.serving_label.value.trim() || '1 serving',
        serving_g: n(f.serving_g), kcal: n(f.kcal) || 0, protein_g: n(f.protein_g) || 0, carbs_g: n(f.carbs_g) || 0, fat_g: n(f.fat_g) || 0, fiber_g: n(f.fiber_g), ...extraFormValues(f), favorite: f.favorite.checked};
      if (!body.kcal) body.kcal = Math.round(body.protein_g * 4 + body.carbs_g * 4 + body.fat_g * 9);
      try { await api(food ? `/api/food/foods/${food.id}` : '/api/food/foods', json(food ? 'PUT' : 'POST', body)); close(); toast('Food saved'); if (after) after(); } catch (x) { toast(x.message); }
    };
    if (food) $('#fe-del', b).onclick = async () => { if (!confirm(`Delete ${food.name}? Logged entries stay.`)) return; try { await api(`/api/food/foods/${food.id}`, {method: 'DELETE'}); close(); if (after) after(); } catch (x) { toast(x.message); } };
  });
}

// ---------- photo + description -> Gemini estimate (2026-10-09) ----------
// The photo is shrunk on the phone (max 1280 px JPEG), sent with the optional description, never stored.
async function shrinkPhoto(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
// Selection stays local until the explicit confirmation; one request covers all retained views.
async function reviewFoodPhotos(files,confirm,{label=false,recipe=false,active=()=>true}={}) {
  if (!files.length) return;
  if (files.length>6) { toast('Choose up to 6 photos at a time'); return; }
  let photos=[];
  try { for (const file of files) { if (file.size>20000000) throw Error('Choose photos under 20 MB each'); photos.push(await shrinkPhoto(file,1600)); if(!active())return; }
    if(photos.reduce((n,p)=>n+p.length,0)>10000000)throw Error('These photos are too large together. Choose fewer photos.');
  } catch(e) { if(active())toast(e.message||"A photo couldn't be opened"); return; }
  if(!active())return;
  sheet(recipe?'Review recipe screenshots':label?'Photos of one ingredient':'Review your food photos','<div id="photo-selection"></div>',(root,close)=>{
    const box=$('#photo-selection',root),draw=()=>{box.innerHTML='<p>'+(recipe?'Choose views of one recipe, including its ingredients and nutrition. Food AI will read them into a draft; check servings and numbers before saving.':label?'Use several views of the same package, including its nutrition panel. Add different ingredients separately.':'Use several views of one meal. Check the estimate so each food is counted once.')+'</p><p>Up to 6 photos. Photos stay on this screen until you continue.</p><div class="photo-selection">'+photos.map((p,i)=>`<div><img class="ql-img" src="${p}" alt="Selected photo ${i+1}"><button type="button" class="ghost" data-remove-photo="${i}" aria-label="Remove photo ${i+1}">Remove</button></div>`).join('')+'</div><button class="primary wide" id="photos-use" '+(!photos.length?'disabled':'')+'>'+(recipe?'Read recipe screenshots':label?'Read these photos':'Use these photos')+'</button>';
      $$('[data-remove-photo]',box).forEach(b=>b.onclick=()=>{photos.splice(+b.dataset.removePhoto,1);draw()});$('#photos-use',box).onclick=()=>{if(!active())return;close();confirm(photos.slice())};};draw();
  });
}
// Describe what you ate (2026-10-12; reworked 2026-10-15, Ben: logging food should be very little effort, in your own
// words, without leaning on AI). "2 eggs and toast for breakfast", "a bowl of the chili I made Sunday", then "make it
// 300 grams", "also a coffee" or "remove the toast". The server matches each food against your own saved meals, My
// foods and foods you've logged before, with no AI (meal_chat.py), so it works with AI turned off. New foods are looked
// up in the food databases in one request: a brand you named offers that brand's products to pick from; everyday foods
// go to the AI estimator automatically when you have AI access and consent, and without AI offer plain database matches.
// Add logs whatever is ready; anything still being worked out stays on the page.
function describeSheet(day, meal) {
  go(`/food/describe?d=${encodeURIComponent(day)}&meal=${encodeURIComponent(meal)}`);
}
route(/^\/food\/describe$/, 'food', (el) => {
  if(typeof FoodThread!=='undefined')return FoodThread.page(el);
  const q = new URLSearchParams(location.search), day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '') ? q.get('d') : isoDay(new Date());
  describePage(el, day, Object.hasOwn(MEAL_NAMES, q.get('meal')) ? q.get('meal') : guessMeal());
});
function describePage(b, day, meal) {
  const canEstimate = aiCan('food'), close = () => go(`/food?d=${encodeURIComponent($('#ql-day', b).value)}`);
  b.classList.add('food-describe');
  b.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>What did you eat?</h1><div class="where ql-where"><span class="muted">Adding to</span>
      <span class="pill-sel"><select id="ql-meal" aria-label="Meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === meal ? ' selected' : ''}>${n}</option>`).join('')}</select>${svg('chev')}</span>
      <span class="pill-sel daypick">${svg('calendar')}<span id="ql-dayl">${esc(dayLabel(day))}</span><input id="ql-day" type="date" value="${esc(day)}" aria-label="Day"></span></div>
    <div class="ql-capture-shortcuts" role="group" aria-label="Food capture"><button class="ghost" data-capture="snap">${svg('camera')}Snap</button><button class="ghost" data-capture="scan">${svg('barcode')}Scan</button><button class="ghost" data-capture="paste">${svg('plus')}Paste</button></div>
    <div class="cchat ql-chat" id="ql-chat" aria-live="polite"><p class="cmsg ai ql-tip">Say it like you’d tell a friend: <i>“2 eggs and toast”</i> or <i>“a bowl of the chili I made Sunday”</i>.</p></div>
    <div id="ql-items"></div>
    <form class="composer ql-composer" id="ql-f"><button type="button" class="icon-btn" id="ql-plus" aria-label="Snap, scan or search">${svg('plus')}</button>
      <input name="t" id="ql-t" placeholder="What did you eat?" aria-label="What you ate, in your own words" autocomplete="off" enterkeyhint="send" maxlength="400">
      <button class="icon-btn send" aria-label="Send">${svg('send')}</button></form>
    <input type="file" accept="image/*" multiple id="ql-file" hidden>`;
  wireBack(b, '/food');
  (() => {
    const owner = readOwner(), active = () => b.isConnected && readOwner() === owner;
    const chat = $('#ql-chat', b), box = $('#ql-items', b), f = $('#ql-f', b), file = $('#ql-file', b), input = $('#ql-t', b);
    const dp = $('#ql-day', b), dest = $('#ql-meal', b);
    input.focus();   // runs inside the tap that opened it, so iOS shows the keyboard at once
    // parts: the conversation as the server last returned it (it is stateless); items: what each part matched.
    // batches: foods sent to the AI together, with what was said about them and the estimates that came back.
    let parts = [], items = [], preview = null, batches = [], busy = false, photo = null, photoSaid = [], sent = null, open = null;
    const say = (html, who) => { $('.ql-tip', chat)?.remove(); chat.insertAdjacentHTML('beforeend', `<p class="cmsg ${who}">${html}</p>`); chat.lastElementChild.scrollIntoView({block: 'nearest'}); return chat.lastElementChild; };
    const setBusy = (on) => {
      busy = on; $$('button, input, select', b).forEach((el) => { if (!el.closest('.ql-row')) el.disabled = on; });
      const add = $('#ql-add', b); if (add && !on) add.disabled = !readyCount();     // nothing ready: Add stays off
    };
    dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* native picker */ } };
    dp.onchange = () => { if (dp.value) $('#ql-dayl', b).textContent = dayLabel(dp.value); sent = null; draw(); };
    dest.onchange = () => { sent = null; draw(); };
    $('#ql-plus', b).onclick = () => sheet('Add food', `<div class="btncol">${canEstimate ? '<button class="ghost" id="ql-snap">Snap a food photo</button>' + (navigator.clipboard?.read ? '<button class="ghost" id="ql-paste">Paste a screenshot</button>' : '') : '<p class="small muted">Food photo estimates are available with AI enabled in Me.</p>'}<button class="ghost" id="ql-scan">Scan a barcode</button><button class="ghost" id="ql-search">Search foods and brands</button></div>`, (menu, done) => {
      const snap = $('#ql-snap', menu); if (snap) snap.onclick = () => { done(); file.click(); };
      const paste = $('#ql-paste', menu); if (paste) paste.onclick = async () => {   // iPhone text boxes never offer Paste for a picture
        done(); let files = [];
        try { for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => x.startsWith('image/')); if (t) files.push(new File([await it.getType(t)], 'pasted', {type: t})); } } catch (e) { /* permission declined */ }
        if (files.length) usePhotos(files); else toast('Copy a picture or screenshot first, then paste it here');
      };
      $('#ql-scan', menu).onclick = () => { done(); scanSheet(dp.value, dest.value, product => amountSheet(product, {day: dp.value, meal: dest.value}, close)); };
      $('#ql-search', menu).onclick = () => { done(); addSheet(dp.value, dest.value, '', 'search'); };
    });
    $$('[data-capture]',b).forEach(button => button.onclick = () => {
      if (button.dataset.capture === 'paste' && (!navigator.clipboard?.read || !canEstimate)) { input.focus(); toast(canEstimate ? 'Paste text in the food box, or choose a picture with Snap' : 'Paste text in the food box. Photo estimates need AI enabled in Me.'); return; }
      $('#ql-plus',b).click(); const action = $('.sheet #ql-' + button.dataset.capture); if (action) action.click();
    });
    // photos, screenshots of a recipe or its nutrition facts: all go to the same estimate
    const usePhotos = async (files) => {
      if(busy||!active())return;
      await reviewFoodPhotos(files,images=>{if(!active())return;photo=images;photoSaid=[];say(images.map((p,i)=>`<img class="ql-img" src="${p}" alt="Your selected food photo ${i+1}">`).join(''),'me');input.placeholder='Add a few words, or tap send';},{active});
    };
    file.onchange = () => { const files=[...(file.files||[])]; file.value=''; usePhotos(files); };
    if (canEstimate) f.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); usePhotos(files); }
    });

    const unknown = () => items.filter((i) => i.status === 'unknown');
    const batchOf = (i) => batches.find((x) => x.idx.includes(i));
    const aiItems = () => batches.flatMap((x) => x.items || []).filter((x) => !x.removed);
    // still being worked out: a question to answer, a lookup or estimate in progress, or a product to pick
    const waiting = () => items.some((i) => i.status !== 'ready' && (i.status !== 'unknown' || batchOf(i.index)?.state !== 'done')) || batches.some((x) => x.photo && x.state === 'loading');
    const readyCount = () => items.filter((i) => i.status === 'ready').length + aiItems().length;
    const kcalOf = () => items.filter((i) => i.status === 'ready').reduce((s, i) => s + (i.totals.kcal || 0), 0) + aiItems().reduce((s, x) => s + (x.kcal || 0), 0);
    const savedDay = (iso) => (iso ? ` · saved ${dayLabel(iso)}` : '');
    const row = (i) => {
      if (i.status === 'ready') return `<div class="ql-row" data-row="${i.index}"><button class="ql-main" data-open="${i.index}" aria-expanded="${open === i.index}">
          <span class="grow"><b>${esc(i.name)}</b><small class="muted">${esc(i.amount)}${i.note ? ` · ${esc(i.note)}` : ''}${esc(savedDay(i.saved_day))}</small></span>
          <span class="r"><b class="num">${r0(i.totals.kcal)}</b><small class="muted">kcal</small></span></button>
          <button class="icon-btn ql-x" data-remove="${i.index}" aria-label="Remove ${esc(i.name)}">${svg('close')}</button>
          ${open === i.index ? `<div class="chips wrap ql-adjust"><button class="chip" data-scale="${i.index}" data-by="0.5">Half</button><button class="chip" data-scale="${i.index}" data-by="2">Double</button></div><p class="small muted ql-hint">Or type a new amount, like “make the ${esc(i.name.toLowerCase())} 300 grams”.</p>` : ''}</div>`;
      if (i.status === 'choose') return `<div class="ql-row ql-ask"><p class="small">${esc(i.message)}</p><div class="results ql-choices">${i.choices.map((c, n) => `<button class="fe" data-choose="${i.index}" data-n="${n}"><div><b>${esc(c.name)}</b><small class="muted">${esc(c.detail)}${esc(savedDay(c.saved_day))}${c.weight_g ? ` · ${r0(c.weight_g)} g total` : ''}</small></div></button>`).join('')}</div>${i.more ? '<p class="small muted">Showing the first 12. Say a longer name to narrow it down.</p>' : ''}${i.new_ok ? `<button class="ghost wide" data-new="${i.index}">No, “${esc(i.text)}” is something new</button>` : ''}</div>`;
      if (i.status === 'quantity') return `<div class="ql-row ql-ask"><p class="small"><b>${esc(i.name)}</b>${esc(savedDay(i.saved_day))}</p><p class="small muted">${esc(i.message)}</p>${i.options && i.options.length ? `<div class="chips wrap">${i.options.map((o, n) => `<button class="chip" data-amount="${i.index}" data-n="${n}">${esc(o.label)}</button>`).join('')}</div>` : ''}</div>`;
      const x = batchOf(i.index);   // not in your foods
      if (x && x.state === 'searching') return `<div class="ql-row ql-ask"><p class="small muted" role="status">Looking up “${esc(i.text)}”…</p></div>`;
      if (x && (x.state === 'products' || x.state === 'plain')) return `<div class="ql-row ql-ask"><p class="small">${x.state === 'products' ? `Which one is your “${esc(i.text)}”? Check the serving on your package.` : `Pick the closest match for “${esc(i.text)}”.`}</p><div class="results">${x.foods.map((f,n) => `<button class="fe" data-product="${i.index}" data-n="${n}"><div><b>${esc(f.name)}</b><small class="muted">${f.brand ? esc(f.brand) + ' · ' : ''}${f.source === 'usda' ? 'USDA' : 'Open Food Facts'}${f.serving?.label ? ' · ' + esc(f.serving.label) : ''}</small></div></button>`).join('')}</div><button class="ghost wide" data-search="${i.index}">Search instead</button>${canEstimate ? `<button class="ghost wide" data-retry-ai="${x.id}">Use an AI estimate instead</button>` : ''}</div>`;
      if (x && x.state === 'loading') return x.idx[0] === i.index ? `<div class="ql-row ql-ask"><p class="small muted">Estimating “${esc(x.idx.map((n) => parts[n].text).join(', '))}” with AI…</p></div>` : '';
      if (x && x.state === 'done') return x.idx[0] === i.index ? x.items.map((a, n) => a.removed ? '' : `<div class="ql-row" data-ai="${x.id}-${n}"><button class="ql-main" data-open="ai-${x.id}-${n}" aria-expanded="${open === `ai-${x.id}-${n}`}">
          <span class="grow"><b>${esc(a.name)}</b><small class="muted">${esc([a.amount, 'AI estimate'].filter(Boolean).join(' · '))}</small></span>
          <span class="r"><b class="num">${r0(a.kcal)}</b><small class="muted">kcal</small></span></button>
          <button class="icon-btn ql-x" data-unai="${x.id}-${n}" aria-label="Remove ${esc(a.name)}">${svg('close')}</button>
          ${open === `ai-${x.id}-${n}` ? `<div class="pnums">${[['kcal', 'kcal'], ['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat']].map(([k, l]) => `<label><small>${l}</small><input data-edit="${x.id}-${n}" name="${k}" inputmode="decimal" value="${a[k] == null ? '' : esc(String(Math.round(a[k] * 10) / 10))}" aria-label="${l}"></label>`).join('')}</div>` : ''}</div>`).join('') : '';
      return `<div class="ql-row ql-ask"><p class="small muted">${canEstimate ? esc(i.message) : `Not in your foods yet: “${esc(i.text)}”`}</p>${x && x.error ? `<p class="small err">${esc(x.error)}</p>` : ''}<div class="btncol">${x && x.error && x.state === 'missing' ? `<button class="ghost wide" data-retry-product="${x.id}">Look it up again</button>` : ''}${canEstimate && x ? `<button class="ghost wide" data-retry-ai="${x.id}">${x.state === 'error' ? 'Try the AI estimate again' : 'Estimate with AI'}</button>` : ''}<button class="ghost wide" data-search="${i.index}">Search for “${esc(i.text)}”</button></div></div>`;
    };
    const draw = () => {
      if (!active()) return;
      if (!items.length && !batches.length) { box.innerHTML = ''; return; }
      const ready = readyCount(), rest = waiting();
      // Add never waits for a lookup: it logs what's ready, and anything unfinished stays here
      const what = rest && ready ? `Add ${ready === 1 ? '1 food' : `${ready} foods`} to` : 'Add to';
      const label = sent ? `Try again: add to ${MEAL_NAMES[sent.meal]}, ${dayLabel(sent.day)}` : `${what} ${MEAL_NAMES[dest.value]}, ${dayLabel(dp.value)}`;
      box.innerHTML = `<div class="card list ql-list">${items.map(row).join('')}${photoRows()}</div>
        <div class="actions"><span class="muted small num">${ready ? `≈ ${r0(kcalOf())} kcal` : ''}</span><button class="primary" id="ql-add"${!ready ? ' disabled' : ''}>${esc(label)}</button></div>${ready && rest ? '<p class="small muted center ql-rest">The rest stay here until you finish them.</p>' : ''}<p class="err" id="ql-error" role="status"></p>`;
      wire();
    };
    // a photo estimate covers the whole meal: its rows follow the matched foods
    const photoRows = () => batches.filter((x) => x.photo).map((x) => (x.state === 'loading' ? '<div class="ql-row ql-ask"><p class="small muted">Estimating your photo with AI…</p></div>'
      : (x.items || []).map((a, n) => a.removed ? '' : `<div class="ql-row" data-ai="${x.id}-${n}"><button class="ql-main" data-open="ai-${x.id}-${n}"><span class="grow"><b>${esc(a.name)}</b><small class="muted">${esc([a.amount, 'AI estimate'].filter(Boolean).join(' · '))}</small></span><span class="r"><b class="num">${r0(a.kcal)}</b><small class="muted">kcal</small></span></button><button class="icon-btn ql-x" data-unai="${x.id}-${n}" aria-label="Remove ${esc(a.name)}">${svg('close')}</button>${open === `ai-${x.id}-${n}` ? `<div class="pnums">${[['kcal', 'kcal'], ['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat']].map(([k, l]) => `<label><small>${l}</small><input data-edit="${x.id}-${n}" name="${k}" inputmode="decimal" value="${a[k] == null ? '' : esc(String(Math.round(a[k] * 10) / 10))}" aria-label="${l}"></label>`).join('')}</div>` : ''}</div>`).join(''))).join('');
    const aiAt = (key) => { const [id, n] = key.split('-').map(Number); const x = batches.find((y) => y.id === id); return x && x.items[n]; };
    const wire = () => {
      $$('[data-open]', box).forEach((el) => el.onclick = () => { const k = el.dataset.open; open = open === (isNaN(+k) ? k : +k) ? null : (isNaN(+k) ? k : +k); draw(); });
      $$('[data-remove]', box).forEach((el) => el.onclick = () => { parts[+el.dataset.remove].removed = true; sent = null; resolve(null); });
      $$('[data-unai]', box).forEach((el) => el.onclick = () => { aiAt(el.dataset.unai).removed = true; sent = null; draw(); });
      $$('[data-edit]', box).forEach((el) => el.onchange = () => { const v = el.value.trim(); aiAt(el.dataset.edit)[el.name] = v === '' ? 0 : Math.max(0, parseFloat(v) || 0); sent = null; draw(); });
      $$('[data-new]', box).forEach((el) => el.onclick = () => { Object.assign(parts[+el.dataset.new], {new: true, pick: null}); resolve(null); });
      $$('[data-choose]', box).forEach((el) => el.onclick = () => { const i = items.find((x) => x.index === +el.dataset.choose), c = i.choices[+el.dataset.n]; parts[i.index].pick = {kind: c.kind, id: c.id}; resolve(null); });
      $$('[data-amount]', box).forEach((el) => el.onclick = () => { const i = items.find((x) => x.index === +el.dataset.amount); parts[i.index].portion = i.options[+el.dataset.n].portion; resolve(null); });
      $$('[data-scale]', box).forEach((el) => el.onclick = () => {
        const i = items.find((x) => x.index === +el.dataset.scale), by = +el.dataset.by, p = {...i.portion};
        for (const k of ['grams', 'count']) if (p[k] != null) p[k] = Math.round(p[k] * by * 1000) / 1000;
        if (p.share != null) { const s = p.share * by; if (s > 1) { delete p.share; p.count = s; } else p.share = s; }
        parts[i.index].portion = p; resolve(null);
      });
      $$('[data-search]', box).forEach((el) => el.onclick = () => { const w = {day: dp.value, meal: dest.value}; close(); addSheet(w.day, w.meal, items.find((x) => x.index === +el.dataset.search).text); });
      $$('[data-retry-product]', box).forEach(el => el.onclick = () => lookup([batches.find(y => y.id === +el.dataset.retryProduct)]));
      $$('[data-product]', box).forEach(el => el.onclick = () => {
        const i = +el.dataset.product, x = batchOf(i), f = {...x.foods[+el.dataset.n]};
        const portion = parts[i].portion || x.portion;
        if (portion?.grams && f.per100) f._last = {amount: portion.grams, unit: 'g'};
        else if (portion?.count && (!portion.unit || portion.unit === 'serving')) f._last = {amount: portion.count, unit: 'serving'};
        amountSheet(f, {day: dp.value, meal: dest.value}, () => {
          if (!active()) return;
          parts[i].removed = true; batches = batches.filter(y => y !== x);
          if (parts.every(p => p.removed)) close(); else resolve(null);
        });
      });
      $$('[data-retry-ai]', box).forEach((el) => el.onclick = () => estimate(batches.find((x) => x.id === +el.dataset.retryAi)));
      const add = $('#ql-add', box); if (add) add.onclick = addAll;
    };

    let batchSeq = 0;
    const estimate = async (x) => {   // only the words of foods that weren't found (or a photo) go to the AI service
      if (!active()) return;
      if (!canEstimate || !aiCan('food')) { x.state = 'missing'; return draw(); }   // AI was turned off meanwhile: offer Search
      x.opted = true; x.state = 'loading'; x.error = null; draw();
      try {
        const words = x.photo ? x.said : [x.idx.map((n) => parts[n].text).join(', '), ...x.said];
        const r = await api('/api/food/photo', json('POST', {...(Array.isArray(x.photo)?{images:x.photo}:{image:x.photo||null}), note: words.join('\n').slice(-2000) || null}));
        if (!active() || !batches.includes(x)) return;
        x.items = r.items.map((it) => ({...it, client_id: newId()})); x.state = 'done';
        if (!x.items.length) { x.state = 'error'; x.error = "The AI couldn't find food in that."; }
      } catch (e) { if (!active() || !batches.includes(x)) return; x.state = 'error'; x.error = e.message; }
      sent = null; draw();
    };
    // Every new food in one request. A brand you named: pick the product. Everyday foods: estimated together
    // with AI when you have it (no extra tap), or the closest plain database foods to pick from without it.
    const lookup = async (list) => {
      for (const x of list) Object.assign(x, {state: 'searching', error: null});
      draw();
      let res;
      try { res = (await api('/api/food/meals-chat/lookup', json('POST', {texts: list.map((x) => parts[x.idx[0]].text)}))).results; }
      catch (e) {
        if (!active()) return;
        list = list.filter((x) => batches.includes(x));
        if (canEstimate && list.length) return estimateTogether(list);   // the databases are down: AI can still help
        for (const x of list) Object.assign(x, {state: 'missing', error: e.message});
        return draw();
      }
      if (!active()) return;
      const everyday = [];
      list.forEach((x, n) => {
        const r = res[n];
        if (!batches.includes(x) || !r) return;
        x.portion = r.portion; x.foods = r.foods;
        if (r.kind === 'brand' && r.foods.length) x.state = 'products';
        else if (canEstimate) everyday.push(x);
        else x.state = r.foods.length ? 'plain' : 'missing';
      });
      if (everyday.length) return estimateTogether(everyday);
      draw();
    };
    const estimateTogether = (list) => {   // one AI request for several everyday foods
      batches = batches.filter((x) => !list.includes(x));
      const x = {id: ++batchSeq, idx: list.flatMap((y) => y.idx), said: [], state: 'loading'};
      batches.push(x); estimate(x);
    };
    const resolve = async (text, {quiet = false} = {}) => {
      if (busy || !active()) return;
      setBusy(true); const wait = text && !quiet ? say('<span class="dots"><i></i><i></i><i></i></span>', 'ai') : null;
      try {
        const r = await api('/api/food/meals-chat/resolve', json('POST', {say: text, parts}));
        if (!active()) return;
        if (r.status === 'clarify') {
          // nothing to change on our side: words about an AI-estimated food go to the AI as a correction
          const target = batches.find((x) => x.state === 'done' && !x.photo);
          if (text && target && canEstimate) { wait.remove(); target.said.push(text); setBusy(false); return estimate(target); }
          if (wait) wait.textContent = r.message; return;
        }
        if (r.meal) dest.value = r.meal;
        if (r.day && r.day <= isoDay(new Date())) { dp.value = r.day; $('#ql-dayl', b).textContent = dayLabel(r.day); }
        if (r.note === 'new') batches = [];
        parts = r.parts; items = r.items; preview = {issued: r.issued, client_id: r.client_id}; sent = null;
        // Drop removed foods; check newly unknown products before offering an explicit estimate.
        batches = batches.filter((x) => x.photo || x.idx.every((n) => !parts[n].removed && items.some((i) => i.index === n && i.status === 'unknown')));
        const fresh = unknown().map((i) => i.index).filter((n) => !batchOf(n));
        if (fresh.length) { const list = fresh.map((n) => ({id: ++batchSeq, idx: [n], said: []})); batches.push(...list); lookup(list); }
        // "make it two hot dogs" on an AI-estimated food: estimate it again with the correction
        const changed = !fresh.length && r.note === 'changed' && text && batches.find((x) => x.opted && !x.photo && x.idx.some((n) => parts[n].portion));
        if (changed) { changed.said.push(text); estimate(changed); }
        const named = fresh.map((n) => `“${parts[n].text}”`).join(', ');
        if (wait) wait.textContent = changed ? 'Updating the AI estimate.' : !fresh.length ? r.message : `${named} ${fresh.length === 1 ? 'isn’t' : 'aren’t'} in your foods yet, so I’m looking ${fresh.length === 1 ? 'it' : 'them'} up.`;
        draw();
      } catch (x) { if (active()) { if (wait) wait.textContent = x.message; if (text) input.value = text; } }
      finally { if (active()) setBusy(false); }
    };
    const addAll = async () => {
      if (busy || !active()) return;
      const err = $('#ql-error', box);
      // Freeze what was sent, so a lost answer retries the identical entries (each has its own id), even after a date edit.
      sent ||= {day: dp.value, meal: dest.value, done: false,
        confirm: items.filter((i) => i.status === 'ready').map((i) => ({kind: i.kind, id: i.id, portion: i.portion, expected: i.expected})),
        ai: aiItems().map((a) => ({day: dp.value, meal: dest.value, name: a.amount ? `${a.name} (${a.amount})` : a.name, amount: 1, unit: 'serving',
          kcal: a.kcal || 0, protein_g: a.protein_g || 0, carbs_g: a.carbs_g || 0, fat_g: a.fat_g || 0, fiber_g: a.fiber_g ?? null, source: 'photo', client_id: a.client_id})),
        issued: preview?.issued, client_id: preview?.client_id || newId()};
      setBusy(true); const btn = $('#ql-add', box); btn.textContent = 'Adding…'; err.textContent = '';
      try {
        if (sent.confirm.length && !sent.done) {
          await api('/api/food/meals-chat/confirm', json('POST', {items: sent.confirm, issued: sent.issued, client_id: sent.client_id, day: sent.day, meal: sent.meal, confirm: true}));
          sent.done = true;
        }
        if (sent.ai.length) await addEntries(sent.ai); else refresh();
        if (!active()) return;
        const n = sent.confirm.length + sent.ai.length, added = `Added ${n === 1 ? 'it' : n + ' foods'} to ${MEAL_NAMES[sent.meal].toLowerCase()}`;
        invalidate('/api/food/');
        if (!waiting()) { close(); toast(added); return; }
        // Some foods are still being worked out: drop what was just added and keep going with the rest
        for (const i of items) if (i.status === 'ready') parts[i.index].removed = true;
        for (const x of batches.filter((y) => y.state === 'done')) x.idx.forEach((k) => { parts[k].removed = true; });
        batches = batches.filter((y) => y.state !== 'done'); items = items.filter((i) => !parts[i.index].removed);
        sent = null; preview = null; say(esc(`${added}. The rest are below.`), 'ai'); setBusy(false);
        if (items.some((i) => i.status !== 'unknown')) await resolve(null); else draw();
      } catch (x) {
        if (!active()) return;
        if (x.status === 409 || x.status === 404 || x.status === 400) {   // something changed: show it fresh, nothing was added
          sent = null; setBusy(false); await resolve(null); $('#ql-error', box) && ($('#ql-error', box).textContent = x.message + ' I’ve updated it below.');
          return;
        }
        draw(); $('#ql-error', box).textContent = x.message;
      } finally { if (active()) setBusy(false); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (busy || !active()) return;
      const text = input.value.trim(); if (!text && !photo) { toast('Say what you had'); return; }
      if (text) say(esc(text), 'me');
      input.value = ''; input.placeholder = 'Change something, or add more';
      if (photo) {   // a photo goes to the AI estimator with what you said about it
        if (text) photoSaid.push(text);
        let x = batches.find((y) => y.photo === photo);
        if (!x) { x = {id: ++batchSeq, idx: [], photo, said: [], state: 'loading'}; batches.push(x); }
        x.said = photoSaid.slice(-5); return estimate(x);
      }
      await resolve(text);
    };
  })();
}
function reviewItems(box, list, {intro = '', add}) {
  const tot = list.reduce((s, it) => s + (it.kcal || 0), 0);
  const num = (k, lbl, v) => `<label><small>${lbl}</small><input name="${k}" inputmode="decimal" value="${v == null ? '' : esc(String(Math.round(v * 10) / 10))}" aria-label="${lbl}"></label>`;
  box.innerHTML = `${intro}${list.map((it, i) => `<div class="card pitem" data-i="${i}">
    <div class="prow"><input type="checkbox" checked aria-label="Include ${esc(it.name)}"><input class="pname" value="${esc(it.name)}" aria-label="Name"></div>
    <div class="pnums">${num('kcal', 'kcal', it.kcal)}${num('protein_g', 'Protein', it.protein_g)}${num('carbs_g', 'Carbs', it.carbs_g)}${num('fat_g', 'Fat', it.fat_g)}${num('fiber_g', 'Fiber', it.fiber_g)}</div></div>`).join('')}
    <div class="actions"><span class="muted small num">≈ ${r0(tot)} kcal total</span><button class="primary" id="rv-add">Add ${list.length > 1 ? list.length + ' items' : 'it'}</button></div>`;
  $('#rv-add', box).onclick = async () => {
    const n = (x) => (x.value.trim() === '' ? 0 : parseFloat(x.value) || 0);
    const items = $$('.pitem', box).filter((c) => $('input[type=checkbox]', c).checked).map((c) => ({name: $('.pname', c).value.trim() || 'Meal',
      amount: 1, unit: 'serving', kcal: n($('[name=kcal]', c)), protein_g: n($('[name=protein_g]', c)), carbs_g: n($('[name=carbs_g]', c)), fat_g: n($('[name=fat_g]', c)),
      fiber_g: $('[name=fiber_g]', c).value ? n($('[name=fiber_g]', c)) : null}));
    if (!items.length) return;
    try { await add(items); toast(`Added ${items.length} item${items.length > 1 ? 's' : ''}`); } catch (x) { toast(x.message); }
  };
}

// ---------- barcode ----------
// onFound (a dish's + menu, 2026-10-12): hand the product back instead of logging it
function scanSheet(day, meal, onFound, onCode) {
  let stop = () => {};
  const closeSheet = sheet('Scan a barcode', `<div class="scan"><video id="sc-v" playsinline muted></video><div class="scanbox"></div></div>
    <p class="small muted" id="sc-msg">Point the camera at the barcode.</p>
    <form class="wform" id="sc-f"><input name="code" inputmode="numeric" placeholder="or type the number" aria-label="Barcode number"><button class="ghost">Look up</button></form>`, async (b, close) => {
    const v = $('#sc-v', b), msg = $('#sc-msg', b);
    const found = async (code) => {
      stop(); if(onCode){close();onCode(String(code));return;} msg.textContent = `Found ${code}. Looking it up…`;
      try { const f = await api(`/api/food/barcode/${code}`); close(); if (onFound) onFound(f); else amountSheet(f, {day, meal}, () => {}); }
      catch (x) { msg.textContent = x.message; if (x.status === 404) { const go2 = confirm(`${x.message}. Create it now?`); if (go2) { close(); foodEditor({name: '', barcode: code, serving: {label: '1 serving'}}, null); } } }
    };
    $('#sc-f', b).onsubmit = (e) => { e.preventDefault(); const c = e.target.code.value.replace(/\D/g, ''); if (c.length >= 6) found(c); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'No camera here. Type the number instead.'; return; }
    try {
      if ('BarcodeDetector' in window) {
        const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
        let on = true;
        stop = () => { on = false; stream.getTracks().forEach((t) => t.stop()); };
        if (!b.isConnected) { stop(); return; }
        v.srcObject = stream; await v.play();
        const det = new BarcodeDetector({formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']});
        const tick = async () => { if (!on) return; try { const r = await det.detect(v); if (r.length) { found(r[0].rawValue); return; } } catch (e) { /* frame not ready */ } setTimeout(tick, 200); };
        tick();
      } else {   // iPhone Safari: no BarcodeDetector -> ZXing (loaded only now)
        await new Promise((res, rej) => { if (window.ZXing) return res(); const s = document.createElement('script'); s.src = '/static/vendor/zxing.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
        const reader = new ZXing.BrowserMultiFormatReader();
        stop = () => { try { reader.reset(); } catch (e) { /* */ } };
        if (!b.isConnected) { stop(); return; }
        await reader.decodeFromVideoDevice(null, v, (res) => { if (res) found(res.getText()); });
      }
    } catch (e) { stop(); if (b.isConnected) msg.textContent = 'Camera unavailable. Allow camera access, or type the number.'; }
  });
  // stop the camera when the sheet closes
  const obs = new MutationObserver(() => { if (!$('#sc-v')) { stop(); obs.disconnect(); } });
  obs.observe(document.body, {childList: true});
}

// ---------- targets ----------
function goalSheet(D) {
  const G = D.goal || {}, label = dayLabel(D.day);
  sheet(`Calorie goal · ${label}`, `<form class="form" id="dg"><label>Goal for ${esc(/^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : label)} (kcal)<input name="k" inputmode="numeric" value="${esc(G.kcal != null ? r0(G.kcal).replace(/,/g, '') : '')}" placeholder="e.g. 2000" enterkeyhint="done"></label>
    <p class="small muted">${G.default ? `Your usual daily target is ${r0(G.default)}${G.extra ? `; ${label === 'Today' ? "today's" : "this day's"} training adds ${r0(G.extra)}` : ''}. A goal set here applies to this day only.` : 'You have no usual daily target yet - set one under Daily targets.'}</p>
    <div class="actions">${G.custom != null && G.default ? `<button type="button" class="ghost" id="dg-reset">Use usual target</button>` : ''}<button class="primary">Save</button></div>
    <button type="button" class="linkbtn" id="dg-daily">Change your usual daily target</button></form>`, (b, close) => {
    const f = $('#dg', b); f.k.focus(); f.k.select();
    const save = async (kcal) => { try { await api('/api/food/day-goal', json('PUT', {day: D.day, kcal})); close(); refresh(); toast(kcal == null ? 'Back to your usual target' : `Goal for ${label.toLowerCase()}: ${r0(kcal)} kcal`); } catch (x) { toast(x.message); } };
    f.onsubmit = (e) => { e.preventDefault(); const v = parseFloat(f.k.value.replace(/,/g, '')); if (!(v > 0)) { toast('Enter a number of calories'); return; } save(v); };
    const r = $('#dg-reset', b); if (r) r.onclick = () => save(null);
    $('#dg-daily', b).onclick = () => { close(); targetsSheet(); };
  });
}
function targetsSheet() {
  const m = App.me,owner=readOwner();
  sheet('Daily targets', `<p class="small"><a href="/food/setup" id="tg-help">Help me choose targets</a></p><form class="form" id="tg"><div class="mac4">
    <label>Calories<input name="kcal_target" inputmode="numeric" value="${esc(m.kcal_target || '')}"></label>
    <label>Protein g<input name="protein_target" inputmode="numeric" value="${esc(m.protein_target || '')}"></label>
    <label>Carbs g<input name="carbs_target" inputmode="numeric" value="${esc(m.carbs_target || '')}"></label>
    <label>Fat g<input name="fat_target" inputmode="numeric" value="${esc(m.fat_target || '')}"></label>
    <label>Fiber g<input name="fiber_target" inputmode="numeric" value="${esc(m.fiber_target || '')}"></label></div>
    ${extraInputs(m,true)}<p class="small muted" id="tg-sum"></p><div class="actions"><button class="primary">Save targets</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    $('#tg-help', b).onclick = () => close();
    const f = $('#tg', b), n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
    const sum = () => { const p = n(f.protein_target) || 0, c = n(f.carbs_target) || 0, fat = n(f.fat_target) || 0, k = p * 4 + c * 4 + fat * 9;
      $('#tg-sum', b).textContent = k ? `Macros add up to ${Math.round(k)} kcal${n(f.kcal_target) ? ` (target ${n(f.kcal_target)})` : ''}.` : ''; };
    f.oninput = sum; sum();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {kcal_target: n(f.kcal_target), protein_target: n(f.protein_target), carbs_target: n(f.carbs_target), fat_target: n(f.fat_target), fiber_target: n(f.fiber_target),...extraFormValues(f,true)};
      try { await api('/api/food/targets', json('PUT', body)); if(owner!==readOwner())return;Object.assign(App.me, body); close(); refresh(); toast('Targets saved'); } catch (x) { toast(x.message); }
    };
  });
}

// ---------- weight trend + food trends ----------
// the weigh-ins and the trend (2026-10-12: part of Nutrition > Weight, under the box to log one)
function weightHistory(box) {
  load('/api/food/weights?days=365', (W) => {
    if (!box.isConnected) return;
    const pts = W.points, wt = (kg) => `${U.weight(kg)} ${imp() ? 'lb' : 'kg'}`;
    box.innerHTML = pts.length ? `<div class="card"><div class="bigstat">${stat('Trend', W.trend_kg ? U.weight(W.trend_kg) : '–', imp() ? 'lb' : 'kg')}${stat('Per week', W.rate_kg_per_week == null ? '–' : (W.rate_kg_per_week > 0 ? '+' : '') + U.weight(W.rate_kg_per_week), imp() ? 'lb' : 'kg')}</div>
        <div id="w-chart"></div><p class="small muted">The trend smooths out day-to-day water swings; it's the number to watch.</p></div>
      <div class="card"><h2>Weigh-ins</h2>${[...pts].reverse().slice(0, 60).map((p) => `<div class="row"><span>${esc(new Date(p.day + 'T12:00').toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'}))}</span>
        <span class="num">${wt(p.kg)} <small class="muted">trend ${U.weight(p.trend)}</small> <button class="linkbtn danger" data-del="${p.day}" aria-label="Delete weigh-in">×</button></span></div>`).join('')}</div>`
      : '<div class="card empty"><b>No weigh-ins yet</b>Log one above. Kinetta smooths out the daily ups and downs into a trend.</div>';
    $$('[data-del]', box).forEach((b) => b.onclick = async () => { try { await api(`/api/food/weights/${b.dataset.del}`, {method: 'DELETE'}); invalidate('/api/food'); render(); } catch (x) { toast(x.message); } });
    if (pts.length) requestAnimationFrame(() => {
      const xs = pts.map((p) => new Date(p.day + 'T12:00') / 864e5);
      dotChart($('#w-chart', box), pts.map((p, i) => ({x: xs[i], y: imp() ? p.kg * 2.20462 : p.kg, id: i})), {yfmt: (v) => v.toFixed(1),
        trend: pts.length > 1 ? {start: imp() ? pts[0].trend * 2.20462 : pts[0].trend, end: imp() ? pts[pts.length - 1].trend * 2.20462 : pts[pts.length - 1].trend} : null});
    });
  });
}
route(/^\/food\/weight$/, 'food', async () => go('/food?view=weight', {replace: true}));   // old address
route(/^\/food\/trends$/, 'food', async () => go('/food?view=overview', {replace: true}));   // old address

// ---------- Add past days (2026-10-09): paste / CSV / one day -> preview -> save ----------
route(/^\/food\/import$/, 'food', async (el) => {
  const lb = imp(), wu = lb ? 'lb' : 'kg', today = isoDay(new Date());
  const wshow = (kg) => (kg == null ? '–' : (lb ? kg * 2.20462 : kg).toFixed(1));
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>Add past days</h1>
    <p class="muted">Bring in history from another app or a spreadsheet: weight, calories eaten, macros, and calories burned or your deficit. Imported burned numbers are used instead of this app's estimate for those days.</p>
    <div class="card"><h2>From a spreadsheet or another app</h2>
      <p class="small muted">First row = column names. Recognized: <b>Date</b>, <b>Weight</b> (${wu} unless the column says kg/lb), <b>Calories</b>, <b>Protein</b>, <b>Carbs</b>, <b>Fat</b>, <b>Fiber</b>, <b>Burned</b> (or Expenditure/TDEE), <b>Deficit</b>. Any order; other columns are ignored. Several rows per day (e.g. one per meal) are added up.</p>
      <pre class="eg">Date,Weight,Calories,Protein,Carbs,Fat,Deficit
2026-03-01,152.4,1650,110,160,55,450
2026-03-02,152.0,1720,115,170,58,380</pre>
      <form class="form" id="hi-f"><label>Paste rows (copy them from Excel, Google Sheets or Numbers)<textarea name="text" rows="6" placeholder="Date, Weight, Calories, ..."></textarea></label>
        <input type="file" id="hi-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden>
        <div class="actions"><button type="button" class="ghost" id="hi-pick">${svg('upload')} Choose a CSV file</button><button class="primary">Preview</button></div></form>
      <div id="hi-prev"></div></div>
    <div class="card"><h2>Enter day by day</h2>
      <p class="small muted">Type what you have for each day; leave the rest blank. Burned fills itself in from Eaten + Deficit. Clearing a box and saving removes that imported number.</p>
      <div class="gridbar"><label>From<input type="date" id="hg-start" max="${today}"></label><label class="gtog"><input type="checkbox" id="hg-mac"> Show macros</label></div>
      <div id="hg"></div></div>
    <div id="hi-sum"></div>`;
  wireBack(el, '/food?view=overview');
  const f = $('#hi-f', el), box = $('#hi-prev', el), file = $('#hi-file', el);
  $('#hi-pick', el).onclick = () => file.click();
  file.onchange = async () => { const fl = file.files && file.files[0]; if (!fl) return; if (fl.size > 2e6) { toast('That file is over 2 MB'); return; } f.text.value = await fl.text(); f.requestSubmit(); };
  const saveRows = async (rows) => {
    const r = await api('/api/food/history', json('POST', {rows}));
    invalidate('/api/food');
    toast(`Saved: ${r.weights} weights, ${r.days_food} days of food, ${r.burned} burned${r.skipped_food ? ` (${r.skipped_food} days kept your logged food)` : ''}`);
    drawSum();
    return r;
  };
  f.onsubmit = async (e) => {
    e.preventDefault(); if (!f.text.value.trim()) { toast('Paste some rows or choose a file'); return; }
    let P; try { P = await api('/api/food/history/preview', json('POST', {text: f.text.value})); } catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    if (!P.rows.length) { box.innerHTML = `<p class="err">No usable rows found.${P.problems.length ? ' ' + esc(P.problems[0]) : ''}</p>`; return; }
    const skip = P.rows.filter((r) => r.food_logged_here && r.eaten != null).length, repl = P.rows.filter((r) => r.weight_replaces).length;
    const first = P.rows[0].day, last = P.rows[P.rows.length - 1].day;
    box.innerHTML = `<div class="callout"><div>Found <b>${P.rows.length} days</b> (${esc(first)} to ${esc(last)}) with: ${P.columns.filter((c) => c !== 'date').map((c) => ({weight: 'weight', eaten: 'calories', protein_g: 'protein', carbs_g: 'carbs', fat_g: 'fat', fiber_g: 'fiber', burned: 'burned', deficit: 'deficit'}[c])).join(', ')}.
        ${skip ? `<br>${skip} day${skip > 1 ? 's' : ''} already have food logged here - those calories are skipped (your logged food stays).` : ''}${repl ? `<br>${repl} weigh-in${repl > 1 ? 's' : ''} will replace one already saved.` : ''}</div></div>
      ${P.problems.length ? `<details><summary>${P.problems.length} row${P.problems.length > 1 ? 's' : ''} left out</summary><ul class="small">${P.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
      <div class="tblwrap"><table class="tbl yrs"><thead><tr><th>Date</th><th class="r">Weight</th><th class="r">Eaten</th><th class="r">P</th><th class="r">C</th><th class="r">F</th><th class="r">Burned</th><th class="r">Deficit</th></tr></thead><tbody>
        ${P.rows.slice(-60).reverse().map((r) => `<tr${r.food_logged_here ? ' class="muted"' : ''}><td>${esc(r.day)}</td><td class="r num">${wshow(r.weight_kg)}</td><td class="r num">${r.eaten == null ? '–' : r0(r.eaten)}${r.food_logged_here && r.eaten != null ? '*' : ''}</td>
          <td class="r num">${r.protein_g == null ? '–' : r0(r.protein_g)}</td><td class="r num">${r.carbs_g == null ? '–' : r0(r.carbs_g)}</td><td class="r num">${r.fat_g == null ? '–' : r0(r.fat_g)}</td>
          <td class="r num">${r.burned == null ? '–' : r0(r.burned)}</td><td class="r num">${r.burned != null && r.eaten != null ? r0(r.burned - r.eaten) : '–'}</td></tr>`).join('')}</tbody></table></div>
      ${P.rows.length > 60 ? `<p class="small muted">Showing the latest 60 of ${P.rows.length} days.</p>` : ''}${skip ? '<p class="small muted">* skipped: food already logged in the app that day.</p>' : ''}
      <div class="actions"><button class="primary" id="hi-go">Import ${P.rows.length} days</button></div>`;
    $('#hi-go', box).onclick = async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Importing…';
      try { await saveRows(P.rows.map(({food_logged_here, weight_replaces, ...r}) => r)); box.innerHTML = '<p class="small">Imported. See it under Nutrition &gt; Overview (pick a longer time range, or a start date).</p>'; f.reset(); }
      catch (x) { toast(x.message); ev.target.disabled = false; ev.target.textContent = `Import ${P.rows.length} days`; }
    };
  };
  // ----- day-by-day grid -----
  const gs = $('#hg-start', el), gbox = $('#hg', el), mac = $('#hg-mac', el);
  let gdays = 7, orig = [];
  gs.value = addDays(today, -6);
  const num = (v) => (v == null || v === '' ? null : parseFloat(String(v).replace(/,/g, '')));
  const cell = (k, v, ph = '', dis = false) => `<input data-k="${k}" inputmode="decimal" value="${v == null ? '' : esc(String(v))}" placeholder="${esc(ph)}"${dis ? ' disabled' : ''} aria-label="${k}">`;
  const drawGrid = async () => {
    const start = gs.value || addDays(today, -6), end = addDays(start, gdays - 1) > today ? today : addDays(start, gdays - 1);
    gbox.innerHTML = skel(1);
    try { orig = await api(`/api/food/history/days?start=${start}&end=${end}`); } catch (x) { gbox.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    const m = mac.checked;
    gbox.innerHTML = `<div class="hgrid${m ? ' macros' : ''}"><div class="hrow hhead"><span>Day</span><span>Weight ${wu}</span><span>Eaten</span><span>Burned</span><span>Deficit</span>${m ? '<span>P g</span><span>C g</span><span>F g</span>' : ''}</div>
      ${orig.map((r, i) => `<div class="hrow" data-i="${i}"><span class="hday"><small>${esc(new Date(r.day + 'T12:00').toLocaleDateString([], {weekday: 'short'}))}</small>${esc(new Date(r.day + 'T12:00').toLocaleDateString([], {month: 'numeric', day: 'numeric'}))}</span>
        ${cell('w', r.weight_kg == null ? null : wshow(r.weight_kg))}
        ${r.eaten_in_app != null ? cell('e', r.eaten_in_app, '', true) : cell('e', r.eaten)}
        ${cell('b', r.burned)}${cell('d', r.burned != null && (r.eaten ?? r.eaten_in_app) != null ? Math.round(r.burned - (r.eaten ?? r.eaten_in_app)) : null)}
        ${m ? cell('p', r.protein_g == null ? null : Math.round(r.protein_g), '', r.eaten_in_app != null) + cell('c', r.carbs_g == null ? null : Math.round(r.carbs_g), '', r.eaten_in_app != null) + cell('f', r.fat_g == null ? null : Math.round(r.fat_g), '', r.eaten_in_app != null) : ''}</div>`).join('')}</div>
      ${orig.some((r) => r.eaten_in_app != null) ? '<p class="small muted">Grey calories = food logged in the app that day (kept as is).</p>' : ''}
      <div class="actions"><button class="ghost" id="hg-prev">← Earlier 7 days</button><button class="ghost" id="hg-more">+ 7 more days</button><button class="primary" id="hg-save">Save</button></div>`;
    // burned <-> deficit: typing one fills the other from Eaten
    $$('.hrow[data-i]', gbox).forEach((row) => {
      const g = (k) => $(`[data-k="${k}"]`, row);
      const eaten = () => num(g('e').value);
      g('d').oninput = () => { const d = num(g('d').value), e = eaten(); if (d != null && e != null) g('b').value = Math.round(e + d); };
      g('b').oninput = g('e').oninput = () => { const b = num(g('b').value), e = eaten(); g('d').value = b != null && e != null ? Math.round(b - e) : ''; };
    });
    $('#hg-prev', gbox).onclick = () => { gs.value = addDays(gs.value, -7); gdays = 7; drawGrid(); };
    $('#hg-more', gbox).onclick = () => { gdays = Math.min(62, gdays + 7); drawGrid(); };
    $('#hg-save', gbox).onclick = async (ev) => {
      const rows = [];
      $$('.hrow[data-i]', gbox).forEach((row) => {
        const o = orig[+row.dataset.i], g = (k) => { const x = $(`[data-k="${k}"]`, row); return x && !x.disabled ? num(x.value) : null; };
        const w = g('w'), e = o.eaten_in_app != null ? null : g('e'), b = g('b'), dd = g('d');
        const wkg = w == null ? null : lb ? w / 2.20462 : w;
        // a weight logged in the app stays an app weight unless it was changed here
        const keepAppW = o.weight_in_app && w != null && Math.abs(wkg - o.weight_kg) < 0.05;
        const burned = b != null ? b : dd != null && (e ?? o.eaten_in_app) != null ? (e ?? o.eaten_in_app) + dd : null;
        const r = {day: o.day, weight_kg: keepAppW ? null : wkg, eaten: e, burned, protein_g: mac.checked ? g('p') : o.protein_g, carbs_g: mac.checked ? g('c') : o.carbs_g, fat_g: mac.checked ? g('f') : o.fat_g};
        const before = [o.weight_in_app ? null : o.weight_kg, o.eaten, o.burned].map((v) => (v == null ? '' : Math.round(v * 10)));
        const after = [r.weight_kg, r.eaten, r.burned].map((v) => (v == null ? '' : Math.round(v * 10)));
        if (before.join() !== after.join() || (mac.checked && [r.protein_g, r.carbs_g, r.fat_g].join() !== [o.protein_g, o.carbs_g, o.fat_g].map((v) => (v == null ? null : Math.round(v))).join())) rows.push(r);
      });
      if (!rows.length) { toast('Nothing changed'); return; }
      ev.target.disabled = true;
      try { const r = await api('/api/food/history', json('POST', {rows, replace: true})); invalidate('/api/food'); toast(`Saved ${rows.length} day${rows.length > 1 ? 's' : ''}`); drawSum(); drawGrid(); }
      catch (x) { toast(x.message); ev.target.disabled = false; }
    };
  };
  gs.onchange = () => { gdays = 7; drawGrid(); };
  mac.onchange = drawGrid;
  drawGrid();
  const drawSum = () => load('/api/food/history/summary', (S) => {
    const sb = $('#hi-sum', el); if (!sb) return;
    sb.innerHTML = S.first ? `<div class="card"><h2>Imported so far</h2><p class="small">${S.weights} weigh-ins, ${S.days_food} days of food, ${S.burned} days of burned calories - back to ${esc(new Date(S.first + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'}))}.</p>
      <div class="actions"><button class="ghost danger" id="hi-del">Remove imported data</button></div><p class="small muted">Removes only what came from imports. Food you logged in the app and weights you logged by hand stay.</p></div>` : '';
    const del = $('#hi-del', sb);
    if (del) del.onclick = async () => { if (!confirm('Remove all imported weights, calories and burned numbers?')) return;
      try { const r = await api('/api/food/history', {method: 'DELETE'}); invalidate('/api/food'); toast(`Removed ${r.weights} weigh-ins, ${r.days_food} days of food, ${r.burned} burned`); drawSum(); } catch (x) { toast(x.message); } };
  }, {maxAge: 0});
  drawSum();
});

// ---------- Nutrition > progress views (2026-10-09; split into views 2026-10-12): one range, tiles, insights, charts ----------
const ACTIVITY_LEVELS = [[1.2, 'Mostly sitting', 'desk job, little walking'], [1.3, 'Some walking & standing', 'errands, light chores, kids'], [1.45, 'On my feet a lot', 'retail, nursing, active job']];
function energyCard(box) {
  // daily needs = BMR x everyday activity (no exercise); workouts are added only on the days they happen
  load('/api/food/energy', (E) => {
    if (!box.isConnected) return;
    const lb = imp(), step = lb ? 250 : 275;   // ~0.5 lb or ~0.25 kg a week
    const opts = [[`Lose ${lb ? '1 lb' : '0.5 kg'}/week`, -2 * step], [`Lose ${lb ? '½ lb' : '0.25 kg'}/week`, -step], ['Maintain', 0], [`Gain ${lb ? '½ lb' : '0.25 kg'}/week`, step]];
    const lvl = ACTIVITY_LEVELS.reduce((b, l) => (Math.abs(l[0] - E.activity_factor) < Math.abs(b[0] - E.activity_factor) ? l : b));
    const check = E.observed == null ? '' : Math.abs(E.check_diff) < 150
      ? `Your food log and weight change over the last 4 weeks match this (you burned about ${r0(E.observed)} a day including workouts).`
      : `Your food log and weight change suggest you actually burned about ${r0(E.observed)} a day including workouts, ${r0(Math.abs(E.check_diff))} ${E.check_diff > 0 ? 'more' : 'less'} than this estimate${E.check_diff > 0 ? ' - you may be more active than the setting below' : ' - try a lower activity level, or check that every snack is logged'}.`;
    box.innerHTML = `<div id="resting-source-card"></div><details class="card"${E.resting_source === 'apple_health' ? '' : ' open'}><summary>Optional calorie-target calculator · Kinetta estimate</summary><h2>Your daily calorie needs<span class="muted small">without workouts</span></h2>
      <div class="needs-eq"><div><small>Resting burn (BMR)</small><b class="num">${r0(E.bmr)}</b></div><span>×</span><div><small>Everyday activity</small><b class="num">${E.activity_factor}</b></div><span>=</span><div class="hi"><small>Daily needs</small><b class="num">${r0(E.base)}</b></div></div>
      ${E.bmr_exact ? '' : '<p class="small warn-text">BMR is a rough guess from your weight. Add your height, birth year and sex under <a href="/me">Me &gt; Settings</a> for a more personalized estimate.</p>'}
      <p class="small muted">Everyday activity outside workouts:</p>
      <div class="seg wide actlvl" role="group" aria-label="Everyday activity">${ACTIVITY_LEVELS.map(([f, n, d]) => `<button data-f="${f}" aria-pressed="${f === lvl[0]}" title="${esc(d)}">${esc(n)}</button>`).join('')}</div>
      <p class="small muted">Workouts are not included here. They are added to the day you do them, which deepens that day's deficit${E.avg_exercise ? ` (lately about ${r0(E.avg_exercise)} kcal a day on average)` : ''}.</p>
      ${check ? `<p class="small">${esc(check)}</p>` : ''}
      <h3 class="sub">Set your daily calorie target</h3>
      <div class="tdee-opts">${opts.map(([n, d]) => `<button class="ghost" data-k="${E.base + d}"><small>${esc(n)}</small><b class="num">${r0(E.base + d)}</b></button>`).join('')}</div>
      <p class="small muted">Based on daily needs alone, so any workout adds to your deficit${App.me.kcal_target ? `. Now ${r0(App.me.kcal_target)}` : ''}.</p></details>`;
    restingSourceCard($('#resting-source-card',box));
    $$('.actlvl button', box).forEach((b) => b.onclick = async () => {
      try { await api('/api/profile', json('PUT', {activity_factor: +b.dataset.f})); App.me.activity_factor = +b.dataset.f; invalidate('/api/food'); render(); } catch (x) { toast(x.message); }
    });
    $$('.tdee-opts button', box).forEach((b) => b.onclick = async () => {
      const m = App.me, body = {kcal_target: +b.dataset.k, protein_target: m.protein_target ?? null, carbs_target: m.carbs_target ?? null, fat_target: m.fat_target ?? null, fiber_target: m.fiber_target ?? null};
      try { await api('/api/food/targets', json('PUT', body)); m.kcal_target = body.kcal_target; invalidate('/api/food'); toast(`Calorie target set to ${r0(body.kcal_target)}`); render(); } catch (x) { toast(x.message); }
    });
  });
}
function weeksCard(box) {
  const kcalFmt = (v) => `${r0(v)} kcal`;
  // 2. week by week
  load('/api/food/weeks?weeks=26', (W) => {
    if (!box.isConnected) return;
    const rows = W.weeks, logged = rows.filter((w) => w.days_logged), t = App.me;
    if (!logged.length) { box.innerHTML = '<div class="card empty"><b>No food logged yet</b>Weekly averages appear here once you start logging.</div>'; return; }
    const shown = rows.slice(rows.findIndex((w) => w.days_logged));   // from the first logged week
    const col = (k) => shown.map((w, i) => { const d = new Date(w.week + 'T12:00'), prev = shown[i - 1] && new Date(shown[i - 1].week + 'T12:00');
      return {label: 'Week of ' + d.toLocaleDateString([], {month: 'short', day: 'numeric'}), tick: !prev || prev.getMonth() !== d.getMonth() ? d.toLocaleDateString([], {month: 'short'}) : '', partial: w.partial, segs: [{k: k.k, v: w[k.f] || 0}]}; });
    const wt = (kg) => (kg == null ? '–' : U.weight(kg));
    box.innerHTML = `<div class="card"><div class="tblwrap"><table class="tbl yrs"><thead><tr><th>Week of</th><th class="r">Days</th><th class="r">kcal</th><th class="r">P</th><th class="r">C</th><th class="r">F</th><th class="r">Exercise</th><th class="r">${U.du()}</th><th class="r">Weight</th></tr></thead><tbody>
        ${[...shown].reverse().map((w) => `<tr${w.partial ? ' class="cur"' : ''}><td>${esc(new Date(w.week + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}))}</td><td class="r num">${w.days_logged}${w.partial ? '' : '/7'}</td>
          <td class="r num"><b>${w.kcal == null ? '–' : r0(w.kcal)}</b></td><td class="r num">${w.protein_g == null ? '–' : r0(w.protein_g)}</td><td class="r num">${w.carbs_g == null ? '–' : r0(w.carbs_g)}</td><td class="r num">${w.fat_g == null ? '–' : r0(w.fat_g)}</td>
          <td class="r num">${r0(w.exercise_per_day)}</td><td class="r num">${U.dist(w.distance_m, 0)}</td><td class="r num">${wt(w.trend_kg)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Per day on logged days · exercise = kcal burned per day · ${U.du()} = run + ride + walk · weight = trend at the end of the week.</p></div>`;
  });
}
const NRANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];
// Log your weight (2026-10-12: moved here from the Log view). Any day up to today, so old weigh-ins can be added too.
let wcDay = null;   // the day picked for a weigh-in stays picked after saving, to add several old ones in a row
function weightCard(box) {
  const unit = imp() ? 'lb' : 'kg', today = isoDay(new Date());
  let day = wcDay && wcDay < today ? wcDay : today, W = {points: []};
  const draw = () => {
    if (!box.isConnected) return;
    const isToday = day === today, had = W.points.find((p) => p.day === day), r = W.rate_kg_per_week;
    box.innerHTML = `<div class="card wcard"><h2>${isToday ? "Log today's weight" : `Log weight for ${esc(dayLabel(day))}`}</h2>
      ${had ? `<p class="wdone">${svg('check')} Logged: <b class="num">${esc(U.weight(had.kg))} ${unit}</b>${isToday ? ' today' : ''}</p>` : ''}
      <form class="wform"><label class="wfield"><input name="w" inputmode="decimal" placeholder="e.g. ${imp() ? '165.4' : '75.0'}" value="${had ? U.weight(had.kg) : ''}" aria-label="Your weight ${isToday ? 'today' : 'on ' + esc(dayLabel(day))} in ${unit}" enterkeyhint="done"><span>${unit}</span></label>
        <button class="${had ? 'ghost' : 'primary'}">${had ? 'Update' : 'Log weight'}</button></form>
      <div class="wfoot"><label class="linkbtn daypick">${svg('calendar')}<span>${isToday ? 'A different day' : esc(dayLabel(day))}</span><input type="date" name="wday" value="${esc(day)}" max="${today}" aria-label="The day you weighed yourself"></label>
        ${W.trend_kg ? `<span class="small muted num">Trend ${U.weight(W.trend_kg)} ${unit}${r != null ? ` · ${r > 0 ? '+' : r < 0 ? '−' : ''}${U.weight(Math.abs(r))} a week` : ''}</span>` : ''}</div></div>`;
    const dp = $('[name=wday]', box);
    dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* the browser opens its own picker */ } };
    dp.onchange = () => { if (dp.value && dp.value <= today) { day = wcDay = dp.value; draw(); } };
    $('.wform', box).onsubmit = async (e) => {
      e.preventDefault(); const v = parseFloat(e.target.w.value.replace(',', '.')); if (!(v > 0)) return;
      const kg = imp() ? v / 2.20462 : v;
      try {
        const q = await sendOrQueue('/api/food/weights', 'PUT', {day, kg}, `weight ${U.weight(kg)}`);
        toast(q.queued ? 'Weight saved on this phone - it sends when you are back online' : `Weight logged${day === today ? '' : ` for ${dayLabel(day)}`}: ${U.weight(kg)} ${unit}`);
        if (!q.queued) { invalidate('/api/food'); render(); }
      } catch (x) { toast(x.message); }
    };
  };
  draw();
  load('/api/food/weights?days=3650', (w) => { W = w; draw(); }).catch(() => {});
}

async function nutritionView(el, view, q) {
  // range (overview, energy, macros): 7/30/90/365 days, or "since" = from a start date the person picks (e.g. the start
  // of a diet); remembered on this phone
  let r = q.get('r'); if (!r) { try { r = localStorage.getItem('fit.nrange'); } catch (e) { /* none */ } }
  if (r !== 'since' && !NRANGES.some((x) => String(x[0]) === r)) r = '30';
  const ranged = NRANGED.includes(view);
  const root = nHead(el, view, ranged ? pillBtn('n-range', 'calendar', r === 'since' ? 'Since…' : NRANGES.find((x) => String(x[0]) === r)[1], 'Time range') : '');
  const save = (v) => { try { localStorage.setItem('fit.nrange', v); } catch (e) { /* none */ } go(nutritionHref(view,`r=${v}`), {replace: true}); };
  const startSheet = (cur) => sheet('Count from', `<form class="form" id="ds"><label>Start date<input type="date" class="datefield" name="since" value="${esc(cur || '')}" max="${isoDay(new Date())}"></label>
      <p class="small muted">For example the day you started your diet. Trends, the running deficit and the averages then cover everything since that day.</p>
      <div class="actions"><button class="primary">Use this date</button></div></form>`, (b, close) => {
    $('#ds', b).onsubmit = async (e) => { e.preventDefault(); const v = $('#ds', b).since.value; if (!v) return;
      try { await api('/api/food/deficit/start', json('PUT', {since: v})); close(); invalidate('/api/food'); save('since'); } catch (x) { toast(x.message); } };
  });
  if (view === 'weight') { root.innerHTML = '<div id="nt-weight"></div><div id="nt-whist"></div>'; weightCard($('#nt-weight', root)); weightHistory($('#nt-whist', root)); return; }
  if (view === 'needs') { energyCard(root); return; }
  if (view === 'weeks') { weeksCard(root); return; }
  let since = null;
  $('#n-range', el).onclick = () => pickSheet('Time range', pickRows([...NRANGES.map(([d, n]) => [String(d), n]),
    ['since', since ? `Since ${new Date(since + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'})}` : 'Since a date…', since ? 'Tap again to change the date' : 'For example the day you started a diet']], r),
    (k) => (k === 'since' ? (since && r !== 'since' ? save('since') : startSheet(since)) : save(k)));
  root.innerHTML = `${view==='overview'&&location.pathname==='/progress'?'<div id="nt-checkin"></div>':''}<div id="nt-body">${skel(3)}</div>${view === 'overview' ? '<div id="nt-coach"></div>' : ''}`;
  if(view==='overview'&&location.pathname==='/progress')weeklyCheckinCard($('#nt-checkin',root));   // the numbers first, then the coach
  if (view === 'overview') dietCoach($('#nt-coach', root));
  const url = r === 'since' ? '/api/food/insights?days=30&since=' : `/api/food/insights?days=${r}`;
  if (r === 'since') {   // need the saved start date first
    const I0 = await api('/api/food/insights?days=7').catch(() => null); since = I0 && I0.deficit_start;
    if (!since) { $('#nt-body', root).innerHTML = '<div class="card empty"><b>Pick a start date</b>Tap the time range button to choose the day to count from.</div>'; startSheet(null); return; }
  }
  await load(r === 'since' ? url + since : url, (I) => {
    since = I.deficit_start || since;
    const rb = $('#n-range span', el); if (rb && r === 'since' && since) rb.textContent = `Since ${new Date(since + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'})}`;
    drawTrends($('#nt-body', root), I, I.summary.days, view);
  });
}
function drawTrends(box, I, days, part) {   // part: overview | energy | macros
  if (!box || !box.isConnected) return;
  const S = I.summary, T = I.targets, lb = imp(), wu = lb ? 'lb' : 'kg', wconv = (kg) => (lb ? kg * 2.20462 : kg);
  const past = I.rows.filter((r) => !r.today);
  if (!I.rows.some((r) => r.eaten != null)) { box.innerHTML = '<div class="card empty"><b>Nothing logged in this range</b><p>Start with something you ate to build your food and weight picture.</p><a class="primary wide" href="/food">Log food</a><p class="small muted">Have older records? <a href="/food/import">Add past days</a>.</p></div>';syncCheckinPrimary(box.closest?.('#page')); return; }
  const tile = (label, value, unit, sub, cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="ntile ${cls}"><small>${esc(label)}</small><b class="num">${value}<i>${esc(unit)}</i></b>${sub ? `<span>${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const weekly = days > 90;   // a year of daily bars is too thin: average by week
  const dlabel = (d, o) => new Date(d + 'T12:00').toLocaleDateString([], o);
  let cols;
  if (weekly) {
    const W = {};
    for (const r of I.rows) { const d = new Date(r.day + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = isoDay(d); (W[k] = W[k] || []).push(r); }
    cols = Object.entries(W).map(([k, rs], i, arr) => { const c = rs.filter((r) => r.counted), a = (f) => { const v=c.map(r=>r[f]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null; };
      const prev = arr[i - 1] && new Date(arr[i - 1][0] + 'T12:00'), d = new Date(k + 'T12:00');
      const ws = rs.filter((r) => r.weight != null), lastT = [...rs].reverse().find((r) => r.trend != null);
      return {label: 'Week of ' + dlabel(k, {month: 'short', day: 'numeric'}), tick: !prev || prev.getMonth() !== d.getMonth() ? (i === 0 || d.getMonth() % 2 === 0 ? dlabel(k, {month: 'short'}) : '') : '', eaten: a('eaten'), burned: a('burned'), goal: a('goal'), protein_g: a('protein_g'), partial: rs.some((r) => r.today),
        weight: ws.length ? wconv(ws.reduce((x, r) => x + r.weight, 0) / ws.length) : null, trend: lastT ? wconv(lastT.trend) : null}; });
  } else {
    const every = days <= 7 ? 1 : days <= 30 ? 7 : 14;
    cols = I.rows.map((r, i) => ({label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}), tick: (I.rows.length - 1 - i) % every === 0 ? dlabel(r.day, days <= 7 ? {weekday: 'short'} : {month: 'short', day: 'numeric'}) : '',
      eaten: r.eaten, burned: r.eaten == null ? null : r.burned, goal: r.goal, protein_g: r.protein_g, partial: r.today, day: r.day, counted: r.counted, weight: r.weight == null ? null : wconv(r.weight), trend: r.trend == null ? null : wconv(r.trend)}));
  }
  const pDef = S.predicted_kg, pTr = S.trend_change_kg;
  const burnNote=I.rows.some(r=>r.burn_source==='apple_health')
    ? 'Burn uses synced Apple Health resting calories plus recorded activity calories, counted once. Missing resting data stays missing. These are source estimates, not a measurement of your exact needs.'
    : I.rows.some(r=>r.burn_source==='imported')
      ? 'Some days use imported daily burn; other days use the formula estimate plus recorded workouts. These source values are estimates.'
      : `Burn is a formula estimate of daily needs (about ${r0(homeCalories(S.tdee))} kcal before recorded workouts), plus recorded activity calories. It is not a measurement of your exact needs.`;
  const kcalP = (S.avg_protein_g || 0) * 4, kcalC = (S.avg_carbs_g || 0) * 4, kcalF = (S.avg_fat_g || 0) * 9, kcalM = kcalP + kcalC + kcalF || 1;
  const pct = (v) => Math.round(v / kcalM * 100);
  const html = {overview: `<div class="ntiles">
      ${tile('Avg eaten / day', S.avg_eaten == null ? '–' : r0(homeCalories(S.avg_eaten)), 'kcal', S.avg_goal ? `goal ${r0(homeCalories(S.avg_goal))}` : '')}
      ${tile('Avg estimated balance', S.avg_deficit == null ? '–' : r0(homeCalories(Math.abs(S.avg_deficit))), 'kcal', S.avg_deficit == null ? S.missing_burn_days ? 'waiting for resting data' : 'no full days logged' : S.avg_deficit >= 0 ? 'estimated deficit / day' : 'estimated surplus / day')}
      ${S.burn_counted_days ? tile('Estimated total balance', r0(homeCalories(Math.abs(S.total_deficit))), 'kcal', `rough model: ${wconv(Math.abs(pDef)).toFixed(1)} ${wu} ${pDef <= 0 ? 'loss' : 'gain'}`)
        : tile('Estimated total balance', '–', '', 'counts fully logged days')}
      ${tile('Weight trend', pTr == null ? '–' : sgn(pTr) + wconv(Math.abs(pTr)).toFixed(1), pTr == null ? '' : wu, pTr == null ? 'log weight to see it' : 'over these days', '', '/food?view=weight')}
      ${tile('Avg protein', S.avg_protein_g == null ? '–' : r0(S.avg_protein_g), 'g', T.protein_target ? `target ${r0(T.protein_target)} g` : '')}
      ${tile('Days logged', S.logged, `/ ${S.past_days}`, S.past_days ? `${Math.round(S.logged / S.past_days * 100)}%` : '')}</div>
    ${I.extra_nutrients?`<div class="card">${extraTotals(I.extra_nutrients,{period:true})}</div>`:''}
    ${I.insights.length ? `<div class="card"><h2>Insights</h2>${I.insights.map(([k, t]) => `<div class="insight estimate-note"><span class="dot ${k === 'good' ? 'good' : k === 'warn' ? 'warn' : 'info'}"></span><div><span>${esc(t)}</span></div></div>`).join('')}</div>` : ''}`,
    energy: `<div class="card"><h2>Eaten, burned & weight<span class="muted small">${weekly ? 'weekly average' : 'per day'}</span></h2><div id="nt-energychart"></div>
      <p class="small muted estimate-note">${esc(burnNote)} The goal line is your food target; eating below it does not by itself establish a calorie deficit.</p></div>
    <div class="card"><h2>Running deficit</h2><div id="nt-cum"></div>
      <p class="small muted estimate-note">Adds estimated burn minus logged food across fully logged days with burn data. The weight conversion is a rough energy model, not measured fat loss. Water changes, missing food and burn-estimate errors can affect the comparison.</p></div>`,
    macros: `<div class="card"><h2>Protein<span class="muted small">${weekly ? 'weekly average' : 'per day'}</span></h2><div id="nt-protein"></div></div>
    <div class="card"><h2>Where your calories come from</h2>
      ${S.avg_protein_g != null ? `<div class="split" role="img" aria-label="Protein ${pct(kcalP)}%, carbs ${pct(kcalC)}%, fat ${pct(kcalF)}%"><i class="m-protein_g" data-w="${(kcalP / kcalM).toFixed(3)}"></i><i class="m-carbs_g" data-w="${(kcalC / kcalM).toFixed(3)}"></i><i class="m-fat_g" data-w="${(kcalF / kcalM).toFixed(3)}"></i></div>
      <div class="legend small"><span><i class="sw m-protein_g"></i>Protein ${pct(kcalP)}% · ${r0(S.avg_protein_g)} g</span><span><i class="sw m-carbs_g"></i>Carbs ${pct(kcalC)}% · ${r0(S.avg_carbs_g)} g</span><span><i class="sw m-fat_g"></i>Fat ${pct(kcalF)}% · ${r0(S.avg_fat_g)} g</span></div>` : ''}
      <h3 class="sub">By meal</h3>${Object.entries(S.meals || {}).map(([m, v]) => `<div class="mrow mealrow"><span>${esc(MEAL_NAMES[m])}</span><div class="track"><div class="bar meal-bar" data-w="${(v / 100).toFixed(3)}"></div></div><b class="num">${v}%</b></div>`).join('')}</div>
    ${I.top_foods.length ? `<div class="card"><h2>Top foods by calories</h2>${I.top_foods.map((f) => `<div class="mrow topf"><span title="${esc(f.name)}">${esc(f.name)}</span><div class="track"><div class="bar meal-bar" data-w="${(f.kcal / I.top_foods[0].kcal).toFixed(3)}"></div></div><b class="num">${r0(f.kcal)}<i> · ${f.n}×</i></b></div>`).join('')}</div>` : ''}`};
  box.innerHTML = html[part];syncCheckinPrimary(box.closest?.('#page'));
  requestAnimationFrame(() => {
    if (part === 'macros') periodBars($('#nt-protein', box), cols.map((c) => ({label: c.label, tick: c.tick, partial: c.partial, segs: [{k: 's3', v: c.protein_g || 0}]})),
      {keys: [{k: 's3', name: 'Protein'}], fmt: (v) => `${r0(v)} g`, yfmt: (v) => String(Math.round(v)), avg: T.protein_target || null, avgLabel: 'Target', height: 150});
    if (part !== 'energy') return;
    energyChart($('#nt-energychart', box), cols, {weight: {fmt: (v) => `${v.toFixed(1)} ${wu}`, axis: (v) => v.toFixed(1), unit: wu}});
    const cum = S.logged ? past.filter((r) => r.eaten != null) : [];   // no fully logged day yet: nothing to add up
    dayLine($('#nt-cum', box), cum.map((r) => ({y: r.total, tick: dlabel(r.day, {month: 'short', day: 'numeric'}), label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}),
      sub: r.counted && r.deficit == null ? 'resting calories not synced' : r.counted ? `Day <b>${r0(Math.abs(r.deficit))}</b> ${r.deficit >= 0 ? 'deficit' : 'surplus'}` : 'partly logged, not counted'})),
      {fmt: (v, short) => (short ? (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : r0(v)) : `${r0(Math.abs(v))} kcal ${v >= 0 ? 'deficit' : 'surplus'}`)});
  });
}

// once every script has loaded: start can draw a screen at once from the phone's saved copy, before plan.js, social.js, cook.js run
addEventListener('DOMContentLoaded', start);

// ---------- AI review of your eating (2026-10-11, food_coach.py): the last two weeks, what's going well, what to try ----------
function dietCoachContent(box) {
  if (!box) return; // Previously saved reviews remain readable without generation access.
  load('/api/food/review', (r) => {
    if (!box.isConnected) return;
    const L = r.latest, when = L ? new Date(L.day + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}) : '';
    const list = (xs, ico) => (xs && xs.length ? `<ul class="ai-list">${xs.map((x) => `<li>${svg(ico)}<span>${esc(x)}</span></li>`).join('')}</ul>` : '');
    box.innerHTML = L ? `<div class="card ai coach-card">${coachMessage('diet',
      [L.headline, L.text, L.going_well, L.try_next, L.watch], "Kit’s take",
      `${L.headline ? `<p class="ai-head">${esc(L.headline)}</p>` : ''}${L.text ? `<p>${esc(L.text)}</p>` : ''}
        ${L.going_well ? `<h3 class="ghead">Going well</h3>${list(L.going_well, 'check')}` : ''}
        ${L.try_next ? `<h3 class="ghead">Try this week</h3>${list(L.try_next, 'sparkle')}` : ''}
        ${L.watch ? `<div class="callout warn">${esc(L.watch)}</div>` : ''}
        <button class="linkbtn" id="dc-go">${svg('sparkle')}Review again</button>`, when)}</div>`
      : `<div class="card ai coach-card"><h2>Kit’s take</h2><p>A short review of your last two weeks of eating: what's going well, and two or three things to try next, from your own log.</p>
        <button class="primary wide" id="dc-go">${svg('sparkle')}Review my eating</button></div>`;
    const b = $('#dc-go', box);
    if (!aiCan('coach')) { if (L) b.remove(); else box.innerHTML = ''; return; }
    b.onclick = async () => {
      if (!App.me.ai_ok) { aiSheet(() => b.click()); return; }
      b.disabled = true; const was = b.innerHTML; b.textContent = 'Reading your log…';
      try { const fresh = await api('/api/food/review', json('POST', {})); showCoach('diet'); App.cache.set('/api/food/review', {data: {...r, enabled: true, latest: fresh}, at: Date.now()}); dietCoachContent(box); }
      catch (x) { b.disabled = false; b.innerHTML = was; aiError(b, x.message); }
    };
  }).catch((e) => { if (box.isConnected) box.innerHTML = `<p class="err">${esc(e.message)}</p><button class="ghost" id="food-kit-retry">Retry</button>`; const retry = $('#food-kit-retry',box); if(retry)retry.onclick=()=>dietCoachContent(box); });
}

// AI feedback on a saved meal (food_coach.py): kept on the meal; opens over the Add food sheet
function mealCoach(m) {
  sheet(`Kit’s take: ${m.name}`, `<div class="card ai coach-card" id="mc-box"></div>`, (b) => {
    const box = $('#mc-box', b);
    const draw = (R) => {
      box.innerHTML = R ? coachMessage('meal:' + m.id, [R.summary, R.text, R.ideas, R.note], "Kit’s take", `${R.summary ? `<p class="ai-head">${esc(R.summary)}</p>` : ''}${R.text ? `<p>${esc(R.text)}</p>` : ''}
        ${R.ideas ? `<h3 class="ghead">Ideas</h3><ul class="ai-list">${R.ideas.map((i) => `<li>${svg('sparkle')}<span><b>${esc(i.change)}</b>${i.effect ? ` <span class="muted">${esc(i.effect)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
        ${R.note ? `<div class="callout warn">${esc(R.note)}</div>` : ''}
        <p class="small muted">${esc(new Date(R.at).toLocaleDateString([], {month: 'short', day: 'numeric'}))}</p><button class="linkbtn" id="mc-go">${svg('sparkle')}Ask again</button>`)
        : `<p>Feedback on this meal from Kit: how it fits your day, and a few tweaks with what each one changes.</p><button class="primary wide" id="mc-go">${svg('sparkle')}Get feedback</button>`;
      const g = $('#mc-go', box);
      if (!aiCan('coach')) { g.remove(); return; }
      g.onclick = async () => {
        if (!App.me.ai_ok) { aiSheet(() => g.click()); return; }
        g.disabled = true; const was = g.innerHTML; g.textContent = 'Reading the meal…';
        try { m.review = await api(`/api/food/meals/${m.id}/review`, json('POST', {})); showCoach('meal:' + m.id); invalidate('/api/food/meals'); draw(m.review); }
        catch (x) { toast(x.message); g.disabled = false; g.innerHTML = was; }
      };
    };
    draw(m.review);
  });
}

function dietCoach(box) {
  if (!box) return;
  const account = App.me.login;
  load('/api/food/review', (r) => {
    if (App.me?.login !== account || !box.isConnected || (!r.latest && !aiCan('coach'))) return;
    box.innerHTML = `<button class="icon-btn kit-help" aria-label="Ask Kit about your food log">${svg('sparkle')}</button>`;
    $('button', box).onclick = () => sheet('Kit · Food log', '<div id="food-kit"></div>', (root) => dietCoachContent($('#food-kit', root)));
  }).catch(() => {
    if (box.isConnected && App.me?.login === account && aiCan('coach')) {
      box.innerHTML = `<button class="icon-btn kit-help" aria-label="Ask Kit about your food log">${svg('sparkle')}</button>`;
      $('button', box).onclick = () => sheet('Kit · Food log', '<div id="food-kit"></div>', root => dietCoachContent($('#food-kit',root)));
    }
  });
}

// The resting source changes burn accounting only; the food target remains a separate explicit action.
async function restingSourceCard(box) {
  if (!box?.isConnected) return;
  const account=readOwner(),watch=App.me.resting_source==='apple_health';
  box.innerHTML=`<section class="card"><h2>Resting calories</h2><p class="small muted">Choose where passive calories come from. Your food goal stays the same. Activity calories already in Kinetta are added once.</p>
    <label>Source<select id="resting-source"><option value="formula"${watch?'':' selected'}>Kinetta estimate</option><option value="apple_health"${watch?' selected':''}>Apple Health · Resting Energy</option></select></label>
    <p class="small muted">${watch ? 'Uses synced Resting Energy, without an everyday-activity multiplier. Today shows the amount so far; missing days stay blank until synced.' : 'Uses calculated BMR and your everyday activity setting.'}</p>
    ${watch ? `<p class="small" id="resting-status" role="status">Checking resting-energy sync…</p>${Native.on ? `<button class="primary wide" id="resting-sync">Connect / sync resting calories</button>` : '<p class="small muted">Open the latest Kinetta iPhone app to allow Resting Energy and sync. Synced totals also appear here in your browser.</p>'}<button class="ghost wide danger" id="resting-remove">Remove synced resting calories</button>` : ''}
    <p class="small err" id="resting-error" role="alert"></p></section>`;
  const error=$('#resting-error',box),select=$('#resting-source',box);
  const changed=async value=>{
    select.disabled=true;
    try {
      if(value==='apple_health' && Native.on) await Native.connectRestingEnergy();
      if(value==='formula' && Native.on) await Native.stopRestingEnergy();
      if(account!==readOwner())return;
      await api('/api/profile',json('PUT',{resting_source:value}));
      if(account!==readOwner())return;
      App.me.resting_source=value;invalidate('/api/food');invalidate('/api/health/resting');
      if(value==='apple_health' && Native.on) {
        try { await Native.syncRestingEnergy(); } catch(e) { toast(e.message); }
      }
      if(account===readOwner())render();
    } catch(e) {if(account===readOwner()&&box.isConnected){error.textContent=e.message;select.value=App.me.resting_source||'formula';select.disabled=false;}}
  };
  select.onchange=()=>changed(select.value);
  if(!watch)return;
  const sync=$('#resting-sync',box);if(sync)sync.onclick=async()=>{
    sync.disabled=true;error.textContent='';
    try {await Native.connectRestingEnergy();const result=await Native.syncRestingEnergy();if(account!==readOwner())return;toast(result?.days ? 'Resting calories synced. Food goal unchanged.' : 'No readable Resting Energy. Check Kinetta’s access in Health.');render();}
    catch(e){if(account===readOwner()&&box.isConnected){error.textContent=e.message;sync.disabled=false;}}
  };
  $('#resting-remove',box).onclick=async e=>{
    if(!confirm('Remove your synced resting calories and use Kinetta’s estimate? Your food goal and activities stay the same.'))return;
    e.currentTarget.disabled=true;
    try {if(Native.on)await Native.stopRestingEnergy();if(account!==readOwner())return;await api('/api/health/resting',{method:'DELETE'});if(account!==readOwner())return;App.me.resting_source='formula';invalidate('/api/food');invalidate('/api/health/resting');render();}
    catch(err){if(account===readOwner()&&box.isConnected){error.textContent=err.message;e.currentTarget.disabled=false;}}
  };
  try {
    const status=await api('/api/health/resting');if(account!==readOwner()||!box.isConnected)return;
    const latest=status.days?.[0];$('#resting-status',box).textContent=latest ? `Latest day: ${latest.day} · ${r0(latest.resting_kcal)} resting kcal · read ${when(latest.observed_at)}. Health totals can update after later syncs.` : 'No resting calories have synced. Allow Resting Energy in the iPhone app, then sync. Closing the permission screen does not confirm read access.';
  }catch(e){if(account===readOwner()&&box.isConnected)$('#resting-status',box).textContent=e.message;}
}
