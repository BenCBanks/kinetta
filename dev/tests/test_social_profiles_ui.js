// Production social renderers/handlers under latency, retries and account-safe API stand-ins.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/social.js','utf8');
const tick=()=>new Promise(setImmediate);
(async()=>{
 let editorOwner='first';const c={readOwner:()=>editorOwner,esc:String,stat:(k,v,u='')=>`[${k}:${v}${u}]`,U:{dist:n=>(n/1000).toFixed(1),du:()=> 'km'},dur:n=>n+' seconds',fdate:d=>d};vm.createContext(c);
 // Your own profile belongs to Me; other people's profiles remain in Activity.
 c.App={me:{login:'alex'},cache:new Map()};vm.runInContext(source.slice(source.indexOf('const profileTab'),source.indexOf('route(/^\\/people'))+'\nglobalThis.tab=profileTab;',c);
 assert.equal(c.tab('ALEX'),'me');assert.equal(c.tab('jordan'),'activity');
 // The actual Friends page: local matches first, stale requests ignored, errors retryable, clear restores lists.
 const input={value:''}, form={elements:{q:input}}, found={isConnected:true,innerHTML:'',setAttribute(k,v){this[k]=v;}},lists={innerHTML:'',isConnected:true,hidden:false},clear={},status={};
 const suggest={isConnected:true,innerHTML:'',parentElement:{hidden:false}},friendRow={hidden:false};
 const nodes={'#fr-find':form,'#fr-found':found,'#fr-lists':lists,'#fr-clear':clear,'#fr-status':status,'#fr-browse':{},'[data-retry]':{},'#fr-suggest':suggest,'#fr-invite':{},'#fr-title':{},'#fr-list-error':{},'#fr-filter-empty':{},'#fr-sent':{},'#fr-sent-open':null,'#fr-sharing span':{},'#fr-filter':null,'[data-find-people]':null,'[data-invite-empty]':null};
 const pending=[],timers=new Map();let timerId=0,handler;
 Object.assign(c,{Challenges:{mount(){}},$:s=>Object.hasOwn(nodes,s)?nodes[s]:{},$$:sel=>sel==='#fr-own-list .fr-friend'?[friendRow]:[],VIS_SHORT:{everyone:'Everyone'},location:{search:'',href:'https://example.test/me/friends'},URL,URLSearchParams,history:{state:null,replaceState(){}},profileHref:p=>'/people/'+p.login,avatar:()=>'',backBtn:()=>'',svg:()=>'',skel:()=>'',skelFeed:()=>'',skelChart:()=>'',skelFood:()=>'',personLink:p=>`<a>${p.name} @${p.login}</a>`,wireBack(){},Social:{set(){}},inviteFriends(){},suggestedPeople:async()=>[],peopleRow(){},viewResources:new Map(),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),route:(re,tab,fn)=>{handler=fn;},screenHit:()=>null,kept:()=>null,keep(){},api:path=>path==='/api/sharing'?Promise.resolve({default:'everyone'}):path==='/api/friends'?Promise.resolve({friends:[{name:'Jordan Fixture',login:'jordan'}],incoming:[],outgoing:[]}):new Promise((resolve,reject)=>pending.push({path,resolve,reject})),load:async(path,draw)=>draw({friends:[{name:'Jordan Fixture',login:'jordan'}],incoming:[],outgoing:[]})});
 vm.runInContext(fs.readFileSync('app/static/friends-ui.js','utf8'),c);
 vm.runInContext(source.slice(source.indexOf("route(/^\\/me\\/friends$/"),source.indexOf('// ---------- report or block someone')),c);
 await handler({isConnected:true,classList:{add(){}},insertAdjacentHTML(){}});assert(!found.innerHTML);assert(lists.innerHTML.includes('Jordan Fixture'));assert(lists.innerHTML.includes('data-manage='));assert(!lists.innerHTML.includes('data-rm='));
 function type(text){input.value=text;input.oninput();}
 function flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}
 type('Jordan');assert.equal(friendRow.hidden,false,'known friend is filtered locally');assert(!found.innerHTML.includes('Jordan Fixture'),'friends are not duplicated among other people');assert.equal(pending.length,0,'known friend appears before network');assert.equal(lists.hidden,false,'your friends stay above discovery');assert(suggest.hidden,'suggestions hide while searching');flush();assert.equal(pending.length,1);
 type('Sam');assert.equal(friendRow.hidden,true,'local friends filter immediately before a reply');assert(!found.innerHTML.includes('Jordan Fixture'),'old result actions removed while searching');flush();assert.equal(pending.length,2);
 pending[1].resolve([{name:'Sam Fixture',login:'sam',status:null}]);await tick();assert(found.innerHTML.includes('Sam Fixture'));assert.equal(status.textContent,'1 other person found');
 pending[0].resolve([{name:'Old Jordan',login:'jordan',status:null}]);await tick();assert(!found.innerHTML.includes('Old Jordan'),'late response cannot replace new results');
 type('offline');flush();pending[2].reject(new Error('Connection failed'));await tick();assert(found.innerHTML.includes('Retry search'));assert.equal(input.value,'offline');nodes['[data-retry]'].onclick();pending[3].resolve([]);await tick();assert(found.innerHTML.includes('No people found'));
 type('late');flush();type('');pending[4].resolve([{name:'Late fixture',login:'late'}]);await tick();assert.equal(found.innerHTML,'');assert.equal(lists.hidden,false);assert.equal(friendRow.hidden,false,'clear restores the owned friend list');assert.equal(clear.hidden,true);
 type('detached');flush();found.isConnected=false;pending[5].resolve([{name:'Detached fixture',login:'other'}]);await tick();assert(!found.innerHTML.includes('Detached fixture'));
 // The separate sheet is retired; every Settings entry uses the same inline card editor.
 const profile=fs.readFileSync('app/static/profile.js','utf8'),pages=fs.readFileSync('app/static/pages.js','utf8');
 assert(!source.includes('function editProfile(')&&!source.includes('Draft preview')&&!source.includes('pf-editor'));
 assert(!profile.includes('data-card-identity')&&!profile.includes('function editor(box,initial'));
 assert(pages.includes("$('#m-profile', el).onclick = () => MeCard.openEditor()"));
 assert(profile.includes("openEditor:()=>go('/me?edit=profile')"));
 // Atomic inline save/retry/cancel/account behavior is exercised with real DOM in profile_card_ui.cjs.
 c.invalidate=()=>{};c.keep=()=>{};c.invalidateFeed=()=>{};c.toast=()=>{};c.App={me:{name:'Old name'}};
 // Friend-management confirmation/retry/account behavior is covered by test_friend_management.js.
 // Native share cancellation is quiet; unavailable sharing exposes a copyable authenticated link.
 let sharePayload,shareSheet=null,cardOpens=0,closedShares=0;
 const copyInput={select(){this.selected=true;},selected:false};
 c.appBase=()=> 'https://example.test';c.navigator={share:payload=>{sharePayload=payload;return Promise.reject({name:'AbortError'});},clipboard:{writeText:async()=>{}}};
 // Only controls actually present in the rendered sheet exist. Unknown selectors return null.
 c.sheet=(title,html,mount)=>{const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{textContent:'',disabled:false}]));const box={nodes,isConnected:true};shareSheet={title,html,box};mount(box,()=>{box.isConnected=false;closedShares++;});};
 c.$=(sel,box)=>sel==='input'?copyInput:box?.nodes[sel]||null;c.KinettaCard={open:()=>cardOpens++};
 vm.runInContext(source.slice(source.indexOf('function shareProfile('),source.indexOf("route(/^\\/me\\/friends$/")),c);
 c.shareProfile({login:'alex',name:'Alex'});await tick();assert.equal(sharePayload.url,'https://example.test/people/alex');assert.equal(shareSheet,null);
 c.navigator.share=undefined;c.shareProfile({login:'alex',name:'Alex'});assert(shareSheet.html.includes('sharing choices still apply'));await shareSheet.box.nodes['#pf-copy'].onclick();assert.equal(shareSheet.box.nodes['#pf-copy-status'].textContent,'Link copied');
 c.navigator.clipboard.writeText=async()=>{throw Error('Clipboard denied')};await shareSheet.box.nodes['#pf-copy'].onclick();assert(copyInput.selected);assert(shareSheet.box.nodes['#pf-copy-status'].textContent.includes('Select and copy'));
 c.api=async()=>({url:'/add/fictional-invitation'});await c.inviteFriends();assert.equal(typeof shareSheet.box.nodes['#iv-public-card'].onclick,'function','The advertised card action must work');shareSheet.box.nodes['#iv-public-card'].onclick();assert.equal(cardOpens,1);assert.equal(closedShares,1);
 let resolveInvite;c.api=()=>new Promise(resolve=>resolveInvite=resolve);shareSheet=null;const oldInvite=c.inviteFriends();editorOwner='third';resolveInvite({url:'/add/old-account-link'});await oldInvite;assert.equal(shareSheet,null,'An old account’s delayed invite link cannot appear after login changes');
 c.navigator.share=()=>new Promise((_,reject)=>{c.rejectShare=reject});c.shareProfile({login:'alex',name:'Alex'});editorOwner='fourth';c.rejectShare({name:'Unavailable'});await tick();assert.equal(shareSheet,null,'A late native share failure cannot reopen an old account’s sheet');
 console.log('Social profiles: own tab, friend matching, reordered/failed/detached search, unified editor entry, working share/copy/invite controls and account fences PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
