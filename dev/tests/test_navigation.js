'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('app/static/app.js','utf8');
// Actual quick-entry sheet: opening and prefill are read-only, late prefill respects typing.
(async()=>{
 let owner='one',prefill,closed=0,html='',writes=[],focused=0;
 const field={value:'',focus(){focused++},setCustomValidity(){},reportValidity(){}},button={disabled:false},form={elements:{weight:field}},nodes={'#quick-weight':form},b={isConnected:true};
 const c={App:{me:{weight_kg:75}},readOwner:()=>owner,isoDay:()=> '2026-10-17',dayLabel:()=> 'Today',imp:()=>false,U:{weight:v=>v},esc:String,LB:2.20462,
  sheet:(title,body,fn)=>{html=body;fn(b,()=>closed++)},$:s=>s==='button'?button:nodes[s],load:(path,fn)=>{prefill=fn;return Promise.resolve()},
  sendOrQueue:async(...args)=>{writes.push(args);return{}},invalidate(){},Native:{haptic(){}},toast(){}};
 vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function quickLogSheet'),app.indexOf('function render()')),c);
 c.quickWeighIn();assert.equal(writes.length,0);assert.match(html,/>Today</);assert.equal(focused,1);
 prefill({points:[{day:'2026-10-16',kg:76},{day:'2026-10-15',kg:77}]});assert.equal(field.value,76);
 field.value='74.5';field.oninput();prefill({points:[{day:'2026-10-16',kg:78}]});assert.equal(field.value,'74.5');
 await form.onsubmit({preventDefault(){}});assert.equal(writes.length,1);assert.equal(writes[0][0],'/api/food/weights');assert.equal(writes[0][2].kg,74.5);assert.equal(writes[0][2].day,'2026-10-17');assert.equal(closed,1);
 await form.onsubmit({preventDefault(){}});assert.equal(writes.length,1,'double tap does not repeat save');
 console.log('navigation quick weigh-in: no open write, today, latest prefill, late-read typing guard and explicit one-time save PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
// Hydrate the actual recorder with a fictional paused draft, including account switching.
{
 const data=new Map(),base='https://fictional.invalid',key='kinetta.track:'+JSON.stringify([base,1]);
 data.set(key,{id:'fictional-draft',sport:'run',label:'Run',gps:false,start:1,activeAt:1,checkpoint:1,activeMs:60000,state:'paused',points:[],segment:0,distance:0});
 let owner='one';const c={App:{me:{id:1}},Native:{base},location:{origin:base},readOwner:()=>owner,TrackNative:{supported:false},
 store:{get:k=>data.get(k),del:k=>data.delete(k)},localStorage:{setItem:(k,v)=>data.set(k,JSON.parse(v))},
 navigator:{},document:{addEventListener(){}},window:{addEventListener(){}},setInterval(){},route(){},$:()=>null};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/track.js','utf8')+'\nglobalThis.recorder=Track;',c);
 c.recorder.sync();assert(c.recorder.active,'paused draft is available from centre Log');
 c.App.me={id:2};owner='two';c.recorder.sync();assert(!c.recorder.active,'another account does not inherit the draft');
 c.App.me={id:1};owner='one';c.recorder.sync();assert(c.recorder.active,'returning account restores its draft');
 assert.equal(data.get(key).activeMs,60000,'navigation never invents recording time');
 console.log('navigation recorder: real paused draft restored, cross-account isolated, elapsed time preserved PASS');
}
// Fixed legacy URL contract, checked against the app's registered route patterns.
{
 const files=fs.readdirSync('app/static').filter(f=>f.endsWith('.js')),patterns=[];
 for(const file of files) for(const m of fs.readFileSync('app/static/'+file,'utf8').matchAll(/^route\((\/.*?\/),/gm))patterns.push(vm.runInNewContext(m[1]));
 const old=['/today','/me','/activity','/activity/1','/activity/friends/1','/people/fictional','/me/friends','/me/sharing','/notifications','/me/notifications','/plan','/food/setup','/food/cook/1','/me/health','/track/health','/track','/route/1','/progress','/progress/trends','/progress/calendar','/progress/routes','/progress/heatmap','/records/run/5000','/me/people','/me/import','/track/import','/me/connections','/track/connections','/me/gear','/me/goals','/food','/food/meals','/food/describe','/food/weight','/food/trends','/food/import','/me/explore','/me/kit','/lift/1','/track/lift/1','/lift/ex/1'];
 for(const path of old)assert(patterns.some(re=>re.test(path)),path+' remains routable');
 console.log('navigation legacy URL contract: '+old.length+' previous destinations remain registered PASS');
}
{
 const text=fs.readFileSync('app/static/pages.js','utf8'),data=new Map();
 const c={App:{me:{id:1}},Native:{base:'',token:'fictional-token-never-store'},location:{origin:'https://fictional.invalid'},store:{get:k=>data.get(k),set:(k,v)=>data.set(k,v)}};
 vm.createContext(c);vm.runInContext(text.slice(text.indexOf('const progressKey'),text.indexOf('function nutritionHref'))+'\nglobalThis.choice=progressChoice;',c);
 assert.equal(c.choice(),'food');c.progressSwitch('training');assert.equal(c.choice(),'training');assert([...data.keys()].every(k=>!k.includes('token')));
 c.App.me={id:2};assert.equal(c.choice(),'food');c.App.me={id:1};assert.equal(c.choice(),'training');
 console.log('navigation Progress: food default, remembered training, account isolation, no credentials in preference keys PASS');
}
