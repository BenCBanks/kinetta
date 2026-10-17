// Kinetta phone app — Part 2: pages. Each page renders a skeleton at once, then fills from cache/API.
'use strict';

// ---------- shared bits ----------
const stat = (label, v, u = '') => `<div class="stat"><small>${esc(label)}</small><b class="num">${esc(v)}${u ? `<i>${esc(u)}</i>` : ''}</b></div>`;
function headline(a) {
  const r = rate(a);
  if (a.lifts && !a.distance_m) return stat('Time', dur(a.moving_s || a.elapsed_s)) + stat('Sets', a.lifts.sets)
    + (a.lifts.volume ? stat('Lifted', Math.round(imp() ? a.lifts.volume * LB : a.lifts.volume).toLocaleString(), wUnit()) : stat('Exercises', a.lifts.exercises));
  const first = a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : stat('Time', dur(a.moving_s || a.elapsed_s));
  const third = a.distance_m ? stat('Time', dur(a.moving_s || a.elapsed_s)) :
    a.avg_hr ? stat('Avg HR', Math.round(a.avg_hr), 'bpm') : stat('Effort', a.effort ? Math.round(a.effort) : '–');
  return first + (a.distance_m ? stat(r.label, r.v, r.u) : (a.effort ? stat('Effort', Math.round(a.effort)) : stat('Calories', a.calories ? Math.round(a.calories) : '–'))) + third;
}
// One card for every activity in a list (2026-10-11 redesign, Strava-style): who and when, the name, three numbers, the
// map edge to edge, then cheers and comments. `who` adds the person (the Feed); without it the sport leads (Mine, Today).
// The card is a link; the footer sits outside it so the Cheers button is a real button.
function postCard(a, {who = false, compact = false} = {}) {
  const theirs = !!a.owner, href = theirs ? `/activity/friends/${a.id}` : `/activity/${a.id}`;
  const kind = a.sport_label && a.sport_label.toLowerCase() !== SPORT_NAMES[a.sport].toLowerCase() ? a.sport_label : SPORT_NAMES[a.sport];
  const badges = [];
  if (a.prs) badges.push(`<span class="badge pr">${svg('trophy')} ${a.prs} PR${a.prs > 1 ? 's' : ''}</span>`);
  if (a.route_id) badges.push('<span class="badge">Matched route</span>');
  if (a.commute) badges.push('<span class="badge">Commute</span>');
  // Only the photo and the name open the person's profile (2026-10-16, Ben: the whole row did, so taps meant for the
  // activity landed on the profile); every other part of the card opens the activity (wireCheers → wireCardTaps).
  const person = theirs ? a.owner : App.me, pref = profileHref(person), pname = theirs ? esc(a.owner.name) : 'You';
  const head = who ? `<a class="post-av" href="${pref}" aria-label="${theirs ? `${pname}’s profile` : 'Your profile'}">${avatar(person)}</a><span class="ph-txt"><a class="post-name" href="${pref}">${pname}</a><small>${esc(when(a.start_time))} · ${esc(kind)}</small></span>${sportMark(a.sport)}`
    : `${sportMark(a.sport)}<span class="ph-txt"><small>${esc(when(a.start_time))} · ${esc(kind)}</small></span>`;
  const n = (k) => (a[k] ? `<span class="num">${a[k]}</span>` : '');
  const vis = a.visibility || 'me';
  // the comment button opens the comments in a sheet from below, right here (2026-10-12); you can cheer your own activity too
  const foot = `<button type="button" class="pf cheer" data-cheer="${a.id}" aria-pressed="${!!a.cheered}" aria-label="${esc(CHEER.verb)}">${svg('cheer')}${n('cheers')}</button>
       <button type="button" class="pf" data-talk="${a.id}" aria-label="Comments">${svg('comment')}${n('comments')}</button>` + (theirs ? '' : `
       <span class="pf-vis">${svg(vis === 'me' ? 'lock' : vis === 'friends' ? 'people' : 'globe')}${esc(VIS_SHORT[vis])}</span>`);
  const compactHead = `<a class="post-heading" href="${href}">${sportMark(a.sport)}<div class="ph-txt"><small>${esc(when(a.start_time))}</small><h3 class="post-title">${esc(a.name)}</h3></div></a>`;
  return `<article class="card post${compact ? ' compact' : ''}" data-href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}"><div class="post-hd post-profile">${compact ? compactHead : head}</div><a class="post-link" href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}">
    ${compact ? '' : `<h3 class="post-title">${esc(a.name)}</h3>`}
    <div class="stats3">${theirs ? sharedHeadline(a) : headline(a)}</div>${!theirs && a.lifts && a.lifts.names ? `<p class="post-lifts">${esc(a.lifts.names.slice(0, 4).join(' · '))}${a.lifts.names.length > 4 ? ` +${a.lifts.names.length - 4}` : ''}</p>` : ''}${badges.length && !compact ? `<div class="badges">${badges.join('')}</div>` : ''}
    </a>${activityMedia(a, compact ? {openHref: href} : {})}${compact && !a.line && !(a.photos || []).length ? `<a class="primary wide post-open" href="${href}">View activity ${svg('chev')}</a>` : ''}
    <div class="post-ft">${foot}</div></article>`;
}
function sharedHeadline(a) {   // what a friend shares: no pace when they keep pace to themselves
  const st = [];
  if (a.distance_m) st.push(stat('Distance', U.dist(a.distance_m), U.du()));
  if (a.distance_m && a.moving_s && a.shares.pace) { const r = rate(a); st.push(stat(r.label, r.v, r.u)); }
  st.push(stat('Time', dur(a.moving_s || a.elapsed_s)));
  if (st.length < 3 && a.ascent_m) st.push(stat('Elevation', U.elev(a.ascent_m), U.eu()));
  return st.slice(0, 3).join('');
}
// Cheers straight from a feed card: the count changes at once and goes back if the server says no. The comment
// button opens the comments sheet and keeps the card's count in step.
function wireCheers(box) {
  wireActivityMedia(box); wireCardTaps(box);
  $$('[data-talk]', box).forEach((b) => b.onclick = () => {
    commentsSheet(b.dataset.talk, null, (fresh) => {
      if (!b.isConnected) return;
      b.innerHTML = svg('comment') + (fresh.comments.length ? `<span class="num">${fresh.comments.length}</span>` : '');
      const c = $(`[data-cheer="${b.dataset.talk}"]`, box);
      if (c && !c.dataset.sending) { c.setAttribute('aria-pressed', String(fresh.cheered)); c.innerHTML = svg('cheer') + (fresh.cheers.length ? `<span class="num">${fresh.cheers.length}</span>` : ''); }
    });
  });
  $$('[data-cheer]', box).forEach((b) => cheerGesture(b, async () => {
    if (b.dataset.sending) return;
    b.dataset.sending = '1'; b.setAttribute('aria-busy', 'true');
    const on = b.getAttribute('aria-pressed') !== 'true', id = b.dataset.cheer;
    const cnt = () => { let c = $('.num', b); if (!c) { c = document.createElement('span'); c.className = 'num'; b.append(c); } return c; };
    const shift = (d) => { const c = cnt(), v = (+c.textContent || 0) + d; c.textContent = v || ''; b.setAttribute('aria-pressed', String(d > 0)); };
    shift(on ? 1 : -1); Native.haptic(on ? 'medium' : 'light'); if (on) { b.classList.remove('just'); void b.offsetWidth; b.classList.add('just'); }
    try { await api(`/api/activities/${id}/cheer`, on ? json('POST', {}) : {method: 'DELETE'}); socialChanged(id); }
    catch (x) { shift(on ? -1 : 1); toast(x.message); }
    finally { delete b.dataset.sending; b.setAttribute('aria-busy', 'false'); }
  }, () => activityCheers(b.dataset.cheer)));
}
// A tap anywhere on a card that isn't one of its own buttons or links opens the activity, and the card dips slightly
// under the finger so the tap feels answered at once (2026-10-16). Links, Cheers, comments and photos keep their jobs.
const CARD_OWN = 'a, button, input, select, textarea, label, .media-photo, .media-controls, .leaflet-control';
let cardPressed = null;
const cardRelease = () => { if (cardPressed) cardPressed.classList.remove('press'); cardPressed = null; };
addEventListener('scroll', cardRelease, {passive: true});
function wireCardTaps(box) {
  if (box.dataset.cardTaps) return;
  box.dataset.cardTaps = '1';
  const card = (e) => { const c = e.target.closest && e.target.closest('article.post[data-href]'); return c && box.contains(c) && !e.target.closest(CARD_OWN) ? c : null; };
  box.addEventListener('pointerdown', (e) => {
    cardRelease();
    const c = e.target.closest && e.target.closest('.post-link') ? e.target.closest('article.post[data-href]') : card(e);   // the numbers are the card's own link
    if (c && e.isPrimary) { cardPressed = c; c.classList.add('press'); }
  }, {passive: true});
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => box.addEventListener(t, cardRelease, {passive: true}));
  box.addEventListener('click', (e) => {
    const c = card(e);
    if (!c || e.defaultPrevented || e.metaKey || e.ctrlKey || String(getSelection && getSelection())) return;
    go(c.dataset.href);
  });
}
const backBtn = (label = 'Back') => `<button class="back" data-back>${svg('back')}${esc(label)}</button>`;
function wireBack(el, fallback) {
  const b = $('[data-back]', el);
  if (b) b.onclick = () => (history.length > 1 && App.navCount > 0 ? history.back() : go(fallback, {replace: true}));
}
App.navCount = 0;
const _go = go; go = (p, o) => { App.navCount++; _go(p, o); };

// Shared profile chart: viewer-local dates, explicit units, zeros retained on the same scale.
function mileageChart(box, series) {
  const rows = series.days || [], max = Math.max(1, ...rows.map((r) => +r.distance_m || 0));
  const total = rows.reduce((n, r) => n + (+r.distance_m || 0), 0);
  box.innerHTML = `<h2>Last 14 days</h2><p class="mileage-total num"><b>${U.dist(total, 1)}</b> ${U.du()}</p>
    <div class="mileage-bars fortnight-bars" role="img" aria-label="Distance in ${U.du()} for the last 14 days: ${esc(rows.map((r) => `${r.d}: ${U.dist(r.distance_m || 0, 1)}`).join(', '))}">${rows.map((r) => {
      const date = new Date(r.d + 'T12:00');
      return `<div class="mileage-day${r.today ? ' current-day' : ''}"><div class="mileage-column"><i data-h="${Math.max(.015, (+r.distance_m || 0) / max)}"></i></div><small>${esc(date.toLocaleDateString([], {weekday: 'narrow'}))}<b>${date.getDate()}</b></small></div>`;
    }).join('')}</div>
    <p class="small muted mileage-range">${rows.length ? `${esc(fdate(rows[0].d + 'T12:00', {month:'short',day:'numeric'}))} – ${esc(fdate(rows[rows.length - 1].d + 'T12:00', {month:'short',day:'numeric'}))}` : ''}</p>
    ${total ? '' : '<p class="small muted">No distance recorded in the last 14 days. Timed activities still appear below.</p>'}`;
}

// A shared private reader keeps Me and both Progress halves consistent.
function combinedWeekHtml(w) {
  const stats=[];
  if(w.workouts)stats.push(stat('Workouts',w.workouts));
  if(w.distance_m>0)stats.push(stat('Distance',U.dist(w.distance_m),U.du()));
  if(w.seconds>0)stats.push(stat('Time',dur(w.seconds)));
  const food=w.days_logged?`${w.days_logged} of 7 days with food logged.`:'Your food consistency will appear as you log meals.';
  const protein=w.days_logged&&w.protein_target?`${w.protein_days_reached?`${w.protein_days_reached} ${w.protein_days_reached===1?'day':'days'} reached`:'No logged days reached'} your current ${r0(w.protein_target)} g protein target.${w.protein_days_unknown?` ${w.protein_days_unknown} logged ${w.protein_days_unknown===1?'day has':'days have'} unknown protein.`:''}`:'';
  return `<details class="card combined-week"><summary>Your week · food &amp; training</summary><p class="small muted">${esc(dayLabel(w.start))} – ${esc(dayLabel(w.end))} · last 7 completed days</p>${stats.length?`<div class="stats3">${stats.join('')}</div>`:'<p>No workouts recorded in this week. Distance and time appear with your workouts.</p>'}<p>${food}</p>${protein?`<p>${protein}</p>`:''}${w.days_logged?'<p class="small muted">Food logged does not mean the whole day is complete. Protein compares known recorded amounts with your current target.</p>':''}<a class="linkbtn" href="${w.days_logged?'/food?view=overview':'/food/describe'}">${w.days_logged?'Food review':'Log food'}</a>${w.workouts?' <a class="linkbtn" href="/activity?view=mine">Your workouts</a>':''}</details>`;
}
function combinedWeek(box) {
  if(!box)return;const owner=readOwner();
  load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;const w=data.week;
    box.innerHTML=combinedWeekHtml(w);
  }).catch(()=>{if(box.isConnected&&owner===readOwner()){if(!box.innerHTML)box.innerHTML='<p class="small muted">Your week could not load.</p>';const b=document.createElement('button');b.className='linkbtn combined-week-retry';b.textContent='Retry weekly summary';b.onclick=()=>{b.remove();combinedWeek(box);};box.append(b);}});
}
function workoutEnergy(box,aid) {
  const owner=readOwner();load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;
    const t=data.today,a=t.items.find(x=>String(x.id)===String(aid));if(!a){box.innerHTML='';return;}
    box.innerHTML=`<a class="card tap" href="${esc(t.food_href)}"><h2>Today’s energy</h2><p>${a.kcal<=0?'Calories are unavailable for this workout.':t.day_burn==null?`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Total burn is waiting for resting data.`:t.included_in_day_burn?`Today: +${r0(homeCalories(a.kcal))} kcal burned${a.estimated?' · estimate':''}.`:`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Your imported total burn takes priority, so these calories are not added again.`}</p>${a.kcal>0?`<p class="small muted">${a.estimated?'Estimated from recorded distance/time and weight.':a.source==='healthkit'?'Recorded calories from Apple Health.':a.source==='track'?'Calories from your phone recording.':'Calories from your workout record.'}</p>`:''}<span class="small more-link">See this workout in your food log ›</span></a>`;
  }).catch(()=>{if(box.isConnected&&owner===readOwner())box.innerHTML='<p class="small muted">Today’s energy is unavailable. <a href="/food">Open food log</a></p>';});
}
function workoutSyncStatus(box) {
  if(!Native.on||!box)return;const owner=readOwner();let version=0;
  const draw=async()=>{
    const v=++version;const [enabled,status,bg]=await Promise.all([Native.healthOn(),Native.healthStatus(),Native.backgroundStatus()]);
    if(v!==version||!box.isConnected||owner!==readOwner())return;
    if(!enabled){box.innerHTML='';return;}
    const dates=[status?.last_success_at,bg?.lastSuccess].filter(Boolean).map(x=>new Date(x)).filter(x=>Number.isFinite(+x));const last=dates.sort((a,b)=>b-a)[0];
    box.innerHTML=`<details class="card workout-sync"><summary>Apple Health · ${Native.syncing?'syncing':bg?.pending?`${bg.pending} pending`:status?.error||bg?.error?'needs attention':last?'last synced '+esc(last.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})):'waiting for first sync'}</summary>${last?`<p class="small muted">Last successful sync: ${esc(last.toLocaleString())}</p>`:''}<p class="small muted">${esc(Native.syncing?Native.healthProgress:status?.error||bg?.error||'Only workouts already available in Apple Health can be imported.')}</p>${bg?.needsLogin?'<p>Sign in again to resume background uploads.</p>':''}${bg?.pending?`<p>${bg.pending} workouts waiting to upload.</p>`:''}<p class="small muted">Garmin Connect can take an hour or more to send workouts to Health and does not send route maps.</p><button class="ghost" data-sync-now${Native.syncing?' disabled':''}>Sync now</button> <a class="linkbtn" href="/track/health">Manage Apple Health</a></details>`;
    $('[data-sync-now]',box).onclick=async()=>{try{await Native.syncHealth();}catch(e){toast(e.message);}await draw();};
  };
  Native.onWorkoutStatus=()=>{if(!box.isConnected||owner!==readOwner()){Native.onWorkoutStatus=null;return;}draw().catch(()=>{});};
  draw().catch(()=>{});Native.autoSync({foreground:true});
}

