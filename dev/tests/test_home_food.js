// Keep legacy todayFoodCard coverage (unused by pages.js) and verify the extracted eager helpers with fictional data.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),calls=[];const node=()=>({onclick:null,classList:{toggle(){}}});
nodes.set('#tf-add',node());
const context={console,Date,Math,Number,Object,URLSearchParams,App:{me:{},mealHours:null},tz:()=> 'UTC',imp:()=>false,esc:String,svg:()=>'',stat:(l,v,u)=>`<span>${l} ${v}${u?' '+u:''}</span>`,
 MEAL_NAMES:{breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks'},
 $:s=>s==='#tf-add'?nodes.get(s):null,$$:()=>[],go:path=>calls.push(['go',path]),readOwner:()=> 'fictional-owner',skel:()=>'',load:(p,draw)=>draw(p==='/api/food/check-in'?context.checkinData:context.day)};
vm.createContext(context);const source=fs.readFileSync('app/static/food.js','utf8'),homeSource=fs.readFileSync('app/static/food-home.js','utf8');
vm.runInContext(homeSource,context);vm.runInContext(source.match(/const MACROS = .*;/)[0],context);vm.runInContext(source.match(/^const recipeCalories = .*;$/m)[0],context);
vm.runInContext(source.slice(source.indexOf('function todayFoodCard'),source.indexOf('function chooseYesterday')),context);
const box={isConnected:true,innerHTML:'old'};let foodUser;
// Not using food tracking: Me shows no food at all, not even an invitation.
context.day={day:'2026-10-17',food_user:false,has_history:true,entries:[],totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},goal:{},burned:{items:[]}};
context.todayFoodCard(box,{onFoodUser:v=>foodUser=v});assert.equal(box.innerHTML,'');assert.equal(foodUser,false);assert.equal(context.App.me.food_user,false);
// A food tracker with a goal but nothing logged today: still no food on Me (owner 2026-10-18), though Progress keeps food.
context.day={...context.day,food_user:true,goal:{kcal:2000},targets:{protein_target:120}};
box.innerHTML='old';context.todayFoodCard(box,{onFoodUser:v=>foodUser=v});assert.equal(box.innerHTML,'');assert.equal(foodUser,false);assert.equal(context.App.me.food_user,true);
// Something logged today: compact numbers and one Log food button.
context.day={...context.day,entries:[{meal:'breakfast'}],totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0}};
context.todayFoodCard(box,{onFoodUser:v=>{foodUser=v;assert.match(box.innerHTML,/Food today/,'day visibility is notified only after the card is mounted');assert.equal(typeof nodes.get('#tf-add').onclick,'function','logging is wired before notifying the parent');}});assert.equal(foodUser,true);assert.match(box.innerHTML,/Food today/);assert.match(box.innerHTML.replace(/[\u00a0\u202f,]/g,''),/Left 2000 kcal/);assert.match(box.innerHTML,/m-protein_g/);assert.match(box.innerHTML,/>Protein<\/small>/);assert.match(box.innerHTML,/>of 120 g<\/span>/);assert.match(box.innerHTML,/aria-valuenow="0"/);
assert.equal((box.innerHTML.match(/<button/g)||[]).length,1,'one logging button on Me');assert.doesNotMatch(box.innerHTML,/Describe|Snap|Scan|Usual|Same as yesterday|kcal burned/);
nodes.get('#tf-add').onclick();assert.deepEqual(calls.pop(),['go','/food/describe'],'generic Add food chooses the device-local destination');
context.day={...context.day,entries:[{meal:'breakfast'}],totals:{kcal:2431,protein_g:25,carbs_g:54,fat_g:13}};
context.todayFoodCard(box);assert.match(box.innerHTML.replace(/[\u00a0\u202f,]/g,''),/Eaten 2430 kcal/);assert.match(box.innerHTML,/Over 430 kcal/);assert.match(box.innerHTML,/gbar over/);
// Food logged today counts even before the server flag catches up; no goal shows "not set" quietly.
context.day={...context.day,food_user:false,goal:{},unknown_nutrients:{protein_g:1},entries:[{meal:'lunch',pending:true}]};
context.todayFoodCard(box);assert.match(box.innerHTML,/Goal not set/);assert.match(box.innerHTML,/>Unknown<\/b>/);assert(!box.innerHTML.includes('role="progressbar"'),'no invented calorie goal or fill');assert.match(box.innerHTML,/waiting to send/);
context.day={...context.day,goal:{kcal:2000},unknown_nutrients:{},totals:{kcal:500,protein_g:25,carbs_g:54,fat_g:13}};context.todayFoodCard(box);assert.match(box.innerHTML,/data-w="0.250"/);for(const k of ['protein_g','carbs_g','fat_g'])assert(box.innerHTML.includes('m-'+k));
box.isConnected=false;box.innerHTML='left';context.todayFoodCard(box);assert.equal(box.innerHTML,'left');
console.log('legacy todayFoodCard: hidden until logged, compact one-action/over/unknown/pending states and detached-view guard PASS');

