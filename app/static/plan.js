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
  runwalk: 'Alternates easy running and walking, building toward 30 minutes. Take extra recovery when needed.',
  race: 'Race day - trust your training and enjoy it.',
};
const planLevelScope=key=>key==='first'?'Three easy run/walk sessions a week.':key==='beginner'?'Mostly easy running and a weekly long run.':key==='intermediate'?'A weekly quality session plus easy and long runs.':'Experienced runners: up to two quality sessions plus easy and long runs.';
const STATUS = {done: 'Done', today: 'Today', missed: 'Missed', upcoming: 'Coming up', before: 'Before the plan started'};

function workoutTone(type) {
  return type==='rest'?'rest':['long','medium_long'].includes(type)?'long':
    ['tempo','intervals','hills','long_pace','race','fartlek'].includes(type)?'hard':
    ['easy','recovery','runwalk'].includes(type)?'easy':'other';
}
const planWeekOpen=new Map();
function compactWorkoutPace(w,paces,plan){
  if(w.adjusted)return '';
  const key={easy:'easy',recovery:'recovery',long:'long',medium_long:'easy',tempo:'tempo',intervals:'intervals',race:plan.goal_s&&paces.goal?'goal':{'5k':'5k','10k':'10k',half:'hmp',marathon:'mp'}[plan.race]}[w.type],value=paces[key];
  return Array.isArray(value)?`${value[0].split('/')[0]}–${value[1]}`:value||'';
}
function workoutLabel(w,U){
  const name={easy:'Easy',recovery:'Recovery',long:'Long',long_pace:'Long',medium_long:'Steady',tempo:'Tempo',intervals:'Intervals',hills:'Hills',fartlek:'Fartlek',runwalk:'Run/walk',race:'Race'}[w.type]||'Run';
  const amount=w.minutes?`${w.minutes} min`:w.dist?`${Math.round(w.dist*100)/100} ${U}`:'';
  return `${name}${amount?' '+amount:''}`;
}
function compactWorkoutRow(w,U,paces,plan){
  if(w.distance_m!=null)w={...w,dist:Math.round(w.dist*100)/100};
  const day=pday(w.day,{weekday:'short',day:'numeric'}),tone=workoutTone(w.type);
  if(w.type==='rest')return `<div class="pw compact-workout plan-rest" data-workout-kind="rest"><time class="pw-date">${esc(day)}</time><span class="plan-day-sport" aria-hidden="true"></span><span class="pw-main"><b>Rest</b></span></div>`;
  const done=w.status==='done',result=done?(w.activity_id&&!w.by_hand&&w.actual!=null?`${w.actual} ${U}`:'Done'):w.short?'Short':w.status==='missed'?'Missed':w.status==='today'?'Today':'';
  return `<button type="button" class="pw compact-workout ${esc(w.status||'')}" data-workout-kind="${tone}" data-wday="${esc(w.day)}" aria-label="${esc(w.title)}${result?' · '+esc(result):''}"><time class="pw-date">${esc(day)}</time><span class="plan-day-sport">${done?`<span class="plan-day-check" aria-label="Done">${svg('check')}</span>`:sportMark('run')}</span><span class="pw-main"><b>${esc(workoutLabel(w,U))}</b>${result?`<small class="pw-result${done?' plan-completion':''}">${esc(result)}</small>`:''}</span><span class="chev">${svg('chev')}</span></button>`;
}
function planWeekRows(week,U,{compact=false,paces={},plan={}}={}) {
  const byDay=new Map(week.workouts.map(w=>[w.day,w]));
  return Array.from({length:7},(_,i)=>{const day=addDays(week.start,i);return workoutRow(byDay.get(day)||{day,type:'rest',title:'Rest day',detail:'No planned run',status:'rest'},U,{compact,paces,plan});}).join('');
}
function workoutRow(w, U = '', {paces={},plan={}}={}) {
  return compactWorkoutRow(w,U,paces,plan);
}

