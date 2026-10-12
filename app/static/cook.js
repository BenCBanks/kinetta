// Kinetta phone app — Part 6: cooking mode (2026-10-11). Build a dish while you cook ("100 g chicken", "250 g carrots"),
// weigh the whole cooked dish, weigh your plate, and your portion is logged with its share of the calories and macros.
// The rest stays as leftovers for a few days. The server does the sums (app/api_dishes.py).
// 2026-10-12: ingredients are typed the way you'd text them ("2 apples", "a splash of oil", "make the rice 200 g"):
// app/cook_chat.py answers from what you've used before, or asks the AI; search-and-pick stays as the fallback.
'use strict';

const gfmt = (g) => (g == null ? '–' : `${Math.round(g).toLocaleString()} g`);

// Nutrition > Log: dishes on the go (cooking now, leftovers, or shared by a friend), plus the way in
function dishStrip(box, day) {
  if (!box) return;
  load('/api/dishes', (list) => {
    if (!box.isConnected) return;
    const q = day && day !== isoDay(new Date()) ? `?d=${day}` : '';     // a past day's log: portions go to that day
    box.innerHTML = list.map((d) => `<a class="card tap dish-row" href="/food/cook/${d.id}${q}">${d.mine === false ? avatar(d.owner) : `<span class="ri c-orange">${svg('pot')}</span>`}
      <span class="grow"><b>${esc(d.name)}</b><small class="muted">${d.mine === false ? `From ${esc(d.owner.name)} · ${d.left_g != null ? gfmt(d.left_g) + ' left' : 'still cooking'}`
        : d.status === 'cooking' ? `${d.items.length} item${d.items.length === 1 ? '' : 's'} · ${r0(d.totals.kcal)} kcal so far`
        : `${gfmt(d.left_g)} left · ${r0(d.per_100g && d.per_100g.kcal)} kcal/100 g`}</small></span>
      <span class="badge ${d.left_g == null ? 'alert' : 'on'}">${d.left_g == null ? 'Cooking' : 'Serve'}</span></a>`).join('');
  }).catch(() => {});
}
async function startCooking(btn) {
  if (btn) btn.disabled = true;
  try { const d = await api('/api/dishes', json('POST', {})); App.cache.delete('/api/dishes'); go(`/food/cook/${d.id}`); }
  catch (x) { toast(x.message); if (btn) btn.disabled = false; }
}

