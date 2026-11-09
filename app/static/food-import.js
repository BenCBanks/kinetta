// ---------- Add past days (2026-10-09): paste / CSV / one day -> preview -> save ----------
route(/^\/food\/import$/, 'food', async (el) => {
  if(Native.on)return go('/food',{replace:true});
  const lb = imp(), wu = lb ? 'lb' : 'kg', today = isoDay(new Date());
  const wshow = (kg) => (kg == null ? '–' : (lb ? kg * 2.20462 : kg).toFixed(1));
  el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><h1>Add past days</h1>
    <p class="muted">Bring in weight and calories from another app.</p>
    <div class="card"><div class="actions import-file-actions"><button type="button" class="ghost" id="hi-pick">${svg('upload')}Choose a file</button><button type="button" class="ghost" id="hi-paste">Paste rows</button></div><details><summary>Format help</summary>
      <p class="small muted">First row = column names. Recognized: <b>Date</b>, <b>Weight</b> (${wu} unless the column says kg/lb), <b>Calories</b>, <b>Protein</b>, <b>Carbs</b>, <b>Fat</b>, <b>Fiber</b>, <b>Burned</b> (or Expenditure/TDEE), <b>Deficit</b>. Any order; other columns are ignored. Several rows per day (e.g. one per meal) are added up.</p>
      <pre class="eg">Date,Weight,Calories,Protein,Carbs,Fat,Deficit
2026-03-01,152.4,1650,110,160,55,450
2026-03-02,152.0,1720,115,170,58,380</pre><p class="small muted">Imported burned numbers replace the app’s estimate for those days.</p></details>
      <form class="form" id="hi-f"><label>Paste rows (copy them from Excel, Google Sheets or Numbers)<textarea name="text" rows="6" placeholder="Date, Weight, Calories, ..."></textarea></label>
        <input type="file" id="hi-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden>
        <button class="primary wide">Preview</button></form>
      <div id="hi-prev"></div></div>
    <div class="card"><h2>Enter day by day</h2>
      <p class="small muted">Type what you have for each day; leave the rest blank. Burned fills itself in from Eaten + Deficit. Clearing a box and saving removes that imported number.</p>
      <div class="gridbar"><label>From<input type="date" id="hg-start" max="${today}"></label><label class="gtog"><input type="checkbox" id="hg-mac"> Show macros <span aria-hidden="true">↔</span></label></div>
      <div id="hg"></div></div>
    <div id="hi-sum"></div>`;
  wireBack(el, '/food?view=overview');
  const f = $('#hi-f', el), box = $('#hi-prev', el), file = $('#hi-file', el);
  $('#hi-pick', el).onclick = () => file.click();
  $('#hi-paste',el).onclick=()=>f.text.focus();
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
      <div class="tblwrap"><table class="tbl yrs"><thead><tr><th>Date</th><th class="r">Weight ${wu}</th><th class="r">Eaten kcal</th><th class="r">P g</th><th class="r">C g</th><th class="r">F g</th><th class="r">Burned kcal</th><th class="r">Deficit kcal</th></tr></thead><tbody>
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
    gbox.innerHTML = `${m?'<p class="small muted">Scroll sideways for all macros. Dates stay visible.</p>':''}<div class="hgrid${m ? ' macros' : ''}" tabindex="0" role="region" aria-label="Food and weight history; scroll sideways for more columns"><div class="hrow hhead"><span>Day</span><span>Weight ${wu}</span><span>Eaten kcal</span><span>Burned kcal</span><span>Deficit kcal</span>${m ? '<span>P g</span><span>C g</span><span>F g</span>' : ''}</div>
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
    if (del) del.onclick = async () => { if (!await confirmSheet('Remove imported data?', {body: 'Imported food, calorie and weight data will be removed. Food and weights you logged in Kinetta stay.', action: 'Remove'})) return;
      try { const r = await api('/api/food/history', {method: 'DELETE'}); invalidate('/api/food'); toast(`Removed ${r.weights} weigh-ins, ${r.days_food} days of food and ${r.burned} days of activity calories`); drawSum(); } catch (x) { toast(x.message); } };
  }, {maxAge: 0});
  drawSum();
});
