// Kinetta — Part 4: training plans. 5K / 10K / half / marathon,
// first-timer to advanced. The server builds the weeks (plans.py). Here: a numbered setup with a live preview and a
// start button that stays in view; the plan itself with progress so far, today, this week, plan details, paces and
// every week; tap any workout for its details. Found from Today, Progress > Plan and Me > Training plan.
'use strict';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pday = (iso, o = {weekday: 'short', month: 'short', day: 'numeric'}) => new Date(iso + 'T12:00').toLocaleDateString([], o);
const HARD = ['tempo', 'intervals', 'hills', 'long_pace', 'race'];
const WHY = {
  easy: 'Builds your aerobic base and lets you recover. Most of your running should feel like this.',
  recovery: 'Loosens your legs after the long run without adding stress.',
  long: 'Teaches your body to keep going for longer - the most important run of the week.',
  long_pace: 'Practises race pace on tired legs, so race day feels familiar.',
  medium_long: 'A second, mid-week longer run builds endurance without another full long run.',
  tempo: 'Raises the pace you can hold for a long time (your lactate threshold).',
  intervals: 'Sharpens your top-end fitness (VO2max) and running form.',
  hills: 'Builds strength and power with less pounding than fast running on the flat.',
  fartlek: 'A relaxed introduction to running a little faster.',
  runwalk: 'Builds up gradually so your body adapts without getting hurt.',
  race: 'Race day - trust your training and enjoy it.',
};
const pring = (f) => { const R = 34, C = 2 * Math.PI * R; return `<div class="ring"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="rb"/>
  <circle cx="40" cy="40" r="${R}" class="rf" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg><div><b class="num">${Math.round(f * 100)}%</b><small>done</small></div></div>`; };
const STATUS = {done: 'Done', today: 'Today', missed: 'Missed', upcoming: 'Coming up', before: 'Before the plan started'};

