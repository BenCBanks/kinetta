// Production social renderers/handlers under latency, retries and account-safe API stand-ins.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/social.js','utf8');
const tick=()=>new Promise(setImmediate);
(async()=>{
 let editorOwner='first';const c={readOwner:()=>editorOwner,esc:String,stat:(k,v,u='')=>`[${k}:${v}${u}]`,U:{dist:n=>(n/1000).toFixed(1),du:()=> 'km'},dur:n=>n+' seconds',fdate:d=>d};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function profileProgress('),source.indexOf('function shareProfile(')),c);
 const recent={start:'2026-09-21',end:'2026-10-20',current:{activities:3,distance_m:5000,time_s:3600,active_days:2},previous:{activities:1}};
 let html=c.profileProgress(recent,true);assert(html.includes('[Distance:5.0km]'));assert(html.includes('2 active days'));assert(html.includes('1 workout in the previous 30 days'));assert(html.includes('shared with friends or everyone'));
 html=c.profileProgress({...recent,current:{activities:2,distance_m:0,time_s:1800,active_days:1}},false);assert(!html.includes('[Distance:'));assert(html.includes('[Active days:1]'));assert(html.includes('shared with you'));
 html=c.profileProgress({...recent,current:{activities:0}},true);assert(html.includes('Your shared workouts will build'));assert(!html.includes('[Workouts:0]'));
 // Your own profile belongs to Me; other people's profiles remain in Activity.
 c.App={me:{login:'alex'}};vm.runInContext(source.slice(source.indexOf('const profileTab'),source.indexOf('route(/^\\/people'))+'\nglobalThis.tab=profileTab;',c);
 assert.equal(c.tab('ALEX'),'me');assert.equal(c.tab('jordan'),'activity');
 // The actual Friends page: local matches first, stale requests ignored, errors retryable, clear restores lists.
 const input={value:''}, form={elements:{q:input}}, found={isConnected:true,innerHTML:'',setAttribute(k,v){this[k]=v;}},lists={innerHTML:''},clear={},status={};
 const suggest={isConnected:true,innerHTML:''};
 const nodes={'#fr-find':form,'#fr-found':found,'#fr-lists':lists,'#fr-clear':clear,'#fr-status':status,'#fr-browse':{},'[data-retry]':{},'#fr-suggest':suggest,'#fr-invite':{}};
 const pending=[],timers=new Map();let timerId=0,handler;
 Object.assign(c,{$:s=>nodes[s]||{},$$:()=>[],location:{search:'',href:'https://example.test/me/friends'},URL,URLSearchParams,history:{state:null,replaceState(){}},profileHref:p=>'/people/'+p.login,avatar:()=>'',backBtn:()=>'',svg:()=>'',skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',personLink:p=>`<a>${p.name} @${p.login}</a>`,wireBack(){},Social:{set(){}},inviteFriends(){},suggestedPeople:async()=>[],peopleRow(){},viewResources:new Map(),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),route:(re,tab,fn)=>{handler=fn;},api:path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject})),load:async(path,draw)=>draw({friends:[{name:'Jordan Fixture',login:'jordan'}],incoming:[],outgoing:[]})});
 vm.runInContext(source.slice(source.indexOf("route(/^\\/me\\/friends$/"),source.indexOf('// ---------- report or block someone')),c);
 await handler({});assert(!found.innerHTML);assert(lists.innerHTML.includes('Jordan Fixture'));assert(lists.innerHTML.includes('data-manage='));assert(!lists.innerHTML.includes('data-rm='));
 function type(text){input.value=text;input.oninput();}
 function flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}
 type('Jordan');assert(found.innerHTML.includes('Jordan Fixture'));assert.equal(pending.length,0,'known friend appears before network');assert(lists.hidden);assert(suggest.hidden,'suggestions hide while searching');flush();assert.equal(pending.length,1);
 type('Sam');assert(!found.innerHTML.includes('Jordan Fixture'),'old result actions removed while searching');flush();assert.equal(pending.length,2);
 pending[1].resolve([{name:'Sam Fixture',login:'sam',status:null}]);await tick();assert(found.innerHTML.includes('Sam Fixture'));assert.equal(status.textContent,'1 person found');
 pending[0].resolve([{name:'Old Jordan',login:'jordan',status:null}]);await tick();assert(!found.innerHTML.includes('Old Jordan'),'late response cannot replace new results');
 type('offline');flush();pending[2].reject(new Error('Connection failed'));await tick();assert(found.innerHTML.includes('Retry search'));assert.equal(input.value,'offline');nodes['[data-retry]'].onclick();pending[3].resolve([]);await tick();assert(found.innerHTML.includes('No people found'));
 type('late');flush();type('');pending[4].resolve([{name:'Late fixture',login:'late'}]);await tick();assert.equal(found.innerHTML,'');assert.equal(lists.hidden,false);assert.equal(clear.hidden,true);
 type('detached');flush();found.isConnected=false;pending[5].resolve([{name:'Detached fixture',login:'other'}]);await tick();assert(!found.innerHTML.includes('Detached fixture'));
 // Real editor: failed atomic save keeps name AND bio; retry updates the normalised name and closes.
 const outer=Object.fromEntries(['#pf-photo','#pf-share','#pf-edit-profile','#pf-name','#pf-bio'].map(k=>[k,{}]));
 const f={elements:{name:{value:'New name',focus(){}},bio:{value:'Draft bio',focus(){}}}},save={},error={},cancel={},photo={};let closed=false,reloaded=0,attempts=0;
 c.$=(sel,box)=>box===outer?outer[sel]:sel==='#pf-editor'?f:sel==='[type="submit"]'?save:sel==='.err'?error:sel==='[data-cancel]'?cancel:photo;
 c.sheet=(title,html,mount)=>mount({},()=>closed=true);c.profilePhotoSheet=()=>{};c.invalidate=()=>{};c.keep=()=>{};c.invalidateFeed=()=>{};c.toast=()=>{};c.App={me:{name:'Old name'}};c.json=(method,body)=>body;
 c.api=async(path,body)=>{assert.equal(path,'/api/account');assert.deepEqual(JSON.parse(JSON.stringify(body)),{name:'New name',bio:'Draft bio'});if(++attempts===1)throw new Error('Try again');return {name:'New name'};};
 vm.runInContext(source.slice(source.indexOf('function wireProfileEditing('),source.indexOf("route(/^\\/me\\/friends$/")),c);
 c.wireProfileEditing(outer,{name:'Old name',bio:''},()=>reloaded++);outer['#pf-edit-profile'].onclick();await f.onsubmit({preventDefault(){}});assert.equal(closed,false);assert.equal(error.textContent,'Try again');assert.equal(f.elements.bio.value,'Draft bio');assert.equal(save.disabled,false);await f.onsubmit({preventDefault(){}});assert(closed);assert.equal(c.App.me.name,'New name');assert.equal(c.App.me.bio,'Draft bio');assert.equal(reloaded,1);
 // The shared Settings/profile editor never submits an old draft to a new account,
 // or applies an old account's delayed response to the person now signed in.
 save.disabled=false;closed=false;c.editProfile({name:'Old name',bio:''},()=>reloaded++);editorOwner='second';
 const beforeStale=attempts;await f.onsubmit({preventDefault(){}});assert.equal(attempts,beforeStale);assert(closed);
 editorOwner='first';save.disabled=false;closed=false;c.editProfile({name:'Old name',bio:''},()=>reloaded++);
 let finish;c.api=()=>new Promise(resolve=>finish=resolve);const saving=f.onsubmit({preventDefault(){}});
 editorOwner='second';c.App.me={name:'Other account',bio:'Other bio'};finish({name:'Old response'});await saving;
 assert.equal(c.App.me.name,'Other account');assert.equal(c.App.me.bio,'Other bio');assert.equal(reloaded,1);assert(closed);
 // Friend-management failure preserves controls; success clears cached visibility and runs the refresh.
 const buttons={'[data-remove]':{},'[data-block]':{}},err={},invalidated=[];let membershipClosed=false,changed=null,allow=true,failMembership=true;
 c.sheet=(title,html,mount)=>mount({},()=>membershipClosed=true);c.$=sel=>buttons[sel]||err;c.$$=()=>Object.values(buttons);c.confirm=()=>allow;c.invalidate=path=>invalidated.push(path);c.json=(method,body)=>({method,body});
 c.api=async(path,options)=>{assert.equal(path,'/api/friends/jordan');assert.equal(options.method,'DELETE');if(failMembership)throw new Error('Offline');};
 vm.runInContext(source.slice(source.indexOf('function friendshipSheet('),source.indexOf('// These numbers are calculated')),c);
 c.friendshipSheet({login:'jordan',name:'Jordan'},result=>changed=result);await buttons['[data-remove]'].onclick();assert.equal(err.textContent,'Offline');assert.equal(membershipClosed,false);assert(Object.values(buttons).every(b=>!b.disabled));
 allow=false;await buttons['[data-remove]'].onclick();assert.equal(membershipClosed,false);allow=true;failMembership=false;await buttons['[data-remove]'].onclick();assert(membershipClosed);assert.equal(changed.blocked,false);assert(invalidated.includes('/api/shared/'));assert(invalidated.includes('/api/people/'));
 // Native share cancellation is quiet; unavailable sharing exposes a copyable authenticated link.
 let sharePayload,shareSheet=null;const copyInput={select(){}},copyButton={},copyStatus={};
 c.appBase=()=> 'https://example.test';c.navigator={share:payload=>{sharePayload=payload;return Promise.reject({name:'AbortError'});},clipboard:{writeText:async url=>assert.equal(url,'https://example.test/people/alex')}};
 c.sheet=(title,html,mount)=>{shareSheet={title,html};mount({});};c.$=sel=>sel==='input'?copyInput:sel==='#pf-copy'?copyButton:copyStatus;
 vm.runInContext(source.slice(source.indexOf('function shareProfile('),source.indexOf('// One editor saves')),c);
 c.shareProfile({login:'alex',name:'Alex'});await tick();assert.equal(sharePayload.url,'https://example.test/people/alex');assert.equal(shareSheet,null);
 c.navigator.share=undefined;c.shareProfile({login:'alex',name:'Alex'});assert(shareSheet.html.includes('sharing choices still apply'));await copyButton.onclick();assert.equal(copyStatus.textContent,'Link copied');
 console.log('Social profiles: visible progress/no-distance/empty, own tab, immediate friend matching, reordered/failed/detached search, clear and atomic editor retry PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
