// Route existence alone cannot detect a silently ignored view selector or a wrongly labelled destination.
'use strict';
const assert=require('node:assert/strict');
const views={
 '/progress':{fitness:'Fitness',records:'Records',lifting:'Lifting',totals:'Progress',mileage:'Progress',trends:'Years',calendar:'Calendar',routes:'Routes',segments:'Segments',heatmap:'Heatmap',plan:'Training plan'},
 '/food':{log:'Nutrition',overview:'Insights',trends:'Insights',energy:'Calories & weight',macros:'Protein & macros',weight:'Weight',needs:'Calorie needs',weeks:'Insights',calendar:'Food calendar'},
 '/activity':{mine:'Your activities',groups:'Home'},
};
const foodProgressViews=new Set(['overview','energy','macros','weight','needs','weeks','calendar']);
const redirects={'/today':'/me','/me/connections':'/track/connections','/me/health':'/track/health','/me/import':'/track/import','/me/speed':'/me/settings','/me/milestones':'/me','/segments':'/progress/segments','/food/trends':'/food','/food/weight':'/progress/weight'};
const headings={'/me':'Hi,','/activity':'Home','/track':'Track','/progress':'Progress','/food':'Nutrition','/me/settings':'Settings','/me/friends':'Friends','/notifications':'Notifications','/me/notifications':'Notifications','/me/sharing':'Sharing & privacy','/me/gear':'Shoes & bikes','/me/goals':'Goals','/me/devices':'Signed-in devices','/me/people':'Admin tools','/track/connections':'Connections','/track/import':'Upload activities','/track/health':'Health app','/food/meals':'Recipes & foods','/food/describe':'Add food','/food/setup':'What matters to you?','/me/kit':'Ask Kit','/plan':'Training plan','/progress/weight':'Weight','/progress/routes':'Routes','/progress/segments':'Segments','/progress/calendar':'Calendar','/progress/trends':'Years','/progress/heatmap':'Heatmap','/me/challenges':'Challenges','/me/explore':'Explore Kinetta'};
const externalHosts=new Set(['kinetta.app','apps.apple.com','www.openstreetmap.org','openstreetmap.org','leafletjs.com','github.com','support.apple.com','support.garmin.com','connect.garmin.com','www.garmin.com']);
function intention(link,base,registry,login){
 const source=link.source||'link',label=(link.label||'').trim(),url=new URL(link.href,base),origin=new URL(base).origin;
 const fail=message=>assert.fail(`${source}: ${label||'(unlabelled)'} → ${link.href}: ${message}`);
 if(url.username||url.password)return fail('credentials are not allowed in links');
 if(url.protocol==='blob:'&&url.origin===origin)return {kind:'local-document'};
 if(url.origin!==origin){
  if(url.href==='kinetta://open')return {kind:'external'};
  if(url.protocol==='mailto:'&&url.pathname==='feedback@kinetta.app'&&[...url.searchParams.keys()].every(key=>key==='subject')&&!/[\r\n]/.test(url.searchParams.get('subject')||''))return {kind:'external'};
  if(url.protocol==='https:'&&!url.port&&externalHosts.has(url.hostname))return {kind:'external'};
  return fail('external destination needs an explicit allowlist entry');
 }
 const pathname=url.pathname.replace(/\/+$/,'')||'/me',q=url.searchParams;
 if(pathname==='/api/account/export'){
  if(!link.download)return fail('account export must be marked as a download');
  return {kind:'download',url};
 }
 if(pathname==='/admin')return {kind:'document',url};
 if(!registry.some(route=>new RegExp(route.source,route.flags).test(pathname)))return fail('unregistered route would render the unknown-route fallback');
 if(q.has('view')&&!Object.hasOwn(views[pathname]||{},q.get('view')))return fail('unsupported view='+q.get('view'));
 if(pathname==='/progress'&&q.has('section')&&q.get('section')!=='food')return fail('unsupported Progress section');
 if(q.has('foodview')&&(pathname!=='/progress'||q.get('section')!=='food'))return fail('foodview requires the Progress food section');
 if(q.has('foodview')&&!foodProgressViews.has(q.get('foodview')))return fail('unsupported foodview='+q.get('foodview'));
 if(pathname==='/progress'&&q.get('section')==='food'&&q.has('view'))return fail('Progress food section uses foodview, not view');
 if(pathname==='/food'&&q.has('add')&&(q.get('add')!=='1'||q.has('view')&&q.get('view')!=='log'))return fail('unsupported food add context');
 if(pathname==='/me/kit'&&q.has('from')&&!['me','nutrition','activity','progress','plan','strength','track'].includes(q.get('from')))return fail('unsupported Kit context');
 if(pathname.startsWith('/people/')&&q.has('preview')&&!['friend','member'].includes(q.get('preview')))return fail('unsupported profile preview');
 if(/view progress/i.test(label)&&(pathname!=='/progress'||q.has('view')||q.has('section')))return fail('View progress must open Progress home');
 const ownProfile=login?'/people/'+encodeURIComponent(login):null;
 if(/view your shared profile|your profile$/i.test(label)&&(!pathname.startsWith('/people/')||ownProfile&&pathname!==ownProfile))return fail('profile control must open your profile');
 if(/^(?:view my|view your|all your|your) activities/i.test(label)&&pathname!=='/me/activities'&&pathname!==ownProfile)return fail('activity-history control must open your own activity list');
 let canonical=redirects[pathname]||pathname;
 const dialog=pathname==='/track'&&q.get('past')==='1'?{heading:'Add an activity',ready:'#ma'}:pathname==='/track'&&q.get('intervals')==='1'?{heading:'Intervals',ready:'.scrim:not([inert]) .sheet[aria-label="Intervals"] #interval-library [data-new]'}:pathname==='/me/settings'&&q.get('email')==='add'?{heading:'Email',ready:'.scrim:not([inert]) .sheet[aria-label="Email"]'}:['/me','/me/settings'].includes(pathname)&&q.get('setup')==='body'?{heading:'Body, heart rate & time zone',ready:'#m-form'}:null;
 const addFood=pathname==='/food'&&q.get('add')==='1';if(addFood)canonical='/food/describe';
 if(pathname==='/me'&&q.get('setup')==='body')canonical='/me/settings';
 if(pathname==='/progress'&&q.get('section')==='food')canonical=q.get('foodview')==='weight'?'/progress/weight':'/food';
 if(pathname==='/me/activities'||pathname==='/activity'&&q.get('view')==='mine'){assert(ownProfile,'Owner login required for activity-history alias');canonical=ownProfile;}
 if(pathname==='/progress'&&q.has('view')){
  const view=q.get('view');
  if(view==='plan')canonical='/plan';
  else if(['routes','segments','trends','calendar','heatmap'].includes(view))canonical='/progress/'+view;
 }
 if(pathname==='/food'&&q.get('view')==='weight')canonical='/progress/weight';
 if(/^\/lift\/\d+$/.test(pathname))canonical=pathname.replace('/lift/','/track/lift/');
 const heading=dialog?.heading||(addFood?'Add food':canonical===ownProfile&&!q.has('preview')?'Your profile':q.has('view')?views[pathname][q.get('view')]:q.get('section')==='food'?views['/food'][q.get('foodview')||'overview']:pathname==='/food/trends'?'Insights':headings[canonical]);
 return {kind:'page',url,canonical,heading:pathname==='/segments/review'?'Review segment':heading,dialog,segmentReview:pathname==='/segments/review',ready:/^\/track\/lift\/\d+$/.test(canonical)?'#lf-list .lift-name':null,titleInput:/^\/food\/cook\/\d+$/.test(canonical)?'#dk-name':null};
}
async function fetchDocument(request,url,base){
 const origin=new URL(base).origin;let target=new URL(url,base);
 const path=pathname=>pathname.replace(/\/+$/,'')||'/';
 const expectedPath=path(target.pathname),expectedType={'/admin':'text/html'}[expectedPath];
 assert(expectedType,`Unsupported internal document: ${expectedPath}`);
 for(let hop=0;hop<=5;hop++){
  assert.equal(target.origin,origin,'Internal document redirect must stay inside the fixture before requesting it');
  assert(!target.username&&!target.password,'Document links cannot include credentials');
  assert.equal(path(target.pathname),expectedPath,'Internal document redirect must stay on the requested endpoint');
  const response=await request.get(target.href,{maxRedirects:0});
  if([301,302,303,307,308].includes(response.status())){
   const location=response.headers().location;assert(location,'Document redirect needs a destination');target=new URL(location,target);continue;
  }
  assert.equal(response.status(),200,'Internal document must resolve');
  const type=(response.headers()['content-type']||'').split(';',1)[0].trim().toLowerCase();
  assert.equal(type,expectedType,'Internal document must have its expected content type');return response;
 }
 assert.fail('Too many internal document redirects');
}
function literalTargets(source){
 // Dynamic arguments are checked from rendered links and real go() calls recorded by the journeys.
 let clean='';
 for(let i=0;i<source.length;){
  const ch=source[i];
  if(['"',"'",'`'].includes(ch)){
   clean+=ch;i++;
   while(i<source.length){const next=source[i++];clean+=next;if(next==='\\'&&i<source.length)clean+=source[i++];else if(next===ch)break;}
  }else if(source.slice(i,i+2)==='//'){const end=source.indexOf('\n',i);i=end<0?source.length:end;clean+=' ';}
  else if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;clean+=' ';}
  else{clean+=ch;i++;}
 }
 const targets=[];
 for(const match of clean.matchAll(/\bgo\(\s*(['"`])([^'"`\n]+)\1\s*(?=[,)])/g))if(!match[2].includes('${'))targets.push(match[2]);
 return targets;
}
module.exports={intention,literalTargets,fetchDocument};