function workoutRow(w, U = '') {
  const d = new Date(w.day + 'T12:00'), st = w.status || '';
  const badge = st === 'done' ? `<span class="badge good">${svg('check')} ${w.activity_id && w.dist && !w.by_hand ? `${esc(w.actual)} ${esc(U)}` : 'Done'}</span>`
    : w.short ? `<span class="badge">Ran ${esc(w.actual)} of ${esc(w.dist)} ${esc(U)}</span>`
    : st === 'today' ? '<span class="badge today">Today</span>' : st === 'missed' ? '<span class="badge">Missed</span>' : '';
  return `<button class="pw ${esc(st)}" data-wday="${esc(w.day)}"><div class="pw-day"><small>${DOW[(d.getDay() + 6) % 7]}</small><b class="num">${d.getDate()}</b></div>
    <div class="pw-main"><b>${esc(w.title)}${HARD.includes(w.type) ? ' <span class="pw-hard">hard</span>' : ''}</b><small>${esc(w.detail)}</small>${badge ? `<div class="badges">${badge}</div>` : ''}</div>
    <span class="chev">${svg('chev')}</span></button>`;
}
function wireWorkouts(box, d) {
  $$('[data-wday]', box).forEach((b) => b.onclick = () => {
    const w = d.weeks.flatMap((wk) => wk.workouts).find((x) => x.day === b.dataset.wday);
    if (w) workoutSheet(w, d.plan.unit);
  });
}
// Ticks (2026-10-12): a run that day of at least the planned distance ticks it off by itself; any workout, past or
// future, can be ticked off or unticked by hand (a treadmill run, a watch left at home, a run that didn't count)
function workoutSheet(w, U) {
  const done = w.status === 'done', ran = w.activity_id ? `You ran ${w.actual} ${U} that day.` : '';
  const auto = w.dist ? `Run at least ${w.dist} ${U} that day and it ticks off by itself` : 'Record a run that day and it ticks off by itself';
  const note = done ? (w.by_hand ? `Done - ticked off by hand. ${ran}` : `Done - you ran ${w.actual} ${U}.`)
    : w.by_hand ? `Marked as not done. ${ran}`
    : w.short ? `You ran ${w.actual} of ${w.dist} ${U}, short of the plan. Tick it off yourself if it counts.`
    : w.status === 'missed' ? `Missed - no run recorded that day. Tick it off if you did it without recording.`
    : w.status === 'before' ? STATUS.before : `${auto}, or tick it off yourself.`;
  sheet(w.title, `<p class="muted">${esc(pday(w.day, {weekday: 'long', month: 'long', day: 'numeric'}))}${w.dist ? ` · ${esc(w.dist)} ${esc(U)}` : w.minutes ? ` · about ${esc(w.minutes)} min` : ''}</p>
    <div class="card flat"><h3 class="ghead">What to do</h3><p>${esc(w.detail)}</p>
      <h3 class="ghead">Why</h3><p>${esc(WHY[w.type] || '')}</p></div>
    <p class="small muted">${esc(note.trim())}</p>
    ${w.activity_id ? `<a class="ghost wide" href="/activity/${w.activity_id}">See the run you did</a>` : ''}
    ${done ? '<button class="ghost wide" id="pw-undo">Not done after all</button>' : `<button class="primary wide" id="pw-done">${svg('check')}Mark as done</button>`}`, (b, close) => {
    const a = $('a.ghost', b); if (a) a.addEventListener('click', () => close());
    const set = async (btn, on) => {
      btn.disabled = true;
      try {
        // unticking a day ticked by hand with no run just clears the tick; with a run it has to say "not done"
        await api(on || w.activity_id ? '/api/plans/current/marks' : '/api/plans/current/marks/' + w.day, on || w.activity_id ? json('POST', {day: w.day, done: on}) : {method: 'DELETE'});
        invalidate('/api/plans'); close(); toast(on ? 'Workout ticked off' : 'Tick removed'); render();
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
    const d = $('#pw-done', b); if (d) d.onclick = () => set(d, true);
    const u = $('#pw-undo', b); if (u) u.onclick = () => set(u, false);
  });
}

// ---------- Today card ----------
function planCard(box) {
  return load('/api/plans/current', (d) => {
    if (!box.isConnected) return;
    if (!d.plan) {
      let hidden = false; try { hidden = localStorage.getItem('fit.plan.promo') === 'hidden'; } catch (e) { /* none */ }
      box.innerHTML = hidden ? '' : `<div class="card plan-promo"><h2>Training for a race?</h2>
        <p class="small muted">5K, 10K, half or marathon plans - beginner to advanced, with paces from your own fitness.</p>
        <div class="btnrow"><a class="primary" href="/plan">Choose a plan</a><button class="ghost" id="tp-hide">Not now</button></div>
        <p class="small muted">You can always find plans under Progress &gt; Plan.</p></div>`;
      const h = $('#tp-hide', box); if (h) h.onclick = () => { try { localStorage.setItem('fit.plan.promo', 'hidden'); } catch (e) { /* none */ } box.innerHTML = ''; };
      return;
    }
    const p = d.plan, w = d.today_workout, n = d.next_workout, pr = d.progress || {};
    const started = d.today >= p.start_day;
    const head = d.days_to_race > 0 ? `${d.days_to_race} day${d.days_to_race === 1 ? '' : 's'} to go` : d.days_to_race === 0 ? 'Race day!' : 'Finished';
    const wk = d.this_week ? `Week ${d.this_week} of ${p.weeks}` : started ? 'Plan finished' : `Starts ${pday(p.start_day)}`;
    const show = w || n, ran = d.today_run;
    // a run today on a rest day still shows (2026-10-12: "it is not registering that I worked out")
    const rest = ran && !w ? `<a class="pt-w ran" href="/activity/${ran.activity_id}"><small>${svg('check')} You ran ${esc(ran.actual)} ${esc(p.unit)} today</small>
      <b>Rest day on the plan</b><span class="small">Extra running counts toward this week. Next: ${esc(n ? `${n.title}, ${pday(n.day, {weekday: 'long'})}` : 'race day')}</span></a>` : '';
    box.innerHTML = `<div class="card plan-today"><h2>${esc(p.race_name)} plan<span class="muted small">${esc(head)}</span></h2>
      ${started ? `<div class="ptrack"><div class="bar" data-w="${Math.min(1, (d.this_week ? d.this_week - 1 : p.weeks) / p.weeks).toFixed(3)}"></div></div>` : ''}
      <p class="small muted">${esc(wk)}${pr.workouts_due ? ` · ${pr.workouts_done} of ${pr.workouts_due} workouts done so far` : ''}</p>
      ${rest || (show ? `<button class="pt-w ${esc(w ? w.status : '')}" data-wday="${esc(show.day)}"><small>${w ? (w.status === 'done' ? 'Done today' : 'Today') : started ? `Rest day today · next ${esc(pday(n.day, {weekday: 'long'}))}` : `First run · ${esc(pday(n.day, {weekday: 'long', month: 'short', day: 'numeric'}))}`}</small>
        <b>${esc(show.title)}</b><span class="small">${esc(show.detail)}</span></button>` : '')}
      <a class="ghost wide" href="/plan">Open my plan</a></div>`;
    wireWorkouts(box, d);
  });
}

// ---------- the plan (also Progress > Plan) ----------
route(/^\/plan$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search);
  el.innerHTML = `<div class="top">${backBtn('Back')}</div><h1>Training plan</h1><div id="pl">${skel(2)}</div>`;
  wireBack(el, '/progress');
  await planInto($('#pl', el), q.get('new'));
});
async function planInto(box, fresh) {
  const d = await api('/api/plans/current');
  if (!d.plan || fresh) return planSetup(box, d.plan);
  planOverview(box, d);
}

