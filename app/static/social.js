// Kinetta phone app — Part 5: friends and sharing (2026-10-11). Friends (by exact username, approved by the other
// person), who sees each activity, which details they see, the Friends feed, read-only pages for friends' activities,
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

// ---------- Activity tab: the Friends view ----------
function friendCard(a) {
  const st = [];
  if (a.distance_m) st.push(stat('Distance', U.dist(a.distance_m), U.du()));
  if (a.distance_m && a.moving_s && a.shares.pace) { const r = rate(a); st.push(stat(r.label, r.v, r.u)); }
  st.push(stat('Time', dur(a.moving_s || a.elapsed_s)));
  if (st.length < 3 && a.ascent_m) st.push(stat('Elevation', U.elev(a.ascent_m), U.eu()));
  const counts = [a.cheers ? `<span class="badge${a.cheered ? ' on' : ''}">${svg('cheer')} ${a.cheers}</span>` : '',
    a.comments ? `<span class="badge">${svg('comment')} ${a.comments}</span>` : ''].join('');
  return `<a class="card tap act${a.line ? ' has-map' : ' no-route'}" href="/activity/friends/${a.id}" data-prefetch="/api/shared/${a.id}">
    <div><div class="hd">${sportMark(a.sport)}<div><b>${esc(a.name)}</b><small>${esc(a.owner.name)} · ${esc(when(a.start_time))}</small></div></div>
    <div class="stats3">${st.slice(0, 3).join('')}</div>${counts ? `<div class="badges">${counts}</div>` : ''}</div>
    ${a.line ? `<div class="fmap" data-line="${esc(a.line)}" data-sport="${esc(a.sport)}" aria-hidden="true">${miniRoute(a.line, a.sport)}</div>` : ''}</a>`;
}
async function friendsFeed(el) {
  el.innerHTML = `<div class="top"><h1>Activity</h1></div>${whoseSeg('friends')}
    <div class="feed-list" id="ff-list">${skel(3)}</div><button class="ghost feed-more" id="ff-more" hidden>Show more</button>`;
  wireWhose(el);
  const base = '/api/feed/friends?limit=25', list = $('#ff-list', el), more = $('#ff-more', el);
  let items = [];
  const draw = (rows) => {
    items = rows;
    list.innerHTML = rows.length ? rows.map(friendCard).join('') : `<div class="card empty"><b>Nothing from friends yet</b>
      When your friends share an activity with friends, it shows up here.<br><br><a class="primary" href="/me/friends">Find friends</a></div>`;
    more.hidden = rows.length < 25 || rows.length % 25 !== 0;
    feedMaps(list);
  };
  await load(base, draw);
  more.onclick = async () => {
    more.disabled = true; more.textContent = 'Loading…';
    try {
      const rows = await api(base + '&before=' + encodeURIComponent(items[items.length - 1].start_time));
      items = items.concat(rows); App.cache.set(base, {data: items, at: Date.now()});
      list.insertAdjacentHTML('beforeend', rows.map(friendCard).join('')); more.hidden = rows.length < 25; feedMaps(list);
    } catch (e) { toast(e.message); }
    more.disabled = false; more.textContent = 'Show more';
  };
}

