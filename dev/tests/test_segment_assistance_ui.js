'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/segments.js','utf8');
function fixture(){
 const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{isConnected:true,innerHTML:'',textContent:'',disabled:false});return nodes.get(s)};
 const c={console,App:{me:{id:1}},serverKey:()=> 'https://example.test',route(){},$:s=>node(s),esc:String,svg:()=>'',json:(method,body)=>({method,body:JSON.stringify(body)}),toast(){},api:async()=>({efforts:[],processing:false,excluded:false,assistance:null,assistance_revision:0})};
 vm.createContext(c);vm.runInContext(source+'\nthis.segments=Segments',c);return{c,node};
}
(async()=>{
 for(const cancel of [f=>f.c.App.me={id:2},f=>f.node('card').isConnected=false]){
  const f=fixture();let release;f.c.api=()=>new Promise(r=>release=r);const request=f.c.segments.activityCard(f.node('card'),4);cancel(f);release({efforts:[]});await request;assert.equal(f.node('card').innerHTML,'');
 }
 const f=fixture();await f.c.segments.activityCard(f.node('card'),4);let calls=[];
 const form=f.node('#sa-declare');form.elements={assistance:{value:'unassisted'},confirmed:{checked:true}};
 f.c.api=async(path,opts)=>{calls.push({path,body:JSON.parse(opts.body)});throw Error('Response lost')};
 const event={preventDefault(){},currentTarget:form};await form.onsubmit(event);await form.onsubmit(event);
 assert.equal(form.elements.assistance.value,'unassisted');assert.equal(form.elements.confirmed.checked,true);
 assert.match(f.node('#sa-status').textContent,/selection is kept/);assert.deepEqual(calls[0],calls[1]);
 f.c.App.me={id:2};await form.onsubmit(event);assert.equal(calls.length,2,'queued old-account form cannot write');
 console.log('PASS segment assistance UI: delayed/account/navigation guards, failed review preservation and unchanged retry');
})().catch(e=>{console.error(e);process.exitCode=1});
