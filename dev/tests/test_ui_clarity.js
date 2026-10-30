// UI clarity pass (2026-10-18): Track shortcuts, the first-food welcome and Nutrition's More menu, with fictional data.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Track: the one-tap shortcuts point at Run, Ride, Walk, Hike and Lifting in the real choice list.
{
 const track=fs.readFileSync('app/static/track.js','utf8'),c={};vm.createContext(c);
 vm.runInContext(track.match(/const OUTDOOR = \[.*?\];/)[0]+'\n'+track.match(/const TRACK_QUICK = .*?;/)[0]+'\nglobalThis.out={OUTDOOR,TRACK_QUICK};',c);
 const {OUTDOOR,TRACK_QUICK}=c.out,labels=[...OUTDOOR.map(o=>o[1]),'Lifting'];
 assert.equal(JSON.stringify(TRACK_QUICK.map(i=>labels[i])),JSON.stringify(['Run','Ride','Walk','Hike','Lifting']));
 assert.match(track,/pickSheet\('Activity',pickRows\(choices\.map/,'the full list stays available in More');
 console.log('Track shortcuts: Run, Ride, Walk, Hike, Lifting map to real choices; full list kept PASS');
}
// Nutrition: one Add food entry above the meals; optional goals do not duplicate it.
{
 const food=fs.readFileSync('app/static/food.js','utf8');
 const c={svg:()=>''};vm.createContext(c);vm.runInContext(food.slice(food.indexOf('function firstFood('),food.indexOf('function drawDay(')),c);
 const box={innerHTML:''};c.firstFood(box,'2026-10-18');
 assert.match(box.innerHTML,/href="\/food\/setup"/);assert.match(box.innerHTML,/optional/);
 assert.doesNotMatch(box.innerHTML,/Log something you ate|ff-log|ff-dish/,'the primary Add food entry is outside the summary');
 // Only with no history, no entries and no goal; copy shortcuts only with history.
 assert.match(food,/const fresh = !D\.has_history && !D\.entries\.length && goal == null;/);
 assert.match(food,/D\.has_history \? `<div class="food-copy-action"/,'One quiet Copy yesterday button is available with food history');
 assert.doesNotMatch(food,/data-usual-meal=/,'Usuals stays in Add food');
 assert.doesNotMatch(food,/data-yesterday-meal=/,'Empty meals do not repeat the copy action');
 assert.equal((food.match(/id="fd-copy"/g)||[]).length,1,'Only one copy button is rendered');
 assert.doesNotMatch(food,/Reminders · optional|edit or create/,'no run-on link line');
 assert.match(food,/\['reminders', 'Meal reminders'/,'reminders moved into More');
 console.log('Nutrition: optional goals, one entry action, history-bound copy shortcut and retained reminder destination PASS');
}
// Food chat: a plain name for the search tool.
assert.match(fs.readFileSync('app/static/thread.js','utf8'),/tile\('id="thread-search"','search','Search'\)/);
console.log('Food chat: Search tool label PASS');
// Food chat (2026-10-18, simplified): one bar with +, text and send; every other way to add food sits in the + menu.
{
 const thread=fs.readFileSync('app/static/thread.js','utf8'),markup=thread.slice(thread.indexOf('el.innerHTML=`<header class="thread-heading">'),thread.indexOf('// + opens the tools'));
 const menu=markup.slice(markup.indexOf('id="thread-menu"'),markup.indexOf('class="thread-compose-row"'));
 for(const tool of ['data-tool="snap"','data-tool="library"','data-tool="scan"','id="thread-search"','id="thread-usuals"','id="thread-recipes"','id="thread-manual-add"'])
  assert(menu.includes(tool),tool+' lives in the + menu');
 const bar=markup.slice(markup.indexOf('class="thread-compose-row"'),markup.indexOf('id="thread-status"'));
 assert.match(bar,/id="thread-plus"[^>]*aria-expanded="false"/);assert.match(bar,/id="thread-text"/);assert.match(bar,/id="thread-send" aria-label="Send"/);
 assert.match(markup,/id="thread-settings" aria-label="Food chat settings"/);
 assert.match(thread,/data-more aria-label="More options for this message"/);assert.match(thread,/class="thread-food" data-entry=/,'tap a logged food to edit it');
 console.log('Food chat: one bar (+, text, send), every tool in the + menu, labelled ⋯ controls, tap-to-edit foods PASS');
}
// Profile-first Me keeps identity and private information visibly distinct (#353).
{
 const pages=fs.readFileSync('app/static/pages.js','utf8');
 const profile=fs.readFileSync('app/static/profile.js','utf8');
 assert.match(pages,/MeCard\.header\(me\)/);assert.match(pages,/Your dashboard/);assert.match(profile,/Only you below this line/);assert.match(profile,/Hi, \$\{/);
 assert.match(profile,/data-card-edit/);assert.match(profile,/aria-label="Share your profile"/);assert.match(profile,/Totals include all your workouts; private ones never show details/);
 assert.doesNotMatch(pages,/me-edit-profile|>View profile</,'Me has no large View/Edit profile buttons');
 assert.doesNotMatch(pages,/ME_SHORTCUTS|whoseSeg|wireWhose|Latest activity|Friends recently/,'retired home/feed components have no live callers');
 assert.match(pages,/href="\/me\/activities"/,'the complete private history is reachable');
 assert.match(pages,/q.get\('view'\)==='mine'/,'existing history links retain a redirect');
 console.log('Me: friends-view card with Edit/Share, private dashboard below the line, separate complete history, no duplicated selectors/shortcut grid PASS');
}
// Speed check (2026-10-18): reachable from Profile & settings, read-only (GET requests only), nothing stored.
{
 const pages=fs.readFileSync('app/static/pages.js','utf8'),part=pages.slice(pages.indexOf('// ---------- Speed check'));
 assert.match(pages,/href="\/me\/speed"/);assert.match(part,/route\(\/\^\\\/me\\\/speed\$\//);
 assert.doesNotMatch(part,/json\('(POST|PUT|DELETE|PATCH)'|method:\s*'(POST|PUT|DELETE|PATCH)'|store\.set|localStorage/,'speed check only reads');
 console.log('Speed check: linked from settings, read-only, stores nothing PASS');
}
