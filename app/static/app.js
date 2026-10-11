// Lankki phone app — plain JS, no build step. Part 1: plumbing (api cache, router, formatting, icons, charts, maps).
// Page code lives in pages.js. Design rules (instant feedback, cached screens,
// optimistic edits with undo, skeletons, safe areas, no inline style attributes because of the CSP).
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const root = $('#app');
const col = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';   // real colour for SVG attributes
const App = {me: null, cache: new Map(), pages: [], scroll: {}};

// ---------- API: fetch + per-session cache (stale-while-revalidate) ----------
async function api(path, opts = {}) {
  let r;
  const headers = opts.body instanceof FormData ? {} : {'Content-Type': 'application/json'};
  // in the iPhone app: the chosen server + the login token in a header (native.js); in a browser: this site + its cookie
  try { r = await fetch(Native.base + path, {credentials: Native.on ? 'omit' : 'same-origin', ...opts, headers: {...headers, ...Native.headers(), ...(opts.headers || {})}}); }
  catch (e) { throw Object.assign(new Error("Can't reach Lankki - check your connection."), {offline: true}); }
  let body = null; try { body = await r.json(); } catch (e) { /* empty */ }
  if (!r.ok) {
    const d = body && body.detail;
    const e = new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : `Error ${r.status}`);
    e.status = r.status;
    if (r.status === 401 && App.me) { App.me = null; showLogin('Please log in again.'); }
    throw e;
  }
  return body;
}
const json = (method, body) => ({method, body: JSON.stringify(body)});
// Calls render(data) at once with cached data (if any), then again with fresh data when it arrives.
// Offline (2026-10-10): the screens you use most are also kept on the phone (localStorage) and shown from there.
async function load(path, render, {maxAge = 15000} = {}) {
  let hit = App.cache.get(path);
  if (!hit && !navigator.onLine) { const k = kept(path); if (k) { hit = {data: k, at: 0}; App.cache.set(path, hit); } }
  if (hit) render(hit.data, true);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  let data;
  try { data = await api(path); }
  catch (e) {
    if (!e.offline) throw e;
    netState(true);
    if (hit) return hit.data;
    const k = kept(path); if (!k) throw e;
    App.cache.set(path, {data: k, at: 0}); render(k, true); return k;
  }
  netState(false);
  App.cache.set(path, {data, at: Date.now()}); keep(path, data);
  if (!hit || JSON.stringify(hit.data) !== JSON.stringify(data)) render(data, false);
  return data;
}

// ---------- offline: kept screens + a send queue for food and weight (2026-10-10) ----------
const KEEP = [/^\/api\/me$/, /^\/api\/food\/day/, /^\/api\/food\/(recent|usual|foods|meals)$/, /^\/api\/food\/weights\?days=90$/, /^\/api\/plans\/current$/,
  /^\/api\/stats$/, /^\/api\/goals$/, /^\/api\/activities\?limit=3$/, /^\/api\/fitness\?days=60$/, /^\/api\/coach\/week$/];
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked: offline copies are a bonus */ } },
};
function keep(path, data) { if (App.me && KEEP.some((r) => r.test(path))) store.set('fit.c:' + path, {who: App.me.login, data}); }
function kept(path) { const v = store.get('fit.c:' + path); return v && (!App.me || v.who === App.me.login) ? v.data : null; }
function forgetKept() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('fit.c:')) localStorage.removeItem(k); } catch (e) { /* none */ } }
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
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
const Q = {
  all() { return store.get('fit.queue') || []; },
  mine() { return Q.all().filter((o) => App.me && o.who === App.me.login); },
  add(op) { store.set('fit.queue', [...Q.all(), {...op, who: App.me.login, at: Date.now()}]); netbar(); },
  async flush() {
    if (Q.busy || !App.me || !navigator.onLine) return;
    const q = Q.all(); if (!q.some((o) => o.who === App.me.login)) return;
    Q.busy = true; const keepOps = []; let sent = 0, offline = false;
    for (const op of q) {
      if (op.who !== App.me.login || offline) { keepOps.push(op); continue; }
      try { await api(op.path, {method: op.method, body: JSON.stringify(op.body)}); sent++; }
      catch (e) { if (e.offline) { offline = true; keepOps.push(op); } else toast(`Couldn't save ${op.label}: ${e.message}`); }
    }
    store.set('fit.queue', [...keepOps, ...Q.all().slice(q.length)]);   // keep anything added while sending
    Q.busy = false; netState(offline);
    if (sent) { invalidate('/api/'); toast(`Sent ${sent} item${sent > 1 ? 's' : ''} saved while offline`); render(); }
  },
};
// writes that may wait for a connection: food entries and weigh-ins. Returns the server reply, or {queued: true}.
async function sendOrQueue(path, method, body, label) {
  if (navigator.onLine) {
    try { const r = await api(path, json(method, body)); netState(false); return r; }
    catch (e) { if (!e.offline) throw e; }
  }
  netState(true); Q.add({path, method, body, label}); App.queuedAt = Date.now(); return {queued: true};
}
function netState(off) { if (App.offline !== off) { App.offline = off; netbar(); } }
function netbar() {
  let b = $('#netbar'); const n = Q.mine().length;
  if (!App.offline && !n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; b.setAttribute('role', 'status'); document.body.append(b); }
  b.textContent = App.offline ? `Offline - showing what's saved on this phone${n ? ` · ${n} waiting to send` : ''}` : `${n} item${n > 1 ? 's' : ''} waiting to send…`;
}
addEventListener('online', () => { netState(false); Q.flush(); });
addEventListener('offline', () => netState(true));
setInterval(() => { if (Q.mine().length) Q.flush(); }, 30000);
const invalidate = (prefix) => { for (const k of App.cache.keys()) if (k.startsWith(prefix)) App.cache.delete(k); };
const prefetch = (path) => { if (!App.cache.has(path)) api(path).then((data) => App.cache.set(path, {data, at: Date.now()})).catch(() => {}); };

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
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>', other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.other}</svg>`;
const sportMark = (s) => `<span class="sp ${esc(s)}" aria-hidden="true">${svg(s)}</span>`;

