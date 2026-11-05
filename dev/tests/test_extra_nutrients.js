'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8');const c={esc:v=>String(v).replaceAll('<','&lt;'),r0:v=>String(Math.round(v)),r1:v=>String(Math.round(v*10)/10)};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('const EXTRA_NUTRIENTS'),source.indexOf('const deviceTimeZone')),c);
vm.runInContext(source.slice(source.indexOf('function scaleFood'),source.indexOf('// ---------- day page')),c);
const sample={per100:{kcal:200,protein_g:20,sodium_mg:400,sugar_g:0,saturated_fat_g:.0123}};
assert.equal(c.scaleFood(sample,50,'g').sodium_mg,200);assert.equal(c.scaleFood(sample,50,'g').sugar_g,0);assert.equal(c.scaleFood(sample,50,'g').saturated_fat_g,.0062);assert.equal(c.scaleFood(sample,50,'g').carbs_g,null);
assert.equal(c.nutrientNumber(null,'mg'),'Unknown');assert.equal(c.nutrientNumber(0,'g'),'0 g');assert.equal(c.nutrientNumber(.0123,'g'),'&lt;0.1 g');
const coverage=c.extraCoverage([{sodium_mg:400,sugar_g:0},{sodium_mg:null,sugar_g:null}],{sodium_target_mg:2000});assert.equal(coverage.sodium_mg.recorded,400);assert.equal(coverage.sodium_mg.unknown_count,1);assert.equal(coverage.sodium_mg.complete,false);assert.equal(coverage.sugar_g.recorded,0);assert.equal(coverage.saturated_fat_g.recorded,null);
assert.equal(c.extraCoverage([]).sugar_g.recorded,null);
const html=c.extraTotals(coverage);assert(html.includes('Some foods are missing values'));assert(html.includes('Your limit: 2000 mg'));assert(!html.includes('<details class="extra-nutrients" open'));assert(c.extraTotals(coverage,{period:true}).includes('Recorded totals across this date range.'));assert(!c.extraTotals(coverage,{period:true}).includes('Your limit:'));
assert(c.extraInputs({sugar_g:0}).includes('name="sugar_g" inputmode="decimal" value="0"'));assert(c.extraInputs({},true).includes('<summary>More targets</summary>'));assert(c.extraInputs({},true,'<label>Fiber</label>').includes('<div class="extra-fields"><label>Fiber</label>'));
const fake={elements:{namedItem:k=>({value:k==='sugar_g'?'0':k==='sodium_mg'?'':'.5'})}};assert.equal(c.extraFormValues(fake).sodium_mg,null);assert.equal(c.extraFormValues(fake).sugar_g,0);assert.equal(c.extraFormValues(fake).saturated_fat_g,.5);
assert.throws(()=>c.extraFormValues({elements:{namedItem:()=>({value:'Infinity'})}}));
console.log('Extra nutrient UI arithmetic: mg/g scaling, tiny values, zero vs unknown, partial coverage, folded detail, unset daily limits and separate range totals PASS');

const stored=c.foodStorage({kcal:200,protein_g:null,sodium_mg:0});assert.equal(stored.protein_g,0);assert.equal(stored.sodium_mg,0);assert.equal(stored.sugar_g,null);assert(stored.ref.unknown_nutrients.includes('protein_g'));assert(!stored.ref.unknown_nutrients.includes('sodium_mg'));assert.throws(()=>c.foodStorage({kcal:null}));

assert(c.foodStorage({kcal:10,ref:{unknown_nutrients:['future_nutrient']}}).ref.unknown_nutrients.includes('future_nutrient'));

// Render the actual final review: storage placeholders for unknown macros must
// not become a reassuring zero, including mixed foods and a recipe portion.
vm.runInContext(source.slice(source.indexOf('const MACROS'),source.indexOf('const EXTRA_NUTRIENTS')),c);
vm.runInContext(fs.readFileSync('app/static/food-nutrition.js','utf8'),c);
Object.assign(c,{readOwner:()=> 'fixture',newId:()=> 'fixture-review',json:(method,body)=>({method,body}),guessMeal:()=> 'lunch',MEAL_NAMES:{lunch:'Lunch'},svg:()=>'',homeCalories:Math.round,fmtAmount:()=> '1 serving',FoodThread:{source:()=> 'Your numbers'},guardFoodSheet(){},$$:()=>[]});
vm.runInContext(fs.readFileSync('app/static/food-review.js','utf8')+'\nglobalThis.review=FoodReview;',c);
async function finalReview(foods,portion=false){
 const nodes=new Map(),elements=[];
 for(const key of ['save_recipe','log_today','basis','amount_kind','name','servings','total_g','portion','meal']){
  const control={value:'',checked:false,addEventListener(){}};elements.push(control);elements[key]=control;
 }
 elements.save_recipe.checked=portion;elements.log_today.checked=true;elements.meal.value='lunch';elements.basis.value='servings';elements.servings.value='2';elements.portion.value='1';elements.amount_kind.value=portion?'portion':'whole';
 nodes.set('#food-final-review',{elements});c.$=selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);};
 c.sheet=(title,html,mount)=>mount({isConnected:true},()=>{});c.api=async()=>({id:1,review:{foods}});
 await c.review.open({messages:[1],draftId:'fixture',active:()=>true,accept(){}});
 return {summary:nodes.get('#review-totals').innerHTML,foods:nodes.get('#review-foods').innerHTML,portion:nodes.get('#review-portion-nutrition').innerHTML};
}
(async()=>{
 const unknown={name:'Fictional snack',kcal:120,protein_g:0,carbs_g:0,fat_g:0,ref:{unknown_nutrients:['protein_g','carbs_g','fat_g']}};
 let view=await finalReview([unknown]);assert.match(view.summary,/protein unknown/);assert.match(view.summary,/carbs unknown/);assert.match(view.summary,/fat unknown/);assert.doesNotMatch(view.summary,/0 g (protein|carbs|fat)/);
 const known={name:'Fictional drink',kcal:20,protein_g:0,carbs_g:5,fat_g:0};view=await finalReview([known]);assert.match(view.summary,/0 g protein/);assert.match(view.summary,/5 g carbs/);assert.match(view.summary,/0 g fat/);
 view=await finalReview([known,unknown]);assert.match(view.summary,/protein unknown/);assert.doesNotMatch(view.summary,/5 g carbs/,'a known subtotal is not the whole review');
 view=await finalReview([unknown],true);assert.equal((view.portion.match(/Unknown/g)||[]).length,3,'recipe portion preserves unknown macros');assert.match(view.portion,/>60<\/b>/,'known calories still scale to half the recipe');
 const unknownKcal={name:'Fictional unmeasured snack',kcal:null,protein_g:1,carbs_g:2,fat_g:3,ref:{unknown_nutrients:['kcal']}};
 view=await finalReview([unknownKcal]);assert.match(view.summary,/>Incomplete</,'unknown calories are not presented as zero');assert.match(view.foods,/aria-label="Add calories for Fictional unmeasured snack"/);assert.match(view.foods,/>Add<small> kcal/);
 view=await finalReview([{name:'Fictional invalid snack',kcal:'Infinity',protein_g:1,carbs_g:2,fat_g:3}]);assert.match(view.summary,/>Incomplete</,'non-finite calories stay incomplete');
 view=await finalReview([{name:'Fictional zero snack',kcal:0,protein_g:0,carbs_g:0,fat_g:0}]);assert.match(view.summary,/≈ 0 kcal/,'a known zero remains a real zero');
 console.log('Final food review: explicit unknown macros, true zero preserved, mixed-food totals and recipe portions use source coverage PASS');
})().then(()=>delayedPrepareChecks()).catch(error=>{console.error(error);process.exitCode=1});

