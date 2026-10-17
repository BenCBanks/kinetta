// Exercise the actual native client with a stand-in device and server. No real HealthKit data or network.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const DAY = 864e5, now = Date.now();
const workout = {id: '12345678-test-workout', workoutType: 'running', startDate: new Date(now - 20 * DAY).toISOString(),
  endDate: new Date(now - 20 * DAY + 1800000).toISOString(), duration: 1800, distance: 5000, calories: 300};
function device(background = null, push = null) {
  const saved = new Map(), queries = [], sent = [], events = {};
  const ctx = {console, Date, Map, JSON, Error, Promise, setTimeout, clearTimeout,
    App: {me: {id: 1}, cache: new Map()}, route() {}, forgetKept() {}, invalidate() {}, toast() {}, render() {},
    document: {documentElement: {}, addEventListener(k, fn) { events[k] = fn; }},
    MutationObserver: class { observe() {} },
    json: (method, body) => ({method, body: JSON.stringify(body)}),
    window: {addEventListener(k, fn) { events[k] = fn; }, Capacitor: {isNativePlatform: () => true, Plugins: {
      Preferences: {get: async ({key}) => ({value: saved.get(key) ?? null}),
        set: async ({key, value}) => saved.set(key, value), remove: async ({key}) => saved.delete(key)},
      HealthPlugin: {isHealthAvailable: async () => ({available: true}), requestHealthPermissions: async () => {},
        queryWorkouts: async (q) => { queries.push(q); return ctx.query ? ctx.query(q) : {workouts: [workout]}; }},
      ...(push ? {KinettaPush: push} : {}),
      ...(background ? {KinettaHealthSync: background} : {}),
    }}},
    api: async (path, opts) => {
      if (path === '/api/login') return {token: 'new-login'};
      sent.push({who: ctx.App.me.id, ...JSON.parse(opts.body)});
      if (ctx.respond) return ctx.respond();
      return {added: 0, duplicates: 1, failed: 0, results: [{id: workout.id, result: 'duplicate'}]};
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app/static/native.js', 'utf8') + '\nglobalThis.client = Native;', ctx);
  return {ctx, n: ctx.client, saved, queries, sent, events};
}
(async () => {
  const registrations = [], pushEvents = {};
  const push = {status: async () => ({allowed: true, denied: false}),
    register: async () => ({token: 'ab'.repeat(32), environment: 'production'}),
    unregister: async () => registrations.push('unregister'), takePending: async () => ({url: ''}),
    addListener: (name, fn) => {pushEvents[name] = fn;}};
  const pushDevice = device(null, push);await pushDevice.n.ready;
  pushDevice.n.base = 'https://example.test';pushDevice.n.token = 'native-session';
  pushDevice.ctx.api = async (path, opts) => {registrations.push({path, method: opts.method, body: opts.body});return {ok: true};};
  await pushDevice.n.enablePush();
  assert.equal(registrations[0].path, '/api/push/ios');
  assert.equal(JSON.parse(registrations[0].body).environment, 'production');
  assert.equal((await pushDevice.n.pushStatus()).enabled, true);
  pushDevice.ctx.App.me = {id: 2};
  assert.equal((await pushDevice.n.pushStatus()).enabled, false, 'device consent belongs to the selected account');
  await pushDevice.n.disconnectPush();
  assert.equal(registrations[1].method, 'DELETE');
  assert.equal(pushDevice.saved.has('push.owner'), false);
  assert.equal(registrations[2], 'unregister');
  let finishRegister;
  push.register = () => new Promise(resolve => { finishRegister = resolve; });
  const pendingPush = pushDevice.n.enablePush();
  pushDevice.ctx.App.me = {id: 3};
  finishRegister({token: 'ab'.repeat(32), environment: 'production'});
  await assert.rejects(pendingPush, /account changed/);
  assert.equal(registrations.length, 3, 'late registration cannot bind a device to a different account');
  // Logging out and back in to the same account turns alerts back on by itself; Turn off on purpose is remembered.
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  push.register = async () => ({token: 'cd'.repeat(32), environment: 'production'});
  pushDevice.ctx.App.me = {id: 4};
  await pushDevice.n.enablePush();
  await pushDevice.n.disconnectPush({signedOut: true});
  assert.equal((await pushDevice.n.pushStatus()).enabled, false);
  pushDevice.n.syncPush(); await tick();
  assert.equal((await pushDevice.n.pushStatus()).enabled, true, 'same account after logging back in: alerts on again');
  await pushDevice.n.disconnectPush({forget: true});
  pushDevice.n.syncPush(); await tick();
  assert.equal((await pushDevice.n.pushStatus()).enabled, false, 'turned off on purpose stays off');
  pushDevice.ctx.App.me = {id: 5}; await pushDevice.n.enablePush(); await pushDevice.n.disconnectPush({signedOut: true});
  pushDevice.ctx.App.me = {id: 6}; pushDevice.n.syncPush(); await tick();
  assert.equal((await pushDevice.n.pushStatus()).enabled, false, 'a different account does not inherit alerts');
  // the app icon's number follows the unread count and clears at zero, without repeating the same number
  const badges = []; push.setBadge = async ({count}) => badges.push(count);
  pushDevice.n.setBadge(3); pushDevice.n.setBadge(3); pushDevice.n.setBadge(0);
  assert.deepEqual(badges, [3, 0]);
  const d = device(); await d.n.ready; d.n.base = 'https://example.test'; d.n.token = 'first';
  d.saved.set('health.on', '1');
  assert.equal(await d.n.healthOn(), false, 'legacy device consent is not inherited');
  await d.n.connectHealth();
  d.ctx.respond = () => ({added: 0, duplicates: 0, failed: 1, results: [{id: workout.id, result: 'failed'}]});
  await assert.rejects(d.n.syncHealth({days: 365}), /retried/);
  assert.equal(d.saved.has('health.last'), false, 'partial failure does not advance cursor');
  const failedFrom = +d.saved.get('health.retryFrom');
  assert.ok(failedFrom < now - 364 * DAY, 'failed history stays queued');
  assert.match((await d.n.healthStatus()).error, /retried/);
  d.ctx.respond = () => { throw new Error('Offline test'); };
  await assert.rejects(d.n.syncHealth(), /Offline/);
  assert.equal(+d.saved.get('health.retryFrom'), failedFrom);
  assert.match((await d.n.healthStatus()).error, /Offline/);
  delete d.ctx.respond; d.queries.length = 0;
  await d.n.syncHealth();
  assert.equal(Date.parse(d.queries[0].startDate), failedFrom, 'automatic retry includes failed year import');
  assert.ok(+d.saved.get('health.last') >= now);
  assert.equal(d.saved.has('health.retryFrom'), false);
  assert.equal((await d.n.healthStatus()).error, undefined);

  d.ctx.query = () => ({workouts: [workout], errors: {route: 'read failed'}});
  const cursor = d.saved.get('health.last'), uploads = d.sent.length;
  await assert.rejects(d.n.syncHealth(), /all workout details/);
  assert.equal(d.saved.get('health.last'), cursor);
  assert.equal(d.sent.length, uploads, 'partial plugin reads are retried before summary is stored');
  delete d.ctx.query;
  d.ctx.respond = () => ({added: 0, duplicates: 0, failed: 0, results: []});
  await assert.rejects(d.n.syncHealth(), /confirm every workout/);
  assert.equal(d.saved.get('health.last'), cursor);
  delete d.ctx.respond;

  await d.n.forget();
  assert.equal(d.n.healthProgress, '', 'sign-out clears visible progress as well as stored account status');
  assert.equal(d.saved.get('health.on'),'1','sign-out preserves the account opt-in');
  assert.equal(await d.n.healthOn(),false,'sign-out pauses all uploaders');
  d.ctx.App.me = {id: 2}; d.n.token = 'second';
  assert.equal(await d.n.syncHealth(), null, 'new account cannot inherit consent');
  await d.n.connectHealth(); d.n.base = 'https://other.example.test';
  assert.equal(await d.n.healthOn(), false, 'another server cannot inherit consent');

  d.n.base = 'https://example.test';
  let release, started;
  const entered = new Promise((r) => { started = r; });
  d.ctx.query = () => { started(); return new Promise((r) => { release = r; }); };
  const pending = d.n.syncHealth(); await entered;
  const statusBeforeStop=d.saved.get('health.status');const stopped = d.n.forget(); release({workouts: [workout]});
  await assert.rejects(pending, /account changed/); await stopped;
  assert.equal(d.n.token, null);
  assert.equal(d.saved.get('health.status'),statusBeforeStop,'cancelled sync cannot overwrite retained prior status');

  const calls = [], bg = device({
    connect: async (opts) => calls.push(['connect', opts]),
    disconnect: async () => calls.push(['disconnect']),
    retry: async () => calls.push(['retry']),
    status: async (opts) => ({enabled: true, pending: 2, owner: opts.owner}),
  });
  await bg.n.ready; bg.n.base = 'https://example.test'; bg.n.token = 'native-token';
  await bg.n.connectHealth();
  await bg.n.enableBackground();
  assert.equal(calls[0][0], 'connect');
  assert.equal(calls[0][1].server, 'https://example.test');
  assert.equal(calls[0][1].token, 'native-token');
  assert.equal(calls[0][1].owner, JSON.stringify(['https://example.test', 1]));
  assert.equal((await bg.n.backgroundStatus()).pending, 2);
  await bg.n.syncHealth();
  assert.ok(calls.some((x) => x[0] === 'retry'), 'foreground sync also wakes the durable native queue');
  bg.ctx.App.me = {id: 2};
  assert.equal(await bg.n.backgroundStatus(), null, 'native queue status is not inherited by another account');
  bg.ctx.App.me = {id: 1};
  await bg.n.forget();
  assert.equal(calls.at(-1)[0], 'disconnect', 'logout cancels native queue before clearing login');
  assert.equal(bg.n.token, null);

  const unavailable = device({connect: async () => { throw new Error('Capability missing'); },
    disconnect: async () => {}, retry: async () => {}, status: async () => { throw new Error('Locked'); }});
  await unavailable.n.ready; unavailable.n.base = 'https://example.test'; unavailable.n.token = 'token';
  await unavailable.n.connectHealth();
  await unavailable.n.syncHealth();
  assert.ok(unavailable.sent.length, 'background setup failure leaves foreground import available');
  assert.equal((await unavailable.n.backgroundStatus()).enabled, false);

  const cannotStop = device({disconnect: async () => { throw new Error('Unlock required'); }});
  await cannotStop.n.ready; cannotStop.n.base = 'https://example.test'; cannotStop.n.token = 'first';
  await assert.rejects(cannotStop.n.login('https://second.example.test', 'test', 'password'), /Unlock|unlock/);
  assert.equal(cannotStop.n.base, 'https://example.test', 'failed native disconnect prevents account/server replacement');
  assert.equal(cannotStop.n.token, 'first');
  const independent=device({disconnect:async()=>{throw Error('native stop failure');}});await independent.n.ready;
  independent.n.base='https://example.test';independent.n.token='token';await independent.n.connectHealth();
  independent.n.stopFoodHealth=async()=>{throw Error('food stop failure');};
  await independent.n.disconnectHealth();assert(!independent.saved.has('health.on'));assert(!independent.saved.has('health.owner'),'failed food stop cannot bypass workout key cleanup');
  const paused=device({disconnect:async()=>{}});await paused.n.ready;paused.n.base='https://example.test';paused.n.token='token';await paused.n.connectHealth();
  await paused.n.pauseHealth();assert.equal(paused.saved.get('health.on'),'1');assert.equal(await paused.n.healthOn(),false);paused.n.autoSync=()=>{};paused.n.resumeHealth();assert.equal(await paused.n.healthOn(),true,'failed account deletion resumes preserved setup');
  const refreshed = [], permissions = [];
  const rich = device({connect: async () => {}, disconnect: async () => {},
    requestPermissions: async () => permissions.push('explicit'),
    refresh: async (opts) => refreshed.push(opts)});
  await rich.n.ready; rich.n.base = 'https://example.test'; rich.n.token = 'rich';
  await rich.n.connectHealth();
  assert.equal(permissions.length, 1, 'additional Health permission is requested on explicit connect');
  rich.ctx.query = () => ({workouts: [{...workout, steps: 6000}]});
  rich.ctx.respond = () => ({added:0, duplicates:1, updated:1, failed:0, results:[{id:workout.id, result:'duplicate', details_updated:true}]});
  const details = await rich.n.syncHealth();
  assert.ok(details.updated > 0, 'detail updates survive legacy duplicate acknowledgements');
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].owner, JSON.stringify(['https://example.test', 1]));
  assert.equal(permissions.length, 1, 'automatic sync never prompts for permissions');
  assert.ok(rich.queries.every((q) => q.includeSteps && q.includeRoute && q.includeHeartRate));
  assert.equal(rich.sent[0].workouts[0].steps, 6000);
  rich.ctx.App.me = {id:2};
  assert.equal(await rich.n.syncHealth(), null);
  assert.equal(refreshed.length, 1, 'account without consent cannot refresh another account queue');
  // Returning from Done must not await background delivery or the first import.
  let permissionCalls = 0, legacyCalls = 0, settingsCalls = 0;
  const stuck = device({requestPermissions: async () => { permissionCalls++; },
    connect: () => new Promise(() => {}), retry: async () => {}, status: async () => ({enabled:false}), disconnect: async () => {}});
  await stuck.n.ready; stuck.n.base = 'https://example.test'; stuck.n.token = 'test-token';
  stuck.n.healthBackgroundTimeout = 5; stuck.n.lastAuto = Date.now();
  stuck.ctx.window.Capacitor.Plugins.HealthPlugin.requestHealthPermissions = async () => { legacyCalls++; };
  stuck.ctx.window.Capacitor.Plugins.HealthPlugin.openAppleHealthSettings = async () => { settingsCalls++; };
  const firstConnect = stuck.n.connectHealth(), secondConnect = stuck.n.connectHealth();
  assert.equal(firstConnect, secondConnect, 'double tap joins one connection');
  await Promise.race([firstConnect, new Promise((_, reject) => setTimeout(() => reject(new Error('Connect waited for background callback')), 100))]);
  assert.equal(permissionCalls, 1, 'one combined permission request');
  assert.equal(legacyCalls, 0, 'no second Health sheet from legacy plugin');
  assert.equal(await stuck.n.healthOn(), true);
  assert.equal(stuck.n.lastAuto, 0, 'pre-connect auto-sync cannot delay first import');
  await stuck.n.openHealthSettings(); assert.equal(settingsCalls, 1); assert.equal(permissionCalls, 1, 'manage access does not re-request permissions');
  stuck.n.healthTimeout = 5;
  stuck.ctx.query = () => new Promise(() => {});
  await assert.rejects(stuck.n.syncHealth(), /taking too long/);
  assert.equal(stuck.n.syncing, null, 'timed out sync releases busy state');
  assert.equal(stuck.saved.has('health.last'), false, 'timeout cannot advance cursor');
  delete stuck.ctx.query;
  await stuck.n.syncHealth(); assert.ok(stuck.saved.has('health.last'), 'retry remains usable');
  let finishPermissions;
  const slow = device({requestPermissions: () => new Promise(r => { finishPermissions = r; })});
  await slow.n.ready; slow.n.base = 'https://example.test'; slow.n.token = 'slow-token'; slow.n.healthPermissionTimeout = 5;
  await assert.rejects(slow.n.connectHealth(), /has not finished/);
  finishPermissions(); await Promise.resolve(); await Promise.resolve();
  assert.equal(await slow.n.healthOn(), false, 'late permission callback cannot enable a timed-out connection');
  let finishAvailability;
  const changing = device(); await changing.n.ready;
  changing.n.base = 'https://example.test'; changing.n.token = 'first-account';
  changing.ctx.window.Capacitor.Plugins.HealthPlugin.isHealthAvailable = () => new Promise(r => { finishAvailability = r; });
  const connecting = changing.n.connectHealth();
  await changing.n.disconnectHealth(); changing.ctx.App.me = {id:2};
  finishAvailability({available:true});
  await assert.rejects(connecting, /account changed/);
  assert.equal(changing.n.healthProgress, '', 'late availability cannot repopulate another account’s progress');
  console.log('native sync: consent, history retry, offline, incomplete reads/acks and in-flight logout passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
