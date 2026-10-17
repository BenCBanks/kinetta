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
  const progress = (text) => { N.healthProgress = text; if (N.onHealthProgress) N.onHealthProgress(text); N.onWorkoutStatus?.(); };
  // the server and login token live in the app's own settings (Capacitor Preferences), which iOS doesn't clear the way it
  // can clear a web view's storage when the phone runs low on space
  N.ready = on ? (async () => { N.base = (await get('server')) || ''; N.token = await get('token'); })().catch(() => {}) : Promise.resolve();
  // no ↑ ↓ ✓ bar above the keyboard (2026-10-13, Ben): every text box here has its own send / save button. Only the app can
  // hide it (@capacitor/keyboard); Safari and the Home Screen version always show it.
  if (on && P.Keyboard) P.Keyboard.setAccessoryBarVisible({isVisible: false}).catch(() => {});
  // A light tap under the finger (2026-10-16, Ben: Cheers should buzz). The iPhone app uses the Taptic Engine
  // (NativeHaptics.swift); Android browsers vibrate briefly; Safari has neither, so nothing happens there.
  N.haptic = (kind = 'light') => {
    try {
      if (on && P.KinettaHaptics) P.KinettaHaptics.tap({kind}).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [12, 40, 12] : 10);
    } catch (x) { /* never let a buzz break a tap */ }
  };
  N.headers = () => (N.token ? {Authorization: 'Bearer ' + N.token} : {});
  N.address = (v) => { v = (v || '').trim().replace(/\/+$/, ''); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v; };
  N.login = async (server, login, password) => {
    if (typeof Track !== 'undefined' && App.me) await Track.leave();
    await N.stopFoodEntry();
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
  N.forget = async () => { if (typeof Track !== 'undefined' && App.me) await Track.leave(); if (on) { await N.stopFoodEntry(); await N.disconnectPush({signedOut: true}); await N.disconnectHealth(); } N.token = null; if (on) await put('token', null); };

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
  // Resting Energy has its own explicit device/account opt-in; workout permissions remain unchanged.
  N.restingSupported = !!(on && background?.restingEnergy && background?.requestRestingPermissions);
  let restingGeneration = 0;
  N.restingOn = async () => N.restingSupported && !!owner() && (await get('health.resting.owner')) === owner();
  N.connectRestingEnergy = () => N.restingConnecting || (N.restingConnecting = (async () => {
    if (!N.restingSupported) throw new Error('Install the latest Kinetta iPhone build to connect Resting Energy.');
    const account=owner(),token=N.token,version=restingGeneration;
    if (!account) throw new Error('Sign in before connecting Resting Energy.');
    await N.healthCall(background.requestRestingPermissions(), 'Finish the Health permission screen, then try again.', N.healthPermissionTimeout);
    if(account!==owner() || token!==N.token || version!==restingGeneration) throw new Error('Resting energy setup stopped because the account changed.');
    // Completion means the permission screen closed, not that Apple disclosed read permission.
    await put('health.resting.owner',account);
    if(account!==owner() || token!==N.token || version!==restingGeneration) { await put('health.resting.owner',null);throw new Error('The account changed.'); }
    N.lastResting=0;
  })().finally(()=>{N.restingConnecting=null;}));
  N.stopRestingEnergy = async () => {
    restingGeneration++;N.lastResting=0;
    await put('health.resting.owner',null);
    if(N.restingSyncing) await N.restingSyncing.catch(()=>{});
  };
  N.syncRestingEnergy = () => N.restingSyncing || (N.restingSyncing = (async () => {
    if(!App.me || App.me.resting_source!=='apple_health' || !(await N.restingOn())) return null;
    const account=owner(),token=N.token,version=restingGeneration,zone=App.me.tz;
    const guard=()=>{if(account!==owner() || token!==N.token || version!==restingGeneration || App.me?.resting_source!=='apple_health' || zone!==App.me?.tz) throw new Error('Resting energy sync stopped because the account or settings changed.');};
    const data=await N.healthCall(background.restingEnergy({tz:zone}), 'Resting energy did not respond. Unlock your phone and try again.');
    guard();
    if(data?.tz!==zone || !Array.isArray(data.days) || !data.observed_at) throw new Error('Apple Health returned an incomplete resting-energy result.');
    const res=await N.healthCall(api('/api/health/resting',json('POST',data)), 'Resting energy could not be uploaded. Sync again when online.');
    guard();
    if(!res?.ok || res.received!==data.days.length || !Array.isArray(res.days) || !data.days.every(r=>res.days.includes(r.day))) throw new Error('Kinetta did not confirm the resting-energy sync. Try again.');
    invalidate('/api/food');invalidate('/api/health/resting');return {days:res.received};
  })().finally(()=>{N.restingSyncing=null;}));
  N.autoRestingEnergy = () => {
    if(!on || App.me?.resting_source!=='apple_health' || Date.now()-(N.lastResting||0)<600000) return;
    N.lastResting=Date.now();N.syncRestingEnergy().then(s=>{if(s?.days && location.pathname==='/food')render();}).catch(()=>{N.lastResting=0;});
  };
  N.anyHealthOn=async()=>N.on&&((await N.healthOn())||(await N.foodHealthOn('weight'))||(await N.foodHealthOn('nutrition'))||(await N.restingOn()));
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
    await N.stopFoodHealth();
    await N.stopRestingEnergy();
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
  })().finally(() => { N.syncing = null; N.onWorkoutStatus?.(); }));
  // ---------- Optional Health weight/nutrition, independent of workouts ----------
  const foodHealth = P.KinettaHealthFood;
  N.foodHealthSupported = !!foodHealth;
  let foodHealthGeneration=0,foodHealthTimer=null;
  const foodHealthKey=kind=>'health.food.'+kind;
  N.foodHealthOn=async kind=>!!owner()&&(await get(foodHealthKey(kind)))===owner();
  N.stopFoodHealth=async({clear=false,kind=null}={})=>{
    foodHealthGeneration++;clearTimeout(foodHealthTimer);N.lastFoodHealth=0;N.foodHealthResult=null;
    if(!on)return;
    if(foodHealth) await N.healthCall(foodHealth.stop({clear}), 'Health is still finishing a save. Unlock your phone and try again.');
    for(const k of kind?[kind]:['weight','nutrition']) await put(foodHealthKey(k),null);
  };
  N.foodHealthContext=()=>{
    const account=owner(),token=N.token,version=foodHealthGeneration;
    return {account,guard:()=>{if(!account||account!==owner()||token!==N.token||version!==foodHealthGeneration)throw new Error('Health sharing stopped because the account or settings changed.');}};
  };
  N.bindFoodHealth=async context=>{context.guard();await N.healthCall(foodHealth.bind({owner:context.account}),'Unlock your phone and try Health sharing again.');context.guard();};
  N.connectFoodHealth=async kind=>{
    if(!foodHealth||!['weight','nutrition'].includes(kind))throw new Error('Install the latest Kinetta iPhone build for Health weight and nutrition.');
    const context=N.foodHealthContext();await N.bindFoodHealth(context);
    await N.healthCall(kind==='weight'?foodHealth.requestWeightPermission({owner:context.account}):foodHealth.requestNutritionPermission({owner:context.account}), 'Finish the Health permission screen, then try again.',N.healthPermissionTimeout);context.guard();
    const state=await api('/api/health/'+(kind==='weight'?'weights':'nutrition')+'/preferences',json('PUT',{enabled:true,confirmed:true}));context.guard();
    await put(foodHealthKey(kind),context.account);context.guard();
    App.me[kind==='weight'?'health_weight_read':'health_nutrition_write']=state.enabled;
    if(kind==='weight')App.me.health_weight_ai_ok=state.health_weight_ai_ok;
    N.lastFoodHealth=0;if(N.foodHealthSyncing)await N.foodHealthSyncing.catch(()=>{});context.guard();return N.syncFoodHealth();
  };
  N.disableFoodHealth=async kind=>{
    const account=owner(),token=N.token;
    await N.stopFoodHealth({kind});
    if(account!==owner()||token!==N.token)throw new Error('The account changed.');
    try { await api('/api/health/'+(kind==='weight'?'weights':'nutrition')+'/preferences',json('PUT',{enabled:false})); }
    catch(e){e.message='Stopped on this iPhone. The server setting could not be updated; try Turn off again when online.';throw e;}
    if(account!==owner()||token!==N.token)return;
    App.me[kind==='weight'?'health_weight_read':'health_nutrition_write']=false;
    if(kind==='weight')App.me.health_weight_ai_ok=false;
  };
  N.syncFoodHealth=({weight:includeWeight=true}={})=>N.foodHealthSyncing||(N.foodHealthSyncing=(async()=>{
    if(!foodHealth||!App.me)return null;
    if(!(await N.foodHealthOn('weight'))&&!(await N.foodHealthOn('nutrition')))return null;
    const context=N.foodHealthContext();await N.bindFoodHealth(context);
    const result={owner:context.account,at:new Date().toISOString()};
    if(includeWeight&&await N.foodHealthOn('weight')){
      try{
        const state=await api('/api/health/weights');context.guard();
        if(state.enabled){
          let count=0,deletedCount=0,more=false;
          for(let i=0;i<20;i++){
            context.guard();const batch=await N.healthCall(foodHealth.readWeight({owner:context.account,epoch:state.epoch}),'Unlock your phone and try reading Health weight again.');context.guard();
            if(!batch?.batch||!batch.observed_at||!Array.isArray(batch.samples)||!Array.isArray(batch.deleted))throw new Error('Health returned an incomplete weight result.');
            const current=await api('/api/health/weights');context.guard();
            if(!current.enabled||current.epoch!==state.epoch||current.tz!==state.tz)throw new Error('Weight sharing changed. Sync again.');
            const receipt=await api('/api/health/weights',json('POST',{epoch:state.epoch,tz:state.tz,observed_at:batch.observed_at,samples:batch.samples,deleted:batch.deleted}));context.guard();
            if(!receipt?.ok||receipt.epoch!==state.epoch||receipt.received!==batch.samples.length||receipt.deleted!==batch.deleted.length||!batch.samples.every(s=>receipt.sample_ids?.some(id=>id.toLowerCase()===s.sample_id.toLowerCase()))||!batch.deleted.every(id=>receipt.deleted_ids?.some(received=>received.toLowerCase()===id.toLowerCase())))throw new Error('Kinetta did not confirm that weight batch. Sync again.');
            await N.healthCall(foodHealth.acknowledgeWeight({owner:context.account,batch:batch.batch}),'Weight upload was received; unlock your phone and sync again to confirm the cursor.');context.guard();
            count+=batch.samples.length;deletedCount+=batch.deleted.length;more=!!batch.more;if(!more)break;
          }
          if(count||deletedCount){const me=await api('/api/me');context.guard();refreshMe(me);}
          result.weight={count,pending:more};invalidate('/api/food',{health:false});
        }else result.weight={off:true};
      }catch(e){context.guard();result.weight={error:e.message||'Weight sync paused. Try again.'};}
    }
    if(await N.foodHealthOn('nutrition')){
      try{
        const state=await api('/api/health/nutrition');context.guard();
        if(state.enabled){
          const native=await N.healthCall(foodHealth.status({owner:context.account,epoch:state.epoch}),'Health nutrition status is unavailable.');context.guard();
          let cursor=native.cursor,count=0,more=false;
          if(!Number.isSafeInteger(cursor)||cursor<0||!Array.isArray(native.allowed)||!Array.isArray(native.blocked))throw new Error('Health returned an incomplete nutrition status.');
          for(let i=0;i<20;i++){
            const page=await api(`/api/health/nutrition/days?epoch=${encodeURIComponent(state.epoch)}&after=${cursor}&limit=50`);context.guard();
            if(page.epoch!==state.epoch||page.tz!==state.tz||!page.enabled||!Array.isArray(page.days)||!Number.isSafeInteger(page.next)||page.next<cursor)throw new Error('Nutrition sharing changed. Sync again.');
            const current=await api('/api/health/nutrition');context.guard();
            if(!current.enabled||current.epoch!==state.epoch||current.tz!==state.tz)throw new Error('Nutrition sharing changed. Sync again.');
            await N.healthCall(foodHealth.writeNutrition({owner:context.account,epoch:state.epoch,tz:state.tz,next:page.next,days:page.days}),'Nutrition is still waiting for Health. Unlock your phone and sync again.');context.guard();
            count+=page.days.length;more=!!page.more;
            if(more&&page.next<=cursor)throw new Error('Nutrition sync made no progress. Try again.');
            cursor=page.next;if(!more)break;
          }
          result.nutrition={count,pending:more,allowed:native.allowed,blocked:native.blocked};
        }else result.nutrition={off:true};
      }catch(e){context.guard();result.nutrition={error:e.message||'Nutrition sync paused. Try again.'};}
    }
    context.guard();N.foodHealthResult=result;return result;
  })().finally(()=>{N.foodHealthSyncing=null;}));
  N.autoFoodHealth=()=>{
    if(!on||!foodHealth||!App.me||Date.now()-(N.lastFoodHealth||0)<60000)return;
    N.lastFoodHealth=Date.now();N.syncFoodHealth().then(r=>{if(r?.weight?.error||r?.nutrition?.error||r?.weight?.pending||r?.nutrition?.pending)N.lastFoodHealth=0;}).catch(()=>{N.lastFoodHealth=0;});
  };
  N.queueNutritionSync=()=>{
    if(!on||!foodHealth||!App.me?.health_nutrition_write)return;
    const context=N.foodHealthContext();clearTimeout(foodHealthTimer);foodHealthTimer=setTimeout(async()=>{try{if(N.foodHealthSyncing)await N.foodHealthSyncing.catch(()=>{});context.guard();await N.syncFoodHealth({weight:false});}catch(e){/* Status/Retry retains failures; unsent days stay in the server journal. */}},1000);
  };
  // ---------- Native home-screen / Shortcuts food entry ----------
  const foodEntry=P.KinettaFoodEntry;
  let foodEntryGeneration=0,foodEntrySuspended=false;
  N.resumeFoodEntry=()=>{foodEntryGeneration++;foodEntrySuspended=false;if(N.foodEntryTask)N.foodEntryTask.finally(()=>N.autoFoodEntry()).catch(()=>{});};
  N.stopFoodEntry=async()=>{
    foodEntryGeneration++;foodEntrySuspended=true;
    if(foodEntry)await N.healthCall(foodEntry.stop(),'Food entry is still finishing. Unlock your phone and try again.');
  };
  N.consumeFoodEntries=()=>N.foodEntryTask||(N.foodEntryTask=(async()=>{
    if(!foodEntry||!App.me||foodEntrySuspended)return;
    const account=owner(),token=N.token,version=foodEntryGeneration,view=location.pathname+(location.search||'');
    const guard=()=>{if(!account||account!==owner()||token!==N.token||version!==foodEntryGeneration)throw Object.assign(new Error('Food entry stopped because the account changed.'),{stale:true});};
    await N.healthCall(foodEntry.bind({owner:account}),'Unlock your phone to open food chat.');guard();
    const pending=await N.healthCall(foodEntry.pending({owner:account}),'Food entry could not be read. Unlock and try again.');guard();
    if(!Array.isArray(pending.entries)||pending.entries.length>5)throw new Error('Food entry was incomplete. Try opening Kinetta again.');
    if(!pending.entries.length)return;
    if(location.pathname!=='/food/describe'){if(location.pathname+(location.search||'')!==view)return;go('/food/describe');}
    // A staged shortcut is not proof the app's older login is still valid.
    const me=await N.healthCall(api('/api/me'),'Food entry is waiting for your sign-in check. Open Kinetta again when connected.');guard();if(me.id!==App.me.id)throw new Error('Sign in again before opening this food draft.');refreshMe(me);
    for(const entry of pending.entries){
      guard();if(typeof FoodThread==='undefined')throw new Error('Install the latest Kinetta app to open this food draft.');
      if(location.pathname!=='/food/describe')return;guard();
      if(!FoodThread.receiveNative(entry))return;guard();
      await N.healthCall(foodEntry.acknowledge({owner:account,id:entry.id}),'The draft is saved. Open Kinetta again to finish acknowledging the shortcut.');guard();
    }
  })().finally(()=>{N.foodEntryTask=null;}));
  N.autoFoodEntry=()=>{const account=owner(),version=foodEntryGeneration;return N.consumeFoodEntries().catch(error=>{if(App.me&&account===owner()&&version===foodEntryGeneration&&!error.stale)toast(error.message||'Food entry is waiting. Open Kinetta again to retry.');});};
  if(foodEntry)foodEntry.addListener('foodEntryReady',()=>N.autoFoodEntry());
  // quietly, when the app opens and comes back to the front (at most every 10 minutes)
  N.autoSync = ({foreground=false}={}) => {
    N.autoRestingEnergy();
    N.autoFoodHealth();
    N.autoFoodEntry();
    if (!on || !App.me || Date.now() - (N.lastAuto || 0) < (foreground?15000:600000)) return;
    N.lastAuto = Date.now();
    N.syncHealth().then((s) => { if (s && (s.added || s.updated)) { toast(s.added ? `${s.added} new workout${s.added > 1 ? 's' : ''} from Apple Health` : 'Apple Health workout details updated'); render(); } }).catch(() => { N.lastAuto = 0; });
  };
  if (on) window.addEventListener('online', () => N.autoSync());
  if (on) document.addEventListener('visibilitychange', () => { if (!document.hidden) N.autoSync({foreground:true}); });
  return N;
})();

