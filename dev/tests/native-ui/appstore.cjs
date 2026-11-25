// Fictional, deterministic display responses for unsigned native App Store captures only.
'use strict';
const assert=require('node:assert/strict');
const achievementCatalog=require('../../../app/static/profile.achievement-levels.json');
module.exports=(homepage=false)=>{
 const today='2026-11-02',date=(days)=>new Date(Date.UTC(2026,10,2-days)).toISOString().slice(0,10);
 const activity=require('../../demo/activity_detail.cjs')(),friends=require('../../demo/friends.cjs')('typical');
 friends.friends=Array.from({length:3},(_,i)=>({...friends.friends[0],login:['jordan','casey','taylor'][i],name:['Jordan Example','Casey Example','Taylor Example'][i]}));
assert.equal(friends.friends.length,3,'the App Store story includes a populated fictional Friends screen');
 activity.name='Morning park run';activity.start_time='2026-11-02T08:30:00Z';
 activity.visibility='friends';activity.social={...activity.social,visibility:'friends'};
 const paceSamples=Array.from({length:30},(_,i)=>({t:Math.round(i*1800/29),d:Math.round(i*5000/29)}));
 const paceSecPerKm=[372,370,368,366,364,362,360,358,356,354,352,350,349,350,352,356,364,380,390,382,372,366,362,360,358,356,355,356,358,360];
 const paceShift=359.7-paceSecPerKm.reduce((sum,value)=>sum+value,0)/paceSecPerKm.length;
 const paceSpeeds=paceSecPerKm.map(value=>1000/(value+paceShift));
 const heartRate=[130,132,134,136,138,140,142,144,146,148,149,150,150,151,150,150,151,150,150,151,150,150,151,150,149,149,148,147,146,145];
 const elevationProfile=Array.from({length:30},(_,i)=>Math.round(60+19*(1-Math.cos(2*Math.PI*i/29))+.7*Math.sin(4*Math.PI*i/29)));
 const cadenceNoise=[0,1,-2,1,0,2,-1,0,1,-2,2,0,-1,1,0,-2,2,1,-1,0,2,-1,0,1,-2,1,0,-1,2,0];
 activity.chart={t:paceSamples.map(s=>s.t),d:paceSamples.map(s=>s.d),speed:paceSpeeds,hr:heartRate,alt:elevationProfile,cad:cadenceNoise.map(n=>164+n)};
 if(homepage){activity.visibility='me';activity.social={...activity.social,visibility:'me',my_reaction:'thumbsup',reactions:{thumbsup:1,fire:2,clap:1},reaction_order:['fire','clap','thumbsup'],cheers:[
  {login:'alex',name:'Alex Example',kind:'thumbsup'},{login:'jordan',name:'Jordan Example',kind:'fire'},
  {login:'casey',name:'Casey Example',kind:'fire'},{login:'taylor',name:'Taylor Example',kind:'clap'}
 ],comments:[
  {id:1,login:'jordan',name:'Jordan Example',text:'Nice route through the park.',created:'2026-11-02T09:00:00Z'},
  {id:2,login:'casey',name:'Casey Example',text:'Great morning for a run.',created:'2026-11-02T09:01:00Z'}
 ]};}
 assert.equal(activity.start_time.slice(0,10),today,'the App Store Home scene includes a workout today');
 const friendActivity={...activity,id:2,name:'Park loop with friends',start_time:'2026-11-01T08:00:00Z',owner:friends.friends[0],visibility:'friends',sport_label:null,speed_available:true,shares:{pace:true,map:true},cheers:0,comments:0,reactions:{cheer:0,strong:0,applause:0},my_reaction:null,cheered:false};
 const macros={kcal:1200,protein_g:75,carbs_g:135,fat_g:40,fiber_g:null,sodium_mg:null,sugar_g:null,saturated_fat_g:null};
 const entries=[['Oatmeal with blueberries','breakfast',500,25,65,15],['Chicken salad bowl','lunch',700,50,70,25]].map(([name,meal,kcal,protein_g,carbs_g,fat_g],i)=>({...macros,id:i+1,day:today,name,meal,kcal,protein_g,carbs_g,fat_g,amount:i===1?180:1,unit:i===1?'g':'serving',source:'ai',ref:{origin:'ai',estimated_portion:true}}));
 const weeklyWorkouts=[2,4,1,5,3,6,2];
 const weeks=[12,24,8,32,20,36,8].map((km,i)=>({d:date((6-i)*7+1),end:i===6?today:date((6-i)*7-5),distance_m:km*1000,activities:weeklyWorkouts[i],time_s:km*360,by_sport:{run:km*1000},today:i===6}));
 const days=Array.from({length:7},(_,i)=>({d:date(1-i),distance_m:i<2?4000:0,activities:i<2?1:0,time_s:i<2?1440:0,by_sport:i<2?{run:4000}:{},today:i===1,future:i>1}));
 const overview={activities:134,distance_m:784000,time_s:270000,active_days:110};
 const profile={mine:true,overview,shared_count:20,sports:[{sport:'run',activities:110,distance_m:600000,time_s:210000},{sport:'ride',activities:24,distance_m:184000,time_s:60000}],items:[],mileage:{today,weeks,days},layout:{sections:['totals','mileage','sports'],stats:['activities','distance','time'],sports:[]}};
 const featuredSpecs=[{code:'workouts',label:'Workouts',value:overview.activities},{code:'sport:run:workouts',label:'Run workouts',value:110},{code:'sport:ride:workouts',label:'Ride workouts',value:24}];
 const featuredTracks=featuredSpecs.map(({code,value})=>{
  const catalog=achievementCatalog.tracks[code];assert(catalog,`App Store fixture requires achievement catalog track ${code}`);
  const earned=catalog.levels.filter(level=>value>=level.canonical_value),tiers=earned.map((level,i)=>({rank:i+1,label:level.name,title:level.name,threshold:level.canonical_value,unit:level.canonical_unit}));
  return{code,label:featuredSpecs.find(item=>item.code===code).label,level:earned.length,value,display_value:value,display_unit:'workouts',tiers};
 });
 const prefs={auto_log:false,tone:'friendly',daily_note:false};
 const messages=[{id:1,client_id:'00000000-0000-4000-8000-000000000001',kind:'user',body:'Oatmeal with blueberries for breakfast',state:'answered',created:today+'T09:00:00Z',local_day:today,result:{}},{id:2,reply_to:1,kind:'assistant',body:'Saved your breakfast.',state:'answered',created:today+'T09:00:01Z',local_day:today,result:{kind:'log',day:today,meal:'breakfast',entry_ids:[1]},entries:[entries[0]]}];
 messages.push({...messages[0],id:3,client_id:'00000000-0000-4000-8000-000000000003',body:'Chicken salad bowl for lunch',created:today+'T12:00:00Z'},{...messages[1],id:4,reply_to:3,body:'Saved your lunch.',created:today+'T12:00:01Z',result:{kind:'log',day:today,meal:'lunch',entry_ids:[2]},entries:[entries[1]]});
 const responses={
  '/api/me':{id:1,login:'alex',name:'Alex Example',bio:'Runs, rides and good food.',tz:'UTC',units:'imperial',created:'2025-01-01T12:00:00Z',notifications:0,friend_requests:0,friend_count:3,share_default:'friends',ai_ok:false,ai_features:{food:false,coach:false},health_ai_ok:false,garmin_ai_ok:false,needs_email_confirm:false,photo:null,kcal_target:1800,protein_target:110,food_user:true,setup_hidden:true,weight_kg:70,height_cm:175,birth_year:1990,sex:'male'},
  '/api/people/alex/profile':profile,
  '/api/activities':[activity],'/api/activities/1':activity,'/api/activities/1/social':activity.social,
  '/api/stats':{chart_today:today,chart_weeks:weeks,week_days:days,recent_days:days,weeks:[],years:[],total:134,week_streak:7},
  '/api/progress/overview':{today,activities:134,mapped:110,active_days:2,years:2,routes:4,segments:0,record:{label:'5K',elapsed_s:1500,start_time:'2026-10-31T08:30:00Z'},plan:null,food:{protein_days:4,weight_change_kg:-.2,weight_kg:70,logged_days:28,library_items:3}},
  '/api/progress/volume':{today,period:'week',rows:weeks.map((w,i)=>({p:date((6-i)*7),s:'run',n:w.activities,d:w.distance_m,t:w.time_s,a:80}))},
  '/api/progress/trends':{today,months:[]},'/api/records':{efforts:[]},
  '/api/fitness':{days:[{day:today,fitness:42,fatigue:39,form:3}],predictions:[{label:'5K',seconds:1590}]},
  '/api/food/day':{day:today,entries,totals:macros,unknown_nutrients:{fiber_g:2,sodium_mg:2,sugar_g:2,saturated_fat_g:2},targets:{kcal_target:1800,protein_target:120,carbs_target:200,fat_target:60},goal:{kcal:1800,default:1800},burned:{kcal:330,bmr:1600,bmr_exact:true,n:1,items:[],day_burn:2250,deficit:1050,source:'formula'},food_user:true,has_history:true},
  '/api/food/history':[{day:today,kcal:1200,protein_g:90,carbs_g:180,fat_g:52,n:2}],
  '/api/health/nutrition':{enabled:false,epoch:'00000000-0000-4000-8000-000000000001',tz:'UTC',since:null,include_older:false,account_id:'00000000-0000-4000-8000-000000000002'},'/api/dishes/shared':[],
  '/api/food/thread':{messages,before:null,has_more:false,preferences:prefs},'/api/food/thread/preferences':prefs,'/api/food/thread/recent-reuse':{item:null},
  '/api/friends':friends,'/api/people/suggested':friends.suggested,'/api/sharing':{default:'friends'},
  '/api/notifications':{items:[],unread:0,push:{},push_ready:false},
  '/api/notifications/count':{unread:0,friend_requests:0},'/api/map-config':{kind:'off',attribution:'',personal_default:false},
  '/api/feed/friends':[friendActivity],'/api/groups/activity-strip':{muted:false,has_upcoming:false},'/api/lifts/sessions':[],'/api/activity-food':{week:{start:date(7),end:date(1),workouts:4,distance_m:29000,seconds:10440,days_logged:7,protein_target:110,protein_days_reached:4,protein_days_known:7,protein_days_unknown:0},today:{day:today,items:[],exercise_kcal:0,estimated:true,burn_source:'formula',day_burn:2250,included_in_day_burn:true,food_href:'/food'}},
  '/api/setup':{needed:false},'/api/milestones':{items:[],pending:false},'POST /api/milestones/celebrate':{items:[],pending:false},'/api/achievements':{pending:false,tracks:featuredTracks},'/api/achievements/showcase':{items:featuredSpecs.map(({code})=>({code,rank:featuredTracks.find(track=>track.code===code).level})),pinned:[],day_streak:0},'/api/recaps':{items:[]},
  '/api/plans/current':{plan:null},'/api/plan/today':{plan:null},'/api/challenges':[],
  '/api/goals':[],'/api/coach/week':{enabled:false,paused:false,latest:null},'/api/connections':{garmin:{available:false}},
  '/api/features/state':{enabled:false},'/api/food/check-in':{week:today,current:null,readiness:{ready:false,reason:'Not enough complete days yet.'},history:[]},'/api/food/week':{days:[],totals:{}},
 };
 assert.equal(responses['/api/fitness'].predictions[0].label,'5K','the Store Progress scene must show its fixture-backed fitness prediction');
 assert.notEqual(responses['/api/fitness'].predictions[0].seconds,responses['/api/progress/overview'].record.elapsed_s,'Fitness and Records use distinct fictional times');
 assert.equal(activity.visibility,homepage?'me':'friends','the Store own card uses Friends and the Homepage reaction fixture stays private');
 assert.equal(activity.social.visibility,homepage?'me':'friends','activity detail privacy matches the Store/Homepage fixture mode');
 assert.equal(activity.chart.speed.length,30,'the Activity detail pace chart has thirty fictional samples');
 const chartPacePerKm=activity.chart.speed.map(speed=>1000/speed),chartPaceAverage=chartPacePerKm.reduce((sum,value)=>sum+value,0)/chartPacePerKm.length;
 assert(Math.abs(chartPaceAverage-359.7)<.01,'the pace chart average matches the 5K/30-minute 9:39/mi header');
 assert(Math.min(...chartPacePerKm)>=345&&Math.max(...chartPacePerKm)<=390,'the pace chart drifts smoothly with one slower hill');
 assert(activity.chart.hr[0]===130&&Math.max(...activity.chart.hr)>=150&&activity.chart.hr.slice(10,25).every(value=>value>=149),'heart rate climbs from 130 bpm and holds a 150 bpm plateau');
 assert.equal(activity.chart.alt.length,30,'the Activity elevation chart has thirty fictional samples');
 assert(Math.max(...activity.chart.alt.slice(1).map((value,i)=>Math.abs(value-activity.chart.alt[i])))<=5,'the third Activity chart follows a smooth fictional hill');
 assert.equal(responses['/api/me'].friend_requests,0,'App Store screenshots do not show a Me badge');
 assert.equal(responses['/api/food/day'].burned.bmr_exact,true,'Nutrition fixture includes complete body details');
 assert.equal(responses['/api/food/day'].entries[0].ref.estimated_portion,true,'Kit chat fixture includes an estimated breakfast portion');
 assert.deepEqual([responses['/api/food/day'].targets.protein_target,responses['/api/food/day'].targets.carbs_target,responses['/api/food/day'].targets.fat_target],[120,200,60],'Nutrition uses the reviewed macro goals');
 for(const key of ['kcal','protein_g','carbs_g','fat_g'])assert.equal(entries.reduce((sum,e)=>sum+e[key],0),macros[key],`Nutrition entries sum to their ${key} total`);
 assert.equal(macros.protein_g*4+macros.carbs_g*4+macros.fat_g*9,macros.kcal,'Nutrition macro totals match their 1,200 kcal total');
 const [lat,lon]=require('../../demo/routes.json')['park loop'][0];
 const currentWeek=weeks.find(row=>row.today),currentDays=days.filter(row=>!row.future);
 assert.equal(currentWeek.distance_m,currentDays.reduce((n,row)=>n+row.distance_m,0),'the current Me week matches the visible fictional days');
 assert.equal(currentWeek.activities,currentDays.reduce((n,row)=>n+row.activities,0),'the current Me week count matches the visible fictional days');
 assert.equal(currentWeek.time_s,currentDays.reduce((n,row)=>n+row.time_s,0),'the current Me week time matches the visible fictional days');
 const achievements=responses['/api/achievements'],showcase=responses['/api/achievements/showcase'];
 assert.equal(showcase.items.length,3,'the App Store Me card features three fictional achievements');
 for(const item of showcase.items){const track=achievements.tracks.find(row=>row.code===item.code),tier=achievementCatalog.tracks[item.code]?.levels?.[item.rank-1];assert(track&&track.level>=item.rank&&track.tiers.some(earned=>earned.rank===item.rank)&&tier&&Number(track.value)>=Number(tier.canonical_value),'featured fixture medals must meet their catalog threshold');}
 assert.equal(achievements.tracks.find(row=>row.code==='workouts').display_value,overview.activities,'featured workout count matches the lifetime overview');
 return {now:today+'T12:00:00Z',position:{lat,lon,accuracy:8,timestamp:Date.parse(today+'T12:00:00Z')},responses};
};
