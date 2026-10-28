// Real preview arithmetic/renderers: source servings, selected amounts and unknown values.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const food=fs.readFileSync('app/static/food.js','utf8'),thread=fs.readFileSync('app/static/thread.js','utf8');
const c={esc:s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),fmtAmount:e=>`${e.amount} ${e.unit}`,source:()=> 'Open Food Facts',homeCalories:Math.round};
vm.createContext(c);vm.runInContext(food.slice(food.indexOf('const MEAL_NAMES'),food.indexOf('const isoDay')),c);
vm.runInContext(fs.readFileSync('app/static/food-nutrition.js','utf8')+'\nglobalThis.preview=FoodNutrition;',c);
vm.runInContext(thread.slice(thread.indexOf('  function food('),thread.indexOf('  function choices(')),c);
vm.runInContext(thread.slice(thread.indexOf('  function previewRows('),thread.indexOf('  const pendingReview=')),c);
const pasta={name:'Fictional <penne>',brand:'Fictional & Co',amount:2,unit:'serving',kcal:400,protein_g:14,carbs_g:84,fat_g:2,fiber_g:6,sugar_g:2,sodium_mg:20,
 ref:{origin:'catalog',origin_ref:{source:'off',package_size:'16 oz (454 g)',serving:{label:'2 oz (56 g)',g:56},per_serving:{kcal:200,protein_g:7,carbs_g:42,fat_g:1,fiber_g:3,sugar_g:1,sodium_mg:10}}}};
assert.equal(c.preview.macros(pasta),'Protein 14 g · Carbs 84 g · Fat 2 g');
let html=c.preview.html(pasta,'Open Food Facts');assert.match(html,/2 oz \(56 g\)/);assert.match(html,/16 oz \(454 g\)/);assert.match(html,/Fictional &amp; Co/);assert.match(html,/200 kcal/);assert.match(html,/400 kcal/);assert.match(html,/Carbohydrates/);assert.match(html,/Fibre/);assert.match(html,/Sugars/);assert.match(html,/Sodium/);
const scaled=c.preview.scale(pasta,3);assert.equal(scaled.protein_g,21);assert.equal(c.preview.basis(scaled).values.protein_g,7,'source serving stays fixed when the chosen amount changes');
html=c.preview.html({...pasta,fat_g:0,carbs_g:0,ref:{...pasta.ref,unknown_nutrients:['fat_g','carbs_g']}},'My foods');assert.equal((html.match(/Unknown/g)||[]).length,2);assert(!c.preview.macros({...pasta,fat_g:null}).includes('Fat 0'));
const fallback={...pasta,amount:150,unit:'g',ref:{per100:{kcal:200,protein_g:10,carbs_g:30,fat_g:2},serving:{label:'1 bowl',g:100,is_default:true}}};
assert.equal(c.preview.basis(fallback).label,'100 g');assert.match(c.preview.html(fallback,'USDA'),/Its weight is unavailable/);
const label={...pasta,amount:112,unit:'g',ref:{origin:'label',per_serving:{kcal:210,protein_g:8,carbs_g:41,fat_g:2},serving:{label:'2 oz (56 g)',g:56},basis_unit:'g',basis_amount:56}};
assert.equal(c.preview.basis(label).factor,2);assert.equal(c.preview.basis(c.preview.scale(label,168)).factor,3);
const part={index:0,status:'ready',entries:[pasta],entry_drafts:[0],drafts:[{}],remove_entries:[0],remove_token:'a'.repeat(64)};
html=c.stepRow(c.previewRows({result:{review_only:true}},{parts:[part]})[0]);assert.match(html,/Protein 14 g · Carbs 84 g · Fat 2 g/);assert.match(html,/aria-label="Nutrition for Fictional &lt;penne&gt;, Protein 14 g/);assert.match(html,/data-food-nutrition=/);assert.match(html,/data-step="1"/);
assert.match(c.food({...pasta,id:undefined},0),/tf-macros/,'typed/manual/photo pending rows share the macro line');
console.log('Pending nutrition: source serving vs chosen amount, unknown/zero, fallback weight honesty, label correction scale, escaped compact cards and accessible macros PASS');
