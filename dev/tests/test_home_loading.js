// Real home coordinator with delayed, cached, failed and absent conditional data.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8');
const code=source.slice(source.indexOf('const ME_SHORTCUTS'),source.indexOf('function goalFmt'));
async function run({cached=false,food=true,failure=false}={}){
 const page={dataset:{}},nodes=new Map(),requests=new Map(),charts=[];
 const node=()=>({isConnected:true,innerHTML:'',hidden:false,remove(){this.removed=true;},append(child){child.parentElement=this;},insertBefore(child){child.parentElement=this;}});
 const el=node();el.closest=()=>page;
 const get=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);};
 const request=(key,paint,payload)=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.set(key,{paint,payload,resolve,reject});if(cached)paint(payload);return promise;};
 const ctx={console,Date,Promise,Set,App:{me:{name:'Demo',food_user:food}},Native:{on:false},esc:String,svg:()=>'',avatar:()=>'',profileHref:()=>'/people/demo',bellBtn:()=>'',skel:()=>'<p>Loading</p>',skelFeed:()=>'<p>Loading</p>',skelChart:()=>'<p>Loading</p>',skelFood:()=>'<p>Loading</p>',kitChatOn:()=>true,sportMark:()=>'',SPORT_NAMES:{run:'Run'},getStarted:()=>'',goalRow:()=>'',dur:()=>'',when:()=>'',mileageChart:(box,data)=>charts.push(data),$:get,
 load:(key,paint)=>request(key,paint,{'/api/activities?limit=3':[], '/api/stats':{},'/api/goals':[], '/api/fitness?days=60':{days:[]},'/api/feed/friends?limit=3':[]}[key]),
 planCard:(box,opts)=>request('plan',()=>{box.innerHTML='';opts.onReady();}),
 todayFoodCard:(box,opts)=>request('food',()=>{box.innerHTML=food?'<p>Food today</p>':'';opts.onHistory(food);opts.onFoodUser(food);}),
 weeklyCheckinCard:(box,opts)=>request('checkin',()=>{box.innerHTML='';opts.onReady();}),combinedWeek:()=>{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);const done=ctx.meOverview(el);
 const finish=async key=>{const r=requests.get(key);r.paint(r.payload);r.resolve(r.payload);await Promise.resolve();};
 if(!cached){
  assert('homeLoading'in page.dataset,'actions wait while conditional cards are unknown');
  await finish('/api/stats');assert.equal(charts.length,1,'chart renders without waiting for food');
  await finish('/api/activities?limit=3');await finish('plan');
  assert('homeLoading'in page.dataset,'late food cannot appear above already exposed shortcuts');
  if(failure){requests.get('food').reject(Error('Unavailable'));for(let i=0;i<8;i++)await Promise.resolve();}
  else{await finish('food');if(food){assert('homeLoading'in page.dataset,'pending check-in joins the same first paint');await finish('checkin');}}
 }
 assert(!('homeLoading'in page.dataset),'first data is sufficient; stale revalidation and unrelated reads do not block');
 assert(get('#t-loading').removed,'loading status removed when actions are exposed');
 assert.equal(get('#t-last').hidden,food&&!failure,'Latest activity hides only after food is logged today');
 assert.equal(get('#t-food').parentElement,food&&!failure?get('#t-food-lead'):get('.me-agenda'),'food moves above the chart only on a logged day');
 assert.equal(get('.me-agenda').hidden,!failure,'food-only day does not leave an empty Your day heading');
 assert(!('homeFoodLoading' in page.dataset),'training position is revealed after food classification');
 if(failure)assert.match(get('#t-food').innerHTML,/could not load/,'food failure retains an explicit retry');
 // Finish background reads after the first paint. They cannot put the page back into its loading state.
 for(const [key,r]of requests){if(!['plan','food','checkin','/api/activities?limit=3','/api/stats'].includes(key)){r.paint(r.payload);r.resolve(r.payload);}else r.resolve(r.payload);}
 await done;assert(!('homeLoading'in page.dataset));
}
(async()=>{await run();await run({food:false});await run({failure:true});await run({cached:true});console.log('Home food priority and first paint: chart independent, conditional day/actions coordinated, no-food day hidden, failure released, cached content immediate during pending refresh PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
