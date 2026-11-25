'use strict';
// Exercise the real Usage renderer and keep the signup funnel aggregate-only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/admin.js','utf8'),start=source.indexOf('function usageView('),end=source.indexOf('// Accounts are paginated',start);
assert(start>=0&&end>start,'Usage renderer is present');
const content={innerHTML:''},nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{});return nodes.get(s)};
const c={content,reportDays:30,esc:s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
 rangeSelect:()=>'<select id="report-days"></select>',wireRange(){},date:String,$:node,
 table:(heads,rows)=>'<table>'+rows.join('')+'</table>'};
vm.createContext(c);vm.runInContext(source.slice(start,end),c);
c.usageView({counts:{accounts:20,new_accounts:4,active_accounts:3,signins:9,workouts:7,food_entries:8},
 signup_funnel:{signed_up:4,email_confirmed:3,first_workout_or_food_7d:2},since:'2026-10-01',
 daily:[{day:'2026-11-25',active:null,workouts:1,food_entries:2}],sources:[],imports:{completed:0,failed:0}});
assert.match(content.innerHTML,/<h3 id="signup-funnel-title">Sign-up funnel<\/h3>/);
for(const [label,count] of [['Signed up',4],['Email confirmed',3],['First workout or food within 7 days',2]]){
 assert(content.innerHTML.includes(label),label);assert(content.innerHTML.includes(`<strong class="metric">${count}</strong>`),`${label} count`);
}
assert.match(content.innerHTML,/full 7-day window/);
assert.equal((content.innerHTML.match(/class="card"/g)||[]).length,9,'six existing usage metrics and three funnel counts');
assert.doesNotMatch(content.innerHTML,/username|email address|PRIVATE_|Sam Demo/);
console.log('PASS admin Usage renderer: three count-only signup steps and 7-day eligibility note');
