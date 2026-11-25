// Fictional responses only; rendered by the unchanged app in an unsigned Simulator bundle.
'use strict';
const scenes={
 'kit-weekly-insight':{route:'/me/kit?from=progress',ready:'.kit-answer .kit-verdict'},
 'challenge-start':{route:'/me/challenges',actions:['#challenge-start'],ready:'.challenge-templates [data-challenge-kind="protein_days"]'},
 'challenge-detail':{route:'/me/challenges/demo-distance',ready:'.challenge-person-row'},
 'training-activity-detail':{route:'/activity/1',actions:['[data-dt="charts"]'],ready:'#d-charts svg',map:'#d-map'},
 'training-sport-profile':{route:'/people/alex',ready:'.me-card-sections[aria-busy="false"]',scroll:'.me-sport-chips'},
 // Completed lifting belongs to Activity; /track/lift/:id opens the editable recorder.
 'training-lift-session':{route:'/activity/3',ready:'#d-lifts .ls-row'},
 'training-plan':{route:'/plan',ready:'.pweek.current .compact-workout'},
 'training-weekly-progress':{route:'/progress?view=totals&sport=run&period=week',ready:'#m-chart svg'},
 'training-route-repeats':{route:'/route/1',ready:'.route-effort-row',map:'#r-map'},
 'food-day':{route:'/food',ready:'#fd-meals [data-id]'},
 'food-chat-review':{route:'/food/describe?meal=lunch',ready:'#thread-review:not([hidden]) #thread-review-add'},
 'food-insights':{route:'/food?view=overview&r=30',ready:'#nt-overview-chart svg'},
 'food-saved-meals':{route:'/food/meals',actions:['[data-library-tab="usuals"]'],ready:'#library-usuals [data-meal]'},
 'friends-home-feed':{route:'/activity',ready:'#ff-list .post[data-href="/activity/friends/2"]',scroll:'#ff-list .post[data-href="/activity/friends/2"]',map:'#ff-list .post[data-href="/activity/friends/2"] .map'},
 'friends-list':{route:'/me/friends',ready:'.fr-friend',count:3},
 'friends-shared-activity':{route:'/activity/friends/2',ready:'#s-soc [data-ttalk]'},
 'friends-audience':{route:'/activity/1?edit=1',actions:['#e-visibility-open'],ready:'.activity-edit-audience [data-vis="friends"]'},
};
module.exports=function(name){
 if(!Object.hasOwn(scenes,name))throw Error('Unknown native tour scene: '+name);
 const fixture=require('./appstore.cjs')(true),r=fixture.responses,today='2026-11-02',day=n=>new Date(Date.parse(today+'T12:00Z')-n*86400000).toISOString().slice(0,10);
 const run=r['/api/activities/1'];run.visibility=run.social.visibility='friends';run.ai_note=null;
 // Smooth fictional run with a slower hill; distance/time agree with the summary.
 const weights=Array.from({length:31},(_,i)=>1+.06*Math.sin(i*.4)-.1*Math.exp(-(((i-17)/3)**2))),scale=(5000/1800)/(weights.reduce((s,v)=>s+v,0)/weights.length);
 run.chart={t:weights.map((_,i)=>i*60),d:weights.map((_,i)=>5000*i/30),speed:weights.map(v=>v*scale),hr:weights.map((_,i)=>Math.round(130+20*(1-Math.exp(-i/7)))),alt:weights.map((_,i)=>20+12*Math.exp(-(((i-17)/5)**2))),cad:weights.map((_,i)=>164+Math.round(2*Math.sin(i*.3)))};
 run.avg_hr=Math.round(run.chart.hr.reduce((s,v)=>s+v,0)/31);
 Object.assign(r['/api/me'],{friend_requests:0,ai_ok:true,ai_features:{food:true,coach:true},health_ai_ok:true,garmin_ai_ok:true});
 r['/api/notifications/count'].friend_requests=0;
 r['/api/people/alex/profile'].sports=[{sport:'run',activities:110,distance_m:600000,time_s:210000},{sport:'walk',activities:30,distance_m:90000,time_s:81000},{sport:'ride',activities:24,distance_m:184000,time_s:60000}];
 r['/api/people/alex/profile'].person=r['/api/me'];
 Object.assign(r['/api/people/alex/profile'].overview,{activities:164,distance_m:874000,time_s:351000});
 const catalog=require('../../../app/static/profile.achievement-levels.json'),track=r['/api/achievements'].tracks.find(t=>t.code==='workouts');
 const earned=catalog.tracks.workouts.levels.filter(level=>164>=level.canonical_value);
 Object.assign(track,{value:164,display_value:164,level:earned.length,tiers:earned.map((level,i)=>({rank:i+1,label:level.name,title:level.name,threshold:level.canonical_value,unit:level.canonical_unit}))});
 r['/api/achievements/showcase'].items.find(t=>t.code==='workouts').rank=earned.length;
 r['/api/gear']=[];
 const challenge={code:'demo-distance',kind:'distance',title:'November miles',unit:'mi',target:50,sports:['run','walk'],start:'2026-11-01',end:'2026-11-30',member:true,owner:true,creator:'alex',participants:3,joining_closed:false,garmin_sources:[],manual:true,self:{value:12.4,days_left:28,finished:false,complete:false},people:[{username:'alex',value:12.4},{username:'jordan',value:15.2},{username:'casey',value:10.6}]};
 r['/api/challenges']=[challenge];r['/api/challenges/demo-distance']=challenge;
 const workout={day:today,type:'easy',title:'Easy run',detail:'Run at a comfortable, conversational effort.',minutes:35,dist:3.5,status:'today'};
 r['/api/plans/current']={plan:{id:1,unit:'mi',race:'10k',race_name:'10K',level:'intermediate',level_name:'Intermediate',weeks:8,race_day:'2026-12-13',start_day:'2026-10-19',runs:4,long_day:6},today,this_week:3,today_workout:workout,next_workout:workout,days_to_race:41,predicted_s:3300,paces:{easy:['10:00/mi','11:00/mi']},weeks:[{n:3,start:today,phase:'Build',planned:18,done:0,workouts:[workout,{...workout,day:'2026-11-04',type:'tempo',title:'Tempo run',dist:4,status:'upcoming'},{...workout,day:'2026-11-06',dist:3.5,status:'upcoming'},{...workout,day:'2026-11-08',type:'long',title:'Long run',dist:7,status:'upcoming'}]}]};
 r['/api/plan/today']={plan:r['/api/plans/current'].plan,workout};
 const lift={...run,id:3,name:'Full-body strength',sport:'workout',line:null,chart:null,distance_m:null,elapsed_s:2400,moving_s:2400,avg_hr:null,ascent_m:null,lifts:true,lift_open:false,photos:[]};
 r['/api/activities/3']=lift;r['/api/activities/3/social']={...run.social,cheers:[],comments:[]};
 r['/api/activities/3/lifts']={exercises:[['Squat',1,60],['Bench press',2,40],['Dumbbell row',3,20]].map(([name,exercise_id,kg])=>({name,exercise_id,kind:'weight',sets:[1,2,3].map(n=>({n,kg,reps:8,done:true,pr:[]})),last:{start_time:day(7)+'T08:00Z',sets:[{kg:kg-2.5,reps:8,done:true}]}}))};
 r['/api/routes/1']={id:1,name:'Park loop',sport:'run',line:run.line,fastest_id:1,pace_trend:null,efficiency_trend:null,activities:[3,2,1,0].map((n,i)=>({...run,id:i+1,start_time:day(n*7)+'T08:30Z',elapsed_s:1800+n*30}))};
 const friend={...r['/api/feed/friends'][0],photos:[{id:1,url:'/static/tour-park.jpg',thumb:'/static/tour-park.jpg'}],social:{...run.social,mine:false},reactions:run.social.reactions,cheers:4,comments:2};
 r['/api/feed/friends']=[friend];r['/api/shared/2']=friend;
 r['/api/food/weekly-review']={entries:0};r['/api/food/meals']=[{id:1,name:'Yogurt and berries',items:[{name:'Greek yogurt'},{name:'Blueberries'}],totals:{kcal:260}},{id:2,name:'Chicken salad bowl',items:[{name:'Chicken'},{name:'Mixed greens'}],totals:{kcal:520}}];
 r['/api/dishes']=[];r['/api/food/foods']=[];r['/api/food/usual']=[];
 r['/api/food/insights']={top_foods:[],rows:Array.from({length:30},(_,i)=>({day:day(29-i),eaten:1700+(i%5)*30,burned:2200,goal:1800,protein_g:100+(i%4)*5,carbs_g:190,fat_g:60,entries:4,counted:i<29,today:i===29,weight:70-i*.01,trend:70-i*.01})),summary:{start:day(29),logged:29,avg_eaten:1760,avg_protein_g:107,avg_carbs_g:190,avg_fat_g:60},targets:{kcal_target:1800,protein_target:110}};
 r['/api/food/review']={enabled:false,latest:null};
 const generation='00000000-0000-4000-8000-000000000010',answer={verdict:'Your recent running is building steadily.',reason:'You have kept a regular rhythm while adding distance.',facts:[{label:'Distance this week',display_value:'18.4 mi',path:['distance_m'],evidence_id:'e2'},{label:'Active days',display_value:'4 days',path:['active_days'],evidence_id:'e2'}],follow_ups:['Review my consistency','Help me plan my next week']};
 r['POST /api/coach/conversation/visits']={generation,ready:true};
 r['/api/coach/conversation']={generation,ready:true,before:null,messages:[{client_id:'00000000-0000-4000-8000-000000000011',question:'Am I improving?',state:'answered',answer}]};
 if(name==='food-chat-review'){
  const entries=r['/api/food/day'].entries.map(e=>({...e,id:null,source:'ai',ref:{origin:'ai',estimated_portion:true},estimated:true,amount:1,unit:'serving'})),parts=[{index:0,status:'ready',estimated:true,entries,drafts:entries}];
  r['/api/food/thread'].messages=[{id:10,client_id:generation,kind:'user',body:'Oatmeal with blueberries and a chicken salad bowl',state:'answered',created:today+'T12:00Z',local_day:today,result:{review_only:true}},{id:11,reply_to:10,kind:'assistant',body:'Check the portions before adding.',state:'answered',created:today+'T12:00:01Z',result:{kind:'preview',day:today,meal:'lunch',parts}}];
 }
 return {...fixture,tour:{name,...scenes[name]}};
};
module.exports.scenes=scenes;
