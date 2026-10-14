// Gesture behavior with a DOM stand-in; native keyboard animation requires a real iPhone.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app/static/app.js', 'utf8'), handlers = new Map();
const field = {matches: () => true, isContentEditable: false, blur() { document.activeElement = null; }};
const document = {activeElement: field, addEventListener: (event, fn) => handlers.set(event, fn)};
const context = {document}; vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function installKeyboardDismissal()'), source.lastIndexOf('installKeyboardDismissal();')) + 'installKeyboardDismissal();', context);
const target = {closest: () => false}, point = (x,y) => ({clientX:x,clientY:y});
function start(t=target, touches=[point(100,100)]) { document.activeElement = field; handlers.get('touchstart')({target:t,touches}); }
function move(x,y) { handlers.get('touchmove')({touches:[point(x,y)]}); }
start();move(105,160);assert.equal(document.activeElement,null,'downward swipe dismisses');
start();move(180,110);assert.equal(document.activeElement,field,'horizontal gesture preserves focus');
start();move(105,60);assert.equal(document.activeElement,field,'upward scroll preserves focus');
start();move(105,125);assert.equal(document.activeElement,field,'small movements preserve focus');
start({closest:()=>true});move(105,160);assert.equal(document.activeElement,field,'input selection/map/photo gestures excluded');
start();handlers.get('touchcancel')();move(100,170);assert.equal(document.activeElement,field,'cancelled gesture cannot dismiss');
start(target,[point(100,100),point(110,110)]);move(100,170);assert.equal(document.activeElement,field,'pinch gesture cannot dismiss');
start();const next = {};document.activeElement=next;move(100,170);assert.equal(document.activeElement,next,'newly focused field cannot be dismissed by old gesture');
console.log('Keyboard dismissal: down, horizontal/up, selection/map, cancel, pinch and changed focus passed');
