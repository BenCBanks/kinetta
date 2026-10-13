// Actual frontend state helpers with stand-in storage/network. No server, personal data or AI calls.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const saved = new Map();
function client() {
  const listeners = [], ctx = {
    document: {querySelector: () => null, addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn); }},
    localStorage: {getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k)},
    location: {origin: 'https://example.test'}, Native: {base: '', token: null, headers: () => ({})},
    navigator: {onLine: true}, addEventListener() {}, setInterval() {}, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app/static/app.js', 'utf8') +
    '\nglobalThis.ui = {App, load, prefetch, invalidate, coachKey, coachVersion, coachMessage, showCoach};', ctx);
  ctx.ui.App.me = {id: 1, login: 'zz_test_ui'};
  return {ctx, ...ctx.ui, listeners};
}
(async () => {
  let c = client();
  assert.equal(c.coachVersion({change: 'demo', effect: 'demo benefit'}), c.coachVersion({effect: 'demo benefit', change: 'demo'}), 'JSON field order does not change note identity');
  const key = c.coachKey('activity:10'), version = c.coachVersion('A made-up note.');
  const body = {hidden: false}, card = {dataset: {coachKey: key, coachVersion: version}, querySelector: () => body};
  const button = {closest: () => card, setAttribute(k, v) { this[k] = v; }};
  const target = {closest: selector => selector === '[data-coach-toggle]' ? button : null};
  for (const listener of c.listeners) listener({target});
  assert.equal(body.hidden, true); assert.equal(button['aria-expanded'], 'false'); assert.equal(button.textContent, 'Show');
  c = client(); // reload retains this message's visibility
  const html = c.coachMessage('activity:10', 'A made-up note.', 'Coach', '<p>Demo</p>');
  assert.match(html, /aria-expanded="false"/); assert.match(html, /class="coach-body"[^>]* hidden/);
  assert.doesNotMatch(c.coachMessage('activity:10', 'A changed note.', 'Coach', '<p>New</p>'), /aria-expanded="false"/);
  c.App.me.id = 2;
  assert.match(c.coachMessage('activity:10', 'A made-up note.', 'Coach', '<p>Demo</p>'), /aria-expanded="true"/);
  c.App.me.id = 1; c.ctx.Native.base = 'https://other.example.test';
  assert.match(c.coachMessage('activity:10', 'A made-up note.', 'Coach', '<p>Demo</p>'), /aria-expanded="true"/);
  c.ctx.Native.base = ''; c.showCoach('activity:10');
  assert.match(c.coachMessage('activity:10', 'A made-up note.', 'Coach', '<p>Demo</p>'), /aria-expanded="true"/);
  assert.ok([...saved.values()].every(v => !v.includes('made-up')), 'storage holds fingerprints, not another copy of coach text');

  let calls = 0, release;
  c.ctx.api = () => { calls++; return new Promise(r => { release = r; }); };
  c.prefetch('/api/ui-test');
  let rendered;
  const loading = c.load('/api/ui-test', data => { rendered = data; });
  assert.equal(calls, 1, 'prefetch and page load share one GET');
  release({value: 42}); await loading; assert.equal(rendered.value, 42);
  c.invalidate('/api/ui-test');
  c.ctx.api = async () => { calls++; throw new Error('Request failed'); };
  await assert.rejects(c.load('/api/ui-test', () => {}), /Request failed/);
  c.ctx.api = async () => { calls++; return {value: 43}; };
  await c.load('/api/ui-test', data => { rendered = data; });
  assert.equal(rendered.value, 43, 'failed requests can retry');
  c.invalidate('/api/ui-test');
  c.ctx.api = () => new Promise(r => { release = r; });
  const oldAccount = c.load('/api/ui-test', () => { throw new Error('stale account rendered'); });
  c.App.me.id = 3; release({value: 'previous account'}); await oldAccount;
  assert.equal(c.App.cache.has('/api/ui-test'), false, 'old account response cannot refill cache');
  console.log('UI state: hide/reload/new note/account isolation, shared GET, failure retry and stale-account response passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
