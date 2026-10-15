// Real gesture handler, deterministic pointer events/timers. No network or devices.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const timers = new Map(), resources = new Map(); let ticks = 0, time = 0, toggles = 0, shown = 0;
const ctx = {viewResources: resources, Date: {now: () => time}, Math,
 setTimeout: fn => { timers.set(++ticks, fn); return ticks; }, clearTimeout: id => timers.delete(id)};
vm.createContext(ctx);const source = fs.readFileSync('app/static/social.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function cheerGesture'),source.indexOf('\nfunction activityCheers')),ctx);
function button() { return {dataset:{},isConnected:true,classList:{remove(){}},getAttribute(){return null;}}; }
const event = (extra={}) => ({button:0,isPrimary:true,detail:1,clientX:10,clientY:10,preventDefault(){},stopPropagation(){},...extra});
const b=button();ctx.cheerGesture(b,()=>toggles++,()=>shown++);
b.onpointerdown(event());b.onpointerup(event());b.onclick(event());
assert.equal(toggles,1,'tap toggles synchronously, no artificial delay');assert.equal(timers.size,0);
b.onpointerdown(event());[...timers.values()].forEach(f=>f());time=10000;b.onpointerup(event());b.onclick(event());
assert.equal(shown,1,'long press opens people');assert.equal(toggles,1,'even a prolonged hold never toggles on release');
b.onpointerdown(event());b.onpointerup(event());b.onclick(event());assert.equal(toggles,2,'next intentional tap after closing people is not swallowed');
time=12000;b.onpointerdown(event());b.onpointermove(event({clientY:30}));assert.equal(timers.size,0,'scroll cancels hold');b.onpointercancel(event());
b.onpointerdown(event());b.onpointercancel(event());assert.equal(timers.size,0,'pointer cancellation clears timer');
b.onpointerdown(event());b.onpointerleave(event());assert.equal(timers.size,0,'leaving target clears timer');
b.onclick(event({detail:0}));assert.equal(toggles,3,'keyboard activation is immediate');
b.oncontextmenu(event());assert.equal(shown,2,'context-menu activation is accessible');
time=14000;b.onpointerdown(event());resources.get(b)();assert.equal(timers.size,0,'view cleanup cancels pending holds');
console.log('Social gestures: immediate tap, long-hold no mutation, scroll/cancel/leave, keyboard and cleanup passed');
