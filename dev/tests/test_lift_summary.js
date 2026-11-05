// Lifting summary after Finish and the recording screen's controls (28 October 2026).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const lift = fs.readFileSync('app/static/lift.js', 'utf8');
const routes = fs.readFileSync('app/static/lift-routes.js', 'utf8');
const code = lift.slice(lift.indexOf('const wUnit'), lift.indexOf('const KINDS')) + routes.slice(routes.indexOf('function liftTotals'), routes.indexOf('// The session is already saved'));
const x = [
  {name: 'Bench press', kind: 'weight', sets: [{kg: 20, reps: 10, warmup: true}, {kg: 60, reps: 5, pr: ['heaviest']}, {kg: 55, reps: 6}]},
  {name: 'Pull-up', kind: 'body', sets: [{reps: 10, pr: ['reps']}, {reps: 8}]},
  {name: 'Plank', kind: 'time', sets: [{secs: 60}]},
  {name: 'Curl', kind: 'weight', sets: [{kg: null, reps: null}]},     // nothing entered: not counted
];
const [t, texts] = vm.runInNewContext(code + '\nconst t = liftTotals(x); [t, t.records.map(recordText)];', {x, imp: () => false, LB: 2.20462262});
assert.equal(t.exercises, 3); assert.equal(t.sets, 5, 'warm-ups and empty sets are left out');
assert.equal(t.reps, 29); assert.equal(t.kg, 60 * 5 + 55 * 6, 'volume is working sets only');
assert.deepEqual(t.records.map((r) => r.name + ':' + r.what), ['Bench press:heaviest', 'Pull-up:reps']);
assert.deepEqual(texts, ['60 kg × 5', '10 reps']);
assert.equal(t.warmupExercises, 1); assert.equal(t.warmupSets, 1);
const only = vm.runInNewContext(code + '\nliftTotals(x);', {x:[{name:'Squat',sets:[{reps:8,warmup:true},{reps:5,warmup:true},{reps:5,warmup:true,done:false},{warmup:true}]}],imp:()=>false,LB:2.20462262});
assert.equal(only.exercises,0);assert.equal(only.sets,0);assert.equal(only.reps,0);assert.equal(only.kg,0);assert.equal(only.warmupExercises,1);assert.equal(only.warmupSets,2,'only completed warm-up sets count');
assert(/const r = await save\(true\)[\s\S]{0,120}liftSummary\(el, aid, r\)/.test(routes), 'Finish on a live session opens the summary');
for (const name of ['const LB =', 'const wUnit =', 'function startLiftSheet()', 'async function pLifting(', 'function liftCard(', 'async function fillLiftCard(', 'async function liftNowCard(']) assert(lift.includes(name), 'eager contract: ' + name);
assert.equal((lift.match(/^route\(/gm) || []).length, 0, 'the eager seam registers no lift feature routes');
assert.equal((routes.match(/^route\(/gm) || []).length, 5, 'all five lift routes are deferred together');
assert(!lift.includes('function liftLogger(') && routes.includes('function liftLogger('), 'the active session editor is deferred');
console.log('PASS lifting summary totals, records and Finish wiring');
// The recording controls remain outside the scrolling content block.
const track = fs.readFileSync('app/static/track.js', 'utf8');
// Viewport size, captions and hit targets are covered by tracking_ui.cjs.
// Discard right away (28 October 2026): a lifting session can be deleted before or after Finish; a paused recording shows
// Discard under its controls, on screen.
assert(/id="lf-discard">Discard session/.test(routes) && /id="lf-sum-del">Delete this session/.test(routes), 'lifting: discard and delete');
assert(/function discardLift[\s\S]*queueLift\(key,[\s\S]*method: 'DELETE'[\s\S]*store\.del\(key\)/.test(routes), 'deletes the activity and its account-scoped phone copy after queued writes');
assert(/\$\{paused \? `<span class="round-ctl round-ctl-discard"><button class="round-btn discard" id="track-discard" aria-label="Discard recording">/.test(track), 'paused: Discard in the controls row');
assert(/\$\{paused \? '' : `<button class="linkbtn danger track-discard" id="track-discard"/.test(track), 'one Discard at a time');
console.log('PASS discard a lifting session or a paused recording right away');

