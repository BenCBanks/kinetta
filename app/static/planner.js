// Route planner (#276, 2026-10-26): tap points on the map, see the distance as you go, save, use it in Track.
// Like On The Go Map: the map is the workspace; snapping to paths, Undo/Redo, loop, out-and-back and reverse sit in one
// bar. No segment, leaderboard or completed activity is involved. The server re-measures everything on Save.
// The same editor draws segment courses (segments.js passes mode 'segment'; Save becomes Review).
'use strict';
Object.assign(IC, {
  up: '<path d="M7 14l5-5 5 5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  snap: '<path d="M4 18c4-1 3-9 8-10s4 7 8 6"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="14" r="1.6"/>',
  straight: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
});
const PLAN_SPORTS = [['run', 'Run'], ['walk', 'Walk'], ['hike', 'Hike'], ['ride', 'Ride']];
const Plan = {
  enc(points) {   // [[lat, lon]] -> encoded polyline (precision 5), as the server expects
    let out = '', plat = 0, plon = 0;
    const put = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
    for (const [la, lo] of points) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); put(a - plat); put(b - plon); plat = a; plon = b; }
    return out;
  },
  metres(a, b) {
    const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  },
  length(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Plan.metres(pts[i - 1], pts[i]); return d; },
  // the whole route as one line: legs joined without repeating the shared point
  line(legs) { const out = []; for (const l of legs) { const p = l.pts || decode(l.line); for (const q of p) if (!out.length || Plan.metres(out[out.length - 1], q) > 0.5) out.push(q); } return out; },
  slice(pts, from, to) {   // the part between two distances along the line
    const out = []; let d = 0;
    for (let i = 0; i < pts.length; i++) {
      const step = i ? Plan.metres(pts[i - 1], pts[i]) : 0, prev = d; d += step;
      const at = (m) => { const t = step ? (m - prev) / step : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
      if (i && prev < from && d >= from) out.push(at(from));
      if (d >= from && d <= to) out.push(pts[i]);
      if (i && prev < to && d > to) { out.push(at(to)); break; }
    }
    return out;
  },
  bearing(a, b) { const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; },
};

// The route someone chose for Track (#276 item 10): the exact version, kept on this device for this account.
const planDraftKey = key => App.me ? `kinetta.planDraft:${serverKey()}:${App.me.id}:${key}` : null;
const PlanTrack = {
  key: () => App.me ? `kinetta.trackRoute:${serverKey()}:${App.me.id}` : null,
  get() { const k = PlanTrack.key(); return k ? store.get(k) : null; },
  set(r) { const k = PlanTrack.key(); if (k) r ? store.set(k, r) : store.del(k); },
  eraseDevice() {
    if (!App.me) return;
    const prefix = planDraftKey('');
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
    store.del(PlanTrack.key());
    sessionStorage.removeItem(`kinetta.segmentReview:${serverKey()}:${App.me.id}`);
    if (typeof Segments !== 'undefined') Segments.pending = null;
  },
  from(r) { return {id: r.id, version: r.loaded_version || r.version, name: r.name, sport: r.sport, distance_m: r.distance_m, line: r.full_line || r.line}; },
};

