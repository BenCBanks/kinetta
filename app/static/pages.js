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
  return first + (a.distance_m ? (r.label==='Time' ? (a.avg_hr?stat('Avg HR',Math.round(a.avg_hr),'bpm'):'') : stat(r.label,r.v,r.u)) : (a.effort ? stat('Effort', Math.round(a.effort)) : stat('Calories', a.calories ? Math.round(a.calories) : '–'))) + third;
}
// One card for every activity in a list (2026-10-11 redesign, Strava-style): who and when, the name, three numbers, the
// map edge to edge, then cheers and comments. `who` adds the person (the Feed); without it the sport leads (Mine, Today).
// The card is a link; the footer sits outside it so the Cheers button is a real button.
function postCard(a, {who = false, compact = false} = {}) {
  const theirs = !!a.owner, href = theirs ? `/activity/friends/${a.id}` : `/activity/${a.id}`;
  const kind = a.sport_label && a.sport_label.toLowerCase() !== SPORT_NAMES[a.sport].toLowerCase() ? a.sport_label : SPORT_NAMES[a.sport];
  const badges = [];
  if (a.prs) badges.push(`<span class="badge pr">${svg('trophy')} ${a.prs} PR${a.prs > 1 ? 's' : ''}</span>`);
  if (a.route_id && !compact) badges.push('<span class="badge">Matched route</span>');
  if (a.commute) badges.push('<span class="badge">Commute</span>');
  // Only the photo and the name open the person's profile (2026-10-16, Ben: the whole row did, so taps meant for the
  // activity landed on the profile); every other part of the card opens the activity (wireCheers → wireCardTaps).
  const person = theirs ? a.owner : App.me, pref = profileHref(person), pname = theirs ? esc(a.owner.name) : 'You';
  const vis = a.visibility || 'me',audience=theirs?'':compact&&vis==='me'?` · <span class="post-private" role="img" aria-label="Only you can see this" title="Only you can see this">${svg('lock')}</span>`:` · ${esc(VIS_SHORT[vis])}`;
  const time=compact&&isoDay(new Date(a.start_time))===isoDay(new Date())?ftime(a.start_time):when(a.start_time);
  const head = who ? `<a class="post-av" href="${pref}" aria-label="${theirs ? `${pname}’s profile` : 'Your profile'}">${avatar(person)}</a><span class="ph-txt"><a class="post-name" href="${pref}">${pname}</a><small>${esc(time)} · ${esc(kind)}${audience}${compact&&a.route_id?' · <span class="post-route">Matched route</span>':''}</small></span>${compact?'':sportMark(a.sport)}`
    : `${sportMark(a.sport)}<span class="ph-txt"><small>${esc(time)} · ${esc(kind)}${audience}</small></span>`;
  // the comment button opens the comments in a sheet from below, right here (2026-10-12); you can cheer your own activity too
  const foot = reactionButtons(a.id,a,false,compact)+`<button type="button" class="pf activity-comments" data-talk="${a.id}" aria-label="Comments, ${a.comments||0}">${svg('comment')}<span class="num">${a.comments||0}</span></button>`+
    (theirs?'':`<button type="button" class="pf activity-share" data-share-picture="${a.id}" aria-label="Share a picture of this activity">${svg('share')}</button>`);
  return `<article class="card post" data-href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}"><div class="post-hd post-profile">${head}</div><a class="post-link" href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}">
    <h3 class="post-title">${esc(a.name)}</h3>
    <div class="stats3">${theirs ? sharedHeadline(a) : headline(a)}</div>${!theirs && a.lifts && a.lifts.names ? `<p class="post-lifts">${esc(a.lifts.names.slice(0, 4).join(' · '))}${a.lifts.names.length > 4 ? ` +${a.lifts.names.length - 4}` : ''}</p>` : ''}${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    </a>${activityMedia(a,{compact})}
    <div class="post-ft">${foot}</div></article>`;
}
function sharedHeadline(a) {   // what a friend shares: no pace when they keep pace to themselves
  const st = [];
  if (a.distance_m) st.push(stat('Distance', U.dist(a.distance_m), U.du()));
  if (a.distance_m && a.moving_s && a.shares.pace) { const r = rate(a); if(r.label!=='Time')st.push(stat(r.label, r.v, r.u)); }
  st.push(stat('Time', dur(a.moving_s || a.elapsed_s)));
  if (st.length < 3 && a.ascent_m) st.push(stat('Elevation', U.elev(a.ascent_m), U.eu()));
  return st.slice(0, 3).join('');
}
// Cheers straight from a feed card: the count changes at once and goes back if the server says no. The comment
// button opens the comments sheet and keeps the card's count in step.
function wireCheers(box) {
  cleanViews();
  wireActivityMedia(box); wireCardTaps(box);
  $$('[data-talk]', box).forEach((b) => {SocialData.warm(b,b.dataset.talk);b.onclick = () => {
    commentsSheet(b.dataset.talk, null, (fresh) => {
      if (!b.isConnected) return;
      $('.num',b).textContent = fresh.comments.length;
      b.setAttribute('aria-label',`Comments, ${fresh.comments.length}`);
      const group=b.closest('.post-ft')?.querySelector('[data-reaction-group]');group?._sync?.(fresh);
    });
  };});
  $$('[data-reaction-group]',box).forEach(group=>wireReactionGroup(group,group.dataset.aid));
  $$('[data-share-picture]',box).forEach(button=>button.onclick=()=>sharePicture(button.dataset.sharePicture));
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
const backBtn = (label = 'Me') => `<button class="back" data-back>${svg('back')}${esc(label)}</button>`;
IC.settings = '<path d="m9 3-.6 2.3-2 .9-2.2-.6-1.5 2.6 1.6 1.7-.2 2.2-1.7 1.6 1.5 2.6 2.3-.6 1.8 1.3.5 2.3h3l.6-2.3 2-.9 2.2.6 1.5-2.6-1.6-1.7.2-2.2 1.7-1.6-1.5-2.6-2.3.6-1.8-1.3L12 3z"/><circle cx="10.5" cy="11" r="3"/>';
function wireBack(el, fallback) {
  el.classList.add('has-back');
  el._backFallback=fallback; // Keep the page's parent if a missing-record response replaces its header.
  const owner=readOwner(),destination=BackNavigation.destination(history.state,location.pathname+location.search,fallback,owner,{historyLength:history.length});
  $$('[data-back]',el).forEach(button=>{
    button.innerHTML=`${svg('back')}<span>${esc(destination.label)}</span>`;button.setAttribute('aria-label','Back to '+destination.label);
    button.onclick=()=>{if(!el.isConnected||owner!==readOwner())return;destination.history?history.back():go(destination.path,{replace:true});};
  });
}

// Shared profile chart: viewer-local dates, explicit units, zeros retained on the same scale.
function mileagePeriods(series) {
  const days = series.days || [];
  const today = series.today || days.find(r => r.today)?.d || days.at(-1)?.d || new Date().toISOString().slice(0, 10);
  // Work with civil dates in UTC so browser timezone and DST cannot move a Sunday boundary.
  const start = new Date(today + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const byDay = new Map(days.map(r => [r.d, r]));
  const week = Array.from({length:7}, (_, i) => {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + i); const d = date.toISOString().slice(0, 10);
    return {d, distance_m: d > today ? 0 : byDay.get(d)?.distance_m || 0, by_sport: d > today ? {} : byDay.get(d)?.by_sport, today: d === today, future: d > today};
  });
  return {days: week, weeks: Array.isArray(series.weeks) && series.weeks.length === 7 ? series.weeks : null};
}

const DISTANCE_SPORTS = ['run','ride','walk','hike','swim','row','ski','workout','other'];
function mileageSegments(row) {
  const total = +row.distance_m || 0;
  if (!total) return [];
  const parts = DISTANCE_SPORTS.map(sport => [sport, +(row.by_sport?.[sport] || 0)]).filter(([,value]) => value > 0);
  // Old cached/server responses retain their total without inventing a sport breakdown.
  return Math.abs(parts.reduce((n,[,v])=>n+v,0)-total) < .01 ? parts : [['total',total]];
}
const mileageSportName = sport => sport === 'total' ? 'Distance' : SPORT_NAMES[sport] || 'Other';
function mileageScale(rows) {
  const unit = U.du() === 'mi' ? 1609.344 : 1000;
  const raw = Math.max(0, ...rows.map(row => +row.distance_m || 0)) / unit;
  const largest = raw ? Math.max(.1,raw) : 0;
  const step = largest ? 10 ** Math.floor(Math.log10(largest)) / 2 : .5;
  const top = largest ? Math.ceil(largest / step) * step : 1;
  return {max:top * unit, top:parseFloat(top.toFixed(3)), middle:parseFloat((top / 2).toFixed(3))};
}
function mileageChart(box, series, period = 'days', {shared=false,progress=false}={}) {
  const periods = mileagePeriods(series), weekly = period === 'weeks' && !!periods.weeks;
  const rows = weekly ? periods.weeks : periods.days, scale = mileageScale(rows), max = scale.max;
  const total = rows.reduce((n, r) => n + (+r.distance_m || 0), 0);
  const dateLabel = (d) => fdate(d + 'T12:00', {month:'short',day:'numeric'});
  const range = `${dateLabel(rows[0].d)} – ${dateLabel(weekly ? rows.at(-1).end : rows.at(-1).d)}`;
  const labels = rows.map((r) => `${weekly ? `${dateLabel(r.d)} – ${dateLabel(r.end)}${r.today ? ' (so far)' : ''}` : fdate(r.d + 'T12:00', {weekday:'short',month:'short',day:'numeric'})} · ${r.future ? 'Not yet' : `${U.dist(r.distance_m || 0, 1)} ${U.du()}`}${r.by_sport && r.distance_m ? ' · '+mileageSegments(r).map(([sport,value])=>`${mileageSportName(sport)} ${U.dist(value,1)} ${U.du()}`).join(', ') : ''}`);
  box.innerHTML = `<div class="mileage-heading"><h2>${weekly ? 'Last 7 weeks' : 'This week'}</h2><div class="mileage-toggle" role="group" aria-label="Distance chart period"><button type="button" data-mileage-period="days" aria-pressed="${!weekly}">Days</button><button type="button" data-mileage-period="weeks" aria-pressed="${weekly}"${periods.weeks ? '' : ' disabled title="Weekly distance needs a server update"'}>Weeks</button></div></div><p class="mileage-total num"><b>${U.dist(total, 1)}</b> ${U.du()}</p>
    <div class="mileage-plot"><svg class="mileage-axis" viewBox="0 0 32 128" aria-hidden="true" focusable="false"><text x="28" y="5" text-anchor="end">${U.du()}</text><text x="28" y="18" text-anchor="end" dominant-baseline="middle">${scale.top}</text><text x="28" y="73" text-anchor="end" dominant-baseline="middle">${scale.middle}</text><text x="28" y="128" text-anchor="end" dominant-baseline="middle">0</text></svg><div class="mileage-bars seven-bars" data-scale-max="${max}" role="group" aria-label="${weekly ? 'Weekly distance, weeks start Sunday' : 'Daily distance, Sunday to Saturday'}; scale 0 to ${scale.top} ${U.du()}"><svg class="mileage-grid" viewBox="0 0 1 128" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0 18H1M0 73H1M0 128H1"/></svg>${rows.map((r, i) => {
      const date = new Date(r.d + 'T12:00');
      const total = +r.distance_m || 0, top = 128 - total / max * 110, value = U.dist(total, 1);
      // One solid total, on the same labelled scale; sport detail stays in the accessible readout.
      const label = r.future ? '–' : total > 0 && parseFloat(value) === 0 ? '<0.1' : value;
      return `<button type="button" class="mileage-day${r.today ? ' current-day' : ''}${r.future ? ' future-day' : ''}" aria-label="${esc(labels[i])}" aria-pressed="false"><svg class="mileage-column" viewBox="0 0 32 128" preserveAspectRatio="none" aria-hidden="true" focusable="false">${total ? `<path class="mileage-bar" d="${distanceBarPath(0,128,32,total / max * 110)}"/>` : '<rect class="mileage-empty" x="0" y="127" width="32" height="1"/>'}<text class="mileage-value" x="16" y="${top - 5}" text-anchor="middle">${esc(label)}</text></svg><small aria-hidden="true">${esc(weekly ? date.toLocaleDateString([], {month:'numeric',day:'numeric'}) : date.toLocaleDateString([], {weekday:'short'}))}</small></button>`;
    }).join('')}</div></div>
    ${series.streaks ? `<div class="achievement-row">${series.streaks.days>1?`<span class="achievement">${svg('flame')}${series.streaks.days}-day activity streak</span>`:''}${series.streaks.weeks>1?`<span class="achievement">${svg('trophy')}${series.streaks.weeks}-week activity streak</span>`:''}</div>` : ''}
    <p class="small muted mileage-range" role="status" aria-live="polite" aria-atomic="true">${esc(range)}</p>
    ${total ? '' : `<p class="small muted">No distance recorded ${weekly ? 'in these weeks' : 'this week'}. Timed activities still count.</p>`}${progress?'<a class="mileage-progress" href="/progress">View progress '+svg('chev')+'</a>':''}`;
  box.querySelectorAll('[data-mileage-period]').forEach(button => button.onclick = () => {
    if ((button.dataset.mileagePeriod === 'weeks') === weekly) return;
    const focus = button.dataset.mileagePeriod;
    mileageChart(box, series, focus,{shared,progress});
    box.querySelector(`[data-mileage-period="${focus}"]`).focus({preventScroll:true});
  });
  const buttons = [...box.querySelectorAll('.mileage-day')], readout = box.querySelector('.mileage-range');
  const current = rows.findIndex(row => row.today);
  wireDistanceBars(buttons, current < 0 ? rows.length - 1 : current, index => {
    readout.textContent = index == null ? range : labels[index];
  });
}

// A shared private reader keeps Me and both Progress halves consistent.
function combinedWeekHtml(w) {
  const stats=[];
  if(w.workouts)stats.push(stat('Workouts',w.workouts));
  if(w.distance_m>0)stats.push(stat('Distance',U.dist(w.distance_m),U.du()));
  if(w.seconds>0)stats.push(stat('Time',dur(w.seconds)));
  const food=w.days_logged?`${w.days_logged} of 7 days with food logged.`:'Your food consistency will appear as you log meals.';
  const protein=w.days_logged&&w.protein_target?`${w.protein_days_reached?`${w.protein_days_reached} ${w.protein_days_reached===1?'day':'days'} reached`:'No logged days reached'} your current ${r0(w.protein_target)} g protein target.${w.protein_days_unknown?` ${w.protein_days_unknown} logged ${w.protein_days_unknown===1?'day has':'days have'} unknown protein.`:''}`:'';
  return `<details class="card combined-week"><summary>Your week in review</summary><p class="small muted">${esc(dayLabel(w.start))} – ${esc(dayLabel(w.end))} · last 7 completed days</p>${stats.length?`<div class="stats3">${stats.join('')}</div>`:'<p>No workouts recorded in this week. Distance and time appear with your workouts.</p>'}<p>${food}</p>${protein?`<p>${protein}</p>`:''}${w.days_logged?'<p class="small muted">Food logged does not mean the whole day is complete. Protein compares known recorded amounts with your current target.</p>':''}<a class="linkbtn" href="${w.days_logged?'/food?view=overview':'/food/describe'}">${w.days_logged?'Food review':'Log food'}</a>${w.workouts?' <a class="linkbtn" href="/me/activities">Your workouts</a>':''}</details>`;
}
function combinedWeek(box) {
  if(!box)return;const owner=readOwner();
  load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;const w=data.week;
    box.innerHTML=combinedWeekHtml(w);
    if(new URLSearchParams(location.search).get('review')==='week')$('details',box).open=true;
  }).catch(()=>{if(box.isConnected&&owner===readOwner()){if(!box.innerHTML)box.innerHTML='<p class="small muted">Your week could not load.</p>';const b=document.createElement('button');b.className='linkbtn combined-week-retry';b.textContent='Retry weekly summary';b.onclick=()=>{b.remove();combinedWeek(box);};box.append(b);}});
}
function workoutEnergy(box,aid) {
  const owner=readOwner();load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;
    const t=data.today,a=t.items.find(x=>String(x.id)===String(aid));if(!a){box.innerHTML='';return;}
    box.innerHTML=`<a class="card tap workout-energy" href="${esc(t.food_href)}"><h2>Today’s energy</h2><p>${a.kcal<=0?'Calories are unavailable for this workout.':t.day_burn==null?`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Total burn is waiting for resting data.`:t.included_in_day_burn?`Today: +${r0(homeCalories(a.kcal))} kcal burned${a.estimated?' · estimate':''}.`:`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Your imported total burn takes priority, so these calories are not added again.`}</p>${a.kcal>0?`<p class="small muted">${a.estimated?'Estimated from recorded distance/time and weight.':a.source==='healthkit'?'Recorded calories from Apple Health.':a.source==='track'?'Calories from your phone recording.':'Calories from your workout record.'}</p>`:''}<span class="small more-link">See this workout in your food log ›</span></a>`;
  }).catch(()=>{if(box.isConnected&&owner===readOwner())box.innerHTML='<p class="small muted">Today’s energy is unavailable. <a href="/food">Open food log</a></p>';});
}
function workoutSyncStatus(box) {
  if(!Native.on||!box)return;const owner=readOwner();let version=0,wasSyncing=false;
  const valid=()=>box.isConnected&&owner===readOwner();
  const progress=()=>{
    if(!valid()){if(Native.onWorkoutStatus===progress)Native.onWorkoutStatus=null;return;}
    const text=$('[data-sync-progress]',box),summary=$('[data-sync-summary]',box),button=$('[data-sync-now]',box);
    if(text&&Native.syncing)text.textContent=Native.healthProgress||'Syncing…';
    if(summary&&Native.syncing)summary.textContent='Apple Health · syncing';
    if(button)button.disabled=!!Native.syncing;
    if(Native.syncing)wasSyncing=true;else if(wasSyncing){wasSyncing=false;draw().catch(()=>{});}
  };
  const draw=async()=>{
    const v=++version;const [enabled,status,bg]=await Promise.all([Native.healthOn(),Native.healthStatus(),Native.backgroundStatus()]);
    if(v!==version||!valid())return;
    if(!enabled){box.innerHTML='';return;}
    if(!$('.workout-sync',box))box.innerHTML='<details class="card workout-sync"><summary data-sync-summary></summary><p class="small muted" data-sync-last></p><p class="small muted" data-sync-progress></p><p data-sync-login></p><p data-sync-pending></p><p class="small muted">Garmin Connect can take an hour or more to send workouts to Health and does not send route maps.</p><button class="ghost" data-sync-now>Sync now</button> <a class="linkbtn" href="/track/health">Manage Apple Health</a></details>';
    const dates=[status?.last_success_at,bg?.lastSuccess].filter(Boolean).map(x=>new Date(x)).filter(x=>Number.isFinite(+x));const last=dates.sort((a,b)=>b-a)[0];
    $('[data-sync-summary]',box).textContent='Apple Health · '+(Native.syncing?'syncing':bg?.pending?`${bg.pending} pending`:status?.error||bg?.error?'needs attention':last?'last synced '+last.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'waiting for first sync');
    $('[data-sync-last]',box).textContent=last?'Last successful sync: '+last.toLocaleString():'';
    $('[data-sync-progress]',box).textContent=Native.syncing?Native.healthProgress:status?.error||bg?.error||'Only workouts already available in Apple Health can be imported.';
    $('[data-sync-login]',box).textContent=bg?.needsLogin?'Sign in again to resume background uploads.':'';
    $('[data-sync-pending]',box).textContent=bg?.pending?`${bg.pending} workouts waiting to upload.`:'';
    $('[data-sync-now]',box).onclick=async()=>{try{const result=await Native.syncHealth();if(!valid())return;if(result?.added||result?.updated){render();return;}}catch(e){if(valid())toast(e.message);}await draw();};
    progress();
  };
  Native.onWorkoutStatus=progress;draw().catch(()=>{});Native.autoSync({foreground:true});
}

