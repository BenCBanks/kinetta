// Exercise the real settings route and logout safeguards with fictional local drafts.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf("route(/^\\/me\\/settings$/"),end=source.indexOf('// heart rate, body and time zone',start);
function fixture(pending=0,accept=true){
 let route,writes=[],forgot=0,login=0,erased=0,notices=[],editors=[],confirms=[];const nodes=new Map(),el={innerHTML:'',isConnected:true};
 const c={session:1,readOwner:()=>JSON.stringify([c.App.me?.id,c.session]),App:{me:{id:1,name:'Fictional Person',login:'zz_test_settings',units:'imperial'},cache:new Map()},
  sheet:(title,html,wire)=>wire?.({innerHTML:html,isConnected:true},()=>{}),aiExplain:()=>'',MeCard:{openEditor:()=>editors.push('inline')},render(){},URLSearchParams,SUPPORT_EMAIL:'help@example.test',location:{search:''},pendingEmail:()=>null,emailSheet(){},route:(re,tab,fn)=>route=fn,svg:()=>'',esc:String,backBtn:()=>'<button data-back>Back</button>',wireBack(){},profileHref:()=>'/people/zz_test_settings',
  $:sel=>{if(!nodes.has(sel))nodes.set(sel,{});return nodes.get(sel)},$$:()=>[],kitChatOn:()=>false,
  Q:{mine:()=>Array.from({length:pending},()=>({who:'zz_test_settings'})),all:()=>[{who:'zz_test_settings'},{who:'zz_test_other'}]},
  FoodThread:{pendingCount:async()=>0,eraseDevice:async()=>{erased++}},KitChat:{eraseDevice(){},memorySettings(){},savedReviews(){editors.push('reviews')}},
  Native:{on:false,foodEntryPendingCount:async()=>0,forget:async()=>{forgot++}},Track:{pause:async()=>{}},
  confirmSheet:async(title,opts)=>{confirms.push(title+' '+opts.body);return accept},api:async(...args)=>writes.push(args),json:(method,body)=>({method,body}),store:{set:(...args)=>writes.push(args)},forgetKept(){},netbar(){},history:{replaceState(){}},showLogin:()=>{login++},toast:message=>notices.push(message)};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 return {c,el,nodes,writes,notices,editors,confirms,run:()=>route(el),counts:()=>({forgot,login,erased})};
}
(async()=>{
 let f=fixture();await f.run();f.nodes.get('#m-profile').onclick();assert.equal(f.editors.length,1,'Edit profile opens the shared editor directly');assert.equal(f.editors[0],'inline','Settings opens the card editor entry');assert(!f.el.innerHTML.includes('Name, photo, bio'),'Edit profile does not repeat its destination in a trailing value');assert(f.el.innerHTML.includes('<h1>Settings</h1>'));assert(!f.el.innerHTML.includes('<details class="me-settings"'));const rows=[...f.el.innerHTML.matchAll(/<(?:a|button|label|div)\b[^>]*class="row-link\b[^"]*"[^>]*>/g)];assert.match(rows.at(-1)[0],/id="logout"/,'Log out is the final Settings row');assert(f.el.innerHTML.includes('id="m-email"'),'Account has an Email row');
 assert(!f.el.innerHTML.includes('id="m-kit-history"'),'saved reviews are inside Kit settings');f.nodes.get('#m-kit').onclick();f.nodes.get('#m-kit-history').onclick();assert.equal(f.editors.at(-1),'reviews','Earlier Kit reviews remain reachable without a chat entry');
 await f.nodes.get('#logout').onclick();assert.equal(f.c.App.me,null);assert.equal(f.counts().login,1);assert.equal(f.counts().forgot,1);assert(f.writes.some(w=>w[0]==='/api/logout'));const queue=f.writes.find(w=>w[0]==='fit.queue')[1];assert.equal(queue.length,1);assert.equal(queue[0].who,'zz_test_other','another account’s queue is preserved');
 f=fixture(1,false);await f.run();await f.nodes.get('#logout').onclick();assert.equal(f.confirms.at(-1),'Log out? 1 unsynced item saved on this phone will be deleted if you log out.');assert(f.c.App.me);assert.equal(f.counts().erased,0);assert.equal(f.writes.length,0,'declining unsent-data warning never clears drafts or logs out');
 f=fixture(2,false);await f.run();await f.nodes.get('#logout').onclick();assert.equal(f.confirms.at(-1),'Log out? 2 unsynced items saved on this phone will be deleted if you log out.');assert(f.c.App.me);assert.equal(f.writes.length,0,'declining plural unsent-data warning never clears drafts or logs out');
 f=fixture();f.c.FoodThread.pendingCount=async()=>{throw Error('Fictional storage error')};await f.run();await f.nodes.get('#logout').onclick();assert(f.c.App.me);assert.equal(f.writes.length,0,'failed pending check keeps the account and drafts');
 f=fixture();f.c.api=async()=>{throw Error('Fictional network failure')};await f.run();await f.nodes.get('#logout').onclick();assert(f.c.App.me,'failed server logout must keep Settings, not pretend the cookie was cleared');assert.equal(f.counts().forgot,0);assert.equal(f.counts().login,0);assert.match(f.notices.at(-1),/Could not log out/);assert.equal(f.nodes.get('#logout').disabled,false,'failure allows Retry');
 f=fixture();let finish;f.c.FoodThread.pendingCount=()=>new Promise(resolve=>finish=resolve);await f.run();const once=f.nodes.get('#logout').onclick();await f.nodes.get('#logout').onclick();assert.equal(f.nodes.get('#logout').disabled,true);finish(0);await once;assert.equal(f.writes.filter(w=>w[0]==='/api/logout').length,1,'duplicate tap cannot revoke or erase twice');
 f=fixture();f.c.FoodThread.pendingCount=()=>new Promise(resolve=>finish=resolve);await f.run();const old=f.nodes.get('#logout').onclick();f.c.App.me={id:2,login:'zz_test_other'};f.c.session++;finish(0);await old;assert.equal(f.c.App.me.id,2);assert.equal(f.writes.length,0);assert.equal(f.counts().erased,0,'late old-account work cannot erase the new account');
 f=fixture();f.c.Native.forget=()=>new Promise(resolve=>finish=resolve);await f.run();const clearing=f.nodes.get('#logout').onclick();for(let i=0;i<8;i++)await Promise.resolve();f.c.App.me={id:2,login:'zz_test_other'};f.c.session++;finish();await clearing;assert.equal(f.c.App.me.id,2);assert(!f.writes.some(w=>w[0]==='fit.queue'),'late native cleanup cannot remove the new account queue or session');
 console.log('Settings: final logout row, successful sign-out/session cleanup, other-account queue preserved, cancelled/failed pending check retains drafts; failed server request, duplicates and stale-account callbacks guarded PASS');
})().catch(e=>{console.error(e);process.exit(1)});

// Exercise the shared adult/consent helper, including a late response after changing accounts.
(async()=>{
 const app=fs.readFileSync(process.env.KINETTA_TEST_CONSENT_SOURCE||'app/static/app.js','utf8'),start=app.indexOf('function aiSheet(after)'),end=app.indexOf('// ---------- login',start);
 function consent(){
  const nodes=new Map(),box={isConnected:true},state={owner:'A',calls:[],kept:[],toasts:[],after:0};
  const c={App:{me:{id:1,ai_ok:false}},readOwner:()=>state.owner,aiExplain:()=>'',aiAdultBox:()=>'',sheet:(title,html,wire)=>wire(box,()=>{}),$:(key)=>{if(!nodes.has(key))nodes.set(key,{checked:true});return nodes.get(key)},json:(method,body)=>({method,body}),keep:(path,data)=>state.kept.push(data.id),toast:t=>state.toasts.push(t),api:(...args)=>{state.calls.push(args);return new Promise((resolve,reject)=>{state.finish=resolve;state.fail=reject})}};
  vm.createContext(c);vm.runInContext(app.slice(start,end),c);c.aiSheet(()=>state.after++);return {c,nodes,box,state,tap:()=>nodes.get('#ai-yes').onclick({target:nodes.get('#ai-yes')})};
 }
 let f=consent();f.c.$('[name=ai_adult]').checked=false;await f.tap();assert.equal(f.state.calls.length,0,'adult confirmation remains required');assert.match(f.nodes.get('#ai-age-err').textContent,/18/);
 f=consent();const old=f.tap();f.state.owner='B';f.c.App.me={id:2,ai_ok:false};f.state.finish({});await old;assert.equal(f.c.App.me.ai_ok,false,'old consent response cannot mark the new account On');assert.deepEqual(f.state.kept,[]);assert.equal(f.state.after,0);
 f=consent();const failed=f.tap();f.state.owner='B';f.c.App.me={id:2,ai_ok:false};f.state.fail(Error('Old account failure'));await failed;assert.deepEqual(f.state.toasts,[],'stale errors cannot appear for a new account');
 f=consent();f.box.isConnected=false;await f.tap();assert.equal(f.state.calls.length,0,'a dismissed old consent control cannot send');
 f=consent();const accepted=f.tap();f.box.isConnected=false;f.state.finish({});await accepted;assert.equal(f.c.App.me.ai_ok,true,'an accepted same-account consent updates state after dismissal');assert.deepEqual(f.state.kept,[1]);
 // The new Kit sheet applies an accepted Off response even if that sheet was dismissed.
 async function off(changeOwner=false){const f=fixture();f.c.App.me.ai_ok=true;const buttons=[{dataset:{ai:'1'}},{dataset:{ai:'0'}}],box={isConnected:true};f.c.$$=sel=>sel==='[data-ai]'?buttons:[];f.c.sheet=(title,html,wire)=>wire(box,()=>{});let finish,kept=0;f.c.api=()=>new Promise(r=>finish=r);f.c.keep=()=>kept++;f.c.invalidate=()=>{};await f.run();f.nodes.get('#m-kit').onclick();const task=buttons[1].onclick();box.isConnected=false;if(changeOwner){f.c.App.me={id:2,ai_ok:true};f.c.session++;}finish({});await task;assert.equal(f.c.App.me.ai_ok,changeOwner,'Off acknowledges only the captured account after dismissal');assert.equal(kept,changeOwner?0:1);}
 await off();await off(true);console.log('Kit consent UI: adult confirmation, stale owner/read/error fences, dismissed same-owner On/Off acknowledgement and own cache PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
