// Exercise the production calendar model, chart and event handlers with fictional distances.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),app=fs.readFileSync('app/static/app.js','utf8');
const context={SPORT_NAMES:{run:'Run',ride:'Ride',walk:'Walk',other:'Other'},svg:()=>'<svg></svg>',U:{dist:n=>(n/1000).toFixed(1),du:()=> 'km'},esc:String,fdate:(d,o)=>new Date(d).toLocaleDateString('en-US',o)};
vm.createContext(context);vm.runInContext(app.slice(app.indexOf('const niceStep ='),app.indexOf('// Monthly values (faint)')),context);vm.runInContext(source.slice(source.indexOf('function mileagePeriods('),source.indexOf('// A shared private reader')),context);
function chartButton(){const classes=new Set();return {attrs:{},classes,classList:{toggle(k,on){on?classes.add(k):classes.delete(k);}},setAttribute(k,v){this.attrs[k]=v;},focus(options){this.focused=true;this.focusOptions=options;this.onfocus?.();}};}
const highlighted=buttons=>buttons.flatMap((b,i)=>b.classes.has('is-highlighted')?[i]:[]);
function render(series){
 const readout={},box={buttons:[],toggles:[],querySelectorAll(s){return s==='.mileage-day'?this.buttons:this.toggles;},querySelector(s){return s==='.mileage-range'?readout:this.toggles.find(b=>s.includes('"'+b.dataset.mileagePeriod+'"'));}};
 const button=chartButton;
 Object.defineProperty(box,'innerHTML',{get(){return this.html;},set(h){this.html=h;this.buttons=Array.from({length:7},button);this.toggles=['days','weeks'].map(p=>Object.assign(button(),{dataset:{mileagePeriod:p}}));}});
 context.mileageChart(box,series);return {box,readout};
}
const days=[{d:'2026-10-17',distance_m:9000},{d:'2026-10-18',distance_m:5000},{d:'2026-10-19',distance_m:0},{d:'2026-10-20',distance_m:12500,today:true}];
const weeks=Array.from({length:7},(_,i)=>{const date=new Date('2026-09-06T12:00Z');date.setUTCDate(date.getUTCDate()+i*7);const d=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {d,end:i===6?'2026-10-20':date.toISOString().slice(0,10),distance_m:(i+1)*1000,today:i===6};});
const series={days,weeks,today:'2026-10-20'},model=context.mileagePeriods(series);
assert.equal(model.days.length,7);assert.equal(model.days[0].d,'2026-10-18');assert.equal(model.days[6].d,'2026-10-24');assert(model.days[3].future);assert.equal(model.days[3].distance_m,0);
const {box,readout}=render(series);let buttons=box.buttons;assert.deepEqual(highlighted(buttons),[2],'today is the only initial highlight');
assert(box.html.includes('This week'));assert(box.html.includes('17.5'));assert(box.html.includes('Sunday to Saturday'));assert(!box.html.includes('<b>18</b>'));assert(box.html.includes('Wed, Oct 21 · Not yet'));
buttons[0].onpointerenter({pointerType:'mouse'});assert.equal(readout.textContent,'Sun, Oct 18 · 5.0 km');buttons[0].onpointerleave({pointerType:'mouse'});assert.equal(readout.textContent,'Oct 18 – Oct 24');
buttons[1].onclick();assert.deepEqual(highlighted(buttons),[1],'selecting a zero day moves the highlight without inventing a bar');assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');buttons[2].onpointerenter({pointerType:'touch'});assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');buttons[2].onpointerenter({pointerType:'mouse'});assert.equal(readout.textContent,'Tue, Oct 20 · 12.5 km');buttons[2].onpointerleave({pointerType:'mouse'});assert.equal(readout.textContent,'Mon, Oct 19 · 0.0 km');
let prevented=false;buttons[1].onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});assert(prevented);assert.equal(readout.textContent,'Tue, Oct 20 · 12.5 km');buttons[2].onkeydown({key:'Escape'});assert.equal(readout.textContent,'Oct 18 – Oct 24');assert(buttons.every(b=>b.attrs['aria-pressed']==='false'));assert.deepEqual(highlighted(buttons),[2],'Escape restores today');
buttons[2].onclick();buttons[2].onclick();assert.equal(readout.textContent,'Oct 18 – Oct 24');
box.toggles[1].onclick();assert(box.html.includes('Last 7 weeks'));assert(box.html.includes('28.0'));assert(box.toggles[1].focused);box.buttons[0].onclick();assert.equal(readout.textContent,'Sep 6 – Sep 12 · 1.0 km');box.buttons[6].onclick();assert.equal(readout.textContent,'Oct 18 – Oct 20 (so far) · 7.0 km');assert(box.buttons[0].attrs['aria-pressed']==='false');box.toggles[0].onclick();assert(box.html.includes('This week'));assert(box.buttons.every(b=>!b.attrs['aria-pressed']||b.attrs['aria-pressed']==='false'));
context.U={dist:n=>(n/1609.344).toFixed(1),du:()=> 'mi'};const imperial=render(series);imperial.box.buttons[0].onclick();assert.equal(imperial.readout.textContent,'Sun, Oct 18 · 3.1 mi');
const empty=render({today:'2026-10-20',days:[]});assert.equal(empty.box.buttons.length,7);assert(empty.box.html.includes('No distance recorded'));assert(empty.box.html.includes('disabled title="Weekly distance needs a server update"'));
for(const [today,start,end] of [['2026-10-18','2026-10-18','2026-10-24'],['2026-10-24','2026-10-18','2026-10-24'],['2027-01-01','2026-12-27','2027-01-02'],['2026-11-01','2026-11-01','2026-11-07']]){const m=context.mileagePeriods({today,days:[]});assert.equal(m.days[0].d,start);assert.equal(m.days[6].d,end);assert.equal(m.days.filter(r=>r.today).length,1);}
console.log('Seven-bar chart: Sunday/day/week/year/DST dates, future/zero/empty, km/mi, toggles/focus, hover/touch/pinning and keyboard PASS');