// The extracted eager helpers preserve the same global names used by Pages, Cook, Kit and Thread.
assert.equal(vm.runInContext("homeCalories(2431)",context),2430);
assert.equal(vm.runInContext("addDays('2026-10-17',1)",context),'2026-10-18');
assert.equal(vm.runInContext("isoDay(new Date('2026-10-18T02:00:00Z'),'America/Los_Angeles')",context),new Date('2026-10-18T02:00:00Z').toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'}));
assert.equal(vm.runInContext("recipeCalories(null)",context),'Unknown');
assert.equal(vm.runInContext("recipeCalories(2431)",context),vm.runInContext("r0(homeCalories(2431))",context));
vm.runInContext("describeSheet('2026-10-17','lunch','photo')",context);
assert.deepEqual(calls.pop(),['go','/food/describe?d=2026-10-17&meal=lunch&tool=photo']);
const pages=fs.readFileSync('app/static/pages.js','utf8'),thread=fs.readFileSync('app/static/thread.js','utf8');
assert.match(pages,/weeklyCheckinCard\(/);assert.match(pages,/describeSheet\(day,guessMeal\(\)\)/);assert.match(pages,/shrinkPhoto\(f, 1024\)/);assert.match(pages,/homeCalories\(/);assert.match(pages,/dayLabel\(/);
assert.match(fs.readFileSync('app/static/cook.js','utf8'),/recipeCalories\(/);
assert.match(fs.readFileSync('app/static/kit.js','utf8'),/\br0\(/);
assert.match(thread,/homeCalories\(/);assert.match(thread,/shrinkPhoto\(/);
assert.doesNotMatch(homeSource,/function todayFoodCard\(/,'unused todayFoodCard stays out of food-home.js');
const index=fs.readFileSync('app/static/index.html','utf8');
assert(index.indexOf('/static/food-home.js?v=__ASSET_HASH__')<index.indexOf('/static/thread.js?v=__ASSET_HASH__'),'shared Food helpers load before the eager FoodThread');
assert(!index.includes('/static/food.js?v=__ASSET_HASH__')&&!index.includes('/static/kit.js?v=__ASSET_HASH__'),'full Nutrition and Kit modules stay out of the initial script path');
console.log('Food home boundary: shared math/date globals, Cook/Kit/Pages callsites, describe route and eager script order PASS');

(async()=>{
 const page={dataset:{},closest(selector){return selector==='#page'?page:null;}};
 const checkinBox={isConnected:true,innerHTML:'',closest(selector){return selector==='#page'?page:null;}};
 const row={id:'fictional-weekly-checkin',week:'2026-10-12',updated:'2026-10-18T12:00:00Z',state:'pending',baseline:1,data:{avg_intake:1842,trend_kg_per_week:-0.3,requested_kg_per_week:0.3,goal:'lose_weight',observed_burn:2200,suggested_kcal:1900,floor_applied:false,logged_days:12,weigh_ins:3,weigh_in_span_days:14,estimated_burn:2100,unknown_calorie_days:1}};
 let ready=0;context.checkinBox=checkinBox;context.checkinData={current:row};context.weeklyReady=()=>ready++;
 await vm.runInContext("weeklyCheckinCard(checkinBox,{home:true,onReady:weeklyReady})",context);
 assert.equal(page.dataset.checkinPending,'true');assert.match(checkinBox.innerHTML,/Your weekly check-in/);assert.match(checkinBox.innerHTML,/Average calories logged/);assert.match(checkinBox.innerHTML,/Accept/);assert.match(checkinBox.innerHTML,/Not now/);assert.equal(ready,1);
 console.log('weekly check-in: fictional pending card, home action state and ready callback PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

// No real camera: both scanner engines reject like an unavailable browser camera.
(async()=>{
 const scanner=source.slice(source.indexOf('function scanSheet('),source.indexOf('// ---------- targets'));
 for(const detector of [false,true]){
  let finished,stopped=0;const b={isConnected:true},video={play:async()=>{throw Error('Not supported')}},msg={};
  const ZXing={BrowserMultiFormatReader:class {reset(){stopped++}async decodeFromVideoDevice(){throw Error('Not supported')}}};
  const c={window:detector?{BarcodeDetector:class{}}:{ZXing},ZXing,document:{body:{}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}},
   MutationObserver:class{observe(){}disconnect(){}},$:s=>({'#sc-v':video,'#sc-msg':msg,'#sc-f':{}}[s]),sheet:(title,html,fn)=>{finished=fn(b,()=>{})}};
  vm.createContext(c);vm.runInContext(scanner,c);c.scanSheet('2026-10-17','lunch');await finished;
  assert.match(msg.textContent,/Camera unavailable/);assert.equal(stopped,1,'camera is stopped on failed startup');
 }
 console.log('home scan: unavailable native/ZXing camera is caught; tracks stopped; typed fallback remains PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
 let callback,owner='one',writes=0,undo,closed=0;
 const uploadUndo=()=>{};
 const b={isConnected:true,innerHTML:''},save={disabled:false};
 const c={readOwner:()=>owner,skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',esc:String,newId:()=> 'fictional-upload',dayLabel:x=>x,MEAL_NAMES:{lunch:'Lunch'},addDays:()=> '2026-10-16',fmtAmount:()=> '1 serving',
  sheet:(title,html,fn)=>{callback=fn(b,()=>closed++)},$:()=>save,Native:{haptic(){}},refresh(){},toast:(text,fn)=>{if(fn)undo=fn},
  api:async(path,options)=>{if(options){writes++;return {}}return {entries:[{meal:'lunch',name:'Fictional soup',amount:1,unit:'serving',kcal:400,sodium_mg:425,sugar_g:0,saturated_fat_g:null,source:'quick'}]}},
  addEntries:async items=>{writes++;assert.equal(items[0].day,'2026-10-17');assert.equal(items[0].meal,'lunch');assert.equal(items[0].sodium_mg,425);assert.equal(items[0].sugar_g,0);assert.equal(items[0].saturated_fat_g,null);return {ids:[42],undo:uploadUndo}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function yesterdayMeal'),source.indexOf('// nutrition for an amount')),c);
 c.yesterdayMeal('2026-10-17','lunch');await Promise.resolve();assert.match(b.innerHTML,/Fictional soup/);assert.equal(writes,0,'preview does not log');
 await save.onclick({currentTarget:save});assert.equal(writes,1);assert.equal(closed,1);assert.equal(typeof undo,'function');
 assert.equal(undo,uploadUndo,'yesterday meal uses the shared durable upload Undo');console.log('yesterday meal: preview before explicit save, correct day/meal and shared durable Undo PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
