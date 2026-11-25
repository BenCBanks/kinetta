'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/email-account.js','utf8').split('\n(() => {')[0];
(async()=>{
  let owner='a',pending,calls=0,sheets=0;
  const c={App:{me:{id:1,login:'zz_test_gate',needs_email_confirm:true,email_confirmed:false}},readOwner:()=>owner,
    json:(method,body)=>({method,body}),api:(path,opts)=>{assert.equal(path,'/api/account/email/resend');assert.equal(opts.body.login,'zz_test_gate');calls++;return new Promise((resolve,reject)=>{pending={resolve,reject};});},
    sheet:(title,markup,wire)=>{sheets++;assert(markup.includes('data-confirm-resend'));assert.equal(typeof wire,'function');}};
  vm.createContext(c);vm.runInContext(source,c);const gate=c.EmailConfirmation;
  for(const [needs,confirmed,blocked] of [[true,false,true],[true,true,false],[false,false,false],[false,true,false]]){
    Object.assign(c.App.me,{needs_email_confirm:needs,email_confirmed:confirmed});assert.equal(gate.required(),blocked);
  }
  c.App.me.needs_email_confirm=true;c.App.me.email_confirmed=false;
  assert(gate.markup().includes('Confirm your email to use Kit.'));
  assert(gate.markup(true).includes('Confirm your email to upload photos.'));
  assert.equal(gate.lock(),true);assert.equal(sheets,1);
  function root(){const button={disabled:false},status={textContent:''};return {isConnected:true,button,status,querySelector:q=>q.includes('resend')?button:status};}
  let r=root();gate.wire(r);let task=r.button.onclick();await r.button.onclick();assert.equal(calls,1,'double tap sends once');
  pending.resolve({message:'Check your inbox.'});await task;assert.equal(r.status.textContent,'Check your inbox.');assert.equal(r.button.disabled,false);
  task=r.button.onclick();pending.reject(Error('Try again later.'));await task;assert.equal(r.status.textContent,'Try again later.');assert.equal(r.button.disabled,false);
  task=r.button.onclick();owner='b';pending.resolve({message:'Wrong account'});await task;assert.equal(r.status.textContent,'');
  await r.button.onclick();assert.equal(calls,3,'stale owner cannot resend');
  owner='a';r=root();gate.wire(r);task=r.button.onclick();r.isConnected=false;pending.resolve({message:'Gone'});await task;assert.equal(r.status.textContent,'');
  c.App.me.email_confirmed=true;assert.equal(gate.lock(),false);assert.equal(sheets,1,'no gate for confirmed account');
  console.log('Email lock: account matrix, one resend, retry, stale-owner/detached response fences PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
