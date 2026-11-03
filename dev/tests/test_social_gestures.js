// Real gesture handler, deterministic pointer events/timers. No network or devices.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timers=new Map(),resources=new Map(),buzzes=[];let serial=0,time=0,toggles=0,shown=0;
const ctx={viewResources:resources,Date:{now:()=>time},Math,Native:{haptic:kind=>buzzes.push('legacy:'+kind)},Haptics:{tick:()=>buzzes.push('tick'),react:()=>buzzes.push('react')},setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
vm.createContext(ctx);const source=fs.readFileSync('app/static/social.js','utf8');vm.runInContext(source.slice(source.indexOf('function cheerGesture'),source.indexOf('\nfunction activityCheers')),ctx);
function button(){return {dataset:{},isConnected:true,classList:{remove(){}},getAttribute(){return null;}};}
const event=(extra={})=>({button:0,isPrimary:true,detail:1,clientX:10,clientY:10,preventDefault(){},stopPropagation(){},...extra});
const runTimers=()=>{for(const[id,fn]of [...timers]){timers.delete(id);fn();}};
const b=button();ctx.cheerGesture(b,()=>toggles++,()=>shown++);ctx.cheerGesture(b,()=>assert.fail('duplicate binding'),()=>assert.fail('duplicate binding'));
b.onpointerdown(event());b.onpointerup(event());b.onclick(event());assert.equal(toggles,1,'tap toggles immediately');assert.equal(timers.size,0);
b.onpointerdown(event());runTimers();time=10000;b.onpointerup(event());b.onclick(event());assert.equal(shown,1);assert.equal(toggles,1,'even prolonged hold never toggles on release');
b.onpointerdown(event());b.onpointerup(event());b.onclick(event());assert.equal(toggles,2,'the next intentional tap is not swallowed');
time=12000;b.onpointerdown(event());runTimers();b.oncontextmenu(event());assert.equal(shown,2,'context menu after long hold does not reopen');b.onpointerup(event());b.onclick(event());assert.equal(toggles,2);
time=14000;b.onpointerdown(event());b.onpointermove(event({clientY:30}));assert.equal(timers.size,0,'scroll cancels hold');b.onpointercancel(event());
b.onpointerdown(event());b.onpointercancel(event());assert.equal(timers.size,0);b.onpointerdown(event());b.onpointerleave(event());assert.equal(timers.size,0);
b.onpointerdown(event({isPrimary:false}));assert.equal(timers.size,0);b.onpointerdown(event({button:2}));assert.equal(timers.size,0,'secondary pointers do not arm a hold');
b.onclick(event({detail:0}));assert.equal(toggles,3,'keyboard activation is immediate');b.oncontextmenu(event());assert.equal(shown,3);b.oncontextmenu(event());assert.equal(shown,3,'repeated context event is suppressed');
time=16000;b.onpointerdown(event());resources.get(b)();assert.equal(timers.size,0,'view cleanup cancels pending hold');
const detached=button();ctx.cheerGesture(detached,()=>assert.fail('detached toggle'),()=>assert.fail('detached hold'));detached.onpointerdown(event());detached.isConnected=false;runTimers();assert.equal(timers.size,0);
assert.deepEqual(buzzes,[],'gesture layer delegates all feedback to the picker/action controller, avoiding duplicate ticks');
console.log('Social gestures: immediate tap, long-hold/context suppression, scroll/cancel/leave, secondary pointers, keyboard, detached/cleanup and delegated haptics PASS');
