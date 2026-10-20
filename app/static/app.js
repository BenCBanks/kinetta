// Kinetta phone app — plain JS, no build step. Part 1: plumbing (api cache, router, formatting, icons, charts, maps).
// Page code lives in pages.js. Design rules (instant feedback, cached screens,
// optimistic edits with undo, skeletons, safe areas, no inline style attributes because of the CSP).
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const root = $('#app');
const col = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';   // real colour for SVG attributes
const App = {me: null, cache: new Map(), pages: [], scroll: {}};
// A quick tap can prefetch and open the same page before either request finishes.
const pendingReads = new Map();
const readEpochs = new Map();
const readEpoch = (path) => readEpochs.get(path) || 0;
// A new cookie login to the same account is still a different session.
const readSessions = new WeakMap();
let readSession = 0;
const readOwner = () => {
  if (App.me && !readSessions.has(App.me)) readSessions.set(App.me, ++readSession);
  return JSON.stringify([Native.base, Native.token, App.me && App.me.id, App.me ? readSessions.get(App.me) : 0]);
};
function readOnce(path) {
  const key = JSON.stringify([readOwner(), path]);
  if (!pendingReads.has(key)) {
    const p = api(path).finally(() => { if (pendingReads.get(key) === p) pendingReads.delete(key); });
    pendingReads.set(key, p);
  }
  return pendingReads.get(key);
}

// ---------- API: fetch + per-session cache (stale-while-revalidate) ----------
async function api(path, opts = {}) {
  const owner = readOwner();
  let r;
  const headers = opts.body instanceof FormData ? {} : {'Content-Type': 'application/json'};
  if (App.me && path !== '/api/me' && !path.startsWith('/api/login')) headers['X-Kinetta-Account'] = String(App.me.id);
  // in the iPhone app: the chosen server + the login token in a header (native.js); in a browser: this site + its cookie
  try { r = await fetch(Native.base + path, {credentials: Native.on ? 'omit' : 'same-origin', ...opts, headers: {...headers, ...Native.headers(), ...(opts.headers || {})}}); }
  catch (e) { throw Object.assign(new Error("Can't reach Kinetta - check your connection."), {offline: true}); }
  let body = null; try { body = await r.json(); } catch (e) { /* empty */ }
  if (owner !== readOwner()) throw Object.assign(new Error('The account changed while this request was running. Please try again.'), {stale: true});
  if (!r.ok) {
    const d = body && body.detail;
    const previewChanged=r.status===409&&path.startsWith('/api/food/thread/messages/')&&body?.changed===true;
    const e = new Error(typeof d === 'string' ? d : d && typeof d.message === 'string' ? d.message : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : previewChanged ? 'The food details changed. Check the updated card, then tap Log again.' : `Error ${r.status}`);
    e.status = r.status; e.code = d?.code || (previewChanged ? 'preview_changed' : undefined); e.detail = d; e.payload = body;
    if (r.status === 401 && App.me && owner === readOwner()) { if (typeof TrackNative !== 'undefined') TrackNative.detach().catch(()=>{}); else if (typeof Track !== 'undefined') Track.pause(); try { (Native.pauseSession||Native.pauseHealth)?.().catch(()=>{}); } catch(x) {} if (owner === readOwner()) { App.me = null; showLogin('Please log in again.'); } }
    throw e;
  }

  return body;
}
const json = (method, body) => ({method, body: JSON.stringify(body)});
// Calls render(data) at once with cached data (if any), then again with fresh data when it arrives.
// Offline (2026-10-10): the screens you use most are also kept on the phone (localStorage) and shown from there.
async function load(path, render, {maxAge = 15000} = {}) {
  const owner = readOwner(), epoch = readEpoch(path);
  let hit = App.cache.get(path);
  // the phone's saved copy shows at once (fresh data replaces it a moment later), except yesterday's "today" food log
  if (!hit) { const k = kept(path); if (k && !(k.day && !path.includes('d=') && k.day !== isoDay(new Date()))) { hit = {data: k, at: 0}; App.cache.set(path, hit); } }
  if (hit) render(hit.data, true);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  let data;
  try { data = await readOnce(path); }
  catch (e) {
    if (owner !== readOwner() || epoch !== readEpoch(path)) return null;
    if (!e.offline) throw e;
    netState(true);
    if (hit) return hit.data;
    const k = kept(path); if (!k) throw e;
    App.cache.set(path, {data: k, at: 0}); render(k, true); return k;
  }
  if (owner !== readOwner() || epoch !== readEpoch(path)) return null;
  netState(false);
  App.cache.set(path, {data, at: Date.now()}); keep(path, data);
  if (!hit || JSON.stringify(hit.data) !== JSON.stringify(data)) render(data, false);
  return data;
}

// A same-session /me refresh replaces profile data without cancelling its page reads.
function refreshMe(me) {
  const previous = App.me, same = previous && previous.id === me.id;
  if (same && readSessions.has(previous)) readSessions.set(me, readSessions.get(previous));
  if (!same) { App.cache.clear(); forgetKept(); }
  App.me = me; keep('/api/me', me);
  if (!same) render();
}

// ---------- offline: kept screens + a send queue for food and weight (2026-10-10) ----------
const KEEP = [/^\/api\/me$/, /^\/api\/food\/day/, /^\/api\/food\/(recent|usual|foods|meals)$/, /^\/api\/food\/weights\?days=90$/, /^\/api\/plans\/current$/,
  /^\/api\/stats$/, /^\/api\/goals$/, /^\/api\/activities\?limit=3$/, /^\/api\/fitness\?days=60$/, /^\/api\/coach\/week$/,
  /^\/api\/progress\/volume\?period=week$/, /^feed:home$/, /^\/api\/feed\/friends\?limit=3$/];   // 2026-10-16: Activity and Progress open from the saved copy too; 2026-10-18: all of Me
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked: offline copies are a bonus */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } },
};
const serverKey = () => Native.base || location.origin;
function keep(path, data) { if (App.me && KEEP.some((r) => r.test(path))) store.set('fit.c:' + path, {who: App.me.login, server: serverKey(), data}); }
function kept(path) { const v = store.get('fit.c:' + path); return v && (v.server === serverKey() || (!v.server && !Native.on)) && (!App.me || v.who === App.me.login) ? v.data : null; }
function forgetKept() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('fit.c:')) localStorage.removeItem(k); } catch (e) { /* none */ } }