function planOverview(box, d) {
  const p = d.plan, U = p.unit, pr = d.progress || {}, s = d.summary || {}, fmtT = (x) => (x ? dur(x) : '–');
  const cur = d.weeks.find((w) => w.n === d.this_week) || d.weeks.find((w) => w.start > d.today) || d.weeks[d.weeks.length - 1];
  const pc = d.paces || {};
  const paceRow = (name, v, what) => v ? `<div class="pace-row"><span><b>${esc(name)}</b><small class="muted">${esc(what)}</small></span><b class="num">${esc(Array.isArray(v) ? `${v[0].split('/')[0]}–${v[1]}` : v)}</b></div>` : '';
  const goalKey = {'5k': '5k', '10k': '10k', half: 'hmp', marathon: 'mp'}[p.race];
  const started = d.today >= p.start_day, w = d.today_workout, n = d.next_workout;
  const weekPct = Math.min(1, (d.this_week ? d.this_week - 1 + (new Date(d.today + 'T12:00').getDay() + 6) % 7 / 7 : started ? p.weeks : 0) / p.weeks);
  const detail = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  box.innerHTML = `
    <div class="card plan-hero"><div class="ph-top"><div><small class="muted">${esc(p.level_name)} · ${p.weeks} weeks</small><h2>${esc(p.race_name)}</h2>
        <p class="small muted">Race day ${esc(pday(p.race_day, {weekday: 'short', month: 'long', day: 'numeric', year: 'numeric'}))}</p></div>
        <div class="ph-ring" role="img" aria-label="${Math.round(weekPct * 100)}% of the plan done">${pring(weekPct)}</div></div>
      <p class="ph-week">${d.this_week ? `Week ${d.this_week} of ${p.weeks} · ${esc(cur.phase)}` : started ? 'Plan finished' : `Starts ${esc(pday(p.start_day, {weekday: 'long', month: 'short', day: 'numeric'}))}`}</p>
      <div class="stats3">${stat(d.days_to_race >= 0 ? 'Days to go' : 'Finished', d.days_to_race >= 0 ? d.days_to_race : '✓')}${stat('Predicted', fmtT(d.predicted_s))}${stat('Goal', p.goal_s ? fmtT(p.goal_s) : 'none')}</div></div>
    ${w || n ? `<div class="card"><h2>${w ? 'Today' : started ? 'Next workout' : 'Your first workout'}</h2>${workoutRow(w || n, U)}</div>` : ''}
    <div class="card"><h2>Progress so far</h2>
      <div class="stats3">${stat('Workouts', `${pr.workouts_done || 0}/${pr.workouts_due || 0}`)}${stat('Distance', `${pr.done_so_far || 0}`, `/${pr.planned_so_far || 0} ${U}`)}${stat('Weeks done', `${pr.weeks_done || 0}/${p.weeks}`)}</div>
      <div id="pl-chart"></div>
      <p class="small muted">${pr.workouts_due ? 'Light bars are planned, solid bars are done: what you ran, plus the planned distance of workouts you tick off by hand. A run at least the planned distance ticks that day off by itself.' : 'Your progress shows here once the plan starts - every run you record counts.'}</p></div>
    <div class="card"><h2>${cur.n === d.this_week ? 'This week' : `Week ${cur.n}`}<span class="muted small">${esc(cur.phase)} · ${cur.done} of ${cur.planned} ${esc(U)}</span></h2>
      ${cur.workouts.map((x) => workoutRow(x, U)).join('')}<p class="small muted">Days not listed are rest days. Tap a workout for details.</p></div>
    <div class="card"><h2>About this plan</h2><p class="small">${esc(d.level_desc || '')}</p>
      ${detail('Race', `${p.race_name}${p.goal_s ? `, goal ${fmtT(p.goal_s)}` : ''}`)}${detail('Level', p.level_name)}${detail('Length', `${p.weeks} weeks`)}
      ${detail('Runs a week', p.runs)}${detail('Long run', p.long_day === 6 ? 'Sundays' : 'Saturdays')}${detail('Starts', pday(p.start_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}
      ${detail('Race day', pday(p.race_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}
      ${s.peak_week ? detail('Biggest week', `${s.peak_week} ${U}`) + detail('Longest run', `${s.longest} ${U}`) : ''}${s.hard_per_week ? detail('Hard days', `up to ${s.hard_per_week} a week`) : ''}
      <h3 class="ghead">How it's built</h3><p class="small">${p.level === 'first' ? 'Run/walk sessions that slowly swap walking for running, until you can run 30 minutes and then a 5K.'
        : `<b>Base</b>: easy miles to build up. <b>Build</b> and <b>Peak</b>: more distance and harder sessions. Every 4th week is a lighter <b>cutback</b> week so your body absorbs the training. <b>Taper</b> (last ${d.taper_weeks} week${d.taper_weeks > 1 ? 's' : ''}): less running, so you start the race fresh.`}</p></div>
    <div class="card"><h2>Your paces</h2>
      ${d.vdot ? paceRow('Easy & long runs', pc.easy, 'chatty, relaxed - most of your running') + paceRow('Recovery', pc.recovery, 'the day after a long run') +
        paceRow('Tempo', pc.tempo, 'comfortably hard, about 1-hour race pace') + paceRow('Intervals', pc.intervals, 'hard repeats, about 5K effort') +
        paceRow(p.goal_s ? 'Goal race pace' : 'Predicted race pace', p.goal_s ? pc.goal : pc[goalKey], p.goal_s ? `for your ${fmtT(p.goal_s)} goal` : 'from your current fitness')
        + '<p class="small muted">From your best recent run; they update as you get faster. In heat, on hills or on tired legs, go by feel.</p>'
        : '<p class="small">No fast runs recorded yet, so go by feel:</p><ul class="small"><li><b>Easy</b>: you can talk in full sentences.</li><li><b>Tempo</b>: comfortably hard, a few words at a time.</li><li><b>Intervals</b>: hard but controlled, like a 5K race.</li></ul>'}</div>
    <div class="card"><h2>All weeks</h2>${d.weeks.map((wk) => `<details class="pweek"${wk.n === cur.n ? ' open' : ''}><summary><span><b>Week ${wk.n}</b> · ${esc(wk.phase)}<small class="muted"> · ${esc(pday(wk.start, {month: 'short', day: 'numeric'}))}</small></span><span class="small num">${wk.done ? `${wk.done} / ` : ''}${wk.planned} ${esc(U)}</span></summary>${wk.workouts.map((x) => workoutRow(x, U)).join('')}</details>`).join('')}</div>
    <div class="card"><h2>Manage plan</h2>
      <div class="btncol"><a class="ghost" href="/plan?new=1">Change race, level or days</a>
      <button class="ghost" id="pl-restart">Restart from week 1</button>
      <button class="ghost danger" id="pl-end">End plan</button></div>
      <p class="small muted">Changing or restarting builds a new schedule; your recorded runs are always kept.</p></div>`;
  wireWorkouts(box, d);
  planChart($('#pl-chart', box), d);
  $('#pl-restart', box).onclick = async () => {
    if (!confirm(`Start this ${p.race_name} plan again from week 1?`)) return;
    try { await api('/api/plans/restart', json('POST', {})); invalidate('/api/plans'); toast('Plan restarted from week 1'); render(); } catch (x) { toast(x.message); }
  };
  $('#pl-end', box).onclick = async () => {
    if (!confirm('End this training plan? Your runs stay; only the schedule goes.')) return;
    try { await api('/api/plans/current', {method: 'DELETE', body: '{}'}); invalidate('/api/plans'); toast('Plan ended'); render(); } catch (x) { toast(x.message); }
  };
}