// ---------- the map editor ----------
const Planner = (() => {
  let S = null;      // {mode, key, sport, waypoints, legs[{mode, line, pts, rev, state}], snap, name, description, routeId, baseVersion, clientId}
  let view = null, layers = null, undo = [], redo = [], saveT = 0, elevT = 0, busy = false, elev = null, autosave = 'idle', localUnits = null;
  const legLen = (l) => l.dist ?? (l.dist = Plan.length(l.pts));
  const units = () => localUnits || (imp() ? 'mi' : 'km');
  const fmt = (m) => units() === 'mi' ? (m / MI).toFixed(2) : (m / 1000).toFixed(2);
  const snapshot = () => JSON.stringify({w: S.waypoints, l: S.legs.map(({mode, pts, state}) => ({mode, pts, state}))});
  function restore(js) { const o = JSON.parse(js); S.waypoints = o.w; S.legs = o.l.map((l) => ({...l, rev: 0, dist: null})); }
  function remember() { undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; }
  function straight(a, b, intent) { return {mode: 'manual', pts: [a, b], rev: 0, state: intent === 'manual' ? 'ok' : 'pending', dist: null}; }
  const total = () => S.legs.reduce((d, l) => d + legLen(l), 0);

  function open(el, opts) {
    clearTimeout(saveT); clearTimeout(elevT); busy = false; view = layers = null;
    S = {mode: opts.mode || 'route', key: opts.key, sport: opts.sport || store.get('kinetta.planSport') || 'run', waypoints: [], legs: [], snap: true,
         name: '', description: '', routeId: opts.routeId || null, baseVersion: opts.baseVersion || null, clientId: crypto.randomUUID(), title: opts.title};
    S.owner = readOwner();
    undo = []; redo = []; elev = null; autosave = 'idle'; localUnits = null;
    if (opts.plan) load(opts.plan);
    el.classList.add('planner-page');
    el.innerHTML = `<div class="top plan-top">${backBtn(opts.back || 'Routes')}<h1 class="plan-title">${esc(opts.title)}</h1>
        <button type="button" class="icon-btn" id="pl-search" aria-label="Search for a place">${svg('search')}</button></div>
      <div class="plan-sports seg" role="group" aria-label="Sport">${PLAN_SPORTS.map(([k, l]) => `<button type="button" data-sport="${k}" aria-pressed="${S.sport === k}">${svg(k)}${l}</button>`).join('')}</div>
      <div class="plan-map-wrap"><div class="plan-map" id="pl-map" role="application" aria-label="Route map. Tap to add a point; use Points for a list."></div>
        <button type="button" class="plan-total" id="pl-total" aria-live="polite" aria-label="Distance. Tap to switch miles and kilometres"></button>
        <div class="plan-side"><button type="button" class="icon-btn map-fab" id="pl-locate" aria-label="Locate me">${svg('locate')}</button><button type="button" class="icon-btn map-fab" id="pl-fit" aria-label="Fit route">${svg('fit')}</button></div>
        <p class="plan-hint" id="pl-hint"></p></div>
      <div class="plan-alert" id="pl-alert" role="alert" hidden></div>
      <div class="plan-bar" role="toolbar" aria-label="Route tools">
        <button type="button" id="pl-undo" aria-label="Undo">${svg('undo')}<span>Undo</span></button>
        <button type="button" id="pl-redo" aria-label="Redo">${svg('redo')}<span>Redo</span></button>
        <button type="button" id="pl-snap" aria-pressed="true">${svg('snap')}<span>Follow paths</span></button>
        <button type="button" id="pl-more" aria-label="More route tools">${svg('more')}<span>More</span></button>
        <button type="button" class="primary" id="pl-save">${S.mode === 'segment' ? 'Review' : 'Save'}</button></div>
      <button type="button" class="plan-elev" id="pl-elev" hidden></button>
      <p class="small muted plan-status" id="pl-status" role="status"></p>
      <p class="small muted">Online paths and heights send map points through this server to its map services (default: Valhalla/FOSSGIS). <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a></p>`;
    wireBack(el, opts.backHref || '/routes');
    $$('[data-sport]', el).forEach((b) => b.onclick = () => { if (S.sport === b.dataset.sport) return; remember(); S.sport = b.dataset.sport; store.set('kinetta.planSport', S.sport);
      $$('[data-sport]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      S.legs.forEach((l) => { if (l.mode === 'path') { l.state = 'pending'; l.rev++; } }); changed(); });   // a ride follows different paths from a walk
    $('#pl-undo', el).onclick = () => { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); changed(); };
    $('#pl-redo', el).onclick = () => { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); changed(); };
    $('#pl-snap', el).onclick = () => { S.snap = !S.snap; drawBar(); toast(S.snap ? 'New connections follow streets and trails' : 'New connections are straight lines'); };
    $('#pl-more', el).onclick = more;
    $('#pl-save', el).onclick = () => opts.onSave ? opts.onSave(api_state()) : saveSheet(opts);
    $('#pl-search', el).onclick = search;
    $('#pl-total', el).onclick = () => { localUnits = units() === 'mi' ? 'km' : 'mi'; drawTotal(); drawMarks(); };
    $('#pl-locate', el).onclick = locate;
    $('#pl-fit', el).onclick = fit;
    $('#pl-elev', el).onclick = elevationSheet;
    document.addEventListener('keydown', keys);
    mount(el, opts);
    return {state: () => S, persist};
  }
  function keys(e) {
    if (!S || !$('#pl-map')?.isConnected) { document.removeEventListener('keydown', keys); return; }
    if (document.activeElement?.matches('input,textarea,select') || $('.scrim')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? '#pl-redo' : '#pl-undo').click(); }
  }
  function load(p) {
    S.waypoints = p.waypoints.map((w) => [+w[0], +w[1]]);
    S.legs = p.legs.map((l) => ({mode: l.mode === 'track' ? 'track' : l.mode, pts: l.pts || decode(l.line), rev: 0, state: 'ok', dist: null}));
    for (const k of ['sport', 'name', 'description', 'clientId', 'routeId', 'baseVersion', 'snap']) if (p[k] !== undefined && p[k] !== null) S[k] = p[k];
  }
  async function mount(el, opts) {
    const state = S;
    const box = $('#pl-map', el);
    let mounted; try { mounted = await mapInto(box, [], {ends: false}); } catch (_) { mounted = null; }
    if (state !== S || state.owner !== readOwner()) return;
    view = mounted;
    if (!view || !box.isConnected) { if (box.isConnected) box.innerHTML = '<p class="muted pad">The map couldn’t load. Check your connection and try again.</p>'; return; }
    const {map, L} = view; layers = {legs: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map), points: L.layerGroup().addTo(map)};
    map.doubleClickZoom.disable();
    map.on('click', (e) => { if (Date.now() < (S.quietUntil || 0)) return; add([e.latlng.lat, e.latlng.lng]); });
    // resume: the server's autosaved draft if it's newer than this device's copy
    if (!opts.plan && S.key) await resume();
    if (state !== S || state.owner !== readOwner()) return;
    if (S.waypoints.length) fit(); else if (opts.center) map.setView(opts.center, 15); else locate(true);
    changed(false);
  }
  async function resume() {
    const state = S;
    let local = null, remote = null;
    try { local = store.get(planDraftKey(S.key)); } catch (_) { /* none */ }
    try { remote = await api('/api/route-drafts/' + S.key); } catch (_) { /* offline: the device copy */ }
    if (state !== S || state.owner !== readOwner()) return;
    const pick = [local, remote?.data && {...remote.data, at: Date.parse(remote.updated)}].filter((d) => d?.waypoints?.length).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (!pick) return;
    load(pick);
    toast('Picked up your draft where you left it', () => { remember(); S.waypoints = []; S.legs = []; changed(); });
  }

  // ---------- edits ----------
  function connect(a, b, mode) { return mode === 'manual' ? straight(a, b, 'manual') : {mode: 'path', pts: [a, b], rev: 1, state: 'pending', dist: null}; }
  function intentAt(i) { const l = S.legs[i]; return !l ? (S.snap ? 'path' : 'manual') : l.mode === 'manual' ? 'manual' : 'path'; }
  function add(p, at = S.waypoints.length) {
    if (S.waypoints.length >= 100) { toast('Routes can have up to 100 points'); return; }
    remember();
    if (at >= S.waypoints.length) { S.waypoints.push(p); if (S.waypoints.length > 1) S.legs.push(connect(S.waypoints.at(-2), p, S.snap ? 'path' : 'manual')); }
    else insert(at - 1, p, false);
    changed();
  }
  function insert(leg, p, rec = true) {   // a new point in the middle of connection `leg`
    if (rec) remember();
    const mode = intentAt(leg);
    S.waypoints.splice(leg + 1, 0, p);
    S.legs.splice(leg, 1, connect(S.waypoints[leg], p, mode), connect(p, S.waypoints[leg + 2], mode));
    if (rec) changed();
  }
  function move(i, p) {
    remember(); S.waypoints[i] = p;
    for (const j of [i - 1, i]) if (S.legs[j]) S.legs[j] = connect(S.waypoints[j], S.waypoints[j + 1], intentAt(j));
    changed();
  }
  function remove(i) {
    remember();
    const n = S.waypoints.length;
    if (n <= 1) { S.waypoints = []; S.legs = []; }
    else if (i === 0) { S.waypoints.shift(); S.legs.shift(); }
    else if (i === n - 1) { S.waypoints.pop(); S.legs.pop(); }
    else { const mode = intentAt(i - 1); S.waypoints.splice(i, 1); S.legs.splice(i - 1, 2, connect(S.waypoints[i - 1], S.waypoints[i], mode)); }
    changed();
  }
  function swap(i, j) {
    if (j < 0 || j >= S.waypoints.length) return;
    remember(); [S.waypoints[i], S.waypoints[j]] = [S.waypoints[j], S.waypoints[i]];
    S.legs = S.waypoints.slice(1).map((w, k) => connect(S.waypoints[k], w, intentAt(k)));
    changed();
  }
  function reverse() {   // paths are planned again (one-way streets and bike rules), not just flipped
    if (S.waypoints.length < 2) return;
    remember(); const modes = S.legs.map((l) => l.mode).reverse(), old = [...S.legs].reverse();
    S.waypoints.reverse();
    S.legs = old.map((l, k) => modes[k] === 'manual' ? straight(S.waypoints[k], S.waypoints[k + 1], 'manual') : connect(S.waypoints[k], S.waypoints[k + 1], 'path'));
    changed(); toast('Route reversed');
  }
  function loop() {
    if (S.waypoints.length < 2) { toast('Add at least two points first'); return; }
    if (Plan.metres(S.waypoints[0], S.waypoints.at(-1)) < 5) { toast('This route already ends where it starts'); return; }
    add([...S.waypoints[0]]); toast('Back to the start');
  }
  function outAndBack() {
    if (S.waypoints.length < 2) { toast('Add at least two points first'); return; }
    remember(); const back = S.waypoints.slice(0, -1).reverse(), n = S.waypoints.length, modes = S.legs.map((l) => l.mode).reverse();
    for (let k = 0; k < back.length; k++) { S.waypoints.push(back[k]); S.legs.push(modes[k] === 'manual' ? straight(S.waypoints[n + k - 1], back[k], 'manual') : connect(S.waypoints[n + k - 1], back[k], 'path')); }
    changed(); toast('Out and back the same way');
  }
  function setLeg(i, mode) { remember(); S.legs[i] = mode === 'manual' ? straight(S.waypoints[i], S.waypoints[i + 1], 'manual') : connect(S.waypoints[i], S.waypoints[i + 1], 'path'); changed(); }
  function clear() {
    sheet('Clear this route?', '<p>This removes every point. You can still Undo afterwards.</p><button class="ghost wide" data-keep>Keep it</button><button class="primary danger-btn wide" data-clear>Clear route</button>', (b, close) => {
      $('[data-keep]', b).onclick = close; $('[data-clear]', b).onclick = () => { remember(); S.waypoints = []; S.legs = []; elev = null; close(); changed(); };
    });
  }

  // ---------- following paths: coalesced, newest wins, failures keep the last good route ----------
  async function plan() {
    if (busy || !S) return;
    const i = S.legs.findIndex((l) => l.state === 'pending' && l.mode === 'path');
    if (i < 0) return;
    let j = i; while (j + 1 < S.legs.length && j - i < 24 && S.legs[j + 1].state === 'pending' && S.legs[j + 1].mode === 'path') j++;
    const ask = S.legs.slice(i, j + 1), revs = ask.map((l) => l.rev), pts = S.waypoints.slice(i, j + 2).map((p) => p.slice()), key = S;
    busy = true; drawTotal();
    try {
      const r = await api('/api/plan/path', json('POST', {sport: S.sport, points: pts}));
      if (key !== S) return;
      r.legs.forEach((res, k) => {
        const l = S.legs[i + k];
        if (!l || l !== ask[k] || l.rev !== revs[k]) return;      // edited meanwhile: that answer is stale
        if (res.ok) Object.assign(l, {pts: decode(res.line), state: 'ok', dist: null});
        else Object.assign(l, {state: 'failed', pts: [S.waypoints[i + k], S.waypoints[i + k + 1]], dist: null});
      });
    } catch (e) {
      if (key === S) for (const [k, l] of ask.entries()) if (l === S.legs[i + k] && l.rev === revs[k]) Object.assign(l, {state: 'offline', why: e.message});
    } finally { busy = false; }
    if (key === S) { drawAll(); plan(); }
  }

  // ---------- drawing ----------
  function changed(save = true) {
    if (!S || S.owner !== readOwner()) return;
    elev = null; drawAll(); plan();
    if (save) { keepDraft(); clearTimeout(saveT); const state = S; saveT = setTimeout(() => { if (state === S) persist(); }, 1200); autosave = 'waiting'; drawStatus(); }
    clearTimeout(elevT); elevT = setTimeout(elevation, 1600);
  }
  function drawAll() { drawLegs(); drawPoints(); drawMarks(); drawTotal(); drawBar(); drawAlert(); drawStatus(); drawElev(); }
  function drawLegs() {
    if (!layers) return; const {L} = view; layers.legs.clearLayers();
    const color = col('--route');
    S.legs.forEach((l, i) => {
      const bad = l.state === 'failed' || l.state === 'offline', manual = l.mode === 'manual';
      const style = bad ? {color: col('--alert'), weight: 4, dashArray: '6 8', opacity: .9} : manual ? {color, weight: 4, dashArray: '2 9', lineCap: 'round'} : {color, weight: 5, opacity: l.state === 'pending' ? .45 : .95};
      L.polyline(l.pts, {weight: 22, opacity: 0, interactive: true}).addTo(layers.legs).on('mousedown touchstart', (e) => grabLine(e, i));   // a wide, invisible handle
      L.polyline(l.pts, {...style, interactive: false}).addTo(layers.legs);
    });
  }
  function grabLine(e, i) {   // drag a line to add a point there; a tap adds it where you tapped
    const {map, L} = view; L.DomEvent.stop(e); map.dragging.disable();
    const ghost = L.circleMarker(e.latlng, {radius: 8, color: '#fff', weight: 3, fillColor: col('--route'), fillOpacity: 1, interactive: false}).addTo(map);
    const startPx = map.latLngToContainerPoint(e.latlng); let at = e.latlng;
    const moveTo = (ev) => { at = ev.latlng; ghost.setLatLng(at); };
    const end = () => { map.off('mousemove', moveTo); map.off('mouseup', end); document.removeEventListener('touchend', end); document.removeEventListener('mouseup', end);
      ghost.remove(); map.dragging.enable(); S.quietUntil = Date.now() + 400;
      if (map.latLngToContainerPoint(at).distanceTo(startPx) >= 0) insert(i, [at.lat, at.lng]); };
    map.on('mousemove', moveTo); map.on('mouseup', end); document.addEventListener('touchend', end, {once: true}); document.addEventListener('mouseup', end, {once: true});
    const touch = (ev) => { const t = ev.touches?.[0]; if (t) { const r = map.getContainer().getBoundingClientRect(); moveTo({latlng: map.containerPointToLatLng([t.clientX - r.left, t.clientY - r.top])}); } };
    map.getContainer().addEventListener('touchmove', touch, {passive: true}); document.addEventListener('touchend', () => map.getContainer().removeEventListener('touchmove', touch), {once: true});
  }
  function pin(L, i, n) {
    const kind = i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'mid';
    if (kind !== 'mid') return endIcon(L, kind, n > 2 && loopEnds(S.waypoints[0], S.waypoints[n - 1]));
    return L.divIcon({className: 'plan-pt', iconSize: [18, 18], iconAnchor: [9, 9], html: '<span></span>'});
  }
  function drawPoints() {
    if (!layers) return; const {L} = view; layers.points.clearLayers(); const n = S.waypoints.length;
    S.waypoints.forEach((w, i) => {
      const m = L.marker(w, {icon: pin(L, i, n), draggable: true, autoPan: true, keyboard: true, title: `Point ${i + 1} of ${n}`, zIndexOffset: i === 0 || i === n - 1 ? 500 : 0}).addTo(layers.points);
      m.on('dragend', () => { const p = m.getLatLng(); S.quietUntil = Date.now() + 400; move(i, [p.lat, p.lng]); });
      m.on('click', (e) => { L.DomEvent.stop(e); S.quietUntil = Date.now() + 400; pointSheet(i); });
    });
  }
  function drawMarks() {   // a numbered marker at each mile/km, and arrows showing the direction
    if (!layers) return; const {L} = view; layers.marks.clearLayers();
    const pts = Plan.line(S.legs), unit = units() === 'mi' ? MI : 1000;
    if (pts.length < 2) return;
    let d = 0, next = unit, arrow = unit / 2, n = 1;
    for (let i = 1; i < pts.length; i++) {
      const step = Plan.metres(pts[i - 1], pts[i]);
      while (step && d + step >= Math.min(next, arrow)) {
        const at = Math.min(next, arrow), t = (at - d) / step, p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        if (at === next) { L.marker(p, {icon: L.divIcon({className: 'plan-km', iconSize: [22, 22], iconAnchor: [11, 11], html: `<span>${n}</span>`}), interactive: false, keyboard: false}).addTo(layers.marks); n++; next += unit; }
        else { const mark = L.marker(p, {icon: L.divIcon({className: 'plan-arrow', iconSize: [16, 16], iconAnchor: [8, 8], html: `<span>${svg('up')}</span>`}), interactive: false, keyboard: false}).addTo(layers.marks); mark.getElement().firstElementChild.style.transform = `rotate(${Plan.bearing(pts[i - 1], pts[i]).toFixed(0)}deg)`; arrow += unit; }
        if (n > 300) return;
      }
      d += step;
    }
  }
  function drawTotal() {
    const box = $('#pl-total'); if (!box) return;
    const pending = busy || S.legs.some((l) => l.state === 'pending');
    const climb = elev && elev.ascent_m != null ? ` · ↑ ${U.elev(elev.ascent_m)} ${U.eu()}` : '';
    box.innerHTML = S.waypoints.length < 2 ? `<b class="num">0.00</b> ${units()}` : `<b class="num">${fmt(total())}</b> ${units()}${climb}${pending ? '<small> · updating</small>' : ''}`;
    box.classList.toggle('pending', pending);
    const hint = $('#pl-hint'); if (hint) { hint.textContent = !S.waypoints.length ? 'Tap the map to start your route' : S.waypoints.length === 1 ? 'Tap where to go next' : ''; hint.hidden = !hint.textContent; }
  }
  function drawBar() {
    const u = $('#pl-undo'), r = $('#pl-redo'), sn = $('#pl-snap'), sv = $('#pl-save'); if (!u) return;
    u.disabled = !undo.length; r.disabled = !redo.length;
    sn.setAttribute('aria-pressed', String(S.snap)); sn.innerHTML = `${svg(S.snap ? 'snap' : 'straight')}<span>${S.snap ? 'Follow paths' : 'Straight lines'}</span>`;
    sv.disabled = S.waypoints.length < 2 || S.legs.some((l) => l.state !== 'ok');
  }
  function drawAlert() {   // a connection with no path, or no answer: keep the route and offer a clearly marked straight line
    const box = $('#pl-alert'); if (!box) return;
    const i = S.legs.findIndex((l) => l.state === 'failed' || l.state === 'offline');
    if (i < 0) { box.hidden = true; return; }
    const l = S.legs[i], off = l.state === 'offline';
    box.hidden = false;
    box.innerHTML = `<p><b>${off ? 'Couldn’t reach the map service.' : `No ${S.sport === 'ride' ? 'bike' : 'walking'} path found between points ${i + 1} and ${i + 2}.`}</b> ${off ? esc(l.why || '') + ' ' : ''}Your route is kept.</p>
      <div class="btnrow"><button type="button" class="ghost sm" data-straight>Use a straight line</button><button type="button" class="ghost sm" data-retry>Retry</button><button type="button" class="linkbtn" data-undo>Undo</button></div>`;
    $('[data-straight]', box).onclick = () => sheet('Use a straight line?', `<p>Straight lines aren’t known roads or trails. They’re marked on the map and on the saved route, so check the way is passable before you go.</p><button class="primary wide" data-ok>Use a straight line</button><button class="ghost wide" data-no>Cancel</button>`, (b, close) => {
      $('[data-no]', b).onclick = close; $('[data-ok]', b).onclick = () => { close(); setLeg(i, 'manual'); }; });
    $('[data-retry]', box).onclick = () => { l.state = 'pending'; l.rev++; drawAll(); plan(); };
    $('[data-undo]', box).onclick = () => $('#pl-undo').click();
  }
  function drawStatus() {
    const box = $('#pl-status'); if (!box) return;
    const manual = S.legs.filter((l) => l.mode === 'manual').length;
    box.textContent = [manual ? `${manual} straight-line ${manual > 1 ? 'sections' : 'section'} (not known roads or trails)` : '',
      {waiting: 'Saving draft…', saved: 'Draft saved', local: 'Draft saved on this phone; it will sync when you’re back online', failed: 'Autosave isn’t working right now. Keep this screen open and save when you can.'}[autosave] || ''].filter(Boolean).join(' · ');
  }
  function drawElev() {
    const b = $('#pl-elev'); if (!b) return;
    b.hidden = S.waypoints.length < 2;
    b.innerHTML = elev ? `${svg('hike')}<span>Elevation: ↑ ${U.elev(elev.ascent_m)} ${U.eu()} ↓ ${U.elev(elev.descent_m)} ${U.eu()}${elev.unknown_m > 50 ? ' · some unknown' : ''}</span>${svg('chev')}` : `${svg('hike')}<span>${elev === false ? 'Elevation unavailable' : 'Elevation…'}</span>`;
  }
  function fit() { if (!view) return; const pts = Plan.line(S.legs).concat(S.waypoints); if (pts.length) view.map.fitBounds(view.L.latLngBounds(pts), {padding: [36, 36], maxZoom: 16}); }

  async function elevation() {
    if (!S || S.waypoints.length < 2 || S.legs.some((l) => l.state !== 'ok')) return;
    const key = snapshot();
    try { const r = await api('/api/plan/elevation', json('POST', {line: Plan.enc(Plan.line(S.legs))})); if (S && key === snapshot()) { elev = r; drawTotal(); drawElev(); } }
    catch (_) { if (S && key === snapshot()) { elev = false; drawElev(); } }
  }
  function elevationSheet() {
    if (!elev) { toast(elev === false ? 'Elevation isn’t available for this route right now.' : 'Still working out the elevation…'); return; }
    sheet('Elevation', `<div class="plan-profile" id="pl-profile"></div><p class="small muted">Approximate heights from satellite data (${esc(elev.source)}), about every ${Math.max(25, Math.round(total() / 200))} m. Bridges, tunnels and buildings can show as bumps.${elev.unknown_m ? ` No height data for about ${U.dist(elev.unknown_m)} ${U.du()}.` : ''}</p>`, (b) => profile($('#pl-profile', b), elev));
  }
  function profile(box, e) {
    const pts = e.profile.filter((p) => p[1] != null); if (pts.length < 2) { box.innerHTML = '<p class="muted">No height data here.</p>'; return; }
    const W = Math.max(300, box.clientWidth || 340), H = 140, pad = 34, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = xs[0], x1 = xs.at(-1) || 1, lo = Math.min(...ys), hi = Math.max(...ys) + 1;
    const X = (v) => pad + (v - x0) / (x1 - x0 || 1) * (W - pad - 6), Y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 26);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Elevation profile: lowest ${U.elev(lo)} ${U.eu()}, highest ${U.elev(hi)} ${U.eu()}">
      <path d="${d}L${X(x1)},${H - 18}L${X(x0)},${H - 18}Z" fill="var(--accent2)"/><path d="${d}" fill="none" stroke="var(--route)" stroke-width="2"/>
      <text class="yl" x="2" y="${Y(hi) + 4}">${U.elev(hi)}</text><text class="yl" x="2" y="${Y(lo)}">${U.elev(lo)}</text>
      <text class="yl" x="${pad}" y="${H - 4}">0</text><text class="yl" x="${W - 6}" y="${H - 4}" text-anchor="end">${fmt(x1)} ${units()}</text></svg>`;
  }

  // ---------- sheets ----------
  function pointSheet(i) {
    const n = S.waypoints.length, label = i === 0 ? 'Start' : i === n - 1 ? 'Finish' : `Point ${i + 1}`;
    const legBefore = S.legs[i - 1];
    sheet(label, `<div class="list card">
        ${legBefore ? `<button class="row-link" data-leg>${svg(legBefore.mode === 'manual' ? 'snap' : 'straight')}<span class="grow">Connection from point ${i}: ${legBefore.mode === 'manual' ? 'follow paths instead' : 'use a straight line instead'}</span></button>` : ''}
        ${i > 0 ? `<button class="row-link" data-up>${svg('up')}<span class="grow">Move earlier in the route</span></button>` : ''}
        ${i < n - 1 ? `<button class="row-link" data-down>${svg('down')}<span class="grow">Move later in the route</span></button>` : ''}
        <button class="row-link danger" data-remove>${svg('trash')}<span class="grow">Remove this point</span></button></div>`, (b, close) => {
      const act = (sel, fn) => { const x = $(sel, b); if (x) x.onclick = () => { close(); fn(); }; };
      act('[data-leg]', () => setLeg(i - 1, legBefore.mode === 'manual' ? 'path' : 'manual'));
      act('[data-up]', () => swap(i, i - 1)); act('[data-down]', () => swap(i, i + 1)); act('[data-remove]', () => remove(i));
    });
  }
  function pointsSheet() {   // the list version of the map: every point, reorder and remove without dragging
    const rows = () => S.waypoints.map((w, i) => `<li class="plan-row"><span class="plan-num">${i === 0 ? 'S' : i === S.waypoints.length - 1 ? 'F' : i + 1}</span>
        <span class="grow">${i === 0 ? 'Start' : i === S.waypoints.length - 1 ? 'Finish' : 'Point ' + (i + 1)}<small class="muted num">${w[0].toFixed(5)}, ${w[1].toFixed(5)}${i ? ` · ${fmt(S.legs.slice(0, i).reduce((d, l) => d + legLen(l), 0))} ${units()}` : ''}</small></span>
        <button class="icon-btn" data-u="${i}" aria-label="Move point ${i + 1} earlier"${i ? '' : ' disabled'}>${svg('up')}</button>
        <button class="icon-btn" data-d="${i}" aria-label="Move point ${i + 1} later"${i < S.waypoints.length - 1 ? '' : ' disabled'}>${svg('down')}</button>
        <button class="icon-btn" data-x="${i}" aria-label="Remove point ${i + 1}">${svg('trash')}</button></li>`).join('');
    sheet('Points', `<ol class="plan-list" id="pl-rows">${rows()}</ol><button class="ghost wide" data-centre>${svg('plus')}Add a point at the map centre</button>`, (b) => {
      const wire = () => { const box = $('#pl-rows', b); box.innerHTML = rows();
        $$('[data-u]', box).forEach((x) => x.onclick = () => { swap(+x.dataset.u, +x.dataset.u - 1); wire(); $(`[data-u="${Math.max(0, +x.dataset.u - 1)}"]`, box)?.focus(); });
        $$('[data-d]', box).forEach((x) => x.onclick = () => { swap(+x.dataset.d, +x.dataset.d + 1); wire(); $(`[data-d="${+x.dataset.d + 1}"]`, box)?.focus(); });
        $$('[data-x]', box).forEach((x) => x.onclick = () => { remove(+x.dataset.x); wire(); }); };
      wire();
      $('[data-centre]', b).onclick = () => { if (!view) return; const c = view.map.getCenter(); add([c.lat, c.lng]); wire(); };
    });
  }
  function more() {
    const two = S.waypoints.length >= 2;
    sheet('Route tools', `<div class="list card">
      <button class="row-link" data-points>${svg('list')}<span class="grow">Points<small class="muted">See, reorder and remove points in a list</small></span></button>
      <button class="row-link" data-loop${two ? '' : ' disabled'}>${svg('route')}<span class="grow">Back to start<small class="muted">Close the loop</small></span></button>
      <button class="row-link" data-oab${two ? '' : ' disabled'}>${svg('redo')}<span class="grow">Out and back<small class="muted">Return the same way</small></span></button>
      <button class="row-link" data-rev${two ? '' : ' disabled'}>${svg('undo')}<span class="grow">Reverse<small class="muted">Plans the paths again in the other direction</small></span></button>
      ${S.mode === 'route' ? `<button class="row-link" data-gpx>${svg('upload')}<span class="grow">Import a GPX file</span></button>` : ''}
      <button class="row-link danger" data-clear${S.waypoints.length ? '' : ' disabled'}>${svg('trash')}<span class="grow">Clear route</span></button></div>`, (b, close) => {
      const act = (sel, fn) => { const x = $(sel, b); if (x) x.onclick = () => { close(); fn(); }; };
      act('[data-points]', pointsSheet); act('[data-loop]', loop); act('[data-oab]', outAndBack); act('[data-rev]', reverse); act('[data-gpx]', importGpx); act('[data-clear]', clear);
    });
  }
  function importGpx() {
    const f = document.createElement('input'); f.type = 'file'; f.accept = '.gpx,application/gpx+xml,application/xml,text/xml';
    f.onchange = async () => {
      const file = f.files[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('GPX files can be up to 5 MB'); return; }
      try {
        const r = await api('/api/planned-routes/import', json('POST', {gpx: await file.text()}));
        const use = (t) => { const replace = () => { remember(); load({waypoints: t.waypoints, legs: t.legs}); if (!S.name) S.name = t.name; changed(); fit(); toast('Imported. Drag any point to change that part'); };
          if (S.waypoints.length) sheet('Replace your route?', '<p>The imported route replaces what’s on the map. You can Undo afterwards.</p><button class="primary wide" data-ok>Replace</button><button class="ghost wide" data-no>Cancel</button>', (b, close) => { $('[data-no]', b).onclick = close; $('[data-ok]', b).onclick = () => { close(); replace(); }; });
          else replace(); };
        if (r.tracks.length === 1) use(r.tracks[0]);
        else sheet('Choose a track', `<p class="small muted">This file has ${r.tracks.length} separate tracks. They aren’t joined, because that would invent a connection between them.</p><div class="list card">${r.tracks.map((t, i) => `<button class="row-link" data-t="${i}"><span class="grow">${esc(t.name)}<small class="muted">${U.dist(t.distance_m)} ${U.du()}</small></span>${svg('chev')}</button>`).join('')}</div>`,
          (b, close) => $$('[data-t]', b).forEach((x) => x.onclick = () => { close(); use(r.tracks[+x.dataset.t]); }));
      } catch (e) { toast(e.message + ' Your route is unchanged.'); }
    };
    f.click();
  }
  async function search() {
    sheet('Find a place', `<form class="searchbox" id="pl-q" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" placeholder="Park, street or town" aria-label="Place" maxlength="120" enterkeyhint="search" autocomplete="off"></form>
      <p class="small muted" id="pl-q-status" role="status">Search uses OpenStreetMap. Only what you type and the map area are sent.</p><div class="list card" id="pl-q-res" hidden></div>`, (b, close) => {
      const form = $('#pl-q', b), status = $('#pl-q-status', b), res = $('#pl-q-res', b);
      softFocus(form.elements.q);
      form.onsubmit = async (e) => {
        e.preventDefault(); const q = form.elements.q.value.trim(); if (q.length < 2) return;
        status.textContent = 'Searching…'; res.hidden = true;
        const c = view?.map.getCenter();
        try {
          const r = await api(`/api/plan/search?q=${encodeURIComponent(q)}${c ? `&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}` : ''}`);
          status.textContent = r.places.length ? '' : 'No places found. Try a different name.';
          res.hidden = !r.places.length;
          res.innerHTML = r.places.map((p, i) => `<button class="row-link" data-p="${i}"><span class="grow">${esc(p.name)}<small class="muted">${esc(p.detail)}</small></span>${svg('chev')}</button>`).join('');
          $$('[data-p]', res).forEach((x) => x.onclick = () => { const p = r.places[+x.dataset.p]; close();
            if (!view) return; if (p.bbox) view.map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], {maxZoom: 17}); else view.map.setView([p.lat, p.lon], 16); });
        } catch (x) { status.textContent = x.message; }
      };
    });
  }
  async function locate(quiet) {   // asks for location only when someone presses Locate me (or already allowed it)
    try {
      let p;
      if (typeof TrackNative !== 'undefined' && TrackNative.supported) { if (quiet) return; p = await TrackNative.locate(); p = [p.lat, p.lon]; }
      else {
        if (!navigator.geolocation) throw new Error('Location isn’t available here. Search for a place instead.');
        if (quiet && await navigator.permissions?.query({name: 'geolocation'}).then((s) => s.state, () => null) !== 'granted') return;
        const g = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, {enableHighAccuracy: true, timeout: 12000, maximumAge: 30000}));
        p = [g.coords.latitude, g.coords.longitude];
      }
      if (view) view.map.setView(p, 16);
    } catch (e) { if (!quiet) toast(e?.message && e.code === undefined ? e.message : 'Allow location to find where you are, or search for a place.'); }
  }

  // ---------- drafts and saving ----------
  function api_state() {
    return {sport: S.sport, waypoints: S.waypoints, legs: S.legs.map((l) => ({mode: l.mode, line: Plan.enc(l.pts)})), name: S.name, description: S.description,
            clientId: S.clientId, routeId: S.routeId, baseVersion: S.baseVersion, snap: S.snap, line: Plan.line(S.legs), distance_m: total()};
  }
  function keepDraft() {
    if (!S?.key || S.owner !== readOwner()) return false;
    try { localStorage.setItem(planDraftKey(S.key), JSON.stringify({...api_state(), line: undefined, at: Date.now()})); return true; }
    catch (_) { return false; }
  }
  async function persist() {
    if (!S || !S.key || S.owner !== readOwner()) return;
    const state = S;
    const data = {...api_state(), line: undefined, at: Date.now()};
    const local = keepDraft();
    try { await api('/api/route-drafts/' + S.key, json('PUT', {data})); if (state !== S || state.owner !== readOwner()) return; autosave = 'saved'; }
    catch (_) { if (state !== S || state.owner !== readOwner()) return; autosave = local ? 'local' : 'failed'; }
    drawStatus();
  }
  async function forget() {
    if (!S?.key) return;
    try { store.del(planDraftKey(S.key)); } catch (_) { /* none */ }
    try { await api('/api/route-drafts/' + S.key, {method: 'DELETE'}); } catch (_) { /* cleared on the next save */ }
  }
  function saveSheet(opts) {
    const st = api_state();
    sheet(S.routeId ? 'Save changes' : 'Save route', `<form class="form" id="pl-save-form">
        <label>Name<input name="name" maxlength="120" required value="${esc(S.name || '')}" placeholder="Morning loop"></label>
        <label>Notes <small class="muted">(optional, only you see them)</small><textarea name="description" maxlength="2000" rows="2">${esc(S.description || '')}</textarea></label>
        <p class="small muted">${PLAN_SPORTS.find(([k]) => k === S.sport)[1]} · ${fmt(st.distance_m)} ${units()}${S.legs.some((l) => l.mode === 'manual') ? ' · includes straight-line sections' : ''}. Saved routes are private to you.</p>
        <button class="primary wide" data-use>${svg('track')}Save and use in Track</button><button class="ghost wide" data-only>Save</button>
        <p class="small danger" id="pl-save-err" role="alert"></p></form>`, (b, close) => {
      const form = $('#pl-save-form', b), err = $('#pl-save-err', b);
      form.elements.name.oninput = () => { S.name = form.elements.name.value; keepDraft(); };
      form.elements.description.oninput = () => { S.description = form.elements.description.value; keepDraft(); };
      const go_ = async (useIt, btn) => {
        const name = form.elements.name.value.trim(); if (!name) { form.elements.name.reportValidity(); return; }
        $$('button', form).forEach((x) => x.disabled = true); btn.textContent = 'Saving…'; err.textContent = '';
        const body = {client_id: S.clientId, name, description: form.elements.description.value.trim() || null, sport: S.sport, waypoints: st.waypoints, legs: st.legs,
                      source: opts.source || 'drawn', base_version: S.baseVersion};
        try {
          const r = S.routeId ? await api('/api/planned-routes/' + S.routeId, json('PUT', body)) : await api('/api/planned-routes', json('POST', body));
          await forget(); invalidate('/api/planned-routes'); close();
          if (useIt) { PlanTrack.set(PlanTrack.from({...r, full_line: Plan.enc(st.line)})); toast('Route ready in Track'); go('/track'); }
          else { toast('Route saved'); go(`/routes/plan/${r.id}`, {replace: true}); }
        } catch (x) {
          $$('button', form).forEach((y) => y.disabled = false); btn.textContent = useIt ? 'Save and use in Track' : 'Save';
          if (x.code === 'route_changed') { close(); conflict(opts, body); return; }
          err.textContent = x.message + ' Your route is kept; try again.';
        }
      };
      $('[data-use]', b).onclick = (e) => { e.preventDefault(); go_(true, e.currentTarget); };
      $('[data-only]', b).onclick = (e) => { e.preventDefault(); go_(false, e.currentTarget); };
    });
  }
  function conflict(opts, body) {   // changed on another device: never overwrite silently
    sheet('Changed on another device', '<p>This route was saved somewhere else since you opened it. Load that version, or keep your edits as a separate copy.</p><button class="primary wide" data-copy>Save mine as a copy</button><button class="ghost wide" data-reload>Load the other version</button>', (b, close) => {
      $('[data-reload]', b).onclick = async () => { close(); await forget(); render(); };
      $('[data-copy]', b).onclick = async () => {
        try { const r = await api('/api/planned-routes', json('POST', {...body, client_id: crypto.randomUUID(), name: body.name.slice(0, 113) + ' (copy)', base_version: null, source: 'copy'}));
          await forget(); close(); invalidate('/api/planned-routes'); toast('Saved as a copy'); go(`/routes/plan/${r.id}`, {replace: true}); }
        catch (x) { toast(x.message); }
      };
    });
  }
  return {open, profile};
})();

// "Choose a stretch": two handles along a line (an activity section or a saved route), with the result on a map.
function stretchSheet(title, line, {unitLabel = '', onUse, note = ''}) {
  const pts = decode(line), len = Plan.length(pts), step = Math.max(5, Math.round(len / 400));
  sheet(title, `<div class="stretch-map" id="st-map"></div>
    <label class="stretch-l">Start <output id="st-a-v" class="num"></output><input type="range" id="st-a" min="0" max="${Math.round(len)}" step="${step}" value="0"></label>
    <label class="stretch-l">Finish <output id="st-b-v" class="num"></output><input type="range" id="st-b" min="0" max="${Math.round(len)}" step="${step}" value="${Math.round(len)}"></label>
    <p class="small muted" id="st-sum"></p>${note}<button class="primary wide" id="st-use">Use this stretch</button>`, async (b, close) => {
    const A = $('#st-a', b), B = $('#st-b', b);
    let v = null, part = null;
    try { v = await mapInto($('#st-map', b), [line], {ends: false}); if (v) part = v.L.polyline([], {color: col('--route'), weight: 6}).addTo(v.map); v?.group.eachLayer((l) => l.setStyle?.({color: col('--tx3'), weight: 3, opacity: .6})); } catch (_) { /* the sliders still work */ }
    const draw = () => {
      let a = +A.value, z = +B.value; if (z - a < step) { if (document.activeElement === A) A.value = a = z - step; else B.value = z = a + step; }
      $('#st-a-v', b).textContent = `${U.dist(a)} ${U.du()}`; $('#st-b-v', b).textContent = `${U.dist(z)} ${U.du()}`;
      $('#st-sum', b).textContent = `${U.dist(z - a)} ${U.du()} selected${unitLabel}`;
      if (part) part.setLatLngs(Plan.slice(pts, a, z));
    };
    A.oninput = B.oninput = draw; draw();
    $('#st-use', b).onclick = async (e) => { e.currentTarget.disabled = true; try { await onUse(+A.value, +B.value, close); } catch (x) { toast(x.message); } finally { e.currentTarget.disabled = false; } };
  });
}

// ---------- pages ----------
const routesTabs = (on) => `<div class="seg routes-tabs" role="tablist" aria-label="Routes">${[['planned', 'Planned', '/routes'], ['matched', 'Matched', '/routes?view=matched'], ['segments', 'Segments', '/routes?view=segments']]
  .map(([k, l, h]) => `<a role="tab" href="${h}" aria-selected="${on === k}" data-replace>${l}</a>`).join('')}</div>`;

route(/^\/routes$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search), view = q.get('view') || 'planned';
  el.innerHTML = `<div class="top">${backBtn('Progress')}<span></span></div><h1>Routes</h1>${routesTabs(view)}<div id="rt-body"></div>`;
  wireBack(el, '/progress');
  $$('[data-replace]', el).forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.getAttribute('href'), {replace: true}); });
  const body = $('#rt-body', el);
  if (view === 'matched') {
    body.innerHTML = '<p class="small muted">Matched routes group activities you’ve done more than once, with your trend on each. They’re made from what you recorded, not planned.</p><div id="rt-matched"></div>';
    return pRoutes($('#rt-matched', body), q);
  }
  if (view === 'segments') return Segments.list(body);
  const sport = q.get('sport') || '', term = q.get('q') || '';
  body.innerHTML = `<a class="primary wide" href="/routes/new">${svg('plus')}Plan a route</a>
    <form class="searchbox" id="rt-find" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" value="${esc(term)}" placeholder="Search your routes" aria-label="Search your routes" maxlength="120" enterkeyhint="search"></form>
    <div class="chips" role="group" aria-label="Sport">${[['', 'All'], ...PLAN_SPORTS].map(([k, l]) => `<button type="button" class="chip" data-s="${k}" aria-pressed="${sport === k}">${l}</button>`).join('')}</div><div id="rt-list">${skel(2)}</div>`;
  const reload = (s, t) => go(`/routes?${new URLSearchParams({...(s ? {sport: s} : {}), ...(t ? {q: t} : {})})}`, {replace: true});
  $$('[data-s]', body).forEach((b) => b.onclick = () => reload(b.dataset.s, term));
  $('#rt-find', body).onsubmit = (e) => { e.preventDefault(); reload(sport, e.currentTarget.elements.q.value.trim()); };
  await load(`/api/planned-routes?${new URLSearchParams({q: term, sport})}`, (rows) => {
    const box = $('#rt-list', body); if (!box) return;
    box.innerHTML = rows.length ? `<div class="card list">${rows.map((r) => `<a class="row-link plan-route" href="/routes/plan/${r.id}">${r.line ? miniRoute(r.line, r.sport) : ''}<span class="grow"><b>${esc(r.name)}</b>
        <small class="muted">${esc(SPORT_NAMES[r.sport])} · ${U.dist(r.distance_m)} ${U.du()}${r.ascent_m != null ? ` · ↑ ${U.elev(r.ascent_m)} ${U.eu()}` : ''}</small></span>${svg('chev')}</a>`).join('')}</div>`
      : term || sport ? '<div class="card empty"><b>No routes match</b>Try another name or sport.</div>'
      : '<div class="card empty"><b>Plan where you’ll go next</b>Tap points on the map, see the distance as you go, and save it. Then load it in Track before you start.</div>';
  });
});

route(/^\/routes\/new$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search), aid = q.get('activity');
  const ed = Planner.open(el, {title: 'New route', key: 'new', back: 'Routes', backHref: '/routes', source: aid ? 'activity' : 'drawn'});
  if (aid && /^\d+$/.test(aid)) fromActivity(+aid, async (d) => {
    const s = ed.state(); Object.assign(s, {waypoints: d.waypoints.map((w) => [+w[0], +w[1]]), legs: d.legs.map((l) => ({mode: l.mode, pts: decode(l.line), rev: 0, state: 'ok', dist: null})), sport: d.sport});
    await ed.persist(); history.replaceState(null, '', '/routes/new'); setTimeout(() => render(), 0);
  });
});

async function fromActivity(aid, done) {   // copy positions from your own activity: a section and a stretch you choose
  let r; try { r = await api(`/api/activities/${aid}/sections`); } catch (e) { toast(e.message); return; }
  if (!r.sections.length) { toast('This activity has no GPS route to copy.'); return; }
  const pick = (i) => stretchSheet('Choose the part to use', r.sections[i].line, {note: '<p class="small muted">Only the path is copied: no times, heart rate, notes or sharing settings.</p>',
    onUse: async (a, z, close) => { const d = await api('/api/planned-routes/from-activity', json('POST', {activity_id: aid, section: i, start_m: a, end_m: z})); close(); done(d); }});
  if (r.sections.length === 1) return pick(0);
  sheet('Choose a section', `<p class="small muted">This recording has gaps, so it’s in ${r.sections.length} sections. They’re kept apart, so no connection is made up.</p><div class="list card">${r.sections.map((s, i) => `<button class="row-link" data-s="${i}">${miniRoute(s.line, r.sport)}<span class="grow">Section ${i + 1}<small class="muted">${U.dist(s.distance_m)} ${U.du()}</small></span>${svg('chev')}</button>`).join('')}</div>`,
    (b, close) => $$('[data-s]', b).forEach((x) => x.onclick = () => { close(); pick(+x.dataset.s); }));
}

route(/^\/routes\/plan\/(\d+)\/edit$/, 'progress', async (el, id) => {
  el.innerHTML = skel(1);
  let r; try { r = await api(`/api/planned-routes/${id}`); } catch (e) { showError(el, e); return; }
  const key = `route-${id}`;
  let plan = {...r, baseVersion: r.version, routeId: r.id, clientId: crypto.randomUUID()};
  try {   // an unsaved edit of this route on this account wins over the saved copy (it remembers which version it started from)
    const d = (await api('/api/route-drafts/' + key)).data || store.get(planDraftKey(key));
    if (d?.waypoints?.length && d.baseVersion === r.version) plan = d;
  } catch (_) { /* the saved route */ }
  Planner.open(el, {title: 'Edit route', key, plan, routeId: r.id, baseVersion: r.version, back: 'Route', backHref: `/routes/plan/${id}`});
});

route(/^\/routes\/plan\/(\d+)$/, 'progress', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Routes')}<span></span></div><div id="rp-body">${skel(2)}</div>`;
  wireBack(el, '/routes');
  await load(`/api/planned-routes/${id}`, (r) => {
    const body = $('#rp-body', el); if (!body) return;
    const full = Plan.enc(Plan.line(r.legs.map((l) => ({line: l.line}))));
    const chosen = PlanTrack.get()?.id === r.id;
    body.innerHTML = `<h1>${esc(r.name)}</h1><p class="muted">${esc(SPORT_NAMES[r.sport])} · Planned route · private to you</p>
      <div class="plan-detail-map" id="rp-map"></div>
      <div class="bigstat">${stat('Distance', `${U.dist(r.distance_m)} ${U.du()}`)}${stat('Climb', r.ascent_m != null ? `${U.elev(r.ascent_m)} ${U.eu()}` : 'Unknown')}${stat('Descent', r.descent_m != null ? `${U.elev(r.descent_m)} ${U.eu()}` : 'Unknown')}</div>
      ${r.warnings?.length ? `<p class="plan-warn" role="note">${svg('alert')}${esc(r.warnings.map((w) => w.text).join(' '))}</p>` : ''}
      ${r.description ? `<p class="plan-notes">${esc(r.description)}</p>` : ''}
      ${r.elevation ? '<div class="card"><h2>Elevation</h2><div id="rp-profile"></div><p class="small muted">Approximate heights from satellite data.</p></div>' : ''}
      <button class="primary wide" id="rp-use">${svg('track')}${chosen ? 'In Track now · open Track' : 'Use in Track'}</button>
      <div class="card list">
        <a class="row-link" href="/routes/plan/${r.id}/edit">${svg('edit')}<span class="grow">Edit route</span>${svg('chev')}</a>
        <button class="row-link" id="rp-rename">${svg('edit')}<span class="grow">Rename</span>${svg('chev')}</button>
        <button class="row-link" id="rp-copy">${svg('plus')}<span class="grow">Duplicate<small class="muted">An independent copy</small></span>${svg('chev')}</button>
        <button class="row-link" id="rp-gpx">${svg('upload')}<span class="grow">Export GPX</span>${svg('chev')}</button>
        <button class="row-link" id="rp-seg">${svg('flag')}<span class="grow">Make a segment from part of it<small class="muted">A fixed, named course with times</small></span>${svg('chev')}</button>
        <button class="row-link danger" id="rp-del">${svg('trash')}<span class="grow">Delete route</span></button></div>
      <p class="small muted">Version ${r.version} · updated ${esc(fdate(r.updated, {month: 'short', day: 'numeric', year: 'numeric'}))}. Saving a route never adds an activity, totals or leaderboard times.</p>`;
    mapInto($('#rp-map', body), [full], {sport: r.sport}).catch(() => {});
    if (r.elevation) Planner.profile($('#rp-profile', body), r.elevation);
    $('#rp-use', body).onclick = () => { PlanTrack.set(PlanTrack.from({...r, full_line: full})); go('/track'); };
    $('#rp-rename', body).onclick = () => sheet('Rename route', `<form class="form" id="rn"><label>Name<input name="name" maxlength="120" required value="${esc(r.name)}"></label><label>Notes<textarea name="d" maxlength="2000" rows="2">${esc(r.description || '')}</textarea></label><button class="primary wide">Save</button></form>`, (b, close) => {
      $('#rn', b).onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/planned-routes/${id}`, json('PATCH', {name: e.target.elements.name.value, description: e.target.elements.d.value || null})); close(); invalidate('/api/planned-routes'); render(); } catch (x) { toast(x.message); } }; });
    $('#rp-copy', body).onclick = async () => { try { const c = await api(`/api/planned-routes/${id}/duplicate`, json('POST', {client_id: crypto.randomUUID()})); invalidate('/api/planned-routes'); toast('Copy saved'); go(`/routes/plan/${c.id}`); } catch (x) { toast(x.message); } };
    $('#rp-gpx', body).onclick = () => sheet('Export GPX', `<p>The file holds this route’s name and its ${decode(full).length.toLocaleString()} map points. No times, account, device or sharing details.</p>
        <label class="switch-row"><span><b>Include notes</b><small>Your private notes on this route go in the file too.</small></span><input type="checkbox" role="switch" id="gx-d"></label><button class="primary wide" id="gx-go">Download GPX</button>`, (b, close) => {
      $('#gx-go', b).onclick = async () => { try {
        if (Native.on) { const ticket = await api(`/api/planned-routes/${id}/gpx-link`, json('POST', {description: $('#gx-d', b).checked})); window.open(Native.base + ticket.path, '_blank'); close(); toast('Opening Safari to download your route'); return; }
        const res = await fetch(`${Native.base || ''}/api/planned-routes/${id}/gpx?description=${$('#gx-d', b).checked}`, {credentials: 'include', headers: Native.headers?.() || {}});
        if (!res.ok) throw new Error('Couldn’t make the file. Try again.'); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = `${r.name.replace(/[^\w .-]+/g, '').trim() || 'route'}.gpx`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); close(); }
        catch (x) { toast(x.message); } }; });
    $('#rp-seg', body).onclick = () => stretchSheet('Choose the segment', full, {note: '<p class="small muted">Next you name it and review it. Once created, a segment can’t be changed, and editing this route never changes it.</p>',
      onUse: async (a, z, close) => { close(); Segments.review({sport: r.sport, line: Plan.enc(Plan.slice(decode(full), a, z)), source: 'route'}); }});
    $('#rp-del', body).onclick = () => sheet('Delete this route?', '<p>This deletes the route and its earlier versions. Activities you recorded with it, copies, and segments made from it stay.</p><button class="primary danger-btn wide" data-del>Delete route</button><button class="ghost wide" data-keep>Keep it</button>', (b, close) => {
      $('[data-keep]', b).onclick = close;
      $('[data-del]', b).onclick = async () => { try { await api(`/api/planned-routes/${id}`, {method: 'DELETE'}); if (PlanTrack.get()?.id === r.id) PlanTrack.set(null); close(); invalidate('/api/planned-routes'); toast('Route deleted'); go('/routes', {replace: true}); } catch (x) { toast(x.message); } }; });
  });
});
