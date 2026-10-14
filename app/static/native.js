// Kinetta phone app — the iPhone app's extra parts (2026-10-11). In a browser this file does nothing.
// The iPhone app (mobile/) shows these same pages from inside the app, so they aren't on the server's address: every
// request goes to the server the person chose at login, with their login token in a header instead of a cookie.
// Apple Health: Me > Apple Health asks for permission, then workouts (with heart rate and route) are sent to the server
// when the app opens and whenever it comes back to the front. The server stores each one once (api_health.py).
'use strict';
const Native = (() => {
  const C = window.Capacitor, on = !!(C && C.isNativePlatform && C.isNativePlatform());
  const P = on ? C.Plugins : {}, prefs = P.Preferences, health = P.HealthPlugin, background = P.KinettaHealthSync;
  const get = async (key) => (await prefs.get({key})).value;
  const put = (key, value) => (value == null ? prefs.remove({key}) : prefs.set({key, value: String(value)}));
  const N = {on, base: '', token: null, server: 'https://login.kinetta.app'};
  // the server and login token live in the app's own settings (Capacitor Preferences), which iOS doesn't clear the way it
  // can clear a web view's storage when the phone runs low on space
  N.ready = on ? (async () => { N.base = (await get('server')) || ''; N.token = await get('token'); })().catch(() => {}) : Promise.resolve();
  // no ↑ ↓ ✓ bar above the keyboard (2026-10-13, Ben): every text box here has its own send / save button. Only the app can
  // hide it (@capacitor/keyboard); Safari and the Home Screen version always show it.
  if (on && P.Keyboard) P.Keyboard.setAccessoryBarVisible({isVisible: false}).catch(() => {});
  N.headers = () => (N.token ? {Authorization: 'Bearer ' + N.token} : {});
  N.address = (v) => { v = (v || '').trim().replace(/\/+$/, ''); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v; };
  N.login = async (server, login, password) => {
    await N.disconnectHealth();
    N.base = N.address(server); if (!N.base) throw new Error("Enter your Kinetta server's address.");
    const r = await api('/api/login', json('POST', {login, password, app: true}));
    App.me = null; App.cache.clear(); forgetKept();
    N.token = r.token; await put('server', N.base); await put('token', N.token);
  };
  // photos (app.js pimg): fetched with the login token, kept in memory by address (an address never changes its picture)
  const pics = new Map();
  const fill = () => {
    for (const im of document.querySelectorAll('img[data-asrc]')) {
      const p = im.dataset.asrc; im.removeAttribute('data-asrc');
      let u = pics.get(p);
      if (!u) {
        u = fetch(N.base + p, {credentials: 'omit', headers: N.headers()}).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then((b) => URL.createObjectURL(b));
        pics.set(p, u); u.catch(() => pics.delete(p));
      }
      u.then((x) => { im.src = x; }, () => im.dispatchEvent(new Event('error')));
    }
  };
  if (on) new MutationObserver(fill).observe(document.documentElement, {childList: true, subtree: true});
  N.forget = async () => { if (on) await N.disconnectHealth(); N.token = null; if (on) await put('token', null); };

  // ---------- Apple Health ----------
  const ASK = ['READ_WORKOUTS', 'READ_HEART_RATE', 'READ_ROUTE', 'READ_DISTANCE', 'READ_ACTIVE_CALORIES', 'READ_STEPS'];
  const DAY = 864e5, FIRST_DAYS = 30, OVERLAP_DAYS = 3;
  // Consent belongs to this account on this server. Old device-wide opt-ins need a fresh connection.
  const owner = () => App.me && JSON.stringify([N.base, App.me.id]);
  let generation = 0;
  N.healthOn = async () => on && !!owner() && (await get('health.owner')) === owner() && (await get('health.on')) === '1';
  N.healthStatus = async () => { try { return await N.healthOn() ? JSON.parse(await get('health.status')) : null; } catch (e) { return null; } };
  N.backgroundStatus = async () => {
    if (!background || !(await N.healthOn())) return null;
    try { return await background.status({owner: owner()}); }
    catch (e) { return {enabled: false, error: 'Background sync status is unavailable. Open Kinetta to sync.'}; }
  };
  N.enableBackground = async () => {
    const account = owner(), token = N.token, base = N.base, version = generation;
    if (background && await N.healthOn()) {
      if (account !== owner() || token !== N.token || version !== generation) return;
      try { await background.connect({server: base, owner: account, token}); }
      catch (e) { /* Native status retains the background error; keep foreground recovery available. */ }
    }
  };
  N.connectHealth = async () => {
    const account = owner(), version = generation;
    if (!(await health.isHealthAvailable()).available) throw new Error("Apple Health isn't available on this device.");
    await health.requestHealthPermissions({permissions: ASK});   // iOS shows its own sheet once; later changes are in Settings
    if (background?.requestPermissions) await background.requestPermissions();
    if (!account || account !== owner() || version !== generation) throw new Error('Log in before connecting Apple Health.');
    await put('health.owner', owner());
    await put('health.on', '1');
    await N.enableBackground();
  };
  N.disconnectHealth = async () => {
    generation++; N.lastAuto = 0;
    // Native uploads must stop before a login can replace the selected account/server.
    if (background) await background.disconnect();
    // Finish the current request before replacing its account/server; later batches stop at the guard below.
    if (N.syncing) await N.syncing.catch(() => {});
    for (const key of ['health.on', 'health.owner', 'health.last', 'health.retryFrom', 'health.status']) await put(key, null);
  };
  N.openHealthSettings = async () => {
    if (background?.requestPermissions) await background.requestPermissions();
    await health.openAppleHealthSettings();
  };
  // The plugin's workout -> what POST /api/health/workouts takes
  const shape = (w) => ({id: w.id, type: w.workoutType || 'other', start: w.startDate, end: w.endDate, duration_s: w.duration,
    distance_m: w.distance || null, calories: w.calories || null, steps: w.steps ?? null, source: w.sourceName || null,
    route: (w.route || []).map((p) => ({t: p.timestamp, lat: p.lat, lng: p.lng, alt: p.alt ?? null})),
    heart_rate: (w.heartRate || []).filter((h) => h.bpm > 20 && h.bpm < 260).map((h) => ({t: h.timestamp, bpm: h.bpm}))});
  // Keep the entire attempted range until every workout is acknowledged. This also retries failed history imports.
  N.syncHealth = ({days} = {}) => N.syncing || (N.syncing = (async () => {
    if (!App.me || !(await N.healthOn())) return null;
    const account = owner(), token = N.token, version = generation;
    const guard = () => { if (version !== generation || account !== owner() || token !== N.token) throw new Error('Sync stopped because the account changed.'); };
    const last = +(await get('health.last')) || 0, retry = +(await get('health.retryFrom')) || 0, to = Date.now();
    const requested = days ? to - days * DAY : last ? last - OVERLAP_DAYS * DAY : to - FIRST_DAYS * DAY;
    const from = retry ? Math.min(retry, requested) : requested;
    const previous = await N.healthStatus();
    const sum = {added: 0, duplicates: 0, updated: 0, failed: 0};
    guard(); await put('health.retryFrom', from);
    try {
      if (background) {
        await N.enableBackground(); guard();
        if (background.refresh) await background.refresh({owner: account, start: new Date(from).toISOString(), end: new Date(to).toISOString()});
        else await background.retry().catch(() => {});
        guard();
      }
      for (let a = from; a < to; a += 7 * DAY) {
        guard();
        const r = await health.queryWorkouts({startDate: new Date(a).toISOString(), endDate: new Date(Math.min(a + 7 * DAY, to)).toISOString(),
          includeHeartRate: true, includeRoute: true, includeSteps: true});
        guard();
        if (r.errors && Object.keys(r.errors).length) throw new Error('Apple Health could not read all workout details. Unlock your phone and try again.');
        const ws = (r.workouts || []).filter((w) => w.id && w.duration > 0).map(shape);
        for (let i = 0; i < ws.length; i += 10) {
          guard();
          const res = await api('/api/health/workouts', json('POST', {workouts: ws.slice(i, i + 10)}));
          guard();
          // A missing or incomplete acknowledgement must never move the sync date forward.
          if (!res || !Array.isArray(res.results) || !ws.slice(i, i + 10).every((w) => res.results.some((x) => x.id === w.id && ['added', 'duplicate', 'failed'].includes(x.result))))
            throw new Error('Kinetta did not confirm every workout. Please try again.');
          for (const k in sum) sum[k] += res[k] || 0;
          if (res.results.some((x) => x.result === 'failed')) sum.failed = Math.max(1, sum.failed);
        }
      }
      guard();
      if (sum.failed) throw new Error(`${sum.failed} workout${sum.failed > 1 ? 's' : ''} could not be imported. They will be retried on the next sync.`);
      await put('health.last', to);
      await put('health.retryFrom', null);
      await put('health.status', JSON.stringify({...sum, at: new Date(to).toISOString(), last_success_at: new Date(to).toISOString()}));
      return sum;
    } catch (e) {
      if (version === generation && account === owner() && token === N.token)
        await put('health.status', JSON.stringify({...sum, at: new Date(to).toISOString(), last_success_at: previous?.last_success_at || null, error: e.message || 'Sync failed. Please try again.'}));
      throw e;
    } finally {
      if ((sum.added || sum.updated) && account === owner() && token === N.token) invalidate('/api/');
    }
  })().finally(() => { N.syncing = null; }));
  // quietly, when the app opens and comes back to the front (at most every 10 minutes)
  N.autoSync = () => {
    if (!on || !App.me || Date.now() - (N.lastAuto || 0) < 600000) return;
    N.lastAuto = Date.now();
    N.syncHealth().then((s) => { if (s && (s.added || s.updated)) { toast(s.added ? `${s.added} new workout${s.added > 1 ? 's' : ''} from Apple Health` : 'Apple Health workout details updated'); render(); } }).catch(() => { N.lastAuto = 0; });
  };
  if (on) window.addEventListener('online', () => N.autoSync());
  if (on) document.addEventListener('visibilitychange', () => { if (!document.hidden) N.autoSync(); });
  return N;
})();

