// Exercise account fences and retained correction drafts in the actual Kit memory controls.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/kit.js','utf8'),code=source.slice(source.indexOf('  function memorySettings(){'),source.indexOf('  async function mount(el){'));
const tick=()=>new Promise(setImmediate);
(async()=>{
 let owner='one',calls=[],fail=false,finish=null;
 const box={innerHTML:'',addEventListener(){}},sh={classList:{add(){}}},body={isConnected:true,closest:()=>sh},header={prepend(){}},title={},menu={setAttribute(){}},toggle={checked:true,disabled:false};
 const row={classList:{contains:()=>false}},edit={dataset:{kitEdit:'7'},closest:()=>row},one={dataset:{kitForget:'7'}},all={},error={textContent:''},add={},form={},cancel={},save={},del={},text={value:'I prefer quiet walks.'};
 const tabs=['goal','preference','routine'].map(kitKind=>({dataset:{kitKind},setAttribute(){}}));
 const nodes={'#kit-memory':box,header,h2:title,'#kit-memory-on':toggle,'#kit-forget-all':all,'#kit-memory-error':error,'#kit-memory-add':add,'#kit-memory-form':form,'#kit-memory-cancel':cancel,'#kit-memory-save':save,'#kit-memory-text':text,'#kit-memory-delete':del};
 const c={readOwner:()=>owner,sheet:(t,h,ready)=>ready(body,()=>{}),document:{createElement:()=>menu},svg:()=>'',esc:String,confirmSheet:async()=>true,$:s=>nodes[s],$$:s=>s==='[data-kit-edit]'?[edit]:s==='[data-kit-forget]'?[one]:s==='[data-kit-kind]'?tabs:[],api:async(path,opts)=>{calls.push({path,opts});if(fail&&opts)throw Error('Fictional failed save');if(finish)return new Promise(ok=>finish=ok);return {enabled:true,version:4,memories:[{id:7,text:'I prefer evening walks.',kind:'preference',source:'chat',updated:'2026-11-25'}]};},json:(method,body)=>({method,body}),setTimeout};
 vm.createContext(c);vm.runInContext(code,c);
 c.memorySettings();await tick();assert(box.innerHTML.includes('I prefer evening walks.'));menu.onclick();owner='two';
 await one.onclick();await all.onclick({currentTarget:all});await toggle.onchange({target:toggle});assert.equal(calls.length,1,'old sheet cannot delete memories or change another account settings');
 owner='one';fail=true;toggle.checked=false;await toggle.onchange({target:toggle});assert.equal(toggle.checked,true,'failed memory-off does not claim success');assert.equal(toggle.disabled,false);assert(error.textContent.includes('failed save'));
 fail=false;calls=[];c.memorySettings();await tick();edit.onclick();tabs[0].onclick();owner='two';await form.onsubmit({preventDefault(){}});await del.onclick();
 assert.equal(calls.length,1,'stale-account editor cannot save or delete a detail');
 owner='one';fail=true;await form.onsubmit({preventDefault(){}});assert.equal(text.value,'I prefer quiet walks.');assert.equal(save.disabled,false);assert(error.textContent.includes('failed save'));
 assert.equal(calls.at(-1).opts.method,'PATCH');assert.equal(calls.at(-1).opts.body.version,4);assert.equal(calls.at(-1).opts.body.kind,'goal','text-tab choice reaches the API');
 fail=false;finish=true;box.innerHTML='Loading';c.memorySettings();owner='two';finish({enabled:true,version:4,memories:[{id:8,text:'Previous account detail'}]});await tick();assert.equal(box.innerHTML,'Loading','late reads cannot paint another account');
 console.log('Kit memory UI: stale-account list/editor/overflow fences, switch rollback, text-tab writes and retained drafts PASS');
})().catch(e=>{console.error(e);process.exit(1)});
