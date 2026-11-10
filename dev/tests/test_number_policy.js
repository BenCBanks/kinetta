// One number policy (#765): the shared U helpers format distance, pace, durations, elevation and weight the same way
// everywhere. Runs the real helpers from app.js with a fictional account in either unit system.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/app.js','utf8');
const code=source.slice(source.indexOf('const MI = 1609.344;'),source.indexOf('const tz = () =>'));
const c={App:{me:{units:'imperial'}}};vm.createContext(c);vm.runInContext(code+'\nglobalThis.U=U;globalThis.dur=dur;globalThis.MI=MI;',c);
const {U,dur,MI}=c,mi=n=>n*MI,set=u=>{c.App.me.units=u;};

set('imperial');
// Distance: one decimal, whole numbers from 100, thousands separators, explicit decimals still honoured.
assert.equal(U.dist(mi(4.14)),'4.1');assert.equal(U.dist(mi(4)),'4.0');assert.equal(U.dist(0),'0.0');
assert.equal(U.dist(mi(99.94)),'99.9');assert.equal(U.dist(mi(100.4)),'100');assert.equal(U.dist(mi(1234.6)),'1,235');
assert.equal(U.dist(mi(12.345),0),'12');assert.equal(U.dist(mi(2.43),2),'2.43','live recording can still ask for two decimals');
assert.equal(U.dist(null),'–');assert.equal(U.dist(NaN),'–');assert.equal(U.dist(Infinity),'–');
// Pace m:ss rolls over correctly: 59.5 s is the next minute, never ':60' and never a wrong ':59'.
const perMile=s=>s*1000/MI;
assert.equal(U.pace(perMile(479.5)),'8:00');assert.equal(U.pace(perMile(479.4)),'7:59');assert.equal(U.pace(perMile(59.5)),'1:00');
assert.equal(U.pace(perMile(420)),'7:00');assert.equal(U.pace(perMile(3599.6)),'60:00');
assert.equal(U.pace(0),'–');assert.equal(U.pace(null),'–');assert.equal(U.pace(Infinity),'–');
assert.equal(U.swim(119.5/0.09144),'2:00','swim pace uses the same rollover');
// Summary durations: hours and minutes; seconds stay for records, splits and intervals (dur).
assert.equal(U.time(4020),'1h 7m');assert.equal(U.time(1200),'20m');assert.equal(U.time(10800),'3h');assert.equal(U.time(45),'45s');
assert.equal(U.time(59.5),'1m');assert.equal(U.time(3599.6),'1h');assert.equal(U.time(0),'0m');assert.equal(U.time(null),'–');
assert.equal(U.time(3600*1234),'1,234h','huge totals keep separators');
assert.equal(dur(4020,true),'1h 7m','older summary callers share the policy');assert.equal(dur(4023),'1:07:03');assert.equal(dur(83.6),'1:24');
// Elevation whole numbers with separators; weight one decimal.
assert.equal(U.elev(1000),'3,281');assert.equal(U.elev(12.4),'41');assert.equal(U.weight(63.5),'140.0');

set('metric');
assert.equal(U.dist(4140),'4.1');assert.equal(U.dist(123456),'123');assert.equal(U.dist(1234567),'1,235');
assert.equal(U.pace(299.5),'5:00');assert.equal(U.pace(299.4),'4:59');assert.equal(U.elev(1234.4),'1,234');assert.equal(U.weight(63.54),'63.5');
console.log('Number policy: 1-decimal distance with separators, m:ss pace rollover, h/m summary time, whole elevation, 1-decimal weight PASS');
