// The Me page paints a stable Today skeleton before its conditional sources resolve.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8');
const start=source.indexOf('async function meOverview'),end=source.indexOf('function goalFmt',start);
assert(start>=0&&end>start,'the Me page coordinator is available in pages.js');
const code=source.slice(start,end);
assert.match(code,/if\(fresh&&!hasError\)App\.me\.meTodayUpdatedAt=/,'cached Today draws cannot reset the fresh-data timestamp');
assert.match(code,/else if\(App\.me\.hasFoodHistory!=null\)foodHistory=!!App\.me\.hasFoodHistory/,'food-history failure retains the App.me fallback');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return{promise,resolve,reject};};

async function run(){
 const fixtureNow=new Date('2026-11-09T17:00:00.000Z');
 const fixtureZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const fixtureDay=fixtureNow.toLocaleDateString('en-CA',{timeZone:fixtureZone});
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[fixtureNow]));}static now(){return fixtureNow.getTime();}}
 const selectors=['#t-today','#t-required','#t-start','#t-setup','#t-recap','#t-checkin','#t-combined-week','#t-goals','#t-form','#t-insights'];
 const nodes=new Map(selectors.map(selector=>[selector,{innerHTML:'',hidden:false,dataset:{},isConnected:true}]));
 const todaySkeleton={hidden:true,isConnected:true};nodes.set('[data-today-skeleton]',todaySkeleton);
 const pending=new Map(),timers=[],savedToday=new Map(),storage=new Map(),localStorage={getItem:key=>storage.get(key)||null,setItem(key,value){storage.set(key,String(value));this[key]=String(value);},removeItem(key){storage.delete(key);delete this[key];}},el={innerHTML:'',isConnected:true,closest:()=>null};
 const oldDay='2026-11-08',oldTodayPath=`me:today:${oldDay}`;localStorage.setItem('fit.c:'+oldTodayPath,JSON.stringify({account:1,data:{activities:[]}}));
 const read=path=>{const value=deferred();pending.set(path,value);return value.promise;};
 const ctx={
  console,Date:FixtureDate,Promise,Set,Intl,URLSearchParams,location:{search:''},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},localStorage,
  window:{addEventListener(){},removeEventListener(){}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(id){timers[id-1]=null;},
  $:selector=>nodes.get(selector)||null,$$:()=>[],
  App:{me:{id:1,name:'Fictional user',setup_hidden:true,kcal_target:null,friend_count:1,meTodayUpdatedAt:'2026-11-08T12:00:00.000Z'},cache:new Map([[oldTodayPath,{data:{activities:[]},at:1}]])},
  MeCard:{header:()=>'<section class="me-card">Shared profile</section>',mount(){}},
  PaintGate:{begin:()=>({finish:promise=>Promise.resolve(promise)})},
  Native:{on:false,healthOn:()=>Promise.resolve(false)},viewResources:{set(){}},
  readOwner:()=>1,api:read,kept:()=>null,keep:(path,data)=>{savedToday.set(path,data);localStorage.setItem('fit.c:'+path,JSON.stringify({account:1,data}));},screenHit:()=>null,
  load:(path,paint)=>{const value=path.includes('/fitness?')?{days:[]}:[];paint(value);return Promise.resolve(value);},
  getStarted:()=>'',esc:String,svg:()=>'',SPORT_NAMES:{run:'Run'},IC:{run:'run'},
  U:{du:()=> 'mi',dist:value=>String(value)},meInsights(){},
  $$:()=>[],weeklyCheckinCard:()=>Promise.resolve(),combinedWeek:()=>{},
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const done=ctx.meOverview(el),today=nodes.get('#t-today');
 assert.match(today.innerHTML,/aria-busy="true"/,'Today exposes its loading state immediately');
 assert.match(today.innerHTML,/data-today-skeleton hidden/,'Today keeps the delayed skeleton hidden before the 200 ms handoff');
 assert.equal(todaySkeleton.hidden,true,'Today does not flash a skeleton during a fast read');
 timers[0]();assert.equal(todaySkeleton.hidden,false,'Today reveals its shaped skeleton only after the delay');
 assert.equal(today.dataset.loading,'true','the loading token remains active while sources are pending');
 const todayRowsPath=`/api/activities?limit=100&after=${encodeURIComponent(new Date(fixtureDay+'T00:00:00').toISOString())}`;
 assert.deepEqual([...pending.keys()],['/api/activities?limit=1','/api/plans/current','/api/food/history?days=30',`/api/food/day?d=${fixtureDay}`,todayRowsPath]);

 const zone=fixtureZone;
 const day=fixtureDay;
 pending.get('/api/activities?limit=1').resolve([]);
 pending.get('/api/plans/current').resolve({today:day,plan:{id:9101,unit:'mi'},today_workout:{type:'run',title:'Easy run',minutes:30,day}});
 pending.get('/api/food/history?days=30').resolve([]);
 pending.get(`/api/food/day?d=${day}`).resolve({day,entries:[],totals:{},unknown_nutrients:{},targets:{},has_history:false,food_user:false});
 pending.get(todayRowsPath).resolve([{id:9102,sport:'run',sport_label:'Run',start_time:fixtureNow.toISOString(),elapsed_s:1800,distance_m:5000,route:{coordinates:[[1,2]]},map:'fictional-map'}]);
 await done;
 assert.equal(today.dataset.loadedDay,day,'Today records the completed local date');
 assert.equal(today.dataset.loading,undefined,'the loading state ends after source reads settle');
 assert.equal((today.innerHTML.match(/data-today-plan/g)||[]).length,1,'the active plan produces one plan row');
 assert.match(today.innerHTML,/class="me-today-title">Easy run</,'the planned workout title is rendered in Today');
 assert.match(today.innerHTML,/class="me-today-value">30 min</,'the planned workout amount is kept in the value column');
 assert.match(today.innerHTML,/href="\/plan"/,'the planned row opens the plan');
 assert.doesNotMatch(today.innerHTML,/data-today-food/,'a non-food user does not get a food row');
 const snapshot=savedToday.get(`me:today:${day}`);assert.equal(snapshot.foodHistoryCount,0,'Me Today stores only the food-history count');assert.equal(Object.hasOwn(snapshot,'foodHistory'),false,'Me Today does not persist the 30-day food-history rows');assert.deepEqual(Object.keys(snapshot.todayRows[0]).sort(),['distance_m','elapsed_s','id','sport','sport_label','start_time'].sort(),'Me Today retains only fields drawn by its activity row');assert.equal(ctx.App.cache.has(oldTodayPath),false,'writing today removes prior in-memory date buckets');assert.equal(localStorage.getItem('fit.c:'+oldTodayPath),null,'writing today removes prior persisted date buckets');
 const todayPath=`me:today:${day}`;ctx.App.cache.set(todayPath,{data:{activities:[],foodHistory:[{day:'2026-11-08'},{day:'2026-11-09'}],todayRows:[{id:8,sport:'run',start_time:fixtureNow.toISOString(),route:{secret:'fictional'},map:'fictional'}]},at:1});ctx.meOverview({...el,innerHTML:''});const migrated=ctx.App.cache.get(todayPath).data;assert.equal(migrated.foodHistoryCount,2,'legacy Today cache is reduced to a history count on read');assert.equal(Object.hasOwn(migrated,'foodHistory'),false,'legacy 30-day food-history rows are removed');assert.deepEqual(Object.keys(migrated.todayRows[0]).sort(),['id','sport','start_time'].sort(),'legacy cached activity rows drop map and route payloads');
 assert.doesNotMatch(el.innerHTML,/Your dashboard|t-plan|t-food/,'the removed dashboard and plan/food cards stay absent');
 console.log('Me Today first paint: two reserved skeleton rows, pending read barrier, planned row after reads, no food row for a non-food user PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
