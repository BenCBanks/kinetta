'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync('app/static/kit.js','utf8');
const c={route(){},KitChat:{loaded:false},IC:{},URLSearchParams,App:{me:{id:7}},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid'},localStorage:{removeItem(){}},Map,Set};vm.createContext(c);vm.runInContext(source+'\nglobalThis.Kit=KitChat;',c);
for(const [input,expected] of [
 ['Would you like to review your recent workouts?','Review my recent workouts'],
 ['Would you like to review your latest completed workouts from this training block and compare how they fit your plan?','Compare my workouts'],
 ['Would you like to review your latest completed workouts from this training block and compare how they fit my plan?','Compare my workouts'],
 ['Do you want to log meals for today?','Log meals for today'],
 ['Should we set up a training plan?','Set up a training plan'],
 ['Would you like to compare your recent strength sessions with your earlier workouts?','Compare my recent strength sessions with my earlier workouts'],
 ['Shall we compare your 5 km run with Ben?','Compare my 5 km run with Ben'],
 ['Can we track your pace for yourself?','Track my pace for myself'],
 ['Want to check whether you can use Garmin?','Check whether I can use Garmin'],
 ['Are your legs feeling heavy or fatigued today?','My legs feel heavy today'],
 ['Do you feel ready to train again?',null],
 ['How do your legs feel after yesterday?',null],
 ['What should I focus on next week?','What should I focus on next week?'],
 ['Would you like to better training?','Would you like to better training?'],
 ['Would you like to review your recent workouts.','Would you like to review your recent workouts.'],
 ['Would you like to?','Would you like to?'],
])assert.equal(c.Kit.rewriteFollowup(input),expected,`screen-side follow-up rewrite: ${input}`);
assert(source.includes('filter(q=>workoutMode||isFirstPersonFollowup(q))')&&source.includes('class="kit-suggested-reply" data-kit-followup')&&source.includes('send(c,b.querySelector(\'span\')?.textContent.trim()||\'\')'),'normal Kit suggestions require first-person wording; app-chosen workout prompts use the reviewed whitelist');
assert(source.includes('function pruneLongSuggestions(root)')&&source.includes('if(new Set(lines).size>2)button.remove()'),'suggestions over two rendered lines are dropped without truncation');
assert.equal(c.IC.send,'<path d="M12 19V5M6 11l6-6 6 6"/>','Kit Send uses an up arrow, not the fallback clock');assert(c.IC.chat.includes('M4 5.5'),'Kit diet suggestion uses a chat icon');assert(source.includes("nutrition:['food','pot','chat']"),'Talk about my diet has the chat icon');
assert.deepEqual(JSON.parse(JSON.stringify(c.Kit.starters.nutrition)),['Look at my food today','What could I eat next?','Talk about my diet'],'Kit suggestions keep the approved order and copy');
assert.deepEqual(JSON.parse(JSON.stringify(c.Kit.starters.progress)),['Am I improving?','Look at my consistency','Choose a focus','Review my week'],'the weekly review is an explicit fourth Progress question');
assert(source.indexOf('id="kit-starters"')<source.indexOf('class="thread-compose-row kit-compose-row"'),'Kit suggestions are directly above the composer');
assert(source.includes("$('#kit-starters',c.el).hidden=!!has"),'Kit suggestions disappear after the first message');
assert(source.includes("el.classList.toggle('has-draft',drafted)")&&source.includes("$('#kit-starters',el).inert=drafted"),'Kit suggestions fade and stop taking taps while a draft is non-empty');
assert.equal(c.Kit.href('nutrition'),'/me/kit?from=nutrition');assert.equal(c.Kit.href('activity',42),'/me/kit?from=activity&activity=42');assert.equal(c.Kit.href('javascript:bad'),'/me/kit?from=me');
for(const [name,group] of Object.entries(c.Kit.starters))assert.equal(group.length,name==='progress'?4:3);
for(const [,path] of Object.values(c.Kit.actions))assert(path.startsWith('/')&&!path.startsWith('//'));
assert.equal(c.Kit.foodIntent('Can you log my food')?.kind,'prompt','a food-log request without details asks a follow-up');
assert.equal(c.Kit.foodIntent('Can you log my food?')?.kind,'prompt','a question mark does not hide a bare log request');
assert.equal(c.Kit.foodIntent('Can you log my food: 2 eggs and toast')?.body,'2 eggs and toast','food commands strip the command before forwarding');
assert.equal(c.Kit.foodIntent('2 eggs and toast')?.kind,'food','plain food descriptions route to the food thread');
assert.equal(c.Kit.foodIntent('two hot dogs and a Diet Coke')?.kind,'food','food descriptions with multiple items route to the food thread');
assert.equal(c.Kit.foodIntent('same as yesterday’s lunch')?.kind,'food','food-thread references route to the existing engine');
assert.equal(c.Kit.foodIntent('What did I eat today?'),null,'questions about logged food stay with Kit');
assert.equal(c.Kit.foodIntent('Can you record my bike ride?'),null,'activity requests stay with Kit');
assert.equal(c.Kit.foodIntent('2 eggs and toast',true)?.kind,'food','the follow-up accepts a food description');
assert.equal(c.Kit.foodIntent('How many calories was breakfast?',true),null,'a follow-up question stays in Kit');
const accountKeys=[];c.localStorage.removeItem=k=>accountKeys.push(k);c.Kit.eraseDevice();assert.equal(accountKeys.length,3);assert(accountKeys.some(k=>k.startsWith('fit.kit.visit:')),'device erasure also drops the locally retained visit identifier');assert(accountKeys.every(k=>k.endsWith('["https://fictional.invalid",7]')));
const pick=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
{
 const blocks={};vm.createContext(blocks);
 vm.runInContext(pick('  function answerBlocks(a){','  function copyIncludesValue(')+'\nglobalThis.blocks=answerBlocks;globalThis.copy=answerCopy;',blocks);
 const answer={answer_blocks:[{kind:'paragraph',text:'Your logged runs covered 12 km.'},{kind:'list',items:['Keep your next run easy.','Leave room for rest.']}],interpretation:'Legacy flattened copy',reason:'Legacy reason'};
 assert.equal(blocks.copy(answer),'Your logged runs covered 12 km. Keep your next run easy. Leave room for rest.','duplicate-fact checks use only the visible blocks');
 assert.equal(blocks.blocks(answer),answer.answer_blocks,'server-formatted values/labels pass through unchanged');
 for(const invalid of [undefined,null,[],{},[{kind:'chart',text:'No chart'}],[{kind:'paragraph',text:' '}],[{kind:'paragraph',text:3}],[{kind:'list',items:[]}],[{kind:'list',items:['ok',null]}],[{kind:'paragraph',text:'ok'},null]]){
  const old={answer_blocks:invalid,interpretation:'Saved answer'};
  assert.equal(blocks.blocks(old),null,'an absent or malformed block array uses the entire legacy fallback');
  assert.equal(blocks.copy(old),'Saved answer');
 }
 for(const invalid of [Array.from({length:11},()=>({kind:'paragraph',text:'x'})),[{kind:'paragraph',text:'x'.repeat(1601)}],[{kind:'list',items:Array(7).fill('x')}],[{kind:'list',items:['x'.repeat(601)]}]])assert.equal(blocks.blocks({answer_blocks:invalid}),null,'out-of-contract bounds fall back without truncation');
 for(const valid of [[{kind:'paragraph',text:'🙂'.repeat(1600)}],[{kind:'list',items:Array(6).fill('x'.repeat(600))}],Array.from({length:10},()=>({kind:'paragraph',text:'x'}))])assert.equal(blocks.blocks({answer_blocks:valid}),valid,'exact bounds and Unicode follow the checked Python contract');
 for(const mode of ['weekly_review','workout_review'])assert.equal(blocks.blocks({...answer,[mode]:{}}),null,mode+' keeps its dedicated renderer');
}
assert(source.includes("send(c,label,index)")&&source.includes("button.querySelector('span')?.textContent"),'a starter sends its visible button label separately from its hidden guidance index');
assert(source.includes('<p>${esc(m.question)}</p>'),'the user bubble renders the stored question verbatim');
assert(source.includes('filter(q=>workoutMode||isFirstPersonFollowup(q))')&&source.includes('class="kit-suggested-reply" data-kit-followup'),'Kit keeps ordinary first-person checks and presents app-chosen workout follow-ups');
assert(source.includes("send(c,b.querySelector('span')?.textContent.trim()||'')"),'a follow-up chip asks Kit exactly the visible question');
assert(!source.includes('a.limitations?.length'),'Kit no longer renders a generic limitations dump');
assert(source.includes('if(f.display_value!=null)return String(f.display_value)'),'Kit preserves server-formatted unit-aware values');
assert(source.includes('a.weekly_review.what_went_well')&&source.includes('a.weekly_review.what_to_change')&&source.includes('a.weekly_review.next_week_focus'),'weekly review renders its three named sections');
assert(source.includes('a?.workout_review?.verdict')&&source.includes('a?.workout_review?.next_step'),'workout review renders its nested, separately validated answer contract');
assert(source.includes('a.weekly_period?.label'),'weekly review shows the app-owned completed date range once');
assert(source.includes('Review my week'),'weekly review is only a visible tap-to-start suggestion');
assert(fs.readFileSync('app/static/style.css','utf8').includes('.kit-answer .kit-verdict')&&fs.readFileSync('app/static/style.css','utf8').includes('font-weight:700'),'weekly review verdict uses the same bold lead treatment as ordinary Kit answers');
{const starterHandler={sendArgs:null};starterHandler.send=(...args)=>starterHandler.sendArgs=args;vm.createContext(starterHandler);vm.runInContext(pick('  function sendStarter(c,button){','  async function send(c,text,starterIndex=null){')+'\nglobalThis.sendStarter=sendStarter;',starterHandler);const button={dataset:{kitStart:'0'},querySelector(selector){assert.equal(selector,'span');return {textContent:'Am I improving?'};}};const chat={context:{screen:'progress'}};starterHandler.sendStarter(chat,button);assert.equal(starterHandler.sendArgs[0],chat,'starter dispatch receives the chat context');assert.deepEqual(starterHandler.sendArgs.slice(1),['Am I improving?',0],'a tapped starter preserves exactly its visible label and sends guidance index separately');}
// Shared entries need consent, access, a reviewed release and an unpaused service.
{const app=fs.readFileSync('app/static/app.js','utf8'),gate=app.slice(app.indexOf('function aiCan('),app.indexOf('// Calls render(data)'));
 const g={App:{me:{ai_ok:true,coach:true,ai_access:{coach:{available:true,entitled:true}}}}};vm.createContext(g);vm.runInContext(gate,g);
 assert.equal(g.kitChatOn(),false,'no Kit chat until the server reports kit_chat');g.App.me.kit_chat=true;assert.equal(g.kitChatOn(),true);g.App.me.ai_paused=true;assert.equal(g.aiCan('coach'),true,'configured access is independent from a service pause');assert.equal(g.kitChatOn(),false,'paused chat has no entrance');g.App.me.ai_paused=false;g.App.me.ai_access.coach.entitled=false;assert.equal(g.kitChatOn(),false,'age/access denial hides chat');g.App.me.ai_access.coach.entitled=true;g.App.me.ai_ok=false;assert.equal(g.kitChatOn(),false,'consent off hides Kit chat');}
async function testEntryVisibility(){
 const entryHarness={URLSearchParams,App:{me:{id:7},cache:new Map()},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid',pathname:'/me',search:''},tabEntryUsers:new Set(),activityEntryUsers:new Map(),activityEntryRequests:new Map(),kitChatOn:()=>false,owner:()=>JSON.stringify([entryHarness.Native.base,entryHarness.App.me.id]),href:s=>'/me/kit?from='+s,svg:()=>'<svg></svg>',kept:()=>null,activityRows:[],apiCalls:[],readOnce:async p=>{entryHarness.apiCalls.push(p);return entryHarness.activityRows;},syncKitEntry(_root,_slot,href,label){if(!link)link=entryHarness.document.createElement('a');link.href=href;link.setAttribute('data-kit-entry','');link.setAttribute('aria-label',label);link.innerHTML='<span class="kit-entry-word">Kit</span><svg></svg>';return link;},document:null};
 let link=null,made=0;const heading={classList:{contains:()=>false},querySelector:()=>null,append:n=>{link=n;}};
 const page={isConnected:true,querySelector:s=>s==='.top,.me-top'?heading:s==='[data-kit-entry]'?link:null};entryHarness.document={createElement(){made++;return {setAttribute(k,v){this[k]=v;},remove(){link=null;}};},querySelector:s=>s==='#page'?page:null};
 vm.createContext(entryHarness);
 const relevant=source.slice(source.indexOf('  function entryRelevant('),source.indexOf('  function checkActivityEntry(')).replace('function entryRelevant','globalThis.entryRelevant=function entryRelevant');
 const check=source.slice(source.indexOf('  function checkActivityEntry('),source.indexOf('  const active=' )).replace('function checkActivityEntry','globalThis.checkActivityEntry=function checkActivityEntry');
 const entry=source.slice(source.indexOf('  function entry(el,path){'),source.indexOf('  return {loaded:true,mount,')).replace('function entry','globalThis.entry=function entry');
 vm.runInContext(relevant+'\n'+check+'\n'+entry,entryHarness);
 await entryHarness.entry(page,'/me');assert.equal(link,null,'a person with no Kit, food or activity use sees no icon');assert(entryHarness.apiCalls.includes('/api/activities?limit=1'),'activity relevance is checked with the current user’s own activity list');
 entryHarness.App.me={id:8,food_user:true};await entryHarness.entry(page,'/me');assert.equal(link.href,'/food?add=1');assert.equal(link['aria-label'],'Kit, Add food','a food user sees the icon while AI is off and opens Add food');
 link=null;entryHarness.App.me={id:9};entryHarness.activityRows=[{id:1}];await entryHarness.entry(page,'/me');assert.equal(link.href,'/food?add=1','a person with activity history sees the icon across tabs while AI is off');
 // Browser UI covers the shared rightmost slot; this unit harness checks the single component's destinations and labels.
 for(const path of ['/me','/track','/progress','/food','/plan']){entryHarness.location.pathname=path;const before=made;await entryHarness.entry(page,path);assert.equal(made,before,path+' keeps one icon for the active food/activity user');assert.equal(link.href,'/food?add=1');}
 entryHarness.App.me={id:10};entryHarness.kitChatOn=()=>true;link=null;entryHarness.location.pathname='/me';await entryHarness.entry(page,'/me');assert.equal(link.href,'/me/kit?from=me','Kit-enabled people see the entry without food/activity history');assert.equal(link['aria-label'],'Ask Kit');
 entryHarness.App.me={id:11};entryHarness.kitChatOn=()=>false;link=null;entryHarness.location.pathname='/track';await entryHarness.entry(page,'/track');assert.equal(link.href,'/food?add=1','using an activity tab makes the entry relevant');
 entryHarness.App.me={id:12};entryHarness.activityRows=[];entryHarness.location.pathname='/me';link=null;await entryHarness.entry(page,'/me');assert.equal(link,null,'an unrelated user remains without a tab-root icon');
 for(const path of ['/me/settings','/me/sharing','/me/devices','/track/import','/food/import','/track/connections','/me/explore','/me/people','/me/speed']){link=null;const before=made;await entryHarness.entry(page,path);assert.equal(made,before,path+' has no general chat entrance');}
 for(const [file,needle] of [['app/static/pages.js',"kitChatOn() ? go(KitChat.href('activity'"],['app/static/thread.js',"!kitChatOn()||!(r.offer_kit"]])assert(fs.readFileSync(file,'utf8').includes(needle),file+' gates its Kit chat entry');
}
async function testFoodThreadBridge(){
 let host,submitted='',pageCalls=0,prepareFails=true,heldPrepare=null,owner='fixture';const events=[],field={value:'',style:{},dispatchEvent(){}},notice={textContent:''};
 const form={requestSubmit(){submitted=field.value;field.value='';}},slot={append(el){host=el;el.isConnected=true;}};
 const foodHost={isConnected:false,setAttribute(){},remove(){this.isConnected=false;}};
 const bridge={pageCalls:0,FoodThread:{async prepare(){events.push('prepare');if(heldPrepare)await heldPrepare;if(prepareFails)throw Error('Nutrition unavailable');},async page(el,options){bridge.pageCalls++;events.push('page');bridge.pageHost=el;bridge.pageOptions=options;}},document:{createElement(tag){assert.equal(tag,'section');return foodHost;}},Event:class{},$(selector){return {'#kit-food-slot':slot,'#thread-text':field,'#thread-composer':form,'#thread-status':notice}[selector];},draw(){events.push('draw');},active:c=>c.owner===owner,status(){}};
 vm.createContext(bridge);
 vm.runInContext(pick('  async function mountFoodThread(c){','  function clearDraft(')+'\n'+pick('  async function sendFood(c,text){','  async function refresh('),bridge);
 const ctx={el:{},owner:'fixture'};await assert.rejects(bridge.sendFood(ctx,'2 eggs'),/Nutrition unavailable/);assert.equal(bridge.pageCalls,0,'Kit does not render the inline thread before Nutrition prepares');assert.deepEqual(events,['prepare'],'a failed leaf load leaves Kit at its existing retry point');
 prepareFails=false;events.length=0;const result=await bridge.sendFood(ctx,'2 eggs');
 assert.equal(result,true,'the Kit food route submits through the inline FoodThread composer');assert.equal(bridge.pageCalls,1,'the existing FoodThread.page export owns the inline engine');assert.equal(bridge.pageHost,host);assert.equal(JSON.stringify(bridge.pageOptions),'{}');assert.equal(submitted,'2 eggs','the text reaches the existing FoodThread composer');
 assert.equal(events[0],'prepare');assert(events.indexOf('draw')>events.indexOf('prepare'),'Kit waits for the same Nutrition boundary before rendering its food slot');assert(events.indexOf('page')>events.indexOf('prepare'));
 foodHost.isConnected=false;submitted='';events.length=0;const previousPages=bridge.pageCalls;let release;heldPrepare=new Promise(resolve=>release=resolve);const stale={el:{},owner:'fixture'};const pending=bridge.sendFood(stale,'2 eggs');await Promise.resolve();owner='another-owner';release();assert.equal(await pending,false,'a stale Kit context abandons its pending Food open');assert.equal(bridge.pageCalls,previousPages,'a changed owner never mounts the inline FoodThread page');assert.equal(submitted,'','a changed owner never submits through the inline composer');assert.deepEqual(events,['prepare'],'the stale deferred completion causes no Food render');
}
(async()=>{
 await testEntryVisibility();
 await testFoodThreadBridge();
 let saved,delivered=0,status='',field={value:'My unsent question'};
 const sender={starters:c.Kit.starters,active:()=>true,kitChatOn:()=>true,foodIntent:()=>null,clearDraft(){},$ :()=>field,newId:()=> 'stable-uuid',save:(ctx,k,v)=>{saved=v},deliver:async()=>delivered++,status:(ctx,v)=>status=v};vm.createContext(sender);vm.runInContext(pick('  async function send(c,text,starterIndex=null){','  async function mount(el){')+'\nglobalThis.send=send;',sender);
 const ctx={loaded:true,ready:true,sending:false,generation:'generation-a',context:{screen:'nutrition'}};await sender.send(ctx);assert.equal(saved.question,'My unsent question');assert.equal(saved.client_id,'stable-uuid');assert.equal(saved.generation,'generation-a');assert.equal(delivered,1);await sender.send(ctx);assert.equal(delivered,1,'current-visit durable question is retried, never duplicated');
 ctx.job=null;await sender.send(ctx,'Am I improving?',0);assert.equal(saved.question,'Am I improving?','the exact visible starter question becomes the stored user bubble');assert.equal(saved.context.starter_index,0,'the starter guidance travels in a separate context field');
 ctx.context.starter_index=0; ctx.job=null;field.value='How did my running change this month?';await sender.send(ctx);assert.equal(saved.question,'How did my running change this month?','typed text replaces neither itself nor an earlier starter');assert.equal(Object.hasOwn(saved.context,'starter_index'),false,'typed messages do not inherit starter guidance');
 field.value='My unsent question';const sentBeforeUnavailable=delivered;ctx.job=null;sender.kitChatOn=()=>false;await sender.send(ctx);assert.equal(delivered,sentBeforeUnavailable,'availability loss cannot send a model request');assert.equal(field.value,'My unsent question','unavailable chat keeps its draft');sender.kitChatOn=()=>true;
 ctx.job=null;sender.save=()=>{throw Error('quota')};await sender.send(ctx);assert.equal(field.value,'My unsent question');assert.equal(delivered,sentBeforeUnavailable);assert(status.includes('could not save'));
 ctx.job=null;ctx.ready=false;await sender.send(ctx);assert.equal(delivered,sentBeforeUnavailable);assert.equal(field.value,'My unsent question');assert(status.includes('isn’t available'));
 let promptDeliveries=0;const foodBodies=[],promptField={value:'Can you log my food',style:{}};
 const foodRouter={starters:c.Kit.starters,active:()=>true,kitChatOn:()=>true,foodIntent:(text,awaiting)=>c.Kit.foodIntent(text,awaiting),clearDraft(_c,f,submitted){if(f.value.trim()===submitted.trim())f.value='';return true;},$ :()=>promptField,draw(){},controls(){},status(){},sendFood:async(_c,body)=>{foodBodies.push(body);return true;},newId:()=> 'activity-question',save(){},deliver:async()=>promptDeliveries++};
 vm.createContext(foodRouter);vm.runInContext(pick('  async function send(c,text,starterIndex=null){','  async function mount(el){')+'\nglobalThis.send=send;',foodRouter);
 const foodContext={loaded:true,ready:true,sending:false,generation:'g',context:{screen:'activity'}};await foodRouter.send(foodContext);
 assert.equal(foodContext.localMessages[0].answer.interpretation,'What did you have?','a bare food-log request gets the short food follow-up');assert.equal(foodBodies.length,0);assert.equal(promptDeliveries,0,'the follow-up does not call the model or old food-logger answer');
 promptField.value='2 eggs and toast';await foodRouter.send(foodContext);assert.deepEqual(foodBodies,['2 eggs and toast'],'the follow-up sends the food description to FoodThread');assert.equal(foodContext.awaitingFood,false);
 promptField.value='How has my running changed this month?';await foodRouter.send(foodContext);assert.equal(promptDeliveries,1,'an activity question from any tab stays in Kit');
 // A server-accepted message after a lost acknowledgement reconciles the durable local send.
 const removed=[];field={value:'Accepted earlier',style:{}};
 const loader={VISIT_MAX_AGE:24*60*60*1000,kitChatOn:()=>true,aiCan:()=>true,App:{me:{ai_ok:true}},api:async()=>({generation:'generation-a',messages:[{id:1,client_id:'accepted',question:'Accepted earlier',state:'answered'}],ready:true,before:null}),active:()=>true,$:()=>field,store:{del:k=>removed.push(k)},key:(o,k)=>k,draw(){},status(){},Map,answer(){throw Error('Answered messages cannot call the model again')},later(){}};
 vm.createContext(loader);vm.runInContext(pick('  async function refresh(c,before=null,','  const later='),loader);
 const resumed={generation:'generation-a',owner:'one',messages:[],job:{client_id:'accepted',question:'Accepted earlier',generation:'generation-a'}};
 await loader.refresh(resumed);assert.equal(resumed.job,null);assert.equal(field.value,'');assert(removed.includes('pending')&&removed.includes('draft'));
 // Reorder the actual answer handler across Clear and account changes.
 let finish,draws=0,active=true,refreshes=0;
 const answerer={clearTimeout(){},kitChatOn:()=>true,active:()=>active,controls(){},api:()=>new Promise(resolve=>finish=resolve),json:(m,b)=>b,draw:()=>draws++,later(){},refresh:async()=>refreshes++,status(){}};vm.createContext(answerer);vm.runInContext(pick('  async function answer(c,id){','  async function deliver(c){'),answerer);
 const chat={ready:true,generation:'old',messages:[{client_id:'same',state:'pending'}],sending:false};const task=answerer.answer(chat,'same');chat.generation='new';chat.messages=[];chat.sending=false;finish({client_id:'same',state:'answered',answer:{interpretation:'late'}});await task;assert.equal(chat.messages.length,0);assert.equal(draws,0);assert.equal(chat.sending,false);assert.equal(refreshes,0,'a cleared result cannot refresh over the new chat');
 chat.generation='current';chat.visit_id='first-visit';chat.messages=[{client_id:'same',state:'pending'}];const ended=answerer.answer(chat,'same');chat.visit_id='next-visit';chat.messages=[];finish({client_id:'same',state:'answered'});await ended;assert.equal(draws,0,'a late answer from an ended visit cannot enter a fresh visit');
 chat.generation='current';chat.messages=[{client_id:'same',state:'pending'}];const next=answerer.answer(chat,'same');active=false;finish({client_id:'same',state:'answered'});await next;assert.equal(chat.messages[0].state,'pending');assert.equal(draws,0,'another session never renders the old answer');
 let forbidden=0;answerer.api=()=>{forbidden++;throw Error('Unavailable model request')};answerer.kitChatOn=()=>false;active=true;await answerer.answer(chat,'same');assert.equal(forbidden,0,'unavailable retries never request an answer');
 const delivery={...answerer};vm.createContext(delivery);vm.runInContext(pick('  async function deliver(c){','  function sendStarter(c,button){'),delivery);await delivery.deliver({...chat,job:{question:'Kept'}});assert.equal(forbidden,0,'unavailable retry sending never requests a message');
 // Reload restores the serialized pending payload; network retries must preserve its exact question and context.
 for(const context of [{screen:'progress',starter_index:0},{screen:'progress'}]){
  const question=Object.hasOwn(context,'starter_index')?'Am I improving?':'How did my running change this month?';
  const pending={client_id:'saved-id',generation:'g',visit_id:'v',question,context},requests=[];
  const retry={active:()=>true,kitChatOn:()=>true,draw(){},controls(){},status(){},clearWait(){},key:()=>'',store:{del(){}},$:()=>({value:'A different unsent draft',style:{}}),json:(_method,body)=>JSON.parse(JSON.stringify(body)),answer:async()=>{},api:async(_url,body)=>{requests.push(body);if(requests.length===1)throw Error('offline');return {...body,id:1};}};
  vm.createContext(retry);vm.runInContext(pick('  async function deliver(c){','  function sendStarter(c,button){'),retry);
  const restored={job:JSON.parse(JSON.stringify(pending)),ready:true,generation:'g',visit_id:'v',messages:[],view:{pin(){}}};
  await retry.deliver(restored);assert.deepEqual(JSON.parse(JSON.stringify(restored.job)),pending,'failed send retains the saved payload');
  await retry.deliver(restored);assert.deepEqual(requests,[pending,pending],'reload and retry never replace the typed/tapped question with guidance or draft text');
 }
 let auto=0;loader.kitChatOn=()=>false;loader.api=async()=>({generation:'generation-a',messages:[{id:1,client_id:'pending',state:'pending'}],ready:true,before:null});loader.answer=()=>auto++;await loader.refresh({...resumed,job:null});assert.equal(auto,0,'pause cannot auto-answer an existing pending message');loader.kitChatOn=()=>true;loader.api=async()=>({generation:'generation-a',messages:[{id:1,client_id:'pending',state:'pending'}],ready:false,before:null});await loader.refresh({...resumed,job:null});assert.equal(auto,0,'unreviewed chat cannot auto-answer pending messages');
 console.log('Kit UI: shared safe entry URLs/actions, account-scoped cleanup, durable-before-send/storage failure, duplicate-send prevention and late clear/account response fences PASS');
})().catch(e=>{console.error(e);process.exit(1)});

// #578 keeps the shared pushed-page title compact and the Kit reminder only in an empty chat.
const css=fs.readFileSync('app/static/style.css','utf8')+'\n'+fs.readFileSync('app/static/food.css','utf8');
const index=fs.readFileSync('app/static/index.html','utf8');
const assetBuild=fs.readFileSync('app/asset_build.py','utf8');
const criticalCss=assetBuild.match(/'critical-shell\.css': \(([\s\S]*?)\n    \),/);
const routeCss=assetBuild.match(/'route-screens\.css': \(([\s\S]*?)\n    \),/);
assert(criticalCss&&/'style\.css'/.test(criticalCss[1])&&routeCss&&/'food\.css'/.test(routeCss[1])&&index.indexOf('/static/critical-shell.css')<index.indexOf('/static/app-shell.js'),'Food chat styles load after the shared base stylesheet');
assert(css.includes('.chat-suggestions > button {position:relative;display:flex;align-items:center;justify-content:flex-start;gap:16px;width:100%;min-width:0;min-height:44px;padding:0 16px;'),'suggestions are plain full-width 44px rows with 16px gutters');
assert(css.includes('left:52px;height:1px;background:var(--line);content:\'\';'),'suggestion hairlines begin after the 20px icon and 16px gap');
assert(css.includes('.chat-suggestions > button svg {flex:none;width:20px;height:20px;color:var(--tx2);}'),'suggestion icons use a clear 20px glyph');
assert(css.includes('.kit-chat #kit-starters {flex:none;}')&&css.includes('.kit-chat #kit-composer {padding-top:0;margin-top:auto;}'),'Kit suggestions sit at the page bottom above its composer');
assert(source.includes('elapsed<4000')&&source.includes('elapsed>=20000')&&source.includes('Looking at your recent workouts…')&&source.includes('Checking your data…')&&source.includes('Still working…'),'the wait bubble progresses from dots to contextual status to a long-wait note');
assert(source.includes("Kit couldn't check that answer. Try a simpler question or Retry.")&&!source.includes('esc(c.answerErrors?.[m.client_id]'),'answer failures use the helpful client copy, not raw server errors');
assert(css.includes('min-height:44px;padding:0;box-sizing:border-box;border:0;border-radius:22px;')&&css.includes('outline:1.5px solid var(--accent);outline-offset:-1.5px;box-shadow:none;')&&css.includes('inset:6px;border-radius:50%;background:var(--btn);'),'shared chat field grows from 44px, with a 1.5px ring and a 32px visible Send circle');
assert(css.includes('#kit-text {font-size:max(17px,1rem);'),'Kit composer follows large text settings with approved 17px text');
assert.match(css,/--text-nav-title\s*:\s*17px/);
assert(css.includes('.shell .top.subpage-header > h1')&&css.includes('text-overflow:ellipsis'),'shared pushed-page titles truncate in their centered row');
assert(css.includes('.subpage-header > .icon-btn:not(.progress-back)'),'Progress Back stays in the leading nav slot instead of the actions slot');
assert(css.includes('.shell .top.subpage-header {margin-inline:-8px;padding-inline:8px;}'),'narrow shared headers align Back with page content while keeping the title centered');
assert(css.includes('.food-thread .thread-heading h1')&&css.includes('var(--text-nav-title)'),'chat headings use the same title token');
assert(css.includes('.kit-chat .kit-food-inline:has(#thread-review:not([hidden])) #thread-messages article:last-child .thread-card {border-bottom:0;')&&css.includes('margin:0;border-top:0;border-bottom:1px solid var(--line);border-radius:0 0 20px 6px;'),'the inline review footer completes the same food card border and radius');
assert(css.includes('.kit-training-row {display:grid;')&&css.includes('min-height:44px;padding:4px 0;border-top:1px solid var(--line);'),'training verdict rows keep an inset divider and equal compact padding');
assert(css.includes('@media (max-width:350px)')&&css.includes('.kit-training-row dd {text-align:left;}'),'narrow Kit detail rows put the verdict below the label');
assert(css.includes('.kit-suggested-reply {')&&css.includes('max-width:92%')&&css.includes('background:var(--accent2)')&&css.includes('color:var(--accent)')&&css.includes('border:0;'),'suggested replies are borderless brand bubbles within the message column');
assert(css.includes('.food-thread:not(.kit-chat) .thread-heading h1 { grid-column:1 / -1; grid-row:2;'),'the narrow two-row food-chat layout does not move Ask Kit off its one-row navigation header');
assert(source.includes('id="kit-fine"')&&source.includes('${esc(shortProvider())} · <button type="button" class="linkbtn" id="kit-footer-memory">Memory</button>'),'empty chat reminder sits below the composer');
assert(source.includes('id="kit-about-open">About Kit</button>')&&source.includes('Your chat stays while you switch apps. Start a new one anytime.')&&source.includes('providerName()'),'About Kit explains visit retention and keeps provider details');
assert(source.includes("$('#kit-about-open',body).onclick=()=>{close();sheet('About Kit',"),'About Kit row opens the provider and visit details sheet');
const drawSource=source.slice(source.indexOf('  function factLabel(f){'),source.indexOf('  async function refresh(c,before=null,')).replace('  function draw(c){','  globalThis.draw = function draw(c){');
const drawNodes={'#kit-messages':{innerHTML:''},'#kit-starters':{hidden:true},'#kit-intro':{hidden:true},'#kit-fine':{hidden:true},'#kit-older':{hidden:false}};
const followups=['Would you like to review your recent workouts?','Do you want to log meals for today?','Should we set up a training plan?'].map(q=>({onclick:null,querySelector(){return {textContent:c.Kit.rewriteFollowup(q)}}})),sent=[];
const drawHarness={active:()=>true,$:s=>drawNodes[s],$$:s=>s==='[data-kit-followup]'?followups:[],esc:String,rewriteFollowup:c.Kit.rewriteFollowup,pruneLongSuggestions(){},waitBubble:()=>'<div class="kit-status-bubble"></div>',controls(){},kitChatOn:()=>true,App:{me:{units:'imperial'}},actions:{progress:['Progress','/progress']},svg(){return '<svg></svg>';},send:async(_c,q)=>sent.push(q)};
vm.createContext(drawHarness);vm.runInContext(drawSource,drawHarness);
drawHarness.draw({el:{},messages:[],job:null,before:null});assert.equal(drawNodes['#kit-starters'].hidden,false,'empty chats show suggestions');assert.equal(drawNodes['#kit-fine'].hidden,false,'empty chats show the reminder');
drawHarness.draw({el:{},messages:[{client_id:'fictional',question:'A fictional question',state:'running'}],job:null,before:null});assert.equal(drawNodes['#kit-starters'].hidden,true,'the first Kit message removes the suggestions');assert.equal(drawNodes['#kit-fine'].hidden,true,'messages hide the reminder');
drawHarness.draw({el:{},messages:[],job:{client_id:'fictional',question:'A fictional question'},before:null});assert.equal(drawNodes['#kit-starters'].hidden,true,'a queued first message removes the suggestions');assert.equal(drawNodes['#kit-fine'].hidden,true,'a queued first message hides the reminder');
drawHarness.draw({el:{},messages:[{client_id:'fictional',question:'Am I improving?',state:'answered',answer:{interpretation:'Your recent running is trending up.',facts:[{label:'Run distance',display_value:'124 mi',path:['runs',0,'distance_m']}],limitations:['Unlogged days do not count as zero.'],follow_ups:['How is my running trending?','What should I focus on next?']}}],job:null,before:null});
assert(drawNodes['#kit-messages'].innerHTML.includes('Run distance')&&drawNodes['#kit-messages'].innerHTML.includes('This run')&&drawNodes['#kit-messages'].innerHTML.includes('124 mi'),'Kit answer uses a friendly fact label and converted display value');
assert(!drawNodes['#kit-messages'].innerHTML.includes('Unlogged days do not count'),'Kit answer omits tool limitation lists');
drawHarness.draw({el:{},messages:[{client_id:'voice',question:'A fictional question',state:'answered',answer:{interpretation:'A concise answer.',follow_ups:['Would you like to review your recent workouts?','Do you want to log meals for today?','Should we set up a training plan?']}}],job:null,before:null});
assert(drawNodes['#kit-messages'].innerHTML.includes('Review my recent workouts')&&!drawNodes['#kit-messages'].innerHTML.includes('Log meals for today')&&!drawNodes['#kit-messages'].innerHTML.includes('Set up a training plan'),'only the rewritten first-person question-form pill remains visible');
assert(!drawNodes['#kit-messages'].innerHTML.includes('Would you like to review'),'matched question wording is not shown');
followups[0].onclick();assert.deepEqual(sent,['Review my recent workouts'],'a tapped pill sends its displayed user-voice text');
const response={verdict:'Yes, your recorded running is building.',reason:'You covered more ground across the completed weeks.',interpretation:'Do not duplicate the combined text.',facts:[{label:'Weekly running',display_value:'18.6 mi',value:29933.7984,path:['totals','distance_m']}],follow_ups:['How is my running trending?','What should I focus on next?'],actions:['progress']};
const drawAnswer=answer=>{drawHarness.draw({el:{},messages:[{client_id:'answer',question:'Am I improving?',state:'answered',answer}],job:null,before:null});return drawNodes['#kit-messages'].innerHTML;};
let answerHtml=drawAnswer(response);
assert(answerHtml.indexOf('Am I improving?')<answerHtml.indexOf('kit-verdict'));
assert(answerHtml.indexOf('kit-verdict')<answerHtml.indexOf('kit-reason'),'verdict and reason keep the approved reading order');
assert(!answerHtml.includes('Do not duplicate')&&!answerHtml.includes('href="/progress"'),'follow-up questions replace generic destination links');
assert.equal((answerHtml.match(/data-kit-followup/g)||[]).length,2);
const workoutPromptHtml=drawAnswer({workout_review:{verdict:'Compared with your last 3 runs, pace was 12 s/km faster.',next_step:'Keep your next run easy.'},follow_ups:['How is my training load this week?','How does this week compare with last week?']});
assert(workoutPromptHtml.includes('How is my training load this week?')&&workoutPromptHtml.includes('How does this week compare with last week?'),'the fixed workout-review whitelist keeps both app-chosen prompts visible');
assert(answerHtml.includes('</div><div class="kit-suggested-replies"')&&!answerHtml.includes('kit-answer-followups'),'send bubbles sit outside the answer card');
const trainingHtml=drawAnswer({facts:[{path:['days',9,'fatigue'],value:61.4},{path:['days',9,'fitness'],value:48.4},{path:['days',9,'form'],value:8.7}]});
assert(trainingHtml.includes('Recent training')&&trainingHtml.includes('Heavier than usual')&&trainingHtml.includes('≈ 61 vs ≈ 48 usual'),'recent training shows its verdict before concise whole-number estimates');
assert(trainingHtml.includes('Freshness')&&trainingHtml.includes('>Fresh</strong>')&&trainingHtml.includes('≈ +9'),'freshness is a plain verdict with a whole number');
assert(!trainingHtml.includes('Fatigue')&&!trainingHtml.includes('Fitness')&&!trainingHtml.includes('Form'),'technical training-load labels are replaced');
const detailFor=(fatigue,fitness,form)=>drawAnswer({facts:[{path:['days',2,'fatigue'],value:fatigue},{path:['days',2,'fitness'],value:fitness},{path:['days',2,'form'],value:form}]});
assert(detailFor(39,50,-10).includes('Lighter than usual')&&detailFor(39,50,-10).includes('Balanced'),'lower comparison boundary and -10 freshness boundary remain balanced as specified');
assert(detailFor(60,50,5).includes('About usual')&&detailFor(60,50,5).includes('Balanced'),'comparison and freshness upper thresholds are inclusive');
assert(detailFor(61,50,-11).includes('Heavier than usual')&&detailFor(61,50,-11).includes('Carrying tiredness'),'values past the comparison and fatigue thresholds use their plain verdicts');
assert(detailFor(50,50,6).includes('Fresh</strong>'),'freshness turns fresh above the inclusive upper threshold');
assert(detailFor(50,0,6).includes('Freshness')&&!detailFor(50,0,6).includes('Recent training'),'a zero baseline hides only the comparison row');
const sparseTrainingHtml=drawAnswer({facts:[{path:['days',9,'fatigue'],value:21.2},{path:['days',9,'form'],value:null}]});
assert(!sparseTrainingHtml.includes('Recent training')&&!sparseTrainingHtml.includes('Freshness'),'missing comparison data hides the detail rows');
const historyHtml=()=>{drawHarness.draw({el:{},messages:[
 {client_id:'older',question:'Earlier question',state:'answered',answer:{interpretation:'Earlier answer.',follow_ups:['This older suggestion must stay hidden.']}},
 {client_id:'newer',question:'Newest question',state:'answered',answer:{interpretation:'Newest answer.',follow_ups:['Would you like to review your recent workouts?','Are your legs feeling heavy or fatigued today?','Should we set up a training plan?']}}
],job:null,before:null});return drawNodes['#kit-messages'].innerHTML;};
const historyMarkup=historyHtml();assert.equal((historyMarkup.match(/data-kit-followup/g)||[]).length,2,'only the newest answer offers up to two suggestions');assert(!historyMarkup.includes('This older suggestion must stay hidden.'));
drawHarness.draw({el:{},messages:[{client_id:'older',question:'Earlier question',state:'answered',answer:{interpretation:'Earlier answer.',follow_ups:['An old suggestion.']}},{client_id:'pending',question:'A new question',state:'running'}],job:null,before:null});
assert.equal((drawNodes['#kit-messages'].innerHTML.match(/data-kit-followup/g)||[]).length,0,'suggestions hide while Kit is answering');
const weeklyHtml=drawAnswer({...response,verdict:'Your week shows steady progress.',reason:'The recorded activity supports that summary.',weekly_review:{what_went_well:'You kept a steady rhythm.',what_to_change:'Food entries were sparse.',next_week_focus:'Keep the plan manageable.'}});
assert(weeklyHtml.includes('<p class="kit-verdict">Your week shows steady progress.</p>'),'weekly answer preserves its bold verdict lead');
assert(weeklyHtml.includes('<h3>What went well</h3>')&&weeklyHtml.includes('Keep the plan manageable.'),'weekly sections render below the verdict');
assert(!weeklyHtml.includes('Do not duplicate the combined text.'),'weekly answer does not fall back to duplicate interpretation text');
answerHtml=drawAnswer({interpretation:'Your earlier answer remains readable.',facts:[{label:'totals by sport - distance m',path:['totals_by_sport',0,'distance_m'],value:16093.44},{path:['unlogged_days'],value:27}],actions:['progress','javascript:bad']});
assert(answerHtml.includes('Your earlier answer remains readable.')&&answerHtml.includes('Total · Distance')&&answerHtml.includes('10 mi'),'legacy facts get friendly labels and account units');
assert(!answerHtml.includes('unlogged')&&!answerHtml.includes('javascript:')&&answerHtml.includes('aria-label="Next steps"'),'legacy next steps remain safe and clearly labelled');
drawHarness.App.me.units='metric';assert(drawAnswer({facts:[{path:['distance_m'],value:16093.44}]}).includes('16.1 km'));
assert.equal((drawAnswer({...response,facts:Array(5).fill(response.facts[0])}).match(/<dt>/g)||[]).length,3,'answers show at most three facts');
const qualityHtml=drawAnswer({verdict:'Your 5.0 mi run was harder than last time on this route.',reason:'Average heart rate was 172 bpm against 158 bpm last time.',facts:[
 {path:['runs',0,'distance_m'],display_value:'5.0 mi',value:8046.7},
 {path:['efforts',0,'avg_hr'],display_value:'158 bpm',value:158},
 {path:['runs',0,'avg_hr'],display_value:'172 bpm',value:172},
 {path:['runs',0,'effort'],display_value:'123.8',value:123.8},
 {path:['runs',0,'pace_s_per_km'],display_value:'9:12 /mi',value:552},
 {path:['efforts',0,'pace_s_per_km'],display_value:'9:30 /mi',value:570}
],follow_ups:['What should the next step be?','Would you like to compare my route?','How did you feel?']});
assert.equal((qualityHtml.match(/5\.0 mi/g)||[]).length,1,'a fact repeated in the answer copy is hidden');
assert(!qualityHtml.includes('123.8'),'a bare Effort fact is hidden');
assert(qualityHtml.includes('Last run on this route')&&qualityHtml.includes('This run'),'workout facts carry their source labels');
assert(qualityHtml.includes('158 bpm')&&qualityHtml.includes('172 bpm'),'distinct source facts remain visible');
assert.equal((qualityHtml.match(/data-kit-followup/g)||[]).length,1,'non-first-person follow-ups are dropped');
console.log('Kit #578 title token, About Kit copy and empty-only reminder checks PASS');

require('./test_email_confirmation.js');

require('./test_kit_stream_ui.js');
