// Kinetta phone app — lifting (2026-10-13): log a strength session set by set, with the previous session's numbers beside every
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
      ${recent.length ? `<h3 class="ghead">Or repeat one</h3><p class="small muted sl-hint">Its exercises come along, with that day's numbers in grey beside each set.</p>
      <div class="pick-list">${recent.map((s) => `<button type="button" class="row-link" data-copy="${s.id}"><span class="grow"><span>${esc(s.name)}</span>
        <small class="muted">${esc(shortDay(s.start_time))} · ${esc(s.exercises.slice(0, 3).join(', '))}${s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : ''}</small></span><span class="chev">${svg('chev')}</span></button>`).join('')}</div>` : ''}
      <button class="ghost wide" id="sl-past">Log one you did earlier</button>`;
    const begin = async (btn, copy) => {
      btn.disabled = true;
      try { const r = await api('/api/lifts/start', json('POST', copy ? {copy_from: +copy} : {})); invalidate('/api/'); close(); go(`/track/lift/${r.id}`); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
    $('#sl-new', b).onclick = (e) => begin(e.currentTarget);
    $$('[data-copy]', b).forEach((x) => x.onclick = () => begin(x, x.dataset.copy));
    $('#sl-past', b).onclick = () => { close(); addActivitySheet(null, 'workout'); };
  });
}

// ---------- the logger ----------
// The whole session lives here and goes to the server after each change (a moment later, as one PUT, so a resend never
// doubles anything). Until the server has it, a copy is kept on the phone: a gym with no signal loses nothing.
route(/^\/lift\/(\d+)$/, 'track', async (el, id) => go(`/track/lift/${id}`, {replace:true}));
route(/^\/track\/lift\/(\d+)$/, 'track', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Track')}</div>${skel(2)}`;
  wireBack(el, '/track');
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
  el.innerHTML = `<div class="top">${backBtn('Track')}<div class="acts"><span class="lift-save small muted" id="lf-save" aria-live="polite"></span>
      ${S.open ? '<button class="primary sm" id="lf-finish">Finish</button>' : '<button class="primary sm" id="lf-done">Done</button>'}</div></div>
    ${S.open ? `<div class="lift-clock card"><span>Session <b class="num" id="lf-time">0:00</b></span><span id="lf-restbox" hidden>Rest <b class="num" id="lf-rest">0:00</b></span></div>` : ''}
    <div id="lf-list"></div>
    <button class="primary wide lift-add" id="lf-add">${svg('plus')}Add exercise</button>
    <p class="small muted center lift-foot">${S.open ? "Tick each set when you've done it. Only ticked sets are saved." : 'Every set with numbers in it is saved.'}</p>
    ${S.open ? '<button type="button" class="linkbtn danger track-discard" id="lf-discard">Discard session</button>' : ''}`;
  wireBack(el, `/activity/${aid}`);
  const list = $('#lf-list', el);

  // the session's time, and Rest: time since the last ticked set (shown once a set is ticked; nothing to set up)
  if (S.open) {
    const t0 = new Date(S.start).getTime(), tick = () => {
      if (!list.isConnected) { clearInterval(iv); return; }   // left the page, or Finish replaced the logger with its summary
      $('#lf-time', el).textContent = dur(Math.max(0, (Date.now() - t0) / 1000));
      $('#lf-restbox', el).hidden = !S.lastTick;
      if (S.lastTick) $('#lf-rest', el).textContent = dur((Date.now() - S.lastTick) / 1000);
    };
    const iv = setInterval(tick, 1000); tick();
  }

  const filled = (x) => x.reps != null || x.secs != null;
  const body = () => ({exercises: S.ex.map((e) => ({exercise_id: e.exercise_id, sets: e.sets.map((s) => ({reps: s.reps ?? null, kg: s.kg ?? null, secs: s.secs ?? null, warmup: !!s.warmup, done: S.open ? !!s.done : filled(s)}))}))});
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
      let moved = false;
      r.exercises.forEach((e, i) => { const mine = S.ex[i]; if (mine && mine.exercise_id === e.exercise_id) {
        moved = moved || (mine.last && mine.last.activity_id) !== (e.last && e.last.activity_id);
        mine.last = e.last; mine.sessions_before = e.sessions_before;
        mine.sets.forEach((s, j) => { s.pr = (e.sets[j] || {}).pr; }); } });
      if (!again) { status('Saved'); if (moved && !list.contains(document.activeElement)) draw(); else marks(); }   // the server knows best which session came before
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
    list.innerHTML = S.ex.length ? S.ex.map(exCard).join('') : `<div class="card empty"><b>No exercises yet</b>Add one. Your numbers from the previous session show beside each set.</div>`;
    wire();
  }
  // the columns: set number, the previous session's set (its date on top), the boxes, and the tick in a live session
  const cols = (e) => ['n', ...(e.last ? ['prev'] : []), ...(e.kind === 'time' ? ['secs'] : hasWeight(e) ? ['kg', 'reps'] : ['reps']), ...(S.open ? ['tick'] : [])];
  const T = '\u2009×\u2009';   // thin spaces: "200 × 5" fits the narrow column
  const prevText = (e, p) => (!p ? '' : e.kind === 'time' ? `${p.secs || 0} s` : p.kg && e.kind === 'body' ? `+${toW(p.kg)}${T}${p.reps || 0}` : p.kg ? `${toW(p.kg)}${T}${p.reps || 0}` : `${p.reps || 0}`);
  function exCard(e, i) {
    const c = cols(e), name = {n: 'Set', prev: e.last ? shortDay(e.last.start_time) : '', kg: e.kind === 'body' ? `+${wUnit()}` : wUnit(), reps: 'Reps', secs: 'Seconds', tick: ''};
    return `<section class="card lift-ex" data-i="${i}"><div class="lift-hd"><a class="lift-name" href="/lift/ex/${e.exercise_id}">${esc(e.name)}</a>
        <button class="icon-btn" data-exmenu aria-label="More for ${esc(e.name)}">${svg('more')}</button></div>
      ${e.note ? `<p class="lift-note small">${esc(e.note)}</p>` : ''}
      <div class="lift-sets c${c.length}${e.last ? ' has-prev' : ''}" role="group" aria-label="${esc(e.name)} sets">
        <div class="lift-row lh">${c.map((k) => `<span class="lh-${k}">${esc(name[k])}</span>`).join('')}</div>
        ${e.sets.map((s, j) => setRow(e, s, j)).join('')}</div>
      ${i === 0 && !hintSeen() ? '<p class="lift-hint small muted">Tap a set number to mark a warm-up or delete the set.</p>' : ''}
      <button class="ghost wide lift-addset" data-addset>${svg('plus')}Add set</button></section>`;
  }
  function setRow(e, s, j) {
    const p = e.last && e.last.sets[j];                                 // the previous session's set at this place
    const above = e.sets[j - 1];
    const ph = (k) => { const src = p || above; return src && src[k] != null ? (k === 'kg' ? toW(src[k]) : String(src[k])) : ''; };
    const v = (k) => (s[k] == null ? '' : k === 'kg' ? toW(s[k]) : s[k]);
    const box = (k, mode, label) => `<input class="lift-in" data-j="${j}" data-k="${k}" inputmode="${mode}" enterkeyhint="next" autocomplete="off" value="${esc(v(k))}" placeholder="${esc(ph(k))}" aria-label="Set ${j + 1} ${label}">`;
    const cell = {
      n: `<button type="button" class="lift-n${s.warmup ? ' wu' : ''}" data-set="${j}" aria-label="Set ${j + 1}${s.warmup ? ', warm-up' : ''}: warm-up or delete">${s.warmup ? 'W' : j + 1 - e.sets.slice(0, j).filter((x) => x.warmup).length}</button>`,
      prev: p ? `<button type="button" class="lift-prev num" data-prev="${j}" aria-label="Use ${esc(prevText(e, p))} from ${esc(shortDay(e.last.start_time))}">${esc(prevText(e, p))}</button>` : '<span class="lift-prev none">–</span>',
      kg: box('kg', 'decimal', e.kind === 'body' ? `added ${wUnit()}` : wUnit()), reps: box('reps', 'numeric', 'reps'), secs: box('secs', 'numeric', 'seconds'),
      tick: `<button type="button" class="lift-tick" data-tick="${j}" aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">${svg('check')}</button>`,
    };
    const pr = (s.pr || []).map((k) => PR_NAMES[k]).join(', ');
    return `<div class="lift-row${s.done && S.open ? ' done' : ''}" data-row="${j}">${cols(e).map((k) => cell[k]).join('')}
      ${pr ? `<span class="lift-pr">${svg('trophy')} New record: ${esc(pr)}</span>` : ''}</div>`;
  }
  // records, after a save, without redrawing the boxes being typed in
  function marks() {
    S.ex.forEach((e, i) => {
      const card = $(`.lift-ex[data-i="${i}"]`, list); if (!card) return;
      $$('.lift-pr', card).forEach((x) => x.remove());
      e.sets.forEach((s, j) => {
        if (!(s.pr || []).length) return;
        const row = $(`[data-row="${j}"]`, card);
        if (row) row.insertAdjacentHTML('beforeend', `<span class="lift-pr">${svg('trophy')} New record: ${esc(s.pr.map((k) => PR_NAMES[k]).join(', '))}</span>`);
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
        if (on) {   // a blank box takes its grey number (the previous session's) when the set is ticked
          for (const inp of $$(`.lift-in[data-j="${j}"]`, card)) if (inp.value.trim() === '' && inp.placeholder) { inp.value = inp.placeholder; inp.oninput(); }
          if (e.kind === 'time' ? !s.secs : !s.reps) { toast(e.kind === 'time' ? 'Type the seconds first' : 'Type the reps first'); $(`.lift-in[data-j="${j}"][data-k="${e.kind === 'time' ? 'secs' : 'reps'}"]`, card).focus(); return; }
          S.lastTick = Date.now();
        }
        s.done = on; b.setAttribute('aria-pressed', String(on)); b.closest('.lift-row').classList.toggle('done', on); save();
      });
      $$('[data-prev]', card).forEach((b) => b.onclick = () => {   // the previous session's set, copied into the boxes
        const j = +b.dataset.prev, p = e.last.sets[j];
        for (const inp of $$(`.lift-in[data-j="${j}"]`, card)) { const k = inp.dataset.k; inp.value = p[k] == null ? '' : k === 'kg' ? toW(p[k]) : p[k]; inp.oninput(); }
      });
      $('[data-addset]', card).onclick = () => {
        const prev = e.sets[e.sets.length - 1];
        e.sets.push({reps: null, kg: null, secs: null, warmup: false, done: false});   // blank; the grey numbers show what to type
        draw(); later();
        const row = $$(`.lift-ex[data-i="${i}"] .lift-in[data-j="${e.sets.length - 1}"]`, list)[0]; if (row) row.focus({preventScroll: true});
      };
      $$('[data-set]', card).forEach((b) => b.onclick = () => setMenu(e, +b.dataset.set));
      $('[data-exmenu]', card).onclick = () => exMenu(i);
    });
  }
  function setMenu(e, j) {
    const s = e.sets[j];
    try { localStorage.setItem('fit.lift.hint', '1'); } catch (x) { /* no storage */ }
    pickSheet(`${e.name}: set ${j + 1}`, pickRows([['normal', 'Normal set', ''], ['wu', 'Warm-up', 'Never counts towards your records']], s.warmup ? 'wu' : 'normal')
      + '<div class="pick-list"><button type="button" class="row-link danger" data-pk="del"><span class="grow"><span>Delete this set</span></span></button></div>', (k) => {
      if (k === 'normal' || k === 'wu') s.warmup = k === 'wu';
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
    // a new exercise gets as many blank sets as the previous session had, its numbers in grey
    let last = null, before = 0;
    try {   // the latest session before this one (a session logged afterwards may be older than others)
      const h = await api(`/api/lifts/exercises/${ex.id}`), earlier = h.sessions.filter((x) => new Date(x.start_time) < new Date(S.start));
      last = earlier[0] || null; before = earlier.length;
    } catch (x) { /* offline: start blank */ }
    const sets = (last ? last.sets : [{}]).map((s) => ({reps: null, kg: null, secs: null, warmup: !!s.warmup, done: false}));
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
      try {
        const r = await save(true); store.del(key); gone = true;
        if (S.open && r) liftSummary(el, aid, r); else { go(`/track?done=${aid}`, {replace: true}); toast(S.open ? 'Session saved' : 'Saved'); }
      }
      catch (x) { fin.disabled = false; toast(x.offline ? "Can't reach Kinetta - your sets are kept on this phone. Try again when you're back online." : x.message); }
    };
    if (S.open && open) sheet('Finish the session?', `<p>${open} set${open > 1 ? 's are' : ' is'} not ticked off. ${open > 1 ? "They're" : "It's"} left out of the session.</p>
      <div class="btnrow"><button class="ghost" data-close>Keep going</button><button class="primary" id="ff-yes">Finish</button></div>`, (b, close) => { $('#ff-yes', b).onclick = () => { close(); finish(); }; });
    else finish();
  };
  const dis = $('#lf-discard', el);
  if (dis) dis.onclick = () => discardLift(aid, () => { clearTimeout(saveT); saveT = null; gone = true; });
  draw();
  if (store.get(key) && store.get(key).unsent) save();     // a copy from earlier that never reached the server
}

