// Kinetta — Food log pages. Fast logging: search (own foods + recent first, then Open Food Facts + USDA),
// barcode, quick add, photo (Gemini estimate), saved meals, copy a day. Every entry editable; deletes have Undo.
'use strict';
const MEAL_NAMES = {breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks'};
const MACROS = [['protein_g', 'Protein', 'P'], ['carbs_g', 'Carbs', 'C'], ['fat_g', 'Fat', 'F']];
const r0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
const r1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString());
const isoDay = (d) => d.toLocaleDateString('en-CA', {timeZone: tz()});
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const dayLabel = (iso) => { const t = isoDay(new Date()); return iso === t ? 'Today' : iso === addDays(t, -1) ? 'Yesterday' : iso === addDays(t, 1) ? 'Tomorrow' : new Date(iso + 'T12:00').toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'}); };
function guessMeal() {   // the meal you usually log at this hour (learned from your log), else a sensible clock guess
  const h = new Date().getHours(), mine = App.mealHours && App.mealHours[h];
  return mine || (h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snacks' : h < 21 ? 'dinner' : 'snacks');
}

// Today page card (2026-10-10): calories left, protein, weigh-in - only for people who use the food log
function todayFoodCard(box) {
  return load('/api/food/day', (D) => {
    if (!box.isConnected) return;
    App.mealHours = D.meal_hours || App.mealHours;
    const g = D.goal && D.goal.kcal, T = D.totals, pt = D.targets && D.targets.protein_target;
    if (g == null && !D.entries.length && !D.weight_kg && !Object.keys(D.last_meals || {}).length) { box.innerHTML = ''; return; }
    const left = g != null ? g - T.kcal : null;
    box.innerHTML = `<div class="card tfood"><h2>Food today<a class="more" href="/food">Open log ›</a></h2>
      <a class="tap" href="/food"><div class="stats3">${stat('Eaten', r0(T.kcal), 'kcal')}${g != null ? stat(left < 0 ? 'Over' : 'Left', r0(Math.abs(left)), 'kcal') : stat('Goal', 'not set')}${stat('Protein', r0(T.protein_g) + (pt ? '/' + r0(pt) : ''), 'g')}</div>
      ${g != null ? `<div class="gbar${left < 0 ? ' over' : ''}"><div class="gfill" data-w="${Math.min(1, T.kcal / g).toFixed(3)}"></div></div>` : ''}
      <p class="small muted">${D.weight_kg ? `${svg('check')} Weighed in: ${esc(U.weight(D.weight_kg))} ${imp() ? 'lb' : 'kg'}` : 'No weigh-in yet today'}${D.entries.some((e) => e.pending) ? ' · some items waiting to send' : ''}</p></a>
      <button class="primary wide" id="tf-add">${svg('plus')} Log food</button></div>`;
    $('#tf-add', box).onclick = () => addSheet(D.day, guessMeal());
  }, {maxAge: 5000});
}

// nutrition for an amount of a normalised food (per100 / per_serving + serving grams)
function scaleFood(f, amount, unit) {
  const out = {};
  for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']) {
    let v = null;
    if (unit === 'g' && f.per100 && f.per100[k] != null) v = f.per100[k] * amount / 100;
    else if (unit !== 'g' && f.per_serving && f.per_serving[k] != null) v = f.per_serving[k] * amount;
    else if (unit !== 'g' && f.per100 && f.per100[k] != null) v = f.per100[k] * (f.serving && f.serving.g ? f.serving.g : 100) / 100 * amount;
    out[k] = v == null ? (k === 'fiber_g' ? null : 0) : Math.round(v * 10) / 10;
  }
  return out;
}

// ---------- day page ----------
// the energy-balance breakdown stays open or closed the way you left it (on this phone)
const bdOpen = () => { try { return localStorage.getItem('fit.bd') === '1'; } catch (e) { return false; } };
route(/^\/food$/, 'food', async (el) => {
  const q = new URLSearchParams(location.search), day = q.get('d') || isoDay(new Date()), view = q.get('view') === 'trends' ? 'trends' : 'log';
  const head = `<div class="top"><h1>Nutrition</h1></div><div class="seg nview" role="group" aria-label="Nutrition view"><button data-nv="log" aria-pressed="${view === 'log'}">${svg('food')} Log</button><button data-nv="trends" aria-pressed="${view === 'trends'}">${svg('progress')} Trends</button></div>`;
  const wireView = () => $$('[data-nv]', el).forEach((b) => b.onclick = () => go(b.dataset.nv === 'trends' ? '/food?view=trends' : `/food${q.get('d') ? '?d=' + q.get('d') : ''}`, {replace: true}));
  if (view === 'trends') { el.innerHTML = head + '<div id="nt"></div>'; wireView(); await nutritionTrends($('#nt', el), q); return; }
  el.innerHTML = `${head}
    <div class="daybar"><button class="icon-btn" id="fd-prev" aria-label="Previous day">${svg('back')}</button>
      <button class="ghost" id="fd-today">${esc(dayLabel(day))}</button>
      <button class="icon-btn" id="fd-next" aria-label="Next day">${svg('chev')}</button></div>
    <div class="quick">
      <button class="primary" id="fq-add">${svg('search')} Add food</button>
      <button class="ghost" id="fq-cook">${svg('pot')} Cooking</button></div>
    <div id="fd-dishes"></div><div id="fd-sum">${skel(1)}</div><div id="fd-meals"></div><div id="fd-weight"></div>`;
  wireView();
  $('#fd-prev', el).onclick = () => go(`/food?d=${addDays(day, -1)}`, {replace: true});
  $('#fd-next', el).onclick = () => go(`/food?d=${addDays(day, 1)}`, {replace: true});
  $('#fd-today', el).onclick = () => go('/food', {replace: true});
  $('#fq-add', el).onclick = () => addSheet(day, guessMeal());
  $('#fq-cook', el).onclick = (e) => startCooking(e.currentTarget);
  dishStrip($('#fd-dishes', el), day);
  await load(`/api/food/day?d=${day}`, (D) => drawDay(el, D), {maxAge: 5000});
});

function ring(v, target, label) {
  const pct = target ? Math.min(1.25, v / target) : 0, R = 34, C = 2 * Math.PI * R;
  const over = target && v > target * 1.05;
  return `<div class="ring${over ? ' over' : ''}"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="rb"/>
    <circle cx="40" cy="40" r="${R}" class="rf" stroke-dasharray="${(Math.min(pct, 1) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>
    <div><b class="num">${r0(target ? Math.abs(target - v) : v)}</b><small>${target ? (v > target ? 'over' : 'left') : label}</small></div></div>`;
}
function drawDay(el, D) {
  App.mealHours = D.meal_hours || App.mealHours;
  const t = D.targets || {}, T = D.totals, B = D.burned || {kcal: 0, n: 0, items: []}, G = D.goal || {}, today = dayLabel(D.day) === 'Today';
  const eaten = T.kcal, goal = G.kcal, left = goal != null ? goal - eaten : null, sofar = today ? ' so far' : '';
  const goalNote = goal == null ? 'No calorie goal yet - tap Goal to set one.'
    : G.custom != null ? `Goal set for this day${G.default ? ` (your usual is ${r0(G.default)})` : ''}.`
    : G.extra ? `Your daily target ${r0(G.default)} + ${r0(G.extra)} for ${today ? "today's" : "this day's"} extra training.` : 'Your daily target.';
  const row = (label, v, cls = '', sub = '') => `<div class="brow ${cls}"><span>${label}${sub ? `<small class="muted">${sub}</small>` : ''}</span><b class="num">${v}</b></div>`;
  $('#fd-sum', el).innerHTML = `<div class="card tcard">
      <div class="tc3 ringrow"><div><small>Eaten</small><b class="num">${r0(eaten)}</b><small>kcal</small></div>
        <div role="img" aria-label="${r0(eaten)} of ${goal == null ? 'no goal' : r0(goal)} kcal${left != null ? `, ${r0(Math.abs(left))} ${left < 0 ? 'over' : 'left'}` : ''}">${ring(eaten, goal, 'kcal')}</div>
        <button class="tc-goal" id="fd-goal" aria-label="Set the calorie goal for this day"><small>Goal ${svg('edit')}</small><b class="num">${goal == null ? 'Set' : r0(goal)}</b></button></div>
      <p class="small muted">${esc(goalNote)}</p></div>
    <div class="card balance"><h2>Energy balance<span class="muted small">estimate</span></h2>
      ${B.deficit == null ? '<p class="small muted">Log food to see your deficit for this day.</p>'
        : `<div class="brow big ${B.deficit >= 0 ? 'good' : 'bad'}"><span>${B.deficit >= 0 ? 'Deficit' : 'Surplus'}${sofar}</span><b class="num">${r0(Math.abs(B.deficit))}<i> kcal</i></b></div>`}
      <details class="bd"${bdOpen() ? ' open' : ''}><summary>How it adds up</summary>
      ${row('Resting burn (BMR)', r0(B.bmr), '', B.bmr_exact ? 'your body at rest' : 'rough guess · <a href="/me">add height & age</a>')}
      ${row('Everyday activity', r0(B.daily_life), '', `${esc((B.activity || '').toLowerCase())} · <a href="/food?view=trends">change</a>`)}
      ${B.items.length ? B.items.map((a) => row(`<a href="/activity/${a.id}"><span class="exi sp ${esc(a.sport)}">${svg(a.sport)}</span>${esc(a.name)}</a>`, r0(a.kcal) + (a.estimated ? '*' : ''), 'ex', a.distance_m ? `${U.dist(a.distance_m, 1)} ${U.du()}` : '')).join('')
                       : row('Exercise', '0', 'ex', 'no workouts this day')}
      <button class="linkbtn addwk" data-addact data-day="${esc(D.day)}">+ Add a workout</button>
      ${row(today ? 'Burned by end of day' : 'Total burned', r0(B.day_burn), 'sum', today ? 'estimate for the whole day' : '')}
      ${row('Eaten' + sofar, '− ' + r0(eaten))}</details>
      ${G.deficit != null ? `<p class="small muted">Eating exactly your goal would be a ${G.deficit >= 0 ? 'deficit' : 'surplus'} of ${r0(Math.abs(G.deficit))} kcal.${B.items.some((a) => a.estimated) ? ' * exercise estimated from distance/time and weight.' : ''}</p>` : ''}
      <a class="small more-link" href="/food?view=trends">Running total & trends ›</a></div>
    <div class="card macros"><h2>Macros${!t.protein_target ? '<button class="linkbtn" id="fd-targets">Set targets</button>' : ''}</h2>
      ${MACROS.map(([k, n]) => { const tg = t[k.replace('_g', '_target')]; return `<div class="mrow"><span>${n}</span><div class="track"><div class="bar m-${k}" data-w="${tg ? Math.min(1, T[k] / tg).toFixed(3) : (T[k] ? 1 : 0)}"></div></div><b class="num">${r0(T[k])}${tg ? `<i>/${r0(tg)}g</i>` : 'g'}</b></div>`; }).join('')}</div>`;
  const tb = $('#fd-targets', el); if (tb) tb.onclick = () => targetsSheet();
  const bd = $('details.bd', el); if (bd) bd.ontoggle = () => { try { localStorage.setItem('fit.bd', bd.open ? '1' : ''); } catch (e) { /* no storage */ } };
  $('#fd-goal', el).onclick = () => goalSheet(D);
  const by = {breakfast: [], lunch: [], dinner: [], snacks: []}; for (const e of D.entries) by[e.meal].push(e);
  $('#fd-meals', el).innerHTML = Object.keys(MEAL_NAMES).map((m) => {
    const list = by[m], kc = list.reduce((s, e) => s + e.kcal, 0);
    const lm = (D.last_meals || {})[m];
    if (!list.length) return `<section class="card meal empty-meal"><h2>${MEAL_NAMES[m]}<button class="linkbtn" data-add="${m}" aria-label="Add food to ${MEAL_NAMES[m].toLowerCase()}">+ Add</button></h2>
      ${lm ? `<button class="same" data-same="${m}"><span><small class="muted">Same as ${esc(dayLabel(lm.day))}</small><b>${esc(lm.items.map((i) => i.name).join(', '))}</b></span><span class="r"><b class="num">${r0(lm.kcal)}</b><small class="muted">Log ${svg('plus')}</small></span></button>` : ''}</section>`;
    return `<section class="card meal"><h2>${MEAL_NAMES[m]}<span class="muted small num">${list.length ? r0(kc) + ' kcal' : ''}</span></h2>
      ${list.map((e) => `<button class="fe${e.pending ? ' pending' : ''}" data-id="${e.id}"><div><b>${esc(e.name)}</b><small class="muted">${e.pending ? 'Waiting to send · ' : ''}${esc(fmtAmount(e))}${e.brand ? ' · ' + esc(e.brand) : ''}</small></div>
        <div class="r"><b class="num">${r0(e.kcal)}</b><small class="muted num">${r0(e.protein_g)}P ${r0(e.carbs_g)}C ${r0(e.fat_g)}F</small></div></button>`).join('')}
      <div class="mealact"><button class="linkbtn" data-add="${m}" aria-label="Add food to ${MEAL_NAMES[m].toLowerCase()}">+ Add</button>${list.length ? `<button class="linkbtn" data-more="${m}" aria-label="${MEAL_NAMES[m]} options">${svg('more')}</button>` : ''}</div></section>`;
  }).join('') + (D.entries.length ? '' : `<p class="small muted center">Nothing logged ${dayLabel(D.day) === 'Today' ? 'yet today' : 'this day'}. <button class="linkbtn" id="fd-copy">Copy yesterday</button></p>`);
  $$('[data-add]', el).forEach((b) => b.onclick = () => addSheet(D.day, b.dataset.add));
  $$('[data-more]', el).forEach((b) => b.onclick = () => mealMenu(D, b.dataset.more));
  $$('.fe', el).forEach((b) => b.onclick = () => {
    const e = D.entries.find((x) => String(x.id) === b.dataset.id);
    if (e.pending) { toast('Saved on this phone - it sends when you are back online'); return; }
    entrySheet(e, D.day);
  });
  $$('[data-same]', el).forEach((b) => b.onclick = async () => {
    const m = b.dataset.same, lm = D.last_meals[m];
    b.disabled = true;
    try {
      const r = await addEntries(lm.items.map((it) => ({...it, day: D.day, meal: m, ref: it.ref || null})));
      toast(`Logged ${MEAL_NAMES[m].toLowerCase()} - same as ${dayLabel(lm.day)}`, r.ids ? () => Promise.all(r.ids.map((id) => api(`/api/food/entries/${id}`, {method: 'DELETE', body: '{}'}))).then(refresh).catch((x) => toast(x.message)) : null);
    } catch (x) { toast(x.message); b.disabled = false; }
  });
  const cp = $('#fd-copy', el); if (cp) cp.onclick = () => copyDay(addDays(D.day, -1), D.day);
  const isToday = dayLabel(D.day) === 'Today', unit = imp() ? 'lb' : 'kg';
  $('#fd-weight', el).innerHTML = `<div class="card wcard"><h2>${isToday ? "Log today's weight" : `Log weight for ${esc(dayLabel(D.day))}`}<a class="more" href="/food/weight">Trend ›</a></h2>
    ${D.weight_kg ? `<p class="wdone">${svg('check')} Logged: <b class="num">${esc(U.weight(D.weight_kg))} ${unit}</b>${isToday ? ' today' : ''}</p>` : `<p class="small muted">Weigh yourself ${isToday ? 'this morning' : 'that morning'} after the bathroom, before eating, so days compare fairly.</p>`}
    <form class="wform"><label class="wfield"><input name="w" inputmode="decimal" placeholder="e.g. ${imp() ? '165.4' : '75.0'}" value="${D.weight_kg ? U.weight(D.weight_kg) : ''}" aria-label="Your weight ${isToday ? 'today' : 'on ' + esc(dayLabel(D.day))} in ${unit}" enterkeyhint="done"><span>${unit}</span></label>
    <button class="${D.weight_kg ? 'ghost' : 'primary'}">${D.weight_kg ? 'Update' : 'Log weight'}</button></form>
    <p class="small muted" id="fd-wtrend"></p></div>`;
  load('/api/food/weights?days=90', (W) => {
    const p = $('#fd-wtrend', el); if (!p || !W.trend_kg) return;
    const r = W.rate_kg_per_week;
    p.textContent = `Trend: ${U.weight(W.trend_kg)} ${unit}${r != null ? ` · ${r > 0 ? '+' : r < 0 ? '−' : ''}${U.weight(Math.abs(r))} ${unit} a week` : ''}. The trend smooths daily ups and downs from water and salt.`;
  });
  $('.wform', el).onsubmit = async (e) => {
    e.preventDefault(); const v = parseFloat(e.target.w.value); if (!(v > 0)) return;
    const kg = imp() ? v / 2.20462 : v;
    try {
      const r = await sendOrQueue('/api/food/weights', 'PUT', {day: D.day, kg}, `weight ${U.weight(kg)}`);
      if (r.queued) { patchDay(D.day, (d) => { d.weight_kg = kg; }); render(); toast('Weight saved on this phone - it sends when you are back online'); }
      else { refresh(); toast(`Weight logged: ${U.weight(kg)} ${imp() ? 'lb' : 'kg'}`); }
    } catch (x) { toast(x.message); }
  };
}
const fmtAmount = (e) => (e.unit === 'g' ? `${r1(e.amount)} g` : e.unit === 'serving' ? `${r1(e.amount)} serving${e.amount === 1 ? '' : 's'}` : `${r1(e.amount)} × ${e.unit}`);
const refresh = () => { invalidate('/api/food'); render(); };

async function addEntries(items) {   // each item gets a client_id, so a resend after a lost connection never doubles it
  items = items.map((it) => ({...it, client_id: it.client_id || newId()}));
  const r = await sendOrQueue('/api/food/entries', 'POST', items, items.length === 1 ? items[0].name : `${items.length} foods`);
  if (r.queued) {   // offline: show them now, marked "waiting to send"
    for (const it of items) patchDay(it.day, (d) => {
      d.entries.push({...it, id: 'q-' + it.client_id, pending: true});
      for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']) d.totals[k] = (d.totals[k] || 0) + (it[k] || 0);
    });
    render(); toast('Saved on this phone - it sends when you are back online'); return {queued: true};
  }
  refresh(); return r;
}
async function copyDay(from, to, meal) {
  try { const r = await api('/api/food/copy', json('POST', {from_day: from, to_day: to, meal: meal || null})); refresh(); toast(r.copied ? `Copied ${r.copied} item${r.copied > 1 ? 's' : ''}` : 'Nothing to copy'); }
  catch (x) { toast(x.message); }
}
function mealMenu(D, meal) {
  sheet(MEAL_NAMES[meal], `<div class="card">
    <button class="row-link" id="mm-save"><span>Save as a meal for next time</span></button>
    <button class="row-link" id="mm-copy"><span>Copy to today</span></button>
    <button class="row-link" id="mm-tomorrow"><span>Copy to the next day</span></button></div>`, (b, close) => {
    $('#mm-save', b).onclick = async () => {
      const name = prompt('Name this meal', `${MEAL_NAMES[meal]} favourite`); if (!name) return;
      try { await api('/api/food/meals', json('POST', {name, from_day: D.day, meal})); invalidate('/api/food/meals'); close(); toast('Meal saved'); } catch (x) { toast(x.message); }
    };
    $('#mm-copy', b).onclick = () => { close(); copyDay(D.day, isoDay(new Date()), meal); };
    $('#mm-tomorrow', b).onclick = () => { close(); copyDay(D.day, addDays(D.day, 1), meal); };
  });
}

// ---------- edit an entry ----------
function entrySheet(e, day) {
  const ref = e.ref;
  sheet('Edit food', `<form class="form" id="es">
    <label>Name<input name="name" value="${esc(e.name)}" maxlength="200"></label>
    <div class="two"><label>Amount<input name="amount" inputmode="decimal" value="${r1(e.amount)}"></label>
      <label>Unit<select name="unit">${unitOptions(ref, e.unit)}</select></label></div>
    ${macroInputs(e)}
    <div class="two"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === e.meal ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Day<input name="day" type="date" value="${esc(day)}"></label></div>
    <div class="actions"><button type="button" class="ghost danger" id="es-del">Delete</button><span class="spacer"></span>
      <button type="button" class="ghost" id="es-again">Log again</button><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#es', b);
    const rescale = () => {   // changing the amount rescales the numbers when we know the food's per-100 g / per-serving values
      const a = parseFloat(f.amount.value);
      if (!(a > 0)) return;
      let v;
      if (ref) v = scaleFood(ref, a, f.unit.value);
      else if (e.amount > 0 && f.unit.value === e.unit) { const k = a / e.amount; v = {kcal: e.kcal * k, protein_g: e.protein_g * k, carbs_g: e.carbs_g * k, fat_g: e.fat_g * k, fiber_g: e.fiber_g == null ? null : e.fiber_g * k}; }
      if (v) for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']) if (f[k]) f[k].value = v[k] == null ? '' : r1(v[k]);
    };
    f.amount.oninput = rescale; f.unit.onchange = rescale;
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
      const body = {name: f.name.value.trim() || e.name, amount: n(f.amount) || e.amount, unit: f.unit.value, meal: f.meal.value, day: f.day.value,
        kcal: n(f.kcal) || 0, protein_g: n(f.protein_g) || 0, carbs_g: n(f.carbs_g) || 0, fat_g: n(f.fat_g) || 0, fiber_g: n(f.fiber_g)};
      try { await api(`/api/food/entries/${e.id}`, json('PATCH', body)); close(); refresh(); } catch (x) { toast(x.message); }
    };
    $('#es-del', b).onclick = async () => {
      try {
        const r = await api(`/api/food/entries/${e.id}`, {method: 'DELETE'}); close(); refresh();
        const d = r.deleted;
        toast(`Deleted ${e.name}`, () => addEntries([{...d, day: d.day, ref: d.ref || null}]).catch((x) => toast(x.message)));
      } catch (x) { toast(x.message); }
    };
    $('#es-again', b).onclick = async () => {
      try { await addEntries([{day: isoDay(new Date()), meal: guessMeal(), name: e.name, brand: e.brand, amount: e.amount, unit: e.unit, kcal: e.kcal,
        protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g, source: e.source, ref: e.ref}]); close(); toast('Logged again today'); } catch (x) { toast(x.message); }
    };
  });
}
function unitOptions(ref, cur) {
  const opts = [['serving', ref && ref.serving ? `serving (${ref.serving.label})` : 'serving']];
  if (!ref || ref.per100) opts.push(['g', 'grams']);
  if (cur && !opts.some(([k]) => k === cur)) opts.push([cur, cur]);
  return opts.map(([k, n]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
const macroInputs = (e = {}) => `<div class="mac4">
  <label>Calories<input name="kcal" inputmode="decimal" value="${e.kcal != null ? r1(e.kcal) : ''}"></label>
  <label>Protein g<input name="protein_g" inputmode="decimal" value="${e.protein_g != null ? r1(e.protein_g) : ''}"></label>
  <label>Carbs g<input name="carbs_g" inputmode="decimal" value="${e.carbs_g != null ? r1(e.carbs_g) : ''}"></label>
  <label>Fat g<input name="fat_g" inputmode="decimal" value="${e.fat_g != null ? r1(e.fat_g) : ''}"></label>
  <label>Fiber g<input name="fiber_g" inputmode="decimal" value="${e.fiber_g != null ? r1(e.fiber_g) : ''}"></label></div>`;

// ---------- add: search / recent / my foods / meals / quick ----------
function addSheet(day, meal) {
  sheet('Add food', `<div class="ways"><button class="way" id="as-photo">${svg('camera')}<b>Take a photo</b><small>AI estimates the calories</small></button>
      <button class="way" id="as-scan">${svg('barcode')}<b>Scan a barcode</b><small>packaged food</small></button></div>
    <h3 class="ways-or">Or search and enter manually</h3>
    <div class="seg wide" role="tablist">${[['search', 'Search'], ['recent', 'Recent'], ['mine', 'Mine'], ['meals', 'Meals'], ['quick', 'Quick']]
    .map(([k, n], i) => `<button data-t="${k}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
    <div class="two mealpick"><label>Meal<select id="as-meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === meal ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Day<input id="as-day" type="date" value="${esc(day)}"></label></div><div id="as-body"></div>`, (b, close) => {
    const body = $('#as-body', b);
    const where = () => ({day: $('#as-day', b).value, meal: $('#as-meal', b).value});
    const tabs = {search: tSearch, recent: tRecent, mine: tMine, meals: tMeals, quick: tQuick};
    const show = (k) => { $$('[data-t]', b).forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === k)); tabs[k](body, where, close); };
    $$('[data-t]', b).forEach((x) => x.onclick = () => show(x.dataset.t));
    $('#as-photo', b).onclick = () => {   // photos go to the AI service, so it needs the person's OK first
      const w = where(); close();
      if (App.me.coach && !App.me.ai_ok) aiSheet(() => photoSheet(w.day, w.meal)); else photoSheet(w.day, w.meal);
    };
    $('#as-scan', b).onclick = () => { const w = where(); close(); scanSheet(w.day, w.meal); };
    show('search');
  });
}
const foodRow = (f, i) => `<button class="fe" data-i="${i}"><div><b>${esc(f.name)}</b><small class="muted">${esc([f.brand, f.serving && f.serving.label, f.source === 'usda' ? 'USDA' : f.source === 'off' ? 'Open Food Facts' : f.source === 'custom' ? 'My food' : ''].filter(Boolean).join(' · '))}</small></div>
  <div class="r"><b class="num">${r0(f.per_serving ? f.per_serving.kcal : f.per100 && f.serving ? f.per100.kcal * (f.serving.g || 100) / 100 : f.kcal)}</b><small class="muted">kcal</small></div></button>`;
function tSearch(body, where, close) {
  body.innerHTML = `<form id="ts-f" role="search"><input type="search" name="q" placeholder="Search foods, brands…" autocomplete="off" enterkeyhint="search"></form><div id="ts-r" class="results"><p class="small muted">Your own foods and recent items come first, then USDA and Open Food Facts.</p></div>`;
  const inp = $('input', body), out = $('#ts-r', body); inp.focus();
  let timer, seq = 0, all = [];
  const draw = (groups) => {
    all = []; let html = '';
    for (const [title, list] of groups) if (list.length) { html += `<h3 class="ghead">${title}</h3>`; for (const f of list) { html += foodRow(f, all.length); all.push(f); } }
    out.innerHTML = html || '<p class="small muted">No matches yet…</p>';
    $$('[data-i]', out).forEach((x) => x.onclick = () => amountSheet(all[+x.dataset.i], where(), close));
  };
  const run = async (q) => {
    const my = ++seq; if (q.length < 2) { out.innerHTML = ''; return; }
    try {   // fast local results first, then the databases
      const local = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=mine`);
      if (my !== seq) return;
      const recent = local.recent.map(recentToFood);
      draw([['My foods', local.mine], ['Recent', recent]]);
      out.insertAdjacentHTML('beforeend', '<p class="small muted" id="ts-load">Searching food databases…</p>');
      const ext = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=off,usda`);
      if (my !== seq) return;
      draw([['My foods', local.mine], ['Recent', recent], ['USDA', ext.usda], ['Open Food Facts', ext.off]]);
    } catch (x) { if (my === seq) out.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(inp.value.trim()), 300); };
  $('#ts-f', body).onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); run(inp.value.trim()); inp.blur(); };
}
const recentToFood = (r) => (r.ref ? {...r.ref, name: r.name, brand: r.brand, _last: r} :
  {source: 'recent', name: r.name, brand: r.brand, per_serving: {kcal: r.kcal / r.amount, protein_g: r.protein_g / r.amount, carbs_g: r.carbs_g / r.amount, fat_g: r.fat_g / r.amount, fiber_g: r.fiber_g == null ? null : r.fiber_g / r.amount},
   serving: {label: r.unit === 'serving' ? '1 serving' : `1 ${r.unit}`, g: null}, _last: r, _unit: r.unit});
