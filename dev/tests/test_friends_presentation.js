'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const c={esc,avatar:()=>'<span class="avatar"></span>',profileHref:p=>'/people/'+encodeURIComponent(p.login),backBtn:l=>'<button>'+esc(l)+'</button>',svg:()=>'',skel:()=>'',App:{me:{login:'zz_test_owner',name:'Fictional Owner'}}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/friends-ui.js','utf8')+'\nglobalThis.ui=FriendsUI;',c);
const person={login:'zz_test_<script>',name:'Fictional <img onerror="x">'},r={friends:[person],incoming:[{...person,via_card:true}],outgoing:[person]};
assert(c.ui.matches({name:'River Runner',login:'zz_test_river'},'@ZZ_TEST_RIVER'));assert(c.ui.matches({name:'River Runner',login:'zz_test_river'},' runner '));assert(!c.ui.matches(person,'no such name'));
for(const html of [c.ui.lists(r),c.ui.sentRows(r.outgoing)]){assert(!html.includes('<img onerror='));assert(html.includes('&lt;img'));assert(html.includes('/people/zz_test_%3Cscript%3E'));}
const list=c.ui.lists(r);assert(list.includes('data-request-menu'));assert(!list.includes('data-blk='),'Block starts inside the request menu');assert(list.includes('data-manage='));assert(list.includes('via your card'));assert(!c.ui.lists({...r,incoming:[]}).includes('via your card'),'card origin only accompanies requests');
assert(c.ui.sent(r.outgoing).includes('1 request sent'));assert(!c.ui.sent([]));assert(c.ui.lists({friends:[],incoming:[]}).includes('data-invite-empty'));assert(!c.ui.shell('Activity').includes('friends-challenges'),'full Challenges belongs on Activity');
console.log('Friends presentation: escaped names, full profiles, local matching, safe request menu, collapsed sent requests and deliberate empty actions PASS');
