// Lifting summary after Finish and the recording screen's controls (28 October 2026).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const lift = fs.readFileSync('app/static/lift.js', 'utf8');
const code = lift.slice(lift.indexOf('const wUnit'), lift.indexOf('const KINDS')) + lift.slice(lift.indexOf('function liftTotals'), lift.indexOf('// The session is already saved'));
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
assert(/const r = await save\(true\)[\s\S]{0,120}liftSummary\(el, aid, r\)/.test(lift), 'Finish on a live session opens the summary');
console.log('PASS lifting summary totals, records and Finish wiring');
// The recording screen sizes its map to the space left, so Pause/Resume/Finish stay above the tab bar.
const track = fs.readFileSync('app/static/track.js', 'utf8'), css = fs.readFileSync('app/static/style.css', 'utf8');
assert(/<div class="track-live-main"><div class="track-live-top">[\s\S]*?aria-label="Recording controls">[\s\S]*?<\/div><\/div><p class="small muted">/.test(track), 'controls close the sized block');
assert(/\.track-live-main \{[^}]*min-height: calc\(100dvh[^}]*var\(--tab-h\)/.test(css) && /\.track-live-main \.track-map-wrap \{ flex: 1 1 0/.test(css));
console.log('PASS recording controls sized above the tab bar');
// Discard right away (28 October 2026): a lifting session can be deleted before or after Finish; a paused recording shows
// Discard under its controls, on screen.
assert(/id="lf-discard">Discard session/.test(lift) && /id="lf-sum-del">Delete this session/.test(lift), 'lifting: discard and delete');
assert(/function discardLift[\s\S]{0,700}method: 'DELETE'[\s\S]{0,200}store\.del\('fit\.lift:'/.test(lift), 'deletes the activity and the phone copy');
assert(/\$\{paused \? `<span class="round-ctl round-ctl-discard"><button class="round-btn discard" id="track-discard" aria-label="Discard recording">/.test(track), 'paused: Discard in the controls row');
assert(/\$\{paused \? '' : `<button class="linkbtn danger track-discard" id="track-discard"/.test(track), 'one Discard at a time');
console.log('PASS discard a lifting session or a paused recording right away');

