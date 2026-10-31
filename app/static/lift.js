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
const hasWeight = (e) => e.kind === 'weight' || (e.kind === 'body' && e.addWeight !== false && (e.addWeight || e.sets.some((s) => s.kg) || !!(e.last && e.last.sets.some((s) => s.kg))));
const PR_NAMES = {heaviest: 'Heaviest', e1rm: 'Best 1RM', reps: 'Most reps', secs: 'Longest'};

// "3 × 8 @ 135 lb", or "135 × 8, 145 × 6" when the sets differ; warm-ups and planned sets left out
function setsText(sets, kind) {
  const real = (sets || []).filter((s) => s.done !== false && !s.warmup);
  if (!real.length) return '';
  const one = (s) => kind === 'time' || (s.secs && !s.reps) ? `${s.secs || 0} s` : kind === 'body' ? `${s.reps || 0}${s.kg ? ` +${toW(s.kg)}` : ''}` : `${toW(s.kg) || 0} × ${s.reps || 0}`;
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

// Serialize a session's writes even when navigation creates a second logger. A late acknowledgement must not
// replace a newer phone draft; keys survive a new login but never cross accounts or chosen servers.
const liftWrites = new Map(), liftDraftVersions = new Map();
let liftRevision = 0;
const liftKey = (aid) => 'fit.lift:' + JSON.stringify([Native.base || location.origin, App.me.id, String(aid)]);
function queueLift(key, work) {
  const next = (liftWrites.get(key) || Promise.resolve()).catch(() => {}).then(work);
  liftWrites.set(key, next);
  next.finally(() => { if (liftWrites.get(key) === next) liftWrites.delete(key); }).catch(() => {});
  return next;
}
const liftCurrentDraft = (key, revision) => liftDraftVersions.get(key) === revision;

// ---------- start a session ----------
// The + on Today and Activity offers this first; a session already running is carried on instead of a new one.
function startLiftSheet() {
  sheet('Start lifting', `<div id="sl-body">${skel(1)}</div>`, async (b, close) => {
    const owner = readOwner(), active = () => b.isConnected && !b.closest('.scrim')?.inert && owner === readOwner();
    let recent = [], recentFailed = false;
    try {   // one row per routine: the latest session of each name
      const seen = new Set();
      recent = (await api('/api/lifts/sessions?limit=30')).filter((s) => s.exercises && s.exercises.length && !s.lift_open && !seen.has(s.name) && seen.add(s.name)).slice(0, 5);
    } catch (e) { recentFailed = true; }
    if (!active()) return;
    $('#sl-body', b).innerHTML = `<button class="primary wide" id="sl-new">${svg('workout')}Start an empty session</button>
      ${recentFailed ? '<p class="small muted">Recent sessions couldn’t load.</p><button class="ghost wide" id="sl-retry">Try again</button>' : ''}
      ${recent.length ? `<h3 class="ghead">Or repeat one</h3><p class="small muted sl-hint">Its exercises come along, with that day's numbers in grey beside each set.</p>
      <div class="pick-list">${recent.map((s) => `<button type="button" class="row-link" data-copy="${s.id}"><span class="grow"><span>${esc(s.name)}</span>
        <small class="muted">${esc(shortDay(s.start_time))} · ${esc(s.exercises.slice(0, 3).join(', '))}${s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : ''}</small></span><span class="chev">${svg('chev')}</span></button>`).join('')}</div>` : ''}
      <button class="ghost wide" id="sl-past">Log one you did earlier</button>`;
    const begin = async (copy) => {
      if (!active()) return;
      $$('button', b).forEach(x => x.disabled = true);
      try { const r = await api('/api/lifts/start', json('POST', copy ? {copy_from: +copy} : {})); if (!active()) return; invalidate('/api/'); close(); go(`/track/lift/${r.id}`); }
      catch (x) { if (active()) { toast(x.message); $$('button', b).forEach(x => x.disabled = false); } }
    };
    const retry = $('#sl-retry', b); if (retry) retry.onclick = () => { close(); startLiftSheet(); };
    $('#sl-new', b).onclick = () => begin();
    $$('[data-copy]', b).forEach((x) => x.onclick = () => begin(x.dataset.copy));
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
  const owner = readOwner(), key = liftKey(id);
  let data;
  try { data = await api(`/api/activities/${id}/lifts`); }
  catch (e) { if (!el.isConnected || owner !== readOwner()) return; const k = store.get(key); if (!e.offline || !k) return showError(el, e); data = k.data; }
  if (!el.isConnected || owner !== readOwner()) return;
  const draft = store.get(key);
  if (draft?.unsent) data = {...data, exercises: draft.data.exercises};
  else if (draft) data.exercises.forEach(e => { const old = draft.data.exercises.find(x => x.exercise_id === e.exercise_id); if (old?.addWeight !== undefined) e.addWeight = old.addWeight; });
  data.lastTick = draft?.lastTick || null;
  liftLogger(el, +id, data);
});

function liftLogger(el, aid, data) {
  const owner = readOwner(), key = liftKey(aid);
  const S = {ex: data.exercises.map((e) => ({...e, sets: e.sets.map((s) => ({...s}))})), open: data.open, start: data.start_time, lastTick: data.lastTick || null};
  let saveT = null, disposed = false, stopped = false, finishing = false, clock = null, setRecovery = null;
  const owned = () => owner === readOwner(), live = () => owned() && !disposed && el.isConnected;
  el.classList.add('compact-lift');
  el.innerHTML = `<div class="top lift-top">${backBtn('Track')}${S.open?'<div class="lift-header-clock" aria-label="Session and rest time"><span><span class="vh">Session </span><b class="num" id="lf-time">0:00</b></span><span id="lf-restbox" hidden>Rest <b class="num" id="lf-rest">0:00</b></span></div>':''}<div class="acts"><span class="lift-save small muted" id="lf-save" role="status" aria-live="polite"></span>
      ${S.open ? '<button class="primary sm" id="lf-finish">Finish</button>' : '<button class="primary sm" id="lf-done">Done</button>'}</div></div>
    <div id="lf-list"></div>
    <button class="primary wide lift-add" id="lf-add">${svg('plus')}Add exercise</button>
    <p class="small muted center lift-foot">${S.open ? "Tick each set when you've done it. Only ticked sets are saved." : 'Every set with numbers in it is saved.'}</p>
    ${S.open ? '<button type="button" class="linkbtn danger track-discard" id="lf-discard">Discard session</button>' : ''}`;
  wireBack(el, `/activity/${aid}`);
  const list = $('#lf-list', el);

  // the session's time, and Rest: time since the last ticked set (shown once a set is ticked; nothing to set up)
  if (S.open) {
    const t0 = new Date(S.start).getTime(), tick = () => {
      if (!list.isConnected || !owned()) { clearInterval(clock); return; }   // left the page, or Finish replaced the logger with its summary
      $('#lf-time', el).textContent = dur(Math.max(0, (Date.now() - t0) / 1000));
      $('#lf-restbox', el).hidden = !S.lastTick;
      if (S.lastTick) $('#lf-rest', el).textContent = dur((Date.now() - S.lastTick) / 1000);
    };
    clock = setInterval(tick, 1000); tick();
  }

  const filled = (x) => x.reps != null || x.secs != null;
  const body = (finish) => {
    const completed = finish && S.open;
    const exercises = S.ex.map(e => ({exercise_id: e.exercise_id,
      sets: e.sets.filter(s => !completed || s.done).map(s => ({reps: s.reps ?? null, kg: s.kg ?? null,
        secs: s.secs ?? null, warmup: !!s.warmup, done: S.open ? !!s.done : filled(s)}))}));
    return {exercises: exercises.filter(e => !completed || e.sets.length)};
  };
  const status = (t) => { const s = live() && $('#lf-save', el); if (s) { s.textContent=t;s.dataset.state=!t?'empty':t==='Saved'?'saved':['Saving…','Deleting…'].includes(t)?'saving':'error';s.setAttribute('aria-label',t); } };
  const remember = () => {
    const revision = ++liftRevision; liftDraftVersions.set(key, revision);
    store.set(key, {unsent: true, revision, lastTick: S.lastTick, data: {...data, exercises: S.ex}});
    return revision;
  };
  async function save(finish = false) {
    clearTimeout(saveT); saveT = null;
    if (!owned()) return;
    const revision = remember();
    if (stopped) { status('Deleting…'); return; }
    const payload = {...body(finish), finish};
    status('Saving…');
    try {
      const r = await queueLift(key, () => {
        if (!owned() || stopped) throw Object.assign(Error('The session changed.'), {stale: true});
        return api(`/api/activities/${aid}/lifts`, json('PUT', payload));
      });
      if (!owned() || stopped) return;
      invalidate(`/api/activities/${aid}`); invalidate('/api/activities?'); invalidate('/api/lifts'); App.cache.delete('feed:home');
      if (liftCurrentDraft(key, revision)) {
        let changedHistory = false;
        r.exercises.forEach(e => { const mine = S.ex.find(x => x.exercise_id === e.exercise_id); if (mine) {
          changedHistory ||= mine.last?.activity_id !== e.last?.activity_id;
          mine.last = e.last; mine.sessions_before = e.sessions_before;
          mine.sets.forEach((s, j) => { s.pr = (e.sets[j] || {}).pr; });
        } });
        store.set(key, {unsent: false, revision, lastTick: S.lastTick, data: {...r, exercises: S.ex}});
        status('Saved'); if (live()) { if (changedHistory && !list.contains(document.activeElement)) draw(); else marks(); }
      }
      return r;
    } catch (x) {
      if (!owned() || x.stale) return;
      if (liftCurrentDraft(key, revision)) status(x.offline && store.get(key)?.unsent ? 'Kept on this phone' : 'Not saved');
      if (live() && !x.offline && !finish && liftCurrentDraft(key, revision)) {
        const recovery = setRecovery && setRecovery.until > Date.now() && setRecovery.valid() ? setRecovery : null;
        if (recovery) recovery.until = Date.now() + 6000;
        toast(x.message, recovery?.undo); // A failed delete must keep its visible recovery action.
      }
      if (finish) throw x;
    }
  }
  const later = () => { if (!live()) return; clearTimeout(saveT); remember(); if (stopped) { status('Deleting…'); return; } status(''); saveT = setTimeout(save, 700); };
  const flush = () => { if (saveT && !stopped && owned()) save(); };
  const cleanup = () => {
    flush(); disposed = true; clearTimeout(saveT); clearInterval(clock);
    removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush);
  };
  addEventListener('pagehide', flush); document.addEventListener('visibilitychange', flush);
  viewResources.set(list, cleanup);

  function draw() {
    if (!live()) return;
    list.innerHTML = S.ex.length ? S.ex.map(exCard).join('') : `<div class="card empty"><b>No exercises yet</b>Add one. Your numbers from the previous session show beside each set.</div>`;
    wire();
  }
  // the columns: set number, the previous session's set (its date on top), the boxes, and the tick in a live session
  const cols = (e) => ['n', ...(e.last ? ['prev'] : []), ...(e.kind === 'time' ? ['secs'] : hasWeight(e) ? ['kg', 'reps'] : ['reps']), ...(S.open ? ['tick'] : [])];
  const T = ' × ';   // normal spaces allow a previous set to wrap without losing a number
  const prevText = (e, p) => (!p ? '' : e.kind === 'time' ? `${p.secs || 0} s` : p.kg && e.kind === 'body' ? `+${toW(p.kg)}${T}${p.reps || 0}` : p.kg ? `${toW(p.kg)}${T}${p.reps || 0}` : `${p.reps || 0}`);
  function exCard(e, i) {
    const c = cols(e), name = {n: 'Set', prev: e.last ? 'Last' : '', kg: e.kind === 'body' ? `+${wUnit()}` : wUnit(), reps: 'Reps', secs: 'Seconds', tick: ''};
    return `<section class="card lift-ex" data-i="${i}"><div class="lift-hd"><div class="lift-title-line"><a class="lift-name" href="/lift/ex/${e.exercise_id}">${esc(e.name)}</a>${e.note?`<button type="button" class="lift-note" data-exnote aria-label="Edit note for ${esc(e.name)}">${esc(e.note)}</button>`:''}</div>
        <button class="icon-btn" data-exmenu aria-label="More for ${esc(e.name)}">${svg('more')}</button></div>
      <div class="lift-sets c${c.length}${e.last ? ' has-prev' : ''}" role="group" aria-label="${esc(e.name)} sets">
        <div class="lift-row lh">${c.map((k) => `<span class="lh-${k}">${esc(name[k])}</span>`).join('')}</div>
        ${e.sets.map((s, j) => setRow(e, s, j)).join('')}</div>
      <button class="linkbtn lift-addset" data-addset>${svg('plus')}Add set</button></section>`;
  }
  function setRow(e, s, j) {
    const p = e.last && e.last.sets[j];                                 // the previous session's set at this place
    const above = e.sets[j - 1];
    const ph = (k) => { const src = p || above; return src && src[k] != null ? (k === 'kg' ? toW(src[k]) : String(src[k])) : ''; };
    const v = (k) => (s[k] == null ? '' : k === 'kg' ? toW(s[k]) : s[k]);
    const box = (k, mode, label) => `<input class="lift-in" data-j="${j}" data-k="${k}" inputmode="${mode}" enterkeyhint="next" autocomplete="off" value="${esc(v(k))}" placeholder="${esc(ph(k))}" aria-label="Set ${j + 1} ${label}">`;
    const cell = {
      n: `<button type="button" class="lift-n${s.warmup ? ' wu' : ''}" data-set="${j}" aria-label="Set ${j + 1}, ${s.warmup ? 'warm-up' : 'working set'}. Actions" aria-haspopup="dialog"><span>${s.warmup ? 'W' : j + 1 - e.sets.slice(0, j).filter((x) => x.warmup).length}</span>${svg('down')}</button>`,
      prev: p ? `<button type="button" class="lift-prev num" data-prev="${j}" aria-label="Use ${esc(prevText(e, p))} from ${esc(shortDay(e.last.start_time))}"><span class="lift-prev-label">Last · ${esc(shortDay(e.last.start_time))}:</span><span>${esc(prevText(e, p).replace(/ × /g,'×'))}</span></button>` : '<span class="lift-prev none">–</span>',
      kg: box('kg', 'decimal', e.kind === 'body' ? `added ${wUnit()}` : wUnit()), reps: box('reps', 'numeric', 'reps'), secs: box('secs', 'numeric', 'seconds'),
      tick: `<button type="button" class="lift-tick" data-tick="${j}" aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">${svg('check')}</button>`,
    };
    const pr = (s.pr || []).map((k) => PR_NAMES[k]).join(', ');
    return `<div class="lift-row${s.done && S.open ? ' done' : ''}" data-row="${j}">${cols(e).map((k) => cell[k]).join('')}
      ${pr ? `<span class="lift-pr" role="img" aria-label="New record: ${esc(pr)}">${svg('trophy')} ${esc(pr)}</span>` : ''}</div>`;
  }
  // records, after a save, without redrawing the boxes being typed in
  function marks() {
    S.ex.forEach((e, i) => {
      const card = $(`.lift-ex[data-i="${i}"]`, list); if (!card) return;
      $$('.lift-pr', card).forEach((x) => x.remove());
      e.sets.forEach((s, j) => {
        if (!(s.pr || []).length) return;
        const row = $(`[data-row="${j}"]`, card);
        if (row) row.insertAdjacentHTML('beforeend', `<span class="lift-pr" role="img" aria-label="New record: ${esc(s.pr.map((k) => PR_NAMES[k]).join(', '))}">${svg('trophy')} ${esc(s.pr.map((k) => PR_NAMES[k]).join(', '))}</span>`);
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
          for (const inp of $$(`.lift-in[data-j="${j}"]`, card)) if (inp.value.trim() === '' && inp.placeholder) {
            const k = inp.dataset.k, previous = e.last?.sets[j] || e.sets[j - 1];
            inp.value = inp.placeholder; s[k] = previous[k]; // keep authoritative kg rather than round-tripping displayed lb
          }
          if (e.kind === 'time' ? !s.secs : !s.reps) { toast(e.kind === 'time' ? 'Type the seconds first' : 'Type the reps first'); $(`.lift-in[data-j="${j}"][data-k="${e.kind === 'time' ? 'secs' : 'reps'}"]`, card).focus(); return; }
          S.lastTick = Date.now();
        }
        s.done = on; b.setAttribute('aria-pressed', String(on)); b.closest('.lift-row').classList.toggle('done', on); save();
      });
      $$('[data-prev]', card).forEach((b) => b.onclick = () => {   // the previous session's set, copied into the boxes
        const j = +b.dataset.prev, p = e.last?.sets[j]; if (!p) return;
        for (const inp of $$(`.lift-in[data-j="${j}"]`, card)) { const k = inp.dataset.k; inp.value = p[k] == null ? '' : k === 'kg' ? toW(p[k]) : p[k]; e.sets[j][k] = p[k]; }
        later();
      });
      $('[data-addset]', card).onclick = () => {
        e.sets.push({reps: null, kg: null, secs: null, warmup: false, done: false});   // blank; the grey numbers show what to type
        draw(); later();
        const row = $$(`.lift-ex[data-i="${i}"] .lift-in[data-j="${e.sets.length - 1}"]`, list)[0]; if (row) row.focus({preventScroll: true});
      };
      $$('[data-set]', card).forEach((b) => b.onclick = () => setMenu(e, +b.dataset.set));
      $('[data-exmenu]', card).onclick = () => exMenu(i);
      const note=$('[data-exnote]',card);if(note)note.onclick=()=>{if(live()&&!finishing)noteSheet(e,()=>draw());};
    });
  }
  function focusSet(e, j) {
    const i = S.ex.indexOf(e);
    $(`.lift-ex[data-i="${i}"] ${j >= 0 ? `[data-set="${j}"]` : '[data-addset]'}`, list)?.focus({preventScroll: true});
  }
  function setMenu(e, j) {
    if (!live() || finishing || stopped || !S.ex.includes(e)) return;
    const s = e.sets[j]; if (!s) return;
    pickSheet(`${e.name}: set ${j + 1}`, '<div class="lift-set-actions">' + pickRows([['normal', 'Working set', ''], ['wu', 'Warm-up', 'Never counts towards your records']], s.warmup ? 'wu' : 'normal')
      + '<div class="pick-list"><button type="button" class="row-link danger" data-pk="del"><span class="grow"><span>Delete this set</span></span></button></div></div>', (k) => {
      if (!live() || finishing || stopped || !S.ex.includes(e)) return;
      const at = e.sets.indexOf(s); if (at < 0) return;
      if (k === 'normal' || k === 'wu') {
        s.warmup = k === 'wu'; draw(); save(); focusSet(e, at); return;
      }
      if (k !== 'del') return;
      const previous = e.sets[at - 1], next = e.sets[at + 1];
      e.sets.splice(at, 1);
      let consumed = false;
      const valid = () => !consumed && live() && !finishing && !stopped && S.ex.includes(e) && !e.sets.includes(s);
      const undo = () => {
        if (consumed) return; consumed = true;
        if (!live() || finishing || stopped || !S.ex.includes(e) || e.sets.includes(s)) return;
        // Restore only this set, beside a surviving neighbour; keep every edit made since deletion.
        const before = e.sets.indexOf(next), after = e.sets.indexOf(previous);
        const index = before >= 0 ? before : after >= 0 ? after + 1 : Math.min(at, e.sets.length);
        e.sets.splice(index, 0, s); draw(); save(); focusSet(e, index);
      };
      setRecovery = {valid, undo, until: Date.now() + 6000};
      draw(); save(); focusSet(e, Math.min(at, e.sets.length - 1));
      toast(`Set ${at + 1} deleted`, undo);
    });
  }
  function exMenu(i) {
    if (!live() || finishing) return;
    const e = S.ex[i];
    pickSheet(e.name, `<div class="pick-list">
      <button type="button" class="row-link" data-pk="note"><span class="grow"><span>${e.note ? 'Edit note' : 'Add a note for next time'}</span><small class="muted">${e.note ? esc(e.note) : 'e.g. seat on 4, narrow grip'}</small></span></button>
      ${e.kind === 'body' ? (hasWeight(e) ? '<button type="button" class="row-link" data-pk="nowt"><span class="grow"><span>No added weight</span><small class="muted">Back to reps only</small></span></button>'
        : '<button type="button" class="row-link" data-pk="wt"><span class="grow"><span>Add weight</span><small class="muted">A weighted vest or a dip belt</small></span></button>') : ''}
      <button type="button" class="row-link" data-pk="sets"><span class="grow"><span>Warm-up or delete a set</span></span></button>
      <button type="button" class="row-link" data-pk="hist"><span class="grow"><span>History and records</span></span></button>
      ${i > 0 ? '<button type="button" class="row-link" data-pk="up"><span class="grow"><span>Move up</span></span></button>' : ''}
      ${i < S.ex.length - 1 ? '<button type="button" class="row-link" data-pk="down"><span class="grow"><span>Move down</span></span></button>' : ''}
      <button type="button" class="row-link danger" data-pk="del"><span class="grow"><span>Remove from this session</span></span></button></div>`, (k) => {
      if (!live() || finishing) return;
      if(k==='sets')return pickSheet('Choose a set',pickRows(e.sets.map((s,j)=>[String(j),'Set '+(j+1)+(s.warmup?' · Warm-up':''),''])),j=>setMenu(e,+j));
      if (k === 'hist') { flush(); return go(`/lift/ex/${e.exercise_id}`); }
      if (k === 'note') return noteSheet(e, () => { draw(); });
      if (k === 'wt') { e.addWeight = true; draw(); return later(); }
      if (k === 'nowt') { e.addWeight = false; e.sets.forEach((s) => { s.kg = null; }); }
      if (k === 'up' || k === 'down') { const t = k === 'up' ? i - 1 : i + 1; [S.ex[i], S.ex[t]] = [S.ex[t], S.ex[i]]; }
      if (k === 'del') {
        const gone = S.ex.splice(i, 1)[0];
        toast(`${gone.name} removed`, () => { if (!live() || finishing) return; S.ex.splice(i, 0, gone); draw(); save(); });
      }
      draw(); save();
    });
  }
  $('#lf-add', el).onclick = () => exercisePicker(S.ex.map((e) => e.exercise_id), async (ex) => {
    // a new exercise gets as many blank sets as the previous session had, its numbers in grey
    if (!live() || finishing) return;
    let last = null, before = 0;
    try {   // the latest session before this one (a session logged afterwards may be older than others)
      const h = await api(`/api/lifts/exercises/${ex.id}`), earlier = h.sessions.filter((x) => new Date(x.start_time) < new Date(S.start));
      last = earlier[0] || null; before = earlier.length;
    } catch (x) { /* offline: start blank */ }
    if (!live() || finishing || S.ex.some(e => e.exercise_id === ex.id)) return;
    const sets = (last ? last.sets : [{}]).map((s) => ({reps: null, kg: null, secs: null, warmup: !!s.warmup, done: false}));
    S.ex.push({exercise_id: ex.id, name: ex.name, kind: ex.kind, muscle: ex.muscle, note: ex.note, last, sessions_before: before, sets});
    draw(); save();
    const card = $$('.lift-ex', list).at(-1); if (card) card.scrollIntoView({behavior: 'smooth', block: 'center'});
  });
  const fin = $('#lf-finish', el) || $('#lf-done', el);
  fin.onclick = async () => {
    if (finishing || !live()) return;
    const open = S.ex.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const finish = async () => {
      if (finishing || !live()) return;
      finishing = true; $$('button,input', el).forEach(x => x.disabled = true);
      try {
        const r = await save(true); if (!r || !live()) return; store.del(key); stopped = true; cleanup();
        if (S.open && r) liftSummary(el, aid, r); else { go(`/track?done=${aid}`, {replace: true}); toast(S.open ? 'Session saved' : 'Saved'); }
      }
      catch (x) { if (!live()) return; finishing = false; $$('button,input', el).forEach(x => x.disabled = false); toast(x.offline ? (store.get(key)?.unsent ? "Can't reach Kinetta - your sets are kept on this phone. Try again when you're back online." : "Can't reach Kinetta. Keep this screen open and try again.") : x.message); }
    };
    if (S.open && open) sheet('Finish the session?', `<p>${open} set${open > 1 ? 's are' : ' is'} not ticked off. ${open > 1 ? "They're" : "It's"} left out of the session.</p>
      <div class="btnrow"><button class="ghost" data-close>Keep going</button><button class="primary" id="ff-yes">Finish</button></div>`, (b, close) => { $('#ff-yes', b).onclick = () => { close(); finish(); }; });
    else finish();
  };
  const dis = $('#lf-discard', el);
  if (dis) dis.onclick = () => discardLift(aid, () => { clearTimeout(saveT); saveT = null; stopped = true; return () => { stopped = false; if (live()) save(); }; });
  draw();
  if (store.get(key) && store.get(key).unsent) save();     // a copy from earlier that never reached the server
}