// Fold a generated note without redrawing the page, map or inputs. Remember only its fingerprint on this device.
function coachKey(key) { return 'fit.coach.hidden:' + JSON.stringify([Native.base || location.origin, App.me.id, key]); }
function coachVersion(message) {
  let h = 2166136261;
  // Database JSON may return object fields in a different order after a reload.
  const text = JSON.stringify(message, (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value);
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
function showCoach(key) { store.del(coachKey(key)); }
function coachMessage(key, message, title, body, meta = '') {
  const saved = coachKey(key), version = coachVersion(message), hidden = store.get(saved) === version;
  const id = 'coach-' + coachVersion(saved);
  return `<div class="coach-message" data-coach-key="${esc(saved)}" data-coach-version="${version}">
    <div class="coach-heading"><div><h2>${esc(title)}</h2>${meta ? `<span class="small muted">${esc(meta)}</span>` : ''}</div>
      <button type="button" class="linkbtn" data-coach-toggle aria-expanded="${!hidden}" aria-controls="${id}">${hidden ? 'Show' : 'Hide'}</button></div>
    <div class="coach-body" id="${id}"${hidden ? ' hidden' : ''}>${body}</div></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-coach-toggle]'); if (!b) return;
  const card = b.closest('[data-coach-key]'), body = card.querySelector('.coach-body');
  body.hidden = !body.hidden;
  if (body.hidden) store.set(card.dataset.coachKey, card.dataset.coachVersion); else store.del(card.dataset.coachKey);
  b.textContent = body.hidden ? 'Show' : 'Hide'; b.setAttribute('aria-expanded', String(!body.hidden));
});
const newId = () => {
  if(crypto.randomUUID)return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
// change a day of the food log in every copy (screen cache + phone copy), e.g. to show an item saved offline
function patchDay(day, fn) {
  const paths = new Set([...App.cache.keys()].filter((k) => k.startsWith('/api/food/day')));
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('fit.c:/api/food/day')) paths.add(k.slice(6)); } catch (e) { /* none */ }
  for (const p of paths) {
    const hit = App.cache.get(p) || (kept(p) ? {data: kept(p), at: 0} : null);
    if (!hit || hit.data.day !== day) continue;
    const d = JSON.parse(JSON.stringify(hit.data)); fn(d);
    App.cache.set(p, {data: d, at: Date.now()}); keep(p, d);
  }
}
// Owner keys contain no credentials. Older browser queues belong to this origin;
// older native queues have no recorded server, so cannot safely be sent automatically.
const queueOwner = () => App.me ? JSON.stringify([serverKey(), App.me.id]) : null;
const Q = {
  all() { return store.get('fit.queue') || []; },
  save(ops) {
    // Unlike optional screen caches, an unsaved write must never be reported queued.
    try { localStorage.setItem('fit.queue', JSON.stringify(ops)); }
    catch (e) { throw Error("This phone couldn't save the pending item. Keep this screen open and try again when connected."); }
  },
  owns(op) { return !!App.me && (op.owner === queueOwner() || (!op.owner && !Native.on && op.who === App.me.login)); },
  legacy(op) { return !!App.me && !op.owner && Native.on && op.who === App.me.login; },
  visible(op) { return Q.owns(op) || Q.legacy(op); },
  mine() { return Q.all().filter(Q.visible); },
  add(op) { Q.save([...Q.all(), {...op, id: newId(), owner: queueOwner(), who: App.me.login, at: Date.now()}]); netbar(); },
  async flush() {
    if (Q.busy || !App.me || !navigator.onLine) return;
    const owner = readOwner(), account = queueOwner();
    let q = Q.all(); if (!q.some(o => Q.owns(o) && !o.error)) return;
    // Persist IDs before sending so additions/discards during a request aren't overwritten.
    q = q.map(o => Q.owns(o) ? {...o, owner: account, id: o.id || newId()} : o);
    Q.save(q); Q.busy = true; let sent = 0, offline = false;
    try {
      for (const op of q) {
        if (owner !== readOwner() || !navigator.onLine) break;
        if (op.owner !== account || op.error || !Q.all().some(o => o.id === op.id)) continue;
        let failed = null, response;
        try { response=await api(op.path, {method: op.method, body: JSON.stringify(op.body)});sent++; }
        catch (e) { failed = e; offline = !!e.offline; }
        // Even if the account changed, remove only the acknowledged original item.
        const current = Q.all();
        Q.save(failed ? current.map(o => o.id === op.id ? {...o, error: failed.offline || failed.stale || failed.status === 401 || failed.code === 'account_changed' ? null : failed.message} : o)
          : current.filter(o => o.id !== op.id));
        if (!failed && response?.messages && owner===readOwner() && typeof FoodThread!=='undefined') {try{await FoodThread.accept(response);}catch(e){invalidate('/api/food');}}
        if (failed && !failed.offline && !failed.stale && failed.status !== 401 && failed.code !== 'account_changed' && owner === readOwner()) toast(`Couldn't save ${op.label}. It is still on this phone.`);
        if (failed && (failed.offline || failed.stale || failed.status === 401 || failed.code === 'account_changed')) break;
      }
    } finally { Q.busy = false; netState(offline); netbar(); }
    if (sent && owner === readOwner()) { invalidate('/api/'); toast(`Sent ${sent} pending item${sent > 1 ? 's' : ''}`); if(location.pathname==='/food/describe' && typeof FoodThread!=='undefined')FoodThread.refresh();else render(); }
  },
  review() {
    const owner = readOwner();
    Q.save(Q.all().map(o => Q.visible(o) ? {...o, ...(Q.owns(o) ? {owner:queueOwner()} : {}), id: o.id || newId()} : o));
    sheet('Pending items', '<div id="pending-items"></div>', (b, close) => {
      const draw = () => {
        if (owner !== readOwner()) { close(); return; }
        const ops = Q.mine(), box = $('#pending-items', b);
        box.innerHTML = ops.length ? '<p>Items stay on this phone until saved or discarded.</p>' + ops.map((o, i) =>
          `<div class="pending-item"><p><strong>${esc(o.label)}</strong><br><span class="small">${esc(Q.legacy(o) ? 'Saved before this update · review before sending' : o.error || 'Waiting for a connection')}</span></p><div class="actions"><button class="ghost" data-pending-retry="${i}">${Q.legacy(o) ? 'Send to this account' : 'Retry'}</button><button class="linkbtn" data-pending-discard="${i}">Discard</button></div></div>`).join('') : '<p>Everything has been sent.</p>';
        $$('[data-pending-retry]', box).forEach(btn => btn.onclick = async () => {
          if (owner !== readOwner()) return;
          const op = ops[+btn.dataset.pendingRetry];
          if (Q.legacy(op) && !confirm(`Send this older saved item to ${App.me.login} on this server?`)) return;
          Q.save(Q.all().map(o => o.id === op.id ? {...o, owner:queueOwner(), error: null} : o));
          btn.disabled = true; btn.textContent = 'Sending…';
          try { await Q.flush(); } catch (e) { toast(e.message); } if (b.isConnected) draw();
        });
        $$('[data-pending-discard]', box).forEach(btn => btn.onclick = () => {
          if (Q.busy) { toast('Please wait for the current upload to finish.'); return; }
          if (owner !== readOwner() || !confirm('Discard this pending item from this phone?')) return;
          const op = ops[+btn.dataset.pendingDiscard]; Q.save(Q.all().filter(o => o.id !== op.id)); netbar(); draw();
        });
      }; draw();
    });
  },
};
// writes that may wait for a connection: food entries and weigh-ins. Returns the server reply, or {queued: true}.
async function sendOrQueue(path, method, body, label) {
  const owner = readOwner();
  if (navigator.onLine) {
    try { const r = await api(path, json(method, body)); netState(false); return r; }
    catch (e) { if (!e.offline) throw e; }
  }
  if (owner !== readOwner()) throw Object.assign(Error('The account changed. Please try again.'), {stale: true});
  netState(true); Q.add({path, method, body, label}); App.queuedAt = Date.now(); return {queued: true};
}
function netState(off) { if (App.offline !== off) { App.offline = off; netbar(); } }
function netbar() {
  let b = $('#netbar'); const n = Q.mine().length;
  if (!App.offline && !n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; b.setAttribute('role', 'status'); document.body.prepend(b); }
  b.replaceChildren(); const status = document.createElement('span');
  status.textContent = App.offline ? `Offline - showing what's saved on this phone${n ? ` · ${n} waiting to send` : ''}` : `${n} item${n > 1 ? 's' : ''} waiting to send${Q.mine().some(o => o.error) ? ' · needs attention' : '…'}`;
  b.append(status);
  if (n) { const button = document.createElement('button'); button.type = 'button'; button.className = 'linkbtn'; button.textContent = 'Review'; button.onclick = () => Q.review(); b.append(button); }
}
addEventListener('online', () => { netState(false); Q.flush().catch(e => toast(e.message)); });
addEventListener('offline', () => netState(true));
setInterval(() => { if (Q.mine().length) Q.flush().catch(e => toast(e.message)); }, 30000);
function invalidateFeed() {
  readEpochs.set('feed:home', readEpoch('feed:home') + 1); App.cache.delete('feed:home');
}
const invalidate = (prefix, {health=true}={}) => {
  if(health && prefix.replace(/\/$/,'')==='/api/food') Native.queueNutritionSync?.();
  if (['/api/activities', '/api/shared', '/api/feed', '/api/people'].some((p) => p.startsWith(prefix) || prefix.startsWith(p))) invalidateFeed();
  const paths = new Set([...App.cache.keys(), ...[...pendingReads.keys()].map((k) => JSON.parse(k)[1])]);
  for (const p of paths) if (p.startsWith(prefix)) { readEpochs.set(p, readEpoch(p) + 1); App.cache.delete(p); }
  for (const k of pendingReads.keys()) if (JSON.parse(k)[1].startsWith(prefix)) pendingReads.delete(k);
  if(prefix.startsWith('/api/food')&&typeof CustomEvent!=='undefined')document.dispatchEvent(new CustomEvent('food:changed'));
};
const prefetch = (path) => {
  const owner = readOwner(), epoch = readEpoch(path);
  if (!App.cache.has(path)) readOnce(path).then((data) => {
    if (owner === readOwner() && epoch === readEpoch(path)) { App.cache.set(path, {data, at: Date.now()}); keep(path, data); }
  }).catch(() => {});
};
// Once the app is open, fetch the other tabs' first screens quietly, so the first tap on Activity or Progress
// doesn't wait for the server (2026-10-16: on a phone each request is a noticeable pause).
function warmTabs() {
  if (!App.me || !navigator.onLine) return;
  prefetch('/api/progress/volume?period=week');
  if (typeof warmFeed === 'function') warmFeed();
}

