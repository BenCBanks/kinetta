// The Me page paints a stable Today skeleton before its conditional sources resolve.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8');
const start=source.indexOf('async function meOverview'),end=source.indexOf('function goalFmt',start);
assert(start>=0&&end>start,'the Me page coordinator is available in pages.js');
const code=source.slice(start,end);
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return{promise,resolve};};

async function run(){
 const fixtureNow=new Date('2026-11-09T17:00:00.000Z');
 const fixtureZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const fixtureDay=fixtureNow.toLocaleDateString('en-CA',{timeZone:fixtureZone});
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[fixtureNow]));}static now(){return fixtureNow.getTime();}}
 const selectors=['#t-today','#t-required','#t-start','#t-setup','#t-recap','#t-checkin','#t-combined-week','#t-goals','#t-form','#t-insights'];
 const nodes=new Map(selectors.map(selector=>[selector,{innerHTML:'',hidden:false,dataset:{},isConnected:true}]));
 const pending=new Map(),el={innerHTML:'',isConnected:true};
 const read=path=>{const value=deferred();pending.set(path,value);return value.promise;};
 const ctx={
  console,Date:FixtureDate,Promise,Set,Intl,URLSearchParams,location:{search:''},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},
  window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>1,clearTimeout(){},
  $:selector=>nodes.get(selector)||null,$$:()=>[],
  App:{me:{id:1,name:'Fictional user',setup_hidden:true,kcal_target:null,friend_count:1}},
  MeCard:{header:()=>'<section class="me-card">Shared profile</section>',mount(){}},
  Native:{on:false,healthOn:()=>Promise.resolve(false)},viewResources:{set(){}},
  readOwner:()=>1,api:read,
  load:(path,paint)=>{const value=path.includes('/fitness?')?{days:[]}:[];paint(value);return Promise.resolve(value);},
  getStarted:()=>'',esc:String,svg:()=>'',SPORT_NAMES:{run:'Run'},IC:{run:'run'},
  U:{du:()=> 'mi',dist:value=>String(value)},meInsights(){},
  $$:()=>[],weeklyCheckinCard:()=>Promise.resolve(),combinedWeek:()=>{},
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const done=ctx.meOverview(el),today=nodes.get('#t-today');
 assert.match(today.innerHTML,/aria-busy="true"/,'Today exposes its loading state immediately');
 assert.equal((today.innerHTML.match(/me-today-skeleton/g)||[]).length,2,'Today reserves one skeleton per possible row');
 assert.equal(today.dataset.loading,'true','the loading token remains active while sources are pending');
 assert.deepEqual([...pending.keys()],['/api/activities?limit=1','/api/plans/current','/api/food/history?days=30',`/api/food/day?d=${fixtureDay}`]);

 const zone=fixtureZone;
 const day=fixtureDay;
 pending.get('/api/activities?limit=1').resolve([]);
 pending.get('/api/plans/current').resolve({today:day,plan:{id:9101,unit:'mi'},today_workout:{type:'run',title:'Easy run',minutes:30,day}});
 pending.get('/api/food/history?days=30').resolve([]);
 pending.get(`/api/food/day?d=${day}`).resolve({day,entries:[],totals:{},unknown_nutrients:{},targets:{},has_history:false,food_user:false});
 await done;
 assert.equal(today.dataset.loadedDay,day,'Today records the completed local date');
 assert.equal(today.dataset.loading,undefined,'the loading state ends after source reads settle');
 assert.equal((today.innerHTML.match(/data-today-activity/g)||[]).length,1,'the active plan produces one activity row');
 assert.match(today.innerHTML,/Easy run · 30 min/,'the planned session is rendered in Today');
 assert.match(today.innerHTML,/On your plan/,'the row explains that the session is planned');
 assert.match(today.innerHTML,/href="\/plan"/,'the planned row opens the plan');
 assert.doesNotMatch(today.innerHTML,/data-today-food/,'a non-food user does not get a food row');
 assert.doesNotMatch(el.innerHTML,/Your dashboard|t-plan|t-food/,'the removed dashboard and plan/food cards stay absent');
 console.log('Me Today first paint: two reserved skeleton rows, pending read barrier, planned row after reads, no food row for a non-food user PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
