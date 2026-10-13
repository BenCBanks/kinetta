// Exercise the actual native client with a stand-in device and server. No real HealthKit data or network.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const DAY = 864e5, now = Date.now();
const workout = {id: '12345678-test-workout', workoutType: 'running', startDate: new Date(now - 20 * DAY).toISOString(),
  endDate: new Date(now - 20 * DAY + 1800000).toISOString(), duration: 1800, distance: 5000, calories: 300};
function device() {
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
  for (const key of ['health.on', 'health.owner', 'health.last', 'health.retryFrom', 'health.status']) assert.equal(d.saved.has(key), false);
  d.ctx.App.me = {id: 2}; d.n.token = 'second';
  assert.equal(await d.n.syncHealth(), null, 'new account cannot inherit consent');
  await d.n.connectHealth(); d.n.base = 'https://other.example.test';
  assert.equal(await d.n.healthOn(), false, 'another server cannot inherit consent');

  d.n.base = 'https://example.test';
  let release, started;
  const entered = new Promise((r) => { started = r; });
  d.ctx.query = () => { started(); return new Promise((r) => { release = r; }); };
  const pending = d.n.syncHealth(); await entered;
  const stopped = d.n.forget(); release({workouts: [workout]});
  await assert.rejects(pending, /account changed/); await stopped;
  assert.equal(d.n.token, null);
  assert.equal(d.saved.has('health.status'), false, 'cancelled sync cannot restore stale status');
  console.log('native sync: consent, history retry, offline, incomplete reads/acks and in-flight logout passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