// ---------- someone else's activity (read-only); for your own: what others see ----------
route(/^\/activity\/friends\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn()}</div>${skel(1)}<div class="sk block"></div>`;
  wireBack(el, '/activity?view=friends');
  await load(`/api/shared/${id}`, (a) => drawShared(el, a), {maxAge: 30000});
});
function drawShared(el, a) {
  const mine = a.social.mine, sh = a.shares, r = rate(a);
  const hero = (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', dur(a.moving_s || a.elapsed_s)) +
    (a.distance_m && sh.pace ? stat(r.label, r.v, r.u) : '');
  const splits = imp() ? a.splits_mi : a.splits_km;
  el.innerHTML = `<div class="top">${backBtn(mine ? 'Back' : 'Friends')}</div>
    ${mine ? '<div class="callout">This is what others see of your activity.</div>' : ''}
    <div class="d-title card"><div class="hd act"><div class="hd">${sportMark(a.sport)}<div><h1>${esc(a.name)}</h1>
      <div class="sub">${esc(a.owner.name)} · ${esc(fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric'}))} at ${esc(ftime(a.start_time))}${a.sport_label ? ' · ' + esc(a.sport_label) : ''}${a.device ? ' · ' + esc(a.device) : ''}</div></div></div></div>
      ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
      <div class="hero">${hero}</div>${sportStats(a) ? `<div class="hero more">${sportStats(a)}</div>` : ''}</div>
    ${a.line ? `<div class="map big" id="s-map" role="img" aria-label="Route map${a.ends_hidden ? ', without the start and end' : ''}"></div>
      ${a.ends_hidden ? '<p class="small muted map-note">The start and end of the route are hidden.</p>' : ''}` : ''}
    <div id="s-social"></div>
    ${a.chart ? '<div class="card"><h2>Charts</h2><div id="s-charts"></div></div>' : ''}
    ${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
    ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}
    ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}`;
  wireBack(el, mine ? `/activity/${a.id}` : '/activity?view=friends');
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
  const after = (fresh, just = false) => { invalidate('/api/shared/' + aid); invalidate('/api/activities/' + aid + '/social'); invalidate('/api/feed/friends'); socialBlock(box, aid, {...s, ...fresh, just}); };
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

// ---------- Me > Friends ----------
route(/^\/me\/friends$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Friends</h1>
    <div class="card"><h2>Add a friend</h2><form class="form" id="fr-add">
      <label>Their username<input name="login" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="send" required></label>
      <p class="small muted">Type their exact username (ask them: it's under Me &gt; Account). They approve it first. Then you can each see what the other shares with friends.</p>
      <button class="primary wide">Send request</button></form></div>
    <div id="fr-lists">${skel(1)}</div>
    <a class="card tap row-link" href="/me/sharing"><span><b>Sharing</b><br><small class="muted">Who sees new activities, and which details</small></span><span class="chev">${svg('chev')}</span></a>`;
  wireBack(el, '/me');
  const lists = $('#fr-lists', el);
  const row = (p, btns) => `<div class="row"><span><b>${esc(p.name)}</b><br><small class="muted">${esc(p.login)}</small></span><span class="btnrow tight">${btns}</span></div>`;
  const draw = (r) => {
    Social.set(r.incoming.length);
    lists.innerHTML = (r.incoming.length ? `<div class="card"><h2>Waiting for you <span class="muted">${r.incoming.length}</span></h2>${r.incoming.map((p) =>
        row(p, `<button class="primary" data-ok="${esc(p.login)}">Approve</button><button class="ghost" data-no="${esc(p.login)}">Decline</button>`)).join('')}</div>` : '') +
      `<div class="card"><h2>Your friends</h2>${r.friends.length ? r.friends.map((p) => row(p, `<button class="ghost" data-rm="${esc(p.login)}" aria-label="Remove ${esc(p.name)}">Remove</button>`)).join('')
        : '<p class="small muted">No friends yet. Add someone by their username above.</p>'}</div>` +
      (r.outgoing.length ? `<div class="card"><h2>Requests you sent</h2>${r.outgoing.map((p) => row(p, `<button class="ghost" data-cancel="${esc(p.login)}">Cancel</button>`)).join('')}</div>` : '');
    const act = (sel, fn) => $$(sel, lists).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { if (await fn(b) === false) { b.disabled = false; return; } invalidate('/api/feed/friends'); App.cache.delete('/api/friends'); await load('/api/friends', draw, {maxAge: 0}); }
      catch (x) { toast(x.message); b.disabled = false; }
    });
    const who = (login) => (r.incoming.concat(r.friends, r.outgoing).find((p) => p.login === login) || {}).name || login;
    act('[data-ok]', async (b) => { await api(`/api/friends/${encodeURIComponent(b.dataset.ok)}/accept`, json('POST', {})); toast(`You and ${who(b.dataset.ok)} are friends now`); });
    act('[data-no]', (b) => api(`/api/friends/${encodeURIComponent(b.dataset.no)}/decline`, json('POST', {})));
    act('[data-cancel]', (b) => api('/api/friends/' + encodeURIComponent(b.dataset.cancel), {method: 'DELETE'}));
    act('[data-rm]', async (b) => {
      if (!confirm(`Remove ${who(b.dataset.rm)} from your friends? You'll stop seeing each other's friends-only activities.`)) return false;
      await api('/api/friends/' + encodeURIComponent(b.dataset.rm), {method: 'DELETE'});
    });
  };
  const f = $('#fr-add', el);
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button', f); btn.disabled = true;
    try {
      const r = await api('/api/friends', json('POST', {login: f.login.value.trim()}));
      toast(r.status === 'friends' ? `You and ${r.name} are friends now` : `Request sent to ${r.name}`); f.reset();
      App.cache.delete('/api/friends'); await load('/api/friends', draw, {maxAge: 0});
    } catch (x) { toast(x.message); }
    btn.disabled = false;
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
    <div class="card"><h2>Hide the start and end of your route</h2>
      <div class="seg wide trim4" role="group" aria-label="Hide the start and end">${s.trims.map((m) => `<button type="button" data-trim="${m}" aria-pressed="${m === s.trim_m}">${esc(trimName(m))}</button>`).join('')}</div>
      <p class="small muted">Shared maps leave out this much at the start and at the end, so others can't see where you live. A route too short for that is shared without a map.</p></div>`;
  const save = async (body, msg) => {
    try { await api('/api/sharing', json('PUT', body)); invalidate('/api/'); toast(msg); } catch (x) { toast(x.message); }
  };
  wireSeg(box, 'vis', (v) => save({default: v}, `New activities: ${VIS[v].toLowerCase()}`));
  wireSeg(box, 'trim', (m) => save({trim_m: +m}, m === '0' ? 'Maps show the whole route' : `Maps hide the first and last ${trimName(+m)}`));
  const f = $('#sh-d', box); f.onchange = () => save({details: readChecks(f)}, 'Saved');
});
