'use strict';
const scenes=fixtures=>[
 {name:'Me',login:'alex',route:'/me',ready:'#page:not([data-home-loading]):has(.me-card-sections[aria-busy="false"])'},
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
 {name:'Friends',login:'zz_test_fc_typical',route:'/me/friends',ready:'.friends-page #fr-own-list'},
 {name:'Settings',login:'alex',route:'/me/settings',ready:'#logout'},
 {name:'Notifications',login:'alex',route:'/me/notifications',ready:'[data-meal-reminders]',notifications:true,native:true},
 {name:'Share progress',login:'zz_test_recap_ui_typical',route:'/progress',ready:'#recap-entry',recap:true},
 {name:'Nutrition Insights',login:'zz_test_insights_typical',route:'/food?view=overview&r=30',ready:'#nt-body .insights-summary'},
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
module.exports={scenes,initialize,notificationState};
