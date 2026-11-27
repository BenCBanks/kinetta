// Run the real menu and coordinator: await recap reload, conceal failures, retain legacy sharing handler.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node {
 constructor(){this.children=[];this.hidden=false;this.isConnected=true;this.dataset={};}
 append(...nodes){this.children.push(...nodes);for(const n of nodes)n.parentElement=this;}
 prepend(n){this.children=this.children.filter(x=>x!==n);this.children.unshift(n);n.parentElement=this;}
 setAttribute(){}
}
const tick=()=>new Promise(setImmediate);
(async()=>{
 for(const action of ['sharing','recap-consent']){
  let owner='fictional-one',button={dataset:{gact:action}},release,fail=false,reloads=0;
  const root=new Node(),content=new Node();root.append(content);
  const writes=[],group={id:'fictional-group',sharing_level:'total_shared',recap_consent:false};
  const ctx={localStorage:{getItem:()=>null,setItem(){},removeItem(){}},readOwner:()=>owner,document:{createElement:()=>new Node(),querySelector:()=>root},AbortController,setTimeout,clearTimeout,
   json:(method,body)=>({method,body:JSON.stringify(body)}),esc:String,svg:()=>'',$$:()=>[button],
   api:async(path,options)=>writes.push({path,body:JSON.parse(options.body)}),
   apiRequest:async path=>({sharing_level:'just_in',recap_consent:true}),
   groupActionSheet:(title,html,mount)=>mount({},()=>{}),toast(){}
  };
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/social-data.js','utf8'),ctx);
  const social=fs.readFileSync('app/static/social.js','utf8');
  vm.runInContext(social.slice(social.indexOf('function groupMenu('),social.indexOf('function groupConfirm(')),ctx);
  ctx.groupMenu(group,async()=>{reloads++;await new Promise(resolve=>release=resolve);if(fail)throw Error('unreadable group');});
  button.onclick();await tick();assert.equal(reloads,1);assert(content.hidden,'do not restore the old page while reload is pending');
  assert.equal(root.children[0].dataset.sharingState,'checking');release();await tick();assert(!content.hidden);
  assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/groups/fictional-group/'+(action==='sharing'?'sharing':'recap-consent'));
  assert.deepEqual(writes[0].body,action==='sharing'?{level:'just_in'}:{consent:true});
  // A reload failure is propagated to the helper; the previous private presentation stays concealed.
  ctx.groupMenu(group,async()=>{throw Error('503');});button.onclick();await tick();
  assert(content.hidden);assert.equal(root.children[0].dataset.sharingState,'unknown');
  const count=writes.length;await root.children[0].children[1].onclick();assert.equal(writes.length,count,'recovery never writes');
  ctx.groupMenu(group,async()=>{});owner='fictional-two';button.onclick();await tick();assert.equal(writes.length,count,'an old menu cannot change the next account');
 }
 console.log('Group privacy: legacy sharing handler, awaited recap reload, failed reload concealment, GET-only Retry and stale owner PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