// ---------- Today ----------
// First steps use food or activity history. Health remains optional; the Home Screen
// tip appears only on an iPhone browser that isn't already the Home Screen app.
// the next step for someone with nothing here yet (2026-10-12): an empty page says what to do, with the button for it
const startCta = () => '';
function getStarted(healthConnected = false, hasHistory = false) {
  const ch = `<span class="chev">${svg('chev')}</span>`;
  const step = (href, ico, c, label, sub) => `<a class="row-link" href="${href}"><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}<small class="muted gs-sub">${sub}</small></span>${ch}</a>`;
  const ios = /iPhone|iPad/.test(navigator.userAgent), home = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const rows = [
    !App.me?.kcal_target ? step('/food/setup', 'target', 'c-brand', 'Set a nutrition goal', 'An optional starting point for calories and protein.') : '',
    Native.on && !healthConnected ? step('/track/health', 'heart', 'c-brand', 'Connect Apple Health · optional', 'Bring in workouts and weight from Apple Health') : '',
    !hasHistory ? step('/food', 'food', 'c-green', 'Log something you ate', 'Search, scan a barcode or enter known nutrition.') : '',
    !hasHistory ? step('/me/friends', 'me', 'c-brand', 'Find your friends', "See each other's runs and rides, and send cheers.") : '',
    ios && !home && !Native.on ? `<div class="row-link"><span class="ri c-orange">${svg('today')}</span><span class="grow">Add Kinetta to your Home Screen<small class="muted gs-sub">In Safari, tap Share, then Add to Home Screen. It opens like an app.</small></span></div>` : '',
  ].filter(Boolean);
  return rows.length ? `<h2 class="sec-head">${hasHistory ? 'Finish setup' : 'Get started'}</h2><div class="card list">${rows.join('')}</div>` : '';
}
route(/^\/today$/, 'me', async () => go('/me', {replace: true}));
async function meOverview(el) {
  // A greeting instead of the word "Me" (2026-10-16, Ben: "Hi, Ben"); your photo at the top right opens your profile,
  // which replaces the separate name row that used to sit under the chart.
  const first = (App.me.name || App.me.login || '').trim().split(/\s+/)[0];
  el.innerHTML = `<div class="top me-heading"><div class="me-hello"><small>${esc(new Date().toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'}))}</small><h1>Hi, ${esc(first)}</h1></div>
    <div class="acts"><div id="t-review"></div>${bellBtn()}<a class="me-avatar" href="${profileHref(App.me)}" aria-label="Your profile">${avatar(App.me)}</a></div></div>
    <div id="t-food">${skel(1)}</div><div id="t-checkin"></div>
    <div id="t-combined-week"></div><div id="t-plan"></div><div id="t-friends"></div>
    <section id="t-week" aria-label="Last 14 days"></section>
    <div id="t-setup"></div><div id="t-goals"></div>`;
  combinedWeek($('#t-combined-week',el));
  let foodHistory=null,activityHistory=null,healthConnected=false;
  const drawSetup=()=>{
    if(!el.isConnected||foodHistory===null||activityHistory===null)return;
    const missing = ['weight_kg', 'height_cm', 'sex', 'birth_year'].filter((k) => !App.me[k]);
    $('#t-setup', el).innerHTML = getStarted(healthConnected, activityHistory||foodHistory) +
      (missing.length && App.me.kcal_target ? `<a class="card tap setup-body" href="/me?setup=body"><span>${svg('heart')}</span><div><b>Make your estimates more personal</b><p>Add ${esc(missing.map((k) => ({weight_kg:'weight',height_cm:'height',sex:'sex',birth_year:'birth year'}[k])).join(', '))} for better calorie-needs and effort estimates.</p><small>Private body settings · optional, editable any time</small></div>${svg('chev')}</a>` : '');
  };
  todayFoodCard($('#t-food',el),{onHistory:value=>{foodHistory=value;drawSetup();}}).catch(() => {
    if (!el.isConnected) return;
    foodHistory=false;drawSetup();
    $('#t-food',el).innerHTML = '<div class="card"><p>Today’s food could not load.</p><button class="primary wide" id="tf-retry">Try again</button></div>';
    $('#tf-retry',el).onclick = () => { invalidate('/api/food/day'); render(); };
  });
  weeklyCheckinCard($('#t-checkin',el),{home:true});
  // The existing feed applies friendship and sharing rules on the server; food never enters it.
  load('/api/feed/friends?limit=3', rows => {
    if (!el.isConnected) return;
    $('#t-friends',el).innerHTML = rows.length ? `<section class="card home-friends"><h2>Friends recently<a class="more" href="/activity">Feed ›</a></h2>${rows.map(a => `<a class="home-workout" href="/activity/friends/${a.id}">${avatar(a.owner)}<span><b>${esc(a.owner.name)}</b><small>${esc(a.name)} · ${esc(when(a.start_time))}</small></span>${svg('chev')}</a>`).join('')}</section>` : '';
  }).catch(() => {});
  load('/api/plans/current', d => {
    if (!el.isConnected || !d.today_workout) return;
    const w = d.today_workout;
    $('#t-plan',el).innerHTML = `<section class="card"><h2>Today’s plan</h2><button class="row-link" data-wday="${esc(w.day)}">${svg('calendar')}<span class="grow">${esc(w.title)}<small>${w.status === 'done' ? 'Completed' : 'View session'}</small></span>${svg('chev')}</button></section>`;
    wireWorkouts($('#t-plan',el),d);
  }).catch(() => {});
  load('/api/coach/week', (r) => {
    const box = $('#t-review', el); if (!box) return;
    if (!r.enabled && !r.latest) { box.innerHTML = ''; return; }
    const wk = r.latest ? r.latest.period_start : null, when = wk ? new Date(wk + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}) : '';
    async function reviewNow(btn, close) {
      btn.disabled = true; btn.textContent = 'Thinking…';
      try { const fresh = await api('/api/coach/week', json('POST', {})); showCoach('week:' + fresh.period_start); invalidate('/api/coach'); if (close) close(); render(); }
      catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Review this week now'; }
    }
    box.innerHTML = `<button class="icon-btn kit-help" id="t-review-open" aria-label="Kit’s weekly review">${svg('sparkle')}</button>`;
    $('#t-review-open', box).onclick = () => sheet('Kit’s weekly review', wk
      ? `<p class="small muted">Week of ${esc(when)}</p><p class="review-text">${esc(r.latest.text)}</p>
          ${r.enabled ? '<button class="ghost wide" id="rv-now">Review this week now</button>' : ''}`
      : `<p>Kit writes a short review every Sunday evening.</p><p class="small muted">You can also ask for a review of this week so far.</p>
          <button class="primary wide" id="rv-now">Review this week now</button>`, (sb, close) => {
        const button = $('#rv-now', sb); if (button) button.onclick = () => reviewNow(button, close);
      });
  }).catch(() => {});
  const overviewLoads = await Promise.allSettled([
    load('/api/activities?limit=3', (d) => {
      if (!el.isConnected) return;
      Promise.resolve(Native.on ? (Native.anyHealthOn?Native.anyHealthOn():Native.healthOn()) : false).catch(() => false).then((connected) => {
        if (!el.isConnected) return;
        activityHistory=!!d.length;healthConnected=connected;drawSetup();
      });
    }),
    load('/api/stats', (s) => {
      if (!el.isConnected) return;
      if (!(s.recent_days || []).some(r => r.distance_m > 0)) { $('#t-week',el).innerHTML = ''; return; }
      $('#t-week', el).innerHTML = '<div class="card" id="me-distance"></div>';
      mileageChart($('#me-distance', el), {days:s.recent_days || []});
    }),
    load('/api/goals', (g) => {
      if (!el.isConnected) return;
      $('#t-goals', el).innerHTML = g.length ? `<div class="card"><h2>Goals<a class="more" href="/me/goals">Edit</a></h2>${g.map(goalRow).join('')}</div>` : '';
    }),
  ]);
  if (overviewLoads[1].status === 'rejected' && el.isConnected) $('#t-week', el).innerHTML = '<p class="small muted">Weekly activity could not load.</p>';
  if (overviewLoads.some((r) => r.status === 'rejected') && el.isConnected) {
    el.insertAdjacentHTML('beforeend', '<button class="ghost wide" id="me-retry">Some updates could not load · Retry</button>');
    $('#me-retry', el).onclick = () => { invalidate('/api/'); render(); };
  }
}

function goalFmt(metric, v) {
  return metric === 'distance' ? `${U.dist(v, 1)} ${U.du()}` : metric === 'time' ? dur(v, true) : metric === 'elevation' ? `${U.elev(v)} ${U.eu()}`
    : metric === 'calories' ? `${Math.round(v).toLocaleString()} kcal` : `${Math.round(v)}`;
}
function goalRow(g) {
  const pct = Math.min(1, g.value / g.target);
  const what = `${g.metric === 'calories' ? 'Calories burned' : g.sport ? SPORT_NAMES[g.sport] : 'All'}${g.metric === 'calories' && g.sport ? ` (${SPORT_NAMES[g.sport].toLowerCase()})` : ''} · ${g.period === 'day' ? 'today' : 'this ' + g.period}`;
  return `<div class="goal"><div class="top2"><b>${esc(what)}</b><span class="num">${esc(goalFmt(g.metric, g.value))} / ${esc(goalFmt(g.metric, g.target))}</span></div>
    <div class="track"><div class="bar" data-w="${pct.toFixed(3)}"></div></div></div>`;
}
// apply data-w widths through CSS custom properties (no inline style attributes allowed)
new MutationObserver(() => { for (const b of $$('[data-w]')) { b.style.setProperty('--w', b.dataset.w); b.removeAttribute('data-w'); }
  for (const b of $$('[data-h]')) { b.style.setProperty('--h', b.dataset.h); b.removeAttribute('data-h'); } })
  .observe(document.documentElement, {childList: true, subtree: true});

// ---------- Activity feed ----------
// Feed | Mine at the top of the Activity tab (2026-10-11): the Feed (yours and your friends', newest first) leads;
// Mine is only yours, with filters and search. The Feed itself is in social.js.
const whoseSeg = (cur) => `<div class="seg wide two" role="group" aria-label="Whose activities"><button data-whose="" aria-pressed="${cur !== 'mine'}">Friends feed</button><button data-whose="mine" aria-pressed="${cur === 'mine'}">My activities</button></div><p class="activity-view-note">${cur === 'mine' ? 'Your history, with search and filters.' : 'Your activities and your friends’ shared activities, newest first.'}</p>`;
const wireWhose = (el) => $$('[data-whose]', el).forEach((b) => b.onclick = () => go('/activity' + (b.dataset.whose ? '?view=' + b.dataset.whose : ''), {replace: true}));
// the bell (2026-10-12: on Today, Activity, Progress and Nutrition), with the unread count; it opens the list only
const bellBtn = () => { const n = (App.me && App.me.notifications) || 0;
  return `<a class="icon-btn bell" href="/notifications" aria-label="Notifications${n ? `, ${n} new` : ''}">${svg('bell')}<span class="bell-dot"${n ? '' : ' hidden'}>${n > 9 ? '9+' : n || ''}</span></a>`; };
const actTop = (search, friends) => `<div class="top"><h1>Activity</h1><div class="acts">${search ? `<button class="icon-btn" id="f-search" aria-label="Search">${svg('search')}</button>` : ''}
    ${friends ? `<a class="icon-btn" href="/me/friends" aria-label="Find friends">${svg('search')}</a>` : ''}
    ${bellBtn()}</div></div>`;
route(/^\/activity$/, 'activity', async (el) => {
  const q = new URLSearchParams(location.search), sport = q.get('sport') || '', term = q.get('q') || '';
  if (q.get('view') !== 'mine') return homeFeed(el);
  const sports = ['', 'run', 'ride', 'walk', 'hike', 'swim', 'workout', 'other'];
  el.innerHTML = `${actTop(true)}${whoseSeg('mine')}<div id="workout-sync"></div>
    <form id="f-sform" class="${term ? '' : 'hidden'}" role="search"><input type="search" name="q" value="${esc(term)}" placeholder="Search names and descriptions" enterkeyhint="search"></form>
    <div class="chips" role="group" aria-label="Sport">${sports.map((s) => `<button class="chip" data-s="${s}" aria-pressed="${s === sport}">${s === 'other' ? 'Other' : s ? SPORT_NAMES[s] + 's' : 'All'}</button>`).join('')}</div>
    <div class="feed-list" id="f-list">${skel(4)}</div><button class="ghost feed-more" id="f-more" hidden>Show more</button>`;
  wireWhose(el);workoutSyncStatus($('#workout-sync',el));
  const sf = $('#f-sform', el); if (!term) sf.hidden = true;
  $('#f-search', el).onclick = () => { sf.hidden = !sf.hidden; if (!sf.hidden) $('input', sf).focus(); };
  sf.onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(location.search); const v = $('input', sf).value.trim(); v ? p.set('q', v) : p.delete('q'); go('/activity' + (p.toString() ? '?' + p : ''), {replace: true}); };
  $$('.chip', el).forEach((b) => b.onclick = () => { const p = new URLSearchParams(location.search); b.dataset.s ? p.set('sport', b.dataset.s) : p.delete('sport'); go('/activity' + (p.toString() ? '?' + p : ''), {replace: true}); });
  const base = `/api/activities?limit=25${sport ? '&sport=' + sport : ''}${term ? '&q=' + encodeURIComponent(term) : ''}`;
  const list = $('#f-list', el), more = $('#f-more', el);
  let items = [];
  const draw = (rows) => {
    items = rows;
    list.innerHTML = rows.length ? rows.map((x) => postCard(x)).join('') : `<div class="card empty"><b>${term || sport ? 'Nothing matches' : 'No activities yet'}</b>${term || sport ? 'Try another filter.' : `Workouts from your watch arrive here on their own.${startCta()}`}</div>`;
    more.hidden = rows.length < 25 || rows.length % 25 !== 0;
    feedMaps(list); wireCheers(list);
  };
  await load(base, draw);
  more.onclick = async () => {
    more.disabled = true; more.textContent = 'Loading…';
    try {
      const rows = await api(base + '&before=' + encodeURIComponent(items[items.length - 1].start_time));
      items = items.concat(rows); App.cache.set(base, {data: items, at: Date.now()});
      list.insertAdjacentHTML('beforeend', rows.map((x) => postCard(x)).join('')); more.hidden = rows.length < 25; feedMaps(list); wireCheers(list);
    } catch (e) { toast(e.message); }
    more.disabled = false; more.textContent = 'Show more';
  };
});

// ---------- Activity detail ----------
const ZN = ['Easy', 'Aerobic', 'Tempo', 'Threshold', 'Max'];
function insights(a) {
  const out = [];
  if (a.efforts && a.efforts.some((e) => e.rank_then === 1)) {
    const prs = a.efforts.filter((e) => e.rank_then === 1).map((e) => e.label);
    out.push(['good', `New personal record${prs.length > 1 ? 's' : ''}`, prs.join(', ')]);
  }
  if (a.decoupling != null) {
    const d = a.decoupling;
    out.push([d < 5 ? 'good' : d < 10 ? '' : 'warn', `Heart-rate drift ${d.toFixed(1)}%`,
      d < 5 ? 'Your heart rate held steady for the pace: good aerobic fitness for this effort.' :
      d < 10 ? 'Some drift in the second half: normal for long or warm efforts.' : 'Big drift: heat, dehydration, fatigue or starting too fast.']);
  }
  if (a.zones) {
    const tot = a.zones.reduce((x, y) => x + y, 0), easy = (a.zones[0] + a.zones[1]) / tot;
    out.push(['', easy > .75 ? 'Mostly easy' : easy < .4 ? 'Hard session' : 'Mixed intensity',
      `${Math.round(easy * 100)}% of the time in zones 1–2${a.effort ? ` · effort ${Math.round(a.effort)}` : ''}.`]);
  }
  if (a.vo2max) out.push(['', `VO₂max estimate ${a.vo2max}`, 'From pace (hills adjusted) versus heart rate. Trends matter more than one run.']);
  if (a.route_count > 1) out.push(['', `You've done this route ${a.route_count} times`, 'See how you compare over time below.']);
  return out;
}
function sportStats(a) {
  const s = [];
  const add = (l, v, u) => { if (v != null && v !== '–') s.push(stat(l, v, u)); };
  if (a.sport === 'swim') {
    add('Pace', a.distance_m && a.moving_s ? U.swim(a.moving_s / a.distance_m * 1000) : null, U.swu());
    add('Lengths', a.lengths); add('SWOLF', a.swolf ? Math.round(a.swolf) : null); add('Strokes', a.strokes ? Math.round(a.strokes) : null);
    add('Pool', a.pool_length_m ? `${Math.round(a.pool_length_m)} m` : null);
  }
  if (FOOT.includes(a.sport)) add('GAP', a.gap_s_per_km ? U.pace(a.gap_s_per_km) : null, U.pu());
  if (['ride', 'ski', 'row'].includes(a.sport) || a.max_speed) add('Max speed', a.max_speed ? U.speed(a.max_speed) : null, U.su());
  add('Elevation', a.ascent_m != null ? U.elev(a.ascent_m) : null, U.eu());
  if (['hike', 'ride', 'ski'].includes(a.sport)) { add('Climb rate', a.vam ? U.elev(a.vam) : null, U.eu() + '/h'); add('Highest', a.max_alt != null ? U.elev(a.max_alt) : null, U.eu()); }
  add('Avg HR', a.avg_hr ? Math.round(a.avg_hr) : null, 'bpm'); add('Max HR', a.max_hr ? Math.round(a.max_hr) : null, 'bpm');
  add('Effort', a.effort ? Math.round(a.effort) : null);
  if (a.avg_power) { add('Avg power', Math.round(a.avg_power), 'W'); add('Norm. power', a.norm_power ? Math.round(a.norm_power) : null, 'W'); }
  if (a.avg_cad) add('Cadence', Math.round(a.avg_cad), a.sport === 'ride' ? 'rpm' : 'spm');
  if (['walk', 'hike', 'run'].includes(a.sport)) add('Steps', a.steps ? Math.round(a.steps).toLocaleString() : null);
  if (a.avg_stride) add('Stride', (a.avg_stride / 1000).toFixed(2), 'm');
  if (a.avg_gct) add('Ground contact', Math.round(a.avg_gct), 'ms');
  if (a.avg_vo) add('Vert. osc.', (a.avg_vo / 10).toFixed(1), 'cm');
  add('Elapsed', a.elapsed_s && Math.abs(a.elapsed_s - (a.moving_s || 0)) > 30 ? dur(a.elapsed_s) : null);
  add('Calories', a.calories ? Math.round(a.calories) : null); add('Temp', a.avg_temp != null ? U.temp(a.avg_temp) : null);
  return s.join('');
}

route(/^\/activity\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Activity')}</div>${skel(1)}<div class="sk block"></div>${skel(2)}`;
  wireBack(el, '/activity');
  await load(`/api/activities/${id}`, (a) => {drawDetail(el,a);const box=document.createElement('div');box.id='workout-food-energy';el.querySelector('.dtabs').before(box);workoutEnergy(box,id);}, {maxAge:60000});
});

