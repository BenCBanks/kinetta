'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const s=fs.readFileSync('app/static/food.js','utf8'),c={esc:String,r0:String,r1:String};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('const EXTRA_NUTRIENTS'),s.indexOf('const isoDay')),c);vm.runInContext(s.slice(s.indexOf('function recentToFood'),s.indexOf('function sharedRecipeHtml')),c);vm.runInContext(s.slice(s.indexOf('function scaleFood'),s.indexOf('// ---------- day page')),c);
const row={name:'Fictional edited bowl',amount:2,unit:'serving',kcal:600,protein_g:30,carbs_g:50,fat_g:20,fiber_g:null,sodium_mg:800,sugar_g:0,saturated_fat_g:2,source:'label',ref:{origin:'label',serving:{g:200,label:'1 bowl'},per_serving:{kcal:200,sodium_mg:999},unknown_nutrients:['fiber_g']}};
let f=c.recentToFood(row);assert.equal(f.per_serving.kcal,300);assert.equal(f.per100.sodium_mg,200);assert.equal(f.per_serving.sugar_g,0);assert.equal(c.scaleFood(f,2,'serving').sodium_mg,800);assert.equal(c.scaleFood(f,100,'g').sodium_mg,200);assert.equal(c.scaleFood(f,2,'serving').fiber_g,null);
f=c.recentToFood({...row,ref:null});assert.equal(f.per_serving.sodium_mg,400);assert.equal(f.per100,null);assert.equal(c.scaleFood(f,2,'serving').saturated_fat_g,2);
f=c.recentToFood({...row,ref:{origin:'ai',origin_model:'stand-in'},source:'ai'});assert.equal(f.origin,'ai');assert.equal(f.per_serving.sugar_g,0);assert.equal(c.scaleFood(f,2,'serving').kcal,600);
f=c.recentToFood({...row,amount:200,unit:'g',ref:{unknown_nutrients:['protein_g']}});assert.equal(f.per100.sodium_mg,400);assert.equal(f.per100.protein_g,null);assert.equal(c.scaleFood(f,100,'g').sodium_mg,400);
console.log('Recent food normalization: all8 nutrients, current manual edit vs old catalog values, source-only/no refs, per-unit/g conversion, source/AI origin and unknown-vs-zero PASS');

f=c.recentToFood({...row,amount:200,unit:'g'});assert.equal(f.serving.g,200);assert.equal(f.serving.label,'1 bowl');assert.equal(c.scaleFood(f,1,'serving').sodium_mg,800);assert.equal(c.scaleFood(f,100,'g').sodium_mg,400);assert.equal(c.scaleFood(f,1,'serving').sugar_g,0);

f=c.recentToFood({...row,unit:'cup'});assert.equal(f.per100,null);assert.equal(f.serving.g,null);assert.equal(f.serving.label,'1 cup');assert.equal(c.scaleFood(f,2,'cup').sodium_mg,800);
