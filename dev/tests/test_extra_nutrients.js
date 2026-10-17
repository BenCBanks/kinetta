'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8');const c={esc:v=>String(v).replaceAll('<','&lt;'),r0:v=>String(Math.round(v)),r1:v=>String(Math.round(v*10)/10)};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('const EXTRA_NUTRIENTS'),source.indexOf('const isoDay')),c);
vm.runInContext(source.slice(source.indexOf('function scaleFood'),source.indexOf('// ---------- day page')),c);
const sample={per100:{kcal:200,protein_g:20,sodium_mg:400,sugar_g:0,saturated_fat_g:.0123}};
assert.equal(c.scaleFood(sample,50,'g').sodium_mg,200);assert.equal(c.scaleFood(sample,50,'g').sugar_g,0);assert.equal(c.scaleFood(sample,50,'g').saturated_fat_g,.0062);assert.equal(c.scaleFood(sample,50,'g').carbs_g,null);
assert.equal(c.nutrientNumber(null,'mg'),'Unknown');assert.equal(c.nutrientNumber(0,'g'),'0 g');assert.equal(c.nutrientNumber(.0123,'g'),'&lt;0.1 g');
const coverage=c.extraCoverage([{sodium_mg:400,sugar_g:0},{sodium_mg:null,sugar_g:null}],{sodium_target_mg:2000});assert.equal(coverage.sodium_mg.recorded,400);assert.equal(coverage.sodium_mg.unknown_count,1);assert.equal(coverage.sodium_mg.complete,false);assert.equal(coverage.sugar_g.recorded,0);assert.equal(coverage.saturated_fat_g.recorded,null);
assert.equal(c.extraCoverage([]).sugar_g.recorded,null);
const html=c.extraTotals(coverage);assert(html.includes('Known subtotal · incomplete'));assert(html.includes('Your limit: 2000 mg'));assert(!html.includes('<details class="extra-nutrients" open'));assert(c.extraTotals(coverage,{period:true}).includes('Recorded totals across this date range.'));assert(!c.extraTotals(coverage,{period:true}).includes('Your limit:'));
assert(c.extraInputs({sugar_g:0}).includes('name="sugar_g" inputmode="decimal" value="0"'));assert(c.extraInputs({},true).includes('Optional nutrient limits'));
const fake={elements:{namedItem:k=>({value:k==='sugar_g'?'0':k==='sodium_mg'?'':'.5'})}};assert.equal(c.extraFormValues(fake).sodium_mg,null);assert.equal(c.extraFormValues(fake).sugar_g,0);assert.equal(c.extraFormValues(fake).saturated_fat_g,.5);
assert.throws(()=>c.extraFormValues({elements:{namedItem:()=>({value:'Infinity'})}}));
console.log('Extra nutrient UI arithmetic: mg/g scaling, tiny values, zero vs unknown, partial coverage, folded detail, unset daily limits and separate range totals PASS');

const stored=c.foodStorage({kcal:200,protein_g:null,sodium_mg:0});assert.equal(stored.protein_g,0);assert.equal(stored.sodium_mg,0);assert.equal(stored.sugar_g,null);assert(stored.ref.unknown_nutrients.includes('protein_g'));assert(!stored.ref.unknown_nutrients.includes('sodium_mg'));assert.throws(()=>c.foodStorage({kcal:null}));

assert(c.foodStorage({kcal:10,ref:{unknown_nutrients:['future_nutrient']}}).ref.unknown_nutrients.includes('future_nutrient'));
