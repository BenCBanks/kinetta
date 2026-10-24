// Run the production asynchronous tools with controlled replies. No server, account actions or mail.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/admin-tools.js','utf8').replace(/start\(\)\.catch[\s\S]*$/,'');
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(){
 const nodes=new Map(),calls=[];let currentForm;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',innerHTML:'',isConnected:true,disabled:false,setAttribute(){},removeAttribute(){}});return nodes.get(s)};
 const c={crypto:require('node:crypto').webcrypto,URLSearchParams,Date,setTimeout,clearTimeout,AUDIT_LABEL:{},STATUS_LABEL:{},revision:1,dialogRevision:1,who:{id:1},err:node('err'),content:node('content'),esc:String,date:String,table:()=>'',show:v=>calls.push(v),error:e=>calls.push(e.message),
  $:s=>s==='#tool-form'?currentForm:node(s),busy:(_,f)=>{c.pending=f()},
  modal:(_,html,wire)=>{c.dialogRevision++;currentForm={isConnected:true,reportValidity:()=>true};c.form=currentForm;c.html=html;wire({},()=>{})},api:async()=>({})};
 vm.createContext(c);vm.runInContext(source,c);vm.runInContext('closeTool=async close=>{close();};',c);
 return {c,node,calls};
}
(async()=>{
 // An ambiguous response retries exactly the same request. Editing a draft creates a new action identity.
 const f=fixture(),keys=[];let fail=true,done=0;
 f.c.confirmForm('Confirm','','',async(_,key)=>{keys.push(key.request_key);if(fail)throw Error('Lost response')},()=>done++);
 const submit=()=>f.c.form.onsubmit({preventDefault(){}});
 submit();await assert.rejects(f.c.pending,/Lost response/);submit();await assert.rejects(f.c.pending,/Lost response/);assert.equal(keys[0],keys[1]);
 f.c.form.oninput();submit();await assert.rejects(f.c.pending,/Lost response/);assert.notEqual(keys[1],keys[2]);fail=false;submit();await f.c.pending;assert.equal(done,1);
 // A dismissed/replaced dialog or changed page cannot reopen the old account after a slow write.
 for(const abandon of [c=>c.revision++,c=>c.dialogRevision++,c=>{c.form.isConnected=false}]){
  const r=fixture();let release,after=0;r.c.confirmForm('Confirm','','',()=>new Promise(ok=>release=ok),()=>after++);r.c.form.onsubmit({preventDefault(){}});abandon(r.c);release({ok:true});await r.c.pending;assert.equal(after,0);
 }
 // A slow support/review response cannot replace a newly selected view or dialog.
 for(const fn of ['openPerson','reviewReport'])for(const abandon of [c=>c.revision++,c=>c.dialogRevision++,c=>{c.who=null}]){
  const r=fixture();let release,opened=0;r.c.api=()=>new Promise(ok=>release=ok);r.c.modal=()=>opened++;const pending=r.c[fn](3);abandon(r.c);release({});await pending;assert.equal(opened,0,fn+' late reply');
 }
 // Older account-search results must not replace a newer query; failures leave an explicit retry.
 const s=fixture(),form={elements:{namedItem:n=>({value:n==='q'?'Sam':'',checked:true})}};s.c.$=sel=>sel==='#people-find'?form:s.node(sel);
 let releases=[];s.c.api=()=>new Promise(ok=>releases.push(ok));let draws=[];s.c.drawPeople=d=>draws.push(d.marker);
 const old=s.c.loadPeople(1),fresh=s.c.loadPeople(1);releases[1]({total:1,marker:'new'});await fresh;releases[0]({total:9,marker:'old'});await old;assert.deepEqual(draws,['new']);
 s.c.api=async()=>{throw Error('Temporary failure')};await s.c.loadPeople(1);assert.match(s.node('#people-status').innerHTML,/Temporary failure.*Retry/);assert.equal(form.elements.namedItem('q').value,'Sam');
 // A late 401 or success from a previous session cannot clear or write receipts into a new session.
 const base=fs.readFileSync('app/static/admin.js','utf8'),apiSource=base.slice(base.indexOf('async function api('),base.indexOf('function error('));
 for(const status of [401,200]){
  const r=fixture();let release,receipts=0;r.c.csrf='old-csrf';r.c.fetch=()=>new Promise(ok=>release=ok);r.c.writeReceipt=()=>receipts++;
  vm.runInContext(apiSource,r.c);const pending=r.c.api('/manage/3/signout',{confirm:'zz_test_member'});
  const next={id:2};r.c.who=next;r.c.csrf='new-csrf';release({ok:status===200,status,json:async()=>status===200?{ok:true}:{detail:'Sign in again'} });
  if(status===401)await assert.rejects(pending,/Sign in/);else await pending;
  assert.equal(r.c.who,next);assert.equal(r.c.csrf,'new-csrf');assert.equal(receipts,0);
 }
 console.log('PASS admin tools: retry identity, changed drafts, abandoned confirmations, stale support/review/search, inline retry, previous-session response isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
