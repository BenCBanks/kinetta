// Explore Kinetta and the public guide describe the shipped navigation (#762): every destination is a real screen,
// every named step exists, and no entry points at the retired "More" menus. No server or browser needed.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const box={route(){}};vm.createContext(box);
vm.runInContext(read('app/static/explore.js')+';globalThis.catalog=FEATURE_GUIDE;',box);
const statics=fs.readdirSync(path.join(root,'app/static')).filter(f=>f.endsWith('.js')).map(f=>read('app/static/'+f));
const routes=statics.flatMap(src=>[...src.matchAll(/^route\((\/\^.*?\$\/i?),/gm)].map(m=>new Function('return '+m[1])()));
assert(routes.length>40,'found the app routes');
assert(routes.some(re=>re.test('/me/explore')),'Explore remains reachable from Me/search after leaving Track tools');
const foodViews=new Set(['log',...[...read('app/static/food-home.js').matchAll(/\['(\w+)', '[^']+', '[^']+', '\w+', 'c-\w+'\]/g)].map(m=>m[1])]);
const pages=read('app/static/pages.js'),progressViews=new Set([...pages.match(/const PVIEWS = \[([\s\S]*?)\]\];/)[1].matchAll(/\['(\w+)', '/g)].map(m=>m[1]));
const progressTiles=new Set([...pages.match(/const PEXPLORE = \[([\s\S]*?)\n\];/)[1].matchAll(/\['\w+','([^']+)'/g)].map(m=>m[1]));
const foodTiles=new Set([...read('app/static/food.js').match(/async function foodDiscovery[\s\S]*?Discovery\.render/)[0].matchAll(/title:'([^']+)'/g)].map(m=>m[1]));
let tileSteps=0;
for(const [group,title,,href,how] of box.catalog){
  const url=new URL(href,'https://kinetta.example'),where=`${group} / ${title}`;
  assert(routes.some(re=>re.test(url.pathname)),`${where}: ${url.pathname} is a real screen`);
  const view=url.searchParams.get('view');
  if(view&&url.pathname==='/food')assert(foodViews.has(view),`${where}: Nutrition view ${view} exists`);
  if(view&&url.pathname==='/progress')assert(progressViews.has(view),`${where}: Progress view ${view} exists`);
  assert.doesNotMatch(how,/→ More\b|\bMore →|Log sets and reps/,`${where}: no retired menu or button names`);
  for(const m of how.matchAll(/Explore your progress → ([A-Z][\w ]*?[a-z])(?=[,.]| and | then )/g)){tileSteps++;assert(progressTiles.has(m[1]),`${where}: Progress tile ${m[1]} exists`);}
  for(const m of how.matchAll(/Explore your food → ([A-Z][\w &]*?[a-z])(?=[,.]| and | then | for |$)/g)){tileSteps++;assert(foodTiles.has(m[1]),`${where}: Nutrition tile ${m[1]} exists`);}
}
assert(tileSteps>=10,`checked the named Explore tiles (${tileSteps})`);
const guide=read('site/guide.html');
assert.doesNotMatch(guide,/→ More\b|\bMore →/,'public guide has no retired More paths');
assert.match(guide,/Open Me → Explore Kinetta → Goals to add or update a target/,'public Guide points to Explore in Me after its Track tile is removed');
assert.doesNotMatch(guide,/Open Explore Kinetta → Goals/,'public Guide has no stale Track Explore path for Goals');
assert.doesNotMatch(guide,/<h2>(Calendar|Segments)<\/h2>/,'public guide leaves out default-off features');
const social=read('app/static/social.js'),empty=social.match(/const feedEmpty=\(\)=>`([^`]*)`/)[1];
assert.match(empty,/class="primary wide" href="\/track">Record or import a workout</,'empty Home feed offers a primary next step');
assert.match(empty,/href="\/me\/friends\?find=1">Find friends</,'empty Home feed offers Find friends');
console.log(`Guide paths: ${box.catalog.length} entries point at real screens and named tiles; empty feed has actions PASS`);
