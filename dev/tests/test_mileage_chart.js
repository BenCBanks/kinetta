// Exercise the production chart and its event handlers with made-up distances.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('app/static/pages.js', 'utf8');
const context = {U: {dist: n => (n / 1000).toFixed(1), du: () => 'km'}, esc: String,
  fdate: (date, options) => new Date(date).toLocaleDateString('en-US', options)};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function mileageChart('), source.indexOf('// A shared private reader')), context);
function render(days) {
  const readout = {}, buttons = days.map(() => ({attrs: {}, classes: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    classList: {toggle() {}}, focus() { this.onfocus(); }}));
  const box = {querySelectorAll: () => buttons, querySelector: () => readout};
  context.mileageChart(box, {days});
  return {box, buttons, readout};
}
const days = [{d: '2026-10-18', distance_m: 5000}, {d: '2026-10-19', distance_m: 0}, {d: '2026-10-20', distance_m: 12500, today: true}];
const {box, buttons, readout} = render(days);
assert(box.innerHTML.includes('17.5'));
assert(box.innerHTML.includes('role="group"'));
assert(!box.innerHTML.includes('role="img"'));
assert(!box.innerHTML.includes('<b>18</b>'));
assert(box.innerHTML.includes('aria-label="Mon, Oct 19 · 0.0 km"'));
buttons[0].onpointerenter({pointerType: 'mouse'});
assert.equal(readout.textContent, 'Sun, Oct 18 · 5.0 km');
buttons[0].onpointerleave({pointerType: 'mouse'});
assert.equal(readout.textContent, 'Oct 18 – Oct 20');
buttons[1].onfocus(); buttons[1].onclick();
assert.equal(readout.textContent, 'Mon, Oct 19 · 0.0 km');
assert.equal(buttons[1].attrs['aria-pressed'], 'true');
buttons[2].onpointerenter({pointerType: 'touch'});
assert.equal(readout.textContent, 'Mon, Oct 19 · 0.0 km');
buttons[2].onpointerenter({pointerType: 'mouse'});
assert.equal(readout.textContent, 'Tue, Oct 20 · 12.5 km');
buttons[2].onpointerleave({pointerType: 'mouse'});
assert.equal(readout.textContent, 'Mon, Oct 19 · 0.0 km');
let prevented = false;
buttons[1].onkeydown({key: 'ArrowRight', preventDefault() { prevented = true; }});
assert(prevented); assert.equal(readout.textContent, 'Tue, Oct 20 · 12.5 km');
buttons[2].onkeydown({key: 'Escape'});
assert.equal(readout.textContent, 'Oct 18 – Oct 20');
assert(buttons.every(b => b.attrs['aria-pressed'] === 'false'));
buttons[2].onclick(); buttons[2].onclick();
assert.equal(readout.textContent, 'Oct 18 – Oct 20');
context.U = {dist: n => (n / 1609.344).toFixed(1), du: () => 'mi'};
const imperial = render(days); imperial.buttons[0].onclick();
assert.equal(imperial.readout.textContent, 'Sun, Oct 18 · 3.1 mi');
assert(render([]).box.innerHTML.includes('No distance recorded'));
const zero = render([{d: '2026-10-20', distance_m: 0}]); zero.buttons[0].onclick();
assert.equal(zero.readout.textContent, 'Tue, Oct 20 · 0.0 mi');
assert(zero.box.innerHTML.includes('No distance recorded'));
console.log('Mileage chart: mouse, touch, toggle, keyboard, date labels, zero/empty and km/mi PASS');
