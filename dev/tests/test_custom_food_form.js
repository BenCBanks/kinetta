// Execute the real custom-food editor: blanks, zero, inference and invalid numbers differ.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8'),keys=['kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','sugar_g','saturated_fat_g'];
(async()=>{let form,markup,calls=[],notices=[],closed=false,deleteButton,confirmText='',confirmAnswer=true;
 const c={FOOD_NUTRIENTS:keys,readOwner:()=> 'fictional-owner',esc:String,r1:String,macroInputs:()=>'',extraFormValues:f=>Object.fromEntries(keys.slice(5).map(k=>[k,f[k].value.trim()===''?null:Number(f[k].value)])),guardFoodSheet(){},toast:m=>notices.push(m),json:(method,data)=>({method,data}),api:async(path,body)=>calls.push({path,...body}),confirm:m=>{confirmText=m;return confirmAnswer;},$:selector=>selector==='#fe'?form:selector==='#fe-del'?deleteButton:null,sheet:(_,html,mount)=>{markup=html;mount({},()=>{closed=true;});}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function foodEditor('),source.indexOf('// ---------- photo + description')),c);
 async function submit(values,food=null){calls=[];notices=[];closed=false;deleteButton={onclick:null};form=Object.fromEntries(['name','brand','barcode','serving_label','serving_g',...keys].map(k=>[k,{value:values[k]??''}]));form.name.value='Fictional entered food';form.favorite={checked:!!values.favorite};c.foodEditor(food);await form.onsubmit({preventDefault(){}});return calls[0]?.data;}
 let body=await submit({kcal:'107',favorite:true});assert.equal(body.kcal,107);for(const k of keys.filter(k=>k!=='kcal'))assert.equal(body[k],null);assert(body.favorite&&closed);
 body=await submit({kcal:'0',protein_g:'1',carbs_g:'2',fat_g:'3'});assert.equal(body.kcal,0,'explicit zero calories is not inferred');
 body=await submit({protein_g:'1,5',carbs_g:'2',fat_g:'3'});assert.equal(body.kcal,41);assert.equal(body.protein_g,1.5);
 body=await submit({protein_g:'0',carbs_g:'0',fat_g:'0'});assert.equal(body.kcal,0);
 for(const values of [{protein_g:'2'},{kcal:'bad'},{kcal:'107',protein_g:'12g'}]){assert.equal(await submit(values),undefined);assert(!closed&&notices.length,'invalid/incomplete values keep the form open');}
 const existing={id:42,name:'Fictional existing food',per_serving:{kcal:107,protein_g:null,carbs_g:null,fat_g:null}};
 body=await submit({kcal:'107',favorite:true},existing);assert.equal(calls[0].method,'PUT');assert.equal(calls[0].path,'/api/food/foods/42');assert.equal(body.protein_g,null);
 calls=[];notices=[];closed=false;confirmText='';confirmAnswer=false;deleteButton={};c.foodEditor(existing);await deleteButton.onclick();assert.match(confirmText,/Delete “Fictional existing food” from My foods\?/);assert.match(confirmText,/Food already in your food log will stay/);assert.equal(calls.length,0);assert(!closed,'cancel leaves the saved food editor open');
 confirmAnswer=true;await deleteButton.onclick();assert.equal(calls[0].path,'/api/food/foods/42');assert.equal(calls[0].method,'DELETE');assert(closed);assert.equal(notices.at(-1),'Saved food deleted.');
 console.log('Custom food form: unknown versus zero, calorie inference, numeric validation and editing/favourite PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
