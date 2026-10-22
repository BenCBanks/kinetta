// Exercise the real Me food card (activity-first home, #164) with fictional days.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),calls=[];const node=()=>({onclick:null});
nodes.set('#tf-add',node());
const context={console,Date,Math,Number,Object,App:{me:{}},r0:v=>String(Math.round(v)),esc:String,svg:()=>'',stat:(l,v,u)=>`<span>${l} ${v}${u?' '+u:''}</span>`,
 guessMeal:()=> 'lunch',MEAL_NAMES:{breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks'},
 $:s=>nodes.get(s),$$:()=>[],describeSheet:(...a)=>calls.push(['describe',...a]),load:(p,draw)=>draw(context.day)};
vm.createContext(context);const source=fs.readFileSync('app/static/food.js','utf8');vm.runInContext(source.match(/const MACROS = .*;/)[0],context);vm.runInContext(source.slice(source.indexOf('const homeCalories'),source.indexOf('function yesterdayMeal')),context);
const box={isConnected:true,innerHTML:'old'};let foodUser;
// Not using food tracking: Me shows no food at all, not even an invitation.
context.day={day:'2026-10-17',food_user:false,has_history:true,entries:[],totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},goal:{},burned:{items:[]}};
context.todayFoodCard(box,{onFoodUser:v=>foodUser=v});assert.equal(box.innerHTML,'');assert.equal(foodUser,false);assert.equal(context.App.me.food_user,false);
// A food tracker with a goal but nothing logged today: still no food on Me (owner 2026-10-18), though Progress keeps food.
context.day={...context.day,food_user:true,goal:{kcal:2000},targets:{protein_target:120}};
box.innerHTML='old';context.todayFoodCard(box,{onFoodUser:v=>foodUser=v});assert.equal(box.innerHTML,'');assert.equal(foodUser,false);assert.equal(context.App.me.food_user,true);
// Something logged today: compact numbers and one Log food button.
context.day={...context.day,entries:[{meal:'breakfast'}],totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0}};
context.todayFoodCard(box,{onFoodUser:v=>{foodUser=v;assert.match(box.innerHTML,/Food today/,'day visibility is notified only after the card is mounted');assert.equal(typeof nodes.get('#tf-add').onclick,'function','logging is wired before notifying the parent');}});assert.equal(foodUser,true);assert.match(box.innerHTML,/Food today/);assert.match(box.innerHTML,/Left 2000 kcal/);assert.match(box.innerHTML,/m-protein_g/);assert.match(box.innerHTML,/>Protein<\/small>/);assert.match(box.innerHTML,/>of 120 g<\/span>/);assert.match(box.innerHTML,/aria-valuenow="0"/);
assert.equal((box.innerHTML.match(/<button/g)||[]).length,1,'one logging button on Me');assert.doesNotMatch(box.innerHTML,/Describe|Snap|Scan|Usual|Same as yesterday|kcal burned/);
nodes.get('#tf-add').onclick();assert.deepEqual(calls.pop(),['describe','2026-10-17',null]);
context.day={...context.day,entries:[{meal:'breakfast'}],totals:{kcal:2431,protein_g:25,carbs_g:54,fat_g:13}};
context.todayFoodCard(box);assert.match(box.innerHTML,/Eaten 2430 kcal/);assert.match(box.innerHTML,/Over 430 kcal/);assert.match(box.innerHTML,/gbar over/);
// Food logged today counts even before the server flag catches up; no goal shows "not set" quietly.
context.day={...context.day,food_user:false,goal:{},unknown_nutrients:{protein_g:1},entries:[{meal:'lunch',pending:true}]};
context.todayFoodCard(box);assert.match(box.innerHTML,/Goal not set/);assert.match(box.innerHTML,/>Unknown<\/b>/);assert(!box.innerHTML.includes('role="progressbar"'),'no invented calorie goal or fill');assert.match(box.innerHTML,/waiting to send/);
context.day={...context.day,goal:{kcal:2000},unknown_nutrients:{},totals:{kcal:500,protein_g:25,carbs_g:54,fat_g:13}};context.todayFoodCard(box);assert.match(box.innerHTML,/data-w="0.250"/);for(const k of ['protein_g','carbs_g','fat_g'])assert(box.innerHTML.includes('m-'+k));
box.isConnected=false;box.innerHTML='left';context.todayFoodCard(box);assert.equal(box.innerHTML,'left');
console.log('home food: hidden until something is logged today, compact card with one Log food action, over/unknown/pending states, detached-view guard PASS');

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
 const c={readOwner:()=>owner,skel:()=>'',esc:String,MEAL_NAMES:{lunch:'Lunch'},addDays:()=> '2026-10-16',fmtAmount:()=> '1 serving',
  sheet:(title,html,fn)=>{callback=fn(b,()=>closed++)},$:()=>save,Native:{haptic(){}},refresh(){},toast:(text,fn)=>{if(fn)undo=fn},
  api:async(path,options)=>{if(options){writes++;return {}}return {entries:[{meal:'lunch',name:'Fictional soup',amount:1,unit:'serving',kcal:400,sodium_mg:425,sugar_g:0,saturated_fat_g:null,source:'quick'}]}},
  addEntries:async items=>{writes++;assert.equal(items[0].day,'2026-10-17');assert.equal(items[0].meal,'lunch');assert.equal(items[0].sodium_mg,425);assert.equal(items[0].sugar_g,0);assert.equal(items[0].saturated_fat_g,null);return {ids:[42],undo:uploadUndo}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function yesterdayMeal'),source.indexOf('// nutrition for an amount')),c);
 c.yesterdayMeal('2026-10-17','lunch');await Promise.resolve();assert.match(b.innerHTML,/Fictional soup/);assert.equal(writes,0,'preview does not log');
 await save.onclick({currentTarget:save});assert.equal(writes,1);assert.equal(closed,1);assert.equal(typeof undo,'function');
 assert.equal(undo,uploadUndo,'yesterday meal uses the shared durable upload Undo');console.log('yesterday meal: preview before explicit save, correct day/meal and shared durable Undo PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