// ---------- units + formatting ----------
const MI = 1609.344;
const imp = () => (App.me ? App.me.units : 'imperial') === 'imperial';
const U = {
  dist: (m, d = 2) => m == null ? '–' : imp() ? (m / MI).toFixed(m / MI >= 100 ? 0 : d) : (m / 1000).toFixed(m >= 100000 ? 0 : d),
  du: () => (imp() ? 'mi' : 'km'),
  elev: (m) => m == null ? '–' : Math.round(imp() ? m * 3.28084 : m).toLocaleString(),
  eu: () => (imp() ? 'ft' : 'm'),
  speed: (ms) => ms == null ? '–' : (imp() ? ms * 2.23694 : ms * 3.6).toFixed(1),
  su: () => (imp() ? 'mph' : 'km/h'),
  pace: (sPerKm) => { if (!sPerKm || !isFinite(sPerKm)) return '–'; const s = imp() ? sPerKm * MI / 1000 : sPerKm; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`.replace(/:60$/, ':59'); },
  pu: () => (imp() ? '/mi' : '/km'),
  swim: (sPerKm) => { if (!sPerKm) return '–'; const s = imp() ? sPerKm * 0.09144 : sPerKm / 10; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; },
  swu: () => (imp() ? '/100yd' : '/100m'),
  temp: (c) => c == null ? '–' : Math.round(imp() ? c * 9 / 5 + 32 : c) + '°',
  weight: (kg) => kg == null ? '' : (imp() ? kg * 2.20462 : kg).toFixed(1),
};
function dur(s, long = false) {
  if (s == null || !isFinite(s)) return '–';
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (long) return h ? `${h}h ${m}m` : `${m}m ${String(x).padStart(2, '0')}s`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
const tz = () => (App.me && App.me.tz) || 'America/New_York';
const fdate = (iso, o) => new Date(iso).toLocaleDateString([], {timeZone: tz(), ...o});
const ftime = (iso) => new Date(iso).toLocaleTimeString([], {timeZone: tz(), hour: 'numeric', minute: '2-digit'});
function when(iso) {
  const d = new Date(iso), now = new Date();
  const day = (x) => x.toLocaleDateString('en-CA', {timeZone: tz()});
  const diff = (new Date(day(now)) - new Date(day(d))) / 864e5;
  const t = ftime(iso);
  if (diff === 0) return `Today at ${t}`;
  if (diff === 1) return `Yesterday at ${t}`;
  if (diff < 7) return `${fdate(iso, {weekday: 'long'})} at ${t}`;
  return fdate(iso, {month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'}) + ` at ${t}`;
}
const SPORT_NAMES = {run: 'Run', ride: 'Ride', walk: 'Walk', hike: 'Hike', swim: 'Swim', row: 'Row', ski: 'Ski', workout: 'Workout', other: 'Activity'};
const FOOT = ['run', 'walk', 'hike'];
// the headline number per sport: pace for foot sports, speed for rides/skis, /100 for swims
function rate(a) {
  if (!a.distance_m || !a.moving_s) return {label: 'Time', v: dur(a.moving_s || a.elapsed_s), u: ''};
  const spk = a.moving_s / a.distance_m * 1000;
  if (a.sport === 'swim') return {label: 'Pace', v: U.swim(spk), u: U.swu()};
  if (FOOT.includes(a.sport)) return {label: 'Pace', v: U.pace(spk), u: U.pu()};
  return {label: 'Speed', v: U.speed(a.distance_m / a.moving_s), u: U.su()};
}

// ---------- icons ----------
const IC = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 2-2 6 0 8v10"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>', chev: '<path d="M9 18l6-6-6-6"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', barcode: '<path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12"/>', check: '<path d="M5 12l5 5L20 7"/>', expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v4M6 12l3-4 4 1 2 3 3 1M11 15l-2-3"/>',
  ride: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8l2 8M13 5h3"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-6 2 2v4M9 13l1-5 3 1 2 3M10 8l-3 2v3"/>',
  hike: '<path d="M3 20l6-10 4 6 3-4 5 8z"/><path d="M14 6l2-2 2 2"/>',
  swim: '<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 13l4-4 3 3M16 8.5a2 2 0 1 0 0-.01"/>',
  row: '<path d="M3 17h18M6 17l9-10M14 6l3 1-1 3"/>', ski: '<path d="M4 20l16-6M9 4l2 9M7 9l6-2"/><circle cx="13" cy="4" r="1.6"/>',
  workout: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', down: '<path d="M7 10l5 5 5-5"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>', other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};
Object.assign(IC, {   // 2026-10-11 redesign: Me list icons, feed footers
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  watch: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 10v2l1.5 1"/>',
  shoe: '<path d="M3 16v-4l4-6 3 2 3 3 6 1a2 2 0 0 1 2 2v2zM3 16v2h18v-2"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9a4 4 0 0 1 6 0l-2 2.5"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>', logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h2M20 10h2M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  // icon chips (2026-10-13): distance, time and climb beside Today's numbers
  dist: '<path d="M4 19c4 0 5-3 8-7s4-7 8-7"/><circle cx="20" cy="5" r="1.5"/>', clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  climb: '<path d="M3 20l6-10 4 6 3-4 5 8z"/>',
});
// a person's round initials, in one of six colours picked from their username (same person, same colour everywhere)
function avatar(p, cls = '') {
  const name = (p && p.name) || '?', login = (p && p.login) || name;
  const ini = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  let h = 0; for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 997;
  // a profile photo (2026-10-12, api_photos.py) sits over the initials; its address changes when the photo does
  const img = p && p.photo ? pimg(`/api/people/${encodeURIComponent(login)}/photo?v=${encodeURIComponent(p.photo)}`) : '';
  return `<span class="av av${h % 6}${cls ? ' ' + cls : ''}" aria-hidden="true">${esc(ini)}${img}</span>`;
}
// A photo from the server (2026-10-12). The iPhone app signs in with a header, which an <img> can't send, so there the
// picture is fetched with the token instead (native.js fills in data-asrc); in a browser it's an ordinary image.
const pimg = (path, attrs = '') => `<img ${Native.on ? 'data-asrc' : 'src'}="${esc(path)}" alt="" loading="lazy" decoding="async" ${attrs}>`;
// a photo that won't load (removed meanwhile, or offline) leaves the initials showing
document.addEventListener('error', (e) => { if (e.target.matches && e.target.matches('.av img')) e.target.remove(); }, true);
// Phosphor regular, MIT; source paths retained at their original scale.
Object.assign(IC, {"today": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z\" /></g>", "activity": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M72,144H32a8,8,0,0,1,0-16H67.72l13.62-20.44a8,8,0,0,1,13.32,0l25.34,38,9.34-14A8,8,0,0,1,136,128h24a8,8,0,0,1,0,16H140.28l-13.62,20.44a8,8,0,0,1-13.32,0L88,126.42l-9.34,14A8,8,0,0,1,72,144ZM178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,.75,0,1.5,0,2.25a8,8,0,1,0,16-.5c0-.58,0-1.17,0-1.75A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46c0,53.61-77.76,102.15-96,112.8-10.83-6.31-42.63-26-66.68-52.21a8,8,0,1,0-11.8,10.82c31.17,34,72.93,56.68,74.69,57.63a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40Z\" /></g>", "progress": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V80H96a8,8,0,0,0-8,8v40H48a8,8,0,0,0-8,8v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM160,48h40V200H160ZM104,96h40V200H104ZM56,144H88v56H56Z\" /></g>", "food": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M72,88V40a8,8,0,0,1,16,0V88a8,8,0,0,1-16,0ZM216,40V224a8,8,0,0,1-16,0V176H152a8,8,0,0,1-8-8,268.75,268.75,0,0,1,7.22-56.88c9.78-40.49,28.32-67.63,53.63-78.47A8,8,0,0,1,216,40ZM200,53.9c-32.17,24.57-38.47,84.42-39.7,106.1H200ZM119.89,38.69a8,8,0,1,0-15.78,2.63L112,88.63a32,32,0,0,1-64,0l7.88-47.31a8,8,0,1,0-15.78-2.63l-8,48A8.17,8.17,0,0,0,32,88a48.07,48.07,0,0,0,40,47.32V224a8,8,0,0,0,16,0V135.32A48.07,48.07,0,0,0,128,88a8.17,8.17,0,0,0-.11-1.31Z\" /></g>", "me": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z\" /></g>", "shoe": "<g transform=\"scale(0.09375)\" fill=\"currentColor\" stroke=\"none\"><path xmlns=\"http://www.w3.org/2000/svg\" d=\"M228.65,129.11l-60.73-20.24a24,24,0,0,1-14.32-13L130.39,41.6s0-.07,0-.1A16,16,0,0,0,110.25,33L34.53,60.49A16.05,16.05,0,0,0,24,75.53V192a16,16,0,0,0,16,16H240a16,16,0,0,0,16-16V167.06A40,40,0,0,0,228.65,129.11ZM115.72,48l7.11,16.63-21.56,7.85A8,8,0,0,0,104,88a7.91,7.91,0,0,0,2.73-.49l22.4-8.14,4.74,11.07-16.6,6A8,8,0,0,0,120,112a7.91,7.91,0,0,0,2.73-.49l17.6-6.4a40.24,40.24,0,0,0,7.68,10l-14.74,5.36A8,8,0,0,0,136,136a8.14,8.14,0,0,0,2.73-.48l28-10.18,56.87,18.95A24,24,0,0,1,238.93,160H40V75.53ZM40,192h0V176H240v16Z\" /></g>"});
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.other}</svg>`;
const sportMark = (s) => `<span class="sp ${esc(s)}" aria-hidden="true">${svg(s)}</span>`;

// ---------- toast + sheet ----------
let toastT;
// Focus a box only where there's a real keyboard: on phones a focused box pops up the on-screen keyboard and covers
// the choices around it, so there the box waits for a tap.
function softFocus(el) { if (el && !matchMedia('(pointer: coarse)').matches) el.focus(); }
function toast(msg, undo) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  if (Date.now() - (App.queuedAt || 0) < 2000 && !undo && !/saved on this phone|waiting to send/i.test(msg)) msg += ' - saved on this phone, it sends when you are back online';
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) $('button', t).onclick = () => { t.classList.remove('on'); undo(); };
  t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), undo ? 6000 : 3200);
}
function sheet(title, html, onMount) {
  const prev = document.activeElement;
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${svg('close')}</button></header><div class="sbody">${html}</div></div>`;
  const close = () => { s.remove(); document.removeEventListener('keydown', onKey); removeEventListener('mousemove', onMove); removeEventListener('mouseup', onUp); unfit(); if (!document.querySelector('.scrim')) document.body.classList.remove('has-sheet'); if (prev && prev.isConnected && prev.focus) prev.focus(); };
  const onKey = (e) => {
    if ([...document.querySelectorAll('.scrim')].at(-1) !== s) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [...s.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
        .filter((el) => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || !s.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !s.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    }
  };
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) close(); });
  // swipe down to dismiss (2026-10-09): from the grab bar / header, or anywhere in the body while it is scrolled to
  // the top (like iOS sheets). Touch events with preventDefault, because pointer events are cancelled once iOS
  // decides the finger is scrolling. Mouse: drag the grab bar / header.
  const sh = $('.sheet', s);   // the sheet itself is the scroll container
  let ty = null, dy = 0, dragging = false, fromTop = false;
  const settle = (shut) => { sh.classList.add('settle'); if (shut) { sh.style.transform = 'translateY(100%)'; setTimeout(close, 160); } else { sh.style.transform = ''; setTimeout(() => sh.classList.remove('settle'), 200); } };
  sh.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('textarea, input[type=range], .tblwrap, .hgrid, .chips')) { ty = null; return; }
    ty = e.touches[0].clientY; dy = 0; dragging = false;
    fromTop = !!e.target.closest('.grab, header') || sh.scrollTop <= 0;
  }, {passive: true});
  sh.addEventListener('touchmove', (e) => {
    if (ty == null || !fromTop) return;
    dy = e.touches[0].clientY - ty;
    if (!dragging && dy > 8 && (e.target.closest('.grab, header') || sh.scrollTop <= 0)) { dragging = true; sh.classList.remove('settle'); }
    if (dragging) { e.preventDefault(); sh.style.transform = `translateY(${Math.max(0, dy)}px)`; }
  }, {passive: false});
  sh.addEventListener('touchend', () => { if (dragging) settle(dy > 90); ty = null; dragging = false; });
  sh.addEventListener('touchcancel', () => { if (dragging) settle(false); ty = null; dragging = false; });
  let my = null;
  sh.addEventListener('mousedown', (e) => { if (e.target.closest('.grab, header') && !e.target.closest('button')) my = e.clientY; });
  const onMove = (e) => { if (my != null && e.clientY - my > 0) sh.style.transform = `translateY(${e.clientY - my}px)`; };
  const onUp = (e) => { if (my != null) { settle(e.clientY - my > 90); my = null; } };
  addEventListener('mousemove', onMove); addEventListener('mouseup', onUp);
  // the keyboard (2026-10-13, Ben): iOS slides it over the page, so the sheet would sit under it. Lift the sheet by the
  // keyboard's height and keep it inside what is still visible, so a text box being typed in stays in view.
  const vv = window.visualViewport;
  // In the iPhone app the WebView keeps its size (#194), so use the keyboard height the app announces (keyboard.js).
  const fit = () => {
    const native = window.KinettaKeyboard?.height || 0;
    const kb = native || (vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0);
    s.style.paddingBottom = kb > 80 ? kb + 'px' : '';
    sh.style.maxHeight = kb > 80 ? `${Math.round((native ? innerHeight - native : vv.height) - 8)}px` : '';
    const el = document.activeElement;
    if (kb > 80 && el && sh.contains(el)) requestAnimationFrame(() => el.scrollIntoView?.({block: 'nearest'}));
  };
  const unfit = () => { if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } removeEventListener('kinetta:keyboard', fit); };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  addEventListener('kinetta:keyboard', fit); fit();
  document.addEventListener('keydown', onKey);
  document.body.append(s); document.body.classList.add('has-sheet');
  // phones: a text box waits for a tap (a focused box pops up the keyboard over the sheet); buttons still take focus
  const first = $('input, select, textarea, button:not([data-close])', $('.sbody', s));
  // (2026-10-12: a select too - iOS opened the meal picker as soon as Add food appeared)
  if (first && !(first.matches('input, textarea, select') && matchMedia('(pointer: coarse)').matches)) first.focus({preventScroll: true});
  if (onMount) onMount($('.sbody', s), close);
  return close;
}

// ---------- router ----------
IC.mail = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>';
IC.paste = '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>';
IC.track = '<circle cx="12" cy="10" r="3"/><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/>';
// Owner decision 2026-10-18 (#164): back to the original activity-first order; the shared ＋ Log tab is gone (food has one home, Nutrition).
const TABS = [['me', 'Me'], ['activity', 'Activity'], ['track', 'Track'], ['progress', 'Progress'], ['food', 'Nutrition']];   // Me is home: first, and where the app opens
function route(re, tab, fn) { App.pages.push({re, tab, fn}); }
function go(path, {replace = false} = {}) {
  App.scroll[location.pathname + location.search] = scrollY;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  render();
}
// Today's weigh-in sheet (used by the weekly check-in).
function quickWeighIn() {
  const owner = readOwner(), day = isoDay(new Date()), unit = imp() ? 'lb' : 'kg';
  sheet('Weigh in', `<form id="quick-weight" class="form"><p class="small muted">${esc(dayLabel(day))}</p><label>Weight (${unit})<input name="weight" inputmode="decimal" required value="${App.me.weight_kg ? esc(U.weight(App.me.weight_kg)) : ''}" aria-label="Today’s weight in ${unit}" enterkeyhint="done"></label><button class="primary wide">Save weight</button></form>`, (b,close) => {
    const f = $('#quick-weight',b), input = f.elements.weight; let touched = false;
    input.oninput = () => { touched = true; }; input.focus();
    load('/api/food/weights/latest', W => {
      if (!b.isConnected || touched || readOwner() !== owner) return;
      const latest = W.points?.slice().sort((a,b)=>a.day.localeCompare(b.day)).at(-1);
      if (latest) input.value = U.weight(latest.kg);
    }).catch(()=>{});
    f.onsubmit = async e => {
      e.preventDefault(); const v = Number(input.value.replace(',','.')), kg = imp() ? v / LB : v;
      if (!(kg > 20 && kg < 400)) { input.setCustomValidity('Enter a weight between ' + (imp() ? Math.round(20*LB) : 20) + ' and ' + (imp() ? Math.round(400*LB) : 400) + ' ' + unit); input.reportValidity(); input.oninput = () => { touched = true; input.setCustomValidity(''); }; return; }
      const button = $('button',f); if (button.disabled) return; button.disabled = true;
      try {
        const r = await sendOrQueue('/api/food/weights','PUT',{day,kg},'weigh-in');
        if (readOwner() !== owner) return;
        close(); invalidate('/api/food'); Native.haptic('success'); toast(r.queued ? 'Weight saved on this phone · waiting to send' : 'Weight saved');
      } catch(x) { if (b.isConnected && readOwner() === owner) { button.disabled = false; toast(x.message); } }
    };
  });
}
function render() {
  if (!App.me) return;
  const path = location.pathname.replace(/\/+$/, '') || '/me';
  const page = App.pages.find((p) => p.re.test(path)) || App.pages[0];
  const m = path.match(page.re) || [], activeTab = typeof page.tab === 'function' ? page.tab(...m.slice(1)) : page.tab;
  // The tab bar stays put between screens (2026-10-16): only the page is replaced, so a tap never waits for the bar to be
  // rebuilt and its badges don't blink. The first render (or after logging in again) builds it.
  const nav = $('nav.tabs', root), fresh = '<main class="shell" id="page"></main>';
  if (nav && nav.parentNode === root && root.children.length === 2 && $('#page', root)) {
    const main = document.createElement('main'); main.className = 'shell'; main.id = 'page'; $('#page', root).replaceWith(main);
    $$('a[data-tab]', nav).forEach((a) => (a.dataset.tab === activeTab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  } else root.innerHTML = `${fresh}<nav class="tabs" aria-label="Main">${TABS.map(([t, n]) =>
    `<a href="/${t}" data-tab="${t}"${t === activeTab ? ' aria-current="page"' : ''}>${svg(t)}<span>${n}</span></a>`).join('')}</nav>`;
  cleanViews();
  const el = $('#page');
  if (typeof Track !== 'undefined') Track.sync();
  const key = location.pathname + location.search;
  // Switching tabs shows the page at once, like the iPhone's own tab bars; opening something inside a tab fades it in.
  if (App.lastPath !== location.pathname) { if (!TABS.some(([t]) => path === '/' + t)) el.classList.add('enter'); App.lastPath = location.pathname; }
  if (Native.syncPush) Native.syncPush();
  if (typeof Social !== 'undefined') Social.refresh();   // friend requests waiting: a number on the Me tab
  Promise.resolve(page.fn(el, ...m.slice(1))).catch((e) => showError(el, e)).finally(() => {
    if (el.isConnected && typeof Track !== 'undefined') Track.sync();
    requestAnimationFrame(() => { if (el.isConnected && key === location.pathname + location.search) window.scrollTo(0, App.scroll[key] || 0); });
  });
}
function showError(el, e) {
  if (e && e.status === 401) return;
  if (e && e.status === 404) {
    const href = location.pathname.startsWith('/people/') ? '/me/friends' : location.pathname.startsWith('/activity/') ? '/activity' : '/me';
    el.innerHTML = `<div class="boot"><h1>Not available</h1><p>This item may have been removed or is not shared with you.</p><a class="ghost wide" href="${href}">Go back</a></div>`; return;
  }
  el.innerHTML = `<div class="boot"><p>${esc(e && e.message || 'Something went wrong')}</p><button class="ghost" id="retry">Try again</button></div>`;
  $('#retry', el).onclick = () => { invalidate('/api/'); render(); };
}
// in-app links: <a href="/..."> navigate without reloading; prefetch on press for instant pages
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || a.target) return;
  e.preventDefault();
  // The tab you're on (owner, 20 Oct 2026): its plain home page; already there, scroll to the top (like iPhone tab bars).
  if (a.dataset.tab && location.pathname === '/' + a.dataset.tab && !location.search) { window.scrollTo({top: 0, behavior: 'smooth'}); return; }
  if (a.dataset.tab) App.scroll[a.getAttribute('href')] = 0;
  go(a.getAttribute('href'));
});
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest('[data-prefetch]'); if (a) prefetch(a.dataset.prefetch);
}, {passive: true});
window.addEventListener('popstate', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden && App.me) Q.flush().catch(e => toast(e.message)); if (!document.hidden && App.me && navigator.onLine && Date.now() - (App.hiddenAt || 0) > 60000) { invalidate('/api/'); render(); } if (document.hidden) App.hiddenAt = Date.now(); });

// ---------- skeleton ----------
const skel = (n = 3) => Array.from({length: n}, () => '<div class="card"><div class="sk big"></div><div class="sk line"></div><div class="sk line"></div></div>').join('');

// ---------- polyline + mini route ----------
function decode(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (str && i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
function miniRoute(line, sport) {
  const pts = decode(line);
  if (pts.length < 2) return `<div class="mini"><span class="ico sp ${esc(sport)}">${svg(sport)}</span></div>`;
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [la, lo] of pts) { const x = lo * k, y = -la; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = 76 / Math.max(x1 - x0, y1 - y0, 1e-9), ox = (84 - (x1 - x0) * s) / 2, oy = (84 - (y1 - y0) * s) / 2;
  const d = pts.map(([la, lo], i) => `${i ? 'L' : 'M'}${((lo * k - x0) * s + ox).toFixed(1)},${((-la - y0) * s + oy).toFixed(1)}`).join('');
  return `<div class="mini" aria-hidden="true"><svg viewBox="0 0 84 84"><path class="${esc(sport)}" d="${d}"/></svg></div>`;
}

// ---------- maps (Leaflet, loaded only when a map is on screen) ----------
let leafletP;
const viewResources = new Map();
function cleanViews() {
  for (const [el, clean] of viewResources) if (!el.isConnected) { clean(); viewResources.delete(el); }
}
function loadLeaflet() {   // (not "leaflet": leaflet.js overwrites window.leaflet)
  if (!leafletP) leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/vendor/leaflet.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = '/static/vendor/leaflet.js'; s.onload = () => res(window.L); s.onerror = rej; document.head.append(s);
  });
  return leafletP;
}
async function mapInto(el, lines, {sport = 'run', heat = false, still = false, ends = true} = {}) {   // ends: start/finish dots
  const L = await loadLeaflet();
  cleanViews();
  if (!el.isConnected) return null;   // navigation may finish before Leaflet loads
  if (viewResources.has(el)) { viewResources.get(el)(); viewResources.delete(el); }
  const map = L.map(el, still   // still = feed preview: a picture of the route, taps go to the card's link
    ? {zoomControl: false, attributionControl: true, dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false,
       boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25}
    : {zoomControl: false, attributionControl: true, scrollWheelZoom: heat, tap: true});
  viewResources.set(el, () => map.remove());
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; OpenStreetMap contributors'}).addTo(map);
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--${heat ? 'run' : sport}`).trim() || '#E0582B';
  // set the view BEFORE drawing (Leaflet can't clip lines on a map without a view)
  const all = lines.map((ln) => (typeof ln === 'string' ? decode(ln) : ln)).filter((p) => p.length > 1);
  if (all.length) map.fitBounds(L.latLngBounds(all.flat()), {padding: still ? [12, 12] : [18, 18]}); else map.setView([39.5, -98.5], 3);
  const group = L.featureGroup().addTo(map);
  for (const pts of all) L.polyline(pts, heat ? {color, weight: 2, opacity: .35} : {color, weight: 4, opacity: .95}).addTo(group);
  if (still) { map.attributionControl.setPrefix(false); return {map, L, group}; }
  if (!heat && ends && lines[0]) {
    const pts = typeof lines[0] === 'string' ? decode(lines[0]) : lines[0];
    if (pts.length) {
      L.circleMarker(pts[0], {radius: 6, color: '#fff', weight: 2, fillColor: '#1E7A4F', fillOpacity: 1}).addTo(map);
      L.circleMarker(pts[pts.length - 1], {radius: 6, color: '#fff', weight: 2, fillColor: '#B3261E', fillOpacity: 1}).addTo(map);
    }
  }
  map.attributionControl.setPrefix(false);      // no "Leaflet" credit; phones pinch to zoom, so +/- only with a mouse (2026-10-12)
  if (!matchMedia('(pointer: coarse)').matches) L.control.zoom({position: 'bottomright'}).addTo(map);
  return {map, L, group};
}
function feedMaps(box) {   // Strava-style map on each feed card, built when it scrolls near the screen
  for (const el of box.querySelectorAll('.fmap:not([data-on])')) {
    el.dataset.on = '1';
    lazy(el, () => mapInto(el, [el.dataset.line], {sport: el.dataset.sport, still: true})
      .then(() => el.classList.add('ready')).catch(() => {}));   // on failure the route drawing stays
  }
}
function lazy(el, fn) {   // run fn when el scrolls into view
  cleanViews();
  if (!el || !el.isConnected) return;
  const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); viewResources.delete(el); if (el.isConnected) fn(); } }, {rootMargin: '200px'});
  viewResources.set(el, () => io.disconnect());
  io.observe(el);
}