// ---------- Today ----------
// First steps use food or activity history; the checklist is activity-first (#164). Health remains optional; the Home Screen
// tip appears only on an iPhone browser that isn't already the Home Screen app.
// the next step for someone with nothing here yet (2026-10-12): an empty page says what to do, with the button for it
const startCta = () => '';
function getStarted(healthConnected = false, hasHistory = false) {
  if(App.me?.setup_hidden)return '';
  const ch = `<span class="chev">${svg('chev')}</span>`;
  const step = (href, ico, c, label, sub) => `<a class="row-link" href="${href}"><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}<small class="muted gs-sub">${sub}</small></span>${ch}</a>`;
  const ios = /iPhone|iPad/.test(navigator.userAgent), home = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (hasHistory) return setupChecklist(healthConnected);
  const rows = [
    App.me?.mail_ready && !App.me.email && !pendingEmail() && !App.me.needs_email_confirm ? step('/me/settings?email=add', 'mail', 'c-brand', 'Add your email', 'So you can reset your password if you forget it') : '',
    !hasHistory && !App.me?.photo && !App.me?.bio ? step('/welcome', 'user', 'c-green', 'Set up your profile', 'A photo and a line about you, who sees your activities, and friends') : '',
    !Native.on && /iPhone|iPad|iPod/.test(navigator.userAgent) && App.me?.iphone_app ? `<a class="row-link" href="${esc(App.me.iphone_app)}" target="_blank" rel="noopener"><span class="ri c-brand">${svg('track')}</span><span class="grow">Get the Kinetta iPhone app<small class="muted gs-sub">Beta, through Apple’s TestFlight. Records with GPS and brings in Apple Health.</small></span><span class="chev">${svg('chev')}</span></a>` : '',
    !hasHistory ? step('/track/connections', 'watch', 'c-brand', 'Bring in workouts', 'Apple Health or Garmin · optional') : '',
    Native.on && hasHistory && !healthConnected ? step('/track/health', 'heart', 'c-brand', 'Connect Apple Health · optional', 'Bring in workouts and weight from Apple Health') : '',
    !hasHistory ? step('/track', 'track', 'c-green', 'Record an activity', 'A run, ride, walk or lifting session with your phone.') : '',
    !hasHistory ? step('/me/friends', 'me', 'c-brand', 'Find your friends', "See each other's runs and rides, and send cheers.") : '',
    ios && !home && !Native.on && !hasHistory ? `<div class="row-link"><span class="ri c-orange">${svg('today')}</span><span class="grow">Add Kinetta to your Home Screen<small class="muted gs-sub">In Safari, tap Share, then Add to Home Screen. It opens like an app.</small></span></div>` : '',
  ].filter(Boolean);
  return rows.length ? `<section class="setup-tips"><div class="setup-heading"><h2>${hasHistory?'Finish setup':'Get started'}</h2><button type="button" class="linkbtn" data-hide-setup>Hide tips</button></div><div class="card list">${rows.join('')}</div><p class="small muted">Optional. Restore in Settings.</p></section>` : '';
}
// After the first workouts, optional setup is one checklist: finished steps tick off instead of being asked again, and
// the whole list hides (restore in Settings). Apple Health shows done once connected (owner, 29 October 2026).
function setupChecklist(healthConnected) {
  const me = App.me || {}, ch = `<span class="chev">${svg('chev')}</span>`, skipped = new Set(me.setup_skipped || []);
  // [key, href, label, done, external]. Skip removes one step for good (owner, 30 October 2026: not everyone wants Apple
  // Health); Settings → Show setup tips brings skipped steps back.
  const items = [
    me.mail_ready && !me.needs_email_confirm ? ['email', '/me/settings?email=add', 'Add your email', !!me.email || !!pendingEmail()] : null,
    Native.on ? ['health', '/track/health', 'Connect Apple Health', healthConnected] : null,
    !Native.on && /iPhone|iPad|iPod/.test(navigator.userAgent) && me.iphone_app ? ['iphone', me.iphone_app, 'Get the iPhone app', false, true] : null,
    // The photo picker opens in place: the profile page no longer has its own camera badge (30 Oct 2026).
    ['photo', 'photo', 'Add a profile photo', !!me.photo],
    foodUser() ? ['nutrition', '/food/setup', 'Set a nutrition goal', !!me.kcal_target] : null,
    ['friends', '/me/friends', 'Find friends', (me.friend_count || 0) > 0],
  ].filter(i => i && (i[3] || !skipped.has(i[0])));
  const done = items.filter((i) => i[3]).length;
  if (done === items.length) return '';
  const skip = (key, label) => `<button type="button" class="setup-skip" data-setup-skip="${key}" aria-label="Skip ${esc(label)}">Skip</button>`;
  const row = ([key, href, label, ok, external]) => ok ? `<div class="row-link setup-done"><span class="setup-mark">${svg('check')}</span><span class="grow">${label}<span class="vh">, done</span></span></div>`
    : `<div class="setup-row">${href === 'photo' ? `<button type="button" class="row-link" data-setup-photo><span class="setup-mark todo"></span><span class="grow">${label}</span>${ch}</button>`
    : `<a class="row-link" href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}><span class="setup-mark todo"></span><span class="grow">${label}</span>${ch}</a>`}${skip(key, label)}</div>`;
  return `<section class="setup-tips setup-check" aria-label="Finish setting up"><div class="setup-heading"><div><h2>Finish setting up</h2><p class="small muted">${done} of ${items.length} done · skip any you don’t need</p></div><button type="button" class="ghost" data-hide-setup>Hide</button></div>
    <div class="card list"><progress max="${items.length}" value="${done}" aria-label="Setup progress">${done} of ${items.length}</progress>${items.map(row).join('')}</div></section>`;
}
// Private insights under the card (Ben, 30 Oct 2026): the distance chart lives on the card, so this space answers
// "how am I doing?" from your own records only. Each row appears only when there is enough history behind it.
function meInsights(box, s) {
  const owner = readOwner(), live = () => box.isConnected && owner === readOwner();
  const weeks = s.chart_weeks || [], now = weeks.at(-1), past = weeks.slice(0, -1).filter(w => w.distance_m > 0);
  const rows = [];
  if (now && past.length >= 3) {
    // Usual = the average full week among the previous six that had any distance.
    const usual = past.reduce((n, w) => n + w.distance_m, 0) / past.length, pct = Math.min(1, (now.distance_m || 0) / usual);
    rows.push(`<div class="me-insight"><div class="me-insight-top"><span>This week so far</span><b class="num">${esc(U.dist(now.distance_m || 0, 1))} <small>of your usual ${esc(U.dist(usual, 1))} ${esc(U.du())}</small></b></div>
      <div class="track" role="img" aria-label="${Math.round(pct * 100)}% of your usual week"><div class="bar" data-w="${pct.toFixed(3)}"></div></div><small class="muted">Usual is your average week over the last ${past.length} active weeks.</small></div>`);
  }
  const chips = [s.day_streak > 1 ? `<span class="achievement">${svg('flame')}${s.day_streak}-day streak</span>` : '', s.week_streak > 1 ? `<span class="achievement">${svg('trophy')}${s.week_streak}-week streak</span>` : ''].join('');
  box.innerHTML = `<section class="card me-insights"><h2>Your insights</h2><div data-insight-rows>${rows.join('')}</div><div data-insight-more></div>${chips ? `<div class="achievement-row">${chips}</div>` : ''}
    <a class="mileage-progress" href="/progress?view=training">View progress ${svg('chev')}</a></section>`;
  // Runners also get recent bests and a pace trend, read from the same records the Progress pages use.
  if (!(s.years || []).some(y => y.sport === 'run')) return;
  const more = $('[data-insight-more]', box), month = d => fdate(d, {month: 'short', day: 'numeric'}), parts = {};
  const paint = () => { if (live()) more.innerHTML = (parts.best || '') + (parts.pace || ''); };
  load('/api/records?sport=run', r => {
    const since = Date.now() - 30 * 864e5, best = (r.efforts || []).filter(e => e.top?.[0] && e.count > 1 && new Date(e.top[0].start_time) >= since).slice(-2);
    parts.best = best.map(e => `<a class="me-insight me-insight-link" href="/activity/${e.top[0].activity_id}"><span class="me-insight-ico">${svg('trophy')}</span><span class="grow"><b>New ${esc(e.label)} best · <span class="num">${esc(dur(e.top[0].elapsed_s))}</span></b><small class="muted">${esc(month(e.top[0].start_time))}</small></span>${svg('chev')}</a>`).join('');
    paint();
  }).catch(() => {});
  load('/api/progress/trends?sport=run', r => {
    // Last three months (this one included) against the three before; at least three runs on each side.
    const months = r.months || [], recent = months.slice(-3), before = months.slice(-6, -3);
    const pace = list => { const d = list.reduce((n, m) => n + (+m.pd || 0), 0), t = list.reduce((n, m) => n + (+m.pt || 0), 0); return d > 0 ? t / (d / 1000) : 0; };
    const runs = list => list.reduce((n, m) => n + m.n, 0), cur = new Date(r.today + 'T12:00').getMonth(), last = recent.at(-1)?.m;
    if (!last || +last.slice(5) - 1 !== cur || recent.length < 3 || before.length < 3 || runs(recent) < 3 || runs(before) < 3) return;
    const a = pace(recent), b = pace(before); if (!a || !b) return;
    const diff = Math.round((b - a) * (U.du() === 'mi' ? 1.609344 : 1)), same = Math.abs(diff) < 3;
    parts.pace = `<div class="me-insight"><div class="me-insight-top"><span>Run pace · last 3 months</span><b class="num">${esc(U.pace(a))} <small>${esc(U.pu())}</small></b></div><small class="muted">${same ? 'About the same as the 3 months before.' : `${Math.abs(diff)} s ${diff > 0 ? 'faster' : 'slower'} per ${U.du()} than the 3 months before.`}</small></div>`;
    paint();
  }).catch(() => {});
}
route(/^\/today$/, 'me', async () => go('/me', {replace: true}));
// A person's shared identity leads; the overview below it is private.
function arrangeHomeFood(el,loggedToday) {
  const food=$('#t-food',el),lead=$('#t-food-lead',el),agenda=$('.me-agenda',el);
  if(loggedToday)lead.append(food);else agenda.insertBefore(food,$('#t-checkin',el));
  lead.hidden=!loggedToday;
  delete el.closest('#page').dataset.homeFoodLoading;
}
async function meOverview(el) {
  // Keep cached cards stable while today’s food classification and active plan settle.
  const page = el.closest('#page'), waiting = new Set(['chart', 'history', 'plan', 'food', 'checkin']);
  page.dataset.homeLoading = '';page.dataset.homeFoodLoading = '';
  const ready = key => {
    waiting.delete(key);
    if (!waiting.size && el.isConnected) { delete page.dataset.homeLoading; $('#t-loading', el)?.remove(); }
  };
  const tracked = (key, promise) => promise.catch(error => {
    if (key === 'chart' && el.isConnected) $('#t-week', el).innerHTML = '<p class="small muted">Weekly activity could not load.</p>';
    throw error;
  }).finally(() => ready(key));
  const me=App.me;
  el.innerHTML=`${MeCard.header(me)}
    <div class="me-overview-title"><h2>Your dashboard</h2><div id="t-review"></div></div>
    <div id="t-required"></div><div id="t-start"></div><div id="t-setup"></div><div id="t-food-lead" hidden></div>
    <div id="t-plan"></div>
    <section id="t-week" aria-label="Your insights">${skel(1)}</section>
    <div id="t-loading" role="status"><span class="vh">Loading your overview</span>${skel(1)}</div>
    <div id="t-content"><section class="me-agenda" hidden><div id="t-food"></div><div id="t-checkin"></div></section>
    <div id="t-recap"></div><div id="t-combined-week"></div><div id="t-goals"></div><div id="t-form"></div></div>`;
  MeCard.mount(el,{reload:()=>render(),editOnLoad:new URLSearchParams(location.search).get('edit')==='profile'});
  const setup=$('#t-setup',el);
  if(me.needs_email_confirm)$('#t-required',el).innerHTML=`<a class="card tap row-link" href="/me/settings?email=add"><span class="ri c-brand">${svg('mail')}</span><span class="grow"><b>Confirm your email</b><small class="muted">Your profile stays hidden until you confirm it.</small></span>${svg('chev')}</a>`;
  if(typeof Recaps!=='undefined')Recaps.offer($('#t-recap',el));
  // Food leads when logged; the remaining private panels reveal together after their first reads.
  const agenda = () => { const box=$('.me-agenda',el),food=$('#t-food',el);if(box)box.hidden=!(['#t-checkin'].some(id=>$(id,el)?.innerHTML.trim())||(food.parentElement===box&&food.innerHTML.trim())); };
  tracked('plan', planCard($('#t-plan', el), {onReady: () => { agenda(); ready('plan'); }})).then(agenda).catch(() => {});
  let foodHistory=null,activityHistory=null,healthConnected=false;
  const drawSetup=()=>{
    if(!el.isConnected||foodHistory===null||activityHistory===null)return;
    const missing = ['weight_kg', 'height_cm', 'sex', 'birth_year'].filter((k) => !App.me[k]);
    // Nothing recorded yet (#232 G): Get started leads and the empty 0.0 mi chart stays hidden until there's history.
    const fresh = !(activityHistory || foodHistory);
    $('#t-week', el).hidden = fresh;
    $('#t-start', el).innerHTML = fresh ? getStarted(healthConnected, false) : '';
    setup.innerHTML = (fresh ? '' : getStarted(healthConnected, true)) +
      (!App.me.setup_hidden && missing.length && App.me.kcal_target ? `<a class="card tap setup-body" href="/me?setup=body"><span>${svg('heart')}</span><div><b>Make your estimates more personal</b><p>Add ${esc(missing.map((k) => ({weight_kg:'weight',height_cm:'height',sex:'sex',birth_year:'birth year'}[k])).join(', '))} for better calorie-needs and effort estimates.</p><small>Private body settings · optional, editable any time</small></div>${svg('chev')}</a>` : '');
    const photo=$('[data-setup-photo]',setup);if(photo)photo.onclick=()=>profilePhotoSheet(()=>{invalidate('/api/me');keep('/api/me',App.me);render();});
    $$('[data-setup-skip]',setup).forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;const owner=readOwner(),next=[...new Set([...(App.me.setup_skipped||[]),button.dataset.setupSkip])];button.disabled=true;
      try{await api('/api/profile',json('PUT',{setup_skipped:next}));if(owner!==readOwner())return;App.me.setup_skipped=next;invalidate('/api/me');keep('/api/me',App.me);if(el.isConnected)drawSetup();}
      catch(x){if(owner===readOwner()&&button.isConnected){toast(x.message);button.disabled=false;}}
    });
    new Set([...$$('[data-hide-setup]',el),...$$('[data-hide-setup]',setup)]).forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;const owner=readOwner();button.disabled=true;button.textContent='Hiding…';
      try{await api('/api/profile',json('PUT',{setup_hidden:true}));if(owner!==readOwner())return;App.me.setup_hidden=true;invalidate('/api/me');keep('/api/me',App.me);if(!el.isConnected)return;drawSetup();toast('Setup tips hidden. Restore them in Settings.');}
      catch(x){if(owner===readOwner()&&button.isConnected){toast(x.message);button.disabled=false;button.textContent=button.closest('.setup-check')?'Hide':'Hide tips';}}
    });
  };
  tracked('food', todayFoodCard($('#t-food',el),{onHistory:value=>{foodHistory=value;drawSetup();},onFoodUser:loggedToday=>{
    if(!el.isConnected)return;arrangeHomeFood(el,loggedToday);agenda(); ready('food');
    if(!loggedToday||!el.isConnected){ ready('checkin'); return; }
    tracked('checkin', weeklyCheckinCard($('#t-checkin',el),{home:true,onReady:()=>{agenda();ready('checkin');}})).then(agenda);
    combinedWeek($('#t-combined-week',el));
  }})).catch(() => {
    if (!el.isConnected) return;
    arrangeHomeFood(el,false);foodHistory=false;drawSetup();ready('checkin');
    // Only food users see a failure here; for anyone else the food card would have been empty anyway.
    if (!App.me.food_user && !App.me.kcal_target) return;
    $('#t-food',el).innerHTML = '<div class="card"><p>Today’s food could not load.</p><button class="ghost wide" id="tf-retry">Try again</button></div>';agenda();
    $('#tf-retry',el).onclick = () => { invalidate('/api/food/day'); render(); };
  });
  const kit=$('#t-review',el);
  if(kit&&kitChatOn())kit.innerHTML=`<a class="kit-pill" href="/me/kit?from=me">${svg('sparkle')}Ask Kit</a>`;
  else load('/api/coach/week', (r) => {
    const box = $('#t-review', el); if (!box) return;
    if (!r.enabled && !r.paused && !r.latest) { box.innerHTML = ''; return; }
    const wk = r.latest ? r.latest.period_start : null, when = wk ? new Date(wk + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'}) : '';
    async function reviewNow(btn, close) {
      btn.disabled = true; btn.textContent = 'Thinking…';
      try { const fresh = await api('/api/coach/week', json('POST', {})); showCoach('week:' + fresh.period_start); invalidate('/api/coach'); if (close) close(); render(); }
      catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Review this week now'; }
    }
    if(r.paused){box.innerHTML=r.latest?`<button type="button" class="kit-pill" id="t-saved-review">${svg('sparkle')}Kit review</button>`:'';const saved=$('#t-saved-review',box);if(saved)saved.onclick=()=>showCoach('week:'+r.latest.period_start);return;}
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
    tracked('history', load('/api/activities?limit=1', (d) => {
      if (!el.isConnected) return;
      activityHistory=!!d.length;drawSetup();ready('history');
      Promise.resolve(Native.on ? (Native.anyHealthOn?Native.anyHealthOn():Native.healthOn()) : false).catch(() => false).then((connected) => {
        if (!el.isConnected) return;
        healthConnected=connected;drawSetup();
      });
    })),
    tracked('chart', load('/api/stats', (s) => {
      if (!el.isConnected) return;
      meInsights($('#t-week', el), s);
      ready('chart');
    })),
    load('/api/fitness?days=60', (f) => {
      if (!el.isConnected) return;
      const last = f.days[f.days.length - 1];
      if (!last || !f.days.some(day => day.fitness > 0)) { $('#t-form', el).innerHTML = ''; return; }
      // the status word leads (like Garmin's training status); the numbers sit under it, the definitions on the Fitness page
      const form = last.form, [k, word, tip] = form > 5 ? ['good', 'Fresh', 'A good day for a hard effort'] : form < -15 ? ['warn', 'Tired', 'An easy day helps you absorb training'] : ['', 'Training steadily', 'Fitness is building'];
      // one compact row (2026-10-16): the status word and its numbers; the explanations live on the Fitness page
      const mini = (label, v) => `<span><b class="num">${esc(v)}</b><small>${esc(label)}</small></span>`;
      $('#t-form', el).innerHTML = `<a class="card tap me-form" href="/progress?view=fitness" aria-label="Fitness and freshness: ${esc(word)}. ${esc(tip)}. Open details">
        <span class="me-form-top"><span class="grow"><small>Fitness & freshness</small><b class="status-word ${k}">${esc(word)}</b></span>${svg('chev')}</span>
        <span class="me-form-nums">${mini('Fitness', Math.round(last.fitness))}${mini('Freshness', (form > 0 ? '+' : '') + Math.round(form))}${f.vdot_now ? mini('Run score', f.vdot_now) : ''}</span>
        ${f.ramp_7d > 8 ? '<span class="callout warn">Your training load jumped this week. Watch for niggles.</span>' : ''}</a>`;
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
  return `<div class="goal${pct >= 1 ? ' reached' : ''}"><div class="top2"><b>${esc(what)}</b><span class="num">${esc(goalFmt(g.metric, g.value))} / ${esc(goalFmt(g.metric, g.target))}</span></div>
    <div class="track"><div class="bar" data-w="${pct.toFixed(3)}"></div></div>${pct>=1?`<span class="achievement">${svg('trophy')}Goal reached</span>`:''}</div>`;
}
// apply data-w widths through CSS custom properties (no inline style attributes allowed)
new MutationObserver(() => { for (const b of $$('[data-w]')) { b.style.setProperty('--w', b.dataset.w); b.removeAttribute('data-w'); }
  for (const b of $$('[data-h]')) { b.style.setProperty('--h', b.dataset.h); b.removeAttribute('data-h'); } })
  .observe(document.documentElement, {childList: true, subtree: true});

// ---------- Activity feed ----------
// the bell (2026-10-12: on Today, Activity, Progress and Nutrition), with the unread count; it opens the list only
const bellBtn = () => { const n = (App.me && App.me.notifications) || 0;
  return `<a class="icon-btn bell" href="/notifications" aria-label="Notifications${n ? `, ${n} new` : ''}">${svg('bell')}<span class="bell-dot"${n ? '' : ' hidden'}>${n > 9 ? '9+' : n || ''}</span></a>`; };
const actTop = (search, friends) => `<div class="top"><h1>Activity</h1><div class="acts">${search ? `<button class="icon-btn" id="f-search" aria-label="Search">${svg('search')}</button>` : ''}
    ${friends ? `<a class="icon-btn" href="/me/friends" aria-label="Find friends">${svg('people')}</a>` : ''}
    ${bellBtn()}</div></div>`;
route(/^\/activity$/, 'activity', async el=>{
  const q=new URLSearchParams(location.search);
  if(q.get('view')==='mine'){q.delete('view');return go('/me/activities'+(q.toString()?'?'+q:''),{replace:true});}
  return homeFeed(el);
});
route(/^\/me\/activities$/, 'me', async (el)=>{
  const q=new URLSearchParams(location.search),sport=q.get('sport')||'',term=q.get('q')||'';
  const sports = ['', 'run', 'ride', 'walk', 'hike', 'swim', 'workout', 'row', 'ski', 'other'];
  el.innerHTML = `<div class="top">${backBtn('Me')}<button type="button" class="icon-btn" id="f-search" aria-label="Search activities">${svg('search')}</button></div><h1>Your activities</h1><p class="small muted">Your complete history, including private activities.</p><div id="workout-sync"></div>
    <form id="f-sform" class="${term ? '' : 'hidden'}" role="search"><input type="search" name="q" value="${esc(term)}" placeholder="Search names and descriptions" enterkeyhint="search"></form>
    <div class="chips activity-filters" role="group" aria-label="Sport">${sports.map((s) => `<button class="chip" data-s="${s}" aria-pressed="${s === sport}">${s === 'other' ? 'Other' : s ? SPORT_NAMES[s] : 'All'}</button>`).join('')}</div>
    <div class="feed-list" id="f-list">${skelFeed(3)}</div><button class="ghost feed-more" id="f-more" hidden>Show more</button>`;
  wireBack(el,'/me');workoutSyncStatus($('#workout-sync',el));
  const sf = $('#f-sform', el); if (!term) sf.hidden = true;
  $('#f-search', el).onclick = () => { sf.hidden = !sf.hidden; if (!sf.hidden) $('input', sf).focus(); };
  sf.onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(location.search); const v = $('input', sf).value.trim(); v ? p.set('q', v) : p.delete('q'); go('/me/activities' + (p.toString() ? '?' + p : ''), {replace: true}); };
  $$('.chip', el).forEach((b) => b.onclick = () => { const p = new URLSearchParams(location.search); b.dataset.s ? p.set('sport', b.dataset.s) : p.delete('sport'); go('/me/activities' + (p.toString() ? '?' + p : ''), {replace: true}); });
  const base = `/api/activities?limit=25${sport ? '&sport=' + sport : ''}${term ? '&q=' + encodeURIComponent(term) : ''}`;
  const list=$('#f-list',el),more=$('#f-more',el),owner=readOwner(),active=()=>owner===readOwner()&&list.isConnected;
  let items = [];
  const draw = (rows) => {
    items = rows;
    list.innerHTML = rows.length ? rows.map((x) => postCard(x)).join('') : `<div class="card empty"><b>${term || sport ? 'Nothing matches' : 'No activities yet'}</b>${term || sport ? 'Try another filter.' : `Workouts from your watch arrive here on their own.${startCta()}`}</div>`;
    more.hidden = rows.length < 25 || rows.length % 25 !== 0;
    feedMaps(list); wireCheers(list);
  };
  await load(base, draw);
  more.onclick = async () => {
    if(more.disabled||!items.length||!active())return;const epoch=readEpoch(base);
    more.disabled = true; more.textContent = 'Loading…';
    try {
      const rows = await api(base + '&before=' + encodeURIComponent(items[items.length - 1].start_time)+'&before_id='+items[items.length-1].id);
      if(!active()||epoch!==readEpoch(base))return;
      items = items.concat(rows); App.cache.set(base, {data: items, at: Date.now()});
      list.insertAdjacentHTML('beforeend', rows.map((x) => postCard(x)).join('')); more.hidden = rows.length < 25; feedMaps(list); wireCheers(list);
    } catch(e){if(active()&&epoch===readEpoch(base))toast(e.message);}
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
  if (a.speed_available!==false && (['ride', 'ski', 'row'].includes(a.sport) || a.max_speed)) add('Max speed', a.max_speed ? U.speed(a.max_speed) : null, U.su());
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
  // Shaped like the page that's coming (map, then the title card and numbers) so nothing appears to rearrange.
  el.innerHTML = `<div class="map-head"><div class="map lead sk" aria-hidden="true"></div><div class="top over">${backBtn('Activity')}</div></div>
    <div class="card d-ph" aria-hidden="true"><div class="sk line short"></div><div class="sk big"></div><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></div>${skel(1)}`;
  wireBack(el, '/activity');
  SocialData.prefetch(id);
  const milestoneOwner=readOwner(),milestoneOffers=Milestones.read({activity_id:id}).catch(()=>({items:[]}));let milestoneDraw=0;
  await load(`/api/activities/${id}`, (a) => {
    const stamp=++milestoneDraw;drawDetail(el,a);
    // An optional celebration must not delay the workout, chart or food-energy summary.
    milestoneOffers.then(data=>{if(el.isConnected&&readOwner()===milestoneOwner&&stamp===milestoneDraw)Milestones.paint($('#d-milestones',el),data,{params:{activity_id:id}});}).catch(()=>{});
    if(!a.owner&&isoDay(new Date(a.start_time))===isoDay(new Date())){const box=document.createElement('div');box.id='workout-food-energy';el.querySelector('[data-pane="overview"]').prepend(box);workoutEnergy(box,id);}
  }, {maxAge:60000});
});

// Sections (2026-10-12, Ben: "one huge long list"): the map, title and headline numbers stay on top; the rest is
// Charts lead; Details, Splits and Efforts retain the deeper information. ?tab= opens one. Cheers and
// comments are small icons by the title (comments open in a sheet; ?tab=comments opens it), sharing is in Edit, and
// the share button sends a link or a picture (2026-10-12).
const DTABS = [['charts', 'Charts'], ['splits', 'Splits'], ['efforts', 'Efforts'], ['overview', 'Details']];
// Shared activities draw only pace/speed, heart rate and elevation, so they check just those series.
const activitySamples = (a, series = ['speed','gap_speed','hr','alt','power','cad']) => {
  const c = a.chart;
  return !!(c && (c.t?.length >= 2 || c.d?.length >= 2) && series.some(k => c[k]?.filter(v => v != null && Number.isFinite(v)).length >= 2));
};
function activityTabs(panes) {
  const names = DTABS.filter(([key]) => panes[key]?.trim());
  return `<div class="seg wide dtabs" role="tablist" aria-label="Activity sections"${names.length < 2 ? ' hidden' : ''}>${names.map(([key,name]) => `<button type="button" role="tab" id="activity-tab-${key}" aria-controls="activity-pane-${key}" data-dt="${key}">${name}</button>`).join('')}</div>`
    + names.map(([key]) => `<section class="dpane" id="activity-pane-${key}" data-pane="${key}" role="tabpanel" aria-labelledby="activity-tab-${key}" hidden>${panes[key]}</section>`).join('');
}
function wireActivityTabs(el, onShow = () => {}) {
  const buttons = $$('[data-dt]', el), first = buttons[0]?.dataset.dt;
  const show = (key, remember = false) => {
    if (!buttons.some(b => b.dataset.dt === key)) key = first;
    buttons.forEach(b => { const active = b.dataset.dt === key; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
    $$('[data-pane]', el).forEach(p => p.hidden = p.dataset.pane !== key);
    onShow(key);
    if (remember) history.replaceState(history.state, '', location.pathname + (key === first ? '' : '?tab=' + key));
  };
  buttons.forEach((button,index) => {
    button.onclick = () => show(button.dataset.dt, true);
    button.onkeydown = event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next == null) return; event.preventDefault(); show(buttons[next].dataset.dt, true); buttons[next].focus();
    };
  });
  const requested = new URLSearchParams(location.search).get('tab');
  show(requested === 'comments' ? first : requested || first);
}

function drawDetail(el, a) {
  const r = rate(a);
  const hero = a.lifts && !a.distance_m ? headline(a) : (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', dur(a.moving_s || a.elapsed_s)) + (a.distance_m && r.label!=='Time' ? stat(r.label, r.v, r.u) : '');
  const ins = insights(a);
  const splits = imp() ? a.splits_mi : a.splits_km;
  const more = sportStats(a);
  const pane = {
    overview: `${a.power_curve && a.power_curve.length ? `<div class="card"><h2>Power curve</h2><table class="tbl">${a.power_curve.map(p => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r">${p.watts} W</td></tr>`).join('')}</table></div>` : ''}${a.has_intervals?'<section class="card" id="activity-interval-history"></section>':''}${liftCard(a)}${more ? `<div class="card"><h2>Details</h2><div class="hero more">${more}</div>
        ${a.gear_name ? `<p class="small muted">Gear: ${esc(a.gear_name)}</p>` : ''}</div>` : ''}
      ${a.private_note ? `<div class="card"><h2>Private note</h2><p class="small">${esc(a.private_note)}</p></div>` : ''}
      ${ins.length ? `<div class="card"><h2>Insights</h2>${ins.map(([k, t, d]) => `<div class="insight"><span class="dot ${k}"></span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join('')}</div>` : ''}
      ${a.route_id ? `<a class="card tap" href="/route/${a.route_id}" data-prefetch="/api/routes/${a.route_id}"><h2>${esc(a.route_name)}<span class="more">Compare ›</span></h2><p>Matched route · ${a.route_count} activities. See your trend on this route.</p></a>` : ''}
      ${a.line ? '<div id="d-segments"></div>' : ''}`,
    splits: `${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
      ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}`,
    charts: `${activitySamples(a) ? '<div class="card activity-chart-card"><div id="d-charts" class="activity-charts"></div></div>' : ''}
      ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
`,
    efforts: `${a.efforts && a.efforts.length ? `<div class="card"><h2>Best efforts</h2>${effortsTable(a)}</div>` : ''}
      ${a.similar && a.similar.length ? `<div class="card"><h2>Similar efforts</h2>${similarHtml(a)}</div>` : ''}`,
  };
  if (!pane.overview.trim()) pane.overview = '<div class="card empty">No additional details were recorded.</div>';
  const bars=ActivityDetail.header(a);el.classList.add('activity-detail');
  const recorded=[a.sport_label,a.device].filter(Boolean).map(esc).join(' · ');
  pane.overview=`${a.description?`<div class="card"><p class="desc">${esc(a.description)}</p></div>`:''}${recorded?`<p class="small muted">${recorded}</p>`:''}${pane.overview}<div class="card" id="d-photo-actions">${a.source==='healthkit'&&!a.line&&['run','ride','walk','hike'].includes(a.sport)?'<button class="linkbtn" type="button" id="d-add-map">Add the map</button>':''}<div class="detail-owner-tools"><div id="d-photos"></div><button type="button" class="linkbtn" id="d-comment-open">Comment</button></div></div>`;
  el.innerHTML=`${a.line?`<div class="detail-map-hero map-head">${activityMedia(a,{mapId:'d-map',detail:true,full:true,compact:true})}${bars.floating}</div>${bars.sticky}`:bars.floating}${ActivityDetail.title(a,hero)}${!a.line&&a.photos?.length?activityMedia(a,{mapId:'d-map',detail:true,compact:true}):''}${Object.keys(a.summary_overrides||{}).length?'<p class="small muted corrected-note">You edited these numbers. Records and splits are hidden until you restore the recorded values in Edit.</p>':''}${activityTabs(pane)}`;
  let drawCharts = null;
  wireActivityTabs(el, key => { if (key === 'charts' && drawCharts) { requestAnimationFrame(drawCharts); drawCharts = null; } });
  ActivityDetail.wire(el,a);
  const segBox = $('#d-segments', el); if (segBox) lazy(segBox, () => Segments.activityCard(segBox, a.id));   // segment times, routes and segments from this activity (#278)
  const addMap=$('#d-add-map',el);if(addMap&&Native.on)addMap.remove();if(addMap&&!Native.on)addMap.onclick=()=>sheet('Add the original map',`<p>Some apps send a workout summary to Apple Health without its GPS route. Your workout summary is already here.</p><p>For a Garmin recording:</p><ol><li>Open the matching activity on the Garmin Connect website.</li><li>Choose the settings gear, then <b>Export Original</b>.</li><li>Upload the downloaded ZIP or FIT file here.</li></ol><p class="small muted">Kinetta matches the sport, start time and distance. A matching file adds the map to this workout without making a second activity. Your edited title and numbers stay.</p><a class="primary wide" href="/track/import?map_for=${a.id}">Upload the original file</a>`,(body,close)=>{body.classList.add('activity-map-help');body.querySelector('a').onclick=()=>close();});
  if(a.has_intervals)globalThis.Intervals?.history($('#activity-interval-history',el),a.id);
  ownSocial(el, a);
  $('#d-comment-open',el).onclick=()=>commentsSheet(a.id,SocialData.peek(a.id),()=>{});
  photoStrip($('#d-photos', el), a, true, {controlsOnly: true, afterChange: () => render()});
  wireActivityMedia(el);
  if (a.lifts) fillLiftCard(el, a);
  const kb = $('#d-kit', el);
  if (kb) kb.onclick = () => kitChatOn() ? go(KitChat.href('activity',a.id)) : activityKit(a);
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
  if (a.line) wireMediaMapFull(mapBox, () => mapObj, a.track_lines?.length ? a.track_lines : [a.line], !!a.photos?.length);
  if (activitySamples(a)) {
    const c = a.chart, x = c.d && (c.d[c.d.length - 1] > 100 || !c.t) ? c.d : c.t, byDist = x === c.d;
    const rows = [];
    const sp = c.speed && FOOT.includes(a.sport) && a.sport !== 'swim';
    if (c.speed) rows.push(sp ? {name: 'Pace', short: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s5'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s5'), clip: true});
    if (c.gap_speed && sp) rows.push({name: 'Grade-adjusted pace', short: 'GAP', vals: c.gap_speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s2'), invert: true, clip: true, avg: a.gap_s_per_km});
    if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s1'), avg: a.avg_hr});
    if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
    if (c.power) rows.push({name: 'Power', vals: c.power, fmt: (v) => Math.round(v), unit: 'W', color: col('--s4'), clip: true, avg: a.avg_power});
    if (c.cad) rows.push({name: 'Cadence', short: 'Cad', vals: c.cad, fmt: (v) => Math.round(v), unit: a.sport === 'ride' ? 'rpm' : 'spm', color: col('--s3'), clip: true, avg: a.avg_cad});
    const box = $('#d-charts', el);
    const draw = () => { if (!box.isConnected) return; chartStack(box, x, rows, {
      xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v)),
      onIndex: (i) => {   // move a dot along the map with the crosshair
        if (!mapObj || !mapBox?.isConnected || !pts || !pts.length || !c.d) return;
        const frac = (c.d[i] - c.d[0]) / (c.d[c.d.length - 1] - c.d[0] || 1), p = pts[Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)))];
        if (!marker) marker = mapObj.L.circleMarker(p, {radius: 7, color: '#fff', weight: 2, fillColor: col('--s5'), fillOpacity: 1}).addTo(mapObj.map);
        else marker.setLatLng(p);
      }}); };
    let w = 0;
    drawCharts = () => { w = box.clientWidth; draw(); };
    if (!$('[data-pane="charts"]', el).hidden) { requestAnimationFrame(drawCharts); drawCharts = null; }
    const observer = new ResizeObserver(() => { if (box.isConnected && w && box.clientWidth && Math.abs(box.clientWidth - w) > 20) { w = box.clientWidth; draw(); } });
    observer.observe(box); viewResources.set(box, () => observer.disconnect());
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
  return `<div class="zones">${z.map((s, i) => `<div class="zone" data-zone="${i+1}" role="img" aria-label="Zone ${i+1}, ${ZN[i]}, ${dur(s,true)}, ${Math.round(s/tot*100)} percent"><span class="zone-name"><i aria-hidden="true"></i>Z${i + 1}</span><div><div class="zone-track"><div class="bar z${i + 1}" data-w="${(s / tot).toFixed(3)}"></div></div><small class="muted">${ZN[i]}</small></div><span class="num r">${dur(s, true)}<small class="muted">${Math.round(s/tot*100)}%</small></span></div>`).join('')}</div>`;
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
  // Redesigned 30 Oct 2026 (Ben): Cancel · Save stay pinned at the top; the most-used choices come first, the rarer
  // details are grouped, and Delete sits alone at the bottom, away from Save.
  let dirty = false;
  sheet('Edit activity', `<form class="form" id="e-form">
    <label>Title<input name="name" value="${esc(a.name)}" maxlength="200" enterkeyhint="done"></label>
    <label>What did you do?<span class="selbox"><select name="kind">${kindOpts}</select>${svg('chev')}</span></label>
    <div id="e-share" class="e-share"><p class="small muted">Loading sharing…</p></div>
    ${optionalText('description', 'Description', 'Add a description', a.description)}
    ${optionalText('private_note', 'Private note (only you)', 'Add a private note', a.private_note)}
    <h3 class="ghead e-details-head">Details</h3>
    <details id="e-summary" class="fold-row"><summary><span class="ri c-brand">${svg('edit')}</span><span class="grow"><b>Distance, time & heart rate</b><small>Fix numbers your watch got wrong</small></span><span class="chev">${svg('chev')}</span></summary><div class="form e-fields"><p class="small muted">Your edits stay when Apple Health syncs again. Leave a box empty if it wasn't recorded. Changing distance or time hides records and splits; tick “Use recorded” to undo an edit.</p>${correctionFields}</div></details>
    <label>Gear<span class="selbox"><select name="gear"><option value="">None</option></select>${svg('chev')}</span></label>
    <label class="check"><input type="checkbox" name="commute"${a.commute ? ' checked' : ''}> Commute</label>
    <button type="button" class="e-delete" id="e-del">Delete activity</button></form>`, async (body, close) => {
    const f = $('#e-form', body), btn = body.closest('.sheet').querySelector('button[form="e-form"]');
    // Any edit (typing, a choice, a sharing button) means closing asks first; opening the fold-outs doesn't count.
    const touched = () => { dirty = true; };
    f.addEventListener('input', touched); f.addEventListener('change', touched);
    f.addEventListener('click', (e) => { if (e.target.closest('.seg button, #sh-usual')) touched(); });
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
      if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
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
  }, {save: 'e-form', canClose: () => !dirty || confirm('Discard your changes?')});
}

// ---------- Share (2026-10-12): send a link to people on Kinetta, or a picture of the route and the key numbers ----------
Object.assign(IC, {share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M8 11H6v10h12V11h-2"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'});
// a gear for Settings (2026-10-24): the small icon beside the bell on Me
Object.assign(IC, {settings: '<path d="M18.85 9.79 L21.42 10.17 L21.42 13.83 L18.85 14.21 L18.41 15.28 L19.96 17.37 L17.37 19.96 L15.28 18.41 L14.21 18.85 L13.83 21.42 L10.17 21.42 L9.79 18.85 L8.72 18.41 L6.63 19.96 L4.04 17.37 L5.59 15.28 L5.15 14.21 L2.58 13.83 L2.58 10.17 L5.15 9.79 L5.59 8.72 L4.04 6.63 L6.63 4.04 L8.72 5.59 L9.79 5.15 L10.17 2.58 L13.83 2.58 L14.21 5.15 L15.28 5.59 L17.37 4.04 L19.96 6.63 L18.41 8.72Z"/><circle cx="12" cy="12" r="3"/>'});
const appBase = () => (Native.on && Native.base ? Native.base : location.origin);
// Share = a picture (2026-10-23, Ben: not a link). The route map with the time and pace, or the Kinetta mark when there
// is no GPS. Opens straight away; the full activity and the person's start/end setting load inside the sheet.
function shareOut(a) { sharePicture(a.id, a); }
// One picture for everything (Ben, 2026-10-24): a 4:5 image that works in Messages, Instagram posts and Stories alike,
// so nobody has to choose a size. Share opens the phone's own share sheet.
function sharePicture(id, known) {
  const owner = readOwner();
  sheet('Share', `<div class="pic-wrap busy"><img class="pic" id="pi-img" alt=""></div>
    <label class="check" id="pi-trim-row" hidden><input type="checkbox" id="pi-trim" checked> Hide where it starts and ends</label>
    <button class="primary wide" id="pi-go" disabled>${svg('share')} Share</button>
    <p class="small muted pi-note" role="status"></p>`, async (b, close) => {
    const img = $('#pi-img', b), t = $('#pi-trim', b), go = $('#pi-go', b), live = () => b.isConnected && owner === readOwner();
    let a = known && known.line !== undefined && known.start_time ? known : null, s = a && a._social, blob = null, made = 0, url = '', sending = false;
    const closeSelf = () => close(); App.closeActivityShare = closeSelf;
    viewResources.set(b, () => { if (App.closeActivityShare === closeSelf) delete App.closeActivityShare; made++; blob = null; if (url) URL.revokeObjectURL(url); url = ''; });
    try {
      [a, s] = await Promise.all([a || api(`/api/activities/${id}`), s || api(`/api/activities/${id}/social`).catch(() => null)]);
      if (known) known._social = s;
    } catch (x) { if (live()) { $('.pic-wrap', b).classList.remove('busy'); toast(x.message); } return; }
    if (!live()) return;
    img.alt = `Picture of ${a.name}`;
    const note = `A picture of your ${a.line ? 'route and ' : ''}workout numbers. Nothing links back to your account.`;
    $('.pi-note', b).textContent = note;
    const trim = (s && s.trim_m) || 400, hasLine = !!(a.line && decode(a.line).length > 1);
    $('#pi-trim-row', b).hidden = !hasLine;
    const buttons = () => { go.disabled = !blob || sending; t.disabled = sending; };
    // a slower, older drawing can never replace a newer one (the privacy choice may differ)
    const make = async () => {
      const run = ++made; blob = null; buttons(); $('.pic-wrap', b).classList.add('busy');
      try {
        const picture = await routePicture(a, t && !t.checked ? 0 : trim);
        if (run !== made || !live()) return;
        if (!picture) throw new Error('Couldn’t prepare this picture. Close Share and try again.');
        blob = picture; if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob); img.src = url;
        $('.pi-note', b).textContent = note;
      } catch (x) { if (run === made && live()) $('.pi-note', b).textContent = x.message; }
      finally { if (run === made && live()) { buttons(); $('.pic-wrap', b).classList.remove('busy'); } }
    };
    make(); t.onchange = make;
    go.onclick = async () => {
      if (!blob || sending || !live()) return;
      const picture = blob, run = made;
      const file = new File([picture], `${(a.name || 'activity').replace(/[^\w -]+/g, '').trim() || 'activity'}.png`, {type: 'image/png'});
      sending = true; buttons();
      try {
        if (Native.activityShareSupported) {
          // Only the already-previewed image crosses the native bridge, never account credentials or raw GPS.
          const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Couldn’t open this picture')); r.readAsDataURL(picture); });
          if (!live() || run !== made) return;
          await Native.shareActivityPicture(data, 'system');
        } else if (navigator.canShare && navigator.canShare({files: [file]})) {
          await navigator.share({files: [file]});      // called on the tap, before any other waiting, so browsers allow it
        } else {
          const link = document.createElement('a'); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
          toast('Picture saved');
        }
      } catch (x) { if (live() && x.name !== 'AbortError') toast(x.message || 'Couldn’t share this picture'); }
      finally { sending = false; if (live()) buttons(); }
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
async function mapPlace(g, pts, box) {      // draws the tiles; returns lat/lon -> canvas x/y. box.top/under: kept clear of the route
  const m = pts.map(([la, lo]) => mercator(la, lo));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of m) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fit = Math.min((box.w - 2 * box.pad) / Math.max((x1 - x0) * TILE, 1e-9), (box.h - 2 * box.pad - box.under - (box.top || 0)) / Math.max((y1 - y0) * TILE, 1e-9));
  const zf = Math.max(3, Math.min(18, Math.log2(fit))), z = Math.min(17, Math.floor(zf)), k = Math.min(2, 2 ** (zf - z)), n = TILE * 2 ** z;
  const cx = (x0 + x1) / 2 * n, cy = (y0 + y1) / 2 * n, mx = box.x + box.w / 2, my = box.y + (box.top || 0) + (box.h - box.under - (box.top || 0)) / 2;
  const tx0 = Math.floor((cx + (box.x - mx) / k) / TILE), tx1 = Math.floor((cx + (box.x + box.w - mx) / k) / TILE);
  const ty0 = Math.max(0, Math.floor((cy + (box.y - my) / k) / TILE)), ty1 = Math.min(2 ** z - 1, Math.floor((cy + (box.y + box.h - my) / k) / TILE));
  const count=await MapTiles.paint(g,pts,box,{z,k,n,cx,cy,mx,my,tx0,tx1,ty0,ty1,zf});
  return {tiles: count, P: ([la, lo]) => { const [x, y] = mercator(la, lo); return [(x * n - cx) * k + mx, (y * n - cy) * k + my]; }};
}
// The share picture uses the light Sky Blue tokens in either app appearance; routes are blue, like the map.
// Story: 1080 × 1920. Post: 1080 × 1350. Destinations share the exact previewed image.
const PIC = {bg: col('--share-surface'), route: col('--share-action'), text: col('--share-text'), soft: col('--share-text-secondary'), muted: col('--share-text-muted'), line: col('--share-divider'), brand: col('--share-brand'),
  sport: Object.fromEntries(['run','ride','walk','hike','swim','row','ski','workout','other'].map(sport => [sport, col('--share-' + sport)]))};
// The Kinetta mark (mark.svg): a track with a runner's dot in its gap, centred on (cx, cy), `w` wide.
function drawMark(g, cx, cy, w, color) {
  const s = w / 72, ox = cx - 50 * s, oy = cy - 50 * s, at = (x, y) => [ox + x * s, oy + y * s];
  g.save();
  g.beginPath(); g.rect(0, 0, g.canvas.width, g.canvas.height); g.arc(...at(76, 32.68), 12 * s, 0, Math.PI * 2); g.clip('evenodd');
  g.beginPath(); g.roundRect(...at(14, 30), 72 * s, 40 * s, 20 * s); g.lineWidth = 7 * s; g.strokeStyle = color; g.stroke();
  g.restore();
  g.beginPath(); g.arc(...at(76, 32.68), 8.5 * s, 0, Math.PI * 2); g.fillStyle = color; g.fill();
}
// The share picture (Ben, 2026-10-24): one 4:5 picture for texting, Instagram or anything else. The map fills it and the
// details sit on a frosted, see-through card near the bottom. Start and finish get the app's markers unless hidden.
async function routePicture(a, trim) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), ui = getComputedStyle(document.body).fontFamily, serif = '"Source Serif 4", Georgia, serif';
  try { await Promise.all([document.fonts.load(`600 64px ${serif}`), document.fonts.load(`800 80px ${ui}`)]); } catch (x) { /* system fonts are fine */ }
  const hue = PIC.route, M = 48, PAD = 44, SAFE_TOP = 40, SAFE_BOTTOM = M;
  // the numbers: time and pace (or speed) first, then distance; without distance, heart rate or calories
  const r = rate(a), cells = [];
  cells.push(['Time', dur(a.moving_s || a.elapsed_s), '']);
  if (a.distance_m && a.moving_s && r.label!=='Time') cells.push([r.label, r.v, r.u]);
  if (a.distance_m) cells.push(['Distance', U.dist(a.distance_m), U.du()]);
  if (cells.length < 3 && a.avg_hr) cells.push(['Avg heart rate', String(Math.round(a.avg_hr)), 'bpm']);
  if (cells.length < 3 && a.calories) cells.push(['Calories', String(Math.round(a.calories)), 'kcal']);
  // the title on one line, shortened with … when it doesn't fit beside the brand
  g.font = `700 46px ${ui}`;
  const room = W - 2 * M - 2 * PAD - 200, lines = [''], maxLines = 1;
  for (const w of (a.name || '').split(/\s+/)) {
    const t = (lines[lines.length - 1] + ' ' + w).trim();
    if (g.measureText(t).width <= room || !lines[lines.length - 1]) { lines[lines.length - 1] = t; continue; }
    if (lines.length === maxLines) { let l = lines[lines.length - 1]; while (l && g.measureText(l + '…').width > room) l = l.slice(0, -1); lines[lines.length - 1] = l.trimEnd() + '…'; break; }
    lines.push(w);
  }
  const CH = PAD + lines.length * 54 + 34 + 30 + 26 + 72 + PAD - 8, CY = H - SAFE_BOTTOM - CH, CX = M, CW = W - 2 * M;
  g.fillStyle = PIC.bg; g.fillRect(0, 0, W, H);
  const pts = a.line ? trimRoute(decode(a.line), trim) : [];
  let tiles = 0;
  if (pts.length > 1) {
    // the map fills the picture, a little muted so the blue route is what you see first
    g.filter = 'grayscale(.45) brightness(1.03) contrast(.95)';
    const {tiles: n, P} = await mapPlace(g, pts, {x: 0, y: 0, w: W, h: H, pad: 96, top: SAFE_TOP, under: H - CY - 24});
    g.filter = 'none'; tiles = n;
    if (tiles) { g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, W, H); }
    g.lineJoin = g.lineCap = 'round';
    const path = () => { g.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
    path(); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 26; g.stroke();
    path(); g.strokeStyle = hue; g.lineWidth = 13; g.stroke();
    if (!trim) {
      const loop = loopEnds(pts[0], pts[pts.length - 1]), [sx, sy] = P(pts[0]), [ex, ey] = P(pts[pts.length - 1]);
      drawEnd(g, loop ? sx - 27 : sx, sy, 'start', 26); drawEnd(g, loop ? ex + 27 : ex, ey, 'end', 26);
    }
  } else {
    // no GPS: the Kinetta mark takes the map's place, in blue
    const cy = SAFE_TOP + (CY - SAFE_TOP) / 2;
    g.beginPath(); g.arc(W / 2, cy, 250, 0, Math.PI * 2); g.fillStyle = col('--share-soft'); g.fill();
    drawMark(g, W / 2, cy, 360, hue);
  }
  if(tiles){
    const text=MapTiles.credit(await MapTiles.config());
    g.font=`600 20px ${ui}`;g.textAlign='right';g.textBaseline='alphabetic';
    const words=text.split(' '),lines=[];let line='';for(const word of words){if(g.measureText(line+' '+word).width>W-2*M&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);
    for(let i=0;i<lines.length;i++){const y=CY-14-(lines.length-1-i)*25;g.lineWidth=5;g.strokeStyle='rgba(255,255,255,.9)';g.strokeText(lines[i],W-M-8,y);g.fillStyle=PIC.muted;g.fillText(lines[i],W-M-8,y);}
  }
  // the card: the map behind it, blurred, under a light tint, so it reads as frosted glass rather than a white box
  const card = () => { g.beginPath(); g.roundRect(CX, CY, CW, CH, 40); };
  g.save(); g.shadowColor = 'rgba(15,23,42,.18)'; g.shadowBlur = 36; g.shadowOffsetY = 10; card(); g.fillStyle = 'rgba(255,255,255,.01)'; g.fill(); g.restore();
  const behind = document.createElement('canvas'); behind.width = W; behind.height = H; behind.getContext('2d').drawImage(c, 0, 0);
  g.save(); card(); g.clip(); g.filter = 'blur(18px) saturate(1.2)'; g.drawImage(behind, 0, 0); g.filter = 'none';
  g.fillStyle = tiles ? 'rgba(255,255,255,.58)' : 'rgba(255,255,255,.8)'; g.fillRect(CX, CY, CW, CH); g.restore();
  card(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  let y = CY + PAD + 40;
  g.font = `700 46px ${ui}`; g.fillStyle = PIC.text;
  lines.forEach((l, i) => g.fillText(l, CX + PAD, y + i * 54));
  // the brand, top right of the card
  g.font = `600 30px ${serif}`; const bw = g.measureText('Kinetta').width;
  g.fillStyle = PIC.text; g.fillText('Kinetta', CX + CW - PAD - bw, CY + PAD + 30);
  drawMark(g, CX + CW - PAD - bw - 28, CY + PAD + 20, 38, PIC.brand);
  y += (lines.length - 1) * 54 + 40;
  const kind = (a.sport_label || SPORT_NAMES[a.sport] || 'Activity').toUpperCase();
  g.font = `700 24px ${ui}`; g.fillStyle = hue; g.fillText(kind, CX + PAD, y);
  const kw = g.measureText(kind).width;
  g.font = `500 24px ${ui}`; g.fillStyle = PIC.muted;
  g.fillText(`  ·  ${fdate(a.start_time, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})}`, CX + PAD + kw, y);
  y += 30; g.strokeStyle = PIC.line; g.lineWidth = 2; g.beginPath(); g.moveTo(CX + PAD, y); g.lineTo(CX + CW - PAD, y); g.stroke();
  y += 50; const cw = (CW - 2 * PAD) / cells.length;
  cells.forEach(([lab, v, u], i) => {
    const x = CX + PAD + i * cw;
    g.font = `600 22px ${ui}`; g.fillStyle = PIC.muted; g.fillText(lab.toUpperCase(), x, y);
    let size = cells.length === 3 ? 64 : 76; g.font = `800 ${size}px ${ui}`;
    const fit = cw - 20 - (u ? 56 : 0); while (size > 40 && g.measureText(v).width > fit) { size -= 4; g.font = `800 ${size}px ${ui}`; }
    g.fillStyle = PIC.text; g.fillText(v, x, y + 14 + size);
    if (u) { const vw = g.measureText(v).width; g.font = `600 24px ${ui}`; g.fillStyle = PIC.soft; g.fillText(u.trim(), x + vw + 8, y + 14 + size); }
  });
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// ---------- Matched route ----------
route(/^\/route\/(\d+)$/, 'progress', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Routes')}</div>${skel(1)}<div class="sk block"></div>${skel(1)}`;
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
    el.innerHTML = `<div class="top">${backBtn('Routes')}<button class="icon-btn" id="r-edit" aria-label="Rename route">${svg('edit')}</button></div>
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

// ---------- Progress: home of cards, with each view’s filters inside its first card ----------
const PSPORTS = [['run', 'Runs'], ['ride', 'Rides'], ['walk', 'Walks'], ['hike', 'Hikes'], ['all', 'All sports']];
const PVIEWS = [['totals', 'Totals', 'Distance by week, month and year', 'progress', 'c-red'],
  ['fitness', 'Fitness', 'Race predictions, fitness and form', 'flame', 'c-orange'], ['records', 'Records', 'Your fastest times at each distance', 'trophy', 'c-purple'],
  ['lifting', 'Lifting', 'Every exercise, your bests and its history', 'workout', 'c-brand']];
const PMORE = [['trends', 'Year over year', 'Pace, heart rate and distance, year by year', 'progress', 'c-blue'],
  ['calendar', 'Calendar', 'Training and eating, day by day', 'calendar', 'c-orange'], ['routes', 'Matched routes', 'Compare the loops you have recorded more than once', 'activity', 'c-green'], ['segments', 'Segments & times', 'Your fixed courses, personal times and leaderboards', 'route', 'c-green'],
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
  el.addEventListener('click', e => {
    if (!e.target.closest('#p-sport')) return;
    pickSheet('Sport', pickRows(PSPORTS.map(([k,n])=>[k,n,'',k==='all'?'activity':k,'c-grey']),cur), k=>{
      try { localStorage.setItem('fit.psport',k); } catch(e) { /* no storage */ }
      const u=new URLSearchParams(location.search);u.set('sport',k);go(location.pathname+'?'+u,{replace:true});
    });
  });
}
// Discovery choices stay private to this account/server on this device. Old food preference is ignored.
const foodUser = () => !!(App.me.food_user || App.me.kcal_target);
function progressSwitch() { return ''; } // Nutrition's legacy Progress entry no longer adds a subject switch.
function progressVisit(view) { Discovery.visit('progress',view); }
function progressBack(el) {
  el.classList.add('has-back');
  const top = $('.top', el);
  const home = App.progressHome?.owner === readOwner() ? App.progressHome.href : '/progress';
  top.insertAdjacentHTML('afterbegin', '<a class="icon-btn progress-back" href="'+esc(home)+'" aria-label="Back to Progress">'+svg('back')+'</a>');
}
// Keep the controls alive when a cached chart is replaced by its fresh data. Reuse the shared view cleanup.
function progressFilters(el, body, html, {selector='.card'}={}) {
  if (!html) return;
  const controls = document.createElement('div'); controls.className = 'progress-filters'; controls.innerHTML = html;
  body.progressRange = $('#p-rng',controls);
  if (body.progressRange) rangeBar(body.progressRange,getRange(new URLSearchParams(location.search)),new Date().getFullYear());
  const mount = () => {
    const first = $(selector, body);
    if (first && controls.parentNode !== first) first.prepend(controls);
  };
  const observer = new MutationObserver(mount); observer.observe(body, {childList:true,subtree:true});
  viewResources.set(body, () => observer.disconnect()); mount();
}
function progressPeriods(period) {
  return '<div class="me-period mileage-toggle" role="group" aria-label="Totals period">'+PPERIODS.map(([k,n])=>`<button type="button" data-progress-period="${k}" aria-pressed="${period===k}">${n}</button>`).join('')+'</div>';
}
function wireProgressPeriods(el) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-progress-period]'); if (!b) return;
    const q = new URLSearchParams(location.search); q.set('period',b.dataset.progressPeriod);
    go('/progress?'+q, {replace:true});
  });
}
// Kit sits at the far right of the Progress header like other pages; the header is redrawn per view, so add it each time.
function wireProgressFocus(el) { if (typeof KitChat !== 'undefined') KitChat.entry(el, '/progress'); if(typeof Recaps!=='undefined')Recaps.entry(el); }
function nutritionHref(view, params = '') {
  const q=new URLSearchParams(params);q.set('view',view);
  if(location.pathname==='/progress'||new URLSearchParams(location.search).get('from')==='progress')q.set('from','progress');
  return '/food?'+q;
}
function foodProgress(el,q) {
  const requested=q.get('foodview')||'overview',view=NPROG.some(v=>v[0]===requested)?requested:'overview';
  const target=new URLSearchParams(q);target.delete('section');target.delete('foodview');target.set('view',view);target.set('from','progress');
  return go('/food?'+target,{replace:true});
}
function pHead(el, view, filters) {
  const v = [...PVIEWS, ...PMORE].find(m => m[0] === view);
  el.innerHTML = `<div class="top progress-heading"><h1>${esc(v?.[1] || 'Progress')}</h1><div class="acts">${bellBtn()}</div></div><div id="p-body">${skelChart()}</div>`;
  progressBack(el); progressVisit(view); wireProgressFocus(el);
  progressFilters(el, $('#p-body',el), filters);
}
const PEXPLORE = [
  ['heatmap','Heatmap','See where you train →','globe'],
  ['plan','Training plan','Build a 5K plan →','target'],
  ['calendar','Calendar','See each training day →','calendar'],
  ['segments','Segments','Compare course times →','route'],
  ['routes','Matched routes','Compare repeated loops →','activity'],
  ['trends','Year over year','Compare your years →','progress'],
  ['lifting','Lifting','See your sets and bests →','workout']
];
function progressTeasers(o) {
  const date = new Date(o.today+'T12:00'), month = date.toLocaleDateString([],{month:'long'});
  const plan = o.plan, next = plan?.next, when = next?.day === o.today ? 'Today' : next?.day === addDays(o.today,1) ? 'Tomorrow' : next ? fdate(next.day+'T12:00',{weekday:'short'}) : '';
  return {
    heatmap:o.mapped ? `${o.mapped.toLocaleString()} ${o.mapped===1?'activity':'activities'} mapped` : null,
    plan:plan ? next ? `${when}: ${next.title || 'Planned run'}` : plan.week ? `Week ${plan.week} of ${plan.weeks}` : 'Your training plan is ready' : null,
    calendar:o.active_days ? `${o.active_days} active ${o.active_days===1?'day':'days'} in ${month}` : null,
    segments:o.segments ? `${o.segments} segment ${o.segments===1?'best':'bests'}` : null,
    routes:o.routes ? `${o.routes} ${o.routes===1?'loop':'loops'} you have repeated` : null,
    trends:o.years>1 ? `${o.years} years of training` : null,
    lifting:o.lifting ? o.lifting.kg>0 ? `${o.lifting.name} ${U.weight(o.lifting.kg)} ${imp()?'lb':'kg'} best` : `${o.lifting.name} history` : null
  };
}
function progressTiles(box, overview=null, {ready=false}={}) {
  const teasers=overview?progressTeasers(overview):{};
  const items=PEXPLORE.map(([id,title,description,icon])=>({id,title,description,icon,teaser:teasers[id],href:id==='plan'?'/plan':id==='lifting'?'/progress?view=lifting':'/progress/'+id}));
  Discovery.render(box,items,{space:'progress',ready,attribute:'data-progress-feature'});
}
async function progressHome(el, q) {
  App.progressHome={owner:readOwner(),href:location.pathname+location.search};
  const sport = pSport(q), period = PPERIODS.some(p=>p[0]===q.get('period')) ? q.get('period') : 'week';
  el.innerHTML = `<div class="top progress-heading"><h1>Progress</h1><div class="acts">${bellBtn()}</div></div>
    <div class="progress-home"><div id="p-home-totals" class="progress-home-totals">${skelChart()}</div>
    <div class="progress-pair"><a class="card progress-summary" href="/progress?view=fitness"><h2>${svg('flame')}Fitness</h2><span data-progress-fitness class="small muted">Form and race estimates →</span></a>
    <a class="card progress-summary" href="/progress?view=records"><h2>${svg('trophy')}Records</h2><span data-progress-record class="small muted">Your fastest times, after a timed run</span></a></div>
    <h2 class="sec-head">Explore your training</h2><div class="progress-grid" id="p-explore"></div>
    ${foodUser()?'<a class="card progress-food-summary" href="/food?view=overview&from=progress"><h2>Food &amp; weight '+svg('chev')+'</h2><span class="small muted" data-progress-food>See your protein goals and weight trend →</span></a>':''}
    ${q.get('review')==='week'?'<div id="p-combined-week"></div>':''}</div>`;
  wireProgressFocus(el); wireProgressPeriods(el);
  Discovery.wire($('#p-explore',el),'progress',{attribute:'data-progress-feature'});
  const totals=$('#p-home-totals',el), grid=$('#p-explore',el); progressTiles(grid);
  progressFilters(el,totals,`<a class="progress-totals-title" href="/progress?view=totals">Totals ${svg('chev')}</a>${sportBtn(forView(sport,'totals'))}${progressPeriods(period)}`);
  wireSport(el,sport);
  q.set('sport',forView(sport,'totals'));q.set('period',period);
  if ($('#p-combined-week',el)) combinedWeek($('#p-combined-week',el));
  const owner=readOwner(), valid=()=>el.isConnected&&owner===readOwner();
  await Promise.allSettled([
    pMileage(totals,q,{home:true}).catch(()=>{if(valid())totals.innerHTML='<div class="card empty">Distance by week, month and year →</div>';}),
    load('/api/progress/overview',o=>{
      if(!valid())return; progressTiles(grid,o,{ready:true});
      const r=o.record;if(r)$('[data-progress-record]',el).innerHTML=`<b>${esc(r.label)} · ${esc(dur(r.elapsed_s))}</b><small>${esc(fdate(r.start_time,{month:'short',day:'numeric',year:'numeric'}))}</small>`;
      const food=$('[data-progress-food]',el);if(food){const f=o.food,delta=f.weight_change_kg;
        food.textContent=(f.protein_days===null?'Set a protein goal to track your week':`Protein goal ${f.protein_days} of 7 days`)+(delta===null?'':` · weight ${delta>0?'+':delta<0?'−':''}${U.weight(Math.abs(delta))} ${imp()?'lb':'kg'}`);}
    }).catch(()=>{if(valid())progressTiles(grid,null,{ready:true});}),
    load('/api/fitness?days=60',f=>{
      if(!valid())return;const last=f.days.at(-1),p=f.predictions[0];
      if(last&&f.days.some(d=>d.fitness>0))$('[data-progress-fitness]',el).innerHTML=`<b>${last.form>5?'Fresh':last.form< -15?'Tired':'Training steadily'}</b>${p?`<small>${esc(p.label)} estimate ${esc(dur(p.seconds))}</small>`:''}`;
      else if(p)$('[data-progress-fitness]',el).innerHTML=`<b>${esc(p.label)} · ${esc(dur(p.seconds))}</b><small>Race estimate</small>`;
    }).catch(()=>{})
  ]);
}
// each view takes the sports it can show: the shared choice, mapped to the nearest one it has
const forView = (sport, view) => ({totals: {hike: 'walk'}, records: {all: 'run'}, trends: {hike: 'walk', all: 'run'}, heatmap: {all: ''}}[view] || {})[sport] ?? sport;
route(/^\/progress$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search);
  if (q.get('section') === 'food') return foodProgress(el,q);
  if (!q.has('view')) return progressHome(el,q);
  const v0 = q.get('view') || 'totals';
  if (v0 === 'plan') return go('/plan', {replace: true});
  if (PMORE.some((m) => m[0] === v0)) { q.delete('view'); return go(`/progress/${v0}${q.toString() ? '?' + q : ''}`, {replace: true}); }   // old addresses
  const view = v0 === 'mileage' ? 'totals' : PVIEWS.some((p) => p[0] === v0) ? v0 : 'totals', sport = pSport(q);
  const period = PPERIODS.some((p) => p[0] === q.get('period')) ? q.get('period') : 'week';
  pHead(el, view, view === 'lifting' ? '' : view === 'fitness' ? '<span class="rng" id="p-rng"></span>'
    : sportBtn(forView(sport, view)) + (view === 'totals' ? progressPeriods(period) : ''));
  wireSport(el, sport);
  wireProgressPeriods(el);
  q.set('sport', forView(sport, view)); q.set('period', period);
  await ({totals: pMileage, fitness: pFitness, records: pRecords, lifting: pLifting}[view])($('#p-body', el), q);
});
route(/^\/progress\/routes$/, 'progress', async el => { pHead(el,'routes',''); await pRoutes($('#p-body',el)); });
route(/^\/progress\/segments$/, 'progress', async el => {
  pHead(el,'segments','');const body=$('#p-body',el),pending=Segments.list(body);
  // Segments owns its map/search logic; contain the existing options without changing that logic.
  const panel=document.createElement('section');panel.className='card progress-segment-controls';
  for(const child of [...body.children])if(!['sg-map','sg-list'].includes(child.id))panel.append(child);
  body.prepend(panel);
  const filters=$('.segment-filters',panel),select=$('#sg-sport',panel);
  if(filters&&select){
    const cur=select.value||'all',button=document.createElement('button');button.type='button';button.className='range-btn';button.id='sg-sport';button.innerHTML=svg(cur==='all'?'activity':cur)+'<span>'+esc(PSPORTS.find(([k])=>k===cur)?.[1]||'All sports')+'</span>'+svg('down');button.setAttribute('aria-label','Sport. Change');select.replaceWith(button);
    const toggles=document.createElement('div');toggles.className='mileage-toggle me-period';toggles.setAttribute('role','group');toggles.setAttribute('aria-label','Show segments');for(const b of $$('[data-f]',filters))toggles.append(b);filters.prepend(toggles);
    button.onclick=()=>pickSheet('Sport',pickRows(PSPORTS,cur),k=>{try{localStorage.setItem('fit.psport',k);}catch{}const q=new URLSearchParams(location.search);if(k==='all')q.delete('sport');else q.set('sport',k);go('/progress/segments'+(q.toString()?'?'+q:''),{replace:true});});
  }
  await pending;
});
route(/^\/progress\/(trends|calendar|heatmap)$/, 'progress', async (el, view) => {
  const q = new URLSearchParams(location.search), sport = pSport(q), withSport = view === 'trends' || view === 'heatmap';
  pHead(el, view, (withSport ? sportBtn(forView(sport, view)) : '') + (view === 'trends' ? '<span class="rng" id="p-rng"></span>' : ''));
  wireSport(el, sport);
  q.set('sport', forView(sport, view));
  await ({trends: pTrends, calendar: pCalendar, routes: pRoutes, heatmap: pHeatmap}[view])($('#p-body', el), q);
});
// Use the existing sheet lifecycle for focus, Escape, Back and account cleanup.
function fitnessChart(box, title, draw) {
  box.innerHTML = '<div data-fitness-plot></div><button type="button" class="linkbtn chart-expand">'+svg('expand')+' View full screen</button>';
  let closeFull = null;
  viewResources.set(box, () => closeFull?.());
  const plot = $('[data-fitness-plot]', box), open = () => {
    const owner = readOwner();
    const selected = chartViews.get(plot)?.state();
    sheet(title, '<div class="fitness-inspect"><p class="small muted">Pinch or scroll to zoom. Drag to move through dates. Tap or hover for exact values.</p><div data-full-chart></div></div>', (body, close) => {
      closeFull = close;
      body.closest('.sheet')?.querySelector('[data-close]')?.focus({preventScroll:true});
      const mount = $('[data-full-chart]', body);
      const redraw = () => {
        if (owner !== readOwner()) return close();
        if (!mount.isConnected) return;
        const view = chartViews.get(mount)?.state() ?? selected;
        const focused = mount.contains(document.activeElement);
        draw(mount, Math.max(220, Math.min(600, innerHeight * .52)), {view,interactive:true});
        if (focused) $('svg',mount)?.focus({preventScroll:true});
      };
      requestAnimationFrame(redraw);
      window.addEventListener('resize', redraw);
      viewResources.set(mount, () => {window.removeEventListener('resize', redraw);if(closeFull === close)closeFull = null;});
    });
  };
  draw(plot, 170);
  // The chart itself and the labelled button both open the larger analysis view.
  const graph = $('.chartbox', plot);
  if (graph) { graph.setAttribute('role','button'); graph.tabIndex=0; graph.setAttribute('aria-label','View '+title+' full screen'); graph.onclick=open; graph.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}}; }
  $('.chart-expand',box).onclick=open;
}
async function pFitness(body, q) {
  const R = getRange(q), nowY = new Date().getFullYear();
  const days = R.from ? Math.min(3650, Math.ceil((Date.now() - new Date(R.from, 0, 1)) / 864e5) + 1) : 3650;
  // the years button (in the row at the top since the 2026-10-12 redesign) changes the charts, not the predictions
  body.innerHTML = `<div id="fi-pred">${skel(1)}</div><div id="fi-body">${skel(1)}</div>`;
  await load(`/api/fitness?days=${days}`, (f0) => {
    const box = $('#fi-body', body), pbox = $('#fi-pred', body); if (!box) return;
    const f = {...f0, days: f0.days.filter((d) => inRange(R, +d.d.slice(0, 4)))};
    rangeBar(body.progressRange, R, f0.vdot_months.length ? +f0.vdot_months[0].m.slice(0, 4) : f0.days.length ? +f0.days[0].d.slice(0, 4) : nowY);
    const last = f0.days[f0.days.length - 1] || {fitness: 0, fatigue: 0, form: 0}, b = f.basis;
    pbox.innerHTML = f.predictions.length ? `<div class="card"><h2>Race predictions</h2><div class="pred">${f.predictions.map((p) => {
      // green means something (2026-10-13, Ben): the prediction beats your best ever at that distance
      const pr = p.best_s && p.seconds < p.best_s - 1;
      return `<div${pr ? ' class="pr"' : ''}><small class="muted">${esc(p.label)}</small><b class="num">${dur(p.seconds)}</b><small class="muted num">${U.pace(p.seconds / p.distance_m * 1000)}${U.pu()}</small>
        <small class="small muted prediction-source">From ${esc(p.from.label)} · ${esc(fdate(p.from.start_time, {month: 'short', day: 'numeric'}))}</small><small class="pbest">${p.best_s ? `${pr ? 'Beats your best,' : 'Your best:'} ${esc(dur(p.best_s))}` : 'Not raced yet'}</small></div>`; }).join('')}</div>
        <p class="small muted prediction-note">Estimates, not target paces.</p><details class="prediction-method"><summary>How estimates work</summary><p class="small muted">Uses your best efforts from the past 90 days, adjusted for endurance. Without recent long runs, it uses weekly mileage. Course, weather and race-day pacing aren’t included.</p><p class="small muted">Fastest recent effort: <a href="/activity/${b.activity_id}">${esc(b.label)} in ${esc(dur(b.elapsed_s))}</a> · ${esc(fdate(b.start_time, {month: 'short', day: 'numeric'}))}</p></details></div>`
      : '<div class="card"><h2>Race predictions</h2><p class="muted">Run a mile or more in the last 90 days and predictions appear here.</p></div>';
    box.innerHTML = `<div class="card"><h2>Running fitness</h2>${f.vdot_months.length ? `<div class="bigstat">${stat('VDOT now', f.vdot_now || '–')}${stat(R.from || R.to ? 'Best in range' : 'Best ever', ((v) => (v.length ? Math.max(...v).toFixed(1) : '–'))(f.vdot_months.filter((m) => inRange(R, +m.m.slice(0, 4))).map((m) => m.v)))}</div><div id="p-vdot"></div>
        <p class="small muted">VDOT is a running-performance score calculated from your fastest stretch each month (a mile or longer). Higher means faster recorded performance. It is not a measured VO₂max or a guarantee of race pace.</p>` : '<p class="muted">Needs runs of a mile or longer.</p>'}</div>
      <div class="card"><h2>Fitness, fatigue & form</h2>
      <div class="bigstat">${stat('Fitness', Math.round(last.fitness))}${stat('Form', (last.form > 0 ? '+' : '') + Math.round(last.form))}</div>
      <div id="p-load"></div><p class="small muted">Fitness = 6-week average training load, fatigue = last week. Form = fitness − fatigue: positive means fresh, negative means recent load is higher than your longer-term load. It does not diagnose overtraining.</p>
      ${f.ramp_7d > 8 ? '<div class="callout warn">Fitness rose fast this week (ramp ' + f.ramp_7d + '). Build gradually to stay healthy.</div>' : ''}</div>`;
    requestAnimationFrame(() => {
      fitnessChart($('#p-load', box), 'Training load', (mount, height, options) => loadChart(mount, f.days, {height,...options}));
      if (f.vdot_months.length) fitnessChart($('#p-vdot', box), 'Running fitness', (mount, height, options) => trendLine(mount, monthSeries(f.vdot_months[0].m, (m) => { const r = f.vdot_months.find((x) => x.m === m); return r ? {y: r.v} : {y: null}; }),
        {fmt: (v) => v.toFixed(1), color: 'brand', height, ...options, keep: (p) => inRange(R, p.d.getFullYear())}));
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
      <div class="card"><h2>PR progression</h2>${[...prs].reverse().map((r) => `<a class="row-link" href="/activity/${r.activity_id}"><div><b class="num">${dur(r.elapsed_s)}</b><br><small class="muted">${esc(r.name)}</small></div><small class="muted">${esc(fdate(r.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</small></a>`).join('')}</div>
      <div class="card"><h2>All efforts</h2><p class="small muted">Fastest first</p><div id="h-all"></div></div>`;
    wireBack(el, `/progress?view=records&sport=${sport}`);
    const all = [...rows].sort((a, b) => a.elapsed_s - b.elapsed_s), allRow = (r, i) => `<a class="row-link record-effort" href="/activity/${r.activity_id}"><span class="record-rank num">${i + 1}</span><div class="record-effort-main"><b class="num">${dur(r.elapsed_s)}</b><br><small class="muted">${esc(r.name)}</small></div><small class="muted">${esc(fdate(r.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</small></a>`;
    const drawAll = (n) => { const box = $('#h-all', el); if (!box) return; box.innerHTML = all.slice(0, n).map(allRow).join('') + (all.length > n ? `<button type="button" class="ghost wide" id="h-more">Show all ${all.length}</button>` : ''); const more = $('#h-more', box); if (more) more.onclick = () => drawAll(all.length); };
    drawAll(10);
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
async function pMileage(body, q, {home=false}={}) {
  const sport = q.get('sport') || 'run', period = q.get('period') || 'week';
  const R = {from: null, to: null}, scoped = false;   // Totals: the period sets how far back (date ranges live on Year over year)
  body.innerHTML = `<div id="m-body">${skelChart()}</div>`;   // Weeks / Months / Years: the button in the row at the top
  await load(`/api/progress/volume?period=${period}`, (r) => {
    const box = $('#m-body', body); if (!box) return;
    const keys = sport === 'all' ? VKEYS : VKEYS.filter((k) => k.k === sport);
    const by = {}; for (const x of r.rows) { const o = by[x.p] = by[x.p] || {}; o[x.s] = x; }
    if (!r.rows.length) { box.innerHTML = home ? '<div class="card empty"><p class="small muted">No activities yet. Your distance totals appear here.</p></div>' : `<div class="card empty"><b>No activities yet</b>Your mileage by week, month and year shows up here.${startCta()}</div>`; return; }
    // every period from the first activity to today
    const today = new Date(r.today + 'T12:00'), first = new Date(r.rows[0].p + 'T12:00'), all = [];
    const start = (d) => { const x = new Date(d); if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); else if (period === 'month') x.setDate(1); else { x.setMonth(0); x.setDate(1); } return x; };
    for (let d = start(first); d <= today; ) { all.push(new Date(d)); if (period === 'week') d.setDate(d.getDate() + 7); else if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1); }
    const val = (d, f = 'd') => { const o = by[ymd(d)] || {}; return keys.reduce((s, k) => s + Number((o[k.k] || {})[f] || 0), 0); };
    const label = (d) => period === 'week' ? 'Week of ' + d.toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'}) : period === 'month' ? d.toLocaleDateString([], {month: 'long', year: 'numeric'}) : String(d.getFullYear());
    const show = scoped ? all.filter((d) => inRange(R, d.getFullYear())) : period === 'week' ? all.slice(-26) : period === 'month' ? all.slice(-24) : all;
    // A short history still draws normal-width bars (2026-10-18 UI pass): one first week was one bar across the whole
    // chart. Earlier empty periods are added to the chart only; averages and bests still use real periods.
    const minCols = {week: 8, month: 6}[period] || 0;
    const chartDays = [...show];
    while (!scoped && chartDays.length && chartDays.length < minCols) { const d = new Date(chartDays[0]); if (period === 'week') d.setDate(d.getDate() - 7); else d.setMonth(d.getMonth() - 1); chartDays.unshift(d); }
    if (!show.length) { box.innerHTML = '<div class="card empty"><b>Nothing in this range</b>Pick other years above.</div>'; return; }
    const cols = chartDays.map((d, i) => {
      const prev = chartDays[i - 1], tick = period === 'year' ? (show.length > 8 ? "'" + String(d.getFullYear()).slice(2) : String(d.getFullYear()))
        : period === 'month' ? (d.getMonth() % 3 === 0 ? d.toLocaleDateString([], {month: 'short'}) + (d.getMonth() === 0 ? " '" + String(d.getFullYear()).slice(2) : '') : '')
        : (!prev || prev.getMonth() !== d.getMonth()) && (period !== 'week' || i < chartDays.length - 1) ? d.toLocaleDateString([], {month: 'short'}) : '';
      return {d, label: label(d), tick, partial: i === chartDays.length - 1, segs: keys.map((k) => ({k: k.k, v: toU(Number(((by[ymd(d)] || {})[k.k] || {}).d || 0))}))};
    });
    const complete = all.slice(0, -1), recent = scoped ? show.filter((d) => d < all[all.length - 1]) : period === 'week' ? complete.slice(-52) : period === 'month' ? complete.slice(-12) : complete;
    const avg = recent.length ? recent.reduce((s, d) => s + toU(val(d)), 0) / recent.length : null;
    const pool = scoped ? show : all, best = pool.reduce((b, d) => (val(d) > val(b) ? d : b), pool[0]);
    const rangeName = scoped ? (R.from === R.to ? String(R.from) : `${R.from || 'start'}–${R.to || 'now'}`) : '';
    const word = {week: 'week', month: 'month', year: 'year'}[period], fmt = (v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${U.du()}`;
    const cur = all[all.length - 1], last = all[all.length - 2];
    box.innerHTML = `<div class="card"><div class="stats3">
        ${stat('This ' + word, toU(val(cur)).toFixed(1), U.du())}
        ${home&&avg==null?'':stat({week: 'Weekly avg', month: 'Monthly avg', year: 'Yearly avg'}[period], avg == null ? '–' : avg.toFixed(1), U.du()).replace('class="stat"','class="stat progress-average"')}
        ${stat('Best ' + word + (scoped ? ' (range)' : ''), toU(val(best)).toFixed(period === 'year' ? 0 : 1), U.du())}</div>
        ${home?'':`<p class="small muted">${last ? `Last ${word}: ${esc(fmt(toU(val(last))))} · ` : ''}best ${esc(label(best).replace('Week of ', 'week of '))}</p>`}
        <div id="m-chart"></div>
</div>
      <details class="fold-row table-fold"><summary><span class="grow">Show as table</span><span class="chev">${svg('chev')}</span></summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${period === 'week' ? 'Week of' : period === 'month' ? 'Month' : 'Year'}</th><th class="r">${U.du()}</th><th class="r">Time</th><th class="r">#</th><th class="r">Climb</th></tr></thead><tbody>
        ${[...show].reverse().map((d) => `<tr><td>${esc(period === 'week' ? d.toLocaleDateString([], {month: 'short', day: 'numeric', year: '2-digit'}) : period === 'month' ? d.toLocaleDateString([], {month: 'short', year: 'numeric'}) : d.getFullYear())}</td>
          <td class="r num">${toU(val(d)).toFixed(1)}</td><td class="r num">${val(d, 't') ? dur(val(d, 't'), true) : '–'}</td><td class="r num">${val(d, 'n')}</td><td class="r num">${val(d, 'a') ? U.elev(val(d, 'a')) : '–'}</td></tr>`).join('')}</tbody></table></div></details>`;
    requestAnimationFrame(() => periodBars($('#m-chart', box), cols, {keys, fmt, yfmt: (v) => String(Math.round(v)), avg, avgLabel: period === 'year' ? 'Yearly average' + (scoped ? ` (${rangeName})` : '') : `Average ${period} (${scoped ? rangeName : 'last 12 months'})`, height: home?165:190, distance: sport === 'all'}));
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
    rangeBar(body.progressRange, R, +r.months[0].m.slice(0, 4));
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
  body.innerHTML = '<section class="card progress-map-card"><div class="map tall" id="h-map"></div></section>';
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
const SUPPORT_EMAIL = 'feedback@kinetta.app';
route(/^\/me$/, 'me', async (el) => {
  if (new URLSearchParams(location.search).get('setup') === 'body') return go('/me/settings?setup=body', {replace:true});
  const me = App.me, ch = `<span class="chev">${svg('chev')}</span>`;
  const row = (tag, attrs, ico, c, label, val = '') => `<${tag} class="row-link" ${attrs}><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}</span>${val ? `<span class="val">${val}</span>` : ''}${ch}</${tag}>`;
  el.innerHTML = `<div id="me-overview"></div>
    <div class="card list me-tools">${row('a', 'href="/me/activities"', 'activity', 'c-brand', 'All your activities<small class="muted">Every workout, including private ones</small>')}${row('a', 'href="/plan"', 'calendar', 'c-brand', 'Training plan')}${foodUser() ? row('a', 'href="/food/setup"', 'food', 'c-green', `Nutrition goal<small class="muted">${me.kcal_target ? `${Math.round(me.kcal_target)} kcal · ${me.protein_target ? Math.round(me.protein_target) + ' g protein' : 'review'}` : 'Optional setup'}</small>`) : ''}${row('a', 'href="/me/gear"', 'shoe', 'c-brand', 'Shoes & bikes')}${row('a', 'href="/me/explore"', 'help', 'c-brand', 'Explore Kinetta')}${row('a', `href="mailto:${SUPPORT_EMAIL}"`, 'mail', 'c-brand', 'Help & contact')}</div>`;
  el.insertAdjacentHTML('beforeend','<div id="me-challenges"></div>');Challenges.mount($('#me-challenges',el),{me:true});
  el.insertAdjacentHTML('beforeend','<div id="me-milestones"></div>');Milestones.mount($('#me-milestones',el),{row:true});
  meOverview($('#me-overview', el)).catch((e) => showError($('#me-overview', el), e));
});
route(/^\/me\/settings$/, 'me', async (el) => {
  const me = App.me, ch = `<span class="chev">${svg('chev')}</span>`;
  const row = (tag, attrs, ico, c, label, val = '') => `<${tag} class="row-link" ${attrs}><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}</span>${val ? `<span class="val">${val}</span>` : ''}${ch}</${tag}>`;
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Settings</h1><p class="muted">Your account, connections and private preferences.</p><button class="ghost wide" id="logout">${svg('logout')}Log out</button><section class="me-settings">
    <h2 class="sec-head">Account</h2>
    <div class="card list">${row('button', 'id="m-name"', 'user', 'c-grey', 'Name', esc(me.name))}
      ${row('button', 'id="m-login"', 'user', 'c-grey', 'Username', esc(me.login))}
      ${row('button', 'id="m-email"', 'mail', 'c-grey', 'Email', esc(me.email ? (me.email_confirmed ? me.email : me.email + ' · not confirmed') : pendingEmail() ? 'Check your inbox' : 'Add'))}
      ${row('button', 'id="m-pw"', 'key', 'c-grey', 'Password', 'Change')}
      ${row('a', 'href="/me/devices"', 'shield', 'c-grey', 'Signed-in devices')}</div>
    <h2 class="sec-head">Profile &amp; sharing</h2>
    <div class="card list">${row('button', 'id="m-profile"', 'user', 'c-green', 'Edit profile', 'Name, photo, bio & layout')}
      ${row('a', 'href="/me/sharing"', 'lock', 'c-green', 'Sharing &amp; privacy')}</div>
    <h2 class="sec-head">Connections &amp; notifications</h2>
    <div class="card list">${row('a', 'href="/track/connections"', 'watch', 'c-brand', 'Connections')}
      ${row('a', 'href="/me/notifications"', 'bell', 'c-orange', 'Notifications')}<label class="row-link"><span class="ri c-brand">${svg('help')}</span><span class="grow">Show setup tips<small class="muted">Optional connection and profile reminders</small></span><input type="checkbox" id="m-setup-tips"${me.setup_hidden?'':' checked'}></label>${(me.setup_skipped||[]).length?'<button type="button" class="row-link" id="m-setup-unskip"><span class="ri c-brand">'+svg('check')+'</span><span class="grow">Bring back skipped setup steps</span></button>':''}</div>
    <h2 class="sec-head">Units &amp; body</h2>
    <div class="card list"><div class="row-link static"><span class="ri c-grey">${svg('ruler')}</span><span class="grow">Units</span><div class="seg" role="group" aria-label="Units">
        <button data-u="imperial" aria-pressed="${me.units === 'imperial'}">mi · lb</button><button data-u="metric" aria-pressed="${me.units === 'metric'}">km · kg</button></div></div>
      ${row('button', 'id="m-body"', 'heart', 'c-red', 'Body & heart rate', esc([me.max_hr ? `Max HR ${me.max_hr}` : '', me.weight_kg ? `${Math.round(U.weight(me.weight_kg))} ${imp() ? 'lb' : 'kg'}` : ''].filter(Boolean).join(' · ') || 'Set up'))}</div>
    ${me.coach ? `<h2 class="sec-head">Kit</h2><div class="card" id="ai"><p class="small muted">${me.ai_paused ? 'AI is paused. Search, barcodes and manual logging still work.' : 'Optional training notes and food estimates. AI consent is separate from access.'}</p>${me.ai_access ? `<p class="small muted">Food estimates: ${me.ai_access.food?.entitled && me.ai_access.food?.available ? 'available' : 'not available'} · Coaching: ${me.ai_access.coach?.entitled && me.ai_access.coach?.available ? 'available' : 'not available'}. Manual tools stay available.</p>${me.ai_access.coach?.reason?`<p class="small muted">${esc(me.ai_access.coach.reason)}</p>`:''}` : ''}<button class="linkbtn small" id="m-ai-info">What gets shared?</button>${kitChatOn() ? `<a class="icon-btn kit-help" href="/me/kit" aria-label="Ask Kit">${svg('sparkle')}</a>` : ''}
      <div class="seg wide" role="group" aria-label="AI features"><button data-ai="1" aria-pressed="${!!me.ai_ok}">On</button><button data-ai="0" aria-pressed="${!me.ai_ok}">Off</button></div></div>` : ''}
    <h2 class="sec-head">Your data</h2>
    <div class="card list">${row('button', 'id="m-kit-memory"', 'sparkle', 'c-green', 'What Kit remembers', 'View or remove')}${row('a', 'id="m-export" href="/api/account/export" download', 'download', 'c-blue', 'Download my data', 'Zip file')}
      ${row('a', 'href="https://kinetta.app/privacy" target="_blank" rel="noopener"', 'shield', 'c-green', 'Privacy policy')}
      ${row('button', 'id="m-del"', 'trash', 'c-red', '<span class="danger">Delete my account</span>')}</div>
    <h2 class="sec-head">Help</h2>
    <div class="card list">${row('a', `href="mailto:${SUPPORT_EMAIL}"`, 'mail', 'c-brand', 'Help &amp; contact')}
      ${row('a', 'href="/me/speed"', 'clock', 'c-grey', 'Speed check')}</div>
    </section>`;
  wireBack(el, '/me');
  const unskip=$('#m-setup-unskip',el);if(unskip)unskip.onclick=async()=>{
    if(unskip.disabled)return;const owner=readOwner();unskip.disabled=true;
    try{await api('/api/profile',json('PUT',{setup_skipped:[]}));if(owner!==readOwner())return;App.me.setup_skipped=[];invalidate('/api/me');keep('/api/me',App.me);unskip.remove();toast('Skipped setup steps are back on Me');}
    catch(x){if(owner===readOwner()){unskip.disabled=false;toast(x.message);}}
  };
  $('#m-setup-tips',el).onchange=async e=>{
    const input=e.target,owner=readOwner(),hidden=!input.checked;input.disabled=true;
    try{await api('/api/profile',json('PUT',hidden?{setup_hidden:true}:{setup_hidden:false,setup_skipped:[]}));if(owner!==readOwner())return;App.me.setup_hidden=hidden;if(!hidden)App.me.setup_skipped=[];invalidate('/api/me');keep('/api/me',App.me);}
    catch(x){if(owner===readOwner()){input.checked=hidden;toast(x.message);}}finally{input.disabled=false;}
  };
  $('#m-profile', el).onclick = () => MeCard.openEditor();

  $('#m-kit-memory',el).onclick=()=>KitChat.memorySettings();
  const aiInfo = $('#m-ai-info', el); if (aiInfo) aiInfo.onclick = () => sheet('Kit', aiExplain());
  $('#m-name', el).onclick = () => accountSheet('name');
  $('#m-login', el).onclick = () => accountSheet('login');
  $('#m-pw', el).onclick = () => passwordSheet();
  $('#m-email', el).onclick = () => emailSheet();
  if (new URLSearchParams(location.search).get('email') === 'add') { history.replaceState(null, '', '/me/settings'); emailSheet(); }
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
    history.replaceState(null, '', '/me/settings'); bodySheet();
  }
  const logout = $('#logout', el);
  let leaving = false;
  logout.onclick = async () => {
    if (leaving) return;
    leaving = true; logout.disabled = true;
    const owner = readOwner(), account = App.me, valid = () => owner === readOwner();
    try {
      let chat=0;try{if(typeof FoodThread!=='undefined')chat=await FoodThread.pendingCount();}catch(e){if(valid())toast('Could not check unsent food messages. Try logging out again.');return;}
      let shortcuts=0;try{shortcuts=await Native.foodEntryPendingCount?.()||0;}catch(e){if(valid())toast(e.message);return;}
      if (!valid()) return;
      const n = Q.mine().length + chat + shortcuts;
      if (n && !confirm(`${n} item${n > 1 ? 's' : ''} saved offline haven't been sent yet and will be lost. Log out anyway?`)) return;
      if (typeof FoodThread!=='undefined'){try{await FoodThread.eraseDevice();}catch(e){if(valid())toast('Could not remove unsent food photos from this phone. Retry logout to finish clearing them.');return;}}
      if (!valid()) return;
      if(typeof KitChat!=='undefined')KitChat.eraseDevice();
      if (typeof Track !== 'undefined') await Track.pause();
      if (!valid()) return;
      // A failed request can leave the browser cookie valid. Keep Settings visible so retry is honest.
      try { await api('/api/logout', json('POST', {})); }
      catch (e) { if(valid())toast('Could not log out. Check your connection and try again.'); return; }
      if (!valid()) return;
      const cleanup = Native.forget(), clearedOwner = readOwner();
      await cleanup;
      if (clearedOwner !== readOwner()) return;
      store.set('fit.queue', Q.all().filter((o) => o.who !== account.login)); forgetKept();
      App.me = null; App.cache.clear(); netbar(); history.replaceState(null, '', '/'); showLogin();
    } catch (e) { if(valid())toast(e.message || 'Could not log out. Try again.'); }
    finally { leaving = false; logout.disabled = false; }
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
    <p class="small muted">${isName ? 'Shown at the top of your screens.' : me.email ? 'Your @name: how friends find and mention you. Change it whenever you like; you log in with your email. Lowercase letters, numbers or _.' : 'Your @name, and what you type to log in until you add an email. Change it whenever you like. Lowercase letters, numbers or _.'}</p>
    <div class="actions"><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#ac', b); f.v.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try { const r = await api('/api/account', json('PUT', {[field]: f.v.value})); me[field] = r[field]; close(); render(); toast(isName ? 'Name saved' : me.email ? `You're now @${r[field]}` : 'Username changed - use it next time you log in'); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
// your email (2026-10-24, #232): used only after you open the confirmation link sent to it; lets you log in with it and
// reset a forgotten password. Needs the current password, so someone at an unlocked phone can't redirect resets.
// the address waiting for its link to be opened, until this account's details next come from the server with an email
let pendingSent = null;
const pendingEmail = () => App.me && !App.me.email ? (pendingSent && pendingSent.id === App.me.id ? pendingSent.email : App.me.pending_email) || null : null;
function emailSheet() {
  const me = App.me;
  if (!me.mail_ready) { sheet('Email', '<p>Email isn’t set up on this Kinetta yet. Ask the person who runs it.</p>'); return; }
  sheet('Email', `<form class="form" id="em">
    <input name="username" value="${esc(me.login)}" autocomplete="username" hidden>
    <p class="small muted">${me.email ? `Now: <b>${esc(me.email)}</b>. ` : ''}We'll send a link to confirm it. You can then log in with it and reset your password if you forget it. It's never shown to other people.</p>
    <label>Email<input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="120" required value="${esc(pendingEmail() || '')}"></label>
    <label>Your password<input name="pw" type="password" autocomplete="current-password" required></label>
    <div class="actions"><button class="primary">Send confirmation link</button></div></form>`, (b, close) => {
    const f = $('#em', b); f.email.focus();
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try {
        const r = await api('/api/account/email', json('PUT', {email: f.email.value.trim(), password: f.pw.value}));
        pendingSent = {id: me.id, email: r.pending}; close(); render(); toast(`Check ${r.pending} for a link to confirm it`);
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}
// delete my own account and everything in it (2026-10-11); needs the password, can't be undone
function deleteSheet() {
  const account=readOwner(),login=App.me.login;
  const recordingOwner=typeof TrackNative!=='undefined'?TrackNative.owner():null;
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
        if(Native.on)await (Native.pauseSession||Native.pauseHealth)();
        if(account!==readOwner())return;
        try { await api('/api/account/delete', json('POST', {password: f.pw.value})); }
        catch(e){if(account===readOwner())Native.resumeHealth?.();throw e;}
        // Once the server confirms deletion, every cleanup gets its own chance.
        const cleanup=async action=>{try{await action();}catch(e){toast('Account deleted. Some device cleanup needs retry; clear app storage if old data remains.');}};
        await cleanup(()=>typeof TrackNative!=='undefined'?TrackNative.eraseDraft(recordingOwner):null);
        await cleanup(()=>clearSegmentDrafts());
        await cleanup(()=>Native.forget({deleted:true}));
        await cleanup(()=>typeof KitChat!=='undefined'?KitChat.eraseDevice():null);
        await cleanup(()=>typeof FoodThread!=='undefined'?FoodThread.eraseDevice():null);
        await cleanup(()=>typeof RecipeImport!=='undefined'?RecipeImport.eraseDevice():null);
        await cleanup(()=>typeof Track!=='undefined'?Track.forgetDraft():null);
        await cleanup(()=>store.set('fit.queue',Q.all().filter(o=>o.who!==login)));
        await cleanup(()=>globalThis.Intervals?.clear());
        await cleanup(()=>forgetKept());await cleanup(()=>close());
        App.me=null;App.cache.clear();
        await cleanup(()=>netbar());await cleanup(()=>history.replaceState(null,'','/'));
        showLogin('Your account and all your data were deleted.');
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
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Admin tools</h1><p>${App.me.is_admin?'Manage this Kinetta in the separate browser portal. Your personal settings stay here in Me.':'These tools are for the person who runs this Kinetta.'}</p>${App.me.is_admin?`<a class="primary wide" href="${esc((Native.base||location.origin)+'/admin')}" target="_blank" rel="noopener">Open admin tools</a>`:''}`;
  wireBack(el,'/me');
});
// admin: set a new password for someone (forgotten), or remove them and all their data (2026-10-10)
route(/^\/me\/import$/, 'track', async () => go('/track/import', {replace:true}));
route(/^\/track\/import$/, 'track', async (el) => {
  el.classList.add('activity-import');
  const owner=readOwner(),account=App.me?.id,valid=()=>el.isConnected&&owner===readOwner();
  const mapFor=new URLSearchParams(location.search).get('map_for'),mapId=/^[1-9]\d*$/.test(mapFor||'')?mapFor:null;
  if (Native.on) return go('/track/connections', {replace:true});
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

// Garmin Connect through Garmin's developer program: sign in at Garmin; new activities arrive after each watch sync.
// No Sync now (2026-10-24): Garmin sends each new activity by itself, and these keys can't ask for older ones again.
function garminNote(g){
  const s=(g.status||'').replace(/^connected( - )?/,'');
  const last=g.last_sync?` Last activity arrived ${esc(when(g.last_sync))}.`:'';
  return s.includes('activity sharing is off')?'Activity sharing is off: turn on Activities for Kinetta in Garmin Connect, then reconnect here.'
    :`New activities arrive by themselves after your watch syncs with Garmin Connect, usually within a few minutes.${last}`;
}
function garminCard(box,C,valid){
  const g=C.garmin_connect;if(!box)return;
  if(!(C.garmin_connect_available||g)){box.innerHTML='<div class="card"><h2>Garmin Connect</h2><p>Garmin Connect is not available for this account yet. You can use Apple Health or record activities in Kinetta.</p></div>';return;}
  box.innerHTML=`<div class="card"><h2>Garmin Connect</h2>
    <p>${g?`<b>Connected.</b> ${garminNote(g)}`:'New Garmin activities arrive after your watch syncs, with maps and heart rate.'} For older history, ${Native.on?'import past workouts from Apple Health':'use Apple Health or import a Strava export in your browser'}.</p>
    ${g?`<label class="check"><input type="checkbox" id="gc-ai"${App.me.garmin_ai_ok?' checked':''}> Let Kit read my Garmin activities</label>
    <p class="small muted">Off unless you say yes. Sends the activities Kit needs to ${esc(App.me.ai_provider||'the AI service')}. Garmin data is never used to train AI.</p>
    <button type="button" class="linkbtn danger gc-off" id="gc-off">Disconnect Garmin</button>`
    :'<button type="button" class="primary wide" id="gc-on">Connect Garmin</button>'}</div>`;
  const on=$('#gc-on',box);if(on)on.onclick=async()=>{
    try{const r=await api('/api/connections/garmin-connect/start',json('POST',{native:Native.signInSheet}));if(!valid())return;
      if(Native.signInSheet){
        const res=await Native.webSignIn(r.url);if(!valid()||res.cancelled)return;
        const q=new URL(res.url).searchParams;toast(q.get('ok')==='1'?q.get('title'):`${q.get('title')}. ${q.get('text')}`);render();
      }else if(Native.on){window.open(r.url,'_blank');toast('Finish signing in at Garmin, then come back');}else location.href=r.url;}
    catch(x){toast(x.message);}};
  const off=$('#gc-off',box);if(off)off.onclick=async()=>{
    if(!confirm('Disconnect Garmin? New activities stop arriving. Activities already here stay until you delete them.'))return;
    try{await api('/api/connections/garmin_connect',{method:'DELETE'});toast('Garmin disconnected');if(valid())render();}catch(x){toast(x.message);}};
  const ai=$('#gc-ai',box);if(ai)ai.onchange=async(e)=>{const v=e.target.checked;
    try{await api('/api/profile',json('PUT',{garmin_ai_ok:v}));App.me.garmin_ai_ok=v;toast(v?'Kit can read your Garmin activities':'Kit won’t read your Garmin activities');}
    catch(x){e.target.checked=!v;toast(x.message);}};
}

route(/^\/me\/connections$/, 'track', async () => go('/track/connections',{replace:true}));
route(/^\/track\/connections$/, 'track', async (el) => {
  el.classList.add('connections-page');
  const owner=readOwner(),valid=()=>el.isConnected&&readOwner()===owner;
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Connections</h1><p class="muted">Connect Garmin or Apple Health to bring in workouts automatically. A watch is optional.</p>
    <div id="c-gc"></div>
    <div class="card" id="c-health"><h2>Apple Health</h2>${skel(1)}</div>
    ${Native.on ? '' : '<a class="card tap row-link" href="/track/import"><div class="grow"><h2>Import activity history</h2><p>Original activity files or a Strava export, in your browser.</p></div><span class="chev">'+svg('chev')+'</span></a>'}
    <details class="card" id="c-other"><summary>Other connections</summary><div id="c-body">${skel(2)}</div></details>`;
  wireBack(el, '/track');
  const healthCard=(isOn,st,error='')=>{if(!valid())return;$('#c-health',el).innerHTML=`<h2>Apple Health</h2>
    <p>${Native.on?isOn?'Sync enabled. Health shares only the categories you allow.':'Optional · share nutrition, read weight or import workouts.':'Available in the Kinetta iPhone app.'}</p>
    ${st?.at?`<p class="small muted">Last ${st.error?'attempt':'sync'} ${esc(when(st.at))}.</p>`:''}${error?`<p class="err">${esc(error)}</p>`:''}
    <a class="${Native.on?'primary':'ghost'} wide" href="/track/health">${Native.on?isOn?'Manage Apple Health':'Connect Apple Health':'About Apple Health'}</a>
    <details><summary>Using a Garmin?</summary><p class="small">Enable Apple Health sharing in Garmin Connect, then sync your watch there. Workouts can take a while to arrive. Garmin does not send GPS routes to Health. Connect Garmin directly for maps on new workouts.</p></details>`;};
  if(Native.on)Native.healthCall(Promise.all([Native.anyHealthOn?Native.anyHealthOn():Native.healthOn(),Native.healthStatus()]),'Health status could not be checked.',5000).then(([on,st])=>healthCard(on,st)).catch(()=>healthCard(false,null,'Health status could not be checked. Open Apple Health to review setup.'));
  else healthCard(false,null);
  let C;
  try{C=await api('/api/connections');}catch(e){if(valid()){$('#c-gc',el).innerHTML=`<div class="card" role="alert"><p>Connections could not load. ${esc(e.message)}</p><button type="button" class="ghost" data-connections-retry>Retry</button></div>`;$('[data-connections-retry]',el).onclick=()=>render();}return;}
  if(!valid())return;
  garminCard($('#c-gc',el),C,valid);
  const st = (k) => C[k] ? `<p class="small"><b>Connected.</b> ${esc(C[k].status || '')}${C[k].last_sync ? ' · ' + esc(when(C[k].last_sync)) : ''}</p>` : '<p class="small muted">Not connected.</p>';
  $('#c-body', el).innerHTML = `<div class="card"><h2>Health Auto Export</h2>
      <p class="small">In the iPhone app <b>Health Auto Export</b> (Premium), add an automation: <b>REST API</b>, format <b>JSON</b>, data <b>Workouts</b> (and optionally <b>Body Mass</b>), with the address and header below.</p>${st('apple')}
      <div id="c-apple-out"></div><div class="actions">${C.apple ? '<button class="ghost danger" data-off="apple">Disconnect</button><span class="spacer"></span>' : ''}<button class="ghost" id="c-apple">${C.apple ? 'Make a new secret' : 'Create connection link'}</button></div></div>`;
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

// ---------- Signed-in devices (#232 I) ----------
// Where you're logged in: a rough device name and dates only (no IP addresses). After a lost phone, sign out the
// others from here; this device signs out with Log out.
route(/^\/me\/devices$/, 'me', async (el) => {
  const owner = readOwner();
  el.innerHTML = `<div class="top">${backBtn('Settings')}</div><h1>Signed-in devices</h1><p class="muted">Where you’re logged in to Kinetta. Sign out anything you don’t recognise, then change your password.</p><div id="dv-list">${skel(2)}</div>`;
  wireBack(el, '/me/settings');
  const day = (t) => fdate(t, {month: 'short', day: 'numeric', year: 'numeric'});
  const draw = async () => {
    const rows = await api('/api/account/devices');
    if (!el.isConnected || owner !== readOwner()) return;
    const others = rows.filter((d) => !d.this);
    $('#dv-list', el).innerHTML = `<div class="card list">${rows.map((d) => `<div class="row-link static device-row"><span class="ri c-grey">${svg('shield')}</span><span class="grow">${esc(d.device)}<small class="muted">${d.this ? 'This device · ' : ''}Last used ${esc(day(d.last_used))} · signed in ${esc(day(d.signed_in))}</small></span>${d.this ? '' : `<button class="linkbtn" data-dv="${esc(d.id)}" aria-label="Sign out ${esc(d.device)}">Sign out</button>`}</div>`).join('')}</div>
      ${others.length ? `<button class="ghost wide" id="dv-all">Sign out all other devices</button>` : '<p class="small muted">Only this device is signed in.</p>'}`;
    $$('[data-dv]', el).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await api('/api/account/devices/signout', json('POST', {id: b.dataset.dv})); toast('Signed out'); await draw(); }
      catch (x) { toast(x.message); b.disabled = false; }
    });
    const all = $('#dv-all', el);
    if (all) all.onclick = async () => {
      if (!confirm(`Sign out ${others.length} other device${others.length > 1 ? 's' : ''}? They’ll need your password to log in again.`)) return;
      all.disabled = true;
      try { await api('/api/account/devices/signout-others', json('POST', {})); toast('Other devices signed out'); await draw(); }
      catch (x) { toast(x.message); all.disabled = false; }
    };
  };
  await draw();
});

// ---------- Speed check (2026-10-18) ----------
// Times requests from this phone so the owner can see where waiting comes from: the connection itself, a first-time
// address (iPhone app requests to a new address are preceded by a permission check, a "preflight"), and a few typical
// screens' data. Read-only requests to the person's own account; nothing is stored or sent anywhere else.
route(/^\/me\/speed$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Speed check</h1>
    <p class="muted">Times a few requests from this phone to your Kinetta server. It reads your own data only and saves nothing.</p>
    <button class="primary wide" id="sp-run">Run speed check</button><div id="sp-out"></div>`;
  wireBack(el, '/me');
  const time = async (path) => { const t = performance.now(); try { await api(path); return Math.round(performance.now() - t); } catch (e) { return 'error'; } };
  const median = (a) => { const n = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return n.length ? n[Math.floor(n.length / 2)] : 'error'; };
  $('#sp-run', el).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
    const rows = [], add = (label, v, note = '') => rows.push([label, v, note]);
    try {
      const same = []; for (let i = 0; i < 5; i++) same.push(await time('/api/health'));
      const fresh = []; for (let i = 0; i < 5; i++) fresh.push(await time('/api/health?n=' + Date.now() + i));
      add('Connection, repeated address', median(same.slice(1)), 'one round trip');
      add('First time at an address', median(fresh), 'includes any permission check');
      for (const [label, path] of [['Me summary data', '/api/stats'], ['Activity list', '/api/activities?limit=20'], ['Progress by month', '/api/progress/volume?period=month'], ['Fitness', '/api/fitness?days=60'], ['Today’s food', '/api/food/day']])
        { await time(path); const t = []; for (let i = 0; i < 3; i++) t.push(await time(path)); add(label, median(t), 'repeated address'); }
      add('Phone', Native.on ? 'iPhone app' : 'browser', navigator.userAgent.match(/OS (\d+[_\d]*)/)?.[1]?.replace(/_/g, '.') || '');
    } finally { if (b.isConnected) { b.disabled = false; b.textContent = 'Run again'; } }
    if (!el.isConnected) return;
    const text = rows.map(([l, v, n]) => `${l}: ${v}${typeof v === 'number' ? ' ms' : ''}${n ? ` (${n})` : ''}`).join('\n');
    $('#sp-out', el).innerHTML = `<div class="card list">${rows.map(([l, v, n]) => `<div class="row-link"><span class="grow">${esc(l)}<small class="muted gs-sub">${esc(n)}</small></span><b class="num">${esc(String(v))}${typeof v === 'number' ? ' ms' : ''}</b></div>`).join('')}</div>
      <button class="ghost wide" id="sp-copy">Copy results</button>`;
    $('#sp-copy', el).onclick = async () => { try { await navigator.clipboard.writeText('Kinetta speed check\n' + text); toast('Copied'); } catch (x) { toast('Copy failed. Take a screenshot instead.'); } };
  };
});

