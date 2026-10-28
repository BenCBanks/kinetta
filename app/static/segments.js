// Segments and leaderboards (#278, #285, #286; 2026-10-26). A segment is a named, one-way course that can't be changed
// once created; the review screen says so plainly before anyone presses Create. Leaderboards show one best time per
// member who has joined; your own times stay private until you do. Reports go to admins and never remove a time by
// themselves.
'use strict';
const SEG_WHY = {
  not_joined: 'You haven’t joined leaderboards, so your times stay private.',
  activity_private: 'This activity isn’t shared with Everyone, so its time stays private.',
  excluded_by_you: 'You kept this activity off leaderboards.',
  source: 'Times from this source (such as Garmin Connect) stay private for now.',
  map_hidden: 'This activity’s map isn’t shared, so its time stays private.',
  hidden_area: 'This pass is inside the start or finish your privacy settings hide, so it stays private.',
  held: 'Held for review. It isn’t public until an admin has looked at it.',
  excluded: 'Not counted on the leaderboard.',
  segment_private: 'This segment is only for you.',
  processing: 'This recording changed. Its times are being checked again.',
  assistance_unknown: 'Choose the assistance type on the activity before this time can be public.',
  assisted: 'Assisted, virtual or indoor activities stay off outdoor leaderboards.',
  paused: 'Leaderboards are paused on this Kinetta.',
};
const SEG_REPORT = [['gps', 'GPS or matching error'], ['wrong_sport', 'Wrong sport or motor-assisted'], ['privacy', 'Shows a private place'], ['abusive', 'Abusive name or description'],
  ['duplicate', 'Duplicate of another segment'], ['unsafe', 'Unsafe or no public access']];
