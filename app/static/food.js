// Kinetta — Food log pages. Fast logging: search (own foods + recent first, then Open Food Facts + USDA),
// barcode, quick add, photo (Gemini estimate), saved meals, copy a day. Every entry editable; deletes have Undo.
'use strict';
const MACROS = [['protein_g', 'Protein', 'P'], ['carbs_g', 'Carbs', 'C'], ['fat_g', 'Fat', 'F']];
const r1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString());
// a food's numbers in full, shown when you tap it (rows show calories only; 2026-10-12: "1P 50C 1F" meant nothing)
const nutGrid = (v, {calories=r0}={}) => `<div class="nut"><span><b class="num">${calories(v.kcal)}</b><small>Calories</small></span>${MACROS.map(([k, n]) =>
  `<span><b class="num${nutrientKnown(v,k)?'':' nutrient-unknown'}">${nutrientKnown(v,k)?r1(v[k])+' g':'Unknown'}</b><small>${n}</small></span>`).join('')}</div>`;
const EXTRA_NUTRIENTS = [['sodium_mg','Sodium','mg','sodium_target_mg'],['sugar_g','Total sugar','g','sugar_target_g'],['saturated_fat_g','Saturated fat','g','saturated_fat_target_g']];
const FOOD_NUTRIENTS = ['kcal','protein_g','carbs_g','fat_g','fiber_g',...EXTRA_NUTRIENTS.map(([k])=>k)];
const nutrientKnown = (v,k) => v[k]!=null && !(v.ref?.unknown_nutrients||[]).includes(k);
function nutrientNumber(v,unit){if(v==null)return 'Unknown';if(v===0)return '0 '+unit;return v<(unit==='mg'?1:.1)?'&lt;'+(unit==='mg'?'1':'0.1')+' '+unit:(unit==='mg'?r0(v):r1(v))+' '+unit;}
function nutrientSource(v){const r=v.ref||{},origin=r.origin||v.origin,source=r.origin_ref?.source||r.source||v.source;return (origin==='ai'?'Kit’s estimate':origin==='label'?'Nutrition label':({usda:'USDA',off:'Open Food Facts',label:'Nutrition label',quick:'Entered by you',dish:'Saved recipe',custom:'My food'}[source]||''))+((r.origin_edited||v.origin_edited)?' · Edited':'');}
function extraInputs(v={},targets=false,lead=''){return `<details class="extra-nutrients extra-inputs"><summary>${targets?'More targets':'More nutrients'}</summary><p class="small muted">${targets?'Fiber and optional daily limits. Leave any blank. These do not change your calorie goal.':'For this amount of food. Leave a value blank if you don’t know it; a reported zero stays zero.'}</p>${!targets&&nutrientSource(v)?`<p class="small muted">Source: ${esc(nutrientSource(v))}</p>`:''}<div class="extra-fields">${lead}${EXTRA_NUTRIENTS.map(([key,label,unit,target])=>{const k=targets?target:key;return `<label>${label} (${unit})<input name="${k}" inputmode="decimal" value="${esc((targets||nutrientKnown(v,k))?v[k]??'':'')}" aria-label="${label} ${targets?'daily limit in ': 'in '}${unit}"></label>`;}).join('')}</div></details>`;}
function extraFormValues(f,targets=false){return Object.fromEntries(EXTRA_NUTRIENTS.map(([key,, ,target])=>{const k=targets?target:key,raw=f.elements.namedItem(k)?.value.trim()??'',value=raw===''?null:Number(raw.replace(',','.'));if(value!==null&&(!Number.isFinite(value)||value<0))throw Error('Enter a positive number or zero, or leave the nutrient blank.');return [k,value];}));}
function foodStorage(entry){const missing=FOOD_NUTRIENTS.filter(k=>!nutrientKnown(entry,k));if(missing.includes('kcal'))throw Error('Add calories before logging this food.');const out={...entry,ref:{...(entry.ref||{}),unknown_nutrients:[...new Set([...(Array.isArray(entry.ref?.unknown_nutrients)?entry.ref.unknown_nutrients.filter(k=>typeof k==='string'&&!FOOD_NUTRIENTS.includes(k)):[]),...missing])]}};for(const k of FOOD_NUTRIENTS)if(missing.includes(k))out[k]=['kcal','protein_g','carbs_g','fat_g'].includes(k)?0:null;return out;}
function extraCoverage(entries,targets={}){return Object.fromEntries(EXTRA_NUTRIENTS.map(([k,,,target])=>{const known=entries.filter(e=>nutrientKnown(e,k));return [k,{recorded:known.length?known.reduce((n,e)=>n+Number(e[k]),0):null,known_count:known.length,unknown_count:entries.length-known.length,complete:!!entries.length&&known.length===entries.length,target:targets[target]}];}));}
function extraTotals(values,{period=false}={}){return `<details class="extra-nutrients"><summary>More nutrients${period?' · this range':''}</summary><dl>${EXTRA_NUTRIENTS.map(([k,label,unit])=>{const v=values?.[k]||{};return `<div><dt>${label}</dt><dd><b class="num">${nutrientNumber(v.recorded,unit)}</b>${v.recorded!=null&&!v.complete?'<small>Some foods are missing values</small>':''}${v.unknown_count?`<small>${v.unknown_count} food${v.unknown_count===1?'':'s'} with no value</small>`:''}${!period&&v.target!=null?`<small>Your limit: ${nutrientNumber(v.target,unit)}</small>`:''}</dd></div>`;}).join('')}</dl><p class="small muted">${period?'Recorded totals across this date range. ':''}Missing values are unknown, not zero. Total sugar includes naturally occurring sugar.</p></details>`;}
function extraFood(v){return `<details class="extra-nutrients"><summary>More nutrients</summary><dl>${EXTRA_NUTRIENTS.map(([k,label,unit])=>`<div><dt>${label}</dt><dd class="num">${nutrientNumber(nutrientKnown(v,k)?v[k]:null,unit)}</dd></div>`).join('')}</dl><p class="small muted">For this portion, using its recorded source values. Estimates stay estimates; missing values are unknown.</p></details>`;}
const foodDestination = w => { const zone=w.timeZone||tz();return `<p class="portion-context small muted">${esc([MEAL_NAMES[w.meal],dayLabel(w.day||isoDay(new Date(),zone),zone)].filter(Boolean).join(' · '))}</p>`; };
function foodDestinationPicker(w,onSave,formId='food-destination'){
  const zone=foodTimeZone(),today=isoDay(new Date(),zone),yesterday=addDays(today,-1),day=w.day||today,meal=Object.hasOwn(MEAL_NAMES,w.meal)?w.meal:guessMeal(zone);
  const mealRows=Object.entries(MEAL_NAMES).map(([key,name])=>{const label=key==='snacks'?'Snack':name;return `<button type="button" class="food-destination-option" data-meal="${esc(key)}" aria-pressed="${key===meal}"><span>${esc(label)}</span>${key===meal?'<span class="food-destination-check" aria-hidden="true">✓</span>':''}</button>`;}).join('');
  sheet('Meal and day',`<div class="food-destination-picker" id="${esc(formId)}"><div class="food-destination-group" role="group" aria-label="Meal">${mealRows}</div><div class="food-destination-group" role="group" aria-label="Day"><button type="button" class="food-destination-option" data-day="${today}" aria-pressed="${day===today}"><span>Today</span>${day===today?'<span class="food-destination-check" aria-hidden="true">✓</span>':''}</button><button type="button" class="food-destination-option" data-day="${yesterday}" aria-pressed="${day===yesterday}"><span>Yesterday</span>${day===yesterday?'<span class="food-destination-check" aria-hidden="true">✓</span>':''}</button><label class="food-destination-option food-destination-pick"><span>Pick a date…</span><input name="date" type="date" value="${esc(day)}" aria-label="Pick a date"></label></div></div>`,(b,close)=>{
    const root=$(`#${formId}`,b),apply=async next=>{try{await onSave(next);close();}catch(error){toast(error.message);}};
    $$('[data-meal]',root).forEach(button=>button.onclick=()=>apply({meal:button.dataset.meal,day}));
    $$('[data-day]',root).forEach(button=>button.onclick=()=>apply({meal,day:button.dataset.day}));
    const date=$('input[name="date"]',root);date.onchange=()=>{if(date.value)apply({meal,day:date.value});};
  });
}

