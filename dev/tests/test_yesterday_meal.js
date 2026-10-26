'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8');
function fixture(){
 let owner='A',calls=[],finish,closed=0,writes=[],id=0,fail=false;
 const box={isConnected:true,innerHTML:''},nodes=new Map();
 const node=s=>{if(!nodes.has(s))nodes.set(s,{disabled:false,textContent:''});return nodes.get(s)};
 const c={readOwner:()=>owner,skel:()=>'',esc:String,newId:()=> 'copy-'+(++id),dayLabel:x=>x,addDays:()=> '2026-10-16',MEAL_NAMES:{lunch:'Lunch'},fmtAmount:e=>e.amount+' '+e.unit,
  sheet:(title,html,fn)=>{assert.equal(title,'Same as yesterday');fn(box,()=>{closed++;box.isConnected=false})},$:node,Native:{haptic(){}},toast(){},addSheet:(...a)=>calls.push(a),
  api:path=>{calls.push(path);return new Promise((resolve,reject)=>finish={resolve,reject})},addEntries:async items=>{writes.push(JSON.parse(JSON.stringify(items)));if(fail)throw Error('Lost acknowledgement');return {queued:true,undo:()=>{}}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function yesterdayMeal'),source.indexOf('// nutrition for an amount')),c);
 return{c,box,node,calls,writes,reply:rows=>finish.resolve({entries:rows}),reject:()=>finish.reject(Error('offline')),owner:x=>owner=x,fail:x=>fail=x,closed:()=>closed};
}
const rows=[{meal:'lunch',name:'Fictional soup',amount:1,unit:'serving',kcal:400,sodium_mg:425,sugar_g:0,saturated_fat_g:null,source:'quick',ref:{unknown_nutrients:['saturated_fat_g']}},{meal:'dinner',name:'Other meal'},{meal:'lunch',name:'Pending food',pending:true}];
(async()=>{
 const f=fixture();f.c.yesterdayMeal('2026-10-17','lunch');f.reply(rows);await Promise.resolve();assert.equal(f.writes.length,0);assert.match(f.box.innerHTML,/2026-10-16.*2026-10-17/);assert.doesNotMatch(f.box.innerHTML,/Other meal|Pending food/);
 f.fail(true);await f.node('#ym-save').onclick({currentTarget:f.node('#ym-save')});assert.match(f.node('#ym-error').textContent,/ready to retry/);assert.equal(f.node('#ym-save').disabled,false);
 f.fail(false);await f.node('#ym-save').onclick({currentTarget:f.node('#ym-save')});assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.writes[0][0].day,'2026-10-17');assert.equal(f.writes[0][0].meal,'lunch');assert.equal(f.writes[0][0].sugar_g,0);assert.equal(f.writes[0][0].saturated_fat_g,null);assert.deepEqual(f.writes[0][0].ref,rows[0].ref);assert.equal(f.closed(),1);
 await f.node('#ym-save').onclick({currentTarget:f.node('#ym-save')});assert.equal(f.writes.length,2,'stale confirmation cannot duplicate the copy');
 const stale=fixture();stale.c.yesterdayMeal('2026-10-17','lunch');stale.reply(rows);await Promise.resolve();stale.owner('B');await stale.node('#ym-save').onclick({currentTarget:stale.node('#ym-save')});assert.equal(stale.writes.length,0);
 const late=fixture();late.c.yesterdayMeal('2026-10-17','lunch');late.owner('B');late.reply(rows);await Promise.resolve();assert.equal(late.box.innerHTML,'');
 const empty=fixture();empty.c.yesterdayMeal('2026-10-17','lunch');empty.reply([]);await Promise.resolve();assert.match(empty.box.innerHTML,/No foods/);empty.node('#ym-usual').onclick();assert.deepEqual(empty.calls.at(-1),['2026-10-17','lunch']);
 const failed=fixture();failed.c.yesterdayMeal('2026-10-17','lunch');failed.reject();await Promise.resolve();await Promise.resolve();assert.match(failed.box.innerHTML,/Try again/);assert.equal(failed.writes.length,0);
 console.log('Same as yesterday: explicit preview, captured dates/meal, unknown nutrients, stable retry IDs, queued Undo, no duplicate taps, late/account guards and empty/error states PASS');
})().catch(e=>{console.error(e);process.exit(1)});
