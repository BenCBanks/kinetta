// Exercise the real home-food renderer and its logging handlers with fictional days.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),calls=[];const node=()=>({onclick:null});
for(const id of ['#tf-add','#tf-yesterday'])nodes.set(id,node());
const buttons=['describe','snap','scan','usual'].map(homeFood=>({dataset:{homeFood},onclick:null}));
const file={setAttribute(){},click(){calls.push('camera')}};
const context={console,Date,Math,Number,Object,App:{},r0:String,esc:String,svg:()=>'',U:{dist:v=>v/1000,du:()=> 'km'},
 guessMeal:()=> 'lunch',MEAL_NAMES:{breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks'},MACROS:[['protein_g','Protein'],['carbs_g','Carbs'],['fat_g','Fat']],
 $:s=>s==='#ql-file'?file:nodes.get(s),$$:()=>buttons,Native:{haptic(){}},aiCan:()=>true,
 addSheet:(...a)=>calls.push(['usual',...a]),describeSheet:(...a)=>calls.push(['describe',...a]),scanSheet:(...a)=>calls.push(['scan',...a.slice(0,2)]),load:(p,draw)=>draw(context.day)};
vm.createContext(context);const source=fs.readFileSync('app/static/food.js','utf8');vm.runInContext(source.slice(source.indexOf('const homeCalories'),source.indexOf('function yesterdayMeal')),context);
const box={isConnected:true,innerHTML:''};
context.day={day:'2026-10-17',entries:[],totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},goal:{},burned:{items:[]}};
context.todayFoodCard(box);assert.match(box.innerHTML,/Start with something you ate/);assert.match(box.innerHTML,/Set a goal/);assert.doesNotMatch(box.innerHTML,/hero-num|Macros eaten|kcal burned/);
nodes.get('#tf-add').onclick();assert.deepEqual(calls.pop(),['describe','2026-10-17','lunch']);
buttons[1].onclick();assert.equal(calls.pop(),'camera');assert.deepEqual(calls.pop(),['describe','2026-10-17','lunch']);
buttons[2].onclick();assert.deepEqual(calls.pop(),['scan','2026-10-17','lunch']);buttons[3].onclick();assert.deepEqual(calls.pop(),['usual','2026-10-17','lunch']);
context.day={...context.day,entries:[{meal:'breakfast'}],totals:{kcal:431,protein_g:25,carbs_g:54,fat_g:13},goal:{kcal:2000},targets:{protein_target:120},burned:{items:[{id:42,name:'Morning run',sport:'run',distance_m:5200,kcal:541,estimated:true}]}};
context.todayFoodCard(box);assert.match(box.innerHTML,/Calories left/);assert.match(box.innerHTML,/1?570|1570/);assert.match(box.innerHTML,/home-macro-bar/);assert.match(box.innerHTML,/25 g \/ 120 g/);assert.match(box.innerHTML,/activity\/42/);assert.match(box.innerHTML,/540 kcal burned · estimated/);
box.isConnected=false;box.innerHTML='left';context.todayFoodCard(box);assert.equal(box.innerHTML,'left');
console.log('home food: useful empty state, totals, macros, direct describe/camera/scan/usual meal and day, workout link, detached-view guard PASS');

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
 const b={isConnected:true,innerHTML:''},save={disabled:false};
 const c={readOwner:()=>owner,skel:()=>'',esc:String,MEAL_NAMES:{lunch:'Lunch'},addDays:()=> '2026-10-16',fmtAmount:()=> '1 serving',
  sheet:(title,html,fn)=>{callback=fn(b,()=>closed++)},$:()=>save,Native:{haptic(){}},refresh(){},toast:(text,fn)=>{if(fn)undo=fn},
  api:async(path,options)=>{if(options){writes++;return {}}return {entries:[{meal:'lunch',name:'Fictional soup',amount:1,unit:'serving',kcal:400,sodium_mg:425,sugar_g:0,saturated_fat_g:null,source:'quick'}]}},
  addEntries:async items=>{writes++;assert.equal(items[0].day,'2026-10-17');assert.equal(items[0].meal,'lunch');assert.equal(items[0].sodium_mg,425);assert.equal(items[0].sugar_g,0);assert.equal(items[0].saturated_fat_g,null);return {ids:[42]}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function yesterdayMeal'),source.indexOf('// nutrition for an amount')),c);
 c.yesterdayMeal('2026-10-17','lunch');await Promise.resolve();assert.match(b.innerHTML,/Fictional soup/);assert.equal(writes,0,'preview does not log');
 await save.onclick({currentTarget:save});assert.equal(writes,1);assert.equal(closed,1);assert.equal(typeof undo,'function');
 owner='two';await undo();assert.equal(writes,1,'Undo cannot act after switching account');owner='one';await undo();assert.equal(writes,2);
 await undo();assert.equal(writes,2,'Undo cannot delete twice');console.log('yesterday meal: preview before explicit save, correct day/meal, account guard and one-time Undo PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
