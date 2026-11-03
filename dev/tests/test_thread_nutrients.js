'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8'),c={r0:String};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function macroTotal'),source.indexOf('function todayFoodCard')),c);
const day={entries:[{},{}],totals:{protein_g:20},unknown_nutrients:{protein_g:1}};
assert.equal(c.macroTotal(day,'protein_g',110),'20 g recorded · some foods are missing values');day.unknown_nutrients.protein_g=2;assert.equal(c.macroTotal(day,'protein_g',110),'Unknown');day.unknown_nutrients.protein_g=0;assert.equal(c.macroTotal(day,'protein_g',110),'20 g / 110 g');
const cardSource=source.slice(source.indexOf('function todayFoodCard'),source.indexOf('function chooseYesterday'));
const card={r0:String,homeCalories:String,stat:(label,value,unit)=>`${label} ${value} ${unit||''}`,esc:String,MACROS:[['protein_g','Protein']],App:{},
  load:(_path,draw)=>draw({entries:[{},{}],goal:{kcal:1000},totals:{kcal:250,protein_g:20},targets:{protein_target:110},unknown_nutrients:{protein_g:1}}),
  syncCheckinPrimary:()=>{},$:()=>({}),svg:()=>'',describeSheet:()=>{}};
vm.createContext(card);vm.runInContext(`${cardSource};globalThis.renderCard=(box)=>todayFoodCard(box)`,card);
const box={isConnected:true,closest:()=>null,innerHTML:''};
card.renderCard(box);
assert.match(box.innerHTML,/Target 110 g · values missing/);assert.doesNotMatch(box.innerHTML,/incomplete/);
console.log('thread nutrition: known/unknown totals and Today card missing-value wording PASS');
