// Kinetta phone app — Part 6: dishes (2026-10-11). Build a dish from what goes in ("100 g chicken", "250 g carrots"),
// keep it, and log it from Add food > Saved Dishes whenever you eat it. The server does the sums (app/api_dishes.py).
// 2026-10-12: ingredients are typed the way you'd text them ("2 apples", "a splash of oil", "make the rice 200 g"):
// app/cook_chat.py answers from what you've used before, or asks the AI; search-and-pick stays as the fallback.
// 2026-10-12, round three (Ben): a dish is simply saved, no cooking / leftovers / finish; the name is edited in place;
// the weight is the ingredients added up and can be typed over (no pans); a dish is eaten as one serving (a smoothie)
// or by portion (a pot of chili), and logging happens in Add food, not here.
'use strict';

const RECIPE_SOURCE_LABELS=Object.freeze({site:'Published by site',ingredients:'Matched ingredients',estimated_ingredients:'Ingredients · includes AI estimates',entered:'Entered by you',unknown:'Unknown'});
const gfmt = (g) => (g == null ? '–' : `${Math.round(g).toLocaleString()} g`);
Object.assign(IC, {minus: '<path d="M5 12h14"/>', send: '<path d="M12 19V5M6 11l6-6 6 6"/>', bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>'});
const listOf = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');

// New dish (Add food, Saved Dishes, the first-run steps): straight to an empty dish page. Editing a saved dish starts
// from Saved Dishes (its Edit button), so there's no in-between "create or edit" list any more (2026-10-12, Ben).
async function newDish(btn) {
  if (btn) btn.disabled = true;
  try { const d = await api('/api/dishes', json('POST', {})); App.cache.delete('/api/dishes'); go(`/food/cook/${d.id}`); }
  catch (x) { toast(x.message); if (btn) btn.disabled = false; }
}

route(/^\/food\/cook\/(\d+)$/, 'food', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div>${skel(2)}`;
  wireBack(el, '/food');
  try { await load(`/api/dishes/${id}`, (d) => drawDish(el, d), {maxAge: 0}); }
  catch (x) {     // deleted (or no longer shared)
    if (x.status !== 404) throw x;
    el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><div class="card empty"><b>This meal is gone</b>Portions logged from it are still in the food log.</div>`;
    wireBack(el, '/food');
  }
});

