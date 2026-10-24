// Exercise the actual Sign-in history renderer against the paginated /people contract.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/admin.js','utf8');
const start=source.includes('async function loginAccounts(')?source.indexOf('async function loginAccounts('):source.indexOf('async function loginsView(');
const renderer=source.slice(start),event={created:'2026-10-24T12:00:00Z',login:'zz_test_member',name:'Sam Demo',channel:'app',outcome:'success',stage:'password'};
function fixture(people){
 const nodes=new Map(),calls=[],content={innerHTML:''};
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',hidden:false,disabled:false,dataset:{},insertAdjacentHTML:(_,html)=>{content.appended=(content.appended||'')+html;}});return nodes.get(s)};
 const c={who:{id:1},revision:7,loginAccount:'',loginOutcome:'',reportDays:30,current:'logins',URLSearchParams,Number,Array,Map,
  content,esc:s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),date:String,
  table:(_,rows)=>rows.join(''),rangeSelect:()=>'',wireRange(){},show:v=>calls.push(['show',v]),busy:async(_,fn)=>fn(),
  $:s=>node(s),api:async path=>{calls.push(path);return people(path,c)}};
 vm.createContext(c);vm.runInContext(renderer,c);return {c,calls,content,node};
}
const page=(rows,n=1,pages=1)=>({rows,total:rows.length,page:n,pages});
const person=(id,name='Sam Demo')=>({id,login:'zz_test_'+id,name});
(async()=>{
 // More than 50 people: a later page must be selectable, with its selected ID and escaped label.
 const f=fixture(path=>{const u=new URL(path,'https://example.test');assert.equal(u.pathname,'/people');return u.searchParams.get('page')==='1'?page(Array.from({length:50},(_,i)=>person(i+1)),1,2):page([person(51,'<img src=x onerror=alert(1)>')],2,2)});
 f.c.loginAccount='51';await f.c.loginsView({since:'2026-10-01',items:[event],before:99},7);
 assert.equal(f.calls.length,2);for(const path of f.calls)assert.equal(new URL(path,'https://example.test').searchParams.get('tests'),'true');assert.match(f.content.innerHTML,/value="51" selected/);assert.match(f.content.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(f.content.innerHTML,/<img/);
 f.node('#login-account').value='51';f.node('#login-account').onchange({target:{value:'51'}});assert.equal(f.c.loginAccount,'51');assert.deepEqual(f.calls.at(-1),['show','logins']);
 // Loading older events retains all active filters.
 f.c.api=async path=>{const q=new URL(path,'https://example.test').searchParams;assert.equal(q.get('account'),'51');assert.equal(q.get('outcome'),'failure');assert.equal(q.get('days'),'7');assert.equal(q.get('before'),'99');return {items:[event],before:null}};
 f.c.loginOutcome='failure';f.c.reportDays=7;await f.node('#login-older').onclick({currentTarget:{}});assert.match(f.content.appended,/Sam Demo/);assert.equal(f.node('#login-older').hidden,true);
 // Empty is valid; a deleted/unlisted selected account must not silently look like All accounts.
 const e=fixture(()=>page([]));await e.c.loginsView({since:'now',items:[],before:null},7);assert.match(e.content.innerHTML,/No matching sign-in events/);
 e.c.loginAccount='51';await e.c.loginsView({since:'now',items:[],before:null},7);assert.match(e.content.innerHTML,/value="51" selected/);assert.match(e.content.innerHTML,/not listed/);
 // No partially built report on malformed pagination or a failed later page; Retry can render a fresh result.
 for(const bad of [{rows:{},page:1,pages:1},{rows:[],page:1,pages:1001},{rows:[],page:9,pages:9},null]){
  const b=fixture(()=>bad);await assert.rejects(b.c.loginsView({items:[]},7),/Accounts could not be loaded/);assert.equal(b.content.innerHTML,'');
 }
 const r=fixture(path=>{if(path.includes('page=2'))throw Error('Temporary account failure');return page([person(1)],1,2)});
 await assert.rejects(r.c.loginsView({items:[]},7),/Temporary account failure/);assert.equal(r.content.innerHTML,'');r.c.api=async()=>page([person(1)]);await r.c.loginsView({items:[],before:null},7);assert.match(r.content.innerHTML,/Sign-in history/);
 // Leaving the view, session expiry or a superseding filter request stops pagination and rendering.
 for(const change of [c=>c.revision++,c=>{c.who=null}]){
  const s=fixture((_,c)=>{change(c);return page([person(1)],1,2)});await s.c.loginsView({items:[]},7);assert.equal(s.calls.length,1);assert.equal(s.content.innerHTML,'');
 }
 const stale=fixture(()=>page([person(1)]));await stale.c.loginsView({items:[],before:99},7);stale.c.api=async()=>{stale.c.revision++;return {items:[event],before:null}};await stale.node('#login-older').onclick({currentTarget:{}});assert.equal(stale.content.appended,undefined);
 console.log('PASS admin Sign-in history: real paginated contract, >50 accounts, escaping, filters, older events, empty/unlisted selection, malformed/retry and stale/session guards');
})().catch(e=>{console.error(e);process.exitCode=1});