route(/^\/food\/cook\/(\d+)$/, 'food', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div>${skel(2)}`;
  wireBack(el, '/food' + location.search);
  await load(`/api/dishes/${id}`, (d) => drawDish(el, d), {maxAge: 0});
});

// The cook sees everything and can change it; a friend it's shared with sees the dish and logs their own portion.
function drawDish(el, d) {
  const t = d.totals, weighed = d.cooked_g != null, typed = d.known.kcal != null, mine = d.mine !== false;
  const set = (fresh) => { App.cache.set(`/api/dishes/${d.id}`, {data: fresh, at: Date.now()}); App.cache.delete('/api/dishes'); drawDish(el, fresh); };
  const ing = (it) => `<div><b>${esc(it.name)}</b><small class="muted num">${it.amount && !/\d\s*g$/.test(it.amount) ? `${esc(it.amount)} · ` : ''}${gfmt(it.grams)}</small></div>
    <div class="r"><b class="num">${r0(it.kcal)}</b><small class="muted">kcal</small></div>`;
  const shared = mine ? d.shared_with || [] : [];
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}<div class="acts"><button class="icon-btn" id="dk-more" aria-label="Dish options">${svg('more')}</button></div></div>
    <div class="eyebrow">${mine ? (d.status === 'cooking' ? 'Cooking' : d.status === 'leftovers' ? 'Leftovers' : 'Finished') : `From ${esc(d.owner.name)}`}</div>
    <h1 class="dish-name">${esc(d.name)}</h1>
    ${mine && !weighed ? cookSteps(d) : ''}
    ${d.items.length || typed || weighed ? `<div class="card dish-hero"><div class="dh-top"><div><small>Whole dish</small><b class="num">${r0(t.kcal)}<i>kcal</i></b></div>
      ${weighed ? `<div class="dh-w"><small>Cooked weight</small><b class="num">${gfmt(d.cooked_g)}</b></div>` : ''}</div>
      <div class="dh-mac">${MACROS.map(([k, n]) => `<span><b class="num">${r0(t[k])}g</b><small>${n}</small></span>`).join('')}</div>
      ${typed ? `<p class="small muted">Using the total ${mine ? 'you' : esc(d.owner.name.split(' ')[0])} typed in${d.items.length ? ', not the ingredients' : ''}.${mine ? ' <button class="linkbtn" id="dk-known2">Change</button>' : ''}</p>` : ''}</div>` : ''}

    ${mine || d.items.length ? `<h2 class="sec-head">Ingredients${d.items.length ? ` <span class="count">${d.items.length}</span>` : ''}</h2>
    <div class="card">${mine ? `${chatLog(d)}<form class="addline" id="dk-add"><input name="t" placeholder="What went in?" aria-label="What went in, in your own words, like 2 apples or a tablespoon of olive oil"
        autocomplete="off" enterkeyhint="send" maxlength="600" required><button class="primary sm">${svg('plus')}Add</button></form>
      <div id="dk-match"></div><button type="button" class="linkbtn" id="dk-search">Search the food database instead</button>` : ''}
      <div class="ing-list">${d.items.map((it) => (mine ? `<button class="fe" data-it="${esc(it.id)}">${ing(it)}</button>` : `<div class="fe">${ing(it)}</div>`)).join('')}</div>
      ${mine ? `<button class="linkbtn" id="dk-known">${typed ? 'Change the total you typed in' : 'I already know the total'}</button>` : ''}</div>` : ''}

    ${(mine && App.me.coach && (d.items.length || typed)) || d.review ? `<div class="card ai coach-card" id="dk-ai">${recipeReview(d, mine)}</div>` : ''}

    <h2 class="sec-head">${weighed ? 'Serve' : 'Weigh the dish'}</h2>
    <div class="card serve">${weighed ? `<div class="kvs"><div class="kv"><span>Cooked weight</span><b class="num">${gfmt(d.cooked_g)}${mine ? ' <button class="linkbtn" id="dk-reweigh">Change</button>' : ''}</b></div>
        ${d.eaten_g ? `<div class="kv"><span>Served so far</span><b class="num">${gfmt(d.eaten_g)}</b></div>` : ''}
        <div class="kv"><span>Left</span><b class="num">${gfmt(d.left_g)}</b></div></div>
        <form class="form" id="dk-portion"><label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="e.g. 380" required aria-label="Your portion in grams"><span>g</span></span></label>
          <div class="seg wide meal4" role="group" aria-label="Meal">${Object.entries(MEAL_NAMES).map(([m, n]) => `<button type="button" data-meal="${m}" aria-pressed="${m === guessMeal()}">${n}</button>`).join('')}</div>
          <div class="portion-out" aria-live="polite"></div>
          <button class="primary wide">Log my portion${new URLSearchParams(location.search).get('d') ? ` for ${esc(dayLabel(new URLSearchParams(location.search).get('d')))}` : ''}</button></form>`
      : !mine ? `<p class="small muted">${esc(d.owner.name.split(' ')[0])} hasn't weighed the finished dish yet. Once it's weighed, weigh your plate here and your share is logged.</p>`
      : `<form id="dk-weigh"><div class="addline"><span class="gfield"><input name="g" inputmode="decimal" placeholder="Whole dish, e.g. 1600" required aria-label="Weight of the whole dish in grams"><span>g</span></span><button class="primary">Save</button></div>
          <div class="pan-row"><span class="muted">Weighed in</span><select name="pan" aria-label="Weighed in a pan"><option value="">No pan</option></select><button type="button" class="linkbtn" id="dk-pan">+ Pan</button></div></form>`}</div>
    ${mine ? `<button class="card tap share-row" id="dk-share">${shared.length ? `<span class="avs">${shared.map((p) => avatar(p)).join('')}</span>` : `<span class="ri">${svg('people')}</span>`}
      <span class="grow"><b>${shared.length ? `Shared with ${esc(shared.map((p) => p.name.split(' ')[0]).join(', '))}` : 'Share with a friend'}</b>
      <small class="muted">${shared.length ? 'Tap to change' : 'They log their own plate from it'}</small></span>${svg('chev')}</button>` : ''}`;
  wireBack(el, '/food' + location.search);
  $('#dk-more', el).onclick = () => (mine ? dishMenu(d, set) : sharedMenu(d));
  [$('#dk-known', el), $('#dk-known2', el)].forEach((b) => { if (b) b.onclick = () => knownSheet(d, set); });
  $$('[data-it]', el).forEach((b) => b.onclick = () => itemSheet(d, d.items.find((x) => x.id === b.dataset.it), set));
  if (mine) { chatBox(el, d, set); $('#dk-share', el).onclick = () => shareDishSheet(d, set); }
  const rb = $('#dk-review', el);
  if (rb) rb.onclick = async () => {
    if (!App.me.ai_ok) { aiSheet(() => rb.click()); return; }
    rb.disabled = true; const was = rb.innerHTML; rb.textContent = 'Reading…';
    try { const r = await api(`/api/dishes/${d.id}/review`, json('POST', {})); set({...d, review: {...r, changed_since: false}}); }
    catch (x) { toast(x.message); rb.disabled = false; rb.innerHTML = was; }
  };
  if (weighed) {
    const f = $('#dk-portion', el), out = $('.portion-out', f), p = d.per_100g || {};
    let meal = guessMeal(); wireSeg(f, 'meal', (m) => { meal = m; });
    const show = () => {
      const g = +f.g.value.replace(',', '.');
      out.innerHTML = g > 0 ? `${nutGrid(Object.fromEntries(['kcal', ...MACROS.map((m) => m[0])].map((k) => [k, p[k] * g / 100])))}
        ${d.left_g != null && g > d.left_g * 1.05 + .5 ? `<span class="warn-text">Only ${gfmt(d.left_g)} left</span>` : ''}` : '';
    };
    f.g.oninput = show;
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f), g = +f.g.value.replace(',', '.');
      if (!(g > 0)) return;
      btn.disabled = true;
      try {
        const day = new URLSearchParams(location.search).get('d') || undefined;
        const r = await api(`/api/dishes/${d.id}/portion`, json('POST', {grams: g, meal, day}));
        invalidate('/api/food/'); toast(`Logged ${gfmt(g)} of ${d.name}${day ? ` on ${dayLabel(day)}` : ''}: ${r0(r.entry.kcal)} kcal`); set(r.dish);
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
    const rw = $('#dk-reweigh', el); if (rw) rw.onclick = async () => {
      const v = prompt('Weight of the whole cooked dish, without the pan (g)', Math.round(d.cooked_g)); if (v == null) return;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', {cooked_g: +v.replace(',', '.')}))); } catch (x) { toast(x.message); }
    };
  } else if (mine) {
    const f = $('#dk-weigh', el);
    const pans = (list) => { f.pan.innerHTML = '<option value="">No pan</option>' + list.map((p) => `<option value="${p.id}">${esc(p.name)} (${gfmt(p.grams)})</option>`).join(''); };
    load('/api/dishes/pans', pans).catch(() => {});
    $('#dk-pan', el).onclick = () => panSheet((list) => pans(list));
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f), g = +f.g.value.replace(',', '.'); btn.disabled = true;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', f.pan.value ? {gross_g: g, pan_id: +f.pan.value} : {cooked_g: g}))); toast('Weight saved - now weigh your portion'); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  }
}
// What to do next, until the dish is weighed: three numbered steps, the current one highlighted
function cookSteps(d) {
  const added = d.items.length > 0 || d.known.kcal != null;
  const steps = [
    [added, 'Add what goes in', added ? `${d.items.length ? `${d.items.length} so far` : 'Total typed in'}, ${r0(d.totals.kcal)} kcal` : 'Type it as you cook, the way you\'d text it.'],
    [false, 'Weigh the finished dish', 'The whole pot or tray. In its pan is fine: the pan comes off.'],
    [false, 'Weigh your plate', 'Your share of the calories is logged for you.'],
  ];
  const now = steps.findIndex(([done]) => !done);
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
    ${d.status !== 'finished' ? `<button class="ghost" id="dm-done">${d.status === 'cooking' ? "Done - don't keep it" : 'No leftovers left'}</button>` : ''}
    <button class="ghost danger" id="dm-del">Delete dish</button></div>
    <p class="small muted">Portions you've already logged stay in your food log.</p>`, (b, close) => {
    $('#dm-name', b).onclick = async () => {
      const n = prompt('Name of the dish', d.name); if (!n || !n.trim()) return;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', {name: n.trim()}))); close(); } catch (x) { toast(x.message); }
    };
    const dn = $('#dm-done', b); if (dn) dn.onclick = async () => {
      try { await api(`/api/dishes/${d.id}`, json('PATCH', {done: true})); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); } catch (x) { toast(x.message); }
    };
    $('#dm-del', b).onclick = async () => {
      if (!confirm(`Delete ${d.name}?`)) return;
      try { await api(`/api/dishes/${d.id}`, {method: 'DELETE'}); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); toast('Dish deleted'); } catch (x) { toast(x.message); }
    };
  });
}
