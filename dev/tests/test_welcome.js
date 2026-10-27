// The welcome steps (#232 F): Skip and Not now never write; Continue writes only what changed.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let route,calls=[],went=[];
const field=v=>({value:v});
const el={isConnected:true,innerHTML:''},nodes={};
const node=(sel)=>nodes[sel]||(nodes[sel]={onclick:null,disabled:false,textContent:'',innerHTML:'',remove(){}});
const form={elements:{name:field('Sam Fictional'),bio:field('')},reportValidity:()=>true};
const c={App:{me:{name:'Sam Fictional',bio:''}},Native:{on:false},readOwner:()=>'one',route:(re,tab,fn)=>route=fn,go:p=>went.push(p),
  $:(sel)=>sel==='#wc-form'?form:sel==='input[name="aud"]:checked'?{value:c.pick}:node(sel),
  api:async(path,opts)=>{calls.push([path,opts&&opts.body]);return path==='/api/sharing'?{default:'everyone'}:path==='/api/account/inviter'?{inviter:null}:{name:'Sam Fictional'};},
  json:(m,b)=>({method:m,body:b}),esc:String,svg:()=>'',avatar:()=>'',skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',keep(){},invalidate(){},toast(){},profilePhotoSheet(){},aiExplain:()=>'Kit sends what a feature needs.',pick:'everyone'};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/welcome.js','utf8'),c);
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
  await route(el);assert.match(el.innerHTML,/1 of 4/);
  await node('#wc-next').onclick();await tick();assert.deepEqual(calls.filter(([p])=>p==='/api/account'),[],'unchanged profile is not saved');
  assert.match(el.innerHTML,/2 of 4/);await tick();
  await node('#wc-next').onclick();assert.deepEqual(calls.filter(([p,b])=>p==='/api/sharing'&&b),[],'unchanged audience is not saved');
  assert.match(el.innerHTML,/3 of 4/);node('#wc-leave').onclick();assert.deepEqual(went,['/me'],'Not now just leaves');
  calls=[];await route(el);form.elements.bio.value='A fictional bio';await node('#wc-next').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['/api/account',{name:'Sam Fictional',bio:'A fictional bio'}]);
  await tick();c.pick='friends';await node('#wc-next').onclick();
  assert(calls.some(([p,b])=>p==='/api/sharing'&&b&&b.default==='friends'),'a changed audience is saved');
  calls=[];await route(el);node('#wc-skip').onclick();await tick();node('#wc-skip').onclick();assert.deepEqual(calls.filter(([,b])=>b),[],'Skip writes nothing');
  // Kit is offered while it's off and available; Skip leaves it off, Turn on Kit saves only that yes
  c.App.me={name:'Sam Fictional',bio:'',coach:true,ai_ok:null};calls=[];
  await route(el);assert.match(el.innerHTML,/1 of 5/);node('#wc-skip').onclick();assert.match(el.innerHTML,/Turn on Kit\?/);assert.match(el.innerHTML,/2 of 5/);
  node('#wc-skip').onclick();await tick();assert.match(el.innerHTML,/3 of 5/);assert.deepEqual(calls.filter(([,b])=>b),[],'skipping Kit writes nothing');
  calls=[];await route(el);node('#wc-skip').onclick();await node('#wc-next').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([,b])=>b))),[['/api/profile',{ai_ok:true}]]);assert.equal(c.App.me.ai_ok,true);assert.match(el.innerHTML,/3 of 5/);
  await route(el);assert.match(el.innerHTML,/1 of 4/,'no Kit step once it is on');
  c.App.me={name:'Sam Fictional',bio:'',coach:true,ai_ok:null,ai_access:{food:{available:false,entitled:true},coach:{available:false,entitled:true}}};
  await route(el);assert.match(el.innerHTML,/1 of 4/,'no Kit step when this server has no AI');
  console.log('Welcome steps: Skip/Not now write nothing, unchanged steps save nothing, changed profile and audience saved, Kit offered only while off and available PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
