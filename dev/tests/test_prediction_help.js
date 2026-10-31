// Render the production prediction block: shared provenance only for the same complete effort.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('    const predictionSourceKey'),end=source.indexOf('\n    box.innerHTML',start),block='(()=>{'+source.slice(start,end)+'})()';
assert(start>=0&&end>start);
const from={activity_id:7,label:'5K',distance_m:5000,elapsed_s:1200,start_time:'2026-10-01T10:00:00Z'},base={label:'5K',seconds:1200,distance_m:5000,best_s:1300,from};
const c={pbox:{},f:{predictions:[]},b:{activity_id:42,label:'10K',elapsed_s:2500,start_time:'2026-10-02'},esc:String,dur:n=>n+' seconds',fdate:d=>d,U:{pace:n=>n+' pace',pu:()=>'/km'}};
vm.createContext(c);
function render(rows){c.f.predictions=structuredClone(rows);const before=JSON.stringify(c.f.predictions);vm.runInContext(block,c);assert.equal(JSON.stringify(c.f.predictions),before,'presentation does not mutate predictions');return c.pbox.innerHTML;}
const count=html=>(html.match(/class="prediction-source/g)||[]).length;
const shared=render([base,{...base,label:'10K',distance_m:10000,seconds:2500}]);
assert.equal(count(shared),1);assert.match(shared,/Based on your 5K/);assert(shared.includes('href="/activity/7"'));assert(shared.includes('href="/activity/42"'),'fastest-effort help keeps its separate source');
for(const change of [{activity_id:8},{distance_m:10000},{elapsed_s:1210},{start_time:'2026-10-01T11:00:00Z'}]){
 const html=render([base,{...base,from:{...from,...change}}]);assert.equal(count(html),2);assert(!html.includes('Based on your'),'different IDs, efforts and full timestamps stay separate');
}
const incomplete=render([base,{...base,from:{label:'5K',start_time:from.start_time,activity_id:7}}]);assert.equal(count(incomplete),2);assert(!incomplete.includes('Based on your'),'old cached provenance is not assumed equal');
const html=render([base]);assert.match(html,/<details class="prediction-method"><summary>How estimates work<\/summary>/);assert(!/<details[^>]*\bopen\b/.test(html));for(const text of ['Estimates, not target paces.','1200 seconds','1300 seconds','90 days','Beats your best'])assert(html.includes(text),text);
const empty=render([]);assert(empty.includes('Run a mile or more'));assert(!empty.includes('<details'));
console.log('Predictions: complete shared provenance once; mixed/same-date/different-ID/effort/cache cases retain sources; values, green best, collapsed caveat and empty state PASS');
