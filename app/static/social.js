// Kinetta phone app — Part 5: friends and sharing (2026-10-11). Friends (found by name or username, approved by the
// other person), who sees each activity, which details they see, the Feed, read-only pages for friends' activities,
// cheers and comments. The server decides what anyone else gets (app/api_social.py); these pages only show it.
'use strict';

// The quick appreciation button. Its name lives only here, so it can be renamed in one place.
const CHEER = {verb: 'Cheers', done: 'Cheers sent', many: 'cheers', title: 'Cheers'};   // 'Cheers' everywhere (2026-10-12)
const VIS = {me: 'Only me', friends: 'Friends', everyone: 'Everyone on this Kinetta'};
const VIS_SHORT = {me: 'Only me', friends: 'Friends', everyone: 'Everyone'};
const DETAIL_NAMES = {map: 'Map', heart_rate: 'Heart rate', pace: 'Pace and speed', splits: 'Splits and laps', elevation: 'Elevation',
  calories: 'Calories', description: 'Description', device: 'Device or watch'};
Object.assign(IC, {
  // a party popper (2026-10-12, was a star): the cone fills in once you've cheered
  cheer: '<path class="cone" d="M3.5 20.5 8 9l7 7z"/><path d="M10.5 6.5c.4-1.4-.3-2.4-1.3-2.8M17.5 13.5c1.4-.4 2.4.3 2.8 1.3M13 9.5c1-2.3 2.6-3.4 5-3.2"/><path d="M14.5 3v1M20.5 9h-1M18 4.8l-.7.7M21 4l-.1.1"/>',
  comment: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5M15 15c2.6 0 4.6 1.6 5.5 4.5"/>',
});
const trimName = (m) => (!m ? 'Off' : imp() ? {200: '⅛ mi', 400: '¼ mi', 800: '½ mi'}[m] : `${m} m`);
const profileHref = (p) => `/people/${encodeURIComponent(p.login)}`;
const personLink = (p, label = p.name) => `<a class="person-link" href="${profileHref(p)}">${avatar(p)}<span class="grow"><b>${esc(label)}</b><small class="muted">@${esc(p.login)}</small></span></a>`;

