// Fictional, deterministic display responses for unsigned native App Store captures only.
'use strict';
module.exports=()=>{
 const today='2026-11-02',date=(days)=>new Date(Date.UTC(2026,10,2-days)).toISOString().slice(0,10);
 const activity=require('../../demo/activity_detail.cjs')(),friends=require('../../demo/friends.cjs')('typical');
 friends.friends=Array.from({length:3},(_,i)=>({...friends.friends[0],login:['jordan','casey','taylor'][i],name:['Jordan Example','Casey Example','Taylor Example'][i]}));
 activity.name='Morning park run';
 const friendActivity={...activity,id:2,name:'Park loop with friends',start_time:'2026-11-01T08:00:00Z',owner:friends.friends[0],visibility:'friends',sport_label:null,speed_available:true,shares:{pace:true,map:true},cheers:0,comments:0,reactions:{cheer:0,strong:0,applause:0},my_reaction:null,cheered:false};
 const macros={kcal:915,protein_g:48,carbs_g:90,fat_g:31,fiber_g:null,sodium_mg:null,sugar_g:null,saturated_fat_g:null};
 const entries=[['Oatmeal with blueberries','breakfast',395,16,50,9],['Chicken salad bowl','lunch',520,32,40,22]].map(([name,meal,kcal,protein_g,carbs_g,fat_g],i)=>({...macros,id:i+1,day:today,name,meal,kcal,protein_g,carbs_g,fat_g,amount:1,unit:'serving',source:'quick',ref:null}));
 const weeks=[24,28,26,32,30,29,8].map((km,i)=>({d:date((6-i)*7+1),end:i===6?today:date((6-i)*7-5),distance_m:km*1000,by_sport:{run:km*1000},today:i===6}));
 const days=Array.from({length:7},(_,i)=>({d:date(1-i),distance_m:i<2?4000:0,by_sport:i<2?{run:4000}:{},today:i===1,future:i>1}));
 const overview={activities:134,distance_m:784000,time_s:270000,active_days:110};
 const profile={mine:true,overview,shared_count:20,sports:[{sport:'run',activities:110,distance_m:600000,time_s:210000},{sport:'ride',activities:24,distance_m:184000,time_s:60000}],items:[],mileage:{today,weeks,days},layout:{sections:['totals','mileage','sports'],stats:['activities','distance','time'],sports:[]}};
 const prefs={auto_log:false,tone:'friendly',daily_note:false};
 const messages=[{id:1,client_id:'00000000-0000-4000-8000-000000000001',kind:'user',body:'Oatmeal with blueberries for breakfast',state:'answered',created:today+'T09:00:00Z',local_day:today,result:{}},{id:2,reply_to:1,kind:'assistant',body:'Saved your breakfast.',state:'answered',created:today+'T09:00:01Z',local_day:today,result:{kind:'log',day:today,meal:'breakfast',entry_ids:[1]},entries:[entries[0]]}];
 messages.push({...messages[0],id:3,client_id:'00000000-0000-4000-8000-000000000003',body:'Chicken salad bowl for lunch',created:today+'T12:00:00Z'},{...messages[1],id:4,reply_to:3,body:'Saved your lunch.',created:today+'T12:00:01Z',result:{kind:'log',day:today,meal:'lunch',entry_ids:[2]},entries:[entries[1]]});
 const responses={
  '/api/me':{id:1,login:'alex',name:'Alex Example',bio:'Runs, rides and good food.',tz:'UTC',units:'metric',created:'2025-01-01T12:00:00Z',notifications:0,friend_requests:1,friend_count:3,share_default:'friends',ai_ok:false,ai_features:{food:false,coach:false},health_ai_ok:false,garmin_ai_ok:false,needs_email_confirm:false,photo:null,kcal_target:1800,protein_target:110,food_user:true,setup_hidden:true,weight_kg:70,height_cm:175,birth_year:1990,sex:'male'},
  '/api/people/alex/profile':profile,
  '/api/activities':[activity],'/api/activities/1':activity,'/api/activities/1/social':activity.social,
  '/api/stats':{chart_today:today,chart_weeks:weeks,week_days:days,recent_days:days,weeks:[],years:[],total:134,week_streak:7},
  '/api/progress/overview':{today,activities:134,mapped:110,active_days:2,years:2,routes:4,segments:0,record:{label:'5K',elapsed_s:1500,start_time:'2026-10-31T08:30:00Z'},plan:null,food:{protein_days:4,weight_change_kg:-.2,weight_kg:70,logged_days:28,library_items:3}},
  '/api/progress/volume':{today,period:'week',rows:weeks.map((w,i)=>({p:date((6-i)*7),s:'run',n:4,d:w.distance_m,t:w.distance_m*.36,a:80}))},
  '/api/progress/trends':{today,months:[]},'/api/records':{efforts:[]},
  '/api/fitness':{days:[{day:today,fitness:42,fatigue:39,form:3}],predictions:[{label:'5K',seconds:1500}]},
  '/api/food/day':{day:today,entries,totals:macros,unknown_nutrients:{fiber_g:2,sodium_mg:2,sugar_g:2,saturated_fat_g:2},targets:{kcal_target:1800,protein_target:110},goal:{kcal:1800,default:1800},burned:{kcal:330,n:1,items:[],day_burn:2250,deficit:1335,source:'formula'},food_user:true,has_history:true},
  '/api/food/history':[{day:today,kcal:915,protein_g:48,carbs_g:90,fat_g:31,n:2}],
  '/api/health/nutrition':{enabled:false,epoch:'00000000-0000-4000-8000-000000000001',tz:'UTC',since:null,include_older:false,account_id:'00000000-0000-4000-8000-000000000002'},'/api/dishes/shared':[],
  '/api/food/thread':{messages,before:null,has_more:false,preferences:prefs},'/api/food/thread/preferences':prefs,'/api/food/thread/recent-reuse':{item:null},
  '/api/friends':friends,'/api/people/suggested':friends.suggested,'/api/sharing':{default:'friends'},
  '/api/notifications':{items:[],unread:0,push:{},push_ready:false},
  '/api/notifications/count':{unread:0,friend_requests:1},'/api/map-config':{kind:'off',attribution:'',personal_default:false},
  '/api/feed/friends':[friendActivity],'/api/groups/activity-strip':{muted:false,has_upcoming:false},'/api/lifts/sessions':[],'/api/activity-food':{week:{start:date(7),end:date(1),workouts:4,distance_m:29000,seconds:10440,days_logged:7,protein_target:110,protein_days_reached:4,protein_days_known:7,protein_days_unknown:0},today:{day:today,items:[],exercise_kcal:0,estimated:true,burn_source:'formula',day_burn:2250,included_in_day_burn:true,food_href:'/food'}},
  '/api/setup':{needed:false},'/api/milestones':{items:[],pending:false},'POST /api/milestones/celebrate':{items:[],pending:false},'/api/achievements':{pending:false,tracks:[]},'/api/achievements/showcase':{items:[],pinned:[],day_streak:0},'/api/recaps':{items:[]},
  '/api/plans/current':{plan:null},'/api/plan/today':{plan:null},'/api/challenges':[],
  '/api/goals':[],'/api/coach/week':{enabled:false,paused:false,latest:null},'/api/connections':{garmin:{available:false}},
  '/api/features/state':{enabled:false},'/api/food/check-in':{week:today,current:null,readiness:{ready:false,reason:'Not enough complete days yet.'},history:[]},'/api/food/week':{days:[],totals:{}},
 };
 const [lat,lon]=require('../../demo/routes.json')['park loop'][0];
 return {now:today+'T12:00:00Z',position:{lat,lon,accuracy:8,timestamp:Date.parse(today+'T12:00:00Z')},responses};
};
