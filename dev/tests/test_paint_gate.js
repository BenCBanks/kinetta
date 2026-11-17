// Gate lifecycle keeps route paint visible and lets the router observe every failure.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/paint-gate.js','utf8');
function fixture(){
 const timers=new Map(),events=[],children=[];let timerId=0;
 const page={dataset:{},attrs:new Map(),children,isConnected:true,setAttribute(k,v){this.attrs.set(k,v);},removeAttribute(k){this.attrs.delete(k);},append(node){node.parent=this;children.push(node);},dispatchEvent(event){events.push(event);}};
 const c={App:{me:{id:1}},Native:{base:''},location:{origin:'https://example.test',pathname:'/activity',search:''},readOwner:()=>c.App.me?.id,
  document:{createElement(){let node;return{set innerHTML(_){node={removed:false,remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}};},get firstElementChild(){return node;}};}},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  requestAnimationFrame(fn){fn();},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},performance:{now:()=>100},
 };
 vm.createContext(c);vm.runInContext(source,c);
 return{c,page,timers,events,children};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const cleaned=({page,children})=>!page.dataset.paintGate&&!page.attrs.has('aria-busy')&&children.every(node=>node.removed);
(async()=>{
 let f=fixture(),work=deferred(),gate=f.c.PaintGate.begin(f.page,'home'),done=false;
 const finished=gate.finish(work.promise).finally(()=>{done=true;});
 f.c.App.me={id:2};f.c.PaintGate.routeChanged();
 assert(cleaned(f),'account switch clears the old owner gate and leaves the page visible');
 assert.equal(f.events.length,0,'a switched account cannot emit the old screen-painted event');
 work.resolve();await finished;assert(done);

 f=fixture();work=deferred();gate=f.c.PaintGate.begin(f.page,'home');const routeWork=gate.finish(work.promise).catch(error=>error);
 f.c.location.pathname='/food';f.c.PaintGate.routeChanged();
 assert(cleaned(f),'route changes clear the open gate synchronously');
 work.resolve();await routeWork;assert.equal(f.events.length,0,'a departed route cannot emit screen-painted');

 f=fixture();gate=f.c.PaintGate.begin(f.page,'home',{cached:true});
 await assert.rejects(gate.finish(Promise.reject(Error('cached API failure'))),/cached API failure/,'cached reads keep their rejection for the router error screen');

 f=fixture();work=deferred();gate=f.c.PaintGate.begin(f.page,'progress');let settled=false;
 const late=gate.finish(work.promise).finally(()=>{settled=true;});
 const [id,timer]=[...f.timers.entries()][0];assert.equal(timer.ms,1450,'reveal stays below the 1.5 second cap with scheduler margin');timer.fn();
 await Promise.resolve();assert(cleaned(f),'the 1.5 second cap reveals the real screen');assert.equal(settled,false,'the cap reveals but does not resolve outstanding work');
 work.reject(Error('late API failure'));await assert.rejects(late,/late API failure/,'an error after the cap still reaches the router');assert.equal(f.events.length,1,'the owner still receives one first-paint event before the late error');
 console.log('Paint gate: account/route cleanup, cached rejection and 1.5s reveal preserve router errors PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