context.U={dist:n=>(n/1000).toFixed(1),du:()=> 'km'};
const mixed=render({today:'2026-10-20',days:[{d:'2026-10-20',distance_m:10000,by_sport:{run:3000,ride:6000,walk:1000}}],streaks:{days:3,weeks:2}});
const paths=html=>[...html.matchAll(/<path class="mileage-bar" d="([^"]+)"/g)].map(m=>m[1]);
const top=path=>+path.match(/Q[^ ]+ ([^ ]+)/)[1];
const painted=paths(mixed.box.html),scale=context.mileageScale([{distance_m:10000}]);
assert.equal(painted.length,1,'mixed sports paint one total rather than stacked segments');assert.equal(top(painted[0]),128-10000/scale.max*110);
assert.match(painted[0],/^M0 128V/);assert.match(painted[0],/V128Z$/,'flat zero baseline is unchanged');
assert.match(mixed.box.html,/mileage-axis/);assert.match(mixed.box.html,/scale 0 to 10 km/);
assert.match(mixed.box.html,/3-day activity streak/);assert.match(mixed.box.html,/2-week activity streak/);
assert(!mixed.box.html.includes('sport-legend'));assert(!mixed.box.html.includes('data-sport='));
mixed.box.buttons[2].onclick();assert.match(mixed.readout.textContent,/Run 3.0 km, Ride 6.0 km, Walk 1.0 km/);
assert.match(mixed.box.html,/Run 3.0 km, Ride 6.0 km, Walk 1.0 km/,'the accessible bar name retains the real sport breakdown');
assert.deepEqual(highlighted(mixed.box.buttons),[2]);
const shortDay=render({today:'2026-10-20',days:[{d:'2026-10-19',distance_m:12500,by_sport:{ride:12500}},{d:'2026-10-20',distance_m:10,by_sport:{run:7.5,walk:2.5}}]});
assert(Math.abs(top(paths(shortDay.box.html)[1])-(128-10/15000*110))<1e-9,'tiny total retains its exact fraction of the common scale');
assert.match(shortDay.box.html,/<text class="mileage-value"[^>]*><0.1<\/text>/,'a positive value below rounding is not labelled zero');
const untrusted=render({today:'2026-10-20',days:[{d:'2026-10-20',distance_m:2000,by_sport:{run:5000}}]});
untrusted.box.buttons[2].onclick();assert(!untrusted.readout.textContent.includes('Run'),'an invalid breakdown never invents sport attribution');assert.match(untrusted.readout.textContent,/2.0 km/);
const future=mixed.box.buttons[6];future.onclick();assert.match(mixed.readout.textContent,/Not yet/);assert.deepEqual(highlighted(mixed.box.buttons),[6]);future.onkeydown({key:'Escape'});assert.deepEqual(highlighted(mixed.box.buttons),[2]);
console.log('Single total bars: exact heights/tiny values, flat baseline, rounded tops, no sport legend, real breakdown on tap, future/zero and highlight restoration PASS');