// ---------- toast + sheet ----------
let toastT;
function toast(msg, undo) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  if (Date.now() - (App.queuedAt || 0) < 2000 && !undo) msg += ' - saved on this phone, it sends when you are back online';
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) $('button', t).onclick = () => { t.classList.remove('on'); undo(); };
  t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), undo ? 6000 : 3200);
}
function sheet(title, html, onMount) {
  const prev = document.activeElement;
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${svg('close')}</button></header><div class="sbody">${html}</div></div>`;
  const close = () => { s.remove(); document.removeEventListener('keydown', onKey); if (!document.querySelector('.scrim')) document.body.classList.remove('has-sheet'); if (prev && prev.isConnected && prev.focus) prev.focus(); };
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
  addEventListener('mousemove', (e) => { if (my != null && e.clientY - my > 0) sh.style.transform = `translateY(${e.clientY - my}px)`; });
  addEventListener('mouseup', (e) => { if (my != null) { settle(e.clientY - my > 90); my = null; } });
  document.addEventListener('keydown', onKey);
  document.body.append(s); document.body.classList.add('has-sheet');
  const first = $('input, select, textarea, button:not([data-close])', $('.sbody', s)); if (first) first.focus({preventScroll: true});
  if (onMount) onMount($('.sbody', s), close);
  return close;
}

// ---------- router ----------
const TABS = [['today', 'Today'], ['activity', 'Activity'], ['progress', 'Progress'], ['food', 'Nutrition'], ['me', 'Me']];
function route(re, tab, fn) { App.pages.push({re, tab, fn}); }
function go(path, {replace = false} = {}) {
  App.scroll[location.pathname + location.search] = scrollY;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  render();
}
function render() {
  if (!App.me) return;
  const path = location.pathname.replace(/\/+$/, '') || '/today';
  const page = App.pages.find((p) => p.re.test(path)) || App.pages[0];
  const m = path.match(page.re) || [];
  root.innerHTML = `<main class="shell" id="page"></main><nav class="tabs" aria-label="Main">${TABS.map(([t, n]) =>
    `<a href="/${t}" data-tab="${t}"${t === page.tab ? ' aria-current="page"' : ''}>${svg(t)}<span>${n}</span></a>`).join('')}</nav>`;
  const el = $('#page');
  const key = location.pathname + location.search;
  if (App.lastPath !== location.pathname) { el.classList.add('enter'); App.lastPath = location.pathname; }
  if (typeof Social !== 'undefined') Social.refresh();   // friend requests waiting: a number on the Me tab
  Promise.resolve(page.fn(el, ...m.slice(1))).catch((e) => showError(el, e)).finally(() => {
    requestAnimationFrame(() => window.scrollTo(0, App.scroll[key] || 0));
  });
}
function showError(el, e) {
  if (e && e.status === 401) return;
  el.innerHTML = `<div class="boot"><p>${esc(e && e.message || 'Something went wrong')}</p><button class="ghost" id="retry">Try again</button></div>`;
  $('#retry', el).onclick = () => { invalidate('/api/'); render(); };
}
// in-app links: <a href="/..."> navigate without reloading; prefetch on press for instant pages
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || a.target) return;
  e.preventDefault();
  if (a.dataset.tab && location.pathname.startsWith('/' + a.dataset.tab) && location.pathname.split('/').length <= 2) { window.scrollTo({top: 0, behavior: 'smooth'}); return; }
  if (a.dataset.tab) App.scroll[a.getAttribute('href')] = 0;
  go(a.getAttribute('href'));
});
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest('a[data-prefetch]'); if (a) prefetch(a.dataset.prefetch);
}, {passive: true});
window.addEventListener('popstate', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden && App.me) Q.flush(); if (!document.hidden && App.me && navigator.onLine && Date.now() - (App.hiddenAt || 0) > 60000) { invalidate('/api/'); render(); } if (document.hidden) App.hiddenAt = Date.now(); });

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
function loadLeaflet() {   // (not "leaflet": leaflet.js overwrites window.leaflet)
  if (!leafletP) leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/vendor/leaflet.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = '/static/vendor/leaflet.js'; s.onload = () => res(window.L); s.onerror = rej; document.head.append(s);
  });
  return leafletP;
}
async function mapInto(el, lines, {sport = 'run', heat = false, still = false, ends = true} = {}) {   // ends: start/finish dots
  const L = await loadLeaflet();
  const map = L.map(el, still   // still = feed preview: a picture of the route, taps go to the card's link
    ? {zoomControl: false, attributionControl: true, dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false,
       boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25}
    : {zoomControl: false, attributionControl: true, scrollWheelZoom: heat, tap: true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; OpenStreetMap contributors'}).addTo(map);
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--${heat ? 'run' : sport}`).trim() || '#E0582B';
  // set the view BEFORE drawing (Leaflet can't clip lines on a map without a view)
  const all = lines.map((ln) => (typeof ln === 'string' ? decode(ln) : ln)).filter((p) => p.length > 1);
  if (all.length) map.fitBounds(L.latLngBounds(all.flat()), {padding: still ? [12, 12] : [18, 18]}); else map.setView([39.5, -98.5], 3);
  const group = L.featureGroup().addTo(map);
  for (const pts of all) L.polyline(pts, heat ? {color, weight: 2, opacity: .35} : {color, weight: 4, opacity: .95}).addTo(group);
  if (still) { map.attributionControl.setPrefix(false); return {map, L}; }
  if (!heat && ends && lines[0]) {
    const pts = typeof lines[0] === 'string' ? decode(lines[0]) : lines[0];
    if (pts.length) {
      L.circleMarker(pts[0], {radius: 6, color: '#fff', weight: 2, fillColor: '#1E7A4F', fillOpacity: 1}).addTo(map);
      L.circleMarker(pts[pts.length - 1], {radius: 6, color: '#fff', weight: 2, fillColor: '#B3261E', fillOpacity: 1}).addTo(map);
    }
  }
  L.control.zoom({position: 'bottomright'}).addTo(map);
  return {map, L};
}
function feedMaps(box) {   // Strava-style map on each feed card, built when it scrolls near the screen
  for (const el of box.querySelectorAll('.fmap:not([data-on])')) {
    el.dataset.on = '1';
    lazy(el, () => mapInto(el, [el.dataset.line], {sport: el.dataset.sport, still: true})
      .then(() => el.classList.add('ready')).catch(() => {}));   // on failure the route drawing stays
  }
}
function lazy(el, fn) {   // run fn when el scrolls into view
  const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, {rootMargin: '200px'});
  io.observe(el);
}