const recipeCalories = v => v==null?'Unknown':r0(homeCalories(v));
function macroTotal(D,k,target){const missing=D.unknown_nutrients?.[k]||0;if(missing)return missing>=D.entries.length?'Unknown':`${r0(D.totals[k])} g recorded · some foods are missing values`;return `${r0(D.totals[k])} g${target?' / '+r0(target)+' g':''}`;}
function weeklyReviewHtml(data){
  const dateLabel=day=>new Date(day+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const nutrient=(key,label,unit)=>{const v=data.nutrients[key];return `<div><dt>${label}</dt><dd><b class="num">${nutrientNumber(v.recorded,unit)}</b>${v.recorded!=null&&!v.complete?'<small>Some foods are missing values</small>':''}${v.unknown_count?`<small>${v.unknown_count} food${v.unknown_count===1?'':'s'} with no value</small>`:''}</dd></div>`;};
  return `<section class="card weekly-food-review"><h2>Your week in food</h2><p class="small muted">${esc(dateLabel(data.start))}–${esc(dateLabel(data.end))} · 7 completed days</p><p class="weekly-food-lead">Food logged on <b>${data.days_logged} of 7 days</b>.</p><p class="small muted">${esc(data.source)}. ${esc(data.note)}</p>
    <details class="weekly-food-fold"><summary>Protein across meals</summary><p class="small muted">Recorded totals across these 7 days, not daily averages.</p><dl>${data.protein_by_meal.map(m=>`<div><dt>${esc(MEAL_NAMES[m.meal])}<small>Logged on ${m.days} day${m.days===1?'':'s'}</small></dt><dd><b class="num">${nutrientNumber(m.recorded,'g')}</b>${m.recorded!=null&&!m.complete?'<small>Some foods are missing values</small>':''}${m.unknown_count?`<small>${m.unknown_count} food${m.unknown_count===1?'':'s'} with no value</small>`:''}</dd></div>`).join('')}</dl></details>
    <details class="weekly-food-fold"><summary>Fiber and more nutrients</summary><p class="small muted">Recorded totals across these 7 days. Total sugar includes naturally occurring sugar.</p><dl>${nutrient('fiber_g','Fiber','g')}${EXTRA_NUTRIENTS.map(([k,label,unit])=>nutrient(k,label,unit)).join('')}</dl></details>
    ${data.top_foods.length?`<details class="weekly-food-fold"><summary>Top recorded calorie sources</summary><ol class="weekly-top-foods">${data.top_foods.map(f=>`<li><span>${esc(f.name)}<small>${f.logs} log${f.logs===1?'':'s'}${f.complete?'':' · some values are missing'}</small></span><b class="num">${r0(homeCalories(f.recorded))} kcal</b></li>`).join('')}</ol></details>`:''}
    ${data.suggestions.length?`<div class="weekly-food-suggestions"><h3>For the next few days</h3>${data.suggestions.map(s=>`<p>${esc(s.text)}</p>`).join('')}</div>`:''}</section>`;
}
async function weeklyFoodReviewCard(box){
  const owner=readOwner(),valid=()=>box?.isConnected&&readOwner()===owner;
  if(!valid())return;box.innerHTML=skel(1);let shown=false;
  try{await load('/api/food/weekly-review',data=>{if(!valid())return;shown=!!data.entries;box.innerHTML=data.entries?weeklyReviewHtml(data):'';});}
  catch(e){if(!valid())return;const error='<div class="card"><p>'+ (shown?'Showing your saved review. Couldn’t check for updates.':'Couldn’t load your weekly food review.')+'</p><button type="button" class="linkbtn" data-weekly-retry>Try again</button></div>';if(shown)box.insertAdjacentHTML('beforeend',error);else box.innerHTML=error;box.querySelector('[data-weekly-retry]').onclick=()=>weeklyFoodReviewCard(box);}
}
// Me is activity-first (owner decisions 2026-10-18): food appears on Me only once something is logged today, as one
// compact card with a single Log food button. Every other way to log lives in Nutrition. food_user (a goal or food in
// the last 14 days) still tells Progress whether to offer its Food & weight half.
function todayFoodCard(box, {onHistory, onFoodUser} = {}) {
  return load('/api/food/day', (D) => {
    if (!box.isConnected) return;
    onHistory?.(!!D.has_history || D.entries.length>0);
    App.mealHours = D.meal_hours || App.mealHours;
    const loggedToday = D.entries.length > 0;
    if (App.me) App.me.food_user = !!D.food_user || loggedToday;
    if (!loggedToday) { box.innerHTML = ''; onFoodUser?.(false); return; }
    const g = D.goal?.kcal, T = D.totals, left = g == null ? null : g - T.kcal;
    const fraction = g > 0 ? Math.max(0,Math.min(1,T.kcal/g)) : 0;
    const progress = g > 0 ? `${r0(homeCalories(T.kcal))} of ${r0(g)} kcal${left<0?`, ${r0(homeCalories(-left))} above goal`:''}` : '';
    box.innerHTML = `<div class="card tfood" aria-label="Today’s food"><h2>Food today<a class="more" href="/food">Open log ›</a></h2>
      <a class="tap tfood-details" href="/food"><div class="tfood-calories">${stat('Eaten', r0(homeCalories(T.kcal)), 'kcal')}${g != null ? stat(left < 0 ? 'Over' : 'Left', r0(homeCalories(Math.abs(left))), 'kcal') : stat('Goal', 'not set')}</div>
      ${g > 0 ? `<div class="gbar${left < 0 ? ' over' : ''}" role="progressbar" aria-label="Calories eaten" aria-valuemin="0" aria-valuemax="${g}" aria-valuenow="${Math.min(g,Math.max(0,T.kcal))}" aria-valuetext="${esc(progress)}"><div class="gfill" data-w="${fraction.toFixed(3)}"></div></div>` : ''}
      <div class="today-macros">${MACROS.map(([k,name])=>{const target=D.targets?.[k.replace('_g','_target')],unknown=D.unknown_nutrients?.[k]||0;
        const value=unknown>=D.entries.length?'Unknown':r0(T[k]||0)+(unknown?'+':'');
        return `<div class="today-macro m-${k}"><small>${name}</small><b class="num">${value}${value==='Unknown'?'':'<i> g</i>'}</b>${target?`<span class="small muted">${unknown?'Target':'of'} ${r0(target)} g${unknown?' · values missing':''}</span>`:''}</div>`;}).join('')}</div>
      ${D.entries.some(e => e.pending) ? '<p class="small muted" role="status">Some foods are waiting to send.</p>' : ''}</a>
      <button class="primary wide" id="tf-add">${svg('plus')} Log food</button></div>`;
    syncCheckinPrimary(box.closest?.('#page'));
    $('#tf-add', box).onclick = () => describeSheet(null, null);
    onFoodUser?.(true);
  }, {maxAge: 5000});
}
function chooseYesterday(day) {
  const owner=readOwner();
  sheet("Copy yesterday's food",`<p>Choose what to copy. You’ll review the foods before adding them.</p><div class="card list">${[['','All meals'],...Object.entries(MEAL_NAMES)].map(([key,label])=>`<button type="button" class="row-link" data-copy-meal="${key}"><span class="grow">${label}</span><span class="chev">${svg('chev')}</span></button>`).join('')}</div>`,(b,close)=>{
    guardFoodSheet(b,close,owner);$$('[data-copy-meal]',b).forEach(button=>button.onclick=()=>{if(owner!==readOwner())return;const meal=button.dataset.copyMeal||null;close();yesterdayMeal(day,meal);});
  });
}
function yesterdayMeal(day, meal) {
  const owner = readOwner(), from = addDays(day, -1);
  sheet("Copy yesterday's food", '', (b, close) => {
    const stopSkeleton = delayedSkeleton(b, skelFoodChooser(2));
    const live = () => b.isConnected && readOwner() === owner;
    api(`/api/food/day?d=${from}`).then(D => {
      if (!live()) return;
      stopSkeleton();
      const rows = D.entries.filter(e => (!meal || e.meal === meal) && !e.pending),label=meal?MEAL_NAMES[meal].toLowerCase():'all meals';
      b.innerHTML = rows.length ? `<p>Add ${esc(label)} from ${esc(dayLabel(from))} to ${esc(dayLabel(day))}?</p><ul>${rows.map(e => `<li>${!meal?esc(MEAL_NAMES[e.meal])+': ':''}${esc(e.name)} · ${esc(fmtAmount(e))}</li>`).join('')}</ul><button class="primary wide" id="ym-save">Add to today</button><p class="small danger" id="ym-error" role="alert"></p>` : `<p>${meal?'No foods were logged for this meal yesterday.':'No food was logged yesterday.'}</p><button class="primary wide" id="ym-usual">Choose from your usuals</button>`;
      if (!rows.length) { $('#ym-usual', b).onclick = () => { if (!live()) return; close(); addSheet(day, meal); }; return; }
      // Keep the same upload identities when a response is lost and this preview is retried.
      const items = rows.map(({meal:sourceMeal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref}) => ({day,meal:meal||sourceMeal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref,entry_method:'copy_yesterday',client_id:newId()}));
      let busy = false, done = false;
      $('#ym-save', b).onclick = async e => {
        if (!live() || busy || done) return;
        busy = true; const button = e.currentTarget; button.disabled = true; button.textContent = 'Logging…';
        $('#ym-error', b).textContent = '';
        try {
          const result = await addEntries(items);
          if (readOwner() !== owner) return;
          done = true; close(); Native.haptic('light');
          toast(result.queued?'Food saved on this phone · waiting to send':meal?'Meal logged':'Foods logged',result.undo);
        }
        catch(x) { if (live()) $('#ym-error', b).textContent = x.message + ' Your meal is ready to retry.'; }
        finally { busy = false; if (live() && !done) { button.disabled = false; button.textContent = 'Add to today'; } }
      };
    }).catch(x => { stopSkeleton(); if (live()) { b.innerHTML = '<p>The previous day could not load.</p><button class="primary wide" id="ym-retry">Try again</button>'; $('#ym-retry',b).onclick = () => { if (!live()) return; close(); yesterdayMeal(day,meal); }; } });
  });
}

// Display units never round the canonical amount used by source validation.
function foodPortion(e) {
  const ref=e.ref||{},src=ref.origin==='catalog'&&ref.source!=='custom'&&e.unit==='g'?ref.origin_ref||ref:ref,s=src.serving||{},mass={g:1,oz:28.3495,kg:1000,lb:453.592};
  const declared=s.g>0&&!s.is_default&&(s.g!==100||s.is_default===false||!['off','usda'].includes(src.source));
  const label=(s.label||'').trim(),match=label.match(/^(?:(\d+(?:\.\d+)?)(?:\/(\d+))?\s*)?([a-z]+)\b/i);
  const count=match?(Number(match[1]||1)/Number(match[2]||1)):1,house=match?.[3].toLowerCase().replace(/([^s])s$/,'$1');
  const serving=e.unit==='serving'?1:mass[e.unit]&&declared?s.g/mass[e.unit]:e.unit===house?count:null;
  const grams=mass[e.unit]||(declared&&serving?s.g/serving:null);
  const units=[{key:'g',label:'g',factor:grams?1/grams:null},{key:'oz',label:'oz',factor:grams?mass.oz/grams:null}];
  if(house&&!mass[house]&&house!=='serving'&&count>0&&serving)units.push({key:house,label:house,factor:serving/count});
  units.push({key:'serving',label:'serving',factor:serving});
  if(!units.some(u=>u.key===e.unit))units.push({key:e.unit,label:e.unit,factor:1});
  const identitySource=ref.id?ref:ref.origin_ref||ref;
  const identity=identitySource.id?[identitySource.source,identitySource.id]:[e.name,e.brand,label,s.g];
  const key='fit.food.unit:'+JSON.stringify([Native.base||location.origin,App.me?.id,identity]);
  let unit=store.get(key)||e.unit,amount=e.amount;if(!units.some(u=>u.key===unit&&u.factor))unit=e.unit;
  const current=()=>units.find(u=>u.key===unit);
  const fit=()=>{if(amount>0&&amount/current().factor<.005){const u=units.find(x=>x.factor&&amount/x.factor>=.005);if(u)unit=u.key;}};fit();
  const format=()=>String(Number((amount/current().factor).toFixed(2)));
  return {units,get unit(){return unit;},get amount(){return amount;},format,
    select:u=>{if(units.some(x=>x.key===u&&x.factor))unit=u;fit();},
    step:n=>{const next=amount+n*current().factor;if(next>0)amount=next;},
    input:text=>{const n=Number(text.replace(',','.'));amount=n>0&&Number.isFinite(n)?n*current().factor:NaN;},
    remember:()=>store.set(key,unit)};
}
function portionOptions(p){return p.units.map(u=>`<option value="${esc(u.key)}"${u.key===p.unit?' selected':''}${u.factor?'':' disabled'}>${esc(u.label)}</option>`).join('');}
const portionWeightNote=p=>p.units.find(u=>u.key==='g').factor?'':'<p class="small muted">g and oz need a known serving weight.</p>';

// nutrition for an amount of a normalised food (per100 / per_serving + serving grams)
function scaleFood(f, amount, unit) {
  const out = {};
  for (const k of FOOD_NUTRIENTS) {
    let v = null;
    if (f._per_unit && unit===f._unit) v=f._per_unit[k]==null?null:f._per_unit[k]*amount;
    else if (f._unit && !f.per100 && f.per_serving) v = f.per_serving[k] == null ? null : f.per_serving[k] * amount;    // a recent food: per the unit it was logged in
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
const NMORE = [['reminders', 'Meal reminders', 'Optional nudges at your usual meal times', 'bell', 'c-orange'],
  ...(!Native.on ? [['import', 'Add past days', 'Weight and calories from another app', 'upload', 'c-grey']] : [])];
const NRANGED = ['overview', 'energy', 'macros'];
function nHead(el, view, filters) {
  const v = [...NLOG, ...NPROG].find(m => m[0] === view), inProgress = location.pathname === '/progress';
  const q = new URLSearchParams(location.search), fromProgress = q.get('from') === 'progress';
  const saved = fromProgress ? App.progressHome : App.nutritionHome;
  const home = saved?.owner === readOwner() ? saved.href : fromProgress ? '/progress' : '/food';
  const detail = view !== 'log', title = detail ? view === 'needs' ? 'Food target' : v?.[1] || 'Food calendar' : 'Nutrition';
  el.classList.add(detail ? 'nutrition-detail' : 'nutrition-home');
  el.innerHTML = `<div class="top">${detail&&!inProgress?`<a class="back nutrition-back${fromProgress?' progress-back':''}" href="${esc(home)}" aria-label="Back to ${fromProgress?'Progress':'Nutrition'}">${svg('back')}${fromProgress?'Progress':'Nutrition'}</a>`:''}<h1>${esc(title)}</h1><div class="acts"><button class="icon-btn" id="n-help" aria-label="Nutrition help">${svg('help')}</button>${bellBtn()}</div></div>${view==='overview'?`<div class="insights-range">${filters}</div><div id="insights-range-dates" class="insights-range-dates" aria-live="polite"></div>`:detail?'':`<div class="nutrition-date-row">${filters}</div>`}<div id="n-body"><div id="nt-body">${skel(1)}</div></div>`;
  const body = $('#n-body',el);
  if (detail) { Discovery.visit('nutrition',view); if(view!=='overview')progressFilters(el,body,filters,{selector:NRANGED.includes(view)?'#nt-body .card':'.card'}); }
  $('#n-help', el).onclick = () => sheet('About your nutrition', `<p>For more accurate calorie estimates, update your weight, height, birth year (age) and sex in <a href="/me?setup=body">Me → Body &amp; heart rate</a>.</p><p class="small muted">Your daily balance compares food logged with estimated burn for the whole day. It becomes useful when you’ve finished logging.</p><p class="small">Edit ingredients and totals in <a href="/food/meals">My Recipes</a>. Tap a logged food to change just that entry.</p>`, (b, close) => $$('a', b).forEach(a => a.addEventListener('click', close)));
  return body;
}
async function foodDiscovery(el) {
  const box=$('#fd-explore',el),owner=readOwner();
  if(!box)return;
  box.innerHTML='<h2 class="sec-head">Explore your food</h2><div class="progress-grid explore-list" id="nutrition-explore"></div>';
  const grid=$('#nutrition-explore',box),facts={food:null,health:undefined};let ready=false;
  const valid=()=>box.isConnected&&owner===readOwner();
  const draw=()=>{
    if(!valid())return;
    const f=facts.food,change=f?.weight_change_kg;
    const items=[
      {id:'recipes',title:'Recipes & cooking',description:'',icon:'pot',href:'/food/meals',teaser:f?.library_items>0?`${f.library_items} saved ${f.library_items===1?'item':'items'}`:null},
      {id:'overview',title:'Insights',description:'',icon:'sparkle',href:'/food?view=overview',teaser:Number.isInteger(f?.protein_days)?`Protein goal ${f.protein_days}/7`:f?.logged_days>0?`${f.logged_days} logged days`:null},
      {id:'weight',title:'Weight',description:'',icon:'scale',href:'/progress/weight?from=nutrition',teaser:change!=null?change===0?'Weight trend is steady':`${change<0?'−':'+'}${U.weight(Math.abs(change))} ${imp()?'lb':'kg'} trend`:f?.weight_kg!=null?`${U.weight(f.weight_kg)} ${imp()?'lb':'kg'} last logged`:null},
      {id:'goals',title:'Calorie & macro goals',description:'',icon:'target',href:'/food?goals=1'},
      {id:'needs',title:'Calorie needs',description:'',icon:'target',href:'/food?view=needs'},
      {id:'calendar',title:'Food calendar',description:'',icon:'calendar',href:'/food?view=calendar',teaser:f?.logged_days>0?`${f.logged_days} logged days`:null},
      {id:'reminders',title:'Meal reminders',description:'',icon:'bell',href:'/me/notifications',teaser:f?.reminders_on?'On · Review times':null},
      ...(Native.on?[{id:'health',title:'Health app sync',description:'',icon:'heart',href:'/track/health',teaser:facts.health&&facts.health!=='unavailable'?facts.health:null}]:[{id:'import',title:'Add past days',description:'',icon:'upload',href:'/food/import'}])
    ];
    // These are established destinations. Only render a second line for account-specific facts;
    // generic unvisited links are not new features and should not get a blue dot.
    Discovery.render(grid,items,{space:'nutrition',ready,attribute:'data-nutrition-feature'});
    grid.querySelectorAll('.progress-new').forEach(node=>node.remove());
  };
  Discovery.wire(grid,'nutrition',{attribute:'data-nutrition-feature'});draw();
  await Promise.allSettled([
    load('/api/progress/overview',o=>{if(valid()){facts.food=o.food;draw();}},{maxAge:30000}),
    ...(Native.on?[Promise.all([api('/api/health/nutrition'),Native.foodHealthOn('nutrition')]).then(([server,local])=>{if(valid()){facts.health=server.enabled?(local?'On for this iPhone':'Set up on this iPhone'):null;draw();}}).catch(()=>{if(valid())facts.health='unavailable';})]:[])
  ]);
  ready=true;draw();
}
route(/^\/food$/, 'food', async (el) => {
  const q = new URLSearchParams(location.search), v0 = q.get('view') || 'log';
  const view = v0 === 'trends' ? 'overview' : [...NLOG, ...NPROG].some((m) => m[0] === v0) ? v0 : 'log';   // "trends": the old address
  if(view==='weight')return go(weightAddress(q),{replace:true});
  if (view !== 'log') return nutritionView(el, view, q);
  const day = q.get('d') || foodToday(), today = foodToday();
  const homeQuery=new URLSearchParams(q);homeQuery.delete('goals');
  App.nutritionHome = {owner:readOwner(),href:location.pathname+(homeQuery.size?'?'+homeQuery:'')};
  const body = nHead(el, 'log', `<button class="icon-btn" id="fd-prev" aria-label="Previous day">${svg('back')}</button><label class="range-btn daypick">${svg('calendar')}<span>${esc(dayLabel(day))}</span><input type="date" id="fd-date" value="${esc(day)}" aria-label="Pick a day to log or edit"></label>
      <button class="icon-btn" id="fd-next" aria-label="Next day">${svg('chev')}</button>${day===today?'':'<button class="me-chip" id="fd-today">Today</button>'}`);
  const camera = Native.on || !!navigator.mediaDevices?.getUserMedia;
  body.innerHTML = `<div class="quick nutrition-add"><button class="primary" id="fq-add">${svg('search')} Add food</button>${camera?`<button class="icon-btn" id="fq-photo" aria-label="Take a food photo">${svg('camera')}</button><button class="icon-btn" id="fq-scan" aria-label="Scan a food barcode">${svg('barcode')}</button>`:''}</div><div id="fd-sum">${skelFood()}</div><div id="fd-meals"></div><section id="fd-explore"></section><div id="fd-details"></div>`;
  $('#fd-prev', el).onclick = () => go(`/food?d=${addDays(day, -1)}`, {replace: true});
  $('#fd-next', el).onclick = () => go(`/food?d=${addDays(day, 1)}`, {replace: true});
  const bt = $('#fd-today', el); if (bt) bt.onclick = () => go('/food', {replace: true});
  // tap the date: a calendar to jump to any day, to log it or fix it
  const dp = $('#fd-date', el);
  dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* the browser opens its own picker */ } };
  dp.onchange = () => { if (dp.value) go(dp.value === today ? '/food' : `/food?d=${dp.value}`, {replace: true}); };
  $('#fq-add', el).onclick = () => describeSheet(q.get('d'),null);
  const photo=$('#fq-photo',el),scan=$('#fq-scan',el);
  if(photo)photo.onclick=()=>describeSheet(q.get('d'),null,'snap');
  if(scan)scan.onclick=()=>describeSheet(q.get('d'),null,'scan');
  let openedGoals=false;
  const dayPath=`/api/food/day?d=${day}`;
  const cached=!!((typeof screenHit==='function'&&screenHit(dayPath))||App.cache.has(dayPath)||kept(dayPath));
  const paint=PaintGate.begin(el,'nutrition',{cached});
  // The discovery list is below the first fold. Start it alongside the day read so its
  // placeholder and any cached teaser exist before the gated Nutrition content is shown.
  if(el.isConnected)foodDiscovery(el);
  const dayRead=load(dayPath, (D) => {
    drawDay(el,D);
    if(q.get('goals')==='1'&&!openedGoals&&el.isConnected){openedGoals=true;Discovery.visit('nutrition','goals');goalSheet(D);}
  }, {maxAge:5000});
  await paint.finish(dayRead);
  if (q.get('add') === '1' && el.isConnected) {
    history.replaceState(null, '', '/food'); describeSheet(q.get('d'),null);
  }
});

// Someone who has never logged food sees one entry action and optional targets. (2026-10-12; restored in
// the 2026-10-18 UI pass, it had been left unused)
function firstFood(box, day) {
  box.innerHTML = `<a class="card nutrition-start" href="/food/setup"><span><b>Set daily goals <small class="muted">optional</small></b><small class="muted">Choose calories and protein to aim for</small></span>${svg('chev')}</a>`;
}

function drawDay(el, D) {
  App.mealHours = D.meal_hours || App.mealHours;
  const t = D.targets || {}, T = D.totals, B = D.burned || {kcal: 0, n: 0, items: []}, G = D.goal || {}, today = dayLabel(D.day) === 'Today';
  const watchResting = B.source === 'apple_health';
  const eaten = T.kcal, goal = G.kcal, left = goal != null ? goal - eaten : null, sofar = today ? ' so far' : '';
  const goalNote = goal == null ? 'No calorie goal yet. Tap Set goals to add one.'
    : G.custom != null ? `Goal set for this day${G.default ? ` (your usual is ${r0(G.default)})` : ''}.`
    : '';
  // signs (2026-10-13, Ben): what you eat counts up (+), what you burn counts down (−), so the deficit comes out negative
  const neg = (v) => (Math.round(v) ? '−' : '') + r0(Math.abs(v)), pos = (v) => (Math.round(v) ? '+' : '') + r0(v);
  const row = (label, v, cls = '', sub = '') => `<div class="brow ${cls}"><span>${label}${sub ? `<small class="muted">${sub}</small>` : ''}</span><b class="num">${v}</b></div>`;
  // one card (2026-10-12 redesign): calories, macros, then the day's balance, with how it adds up folded underneath
  const energyDetails = B.day_burn != null && (watchResting || B.deficit != null);
  const restingSourceLink = `<a class="small more-link" id="fd-resting-source" href="/food?view=needs">Resting calories: ${watchResting ? 'Health app' : 'Kinetta estimate'} · change ›</a>`;
  const fresh = !D.has_history && !D.entries.length && goal == null;
  $('#fd-details',el).replaceChildren();
  if (fresh) firstFood($('#fd-sum', el), D.day);
  else {
    const hasGoal=Number.isFinite(Number(goal))&&Number(goal)>0,ringState=!hasGoal?'no-goal':eaten>goal?'over':eaten>=goal?'reached':'on-track';
    const reached=hasGoal&&eaten>=goal,summaryRoot=$('#fd-sum',el),pulseRing=reached&&summaryRoot.dataset.calorieRingPulseDay!==D.day;
    if(pulseRing)summaryRoot.dataset.calorieRingPulseDay=D.day;
    const ringProgress=hasGoal?Math.min(1,Math.max(0,eaten/goal)):0,circumference=339.292;
    const ringValue=hasGoal?Math.min(Math.max(0,Math.round(eaten)),Math.round(goal)):Math.max(0,Math.round(eaten));
    const ringAria=hasGoal?`${r0(Math.max(0,eaten))} of ${r0(goal)} calories${ringState==='over'?', above goal':''}`:`${r0(Math.max(0,eaten))} calories logged; no goal set`;
    summaryRoot.innerHTML = `<div class="card tcard balance nutrition-day-summary"><div class="nutrition-summary-tools"><a class="nutrition-goals icon-btn" id="fd-goal" href="/food/setup" aria-label="Calorie and macro goals">${svg('gear')}</a></div><div class="nutrition-summary">
      <a class="nutrition-summary-link" href="/food?view=overview" data-ring-state="${ringState}"><span class="vh">Nutrition overview and details. </span>
        <div class="calorie-ring-wrap"><svg class="calorie-ring${pulseRing?' goal-reached-pulse':''}" viewBox="0 0 128 128" role="progressbar" aria-label="Calories eaten" aria-valuemin="0" aria-valuemax="${hasGoal?Math.round(goal):Math.max(1,Math.round(eaten))}" aria-valuenow="${ringValue}" aria-valuetext="${esc(ringAria)}" focusable="false">
          <defs><linearGradient id="calorie-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2868ed"/><stop offset="58%" stop-color="#2879d4"/><stop offset="100%" stop-color="#0b9290"/></linearGradient></defs>
          <circle class="calorie-ring-track" cx="64" cy="64" r="54"/><circle class="calorie-ring-arc" cx="64" cy="64" r="54" stroke-dasharray="${circumference}" stroke-dashoffset="${(circumference*(1-ringProgress)).toFixed(3)}"/>
        </svg><div class="calorie-ring-label"><span class="nutrition-count hero-number" data-count-target="${Math.round(Math.max(0,eaten))}">0</span><small>${hasGoal?`of ${r0(goal)}`:'logged'}</small></div></div>
        <div class="nutrition-macros"><div class="macro-bars">${MACROS.map(([k,name])=>{const target=t[k.replace('_g','_target')],hasTarget=target!=null&&Number.isFinite(Number(target))&&Number(target)>0,unknown=Number(D.unknown_nutrients?.[k]||0)>0,amount=Number(T[k])||0,state=unknown?'unknown':!hasTarget?'unset':amount>target?'over':'under',width=hasTarget&&!unknown?Math.min(1,amount/target):0,value=unknown?'Unknown':`${r0(amount)}${hasTarget?` / ${r0(target)}`:''}`;return `<div class="macro m-${k}" data-macro="${k}" data-target-state="${state}"><div class="macro-line"><b>${value}</b><span>${name} · g</span></div><div class="track" aria-hidden="true"><div class="bar macro-target-bar${state==='over'?' over':''}${state==='unknown'||state==='unset'?' unavailable':''}" data-w="${width.toFixed(3)}"></div></div></div>`}).join('')}</div></div></a>
      </div>
      <div class="nutrition-secondary">${D.entries.length?extraTotals(extraCoverage(D.entries,t)):''}
      ${!energyDetails && goalNote ? `<p class="small muted tc-note">${esc(goalNote)}</p>` : ''}
      ${!t.protein_target ? '<button class="linkbtn tc-settg" id="fd-targets">Set macro targets</button>' : ''}
      ${!watchResting && B.deficit == null ? '<p class="small muted tc-bal">Log food to see your deficit for this day.</p>' : B.day_burn == null ? `<p class="small muted tc-bal">Resting calories have not synced for this day. Activities: ${r0(B.kcal)} kcal. Total burn is waiting for resting data.</p>`
        : `<details class="bd tc-bal"${!today && bdOpen() ? ' open' : ''}><summary><span>${today ? watchResting ? 'Energy balance so far' : 'Daily energy breakdown' : B.deficit == null ? 'Energy breakdown' : B.deficit >= 0 ? 'Deficit' : 'Surplus'}<small class="muted">${watchResting ? ' · Health resting + activities' : ' · estimate'}</small></span>
            <b class="num${today ? ' day-balance-detail' : ''}">${B.deficit == null ? neg(B.day_burn) : B.deficit >= 0 ? neg(B.deficit) : pos(-B.deficit)}<i> kcal</i></b><span class="chev">${svg('chev')}</span></summary>
        ${goalNote ? `<p class="small muted tc-note">${esc(goalNote)}</p>` : ''}
        ${B.partly ? '<p class="small muted">Looks only partly logged, so this day is left out of your averages and totals. Add the rest and it counts.</p>' : ''}
        ${row(watchResting ? 'Resting calories · Health app' : 'Resting burn (BMR)', neg(B.bmr), '', watchResting ? `${today ? 'synced so far' : 'synced daily total'}${B.observed_at ? ` · read ${esc(when(B.observed_at))}` : ''}` : B.bmr_exact ? 'Kinetta estimate' : 'rough guess · <a href="/me">add height & age</a>')}
        ${watchResting ? '' : row('Everyday activity', neg(B.daily_life), '', `${esc((B.activity || '').toLowerCase())} · <a href="/food?view=needs">change</a>`)}
        ${B.items.length ? B.items.map((a) => row(`<a href="/activity/${a.id}"><span class="exi sp ${esc(a.sport)}">${svg(a.sport)}</span>${esc(a.name)}</a>`, neg(a.kcal) + (a.estimated ? '*' : ''), 'ex', a.distance_m ? `${U.dist(a.distance_m, 1)} ${U.du()}` : '')).join('')
                         : row('Exercise', '0', 'ex', 'no workouts this day')}
        ${row(today ? watchResting ? 'Burned so far' : 'Burned by end of day' : 'Total burned', neg(B.day_burn), 'sum', today ? watchResting ? 'synced resting calories + activities already in Kinetta' : 'estimate for the whole day' : '')}
        ${row('Eaten' + sofar, pos(eaten))}
        ${!watchResting && G.deficit != null && (today || D.entries.length) ? `<p class="small muted">Eating exactly your goal would be a ${G.deficit >= 0 ? 'deficit' : 'surplus'} of ${r0(Math.abs(G.deficit))} kcal.${B.items.some((a) => a.estimated) ? ' * exercise estimated from distance/time and weight.' : ''}</p>` : ''}
        ${watchResting ? `<p class="small muted">Your food goal stays independent of calories burned.${today ? ' Resting calories build throughout the day; this is not a full-day projection.' : ''}${B.items.some(a=>a.estimated) ? ' * Activity calories are estimated when no recorded value is available.' : ''}</p>` : ''}<a class="small more-link" href="/food?view=energy">Running total ›</a>${restingSourceLink}</details>`}${energyDetails ? '' : restingSourceLink}</div></div>`;
  }
  if (!watchResting && !B.bmr_exact) $('#fd-sum',el).insertAdjacentHTML('beforeend','<a class="small nutrition-body-prompt" href="/me?setup=body">Improve calorie estimates · add body details</a>');
  const secondary=$('.nutrition-secondary',el);
  if(secondary){secondary.classList.add('card');$('#fd-details',el).replaceChildren(secondary);}
  const tb = $('#fd-targets', el); if (tb) tb.onclick = () => targetsSheet();
  const bd = $('details.bd', el); if (bd) bd.ontoggle = () => { try { localStorage.setItem('fit.bd', bd.open ? '1' : ''); } catch (e) { /* no storage */ } };
  // No usual target yet: Set goals opens the full goal setup rather than a one-day override.
  const gb = $('#fd-goal', el); if (gb) gb.onclick = (event) => { event.preventDefault(); return G.default == null && goal == null ? go('/food/setup') : goalSheet(D); };
  const by = {breakfast: [], lunch: [], dinner: [], snacks: []}; for (const e of D.entries) by[e.meal].push(e);
  $('#fd-meals', el).innerHTML = `<section class="card nutrition-meals-group">${Object.keys(MEAL_NAMES).map((m) => {
    const list = by[m], kc = list.reduce((s, e) => s + e.kcal, 0);
    const heading=`<h2><span>${MEAL_NAMES[m]}</span>${list.length?`<span class="muted small num meal-total">${r0(kc)} kcal</span>`:''}<span class="meal-actions"><button class="icon-btn" data-add="${m}" aria-label="Meal actions for ${MEAL_NAMES[m].toLowerCase()}">${svg('plus')}</button></span></h2>`;
    if (!list.length) return `<section class="meal meal-empty meal-${m}">${heading}<div class="meal-empty-state"><span><b>Nothing logged yet</b></span></div>${sameYesterdayMealMarkup(D,m,today)}</section>`;
    return `<section class="meal meal-${m}">${heading}
      ${list.map((e) => { const fe = `<button class="fe${e.pending ? ' pending' : ' sw-row'}" data-id="${e.id}"><span class="vh">Edit </span><div class="meal-food"><span class="meal-food-copy"><b>${esc(e.name)}</b><small class="muted">${e.pending ? 'Waiting to send · ' : ''}${esc(fmtAmount(e))}${e.brand ? ' · ' + esc(e.brand) : ''}</small></span></div>
        <span class="nutrition-row-calories"><b class="num">${r0(e.kcal)}</b></span></button>`;
        // swipe left to remove (with Undo); Remove is also in the food's editor and the meal's Edit menu
        return e.pending ? fe : `<div class="swipe"><button type="button" class="sw-del" data-del="${e.id}" tabindex="-1">${svg('trash')}Remove</button>${fe}</div>`; }).join('')}
      </section>`;
  }).join('')}</section>`;
  $$('[data-usual-meal]',el).forEach(b=>b.onclick=()=>addSheet(D.day,b.dataset.usualMeal));
  $$('[data-add]', el).forEach((b) => b.onclick = () => mealActionsSheet(D, b.dataset.add));
  $$('[data-repeat-yesterday]',el).forEach(b=>b.onclick=()=>repeatYesterdayMeal(D,b));
  $$('.meal', el).forEach((card) => swipeRows(card, (id) => removeFoodEntry(D.entries.find((e) => String(e.id) === id), {button: $(`.sw-del[data-del="${id}"]`, card)})));
  $$('[data-id]', el).forEach((b) => b.onclick = () => {
    const e = D.entries.find((x) => String(x.id) === b.dataset.id);
    if (e.pending) { toast('Saved on this phone - it sends when you are back online'); return; }
    entrySheet(e, D.day);
  });
  animateNutritionCount(el);
}
function animateNutritionCount(root) {
  const count = $('.nutrition-count', root), target = Number(count?.dataset.countTarget);
  if (!count || !Number.isFinite(target)) return;
  const paint = value => { count.firstChild.nodeValue = r0(Math.round(value)); };
  if (root.dataset.nutritionCountSeen === '1') { paint(target); return; }
  root.dataset.nutritionCountSeen = '1';
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { paint(target); return; }
  const start = performance.now(), duration = 420;
  const tick = now => {
    const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
    paint(target * eased);
    if (progress < 1 && count.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function sameYesterdayMealMarkup(D,meal,today) {
  const previous=D.last_meals?.[meal],items=previous?.items;
  if(!today||D.entries.some(entry=>entry.meal===meal)||!Array.isArray(items)||!items.length)return '';
  const yesterday=new Date(Date.parse(`${D.day}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  if(previous.day!==yesterday)return '';
  const names=items.map(item=>String(item.name||'').trim()).filter(Boolean),shown=names.slice(0,2);
  if(!shown.length)return '';
  const calories=Number.isFinite(previous.kcal)?`${r0(previous.kcal)} kcal`:null;
  const label=`Same as yesterday · ${calories||`${shown.map(esc).join(', ')}${names.length>2?` +${names.length-2}`:''}`}`;
  const accessible=calories?`${calories}. ${names.join(', ')}`:names.join(', ');
  return `<button type="button" class="meal-yesterday-repeat" data-repeat-yesterday="${esc(meal)}" aria-label="${label}. Repeat yesterday’s ${esc(MEAL_NAMES[meal].toLowerCase())}: ${esc(accessible)}">${label}</button>`;
}
async function repeatYesterdayMeal(D,button) {
  const meal=button.dataset.repeatYesterday;
  const owner=readOwner(),source=D.last_meals?.[meal]?.items||[];
  if(button.disabled||!source.length||D.day!==foodToday()||D.entries.some(entry=>entry.meal===meal))return;
  button.disabled=true;
  const items=source.map(entry=>({...entry,day:D.day,meal,entry_method:'copy_yesterday'}));
  try{await addEntries(items,{toastText:`Added ${items.length} item${items.length===1?'':'s'}`});}
  catch(error){if(readOwner()===owner)toast(error.message);}
  finally{if(readOwner()===owner&&button.isConnected)button.disabled=false;}
}
function servingAmount(e) {
  const label = e.ref?.serving?.label?.trim();
  if (!label || /^1?\s*(?:serving|portion)s?$/i.test(label)) return `${r1(e.amount)} serving${e.amount === 1 ? '' : 's'}`;
  // Keep the estimate's household unit and fractional precision; a serving may
  // be a cup, a fluid ounce or a named portion. Never infer a weight from it.
  const unit = label.match(/^1\s+(cups?|fl\.?\s*oz|fluid ounces?|bowls?|slices?|pieces?|tbsp|tsp|tablespoons?|teaspoons?|ml|liters?|litres?|cans?|bottles?|glasses?|bars?|scoops?|packets?|mugs?|tacos?)$/i);
  const amount = Number(Number(e.amount).toFixed(3));
  if (unit) return `${amount} ${unit[1]}`;
  return amount === 1 ? label : `${amount} × ${label}`;
}
const fmtAmount = (e) => (e.unit === 'g' ? `${r1(e.amount)} g` : /^of /.test(e.unit) ? `${r1(e.amount)} ${e.unit}` : e.unit === 'serving' ? servingAmount(e) : `${r1(e.amount)} × ${e.unit === 'dish' ? 'meal' : e.unit}`);
let foodRefreshFrame=null;
document.addEventListener('food:changed',()=>{
  if(location.pathname!=='/food'||foodRefreshFrame!=null)return;
  const owner=readOwner(),page=$('#page');
  foodRefreshFrame=requestAnimationFrame(()=>{foodRefreshFrame=null;if(owner===readOwner()&&location.pathname==='/food'&&page===$('#page'))render();});
});
const refresh = () => { invalidate('/api/food'); if (location.pathname !== '/food/describe') render(); else if(typeof FoodThread!=='undefined')FoodThread.refresh(); }; // keep a live full-page food conversation until its own confirmation navigates

function recentSavedItems(dishes, meals) {
  const recent = [
    ...dishes.filter(d => d.last_used_at && d.last_used_portion && d.totals.kcal != null).map(item => ({kind:'dish',id:item.id,item,name:item.named?item.name:'Untitled recipe',at:item.last_used_at,entryId:item.last_used_entry_id})),
    ...meals.filter(m => m.last_used_at && m.last_used_entry_id).map(item => ({kind:'meal',id:item.id,item,name:item.name,at:item.last_used_at,entryId:item.last_used_entry_id}))
  ];
  return recent.sort((a,b) => Date.parse(b.at)-Date.parse(a.at) || b.entryId-a.entryId || b.id-a.id || a.kind.localeCompare(b.kind)).slice(0,5);
}
function recentPortionLabel(recent) {
  if (recent.kind === 'meal') return `${r1(recent.item.last_used_factor || 1)} serving${recent.item.last_used_factor === 1 ? '' : 's'}`;
  const portion=recent.item.last_used_portion;
  if (portion.grams != null) return `${r1(portion.grams)} g`;
  if (portion.count != null) return `${r1(portion.count)} serving${portion.count === 1 ? '' : 's'}`;
  return `${Math.round(portion.share*100)}% of recipe`;
}
function recentSavedMarkup(recent, {library=false}={}) {
  if (!recent.length) return '';
  const rows=recent.map((x,i)=>{
    const portion=recentPortionLabel(x),calories=x.item.totals.kcal==null?'Calories unknown':`${x.kind==='dish'?recipeCalories(x.item.totals.kcal):r0(x.item.totals.kcal)} kcal`;
    return `<div class="recent-saved-row" data-recent-row data-recent-index="${i}">
      <button type="button" class="fe recent-main" data-recent-item data-recent-index="${i}" data-recent-kind="${x.kind}" data-recent-id="${x.id}" aria-label="Add ${esc(x.name)} with last portion ${esc(portion)}">
        <span class="recent-label"><b>${esc(x.name)}</b><small class="muted">Last portion · ${esc(portion)}</small></span><span class="recent-kcal num">${esc(calories)}</span>
      </button><button type="button" class="icon-btn recent-add choose-food-add" data-recent-add data-recent-index="${i}" data-recent-kind="${x.kind}" data-recent-id="${x.id}" aria-label="Add ${esc(x.name)} with last portion ${esc(portion)}">${svg('plus')}</button>
    </div>`;
  }).join('');
  return library?`<section class="library-section recent-saved" data-recent-saved><h2 data-type="secondary">Recent</h2>${rows}</section>`:`<section class="recent-saved" data-recent-saved><h3 class="ghead">Recent</h3><div class="results">${rows}</div></section>`;
}
async function logRecentMeal(meal, w) {
  const factor=Number(meal.last_used_factor)||1;
  const items=meal.items.map(it=>({...it,...w,amount:it.amount*factor,kcal:it.kcal==null?null:it.kcal*factor,protein_g:it.protein_g==null?null:it.protein_g*factor,
    carbs_g:it.carbs_g==null?null:it.carbs_g*factor,fat_g:it.fat_g==null?null:it.fat_g*factor,fiber_g:it.fiber_g==null?null:it.fiber_g*factor,
    ...Object.fromEntries(EXTRA_NUTRIENTS.map(([key])=>[key,it[key]==null?null:it[key]*factor])),
    source:'meal',ref:{...(it.ref||{}),saved_meal_id:meal.id,saved_meal_factor:factor}}));
  App.cache.delete('/api/food/meals');
  return addEntries(items,{thread:location.pathname==='/food/describe'});
}
function wireRecentSaved(body,recent,where,{afterDish=()=>{},afterMeal=()=>{}}={}) {
  $$('[data-recent-item],[data-recent-add]',body).forEach(button=>button.onclick=async()=>{
    const item=recent[+button.dataset.recentIndex],row=button.closest('[data-recent-row]'),w=where();
    if(!item||button.disabled||row?.dataset.busy==='true')return;
    if(item.kind==='dish'){
      if(item.item.totals.kcal==null){dishLogSheet(item.item,w,afterDish,{quickPortion:item.item.last_used_portion});return;}
      row.dataset.busy='true';$$('[data-recent-item],[data-recent-add]',row).forEach(control=>control.disabled=true);
      let locked=true;
      const unlock=()=>{if(!locked)return;locked=false;if(row.isConnected){delete row.dataset.busy;$$('[data-recent-item],[data-recent-add]',row).forEach(control=>control.disabled=false);}};
      dishLogSheet(item.item,w,(...args)=>{unlock();afterDish(...args);},{quickPortion:item.item.last_used_portion,onQuickFinish:unlock});
      return;
    }
    row.dataset.busy='true';$$('[data-recent-item],[data-recent-add]',row).forEach(control=>control.disabled=true);
    try{await logRecentMeal(item.item,w);afterMeal();}
    catch(e){toast(e.message);delete row.dataset.busy;$$('[data-recent-item],[data-recent-add]',row).forEach(control=>control.disabled=false);}
  });
}

async function addEntries(items,{thread=false,restoreFrom=null,silent=false,toastText=null}={}) {   // each item gets a client_id, so a resend after a lost connection never doubles it
  const owner=readOwner();
  if(thread&&typeof FoodThread!=='undefined'&&FoodThread.collecting()){const result=await FoodThread.stage(items);if(!silent)toast(result.queued?'Food draft saved on this phone · waiting to send':'Added for review');return result;}
  items = items.map((it) => ({...foodStorage(it), client_id: it.client_id || newId()}));
  const query=new URLSearchParams();if(thread){query.set('thread','true');query.set('captured_at',new Date().toISOString());}if(restoreFrom)query.set('restore_from',restoreFrom);
  const r = await sendOrQueue('/api/food/entries'+(query.size?'?'+query:''), 'POST', items, items.length === 1 ? items[0].name : `${items.length} foods`);
  if(readOwner()!==owner)return r;
  r.undo=foodUploadUndo(items,owner);
  r.batchItems=items;
  if (r.queued) {   // offline: show them now, marked "waiting to send"
    for (const it of items) patchDay(it.day, (d) => {
      d.entries.push({...it, id: 'q-' + it.client_id, pending: true});
      for(const k of FOOD_NUTRIENTS){d.totals[k]=(d.totals[k]||0)+(it[k]||0);if(d.unknown_nutrients&&(it[k]==null||it.ref?.unknown_nutrients?.includes(k)))d.unknown_nutrients[k]=(d.unknown_nutrients[k]||0)+1;}
    });
    if(location.pathname!=='/food/describe')render(); if(!silent)toast('Saved on this phone · waiting to send',r.undo); return r;
  }
  if(typeof FoodThread!=='undefined'&&r.messages){try{await FoodThread.accept(r);}catch(e){invalidate('/api/food');}}
  refresh(); if(!silent)toast(toastText||(items.length===1?`Logged ${items[0].name}`:'Meal logged'),r.undo); return r;
}
// Keep the cancellation durable before removing an upload: it may already be in flight.
function foodUploadUndo(items,owner) {
  const ids=new Set(items.map(it=>it.client_id));let busy=false,done=false;
  const undo=async()=>{
    if(busy||done||readOwner()!==owner)return;busy=true;
    try {
      const r=await sendOrQueue('/api/food/entries/undo','POST',{client_ids:[...ids],confirm:true},'Undo food');
      if(readOwner()!==owner)return;
      Q.save(Q.all().flatMap(op=>{
        if(!Q.owns(op)||op.path.split('?')[0]!=='/api/food/entries'||!Array.isArray(op.body))return [op];
        const body=op.body.filter(it=>!ids.has(it.client_id));return body.length?[{...op,body}]:[];
      }));netbar();
      for(const day of new Set(items.map(it=>it.day)))patchDay(day,d=>{
        const removed=d.entries.filter(e=>ids.has(e.client_id));d.entries=d.entries.filter(e=>!ids.has(e.client_id));
        for(const e of removed)for(const k of FOOD_NUTRIENTS){d.totals[k]=Math.max(0,(d.totals[k]||0)-(e[k]||0));if(d.unknown_nutrients&&(e[k]==null||e.ref?.unknown_nutrients?.includes(k)))d.unknown_nutrients[k]=Math.max(0,(d.unknown_nutrients[k]||0)-1);}
      });
      done=true;if(r.messages&&typeof FoodThread!=='undefined')await FoodThread.accept(r);
      if(!r.queued)refresh();else if(location.pathname!=='/food/describe')render();
      toast(r.queued?'Undo saved on this phone · waiting to send':r.kept?'Later-edited foods were kept. Check your food log.':'Food removed');
    }catch(e){if(readOwner()===owner)toast('Could not undo · try again',undo);}finally{busy=false;}
  };return undo;
}
async function copyDay(from, to, meal) {
  try { const r = await api('/api/food/copy', json('POST', {from_day: from, to_day: to, meal: meal || null})); refresh(); toast(r.copied ? `Copied ${r.copied} item${r.copied > 1 ? 's' : ''}` : 'Nothing to copy'); }
  catch (x) { toast(x.message); }
}
// The meal plus opens the scoped action sheet; routine add, edit and copy actions stay together.
function mealActionsSheet(D, meal) {
  const count=D.entries.filter(e=>e.meal===meal).length;
  const yesterday=foodToday();
  sheet(MEAL_NAMES[meal], `<div class="nutrition-meal-actions">
    <button type="button" class="nutrition-meal-action" data-meal-action="add"><span>Add food</span>${svg('chev')}</button>
    ${count?`<button type="button" class="nutrition-meal-action" data-meal-action="edit"><span>Edit foods and meal</span>${svg('chev')}</button>`:''}
    ${D.has_history?`<button type="button" class="nutrition-meal-action" data-meal-action="yesterday"><span>Same as yesterday</span>${svg('chev')}</button>`:''}
    ${D.day!==yesterday&&count?`<button type="button" class="nutrition-meal-action" data-meal-action="today"><span>Copy meal to today</span>${svg('chev')}</button>`:''}
  </div>`, (box, close) => {
    $('[data-meal-action="add"]',box).onclick=()=>{close();describeSheet(D.day,meal);};
    $('[data-meal-action="edit"]',box)?.addEventListener('click',()=>{close();mealMenu(D,meal);});
    $('[data-meal-action="yesterday"]',box)?.addEventListener('click',()=>{close();yesterdayMeal(yesterday,meal);});
    $('[data-meal-action="today"]',box)?.addEventListener('click',()=>{close();copyDay(D.day,yesterday,meal);});
  });
}
// Meal actions are scoped to the selected meal and day (a past meal can be copied to today).
function mealMenu(D, meal) {
  const list = D.entries.filter(e => e.meal === meal && !e.pending);
  const totals = Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g'].map(k => [k, list.reduce((n, e) => n + (e[k] || 0), 0)]));
  sheet(`Edit ${MEAL_NAMES[meal].toLowerCase()}`, `<p class="small muted">${esc(dayLabel(D.day))} · ${list.length} food${list.length === 1 ? '' : 's'}. Edit an item’s amount or nutrition, or remove it below.</p>
    ${nutGrid(totals)}<div class="card list mm-list">${list.map(e => `<div class="logged-food"><button class="fe" data-me="${e.id}" aria-label="Edit ${esc(e.name)} in ${MEAL_NAMES[meal]}"><div><b>${esc(e.name)}</b><small class="muted">${esc(fmtAmount(e))} · Edit</small></div>
      <div class="r meal-calories"><b class="num">${r0(e.kcal)}</b> <small class="muted">kcal</small></div></button><button class="linkbtn danger remove-food" data-remove-food="${e.id}" aria-label="Remove ${esc(e.name)} from ${MEAL_NAMES[meal]}">${svg('trash')}Remove</button></div>`).join('')}</div>
    <div class="btncol"><button class="ghost" id="mm-yesterday">Copy yesterday’s ${MEAL_NAMES[meal].toLowerCase()}</button><button class="primary" id="mm-add">${svg('plus')}Add food to ${MEAL_NAMES[meal]}</button>
    ${D.day !== foodToday() && list.length ? `<button class="ghost" id="mm-copy">Copy ${MEAL_NAMES[meal].toLowerCase()} to today</button>` : ''}
    <button class="ghost" id="mm-save"${list.length ? '' : ' disabled'}>Save these foods as a combination</button></div>`, (b, close) => {
    $$('[data-me]', b).forEach(x => x.onclick = () => { close(); entrySheet(list.find(e => String(e.id) === x.dataset.me), D.day); });
    $$('[data-remove-food]', b).forEach(x => x.onclick = () => removeFoodEntry(list.find(e => String(e.id) === x.dataset.removeFood), {button: x, after: close}));
    $('#mm-yesterday', b).onclick = () => { close(); yesterdayMeal(foodToday(), meal); };
    $('#mm-add', b).onclick = () => { close(); describeSheet(D.day, meal); };
    const cp = $('#mm-copy', b); if (cp) cp.onclick = () => { close(); copyDay(D.day, foodToday(), meal); };
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
      try { await addEntries([entry],{restoreFrom:e.id}); restored = true; }
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
  sheet('Edit food', `<div class="entry-edit-fields"><p class="entry-context"><b>${esc(e.name)}</b><small class="muted">${MEAL_NAMES[e.meal]} · ${esc(dayLabel(day))}</small></p><div id="es-nut">${nutGrid(e)}</div><form class="form" id="es">
    <label>Name<input name="name" value="${esc(e.name)}" maxlength="200"></label>
    <div class="two"><label>Amount<input name="amount" inputmode="decimal" value="${r1(e.amount)}"></label>
      <label>Unit<select name="unit">${unitOptions(ref, e.unit)}</select></label></div>
    ${macroInputs({...e,...Object.fromEntries((e.ref?.unknown_nutrients||[]).map(k=>[k,null]))})}
    <details class="entry-move"><summary>Move this food</summary><div class="two entry-when"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === e.meal ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Day<input class="datefield" name="day" type="date" value="${esc(day)}"></label></div></details>
    </form><div class="entry-more"><button type="button" class="linkbtn" id="es-again">${svg('plus')}Log again today</button>
      <button type="button" class="linkbtn danger" id="es-del">${svg('trash')}Remove from ${MEAL_NAMES[e.meal]}</button></div></div><div class="entry-edit-footer"><button class="primary wide" type="submit" form="es">Save changes</button></div>`, (b, close) => {
    guardFoodSheet(b,close,owner);const f = $('#es', b);
    b.closest('.sheet').classList.add('food-entry-editor');
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
      try { const result=await addEntries([{day: foodToday(), meal: guessMeal(), name: e.name, brand: e.brand, amount: e.amount, unit: e.unit, kcal: e.kcal,
        protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g,...Object.fromEntries(EXTRA_NUTRIENTS.map(([k])=>[k,e[k]??null])), source: e.source, ref: e.ref}],{thread:location.pathname==='/food/describe'}); close(); toast(result.queued?'Saved on this phone · waiting to send':`Logged ${e.name} again today`,result.undo); }
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
function addSheet(day, meal, find = '', tab = find ? 'search' : 'usuals') {
  const owner=readOwner();
  const zone=foodTimeZone(),destination={day:day||isoDay(new Date(),zone),meal:Object.hasOwn(MEAL_NAMES,meal)?meal:guessMeal(zone)};
  const batchItems=[],queuedIds=new Set();let pendingAdds=0,batchClosed=false,batchFinished=false;
  // One suggestions list inside Add food; meal cards show only what was actually logged.
  sheet('Choose food', `<div class="choose-food-context-wrap"><button type="button" id="as-context" class="choose-food-context"></button></div>
    <div id="as-tabs" class="choose-food-tabs" role="group" aria-label="Food type">${[['usuals', 'Usuals'], ['saved', 'Recipes'], ['search', 'Search'], ['quick', 'Quick']]
    .map(([k, n]) => `<button type="button" data-t="${k}" aria-pressed="${k===tab}">${n}</button>`).join('')}</div>
    <div id="as-body"></div>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const panel=b.closest('.sheet'),header=$('header',panel),dialogTitle=$('header h2',panel),closeButton=$('header [data-close]',panel);
    panel.classList.add('choose-food-multi');
    const updateTitle=()=>{const title=batchItems.length?`Choose food · ${batchItems.length} added`:'Choose food';dialogTitle.textContent=title;panel.setAttribute('aria-label',title);};
    const finishBatch=()=>{
      if(batchFinished||!batchClosed||pendingAdds)return;
      batchFinished=true;
      if(owner!==readOwner()||!batchItems.length)return;
      const count=batchItems.length,allQueued=batchItems.every(it=>queuedIds.has(it.client_id));
      const message=allQueued?`Saved ${count} food${count===1?'':'s'} on this phone`:`Added ${count} food${count===1?'':'s'} to ${MEAL_NAMES[destination.meal]}`;
      toast(message,foodUploadUndo(batchItems,owner));
    };
    const doneButton=document.createElement('button');
    doneButton.type='button';doneButton.className='sheet-text-btn food-multi-done';doneButton.textContent='Done';
    doneButton.onclick=()=>{if(pendingAdds)return;batchClosed=true;close.closeAll(true);finishBatch();};
    if(header.querySelector('[data-sheet-back]'))header.insertBefore(doneButton,closeButton);else header.insertBefore(doneButton,dialogTitle);
    const updateDone=()=>{doneButton.disabled=pendingAdds>0;};
    updateDone();
    if(typeof MutationObserver!=='undefined'){
      const observer=new MutationObserver(()=>{if(!panel.isConnected){batchClosed=true;observer.disconnect();finishBatch();}});
      observer.observe(document.body,{childList:true,subtree:true});
    }
    const addUsual=(button,entry,name,restoreLabel)=>{
      if(button.disabled||owner!==readOwner())return;
      const plusMarkup=button._foodPlusMarkup||(button._foodPlusMarkup=button.innerHTML);
      const subtitle=button.closest('.usual')?.querySelector('.fe small');
      if(subtitle&&!button._foodOriginalSubtitle)button._foodOriginalSubtitle={text:subtitle.textContent,className:subtitle.className};
      const originalSubtitle=button._foodOriginalSubtitle;
      if(subtitle&&originalSubtitle){subtitle.textContent=originalSubtitle.text;subtitle.className=originalSubtitle.className;}
      if(button._foodFeedbackTimer){clearTimeout(button._foodFeedbackTimer);button._foodFeedbackTimer=null;}
      button.disabled=true;button.removeAttribute('aria-busy');button.classList.remove('food-add-success','food-add-failed');button.textContent='';button.setAttribute('aria-label',restoreLabel);button.setAttribute('aria-busy','true');
      pendingAdds++;updateDone();
      (async()=>{
        try{
          const result=await addEntries([entry],{thread:location.pathname==='/food/describe',silent:true});
          if(owner!==readOwner()){close.closeAll(true);return;}
          if(!result.batchItems?.length){close.closeAll(true);toast(result.queued?'Food draft saved on this phone · waiting to send':'Added for review');return;}
          batchItems.push(...result.batchItems);if(result.queued)for(const it of result.batchItems)queuedIds.add(it.client_id);updateTitle();
          if(button.isConnected){button.textContent='✓';button.classList.add('food-add-success');button.setAttribute('aria-label',`Added ${name}`);button.removeAttribute('aria-busy');button._foodFeedbackTimer=setTimeout(()=>{button._foodFeedbackTimer=null;if(!button.isConnected)return;button.innerHTML=plusMarkup;button.classList.remove('food-add-success');button.disabled=false;button.setAttribute('aria-label',restoreLabel);},2000);}
        }catch(e){if(button.isConnected){if(subtitle){subtitle.textContent="Couldn't add";subtitle.className='food-add-error';}button.disabled=false;button.removeAttribute('aria-busy');button.classList.add('food-add-failed');button.textContent='↻';button.setAttribute('aria-label',`Retry adding ${name}`);}}
        finally{pendingAdds--;updateDone();finishBatch();}
      })();
    };
    const body = $('#as-body', b);
    const context=$('#as-context',b),where=()=>destination,drawContext=()=>{const label=[dayLabel(destination.day,zone),MEAL_NAMES[destination.meal]].join(' · ');context.innerHTML=`${esc(label)} ${svg('chev')}`;context.setAttribute('aria-label',`Change food day and meal. Adding to ${label}.`);};
    drawContext();context.onclick=()=>foodDestinationPicker(where(),next=>{destination.day=next.day;destination.meal=next.meal;drawContext();},'as-destination');
    const tabs = {search: tSearch, usuals: tUsuals, saved: tSaved, quick: tQuick};
    const show = (k) => { $$('[data-t]', b).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === k))); if(k==='usuals')tabs[k](body,where,close,addUsual);else tabs[k](body,where,close); };
    $$('[data-t]', b).forEach((x) => x.onclick = () => show(x.dataset.t));
    show(tab);
    if (find) { const q = $('#as-body input[type=search]', b); if (q) { q.value = find; q.oninput(); } }
  },{flow:'auto'});
}
const foodRow = (f, i) => `<button class="fe" data-i="${i}"><div><b>${esc(f.name)}</b><small class="muted">${esc([f.brand, f.serving && f.serving.label, f.source === 'usda' ? 'USDA' : f.source === 'off' ? 'Open Food Facts' : f.origin==='ai'?'Kit’s estimate'+(f.origin_edited?' · Edited':''):f.origin==='label'?'Nutrition label':f.source === 'custom' ? 'My food' : ''].filter(Boolean).join(' · '))}</small></div>
  <div class="r kcal-line"><b class="num">${r0(f.per_serving ? f.per_serving.kcal : f.per100 && f.serving ? f.per100.kcal * (f.serving.g || 100) / 100 : f.kcal)}</b><span> kcal</span></div></button>`;
function tSearch(body, where, close) {
  body.innerHTML = `<form id="ts-f" role="search"><input type="search" name="q" placeholder="Search foods, brands…" aria-label="Search foods and brands" autocomplete="off" enterkeyhint="search"></form><div id="ts-r" class="results"><p class="small muted">Your own foods and recent items come first, then USDA and Open Food Facts.</p></div>`;
  const inp = $('input', body), out = $('#ts-r', body); softFocus(inp);
  let timer, seq = 0, all = [];
  const draw = (groups) => {
    all = []; let html = '';
    for (const [title, list] of groups) if (list.length) { html += `<h3 class="ghead">${title}</h3>`; for (const f of list) { const i=all.length;html += `<div class="meal-library-row chooser-row">${foodRow(f,i)}<button type="button" class="icon-btn choose-food-add" data-search-add="${i}" aria-label="Add ${esc(f.name)}">${svg('plus')}</button></div>`; all.push(f); } }
    out.innerHTML = html || '<p class="small muted">No matches yet…</p>';
    $$('[data-i]', out).forEach((x) => x.onclick = () => amountSheet({...all[+x.dataset.i],entry_method:"search"}, where(), close));
    $$('[data-search-add]',out).forEach(x=>x.onclick=()=>amountSheet({...all[+x.dataset.searchAdd],entry_method:'search'},where(),close));
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
function recentToFood(r){
  const ref=r.ref||{},count=Number(r.amount),per=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,count>0&&nutrientKnown(r,k)?r[k]/count:null]));
  const sourceGrams=Number(ref.serving?.g),mass={g:1,kg:1000,oz:28.349523125,lb:453.59237}[r.unit];
  const grams=mass||(r.unit==='dish'?ref.weight_g:r.unit==='serving'&&sourceGrams>0?sourceGrams:null);
  const reference100=ref.per100||(sourceGrams>0&&ref.per_serving?Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,ref.per_serving[k]==null?null:ref.per_serving[k]*100/sourceGrams])):null);
  const per100=grams>0?Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,per[k]==null?null:per[k]*100/grams])):reference100;
  const servingGrams=sourceGrams>0?sourceGrams:r.unit==='g'?count:null;
  const servingValues=servingGrams&&per100?Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,per100[k]==null?null:per100[k]*servingGrams/100])):ref.per_serving||per;
  const original=ref.source||r.source||'recent',source=original==='dish'&&!ref.dish_id?'recent':original;
  return {...ref,source,name:r.name,brand:r.brand,per_serving:servingValues,per100,
    serving:{label:ref.serving?.label||(r.unit==='g'?`${count} g logged portion`:r.unit==='serving'?'1 serving':`1 ${r.unit}`),g:servingGrams||null},
    unknown_nutrients:FOOD_NUTRIENTS.filter(k=>!nutrientKnown(r,k)),_last:r,_unit:r.unit,_per_unit:per,_plain:!(ref.per100||ref.per_serving||ref.serving?.g||ref.dish_id)};
}

