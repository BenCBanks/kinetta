// Kinetta phone app — lifting (2026-10-13): log a strength session set by set, with what you did last time beside every
// set, and look back at any exercise later (records, a chart, every session). Weights are kg on the server; lb or kg here.
'use strict';

const LB = 2.20462262;
const wUnit = () => (imp() ? 'lb' : 'kg');
const toW = (kg) => (kg == null ? '' : String(Math.round((imp() ? kg * LB : kg) * 10) / 10));       // kg -> the number shown
const fromW = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x >= 0 ? (imp() ? x / LB : x) : null; };
const KINDS = [['weight', 'Weight × reps'], ['body', 'Bodyweight reps'], ['time', 'Timed hold']];
// a bodyweight exercise (push-ups, pull-ups) is just reps; it gets a weight box only once it has weight on it (a vest or a
// belt), from its ••• menu, or when last time had some (2026-10-13, Ben: an LB box made no sense for push-ups)
const hasWeight = (e) => e.kind === 'weight' || (e.kind === 'body' && (e.addWeight || e.sets.some((s) => s.kg) || !!(e.last && e.last.sets.some((s) => s.kg))));
const PR_NAMES = {heaviest: 'Heaviest', e1rm: 'Best 1RM', reps: 'Most reps', secs: 'Longest'};

// "3 × 8 @ 135 lb", or "135 × 8, 145 × 6" when the sets differ; warm-ups and planned sets left out
function setsText(sets, kind) {
  const real = (sets || []).filter((s) => s.done !== false && !s.warmup);
  if (!real.length) return '';
  const one = (s) => (kind === 'time' || (s.secs && !s.reps) ? `${s.secs || 0} s` : kind === 'body' && !s.kg ? `${s.reps || 0}`
    : `${toW(s.kg) || 0} × ${s.reps || 0}`) + (kind === 'body' && s.kg ? ` +${toW(s.kg)}` : '');
  const all = real.map(one);
  if (all.every((x) => x === all[0])) {
    const s = real[0];
    if (kind === 'time') return `${real.length} × ${s.secs || 0} s`;
    if (kind === 'body') return `${real.length} × ${s.reps || 0}${s.kg ? ` +${toW(s.kg)} ${wUnit()}` : ''}`;
    return `${real.length} × ${s.reps || 0} @ ${toW(s.kg) || 0} ${wUnit()}`;
  }
  return all.join(', ') + (kind === 'weight' || real.some((s) => s.kg) ? ` ${wUnit()}` : kind === 'time' ? '' : ' reps');
}
const shortDay = (iso) => fdate(iso, {month: 'short', day: 'numeric', ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? {year: 'numeric'} : {})});
const volText = (kg) => (kg ? `${Math.round(imp() ? kg * LB : kg).toLocaleString()} ${wUnit()}` : '');