// ---------- charts ----------
// Stacked charts over one x axis (distance or time) with one crosshair + readout for all of them.
function chartStack(box, x, rows, {xfmt, onIndex} = {}) {
  const W = Math.max(300, box.clientWidth || 340), H = 92, padL = 34, padR = 6;
  const n = x.length; if (n < 2) { box.innerHTML = '<p class="muted">No samples recorded.</p>'; return; }
  const X = (i) => padL + (x[i] - x[0]) / (x[n - 1] - x[0] || 1) * (W - padL - padR);
  const readout = document.createElement('div'); readout.className = 'readout num'; readout.innerHTML = '<span></span>';
  box.innerHTML = ''; box.append(readout);
  const svgs = [];
  for (const r of rows) {
    const vals = r.vals.map((v) => (v == null || !isFinite(v) ? null : v));
    const ok = vals.filter((v) => v != null); if (ok.length < 2) continue;
    let lo = Math.min(...ok), hi = Math.max(...ok);
    if (r.clip) { const s = [...ok].sort((a, b) => a - b); lo = s[Math.floor(s.length * .02)]; hi = s[Math.ceil(s.length * .98) - 1]; }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * .08; lo -= pad; hi += pad;
    const Y = (v) => { const t = (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo); return 6 + (r.invert ? t : 1 - t) * (H - 12); };
    let d = '', started = false;
    vals.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; started = true; });
    const firstI = vals.findIndex((v) => v != null), lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    const area = `${d}L${X(lastI).toFixed(1)},${H - 4}L${X(firstI).toFixed(1)},${H - 4}Z`;
    const avg = r.avg != null ? r.avg : ok.reduce((a, b) => a + b, 0) / ok.length;
    const wrap = document.createElement('div'); wrap.className = 'chartbox';
    wrap.innerHTML = `<div class="lbl"><span>${esc(r.name)}</span><span>avg <b>${esc(r.fmt(avg))}</b> ${esc(r.unit || '')}</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(r.name)} chart">
        <line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}" stroke-dasharray="3 3"/>
        <text class="yl" x="2" y="${(Y(r.invert ? lo : hi) + 4).toFixed(0)}">${esc(r.fmt(r.invert ? lo + pad : hi - pad))}</text>
        <text class="yl" x="2" y="${(Y(r.invert ? hi : lo) - 2).toFixed(0)}">${esc(r.fmt(r.invert ? hi - pad : lo + pad))}</text>
        <path class="area" d="${area}" fill="${r.color}"/><path class="ln" d="${d}" stroke="${r.color}"/>
        <line class="xh" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/></svg>`;
    box.append(wrap); svgs.push({svg: $('svg', wrap), r, vals});
  }
  const show = (i) => {
    const px = X(i);
    for (const s of svgs) { const l = $('.xh', s.svg); l.setAttribute('x1', px); l.setAttribute('x2', px); l.setAttribute('visibility', 'visible'); }
    readout.innerHTML = `<span>${esc(xfmt(x[i]))}</span>` + svgs.map((s) => `<span>${esc(s.r.short || s.r.name)} <b>${s.vals[i] == null ? '–' : esc(s.r.fmt(s.vals[i]))}</b></span>`).join('');
    if (onIndex) onIndex(i);
  };
  const move = (e) => {
    const sv = e.currentTarget, rect = sv.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * W;
    const t = x[0] + (px - padL) / (W - padL - padR) * (x[n - 1] - x[0]);
    let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (x[m] < t) lo = m + 1; else hi = m; }
    show(Math.max(0, Math.min(n - 1, lo)));
  };
  for (const s of svgs) { s.svg.addEventListener('pointerdown', move); s.svg.addEventListener('pointermove', move); }
}