// planned (light) vs ran (solid) per week, this week outlined
function planChart(box, d) {
  const W = Math.max(300, box.clientWidth || 340), H = 110, padB = 16, n = d.weeks.length;
  const max = Math.max(1, ...d.weeks.map((w) => Math.max(w.planned, w.done))), bw = W / n, Y = (v) => (H - padB) * (1 - v / max);
  if (!d.weeks.some((w) => w.planned)) { box.innerHTML = ''; return; }
  let g = '';
  d.weeks.forEach((w, i) => {
    const x = i * bw + bw * .14, ww = bw * .72;
    g += `<rect class="pc-plan${w.n === d.this_week ? ' cur' : ''}" x="${x.toFixed(1)}" y="${Y(w.planned).toFixed(1)}" width="${ww.toFixed(1)}" height="${(H - padB - Y(w.planned)).toFixed(1)}" rx="3"/>`;
    if (w.done) g += `<rect class="pc-done" x="${x.toFixed(1)}" y="${Y(Math.min(w.done, max)).toFixed(1)}" width="${ww.toFixed(1)}" height="${(H - padB - Y(Math.min(w.done, max))).toFixed(1)}" rx="3"/>`;
    if (i === 0 || i === n - 1 || w.n === d.this_week || (n > 10 ? w.n % 4 === 0 : true)) g += `<text class="yl" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${w.n}</text>`;
  });
  box.innerHTML = `<div class="chartbox pchart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Planned and completed distance per week">${g}</svg></div>
    <div class="legend small"><span><i class="sw pc-plan-sw"></i>Planned</span><span><i class="sw pc-done-sw"></i>Done</span><span class="muted">week numbers below</span></div>`;
}

