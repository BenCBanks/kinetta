// Actual one-item removal helper: failures, duplicate taps, account changes and durable Undo retries.
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('app/static/food.js', 'utf8');
const code = source.slice(source.indexOf('async function removeFoodEntry('), source.indexOf('// ---------- edit an entry ----------'));
const entry = {id: 101, name: 'Test pasta', day: '2026-10-10', meal: 'dinner', amount: 230, unit: 'g', kcal: 460, protein_g: 23, source: 'dish', ref: {dish_id: 201}};
function make() {
  let owner = 'account-a', release;
  const calls = [], posts = [], toasts = [];
  const ctx = {readOwner: () => owner, newId: () => 'fictional-undo-id', MEAL_NAMES: {dinner: 'Dinner'},
    refresh() { calls.push('refresh'); }, toast(text, undo) { toasts.push({text, undo}); },
    api(url, opts) { calls.push({url, method: opts.method}); return new Promise((ok, bad) => { release = {ok, bad}; }); },
    async addEntries(rows) { posts.push(rows); if (posts.length === 1) throw new Error('Lost acknowledgement'); },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return {ctx, calls, posts, toasts, setOwner: x => owner = x, release: () => release};
}
(async () => {
  let c = make(), button = {disabled: false, isConnected: true, innerHTML: 'Remove'}, closed = 0;
  const first = c.ctx.removeFoodEntry(entry, {button, after: () => closed++});
  assert(button.disabled); assert.equal(await c.ctx.removeFoodEntry(entry, {button}), false);
  assert.equal(c.calls.length, 1, 'repeat tap cannot issue a second DELETE');
  c.release().ok({deleted: {...entry}}); assert.equal(await first, true); assert.equal(closed, 1);
  assert.equal(button.disabled, false); assert.equal(button.innerHTML, 'Remove');
  assert.equal(c.calls[0].url, '/api/food/entries/101');
  const undo = c.toasts.at(-1).undo;
  await Promise.all([undo(), undo()]); assert.equal(c.posts.length, 1, 'concurrent Undo cannot duplicate the request');
  await c.toasts.at(-1).undo(); assert.equal(c.posts.length, 2, 'failed restoration offers Retry Undo');
  assert.equal(c.posts[0][0].client_id, c.posts[1][0].client_id, 'lost acknowledgement retry has the identical id');
  for (const key of ['day', 'meal', 'amount', 'unit', 'kcal', 'source']) assert.equal(c.posts[1][0][key], entry[key]);
  assert.equal(c.posts[1][0].ref.dish_id, 201);
  await undo(); assert.equal(c.posts.length, 2, 'successful Undo is not repeated');
  c = make(); button = {disabled: false, isConnected: true, innerHTML: 'Remove'};
  const failure = c.ctx.removeFoodEntry(entry, {button, after: () => { throw new Error('must not close on failure'); }});
  c.release().bad(new Error('Offline')); assert.equal(await failure, false); assert.equal(button.disabled, false);
  assert(!c.calls.includes('refresh')); assert.equal(c.toasts.at(-1).text, 'Offline');
  c = make(); const stale = c.ctx.removeFoodEntry(entry); c.setOwner('account-b'); c.release().ok({deleted: {...entry}});
  assert.equal(await stale, false); assert.equal(c.toasts.length, 0); assert(!c.calls.includes('refresh'));
  c = make(); const removed = c.ctx.removeFoodEntry(entry); c.release().ok({deleted: {...entry}}); await removed;
  c.setOwner('account-b'); await c.toasts.at(-1).undo(); assert.equal(c.posts.length, 0, 'Undo never restores into another account');
  assert.equal(await c.ctx.removeFoodEntry({...entry, pending: true}), false, 'queued entries do not call a nonexistent saved-row endpoint');
  console.log('Food removal: one-item DELETE, double-tap guard, failure preservation, original-destination Undo, stable retry and account isolation passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