// simple dot chart over dates with a trend line (matched routes, PR history, VO2max)
function dotChart(box, pts, {yfmt, invert = false, trend = null, current = null, best = null, height = 150, line = false}) {   // line: join the dots (pts oldest first)
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 40, padR = 8, padB = 18;
  if (pts.length < 1) { box.innerHTML = '<p class="muted">Not enough data yet.</p>'; return; }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 1; x1 += 1; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0 || 1) * .15; y0 -= pad; y1 += pad;
  const X = (v) => padL + (v - x0) / (x1 - x0) * (W - padL - padR);
  const Y = (v) => { const t = (v - y0) / (y1 - y0); return 6 + (invert ? t : 1 - t) * (H - 6 - padB); };
  let g = '';
  for (const v of [y0 + pad, (y0 + y1) / 2, y1 - pad]) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="2" y="${(Y(v) + 3).toFixed(0)}">${esc(yfmt(v))}</text>`;
  const span = x1 - x0;   // days: short ranges show the day ("Oct 8"), long ones the year ("Oct '26")
  const dfmt = (d) => { const t = new Date(d * 864e5); return span <= 120 ? t.toLocaleDateString([], {month: 'short', day: 'numeric'}) : t.toLocaleDateString([], {month: 'short'}) + " '" + String(t.getFullYear()).slice(2); };
  g += `<text class="yl" x="${padL}" y="${H - 3}">${esc(dfmt(x0))}</text><text class="yl" x="${W - padR}" y="${H - 3}" text-anchor="end">${esc(dfmt(x1))}</text>`;
  if (trend) g += `<line class="trendline" x1="${X(xs[0]).toFixed(1)}" y1="${Y(trend.start).toFixed(1)}" x2="${X(xs[xs.length - 1]).toFixed(1)}" y2="${Y(trend.end).toFixed(1)}"/>`;
  if (line) g += `<polyline class="dotline" points="${pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
  pts.forEach((p) => { g += `<circle class="dotp${p.id === best ? ' best' : ''}${p.id === current ? ' cur' : ''}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.id === current || p.id === best ? 6 : 4.5}"/>`; });
  box.innerHTML = `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Trend chart">${g}</svg></div>`;
}


