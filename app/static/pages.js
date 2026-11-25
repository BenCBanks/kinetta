// Kinetta phone app — Part 2: pages. Each page renders a skeleton at once, then fills from cache/API.
'use strict';

// ---------- shared bits ----------
const stat = (label, v, u = '') => `<div class="stat"><small>${esc(label)}</small><b class="num">${esc(v)}${u ? `<i>${esc(u)}</i>` : ''}</b></div>`;
const firstStep = (icon,copy,id,label,options='') => `<div class="card first-step"><span class="first-step-icon" aria-hidden="true">${svg(icon)}</span><p>${copy}</p><button type="button" class="primary wide" id="${id}">${label}</button>${options}</div>`;
const activityElapsedText = a => { const s=Number(a.elapsed_s); return Number.isFinite(s)&&s>0?U.time(s):'–'; };
const activityMovingText = a => { const s=Number(a.moving_s); return a.moving_s!=null&&Number.isFinite(s)&&s>=0?U.time(s):'–'; };
function headline(a) {
  const r = rate(a);
  if (a.lifts && !a.distance_m) return stat('Time', activityElapsedText(a)) + stat('Sets', a.lifts.sets)
    + (a.lifts.volume ? stat('Lifted', Math.round(imp() ? a.lifts.volume * LB : a.lifts.volume).toLocaleString(), wUnit()) : stat('Exercises', a.lifts.exercises));
  const first = a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : stat('Time', activityElapsedText(a));
  const third = a.distance_m ? stat('Time', activityElapsedText(a)) :
    a.avg_hr ? stat('Avg HR', Math.round(a.avg_hr), 'bpm') : stat('Effort', a.effort ? Math.round(a.effort) : '–');
  return first + (a.distance_m ? (r.label==='Time' ? (a.avg_hr?stat('Avg HR',Math.round(a.avg_hr),'bpm'):'') : stat(r.label,r.v,r.u)) : (a.effort ? stat('Effort', Math.round(a.effort)) : stat('Calories', a.calories ? Math.round(a.calories) : '–'))) + third;
}
function activityMonthKey(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:tz(),year:'numeric',month:'2-digit'}).formatToParts(date).map(p => [p.type,p.value]));
  return parts.year && parts.month ? `${parts.year}-${parts.month}` : '';
}
function activityMonthName(month) { return fdate(`${month}-01T12:00:00Z`, {timeZone:'UTC',month:'long',year:'numeric'}); }

// Owner achievement summaries live on the full profile; these two destinations share its worker-backed response.
route(/^\/me\/achievements$/, 'me', async el=>ProfileLayout.achievementPage(el));
route(/^\/me\/achievements\/([^/]+)$/, 'me', async (el,code)=>ProfileLayout.achievementPage(el,code));

