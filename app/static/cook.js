// Kinetta phone app — Part 6: cooking mode (2026-10-11). Build a dish while you cook ("100 g chicken", "250 g carrots"),
// weigh the whole cooked dish, weigh your plate, and your portion is logged with its share of the calories and macros.
// The rest stays as leftovers for a few days. The server does the sums (app/api_dishes.py).
// 2026-10-12: ingredients are typed the way you'd text them ("2 apples", "a splash of oil", "make the rice 200 g"):
// app/cook_chat.py answers from what you've used before, or asks the AI; search-and-pick stays as the fallback.
'use strict';

// 2026-10-12, round two: a dish is cooked for a meal; its weight is the ingredients added up until the cooked dish is
// weighed; a portion is grams or a share ("1 of 4"); Finish takes it off the list (keeping leftovers if you like), and a
// dish is kept only if you save it as a recipe, which Cooking offers to cook again.

const gfmt = (g) => (g == null ? '–' : `${Math.round(g).toLocaleString()} g`);
Object.assign(IC, {bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>'});
const isDefaultName = (n) => Object.values(MEAL_NAMES).includes(n);
const leftText = (d) => (d.weight_g ? `${gfmt(d.left_g)} left` : `${Math.round(d.left_share * 100)}% left`);
const someLeft = (d) => (d.weight_g ? d.left_g >= 1 : d.left_share >= 0.01);
const LEFTOVER_DAYS = 5;

// Add food > Create a dish (2026-10-12; was the Cooking button and a list on Nutrition): start a new dish for the meal
// picked in Add food, go back to one still open (cooking, leftovers, or shared by a friend), or cook a saved recipe again.
function dishSheet(day, meal) {
  const q = day && day !== isoDay(new Date()) ? `?d=${day}` : '';      // a past day's log: portions go to that day
  sheet('Create a dish', `<div class="btncol"><button class="primary" id="ck-new">${svg('plus')}Start a new dish</button></div>
    <div id="ck-open"></div><div id="ck-saved"></div>`, (b, close) => {
    const open = async (url, btn) => {
      btn.disabled = true;
      try { const d = await api(url, json('POST', {meal})); App.cache.delete('/api/dishes'); close(); go(`/food/cook/${d.id}${q}`); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
    $('#ck-new', b).onclick = (e) => open('/api/dishes', e.currentTarget);
    load('/api/dishes', (list) => {
      const box = $('#ck-open', b); if (!box || !list.length) return;
      box.innerHTML = `<h3 class="ghead">Still open</h3>` + list.map((d) => `<a class="card tap dish-row" href="/food/cook/${d.id}${q}">${d.mine === false ? avatar(d.owner) : `<span class="ri c-orange">${svg('pot')}</span>`}
        <span class="grow"><b>${esc(d.name)}</b><small class="muted">${d.mine === false ? `From ${esc(d.owner.name)} · ${esc(leftText(d))}`
          : d.status === 'cooking' ? `${esc(MEAL_NAMES[d.meal])} · ${d.items.length ? `${d.items.length} item${d.items.length === 1 ? '' : 's'} · ` : ''}${r0(d.totals.kcal)} kcal`
          : esc(leftText(d))}</small></span>
        <span class="badge ${d.status === 'cooking' ? 'alert' : 'on'}">${d.status === 'cooking' ? 'Cooking' : 'Leftovers'}</span></a>`).join('');
      $$('a', box).forEach((a) => a.addEventListener('click', () => close()));
    }, {maxAge: 0}).catch(() => {});
    let saved = [];
    const drawSaved = () => {
      const box = $('#ck-saved', b); if (!box) return;
      box.innerHTML = saved.length ? `<h3 class="ghead">Saved recipes</h3><div class="card list">${saved.map((r) => `<div class="recipe-row"><button class="rr-cook" data-rc="${r.id}"><b>${esc(r.name)}</b>
        <small class="muted">${r.items.length ? esc(r.items.slice(0, 4).join(', ')) + (r.items.length > 4 ? ` and ${r.items.length - 4} more` : '') + ' · ' : ''}${r0(r.totals.kcal)} kcal</small></button>
        <button class="icon-btn" data-rdel="${r.id}" aria-label="Delete the recipe ${esc(r.name)}">${svg('trash')}</button></div>`).join('')}</div>` : '';
      $$('[data-rc]', box).forEach((x) => x.onclick = () => open(`/api/dishes/recipes/${x.dataset.rc}/cook`, x));
      $$('[data-rdel]', box).forEach((x) => x.onclick = async () => {
        const r = saved.find((y) => String(y.id) === x.dataset.rdel);
        if (!confirm(`Delete the recipe ${r.name}? Food you logged from it stays in your food log.`)) return;
        try { await api(`/api/dishes/recipes/${r.id}`, {method: 'DELETE'}); saved = saved.filter((y) => y !== r); drawSaved(); toast('Recipe deleted'); }
        catch (e) { toast(e.message); }
      });
    };
    api('/api/dishes/recipes').then((list) => { saved = list; drawSaved(); }).catch(() => {});
  });
}

route(/^\/food\/cook\/(\d+)$/, 'food', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div>${skel(2)}`;
  wireBack(el, '/food' + location.search);
  try { await load(`/api/dishes/${id}`, (d) => drawDish(el, d), {maxAge: 0}); }
  catch (x) {     // finished and cleared away (or no longer shared)
    if (x.status !== 404) throw x;
    el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><div class="card empty"><b>This dish is finished</b>Portions logged from it are still in the food log.</div>`;
    wireBack(el, '/food' + location.search);
  }
});

// The cook sees everything and can change it; a friend it's shared with sees the dish and logs their own portion.
function drawDish(el, d) {
  const t = d.totals, typed = d.known.kcal != null, mine = d.mine !== false, has = d.items.length > 0 || typed;
  const cooking = d.status === 'cooking', w = d.weight_g, saved = d.recipe_id != null;
  const pastDay = new URLSearchParams(location.search).get('d');
  // the meal it's cooked for, while it's cooked today; leftovers and a friend's dish pick the meal when they're eaten
  const fixedMeal = mine && cooking && !pastDay && isoDay(new Date(d.created)) === isoDay(new Date());
  const set = (fresh) => { App.cache.set(`/api/dishes/${d.id}`, {data: fresh, at: Date.now()}); App.cache.delete('/api/dishes'); drawDish(el, fresh); };
  const ing = (it) => `<div><b>${esc(it.name)}</b><small class="muted num">${it.amount && !/\d\s*g$/.test(it.amount) ? `${esc(it.amount)} · ` : ''}${gfmt(it.grams)}</small></div>
    <div class="r"><b class="num">${r0(it.kcal)}</b><small class="muted">kcal</small></div>`;
  const shared = mine ? d.shared_with || [] : [];
  const mealSeg = (attr, cur, label) => `<div class="seg wide meal4" role="group" aria-label="${label}">${Object.entries(MEAL_NAMES).map(([m, n]) => `<button type="button" data-${attr}="${m}" aria-pressed="${m === cur}">${n}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}<div class="acts"><button class="icon-btn" id="dk-more" aria-label="Dish options">${svg('more')}</button></div></div>
    <div class="eyebrow">${mine ? (cooking ? 'Cooking' : 'Leftovers') : `From ${esc(d.owner.name)}`}</div>
    <h1 class="dish-name">${esc(d.name)}</h1>
    ${mine && cooking ? `<div class="dish-for"><small class="muted">Cooking for</small>${mealSeg('dmeal', d.meal, 'Which meal it is for')}</div>` : ''}
    ${mine ? `<button class="linkbtn help-link" id="dk-help">${svg('help')}Need help?</button>` : ''}
    ${has || d.weighed ? `<div class="card dish-hero"><div class="dh-top"><div><small>Whole dish</small><b class="num">${r0(t.kcal)}<i>kcal</i></b></div>
      ${w ? `<div class="dh-w"><small>${d.weighed ? 'Cooked weight' : 'Weight'}</small><b class="num">${gfmt(w)}</b></div>` : ''}</div>
      <div class="dh-mac">${MACROS.map(([k, n]) => `<span><b class="num">${r0(t[k])}g</b><small>${n}</small></span>`).join('')}</div>
      ${typed ? `<p class="small muted">Using the total ${mine ? 'you' : esc(d.owner.name.split(' ')[0])} typed in${d.items.length ? ', not the ingredients' : ''}.${mine ? ' <button class="linkbtn" id="dk-known2">Change</button>' : ''}</p>` : ''}</div>` : ''}

    ${mine || d.items.length ? `<h2 class="sec-head">Ingredients${d.items.length ? ` <span class="count">${d.items.length}</span>` : ''}</h2>
    <div class="card">${mine ? `${chatLog(d)}<form class="addline" id="dk-add"><input name="t" placeholder="What went in?" aria-label="What went in, in your own words, like 2 apples or a tablespoon of olive oil"
        autocomplete="off" enterkeyhint="send" maxlength="600" required><button class="primary sm">${svg('plus')}Add</button></form>
      <div id="dk-match"></div><button type="button" class="linkbtn" id="dk-search">Search the food database instead</button>` : ''}
      <div class="ing-list">${d.items.map((it) => (mine ? `<div class="swipe"><button type="button" class="sw-del" data-del="${esc(it.id)}" tabindex="-1">${svg('trash')}Remove</button><button class="fe sw-row" data-it="${esc(it.id)}">${ing(it)}</button></div>` : `<div class="fe">${ing(it)}</div>`)).join('')}</div>
      ${mine ? `<button class="linkbtn" id="dk-known">${typed ? 'Change the total you typed in' : 'I already know the total'}</button>` : ''}</div>` : ''}

    ${(mine && App.me.coach && has) || d.review ? `<div class="card ai coach-card" id="dk-ai">${recipeReview(d, mine)}</div>` : ''}

    ${mine && has ? `<h2 class="sec-head">Weight</h2>
    <div class="card serve"><div class="kvs"><div class="kv"><span>Whole dish</span><b class="num">${w ? gfmt(w) : 'Not weighed'}${d.weighed ? ' <button class="linkbtn" id="dk-reweigh">Change</button>' : ''}</b></div></div>
      ${d.weighed && d.items.length ? '<button class="linkbtn" id="dk-sum">Use the ingredients added up</button>' : ''}
      <form id="dk-weigh"${d.weighed ? ' hidden' : ''}><div class="addline"><span class="gfield"><input name="g" inputmode="decimal" placeholder="Cooked dish, e.g. 1600" required aria-label="Weight of the whole cooked dish in grams"><span>g</span></span><button class="primary">Save</button></div>
        <div class="pan-row"><span class="muted">Weighed in</span><select name="pan" aria-label="Weighed in a pan"><option value="">No pan</option></select><button type="button" class="linkbtn" id="dk-pan">+ Pan</button></div></form></div>` : ''}

    ${has ? `<h2 class="sec-head">${d.eaten ? 'Log another portion' : 'Log what you ate'}</h2>
    <div class="card serve">${d.eaten || !cooking || !mine ? `<div class="kvs"><div class="kv"><span>Left</span><b class="num">${d.weight_g ? gfmt(d.left_g) : `${Math.round(d.left_share * 100)}%`}</b></div></div>` : ''}
      <form class="form" id="dk-portion">
        ${w ? `<label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="e.g. 380" aria-label="Your portion in grams"><span>g</span></span></label>` : ''}
        <div class="share-line">${w ? '<span class="muted">or</span>' : ''}<span>I had</span><input name="n" inputmode="decimal" value="1" aria-label="How many servings you had"><span>of</span>
          <input name="of" inputmode="decimal" placeholder="3" aria-label="Servings in the whole dish"><span>servings</span></div>
        ${fixedMeal ? '' : mealSeg('meal', guessMeal(), 'Meal')}
        <div class="portion-out" aria-live="polite"></div>
        <button class="primary wide">Log it to ${fixedMeal ? esc(MEAL_NAMES[d.meal]) : 'my food'}${pastDay ? ` for ${esc(dayLabel(pastDay))}` : ''}</button></form></div>`
      : !mine ? `<p class="small muted">${esc(d.owner.name.split(' ')[0])} hasn't added anything yet.</p>` : ''}

    ${mine && has ? `<button class="card tap share-row" id="dk-save" role="switch" aria-checked="${saved}"><span class="ri">${svg('bookmark')}</span>
      <span class="grow"><b>Save as a recipe</b></span><span class="tog" aria-hidden="true"></span></button>` : ''}
    ${mine ? `<button class="card tap share-row" id="dk-share">${shared.length ? `<span class="avs">${shared.map((p) => avatar(p)).join('')}</span>` : `<span class="ri">${svg('people')}</span>`}
      <span class="grow"><b>${shared.length ? `Shared with ${esc(shared.map((p) => p.name.split(' ')[0]).join(', '))}` : 'Share with a friend'}</b>
      <small class="muted">${shared.length ? 'Tap to change' : 'They log their own plate from it'}</small></span>${svg('chev')}</button>
    <div class="finish"><button class="ghost wide" id="dk-finish">${svg('check')}${cooking ? 'Finish' : 'The leftovers are gone'}</button>
      <p class="small muted">${cooking ? 'Done cooking? Finish takes it off your list. What you logged stays in your food log.'
        : `Leftovers stay on your list until ${esc(new Date(new Date(d.done_at).getTime() + LEFTOVER_DAYS * 864e5).toLocaleDateString([], {weekday: 'long'}))}.`}</p></div>` : ''}`;
  wireBack(el, '/food' + location.search);
  $('#dk-more', el).onclick = () => (mine ? dishMenu(d, set) : sharedMenu(d));
  [$('#dk-known', el), $('#dk-known2', el)].forEach((b) => { if (b) b.onclick = () => knownSheet(d, set); });
  $$('[data-it]', el).forEach((b) => b.onclick = () => itemSheet(d, d.items.find((x) => x.id === b.dataset.it), set));
  const patch = async (body) => { try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); return true; } catch (x) { toast(x.message); return false; } };
  if (mine) {
    $('#dk-help', el).onclick = () => sheet('How cooking works', cookSteps(d));
    swipeRows(el, (id) => removeItem(d, d.items.find((x) => x.id === id), set));
    chatBox(el, d, set);
    $('#dk-share', el).onclick = () => shareDishSheet(d, set);
    $('#dk-finish', el).onclick = () => finishSheet(d);
    wireSeg(el, 'dmeal', (m) => patch({meal: m}));
  }
  const sv = $('#dk-save', el);
  if (sv) sv.onclick = async () => {
    sv.disabled = true;
    try {
      if (saved) {
        if (!confirm(`Stop saving ${d.name}? The saved recipe is deleted; this dish stays until you finish it.`)) { sv.disabled = false; return; }
        set(await api(`/api/dishes/${d.id}/recipe`, {method: 'DELETE'})); toast('Not saved');
      } else {
        if (isDefaultName(d.name)) {      // "Dinner" isn't a recipe name
          const n = prompt('What do you call this dish?', ''); if (!n || !n.trim()) { sv.disabled = false; return; }
          await api(`/api/dishes/${d.id}`, json('PATCH', {name: n.trim()}));
        }
        set(await api(`/api/dishes/${d.id}/recipe`, json('POST', {}))); toast('Saved as a recipe. Find it under Add food > Create a dish');
      }
    } catch (x) { toast(x.message); sv.disabled = false; }
  };
  const rb = $('#dk-review', el);
  if (rb) rb.onclick = async () => {
    if (!App.me.ai_ok) { aiSheet(() => rb.click()); return; }
    rb.disabled = true; const was = rb.innerHTML; rb.textContent = 'Reading…';
    try { const r = await api(`/api/dishes/${d.id}/review`, json('POST', {})); set({...d, review: {...r, changed_since: false}}); }
    catch (x) { rb.disabled = false; rb.innerHTML = was; aiError(rb, x.message); }
  };
  const wf = $('#dk-weigh', el);
  if (wf) {
    const pans = (list) => { wf.pan.innerHTML = '<option value="">No pan</option>' + list.map((p) => `<option value="${p.id}">${esc(p.name)} (${gfmt(p.grams)})</option>`).join(''); };
    load('/api/dishes/pans', pans).catch(() => {});
    $('#dk-pan', el).onclick = () => panSheet((list) => pans(list));
    wf.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', wf), g = +wf.g.value.replace(',', '.'); btn.disabled = true;
      if (await patch(wf.pan.value ? {gross_g: g, pan_id: +wf.pan.value} : {cooked_g: g})) toast('Weight saved');
      else btn.disabled = false;
    };
    const rw = $('#dk-reweigh', el); if (rw) rw.onclick = () => { wf.hidden = false; wf.g.value = Math.round(d.cooked_g); wf.g.focus(); };
    const sum = $('#dk-sum', el); if (sum) sum.onclick = () => patch({cooked_g: null});
  }
  const f = $('#dk-portion', el);
  if (f) {
    const out = $('.portion-out', f), p = d.per_100g || {};
    let meal = fixedMeal ? d.meal : guessMeal(), mode = w ? 'g' : 'share';
    wireSeg(f, 'meal', (m) => { meal = m; });
    const num = (i) => +i.value.replace(',', '.');
    const share = () => { const n = num(f.n), of = num(f.of); return n > 0 && of > 0 && n <= of ? n / of : null; };
    const show = () => {
      let v = null, warn = '';
      if (mode === 'g') {
        const g = num(f.g);
        if (g > 0) { v = Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((k) => [k, p[k] * g / 100])); if (d.left_g != null && g > d.left_g * 1.05 + .5) warn = `Only ${gfmt(d.left_g)} left`; }
      } else {
        const s = share();
        if (s) { v = Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((k) => [k, (t[k] || 0) * s])); if (s > d.left_share * 1.05 + .01) warn = `Only ${leftText(d)}`; }
        else if (f.of.value && f.n.value) warn = 'The first number can\'t be bigger than the second';
      }
      out.innerHTML = (v ? nutGrid(v) : '') + (warn ? `<span class="warn-text">${esc(warn)}</span>` : '');
    };
    // typing grams logs by weight; typing servings logs that share, and shows it in grams too (which you can then adjust)
    const byShare = () => { mode = 'share'; const s = share(); if (w && f.g) f.g.value = s ? Math.round(w * s) : ''; show(); };
    if (f.g) f.g.oninput = () => { mode = 'g'; show(); };
    f.n.oninput = byShare; f.of.oninput = byShare;
    show();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f);
      const body = {meal, day: pastDay || undefined};
      if (mode === 'g') { const g = num(f.g); if (!(g > 0)) return; body.grams = g; }
      else { const s = share(); if (!s) { toast(w ? 'Type your portion in grams, or how many servings you had' : 'Type how many servings the dish made, and how many you had'); return; } body.share = s; }
      btn.disabled = true;
      try {
        const r = await api(`/api/dishes/${d.id}/portion`, json('POST', body));
        invalidate('/api/food/'); toast(`Logged to ${MEAL_NAMES[meal]}${pastDay ? ` on ${dayLabel(pastDay)}` : ''}: ${r0(r.entry.kcal)} kcal`); set(r.dish);
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  }
}
// Swipe an ingredient left to show Remove (2026-10-12); a tap on an open row just closes it
function swipeRows(el, onRemove) {
  const W = 96, closeAll = (but) => $$('.swipe.open', el).forEach((x) => { if (x !== but) { x.classList.remove('open'); $('.sw-row', x).style.transform = ''; } });
  $$('.swipe', el).forEach((sw) => {
    const row = $('.sw-row', sw);
    let x0 = 0, y0 = 0, base = 0, dx = 0, drag = false, down = false, moved = false;
    row.addEventListener('pointerdown', (e) => { down = true; drag = moved = false; x0 = e.clientX; y0 = e.clientY; base = sw.classList.contains('open') ? -W : 0; dx = 0; });
    row.addEventListener('pointermove', (e) => {
      if (!down) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.3) { drag = moved = true; closeAll(sw); row.style.transition = 'none'; try { row.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } }
      if (!drag) { if (Math.abs(my) > 8) down = false; return; }
      dx = Math.max(-W - 20, Math.min(0, base + mx)); row.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (!down) return; down = false; if (!drag) return;
      row.style.transition = ''; const open = dx < -W / 2;
      sw.classList.toggle('open', open); row.style.transform = open ? `translateX(${-W}px)` : '';
    };
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
    row.addEventListener('click', (e) => {     // after a swipe, or on an open row: no item sheet
      if (moved || sw.classList.contains('open')) { e.stopImmediatePropagation(); e.preventDefault(); if (!moved) { sw.classList.remove('open'); row.style.transform = ''; } moved = false; }
    }, true);
    $('.sw-del', sw).onclick = () => onRemove($('.sw-del', sw).dataset.del);
  });
}
// remove an ingredient, with Undo (it goes back at the end of the list)
async function removeItem(d, it, set) {
  if (!it) return;
  try {
    set(await api(`/api/dishes/${d.id}/items/${it.id}`, {method: 'DELETE'}));
    const back = {name: it.name, grams: it.grams, source: it.source || 'quick', ref: it.ref || null, per100: it.per100 || null, ...Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].map((k) => [k, it[k] == null ? null : it[k]]))};
    toast(`Removed ${it.name}`, async () => { try { set(await api(`/api/dishes/${d.id}/items`, json('POST', back))); } catch (x) { toast(x.message); } });
  } catch (x) { toast(x.message); }
}
// Finish: off the list. Keep the leftovers (offered for a few days) or not; save it as a recipe or not (off unless you say)
function finishSheet(d) {
  const cooking = d.status === 'cooking', left = someLeft(d), saved = d.recipe_id != null;
  sheet(cooking ? `Finish ${d.name}` : 'Leftovers gone?', `<form class="form" id="fn">
    ${cooking && !d.eaten ? '<p class="callout warn">You haven\'t logged any of it yet. Log what you ate first, or keep it all as leftovers.</p>' : ''}
    ${cooking && left ? `<div class="checks" role="radiogroup" aria-label="Leftovers">
      <label class="check"><input type="radio" name="keep" value="0" checked> <span>Nothing left<small class="muted">It's cleared away</small></span></label>
      <label class="check"><input type="radio" name="keep" value="1"> <span>Keep the leftovers<small class="muted">${esc(leftText(d))}: they stay on your list for ${LEFTOVER_DAYS} days, to log later</small></span></label></div>`
      : !cooking ? '<p class="small muted">It comes off your list.</p>' : ''}
    ${saved ? `<p class="small">${svg('check')} Saved as a recipe: cook it again from Add food &gt; Create a dish.</p>`
      : `<label class="check"><input type="checkbox" name="save"> <span>Save it as a recipe<small class="muted">To cook again without typing it all in</small></span></label>`}
    <div class="actions"><button class="primary">${cooking ? 'Finish' : 'Take it off my list'}</button></div></form>`, (b, close) => {
    const f = $('#fn', b);
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f), save = !!(f.save && f.save.checked);
      if (save && isDefaultName(d.name)) {
        const n = prompt('What do you call this dish?', ''); if (!n || !n.trim()) return;
        try { await api(`/api/dishes/${d.id}`, json('PATCH', {name: n.trim()})); } catch (x) { toast(x.message); return; }
      }
      btn.disabled = true;
      try {
        const r = await api(`/api/dishes/${d.id}/finish`, json('POST', {leftovers: !!(f.keep && f.keep.value === '1'), save}));
        App.cache.delete('/api/dishes'); App.cache.delete(`/api/dishes/${d.id}`); close();
        toast([r.kept ? 'Leftovers kept' : 'Finished', save ? 'saved as a recipe' : ''].filter(Boolean).join(', '));
        go('/food' + location.search, {replace: true});
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
// What to do next, until something's eaten: three numbered steps, the current one highlighted (weighing is optional)
function cookSteps(d) {
  const added = d.items.length > 0 || d.known.kcal != null;
  const steps = [
    [added, 'Add what goes in', added ? `${d.items.length ? `${d.items.length} so far` : 'Total typed in'}, ${r0(d.totals.kcal)} kcal` : 'Type it as you cook, the way you\'d text it.'],
    [d.weighed, 'Weigh the cooked dish, if you like', d.weighed ? gfmt(d.cooked_g) : 'Without it, the ingredients are added up. In its pan is fine: the pan comes off.'],
    [false, 'Log what you ate', 'In grams, or as servings like 1 of 3. It goes in the meal you\'re cooking for.'],
  ];
  const now = added ? 2 : 0;
  return `<ol class="card cook-steps" aria-label="How cooking works">${steps.map(([done, title, sub], i) =>
    `<li class="${done ? 'done' : i === now ? 'now' : ''}"${i === now ? ' aria-current="step"' : ''}><span class="stepn">${done ? svg('check') : i + 1}</span>
      <div><b>${title}</b><small>${esc(sub)}</small></div></li>`).join('')}</ol>`;
}
// AI feedback on the recipe (food_coach.py): kept on the dish, so friends it's shared with see it too
function recipeReview(d, mine) {
  const R = d.review;
  if (!R) return `<div class="cc-ask"><span class="grow"><b>Coach's take</b><small class="muted">Calories per portion and easy tweaks</small></span>
    <button class="ghost sm tint" id="dk-review">${svg('sparkle')}Ask</button></div>`;
  return `<h2>Coach's take<span class="muted small">${esc(new Date(R.at).toLocaleDateString([], {month: 'short', day: 'numeric'}))}</span></h2>
    ${R.summary ? `<p class="ai-head">${esc(R.summary)}</p>` : ''}${R.text ? `<p>${esc(R.text)}</p>` : ''}
    ${R.ideas ? `<h3 class="ghead">Ideas</h3><ul class="ai-list">${R.ideas.map((i) => `<li>${svg('sparkle')}<span><b>${esc(i.change)}</b>${i.effect ? ` <span class="muted">${esc(i.effect)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${R.note ? `<div class="callout warn">${esc(R.note)}</div>` : ''}
    ${mine && App.me.coach ? `<button class="linkbtn" id="dk-review">${svg('sparkle')}${R.changed_since ? 'The recipe changed - ask again' : 'Ask again'}</button>` : ''}`;
}
// who the dish is shared with: friends only, one tap each
function shareDishSheet(d, set) {
  sheet('Share this dish', `<p class="small muted">Friends you share it with see the dish and log their own portion. They can't change it.</p><div id="sd-list">${skel(1)}</div>`, async (b) => {
    const box = $('#sd-list', b);
    let on = new Set((d.shared_with || []).map((p) => p.login)), fr;
    try { fr = (await api('/api/friends')).friends; } catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    const draw = () => {
      box.innerHTML = fr.length ? `<div class="card list">${fr.map((p) => `<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>
        <button class="${on.has(p.login) ? 'ghost' : 'primary'} sm" data-sd="${esc(p.login)}">${on.has(p.login) ? `${svg('check')}Shared` : 'Share'}</button></div>`).join('')}</div>`
        : '<p class="small muted">No friends yet. Add them under Me &gt; Friends, then share dishes with them here.</p>';
      $$('[data-sd]', box).forEach((x) => x.onclick = async () => {
        x.disabled = true; const login = x.dataset.sd;
        try {
          if (on.has(login)) { await api(`/api/dishes/${d.id}/share/${encodeURIComponent(login)}`, {method: 'DELETE'}); on.delete(login); }
          else { await api(`/api/dishes/${d.id}/share`, json('POST', {login})); on.add(login); }
          d = await api(`/api/dishes/${d.id}`); set(d); draw();
        } catch (e) { toast(e.message); x.disabled = false; }
      });
    };
    draw();
  });
}
function sharedMenu(d) {
  sheet(d.name, `<p class="small muted">${esc(d.owner.name)} shared this dish with you.</p><div class="btncol"><button class="ghost danger" id="sm-hide">Remove it from my list</button></div>`, (b, close) => {
    $('#sm-hide', b).onclick = async () => {
      try { await api(`/api/dishes/${d.id}/share/${encodeURIComponent(App.me.login)}`, {method: 'DELETE'}); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); }
      catch (x) { toast(x.message); }
    };
  });
}

// The conversation while you cook, kept per dish until the app is closed (the ingredient list is the real record)
const CHATS = new Map();
function chatLog(d) {
  const log = CHATS.get(d.id) || [];
  const first = !log.length && !d.items.length && d.known.kcal == null;
  if (!log.length && !first) return '<div class="cchat" id="dk-chat" aria-live="polite"></div>';
  const bubble = (m, i) => m.who === 'me' ? `<p class="cmsg me">${esc(m.text)}</p>`
    : `<div class="cmsg ai${m.wait ? ' wait' : ''}">${m.wait ? '<span class="dots" aria-label="Working it out"><i></i><i></i><i></i></span>' : esc(m.text)}
        ${m.added && m.added.length && !m.undone ? `<button type="button" class="linkbtn" data-undo="${i}">Undo</button>` : ''}</div>`;
  return `<div class="cchat" id="dk-chat" aria-live="polite">${first ? `<div class="cmsg ai">Tell me what goes in as you cook, like you'd text a friend: “2 apples”, “a splash of olive oil and 3 cloves of garlic”, “make the rice 200 g”.</div>` : ''}
    ${log.slice(-8).map((m, k) => bubble(m, log.length - Math.min(log.length, 8) + k)).join('')}</div>`;
}
function chatBox(el, d, set) {
  const f = $('#dk-add', el), log = CHATS.get(d.id) || [];
  CHATS.set(d.id, log);
  const redraw = (fresh) => { const t = $('#dk-add input', el); const v = t ? t.value : ''; set(fresh); const n = $('#dk-add input', el); if (n) { n.value = v; n.focus(); } };
  const send = async (text) => {
    const me = {who: 'me', text}, wait = {who: 'ai', wait: true};
    log.push(me, wait); $('#dk-chat', el).outerHTML = chatLog(d); f.t.value = ''; $('#dk-match', el).innerHTML = '';
    let r;
    try { r = await api(`/api/dishes/${d.id}/say`, json('POST', {text})); }
    catch (x) { log.splice(log.indexOf(wait), 1, {who: 'ai', text: x.message}); redraw(d); return; }
    if (r.fallback) {          // nothing remembered and no AI: pick it from the food search
      log.splice(log.indexOf(me), 2); redraw(d);
      searchFlow(el, d, set, text);
      if (r.needs_ok && !App.me.ai_ok) aiSheet(() => { $('#dk-match', el).innerHTML = ''; send(text); });
      return;
    }
    log.splice(log.indexOf(wait), 1, {who: 'ai', text: r.reply, added: r.added});
    redraw(r.dish);
  };
  f.onsubmit = (e) => { e.preventDefault(); const text = f.t.value.trim(); if (text) send(text); };
  $('#dk-search', el).onclick = () => searchFlow(el, d, set, f.t.value.trim());
  $$('[data-undo]', el).forEach((b) => b.onclick = async () => {
    const m = log[+b.dataset.undo]; b.disabled = true;
    try {
      let fresh = d;
      for (const id of m.added) if (fresh.items.some((x) => x.id === id)) fresh = await api(`/api/dishes/${d.id}/items/${id}`, {method: 'DELETE'});
      m.undone = true; log.push({who: 'ai', text: 'Taken back out.'}); redraw(fresh);
    } catch (x) { toast(x.message); b.disabled = false; }
  });
}

// Search and pick: read the amount, search the food, tap the right match. No match? Type the calories.
let searchSeq = 0;
async function searchFlow(el, d, set, text) {
  const box = $('#dk-match', el);
  if (!text) { toast('Type the food first, like 2 apples'); $('#dk-add input', el).focus(); return; }
  const my = ++searchSeq; box.innerHTML = '<p class="small muted">Looking it up…</p>';
  let p; try { p = await api('/api/dishes/parse', json('POST', {text})); } catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
  if (my !== searchSeq) return;
  const q = p.search || p.query || text, g0 = p.grams || p.guess_g;
  box.innerHTML = `<div class="match"><label>${esc(q)}${p.guess_g && !p.grams ? `<small class="muted">Usually about ${gfmt(p.guess_g)}: change it if you weighed it</small>` : ''}<span class="gfield"><input name="mg" inputmode="decimal" value="${g0 ? Math.round(g0 * 10) / 10 : ''}"
      placeholder="${p.amount ? `${esc(p.amount)} ${esc(p.unit || '')} in grams?` : 'Grams'}" aria-label="How many grams"><span>g</span></span></label>
    <div class="mres" aria-live="polite"><p class="small muted">Searching…</p></div>
    <button type="button" class="linkbtn" id="dk-type">Type the calories instead</button></div>`;
  const gIn = $('[name=mg]', box), res = $('.mres', box);
  const grams = () => { const g = +gIn.value.replace(',', '.'); if (!(g > 0)) { toast('How many grams? Type the weight first'); gIn.focus(); return null; } return g; };
  let busy = false;
  const add = async (body) => {
    if (busy) return false; busy = true;
    try { const fresh = await api(`/api/dishes/${d.id}/items`, json('POST', body)); toast(`Added ${body.name}`); set(fresh); const n = $('#dk-add input'); if (n) n.focus(); return true; }
    catch (x) { toast(x.message); return false; }
    finally { busy = false; }
  };
  $('#dk-type', box).onclick = () => typeSheet(q, gIn.value, add);
  if (!g0) gIn.focus();
  const foods = [];
  const draw = (groups) => {
    foods.length = 0; let html = '';
    for (const [title, list] of groups) {
      const ok = list.filter((x) => x.per100 && x.per100.kcal != null); if (!ok.length) continue;
      html += `<h3 class="ghead">${title}</h3>` + ok.slice(0, 6).map((x) => { foods.push(x); return `<button type="button" class="fe" data-m="${foods.length - 1}"><div><b>${esc(x.name)}</b>
        <small class="muted">${x.brand ? esc(x.brand) + ' · ' : ''}${r0(x.per100.kcal)} kcal per 100 g</small></div><span class="qadd icon-btn" aria-hidden="true">${svg('plus')}</span></button>`; }).join('');
    }
    res.innerHTML = html || '<p class="small muted">No matches with calories per 100 g. Type the calories instead.</p>';
    $$('[data-m]', res).forEach((b) => b.onclick = () => {
      const g = grams(); if (g == null) return; const x = foods[+b.dataset.m];
      add({name: x.name, grams: g, per100: x.per100, source: x.source, ref: x.id ? {id: x.id} : null});
    });
  };
  try {
    const local = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=mine`); if (my !== searchSeq) return;
    const recent = local.recent.filter((r) => r.unit === 'g' && r.amount > 0).map((r) => ({name: r.name, brand: r.brand, source: r.source,
      per100: Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].map((k) => [k, r[k] == null ? null : r[k] / r.amount * 100]))}));
    draw([['Yours', local.mine.concat(recent)]]);
    const ext = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=usda,off`); if (my !== searchSeq) return;
    draw([['Yours', local.mine.concat(recent)], ['USDA', ext.usda], ['Open Food Facts', ext.off]]);
  } catch (x) { if (my === searchSeq) res.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
function typeSheet(name, grams, done) {
  sheet('Type it in', `<form class="form" id="ty"><label>Ingredient<input name="name" value="${esc(name)}" maxlength="120" required></label>
    <div class="two"><label>Weight (g)<input name="grams" inputmode="decimal" value="${esc(grams)}" required></label><label>Calories<input name="kcal" inputmode="decimal" required></label></div>
    <div class="two"><label>Protein (g)<input name="protein_g" inputmode="decimal"></label><label>Carbs (g)<input name="carbs_g" inputmode="decimal"></label></div>
    <div class="two"><label>Fat (g)<input name="fat_g" inputmode="decimal"></label><span></span></div>
    <p class="small muted">For the whole amount you're adding, from the packet or a recipe.</p>
    <div class="actions"><button class="primary">Add</button></div></form>`, (b, close) => {
    const f = $('#ty', b); f.kcal.focus();
    f.onsubmit = async (e) => {   // stays open if the server says no, so the numbers aren't lost
      e.preventDefault(); const n = (v) => (v.trim() === '' ? null : +v.replace(',', '.')), btn = $('button.primary', f);
      btn.disabled = true;
      if (await done({name: f.name.value.trim(), grams: n(f.grams.value), kcal: n(f.kcal.value), protein_g: n(f.protein_g.value), carbs_g: n(f.carbs_g.value), fat_g: n(f.fat_g.value)})) close();
      else btn.disabled = false;
    };
  });
}
function itemSheet(d, it, set) {
  sheet(it.name, `<form class="form" id="it"><label>Weight<span class="gfield"><input name="g" inputmode="decimal" value="${Math.round(it.grams * 10) / 10}" required><span>g</span></span></label>
    <div id="it-nut">${nutGrid(it)}</div>
    <p class="small muted">${it.per100 && it.per100.kcal != null ? `${r0(it.per100.kcal)} kcal per 100 g. ` : ''}Change the weight and the numbers follow.</p>
    <div class="actions"><button type="button" class="ghost danger" id="it-del">Remove</button><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#it', b);
    f.g.oninput = () => {   // the numbers above follow the weight as you type
      const g = +f.g.value.replace(',', '.'), k = it.grams > 0 ? g / it.grams : 0;
      if (g > 0 && k) $('#it-nut', b).innerHTML = nutGrid(Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((x) => [x, it[x] * k])));
    };
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try { set(await api(`/api/dishes/${d.id}/items/${it.id}`, json('PATCH', {grams: +f.g.value.replace(',', '.')}))); close(); } catch (x) { toast(x.message); btn.disabled = false; }
    };
    $('#it-del', b).onclick = async () => {
      try { set(await api(`/api/dishes/${d.id}/items/${it.id}`, {method: 'DELETE'})); close(); toast(`Removed ${it.name}`); } catch (x) { toast(x.message); }
    };
  });
}
function knownSheet(d, set) {
  const k = d.known, v = (x) => (x == null ? '' : Math.round(x));
  sheet('Total for the whole dish', `<form class="form" id="kn"><label>Calories<input name="kcal" inputmode="decimal" value="${v(k.kcal)}" required></label>
    <div class="two"><label>Protein (g)<input name="protein_g" inputmode="decimal" value="${v(k.protein_g)}"></label><label>Carbs (g)<input name="carbs_g" inputmode="decimal" value="${v(k.carbs_g)}"></label></div>
    <div class="two"><label>Fat (g)<input name="fat_g" inputmode="decimal" value="${v(k.fat_g)}"></label><span></span></div>
    <p class="small muted">From a recipe or your own sums. It's used instead of the ingredients. Then weigh the dish and your portion as usual.</p>
    <div class="actions">${k.kcal != null ? '<button type="button" class="ghost" id="kn-clear">Use the ingredients</button>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#kn', b); f.kcal.focus();
    const save = async (body) => {
      const btn = $('button.primary', f); btn.disabled = true;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); close(); } catch (x) { toast(x.message); btn.disabled = false; }
    };
    f.onsubmit = (e) => {
      e.preventDefault(); const n = (s) => (s.trim() === '' ? null : +s.replace(',', '.'));
      save(Object.fromEntries(['kcal', 'protein_g', 'carbs_g', 'fat_g'].map((x) => ['known_' + x, n(f[x].value)])));
    };
    const c = $('#kn-clear', b); if (c) c.onclick = () => save({known_kcal: null, known_protein_g: null, known_carbs_g: null, known_fat_g: null});
  });
}
function panSheet(after) {
  sheet('Your pans', `<div id="pn-list">${skel(1)}</div>
    <form class="form" id="pn"><h3 class="ghead">Add a pan</h3><div class="two"><label>Name<input name="name" maxlength="40" placeholder="Big pot" required></label>
      <label>Empty weight (g)<input name="grams" inputmode="decimal" required></label></div>
      <p class="small muted">Weigh it once, empty. After that you can weigh dishes in it.</p><div class="actions"><button class="primary">Add pan</button></div></form>`, (b) => {
    const list = $('#pn-list', b);
    const draw = (pans) => {
      list.innerHTML = pans.length ? `<div class="card list">${pans.map((p) => `<div class="row"><span>${esc(p.name)} <span class="muted num">${gfmt(p.grams)}</span></span>
        <button class="linkbtn danger" data-pdel="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button></div>`).join('')}</div>` : '';
      $$('[data-pdel]', list).forEach((x) => x.onclick = async () => {
        try { await api(`/api/dishes/pans/${x.dataset.pdel}`, {method: 'DELETE'}); refresh(); } catch (e) { toast(e.message); }
      });
      after(pans);
    };
    const refresh = async () => { App.cache.delete('/api/dishes/pans'); await load('/api/dishes/pans', draw, {maxAge: 0}); };
    refresh();
    const f = $('#pn', b);
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try { await api('/api/dishes/pans', json('POST', {name: f.name.value.trim(), grams: +f.grams.value.replace(',', '.')})); f.reset(); refresh(); toast('Pan added'); }
      catch (x) { toast(x.message); }
      btn.disabled = false;
    };
  });
}
function dishMenu(d, set) {
  sheet(d.name, `<div class="btncol"><button class="ghost" id="dm-name">Rename</button>
    <button class="ghost" id="dm-done">${d.status === 'cooking' ? 'Finish' : 'The leftovers are gone'}</button>
    <button class="ghost danger" id="dm-del">Delete dish</button></div>
    <p class="small muted">What you've logged from it stays in your food log.${d.recipe_id ? ' Deleting the dish keeps its saved recipe.' : ''}</p>`, (b, close) => {
    $('#dm-name', b).onclick = async () => {
      const n = prompt('Name of the dish', d.name); if (!n || !n.trim()) return;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', {name: n.trim()}))); close(); } catch (x) { toast(x.message); }
    };
    $('#dm-done', b).onclick = () => { close(); finishSheet(d); };
    $('#dm-del', b).onclick = async () => {
      if (!confirm(`Delete ${d.name}?`)) return;
      try { await api(`/api/dishes/${d.id}`, {method: 'DELETE'}); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); toast('Dish deleted'); } catch (x) { toast(x.message); }
    };
  });
}
