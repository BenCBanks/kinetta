// Kinetta phone app — Part 5: friends and sharing (2026-10-11). Friends (found by name or username, approved by the
// other person), who sees each activity, which details they see, the Feed, read-only pages for friends' activities,
// cheers and comments. The server decides what anyone else gets (app/api_social.py); these pages only show it.
'use strict';

// The quick appreciation button. Its name lives only here, so it can be renamed in one place.
const CHEER = {verb: 'Cheer', done: 'Cheered', one: 'cheer', many: 'cheers', title: 'Cheers'};
const VIS = {me: 'Only me', friends: 'Friends', everyone: 'Everyone on this Kinetta'};
const VIS_SHORT = {me: 'Only me', friends: 'Friends', everyone: 'Everyone'};
const DETAIL_NAMES = {map: 'Map', heart_rate: 'Heart rate', pace: 'Pace and speed', splits: 'Splits and laps', elevation: 'Elevation',
  calories: 'Calories', description: 'Description', device: 'Device or watch'};
Object.assign(IC, {
  cheer: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  comment: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5M15 15c2.6 0 4.6 1.6 5.5 4.5"/>',
});
const trimName = (m) => (!m ? 'Off' : imp() ? {200: '⅛ mi', 400: '¼ mi', 800: '½ mi'}[m] : `${m} m`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// the number of friend requests waiting, on the Me tab (checked again at most once a minute)
const Social = {
  at: 0,
  badge() {
    const a = $('nav.tabs a[data-tab="me"]'); if (!a) return;
    const n = (App.me && App.me.friend_requests) || 0; let b = $('.tab-n', a);
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tab-n'; a.append(b); }
    b.innerHTML = `${n > 9 ? '9+' : n}<span class="vh"> friend request${n > 1 ? 's' : ''} waiting</span>`;
  },
  refresh() {
    Social.badge();
    if (!App.me || !navigator.onLine || Date.now() - Social.at < 60000) return;
    Social.at = Date.now();
    api('/api/friends/waiting').then((r) => { App.me.friend_requests = r.n; Social.badge(); }).catch(() => {});
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
  return {rows: all.slice(0, FEED_N), more: all.length > FEED_N || mine.length === FEED_N || theirs.length === FEED_N, friends: theirs.length};
}
async function homeFeed(el) {
  el.innerHTML = `${actTop(false)}${whoseSeg('')}<div id="ff-nudge"></div>
    <div class="feed-list" id="ff-list">${skel(3)}</div><button class="ghost feed-more" id="ff-more" hidden>Show more</button>`;
  wireWhose(el);
  const list = $('#ff-list', el), more = $('#ff-more', el), nudge = $('#ff-nudge', el);
  let items = [];
  const draw = (pg) => {
    items = pg.rows;
    list.innerHTML = items.length ? items.map((a) => postCard(a, {who: true})).join('') : `<div class="card empty"><b>Nothing here yet</b>
      Your activities and the ones your friends share show up here.<br><br><a class="primary" href="/me/import">Upload activities</a></div>`;
    nudge.innerHTML = '';
    if (!pg.friends) load('/api/friends', (r) => { if (nudge.isConnected) nudge.innerHTML = r.friends.length ? '' : findNudge; }).catch(() => {});
    more.hidden = !pg.more; feedMaps(list); wireCheers(list);
  };
  const findNudge = `<a class="card tap nudge" href="/me/friends"><span class="nudge-ico">${svg('people')}</span>
      <span class="grow"><b>Find your friends</b><small>Search by name, then see each other's runs and rides here.</small></span><span class="chev">${svg('chev')}</span></a>`;
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
    <div class="d-title card"><div class="post-hd">${avatar(a.owner)}<span class="ph-txt"><b>${esc(a.owner.name)}</b>
      <small>${esc(fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric'}))} at ${esc(ftime(a.start_time))}${a.device ? ' · ' + esc(a.device) : ''}</small></span>${sportMark(a.sport)}</div>
      <h1>${esc(a.name)}</h1>
      ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
      <div class="hero">${hero}</div>${sportStats(a) ? `<div class="hero more">${sportStats(a)}</div>` : ''}</div>
    ${a.line ? `<div class="map big" id="s-map" role="img" aria-label="Route map${a.ends_hidden ? ', without the start and end' : ''}"></div>
      ${a.ends_hidden ? '<p class="small muted map-note">The start and end of the route are hidden.</p>' : ''}` : ''}
    <div id="s-social"></div>
    ${a.chart ? '<div class="card"><h2>Charts</h2><div id="s-charts"></div></div>' : ''}
    ${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
    ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}
    ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}`;
  wireBack(el, mine ? `/activity/${a.id}` : '/activity');
  if (a.line) lazy($('#s-map', el), () => mapInto($('#s-map', el), [a.line], {sport: a.sport, ends: false})
    .catch(() => { $('#s-map', el).innerHTML = '<p class="empty">Map unavailable right now</p>'; }));
  socialBlock($('#s-social', el), a.id, a.social);
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

// cheers + comments under an activity (yours or a friend's)
function socialBlock(box, aid, s) {
  if (!box) return;
  const names = s.cheers.map((c) => c.name);
  const who = names.length ? `<p class="small cheer-who"><b>${esc(plural(names.length, CHEER.one, CHEER.many))}</b> from ${esc(names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : names.join(', '))}</p>` : '';
  box.innerHTML = `<div class="card social"><h2>${esc(CHEER.title)} and comments</h2>
    ${s.mine ? (who || `<p class="small muted">No ${esc(CHEER.many)} yet.</p>`) : `<button class="ghost wide cheer${s.just ? ' just' : ''}" aria-pressed="${s.cheered}">${svg('cheer')}<span>${esc(s.cheered ? CHEER.done : CHEER.verb)}</span></button>${who}`}
    <div class="comments">${s.comments.map((c) => `<div class="comment"><div class="c-hd"><b>${esc(c.name)}</b><small class="muted">${esc(when(c.created))}</small>
      ${c.can_delete ? `<button class="linkbtn danger" data-del="${c.id}" aria-label="Delete comment from ${esc(c.name)}">Delete</button>` : ''}</div><p>${esc(c.text)}</p></div>`).join('')}</div>
    <form class="form c-form"><label class="vh" for="c-${aid}">Add a comment</label><textarea id="c-${aid}" name="text" maxlength="500" rows="2" placeholder="Add a comment" required></textarea>
      <button class="primary wide">Post comment</button></form></div>`;
  const after = (fresh, just = false) => { invalidate('/api/shared/' + aid); invalidate('/api/activities/' + aid + '/social'); invalidate('/api/feed/friends'); App.cache.delete('feed:home'); socialBlock(box, aid, {...s, ...fresh, just}); };
  const cb = $('.cheer', box);
  if (cb) cb.onclick = async () => {
    cb.disabled = true;
    try {
      if (s.cheered) { await api(`/api/activities/${aid}/cheer`, {method: 'DELETE'}); after({cheered: false, cheers: s.cheers.filter((c) => c.login !== App.me.login)}); }
      else after(await api(`/api/activities/${aid}/cheer`, json('POST', {})), true);
    } catch (x) { toast(x.message); cb.disabled = false; }
  };
  $$('[data-del]', box).forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this comment?')) return;
    b.disabled = true;
    try { await api('/api/comments/' + b.dataset.del, {method: 'DELETE'}); after({comments: s.comments.filter((c) => String(c.id) !== b.dataset.del)}); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
  const f = $('.c-form', box);
  f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    const btn = $('button', f); btn.disabled = true;
    try { after(await api(`/api/activities/${aid}/comments`, json('POST', {text}))); }
    catch (x) { toast(x.message); btn.disabled = false; }
  };
}

// ---------- your own activity: who sees it, which details, cheers + comments ----------
async function ownSocial(el, a) {
  const share = $('#d-share', el), soc = $('#d-social', el); if (!share) return;
  let s;
  try { s = await api(`/api/activities/${a.id}/social`); } catch (x) { return; }
  if (!share.isConnected) return;
  const on = Object.keys(DETAIL_NAMES).filter((k) => s.details[k] && (k !== 'splits' || s.details.pace)).map((k) => DETAIL_NAMES[k].toLowerCase());
  // one tappable line (2026-10-11 polish); the details and "See what they see" are in the sheet
  share.innerHTML = `<button class="card tap share-row" id="sh-edit"><span class="ico">${svg(s.visibility === 'me' ? 'lock' : 'people')}</span>
    <span class="grow"><b>${esc(s.visibility === 'me' ? 'Only you can see this' : `Shared with ${VIS[s.visibility].replace('Everyone', 'everyone').replace('Friends', 'friends')}`)}</b>
    <small class="muted">${s.visibility === 'me' ? 'Tap to share it' : esc(['distance and time', ...on].join(', '))}${s.visibility !== 'me' && s.details.map && s.trim_m ? ' · map ends hidden' : ''}</small></span>
    <span class="chev">${svg('chev')}</span></button>`;
  $('#sh-edit', share).onclick = () => shareSheet(a.id, s);
  if (s.visibility !== 'me' || s.cheers.length || s.comments.length) socialBlock(soc, a.id, s);
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
function shareSheet(aid, s) {
  let vis = s.visibility, usual = false;
  sheet('Sharing', `<form class="form" id="sh-form"><h3 class="ghead">Who can see this activity</h3>${visSeg(vis)}
    <p class="small muted vis-note"></p>
    <h3 class="ghead">What they see</h3><div class="checks">${detailChecks(s.details)}</div>
    <p class="small muted">Splits and laps are shared only with pace. Private notes and coach notes are never shared.</p>
    ${s.custom ? '<button type="button" class="linkbtn" id="sh-usual">Use my usual details</button>' : ''}
    ${s.visibility !== 'me' ? `<a class="small" href="/activity/friends/${aid}" data-close>See what they see ›</a>` : ''}
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (b, close) => {
    const f = $('#sh-form', b), note = $('.vis-note', b);
    const say = () => { note.textContent = vis === 'me' ? 'Only you. Nobody else can see it.' : vis === 'friends' ? 'Friends you have approved.' : 'Anyone with an account on this Kinetta server.'; };
    say(); wireSeg(b, 'vis', (v) => { vis = v; say(); });
    const u = $('#sh-usual', b); if (u) u.onclick = () => { usual = true; u.textContent = 'Your usual details will be used'; u.disabled = true; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = readChecks(f), changed = Object.keys(d).some((k) => d[k] !== s.details[k]), body = {visibility: vis};
      if (usual) body.usual_details = true; else if (changed || s.custom) body.details = d;
      const btn = $('button.primary', f); btn.disabled = true;
      try { await api(`/api/activities/${aid}/sharing`, json('PUT', body)); invalidate('/api/'); close(); toast('Sharing saved'); render(); }
      catch (x) { toast(x.message); btn.disabled = false; }
    };
  });
}

// ---------- Me > Friends: search by name or username, requests, your friends ----------
route(/^\/me\/friends$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Friends</h1>
    <form class="searchbox" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span>
      <input type="search" name="q" placeholder="Search by name or username" aria-label="Search people" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"></form>
    <div id="fr-found"></div><div id="fr-lists">${skel(1)}</div>
    <a class="card tap row-link" href="/me/sharing"><span class="ri c-green">${svg('lock')}</span><span class="grow"><b>Sharing</b><small class="muted">Who sees new activities, and which details</small></span><span class="chev">${svg('chev')}</span></a>`;
  wireBack(el, '/me');
  const lists = $('#fr-lists', el), found = $('#fr-found', el), f = $('#fr-find', el);
  const person = (p, btns) => `<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span><span class="btnrow tight">${btns}</span></div>`;
  const btnFor = (p) => ({friends: `<span class="badge on">${svg('check')} Friends</span>`,
    sent: `<button class="ghost sm" data-cancel="${esc(p.login)}">Requested</button>`,
    incoming: `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button>`})[p.status] || `<button class="primary sm" data-add="${esc(p.login)}">${svg('plus')}Add</button>`;
  let last = null, people = [];
  const who = (login) => (people.find((p) => p.login === login) || {}).name || login;
  const refresh = async () => { invalidate('/api/feed/friends'); App.cache.delete('feed:home'); App.cache.delete('/api/friends'); await load('/api/friends', draw, {maxAge: 0}); if (f.q.value.trim().length > 1) find(true); };
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
    act(box, '[data-rm]', async (b) => {
      if (!confirm(`Remove ${who(b.dataset.rm)} from your friends? You'll stop seeing each other's friends-only activities.`)) return false;
      await api('/api/friends/' + encodeURIComponent(b.dataset.rm), {method: 'DELETE'});
    });
  };
  async function find(again) {
    const q = f.q.value.trim();
    if (q.length < 2) { found.innerHTML = ''; last = null; return; }
    if (q === last && !again) return; last = q;
    try {
      const r = await api('/api/people/search?q=' + encodeURIComponent(q));
      if (q !== last) return;
      people = people.concat(r);
      found.innerHTML = `<div class="card list">${r.length ? r.map((p) => person(p, btnFor(p))).join('') : `<p class="small muted">No one called "${esc(q)}" here yet. They need a Kinetta account first.</p>`}</div>`;
      wire(found);
    } catch (x) { toast(x.message); }
  }
  let t; f.q.oninput = () => { clearTimeout(t); t = setTimeout(find, 250); };
  f.onsubmit = (e) => { e.preventDefault(); find(); };
  const draw = (r) => {
    Social.set(r.incoming.length); people = people.concat(r.incoming, r.friends, r.outgoing);
    lists.innerHTML = (r.incoming.length ? `<h2 class="sec-head">Waiting for you <span class="count">${r.incoming.length}</span></h2><div class="card list">${r.incoming.map((p) =>
        person(p, `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button><button class="ghost sm" data-no="${esc(p.login)}">Decline</button>`)).join('')}</div>` : '') +
      `<h2 class="sec-head">Your friends${r.friends.length ? ` <span class="count">${r.friends.length}</span>` : ''}</h2><div class="card list">${r.friends.length ? r.friends.map((p) => person(p, `<button class="ghost sm" data-rm="${esc(p.login)}" aria-label="Remove ${esc(p.name)}">Remove</button>`)).join('')
        : '<p class="small muted">No friends yet. Search for someone above. They approve it first, then you each see what the other shares with friends.</p>'}</div>` +
      (r.outgoing.length ? `<h2 class="sec-head">Requests you sent</h2><div class="card list">${r.outgoing.map((p) => person(p, `<button class="ghost sm" data-cancel="${esc(p.login)}">Cancel</button>`)).join('')}</div>` : '');
    wire(lists);
  };
  await load('/api/friends', draw, {maxAge: 0});
});

// ---------- Me > Sharing: the usual choices for new activities ----------
route(/^\/me\/sharing$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Sharing</h1><div id="sh-body">${skel(2)}</div>`;
  wireBack(el, '/me');
  const s = await api('/api/sharing'), box = $('#sh-body', el);
  box.innerHTML = `<div class="card"><h2>Who sees new activities</h2>${visSeg(s.default)}
      <p class="small muted">Activities you already have keep their setting. You can change it on each activity.</p></div>
    <div class="card"><h2>What others see</h2><form class="checks" id="sh-d">${detailChecks(s.details)}</form>
      <p class="small muted">Distance, time and the type of activity are always shown to the people who can see it. Splits and laps are shared only with pace. Private notes and coach notes are never shared. You can choose differently on each activity.</p></div>
    <div class="card"><h2>Friend search</h2><label class="check"><input type="checkbox" id="sh-find"${s.findable ? ' checked' : ''}> Let people find me by name</label>
      <p class="small muted">Off: you don't show up when people on this Kinetta search for friends. Friends you already have, and anyone who types your exact username, can still find you.</p></div>
    <div class="card"><h2>Hide the start and end of your route</h2>
      <div class="seg wide trim4" role="group" aria-label="Hide the start and end">${s.trims.map((m) => `<button type="button" data-trim="${m}" aria-pressed="${m === s.trim_m}">${esc(trimName(m))}</button>`).join('')}</div>
      <p class="small muted">Shared maps leave out this much at the start and at the end, so others can't see where you live. A route too short for that is shared without a map.</p></div>`;
  const save = async (body, msg) => {
    try { await api('/api/sharing', json('PUT', body)); invalidate('/api/'); toast(msg); } catch (x) { toast(x.message); }
  };
  wireSeg(box, 'vis', (v) => save({default: v}, `New activities: ${VIS[v].toLowerCase()}`));
  wireSeg(box, 'trim', (m) => save({trim_m: +m}, m === '0' ? 'Maps show the whole route' : `Maps hide the first and last ${trimName(+m)}`));
  const f = $('#sh-d', box); f.onchange = () => save({details: readChecks(f)}, 'Saved');
  $('#sh-find', box).onchange = (e) => save({findable: e.target.checked}, e.target.checked ? 'People can find you by name' : "You're hidden from friend search");
});
