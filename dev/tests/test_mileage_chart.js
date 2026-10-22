// Exercise the production calendar model, chart and event handlers with fictional distances.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8');
const context={SPORT_NAMES:{run:'Run',ride:'Ride',walk:'Walk',other:'Other'},svg:()=>'<svg></svg>',U:{dist:n=>(n/1000).toFixed(1),du:()=> 'km'},esc:String,fdate:(d,o)=>new Date(d).toLocaleDateString('en-US',o)};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function mileagePeriods('),source.indexOf('// A shared private reader')),context);
function render(series){
 const readout={},box={buttons:[],toggles:[],querySelectorAll(s){return s==='.mileage-day'?this.buttons:this.toggles;},querySelector(s){return s==='.mileage-range'?readout:this.toggles.find(b=>s.includes('"'+b.dataset.mileagePeriod+'"'));}};
 const button=()=>({attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;this.onfocus?.();}});
 Object.defineProperty(box,'innerHTML',{get(){return this.html;},set(h){this.html=h;this.buttons=Array.from({length:7},button);this.toggles=['days','weeks'].map(p=>Object.assign(button(),{dataset:{mileagePeriod:p}}));}});
 context.mileageChart(box,series);return {box,readout};
}
const days=[{d:'2026-10-17',distance_m:9000},{d:'2026-10-18',distance_m:5000},{d:'2026-10-19',distance_m:0},{d:'2026-10-20',distance_m:12500,today:true}];
const weeks=Array.from({length:7},(_,i)=>{const date=new Date('2026-09-06T12:00Z');date.setUTCDate(date.getUTCDate()+i*7);const d=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {d,end:i===6?'2026-10-20':date.toISOString().slice(0,10),distance_m:(i+1)*1000,today:i===6};});
const series={days,weeks,today:'2026-10-20'},model=context.mileagePeriods(series);
assert.equal(model.days.length,7);assert.equal(model.days[0].d,'2026-10-18');assert.equal(model.days[6].d,'2026-10-24');assert(model.days[3].future);assert.equal(model.days[3].distance_m,0);
const {box,readout}=render(series);let buttons=box.buttons;
assert(box.html.includes('This week'));assert(box.html.includes('17.5'));assert(box.html.includes('Sunday to Saturday'));assert(!box.html.includes('<b>18</b>'));assert(box.html.includes('Wed, Oct 21 · Not yet'));
buttons[0].onpointerenter({pointerType:'mouse'});assert.equal(readout.textContent,'Sun, Oct 18 · 5.0 km');buttons[0].onpointerleave({pointerType:'mouse'});assert.equal(readout.textContent,'Oct 18 – Oct 24');
buttons[1].onclick();assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');buttons[2].onpointerenter({pointerType:'touch'});assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');buttons[2].onpointerenter({pointerType:'mouse'});assert.equal(readout.textContent,'Tue, Oct 20 · 12.5 km');buttons[2].onpointerleave({pointerType:'mouse'});assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');
let prevented=false;buttons[1].onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});assert(prevented);assert.equal(readout.textContent,'Tue, Oct 20 · 12.5 km');buttons[2].onkeydown({key:'Escape'});assert.equal(readout.textContent,'Oct 18 – Oct 24');assert(buttons.every(b=>b.attrs['aria-pressed']==='false'));
buttons[2].onclick();buttons[2].onclick();assert.equal(readout.textContent,'Oct 18 – Oct 24');
box.toggles[1].onclick();assert(box.html.includes('Last 7 weeks'));assert(box.html.includes('28.0'));assert(box.toggles[1].focused);box.buttons[0].onclick();assert.equal(readout.textContent,'Sep 6 – Sep 12 · 1.0 km');box.buttons[6].onclick();assert.equal(readout.textContent,'Oct 18 – Oct 20 (so far) · 7.0 km');assert(box.buttons[0].attrs['aria-pressed']==='false');box.toggles[0].onclick();assert(box.html.includes('This week'));assert(box.buttons.every(b=>!b.attrs['aria-pressed']||b.attrs['aria-pressed']==='false'));
context.U={dist:n=>(n/1609.344).toFixed(1),du:()=> 'mi'};const imperial=render(series);imperial.box.buttons[0].onclick();assert.equal(imperial.readout.textContent,'Sun, Oct 18 · 3.1 mi');
const empty=render({today:'2026-10-20',days:[]});assert.equal(empty.box.buttons.length,7);assert(empty.box.html.includes('No distance recorded'));assert(empty.box.html.includes('disabled title="Weekly distance needs a server update"'));
for(const [today,start,end] of [['2026-10-18','2026-10-18','2026-10-24'],['2026-10-24','2026-10-18','2026-10-24'],['2027-01-01','2026-12-27','2027-01-02'],['2026-11-01','2026-11-01','2026-11-07']]){const m=context.mileagePeriods({today,days:[]});assert.equal(m.days[0].d,start);assert.equal(m.days[6].d,end);assert.equal(m.days.filter(r=>r.today).length,1);}
console.log('Seven-bar chart: Sunday/day/week/year/DST dates, future/zero/empty, km/mi, toggles/focus, hover/touch/pinning and keyboard PASS');

context.U={dist:n=>(n/1000).toFixed(1),du:()=> 'km'};
const stacked=render({today:'2026-10-20',days:[{d:'2026-10-20',distance_m:10000,by_sport:{run:3000,ride:6000,walk:1000}}],streaks:{days:3,weeks:2}});
assert.match(stacked.box.html,/data-sport="run" data-w="0.3"/);assert.match(stacked.box.html,/data-sport="ride" data-w="0.6"/);assert.match(stacked.box.html,/data-sport="walk" data-w="0.1"/);
assert.match(stacked.box.html,/3-day activity streak/);assert.match(stacked.box.html,/2-week activity streak/);
stacked.box.buttons[2].onclick();assert.match(stacked.readout.textContent,/Run 3.0 km, Ride 6.0 km, Walk 1.0 km/);
assert.match(stacked.box.html,/sport-legend/);assert.match(stacked.box.html,/mileage-empty/);
assert.match(stacked.box.html,/<span class="mileage-value">10.0<\/span>/,'visible total belongs to the complete stack');
assert.equal((stacked.box.html.match(/class="mileage-value"/g)||[]).length,1,'empty and future days have no invented value');
const shortDay=render({today:'2026-10-20',days:[{d:'2026-10-19',distance_m:12500,by_sport:{ride:12500}},{d:'2026-10-20',distance_m:10,by_sport:{run:7.5,walk:2.5}}]});
assert.match(shortDay.box.html,/class="mileage-column" data-h="0.0008"/,'short days retain their true fraction of the common scale');
assert.match(shortDay.box.html,/<span class="mileage-value"><0.1<\/span>/,'a positive distance below rounding is not labelled zero');
const untrusted=render({today:'2026-10-20',days:[{d:'2026-10-20',distance_m:2000,by_sport:{run:5000}}]});
assert(!untrusted.box.html.includes('data-sport="run"'),'a malformed partial breakdown never exaggerates the total');assert(untrusted.box.html.includes('data-sport="total"'));
console.log('Stacked sport bars: exact proportions/readout/legend, zero baseline, honest old/invalid payload fallback and labelled streaks PASS');
