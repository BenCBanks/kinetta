// Shared route intentions for journeys, the link crawl and the later before/after gallery.
'use strict';
const {scenes:spacingScenes}=require('./spacing_screens.cjs');
const destination=(url,title,ready)=>({url,title,ready});
function journeys(fixtures){
 const f=fixtures.journey,profile='/people/'+f.login,activity='/activity/'+f.activity;
 const ownList={...destination(profile,'Your profile',`#person-activities[aria-busy="false"] .post[data-href="/activity/${f.activity}"] .post-title`),text:'Fictional journey run 1'};
 const progress=[['fitness','Fitness','?view=fitness','#fi-pred > .card'],['records','Records','?view=records','#r-body > .card'],['lifting','Lifting','?view=lifting','#lv-body > .card'],['calendar','Calendar','/calendar','#p-body .cal-grid'],['routes','Routes','/routes','#p-body > .card'],['segments','Segments','/segments','#sg-list > .card'],['heatmap','Heatmap','/heatmap','#h-map.leaflet-container'],['trends','Years','/trends','#g-body > .card'],['weight','Weight','/weight','#nt-weight .wform'],['plan','Training plan','plan','#ps-f']];
 const settings=[['/me/devices','Signed-in devices','#dv-list .device-row'],['/me/sharing','Sharing & privacy','#sh-find'],['/track/connections','Connections','#page a'],['/me/notifications','Notifications','#nt-push']];
 const sheets=[['#m-name','Your name','#ac'],['#m-login','Username','#ac'],['#m-email','Email','.sheet[aria-label="Email"]'],['#m-pw','Change password','#pw'],['#m-body','Body, heart rate & time zone','#m-form'],['#m-kit','Kit','#kit-settings-panel'],['#m-del','Delete my account','#del']];
 const cases=[
  {id:'me-profile',start:'/me',taps:['.me-card-avatar[href]'],end:ownList},
  {id:'me-friends',start:'/me',taps:['.me-friends-link[href]'],end:destination('/me/friends','Friends','.friends-page')},
  {id:'me-progress',start:'/me',taps:['.mileage-progress'],end:destination('/progress','Progress','#p-explore')},
  {id:'activity-detail-back',start:'/activity',startReady:'#feed-tools[aria-busy=false]',action:'feedBack',end:destination('/activity','Activity','#feed-tools')},
  {id:'track-save-detail',start:'/track',native:true,action:'record',end:destination('/activity/{saved}','Fictional journey recording','.compact-detail-title')},
  {id:'track-my-activities',start:'/track',native:true,action:'uncertainSave',end:ownList},
  {id:'nutrition-log',start:'/food',action:'food',end:destination('/food?d={day}','Nutrition','#fd-goal')},
  {id:'nutrition-goals',start:'/food',taps:['#fd-goal'],end:destination('/food','Goals','#tg'),close:true},
  {id:'settings-profile',start:'/me/settings',taps:['#m-profile'],end:{...destination('/me?edit=profile','Editing your card','.me-card-editor #card-name'),titleSelector:'.me-editor-head b'},back:destination('/me/settings','Settings','#logout'),history:true},
  {id:'activity-challenges-back',start:'/activity',taps:['a[href="/me/challenges"]','[data-back]'],end:destination('/activity','Activity','#feed-tools')},
 ];
 for(const [id,title,suffix,ready] of progress)cases.push({id:'progress-'+id,start:'/progress',taps:[['fitness','records'].includes(id)?`a.progress-summary[href="/progress${suffix}"]`:`[data-progress-feature="${id}"]`],end:destination(suffix==='plan'?'/plan':'/progress'+suffix,title,ready),back:destination('/progress','Progress','#p-explore')});
 for(const [url,title,ready] of settings)cases.push({id:'settings-'+url.split('/').at(-1),start:'/me/settings',taps:[`a[href="${url}"]`],end:destination(url,title,ready),back:destination('/me/settings','Settings','#logout')});
 for(const [tap,title,ready] of sheets)cases.push({id:'settings-'+tap.slice(1),start:'/me/settings',taps:[tap],end:destination('/me/settings',title,ready),close:true});
 for(const [tap,title,ready] of [['#m-kit-memory','What Kit remembers','#kit-memory-on'],['#m-kit-history','Earlier Kit reviews','#kit-saved-reviews'],['#m-ai-info','Kit & data','.sheet[aria-label="Kit & data"]']])cases.push({id:'settings-'+tap.slice(1),start:'/me/settings',taps:['#m-kit',tap],end:destination('/me/settings',title,ready),close:true});
 for(const [tab,from,title] of [['me','me','Hi,'],['activity','activity','Activity'],['track','track','Track'],['progress','progress','Progress'],['food','nutrition','Nutrition']])cases.push({id:'kit-'+tab,start:'/'+tab,kit:true,startReady:tab==='activity'?'#feed-tools[aria-busy=false]':null,taps:[`a[href="/me/kit?from=${from}"]`],end:destination('/me/kit?from='+from,'Ask Kit','#kit-text'),back:destination('/'+tab,title,'#page')});
 for(const note of f.notifications){
  const admin=['report','signup_admin'].includes(note.kind),edit=note.kind==='activity_ready';
  const end=note.kind==='milestone'?destination('/me','Hi,','.me-card'):note.link.startsWith('/me/challenges/')?destination(note.link,'Activities · 3','#challenge-detail h1.challenge-title'):note.kind==='dish_shared'?{...destination(note.link,'Fictional journey soup','.recipe-content .recipe-nutrition'),titleSelector:'#dk-name',titleValue:true}:admin?destination('/me/people','Admin tools','a[href$="/admin"]'):note.link==='/me/friends'?destination(note.link,'Friends','.friends-page'):note.link==='/activity'?destination(note.link,'Activity','#feed-tools'):destination(activity,edit?'Edit activity':'Fictional journey run 1',edit?'#e-form':'.compact-detail-title');
  cases.push({id:'notification-'+note.kind,start:'/notifications',login:admin?'alex':f.login,taps:[`#nt-list a.note:has([data-kind="${note.kind}"])`],end,close:edit});
 }
 return cases.map(c=>({login:f.login,...c}));
}
function scenes(fixtures){return spacingScenes(fixtures);}
module.exports={journeys,scenes,destination};
