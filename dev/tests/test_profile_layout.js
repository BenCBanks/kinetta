// The real profile renderer accepts presentation choices without rendering private/unknown fields.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={App:{me:{login:'zz_test_layout'}},profileHref:p=>'/people/'+p.login,structuredClone,esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),stat:(key,value)=>`[${key}:${value}]`,U:{dist:n=>n/1000,du:()=> 'km'},dur:n=>n+'s',fdate:s=>s,SPORT_NAMES:{run:'Run',ride:'Ride'},postCard:a=>`<article>${a.name}</article>`};
const source=fs.readFileSync('app/static/profile.js','utf8'),testSource=source.replace('  return {defaults,normalize,', '  globalThis.achievementUnits={catalog:value=>achievementCatalog=value,tier:achievementTierAt,threshold:achievementThresholdText,remaining:achievementRemainingText,fastestThreshold:fastestThresholdText,fastestNext:fastestNextText};\n  return {defaults,normalize,');
assert.notEqual(testSource,source,'the profile presentation test hook is installed');
vm.createContext(c);vm.runInContext(testSource+'\nglobalThis.layout=ProfileLayout;',c);
const r={overview:{activities:5,distance_m:10000,time_s:3600,active_days:3},recent:{start:'2026-10-01',end:'2026-10-30',current:{activities:2,distance_m:5000,time_s:1800,active_days:2},previous:{activities:1}},sports:[{sport:'run',activities:3,distance_m:7000},{sport:'ride',activities:2,distance_m:3000}],items:[{name:'Shared fixture'}],weight_kg:'PRIVATE',food:'PRIVATE',kit:'PRIVATE'};
let html=c.layout.content(r,{sections:['sports','activities','totals'],stats:['active_days'],sports:['ride']});
assert(html.indexOf('<h2>Sports')<html.indexOf('Shared activities'));assert(html.indexOf('Shared activities')<html.indexOf('All-time shared progress'));
assert(!html.includes('Last 30 days')&&!html.includes('data-profile-mileage'));assert(!html.includes('<b>Run</b>'));assert(html.includes('[Active days:3]'));assert(!html.includes('[Distance:')&&!html.includes('PRIVATE'));
assert.equal(c.layout.content(r,{sections:[],stats:['time'],sports:[]}),'','identity-only layout is valid');
html=c.layout.content({...r,overview:{activities:0},sports:[],items:[],mine:true});assert(html.includes('No shared activities yet'));assert(html.includes('href="/people/zz_test_layout"'),'empty shared profile chooses an activity in canonical owner history');assert(!html.includes('data-profile-mileage')&&!html.includes('[Activities:0]'));
assert.deepEqual(JSON.parse(JSON.stringify(c.layout.normalize({sections:['food','recent','recent'],stats:['private'],sports:['unknown','run','run']}))),{sections:['recent'],stats:['activities','distance','time'],sports:['run']});
const single=v=>JSON.parse(JSON.stringify(c.layout.singlePeriod(v))).sections;
assert.deepEqual(single({sections:['recent','sports','totals','mileage']}),['totals','sports','mileage'],'All time wins for legacy two-period layouts at the first numbers slot');
assert.deepEqual(single({sections:['recent','sports']}),['recent','sports'],'a Recent-only choice survives');
assert.deepEqual(single({sections:[]}),[],'hidden numbers remain hidden');assert.deepEqual(single({}),['totals','mileage','sports','activities'],'old defaults render All time without changing stored data');
console.log('Profile presentation: section order/visibility, selected stats/sports, no private or unknown fields, empty profiles and upgraded defaults PASS');

// Achievement distances use the account's selected unit, including fixed-kilometre named tiers.
const catalog=JSON.parse(fs.readFileSync('app/static/profile.achievement-levels.json','utf8'));
c.achievementUnits.catalog(catalog);
for(const units of ['metric','imperial']){
 c.App.me.units=units;
 for(const code of ['journey','sport:run','sport:ride','sport:walk-hike','sport:swim']){
  const track={code,value:0},definition=catalog.tracks[code];
  for(let rank=1;rank<=definition.levels.length+2;rank++){
   const tier=c.achievementUnits.tier(code,rank),unit=units==='metric'?'km':'mi';
   assert.equal(c.achievementUnits.threshold(track,tier).split(' ').at(-1),unit,`${units}: ${code} ${tier.name} follows account units`);
   assert.equal(c.achievementUnits.remaining(track,tier).split(' ').slice(-2).join(' '),unit+' left',`${units}: remaining distance follows account units`);
  }
 }
 const labels=units==='metric'?[['sport:run',1,'5K','5 km'],['sport:run',5,'50-mile ultra','80.5 km'],['sport:ride',3,'Metric century','100 km'],['sport:ride',4,'Century','160.9 km'],['sport:swim',1,'First mile','1.6 km'],['journey',2,'Ironman 70.3','113.1 km'],['sport:run',10,'1,000 miles ×2','3,218.7 km']]:[['sport:run',1,'5K','3.1 mi'],['sport:run',5,'50-mile ultra','50 mi'],['sport:ride',3,'Metric century','62.1 mi'],['sport:ride',4,'Century','100 mi'],['sport:swim',1,'First mile','1 mi'],['journey',2,'Ironman 70.3','70.3 mi'],['sport:run',10,'1,000 miles ×2','2,000 mi']];
 for(const [code,rank,name,label] of labels){
  const tier=c.achievementUnits.tier(code,rank);
  assert.equal(tier.name,name,`${units}: milestone names are stable`);
  assert.equal(c.achievementUnits.threshold({code},tier),label,`${units}: ${name} has one distance label`);
 }
}
console.log('Achievement milestone labels: metric races, mile-based tiers, stable names, remaining distances and repeats PASS');

for(const units of ['metric','imperial']){
 c.App.me.units=units;
 const ride={code:'sport:ride:fastest',best_seconds:{'6':3000}},swim={code:'sport:swim:fastest',best_seconds:{'9':1400}};
 const rideTier=c.achievementUnits.tier(ride.code,6),swimTier=c.achievementUnits.tier(swim.code,9);
 const rideLabel=units==='metric'?'20 km · ≤ 48:00':'12.4 mi · ≤ 48:00',swimLabel=units==='metric'?'1,500 m · ≤ 24:00':'1,640 yd · ≤ 24:00';
 assert.equal(c.achievementUnits.fastestThreshold(ride,rideTier),rideLabel,`${units}: Ride fastest uses the account distance unit`);
 assert.equal(c.achievementUnits.fastestThreshold(swim,swimTier),swimLabel,`${units}: Swim fastest uses metres or yards for the account`);
 assert.equal(c.achievementUnits.fastestNext(ride,rideTier),`Next: ${units==='metric'?'20 km':'12.4 mi'} under 48:00 · your best 50:00`,`${units}: Ride fastest next copy uses the converted distance`);
}
console.log('Fastest Ride/Swim labels: metric km/m and imperial mi/yd thresholds and next copy PASS');
