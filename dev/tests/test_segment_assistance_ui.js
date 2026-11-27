'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/segments.js','utf8');
function fixture(){
 const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{isConnected:true,innerHTML:'',textContent:'',disabled:false});return nodes.get(s)};
 const c={console,App:{me:{id:1}},serverKey:()=> 'https://example.test',route(){},$:s=>node(s),esc:String,svg:()=>'',json:(method,body)=>({method,body:JSON.stringify(body)}),toast(){},api:async()=>({efforts:[],processing:false,excluded:false,assistance:null,assistance_revision:0})};
 c.readOwner=()=>String(c.App.me?.id);vm.createContext(c);require('./confirmed_setting_fixture.cjs')(c);vm.runInContext(source+'\nthis.segments=Segments',c);return{c,node};
}
(async()=>{
 for(const cancel of [f=>f.c.App.me={id:2},f=>f.node('card').isConnected=false]){
  const f=fixture();let release;f.c.api=()=>new Promise(r=>release=r);const request=f.c.segments.activityCard(f.node('card'),4);cancel(f);release({efforts:[]});await request;assert.equal(f.node('card').innerHTML,'');
 }
 const f=fixture();await f.c.segments.activityCard(f.node('card'),4);let calls=[];
 const form=f.node('#sa-declare');form.elements={assistance:{value:'unassisted'},confirmed:{checked:true}};
 f.c.api=async(path,opts)=>{if(opts)calls.push({path,body:JSON.parse(opts.body)});throw Error('Response lost')};
 const event={preventDefault(){},currentTarget:form};await form.onsubmit(event);await form.onsubmit(event);
 assert.equal(form.elements.assistance.value,'unassisted');assert.equal(form.elements.confirmed.checked,true);
 assert.equal(f.node('card').children[0].dataset.sharingState,'unknown','failed readback never claims private eligibility');assert.equal(calls.length,1,'an uncertain retry only reads; it cannot submit the declaration twice');assert.deepEqual(calls[0],{path:'/api/activities/4/segment-assistance',body:{assistance:'unassisted',revision:0,confirmed:true}});
 const version=f.node('card')._segmentRevision,markup=f.node('card').innerHTML;
 f.c.api=async()=>({efforts:[],excluded:true,assistance:'assisted',assistance_revision:3});
 await form.onsubmit(event);
 assert.equal(f.node('card')._segmentRevision,version,'failed declaration readback must not rebuild the card');
 assert.equal(f.node('card').innerHTML,markup);assert.equal(form.elements.assistance.value,'unassisted');assert.equal(form.elements.confirmed.checked,true);
 assert.equal(f.node('#sa-ex').checked,true,'leaderboard privacy still shows the saved value');
 assert.equal(f.node('#sa-status').textContent,'','Saving is cleared after a rejected declaration');
 const status=f.node('card').children.find(n=>n.dataset.sharingState);assert.match(status.children[0].textContent,/Not saved/);
 f.c.App.me={id:2};await form.onsubmit(event);assert.equal(calls.length,1,'queued old-account form cannot write');
 console.log('PASS segment assistance UI: delayed/account/navigation guards, failed review preservation and unchanged retry');
})().catch(e=>{console.error(e);process.exitCode=1});