// Delay the single action briefly so a double tap inspects people without sending/removing Cheers.
function cheerGesture(button, toggle, show) {
  if (!button || button.dataset.cheerBound) return;
  button.dataset.cheerBound = '1';
  button.title = 'Tap to send or remove Cheers. Double tap to see who cheered.';
  let timer = null;
  const clear = () => { clearTimeout(timer); timer = null; button.classList.remove('cheer-wait'); };
  button.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.detail === 0) { clear(); toggle(); return; } // keyboard and assistive activation
    if (timer) { clear(); show(); return; }
    button.classList.add('cheer-wait');
    timer = setTimeout(() => { clear(); if (button.isConnected) toggle(); }, 280);
  };
  button.ondblclick = (e) => { e.preventDefault(); e.stopPropagation(); };
  viewResources.set(button, clear);
}
function activityCheers(aid) {
  sheet('Cheers', '<div class="cheers-list" aria-live="polite">Loading…</div>', async (box) => {
    const list = $('.cheers-list', box);
    try { const s = await api(`/api/activities/${aid}/social`); if (list.isConnected) list.innerHTML = cheersPeople(s.cheers); }
    catch (x) { if (list.isConnected) list.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p>`; }
  });
}

// the number on the Me tab: unread notifications (or friend requests waiting, if more); checked at most once a minute
const Social = {
  at: 0,
  count: () => Math.max((App.me && App.me.notifications) || 0, (App.me && App.me.friend_requests) || 0),
  badge() {
    const a = $('nav.tabs a[data-tab="me"]'); if (!a) return;
    const n = Social.count(); let b = $('.tab-n', a);
    const un = (App.me && App.me.notifications) || 0;
    $$('.bell-dot').forEach((d) => { d.hidden = !un; d.textContent = un > 9 ? '9+' : un || ''; });
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tab-n'; a.append(b); }
    b.innerHTML = `${n > 9 ? '9+' : n}<span class="vh"> new notification${n > 1 ? 's' : ''}</span>`;
  },
  refresh() {
    Social.badge();
    if (!App.me || !navigator.onLine || Date.now() - Social.at < 60000) return;
    Social.at = Date.now();
    api('/api/notifications/count').then((r) => { App.me.notifications = r.unread; App.me.friend_requests = r.friend_requests; Social.badge(); }).catch(() => {});
  },
  set(n) { if (App.me && n != null) { App.me.friend_requests = n; Social.badge(); } },
};

// ---------- Activity tab: the Feed (yours and your friends', newest first) ----------
// Two lists merged by start time. Each page asks both for the next N before the oldest card shown, keeps the newest N,
// and the rest comes again on the next page, so nothing is skipped or shown twice.
const FEED_N = 15;
async function feedPage(before) {
  const b = before ? '&before=' + encodeURIComponent(before) : '';
  const [mine, theirs] = await Promise.all([api(`/api/activities?limit=${FEED_N}${b}`), api(`/api/feed/friends?limit=${FEED_N}${b}`)]);
  const all = mine.concat(theirs).sort((x, y) => new Date(y.start_time) - new Date(x.start_time));
  // the next page asks for "older than the last card", so activities sharing the last card's start time all go on this page
  let n = Math.min(FEED_N, all.length);
  while (n && n < all.length && +new Date(all[n].start_time) === +new Date(all[n - 1].start_time)) n++;
  return {rows: all.slice(0, n), more: all.length > n || mine.length === FEED_N || theirs.length === FEED_N, friends: theirs.length};
}
async function homeFeed(el) {
  el.innerHTML = `${actTop(false, true)}${whoseSeg('')}
    <div class="feed-list" id="ff-list">${skel(3)}</div><button class="ghost feed-more" id="ff-more" hidden>Show more</button>`;
  wireWhose(el);
  const list = $('#ff-list', el), more = $('#ff-more', el);
  let items = [];
  const draw = (pg) => {
    items = pg.rows;
    list.innerHTML = items.length ? items.map((a) => postCard(a, {who: true})).join('') : `<div class="card empty"><b>Nothing here yet</b>
      Your activities and the ones your friends share show up here.${startCta()}<div class="btncol"><a class="ghost" href="/me/friends">Find your friends</a></div></div>`;
    more.hidden = !pg.more; feedMaps(list); wireCheers(list);
  };
  const hit = App.cache.get('feed:home'); if (hit) draw(hit.data);
  try { const pg = await feedPage(); App.cache.set('feed:home', {data: pg, at: Date.now()}); if (list.isConnected) draw(pg); }
  catch (x) { if (!hit) throw x; }
  more.onclick = async () => {
    more.disabled = true; more.textContent = 'Loading…';
    try {
      const pg = await feedPage(items[items.length - 1].start_time);
      items = items.concat(pg.rows);
      list.insertAdjacentHTML('beforeend', pg.rows.map((a) => postCard(a, {who: true})).join('')); more.hidden = !pg.more; feedMaps(list); wireCheers(list);
    } catch (x) { toast(x.message); }
    more.disabled = false; more.textContent = 'Show more';
  };
}

// ---------- someone else's activity (read-only); for your own: what others see ----------
route(/^\/activity\/friends\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn()}</div>${skel(1)}<div class="sk block"></div>`;
  wireBack(el, '/activity');
  await load(`/api/shared/${id}`, (a) => drawShared(el, a), {maxAge: 30000});
});
function drawShared(el, a) {
  const mine = a.social.mine, sh = a.shares, r = rate(a);
  const hero = (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', dur(a.moving_s || a.elapsed_s)) +
    (a.distance_m && sh.pace ? stat(r.label, r.v, r.u) : '');
  const splits = imp() ? a.splits_mi : a.splits_km;
  el.innerHTML = `<div class="top">${backBtn(mine ? 'Back' : 'Feed')}</div>
    ${mine ? '<div class="callout">This is what others see of your activity.</div>' : ''}
    <div class="d-title card"><div class="post-hd"><a class="post-person" href="${profileHref(a.owner)}">${avatar(a.owner)}<span class="ph-txt"><b>${esc(a.owner.name)}</b>
      <small>${esc(fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric'}))} at ${esc(ftime(a.start_time))}${a.device ? ' · ' + esc(a.device) : ''}</small></span></a>${sportMark(a.sport)}</div>
      <div class="t-row"><h1>${esc(a.name)}</h1><span class="t-soc" id="s-soc"></span></div>
      ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
      <div class="hero">${hero}</div>${sportStats(a) ? `<div class="hero more">${sportStats(a)}</div>` : ''}<div class="cpile"></div></div>
    ${activityMedia(a, {mapId: 's-map', detail: true, full: true})}
    ${a.ends_hidden ? '<p class="small muted map-note">The start and end of the route are hidden.</p>' : ''}
    ${a.chart ? '<div class="card"><h2>Charts</h2><div id="s-charts"></div></div>' : ''}
    ${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
    ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}
    ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
    ${mine ? '' : `<p class="center"><button class="linkbtn muted" id="s-rb">Report or block ${esc(a.owner.name)}</button></p>`}`;
  wireBack(el, mine ? `/activity/${a.id}` : '/activity');
  if (!mine) $('#s-rb', el).onclick = () => reportSheet(a.owner, {activity_id: a.id});
  if (a.line) {
    const box = $('#s-map', el); let m = null;
    wireMediaMapFull(box, () => m, a.line, !!a.photos?.length);
    lazy(box, async () => {
      try {
        m = await mapInto(box, [a.line], {sport: a.sport, ends: false, still: !!a.photos?.length && !box.classList.contains('full')});
        if (m && a.photos?.length && !box.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
      } catch (e) { if (box.isConnected) box.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
    });
  }
  wireTalk($('#s-soc', el), a.id, a.social, new URLSearchParams(location.search).get('tab') === 'comments');
  wireActivityMedia(el);
  if (a.chart) requestAnimationFrame(() => sharedCharts($('#s-charts', el), a));
}
function sharedCharts(box, a) {
  const c = a.chart, x = c.d && c.d[c.d.length - 1] > 100 ? c.d : c.t, byDist = x === c.d, rows = [];
  if (!x) { box.closest('.card').remove(); return; }
  const foot = FOOT.includes(a.sport) && a.sport !== 'swim';
  if (c.speed) rows.push(foot ? {name: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s1'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s1'), clip: true});
  if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s2'), avg: a.avg_hr});
  if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
  chartStack(box, x, rows, {xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v))});
}

// The cheer and comment icons by an activity's title (2026-10-12, Ben: a little icon near the title, comments pop up
// from below). Both activity pages use them; the counts follow what happens in the comments sheet.
const talkIcons = (s) => `<button type="button" class="pf cheer" data-tcheer aria-pressed="${!!s.cheered}" aria-label="${esc(CHEER.verb)}">${svg('cheer')}<span class="num">${s.cheers.length || ''}</span></button>
  <button type="button" class="pf" data-ttalk aria-label="Comments">${svg('comment')}<span class="num">${s.comments.length || ''}</span></button>`;
function wireTalk(box, aid, s, open) {
  if (!box) return;
  let sending = false;
  const pile = box.closest('.d-title') && $('.cpile', box.closest('.d-title'));
  const draw = () => {
    box.innerHTML = talkIcons(s);
    if (pile) { pile.innerHTML = cheerPile(s.cheers); const pb = $('[data-cpile]', pile); if (pb) pb.onclick = () => cheersSheet(s.cheers); }
    const cb = $('[data-tcheer]', box);
    cheerGesture(cb, async () => {
      if (sending) return;
      sending = true;
      const was = s;
      s = {...s, cheered: !s.cheered, cheers: s.cheered ? s.cheers.filter((c) => c.login !== App.me.login) : [...s.cheers, {login: App.me.login, name: App.me.name}]};
      draw(); if (s.cheered) $('[data-tcheer]', box).classList.add('just');
      try {
        if (was.cheered) await api(`/api/activities/${aid}/cheer`, {method: 'DELETE'});
        else s = {...s, ...await api(`/api/activities/${aid}/cheer`, json('POST', {}))};
        socialChanged(aid);
      } catch (x) { s = was; toast(x.message); }
      finally { sending = false; if (box.isConnected) draw(); }
    }, () => activityCheers(aid));
    $('[data-ttalk]', box).onclick = () => commentsSheet(aid, s, (fresh) => { s = fresh; draw(); });
  };
  draw();
  if (open) commentsSheet(aid, s, (fresh) => { s = fresh; draw(); });
}
// Who sent cheers (2026-10-12, Ben): up to three faces and "Jordan Lee and 2 others" under the activity's numbers; a tap
// lists everyone. The same list opens from the comments sheet.
const cheerName = (c) => (c.login === App.me.login ? 'You' : c.name);
function cheerPile(cheers) {
  if (!cheers.length) return '';
  const first = cheerName(cheers[0]), more = cheers.length - 1;
  return `<button type="button" class="cheer-pile" data-cpile><span class="faces">${cheers.slice(0, 3).map((c) => avatar(c)).join('')}</span>
    <span class="grow"><b>${esc(CHEER.title)}</b> from ${esc(first)}${more ? ` and ${more} other${more > 1 ? 's' : ''}` : ''}</span><span class="chev">${svg('chev')}</span></button>`;
}
const cheersPeople = (cheers) => `<div class="card list">${cheers.length ? cheers.map((c) => `<div class="person" data-close>${personLink(c, cheerName(c))}</div>`).join('') : '<p class="small muted">No Cheers yet.</p>'}</div>`;
function cheersSheet(cheers) { sheet(`${CHEER.title} · ${cheers.length}`, cheersPeople(cheers)); }
function socialChanged(aid) {
  invalidate('/api/shared/' + aid); invalidate('/api/activities/' + aid + '/social'); invalidate('/api/feed/friends'); invalidate('/api/activities?'); App.cache.delete('feed:home');
}
// cheers and comments in a bottom sheet; onChange gets the new state so the icon underneath can follow
function commentsSheet(aid, s, onChange) {
  sheet('Comments', '<div class="social"></div>', (b) => drawComments($('.social', b), aid, s, onChange));
}
function drawComments(box, aid, s, onChange) {
  const names = s.cheers.map((c) => c.name);
  const who = names.length ? `<button type="button" class="small cheer-who" data-cwho>${svg('cheer')}<span class="grow"><b>${esc(CHEER.title)}</b> from ${esc(names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : names.join(', '))}</span><span class="chev">${svg('chev')}</span></button>` : '';
  box.innerHTML = `${who}<div class="comments">${s.comments.length ? s.comments.map((c) => `<div class="comment"><a href="${profileHref(c)}" data-close aria-label="View ${esc(c.name)}'s profile">${avatar(c)}</a><div class="c-body"><div class="c-hd"><a href="${profileHref(c)}" data-close><b>${esc(c.name)}</b></a><small class="muted">${esc(when(c.created))}</small></div><p>${esc(c.text)}</p><div class="c-acts">${c.can_delete ? `<button class="linkbtn danger" data-del="${c.id}" aria-label="Delete comment from ${esc(c.name)}">Delete</button>` : ''}${c.login !== App.me.login ? `<button class="linkbtn muted" data-rep="${c.id}" aria-label="Report comment from ${esc(c.name)}">Report</button>` : ''}</div></div></div>`).join('')
      : '<p class="small muted c-none">No comments yet.</p>'}</div>
    <form class="form c-form"><label class="vh" for="c-${aid}">Add a comment</label><textarea id="c-${aid}" name="text" maxlength="500" rows="2" placeholder="Add a comment" required></textarea>
      <button class="primary wide">Post comment</button></form>`;
  const cw = $('[data-cwho]', box); if (cw) cw.onclick = () => cheersSheet(s.cheers);
  const after = (fresh) => { socialChanged(aid); s = {...s, ...fresh}; drawComments(box, aid, s, onChange); if (onChange) onChange(s); };
  $$('[data-del]', box).forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this comment?')) return;
    b.disabled = true;
    try { await api('/api/comments/' + b.dataset.del, {method: 'DELETE'}); after({comments: s.comments.filter((c) => String(c.id) !== b.dataset.del)}); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
  $$('[data-rep]', box).forEach((b) => b.onclick = () => {
    const c = s.comments.find((x) => String(x.id) === b.dataset.rep);
    reportSheet(c, {comment_id: c.id}, () => after({comments: s.comments.filter((x) => x.login !== c.login)}));
  });
  const f = $('.c-form', box);
  f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    const btn = $('button', f); btn.disabled = true;
    try { after(await api(`/api/activities/${aid}/comments`, json('POST', {text}))); }
    catch (x) { toast(x.message); btn.disabled = false; }
  };
}

// ---------- activity photos (2026-10-12, api_photos.py) ----------
// A row of small photos on the activity page (the owner also gets an Add button); a tap opens them full screen. The
// phone shrinks each photo first (1600 px); the server saves it again without its hidden details (where it was taken).
const PHOTO_MAX = 10;
const photoSrc = (p, thumb) => `/api/activity-photos/${p.id}${thumb ? '?size=thumb' : ''}`;
function photoChanged(aid) {
  invalidate('/api/activities/' + aid); invalidate('/api/shared/' + aid); invalidate('/api/activities?'); invalidate('/api/feed/friends'); App.cache.delete('feed:home');
}
function photoStrip(box, a, mine, {controlsOnly = false, afterChange = null} = {}) {
  if (!box) return;
  const ph = a.photos || [];
  if (!ph.length && !mine) { box.innerHTML = ''; return; }
  const canAdd = mine && ph.length < PHOTO_MAX;
  box.innerHTML = `<div class="ph-strip${ph.length && !controlsOnly ? '' : ' empty'}">${controlsOnly ? '' : ph.map((p, i) => `<button type="button" class="ph-th" data-ph="${i}" aria-label="Photo ${i + 1} of ${ph.length}">${pimg(photoSrc(p, true))}</button>`).join('')}
    ${canAdd ? `<button type="button" class="ph-add" data-phadd>${svg('camera')}<span>${ph.length ? 'Add' : 'Add photos'}</span></button><input type="file" accept="image/*" multiple hidden data-phfile>` : ''}</div>`;
  $$('[data-ph]', box).forEach((b) => b.onclick = () => photoViewer(a, +b.dataset.ph, mine, () => photoStrip(box, a, mine)));
  const add = $('[data-phadd]', box), file = $('[data-phfile]', box);
  if (!add) return;
  add.onclick = () => file.click();
  file.onchange = async () => {
    const files = [...file.files].slice(0, PHOTO_MAX - ph.length); if (!files.length) return;
    add.disabled = true;
    let done = 0;
    for (const f of files) {
      $('span', add).textContent = files.length > 1 ? `Adding ${done + 1} of ${files.length}…` : 'Adding…';
      try {
        const image = await shrinkPhoto(f, 1600);
        a.photos = [...(a.photos || []), await api(`/api/activities/${a.id}/photos`, json('POST', {image}))]; done++;
      } catch (x) { toast(x.message || "That photo couldn't be added"); break; }
    }
    if (done) photoChanged(a.id);
    if (afterChange) afterChange(); else photoStrip(box, a, mine);
  };
}
// full screen: swipe or the arrows for the next one; the owner can remove one
function photoViewer(a, start, mine, onChange) {
  let i = start;
  const v = document.createElement('div');
  v.className = 'ph-view'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', 'Photos');
  const draw = () => {
    const ph = a.photos, p = ph[i];
    v.innerHTML = `<div class="ph-bar"><button type="button" class="icon-btn" data-x aria-label="Close">${svg('close')}</button><span class="num">${i + 1} of ${ph.length}</span>
        ${mine ? `<button type="button" class="icon-btn" data-del aria-label="Remove this photo">${svg('trash')}</button>` : '<span class="ph-sp"></span>'}</div>
      <div class="ph-stage">${pimg(photoSrc(p), `width="${p.w}" height="${p.h}"`).replace('alt=""', `alt="Photo ${i + 1} of ${ph.length}"`)}</div>
      ${ph.length > 1 ? `<button type="button" class="ph-nav prev" data-step="-1" aria-label="Previous photo"${i ? '' : ' hidden'}>${svg('back')}</button>
        <button type="button" class="ph-nav next" data-step="1" aria-label="Next photo"${i < ph.length - 1 ? '' : ' hidden'}>${svg('back')}</button>` : ''}`;
    $('[data-x]', v).onclick = close;
    $$('[data-step]', v).forEach((b) => b.onclick = () => step(+b.dataset.step));
    const del = $('[data-del]', v);
    if (del) del.onclick = async () => {
      if (!confirm('Remove this photo?')) return;
      del.disabled = true;
      try {
        await api('/api/activity-photos/' + p.id, {method: 'DELETE'});
        a.photos = ph.filter((x) => x.id !== p.id); photoChanged(a.id); onChange();
        if (!a.photos.length) return close();
        i = Math.min(i, a.photos.length - 1); draw();
      } catch (x) { toast(x.message); del.disabled = false; }
    };
    $('[data-x]', v).focus();
  };
  const step = (d) => { const n = i + d; if (n >= 0 && n < a.photos.length) { i = n; draw(); } };
  const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); };
  let x0 = null;
  v.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  v.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) step(e.clientX < x0 ? 1 : -1); x0 = null; });
  function close() { document.removeEventListener('keydown', key); v.remove(); document.body.classList.remove('ph-open'); }
  document.addEventListener('keydown', key);
  document.body.append(v); document.body.classList.add('ph-open');
  draw();
}

