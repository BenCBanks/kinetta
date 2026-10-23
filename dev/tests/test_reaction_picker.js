// Real reaction controller with stand-in DOM/network: no users, devices or notifications.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/social.js','utf8');
function setup(){
 let owner='fictional-owner',hit=null;const timers=new Map(),pending=[],resources=new Map(),changes=[],people=[],errors=[];let timer=0;
 const document={activeElement:null,handlers:new Map(),addEventListener(k,f){(this.handlers.get(k)||this.handlers.set(k,[]).get(k)).push(f);},removeEventListener(k,f){this.handlers.set(k,(this.handlers.get(k)||[]).filter(x=>x!==f));},elementFromPoint:()=>hit};
 function node(dataset={}){return {dataset,hidden:false,isConnected:true,children:[],style:{},attrs:{},handlers:new Map(),classList:{remove(){}},innerHTML:'',
  setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;},
  addEventListener(k,f){(this.handlers.get(k)||this.handlers.set(k,[]).get(k)).push(f);},removeEventListener(){},
  appendChild(n){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);this.children.push(n);n.parentElement=this;},remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.isConnected=false;},
  contains(n){return this===n||this.children.some(c=>c.contains(n));},focus(options){this.focusOptions=options;document.activeElement=this;},
  getBoundingClientRect(){return {left:20,top:450,bottom:494,width:260,height:90};},closest(selector){return selector==='[data-react]'&&this.dataset.react?this:null;}};}
 document.body=node();const group=node({aid:'7',mine:''}),main=node(),more=node(),count=node(),picker=node(),action=node(),options=['cheer','strong','applause'].map(react=>node({react}));picker.hidden=true;
 group.appendChild(action);action.appendChild(main);action.appendChild(more);group.appendChild(count);group.appendChild(picker);for(const n of options)picker.appendChild(n);
 const nodes={'.reaction-main':main,'.reaction-more':more,'.reaction-count':count,'.reaction-picker':picker,'.reaction-action':action};
 const window={visualViewport:{offsetTop:0,height:844},handlers:new Map(),addEventListener(k,f){this.handlers.set(k,f);},removeEventListener(k){this.handlers.delete(k);}};
 const ctx={document,window,innerWidth:390,innerHeight:844,Date,Math,matchMedia:()=>({matches:true}),Native:{haptic(){}},viewResources:resources,
  SocialData:{remember(){},warm(){},watch(){},forget(){}},readOwner:()=>owner,$:(s,root)=>s==='.num'?(root._num||=node()):nodes[s],$$:()=>options,svg:k=>`<svg>${k}</svg>`,json:(method,body)=>({method,body:JSON.stringify(body)}),
  api:(url,opts)=>new Promise((resolve,reject)=>pending.push({url,opts,resolve,reject})),socialChanged:id=>changes.push(id),toast:s=>errors.push(s),
  setTimeout:f=>{timers.set(++timer,f);return timer;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const REACTIONS='),source.indexOf('\nconst VIS ='))+source.slice(source.indexOf('function cheerGesture'),source.indexOf('\nfunction activityCheers')),ctx);
 // Icon-only choices must retain a stable accessible name for each reaction.
 const markup=vm.runInContext('reactionButtons(7,{reactions:{}})',ctx);
 for(const label of ['Cheers','Strong','Applause'])assert(markup.includes('role="menuitemradio" aria-label="'+label+'"'));
 ctx.activityCheers=id=>people.push(id);ctx.wireReactionGroup(group,7);
 return {ctx,document,window,group,main,more,count,picker,options,pending,resources,timers,changes,people,errors,setOwner:v=>{owner=v;},setHit:v=>{hit=v;}};
}
const event=(extra={})=>({button:0,isPrimary:true,detail:1,clientX:10,clientY:10,preventDefault(){},stopPropagation(){},...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fire=(el,key,e=event())=>(el.handlers.get(key)||[]).forEach(f=>f(e));
(async()=>{
 const s=setup();assert.equal(s.window.handlers.has('scroll'),false,'closed reaction groups do not listen to every scroll');assert.equal((s.document.handlers.get('pointerdown')||[]).length,0);s.more.onclick(event());assert(s.window.handlers.has('scroll'));assert.equal(s.document.handlers.get('pointerdown').length,1);assert(!s.picker.hidden);assert.equal(s.document.activeElement,s.options[0]);assert.equal(s.options[0].focusOptions.preventScroll,true,'opening the fixed picker cannot scroll the page and dismiss itself');assert.equal(s.pending.length,0);
 fire(s.picker,'keydown',event({key:'ArrowRight'}));assert.equal(s.document.activeElement,s.options[1]);
 fire(s.picker,'keydown',event({key:'Escape'}));assert(s.picker.hidden);assert.equal(s.window.handlers.has('scroll'),false);assert.equal(s.document.handlers.get('pointerdown').length,0);assert.equal(s.document.activeElement,s.main);
 s.more.onclick(event());s.options[1].onclick(event());assert.equal(s.pending.length,1);assert.equal(s.pending[0].opts.body,'{"kind":"strong"}');assert(s.main.attrs['aria-label'].startsWith('Strong.'));assert(s.main.disabled);assert(s.main.innerHTML.includes('>1</span>'),'reaction total changes immediately');assert.equal(s.main.dataset.kind,'strong');assert(s.count.innerHTML.includes('data-kind="strong"'),'people summary shows the selected reaction type');
 s.main.onclick(event({detail:0}));assert.equal(s.pending.length,1,'a busy reaction cannot be submitted twice');
 s.pending.shift().resolve({my_reaction:'strong',reactions:{cheer:0,strong:1,applause:0}});await tick();assert(!s.main.disabled);assert.equal(s.changes.length,1);
 s.count.onclick(event());assert.deepEqual(s.people,[7]);
 s.main.onclick(event({detail:0}));assert.equal(s.pending[0].opts.method,'DELETE');s.pending.shift().reject(Error('Fictional failure'));await tick();assert(s.main.attrs['aria-label'].startsWith('Strong.'));assert.deepEqual(s.errors,['Fictional failure'],'failed write rolls back selected reaction and count');
 s.more.onclick(event());s.options[1].onclick(event());assert.equal(s.pending.length,0,'choosing selected reaction is a no-op; main tap removes it');
 s.more.onclick(event());for(const f of s.document.handlers.get('pointerdown'))f(event({target:s.document.body}));assert(s.picker.hidden);assert.equal(s.pending.length,0);
 s.more.onclick(event());s.setOwner('other-owner');s.options[2].onclick(event());assert.equal(s.pending.length,0,'old-account menus cannot write');
 for(const clean of s.resources.values())clean();assert(s.picker.hidden);assert.equal(s.document.body.children.length,0);
 const h=setup();h.main.onpointerdown(event());[...h.timers.values()].forEach(f=>f());assert(!h.picker.hidden);assert.equal(h.pending.length,0,'hold reveals choices without sending Cheers');
 h.setHit(h.options[2]);h.main.onpointerup(event());h.main.onclick(event());assert.equal(h.pending.length,1,'held slide/release sends once');assert.equal(h.pending[0].opts.body,'{"kind":"applause"}');
 h.setOwner('changed');h.pending.shift().resolve({my_reaction:'applause',reactions:{cheer:0,strong:0,applause:1}});await tick();assert.equal(h.changes.length,0,'late reply cannot refresh another account');
 for(const clean of h.resources.values())clean();
 const detached=setup();detached.main.onclick(event({detail:0}));detached.group.isConnected=false;detached.pending.shift().resolve({my_reaction:'cheer',reactions:{cheer:1},cheers:[],comments:[]});await tick();assert.equal(detached.changes.length,1,'a same-account write invalidates stale reads after navigation too');
 assert.equal(typeof setup().ctx.shareActivity,'undefined','activity links are no longer shared (pictures instead)');
 console.log('Reaction picker: reveal without mutation, keyboard, optimistic select/remove/rollback, busy/reselection guards, people count, outside dismissal, hold-slide once, stale owner/reply and cleanup PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