// ---------- progress charts (2026-10-09): one readout line above each chart, touch/hover to read ----------
const niceStep = (max, n = 4) => { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw || 1)), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
// Columns of stacked bars. cols: [{label, tick, segs: [{k, v}], partial}], keys: [{k, name, color}]
function periodBars(box, cols, {keys, fmt, yfmt = fmt, avg = null, avgLabel = 'avg', height = 180}) {
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 34, padR = 4, padT = 8, padB = 18, n = cols.length;
  const tot = (c) => c.segs.reduce((s, x) => s + x.v, 0);
  const max = Math.max(1e-9, ...cols.map(tot), avg || 0), step = niceStep(max), top = Math.ceil(max / step) * step;
  const Y = (v) => padT + (1 - v / top) * (H - padT - padB), bw = (W - padL - padR) / n, gap = Math.min(4, bw * .25);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(yfmt(v))}</text>`;
  cols.forEach((c, i) => {
    let y = Y(0); const x = padL + i * bw + gap / 2, w = Math.max(1, bw - gap);
    c.segs.forEach((sg, j) => {
      if (!sg.v) return;
      const h = Y(0) - Y(sg.v), last = j === c.segs.length - 1 || c.segs.slice(j + 1).every((z) => !z.v);
      const hh = Math.max(1, h - (last ? 0 : 1.5));   // 1.5px surface gap between stacked segments
      // round-topped bars (2026-10-13): the top corners as round as the bar is wide, up to 8 px
      const r = Math.min(8, w / 2, hh - 1);
      g += last && hh > 4 ? `<path class="bar-seg k-${sg.k}${c.partial ? ' partial' : ''}" d="M${x.toFixed(1)},${(y).toFixed(1)}v${(-hh + r).toFixed(1)}a${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${r.toFixed(1)},${(-r).toFixed(1)}h${(w - 2 * r).toFixed(1)}a${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${r.toFixed(1)},${r.toFixed(1)}v${(hh - r).toFixed(1)}z"/>`
                          : `<rect class="bar-seg k-${sg.k}${c.partial ? ' partial' : ''}" x="${x.toFixed(1)}" y="${(y - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}"/>`;
      y -= h;
    });
    if (c.tick) g += `<text class="yl" x="${(i >= n - 2 ? x + w : x + w / 2).toFixed(1)}" y="${H - 4}" text-anchor="${i >= n - 2 ? 'end' : 'middle'}">${esc(c.tick)}</text>`;
  });
  if (avg) g += `<line class="avgline" x1="${padL}" x2="${W - padR}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}"/>`;   // labelled in the legend below
  g += `<rect class="hl" x="0" y="${padT}" width="${bw.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" visibility="hidden"/>`;
  const legend = (keys.length > 1 ? keys.map((k) => `<span><i class="sw k-${k.k}"></i>${esc(k.name)}</span>`).join('') : '') + (avg ? `<span><i class="sw dash"></i>${esc(avgLabel)} ${esc(fmt(avg))}</span>` : '');
  box.innerHTML = `<div class="readout num"><span></span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bar chart">${g}</svg></div>${legend ? `<div class="legend small">${legend}</div>` : ''}`;
  const svgEl = $('svg', box), hl = $('.hl', box), ro = $('.readout', box);
  const show = (e) => {
    const r = svgEl.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, i = Math.floor((px - padL) / bw);
    if (i < 0 || i >= n) return;
    const c = cols[i]; hl.setAttribute('x', (padL + i * bw).toFixed(1)); hl.setAttribute('visibility', 'visible');
    const parts = keys.length > 1 ? c.segs.filter((x) => x.v).map((x) => `<span><i class="sw k-${x.k}"></i>${esc(keys.find((k) => k.k === x.k).name)} <b>${esc(fmt(x.v))}</b></span>`).join('') : '';
    ro.innerHTML = `<span>${esc(c.label)}${c.partial ? ' (so far)' : ''}</span><span><b>${esc(fmt(tot(c)))}</b> total</span>${parts}`;
  };
  svgEl.addEventListener('pointerdown', show); svgEl.addEventListener('pointermove', show);
}
// Monthly values (faint) + rolling average (solid) over time; one y-axis. pts: [{d: Date, y|null, label}]
function trendLine(box, allPts, {fmt, yfmt = fmt, color = 's1', invert = false, roll = 6, height = 150, rollName = '6-month average', keep = null}) {
  // the rolling average uses the full history, then `keep` (date-range filter) picks which months are drawn
  const allAvg = allPts.map((p, i) => { const w = allPts.slice(Math.max(0, i - roll + 1), i + 1).filter((q) => q.y != null); return p.y == null && !w.length ? null : w.length ? w.reduce((s, q) => s + q.y * (q.w || 1), 0) / w.reduce((s, q) => s + (q.w || 1), 0) : null; });
  const idx = allPts.map((p, i) => (!keep || keep(p) ? i : -1)).filter((i) => i >= 0);
  const pts = idx.map((i) => allPts[i]), avg = idx.map((i) => allAvg[i]);
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 34, padR = 6, padT = 8, padB = 18, n = pts.length;
  const ys = pts.map((p) => p.y).filter((v) => v != null);
  if (ys.length < 2) { box.innerHTML = '<p class="muted small">Not enough data in this range.</p>'; return; }
  const sorted = [...ys].sort((a, b) => a - b), lo0 = sorted[Math.floor(sorted.length * .02)], hi0 = sorted[Math.ceil(sorted.length * .98) - 1];   // ignore the odd extreme month
  const padY = (hi0 - lo0 || 1) * .12, lo = lo0 - padY, hi = hi0 + padY;
  const X = (i) => padL + (n === 1 ? 0 : i / (n - 1)) * (W - padL - padR);
  const Y = (v) => { const t = (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo); return padT + (invert ? t : 1 - t) * (H - padT - padB); };
  const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return d; };
  let g = '';
  for (const v of [lo0, (lo0 + hi0) / 2, hi0]) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(yfmt(v))}</text>`;
  if (n <= 30) {   // short range: label months (Jan '25, Apr, Jul, Oct ...)
    const stepM = n > 14 ? 6 : 3;   // label every 3 or 6 months so labels never collide
    pts.forEach((p, i) => { if (i === 0 || (p.d.getMonth() % stepM === 0 && i > 2)) g += `<text class="yl" x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(p.d.toLocaleDateString([], {month: 'short'}) + (p.d.getMonth() === 0 || i === 0 ? " '" + String(p.d.getFullYear()).slice(2) : ''))}</text>`; });
  } else {
    const yrs = []; pts.forEach((p, i) => { if (p.d.getMonth() === 0 || i === 0) yrs.push(i); });
    const every = Math.ceil(yrs.length / 6);
    yrs.forEach((i, k) => { if (k % every === 0) g += `<text class="yl" x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : 'middle'}">${pts[i].d.getFullYear()}</text>`; });
  }
  g += `<path class="ln faint k-${color}" d="${path(pts.map((p) => p.y))}"/><path class="ln k-${color}" d="${path(avg)}"/>`;
  g += `<line class="xh" y1="${padT}" y2="${H - padB}" visibility="hidden"/><circle class="xdot k-${color}" r="5" visibility="hidden"/>`;
  box.innerHTML = `<div class="readout num"><span></span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly trend">${g}</svg></div>
    <div class="legend small"><span><i class="sw ln-sw k-${color}"></i>${esc(rollName)}</span><span><i class="sw ln-sw faint k-${color}"></i>Each month</span></div>`;
  const svgEl = $('svg', box), xh = $('.xh', box), dot = $('.xdot', box), ro = $('.readout', box);
  const show = (e) => {
    const r = svgEl.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - padL) / (W - padL - padR) * (n - 1))));
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
    if (avg[i] != null) { dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(avg[i])); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
    ro.innerHTML = `<span>${esc(pts[i].label)}</span><span>Month <b>${pts[i].y == null ? '–' : esc(fmt(pts[i].y))}</b></span><span>${esc(rollName.split(' ')[0])} avg <b>${avg[i] == null ? '–' : esc(fmt(avg[i]))}</b></span>`;
  };
  svgEl.addEventListener('pointerdown', show); svgEl.addEventListener('pointermove', show);
}

// running total per day (can go below zero): line + zero line + touch readout. pts: [{label, y, sub}]
function dayLine(box, pts, {fmt, height = 150, color = 'walk'}) {
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 44, padR = 6, padT = 8, padB = 18, n = pts.length;
  if (n < 2) { box.innerHTML = '<p class="muted small">A few more days and the chart appears.</p>'; return; }
  const ys = pts.map((p) => p.y), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const X = (i) => padL + i / (n - 1) * (W - padL - padR), Y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  let g = `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(0) + 3).toFixed(1)}" text-anchor="end">0</text>`;
  for (const v of [hi, lo]) if (Math.abs(v) > span * .15) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(fmt(v, true))}</text>`;
  g += `<text class="yl" x="${padL}" y="${H - 4}">${esc(pts[0].tick)}</text><text class="yl" x="${W - padR}" y="${H - 4}" text-anchor="end">${esc(pts[n - 1].tick)}</text>`;
  g += `<path class="ln k-${color}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')}"/>`;
  g += `<line class="xh" y1="${padT}" y2="${H - padB}" visibility="hidden"/><circle class="xdot k-${color}" r="5" visibility="hidden"/>`;
  box.innerHTML = `<div class="readout num"><span></span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Running total">${g}</svg></div>`;
  const svgEl = $('svg', box), xh = $('.xh', box), dot = $('.xdot', box), ro = $('.readout', box);
  const show = (e) => {
    const r = svgEl.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width * W - padL) / (W - padL - padR) * (n - 1))));
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(pts[i].y)); dot.setAttribute('visibility', 'visible');
    ro.innerHTML = `<span>${esc(pts[i].label)}</span><span>Total <b>${esc(fmt(pts[i].y))}</b></span>${pts[i].sub ? `<span>${pts[i].sub}</span>` : ''}`;
  };
  svgEl.addEventListener('pointerdown', show); svgEl.addEventListener('pointermove', show);
}

