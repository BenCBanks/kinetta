// Feed card taps (2026-10-16): only the photo and name open the profile; the rest of the card opens the activity.
// Real postCard/wireCardTaps from pages.js with stand-in helpers and events; no network, maps or devices.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app/static/pages.js', 'utf8');
const went = [], handlers = {};
const ctx = {App: {me: {login: 'zz_me', name: 'Me'}}, SPORT_NAMES: {run: 'Run'}, CHEER: {verb: 'Cheers'}, VIS_SHORT: {friends: 'Friends'},
  esc: (s) => String(s), svg: () => '<svg></svg>', avatar: (p) => `<span class="av">${p.name[0]}</span>`, sportMark: () => '<span class="sp"></span>',
  profileHref: (p) => `/people/${p.login}`, when: () => 'Today', activityMedia: () => '', headline: () => '', imp: () => false, rate: () => ({}),
  stat: () => '', U: {}, dur: () => '', go: (p) => went.push(p), getSelection: () => '', addEventListener() {}};
vm.createContext(ctx);
const social=fs.readFileSync('app/static/social.js','utf8');vm.runInContext(social.slice(social.indexOf('const REACTIONS='),social.indexOf('function wireReactionGroup')),ctx);
vm.runInContext(source.slice(source.indexOf('function postCard'), source.indexOf('// Cheers straight from a feed card')) +
  source.slice(source.indexOf('// A tap anywhere on a card'), source.indexOf('const backBtn')) + '\nglobalThis.card=postCard;globalThis.wire=wireCardTaps;globalThis.OWN=CARD_OWN;', ctx);

const html = ctx.card({id: 7, sport: 'run', name: 'Easy run', start_time: '2026-10-16T10:00:00Z', owner: {login: 'zz_friend', name: 'Sam'}, shares: {}}, {who: true});
const links = [...html.matchAll(/<a class="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
assert.deepEqual(links.filter(([, h]) => h.startsWith('/people/')).map(([c]) => c), ['post-av', 'post-name'], 'only the photo and the name link to the profile');
assert.match(html, /<article class="card post" data-href="\/activity\/friends\/7"/, 'the whole card knows its activity');
assert.doesNotMatch(html, /post-person/, 'no wide profile link across the header');

const article = {dataset: {href: '/activity/friends/7'}, classList: {add() {}, remove() {}}};
const box = {dataset: {}, contains: () => true, addEventListener: (t, f) => { handlers[t] = f; }};
ctx.wire(box); ctx.wire(box);
const tap = (own) => handlers.click({target: {closest: (s) => (s === 'article.post[data-href]' ? article : s === ctx.OWN ? (own ? {} : null) : null)}});
tap(false); assert.deepEqual(went, ['/activity/friends/7'], 'a plain part of the card opens the activity');
tap(true); assert.equal(went.length, 1, 'buttons and links inside the card keep their own job');
console.log('Card taps: profile only from photo/name, rest of the card opens the activity, inner controls untouched');
