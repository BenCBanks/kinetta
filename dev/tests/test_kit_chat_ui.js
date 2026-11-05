'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync('app/static/kit.js','utf8');
const c={route(){},URLSearchParams,App:{me:{id:7}},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid'},localStorage:{removeItem(){}},Map,Set};vm.createContext(c);vm.runInContext(source+'\nglobalThis.Kit=KitChat;',c);
assert.equal(c.Kit.href('nutrition'),'/me/kit?from=nutrition');assert.equal(c.Kit.href('activity',42),'/me/kit?from=activity&activity=42');assert.equal(c.Kit.href('javascript:bad'),'/me/kit?from=me');
for(const group of Object.values(c.Kit.starters))assert.equal(group.length,3);
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
const accountKeys=[];c.localStorage.removeItem=k=>accountKeys.push(k);c.Kit.eraseDevice();assert.equal(accountKeys.length,2);assert(accountKeys.every(k=>k.endsWith('["https://fictional.invalid",7]')));
const pick=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
// Shared entries need consent, access, a reviewed release and an unpaused service.
{const app=fs.readFileSync('app/static/app.js','utf8'),gate=app.slice(app.indexOf('function aiCan('),app.indexOf('// Calls render(data)'));
 const g={App:{me:{ai_ok:true,coach:true,ai_access:{coach:{available:true,entitled:true}}}}};vm.createContext(g);vm.runInContext(gate,g);
 assert.equal(g.kitChatOn(),false,'no Kit chat until the server reports kit_chat');g.App.me.kit_chat=true;assert.equal(g.kitChatOn(),true);g.App.me.ai_paused=true;assert.equal(g.aiCan('coach'),true,'configured access is independent from a service pause');assert.equal(g.kitChatOn(),false,'paused chat has no entrance');g.App.me.ai_paused=false;g.App.me.ai_access.coach.entitled=false;assert.equal(g.kitChatOn(),false,'age/access denial hides chat');g.App.me.ai_access.coach.entitled=true;g.App.me.ai_ok=false;assert.equal(g.kitChatOn(),false,'consent off hides Kit chat');}
async function testEntryVisibility(){
 const entryHarness={URLSearchParams,App:{me:{id:7},cache:new Map()},Native:{base:'https://fictional.invalid'},location:{origin:'https://fictional.invalid',pathname:'/me',search:''},tabEntryUsers:new Set(),activityEntryUsers:new Map(),activityEntryRequests:new Map(),kitChatOn:()=>false,owner:()=>JSON.stringify([entryHarness.Native.base,entryHarness.App.me.id]),href:s=>'/me/kit?from='+s,svg:()=>'',kept:()=>null,activityRows:[],apiCalls:[],readOnce:async p=>{entryHarness.apiCalls.push(p);return entryHarness.activityRows;},document:null};
 let link=null,made=0;const heading={querySelector:()=>null,append:n=>{link=n;}};
 const page={isConnected:true,querySelector:s=>s==='.top,.me-top'?heading:s==='[data-kit-entry]'?link:null};entryHarness.document={createElement(){made++;return {setAttribute(k,v){this[k]=v;},remove(){link=null;}};},querySelector:s=>s==='#page'?page:null};
 vm.createContext(entryHarness);
 const relevant=source.slice(source.indexOf('  function entryRelevant('),source.indexOf('  function checkActivityEntry(')).replace('function entryRelevant','globalThis.entryRelevant=function entryRelevant');
 const check=source.slice(source.indexOf('  function checkActivityEntry('),source.indexOf('  const active=' )).replace('function checkActivityEntry','globalThis.checkActivityEntry=function checkActivityEntry');
 const entry=source.slice(source.indexOf('  function entry(el,path){'),source.indexOf('  return {mount,')).replace('function entry','globalThis.entry=function entry');
 vm.runInContext(relevant+'\n'+check+'\n'+entry,entryHarness);
 await entryHarness.entry(page,'/me');assert.equal(link,null,'a person with no Kit, food or activity use sees no icon');assert(entryHarness.apiCalls.includes('/api/activities?limit=1'),'activity relevance is checked with the current user’s own activity list');
 entryHarness.App.me={id:8,food_user:true};await entryHarness.entry(page,'/me');assert.equal(link.href,'/food?add=1');assert.equal(link['aria-label'],'Add food','a food user sees the icon while AI is off and opens Add food');
 link=null;entryHarness.App.me={id:9};entryHarness.activityRows=[{id:1}];await entryHarness.entry(page,'/me');assert.equal(link.href,'/food?add=1','a person with activity history sees the icon across tabs while AI is off');
 for(const path of ['/me','/activity','/track','/progress','/food','/plan']){entryHarness.location.pathname=path;const before=made;await entryHarness.entry(page,path);assert.equal(made,before,path+' keeps one icon for the active food/activity user');assert.equal(link.href,'/food?add=1');}
 entryHarness.App.me={id:10};entryHarness.kitChatOn=()=>true;link=null;entryHarness.location.pathname='/me';await entryHarness.entry(page,'/me');assert.equal(link.href,'/me/kit?from=me','Kit-enabled people see the entry without food/activity history');assert.equal(link['aria-label'],'Ask Kit');
 entryHarness.App.me={id:11};entryHarness.kitChatOn=()=>false;link=null;entryHarness.location.pathname='/track';await entryHarness.entry(page,'/track');assert.equal(link.href,'/food?add=1','using an activity tab makes the entry relevant');
 entryHarness.App.me={id:12};entryHarness.activityRows=[];entryHarness.location.pathname='/me';link=null;await entryHarness.entry(page,'/me');assert.equal(link,null,'an unrelated user remains without a tab-root icon');
 for(const path of ['/me/settings','/me/sharing','/me/devices','/track/import','/food/import','/track/connections','/me/explore','/me/people','/me/speed']){link=null;const before=made;await entryHarness.entry(page,path);assert.equal(made,before,path+' has no general chat entrance');}
 for(const [file,needle] of [['app/static/pages.js',"kitChatOn() ? go(KitChat.href('activity'"],['app/static/thread.js',"!kitChatOn()||!(r.offer_kit"]])assert(fs.readFileSync(file,'utf8').includes(needle),file+' gates its Kit chat entry');
}
async function testFoodThreadBridge(){
 let host,submitted='',pageCalls=0;const field={value:'',style:{},dispatchEvent(){}},notice={textContent:''};
 const form={requestSubmit(){submitted=field.value;field.value='';}},slot={append(el){host=el;el.isConnected=true;}};
 const foodHost={isConnected:false,setAttribute(){}};
 const bridge={pageCalls:0,FoodThread:{page(el,options){bridge.pageCalls++;bridge.pageHost=el;bridge.pageOptions=options;}},document:{createElement(tag){assert.equal(tag,'section');return foodHost;}},Event:class{},$(selector){return {'#kit-food-slot':slot,'#thread-text':field,'#thread-composer':form,'#thread-status':notice}[selector];},draw(){},active:()=>true,status(){}};
 vm.createContext(bridge);
 vm.runInContext(pick('  function mountFoodThread(c){','  function clearDraft(')+'\n'+pick('  async function sendFood(c,text){','  async function refresh('),bridge);
 const result=await bridge.sendFood({el:{},owner:'fixture'},'2 eggs');
 assert.equal(result,true,'the Kit food route submits through the inline FoodThread composer');assert.equal(bridge.pageCalls,1,'the existing FoodThread.page export owns the inline engine');assert.equal(bridge.pageHost,host);assert.equal(JSON.stringify(bridge.pageOptions),'{}');assert.equal(submitted,'2 eggs','the text reaches the existing FoodThread composer');
}
(async()=>{
 await testEntryVisibility();
 await testFoodThreadBridge();
 let saved,delivered=0,status='',field={value:'My unsent question'};
 const sender={active:()=>true,kitChatOn:()=>true,foodIntent:()=>null,clearDraft(){},$ :()=>field,newId:()=> 'stable-uuid',save:(ctx,k,v)=>{saved=v},deliver:async()=>delivered++,status:(ctx,v)=>status=v};vm.createContext(sender);vm.runInContext(pick('  async function send(c,text){','  async function mount(el){'),sender);
 const ctx={loaded:true,ready:true,sending:false,generation:'generation-a',context:{screen:'nutrition'}};await sender.send(ctx);assert.equal(saved.question,'My unsent question');assert.equal(saved.client_id,'stable-uuid');assert.equal(saved.generation,'generation-a');assert.equal(delivered,1);await sender.send(ctx);assert.equal(delivered,1,'current-visit durable question is retried, never duplicated');
 ctx.job=null;sender.kitChatOn=()=>false;await sender.send(ctx);assert.equal(delivered,1,'availability loss cannot send a model request');assert.equal(field.value,'My unsent question','unavailable chat keeps its draft');sender.kitChatOn=()=>true;
 ctx.job=null;sender.save=()=>{throw Error('quota')};await sender.send(ctx);assert.equal(field.value,'My unsent question');assert.equal(delivered,1);assert(status.includes('could not save'));
 ctx.job=null;ctx.ready=false;await sender.send(ctx);assert.equal(delivered,1);assert.equal(field.value,'My unsent question');assert(status.includes('isn’t available'));
 let promptDeliveries=0;const foodBodies=[],promptField={value:'Can you log my food',style:{}};
 const foodRouter={active:()=>true,kitChatOn:()=>true,foodIntent:(text,awaiting)=>c.Kit.foodIntent(text,awaiting),clearDraft(_c,f,submitted){if(f.value.trim()===submitted.trim())f.value='';return true;},$ :()=>promptField,draw(){},controls(){},status(){},sendFood:async(_c,body)=>{foodBodies.push(body);return true;},newId:()=> 'activity-question',save(){},deliver:async()=>promptDeliveries++};
 vm.createContext(foodRouter);vm.runInContext(pick('  async function send(c,text){','  async function mount(el){'),foodRouter);
 const foodContext={loaded:true,ready:true,sending:false,generation:'g',context:{screen:'activity'}};await foodRouter.send(foodContext);
 assert.equal(foodContext.localMessages[0].answer.interpretation,'What did you have?','a bare food-log request gets the short food follow-up');assert.equal(foodBodies.length,0);assert.equal(promptDeliveries,0,'the follow-up does not call the model or old food-logger answer');
 promptField.value='2 eggs and toast';await foodRouter.send(foodContext);assert.deepEqual(foodBodies,['2 eggs and toast'],'the follow-up sends the food description to FoodThread');assert.equal(foodContext.awaitingFood,false);
 promptField.value='How has my running changed this month?';await foodRouter.send(foodContext);assert.equal(promptDeliveries,1,'an activity question from any tab stays in Kit');
 // A server-accepted message after a lost acknowledgement reconciles the durable local send.
 const removed=[];field={value:'Accepted earlier',style:{}};
 const loader={kitChatOn:()=>true,aiCan:()=>true,App:{me:{ai_ok:true}},api:async()=>({generation:'generation-a',messages:[{id:1,client_id:'accepted',question:'Accepted earlier',state:'answered'}],ready:true,before:null}),active:()=>true,$:()=>field,store:{del:k=>removed.push(k)},key:(o,k)=>k,draw(){},status(){},Map,answer(){throw Error('Answered messages cannot call the model again')},later(){}};
 vm.createContext(loader);vm.runInContext(pick('  async function refresh(c,before=null){','  const later='),loader);
 const resumed={generation:'generation-a',owner:'one',messages:[],job:{client_id:'accepted',question:'Accepted earlier',generation:'generation-a'}};
 await loader.refresh(resumed);assert.equal(resumed.job,null);assert.equal(field.value,'');assert(removed.includes('pending')&&removed.includes('draft'));
 // Reorder the actual answer handler across Clear and account changes.
 let finish,draws=0,active=true,refreshes=0;
 const answerer={kitChatOn:()=>true,active:()=>active,controls(){},api:()=>new Promise(resolve=>finish=resolve),json:(m,b)=>b,draw:()=>draws++,later(){},refresh:async()=>refreshes++,status(){}};vm.createContext(answerer);vm.runInContext(pick('  async function answer(c,id){','  async function deliver(c){'),answerer);
 const chat={ready:true,generation:'old',messages:[{client_id:'same',state:'pending'}],sending:false};const task=answerer.answer(chat,'same');chat.generation='new';chat.messages=[];chat.sending=false;finish({client_id:'same',state:'answered',answer:{interpretation:'late'}});await task;assert.equal(chat.messages.length,0);assert.equal(draws,0);assert.equal(chat.sending,false);assert.equal(refreshes,0,'a cleared result cannot refresh over the new chat');
 chat.generation='current';chat.visit_id='first-visit';chat.messages=[{client_id:'same',state:'pending'}];const ended=answerer.answer(chat,'same');chat.visit_id='next-visit';chat.messages=[];finish({client_id:'same',state:'answered'});await ended;assert.equal(draws,0,'a late answer from an ended visit cannot enter a fresh visit');
 chat.generation='current';chat.messages=[{client_id:'same',state:'pending'}];const next=answerer.answer(chat,'same');active=false;finish({client_id:'same',state:'answered'});await next;assert.equal(chat.messages[0].state,'pending');assert.equal(draws,0,'another session never renders the old answer');
 let forbidden=0;answerer.api=()=>{forbidden++;throw Error('Unavailable model request')};answerer.kitChatOn=()=>false;active=true;await answerer.answer(chat,'same');assert.equal(forbidden,0,'unavailable retries never request an answer');
 const delivery={...answerer};vm.createContext(delivery);vm.runInContext(pick('  async function deliver(c){','  async function send(c,text){'),delivery);await delivery.deliver({...chat,job:{question:'Kept'}});assert.equal(forbidden,0,'unavailable retry sending never requests a message');
 let auto=0;loader.kitChatOn=()=>false;loader.api=async()=>({generation:'generation-a',messages:[{id:1,client_id:'pending',state:'pending'}],ready:true,before:null});loader.answer=()=>auto++;await loader.refresh({...resumed,job:null});assert.equal(auto,0,'pause cannot auto-answer an existing pending message');loader.kitChatOn=()=>true;loader.api=async()=>({generation:'generation-a',messages:[{id:1,client_id:'pending',state:'pending'}],ready:false,before:null});await loader.refresh({...resumed,job:null});assert.equal(auto,0,'unreviewed chat cannot auto-answer pending messages');
 console.log('Kit UI: shared safe entry URLs/actions, account-scoped cleanup, durable-before-send/storage failure, duplicate-send prevention and late clear/account response fences PASS');
})().catch(e=>{console.error(e);process.exit(1)});

// #578 keeps the shared pushed-page title compact and the Kit reminder only in an empty chat.
const css=fs.readFileSync('app/static/style.css','utf8');
assert.match(css,/--text-nav-title\s*:\s*17px/);
assert(css.includes('.shell .top.subpage-header > h1')&&css.includes('text-overflow:ellipsis'),'shared pushed-page titles truncate in their centered row');
assert(css.includes('.subpage-header > .icon-btn:not(.progress-back)'),'Progress Back stays in the leading nav slot instead of the actions slot');
assert(css.includes('.shell .top.subpage-header {margin-inline:-8px;padding-inline:8px;}'),'narrow shared headers align Back with page content while keeping the title centered');
assert(css.includes('.food-thread .thread-heading h1')&&css.includes('var(--text-nav-title)'),'chat headings use the same title token');
assert(css.includes('.kit-chat .kit-food-inline:has(#thread-review:not([hidden])) #thread-messages article:last-child .thread-card {border-bottom:0;')&&css.includes('margin:0;border-top:0;border-bottom:1px solid var(--line);border-radius:0 0 20px 6px;'),'the inline review footer completes the same food card border and radius');
assert(css.includes('.food-thread:not(.kit-chat) .thread-heading h1 { grid-column:1 / -1; grid-row:2;'),'the narrow two-row food-chat layout does not move Ask Kit off its one-row navigation header');
assert(source.includes('id="kit-fine"')&&source.includes('${esc(shortProvider())} · <button type="button" class="linkbtn" id="kit-footer-memory">Memory</button>'),'empty chat reminder sits below the composer');
assert(source.includes('id="kit-about-open">About Kit</button>')&&source.includes('New chat each visit.')&&source.includes('providerName()'),'About Kit keeps visit and provider details in the menu flow');
assert(source.includes("$('#kit-about-open',body).onclick=()=>{close();sheet('About Kit',"),'About Kit row opens the provider and visit details sheet');
const drawSource=source.slice(source.indexOf('  function draw(c){'),source.indexOf('  async function refresh(c,before=null){')).replace('  function draw(c){','  globalThis.draw = function draw(c){');
const drawNodes={'#kit-messages':{innerHTML:''},'#kit-intro':{hidden:true},'#kit-fine':{hidden:true},'#kit-older':{hidden:false}};
const drawHarness={active:()=>true,$:s=>drawNodes[s],$$:()=>[],esc:String,controls(){},kitChatOn:()=>true};
vm.createContext(drawHarness);vm.runInContext(drawSource,drawHarness);
drawHarness.draw({el:{},messages:[],job:null,before:null});assert.equal(drawNodes['#kit-fine'].hidden,false,'empty chats show the reminder');
drawHarness.draw({el:{},messages:[{client_id:'fictional',question:'A fictional question',state:'running'}],job:null,before:null});assert.equal(drawNodes['#kit-fine'].hidden,true,'messages hide the reminder');
drawHarness.draw({el:{},messages:[],job:{client_id:'fictional',question:'A fictional question'},before:null});assert.equal(drawNodes['#kit-fine'].hidden,true,'a queued first message hides the reminder');
console.log('Kit #578 title token, About Kit copy and empty-only reminder checks PASS');