async function tRecent(body, where, close) {
  body.innerHTML = skel(1);
  try {
    const [usual, rows] = await Promise.all([api('/api/food/usual').catch(() => []), api('/api/food/recent')]);
    const foods = [...usual, ...rows].map(recentToFood);
    const quick = (f, i) => `<div class="usual">${foodRow(f, i)}<button class="icon-btn qadd" data-q="${i}" aria-label="Log ${esc(f.name)} now (${esc(fmtAmount(f._last))})">${svg('plus')}</button></div>`;
    body.innerHTML = (usual.length ? `<h3 class="ghead">Your usuals <small class="muted">· + logs your usual amount</small></h3><div class="results">${usual.map((_, i) => quick(foods[i], i)).join('')}</div>` : '')
      + (rows.length ? `<h3 class="ghead">Recent</h3><div class="results">${rows.map((_, j) => foodRow(foods[usual.length + j], usual.length + j)).join('')}</div>` : '')
      || '<p class="small muted">Foods you log show up here for one-tap re-logging.</p>';
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close));
    $$('[data-q]', body).forEach((x) => x.onclick = async () => {
      const f = foods[+x.dataset.q], l = f._last, w = where(); x.disabled = true;
      try { await addEntries([{...w, name: l.name, brand: l.brand, amount: l.amount, unit: l.unit, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g,
        fat_g: l.fat_g, fiber_g: l.fiber_g, source: 'recent', ref: l.ref || null}]); close(); toast(`Added ${l.name} to ${MEAL_NAMES[w.meal].toLowerCase()}`); }
      catch (e) { toast(e.message); x.disabled = false; }
    });
  } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
