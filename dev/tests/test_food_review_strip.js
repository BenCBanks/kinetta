// The review strip counts only finished foods; an unanswered question card never blocks the others,
// and question cards offer one-tap replies. Runs the production thread.js functions with stand-in DOM.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/thread.js','utf8');
const el=()=>({hidden:true,disabled:false,textContent:'',set innerHTML(v){this.markup=v;this.textContent=v.replace(/<[^>]*>/g,'');},attrs:{},setAttribute(k,v){this.attrs[k]=v;},classList:{add(){},remove(){},toggle(){}}});
const nodes={'#thread-review':el(),'#thread-review-add':el(),'#thread-review-sum':el(),'#thread-send':el(),'#thread-text':{value:''}};
const c={Set,Number,Math,JSON,App:{me:{food_photo_itemize:true}},MEAL_NAMES:{lunch:'Lunch'},$:id=>nodes[id],active:()=>true,homeCalories:n=>String(Math.round(n)),Q:{mine:()=>[]},FoodReview:{busy:()=>false},
  esc:s=>String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch]),aiCan:()=>true,aiOffer:()=>false};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('  const queuedReview='),source.indexOf('  async function review(')),c);
vm.runInContext(source.slice(source.indexOf('  function choices(result) {'),source.indexOf('  function changedNumbers(')),c);
const user=(id,draft='d1')=>({id,kind:'user',client_id:'c'+id,result:{review_only:true,draft_id:draft}});
const reply=(to,parts)=>({id:to+100,kind:'reply',reply_to:to,result:{kind:'preview',parts}});
const ready=(...kcal)=>({index:0,status:'ready',entries:kcal.map(k=>({kcal:k}))});
const question={index:0,status:'description',description:{food:'coffee',portion_only:true},question:'Coffee — about how much?',replies:['1','Large','Not sure']};
const ctx={draftId:'d1',jobs:[],visibleClients:new Set(['c1','c2','c3']),messages:[user(1),reply(1,[ready(200,100)]),user(2),reply(2,[question]),user(3),reply(3,[ready(105)])]};
const state=c.held(ctx);
assert.deepEqual([...state.ids],[1,3],'only finished cards are sent to review');
assert.equal(JSON.stringify(state.selections),JSON.stringify([{message:1,parts:[0]},{message:3,parts:[0]}]),'an open draft uses explicit ready-part selections for every included message');
assert.equal(state.ready,3);assert.equal(state.open,1);assert.equal(state.kcal,405);
const allReady={...ctx,messages:[user(1),reply(1,[ready(200)])],visibleClients:new Set(['c1'])};
assert.equal(c.held(allReady).selections,null,'an all-ready draft keeps the legacy whole-message request');
const mixed={...ctx,messages:[user(4),reply(4,[{...ready(220),index:0},{...question,index:1}])],visibleClients:new Set(['c4'])};
assert.equal(JSON.stringify(c.held(mixed).selections),JSON.stringify([{message:4,parts:[0]}]),'a mixed message selects only its ready part');
c.primary(ctx);
assert.equal(nodes['#thread-review'].hidden,false);assert.equal(nodes['#thread-review-add'].disabled,false,'an open question never blocks ready foods');assert.equal(nodes['#thread-review-edit'],undefined,'the review bar has no Edit action');
assert.equal(nodes['#thread-review-sum'].textContent,'3 foods · ≈ 405 kcal');
assert.match(nodes['#thread-review-add'].attrs['aria-label'],/1 unanswered food stays in the chat/);
ctx.jobs=[{id:'c4',draft_id:'d1'}];c.primary(ctx);
assert.equal(nodes['#thread-review-add'].disabled,true,'a message still sending waits');assert.equal(nodes['#thread-review-sum'].textContent,'Checking food…');
ctx.jobs=[];ctx.preparingReview=true;c.primary(ctx);assert.equal(nodes['#thread-review-add'].textContent,'Adding…');assert.equal(nodes['#thread-review'].attrs['aria-busy'],'true');assert.equal(nodes['#thread-review-sum'].textContent,'3 foods · ≈ 405 kcal');
ctx.preparingReview=false;c.FoodReview.busy=()=>true;c.primary(ctx);assert.equal(nodes['#thread-review-add'].disabled,true,'a pending confirmation blocks duplicates');assert.equal(nodes['#thread-review-sum'].textContent,'3 foods · ≈ 405 kcal');c.FoodReview.busy=()=>false;
c.Q.mine=()=>[{path:'/api/food/thread/reviews/5/confirm'}];c.primary(ctx);assert.equal(nodes['#thread-review-add'].disabled,true);assert.equal(nodes['#thread-review-sum'].textContent,'Waiting to sync');c.Q.mine=()=>[];
nodes['#thread-text'].value='Fictional unsent note';c.primary(ctx);assert.equal(nodes['#thread-send'].disabled,false,'Send enables for typed text');assert.equal(nodes['#thread-send'].attrs['aria-label'],'Send message');assert.equal(nodes['#thread-text'].value,'Fictional unsent note');
ctx.jobs=[];ctx.messages=[user(2),reply(2,[question])];c.primary(ctx);
assert.equal(nodes['#thread-review'].hidden,true,'nothing finished, nothing to review');
const html=c.choices({kind:'needs',parts:[{...question,replies:['1','<b>']}]});
assert.match(html,/data-reply="1"/);assert.match(html,/data-reply="&lt;b&gt;"/,'reply labels are escaped');
console.log('food review strip: finished foods only, open questions never block, calorie total, sending waits, escaped quick replies PASS');
// New ingredient-analysis controls need current food capability/consent, while
// the saved explanatory answer remains readable when generation is unavailable.
Object.assign(c,{previewRows:()=>null,changedNumbers:()=>false,kitFoodWords:s=>s,kitHtml:()=>'',svg:()=>'',removeButtonMarkup:floating=>`<button class="thread-remove-unlogged${floating?' thread-remove-floating':''}" data-unlogged-remove>×</button>`,food:()=>{throw Error('An answer must not render another food')}});
vm.runInContext(source.slice(source.indexOf('  function foodMessageBody('),source.indexOf('  function replyHtml(')),c);
vm.runInContext(source.slice(source.indexOf('  function replyHtml('),source.indexOf('  // A "typing" bubble')),c);
const photoAnswer={entries:[],body:'Saved photo answer',result:{kind:'answer',photo_itemize:3}};
c.aiCan=()=>false;assert(!c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize'));
c.aiCan=()=>true;assert(c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize="3"'));
c.App.me.food_photo_itemize=false;assert(!c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize'),'unreviewed ingredient prompt has no action');
console.log('photo breakdown: saved answers remain readable; new analysis requires current food consent/access PASS');

Object.assign(c,{food:e=>`<div class="thread-food">${e.name}</div>`});
const root={id:1,state:'answered',result:{review_only:true}};
for(const values of [[210],[200,100],[0]]){
 const entries=values.map((kcal,i)=>({name:'Food '+i,kcal}));
 const html=c.replyHtml(root,{entries:[],result:{kind:'preview',parts:[{estimated:true,entries}]}});
 assert.match(html,/Estimate breakdown/);assert.match(html,/thread-total/);
 assert(html.includes('≈ '+values.reduce((a,b)=>a+b,0)+' kcal'));
}
const unknown=c.replyHtml(root,{entries:[],result:{kind:'preview',parts:[{estimated:true,entries:[{name:'Unknown food',kcal:null}]}]}});
assert.match(unknown,/Incomplete/);assert(!unknown.includes('≈ 0 kcal'));
console.log('all estimate cards: visible row breakdown and total even one/zero, unknown total stays incomplete PASS');

// A stepper decreases to one portion, where its minus control becomes a named trash action.
Object.assign(c,{fmtAmount:()=>"0.25 serving",source:()=>"Kit’s estimate"});
Object.assign(c,{FoodNutrition:{macros:()=> 'Protein unknown · Carbs unknown · Fat unknown'}});
vm.runInContext(source.slice(source.indexOf('  const nutritionAttr='),source.indexOf('  function choices(')),c);
vm.runInContext(source.slice(source.indexOf('  function previewRows('),source.indexOf('  const queuedReview=')),c);
const removable={index:0,status:'ready',entries:[{name:'Mayonnaise <test>',kcal:25}],drafts:[{portion:{count:.25}}],entry_drafts:[0],remove_entries:[0],remove_token:'a'.repeat(64)};
const rows=c.previewRows(root,{parts:[removable]});
const removedHtml=c.stepRow(rows[0]);assert.doesNotMatch(removedHtml,/aria-label="Remove Mayonnaise &lt;test&gt;"/);assert.doesNotMatch(removedHtml,/class="icon-btn thread-remove"/);
assert.match(removedHtml,/data-step="-1"/);assert.match(removedHtml,/data-step="1"/);assert.doesNotMatch(removedHtml,/data-remove-food=/);
const atOneHtml=c.stepRow({...rows[0],e:{...rows[0].e,amount:1,unit:'serving'}});assert.match(atOneHtml,/aria-label="Remove Mayonnaise &lt;test&gt;"/);assert.match(atOneHtml,/class="icon-btn thread-remove"/);assert.doesNotMatch(atOneHtml,/data-step="-1"/);assert.match(atOneHtml,/data-remove-food=/);
ctx.messages=[user(1),reply(1,[])];c.primary(ctx);assert.equal(nodes['#thread-review'].hidden,true);
assert.equal(c.previewRows({result:{review_only:false}},{parts:[removable]}),null,'logged/legacy rows cannot expose removal');
console.log('estimate removal: quantity-one trash names the food, portion controls remain, final-food review hidden PASS');

// Current draft foods use the sticky review total and the direct remove control; logged/legacy and incomplete cards keep their own honest total.
c.fmtAmount=e=>`${e.amount} ${e.unit}`;
for(const [label,amount,want] of [['1',2,'2 servings'],['1 estimated portion',2,'2 portions'],['1 bottle',1,'1 bottle'],['1 bottle',2,'2 bottles'],['1 hot dog',2,'2 hot dogs'],['1 slice (30 g)',2,'2 servings · 1 slice (30 g) each']])assert.equal(c.threadAmount({amount,unit:'serving',ref:{serving:{label}}}),want);
assert.equal(c.threadAmount({amount:150,unit:'g'}),'150 g');
for(const kcal of [0,120]){
 const entry={name:'Fictional food',amount:1,unit:'serving',kcal},result={kind:'preview',parts:[{index:0,status:'ready',estimated:true,entries:[entry],remove_entries:[0],remove_token:'a'.repeat(64)}]};
 const html=c.replyHtml(root,{entries:[],result});assert(!html.includes('thread-total'));assert(!html.includes('Review before logging')&&!html.includes('Ready to add'),'a compact food card has no permanent instruction caption');assert.equal((html.match(/data-unlogged-remove/g)||[]).length,0,'a single unlogged draft has no wasted close row');assert.equal((html.match(/data-remove-food=/g)||[]).length,1,'a single unlogged draft keeps its title-row remove control');assert(!html.includes('data-more '),'an unlogged draft does not keep the overflow menu');assert(html.includes('data-amount-editor'));
 assert(c.replyHtml({id:1,state:'answered',result:{review_only:false}},{entries:[],result}).includes('thread-total'));
}
const incomplete=c.replyHtml(root,{entries:[],result:{kind:'preview',parts:[{index:0,status:'ready',entries:[{name:'Unknown',amount:1,unit:'serving',kcal:null}]}]}});assert(incomplete.includes('Incomplete'));
console.log('compact drafts: one sticky total, honest incomplete/legacy totals, one card remove control, direct amount action and natural source portions PASS');

const incompleteStrip={...ctx,jobs:[],messages:[user(9),reply(9,[{index:0,status:'ready',entries:[{kcal:null}]}])],visibleClients:new Set(['c9'])};
c.primary(incompleteStrip);
assert.equal(nodes['#thread-review-sum'].textContent,'1 food · Incomplete','missing calories stay visibly incomplete');
assert.equal(nodes['#thread-review-add'].disabled,true,'one-tap Add is unavailable until every selected calorie is known');
assert.match(nodes['#thread-review-add'].attrs['aria-label'],/Edit the food details to add missing values/,'the unavailable action explains how to fix the details');
assert.equal(nodes['#thread-review-edit'],undefined,'incomplete food keeps the review bar free of an Edit action');
incompleteStrip.messages=[user(10),reply(10,[{index:0,status:'ready',entries:[{kcal:'Infinity'}]}])];incompleteStrip.visibleClients=new Set(['c10']);c.primary(incompleteStrip);
assert.equal(nodes['#thread-review-sum'].textContent,'1 food · Incomplete','non-finite calories also stay incomplete');assert.equal(nodes['#thread-review-add'].disabled,true);
console.log('review strip unknown calories: incomplete summary, disabled one-tap Add, accessible details direction and non-finite guard PASS');

// A missing barcode stays readable and offers only actions that make sense before a food exists.
vm.runInContext(source.slice(source.indexOf('  function missingBarcodeActions('),source.indexOf('  function replyHtml(')),c);
const barcodeRoot={id:8,state:'answered',body:'Scanned product 016000157620',media:'barcode',result:{review_only:true,input:{kind:'barcode'}}};
const notFoundReply={entries:[],result:{kind:'needs',error:{message:"We couldn't find this barcode."},parts:[{index:0,status:'unknown',entries:[]}]}};
const notFoundHtml=c.replyHtml(barcodeRoot,notFoundReply);
assert.match(notFoundHtml,/We couldn't find this barcode\./);assert(!notFoundHtml.includes('Not found in the food database'));
assert.match(notFoundHtml,/thread-barcode-not-found/);assert(!notFoundHtml.includes('thread-error'));assert(!notFoundHtml.includes('small muted'));
assert.match(notFoundHtml,/data-manual="0"/);assert.match(notFoundHtml,/data-action="resolve"[^>]*>Try again/);assert(!notFoundHtml.includes('Change amount'));
assert.match(notFoundHtml,/barcode-choice-row/);assert.match(notFoundHtml,/class="linkbtn" data-manual="0">Enter nutrition/);assert.match(notFoundHtml,/data-unlogged-remove/);assert(!notFoundHtml.includes('data-more '),'an unlogged barcode card uses remove instead of the overflow menu');
assert.equal(c.foodMessageBody(barcodeRoot),'Scanned a barcode','older saved barcode entries no longer expose their digits');
const legacyNotFound=c.replyHtml(barcodeRoot,{...notFoundReply,result:{...notFoundReply.result,error:{message:'Not found in the food database'}}});
assert.match(legacyNotFound,/thread-barcode-not-found/);assert.match(legacyNotFound,/We couldn't find this barcode\./);assert(!legacyNotFound.includes('Not found in the food database'));
const oldCancelled=c.replyHtml({id:9,state:'cancelled',result:{review_only:true}},{entries:[],body:'Cancelled this food message.',result:{kind:'needs',cancelled:true,parts:[]}});
assert.match(oldCancelled,/This food was removed before it was logged\./);assert(!oldCancelled.includes('message'));
const oldPartialCancel=c.replyHtml({id:10,state:'cancelled',result:{review_only:true}},{entries:[],body:'Stopped checking the remaining food. Already logged food is kept; use Undo to remove it.',result:{kind:'needs',cancelled:true,parts:[]}});
assert.match(oldPartialCancel,/The remaining food wasn’t checked\. Logged food stays in your log\./);assert(!oldPartialCancel.includes('Undo'));
c.aiCan=()=>true;let actions=c.missingBarcodeActions(0);assert.match(actions,/class="primary wide" data-estimate="0">Estimate with Kit/);assert.match(actions,/class="linkbtn" data-manual="0">Enter nutrition/);assert.match(actions,/barcode-choice-row[\s\S]*Try again[\s\S]*data-more/);
c.aiCan=()=>false;c.aiOffer=()=>true;actions=c.missingBarcodeActions(0);assert.match(actions,/data-kit-on="0">Turn on Kit to estimate/);
c.aiOffer=()=>false;actions=c.missingBarcodeActions(0);assert(!/data-estimate|data-kit-on/.test(actions));assert.match(actions,/class="primary wide" data-manual="0">Enter nutrition/);assert.match(actions,/barcode-choice-row[\s\S]*Try again[\s\S]*data-more/);
const scan=c.barcodeChatInput('016000157620');assert.equal(scan.body,'Scanned a barcode');assert.equal(scan.media,'barcode');assert.equal(scan.barcode,'016000157620');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[],result:{parts:[]}}).title,'Food details');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[{name:'Fictional oats'}]}).title,'Fictional oats');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[]}).change,'Change it');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[]}).remove,'Remove from chat');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[]}).note,'This removes the food details from this chat.');
assert.equal(c.foodActionCopy(barcodeRoot,{entries:[{name:'Fictional oats'}]}).note,'Food already in your log stays.','only logged food gets the reassurance note');
const found=c.replyHtml(barcodeRoot,{entries:[],result:{kind:'preview',parts:[{index:0,status:'ready',entries:[{name:'Fictional oats',amount:1,unit:'serving',kcal:220}]}]}});
assert.match(found,/Fictional oats/,'a recognized barcode still shows its product name');
console.log('barcode card: normal not-found copy, consent-aware primary action, manual/retry recovery, generic scan label and food-named menu PASS');

