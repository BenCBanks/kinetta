// Delete confirmation, cancellation, retry and account-change boundaries without touching a real recipe.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/cook.js','utf8');
function fixture(){
 const buttons=Object.fromEntries(['#recipe-delete-cancel','#recipe-delete-confirm','#recipe-delete-error'].map(k=>[k,{disabled:false,hidden:true}])),body={isConnected:true},calls=[];
 const c={owner:'fictional-owner',readOwner:()=>c.owner,esc:x=>x,guardFoodSheet(){},App:{cache:new Map([['/api/dishes',1],['/api/dishes/7',1]])},$:k=>buttons[k],toast:m=>calls.push(['toast',m]),go:p=>calls.push(['go',p]),api:async(p,o)=>{calls.push(['api',p,o.method]);if(c.failure)throw c.failure;},sheet:(t,h,mount)=>{c.html=h;mount(body,()=>{body.isConnected=false;calls.push(['close']);});}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function deleteRecipe('),source.indexOf('\nfunction recipeKit(')),c);c.deleteRecipe({id:7,name:'Fictional recipe'});return{c,body,buttons,calls};
}
(async()=>{
 let f=fixture();f.buttons['#recipe-delete-cancel'].onclick();assert.equal(f.calls.filter(x=>x[0]==='api').length,0);assert.match(f.c.html,/Portions already logged stay/);
 f=fixture();await f.buttons['#recipe-delete-confirm'].onclick();assert.deepEqual(f.calls.find(x=>x[0]==='api'),['api','/api/dishes/7','DELETE']);assert.equal(f.c.App.cache.size,0);assert(f.calls.some(x=>x[0]==='go'&&x[1]==='/food/meals'));
 f=fixture();f.c.failure=Error('Try again');await f.buttons['#recipe-delete-confirm'].onclick();assert(!f.buttons['#recipe-delete-confirm'].disabled);assert(!f.buttons['#recipe-delete-error'].hidden);assert(f.body.isConnected);f.c.failure=null;await f.buttons['#recipe-delete-confirm'].onclick();assert.equal(f.calls.filter(x=>x[0]==='api').length,2);
 f=fixture();f.c.failure=Object.assign(Error('Gone'),{status:404});await f.buttons['#recipe-delete-confirm'].onclick();assert.equal(f.c.App.cache.size,0);
 f=fixture();f.c.owner='another-account';await f.buttons['#recipe-delete-confirm'].onclick();assert.equal(f.calls.length,0);
 f=fixture();let resolve;f.c.api=()=>new Promise(ok=>resolve=ok);const pending=f.buttons['#recipe-delete-confirm'].onclick();assert(f.buttons['#recipe-delete-confirm'].disabled);await f.buttons['#recipe-delete-confirm'].onclick();f.c.owner='another-account';resolve();await pending;assert.equal(f.calls.length,0);assert.equal(f.c.App.cache.size,2);
 console.log('Recipe deletion: cancel, success, retry, lost acknowledgement, duplicate tap and account change PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