function sharedRecipeHtml(dishes,composer=false){if(!composer)return `<section class="shared-recipes"><h3>Shared with you</h3><div class="shared-recipe-list">${dishes.map((d,i)=>`<button type="button" class="shared-recipe-row" data-shared-recipe="${i}" aria-label="Log a portion of ${esc(d.name)}, shared by ${esc(d.owner.name)}"><span><b>${esc(d.name)}</b><small>From ${esc(d.owner.name)} · ${d.serving==='one'||!d.weight_g?'Choose your servings':'Choose your portion in grams'}</small></span>${svg('chev')}</button>`).join('')}</div></section>`;return `<section class="shared-recipes"><header><h3>Shared with you</h3><button type="button" class="shared-recipes-all" data-shared-see-all>See all</button></header><div class="shared-recipe-list">${dishes.slice(0,2).map((d,i)=>{const serving=d.serving==='one'||!d.weight_g?'Choose servings':'Choose portion in grams',calories=d.totals?.kcal;return `<button type="button" class="shared-recipe-row" data-shared-recipe="${i}" aria-label="Add ${esc(d.name)}, shared by ${esc(d.owner.name)}"><span class="shared-recipe-copy"><b>${esc(d.name)}</b><small>From ${esc(d.owner.name)} · ${serving}</small></span><span class="shared-recipe-kcal">${calories==null?'':`<b class="num">${esc(recipeCalories(calories))}</b><small>kcal</small>`}</span><span class="shared-recipe-add" aria-hidden="true">${svg('plus')} Add</span></button>`;}).join('')}</div></section>`;}
async function sharedRecipes(box,where,after=()=>{},isActive=()=>true){
  const owner=readOwner();if(!box)return;const version=box._sharedVersion=(box._sharedVersion||0)+1,valid=()=>box.isConnected&&version===box._sharedVersion&&owner===readOwner()&&isActive();
  if(!valid())return;const path='/api/dishes/shared',hit=App.cache.get(path),cached=hit?.owner===owner?hit.data:null;
  const draw=dishes=>{if(!valid())return;box.innerHTML=dishes.length?sharedRecipeHtml(dishes,!!box.closest?.('.food-thread')):'';
    $$('[data-shared-recipe]',box).forEach(button=>button.onclick=()=>{if(!valid())return;dishLogSheet(dishes[+button.dataset.sharedRecipe],where(),edit=>{if(!edit&&valid()){after();if(valid())sharedRecipes(box,where,after,isActive);}});});
    box.querySelector('[data-shared-see-all]')?.addEventListener?.('click',()=>{if(valid())box.closest('.food-thread')?.querySelector('#thread-recipes')?.click();});
    if(typeof document!=='undefined'&&document.documentElement.classList.contains('keyboard-open')){const form=box.closest('.thread-composer'),field=form?.querySelector('textarea');if(field&&document.activeElement===field)requestAnimationFrame(()=>{if(valid())field.parentElement.scrollIntoView({block:'nearest'});});}
  };
  const stopSkeleton=()=>{};
  if(cached)draw(cached);
  try{const dishes=await api(path);if(!valid())return;App.cache.set(path,{data:dishes,owner,at:Date.now()});draw(dishes);}
  catch(e){if(!valid())return;if(cached){draw(cached);box.querySelector('h3')?.insertAdjacentHTML('beforeend',' <small class="shared-saved">Saved</small>');return;}box.innerHTML='<p class="small muted">Shared recipes could not load. <button type="button" class="linkbtn" data-shared-retry>Retry</button></p>';box.querySelector('[data-shared-retry]').onclick=()=>sharedRecipes(box,where,after,isActive);}
  finally{stopSkeleton();}
}