// ---------- start a session ----------
// The + on Today and Activity offers this first; a session already running is carried on instead of a new one.
function startLiftSheet() {
  sheet('Start lifting', `<div id="sl-body">${skel(1)}</div>`, async (b, close) => {
    let recent = [];
    try {   // one row per routine: the latest session of each name
      const seen = new Set();
      recent = (await api('/api/lifts/sessions?limit=30')).filter((s) => s.exercises && s.exercises.length && !s.lift_open && !seen.has(s.name) && seen.add(s.name)).slice(0, 5);
    } catch (e) { /* offline: an empty one still works */ }
    $('#sl-body', b).innerHTML = `<button class="primary wide" id="sl-new">${svg('workout')}Start an empty session</button>
      ${recent.length ? `<h3 class="ghead">Or repeat one</h3><p class="small muted sl-hint">Its exercises and weights come along. Tick each set as you do it.</p>
      <div class="pick-list">${recent.map((s) => `<button type="button" class="row-link" data-copy="${s.id}"><span class="grow"><span>${esc(s.name)}</span>
        <small class="muted">${esc(shortDay(s.start_time))} · ${esc(s.exercises.slice(0, 3).join(', '))}${s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : ''}</small></span><span class="chev">${svg('chev')}</span></button>`).join('')}</div>` : ''}
      <button class="ghost wide" id="sl-past">Log one you did earlier</button>`;
    const begin = async (btn, copy) => {
      btn.disabled = true;
      try { const r = await api('/api/lifts/start', json('POST', copy ? {copy_from: +copy} : {})); invalidate('/api/'); close(); go(`/lift/${r.id}`); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
    $('#sl-new', b).onclick = (e) => begin(e.currentTarget);
    $$('[data-copy]', b).forEach((x) => x.onclick = () => begin(x, x.dataset.copy));
    $('#sl-past', b).onclick = () => { close(); addActivitySheet(null, 'workout'); };
  });
}
// what the + buttons open (pages.js): lifting, or any other activity typed in by hand
function addActivityMenu(day) {
  if (day) return addActivitySheet(day);
  pickSheet('Add', `<div class="pick-list">
    <button type="button" class="row-link" data-pk="lift"><span class="ri c-berry">${svg('workout')}</span><span class="grow"><span>Start lifting</span><small class="muted">Log sets as you go, with last time beside each one</small></span></button>
    <button type="button" class="row-link" data-pk="hand"><span class="ri c-blue">${svg('plus')}</span><span class="grow"><span>Add an activity by hand</span><small class="muted">A class, a treadmill run, anything without a file</small></span></button>
    <button type="button" class="row-link" data-pk="upload"><span class="ri c-ink">${svg('upload')}</span><span class="grow"><span>Upload files</span><small class="muted">FIT, GPX, TCX or your Strava export</small></span></button></div>`,
  (k) => (k === 'lift' ? startLiftSheet() : k === 'hand' ? addActivitySheet() : go('/me/import')));
}

// ---------- the logger ----------
// The whole session lives here and goes to the server after each change (a moment later, as one PUT, so a resend never
// doubles anything). Until the server has it, a copy is kept on the phone: a gym with no signal loses nothing.
route(/^\/lift\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Activity')}</div>${skel(2)}`;
  wireBack(el, `/activity/${id}`);
  const key = 'fit.lift:' + id;
  let data;
  try { data = await api(`/api/activities/${id}/lifts`); }
  catch (e) { const k = store.get(key); if (!k) return showError(el, e); data = k.data; }
  const draft = store.get(key);
  if (draft && draft.unsent) data = {...data, exercises: draft.data.exercises};
  liftLogger(el, +id, data);
});

function liftLogger(el, aid, data) {
  const key = 'fit.lift:' + aid;
  const S = {ex: data.exercises.map((e) => ({...e, sets: e.sets.map((s) => ({...s}))})), open: data.open, start: data.start_time, lastTick: null};
  let saveT = null, saving = false, again = false, gone = false;
  el.innerHTML = `<div class="top">${backBtn('Activity')}<div class="acts"><span class="lift-save small muted" id="lf-save" aria-live="polite"></span>
      ${S.open ? '<button class="primary sm" id="lf-finish">Finish</button>' : '<button class="primary sm" id="lf-done">Done</button>'}</div></div>
    ${S.open ? `<div class="lift-clock card"><div><small>Session</small><b class="num" id="lf-time">0:00</b></div><div><small>Since last set</small><b class="num" id="lf-rest">–</b></div></div>` : ''}
    <div id="lf-list"></div>
    <button class="primary wide lift-add" id="lf-add">${svg('plus')}Add exercise</button>
    <p class="small muted center lift-foot">${S.open ? 'Ticked sets count. Untick or leave a set blank to skip it.' : 'Changes save as you go.'}</p>`;
  wireBack(el, `/activity/${aid}`);
  const list = $('#lf-list', el);

  // clock: the session's time and the time since the last ticked set (a rest timer that needs no setting up)
  if (S.open) {
    const t0 = new Date(S.start).getTime(), tick = () => {
      if (!el.isConnected) { clearInterval(iv); return; }
      $('#lf-time', el).textContent = dur(Math.max(0, (Date.now() - t0) / 1000));
      $('#lf-rest', el).textContent = S.lastTick ? dur((Date.now() - S.lastTick) / 1000) : '–';
    };
    const iv = setInterval(tick, 1000); tick();
  }

  const body = () => ({exercises: S.ex.map((e) => ({exercise_id: e.exercise_id, sets: e.sets.map((s) => ({reps: s.reps ?? null, kg: s.kg ?? null, secs: s.secs ?? null, warmup: !!s.warmup, done: !!s.done}))}))});
  const status = (t) => { const s = $('#lf-save', el); if (s) s.textContent = t; };
  async function save(finish = false) {
    clearTimeout(saveT); saveT = null;
    store.set(key, {unsent: true, data: {exercises: S.ex}});
    if (saving) { again = true; return; }
    saving = true; status('Saving…');
    try {
      const r = await api(`/api/activities/${aid}/lifts`, json('PUT', {...body(), finish}));
      store.set(key, {unsent: false, data: r});
      invalidate(`/api/activities/${aid}`); invalidate('/api/activities?'); invalidate('/api/lifts'); App.cache.delete('feed:home');
      // records and last time come back from the server: shown without disturbing what's being typed
      r.exercises.forEach((e, i) => { const mine = S.ex[i]; if (mine && mine.exercise_id === e.exercise_id) { mine.last = e.last; mine.sessions_before = e.sessions_before;
        mine.sets.forEach((s, j) => { s.pr = (e.sets[j] || {}).pr; }); } });
      if (!again) { status('Saved'); marks(); }
      return r;
    } catch (x) {
      status(x.offline ? 'Kept on this phone' : 'Not saved');
      if (!x.offline) toast(x.message);
      if (finish) throw x;
    } finally {
      saving = false;
      if (again) { again = false; save(); }
    }
  }
  const later = () => { status(''); clearTimeout(saveT); saveT = setTimeout(save, 700); store.set(key, {unsent: true, data: {exercises: S.ex}}); };
  // leaving the page (or the app going to the background) sends what's waiting at once
  const flush = () => { if (saveT && !gone) save(); };
  addEventListener('pagehide', flush); document.addEventListener('visibilitychange', flush);
  addEventListener('popstate', () => { flush(); gone = true; }, {once: true});

  function draw() {
    list.innerHTML = S.ex.length ? S.ex.map(exCard).join('') : `<div class="card empty"><b>No exercises yet</b>Add the first one: what you did last time shows beside every set.</div>`;
    wire();
  }
  function exCard(e, i) {
    const last = e.last ? `<p class="lift-last"><span class="muted">Last time</span> <span class="num">${esc(setsText(e.last.sets, e.kind)) || '–'}</span> <span class="muted">· ${esc(shortDay(e.last.start_time))}</span></p>`
      : `<p class="lift-last muted">${e.sessions_before ? '' : 'First time - it shows here next time'}</p>`;
    const head = e.kind === 'time' ? ['Seconds'] : !hasWeight(e) ? ['Reps'] : e.kind === 'body' ? [`+${wUnit()}`, 'Reps'] : [wUnit(), 'Reps'];
    return `<section class="card lift-ex" data-i="${i}"><div class="lift-hd"><a class="lift-name" href="/lift/ex/${e.exercise_id}">${esc(e.name)}</a>
        <button class="icon-btn" data-exmenu aria-label="More for ${esc(e.name)}">${svg('more')}</button></div>
      ${e.note ? `<p class="lift-note small">${esc(e.note)}</p>` : ''}${last}
      <div class="lift-grid k-${esc(e.kind === 'time' || !hasWeight(e) ? 'one' : 'two')}" role="group" aria-label="${esc(e.name)} sets"><span class="lh">Set</span>${head.map((h) => `<span class="lh">${esc(h)}</span>`).join('')}<span class="lh lh-tick">Done</span>
        ${e.sets.map((s, j) => setRow(e, s, j)).join('')}</div>
      <button class="ghost wide lift-addset" data-addset>${svg('plus')}Add set</button></section>`;
  }
  function setRow(e, s, j) {
    const prev = e.last && e.last.sets.filter((x) => !x.warmup)[j - e.sets.slice(0, j).filter((x) => x.warmup).length];   // last time's set at this place
    const ph = (k) => (prev && prev[k] != null ? (k === 'kg' ? toW(prev[k]) : prev[k]) : '');
    const v = (k) => (s[k] == null ? '' : k === 'kg' ? toW(s[k]) : s[k]);
    const num = (k, mode, label) => `<input class="lift-in" data-k="${k}" inputmode="${mode}" enterkeyhint="next" autocomplete="off" value="${esc(v(k))}" placeholder="${esc(ph(k))}" aria-label="Set ${j + 1} ${label}">`;
    const cells = e.kind === 'time' ? num('secs', 'numeric', 'seconds') : (hasWeight(e) ? num('kg', 'decimal', e.kind === 'body' ? `added ${wUnit()}` : wUnit()) : '') + num('reps', 'numeric', 'reps');
    const pr = (s.pr || []).map((k) => PR_NAMES[k]).join(', ');
    return `<button type="button" class="lift-n${s.warmup ? ' wu' : ''}" data-set="${j}" aria-label="Set ${j + 1}${s.warmup ? ', warm-up' : ''}: options">${s.warmup ? 'W' : j + 1 - e.sets.slice(0, j).filter((x) => x.warmup).length}</button>
      ${cells.replace(/<input /g, `<input data-j="${j}" `)}<button type="button" class="lift-tick" data-tick="${j}" aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">${svg('check')}</button>
      ${pr ? `<span class="lift-pr" data-pr="${j}">${svg('trophy')} New record: ${esc(pr)}</span>` : ''}`;
  }
  // records and last time, after a save, without redrawing the inputs
  function marks() {
    S.ex.forEach((e, i) => {
      const card = $(`.lift-ex[data-i="${i}"]`, list); if (!card) return;
      $$('.lift-pr', card).forEach((x) => x.remove());
      e.sets.forEach((s, j) => {
        if (!(s.pr || []).length) return;
        const t = $(`[data-tick="${j}"]`, card);
        t.insertAdjacentHTML('afterend', `<span class="lift-pr" data-pr="${j}">${svg('trophy')} New record: ${esc(s.pr.map((k) => PR_NAMES[k]).join(', '))}</span>`);
      });
    });
  }
  function wire() {
    $$('.lift-ex', list).forEach((card) => {
      const i = +card.dataset.i, e = S.ex[i];
      $$('.lift-in', card).forEach((inp) => {
        inp.oninput = () => {
          const s = e.sets[+inp.dataset.j], k = inp.dataset.k, t = inp.value.trim();
          s[k] = t === '' ? null : k === 'kg' ? fromW(t) : Math.max(0, Math.round(parseFloat(t) || 0));
          later();
        };
        inp.onfocus = () => inp.select();
      });
      $$('[data-tick]', card).forEach((b) => b.onclick = () => {
        const j = +b.dataset.tick, s = e.sets[j], on = !s.done;
        if (on) {   // a blank box takes last time's number (the grey one) when the set is ticked
          for (const inp of $$(`.lift-in[data-j="${j}"]`, card)) if (inp.value.trim() === '' && inp.placeholder) { inp.value = inp.placeholder; inp.oninput(); }
          if (e.kind === 'time' ? !s.secs : !s.reps) { toast(e.kind === 'time' ? 'Type the seconds first' : 'Type the reps first'); $(`.lift-in[data-j="${j}"][data-k="${e.kind === 'time' ? 'secs' : 'reps'}"]`, card).focus(); return; }
          S.lastTick = Date.now();
        }
        s.done = on; b.setAttribute('aria-pressed', String(on)); save();
      });
      $('[data-addset]', card).onclick = () => {
        const prev = e.sets[e.sets.length - 1];
        e.sets.push(prev ? {reps: prev.reps, kg: prev.kg, secs: prev.secs, warmup: false, done: !S.open} : {reps: null, kg: null, secs: null, warmup: false, done: false});
        draw(); later();
        const row = $$(`.lift-ex[data-i="${i}"] .lift-in[data-j="${e.sets.length - 1}"]`, list)[0]; if (row) row.focus({preventScroll: true});
      };
      $$('[data-set]', card).forEach((b) => b.onclick = () => setMenu(e, +b.dataset.set));
      $('[data-exmenu]', card).onclick = () => exMenu(i);
    });
  }
  function setMenu(e, j) {
    const s = e.sets[j];
    pickSheet(`${e.name}: set ${j + 1}`, `<div class="pick-list">
      <button type="button" class="row-link" data-pk="wu"><span class="grow"><span>${s.warmup ? 'Not a warm-up' : 'Mark as warm-up'}</span><small class="muted">Warm-ups never count towards records</small></span></button>
      <button type="button" class="row-link" data-pk="dup"><span class="grow"><span>Copy this set below</span></span></button>
      <button type="button" class="row-link danger" data-pk="del"><span class="grow"><span>Delete this set</span></span></button></div>`, (k) => {
      if (k === 'wu') s.warmup = !s.warmup;
      if (k === 'dup') e.sets.splice(j + 1, 0, {...s, done: false, pr: null});
      if (k === 'del') e.sets.splice(j, 1);
      draw(); save();
    });
  }
  function exMenu(i) {
    const e = S.ex[i];
    pickSheet(e.name, `<div class="pick-list">
      <button type="button" class="row-link" data-pk="note"><span class="grow"><span>${e.note ? 'Edit note' : 'Add a note for next time'}</span><small class="muted">${e.note ? esc(e.note) : 'e.g. seat on 4, narrow grip'}</small></span></button>
      ${e.kind === 'body' ? (hasWeight(e) ? '<button type="button" class="row-link" data-pk="nowt"><span class="grow"><span>No added weight</span><small class="muted">Back to reps only</small></span></button>'
        : '<button type="button" class="row-link" data-pk="wt"><span class="grow"><span>Add weight</span><small class="muted">A weighted vest or a dip belt</small></span></button>') : ''}
      <button type="button" class="row-link" data-pk="hist"><span class="grow"><span>History and records</span></span></button>
      ${i > 0 ? '<button type="button" class="row-link" data-pk="up"><span class="grow"><span>Move up</span></span></button>' : ''}
      ${i < S.ex.length - 1 ? '<button type="button" class="row-link" data-pk="down"><span class="grow"><span>Move down</span></span></button>' : ''}
      <button type="button" class="row-link danger" data-pk="del"><span class="grow"><span>Remove from this session</span></span></button></div>`, (k) => {
      if (k === 'hist') { flush(); return go(`/lift/ex/${e.exercise_id}`); }
      if (k === 'note') return noteSheet(e, () => { draw(); });
      if (k === 'wt') { e.addWeight = true; return draw(); }
      if (k === 'nowt') { e.addWeight = false; e.sets.forEach((s) => { s.kg = null; }); }
      if (k === 'up' || k === 'down') { const t = k === 'up' ? i - 1 : i + 1; [S.ex[i], S.ex[t]] = [S.ex[t], S.ex[i]]; }
      if (k === 'del') {
        const gone = S.ex.splice(i, 1)[0];
        toast(`${gone.name} removed`, () => { S.ex.splice(i, 0, gone); draw(); save(); });
      }
      draw(); save();
    });
  }
  $('#lf-add', el).onclick = () => exercisePicker(S.ex.map((e) => e.exercise_id), async (ex) => {
    // a new exercise starts from last time: the same sets, waiting to be ticked
    let last = null, before = 0;
    try { const h = await api(`/api/lifts/exercises/${ex.id}`); last = h.sessions[0] || null; before = h.sessions.length; } catch (x) { /* offline: start blank */ }
    // (a session logged afterwards: last time's sets count as done straight away - change what was different)
    const sets = last ? last.sets.map((s) => ({reps: s.reps, kg: s.kg, secs: s.secs, warmup: s.warmup, done: !S.open})) : [{reps: null, kg: null, secs: null, warmup: false, done: false}];
    S.ex.push({exercise_id: ex.id, name: ex.name, kind: ex.kind, muscle: ex.muscle, note: ex.note, last, sessions_before: before, sets});
    draw(); save();
    const card = $$('.lift-ex', list).at(-1); if (card) card.scrollIntoView({behavior: 'smooth', block: 'center'});
  });
  const fin = $('#lf-finish', el) || $('#lf-done', el);
  fin.onclick = async () => {
    const open = S.ex.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const finish = async () => {
      fin.disabled = true;
      // planned sets nobody ticked are left out: they never happened
      if (S.open) S.ex.forEach((e) => { e.sets = e.sets.filter((s) => s.done); });
      S.ex = S.ex.filter((e) => e.sets.length || !S.open);
      try { await save(true); store.del(key); gone = true; go(`/activity/${aid}`, {replace: true}); toast(S.open ? 'Session saved' : 'Saved'); }
      catch (x) { fin.disabled = false; toast(x.offline ? "Can't reach Kinetta - your sets are kept on this phone. Try again when you're back online." : x.message); }
    };
    if (S.open && open) sheet('Finish the session?', `<p>${open} set${open > 1 ? 's are' : ' is'} not ticked off. ${open > 1 ? "They're" : "It's"} left out of the session.</p>
      <div class="btnrow"><button class="ghost" data-close>Keep going</button><button class="primary" id="ff-yes">Finish</button></div>`, (b, close) => { $('#ff-yes', b).onclick = () => { close(); finish(); }; });
    else finish();
  };
  draw();
  if (store.get(key) && store.get(key).unsent) save();     // a copy from earlier that never reached the server
}

function noteSheet(e, after) {
  sheet('Note for next time', `<form class="form" id="nt"><textarea name="note" maxlength="500" rows="3" placeholder="e.g. seat on 4, narrow grip">${esc(e.note || '')}</textarea>
    <p class="small muted">Shown under ${esc(e.name)} every time you log it.</p><div class="actions"><button class="primary">Save note</button></div></form>`, (b, close) => {
    $('#nt', b).onsubmit = async (ev) => {
      ev.preventDefault(); const note = $('textarea', b).value.trim();
      try { await api(`/api/lifts/exercises/${e.exercise_id || e.id}`, json('PATCH', {note})); e.note = note || null; invalidate('/api/lifts'); close(); after(); }
      catch (x) { toast(x.message); }
    };
  });
}

// ---------- choosing an exercise ----------
// Yours first (most recent), then the common ones by muscle group; typing filters both, and a new name can be added.
function exercisePicker(skip, pick) {
  sheet('Add exercise', `<input type="search" id="xp-q" placeholder="Search or type a new one" autocomplete="off" enterkeyhint="done">
    <div id="xp-list">${skel(1)}</div>`, async (b, close) => {
    let all;
    try { all = await api('/api/lifts/exercises'); } catch (x) { $('#xp-list', b).innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    const q = $('#xp-q', b);
    const row = (x, mine) => `<button type="button" class="row-link" data-name="${esc(x.name)}"${mine ? ` data-id="${x.id}"` : ''}><span class="grow"><span>${esc(x.name)}</span>
      ${mine && x.last ? `<small class="muted">Last: ${esc(shortDay(x.last))}</small>` : ''}</span>${svg('plus', 'xp-plus')}</button>`;
    const draw = () => {
      const t = q.value.trim().toLowerCase(), hit = (x) => !t || x.name.toLowerCase().includes(t);
      const mine = all.mine.filter((x) => !skip.includes(x.id) && hit(x)), common = all.common.filter(hit);
      const groups = [...new Set(common.map((x) => x.muscle))];
      const exact = t && [...all.mine, ...all.common].some((x) => x.name.toLowerCase() === t);
      $('#xp-list', b).innerHTML = `${t && !exact ? `<button type="button" class="row-link xp-new" data-new="1"><span class="ri c-berry">${svg('plus')}</span><span class="grow"><span>Add “${esc(q.value.trim())}”</span><small class="muted">A new exercise of your own</small></span></button>` : ''}
        ${mine.length ? `<h3 class="ghead">Yours</h3><div class="pick-list">${mine.map((x) => row(x, true)).join('')}</div>` : ''}
        ${groups.map((g) => `<h3 class="ghead">${esc(g)}</h3><div class="pick-list">${common.filter((x) => x.muscle === g).map((x) => row(x, false)).join('')}</div>`).join('')}
        ${!mine.length && !common.length && !t ? '<p class="muted">Type a name to add your own.</p>' : ''}`;
      $$('[data-name]', b).forEach((x) => x.onclick = () => choose(x.dataset.name, x.dataset.id));
      const nw = $('[data-new]', b); if (nw) nw.onclick = () => newKind(q.value.trim());
    };
    const choose = async (name, id, kind) => {
      try {
        const ex = id ? all.mine.find((x) => x.id === +id) : await api('/api/lifts/exercises', json('POST', {name, kind}));
        invalidate('/api/lifts'); close(); pick(ex);
      } catch (x) { toast(x.message); }
    };
    const newKind = (name) => pickSheet(`How is ${name} measured?`, pickRows(KINDS.map(([k, n]) => [k, n, k === 'weight' ? 'Most lifts: a weight, lifted a number of times' : k === 'body' ? 'Push-ups, pull-ups: reps (you can add weight later)' : 'Planks and holds: seconds'])), (k) => choose(name, null, k));
    q.oninput = draw; draw();
  });
}

// ---------- looking back ----------
// Progress > Lifting: every exercise you've logged, the latest first, with your best; recent sessions above.
async function pLifting(body) {
  body.innerHTML = `<div id="lv-body">${skel(2)}</div>`;
  const [ex, ses] = await Promise.all([api('/api/lifts/exercises'), api('/api/lifts/sessions?limit=5')]);
  const box = $('#lv-body', body); if (!box) return;
  const mine = ex.mine.filter((x) => x.sessions);
  if (!mine.length) {
    box.innerHTML = `<div class="card empty"><b>No lifting yet</b>Start a session and log your sets: every exercise gets its own history and records here.
      <div class="btncol empty-cta"><button class="primary" id="lv-start">Start lifting</button></div></div>`;
    $('#lv-start', box).onclick = startLiftSheet; return;
  }
  const best = (x) => (x.kind === 'time' ? `${x.best_secs || 0} s` : x.kind === 'body' && !x.best_kg ? `${x.best_reps || 0} reps` : `${toW(x.best_kg)} ${wUnit()}`);
  box.innerHTML = `<div class="card"><h2>Recent sessions<button class="linkbtn" id="lv-start">Start lifting</button></h2>${ses.map((s) => `<a class="row-link" href="/activity/${s.id}" data-prefetch="/api/activities/${s.id}"><span class="grow"><b>${esc(s.name)}</b>
      <small class="muted">${esc(shortDay(s.start_time))} · ${s.sets} sets${s.volume ? ' · ' + esc(volText(s.volume)) : ''}</small><small class="muted lv-names">${esc((s.exercises || []).join(', '))}</small></span><span class="chev">${svg('chev')}</span></a>`).join('')}</div>
    <div class="card"><h2>Your exercises <span class="count">${mine.length}</span></h2>
      ${mine.length > 8 ? '<input type="search" id="lv-q" placeholder="Find an exercise" autocomplete="off">' : ''}
      <div id="lv-ex">${mine.map((x) => `<a class="row-link" href="/lift/ex/${x.id}" data-n="${esc(x.name.toLowerCase())}"><span class="grow"><b>${esc(x.name)}</b>
        <small class="muted">${x.sessions} session${x.sessions > 1 ? 's' : ''} · last ${esc(shortDay(x.last))}</small></span>
        <span class="lv-best"><small class="muted">Best</small><b class="num">${esc(best(x))}</b></span></a>`).join('')}</div></div>`;
  $('#lv-start', box).onclick = startLiftSheet;
  const q = $('#lv-q', box);
  if (q) q.oninput = () => { const t = q.value.trim().toLowerCase(); $$('#lv-ex .row-link', box).forEach((r) => { r.hidden = !!t && !r.dataset.n.includes(t); }); };
}

// One exercise over time: records, a chart of the best set per session, and every session's sets.
route(/^\/lift\/ex\/(\d+)$/, 'progress', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn()}</div>${skel(2)}`;
  wireBack(el, '/progress?view=lifting');
  await load(`/api/lifts/exercises/${id}`, (h) => drawExercise(el, h));
});
function drawExercise(el, h) {
  const e = h.exercise, R = h.records, kind = e.kind;
  const W = (kg) => `${esc(toW(kg))}<i>${wUnit()}</i>`, E = (kg) => `${Math.round(imp() ? kg * LB : kg)}<i>${wUnit()}</i>`;
  const rec = (k, label, val, sub) => (R[k] ? `<a class="row-link lx-rec" href="/activity/${R[k].activity_id}"><span class="grow"><span>${esc(label)}</span><small class="muted">${esc(sub)} · ${esc(shortDay(R[k].start_time))}</small></span><b class="num">${val}</b></a>` : '');
  const recs = kind === 'time' ? rec('secs', 'Longest hold', `${R.secs?.value}<i>s</i>`, 'one set')
    : (kind === 'body' ? rec('reps', 'Most reps', R.reps?.value, 'in one set') + (R.heaviest ? rec('heaviest', 'Most weight added', W(R.heaviest.value), `× ${R.heaviest.reps}`) : '')
      : rec('heaviest', 'Heaviest', R.heaviest ? W(R.heaviest.value) : '', R.heaviest ? `× ${R.heaviest.reps}` : '')
        + rec('e1rm', 'Best one-rep max (estimate)', R.e1rm ? E(R.e1rm.value) : '', R.e1rm ? `from ${toW(R.e1rm.kg)} × ${R.e1rm.reps}` : '')
        + rec('volume', 'Most in one session', R.volume ? `${Math.round(imp() ? R.volume.value * LB : R.volume.value).toLocaleString()}<i>${wUnit()}</i>` : '', 'weight × reps, added up'));
  // the chart: estimated 1RM for weighted lifts (it compares 5 heavy reps with 10 lighter ones), else reps or seconds
  const pick = (s) => (kind === 'time' ? s.secs : kind === 'body' ? s.reps : s.e1rm || (s.top && s.top.kg));
  const pts = h.sessions.filter((s) => pick(s)).map((s) => ({x: new Date(s.start_time) / 864e5, y: kind === 'weight' ? +toW(pick(s)) : pick(s), id: s.activity_id}));
  const chartName = kind === 'time' ? 'Longest hold (seconds)' : kind === 'body' ? 'Most reps in a set' : `One-rep max, estimated (${wUnit()})`;
  el.innerHTML = `<div class="top">${backBtn()}<div class="acts"><button class="icon-btn" id="lx-edit" aria-label="Edit exercise">${svg('edit')}</button></div></div>
    <div class="card lx-head"><div class="eyebrow">${esc(e.muscle || KINDS.find((k) => k[0] === kind)[1])}</div><h1>${esc(e.name)}</h1>
      <p class="muted">${e.sessions} session${e.sessions === 1 ? '' : 's'}${e.last ? ` · last ${esc(shortDay(e.last))}` : ''}</p>
      <button class="lx-note${e.note ? '' : ' empty-note'}" id="lx-note">${e.note ? esc(e.note) : '+ Add a note for next time'}</button></div>
    ${recs ? `<div class="card"><h2>Your records</h2>${recs}</div>` : ''}
    ${pts.length > 1 ? `<div class="card"><h2>${esc(chartName)}</h2><div id="lx-chart"></div></div>` : ''}
    <div class="card"><h2>Every session</h2>${h.sessions.length ? h.sessions.map((s) => `<a class="row-link lx-ses" href="/activity/${s.activity_id}"><span class="grow"><b class="num">${esc(setsText(s.sets, kind))}</b>
      <small class="muted">${esc(fdate(s.start_time, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}${kind === 'weight' && s.e1rm ? ` · 1RM ~${Math.round(imp() ? s.e1rm * LB : s.e1rm)} ${wUnit()}` : ''}</small></span><span class="chev">${svg('chev')}</span></a>`).join('')
      : '<p class="muted">Nothing logged yet.</p>'}</div>`;
  wireBack(el, '/progress?view=lifting');
  if (pts.length > 1) {
    const top = pts.reduce((b, p) => (p.y > b.y ? p : b), pts[0]);
    requestAnimationFrame(() => dotChart($('#lx-chart', el), [...pts].reverse(), {yfmt: (v) => (kind === 'time' ? `${Math.round(v)} s` : String(Math.round(v))), best: top.id, line: true}));
  }
  $('#lx-note', el).onclick = () => noteSheet(e, () => { invalidate('/api/lifts'); render(); });
  $('#lx-edit', el).onclick = () => sheet('Edit exercise', `<form class="form" id="lx-f"><label>Name<input name="name" maxlength="80" value="${esc(e.name)}" required></label>
      <label>Measured by<select name="kind">${KINDS.map(([k, n]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <div class="actions"><button class="primary">Save</button></div>
      <button type="button" class="ghost danger wide" id="lx-del">${svg('trash')}Delete exercise and its history</button></form>`, (b, close) => {
    $('#lx-f', b).onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api(`/api/lifts/exercises/${e.id}`, json('PATCH', {name: f.name.value.trim(), kind: f.kind.value})); invalidate('/api/lifts'); close(); render(); }
      catch (x) { toast(x.message); }
    };
    $('#lx-del', b).onclick = () => sheet('Delete this exercise?', `<p>Every set of ${esc(e.name)} goes too, from all ${e.sessions} session${e.sessions === 1 ? '' : 's'}. The sessions themselves stay.</p>
      <div class="btnrow"><button class="ghost" data-close>Cancel</button><button class="primary danger-btn" id="lx-yes">Delete</button></div>`, (b2, close2) => {
      $('#lx-yes', b2).onclick = async () => {
        try { await api(`/api/lifts/exercises/${e.id}`, {method: 'DELETE'}); invalidate('/api/'); close2(); close(); go('/progress?view=lifting', {replace: true}); toast(`${e.name} deleted`); }
        catch (x) { toast(x.message); }
      };
    });
  });
}

// ---------- on an activity ----------
// The session's exercises at the top of its Overview, each with its sets and any records; a session still being logged
// says so on Today.
function liftCard(a) {
  if (!a.lifts && a.sport !== 'workout') return '';
  if (!a.lifts) return `<div class="card"><h2>What you lifted</h2><p class="small muted">Add your exercises and sets: next time, they show beside every set.</p>
    <a class="ghost wide" href="/lift/${a.id}">${svg('plus')}Add exercises</a></div>`;
  return `<div class="card" id="d-lifts"><h2>${a.lift_open ? 'Lifting now' : 'Exercises'}<a class="more" href="/lift/${a.id}">${a.lift_open ? 'Carry on ›' : 'Edit'}</a></h2><div class="sk line"></div></div>`;
}
async function fillLiftCard(el, a) {
  const box = $('#d-lifts', el); if (!box) return;
  try {
    const r = await api(`/api/activities/${a.id}/lifts`);
    if (!box.isConnected) return;
    box.innerHTML = `<h2>${r.open ? 'Lifting now' : 'Exercises'}<a class="more" href="/lift/${a.id}">${r.open ? 'Carry on ›' : 'Edit'}</a></h2>
      ${r.exercises.map((e) => { const prs = e.sets.filter((s) => (s.pr || []).length).flatMap((s) => s.pr);
        return `<a class="row-link ls-row" href="/lift/ex/${e.exercise_id}"><span class="grow"><b>${esc(e.name)}</b><small class="num">${esc(setsText(e.sets, e.kind)) || '<span class="muted">nothing ticked</span>'}</small>
          ${e.last ? `<small class="muted">Last time: ${esc(setsText(e.last.sets, e.kind))}</small>` : ''}</span>
          ${prs.length ? `<span class="badge pr">${svg('trophy')} ${esc([...new Set(prs)].map((k) => PR_NAMES[k]).join(', '))}</span>` : `<span class="chev">${svg('chev')}</span>`}</a>`; }).join('')}`;
  } catch (x) { box.remove(); }
}
// Today: a session left running shows at the top, so it's one tap back into it
async function liftNowCard(box) {
  try {
    const s = (await api('/api/lifts/sessions?limit=1'))[0];
    if (!box.isConnected) return;
    box.innerHTML = s && s.lift_open && Date.now() - new Date(s.start_time) < 4 * 3600e3 ? `<a class="card tap lift-now" href="/lift/${s.id}"><span class="sp workout" aria-hidden="true">${svg('workout')}</span>
      <span class="grow"><b>Lifting now</b><small class="muted">Started ${esc(ftime(s.start_time))} · ${s.sets} set${s.sets === 1 ? '' : 's'} so far</small></span><span class="linkbtn">Carry on ›</span></a>` : '';
  } catch (x) { /* offline: nothing to show */ }
}
