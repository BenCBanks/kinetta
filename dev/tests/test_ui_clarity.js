// UI clarity pass (2026-10-18): Track shortcuts, the first-food welcome and Nutrition's More menu, with fictional data.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Track: the one-tap shortcuts point at Run, Ride, Walk, Hike and Lifting in the real choice list.
{
 const track=fs.readFileSync('app/static/track.js','utf8'),c={};vm.createContext(c);
 vm.runInContext(track.match(/const OUTDOOR = \[.*?\];/)[0]+'\n'+track.match(/const TRACK_QUICK = .*?;/)[0]+'\nglobalThis.out={OUTDOOR,TRACK_QUICK};',c);
 const {OUTDOOR,TRACK_QUICK}=c.out,labels=[...OUTDOOR.map(o=>o[1]),'Lifting'];
 assert.equal(JSON.stringify(TRACK_QUICK.map(i=>labels[i])),JSON.stringify(['Run','Ride','Walk','Hike','Lifting']));
 assert.match(track,/<label>All activities<select id="track-kind">/,'the full list stays available');
 console.log('Track shortcuts: Run, Ride, Walk, Hike, Lifting map to real choices; full list kept PASS');
}
// Nutrition: someone new to food sees three steps instead of a card of zeros; each step does what it says.
{
 const food=fs.readFileSync('app/static/food.js','utf8'),calls=[],nodes=new Map();
 const c={svg:()=>'',go:p=>calls.push(['go',p]),guessMeal:()=> 'lunch',describeSheet:(...a)=>calls.push(['describe',...a]),newDish:()=>calls.push(['dish']),$:s=>nodes.get(s)};
 for(const id of ['#ff-goal','#ff-log','#ff-dish'])nodes.set(id,{onclick:null});
 vm.createContext(c);vm.runInContext(food.slice(food.indexOf('function firstFood('),food.indexOf('function drawDay(')),c);
 const box={innerHTML:''};c.firstFood(box,'2026-10-18');
 assert.match(box.innerHTML,/Start your food log/);assert.match(box.innerHTML,/Log something you ate/);assert.match(box.innerHTML,/optional/);
 nodes.get('#ff-log').onclick();assert.deepEqual(calls.pop(),['describe','2026-10-18',null]);
 nodes.get('#ff-goal').onclick();assert.deepEqual(calls.pop(),['go','/food/setup']);
 assert.doesNotMatch(box.innerHTML,/ff-dish/,'saving a recipe is offered at final review, without a competing entry action');
 // Only with no history, no entries and no goal; copy shortcuts only with history.
 assert.match(food,/const fresh = !D\.has_history && !D\.entries\.length && goal == null;/);
 assert.match(food,/D\.has_history \? `<button[^`]+data-yesterday-meal=/,'Same as yesterday returns for people with food history (owner, 26 Oct 2026)');
 assert.doesNotMatch(food,/data-usual-meal=/,'Usuals stays in Add food');
 assert.match(food,/D\.entries\.length \|\| !D\.has_history \? ''/);
 assert.doesNotMatch(food,/Reminders · optional|edit or create/,'no run-on link line');
 assert.match(food,/\['reminders', 'Meal reminders'/,'reminders moved into More');
 console.log('Nutrition: first-food steps act as labelled, copy shortcuts need history, one clear library link, reminders in More PASS');
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
// Me shortcuts (2026-10-18): six labelled icons, each to a registered page.
{
 const pages=fs.readFileSync('app/static/pages.js','utf8'),c={};vm.createContext(c);
 vm.runInContext(pages.match(/const ME_SHORTCUTS = \[[\s\S]*?\]\];/)[0]+'\nglobalThis.list=ME_SHORTCUTS;',c);
 const list=JSON.parse(JSON.stringify(c.list));assert.deepEqual(list.map(x=>x[2]),['Plan','Fitness','Records','Routes','Goals','Friends']);
 const patterns=[];for(const file of fs.readdirSync('app/static').filter(f=>f.endsWith('.js')))for(const m of fs.readFileSync('app/static/'+file,'utf8').matchAll(/^route\((\/.*?\/),/gm))patterns.push(vm.runInNewContext(m[1]));
 for(const [href] of list)assert(patterns.some(re=>re.test(href.split('?')[0])),href+' is a real page');
 assert(!/me-day-links/.test(pages),'the old Training plan row is replaced by the Plan shortcut');
 for(const [href] of list)assert(!['/me','/activity','/track','/progress','/food'].includes(href),href+' would repeat a tab');
 assert(!/row\('a', 'href="\/me\/(friends|goals)"'/.test(pages),'Friends and Goals are tiles, not list rows too');
 console.log('Me shortcuts: Plan, Fitness, Records, Routes, Goals, Friends, each a real page and none repeating a tab PASS');
}
// Speed check (2026-10-18): reachable from Profile & settings, read-only (GET requests only), nothing stored.
{
 const pages=fs.readFileSync('app/static/pages.js','utf8'),part=pages.slice(pages.indexOf('// ---------- Speed check'));
 assert.match(pages,/href="\/me\/speed"/);assert.match(part,/route\(\/\^\\\/me\\\/speed\$\//);
 assert.doesNotMatch(part,/json\('(POST|PUT|DELETE|PATCH)'|method:\s*'(POST|PUT|DELETE|PATCH)'|store\.set|localStorage/,'speed check only reads');
 console.log('Speed check: linked from settings, read-only, stores nothing PASS');
}
