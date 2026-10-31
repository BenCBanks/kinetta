/* Injected into a disposable Simulator app copy only. Fictional records; no network/provider/Health/GPS reads. Read-only display preferences use UIKit. */
'use strict';
(() => {
  const cfg=globalThis.KinettaUIFixture,errors=[],requests=[];
  cfg.errors=errors;cfg.requests=requests;
  addEventListener('error',e=>errors.push(String(e.message)));
  addEventListener('unhandledrejection',e=>errors.push(String(e.reason?.message||e.reason)));
  localStorage.clear();document.documentElement.style.fontSize=cfg.root+'px';
  history.replaceState(null,'',cfg.stage.startsWith('activity')?'/activity/1':cfg.stage.startsWith('track-')?'/track':cfg.stage==='food'?'/food/describe':'/food/cook/1');
  if(cfg.recording){const s={...cfg.recording,native:true,lapSupport:true,activeSeconds:cfg.recording.activeMs/1000,elapsedSeconds:(cfg.recording.finishedAt-cfg.recording.start)/1000,_snapshotClock:performance.now()};localStorage.setItem('kinetta.track:'+JSON.stringify(['https://example.test',1]),JSON.stringify(s));}
  const nutrients={kcal:450,protein_g:30,carbs_g:40,fat_g:19,fiber_g:null,sodium_mg:null,sugar_g:null,saturated_fat_g:null};
  cfg.dish={id:1,name:'Fictional recipe',named:true,mine:true,items:[],known:nutrients,totals:nutrients,recipe_source:{},serving:'one',servings:1,serving_count:1,weight_g:null,items_g:null,weighed:false,shared_with:[],owner:{login:'zz_test_native',name:'Demo'}};
  const me={id:1,login:'zz_test_native',name:'Demo',tz:'UTC',units:'metric',created:'2020-01-01T12:00:00Z',notifications:0,friend_requests:0,share_default:'everyone',ai_ok:false,ai_features:{food:false,coach:false},health_ai_ok:false,garmin_ai_ok:false,needs_email_confirm:false,photo:null,kcal_target:null,food_user:false};
  const prefs={auto_log:false,tone:'friendly',daily_note:false},nativeFetch=fetch;
  globalThis.fetch=async(input,options={})=>{
    const raw=typeof input==='string'?input:input.url,u=new URL(raw,location.href),p=u.pathname;
    if(p.startsWith('/api/')){
      requests.push(p);let data;
      if(p==='/api/me')data=me;
      else if(cfg.activity&&p==='/api/activities/1')data=cfg.activity;
      else if(cfg.activity&&p==='/api/activities/1/social')data=cfg.activity.social;
      else if(p==='/api/milestones')data={items:[],pending:false};
      else if(p==='/api/setup')data={needed:false};
      else if(p==='/api/dishes/1')data=cfg.dish;
      else if(p==='/api/food/thread'||p.startsWith('/api/food/thread/reviews/draft/'))data={messages:[],before:null,has_more:false,preferences:prefs};
      else if(p==='/api/food/thread/preferences')data=prefs;
      else if(p==='/api/food/day')data={day:'2026-10-28',entries:[],totals:nutrients,goal:null,targets:{},food_user:false,has_history:false,unknown_nutrients:{}};
      else if(p==='/api/friends')data={friends:[],incoming:[],outgoing:[]};
      else if(p==='/api/notifications/count')data={unread:0,friend_requests:0};
      else if(p==='/api/map-config')data={kind:'off',attribution:'',personal_default:false};
      else if(p==='/api/stats')data={weeks:[],years:[],recent_days:[],chart_weeks:[],week_days:[],total:0};
      else if(p==='/api/coach/week')data={enabled:false,paused:false,latest:null};
      else if(p==='/api/fitness')data={days:[]};
      else if(p==='/api/plan/today')data={plan:null};
      else if(/\/(activities|goals|dishes|shared|friends|suggested|calendar|plans|gear)/.test(p))data=[];
      else data={};
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    if(u.origin!==location.origin)throw Error('Native UI fixture blocked external request');
    return nativeFetch(input,options);
  };
})();
