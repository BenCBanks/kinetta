'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/route-following.js','utf8');
function fixture(){
 const storage=new Map();let epoch=1,selected=null,full=false;
 const c={console,TextEncoder,App:{me:{id:1}},serverKey:()=> 'https://example.test',readOwner:()=> 'session-'+epoch,navigator:{onLine:true},document:{hidden:false,addEventListener(){}},window:{addEventListener(){}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(full)throw Error('quota');storage.set(k,v)},removeItem:k=>storage.delete(k)},
  api:async()=>{throw Object.assign(Error('offline'),{offline:true})},PlanTrack:{get:()=>selected,set(r){if(r)c.downloads.save(r);selected=r;}}};
 vm.createContext(c);vm.runInContext(source+'\nthis.math=RouteMath;this.downloads=RouteDownloads;',c);
 return{c,storage,selected:()=>selected,setOwner(id){epoch++;c.App.me=id?{id}:null;selected=null;c.downloads.attach()},fill(v){full=v}};
}
const f=fixture(),M=f.c.math;
const north=(m,e=0)=>[45.3+m/111195,10.2+e/(111195*Math.cos(45.3*Math.PI/180))];
function encode(points){let text='',a=0,b=0;for(const p of points){const x=Math.round(p[0]*1e5),y=Math.round(p[1]*1e5);for(let v of[x-a,y-b]){v=v<0?~(v<<1):v<<1;while(v>=32){text+=String.fromCharCode(((v&31)|32)+63);v>>=5;}text+=String.fromCharCode(v+63);}a=x;b=y;}return text;}
// Actual encoded polyline fixtures, including invalid/truncated data; no map/provider dependency.
const line=encode([north(0),north(1000)]);assert.equal(M.decode(line).length,2);
for(const bad of['','?','~~~~~~','\n???','??\x7f?'])assert.throws(()=>M.decode(bad));
const route={schema:1,kind:'owned',id:3,version:2,name:'Fictional trail',sport:'run',distance_m:1000,line,warnings:['Manual section'],attribution:['OpenStreetMap contributors'],downloadedAt:100};
const course=M.compile([north(0),north(1000)]);
function fix(m,at,e=0,accuracy=5,segment=0){const p=north(m,e);return{lat:p[0],lon:p[1],accuracy,at,segment};}
let s={};for(let m=0;m<=1000;m+=10)s=M.position(course,fix(m,m*250+1000),s);
assert.equal(s.known,true);assert.equal(s.complete,true);assert.ok(s.remaining<1);assert.equal(s.partway,false);
let part=M.position(course,fix(500,1000),{});assert.equal(part.known,false);part=M.position(course,fix(510,3500),part);assert.equal(part.known,true);assert.equal(part.partway,true);assert.ok(part.m>505&&part.m<515);
let reverse=M.position(course,fix(700,1000),{});reverse=M.position(course,fix(690,3500),reverse);assert.equal(reverse.known,false,'reverse travel is not forward progress');
assert.equal(M.position(course,fix(200,4000,0,70),part).known,false);
const gap=M.position(course,fix(800,90000),part);assert.equal(gap.known,false);assert.equal(gap.m,part.m,'a gap never jumps ahead');
assert.equal(M.position(course,fix(520,5000,0,5,1),part).known,false,'pause/segment boundary is uncertain');
assert.equal(M.position(course,fix(510,3000),part).known,false,'backwards clocks are unknown');
assert.equal(M.startDistance(course,fix(100,1000),30000),null,'stale pre-start position');assert.equal(M.startDistance(course,fix(100,1000,0,30),2000),null);assert.ok(M.startDistance(course,fix(100,1000),2000)>99);
// Out-and-back branches occupy the same coordinates. Direction disambiguates, then the local window prevents a jump.
const outback=M.compile([north(0),north(500),north(0)]);let ob={};for(let m=0;m<=200;m+=10)ob=M.position(outback,fix(m,1000+m*250),ob);
assert.equal(ob.known,true);assert.ok(ob.m<210,'outgoing route never becomes the return branch');
const repeated=M.compile([north(0),north(500),north(500,200),north(0,200),north(0),north(500)]);let repeat=M.position(repeated,fix(0,1000),{});repeat=M.position(repeated,fix(10,6000),repeat);assert.equal(repeat.known,false,'indistinguishable repeated sections cannot invent a later lap');
const crossing=M.compile([north(0),north(200,200),north(0,200),north(200),north(400,200)]);const x=fix(100,1000,100);const ambiguous=M.position(crossing,x,{});assert.equal(ambiguous.known,false,'an unresolved crossing stays unknown');
const broken=M.compile([north(0),north(100),north(1000),north(1100)],[2]);assert.ok(broken.total<201);assert.equal(M.position(broken,fix(500,2000),{}).known,false,'no invented path across missing sections');
const points=Array.from({length:41},(_,i)=>({lat:north(i*10)[0],lon:10.2,t:i*2.5,accuracy:5,segment:0}));const input=JSON.stringify(points);const replay=M.replay(course,points,1000);assert.ok(replay.m>390&&replay.m<410);assert.equal(JSON.stringify(points),input,'following never edits recorded fixes');assert.equal(M.replay(course,points,1000,replay).m,replay.m);
(async()=>{
 const d=f.c.downloads;d.save(route);const before=[...f.storage.values()][0];f.fill(true);assert.throws(()=>d.save({...route,version:3}),/previous complete copy/);f.fill(false);assert.equal([...f.storage.values()][0],before);
 await d.choose('owned',3);assert.equal(f.selected().version,2,'completed download is selectable while disconnected');
 const pinned=d.pin();d.save({...route,version:3});assert.equal(pinned.version,2,'a pinned snapshot is independent of later library edits');
 let release;f.c.api=()=>new Promise(ok=>release=ok);const pending=d.choose('owned',3);f.setOwner(2);release({id:3,version:4,name:route.name,sport:'run',distance_m:1000,full_line:line});await assert.rejects(pending,/account.*changed/);assert.equal(d.list().length,0,'late old-account reply cannot populate the next library');
 f.setOwner(1);const shared={...route,kind:'shared',id:7,snapshot_key:'a'.repeat(64)};d.save(shared);await d.choose('shared',7,{offline:true});const active=d.pin();f.c.api=async()=>{throw Object.assign(Error('Revoked'),{status:404})};await assert.rejects(d.beforeStart(),/Revoked/);assert.equal(d.list().some(r=>r.kind==='shared'),false);assert.equal(active.snapshot_key,shared.snapshot_key,'active pinned geometry remains an independent snapshot');
 d.save(shared);f.setOwner(2);f.setOwner(1);assert.equal(d.list().some(r=>r.kind==='shared'),false,'account change purges revocable shared originals');assert.equal(d.list()[0].kind,'owned','own downloads remain isolated for that account');
 d.eraseDevice();assert.equal(d.list().length,0);for(let i=0;i<30;i++)d.save({...route,id:100+i});assert.throws(()=>d.save({...route,id:999}),/limit/);assert.equal(d.list().length,30);d.eraseDevice();
 console.log('PASS route following: complete/partway/reverse/crossings/out-and-back/gaps/poor/stale fixes, immutable recorded inputs; atomic downloads, offline selection, pinned versions, account guards, revocation and deletion');
})().catch(e=>{console.error(e);process.exitCode=1});