function wireWorkouts(box, d, {canMark = true} = {}) {
  $$('[data-wday]', box).forEach((b) => b.onclick = () => {
    const w = d.weeks.flatMap((wk) => wk.workouts).find((x) => x.day === b.dataset.wday);
    if (w) workoutSheet(w, d.plan.unit, {canMark,pace:compactWorkoutPace(w,d.paces||{},d.plan)});
  });
}
// Ticks (2026-10-12): a run that day of at least the planned distance ticks it off by itself; any workout, past or
// future, can be ticked off or unticked by hand (a treadmill run, a watch left at home, a run that didn't count)
function workoutSheet(w, U, {canMark = true,pace = ''} = {}) {
  if(w.distance_m!=null)w={...w,dist:Math.round(w.dist*100)/100};
  const done = w.status === 'done', ran = w.activity_id ? `You ran ${w.actual} ${U} that day.` : '';
  const auto = w.duration_s ? `Record at least ${w.minutes} minutes that day to mark attendance` : w.dist ? `Run at least ${w.dist} ${U} that day to mark attendance` : 'Record a run that day to mark attendance';
  const note = !canMark ? 'Save this plan before tracking completion.' : done ? (w.by_hand ? `Done - ticked off by hand. ${ran}` : `Done - you ran ${w.actual} ${U}.`)
    : w.by_hand ? `Marked as not done. ${ran}`
    : w.short ? (w.duration_s ? 'Your recorded run was shorter than the planned time. Mark it done only if you completed it.' : `You ran ${w.actual} of ${w.dist} ${U}, short of the plan. Tick it off yourself if it counts.`)
    : w.status === 'missed' ? `Missed - no run recorded that day. Tick it off if you did it without recording.`
    : w.status === 'before' ? STATUS.before : `${auto}, or tick it off yourself.`;
  sheet(w.title, `<p class="muted">${esc(pday(w.day, {weekday: 'long', month: 'long', day: 'numeric'}))}${w.dist ? ` · ${esc(w.dist)} ${esc(U)}` : w.minutes ? ` · about ${esc(w.minutes)} min` : ''}</p>
    <div class="card flat"><h3 class="ghead">What to do</h3><p>${esc(w.detail)}</p>${pace?`<p class="small muted">${esc(pace)}</p>`:''}
      <h3 class="ghead">Why</h3><p>${esc(WHY[w.type] || '')}</p></div>
    <p class="small muted">${esc(note.trim())}</p>
    ${w.activity_id ? `<a class="ghost wide" href="/activity/${w.activity_id}">See the run you did</a>` : ''}
    ${!canMark ? '' : done ? '<button class="ghost wide" id="pw-undo">Not done after all</button>' : `<button class="primary wide" id="pw-done">${svg('check')}Mark as done</button>`}`, (b, close) => {
    const a = $('a.ghost', b); if (a) a.addEventListener('click', () => close());
    const set = async (btn, on) => {
      if (!canMark || btn.disabled) return;
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
function planCard(box, {onReady} = {}) {
  return load('/api/plans/current', (d) => {
    if (!box.isConnected) return;
    if (!d.plan) { box.innerHTML = ''; onReady?.(); return; }
    const p = d.plan, w = d.today_workout, n = d.next_workout, pr = d.progress || {};
    const started = d.today >= p.start_day;
    const head = d.days_to_race > 0 ? `${d.days_to_race} day${d.days_to_race === 1 ? '' : 's'} to go` : d.days_to_race === 0 ? 'Target day' : 'Finished';
    const wk = d.this_week ? `Week ${d.this_week} of ${p.weeks}` : started ? 'Plan finished' : `Starts ${pday(p.start_day)}`;
    const show = w && w.status !== 'done' ? w : n || w, ran = d.today_run;
    // a run today on a rest day still shows (2026-10-12: "it is not registering that I worked out")
    const rest = ran && !w ? `<a class="pt-w ran" href="/activity/${ran.activity_id}"><small>${svg('check')} You ran ${esc(ran.actual)} ${esc(p.unit)} today</small>
      <b>Rest day on the plan</b><span class="small">Extra running counts toward this week. Next: ${esc(n ? `${n.title}, ${pday(n.day, {weekday: 'long'})}` : 'race day')}</span></a>` : '';
    box.innerHTML = `<div class="card plan-today"><h2>${esc(p.race_name)} plan<a class="more" href="/plan">View plan ›</a></h2>
      ${started ? `<div class="ptrack"><div class="bar" data-w="${Math.min(1, (d.this_week ? d.this_week - 1 : p.weeks) / p.weeks).toFixed(3)}"></div></div>` : ''}
      <p class="small muted">${esc(wk)}${pr.workouts_due ? ` · ${pr.workouts_done} of ${pr.workouts_due} workouts done so far` : ''}</p>
      ${rest || (show ? `<button class="pt-w ${esc(show.status || '')}" data-workout-kind="${workoutTone(show.type)}" data-wday="${esc(show.day)}"><small class="${w?.status==='done'?'plan-completion':''}">${w?.status==='done'?svg('check'):''}${show === w ? (w.status === 'done' ? 'Done today' : 'Today') : started ? `${w && w.status === 'done' ? 'Done today' : 'Rest day today'} · next ${esc(pday(n.day, {weekday: 'long'}))}` : `First run · ${esc(pday(n.day, {weekday: 'long', month: 'short', day: 'numeric'}))}`}</small>
        <b>${esc(show.title)}</b></button>` : '')}
      <p class="small muted plan-meta">${esc(head)}</p></div>`;
    wireWorkouts(box, d);
    onReady?.();
  });
}

// ---------- the plan (also Progress > Plan) ----------
route(/^\/plan$/, 'progress', async (el) => {
  if (typeof progressVisit === 'function') progressVisit('plan');
  const q = new URLSearchParams(location.search);
  el.classList.add('plan-page');
  el.innerHTML = `<header class="top shell-topbar plan-top">${BackCircle('Progress')}<h1>Training plan</h1><div class="acts shell-topbar-actions"><button type="button" class="icon-btn" id="pl-actions" aria-label="Plan options" aria-haspopup="dialog" hidden>${svg('more')}</button></div></header><div id="pl">${skel(2)}</div>`;
  wireBack(el, '/progress');
  await planInto($('#pl', el), q.get('new'), q.get('race_day'));
});
async function planInto(box, fresh, requestedRaceDay = '') {
  const d = await api('/api/plans/current');
  if (!d.plan || fresh) return planSetup(box, d.plan, requestedRaceDay);
  planOverview(box, d);
}

function planOverview(box, d) {
  const p = d.plan, U = p.unit, pr = d.progress || {}, s = d.summary || {}, fmtT = (x) => (x ? dur(x) : '–');
  const cur = d.weeks.find((w) => w.n === d.this_week) || d.weeks.find((w) => w.start > d.today) || d.weeks[d.weeks.length - 1];
  const pc = d.paces || {}, hasGoalPace = !!(p.goal_s && pc.goal);
  const paceRow = (name, v, what) => v ? `<div class="pace-row"><span><b>${esc(name)}</b><small class="muted">${esc(what)}</small></span><b class="num">${esc(Array.isArray(v) ? `${v[0].split('/')[0]}–${v[1]}` : v)}</b></div>` : '';
  const goalKey = {'5k': '5k', '10k': '10k', half: 'hmp', marathon: 'mp'}[p.race];
  const started = d.today >= p.start_day, w = d.today_workout, n = d.next_workout;
  const detail = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const next=w&&w.status!=='done'?w:n,done=cur.workouts.filter(x=>x.status==='done').length,planned=Number(cur.planned)>0;
  const openKey=readOwner()+':'+p.id+':'+cur.n;if(!planWeekOpen.has(openKey))planWeekOpen.set(openKey,new Set([cur.n]));const expanded=planWeekOpen.get(openKey);
  box.classList.add('plan-overview');
  box.innerHTML=`<section class="card compact-plan-summary"><div class="plan-summary-title"><h2>${esc(p.race_name)}</h2><span>${esc(p.level_name)} · ${p.weeks} weeks</span></div>
    <div class="plan-summary-stats">${[[pday(p.race_day),'Race day'],[d.days_to_race>=0?`${d.days_to_race} day${d.days_to_race===1?'':'s'}`:'Finished','Days to go'],[d.predicted_s?fmtT(d.predicted_s):'–','Estimate']].map(([value,label],index)=>`<div class="plan-summary-stat${index===0?' plan-race-date':''}"><b>${esc(value)}</b><small>${esc(label)}</small></div>`).join('')}</div>
    ${next?`<div class="plan-next"><h3>Next workout</h3><div class="plan-next-grid"><button type="button" class="plan-next-workout" data-wday="${esc(next.day)}"><small>${next.day===d.today?'Today':pday(next.day)}${next.minutes?` · about ${esc(next.minutes)} min`:''}</small><b>${esc(next.title)}</b></button><button type="button" class="primary plan-next-start" data-plan-start>Start</button></div><p class="small danger" data-plan-error role="alert"></p></div>`:''}</section>
    <section class="plan-weeks"><div class="plan-weeks-title"><h2>Weeks</h2><span>${cur.planned?`${cur.planned} ${esc(U)} this week`:''}</span></div>
    ${[cur,...d.weeks.filter(wk=>wk.n!==cur.n)].map(wk=>`<details class="pweek${wk.n===cur.n?' current':''}" data-week="${wk.n}"${expanded.has(wk.n)?' open':''}><summary><span class="plan-week-name"><b>Week ${wk.n}</b><span>${esc(wk.phase)}</span></span><span class="small num">${wk.planned?(started&&wk.n<=cur.n?`${wk.done} / `:'')+wk.planned+' '+esc(U):wk.workouts.length+' workouts'}</span></summary>${planWeekRows(wk,U,{compact:true,paces:pc,plan:p})}</details>`).join('')}</section>
    <details class="card plan-extra" id="pl-more"><summary>Plan details & paces</summary>
    <div class="plan-detail-section"><h2>Progress so far</h2>
      <div class="stats3">${stat('Workouts', `${pr.workouts_done || 0}/${pr.workouts_due || 0}`)}${stat('Distance', `${pr.done_so_far || 0}`, `/${pr.planned_so_far || 0} ${U}`)}${stat('Weeks done', `${pr.weeks_done || 0}/${p.weeks}`)}</div>
      <div id="pl-chart"></div>
      <p class="small muted">${pr.workouts_due ? 'Distance or time marks attendance. Tap a workout to correct it.' : 'Your recorded runs appear here once the plan starts.'}</p></div>
    <div class="plan-detail-section"><h2>About this plan</h2><p class="small">${esc(planLevelScope(p.level))}</p>
      ${detail('Race', `${p.race_name}${p.goal_s ? `, goal ${fmtT(p.goal_s)}` : ''}`)}${detail('Level', p.level_name)}${detail('Length', `${p.weeks} weeks`)}
      ${detail('Runs a week', p.runs)}${detail('Long run', p.long_day === 6 ? 'Sundays' : 'Saturdays')}${detail('Starts', pday(p.start_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}
      ${detail('Plan target date', pday(p.race_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}
      ${s.peak_week ? detail('Biggest week', `${s.peak_week} ${U}`) + detail('Longest run', `${s.longest} ${U}`) : ''}${s.hard_per_week ? detail('Hard days', `up to ${s.hard_per_week} a week`) : ''}
      <h3 class="ghead">How it's built</h3><p class="small">${p.level === 'first' ? 'Run/walk sessions that slowly swap walking for running, building toward 30 minutes. Walk breaks are welcome.'
        : 'Easy base, gradual build, cutbacks and a taper before race day.'}</p></div>
    <div class="plan-detail-section"><h2>Your paces</h2>
      ${d.vdot || d.prescription_version===2&&Object.keys(pc).length ? paceRow('Easy & long runs', pc.easy, 'chatty, relaxed - most of your running') + paceRow('Recovery', pc.recovery, 'the day after a long run') +
        paceRow('Tempo', pc.tempo, 'comfortably hard, about 1-hour race pace') + paceRow('Intervals', pc.intervals, 'hard repeats, about 5K effort') +
        paceRow(hasGoalPace ? 'Goal race pace' : 'Race pace from fitness', hasGoalPace ? pc.goal : pc[goalKey], hasGoalPace ? `for your ${fmtT(p.goal_s)} goal` : d.prescription_version===2?'from recent fitness when this plan was created':'from best efforts in the past 90 days')
        + '<p class="small muted">Easy = conversational · Tempo = a few words · Intervals = hard and controlled. In heat or on hills, go by feel.</p>'
        : '<p class="small">Easy = conversational · Tempo = a few words · Intervals = hard and controlled.</p>'}</div>
    </details>`;
  wireWorkouts(box,d);
  $$('[data-week]',box).forEach(details=>details.ontoggle=()=>{const n=+details.dataset.week;if(details.open)expanded.add(n);else expanded.delete(n);});
  $('#pl-more',box).ontoggle=e=>{if(e.currentTarget.open)planChart($('#pl-chart',box),d);};
  const options=$('#pl-actions');options.hidden=false;options.onclick=()=>planActions(d,box);
  const start=$('[data-plan-start]',box);if(start)start.onclick=async()=>{const owner=readOwner(),current=()=>box.isConnected&&owner===readOwner();start.disabled=true;start.textContent='Loading…';$('[data-plan-error]',box).textContent='';
    try{const loaded=await Track.preparePlan(next,p.id,{active:current});if(loaded&&current())go('/track');}
    catch(error){if(current())$('[data-plan-error]',box).textContent=error.message;}
    finally{if(current()){start.disabled=false;start.textContent='Start';}}
  };
}
function planActions(d,box){
  const p=d.plan,owner=readOwner();
  sheet('Plan options',`<div class="btncol"><a class="ghost" href="/plan?new=1">Change race, level or days</a><button type="button" class="ghost" id="pl-restart">Restart from week 1</button><button type="button" class="ghost danger" id="pl-end">End plan</button></div><p class="small muted">Changing or restarting builds a new schedule; your recorded runs are always kept.</p>`,(body,close)=>{
    const current=()=>body.isConnected&&box.isConnected&&owner===readOwner();$$('a',body).forEach(a=>a.addEventListener('click',close));
    $('#pl-restart',body).onclick=async()=>{if(!current()||!await confirmSheet('Restart this plan?',{body:`Your ${p.race_name} plan starts again from week 1.`,action:'Restart'})||!current())return;try{await api('/api/plans/restart',json('POST',{}));if(current()){invalidate('/api/plans');close();toast('Plan restarted from week 1');render();}}catch(error){if(current())toast(error.message);}};
    $('#pl-end',body).onclick=async()=>{if(!current()||!await confirmSheet('End this training plan?',{body:'Your runs stay; only the schedule goes.',action:'End plan'})||!current())return;try{await api('/api/plans/current',{method:'DELETE',body:'{}'});if(current()){invalidate('/api/plans');close();toast('Plan ended');render();}}catch(error){if(current())toast(error.message);}};
  });
}

// planned (light) vs ran (solid) per week, this week outlined
function planChart(box, d) {
  const W = Math.max(220, box.clientWidth || 340), H = 110, padB = 16, n = d.weeks.length;
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
    <div class="legend small"><span><i class="sw pc-plan-sw"></i>Planned</span><span><i class="sw pc-done-sw"></i>Done</span></div>`;
}

// ---------- choosing a plan ----------
async function planSetup(box, existing, requestedRaceDay = '') {
  const o = await api('/api/plans/options');
  const day = typeof requestedRaceDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedRaceDay) ? new Date(`${requestedRaceDay}T00:00:00Z`) : null;
  const suggestedRaceDay = day && !Number.isNaN(day.valueOf()) && day.toISOString().slice(0, 10) === requestedRaceDay && requestedRaceDay > o.today ? requestedRaceDay : '';
  const S = existing ? {race: existing.race, level: existing.level, weeks: existing.weeks, runs: existing.runs, long_day: existing.long_day, race_day: suggestedRaceDay || existing.race_day, goal_s: existing.goal_s}
    : {race: 'half', level: o.suggest_level === 'first' ? 'beginner' : o.suggest_level, weeks: null, runs: null, long_day: 6, race_day: suggestedRaceDay, goal_s: null};
  S.logs=null;S.break_days=null;
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
  const paceLine = (t) => (t ? `That's <b>${esc(U.pace(t / RACE_M[S.race] * 1000))}${esc(U.pu())}</b> for the whole ${esc(race().name)}.` : 'Training pace comes from recent fitness, not your goal.');
  const whoFor=l=>l.key==='first'?'New runners · walk breaks':`At least ${l.starting_week} ${UN}/week · ${l.starting_long} ${UN} long run`;
  const readinessBlock=()=>S.logs===null||S.break_days===null?'Answer the two running questions.':S.level!=='first'&&S.logs!=='yes'?'Start with run/walk, or add your missing runs.':null;
  const step = (n, t) => `<h2 class="step"><span class="stepn">${n}</span>${esc(t)}</h2>`;
  let timer, seq = 0, primaryAction = null;
  const draw = () => {
    fixLevel();
    const R = race(), L = level();
    if(S.level==='first')S.weeks=9;else if (!R.weeks.includes(S.weeks)) S.weeks = R.default_weeks;
    if (!S.runs || S.runs < L.runs[0] || S.runs > L.runs[1]) S.runs = L.runs[2];
    const first = S.level === 'first';
    box.innerHTML = `${existing ? '<div class="callout">Your current plan will be replaced. Your runs stay.</div>' : ''}
      <div class="card">${step(1, 'Pick your race')}<div class="chips wrap">${o.races.map((r) => `<button class="chip" data-race="${r.key}" aria-pressed="${r.key === S.race}">${esc(r.name)}</button>`).join('')}</div>
        ${R.predicted_s ? `<p class="small muted">Recent ${esc(R.name)} fitness estimate: <b>${esc(dur(R.predicted_s))}</b></p>` : ''}</div>
      <div class="card plan-readiness">${step(2, 'Your recent running')}
        <p class="small muted">Four-week average: ${esc(Math.round((o.readiness?.weekly_m||0)/(UN==='mi'?1609.344:1000)*10)/10)} ${UN}/week.</p>
        <fieldset><legend>Are all your recent runs logged?</legend><div class="chips wrap">${[['yes','Yes'],['missing','Some missing'],['none','No runs yet']].map(([v,t])=>`<button type="button" class="chip" data-logs="${v}" aria-pressed="${S.logs===v}">${t}</button>`).join('')}</div></fieldset>
        <fieldset><legend>Any break in the last month?</legend><div class="chips wrap">${[[0,'No break'],[7,'Under 2 weeks'],[14,'2 weeks or more']].map(([v,t])=>`<button type="button" class="chip" data-break="${v}" aria-pressed="${S.break_days===v}">${t}</button>`).join('')}</div></fieldset>
</div>
      <div class="card">${step(3, 'Choose your level')}${R.levels.map((l) => `<button class="lvl" data-level="${l.key}" aria-pressed="${l.key === S.level}"><span class="lvl-top"><b>${esc(l.name)}</b></span><small>${esc(whoFor(l))}</small>
          ${l.key===S.level?`<small class="muted">${l.key === 'first' ? '3 run/walk sessions a week · 9 weeks' : `${l.runs[0] === l.runs[1] ? l.runs[0] : `${l.runs[0]}-${l.runs[1]}`} runs a week · up to ${l.peak_week} ${UN} a week · long run up to ${l.longest} ${UN}`}${l.quality ? ` · ${l.quality} hard day${l.quality > 1 ? 's' : ''} a week` : ''}</small>`:''}</button>`).join('')}
        </div>
      <div class="card">${step(4, 'Length and days')}
        ${first ? '<p class="small">9 weeks · 3 run/walk sessions a week.</p>' : `<h3 class="ghead">Plan length</h3><div class="chips wrap">${R.weeks.map((w) => `<button class="chip" data-weeks="${w}" aria-pressed="${w === S.weeks}">${w} weeks</button>`).join('')}</div>
        <h3 class="ghead">Runs a week</h3><div class="chips wrap">${Array.from({length: L.runs[1] - L.runs[0] + 1}, (_, i) => L.runs[0] + i).map((x) => `<button class="chip" data-runs="${x}" aria-pressed="${x === S.runs}">${x} runs</button>`).join('')}</div>`}
        <h3 class="ghead">Long run on</h3><div class="seg full" role="group" aria-label="Long run day"><button data-ld="5" aria-pressed="${S.long_day === 5}">Saturday</button><button data-ld="6" aria-pressed="${S.long_day === 6}">Sunday</button></div></div>
      <div class="card">${step(5, 'Race date and goal')}
        <form class="form" id="ps-f"><label>Race date (optional)<input type="date" class="datefield" name="race_day" value="${esc(S.race_day || '')}" min="${esc(o.today)}"></label>
        <p class="small muted ps-note">${S.race_day ? "The full plan counts back from this date." : `Starts ${[0, 4, 5, 6].includes(new Date(o.today + 'T12:00').getDay()) ? 'next Monday' : 'this Monday'}.`}${S.race_day ? ' <button type="button" class="linkbtn" id="ps-nodate">No race date</button>' : ''}</p>
        <fieldset class="goaltime"><legend>Finish time (optional)</legend>
          <div class="hms">${['gh', 'gm', 'gs'].map((k, i) => `<label><input name="${k}" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="${['0', '00', '00'][i]}" value="${hms(S.goal_s)[i] === '' ? '' : String(hms(S.goal_s)[i]).padStart(i ? 2 : 1, '0')}" aria-label="${['Hours', 'Minutes', 'Seconds'][i]}"><span>${['hours', 'minutes', 'seconds'][i]}</span></label>`).join('')}</div>
          <p class="small muted" id="ps-pace">${paceLine(S.goal_s)}</p></fieldset></form></div>
      <div class="card" id="ps-prev">${skel(1)}</div>
      <p class="small muted plan-scope-note">Training guidance, not medical advice.</p><div class="startbar"><button class="primary" id="ps-go" disabled>${existing ? 'Replace my plan' : 'Start this plan'}</button></div>`;
    $$('[data-race]', box).forEach((b) => b.onclick = () => { S.race = b.dataset.race; S.goal_s = null; draw(); });
    $$('[data-level]', box).forEach((b) => b.onclick = () => { S.level = b.dataset.level; S.runs = null; draw(); });
    $$('[data-weeks]', box).forEach((b) => b.onclick = () => { S.weeks = +b.dataset.weeks; draw(); });
    $$('[data-runs]', box).forEach((b) => b.onclick = () => { S.runs = +b.dataset.runs; draw(); });
    $$('[data-ld]', box).forEach((b) => b.onclick = () => { S.long_day = +b.dataset.ld; draw(); });
    $$('[data-logs]',box).forEach(b=>b.onclick=()=>{S.logs=b.dataset.logs;draw();});
    $$('[data-break]',box).forEach(b=>b.onclick=()=>{S.break_days=+b.dataset.break;draw();});
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
      if(primaryAction){primaryAction();return;}
      if(readinessBlock())return;
      const b = $('#ps-go', box); b.disabled = true; b.textContent = 'Building your plan…';
      try { await api('/api/plans', json('POST', body())); invalidate('/api/plans'); toast('Your plan is ready'); go('/plan', {replace: true}); }
      catch (x) { toast(x.message); b.disabled = false; draw(); }
    };
    preview();
  };
  const body = () => ({race: S.race, level: S.level, weeks: S.weeks || 9, runs: S.runs || 3, long_day: S.long_day, race_day: S.race_day || null, goal_s: S.goal_s || null,break_days:S.break_days||0});
  const preview = async () => {
    const my = ++seq, pv = $('#ps-prev', box), go_ = $('#ps-go', box);
    go_.disabled=true;go_.textContent='Checking plan…';primaryAction=null;
    const action=(label,fn)=>{go_.textContent=label;go_.disabled=false;primaryAction=fn;};
    const chooseRunwalk=()=>{S.race='5k';S.level='first';S.runs=3;S.weeks=9;S.race_day='';S.goal_s=null;draw();$('#ps-prev',box).scrollIntoView({block:'start'});};
    const focus=selector=>{const target=$(selector,box);target?.scrollIntoView({block:'center'});target?.focus();};
    const blocked=readinessBlock();if(blocked){
      pv.innerHTML=`${step(6,'Your plan')}<p role="status">${esc(blocked)}</p>`;
      if(S.logs===null||S.break_days===null)action('Answer running questions',()=>focus(S.logs===null?'[data-logs]':'[data-break]'));
      else action('Start run/walk plan',chooseRunwalk);
      return;
    }
    try {
      const r = await api('/api/plans/preview', json('POST', body()));
      if (my !== seq || !pv.isConnected) return;
      const s = r.summary;
      pv.innerHTML = `${step(6, 'Your plan')}<p><b>${esc(race().name)} · ${esc(level().name)} · ${s.weeks} weeks</b><br><span class="muted">${esc(pday(r.start_day))} → target run ${esc(pday(r.race_day, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'}))}</span></p>
        ${S.level === 'first' ? '' : `<div class="stats3 big">${stat('Week 1', s.first_week, UN)}${stat('Biggest week', s.peak_week, UN)}${stat('Longest run', Math.round(s.longest*100)/100, UN)}</div>`}
        ${r.warning ? `<div class="callout warn">${esc(r.warning)}</div>` : ''}
        <h3 class="ghead">Week 1</h3>${r.weeks[0].workouts.map((w) => workoutRow(w, UN)).join('')}`;
      wireWorkouts(pv, {plan: {unit: UN}, weeks: r.weeks}, {canMark: false});
      go_.disabled = false; go_.textContent = `${existing ? 'Replace with' : 'Start'} this ${s.weeks}-week plan`;
    } catch (x) { if (my === seq && pv.isConnected) {
      let message=x.message;
      if(x.status===400&&/four-week average|consistent recent running base|After time off|recent longest run/.test(message)){
        message=/After time off/.test(message)?'Rebuild with easy run/walk after time off.':'A run/walk plan is a better starting point.';
        action('Start run/walk plan',chooseRunwalk);
      }else if(x.status===400&&/race date|race is too soon|target on Thursday|closer to the plan start/.test(message)){
        action('Adjust race date',()=>focus('[name=race_day]'));
      }else if(x.status===400&&/goal/i.test(message))action('Adjust finish time',()=>focus('[name=gh]'));
      else action('Try again',preview);
      pv.innerHTML=`${step(6,'Your plan')}<p class="err" role="status">${esc(message)}</p>`;
    } }
  };
  draw();
}