const Segments = (() => {
  const SEG_KEY = () => App.me ? `kinetta.segmentReview:${serverKey()}:${App.me.id}` : null;
  const reviewOwner = () => App.me ? JSON.stringify([serverKey(), App.me.id]) : null;
  const sportName = (s) => SPORT_NAMES[s] || s;
  const pace = (s, d, sport) => sport === 'ride' ? `${U.speed(d / s)} ${U.su()}` : `${U.pace(s / d * 1000)}${U.pu()}`;

  async function list(body) {
    const q = new URLSearchParams(location.search), filter = q.get('f') || 'near', term = q.get('q') || '', sport = q.get('sport') || '';
    body.innerHTML = `<a class="primary wide" href="/segments/new">${svg('plus')}Create a segment</a>
      <p class="small muted">Segments are fixed stretches with times. Members can race the same course; joining the leaderboards is your choice.</p>
      <form class="searchbox" id="sg-find" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" value="${esc(term)}" placeholder="Search segments" aria-label="Search segments" maxlength="120" enterkeyhint="search"></form>
      <div class="chips" role="group" aria-label="Show">${[['near', 'Near the map'], ['saved', 'Saved'], ['mine', 'Created by me']].map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}
        <select id="sg-sport" class="chip" aria-label="Sport"><option value="">All sports</option>${PLAN_SPORTS.map(([k, l]) => `<option value="${k}"${sport === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="seg-map" id="sg-map" ${filter === 'near' && !term ? '' : 'hidden'}></div><div id="sg-list">${skel(2)}</div>`;
    const reload = (o) => go(`/progress/segments?${new URLSearchParams({ f: filter, ...(term ? {q: term} : {}), ...(sport ? {sport} : {}), ...o})}`, {replace: true});
    $$('[data-f]', body).forEach((b) => b.onclick = () => reload({f: b.dataset.f}));
    $('#sg-sport', body).onchange = (e) => reload({sport: e.target.value});
    $('#sg-find', body).onsubmit = (e) => { e.preventDefault(); reload({q: e.currentTarget.elements.q.value.trim()}); };
    let map = null, centre = store.get('kinetta.segCentre');
    const fetchList = async () => {
      const p = new URLSearchParams({q: term, sport, ...(filter === 'saved' ? {saved: true} : {}), ...(filter === 'mine' ? {mine: true} : {}), ...(centre && filter === 'near' ? {lat: centre[0].toFixed(4), lon: centre[1].toFixed(4)} : {})});
      try { draw(await api('/api/segments?' + p)); } catch (e) { const box = $('#sg-list', body); if (box) box.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; }
    };
    const draw = (rows) => {
      const box = $('#sg-list', body); if (!box) return;
      if (map) { map.group.clearLayers(); for (const r of rows) if (r.line) map.L.polyline(decode(r.line), {color: col('--route'), weight: 4}).addTo(map.group).on('click', () => go(`/segments/${r.id}`)); }
      box.innerHTML = rows.length ? `<div class="card list">${rows.map((r) => `<a class="row-link" href="/segments/${r.id}">${r.line ? miniRoute(r.line, r.sport) : ''}<span class="grow"><b>${esc(r.name)}</b>
          <small class="muted">${esc(sportName(r.sport))} · ${U.dist(r.distance_m)} ${U.du()}${r.ascent_m != null ? ` · ↑ ${U.elev(r.ascent_m)} ${U.eu()}` : ''}${r.audience === 'me' ? ' · only you' : ''}${r.status === 'retired' ? ' · retired' : ''}${r.saved ? ' · saved' : ''}</small></span>${svg('chev')}</a>`).join('')}</div>`
        : `<div class="card empty"><b>${filter === 'saved' ? 'No saved segments' : filter === 'mine' ? 'You haven’t created a segment' : 'No segments here yet'}</b>${filter === 'near' ? 'Move the map, or create the first one: a hill, a loop of the park, a sprint.' : 'Open a segment and tap Save to keep it here.'}</div>`;
    };
    if (filter === 'near' && !term) {
      try {
        map = await mapInto($('#sg-map', body), [], {ends: false});
        if (map) { if (centre) map.map.setView(centre, 13); else map.map.setView([39.5, -98.5], 3);
          let t = 0; map.map.on('moveend', () => { clearTimeout(t); t = setTimeout(() => { const c = map.map.getCenter(); centre = [c.lat, c.lng]; store.set('kinetta.segCentre', centre); fetchList(); }, 500); }); }
      } catch (_) { /* the list still works */ }
    }
    await fetchList();
  }

  // ---------- creating: draw (or pick a stretch), then review ----------
  function review(draft) {   // draft: {sport, line?, activity?, source, name?, description?, audience?, draftId?, clientId?}
    const d = {clientId: crypto.randomUUID(), audience: 'everyone', ...draft, owner: reviewOwner()};
    try { sessionStorage.setItem(SEG_KEY(), JSON.stringify(d)); } catch (_) { /* kept in memory */ }
    Segments.pending = d; go('/segments/review');
  }
  async function saveDraft(d) {   // explicit drafts stay private and editable until Create
    if (d.owner !== reviewOwner()) return false;
    const data = {sport: d.sport, line: d.line, activity: d.activity, source: d.source, name: d.name || '', description: d.description || '', audience: d.audience};
    try {
      if (d.draftId) await api('/api/segment-drafts/' + d.draftId, json('PUT', {data}));
      else d.draftId = (await api('/api/segment-drafts', json('POST', {data}))).id;
      try { sessionStorage.setItem(SEG_KEY(), JSON.stringify(d)); } catch (_) { /* memory */ }
      return true;
    } catch (_) { return false; }
  }
  async function reviewPage(el) {
    let d = Segments.pending; if (d?.owner !== reviewOwner()) d = null; if (!d) { try { d = JSON.parse(sessionStorage.getItem(SEG_KEY()) || 'null'); } catch (_) { d = null; } }
    if (!d || d.owner !== reviewOwner()) { go('/progress/segments', {replace: true}); return; }
    el.innerHTML = `<div class="top">${backBtn('Edit')}<span></span></div><h1>Review segment</h1><div id="sr-body">${skel(2)}</div>`;
    wireBack(el, '/segments/new');
    let chk;
    try { chk = await api('/api/segments/check', json('POST', {sport: d.sport, line: d.activity ? null : d.line, activity: d.activity || null})); }
    catch (e) { $('#sr-body', el).innerHTML = `<p class="err" role="alert">${esc(e.message)}</p><a class="ghost wide" href="${d.activity ? `/activity/${d.activity.activity_id}` : '/segments/new'}">Choose a different stretch</a>`; return; }
    d.line = chk.line; await saveDraft(d);
    const body = $('#sr-body', el); if (!body) return;
    body.innerHTML = `<div class="seg-course" id="sr-map"></div>
      <div class="bigstat">${stat('Sport', sportName(d.sport))}${stat('Distance', `${U.dist(chk.distance_m)} ${U.du()}`)}${stat('Direction', 'Start ▸ finish')}</div>
      ${chk.problems.length ? `<div class="plan-alert" role="alert"><p><b>This path can’t be a segment yet.</b></p><ul>${chk.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><a class="ghost sm" href="/segments/new">Back to edit</a></div>` : ''}
      ${chk.similar.length ? `<div class="card"><h2>Already on Kinetta</h2><p class="small muted">These published segments follow nearly the same path. Using one keeps everyone’s times on the same board.</p><div class="list">${chk.similar.map((s) => `<a class="row-link" href="/segments/${s.id}"><span class="grow">${esc(s.name)}<small class="muted">${U.dist(s.distance_m)} ${U.du()}</small></span>${svg('chev')}</a>`).join('')}</div></div>` : ''}
      <form class="form" id="sr-form">
        <label>Name<input name="name" maxlength="120" required value="${esc(d.name || '')}" placeholder="Park hill"></label>
        <label>Description <small class="muted">(optional)</small><textarea name="description" maxlength="500" rows="2">${esc(d.description || '')}</textarea></label>
        <fieldset class="seg-aud"><legend>Who can see it</legend>
          <label class="radio-row"><input type="radio" name="aud" value="everyone"${d.audience !== 'me' ? ' checked' : ''}><span><b>Everyone on Kinetta</b><small>Anyone signed in here can find it and race it. Their times appear only if they join leaderboards.</small></span></label>
          <label class="radio-row"><input type="radio" name="aud" value="me"${d.audience === 'me' ? ' checked' : ''}><span><b>Only me</b><small>A private course for your own times. You can publish it later, unchanged.</small></span></label></fieldset>
        <div class="seg-fixed" role="note">${svg('lock')}<div><b>A segment can’t be changed once it’s created.</b> Its name, description, path, start, finish, direction and sport stay exactly as shown, so everyone’s times are on the same course. To fix something later, you’d create a new segment with its own leaderboard${d.source === 'route' ? '; editing the route it came from never changes it' : ''}.</div></div>
        <label class="check-row"><input type="checkbox" name="ok" required> <span>I understand this segment can’t be edited after it’s created</span></label>
        <button class="primary wide" id="sr-create"${chk.problems.length ? ' disabled' : ''}>Create segment</button>
        <a class="ghost wide" href="/segments/new">Back to edit</a>
        <p class="small danger" id="sr-err" role="alert"></p><p class="small muted" id="sr-draft" role="status">Draft saved. It stays private until you create it.</p></form>`;
    mapInto($('#sr-map', body), [chk.line], {sport: d.sport}).then((v) => v && arrows(v, decode(chk.line))).catch(() => {});
    const f = $('#sr-form', body); let t = 0;
    f.oninput = () => { d.name = f.elements.name.value; d.description = f.elements.description.value; d.audience = f.elements.aud.value; clearTimeout(t);
      try { sessionStorage.setItem(SEG_KEY(), JSON.stringify(d)); } catch (_) { /* memory */ }
      $('#sr-draft', body).textContent = 'Saving draft…';
      t = setTimeout(async () => { const saved = await saveDraft(d); if (body.isConnected && d.owner === reviewOwner()) $('#sr-draft', body).textContent = saved ? 'Draft saved. It stays private until you create it.' : 'Couldn’t save the draft. Keep this screen open.'; }, 800); };
    f.onsubmit = async (e) => {
      e.preventDefault(); const btn = $('#sr-create', body); if (btn.disabled) return;
      const name = f.elements.name.value.trim(); if (!name) { f.elements.name.reportValidity(); return; }
      btn.disabled = true; btn.textContent = 'Creating…'; $('#sr-err', body).textContent = '';
      try {
        const s = await api('/api/segments', json('POST', {client_id: d.clientId, name, description: f.elements.description.value.trim() || null, sport: d.sport, line: d.activity ? null : d.line,
          activity: d.activity || null, source: d.source || 'map', audience: f.elements.aud.value, understood_fixed: true, draft_id: d.draftId || null}));
        try { sessionStorage.removeItem(SEG_KEY()); } catch (_) { /* none */ } Segments.pending = null;
        invalidate('/api/segments'); toast('Segment created'); go(`/segments/${s.id}`, {replace: true});
      } catch (x) { btn.disabled = false; btn.textContent = 'Create segment'; $('#sr-err', body).textContent = x.message + ' Your draft is kept.'; }
    };
  }
  function arrows(v, pts) {   // the direction, drawn along the course
    const n = Math.min(6, Math.max(2, Math.round(Plan.length(pts) / 300))), len = Plan.length(pts);
    for (let k = 1; k < n; k++) { const part = Plan.slice(pts, 0, len * k / n), a = part.at(-2), b = part.at(-1); if (!a || !b) continue;
      const mark = v.L.marker(b, {icon: v.L.divIcon({className: 'plan-arrow', iconSize: [16, 16], iconAnchor: [8, 8], html: `<span>${svg('up')}</span>`}), interactive: false, keyboard: false}).addTo(v.map); mark.getElement().firstElementChild.style.transform = `rotate(${Plan.bearing(a, b).toFixed(0)}deg)`; }
  }

  // ---------- one segment ----------
  async function page(el, id) {
    const tab = new URLSearchParams(location.search).get('tab') || 'board';
    el.innerHTML = `<div class="top">${backBtn('Segments')}<span id="sg-acts" class="acts"></span></div><div id="sg-body">${skel(2)}</div>`;
    wireBack(el, '/progress/segments');
    let s; try { s = await api(`/api/segments/${id}`); }
    catch (e) { $('#sg-body', el).innerHTML = `<div class="card empty"><b>${e.status === 410 ? 'This segment was removed' : 'Segment not found'}</b>${e.status === 410 ? 'It’s no longer available. Times on it were removed with it; the workouts themselves are untouched.' : 'It may be private, or the link may be wrong.'}</div>`; return; }
    const body = $('#sg-body', el);
    $('#sg-acts', el).innerHTML = `<button class="icon-btn" id="sg-share" aria-label="Share">${svg('share')}</button><button class="icon-btn" id="sg-menu" aria-label="More">${svg('more')}</button>`;
    body.innerHTML = `<h1>${esc(s.name)}</h1><p class="muted">${esc(sportName(s.sport))} · ${U.dist(s.distance_m)} ${U.du()}${s.ascent_m != null ? ` · ↑ ${U.elev(s.ascent_m)} ${U.eu()}` : ''}${s.creator ? ` · by <a href="/people/${esc(s.creator.login)}">${esc(s.creator.name)}</a>` : ''}</p>
      ${s.description ? `<p>${esc(s.description)}</p>` : ''}
      ${s.status === 'retired' ? `<p class="plan-warn" role="note">${svg('info')}Retired${s.status_reason ? ': ' + esc(s.status_reason) : ''}. It takes no new times; the board below is kept as it was.${s.replaced_by ? ` <a href="/segments/${s.replaced_by}">See the replacement</a>.` : ''}</p>` : ''}
      <div class="seg-course" id="sg-map"></div>
      <p class="seg-fixed small" role="note">${svg('lock')}<span>Fixed course, created ${esc(fdate(s.created, {month: 'short', day: 'numeric', year: 'numeric'}))}. It can’t be edited by anyone, so every time here is on the same course.</span></p>
      <div class="btnrow seg-btns"><button class="ghost" id="sg-save" aria-pressed="${s.saved}">${svg('bookmark')}${s.saved ? 'Saved' : 'Save'}</button>
        ${s.mine && s.audience === 'me' && s.status === 'active' ? `<button class="primary" id="sg-pub">Publish to everyone</button>` : ''}</div>
      <div class="seg tabs2" role="tablist"><button role="tab" data-t="board" aria-selected="${tab === 'board'}">Leaderboard</button><button role="tab" data-t="mine" aria-selected="${tab === 'mine'}">Your times</button></div>
      <div id="sg-tab"></div>`;
    mapInto($('#sg-map', body), [s.line], {sport: s.sport}).then((v) => v && arrows(v, decode(s.line))).catch(() => {});
    $('#sg-save', body).onclick = async (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') === 'true';
      try { await api(`/api/segments/${id}/bookmark`, {method: on ? 'DELETE' : 'POST'}); b.setAttribute('aria-pressed', String(!on)); b.innerHTML = `${svg('bookmark')}${on ? 'Save' : 'Saved'}`; invalidate('/api/segments'); } catch (x) { toast(x.message); } };
    const pub = $('#sg-pub', body); if (pub) pub.onclick = () => publish(s);
    $('#sg-share', el).onclick = () => share(s);
    $('#sg-menu', el).onclick = () => menu(s);
    $$('[data-t]', body).forEach((b) => b.onclick = () => { history.replaceState(null, '', `/segments/${id}?tab=${b.dataset.t}`); $$('[data-t]', body).forEach((x) => x.setAttribute('aria-selected', String(x === b))); show(b.dataset.t); });
    const show = (t) => t === 'mine' ? mine($('#sg-tab', body), s) : board($('#sg-tab', body), s);
    show(tab);
  }
  async function share(s) {
    const url = `${Native.base || location.origin}/segments/${s.id}`;
    if (s.audience !== 'everyone') { toast('Publish this segment first; only you can open it now.'); return; }
    try { if (navigator.share) { await navigator.share({title: s.name, text: `${s.name} · a ${sportName(s.sport).toLowerCase()} segment on Kinetta`, url}); return; } } catch (_) { return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (_) { toast(url); }
  }
  function publish(s) {
    sheet('Publish to everyone?', `<p><b>${esc(s.name)}</b> becomes visible to everyone signed in to this Kinetta: its name, description, path and the distance, exactly as they are now.</p>
      <ul class="small"><li>Publishing can’t be undone. A published segment can only be retired by an admin.</li><li>Nothing about your own activities is shared by this. Your times appear only if you join leaderboards.</li></ul>
      <label class="check-row"><input type="checkbox" id="pb-ok"> <span>Publish this segment, unchanged</span></label><button class="primary wide" id="pb-go" disabled>Publish</button><button class="ghost wide" data-close>Cancel</button>`, (b, close) => {
      $('#pb-ok', b).onchange = (e) => { $('#pb-go', b).disabled = !e.target.checked; };
      $('#pb-go', b).onclick = async () => { try { await api(`/api/segments/${s.id}/publish`, json('POST', {understood_public: true})); close(); toast('Published'); render(); } catch (x) { toast(x.message); } };
    });
  }
  function menu(s) {
    sheet(s.name, `<div class="list card">
      ${s.mine && s.audience === 'me' ? `<button class="row-link danger" data-del>${svg('trash')}<span class="grow">Delete this private segment<small class="muted">Its times go with it; your activities stay.</small></span></button>` : ''}
      ${s.mine && s.audience === 'everyone' && s.status === 'active' ? `<button class="row-link" data-retire>${svg('flag')}<span class="grow">Ask for it to be retired<small class="muted">Admins review it; other people’s times aren’t deleted.</small></span></button>` : ''}
      ${!s.mine && s.audience === 'everyone' ? `<button class="row-link" data-report>${svg('flag')}<span class="grow">Report this segment</span></button>` : ''}
      <a class="row-link" href="/segments/new">${svg('plus')}<span class="grow">Create a different segment<small class="muted">Segments can’t be edited; a corrected course is a new one</small></span></a></div>`, (b, close) => {
      const x = (sel, fn) => { const e = $(sel, b); if (e) e.onclick = () => { close(); fn(); }; };
      x('[data-report]', () => report(s)); x('[data-retire]', () => report(s, null, 'creator_request'));
      x('[data-del]', () => sheet('Delete this segment?', '<p>Your times on it are deleted with it. Your activities stay.</p><button class="primary danger-btn wide" data-y>Delete segment</button><button class="ghost wide" data-close>Keep it</button>', (b2, c2) => {
        $('[data-y]', b2).onclick = async () => { try { await api(`/api/segments/${s.id}`, {method: 'DELETE'}); c2(); invalidate('/api/segments'); toast('Segment deleted'); go('/progress/segments', {replace: true}); } catch (e) { toast(e.message); } }; }));
    });
  }
  function report(s, row = null, reason = null) {
    const reasons = reason ? [[reason, 'Retire this segment']] : row ? SEG_REPORT.filter(([k]) => ['gps', 'wrong_sport', 'privacy', 'abusive'].includes(k)) : SEG_REPORT.filter(([k]) => k !== 'wrong_sport');
    sheet(reason ? 'Ask to retire' : row ? `Report ${row.name}’s time` : 'Report segment', `<form class="form" id="rp-f">
      ${reason ? '<p>Retiring stops new times on it. The board stays readable unless there’s a privacy problem. Tell the admins why.</p>' : `<fieldset><legend>What’s wrong?</legend>${reasons.map(([k, l], i) => `<label class="radio-row"><input type="radio" name="r" value="${k}"${i ? '' : ' checked'}><span>${l}</span></label>`).join('')}</fieldset>`}
      <label>Details <small class="muted">(optional, only admins see this)</small><textarea name="note" maxlength="500" rows="3"></textarea></label>
      <p class="small muted">Admins review reports. A report doesn’t remove anything by itself, and ${row ? 'the person isn’t told who reported it' : 'your name isn’t shown to anyone else'}.</p>
      <button class="primary wide">Send</button><p class="small danger" id="rp-err" role="alert"></p></form>`, (b, close) => {
      $('#rp-f', b).onsubmit = async (e) => { e.preventDefault(); const f = e.currentTarget;
        try { const r = await api(`/api/segments/${s.id}/report`, json('POST', {reason: reason || f.elements.r.value, login: row?.login || null, note: f.elements.note.value.trim() || null}));
          close(); toast(r.already ? 'You already reported this. The admins have it.' : 'Thanks. The admins will look at it.'); }
        catch (x) { $('#rp-err', b).textContent = x.message + ' What you wrote is kept.'; } };
    });
  }
  async function board(box, s, after = null) {
    if (!after) box.innerHTML = skel(1);
    let r; try { r = await api(`/api/segments/${s.id}/leaderboard${after ? '?after=' + encodeURIComponent(after) : ''}`); }
    catch (e) { box.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p><button class="ghost" id="lb-retry">Retry</button>`; $('#lb-retry', box).onclick = () => board(box, s); return; }
    const row = (x) => `<li class="lb-row${x.me ? ' me' : ''}"><span class="lb-rank num">${x.rank}</span>${avatar({login: x.login, name: x.name, photo: x.photo}, 'sm')}
      <a class="grow" href="/people/${esc(x.login)}"><b>${esc(x.name)}</b>${x.leader ? '<small class="lb-lead">Fastest time</small>' : ''}<small class="muted">${esc(fdate(x.date + 'T12:00:00Z', {month: 'short', day: 'numeric', year: 'numeric'}))}</small></a>
      <span class="lb-time"><b class="num">${dur(x.elapsed_s)}</b><small class="muted num">${pace(x.elapsed_s, s.distance_m, s.sport)}</small></span>
      ${x.me ? '' : `<button class="icon-btn lb-more" data-rep="${esc(x.login)}" data-name="${esc(x.name)}" aria-label="Report ${esc(x.name)}’s time">${svg('more')}</button>`}</li>`;
    if (after) { const ol = $('.lb', box); ol.insertAdjacentHTML('beforeend', r.rows.map(row).join('')); wireRows(box, s); moreBtn(box, s, r); return; }
    const me = r.me || {};
    const myCard = !r.public ? `<div class="card seg-me"><b>Only you can see this segment</b><p class="small muted">Publish it to compete with others. ${me.private_best ? `Your best: <b class="num">${dur(me.private_best)}</b>.` : ''}</p></div>`
      : r.paused ? `<div class="card seg-me"><b>${SEG_WHY.paused}</b><p class="small muted">Your own times are still under Your times.</p></div>`
      : `<div class="card seg-me">${me.rank ? `<p>Your best public time <b class="num">${dur(me.public_best)}</b> · rank <b class="num">${me.rank}</b> of ${r.count}</p>` : me.private_best ? `<p>Your fastest private time <b class="num">${dur(me.private_best)}</b></p><p class="small muted">${esc(SEG_WHY[me.why_not] || '')}</p>` : '<p class="small muted">No time on this segment yet. Complete it from start to finish in a recorded activity.</p>'}
        ${me.joined ? `<button class="linkbtn" id="lb-join">Leaderboard settings</button>` : `<button class="primary sm" id="lb-join">Join leaderboards</button>`}</div>`;
    box.innerHTML = `${myCard}${r.matching_update&&!r.rebuilding?'<p class="small muted" role="status">A matching update is available. Existing complete results remain visible while an admin arranges the rebuild.</p>':''}${r.processing ? `<p class="plan-warn small" role="status">${svg('info')}Checking activities. During a rebuild, the previous complete results stay visible until the replacement is ready.</p>` : ''}
      ${r.public && !r.paused ? (r.rows.length ? `<ol class="lb card">${r.rows.map(row).join('')}</ol>` : `<div class="card empty"><b>No public times yet</b>Members who join leaderboards and complete this ${sportName(s.sport).toLowerCase()} appear here.</div>`) : ''}
      <div id="lb-more"></div>
      <p class="small muted">One best time per member, in whole seconds; equal times share a place. Only ${sportName(s.sport).toLowerCase()}s shared with Everyone, by members who joined leaderboards, declared outdoors without motor assistance, from the start to the finish in order.${r.scope ? ' ' + esc(r.scope) : ''}</p>`;
    const j = $('#lb-join', box); if (j) j.onclick = () => joinSheet(() => board(box, s));
    wireRows(box, s); moreBtn(box, s, r);
  }
  function wireRows(box, s) { $$('[data-rep]', box).forEach((b) => b.onclick = () => report(s, {login: b.dataset.rep, name: b.dataset.name})); }
  function moreBtn(box, s, r) { const m = $('#lb-more', box); m.innerHTML = r.next ? '<button class="ghost wide" id="lb-next">Show more</button>' : ''; if (r.next) $('#lb-next', m).onclick = () => board(box, s, r.next); }
  async function joinSheet(after) {
    let st; try { st = await api('/api/segment-settings'); } catch (e) { toast(e.message); return; }
    sheet('Segment leaderboards', `<label class="switch-row"><span><b>Show my segment times on leaderboards</b><small>Your best time on each segment appears with your name and photo, from activities you share with Everyone. Joining includes your past eligible activities too.</small></span><input type="checkbox" role="switch" id="lj"${st.joined ? ' checked' : ''}></label>
      <ul class="small muted"><li>Never shown: heart rate, notes, exact start times, or activities shared only with you or friends.</li><li>Passes inside the start and finish your privacy settings hide stay private.</li><li>Keep one activity off leaderboards from that activity’s page.</li><li>Leave any time: your times come off every board at once.</li></ul>
      <button class="primary wide" data-close>Done</button>`, (b) => {
      $('#lj', b).onchange = async (e) => { try { await api('/api/segment-settings', json('PUT', {joined: e.target.checked})); toast(e.target.checked ? 'You’ve joined leaderboards' : 'Your times are off the leaderboards'); after?.(); } catch (x) { e.target.checked = !e.target.checked; toast(x.message); } };
    });
  }
  async function mine(box, s) {
    box.innerHTML = skel(1);
    let r; try { r = await api(`/api/segments/${s.id}/efforts`); } catch (e) { box.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; return; }
    box.innerHTML = (r.efforts.length ? `<ol class="card list seg-efforts">${r.efforts.map((e, i) => effortRow(e, s, i === 0 && e.state === 'ok')).join('')}</ol>` : '<div class="card empty"><b>No times yet</b>Record a GPS activity that covers the whole segment, start to finish. Past activities are checked automatically.</div>')
      + (r.near_misses.length ? `<details class="card"><summary>Activities near this segment that didn’t count</summary><ul class="small">${r.near_misses.map((m) => `<li><a href="/activity/${m.activity_id}">${esc(m.name)}</a>: ${esc(m.reason_text)}</li>`).join('')}</ul></details>` : '');
    if(s.mine&&s.audience==='me'&&s.matching_update&&!s.rebuilding){
      const owner=reviewOwner(),button=document.createElement('button');button.className='ghost wide';button.textContent='Recheck my private segment';box.prepend(button);
      button.onclick=()=>{if(!box.isConnected||owner!==reviewOwner())return;
        sheet('Recheck private times','<p>Check your private segment with the current matching rules. Its course stays fixed; your complete previous results stay visible until the replacement is ready.</p><label class="check-row"><input id="private-recheck-ok" type="checkbox">I confirm the recheck.</label><button class="primary wide" id="private-recheck-send" disabled>Recheck times</button><p id="private-recheck-error" role="alert"></p>',(body,close)=>{
          $('#private-recheck-ok',body).onchange=e=>$('#private-recheck-send',body).disabled=!e.target.checked;
          $('#private-recheck-send',body).onclick=async e=>{if(owner!==reviewOwner()||!box.isConnected)return;e.currentTarget.disabled=true;
            try{await api(`/api/segments/${s.id}/recheck`,json('POST',{generation:s.generation,confirmed:$('#private-recheck-ok',body).checked}));if(owner===reviewOwner()&&box.isConnected){close();toast('Checking private times');render();}}
            catch(x){if(owner===reviewOwner()&&body.isConnected){$('#private-recheck-error',body).textContent=x.message;e.currentTarget.disabled=false;}}
          };
        });
      };
    }
    wireAppeals(box);
  }
  function effortRow(e, s, best) {
    const why = e.public ? '<small class="good">On the leaderboard</small>' : `<small class="muted">${esc(SEG_WHY[e.why_not] || '')}${e.reason_text ? ' ' + esc(e.reason_text) : e.reason && e.why_not === 'excluded' ? ' ' + esc(e.reason) : ''}</small>`;
    const canAppeal = ['held', 'excluded'].includes(e.why_not) && e.reason !== 'duplicate' && e.appeal !== 'open';
    return `<li class="row-link seg-effort"><a class="grow" href="/activity/${e.activity_id}"><b class="num">${dur(e.elapsed_s)}</b>${best ? ' <span class="badge on">Your best</span>' : ''}
      <small class="muted">${esc(e.activity_name)} · ${esc(fdate(e.started, {month: 'short', day: 'numeric', year: 'numeric'}))} · ${pace(e.elapsed_s, s.distance_m || e.distance_m, s.sport || 'run')}</small>${why}${e.appeal === 'open' ? '<small class="muted">Review requested</small>' : ''}</a>
      ${canAppeal ? `<button class="ghost sm" data-appeal="${e.id}">Ask for review</button>` : ''}</li>`;
  }
  function wireAppeals(box) {
    $$('[data-appeal]', box).forEach((b) => b.onclick = () => sheet('Ask for a review', `<form class="form" id="ap-f"><p>An admin will look at this time again. Tell them what happened (for example, a GPS jump in a tunnel). It stays as it is until they decide.</p>
      <label>What happened<textarea name="note" maxlength="1000" rows="4" required></textarea></label><button class="primary wide">Send</button><p class="small danger" id="ap-err" role="alert"></p></form>`, (s2, close) => {
      $('#ap-f', s2).onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/segment-efforts/${b.dataset.appeal}/appeal`, json('POST', {note: e.currentTarget.elements.note.value.trim()})); close(); toast('Sent to the admins'); b.remove(); }
        catch (x) { $('#ap-err', s2).textContent = x.message + ' What you wrote is kept.'; } }; }));
  }

  // ---------- on an activity, and in settings ----------
  async function activityCard(box, aid) {
    const owner=reviewOwner(),seq=box._segmentRevision=(box._segmentRevision||0)+1;
    const live=()=>owner&&owner===reviewOwner()&&box.isConnected&&seq===box._segmentRevision;
    let r; try { r = await api(`/api/activities/${aid}/segment-efforts`); } catch (_) { if(live())box.innerHTML = ''; return; }
    if(!live())return;
    box.innerHTML = `<div class="card"><h2>Segments</h2>${r.processing ? '<p class="small muted" role="status">Checking for segments…</p>' : ''}
      ${r.efforts.length ? `<ol class="list seg-efforts">${r.efforts.map((e) => `<li class="row-link seg-effort"><a class="grow" href="/segments/${e.segment_id}?tab=mine"><b>${esc(e.segment_name)}</b>${e.personal_best ? ' <span class="badge on">Your best</span>' : ''}
          <small class="num">${dur(e.elapsed_s)}</small>${e.public ? '<small class="good">On the leaderboard</small>' : `<small class="muted">${esc(SEG_WHY[e.why_not] || '')}</small>`}</a></li>`).join('')}</ol>` : r.processing ? '' : '<p class="small muted">No segments on this activity.</p>'}
      <details class="segment-assistance"${r.assistance===null&&r.efforts.length?' open':''}><summary>Assistance: ${esc({unassisted:'outdoors, no motor assistance',assisted:'motor assisted',virtual:'virtual or indoors'}[r.assistance]||'not declared')}</summary>
        <form id="sa-declare" class="form"><p class="small muted">Outdoor leaderboards need your declaration for this activity. Undeclared, motor-assisted and virtual activities keep their times private. Imported activity types and the other checks still apply.</p>
        <label>Activity type<select name="assistance">${[['','Not declared'],['unassisted','Outdoors without motor assistance'],['assisted','Motor assisted'],['virtual','Virtual or indoors']].map(([v,label])=>`<option value="${v}"${(r.assistance||'')===v?' selected':''}>${label}</option>`).join('')}</select></label>
        <label class="check-row"><input name="confirmed" type="checkbox" required><span>I confirm this describes this activity.</span></label><button class="primary wide">Save declaration</button><p id="sa-status" class="small" role="status"></p></form></details>
      <label class="switch-row"><span><b>Keep off leaderboards</b><small>Times from this activity stay private, without changing who can see the activity.</small></span><input type="checkbox" role="switch" id="sa-ex"${r.excluded ? ' checked' : ''}></label>
      <div class="list"><button class="row-link" id="sa-seg">${svg('flag')}<span class="grow">Make a segment from part of this</span>${svg('chev')}</button></div></div>`;
    $('#sa-declare',box).onsubmit=async(e)=>{
      e.preventDefault();if(!live())return;const f=e.currentTarget,button=$('button',f),status=$('#sa-status',f);
      button.disabled=true;status.textContent='Saving declaration…';
      try{await api(`/api/activities/${aid}/segment-assistance`,json('PUT',{assistance:f.elements.assistance.value||null,revision:r.assistance_revision,confirmed:f.elements.confirmed.checked}));
        if(live()){toast('Declaration saved');activityCard(box,aid);}}
      catch(x){if(live())status.textContent=x.message+' Your selection is kept.';}
      finally{if(live())button.disabled=false;}
    };
    $('#sa-ex', box).onchange = async (e) => { if(!live())return;try { await api(`/api/activities/${aid}/leaderboards`, json('PUT', {excluded: e.target.checked})); } catch (x) { e.target.checked = !e.target.checked; toast(x.message); } };
    $('#sa-seg', box).onclick = async () => {
      if(!live())return;let s; try { s = await api(`/api/activities/${aid}/sections`); } catch (x) { toast(x.message); return; }
      if(!live())return;
      if (!s.sections.length) { toast('This activity has no GPS route.'); return; }
      const sport = PLAN_SPORTS.some(([k]) => k === s.sport) ? s.sport : 'run';
      const pick = (i) => stretchSheet('Choose the segment', s.sections[i].line, {note: '<p class="small muted">Only the path becomes the segment: no times, notes or dates. Choose a stretch away from where you started and finished if your privacy settings hide those.</p>',
        onUse: async (a, z, close) => { close(); review({sport, source: 'activity', activity: {activity_id: aid, section: i, start_m: a, end_m: z}}); }});
      if (s.sections.length === 1) pick(0);
      else sheet('Choose a section', `<div class="list card">${s.sections.map((x, i) => `<button class="row-link" data-s="${i}">${miniRoute(x.line, s.sport)}<span class="grow">Section ${i + 1}<small class="muted">${U.dist(x.distance_m)} ${U.du()}</small></span>${svg('chev')}</button>`).join('')}</div>`,
        (b, close) => $$('[data-s]', b).forEach((x) => x.onclick = () => { close(); pick(+x.dataset.s); }));
    };
  }
  function settingsRow(box) {
    box.innerHTML = `<div class="card list"><button class="row-link" id="sg-set">${svg('trophy')}<span class="grow"><b>Segment leaderboards</b><small class="muted" id="sg-set-s">Off until you join</small></span>${svg('chev')}</button></div>`;
    api('/api/segment-settings').then((s) => { const x = $('#sg-set-s', box); if (x) x.textContent = s.joined ? 'On: your eligible best times appear' : 'Off: your segment times stay private'; }).catch(() => {});
    $('#sg-set', box).onclick = () => joinSheet(() => settingsRow(box));
  }
  return {list, review, reviewPage, page, activityCard, settingsRow, pending: null};
})();

route(/^\/segments$/, 'progress', async () => go('/progress/segments', {replace: true}));
route(/^\/segments\/review$/, 'progress', (el) => Segments.reviewPage(el));
route(/^\/segments\/new$/, 'progress', async (el) => {
  if (await Planner.unavailable(el, {mode: 'segment', title: 'New segment', back: 'Segments', backHref: '/progress/segments'})) return;
  Planner.open(el, {mode: 'segment', title: 'New segment', key: 'segment-new', back: 'Segments', backHref: '/progress/segments',
    onSave: (st) => Segments.review({sport: st.sport, line: Plan.enc(st.line), source: 'map', ...(Segments.pending ? {name: Segments.pending.name, description: Segments.pending.description, audience: Segments.pending.audience, draftId: Segments.pending.draftId, clientId: Segments.pending.clientId} : {})})});
});
route(/^\/segments\/(\d+)$/, 'progress', (el, id) => Segments.page(el, +id));
