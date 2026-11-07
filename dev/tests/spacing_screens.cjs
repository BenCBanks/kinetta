'use strict';
const GROUP_INVITE_TOKEN='0123456789abcdef0123456789abcdef';
const GROUP_EMPTY={id:'00000000-0000-4000-8000-000000000001',title:'Fictional hiking weekend',event_date:'2026-11-14',time_zone:'America/New_York',note:'Fictional event',goal_type:'distance',goal_target:100,goal_unit:'mi',total:42,days_to_event:7,members:[{username:'alex',organizer:true,sharing_total_only:true}],member_count:1,is_organizer:true,joining_closed:false,closed:false};
const GROUP_FULL={...GROUP_EMPTY,id:'00000000-0000-4000-8000-000000000050',members:Array.from({length:50},(_,i)=>({username:i?'fictional_member_'+String(i).padStart(2,'0'):'alex',organizer:i===0,sharing_total_only:true})),member_count:50};
const scenes=fixtures=>[
 {name:'Me',login:'alex',route:'/me',ready:'#page:not([data-home-loading]):has(.me-card-sections[aria-busy="false"])'},
 {name:'Me Today plan',login:'zz_test_me_today',route:'/me',ready:'#t-today[data-loaded-day] [data-today-activity]',todayPlan:true},
 {name:'Sharing & privacy',login:'alex',route:'/me/sharing',ready:'#sh-find'},
 {name:'Activity',login:'zz_test_feed_typical',route:'/activity',ready:'#feed-tools[aria-busy="false"]'},
 {name:'Activity detail',login:'zz_test_detail_owner',route:'/activity/'+fixtures.detail.run,ready:'.compact-detail-title'},
 {name:'Track ready',login:'zz_test_track_runner',route:'/track',ready:'#track-explore[aria-busy="false"]',native:true},
 {name:'Lifting with sets',login:'zz_test_lift_compact',route:'/track/lift/'+fixtures.lift.live,ready:'.lift-ex [data-row]',lift:fixtures.lift.live},
 {name:'Lifting blank sets',login:'zz_test_lift_compact_fresh',route:'/track/lift/'+fixtures.lift.fresh_live,ready:'.lift-ex [data-row]',lift:fixtures.lift.fresh_live},
 {name:'Progress',login:'zz_test_overview_runner',route:'/progress',ready:'#p-explore[aria-busy="false"]'},
 {name:'Fitness',login:'zz_test_subpages_typical',route:'/progress?view=fitness',ready:'#fi-pred .card'},
 {name:'Nutrition day',login:'zz_test_nutrition_typical',route:'/food',ready:'#nutrition-explore[aria-busy="false"]'},
 {name:'Add food',login:'zz_test_food_compact_empty',route:'/food/describe?meal=lunch',ready:'#thread-text'},
 {name:'Recipes and foods',login:'zz_test_recipes_ui_typical',route:'/food/meals',ready:'#tm-new'},
 {name:'Friends',login:'zz_test_fc_typical',route:'/me/friends?find=1',ready:'.friends-page #fr-invite'},
 {name:'Groups',login:'alex',route:'/me/groups',ready:'#group-new',groups:true},
 {name:'Group create',login:'alex',route:'/me/groups',entryReady:'#group-new',ready:'#group-create-form',modal:'group-create',groups:true},
 {name:'Group empty roster',login:'alex',route:'/groups/'+GROUP_EMPTY.id,ready:'.group-roster',group:'empty'},
 {name:'Group full roster',login:'alex',route:'/groups/'+GROUP_FULL.id,entryReady:'.group-roster',ready:'.group-member:nth-child(50)',modal:'group-full',group:'full'},
 {name:'Invite acceptance',login:'alex',route:'/group-invite/'+GROUP_INVITE_TOKEN,ready:'#group-accept',invite:true},
 {name:'Settings',login:'alex',route:'/me/settings',ready:'#logout'},
 {name:'Notifications',login:'alex',route:'/me/notifications',ready:'[data-meal-reminders]',notifications:true,native:true},
 {name:'Share progress',login:'zz_test_recap_ui_typical',route:'/progress',ready:'#recap-entry',recap:true},
 {name:'Nutrition Insights',login:'zz_test_insights_typical',route:'/food?view=overview&r=30',ready:'#nt-body .insights-summary'},
 {name:'My friends',login:'zz_test_fc_typical',route:'/me/friends',ready:'#fr-own-list'},
 {name:'Account name sheet',login:'alex',route:'/me/settings',entryReady:'#m-name',ready:'.scrim:not([inert]) #ac',modal:'name'},
 {name:'Pinned save sheet',login:'alex',route:'/me/settings',entryReady:'#m-name',ready:'.scrim:not([inert]) .sheet.pinned',modal:'pinned'},
 {name:'Quick weight sheet',login:'alex',route:'/me',entryReady:'.me-card-sections[aria-busy="false"]',ready:'#quick-weight',modal:'weight'},
 {name:'Share card choices',login:'alex',route:'/me',entryReady:'.me-card-sections[aria-busy="false"]',ready:'#card-achievements',modal:'share-card'},
 {name:'Public link confirmation',login:'alex',route:'/me',entryReady:'.me-card-sections[aria-busy="false"]',ready:'#card-rotate',modal:'card'},
 {name:'Remove friend confirmation',login:'zz_test_fc_typical',route:'/people/zz_test_fc_peer00',entryReady:'#person-profile [data-person-manage]',ready:'[data-confirm]',modal:'remove'},
 {name:'Block friend confirmation',login:'zz_test_fc_typical',route:'/people/zz_test_fc_peer00',entryReady:'#person-profile [data-person-manage]',ready:'[data-confirm]',modal:'block'},
 {name:'Activity photo viewer',login:'zz_test_detail_owner',route:'/activity/'+fixtures.detail.run,entryReady:'[data-media-photo]',ready:'.ph-view',modal:'photo'},
 {name:'Activity full map',login:'zz_test_detail_owner',route:'/activity/'+fixtures.detail.run,entryReady:'.detail-map-hero .leaflet-tile-loaded',ready:'.map.full',modal:'map'},
];
function initialize({root,native,base,token,id,lift,liftData}){
 document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
 Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>1,clearWatch:()=>{},getCurrentPosition:()=>{}}});
 if(lift)localStorage.setItem('fit.lift:'+JSON.stringify([base,id,String(lift)]),JSON.stringify({unsent:false,data:liftData,lastTick:null}));
 if(native){
  const preferences={server:base,token};
  window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>['Preferences','KinettaTrack'].includes(n),Plugins:{
   Preferences:{get:async({key})=>({value:preferences[key]??null}),set:async({key,value})=>{preferences[key]=value;},remove:async({key})=>{delete preferences[key];}},
   KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({routePlanSupport:1}),intervalCapabilities:async()=>({intervalCapabilities:{outdoor:true}}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()}),start:async()=>{throw Error('The spacing audit cannot start a recording');}}
  }};
 }
}
async function notificationState(page){
 await page.evaluate(async()=>{
  Native.on=true;Native.pushSupported=true;Native.haptic=()=>{};
  Native.pushStatus=async()=>({enabled:true,denied:false});
  Native.enablePush=Native.disconnectPush=Native.openPushSettings=async()=>{throw Error('The spacing audit cannot change phone settings');};
  await pushCard(document.querySelector('#nt-push'),{push_ready:true,push:Object.fromEntries(Object.keys(PUSH_NAMES).map(k=>[k,true]))});
 });
}
async function modalState(page,kind){
 if(kind==='name')await page.locator('#m-name').click();
 else if(kind==='weight')await page.evaluate(()=>quickWeighIn());
 else if(kind==='share-card')await page.evaluate(()=>KinettaCard.open());
 else if(kind==='card'){await page.evaluate(()=>KinettaCard.open());await page.locator('#card-new').click();}
 else if(kind==='photo')await page.locator('[data-media-photo]').first().click();
 else if(kind==='map')await page.locator('.detail-map-hero .map-full').click();
 else if(kind==='group-create')await page.locator('#group-new').click();
 else if(kind==='group-full')await page.locator('[data-group-more]').click();
 else if(kind==='remove'||kind==='block'){
  await page.locator('#person-profile [data-person-manage]').click();
  await page.locator(kind==='remove'?'[data-remove]':'[data-block]').click();
 }
 else await page.evaluate(kind=>{
  // Prepared content verifies the shared pinned header without invoking a page-specific save.
  sheet('Details','<form class="form" id="spacing-pinned"><label>Name<input value="Fictional draft"></label></form>',null,{save:'spacing-pinned'});
 },kind);
}
module.exports={scenes,initialize,notificationState,modalState,GROUP_EMPTY,GROUP_FULL};
