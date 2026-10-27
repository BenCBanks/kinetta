// Exercise production recipient-page guards and durable copy confirmations with delayed/lost replies.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/route-sharing.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(){
 const nodes=new Map(),storage={},moves=[],bodies=[];let owner='first';
 const node=s=>{if(!nodes.has(s))nodes.set(s,{isConnected:true,innerHTML:'',textContent:'',disabled:false,closest:()=>null});return nodes.get(s)};
 const localStorage={};Object.defineProperty(localStorage,'setItem',{value(k,v){localStorage[k]=v;}});Object.defineProperty(localStorage,'removeItem',{value(k){delete localStorage[k]}});
 const c={console,URLSearchParams,crypto:require('node:crypto').webcrypto,App:{me:{id:1}},Native:{base:''},location:{origin:'https://example.test'},
  serverKey:()=> 'https://example.test',readOwner:()=>owner,localStorage,store:{get(k){try{return JSON.parse(localStorage[k])}catch(_){return null}},del(k){delete localStorage[k]}},
  esc:String,skel:()=>'<skeleton>',skelFeed:()=>'<skeleton>',skelChart:()=>'<skeleton>',skelFood:()=>'<skeleton>',backBtn:()=>'',wireBack(){},route(){},viewResources:new Map(),mapInto:async()=>null,cleanViews(){},RouteDownloads:{tools(){},fromShared:r=>r},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},
  $:s=>node(s),stat:()=>'',U:{dist:x=>x,du:()=> 'm',elev:x=>x,eu:()=> 'm'},SPORT_NAMES:{run:'Run'},svg:()=>'',
  json:(method,body)=>({method,body:JSON.stringify(body)}),api:async()=>({}),invalidate(){},toast(){},go:url=>moves.push(url),
  sheet(title,html,wire){const body=node('sheet-'+bodies.length);body.html=html;bodies.push(body);wire?.(body,()=>{body.isConnected=false})}};
 vm.createContext(c);vm.runInContext(source+'\nthis.sharing=RouteShare',c);
 return {c,node,moves,bodies,setOwner(v){owner=v;c.App.me={id:v==='first'?1:2}},localStorage};
}
const data={id:3,name:'Fictional public route',sport:'run',line:'??AA',distance_m:500,ascent_m:null,description:'',warnings:[],snapshot_key:'a'.repeat(64),owner:{name:'Fictional publisher'}};
(async()=>{
 for(const cancel of [f=>f.setOwner('second'),f=>{f.node('page').isConnected=false},f=>f.c.viewResources.get(f.node('page'))()]){
  const f=fixture();let release;f.c.api=()=>new Promise(ok=>release=ok);const pending=f.c.sharing.page(f.node('page'),3);cancel(f);release(data);await pending;
  assert.equal(f.node('#shared-route-body').innerHTML,'','late authorized data cannot enter another account/page');
 }
 const f=fixture();f.c.api=async()=>data;await f.c.sharing.page(f.node('page'),3);
 const privateMarkup=f.node('#shared-route-body').innerHTML;assert.match(privateMarkup,/Fictional public route/);
 // A queued tap on the old page cannot open a confirmation for the next signed-in account.
 f.setOwner('second');f.node('#shared-route-copy').onclick();assert.equal(f.bodies.length,0);
 f.setOwner('first');f.node('#shared-route-copy').onclick();let calls=[],fail=true;
 f.c.api=async(path,opts)=>{calls.push(JSON.parse(opts.body));if(fail)throw Error('Response lost');return {id:9}};
 await f.node('#shared-route-copy-confirm').onclick({currentTarget:f.node('#shared-route-copy-confirm')});
 await f.node('#shared-route-copy-confirm').onclick({currentTarget:f.node('#shared-route-copy-confirm')});
 assert.equal(calls[0].client_id,calls[1].client_id,'lost response reuses copy identity');assert.equal(f.moves.length,0);
 fail=false;await f.node('#shared-route-copy-confirm').onclick({currentTarget:f.node('#shared-route-copy-confirm')});assert.equal(f.moves[0],'/routes/plan/9');
 const g=fixture();g.c.api=async()=>data;await g.c.sharing.page(g.node('page'),3);g.node('#shared-route-copy').onclick();let release;
 g.c.api=()=>new Promise(ok=>release=ok);const pending=g.node('#shared-route-copy-confirm').onclick({currentTarget:g.node('#shared-route-copy-confirm')});await tick();g.setOwner('second');release({id:10});await pending;assert.equal(g.moves.length,0);
 // Deletion clears only the selected account's sharing drafts/receipts.
 g.localStorage['kinetta.routeShare:https://example.test:2:draft:3']='second';g.localStorage['kinetta.routeShare:https://example.test:1:draft:3']='first';g.c.sharing.eraseDevice();
 assert.equal(g.localStorage['kinetta.routeShare:https://example.test:2:draft:3'],undefined);assert.equal(g.localStorage['kinetta.routeShare:https://example.test:1:draft:3'],'first');
 console.log('PASS route sharing UI: account/navigation/cleanup guards, stale taps, lost-response identity, late copy replies and own deletion');
})().catch(e=>{console.error(e);process.exitCode=1});