// ---------- discarding ----------
// A session you don't want to keep goes completely, before or right after Finish (28 October 2026, owner: people may
// not want to post it at all). Until Finish nobody else sees it; this removes it for good.
function discardLift(aid, stop) {
  const owner = readOwner(), key = liftKey(aid), origin = location.pathname + location.search;
  sheet('Delete this session?', '<p>Its exercises and sets are deleted, and it won’t be posted. This can’t be undone.</p><button class="ghost wide" id="ld-keep">Keep it</button><button class="primary danger-btn wide" id="ld-del">Delete session</button>', (b, close) => {
    $('#ld-keep', b).onclick = close;
    $('#ld-del', b).onclick = async (e) => {
      if (owner !== readOwner()) return;
      e.target.disabled = true; const resume = stop?.();
      try { await queueLift(key, () => { if (owner !== readOwner()) throw Object.assign(Error('Account changed'), {stale: true}); return api(`/api/activities/${aid}`, {method: 'DELETE'}); }); }
      catch (x) { if (x.status !== 404) { if (owner === readOwner()) { resume?.(); if (b.isConnected) e.target.disabled = false; if (!x.stale) toast(x.message); } return; } }   // already gone is fine
      if (owner !== readOwner()) return;
      store.del(key); invalidate('/api/'); App.cache.delete('feed:home'); close(); if (location.pathname + location.search === origin) go('/track', {replace: true}); toast('Session deleted');
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
  const owner = readOwner(), active = () => el.isConnected && owner === readOwner();
  invalidate(`/api/activities/${aid}`);
  let a;
  try { a = await api(`/api/activities/${aid}`); } catch (x) { if (!active()) return; go(`/track?done=${aid}`, {replace: true}); toast('Session saved'); return; }
  if (!active()) return;
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
  window.scrollTo(0, 0); // Finish starts at the title and totals, even after logging near the bottom.
  wireBack(el, '/track');
  const f = $('#lf-sum', el), err = $('#lf-sum-error', el), done = $('#lf-sum-done', el), carry = $('#lf-carry', el);
  f.onsubmit = async (ev) => {
    ev.preventDefault(); if (!active()) return; done.disabled = carry.disabled = true; err.textContent = '';
    const name = f.activity_name.value.trim(), visibility = f.visibility.value;
    try {
      if (name && name !== a.name) await api(`/api/activities/${aid}`, json('PATCH', {name}));
      if (visibility !== a.visibility) { await api(`/api/activities/${aid}/sharing`, json('PUT', {visibility})); if (typeof socialChanged === 'function') socialChanged(aid); }
      if (!active()) return; invalidate('/api/'); App.cache.delete('feed:home'); go(`/track?done=${aid}`, {replace: true}); toast('Session saved');
    } catch (x) { if (!active()) return; done.disabled = carry.disabled = false; err.textContent = x.offline ? "Can't reach Kinetta. The session is saved; try again to keep the new title or sharing." : x.message; }
  };
  $('#lf-sum-del', el).onclick = () => discardLift(aid);
  // finished by mistake: back into the logger, within the session's 4 hours (unticked sets were already left out)
  carry.onclick = async () => {
    if (!active()) return; done.disabled = carry.disabled = true;
    try { await api(`/api/activities/${aid}/lifts/reopen`, json('POST', {})); invalidate('/api/'); const data = await api(`/api/activities/${aid}/lifts`); if (active()) { window.scrollTo(0, 0); liftLogger(el, aid, data); } }
    catch (x) { if (!active()) return; done.disabled = carry.disabled = false; toast(x.message); }
  };
}


function noteSheet(e, after) {
  const owner = readOwner();
  sheet('Note for next time', `<form class="form" id="nt"><textarea name="note" maxlength="500" rows="3" placeholder="e.g. seat on 4, narrow grip">${esc(e.note || '')}</textarea>
    <p class="small muted">Shown with ${esc(e.name)} every time you log it.</p><div class="actions"><button class="primary">Save note</button></div></form>`, (b, close) => {
    $('#nt', b).onsubmit = async (ev) => {
      ev.preventDefault(); if (!b.isConnected || owner !== readOwner()) return; const note = $('textarea', b).value.trim();
      try { await api(`/api/lifts/exercises/${e.exercise_id || e.id}`, json('PATCH', {note})); if (!b.isConnected || owner !== readOwner()) return; e.note = note || null; invalidate('/api/lifts'); close(); after(); }
      catch (x) { toast(x.message); }
    };
  });
}

// ---------- choosing an exercise ----------
// Yours first (most recent), then the common ones by muscle group; typing filters both, and a new name can be added.
function exercisePicker(skip, pick) {
  sheet('Add exercise', `<input type="search" id="xp-q" placeholder="Search or type a new one" autocomplete="off" enterkeyhint="done">
    <div id="xp-list">${skel(1)}</div>`, async (b, close) => {
    const owner = readOwner(), active = () => b.isConnected && !b.closest('.scrim')?.inert && owner === readOwner();
    let all, choosing = false;
    const fetchExercises = async () => {
      try { const result = await api('/api/lifts/exercises'); if (active()) { all = result; draw(); } }
      catch (x) { if (active()) { $('#xp-list', b).innerHTML = `<p class="err">${esc(x.message)}</p><button class="ghost wide" id="xp-retry">Try again</button>`; $('#xp-retry', b).onclick = fetchExercises; } }
    };
    const q = $('#xp-q', b);
    const row = (x, mine) => `<button type="button" class="row-link" data-name="${esc(x.name)}"${mine ? ` data-id="${x.id}"` : ''}><span class="grow"><span>${esc(x.name)}</span>
      ${mine && x.last ? `<small class="muted">Last: ${esc(shortDay(x.last))}</small>` : ''}</span>${svg('plus', 'xp-plus')}</button>`;
    const draw = () => {
      if (!active() || !all) return;
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
      if (!active() || choosing) return; choosing = true;
      try {
        const ex = id ? all.mine.find((x) => x.id === +id) : await api('/api/lifts/exercises', json('POST', {name, kind}));
        if (!active()) return; invalidate('/api/lifts'); close(); pick(ex);
      } catch (x) { if (active()) { choosing = false; toast(x.message); } }
    };
    const newKind = (name) => pickSheet(`How is ${name} measured?`, pickRows(KINDS.map(([k, n]) => [k, n, k === 'weight' ? 'Most lifts: a weight, lifted a number of times' : k === 'body' ? 'Push-ups, pull-ups: reps (you can add weight later)' : 'Planks and holds: seconds'])), (k) => choose(name, null, k));
    q.oninput = draw; fetchExercises();
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
    box.innerHTML = `<div class="card empty"><b>No lifting yet</b>Log your sets to build exercise history and records.</div><button class="primary wide" id="lv-start">Start lifting</button>`;
    $('#lv-start', box).onclick = startLiftSheet;
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
  el.innerHTML = `<div class="top">${backBtn('Lifting')}</div>${skel(2)}`;
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
  el.classList.add('compact-lift-exercise');
  el.innerHTML = `<div class="top">${backBtn('Lifting')}<div class="acts"><button class="icon-btn" id="lx-edit" aria-label="Edit exercise">${svg('edit')}</button></div></div>
    <div class="card lx-head"><div class="lx-title"><div class="eyebrow">${esc(e.muscle || KINDS.find((k) => k[0] === kind)[1])}</div><h1>${esc(e.name)}</h1></div>
      <p class="muted lx-meta">${e.sessions} session${e.sessions === 1 ? '' : 's'}${e.last ? ` · last ${esc(shortDay(e.last))}` : ''}</p>
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
    box.innerHTML = `<div class="lift-card-head"><h2>Exercises</h2><a class="linkbtn" href="/track/lift/${a.id}">Edit sets</a></div>
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
