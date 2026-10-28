// Execute the actual picture boundary. Another participant's detail must never enter a shared picture.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let captured,owner='fictional-owner';const ctx={Intl,Date,Math,JSON,Number,URLSearchParams,route(){},readOwner:()=>owner,SPORT_NAMES:{walk:'Walk',run:'Run'},ShareArt:{simplePicture:async options=>(captured=options)}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/challenges.js','utf8')+'\nthis.subject=Challenges;',ctx);
(async()=>{
 assert.equal(ctx.subject.number(.04,'km'),'0.04','A small remaining distance must not say zero to go');
 const data={code:'fictional',title:'November distance:80km',kind:'distance',target:80,unit:'km',sports:['walk','run'],start:'2026-11-01',end:'2026-11-30',url:'https://example.test/challenge/fictional',self:{value:41,manual:true,complete:false,finished:true,garmin_sources:['Garmin Forerunner 965']},people:[{username:'PRIVATE_OTHER_USERNAME',value:99999,protein_target:123}],food:'PRIVATE MEAL',weight:123};
 await ctx.subject.picture(data);assert.equal(captured.identity,false);assert.equal(captured.value,'80');assert.equal(captured.qrLink,data.url);assert.equal(captured.sources.length,0);assert(!JSON.stringify(captured).includes('PRIVATE'));assert(!JSON.stringify(captured).includes('99999'));
 await ctx.subject.picture(data,true);assert.equal(captured.value,'41 / 80');assert.equal(captured.qrLink,null);assert.equal(captured.identity,false);assert.deepEqual(Array.from(captured.sources),['Garmin Forerunner 965']);assert(captured.facts.includes('Includes manual entries'));assert(!JSON.stringify(captured).includes('PRIVATE'));
 await ctx.subject.picture({...data,kind:'food_days',unit:'days',target:20,self:{value:7,garmin_sources:[],manual:false,finished:true}},true,true);assert.equal(captured.value,'7 / 20');assert.equal(captured.unit,'days');assert.equal(captured.identity,true);assert(!JSON.stringify(captured).includes('protein_target'));assert(!JSON.stringify(captured).includes('weight'));
 console.log('Challenge invitation and incomplete/food finish pictures: only chosen target or own aggregate, QR link, safe credits, identity off and no participant details PASS');
})().catch(error=>{console.error(error);process.exit(1)});