vm.runInContext(source.slice(source.indexOf('  function pendingHtml('),source.indexOf('  function wirePending(')),c);
c.navigator={onLine:false};let pending=c.pendingHtml({phase:'process',body:'Fictional tacos'});
assert.match(pending,/Your food is waiting to send when you’re back online/);assert(!pending.includes('message'));
console.log('food chat pending status uses food language and avoids internal message wording PASS');

// Loading the optional review leaf keeps the existing draft and busy gate intact.
vm.runInContext(source.slice(source.indexOf('  async function review(ctx,'),source.indexOf('  async function stage(')),c);
Object.assign(c,{status:(_ctx,message)=>reviewStatuses.push(message),saveDraft:()=>{},saveReviewDraft:()=>{},toast:()=>{},undoLogged:()=>{}});
let reviewStatuses=[],reviewOpens=0,reviewActive=true;
c.active=()=>reviewActive;
c.FoodReview={busy:()=>false,open:async()=>{reviewOpens++;}};
const reviewCtx=()=>({draftId:'review-draft',meal:'lunch',day:'2026-11-11',session:'review-session',jobs:[],reviewForm:{note:'keep this'},visibleClients:new Set(['review-client']),messages:[
 {id:51,kind:'user',client_id:'review-client',result:{review_only:true,draft_id:'review-draft'}},
 {id:52,kind:'reply',reply_to:51,result:{kind:'preview',parts:[{index:0,status:'ready',entries:[{name:'Fictional meal',kcal:200}]}]}}
]});
(async()=>{
 const failed=reviewCtx(),staged=failed.messages,form=failed.reviewForm;let loadAttempts=0;
 c.loadClassicScript=async()=>{if(++loadAttempts===1)throw Error('offline');};
 await c.review(failed,{allowUnsent:true});
 assert.equal(reviewOpens,0,'a failed leaf load does not open review');assert.equal(failed.messages,staged,'a failed leaf load preserves staged foods');assert.equal(failed.reviewForm,form,'a failed leaf load preserves the review draft');assert.equal(failed.preparingReview,false);assert.match(reviewStatuses.at(-1),/could not load/i);
 await c.review(failed,{allowUnsent:true});
 assert.equal(loadAttempts,2,'a failed memoized load can be retried');assert.equal(reviewOpens,1,'retry opens review once');

 let finishLoad;const deferred=new Promise(resolve=>{finishLoad=resolve;});
 c.loadClassicScript=()=>deferred;reviewActive=true;reviewOpens=0;reviewStatuses=[];
 const duplicate=reviewCtx(),first=c.review(duplicate,{allowUnsent:true});
 assert.equal(duplicate.preparingReview,true,'the review strip remains busy while the leaf loads');
 await c.review(duplicate,{allowUnsent:true});assert.equal(reviewOpens,0,'a second activation cannot bypass the in-flight leaf load');
 c.FoodReview.busy=()=>true;finishLoad();await first;
 assert.equal(reviewOpens,0,'a confirmation becoming busy during load still blocks duplicate review');assert.match(reviewStatuses.at(-1),/Finish the food details/);

 let finishStale;const staleLoad=new Promise(resolve=>{finishStale=resolve;});
 c.loadClassicScript=()=>staleLoad;c.FoodReview.busy=()=>false;reviewActive=true;
 const stale=reviewCtx(),staleMessages=stale.messages,staleForm=stale.reviewForm,waiting=c.review(stale,{allowUnsent:true});
 reviewActive=false;finishStale();await waiting;
 assert.equal(reviewOpens,0,'owner/path becoming inactive during load cannot open review');assert.equal(stale.messages,staleMessages,'stale completion leaves staged foods untouched');assert.equal(stale.reviewForm,staleForm,'stale completion leaves the saved review draft untouched');assert.equal(stale.preparingReview,false);
 console.log('lazy Food review: retryable load failure, duplicate activation/confirm gate, stale owner/path and staged draft preservation PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

// The optional own-food suggestion leaf is loaded only for a qualifying draft,
// and a completed load may initialize only the still-current composer.
const reuseStart=source.indexOf('function foodThreadReuseLoader('),reuseEnd=source.indexOf('\n\nconst FoodThread',reuseStart);
const reuseContext={String,Promise,loadClassicScript:async()=>{},location:{pathname:'/food/describe'}};
vm.createContext(reuseContext);vm.runInContext(source.slice(reuseStart,reuseEnd),reuseContext);
const fakeField=value=>({value,isConnected:true,listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},removeEventListener(k){delete this.listeners[k];}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let attempts=0,created=0,active=true,path='/food/describe';
 const ctx={owner:'owner-1',session:'session-1',el:{isConnected:true}};
 const field=fakeField('');let release;
 const slow=new Promise(resolve=>{release=resolve;});
 const loader=reuseContext.foodThreadReuseLoader({ctx,field,active:()=>active,create:()=>{created++;return{refresh(){},clear(){},dispose(){}};},load:async()=>{attempts++;return slow;},path:()=>path});
 assert.equal(attempts,0,'an empty composer does not load suggestions');
 field.value='a';field.listeners.input();assert.equal(attempts,0,'one character does not load suggestions');
 field.value='oats';field.listeners.input();const waiting=loader.refresh();assert.equal(attempts,1,'typed qualifying text starts one shared load');
 field.value='pear';release();await waiting;await tick();assert.equal(created,1,'a restored/current qualifying composer initializes once');assert.equal(field.value,'pear','the latest composer text is retained');
 await loader.refresh();assert.equal(created,1,'refresh reuses the context initializer');loader.dispose();

 const restored=fakeField('Fictional restored oats');let restoredCreated=0;
 const restoredLoader=reuseContext.foodThreadReuseLoader({ctx:{owner:'o',session:'s',el:{isConnected:true}},field:restored,active:()=>true,create:()=>{restoredCreated++;return{refresh(){},clear(){},dispose(){}};},load:async()=>{}});
 await tick();assert.equal(restoredCreated,1,'a qualifying saved draft loads suggestions on restore');restoredLoader.dispose();

 let retryAttempts=0,retryCreated=0;const retryField=fakeField('oats');
 const retryLoader=reuseContext.foodThreadReuseLoader({ctx:{owner:'o',session:'s',el:{isConnected:true}},field:retryField,active:()=>true,create:()=>{retryCreated++;return{refresh(){},clear(){},dispose(){}};},load:async()=>{if(++retryAttempts===1)throw Error('offline');}});
 await tick();assert.equal(retryCreated,0,'a failed optional load leaves composer without suggestions');await retryLoader.refresh();assert.equal(retryAttempts,2,'the failed memoized load can be retried');assert.equal(retryCreated,1);retryLoader.dispose();

 for(const stale of ['owner','session','path','disconnected']){
  let done;const deferred=new Promise(resolve=>{done=resolve;}),staleCtx={owner:'o',session:'s',el:{isConnected:true}},staleField=fakeField('oats');let staleCreated=0,staleActive=true,stalePath='/food/describe';
  const staleLoader=reuseContext.foodThreadReuseLoader({ctx:staleCtx,field:staleField,active:()=>staleActive,create:()=>{staleCreated++;return{refresh(){},clear(){},dispose(){}};},load:()=>deferred,path:()=>stalePath});
  await tick();if(stale==='owner')staleCtx.owner='other';if(stale==='session')staleCtx.session='other';if(stale==='path')stalePath='/me';if(stale==='disconnected')staleField.isConnected=false;
  done();await tick();assert.equal(staleCreated,0,`${stale} context cannot initialize after load`);staleLoader.dispose();
 }
 console.log('lazy Food reuse: empty/short gate, typed/restored draft, shared initializer, retry and stale owner/session/path/DOM guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
