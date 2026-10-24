// Real recorder arithmetic: stale GPS, implausible jumps, gaps and paused wall time.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const text = fs.readFileSync('app/static/track.js', 'utf8');
const m = vm.runInNewContext(text.slice(text.indexOf('const TrackMath'), text.indexOf('const Track =')) + '\nTrackMath;');
const s = {start: 1000000, activeAt: 1000000, activeMs: 5000, state: 'recording', sport: 'run', segment: 0, points: [], distance: 0};
const p = (lat, t, accuracy = 5) => ({coords: {latitude: lat, longitude: 0, accuracy}, timestamp: 1000000 + t * 1000});
assert(m.accept(s, p(0, 1), 1001000));
assert(m.accept(s, p(.0001, 6), 1006000));
assert(s.distance > 11 && s.distance < 12);
assert(!m.accept(s, p(30, 7), 1007000), 'GPS jump rejected');
assert(!m.accept(s, p(.0002, 9, 200), 1009000), 'weak accuracy rejected');
assert(!m.accept(s, p(.0002, 6), 1009000), 'duplicate timestamp rejected');
assert(!m.accept(s, p(.0002, 10), 1040000), 'cached stale fix rejected');
const d = s.distance;
assert(m.accept(s, p(20, 45), 1045000), 'fresh fix after gap starts a segment');
assert.equal(s.segment, 1); assert.equal(s.distance, d, 'no distance across signal gap');
s.segment++; s.activeAt = 1060000;
assert(!m.accept(s, p(20, 50), 1060000), 'fix from before resume rejected');
assert(m.accept(s, p(20, 61), 1061000)); assert.equal(s.distance, d, 'no distance across pause');
assert.equal(m.seconds(s, 1065000), 10);
s.state = 'paused'; assert.equal(m.seconds(s, 9999000), 5, 'paused timer cannot count wall time');
console.log('PASS recorder GPS quality, continuity, timestamps and timer');
// The shared distance filter (#234 item 2): the same fictional fixes the server and iPhone tests use.
for (const [name, c] of Object.entries(JSON.parse(fs.readFileSync('dev/tests/fixtures/gps_filter.json', 'utf8')).cases)) {
  const r = {start: 0, activeAt: 0, activeMs: 0, state: 'recording', sport: c.sport, segment: 0, points: [], distance: 0};
  for (const f of c.points) assert(m.accept(r, {coords: {latitude: f.lat, longitude: f.lon, accuracy: f.accuracy}, timestamp: f.t * 1000}, f.t * 1000), name + ' fix accepted');
  assert(r.distance >= c.expect[0] && r.distance <= c.expect[1], `${name}: ${r.distance.toFixed(1)} m outside ${c.expect}`);
  assert.equal(r.points.length, c.points.length, name + ': every fix still draws the map');
}
console.log('PASS recorder distance filter: 1 km run, 3-minute stand-still, walk with a stop, ride with poor signal');
// Auto-pause and splits (#234 item 4): same scenario as mobile/tests/track/main.swift.
{
  const r = {start: 0, activeAt: 0, activeMs: 0, state: 'recording', sport: 'run', segment: 0, points: [], distance: 0, autoPause: true, lastMove: 0, autoMs: 0, splitMetres: 1000, splits: []};
  const fix = (metres, sec) => m.accept(r, {coords: {latitude: metres / 111320, longitude: 10, accuracy: 5}, timestamp: sec * 1000}, sec * 1000);
  for (let i = 0; i <= 100; i++) assert(fix(i * 6, i * 2));            // 600 m in 200 s
  assert.equal(m.autoPaused(r, 210000), false, 'not yet: under 15 s still');
  assert.equal(m.autoPaused(r, 230000), true, 'auto-paused after 15 s still');
  const frozen = m.seconds(r, 230000);
  assert.equal(m.seconds(r, 260000), frozen, 'the clock stays stopped while still');
  for (let i = 1; i <= 80; i++) assert(fix(600 + i * 6, 260 + i * 2));   // moves again at 262 s (a new section after the gap)
  assert(Math.abs(m.seconds(r, 420000) - (420 - 47)) < 0.01, `62 s stop (200-262 s) leaves out 47 s: ${m.seconds(r, 420000)}`);
  assert.equal(r.splits.length, 1); assert(r.splits[0] > 345 && r.splits[0] < 352, 'split 1 at 1 km: 396 s on the clock minus the 47 s stop: ' + r.splits[0]);
  r.autoPause = false; assert(Math.abs(m.seconds(r, 500000) - (500 - 47)) < 0.01, 'off: nothing more left out');
  r.autoPause = true; const p = {...r, lastMove: 420000}; m.settle(p, 470000); p.activeMs += 470000; p.state = 'paused';
  assert(Math.abs(m.seconds(p, 999999) - (470 - 47 - 35)) < 0.01, 'manual pause during a stop keeps the idle stretch out');
  assert.equal(m.current([{t: 0, d: 0}, {t: 20000, d: 60}], 20000), 3, 'current speed over the last samples');
  assert.equal(m.current([{t: 0, d: 0}, {t: 20000, d: 5}], 20000), null, 'too little movement: no pace');
}
console.log('PASS recorder auto-pause (15 s, no jump, manual pause), splits and current pace');