// Sections (2026-10-12, Ben: "one huge long list"): the map, title and headline numbers stay on top; the rest is
// split into Overview | Splits | Charts | Efforts, each shown only when it has something. ?tab= opens one. Cheers and
// comments are small icons by the title (comments open in a sheet; ?tab=comments opens it), sharing is in Edit, and
// the share button sends a link or a picture (2026-10-12).
const DTABS = [['overview', 'Overview'], ['splits', 'Splits'], ['charts', 'Charts'], ['efforts', 'Efforts']];
function drawDetail(el, a) {
  const r = rate(a);
  const hero = a.lifts && !a.distance_m ? headline(a) : (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', dur(a.moving_s || a.elapsed_s)) + (a.distance_m ? stat(r.label, r.v, r.u) : '');
  const ins = insights(a);
  const splits = imp() ? a.splits_mi : a.splits_km;
  const more = sportStats(a);
  const pane = {
    overview: `${liftCard(a)}${more ? `<div class="card"><h2>Details</h2><div class="hero more">${more}</div>
        ${a.gear_name ? `<p class="small muted">Gear: ${esc(a.gear_name)}</p>` : ''}</div>` : ''}
      ${a.private_note ? `<div class="card"><h2>Private note</h2><p class="small">${esc(a.private_note)}</p></div>` : ''}
      ${ins.length ? `<div class="card"><h2>Insights</h2>${ins.map(([k, t, d]) => `<div class="insight"><span class="dot ${k}"></span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join('')}</div>` : ''}
      ${a.route_id ? `<a class="card tap" href="/route/${a.route_id}" data-prefetch="/api/routes/${a.route_id}"><h2>${esc(a.route_name)}<span class="more">Compare ›</span></h2><p>Matched route · ${a.route_count} activities. See your trend on this route.</p></a>` : ''}`,
    splits: `${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
      ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}`,
    charts: `${a.chart ? '<div class="card"><div id="d-charts"></div></div>' : ''}
      ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
      ${a.power_curve && a.power_curve.length ? `<div class="card"><h2>Power curve</h2><table class="tbl">${a.power_curve.map((p) => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r">${p.watts} W</td></tr>`).join('')}</table></div>` : ''}`,
    efforts: `${a.efforts && a.efforts.length ? `<div class="card"><h2>Best efforts</h2>${effortsTable(a)}</div>` : ''}
      ${a.similar && a.similar.length ? `<div class="card"><h2>Similar efforts</h2>${similarHtml(a)}</div>` : ''}`,
  };
  const has = (k) => k === 'overview' || pane[k].trim() !== '';
  // with a map, the map runs to the top of the screen and the buttons float over it (2026-10-12, Ben)
  const topBar = `<div class="top${a.line || a.photos?.length ? ' over' : ''}">${backBtn('Activity')}<div class="acts"><button class="icon-btn" id="d-send" aria-label="Share">${svg('share')}</button><button class="icon-btn" id="d-edit" aria-label="Edit activity">${svg('edit')}</button></div></div>`;
  el.innerHTML = `${a.line || a.photos?.length ? `<div class="map-head">${activityMedia(a, {mapId: 'd-map', detail: true, full: !!a.line})}${topBar}</div>` : topBar}
    <div class="d-title card"><div class="post-hd">${sportMark(a.sport)}<span class="ph-txt"><small>${esc(fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}))} at ${esc(ftime(a.start_time))}${a.sport_label ? ' · ' + esc(a.sport_label) : ''}${a.device ? ' · ' + esc(a.device) : ''}</small></span>${a.ai_note || aiCan('coach') ? `<button class="icon-btn kit-help" id="d-kit" aria-label="Ask Kit about this activity">${svg('sparkle')}</button>` : ''}</div>
      <div class="t-row"><h1>${esc(a.name)}</h1><span class="t-soc" id="d-soc"></span></div>
      ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
      ${Object.keys(a.summary_overrides||{}).length?'<p class="small muted corrected-note">You edited these numbers. Records and splits are hidden until you restore the recorded values in Edit.</p>':''}
      <div class="hero">${hero}</div>${a.source==='healthkit'&&!a.line&&['run','ride','walk','hike'].includes(a.sport)?'<button class="linkbtn" type="button" id="d-add-map">Add the map</button>':''}<div id="d-photos"></div><div class="cpile"></div></div>
    <div class="seg wide dtabs" role="tablist" aria-label="Sections"${DTABS.filter(([k]) => has(k)).length < 2 ? ' hidden' : ''}>${DTABS.map(([k, n]) => `<button role="tab" data-dt="${k}"${has(k) ? '' : ' hidden'}>${n}</button>`).join('')}</div>
    ${DTABS.map(([k]) => `<section class="dpane" data-pane="${k}" role="tabpanel" hidden>${pane[k]}</section>`).join('')}`;
  let drawCharts = null;
  const want = new URLSearchParams(location.search).get('tab');
  const show = (k, remember) => {
    const b = $(`[data-dt="${k}"]`, el); if (!b || b.hidden) k = 'overview';
    $$('[data-dt]', el).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.dt === k)));
    $$('[data-pane]', el).forEach((x) => { x.hidden = x.dataset.pane !== k; });
    if (k === 'charts' && drawCharts) { requestAnimationFrame(drawCharts); drawCharts = null; }
    if (remember) history.replaceState(null, '', location.pathname + (k === 'overview' ? '' : '?tab=' + k));
  };
  $$('[data-dt]', el).forEach((b) => b.onclick = () => show(b.dataset.dt, true));
  show(want && want !== 'comments' ? want : 'overview');
  wireBack(el, '/activity');
  $('#d-edit', el).onclick = () => editActivity(a);
  $('#d-send', el).onclick = () => shareOut(a);
  const addMap=$('#d-add-map',el);if(addMap)addMap.onclick=()=>sheet('Add the original map',`<p>Some apps send a workout summary to Apple Health without its GPS route. Your workout summary is already here.</p><p>For a Garmin recording:</p><ol><li>Open the matching activity on the Garmin Connect website.</li><li>Choose the settings gear, then <b>Export Original</b>.</li><li>Upload the downloaded ZIP or FIT file here.</li></ol><p class="small muted">Kinetta matches the sport, start time and distance. A matching file adds the map to this workout without making a second activity. Your edited title and numbers stay.</p><a class="primary wide" href="/track/import?map_for=${a.id}">Upload the original file</a>`,(body,close)=>{body.classList.add('activity-map-help');body.querySelector('a').onclick=()=>close();});
  ownSocial(el, a);
  photoStrip($('#d-photos', el), a, true, {controlsOnly: true, afterChange: () => render()});
  wireActivityMedia(el);
  if (a.lifts) fillLiftCard(el, a);
  const kb = $('#d-kit', el);
  if (kb) kb.onclick = () => activityKit(a);
  let marker = null, pts = null, mapObj = null;
  const mapBox = $('#d-map', el);
  if (a.line) lazy(mapBox, async () => {
    try {
      const m = await mapInto(mapBox, a.track_lines?.length ? a.track_lines : [a.line], {sport: a.sport, still: !!a.photos?.length && !mapBox.classList.contains('full')});
      mapObj = m; pts = decode(a.line);
      if (m && a.photos?.length && !mapBox.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
    }
    catch (e) { console.error('map', e); if (mapBox.isConnected) mapBox.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
  });
  if (a.line) wireMediaMapFull(mapBox, () => mapObj, a.line, !!a.photos?.length);
  if (a.chart) {
    const c = a.chart, x = c.d && c.d[c.d.length - 1] > 100 ? c.d : c.t, byDist = x === c.d;
    const rows = [];
    const sp = c.speed && FOOT.includes(a.sport) && a.sport !== 'swim';
    if (c.speed) rows.push(sp ? {name: 'Pace', short: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s1'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s1'), clip: true});
    if (c.gap_speed && sp) rows.push({name: 'Grade-adjusted pace', short: 'GAP', vals: c.gap_speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s5'), invert: true, clip: true, avg: a.gap_s_per_km});
    if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s2'), avg: a.avg_hr});
    if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
    if (c.power) rows.push({name: 'Power', vals: c.power, fmt: (v) => Math.round(v), unit: 'W', color: col('--s4'), clip: true, avg: a.avg_power});
    if (c.cad) rows.push({name: 'Cadence', short: 'Cad', vals: c.cad, fmt: (v) => Math.round(v), unit: a.sport === 'ride' ? 'rpm' : 'spm', color: col('--s3'), clip: true, avg: a.avg_cad});
    const box = $('#d-charts', el);
    const draw = () => chartStack(box, x, rows, {
      xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v)),
      onIndex: (i) => {   // move a dot along the map with the crosshair
        if (!mapObj || !pts || !pts.length || !c.d) return;
        const frac = (c.d[i] - c.d[0]) / (c.d[c.d.length - 1] - c.d[0] || 1), p = pts[Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)))];
        if (!marker) marker = mapObj.L.circleMarker(p, {radius: 7, color: '#fff', weight: 2, fillColor: col('--s1'), fillOpacity: 1}).addTo(mapObj.map);
        else marker.setLatLng(p);
      }});
    let w = 0;
    drawCharts = () => { w = box.clientWidth; draw(); };
    if (!$('[data-pane="charts"]', el).hidden) { requestAnimationFrame(drawCharts); drawCharts = null; }
    new ResizeObserver(() => { if (w && box.clientWidth && Math.abs(box.clientWidth - w) > 20) { w = box.clientWidth; draw(); } }).observe(box);
  }
}
function splitsTable(a, splits) {
  const foot = FOOT.includes(a.sport);
  const paces = splits.map((s) => s.pace_s_per_km).filter(Boolean), fastest = Math.min(...paces), slowest = Math.max(...paces);
  const hasEl = splits.some((s) => s.elev_m != null), hasHr = splits.some((s) => s.avg_hr);
  return `<table class="tbl"><thead><tr><th>${U.du()}</th><th>${foot ? 'Pace' : 'Speed'}</th><th></th>${foot && splits.some((s) => s.gap_s_per_km) ? '<th class="r">GAP</th>' : ''}${hasEl ? '<th class="r">Elev</th>' : ''}${hasHr ? '<th class="r">HR</th>' : ''}</tr></thead><tbody>
    ${splits.map((s) => {
      const full = Math.abs(s.distance_m - (imp() ? MI : 1000)) < 5;
      const w = s.pace_s_per_km ? (fastest / s.pace_s_per_km) : 0;
      return `<tr class="${s.pace_s_per_km === fastest ? 'best' : ''}"><td>${full ? s.n : U.dist(s.distance_m)}</td>
        <td class="num">${foot ? U.pace(s.pace_s_per_km) : U.speed(1000 / s.pace_s_per_km)}</td><td class="barcell"><div class="bar${s.pace_s_per_km === slowest ? ' slow' : ''}" data-w="${(0.25 + 0.75 * ((w - fastest / slowest) / (1 - fastest / slowest || 1))).toFixed(3)}"></div></td>
        ${foot && splits.some((x) => x.gap_s_per_km) ? `<td class="r num">${U.pace(s.gap_s_per_km)}</td>` : ''}
        ${hasEl ? `<td class="r num">${s.elev_m != null ? (s.elev_m > 0 ? '+' : '') + U.elev(s.elev_m) : '–'}</td>` : ''}${hasHr ? `<td class="r num">${s.avg_hr || '–'}</td>` : ''}</tr>`;
    }).join('')}</tbody></table>`;
}
function lapsTable(a) {
  const foot = FOOT.includes(a.sport), hasHr = a.laps.some((l) => l.avg_hr);
  return `<table class="tbl"><thead><tr><th>Lap</th><th>Dist</th><th>Time</th><th class="r">${foot ? 'Pace' : 'Speed'}</th>${hasHr ? '<th class="r">HR</th>' : ''}</tr></thead><tbody>
    ${a.laps.map((l, i) => { const spk = l.distance_m ? (l.moving_s || l.elapsed_s) / l.distance_m * 1000 : null;
      return `<tr><td>${i + 1}</td><td class="num">${U.dist(l.distance_m)}</td><td class="num">${dur(l.moving_s || l.elapsed_s)}</td>
        <td class="r num">${spk ? (foot ? U.pace(spk) : U.speed(1000 / spk)) : '–'}</td>${hasHr ? `<td class="r num">${l.avg_hr ? Math.round(l.avg_hr) : '–'}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
}
function effortsTable(a) {
  return `<table class="tbl"><tbody>${a.efforts.map((e) => `<tr><td>${e.rank_then <= 3 ? `<span class="medal m${e.rank_then}" title="${['', 'Personal record', '2nd best', '3rd best'][e.rank_then]} at the time">${e.rank_then === 1 ? 'PR' : e.rank_then}</span>` : ''}${esc(e.label)}</td>
    <td class="r num">${dur(e.elapsed_s)}</td><td class="r small muted">${e.rank_now === 1 ? 'Current PR' : `#${e.rank_now} all-time`}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">Medals show how it ranked when you ran it. <a href="/progress?view=records&sport=${esc(a.sport)}">All records ›</a></p>`;
}
function zonesHtml(z) {
  const tot = z.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zones">${z.map((s, i) => `<div class="zone"><span>Z${i + 1}</span><div><div class="bar z${i + 1}" data-w="${(s / tot).toFixed(3)}"></div><small class="muted">${ZN[i]}</small></div><span class="num r">${dur(s, true)}</span></div>`).join('')}</div>`;
}
function similarHtml(a) {
  const mine = a.moving_s && a.distance_m ? a.moving_s / a.distance_m * 1000 : null;
  return a.similar.map((s) => {
    const p = s.moving_s && s.distance_m ? s.moving_s / s.distance_m * 1000 : null;
    const diff = mine && p ? p - mine : null;
    const foot = FOOT.includes(a.sport);
    const cmp = diff == null ? '' : Math.abs(diff) < 2 ? 'same pace' : `${diff > 0 ? 'you were' : 'it was'} ${foot ? Math.round(Math.abs(imp() ? diff * MI / 1000 : diff)) + ' s' + U.pu() : U.speed(Math.abs(1000 / mine - 1000 / p)) + ' ' + U.su()} faster`;
    return `<a class="row-link" href="/activity/${s.id}" data-prefetch="/api/activities/${s.id}"><div><b>${esc(s.name)}</b><br><small class="muted">${esc(fdate(s.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))} · ${U.dist(s.distance_m)} ${U.du()}${s.same_route ? ' · same route' : ''}</small></div>
      <div class="r"><b class="num">${p ? (foot ? U.pace(p) + U.pu() : U.speed(1000 / p) + ' ' + U.su()) : '–'}</b><br><small class="muted">${esc(cmp)}</small></div></a>`;
  }).join('');
}

function editActivity(a) {
  // the same grouped kinds as Add an activity (2026-10-13, Ben: Edit only had the nine sports); a kind from an import that
  // isn't in the list (Strava's "Trail Run") stays as the first choice
  const kinds = HAND_KINDS.flatMap(([, list], gi) => list.map(([sp, , lb], i) => ({v: `${gi}.${i}`, sp, lb: lb || null})));
  const cur = kinds.find((k) => k.sp === a.sport && k.lb === (a.sport_label || null)) || (!a.sport_label && kinds.find((k) => k.sp === a.sport && !k.lb));
  const keep = cur ? '' : `<option value="keep" selected>${esc(a.sport_label || SPORT_NAMES[a.sport] || 'Activity')}</option>`;
  const kindOpts = keep + HAND_KINDS.map(([g, list], gi) => `<optgroup label="${esc(g)}">${list.map(([, n], i) => `<option value="${gi}.${i}"${cur && cur.v === `${gi}.${i}` ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
  // "1:34:50", "34:50" or plain minutes ("95") -> seconds; anything else -> NaN
  const clockSecs=(v)=>{const p=v.split(':');if(p.length>3||p.some((x)=>!/^\d+([.,]\d+)?$/.test(x.trim())))return NaN;const n=p.map((x)=>Number(x.trim().replace(',','.')));return p.length===1?n[0]*60:p.length===2?n[0]*60+n[1]:n[0]*3600+n[1]*60+n[2]};
  const summaryFields=[['distance_m','Distance',imp()?'mi':'km',imp()?1609.344:1000],['moving_s','Moving time','h:mm:ss',1],['elapsed_s','Total duration','h:mm:ss',1],['ascent_m','Elevation gain',imp()?'ft':'m',imp()?0.3048:1],['calories','Energy','kcal',1],['avg_hr','Average heart rate','bpm',1],['max_hr','Maximum heart rate','bpm',1]];
  const initial={};
  // times as 1:34:50 like everywhere else in the app; heart rate, energy and climb as whole numbers (2026-10-16)
  const isTime=(key)=>key.endsWith('_s');
  const correctionFields=summaryFields.map(([key,label,unit,scale])=>{const value=a[key]==null?'':isTime(key)?dur(a[key]):key==='distance_m'?String(Math.round(a[key]/scale*100)/100):String(Math.round(a[key]/scale));initial[key]=value;return `<label>${label} (${unit})<input name="summary_${key}" inputmode="${isTime(key)?'text':'decimal'}" value="${value}" placeholder="Not recorded" aria-label="${label} in ${isTime(key)?'hours, minutes and seconds':unit}"></label>${Object.hasOwn(a.summary_overrides||{},key)?`<label class="check"><input type="checkbox" name="restore_${key}"> Use recorded ${label.toLowerCase()}</label>`:''}`}).join('');
  sheet('Edit activity', `<form class="form" id="e-form">
    <label>Title<input name="name" value="${esc(a.name)}" maxlength="200" enterkeyhint="done"></label>
    <label>What did you do?<span class="selbox"><select name="kind">${kindOpts}</select>${svg('chev')}</span></label>
    <details id="e-summary" class="fold-row"><summary><span class="ri c-brand">${svg('edit')}</span><span class="grow"><b>Distance, time & heart rate</b><small>Fix numbers your watch got wrong</small></span><span class="chev">${svg('chev')}</span></summary><div class="form e-fields"><p class="small muted">Your edits stay when Apple Health syncs again. Leave a box empty if it wasn't recorded. Changing distance or time hides records and splits; tick “Use recorded” to undo an edit.</p>${correctionFields}</div></details>
    ${optionalText('description', 'Description', 'Add a description', a.description)}
    ${optionalText('private_note', 'Private note (only you)', 'Add a private note', a.private_note)}
    <label>Gear<span class="selbox"><select name="gear"><option value="">None</option></select>${svg('chev')}</span></label>
    <label class="check"><input type="checkbox" name="commute"${a.commute ? ' checked' : ''}> Commute</label>
    <div id="e-share" class="e-share"><p class="small muted">Loading sharing…</p></div>
    <div class="actions"><button type="button" class="ghost danger" id="e-del">Delete</button><span class="spacer"></span>
      <button type="button" class="ghost" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, async (body, close) => {
    const f = $('#e-form', body);
    wireOptionalText(f);
    let saveShare = null;   // sharing (2026-10-12): moved here from the activity page
    (a._social ? Promise.resolve(a._social) : api(`/api/activities/${a.id}/social`))
      .then((s) => { if (f.isConnected) saveShare = shareFields($('#e-share', body), a.id, s); })
      .catch(() => { $('#e-share', body).innerHTML = '<p class="small muted">Sharing could not load. Try again later.</p>'; });
    api('/api/gear').then((gear) => { f.gear.insertAdjacentHTML('beforeend', gear.filter((g) => !g.retired || g.id === a.gear_id).map((g) => `<option value="${g.id}"${g.id === a.gear_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')); }).catch(() => {});
    f.onsubmit = async (e) => {
      e.preventDefault();
      const k = kinds.find((x) => x.v === f.kind.value);
      // by tag: the sharing choices below include a checkbox also named "description" (it made Save wipe the text)
      const text = (name) => f.querySelector(`textarea[name="${name}"]`).value;
      const body2 = {description: text('description'), private_note: text('private_note'), commute: f.commute.checked};
      if (k) { body2.sport = k.sp; body2.sport_label = k.lb || ''; }
      if (f.name.value !== a.name) body2.name = f.name.value;   // left alone, a name nobody typed follows the kind ("Lunch Yoga")
      if (f.gear.value) body2.gear_id = +f.gear.value; else body2.clear_gear = true;
      body2.restore_summary=[];
      for(const [key,label,,scale] of summaryFields){if(f.elements['restore_'+key]?.checked){body2.restore_summary.push(key);continue}const value=f.elements['summary_'+key].value.trim();if(value===initial[key])continue;const number=value===''?null:isTime(key)?clockSecs(value):Number(value.replace(',','.'))*scale;if(number!==null&&!Number.isFinite(number)){toast(isTime(key)?`Enter ${label.toLowerCase()} like 1:34:50`:'Enter a valid '+label.toLowerCase());return}body2[key]=number}
      const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api(`/api/activities/${a.id}`, json('PATCH', body2));
        if (saveShare) await saveShare();
        invalidate('/api/'); close(); toast('Saved'); render();
      } catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Save'; }
    };
    $('#e-del', body).onclick = async () => {
      if (!confirm(`Delete "${a.name}"? This can't be undone.`)) return;
      try { await api(`/api/activities/${a.id}`, {method: 'DELETE'}); invalidate('/api/'); close(); toast('Activity deleted'); go('/activity', {replace: true}); }
      catch (x) { toast(x.message); }
    };
  });
}

// ---------- Share (2026-10-12): send a link to people on Kinetta, or a picture of the route and the key numbers ----------
Object.assign(IC, {share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M8 11H6v10h12V11h-2"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'});
const appBase = () => (Native.on && Native.base ? Native.base : location.origin);
function shareOut(a) {
  const ch = `<span class="chev">${svg('chev')}</span>`;
  sheet('Share', `<div class="pick-list">
      <button type="button" class="row-link" id="so-link"><span class="ri c-blue">${svg('link')}</span><span class="grow">Send a link<small class="muted gs-sub" id="so-who">For friends on Kinetta</small></span>${ch}</button>
      <button type="button" class="row-link" id="so-img"><span class="ri c-orange">${svg('image')}</span><span class="grow">Share a picture<small class="muted gs-sub">The route with distance, ${FOOT.includes(a.sport) ? 'pace' : 'speed'}, time and climb</small></span>${ch}</button></div>`, async (b, close) => {
    let s = a._social;
    if (!s) try { s = a._social = await api(`/api/activities/${a.id}/social`); } catch (x) { /* asked again on tap */ }
    const who = $('#so-who', b);
    if (s) who.textContent = s.visibility === 'me' ? 'Only you can see it now. Sending shares it with your friends' : s.visibility === 'friends' ? 'Opens for your friends on Kinetta' : 'Opens for anyone with a Kinetta account here';
    $('#so-link', b).onclick = async () => {
      try {
        if (!s) s = a._social = await api(`/api/activities/${a.id}/social`);
        if (s.visibility === 'me') {   // a link nobody can open is no use: share it with friends first, and say so
          await api(`/api/activities/${a.id}/sharing`, json('PUT', {visibility: 'friends'}));
          s.visibility = 'friends'; socialChanged(a.id); toast('Shared with your friends');
        }
        const url = `${appBase()}/activity/friends/${a.id}`;
        close();
        if (navigator.share) { navigator.share({title: a.name, url}).catch(() => {}); return; }
        await navigator.clipboard.writeText(url); toast('Link copied');
      } catch (x) { toast(x.message || 'Could not copy the link'); }
    };
    $('#so-img', b).onclick = () => { close(); pictureSheet(a, s); };
  });
}
// The picture: 1080 × 1350 (fits Instagram, Messages and stories), always dark so it looks the same for everyone.
// The start and end are cut off by the person's "hide the start and end" distance (400 m when that is off), so a
// picture doesn't show where they live, unless they untick it.
function pictureSheet(a, s) {
  const trim = (s && s.trim_m) || 400, hasLine = !!(a.line && decode(a.line).length > 1);
  sheet('Share a picture', `<div class="pic-wrap"><img class="pic" id="pi-img" alt="Picture of ${esc(a.name)}"></div>
    ${hasLine ? `<label class="check"><input type="checkbox" id="pi-trim" checked> Hide where it starts and ends</label>` : ''}
    <div class="btnrow one"><button class="primary" id="pi-go">Share picture</button></div>`, (b) => {
    let blob = null;
    const img = $('#pi-img', b), t = $('#pi-trim', b), go = $('#pi-go', b);
    const make = () => {      // the map tiles take a moment: the button waits for the picture
      go.disabled = true; $('.pic-wrap', b).classList.add('busy');
      return routePicture(a, t && !t.checked ? 0 : trim).then((bl) => { blob = bl; if (img.src) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(bl); })
        .finally(() => { go.disabled = false; $('.pic-wrap', b).classList.remove('busy'); });
    };
    make(); if (t) t.onchange = make;
    go.onclick = async () => {
      if (!blob) return;
      const file = new File([blob], `${(a.name || 'activity').replace(/[^\w -]+/g, '').trim() || 'activity'}.png`, {type: 'image/png'});
      if (navigator.canShare && navigator.canShare({files: [file]})) { navigator.share({files: [file], title: a.name}).catch(() => {}); return; }
      const l = document.createElement('a'); l.href = img.src; l.download = file.name; document.body.append(l); l.click(); l.remove();
      toast('Picture saved');
    };
  });
}
// cut `m` metres off each end of the route; nothing left (a short loop) means no route is drawn
function trimRoute(pts, m) {
  if (!m) return pts;
  const R = 6371000, rad = Math.PI / 180, cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const [la1, lo1] = pts[i - 1], [la2, lo2] = pts[i];
    const x = (lo2 - lo1) * rad * Math.cos((la1 + la2) / 2 * rad), y = (la2 - la1) * rad;
    cum.push(cum[i - 1] + Math.hypot(x, y) * R);
  }
  const end = cum[cum.length - 1] - m;
  return end - m < 200 ? [] : pts.filter((_, i) => cum[i] >= m && cum[i] <= end);
}
// the map behind the route: OpenStreetMap tiles (they allow this: CORS on, credited on the picture), zoomed so the route
// fills the box. Tiles that don't load are skipped; with none, the dark background stays.
const TILE = 256;
function mercator(la, lo) {     // 0..1 across the world map
  const s = Math.sin(la * Math.PI / 180);
  return [(lo + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
function loadTile(url) {
  return new Promise((res) => {
    const im = new Image(); im.crossOrigin = 'anonymous'; im.referrerPolicy = 'strict-origin-when-cross-origin';
    const t = setTimeout(() => res(null), 8000);
    im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); };
    im.src = url;
  });
}
async function mapPlace(g, pts, box) {      // draws the tiles; returns lat/lon -> canvas x/y
  const m = pts.map(([la, lo]) => mercator(la, lo));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of m) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fit = Math.min((box.w - 2 * box.pad) / Math.max((x1 - x0) * TILE, 1e-9), (box.h - 2 * box.pad - box.under) / Math.max((y1 - y0) * TILE, 1e-9));
  const zf = Math.max(3, Math.min(18, Math.log2(fit))), z = Math.min(17, Math.floor(zf)), k = Math.min(2, 2 ** (zf - z)), n = TILE * 2 ** z;
  const cx = (x0 + x1) / 2 * n, cy = (y0 + y1) / 2 * n, mx = box.x + box.w / 2, my = box.y + (box.h - box.under) / 2;
  const tx0 = Math.floor((cx + (box.x - mx) / k) / TILE), tx1 = Math.floor((cx + (box.x + box.w - mx) / k) / TILE);
  const ty0 = Math.max(0, Math.floor((cy + (box.y - my) / k) / TILE)), ty1 = Math.min(2 ** z - 1, Math.floor((cy + (box.y + box.h - my) / k) / TILE));
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    const wx = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
    jobs.push(loadTile(`https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`).then((im) => im && [im, tx, ty]));
  }
  const got = (await Promise.all(jobs)).filter(Boolean);
  g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  for (const [im, tx, ty] of got) g.drawImage(im, (tx * TILE - cx) * k + mx, (ty * TILE - cy) * k + my, TILE * k + 0.5, TILE * k + 0.5);
  g.restore();
  return {tiles: got.length, P: ([la, lo]) => { const [x, y] = mercator(la, lo); return [(x * n - cx) * k + mx, (y * n - cy) * k + my]; }};
}
async function routePicture(a, trim) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), font = getComputedStyle(document.body).fontFamily, accent = col('--accent') || '#E0582B', BG = '#121418';
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#1d1f24'); bg.addColorStop(1, '#0d0e11');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the map and route across the top; it fades into the dark panel with the numbers
  const pts = a.line ? trimRoute(decode(a.line), trim) : [];
  const MAPH = 840;
  let tiles = 0;
  if (pts.length > 1) {
    const {tiles: t, P} = await mapPlace(g, pts, {x: 0, y: 0, w: W, h: MAPH, pad: 110, under: 150});
    tiles = t;
    if (tiles) { g.fillStyle = 'rgba(12,14,18,.18)'; g.fillRect(0, 0, W, MAPH); }
    const fade = g.createLinearGradient(0, MAPH - 260, 0, MAPH); fade.addColorStop(0, 'rgba(18,20,24,0)'); fade.addColorStop(1, BG);
    g.fillStyle = fade; g.fillRect(0, MAPH - 260, W, 260);
    g.fillStyle = BG; g.fillRect(0, MAPH, W, H - MAPH);
    g.lineJoin = g.lineCap = 'round';
    const path = () => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
    path(); g.strokeStyle = tiles ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.12)'; g.lineWidth = tiles ? 20 : 26; g.stroke();
    path(); g.strokeStyle = accent; g.lineWidth = 11; g.stroke();
    if (!trim) for (const [p, f] of [[pts[0], '#3fb950'], [pts[pts.length - 1], '#f85149']]) {
      const [x, y] = P(p); g.beginPath(); g.arc(x, y, 15, 0, 7); g.fillStyle = f; g.fill(); g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
    }
  }
  // the name, the day, then up to four numbers
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  g.font = `800 56px ${font}`;
  const words = (a.name || '').split(/\s+/), lines = [''];
  for (const w of words) { const t = (lines[lines.length - 1] + ' ' + w).trim(); if (g.measureText(t).width > W - 180 && lines[lines.length - 1]) { if (lines.length === 2) { lines[1] += '…'; break; } lines.push(w); } else lines[lines.length - 1] = t; }
  let y = 880; lines.forEach((l) => { g.fillText(l, 90, y); y += 64; });
  const dateY = y - 10;
  g.font = `500 30px ${font}`; g.fillStyle = 'rgba(255,255,255,.62)';
  g.fillText(`${fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'})} · ${a.sport_label || SPORT_NAMES[a.sport]}`, 90, dateY);
  const r = rate(a), cells = [];
  if (a.distance_m) cells.push(['Distance', U.dist(a.distance_m), U.du()]);
  if (a.distance_m && a.moving_s) cells.push([r.label, r.v, r.u]);
  cells.push(['Time', dur(a.moving_s || a.elapsed_s), '']);
  if (a.ascent_m != null) cells.push(['Elevation gain', U.elev(a.ascent_m), U.eu()]);
  else if (a.avg_hr) cells.push(['Avg heart rate', String(Math.round(a.avg_hr)), 'bpm']);
  else if (a.calories) cells.push(['Calories', String(Math.round(a.calories)), '']);
  // two columns, up to two rows, so long times and climbs never run into each other
  const cw = (W - 180) / 2, top = dateY + 78;
  cells.slice(0, 4).forEach(([lab, v, u], i) => {
    const x = 90 + (i % 2) * cw, y0 = top + Math.floor(i / 2) * 130;
    g.font = `600 24px ${font}`; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(lab.toUpperCase(), x, y0);
    g.font = `800 60px ${font}`; g.fillStyle = '#fff'; g.fillText(v, x, y0 + 66);
    if (u) { const vw = g.measureText(v).width; g.font = `600 28px ${font}`; g.fillStyle = 'rgba(255,255,255,.62)'; g.fillText(u.trim(), x + vw + 10, y0 + 66); }
  });
  if (tiles) { g.font = `500 20px ${font}`; g.fillStyle = 'rgba(255,255,255,.4)'; g.fillText('Map © OpenStreetMap contributors', 90, H - 40); }
  g.font = `800 30px ${font}`; g.fillStyle = accent; g.textAlign = 'right'; g.fillText('Kinetta', W - 90, H - 40);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// ---------- Matched route ----------
route(/^\/route\/(\d+)$/, 'progress', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn()}</div>${skel(1)}<div class="sk block"></div>${skel(1)}`;
  wireBack(el, '/progress/routes');
  await load(`/api/routes/${id}`, (r) => {
    const acts = r.activities, foot = FOOT.includes(r.sport) || r.sport === 'walk';
    const pts = acts.filter((a) => a.moving_s && a.distance_m).map((a) => ({x: new Date(a.start_time) / 864e5, y: a.moving_s / a.distance_m * 1000, id: a.id}));
    const t = r.pace_trend, e = r.efficiency_trend;
    const perMonth = t ? t.slope_per_day * 30 : null;
    let headline = '';
    if (t && Math.abs(perMonth) >= 1) headline = `${perMonth < 0 ? 'Getting faster' : 'Getting slower'}: about ${foot ? Math.round(Math.abs(imp() ? perMonth * MI / 1000 : perMonth)) + ' s' + U.pu() : ''} per month on this route.`;
    if (e && t) { const effUp = e.slope_per_day > 0; headline += effUp ? ' Your pace per heartbeat is improving: you\'re fitter at the same effort.' : ' Pace per heartbeat is slipping. Heat, fatigue or easier days can do that.'; }
    const best = acts.find((a) => a.id === r.fastest_id);
    el.innerHTML = `<div class="top">${backBtn()}<button class="icon-btn" id="r-edit" aria-label="Rename route">${svg('edit')}</button></div>
      <div class="card"><h1>${esc(r.name)}</h1><p class="muted">${acts.length} times · ${SPORT_NAMES[r.sport] || 'Activity'} · first ${esc(fdate(acts[0].start_time, {month: 'short', year: 'numeric'}))}</p>
        <div class="hero">${stat('Best', dur(best && best.moving_s))}${stat('Average', dur(acts.reduce((s, a) => s + (a.moving_s || 0), 0) / acts.length))}${stat('Distance', U.dist(acts[0].distance_m), U.du())}</div></div>
      ${r.line ? '<div class="map" id="r-map"></div>' : ''}
      <div class="card"><h2>${foot ? 'Pace' : 'Speed'} over time</h2>${headline ? `<div class="callout">${esc(headline)}</div>` : ''}<div id="r-chart"></div>
        <div class="badges"><span class="badge pr">● Fastest</span><span class="badge">- - Trend</span></div></div>
      <div class="card"><h2>Every time</h2>${[...acts].reverse().map((a) => `<a class="row-link" href="/activity/${a.id}" data-prefetch="/api/activities/${a.id}">
        <div><b>${a.id === r.fastest_id ? '<span class="badge pr">' + svg('trophy') + ' Fastest</span> ' : ''}${esc(fdate(a.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</b><br><small class="muted">${esc(a.name)}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}${a.avg_temp != null ? ' · ' + U.temp(a.avg_temp) : ''}</small></div>
        <div class="r"><b class="num">${dur(a.moving_s)}</b><br><small class="muted num">${foot ? U.pace(a.moving_s / a.distance_m * 1000) + U.pu() : U.speed(a.distance_m / a.moving_s) + ' ' + U.su()}</small></div></a>`).join('')}</div>`;
    wireBack(el, '/progress/routes');
    requestAnimationFrame(() => dotChart($('#r-chart', el), pts, {yfmt: (v) => (foot ? U.pace(v) : U.speed(1000 / v)), invert: true, trend: t, best: r.fastest_id}));
    if (r.line) lazy($('#r-map', el), () => mapInto($('#r-map', el), [r.line], {sport: r.sport}).catch(() => {}));
    $('#r-edit', el).onclick = () => sheet('Rename route', `<form class="form"><label>Name<input name="name" value="${esc(r.name)}" maxlength="120" enterkeyhint="done"></label>
      <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (b, close) => {
      $('form', b).onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/api/routes/${id}`, json('PATCH', {name: $('input', b).value})); invalidate('/api/'); close(); render(); } catch (x) { toast(x.message); } };
    });
  });
});

// ---------- Progress (2026-10-12 redesign): one row of small buttons ----------
// Ben: "too many random tabs at the top". Earlier (2026-10-11) the tab had a Totals | Fitness | Records control, a
// sport button, a Weeks | Months | Years row and a "More" list at the bottom. Now every view (the three main ones and
// the deeper ones) is in one View menu, and the filters that view uses sit beside it in a single row: View, Sport,
// then the period (Totals) or the years (Fitness, Year over year). The sport is remembered on this phone.
const PSPORTS = [['run', 'Runs'], ['ride', 'Rides'], ['walk', 'Walks'], ['hike', 'Hikes'], ['all', 'All sports']];
const PVIEWS = [['totals', 'Totals', 'Distance by week, month and year', 'progress', 'c-red'],
  ['fitness', 'Fitness', 'Race predictions, fitness and form', 'flame', 'c-orange'], ['records', 'Records', 'Your fastest times at each distance', 'trophy', 'c-purple'],
  ['lifting', 'Lifting', 'Every exercise, your bests and its history', 'workout', 'c-brand']];
const PMORE = [['trends', 'Year over year', 'Pace, heart rate and distance, year by year', 'progress', 'c-blue'],
  ['calendar', 'Calendar', 'Training and eating, day by day', 'calendar', 'c-orange'], ['routes', 'Routes', 'Loops you repeat, and your trend on each', 'activity', 'c-green'],
  ['heatmap', 'Heatmap', "Everywhere you've been", 'globe', 'c-brand'], ['plan', 'Training plan', '5K to marathon, built around your runs', 'target', 'c-purple']];
const PPERIODS = [['week', 'Weeks'], ['month', 'Months'], ['year', 'Years']];
function pSport(q) {
  let s = q.get('sport'); if (!s) try { s = localStorage.getItem('fit.psport'); } catch (e) { /* no storage */ }
  return PSPORTS.some((p) => p[0] === s) ? s : 'run';
}
const pillBtn = (id, ico, name, label) => `<button type="button" class="range-btn" id="${id}" aria-label="${esc(label)}: ${esc(name)}. Change">${ico ? svg(ico) : ''}<span>${esc(name)}</span>${svg('down')}</button>`;
const sportBtn = (cur) => { const k = cur || 'all'; return pillBtn('p-sport', k === 'all' ? 'activity' : k, PSPORTS.find((p) => p[0] === k)[1], 'Sport'); };
// a sheet listing choices, the current one ticked; pick(key) is called with the chosen one
const pickRows = (rows, cur) => `<div class="pick-list">${rows.map(([k, n, d, ic, c]) => `<button type="button" class="row-link" data-pk="${k}">${ic ? `<span class="ri ${c}">${svg(ic)}</span>` : ''}
  <span class="grow"><span>${esc(n)}</span>${d ? `<small class="muted">${esc(d)}</small>` : ''}</span>${k === cur ? `<span class="tick">${svg('check')}</span>` : ''}</button>`).join('')}</div>`;
function pickSheet(title, html, pick) {
  sheet(title, html, (sb, close) => $$('[data-pk]', sb).forEach((x) => x.onclick = () => { close(); pick(x.dataset.pk); }));
}
function wireSport(el, cur) {
  const b = $('#p-sport', el); if (!b) return;
  b.onclick = () => pickSheet('Sport', pickRows(PSPORTS.map(([k, n]) => [k, n, '', k === 'all' ? 'activity' : k, 'c-grey']), cur), (k) => {
    try { localStorage.setItem('fit.psport', k); } catch (e) { /* no storage */ }
    const u = new URLSearchParams(location.search); u.set('sport', k); go(location.pathname + '?' + u.toString(), {replace: true});
  });
}
// Keep the two halves of Progress together; explicit old training URLs still open Training.
const progressKey = () => 'fit.progress:' + JSON.stringify([Native.base || location.origin,App.me.id]);
const progressChoice = () => store.get(progressKey()) || 'food';
function progressSwitch(section) {
  store.set(progressKey(),section);
  return `<nav class="progress-switch" aria-label="Progress focus"><a href="/progress?section=food"${section === 'food' ? ' aria-current="page"' : ''}>Food &amp; weight</a><a href="/progress?section=training&amp;view=totals"${section === 'training' ? ' aria-current="page"' : ''}>Training</a></nav>`;
}
function nutritionHref(view, params = '') {
  return location.pathname === '/progress' ? `/progress?section=food&foodview=${view}${params ? '&' + params : ''}` : `/food?view=${view}${params ? '&' + params : ''}`;
}
async function foodProgress(el,q) {
  const requested = q.get('foodview') || 'overview', view = NPROG.some(v => v[0] === requested) || requested === 'calendar' ? requested : 'overview';
  if (view !== 'calendar') return nutritionView(el,view,q);
  const box = nHead(el,'calendar','');
  await load('/api/food/insights?days=90',I => {
    if (!box.isConnected) return;
    const rows = (I.rows || []).slice().sort((a,b)=>b.day.localeCompare(a.day)), logged = rows.filter(r => r.eaten > 0);
    box.innerHTML = `<section class="card"><h2>Food calendar</h2><p class="small muted">${logged.length} days with food logged in the last 90 days. Newest first · open a day to review it.</p>${logged.length ? `<div class="food-calendar">${rows.map(r => `<a href="/food?d=${esc(r.day)}" aria-label="${esc(dayLabel(r.day))}, ${r.eaten ? homeCalories(r.eaten) + ' kcal logged' : 'no foods logged'}"${r.eaten ? ' class="logged"' : ''}><small>${esc(new Date(r.day+'T12:00').toLocaleDateString([],{month:'short'}))}</small><b>${new Date(r.day+'T12:00').getDate()}</b><small>${r.eaten ? r0(homeCalories(r.eaten)) + ' kcal' : '—'}</small></a>`).join('')}</div>` : '<p>Log something you ate to start your calendar.</p><a class="primary wide" href="/food">Open food log</a>'}</section>`;
  });
}
// the header every Progress view shares: title + bell, then View and the filters this view uses
function pHead(el, view, filters) {
  const v = [...PVIEWS, ...PMORE].find((m) => m[0] === view);
  el.innerHTML = `<div class="top"><h1>Progress</h1><div class="acts">${bellBtn()}</div></div>${progressSwitch('training')}
    <nav class="view-nav" aria-label="Progress views">${PVIEWS.slice(0,3).map(([k,n]) => `<a href="/progress${k === 'totals' ? '' : '?view=' + k}"${view === k ? ' aria-current="page"' : ''}>${n}</a>`).join('')}${pillBtn('p-view', '', 'More', 'More progress views')}</nav><div class="pbar">${filters}</div><div id="p-combined-week"></div><div id="p-body">${skel(2)}</div>`;
  combinedWeek($('#p-combined-week',el));
  $('#p-view', el).onclick = () => pickSheet('Show', `<h3 class="ghead">Your numbers</h3>${pickRows(PVIEWS, view)}<h3 class="ghead">Explore</h3>${pickRows(PMORE, view)}`, (k) => {
    if (k === 'plan') return go('/plan');
    const keep = new URLSearchParams(); const s = new URLSearchParams(location.search).get('sport'); if (s) keep.set('sport', s);
    if (PVIEWS.some((m) => m[0] === k)) { if (k !== 'totals') keep.set('view', k); go('/progress' + (keep.toString() ? '?' + keep : ''), {replace: true}); }
    else go(`/progress/${k}${keep.toString() ? '?' + keep : ''}`, {replace: true});
  });
}
// each view takes the sports it can show: the shared choice, mapped to the nearest one it has
const forView = (sport, view) => ({totals: {hike: 'walk'}, records: {all: 'run'}, trends: {hike: 'walk', all: 'run'}, heatmap: {all: ''}}[view] || {})[sport] ?? sport;
route(/^\/progress$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search);
  if (q.get('section') === 'food' || (!q.has('section') && !q.has('view') && progressChoice() === 'food')) return foodProgress(el,q);
  const v0 = q.get('view') || 'totals';
  if (v0 === 'plan') return go('/plan', {replace: true});
  if (PMORE.some((m) => m[0] === v0)) { q.delete('view'); return go(`/progress/${v0}${q.toString() ? '?' + q : ''}`, {replace: true}); }   // old addresses
  const view = v0 === 'mileage' ? 'totals' : PVIEWS.some((p) => p[0] === v0) ? v0 : 'totals', sport = pSport(q);
  const period = PPERIODS.some((p) => p[0] === q.get('period')) ? q.get('period') : 'week';
  pHead(el, view, view === 'lifting' ? '' : view === 'fitness' ? '<span class="rng" id="p-rng"></span>'
    : sportBtn(forView(sport, view)) + (view === 'totals' ? pillBtn('p-period', '', PPERIODS.find((p) => p[0] === period)[1], 'Show by') : ''));
  wireSport(el, sport);
  const pb = $('#p-period', el);
  if (pb) pb.onclick = () => pickSheet('Show by', pickRows(PPERIODS, period), (k) => { const u = new URLSearchParams(location.search); u.set('period', k); go('/progress?' + u.toString(), {replace: true}); });
  q.set('sport', forView(sport, view)); q.set('period', period);
  await ({totals: pMileage, fitness: pFitness, records: pRecords, lifting: pLifting}[view])($('#p-body', el), q);
});
route(/^\/progress\/(trends|calendar|routes|heatmap)$/, 'progress', async (el, view) => {
  const q = new URLSearchParams(location.search), sport = pSport(q), withSport = view === 'trends' || view === 'heatmap';
  pHead(el, view, (withSport ? sportBtn(forView(sport, view)) : '') + (view === 'trends' ? '<span class="rng" id="p-rng"></span>' : ''));
  wireSport(el, sport);
  q.set('sport', forView(sport, view));
  await ({trends: pTrends, calendar: pCalendar, routes: pRoutes, heatmap: pHeatmap}[view])($('#p-body', el), q);
});
async function pFitness(body, q) {
  const R = getRange(q), nowY = new Date().getFullYear();
  const days = R.from ? Math.min(3650, Math.ceil((Date.now() - new Date(R.from, 0, 1)) / 864e5) + 1) : 3650;
  // the years button (in the row at the top since the 2026-10-12 redesign) changes the charts, not the predictions
  body.innerHTML = `<div id="fi-pred">${skel(1)}</div><div id="fi-body">${skel(1)}</div>`;
  await load(`/api/fitness?days=${days}`, (f0) => {
    const box = $('#fi-body', body), pbox = $('#fi-pred', body); if (!box) return;
    const f = {...f0, days: f0.days.filter((d) => inRange(R, +d.d.slice(0, 4)))};
    rangeBar($('#p-rng'), R, f0.vdot_months.length ? +f0.vdot_months[0].m.slice(0, 4) : f0.days.length ? +f0.days[0].d.slice(0, 4) : nowY);
    const last = f0.days[f0.days.length - 1] || {fitness: 0, fatigue: 0, form: 0}, b = f.basis;
    pbox.innerHTML = f.predictions.length ? `<div class="card"><h2>Race predictions</h2><div class="pred">${f.predictions.map((p) => {
      // green means something (2026-10-13, Ben): the prediction beats your best ever at that distance
      const pr = p.best_s && p.seconds < p.best_s - 1;
      return `<div${pr ? ' class="pr"' : ''}><small class="muted">${esc(p.label)}</small><b class="num">${dur(p.seconds)}</b><small class="muted num">${U.pace(p.seconds / p.distance_m * 1000)}${U.pu()}</small>
        <small class="pbest">${p.best_s ? `${pr ? 'Beats your best,' : 'Your best:'} ${esc(dur(p.best_s))}` : 'Not raced yet'}</small></div>`; }).join('')}</div>
        <p class="small muted">From your best efforts of the last 90 days (fastest: <a href="/activity/${b.activity_id}">${esc(b.label)} in ${esc(dur(b.elapsed_s))}</a>, ${esc(fdate(b.start_time, {month: 'short', day: 'numeric'}))}). Half and full marathon times allow for your weekly mileage: they get faster as it grows.</p></div>`
      : '<div class="card"><h2>Race predictions</h2><p class="muted">Run a mile or more in the last 90 days and predictions appear here.</p></div>';
    box.innerHTML = `<div class="card"><h2>Running fitness</h2>${f.vdot_months.length ? `<div class="bigstat">${stat('VDOT now', f.vdot_now || '–')}${stat(R.from || R.to ? 'Best in range' : 'Best ever', ((v) => (v.length ? Math.max(...v).toFixed(1) : '–'))(f.vdot_months.filter((m) => inRange(R, +m.m.slice(0, 4))).map((m) => m.v)))}</div><div id="p-vdot"></div>
        <p class="small muted">VDOT is Jack Daniels' race-fitness number: what your fastest stretch each month (a mile or longer) shows you can do. Higher is fitter; about 1 point ≈ 1.5% faster.</p>` : '<p class="muted">Needs runs of a mile or longer.</p>'}</div>
      <div class="card"><h2>Fitness, fatigue & form</h2>
      <div class="bigstat">${stat('Fitness', Math.round(last.fitness))}${stat('Form', (last.form > 0 ? '+' : '') + Math.round(last.form))}</div>
      <div id="p-load"></div><p class="small muted">Fitness = 6-week average training load, fatigue = last week. Form = fitness − fatigue: positive means fresh, very negative means overreaching.</p>
      ${f.ramp_7d > 8 ? '<div class="callout warn">Fitness rose fast this week (ramp ' + f.ramp_7d + '). Build gradually to stay healthy.</div>' : ''}</div>`;
    requestAnimationFrame(() => {
      loadChart($('#p-load', box), f.days);
      if (f.vdot_months.length) trendLine($('#p-vdot', box), monthSeries(f.vdot_months[0].m, (m) => { const r = f.vdot_months.find((x) => x.m === m); return r ? {y: r.v} : {y: null}; }),
        {fmt: (v) => v.toFixed(1), color: 'run', keep: (p) => inRange(R, p.d.getFullYear())});
    });
  });
}
async function pRecords(body, q) {
  const sport = q.get('sport') || 'run';
  body.innerHTML = `<div id="r-body">${skel(2)}</div>`;
  await load(`/api/records?sport=${sport}`, (r) => {
    const yr = new Date().getFullYear();
    $('#r-body', body).innerHTML = r.efforts.length ? `<div class="card"><table class="tbl"><thead><tr><th>Distance</th><th class="r">Best</th><th class="r">${yr}</th></tr></thead><tbody>
      ${r.efforts.map((e) => `<tr><td><a href="/records/${sport}/${e.distance_m}">${esc(e.label)}</a><br><small class="muted">${e.count} efforts</small></td>
        <td class="r"><a class="num" href="/activity/${e.top[0].activity_id}"><b>${dur(e.top[0].elapsed_s)}</b></a><br><small class="muted">${esc(fdate(e.top[0].start_time, {month: 'short', year: 'numeric'}))}</small></td>
        <td class="r num">${e.year ? dur(e.year.elapsed_s) : '–'}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Tap a distance for its PR history. Best efforts are found inside every ${SPORT_NAMES[sport].toLowerCase()}, not just races.</p></div>
      ${r.power_curve.length ? `<div class="card"><h2>Best power</h2><table class="tbl">${r.power_curve.map((p) => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r num">${p.watts} W</td></tr>`).join('')}</table></div>` : ''}`
      : `<div class="card empty"><b>No ${SPORT_NAMES[sport].toLowerCase()} records yet</b>They appear as soon as you upload activities with GPS or distance data.</div>`;
  });
}
route(/^\/records\/(\w+)\/([\d.]+)$/, 'progress', async (el, sport, dist) => {
  el.innerHTML = `<div class="top">${backBtn('Records')}</div>${skel(2)}`;
  wireBack(el, `/progress?view=records&sport=${sport}`);
  await load(`/api/records/history?sport=${sport}&distance_m=${dist}`, (rows) => {
    const prs = rows.filter((r) => r.pr);
    const label = (rows[0] && rows[0].label) || '';
    el.innerHTML = `<div class="top">${backBtn('Records')}</div><div class="card"><h1>${esc(U.dist(+dist) + ' ' + U.du())} · ${SPORT_NAMES[sport]}</h1>
      <p class="muted">${rows.length} efforts · ${prs.length} times you set a new PR</p><div id="h-chart"></div></div>
      <div class="card"><h2>PR progression</h2>${[...prs].reverse().map((r) => `<a class="row-link" href="/activity/${r.activity_id}"><div><b class="num">${dur(r.elapsed_s)}</b><br><small class="muted">${esc(r.name)}</small></div><small class="muted">${esc(fdate(r.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</small></a>`).join('')}</div>`;
    wireBack(el, `/progress?view=records&sport=${sport}`);
    const best = rows.reduce((b, r) => (!b || r.elapsed_s < b.elapsed_s ? r : b), null);
    requestAnimationFrame(() => dotChart($('#h-chart', el), rows.map((r) => ({x: new Date(r.start_time) / 864e5, y: r.elapsed_s, id: r.activity_id})), {yfmt: (v) => dur(v), invert: true, best: best && best.activity_id}));
  });
});
// ---------- date range for the Progress charts (2026-10-09): ?from=YYYY&to=YYYY, remembered on this phone ----------
function getRange(q) {
  if (q.has('from') || q.has('to')) return {from: +q.get('from') || null, to: +q.get('to') || null};
  try { const r = JSON.parse(localStorage.getItem('fit.range') || 'null'); if (r) return {from: r.from || null, to: r.to || null}; } catch (e) { /* no storage */ }
  return {from: null, to: null};
}
const inRange = (R, y) => (!R.from || y >= R.from) && (!R.to || y <= R.to);
function rangeBar(box, R, firstYear) {
  if (!box) return;
  const now = new Date().getFullYear(), first = Math.min(firstYear || now, now), years = [];
  for (let y = now; y >= first; y--) years.push(y);
  const presets = [['All', null, null], ['This year', now, now], ['Last 2 years', now - 1, now], ['Last 5 years', now - 4, now]].filter((p) => !p[1] || p[1] >= first || p[0] === 'This year');
  const set = (from, to) => {
    if (from && to && from > to) [from, to] = [to, from];
    try { localStorage.setItem('fit.range', JSON.stringify({from, to})); } catch (e) { /* no storage */ }
    const u = new URLSearchParams(location.search); u.delete('from'); u.delete('to');
    if (from) u.set('from', from); if (to) u.set('to', to);
    go(location.pathname + '?' + u.toString(), {replace: true});
  };
  // one compact button (2026-10-11 polish): the presets and From/To years live in a sheet instead of two rows of controls
  const opt = (sel, y) => `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`;
  const name = !R.from && !R.to ? 'All time' : R.from === R.to ? String(R.from) : `${R.from || 'Start'}–${R.to || 'now'}`;
  box.innerHTML = `<button type="button" class="range-btn" aria-label="Date range: ${esc(name)}. Change">${svg('calendar')}<span>${esc(name)}</span>${svg('down')}</button>`;
  $('.range-btn', box).onclick = () => sheet('Date range', `<div class="pick-list">${presets.map(([n, f, t]) => `<button type="button" class="row-link" data-f="${f || ''}" data-t="${t || ''}" aria-pressed="${(f || null) === R.from && (t || null) === R.to}"><span>${esc(n)}</span>${(f || null) === R.from && (t || null) === R.to ? `<span class="tick">${svg('check')}</span>` : ''}</button>`).join('')}</div>
    <h3 class="ghead">Or pick years</h3><div class="form"><div class="two"><label>From<select name="from"><option value="">Start</option>${[...years].reverse().map((y) => opt(R.from, y)).join('')}</select></label>
      <label>To<select name="to"><option value="">Now</option>${years.map((y) => opt(R.to, y)).join('')}</select></label></div>
      <button class="primary wide" type="button" id="rg-apply">Show these years</button></div>`, (sb, close) => {
    $$('[data-f]', sb).forEach((b) => b.onclick = () => { close(); set(+b.dataset.f || null, +b.dataset.t || null); });
    $('#rg-apply', sb).onclick = () => { const f = $('select[name=from]', sb), t = $('select[name=to]', sb); close(); set(+f.value || null, +t.value || null); };
  });
}

// ---------- Progress: mileage by week / month / year, by sport (2026-10-09) ----------
const VKEYS = [{k: 'run', name: 'Run'}, {k: 'ride', name: 'Ride'}, {k: 'walk', name: 'Walk & hike'}, {k: 'other', name: 'Other'}];
const toU = (m) => (imp() ? m / MI : m / 1000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monthSeries(firstYm, get) {   // every month from firstYm to this month: [{d, label, ...get(ym)}]
  const out = [], now = new Date(); let [y, m] = firstYm.split('-').map(Number);
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`, d = new Date(y, m - 1, 1);
    out.push({d, label: d.toLocaleDateString([], {month: 'long', year: 'numeric'}), ...get(ym)});
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
async function pMileage(body, q) {
  const sport = q.get('sport') || 'run', period = q.get('period') || 'week';
  const R = {from: null, to: null}, scoped = false;   // Totals: the period sets how far back (date ranges live on Year over year)
  body.innerHTML = `<div id="m-body">${skel(2)}</div>`;   // Weeks / Months / Years: the button in the row at the top
  await load(`/api/progress/volume?period=${period}`, (r) => {
    const box = $('#m-body', body); if (!box) return;
    const keys = sport === 'all' ? VKEYS : VKEYS.filter((k) => k.k === sport);
    const by = {}; for (const x of r.rows) { const o = by[x.p] = by[x.p] || {}; o[x.s] = x; }
    if (!r.rows.length) { box.innerHTML = `<div class="card empty"><b>No activities yet</b>Your mileage by week, month and year shows up here.${startCta()}</div>`; return; }
    // every period from the first activity to today
    const today = new Date(r.today + 'T12:00'), first = new Date(r.rows[0].p + 'T12:00'), all = [];
    const start = (d) => { const x = new Date(d); if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); else if (period === 'month') x.setDate(1); else { x.setMonth(0); x.setDate(1); } return x; };
    for (let d = start(first); d <= today; ) { all.push(new Date(d)); if (period === 'week') d.setDate(d.getDate() + 7); else if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1); }
    const val = (d, f = 'd') => { const o = by[ymd(d)] || {}; return keys.reduce((s, k) => s + Number((o[k.k] || {})[f] || 0), 0); };
    const label = (d) => period === 'week' ? 'Week of ' + d.toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'}) : period === 'month' ? d.toLocaleDateString([], {month: 'long', year: 'numeric'}) : String(d.getFullYear());
    const show = scoped ? all.filter((d) => inRange(R, d.getFullYear())) : period === 'week' ? all.slice(-26) : period === 'month' ? all.slice(-24) : all;
    if (!show.length) { box.innerHTML = '<div class="card empty"><b>Nothing in this range</b>Pick other years above.</div>'; return; }
    const cols = show.map((d, i) => {
      const prev = show[i - 1], tick = period === 'year' ? (show.length > 8 ? "'" + String(d.getFullYear()).slice(2) : String(d.getFullYear()))
        : period === 'month' ? (d.getMonth() % 3 === 0 ? d.toLocaleDateString([], {month: 'short'}) + (d.getMonth() === 0 ? " '" + String(d.getFullYear()).slice(2) : '') : '')
        : (!prev || prev.getMonth() !== d.getMonth()) && (period !== 'week' || i < show.length - 1) ? d.toLocaleDateString([], {month: 'short'}) : '';
      return {d, label: label(d), tick, partial: i === show.length - 1, segs: keys.map((k) => ({k: k.k, v: toU(Number(((by[ymd(d)] || {})[k.k] || {}).d || 0))}))};
    });
    const complete = all.slice(0, -1), recent = scoped ? show.filter((d) => d < all[all.length - 1]) : period === 'week' ? complete.slice(-52) : period === 'month' ? complete.slice(-12) : complete;
    const avg = recent.length ? recent.reduce((s, d) => s + toU(val(d)), 0) / recent.length : null;
    const pool = scoped ? show : all, best = pool.reduce((b, d) => (val(d) > val(b) ? d : b), pool[0]);
    const rangeName = scoped ? (R.from === R.to ? String(R.from) : `${R.from || 'start'}–${R.to || 'now'}`) : '';
    const word = {week: 'week', month: 'month', year: 'year'}[period], fmt = (v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${U.du()}`;
    const cur = all[all.length - 1], last = all[all.length - 2];
    box.innerHTML = `<div class="card"><div class="stats3">
        ${stat('This ' + word, toU(val(cur)).toFixed(1), U.du())}
        ${stat({week: 'Weekly avg', month: 'Monthly avg', year: 'Yearly avg'}[period], avg == null ? '–' : avg.toFixed(1), U.du())}
        ${stat('Best ' + word + (scoped ? ' (range)' : ''), toU(val(best)).toFixed(period === 'year' ? 0 : 1), U.du())}</div>
        <p class="small muted">${last ? `Last ${word}: ${esc(fmt(toU(val(last))))} · ` : ''}best ${esc(label(best).replace('Week of ', 'week of '))}</p>
        <div id="m-chart"></div>
</div>
      <details class="fold-row table-fold"><summary><span class="grow">Show as table</span><span class="chev">${svg('chev')}</span></summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${period === 'week' ? 'Week of' : period === 'month' ? 'Month' : 'Year'}</th><th class="r">${U.du()}</th><th class="r">Time</th><th class="r">#</th><th class="r">Climb</th></tr></thead><tbody>
        ${[...show].reverse().map((d) => `<tr><td>${esc(period === 'week' ? d.toLocaleDateString([], {month: 'short', day: 'numeric', year: '2-digit'}) : period === 'month' ? d.toLocaleDateString([], {month: 'short', year: 'numeric'}) : d.getFullYear())}</td>
          <td class="r num">${toU(val(d)).toFixed(1)}</td><td class="r num">${val(d, 't') ? dur(val(d, 't'), true) : '–'}</td><td class="r num">${val(d, 'n')}</td><td class="r num">${val(d, 'a') ? U.elev(val(d, 'a')) : '–'}</td></tr>`).join('')}</tbody></table></div></details>`;
    requestAnimationFrame(() => periodBars($('#m-chart', box), cols, {keys, fmt, yfmt: (v) => String(Math.round(v)), avg, avgLabel: period === 'year' ? 'Yearly average' + (scoped ? ` (${rangeName})` : '') : `Average ${period} (${scoped ? rangeName : 'last 12 months'})`, height: 190}));
  });
}

// ---------- Progress: growth over the years (2026-10-09) ----------
async function pTrends(body, q) {
  const sport = q.get('sport') || 'run', foot = sport !== 'ride';
  const R = getRange(q);
  body.innerHTML = `<div id="g-body">${skel(3)}</div>`;
  await load(`/api/progress/trends?sport=${sport}`, (r) => {
    const box = $('#g-body', body); if (!box) return;
    const noun = {run: 'runs', ride: 'rides', walk: 'walks'}[sport], one = noun.slice(0, -1);
    if (!r.months.length) { box.innerHTML = `<div class="card empty"><b>No ${noun} yet</b>Your pace and distance trends show up here.${startCta()}</div>`; return; }
    const today = new Date(r.today + 'T12:00'), M = {}; for (const m of r.months) M[m.m] = m;
    const N = (v) => Number(v || 0);
    const weeksIn = (y, m) => { const days = new Date(y, m, 0).getDate(); return (y === today.getFullYear() && m === today.getMonth() + 1 ? today.getDate() : days) / 7; };
    // derived numbers for a set of month rows + the weeks they cover
    const derive = (rows, weeks) => {
      const s = (k) => rows.reduce((a, x) => a + N(x[k]), 0), n = s('n'), pd = s('pd'), pt = s('pt'), hrt = s('hr_t'), cadt = s('cad_t');
      return {n, weeks, wk: weeks ? toU(s('d')) / weeks : null, perwk: weeks ? n / weeks : null, avgd: n ? toU(s('d')) / n : null,
        pace: pd ? pt / pd * 1000 : null, speed: pt ? pd / pt : null, hr: hrt ? s('hr_w') / hrt : null, cad: cadt ? s('cad_w') / cadt : null,
        longest: Math.max(0, ...rows.map((x) => N(x.longest))), climb: s('a'), pd, hrt};
    };
    const series = monthSeries(r.months[0].m, (ym) => { const [y, m] = ym.split('-').map(Number), row = M[ym]; return {ym, ...derive(row ? [row] : [], weeksIn(y, m))}; });
    // by year
    const years = {}; for (const p of series) { const y = p.d.getFullYear(); (years[y] = years[y] || []).push(p); }
    rangeBar($('#p-rng'), R, +r.months[0].m.slice(0, 4));
    const yrows = Object.keys(years).filter((y) => inRange(R, +y)).sort().reverse().map((y) => ({y, ...derive(years[y].map((p) => M[p.ym]).filter(Boolean), years[y].reduce((a, p) => a + p.weeks, 0))}));
    const pace = (v) => (v ? U.pace(v) : '–'), spd = (v) => (v ? U.speed(v) : '–');
    const cy = yrows[0], ly = yrows[1];
    const cmp = (m) => {   // change vs last year; colored only where better/worse is clear (pace, speed)
      if (!cy || !ly || cy[m.k] == null || ly[m.k] == null) return '';
      const diff = cy[m.k] - ly[m.k], txt = m.fmt(Math.abs(diff));
      if (!/[1-9]/.test(txt.replace(/^0:00/, ''))) return '<span class="delta">same</span>';
      const up = diff > 0, cls = m.better ? ((m.better === 'lower') !== up ? 'good' : 'bad') : '';
      return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${esc(txt)}</span>`;
    };
    const metrics = [
      {k: 'wk', t: 'Weekly average distance', fmt: (v) => `${v.toFixed(1)} ${U.du()}`, color: 'run'},
      foot ? {k: 'pace', t: 'Average pace', fmt: (v) => pace(v) + U.pu(), axis: pace, invert: true, w: 'pd', color: 's1', better: 'lower'} : {k: 'speed', t: 'Average speed', fmt: (v) => `${spd(v)} ${U.su()}`, axis: spd, w: 'pd', color: 's1', better: 'higher'},
      {k: 'hr', t: 'Average heart rate', fmt: (v) => `${Math.round(v)} bpm`, w: 'hrt', color: 's2'},
      {k: 'avgd', t: `Average ${one} distance`, fmt: (v) => `${v.toFixed(1)} ${U.du()}`, w: 'n', color: 's3'},
      {k: 'perwk', t: `${noun[0].toUpperCase() + noun.slice(1)} per week`, fmt: (v) => v.toFixed(1), color: 's4'},
      ...(sport === 'run' ? [{k: 'cad', t: 'Average cadence', fmt: (v) => `${Math.round(v)} spm`, w: 'n', color: 's5'}] : []),
    ];
    box.innerHTML = `<div class="card"><h2>By year</h2><div class="tblwrap"><table class="tbl yrs"><thead><tr><th>Year</th><th class="r">${U.du()}/wk</th><th class="r">${noun[0].toUpperCase() + noun.slice(1)}/wk</th><th class="r">${foot ? 'Pace' : 'Speed'}</th><th class="r">HR</th><th class="r">Avg ${U.du()}</th><th class="r">Longest</th></tr></thead><tbody>
        ${yrows.map((y) => `<tr${+y.y === today.getFullYear() ? ' class="cur"' : ''}><td>${y.y}${+y.y === today.getFullYear() ? '<small class="muted"> so far</small>' : ''}</td><td class="r num"><b>${y.wk == null ? '–' : y.wk.toFixed(1)}</b></td><td class="r num">${y.perwk == null ? '–' : y.perwk.toFixed(1)}</td>
          <td class="r num">${foot ? pace(y.pace) : spd(y.speed)}</td><td class="r num">${y.hr ? Math.round(y.hr) : '–'}</td><td class="r num">${y.avgd == null ? '–' : y.avgd.toFixed(1)}</td><td class="r num">${y.longest ? toU(y.longest).toFixed(1) : '–'}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">${foot ? 'Pace' : 'Speed'} = total moving time ÷ total distance. Heart rate is weighted by time, from ${noun} that recorded it.</p></div>
      ${metrics.map((m) => `<div class="card"><h2>${esc(m.t)}</h2>
        ${cy && cy[m.k] != null ? `<p class="small"><b class="num">${esc(m.fmt(cy[m.k]))}</b> in ${cy.y}${+cy.y === today.getFullYear() ? ' so far' : ''}${ly && ly[m.k] != null ? ` · ${esc(m.fmt(ly[m.k]))} in ${ly.y} ${cmp(m)}` : ''}</p>` : ''}
        <div id="g-${m.k}"></div></div>`).join('')}`;
    requestAnimationFrame(() => {
      for (const m of metrics) trendLine($(`#g-${m.k}`, box), series.map((p) => ({d: p.d, label: p.label, y: m.k === 'wk' || m.k === 'perwk' ? p[m.k] : p.n ? p[m.k] : null, w: m.w ? p[m.w] : 1})), {fmt: m.fmt, yfmt: m.axis || ((v) => (Math.abs(v) >= 20 ? String(Math.round(v)) : v.toFixed(1))), color: m.color, invert: !!m.invert, keep: (p) => inRange(R, p.d.getFullYear())});
    });
  });
}
// The month at a glance (2026-10-11): what you did and how you ate, day by day. Each day shows its workout (the sport's
// icon, tinted) and a bar for food against that day's goal; the right column is each week's distance. Tap a day for it all.
const FOODST = {on: ['On target', 'within 10% of your goal'], over: ['Over', 'more than 10% over'], under: ['Under', 'more than 10% under'],
  partial: ['Partly logged', 'under half a usual day'], today: ['Today', 'so far'], logged: ['Logged', 'no goal set']};
async function pCalendar(body, q) {
  const now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, month = q.get('month') || cur;
  const [y, m] = month.split('-').map(Number), first = new Date(y, m - 1, 1);
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  await load(`/api/calendar/month?month=${month}`, (M) => {
    const S = M.summary, wk = (w) => (w.distance_m ? U.dist(w.distance_m, 1) : w.moving_s ? `${Math.round(w.moving_s / 60)}m` : '');
    const cell = (x) => {
      const a = x.acts[0], f = x.food, dn = new Date(x.d + 'T12:00').getDate();
      const label = [new Date(x.d + 'T12:00').toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'}),
        x.acts.length ? x.acts.map((z) => z.name).join(', ') : 'no workout', f ? `${r0(f.kcal)} kcal${f.status ? ', ' + FOODST[f.status][0].toLowerCase() : ''}` : 'no food logged'].join(': ');
      return `<button type="button" class="cd${x.in_month ? '' : ' out'}${x.today ? ' today' : ''}${a ? ' has s-' + esc(a.sport) : ''}" data-d="${esc(x.d)}" aria-label="${esc(label)}">
        <span class="cd-n">${dn}</span><span class="cd-i">${a ? svg(a.sport) + (x.acts.length > 1 ? '<i>+</i>' : '') : ''}</span>
        <span class="cd-f ${f && f.status ? esc(f.status) : ''}"></span></button>`;
    };
    let grid = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="cd-h">${d}</div>`).join('') + `<div class="cd-h">${esc(U.du())}</div>`;
    for (let i = 0; i < M.days.length; i += 7) grid += M.days.slice(i, i + 7).map(cell).join('') + `<div class="cd-w num">${esc(wk(M.weeks[i / 7]))}</div>`;
    body.innerHTML = `<div class="card cal2"><div class="cal-nav"><button class="icon-btn" id="c-prev" aria-label="Previous month">${svg('back')}</button>
        <h2>${esc(first.toLocaleDateString([], {month: 'long', year: 'numeric'}))}</h2><button class="icon-btn" id="c-next" aria-label="Next month"${month >= cur ? ' disabled' : ''}>${svg('chev')}</button></div>
      <div class="stats3">${stat('Trained', `${S.trained}`, `of ${S.days} days`)}${stat('On target', S.judged ? `${S.on_target}` : '–', S.judged ? `of ${S.judged}` : '')}${stat('Weigh-ins', S.weighed)}</div>
      <div class="cal-grid">${grid}</div>
      <div class="legend cal-legend"><span><span class="lg-i">${svg('run')}</span>Workout</span>${['on', 'over', 'under', 'partial'].map((k) => `<span><span class="cd-f ${k}"></span>${FOODST[k][0]}</span>`).join('')}</div></div>
      <p class="small muted cal-help">Each day shows your workout and a bar for what you ate against that day's goal. Tap a day for the details.${month < cur ? ` <a href="/progress/calendar">Back to this month</a>` : ''}</p>`;
    $('#c-prev', body).onclick = () => go(`/progress/calendar?month=${shift(-1)}`, {replace: true});
    $('#c-next', body).onclick = () => go(`/progress/calendar?month=${shift(1)}`, {replace: true});
    $$('.cd', body).forEach((b) => b.onclick = () => calDay(M.days.find((x) => x.d === b.dataset.d), M));
  });
}
function calDay(x, M) {
  const f = x.food, title = new Date(x.d + 'T12:00').toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'});
  sheet(title, `<h3 class="ghead">Training</h3>${x.acts.length ? `<div class="card list">${x.acts.map((a) => `<a class="row-link" href="/activity/${a.id}" data-close>${sportMark(a.sport)}
      <span class="grow"><b>${esc(a.name)}</b><small class="muted">${a.distance_m ? `${esc(U.dist(a.distance_m))} ${esc(U.du())} · ` : ''}${esc(dur(a.moving_s))}</small></span><span class="chev">${svg('chev')}</span></a>`).join('')}</div>`
      : '<p class="small muted">Rest day: no workout.</p>'}
    <h3 class="ghead">Food</h3>${f ? `<div class="card cal-food"><div class="kv"><span>Eaten</span><b class="num">${r0(f.kcal)} kcal${f.goal ? ` <span class="muted">of ${r0(f.goal)}</span>` : ''}</b></div>
      <div class="kv"><span>Protein</span><b class="num">${r0(f.protein_g)} g${M.protein_target ? ` <span class="muted">of ${r0(M.protein_target)}</span>` : ''}</b></div>
      ${f.status ? `<div class="kv"><span>How it went</span><b><span class="cd-f ${esc(f.status)}"></span> ${esc(FOODST[f.status][0])} <span class="muted small">${esc(FOODST[f.status][1])}</span></b></div>` : ''}</div>`
      : '<p class="small muted">Nothing logged.</p>'}
    ${x.weight_kg ? `<h3 class="ghead">Weigh-in</h3><p class="num"><b>${esc(U.weight(x.weight_kg))} ${imp() ? 'lb' : 'kg'}</b></p>` : ''}
    <a class="ghost wide" href="/food?d=${esc(x.d)}" data-close>${svg('food')}Open this day's food log</a>`, (b, close) => {
    $$('[data-close]', b).forEach((l) => l.addEventListener('click', () => close()));
  });
}
async function pRoutes(body) {
  await load('/api/routes', (rows) => {
    body.innerHTML = rows.length ? `<div class="card">${rows.map((r) => `<a class="row-link" href="/route/${r.id}" data-prefetch="/api/routes/${r.id}">
      <div class="hd act">${r.g ? miniRoute(polyFromGeo(r.g), r.sport === 'foot' ? 'walk' : r.sport) : ''}</div>
      <div class="grow"><b>${esc(r.name)}</b><br><small class="muted">${r.count} times · best ${dur(r.best_s)} · last ${esc(fdate(r.last, {month: 'short', day: 'numeric'}))}</small></div><span class="chev">${svg('chev')}</span></a>`).join('')}</div>
      <p class="small muted">Routes are matched automatically when you repeat the same start, finish, direction and distance.</p>`
      : '<div class="card empty"><b>No matched routes yet</b>Do the same route twice and it appears here with your trend.</div>';
  });
}
function polyFromGeo(g) {   // GeoJSON -> encoded polyline (re-use miniRoute)
  try { const c = JSON.parse(g).coordinates; let s = '', pl = 0, po = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
    for (const [lo, la] of c) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); s += enc(a - pl) + enc(b - po); pl = a; po = b; } return s; } catch (e) { return ''; }
}
async function pHeatmap(body, q) {
  const sport = q.get('sport') || '';
  body.innerHTML = '<div class="map tall" id="h-map"></div>';
  const lines = await api(`/api/heatmap${sport ? '?sport=' + sport : ''}`);
  if (!lines.length) { $('#h-map', body).outerHTML = `<div class="card empty"><b>Nothing to map yet</b>Every route you've done, on one map.${startCta()}</div>`; return; }
  await mapInto($('#h-map', body), lines, {heat: true});
}

// ---------- Me ----------
// Profile photo (2026-10-12, api_photos.py): shown with your name, so friends and people who find you see it
function profilePhotoSheet(done) {
  const me = App.me;
  sheet('Profile photo', `<div class="pp-sheet">${avatar(me, 'xl')}
    <p class="small muted">Shown with your name: to friends, and to people who find you on this Kinetta.</p>
    <input type="file" accept="image/*" hidden id="pp-file">
    <button type="button" class="primary wide" id="pp-pick">${svg('camera')}${me.photo ? 'Choose a new photo' : 'Choose a photo'}</button>
    ${me.photo ? '<button type="button" class="ghost wide" id="pp-rm">Remove photo</button>' : ''}</div>`, (b, close) => {
    const file = $('#pp-file', b), pick = $('#pp-pick', b), rm = $('#pp-rm', b);
    pick.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0]; if (!f) return;
      pick.disabled = true; pick.textContent = 'Saving…';
      try { const image = await shrinkPhoto(f, 1024); me.photo = (await api('/api/me/photo', json('PUT', {image}))).photo; close(); toast('Photo saved'); done(); }
      catch (x) { toast(x.message || "That photo couldn't be opened"); pick.disabled = false; pick.textContent = 'Choose a photo'; }
    };
    if (rm) rm.onclick = async () => {
      rm.disabled = true;
      try { await api('/api/me/photo', {method: 'DELETE'}); me.photo = null; close(); done(); }
      catch (x) { toast(x.message); rm.disabled = false; }
    };
  });
}
// Questions, problems and privacy requests (2026-10-16): the same address as the website and privacy policy.
const SUPPORT_EMAIL = 'KinettaApp@gmail.com';
route(/^\/me$/, 'me', async (el) => {
  const me = App.me;
  // Personal overview first; secondary account controls retain their existing sheets.
  const ch = `<span class="chev">${svg('chev')}</span>`;
  const row = (tag, attrs, ico, c, label, val = '') => `<${tag} class="row-link" ${attrs}><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}</span>${val ? `<span class="val">${val}</span>` : ''}${ch}</${tag}>`;
  el.innerHTML = `<div id="me-overview"></div>
    <div class="card list me-tools">${row('a', 'href="/food/setup"', 'food', 'c-green', `Nutrition goal<small class="muted">${me.kcal_target ? `${Math.round(me.kcal_target)} kcal · ${me.protein_target ? Math.round(me.protein_target) + ' g protein' : 'review'}` : 'Optional setup'}</small>`)}${row('a', 'href="/me/friends"', 'people', 'c-brand', 'Friends', me.friend_requests ? `${me.friend_requests} waiting` : '')}${row('a', 'href="/me/goals"', 'target', 'c-brand', 'Goals')}${row('a', 'href="/me/gear"', 'shoe', 'c-brand', 'Shoes & bikes')}${row('a', 'href="/me/explore"', 'help', 'c-brand', 'Explore Kinetta')}${row('a', `href="mailto:${SUPPORT_EMAIL}"`, 'mail', 'c-brand', 'Help & contact')}</div>
    <details class="me-settings"><summary>Profile & settings<span>${svg('chev')}</span></summary>
    <div class="card list">${row('a', 'href="/track/connections"', 'watch', 'c-brand', 'Connections')}${row('button', 'id="m-profile"', 'user', 'c-green', 'Edit profile')}${row('a', 'href="/notifications"', 'bell', 'c-orange', 'Notifications', me.notifications ? `<span class="badge alert">${me.notifications} new</span>` : '')}
      ${row('a', 'href="/me/sharing"', 'lock', 'c-green', 'Sharing', 'Who sees your activities')}
      </div>
    <div class="card list">${row('a', 'href="/plan"', 'calendar', 'c-orange', 'Training plan')}
      ${row('button', 'id="m-targets"', 'food', 'c-green', 'Nutrition targets')}
      ${row('a', 'href="/food?view=weight"', 'scale', 'c-purple', 'Weight trend')}</div>
    <h2 class="sec-head">Settings</h2>
    <div class="card list"><div class="row-link static"><span class="ri c-grey">${svg('ruler')}</span><span class="grow">Units</span><div class="seg" role="group" aria-label="Units">
        <button data-u="imperial" aria-pressed="${me.units === 'imperial'}">mi · lb</button><button data-u="metric" aria-pressed="${me.units === 'metric'}">km · kg</button></div></div>
      ${row('a', 'href="/me/notifications"', 'bell', 'c-grey', 'Notification settings')}
      ${row('button', 'id="m-body"', 'heart', 'c-red', 'Body & heart rate', esc([me.max_hr ? `Max HR ${me.max_hr}` : '', me.weight_kg ? `${Math.round(U.weight(me.weight_kg))} ${imp() ? 'lb' : 'kg'}` : ''].filter(Boolean).join(' · ') || 'Set up'))}</div>
    <h2 class="sec-head">Account</h2>
    <div class="card list">${row('button', 'id="m-name"', 'user', 'c-grey', 'Name', esc(me.name))}
      ${row('button', 'id="m-login"', 'user', 'c-grey', 'Username', esc(me.login))}
      ${row('button', 'id="m-pw"', 'key', 'c-grey', 'Password', 'Change')}
      </div>
    ${me.coach ? `<h2 class="sec-head">Kit & food AI</h2><div class="card" id="ai"><p class="small muted">Optional training notes and food estimates. AI consent is separate from access.</p>${me.ai_access ? `<p class="small muted">Food AI: ${me.ai_access.food?.entitled && me.ai_access.food?.available ? 'available' : 'not available'} · Coaching: ${me.ai_access.coach?.entitled && me.ai_access.coach?.available ? 'available' : 'not available'}. Manual tools stay available.</p>` : ''}<button class="linkbtn small" id="m-ai-info">What gets shared?</button>${me.coach_tools && aiCan('coach') ? `<a class="icon-btn kit-help" href="/me/kit" aria-label="Ask Kit">${svg('sparkle')}</a>` : ''}
      <div class="seg wide" role="group" aria-label="AI features"><button data-ai="1" aria-pressed="${!!me.ai_ok}">On</button><button data-ai="0" aria-pressed="${!me.ai_ok}">Off</button></div></div>` : ''}
    <h2 class="sec-head">Your data</h2>
    <div class="card list">${row('a', 'id="m-export" href="/api/account/export" download', 'download', 'c-blue', 'Download my data', 'Zip file')}
      ${row('a', 'href="https://kinetta.app/privacy" target="_blank" rel="noopener"', 'shield', 'c-green', 'Privacy policy')}
      ${row('button', 'id="m-del"', 'trash', 'c-red', '<span class="danger">Delete my account</span>')}</div>
    <button class="ghost wide" id="logout">${svg('logout')}Log out</button></details>`;
  meOverview($('#me-overview', el)).catch((e) => showError($('#me-overview', el), e));
  $('#m-profile', el).onclick = () => go(profileHref(me));   // your public profile, editable in place (social.js)

  const aiInfo = $('#m-ai-info', el); if (aiInfo) aiInfo.onclick = () => sheet('Kit & food AI', aiExplain());
  $('#m-targets', el).onclick = () => targetsSheet();
  $('#m-name', el).onclick = () => accountSheet('name');
  $('#m-login', el).onclick = () => accountSheet('login');
  $('#m-pw', el).onclick = () => passwordSheet();
  $('#m-export', el).onclick = async (e) => {
    if (!Native.on) { toast('Preparing your download - this can take a minute'); return; }
    e.preventDefault();        // the app can't save downloads: a one-time link opens in Safari, which saves it to Files
    try { const r = await api('/api/account/export-link', json('POST', {})); window.open(Native.base + r.path, '_blank'); toast('Opening Safari to download your data'); }
    catch (x) { toast(x.message); }
  };
  $('#m-del', el).onclick = () => deleteSheet();
  $$('[data-ai]', el).forEach((b) => b.onclick = async () => {
    const on = b.dataset.ai === '1'; if (on === !!me.ai_ok) return;
    if (on) { aiSheet(() => render()); return; }
    try { await api('/api/profile', json('PUT', {ai_ok: on})); me.ai_ok = on; keep('/api/me', me); invalidate('/api/coach'); render(); toast(on ? 'AI features on' : 'AI features off - nothing is sent'); }
    catch (x) { toast(x.message); }
  });
  $$('.seg button[data-u]', el).forEach((b) => b.onclick = async () => {
    const prev = me.units; me.units = b.dataset.u; render();
    try { await api('/api/profile', json('PUT', {units: me.units})); } catch (x) { me.units = prev; render(); toast('Could not save: ' + x.message); }
  });
  $('#m-body', el).onclick = () => bodySheet();
  if (new URLSearchParams(location.search).get('setup') === 'body') {
    history.replaceState(null, '', '/me'); $('.me-settings', el).open = true; bodySheet();
  }
  $('#logout', el).onclick = async () => {
    const n = Q.mine().length;
    if (n && !confirm(`${n} item${n > 1 ? 's' : ''} saved offline haven't been sent yet and will be lost. Log out anyway?`)) return;
    try { await Native.stopFoodEntry?.(); await Native.stopFoodHealth?.(); } catch(x) { toast(x.message);return; }
    if (typeof Track !== 'undefined') await Track.pause();
    try { await api('/api/logout', json('POST', {})); } catch (x) { /* signed out locally anyway */ }
    await Native.forget();
    store.set('fit.queue', Q.all().filter((o) => o.who !== App.me.login)); forgetKept();
    App.me = null; App.cache.clear(); netbar(); history.replaceState(null, '', '/'); showLogin();
  };
});

// heart rate, body and time zone (zones, effort, calorie needs) - a sheet, so the Me page stays a short list
function bodySheet() {
  const me = App.me;
  sheet('Body, heart rate & time zone', `<form class="form" id="m-form">
        <div class="two"><label>Max heart rate<input name="max_hr" inputmode="numeric" value="${esc(me.max_hr || '')}" placeholder="auto"></label>
        <label>Resting heart rate<input name="rest_hr" inputmode="numeric" value="${esc(me.rest_hr || '')}" placeholder="60"></label></div>
        <div class="two"><label>Sex (for calorie & effort estimates)<select name="sex"><option value="">—</option><option value="male"${me.sex === 'male' ? ' selected' : ''}>Male</option><option value="female"${me.sex === 'female' ? ' selected' : ''}>Female</option></select></label>
        <label>Birth year<input name="birth_year" inputmode="numeric" value="${esc(me.birth_year || '')}"></label></div>
        <div class="two"><label>Weight (${imp() ? 'lb' : 'kg'})<input name="weight" inputmode="decimal" value="${esc(U.weight(me.weight_kg))}"></label>
        <label>Height (${imp() ? 'ft in' : 'cm'})<input name="height" value="${esc(me.height_cm ? (imp() ? `${Math.floor(me.height_cm / 2.54 / 12)} ${Math.round(me.height_cm / 2.54 % 12)}` : Math.round(me.height_cm)) : '')}" placeholder="${imp() ? '5 10' : '178'}"></label></div>
        <label>Time zone<select name="tz">${tzOptions(me.tz)}</select></label>
        <label>Everyday activity (outside workouts)<select name="activity_factor">${[[1.2, 'Mostly sitting'], [1.3, 'Some walking & standing'], [1.45, 'On my feet a lot']].map(([f, n]) => `<option value="${f}"${Math.abs((me.activity_factor || 1.2) - f) < .01 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="small muted">Heart-rate zones and effort use these; sex, birth year, weight and height give your resting burn (BMR), and BMR × everyday activity = your daily calorie needs on Nutrition (workouts are added on the day). Leave max HR blank to use the highest your watch has recorded.</p>
        <div class="actions"><button class="primary wide">Save settings</button></div></form>`, (b, close) => {
    $('#m-form', b).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, n = (v) => (v.trim() === '' ? null : Number(v));
      const w = n(f.weight.value);
      const hv = f.height.value.trim(), hn = hv.match(/\d+(\.\d+)?/g) || [];   // "5 10", "5'10", "70" (in) or "178" (cm)
      const height_cm = !hn.length ? null : imp() ? (hn.length > 1 ? +hn[0] * 12 + +hn[1] : +hn[0] < 9 ? +hn[0] * 12 : +hn[0]) * 2.54 : +hn[0];
      const body = {max_hr: n(f.max_hr.value), rest_hr: n(f.rest_hr.value), sex: f.sex.value || null, birth_year: n(f.birth_year.value), weight_kg: w == null ? null : imp() ? w / 2.20462 : w, height_cm, activity_factor: +f.activity_factor.value, tz: f.tz.value || undefined};
      try { await api('/api/profile', json('PUT', body)); Object.assign(App.me, body); close(); toast('Settings saved'); render(); } catch (x) { toast(x.message); }
    };
  });
}

// time zones the phone knows (days, weeks and "today" follow yours); the current one stays listed even if unknown
function tzOptions(cur) {
  let list = []; try { list = Intl.supportedValuesOf('timeZone'); } catch (e) { /* older browser */ }
  if (cur && !list.includes(cur)) list = [cur, ...list];
  return list.map((z) => `<option value="${esc(z)}"${z === cur ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('');
}

// ---------- account (name, username, password) + people (admin) ----------
function accountSheet(field) {
  const me = App.me, isName = field === 'name';
  sheet(isName ? 'Your name' : 'Username', `<form class="form" id="ac">
    <label>${isName ? 'Name' : 'Username'}<input name="v" value="${esc(isName ? me.name : me.login)}" maxlength="${isName ? 60 : 30}"
      ${isName ? 'autocomplete="name"' : 'autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"'} enterkeyhint="done" required></label>
    <p class="small muted">${isName ? 'Shown at the top of your screens.' : 'What you type to log in. Lowercase letters, numbers or _.'}</p>
    <div class="actions"><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#ac', b); f.v.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try { const r = await api('/api/account', json('PUT', {[field]: f.v.value})); me[field] = r[field]; close(); render(); toast(isName ? 'Name saved' : 'Username changed - use it next time you log in'); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
// delete my own account and everything in it (2026-10-11); needs the password, can't be undone
function deleteSheet() {
  const account=readOwner(),login=App.me.login;
  sheet('Delete my account', `<form class="form" id="del">
    <input name="username" value="${esc(App.me.login)}" autocomplete="username" hidden>
    <p>This deletes your account and <b>everything</b> in it straight away: activities, routes, food log, weigh-ins, plans and the files you uploaded. It can't be undone.</p>
    <p class="small muted">Want a copy first? Use Download my data. Deleted information can remain in older backups until those copies are removed. See the privacy policy for retention details.</p>
    <label>Your password<input name="pw" type="password" autocomplete="current-password" required></label>
    <div class="actions"><button class="primary danger-btn">Delete everything</button></div></form>`, (b, close) => {
    const f = $('#del', b); f.pw.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try {
        if(account!==readOwner())return;
        if(Native.on){await Native.stopFoodEntry?.();await Native.disconnectHealth();}
        if(account!==readOwner())return;
        await api('/api/account/delete', json('POST', {password: f.pw.value}));
        await Native.stopFoodHealth?.({clear:true});
        if (typeof FoodThread !== 'undefined') { try { await FoodThread.eraseDevice(); } catch (e) { toast('Your account was deleted. Clear this app’s storage to remove its unsent food messages from this phone.'); } }
        if (typeof RecipeImport !== 'undefined') RecipeImport.eraseDevice();
        if (typeof Track !== 'undefined') Track.forgetDraft();
        close(); store.set('fit.queue', Q.all().filter((o) => o.who !== login)); forgetKept();
        try { await Native.forget(); } catch(e) { toast('Account deleted. Clear this app’s storage if old connection settings remain.'); }
        App.me = null; App.cache.clear(); netbar(); history.replaceState(null, '', '/'); showLogin('Your account and all your data were deleted.');
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
function passwordSheet() {
  sheet('Change password', `<form class="form" id="pw">
    <input name="username" value="${esc(App.me.login)}" autocomplete="username" hidden>
    <label>Current password<input name="cur" type="password" autocomplete="current-password" required></label>
    <label>New password<input name="n1" type="password" autocomplete="new-password" minlength="10" required></label>
    <label>New password again<input name="n2" type="password" autocomplete="new-password" minlength="10" required></label>
    <p class="small muted">At least 10 characters. Your other phones and browsers will be logged out.</p>
    <div class="actions"><button class="primary">Change password</button></div></form>`, (b, close) => {
    const f = $('#pw', b); f.cur.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.n1.value !== f.n2.value) { toast('The new passwords don\'t match'); f.n2.focus(); return; }
      const btn = $('button.primary', f); btn.disabled = true;
      try { await api('/api/account/password', json('POST', {current: f.cur.value, new: f.n1.value})); close(); toast('Password changed'); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
route(/^\/me\/people$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Administration moved</h1><p>Use the separate browser portal at /admin. Your personal settings stay here in Me.</p>`;
});
// admin: set a new password for someone (forgotten), or remove them and all their data (2026-10-10)
route(/^\/me\/import$/, 'track', async () => go('/track/import', {replace:true}));
route(/^\/track\/import$/, 'track', async (el) => {
  el.classList.add('activity-import');
  const owner=readOwner(),account=App.me?.id,valid=()=>el.isConnected&&owner===readOwner();
  const mapFor=new URLSearchParams(location.search).get('map_for'),mapId=/^[1-9]\d*$/.test(mapFor||'')?mapFor:null;
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Upload activities</h1><p class="muted">FIT, GPX or TCX files (also .gz), or your whole Strava export .zip. Duplicates are skipped automatically.</p>
    ${mapId?`<p class="small">Choose the original ZIP or FIT for your <a href="/activity/${esc(mapId)}">existing workout</a>. Matching recordings add missing details; other files are imported as separate activities.</p>`:''}
    <div class="card upload"><label class="drop" id="u-drop" for="u-file"><b>Choose files</b><br><span class="small">or drop them here</span></label>
      <input id="u-file" type="file" multiple accept=".fit,.gpx,.tcx,.gz,.zip" hidden>
      <div id="u-prog" hidden><div class="prog"><div class="bar" id="u-bar"></div></div><p class="small muted" id="u-text"></p></div></div>
    <div class="card"><h2>How to get your Strava history</h2><p class="small">Strava → Settings → My Account → <b>Download or Delete Your Account</b> → Request your archive. Strava emails a .zip; upload it here as is. For a very large archive (over a few GB) ask for it to be placed in the server inbox instead.</p></div>
    <div class="card"><h2>Recent imports</h2><div id="u-jobs">${skel(1)}</div></div>`;
  wireBack(el, '/track');
  const input = $('#u-file', el), drop = $('#u-drop', el);
  const send = (files) => {
    if (!valid()||!files.length) return;
    const fd = new FormData(); for (const f of files) fd.append('files', f, f.name);
    const xhr = new XMLHttpRequest(); xhr.open('POST', Native.base + '/api/import');
    for (const [k, v] of Object.entries(Native.headers())) xhr.setRequestHeader(k, v);
    if(account)xhr.setRequestHeader('X-Kinetta-Account',String(account));
    $('#u-prog', el).hidden = false;
    const total = [...files].reduce((s, f) => s + f.size, 0);
    xhr.upload.onprogress = (e) => { if(!valid())return;const p = e.lengthComputable ? e.loaded / e.total : 0; $('#u-bar', el).style.setProperty('--w', p); $('#u-text', el).textContent = `Uploading ${(e.loaded / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB…`; };
    xhr.onload = () => {
      if(!valid())return;
      if (xhr.status === 200) { $('#u-text', el).textContent = 'Uploaded. Processing below.'; invalidate('/api/'); poll(); }
      else { let m = 'Upload failed'; try { m = JSON.parse(xhr.responseText).detail || m; } catch (e) { /* */ } $('#u-text', el).textContent = m; }
    };
    xhr.onerror = () => { if(valid())$('#u-text', el).textContent = 'Upload failed. Check your connection and try again.'; };
    xhr.send(fd);
  };
  input.onchange = () => send(input.files);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); });
  let timer;
  const poll = async () => {
    clearTimeout(timer);
    if (!valid()) return;
    try {
      const jobs = await api('/api/imports');
      if(!valid())return;
      $('#u-jobs', el).innerHTML = jobs.length ? jobs.map((j) => `<div class="job"><b>${esc(j.label)}</b>
        <small>${j.status === 'running' || j.status === 'queued' ? `${j.status === 'queued' ? 'Waiting' : 'Processing'} ${j.done} of ${j.total || '?'}` : j.status === 'done' ? 'Finished' : 'Stopped'} · ${j.added} added · ${j.duplicates} duplicates${j.failed ? ` · ${j.failed} couldn't be read` : ''}</small>
        ${j.total ? `<div class="prog"><div class="bar" data-w="${(j.done / j.total).toFixed(3)}"></div></div>` : ''}
        ${j.messages.length ? `<details><summary class="small">Details</summary><ul class="small">${j.messages.slice(-20).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}</div>`).join('') : '<p class="muted">No imports yet.</p>';
      if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) { invalidate('/api/'); timer = setTimeout(poll, 2000); }
    } catch (e) { /* keep last view */ }
  };
  poll();
});

route(/^\/me\/connections$/, 'track', async () => go('/track/connections',{replace:true}));
route(/^\/track\/connections$/, 'track', async (el) => {
  el.classList.add('connections-page');
  const owner=readOwner(),valid=()=>el.isConnected&&readOwner()===owner;
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Connections</h1><p class="muted">Bring in workouts from Apple Health or files. A watch is optional.</p>
    <div class="card" id="c-health"><h2>Apple Health</h2>${skel(1)}</div>
    <a class="card tap row-link" href="/track/import"><div class="grow"><h2>Upload files</h2><p>FIT, GPX, TCX or ZIP · your original watch files or activity history.</p></div><span class="chev">${svg('chev')}</span></a>
    <details class="card" id="c-advanced"><summary>Advanced</summary><p class="small muted">For self-hosted installs and power users.</p><div id="c-body">${skel(2)}</div></details>`;
  wireBack(el, '/track');
  const healthCard=(isOn,st,error='')=>{if(!valid())return;$('#c-health',el).innerHTML=`<h2>Apple Health</h2>
    <p>${Native.on?isOn?'Sync enabled. Health shares only the categories you allow.':'Optional · share nutrition, read weight or import workouts.':'Available in the Kinetta iPhone app.'}</p>
    ${st?.at?`<p class="small muted">Last ${st.error?'attempt':'sync'} ${esc(when(st.at))}.</p>`:''}${error?`<p class="err">${esc(error)}</p>`:''}
    <a class="${Native.on?'primary':'ghost'} wide" href="/track/health">${Native.on?isOn?'Manage Apple Health':'Connect Apple Health':'About Apple Health'}</a>
    <details><summary>Using a Garmin?</summary><p class="small">Enable Apple Health sharing in Garmin Connect, then sync your watch there. Workouts can take a while to arrive. Garmin does not send the GPS map to Health; you can add the original file later.</p></details>`;};
  if(Native.on)Native.healthCall(Promise.all([Native.anyHealthOn?Native.anyHealthOn():Native.healthOn(),Native.healthStatus()]),'Health status could not be checked.',5000).then(([on,st])=>healthCard(on,st)).catch(()=>healthCard(false,null,'Health status could not be checked. Open Apple Health to review setup.'));
  else healthCard(false,null);
  let C;
  try{C=await api('/api/connections');}catch(e){if(valid())$('#c-body',el).innerHTML=`<p class="err">${esc(e.message)}</p>`;return;}
  if(!valid())return;
  const st = (k) => C[k] ? `<p class="small"><b>Connected.</b> ${esc(C[k].status || '')}${C[k].last_sync ? ' · ' + esc(when(C[k].last_sync)) : ''}</p>` : '<p class="small muted">Not connected.</p>';
  $('#c-body', el).innerHTML = `<div class="card"><h2>intervals.icu</h2>
      <p class="small">For an existing intervals.icu account, enter your athlete ID and API key (Settings → Developer settings). New activities are checked every 30 minutes.</p>${st('intervals')}
      <form class="form" id="c-icu"><div class="two"><label>Athlete ID<input name="athlete_id" placeholder="i123456" autocapitalize="none" value="${esc(C.intervals ? C.intervals.athlete_id : '')}"></label>
      <label>API key<input name="api_key" type="password" autocomplete="off" placeholder="${C.intervals ? 'saved (paste to change)' : ''}"></label></div>
      <div class="actions">${C.intervals ? '<button type="button" class="ghost" id="c-icu-sync">Sync now</button><button type="button" class="ghost danger" data-off="intervals">Disconnect</button><span class="spacer"></span>' : ''}<button class="ghost">${C.intervals ? 'Update' : 'Connect'}</button></div></form></div>
    <div class="card"><h2>Health Auto Export</h2>
      <p class="small">In the iPhone app <b>Health Auto Export</b> (Premium), add an automation: <b>REST API</b>, format <b>JSON</b>, data <b>Workouts</b> (and optionally <b>Body Mass</b>), with the address and header below.</p>${st('apple')}
      <div id="c-apple-out"></div><div class="actions">${C.apple ? '<button class="ghost danger" data-off="apple">Disconnect</button><span class="spacer"></span>' : ''}<button class="ghost" id="c-apple">${C.apple ? 'Make a new secret' : 'Create my upload link'}</button></div></div>`;
  $('#c-icu', el).onsubmit = async (e) => {
    e.preventDefault(); if(!valid())return;const f = e.target; if (!f.api_key.value.trim()) { toast('Paste your API key'); return; }
    try { await api('/api/connections/intervals', json('POST', {athlete_id: f.athlete_id.value.trim(), api_key: f.api_key.value.trim()})); toast('Connected. First sync running'); render(); } catch (x) { toast(x.message); }
  };
  const sy = $('#c-icu-sync', el); if (sy) sy.onclick = async () => { if(!valid())return;try { await api('/api/connections/intervals/sync', json('POST', {})); toast('Sync started'); } catch (x) { toast(x.message); } };
  $('#c-apple', el).onclick = async () => {
    if(!valid())return;
    if (C.apple && !confirm('Make a new secret? The old one stops working.')) return;
    try {
      const r = await api('/api/connections/apple', json('POST', {}));
      if(!valid())return;
      $('#c-apple-out', el).innerHTML = `<div class="callout"><div><p class="small">Copy these into Health Auto Export now. The secret is shown only once.</p>
        <p class="small"><b>URL</b><br><code>${esc((Native.base || location.origin) + r.url)}</code></p><p class="small"><b>Header</b> Authorization<br><b>Value</b> <code>Bearer ${esc(r.token)}</code></p></div></div>`;
    } catch (x) { toast(x.message); }
  };
  $$('[data-off]', el).forEach((b) => b.onclick = async () => { if(!valid())return;if (!confirm('Disconnect? Activities already imported stay.')) return; try { await api(`/api/connections/${b.dataset.off}`, {method: 'DELETE'}); render(); } catch (x) { toast(x.message); } });
});

route(/^\/me\/gear$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}<button class="ghost" id="g-add">Add</button></div><h1>Shoes & bikes</h1><div id="g-list">${skel(2)}</div>`;
  wireBack(el, '/me');
  const remove = async (g, button, close) => {
    if (!confirm(`Delete ${g.name}? Your activities stay; only their link to this gear is removed.`)) return;
    button.disabled = true;
    try { await api(`/api/gear/${g.id}`, {method: 'DELETE'}); invalidate('/api/'); if (close) close(); toast('Gear deleted. Activities kept.'); render(); }
    catch (x) { toast(x.message); button.disabled = false; }
  };
  const edit = (g) => sheet(g ? 'Edit gear' : 'Add gear', `<form class="form">
      <div class="two"><label>Type<select name="kind">${['shoe', 'bike', 'other'].map((k) => `<option value="${k}"${g && g.kind === k ? ' selected' : ''}>${k === 'shoe' ? 'Shoes' : k === 'bike' ? 'Bike' : 'Other'}</option>`).join('')}</select></label>
      <label>Name<input name="name" required maxlength="120" value="${esc(g ? g.name : '')}"></label></div>
      <div class="two"><label>Brand<input name="brand" value="${esc(g && g.brand || '')}"></label><label>Model<input name="model" value="${esc(g && g.model || '')}"></label></div>
      <div class="two"><label>Replace at (${U.du()})<input name="alert" inputmode="decimal" value="${g && g.alert_distance_m ? U.dist(g.alert_distance_m, 0) : ''}" placeholder="e.g. 400"></label>
      <label>Already used (${U.du()})<input name="start" inputmode="decimal" value="${g && g.start_distance_m ? U.dist(g.start_distance_m, 0) : ''}"></label></div>
      <label class="check"><input type="checkbox" name="is_default"${g && g.is_default ? ' checked' : ''}> Use for new activities of this type</label>
      <label class="check"><input type="checkbox" name="retired"${g && g.retired ? ' checked' : ''}> Retired</label>
      <div class="actions">${g ? '<button type="button" class="ghost danger" id="g-del">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('form', b), toM = (v) => (v.trim() ? Number(v) * (imp() ? MI : 1000) : null);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {kind: f.kind.value, name: f.name.value.trim(), brand: f.brand.value.trim() || null, model: f.model.value.trim() || null,
        alert_distance_m: toM(f.alert.value), start_distance_m: toM(f.start.value) || 0, is_default: f.is_default.checked, retired: f.retired.checked};
      try { await api(g ? `/api/gear/${g.id}` : '/api/gear', json(g ? 'PUT' : 'POST', body)); invalidate('/api/gear'); close(); render(); } catch (x) { toast(x.message); }
    };
    if (g) $('#g-del', b).onclick = (e) => remove(g, e.currentTarget, close);
  });
  $('#g-add', el).onclick = () => edit(null);
  await load('/api/gear', (gear) => {
    $('#g-list', el).innerHTML = gear.length ? `<div class="card">${gear.map((g) => {
      const due = g.alert_distance_m && g.total_m >= g.alert_distance_m;
      return `<div class="gear-row"><button class="row-link" data-id="${g.id}" aria-label="Edit ${esc(g.name)}"><div><b>${esc(g.name)}</b>${g.is_default ? ' <span class="badge">Default</span>' : ''}${g.retired ? ' <span class="badge">Retired</span>' : ''}<br>
        <small class="muted">${g.uses} activities${g.last_used ? ' · last ' + esc(fdate(g.last_used, {month: 'short', day: 'numeric'})) : ''}</small></div>
        <div class="r"><b class="num">${U.dist(g.total_m, 0)} ${U.du()}</b>${due ? '<br><small class="danger">Time to replace</small>' : g.alert_distance_m ? `<br><small class="muted">of ${U.dist(g.alert_distance_m, 0)}</small>` : ''}</div></button><button type="button" class="icon-btn danger" data-gear-delete="${g.id}" aria-label="Delete ${esc(g.name)}">${svg('trash')}</button></div>`; }).join('')}</div>`
      : '<div class="card empty"><b>No gear yet</b>Add shoes or a bike to track their mileage. Strava gear is imported with your export.</div>';
    $$('[data-id]', el).forEach((b) => b.onclick = () => edit(gear.find((g) => g.id === +b.dataset.id)));
    $$('[data-gear-delete]', el).forEach((b) => b.onclick = () => remove(gear.find((g) => g.id === +b.dataset.gearDelete), b));
  });
});

route(/^\/me\/goals$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}<button class="ghost sm" id="o-add">${svg('plus')}Add goal</button></div><h1>Goals</h1><div id="o-list">${skel(1)}</div>`;
  wireBack(el, '/me');
  $('#o-add', el).onclick = () => sheet('New goal', `<form class="form">
    <div class="two"><label>Sport<select name="sport"><option value="">All sports</option>${['run', 'ride', 'walk', 'hike', 'swim'].map((s) => `<option value="${s}">${SPORT_NAMES[s]}</option>`).join('')}</select></label>
    <label>Every<select name="period"><option value="day">Day</option><option value="week" selected>Week</option><option value="month">Month</option><option value="year">Year</option></select></label></div>
    <div class="two"><label>Measure<select name="metric"><option value="distance">Distance (${U.du()})</option><option value="time">Time (hours)</option><option value="calories">Calories burned (kcal)</option><option value="elevation">Climb (${U.eu()})</option><option value="count">Activities</option></select></label>
    <label>Target<input name="target" inputmode="decimal" required></label></div>
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Add goal</button></div></form>`, (b, close) => {
    const f = $('form', b);
    f.onsubmit = async (e) => {
      e.preventDefault(); const v = Number(f.target.value); if (!(v > 0)) { toast('Enter a target above 0'); return; }
      const target = f.metric.value === 'distance' ? v * (imp() ? MI : 1000) : f.metric.value === 'time' ? v * 3600 : f.metric.value === 'elevation' ? (imp() ? v / 3.28084 : v) : v;
      try { await api('/api/goals', json('POST', {sport: f.sport.value || null, period: f.period.value, metric: f.metric.value, target})); invalidate('/api/goals'); close(); render(); } catch (x) { toast(x.message); }
    };
  });
  await load('/api/goals', (g) => {
    $('#o-list', el).innerHTML = g.length ? `<div class="card">${g.map((x) => `${goalRow(x)}<button class="ghost danger small" data-del="${x.id}">Remove</button>`).join('')}</div>` : '<div class="card empty"><b>No goals yet</b>Set a target for distance, time or calories burned: each day, week, month or year.</div>';
    $$('[data-del]', el).forEach((b) => b.onclick = async () => {
      const row = g.find((x) => x.id === +b.dataset.del);
      try { await api(`/api/goals/${row.id}`, {method: 'DELETE'}); invalidate('/api/goals'); render();
        toast('Goal removed', async () => { await api('/api/goals', json('POST', {sport: row.sport, period: row.period, metric: row.metric, target: row.target})); invalidate('/api/goals'); render(); });
      } catch (x) { toast(x.message); }
    });
  });
});



// ---------- add an activity by hand (2026-10-09) ----------
// Compatibility for old recording links: all recording belongs in Track.
document.addEventListener('click', (e) => { const b = e.target.closest('[data-addact]'); if (b) { e.preventDefault(); go('/track'); } });
// What it was: a drop-down by group (2026-10-13, Ben: chips and typed durations were fiddly, and lifting needs its own choices).
// [sport, shown name, kind saved as sport_label]; the kind shows on the activity ("Yoga", "Treadmill")
const HAND_KINDS = [
  ['Cardio', [['run', 'Run'], ['run', 'Treadmill run', 'Treadmill'], ['ride', 'Ride'], ['ride', 'Indoor ride', 'Indoor Cycling'], ['walk', 'Walk'],
    ['hike', 'Hike'], ['swim', 'Swim'], ['row', 'Rowing machine', 'Indoor Rowing'], ['row', 'Row (on water)'], ['ski', 'Ski']]],
  ['Gym and classes', [['workout', 'Lifting', 'Strength Training'], ['workout', 'HIIT', 'HIIT'], ['ride', 'Spin class', 'Spin Class'],
    ['workout', 'Yoga', 'Yoga'], ['workout', 'Pilates', 'Pilates'], ['workout', 'Other workout']]],
  ['Other', [['other', 'A sport or game', 'Sport'], ['other', 'Something else']]],
];
const LIFT_KIND = '1.0';
function addActivitySheet(day, preset) {   // preset 'workout': a lifting session logged afterwards (lift.js)
  const now = new Date(), today = isoDay(now), d0 = day || today;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  const sel = (name, label, opts, extra = '') => `<label>${label}<span class="selbox"><select name="${name}"${extra}>${opts}</select>${svg('chev')}</span></label>`;
  // the last five weeks by name, then "Earlier…" for a calendar
  const days = Array.from({length: 35}, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return isoDay(d); });
  const dayName = (iso, i) => (i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Date(iso + 'T12:00').toLocaleDateString([], {weekday: i < 7 ? 'long' : 'short', month: 'short', day: 'numeric'}));
  const early = !days.includes(d0);
  // start time in quarter hours: now (rounded down) today, 8 AM on another day
  const q0 = d0 === today ? Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) * 15 : 480;
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const times = Array.from({length: 96}, (_, i) => opt(hm(i * 15), new Date(2000, 0, 1, 0, i * 15).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}), i * 15 === q0)).join('');
  const kinds = HAND_KINDS.map(([g, list], gi) => `<optgroup label="${esc(g)}">${list.map(([, n], i) => opt(`${gi}.${i}`, n, preset ? `${gi}.${i}` === LIFT_KIND : gi + i === 0)).join('')}</optgroup>`).join('');
  const nums = (to, pick, step = 1) => Array.from({length: Math.floor(to / step) + 1}, (_, i) => opt(i * step, String(i * step), i * step === pick)).join('');   // the label says the unit
  sheet('Add an activity', `<form class="form hand" id="ma">
    ${sel('kind', 'What did you do?', kinds)}
    <div id="ma-lift" hidden>${sel('copy', 'Exercises', opt('', 'Add them next', true))}<p class="small muted" id="ma-lift-hint">You'll put in each set on the next screen.</p></div>
    <div class="two">${sel('day', 'Day', days.map((d, i) => opt(d, dayName(d, i), d === d0)).join('') + opt('', 'Earlier…', early))}${sel('time', 'Start time', times)}</div>
    <label id="ma-cal"${early ? '' : ' hidden'}>Date<input type="date" name="date" value="${esc(early ? d0 : '')}" max="${today}"></label>
    <div class="dur">${sel('h', 'Hours', nums(12, 0))}${sel('m', 'Minutes', nums(59, 30))}<span class="dur-s">${sel('s', 'Seconds', nums(55, 0, 5))}</span></div>
    <label id="ma-dist">Distance (${U.du()}) <input name="dist" inputmode="decimal" placeholder="Optional"></label>
    <details class="more"><summary>More details <span class="muted">(name, calories, heart rate, notes)</span></summary><div class="form">
      <label>Name<input name="name" maxlength="200" placeholder="e.g. Spin class"></label>
      <div class="two"><label>Calories<input name="kcal" inputmode="numeric" placeholder="From your watch"></label><label>Avg heart rate<input name="hr" inputmode="numeric" placeholder="bpm"></label></div>
      <label>Notes<textarea name="desc" rows="2"></textarea></label>
      <p class="small muted">Leave calories blank and they're worked out from the time, distance and your weight.</p></div></details>
    <div class="actions"><button class="primary" id="ma-go">Save activity</button></div></form>`, (b, close) => {
    const f = $('#ma', b);
    const kind = () => { const [g, i] = f.kind.value.split('.').map(Number); return HAND_KINDS[g][1][i]; };
    let recent = null;
    async function loadRecent() {   // lifting: repeat a past session's exercises and sets
      if (recent) return;
      recent = [];
      try { const seen = new Set(); recent = (await api('/api/lifts/sessions?limit=30')).filter((s) => s.exercises && s.exercises.length && !s.lift_open && !seen.has(s.name) && seen.add(s.name)).slice(0, 8); }
      catch (e) { /* offline: they can still add exercises next */ }
      if (!f.isConnected || !recent.length) return;
      f.copy.innerHTML = opt('', 'Add them next', true) + `<optgroup label="Same as">${recent.map((s) => opt(s.id, `${s.name} · ${new Date(s.start_time).toLocaleDateString([], {month: 'short', day: 'numeric'})}`)).join('')}</optgroup>`;
    }
    const show = () => {
      const [sport, , label] = kind(), lift = label === 'Strength Training';
      $('#ma-lift', b).hidden = !lift;
      $('#ma-dist', b).hidden = sport === 'workout' || sport === 'other';
      $('.dur-s', b).hidden = !['run', 'walk', 'hike', 'swim', 'row', 'ride', 'ski'].includes(sport);   // seconds matter for a pace
      $('#ma-go', b).textContent = lift ? 'Next: the sets' : 'Save activity';
      f.name.placeholder = `e.g. ${kind()[1]}`;
      if (lift) loadRecent();
    };
    const hint = () => {
      const s = recent && recent.find((x) => String(x.id) === f.copy.value);
      $('#ma-lift-hint', b).textContent = s ? `${s.exercises.join(', ')}. The same sets come along, with that day's numbers beside each one.` : "You'll put in each set on the next screen.";
    };
    f.kind.onchange = show; f.copy.onchange = hint;
    f.day.onchange = () => { $('#ma-cal', b).hidden = !!f.day.value; if (!f.day.value) f.date.focus(); };
    show();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const secs = +f.h.value * 3600 + +f.m.value * 60 + ($('.dur-s', b).hidden ? 0 : +f.s.value);
      if (!(secs > 0)) { toast('How long was it? Pick the hours and minutes.'); f.m.focus(); return; }
      const date = f.day.value || f.date.value;
      if (!date) { toast('Pick the date'); f.date.focus(); return; }
      const [sport, name, label] = kind(), lift = label === 'Strength Training';
      const n = (x) => (x.value.trim() === '' ? null : parseFloat(x.value.replace(/,/g, '')));
      const dist = $('#ma-dist', b).hidden ? null : n(f.dist);
      const body = {sport, sport_label: label || null, name: f.name.value.trim() || null, start: `${date}T${f.time.value}`, duration_s: secs,
        distance_m: dist == null ? null : dist * (imp() ? MI : 1000), calories: n(f.kcal), avg_hr: n(f.hr), description: f.desc.value.trim() || null,
        copy_from: lift && f.copy.value ? +f.copy.value : null};
      const btn = $('#ma-go', b); btn.disabled = true;
      try { const r = await api('/api/activities/manual', json('POST', body)); invalidate('/api/'); close(); toast(lift ? 'Saved. Now the sets.' : 'Activity saved'); go(lift ? `/track/lift/${r.id}` : `/track?done=${r.id}`); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}

// A note box that stays out of the way until wanted (2026-10-16, Ben: the big boxes took over Edit activity): empty, it's
// a small "+ Add …" link; with text, or once tapped, a modest three-line box.
function optionalText(name, label, add, value) {
  const has = !!(value && value.trim());
  return `<label class="opt-text"${has ? '' : ' hidden'}>${label}<textarea name="${name}" rows="3" maxlength="10000">${esc(value || '')}</textarea></label>`
    + (has ? '' : `<button type="button" class="linkbtn opt-add" data-opt="${name}">${svg('plus')} ${add}</button>`);
}
function wireOptionalText(form) {
  $$('[data-opt]', form).forEach((b) => b.onclick = () => {
    const box = form.querySelector(`textarea[name="${b.dataset.opt}"]`); box.closest('label').hidden = false; b.remove(); box.focus();
  });
}

function activityKit(activity) {
  const account = App.me.login;
  sheet('Kit · ' + activity.name, '<div id="activity-kit"></div>', (root) => {
    const box = $('#activity-kit', root);
    const draw = () => {
      box.innerHTML = (activity.ai_note ? `<p>${esc(activity.ai_note)}</p>` : '<p>Ask for a note about this workout using your own training history.</p>')
        + (aiCan('coach') ? '<button class="primary wide" id="activity-kit-generate">'+(activity.ai_note ? 'Ask again' : 'Ask Kit')+'</button>' : '<p class="small muted">New reviews are unavailable. Saved notes remain readable.</p>');
      const button = $('#activity-kit-generate', box); if (!button) return;
      button.onclick = async () => {
        if (!App.me.ai_ok) { aiSheet(draw); return; }
        button.disabled = true; button.textContent = 'Reading this workout…';
        try {
          const result = await api(`/api/activities/${activity.id}/coach`, json('POST', {}));
          if (App.me?.login !== account || !box.isConnected) return;
          activity.ai_note = result.note; invalidate(`/api/activities/${activity.id}`); draw();
        } catch (e) { if (App.me?.login === account && box.isConnected) { draw(); aiError($('#activity-kit-generate', box), e.message); } }
      };
    }; draw();
  });
}