// The cook sees everything and can change it; a friend it's shared with sees the dish and can log their own portion.
// 2026-10-12, round four (Ben: "large and clunky"): laid out like a chat. The name and one line of totals at the top,
// the ingredients, how it's measured, then the conversation and a message box pinned above the tab bar, with + for a
// barcode, a nutrition label photo or the food search. Done sits in the top bar.
function drawDish(el, d) {
  const t = d.totals, typed = d.known.kcal != null, mine = d.mine !== false, has = d.items.length > 0 || typed || !!d.recipe_source?.import_id, w = d.weight_g;
  const set = (fresh) => {      // redraw, keeping whatever box was being typed in
    const act = document.activeElement, keep = act && act.id && el.contains(act) ? [act.id, act.value] : null;
    App.cache.set(`/api/dishes/${d.id}`, {data: fresh, at: Date.now()}); App.cache.delete('/api/dishes'); drawDish(el, fresh);
    if (keep) { const n = $('#' + keep[0], el); if (n) { n.value = keep[1]; n.focus(); } }
  };
  const ing = (it) => `<span class="ig-n">${esc(it.name)}</span><span class="ig-g num">${it.amount && !/\d\s*g$/.test(it.amount) ? `${esc(it.amount)} · ` : ''}${gfmt(it.grams)}</span><b class="num r">${r0(it.kcal)}</b>`;
  const shared = mine ? d.shared_with || [] : [];
  const bySv = d.serving === 'one';
  const source=d.recipe_source||{}, imported=!!source.import_id, display=imported?d.per_serving:t;
  el.classList.toggle('imported-recipe',imported);
  const sums = has ? `<p class="dish-sum num"><b>${r0(display.kcal)} kcal${imported?' a serving':''}</b> · ${MACROS.map(([k, nm]) => `${r0(display[k])} g ${nm.toLowerCase()}`).join(' · ')}${typed && !imported ? `<br><span class="muted">Using the total ${mine ? 'you' : esc(d.owner.name.split(' ')[0])} typed in${d.items.length ? ', not the ingredients' : ''}.</span>` : ''}</p>` : '';
  el.innerHTML = `<div class="top">${backBtn(imported?'My Recipes':'Nutrition')}<div class="acts">${(mine && aiCan('coach') && has) || d.review ? `<button class="icon-btn kit-help" id="dk-kit" aria-label="Ask Kit about this recipe">${svg('sparkle')}</button>` : ''}${mine ? `<button class="icon-btn" id="dk-help" aria-label="How recipes work">${svg('help')}</button>` : ''}<button class="icon-btn" id="dk-more" aria-label="Meal options">${svg('more')}</button>${mine ? '<button class="primary sm" id="dk-done">Done</button>' : ''}</div></div>
    ${mine ? `<textarea class="dish-name-in" id="dk-name" rows="1" placeholder="Name the recipe" aria-label="Recipe name" maxlength="80" enterkeyhint="done" autocomplete="off">${d.named ? esc(d.name) : ''}</textarea>`
      : `<div class="eyebrow">From ${esc(d.owner.name)}</div><h1 class="dish-name">${esc(d.name)}</h1>`}
    ${sums}
    ${imported?recipeSourceCard(d):''}
    ${d.items.length ? `<div class="card ing-card"><div class="ing-list">${d.items.map((it) => (mine ? `<div class="swipe"><button type="button" class="sw-del" data-del="${esc(it.id)}" tabindex="-1">${svg('trash')}Remove</button><button class="ig sw-row" data-it="${esc(it.id)}">${ing(it)}</button></div>` : `<div class="ig">${ing(it)}</div>`)).join('')}</div></div>` : ''}
    ${mine && has ? `<div class="card serve measure"><div class="seg wide m-seg" role="group" aria-label="How it's measured">
        <button type="button" data-sv="one" aria-pressed="${bySv}">By servings</button><button type="button" data-sv="portion" aria-pressed="${!bySv}">By weight</button></div>
      ${bySv ? `<p class="small muted m-note">${imported?`This recipe makes ${esc(d.serving_count)} servings. Log the number you eat.`:'The whole meal is one serving. Had more? Say so when you log it.'}</p>`
        : `<form class="m-row" id="dk-weigh"><label class="m-lab" for="dk-w">Total weight</label><span class="gfield"><input id="dk-w" name="g" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5"
          value="${w ? Math.round(w) : ''}" placeholder="0" aria-label="Weight of the whole meal in grams"><span>g</span></span></form>
          ${d.weighed && d.items_g ? `<button class="linkbtn wt-reset" id="dk-sum">Use the ingredients added up (${gfmt(d.items_g)})</button>` : ''}`}</div>` : ''}
    ${shared.length ? `<button class="card tap share-row" id="dk-share"><span class="avs">${shared.map((p) => avatar(p)).join('')}</span>
      <span class="grow"><b>Shared with ${esc(shared.map((p) => p.name.split(' ')[0]).join(', '))}</b><small class="muted">Tap to change</small></span>${svg('chev')}</button>` : ''}
    ${mine ? `${chatLog(d)}<div id="dk-match"></div>
      <form class="composer" id="dk-add"><button type="button" class="icon-btn" id="dk-plus" aria-label="Scan a barcode, photograph the nutrition label, or search">${svg('plus')}</button>
        <input name="t" id="dk-t" placeholder="${aiCan('food') ? 'Add an ingredient…' : 'Search for an ingredient…'}" aria-label="${aiCan('food') ? 'Describe an ingredient' : 'Search for an ingredient by name'}" autocomplete="off" enterkeyhint="search" maxlength="600" required>
        <button class="icon-btn send" aria-label="Add">${svg('send')}</button></form>
      <input type="file" accept="image/*" multiple id="dk-label-file" hidden>`
      : has ? `<div class="finish"><button class="primary wide" id="dk-log">Log a portion</button></div>` : `<p class="small muted">${esc(d.owner.name.split(' ')[0])} hasn't added anything yet.</p>`}`;
  wireBack(el, imported?'/food/meals':'/food');
  $('#dk-more', el).onclick = () => (mine ? dishMenu(d, set, () => el._search && el._search(), () => knownSheet(d, set)) : sharedMenu(d));
  $$('[data-it]', el).forEach((b) => b.onclick = () => itemSheet(d, d.items.find((x) => x.id === b.dataset.it), set));
  const patch = async (body) => { try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); return true; } catch (x) { toast(x.message); return false; } };
  const lg = $('#dk-log', el); if (lg) lg.onclick = () => dishLogSheet(d, {day: isoDay(new Date()), meal: guessMeal()}, () => {});
  const kit = $('#dk-kit', el); if (kit) kit.onclick = () => recipeKit(d, mine, set);
  if (!mine) return;
  $$('[data-dismiss-pending]',el).forEach(b=>b.onclick=()=>{if(confirm('Leave this unmatched line out of the recipe nutrition? If you added it separately, its nutrition will be included.'))patch({dismiss_pending:[b.dataset.dismissPending],use_ingredients:true});});
  $('#dk-help', el).onclick = () => sheet('How recipes work', cookSteps(d));
  swipeRows(el, (id) => removeItem(d, d.items.find((x) => x.id === id), set));
  chatBox(el, d, set);
  labelButton(el, d, set);
  $('#dk-plus', el).onclick = () => plusMenu(el, d, set);
  const sh = $('#dk-share', el); if (sh) sh.onclick = () => shareDishSheet(d, set);
  // Done: back to Nutrition (a dish with nothing in it and no name isn't kept)
  $('#dk-done', el).onclick = () => {
    if (!has && !$('#dk-name', el).value.trim()) { api(`/api/dishes/${d.id}`, {method: 'DELETE'}).catch(() => {}); App.cache.delete('/api/dishes'); }
    else if (has) toast('Saved. Log it from My Recipes');
    go(imported?'/food/meals':'/food', {replace: true});
  };
  // the name, edited in place: saved when you leave the box or press Done on the keyboard
  const nm = $('#dk-name', el);
  const saveName = async () => { const v = nm.value.trim(); if (v && v !== d.name) await patch({name: v}); else if (!v && d.named) nm.value = d.name; };
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

}
// + next to the message box: the other ways to add an ingredient
function plusMenu(el, d, set) {
  sheet('Add an ingredient', `<div class="btncol plus-menu"><button class="ghost" id="pm-scan">${svg('barcode')}Scan a barcode</button>
    ${aiCan('food') ? `<button class="ghost" id="pm-label">${svg('camera')}Photo of the nutrition label</button>` : ''}
    <button class="ghost" id="pm-search">${svg('search')}Search the food database</button>
    <button class="ghost" id="pm-known">${svg('edit')}${d.known.kcal != null ? 'Change the total you typed in' : 'Type the whole meal\'s calories'}</button></div>`, (b, close) => {
    $('#pm-scan', b).onclick = () => { close(); scanSheet(null, null, (f) => foodToDish(d, f, set)); };
    const label = $('#pm-label', b); if (label) label.onclick = () => { close(); el._label(); };
    $('#pm-search', b).onclick = () => { close(); el._search && el._search(); };
    $('#pm-known', b).onclick = () => { close(); knownSheet(d, set); };
  });
}
// a scanned product: how much of it went in (grams, servings or the whole package), then it's an ingredient
function foodToDish(d, f, set) {
  const p = f.per100, sg = f.serving && f.serving.g;
  if (!p || p.kcal == null) { toast(`${f.name} has no calories per 100 g - search for it or type it in instead`); return; }
  sheet(f.name, `<form class="form" id="fd2"><p class="small muted">${f.brand ? `${esc(f.brand)} · ` : ''}${r0(p.kcal)} kcal per 100 g${f.serving && f.serving.label ? ` · serving ${esc(f.serving.label)}` : ''}</p>
    <label>How much went in<span class="gfield"><input name="g" inputmode="decimal" value="${sg ? Math.round(sg) : 100}" aria-label="How much went in, in grams"><span>g</span></span></label>
    ${sg ? `<div class="share-line"><span class="muted">or</span><input name="n" inputmode="decimal" placeholder="1" aria-label="Servings"><span>servings</span></div>` : ''}
    <div class="portion-out" aria-live="polite"></div>
    <div class="actions"><button class="primary">Add to the meal</button></div></form>`, (b, close) => {
    const fm = $('#fd2', b), out = $('.portion-out', fm), num = (x) => +x.value.replace(',', '.');
    const show = () => { const g = num(fm.g); out.innerHTML = g > 0 ? nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map((k) => [k, p[k]==null?null:p[k]*g/100]))) : ''; };
    fm.g.oninput = () => { if (fm.n) fm.n.value = ''; show(); };
    if (fm.n) fm.n.oninput = () => { const k = num(fm.n); if (k > 0) fm.g.value = Math.round(k * sg); show(); };
    show();
    fm.onsubmit = async (e) => {
      e.preventDefault(); const g = num(fm.g); if (!(g > 0 && g < 20000)) { toast('How much went in, in grams?'); return; }
      const sb = $('button.primary', fm); sb.disabled = true;
      try {
        set(await api(`/api/dishes/${d.id}/items`, json('POST', {name: [f.brand, f.name].filter(Boolean).join(' ').slice(0, 200), grams: g, per100: p, source: f.source || 'off', ref: f.id ? {id: f.id} : null})));
        close(); toast(`Added ${f.name}: ${gfmt(g)}`);
      } catch (x) { toast(x.message); sb.disabled = false; }
    };
  });
}
// Log a dish (Add food > Saved Dishes, or a friend's dish). One question only, the way the dish is measured (Ben,
// 2026-10-12): by servings -> how many servings (½ steps); by weight -> your portion in grams. w = {day, meal} from Add food.
function dishLogSheet(d, w, done) {
  const owner=readOwner();
  if(d.recipe_source?.import_id && d.totals.kcal==null){sheet(d.name,'<p>Add calories before logging a portion. Missing ingredients are kept unknown.</p><button class="primary wide" id="recipe-add-nutrition">Add nutrition</button>',(b,close)=>{$('#recipe-add-nutrition',b).onclick=()=>{close();done(true);go('/food/cook/'+d.id);};});return;}
  const t = d.totals, wt = d.weight_g, bySv = d.serving === 'one';     // by servings: the whole dish is one serving
  const vals = (k) => Object.fromEntries(FOOD_NUTRIENTS.map((x) => [x, t[x]==null?null:t[x]*k]));
  const half = (x) => (x === 0.5 ? '½' : String(x).replace('.5', '½'));
  sheet(d.name, `<form class="form" id="dl">
    ${bySv ? `<div class="stepper" role="group" aria-label="Servings"><button type="button" class="icon-btn" data-st="-1" aria-label="Fewer">${svg('minus')}</button>
        <span><b class="num" id="dl-n">1</b><small id="dl-u">serving</small></span><button type="button" class="icon-btn" data-st="1" aria-label="More">${svg('plus')}</button></div>`
      : wt ? `<label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="The whole meal is ${Math.round(wt)}" aria-label="Your portion in grams"><span>g</span></span></label>`
      : '<p class="callout warn">This meal is measured by weight but has no weight yet. Edit it and type its total weight, or switch it to servings.</p>'}
    ${d.recipe_source?.import_id?`<p class="small muted">The whole recipe makes ${esc(d.serving_count)} servings. Unknown nutrition is shown as a dash.</p>`:''}<div class="portion-out" aria-live="polite"></div>
    <div class="actions">${d.mine !== false ? `<button type="button" class="ghost" id="dl-edit">${svg('edit')}Edit</button><span class="spacer"></span>` : ''}
      <button class="primary"${!bySv && !wt ? ' disabled' : ''}>Add to ${esc(MEAL_NAMES[w.meal])}${w.day !== isoDay(new Date()) ? `, ${esc(dayLabel(w.day))}` : ''}</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const f = $('#dl', b), out = $('.portion-out', f), num = (x) => (x ? +x.value.replace(',', '.') : 0);
    let n = 1;
    const factor = () => (bySv ? n/(d.serving_count||1) : num(f.g) > 0 && wt ? num(f.g) / wt : null);
    const show = () => { const k = factor(); out.innerHTML = k ? nutGrid(vals(k))+extraFood(vals(k)) : ''; };
    if (bySv) $$('[data-st]', f).forEach((x) => x.onclick = () => {
      n = Math.max(0.5, Math.min(20, n + 0.5 * +x.dataset.st));
      $('#dl-n', f).textContent = half(n); $('#dl-u', f).textContent = n > 1 ? 'servings' : 'serving'; show();
    });
    else if (f.g) f.g.oninput = show;
    show();
    const ed = $('#dl-edit', b); if (ed) ed.onclick = () => { close(); done(true); go(`/food/cook/${d.id}`); };
    const portionId=newId();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f);if(btn.disabled)return;
      const body = {meal: w.meal, day: w.day, client_id:portionId};
      if (bySv) body.count = n;
      else { const g = num(f.g); if (!(g > 0)) { toast('How many grams did you have?'); return; } body.grams = g; }
      const label=btn.textContent;btn.disabled = true;btn.textContent='Saving portion…';
      try {
        const r = await sendOrQueue(`/api/dishes/${d.id}/portion${location.pathname==='/food/describe'?'?thread=true&captured_at='+encodeURIComponent(new Date().toISOString()):''}`, 'POST', body, d.name);
        if(!r.queued&&r.messages&&typeof FoodThread!=='undefined'){try{await FoodThread.accept(r);}catch(e){invalidate('/api/food');}}
        if(readOwner()!==owner)return;
        if(r.queued){const factor=bySv?n/(d.serving_count||1):body.grams/wt,values=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,t[k]==null?null:t[k]*factor]));
          patchDay(w.day,day=>{if(day.entries.some(e=>e.id==='q-'+portionId))return;day.entries.push({...w,...values,id:'q-'+portionId,client_id:portionId,name:d.name,amount:bySv?n:body.grams,unit:bySv?'serving':'g',source:'dish',pending:true,ref:{dish_id:d.id,unknown_nutrients:Object.keys(values).filter(k=>values[k]==null)}});for(const k of Object.keys(values)){day.totals[k]=(day.totals[k]||0)+(values[k]||0);if(values[k]==null&&day.unknown_nutrients)day.unknown_nutrients[k]=(day.unknown_nutrients[k]||0)+1;}});
        }else invalidate('/api/food/');
        App.cache.delete('/api/dishes');close();done(false);Native.haptic('light');
        let undoing=false,undone=false;
        const undo=async()=>{if(undoing||undone||readOwner()!==owner)return;undoing=true;
          try{
            const removed=await sendOrQueue(`/api/dishes/${d.id}/portion/cancel`,'POST',{client_id:portionId},'Undo '+d.name);
            if(readOwner()!==owner)return;
            Q.save(Q.all().filter(op=>!(Q.owns(op)&&op.body?.client_id===portionId&&op.path.split('?')[0]===`/api/dishes/${d.id}/portion`)));netbar();
            patchDay(w.day,day=>{const found=day.entries.find(e=>e.id==='q-'+portionId);if(found){day.entries=day.entries.filter(e=>e!==found);for(const k of FOOD_NUTRIENTS){day.totals[k]=Math.max(0,(day.totals[k]||0)-(found[k]||0));if(found[k]==null&&day.unknown_nutrients)day.unknown_nutrients[k]=Math.max(0,(day.unknown_nutrients[k]||0)-1);}}});
            if(readOwner()!==owner)return;undone=true;if(removed.messages&&typeof FoodThread!=='undefined')await FoodThread.accept(removed);
            invalidate('/api/food/');toast(removed.queued?'Undo saved on this phone · waiting to send':'Portion removed');
          }catch(x){if(readOwner()===owner)toast('Could not undo · try again',undo);}finally{undoing=false;}
        };
        toast(r.queued?'Portion saved on this phone · waiting to send':`Added ${d.name} to ${MEAL_NAMES[w.meal].toLowerCase()}: ${Math.round(r.entry.kcal/5)*5} kcal`,undo);
      } catch (x) { if(readOwner()===owner){toast(x.message);btn.disabled=false;btn.textContent=label;} }
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
  const file = $('#dk-label-file', el);
  if (!file) return;
  el._label = () => { if (App.me.coach && !App.me.ai_ok) aiSheet(() => file.click()); else file.click(); };    // from the + menu
  file.onchange = async () => {
    const owner=readOwner(),active=()=>el.isConnected&&readOwner()===owner;
    const files=[...(file.files||[])];file.value='';
    await reviewFoodPhotos(files,async photos=>{
    if(!active())return;
    sheet('Nutrition label', `<div id="lb-box"><p class="small muted center">${svg('sparkle')} Reading the label…</p></div>`, async (b, close) => {
      const box = $('#lb-box', b);
      let L;
      try { L = await api('/api/food/label', json('POST', {images: photos})); }
      catch (x) { if(!active()||!box.isConnected)return;box.innerHTML = `<p class="err">${esc(x.message)}</p><div class="actions"><button class="primary" id="lb-again">Try another photo</button></div>`;
        $('#lb-again', b).onclick = () => { close(); file.click(); }; return; }
      if(!active()||!box.isConnected)return;
      const S = L.per_serving, pkg = L.package_g;
      box.innerHTML = `<form class="form" id="lb">
        <label>Name<input name="name" maxlength="200" value="${esc([L.brand, L.name].filter(Boolean).join(' '))}"></label>
        <p class="small muted">Per serving (${esc(L.serving.label)}): ${r0(S.kcal)} kcal · ${r1(S.protein_g)} g protein · ${r1(S.carbs_g)} g carbs · ${r1(S.fat_g)} g fat${L.servings ? ` · ${r1(L.servings)} servings in the package` : ''}</p>
        <label>How much went in<span class="gfield"><input name="g" inputmode="decimal" value="${Math.round(pkg || L.serving.g)}" aria-label="How much went in, in grams"><span>g</span></span></label>
        <div class="share-line"><span class="muted">or</span><input name="n" inputmode="decimal" value="${pkg ? '' : 1}" placeholder="1" aria-label="Servings"><span>servings</span>
          ${pkg ? `<button type="button" class="linkbtn" id="lb-all">The whole package (${gfmt(pkg)})</button>` : ''}</div>
        <div class="portion-out" aria-live="polite"></div>
        <label class="check"><input type="checkbox" name="save"> <span>Also save it to My foods</span></label>
        <div class="actions"><button class="primary">Add to the meal</button></div></form>`;
      const f = $('#lb', b), out = $('.portion-out', f), num = (x) => +x.value.replace(',', '.');
      const show = () => { const g = num(f.g); out.innerHTML = g > 0 ? nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map((k) => [k, L.per100[k]==null?null:L.per100[k]*g/100]))) : ''; };
      f.g.oninput = () => { f.n.value = ''; show(); };
      f.n.oninput = () => { const n = num(f.n); if (n > 0) f.g.value = Math.round(n * L.serving.g); show(); };
      const all = $('#lb-all', b); if (all) all.onclick = () => { f.g.value = Math.round(pkg); f.n.value = ''; show(); };
      show();
      f.onsubmit = async (e) => {
        e.preventDefault();if(!active())return; const g = num(f.g), name = f.name.value.trim() || L.name;
        if (!(g > 0 && g < 20000)) { toast('How much went in, in grams?'); return; }
        const sb = $('button.primary', f); sb.disabled = true;
        try {
          set(await api(`/api/dishes/${d.id}/items`, json('POST', {name, grams: g, per100: L.per100, source: 'label'})));
          if (f.save.checked) {
            await api('/api/food/foods', json('POST', {name: L.name, brand: L.brand, barcode: null, serving_label: L.serving.label, serving_g: L.serving.g,
              kcal: S.kcal, protein_g: S.protein_g, carbs_g: S.carbs_g, fat_g: S.fat_g, fiber_g: S.fiber_g, ...Object.fromEntries(EXTRA_NUTRIENTS.map(([k])=>[k,S[k]??null])), favorite: false}));
            invalidate('/api/food/foods');
          }
          close(); toast(`Added ${name}: ${gfmt(g)}${f.save.checked ? ', saved to My foods' : ''}`);
        } catch (x) { toast(x.message); sb.disabled = false; }
      };
    });
    },{label:true,active});
  };
}
// remove an ingredient, with Undo (it goes back at the end of the list)
async function removeItem(d, it, set) {
  if (!it) return;
  try {
    set(await api(`/api/dishes/${d.id}/items/${it.id}`, {method: 'DELETE'}));
    const back = {name: it.name, grams: it.grams, source: it.source || 'quick', ref: it.ref || null, per100: it.per100 || null, ...Object.fromEntries(FOOD_NUTRIENTS.map((k) => [k, it[k] == null ? null : it[k]]))};
    toast(`Removed ${it.name}`, async () => { try { set(await api(`/api/dishes/${d.id}/items`, json('POST', back))); } catch (x) { toast(x.message); } });
  } catch (x) { toast(x.message); }
}
// Need help? (the ? at the top): three short steps, the current one highlighted
function cookSteps(d) {
  const added = d.items.length > 0 || d.known.kcal != null;
  const steps = [
    [added, 'Add what goes in', added ? `${d.items.length ? `${d.items.length} so far` : 'Total typed in'}, ${r0(d.totals.kcal)} kcal` : 'Type it the way you\'d text it, or tap + to scan a barcode or photograph the label.'],
    [added, 'Say how it\'s measured', d.recipe_source?.import_id?`This recipe makes ${d.serving_count} servings. Log the number you eat, or add the whole cooked weight and log grams.`:'By servings (the whole meal is one serving, like a smoothie; log 2 if you had two) or by weight (a pot of chili: you log grams).'],
    [false, 'Log it when you eat it', 'My Recipes, any day. It stays saved until you delete it.'],
  ];
  const now = added ? 2 : 0;
  return `<ol class="card cook-steps" aria-label="How recipes work">${steps.map(([done, title, sub], i) =>
    `<li class="${done && i !== now ? 'done' : i === now ? 'now' : ''}"${i === now ? ' aria-current="step"' : ''}><span class="stepn">${done && i !== now ? svg('check') : i + 1}</span>
      <div><b>${title}</b><small>${esc(sub)}</small></div></li>`).join('')}</ol>`;
}
// AI feedback on the recipe (food_coach.py): kept on the dish, so friends it's shared with see it too
function recipeReview(d, mine) {
  const R = d.review;
  if (!R) return `<div class="cc-ask"><span class="grow"><b>Kit’s take</b><small class="muted">Calories per portion and easy tweaks</small></span>
    <button class="ghost sm tint" id="dk-review">${svg('sparkle')}Ask</button></div>`;
  return coachMessage('recipe:' + d.id, [R.summary, R.text, R.ideas, R.note], "Kit’s take", `
    ${R.summary ? `<p class="ai-head">${esc(R.summary)}</p>` : ''}${R.text ? `<p>${esc(R.text)}</p>` : ''}
    ${R.ideas ? `<h3 class="ghead">Ideas</h3><ul class="ai-list">${R.ideas.map((i) => `<li>${svg('sparkle')}<span><b>${esc(i.change)}</b>${i.effect ? ` <span class="muted">${esc(i.effect)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${R.note ? `<div class="callout warn">${esc(R.note)}</div>` : ''}
    ${mine && aiCan('coach') ? `<button class="linkbtn" id="dk-review">${svg('sparkle')}${R.changed_since ? 'The recipe changed - ask again' : 'Ask again'}</button>` : ''}`, new Date(R.at).toLocaleDateString([], {month: 'short', day: 'numeric'}));
}
// who the dish is shared with: friends only, one tap each
function shareDishSheet(d, set) {
  sheet('Share this meal', `<p class="small muted">Friends you share it with see the meal and log their own portion. They can't change it.</p><div id="sd-list">${skel(1)}</div>`, async (b) => {
    const box = $('#sd-list', b);
    let on = new Set((d.shared_with || []).map((p) => p.login)), fr;
    try { fr = (await api('/api/friends')).friends; } catch (x) { box.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    const draw = () => {
      box.innerHTML = fr.length ? `<div class="card list">${fr.map((p) => `<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>
        <button class="${on.has(p.login) ? 'ghost' : 'primary'} sm" data-sd="${esc(p.login)}">${on.has(p.login) ? `${svg('check')}Shared` : 'Share'}</button></div>`).join('')}</div>`
        : '<p class="small muted">No friends yet. Add them under Me &gt; Friends, then share meals with them here.</p>';
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
  sheet(d.name, `<p class="small muted">${esc(d.owner.name)} shared this meal with you.</p><div class="btncol"><button class="ghost danger" id="sm-hide">Remove it from my list</button></div>`, (b, close) => {
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
  return `<div class="cchat" id="dk-chat" aria-live="polite">${first ? `<div class="cmsg ai">${aiCan('food') ? 'Describe an ingredient, photograph a label or scan a barcode. Review the nutrition before adding.' : 'Search for an ingredient below, then choose the amount. Tap + to scan a barcode or enter known nutrition totals. AI is optional.'}</div>` : ''}
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
  f.onsubmit = (e) => { e.preventDefault(); const text = f.t.value.trim(); if (text) { if (aiCan('food')) send(text); else searchFlow(el, d, set, text); } };
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
      per100: Object.fromEntries(FOOD_NUTRIENTS.map((k) => [k, r[k] == null ? null : r[k] / r.amount * 100]))}));
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
    ${extraInputs()}<p class="small muted">For the whole amount you're adding, from the packet or a recipe.</p>
    <div class="actions"><button class="primary">Add</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,readOwner());const f = $('#ty', b); f.kcal.focus();
    f.onsubmit = async (e) => {   // stays open if the server says no, so the numbers aren't lost
      e.preventDefault(); const n = (v) => (v.trim() === '' ? null : +v.replace(',', '.')), btn = $('button.primary', f);
      btn.disabled = true;
      if (await done({name: f.name.value.trim(), grams: n(f.grams.value), kcal: n(f.kcal.value), protein_g: n(f.protein_g.value), carbs_g: n(f.carbs_g.value), fat_g: n(f.fat_g.value),...extraFormValues(f)})) close();
      else btn.disabled = false;
    };
  });
}
function itemSheet(d, it, set) {
  sheet(it.name, `<form class="form" id="it"><label>Weight<span class="gfield"><input name="g" inputmode="decimal" value="${it.grams==null?'':Math.round(it.grams * 10) / 10}" required><span>g</span></span></label>
    <div id="it-nut">${nutGrid(it)}</div>
    <p class="small muted">${it.per100 && it.per100.kcal != null ? `${r0(it.per100.kcal)} kcal per 100 g. ` : ''}${it.grams?'Change the weight and the numbers follow.':'Weigh this known amount to give it a weight. Its nutrition stays the same.'}</p>
    <div class="actions"><button type="button" class="ghost danger" id="it-del">Remove</button><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#it', b);
    f.g.oninput = () => {   // the numbers above follow the weight as you type
      const g = +f.g.value.replace(',', '.'), k = it.grams > 0 ? g / it.grams : 0;
      if (g > 0 && k) $('#it-nut', b).innerHTML = nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map((x) => [x, it[x]==null?null:it[x]*k])));
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
  const k = d.known, v = (x) => (x == null ? '' : String(Math.round((x+Number.EPSILON)*10000)/10000));
  sheet('Total for the whole meal', `<form class="form" id="kn"><label>Calories<input name="kcal" inputmode="decimal" value="${v(k.kcal)}" required></label>
    <div class="two"><label>Protein (g)<input name="protein_g" inputmode="decimal" value="${v(k.protein_g)}"></label><label>Carbs (g)<input name="carbs_g" inputmode="decimal" value="${v(k.carbs_g)}"></label></div>
    <div class="two"><label>Fat (g)<input name="fat_g" inputmode="decimal" value="${v(k.fat_g)}"></label><label>Fiber (g)<input name="fiber_g" inputmode="decimal" value="${v(k.fiber_g)}"></label></div>
    ${extraInputs(k)}<p class="small muted">From a recipe or your own sums. It's used instead of the ingredients.</p>
    <div class="actions">${k.kcal != null ? '<button type="button" class="ghost" id="kn-clear">Use the ingredients</button>' : ''}<button class="primary">Save</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,readOwner());const f = $('#kn', b);     // no keyboard until a box is tapped (2026-10-12)
    const save = async (body) => {
      const btn = $('button.primary', f); btn.disabled = true;
      try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); close(); } catch (x) { toast(x.message); btn.disabled = false; }
    };
    f.onsubmit = (e) => {
      e.preventDefault(); const n = (s) => (s.trim() === '' ? null : +s.replace(',', '.'));
      save(Object.fromEntries(FOOD_NUTRIENTS.map((x) => ['known_' + x, n(f[x].value)])));
    };
    const c = $('#kn-clear', b); if (c) c.onclick = () => save({known_kcal: null, known_protein_g: null, known_carbs_g: null, known_fat_g: null, known_fiber_g:null,known_sodium_mg:null,known_sugar_g:null,known_saturated_fat_g:null,use_ingredients:true});
  });
}
function dishMenu(d, set, search, known) {
  sheet(d.name, `<div class="btncol"><button class="ghost" id="dm-search">Search the food database</button>
    <button class="ghost" id="dm-known">${d.known.kcal != null ? 'Change the total you typed in' : 'I already know the total'}</button>
    <button class="ghost" id="dm-share">${(d.shared_with || []).length ? 'Shared with friends' : 'Share with a friend'}</button>
    <button class="ghost danger" id="dm-del">Delete meal</button></div>
    <p class="small muted">What you've logged from it stays in your food log.</p>`, (b, close) => {
    $('#dm-search', b).onclick = () => { close(); search(); };
    $('#dm-known', b).onclick = () => { close(); known(); };
    $('#dm-share', b).onclick = () => { close(); shareDishSheet(d, set); };
    $('#dm-del', b).onclick = async () => {
      if (!confirm(`Delete ${d.name}?`)) return;
      try { await api(`/api/dishes/${d.id}`, {method: 'DELETE'}); App.cache.delete('/api/dishes'); close(); go('/food', {replace: true}); toast('Meal deleted'); } catch (x) { toast(x.message); }
    };
  });
}

function recipeKit(d, mine, set) {
  const account = App.me.login;
  sheet('Kit · ' + d.name, '<div id="recipe-kit"></div>', root => {
    const box = $('#recipe-kit',root);
    const draw = () => {
      box.innerHTML = recipeReview(d, mine);
      const button = $('#dk-review',box); if (!button) return;
      button.onclick = async () => {
        if (!App.me.ai_ok) { aiSheet(draw); return; }
        button.disabled = true; button.textContent = 'Reading this recipe…';
        try {
          const result = await api(`/api/dishes/${d.id}/review`,json('POST',{}));
          if (App.me?.login !== account || !box.isConnected) return;
          d = {...d,review:{...result,changed_since:false}}; set(d); draw();
        } catch (e) { if (App.me?.login === account && box.isConnected) { draw(); aiError($('#dk-review',box),e.message); } }
      };
    }; draw();
  });
}


function recipeSourceCard(d){
  const s=d.recipe_source,labels=RECIPE_SOURCE_LABELS;
  return `<div class="card recipe-source"><p class="small">Makes ${esc(d.serving_count)} servings · ${d.totals.kcal==null?'Calories unknown':`${Math.round(d.totals.kcal/5)*5} kcal in the whole recipe`}</p>${s.source_url?`<a class="linkbtn" href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">Original recipe</a>`:'<p class="small muted">From a recipe screenshot · AI estimates</p>'}<p class="small muted">${esc([...new Set(Object.values(s.sources||{}).map(k=>labels[k]||'Unknown'))].join(' · '))}${s.edited?' · Edited':''}</p>${s.site_recipe_changed?'<p class="small muted">Published values describe the site’s original recipe; ingredients were edited.</p>':''}${s.pending?.length?`<details><summary>Unmatched ingredients (${s.pending.length})</summary>${s.pending.map(t=>`<p>${esc(t)}${d.mine!==false?` <button class="linkbtn" data-dismiss-pending="${esc(t)}">Leave this line out</button>`:''}</p>`).join('')}</details>`:''}</div>`;
}
