// Kinetta phone app — Part 6: dishes (2026-10-11). Build a dish from what goes in ("100 g chicken", "250 g carrots"),
// keep it, and log it from Add food > Saved Dishes whenever you eat it. The server does the sums (app/api_dishes.py).
// 2026-10-12: ingredients are typed the way you'd text them ("2 apples", "a splash of oil", "make the rice 200 g"):
// app/cook_chat.py answers from what you've used before, or asks the AI; search-and-pick stays as the fallback.
// 2026-10-12, round three (Ben): a dish is simply saved, no cooking / leftovers / finish; the name is edited in place;
// the weight is the ingredients added up and can be typed over (no pans); a dish is eaten as one serving (a smoothie)
// or by portion (a pot of chili), and logging happens in Add food, not here.
'use strict';

const RECIPE_SOURCE_LABELS=Object.freeze({site:'Published by site',ingredients:'Matched ingredients',estimated_ingredients:'Ingredients · includes Kit’s estimates',entered:'Entered by you',unknown:'Unknown'});
const gfmt = (g) => (g == null ? '–' : `${Math.round(g).toLocaleString()} g`);
Object.assign(IC, {minus: '<path d="M5 12h14"/>', send: '<path d="M12 19V5M6 11l6-6 6 6"/>', bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>'});
const listOf = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');

// Deliberate recipe creation opens its own ingredient editor and keeps food-chat drafts separate.
async function newDish(btn,where=null){
  const owner=readOwner();if(btn?.disabled)return;if(btn)btn.disabled=true;
  try{
    // The ingredient editor never resolves a new recipe through saved meal matches.
    const d=await api('/api/dishes',json('POST',{}));
    if(owner!==readOwner())return;App.cache.delete('/api/dishes');go('/food/cook/'+d.id);
  }catch(e){if(owner===readOwner())toast(e.message);}
  finally{if(btn?.isConnected&&owner===readOwner())btn.disabled=false;}
}

route(/^\/food\/cook\/(\d+)$/, 'food', async (el, id) => {
  el.classList.add('recipe-page');
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
  const owner=readOwner(), active=()=>el.isConnected&&readOwner()===owner;
  const t = d.totals, typed = d.known.kcal != null, mine = d.mine !== false, has = d.items.length > 0 || typed || !!d.recipe_source?.import_id, w = d.weight_g;
  let measureSave=Promise.resolve(true);
  const set = (fresh) => {      // redraw, keeping whatever box was being typed in
    if(!active())return;
    const scroll=$('.recipe-content',el)?.scrollTop||0, draft=$('#dk-t',el)?.value||'';
    const act = document.activeElement, keep = act && act.id && el.contains(act) ? [act.id, act.value] : null;
    d=fresh;App.cache.set(`/api/dishes/${d.id}`, {data: fresh, at: Date.now()}); App.cache.delete('/api/dishes'); drawDish(el, fresh);
    $('.recipe-content',el).scrollTop=scroll;if($('#dk-t',el))$('#dk-t',el).value=draft;
    if (keep) { const n = $('#' + keep[0], el); if (n) { n.value = keep[1]; n.focus(); } }
  };
  const ing = (it) => `<span class="ig-n">${esc(it.name)}</span><span class="ig-g num">${it.amount && !/\d\s*g$/.test(it.amount) ? `${esc(it.amount)} · ` : ''}${gfmt(it.grams)}</span><b class="num r">${r0(it.kcal)}</b>`;
  const shared = mine ? d.shared_with || [] : [];
  const bySv = d.serving === 'one';
  const source=d.recipe_source||{}, imported=!!source.import_id, display=imported?d.per_serving:t;
  el.classList.toggle('imported-recipe',imported);el.classList.add('recipe-page');
  const sums = has ? `<p class="dish-sum num"><b>${display.kcal==null?'Calories unknown':r0(display.kcal)+' kcal'}${imported?' a serving':''}</b> · ${MACROS.map(([k, nm]) => `${display[k]==null?'Unknown '+nm.toLowerCase():r0(display[k])+' g '+nm.toLowerCase()}`).join(' · ')}${typed && !imported ? `<br><span class="muted">Using the total ${mine ? 'you' : esc(d.owner.name.split(' ')[0])} typed in${d.items.length ? ', not the ingredients' : ''}.</span>` : ''}</p>` : '';
  el.innerHTML = `<div class="top">${backBtn(mine?'My Recipes':'Nutrition')}<div class="acts">${(mine && aiCan('coach')) || d.review ? `<button class="icon-btn kit-help" id="dk-kit" aria-label="Ask Kit about this recipe">${svg('sparkle')}</button>` : ''}${mine ? `<button class="icon-btn" id="dk-help" aria-label="How recipes work">${svg('help')}</button>` : ''}<button class="icon-btn" id="dk-more" aria-label="Recipe options">${svg('more')}</button> </div></div>
    <div class="recipe-content" tabindex="0" aria-label="Recipe ingredients and nutrition">
    ${mine ? `<div class="recipe-title"><textarea class="dish-name-in" id="dk-name" rows="1" placeholder="Name the recipe" aria-label="Recipe name" aria-describedby="recipe-title-status" maxlength="80" enterkeyhint="done" autocomplete="off">${d.named ? esc(d.name) : ''}</textarea><button type="button" class="icon-btn" id="dk-rename" aria-label="Edit recipe title">${svg('edit')}</button><button type="button" class="icon-btn danger" id="dk-delete" aria-label="Delete recipe" title="Delete recipe">${svg('trash')}</button></div><p id="recipe-title-status" class="small muted" role="status"></p>`
      : `<div class="eyebrow">From ${esc(d.owner.name)}</div><h1 class="dish-name">${esc(d.name)}</h1>`}
    ${mine?'<p class="small muted">Changes save as you go. Logging is optional.</p>':''}
    ${sums}
    ${imported?recipeSourceCard(d):''}
    ${d.items.length ? `<div class="card ing-card"><div class="ing-list">${d.items.map((it) => (mine ? `<div class="swipe"><button type="button" class="sw-del" data-del="${esc(it.id)}" tabindex="-1">${svg('trash')}Remove</button><button class="ig sw-row" data-it="${esc(it.id)}">${ing(it)}</button></div>` : `<div class="ig">${ing(it)}</div>`)).join('')}</div></div>` : ''}
    ${mine && has ? `<div class="card serve measure"><div class="seg wide m-seg" role="group" aria-label="How it's measured">
        <button type="button" data-sv="one" aria-pressed="${bySv}">By servings</button><button type="button" data-sv="portion" aria-pressed="${!bySv}">By weight</button></div>
      ${bySv ? `<form class="m-row" id="dk-yield"><label class="m-lab" for="dk-servings">Servings in the whole recipe</label><input id="dk-servings" name="count" type="text" inputmode="decimal" value="${esc(d.serving_count)}" aria-label="Servings in the whole recipe"></form><p class="small muted m-note">Nutrition per serving uses this number.</p>`
        : `<form class="m-row" id="dk-weigh"><label class="m-lab" for="dk-w">Total weight</label><span class="gfield"><input id="dk-w" name="g" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5"
          value="${w ? Math.round(w) : ''}" placeholder="0" aria-label="Weight of the whole recipe in grams"><span>g</span></span></form>
          ${d.weighed && d.items_g ? `<button class="linkbtn wt-reset" id="dk-sum">Use the ingredients added up (${gfmt(d.items_g)})</button>` : ''}`}</div>` : ''}
    ${mine&&(has||shared.length)?`<button type="button" class="card tap share-row" id="dk-share">${shared.length?`<span class="avs">${shared.map(p=>avatar(p)).join('')}</span>`:''}<span class="grow"><b>${shared.length?'Shared with '+esc(shared.map(p=>p.name.split(' ')[0]).join(', ')):'Share with…'}</b><small class="muted">${shared.length?'Change who can see this recipe':'Optional · private until you choose a friend'}</small></span>${svg('chev')}</button>`:''}
    ${mine ? `${chatLog(d)}<div id="dk-match">${CHATS.get(d.id)?.some(m=>m.clarification)?'<p class="small muted">Finish the ingredient above, or cancel it.</p><button type="button" class="linkbtn" id="dk-cancel-clarification">Cancel ingredient</button>':''}</div></div><button type="button" class="primary wide recipe-save" id="dk-done"${has?'':' disabled'}>Save recipe</button>
      <form class="composer" id="dk-add"><button type="button" class="icon-btn" id="dk-plus" aria-label="Scan a barcode, photograph the nutrition label, or search">${svg('plus')}</button>
        <input name="t" id="dk-t" placeholder="${aiCan('food') ? 'e.g. 100 g oats' : 'Search ingredients…'}" aria-label="${aiCan('food') ? 'Describe an ingredient' : 'Search for an ingredient by name'}" autocomplete="off" enterkeyhint="${aiCan('food')?'send':'search'}" maxlength="600" required>
        <button class="icon-btn send" aria-label="${aiCan('food')?'Add ingredient':'Search ingredients'}">${svg('send')}</button></form>
      <input type="file" accept="image/*" multiple id="dk-label-file" hidden>`
      : has ? `</div><div class="finish"><button class="primary wide" id="dk-log">Log a portion</button></div>` : `</div><p class="small muted">${esc(d.owner.name.split(' ')[0])} hasn't added anything yet.</p>`}`;
  wireBack(el, mine?'/food/meals':'/food');
  $('#dk-more', el).onclick = () => (mine ? dishMenu(d, set, () => el._search && el._search(), () => knownSheet(d, set)) : sharedMenu(d));
  $$('[data-it]', el).forEach((b) => b.onclick = () => itemSheet(d, d.items.find((x) => x.id === b.dataset.it), set));
  const patch = async (body) => { try { set(await api(`/api/dishes/${d.id}`, json('PATCH', body))); return true; } catch (x) { toast(x.message); return false; } };
  const lg = $('#dk-log', el); if (lg) lg.onclick = () => dishLogSheet(d, {day: isoDay(new Date()), meal: guessMeal()}, () => {});
  const kit = $('#dk-kit', el); if (kit) kit.onclick = () => mine&&aiCan('coach') ? KitChat.open('nutrition',null,`Help me review the saved recipe “${d.name}”. Check its saved ingredients and nutrition.`) : recipeKit(d,mine,set);
  if (!mine) return;
  $$('[data-dismiss-pending]',el).forEach(b=>b.onclick=()=>{if(confirm('Leave this unmatched line out of the recipe nutrition? If you added it separately, its nutrition will be included.'))patch({dismiss_pending:[b.dataset.dismissPending],use_ingredients:true});});
  $('#dk-delete',el).onclick=()=>deleteRecipe(d);
  $('#dk-help', el).onclick = () => sheet('How recipes work', cookSteps(d));
  swipeRows(el, (id) => removeItem(d, d.items.find((x) => x.id === id), set));
  chatBox(el, d, set);
  const cancelClarification=$('#dk-cancel-clarification',el);
  if(cancelClarification)cancelClarification.onclick=()=>{const log=CHATS.get(d.id)||[];if(log.some(m=>m.wait))return;for(const m of log)delete m.clarification;$('#dk-match',el).replaceChildren();$('#dk-t',el).focus();};
  labelButton(el, d, set);
  $('#dk-plus', el).onclick = () => plusMenu(el, d, set);
  const sh = $('#dk-share', el); if (sh) sh.onclick = () => shareDishSheet(d, set);
  // Finish saves the name, then offers an explicit meal-and-portion review.
  $('#dk-done', el).onclick = async () => {
    const button=$('#dk-done',el);if(button.disabled)return;button.disabled=true;
    if(CHATS.get(d.id)?.some(m=>m.wait)){toast('Wait for the ingredient to finish before saving.');button.disabled=false;return;}
    if($('#dk-match',el)?.hasChildNodes()){toast('Add or cancel the ingredient below before saving.');button.disabled=false;$('#dk-match',el).scrollIntoView({block:'nearest'});return;}
    if($('#dk-t',el)?.value.trim()){toast('Send or clear the ingredient text before saving your recipe.');button.disabled=false;$('#dk-t',el).focus();return;}
    if(!await measureSave||!await saveName()||!active()){if(active())button.disabled=false;return;}
    if(CHATS.get(d.id)?.some(m=>m.wait)||$('#dk-match',el)?.hasChildNodes()||$('#dk-t',el)?.value.trim()){toast('Finish or cancel the ingredient before saving.');button.disabled=false;return;}
    if (!has && !$('#dk-name', el).value.trim()) { api(`/api/dishes/${d.id}`, {method: 'DELETE'}).catch(() => {}); App.cache.delete('/api/dishes'); }
    else if (has) { if(!d.named){toast('What would you like to call this food or recipe?');$('#dk-name',el).focus();button.disabled=false;return;}finishDish(d);button.disabled=false;return; }
    go(imported?'/food/meals':'/food', {replace: true});
  };
  // the name, edited in place: saved when you leave the box or press Done on the keyboard
  const nm = $('#dk-name', el);
  $('#dk-rename',el).onclick=()=>{nm.focus();nm.setSelectionRange(0,nm.value.length);};
  const titleStatus=$('#recipe-title-status',el);
  let nameSave=Promise.resolve(true);
  const saveName = () => {
    const v=nm.value.trim();
    nameSave=nameSave.then(async()=>{
      if(!active())return false;
      if(!v||v===d.name){if(!v&&d.named)nm.value=d.name;return true;}
      titleStatus.textContent='Saving title…';
      try{const fresh=await api(`/api/dishes/${d.id}`,json('PATCH',{name:v}));if(!active())return false;
        d=fresh;titleStatus.textContent='Title saved';App.cache.set(`/api/dishes/${d.id}`,{data:fresh,at:Date.now()});App.cache.delete('/api/dishes');return true;
      }catch(x){if(active()){titleStatus.innerHTML='Title not saved. <button type="button" class="linkbtn" id="dk-title-retry">Retry</button>';const retry=$('#dk-title-retry',el);retry.onclick=()=>{if(retry.disabled||!active())return;retry.disabled=true;return saveName();};toast(x.message);}return false;}
    });
    return nameSave;
  };
  const fit = () => { nm.style.height = 'auto'; nm.style.height = `${nm.scrollHeight}px`; };      // a long name wraps instead of being cut off
  fit(); nm.oninput = () => { nm.value = nm.value.replace(/\n/g, ' '); fit(); };
  nm.onchange = saveName;
  nm.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
  wireSeg(el, 'sv', (v) => { if (v !== d.serving) patch({serving: v}); });
  const yf=$('#dk-yield',el);
  if(yf){yf.onsubmit=e=>{e.preventDefault();yf.count.blur();};yf.count.onchange=()=>{const n=Number(yf.count.value.replace(',','.'));if(!(n>0&&n<=50)){toast('Enter the number of servings, above zero and up to 50.');yf.count.value=d.serving_count;return;}measureSave=patch({yield_servings:n});};}
  const wf = $('#dk-weigh', el);
  if (wf) {      // digits only; saved when you leave the box. Typing what the ingredients add up to = not weighed
    wf.g.oninput = () => { wf.g.value = wf.g.value.replace(/\D/g, ''); };
    const save = () => { const g = +wf.g.value; if (!(g > 0)) { wf.g.value = w ? Math.round(w) : ''; return; } if (Math.round(g) !== Math.round(w || 0)) measureSave=patch({cooked_g: g}); };
    wf.g.onchange = save;
    wf.onsubmit = (e) => { e.preventDefault(); wf.g.blur(); };
    const sum = $('#dk-sum', el); if (sum) sum.onclick = () => patch({cooked_g: null});
  }

}

function manualDishFood(d,set){
  typeSheet('', '', async body=>{
    try {const fresh=await api(`/api/dishes/${d.id}/items`,json('POST',body));set(fresh);toast('Food added to the recipe');
      if(d.known.kcal!=null)sheet('Which nutrition should the recipe use?',`<p>The named food is saved as an ingredient. This recipe currently uses an entered or published total instead of adding its ingredients.</p><div class="actions"><button type="button" class="ghost" id="manual-keep-total">Keep that total</button><button type="button" class="primary" id="manual-use-ingredients">Use ingredient totals</button></div>`,(b,close)=>{
        guardFoodSheet(b,close,readOwner());$('#manual-keep-total',b).onclick=close;
        $('#manual-use-ingredients',b).onclick=async e=>{e.target.disabled=true;try{set(await api(`/api/dishes/${d.id}`,json('PATCH',{...Object.fromEntries(FOOD_NUTRIENTS.map(k=>['known_'+k,null])),use_ingredients:true})));close();}catch(x){toast(x.message);e.target.disabled=false;}};
      });return true;}
    catch(e){toast(e.message);return false;}
  });
}
function finishDish(d){
  const owner=readOwner();
  sheet('Save recipe',`<form class="form" id="recipe-finish"><label>Recipe name<input name="title" value="${esc(d.name)}" maxlength="80" required autocomplete="off"></label><p>Your recipe is saved in My Recipes for reuse.</p><p class="small muted">${d.items.length} ingredient${d.items.length===1?'':'s'} · ${d.totals.kcal==null?'Calories unknown':r0(d.totals.kcal)+' kcal in the whole recipe'}</p><label class="switch-row"><span><b>Add to log</b><small>Optional · choose a meal and portion next</small></span><input type="checkbox" role="switch" name="log_today"></label><p class="small danger" role="alert" id="recipe-finish-error" hidden></p><button type="submit" class="primary wide" id="recipe-finish-save">Save recipe</button></form>`,(b,close)=>{
    guardFoodSheet(b,close,owner);const form=$('#recipe-finish',b),button=$('#recipe-finish-save',b),error=$('#recipe-finish-error',b),live=()=>b.isConnected&&owner===readOwner();
    form.elements.log_today.onchange=()=>button.textContent=form.elements.log_today.checked?'Save and choose a portion':'Save recipe';
    form.onsubmit=async e=>{
      e.preventDefault();if(!live()||button.disabled)return;const name=form.elements.title.value.trim();if(!name){error.textContent='Name your recipe first.';error.hidden=false;return;}button.disabled=true;error.hidden=true;
      try{
        const fresh=name!==d.name?await api('/api/dishes/'+d.id,json('PATCH',{name})):d;
        if(!live())return;App.cache.delete('/api/dishes');App.cache.delete('/api/dishes/'+d.id);const logging=form.elements.log_today.checked;close();
        if(logging)dishLogSheet(fresh,{day:isoDay(new Date()),meal:null},editing=>{if(!editing)go('/food/meals',{replace:true});},{chooseMeal:true});
        else{go('/food/meals',{replace:true});toast('Recipe saved · nothing added to your log');}
      }catch(x){if(live()){error.textContent=x.message;error.hidden=false;button.disabled=false;}}
    };
  });
}

// + next to the message box: the other ways to add an ingredient
function plusMenu(el, d, set) {
  sheet('Add an ingredient', `<div class="btncol plus-menu"><button class="ghost" id="pm-scan">${svg('barcode')}Scan a barcode</button>
    ${aiCan('food') ? `<button class="ghost" id="pm-label">${svg('camera')}Photo of the nutrition label</button>` : ''}
    <button class="ghost" id="pm-search">${svg('search')}Search the food database</button>
    <button class="ghost" id="pm-known">${svg('edit')}Manually add a food</button></div>`, (b, close) => {
    $('#pm-scan', b).onclick = () => { close(); scanSheet(null, null, (f) => foodToDish(d, f, set)); };
    const label = $('#pm-label', b); if (label) label.onclick = () => { close(); el._label(); };
    $('#pm-search', b).onclick = () => { close(); el._search && el._search(); };
    $('#pm-known', b).onclick = () => { close(); manualDishFood(d,set); };
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
function dishLogSheet(d, w, done, {chooseMeal=false}={}) {
  const owner=readOwner();
  if(d.totals.kcal==null){sheet(d.name,'<p>Add calories before logging a portion. Missing ingredients are kept unknown.</p><button class="primary wide" id="recipe-add-nutrition">Add nutrition</button>',(b,close)=>{$('#recipe-add-nutrition',b).onclick=()=>{close();done(true);go('/food/cook/'+d.id);};});return;}
  const t = d.totals, wt = d.weight_g, bySv = d.serving === 'one'||(d.mine===false&&!d.weight_g);     // by servings: the whole dish is one serving
  // Some recipes are measured by servings, some by weight; when both are known the person can log either (owner, 20 Oct 2026).
  const both = wt > 0 && (bySv || (d.serving_count || 0) > 1) && !d.recipe_source?.import_id;   // a default 1 'serving' would be the whole pot
  let mode = bySv ? 'sv' : 'g';
  const vals = (k) => Object.fromEntries(FOOD_NUTRIENTS.map((x) => [x, t[x]==null?null:t[x]*k]));
  sheet(d.name, `${d.mine===false?`<p class="small muted">Shared by ${esc(d.owner?.name||'your friend')}. Your food log stays private.</p>`:''}<form class="form" id="dl">
    ${chooseMeal?`<label>Meal today<select name="meal" required><option value="">Choose a meal</option>${Object.entries(MEAL_NAMES).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label>`:''}
    ${both ? `<div class="seg dl-mode" role="group" aria-label="Log by"><button type="button" data-mode="sv" aria-pressed="${bySv}">Servings</button><button type="button" data-mode="g" aria-pressed="${!bySv}">Grams</button></div>` : ''}
    ${bySv || both ? `<div id="dl-sv"${bySv ? '' : ' hidden'}><div class="stepper" role="group" aria-label="Servings"><button type="button" class="icon-btn" data-st="-1" aria-label="Fewer">${svg('minus')}</button>
        <span><input class="num" id="dl-n" name="count" inputmode="decimal" value="1" aria-label="Servings to log"><small id="dl-u">serving</small></span><button type="button" class="icon-btn" data-st="1" aria-label="More">${svg('plus')}</button></div></div>` : ''}
    ${wt ? `<div id="dl-g"${bySv ? ' hidden' : ''}><label>Your portion<span class="gfield"><input name="g" inputmode="decimal" placeholder="The whole meal is ${Math.round(wt)}" aria-label="Your portion in grams"><span>g</span></span></label></div>`
      : bySv ? '' : '<p class="callout warn">This meal is measured by weight but has no weight yet. Edit it and type its total weight, or switch it to servings.</p>'}
    ${d.mine===false&&d.serving!=='one'&&!wt?'<p class="small muted">No total weight has been added. Use servings instead.</p>':''}${bySv&&!d.recipe_source?.import_id?`<p class="small muted" id="dl-sv-note">The recipe makes ${esc(d.serving_count)} serving${d.serving_count==1?'':'s'}. Enter the number you ate.</p>`:''}${d.recipe_source?.import_id?`<p class="small muted">The whole recipe makes ${esc(d.serving_count)} servings. Unknown nutrition is shown as a dash.</p>`:''}<div class="portion-out" aria-live="polite"></div>
    <div class="actions">${d.mine !== false ? `<button type="button" class="ghost" id="dl-edit">${svg('edit')}Edit</button><span class="spacer"></span>` : ''}
      <button class="primary"${!bySv && !wt && !both ? ' disabled' : ''}>${chooseMeal?'Log portion':'Add to '+esc(MEAL_NAMES[w.meal])}${w.day !== isoDay(new Date()) ? `, ${esc(dayLabel(w.day))}` : ''}</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,owner);
    const f = $('#dl', b), out = $('.portion-out', f), num = x => {const v=x?.value?.trim()||'';const m=v.match(/^(\d*)([¼½¾])$/);return m?Number(m[1]||0)+({'¼':.25,'½':.5,'¾':.75}[m[2]]):Number(v.replace(',','.'));};
    const half=x=>{const whole=Math.floor(x),frac=Math.round((x-whole)*4);return frac?`${whole||''}${['','¼','½','¾'][frac]}`:String(whole);};
    const needsFraction=d.mine===false&&!wt&&!d.recipe_source?.import_id&&(d.serving_count||1)<=1;
    let n=needsFraction||chooseMeal?NaN:1;if(bySv&&(needsFraction||chooseMeal)){f.count.value='';f.count.placeholder=needsFraction?'e.g. 0.25':'How many?';if(needsFraction)f.count.setAttribute('aria-label','Fraction of the whole recipe');}
    const factor = () => (mode === 'sv' ? (Number.isFinite(n)&&n>0&&n<=20?n/(d.serving_count||1):null) : num(f.g) > 0 && wt ? num(f.g) / wt : null);
    const show = () => { const k = factor(); out.innerHTML = k ? nutGrid(vals(k))+extraFood(vals(k)) : '';$('button.primary',f).disabled=!k; };
    $$('[data-mode]', f).forEach((x) => x.onclick = () => {
      mode = x.dataset.mode; $$('[data-mode]', f).forEach((y) => y.setAttribute('aria-pressed', String(y === x)));
      // Carry the amount across: 1 serving of a 4-serving, 1,200 g recipe is 300 g.
      const k = mode === 'g' ? (Number.isFinite(n) && n > 0 ? n / (d.serving_count || 1) : null) : (num(f.g) > 0 ? num(f.g) / wt : null);
      if (k && mode === 'g') f.g.value = Math.round(wt * k);
      if (k && mode === 'sv') { n = Math.round(k * (d.serving_count || 1) * 4) / 4; f.count.value = half(n); $('#dl-u', f).textContent = n === 1 ? 'serving' : 'servings'; }
      $('#dl-sv', f).hidden = mode !== 'sv'; $('#dl-g', f).hidden = mode !== 'g'; const note = $('#dl-sv-note', f); if (note) note.hidden = mode !== 'sv'; show();
    });
    if (f.count) $$('[data-st]', f).forEach((x) => x.onclick = () => {
      n = Math.max(0.25, Math.min(20, (Number.isFinite(n)?n:1) + 0.25 * +x.dataset.st));
      $('#dl-n', f).value = half(n); $('#dl-u', f).textContent = n === 1 ? 'serving' : 'servings'; show();
    });
    if (f.g) f.g.oninput = show;
    if(f.count)f.count.oninput=()=>{n=num(f.count);$('#dl-u',f).textContent=n===1?'serving':'servings';show();};
    show();
    const ed = $('#dl-edit', b); if (ed) ed.onclick = () => { close(); done(true); go(`/food/cook/${d.id}`); };
    const portionId=newId();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f);if(btn.disabled)return;
      if(chooseMeal){if(!f.meal.value){toast('Which meal would you like to log it to?');f.meal.focus();return;}w={...w,meal:f.meal.value};}
      const body = {meal: w.meal, day: w.day, client_id:portionId};
      if (mode === 'sv') {if(!Number.isFinite(n)||n<=0||n>20){toast('Enter a serving count above zero and up to 20.');return;}body.count = n;}
      else { const g = num(f.g); if (!(g > 0)) { toast('How many grams did you have?'); return; } body.grams = g; }
      const label=btn.textContent;btn.disabled = true;btn.textContent='Saving portion…';
      try {
        if(typeof FoodThread!=='undefined'&&FoodThread.collecting()){
          const held=await FoodThread.stageDish(d.id,body);close();done(false);toast(held.queued?'Recipe portion saved for review on this phone':'Recipe portion added for review');return;
        }
        const r = await sendOrQueue(`/api/dishes/${d.id}/portion${location.pathname==='/food/describe'?'?thread=true&captured_at='+encodeURIComponent(new Date().toISOString()):''}`, 'POST', body, d.name);
        if(!r.queued&&r.messages&&typeof FoodThread!=='undefined'){try{await FoodThread.accept(r);}catch(e){invalidate('/api/food');}}
        if(readOwner()!==owner)return;
        if(r.queued){const factor=mode==='sv'?n/(d.serving_count||1):body.grams/wt,values=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,t[k]==null?null:t[k]*factor]));
          patchDay(w.day,day=>{if(day.entries.some(e=>e.id==='q-'+portionId))return;day.entries.push({...w,...values,id:'q-'+portionId,client_id:portionId,name:d.name,amount:mode==='sv'?n:body.grams,unit:mode==='sv'?'serving':'g',source:'dish',pending:true,ref:{dish_id:d.id,unknown_nutrients:Object.keys(values).filter(k=>values[k]==null)}});for(const k of Object.keys(values)){day.totals[k]=(day.totals[k]||0)+(values[k]||0);if(values[k]==null&&day.unknown_nutrients)day.unknown_nutrients[k]=(day.unknown_nutrients[k]||0)+1;}});
        }else invalidate('/api/food/');
        App.cache.delete('/api/dishes');close();done(false);if(location.pathname!=='/food/describe')render();Native.haptic('light');
        let undoing=false,undone=false;
        const undo=async()=>{if(undoing||undone||readOwner()!==owner)return;undoing=true;
          try{
            const removed=await sendOrQueue(`/api/dishes/${d.id}/portion/cancel`,'POST',{client_id:portionId},'Undo '+d.name);
            if(readOwner()!==owner)return;
            Q.save(Q.all().filter(op=>!(Q.owns(op)&&op.body?.client_id===portionId&&op.path.split('?')[0]===`/api/dishes/${d.id}/portion`)));netbar();
            patchDay(w.day,day=>{const found=day.entries.find(e=>e.id==='q-'+portionId);if(found){day.entries=day.entries.filter(e=>e!==found);for(const k of FOOD_NUTRIENTS){day.totals[k]=Math.max(0,(day.totals[k]||0)-(found[k]||0));if(found[k]==null&&day.unknown_nutrients)day.unknown_nutrients[k]=Math.max(0,(day.unknown_nutrients[k]||0)-1);}}});
            if(readOwner()!==owner)return;undone=true;if(removed.messages&&typeof FoodThread!=='undefined')await FoodThread.accept(removed);
            invalidate('/api/food');if(location.pathname!=='/food/describe')render();toast(removed.queued?'Undo saved on this phone · waiting to send':'Portion removed');
          }catch(x){if(readOwner()===owner)toast('Could not undo · try again',undo);}finally{undoing=false;}
        };
        toast(r.queued?'Portion saved on this phone · waiting to send':`Added ${d.name} to ${MEAL_NAMES[w.meal].toLowerCase()}: ${Math.round(r.entry.kcal/5)*5} kcal`,undo);
      } catch (x) { if(readOwner()===owner){if(d.mine===false&&x.status===404){invalidate('/api/dishes');close();done(false);toast('This recipe is no longer shared with you.');}else{toast(x.message);btn.disabled=false;btn.textContent=label;}} }
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
    [added, 'Say how it\'s measured', `Set the number of servings in the whole recipe, or enter its cooked weight and log grams. This recipe currently makes ${d.serving_count} servings.`],
    [false, 'Choose whether to log a portion', 'Tap Done to choose a meal today and the amount you ate, or save it for later. Reuse it from My Recipes any day.'],
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
function shareDishSheet(d,set){
  const owner=readOwner();
  sheet('Share with…',`<p>Only approved friends you choose can see this recipe and log their own portion. Your food log stays private.</p><div id="sd-list">${skel(1)}</div><button type="button" class="primary wide" id="sd-done">Done</button>`,async(b,close)=>{
    guardFoodSheet(b,close,owner);$('#sd-done',b).onclick=close;const box=$('#sd-list',b),valid=()=>box.isConnected&&owner===readOwner();let on=new Set((d.shared_with||[]).map(p=>p.login)),friends;
    try{friends=(await api('/api/friends')).friends;if(!valid())return;for(const person of d.shared_with||[])if(!friends.some(f=>f.login===person.login))friends.push(person);}catch(e){if(valid()){box.innerHTML=`<p class="err">${esc(e.message)}</p><button type="button" class="ghost" id="sd-retry">Retry friends</button>`;$('#sd-retry',b).onclick=()=>{close();shareDishSheet(d,set);};}return;}
    const draw=()=>{if(!valid())return;box.innerHTML=friends.length?`<div class="shared-friends">${friends.map(p=>`<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span><button type="button" class="ghost" data-sd="${esc(p.login)}" aria-label="${on.has(p.login)?'Stop sharing with':'Share with'} ${esc(p.name)}">${on.has(p.login)?'Stop sharing':'Share'}</button></div>`).join('')}</div>`:'<p>No approved friends yet. <a href="/me/friends">Add a friend</a>, then choose who sees this recipe.</p>';
      const add=box.querySelector('a[href="/me/friends"]');if(add)add.onclick=e=>{e.preventDefault();e.stopPropagation();close();go('/me/friends');};
      $$('[data-sd]',box).forEach(button=>button.onclick=async()=>{if(!valid()||button.disabled)return;const login=button.dataset.sd,was=on.has(login);button.disabled=true;button.textContent=was?'Stopping…':'Sharing…';try{const response=await api(`/api/dishes/${d.id}/share`+(was?'/'+encodeURIComponent(login):''),was?{method:'DELETE'}:json('POST',{login}));if(!valid())return;was?on.delete(login):on.add(login);invalidate('/api/dishes');d=was?{...d,shared_with:(d.shared_with||[]).filter(p=>p.login!==login)}:response;set(d);draw();Native.haptic('light');toast(was?'Stopped sharing this recipe':'Recipe shared. They can log their own portion.');}catch(e){if(valid()){toast(e.message);draw();}}});};draw();
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
  return `<div class="cchat" id="dk-chat" aria-live="polite">${first ? `<div class="cmsg ai">${aiCan('food') ? 'Tell me one ingredient and its amount, such as “100 g oats”. Check the nutrition before adding. Use + for search, a label photo or a barcode.' : 'Add one ingredient at a time: search below, choose a result, then check the amount. Use + for a barcode or to manually add a named food.'}</div>` : ''}
    ${log.slice(-8).map((m, k) => bubble(m, log.length - Math.min(log.length, 8) + k)).join('')}</div>`;
}
function chatBox(el, d, set) {
  const f = $('#dk-add', el), log = CHATS.get(d.id) || [];
  const owner=readOwner(),live=()=>el.isConnected&&owner===readOwner()&&$('#dk-add',el)===f;
  CHATS.set(d.id, log);
  const redraw = (fresh) => { if(!live())return;const v=f.t.value;set(fresh);const n=$('#dk-add input',el);if(n){n.value=v;n.focus();} };
  const send = async (text) => {
    if(!live())return;
    if(log.some(m=>m.wait)){toast('Wait for the current ingredient to finish.');return;}
    const me = {who: 'me', text}, wait = {who: 'ai', wait: true};
    log.push(me, wait); $('#dk-chat', el).outerHTML = chatLog(d); f.t.value = ''; $('#dk-match', el).innerHTML = '';
    let r;
    try { r = await api(`/api/dishes/${d.id}/say`, json('POST', {text,previous:log.filter(x=>x.clarification).at(-1)?.clarification||null})); }
    catch (x) {
      log.splice(log.indexOf(wait),1,{who:'ai',text:x.message});
      if(el.isConnected&&owner===readOwner()){const input=$('#dk-t',el);if(input&&!input.value)input.value=text;const chat=$('#dk-chat',el);if(chat)chat.outerHTML=chatLog(d);}
      redraw(d);return;
    }
    if(!live()){
      log.splice(log.indexOf(wait),1);
      // A measurement redraw may have replaced the form while the ingredient was saved.
      if(el.isConnected&&owner===readOwner())try{set(await api(`/api/dishes/${d.id}`));}catch(_){}
      return;
    }
    if (r.fallback) {          // nothing remembered and no AI: pick it from the food search
      log.splice(log.indexOf(me), 2); redraw(d);
      searchFlow(el, d, set, r.query||text);
      if (r.needs_ok && !App.me.ai_ok) aiSheet(() => {if(!el.isConnected||owner!==readOwner())return;$('#dk-match',el).innerHTML='';const next=$('#dk-add',el);next.t.value=text;next.requestSubmit();});
      return;
    }
    for(const row of log)delete row.clarification;
    log.splice(log.indexOf(wait), 1, {who: 'ai', text: r.reply, added: r.added,clarification:r.clarification});
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
  const my=++searchSeq,owner=readOwner();let busy=false;
  const live=()=>my===searchSeq&&owner===readOwner()&&el.isConnected&&$('#dk-match',el)===box;
  const show=html=>{box.innerHTML=html+'<button type="button" class="linkbtn" id="dk-cancel-match">Cancel ingredient</button>';$('#dk-cancel-match',box).onclick=()=>{if(busy)return;searchSeq++;box.replaceChildren();$('#dk-t',el)?.focus();};};
  show('<p class="small muted">Looking it up…</p>');
  box.scrollIntoView({block:'nearest'});
  let p; try { p = await api('/api/dishes/parse', json('POST', {text})); } catch (x) { if(live())show(`<p class="err">${esc(x.message)}</p>`); return; }
  if (!live()) return;
  const q = p.search || p.query || text, g0 = p.grams || p.guess_g;
  show(`<div class="match"><label>${esc(q)}${p.guess_g && !p.grams ? `<small class="muted">Usually about ${gfmt(p.guess_g)}: change it if you weighed it</small>` : ''}<span class="gfield"><input name="mg" inputmode="decimal" value="${g0 ? Math.round(g0 * 10) / 10 : ''}"
      placeholder="${p.amount ? `${esc(p.amount)} ${esc(p.unit || '')} in grams?` : 'Grams'}" aria-label="How many grams"><span>g</span></span></label>
    <div class="mres" aria-live="polite"><p class="small muted">Searching…</p></div>
    <button type="button" class="linkbtn" id="dk-type">Type the calories instead</button></div>`);
  box.scrollIntoView({block:'nearest'});
  const gIn = $('[name=mg]', box), res = $('.mres', box);
  const grams = () => { const g = +gIn.value.replace(',', '.'); if (!(g > 0)) { toast('How many grams? Type the weight first'); gIn.focus(); return null; } return g; };
  const add = async (body) => {
    if (busy||!live()) return false; busy = true;$('#dk-cancel-match',box).disabled=true;
    try { const fresh = await api(`/api/dishes/${d.id}/items`, json('POST', body)); if(!live())return false;for(const m of CHATS.get(d.id)||[])delete m.clarification;toast(`Added ${body.name}`); set(fresh); const n = $('#dk-add input',el); if (n) n.focus(); return true; }
    catch (x) { toast(x.message); return false; }
    finally { busy = false;if(live())$('#dk-cancel-match',box).disabled=false; }
  };
  $('#dk-type', box).onclick = () => typeSheet(q, gIn.value, add);
  if (!g0) gIn.focus();
  const foods = [];
  const draw = (groups) => {
    if(!live())return;
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
    const local = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=mine`); if (!live()) return;
    const recent = local.recent.filter((r) => r.unit === 'g' && r.amount > 0).map((r) => ({name: r.name, brand: r.brand, source: r.source,
      per100: Object.fromEntries(FOOD_NUTRIENTS.map((k) => [k, r[k] == null ? null : r[k] / r.amount * 100]))}));
    draw([['Yours', local.mine.concat(recent)]]);
    const ext = await api(`/api/food/search?q=${encodeURIComponent(q)}&sources=usda,off`); if (!live()) return;
    draw([['Yours', local.mine.concat(recent)], ['USDA', ext.usda], ['Open Food Facts', ext.off]]);
  } catch (x) { if (live()) res.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
}
function typeSheet(name, grams, done) {
  sheet('Manually add a food', `<form class="form" id="ty"><label>Food name<input name="name" value="${esc(name)}" maxlength="120" required></label>
    <div class="two"><label>Weight (g)<input name="grams" inputmode="decimal" value="${esc(grams)}" placeholder="Optional"></label><label>Calories<input name="kcal" inputmode="decimal" required></label></div>
    <div class="two"><label>Protein (g)<input name="protein_g" inputmode="decimal"></label><label>Carbs (g)<input name="carbs_g" inputmode="decimal"></label></div>
    <div class="two"><label>Fat (g)<input name="fat_g" inputmode="decimal"></label><label>Fiber (g)<input name="fiber_g" inputmode="decimal"></label></div>
    ${extraInputs()}<p class="small muted">Nutrition for the amount you are adding. Weight is optional; unknown nutrients stay blank.</p>
    <p class="err" id="ty-error" role="alert"></p><div class="actions"><button class="primary">Add</button></div></form>`, (b, close) => {
    guardFoodSheet(b,close,readOwner());const f = $('#ty', b); (name.trim()?f.kcal:f.elements.name).focus();
    f.onsubmit = async (e) => {   // stays open if the server says no, so the numbers aren't lost
      e.preventDefault(); const n = (v) => (v.trim() === '' ? null : +v.replace(',', '.')), btn = $('button.primary', f);
      btn.disabled = true;
      $('#ty-error',b).textContent='';
      try {
        const values={name:f.elements.name.value.trim(),grams:n(f.grams.value),kcal:n(f.kcal.value),protein_g:n(f.protein_g.value),carbs_g:n(f.carbs_g.value),fat_g:n(f.fat_g.value),fiber_g:n(f.fiber_g.value),...extraFormValues(f)};
        if(values.kcal===null)throw Object.assign(Error('Enter the calories for this amount of food.'),{field:'kcal'});
        if(!values.name)throw Object.assign(Error('Give this food a name.'),{field:'name'});
        const limits={grams:30000,kcal:20000,protein_g:2000,carbs_g:2000,fat_g:2000,fiber_g:1000,sodium_mg:1000000,sugar_g:2000,saturated_fat_g:2000};
        for(const [key,limit] of Object.entries(limits)){
          const value=values[key];if(value==null)continue;
          if(!Number.isFinite(value)||value<0||value>limit||(key==='grams'&&value===0))throw Object.assign(Error(key==='grams'?'Enter a weight above zero and up to 30,000 g, or leave it blank.':'Enter a number from 0 to '+limit.toLocaleString()+' for this amount of food.'),{field:key});
        }
        if (await done(values)) close();else btn.disabled=false;
      } catch (error) {
        $('#ty-error',b).textContent=error.message;btn.disabled=false;
        const field=f.elements[error.field];if(field){field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby','ty-error');field.oninput=()=>field.removeAttribute('aria-invalid');field.focus();}
      }
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
    <button class="ghost danger" id="dm-del">${svg('trash')}Delete recipe</button></div>
    <p class="small muted">What you've logged from it stays in your food log.</p>`, (b, close) => {
    $('#dm-search', b).onclick = () => { close(); search(); };
    $('#dm-known', b).onclick = () => { close(); known(); };
    $('#dm-del', b).onclick = () => { close(); deleteRecipe(d); };
  });
}

// Keep deletion separate from ingredient removal and preserve the person's logged portions.
function deleteRecipe(d) {
  const owner=readOwner();
  sheet('Delete recipe?',`<p>Delete <b>${esc(d.name)}</b> from My Recipes? Friends you shared it with will lose access.</p><p>Portions already logged stay in each person’s food log.</p><p class="small danger" id="recipe-delete-error" role="alert" hidden></p><div class="actions"><button type="button" class="ghost" id="recipe-delete-cancel">Cancel</button><button type="button" class="primary danger" id="recipe-delete-confirm">Delete recipe</button></div>`,(b,close)=>{
    guardFoodSheet(b,close,owner);
    const cancel=$('#recipe-delete-cancel',b),button=$('#recipe-delete-confirm',b),error=$('#recipe-delete-error',b);
    cancel.onclick=close;
    button.onclick=async()=>{
      if(button.disabled||!b.isConnected||readOwner()!==owner)return;
      button.disabled=cancel.disabled=true;error.hidden=true;
      try {
        await api(`/api/dishes/${d.id}`,{method:'DELETE'});
        if(!b.isConnected||readOwner()!==owner)return;
        App.cache.delete('/api/dishes');App.cache.delete(`/api/dishes/${d.id}`);close();go('/food/meals',{replace:true});toast('Recipe deleted');
      } catch(x) {
        if(!b.isConnected||readOwner()!==owner)return;
        // A lost acknowledgement is safe to retry: a missing recipe has already been deleted.
        if(x.status===404){App.cache.delete('/api/dishes');App.cache.delete(`/api/dishes/${d.id}`);close();go('/food/meals',{replace:true});toast('Recipe deleted');return;}
        error.textContent=x.message;error.hidden=false;button.disabled=cancel.disabled=false;
      }
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
  return `<div class="card recipe-source"><p class="small">Makes ${esc(d.serving_count)} servings · ${d.totals.kcal==null?'Calories unknown':`${Math.round(d.totals.kcal/5)*5} kcal in the whole recipe`}</p>${s.source_url?`<a class="linkbtn" href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">Original recipe</a>`:'<p class="small muted">From a recipe screenshot · Kit’s estimates</p>'}<p class="small muted">${esc([...new Set(Object.values(s.sources||{}).map(k=>labels[k]||'Unknown'))].join(' · '))}${s.edited?' · Edited':''}</p>${s.site_recipe_changed?'<p class="small muted">Published values describe the site’s original recipe; ingredients were edited.</p>':''}${s.pending?.length?`<details><summary>Unmatched ingredients (${s.pending.length})</summary>${s.pending.map(t=>`<p>${esc(t)}${d.mine!==false?` <button class="linkbtn" data-dismiss-pending="${esc(t)}">Leave this line out</button>`:''}</p>`).join('')}</details>`:''}</div>`;
}
