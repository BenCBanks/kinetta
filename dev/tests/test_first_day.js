// Completed manual workouts and a tab/account-bound email-confirmation return.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const pages=fs.readFileSync('app/static/pages.js','utf8'),app=fs.readFileSync('app/static/app.js','utf8');
const NativeDate=Date;
function manual(instant,day){
 let form,html,write=null,closed=false;
 class Clock extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return +new NativeDate(instant);}}
 const nodes={'#ma-lift':{},'#ma-dist':{},'.dur-s':{},'#ma-go':{disabled:false},'#ma-cal':{},'#ma-err':{textContent:'',scrollIntoView(){}}};
 const c={Date:Clock,isoDay:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,esc:String,svg:()=>'',U:{du:()=> 'mi'},HAND_KINDS:[['Exercise',[['walk','Walk',null],['workout','Lifting','Strength Training']]]],LIFT_KIND:'0.1',imp:()=>true,MI:1609.344,
  sheet(title,markup,mount){html=markup;form={};for(const m of markup.matchAll(/<select name="([^"]+)"[^>]*>(.*?)<\/select>/gs)){const selected=m[2].match(/<option value="([^"]*)" selected>/);form[m[1]]={value:selected?.[1]||'',focus(){}};}for(const name of ['name','dist','kcal','hr','desc','date'])form[name]={value:'',focus(){}};mount({},()=>closed=true);},
  $:s=>s==='#ma'?form:nodes[s],toast:()=>{},json:(method,body)=>({method,body}),api:async(path,opts)=>{write=opts.body;return{id:1};},invalidate(){},go(){}};
 vm.createContext(c);vm.runInContext(pages.slice(pages.indexOf('function addActivitySheet('),pages.indexOf('// A note box')),c);c.addActivitySheet(day);
 return {c,form,html,nodes,get write(){return write;},get closed(){return closed;},submit:()=>form.onsubmit({preventDefault(){}})};
}
function confirmation({marker='new_user',login='new_user',email='fictional@example.test',iphone=false,valid=true,storage=true}={}){
 let html='',owner='one';const nodes={},values=new Map(marker?[['kinetta.signupWelcome',marker]]:[]),calls=[];
 const c={root:{get innerHTML(){return html;},set innerHTML(v){html=v;for(const id of ['c-go','c-login','signup-continue','signup-reset','signup-resend','signup-resend-status'])nodes['#'+id]={};}},enrollmentView:()=>{const before=owner,path=c.location.pathname;return()=>owner===before&&c.location.pathname===path;},BRAND:'',LAUNCH:'Launch',esc:String,Native:{on:false},navigator:{userAgent:iphone?'iPhone':'Browser'},location:{pathname:'/confirm-email'},
  sessionStorage:{getItem:k=>{if(!storage)throw Error('Disabled');return values.get(k);},setItem:(k,v)=>{if(!storage)throw Error('Disabled');values.set(k,v);},removeItem:k=>values.delete(k)},store:{set(){}},json:(method,body)=>({method,body}),$:s=>nodes[s],attachConfirmationResend(){},getAppFirst:()=>false,showForgot(){},start(){calls.push('start');},
  history:{replaceState(a,b,path){c.location.pathname=path;}},api:async path=>{calls.push(path);if(path==='/api/me')return {login,email};if(!valid)throw Object.assign(Error('Expired'),{status:404});return{email:'fictional@example.test'};}};
 vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function showSignupPending('),app.indexOf('// An iPhone (or iPad) browser')),c);vm.runInContext(app.slice(app.indexOf('async function showConfirmEmail('),app.indexOf('async function showWelcome(')),c);
 return {c,values,calls,nodes,get html(){return html;},changeOwner:()=>owner='two'};
}
(async()=>{
 const oldZone=process.env.TZ;
 try{
  for(const zone of ['UTC','America/New_York','Pacific/Auckland']){
   process.env.TZ=zone;
   for(const time of ['2026-11-27T14:42:16','2026-11-27T00:10:00','2026-11-27T00:30:00','2026-03-08T03:10:00','2026-11-01T01:10:00-05:00']){
    const r=manual(time),start=new NativeDate(`${r.form.day.value}T${r.form.time.value}`);assert(+start+1800000<=NativeDate.parse(time),`${zone} ${time}: default is complete`);assert.equal(start.getMinutes()%15,0);await r.submit();assert(r.closed);assert.equal(r.write.start,start.toISOString(),'saved instant matches the phone-local check');
   }
  }
  process.env.TZ='UTC';let r=manual('2026-11-27T14:42:16');assert.equal(r.form.time.value,'14:00');r.form.time.value='14:30';await r.submit();assert.equal(r.write,null);assert(!r.closed);assert.match(r.nodes['#ma-err'].textContent,/ends in the future/);assert(!r.nodes['#ma-go'].disabled);r.form.time.value='13:30';await r.submit();assert(r.closed,'start stays editable after validation');
  r=manual('2026-11-27T14:42:16');r.form.h.value='2';await r.submit();assert.equal(r.write,null,'duration changes are checked too');
  r=manual('2026-11-27T00:10:00');assert.equal(r.form.day.value,'2026-11-26');assert.equal(r.form.time.value,'23:30');
  r=manual('2026-11-27T14:42:16','2026-11-26');assert.equal(r.form.time.value,'08:00','explicit past day keeps its usual editable default');
  r=manual('2026-11-27T14:30:00');r.form.time.value='14:00';await r.submit();assert(r.closed,'an end exactly now is allowed');
 }finally{if(oldZone===undefined)delete process.env.TZ;else process.env.TZ=oldZone;}
 for(const iphone of [false,true]){
  let r=confirmation({iphone});await r.c.showConfirmEmail('fictional');assert.match(r.html,/href="\/welcome" id="c-go"/);if(iphone)assert.match(r.html,/kinetta:\/\/open/,'existing app handoff remains');r.nodes['#c-go'].onclick({preventDefault(){}});assert.equal(r.c.location.pathname,'/welcome');assert(!r.values.has('kinetta.signupWelcome'));
 }
 for(const options of [{marker:null},{login:'different_user'},{email:'other@example.test'},{storage:false}]){const r=confirmation(options);await r.c.showConfirmEmail('fictional');assert.match(r.html,/href="\/activity" id="c-go"/,'unrelated confirmations keep their normal destination');}
 let r=confirmation();r.c.api=async path=>{if(path==='/api/me')throw Object.assign(Error('Signed out'),{status:401});return{email:'fictional@example.test'};};await r.c.showConfirmEmail('fictional');assert.match(r.html,/Email confirmed/);assert.match(r.html,/href="\/activity" id="c-go"/);
 r=confirmation({valid:false});await r.c.showConfirmEmail('fictional');assert.match(r.html,/confirm-resend-form/);assert.equal(r.values.get('kinetta.signupWelcome'),'new_user','a bad token does not consume the signup destination');
 r=confirmation({storage:false});assert.doesNotThrow(()=>r.c.showSignupPending({pending:'fictional@example.test',login:'new_user'}));
 r=confirmation();r.c.showSignupPending({pending:'fictional@example.test',login:'new_user'});assert.equal(r.values.get('kinetta.signupWelcome'),'new_user');assert(![...r.values.values()].some(v=>v.includes('@')),'stored return has no email/token/password');
 for(const boundary of ['owner','path']){r=confirmation();let done;r.c.api=async path=>path==='/api/me'?new Promise(resolve=>done=resolve):{email:'fictional@example.test'};const task=r.c.showConfirmEmail('fictional');await new Promise(setImmediate);if(boundary==='owner')r.changeOwner();else r.c.location.pathname='/';r.c.root.innerHTML='Newer view';done({login:'new_user',email:'fictional@example.test'});await task;assert.equal(r.html,'Newer view');assert(r.values.has('kinetta.signupWelcome'),'stale response cannot consume another view’s state');}
 console.log('First day: completed defaults across midnight/DST/timezones;editable future-end check;explicit saved instant;tab/account/email-bound Welcome and confirmation recovery PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