route(/^\/me\/health$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Apple Health</h1><div id="h-body">${skel(1)}</div>`;
  wireBack(el, '/me');
  const box = $('#h-body', el);
  if (!Native.on) {
    box.innerHTML = `<div class="card"><p>Apple Health works in the Kinetta iPhone app. In a browser, use <a href="/me/connections">Watch connections</a> instead.</p></div>`;
    return;
  }
  const [isOn, st, bg] = await Promise.all([Native.healthOn(), Native.healthStatus(), Native.backgroundStatus()]);
  const ai = !!App.me.health_ai_ok;
  box.innerHTML = `<div class="card">
      <h2>${isOn ? 'Connected' : 'Bring in your workouts'}</h2>
      <p>Kinetta reads from Apple Health:</p>
      <ul class="reads"><li><b>Workouts</b>: type, time, distance, calories and steps</li><li><b>Heart rate</b> during workouts</li><li><b>Routes</b> of outdoor workouts</li><li><b>Other recorded metrics</b>: elevation, running/cycling power and running dynamics, when available</li></ul>
      <p class="small muted">Kinetta can only import what the recording app saves to Health. Garmin Connect does not send GPS tracks to Apple Health; use Watch connections or import the original file for those maps. Sync now also checks for details that arrived later.</p>
      <p class="small muted">${bg?.enabled ? 'iOS can sync new workouts in the background. Delivery timing depends on iOS; locked phones and force-quitting can delay it. Open Kinetta to catch up.' : 'Sync runs when you open Kinetta or return to it.'} Keep your phone unlocked until the first import finishes.</p>
      <p class="small muted">Anything that writes to Apple Health counts: Apple Watch, Garmin, Coros, Wahoo, Strava and more. Kinetta only reads; it never changes your Health data.</p>
      <p class="small muted">Workouts go only to your Kinetta server${Native.base ? ` (${esc(Native.base.replace(/^https?:\/\//, ''))})` : ''} and are private to you.</p>
      ${isOn ? `<p class="small">${st ? `Last ${st.error ? 'attempt' : 'sync'} ${esc(when(st.at))}: ${st.added} new, ${st.duplicates} already here${st.updated ? `, ${st.updated} with updated details` : ''}${st.failed ? `, ${st.failed} couldn't be read` : ''}.` : 'Not synced yet.'}</p>` : ''}
      <p class="err" role="alert">${esc(st?.error || '')}</p>
      ${bg && (bg.enabled || bg.pending > 0) ? `<p class="small">Background: ${bg.pending ? `${bg.pending} workout${bg.pending > 1 ? 's' : ''} waiting` : 'No workouts waiting'}${bg.lastSuccess ? ` · last upload ${esc(when(bg.lastSuccess))}` : ''}.</p>` : ''}
      ${bg?.error ? `<p class="err" role="alert">${esc(bg.error)}</p>` : ''}
      ${isOn ? `<button class="primary wide" id="h-sync">Sync now</button>
        <button class="ghost wide" id="h-year">Also bring in the past year</button>
        <button class="ghost wide" id="h-settings">Change what Kinetta can read</button>
        <button class="ghost wide danger" id="h-off">Stop syncing</button>`
      : '<button class="primary wide" id="h-on">Connect Apple Health</button>'}</div>
    <div class="card"><h2>Kit, your AI coach</h2>
      <p class="small">Kit writes notes about your training using an AI service. It reads your Apple Health workouts only if you say yes. Until then Kit stays off for you.</p>
      <label class="check"><input type="checkbox" id="h-ai"${ai ? ' checked' : ''}> Let Kit read my Apple Health workouts</label></div>`;
  const err = $('.err', box);
  const busy = async (b, label, fn) => {
    const was = b.textContent; b.disabled = true; b.textContent = label; err.textContent = '';
    try { await fn(); } catch (x) { err.textContent = x.message || String(x); } finally { b.disabled = false; b.textContent = was; }
  };
  const done = (s) => { toast(s ? (s.added ? `${s.added} new workout${s.added > 1 ? 's' : ''} added` : s.updated ? `${s.updated} workout${s.updated > 1 ? 's' : ''} updated` : 'Up to date') : 'Nothing to sync'); render(); };
  const on = $('#h-on', box); if (on) on.onclick = () => busy(on, 'Asking…', async () => { await Native.connectHealth(); done(await Native.syncHealth()); });
  const sy = $('#h-sync', box); if (sy) sy.onclick = () => busy(sy, 'Syncing…', async () => done(await Native.syncHealth()));
  const yr = $('#h-year', box); if (yr) yr.onclick = () => busy(yr, 'Bringing in the past year…', async () => done(await Native.syncHealth({days: 365})));
  const se = $('#h-settings', box); if (se) se.onclick = () => busy(se, 'Opening…', () => Native.openHealthSettings());
  const off = $('#h-off', box); if (off) off.onclick = () => {
    if (!confirm('Stop syncing? Workouts already here stay. To remove Kinetta\'s access completely, use the Health app\'s settings.')) return;
    return busy(off, 'Stopping…', async () => { await Native.disconnectHealth(); render(); });
  };
  $('#h-ai', box).onchange = async (e) => {
    const v = e.target.checked;
    try { await api('/api/profile', json('PUT', {health_ai_ok: v})); App.me.health_ai_ok = v; toast(v ? 'Kit can read your Apple Health workouts' : 'Kit won\'t read your Apple Health workouts'); }
    catch (x) { e.target.checked = !v; toast(x.message); }
  };
});