// ---------- discarding ----------
// A session you don't want to keep goes completely, before or right after Finish (28 October 2026, owner: people may
// not want to post it at all). Until Finish nobody else sees it; this removes it for good.
function discardLift(aid, stop) {
  sheet('Delete this session?', '<p>Its exercises and sets are deleted, and it won’t be posted. This can’t be undone.</p><button class="ghost wide" id="ld-keep">Keep it</button><button class="primary danger-btn wide" id="ld-del">Delete session</button>', (b, close) => {
    $('#ld-keep', b).onclick = close;
    $('#ld-del', b).onclick = async (e) => {
      e.target.disabled = true; if (stop) stop();
      try { await api(`/api/activities/${aid}`, {method: 'DELETE'}); }
      catch (x) { if (x.status !== 404) { e.target.disabled = false; toast(x.message); return; } }   // already gone is fine
      store.del('fit.lift:' + aid); invalidate('/api/'); App.cache.delete('feed:home'); close(); go('/track', {replace: true}); toast('Session deleted');
    };
  });
}

// ---------- after Finish ----------
// The session's numbers (28 October 2026, Ben: runs had a summary, lifting went straight back to Track). Working sets
// only: warm-ups are left out, as in every other total here.
function liftTotals(exercises) {
  const t = {exercises: 0, sets: 0, reps: 0, kg: 0, records: []};
  for (const e of exercises) {
    const real = e.sets.filter((s) => s.done !== false && !s.warmup && (s.reps || s.secs));
    if (real.length) t.exercises++;
    t.sets += real.length;
    for (const s of real) { t.reps += s.reps || 0; t.kg += (s.kg || 0) * (s.reps || 0); }
    for (const s of e.sets) for (const k of s.pr || []) t.records.push({name: e.name, kind: e.kind, what: k, set: s});
  }
  return t;
}
const recordText = (r) => (r.what === 'secs' ? `${r.set.secs} s` : r.what === 'reps' ? `${r.set.reps} reps${r.set.kg ? ` +${toW(r.set.kg)} ${wUnit()}` : ''}`
  : `${toW(r.set.kg)} ${wUnit()} × ${r.set.reps}`);