async function tUsuals(body, where, close, addUsual=null) {
  body.innerHTML = '';
  const stopSkeleton = delayedSkeleton(body, skelFoodChooser());
  try {
    const [usual,dishes,meals] = await Promise.all([api('/api/food/usual'),api('/api/dishes'),api('/api/food/meals')]);
    stopSkeleton();
    const foods = usual.map(recentToFood);
    const recent=recentSavedItems(dishes,meals);
    const collecting=typeof FoodThread!=='undefined'&&FoodThread.collecting();
    const quick = (f, i) => `<div class="usual">${foodRow(f, i)}<button class="icon-btn qadd choose-food-add" data-q="${i}" aria-label="${collecting?'Add':'Log'} ${esc(f.name)} (${esc(fmtAmount(f._last))})">${svg('plus')}</button></div>`;
    const emptyHint=usual.length||recent.length?'':'<p class="small muted">Your usuals appear after you log a few foods.</p>';
    body.innerHTML = `${recentSavedMarkup(recent)}<div data-shared-usuals></div>`+(usual.length ? `<div class="results">${usual.map((_, i) => quick(foods[i], i)).join('')}</div>` : emptyHint);
    sharedRecipes($('[data-shared-usuals]',body),where,()=>close.closeAll(true));
    wireRecentSaved(body,recent,where,{afterDish:()=>close.closeAll(true),afterMeal:()=>close.closeAll(true)});
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close));
    $$('[data-q]', body).forEach((x) => x.onclick = async () => {
      const f = foods[+x.dataset.q], l = f._last, w = where(),entry={...w,name:l.name,brand:l.brand,amount:l.amount,unit:l.unit,kcal:l.kcal,protein_g:l.protein_g,carbs_g:l.carbs_g,
        fat_g:l.fat_g,fiber_g:l.fiber_g,...Object.fromEntries(EXTRA_NUTRIENTS.map(([k])=>[k,l[k]??null])),source:'recent',ref:l.ref||null};
      if(addUsual){addUsual(x,entry,l.name,x.getAttribute('aria-label'));return;}
      x.disabled = true;
      try { const result=await addEntries([entry],{thread:location.pathname==='/food/describe'}); close.closeAll(true);toast(result.held?'Usual amount added for review':result.queued?'Saved on this phone · waiting to send':`Added ${l.name} to ${MEAL_NAMES[w.meal].toLowerCase()}`,result.undo); }
      catch (e) { toast(e.message); x.disabled = false; }
    });
  } catch (x) { stopSkeleton(); body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
// Saved Dishes (2026-10-12; was two tabs, Mine and Meals): your dishes, dishes friends shared, saved meals and your own
// foods in one list. My Recipes opens editing; Add food opens portion review (dishLogSheet in cook.js).
async function tSaved(body, where, close, {manage=false}={}) {
  const owner=readOwner(),valid=()=>body.isConnected&&owner===readOwner();
  if(manage)$('#tm-new',body.closest('#page')).disabled=true;
  body.innerHTML = '';
  const stopSkeleton = delayedSkeleton(body, skelFoodChooser());
  try {
    const [dishes, meals, foods] = await Promise.all([api('/api/dishes'), api('/api/food/meals'), api('/api/food/foods')]);
    if(!valid()){stopSkeleton();return;}
    stopSkeleton();
    if(manage){drawRecipeLibrary(body,dishes,meals,foods,where,close,()=>{if(valid())return tSaved(body,where,close,{manage});});return;}
    const mine = dishes.filter((d) => d.mine !== false), theirs = dishes.filter((d) => d.mine === false);
    const row = (kind, i, name, sub, kcal) => `<button class="fe" data-${kind}="${i}"><div><b>${esc(name)}</b><small class="muted">${esc(sub)}</small></div>
      <div class="r kcal-line"><b class="num">${kind==='dish'?recipeCalories(kcal):r0(kcal)}</b><span> kcal</span></div></button>`;
    const dishRow = (d, i) => {const subtitle=[d.mine === false ? `From ${d.owner.name.split(' ')[0]}` : d.items.length ? listOf(d.items.map((x) => x.name)) : 'Total typed in',d.serving==='one'?'Per serving':''].filter(Boolean).join(' · ');return row('dish', i, d.named?d.name:'Untitled recipe', subtitle,
      (d.serving === 'one' ? d.per_serving.kcal : d.totals.kcal));};
    const chooserRow=(content,kind,index,name)=>`<div class="meal-library-row chooser-row">${content}<button type="button" class="icon-btn choose-food-add" data-choose-${kind}="${index}" aria-label="Add ${esc(name)}">${svg('plus')}</button></div>`;
    body.innerHTML = `${mine.length ? `<h3 class="ghead">Your recipes</h3><div class="results">${mine.map((d) => chooserRow(dishRow(d,dishes.indexOf(d)),'dish',dishes.indexOf(d),d.named?d.name:'Untitled recipe')).join('')}</div>` : '<p class="small muted">Create your first recipe, with or without Kit.</p>'}
      ${theirs.length ? `<h3 class="ghead">Shared with you</h3><div class="results">${theirs.map((d) => chooserRow(dishRow(d,dishes.indexOf(d)),'dish',dishes.indexOf(d),d.name)).join('')}</div>` : ''}
      ${meals.length ? `<h3 class="ghead">Saved combinations</h3><div class="results">${meals.map((m,i) => chooserRow(row('meal',i,m.name,listOf(m.items.map((x) => x.name)),m.totals.kcal),'meal',i,m.name)).join('')}</div>` : ''}
      <h3 class="ghead ghead-act">My foods<button class="linkbtn" id="tm-food">New food</button></h3><div class="results">${foods.map((f,i) => chooserRow(foodRow(f,i),'food',i,f.name)).join('')}${!foods.length?'<p class="small muted">No saved foods yet.</p>':''}</div>
`;
    const again = () => {if(valid())return tSaved(body, where, close, {manage});};
    $('#tm-food', body).onclick = () => foodEditor(null, again);
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close, () => foodEditor(foods[+x.dataset.i], again)));
    const addDish=index=>{const dish=dishes[index];if(dish.totals.kcal==null&&dish.mine!==false)knownSheet(dish,()=>{invalidate('/api/dishes');again();});else dishLogSheet(dish,where(),()=>close.closeAll(true));};
    $$('[data-dish]',body).forEach(x=>x.onclick=()=>addDish(+x.dataset.dish));
    $$('[data-choose-dish]',body).forEach(x=>x.onclick=()=>addDish(+x.dataset.chooseDish));
    const addMeal=index=>savedSheet(meals[index],where(),again);
    $$('[data-meal]',body).forEach(x=>x.onclick=()=>addMeal(+x.dataset.meal));
    $$('[data-choose-meal]',body).forEach(x=>x.onclick=()=>addMeal(+x.dataset.chooseMeal));
    const addFood=index=>amountSheet(foods[index],where(),close,()=>foodEditor(foods[index],again));
    $$('[data-i]',body).forEach(x=>x.onclick=()=>addFood(+x.dataset.i));
    $$('[data-choose-food]',body).forEach(x=>x.onclick=()=>addFood(+x.dataset.chooseFood));
  } catch (x) { stopSkeleton(); if(valid()){body.innerHTML = `<p class="err">${esc(x.message)}</p><button type="button" class="ghost wide" id="tm-retry">Try again</button>`;$('#tm-retry',body).onclick=()=>tSaved(body,where,close,{manage});} }
}
// The managed library stays separate from Add food's existing portion picker.
function drawRecipeLibrary(body,dishes,meals,foods,where,close,again){
  const plusIcon=svg('plus'),closeIcon=svg('close');
  const preview=items=>items.slice(0,3).map(x=>x.name).join(', ')+(items.length>3?` +${items.length-3}`:'');
  const dishRow=(d,i)=>{const per=d.serving==='one'||(d.mine===false&&!d.weight_g),value=(per?d.per_serving:d.totals)?.kcal,label=d.named?d.name:'Untitled recipe',calories=value==null?'Calories unknown':`${recipeCalories(value)} kcal${per?' / serving':' total'}`,parts=[calories,d.mine===false?`From ${d.owner.name.split(' ')[0]}`:d.items.length?`${d.items.length} ingredient${d.items.length===1?'':'s'}`:'Entered nutrition'];
    return `<div class="library-row" data-library-name="${esc(label.toLowerCase())}"><button type="button" class="library-recipe" data-dish="${i}" title="${esc(label)}"><b>${esc(label)}</b><small>${esc(parts.join(' · '))}</small></button><button type="button" class="${d.totals.kcal==null&&d.mine!==false?'ghost sm library-add-nutrition':'icon-btn'}" data-log-dish="${i}" aria-label="${d.totals.kcal==null&&d.mine!==false?'Add nutrition for':'Log a portion of'} ${esc(label)}">${d.totals.kcal==null&&d.mine!==false?'Add nutrition':svg('plus')}</button></div>`;};
  const mine=dishes.filter(d=>d.mine!==false),theirs=dishes.filter(d=>d.mine===false),recent=recentSavedItems(dishes,meals);
  body.innerHTML=`
    <label class="library-search"><span class="library-search-label">Search recipes and foods</span><input id="tm-filter" type="search" placeholder="Search recipes and foods" autocomplete="off"></label>
    <nav class="library-tabs" role="tablist" aria-label="Recipe library">
      ${[['recent','Recent'],['recipes','Recipes'],['foods','Foods'],['usuals','Usuals']].map(([key,label],i)=>`<button type="button" role="tab" data-library-tab="${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}
    </nav>
    <div class="library-panel" role="tabpanel" data-library-panel="recent">${recentSavedMarkup(recent,{library:true})||('<div class="library-empty"><p class="small muted">Nothing recent yet.</p><button type="button" class="linkbtn library-empty-action" data-library-empty-action="log">'+plusIcon+'Log food</button></div>')}</div>
    <div class="library-panel" role="tabpanel" data-library-panel="recipes" hidden>
    <div id="library-recipes">
    ${mine.length?`<section class="library-section"><h2 data-type="secondary">Your recipes</h2>${mine.map(d=>dishRow(d,dishes.indexOf(d))).join('')}</section>`:''}
    ${theirs.length?`<section class="library-section"><h2 data-type="secondary">Shared with you</h2>${theirs.map(d=>dishRow(d,dishes.indexOf(d))).join('')}</section>`:''}
    ${!mine.length&&!theirs.length?'<div class="library-empty"><p class="small muted">No recipes yet.</p><button type="button" class="linkbtn library-empty-action" data-library-empty-action="recipe">'+plusIcon+'Create a recipe</button></div>':''}</div></div>
    <div class="library-panel" role="tabpanel" data-library-panel="foods" hidden><section class="library-section" id="library-foods"><h2 data-type="secondary">My foods</h2>${foods.map((f,i)=>`<div class="meal-library-row" data-library-name="${esc(f.name.toLowerCase())}">${foodRow(f,i)}<button type="button" class="icon-btn" data-edit-food="${i}" aria-label="Edit ${esc(f.name)}">${svg('edit')}</button></div>`).join('')}${!foods.length?'<div class="library-empty"><p class="small muted">No saved foods yet.</p><button type="button" class="linkbtn library-empty-action" id="tm-food-empty">'+plusIcon+'Create a food</button></div>':''}</section></div>
    <div class="library-panel" role="tabpanel" data-library-panel="usuals" hidden><section class="library-section" id="library-usuals"><h2 data-type="secondary">Saved combinations</h2>${meals.map((m,i)=>`<button type="button" class="fe" data-meal="${i}" data-library-name="${esc(m.name.toLowerCase())}"><div><b>${esc(m.name)}</b><small>${esc(preview(m.items))}</small></div><span class="num">${m.totals.kcal==null?'Calories unknown':r0(m.totals.kcal)+' kcal'}</span></button>`).join('')}${!meals.length?'<div class="library-empty"><p class="small muted">No saved combinations yet.</p><button type="button" class="linkbtn library-empty-action" data-library-empty-action="log">'+plusIcon+'Log food</button></div>':''}</section></div>
    <div id="tm-no-match" class="library-empty" hidden><p class="small muted">No matching recipes or foods.</p><button type="button" class="linkbtn library-empty-action" id="tm-clear-search">${closeIcon}Clear search</button></div><button type="button" class="linkbtn library-log" id="tm-describe">${plusIcon}Log food</button>`;
  $('#tm-describe',body).onclick=()=>{const w=where();close.closeAll(true);describeSheet(w.day,w.meal);};
  const openLog=()=>{const w=where();close.closeAll(true);describeSheet(w.day,w.meal);};
  $$('[data-library-empty-action="log"]',body).forEach(button=>button.onclick=openLog);
  $$('[data-library-empty-action="recipe"]',body).forEach(button=>button.onclick=e=>newDish(e.currentTarget));
  const emptyFood=$('#tm-food-empty',body);if(emptyFood)emptyFood.onclick=()=>foodEditor(null,again);
  const clearSearch=$('#tm-clear-search',body);if(clearSearch)clearSearch.onclick=()=>{const search=$('#tm-filter',body);search.value='';applyLibraryFilter();search.focus();};
  $('#tm-new',body.closest('#page')).disabled=false;
  $('#tm-new',body.closest('#page')).onclick=()=>sheet('New',`<div class="btncol"><button type="button" class="ghost" id="tm-dish">${svg('plus')}New recipe</button><button type="button" class="ghost" id="tm-link">Recipe from a link</button><button type="button" class="ghost" id="tm-food">${svg('edit')}New food</button></div>`,(b,end)=>{
    $('#tm-dish',b).onclick=e=>{const button=e.currentTarget;end();newDish(button);};$('#tm-link',b).onclick=()=>{end();go('/food/recipe-link');};$('#tm-food',b).onclick=()=>{end();return foodEditor(null,again);};
  });
  $$('[data-dish]',body).forEach(b=>b.onclick=()=>go('/food/cook/'+dishes[+b.dataset.dish].id));
  $$('[data-log-dish]',body).forEach(b=>b.onclick=()=>{const d=dishes[+b.dataset.logDish];if(d.totals.kcal==null&&d.mine!==false)knownSheet(d,()=>{invalidate('/api/dishes');again();});else dishLogSheet(d,where(),()=>{});});
  $$('[data-edit-food]',body).forEach(b=>b.onclick=()=>foodEditor(foods[+b.dataset.editFood],again));
  $$('[data-i]',body).forEach(b=>b.onclick=()=>amountSheet(foods[+b.dataset.i],where(),close,()=>foodEditor(foods[+b.dataset.i],again)));
  $$('[data-meal]',body).forEach(b=>b.onclick=()=>savedSheet(meals[+b.dataset.meal],where(),again));
  wireRecentSaved(body,recent,where);
  let activeTab='recent';
  const applyLibraryFilter=()=>{
    const q=$('#tm-filter',body).value.trim().toLowerCase(),panel=$(`[data-library-panel="${activeTab}"]`,body);let count=0;
    $$('[data-library-panel]',body).forEach(n=>n.hidden=n!==panel);
    $$('[data-library-name]',panel).forEach(n=>{n.hidden=!n.dataset.libraryName.includes(q);if(!n.hidden)count++;});
    $$('.library-section',panel).forEach(n=>{const rows=[...n.querySelectorAll('[data-library-name]')];if(rows.length)n.hidden=!rows.some(r=>!r.hidden);});
    const recentRows=$$('[data-recent-row]',panel);if(recentRows.length){for(const row of recentRows){const name=$('.recent-main b',row)?.textContent.toLowerCase()||'';row.hidden=!!q&&!name.includes(q);if(!row.hidden)count++;}}
    $('#tm-no-match',body).hidden=!q||count>0;
    const hasContent=recent.length>0||dishes.length>0||foods.length>0||meals.length>0;
    $('#tm-describe',body).hidden=!!q?count===0:!hasContent;
  };
  $$('[data-library-tab]',body).forEach(button=>button.onclick=()=>{activeTab=button.dataset.libraryTab;$$('[data-library-tab]',body).forEach(tab=>{const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});applyLibraryFilter();});
  const search=$('#tm-filter',body);search.oninput=applyLibraryFilter;
  applyLibraryFilter();
}
route(/^\/food\/meals$/, 'food', async (el) => {
  Discovery.visit('nutrition','recipes');
  el.classList.add('recipes-library');
  el.innerHTML = `<div class="top library-heading">${backBtn('Nutrition')}<h1>Recipes &amp; foods</h1><button type="button" class="ghost sm" id="tm-new" disabled>${svg('plus')} New</button></div><div id="meal-library"></div>`;
  wireBack(el, '/food');
  await tSaved($('#meal-library', el), () => ({day: foodToday(), meal: guessMeal()}), () => {}, {manage:true});
});
// How much of a saved meal: grams (when every food in it is in grams) or servings. A saved meal is 1 serving as saved
// ("½" or "2" scale every food in it).
function savedSheet(m, w, after) {
  const T = m.totals, weight = m.items.every((it) => it.unit === 'g') ? m.items.reduce((a, it) => a + it.amount, 0) : null;
  sheet(m.name, `<form class="form" id="sv">
    <p class="small muted">${esc(m.items.map((x) => x.name).join(', '))}</p>${foodDestination(w)}
    ${weight ? `<label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="${Math.round(weight)}" aria-label="Your portion in grams"><span>g</span></span></label>` : ''}
    <div class="share-line">${weight ? '<span class="muted">or</span>' : ''}<input name="n" inputmode="decimal" value="1" aria-label="Servings"><span>servings</span></div>
    <div class="portion-out" aria-live="polite"></div>
    <div class="actions"><button type="button" class="ghost danger" id="sv-del">Delete</button>${kitChatOn() || m.review ? `<button type="button" class="${kitChatOn()?'kit-help':'icon-btn'}" id="sv-ai" aria-label="${kitChatOn()?'Ask Kit about this meal':'Saved meal review'}">${svg(kitChatOn()?'sparkle':'clock')}</button>` : ''}<span class="spacer"></span>
      <button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}</button></div></form>`, (b, close) => {
    const f = $('#sv', b), out = $('.portion-out', f), num = (x) => (x ? +x.value.replace(',', '.') : 0);
    let mode = 'n';
    const factor = () => {      // the share of the saved meal being logged
      if (mode === 'g') { const g = num(f.g); return g > 0 && weight ? g / weight : null; }
      const n = num(f.n); return n > 0 ? n : null;
    };
    const show = () => { const k = factor(); out.innerHTML = k ? nutGrid(Object.fromEntries(['kcal', ...MACROS.map((x) => x[0])].map((x) => [x, T[x] == null ? null : T[x] * k]))) : ''; };
    const byN = () => { mode = 'n'; const k = factor(); if (f.g) f.g.value = k ? Math.round(weight * k) : ''; show(); };
    if (f.g) f.g.oninput = () => { mode = 'g'; show(); };
    f.n.oninput = byN; byN();
    f.onsubmit = async (e) => {
      e.preventDefault(); const k = factor();
      if (!k) { toast('Enter the number of servings.'); return; }
      const sc = (v) => (v == null ? null : v * k);
      const items = m.items.map((it) => ({...it, ...w, amount: it.amount * k, kcal: sc(it.kcal), protein_g: sc(it.protein_g), carbs_g: sc(it.carbs_g), fat_g: sc(it.fat_g), fiber_g: sc(it.fiber_g),...Object.fromEntries(EXTRA_NUTRIENTS.map(([key])=>[key,sc(it[key])])),ref: {...(it.ref||{}),saved_meal_id:m.id,saved_meal_factor:k}, source: 'meal'}));
      App.cache.delete('/api/food/meals');
      try { const result=await addEntries(items,{thread:location.pathname==='/food/describe'}); close.closeAll(true);toast(`Added ${m.name}`,result.undo); } catch (x) { toast(x.message); }
    };
    $('#sv-del', b).onclick = async () => {
      if (!await confirmSheet(`Delete “${m.name}”?`, {body: 'It is removed from Saved combinations. Food already in your food log stays.', action: 'Delete'})) return;
      try { await api(`/api/food/meals/${m.id}`, {method: 'DELETE'}); close(); toast('Saved combination deleted.'); after(); } catch (x) { toast(x.message); }
    };
    const ai = $('#sv-ai', b); if (ai) ai.onclick = () => {if(!kitChatOn()){mealCoach(m);return;}close.closeAll(true);KitChat.open('nutrition',null,`Help me review the saved meal “${m.name}”. Check its stored foods and nutrition.`);};
  },{flow:'auto'});
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
    try { const result=await addEntries([{...it, ...where(),entry_method:'manual'}],{thread:location.pathname==='/food/describe'}); close.closeAll(true);toast(result.queued?'Saved on this phone · waiting to send':`Added ${it.name}`,result.undo); } catch (x) { toast(x.message);button.disabled=false; }
  };
}

// choose an amount for a food (live numbers), then add
// Keep the full food name and source portion, with compact count and unit controls.
function amountSheet(f, w, closeParent, onEditFood) {
  const owner=readOwner();
  const last = f._last;
  const startUnit = last ? last.unit : f._unit || (f.serving?.is_default?'g':'serving'), startAmt = last ? last.amount : startUnit==='g'?100:1;
  const portion=foodPortion({...f,amount:startAmt,unit:startUnit,ref:f});
  const nm = f.name && f.name !== 'Unnamed product' ? f.name : '', br = f.brand || '';
  const title = br && nm && !nm.toLowerCase().includes(br.toLowerCase().split(',')[0].trim()) ? `${br.split(',')[0].trim()} ${nm}` : nm || br || 'Food';
  // a recent food without a database entry only knows the unit it was logged in: no made-up serving size, no other units
  const plain = f._plain || (f._unit && !f.per100);
  const sub = !plain && f.serving && f.serving.label ? `${f.serving.label}${f.serving.g && !/\d\s*g\b/.test(f.serving.label) ? ` (${r1(f.serving.g)} g)` : ''}` : '';
  if(!portion.units.find(u=>u.key===portion.unit)?.factor)portion.select(startUnit);
  const uName = (u) => (u === 'serving' ? 'Servings' : u === 'g' ? 'Grams' : u.charAt(0).toUpperCase() + u.slice(1));
  sheet(title, `<form class="form" id="am">
    ${sub||nutrientSource(f)?`<p class="am-sub small muted">${[sub,nutrientSource(f)].filter(Boolean).map(esc).join(' · ')}</p>`:''}${foodDestination(w)}
    <div class="am-control-row"><div class="am-amt"><button type="button" class="icon-btn" data-step="-1" aria-label="Less">${svg('minus')}</button>
      <label><input name="amount" inputmode="decimal" value="${portion.format()}" aria-label="Amount" aria-describedby="am-u"><small id="am-u" class="vh">${esc(uName(startUnit))}</small></label>
      <button type="button" class="icon-btn" data-step="1" aria-label="More">${svg('plus')}</button></div>
    <input type="hidden" name="unit" value="${esc(portion.unit)}">
    <select class="am-units" aria-label="Unit">${portionOptions(portion)}</select></div>${portionWeightNote(portion)}
    <div class="macpreview" id="am-p"></div>
    <div class="actions">${onEditFood ? '<button type="button" class="ghost" id="am-edit">Edit food</button><span class="spacer"></span>' : ''}<button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const fm = $('#am', b);
    const calc = () => { const a = portion.amount; const v = f.per100 || f.per_serving ? scaleFood(f, a, startUnit) : Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,null]));
      $('#am-p', b).innerHTML = `<div><b class="num">${r0(v.kcal)}</b><small>kcal</small></div>${MACROS.map(([k, , s]) => `<div><b class="num${v[k]==null?' nutrient-unknown':''}">${v[k]==null?'Unknown':r1(v[k])}</b><small>${s === 'P' ? 'protein' : s === 'C' ? 'carbs' : 'fat'} g</small></div>`).join('')}${extraFood(v)}`; return v; };
    fm.amount.oninput = () => {portion.input(fm.amount.value);calc();}; calc();
    $$('[data-step]', fm).forEach((x) => x.onclick = () => {      // ½ a serving at a time, or 10 g
      const st = fm.unit.value === 'g' ? 10 : 0.5;
      portion.step(st * +x.dataset.step);fm.amount.value=portion.format();calc();     // minus never goes to zero (or up)
    });
    $('.am-units',fm).onchange=ev=>{portion.select(ev.target.value);fm.unit.value=portion.unit;fm.amount.value=portion.format();$('#am-u',fm).textContent=uName(portion.unit);calc();};
    if (onEditFood) $('#am-edit', b).onclick = () => { close();onEditFood(); };
    fm.onsubmit = async (e) => {
      e.preventDefault(); const a = portion.amount; if (!(a > 0)) { toast('Enter an amount'); return; }
      const v = calc();
      const ref = {...(f.dish_id?{dish_id:f.dish_id,weight_g:f.weight_g,dish_kcal:f.dish_kcal}:{}),origin:f.origin,origin_notes:f.origin_notes,origin_model:f.origin_model,origin_edited:f.origin_edited,origin_ref:f.origin_ref,unknown_nutrients:f.unknown_nutrients||f._last?.ref?.unknown_nutrients,source: f.source, id: f.id, per100: f.per100 || null, per_serving: f.per_serving || null, serving: f.serving || null};
      try { const result=await addEntries([{...w, name: nm || br || f.name, brand: f.brand || null, amount: a, unit: startUnit, ...v, source: f.source === 'recent' ? 'recent' : f.source || 'search', entry_method:f.entry_method||'search', ref}],{thread:location.pathname==='/food/describe'});
        if(owner!==readOwner())return;portion.remember();close.closeAll(true);toast(result.queued?'Saved on this phone · waiting to send':`Added ${title}`,result.undo); } catch (x) { toast(x.message); }
    };
  },{flow:'auto'});
}
function foodEditor(food, after) {
  const owner=readOwner();
  const ps = food && food.per_serving || {};
  sheet(food ? 'Edit my food' : 'New food', `${food?.origin==='ai'?`<p class="small">Kit’s estimate${food.origin_edited?' · Edited':''}. ${esc(food.origin_notes||'Check the numbers and portion before using them.')}</p>`:''}<form class="form" id="fe">
    <label>Name<input name="name" required maxlength="200" value="${esc(food ? food.name : '')}"></label>
    <div class="two"><label>Brand<input name="brand" value="${esc(food && food.brand || '')}"></label><label>Barcode<input name="barcode" inputmode="numeric" value="${esc(food && food.barcode || '')}"></label></div>
    <div class="two"><label>Serving<input name="serving_label" value="${esc(food && food.serving ? food.serving.label : '1 serving')}"></label><label>Serving grams<input name="serving_g" inputmode="decimal" value="${food && food.serving && food.serving.g ? r1(food.serving.g) : ''}"></label></div>
    <p class="small muted">Nutrition per serving:</p>${macroInputs({...ps,source:food?.source,origin:food?.origin,origin_edited:food?.origin_edited})}
    <label class="check"><input type="checkbox" name="favorite"${food && food.favorite ? ' checked' : ''}> Favourite (shows first)</label>
    <div class="actions">${food ? '<button type="button" class="ghost danger" id="fe-del">Delete</button><span class="spacer"></span>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const f = $('#fe', b), n = (x) => (x.value.trim() === '' ? null : Number(x.value.replace(',', '.')));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {name: f.name.value.trim(), brand: f.brand.value.trim() || null, barcode: f.barcode.value.trim() || null, serving_label: f.serving_label.value.trim() || '1 serving',
        serving_g: n(f.serving_g), kcal: n(f.kcal), protein_g: n(f.protein_g), carbs_g: n(f.carbs_g), fat_g: n(f.fat_g), fiber_g: n(f.fiber_g), ...extraFormValues(f), favorite: f.favorite.checked};
      if (['serving_g',...FOOD_NUTRIENTS].some(k=>body[k]!=null&&!Number.isFinite(body[k]))) { toast('Enter a number, or leave an unknown nutrient blank.'); return; }
      if (body.kcal==null&&['protein_g','carbs_g','fat_g'].every(k=>body[k]!=null)) body.kcal=Math.round(body.protein_g*4+body.carbs_g*4+body.fat_g*9);
      if (body.kcal==null) { toast('Enter calories, or all three macros to work them out.'); return; }
      try { await api(food ? `/api/food/foods/${food.id}` : '/api/food/foods', json(food ? 'PUT' : 'POST', body)); close(); toast('Food saved'); if (after) after(); } catch (x) { toast(x.message); }
    };
    if (food) $('#fe-del', b).onclick = async () => { if (!await confirmSheet(`Delete “${food.name}”?`, {body: 'It is removed from My foods. Food already in your food log stays.', action: 'Delete'})) return; try { await api(`/api/food/foods/${food.id}`, {method: 'DELETE'}); close(); toast('Saved food deleted.'); if (after) after(); } catch (x) { toast(x.message); } };
  });
}

// ---------- photo + description -> Gemini estimate (2026-10-09) ----------
// Selection stays local until the explicit confirmation; one request covers all retained views.
async function reviewFoodPhotos(files,confirm,{label=false,recipe=false,description=null,itemize=false,active=()=>true}={}) {
  if (!files.length) return;
  if (files.length>6) { toast('Choose up to 6 photos at a time'); return; }
  let photos=[];
  try { for (const file of files) { if (file.size>20000000) throw Error('Choose photos under 20 MB each'); photos.push(await shrinkPhoto(file,1600)); if(!active())return; }
    if(photos.reduce((n,p)=>n+p.length,0)>10000000)throw Error('These photos are too large together. Choose fewer photos.');
  } catch(e) { if(active())toast(e.message||"A photo couldn't be opened"); return; }
  if(!active())return;
  const canItemize=!!App.me?.food_photo_itemize;
  itemize=canItemize;
  let note=description??'';
  sheet(recipe?'Review recipe screenshots':label?'Photos of one ingredient':'Review your food photos','<div id="photo-selection"></div>',(root,close)=>{
    const box=$('#photo-selection',root),draw=()=>{box.innerHTML='<p>'+(recipe?'Choose views of one recipe, including its ingredients and nutrition. Kit will read them into a draft; check servings and numbers before saving.':label?'Use several views of the same package, including its nutrition panel. Add different ingredients separately.':'Use several views of one meal. Check the estimate so each food is counted once.')+'</p><p>Up to 6 photos. Photos stay on this screen until you continue.</p><div class="photo-selection">'+photos.map((p,i)=>`<div><img class="ql-img" src="${p}" alt="Selected photo ${i+1}"><button type="button" class="ghost" data-remove-photo="${i}" aria-label="Remove photo ${i+1}">Remove</button></div>`).join('')+'</div>'+(description!==null?`<label class="photo-description" for="photos-description">Describe this food <span class="muted">(optional)</span><textarea id="photos-description" rows="3" maxlength="4000" placeholder="For example, a 6-inch turkey sub with cheese and mayo; I ate half.">${esc(note)}</textarea></label><p class="small muted">Every estimate shows its food breakdown and total. Your photo appears temporarily in the chat, then disappears when you log the food or clear the chat.</p><p class="small muted">Kit estimates portions and hidden ingredients. Check the assumptions before logging.</p>`:'')+'<button class="primary wide" id="photos-use" '+(!photos.length?'disabled':'')+'>'+(recipe?'Read recipe screenshots':label?'Read these photos':description!==null?'Estimate with Kit':'Use these photos')+'</button>';
      const field=$('#photos-description',box);if(field)field.oninput=()=>{note=field.value;};
      $$('[data-remove-photo]',box).forEach(b=>b.onclick=()=>{photos.splice(+b.dataset.removePhoto,1);draw()});$('#photos-use',box).onclick=()=>{if(!active())return;close.closeAll(true);confirm(photos.slice(),{note:note.trim(),itemize})};};draw();
  },{flow:'auto'});
}
route(/^\/food\/describe$/, 'food', (el) => {
  const q = new URLSearchParams(location.search);
  return FoodThread.page(el, {day: q.get('d'), meal: q.get('meal')});
});
// ---------- barcode ----------
// onFound (a dish's + menu, 2026-10-12): hand the product back instead of logging it
function scanSheet(day, meal, onFound, onCode) {
  let stop = () => {};
  const closeSheet = sheet('Scan a barcode', `<div class="scan"><video id="sc-v" playsinline muted></video><div class="scanbox"></div></div>
    <p class="small muted" id="sc-msg">Point the camera at the barcode.</p>
    <form class="wform" id="sc-f"><input name="code" inputmode="numeric" placeholder="or type the number" aria-label="Barcode number"><button class="ghost" id="sc-lookup">Look up</button></form>
    <div class="thread-actions" id="sc-actions" hidden><button type="button" class="primary wide" id="sc-enter-nutrition">Enter nutrition</button></div>`, async (b, close) => {
    const v = $('#sc-v', b), msg = $('#sc-msg', b);
    const found = async (code) => {
      stop(); if(onCode){close.closeAll(true);onCode(String(code));return;}
      const retry=$('#sc-lookup',b),actions=$('#sc-actions',b),enter=$('#sc-enter-nutrition',b),field=$('#sc-f input',b);
      if(actions)actions.hidden=true;if(retry)retry.textContent='Look up';if(field)field.value=String(code);
      msg.textContent='Looking up this barcode…';
      try {
        const f = await api(`/api/food/barcode/${code}`);
        close.closeAll(true);
        if(onFound)onFound(f);else amountSheet({...f,entry_method:"barcode"},{day,meal},()=>{});
      }
      catch (x) {
        if(retry)retry.textContent='Try again';
        if(x.status===404){msg.textContent="We couldn't find this barcode.";msg.classList.remove('small','muted');if(actions)actions.hidden=false;if(enter)enter.onclick=()=>{close.closeAll(true);foodEditor({name:'',barcode:String(code),serving:{label:'1 serving'}},null);};}
        else msg.textContent=x.status===502?"We couldn't reach the food database. Try again.":x.message;
      }
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
  },{flow:'auto'});
  // stop the camera when the sheet closes
  const obs = new MutationObserver(() => { if (!$('#sc-v')) { stop(); obs.disconnect(); } });
  obs.observe(document.body, {childList: true});
}

// ---------- targets ----------
// One Goals sheet (Ben, 30 Oct 2026: macros were hidden behind the calorie-only day goal). Daily calories and the three
// macros sit together with a running check of what the macros add up to; a different calorie goal for one day is a
// secondary, folded choice. Without a day (the Set macro targets link) it shows only the daily targets.
function goalSheet(D = null) {
  const m = App.me, owner = readOwner(), G = D?.goal || {}, label = D ? dayLabel(D.day) : '';
  const word = /^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : label, v = (x) => esc(x ? Math.round(x) : '');
  const dayForm = D ? `<details class="goal-day"${G.custom != null ? ' open' : ''}><summary>Different calories just for ${esc(word)}</summary>
      <form class="form" id="dg"><label>Calories for ${esc(word)}<input name="k" inputmode="numeric" value="${esc(G.custom != null ? Math.round(G.custom) : '')}" placeholder="${v(m.kcal_target) || 'e.g. 2000'}" enterkeyhint="done"></label>
      <p class="small muted">Other days keep your daily target. Protein, carbs and fat stay the same.</p>
      <div class="actions">${G.custom != null ? '<button type="button" class="ghost" id="dg-reset">Use daily target</button>' : ''}<button class="ghost">Save for ${esc(word)}</button></div></form></details>` : '';
  sheet('Goals', `${G.custom != null ? `<p class="small goal-now">${esc(label)} has its own calorie goal: <b class="num">${r0(G.custom)} kcal</b>${G.default ? ` (daily target ${r0(G.default)})` : ''}.</p>` : ''}
    <form class="form" id="tg"><h3 class="goal-h">Every day</h3><div class="mac4 goal4">
    <label>Calories<input name="kcal_target" inputmode="numeric" value="${v(m.kcal_target)}" aria-label="Daily calories in kcal"></label>
    <label>Protein g<input name="protein_target" inputmode="numeric" value="${v(m.protein_target)}" aria-label="Daily protein in grams"></label>
    <label>Carbs g<input name="carbs_target" inputmode="numeric" value="${v(m.carbs_target)}" aria-label="Daily carbs in grams"></label>
    <label>Fat g<input name="fat_target" inputmode="numeric" value="${v(m.fat_target)}" aria-label="Daily fat in grams"></label></div>
    <p class="small muted" id="tg-sum" aria-live="polite"></p>
    ${extraInputs(m, true, `<label>Fiber (g)<input name="fiber_target" inputmode="numeric" value="${v(m.fiber_target)}" aria-label="Daily fiber in grams"></label>`)}
    <div class="actions"><button class="primary">Save daily targets</button></div></form>
    ${dayForm}<p class="small goal-help"><a href="/food/setup" id="tg-help">Help me choose targets</a></p>`, (b, close) => {
    guardFoodSheet(b, close, owner);
    $('#tg-help', b).onclick = () => close();
    const f = $('#tg', b), n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value.replace(/,/g, '')));
    const sum = () => {
      const k = Math.round((n(f.protein_target) || 0) * 4 + (n(f.carbs_target) || 0) * 4 + (n(f.fat_target) || 0) * 9), goal = n(f.kcal_target), diff = goal ? k - goal : 0;
      $('#tg-sum', b).textContent = !k ? 'Protein and carbs have 4 kcal per gram, fat has 9.'
        : `Protein, carbs and fat add up to ${r0(k)} kcal` + (!goal ? '.' : Math.abs(diff) <= Math.max(50, goal * .03) ? ', matching your calorie target.'
        : `, ${r0(Math.abs(diff))} kcal ${diff > 0 ? 'more' : 'less'} than your calorie target.`);
    };
    f.oninput = sum; sum();
    f.onsubmit = async (e) => {
      e.preventDefault();
      let body;
      try {
        body = {kcal_target: n(f.kcal_target), protein_target: n(f.protein_target), carbs_target: n(f.carbs_target), fat_target: n(f.fat_target), fiber_target: n(f.fiber_target), ...extraFormValues(f, true)};
        if (['kcal_target', 'protein_target', 'carbs_target', 'fat_target', 'fiber_target'].some((k) => body[k] != null && !(body[k] >= 0))) throw Error('Enter a number, or leave a target blank.');
      } catch (x) { toast(x.message); return; }
      try { await api('/api/food/targets', json('PUT', body)); if (owner !== readOwner()) return; Object.assign(App.me, body); close(); refresh(); toast('Daily targets saved'); } catch (x) { toast(x.message); }
    };
    const d = $('#dg', b); if (!d) return;
    const save = async (kcal) => { try { await api('/api/food/day-goal', json('PUT', {day: D.day, kcal})); if (owner !== readOwner()) return; close(); refresh(); toast(kcal == null ? `${label} uses your daily target` : `Calories for ${word}: ${r0(kcal)} kcal`); } catch (x) { toast(x.message); } };
    d.onsubmit = (e) => { e.preventDefault(); const k = parseFloat(d.k.value.replace(/,/g, '')); if (!(k > 0)) { toast('Enter a number of calories'); return; } save(k); };
    const r = $('#dg-reset', b); if (r) r.onclick = () => save(null);
  });
}
const targetsSheet = () => goalSheet();

// ---------- weight trend + food trends ----------
// The same private weigh-ins and trend live under Progress, with Nutrition links.
let pendingWeightDelete=null,weightDeleteWrite=Promise.resolve();
function deferWeightDelete(button,box,owner){
  if(owner!==readOwner()||button.disabled)return;
  pendingWeightDelete?.flush();
  const row=button.closest('.weight-history-row'),day=button.dataset.del;
  let active=true,timer;
  const clear=()=>{active=false;clearTimeout(timer);removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);viewResources.delete(row);if(pendingWeightDelete?.flush===flush)pendingWeightDelete=null;};
  const undo=()=>{if(!active||owner!==readOwner())return;clear();row.hidden=false;button.disabled=false;if(box.isConnected)weightHistory(box);toast('Weigh-in kept');};
  const flush=()=>{
    if(!active)return weightDeleteWrite;clear();
    weightDeleteWrite=weightDeleteWrite.then(async()=>{
      if(owner!==readOwner())return;
      try{await api(`/api/food/weights/${day}`,{method:'DELETE',keepalive:true});if(owner!==readOwner())return;invalidate('/api/food/weights');if(!pendingWeightDelete){await weightHistoryChanged(owner,box);if(!pendingWeightDelete)toast('Weigh-in deleted');}}
      catch(e){if(owner!==readOwner())return;row.hidden=false;button.disabled=false;invalidate('/api/food/weights');if(!pendingWeightDelete){if(box.isConnected)weightHistory(box);toast(e.message);}}
    });
    return weightDeleteWrite;
  };
  const hidden=()=>{if(document.visibilityState==='hidden')flush();};
  button.disabled=true;row.hidden=true;pendingWeightDelete={owner,day,flush};
  viewResources.set(row,flush);addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
  timer=setTimeout(flush,6000);toast('Weigh-in deleted',undo);
}
function weightHistory(box) {
  const account=readOwner(),valid=()=>box.isConnected&&account===readOwner();
  load('/api/food/weights?days=365', (W) => {
    if (!valid()) return;
    const pts = W.points, wt = (kg) => `${U.weight(kg)} ${imp() ? 'lb' : 'kg'}`;
    box.innerHTML = pts.length ? `<div class="card"><div class="bigstat">${stat('Trend', W.trend_kg ? U.weight(W.trend_kg) : '–', imp() ? 'lb' : 'kg')}${stat('Per week', W.rate_kg_per_week == null ? '–' : (W.rate_kg_per_week > 0 ? '+' : '') + U.weight(W.rate_kg_per_week), imp() ? 'lb' : 'kg')}</div>
        <div id="w-chart"></div><p class="small muted">The trend smooths out day-to-day water swings; it's the number to watch.</p></div>
      <div class="card"><h2>Weigh-ins</h2>${[...pts].reverse().slice(0, 60).map((p) => `<div class="row weight-history-row"><span>${esc(new Date(p.day + 'T12:00').toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'}))}<small class="weight-source muted">${esc(p.source_label||'Manual')}</small></span>
        <span class="num">${wt(p.kg)} <small class="muted">trend ${U.weight(p.trend)}</small> <button class="linkbtn danger" data-del="${p.day}" aria-label="Delete weigh-in">×</button></span></div>`).join('')}</div>`
      : '<div class="card empty"><b>No weigh-ins yet</b>Log one above. Kinetta smooths out the daily ups and downs into a trend.</div>';
    $$('[data-del]',box).forEach(b=>b.onclick=()=>deferWeightDelete(b,box,account));
    if(pendingWeightDelete?.owner===account)box.querySelector(`[data-del="${pendingWeightDelete.day}"]`)?.closest('.weight-history-row')?.setAttribute('hidden','');
    if (pts.length) requestAnimationFrame(() => {
      if(!valid())return;
      const xs = pts.map((p) => new Date(p.day + 'T12:00') / 864e5);
      dotChart($('#w-chart', box), pts.map((p, i) => ({x: xs[i], y: imp() ? p.kg * 2.20462 : p.kg, id: i})), {yfmt: (v) => v.toFixed(1),
        trend: pts.length > 1 ? {start: imp() ? pts[0].trend * 2.20462 : pts[0].trend, end: imp() ? pts[pts.length - 1].trend * 2.20462 : pts[pts.length - 1].trend} : null});
    });
  });
}
route(/^\/food\/weight$/, 'progress', async () => go(weightAddress(new URLSearchParams(location.search)), {replace: true}));   // old address
route(/^\/food\/trends$/, 'food', async () => go('/food?view=overview', {replace: true}));   // old address

// ---------- Nutrition > progress views (2026-10-09; split into views 2026-10-12): one range, tiles, insights, charts ----------
const ACTIVITY_LEVELS = [[1.2, 'Mostly sitting', 'desk job, little walking'], [1.3, 'Some walking & standing', 'errands, light chores, kids'], [1.45, 'On my feet a lot', 'retail, nursing, active job']];
function bodyDetailsSummary(me) {
  const sex = me.sex ? me.sex[0].toUpperCase() + me.sex.slice(1) : 'Sex not set';
  const age = me.birth_year ? `Age ${Math.max(0, new Date().getUTCFullYear() - Number(me.birth_year))}` : 'Age not set';
  let height = 'Height not set';
  if (me.height_cm) {
    if (imp()) { const feet = Math.floor(me.height_cm / 2.54 / 12), inches = Math.round(me.height_cm / 2.54 % 12); height = `${feet}′${inches}″`; }
    else height = `${Math.round(Number(me.height_cm))} cm`;
  }
  const weight = me.weight_kg ? `${U.weight(me.weight_kg)} ${imp() ? 'lb' : 'kg'}` : 'Weight not set';
  return [sex, age, height, weight].join(' · ');
}
function bodyDetailsSheet(box) {
  const me = App.me, owner = readOwner(), initialWeight = String(U.weight(me.weight_kg)), weightDerived = !!me.weight_health_derived;
  const initialHeight = me.height_cm ? (imp() ? `${Math.floor(me.height_cm / 2.54 / 12)} ${Math.round(me.height_cm / 2.54 % 12)}` : Math.round(me.height_cm)) : '';
  sheet('Body details', `<form class="form needs-body-form" id="needs-body-form">
      <div class="two"><label>Sex<select name="sex"><option value="">—</option><option value="male"${me.sex === 'male' ? ' selected' : ''}>Male</option><option value="female"${me.sex === 'female' ? ' selected' : ''}>Female</option></select></label>
      <label>Birth year<input name="birth_year" inputmode="numeric" value="${esc(me.birth_year || '')}" placeholder="1990"></label></div>
      <div class="two"><div class="needs-body-weight"><label>Weight (${imp() ? 'lb' : 'kg'})<input name="weight" inputmode="decimal" value="${esc(initialWeight)}" placeholder="${imp() ? '150' : '68'}"${weightDerived ? ' readonly aria-readonly="true"' : ''}></label>${weightDerived?'<a class="linkbtn needs-body-weight-link" href="/progress/weight?from=nutrition">Update in Weight</a>':''}</div>
      <label>Height (${imp() ? 'ft in' : 'cm'})<input name="height" inputmode="decimal" value="${esc(initialHeight)}" placeholder="${imp() ? '5 8' : '173'}"></label></div>
      <p class="small needs-body-error" id="needs-body-error" role="alert" hidden></p>
      <button class="needs-body-save" type="submit">Save body details</button>
    </form>`, (b, close) => {
    const form = $('#needs-body-form', b), save = $('button[type="submit"]', form);
    form.onsubmit = async (event) => {
      event.preventDefault(); if (owner !== readOwner()) return;
      const n = value => value.trim() === '' ? null : Number(value);
      const error = $('#needs-body-error', form), fail = message => { error.textContent = message; error.hidden = false; };
      error.hidden = true; error.textContent = '';
      const birthText = form.birth_year.value.trim(), birthYear = n(birthText), maxBirthYear = new Date().getUTCFullYear() - 16;
      if (birthText && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > maxBirthYear)) { fail(`Use a birth year from 1900 through ${maxBirthYear}.`); form.birth_year.focus(); return; }
      const heightText = form.height.value.trim(), heightParts = heightText.match(/\d+(\.\d+)?/g) || [];
      const height_cm = !heightParts.length ? null : imp() ? (heightParts.length > 1 ? +heightParts[0] * 12 + +heightParts[1] : +heightParts[0] < 9 ? +heightParts[0] * 12 : +heightParts[0]) * 2.54 : +heightParts[0];
      if (heightText && (!heightParts.length || heightParts.length > 2 || !Number.isFinite(height_cm) || height_cm < 100 || height_cm > 250)) { fail('Height must be 100–250 cm (about 3′3″–8′2″).'); form.height.focus(); return; }
      const weightText = form.weight.value.trim(), weight = n(weightText), weight_kg = weight == null ? null : imp() ? weight / 2.20462 : weight;
      if (!weightDerived && weightText && (!Number.isFinite(weight_kg) || weight_kg < 25 || weight_kg > 300)) { fail(`Weight must be ${imp() ? '55–661 lb' : '25–300 kg'}.`); form.weight.focus(); return; }
      const body = {sex: form.sex.value || null, birth_year: n(form.birth_year.value), height_cm};
      if (!weightDerived && form.weight.value !== initialWeight) body.weight_kg = weight_kg;
      save.disabled = true;
      try {
        await api('/api/profile', json('PUT', body)); if (owner !== readOwner()) return;
        Object.assign(App.me, body); keep('/api/me', App.me);
        App.cache.set('/api/me', {data: App.me, at: Date.now()});
        invalidate('/api/food/energy'); close(); toast('Body details saved');
        if (box.isConnected && owner === readOwner()) energyCard(box);
      } catch (error) { if (owner === readOwner() && b.isConnected) { toast(error.message || 'Could not save body details.'); save.disabled = false; } }
    };
  });
}
function energyCard(box) {
  // Food-target estimates are independent of the selected burn source and exclude workouts.
  load('/api/food/energy', (E) => {
    if (!box.isConnected) return;
    const lb = imp(), step = lb ? 250 : 275;   // ~0.5 lb or ~0.25 kg a week
    const goals = [[`Lose ${lb ? '1 lb' : '0.5 kg'} a week`, -2 * step], [`Lose ${lb ? '½ lb' : '0.25 kg'} a week`, -step], ['Maintain', 0], [`Gain ${lb ? '½ lb' : '0.25 kg'} a week`, step]];
    let activityFactor = E.activity_factor, activityChoice = ACTIVITY_LEVELS.reduce((best, option) => Math.abs(option[0] - E.activity_factor) < Math.abs(best[0] - E.activity_factor) ? option : best)[0], goalDelta = goals.reduce((best, option) => Math.abs((App.me.kcal_target ?? E.base) - (E.base + option[1])) < Math.abs((App.me.kcal_target ?? E.base) - (E.base + best[1])) ? option : best, goals[2])[1];
    const baseFor = () => Math.round(E.bmr * activityFactor);
    const targetFor = () => Math.max(Math.ceil(E.bmr / 10) * 10, Math.round((baseFor() + goalDelta) / 10) * 10);
    box.innerHTML = `<div id="resting-source-card"></div>
      <section class="card needs-estimate"><span class="small muted">Estimated calories/day</span><div class="needs-estimate-value"><b class="num" id="needs-estimate-value">${r0(E.base)}</b><span>kcal/day</span></div><p class="small muted">Kinetta estimate · from ${E.bmr_exact?'your height, age, sex and weight':'weight only'} · before workouts</p>
      <button class="needs-body-row" id="needs-body-edit" type="button"><span class="needs-body-copy"><b>Body details</b><small>${esc(bodyDetailsSummary(App.me))}</small></span>${svg('chev')}</button></section>
      <details class="card food-target-calculator"><summary>Calculate food target<span class="chev">${svg('down')}</span></summary><div class="target-calculator-content">
        <fieldset class="choice-list" id="needs-activity"><legend>Everyday activity <small>(outside workouts)</small></legend>${ACTIVITY_LEVELS.map(([f,n,d])=>`<label><input type="radio" name="everyday-activity" value="${f}"${f===activityChoice?' checked':''}><span><b>${esc(n)}</b><small>${esc(d)}</small></span></label>`).join('')}</fieldset>
        <fieldset class="choice-list goal-choice-list" id="needs-goal"><legend>Weight goal</legend>${goals.map(([name,delta])=>`<label><input type="radio" name="weight-goal" value="${delta}"${delta===goalDelta?' checked':''}><span><b>${esc(name)}</b></span></label>`).join('')}</fieldset>
        <div class="suggested-target" aria-live="polite"><span>Suggested food target</span><b class="num" id="suggested-target-value">${r0(targetFor())}</b><span>kcal/day</span></div>
        <button class="primary wide" id="use-food-target">Use this target</button>
        <details class="estimate-disclosure"><summary>How it's calculated<span class="chev">${svg('down')}</span></summary><p class="small muted">The estimate multiplies resting calories by everyday activity. Your weight goal adjusts the food target; workouts are counted separately. Estimates can vary from day to day.</p>${E.bmr_exact?'':'<p class="small muted">Resting calories are a rough estimate from the profile details available. Add height, birth year and sex in Me settings to improve it.</p>'}</details>
      </div></details>`;
    restingSourceCard($('#resting-source-card',box));
    $('#needs-body-edit', box).onclick = () => bodyDetailsSheet(box);
    const paintEstimate = () => {
      const base = baseFor(); $('#needs-estimate-value',box).textContent = r0(base); $('#suggested-target-value',box).textContent = r0(targetFor());
    };
    $('#needs-activity',box).onchange = async (event) => {
      const fieldset = event.currentTarget, next = Number(event.target.value); if (!Number.isFinite(next)) return;
      fieldset.disabled = true;
      try {
        await api('/api/profile', json('PUT', {activity_factor: next}));
        App.me.activity_factor = activityFactor = activityChoice = next; E.activity_factor = next; E.base = baseFor(); invalidate('/api/food'); paintEstimate();
      } catch (x) { event.target.checked = false; fieldset.querySelector(`input[value="${activityChoice}"]`).checked = true; toast(x.message); }
      finally { fieldset.disabled = false; }
    };
    $('#needs-goal',box).onchange = (event) => { const next = Number(event.target.value); if (Number.isFinite(next)) { goalDelta = next; paintEstimate(); } };
    $('#use-food-target',box).onclick = async () => {
      const m = App.me, body = {kcal_target: targetFor(), protein_target: m.protein_target ?? null, carbs_target: m.carbs_target ?? null, fat_target: m.fat_target ?? null, fiber_target: m.fiber_target ?? null};
      const button = $('#use-food-target',box); button.disabled = true;
      try { await api('/api/food/targets', json('PUT', body)); m.kcal_target = body.kcal_target; invalidate('/api/food'); toast(`Calorie target set to ${r0(body.kcal_target)}`); render(); }
      catch (x) { toast(x.message); button.disabled = false; }
    };
  });
}
function weeksCard(box) {
  const owner=readOwner(),valid=()=>box.isConnected&&owner===readOwner();
  return load('/api/food/weeks?weeks=26', (W) => {
    if (!valid()) return;
    const rows = W.weeks, logged = rows.filter((w) => w.days_logged);
    if (!logged.length) { box.innerHTML = '<div class="card empty nutrition-weeks-empty"><b>No food logged yet</b>Weekly averages appear here once you start logging.<br><a class="linkbtn" href="/food">Log food</a></div>'; return; }
    const shown = rows.slice(rows.findIndex((w) => w.days_logged));   // from the first logged week
    const wt = (kg) => (kg == null ? '–' : U.weight(kg));
    box.innerHTML = `<div class="card nutrition-weeks"><p class="small muted">Last 26 weeks · separate from the selected chart range</p><div class="tblwrap" tabindex="0" role="region" aria-label="Weekly food totals; scroll sideways for more columns"><table class="tbl yrs"><thead><tr><th>Week of</th><th class="r">Days</th><th class="r">Eaten kcal/day</th><th class="r">Protein g/day</th><th class="r">Carbs g/day</th><th class="r">Fat g/day</th><th class="r">Exercise kcal/day</th><th class="r">${U.du()}</th><th class="r">Weight ${imp()?'lb':'kg'}</th></tr></thead><tbody>
        ${[...shown].reverse().map((w) => `<tr${w.partial ? ' class="cur"' : ''}><td>${esc(new Date(w.week + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}))}</td><td class="r num">${w.days_logged}${w.partial ? '' : '/7'}</td>
          <td class="r num"><b>${w.kcal == null ? '–' : r0(w.kcal)}</b></td><td class="r num">${w.protein_g == null ? '–' : r0(w.protein_g)}</td><td class="r num">${w.carbs_g == null ? '–' : r0(w.carbs_g)}</td><td class="r num">${w.fat_g == null ? '–' : r0(w.fat_g)}</td>
          <td class="r num">${r0(w.exercise_per_day)}</td><td class="r num">${U.dist(w.distance_m, 0)}</td><td class="r num">${wt(w.trend_kg)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Food averages use all logged days, including partly logged days and today. A dash means missing nutrition. Exercise uses elapsed days in the week · ${U.du()} = run + ride + walk · weight = trend at the end of the week.</p></div>`;
  }).catch(()=>{if(!valid())return;box.innerHTML='<p class="small muted">Weekly food history could not load.</p><button type="button" class="ghost wide" data-weeks-retry>Retry weeks</button>';box.querySelector('[data-weeks-retry]').onclick=()=>weeksCard(box);});
}
const NRANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];
// Log your weight (2026-10-12: moved here from the Log view). Any day up to today, so old weigh-ins can be added too.
let wcDay = null,wcOwner=null;   // selected days stay with the account/server that picked them
function weightCard(box) {
  const unit = imp() ? 'lb' : 'kg', today = foodToday(),owner=readOwner(),valid=()=>box.isConnected&&owner===readOwner();
  if(wcOwner!==owner){wcDay=null;wcOwner=owner;}
  let day = wcDay && wcDay < today ? wcDay : today, W = {points: []},draft=null;
  const draw = () => {
    if (!valid()) return;
    const isToday = day === today, had = W.points.find((p) => p.day === day), r = W.rate_kg_per_week;
    box.innerHTML = `<div class="card wcard"><h2>${isToday ? "Log today's weight" : `Log weight for ${esc(dayLabel(day))}`}</h2>
      ${had ? `<p class="small muted">${esc(had.source_label||'Manual')}${had.source==='healthkit'?' · Updating makes this a manual weigh-in.':''}</p><p class="wdone">${svg('check')} Logged: <b class="num">${esc(U.weight(had.kg))} ${unit}</b>${isToday ? ' today' : ''}</p>` : ''}
      <form class="wform"><label class="wfield"><input name="w" inputmode="decimal" placeholder="e.g. ${imp() ? '165.4' : '75.0'}" value="${esc(draft??(had ? U.weight(had.kg) : ''))}" aria-label="Your weight ${isToday ? 'today' : 'on ' + esc(dayLabel(day))} in ${unit}" enterkeyhint="done"><span>${unit}</span></label>
        <button class="${had ? 'ghost' : 'primary'}">${had ? 'Update' : 'Log weight'}</button></form>
      <div class="wfoot"><label class="linkbtn daypick">${svg('calendar')}<span>${isToday ? 'A different day' : esc(dayLabel(day))}</span><input type="date" name="wday" value="${esc(day)}" max="${today}" aria-label="The day you weighed yourself"></label>
        ${W.trend_kg ? `<span class="small muted num">Trend ${U.weight(W.trend_kg)} ${unit}${r != null ? ` · ${r > 0 ? '+' : r < 0 ? '−' : ''}${U.weight(Math.abs(r))} a week` : ''}</span>` : ''}</div></div>`;
    // Focus starts editing before the first input event (including select-then-type).
    $('.wform input',box).onfocus=$('.wform input',box).oninput=e=>{draft=e.target.value;};
    const dp = $('[name=wday]', box);
    dp.onclick = () => { try { dp.showPicker(); } catch (e) { /* the browser opens its own picker */ } };
    dp.onchange = () => { if (dp.value && dp.value <= today) { day = wcDay = dp.value;draft=null; draw(); } };
    $('.wform', box).onsubmit = async (e) => {
      e.preventDefault(); if(!valid())return;const v = parseFloat(e.target.w.value.replace(',', '.')); if (!(v > 0)) return;
      const kg = imp() ? v / 2.20462 : v,submittedDay=day;
      try {
        do{if(pendingWeightDelete?.owner===owner)pendingWeightDelete.flush();await weightDeleteWrite;if(owner!==readOwner())return;}while(pendingWeightDelete?.owner===owner);
        const q = await sendOrQueue('/api/food/weights', 'PUT', {day:submittedDay, kg}, `weight ${U.weight(kg)}`);
        if(owner!==readOwner())return;
        toast(q.queued ? 'Weight saved on this phone - it sends when you are back online' : `Weight logged${submittedDay === today ? '' : ` for ${dayLabel(submittedDay)}`}: ${U.weight(kg)} ${unit}`);
        if (!q.queued) await weightChanged(owner,box);
      } catch (x) { if(valid())toast(x.message); }
    };
  };
  draw();
  load('/api/food/weights?days=3650', (w) => { W = w;if(draft===null)draw(); }).catch(() => {});
}

