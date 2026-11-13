// Exercise the unified picture sheet with fake DOM nodes and fictional image data.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate);
function harness({native=false,api:apiImpl}={}){
 let owner='zz_test_owner_a',options,html,objectId=0,anchorClicks=0;const timers=new Map(),objects=new Map(),revoked=[],toasts=[],apiCalls=[];
 const body={isConnected:true},images=[],choices=[],actions=[],active={};let scrollHandler=null;
 const row={children:choices,clientWidth:286,centerIndex:0,getBoundingClientRect:()=>({left:0,width:286}),addEventListener:(name,handler)=>{if(name==='scroll')scrollHandler=handler;}};
 const controls={_html:'',inputs:[],renders:0};Object.defineProperty(controls,'innerHTML',{get(){return this._html;},set(value){this._html=value;this.renders++;this.inputs=[...value.matchAll(/<input type="checkbox" data-share-control="([^"]+)"( checked)?/g)].map(match=>({dataset:{shareControl:match[1]},checked:!!match[2],disabled:false}));}});
 const note={textContent:''},description={textContent:''},status={textContent:''},send={disabled:true},save={disabled:true,hidden:false};
 const document={activeElement:null,body:{append(){}},createElement(tag){if(tag==='a')return{href:'',download:'',click(){anchorClicks++;},remove(){}};throw Error('Unexpected element '+tag);}};
 const urlApi={createObjectURL(blob){const url='blob:share-'+(++objectId);objects.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);objects.delete(url);}};
 const cardData={enabled:true,url:'https://example.test/card/fictional',preview:{username:'zz_test_owner_a',sports:[],stats:[],achievements:[]}};
 const context={Blob,AbortController,File:class extends Blob{constructor(parts,name,options){super(parts,options);this.name=name;}},FileReader:class{readAsDataURL(){this.result='data:image/png;base64,fictional';this.onload?.();}},URL:urlApi,
   Native:{on:native,activityShareSupported:false,headers:()=>({})},App:{me:{id:1},closeActivityShare:null},readOwner:()=>owner,viewResources:new Map(),location:{origin:'https://example.test'},
   api:async path=>{apiCalls.push(path);return apiImpl?apiImpl(path,cardData):cardData;},fetch:async()=>({ok:true,blob:async()=>new Blob(['fictional card'])}),navigator:{},
   document,setTimeout:(fn,ms)=>{const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
   sheet:(title,markup,mount)=>{
     html=markup;choices.length=0;images.length=0;actions.length=0;
     for(const match of markup.matchAll(/data-share-choice="(\d+)"/g)){const index=Number(match[1]),choice={dataset:{shareChoice:String(index),busy:'true'},attrs:{},tabIndex:-1,setAttribute(name,value){this.attrs[name]=value;},scrollIntoView(){row.centerIndex=index;},focus(){document.activeElement=this;},getBoundingClientRect(){return{left:(index-row.centerIndex)*300,width:250};}};choices.push(choice);images.push({src:'',alt:'',hidden:true,removeAttribute(name){if(name==='src')this.src='';}});}
     for(const match of markup.matchAll(/data-share-action="(\d+)"/g))actions.push({dataset:{shareAction:match[1]},disabled:false});
     save.hidden=/data-share-save[^>]*hidden/.test(markup);body.isConnected=true;mount(body,()=>{body.isConnected=false;});
   },
   $:(selector)=>{
     if(selector==='.share-picture-row')return row;if(selector==='[data-share-controls]')return controls;if(selector==='[data-share-note]')return note;
     if(selector==='[data-share-description]')return description;if(selector==='.share-picture-status')return status;if(selector==='[data-share-send]')return send;if(selector==='[data-share-save]')return save;
     let match=selector.match(/^\[data-share-choice="(\d+)"\]$/);if(match)return choices[Number(match[1])];
     match=selector.match(/^\[data-share-image="(\d+)"\]$/);if(match)return images[Number(match[1])];return null;
   },
   $$:(selector)=>selector==='[data-share-choice]'?choices:selector==='[data-share-control]'?controls.inputs:selector==='[data-share-action]'?actions:[],
   esc:String,svg:()=>'',toast:message=>toasts.push(message),route:()=>{},col:()=> '#ffffff',getComputedStyle:()=>({getPropertyValue:()=> 'system-ui'}),
   setOwner:value=>{owner=value;},getObjects:()=>objects,getTimers:()=>timers,getState:()=>({html,anchorClicks,scrollHandler,revoked,toasts,apiCalls,body,choices,images,actions,controls,note,description,status,send,save,document})};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('app/static/share-art.js','utf8')+'\n'+fs.readFileSync('app/static/recaps.js','utf8')+'\n'+fs.readFileSync('app/static/cards.js','utf8')+'\nthis.shareSheetTest=ShareSheet;this.shareArtTest=ShareArt;this.kinettaCardTest=KinettaCard;',context);
 context.openShare=value=>{options=value;context.shareSheetTest.open(value);};
 return context;
}
(async()=>{
 let c=harness(),pending=[];const item={label:'Route map',filename:'route.png',controls:[{key:'hideEnds',label:'Hide endpoints',checked:true}],build:state=>new Promise((resolve,reject)=>pending.push({state,resolve,reject}))};
 c.openShare({items:[item]});let state=c.getState();assert.match(state.html,/role="radiogroup"/);assert.equal(state.choices[0].attrs['aria-checked'],'true');assert.equal(state.choices[0].tabIndex,0);assert.match(fs.readFileSync('app/static/recaps-ui.css','utf8'),/\.share-picture-choice\[aria-checked=true\]\s*\.share-picture-frame/,'the selected radio has a visible frame');
 state.controls.inputs[0].checked=false;const first=state.controls.inputs[0].onchange();state.controls.inputs[0].checked=true;const second=state.controls.inputs[0].onchange();
 assert.equal(pending[1].state.hideEnds,false);assert.equal(pending[2].state.hideEnds,true);pending[2].resolve(new Blob(['trimmed']));await second;const newest=state.images[0].src;pending[1].resolve(new Blob(['late full route']));await first;assert.equal(state.images[0].src,newest,'a late redraw cannot replace the latest choice');
 state.controls.inputs[0].checked=false;const failed=state.controls.inputs[0].onchange();pending[3].reject(Error('Fictional redraw failure'));await failed;assert(state.images[0].hidden&&state.images[0].src==='','failed redraw clears the old preview');assert(state.send.disabled,'failed redraw cannot be shared');await state.send.onclick();assert.equal(c.navigator.share,undefined,'no share starts after a failed redraw');
 console.log('Share sheet: trim races, late results, cleared failed previews and sharing gate PASS');

 c=harness();c.openShare({items:[{label:'One',build:async()=>new Blob(['one'])},{label:'Two',build:async()=>new Blob(['two'])}]});await tick();state=c.getState();const renders=state.controls.renders;let prevented=false;state.choices[0].onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});await tick();assert(prevented);assert.equal(state.choices[1].attrs['aria-checked'],'true');assert.equal(state.choices[1].tabIndex,0);assert.equal(state.document.activeElement,state.choices[1]);const afterArrow=state.controls.renders;state.scrollHandler();const scrollTimer=[...c.getTimers().values()].find(timer=>timer.ms===120);assert(scrollTimer,'scroll settle timer uses the current 120ms delay');scrollTimer.fn();assert.equal(state.controls.renders,afterArrow,'settling a scroll on the selected picture does not redraw its controls');assert(afterArrow>renders);
 console.log('Share sheet: arrow-key radio movement and stable scroll selection PASS');

 let marked=0,release;const gate=new Promise(resolve=>release=resolve);c=harness();c.openShare({items:[{label:'Milestone',build:async()=>new Blob(['milestone'])}],actions:[{label:'Dismiss milestone',run:async()=>{marked++;await gate;}}]});await tick();state=c.getState();const action=state.actions[0],firstDismiss=action.onclick();assert.equal(marked,1);assert.equal(action.disabled,true);await action.onclick();assert.equal(marked,1,'a second tap cannot repeat the pending mark');release();await firstDismiss;assert.equal(action.disabled,false);
 console.log('Share sheet: Dismiss milestone has a double-tap busy guard PASS');

 c=harness();let successful=0;const cardItems=await c.kinettaCardTest.shareItems('/people/zz_test_owner_a');assert.equal(cardItems.length,1);assert.equal(cardItems[0].beforeShare,undefined,'card validation is not deferred until the user taps Share');c.openShare({items:[{...cardItems[0],afterShare:async()=>successful++}]});state=c.getState();for(let i=0;i<8&&state.send.disabled;i++)await tick();assert(!state.send.disabled,'the card picture check finishes before the Share action is available');c.navigator.canShare=()=>true;let sharePayload=null;c.navigator.share=payload=>{sharePayload=payload;return Promise.resolve();};const sending=state.send.onclick();assert(sharePayload,'browser share starts immediately inside the tap handler');assert.equal(c.getState().apiCalls.filter(path=>path==='/api/card').length,2,'card freshness is checked while building the item');await sending;assert.equal(successful,1);
 c.navigator.share=()=>Promise.reject(Object.assign(Error('Cancelled'),{name:'AbortError'}));const priorStatus=state.status.textContent;await state.send.onclick();assert.equal(successful,1,'cancel does not mark the picture shared');assert.equal(state.status.textContent,priorStatus,'cancel stays quiet');assert.deepEqual(state.toasts,[]);
 console.log('Share sheet: card check precedes the tap; browser share is immediate and cancellation stays quiet PASS');

 c=harness({native:true});let saved=0;c.openShare({items:[{label:'Milestone',build:async()=>new Blob(['milestone']),afterSave:async()=>saved++}]});await tick();state=c.getState();assert(state.save.hidden,'native app hides the browser-only Save control');await state.save.onclick();assert.equal(saved,0,'a failed native save cannot mark the milestone shared');assert.match(state.status.textContent,/Use Share instead/);
 let oldShare=0;c.openShare({items:[{label:'Milestone',build:async()=>new Blob(['milestone']),afterShare:async()=>oldShare++}]});await tick();state=c.getState();await state.send.onclick();assert.equal(oldShare,0,'an unsupported native bridge cannot record a handoff');assert.equal(state.anchorClicks,0,'an iPhone download link is never treated as a share');assert.match(state.status.textContent,/cannot share pictures/);
 console.log('Share sheet: iPhone hides Save and never records an unsuccessful save PASS');

 c=harness();c.Native.activityShareSupported=true;const nativePayload=[];c.Native.shareActivityPicture=async(...args)=>{nativePayload.push(args);return{handedOff:true};};assert.equal(await c.shareArtTest.deliver(new Blob(['image']),'fictional.png',()=>true,'https://example.test/people/demo'),true);assert.deepEqual(nativePayload,[['data:image/png;base64,fictional','system','https://example.test/people/demo']]);
 console.log('Share sheet: native payload carries only the picture, system destination and chosen link PASS');
})().catch(error=>{console.error(error);process.exit(1)});