// ---------- charts ----------
// Stacked charts over one x axis (distance or time) with one crosshair + readout for all of them.
function chartStack(box, x, rows, {xfmt, onIndex} = {}) {
  const W = Math.max(300, box.clientWidth || 340), H = 92, padL = 34, padR = 6;
  const n = x.length; if (n < 2) { box.innerHTML = '<p class="muted">No samples recorded.</p>'; return; }
  const X = (i) => padL + (x[i] - x[0]) / (x[n - 1] - x[0] || 1) * (W - padL - padR);
  const readout = document.createElement('div'); readout.className = 'readout num'; readout.innerHTML = '<span>Touch a chart to read values</span>';
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
function dotChart(box, pts, {yfmt, invert = false, trend = null, current = null, best = null, height = 150}) {
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
  pts.forEach((p) => { g += `<circle class="dotp${p.id === best ? ' best' : ''}${p.id === current ? ' cur' : ''}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.id === current || p.id === best ? 6 : 4.5}"/>`; });
  box.innerHTML = `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Trend chart">${g}</svg></div>`;
}

// bars per week etc.
function barChart(box, items, {fmt, height = 120}) {
  const W = Math.max(300, box.clientWidth || 340), H = height, padB = 16, n = items.length;
  const max = Math.max(...items.map((i) => i.v), 1e-9), bw = W / n;
  let g = '';
  items.forEach((it, i) => {
    const h = it.v / max * (H - padB - 14);
    g += `<rect class="bar-r${it.cur ? ' cur' : ''}" x="${(i * bw + bw * .15).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw * .7).toFixed(1)}" height="${Math.max(h, it.v ? 2 : 0).toFixed(1)}" rx="2"><title>${esc(it.label)}: ${esc(fmt(it.v))}</title></rect>`;
    if (it.tick) g += `<text class="yl" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(it.tick)}</text>`;
  });
  g += `<text class="yl" x="2" y="10">${esc(fmt(max))}</text>`;
  box.innerHTML = `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bar chart">${g}</svg></div>`;
}

// ---------- progress charts (2026-10-09): one readout line above each chart, touch/hover to read ----------
const niceStep = (max, n = 4) => { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw || 1)), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
// Columns of stacked bars. cols: [{label, tick, segs: [{k, v}], partial}], keys: [{k, name, color}]
function periodBars(box, cols, {keys, fmt, yfmt = fmt, avg = null, avgLabel = 'avg', height = 180, hint = 'Touch a bar to read it'}) {
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
      g += last && hh > 4 ? `<path class="bar-seg k-${sg.k}${c.partial ? ' partial' : ''}" d="M${x.toFixed(1)},${(y).toFixed(1)}v${(-hh + 3).toFixed(1)}q0,-3 3,-3h${(w - 6).toFixed(1)}q3,0 3,3v${(hh - 3).toFixed(1)}z"/>`
                          : `<rect class="bar-seg k-${sg.k}${c.partial ? ' partial' : ''}" x="${x.toFixed(1)}" y="${(y - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}"/>`;
      y -= h;
    });
    if (c.tick) g += `<text class="yl" x="${(i >= n - 2 ? x + w : x + w / 2).toFixed(1)}" y="${H - 4}" text-anchor="${i >= n - 2 ? 'end' : 'middle'}">${esc(c.tick)}</text>`;
  });
  if (avg) g += `<line class="avgline" x1="${padL}" x2="${W - padR}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}"/>`;   // labelled in the legend below
  g += `<rect class="hl" x="0" y="${padT}" width="${bw.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" visibility="hidden"/>`;
  const legend = (keys.length > 1 ? keys.map((k) => `<span><i class="sw k-${k.k}"></i>${esc(k.name)}</span>`).join('') : '') + (avg ? `<span><i class="sw dash"></i>${esc(avgLabel)} ${esc(fmt(avg))}</span>` : '');
  box.innerHTML = `<div class="readout num"><span>${esc(hint)}</span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bar chart">${g}</svg></div>${legend ? `<div class="legend small">${legend}</div>` : ''}`;
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
  box.innerHTML = `<div class="readout num"><span>Touch the chart to read a month</span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly trend">${g}</svg></div>
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
  box.innerHTML = `<div class="readout num"><span>Touch the chart to read a day</span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Running total">${g}</svg></div>`;
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
  box.innerHTML = `<div class="readout num"><span>Touch a day to read it</span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Calories eaten and burned">${g}</svg>
      ${WH ? `<div class="wpanel-label small muted">Weight${weight.unit ? ' (' + esc(weight.unit) + ')' : ''}</div><svg class="wpanel" viewBox="0 0 ${W} ${WH}" width="${W}" height="${WH}" role="img" aria-label="Weight">${w}</svg>` : ''}</div>
    <div class="legend small"><span><i class="sw k-s1"></i>Eaten</span><span><i class="sw ln-sw k-run"></i>Burned</span><span><i class="sw dash"></i>Goal</span>${WH ? '<span><i class="sw ln-sw k-s3"></i>Weight trend</span><span><i class="sw wsw"></i>Weigh-ins</span>' : ''}</div>`;
  const svgs = $$('svg', box), hls = $$('.hl', box), ro = $('.readout', box), f = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), i = Math.floor(((e.clientX - r.left) / r.width * W - padL) / bw); if (i < 0 || i >= n) return;
    const c = cols[i]; hls.forEach((h) => { h.setAttribute('x', (padL + i * bw).toFixed(1)); h.setAttribute('visibility', 'visible'); });
    const def = c.eaten != null && c.burned ? c.burned - c.eaten : null;
    ro.innerHTML = `<span>${esc(c.label)}${c.partial ? ' (so far)' : ''}</span><span>Eaten <b>${f(c.eaten)}</b></span><span>Burned <b>${f(c.burned)}</b></span>${c.goal ? `<span>Goal <b>${f(c.goal)}</b></span>` : ''}${def != null && !c.partial ? `<span>${def >= 0 ? 'Deficit' : 'Surplus'} <b>${f(Math.abs(def))}</b></span>` : ''}${weight && (c.weight != null || c.trend != null) ? `<span>Weight <b>${c.weight != null ? esc(weight.fmt(c.weight)) : '–'}</b>${c.trend != null ? ` (trend ${esc(weight.fmt(c.trend))})` : ''}</span>` : ''}`;
  };
  svgs.forEach((sv) => { sv.addEventListener('pointerdown', show); sv.addEventListener('pointermove', show); });
}
// weigh-ins (dots) + smoothed trend (line). pts: [{label, tick, w, t}] one per day (w may be null)
function weightChart(box, pts, {fmt, axis = fmt, height = 170} = {}) {
  const W = Math.max(300, box.clientWidth || 340), H = height, padL = 40, padR = 6, padT = 8, padB = 18, n = pts.length;
  const vals = pts.flatMap((p) => [p.w, p.t]).filter((v) => v != null);
  if (pts.filter((p) => p.w != null).length < 2) { box.innerHTML = '<p class="muted small">Log your weight a few times and the chart appears.</p>'; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(.3, (hi - lo) * .15); lo -= pad; hi += pad;
  const X = (i) => padL + (n === 1 ? 0 : i / (n - 1)) * (W - padL - padR), Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  let g = '';
  for (const v of [hi - pad, (hi + lo) / 2, lo + pad]) g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(axis(v))}</text>`;
  pts.forEach((p, i) => { if (p.tick) g += `<text class="yl" x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(p.tick)}</text>`; });
  let d = '', pen = false; pts.forEach((p, i) => { if (p.t == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.t).toFixed(1)}`; pen = true; });
  g += pts.map((p, i) => (p.w == null ? '' : `<circle class="wdot" cx="${X(i).toFixed(1)}" cy="${Y(p.w).toFixed(1)}" r="3.5"/>`)).join('') + `<path class="ln k-s3" d="${d}"/>`;
  g += `<line class="xh" y1="${padT}" y2="${H - padB}" visibility="hidden"/>`;
  box.innerHTML = `<div class="readout num"><span>Touch to read a day</span></div><div class="chartbox"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weight and trend">${g}</svg></div>
    <div class="legend small"><span><i class="sw ln-sw k-s3"></i>Trend</span><span><i class="sw wsw"></i>Weigh-ins</span></div>`;
  const svgEl = $('svg', box), xh = $('.xh', box), ro = $('.readout', box);
  const show = (e) => {
    const r = svgEl.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width * W - padL) / (W - padL - padR) * (n - 1))));
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
    ro.innerHTML = `<span>${esc(pts[i].label)}</span><span>Weighed <b>${pts[i].w == null ? '–' : esc(fmt(pts[i].w))}</b></span><span>Trend <b>${pts[i].t == null ? '–' : esc(fmt(pts[i].t))}</b></span>`;
  };
  svgEl.addEventListener('pointerdown', show); svgEl.addEventListener('pointermove', show);
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