// ---------- choosing a plan ----------
async function planSetup(box, existing) {
  const o = await api('/api/plans/options');
  const S = existing ? {race: existing.race, level: existing.level, weeks: existing.weeks, runs: existing.runs, long_day: existing.long_day, race_day: existing.race_day, goal_s: existing.goal_s}
    : {race: 'half', level: o.suggest_level === 'first' ? 'beginner' : o.suggest_level, weeks: null, runs: null, long_day: 6, race_day: '', goal_s: null};
  const UN = o.unit;   // 'mi' or 'km' for this plan's words (U is the app's unit helper)
  const race = () => o.races.find((r) => r.key === S.race);
  const level = () => race().levels.find((l) => l.key === S.level) || race().levels[0];
  const fixLevel = () => { if (!race().levels.some((l) => l.key === S.level)) S.level = race().levels.find((l) => l.key === o.suggest_level) ? o.suggest_level : 'beginner'; };
  // Goal finish time (2026-10-12, Ben: "total time or pace?"): hours, minutes and seconds boxes for the whole race, with
  // the pace it means shown underneath, instead of one box that read "3:15" differently by race
  const RACE_M = {'5k': 5000, '10k': 10000, half: 21097.5, marathon: 42195};
  const hms = (t) => (t ? [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60] : ['', '', '']);
  const readGoal = (f) => {
    const [h, m, sec] = ['gh', 'gm', 'gs'].map((k) => f[k].value.trim());
    if (!h && !m && !sec) return null;
    const t = (+h || 0) * 3600 + (+m || 0) * 60 + (+sec || 0);
    return t >= 600 ? t : null;     // under 10 minutes isn't a race time yet (still typing)
  };
  const paceLine = (t) => (t ? `That's <b>${esc(U.pace(t / RACE_M[S.race] * 1000))}${esc(U.pu())}</b> for the whole ${esc(race().name)}.` : `Leave it empty to train from your current fitness${race().predicted_s ? ` (predicted ${esc(dur(race().predicted_s))})` : ''}.`);
  const step = (n, t) => `<h2 class="step"><span class="stepn">${n}</span>${esc(t)}</h2>`;
  let timer, seq = 0;
  const draw = () => {
    fixLevel();
    const R = race(), L = level();
    if (!R.weeks.includes(S.weeks)) S.weeks = R.default_weeks;
    if (!S.runs || S.runs < L.runs[0] || S.runs > L.runs[1]) S.runs = L.runs[2];
    const first = S.level === 'first';
    box.innerHTML = `${existing ? '<div class="callout">Starting a new plan replaces your current one. Your runs are kept.</div>' : '<p class="muted">Five quick choices. Your plan appears at the bottom as you go.</p>'}
      <div class="card">${step(1, 'Pick your race')}<div class="chips wrap">${o.races.map((r) => `<button class="chip" data-race="${r.key}" aria-pressed="${r.key === S.race}">${esc(r.name)}</button>`).join('')}</div>
        ${R.predicted_s ? `<p class="small muted">Your predicted ${esc(R.name)} time today: <b>${esc(dur(R.predicted_s))}</b></p>` : ''}</div>
      <div class="card">${step(2, 'Choose your level')}${R.levels.map((l) => `<button class="lvl" data-level="${l.key}" aria-pressed="${l.key === S.level}"><span class="lvl-top"><b>${esc(l.name)}</b>${l.key === o.suggest_level ? '<span class="badge">suggested for you</span>' : ''}</span><small>${esc(l.desc)}</small>
          <small class="muted">${l.key === 'first' ? '3 run/walk sessions a week · 9 weeks' : `${l.runs[0] === l.runs[1] ? l.runs[0] : `${l.runs[0]}-${l.runs[1]}`} runs a week · up to ${l.peak_week} ${UN} a week · longest run ${l.longest} ${UN}`}${l.quality ? ` · ${l.quality} hard day${l.quality > 1 ? 's' : ''} a week` : ''}</small></button>`).join('')}
        <p class="small muted">You've averaged ${esc(o.recent_weekly)} ${UN} a week over the last 4 weeks.</p></div>
      <div class="card">${step(3, 'Length and days')}
        ${first ? '<p class="small">The first-timer plan is 9 weeks, 3 sessions a week.</p>' : `<h3 class="ghead">Plan length</h3><div class="chips wrap">${R.weeks.map((w) => `<button class="chip" data-weeks="${w}" aria-pressed="${w === S.weeks}">${w} weeks</button>`).join('')}</div>
        <h3 class="ghead">Runs a week</h3><div class="chips wrap">${Array.from({length: L.runs[1] - L.runs[0] + 1}, (_, i) => L.runs[0] + i).map((x) => `<button class="chip" data-runs="${x}" aria-pressed="${x === S.runs}">${x} runs</button>`).join('')}</div>`}
        <h3 class="ghead">Long run on</h3><div class="seg full" role="group" aria-label="Long run day"><button data-ld="5" aria-pressed="${S.long_day === 5}">Saturday</button><button data-ld="6" aria-pressed="${S.long_day === 6}">Sunday</button></div></div>
      <div class="card">${step(4, 'Race date and goal')}<p class="small muted">Both optional.</p>
        <form class="form" id="ps-f"><label>Race date<input type="date" class="datefield" name="race_day" value="${esc(S.race_day || '')}" min="${esc(o.today)}"></label>
        <p class="small muted ps-note">${S.race_day ? "The plan is counted back from race day." : `Without a date the plan starts ${[0, 4, 5, 6].includes(new Date(o.today + 'T12:00').getDay()) ? 'next Monday' : 'this Monday'}.`}${S.race_day ? ' <button type="button" class="linkbtn" id="ps-nodate">No race date</button>' : ''}</p>
        <fieldset class="goaltime"><legend>Goal finish time</legend>
          <div class="hms">${['gh', 'gm', 'gs'].map((k, i) => `<label><input name="${k}" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="${['0', '00', '00'][i]}" value="${hms(S.goal_s)[i] === '' ? '' : String(hms(S.goal_s)[i]).padStart(i ? 2 : 1, '0')}" aria-label="${['Hours', 'Minutes', 'Seconds'][i]}"><span>${['hours', 'minutes', 'seconds'][i]}</span></label>`).join('')}</div>
          <p class="small muted" id="ps-pace">${paceLine(S.goal_s)}</p></fieldset></form></div>
      <div class="card" id="ps-prev">${skel(1)}</div>
      <div class="startbar"><button class="primary" id="ps-go">${existing ? 'Replace my plan' : 'Start this plan'}</button></div>`;
    $$('[data-race]', box).forEach((b) => b.onclick = () => { S.race = b.dataset.race; S.goal_s = null; draw(); });
    $$('[data-level]', box).forEach((b) => b.onclick = () => { S.level = b.dataset.level; S.runs = null; draw(); });
    $$('[data-weeks]', box).forEach((b) => b.onclick = () => { S.weeks = +b.dataset.weeks; draw(); });
    $$('[data-runs]', box).forEach((b) => b.onclick = () => { S.runs = +b.dataset.runs; draw(); });
    $$('[data-ld]', box).forEach((b) => b.onclick = () => { S.long_day = +b.dataset.ld; draw(); });
    const f = $('#ps-f', box);
    f.race_day.onchange = () => { S.race_day = f.race_day.value; draw(); };
    const nd = $('#ps-nodate', box); if (nd) nd.onclick = () => { S.race_day = ''; draw(); };
    $$('.hms input', f).forEach((inp) => inp.oninput = () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
      S.goal_s = readGoal(f); $('#ps-pace', box).innerHTML = paceLine(S.goal_s);
      clearTimeout(timer); timer = setTimeout(preview, 500);
    });
    f.onsubmit = (e) => e.preventDefault();
    $('#ps-go', box).onclick = async () => {
      const b = $('#ps-go', box); b.disabled = true; b.textContent = 'Building your plan…';
      try { await api('/api/plans', json('POST', body())); invalidate('/api/plans'); toast('Your plan is ready'); go('/plan', {replace: true}); }
      catch (x) { toast(x.message); b.disabled = false; draw(); }
    };
    preview();
  };
  const body = () => ({race: S.race, level: S.level, weeks: S.weeks || 9, runs: S.runs || 3, long_day: S.long_day, race_day: S.race_day || null, goal_s: S.goal_s || null});
  const preview = async () => {
    const my = ++seq, pv = $('#ps-prev', box), go_ = $('#ps-go', box);
    try {
      const r = await api('/api/plans/preview', json('POST', body()));
      if (my !== seq || !pv.isConnected) return;
      const s = r.summary;
      pv.innerHTML = `${step(5, 'Your plan')}<p><b>${esc(race().name)} · ${esc(level().name)} · ${s.weeks} weeks</b><br><span class="muted">${esc(pday(r.start_day))} → race ${esc(pday(r.race_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}</span></p>
        ${S.level === 'first' ? '' : `<div class="stats3 big">${stat('Week 1', s.first_week, UN)}${stat('Biggest week', s.peak_week, UN)}${stat('Longest run', s.longest, UN)}</div>`}
        ${r.warning ? `<div class="callout warn">${esc(r.warning)}</div>` : ''}
        <h3 class="ghead">Week 1</h3>${r.weeks[0].workouts.map((w) => workoutRow(w, UN)).join('')}`;
      wireWorkouts(pv, {plan: {unit: UN}, weeks: r.weeks});
      go_.disabled = false; go_.textContent = `${existing ? 'Replace with' : 'Start'} this ${s.weeks}-week plan`;
    } catch (x) { if (my === seq && pv.isConnected) { pv.innerHTML = `${step(5, 'Your plan')}<p class="err">${esc(x.message)}</p>`; go_.disabled = true; } }
  };
  draw();
}
