'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const c={esc,avatar:()=>'<span class="av"></span>',profileHref:p=>'/people/'+encodeURIComponent(p.login),backBtn:l=>'<button>'+esc(l)+'</button>',svg:()=>'',skel:()=>'',App:{me:{login:'zz_test_owner',name:'Fictional Owner'}}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/friends-ui.js','utf8')+'\nglobalThis.ui=FriendsUI;',c);
const person={login:'zz_test_<script>',name:'Fictional <img onerror="x">'},r={friends:[person],incoming:[{...person,via_card:true}],outgoing:[person]};
assert(c.ui.matches({name:'River Runner',login:'zz_test_river'},'@ZZ_TEST_RIVER'));assert(c.ui.matches({name:'River Runner',login:'zz_test_river'},' runner '));assert(!c.ui.matches(person,'no such name'));
for(const html of [c.ui.lists(r),c.ui.sentRows(r.outgoing)]){assert(!html.includes('<img onerror='));assert(html.includes('&lt;img'));assert(html.includes('/people/zz_test_%3Cscript%3E'));}
const list=c.ui.lists(r);assert(list.includes('data-request-menu'));assert(!list.includes('data-blk='),'Block starts inside the request menu');assert(list.includes('data-manage='));assert(list.includes('via your card'));assert(!c.ui.lists({...r,incoming:[]}).includes('via your card'),'card origin only accompanies requests');
assert(c.ui.sent(r.outgoing).includes('1 request sent'));assert(!c.ui.sent([]));assert(c.ui.lists({friends:[],incoming:[]}).includes('data-invite-empty'));assert(!c.ui.shell('Activity').includes('friends-challenges'),'full Challenges belongs on Activity');
console.log('Friends presentation: escaped names, full profiles, local matching, safe request menu, collapsed sent requests and deliberate empty actions PASS');

assert(!c.ui.shell('Activity').includes('href="/me/challenges"'),'Challenge navigation belongs to Activity; Invite remains on Friends');
assert(c.ui.shell('Activity').includes('id="fr-invite"'));
const challengeRoutes=[];c.route=(pattern,tab)=>challengeRoutes.push({pattern,tab});
vm.runInContext(fs.readFileSync('app/static/challenges.js','utf8')+'\nglobalThis.challengeUI=Challenges;',c);
const challenge=(code,days,extra={})=>({code,member:true,target:4,unit:'days',self:{value:2,days_left:days,finished:false},...extra});
assert.equal(c.challengeUI.summary([]),null);
assert.equal(c.challengeUI.summary([challenge('left',1,{member:false}),challenge('done',0,{self:{finished:true}})]),null);
const summary=c.challengeUI.summary([challenge('later',5),challenge('soon',1)]);assert.equal(summary.count,2);assert.equal(summary.first.code,'soon');assert.equal(summary.progress,'2 / 4 days');
assert(c.challengeUI.summary([challenge('reached',1,{self:{value:4,days_left:1,complete:true,finished:false}})]),'Reaching the target does not end a live challenge');
assert(c.challengeUI.summary([challenge('future',8,{start:'2099-01-01'})]),'Upcoming participation stays discoverable');
for(const registered of challengeRoutes)assert.equal(registered.tab,'activity');
const back=c.challengeUI.activityBack({classList:{add(){} }});assert(back.includes('href="/activity"')&&back.includes('Back to Activity'));
console.log('Challenge presentation: finished/left excluded, soonest active personal progress, reached/upcoming retained, old routes on Activity and explicit parent PASS');
