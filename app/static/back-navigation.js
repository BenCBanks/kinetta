// Local navigation metadata gives a named Back control a verifiable destination.
'use strict';
const BackNavigation=(()=>{
 const field='kinettaNavigation';
 const origin=()=>{const l=globalThis.location;return l?.protocol&&l?.host?l.protocol+'//'+l.host:l?.origin&&l.origin!=='null'?l.origin:'https://example.test';};
 function path(value,base=origin()){
  if(typeof value!=='string'||!value||value.length>4096)return null;
  try{const root=new URL(base),u=new URL(value,root);if(u.protocol!==root.protocol||u.host!==root.host||!/^https?:$|^capacitor:$/.test(u.protocol)||!value.startsWith('/')&&!value.startsWith(base+'/')||value.startsWith('//'))return null;return u.pathname+u.search;}catch{return null;}
 }
 const parent=value=>{const p=path(value)||'/me';return /^\/(?:food)(?:\/|\?|$)/.test(p)?'Nutrition':/^\/track(?:\/|\?|$)/.test(p)?'Track':/^\/(?:progress|plan|lift|route|routes|segments|records)(?:\/|\?|$)/.test(p)?'Progress':/^\/(?:activity|people|add|notifications|challenge)(?:\/|\?|$)/.test(p)?'Activity':'Me';};
 function label(value){
  const clean=path(value);if(!clean)return 'Me';const u=new URL(clean,origin()),p=u.pathname;
  const exact={'/me':'Me','/today':'Me','/activity':'Activity','/track':'Track','/progress':'Progress','/food':'Nutrition','/me/friends':'Friends','/me/settings':'Settings','/me/sharing':'Sharing','/me/people':'People','/me/activities':'My activities','/me/explore':'Explore Kinetta','/me/challenges':'Challenges','/me/milestones':'Milestones','/me/kit':'Kit','/me/goals':'Goals','/me/gear':'Gear','/me/devices':'Devices','/me/speed':'Speed','/me/health':'Apple Health','/track/health':'Apple Health','/me/import':'Import','/track/import':'Import','/food/import':'Import food','/me/connections':'Connections','/track/connections':'Connections','/notifications':'Notifications','/me/notifications':'Notifications','/food/meals':'Recipes','/food/describe':'Add food','/food/recipe-link':'Import recipe','/food/setup':'Food setup','/food/weight':'Weight','/food/trends':'Food & weight','/plan':'Training plan','/routes':'Routes','/progress/routes':'Routes','/segments':'Segments','/progress/segments':'Segments','/segments/review':'Segment review','/segments/new':'New segment','/progress/calendar':'Calendar','/progress/trends':'Trends','/progress/heatmap':'Activity map','/welcome':'Get started'};
  if(p==='/progress'&&u.searchParams.get('section')==='food')return 'Food & weight';
  if(p==='/progress'&&(u.searchParams.get('section')==='lifting'||u.searchParams.get('view')==='lifting'))return 'Lifting';
  if(p==='/routes'&&u.searchParams.get('view')==='segments')return 'Segments';
  if(exact[p])return exact[p];
  for(const [re,name] of [[/^\/activity\/(?:friends\/)?\d+$/,'Activity'],[/^\/people\/[^/]+$/,'Profile'],[/^\/food\/cook\/\d+$/,'Recipe'],[/^\/(?:track\/)?lift\/ex\/\d+$/,'Exercise'],[/^\/(?:track\/)?lift\/\d+$/,'Lifting'],[/^\/route\/\d+$/,'Route'],[/^\/segments\/\d+$/,'Segment'],[/^\/records\//,'Records'],[/^\/(?:me\/challenges|challenge)\/[^/]+$/,'Challenge'],[/^\/card\/[^/]+$/,'Kinetta card'],[/^\/add\/[^/]+$/,'Friend invite']])if(re.test(p))return name;
  return parent(clean);
 }
 const appPath=value=>{const p=path(value);return p&&!/^\/(?:$|signup(?:\/|$)|beta(?:\/|$)|login(?:\/|$)|join(?:\/|$)|forgot(?:\/|$)|reset(?:\/|$)|verify(?:\/|$))/.test(new URL(p,origin()).pathname);};
 const id=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const validRef=(r,owner)=>r&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=128&&appPath(r.path)&&r.owner===owner;
 function entry(state,current,owner){
  const here=path(current);if(!here||typeof owner!=='string'||!owner)return null;
  const m=state&&typeof state==='object'?state[field]:null;
  if(validRef(m,owner)&&new URL(m.path,origin()).pathname===new URL(here,origin()).pathname)return {...m,path:here,from:validRef(m.from,owner)?m.from:null};
  return {id:id(),owner,path:here,from:null};
 }
 function transition(state,current,next,owner,{replace=false}={}){
  const currentEntry=entry(state,current,owner),to=path(next);if(!currentEntry||!to)return null;
  const from=replace?currentEntry.from:appPath(currentEntry.path)?{id:currentEntry.id,owner,path:currentEntry.path}:null;
  return {current:{...(state&&typeof state==='object'?state:{}),[field]:currentEntry},next:{[field]:{id:id(),owner,path:to,from}}};
 }
 function destination(state,current,fallback,owner,{historyLength=1}={}){
  const here=path(current),target=path(fallback)||'/me',m=state&&typeof state==='object'?state[field]:null;
  const same=validRef(m,owner)&&here&&new URL(m.path,origin()).pathname===new URL(here,origin()).pathname;
  // Full-map entries are transient duplicates. Their own Back handler closes the map.
  // If navigation interrupted one, use the explicit parent rather than guess across it.
  const from=same&&!state.kinettaMap&&validRef(m.from,owner)?m.from:null;
  if(historyLength>1&&from&&from.path!==here)return {history:true,path:from.path,label:label(from.path)};
  return {history:false,path:target,label:label(target)};
 }
 return Object.freeze({path,parent,label,entry,transition,destination});
})();