// Nutrition trends (2026-10-09): eaten (bars) vs burned (line) + goal (dashed), one kcal axis. cols: [{label, tick, eaten, burned, goal, partial}]
function energyChart(box, cols, {height = 190, weight = null} = {}) {   // weight: {fmt, axis} -> panel below with cols[i].weight / .trend
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 38, padR = 4, padT = 8, padB = 18, n = cols.length;
  if (!cols.some((c) => c.eaten)) { box.innerHTML = '<p class="muted small">Log some food and this chart fills in.</p>'; return; }
  const max = Math.max(1, ...cols.flatMap((c) => [c.eaten || 0, c.burned || 0, c.goal || 0])), step = niceStep(max), top = Math.ceil(max / step) * step;
  const Y = (v) => padT + (1 - v / top) * (H - padT - padB), bw = (W - padL - padR) / n, gap = Math.min(3, bw * .25), X = (i) => padL + i * bw + bw / 2;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v}</text>`;
  cols.forEach((c, i) => {
    if (c.eaten) { const h = Y(0) - Y(c.eaten), x = padL + i * bw + gap / 2, w = Math.max(1, bw - gap);
      g += h > 4 && w > 6 ? `<path class="bar-seg k-s1${c.partial ? ' partial' : ''}" d="M${x.toFixed(1)},${Y(0).toFixed(1)}v${(-h + 3).toFixed(1)}q0,-3 3,-3h${(w - 6).toFixed(1)}q3,0 3,3v${(h - 3).toFixed(1)}z"/>`
                          : `<rect class="bar-seg k-s1${c.partial ? ' partial' : ''}" x="${x.toFixed(1)}" y="${Y(c.eaten).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`; }
    if (c.tick) g += `<text class="yl" x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="${i >= n - 2 ? 'end' : i <= 1 ? 'start' : 'middle'}">${esc(c.tick)}</text>`;
  });
  const path = (k) => { let d = '', pen = false; cols.forEach((c, i) => { if (!c[k]) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(c[k]).toFixed(1)}`; pen = true; }); return d; };
  g += `<path class="ln goal-ln" d="${path('goal')}"/><path class="ln k-run" d="${path('burned')}"/>`;
  g += `<rect class="hl" x="0" y="${padT}" width="${bw.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" visibility="hidden"/>`;
  // weight panel: same x positions as the bars, its own (weight) axis
  const wv = weight ? cols.flatMap((c) => [c.weight, c.trend]).filter((v) => v != null) : [];
  let w = '', WH = 0;
  if (wv.length >= 2) {
    WH = 96; let lo = Math.min(...wv), hi = Math.max(...wv); const pad = Math.max(.3, (hi - lo) * .15); lo -= pad; hi += pad;
    const WY = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (WH - 16);
    for (const v of [hi - pad, lo + pad]) w += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${WY(v).toFixed(1)}" y2="${WY(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(WY(v) + 3).toFixed(1)}" text-anchor="end">${esc(weight.axis(v))}</text>`;
    let d = '', pen = false; cols.forEach((c, i) => { if (c.trend == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${WY(c.trend).toFixed(1)}`; pen = true; });
    w += cols.map((c, i) => (c.weight == null ? '' : `<circle class="wdot" cx="${X(i).toFixed(1)}" cy="${WY(c.weight).toFixed(1)}" r="3"/>`)).join('') + `<path class="ln k-s3" d="${d}"/>`;
    w += `<rect class="hl" x="0" y="0" width="${bw.toFixed(1)}" height="${WH}" visibility="hidden"/>`;
  }
  box.innerHTML = `<div class="readout num"><span></span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Calories eaten and burned">${g}</svg>
      ${WH ? `<div class="wpanel-label small muted">Weight${weight.unit ? ' (' + esc(weight.unit) + ')' : ''}</div><svg class="wpanel" viewBox="0 0 ${W} ${WH}" width="${W}" height="${WH}" role="img" aria-label="Weight">${w}</svg>` : ''}</div>
    <div class="legend small"><span><i class="sw k-s1"></i>Eaten</span><span><i class="sw ln-sw k-run"></i>Burned</span><span><i class="sw dash"></i>Goal</span>${WH ? '<span><i class="sw ln-sw k-s3"></i>Weight trend</span><span><i class="sw wsw"></i>Weigh-ins</span>' : ''}</div>`;
  const svgs = $$('svg', box), hls = $$('.hl', box), ro = $('.readout', box), f = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), i = Math.floor(((e.clientX - r.left) / r.width * W - padL) / bw); if (i < 0 || i >= n) return;
    const c = cols[i]; hls.forEach((h) => { h.setAttribute('x', (padL + i * bw).toFixed(1)); h.setAttribute('visibility', 'visible'); });
    const def = c.eaten != null && c.burned && c.counted !== false ? c.burned - c.eaten : null;   // partly logged days: no deficit
    ro.innerHTML = `<span>${esc(c.label)}${c.partial ? ' (so far)' : ''}</span><span>Eaten <b>${f(c.eaten)}</b></span><span>Burned <b>${f(c.burned)}</b></span>${c.goal ? `<span>Goal <b>${f(c.goal)}</b></span>` : ''}${def != null && !c.partial ? `<span>${def >= 0 ? 'Deficit' : 'Surplus'} <b>${f(Math.abs(def))}</b></span>` : ''}${c.counted === false && c.eaten != null && !c.partial ? '<span>Partly logged, not counted</span>' : ''}${weight && (c.weight != null || c.trend != null) ? `<span>Weight <b>${c.weight != null ? esc(weight.fmt(c.weight)) : '–'}</b>${c.trend != null ? ` (trend ${esc(weight.fmt(c.trend))})` : ''}</span>` : ''}${c.day ? `<a class="ro-edit" href="/food?d=${esc(c.day)}">Edit this day ›</a>` : ''}`;
  };
  svgs.forEach((sv) => { sv.addEventListener('pointerdown', show); sv.addEventListener('pointermove', show); });
}

// fitness / fatigue / form lines
function loadChart(box, days) {
  const W = Math.max(300, box.clientWidth || 340), H = 170, padL = 30, padB = 18;
  if (days.length < 2) { box.innerHTML = '<p class="muted">Needs activities with heart rate.</p>'; return; }
  const n = days.length, vals = days.flatMap((d) => [d.fitness, d.fatigue, d.form]);
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
  const X = (i) => padL + i / (n - 1) * (W - padL - 6), Y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 6 - padB);
  const path = (k) => days.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[k]).toFixed(1)}`).join('');
  const m0 = new Date(days[0].d + 'T12:00'), m1 = new Date(days[n - 1].d + 'T12:00');   // local noon: no off-by-one day
  box.innerHTML = `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fitness, fatigue and form">
    <line class="gl" x1="${padL}" x2="${W - 6}" y1="${Y(0)}" y2="${Y(0)}"/>
    <text class="yl" x="2" y="${Y(hi) + 8}">${Math.round(hi)}</text><text class="yl" x="2" y="${Y(0) + 3}">0</text>
    <text class="yl" x="${padL}" y="${H - 3}">${esc(m0.toLocaleDateString([], {month: 'short'}) + " '" + String(m0.getFullYear()).slice(2))}</text>
    <text class="yl" x="${W - 6}" y="${H - 3}" text-anchor="end">${esc(m1.toLocaleDateString([], {month: 'short', day: 'numeric'}) + (m1.getFullYear() !== new Date().getFullYear() ? " '" + String(m1.getFullYear()).slice(2) : ''))}</text>
    <path class="ln s1" d="${path('fitness')}"/><path class="ln s2" d="${path('fatigue')}"/><path class="ln s3" d="${path('form')}"/></svg>
    <div class="badges"><span class="badge">● Fitness</span><span class="badge">● Fatigue</span><span class="badge">● Form</span></div></div>`;
  const b = $$('.badge', box); b[0].classList.add('s1'); b[1].classList.add('s2'); b[2].classList.add('s3');
}

// an AI request that failed: the reason stays next to the button (a toast is easy to miss while you wait)
function aiError(btn, msg) {
  let p = btn.parentNode.querySelector('.ai-err');
  if (!p) { p = document.createElement('p'); p.className = 'small warn-text ai-err'; p.setAttribute('role', 'alert'); btn.after(p); }
  p.textContent = msg;
}
// ---------- AI consent (2026-10-11): coach notes, weekly reviews and food photos send data to the AI service ----------
const aiExplain = () => `<p>Kit is Kinetta’s AI coach. Kit can write a short <b>workout note</b> on each new workout, a <b>weekly review</b> on Sundays, <b>estimate the food in a photo</b>, <b>review your eating</b> and give <b>feedback on your recipes</b>.</p>
  <p class="small muted">To do that, the workout's numbers and your recent training, your food log, the recipe, or the photo, are sent to ${esc(App.me.ai_provider || 'an AI service')}, which writes the text. Nothing is sent while this is off, and you can turn it off any time under Me.</p>`;
function aiSheet(after) {   // ask once; after() runs when they turn it on
  sheet('Turn on AI features?', `<div class="form">${aiExplain()}<div class="actions"><button class="primary" id="ai-yes">Turn on</button><button class="ghost" id="ai-no">Not now</button></div></div>`, (b, close) => {
    $('#ai-no', b).onclick = close;
    $('#ai-yes', b).onclick = async (e) => {
      e.target.disabled = true;
      try { await api('/api/profile', json('PUT', {ai_ok: true})); App.me.ai_ok = true; keep('/api/me', App.me); close(); toast('AI features on'); if (after) after(); }
      catch (x) { toast(x.message); e.target.disabled = false; }
    };
  });
}

// ---------- login, first-run setup, invite links + start ----------
const BRAND = `<picture class="brand"><source srcset="/static/logo-dark.svg?v=2" media="(prefers-color-scheme: dark)"><img src="/static/logo.svg?v=2" alt="Kinetta" width="210" height="34"></picture>`;
function showLogin(msg = '') {
  root.innerHTML = `<div class="login"><form novalidate>
    <div>${BRAND}<p>Your runs, rides, walks and food, private to you.</p></div>
    ${Native.on ? `<label${(Native.base || Native.server) === Native.server ? ' hidden' : ''} id="l-server">Server<input name="server" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" enterkeyhint="next" value="${esc(Native.base || Native.server)}"></label>` : ''}
    <label>Username<input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" enterkeyhint="go" required></label>
    <p class="err" role="alert">${esc(msg)}</p>
    <button class="primary" type="submit">Log in</button>
    <p class="small muted">New here? Ask the person who runs this Kinetta for an invite link.</p></form></div>`;
  const f = $('form', root);
  $('input[name=login]', f).focus();
  // the iPhone app: most people use the hosted server, so its address stays out of the way until asked for, and the
  // waitlist opens in Safari (accounts are made on the server's web page)
  if (Native.on) {
    const p = $('.login .small.muted', root), srv = $('#l-server', root);
    p.innerHTML = `New here? <a href="${Native.server}/beta" target="_blank" rel="noopener">Join the beta</a>`;
    const o = $('#l-other', p); if (o) o.onclick = (e) => { e.preventDefault(); srv.hidden = false; o.remove(); $('input', srv).focus(); };
  }
  if (!Native.on) api('/api/beta').then((r) => {   // a server with the public waitlist on: point newcomers to it
    const p = $('.login .small.muted', root);
    if (r.open && p) { p.innerHTML = 'New here? <a href="/beta">Join the beta</a>'; $('a', p).onclick = (e) => { e.preventDefault(); history.replaceState(null, '', '/beta'); showBeta(); }; }
  }).catch(() => {});
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('button', f), err = $('.err', f);
    const login = f.login.value.trim(), password = f.password.value;
    if (!login || !password) { err.textContent = 'Enter your username and password.'; return; }
    b.disabled = true; b.textContent = 'Logging in…'; err.textContent = '';
    try { if (Native.on) await Native.login(f.server.value, login, password); else await api('/api/login', json('POST', {login, password})); await start(); }
    catch (x) { err.textContent = x.message; b.disabled = false; b.textContent = 'Log in'; f.password.select(); }
  });
}
// The phone's own time zone and usual units, so a new account starts out right (both can be changed under Me).
function phoneDefaults() {
  let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* older browser: server default */ }
  const region = (navigator.language || '').split('-')[1] || '';
  return {tz, units: ['US', 'LR', 'MM'].includes(region.toUpperCase()) ? 'imperial' : 'metric'};
}
// "Create your account" (brand-new server: the first person becomes the admin) or "Join" (from an invite link)
function showNewAccount({title, intro, button, send}) {
  root.innerHTML = `<div class="login"><form novalidate>
    <div>${BRAND}<h1>${esc(title)}</h1><p>${intro}</p></div>
    <label>Your name<input name="name" autocomplete="name" maxlength="60" enterkeyhint="next" required></label>
    <label>Username<input name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="30" enterkeyhint="next" required></label>
    <p class="small muted">What you'll type to log in: lowercase letters, numbers or _.</p>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="10" enterkeyhint="go" required></label>
    <p class="small muted">At least 10 characters. A short sentence you'll remember works well.</p>
    <p class="err" role="alert"></p>
    <button class="primary" type="submit">${esc(button)}</button></form></div>`;
  const f = $('form', root); f.name.focus();
  f.name.addEventListener('input', () => {   // suggest a username from the first name until they type their own
    if (f.login.dataset.touched) return;
    f.login.value = (f.name.value.trim().split(/\s+/)[0] || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9_]/g, '').slice(0, 30);
  });
  f.login.addEventListener('input', () => { f.login.dataset.touched = '1'; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('button', f), err = $('.err', f);
    if (!f.name.value.trim() || !f.login.value.trim()) { err.textContent = 'Enter your name and a username.'; return; }
    if (f.password.value.length < 10) { err.textContent = 'Use at least 10 characters for your password.'; f.password.focus(); return; }
    b.disabled = true; err.textContent = '';
    try { await send({name: f.name.value, login: f.login.value.trim().toLowerCase(), password: f.password.value, ...phoneDefaults()}); history.replaceState(null, '', '/me'); await start(); }
    catch (x) { err.textContent = x.message; b.disabled = false; }
  });
}
async function showJoin(token) {
  let info;
  try { info = await api('/api/join/' + encodeURIComponent(token)); }
  catch (x) {
    root.innerHTML = `<div class="login"><div class="form">${BRAND}<h1>This link doesn't work</h1><p>${esc(x.message)}</p><a class="ghost" href="/">Go to log in</a></div></div>`;
    $('a', root).onclick = (e) => { e.preventDefault(); history.replaceState(null, '', '/'); showLogin(); };
    return;
  }
  showNewAccount({title: 'Join Kinetta', button: 'Create my account',
    intro: `${info.inviter ? esc(info.inviter) + ' invited you. ' : ''}Make your account. Your activities and food log are private to you.`,
    send: (body) => api('/api/join', json('POST', {...body, token}))});
}
// "Join the beta" (public waitlist, only when the server has KINETTA_BETA_SIGNUP=1): no account yet, an admin invites them
async function showBeta() {
  let open = false;
  try { open = (await api('/api/beta')).open; } catch (x) { /* treat as closed */ }
  if (!open) { history.replaceState(null, '', '/'); return showLogin(); }
  root.innerHTML = `<div class="login"><form novalidate>
    <div>${BRAND}<h1>Join the beta</h1><p>Kinetta puts your workouts and your food log in one private app. We're inviting a small group of testers. Tell us a little about you and we'll send you an invite link.</p></div>
    <label>Your name<input name="name" autocomplete="name" maxlength="60" enterkeyhint="next" required></label>
    <label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="120" enterkeyhint="next" required></label>
    <label>Your phone<select name="phone" required><option value="">Choose…</option><option value="iphone">iPhone</option><option value="android">Android</option><option value="other">Something else</option></select></label>
    <label>Your watch or tracker (optional)<input name="watch" maxlength="60" placeholder="e.g. Garmin Forerunner, Apple Watch, none"></label>
    <label>Anything we should know? (optional)<textarea name="note" maxlength="300" rows="3"></textarea></label>
    <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="small muted">We use your email only to send your invite. <a href="https://kinetta.app/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
    <p class="err" role="alert"></p>
    <button class="primary" type="submit">Ask to join</button>
    <p class="small muted">Already have an account? <a href="/" id="b-login">Log in</a></p><p class="small"><a href="https://kinetta.app/">Back to the Kinetta website</a></p></form></div>`;
  const f = $('form', root); f.name.focus();
  $('#b-login', root).onclick = (e) => { e.preventDefault(); history.replaceState(null, '', '/'); showLogin(); };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('button', f), err = $('.err', f);
    if (!f.name.value.trim() || !f.email.value.trim()) { err.textContent = 'Enter your name and email.'; return; }
    if (!f.phone.value) { err.textContent = 'Choose your phone.'; f.phone.focus(); return; }
    b.disabled = true; err.textContent = '';
    try {
      await api('/api/beta', json('POST', {name: f.name.value, email: f.email.value, phone: f.phone.value, watch: f.watch.value, note: f.note.value, website: f.website.value}));
      root.innerHTML = `<div class="login"><div class="form">${BRAND}<h1>Thanks, ${esc(f.name.value.trim().split(/\s+/)[0])}!</h1>
        <p>You're on the list. We'll email your invite link to ${esc(f.email.value.trim())} when there's a spot.</p><a class="primary wide" href="https://kinetta.app/">Back to the Kinetta website</a></div></div>`;
    } catch (x) { err.textContent = x.message; b.disabled = false; }
  });
}
async function showWelcome() {
  if (Native.on) return showLogin();   // new accounts, invites and the waitlist are on the server's web page
  let setup = {needed: false};
  try { setup = await api('/api/setup'); } catch (x) { /* show the login */ }
  const join = location.pathname.match(/^\/join\/([\w-]+)$/);
  if (join) return showJoin(join[1]);
  if (location.pathname === '/beta') return showBeta();
  if (!setup.needed) return showLogin();
  showNewAccount({title: 'Welcome to Kinetta', button: 'Create my account',
    intro: "This is a brand-new Kinetta. Create your account first. You'll be its admin and can invite your people next.",
    send: (body) => api('/api/setup', json('POST', body))});
}
async function start() {
  await Native.ready;
  if (Native.on && !Native.token) return showLogin();
  const enter = () => {
    if (location.pathname === '/' || location.pathname === '' || location.pathname.startsWith('/join/') || location.pathname === '/beta') history.replaceState(null, '', '/me');
    Native.resumeFoodEntry?.();render(); Q.flush().catch(e => toast(e.message)); netbar(); Native.autoSync(); setTimeout(warmTabs, 1500);
  };
  // logged in on this phone before: open at once and check the login in the background (a 401 there shows the login)
  const saved = kept('/api/me');
  if (saved && !location.pathname.startsWith('/join/')) {
    App.me = saved; enter();
    api('/api/me').then(refreshMe).catch((x) => { if (x.status === 401) forgetKept(); else if (x.offline) netState(true); });
    return;
  }
  try {
    App.me = await api('/api/me'); keep('/api/me', App.me);
    enter();
  } catch (x) {
    if (x.status === 401) { forgetKept(); showWelcome(); return; }
    if (x.offline && kept('/api/me')) {   // no connection: open with what's saved on this phone
      App.me = kept('/api/me'); netState(true);
      if (location.pathname === '/' || location.pathname === '') history.replaceState(null, '', '/me');
      render(); return;
    }
    root.innerHTML = `<div class="boot"><p>${esc(x.message)}</p><button class="ghost" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', () => { root.innerHTML = '<p class="boot">Loading…</p>'; start(); });
  }
}
// (the iPhone app has its files built in: no service worker there)
if ('serviceWorker' in navigator && !window.Capacitor) navigator.serviceWorker.register('/sw.js').catch(() => {});

function installKeyboardDismissal() {
  let gesture = null;
  const editable = (el) => el && (el.matches('input:not([type="checkbox"]):not([type="radio"]), textarea') || el.isContentEditable);
  // Blank space and message text dismiss without consuming a control's action.
  // Fields, map/photo gestures and active text selections keep their normal jobs.
  document.addEventListener('click', (e) => {
    const field = document.activeElement;
    if (!editable(field) || e.defaultPrevented || e.button > 0 ||
        document.getSelection?.()?.isCollapsed === false ||
        e.target.closest('input, textarea, select, label, [contenteditable], button, a, summary, [role="button"], .map, .fmap, .media-track, .ph-view')) return;
    field.blur();
  });
  document.addEventListener('touchstart', (e) => {
    const field = document.activeElement;
    if (e.touches.length !== 1 || !editable(field) || e.target.closest('input, textarea, [contenteditable], .map, .fmap, .media-track, .ph-view')) { gesture = null; return; }
    gesture = {x: e.touches[0].clientX, y: e.touches[0].clientY, field};
  }, {passive: true});
  document.addEventListener('touchmove', (e) => {
    if (!gesture || e.touches.length !== 1) { gesture = null; return; }
    const dx = e.touches[0].clientX - gesture.x, dy = e.touches[0].clientY - gesture.y;
    if (dy > 40 && dy > Math.abs(dx) * 1.5) { if (document.activeElement === gesture.field) gesture.field.blur(); gesture = null; }
  }, {passive: true});
  document.addEventListener('touchend', () => { gesture = null; }, {passive: true});
  document.addEventListener('touchcancel', () => { gesture = null; }, {passive: true});
}
installKeyboardDismissal();
