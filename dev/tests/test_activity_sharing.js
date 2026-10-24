// Exercise production picture sharing with a fictional owner and transports. No device, account or network access.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/pages.js','utf8');
const start=source.indexOf('function sharePicture('),end=source.indexOf('// cut `m` metres',start);
const tick=()=>new Promise(setImmediate);
function fixture(native=true){
 const nodes={};for(const key of ['#pi-story','#pi-post','#pi-go-story','#pi-go-post','#pi-trim','#pi-trim-row','.pi-note','[data-wrap="story"]','[data-wrap="post"]'])nodes[key]={disabled:false,hidden:false,checked:true,src:'',alt:'',classList:{add(){},remove(){}}};
 const body={isConnected:true,querySelectorAll:()=>[]},calls=[],urls=[],revoked=[],messages=[],pending=[];
 const ctx={App:{},console,File,Blob,Promise,Error,Object,FOOT:['run'],svg:()=>'',readOwner:()=>ctx.owner,owner:'zz_test_owner_a',viewResources:new Map(),
   Native:{activityShareSupported:native,shareActivityPicture:async(image,destination)=>{calls.push({image,destination});return{handedOff:true}}},
   navigator:{},URL:{createObjectURL:()=>{const url='blob:fictional-'+urls.length;urls.push(url);return url},revokeObjectURL:url=>revoked.push(url)},
   FileReader:class{readAsDataURL(){ctx.read=()=>{this.result='data:image/png;base64,fictional';this.onload()};if(!ctx.holdRead)ctx.read()}},
   document:{body:{append(){}},createElement:()=>({click(){calls.push('download')},remove(){}})},
   $:key=>nodes[key],sheet:(title,html,mount)=>{ctx.html=html;ctx.mounted=mount(body,()=>{body.isConnected=false})},
   api:async()=>({trim_m:400}),decode:()=>[[0,0],[1,1]],toast:text=>messages.push(text),
   routePicture:(a,trim,format)=>{calls.push({trim,format});return new Promise((resolve,reject)=>pending.push({resolve,reject,format}))}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 ctx.sharePicture(1,{id:1,name:'Fictional run',sport:'run',line:'fictional',start_time:'2026-10-23T10:00:00Z'});
 return {ctx,nodes,body,calls,revoked,messages,pending};
}
const ready=async f=>{f.pending.shift().resolve(new Blob(['story']));f.pending.shift().resolve(new Blob(['post']));await tick();};
(async()=>{
 let f=fixture();await f.ctx.mounted;
 assert.deepEqual(f.calls.map(c=>c.format),['story','post'],'both pictures are drawn');
 assert(!f.ctx.html.includes('Instagram')&&!f.ctx.html.includes('data-pic-format'),'no Instagram button and no format switch');
 assert(f.nodes['#pi-go-story'].disabled&&f.nodes['#pi-go-post'].disabled,'both wait for their pictures');
 f.pending.shift().resolve(new Blob(['story']));await tick();assert(!f.nodes['#pi-go-story'].disabled&&f.nodes['#pi-go-post'].disabled,'each button waits only for its own picture');
 f.pending.shift().resolve(new Blob(['post']));await tick();
 await f.nodes['#pi-go-post'].onclick();assert.equal(f.calls.at(-1).destination,'system');assert.deepEqual(Object.keys(f.calls.at(-1)).sort(),['destination','image']);
 f.ctx.holdRead=true;const sent=f.calls.length;const sending=f.nodes['#pi-go-story'].onclick();assert(f.nodes['#pi-go-post'].disabled&&f.nodes['#pi-trim'].disabled,'duplicate taps and trim changes held during native conversion');
 await f.nodes['#pi-go-post'].onclick();assert.equal(f.calls.length,sent,'second tap cannot start another export');
 f.ctx.owner='zz_test_owner_b';f.ctx.read();await sending;assert.equal(f.calls.length,sent,'account switch blocks late image handoff');
 console.log('Activity share: Story and Post each share their own previewed image to the system sheet; no Instagram button; duplicate taps and late account changes blocked PASS');

 f=fixture();await f.ctx.mounted;await ready(f);
 f.nodes['#pi-trim'].checked=false;const first=f.nodes['#pi-trim'].onchange();f.nodes['#pi-trim'].checked=true;const second=f.nodes['#pi-trim'].onchange();
 assert(f.nodes['#pi-go-story'].disabled&&f.nodes['#pi-go-post'].disabled);
 f.pending[2].resolve(new Blob(['trimmed story']));f.pending[3].resolve(new Blob(['trimmed post']));await second;const final=f.nodes['#pi-story'].src;
 f.pending[0].resolve(new Blob(['untrimmed story']));f.pending[1].resolve(new Blob(['untrimmed post']));await first;assert.equal(f.nodes['#pi-story'].src,final,'late untrimmed result cannot replace a newer trimmed image');
 f.nodes['#pi-trim'].checked=false;const failed=f.nodes['#pi-trim'].onchange();f.pending[4].reject(new Error('Fictional failure'));f.pending[5].reject(new Error('Fictional failure'));await failed;
 assert(f.nodes['#pi-go-story'].disabled&&f.nodes['#pi-go-post'].disabled,'failed privacy redraw cannot export the previous picture');
 const exports=f.calls.length;await f.nodes['#pi-go-story'].onclick();assert.equal(f.calls.length,exports);
 f.ctx.viewResources.get(f.body)();assert(f.revoked.includes(final),'closing releases preview URLs');
 console.log('Activity share: trim races, failed redraw and close cannot leak an older untrimmed picture PASS');

 f=fixture(false);await f.ctx.mounted;await ready(f);
 f.ctx.navigator.canShare=()=>true;let activate=false;f.ctx.navigator.share=()=>{activate=true;return Promise.resolve()};
 const browser=f.nodes['#pi-go-story'].onclick();assert(activate,'browser share called synchronously from the tap');await browser;
 f.ctx.navigator.share=()=>Promise.reject(Object.assign(new Error('cancelled'),{name:'AbortError'}));const count=f.messages.length;await f.nodes['#pi-go-post'].onclick();assert.equal(f.messages.length,count,'user cancellation is quiet');
 f.ctx.navigator.canShare=()=>false;await f.nodes['#pi-go-post'].onclick();assert.equal(f.messages.at(-1),'Picture saved');
 f.body.isConnected=false;const exports2=f.calls.length;await f.nodes['#pi-go-story'].onclick();assert.equal(f.calls.length,exports2,'closed sheet cannot send');
 console.log('Activity share: immediate Web Share, quiet cancellation, honest image-download fallback and closed-sheet guard PASS');
 const native=fs.readFileSync('app/static/native.js','utf8');
 const block=native.slice(native.indexOf('  N.activityShareSupported'),native.indexOf('  N.headers ='));
 const bridgeCalls=[],old={on:false,P:{},N:{}};vm.createContext(old);vm.runInContext(block,old);assert.equal(old.N.activityShareSupported,false);await old.N.stopActivityShare();
 const bridge={on:true,P:{KinettaActivityShare:{share:async value=>bridgeCalls.push(value),cancel:async()=>bridgeCalls.push('cancel')}},N:{token:'fictional-token',base:'https://fictional.test'}};
 vm.createContext(bridge);vm.runInContext(block,bridge);assert.equal(bridge.N.activityShareSupported,true);await bridge.N.shareActivityPicture('fictional-image','instagram');assert.equal(JSON.stringify(bridgeCalls[0]),JSON.stringify({image:'fictional-image',destination:'instagram'}));await bridge.N.stopActivityShare();assert.equal(bridgeCalls[1],'cancel');
 console.log('Native share bridge: older/web builds cancel safely; supported builds send image/destination only and cancel pending handoff PASS');
 const app=fs.readFileSync('app/static/app.js','utf8'),closeCalls=[];
 const account={App:{me:{id:1},cache:{clear(){}}},readSessions:new WeakMap(),Native:{stopActivityShare:async()=>closeCalls.push('native')},keep(){},forgetKept(){},render(){}};
 account.App.mediaMapBack=()=>closeCalls.push('map');account.App.closeActivityShare=()=>closeCalls.push('picture');vm.createContext(account);
 vm.runInContext(app.slice(app.indexOf('function refreshMe('),app.indexOf('// ---------- offline:')),account);account.refreshMe({id:2});assert.equal(closeCalls.join(','),'map,picture,native');closeCalls.length=0;account.refreshMe({id:2});assert.equal(closeCalls.length,0,'same-account refresh keeps its interaction');
 console.log('Account replacement closes private map/picture/native handoffs; same-account refresh retains interaction PASS');
})().catch(error=>{console.error(error);process.exit(1)});