// The owner history is rendered by the profile route; enhance its activity-list header here so the
// activity lane can own this control without changing the separate social/profile controller.
async function jumpOwnerActivitiesToMonth(list, month, button) {
  const owner = readOwner(), active = () => list.isConnected && owner === readOwner();
  const matches = () => $$('.activity-card[data-activity-month="' + month + '"]', list);
  const more = $('#person-more', list.parentElement);
  button.disabled = true;
  try {
    while (active() && !matches().length && more && !more.hidden && typeof more.onclick === 'function') {
      if (more.disabled) break;
      const before = $$('.activity-card', list).length;
      await more.onclick.call(more);
      if (!active() || $$('.activity-card', list).length <= before) break;
    }
    if (!active()) return;
    const first = matches()[0];
    if (!first) { toast(`No matching activities in ${activityMonthName(month)}.`); return; }
    first.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
async function openOwnerActivityMonths(button, list) {
  const owner = readOwner();
  button.disabled = true;
  try {
    const data = await api('/api/progress/volume?period=month');
    if (!list.isConnected || owner !== readOwner()) return;
    const counts = new Map();
    for (const row of data.rows || []) {
      const month = String(row.p || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) counts.set(month, (counts.get(month) || 0) + Number(row.n || 0));
    }
    const months = [...counts].filter(([, count]) => count > 0).sort(([a],[b]) => b.localeCompare(a));
    const rows = months.length ? months.map(([month, count]) => {
      const name = activityMonthName(month), noun = count === 1 ? 'activity' : 'activities';
      return `<button type="button" class="row-link" data-activity-month="${month}" aria-label="${esc(name)}, ${count} ${noun}"><span class="grow">${esc(name)}</span><span class="val num">${count.toLocaleString()}</span></button>`;
    }).join('') : '<p class="small muted">No activities yet.</p>';
    sheet('Month', `<div class="profile-month-options">${rows}</div>`, (body, close) => {
      $$('[data-activity-month]', body).forEach(row => row.onclick = () => {
        const month = row.dataset.activityMonth;
        close();
        jumpOwnerActivitiesToMonth(list, month, button).catch(error => toast(error.message));
      });
    });
  } catch (error) {
    if (list.isConnected && owner === readOwner()) toast(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
function mountOwnerActivityMonthJump() {
  const profile = $('#person-profile');
  if (!profile) return;
  const filters = $('.profile-list-filters', profile), list = $('#person-activities', profile);
  if (!filters || !list || !$('#person-sport', filters) || $('#person-month', filters)) return;
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'person-month'; button.setAttribute('aria-label', 'Choose activity month');
  button.setAttribute('aria-haspopup', 'dialog'); button.textContent = 'Month ⌄';
  button.onclick = () => openOwnerActivityMonths(button, list);
  filters.insertBefore(button, $('#person-sport', filters));
}
if (typeof MutationObserver !== 'undefined' && typeof $ === 'function') {
  const root = $('#app');
  if (root) new MutationObserver(mountOwnerActivityMonthJump).observe(root, {childList:true,subtree:true});
}
if (typeof $ === 'function') mountOwnerActivityMonthJump();
// One card for every activity list: title and person, a full-width map with overlay metrics, then footer actions.
function postCard(a, {compact = false, lock = false} = {}) {
  const theirs = !!a.owner, href = theirs ? `/activity/friends/${a.id}` : `/activity/${a.id}`;
  const kind = a.sport_label && a.sport_label.toLowerCase() !== SPORT_NAMES[a.sport].toLowerCase() ? a.sport_label : SPORT_NAMES[a.sport];
  const badges = [];
  if (a.prs) badges.push(`<span class="badge pr">${svg('trophy')} ${a.prs} PR${a.prs > 1 ? 's' : ''}</span>`);
  if (a.commute) badges.push('<span class="badge">Commute</span>');
  // The activity title leads the header; the avatar and metadata link to the person's profile.
  const person = theirs ? a.owner : App.me, pref = profileHref(person), pname = theirs ? esc(a.owner.name) : 'You';
  const vis = a.visibility || 'me';
  const title = `<a class="post-link post-title-link" href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}"><h3 class="post-title">${esc(a.name)}</h3></a>`;
  const audienceIcon=theirs?'':`<span class="post-meta-icon${vis==='me'?' post-private':''}" role="img" aria-label="${esc(VIS_SHORT[vis])}" title="${esc(VIS_SHORT[vis])}">${svg(vis==='me'?'lock':vis==='friends'?'people':'globe')}</span>`;
  const meta = `<span class="post-meta-date">${esc(when(a.start_time).replace(' at ', ' '))}</span><span class="post-meta-icon post-meta-kind" role="img" aria-label="${esc(kind)}" title="${esc(kind)}">${svg(a.sport in IC?a.sport:'activity')}</span>${audienceIcon}`;
  const homeFeed=typeof location!=='undefined'&&location.pathname==='/activity',personAvatar=avatar(person),feedAvatar=homeFeed?personAvatar.replace(/(<img\b[^>]*?)\s(?:src|data-asrc)=("[^"]+")/,'$1 data-feed-src=$2'):personAvatar;
  const head = `<div class="post-identity"><a class="post-av" href="${pref}" aria-label="${theirs ? `${pname}’s profile` : 'Your profile'}">${feedAvatar}</a><div class="post-identity-copy"><a class="post-name" href="${pref}">${pname}</a><div class="post-meta">${meta}</div></div></div>${title}`;
  const share=theirs?'':`<button type="button" class="pf activity-share" data-share-picture="${a.id}" aria-label="Share a picture of this activity">${svg('share')}</button>`;
  const foot = reactionButtons(a.id,a,false,compact)+`<button type="button" class="pf activity-comments" data-talk="${a.id}" aria-label="Comments, ${a.comments||0}">${svg('comment')}<span class="num"${a.comments?'':' hidden'}>${a.comments?reactionNumber(a.comments):''}</span></button>`+share;
  const media=activityMedia(a,{compact,mapLed:true,deferPhotos:homeFeed});
  const header=`<header class="post-hd post-profile feed-card-header">${head}</header>`;
  const details=`${!theirs && a.lifts && a.lifts.names ? `<p class="post-lifts">${esc(a.lifts.names.slice(0, 4).join(' · '))}${a.lifts.names.length > 4 ? ` +${a.lifts.names.length - 4}` : ''}</p>` : ''}${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}`;
  const summary=`<div class="post-summary"><div class="stats3 feed-stat-row">${theirs ? sharedHeadline(a) : headline(a)}</div>${details}</div>`;
  return `<article class="card post activity-card${media?' post-led':''}" data-href="${href}" data-prefetch="${theirs ? '/api/shared/' : '/api/activities/'}${a.id}" data-activity-month="${activityMonthKey(a.start_time)}">${header}${media?`<div class="activity-picture">${media}</div>`:''}<div class="post-extra">${summary}</div><div class="post-ft">${foot}</div></article>`;
}
function sharedHeadline(a) {   // what a friend shares: no pace when they keep pace to themselves
  const st = [];
  if (a.distance_m) st.push(stat('Distance', U.dist(a.distance_m), U.du()));
  if (a.distance_m && a.shares.pace) { const r = rate(a); if(r.label!=='Time')st.push(stat(r.label, r.v, r.u)); }
  st.push(stat('Time', activityElapsedText(a)));
  if (st.length < 3 && a.ascent_m) st.push(stat('Elevation', U.elev(a.ascent_m), U.eu()));
  return st.slice(0, 3).join('');
}
function postMapMetrics(a) {
  const rows=[];
  if(a.distance_m) rows.push(['Distance',U.dist(a.distance_m),U.du()]);
  const r=rate(a);
  if(a.owner) {
    if(a.distance_m&&a.shares?.pace&&r.label!=='Time') rows.push([r.label,r.v,r.u]);
    rows.push(['Time',activityElapsedText(a),'']);
    if(rows.length<3&&a.ascent_m)rows.push(['Elevation',U.elev(a.ascent_m),U.eu()]);
  } else {
    if(a.distance_m&&r.label!=='Time')rows.push([r.label,r.v,r.u]);
    else if(a.distance_m&&a.avg_hr)rows.push(['Avg HR',Math.round(a.avg_hr),'bpm']);
    if(a.distance_m)rows.push(['Time',activityElapsedText(a),'']);
  }
  if(!rows.length)return '';
  return `<div class="post-map-metrics material" role="group" aria-label="Activity metrics">${rows.slice(0,3).map(([label,value,unit])=>`<div class="post-map-metric"><span class="vh">${esc(label)}</span><b>${esc(value)}${unit?`<i>${esc(unit)}</i>`:''}</b></div>`).join('')}</div>`;
}
// Measure overlays for both the fallback route and the loaded live map. Only card geometry changes trigger a refit.
function activityCardInsets(el) {
  const picture=el.closest('.activity-picture');
  if(!picture)return null;
  const frame=picture.getBoundingClientRect();
  const lower=$$('.leaflet-control-attribution,.media-dots,.map-unavailable:not([hidden])',picture).filter(n=>n.getClientRects().length).map(n=>frame.bottom-n.getBoundingClientRect().top+8);
  const insets={top:12,bottom:Math.ceil(Math.max(24,...lower)),side:$('.media-controls',picture)?64:24};
  return Object.values(insets).every(Number.isFinite)?insets:null;
}
function fitActivityCardMap(el,view) {
  if(!el.closest('.post-led'))return;
  let signature='';
  const fit=()=>{
    if(!el.isConnected)return;
    const inset=activityCardInsets(el);
    if(!inset||el.clientWidth<=inset.side*2||el.clientHeight<=inset.top+inset.bottom)return;
    const next=[el.clientWidth,el.clientHeight,inset.top,inset.bottom,inset.side].join(':');
    if(next===signature)return;signature=next;
    const bounds=view.group.getBounds();view.map.invalidateSize({pan:false});
    if(bounds.isValid())view.map.fitBounds(bounds,{paddingTopLeft:[inset.side,inset.top],paddingBottomRight:[inset.side,inset.bottom],animate:false});
  };
  el._activityMapFit=fit;fit();document.fonts.ready.then(fit);
}
function measureActivityPictures(box){
  $$('.post-led .fmap,.post-led .activity-picture:not(:has(.fmap))',box).forEach(el=>{
    if(headerObservers.has(el))return;
    const measure=()=>{
      if(!el.isConnected)return;
      const inset=activityCardInsets(el);if(!inset)return;
      const picture=el.closest('.activity-picture');
      // Enlarged or unusually long identity text can need more than a square; retain a usable route area.
      picture.style.setProperty('--photo-top',inset.top+'px');picture.style.setProperty('--photo-bottom',inset.bottom+'px');picture.style.setProperty('--photo-side',inset.side+'px');
      picture.style.setProperty('--picture-min-height',Math.ceil(inset.top+inset.bottom+64)+'px');
      el.style.setProperty('--route-top',inset.top+'px');el.style.setProperty('--route-bottom',inset.bottom+'px');el.style.setProperty('--route-side',inset.side+'px');el._activityMapFit?.();
    };
    const observer=new ResizeObserver(measure),picture=el.closest('.activity-picture');
    for(const node of [el,$('.post-meta',el.closest('.activity-card')),$('.media-controls',picture)])if(node)observer.observe(node);
    const changes=new MutationObserver(measure);changes.observe(picture,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
    headerObservers.set(el,{disconnect(){observer.disconnect();changes.disconnect();}});measure();document.fonts.ready.then(measure);
  });
}
// Cheers straight from a feed card: the count changes at once and goes back if the server says no. The comment
// button opens the comments sheet and keeps the card's count in step.
function wireCheers(box) {
  cleanViews();
  measureActivityPictures(box); wireActivityMedia(box); wireCardTaps(box);
  $$('[data-talk]', box).forEach((b) => {SocialData.warm(b,b.dataset.talk);b.onclick = () => {
    commentsSheet(b.dataset.talk, null, (fresh) => {
      if (!b.isConnected) return;
      $('.num',b).textContent = fresh.comments.length?reactionNumber(fresh.comments.length):'';$('.num',b).hidden=!fresh.comments.length;
      b.setAttribute('aria-label',`Comments, ${fresh.comments.length}`);
      const group=b.closest('.post-ft')?.querySelector('[data-reaction-group]');group?._sync?.(fresh);
    });
  };});
  $$('[data-reaction-group]',box).forEach(group=>wireReactionGroup(group,group.dataset.aid));
  $$('[data-share-picture]',box).forEach(button=>button.onclick=()=>sharePicture(button.dataset.sharePicture,null,button));
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
  // Keep the provider's link tappable without the map/card's activity-navigation handler taking over.
  box.addEventListener('click',e=>{if(e.target.closest('.post-led .leaflet-control-attribution a'))e.stopPropagation();},{capture:true});
  const card = (e) => { const c = e.target.closest && e.target.closest('article.post[data-href]'); return c && box.contains(c) && !e.target.closest(CARD_OWN) ? c : null; };
  box.addEventListener('pointerdown', (e) => {
    cardRelease();
    const c = e.target.closest && e.target.closest('.post-link') ? e.target.closest('article.post[data-href]') : card(e);   // the numbers are the card's own link
    if (c && e.isPrimary) { cardPressed = c; c.classList.add('press'); warmDestination(c.dataset.href); }
  }, {passive: true});
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => box.addEventListener(t, cardRelease, {passive: true}));
  box.addEventListener('click', (e) => {
    const c = card(e);
    if (!c || e.defaultPrevented || e.metaKey || e.ctrlKey || String(getSelection && getSelection())) return;
    prepareActivityMapTransition(c,c.dataset.href);
    go(c.dataset.href);
  });
}
const backBtn = (label = 'Me') => `<button class="back" data-back>${svg('back')}${esc(label)}</button>`;
IC.settings = '<path d="m9 3-.6 2.3-2 .9-2.2-.6-1.5 2.6 1.6 1.7-.2 2.2-1.7 1.6 1.5 2.6 2.3-.6 1.8 1.3.5 2.3h3l.6-2.3 2-.9 2.2.6 1.5-2.6-1.6-1.7.2-2.2 1.7-1.6-1.5-2.6-2.3.6-1.8-1.3L12 3z"/><circle cx="10.5" cy="11" r="3"/>';
function wireBack(el, fallback, labelForDestination) {
  el.classList.add('has-back');
  el._backFallback=fallback; // Keep the page's parent if a missing-record response replaces its header.
  const owner=readOwner(),destination=BackNavigation.destination(history.state,location.pathname+location.search,fallback,owner,{historyLength:history.length});
  const label=typeof labelForDestination==='function'?labelForDestination(destination):destination.label;
  $$('[data-back]',el).forEach(button=>{
    button.innerHTML=`${svg('back')}<span${button.classList.contains('back-circle')?' class="vh"':''}>${esc(label)}</span>`;button.setAttribute('aria-label','Back to '+label);
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
  const startDate=new Date(`${w.start}T12:00:00Z`),endDate=new Date(`${w.end}T12:00:00Z`),periodOptions={month:'short',day:'numeric',timeZone:'UTC'};
  if(startDate.getUTCFullYear()!==endDate.getUTCFullYear())periodOptions.year='numeric';
  const period=`${startDate.toLocaleDateString([],periodOptions)} – ${endDate.toLocaleDateString([],periodOptions)}`;
  const distance=w.distance_m>0?U.dist(w.distance_m):'–',distanceUnit=w.distance_m>0?U.du():'';
  const duration=w.seconds>0?U.time(w.seconds):'–';
  const stats=ProgressUI.statRow([
    {label:'Workouts',value:w.workouts||0},
    {label:'Distance',value:distance,unit:distanceUnit},
    {label:'Time',value:duration},
  ]);
  const proteinKnown=Number(w.protein_days_reached)||0,unknown=Number(w.protein_days_unknown)||0;
  const proteinFact=w.protein_target
    ? `<b>${proteinKnown} of 7 days</b> hit your ${r0(w.protein_target)} g protein goal${unknown?` <span class="combined-week-unknown">(${unknown} unknown)</span>`:''}`
    : `<b>Protein goal not set</b> · <span class="combined-week-unknown">Set a goal to track this.</span>`;
  return `<details class="combined-week card"><summary><span class="combined-week-heading"><strong>Your week in review</strong><small>${esc(period)}</small></span><span class="combined-week-toggle"><span class="combined-week-show">Show</span><span class="combined-week-hide">Hide</span>${svg('down')}</span></summary><div class="combined-week-content">${stats}<div class="combined-week-facts"><p class="combined-week-fact">${svg('food')}<span><b>${Number(w.days_logged)||0} of 7 days</b> with food logged</span></p><p class="combined-week-fact">${svg('activity')}<span>${proteinFact}</span></p></div><div class="combined-week-links"><a class="row-link" href="${w.days_logged?'/food?view=overview&from=progress':'/food/describe'}"><span>Food review</span>${svg('chev')}</a><a class="row-link" href="${profileHref(App.me)}"><span>Your workouts</span>${svg('chev')}</a></div></div></details>`;
}
function combinedWeek(box) {
  if(!box)return Promise.resolve();const owner=readOwner();
  return load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;const w=data.week;
    box.innerHTML=combinedWeekHtml(w);
    if(new URLSearchParams(location.search).get('review')==='week')$('details',box).open=true;
  }).catch(()=>{if(box.isConnected&&owner===readOwner()){if(!box.innerHTML)box.innerHTML='<p class="small muted">Your weekly summary couldn’t load.</p>';const b=document.createElement('button');b.className='linkbtn combined-week-retry';b.textContent='Try again.';b.onclick=()=>{b.remove();combinedWeek(box);};box.append(b);}});
}
function workoutEnergy(box,aid) {
  const owner=readOwner();load('/api/activity-food',data=>{
    if(!box.isConnected||owner!==readOwner())return;
    const t=data.today,a=t.items.find(x=>String(x.id)===String(aid));if(!a){box.innerHTML='';return;}
    box.innerHTML=`<a class="card tap workout-energy" href="${esc(t.food_href)}"><h2>Today’s energy</h2><p>${a.kcal<=0?'Calories are unavailable for this workout.':t.day_burn==null?`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Total burn is waiting for resting data.`:t.included_in_day_burn?`Today: +${r0(homeCalories(a.kcal))} kcal burned${a.estimated?' · estimate':''}.`:`${r0(homeCalories(a.kcal))} activity kcal recorded${a.estimated?' · estimate':''}. Your imported total burn takes priority, so these calories are not added again.`}</p>${a.kcal>0?`<p class="small muted">${a.estimated?'Estimated from recorded distance/time and weight.':a.source==='healthkit'?'Recorded calories from the Health app.':a.source==='track'?'Calories from your phone recording.':'Calories from your workout record.'}</p>`:''}<span class="small more-link">See this workout in your food log ›</span></a>`;
  }).catch(()=>{if(box.isConnected&&owner===readOwner())box.innerHTML='<p class="small muted">Today’s energy is unavailable. <a href="/food">Open food log</a></p>';});
}
function workoutSyncStatus(box) {
  if(!Native.on||!box)return;const owner=readOwner();let version=0,wasSyncing=false;
  const valid=()=>box.isConnected&&owner===readOwner();
  const progress=()=>{
    if(!valid()){if(Native.onWorkoutStatus===progress)Native.onWorkoutStatus=null;return;}
    const text=$('[data-sync-progress]',box),summary=$('[data-sync-summary]',box),button=$('[data-sync-now]',box);
    if(text&&Native.syncing)text.textContent=Native.healthProgress||'Syncing…';
    if(summary&&Native.syncing)summary.textContent='Health app · syncing';
    if(button)button.disabled=!!Native.syncing;
    if(Native.syncing)wasSyncing=true;else if(wasSyncing){wasSyncing=false;draw().catch(()=>{});}
  };
  const draw=async()=>{
    const v=++version;const [enabled,status,bg]=await Promise.all([Native.healthOn(),Native.healthStatus(),Native.backgroundStatus()]);
    if(v!==version||!valid())return;
    if(!enabled){box.innerHTML='';return;}
    if(!$('.workout-sync',box))box.innerHTML='<details class="card workout-sync"><summary data-sync-summary></summary><p class="small muted" data-sync-last></p><p class="small muted" data-sync-progress></p><p data-sync-login></p><p data-sync-pending></p><p class="small muted">Garmin Connect can take an hour or more to send workouts to Health and does not send route maps.</p><button class="ghost" data-sync-now>Sync now</button> <a class="linkbtn" href="/track/health">Manage Health permissions</a></details>';
    const dates=[status?.last_success_at,bg?.lastSuccess].filter(Boolean).map(x=>new Date(x)).filter(x=>Number.isFinite(+x));const last=dates.sort((a,b)=>b-a)[0];
    $('[data-sync-summary]',box).textContent='Health app · '+(Native.syncing?'syncing':bg?.pending?`${bg.pending} pending`:status?.error||bg?.error?'needs attention':last?'last synced '+last.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'waiting for first sync');
    $('[data-sync-last]',box).textContent=last?'Last successful sync: '+last.toLocaleString():'';
    $('[data-sync-progress]',box).textContent=Native.syncing?Native.healthProgress:status?.error||bg?.error||'Only workouts already available in the Health app can be imported.';
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
    !Native.on && /iPhone|iPad|iPod/.test(navigator.userAgent) && App.me?.iphone_app ? `<a class="row-link" href="${esc(App.me.iphone_app)}" target="_blank" rel="noopener"><span class="ri c-brand">${svg('track')}</span><span class="grow">Get the Kinetta iPhone app<small class="muted gs-sub">Beta, through Apple’s TestFlight. Records with GPS and brings in workouts from the Health app.</small></span><span class="chev">${svg('chev')}</span></a>` : '',
    !hasHistory ? step('/track/connections', 'watch', 'c-brand', 'Bring in workouts', 'Health app or Garmin · optional') : '',
    Native.on && hasHistory && !healthConnected ? step('/track/health', 'heart', 'c-brand', 'Connect to the Health app · optional', 'Bring in workouts and weight from the Health app') : '',
    !hasHistory ? step('/track', 'track', 'c-green', 'Record an activity', 'A run, ride, walk or lifting session with your phone.') : '',
    !hasHistory ? step('/me/friends?find=1', 'me', 'c-brand', 'Find your friends', "See each other's runs and rides, and send cheers.") : '',
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
    Native.on ? ['health', '/track/health', 'Connect to the Health app', healthConnected] : null,
    !Native.on && /iPhone|iPad|iPod/.test(navigator.userAgent) && me.iphone_app ? ['iphone', me.iphone_app, 'Get the iPhone app', false, true] : null,
    // The photo picker opens in place: the profile page no longer has its own camera badge (30 Oct 2026).
    ['photo', 'photo', 'Add a profile photo', !!me.photo],
    foodUser() ? ['nutrition', '/food/setup', 'Set a nutrition goal', !!me.kcal_target] : null,
    ['friends', '/me/friends?find=1', 'Find friends', (me.friend_count || 0) > 0],
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
// Private insights under the Me card: each row comes from the signed-in person's own activity records.
function meInsightRow(title, value, subtitle, href) {
  return `<a class="me-insight me-insight-row${value ? '' : ' is-link-row'}" href="${esc(href)}"><span class="me-insight-copy"><b>${esc(title)}</b><small>${esc(subtitle)}</small></span>${value ? `<b class="me-insight-value num">${esc(value)}</b>` : ''}${svg('chev')}</a>`;
}
function meInsights(box, s) {
  const owner = readOwner(), live = () => box.isConnected && owner === readOwner();
  const weekSeries = s.chart_weeks || [], now = weekSeries.at(-1), past = weekSeries.slice(0, -1).filter(w => +w.distance_m > 0);
  let weekRow = '';
  if (now && past.length >= 3) {
    // Usual = the average full week among the previous six that had any distance.
    const usual = past.reduce((n, w) => n + (+w.distance_m || 0), 0) / past.length;
    weekRow = meInsightRow('This week', `${U.dist(+now.distance_m || 0, 1)} ${U.du()}`,
      `of ${U.dist(usual, 1)} ${U.du()} usual week`, '/progress?sport=all');
  }
  box.innerHTML = '<section class="card me-insights"><h2>Your insights</h2><div data-insight-rows></div></section>';
  const list = $('[data-insight-rows]', box);
  const paint = () => {
    if (!live()) return;
    list.innerHTML = weekRow || '<p class="small muted me-insights-empty">Your training insights will appear as you build a history.</p>';
  };
  paint();
}
route(/^\/today$/, 'me', async () => go('/me', {replace: true}));
// A person's shared identity leads; the overview below it is private.
async function meOverview(el) {
  const me=App.me;
  el.innerHTML=MeCard.header(me)+
    '<div id="t-required"></div><div id="t-today"></div>'+
    '<div id="t-content"><div id="t-checkin"></div><div id="t-recap"></div><div id="t-goals"></div><div id="t-insights" hidden></div></div>'+
    '<div id="t-start"></div><div id="t-setup"></div>';
  const cardRead=MeCard.mount(el,{viewer:'owner',period:'week',reload:()=>render(),editOnLoad:new URLSearchParams(location.search).get('edit')==='profile'})?.ready||Promise.resolve();
  const milestoneRead=typeof Milestones!=='undefined'?Milestones.mount($('[data-me-milestones]',el),{row:true}):Promise.resolve();
  const setup=$('#t-setup',el),todayRoot=$('#t-today',el),owner=readOwner();
  if(me.needs_email_confirm)$('#t-required',el).innerHTML='<a class="card tap row-link" href="/me/settings?email=add"><span class="ri c-brand">'+svg('mail')+'</span><span class="grow"><b>Confirm your email</b><small class="muted">Your profile stays hidden until you confirm it.</small></span>'+svg('chev')+'</a>';
  const recapRead=typeof Recaps!=='undefined'?Recaps.offer($('#t-recap',el)):Promise.resolve();
  let foodHistory=null,activityHistory=null,activePlan=null,healthConnected=false,checkinStarted=false;
  const drawSetup=()=>{
    if(!el.isConnected||foodHistory===null||activityHistory===null||activePlan===null)return;
    const fresh=!(activityHistory||foodHistory||activePlan);
    $('#t-insights',el).hidden=fresh;
    $('#t-start',el).innerHTML=fresh?getStarted(healthConnected,false):'';
    setup.innerHTML=fresh?'':getStarted(healthConnected,true);
    const photo=$('[data-setup-photo]',setup);if(photo)photo.onclick=()=>profilePhotoSheet(()=>{invalidate('/api/me');keep('/api/me',App.me);render();});
    $$('[data-setup-skip]',setup).forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;const account=readOwner(),next=[...new Set([...(App.me.setup_skipped||[]),button.dataset.setupSkip])];button.disabled=true;
      try{await api('/api/profile',json('PUT',{setup_skipped:next}));if(account!==readOwner())return;App.me.setup_skipped=next;invalidate('/api/me');keep('/api/me',App.me);if(el.isConnected)drawSetup();}
      catch(x){if(account===readOwner()&&button.isConnected){toast(x.message);button.disabled=false;}}
    });
    new Set([...$$('[data-hide-setup]',el),...$$('[data-hide-setup]',setup)]).forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;const account=readOwner();button.disabled=true;button.textContent='Hiding…';
      try{await api('/api/profile',json('PUT',{setup_hidden:true}));if(account!==readOwner())return;App.me.setup_hidden=true;invalidate('/api/me');keep('/api/me',App.me);if(!el.isConnected)return;drawSetup();toast('Setup tips hidden. Restore them in Settings.');}
      catch(x){if(account===readOwner()&&button.isConnected){button.disabled=false;button.textContent=button.closest('.setup-check')?'Hide':'Hide tips';}}
    });
  };
  const zone=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||tz();}catch(e){return tz();}})();
  const localDay=date=>date.toLocaleDateString('en-CA',{timeZone:zone}),dayNow=()=>localDay(new Date());
  const shortDate=()=>{const parts=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short',timeZone:zone}).formatToParts(new Date());return ['weekday','day','month'].map(k=>parts.find(p=>p.type===k)?.value).filter(Boolean).join(' ');};
  const activityLine=rows=>{
    if(rows.length===1){
      const a=rows[0],parts=[],seconds=Number(a.elapsed_s),minutes=Number.isFinite(seconds)&&seconds>0?Math.round(seconds/60):0;
      if(a.distance_m>0)parts.push(U.dist(a.distance_m,1)+' '+U.du());if(minutes>0)parts.push(minutes+' min');
      const name=SPORT_NAMES[a.sport]||a.sport_label||'Workout';
      return {title:[name,...parts].join(' · '),detail:new Date(a.start_time).toLocaleTimeString([], {timeZone:zone,hour:'numeric',minute:'2-digit'}),icon:IC[a.sport]?a.sport:'activity',sport:a.sport||'other',href:a.id?'/activity/'+a.id:'/me/activities'};
    }
    const distance=rows.reduce((sum,a)=>sum+(Number(a.distance_m)||0),0),names=[...new Set(rows.map(a=>SPORT_NAMES[a.sport]||a.sport_label||'Workout'))].join(', ');
    return {title:rows.length+' workouts'+(distance>0?' · '+U.dist(distance,1)+' '+U.du():''),detail:names,icon:'activity',sport:rows[0]?.sport||'other',href:'/me/activities'};
  };
  const valueMarkup=(value,accent=false)=>`<span class="me-today-value${accent?' is-action':''}">${esc(value)}</span>`;
  const planMarkup=(plan,day,{error=false}={})=>{
    const workout=plan?.plan?.race_day&&day>plan.plan.race_day?null:plan?.today_workout;
    let title='Rest day',value='On your plan',sport='run';
    if(workout&&workout.type!=='rest'&&(!workout.day||workout.day===day)){
      title=String(workout.title||'Workout').trim();sport=workout.type||'run';
      const amount=workout.minutes?`${workout.minutes} min`:workout.dist?`${workout.dist} ${plan.plan.unit}`:'';
      if(amount&&title.toLowerCase().endsWith(amount.toLowerCase()))title=title.slice(0,-amount.length).replace(/[\s·–-]+$/,'').trim();
      value=amount||'Plan';
    }
    const icon=IC[sport]?sport:'activity';
    if(error)return `<button type="button" class="me-today-row" data-today-plan data-today-retry><span class="me-today-icon">${svg(icon)}</span><span class="me-today-title">Plan workout</span>${valueMarkup('Retry',true)}${svg('chev','me-today-chevron')}</button>`;
    return `<a class="me-today-row" data-today-plan data-sport="${esc(sport)}" href="/plan"><span class="me-today-icon">${svg(icon)}</span><span class="me-today-title">${esc(title)}</span>${valueMarkup(value)}${svg('chev','me-today-chevron')}</a>`;
  };
  const activityMarkup=({rows,latest,error=false})=>{
    if(error)return `<button type="button" class="me-today-row" data-today-activity data-today-retry><span class="me-today-icon">${svg('activity')}</span><span class="me-today-title">Latest activity</span>${valueMarkup('Retry',true)}${svg('chev','me-today-chevron')}</button>`;
    const items=rows.length?rows:latest?[latest]:[];
    if(!items.length)return '';
    const summary=activityLine(items),title=items.length>1?`${items.length} workouts`:SPORT_NAMES[items[0].sport]||items[0].sport_label||'Activity';
    const value=items.length>1?(summary.title.split(' · ').slice(1).join(' · ')||summary.detail):summary.title.replace(title,'').replace(/^\s*·\s*/, '')||summary.detail;
    const icon=items.length===1&&IC[items[0].sport]?items[0].sport:'activity',href=items.length===1&&items[0].id?`/activity/${items[0].id}`:'/me/activities';
    return `<a class="me-today-row" data-today-activity data-sport="${esc(items[0].sport||'other')}" href="${esc(href)}"><span class="me-today-icon">${svg(icon)}</span><span class="me-today-title">${esc(title)}</span>${valueMarkup(value||summary.detail||'Open')}${svg('chev','me-today-chevron')}</a>`;
  };
  const foodMarkup=(data,day,{error=false}={})=>{
    if(error)return `<button type="button" class="me-today-row" data-today-food data-today-retry><span class="me-today-icon me-today-food-icon">${svg('food')}</span><span class="me-today-title">Nutrition</span>${valueMarkup('Retry',true)}${svg('chev','me-today-chevron')}</button>`;
    const href='/food?d='+encodeURIComponent(day);
    if(!data.entries.length)return `<button type="button" class="me-today-row" data-today-food data-today-add><span class="me-today-icon me-today-food-icon">${svg('food')}</span><span class="me-today-title">Nutrition</span>${valueMarkup('Add',true)}${svg('chev','me-today-chevron')}</button>`;
    const estimate=data.entries.some(e=>e.source==='ai'||e.origin==='ai'||e.ref?.origin==='ai'),unknown=(data.unknown_nutrients?.kcal||0)>=data.entries.length;
    const target=data.targets?.kcal_target,value=unknown?'Unknown':(estimate?'≈ ':'')+r0(homeCalories(data.totals.kcal))+(target!=null?' of '+r0(target):'')+(target==null?' kcal':'');
    return `<a class="me-today-row" data-today-food href="${href}"><span class="me-today-icon me-today-food-icon">${svg('food')}</span><span class="me-today-title">Nutrition</span>${valueMarkup(value)}${svg('chev','me-today-chevron')}</a>`;
  };
  let todaySequence=0,midnightTimer=null,todaySkeletonTimer=null;
  const skeletonRow='<div class="me-today-row me-today-skeleton" aria-hidden="true"><span class="me-today-icon"></span><span class="me-today-title"><i></i></span><span class="me-today-value"><i></i></span></div>';
  const stopTodaySkeleton=()=>{if(todaySkeletonTimer!==null){clearTimeout(todaySkeletonTimer);todaySkeletonTimer=null;}};
  todayRoot.innerHTML='<section class="me-today" aria-label="Today" aria-busy="true"><div class="me-today-head"><h2>Today</h2><span class="me-today-date">'+esc(shortDate())+'</span></div><div class="me-today-list card list" data-today-skeleton hidden>'+skeletonRow+skeletonRow+skeletonRow+'</div></section>';
  todaySkeletonTimer=setTimeout(()=>{todaySkeletonTimer=null;const pending=$('[data-today-skeleton]',todayRoot);if(pending)pending.hidden=false;},200);
  const todayCachePath=day=>`me:today:${day}`;
  const todaySnapshot=day=>{
    const path=todayCachePath(day),saved=App.cache.get(path)?.data||kept(path);if(!saved)return null;
    const safe={...saved};let changed=false;
    if(Array.isArray(safe.foodHistory)){safe.foodHistoryCount=safe.foodHistory.length;delete safe.foodHistory;changed=true;}
    if(Array.isArray(safe.todayRows)){const fields=['id','sport','sport_label','start_time','elapsed_s','distance_m'],rows=safe.todayRows.map(row=>Object.fromEntries(fields.filter(key=>row?.[key]!==undefined).map(key=>[key,row[key]])));if(JSON.stringify(rows)!==JSON.stringify(safe.todayRows)){safe.todayRows=rows;changed=true;}}
    if(changed){App.cache.set(path,{data:safe,at:App.cache.get(path)?.at||0});keep(path,safe);}
    return safe;
  };
  const drawToday=(snapshot,{activityFailed=false,planFailed=false,foodDayFailed=false,todayRowsFailed=false}={},token,day,fresh=false)=>{
    if(!el.isConnected||owner!==readOwner()||token!==todaySequence)return;
    const activities=Array.isArray(snapshot.activities)?snapshot.activities:[];
    const latestActivity=activities[0]||null,latestActivityDay=latestActivity?localDay(new Date(latestActivity.start_time)):null;
    const todayRows=latestActivityDay===day&&Array.isArray(snapshot.todayRows)?snapshot.todayRows:[];
    const plan=snapshot.plan||null,planActive=!!plan?.plan&&(!plan.plan.race_day||day<=plan.plan.race_day);
    const sinceDate=new Date(day+'T12:00:00');sinceDate.setDate(sinceDate.getDate()-29);const since=localDay(sinceDate);
    const recentActivity=!!latestActivity&&latestActivityDay>=since&&latestActivityDay<=day;
    if(!activityFailed)App.me.recentActivityUser=recentActivity;if(!planFailed)App.me.hasActivePlan=planActive;
    const foodHistoryCount=Number.isFinite(snapshot.foodHistoryCount)?snapshot.foodHistoryCount:(Array.isArray(snapshot.foodHistory)?snapshot.foodHistory.length:0);
    const foodData=snapshot.foodData||null,recentFood=!snapshot.foodHistoryFailed?foodHistoryCount>0:!!(App.me.recentFoodUser||App.me.hasFoodHistory);
    if(!snapshot.foodHistoryFailed)App.me.recentFoodUser=foodHistoryCount>0;
    const todayFoodUser=App.me.kcal_target!=null||recentFood||!!foodData?.food_user;
    const planUser=planFailed?App.me.hasActivePlan===true:planActive;
    const activityUser=(activityFailed||todayRowsFailed)?!!App.me.recentActivityUser:recentActivity;
    if(!activityFailed){activityHistory=activities.length>0;App.me.hasActivityHistory=activityHistory;}else if(App.me.hasActivityHistory!=null)activityHistory=!!App.me.hasActivityHistory;
    if(foodData)foodHistory=!!foodData.has_history||foodData.entries?.length>0;
    else if(!snapshot.foodHistoryFailed)foodHistory=foodHistoryCount>0;
    else if(App.me.hasFoodHistory!=null)foodHistory=!!App.me.hasFoodHistory;
    if(foodHistory!==null)App.me.hasFoodHistory=foodHistory;
    activePlan=planFailed?App.me.hasActivePlan===true:planActive;drawSetup();
    const showActivityError=(activityFailed||todayRowsFailed)&&activityUser;
    const showPlanError=planFailed&&planUser,showFoodError=foodDayFailed&&todayFoodUser,hasError=showActivityError||showPlanError||showFoodError;
    if(fresh&&!hasError)App.me.meTodayUpdatedAt=new Date().toISOString();
    const rows=[];
    if(planUser)rows.push(planMarkup(plan,day,{error:showPlanError}));
    if(todayFoodUser)rows.push(foodMarkup(foodData,day,{error:showFoodError}));
    if(activityUser)rows.push(activityMarkup({rows:todayRows,latest:latestActivity,error:showActivityError}));
    const updated=hasError&&App.me.meTodayUpdatedAt?' · updated '+new Date(App.me.meTodayUpdatedAt).toLocaleTimeString([], {timeZone:zone,hour:'numeric',minute:'2-digit'}):'';
    stopTodaySkeleton();
    const markup=rows.length?'<section class="me-today" aria-labelledby="t-today-title"><div class="me-today-head"><h2 id="t-today-title">Today</h2><span class="me-today-date">'+esc(shortDate())+(updated?'<small>'+esc(updated)+'</small>':'')+'</span></div><div class="me-today-list card list">'+rows.join('')+'</div></section>':'';
    if(todayRoot.innerHTML!==markup)todayRoot.innerHTML=markup;
    todayRoot.dataset.loadedDay=day;todayRoot.dataset.loadedToken=String(token);delete todayRoot.dataset.loading;
    $$('[data-today-retry]',todayRoot).forEach(button=>button.onclick=()=>refreshToday());
    const add=$('[data-today-add]',todayRoot);if(add)add.onclick=()=>describeSheet(day,guessMeal());
    if(foodData?.entries?.length){
      if(!checkinStarted){checkinStarted=true;weeklyCheckinCard($('#t-checkin',el),{home:true}).catch(()=>{});}
    }else if(!todayFoodUser||foodData){$('#t-checkin',el).innerHTML='';checkinStarted=false;}
  };
  const refreshToday=async()=>{
    if(!el.isConnected||owner!==readOwner())return;
    const token=++todaySequence,day=dayNow(),cachePath=todayCachePath(day);todayRoot.dataset.loadToken=String(token);todayRoot.dataset.loading='true';
    const cached=todaySnapshot(day);if(cached)drawToday(cached,{},token,day,false);
    const after=encodeURIComponent(new Date(day+'T00:00:00').toISOString());
    const [activityResult,planResult,foodHistoryResult,foodDayResult,todayRowsResult]=await Promise.allSettled([
      api('/api/activities?limit=1'),api('/api/plans/current'),api('/api/food/history?days=30'),api('/api/food/day?d='+encodeURIComponent(day)),api('/api/activities?limit=100&after='+after)
    ]);
    if(!el.isConnected||owner!==readOwner()||token!==todaySequence)return;
    const noPlan=planResult.status==='rejected'&&planResult.reason?.status===404;
    const snapshot={
      activities:activityResult.status==='fulfilled'&&Array.isArray(activityResult.value)?activityResult.value:[],
      plan:planResult.status==='fulfilled'?planResult.value:null,planMissing:noPlan,
      foodHistoryCount:foodHistoryResult.status==='fulfilled'&&Array.isArray(foodHistoryResult.value)?foodHistoryResult.value.length:0,
      foodHistoryFailed:foodHistoryResult.status==='rejected',
      foodData:foodDayResult.status==='fulfilled'?foodDayResult.value:null,
      todayRows:todayRowsResult.status==='fulfilled'&&Array.isArray(todayRowsResult.value)?todayRowsResult.value.map(row=>{const safe={};for(const key of ['id','sport','sport_label','start_time','elapsed_s','distance_m'])if(row?.[key]!==undefined)safe[key]=row[key];return safe;}):[]
    };
    const latest=snapshot.activities[0],latestDay=latest?localDay(new Date(latest.start_time)):null;
    const errors={
      activityFailed:activityResult.status==='rejected',
      planFailed:planResult.status==='rejected'&&!noPlan,
      foodDayFailed:foodDayResult.status==='rejected',
      todayRowsFailed:latestDay===day&&todayRowsResult.status==='rejected'
    };
    drawToday(snapshot,errors,token,day,true);
    const complete=activityResult.status==='fulfilled'&&(planResult.status==='fulfilled'||noPlan)&&foodHistoryResult.status==='fulfilled'&&foodDayResult.status==='fulfilled'&&todayRowsResult.status==='fulfilled';
    if(complete){for(const key of [...App.cache.keys()])if(/^me:today:\d{4}-\d{2}-\d{2}$/.test(key)&&key!==cachePath)App.cache.delete(key);try{for(const key of Object.keys(localStorage))if(key.startsWith('fit.c:me:today:')&&key.slice(6)!==cachePath)localStorage.removeItem(key);}catch(e){/* cache is optional */}App.cache.set(cachePath,{data:snapshot,at:Date.now()});keep(cachePath,snapshot);}
  };
  const onFoodChanged=()=>refreshToday(),onVisible=()=>{if(!document.hidden)refreshToday();};
  const scheduleMidnight=()=>{clearTimeout(midnightTimer);const now=new Date(),next=new Date(now);next.setHours(24,0,0,250);midnightTimer=setTimeout(()=>{refreshToday();scheduleMidnight();},Math.max(1000,next-now));};
  document.addEventListener('food:changed',onFoodChanged);document.addEventListener('visibilitychange',onVisible);window.addEventListener('pageshow',onVisible);
  scheduleMidnight();viewResources.set(todayRoot,()=>{stopTodaySkeleton();clearTimeout(midnightTimer);document.removeEventListener('food:changed',onFoodChanged);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pageshow',onVisible);});
  const profileCachePath='/api/people/'+encodeURIComponent(App.me.login)+'/profile?as_friend=true&preview=friend&limit=1';
  const cached=!!(todaySnapshot(dayNow())&&((typeof screenHit==='function'&&screenHit(profileCachePath))||App.cache.has(profileCachePath)));
  const paint=PaintGate.begin(el.closest('#page')||el,'me',{cached});
  return paint.finish(Promise.allSettled([
    refreshToday(),cardRead,milestoneRead,recapRead,
    load('/api/stats',s=>{if(el.isConnected)meInsights($('#t-insights',el),s);}).catch(()=>{}),
    load('/api/goals',g=>{if(el.isConnected)$('#t-goals',el).innerHTML=g.length?'<div class="card"><h2>Goals<a class="more" href="/me/goals">Edit</a></h2>'+g.map(goalRow).join('')+'</div>':'';}).catch(()=>{})
  ]));
  Promise.resolve(Native.on?(Native.anyHealthOn?Native.anyHealthOn():Native.healthOn()):false).catch(()=>false).then(connected=>{if(!el.isConnected)return;healthConnected=connected;drawSetup();});
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
  return `<a class="icon-btn bell" href="/notifications" aria-label="Notifications${n ? `, ${n} new` : ''}">${svg('bell')}<span class="bell-dot${n > 9 ? ' many' : ''}"${n ? '' : ' hidden'}>${n > 9 ? '9+' : n || ''}</span></a>`; };
// Home keeps the frequent actions together: Kit is inserted beside the title, then Find friends, Notifications and Record/import.
const actTop = () => TopBar({title:'Home',root:true,actions:`<a class="icon-btn home-find-friends" href="/me/friends?find=1&from=home" aria-label="Find friends">${svg('search')}</a>${bellBtn()}<a class="icon-btn" href="/track" aria-label="Record or import a workout">${svg('plus')}</a>`});
route(/^\/activity$/, 'activity', async el=>{
  const q=new URLSearchParams(location.search);
  if(q.get('view')==='mine'){q.delete('view');return go('/me/activities'+(q.toString()?'?'+q:''),{replace:true});}
  if(q.get('view')==='groups')return homeGroups(el);
  const cached=!!(App.cache.get('feed:home')?.data||kept('feed:home'));
  const pending=homeFeed(el),paint=PaintGate.begin(el,'home',{cached});
  return paint.finish(pending);
});
route(/^\/me\/activities$/, 'me', () => go(profileHref(App.me)+location.search+location.hash,{replace:true}));

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
    const tot = a.zones.reduce((x, y) => x + y, 0) || 1, easy = (a.zones[0] + a.zones[1]) / tot, hard = (a.zones[3] + a.zones[4]) / tot;
    out.push(['', easy > .75 ? 'Mostly easy' : easy < .4 ? 'Hard session' : 'Mixed intensity',
      `${Math.round((easy < .4 ? hard : easy) * 100)}% of the time in zones ${easy < .4 ? '4–5' : '1–2'}${a.effort ? ` · effort ${Math.round(a.effort)}` : ''}.`]);
  }
  if (a.vo2max) out.push(['', `VO₂max estimate ${a.vo2max}`, 'From pace (hills adjusted) versus heart rate. Trends matter more than one run.']);
  return out;
}
function sportStats(a, asRows = false) {
  const s = [];
  const add = (l, v, u = '') => { if (v != null && v !== '–') s.push([l, String(v), u]); };
  if (a.sport === 'swim') {
    const r=rate(a); add('Pace', r.label==='Pace'?r.v:null, U.swu());
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
  const elapsed=Number(a.elapsed_s), elapsedKnown=Number.isFinite(elapsed)&&elapsed>0;
  add('Elapsed time', elapsedKnown ? U.time(elapsed) : 'Unavailable');
  // Durations remain separately labelled even when equal or only seconds apart.
  add('Moving time', a.moving_s != null ? activityMovingText(a) : null);
  add('Calories', a.calories ? Math.round(a.calories) : null); add('Temp', a.avg_temp != null ? U.temp(a.avg_temp) : null);
  return asRows ? s : s.map(([label,value,unit]) => stat(label,value,unit)).join('');
}

route(/^\/activity\/(\d+)$/, 'activity', async (el, id) => {
  // Shaped like the page that's coming (map, then the title card and numbers) so nothing appears to rearrange.
  el.innerHTML = `<div class="map-head"><div class="map lead sk" aria-hidden="true"></div><div class="top over">${backBtn('Activity')}</div></div>
    <div class="card d-ph" aria-hidden="true"><div class="sk line short"></div><div class="sk big"></div><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></div>${skel(1)}`;
  applyActivityMapTransition(el,id);
  wireBack(el, '/activity');
  SocialData.prefetch(id);
  const milestoneOwner=readOwner(),milestoneOffers=Milestones.read({activity_id:id}).catch(()=>({items:[]}));let milestoneDraw=0,openedEdit=false;
  const wantsEdit=new URLSearchParams(location.search).get('edit')==='1';
  await load(`/api/activities/${id}`, (a) => {
    const stamp=++milestoneDraw;drawDetail(el,a);
    Milestones.celebrate($('#d-celebration',el),id);
    // An optional celebration must not delay the workout, chart or food-energy summary.
    milestoneOffers.then(data=>{if(el.isConnected&&readOwner()===milestoneOwner&&stamp===milestoneDraw)Milestones.paint($('#d-milestones',el),data,{params:{activity_id:id}});}).catch(()=>{});
    if(!a.owner&&isoDay(new Date(a.start_time))===isoDay(new Date())){const box=document.createElement('div');box.id='workout-food-energy';el.querySelector('[data-pane="overview"]').prepend(box);workoutEnergy(box,id);}
    if(wantsEdit&&!openedEdit&&!a.owner&&Number(a.id)===Number(id)&&el.isConnected&&readOwner()===milestoneOwner&&location.pathname===`/activity/${id}`&&closeActivityEditor()){
      const query=new URLSearchParams(location.search);query.delete('edit');
      if(replacePageAddress(el,location.pathname+(query.size?'?'+query:'')+location.hash)){
        openedEdit=true;editActivity(a);
      }
    }
  }, {maxAge:60000});
});

// Sections (2026-10-12, Ben: "one huge long list"): the map, title and headline numbers stay on top; the rest is
// Charts lead; Details, Splits and Efforts retain the deeper information. ?tab= opens one. Cheers and
// comments are small icons by the title (comments open in a sheet; ?tab=comments opens it), sharing is in Edit, and
// the share button sends a link or a picture (2026-10-12).
const DTABS = [['charts', 'Charts'], ['splits', 'Splits'], ['efforts', 'Efforts'], ['overview', 'Details']];
// Shared activity charts omit owner-only power/cadence even if a fixture or cache contains them.
const activitySamples = (a) => {
  const c = a.chart;
  const series = ['speed','hr','alt', ...(!a.owner ? ['power','cad'] : [])];
  return !!(c && (c.t?.length >= 2 || c.d?.length >= 2) && series.some(k => c[k]?.filter(v => v != null && Number.isFinite(v)).length >= 2));
};
function smoothActivityPace(speed,coords,byDist) {
  const half=(byDist?80.4672:30)/2;
  return speed.map((value,index)=>{
    if(!(value>0.5))return null;
    let sum=0,count=0;
    for(let j=index;j>=0&&coords[index]-coords[j]<=half;j--)if(speed[j]>0.5){sum+=1000/speed[j];count++;}
    for(let j=index+1;j<speed.length&&coords[j]-coords[index]<=half;j++)if(speed[j]>0.5){sum+=1000/speed[j];count++;}
    return count?sum/count:null;
  });
}
function activityChartStack(box,x,rows,{xfmt,xtickfmt=xfmt,onIndex}={}) {
  const width=Math.max(280,box.clientWidth||340),height=120,top=13,bottom=height-20,n=x.length;
  if(n<2){box.innerHTML='<p class="muted">No samples recorded.</p>';return;}
  const px=i=>i/(n-1)*width,rangeText=`${xfmt(x[0])} – ${xfmt(x[n-1])}`;
  const readout=document.createElement('div');readout.className='readout num';
  readout.innerHTML=`<span>${esc(rangeText)}</span><button type="button" class="linkbtn small" aria-label="Reset chart inspection">Reset</button>`;
  box.replaceChildren(readout);const resetButton=$('button',readout),charts=[];resetButton.style.visibility='hidden';
  rows.forEach((r,index)=>{
    const vals=r.vals.map(v=>v==null||!isFinite(v)?null:v),valid=vals.filter(v=>v!=null);if(valid.length<2)return;
    let low=Math.min(...valid),high=Math.max(...valid);if(r.clip){const sorted=[...valid].sort((a,b)=>a-b);low=sorted[Math.floor(sorted.length*.02)];high=sorted[Math.ceil(sorted.length*.98)-1];}
    const pad=Math.max((high-low)*.08,r.name==='Cadence'?5:1e-9);low-=pad;high+=pad;
    const y=v=>top+(r.invert?(Math.min(high,Math.max(low,v))-low)/(high-low):1-(Math.min(high,Math.max(low,v))-low)/(high-low))*(bottom-top);
    const areaParts=[],lineParts=[];let segment=[];
    const flush=()=>{if(!segment.length)return;const line=segment.map(([i,v],j)=>`${j?'L':'M'}${px(i).toFixed(1)},${y(v).toFixed(1)}`).join('');lineParts.push(line);areaParts.push(`${line}L${px(segment.at(-1)[0]).toFixed(1)},${bottom}L${px(segment[0][0]).toFixed(1)},${bottom}Z`);segment=[];};
    vals.forEach((v,i)=>{if(v==null)flush();else segment.push([i,v]);});flush();
    const avg=r.avg!=null?r.avg:valid.reduce((sum,v)=>sum+v,0)/valid.length;
    const initial=r.summaryLabel==='Gain'?`Gain <b>${esc(r.fmt(avg))}</b> ${esc(r.unit||'')}`:`Avg <b>${esc(r.fmt(avg))}</b> ${esc(r.unit||'')}`;
    const chart=document.createElement('div');chart.className='chartbox';chart.dataset.chartIndex=String(index);
    if(index>0)chart.classList.add('activity-chart-separated');
    chart.innerHTML=`<div class="lbl"><span>${esc(r.name)}</span><span data-chart-value>${initial}</span></div><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" tabindex="0" aria-label="${esc(r.name)} chart in ${esc(r.unit||'recorded units')}; use arrow keys to inspect">
      <line class="gl" x1="0" x2="${width}" y1="${top}" y2="${top}"/><line class="gl" x1="0" x2="${width}" y1="${(top+bottom)/2}" y2="${(top+bottom)/2}"/><line class="gl" x1="0" x2="${width}" y1="${bottom}" y2="${bottom}"/>
      <text class="yl activity-chart-y-label" x="4" y="${top+4}">${esc(r.fmt(r.invert?low+pad:high-pad))} ${esc(r.unit||'')}</text><text class="yl activity-chart-y-label" x="4" y="${bottom+4}">${esc(r.fmt(r.invert?high-pad:low+pad))} ${esc(r.unit||'')}</text>
      <path class="sample-area area" d="${areaParts.join('')}" fill="${esc(r.color)}"/><path class="ln" d="${lineParts.join('')}" stroke="${esc(r.color)}"/>
      <text class="yl activity-chart-x-label" x="0" y="${height-2}" text-anchor="start">${esc(xtickfmt(x[0],0,false))}</text><text class="yl activity-chart-x-label" x="${width/2}" y="${height-2}" text-anchor="middle">${esc(xtickfmt(x[Math.floor((n-1)/2)],1,false))}</text><text class="yl activity-chart-x-label" x="${width}" y="${height-2}" text-anchor="end">${esc(xtickfmt(x[n-1],2,true))}</text>
      <line class="xh" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/><circle class="chart-dot" r="4" fill="${esc(r.color)}" stroke="var(--card)" stroke-width="2" visibility="hidden"/></svg>`;
    box.append(chart);charts.push({chart,svg:$('svg',chart),value:$('[data-chart-value]',chart),r,vals,y,initial});
  });
  const select=i=>{
    const xpx=px(i);resetButton.style.visibility='';readout.querySelector('span').textContent=xfmt(x[i]);
    for(const s of charts){s.svg.dataset.selectedIndex=String(i);const cross=$('.xh',s.svg),dot=$('.chart-dot',s.svg),value=s.vals[i];cross.setAttribute('x1',xpx);cross.setAttribute('x2',xpx);cross.setAttribute('visibility','visible');dot.setAttribute('visibility',value==null?'hidden':'visible');if(value!=null){dot.setAttribute('cx',xpx);dot.setAttribute('cy',s.y(value));}s.value.innerHTML=`<b>${value==null?'–':esc(s.r.fmt(value))}</b> ${esc(s.r.unit||'')}`;}
    onIndex?.(i);
  };
  const reset=()=>{readout.querySelector('span').textContent=rangeText;resetButton.style.visibility='hidden';for(const s of charts){s.value.innerHTML=s.initial;$('.xh',s.svg).setAttribute('visibility','hidden');$('.chart-dot',s.svg).setAttribute('visibility','hidden');}};
  resetButton.onclick=reset;
  for(const s of charts){
    const move=e=>{const rect=s.svg.getBoundingClientRect(),t=x[0]+Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*(x[n-1]-x[0]);let lo=0,hi=n-1;while(lo<hi){const mid=(lo+hi)>>1;if(x[mid]<t)lo=mid+1;else hi=mid;}select(Math.max(0,Math.min(n-1,lo)));};
    s.svg.addEventListener('pointerdown',move);s.svg.addEventListener('pointermove',e=>{if(e.buttons||e.pointerType==='touch')move(e);});
    s.svg.addEventListener('keydown',e=>{const current=Number(s.svg.dataset.selectedIndex),i=e.key==='ArrowRight'?Math.min(n-1,(Number.isFinite(current)?current:-1)+1):e.key==='ArrowLeft'?Math.max(0,(Number.isFinite(current)?current:n)-1):e.key==='Home'?0:e.key==='End'?n-1:null;if(e.key==='Escape'){e.preventDefault();reset();}else if(i!=null){e.preventDefault();s.svg.dataset.selectedIndex=String(i);select(i);}});
  }
  resetButton.addEventListener('click',()=>requestAnimationFrame(()=>charts.forEach(s=>s.svg.removeAttribute('data-selected-index'))));
  if(charts.length)charts.at(-1).chart.classList.add('activity-chart-last');
}
function activityTabs(panes) {
  const names = DTABS.filter(([key]) => panes[key]?.trim());
  return `<div class="activity-tabs dtabs" role="tablist" aria-label="Activity sections"${names.length < 2 ? ' hidden' : ''}>${names.map(([key,name]) => `<button type="button" role="tab" id="activity-tab-${key}" aria-controls="activity-pane-${key}" data-dt="${key}"><span class="tab-label">${name}</span></button>`).join('')}</div>`
    + names.map(([key]) => `<section class="dpane" id="activity-pane-${key}" data-pane="${key}" role="tabpanel" aria-labelledby="activity-tab-${key}" hidden>${panes[key]}</section>`).join('');
}
function wireActivityTabs(el, onShow = () => {}) {
  const buttons = $$('[data-dt]', el), first = buttons[0]?.dataset.dt;
  const show = (key, remember = false) => {
    if (!buttons.some(b => b.dataset.dt === key)) key = first;
    buttons.forEach(b => { const active = b.dataset.dt === key; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
    $$('[data-pane]', el).forEach(p => p.hidden = p.dataset.pane !== key);
    onShow(key);
    if (remember) replacePageAddress(el,location.pathname + (key === first ? '' : '?tab=' + key));
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
  const hero = a.lifts && !a.distance_m ? headline(a) : (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Elapsed time', activityElapsedText(a)) + (a.distance_m && r.label!=='Time' ? stat(r.label, r.v, r.u) : '');
  const ins = insights(a);
  const splits = imp() ? a.splits_mi : a.splits_km;
  const more = sportStats(a,true);
  const detailRows = rows => rows.map(([label,value,unit='']) => `<div class="detail-kv"><span>${esc(label)}</span><b>${esc(value)}${unit?` <i>${esc(unit)}</i>`:''}</b></div>`).join('');
  const workoutRows = [
    ...(a.device ? [['Device', a.device]] : []),
    ...(a.gear_name ? [['Gear', a.gear_name]] : []),
    ...more.filter(([label]) => ['Max speed', 'Max HR', 'Moving time'].includes(label)),
  ];
  const detailGroup = (name,content) => content ? `<section class="detail-group">${name ? `<h3>${esc(name)}</h3>` : ''}${content}</section>` : '';
  const pane = {
    overview: `<div class="card activity-detail-list">
      ${a.description ? `<p class="detail-description">${esc(a.description)}</p>` : ''}
      ${detailGroup('',`<div class="detail-kv-list">${detailRows(workoutRows)}</div>`)}
      ${a.route_id && a.route_count > 1 ? '<div id="d-route-compare"></div>' : ''}
      ${a.has_intervals ? detailGroup('Intervals','<div id="activity-interval-history"></div>') : ''}
      ${a.lifts ? detailGroup('Lifting',liftCard(a)) : ''}
      ${a.power_curve && a.power_curve.length ? detailGroup('Power curve',`<table class="tbl detail-power-table"><tbody>${a.power_curve.map(p => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r">${p.watts} W</td></tr>`).join('')}</tbody></table>`) : ''}
      ${ins.length ? detailGroup('Insights',ins.map(([k,t,d])=>{const icon=t.startsWith('New personal record')?'trophy':t==='Hard session'?'flame':'';return `<div class="insight detail-insight"><span class="${icon?'insight-icon':'dot'} ${k}">${icon?svg(icon):''}</span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`;}).join('')) : ''}
      ${a.line && appFeatureEnabled('progress_segments') ? '<div id="d-segments"></div>' : ''}
      ${a.private_note ? detailGroup('Private note',`<p class="detail-note">${esc(a.private_note)}</p>`) : ''}
      ${a.source==='healthkit'&&!a.line&&['run','ride','walk','hike'].includes(a.sport)?'<button class="detail-text-action" type="button" id="d-add-map">Add the map</button>':''}
    </div>`,
    splits: `${splits && splits.length > 1 || a.laps && a.laps.length > 1 ? `<div class="card activity-detail-list">
      ${splits && splits.length > 1 ? splitsTable(a,splits) : ''}
      ${a.laps && a.laps.length > 1 ? `<section class="detail-group"><h3>Laps</h3>${lapsTable(a)}</section>` : ''}
    </div>` : ''}`,
    charts: `${activitySamples(a) ? '<div class="card activity-chart-card"><div id="d-charts" class="activity-charts"></div></div>' : ''}
      ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
`,
    efforts: `${a.efforts && a.efforts.length || a.similar && a.similar.length ? `<div class="card activity-detail-list">
      ${a.efforts && a.efforts.length ? `<section class="detail-group"><h3>Best efforts</h3>${effortsTable(a)}</section>` : ''}
      ${a.similar && a.similar.length ? `<section class="detail-group"><h3>Similar efforts</h3>${similarHtml(a)}</section>` : ''}
    </div>` : ''}`,
  };
  if (!pane.overview.trim()) pane.overview = '<div class="card empty">No additional details were recorded.</div>';
  const bars=ActivityDetail.header(a);el.classList.add('activity-detail');el.dataset.sport=a.sport;
  el.innerHTML=`${a.line?`<div class="detail-map-hero map-head">${activityMedia(a,{mapId:'d-map',detail:true,full:true,compact:true})}${bars.floating}</div>${bars.sticky}`:bars.floating}${ActivityDetail.title(a,hero,{backButton:bars.titleBack})}${!a.line&&a.photos?.length?activityMedia(a,{mapId:'d-map',detail:true,compact:true}):''}${Object.keys(a.summary_overrides||{}).length?'<p class="small muted corrected-note">You edited these numbers. Records and splits are hidden until you restore the recorded values in Edit.</p>':''}${activityTabs(pane)}`;
  applyActivityMapTransition(el,a.id);
  let drawCharts = null;
  wireActivityTabs(el, key => { if (key === 'charts' && drawCharts) { requestAnimationFrame(drawCharts); drawCharts = null; } });
  ActivityDetail.wire(el,a);
  const routeCompare=$('#d-route-compare',el);
  if(routeCompare)load(`/api/routes/${a.route_id}`,route=>{
    if(!routeCompare.isConnected)return;
    const prior=(route.activities||[]).filter(x=>Number(x.id)!==Number(a.id));
    const times=prior.filter(x=>Number(x.elapsed_s)>0).map(x=>Number(x.elapsed_s));
    const average=times.length?times.reduce((sum,n)=>sum+n,0)/times.length:null;
    const best=times.length?Math.min(...times):null;
    const earlierCount=prior.length||Math.max(0,Number(a.route_count)-1);
    const noun=a.sport==='run'?'runs':a.sport==='ride'?'rides':a.sport==='walk'?'walks':'activities';
    let result='Earlier times are available on this route.';
    if(average!=null&&Number(a.elapsed_s)>0){
      const delta=Math.round(Math.abs(average-Number(a.elapsed_s)));
      result=delta<1?'Right around your earlier average':`${dur(delta)} ${Number(a.elapsed_s)<average?'faster':'slower'} than your earlier average`;
    }
    routeCompare.innerHTML=`<section class="detail-route-comparison" aria-label="Route comparison">
      <p class="detail-route-context">Compared with your ${earlierCount} earlier ${noun} on this route</p>
      <div class="detail-route-result"><b>${esc(result)}</b>${best!=null?`<span>Best earlier time · ${esc(dur(best))}</span>`:''}</div>
      <a class="detail-route-action" href="/route/${a.route_id}" data-prefetch="/api/routes/${a.route_id}"><span>Compare</span>${svg('chev')}</a>
    </section>`;
  },{maxAge:60000});
  const stickyTitle=$('.detail-sticky .detail-bar-title',el);
  if(stickyTitle){
    const fitTitle=()=>{if(!stickyTitle.clientWidth)return;for(let size=(innerWidth<=360?17:16);size>=11;size-=.5){stickyTitle.style.fontSize=`${size}px`;if(stickyTitle.scrollWidth<=stickyTitle.clientWidth+1)break;}};
    fitTitle();const titleObserver=new ResizeObserver(fitTitle);titleObserver.observe(stickyTitle.parentElement);viewResources.set(stickyTitle,()=>titleObserver.disconnect());
  }
  const segBox = appFeatureEnabled('progress_segments') ? $('#d-segments', el) : null; if (segBox) lazy(segBox, () => Segments.activityCard(segBox, a.id));   // segment times, routes and segments from this activity (#278)
  const addMap=$('#d-add-map',el);if(addMap&&Native.on)addMap.remove();if(addMap&&!Native.on)addMap.onclick=()=>sheet('Add the original map',`<p>Health summaries may omit GPS. Upload the original Garmin ZIP/FIT to add the map; Kinetta matches sport, time and distance.</p><details><summary>How to export from Garmin</summary><ol><li>Open the matching activity on the Garmin Connect website.</li><li>Choose the settings gear, then <b>Export Original</b>.</li><li>Upload the downloaded ZIP or FIT file here.</li></ol></details><a class="primary wide" href="/track/import?map_for=${a.id}">Upload the original file</a>`,(body,close)=>{body.classList.add('activity-map-help');body.querySelector('a').onclick=()=>close();});
  if(a.has_intervals)globalThis.Intervals?.history($('#activity-interval-history',el),a.id);
  ownSocial(el, a);
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
      const routeBounds=m?.group?.getBounds();
      if(routeBounds?.isValid())m.map.fitBounds(routeBounds,{paddingTopLeft:[16,64],paddingBottomRight:[16,72],maxZoom:17,animate:false});
      if (m && a.photos?.length && !mapBox.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
    }
    catch (e) { console.error('map', e); if (mapBox.isConnected) mapBox.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
  });
  if (a.line) wireMediaMapFull(mapBox, () => mapObj, a.track_lines?.length ? a.track_lines : [a.line], !!a.photos?.length);
  if (activitySamples(a)) {
    const c = a.chart, x = c.d && (c.d[c.d.length - 1] > 100 || !c.t) ? c.d : c.t, byDist = x === c.d;
    const rows = [];
    const sp = c.speed && FOOT.includes(a.sport) && a.sport !== 'swim', sportColor = col(`--${a.sport}`);
    if (c.speed) rows.push(sp ? {name: 'Pace', short: 'Pace', vals: smoothActivityPace(c.speed,x,byDist), fmt: (v) => U.pace(v), unit: U.pu(), color: sportColor, invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: sportColor, clip: true});
    if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s1'), avg: a.avg_hr});
    if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--other'), avg:a.ascent_m, summaryLabel:'Gain'});
    if (!a.owner && c.power) rows.push({name: 'Power', vals: c.power, fmt: (v) => Math.round(v), unit: 'W', color: col('--s4'), clip: true, avg: a.avg_power});
    if (!a.owner && c.cad) { const cadence=c.cad.filter(Number.isFinite),spread=cadence.length?Math.max(...cadence)-Math.min(...cadence):0;if(spread>0.1)rows.push({name: 'Cadence', short: 'Cad', vals: c.cad, fmt: (v) => Math.round(v), unit: a.sport === 'ride' ? 'rpm' : 'spm', color: col('--s3'), clip: true, avg: a.avg_cad}); }
    const box = $('#d-charts', el);
    const draw = () => { if (!box.isConnected) return; activityChartStack(box, x, rows, {
      xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v)),
      xtickfmt: (v,index,last) => byDist ? `${U.dist(v)}${last?' '+U.du():''}` : dur(v),
      onIndex: (i) => {   // move a dot along the map with the crosshair
        if (!mapObj || !mapBox?.isConnected || !pts || !pts.length || !c.d) return;
        const frac = (c.d[i] - c.d[0]) / (c.d[c.d.length - 1] - c.d[0] || 1), p = pts[Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)))];
        if (!marker) marker = mapObj.L.circleMarker(p, {radius: 7, color: '#fff', weight: 2, fillColor: sportColor, fillOpacity: 1}).addTo(mapObj.map);
        else marker.setLatLng(p);
      }});
      const elevation=Array.from(box.querySelectorAll('.chartbox')).find(chart=>chart.querySelector('.lbl > span:first-child')?.textContent==='Elevation');
      if(elevation){const value=elevation.querySelector('[data-chart-value]'),reset=$('.readout button',box),gain=`Gain <b>${esc(U.elev(a.ascent_m||0))}</b> ${esc(U.eu())}`;value.innerHTML=gain;reset.addEventListener('click',()=>requestAnimationFrame(()=>{if(value.isConnected)value.innerHTML=gain;}));}
    };
    let w = 0;
    drawCharts = () => { w = box.clientWidth; draw(); };
    if (!$('[data-pane="charts"]', el).hidden) { requestAnimationFrame(drawCharts); drawCharts = null; }
    const observer = new ResizeObserver(() => { if (box.isConnected && w && box.clientWidth && Math.abs(box.clientWidth - w) > 20) { w = box.clientWidth; draw(); } });
    observer.observe(box); viewResources.set(box, () => observer.disconnect());
  }
}
function splitsTable(a, splits) {
  const foot = FOOT.includes(a.sport);
  const fullSplit = s => Math.abs(s.distance_m - (imp() ? MI : 1000)) < 5;
  const completePaces = splits.filter(fullSplit).map((s) => Number(s.pace_s_per_km)).filter((n) => Number.isFinite(n) && n > 0);
  const paces = splits.map((s) => Number(s.pace_s_per_km)).filter((n) => Number.isFinite(n) && n > 0), fastest = completePaces.length ? Math.min(...completePaces) : null, slowest = paces.length ? Math.max(...paces) : null;
  const hasEl = splits.some((s) => s.elev_m != null), hasHr = splits.some((s) => s.avg_hr);
  return `<div class="tblwrap activity-splits-scroll" role="region" aria-label="Splits table" tabindex="0"><table class="tbl"><thead><tr><th>#</th><th>${foot ? 'Pace ' + U.pu() : 'Speed ' + U.su()}</th><th></th>${foot && splits.some((s) => s.gap_s_per_km) ? `<th class="r">GAP ${U.pu()}</th>` : ''}${hasEl ? `<th class="r">Elev ${U.eu()}</th>` : ''}${hasHr ? '<th class="r">HR bpm</th>' : ''}</tr></thead><tbody>
    ${splits.map((s) => {
      const full = fullSplit(s);
      const pace = Number(s.pace_s_per_km), validPace = Number.isFinite(pace) && pace > 0;
      const best = full && validPace && pace === fastest, slow = validPace && pace === slowest;
      const barWidth = validPace ? slowest === fastest ? 1 : .25 + .75 * (1 - (pace - fastest) / (slowest - fastest)) : 0;
      return `<tr class="${best ? 'best' : ''}"><td>${full ? s.n : U.dist(s.distance_m)}</td>
        <td class="num">${validPace ? foot ? U.pace(pace) : U.speed(1000 / pace) : '–'}</td><td class="barcell"><div class="bar${slow ? ' slow' : ''}${barWidth >= .6 ? ' strong' : ''}" data-w="${barWidth.toFixed(3)}"></div></td>
        ${foot && splits.some((x) => x.gap_s_per_km) ? `<td class="r num">${U.pace(s.gap_s_per_km)}</td>` : ''}
        ${hasEl ? `<td class="r num">${s.elev_m != null ? (s.elev_m > 0 ? '+' : '') + U.elev(s.elev_m) : '–'}</td>` : ''}${hasHr ? `<td class="r num">${s.avg_hr || '–'}</td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>`;
}
function lapsTable(a) {
  const foot = FOOT.includes(a.sport), hasHr = a.laps.some((l) => l.avg_hr);
  return `<table class="tbl"><thead><tr><th>Lap</th><th>${U.du()}</th><th>Time</th><th class="r">${foot ? 'Pace ' + U.pu() : 'Speed ' + U.su()}</th>${hasHr ? '<th class="r">HR bpm</th>' : ''}</tr></thead><tbody>
    ${a.laps.map((l, i) => { const spk = l.distance_m ? (l.moving_s || l.elapsed_s) / l.distance_m * 1000 : null;
      return `<tr><td>${i + 1}</td><td class="num">${U.dist(l.distance_m)}</td><td class="num">${dur(l.moving_s || l.elapsed_s)}</td>
        <td class="r num">${spk ? (foot ? U.pace(spk) : U.speed(1000 / spk)) : '–'}</td>${hasHr ? `<td class="r num">${l.avg_hr ? Math.round(l.avg_hr) : '–'}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
}
function effortsTable(a) {
  return `<div class="detail-efforts-list">${a.efforts.map(e => `<div class="detail-effort-row"><div class="detail-effort-name">${e.rank_then===1?`<span class="effort-record" role="img" aria-label="Personal record">${svg('trophy')}</span>`:''}<span>${esc(e.label)}</span></div>
    <div class="detail-effort-result"><span class="effort-time">${dur(e.elapsed_s)}</span><small>${e.rank_then === 1 ? 'PR' : `#${e.rank_now} all-time`}</small></div></div>`).join('')}</div>
    <a class="detail-text-action" href="/progress?view=records&sport=${esc(a.sport)}">All records ›</a>`;
}
function zonesHtml(z) {
  const tot = z.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zones">${z.map((s, i) => `<div class="zone" data-zone="${i+1}" role="img" aria-label="Zone ${i+1}, ${ZN[i]}, ${dur(s,true)}, ${Math.round(s/tot*100)} percent"><span class="zone-name"><i aria-hidden="true"></i>Z${i + 1}</span><div><div class="zone-track"><div class="bar z${i + 1}" data-w="${(s / tot).toFixed(3)}"></div></div><small class="muted">${ZN[i]}</small></div><span class="num r">${dur(s, true)}<small class="muted">${Math.round(s/tot*100)}%</small></span></div>`).join('')}</div>`;
}
function similarHtml(a) {
  const mineRate = rate(a), foot = FOOT.includes(a.sport);
  const mine = mineRate.label==='Time'?null:foot?Number(a.elapsed_s)/Number(a.distance_m)*1000:Number(a.distance_m)/Number(a.elapsed_s);
  return a.similar.map((s) => {
    const peerRate=rate({...s,sport:a.sport}),p=peerRate.label==='Time'?null:foot?Number(s.elapsed_s)/Number(s.distance_m)*1000:Number(s.distance_m)/Number(s.elapsed_s);
    const diff = mine!=null&&p!=null ? foot?p-mine:mine-p : null;
    const same = diff == null ? false : foot ? Math.abs(diff)<2 : U.speed(Math.abs(diff))<0.1;
    const cmp = diff == null ? '' : same ? 'same pace' : `${diff > 0 ? 'you were' : 'it was'} ${foot ? Math.round(Math.abs(imp() ? diff * MI / 1000 : diff)) + ' s' + U.pu() : U.speed(Math.abs(diff)) + ' ' + U.su()} faster`;
    return `<a class="row-link" href="/activity/${s.id}" data-prefetch="/api/activities/${s.id}"><div><b>${esc(s.name)}</b><br><small class="muted">${esc(fdate(s.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))} · ${U.dist(s.distance_m)} ${U.du()}${s.same_route ? ' · same route' : ''}</small></div>
      <div class="r"><b class="num">${p!=null ? peerRate.v + peerRate.u : '–'}</b><br><small class="muted">${esc(cmp)}</small></div></a>`;
  }).join('');
}

function editActivity(a) {
  // the same grouped kinds as Add an activity (2026-10-13, Ben: Edit only had the nine sports); a kind from an import that
  // isn't in the list (Strava's "Trail Run") stays as the first choice
  const kinds = HAND_KINDS.flatMap(([, list], gi) => list.map(([sp, , lb], i) => ({v: `${gi}.${i}`, sp, lb: lb || null})));
  const cur = kinds.find((k) => k.sp === a.sport && k.lb === (a.sport_label || null)) || (!a.sport_label && kinds.find((k) => k.sp === a.sport && !k.lb));
  const currentKind = cur?.v || 'keep';
  const sportNames = new Map(kinds.map((kind) => {
    const [, list] = HAND_KINDS[Number(kind.v.split('.')[0])];
    return [kind.v, kind.lb || list[Number(kind.v.split('.')[1])][1]];
  }));
  const currentSportName = currentKind === 'keep' ? (a.sport_label || SPORT_NAMES[a.sport] || 'Activity') : sportNames.get(currentKind);
  // "1:34:50", "34:50" or plain minutes ("95") -> seconds; anything else -> NaN
  const clockSecs=(v)=>{const p=v.split(':');if(p.length>3||p.some((x)=>!/^\d+([.,]\d+)?$/.test(x.trim())))return NaN;const n=p.map((x)=>Number(x.trim().replace(',','.')));return p.length===1?n[0]*60:p.length===2?n[0]*60+n[1]:n[0]*3600+n[1]*60+n[2]};
  const summaryFields=[['distance_m','Distance',imp()?'mi':'km',imp()?1609.344:1000],['moving_s','Moving time','h:mm:ss',1],['elapsed_s','Total duration','h:mm:ss',1],['ascent_m','Elevation gain',imp()?'ft':'m',imp()?0.3048:1],['calories','Energy','kcal',1],['avg_hr','Average heart rate','bpm',1],['max_hr','Maximum heart rate','bpm',1]];
  const initial={};
  // times as 1:34:50 like everywhere else in the app; heart rate, energy and climb as whole numbers (2026-10-16)
  const isTime=(key)=>key.endsWith('_s');
  const correctionFields=summaryFields.map(([key,label,unit,scale])=>{const value=a[key]==null?'':isTime(key)?dur(a[key]):key==='distance_m'?String(Math.round(a[key]/scale*100)/100):String(Math.round(a[key]/scale));initial[key]=value;return `<label>${label} (${unit})<input name="summary_${key}" inputmode="${isTime(key)?'text':'decimal'}" value="${value}" placeholder="Not recorded" aria-label="${label} in ${isTime(key)?'hours, minutes and seconds':unit}"></label>${Object.hasOwn(a.summary_overrides||{},key)?`<label class="check"><input type="checkbox" name="restore_${key}"> Use recorded ${label.toLowerCase()}</label>`:''}`}).join('');
  // Keep the existing activity fields and save path; this pass changes the sheet's presentation only.
  let dirty = false, closeEdit = null, asking = false;
  // Closing with unsaved edits asks first in the shared confirm sheet; the editor stays open until Discard.
  const canClose = () => {
    if (!dirty) return true;
    const editor = $('#e-form')?.closest('.sheet'), after = editor?._afterDiscard;
    if (editor) editor._afterDiscard = null;
    if (!asking) { asking = true; confirmSheet('Discard your changes?', {body: 'Your edits to this activity won’t be saved.', action: 'Discard', cancel: 'Keep editing'}).then((ok) => { asking = false; if (ok && closeEdit) { delete a._photoDraft; closeEdit(); if (after) after(); } }); }
    return false;
  };
  sheet('Edit activity', `<form class="form activity-edit-form" id="e-form">
    <div id="e-primary" class="activity-edit-primary">
      <section class="activity-edit-group activity-edit-intro" aria-label="Activity details">
        <textarea class="activity-edit-title" name="name" rows="1" maxlength="200" aria-label="Title">${esc(a.name)}</textarea>
        <textarea class="activity-edit-description" name="description" rows="1" maxlength="10000" placeholder="Add description" aria-label="Description">${esc(a.description || '')}</textarea>
      </section>
      <section class="activity-edit-group activity-edit-choices" aria-label="Activity options">
        <button type="button" class="activity-edit-row" id="e-sport-open"><span>Sport</span><span class="activity-edit-row-value" id="e-sport-value">${esc(currentSportName)}</span>${svg('chev')}</button>
        <input type="hidden" name="kind" value="${esc(currentKind)}">
        <section class="activity-edit-photos" aria-label="Activity photos">
          <div class="activity-edit-photo-heading"><span>Photos</span><span id="e-photo-count" class="activity-edit-photo-count"></span><span id="e-photo-add"></span></div>
          <div id="e-photos"></div>
        </section>
        <button type="button" class="activity-edit-row" id="e-visibility-open"><span>Visibility</span><span class="activity-edit-row-value" id="e-visibility-value">Loading…</span>${svg('chev')}</button>
        <button type="button" class="activity-edit-row" id="e-more-open"><span>More details</span>${svg('chev')}</button>
      </section>
    </div>
    <section id="e-more-view" class="activity-edit-more-view" hidden aria-label="More details">
      <button type="button" id="e-more-back" class="activity-edit-back">${svg('back')}<span>Back</span></button>
      <h3>More details</h3>
      <section class="activity-edit-group activity-edit-more-body">
        <details id="e-summary" class="activity-edit-summary"><summary>Edit distance, time and heart rate<span class="chev">${svg('chev')}</span></summary><div class="form e-fields">${correctionFields}</div></details>
        <label class="activity-edit-gear-row"><span>Gear</span><span class="selbox"><select name="gear"><option value="">None</option></select>${svg('chev')}</span></label>
        <div id="e-private-note" class="activity-edit-section">${optionalText('private_note', 'Private note (only you)', 'Add private note', a.private_note)}</div>
        <label class="check activity-edit-commute"><input type="checkbox" name="commute"${a.commute ? ' checked' : ''}> Commute</label>
      </section>
      <button type="button" class="e-delete" id="e-del">Delete activity</button>
    </section>
    <section id="e-visibility-view" class="activity-edit-visibility" hidden aria-label="Visibility">
      <button type="button" id="e-visibility-back" class="activity-edit-back">${svg('back')}<span>Back</span></button>
      <div id="e-share-fields" class="e-share"></div>
    </section>
  </form>`, async (body, close) => {
    closeEdit = close;
    const editor = body.closest('.sheet'); editor.classList.add('activity-editor');
    const f = $('#e-form', body), btn = editor.querySelector('button[form="e-form"]');
    // Any edit (typing, a choice, a sharing button) means closing asks first; opening the fold-outs doesn't count.
    const touched = () => { dirty = true; };
    f.addEventListener('input', touched); f.addEventListener('change', touched);
    f.addEventListener('activity-photo-draft-change',touched);
    f.addEventListener('click', (e) => { if (e.target.closest('.seg button, #sh-usual')) touched(); });
    wireOptionalText(f);
    const resizeText = field => { field.style.height='auto'; field.style.height=Math.max(field.scrollHeight,48)+'px'; };
    const titleField=f.elements.namedItem('name'),descriptionField=f.elements.namedItem('description');
    [titleField,descriptionField].forEach(field=>{resizeText(field);field.addEventListener('input',()=>resizeText(field));});
    const keepFocusedFieldVisible = field => requestAnimationFrame(() => {
      if(!field.isConnected)return;
      const keyboard = Object.prototype.hasOwnProperty.call(window,'KinettaKeyboard') ? Math.max(0,Number(window.KinettaKeyboard?.height)||0) : Math.max(0,innerHeight-(window.visualViewport?.height||innerHeight)-(window.visualViewport?.offsetTop||0));
      const top=editor.getBoundingClientRect().top+editor.querySelector('header').getBoundingClientRect().height+16;
      const bottom=Math.min(innerHeight-keyboard,window.visualViewport?.offsetTop+window.visualViewport?.height||innerHeight)-16;
      const box=field.getBoundingClientRect();
      if(box.bottom>bottom)editor.scrollBy({top:box.bottom-bottom+16,behavior:'smooth'});
      else if(box.top<top)editor.scrollBy({top:box.top-top-16,behavior:'smooth'});
    });
    f.addEventListener('focusin',e=>{if(e.target.matches('input,textarea'))keepFocusedFieldVisible(e.target);});
    editor.addEventListener('scroll',()=>editor.classList.toggle('activity-edit-scrolled',editor.scrollTop>1),{passive:true});
    const photoBox=$('#e-photos',body),photoCount=$('#e-photo-count',body),photoAdd=$('#e-photo-add',body);
    const drawPhotos=()=>{
      photoStrip(photoBox,a,true,{defer:true,afterChange:drawPhotos});
      const draft=a._photoDraft,photos=draft.photos;
      photoCount.textContent=`${photos.length} of ${PHOTO_MAX}`;
      photoAdd.replaceChildren();
      const add=$('.ph-add',photoBox),file=$('[data-phfile]',photoBox);
      if(add){add.innerHTML=`${svg('plus')}`;add.setAttribute('aria-label',photos.length?'Add another photo':'Add photos');photoAdd.append(add);}
      for(const thumb of $$('.ph-th',photoBox)){
        const index=Number(thumb.dataset.ph),wrap=document.createElement('div');wrap.className='activity-edit-thumb';thumb.replaceWith(wrap);wrap.append(thumb);
        const remove=document.createElement('button');remove.type='button';remove.className='activity-edit-photo-remove';remove.dataset.photoRemove=String(index);remove.setAttribute('aria-label',`Remove photo ${index+1}`);remove.innerHTML=svg('close');
        remove.onclick=()=>{draft.photos.splice(index,1);touched();drawPhotos();};wrap.append(remove);
      }
      if(file)file.onchange=async()=>{
        const files=[...file.files].slice(0,PHOTO_MAX-photos.length);if(!files.length)return;
        if(add)add.disabled=true;
        let done=0;
        for(const selected of files){try{const image=await shrinkPhoto(selected,1600);draft.photos.push({pending:true,preview:image});done++;}catch(error){toast(error.message||"That photo couldn't be added");break;}}
        if(done){touched();drawPhotos();}
      };
    };drawPhotos();
    const sportButton=$('#e-sport-open',body),sportValue=$('#e-sport-value',body),sportField=f.elements.namedItem('kind');
    sportButton.onclick=()=>{
      const options=HAND_KINDS.map(([group,list],gi)=>`<section class="activity-sport-group"><h3>${esc(group)}</h3>${list.map(([,label],i)=>{const value=`${gi}.${i}`;return `<button type="button" class="activity-sport-option" data-sport-option="${value}" role="radio" aria-checked="${sportField.value===value}"><span>${esc(label)}</span>${sportField.value===value?svg('check'):''}</button>`;}).join('')}</section>`).join('');
      const keepOption=sportField.value==='keep'?`<button type="button" class="activity-sport-option" data-sport-option="keep" role="radio" aria-checked="true"><span>${esc(currentSportName)}</span>${svg('check')}</button>`:'';
      sheet('Sport',`<div class="activity-sport-picker" role="radiogroup" aria-label="Choose a sport">${keepOption}${options}</div>`,(picker,done)=>{
        $$('[data-sport-option]',picker).forEach(option=>option.onclick=()=>{
          const value=option.dataset.sportOption;sportField.value=value;sportValue.textContent=value==='keep'?currentSportName:sportNames.get(value)||SPORT_NAMES[kinds.find(kind=>kind.v===value)?.sp]||'Activity';touched();done();
        });
      },{focusContainer:true});
    };
    let saveShare = null;   // sharing (2026-10-12): moved here from the activity page
    (a._social ? Promise.resolve(a._social) : api(`/api/activities/${a.id}/social`))
      .then((s) => { if (f.isConnected) {
        const shareBox=$('#e-share-fields', body);saveShare = shareFields(shareBox, a.id, s); $('#e-visibility-value', body).textContent = VIS_SHORT[s.visibility] || 'Only me';
        $('.vis3',shareBox)?.classList.add('activity-edit-audience');
        $('.ghead',shareBox)?.replaceChildren(document.createTextNode('Who can see it'));
        const checks=()=>$$('[data-vis]',shareBox).forEach(button=>{if(!$('.activity-vis-check',button))button.insertAdjacentHTML('beforeend',`<span class="activity-vis-check" aria-hidden="true">${svg('check')}</span>`);});
        checks();shareBox.addEventListener('click',e=>{if(e.target.closest('[data-vis]'))queueMicrotask(checks);});
      } })
      .catch(() => { $('#e-visibility-value', body).textContent = 'Unavailable'; $('#e-share-fields', body).innerHTML = '<p class="small muted" role="alert">Sharing could not load. Try again later.</p>'; });
    const primary = $('#e-primary', body), visibility = $('#e-visibility-view', body), openVisibility = $('#e-visibility-open', body), backVisibility = $('#e-visibility-back', body), more=$('#e-more-view',body),openMore=$('#e-more-open',body),backMore=$('#e-more-back',body);
    openVisibility.onclick = () => { primary.hidden = true; visibility.hidden = false; backVisibility.focus(); };
    backVisibility.onclick = () => { visibility.hidden = true; primary.hidden = false; openVisibility.focus(); };
    openMore.onclick=()=>{primary.hidden=true;more.hidden=false;backMore.focus();};
    backMore.onclick=()=>{more.hidden=true;primary.hidden=false;openMore.focus();};
    api('/api/gear').then((gear) => { f.gear.insertAdjacentHTML('beforeend', gear.filter((g) => !g.retired || g.id === a.gear_id).map((g) => `<option value="${g.id}"${g.id === a.gear_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')); }).catch(() => {});
    f.onsubmit = async (e) => {
      e.preventDefault();
      const k = kinds.find((x) => x.v === sportField.value);
      // by tag: the sharing choices below include a checkbox also named "description" (it made Save wipe the text)
      const text = (name) => f.querySelector(`textarea[name="${name}"]`).value;
      const body2 = {description: text('description'), private_note: text('private_note'), commute: f.commute.checked};
      if (k) { body2.sport = k.sp; body2.sport_label = k.lb || ''; }
      if (titleField.value !== a.name) body2.name = titleField.value;   // left alone, a name nobody typed follows the kind ("Lunch Yoga")
      if (f.gear.value) body2.gear_id = +f.gear.value; else body2.clear_gear = true;
      body2.restore_summary=[];
      for(const [key,label,,scale] of summaryFields){if(f.elements['restore_'+key]?.checked){body2.restore_summary.push(key);continue}const value=f.elements['summary_'+key].value.trim();if(value===initial[key])continue;const number=value===''?null:isTime(key)?clockSecs(value):Number(value.replace(',','.'))*scale;if(number!==null&&!Number.isFinite(number)){toast(isTime(key)?`Enter ${label.toLowerCase()} like 1:34:50`:'Enter a valid '+label.toLowerCase());return}body2[key]=number}
      if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api(`/api/activities/${a.id}`, json('PATCH', body2));
        if (saveShare) await saveShare();
        await saveActivityPhotoDraft(a);
        invalidate('/api/'); close(); toast('Saved'); render();
      } catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Save'; }
    };
    $('#e-del', body).onclick = async () => {
      if (!await confirmSheet(`Delete “${a.name}”?`, {body: 'This can’t be undone.', action: 'Delete'})) return;
      try { await api(`/api/activities/${a.id}`, {method: 'DELETE'}); invalidate('/api/'); close(); toast('Activity deleted'); go('/activity', {replace: true}); }
      catch (x) { toast(x.message); }
    };
  }, {save: 'e-form', canClose, keyboardAttached:true});
}

// ---------- Share (2026-10-12): send a link to people on Kinetta, or a picture of the route and the key numbers ----------
Object.assign(IC, {share: '<path d="M12 16V3M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'});
// a gear for Settings (2026-10-24): the small icon beside the bell on Me
Object.assign(IC, {settings: '<path d="M18.85 9.79 L21.42 10.17 L21.42 13.83 L18.85 14.21 L18.41 15.28 L19.96 17.37 L17.37 19.96 L15.28 18.41 L14.21 18.85 L13.83 21.42 L10.17 21.42 L9.79 18.85 L8.72 18.41 L6.63 19.96 L4.04 17.37 L5.59 15.28 L5.15 14.21 L2.58 13.83 L2.58 10.17 L5.15 9.79 L5.59 8.72 L4.04 6.63 L6.63 4.04 L8.72 5.59 L9.79 5.15 L10.17 2.58 L13.83 2.58 L14.21 5.15 L15.28 5.59 L17.37 4.04 L19.96 6.63 L18.41 8.72Z"/><circle cx="12" cy="12" r="3"/>'});
const appBase = () => (Native.on && Native.base ? Native.base : location.origin);
// Share = a picture (2026-10-23, Ben: not a link). The route map with the time and pace, or the Kinetta mark when there
// is no GPS. Opens straight away; the full activity and the person's start/end setting load inside the sheet.
function shareOut(a) { sharePicture(a.id, a); }
// One picture for everything (Ben, 2026-10-24): a 4:5 image that works in Messages, Instagram posts and Stories alike,
// so nobody has to choose a size. Share opens the phone's own share sheet.
const activityShareOpening=new WeakSet();
function sharePicture(id, known, origin=null) {
  const owner=readOwner(),path=location.pathname+location.search,context=origin||document.querySelector('#d-body')||root,live=()=>context?.isConnected&&owner===readOwner()&&path===location.pathname+location.search,cached=known&&known.line!==undefined&&known.start_time?known:null;
  if(!live()||activityShareOpening.has(context))return;activityShareOpening.add(context);
  const socialRequest=cached&&cached._social?Promise.resolve(cached._social):api(`/api/activities/${id}/social`).catch(error=>{if(error.status>=500)throw error;return null;});
  void(async()=>{
   try{
    const [activity,social]=await Promise.all([cached||api(`/api/activities/${id}`),socialRequest]);
      if(!live())return;if(cached)cached._social=social;
      const details=social?.details||{},savedTrim=Number(social?.trim_m)||400,mapAllowed=details.map!==false;
      const line=mapAllowed?activity.line:null,hasLine=!!(line&&decode(line).length>1),controls=hasLine?[{key:'hideEnds',label:'Hide where it starts and ends',checked:true}]:[];
      const safe={...activity,line,avg_hr:details.heart_rate?activity.avg_hr:null,calories:details.calories?activity.calories:null};
      const trimValue=state=>state.hideEnds?savedTrim:0;
      const items=[{label:'Card',filename:'kinetta-activity.png',controls,build:state=>routePicture(safe,hasLine?trimValue(state):0,details,{story:true})}];
      const rateInfo=rate(activity),pace=details.pace&&rateInfo.label!=='Time'?`${rateInfo.v} ${rateInfo.u}`:'';
      if(hasLine)items.push({label:'Route',filename:'kinetta-route.png',controls,initial:{ink:'dark'},inkChoices:['dark','light'],build:state=>ShareArt.routeSilhouette({routePoints:trimRoute(decode(line),trimValue(state)),pace,totalTime:activityElapsedText(activity),ink:state.ink})});
      items.push({label:'Stats',filename:'kinetta-stats.png',initial:{ink:'dark'},inkChoices:['dark','light'],build:state=>ShareArt.statsPicture({distance:activity.distance_m?`${U.dist(activity.distance_m)} ${U.du()}`:'',pace,totalTime:activityElapsedText(activity),ink:state.ink})});
      await loadShareArt();if(!live())return;ShareSheet.open({items,title:'Share activity',mode:'tabs'});
   }catch(error){if(live())toast(error.status>=500?'Couldn’t load sharing right now. Tap Share to try again.':error.message||'Couldn’t load this activity. Tap Share to try again.');}
   finally{activityShareOpening.delete(context);}
  })();
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
async function mapPlace(g, pts, box, {hideLabels=false}={}) {      // draws the tiles; returns lat/lon -> canvas x/y. box.top/under: kept clear of the route
  const m = pts.map(([la, lo]) => mercator(la, lo));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of m) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fit = Math.min((box.w - 2 * box.pad) / Math.max((x1 - x0) * TILE, 1e-9), (box.h - 2 * box.pad - box.under - (box.top || 0)) / Math.max((y1 - y0) * TILE, 1e-9));
  const zf = Math.max(3, Math.min(18, Math.log2(fit))), z = Math.min(17, Math.floor(zf)), k = Math.min(2, 2 ** (zf - z)), n = TILE * 2 ** z;
  const cx = (x0 + x1) / 2 * n, cy = (y0 + y1) / 2 * n, mx = box.x + box.w / 2, my = box.y + (box.top || 0) + (box.h - box.under - (box.top || 0)) / 2;
  const tx0 = Math.floor((cx + (box.x - mx) / k) / TILE), tx1 = Math.floor((cx + (box.x + box.w - mx) / k) / TILE);
  const ty0 = Math.max(0, Math.floor((cy + (box.y - my) / k) / TILE)), ty1 = Math.min(2 ** z - 1, Math.floor((cy + (box.y + box.h - my) / k) / TILE));
  const count=await MapTiles.paint(g,pts,box,{z,k,n,cx,cy,mx,my,tx0,tx1,ty0,ty1,zf},{hideLabels});
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
async function routePicture(a, trim, details={}, {story=false,track=true}={}) {
  const pictureOwner=readOwner();
  const W = 1080, H = story?1920:1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), ui = getComputedStyle(document.body).fontFamily, serif = '"Source Serif 4", Georgia, serif';
  try { await Promise.all([document.fonts.load(`600 64px ${serif}`), document.fonts.load(`800 80px ${ui}`)]); } catch (x) { /* system fonts are fine */ }
  const hue = PIC.route, M = 48, PAD = 56, SAFE_TOP = story?250:40, SAFE_BOTTOM = story?250:M;
  // The approved Card includes only activity type, elapsed time, permitted pace and distance.
  const r = rate(a), cells = [];
  cells.push(['Elapsed time', activityElapsedText(a), '']);
  if (details.pace!==false&&a.distance_m && r.label!=='Time') cells.push([r.label, r.v, r.u]);
  if (a.distance_m) cells.push(['Distance', U.dist(a.distance_m), U.du()]);
  // The 56px bottom inset matches the wordmark's top inset after the larger stat row is drawn.
  const CH = 2 * PAD + 215, CY = H - SAFE_BOTTOM - CH, CX = M, CW = W - 2 * M;
  g.fillStyle = PIC.bg; g.fillRect(0, 0, W, H);
  const pts = a.line ? trimRoute(decode(a.line), trim) : [];
  let tiles = 0;
  if (pts.length > 1) {
    // the map fills the picture, a little muted so the blue route is what you see first
    g.filter = 'grayscale(.45) brightness(1.03) contrast(.95)';
    const {tiles: n, P} = await mapPlace(g, pts, {x: 0, y: 0, w: W, h: H, pad: 96, top: SAFE_TOP, under: H - CY - 24},{hideLabels:!story});
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
    if(story&&!tiles)throw Error('The map is unavailable. Try sharing this picture again.');
  } else {
    // no GPS: the Kinetta mark takes the map's place, in blue
    const cy = SAFE_TOP + (CY - SAFE_TOP) / 2;
    g.beginPath(); g.arc(W / 2, cy, 250, 0, Math.PI * 2); g.fillStyle = col('--share-soft'); g.fill();
    drawMark(g, W / 2, cy, 360, hue);
  }
  if(tiles){
    const text=MapTiles.credit(await MapTiles.config());
    g.font=`600 20px ${ui}`;g.textAlign=story?'left':'right';g.textBaseline='alphabetic';
    const creditX=story?M+8:W-M-8;
    const words=text.split(' '),lines=[];let line='';for(const word of words){if(g.measureText(line+' '+word).width>W-2*M&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);
    for(let i=0;i<lines.length;i++){const y=CY-14-(lines.length-1-i)*25;g.lineWidth=5;g.strokeStyle='rgba(255,255,255,.9)';g.strokeText(lines[i],creditX,y);g.fillStyle=PIC.muted;g.fillText(lines[i],creditX,y);}
  }
  // the card: the map behind it, blurred, under a light tint, so it reads as frosted glass rather than a white box
  const card = () => { g.beginPath(); g.roundRect(CX, CY, CW, CH, 40); };
  g.save(); g.shadowColor = 'rgba(15,23,42,.18)'; g.shadowBlur = 36; g.shadowOffsetY = 10; card(); g.fillStyle = 'rgba(255,255,255,.01)'; g.fill(); g.restore();
  const behind = document.createElement('canvas'); behind.width = W; behind.height = H; behind.getContext('2d').drawImage(c, 0, 0);
  g.save(); card(); g.clip(); g.filter = 'blur(18px) saturate(1.2)'; g.drawImage(behind, 0, 0); g.filter = 'none';
  g.fillStyle = tiles ? 'rgba(255,255,255,.58)' : 'rgba(255,255,255,.8)'; g.fillRect(CX, CY, CW, CH); g.restore();
  card(); g.lineWidth = 2; g.strokeStyle = 'rgba(21,25,29,.18)'; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  let y = CY + PAD + 40;
  // the brand, top right of the card
  g.font = `600 30px ${serif}`; const bw = g.measureText('Kinetta').width;
  g.fillStyle = PIC.text; g.fillText('Kinetta', CX + CW - PAD - bw, CY + PAD + 30);
  drawMark(g, CX + CW - PAD - bw - 28, CY + PAD + 20, 38, PIC.brand);
  const kind = (SPORT_NAMES[a.sport] || 'Activity').toUpperCase();
  g.font = `700 24px ${ui}`; g.fillStyle = hue; g.fillText(kind, CX + PAD, y);
  y += 30; g.strokeStyle = PIC.line; g.lineWidth = 2; g.beginPath(); g.moveTo(CX + PAD, y); g.lineTo(CX + CW - PAD, y); g.stroke();
  y += 50; const innerW = CW - 2 * PAD, cws = cells.length === 3 ? [innerW * .4, innerW * .35, innerW * .25] : cells.map(() => innerW / cells.length);
  cells.forEach(([lab, v, u], i) => {
    const x = CX + PAD + cws.slice(0, i).reduce((sum, width) => sum + width, 0), cw = cws[i];
    g.font = `600 48px ${ui}`; g.fillStyle = PIC.muted; g.fillText(lab, x, y);
    let size = cells.length === 3 ? 72 : 80; g.font = `800 ${size}px ${ui}`;
    const fit = cw - 20 - (u ? 56 : 0); while (size > 40 && g.measureText(v).width > fit) { size -= 4; g.font = `800 ${size}px ${ui}`; }
    g.fillStyle = PIC.text; g.fillText(v, x, y + 14 + size);
    if (u) { const vw = g.measureText(v).width; g.font = `600 42px ${ui}`; g.fillStyle = PIC.soft; g.fillText(u.trim(), x + vw + 8, y + 14 + size); }
  });
  return new Promise((res) => c.toBlob(b=>{if(b&&track&&typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',pictureOwner);res(b);}, 'image/png'));
}

// ---------- Matched route ----------
function matchedRouteTrendHeadline(trend, points, foot) {
  const perMonth = trend ? Number(trend.slope_per_day) * 30 : null;
  if (!Number.isFinite(perMonth) || Math.abs(perMonth) < 1) return '';
  let amount;
  if (foot) {
    amount = Math.round(Math.abs(imp() ? perMonth * MI / 1000 : perMonth));
  } else {
    const avgPace = points.length ? points.reduce((sum, point) => sum + point.y, 0) / points.length : null;
    if (!(avgPace > Math.abs(perMonth))) return '';
    amount = Math.abs(1000 / (avgPace + perMonth) - 1000 / avgPace);
  }
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const change = foot ? `${amount} s${U.pu()}` : `${U.speed(amount)} ${U.su()}`;
  if (/^0(?:\.0+)?(?:\s|$)/.test(change)) return '';
  return `${perMonth < 0 ? 'Getting faster' : 'Getting slower'}: about ${change} per month on this route.`;
}
function routeActivityRate(a,sport) {
  const value=rate({...a,sport});return value.label==='Time'?'–':value.v+value.u;
}
route(/^\/route\/(\d+)$/, 'progress', async (el, id) => {
  const back = `<button type="button" class="route-back" data-back aria-label="Back to Routes">${svg('back')}<span>Routes</span></button>`;
  el.innerHTML = `<div class="top route-detail-top">${back}</div>${skel(1)}<div class="sk block"></div>${skel(1)}`;
  wireBack(el, '/progress/routes');
  await load(`/api/routes/${id}`, (r) => {
    const acts = r.activities, foot = FOOT.includes(r.sport) || r.sport === 'walk';
    const pts = acts.filter((a) => a.elapsed_s > 0 && a.distance_m > 0).map((a) => ({x: new Date(a.start_time) / 864e5, y: a.elapsed_s / a.distance_m * 1000, id: a.id}));
    const t = r.pace_trend, e = r.efficiency_trend;
    let headline = matchedRouteTrendHeadline(t, pts, foot);
    if (e && t) { const efficiency=e.slope_per_day===0?'is unchanged':e.slope_per_day>0?'increased':'decreased'; headline = `${headline.replace(/\.$/,'')}; distance per heartbeat ${efficiency}, though conditions can affect that measure.`; }
    const best = acts.find((a) => a.id === r.fastest_id);
    const knownTimes=acts.filter(a=>a.elapsed_s>0),average=knownTimes.length===acts.length&&acts.length?dur(knownTimes.reduce((s,a)=>s+a.elapsed_s,0)/knownTimes.length):'–';
    el.innerHTML = `<div class="top route-detail-top">${back}<button class="route-edit" id="r-edit" aria-label="Edit route">${svg('edit')}<span>Edit</span></button></div>
      <header class="route-detail-heading"><h1>${esc(r.name)}</h1><p>${acts.length} ${acts.length === 1 ? 'activity' : 'activities'} · ${SPORT_NAMES[r.sport] || 'Activity'} · first ${esc(fdate(acts[0].start_time, {month: 'short', year: 'numeric'}))}</p></header>
      ${r.line ? `<div class="map route-detail-map" id="r-map" role="img" aria-label="Route map"><button type="button" class="map-full" aria-label="Full-screen map">${svg('expand')}</button></div>` : ''}
      <section class="route-detail-stats" aria-label="Route summary"><div class="route-detail-hairline"></div><div class="hero">${stat('Best', best&&best.elapsed_s>0?dur(best.elapsed_s):'–')}${stat('Average', average)}${stat('Distance', U.dist(acts[0].distance_m), U.du())}</div><div class="route-detail-hairline"></div></section>
      ${pts.length > 1 ? `<section class="route-detail-chart"><h2>${foot ? 'Pace' : 'Speed'} over time</h2>${headline ? `<p class="route-detail-trend">${esc(headline)}</p>` : ''}<div id="r-chart"></div>
        <div class="route-detail-legend"><span><span class="route-fastest-key" aria-hidden="true">●</span> Fastest</span><span>— Trend</span></div></section>` : ''}
      <section class="route-detail-efforts"><h2>Efforts</h2><div class="inset-group">${[...acts].reverse().map((a) => `<a class="inset-row route-effort-row" href="/activity/${a.id}" data-prefetch="/api/activities/${a.id}">
        <span class="inset-label"><span>${esc(fdate(a.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</span><small>${esc(a.name)}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}${a.avg_temp != null ? ' · ' + U.temp(a.avg_temp) : ''}</small></span>
        <span class="route-effort-result">${a.id === r.fastest_id ? `<span class="route-effort-best" aria-label="Fastest effort">${svg('trophy')}</span>` : ''}<span><b class="num">${a.elapsed_s>0?dur(a.elapsed_s):'–'}</b><small class="num">${routeActivityRate(a,r.sport)}</small></span><span class="chev">${svg('chev')}</span></span></a>`).join('')}</div></section>`;
    wireBack(el, '/progress/routes');
    if (pts.length > 1) requestAnimationFrame(() => dotChart($('#r-chart', el), pts, {yfmt: (v) => (foot ? U.pace(v) : U.speed(1000 / v)), invert: true, trend: t, best: r.fastest_id}));
    if (r.line) lazy($('#r-map', el), () => mapInto($('#r-map', el), [r.line], {sport: r.sport}).then(view => {
      const box=$('#r-map',el);if(!view||!box?.isConnected)return;
      view.map.invalidateSize({pan:false});const bounds=view.group.getBounds();
      if(bounds.isValid())view.map.fitBounds(bounds,{paddingTopLeft:[18,18],paddingBottomRight:[76,72],animate:false});
      wireMediaMapFull(box, () => view, [r.line], false);
    }).catch(() => {}));
    $('#r-edit', el).onclick = () => sheet('Rename route', `<form class="form"><label>Name<input name="name" value="${esc(r.name)}" maxlength="120" enterkeyhint="done"></label>
      <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (b, close) => {
      $('form', b).onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/api/routes/${id}`, json('PATCH', {name: $('input', b).value})); invalidate('/api/'); close(); render(); } catch (x) { toast(x.message); } };
    });
  });
});

// ---------- Progress: home of cards, with each view’s filters inside its first card ----------
const PSPORTS = [['run', 'Runs'], ['ride', 'Rides'], ['walk', 'Walks'], ['hike', 'Hikes'], ['all', 'All sports']];
const RECORD_SPORTS = [...PSPORTS, ['lifting', 'Lifting']];
const PVIEWS = [['fitness', 'Fitness', 'Run fitness', 'flame', 'c-orange'], ['records', 'Records', 'Personal bests', 'trophy', 'c-purple'],
  ['lifting', 'Lifting', 'Every exercise, your bests and its history', 'workout', 'c-brand']];
const PMORE = [['trends', 'Year over year', 'Pace, heart rate and distance, year by year', 'progress', 'c-blue'],
  ['calendar', 'Calendar', 'Training and eating, day by day', 'calendar', 'c-orange'], ['routes', 'Matched routes', 'Compare the loops you have recorded more than once', 'activity', 'c-green'], ['segments', 'Segments', 'Your fixed courses, personal times and leaderboards', 'route', 'c-green'],
  ['heatmap', 'Heatmap', "Everywhere you've been", 'globe', 'c-brand'], ['plan', 'Training plan', '5K to marathon, built around your runs', 'target', 'c-purple']];
const progressFeature = {calendar: 'progress_calendar', segments: 'progress_segments'};
const progressItemEnabled = ([id]) => !progressFeature[id] || appFeatureEnabled(progressFeature[id]);
const PPERIODS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']];
function pSport(q, allowLifting = false) {
  let s = q.get('sport'); if (!s) try { s = localStorage.getItem('fit.psport'); } catch (e) { /* no storage */ }
  return (allowLifting ? RECORD_SPORTS : PSPORTS).some((p) => p[0] === s) ? s : 'run';
}
const pillBtn = (id, ico, name, label) => `<button type="button" class="range-btn" id="${id}" aria-label="${esc(label)}: ${esc(name)}. Change">${ico ? svg(ico) : ''}<span>${esc(name)}</span>${svg('down')}</button>`;
const sportBtn = (cur, options = PSPORTS) => { const k = cur || 'all'; return pillBtn('p-sport', k === 'all' ? 'activity' : k === 'lifting' ? 'workout' : k, k === 'all' ? 'All' : SPORT_NAMES[k] || options.find((p) => p[0] === k)[1], 'Sport'); };
// a sheet listing choices, the current one ticked; pick(key) is called with the chosen one
const pickRows = (rows, cur) => `<div class="pick-list">${rows.map(([k, n, d, ic, c]) => `<button type="button" class="row-link" data-pk="${k}">${ic ? `<span class="ri ${c}">${svg(ic)}</span>` : ''}
  <span class="grow"><span>${esc(n)}</span>${d ? `<small class="muted">${esc(d)}</small>` : ''}</span>${k === cur ? `<span class="tick">${svg('check')}</span>` : ''}</button>`).join('')}</div>`;
function pickSheet(title, html, pick) {
  sheet(title, html, (sb, close) => $$('[data-pk]', sb).forEach((x) => x.onclick = () => { close(); pick(x.dataset.pk); }));
}
function wireSport(el, cur, options = PSPORTS) {
  el.addEventListener('click', e => {
    if (!e.target.closest('#p-sport')) return;
    pickSheet('Sport', pickRows(options.map(([k,n])=>[k,n,'',k==='all'?'activity':k==='lifting'?'workout':k,'c-grey']),cur), k=>{
      if(k!=='lifting')try { localStorage.setItem('fit.psport',k); } catch(e) { /* no storage */ }
      const u=new URLSearchParams(location.search);u.set('sport',k);if(u.has('metric'))u.set('metric',progressMetricForSport(k,u.get('metric')));go(location.pathname+'?'+u,{replace:true});
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
  body._progressFilters = controls;
  body.progressRange = $('#p-rng',controls);
  if (body.progressRange) rangeBar(body.progressRange,getRange(new URLSearchParams(location.search)),new Date().getFullYear());
  const mount = () => {
    if (body._hideProgressFilters) { controls.remove(); return; }
    const first = $(selector, body);
    if (first && controls.parentNode !== first) first.prepend(controls);
  };
  const observer = new MutationObserver(mount); observer.observe(body, {childList:true,subtree:true});
  viewResources.set(body, () => observer.disconnect()); mount();
}
function progressMileageError(body, q) {
  body.innerHTML = '<div class="card empty mileage-error" role="alert"><p class="small muted">Distance totals couldn’t load.</p><button type="button" class="linkbtn" data-mileage-retry>Retry</button></div>';
  const retry = $('[data-mileage-retry]', body);
  retry.onclick = async () => {
    if (retry.disabled) return;
    retry.disabled = true; retry.textContent = 'Loading…';
    try { await pMileage(body, q, {home:true}); }
    catch { if (body.isConnected) progressMileageError(body, q); }
  };
}
function progressPeriods(period) {
  return '<div class="me-period mileage-toggle" role="group" aria-label="Totals period">'+PPERIODS.map(([k,n])=>`<button type="button" data-progress-period="${k}" aria-pressed="${period===k}">${n}</button>`).join('')+'</div>';
}
function progressMetricForSport(sport, metric) {
  if (metric === 'time' || metric === 'distance') return metric;
  if (sport === 'ride') return 'speed';
  if (sport === 'run' || sport === 'walk') return 'pace';
  return 'distance';
}
function progressMetrics(sport, metric) {
  const choices = [['distance', 'Distance'], ['time', 'Moving time']];
  if (sport === 'ride') choices.push(['speed', 'Speed']);
  else if (sport === 'run' || sport === 'walk') choices.push(['pace', 'Pace']);
  return ProgressUI.underlineTabs(choices,metric,{label:'Totals metric',attribute:'progress-metric'});
}
function setProgressView(body, showTable) {
  const chart = $('#m-chart', body), table = $('#m-table', body);
  if (!chart || !table) return false;
  body._showTable = showTable;
  try { localStorage.setItem('fit.ptable', String(showTable)); } catch (e) { /* no storage */ }
  table.hidden = !showTable; chart.hidden = showTable;
  // A chart drawn while hidden (Table restored on load) could not measure its labels; fit them now it is visible.
  const svgChart = $('svg', chart); if (!showTable && svgChart) fitTickLabels(svgChart, svgChart.viewBox.baseVal.width);
  const toggle=$('.totals-view-toggle button',body);
  if(toggle){toggle.dataset.progressView=showTable?'chart':'table';toggle.setAttribute('aria-pressed',String(showTable));toggle.setAttribute('aria-label',showTable?'Show chart':'Show table');toggle.title=showTable?'Show chart':'Show table';toggle.innerHTML=svg(showTable?'chart':'list');}
  return true;
}
function wireProgressPeriods(el) {
  el.addEventListener('click', e => {
    const viewButton=e.target.closest('[data-progress-view]');
    if(viewButton){setProgressView($('#p-home-totals',el),viewButton.dataset.progressView==='table');return;}
    const metricButton=e.target.closest('[data-progress-metric]');if(metricButton){const q=new URLSearchParams(location.search);q.set('metric',metricButton.dataset.progressMetric);go('/progress?'+q,{replace:true});return;}
    const b = e.target.closest('[data-progress-period]'); if (!b) return;
    const q = new URLSearchParams(location.search); q.set('period',b.dataset.progressPeriod);
    go('/progress?'+q, {replace:true});
  });
}
// Kit sits at the far right of the Progress header like other pages; the header is redrawn per view, so add it each time.
function wireProgressFocus(el) { if (typeof KitChat !== 'undefined') KitChat.entry(el, location.pathname); if(typeof Recaps!=='undefined')Recaps.entry(el); }
function nutritionHref(view, params = '') {
  const q=new URLSearchParams(params);q.set('view',view);
  if(location.pathname==='/progress'||new URLSearchParams(location.search).get('from')==='progress')q.set('from','progress');
  return view==='weight'?weightAddress(q):'/food?'+q;
}
function foodProgress(el,q) {
  const requested=q.get('foodview')||'overview',view=NPROG.some(v=>v[0]===requested)?requested:'overview';
  const target=new URLSearchParams(q);target.delete('section');target.delete('foodview');target.set('view',view);target.set('from','progress');
  return go('/food?'+target,{replace:true});
}
function pHead(el, view, filters) {
  const v = [...PVIEWS, ...PMORE.filter(progressItemEnabled)].find(m => m[0] === view);
  el.innerHTML = `<div class="top progress-heading"><h1>${esc(({routes:'Routes',trends:'Years'})[view]||v?.[1]||'Progress')}</h1><div class="acts"><button type="button" class="icon-btn" id="recap-entry" aria-label="Share a progress picture">${svg('share')}</button></div></div><div id="p-body">${skelChart()}</div>`;
  if (view === 'fitness') $('.top',el)?.classList.add('progress-no-kit-entry');
  progressBack(el); progressVisit(view); wireProgressFocus(el);
  if (view === 'fitness') $('.progress-back',el)?.insertAdjacentHTML('beforeend','<span class="back-label">Progress</span>');
  $('#recap-entry',el).onclick=()=>Recaps.open('this_month');
  progressFilters(el, $('#p-body',el), filters, {selector:view === 'heatmap' ? '.heatmap-tools' : '.card'});
  if (['fitness','records','lifting'].includes(view)) {
    const heading=$('.top',el),body=$('#p-body',el),nav=document.createElement('nav');
    heading.classList.add('progress-subpage-heading');
    nav.className='progress-subpage-tabs';
    nav.innerHTML=ProgressUI.underlineTabs(PVIEWS.map(([key,title])=>[key,title]),view,{label:'Progress section',attribute:'progress-section'});
    body.before(nav);
    nav.addEventListener('click',event=>{
      const button=event.target.closest('[data-progress-section]');if(!button)return;
      const q=new URLSearchParams(location.search);q.set('view',button.dataset.progressSection);q.delete('section');
      go('/progress?'+q.toString());
    });
  }
}
const PEXPLORE = [
  ['weight','Weight','Weight history','scale','c-blue'],
  ['heatmap','Heatmap','Activity map','globe','c-brand'],
  ['plan','Training plan','Build a plan','target','c-purple'],
  ['calendar','Calendar','Training days','calendar','c-orange'],
  ['segments','Segments','Best efforts','route','c-green'],
  ['routes','Matched routes','Repeated routes','activity','c-green'],
  ['trends','Year over year','Compare years','progress','c-blue'],
  ['lifting','Lifting','Strength history','workout','c-brand']
];
function progressTeasers(o) {
  const plan = o.plan, next = plan?.next, when = next?.day === o.today ? 'Today' : next?.day === addDays(o.today,1) ? 'Tomorrow' : next ? fdate(next.day+'T12:00',{weekday:'short'}) : '';
  const weight=o.food?.weight_kg,change=o.food?.weight_change_kg,unit=imp()?'lb':'kg';
  return {
    weight:weight!=null?`${U.weight(weight)} ${unit}${change==null?'':change===0?' · steady':` · ${change<0?'−':'+'}${U.weight(Math.abs(change))} ${unit}`}`:null,
    heatmap:o.mapped ? `${o.mapped.toLocaleString()} mapped` : null,
    plan:plan ? next ? `${when} planned` : plan.week ? `Week ${plan.week} of ${plan.weeks}` : 'Plan ready' : null,
    calendar:o.active_days ? `${o.active_days} ${o.active_days===1?'day':'days'}` : null,
    segments:o.segments ? `${o.segments} ${o.segments===1?'best':'bests'}` : null,
    routes:o.routes ? `${o.routes} ${o.routes===1?'repeat':'repeats'}` : null,
    trends:o.years>1 ? `${o.years} years` : null,
    lifting:o.lifting ? o.lifting.kg>0 ? `${U.weight(o.lifting.kg)} ${imp()?'lb':'kg'} best` : 'History' : null
  };
}
function progressTiles(box, overview=null, {ready=false}={}) {
  const teasers=overview?progressTeasers(overview):{};
  const items=[
    ...PVIEWS.filter(([id])=>id!=='lifting').map(([id,title,description,icon,color])=>({id,title,description,icon,color,href:`/progress?view=${id}`})),
    ...PEXPLORE.filter(progressItemEnabled).map(([id,title,description,icon,color])=>({id,title,description,icon,color,href:id==='plan'?'/plan':id==='lifting'?'/progress?view=lifting':'/progress/'+id}))
  ];
  if(foodUser())items.push({id:'food',title:'Food & weight',description:'Food and nutrition',icon:'food',color:'c-green',href:'/food?view=overview&from=progress',teaser:overview?.food?.protein_days==null?null:`${overview.food.protein_days}/7 protein days`});
  box.setAttribute('aria-busy',String(!ready));
  box.innerHTML=items.map(({id,title,description,icon,color,href,teaser})=>{
    const value=teasers[id]||teaser||description;
    const isNew=ready&&!teasers[id]&&!teaser&&!Discovery.hasVisited('progress',id);
    return `<a class="card progress-tile" href="${esc(href)}" data-progress-feature="${esc(id)}"><span class="progress-tile-name"><span class="progress-row-icon ${color}">${svg(icon)}</span><b>${esc(title)}</b><span class="progress-new${isNew?'':' seen'}"${isNew?' aria-label="New feature"':' aria-hidden="true"'}>New</span></span><span class="small muted"${id==='fitness'?' data-progress-fitness':''}${id==='records'?' data-progress-record':''}${id==='food'?' data-progress-food':''}>${esc(value)}</span></a>`;
  }).join('');
}
async function progressHome(el, q) {
  App.progressHome={owner:readOwner(),href:location.pathname+location.search};
  const sport = pSport(q), period = PPERIODS.some(p=>p[0]===q.get('period')) ? q.get('period') : 'week';
  const viewSport=forView(sport,'totals'),metric=progressMetricForSport(viewSport,q.get('metric')||'distance');
  let showTable=false;try{showTable=localStorage.getItem('fit.ptable')==='true';}catch(e){/* no storage */}
  const showTableToggle=metric==='distance'||metric==='time';
  el.innerHTML = `<div class="top progress-heading progress-home-heading"><h1>Progress</h1><div class="acts"><button type="button" class="icon-btn" id="progress-share" aria-label="Share a progress picture">${svg('share')}</button>${bellBtn()}</div></div>
    <div class="progress-home"><div id="p-combined-week"></div><div id="p-home-totals" class="progress-home-totals">${skelChart()}</div>
    <h2 class="sec-head">Explore your progress</h2><div class="progress-grid explore-list progress-inset-list" id="p-explore"></div></div>`;
  const progressReads=[`/api/progress/volume?period=${period}`,'/api/progress/overview','/api/fitness?days=60','/api/activity-food'];
  const cached=progressReads.every(path=>App.cache.has(path)||!!kept(path));
  const paint=PaintGate.begin(el,'progress',{cached});
  wireProgressFocus(el); wireProgressPeriods(el);
  const heading=$('.progress-home-heading',el),compactHeading=()=>{
    heading?.classList.toggle('is-compact',window.scrollY>28);
    const rootSize=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    heading?.classList.toggle('is-large-text',rootSize>=24);
  };
  window.addEventListener('scroll',compactHeading,{passive:true});compactHeading();viewResources.set(el,()=>window.removeEventListener('scroll',compactHeading));
  $('#progress-share',el).onclick=()=>Recaps.open('month');
  Discovery.wire($('#p-explore',el),'progress',{attribute:'data-progress-feature'});
  const totals=$('#p-home-totals',el), grid=$('#p-explore',el); progressTiles(grid);totals._showTable=showTableToggle&&showTable;
  progressFilters(el,totals,`<div class="progress-totals-header">${sportBtn(viewSport)}<div class="totals-view-toggle"><button type="button" data-progress-view="${showTable?'chart':'table'}" ${showTableToggle?'':'hidden'} aria-pressed="${showTable}" aria-label="${showTable?'Show chart':'Show table'}" aria-controls="m-chart m-table" title="${showTable?'Show chart':'Show table'}">${svg(showTable?'chart':'list')}</button></div></div>${progressMetrics(viewSport,metric)}`);
  wireSport(el,viewSport);
  q.set('sport',viewSport);q.set('period',period);if(q.has('metric'))q.set('metric',metric);
  const weekRead=$('#p-combined-week',el)?combinedWeek($('#p-combined-week',el)):null;
  const owner=readOwner(), valid=()=>el.isConnected&&owner===readOwner();
  let fitnessValue=null,recordValue=null;
  const refreshProgressTiles=(overview,ready)=>{
    progressTiles(grid,overview,{ready});
    if(fitnessValue)$('[data-progress-fitness]',el).textContent=fitnessValue;
    if(recordValue)$('[data-progress-record]',el).textContent=recordValue;
  };
  const initial=Promise.allSettled([
    weekRead,
    pMileage(totals,q,{home:true}).catch(()=>{if(valid())progressMileageError(totals,q);}),
    load('/api/progress/overview',o=>{
      if(!valid())return;recordValue=o.record?`${o.record.label} · ${dur(o.record.elapsed_s)}`:null;refreshProgressTiles(o,true);
    }).catch(()=>{if(valid())refreshProgressTiles(null,true);}),
    load('/api/fitness?days=60',f=>{
      if(!valid())return;const last=f.days.at(-1),p=f.predictions[0];
      if(p)fitnessValue=`${p.label} · ${dur(p.seconds)}`;
      else if(last&&f.days.some(d=>d.fitness>0))fitnessValue=`Fitness ${Math.round(last.fitness)} · Form ${Math.round(last.form)}`;
      if(fitnessValue)$('[data-progress-fitness]',el).textContent=fitnessValue;
    }).catch(()=>{})
  ]);
  await paint.finish(initial);
}
// each view takes the sports it can show: the shared choice, mapped to the nearest one it has
const forView = (sport, view) => ({totals: {hike: 'walk'}, records: {all: 'run'}, trends: {hike: 'walk', all: 'run'}, heatmap: {all: ''}}[view] || {})[sport] ?? sport;
route(/^\/progress$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search);
  if (q.get('section') === 'food') return foodProgress(el,q);
  if (!q.has('view')) return progressHome(el,q);
  const v0 = q.get('view') || 'totals';
  if(['totals','mileage'].includes(v0)||!PVIEWS.some(p=>p[0]===v0)&&!PMORE.some(m=>progressItemEnabled(m)&&m[0]===v0)){q.delete('view');return go('/progress'+(q.size?'?'+q:''),{replace:true});}
  if (v0 === 'plan') return go('/plan', {replace: true});
  if (PMORE.some((m) => m[0] === v0)) { q.delete('view'); return go(`/progress/${v0}${q.toString() ? '?' + q : ''}`, {replace: true}); }   // old addresses
  const view = v0 === 'mileage' ? 'totals' : PVIEWS.some((p) => p[0] === v0) ? v0 : 'totals', sport = pSport(q, view === 'records');
  const period = PPERIODS.some((p) => p[0] === q.get('period')) ? q.get('period') : 'week';
  pHead(el, view, view === 'lifting' || view === 'fitness' ? ''
    : sportBtn(forView(sport, view), view === 'records' ? RECORD_SPORTS : PSPORTS) + (view === 'totals' ? progressPeriods(period) : ''));
  wireSport(el, sport, view === 'records' ? RECORD_SPORTS : PSPORTS);
  wireProgressPeriods(el);
  q.set('sport', forView(sport, view)); q.set('period', period);
  await ({totals: pMileage, fitness: pFitness, records: pRecords, lifting: pLifting}[view])($('#p-body', el), q);
});
route(/^\/progress\/segments$/, 'progress', async el => {
  if (!appFeatureEnabled('progress_segments')) return go('/progress', {replace: true});
  pHead(el,'segments','');$('#recap-entry',el).remove();$('.acts',el).insertAdjacentHTML('afterbegin','<a class="linkbtn" href="/segments/new" aria-label="New segment">New</a>');const body=$('#p-body',el),pending=Segments.list(body);
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
// Fitness details share the existing deferred Progress bundle; Me and Progress summaries stay eager.
async function pFitness(body, q) {
  const owner = readOwner(), path = location.pathname + location.search;
  const current = () => !!App.me && owner === readOwner() && body.isConnected && path === location.pathname + location.search;
  try {
    await loadClassicScript(PROGRESS_ROUTE_ASSET);
    if (!current()) return;
    return await pFitnessLoaded(body, q);
  } catch (error) {
    if (current()) throw error;
  }
}
// Records share the existing deferred Progress bundle; route registration and guards stay eager.
async function pRecords(body, q) {
  const owner = readOwner(), path = location.pathname + location.search;
  const current = () => !!App.me && owner === readOwner() && body.isConnected && path === location.pathname + location.search;
  try {
    await loadClassicScript(PROGRESS_ROUTE_ASSET);
    if (!current()) return;
    return await pRecordsLoaded(body, q);
  } catch (error) {
    if (current()) throw error;
  }
}
route(/^\/records\/(\w+)\/([\d.]+)$/, 'progress', async (el, sport, dist) => {
  const owner = readOwner(), path = location.pathname + location.search;
  const current = () => !!App.me && owner === readOwner() && el.isConnected && path === location.pathname + location.search;
  try {
    await loadClassicScript(PROGRESS_ROUTE_ASSET);
    if (!current()) return;
    return await pRecordHistoryLoaded(el, sport, dist);
  } catch (error) {
    if (current()) throw error;
  }
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
const progressWeekLabel = (start) => {
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const short = d => d.toLocaleDateString([], {month: 'short'}), year = new Date().getFullYear();
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const range = sameMonth ? `${short(start)} ${start.getDate()}–${end.getDate()}` : `${short(start)} ${start.getDate()}–${short(end)} ${end.getDate()}`;
  if (start.getFullYear() === end.getFullYear() && end.getFullYear() === year) return range;
  if (start.getFullYear() === end.getFullYear()) return `${range}, ${end.getFullYear()}`;
  return `${short(start)} ${start.getDate()}, ${start.getFullYear()}–${short(end)} ${end.getDate()}, ${end.getFullYear()}`;
};
// Time axis: whole minutes or hours (30m, 1h, 1h 30m) instead of decimal seconds.
const progressTimeStep = (max, n) => {
  const raw = max / n, minutes = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200].find(m => m * 60 >= raw);
  return minutes ? minutes * 60 : niceStep(raw / 3600, 1) * 3600;
};
const progressAxisTime = seconds => U.time(seconds);
const progressPeriodLabel = (d, period) => period === 'week' ? progressWeekLabel(d)
  : period === 'month' ? d.toLocaleDateString([], d.getFullYear() === new Date().getFullYear() ? {month: 'long'} : {month: 'long', year: 'numeric'}) : String(d.getFullYear());
const progressPeriodTick = (d, period) => period === 'week' ? d.toLocaleDateString([], {month: 'short', day: 'numeric'})
  : period === 'month' ? d.toLocaleDateString([], {month: 'short'}) : String(d.getFullYear());
const progressTableLabel = (d, period) => {
  const year = new Date().getFullYear(), suffix = d.getFullYear() === year ? '' : `, ${d.getFullYear()}`;
  return period === 'year' ? String(d.getFullYear()) : period === 'month' ? `${d.toLocaleDateString([], {month: 'short'})}${suffix}` : `${d.toLocaleDateString([], {month: 'short', day: 'numeric'})}${suffix}`;
};
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
  const metric = progressMetricForSport(sport, q.get('metric') || 'distance'), paceMetric = metric === 'pace' || metric === 'speed';
  const R = {from: null, to: null}, scoped = false;   // Totals: the period sets how far back (date ranges live on Year over year)
  let restoreTableFocus=body.contains(document.activeElement)&&document.activeElement?.matches('.totals-view-toggle button');
  body._hideProgressFilters=false;
  body.innerHTML = `<div id="m-body">${skelChart()}</div>`;   // Weeks / Months / Years: the button in the row at the top
  await load(`/api/progress/volume?period=${period}`, (r) => {
    const box = $('#m-body', body); if (!box) return;
    const keys = sport === 'all' ? VKEYS : VKEYS.filter((k) => k.k === sport);
    const by = {}; for (const x of r.rows) { const o = by[x.p] = by[x.p] || {}; o[x.s] = x; }
    if (!r.rows.length) { const empty = metric === 'pace' ? 'average pace' : metric === 'speed' ? 'average speed' : metric;
      body._hideProgressFilters=home;
      if (home) body._progressFilters?.remove();
      box.innerHTML = home ? `<div class="card empty"><p class="small muted">No activities yet. Your ${empty} totals appear here.</p></div>` : `<div class="card empty"><b>No activities yet</b>Your ${empty} totals by week, month and year show up here.${startCta()}</div>`;
      $('.totals-view-toggle',body)?.remove();return; }
    // every period from the first activity to today
    const today = new Date(r.today + 'T12:00'), first = new Date(r.rows[0].p + 'T12:00'), all = [];
    const start = (d) => { const x = new Date(d); if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); else if (period === 'month') x.setDate(1); else { x.setMonth(0); x.setDate(1); } return x; };
    for (let d = start(first); d <= today; ) { all.push(new Date(d)); if (period === 'week') d.setDate(d.getDate() + 7); else if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1); }
    const val = (d, f = 'd') => { const o = by[ymd(d)] || {}; return keys.reduce((s, k) => s + Number((o[k.k] || {})[f] || 0), 0); };
    const metricValue = d => { const distance = val(d, paceMetric ? 'pace_d' : 'd'), time = val(d, paceMetric ? 'pace_t' : 't');
      if (metric === 'distance') return toU(distance);
      if (metric === 'time') return time;
      return metric === 'speed' ? (time > 0 ? distance / time : 0) : (distance > 0 ? time / (distance / 1000) : 0);
    };
    const label = d => progressPeriodLabel(d, period);
    const show = scoped ? all.filter((d) => inRange(R, d.getFullYear())) : period === 'week' ? all.slice(-26) : period === 'month' ? all.slice(-24) : all;
    // A short history still draws normal-width bars (2026-10-18 UI pass): one first week was one bar across the whole
    // chart. Earlier empty periods are added to the chart only; averages and bests still use real periods.
    const minCols = {week: 8, month: 6, year: 4}[period];
    const chartDays = [...show];
    while (!scoped && chartDays.length && chartDays.length < minCols) {
      const d = new Date(chartDays[0]);
      if (period === 'week') d.setDate(d.getDate() - 7); else if (period === 'month') d.setMonth(d.getMonth() - 1); else d.setFullYear(d.getFullYear() - 1);
      chartDays.unshift(d);
    }
    if (!show.length) { box.innerHTML = '<div class="card empty"><b>Nothing in this range</b>Pick other years above.</div>'; return; }
    const pacePeriods = period === 'year' ? all : all.slice(-12), chartPeriods = paceMetric ? pacePeriods : chartDays;
    const shownDays=new Set(show.map(ymd));
    const cols = chartDays.map((d, i) => {
      const prev = chartDays[i - 1], tick = period === 'year' ? progressPeriodTick(d, period)
        : period === 'month' ? (d.getMonth() % 3 === 0 ? progressPeriodTick(d, period) : '')
        : (!prev || prev.getMonth() !== d.getMonth()) ? progressPeriodTick(d, period) : '';
      return {d, label: label(d), tick, tickLabel: progressPeriodTick(d, period), padded:!shownDays.has(ymd(d)), partial: i === chartDays.length - 1, segs: keys.map((k) => ({k: k.k, v: metric === 'time' ? Number(((by[ymd(d)] || {})[k.k] || {}).t || 0) : toU(Number(((by[ymd(d)] || {})[k.k] || {}).d || 0))}))};
    });
    const complete = all.slice(0, -1), recent = scoped ? show.filter((d) => d < all[all.length - 1]) : period === 'week' ? complete.slice(-52) : period === 'month' ? complete.slice(-12) : complete;
    const avg = paceMetric ? null : recent.length ? recent.reduce((s, d) => s + metricValue(d), 0) / recent.length : null;
    const pool = scoped ? show : all, entries = pool.map(d => ({d, value: metricValue(d)})).filter(x => x.value > 0);
    const bestEntry = entries.reduce((b, x) => !b || (paceMetric ? metric === 'speed' ? x.value > b.value : x.value < b.value : x.value > b.value) ? x : b, null);
    const rangeName = scoped ? (R.from === R.to ? String(R.from) : `${R.from || 'start'}–${R.to || 'now'}`) : '';
    const word = {week: 'week', month: 'month', year: 'year'}[period];
    const fmt = metric === 'distance' ? (v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${U.du()}` : metric === 'time' ? U.time : metric === 'speed' ? (v) => `${U.speed(v)} ${U.su()}` : (v) => `${U.pace(v)} ${U.pu()}`;
    const cur = all[all.length - 1], last = all[all.length - 2];
    const defaultPeriodLabel = 'This ' + word;
    const focusTable=restoreTableFocus||(body.contains(document.activeElement)&&document.activeElement?.matches('.totals-view-toggle button'));restoreTableFocus=false;
    const displayValue = value => metric === 'distance' ? value.toFixed(1) : metric === 'time' ? (value ? U.time(value) : '–') : value ? (metric === 'speed' ? U.speed(value) : U.pace(value)) : '–';
    const statUnit = metric === 'distance' ? U.du() : metric === 'pace' ? U.pu() : metric === 'speed' ? U.su() : '';
    let avgValue = avg, bestValue = bestEntry?.value ?? null;
    if (paceMetric) {
      const distance = chartPeriods.reduce((n, d) => n + val(d, 'pace_d'), 0), time = chartPeriods.reduce((n, d) => n + val(d, 'pace_t'), 0);
      avgValue = metric === 'speed' ? (time > 0 ? distance / time : null) : (distance > 0 ? time / (distance / 1000) : null);
      const shown = chartPeriods.map(metricValue).filter(v => v > 0);
      bestValue = shown.length ? metric === 'speed' ? Math.max(...shown) : Math.min(...shown) : null;
    }
    const averageLabel = paceMetric
      ? {week: '12-wk avg', month: '12-mo avg', year: 'Year avg'}[period]
      : {week: 'Weekly avg', month: 'Monthly avg', year: 'Yearly avg'}[period];
    const bestLabel = paceMetric ? `Fastest ${word}` : `Best ${word}`;
    const table = metric === 'distance' || metric === 'time';
    const chartLabel = `${metric === 'speed' ? 'Average speed' : metric === 'pace' ? 'Average pace' : metric === 'time' ? 'Moving time' : 'Distance'} by ${period}`;
    const totalStats=home?ProgressUI.statRow([
      {label:defaultPeriodLabel,value:displayValue(metricValue(cur)),unit:statUnit},
      {label:averageLabel,value:avgValue==null?'–':displayValue(avgValue),unit:statUnit},
      {label:bestLabel,value:bestValue==null?'–':displayValue(bestValue),unit:statUnit}
    ]).replace('class="stat-row"','class="stat-row progress-total-stats"'):`<div class="stats3 progress-total-stats">${stat(defaultPeriodLabel,displayValue(metricValue(cur)),statUnit)}${avgValue==null?'':stat(averageLabel,displayValue(avgValue),statUnit).replace('class="stat"','class="stat progress-average"')}${stat(bestLabel+(scoped?' (range)':''),bestValue==null?'–':displayValue(bestValue),statUnit)}</div>`;
    const footer=home?`<div class="progress-total-footer"><span class="progress-total-caption">${esc(`${label(cur)} · ${fmt(metricValue(cur))}`)}</span>${ProgressUI.rangeText(PPERIODS,period,{label:'Totals range',attribute:'progress-period'})}</div>`:'';
    box.innerHTML = `<div class="card progress-totals-card">${totalStats}
        ${paceMetric ? home?'':`<p class="small muted progress-pace-window">${period === 'week' ? 'Weekly averages · last 12 weeks' : period === 'month' ? 'Monthly averages · last 12 months' : 'Yearly averages'}</p>` : home?'':`<p class="small muted">${last ? `Last ${word}: ${esc(fmt(metricValue(last)))} · ` : ''}best ${esc(label(bestEntry?.d || cur).replace('Week of ', 'week of '))}</p>`}
        <div class="totals-display"><div id="m-chart"${body._showTable?' hidden':''}></div>${table?`<div id="m-table" class="tbl-wrap"${body._showTable?'':' hidden'}><table class="tbl"><thead><tr><th>${period === 'week' ? 'Week of' : period === 'month' ? 'Month' : 'Year'}</th><th class="r">Distance ${U.du()}</th><th class="r">Moving time</th><th class="r">Workouts</th><th class="r">Climb ${U.eu()}</th></tr></thead><tbody>
        ${[...show].reverse().map((d) => `<tr><td>${esc(progressTableLabel(d, period))}</td>
          <td class="r num">${toU(val(d)).toFixed(1)}</td><td class="r num">${val(d, 't') ? U.time(val(d, 't')) : '–'}</td><td class="r num">${val(d, 'n')}</td><td class="r num">${val(d, 'a') ? U.elev(val(d, 'a')) : '–'}</td></tr>`).join('')}</tbody></table></div>`:''}</div>${footer}</div>`;
    requestAnimationFrame(() => {
      const toggle=$('.totals-view-toggle button',body);if(toggle)toggle.hidden=!table;
      if (paceMetric) {
        const points = chartPeriods.map(d => { const value = metricValue(d); return value > 0 ? {x: new Date(d).getTime() / 864e5, y: value, value, periodLabel: period === 'week' ? `Week of ${d.getDate()} ${d.toLocaleDateString([], {month: 'short'})}` : label(d), current: period === 'week' && ymd(d) === ymd(cur)} : null; }).filter(Boolean);
        const chart = $('#m-chart', box);
        dotChart(chart, points, {yfmt: v => metric === 'speed' ? U.speed(v) : U.pace(v), invert: metric === 'pace', line: true, height: home ? 150 : 180});
        const svgChart = $('#m-chart svg', box);
        if (svgChart) {
          svgChart.setAttribute('role', 'group');
          svgChart.setAttribute('aria-label', `${chartLabel}; ${period === 'week' ? 'last 12 weeks' : period === 'month' ? 'last 12 months' : 'all recorded years'}. Select a point to inspect its value.`);
          const dots = [...svgChart.querySelectorAll('.dotp')];
          if (dots.length) {
            const readout = document.createElement('div');
            readout.className = 'readout num progress-total-readout progress-dot-readout';
            readout.setAttribute('role', 'status'); readout.setAttribute('aria-live', 'polite'); readout.setAttribute('aria-atomic', 'true');
            readout.hidden = true;
            chart.append(readout);
            let selected = null;
            const show = index => {
              const point = index == null ? null : points[index];
              readout.hidden = !point;
              readout.innerHTML = point ? `<span>${point.periodLabel} · <b>${esc(displayValue(point.value))}</b>${statUnit ? ` ${esc(statUnit)}` : ''}</span>` : '';
              dots.forEach((dot, i) => {
                dot.setAttribute('aria-pressed', String(i === selected));
                dot.setAttribute('aria-label', `${points[i].periodLabel}: ${displayValue(points[i].value)}${statUnit ? ` ${statUnit}` : ''}`);
                dot.setAttribute('r', i === selected ? '7' : (dot.dataset.baseRadius || dot.getAttribute('r')));
              });
            const ringDot = dots[selected ?? points.findIndex(point => point.current)], ring = svgChart.querySelector('.progress-current-dot-ring'); if (ringDot && ring) { ring.setAttribute('cx', ringDot.getAttribute('cx')); ring.setAttribute('cy', ringDot.getAttribute('cy')); svgChart.append(ring); }
            };
            const choose = index => { selected = selected === index ? null : index; show(selected); };
            dots.forEach((dot, i) => {
              dot.dataset.baseRadius = dot.getAttribute('r');
              dot.setAttribute('role', 'button'); dot.setAttribute('tabindex', '0'); dot.setAttribute('aria-pressed', 'false');
              if (points[i].current) {
                dot.classList.add('progress-current-dot');
                dot.setAttribute('r', '5.5'); dot.dataset.baseRadius = '5.5';
                const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                ring.setAttribute('class', 'progress-current-dot-ring');
                ring.setAttribute('cx', dot.getAttribute('cx')); ring.setAttribute('cy', dot.getAttribute('cy'));
                ring.setAttribute('r', '8'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'var(--accent)');
                ring.setAttribute('stroke-width', '1.5'); ring.setAttribute('pointer-events', 'none'); ring.setAttribute('aria-hidden', 'true');
                svgChart.append(ring);
              }
              dot.onkeydown = e => {
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? dots.length - 1 : e.key === 'ArrowRight' ? Math.min(dots.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : null;
                if (next != null) { e.preventDefault(); dots[next].focus({preventScroll: true}); }
                else if (['Enter', ' '].includes(e.key)) { e.preventDefault(); choose(i); }
                else if (e.key === 'Escape') { e.preventDefault(); selected = null; show(null); }
              };
            });
            const nearest = e => {
              const matrix = svgChart.getScreenCTM(), rect = svgChart.getBoundingClientRect();
              if (!matrix || !rect.width) return null;
              const pointer = svgChart.createSVGPoint(); pointer.x = e.clientX; pointer.y = e.clientY;
              const local = pointer.matrixTransform(matrix.inverse()), radius = 22 * svgChart.viewBox.baseVal.width / rect.width;
              let best = null;
              dots.forEach((dot, i) => {
                const dx = local.x - Number(dot.getAttribute('cx')), dy = local.y - Number(dot.getAttribute('cy')), distance = Math.hypot(dx, dy);
                if (distance <= radius && (!best || distance < best.distance)) best = {index: i, distance};
              });
              return best?.index ?? null;
            };
            svgChart.addEventListener('click', e => {
              const target = e.target.closest?.('.dotp[role="button"]'), index = target ? dots.indexOf(target) : nearest(e);
              if (index != null && index >= 0) choose(index);
              if (target && document.activeElement === target) target.blur();
            });
            show(null);
          }
        }
      } else {
        periodBars($('#m-chart', box), cols, {keys, fmt, yfmt: metric === 'time' ? progressAxisTime : v => String(+v.toFixed(2)), step: metric === 'time' ? progressTimeStep : undefined, axisUnit:metric==='distance'?U.du():'', yTicks:2, avg, avgLabel: period === 'year' ? 'Yearly average' + (scoped ? ` (${rangeName})` : '') : `Average ${period} (${scoped ? rangeName : 'last 12 months'})`, avgLineLabel: avg>0?`avg ${fmt(avg)}`:'', ariaLabel:`${chartLabel}. Select a bar for its period total.`, readoutHint:'', height:home?160:190, distance:sport==='all'&&metric==='distance', inlineSelection:true});
      }
      if(focusTable&&body.isConnected&&document.activeElement===document.body)$('.totals-view-toggle button',body)?.focus({preventScroll:true});
    });
  });
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
      try { const image = await shrinkPhoto(f, 1024); me.photo = (await api('/api/me/photo', json('PUT', {image}))).photo; syncMeTabPhoto(); close(); toast('Photo saved'); done(); }
      catch (x) { toast(x.message || "That photo couldn't be opened"); pick.disabled = false; pick.textContent = 'Choose a photo'; }
    };
    if (rm) rm.onclick = async () => {
      rm.disabled = true;
      try { await api('/api/me/photo', {method: 'DELETE'}); me.photo = null; syncMeTabPhoto(); close(); done(); }
      catch (x) { toast(x.message); rm.disabled = false; }
    };
  });
}
// Questions, problems and privacy requests (2026-10-16): the same address as the website and privacy policy.
const SUPPORT_EMAIL = 'feedback@kinetta.app';
route(/^\/me$/, 'me', async (el) => {
  if (new URLSearchParams(location.search).get('setup') === 'body') return go('/me/settings?setup=body', {replace:true});
  const me = App.me, ch = `<span class="chev">${svg('chev')}</span>`;
  const friendsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5M15 15c2.6 0 4.6 1.6 5.5 4.5"/></svg>';
  const row = (tag, attrs, ico, c, label, val = '') => `<${tag} class="row-link" ${attrs}><span class="ri ${c}">${ico==='people'?friendsIcon:svg(ico)}</span><span class="grow">${label}</span>${val ? `<span class="val">${val}</span>` : ''}${ch}</${tag}>`;
  el.innerHTML = `<div id="me-overview"></div>
    <div class="card list me-tools">${row('a', 'href="/me/friends"', 'people', 'c-brand', 'Friends', Number(me.friend_count||0).toLocaleString('en-US'))}${row('a', `href="${profileHref(App.me)}"`, 'activity', 'c-brand', 'Profile<small class="muted">Your activities and achievements</small>')}${row('a', 'href="/plan"', 'calendar', 'c-brand', 'Training plan')}${foodUser() ? row('a', 'href="/food/setup"', 'food', 'c-green', `Nutrition goal<small class="muted">${me.kcal_target ? `${Math.round(me.kcal_target).toLocaleString('en-US')} kcal · ${me.protein_target ? Math.round(me.protein_target).toLocaleString('en-US') + ' g protein' : 'review'}` : 'Optional setup'}`) : ''}${row('a', 'href="/me/gear"', 'shoe', 'c-brand', 'Shoes & bikes')}</div>
    <section class="me-help"><h2 class="sec-head">Help</h2><div class="card list me-help-tools">${row('a', 'href="/me/explore"', 'search', 'c-brand', 'Explore Kinetta')}</div></section>`;
  el.insertAdjacentHTML('beforeend','<div id="me-challenges"></div>');Challenges.mount($('#me-challenges',el),{me:true});
  return meOverview($('#me-overview', el)).catch((e) => showError($('#me-overview', el), e));
});


// time zones the phone knows (days, weeks and "today" follow yours); the current one stays listed even if unknown
function tzOptions(cur) {
  let list = []; try { list = Intl.supportedValuesOf('timeZone'); } catch (e) { /* older browser */ }
  if (cur && !list.includes(cur)) list = [cur, ...list];
  return list.map((z) => `<option value="${esc(z)}"${z === cur ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('');
}

// ---------- account (name, username, password) + people (admin) ----------
function accountSheet(field) {
  const me = App.me, owner=readOwner(), isName = field === 'name';
  sheet(isName ? 'Your name' : 'Username', `<form class="form" id="ac">
    <label>${isName ? 'Name' : 'Username'}<input name="v" value="${esc(isName ? me.name : me.login)}" maxlength="${isName ? 60 : 30}"
      ${isName ? 'autocomplete="name"' : 'autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"'} enterkeyhint="done" required></label>
    <p class="small muted">${isName ? 'Shown at the top of your screens.' : me.email ? 'Your @name: how friends find and mention you. Change it whenever you like; you log in with your email. Lowercase letters, numbers or _.' : 'Your @name, and what you type to log in until you add an email. Change it whenever you like. Lowercase letters, numbers or _.'}</p>
    <div class="actions"><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#ac', b); f.v.focus();
    const username = !isName && lazyUsernameAvailability(f.v,()=>owner===readOwner()&&b.isConnected&&!b.closest('.scrim')?.classList.contains('is-closing')&&location.pathname==='/me/settings',message=>toast(message));
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button.primary', f); btn.disabled = true;
      try { const r = await api('/api/account', json('PUT', {[field]: f.v.value})); if(owner!==readOwner())return;App.me[field] = r[field];keep('/api/me',App.me);if(!b.isConnected||b.closest('.scrim')?.classList.contains('is-closing'))return;close(); render(); toast(isName ? 'Name saved' : me.email ? `You're now @${r[field]}` : 'Username changed - use it next time you log in'); }
      catch (x) { if(owner!==readOwner()||!b.isConnected)return;if(username){if(!globalThis.UsernameAvailability)toast(x.message);username.error(x.message);}else toast(x.message); btn.disabled = false; }
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
  if (!me.mail_ready) { sheet('Email', `<p>Email isn’t available right now. For help, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`); return; }
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
        await cleanup(async()=>{if(typeof FoodThread==='undefined'&&typeof loadClassicScript==='function')await loadClassicScript(THREAD_ROUTE_ASSET);return typeof FoodThread!=='undefined'?FoodThread.eraseDevice():null;});
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
route(/^\/track$/, 'track', async (el) => {
  Track.sync();
  el.classList.add('track-home-page');
  el.innerHTML = `<div class="top"><h1>Track</h1><div class="acts">${TrackNative.supported ? `<button type="button" class="icon-btn" id="track-settings" aria-label="Recording settings">${svg('gear')}</button>` : ''}</div></div><div id="track-content"></div>`;
  await Track.restoreReview();
  if (TrackNative.supported) { try { await Track.pullNative(); } catch (error) { toast(error.message); } }

  const content=$('#track-content',el),context=Track.__routeContext(),choices=context.recordingChoices();
  const recentKey=()=>context.key?context.key+':recent':null;
  const readRecent=()=>{try{const value=store.get(recentKey());return Array.isArray(value)?value.filter(index=>Number.isInteger(index)&&index>=0&&index<choices.length):[];}catch(_){return[];}};
  let defaultChoices=null;
  const decorate=()=>{
    if(!el.isConnected)return;
    const row=$('.track-quick',content),buttons=row?$$('[data-quick]',row):[];
    if(row&&buttons.length){
      const selected=+(buttons.find(button=>button.getAttribute('aria-pressed')==='true')?.dataset.quick??store.get(context.key+':choice')??0);
      defaultChoices ||= buttons.slice(0,3).map(button=>+button.dataset.quick);
      const defaults=defaultChoices,saved=readRecent(),ordered=[...new Set([...saved,selected,...defaults])].slice(0,3);
      ordered.forEach(index=>{
        if(buttons.some(button=>+button.dataset.quick===index)||!choices[index])return;
        const button=buttons[0].cloneNode(false);button.dataset.quick=String(index);delete button.dataset.trackHomeDecorated;
        button.addEventListener('click',()=>{const moreButton=$('#track-other',content);moreButton?.click();$(`.track-sport-picker [data-pk="${index}"]`)?.click();});
        row.append(button);
      });
      const allButtons=$$('[data-quick]',row);
      allButtons.forEach(button=>{
        const index=+button.dataset.quick,choice=choices[index];if(!choice)return;
        button.hidden=false;button.classList.toggle('track-home-hidden',!ordered.includes(index));button.dataset.sport=choice.lift?'workout':choice.sport;
        button.setAttribute('aria-label',choice.label);
        if(button.dataset.trackHomeDecorated!=='1'){
          const icon=document.createElement('span');icon.className='track-sport-icon';icon.innerHTML=svg(choice.lift?'workout':choice.sport);
          const label=document.createElement('span');label.className='track-sport-label';label.textContent=choice.lift?'Lift':choice.label==='Treadmill run'?'Treadmill':choice.label;
          button.replaceChildren(icon,label);button.dataset.trackHomeDecorated='1';
        }
      });
      const visibleOrder=allButtons.filter(button=>!button.classList.contains('track-home-hidden')).map(button=>+button.dataset.quick);
      if(visibleOrder.some((index,position)=>ordered[position]!==index)||visibleOrder.length!==ordered.length)ordered.forEach(index=>{const button=allButtons.find(item=>+item.dataset.quick===index);if(button)row.append(button);});
      const more=$('#track-other',content),selectedVisible=ordered.includes(selected);
      if(more){more.setAttribute('aria-pressed',String(!selectedVisible));more.setAttribute('aria-label',selectedVisible?'More activities':'More activities, selected '+(choices[selected]?.label||''));if(selectedVisible&&more.querySelector('span')?.textContent!=='More')more.innerHTML=`<span>More</span>${svg('down')}`;}
      if(allButtons.length<3)allButtons.forEach(button=>button.classList.remove('track-home-hidden'));
    }
    const start=$('#track-start',content);if(start){start.classList.remove('round-btn','start');start.classList.add('primary','wide','track-start-button');}
    const plan=$('#track-plan',content),planLink=plan?.querySelector('a:first-child'),planLoad=plan?.querySelector('[data-plan-use]');
    if(plan&&!plan.hidden&&planLink){
      planLink.classList.add('track-plan-main');
      const caption=planLink.querySelector('small'),title=planLink.querySelector('b');
      if(caption&&caption.textContent!=="Today's plan")caption.textContent="Today's plan";
      if(title)title.classList.add('track-plan-title');
      if(planLoad){
        planLoad.classList.add('track-plan-load');
        if(plan.dataset.loaded==='true'){
          if(!planLoad.disabled&&planLoad.textContent.trim()!=='Loading…'){
            planLoad.setAttribute('aria-label','Plan loaded');
            if(planLoad.dataset.trackPlanLoaded!=='true'){planLoad.innerHTML=`${svg('check')}<span>Loaded</span>`;planLoad.dataset.trackPlanLoaded='true';}
          }
        }else if(planLoad.dataset.trackPlanWatch!=='true'){
          planLoad.setAttribute('aria-label',"Load today's plan");
          if(planLoad.textContent.trim()==='Use')planLoad.textContent='Load';
          planLoad.dataset.trackPlanWatch='true';
          planLoad.addEventListener('click',()=>{
            const settle=()=>{
              if(!planLoad.isConnected)return;
              if(planLoad.disabled||planLoad.textContent.trim()==='Loading…'){setTimeout(settle,40);return;}
              if(!$('#track-ready-error',content)?.textContent.trim()&&globalThis.Intervals?.selected()){
                plan.dataset.loaded='true';decorate();
              }
            };
            setTimeout(settle,40);
          });
        }else{planLoad.setAttribute('aria-label',"Load today's plan");if(planLoad.textContent.trim()==='Use')planLoad.textContent='Load';}
      }
    }
    if(start){
      const label=start.getAttribute('aria-label')||'';
      if(plan?.dataset.loaded==='true'&&/^Start (run|walk)$/i.test(label)){
        const visible=label.replace(/^Start /i,'Start ');
        const text=start.querySelector('span');if(text&&text.textContent!==visible)text.textContent=visible;
      }else{
        const text=start.querySelector('span');if(text&&/^Start (run|walk)$/i.test(text.textContent))text.textContent='Start';
      }
    }
    $('#track-content .track-gps-note')?.remove();$('#track-tools-h',content)?.remove();
    const interval=$('#interval-open',content);
    if(interval&&interval.dataset.trackHomeControl!=='1'){interval.innerHTML=`${svg('clock')}<span>Intervals</span>${svg('chev')}`;interval.dataset.trackHomeControl='1';}
    const audio=$('#track-options',content);
    if(audio){if(audio.dataset.trackHomeControl!=='1'||audio.querySelector('span')?.textContent!=='Audio & auto-pause'){audio.innerHTML=`${svg('sound')}<span>Audio &amp; auto-pause</span>${svg('chev')}`;audio.dataset.trackHomeControl='1';}const current=audio.getAttribute('aria-label')||'',prefix='Audio & auto-pause',details=current.startsWith(prefix)?current.slice(prefix.length).replace(/^\.\s*/,''):current.split('. ').slice(1).join('. '),label=`${prefix}${details?`. ${details}`:''}`;if(current!==label)audio.setAttribute('aria-label',label);}
    const explore=$('#track-explore',content),connection=explore?.querySelector('a[data-track-feature="connections"]');
    if(connection){
      explore.classList.add('track-connections');
      connection.className='track-connection-row';connection.setAttribute('aria-label','Connections');
      if(connection.dataset.trackHomeDecorated!=='1'){connection.innerHTML=`<span>${svg('watch')}<b>Connections</b></span>${svg('chev')}`;connection.dataset.trackHomeDecorated='1';}
    }
    const mapWrap=$('#track-ready-map-wrap',content),mapError=$('#track-ready-error',content);
    mapWrap?.classList.toggle('track-map-failed',/^Map unavailable\b/.test(mapError?.textContent.trim()||''));
  };
  const remember=event=>{
    const button=event.target.closest('[data-quick]');if(!button||!content.contains(button))return;
    const index=+button.dataset.quick,key=recentKey();if(!key)return;
    store.set(key,[index,...readRecent().filter(item=>item!==index)].slice(0,3));requestAnimationFrame(decorate);
  };
  const rememberMore=event=>{
    const item=event.target.closest('.track-sport-picker [data-pk]');if(!item)return;
    const index=+item.dataset.pk,key=recentKey();if(key&&Number.isInteger(index))store.set(key,[index,...readRecent().filter(value=>value!==index)].slice(0,3));
  };
  const observer=new MutationObserver(()=>{observer.disconnect();try{decorate();}finally{observer.observe(content,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label']});}});observer.observe(content,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label']});
  el.addEventListener('click',remember,true);document.addEventListener('click',rememberMore,true);
  viewResources.set(el,()=>{observer.disconnect();el.removeEventListener('click',remember,true);document.removeEventListener('click',rememberMore,true);});
  Track.draw();decorate();
});
// admin: set a new password for someone (forgotten), or remove them and all their data (2026-10-10)
route(/^\/me\/import$/, 'track', async () => go('/track/import', {replace:true}));
route(/^\/track\/import$/, 'track', async (el) => {
  el.classList.add('activity-import');
  const owner=readOwner(),account=App.me?.id,valid=()=>el.isConnected&&owner===readOwner();
  const mapFor=new URLSearchParams(location.search).get('map_for'),mapId=/^[1-9]\d*$/.test(mapFor||'')?mapFor:null;
  if (Native.on) return go('/track/connections', {replace:true});
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Upload activities</h1>
    ${mapId?`<p class="muted">Choose the original ZIP or FIT for your <a href="/activity/${esc(mapId)}">existing workout</a>. Matching recordings add missing details; other files are imported as separate activities.</p>`:''}
    <section class="inset-section"><h2 class="inset-caption">Files</h2><div class="inset-group activity-upload">
      <label class="inset-row has-detail import-pick" id="u-drop" for="u-file"><span class="inset-icon" aria-hidden="true">${svg('upload')}</span><span class="inset-label has-detail"><span>Choose files</span><small>FIT, GPX, TCX, ZIP or .gz · drop files here</small></span><span class="inset-value">Browse</span></label>
      <input id="u-file" type="file" multiple accept=".fit,.gpx,.tcx,.gz,.zip" hidden>
      <div id="u-prog" class="activity-upload-progress" hidden><div class="prog"><div class="bar" id="u-bar"></div></div><p class="small muted" id="u-text"></p></div></div>
      <p class="inset-footer">Duplicates are skipped automatically.</p>
    </section>
    <details class="inset-disclosure"><summary>Get your Strava history</summary><p class="small">Strava → Settings → My Account → <b>Download or Delete Your Account</b> → Request your archive. Strava emails a .zip; upload it here as is. For a large archive, ask the person running your Kinetta for help importing it.</p></details>
    <section class="inset-section"><h2 class="inset-caption">Recent imports</h2><div class="inset-group" id="u-jobs">${skel(1)}</div></section>`;
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
        <small>${j.status === 'running' || j.status === 'queued' ? `${j.status === 'queued' ? 'Waiting' : 'Processing'} ${j.done} of ${j.total || '?'}` : j.status === 'done' ? 'Finished' : 'Stopped'} · ${j.added} added · ${j.duplicates} duplicate${j.duplicates === 1 ? '' : 's'}${j.failed ? ` · ${j.failed} couldn't be read` : ''}</small>
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
  if(!(C.garmin_connect_available||g)){box.innerHTML='<div class="inset-row connection-status-row"><span class="inset-icon" aria-hidden="true">'+svg('run')+'</span><span class="inset-label"><span>Garmin Connect</span><small>Garmin Connect isn’t available for this account.</small></span></div>';return;}
  box.innerHTML=`${g?`<button type="button" class="inset-row connection-status-row connection-row-button" id="gc-manage" aria-expanded="false"><span class="inset-icon" aria-hidden="true">${svg('run')}</span><span class="inset-label"><span>Garmin Connect</span><small>Connected${g.last_sync?` · synced ${esc(when(g.last_sync))}`:''}</small></span><span class="inset-value">Manage</span></button>`:`<div class="inset-row connection-status-row"><span class="inset-icon" aria-hidden="true">${svg('run')}</span><span class="inset-label"><span>Garmin Connect</span><small>Not connected</small></span><button type="button" class="connection-action" id="gc-on">Connect</button></div>`}
    ${g?`<div class="connection-details" id="gc-details" hidden><div class="connection-detail-row"><span>Connection</span><span>Connected</span></div><div class="connection-detail-row"><span>Last sync</span><span>${g.last_sync?esc(when(g.last_sync)):'Waiting for sync'}</span></div><p class="connection-detail-note">${esc(garminNote(g))}</p><label class="inset-row switch-row connection-kit"><span class="inset-icon" aria-hidden="true">${svg('sparkle')}</span><span class="inset-label">Let Kit read my Garmin activities</span><input type="checkbox" id="gc-ai"${App.me.garmin_ai_ok?' checked':''}></label>
    <p class="inset-footer">Off unless you say yes. Sends the activities Kit needs to ${esc(App.me.ai_provider||'the AI service')}. Garmin data is never used to train AI.</p>
    <button type="button" class="inset-row is-alert connection-disconnect" id="gc-off">Disconnect Garmin</button></div>`:''}`;
  const manage=$('#gc-manage',box);if(manage)manage.onclick=()=>{const details=$('#gc-details',box),open=details.hidden;details.hidden=!open;manage.setAttribute('aria-expanded',String(open));};
  const on=$('#gc-on',box);if(on)on.onclick=async()=>{
    try{const r=await api('/api/connections/garmin-connect/start',json('POST',{native:Native.signInSheet}));if(!valid())return;
      if(Native.signInSheet){
        const res=await Native.webSignIn(r.url);if(!valid()||res.cancelled)return;
        const q=new URL(res.url).searchParams;toast(q.get('ok')==='1'?q.get('title'):`${q.get('title')}. ${q.get('text')}`);render();
      }else if(Native.on){window.open(r.url,'_blank');toast('Finish signing in at Garmin, then come back');}else location.href=r.url;}
    catch(x){toast(x.message);}};
  const off=$('#gc-off',box);if(off)off.onclick=async()=>{
    if(!await confirmSheet('Disconnect Garmin?',{body:'New activities stop arriving. Activities already here stay until you delete them.',action:'Disconnect'})||!valid())return;
    try{await api('/api/connections/garmin_connect',{method:'DELETE'});toast('Garmin disconnected');if(valid())render();}catch(x){toast(x.message);}};
  const ai=$('#gc-ai',box);if(ai)ai.onchange=async(e)=>{const v=e.target.checked;
    try{await api('/api/profile',json('PUT',{garmin_ai_ok:v}));App.me.garmin_ai_ok=v;toast(v?'Kit can read your Garmin activities':'Kit won’t read your Garmin activities');}
    catch(x){e.target.checked=!v;toast(x.message);}};
}

route(/^\/(?:me\/connections|track\/connections)$/, 'me', async () => go('/me/settings/connections',{replace:true}));
route(/^\/me\/settings\/connections$/, 'me', async (el) => {
  el.classList.add('connections-page');
  const owner=readOwner(),valid=()=>el.isConnected&&readOwner()===owner;
  el.innerHTML = `<div class="top">${backBtn('Settings')}</div><h1>Connections</h1>
    <section class="inset-section connections-list"><div class="inset-group" id="c-list">
      <div class="inset-row connection-status-row" id="c-health">${skel(1)}</div><div id="c-gc"></div>
      ${Native.on ? '<button type="button" class="inset-row has-detail connection-status-row" data-import-history><span class="inset-icon" aria-hidden="true">'+svg('upload')+'</span><span class="inset-label"><span>Import activity history</span><small>Upload files or a Strava export</small></span><span class="inset-value connection-row-action">Open</span></button>' : '<a class="inset-row has-detail connection-status-row" href="/track/import"><span class="inset-icon" aria-hidden="true">'+svg('upload')+'</span><span class="inset-label"><span>Import activity history</span><small>Upload files or a Strava export</small></span><span class="inset-value connection-row-action">Open</span></a>'}
    </div></section>
    <details class="inset-disclosure connection-other-disclosure" id="c-other"><summary class="connection-other-summary">Other connections</summary><div id="c-body" class="inset-group">${skel(2)}</div></details>`;
  wireBack(el, '/me/settings');
  const importHistory=$('[data-import-history]',el);if(importHistory)importHistory.onclick=()=>sheet('Import history',`<p>Open Kinetta in your browser to import original activity files or a Strava export.</p><a class="primary wide" href="${esc((Native.base||location.origin)+'/track/import')}" target="_blank" rel="noopener">Open in browser</a>`);
  const healthCard=(isOn,st,error='')=>{if(!valid())return;$('#c-health',el).innerHTML=`<span class="inset-icon" aria-hidden="true">${svg('heart')}</span><span class="inset-label"><span>Apple Health</span><small${error?' class="connection-error"':''}>${error?esc(error):Native.on?isOn?`Connected${st?.at?` · synced ${esc(when(st.at))}`:''}`:'Not connected': 'Available in the iPhone app'}${!error&&!Native.on?'.':''}</small></span><a class="inset-value connection-row-action" href="/me/settings/connections/apple-health">${Native.on?isOn?'Manage':'Connect':'About'}</a>${error?'<button type="button" class="connection-action" data-health-retry>Retry</button>':''}`;const retry=$('[data-health-retry]',el);if(retry)retry.onclick=()=>{retry.disabled=true;Native.healthCall(Promise.all([Native.anyHealthOn?Native.anyHealthOn():Native.healthOn(),Native.healthStatus()]),'Health status could not be checked.',5000).then(([on,st])=>healthCard(on,st)).catch(()=>healthCard(false,null,'Health status could not be checked.'));};};
  if(Native.on)Native.healthCall(Promise.all([Native.anyHealthOn?Native.anyHealthOn():Native.healthOn(),Native.healthStatus()]),'Health status could not be checked.',5000).then(([on,st])=>healthCard(on,st)).catch(()=>healthCard(false,null,'Health status could not be checked. Open the Health app to review setup.'));
  else healthCard(false,null);
  let C;
  try{C=await api('/api/connections');}catch(e){if(valid()){$('#c-gc',el).innerHTML=`<div class="card" role="alert"><p>Connections could not load. ${esc(e.message)}</p><button type="button" class="ghost" data-connections-retry>Retry</button></div>`;$('[data-connections-retry]',el).onclick=()=>render();}return;}
  if(!valid())return;
  garminCard($('#c-gc',el),C,valid);
  const st = (k) => C[k] ? `<p class="small"><b>Connected.</b> ${esc(C[k].status || '')}${C[k].last_sync ? ' · ' + esc(when(C[k].last_sync)) : ''}</p>` : '<p class="small muted">Not connected.</p>';
  $('#c-body', el).innerHTML = `<div class="connection-item"><div class="inset-row has-detail"><span class="inset-icon" aria-hidden="true">${svg('upload')}</span><span class="inset-label has-detail"><span>Health Auto Export</span><small>${C.apple ? 'Connected. '+esc(C.apple.status||'') : 'Optional · import workouts from the iPhone app.'}</small></span></div>
      <details class="inset-nested-disclosure"><summary>Set up Health Auto Export</summary><p class="small">In the iPhone app <b>Health Auto Export</b> (Premium), add an automation: <b>REST API</b>, format <b>JSON</b>, data <b>Workouts</b> (and optionally <b>Body Mass</b>), with the address and header below.</p></details>
      <div id="c-apple-out"></div><div class="connection-actions">${C.apple ? '<button class="inset-row is-alert" data-off="apple">Disconnect</button>' : ''}<button class="inset-row" id="c-apple">${C.apple ? 'Make a new secret' : 'Create connection link'}</button></div></div>`;
  $('#c-apple', el).onclick = async () => {
    if(!valid())return;
    if (C.apple && (!await confirmSheet('Make a new secret?', {body: 'The old secret stops working.', action: 'Make new secret'}) || !valid())) return;
    try {
      const r = await api('/api/connections/apple', json('POST', {}));
      if(!valid())return;
      $('#c-apple-out', el).innerHTML = `<div class="callout"><div><p class="small">Copy these into Health Auto Export now. The secret is shown only once.</p>
        <p class="small"><b>URL</b><br><code>${esc((Native.base || location.origin) + r.url)}</code></p><p class="small"><b>Header</b> Authorization<br><b>Value</b> <code>Bearer ${esc(r.token)}</code></p></div></div>`;
    } catch (x) { toast(x.message); }
  };
  $$('[data-off]', el).forEach((b) => b.onclick = async () => { if(!valid())return;if (!await confirmSheet('Disconnect?', {body: 'Activities already imported stay.', action: 'Disconnect'}) || !valid()) return; try { await api(`/api/connections/${b.dataset.off}`, {method: 'DELETE'}); render(); } catch (x) { toast(x.message); } });
});

route(/^\/me\/gear$/, 'me', async (el) => {
  el.classList.add('gear-settings');
  el.innerHTML = `<div class="top">${backBtn('Me')}<button class="icon-btn gear-add" id="g-add" type="button" aria-label="Add gear">${svg('plus')}</button></div><h1>Shoes & bikes</h1><div id="g-list">${skel(2)}</div>`;
  wireBack(el, '/me');
  const remove = async (g, button, close) => {
    if (!await confirmSheet(`Delete ${g.name}?`, {body: 'Your activities stay; only their link to this gear is removed.', action: 'Delete'})) return;
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
      ${g ? '<button type="button" class="linkbtn danger" id="g-del">Delete gear</button>' : ''}<div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary wide">Save</button></div></form>`, (b, close) => {
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
    $('#g-add', el).hidden = !gear.length;
    $('#g-list', el).innerHTML = gear.length ? `<section class="inset-section"><h2 class="inset-caption">Your gear</h2><div class="inset-group gear-list">${gear.map((g) => {
      const due = g.alert_distance_m && g.total_m >= g.alert_distance_m;
      const status = [g.is_default ? 'Default' : '', g.retired ? 'Retired' : '', `${g.uses} activities${g.last_used ? ' · last ' + fdate(g.last_used, {month: 'short', day: 'numeric'}) : ''}`].filter(Boolean).join(' · ');
      return `<button type="button" class="inset-row has-detail gear-item" data-id="${g.id}" aria-label="Edit ${esc(g.name)}"><span class="inset-icon" aria-hidden="true">${svg(g.kind === 'bike' ? 'ride' : 'shoe')}</span><span class="inset-label has-detail"><span>${esc(g.name)}</span><small>${esc(status)}</small></span><span class="inset-value">${U.dist(g.total_m, 0)} ${U.du()}${due ? '<small class="gear-due">Replace soon</small>' : ''}</span><span class="chev">${svg('chev')}</span></button>`; }).join('')}</div></section>`
      : `<section class="inset-section"><p class="settings-empty">Track mileage on your shoes and bikes.</p><button type="button" class="primary wide" id="g-first">Add gear</button></section>`;
    const first=$('#g-first',el);if(first)first.onclick=()=>edit(null);
    $$('[data-id]', el).forEach((b) => b.onclick = () => edit(gear.find((g) => g.id === +b.dataset.id)));
  });
});

route(/^\/me\/goals$/, 'me', async (el) => {
  el.classList.add('goals-settings');
  el.innerHTML = `<div class="top">${backBtn('Me')}<button class="icon-btn goals-add" id="o-add" type="button" aria-label="Add goal">${svg('plus')}</button></div><h1>Goals</h1><div id="o-list">${skel(1)}</div>`;
  wireBack(el, '/me');
  const editGoal = (preset={}) => sheet('New goal', `<form class="form">
    <div class="two"><label>Sport<select name="sport"><option value="">All sports</option>${['run', 'ride', 'walk', 'hike', 'swim'].map((s) => `<option value="${s}">${SPORT_NAMES[s]}</option>`).join('')}</select></label>
    <label>Every<select name="period"><option value="day">Day</option><option value="week" selected>Week</option><option value="month">Month</option><option value="year">Year</option></select></label></div>
    <div class="two"><label>Measure<select name="metric"><option value="distance">Distance (${U.du()})</option><option value="time">Time (hours)</option><option value="calories">Calories burned (kcal)</option><option value="elevation">Climb (${U.eu()})</option><option value="count">Activities</option></select></label>
    <label>Target<input name="target" inputmode="decimal" required></label></div>
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Add goal</button></div></form>`, (b, close) => {
    const f = $('form', b);
    for(const [key,value] of Object.entries(preset))f.elements.namedItem(key).value=String(value);
    f.onsubmit = async (e) => {
      e.preventDefault(); const v = Number(f.target.value); if (!(v > 0)) { toast('Enter a target above 0'); return; }
      const target = f.metric.value === 'distance' ? v * (imp() ? MI : 1000) : f.metric.value === 'time' ? v * 3600 : f.metric.value === 'elevation' ? (imp() ? v / 3.28084 : v) : v;
      try { await api('/api/goals', json('POST', {sport: f.sport.value || null, period: f.period.value, metric: f.metric.value, target})); invalidate('/api/goals'); close(); render(); } catch (x) { toast(x.message); }
    };
  });
  const inspectGoal = goal => sheet('Goal', `<p class="small muted">${esc(goal.sport ? SPORT_NAMES[goal.sport] : 'All sports')} · ${goal.period === 'day' ? 'daily' : goal.period} target</p><div class="goal-detail-value"><b>${esc(goalFmt(goal.metric, goal.value))}</b><span>of ${esc(goalFmt(goal.metric, goal.target))}</span></div><button type="button" class="linkbtn danger" id="goal-remove">Remove goal</button>`, (box, close) => {
    $('#goal-remove',box).onclick=async()=>{
      if(!await confirmSheet('Remove this goal?',{body:'Your goal history stays in your activities.',action:'Remove goal'}))return;
      try{await api(`/api/goals/${goal.id}`,{method:'DELETE'});invalidate('/api/goals');close();render();toast('Goal removed',async()=>{await api('/api/goals',json('POST',{sport:goal.sport,period:goal.period,metric:goal.metric,target:goal.target}));invalidate('/api/goals');render();});}catch(error){if(box.isConnected)toast(error.message);}
    };
  });
  $('#o-add',el).onclick=()=>editGoal();
  const goalQuery=new URLSearchParams(location.search);
  if(goalQuery.get('new')==='1'){
    goalQuery.delete('new');
    if(replacePageAddress(el,location.pathname+(goalQuery.size?'?'+goalQuery:'')+location.hash))$('#o-add',el).click();
  }
  await load('/api/goals', (g) => {
    $('#o-add', el).hidden = !g.length;
    $('#o-list', el).innerHTML = g.length ? `<section class="inset-section"><h2 class="inset-caption">Your goals</h2><div class="inset-group goals-list">${g.map((x) => `<button type="button" class="goal inset-goal-row" data-goal-id="${x.id}" aria-label="${esc((x.sport ? SPORT_NAMES[x.sport] : 'All sports') + ' goal')}">${goalRow(x).replace(/^<div class="goal[^>]*>/, '').replace(/<\/div>$/, '')}</button>`).join('')}</div></section>` : `<section class="inset-section"><p class="settings-empty">Choose a target for your workouts.</p><button type="button" class="primary wide" id="o-first">Add a goal</button><div class="first-step-presets"><button type="button" class="linkbtn" data-goal-preset="run">Run 10 ${U.du()}/week</button><button type="button" class="linkbtn" data-goal-preset="calories">Burn 500 kcal/day</button></div></section>`;
    const first=$('#o-first',el);if(first)first.onclick=()=>editGoal();
    $$('[data-goal-preset]',el).forEach(button=>button.onclick=()=>editGoal(button.dataset.goalPreset==='run'?{sport:'run',period:'week',metric:'distance',target:10}:{sport:'',period:'day',metric:'calories',target:500}));
    $$('[data-goal-id]',el).forEach(button=>button.onclick=()=>{const goal=g.find(x=>x.id===+button.dataset.goalId);if(goal)inspectGoal(goal);});
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
  sheet('Add an activity', `<form class="form hand manual-activity-entry" id="ma">
    ${sel('kind', 'Activity type', kinds)}
    <div id="ma-lift" hidden>${sel('copy', 'Exercises', opt('', 'Add them next', true))}<p class="small muted" id="ma-lift-hint">You'll put in each set on the next screen.</p></div>
    <div class="manual-entry-group"><p class="manual-entry-group-title">When</p><div class="two">${sel('day', 'Day', days.map((d, i) => opt(d, dayName(d, i), d === d0)).join('') + opt('', 'Earlier…', early))}${sel('time', 'Start time', times)}</div></div>
    <label id="ma-cal"${early ? '' : ' hidden'}>Date<input type="date" name="date" value="${esc(early ? d0 : '')}" max="${today}"></label>
    <div class="manual-entry-group"><p class="manual-entry-group-title">Duration</p><div class="dur">${sel('h', 'Hours', nums(12, 0))}${sel('m', 'Minutes', nums(59, 30))}<span class="dur-s">${sel('s', 'Seconds', nums(55, 0, 5))}</span></div></div>
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
        + (kitChatOn() ? '<button class="primary wide" id="activity-kit-generate">'+(activity.ai_note ? 'Ask again' : 'Ask Kit')+'</button>' : '<p class="small muted">New reviews are unavailable. Saved notes remain readable.</p>');
      const button = $('#activity-kit-generate', box); if (!button) return;
      button.onclick = async () => {
        if (!kitChatOn() || App.me?.login !== account || !box.isConnected) { draw(); return; }
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
  el.classList.add('devices-settings');
  el.innerHTML = `<div class="top">${backBtn('Back')}</div><h1>Signed-in devices</h1><section class="inset-section"><h2 class="inset-caption">Devices</h2><div class="inset-group" id="dv-list">${skel(2)}</div><p class="inset-footer">Sign out a device you don’t recognise, then change your password.</p></section>`;
  wireBack(el, '/me/settings', ()=>'Back');
  const day = (t) => fdate(t, {month: 'short', day: 'numeric', year: 'numeric'});
  const draw = async () => {
    let rows;
    try { rows = await api('/api/account/devices'); }
    catch (error) {
      if (!el.isConnected || owner !== readOwner()) return;
      $('#dv-list', el).innerHTML = `<p class="device-error" role="alert">Devices could not load. Reconnect needed.</p><button type="button" class="linkbtn" id="dv-retry">Try again</button>`;
      $('#dv-retry',el).onclick=()=>draw();
      return;
    }
    if (!el.isConnected || owner !== readOwner()) return;
    const others = rows.filter((d) => !d.this);
    const previousBulk=$('#dv-all',el);if(previousBulk)previousBulk.remove();
    $('#dv-list', el).innerHTML = rows.length ? `${rows.map((d) => `<div class="inset-row has-detail device-row"><span class="inset-icon" aria-hidden="true">${svg('shield')}</span><span class="inset-label has-detail"><span>${esc(d.device)}</span><small>${d.this ? 'This device · ' : ''}Last used ${esc(day(d.last_used))} · signed in ${esc(day(d.signed_in))}</small></span>${d.this ? '<span class="inset-value">This device</span>' : `<button type="button" class="device-action" data-dv="${esc(d.id)}" aria-label="Sign out ${esc(d.device)}">Sign out</button>`}</div>`).join('')}`
      : `<p class="device-empty">No signed-in devices yet. Sign in on another phone or browser and it will appear here.</p>`;
    $$('[data-dv]', el).forEach((b) => b.onclick = async () => {
      if(owner!==readOwner()||b.disabled)return;b.disabled = true;
      try { await api('/api/account/devices/signout', json('POST', {id: b.dataset.dv})); if(owner!==readOwner())return;toast('Signed out'); await draw(); }
      catch (x) { if(owner===readOwner()){toast(x.message);b.disabled = false;} }
    });
    if(others.length>1){const bulk=document.createElement('button');bulk.type='button';bulk.id='dv-all';bulk.className='inset-row is-alert device-bulk-action';bulk.textContent='Sign out all other devices';$('#dv-list',el).append(bulk);bulk.onclick=async()=>{
      if(owner!==readOwner()||!await confirmSheet(`Sign out ${others.length} other device${others.length>1?'s':''}?`,{body:'They’ll need your password to log in again.',action:'Sign out'})||owner!==readOwner())return;
      bulk.disabled=true;try{await api('/api/account/devices/signout-others',json('POST',{}));if(owner!==readOwner())return;toast('Other devices signed out');await draw();}catch(error){if(owner===readOwner()){toast(error.message);bulk.disabled=false;}}
    };}
    const retry=$('#dv-retry',el);if(retry)retry.onclick=()=>draw();
  };
  await draw();
});

// Older diagnostic links return to the existing settings page.
route(/^\/me\/speed$/, 'me', () => go('/me/settings', {replace:true}));
