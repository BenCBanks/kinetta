'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const s=fs.readFileSync('app/static/pages.js','utf8');const c={App:{me:{login:'zz_test_week'}},profileHref:p=>'/people/'+p.login,ProgressUI:{statRow:items=>`<div class="stat-row">${items.map(i=>`${i.label}:${i.value}${i.unit||''}`).join('|')}</div>`},svg:name=>`<svg data-icon="${name}"></svg>`,U:{dist:n=>n/1000,du:()=> 'km',time:s=>s+' seconds'},dur:s=>s+' seconds',esc:String,dayLabel:iso=>iso,r0:Math.round};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function combinedWeekHtml'),s.indexOf('function workoutEnergy(box,aid)')),c);
const empty={start:'2026-10-10',end:'2026-10-16',workouts:0,distance_m:0,seconds:0,days_logged:0,protein_target:110,protein_days_reached:0,protein_days_unknown:0};let h=c.combinedWeekHtml(empty);assert.match(h,/class="combined-week card"/);assert.match(h,/Your week in review/);assert.match(h,/Oct 10 – Oct 16/);assert.match(h,/Workouts:0\|Distance:–\|Time:–/);assert.match(h,/0 of 7 days/);assert.match(h,/Protein goal not set|0 of 7 days/);assert.match(h,/Food review/);assert.match(h,/Your workouts/);
h=c.combinedWeekHtml({...empty,workouts:1,seconds:1800});assert.match(h,/Workouts:1\|Distance:–\|Time:1800 seconds/);assert(h.includes('href="/people/zz_test_week"'),'week review opens the canonical owner history');
h=c.combinedWeekHtml({...empty,days_logged:2,protein_days_unknown:1});assert.match(h,/2 of 7 days/);assert.match(h,/1 unknown/);assert(!h.includes('Food consistency will appear'));
h=c.combinedWeekHtml({...empty,workouts:2,distance_m:5000,seconds:1800,days_logged:3,protein_target:110,protein_days_reached:2});assert.match(h,/Distance:5km/);assert.match(h,/2 of 7 days/);assert.equal((h.match(/class="row-link"/g)||[]).length,2,'both destinations remain available for every data state');
console.log('Combined week actual renderer: fixed three-metric row, empty/populated food and protein facts, and both destination rows PASS');
async function failedWeekCopy(){
 c.readOwner=()=> 'zz_test_week';c.location={search:''};c.URLSearchParams=URLSearchParams;c.document={createElement:tag=>({tag,remove(){this.removed=true;}})};c.$=()=>({});c.load=()=>Promise.reject(Error('Fictional unavailable summary'));
 const failed={isConnected:true,innerHTML:'',append(button){this.retry=button;}};c.combinedWeek(failed);await new Promise(resolve=>setImmediate(resolve));
 assert.match(failed.innerHTML,/Your weekly summary couldn’t load\./);assert.equal(failed.retry.textContent,'Try again.');assert.equal(failed.retry.className,'linkbtn combined-week-retry');
 console.log('Combined week failed-load copy and retry action PASS');
}
(async()=>{
 await failedWeekCopy();
 c.readOwner=()=> 'A';c.homeCalories=n=>Math.round(n/5)*5;let item={id:1,kcal:538,source:'healthkit',estimated:false};c.load=(path,fn)=>Promise.resolve(fn({today:{items:[item],day_burn:2500,included_in_day_burn:true,food_href:'/food'}}));vm.runInContext(s.slice(s.indexOf('function workoutEnergy('),s.indexOf('function workoutSyncStatus')),c);
 const box={isConnected:true,innerHTML:''};c.workoutEnergy(box,1);assert(box.innerHTML.includes('+540 kcal burned'));assert(box.innerHTML.includes('Recorded calories from the Health app.'));item={...item,kcal:0,estimated:true};c.workoutEnergy(box,1);assert(box.innerHTML.includes('Calories are unavailable'));assert(!box.innerHTML.includes('+0 kcal'));
 console.log('Own workout energy actual renderer: nearest5kcal/source label and unavailable calories instead of empty0 PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
