// Real preview arithmetic/renderers: source servings, selected amounts and unknown values.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const food=fs.readFileSync('app/static/food.js','utf8'),foodHome=fs.readFileSync('app/static/food-home.js','utf8'),thread=fs.readFileSync('app/static/thread.js','utf8');
const c={svg:()=>'<svg></svg>',esc:s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),fmtAmount:e=>`${e.amount} ${e.unit}`,source:()=> 'Open Food Facts',homeCalories:Math.round};
vm.createContext(c);vm.runInContext(foodHome.slice(foodHome.indexOf('const r0 ='),foodHome.indexOf('const isoDay')),c);vm.runInContext(food.slice(food.indexOf('const MEAL_NAMES'),food.indexOf('const deviceTimeZone')),c);
vm.runInContext(fs.readFileSync('app/static/food-nutrition.js','utf8')+'\nglobalThis.preview=FoodNutrition;',c);
vm.runInContext(thread.slice(thread.indexOf('  function food('),thread.indexOf('  function choices(')),c);
vm.runInContext(thread.slice(thread.indexOf('  function previewRows('),thread.indexOf('  const pendingReview=')),c);
const pasta={name:'Fictional <penne>',brand:'Fictional & Co',amount:2,unit:'serving',kcal:400,protein_g:14,carbs_g:84,fat_g:2,fiber_g:6,sugar_g:2,sodium_mg:20,
 ref:{origin:'catalog',origin_ref:{source:'off',package_size:'16 oz (454 g)',serving:{label:'2 oz (56 g)',g:56},per_serving:{kcal:200,protein_g:7,carbs_g:42,fat_g:1,fiber_g:3,sugar_g:1,sodium_mg:10}}}};
