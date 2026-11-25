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
const metricsStart=source.indexOf('function overviewMetricsMarkup('),metricsEnd=source.indexOf('async function overviewMetrics(',metricsStart);
assert(metricsStart>=0&&metricsEnd>metricsStart,'Overview metric renderer is present');
vm.runInContext(source.slice(metricsStart,metricsEnd),c);
const overview=c.overviewMetricsMarkup({sent:3,delivered:2,bounced:1,failed:4},{today_usd:.125,month_usd:4.5});
for(const item of ['Email · 7 days','Sent 3','Delivered 2','Bounced 1','Failed 4','Today $0.13','This month $4.50'])assert(overview.includes(item),item);
assert.equal((overview.match(/<p>/g)||[]).length,2,'email and Kit totals stay in two compact rows');assert.doesNotMatch(overview,/<h[1-6]\b/,'compact block has no headings');
assert.doesNotMatch(overview,/user|account|email address|token|micro/i);
console.log('PASS admin Overview renderer: four email counts and Kit dollars only');
