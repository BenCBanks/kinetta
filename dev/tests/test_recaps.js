'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const texts=[],ctx={font:'',measureText:t=>({width:String(t).length*(+(/ (\d+)px/.exec(ctx.font)||[])[1]||24)/2}),fillText(t,x,y){assert(x>=0&&x<=1080&&y>=0&&y<=1350,'text stays in picture');texts.push(String(t));}};
for(const k of ['fillRect','beginPath','arc','fill','stroke','moveTo','lineTo','roundRect','save','restore','clip','drawImage'])ctx[k]=()=>{};
const canvas=()=>({width:0,height:0,getContext:()=>ctx,toBlob:cb=>cb(new Blob(['fictional picture'],{type:'image/png'}))});
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-11-01T03:30:00Z']));}static now(){return new Date('2026-11-01T03:30:00Z').getTime();}}
const c={Date:Clock,Intl,Blob,File,URL,Map,Promise,setTimeout,clearTimeout,App:{me:{id:1,login:'zz_test_alex',name:'NEVER PRINT THIS REAL NAME',tz:'America/New_York'}},Native:{base:'',activityShareSupported:false},location:{origin:'https://example.test'},serverKey:()=> 'https://example.test',SPORT_NAMES:{run:'Run',workout:'Lifting',walk:'Walk'},dur:n=>n+' seconds',col:()=> '#ffffff',getComputedStyle:()=>({getPropertyValue:()=> 'system-ui'}),document:{documentElement:{},createElement:()=>canvas()},drawMark(){},navigator:{},store:{get(){return null;}},toast(){}};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/recaps.js','utf8')+'\nthis.recaps=Recaps;this.art=ShareArt;',c);
const base={period:'this_month',start:'2026-10-01',end:'2026-11-01',today:'2026-10-28',tz:'America/New_York',units:'imperial',activities:6,active_days:4,distance_m:16093.44,time_s:10800,top_sport:'run',days:[{day:'2026-10-05',activities:2},{day:'2026-10-07',activities:4}],highlights:[{kind:'longest',sport:'run',distance_m:5000},{kind:'record',label:'5K',elapsed_s:1491}],streak_weeks:4,food:{logged_days:26,protein_goal_days:18},garmin_sources:['Garmin Forerunner 965']};
const options={totals:true,calendar:true,highlights:true,streak:true,food:false,identity:false};
(async()=>{
 assert.equal(c.recaps.today(),'2026-10-31','civil day uses account timezone, not UTC');c.App.me.tz='Europe/London';assert.equal(c.recaps.today(),'2026-11-01');
 assert.equal(c.recaps.startFor('this_week','2026-11-01'),'2026-10-26');assert.equal(c.recaps.startFor('last_week','2026-11-01'),'2026-10-19');assert.equal(c.recaps.startFor('last_month','2026-01-03'),'2025-12-01');
 let s=c.recaps.summary(base,options);assert.equal(s.hero.value,'10.0');assert.equal(s.hero.label,'mi');assert(!s.alt.includes('Logged food'));assert(s.credits.includes('Garmin Forerunner 965'));
 s=c.recaps.summary({...base,units:'metric'},options);assert.equal(s.hero.value,'16.1');assert.equal(s.hero.label,'km');
 s=c.recaps.summary({...base,distance_m:0,top_sport:'workout'},options);assert.equal(s.hero.label,'of lifting');assert(!s.alt.includes('0.0'));
 await c.recaps.draw(base,{...options,food:true,identity:true});assert(texts.includes('Logged food 26 of 31 days'));assert(texts.includes('Met protein goal 18 days'));assert(texts.includes('@zz_test_alex'));assert(!texts.some(t=>/NEVER PRINT|kcal|calories|grams|weight|food streak/i.test(t)));
 texts.length=0;await c.recaps.draw({...base,period:'this_year',start:'2026-01-01',end:'2027-01-01',activities:99},options);assert(!texts.some(t=>t.includes('Logged food')));assert(texts.some(t=>t.includes('Garmin')));
 texts.length=0;await c.recaps.draw({...base,period:'this_week',start:'2026-10-26',end:'2026-11-02'},options);assert(texts.includes('Activity calendar'));
 s=c.recaps.summary({...base,activities:0,active_days:0,distance_m:0,time_s:0}, {...options,food:true});assert.equal(s.hero.label,'days with food logged','food-only recaps follow the monthly offer threshold without inventing activity');
 c.Native.activityShareSupported=true;c.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,AA==';this.onload();}};
 c.Native.shareActivityPicture=async()=>({cancelled:true});assert.equal(await c.art.deliver(new Blob(['x']),'recap.png',()=>true),false,'native cancellation is not recorded as shared');
 c.Native.shareActivityPicture=async()=>({handedOff:true});assert.equal(await c.art.deliver(new Blob(['x']),'recap.png',()=>true),true);
 assert.equal(await c.art.deliver(new Blob(['x']),'recap.png',()=>false),false,'changed account cannot hand off the previous picture');
 console.log('Recaps: timezone/DST/January boundaries, units, lifting/year/week/food-only pictures, selected food and username-only text, source credit and native cancel/account guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
