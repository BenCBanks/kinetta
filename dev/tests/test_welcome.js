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
  location:{search:''},URLSearchParams,replacePageAddress:(_el,href)=>{c.location.search=new URL(href,'https://example.test').search;},$$:()=>[node('#wc-next'),node('#wc-skip'),node('#wc-leave')],
  api:async(path,opts)=>{calls.push([path,opts&&opts.body]);return path==='/api/sharing'?{default:'everyone'}:path==='/api/account/inviter'?{inviter:null}:{name:'Sam Fictional'};},
  json:(m,b)=>({method:m,body:b}),esc:String,svg:()=>'',avatar:()=>'',skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',keep(){},invalidate(){},toast(){},profilePhotoSheet(){},aiExplain:()=>'Kit sends what a feature needs.',aiAdultBox:()=>'<input name=ai_adult>',pick:'everyone'};
vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/welcome.js','utf8'),c);
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
  c.location.search='';await route(el);assert.match(el.innerHTML,/1 of 3/);
  await node('#wc-next').onclick();await tick();assert.deepEqual(calls.filter(([p])=>p==='/api/account'),[],'unchanged profile is not saved');
  assert.match(el.innerHTML,/2 of 3/);await tick();
  await node('#wc-next').onclick();assert.deepEqual(calls.filter(([p,b])=>p==='/api/sharing'&&b),[],'unchanged audience is not saved');
  assert.match(el.innerHTML,/3 of 3/);node('#wc-leave').onclick();assert.deepEqual(went,['/me'],'Not now just leaves');
  calls=[];c.location.search='';await route(el);form.elements.bio.value='A fictional bio';await node('#wc-next').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['/api/account',{name:'Sam Fictional',bio:'A fictional bio'}]);
  await tick();c.pick='friends';await node('#wc-next').onclick();
  assert(calls.some(([p,b])=>p==='/api/sharing'&&b&&b.default==='friends'),'a changed audience is saved');
  calls=[];c.location.search='';await route(el);node('#wc-skip').onclick();await tick();node('#wc-skip').onclick();assert.deepEqual(calls.filter(([,b])=>b),[],'Skip writes nothing');
  // Kit is offered while it's off and available; Skip leaves it off, Turn on Kit saves only that yes
  c.App.me={name:'Sam Fictional',bio:'',coach:true,ai_ok:null};calls=[];
  c.location.search='';await route(el);assert.match(el.innerHTML,/1 of 4/);node('#wc-skip').onclick();assert.match(el.innerHTML,/Turn on Kit\?/);assert.match(el.innerHTML,/2 of 4/);
  node('#wc-skip').onclick();await tick();assert.match(el.innerHTML,/3 of 4/);assert.deepEqual(calls.filter(([,b])=>b),[],'skipping Kit writes nothing');
  // Kit is 18+ (sign-up is 16+): without the box ticked nothing is saved and the reason shows
  calls=[];c.location.search='';await route(el);node('#wc-skip').onclick();assert.match(el.innerHTML,/18 or older/);node('[name=ai_adult]').checked=false;await node('#wc-next').onclick();
  assert.deepEqual(calls.filter(([,b])=>b),[],'no yes without the age confirmation');assert.match(node('#wc-err').textContent,/18 or older/);
  node('[name=ai_adult]').checked=true;await node('#wc-next').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([,b])=>b))),[['/api/profile',{ai_ok:true,ai_adult:true}]]);assert.equal(c.App.me.ai_ok,true);assert.match(el.innerHTML,/3 of 4/);
  c.location.search='';await route(el);assert.match(el.innerHTML,/1 of 3/,'no Kit step once it is on');
  c.App.me={name:'Sam Fictional',bio:'',coach:true,ai_ok:null,ai_access:{food:{available:false,entitled:true},coach:{available:false,entitled:true}}};
  c.location.search='';await route(el);assert.match(el.innerHTML,/1 of 3/,'no Kit step when this server has no AI');
  c.location.search='?step=workouts';await route(el);assert.match(el.innerHTML,/Bring in your workouts/);assert(!el.innerHTML.includes('Find your friends'),'No separate friends step');assert.match(el.innerHTML,/Find friends · optional/);await tick();assert.match(node('#wc-connections').innerHTML,/isn’t available/);
  c.location.search='?step=constructor';await route(el);assert.match(el.innerHTML,/Your profile/,'Unknown step safely falls back to profile');
  console.log('Welcome steps: Skip/Not now write nothing, unchanged steps save nothing, changed profile and audience saved, Kit offered only while off and available PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
