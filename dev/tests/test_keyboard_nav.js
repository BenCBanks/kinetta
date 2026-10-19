// Real shared controller with stand-in OS events/viewport; no device or personal data.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app/static/keyboard.js', 'utf8');
function setup({native = false, coarse = true, viewport = true} = {}) {
  const handlers = {}, classes = new Set(), frames = [], styles = {};
  const listen = (name, fn) => (handlers[name] ||= []).push(fn);
  const vv = {height: 844, offsetTop: 0, scale: 1, addEventListener: listen};
  const made = [];
  const element = (tag) => { const on = {}, el = {tag, children: [], addEventListener: (n, fn) => (on[n] ||= []).push(fn),
    appendChild(c) { this.children.push(c); }, fire(n, e = {}) { for (const fn of on[n] || []) fn(e); }}; made.push(el); return el; };
  const document = {activeElement: null, addEventListener: listen, createElement: element, body: element('body'),
    documentElement: {style: {setProperty(name, value) { styles[name] = value; }}, classList: {toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }}}};
  const context = {document, innerHeight: 844, addEventListener: listen,
    requestAnimationFrame: (fn) => frames.push(fn), matchMedia: () => ({matches: coarse}),
    window: {Capacitor: {isNativePlatform: () => native}, visualViewport: viewport ? vv : null}};
  vm.runInNewContext(source, context);
  return {document, vv, context, made, styles, open: () => classes.has('keyboard-open'),
    event(name) { for (const fn of handlers[name] || []) fn(); while (frames.length) frames.shift()(); },
    focus(extra = {}) { document.activeElement = {matches: () => true, ...extra}; this.event('focusin'); },
    blur() { document.activeElement = null; this.event('focusout'); }};
}
const n = setup({native: true});
assert.equal(n.open(), false);
n.event('keyboardWillShow'); assert.equal(n.open(), true, 'hidden before native resize');
n.context.innerHeight = 510; n.vv.height = 510; n.event('resize'); n.focus(); n.blur();
assert.equal(n.open(), true, 'native state survives resize, blur and route replacement');
n.event('keyboardWillHide'); assert.equal(n.open(), true, 'no flash during interactive dismissal');
n.event('keyboardDidShow'); assert.equal(n.open(), true, 'cancelled dismissal stays hidden');
n.event('keyboardDidHide'); assert.equal(n.open(), false, 'restore even while field remains focused');
n.focus(); assert.equal(n.open(), false, 'external keyboard focus does not hide tabs');
// the iPhone app's Done strip: added once to the page, closes the keyboard without first stealing focus
const strip = n.document.body.children.find((c) => c.className === 'kb-done'); assert.ok(strip, 'Done strip added in the app');
const doneButton = strip.children[0]; assert.equal(doneButton.textContent, 'Done');
let prevented = false; doneButton.fire('pointerdown', {preventDefault: () => { prevented = true; }}); assert.ok(prevented, 'tap keeps focus');
let blurred = false; n.document.activeElement = {blur: () => { blurred = true; }}; doneButton.fire('click'); assert.ok(blurred, 'Done closes the keyboard');
assert.equal(setup().document.body.children.length, 0, 'no strip in a browser (Safari has its own Done bar)');
const b = setup();
b.focus(); assert.equal(b.open(), false);
b.vv.height = 770; b.event('resize'); assert.equal(b.open(), false, 'browser chrome is not keyboard');
b.vv.height = 510; b.event('resize'); assert.equal(b.open(), true, 'browser overlay keyboard');
b.blur(); assert.equal(b.open(), true, 'blur cannot expose tabs during closing animation');
b.focus(); assert.equal(b.open(), true, 'changing fields keeps tabs hidden');
b.vv.height = 844; b.event('resize'); assert.equal(b.open(), false, 'dismiss with field still focused');
b.context.innerHeight = 510; b.vv.height = 510; b.event('resize');
assert.equal(b.open(), true, 'browser that resizes layout viewport');
b.context.innerHeight = 844; b.vv.height = 844; b.event('resize'); assert.equal(b.open(), false);
b.vv.scale = 2; b.vv.height = 422; b.event('resize'); assert.equal(b.open(), false, 'pinch zoom is not keyboard');
const d = setup({coarse: false}); d.focus(); d.vv.height = 400; d.event('resize'); assert.equal(d.open(), false, 'desktop resizing');
for (const extra of [{disabled: true}, {readOnly: true}, {inputMode: 'none'}, {matches: () => false}]) {
  const t = setup(); t.focus(extra); t.vv.height = 510; t.event('resize'); assert.equal(t.open(), false, 'non-editable controls');
}
const content = setup(); content.focus({matches: () => false, isContentEditable: true});
content.vv.height = 510; content.event('resize'); assert.equal(content.open(), true, 'contenteditable');
assert.doesNotThrow(() => setup({viewport: false}));
console.log('Keyboard navigation: native lifecycle, Done strip, cancelled dismissal, viewport modes, focus changes, physical keyboards and zoom passed');

// Food layout follows the usable viewport on both OS event paths, without
// changing size under a deliberate pinch gesture or requiring another focus.
for (const native of [false, true]) {
  const t = setup({native});
  assert.equal(t.styles['--chat-height'], '844px');
  t.vv.height = 460; t.vv.offsetTop = 12; t.event('resize');
  assert.equal(t.styles['--chat-height'], '460px');
  assert.equal(t.styles['--chat-top'], '12px');
  t.vv.offsetTop = 20; t.event('scroll');
  assert.equal(t.styles['--chat-top'], '20px', 'follow Safari focus pan');
  t.vv.scale = 2; t.vv.height = 230; t.event('resize');
  assert.equal(t.styles['--chat-height'], '460px', 'pinch keeps layout stable');
  t.vv.scale = 1; t.vv.height = 844; t.vv.offsetTop = 0; t.event('resize');
  assert.equal(t.styles['--chat-height'], '844px', 'keyboard dismissal restores full height');
}
const fallback = setup({native:true, viewport:false});
fallback.context.innerHeight = 480; fallback.event('resize');
assert.equal(fallback.styles['--chat-height'], '480px');
console.log('Food viewport: browser/native resize, focus pan, keyboard dismissal, pinch and absent visualViewport passed');