// The session is already saved; this screen names it, shows what was done and sets who can see it, the way a recording's
// summary does. Done sends only what changed.
async function liftSummary(el, aid, r) {
  invalidate(`/api/activities/${aid}`);
  let a;
  try { a = await api(`/api/activities/${aid}`); } catch (x) { go(`/track?done=${aid}`, {replace: true}); toast('Session saved'); return; }
  if (!el.isConnected) return;
  const t = liftTotals(r.exercises), secs = a.elapsed_s || a.moving_s || 0, start = new Date(a.start_time);
  // the server's estimate for a workout without a watch number (energy.activity_kcal): 5 METs, profile weight else 75 kg
  const kcal = a.calories > 0 ? a.calories : 5 * (App.me?.weight_kg || 75) * (a.moving_s || secs) / 3600;
  const stat = (v, u, l) => `<div><b class="num">${esc(v)}${u ? `<i>${esc(u)}</i>` : ''}</b><small>${esc(l)}</small></div>`;
  const stats = [stat(dur(secs), '', 'Duration'), stat(t.exercises, '', t.exercises === 1 ? 'Exercise' : 'Exercises'), stat(t.sets, '', 'Working sets'),
    t.reps && stat(t.reps.toLocaleString(), '', 'Reps'), t.kg && stat(Math.round(imp() ? t.kg * LB : t.kg).toLocaleString(), wUnit(), 'Volume'),
    stat(Math.round(kcal).toLocaleString(), 'kcal', a.calories > 0 ? 'Calories' : 'Calories (est.)')].filter(Boolean).join('');
  const when = `${start.toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'})}, ${start.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`;
  const vis = a.visibility || App.me.share_default || 'me';
  el.innerHTML = `<div class="top">${backBtn('Track')}</div>
    <section class="track-session track-review lift-review"><form class="form" id="lf-sum">
      <p class="track-review-when">${svg('workout')}${esc(a.sport_label || 'Strength')} · ${esc(when)}</p>
      <label class="track-title">Title<input name="activity_name" value="${esc(a.name || '')}" maxlength="200" autocomplete="off" enterkeyhint="done" required></label>
      <div class="card track-review-stats">${stats}</div>
      ${t.records.length ? `<div class="card lift-review-records"><h3>${svg('trophy')} New record${t.records.length > 1 ? 's' : ''}</h3>
        ${t.records.map((x) => `<div><span>${esc(x.name)}<small>${esc(PR_NAMES[x.what])}</small></span><b class="num">${esc(recordText(x))}</b></div>`).join('')}</div>` : ''}
      ${r.exercises.length ? `<div class="card lift-review-ex"><h3>Exercises</h3>${r.exercises.map((e) => `<div><b>${esc(e.name)}</b><small class="num">${esc(setsText(e.sets, e.kind))}</small>
        ${e.last ? `<small class="muted">${esc(shortDay(e.last.start_time))}: ${esc(setsText(e.last.sets, e.kind))}</small>` : ''}</div>`).join('')}</div>` : ''}
      <label>Who can see this activity<select name="visibility">${Object.entries({me: 'Only me', friends: 'Approved friends', everyone: 'Everyone on Kinetta'}).map(([value, label]) => `<option value="${value}"${value === vis ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <button class="primary wide" id="lf-sum-done">Done</button><p class="small danger" id="lf-sum-error" role="alert"></p></form>
      <button class="ghost wide" id="lf-carry">Carry on with this session</button>
      <button type="button" class="linkbtn danger track-discard" id="lf-sum-del">Delete this session</button></section>`;
  wireBack(el, '/track');
  const f = $('#lf-sum', el), err = $('#lf-sum-error', el), done = $('#lf-sum-done', el), carry = $('#lf-carry', el);
  f.onsubmit = async (ev) => {
    ev.preventDefault(); done.disabled = carry.disabled = true; err.textContent = '';
    const name = f.activity_name.value.trim(), visibility = f.visibility.value;
    try {
      if (name && name !== a.name) await api(`/api/activities/${aid}`, json('PATCH', {name}));
      if (visibility !== a.visibility) { await api(`/api/activities/${aid}/sharing`, json('PUT', {visibility})); if (typeof socialChanged === 'function') socialChanged(aid); }
      invalidate('/api/'); App.cache.delete('feed:home'); go(`/track?done=${aid}`, {replace: true}); toast('Session saved');
    } catch (x) { done.disabled = carry.disabled = false; err.textContent = x.offline ? "Can't reach Kinetta. The session is saved; try again to keep the new title or sharing." : x.message; }
  };
  $('#lf-sum-del', el).onclick = () => discardLift(aid);
  // finished by mistake: back into the logger, within the session's 4 hours (unticked sets were already left out)
  carry.onclick = async () => {
    done.disabled = carry.disabled = true;
    try { await api(`/api/activities/${aid}/lifts/reopen`, json('POST', {})); invalidate('/api/'); liftLogger(el, aid, await api(`/api/activities/${aid}/lifts`)); }
    catch (x) { done.disabled = carry.disabled = false; toast(x.message); }
  };
}

const hintSeen = () => { try { return !!localStorage.getItem('fit.lift.hint'); } catch (x) { return true; } };

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
      $('#xp-list', b).innerHTML = `${t && !exact ? `<button type="button" class="row-link xp-new" data-new="1"><span class="ri c-brand">${svg('plus')}</span><span class="grow"><span>Add “${esc(q.value.trim())}”</span><small class="muted">A new exercise of your own</small></span></button>` : ''}
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
      </div>`;
    return;
  }
  const best = (x) => (x.kind === 'time' ? `${x.best_secs || 0} s` : x.kind === 'body' && !x.best_kg ? `${x.best_reps || 0} reps` : `${toW(x.best_kg)} ${wUnit()}`);
  box.innerHTML = `<div class="card"><h2>Recent sessions</h2>${ses.map((s) => `<a class="row-link" href="/activity/${s.id}" data-prefetch="/api/activities/${s.id}"><span class="grow"><b>${esc(s.name)}</b>
      <small class="muted">${esc(shortDay(s.start_time))} · ${s.sets} sets${s.volume ? ' · ' + esc(volText(s.volume)) : ''}</small><small class="muted lv-names">${esc((s.exercises || []).join(', '))}</small></span><span class="chev">${svg('chev')}</span></a>`).join('')}</div>
    <div class="card"><h2>Your exercises <span class="count">${mine.length}</span></h2>
      ${mine.length > 8 ? '<input type="search" id="lv-q" placeholder="Find an exercise" autocomplete="off">' : ''}
      <div id="lv-ex">${mine.map((x) => `<a class="row-link" href="/lift/ex/${x.id}" data-n="${esc(x.name.toLowerCase())}"><span class="grow"><b>${esc(x.name)}</b>
        <small class="muted">${x.sessions} session${x.sessions > 1 ? 's' : ''} · last ${esc(shortDay(x.last))}</small></span>
        <span class="lv-best"><small class="muted">Best</small><b class="num">${esc(best(x))}</b></span></a>`).join('')}</div></div>`;
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
  if (!a.lifts || a.lift_open) return '';
  return '<div class="card" id="d-lifts"><h2>Exercises</h2><div class="sk line"></div></div>';
}
async function fillLiftCard(el, a) {
  const box = $('#d-lifts', el); if (!box) return;
  try {
    const r = await api(`/api/activities/${a.id}/lifts`);
    if (!box.isConnected) return;
    box.innerHTML = `<h2>Exercises</h2>
      ${r.exercises.map((e) => { const prs = e.sets.filter((s) => (s.pr || []).length).flatMap((s) => s.pr);
        return `<a class="row-link ls-row" href="/lift/ex/${e.exercise_id}"><span class="grow"><b>${esc(e.name)}</b><small class="num">${esc(setsText(e.sets, e.kind)) || '<span class="muted">nothing ticked</span>'}</small>
          ${e.last ? `<small class="muted">${esc(shortDay(e.last.start_time))}: ${esc(setsText(e.last.sets, e.kind))}</small>` : ''}</span>
          ${prs.length ? `<span class="badge pr">${svg('trophy')} ${esc([...new Set(prs)].map((k) => PR_NAMES[k]).join(', '))}</span>` : `<span class="chev">${svg('chev')}</span>`}</a>`; }).join('')}`;
  } catch (x) { box.remove(); }
}
// Track: keep the open lifting session one tap away.
async function liftNowCard(box) {
  try {
    await load('/api/lifts/sessions?limit=1', rows => {
    const s = rows[0];
    if (!box.isConnected) return;
    box.innerHTML = s && s.lift_open && Date.now() - new Date(s.start_time) < 4 * 3600e3 ? `<a class="card tap lift-now" href="/track/lift/${s.id}"><span class="sp workout" aria-hidden="true">${svg('workout')}</span>
      <span class="grow"><b>Lifting now</b><small class="muted">Started ${esc(ftime(s.start_time))} · ${s.sets} set${s.sets === 1 ? '' : 's'} so far</small></span><span class="linkbtn">Carry on ›</span></a>` : '';
    });
  } catch (x) { /* offline: nothing to show */ }
}
