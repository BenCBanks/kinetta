'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8'),c={r0:String};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function macroTotal'),source.indexOf('function todayFoodCard')),c);
const day={entries:[{},{}],totals:{protein_g:20},unknown_nutrients:{protein_g:1}};
assert.equal(c.macroTotal(day,'protein_g',110),'20 g known · incomplete');day.unknown_nutrients.protein_g=2;assert.equal(c.macroTotal(day,'protein_g',110),'Unknown');day.unknown_nutrients.protein_g=0;assert.equal(c.macroTotal(day,'protein_g',110),'20 g / 110 g');
console.log('thread nutrition: known/unknown/incomplete totals do not invent target progress PASS');
