// Execute the actual presentation boundary with fictional own records; no browser, model or device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/milestones.js','utf8');let owner='fictional-owner',captured,resolve;
const context={URLSearchParams,AbortController,setTimeout,clearTimeout,Intl,Date,Math,Symbol,console,App:{me:{units:'metric',login:'fictional_login',name:'PRIVATE REAL NAME'}},SPORT_NAMES:{run:'Run'},readOwner:()=>owner,route:()=>{},dur:n=>String(n)+' seconds',ShareArt:{simplePicture:async options=>(captured=options)},api:async()=>({items:[]})};
vm.createContext(context);vm.runInContext(source+'\nglobalThis.subject=Milestones;',context);
(async()=>{
 const M=context.subject;
 const food={kind:'food_days',title:'Logged food on 7 days',day:'2026-10-28',details:{amount:7,calories:9999,weight:123,private_note:'PRIVATE NOTE',garmin_sources:[]}};
 await M.picture(food);assert.equal(captured.value,'7');assert.equal(captured.identity,false);assert(!JSON.stringify(captured).includes('PRIVATE'));assert(!JSON.stringify(captured).includes('9999'));assert(!JSON.stringify(captured).includes('streak'));
 const year={...food,kind:'year_distance',details:{amount:250,unit:'mi',garmin_sources:['Garmin Forerunner 965']}};await M.picture(year,true);assert.equal(captured.unit,'mi');assert.equal(captured.identity,true);assert.deepEqual(Array.from(captured.sources),['Garmin Forerunner 965']);
 const activity={...food,kind:'first_distance',details:{distance_m:10000,seconds:3600,sport:'run'}};await M.picture(activity);assert.equal(captured.value,'10.0');assert.equal(captured.unit,'km');context.App.me.units='imperial';await M.picture(activity);assert.equal(captured.value,'6.2');assert.equal(captured.unit,'mi');
 const unknown={...activity,details:{distance_m:null,seconds:null,sport:'run'}};await M.picture(unknown);assert.equal(captured.value,'Run');assert.equal(captured.unit,'');assert.equal(captured.facts.length,0);
 let path;context.api=async url=>{path=url;return {items:[food]}};assert.equal((await M.read({activity_id:13})).items.length,1);assert.equal(path,'/api/milestones?activity_id=13');
 context.api=()=>new Promise(ok=>resolve=ok);const pending=M.read();owner='another-account';resolve({items:[food]});await assert.rejects(pending,/account changed/);
 console.log('Milestones: actual picture boundary, fixed counts, unknowns, units, safe credits, identity off and late account isolation PASS');
})().catch(e=>{console.error(e);process.exit(1)});