// ---------- login, first-run setup, invite links + start ----------
const BRAND = `<picture class="brand"><source srcset="/static/logo-dark.svg" media="(prefers-color-scheme: dark)"><img src="/static/logo.svg" alt="Lankki" width="186" height="34"></picture>`;
function showLogin(msg = '') {
  root.innerHTML = `<div class="login"><form novalidate>
    <div>${BRAND}<p>Your runs, rides, walks and food — private to you.</p></div>
    ${Native.on ? `<label>Server<input name="server" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" enterkeyhint="next" value="${esc(Native.base || Native.server)}"></label>` : ''}
    <label>Username<input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" enterkeyhint="go" required></label>
    <p class="err" role="alert">${esc(msg)}</p>
    <button class="primary" type="submit">Log in</button>
    <p class="small muted">New here? Ask the person who runs this Lankki for an invite link.</p></form></div>`;
  const f = $('form', root);
  $('input[name=login]', f).focus();
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
    try { await send({name: f.name.value, login: f.login.value.trim().toLowerCase(), password: f.password.value, ...phoneDefaults()}); history.replaceState(null, '', '/today'); await start(); }
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
  showNewAccount({title: 'Join Lankki', button: 'Create my account',
    intro: `${info.inviter ? esc(info.inviter) + ' invited you. ' : ''}Make your account — your activities and food log are private to you.`,
    send: (body) => api('/api/join', json('POST', {...body, token}))});
}
// "Join the beta" (public waitlist, only when the server has LANKKI_BETA_SIGNUP=1): no account yet, an admin invites them
async function showBeta() {
  let open = false;
  try { open = (await api('/api/beta')).open; } catch (x) { /* treat as closed */ }
  if (!open) { history.replaceState(null, '', '/'); return showLogin(); }
  root.innerHTML = `<div class="login"><form novalidate>
    <div>${BRAND}<h1>Join the beta</h1><p>Lankki puts your workouts and your food log in one private app. We're inviting a small group of testers — tell us a little about you and we'll send you an invite link.</p></div>
    <label>Your name<input name="name" autocomplete="name" maxlength="60" enterkeyhint="next" required></label>
    <label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="120" enterkeyhint="next" required></label>
    <label>Your phone<select name="phone" required><option value="">Choose…</option><option value="iphone">iPhone</option><option value="android">Android</option><option value="other">Something else</option></select></label>
    <label>Your watch or tracker (optional)<input name="watch" maxlength="60" placeholder="e.g. Garmin Forerunner, Apple Watch, none"></label>
    <label>Anything we should know? (optional)<textarea name="note" maxlength="300" rows="3"></textarea></label>
    <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="small muted">We use your email only to send your invite.</p>
    <p class="err" role="alert"></p>
    <button class="primary" type="submit">Ask to join</button>
    <p class="small muted">Already have an account? <a href="/" id="b-login">Log in</a></p></form></div>`;
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
        <p>You're on the list. We'll email your invite link to ${esc(f.email.value.trim())} when there's a spot.</p></div></div>`;
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
  showNewAccount({title: 'Welcome to Lankki', button: 'Create my account',
    intro: "This is a brand-new Lankki. Create your account first — you'll be its admin and can invite your people next.",
    send: (body) => api('/api/setup', json('POST', body))});
}
async function start() {
  await Native.ready;
  if (Native.on && !Native.token) return showLogin();
  try {
    App.me = await api('/api/me'); keep('/api/me', App.me);
    if (location.pathname === '/' || location.pathname === '' || location.pathname.startsWith('/join/') || location.pathname === '/beta') history.replaceState(null, '', '/today');
    render(); Q.flush(); netbar(); Native.autoSync();
  } catch (x) {
    if (x.status === 401) { forgetKept(); showWelcome(); return; }
    if (x.offline && kept('/api/me')) {   // no connection: open with what's saved on this phone
      App.me = kept('/api/me'); netState(true);
      if (location.pathname === '/' || location.pathname === '') history.replaceState(null, '', '/today');
      render(); return;
    }
    root.innerHTML = `<div class="boot"><p>${esc(x.message)}</p><button class="ghost" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', () => { root.innerHTML = '<p class="boot">Loading…</p>'; start(); });
  }
}
// (the iPhone app has its files built in: no service worker there)
if ('serviceWorker' in navigator && !window.Capacitor) navigator.serviceWorker.register('/sw.js').catch(() => {});
