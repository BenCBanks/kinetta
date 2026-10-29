// The real profile renderer accepts presentation choices without rendering private/unknown fields.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={structuredClone,esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),stat:(key,value)=>`[${key}:${value}]`,U:{dist:n=>n/1000,du:()=> 'km'},dur:n=>n+'s',fdate:s=>s,SPORT_NAMES:{run:'Run',ride:'Ride'},postCard:a=>`<article>${a.name}</article>`};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/profile.js','utf8')+'\nglobalThis.layout=ProfileLayout;',c);
const r={overview:{activities:5,distance_m:10000,time_s:3600,active_days:3},recent:{start:'2026-10-01',end:'2026-10-30',current:{activities:2,distance_m:5000,time_s:1800,active_days:2},previous:{activities:1}},sports:[{sport:'run',activities:3,distance_m:7000},{sport:'ride',activities:2,distance_m:3000}],items:[{name:'Shared fixture'}],weight_kg:'PRIVATE',food:'PRIVATE',kit:'PRIVATE'};
let html=c.layout.content(r,{sections:['sports','activities','totals'],stats:['active_days'],sports:['ride']});
assert(html.indexOf('<h2>Sports')<html.indexOf('Shared activities'));assert(html.indexOf('Shared activities')<html.indexOf('All-time shared progress'));
assert(!html.includes('Last 30 days')&&!html.includes('data-profile-mileage'));assert(!html.includes('<b>Run</b>'));assert(html.includes('[Active days:3]'));assert(!html.includes('[Distance:')&&!html.includes('PRIVATE'));
assert.equal(c.layout.content(r,{sections:[],stats:['time'],sports:[]}),'','identity-only layout is valid');
html=c.layout.content({...r,overview:{activities:0},sports:[],items:[],mine:true});assert(html.includes('No shared activities yet'));assert(!html.includes('data-profile-mileage')&&!html.includes('[Activities:0]'));
assert.deepEqual(JSON.parse(JSON.stringify(c.layout.normalize({sections:['food','recent','recent'],stats:['private'],sports:['unknown','run','run']}))),{sections:['recent'],stats:['activities','distance','time'],sports:['run']});
console.log('Profile presentation: section order/visibility, selected stats/sports, no private or unknown fields, empty profiles and upgraded defaults PASS');
