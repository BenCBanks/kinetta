// Route existence alone cannot detect a silently ignored view selector or a wrongly labelled destination.
'use strict';
const assert=require('node:assert/strict');
const views={
 '/progress':{fitness:'Fitness',records:'Records',lifting:'Lifting',totals:'Progress',mileage:'Progress',trends:'Year over year',calendar:'Calendar',routes:'Matched routes',segments:'Segments',heatmap:'Heatmap',plan:'Training plan'},
 '/food':{log:'Nutrition',overview:'Insights',trends:'Insights',energy:'Calories & weight',macros:'Protein & macros',weight:'Weight',needs:'Calorie needs',weeks:'Week by week',calendar:'Food calendar'},
 '/activity':{mine:'Your activities'},
};
const redirects={'/today':'/me','/me/connections':'/track/connections','/me/health':'/track/health','/me/import':'/track/import','/me/speed':'/me/settings','/me/milestones':'/me','/segments':'/progress/segments','/food/trends':'/food','/food/weight':'/progress/weight'};
const headings={'/me':'Hi,','/activity':'Activity','/track':'Track','/progress':'Progress','/food':'Nutrition','/me/settings':'Settings','/me/friends':'Friends','/me/activities':'Your activities','/notifications':'Notifications','/me/notifications':'Notifications','/me/sharing':'Sharing & privacy','/me/gear':'Shoes & bikes','/me/goals':'Goals','/me/devices':'Signed-in devices','/me/people':'Admin tools','/track/connections':'Connections','/track/import':'Import','/track/health':'Apple Health','/food/meals':'My Recipes','/food/describe':'Add food','/food/setup':'Nutrition','/me/kit':'Ask Kit','/plan':'Training plan','/progress/weight':'Weight','/progress/routes':'Matched routes','/progress/segments':'Segments','/progress/calendar':'Calendar','/progress/trends':'Year over year','/progress/heatmap':'Heatmap','/me/challenges':'Challenges','/me/explore':'Explore Kinetta'};
const externalHosts=new Set(['kinetta.app','www.openstreetmap.org','openstreetmap.org','leafletjs.com','github.com','support.apple.com','support.garmin.com','connect.garmin.com','www.garmin.com']);
function intention(link,base,registry){
 const source=link.source||'link',label=(link.label||'').trim(),url=new URL(link.href,base),origin=new URL(base).origin;
 const fail=message=>assert.fail(`${source}: ${label||'(unlabelled)'} → ${link.href}: ${message}`);
 if(url.protocol==='blob:'&&url.origin===origin)return {kind:'local-document'};
 if(url.origin!==origin){
  if(url.protocol==='mailto:'&&url.pathname==='support@kinetta.app')return {kind:'external'};
  if(url.protocol==='https:'&&externalHosts.has(url.hostname))return {kind:'external'};
  return fail('external destination needs an explicit allowlist entry');
 }
 const pathname=url.pathname.replace(/\/+$/,'')||'/me',q=url.searchParams;
 if(pathname==='/admin'||pathname==='/api/account/export')return {kind:'document',url};
 if(!registry.some(route=>new RegExp(route.source,route.flags).test(pathname)))return fail('unregistered route would render the unknown-route fallback');
 if(q.has('view')&&!Object.hasOwn(views[pathname]||{},q.get('view')))return fail('unsupported view='+q.get('view'));
 if(pathname==='/progress'&&q.has('section')&&q.get('section')!=='food')return fail('unsupported Progress section');
 if(q.has('foodview')&&!Object.hasOwn(views['/food'],q.get('foodview')))return fail('unsupported foodview='+q.get('foodview'));
 if(pathname==='/me/kit'&&q.has('from')&&!['me','nutrition','activity','progress','plan','strength','track'].includes(q.get('from')))return fail('unsupported Kit context');
 if(pathname.startsWith('/people/')&&q.has('preview')&&!['friend','member'].includes(q.get('preview')))return fail('unsupported profile preview');
 if(/view progress/i.test(label)&&(pathname!=='/progress'||q.has('view')||q.has('section')))return fail('View progress must open Progress home');
 if(/view your shared profile|your profile$/i.test(label)&&!pathname.startsWith('/people/'))return fail('profile control must open a person’s profile');
 if(/^(?:view my|all your|your) activities/i.test(label)&&pathname!=='/me/activities')return fail('activity-history control must open your activity list');
 let canonical=redirects[pathname]||pathname;
 if(pathname==='/activity'&&q.get('view')==='mine')canonical='/me/activities';
 if(pathname==='/progress'&&q.has('view')){
  const view=q.get('view');
  if(view==='plan')canonical='/plan';
  else if(['routes','segments','trends','calendar','heatmap'].includes(view))canonical='/progress/'+view;
 }
 if(pathname==='/food'&&q.get('view')==='weight')canonical='/progress/weight';
 if(/^\/lift\/\d+$/.test(pathname))canonical=pathname.replace('/lift/','/track/lift/');
 const heading=q.has('view')?views[pathname][q.get('view')]:q.get('section')==='food'?views['/food'][q.get('foodview')||'overview']:headings[canonical];
 return {kind:'page',url,canonical,heading};
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
module.exports={intention,literalTargets};
