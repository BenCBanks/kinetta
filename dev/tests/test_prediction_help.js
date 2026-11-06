// Prediction references are quiet, local-year bests; provenance stays inside the explanation.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('    const predictionSourceDetail ='),end=source.indexOf('\n    pbox.innerHTML',start),block=source.slice(start,end);
assert(start>=0&&end>start);
const context={
  esc:s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
  dur:n=>Math.floor(n/60)+':'+String(Math.round(n%60)).padStart(2,'0'),
  fdate:()=> 'Oct 2'
};
const helpers=vm.runInNewContext('(()=>{'+block+';return {source:predictionSourceDetail,best:predictionBestReference};})()',context);
const sourceHtml=helpers.source({label:'5K',from:{label:'5K',elapsed_s:1200,start_time:'2026-10-01T10:00:00Z'}});
assert(sourceHtml.includes('<li class="prediction-source"><span>5K</span><span>5K · 20:00 · Oct 2</span></li>'));
assert(!sourceHtml.includes('<a'));
const escaped=helpers.source({label:'5K <script>',from:{label:'track & field',elapsed_s:1200,start_time:'invalid'}});
assert(escaped.includes('5K &lt;script&gt;'));assert(escaped.includes('track &amp; field'));assert(escaped.includes('date unavailable'));
assert(helpers.source({label:'5K',from:{}}).includes('Source unavailable'));
assert.equal(helpers.best({best_s:1170,best_year:2024}),'19:30 · 2024');
assert.equal(helpers.best({best_s:1170,best_year:null}),'19:30');
assert.equal(helpers.best({best_s:null,best_year:null}),null);
console.log('Prediction detail: quiet dated best, missing reference, escaped plain-text sources and invalid-source fallback PASS');