assert.equal(c.preview.macros(pasta),'Protein 14 g · Carbs 84 g · Fat 2 g');
let html=c.preview.html(pasta,'Open Food Facts');assert.match(html,/2 oz \(56 g\)/);assert.match(html,/16 oz \(454 g\)/);assert.match(html,/Fictional &amp; Co/);assert.match(html,/200 kcal/);assert.match(html,/400 kcal/);assert.match(html,/Carbohydrates/);assert.match(html,/Fiber/);assert.match(html,/Sugars/);assert.match(html,/Sodium/);
const scaled=c.preview.scale(pasta,3);assert.equal(scaled.protein_g,21);assert.equal(c.preview.basis(scaled).values.protein_g,7,'source serving stays fixed when the chosen amount changes');
html=c.preview.html({...pasta,fat_g:0,carbs_g:0,ref:{...pasta.ref,unknown_nutrients:['fat_g','carbs_g']}},'My foods');assert.equal((html.match(/Unknown/g)||[]).length,2);assert(!c.preview.macros({...pasta,fat_g:null}).includes('Fat 0'));
const fallback={...pasta,amount:150,unit:'g',ref:{per100:{kcal:200,protein_g:10,carbs_g:30,fat_g:2},serving:{label:'1 bowl',g:100,is_default:true}}};
assert.equal(c.preview.basis(fallback).label,'100 g');assert.match(c.preview.html(fallback,'USDA'),/Its weight is unavailable/);
const legacy={...fallback,ref:{...fallback.ref,source:'off',serving:{label:'1 bowl',g:100}}};
assert.equal(c.preview.basis(legacy).per100,true,'old 100 g fallback metadata must not invent a package serving');
assert.equal(c.preview.basis({...legacy,ref:{...legacy.ref,serving:{...legacy.ref.serving,is_default:false}}}).label,'1 bowl','a declared 100 g serving remains usable');
const label={...pasta,amount:112,unit:'g',ref:{origin:'label',per_serving:{kcal:210,protein_g:8,carbs_g:41,fat_g:2},serving:{label:'2 oz (56 g)',g:56},basis_unit:'g',basis_amount:56}};
assert.equal(c.preview.basis(label).factor,2);assert.equal(c.preview.basis(c.preview.scale(label,168)).factor,3);
const part={index:0,status:'ready',entries:[pasta],entry_drafts:[0],drafts:[{}],remove_entries:[0],remove_token:'a'.repeat(64)};
html=c.stepRow(c.previewRows({result:{review_only:true}},{parts:[part]})[0]);assert.match(html,/Protein 14 g · Carbs 84 g · Fat 2 g/);assert.match(html,/aria-label="Nutrition for Fictional &lt;penne&gt;, Protein 14 g/);assert.match(html,/data-food-nutrition=/);assert.match(html,/data-step="-1"/);assert.match(html,/data-step="1"/);assert.doesNotMatch(html,/data-remove-food=/,'a multi-portion card uses its stepper before trash is available');
const atOne={...part,entries:[{...pasta,amount:1}]};html=c.stepRow(c.previewRows({result:{review_only:true}},{parts:[atOne]})[0]);assert.match(html,/aria-label="Remove Fictional &lt;penne&gt;"/);assert.match(html,/class="icon-btn thread-remove"/);assert.match(html,/data-remove-food=/);assert.doesNotMatch(html,/data-step="-1"/,'at one portion, the minus control becomes trash');
assert.match(c.food({...pasta,id:undefined},0),/tf-macros/,'typed/manual/photo pending rows share the macro line');
console.log('Pending nutrition: source serving vs chosen amount, unknown/zero, fallback weight honesty, label correction scale, escaped compact cards and accessible macros PASS');

// Unit display keeps the original canonical amount until a genuine edit.
c.App={me:{id:1}};c.Native={base:''};c.location={origin:'https://example.test'};const preferences=new Map();c.store={get:k=>preferences.get(k),set:(k,v)=>preferences.set(k,v)};
vm.runInContext(food.slice(food.indexOf('function foodPortion('),food.indexOf('// nutrition for an amount')),c);
const cup={name:'Fictional cereal',amount:2/3,unit:'serving',ref:{origin:'ai',serving:{label:'1 cup',g:60}}};
let portion=c.foodPortion(cup);assert.equal(portion.format(),'0.67');
for(let i=0;i<20;i++){portion.select('g');assert.equal(portion.format(),'40');portion.select('oz');assert.equal(portion.format(),'1.41');portion.select('cup');assert.equal(portion.format(),'0.67');}
assert.equal(portion.amount,2/3,'toggles and rounded display preserve exact canonical value');portion.select('g');portion.input('30');assert.equal(portion.amount,.5);portion.remember();assert.equal(c.foodPortion(cup).unit,'g');c.App.me.id=2;assert.equal(c.foodPortion(cup).unit,'serving','preference isolated by account');c.App.me.id=1;
portion=c.foodPortion({...cup,ref:{serving:{label:'1/2 cup (28 g)',g:28}}});portion.select('cup');assert.equal(portion.format(),'0.33');portion.input('1');assert.equal(portion.amount,2);
for(const ref of [{serving:{label:'1 cup'}},{source:'off',per100:{},serving:{label:'1 cup',g:100,is_default:true}},{source:'off',per100:{},serving:{label:'1 cup',g:100}}]){portion=c.foodPortion({...cup,ref});assert.equal(portion.units.find(u=>u.key==='g').factor,null);assert.equal(portion.units.find(u=>u.key==='oz').factor,null);assert.match(vm.runInContext('portionWeightNote',c)(portion),/known serving weight/);}
portion=c.foodPortion({...cup,amount:40,unit:'g',ref:{serving:{label:'1 cup',g:60}}});portion.select('cup');assert.equal(portion.format(),'0.67');portion.input('1');assert.equal(portion.amount,60);portion.input('');assert(Number.isNaN(portion.amount));
console.log('Unit choices: g/oz/cup/serving, two decimals, exact repeated toggles, true edits, fractional labels, unknown weights and account-specific preference PASS');

portion=c.foodPortion({...cup,amount:1,ref:{source:'custom',id:9,origin:'catalog',serving:{label:'1 bowl',g:200},origin_ref:{source:'off',id:'original',serving:{label:'1 cup',g:50}}}});portion.select('g');portion.input('100');assert.equal(portion.amount,.5,'edited saved-food serving beats original catalog provenance');

portion=c.foodPortion({...cup,amount:100,unit:'g',ref:{serving:{label:'1 container',g:170}}});portion.select('serving');portion.step(.5);assert.equal(portion.amount,185,'stepper adds half a serving to exact100g');
portion=c.foodPortion({...cup,amount:1,unit:'g',ref:{serving:{label:'1 bowl',g:500}}});portion.select('serving');assert.equal(portion.unit,'g');assert.equal(portion.format(),'1','tiny positive portion uses representable unit');

portion=c.foodPortion({...cup,ref:{serving:{label:'1 glass',g:200}}});assert(portion.units.some(u=>u.key==='glass'),'singular unit ending in ss stays intact');

html=c.preview.html({...cup,kcal:160},'Kit estimate','40 g');assert.match(html,/Chosen amount<small>40 g<\/small>/,'table heading follows the selected display unit');assert(!html.includes('Chosen amount<small>0.666'));
// A ready rule/source card stays visible while another food is still resolving.
c.kitChatOn=()=>false;c.kitFoodWords=s=>s||'';c.dayLabel=()=> 'Today';c.choices=()=>'<p>Choose another food</p>';c.removableFood=()=>true;c.removeButtonMarkup=floating=>`<button data-unlogged-remove${floating?' class="thread-remove-floating"':''}>×</button>`;
vm.runInContext(thread.slice(thread.indexOf('  function changedNumbers('),thread.indexOf('  function previewRows(')),c);
html=c.replyHtml({id:1,state:'answered',result:{review_only:true}},{entries:[],result:{kind:'preview',meal:'lunch',day:'2026-11-02',pending_count:1,can_resolve:true,parts:[part,{index:1,status:'unknown',entries:[]}]}});
assert.match(html,/Fictional &lt;penne&gt;/);assert.match(html,/Checking the other foods/);assert(!html.includes('thread-thinking'),'a spinner does not hide a resolved source');assert.equal((html.match(/data-unlogged-remove/g)||[]).length,0,'the single-food card has no wasted close row');assert.equal((html.match(/data-remove-food/g)||[]).length,0,'a multi-portion card uses minus until one portion');assert.match(html,/data-step="-1"/,'the ready row keeps its minus action beside the amount');
console.log('Partial food resolution: ready numbers remain visible with a working status PASS');

c.aiCan=()=>false;c.aiOffer=()=>false;
vm.runInContext(thread.slice(thread.indexOf('  function choices('),thread.indexOf('  function changedNumbers(')),c);
html=c.choices({parts:[{index:0,status:'choose',description:{reference:true},item:{choices:[{name:'Egg whites',kind:'custom',id:1}],new_ok:true,new_name:'Egg'}}]});
assert.match(html,/Egg whites/);assert.match(html,/Egg \(new food\)/);assert.match(html,/data-choice=/,'model ambiguity retains actual choice buttons');
