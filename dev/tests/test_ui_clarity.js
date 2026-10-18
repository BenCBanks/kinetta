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
 const c={svg:()=>'',go:p=>calls.push(['go',p]),guessMeal:()=> 'lunch',addSheet:(...a)=>calls.push(['add',...a]),newDish:()=>calls.push(['dish']),$:s=>nodes.get(s)};
 for(const id of ['#ff-goal','#ff-log','#ff-dish'])nodes.set(id,{onclick:null});
 vm.createContext(c);vm.runInContext(food.slice(food.indexOf('function firstFood('),food.indexOf('function ring(')),c);
 const box={innerHTML:''};c.firstFood(box,'2026-10-18');
 assert.match(box.innerHTML,/Start your food log/);assert.match(box.innerHTML,/Log something you ate/);assert.match(box.innerHTML,/optional/);
 nodes.get('#ff-log').onclick();assert.deepEqual(calls.pop(),['add','2026-10-18','lunch']);
 nodes.get('#ff-goal').onclick();assert.deepEqual(calls.pop(),['go','/food/setup']);
 nodes.get('#ff-dish').onclick({currentTarget:{}});assert.deepEqual(calls.pop(),['dish']);
 // Only with no history, no entries and no goal; copy shortcuts only with history.
 assert.match(food,/const fresh = !D\.has_history && !D\.entries\.length && goal == null;/);
 assert.match(food,/D\.has_history&&D\.day===isoDay\(new Date\(\)\)&&m===guessMeal\(\)/);
 assert.match(food,/D\.entries\.length \|\| !D\.has_history \? ''/);
 assert.doesNotMatch(food,/Reminders · optional|edit or create/,'no run-on link line');
 assert.match(food,/\['reminders', 'Meal reminders'/,'reminders moved into More');
 console.log('Nutrition: first-food steps act as labelled, copy shortcuts need history, one clear library link, reminders in More PASS');
}
// Food chat: a plain name for the search tool.
assert.match(fs.readFileSync('app/static/thread.js','utf8'),/id="thread-search">\$\{svg\('search'\)\}Search foods</);
console.log('Food chat: Search foods label PASS');