// Progress All activities shares the inspection rules; filtered sport/food charts keep their own renderer.
context.$=(selector,box)=>selector==='.readout'?box.readout:selector==='svg'?box.svg:box.hl;
function periods(distance,keys=[{k:'run',name:'Run'},{k:'ride',name:'Ride'}]){
 const box={clientWidth:340,readout:{},svg:{addEventListener(k,f){this[k]=f;},getBoundingClientRect(){return {left:0,width:340};}},hl:{setAttribute(){}},querySelectorAll(){return this.buttons;}};
 Object.defineProperty(box,'innerHTML',{get(){return this.html;},set(html){this.html=html;this.buttons=Array.from({length:(html.match(/class="distance-column"/g)||[]).length},chartButton);}});
 context.periodBars(box,[{label:'Week A',tick:'A',segs:[{k:'run',v:3},{k:'ride',v:6}]},{label:'Week B',partial:true,segs:[{k:'run',v:0}]}],{keys,fmt:v=>v.toFixed(1)+' km',distance});return box;
}
const combined=periods(true);assert.equal((combined.html.match(/class="bar-seg distance-total"/g)||[]).length,1);assert(!combined.html.includes('class="legend'));assert.deepEqual(highlighted(combined.buttons),[1]);
let keyPrevented=false;combined.buttons[0].onkeydown({key:'Enter',preventDefault(){keyPrevented=true;}});assert(keyPrevented);assert.equal(combined.buttons[0].attrs['aria-pressed'],'true');combined.buttons[0].onkeydown({key:' ',preventDefault(){}});assert.equal(combined.buttons[0].attrs['aria-pressed'],'false','SVG bar buttons support Enter and Space without native click synthesis');
combined.buttons[0].onclick();assert.match(combined.readout.innerHTML,/9.0 km/);assert.match(combined.readout.innerHTML,/Run <b>3.0 km/);assert.match(combined.readout.innerHTML,/Ride <b>6.0 km/);assert.deepEqual(highlighted(combined.buttons),[0]);
combined.buttons[0].onkeydown({key:'ArrowRight',preventDefault(){}});assert.match(combined.readout.innerHTML,/0.0 km/);assert.equal(combined.buttons[1].focusOptions.preventScroll,true);combined.buttons[1].onkeydown({key:'Escape'});assert.deepEqual(highlighted(combined.buttons),[1]);
const sport=periods(false,[{k:'run',name:'Run'}]);assert(sport.html.includes('bar-seg k-run'));assert(!sport.html.includes('distance-total'));assert.equal(typeof sport.svg.pointerdown,'function');
console.log('Progress totals: one bar per period, named per-sport breakdown/zero/current/keyboard, sport-specific renderer preserved PASS');

context.U={dist:n=>(n/1609.344).toFixed(1),du:()=> 'mi'};const miles=context.mileageScale([{distance_m:12500}]);assert.equal(miles.top,8);assert.equal(miles.middle,4);assert.equal(miles.max,8*1609.344);
console.log('SVG distance scale: shared mile/km axis, exact total heights/flat baseline, short-day fractions and visible totals PASS');
