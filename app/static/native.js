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
  // Bound device callbacks too: a missing HealthKit callback must not leave the UI asking forever.
  N.healthTimeout = 45000;
  N.healthPermissionTimeout = 120000;
  N.healthBackgroundTimeout = 10000;
  N.healthCall = (promise, message, ms = N.healthTimeout) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  N.healthProgress = '';
  const progress = (text) => { N.healthProgress = text; if (N.onHealthProgress) N.onHealthProgress(text); };
  // the server and login token live in the app's own settings (Capacitor Preferences), which iOS doesn't clear the way it
  // can clear a web view's storage when the phone runs low on space
  N.ready = on ? (async () => { N.base = (await get('server')) || ''; N.token = await get('token'); })().catch(() => {}) : Promise.resolve();
  // no ↑ ↓ ✓ bar above the keyboard (2026-10-13, Ben): every text box here has its own send / save button. Only the app can
  // hide it (@capacitor/keyboard); Safari and the Home Screen version always show it.
  if (on && P.Keyboard) P.Keyboard.setAccessoryBarVisible({isVisible: false}).catch(() => {});
  N.headers = () => (N.token ? {Authorization: 'Bearer ' + N.token} : {});
  N.address = (v) => { v = (v || '').trim().replace(/\/+$/, ''); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v; };
  N.login = async (server, login, password) => {
    if (typeof Track !== 'undefined' && App.me) await Track.leave();
    await N.disconnectPush();
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
  N.forget = async () => { if (typeof Track !== 'undefined' && App.me) await Track.leave(); if (on) { await N.disconnectPush({signedOut: true}); await N.disconnectHealth(); } N.token = null; if (on) await put('token', null); };

  // ---------- Native iPhone notifications ----------
  const push = P.KinettaPush;
  let pushTask = null, pushEnableTask = null, pushAccount = null, pushAt = 0;
  const pushOwner = () => App.me && JSON.stringify([N.base, App.me.id]);
  N.pushSupported = !!push;
  N.pushStatus = async () => {
    if (!push) return {supported: false};
    const status = await push.status();
    return {...status, supported: true, enabled: status.allowed && (await get('push.owner')) === pushOwner()};
  };
  N.registerPush = async (request = false) => {
    const account = pushOwner(), token = N.token;
    if (!push || !account || !token) throw new Error('Log in to the iPhone app to enable notifications.');
    const device = await N.healthCall(push.register({request}), 'Apple notification registration timed out.', request ? 120000 : 20000);
    if (account !== pushOwner() || token !== N.token) throw new Error('Notification registration stopped because the account changed.');
    await api('/api/push/ios', json('POST', device));
    if (account !== pushOwner() || token !== N.token) return;
    await put('push.owner', account); await put('push.wanted', account);
  };
  N.enablePush = () => pushEnableTask || (pushEnableTask = (async () => {
    if (pushTask) await pushTask;
    pushTask = N.registerPush(true);
    try { await pushTask; } finally { pushTask = null; }
  })().finally(() => { pushEnableTask = null; }));
  // forget: turned off on purpose. Logging out (or in again) keeps the wish, so the same account gets alerts back.
  N.disconnectPush = async ({signedOut = false, forget = false} = {}) => {
    if (!push) return;
    // Finish any registration before removing it, so a late response cannot re-register the old login.
    if (pushEnableTask) await pushEnableTask.catch(() => {});
    if (pushTask) await pushTask.catch(() => {});
    if (N.token) {
      try { await api('/api/push/ios', {method: 'DELETE'}); }
      catch (e) { if (!signedOut && e.status !== 401) throw e; }
    }
    await put('push.owner', null); if (forget) await put('push.wanted', null); pushAccount = null; pushAt = 0;
    await push.unregister();
  };
  const openPush = async () => {
    if (!push || !App.me) return;
    const account = pushOwner();
    const {url} = await push.takePending();
    if (account === pushOwner() && /^\/(activity(?:\/(?:friends\/)?\d+)?|me\/(friends|people)|food\/cook\/\d+)$/.test(url)) go(url);
  };
  N.syncPush = () => {
    if (!push || !App.me || !N.token) return;
    openPush().catch(() => {});
    const account = pushOwner();
    if (pushTask || (pushAccount === account && Date.now() - pushAt < 60000)) return;
    pushAccount = account; pushAt = Date.now();
    pushTask = (async () => {
      const st = await N.pushStatus();
      if (account === pushOwner() && st.allowed && (st.enabled || (await get('push.wanted')) === account)) await N.registerPush();
    })().catch(() => { pushAt = 0; }).finally(() => { pushTask = null; });
  };
  // the number on the app icon: the unread count, so reading them under the bell clears it
  let badgeShown = null;
  N.setBadge = (n) => { if (!push || !push.setBadge || n === badgeShown) return; badgeShown = n; push.setBadge({count: n}).catch(() => { badgeShown = null; }); };
  if (push) {
    push.addListener('notificationOpened', () => openPush().catch(() => {}));
    const back = () => { N.syncPush(); if (typeof Social !== 'undefined') { Social.at = 0; Social.refresh(); } };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) back(); });
  }

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
    try { return await N.healthCall(background.status({owner: owner()}), 'Health status is taking too long. Try again.', 10000); }
    catch (e) { return {enabled: false, error: 'Background sync status is unavailable. Open Kinetta to sync.'}; }
  };
  N.enableBackground = () => N.backgroundConnecting || (N.backgroundConnecting = (async () => {
    const account = owner(), token = N.token, base = N.base, version = generation;
    if (background && await N.healthOn()) {
      if (account !== owner() || token !== N.token || version !== generation) return;
      try { await N.healthCall(background.connect({server: base, owner: account, token}), 'Background sync did not respond. Foreground sync is still available.', N.healthBackgroundTimeout); }
      catch (e) { /* Native status retains the background error; keep foreground recovery available. */ }
    }
  })().finally(() => { N.backgroundConnecting = null; }));
  N.connectHealth = () => N.connecting || (N.connecting = (async () => {
    const account = owner(), version = generation;
    if (!(await N.healthCall(health.isHealthAvailable(), 'Apple Health did not respond. Please try again.')).available) throw new Error("Apple Health isn't available on this device.");
    if (!account || account !== owner() || version !== generation) throw new Error('Health connection stopped because the account changed.');
    progress('Choose what Kinetta can read in Apple Health, then tap Done.');
    // Older shells retain their original permission API; new builds use one combined native request.
    await N.healthCall(background?.requestPermissions ? background.requestPermissions() : health.requestHealthPermissions({permissions: ASK}),
      'Health setup has not finished. Close the Health permission screen, then try Connect again.', N.healthPermissionTimeout);
    if (!account || account !== owner() || version !== generation) throw new Error('Log in before connecting Apple Health.');
    await put('health.owner', account);
    if (account !== owner() || version !== generation) throw new Error('Health connection stopped because the account changed.');
    await put('health.on', '1');
    N.lastAuto = 0; // A pre-connection auto-sync must not suppress the first import for ten minutes.
    progress('Health sync is enabled. Your first import runs separately.');
    // Permission completion is independent of background delivery and a potentially large first import.
    N.enableBackground().catch(() => {});
  })().finally(() => { N.connecting = null; }));
  N.disconnectHealth = async () => {
    generation++; N.lastAuto = 0;
    progress(''); N.onHealthProgress = null;
    // Native uploads must stop before a login can replace the selected account/server.
    if (background) await background.disconnect();
    // Finish the current request before replacing its account/server; later batches stop at the guard below.
    if (N.syncing) await N.syncing.catch(() => {});
    for (const key of ['health.on', 'health.owner', 'health.last', 'health.retryFrom', 'health.status']) await put(key, null);
  };
  N.openHealthSettings = async () => {
    // Re-requesting decided read permissions cannot reopen Apple's switches.
    await N.healthCall(health.openAppleHealthSettings(), 'Settings did not open. Use Health → your profile → Apps → Kinetta.');
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
    progress('Reading recent workouts from Apple Health…');
    guard(); await put('health.retryFrom', from);
    try {
      if (background) {
        await N.enableBackground(); guard();
        if (background.refresh) await N.healthCall(background.refresh({owner: account, start: new Date(from).toISOString(), end: new Date(to).toISOString()}), 'Health detail refresh did not respond. Try Sync now again.');
        else await background.retry().catch(() => {});
        guard();
      }
      for (let a = from; a < to; a += 7 * DAY) {
        guard();
        progress(`Reading workouts: ${Math.min(Math.ceil((a - from) / DAY) + 7, Math.ceil((to - from) / DAY))} of ${Math.ceil((to - from) / DAY)} days…`);
        const r = await N.healthCall(health.queryWorkouts({startDate: new Date(a).toISOString(), endDate: new Date(Math.min(a + 7 * DAY, to)).toISOString(),
          includeHeartRate: true, includeRoute: true, includeSteps: true}), 'Apple Health is taking too long to read workouts. Keep your phone unlocked and try Sync now.');
        guard();
        if (r.errors && Object.keys(r.errors).length) throw new Error('Apple Health could not read all workout details. Unlock your phone and try again.');
        const ws = (r.workouts || []).filter((w) => w.id && w.duration > 0).map(shape);
        for (let i = 0; i < ws.length; i += 10) {
          guard();
          progress(`Importing workouts… ${sum.added} new, ${sum.duplicates} already here.`);
          const res = await N.healthCall(api('/api/health/workouts', json('POST', {workouts: ws.slice(i, i + 10)})), 'The workout upload took too long. Sync now will safely retry it.');
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
      progress(sum.added || sum.updated ? 'Import complete.' : 'No new readable workouts. If you expected some, check Kinetta’s access in Apple Health.');
      return sum;
    } catch (e) {
      if (version === generation && account === owner()) progress(e.message || 'Sync paused. Try again.');
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

route(/^\/me\/health$/, 'track', async () => go('/track/health',{replace:true}));
route(/^\/track\/health$/, 'track', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Apple Health</h1><div id="h-body">${skel(1)}</div>`;
  wireBack(el, '/track');
  const box = $('#h-body', el);
  if (!Native.on) {
    box.innerHTML = `<div class="card"><p>Apple Health works in the Kinetta iPhone app. In a browser, use <a href="/track/connections">Watch connections</a> instead.</p></div>`;
    return;
  }
  const [isOn, st, bg] = await Promise.all([Native.healthOn(), Native.healthStatus(), Native.backgroundStatus()]);
  const ai = !!App.me.health_ai_ok;
  box.innerHTML = `<div class="card">
      <h2>${isOn ? 'Sync enabled' : 'Bring in your workouts'}</h2>
      <p class="small muted">Choose only the Health categories you want to share. Apple keeps your read-permission choices private; enabling sync does not mean every category was allowed.</p>
      <p id="h-progress" class="health-progress" role="status">${esc(Native.healthProgress || '')}</p>
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
        <button class="ghost wide" id="h-settings">Manage Health access</button>
        <p class="small muted">In the Health app, tap your profile → Apps (or Apps and Services) → Kinetta to change individual switches. Settings may also list Health under Privacy & Security. Return here and tap Sync now.</p>
        <button class="ghost wide danger" id="h-off">Stop syncing</button>`
      : '<button class="primary wide" id="h-on">Connect Apple Health</button>'}</div>
    <div class="card"><h2>Kit, your AI coach</h2>
      <p class="small">Kit writes notes about your training using an AI service. It reads your Apple Health workouts only if you say yes. Until then Kit stays off for you.</p>
      <label class="check"><input type="checkbox" id="h-ai"${ai ? ' checked' : ''}> Let Kit read my Apple Health workouts</label></div>`;
  const err = $('.err', box);
  Native.onHealthProgress = (text) => { if (box.isConnected) $('#h-progress', box).textContent = text; };
  const busy = async (b, label, fn) => {
    const was = b.textContent; b.disabled = true; b.textContent = label; err.textContent = '';
    try { await fn(); } catch (x) { err.textContent = x.message || String(x); } finally { b.disabled = false; b.textContent = was; }
  };
  const done = (s) => { toast(s ? (s.added ? `${s.added} new workout${s.added > 1 ? 's' : ''} added` : s.updated ? `${s.updated} workout${s.updated > 1 ? 's' : ''} updated` : 'Up to date') : 'Nothing to sync'); render(); };
  const on = $('#h-on', box); if (on) on.onclick = () => busy(on, 'Opening Health…', async () => {
    await Native.connectHealth();
    if (!box.isConnected) return;
    toast('Health sync enabled. Importing your recent workouts…');
    render(); Native.autoSync();
  });
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