async function delayedPrepareChecks(){
 let owner='fixture',release,request=null,sheetTitle=null,confirms=0,current=true;const gate=new Promise(resolve=>release=resolve);
 c.readOwner=()=>owner;c.json=(method,body)=>({method,body});c.newId=()=>'delayed-review';c.dispatchEvent=()=>{};c.CustomEvent=function(){};c.App??={};c.App.cache={delete(){}};c.invalidate=()=>{};c.toast=()=>{};c.isoDay=()=> '2026-11-05';
 c.sendOrQueue=async()=>{confirms++;return {queued:true};};c.sheet=(title)=>{sheetTitle=title;};
 c.api=(path,body)=>{request={path,...body};return gate;};
 const source={name:'Fictional tap snapshot',brand:null,amount:1,unit:'serving',kcal:100,protein_g:2,carbs_g:3,fat_g:4,ref:{}};
 const expected=[source],messages=[44],selection=[{message:44,parts:[0]}];
 const pending=c.review.open({messages,selection,expectedFoods:expected,quickConfirm:true,draftId:'draft-before',meal:'lunch',day:'2026-11-05',session:'fixture',current:()=>current,active:()=>true,accept(){}});
 source.kcal=200;messages[0]=45;selection[0].parts[0]=1;
 const prepared={...source};release({id:7,review:{foods:[prepared]}});await pending;
 assert.equal(JSON.stringify(request.body),JSON.stringify({client_id:'delayed-review',draft_id:'draft-before',messages:[44],selection:[{message:44,parts:[0]}]}),'prepare uses the tap-time draft, source IDs and part IDs');
 assert.equal(confirms,0,'an edit during prepare cannot redefine the original tap snapshot');assert.equal(sheetTitle,'Add to log','mismatched tap-time food opens Edit for review');
 for(const invalid of [
  {name:'Fictional unknown-calorie food',amount:1,unit:'serving',kcal:null,protein_g:1,carbs_g:2,fat_g:3,ref:{unknown_nutrients:['kcal']}},
  {name:'Fictional non-finite food',amount:1,unit:'serving',kcal:'Infinity',protein_g:1,carbs_g:2,fat_g:3,ref:{}}
 ]){
  let shown=null;c.sheet=title=>{shown=title;};c.api=async()=>({id:8,review:{foods:[invalid]}});const before=confirms;
  await c.review.open({messages:[44],selection:[{message:44,parts:[0]}],expectedFoods:[{...invalid}],quickConfirm:true,draftId:'draft-before',meal:'lunch',day:'2026-11-05',session:'fixture',current:()=>true,active:()=>true,accept(){}});
  assert.equal(confirms,before,'missing/non-finite calories never use quick Add');assert.equal(shown,'Add to log','incomplete quick Add opens the editable review path');
 }
 for(const mode of ['draft','session']){
  let done;const wait=new Promise(resolve=>done=resolve);let shown=null,confirmBefore=confirms;owner='fixture';current=true;c.sheet=title=>{shown=title;};c.api=()=>wait;
  const call=c.review.open({messages:[55],selection:[{message:55,parts:[0]}],expectedFoods:[{...source,kcal:200}],quickConfirm:true,draftId:'draft-before',meal:'lunch',day:'2026-11-05',session:'fixture',current:()=>current,active:()=>true,accept(){}});
  if(mode==='draft')current=false;else owner='different-session';
  done({id:8,review:{foods:[{...source,kcal:200}]}});await call;
  assert.equal(shown,null,`stale ${mode} completion cannot open a review`);assert.equal(confirms,confirmBefore,`stale ${mode} completion cannot confirm`);
 }
 console.log('Food review prepare guard: delayed edit keeps tap-time snapshot; stale draft/session completions are discarded PASS');
}