async function tMine(body, where, close) {
  body.innerHTML = skel(1);
  const draw = async () => {
    const foods = await api('/api/food/foods');
    body.innerHTML = `<button class="ghost wide" id="tm-new">+ Create a food</button><div class="results">${foods.map(foodRow).join('')}</div>`;
    $('#tm-new', body).onclick = () => foodEditor(null, draw);
    $$('[data-i]', body).forEach((x) => x.onclick = () => amountSheet(foods[+x.dataset.i], where(), close, () => foodEditor(foods[+x.dataset.i], draw)));
  };
  try { await draw(); } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
async function tMeals(body, where, close) {
  body.innerHTML = skel(1);
  try {
    const meals = await api('/api/food/meals');
    body.innerHTML = meals.length ? `<div class="results">${meals.map((m, i) => `<div class="fe"><div><b>${esc(m.name)}</b><small class="muted">${m.items.length} items · ${r0(m.totals.protein_g)}P ${r0(m.totals.carbs_g)}C ${r0(m.totals.fat_g)}F</small></div>
      <div class="r"><b class="num">${r0(m.totals.kcal)}</b><button class="linkbtn" data-log="${i}">Log</button> <button class="linkbtn danger" data-del="${i}">Delete</button></div></div>`).join('')}</div>`
      : '<p class="small muted">Save a meal from the "…" button on any meal to log it again in one tap.</p>';
    $$('[data-log]', body).forEach((x) => x.onclick = async () => {
      const m = meals[+x.dataset.log], w = where();
      try { await addEntries(m.items.map((it) => ({...it, ...w, ref: it.ref || null, source: 'meal'}))); close(); toast(`Logged ${m.name}`); } catch (e) { toast(e.message); }
    });
    $$('[data-del]', body).forEach((x) => x.onclick = async () => {
      const m = meals[+x.dataset.del]; if (!confirm(`Delete saved meal "${m.name}"?`)) return;
      try { await api(`/api/food/meals/${m.id}`, {method: 'DELETE'}); tMeals(body, where, close); } catch (e) { toast(e.message); }
    });
  } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
function tQuick(body, where, close) {
  body.innerHTML = `<form class="form" id="tq"><label>Name<input name="name" placeholder="e.g. Restaurant salad" maxlength="200"></label>${macroInputs()}
    <p class="small muted">Leave calories blank to work them out from the macros.</p>
    <div class="actions"><button class="primary">Add</button></div></form>`;
  const f = $('#tq', body); f.name.focus();
  f.onsubmit = async (e) => {
    e.preventDefault(); const n = (x) => (x.value.trim() === '' ? 0 : parseFloat(x.value) || 0);
    const it = {name: f.name.value.trim() || 'Quick add', amount: 1, unit: 'serving', protein_g: n(f.protein_g), carbs_g: n(f.carbs_g), fat_g: n(f.fat_g), fiber_g: f.fiber_g.value ? n(f.fiber_g) : null, source: 'quick'};
    it.kcal = f.kcal.value.trim() ? n(f.kcal) : Math.round(it.protein_g * 4 + it.carbs_g * 4 + it.fat_g * 9);
    if (!it.kcal && !it.protein_g) { toast('Enter calories or macros'); return; }
    try { await addEntries([{...it, ...where()}]); close(); toast(`Added ${it.name}`); } catch (x) { toast(x.message); }
  };
}

// choose an amount for a food (live numbers), then add
function amountSheet(f, w, closeParent, onEditFood) {
  const last = f._last;
  const startUnit = last ? last.unit : f._unit || 'serving', startAmt = last ? last.amount : 1;
  sheet(f.name, `<form class="form" id="am">
    ${f.brand ? `<p class="muted">${esc(f.brand)}</p>` : ''}
    <div class="two"><label>Amount<input name="amount" inputmode="decimal" value="${r1(startAmt)}"></label>
      <label>Unit<select name="unit">${unitOptions(f.per100 || f.per_serving ? f : null, startUnit)}</select></label></div>
    <div class="macpreview" id="am-p"></div>
    <div class="actions">${onEditFood ? '<button type="button" class="ghost" id="am-edit">Edit food</button><span class="spacer"></span>' : ''}<button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}</button></div></form>`, (b, close) => {
    const fm = $('#am', b);
    const calc = () => { const a = parseFloat(fm.amount.value) || 0; const v = f.per100 || f.per_serving ? scaleFood(f, a, fm.unit.value) : {kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0};
      $('#am-p', b).innerHTML = `<div><b class="num">${r0(v.kcal)}</b><small>kcal</small></div>${MACROS.map(([k, , s]) => `<div><b class="num">${r1(v[k])}</b><small>${s === 'P' ? 'protein' : s === 'C' ? 'carbs' : 'fat'} g</small></div>`).join('')}`; return v; };
    fm.amount.oninput = calc; fm.unit.onchange = calc; calc(); fm.amount.select();
    if (onEditFood) $('#am-edit', b).onclick = () => { close(); onEditFood(); };
    fm.onsubmit = async (e) => {
      e.preventDefault(); const a = parseFloat(fm.amount.value); if (!(a > 0)) { toast('Enter an amount'); return; }
      const v = calc();
      const ref = {source: f.source, id: f.id, per100: f.per100 || null, per_serving: f.per_serving || null, serving: f.serving || null};
      try { await addEntries([{...w, name: f.name, brand: f.brand || null, amount: a, unit: fm.unit.value, ...v, source: f.source === 'recent' ? 'recent' : f.source || 'search', ref}]);
        close(); closeParent(); toast(`Added ${f.name}`); } catch (x) { toast(x.message); }
    };
  });
}
function foodEditor(food, after) {
  const ps = food && food.per_serving || {};
  sheet(food ? 'Edit my food' : 'New food', `<form class="form" id="fe">
    <label>Name<input name="name" required maxlength="200" value="${esc(food ? food.name : '')}"></label>
    <div class="two"><label>Brand<input name="brand" value="${esc(food && food.brand || '')}"></label><label>Barcode<input name="barcode" inputmode="numeric" value="${esc(food && food.barcode || '')}"></label></div>
    <div class="two"><label>Serving<input name="serving_label" value="${esc(food && food.serving ? food.serving.label : '1 serving')}"></label><label>Serving grams<input name="serving_g" inputmode="decimal" value="${food && food.serving && food.serving.g ? r1(food.serving.g) : ''}"></label></div>
    <p class="small muted">Nutrition per serving:</p>${macroInputs(ps)}
    <label class="check"><input type="checkbox" name="favorite"${food && food.favorite ? ' checked' : ''}> Favourite (shows first)</label>
    <div class="actions">${food ? '<button type="button" class="ghost danger" id="fe-del">Delete</button><span class="spacer"></span>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#fe', b), n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {name: f.name.value.trim(), brand: f.brand.value.trim() || null, barcode: f.barcode.value.trim() || null, serving_label: f.serving_label.value.trim() || '1 serving',
        serving_g: n(f.serving_g), kcal: n(f.kcal) || 0, protein_g: n(f.protein_g) || 0, carbs_g: n(f.carbs_g) || 0, fat_g: n(f.fat_g) || 0, fiber_g: n(f.fiber_g), favorite: f.favorite.checked};
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
function photoSheet(day, meal) {
  sheet('Log from a photo', `<form class="form" id="ph">
    <input type="file" accept="image/*" id="ph-file" hidden>
    <button type="button" class="ghost ph-pick" id="ph-pick">${svg('upload')}<span>Take or choose a photo</span></button>
    <div id="ph-prev" hidden><img id="ph-img" alt="Your meal photo"><button type="button" class="linkbtn" id="ph-change">Change photo</button></div>
    <label>Describe it <span class="muted">(optional, makes it more accurate)</span><textarea name="note" maxlength="600" placeholder="e.g. 2 eggs fried in butter, 1 slice sourdough, half an avocado, black coffee"></textarea></label>
    <div class="two"><label>Meal<select name="meal">${Object.entries(MEAL_NAMES).map(([k, n]) => `<option value="${k}"${k === meal ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Day<input name="day" type="date" value="${esc(day)}"></label></div>
    <div class="actions"><button class="primary" id="ph-go">Estimate</button></div></form><div id="ph-items"></div>`, (b, close) => {
    const f = $('#ph', b), file = $('#ph-file', b), box = $('#ph-items', b), go_ = $('#ph-go', b);
    let photo = null;
    const pick = () => file.click();
    $('#ph-pick', b).onclick = pick; $('#ph-change', b).onclick = pick;
    file.onchange = async () => {
      const fl = file.files && file.files[0]; if (!fl) return;
      try { photo = await shrinkPhoto(fl); } catch (e) { toast("That photo couldn't be opened"); return; }
      $('#ph-img', b).src = photo; $('#ph-prev', b).hidden = false; $('#ph-pick', b).hidden = true;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const note = f.note.value.trim();
      if (!photo && !note) { toast('Add a photo or a description'); return; }
      go_.disabled = true; go_.textContent = 'Looking…'; box.innerHTML = `<p class="small muted">${photo ? 'Looking at your photo…' : 'Working it out…'}</p>`;
      try {
        const r = await api('/api/food/photo', json('POST', {image: photo, note: note || null}));
        if (!r.items.length) { box.innerHTML = '<p class="err">No food found - add a description and try again.</p>'; return; }
        reviewItems(box, r.items.map((it) => ({...it, name: it.amount ? `${it.name} (${it.amount})` : it.name})), {
          intro: `<p class="small muted">${r.notes ? esc(r.notes) + ' ' : ''}Check the numbers and change anything before adding.</p>`,
          add: async (items) => { await addEntries(items.map((it) => ({...it, day: f.day.value, meal: f.meal.value, source: 'photo'}))); close(); },
        });
        $('#ph-prev', b).classList.add('small-prev');                       // make room for the list
        requestAnimationFrame(() => box.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}));
      } catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
      finally { go_.disabled = false; go_.textContent = 'Estimate again'; }
    };
  });
}
// editable list of estimated items: tick, rename, change numbers, then add
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
function scanSheet(day, meal) {
  let stop = () => {};
  const closeSheet = sheet('Scan a barcode', `<div class="scan"><video id="sc-v" playsinline muted></video><div class="scanbox"></div></div>
    <p class="small muted" id="sc-msg">Point the camera at the barcode.</p>
    <form class="wform" id="sc-f"><input name="code" inputmode="numeric" placeholder="or type the number" aria-label="Barcode number"><button class="ghost">Look up</button></form>`, async (b, close) => {
    const v = $('#sc-v', b), msg = $('#sc-msg', b);
    const found = async (code) => {
      stop(); msg.textContent = `Found ${code} — looking it up…`;
      try { const f = await api(`/api/food/barcode/${code}`); close(); amountSheet(f, {day, meal}, () => {}); }
      catch (x) { msg.textContent = x.message; if (x.status === 404) { const go2 = confirm(`${x.message}. Create it now?`); if (go2) { close(); foodEditor({name: '', barcode: code, serving: {label: '1 serving'}}, null); } } }
    };
    $('#sc-f', b).onsubmit = (e) => { e.preventDefault(); const c = e.target.code.value.replace(/\D/g, ''); if (c.length >= 6) found(c); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Camera not available here — type the number instead.'; return; }
    try {
      if ('BarcodeDetector' in window) {
        const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
        v.srcObject = stream; await v.play(); let on = true;
        stop = () => { on = false; stream.getTracks().forEach((t) => t.stop()); };
        const det = new BarcodeDetector({formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']});
        const tick = async () => { if (!on) return; try { const r = await det.detect(v); if (r.length) { found(r[0].rawValue); return; } } catch (e) { /* frame not ready */ } setTimeout(tick, 200); };
        tick();
      } else {   // iPhone Safari: no BarcodeDetector -> ZXing (loaded only now)
        await new Promise((res, rej) => { if (window.ZXing) return res(); const s = document.createElement('script'); s.src = '/static/vendor/zxing.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
        const reader = new ZXing.BrowserMultiFormatReader();
        stop = () => { try { reader.reset(); } catch (e) { /* */ } };
        reader.decodeFromVideoDevice(null, v, (res) => { if (res) found(res.getText()); });
      }
    } catch (e) { msg.textContent = 'Camera blocked — allow camera access, or type the number.'; }
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
  const m = App.me;
  sheet('Daily targets', `<form class="form" id="tg"><div class="mac4">
    <label>Calories<input name="kcal_target" inputmode="numeric" value="${esc(m.kcal_target || '')}"></label>
    <label>Protein g<input name="protein_target" inputmode="numeric" value="${esc(m.protein_target || '')}"></label>
    <label>Carbs g<input name="carbs_target" inputmode="numeric" value="${esc(m.carbs_target || '')}"></label>
    <label>Fat g<input name="fat_target" inputmode="numeric" value="${esc(m.fat_target || '')}"></label>
    <label>Fiber g<input name="fiber_target" inputmode="numeric" value="${esc(m.fiber_target || '')}"></label></div>
    <p class="small muted" id="tg-sum"></p><div class="actions"><button class="primary">Save targets</button></div></form>`, (b, close) => {
    const f = $('#tg', b), n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value));
    const sum = () => { const p = n(f.protein_target) || 0, c = n(f.carbs_target) || 0, fat = n(f.fat_target) || 0, k = p * 4 + c * 4 + fat * 9;
      $('#tg-sum', b).textContent = k ? `Macros add up to ${Math.round(k)} kcal${n(f.kcal_target) ? ` (target ${n(f.kcal_target)})` : ''}.` : ''; };
    f.oninput = sum; sum();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {kcal_target: n(f.kcal_target), protein_target: n(f.protein_target), carbs_target: n(f.carbs_target), fat_target: n(f.fat_target), fiber_target: n(f.fiber_target)};
      try { await api('/api/food/targets', json('PUT', body)); Object.assign(App.me, body); close(); refresh(); toast('Targets saved'); } catch (x) { toast(x.message); }
    };
  });
}

// ---------- weight trend + food trends ----------
route(/^\/food\/weight$/, 'food', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>Weight</h1>${skel(2)}`;
  wireBack(el, '/food');
  await load('/api/food/weights?days=365', (W) => {
    const pts = W.points, wt = (kg) => `${U.weight(kg)} ${imp() ? 'lb' : 'kg'}`;
    el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>Weight</h1>
      <div class="card"><div class="bigstat">${stat('Trend', W.trend_kg ? U.weight(W.trend_kg) : '–', imp() ? 'lb' : 'kg')}${stat('Per week', W.rate_kg_per_week == null ? '–' : (W.rate_kg_per_week > 0 ? '+' : '') + U.weight(W.rate_kg_per_week), imp() ? 'lb' : 'kg')}</div>
        <div id="w-chart"></div><p class="small muted">The trend smooths out day-to-day water swings; it's the number to watch.</p></div>
      <div class="card"><h2>Weigh-ins</h2>${pts.length ? [...pts].reverse().slice(0, 60).map((p) => `<div class="row"><span>${esc(new Date(p.day + 'T12:00').toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'}))}</span>
        <span class="num">${wt(p.kg)} <small class="muted">trend ${U.weight(p.trend)}</small> <button class="linkbtn danger" data-del="${p.day}" aria-label="Delete weigh-in">×</button></span></div>`).join('') : '<p class="muted">Log your weight on the Food page.</p>'}</div>`;
    wireBack(el, '/food');
    $$('[data-del]', el).forEach((b) => b.onclick = async () => { try { await api(`/api/food/weights/${b.dataset.del}`, {method: 'DELETE'}); invalidate('/api/food'); render(); } catch (x) { toast(x.message); } });
    if (pts.length) requestAnimationFrame(() => {
      const xs = pts.map((p) => new Date(p.day + 'T12:00') / 864e5);
      dotChart($('#w-chart', el), pts.map((p, i) => ({x: xs[i], y: imp() ? p.kg * 2.20462 : p.kg, id: i})), {yfmt: (v) => v.toFixed(1),
        trend: pts.length > 1 ? {start: imp() ? pts[0].trend * 2.20462 : pts[0].trend, end: imp() ? pts[pts.length - 1].trend * 2.20462 : pts[pts.length - 1].trend} : null});
    });
  });
});
route(/^\/food\/trends$/, 'food', async () => go('/food?view=trends', {replace: true}));   // old address

// ---------- Add past days (2026-10-09): paste / CSV / one day -> preview -> save ----------
route(/^\/food\/import$/, 'food', async (el) => {
  const lb = imp(), wu = lb ? 'lb' : 'kg', today = isoDay(new Date());
  const wshow = (kg) => (kg == null ? '–' : (lb ? kg * 2.20462 : kg).toFixed(1));
  el.innerHTML = `<div class="top">${backBtn('Trends')}</div><h1>Add past days</h1>
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
      <div class="gridbar"><label>From<input type="date" id="hg-start" max="${today}"></label><label class="tog"><input type="checkbox" id="hg-mac"> Show macros</label></div>
      <div id="hg"></div></div>
    <div id="hi-sum"></div>`;
  wireBack(el, '/food?view=trends');
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
      try { await saveRows(P.rows.map(({food_logged_here, weight_replaces, ...r}) => r)); box.innerHTML = '<p class="small">Imported. See it on Nutrition &gt; Trends (pick a longer range or "Since…").</p>'; f.reset(); }
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

// ---------- Nutrition > Trends (2026-10-09): one range, stat tiles, insights, charts ----------
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
    box.innerHTML = `<div class="card"><h2>Your daily calorie needs<span class="muted small">without workouts</span></h2>
      <div class="needs-eq"><div><small>Resting burn (BMR)</small><b class="num">${r0(E.bmr)}</b></div><span>×</span><div><small>Everyday activity</small><b class="num">${E.activity_factor}</b></div><span>=</span><div class="hi"><small>Daily needs</small><b class="num">${r0(E.base)}</b></div></div>
      ${E.bmr_exact ? '' : '<p class="small warn-text">BMR is a rough guess from your weight. Add your height, birth year and sex under <a href="/me">Me &gt; Settings</a> for a precise one.</p>'}
      <p class="small muted">Everyday activity outside workouts:</p>
      <div class="seg wide actlvl" role="group" aria-label="Everyday activity">${ACTIVITY_LEVELS.map(([f, n, d]) => `<button data-f="${f}" aria-pressed="${f === lvl[0]}" title="${esc(d)}">${esc(n)}</button>`).join('')}</div>
      <p class="small muted">Workouts are not included here. They are added to the day you do them, which deepens that day's deficit${E.avg_exercise ? ` (lately about ${r0(E.avg_exercise)} kcal a day on average)` : ''}.</p>
      ${check ? `<p class="small">${esc(check)}</p>` : ''}
      <h3 class="sub">Set your daily calorie target</h3>
      <div class="tdee-opts">${opts.map(([n, d]) => `<button class="ghost" data-k="${E.base + d}"><small>${esc(n)}</small><b class="num">${r0(E.base + d)}</b></button>`).join('')}</div>
      <p class="small muted">Based on daily needs alone, so any workout adds to your deficit${App.me.kcal_target ? `. Now ${r0(App.me.kcal_target)}` : ''}.</p></div>`;
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
    box.innerHTML = `      <div class="card"><details><summary>Week by week</summary><div class="tblwrap"><table class="tbl yrs"><thead><tr><th>Week of</th><th class="r">Days</th><th class="r">kcal</th><th class="r">P</th><th class="r">C</th><th class="r">F</th><th class="r">Exercise</th><th class="r">${U.du()}</th><th class="r">Weight</th></tr></thead><tbody>
        ${[...shown].reverse().map((w) => `<tr${w.partial ? ' class="cur"' : ''}><td>${esc(new Date(w.week + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}))}</td><td class="r num">${w.days_logged}${w.partial ? '' : '/7'}</td>
          <td class="r num"><b>${w.kcal == null ? '–' : r0(w.kcal)}</b></td><td class="r num">${w.protein_g == null ? '–' : r0(w.protein_g)}</td><td class="r num">${w.carbs_g == null ? '–' : r0(w.carbs_g)}</td><td class="r num">${w.fat_g == null ? '–' : r0(w.fat_g)}</td>
          <td class="r num">${r0(w.exercise_per_day)}</td><td class="r num">${U.dist(w.distance_m, 0)}</td><td class="r num">${wt(w.trend_kg)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Per day on logged days · exercise = kcal burned per day · ${U.du()} = run + ride + walk · weight = trend at the end of the week.</p></details></div>`;
  });
}
const NRANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];
async function nutritionTrends(root, q) {
  // range: 7/30/90/365 days, or "since" = from a start date the person picks (e.g. the start of a diet); remembered on this phone
  let r = q.get('r'); if (!r) { try { r = localStorage.getItem('fit.nrange'); } catch (e) { /* none */ } }
  if (r !== 'since' && !NRANGES.some((x) => String(x[0]) === r)) r = '30';
  const save = (v) => { try { localStorage.setItem('fit.nrange', v); } catch (e) { /* none */ } go(`/food?view=trends&r=${v}`, {replace: true}); };
  const startSheet = (cur) => sheet('Count from', `<form class="form" id="ds"><label>Start date<input type="date" name="since" value="${esc(cur || '')}" max="${isoDay(new Date())}"></label>
      <p class="small muted">For example the day you started your diet. Trends, the running deficit and the averages then cover everything since that day.</p>
      <div class="actions"><button class="primary">Use this date</button></div></form>`, (b, close) => {
    $('#ds', b).onsubmit = async (e) => { e.preventDefault(); const v = $('#ds', b).since.value; if (!v) return;
      try { await api('/api/food/deficit/start', json('PUT', {since: v})); close(); invalidate('/api/food'); save('since'); } catch (x) { toast(x.message); } };
  });
  root.innerHTML = `<div class="chips nrange" role="group" aria-label="Time range">${NRANGES.map(([d, n]) => `<button class="chip" data-r="${d}" aria-pressed="${String(d) === r}">${n}</button>`).join('')}
      <button class="chip" data-r="since" aria-pressed="${r === 'since'}" id="nt-since">Since…</button></div>
    <div id="nt-body">${skel(3)}</div><div id="nt-energy"></div><div id="nt-weeks"></div>
    <a class="ghost addpast" href="/food/import">${svg('upload')}<span>Add past days<small>weight, calories or deficits from before</small></span></a>`;
  energyCard($('#nt-energy', root)); weeksCard($('#nt-weeks', root));
  let since = null;
  $$('.nrange .chip', root).forEach((b) => b.onclick = () => (b.dataset.r === 'since' ? (since && r !== 'since' ? save('since') : startSheet(since)) : save(b.dataset.r)));
  const url = r === 'since' ? '/api/food/insights?days=30&since=' : `/api/food/insights?days=${r}`;
  if (r === 'since') {   // need the saved start date first
    const I0 = await api('/api/food/insights?days=7').catch(() => null); since = I0 && I0.deficit_start;
    if (!since) { $('#nt-body', root).innerHTML = '<div class="card empty"><b>Pick a start date</b>Tap "Since…" to choose the day to count from.</div>'; startSheet(null); return; }
  }
  await load(r === 'since' ? url + since : url, (I) => {
    since = I.deficit_start || since;
    const sb = $('#nt-since', root); if (sb && since) sb.textContent = `Since ${new Date(since + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'})}${r === 'since' ? ' ✎' : ''}`;
    drawTrends($('#nt-body', root), I, I.summary.days);
  });
}
function drawTrends(box, I, days) {
  if (!box || !box.isConnected) return;
  const S = I.summary, T = I.targets, lb = imp(), wu = lb ? 'lb' : 'kg', wconv = (kg) => (lb ? kg * 2.20462 : kg);
  const past = I.rows.filter((r) => !r.today);
  if (!I.rows.some((r) => r.eaten != null)) { box.innerHTML = '<div class="card empty"><b>Nothing logged in this range</b>Log food on the Log tab, or <a href="/food/import">add your past days</a> from another app or a spreadsheet.</div>'; return; }
  const tile = (label, value, unit, sub, cls = '') => `<div class="ntile ${cls}"><small>${esc(label)}</small><b class="num">${value}<i>${esc(unit)}</i></b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const weekly = days > 90;   // a year of daily bars is too thin: average by week
  const dlabel = (d, o) => new Date(d + 'T12:00').toLocaleDateString([], o);
  let cols;
  if (weekly) {
    const W = {};
    for (const r of I.rows) { const d = new Date(r.day + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = isoDay(d); (W[k] = W[k] || []).push(r); }
    cols = Object.entries(W).map(([k, rs], i, arr) => { const c = rs.filter((r) => r.counted), a = (f) => (c.length ? c.reduce((s, r) => s + (r[f] || 0), 0) / c.length : null);
      const prev = arr[i - 1] && new Date(arr[i - 1][0] + 'T12:00'), d = new Date(k + 'T12:00');
      const ws = rs.filter((r) => r.weight != null), lastT = [...rs].reverse().find((r) => r.trend != null);
      return {label: 'Week of ' + dlabel(k, {month: 'short', day: 'numeric'}), tick: !prev || prev.getMonth() !== d.getMonth() ? (i === 0 || d.getMonth() % 2 === 0 ? dlabel(k, {month: 'short'}) : '') : '', eaten: a('eaten'), burned: a('burned') || rs[0].burned, goal: a('goal'), protein_g: a('protein_g'), partial: rs.some((r) => r.today),
        weight: ws.length ? wconv(ws.reduce((x, r) => x + r.weight, 0) / ws.length) : null, trend: lastT ? wconv(lastT.trend) : null}; });
  } else {
    const every = days <= 7 ? 1 : days <= 30 ? 7 : 14;
    cols = I.rows.map((r, i) => ({label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}), tick: (I.rows.length - 1 - i) % every === 0 ? dlabel(r.day, days <= 7 ? {weekday: 'short'} : {month: 'short', day: 'numeric'}) : '',
      eaten: r.eaten, burned: r.burned, goal: r.goal, protein_g: r.protein_g, partial: r.today, weight: r.weight == null ? null : wconv(r.weight), trend: r.trend == null ? null : wconv(r.trend)}));
  }
  const pDef = S.predicted_kg, pTr = S.trend_change_kg;
  const kcalP = (S.avg_protein_g || 0) * 4, kcalC = (S.avg_carbs_g || 0) * 4, kcalF = (S.avg_fat_g || 0) * 9, kcalM = kcalP + kcalC + kcalF || 1;
  const pct = (v) => Math.round(v / kcalM * 100);
  box.innerHTML = `<div class="ntiles">
      ${tile('Avg eaten / day', S.avg_eaten == null ? '–' : r0(S.avg_eaten), 'kcal', S.avg_goal ? `goal ${r0(S.avg_goal)}` : '')}
      ${tile('Avg deficit / day', S.avg_deficit == null ? '–' : r0(Math.abs(S.avg_deficit)), 'kcal', S.avg_deficit == null ? '' : S.avg_deficit >= 0 ? 'deficit' : 'surplus', S.avg_deficit == null ? '' : S.avg_deficit >= 0 ? 'good' : 'bad')}
      ${tile('Total deficit', r0(Math.abs(S.total_deficit)), 'kcal', `≈ ${wconv(Math.abs(pDef)).toFixed(1)} ${wu} ${pDef <= 0 ? 'lost' : 'gained'}`, S.total_deficit >= 0 ? 'good' : 'bad')}
      ${tile('Weight trend', pTr == null ? '–' : sgn(pTr) + wconv(Math.abs(pTr)).toFixed(1), pTr == null ? '' : wu, pTr == null ? 'log weight to see it' : 'over these days')}
      ${tile('Avg protein', S.avg_protein_g == null ? '–' : r0(S.avg_protein_g), 'g', T.protein_target ? `target ${r0(T.protein_target)} g` : '')}
      ${tile('Days logged', S.logged, `/ ${S.past_days}`, S.past_days ? `${Math.round(S.logged / S.past_days * 100)}%` : '')}</div>
    ${I.insights.length ? `<div class="card"><h2>Insights</h2>${I.insights.map(([k, t]) => `<div class="insight"><span class="dot ${k === 'good' ? 'good' : k === 'warn' ? 'warn' : 'info'}"></span><div><span>${esc(t)}</span></div></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Eaten, burned & weight<span class="muted small">${weekly ? 'weekly average' : 'per day'}</span></h2><div id="nt-energychart"></div>
      <p class="small muted">Burned = your daily needs (${r0(S.tdee)} kcal: BMR × everyday activity) + that day's workouts. Bars below the orange line are a deficit.</p></div>
    <div class="card"><h2>Running deficit</h2><div id="nt-cum"></div>
      <p class="small muted">Adds up each fully logged day's deficit. 3,500 kcal ≈ 1 lb of fat.</p></div>
    <div class="card"><h2>Protein<span class="muted small">${weekly ? 'weekly average' : 'per day'}</span></h2><div id="nt-protein"></div></div>
    <div class="card"><h2>Where your calories come from</h2>
      ${S.avg_protein_g != null ? `<div class="split" role="img" aria-label="Protein ${pct(kcalP)}%, carbs ${pct(kcalC)}%, fat ${pct(kcalF)}%"><i class="m-protein_g" data-w="${(kcalP / kcalM).toFixed(3)}"></i><i class="m-carbs_g" data-w="${(kcalC / kcalM).toFixed(3)}"></i><i class="m-fat_g" data-w="${(kcalF / kcalM).toFixed(3)}"></i></div>
      <div class="legend small"><span><i class="sw m-protein_g"></i>Protein ${pct(kcalP)}% · ${r0(S.avg_protein_g)} g</span><span><i class="sw m-carbs_g"></i>Carbs ${pct(kcalC)}% · ${r0(S.avg_carbs_g)} g</span><span><i class="sw m-fat_g"></i>Fat ${pct(kcalF)}% · ${r0(S.avg_fat_g)} g</span></div>` : ''}
      <h3 class="sub">By meal</h3>${Object.entries(S.meals || {}).map(([m, v]) => `<div class="mrow mealrow"><span>${esc(MEAL_NAMES[m])}</span><div class="track"><div class="bar meal-bar" data-w="${(v / 100).toFixed(3)}"></div></div><b class="num">${v}%</b></div>`).join('')}</div>
    ${I.top_foods.length ? `<div class="card"><h2>Top foods by calories</h2>${I.top_foods.map((f) => `<div class="mrow topf"><span title="${esc(f.name)}">${esc(f.name)}</span><div class="track"><div class="bar meal-bar" data-w="${(f.kcal / I.top_foods[0].kcal).toFixed(3)}"></div></div><b class="num">${r0(f.kcal)}<i> · ${f.n}×</i></b></div>`).join('')}</div>` : ''}`;
  requestAnimationFrame(() => {
    energyChart($('#nt-energychart', box), cols, {weight: {fmt: (v) => `${v.toFixed(1)} ${wu}`, axis: (v) => v.toFixed(1), unit: wu}});
    const cum = past.filter((r) => r.eaten != null);
    dayLine($('#nt-cum', box), cum.map((r) => ({y: r.total, tick: dlabel(r.day, {month: 'short', day: 'numeric'}), label: dlabel(r.day, {weekday: 'short', month: 'short', day: 'numeric'}),
      sub: r.counted ? `Day <b>${r0(Math.abs(r.deficit))}</b> ${r.deficit >= 0 ? 'deficit' : 'surplus'}` : 'not counted'})),
      {fmt: (v, short) => (short ? (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : r0(v)) : `${r0(Math.abs(v))} kcal ${v >= 0 ? 'deficit' : 'surplus'}`)});
    periodBars($('#nt-protein', box), cols.map((c) => ({label: c.label, tick: c.tick, partial: c.partial, segs: [{k: 's3', v: c.protein_g || 0}]})),
      {keys: [{k: 's3', name: 'Protein'}], fmt: (v) => `${r0(v)} g`, yfmt: (v) => String(Math.round(v)), avg: T.protein_target || null, avgLabel: 'Target', height: 150, hint: 'Touch a bar to read it'});
  });
}

start();
