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
      <div class="pick-list sl-routines">${recent.map((s) => `<div class="sl-routine"><button type="button" class="row-link sl-repeat" data-copy="${s.id}"><span class="grow"><span>${esc(s.name)}</span>
        <small class="muted">${esc(shortDay(s.start_time))} · ${esc(s.exercises.slice(0, 3).join(', '))}${s.exercises.length > 3 ? ` +${s.exercises.length - 3}` : ''}</small></span></button>
        <button type="button" class="sl-history" data-history="${s.id}" aria-label="View history for ${esc(s.name)}">History</button></div>`).join('')}</div>` : ''}
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
    $$('[data-history]', b).forEach((x) => x.onclick = () => { close(); go(`/lift/history/workout/${x.dataset.history}`); });
    $('#sl-past', b).onclick = () => { close(); addActivitySheet(null, 'workout'); };
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