// ---------- your own activity: cheers + comments by the title; who sees it lives in the Edit sheet ----------
async function ownSocial(el, a) {
  const box = $('#d-soc', el); if (!box) return;
  let s;
  try { s = await api(`/api/activities/${a.id}/social`); } catch (x) { return; }
  if (!box.isConnected) return;
  a._social = s;
  wireTalk(box, a.id, s, new URLSearchParams(location.search).get('tab') === 'comments');
}
function detailChecks(d) {
  return Object.entries(DETAIL_NAMES).map(([k, n]) => `<label class="check"><input type="checkbox" name="${k}"${d[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('');
}
const readChecks = (f) => Object.fromEntries(Object.keys(DETAIL_NAMES).map((k) => [k, f[k].checked]));
function visSeg(cur) {
  return `<div class="seg wide vis3" role="group" aria-label="Who can see it">${Object.keys(VIS).map((v) => `<button type="button" data-vis="${v}" aria-pressed="${v === cur}">${VIS_SHORT[v]}</button>`).join('')}</div>`;
}
function wireSeg(box, attr, onPick) {
  $$(`[data-${attr}]`, box).forEach((b) => b.onclick = () => {
    $$(`[data-${attr}]`, box).forEach((o) => o.setAttribute('aria-pressed', String(o === b))); onPick(b.dataset[attr]);
  });
}
// Sharing inside the Edit sheet (2026-10-12, Ben: not so prominent on every run). Returns save(), which sends the
// choice only when something changed.
function shareFields(box, aid, s) {
  let vis = s.visibility, usual = false;
  box.innerHTML = `<h3 class="ghead">Who can see it</h3>${visSeg(vis)}<p class="small muted vis-note"></p>
    <details class="sh-more"><summary>What they see</summary><div class="checks">${detailChecks(s.details)}</div>
      <p class="small muted">Splits and laps are shared only with pace. Private notes and Kit’s notes are never shared.</p>
      ${s.custom ? '<button type="button" class="linkbtn" id="sh-usual">Use my usual details</button>' : ''}</details>
    ${s.visibility !== 'me' ? `<a class="small" href="/activity/friends/${aid}" data-close>See what they see ›</a>` : ''}`;
  const note = $('.vis-note', box);
  const say = () => { note.textContent = vis === 'me' ? 'Only you. Nobody else can see it.' : vis === 'friends' ? 'Friends you have approved.' : 'Anyone with an account on this Kinetta server.'; };
  say(); wireSeg(box, 'vis', (v) => { vis = v; say(); });
  const u = $('#sh-usual', box); if (u) u.onclick = () => { usual = true; u.textContent = 'Your usual details will be used'; u.disabled = true; };
  return async () => {
    const d = Object.fromEntries(Object.keys(DETAIL_NAMES).map((k) => [k, $(`input[name="${k}"]`, box).checked]));
    const changed = Object.keys(d).some((k) => d[k] !== s.details[k]), body = {visibility: vis};
    if (usual) body.usual_details = true; else if (changed) body.details = d;
    if (vis === s.visibility && !usual && !changed) return;
    await api(`/api/activities/${aid}/sharing`, json('PUT', body)); socialChanged(aid);
  };
}

// ---------- Me > Friends: search by name or username, requests, your friends ----------
route(/^\/people\/([^/]+)$/, 'activity', async (el, login) => {
  login = decodeURIComponent(login);
  el.innerHTML = `<div class="top">${backBtn('People')}</div><div id="person-profile">${skel(2)}</div>`;
  wireBack(el, '/me/friends');
  const box = $('#person-profile', el);
  const draw = (r) => {
    const p = r.person;
    const action = r.mine ? '<button class="ghost" data-edit-profile>Edit profile</button>' :
      r.status === 'friends' ? '<span class="badge on">Friends</span>' :
      r.status === 'sent' ? '<button class="ghost" data-person-action="cancel">Request sent</button>' :
      r.status === 'incoming' ? '<button class="primary" data-person-action="accept">Approve request</button>' : '<button class="primary" data-person-action="add">Add friend</button>';
    box.innerHTML = `<div class="profile public-profile">${avatar(p, 'lg')}<div><h1>${esc(p.name)}</h1><div class="sub">@${esc(p.login)}</div><small class="muted">Joined ${esc(fdate(p.created, {month: 'long', year: 'numeric'}))}</small></div></div>
      ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}<div class="profile-actions">${action}${r.mine ? '' : '<button class="ghost" data-person-report>Report or block</button>'}</div>
      <div class="card"><h2>${r.mine ? 'Your activity overview' : 'Shared activity overview'}</h2><div class="hero">${stat('Activities', r.overview.activities)}${stat('Distance', U.dist(r.overview.distance_m), U.du())}${r.overview.time_s >= 3600 ? stat('Time', (r.overview.time_s / 3600).toLocaleString([], {maximumFractionDigits: 1}), 'h') : stat('Time', dur(r.overview.time_s, true))}</div>
        <div class="sport-overview">${(r.sports || []).map((s) => `<div class="row"><b>${esc(SPORT_NAMES[s.sport] || s.sport)}</b><span class="num">${s.activities} activities · ${s.distance_m ? U.dist(s.distance_m) + ' ' + U.du() : dur(s.time_s, true)}</span></div>`).join('')}</div><p class="small muted">${r.mine ? 'Others see only the activities you share with them.' : 'Only activities this person shares with you are included.'}</p></div>
      <h2 class="sec-head">${r.mine ? 'Your activities' : 'Shared activities'}</h2><div class="feed-list" id="person-activities">${r.items.length ? r.items.map((a) => postCard(a)).join('') : '<div class="card empty"><b>No shared activities yet</b>This person has not shared any activities you can see.</div>'}</div>
      <button class="ghost wide" id="person-more"${r.next ? '' : ' hidden'}>Show more</button>`;
    feedMaps(box); wireCheers(box);
    const edit = $('[data-edit-profile]', box); if (edit) edit.onclick = () => editProfileSheet();
    const act = $('[data-person-action]', box);
    if (act) act.onclick = async () => {
      act.disabled = true;
      try {
        const path = '/api/friends/' + encodeURIComponent(p.login);
        if (act.dataset.personAction === 'cancel') await api(path, {method: 'DELETE'});
        else if (act.dataset.personAction === 'accept') await api(path + '/accept', json('POST', {}));
        else await api('/api/friends', json('POST', {login: p.login}));
        invalidate('/api/friends'); invalidate('/api/people/'); App.cache.delete('feed:home');
        if (box.isConnected) draw(await api('/api/people/' + encodeURIComponent(p.login) + '/profile'));
      } catch (x) { toast(x.message); act.disabled = false; }
    };
    const report = $('[data-person-report]', box);
    if (report) report.onclick = () => reportSheet(p, {}, () => go('/me/friends', {replace: true}));
    const more = $('#person-more', box);
    let next = r.next;
    more.onclick = async () => {
      if (!next) return; more.disabled = true;
      try {
        const query = new URLSearchParams(next);
        const fresh = await api('/api/people/' + encodeURIComponent(p.login) + '/profile?' + query);
        if (!box.isConnected) return;
        $('#person-activities', box).insertAdjacentHTML('beforeend', fresh.items.map((a) => postCard(a)).join(''));
        next = fresh.next; more.hidden = !next; feedMaps(box); wireCheers(box);
      } catch (x) { toast(x.message); }
      more.disabled = false;
    };
  };
  await load('/api/people/' + encodeURIComponent(login) + '/profile', draw, {maxAge: 0});
});

route(/^\/me\/friends$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Friends</h1>
    <form class="searchbox" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span>
      <input type="search" name="q" placeholder="Search by name or username" aria-label="Search people" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"></form>
    <div id="fr-found"></div><div id="fr-lists">${skel(1)}</div>
    <a class="card tap row-link" href="/me/sharing"><span class="ri c-green">${svg('lock')}</span><span class="grow"><b>Sharing</b><small class="muted">Who sees new activities, and which details</small></span><span class="chev">${svg('chev')}</span></a>`;
  wireBack(el, '/me');
  const lists = $('#fr-lists', el), found = $('#fr-found', el), f = $('#fr-find', el);
  const person = (p, btns, cls = '') => `<div class="person ${cls}">${personLink(p)}<span class="btnrow tight">${btns}</span></div>`;
  const btnFor = (p) => ({friends: `<span class="badge on">${svg('check')} Friends</span>`,
    sent: `<button class="ghost sm" data-cancel="${esc(p.login)}">Requested</button>`,
    incoming: `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button>`})[p.status] || `<button class="primary sm" data-add="${esc(p.login)}">${svg('plus')}Add</button>`;
  let last = null, people = [];
  const who = (login) => (people.find((p) => p.login === login) || {}).name || login;
  const refresh = async () => { invalidate('/api/feed/friends'); invalidate('/api/people/'); App.cache.delete('feed:home'); App.cache.delete('/api/friends'); await load('/api/friends', draw, {maxAge: 0}); find(true); };
  const act = (box, sel, fn) => $$(sel, box).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { if (await fn(b) === false) { b.disabled = false; return; } await refresh(); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
  const wire = (box) => {
    act(box, '[data-add]', async (b) => { const r = await api('/api/friends', json('POST', {login: b.dataset.add})); toast(r.status === 'friends' ? `You and ${r.name} are friends now` : `Request sent to ${r.name}`); });
    act(box, '[data-ok]', async (b) => { await api(`/api/friends/${encodeURIComponent(b.dataset.ok)}/accept`, json('POST', {})); toast(`You and ${who(b.dataset.ok)} are friends now`); });
    act(box, '[data-no]', (b) => api(`/api/friends/${encodeURIComponent(b.dataset.no)}/decline`, json('POST', {})));
    act(box, '[data-cancel]', (b) => api('/api/friends/' + encodeURIComponent(b.dataset.cancel), {method: 'DELETE'}));
    act(box, '[data-blk]', async (b) => {
      if (!confirm(`Block ${who(b.dataset.blk)}? They can't see your activities, find you or ask to be friends, and you won't see theirs. They aren't told.`)) return false;
      await api(`/api/people/${encodeURIComponent(b.dataset.blk)}/block`, json('POST', {})); toast(`${who(b.dataset.blk)} is blocked`);
    });
    act(box, '[data-rm]', async (b) => {
      if (!confirm(`Remove ${who(b.dataset.rm)} from your friends? You'll stop seeing each other's friends-only activities.`)) return false;
      await api('/api/friends/' + encodeURIComponent(b.dataset.rm), {method: 'DELETE'});
    });
  };
  async function find(again) {
    const q = f.q.value.trim();
    if (q === last && !again) return; last = q;
    const request = ++searchVersion;
    found.setAttribute('aria-busy', 'true');
    try {
      const r = await api('/api/people/search?q=' + encodeURIComponent(q));
      if (request !== searchVersion || !found.isConnected) return;
      people = [...new Map(people.concat(r).map((p) => [p.login, p])).values()];
      found.innerHTML = `<h2 class="sec-head">${q ? 'Search results' : 'People on Kinetta'}</h2><div class="card list">${r.length ? r.map((p) => person(p, btnFor(p))).join('') : `<p class="small muted">${q ? `No people found for “${esc(q)}”.` : 'No other discoverable people yet.'}</p>`}</div>`;
      wire(found);
    } catch (x) { if (request === searchVersion && found.isConnected) { last = null; found.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" data-retry>Retry search</button>`; $('[data-retry]', found).onclick = () => find(true); } }
    finally { if (request === searchVersion) found.setAttribute('aria-busy', 'false'); }
  }
  let t, searchVersion = 0;
  f.q.oninput = () => { clearTimeout(t); last = null; searchVersion++; t = setTimeout(() => find(), 180); };
  viewResources.set(f, () => { clearTimeout(t); searchVersion++; });
  f.onsubmit = (e) => { e.preventDefault(); find(); };
  const draw = (r) => {
    Social.set(r.incoming.length); people = people.concat(r.incoming, r.friends, r.outgoing);
    lists.innerHTML = (r.incoming.length ? `<h2 class="sec-head">Waiting for you <span class="count">${r.incoming.length}</span></h2><div class="card list">${r.incoming.map((p) =>
        person(p, `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button><button class="ghost sm" data-no="${esc(p.login)}">Decline</button><button class="ghost sm danger" data-blk="${esc(p.login)}" aria-label="Block ${esc(p.name)}">Block</button>`, 'req')).join('')}</div>` : '') +
      `<h2 class="sec-head">Your friends${r.friends.length ? ` <span class="count">${r.friends.length}</span>` : ''}</h2><div class="card list">${r.friends.length ? r.friends.map((p) => person(p, `<button class="ghost sm" data-rm="${esc(p.login)}" aria-label="Remove ${esc(p.name)}">Remove</button>`)).join('')
        : '<p class="small muted">No friends yet. Search for someone above. They approve it first, then you each see what the other shares with friends.</p>'}</div>` +
      (r.outgoing.length ? `<h2 class="sec-head">Requests you sent</h2><div class="card list">${r.outgoing.map((p) => person(p, `<button class="ghost sm" data-cancel="${esc(p.login)}">Cancel</button>`)).join('')}</div>` : '');
    wire(lists);
  };
  await load('/api/friends', draw, {maxAge: 0});
  find();
});

// ---------- report or block someone (App Store guideline 1.2): from their activity or one of their comments ----------
const REPORT_WHY = {spam: 'Spam', abuse: 'Harassment or abuse', inappropriate: 'Inappropriate', other: 'Something else'};
function reportSheet(p, what = {}, onBlocked) {
  let why = null;
  sheet(`${p.name}`, `<form class="form" id="rp-form"><h3 class="ghead">Report ${what.comment_id ? 'this comment' : what.activity_id ? 'this activity' : 'this person'}</h3>
    <div class="checks">${Object.entries(REPORT_WHY).map(([k, n]) => `<label class="check"><input type="radio" name="why" value="${k}"> ${esc(n)}</label>`).join('')}</div>
    <label>Anything else? (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label>
    <p class="small muted">The people who run this Kinetta see your report and what was reported. ${esc(p.name)} isn't told who reported it.</p>
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Send report</button></div>
    <h3 class="ghead">Block ${esc(p.name)}</h3>
    <p class="small muted">You stop being friends, they can't see your activities, find you or ask to be friends, and you won't see their activities, cheers or comments. They aren't told. Undo it under Me › Sharing.</p>
    <button type="button" class="ghost wide danger" id="rp-block">Block ${esc(p.name)}</button></form>`, (b, close) => {
    const f = $('#rp-form', b);
    f.onchange = () => { why = (f.querySelector('input[name=why]:checked') || {}).value || null; };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (!why) { toast('Choose what is wrong'); return; }
      try { await api('/api/reports', json('POST', {login: p.login, reason: why, note: f.note.value.trim() || null, ...what})); close(); toast('Thanks. Your report was sent'); }
      catch (x) { toast(x.message); }
    };
    $('#rp-block', b).onclick = async () => {
      try {
        await api(`/api/people/${encodeURIComponent(p.login)}/block`, json('POST', {})); invalidate('/api/'); App.cache.delete('feed:home');
        close(); toast(`${p.name} is blocked`);
        if (onBlocked) onBlocked(); else go('/activity', {replace: true});
      } catch (x) { toast(x.message); }
    };
  });
}

// ---------- Me > Sharing: the usual choices for new activities ----------
route(/^\/me\/sharing$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Sharing</h1><div id="sh-body">${skel(2)}</div>`;
  wireBack(el, '/me');
  const s = await api('/api/sharing'), box = $('#sh-body', el);
  box.innerHTML = `<div class="card"><h2>Who sees new activities</h2>${visSeg(s.default)}
      <p class="small muted">Activities you already have keep their setting. You can change it on each activity.</p></div>
    <div class="card"><h2>What others see</h2><form class="checks" id="sh-d">${detailChecks(s.details)}</form>
      <p class="small muted">Distance, time and the type of activity are always shown to the people who can see it. Splits and laps are shared only with pace. Private notes and Kit’s notes are never shared. You can choose differently on each activity.</p></div>
    <div class="card"><h2>Friend search</h2><label class="check"><input type="checkbox" id="sh-find"${s.findable ? ' checked' : ''}> Let people find me by name</label>
      <p class="small muted">Off: you don't show up when people on this Kinetta search for friends. Friends you already have, and anyone who types your exact username, can still find you.</p></div>
    <div class="card"><h2>Hide the start and end of your route</h2>
      <div class="seg wide trim4" role="group" aria-label="Hide the start and end">${s.trims.map((m) => `<button type="button" data-trim="${m}" aria-pressed="${m === s.trim_m}">${esc(trimName(m))}</button>`).join('')}</div>
      <p class="small muted">Shared maps leave out this much at the start and at the end, so others can't see where you live. A route too short for that is shared without a map.</p></div>
    <div class="card list" id="sh-blocked"><h2>Blocked people</h2><p class="small muted">Loading…</p></div>`;
  const drawBlocked = (rows) => {
    const b = $('#sh-blocked', box); if (!b) return;
    b.innerHTML = `<h2>Blocked people</h2>${rows.length ? rows.map((p) => `<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>
      <button class="ghost sm" data-unblk="${esc(p.login)}">Unblock</button></div>`).join('') : '<p class="small muted">No one. To block someone, open one of their activities or comments and choose Report or block.</p>'}`;
    $$('[data-unblk]', b).forEach((x) => x.onclick = async () => {
      x.disabled = true;
      try { await api(`/api/people/${encodeURIComponent(x.dataset.unblk)}/block`, {method: 'DELETE'}); invalidate('/api/'); drawBlocked(await api('/api/blocks')); toast('Unblocked'); }
      catch (e) { toast(e.message); x.disabled = false; }
    });
  };
  load('/api/blocks', drawBlocked, {maxAge: 0}).catch(() => {});
  const save = async (body, msg) => {
    try { await api('/api/sharing', json('PUT', body)); invalidate('/api/'); toast(msg); } catch (x) { toast(x.message); }
  };
  wireSeg(box, 'vis', (v) => save({default: v}, `New activities: ${VIS[v].toLowerCase()}`));
  wireSeg(box, 'trim', (m) => save({trim_m: +m}, m === '0' ? 'Maps show the whole route' : `Maps hide the first and last ${trimName(+m)}`));
  const f = $('#sh-d', box); f.onchange = () => save({details: readChecks(f)}, 'Saved');
  $('#sh-find', box).onchange = async (e) => {
    const on = e.target.checked;
    try { await api('/api/sharing', json('PUT', {findable: on})); toast(on ? 'People can find you by name' : "You're hidden from friend search"); }
    catch (x) { e.target.checked = !on; toast(x.message); }
  };
});

// ---------- Notifications (2026-10-11, notify.py) ----------
// 2026-10-12 (Ben): the bell shows only your notifications; phone-notification settings live in Me > Settings
// (/me/notifications). /notifications lights no tab (it opens from several).
const PUSH_NAMES = {friends: 'Friend requests', cheers: CHEER.title, comments: 'Comments', dishes: 'Shared meals'};
const NOTE_ICON = {friend_request: 'people', friend_accepted: 'people', cheer: 'cheer', comment: 'comment', dish_shared: 'pot', report: 'lock'};
route(/^\/notifications$/, null, async (el) => {
  el.innerHTML = `<div class="top">${backBtn()}</div><h1>Notifications</h1><div id="nt-list">${skel(2)}</div>`;
  wireBack(el, '/today');
  await load('/api/notifications', (r) => {
    const list = $('#nt-list', el); if (!list) return;
    list.innerHTML = r.items.length ? `<div class="card list notes">${r.items.map((n) => `<a class="note${n.read ? '' : ' unread'}" href="${esc(n.link)}">
        <span class="note-av">${avatar(n.who)}<span class="note-k">${svg(NOTE_ICON[n.kind] || 'people')}</span></span>
        <span class="grow"><span class="note-t">${esc(n.text)}</span><small class="muted">${esc(when(n.created))}</small></span></a>`).join('')}</div>`
      : `<div class="card empty"><b>Nothing yet</b>Friend requests, ${esc(CHEER.many)}, comments and shared meals show up here.</div>`;
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    if (r.unread) api('/api/notifications/read', json('POST', {})).then(() => { App.me.notifications = 0; Social.badge(); invalidate('/api/notifications'); }).catch(() => {});
  }, {maxAge: 0});
});
route(/^\/me\/notifications$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Notification settings</h1><div id="nt-push">${skel(1)}</div>`;
  wireBack(el, '/me');
  await load('/api/notifications', (r) => {
    const box = $('#nt-push', el); if (!box) return;
    if (!r.push_ready) { box.innerHTML = '<div class="card"><h2>Phone notifications</h2><p class="small muted">This server isn\'t set up to send phone notifications. You still see everything under the bell.</p></div>'; return; }
    pushCard(box, r);
  }, {maxAge: 0});
});
const pushable = () => !Native.on && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function pushSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (e) { return null; } }
async function pushCard(box, r) {
  if (!box) return;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  if (!r.push_ready) { box.innerHTML = ''; return; }
  if (!pushable()) {
    box.innerHTML = `<div class="card"><h2>Phone notifications</h2><p class="small muted">${Native.on ? 'Coming to the iPhone app with its App Store version. Until then, you see them under the bell.'
      : ios ? 'On iPhone, add Kinetta to your Home Screen first (Share › Add to Home Screen), open it from there, then turn them on here.'
      : "This browser can't show notifications. You still see them under the bell."}</p></div>`;
    return;
  }
  const sub = await pushSub(), on = !!sub && Notification.permission === 'granted';
  box.innerHTML = `<div class="card"><h2>Phone notifications</h2>
    ${on ? `<div class="checks one" id="np-kinds">${Object.entries(PUSH_NAMES).map(([k, n]) => `<label class="check"><input type="checkbox" name="${k}"${r.push[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <button class="ghost wide" id="np-off">Turn off on this device</button>`
    : Notification.permission === 'denied' ? '<p class="small muted">Notifications are blocked for Kinetta in this browser\'s settings. Allow them there, then come back.</p>'
    : `<p class="small muted">Get a notification on this device when someone sends a friend request, sends ${esc(CHEER.many)}, comments, or shares a dish.</p>
      <button class="primary wide" id="np-on">${svg('heart')}Turn on</button>`}</div>`;
  const b = $('#np-on', box);
  if (b) b.onclick = async () => {
    b.disabled = true;
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('Notifications were not allowed'); pushCard(box, r); return; }
      const {key} = await api('/api/push/key'), reg = await navigator.serviceWorker.ready;
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), (ch) => ch.charCodeAt(0));
      const s = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: raw});
      await api('/api/push/subscribe', json('POST', s.toJSON()));
      toast('Notifications on for this device'); pushCard(box, r);
    } catch (x) { toast(x.message || 'Could not turn on notifications'); b.disabled = false; }
  };
  const off = $('#np-off', box);
  if (off) off.onclick = async () => {
    off.disabled = true;
    try { await api('/api/push/unsubscribe', json('POST', {endpoint: sub.endpoint})); await sub.unsubscribe(); toast('Notifications off for this device'); pushCard(box, r); }
    catch (x) { toast(x.message); off.disabled = false; }
  };
  const kinds = $('#np-kinds', box);
  if (kinds) kinds.onchange = async (e) => {
    const k = e.target.name, v = e.target.checked;
    try { r.push = (await api('/api/notifications/settings', json('PUT', {[k]: v}))).push; invalidate('/api/notifications'); }
    catch (x) { e.target.checked = !v; toast(x.message); }
  };
}