async function weightChanged(owner,box,historyOnly=false) {
  if(owner!==readOwner())return;
  const profile=refreshWeightData(owner);
  if(box.isConnected){if(historyOnly)weightHistory(box);else render();}
  await profile;
  if(owner!==readOwner()||box.isConnected)return;
  const q=new URLSearchParams(location.search),home=location.pathname==='/me'||location.pathname==='/me/settings'||location.pathname==='/progress'&&!q.has('view')&&!q.has('section');
  if(home&&!document.querySelector('.scrim:not(.is-closing)')&&!document.activeElement?.matches('input,textarea,select,[contenteditable]'))render();
}


async function weightHistoryChanged(owner,box){
  if(owner!==readOwner())return;
  const current=location.pathname==='/progress/weight'?$('#nt-whist'):null,field=current&&$('.wform input');
  await weightChanged(owner,current||box,!!field&&field.value!==field.defaultValue);
}

function weightOrigin(query) {
  const from=query.get('from');
  if(from==='nutrition')return {label:'Nutrition',href:App.nutritionHome?.owner===readOwner()?App.nutritionHome.href:'/food'};
  if(from==='explore')return {label:'Explore Kinetta',href:'/me/explore'};
  if(from==='me')return {label:'Me',href:'/me'};
  return {label:'Progress',href:App.progressHome?.owner===readOwner()?App.progressHome.href:'/progress'};
}
route(/^\/progress\/weight$/, 'progress', async el=>{
  const origin=weightOrigin(new URLSearchParams(location.search));
  Discovery.visit('progress','weight');Discovery.visit('nutrition','weight');
  el.classList.add('weight-page');
  el.innerHTML=`<div class="top weight-heading">${backBtn(origin.label)}<div class="weight-heading-main"><h1>Weight</h1><div class="acts"><button type="button" class="icon-btn" id="weight-help" aria-label="About your weight">${svg('help')}</button>${bellBtn()}</div></div></div><div id="nt-weight"></div><div id="nt-whist"></div>`;
  wireBack(el,origin.href);
  $('#weight-help',el).onclick=()=>sheet('Your weight',`<p>Weigh-ins and body measurements are private. They never appear on a shared profile or progress picture.</p><p>The trend smooths day-to-day changes. Health app weights keep their source label; a manual weigh-in takes priority for its day.</p><p class="small muted">Daily calorie estimates use your trend when available, then your stored body weight. Logging a weigh-in also updates that stored value.</p>`);
  weightCard($('#nt-weight',el));weightHistory($('#nt-whist',el));
});

