// Kinetta phone app — Part 6: dishes (2026-10-11). Build a dish from what goes in ("100 g chicken", "250 g carrots"),
// keep it, and log it from Add food > Saved Dishes whenever you eat it. The server does the sums (app/api_dishes.py).
// 2026-10-12: ingredients are typed the way you'd text them ("2 apples", "a splash of oil", "make the rice 200 g"):
// app/cook_chat.py answers from what you've used before, or asks the AI; search-and-pick stays as the fallback.
// 2026-10-12, round three (Ben): a dish is simply saved, no cooking / leftovers / finish; the name is edited in place;
// the weight is the ingredients added up and can be typed over (no pans); a dish is eaten as one serving (a smoothie)
// or by portion (a pot of chili), and logging happens in Add food, not here.
'use strict';

const gfmt = (g) => (g == null ? '–' : `${Math.round(g).toLocaleString()} g`);
Object.assign(IC, {minus: '<path d="M5 12h14"/>', bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>'});
const listOf = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');

// Add food > Create or edit: start a new dish, or open one of yours to change it
function dishSheet() {
  sheet('Create or edit', `<div class="btncol"><button class="primary" id="ck-new">${svg('plus')}Start a new dish</button></div><div id="ck-mine"></div>`, (b, close) => {
    $('#ck-new', b).onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try { const d = await api('/api/dishes', json('POST', {})); App.cache.delete('/api/dishes'); close(); go(`/food/cook/${d.id}`); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
    load('/api/dishes', (list) => {
      const box = $('#ck-mine', b), mine = list.filter((d) => d.mine !== false); if (!box || !mine.length) return;
      box.innerHTML = `<h3 class="ghead">Your dishes</h3><div class="card list">${mine.map((d) => `<a class="dish-row tap" href="/food/cook/${d.id}"><span class="grow"><b>${esc(d.name)}</b>
        <small class="muted">${esc(d.items.length ? listOf(d.items.map((i) => i.name)) : d.known.kcal != null ? 'Total typed in' : 'Nothing added yet')}</small></span><span class="r num">${r0(d.totals.kcal)}<small> kcal</small></span>${svg('chev')}</a>`).join('')}</div>`;
      $$('a', box).forEach((x) => x.addEventListener('click', () => close()));
    }, {maxAge: 0}).catch(() => {});
  });
}

route(/^\/food\/cook\/(\d+)$/, 'food', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div>${skel(2)}`;
  wireBack(el, '/food');
  try { await load(`/api/dishes/${id}`, (d) => drawDish(el, d), {maxAge: 0}); }
  catch (x) {     // deleted (or no longer shared)
    if (x.status !== 404) throw x;
    el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><div class="card empty"><b>This dish is gone</b>Portions logged from it are still in the food log.</div>`;
    wireBack(el, '/food');
  }
});

// The cook sees everything and can change it; a friend it's shared with sees the dish and can log their own portion.
function drawDish(el, d) {
  const t = d.totals, typed = d.known.kcal != null, mine = d.mine !== false, has = d.items.length > 0 || typed, w = d.weight_g;
  const set = (fresh) => {      // redraw, keeping whatever box was being typed in
    const act = document.activeElement, keep = act && act.id && el.contains(act) ? [act.id, act.value] : null;
    App.cache.set(`/api/dishes/${d.id}`, {data: fresh, at: Date.now()}); App.cache.delete('/api/dishes'); drawDish(el, fresh);
    if (keep) { const n = $('#' + keep[0], el); if (n) { n.value = keep[1]; n.focus(); } }
  };
  const ing = (it) => `<div><b>${esc(it.name)}</b><small class="muted num">${it.amount && !/\d\s*g$/.test(it.amount) ? `${esc(it.amount)} · ` : ''}${gfmt(it.grams)}</small></div>
    <div class="r"><b class="num">${r0(it.kcal)}</b><small class="muted">kcal</small></div>`;
  const shared = mine ? d.shared_with || [] : [];
  const one = d.serving === 'one';
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}<div class="acts">${mine ? `<button class="icon-btn" id="dk-help" aria-label="How dishes work">${svg('help')}</button>` : ''}<button class="icon-btn" id="dk-more" aria-label="Dish options">${svg('more')}</button></div></div>
    ${mine ? `<textarea class="dish-name-in" id="dk-name" rows="1" placeholder="Name the dish" aria-label="Dish name" maxlength="80" enterkeyhint="done" autocomplete="off">${d.named ? esc(d.name) : ''}</textarea>`
      : `<div class="eyebrow">From ${esc(d.owner.name)}</div><h1 class="dish-name">${esc(d.name)}</h1>`}
    ${has ? `<div class="card dish-hero"><div class="dh-top"><div><small>${one ? 'One serving' : 'Whole dish'}</small><b class="num">${r0(t.kcal)}<i>kcal</i></b></div>
      ${w && !one ? `<div class="dh-w"><small>Weight</small><b class="num">${gfmt(w)}</b></div>` : ''}</div>
      <div class="dh-mac">${MACROS.map(([k, n]) => `<span><b class="num">${r0(t[k])}g</b><small>${n}</small></span>`).join('')}</div>
      ${typed ? `<p class="small muted">Using the total ${mine ? 'you' : esc(d.owner.name.split(' ')[0])} typed in${d.items.length ? ', not the ingredients' : ''}.${mine ? ' <button class="linkbtn" id="dk-known2">Change</button>' : ''}</p>` : ''}</div>` : ''}

    ${mine || d.items.length ? `<h2 class="sec-head">Ingredients${d.items.length ? ` <span class="count">${d.items.length}</span>` : ''}</h2>
    <div class="card">${mine ? `<label class="add-title" for="dk-t">Add an ingredient or take a picture</label>${chatLog(d)}<form class="addline" id="dk-add"><input name="t" id="dk-t" placeholder="e.g. 2 apples" aria-label="Add an ingredient in your own words, like 2 apples or a tablespoon of olive oil"
        autocomplete="off" enterkeyhint="send" maxlength="600" required><button type="button" class="icon-btn lbl-btn" id="dk-label" aria-label="Take a picture of the nutrition label">${svg('camera')}</button><button class="primary sm" aria-label="Add">${svg('plus')}<span class="al-t">Add</span></button></form>
      <input type="file" accept="image/*" id="dk-label-file" hidden>
      <div id="dk-match"></div>` : ''}
      <div class="ing-list">${d.items.map((it) => (mine ? `<div class="swipe"><button type="button" class="sw-del" data-del="${esc(it.id)}" tabindex="-1">${svg('trash')}Remove</button><button class="fe sw-row" data-it="${esc(it.id)}">${ing(it)}</button></div>` : `<div class="fe">${ing(it)}</div>`)).join('')}</div>
      ${mine ? `<button class="linkbtn" id="dk-known">${typed ? 'Change the total you typed in' : 'I already know the total'}</button>` : ''}</div>` : ''}

    ${mine && has ? `<h2 class="sec-head">How you eat it</h2>
    <div class="card serve"><div class="seg wide" role="group" aria-label="How you eat it">
        <button type="button" data-sv="one" aria-pressed="${one}">One serving</button><button type="button" data-sv="portion" aria-pressed="${!one}">A portion of it</button></div>
      <p class="small muted sv-note">${one ? 'Like a smoothie or a coffee: logged as a whole serving.' : 'Like a pot of chili: you log your portion in grams, or as 1 of 4.'}</p>
      ${one ? '' : `<form class="wt-row" id="dk-weigh"><label for="dk-w">Total weight</label><span class="gfield"><input id="dk-w" name="g" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5"
          value="${w ? Math.round(w) : ''}" placeholder="0" aria-label="Weight of the whole dish in grams"><span>g</span></span></form>
        ${d.weighed && d.items_g ? `<button class="linkbtn wt-reset" id="dk-sum">Use the ingredients added up (${gfmt(d.items_g)})</button>` : ''}`}</div>` : ''}

    ${(mine && App.me.coach && has) || d.review ? `<div class="card ai coach-card" id="dk-ai">${recipeReview(d, mine)}</div>` : ''}

    ${shared.length ? `<button class="card tap share-row" id="dk-share"><span class="avs">${shared.map((p) => avatar(p)).join('')}</span>
      <span class="grow"><b>Shared with ${esc(shared.map((p) => p.name.split(' ')[0]).join(', '))}</b><small class="muted">Tap to change</small></span>${svg('chev')}</button>` : ''}
    ${mine ? `<div class="finish"><button class="primary wide" id="dk-done">${svg('check')}Done</button>
      <p class="small muted">${has ? 'Saved. Log it any time from Add food &gt; Saved Dishes.' : 'Add what goes in, and it’s saved as you go.'}</p></div>`
      : has ? `<div class="finish"><button class="primary wide" id="dk-log">Log a portion</button></div>` : `<p class="small muted">${esc(d.owner.name.split(' ')[0])} hasn't added anything yet.</p>`}`;
  wireBack(el, '/food');
  $('#dk-more', el).onclick = () => (mine ? dishMenu(d, set, () => el._search && el._search()) : sharedMenu(d));
  [$('#dk-known', el), $('#dk-known2', el)].forEach((b) => { if (b) b.onclick = () => knownSheet(d, set); });
  $$('[data-it]', el).forEach((b) => b.onclick = () => itemSheet(d, d.items.find((x) => x.id === b.dataset.it), set));
  const patch = async (body) => { try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); return true; } catch (x) { toast(x.message); return false; } };
  const lg = $('#dk-log', el); if (lg) lg.onclick = () => dishLogSheet(d, {day: isoDay(new Date()), meal: guessMeal()}, () => {});
  if (!mine) return;
  $('#dk-help', el).onclick = () => sheet('How dishes work', cookSteps(d));
  swipeRows(el, (id) => removeItem(d, d.items.find((x) => x.id === id), set));
  chatBox(el, d, set);
  labelButton(el, d, set);
  const sh = $('#dk-share', el); if (sh) sh.onclick = () => shareDishSheet(d, set);
  // Done: back to Nutrition (a dish with nothing in it and no name isn't kept)
  $('#dk-done', el).onclick = () => { if (!has && !$('#dk-name', el).value.trim()) { api(`/api/dishes/${d.id}`, {method: 'DELETE'}).catch(() => {}); App.cache.delete('/api/dishes'); } go('/food', {replace: true}); };
  // the name, edited in place: saved when you leave the box or press Done on the keyboard
  const nm = $('#dk-name', el);
  const saveName = async () => { const n = nm.value.trim(); if (n && n !== d.name) await patch({name: n}); else if (!n && d.named) nm.value = d.name; };
  const fit = () => { nm.style.height = 'auto'; nm.style.height = `${nm.scrollHeight}px`; };      // a long name wraps instead of being cut off
  fit(); nm.oninput = () => { nm.value = nm.value.replace(/\n/g, ' '); fit(); };
  nm.onchange = saveName;
  nm.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
  wireSeg(el, 'sv', (v) => { if (v !== d.serving) patch({serving: v}); });
  const wf = $('#dk-weigh', el);
  if (wf) {      // digits only; saved when you leave the box. Typing what the ingredients add up to = not weighed
    wf.g.oninput = () => { wf.g.value = wf.g.value.replace(/\D/g, ''); };
    const save = () => { const g = +wf.g.value; if (!(g > 0)) { wf.g.value = w ? Math.round(w) : ''; return; } if (Math.round(g) !== Math.round(w || 0)) patch({cooked_g: g}); };
    wf.g.onchange = save;
    wf.onsubmit = (e) => { e.preventDefault(); wf.g.blur(); };
    const sum = $('#dk-sum', el); if (sum) sum.onclick = () => patch({cooked_g: null});
  }
  const rb = $('#dk-review', el);
  if (rb) rb.onclick = async () => {
    if (!App.me.ai_ok) { aiSheet(() => rb.click()); return; }
    rb.disabled = true; const was = rb.innerHTML; rb.textContent = 'Reading…';
    try { const r = await api(`/api/dishes/${d.id}/review`, json('POST', {})); set({...d, review: {...r, changed_since: false}}); }
    catch (x) { rb.disabled = false; rb.innerHTML = was; aiError(rb, x.message); }
  };
}
// Log a dish (Add food > Saved Dishes, or a friend's dish): one serving is a count (½, 1, 2…); a portion is grams or
// "I had 1 of 4" (the 4 is remembered). w = {day, meal} from Add food.
function dishLogSheet(d, w, done) {
  const t = d.totals, wt = d.weight_g, one = d.serving === 'one';
  const vals = (k) => Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((x) => [x, (t[x] || 0) * k]));
  sheet(d.name, `<form class="form" id="dl">
    ${one ? `<div class="stepper" role="group" aria-label="Servings"><button type="button" class="icon-btn" data-st="-1" aria-label="Fewer">${svg('minus')}</button>
        <span><b class="num" id="dl-n">1</b><small id="dl-u">serving</small></span><button type="button" class="icon-btn" data-st="1" aria-label="More">${svg('plus')}</button></div>`
      : `${wt ? `<label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="Whole dish: ${Math.round(wt)}" aria-label="Your portion in grams"><span>g</span></span></label>` : ''}
        <div class="share-line">${wt ? '<span class="muted">or</span>' : ''}<span>I had</span><input name="n" inputmode="decimal" value="1" aria-label="How many servings you had"><span>of</span>
          <input name="of" inputmode="decimal" value="${d.servings || ''}" placeholder="4" aria-label="Servings in the whole dish"><span>servings</span></div>`}
    <div class="portion-out" aria-live="polite"></div>
    <div class="actions">${d.mine !== false ? `<button type="button" class="ghost" id="dl-edit">${svg('edit')}Edit</button><span class="spacer"></span>` : ''}
      <button class="primary">Add to ${esc(MEAL_NAMES[w.meal])}${w.day !== isoDay(new Date()) ? `, ${esc(dayLabel(w.day))}` : ''}</button></div></form>`, (b, close) => {
    const f = $('#dl', b), out = $('.portion-out', f), num = (x) => (x ? +x.value.replace(',', '.') : 0);
    let n = 1, mode = wt ? 'g' : 'share';
    const share = () => { const a = num(f.n), of = num(f.of); return a > 0 && of > 0 && a <= of ? a / of : null; };
    const factor = () => (one ? n : mode === 'g' ? (num(f.g) > 0 ? num(f.g) / wt : null) : share());
    const show = () => {
      const k = factor();
      out.innerHTML = k ? nutGrid(vals(k)) : (!one && mode === 'share' && f.n.value && f.of.value ? '<span class="warn-text">The first number can\'t be bigger than the second</span>' : '');
    };
    if (one) $$('[data-st]', f).forEach((x) => x.onclick = () => {
      n = Math.max(0.5, Math.min(20, n + 0.5 * +x.dataset.st));
      $('#dl-n', f).textContent = n === 0.5 ? '½' : String(n).replace('.5', '½'); $('#dl-u', f).textContent = n > 1 ? 'servings' : 'serving'; show();
    });
    else {        // typing grams logs by weight; typing servings logs that share, and shows it in grams too
      const byShare = () => { mode = 'share'; const s = share(); if (wt && f.g) f.g.value = s ? Math.round(wt * s) : ''; show(); };
      if (f.g) f.g.oninput = () => { mode = 'g'; show(); };
      f.n.oninput = byShare; f.of.oninput = byShare;
      if (d.servings) byShare();
    }
    show();
    const ed = $('#dl-edit', b); if (ed) ed.onclick = () => { close(); done(true); go(`/food/cook/${d.id}`); };
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f);
      const body = {meal: w.meal, day: w.day};
      if (one) body.count = n;
      else if (mode === 'g') { const g = num(f.g); if (!(g > 0)) { toast('Type your portion in grams, or how many servings you had'); return; } body.grams = g; }
      else { const s = share(); if (!s) { toast(wt ? 'Type your portion in grams, or how many servings you had' : 'Type how many servings the dish made, and how many you had'); return; } body.share = s; body.of = Math.round(num(f.of)) || undefined; }
      btn.disabled = true;
      try {
        const r = await api(`/api/dishes/${d.id}/portion`, json('POST', body));
        invalidate('/api/food/'); App.cache.delete('/api/dishes'); close(); done(false);
        toast(`Added ${d.name} to ${MEAL_NAMES[w.meal].toLowerCase()}: ${r0(r.entry.kcal)} kcal`);
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
// Swipe an ingredient left to show Remove (2026-10-12). The name stays put (so you can see what you're removing); the
// Remove button slides in over the calories, which fade out. A tap on an open row just closes it.
function swipeRows(el, onRemove) {
  const W = 96;
  const place = (sw, px, anim) => {     // px = how far the button is out, 0..W
    const del = $('.sw-del', sw), r = $('.sw-row .r', sw);
    del.style.transition = r.style.transition = anim ? '' : 'none';
    del.style.width = `${px}px`; r.style.opacity = String(Math.max(0, 1 - px / (W * 0.6)));
  };
  const closeAll = (but) => $$('.swipe.open', el).forEach((x) => { if (x !== but) { x.classList.remove('open'); place(x, 0, true); } });
  $$('.swipe', el).forEach((sw) => {
    const row = $('.sw-row', sw);
    let x0 = 0, y0 = 0, base = 0, px = 0, drag = false, down = false, moved = false;
    row.addEventListener('pointerdown', (e) => { down = true; drag = moved = false; x0 = e.clientX; y0 = e.clientY; base = sw.classList.contains('open') ? W : 0; px = base; });
    row.addEventListener('pointermove', (e) => {
      if (!down) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.3) { drag = moved = true; closeAll(sw); try { row.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } }
      if (!drag) { if (Math.abs(my) > 8) down = false; return; }
      px = Math.max(0, Math.min(W + 16, base - mx)); place(sw, px, false);
    });
    const end = () => {
      if (!down) return; down = false; if (!drag) return;
      const open = px > W / 2; sw.classList.toggle('open', open); place(sw, open ? W : 0, true);
    };
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
    row.addEventListener('click', (e) => {     // after a swipe, or on an open row: no item sheet
      if (moved || sw.classList.contains('open')) { e.stopImmediatePropagation(); e.preventDefault(); if (!moved) { sw.classList.remove('open'); place(sw, 0, true); } moved = false; }
    }, true);
    $('.sw-del', sw).onclick = () => onRemove($('.sw-del', sw).dataset.del);
  });
}
// Add from a photo of the nutrition label (2026-10-12): the AI reads the label, then you say how much went in
function labelButton(el, d, set) {
  const btn = $('#dk-label', el), file = $('#dk-label-file', el);
  if (!btn) return;
  btn.onclick = () => { if (App.me.coach && !App.me.ai_ok) aiSheet(() => file.click()); else file.click(); };
  file.onchange = async () => {
    const fl = file.files && file.files[0]; file.value = ''; if (!fl) return;
    let photo; try { photo = await shrinkPhoto(fl, 1600); } catch (e) { toast("That photo couldn't be opened"); return; }
    sheet('Nutrition label', `<div id="lb-box"><p class="small muted center">${svg('sparkle')} Reading the label…</p></div>`, async (b, close) => {
      const box = $('#lb-box', b);
      let L;
      try { L = await api('/api/food/label', json('POST', {image: photo})); }
      catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p><div class="actions"><button class="primary" id="lb-again">Try another photo</button></div>`;
        $('#lb-again', b).onclick = () => { close(); file.click(); }; return; }
      const S = L.per_serving, pkg = L.package_g;
      box.innerHTML = `<form class="form" id="lb">
        <label>Name<input name="name" maxlength="200" value="${esc([L.brand, L.name].filter(Boolean).join(' '))}"></label>
        <p class="small muted">Per serving (${esc(L.serving.label)}): ${r0(S.kcal)} kcal · ${r1(S.protein_g)} g protein · ${r1(S.carbs_g)} g carbs · ${r1(S.fat_g)} g fat${L.servings ? ` · ${r1(L.servings)} servings in the package` : ''}</p>
        <label>How much went in<span class="gfield"><input name="g" inputmode="decimal" value="${Math.round(pkg || L.serving.g)}" aria-label="How much went in, in grams"><span>g</span></span></label>
        <div class="share-line"><span class="muted">or</span><input name="n" inputmode="decimal" value="${pkg ? '' : 1}" placeholder="1" aria-label="Servings"><span>servings</span>
          ${pkg ? `<button type="button" class="linkbtn" id="lb-all">The whole package (${gfmt(pkg)})</button>` : ''}</div>
        <div class="portion-out" aria-live="polite"></div>
        <label class="check"><input type="checkbox" name="save"> <span>Also save it to My foods</span></label>
        <div class="actions"><button class="primary">Add to the dish</button></div></form>`;
      const f = $('#lb', b), out = $('.portion-out', f), num = (x) => +x.value.replace(',', '.');
      const show = () => { const g = num(f.g); out.innerHTML = g > 0 ? nutGrid(Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((k) => [k, (L.per100[k] || 0) * g / 100]))) : ''; };
      f.g.oninput = () => { f.n.value = ''; show(); };
      f.n.oninput = () => { const n = num(f.n); if (n > 0) f.g.value = Math.round(n * L.serving.g); show(); };
      const all = $('#lb-all', b); if (all) all.onclick = () => { f.g.value = Math.round(pkg); f.n.value = ''; show(); };
      show();
      f.onsubmit = async (e) => {
        e.preventDefault(); const g = num(f.g), name = f.name.value.trim() || L.name;
        if (!(g > 0 && g < 20000)) { toast('How much went in, in grams?'); return; }
        const sb = $('button.primary', f); sb.disabled = true;
        try {
          set(await api(`/api/dishes/${d.id}/items`, json('POST', {name, grams: g, per100: L.per100, source: 'label'})));
          if (f.save.checked) {
            await api('/api/food/foods', json('POST', {name: L.name, brand: L.brand, barcode: null, serving_label: L.serving.label, serving_g: L.serving.g,
              kcal: S.kcal, protein_g: S.protein_g, carbs_g: S.carbs_g, fat_g: S.fat_g, fiber_g: S.fiber_g, favorite: false}));
            invalidate('/api/food/foods');
          }
          close(); toast(`Added ${name}: ${gfmt(g)}${f.save.checked ? ', saved to My foods' : ''}`);
        } catch (x) { toast(x.message); sb.disabled = false; }
      };
    });
  };
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
// Need help? (the ? at the top): three short steps, the current one highlighted
function cookSteps(d) {
  const added = d.items.length > 0 || d.known.kcal != null;
  const steps = [
    [added, 'Add what goes in', added ? `${d.items.length ? `${d.items.length} so far` : 'Total typed in'}, ${r0(d.totals.kcal)} kcal` : 'Type it the way you\'d text it, or take a picture of the nutrition label.'],
    [added, 'Say how you eat it', 'One serving (a smoothie, a coffee), or a portion of it (a pot of chili). For a portion, type the cooked weight if you weighed it.'],
    [false, 'Log it when you eat it', 'Add food > Saved Dishes, any day. It stays saved until you delete it.'],
  ];
  const now = added ? 2 : 0;
  return `<ol class="card cook-steps" aria-label="How dishes work">${steps.map(([done, title, sub], i) =>
    `<li class="${done && i !== now ? 'done' : i === now ? 'now' : ''}"${i === now ? ' aria-current="step"' : ''}><span class="stepn">${done && i !== now ? svg('check') : i + 1}</span>
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
  return `<div class="cchat" id="dk-chat" aria-live="polite">${first ? `<div class="cmsg ai">Tell me what goes in as you cook, like you'd text a friend: “2 apples”, “a box of penne”, “make the rice 200 g”. Or tap the camera to read a nutrition label.</div>` : ''}
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
  el._search = () => searchFlow(el, d, set, f.t.value.trim());
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
    <p class="small muted">From a recipe or your own sums. It's used instead of the ingredients.</p>
    <div class="actions">${k.kcal != null ? '<button type="button" class="ghost" id="kn-clear">Use the ingredients</button>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#kn', b);     // no keyboard until a box is tapped (2026-10-12)
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
function dishMenu(d, set, search) {
  sheet(d.name, `<div class="btncol"><button class="ghost" id="dm-search">Search the food database</button>
    <button class="ghost" id="dm-share">${(d.shared_with || []).length ? 'Shared with friends' : 'Share with a friend'}</button>
    <button class="ghost danger" id="dm-del">Delete dish</button></div>
    <p class="small muted">What you've logged from it stays in your food log.</p>`, (b, close) => {
    $('#dm-search', b).onclick = () => { close(); search(); };
    $('#dm-share', b).onclick = () => { close(); shareDishSheet(d, set); };
    $('#dm-del', b).onclick = async () => {
      if (!confirm(`Delete ${d.name}?`)) return;
      try { await api(`/api/dishes/${d.id}`, {method: 'DELETE'}); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); toast('Dish deleted'); } catch (x) { toast(x.message); }
    };
  });
}
