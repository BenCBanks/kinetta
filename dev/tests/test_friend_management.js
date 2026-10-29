'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('app/static/social.js','utf8'),source=s.slice(s.indexOf('const friendCountText'),s.indexOf('function shareProfile('));
function fixture(){
 const nodes=new Map(),node=sel=>{if(!nodes.has(sel))nodes.set(sel,{disabled:false,textContent:'',isConnected:true});return nodes.get(sel);};
 let owner='one',body={isConnected:true},closeCount=0,calls=[],changed=[];
 const c={readOwner:()=>owner,esc:String,profileHref:p=>'/people/'+p.login,json:(method,body)=>({method,body}),invalidate(){},invalidateFeed(){},toast(){},
  $:(sel)=>node(sel),$$:()=>[node('[data-keep]'),node('[data-confirm]')],api:async(path,opts)=>{calls.push([path,opts]);},
  sheet(title,html,mount){c.title=title;c.html=html;mount(body,()=>{closeCount++;body.isConnected=false;});}};
 vm.createContext(c);vm.runInContext(source+'\nglobalThis.countText=friendCountText',c);
 return {c,node,calls,changed,body,changeOwner:()=>owner='two',closeCount:()=>closeCount};
}
(async()=>{
 const r=fixture();r.c.friendChangeSheet({name:'Sam',login:'zz_test_sam'},false,x=>r.changed.push(x));
 assert.match(r.c.html,/They aren’t told/);assert.equal(r.c.countText(1),'1 friend');assert.equal(r.c.countText(0),'No friends yet');
 await r.node('[data-confirm]').onclick();assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],'/api/friends/zz_test_sam');assert.equal(r.calls[0][1].method,'DELETE');assert.equal(r.changed[0].login,'zz_test_sam');
 const f=fixture();f.c.api=async()=>{throw Error('Offline: try again');};f.c.friendChangeSheet({name:'Sam',login:'zz_test_sam'},true,()=>{});await f.node('[data-confirm]').onclick();assert.match(f.node('.err').textContent,/try again/);assert.equal(f.node('[data-confirm]').disabled,false);assert.equal(f.closeCount(),0);
 const stale=fixture();stale.c.friendChangeSheet({name:'Sam',login:'zz_test_sam'},false,()=>{});stale.changeOwner();await stale.node('[data-confirm]').onclick();assert.equal(stale.calls.length,0);
 const pending=fixture();let release;pending.c.api=()=>new Promise(ok=>release=ok);pending.c.friendChangeSheet({name:'Sam',login:'zz_test_sam'},true,x=>pending.changed.push(x));const first=pending.node('[data-confirm]').onclick();await pending.node('[data-confirm]').onclick();pending.changeOwner();release({});await first;assert.equal(pending.changed.length,0,'a completed old-account request cannot redraw the new account');
 console.log('Friend management: app confirmation, exact remove call, retry preservation and account guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
