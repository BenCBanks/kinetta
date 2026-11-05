'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/segments.js','utf8');
async function render(board,search=''){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{isConnected:true,innerHTML:'',textContent:'',setAttribute(){}});return nodes.get(key);};
 const detail={id:12,name:'Fictional park loop',sport:'run',distance_m:1000,created:'2026-01-01',status:'active',audience:'everyone',line:'fictional',saved:false};
 const effort={id:1,activity_id:3,activity_name:'Fictional morning run',elapsed_s:300,started:'2026-10-31',state:'ok',public:false,why_not:'source'};
 const c={console,URLSearchParams,App:{me:{id:1}},serverKey:()=> 'https://example.test',readOwner:()=> 'fixture-owner',route(){},location:{search},history:{replaceState(){}},replacePageAddress(){},
  $:s=>node(s),$$:()=>[],esc:String,svg:()=>'',skel:()=>'',backBtn:()=>'',wireBack(){},mapInto:async()=>null,arrows(){},decode:()=>[],fdate:String,dur:s=>String(s),avatar:()=>'',SPORT_NAMES:{run:'Run'},
  U:{dist:String,du:()=> 'km',elev:String,eu:()=> 'm',pace:String,pu:()=> '/km'},
  api:async path=>path.endsWith('/leaderboard')?board:path.endsWith('/efforts')?{efforts:[effort],near_misses:[]}:detail};
 vm.createContext(c);vm.runInContext(source+'\nthis.segments=Segments',c);await c.segments.page(node('page'),12);await new Promise(resolve=>setImmediate(resolve));return nodes;
}
(async()=>{
 const solo={public:true,paused:false,count:1,rows:[{me:true}],me:{rank:1,joined:true}};
 for(const search of ['','?tab=board']){
  const nodes=await render(solo,search),body=nodes.get('#sg-body').innerHTML;
  assert(!body.includes('data-t="board"'),'solo segment has no leaderboard tab, including old deep links');assert(body.includes('<h2>Your times</h2>'));
  assert.match(nodes.get('#sg-tab').innerHTML,/Your best/);assert.doesNotMatch(nodes.get('#sg-tab').innerHTML,/rank|of 1/,'personal source-restricted effort has no rank');
 }
 for(const data of [{...solo,count:2},{...solo,me:{rank:null},count:1,rows:[{me:false}]}]){
  const nodes=await render(data),body=nodes.get('#sg-body').innerHTML;
  assert(body.includes('data-t="board"'),'another eligible member exposes Leaderboard, even when own time is private');assert(body.includes('data-t="mine" aria-selected="true"'),'Your times is the default');assert.match(nodes.get('#sg-tab').innerHTML,/Your best/);
 }
 for(const data of [{...solo,public:false,count:2},{...solo,paused:true,count:2},{...solo,count:0,me:{rank:null}}])assert(!(await render(data)).get('#sg-body').innerHTML.includes('data-t="board"'),'private, paused and empty boards stay out of the tabs');
 console.log('PASS segment Your times: solo/old link, others/default, private own source, paused/private/empty eligibility');
})().catch(e=>{console.error(e);process.exitCode=1;});