route(/^\/me\/health$/, 'track', async () => go('/track/health',{replace:true}));
route(/^\/track\/health$/, 'track', async (el) => {
  el.classList.add('health-page');
  el.innerHTML = `<div class="top">${backBtn('Connections')}</div><h1>Apple Health</h1><div id="h-body">${skel(1)}</div>`;
  wireBack(el, '/track/connections');
  const box = $('#h-body', el);
  if (!Native.on) {
    box.innerHTML = `<div class="card"><p>Apple Health works in the Kinetta iPhone app. In a browser, use <a href="/track/import">Upload files</a> to add activity recordings.</p></div>`;
    return;
  }
  const pageOwner=readOwner(),valid=()=>box.isConnected&&pageOwner===readOwner();
  const [isOn, st, bg] = await Promise.all([Native.healthOn(), Native.healthStatus(), Native.backgroundStatus()]);
  if(!valid())return;
  const ai = !!App.me.health_ai_ok && (!(App.me.health_weight_read||App.me.weight_health_derived)||!!App.me.health_weight_ai_ok);
  box.innerHTML = `<div id="h-food">${skel(1)}</div><div class="card">
      <h2>Workouts from Health</h2><p class="small">Optional. Import workouts with their recorded heart rate and routes. Your food and weight choices are separate.</p><details class="health-details"><summary>What’s read & how sync works</summary>
      <p class="small muted">Choose only the Health categories you want to share. Apple keeps your read-permission choices private; enabling sync does not mean every category was allowed.</p>
      <p id="h-progress" class="health-progress" role="status">${esc(Native.healthProgress || '')}</p>
      <p>Kinetta reads from Apple Health:</p>
      <ul class="reads"><li><b>Workouts</b>: type, time, distance, calories and steps</li><li><b>Heart rate</b> during workouts</li><li><b>Resting Energy</b>, only if you choose Apple Health resting calories in Nutrition</li><li><b>Routes</b> of outdoor workouts</li><li><b>Other recorded metrics</b>: elevation, running/cycling power and running dynamics, when available</li></ul>
      <p class="small muted">Kinetta can only import what the recording app saves to Health. Garmin Connect does not send GPS tracks to Apple Health; use Add the map on the workout to import its original file. Sync now also checks for details that arrived later.</p>
      <p class="small muted">${bg?.enabled ? 'iOS can sync new workouts in the background. Delivery timing depends on iOS; locked phones and force-quitting can delay it. Open Kinetta to catch up.' : 'Sync runs when you open Kinetta or return to it.'} Keep your phone unlocked until the first import finishes.</p>
      <p class="small muted">Anything that writes to Apple Health counts: Apple Watch, Garmin, Coros, Wahoo, Strava and more. Workout import only reads Health. Optional weight reading and nutrition writing have separate controls below.</p>
      <p class="small muted">Workouts go only to your Kinetta server${Native.base ? ` (${esc(Native.base.replace(/^https?:\/\//, ''))})` : ''} and are private to you.</p>
      </details>${isOn ? `<p class="small">${st ? `Last ${st.error ? 'attempt' : 'sync'} ${esc(when(st.at))}: ${st.added} new, ${st.duplicates} already here${st.updated ? `, ${st.updated} with updated details` : ''}${st.failed ? `, ${st.failed} couldn't be read` : ''}.` : 'Not synced yet.'}</p>` : ''}
      <p class="err" role="alert">${esc(st?.error || '')}</p>
      ${bg && (bg.enabled || bg.pending > 0) ? `<p class="small">Background: ${bg.pending ? `${bg.pending} workout${bg.pending > 1 ? 's' : ''} waiting` : 'No workouts waiting'}${bg.lastSuccess ? ` · last upload ${esc(when(bg.lastSuccess))}` : ''}.</p>` : ''}
      ${bg?.error ? `<p class="err" role="alert">${esc(bg.error)}</p>` : ''}
      ${isOn ? `<button class="ghost wide" id="h-sync">Sync now</button>
        <button class="ghost wide" id="h-year">Also bring in the past year</button>

        <p class="small muted">In the Health app, tap your profile → Apps (or Apps and Services) → Kinetta to change individual switches. Settings may also list Health under Privacy & Security. Return here and tap Sync now.</p>
        <button class="ghost wide danger" id="h-off">Disconnect all Health sync</button>`
      : '<button class="ghost wide" id="h-on">Import workouts from Health</button>'}</div>
    <div class="card"><h2>Kit, your AI coach</h2>
      <p class="small">Kit writes notes about your training using an AI service. It can read your Apple Health workouts, selected resting calories and imported weight only if you say yes. This sends those records to ${esc(App.me.ai_provider || 'the AI service configured on your server')}. Food-only answers do not read them. You can turn this off any time.</p>
      <label class="check"><input type="checkbox" id="h-ai"${ai ? ' checked' : ''}> Let Kit read my Apple Health data</label></div><a class="primary wide" href="/track/connections">Done</a>`;
  healthFoodControls($('#h-food',box),valid);
  const err = $('.err', box);
  Native.onHealthProgress = (text) => { if (box.isConnected) $('#h-progress', box).textContent = text; };
  const busy = async (b, label, fn) => {
    if(!valid())return;const was = b.textContent; b.disabled = true; b.textContent = label; err.textContent = '';
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
    if (!confirm('Disconnect all Health sync on this iPhone and turn off weight/nutrition sharing? Existing history stays. Change system permissions in the Health app.')) return;
    return busy(off, 'Stopping…', async () => { for(const kind of ['weights','nutrition']) { await api('/api/health/'+kind+'/preferences',json('PUT',{enabled:false})); if(!valid())return; }
      await Native.disconnectHealth();if(!valid())return;App.me.health_weight_read=false;App.me.health_nutrition_write=false;App.me.health_weight_ai_ok=false;render(); });
  };
  $('#h-ai', box).onchange = async (e) => {
    if(!valid())return;const v = e.target.checked;
    try { await api('/api/profile', json('PUT', {health_ai_ok: v,health_weight_ai_ok:v})); if(!valid())return;App.me.health_ai_ok = v;App.me.health_weight_ai_ok=v;toast(v ? 'Health data sharing with Kit enabled' : 'Health data sharing with Kit off'); }
    catch (x) { e.target.checked = !v; toast(x.message); }
  };
});

// The controls are optional; each category needs its own deliberate permission action.
async function healthFoodControls(box,parentValid=()=>true) {
  const account=readOwner(),valid=()=>box.isConnected&&account===readOwner()&&parentValid();
  const draw=async()=>{
    if(!valid())return;
    try{
      const [weight,nutrition,weightLocal,nutritionLocal]=await Promise.all([api('/api/health/weights'),api('/api/health/nutrition'),Native.foodHealthOn('weight'),Native.foodHealthOn('nutrition')]);
      if(!valid())return;
      App.me.health_weight_read=weight.enabled;App.me.health_nutrition_write=nutrition.enabled;App.me.health_weight_ai_ok=weight.health_weight_ai_ok;
      const ai=$('#h-ai',box.closest('#h-body'));if(ai)ai.checked=!!weight.health_ai_ok&&(!(weight.has_health_weight||weight.enabled)||!!weight.health_weight_ai_ok);
      const result=Native.foodHealthResult?.owner===JSON.stringify([Native.base,App.me.id])?Native.foodHealthResult:null;
      const card=(kind,state,local,title,copy)=>{
        const r=result?.[kind],enabled=state.enabled&&local;
        const status=!state.enabled?'Off':!local?'Set up on this iPhone':kind==='weight'?(state.last_sync?`Last read ${when(state.last_sync)}. An empty read may mean no accessible samples.`:'Waiting for the first read.'):(r?.blocked?.length?`${r.allowed.length} of 5 nutrient types allowed. Change individual switches in Health; other types stay private.`:r?.at||result?.at?`Last pass ${when(result.at)}. Shares recorded totals for allowed types.`:'Waiting for the first pass.');
        return `<section class="card health-food-card"><h2>${title} <span class="small muted">Optional</span></h2><p class="small">${copy}</p><p class="small muted" role="status">${esc(status)}${r?.pending?' More history is waiting; sync again to continue.':''}</p>${r?.error?`<p class="err" role="alert">${esc(r.error)}</p>`:''}
          ${Native.foodHealthSupported?`<button class="ghost wide" data-h-food="${kind}" data-h-action="${enabled?'sync':'connect'}">${enabled?'Sync now':state.enabled&&!local?'Set up on this iPhone':kind==='weight'?'Read weight from Health':'Share nutrition with Health'}</button>${state.enabled||local?`<button class="ghost wide" data-h-food="${kind}" data-h-action="off">Turn off ${kind==='weight'?'weight reading':'nutrition sharing'}</button>`:''}`:'<p class="small muted">Install the latest Kinetta iPhone build to set this up.</p>'}
          <p class="err h-food-error" role="alert"></p></section>`;
      };
      box.innerHTML=card('nutrition',nutrition,nutritionLocal,'Nutrition to Health','Share your logged daily calories, protein, carbs, fat and fiber, including edits and deletions. Missing values stay unknown. Only Kinetta’s samples for this account change.')+
        card('weight',weight,weightLocal,'Weight from Health','Bring smart-scale weight into your private log and weekly check-in. Manual weigh-ins take priority. Your calorie budget and resting-calorie choice stay unchanged.')+
        (Native.foodHealthSupported?'<button class="ghost wide" id="h-food-settings">Manage Health permissions</button>':'')+
        '<p class="small muted">These two categories catch up when you open or return to Kinetta. Unlock your phone and use Sync now if a read or write is waiting. Turning a category off keeps existing history; remove system access in Health → your profile → Apps → Kinetta.</p>';
      const settings=$('#h-food-settings',box);if(settings)settings.onclick=async()=>{if(!valid())return;try{await Native.openHealthSettings();}catch(e){if(valid())toast(e.message);}};
      $$('[data-h-food]',box).forEach(button=>button.onclick=async()=>{
        if(!valid())return;const kind=button.dataset.hFood,action=button.dataset.hAction,section=button.closest('section'),error=$('.h-food-error',section),was=button.textContent;
        $$('button',box).forEach(b=>b.disabled=true);button.textContent=action==='connect'?'Opening Health…':action==='off'?'Stopping…':'Syncing…';error.textContent='';
        try{
          if(action==='connect')await Native.connectFoodHealth(kind);
          else if(action==='off')await Native.disableFoodHealth(kind);
          else await Native.syncFoodHealth();
          if(!valid())return;Native.haptic('light');await draw();
        }catch(e){if(valid()){error.textContent=e.message||'Health sharing paused. Try again.';button.textContent=was;$$('button',box).forEach(b=>b.disabled=false);}}
      });
    }catch(e){if(valid()){box.innerHTML='<div class="card"><h2>Optional weight & nutrition</h2><p class="err" role="alert">Health sharing status could not be loaded.</p><button class="ghost wide">Try again</button></div>';$('button',box).onclick=draw;}}
  };await draw();
}
