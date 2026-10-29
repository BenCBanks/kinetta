// Real entry routing with controlled policy, transient failures and delayed old-view responses.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/app.js','utf8');
function fixture(){
  let html='',nodes={},owner='one';const values=new Map(),calls=[],forms=[],betas=[];
  const root={get innerHTML(){return html;},set innerHTML(value){html=value;nodes=Object.fromEntries([...value.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{disabled:false}]));}};
  const c={root,location:{pathname:'/signup',search:''},readOwner:()=>owner,BRAND:'Kinetta',esc:String,store:{get:k=>values.get(k),del:k=>values.delete(k)},$:s=>nodes[s]||null,
    history:{replaceState(a,b,url){c.location.pathname=url;}},showLogin:()=>{root.innerHTML='Current login';},showNewAccount:form=>forms.push(form),showBeta:full=>betas.push(!!full)};
  c.api=async path=>{calls.push(path);if(path==='/api/signup')return {open:true,full:false};if(path==='/api/beta')return {open:false};throw Error(path);};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('async function challengeOrigin('),source.indexOf('function showNewAccount('))+source.slice(source.indexOf('async function enrollmentPolicy('),source.indexOf('// "Join the beta"')),c);
  c.getAppFirst=()=>false;vm.runInContext(source.slice(source.indexOf('async function showInvite('),source.indexOf('// "Create an account"')),c);
  return {c,root,values,calls,forms,betas,node:s=>nodes[s],changeOwner:()=>owner='two'};
}
(async()=>{
  let r=fixture();await r.c.showSignup();assert.equal(r.forms.length,1);assert(!r.calls.includes('/api/beta'),'open signup needs no secondary policy read');
  r=fixture();r.values.set('kinetta.friendLink','fictional-link');r.c.api=async path=>path==='/api/signup'?{open:false,full:false}:path==='/api/beta'?{open:true,full:false}:{name:'Fictional inviter'};await r.c.showSignup();assert.deepEqual(r.betas,[false]);assert.equal(r.c.location.pathname,'/beta');assert.equal(r.values.get('kinetta.friendLink'),'fictional-link');
  r=fixture();r.c.api=async()=>({open:false,full:true});await r.c.showSignup();assert.deepEqual(r.betas,[true]);
  for(const bad of [null,{}, {open:'yes',full:false}]){r=fixture();r.c.api=async()=>bad;await r.c.showSignup();assert.match(r.root.innerHTML,/couldn’t load/);assert(r.node('#enrollment-retry'));assert.equal(r.forms.length,0);}
  r=fixture();r.c.api=async()=>({open:false,full:false});await r.c.showSignup();assert.match(r.root.innerHTML,/Public signup is closed/);assert.equal(r.forms.length,0);r.node('#enrollment-login').onclick({preventDefault(){}});assert.equal(r.root.innerHTML,'Current login');
  r=fixture();r.c.api=async()=>{throw Object.assign(Error('Temporary failure'),{status:503});};await r.c.showSignup();assert.match(r.root.innerHTML,/Signup couldn’t load/);assert(r.node('#enrollment-retry'));r.c.api=async()=>({open:true,full:false});await r.node('#enrollment-retry').onclick();assert.equal(r.forms.length,1,'transient metadata failure can retry');
  for(const key of ['kinetta.cardLink','kinetta.challengeLink']){
    r=fixture();r.values.set(key,'fictional-intent');r.c.api=async()=>{throw Object.assign(Error('Temporary failure'),{status:503});};await r.c.showSignup();assert.match(r.root.innerHTML,/Invitation couldn’t load/);assert.equal(r.values.get(key),'fictional-intent','transient origin errors preserve the intent');assert.equal(r.forms.length,0);
    r=fixture();r.values.set(key,'expired');r.c.api=async path=>{if(path.includes('/cards/')||path.includes('/challenges/'))throw Object.assign(Error('Gone'),{status:404});return {open:true,full:false};};await r.c.showSignup();assert(!r.values.has(key));assert.equal(r.forms.length,1,'expired origins never become implicit joins');
  }
  for(const changed of ['path','owner']){
    r=fixture();let finish;r.c.api=()=>new Promise(ok=>finish=ok);const pending=r.c.showSignup();await new Promise(setImmediate);assert.match(r.root.innerHTML,/Loading enrollment/,'the tap responds before the network');if(changed==='path')r.c.location.pathname='/';else r.changeOwner();r.root.innerHTML='Newer view';finish({open:true,full:false});await pending;assert.equal(r.root.innerHTML,'Newer view');assert.equal(r.forms.length,0);
  }
  for(const kind of ['friend','account']){
    r=fixture();r.c.location.pathname='/'+(kind==='friend'?'add':'join')+'/fictional';r.values.set('kinetta.friendLink','fictional');r.c.api=async()=>{throw Object.assign(Error('Temporary'),{status:503});};await(kind==='friend'?r.c.showInvite('fictional'):r.c.showJoin('fictional'));assert.match(r.root.innerHTML,/Invitation couldn’t load/);assert.equal(r.values.get('kinetta.friendLink'),'fictional');r.c.api=async path=>path==='/api/signup'?{open:true,full:false}:{name:'Fictional friend',email:'fictional@example.test'};await r.node('#enrollment-retry').onclick();assert(kind==='friend'?r.root.innerHTML.includes('confirm your email'):r.forms.length===1);
  }
  r=fixture();r.c.location.pathname='/add/fictional';r.c.api=async path=>path==='/api/signup'?{open:false,full:false}:path==='/api/beta'?{open:true}:{name:'Fictional inviter'};await r.c.showInvite('fictional');assert.match(r.root.innerHTML,/Join the beta/);assert(r.node('#iv-signup'),'a friend invite preserves an available waitlist path');
  r=fixture();r.values.set('kinetta.friendLink','kept');r.c.api=async path=>path==='/api/signup'?{open:true,full:false}:null;await r.c.showInvite('kept');assert.match(r.root.innerHTML,/Invitation couldn’t load/);assert.equal(r.values.get('kinetta.friendLink'),'kept','malformed successful replies must not expire an invite');
  r=fixture();vm.runInContext(source.slice(source.indexOf('async function showBeta('),source.indexOf('// Forgot password')),r.c);r.c.location.pathname='/beta';r.c.api=async()=>{throw Object.assign(Error('Temporary failure'),{status:503});};await r.c.showBeta();assert.match(r.root.innerHTML,/Enrollment couldn’t load/);r.c.api=async()=>({open:false});await r.node('#enrollment-retry').onclick();assert.match(r.root.innerHTML,/Beta enrollment is closed/);
  for(const status of [503,404]){
    r=fixture();r.c.location.pathname='/reset-password/fictional';vm.runInContext(source.slice(source.indexOf('async function showReset('),source.indexOf('async function showConfirmEmail(')),r.c);r.c.api=async()=>{throw Object.assign(Error('Fixture lookup failure'),{status});};await r.c.showReset('fictional');assert.match(r.root.innerHTML,status===503?/Password reset couldn’t load/:/This link doesn't work/);assert(!!r.node('#enrollment-retry')===(status===503));if(status===503){let resetLookups=0;r.c.api=async path=>{assert.equal(path,'/api/password/reset/fictional');resetLookups++;throw Object.assign(Error('Gone'),{status:404});};await r.node('#enrollment-retry').onclick();assert.equal(resetLookups,1);assert.match(r.root.innerHTML,/Send a new link/);}
  }
  for(const name of ['showReset','showConfirmEmail']){
    r=fixture();r.c.location.pathname='/'+name+'/fictional';r.c.json=()=>({});vm.runInContext(source.slice(source.indexOf('async function '+name+'('),source.indexOf(name==='showReset'?'async function showConfirmEmail(':'async function showWelcome(')),r.c);let finish;r.c.api=()=>new Promise(ok=>finish=ok);const pending=r.c[name]('fictional');r.c.location.pathname='/';r.root.innerHTML='Newer login';finish({login:'fictional',email:'fictional@example.test',challenge_joined:'fictional'});await pending;assert.equal(r.root.innerHTML,'Newer login');assert.equal(r.values.size,0);
  }
  console.log('Enrollment entry: open/waitlist/full/closed routing, immediate feedback, retry, preserved origins and old-view/account fences PASS');
})().catch(e=>{console.error(e);process.exit(1)});