async function foodCalendar(root) {
  const owner=readOwner(),today=foodToday();
  await load('/api/food/insights?days=90',I=>{
    if(!root.isConnected||owner!==readOwner())return;
    const logged=(I.rows||[]).filter(r=>r.entries>0||r.eaten!=null).sort((a,b)=>b.day.localeCompare(a.day));
    root.innerHTML=`<section class="card"><h2>Logged days</h2><label class="food-history-date">Open any day<input type="date" max="${today}" aria-label="Pick a food-log day"></label><p class="small muted">${logged.length} logged days in the last 90 days · newest first</p>${logged.length?`<div class="food-day-list">${logged.map(r=>`<a class="row-link" href="/food?d=${esc(r.day)}"><span>${esc(dayLabel(r.day))}</span><span class="num">${r.eaten==null?'Calories unknown':r0(homeCalories(r.eaten))+' kcal'}</span>${svg('chev')}</a>`).join('')}</div>`:'<p>No food logged in the last 90 days.</p><a class="primary wide" href="/food">Open food log</a>'}</section>`;
    const date=$('input[type=date]',root);date.onchange=()=>{if(owner===readOwner()&&date.value&&date.value<=today)go('/food?d='+date.value);};
  });
}

async function nutritionView(el, view, q) {
  if(view==='weeks'){const params=new URLSearchParams(q);params.set('weeks','1');return go(nutritionHref('overview',params.toString()),{replace:true});}
  // range (overview, energy, macros): 7/30/90/365 days, or "since" = from a start date the person picks (e.g. the start
  // of a diet); remembered on this phone
  let r = q.get('r'); if (!r) { try { r = localStorage.getItem('fit.nrange'); } catch (e) { /* none */ } }
  if (r !== 'since' && !NRANGES.some((x) => String(x[0]) === r)) r = '30';
  const ranged = NRANGED.includes(view);
  const root = nHead(el, view, (ranged ? pillBtn('n-range', null, r === 'since' ? 'Since…' : NRANGES.find((x) => String(x[0]) === r)[1], 'Time range') : ''));
  if(view==='calendar')return foodCalendar(root);
  const save = (v) => { try { localStorage.setItem('fit.nrange', v); } catch (e) { /* none */ } go(nutritionHref(view,`r=${v}`), {replace: true}); };
  const startSheet = (cur) => sheet('Count from', `<form class="form" id="ds"><label>Start date<input type="date" class="datefield" name="since" value="${esc(cur || '')}" max="${foodToday()}"></label>
      <p class="small muted">For example the day you started your diet. Trends, the running deficit and the averages then cover everything since that day.</p>
      <div class="actions"><button class="primary">Use this date</button></div></form>`, (b, close) => {
    $('#ds', b).onsubmit = async (e) => { e.preventDefault(); const v = $('#ds', b).since.value; if (!v) return;
      try { await api('/api/food/deficit/start', json('PUT', {since: v})); close(); invalidate('/api/food'); save('since'); } catch (x) { toast(x.message); } };
  });
  if (view === 'weight') { root.innerHTML = '<div id="nt-weight"></div><div id="nt-whist"></div>'; weightCard($('#nt-weight', root)); weightHistory($('#nt-whist', root)); return; }
  if (view === 'needs') { energyCard(root); return; }
  let since = null;
  $('#n-range', el).onclick = () => pickSheet('Time range', pickRows([...NRANGES.map(([d, n]) => [String(d), n]),
    ['since', since ? `Since ${new Date(since + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'})}` : 'Since a date…', since ? 'Tap again to change the date' : 'For example the day you started a diet']], r),
    (k) => (k === 'since' ? (since && r !== 'since' ? save('since') : startSheet(since)) : save(k)));
  // Keep Insights chart-first; old weekly links still lead with their open table.
  const weeklyFold=view==='overview'?`<details class="insights-review chev-row" id="nt-weeks-fold"${q.get('weeks')==='1'?' open':''}><summary>Week by week</summary><div id="nt-weeks"></div></details>`:'';
  root.innerHTML = `${view==='overview'?'<div id="nt-coach"></div>':''}${view==='overview'&&(location.pathname==='/progress'||q.get('from')==='progress')?'<details class="insights-review chev-row"><summary>Your weekly check-in</summary><div id="nt-checkin"></div></details>':''}${q.get('weeks')==='1'?weeklyFold:''}<div id="nt-body">${skel(3)}</div>${q.get('weeks')==='1'?'':weeklyFold}`;
  if(view==='overview'&&(location.pathname==='/progress'||q.get('from')==='progress'))weeklyCheckinCard($('#nt-checkin',root));   // the numbers first, then the coach
  if (view === 'overview') dietCoach($('#nt-coach', root));
  if(view==='overview'){const fold=$('#nt-weeks-fold',root);let loaded=false;const open=()=>{if(fold.open&&!loaded){loaded=true;weeksCard($('#nt-weeks',fold));}};fold.addEventListener('toggle',open);open();}
  const url = r === 'since' ? '/api/food/insights?days=30&since=' : `/api/food/insights?days=${r}`;
  if (r === 'since') {   // need the saved start date first
    const I0 = await api('/api/food/insights?days=7').catch(() => null); since = I0 && I0.deficit_start;
    if (!since) { $('#nt-body', root).innerHTML = '<div class="card empty"><b>Pick a start date</b>Tap the time range button to choose the day to count from.</div>'; startSheet(null); return; }
  }
  await load((r === 'since' ? url + since : url)+(view==='overview'?'&brief=1':''), (I) => {
    since = I.deficit_start || since;
    const rb = $('#n-range span', el); if (rb && r === 'since' && since) rb.textContent = `Since ${new Date(since + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'})}`;
    const dateLine=$('#insights-range-dates',el);
    if(view==='overview'&&dateLine){const first=I.rows[0]?.day||I.summary.start,last=I.rows.at(-1)?.day||foodToday();const fmt=d=>new Date(d+'T12:00').toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});dateLine.textContent=first&&last?`${fmt(first)} – ${fmt(last)}`:'';}
    drawTrends($('#nt-body', root), I, I.summary.days, view, r);
  });
}
function drawTrends(box, I, days, part, rangeKey) {   // part: overview | energy | macros
  if (!box || !box.isConnected) return;
  const S = I.summary, T = I.targets, lb = imp(), wu = lb ? 'lb' : 'kg', wconv = (kg) => (lb ? kg * 2.20462 : kg);
  const past = I.rows.filter((r) => !r.today);
  if (part!=='overview'&&!I.rows.some((r) => r.eaten != null)) { box.innerHTML = `<div class="card empty"><b>Nothing logged in this range</b><p>Start with something you ate to build your food and weight picture.</p><a class="primary wide" href="/food">Log food</a>${Native.on ? '' : '<p class="small muted">Have older records? <a href="/food/import">Add past days</a>.</p>'}</div>`;syncCheckinPrimary(box.closest?.('#page')); return; }
  const tile = (label, value, unit, sub, cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="ntile ${cls}"><small>${esc(label)}</small><b class="num">${value}<i>${esc(unit)}</i></b>${sub ? `<span>${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;
  const weekly = days > 90;   // a year of daily bars is too thin: average by week
  const dlabel = (d, o) => new Date(d + 'T12:00').toLocaleDateString([], o);
  let cols;
  if (weekly) {
    const W = {};
    for (const r of I.rows) { const d = new Date(r.day + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = isoDay(d); (W[k] = W[k] || []).push(r); }
    cols = Object.entries(W).map(([k, rs], i, arr) => { const c = rs.filter((r) => r.counted), a = (f) => { const v=c.map(r=>r[f]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null; };
      const prev = arr[i - 1] && new Date(arr[i - 1][0] + 'T12:00'), d = new Date(k + 'T12:00');
      const ws = rs.filter((r) => r.weight != null), lastT = [...rs].reverse().find((r) => r.trend != null);
      return {label: 'Week of ' + dlabel(k, {month: 'short', day: 'numeric'}), tick: !prev || prev.getMonth() !== d.getMonth() ? (i === 0 || d.getMonth() % 2 === 0 ? dlabel(k, {month: 'short'}) : '') : '', tickLabel: dlabel(k, {month: 'short', day: 'numeric'}), eaten: a('eaten'), burned: a('burned'), goal: a('goal'), protein_g: a('protein_g'), partial: rs.some((r) => r.today), countedDays:c.length, entries:rs.reduce((n,r)=>n+r.entries,0),day:k,isWeek:true,
        weight: ws.length ? wconv(ws.reduce((x, r) => x + r.weight, 0) / ws.length) : null, trend: lastT ? wconv(lastT.trend) : null}; });
  } else {
    const every = days <= 7 ? 1 : days <= 30 ? 7 : 14;
    cols = I.rows.map((r, i) => ({label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}), tick: (I.rows.length - 1 - i) % every === 0 ? dlabel(r.day, days <= 7 ? {weekday: 'short'} : {month: 'short', day: 'numeric'}) : '', tickLabel: dlabel(r.day, days <= 7 ? {weekday: 'short'} : {month: 'short', day: 'numeric'}),
      eaten: r.eaten, burned: r.eaten == null ? null : r.burned, goal: r.goal, protein_g: r.protein_g, partial: r.today, day: r.day, counted: r.counted, weight: r.weight == null ? null : wconv(r.weight), trend: r.trend == null ? null : wconv(r.trend)}));
  }
  const burnNote=I.rows.some(r=>r.burn_source==='apple_health')
    ? 'Burn uses synced Health app resting calories plus recorded activity calories, counted once. Missing resting data stays missing. These are source estimates, not a measurement of your exact needs.'
    : I.rows.some(r=>r.burn_source==='imported')
      ? 'Some days use imported daily burn; other days use the formula estimate plus recorded workouts. These source values are estimates.'
      : `Burn is a formula estimate of daily needs (about ${r0(homeCalories(S.tdee))} kcal before recorded workouts), plus recorded activity calories. It is not a measurement of your exact needs.`;
  const kcalP = (S.avg_protein_g || 0) * 4, kcalC = (S.avg_carbs_g || 0) * 4, kcalF = (S.avg_fat_g || 0) * 9, kcalM = kcalP + kcalC + kcalF || 1;
  const pct = (v) => Math.round(v / kcalM * 100);
  const overviewLinks=()=>`<div class="insights-links" aria-label="Nutrition details">${NPROG.filter(v=>!['overview','weeks'].includes(v[0])).map(([key,name,,icon])=>`<a href="${esc(nutritionHref(key))}">${svg(icon)}<span>${esc(name)}</span>${svg('chev')}</a>`).join('')}</div>`;
  const complete=S.logged||0,partialRows=I.rows.filter(r=>r.entries>0&&!r.counted),partial=partialRows.length;
  const partialText=partial?`${partial} ${partial===1?'day':'days'} partly logged`:'';
  const countLine=`Logged ${complete} of ${days} days`;
  const rowsForChart=weekly?cols:I.rows.map(r=>({label:dlabel(r.day,{month:'short',day:'numeric'}),tickLabel:dlabel(r.day,{month:'short',day:'numeric'}),tick:true,day:r.day,eaten:r.eaten,goal:r.goal,counted:r.counted,entries:r.entries,partial:r.entries>0&&!r.counted,padded:false}));
  const fmtKcal=v=>`${r0(homeCalories(v))} kcal`;
  const detailRows=`<details class="insights-detail-row"><summary>Protein across meals</summary><div class="insights-detail-content">${Object.entries(S.meals||{}).filter(([,v])=>v>0).map(([meal,v])=>`<div><span>${esc(MEAL_NAMES[meal])}</span><b class="num">${v}%</b></div>`).join('')||'<p class="muted">No complete-day meal breakdown yet.</p>'}</div></details>
    <details class="insights-detail-row"><summary>Fiber and more nutrients</summary><div class="insights-detail-content">${(()=>{const fiber=I.rows.map(r=>r.fiber_g).filter(v=>v!=null),items=[fiber.length?`<div><span>Fiber</span><b class="num">${r1(fiber.reduce((a,b)=>a+b,0))} g</b></div>`:''];for(const [key,label,unit] of EXTRA_NUTRIENTS){const v=I.extra_nutrients?.[key];if(v?.recorded!=null)items.push(`<div><span>${label}${v.unknown_count?` · ${v.unknown_count} missing`:''}</span><b class="num">${nutrientNumber(v.recorded,unit)}</b></div>`);}return items.join('')||'<p class="muted">No nutrient totals recorded in this range.</p>';})()}</div></details>
    <details class="insights-detail-row"><summary>Top recorded calorie sources</summary><div class="insights-detail-content"><ol>${(I.top_foods||[]).slice(0,5).map(f=>`<li><span>${esc(f.name)}</span><b class="num">${fmtKcal(f.kcal)}</b></li>`).join('')||'<li>No recorded foods yet.</li>'}</ol></div></details>`;
  const overviewCard=`<section class="card insights-summary${complete<3?' is-sparse':''}" data-complete-days="${complete}" data-partial-days="${partial}">
      <div class="insights-card-heading"><a href="${esc(nutritionHref('energy'))}" class="insights-daily-link">Daily calories ${svg('chev')}</a></div>
      <div class="insights-coverage"><b>${countLine}</b><span>Unlogged days aren’t counted as zero.${partialText?` ${partialText}.`:''}</span></div>
      ${complete===0?`<div class="insights-empty-state"><strong class="num">—</strong><span>0 complete days${partial?` · ${partial} ${partial===1?'day':'days'} partly logged`:''}</span></div>`:
        complete<3?`<div class="insights-sparse-metric"><span>Average logged</span><b class="num">${S.avg_eaten==null?'—':fmtKcal(S.avg_eaten)}</b><small>Based on ${complete} complete ${complete===1?'day':'days'}</small></div><div class="insights-chart-wrap"><div id="nt-overview-chart"></div></div>`:
        `<div class="insights-filled-metrics"><a href="${esc(nutritionHref('energy'))}"><span>Average calories</span><b class="num">${S.avg_eaten==null?'—':fmtKcal(S.avg_eaten)}</b></a><a href="${esc(nutritionHref('macros'))}"><span>Average protein</span><b class="num">${S.avg_protein_g==null?'—':`${r0(S.avg_protein_g)} g`}</b></a></div><div class="insights-chart-wrap"><div id="nt-overview-chart"></div></div>`}
      ${complete>=3?detailRows:''}</section>${complete<3?'<a class="primary wide insights-log-food" href="/food">Log food</a>':''}`;
  const html = {overview: `${overviewCard}
      ${overviewLinks()}`,

    energy: `<div class="card"><h2>Eaten, burned & weight<span class="muted small">${weekly ? 'weekly average' : 'per day'}</span></h2><div id="nt-energychart"></div>
      <details class="estimate-disclosure"><summary>ⓘ How this is estimated</summary><p class="small muted estimate-note">${esc(burnNote)} The goal line is your food target; eating below it does not by itself establish a calorie deficit.</p></details></div>
    <div class="card"><h2>Running deficit<span class="muted small">kcal total</span></h2><div id="nt-cum"></div>
      <details class="estimate-disclosure"><summary>ⓘ How this is estimated</summary><p class="small muted estimate-note">Adds estimated burn minus logged food across fully logged days with burn data. The weight conversion is a rough energy model, not measured fat loss. Water changes, missing food and burn-estimate errors can affect the comparison.</p></details></div>`,
    macros: `<div class="card"><h2>Protein<span class="muted small">${weekly ? 'weekly average · g/day' : 'g per day'}</span></h2><div id="nt-protein"></div></div>
    <div class="card"><h2>Where your calories come from</h2>
      ${MACROS.every(([k])=>S['avg_'+k]!=null) ? `<div class="split" role="img" aria-label="Protein ${pct(kcalP)}%, carbs ${pct(kcalC)}%, fat ${pct(kcalF)}%"><i class="m-protein_g" data-w="${(kcalP / kcalM).toFixed(3)}"></i><i class="m-carbs_g" data-w="${(kcalC / kcalM).toFixed(3)}"></i><i class="m-fat_g" data-w="${(kcalF / kcalM).toFixed(3)}"></i></div>
      <div class="legend small"><span><i class="sw m-protein_g"></i>Protein ${pct(kcalP)}% · ${r0(S.avg_protein_g)} g</span><span><i class="sw m-carbs_g"></i>Carbs ${pct(kcalC)}% · ${r0(S.avg_carbs_g)} g</span><span><i class="sw m-fat_g"></i>Fat ${pct(kcalF)}% · ${r0(S.avg_fat_g)} g</span></div><p class="small muted">Average grams per fully logged day · ${S.logged} completed days in this range.</p>` : '<p class="small muted">Macro split unavailable: some nutrient values are missing.</p>'}
      <h3 class="sub">By meal</h3><p class="small muted">Share of recorded calories on fully logged completed days in this range.</p>${Object.entries(S.meals || {}).map(([m, v]) => `<div class="mrow mealrow"><span>${esc(MEAL_NAMES[m])}</span><div class="track"><div class="bar meal-bar" data-w="${(v / 100).toFixed(3)}"></div></div><b class="num">${v}%</b></div>`).join('')}</div>
    ${I.top_foods.length ? `<div class="card"><h2>Top foods by calories</h2><p class="small muted">Recorded totals in this range, excluding today · includes partly logged days.</p>${I.top_foods.map((f) => `<div class="mrow topf"><span title="${esc(f.name)}">${esc(f.name)}</span><div class="track"><div class="bar meal-bar" data-w="${(f.kcal / I.top_foods[0].kcal).toFixed(3)}"></div></div><b class="num">${r0(homeCalories(f.kcal))} kcal<i> · ${f.n}×</i></b></div>`).join('')}</div>` : ''}`};
  box.innerHTML = html[part];syncCheckinPrimary(box.closest?.('#page'));
  requestAnimationFrame(() => {
    if(part==='overview'&&complete>0){
      const chart=$('#nt-overview-chart',box),compact=complete<3;
      periodBars(chart,rowsForChart.map(c=>({label:c.label,tick:c.tickLabel, tickLabel:c.tickLabel,partial:!!c.partial,padded:false,segs:[{k:'brand',v:c.eaten||0}],readoutValue:c.eaten,counted:c.counted,entries:c.entries,day:c.day})),{
        keys:[{k:'brand',name:'Calories'}],fmt:fmtKcal,yfmt:v=>v>=1000?`${(v/1000).toFixed(v%1000?1:0)}k`:String(Math.round(v)),axisUnit:'kcal',yTicks:3,
        avg:T.kcal_target||null,avgLabel:'Goal',height:compact?118:window.innerWidth<=360?145:160,inlineSelection:true,ariaLabel:'Recorded calories by day',
        onSelectPeriod:index=>{const c=rowsForChart[index];if(!c)return;const status=c.isWeek?`${c.countedDays} complete days${c.entries>c.countedDays?` · ${c.entries-c.countedDays} other food days`:''}`:c.counted?'complete day':c.entries>0?'partly logged':'no food logged',hasRecordedFood=c.entries>0,label=`${c.label} · ${status}${hasRecordedFood&&c.eaten!=null?` · ${fmtKcal(c.eaten)}`:''}`;const readout=$('.readout',chart);if(readout)readout.innerHTML=`<span>${esc(label)}</span>`;const group=$(`[data-period-index="${index}"]`,chart);if(group)group.setAttribute('aria-label',label);}
      });
      $$('.period-column',chart).forEach((node,index)=>{const c=rowsForChart[index];if(!c)return;const status=c.isWeek?`${c.countedDays} complete days`:c.counted?'complete day':c.entries>0?'partly logged':'no food logged';node.setAttribute('aria-label',`${c.label} · ${status}${c.eaten!=null?` · ${fmtKcal(c.eaten)}`:''}`);});
    }
    if (part === 'macros') periodBars($('#nt-protein', box), cols.map((c) => ({label: c.label, tick: c.tick, tickLabel: c.tickLabel, partial: c.partial, readoutValue: c.protein_g, segs: [{k: 's3', v: c.protein_g || 0}]})),
      {keys: [{k: 's3', name: 'Protein'}], fmt: (v) => `${r0(v)} g`, yfmt: (v) => String(Math.round(v)), avg: T.protein_target || null, avgLabel: 'Target', height: 150, initialReadout: {initialIndex: cols.length - 1, hint: 'Tap a bar'}});
    if (part !== 'energy') return;
    energyChart($('#nt-energychart', box), weekly ? cols.map(c=>({...c,day:null})) : cols, {initialReadout: {initialIndex: cols.length - 1, hint: 'Tap a bar'}, weight: {fmt: (v) => `${v.toFixed(1)} ${wu}`, axis: (v) => v.toFixed(1), unit: wu}});
    const cum = S.logged ? past.filter((r) => r.eaten != null) : [];   // no fully logged day yet: nothing to add up
    dayLine($('#nt-cum', box), cum.map((r) => ({y: r.total, tick: dlabel(r.day, {month: 'short', day: 'numeric'}), label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}),
      sub: r.counted && r.deficit == null ? 'resting calories not synced' : r.counted ? {prefix: 'Day: ', value: r0(Math.abs(r.deficit)), suffix: ` kcal ${r.deficit >= 0 ? 'deficit' : 'surplus'}`} : 'partly logged, not counted'})),
      {initialReadout: {initialIndex: cum.length - 1, hint: 'Tap a point'}, fmt: (v, short) => (short ? (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : r0(v)) : `${r0(Math.abs(v))} kcal ${v >= 0 ? 'deficit' : 'surplus'}`)});
  });
}

// once every script has loaded: start can draw a screen at once from the phone's saved copy, before plan.js, social.js, cook.js run

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
    if (r.paused) { b.replaceWith(Object.assign(document.createElement('p'), {className:'small muted',textContent:'Kit is paused. Search, barcodes and manual logging still work.'})); return; }
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
      if (!kitChatOn()) { g.remove(); return; }
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
  if (!box?.isConnected) return;
  box.replaceChildren();
  const page=box.closest('#page'),range=page?.querySelector('.insights-range');if(range)range.append(box);
  if(typeof KitChat!=='undefined')KitChat.entry(box.closest('#page'),location.pathname);
}

// The resting source changes burn accounting only; the food target remains a separate explicit action.
async function restingSourceCard(box) {
  if (!box?.isConnected) return;
  const account=readOwner(),watch=App.me.resting_source==='apple_health';
  box.innerHTML=`<section class="card resting-source-card"><h2>Resting calories</h2><p class="small muted">Calories your body burns at rest, plus everyday movement. Workout calories are added separately, once. Changing this source won't change your food target.</p>
    <label class="resting-source-select"><span>Current source</span><select id="resting-source"><option value="formula"${watch?'':' selected'}>Kinetta estimate</option><option value="apple_health"${watch?' selected':''}>Health app · Resting Energy</option></select></label>
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
    const btn=e.currentTarget;
    if(!await confirmSheet('Use Kinetta’s estimate?',{body:'Synced resting calories will be removed. Your food goal and activities stay the same.',action:'Use estimate',danger:false})||account!==readOwner())return;
    btn.disabled=true;
    try {if(Native.on)await Native.stopRestingEnergy();if(account!==readOwner())return;await api('/api/health/resting',{method:'DELETE'});if(account!==readOwner())return;App.me.resting_source='formula';invalidate('/api/food');invalidate('/api/health/resting');render();}
    catch(err){if(account===readOwner()&&box.isConnected){error.textContent=err.message;btn.disabled=false;}}
  };
  try {
    const status=await api('/api/health/resting');if(account!==readOwner()||!box.isConnected)return;
    const latest=status.days?.[0];$('#resting-status',box).textContent=latest ? `Latest day: ${latest.day} · ${r0(latest.resting_kcal)} resting kcal · read ${when(latest.observed_at)}. Health totals can update after later syncs.` : 'No resting calories have synced. Allow Resting Energy in the iPhone app, then sync. Closing the permission screen does not confirm read access.';
  }catch(e){if(account===readOwner()&&box.isConnected)$('#resting-status',box).textContent=e.message;}
}
