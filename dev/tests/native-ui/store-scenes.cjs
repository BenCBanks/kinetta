// Display-only stand-ins for the current ten-scene submission brief. Never calls a provider.
'use strict';
module.exports=(r,stage,today)=>{
 // The submitted food-day brief uses two meals totalling 915 kcal (macros agree).
 Object.assign(r['/api/feed/friends'][0],{name:'Riverside ride',sport:'ride',distance_m:20000,moving_s:3600,elapsed_s:3600});
 const meals=r['/api/food/day'].entries;
 Object.assign(meals[0],{name:'Blueberry oatmeal',kcal:395,protein_g:25,carbs_g:40,fat_g:15});
 Object.assign(meals[1],{name:'Chicken salad',kcal:520,protein_g:35,carbs_g:50,fat_g:20});
 const totals={kcal:915,protein_g:60,carbs_g:90,fat_g:35};
 Object.assign(r['/api/food/day'].totals,totals);Object.assign(r['/api/food/history'][0],totals);
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const root='/api/coach/conversation/threads',A=uuid(11),B=uuid(12),generation=uuid(90);
 const text='Your recorded climb rose across these weeks so far.';
 const chart={metric:'ascent',aggregate:'average',group_by:'week',sport:'run',period_count:3,period_unit:'weeks',timezone:'UTC',start:'2026-10-19',end:today,axis_unit:'ft',workouts:8,missing:1,truncated:false,
  points:[{start:'2026-10-19',plot_value:125,display_value:'125 ft',n:4,missing:1},{start:'2026-10-26',plot_value:171,display_value:'171 ft',n:3,missing:0},{start:today,plot_value:200,display_value:'200 ft',n:1,missing:0,in_progress:true}]};
 const messages=[{id:1,client_id:uuid(31),question:'Show my average climb per run for the last three weeks.',state:'answered',answer:{chart,answer_blocks:[{kind:'paragraph',text}],interpretation:text,facts:[],follow_ups:[]}}];
 if(stage.startsWith('kit-')){
  r['/api/me']={...r['/api/me'],ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{coach:{available:true,entitled:true,reason:null}}};
  r[root]={enabled:true,retention:'until_deleted',generation,before:null,conversations:[
   {conversation_id:A,title:'Climb over the last three weeks',created:today+'T09:00:00Z',updated:today+'T09:02:00Z',message_count:1},
   {conversation_id:B,title:'Planning an easy training week',created:'2026-11-01T09:00:00Z',updated:'2026-11-01T09:02:00Z',message_count:1}]};
  const envelope={conversation_id:A,generation,visit_id:null,ready:true,before:null,messages};
  r[root+'/'+A]=envelope;r['POST '+root+'/'+A+'/resume']=envelope;
  r['/api/coach/conversation/memory']={enabled:true,version:4,memories:[
   {id:1,text:'I prefer morning runs.',kind:'routine',source:'user',updated:'2026-11-01T09:00:00Z'},
   {id:2,text:"I'm vegetarian.",kind:'preference',source:'user',updated:'2026-10-31T09:00:00Z'}]};
 }
 if(stage==='notifications'){
  const who=(login,name)=>({login,name,photo:null});
  r['/api/notifications']={items:[
   {id:1,kind:'cheer',text:'Jordan Example reacted 🔥 to your Morning park run',compact_text:'Jordan Example reacted 🔥 to Morning park run',reaction_kind:'fire',activity:'Morning park run',link:'/activity/1',who:who('jordan','Jordan Example'),read:false,created:today+'T11:30:00Z'},
   {id:2,kind:'comment',text:'Casey Example commented: “Great morning for a run!”',link:'/activity/1',who:who('casey','Casey Example'),read:false,created:today+'T10:30:00Z'},
   {id:3,kind:'friend_request',text:'Taylor Example wants to be friends',link:'/me/friends',who:who('taylor','Taylor Example'),read:false,created:today+'T09:30:00Z'},
   {id:4,kind:'friend_accepted',text:'You and Jordan Example are now friends',link:'/activity',who:who('jordan','Jordan Example'),read:true,created:'2026-11-01T09:30:00Z'}],unread:3,push:{}};
  r['POST /api/notifications/read']={ok:true};
 }
 if(stage==='food-review'){
  const entries=r['/api/food/day'].entries.map(e=>({...e,id:null})),draft=uuid(99);
  r['/api/food/thread']={...r['/api/food/thread'],messages:[
   {id:10,client_id:draft,kind:'user',body:'Blueberry oatmeal and chicken salad',state:'answered',created:today+'T12:00:00Z',local_day:today,result:{review_only:true,draft_id:draft}},
   {id:11,reply_to:10,kind:'assistant',body:'Check the portions before adding.',state:'answered',created:today+'T12:00:01Z',result:{kind:'preview',day:today,meal:'lunch',parts:[{index:0,status:'ready',estimated:true,entries,drafts:entries}]}}]};
  r['POST /api/food/thread/reviews']={id:9,review:{foods:entries}};
 }
};
