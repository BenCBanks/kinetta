// Render the production prediction block: concise collapsed help preserves the numbers and source link.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('    pbox.innerHTML = f.predictions.length'),end=source.indexOf('\n    box.innerHTML',start);
const c={pbox:{},f:{predictions:[{label:'5K',seconds:1200,distance_m:5000,best_s:1300,from:{label:'10K',start_time:'2026-10-01'}}]},b:{activity_id:42,label:'10K',elapsed_s:2500,start_time:'2026-10-01'},esc:String,dur:n=>n+' seconds',fdate:d=>d,U:{pace:n=>n+' pace',pu:()=>'/km'}};
vm.createContext(c);vm.runInContext(source.slice(start,end),c);const html=c.pbox.innerHTML;
assert.match(html,/<details class="prediction-method"><summary>How estimates work<\/summary>/,'Method explanation starts collapsed');
assert(!/<details[^>]*\bopen\b/.test(html));assert(html.includes('Estimates, not target paces.'));assert(html.includes('1200 seconds'));assert(html.includes('1300 seconds'));assert(html.includes('href="/activity/42"'));assert(html.includes('90 days'));assert(html.includes('prediction-source'));
c.f.predictions=[];vm.runInContext(source.slice(start,end),c);assert(c.pbox.innerHTML.includes('Run a mile or more'));assert(!c.pbox.innerHTML.includes('<details'));
console.log('Prediction help: collapsed concise method, unchanged prediction/best/source values and useful empty state PASS');
