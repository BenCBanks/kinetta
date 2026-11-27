// Fictional people groups and per-challenge progress; legacy recap, invites and updates stay covered.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',shots=process.env.KINETTA_SHOTS;
const GROUP_UPDATE_CLOCK=require('../screenshots/fixture-time.json'),GROUP_UPDATE_NOW=new Date(GROUP_UPDATE_CLOCK.instant),GROUP_UPDATE_TODAY=(()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:GROUP_UPDATE_CLOCK.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(GROUP_UPDATE_NOW),part=type=>parts.find(value=>value.type===type)?.value;return`${part('year')}-${part('month')}-${part('day')}`;})(),GROUP_UPDATES_ONLY=process.env.KINETTA_GROUPS_UPDATES_ONLY==='1',GROUP_LIST_ONLY=process.env.KINETTA_GROUPS_LIST_ONLY==='1',GROUP_LOADING_ONLY=process.env.KINETTA_GROUP_LOADING_ONLY==='1',GROUP_DETAIL_ONLY=process.env.KINETTA_GROUPS_DETAIL_ONLY==='1',GROUP_INVITE_ONLY=process.env.KINETTA_GROUPS_INVITE_ONLY==='1',GROUP_HOME_EMPTY_ONLY=process.env.KINETTA_GROUPS_HOME_EMPTY_ONLY==='1';
const GROUP_PICKER_ONLY=process.env.KINETTA_GROUPS_PICKER_ONLY==='1';
const newUpdateText='Alex has the trail notes.';
const token='0123456789abcdef0123456789abcdef',idEmpty='00000000-0000-4000-8000-000000000001',idTwo='00000000-0000-4000-8000-000000000002',idThree='00000000-0000-4000-8000-000000000004',idFull='00000000-0000-4000-8000-000000000050',idLongGoal='00000000-0000-4000-8000-000000000003',idLongOwnGoal='00000000-0000-4000-8000-000000000005',idSix='00000000-0000-4000-8000-000000000006',idTen='00000000-0000-4000-8000-000000000010';
const friendInviteId='4301',idUpdates='00000000-0000-4000-8000-000000000011',idEventDay='00000000-0000-4000-8000-000000000012',idRecap='00000000-0000-4000-8000-000000000013',idOngoing='00000000-0000-4000-8000-000000000014',idDetail='00000000-0000-4000-8000-000000000017',idEscaped='00000000-0000-4000-8000-000000000018';
const empty={id:idEmpty,title:'Fictional Trail Group',event_date:'2026-11-14',goal_start_date:'2026-10-01',goal_sports:['run','ride'],training_for:'Spring goal',weekly_target:null,weekly_target_scope:null,time_zone:'America/New_York',note:'Fictional event weekend',goal_type:'distance',goal_target:600,goal_unit:'mi',your_total:12,your_this_week_total:12,days_to_event:7,weeks_to_event:1,event_state:'upcoming',weekly_reaction:{my_reaction:null,reactions:{}},updates:[],recap_consent:false,monday_recap_enabled:false,monday_recap:null,notifications_muted:false,sharing_level:'just_in',members:[{username:'alex',organizer:true,sharing_total_only:true}],member_count:1,is_organizer:true,joining_closed:false,closed:false};
const two={...empty,id:idTwo,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}],member_count:2};
const three={...empty,id:idThree,total:214,this_week_total:38,this_week_contributors:3,sharing_member_count:3,weekly_target:64.3,weekly_target_scope:'group',sharing_level:'total_shared',members:[{username:'alex',organizer:true,value:12},{username:'fictional_friend',organizer:false,value:38},{username:'fictional_member',organizer:false,sharing_total_only:true}],member_count:3};delete three.your_total;delete three.your_this_week_total;
const detailGroup={...three,id:idDetail,event_date:'2027-04-30',days_to_event:174,weeks_to_event:25,event_state:'upcoming',training_for:'Alpine weekend',is_organizer:false,members:[{username:'alex',organizer:true,sharing_total_only:true},...three.members.slice(1)]};
const escapedTrainingGroup={...three,id:idEscaped,training_for:'<img src=x onerror=alert(1)>'};
const full={...three,id:idFull,members:Array.from({length:50},(_,i)=>({username:`fictional_member_${String(i+1).padStart(2,'0')}`,organizer:i===0,sharing_total_only:true})),member_count:50,sharing_member_count:4};
const longGoal={...three,id:idLongGoal,goal_type:'sessions',goal_target:600,goal_unit:'sessions per scheduled strength training block'};
const longOwnGoal={...empty,id:idLongOwnGoal,goal_type:'sessions',goal_target:600,goal_unit:'sessions per scheduled strength training block',your_total:214};
const six={...three,id:idSix,monday_recap:{week_start:'2026-11-02',total:19},members:Array.from({length:6},(_,i)=>({username:i?'fictional_member_'+i:'alex',organizer:i===0,sharing_total_only:true})),member_count:6,sharing_member_count:4,this_week_contributors:4};
const ten={...six,id:idTen,members:Array.from({length:10},(_,i)=>({username:i?'fictional_member_'+i:'alex',organizer:i===0,sharing_total_only:true})),member_count:10};
const updatesGroup={...three,id:idUpdates,updates:[
 {id:7001,username:'fictional_friend',name:'Fictional friend',photo:'fixture-photo-v1',text:'Marathon plans are ready for the trailhead.',created:'2026-11-07T11:40:00Z',can_delete:false,can_report:true,my_reaction:null,reactions:{}},
 {id:7002,username:'fictional_member',name:'Fictional member',photo:'fixture-photo-v2',text:'I earned Journey · Level 4.',badge:{code:'journey',rank:4,icon:'/static/profile.fluent-emoji/flat/globe_showing_americas_flat.svg'},created:'2026-11-07T11:20:00Z',can_delete:false,can_report:true,my_reaction:'clap',reactions:{clap:1}}
]};
const eventDay={...empty,id:idEventDay,event_state:'today',days_to_event:0,weeks_to_event:0,event_date:'2026-11-07'};
const recapGroup={...three,id:idRecap,event_state:'complete',days_to_event:0,weeks_to_event:0,event_date:'2026-11-02',recap:{event_date:'2026-11-02',total:214,participants:['alex','fictional_friend']},updates:[]};
const ongoingGroup={...empty,id:idOngoing,event_date:null,event_state:'ongoing',days_to_event:null,weeks_to_event:null,your_total:12,your_this_week_total:12,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}],member_count:2,updates:[{id:7010,username:'fictional_friend',name:'Fictional friend',photo:false,text:'Fictional trail notes are ready.',created:'2026-11-07T11:40:00Z',can_delete:false,can_report:true,my_reaction:null,reactions:{clap:1}}]};
const stripGroup={id:idThree,title:'Fictional Trail Group',event_date:'2026-12-14',time_zone:'America/New_York',goal_target:600,goal_unit:'mi',total:214,sharing_member_count:4,member_count:6,days_to_event:217,weeks_to_event:31};
const ongoingStripGroup={id:idOngoing,title:'Fictional trail club',event_date:null,time_zone:'America/New_York',goal_type:'distance',goal_target:100,goal_unit:'km',your_total:12,member_count:2,days_to_event:null,weeks_to_event:null,event_state:'ongoing'};
const stripFixtures={one:{muted:false,has_upcoming:true,more_count:0,next:stripGroup},more:{muted:false,has_upcoming:true,more_count:1,next:stripGroup},ongoing:{muted:false,has_upcoming:true,more_count:0,next:ongoingStripGroup},none:{muted:false,has_upcoming:false}};
const groupUrl=id=>`/groups/${id}`;
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;const a=[...document.querySelectorAll('.scrim,.sheet')].flatMap(x=>x.getAnimations());await Promise.all(a.map(x=>x.finished.catch(()=>{})));});}
async function waitActivity(page){await page.locator('#activity-groups-strip[data-loaded="true"]').waitFor({state:'attached'});await page.locator('#ff-list .post').first().waitFor();}
async function checkCreateSheet(page,width,root,theme){
 await settle(page);await page.setViewportSize({width,height:844});await page.evaluate(size=>document.documentElement.style.fontSize=size+'px',root);
 assert.equal(await page.locator('#group-create-form input').count(),1,'Create asks only for a name');
 const layout=await page.locator('#group-create-form').evaluate(form=>{const name=form.elements.title.getBoundingClientRect(),button=form.querySelector('button[type=submit]').getBoundingClientRect();return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,nameRight:name.right,buttonHeight:button.height,bottom:button.bottom};});
 assert(!layout.overflow&&layout.nameRight<=width&&layout.buttonHeight>=44&&layout.bottom<=844+1,`${width}px ${theme}: ${JSON.stringify(layout)}`);return layout;
}
const fixtureGroups=[empty,two,three,detailGroup,escapedTrainingGroup,full,longGoal,longOwnGoal,six,ten,updatesGroup,eventDay,recapGroup,ongoingGroup];
function challengeFixture(g){return{id:g.id,group_id:g.id,legacy_goal:true,title:g.title,metric:g.goal_type,target:g.goal_target,unit:g.goal_unit,sports:g.goal_sports,start_date:g.goal_start_date,end_date:g.event_date,time_zone:g.time_zone,note:g.note,training_for:g.training_for,ended_at:null,can_manage:g.is_organizer,share_total:g.sharing_level==='total_shared',total:g.total,your_total:g.your_total,members:g.members.map(m=>({...m,shares_total:m.value!==undefined}))};}
const groupExpectedAmount=g=>`${g.total??g.your_total} mi`;
const challengeUrl=id=>groupUrl(id)+'/challenges/'+id;
async function openChallenge(page,id){await page.goto(base+challengeUrl(id));await page.locator('[data-challenge-sharing]').waitFor();}
async function capture(page,name,selector,{hideChrome=false,fullPage=true}={}){
 if(!shots)return;await settle(page);fs.mkdirSync(shots,{recursive:true});const file=path.join(shots,name+'.png');
 if(hideChrome)await page.evaluate(()=>document.querySelectorAll('.group-top,nav.tabs').forEach(node=>{node.dataset.captureVisibility=node.style.visibility;node.style.visibility='hidden';}));
 try{if(selector)await page.locator(selector).screenshot({path:file});else await page.screenshot({path:file,fullPage});}
 finally{if(hideChrome)await page.evaluate(()=>document.querySelectorAll('[data-capture-visibility]').forEach(node=>{node.style.visibility=node.dataset.captureVisibility;delete node.dataset.captureVisibility;}));}
}
(async()=>{
 const browser=await chromium.launch(),contexts=[];
 async function open(theme,width=390,stripState='none',groupListState='none',holdGroupList=GROUP_LOADING_ONLY){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:GROUP_UPDATE_CLOCK.timezone});contexts.push(context);
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200,'isolated demo account login');
    const postedGroups=[],linkJoinPosts=[],friendJoinPosts=[],friendDeclines=[],postedUpdates=[],groupPreferences=[],stripPosts=[],groupDateChanges=[],planSaves=[],groupList=groupListState==='list'?[{...ongoingGroup,title:'Fictional trail club'}, {...ongoingGroup,id:'00000000-0000-4000-8000-000000000015',title:'Morning miles group',event_date:'2026-12-31',weeks_to_event:8,event_state:'upcoming',training_for:'Marathon',total:214}, {...ongoingGroup,id:'00000000-0000-4000-8000-000000000016',title:'Weekend movement'}]:groupListState==='ongoing'?[ongoingGroup]:[],updateCheers=[{login:'fictional_member',name:'Fictional member',photo:false,kind:'clap'}];let updateReactionPeopleReads=0,stripData={...stripFixtures[stripState]},updatesState={...updatesGroup,monday_recap_enabled:false,monday_recap:null,updates:updatesGroup.updates.map(row=>({...row}))},ongoingState={...ongoingGroup,updates:ongoingGroup.updates.map(row=>({...row}))};
  let releaseGroupList,markGroupListStarted,markGroupListLoaded;const groupListGate=new Promise(resolve=>releaseGroupList=resolve),groupListStarted=new Promise(resolve=>markGroupListStarted=resolve),groupListLoaded=new Promise(resolve=>markGroupListLoaded=resolve);
  await context.route('**/api/**',async route=>{

   const req=route.request(),url=new URL(req.url()),method=req.method(),p=url.pathname;
   if(['/api/people/fictional_friend/photo','/api/people/fictional_member/photo','/api/people/alex/photo'].includes(p))return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4778b8"/><circle cx="32" cy="25" r="12" fill="#f2cfaa"/><path d="M8 64c2-17 11-25 24-25s22 8 24 25" fill="#243d5e"/></svg>'});
   if(p==='/api/groups/activity-strip'&&method==='GET')return route.fulfill({json:stripData});
   if(p==='/api/plans'&&method==='POST'){planSaves.push(req.postDataJSON());return route.continue();}
   if(p==='/api/groups/activity-strip'&&method==='POST'){stripPosts.push(req.postDataJSON());stripData={...stripData,muted:req.postDataJSON().muted};return route.fulfill({json:{muted:stripData.muted}});}
   if(p==='/api/groups'&&method==='GET'){if(holdGroupList){markGroupListStarted();await groupListGate;const response=await route.fulfill({json:groupList});markGroupListLoaded();return response;}return route.fulfill({json:groupList});}
   if(p==='/api/groups/people'&&method==='POST'){const body=req.postDataJSON();postedGroups.push(body);const group=body.event_date===null?ongoingGroup:empty;return route.fulfill({json:{...group,invite_url:`https://example.test/group-invite/${token}`}});}
   if(p===`/api/group-invites/${token}`&&method==='GET')return route.fulfill({json:{available:true}});
   if(p===`/api/group-invites/${token}/accept`&&method==='POST'){linkJoinPosts.push(req.postDataJSON());return route.fulfill({json:{...two,id:idEmpty}});}
   if(p===`/api/group-friend-invites/${friendInviteId}`&&method==='GET')return route.fulfill({json:{title:'Fictional Trail Group',inviter:'fictional_host',expires_at:'2026-12-25T00:00:00Z'}});
   if(p===`/api/group-friend-invites/${friendInviteId}/accept`&&method==='POST'){friendJoinPosts.push(req.postDataJSON());return route.fulfill({json:{...two,id:idEmpty}});}
   if(p===`/api/group-friend-invites/${friendInviteId}/decline`&&method==='POST'){friendDeclines.push(req.postDataJSON());return route.fulfill({json:{ok:true}});}
   const challengeMatch=p.match(/^\/api\/groups\/([0-9a-f-]+)\/challenges(?:\/([0-9a-f-]+))?(?:\/(sharing|end))?$/);
   if(challengeMatch){const [,gid,qid,action]=challengeMatch,g=gid===idOngoing?ongoingState:fixtureGroups.find(g=>g.id===gid);if(!g)return route.fulfill({status:404,json:{detail:'Unavailable'}});
    if(method==='PUT'){const b=req.postDataJSON();groupDateChanges.push({event_date:b.event_date});Object.assign(g,{event_date:b.event_date,goal_start_date:b.goal_start_date,goal_type:b.goal_type,goal_target:b.goal_target,goal_unit:b.goal_unit,goal_sports:b.goal_sports,event_state:b.event_date?'upcoming':'ongoing'});}
    if(action==='sharing')g.sharing_level=req.postDataJSON().share_total?'total_shared':'just_in';
    return route.fulfill({json:qid?challengeFixture(g):[challengeFixture(g)]});
   }
   if(p===`/api/groups/${idEmpty}`&&method==='GET')return route.fulfill({json:empty});
   if(p===`/api/groups/${idTwo}`&&method==='GET')return route.fulfill({json:two});
   if(p===`/api/groups/${idThree}`&&method==='GET')return route.fulfill({json:three});
   if(p===`/api/groups/${idDetail}`&&method==='GET')return route.fulfill({json:detailGroup});
   if(p===`/api/groups/${idEscaped}`&&method==='GET')return route.fulfill({json:escapedTrainingGroup});
   if(p===`/api/groups/${idFull}`&&method==='GET')return route.fulfill({json:full});
   if(p===`/api/groups/${idLongGoal}`&&method==='GET')return route.fulfill({json:longGoal});
   if(p===`/api/groups/${idLongOwnGoal}`&&method==='GET')return route.fulfill({json:longOwnGoal});
   if(p===`/api/groups/${idSix}`&&method==='GET')return route.fulfill({json:six});
   if(p===`/api/groups/${idTen}`&&method==='GET')return route.fulfill({json:ten});
   if(p===`/api/groups/${idUpdates}`&&method==='GET')return route.fulfill({json:updatesState});
   if(p===`/api/groups/${idEventDay}`&&method==='GET')return route.fulfill({json:eventDay});
   if(p===`/api/groups/${idRecap}`&&method==='GET')return route.fulfill({json:recapGroup});
   if(p===`/api/groups/${idUpdates}/updates`&&method==='POST'){
    const body=req.postDataJSON(),row={id:7003,username:'alex',name:'Alex Rivera',photo:'fixture-photo-v3',text:body.text,created:GROUP_UPDATE_NOW.toISOString(),can_delete:true,can_report:false,my_reaction:null,reactions:{}};
    postedUpdates.push(body);updatesState.updates.unshift(row);return route.fulfill({json:row});
   }
   if(p===`/api/groups/${idUpdates}/updates/7001/reaction`&&method==='POST'){if(!updateCheers.some(person=>person.login==='alex'))updateCheers.push({login:'alex',name:'Alex Rivera',photo:false,kind:'heart'});return route.fulfill({json:{my_reaction:'heart',reactions:{clap:1,heart:1}}});}
   if(p===`/api/groups/${idUpdates}/updates/7001/reaction`&&method==='DELETE'){for(let i=updateCheers.length-1;i>=0;i--)if(updateCheers[i].login==='alex')updateCheers.splice(i,1);return route.fulfill({json:{my_reaction:null,reactions:{clap:1}}});}
   if(p===`/api/groups/${idUpdates}/updates/7001/reactions`&&method==='GET'){updateReactionPeopleReads++;return route.fulfill({json:{cheers:updateCheers.map(person=>({...person}))}});}
   if(p===`/api/groups/${idUpdates}/notifications`&&method==='POST'){groupPreferences.push({kind:'notifications',...req.postDataJSON()});updatesState.notifications_muted=req.postDataJSON().muted;return route.fulfill({json:{muted:updatesState.notifications_muted}});}
   if(p===`/api/groups/${idUpdates}/monday-recap`&&method==='POST'){groupPreferences.push({kind:'monday-recap',...req.postDataJSON()});updatesState.monday_recap_enabled=req.postDataJSON().enabled;return route.fulfill({json:{enabled:updatesState.monday_recap_enabled}});}
   if(p===`/api/groups/${idUpdates}/recap-consent`&&method==='POST'){groupPreferences.push({kind:'recap',...req.postDataJSON()});updatesState.recap_consent=req.postDataJSON().consent;return route.fulfill({json:{consent:updatesState.recap_consent}});}
   if(p===`/api/groups/${idOngoing}`&&method==='GET')return route.fulfill({json:ongoingState});
   if(p===`/api/groups/${idOngoing}/event-date`&&method==='PATCH'){
    const body=req.postDataJSON();groupDateChanges.push(body);const date=body.event_date;
    ongoingState={...ongoingState,event_date:date,event_state:date?'upcoming':'ongoing',days_to_event:date?7:null,weeks_to_event:date?1:null};
    return route.fulfill({json:ongoingState});
   }
   if(p.startsWith('/api/groups/')&&method==='POST')return route.fulfill({json:{ok:true,invite_url:`https://example.test/group-invite/${token}`}});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];await page.clock.setFixedTime(GROUP_UPDATE_NOW);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  return{context,page,errors,postedGroups,linkJoinPosts,friendJoinPosts,friendDeclines,postedUpdates,groupPreferences,stripPosts,stripState:()=>stripData,updatesState:()=>updatesState,updateReactionPeopleReads:()=>updateReactionPeopleReads,groupDateChanges,ongoingState:()=>ongoingState,planSaves,groupListStarted,groupListLoaded,releaseGroupList};
 }
 async function checkGroupLoading(theme,captureName=`group-loading-390-${theme}`){
  const {context,page,errors,groupListStarted,groupListLoaded,releaseGroupList}=await open(theme,390,'none','none',true);
  await page.goto(base+'/me/groups');await groupListStarted;
  const status=page.locator('#group-list [role=status]');await status.waitFor();
  assert.equal(await status.getAttribute('aria-busy'),'true','the loading state is announced as busy');
  assert.equal(await status.locator('.vh').innerText(),'Loading your groups…','assistive tech gets a concise loading announcement');
  assert.equal(await status.locator('.group-loading-row[aria-hidden=true]').count(),2,'two group-shaped placeholder rows are present and hidden from assistive tech');
  const bounds=await status.boundingBox();assert(bounds&&bounds.width<=390&&bounds.height>=120,'the placeholder card is visible and fits the phone');
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Groups loading has no horizontal overflow');
  if(shots)await capture(page,captureName,null,{fullPage:false});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await status.locator('.group-loading-glyph').first().evaluate(el=>getComputedStyle(el).animationName),'none','skeleton shimmer stops for Reduce Motion');
  releaseGroupList();await groupListLoaded;assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
 }
 async function checkFriendPicker(theme,width){
  const {context,page,errors}=await open(theme,width);let mode='loading',reads=0,linkReads=0,posts=[];
  let releaseLoad,releaseInvite,markInvite;const loadGate=new Promise(resolve=>releaseLoad=resolve),inviteGate=new Promise(resolve=>releaseInvite=resolve),inviteStarted=new Promise(resolve=>markInvite=resolve);
  const rows=[{username:'zora_trails',state:'none'},{username:'alpine_friend',state:'none'},{username:'river_runner',state:'invited'},{username:'joined_friend',state:'member'}];
  await context.route('**/api/groups/*/friends',async route=>{reads++;if(mode==='loading')await loadGate;if(mode==='error')return route.fulfill({status:503,json:{detail:'Fictional offline response'}});return route.fulfill({json:{friends:mode==='empty'?[]:rows,can_invite:!['stopped','full'].includes(mode)}});});
  await context.route('**/api/groups/*/friend-invites',async route=>{posts.push(route.request().postDataJSON());markInvite();await inviteGate;if(mode==='invite-fail')return route.fulfill({status:503,json:{detail:'Fictional invite failed'}});return route.fulfill({json:{state:'invited'}});});
  await context.route('**/api/groups/*/invites',route=>{linkReads++;return route.fulfill({json:{invite_url:'https://example.test/group-invite/fictional-only'}});});
  await page.addInitScript(()=>{window.fixtureShares=[];Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>window.fixtureShares.push(payload)});});
  await page.goto(base+groupUrl(idDetail));await page.locator('#group-header-invite').click();await page.locator('.group-friend-placeholder').first().waitFor();
  assert.equal(await page.locator('.group-friend-placeholder').count(),3);await capture(page,`group-picker-loading-${width}-${theme}`,null,{fullPage:false});
  mode='list';releaseLoad();await page.locator('[data-invite-friend="alpine_friend"]').waitFor();await settle(page);
  const picker=page.locator('.group-friend-sheet');assert.equal(await picker.locator('header h2').innerText(),'Invite to Fictional Trail Group');
  assert.deepEqual(await page.locator('.group-friend-row>b').allTextContents(),['@alpine_friend','@zora_trails','@river_runner','@joined_friend']);
  assert.equal(linkReads,0,'opening Invite never generates or rotates a link');assert.equal(reads,1,'one friends read on open');
  const boxes=await picker.locator('button,input').evaluateAll(elements=>elements.filter(el=>!el.hidden).map(el=>{const r=el.getBoundingClientRect();return{label:el.getAttribute('aria-label')||el.textContent,height:r.height,width:r.width};}));
  assert(boxes.every(box=>box.width>=44&&box.height>=44),`all Invite controls are 44px: ${JSON.stringify(boxes)}`);
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'friend picker fits without horizontal scrolling');
  const colors=await picker.evaluate(el=>{const avatar=getComputedStyle(el.querySelector('.group-friend-avatar')),footer=el.querySelector('[data-group-share]'),brand=document.createElement('span');brand.style.color='var(--accent)';el.append(brand);const result={avatar:avatar.backgroundColor,sheet:getComputedStyle(el).backgroundColor,share:getComputedStyle(footer).color,brand:getComputedStyle(brand).color,icon:getComputedStyle(footer.querySelector('svg')).color};brand.remove();return result;});
  assert.notEqual(colors.avatar,colors.sheet,'avatar circles remain visible in both themes');assert.equal(colors.share,colors.brand,'Share invite link uses the brand color');assert.equal(colors.icon,colors.brand,'Share icon uses the same brand color');
  const footer=await page.locator('.group-friend-footer').boundingBox();assert(footer.y+footer.height<=844&&footer.y>500,'Share stays docked in the sheet');
  assert(!/https:|Copy invite|Done|display name/.test(await picker.innerText()),'no raw URL, duplicate actions or display names');
  await capture(page,`group-picker-friends-${width}-${theme}`,null,{fullPage:false});
  await page.locator('[data-invite-friend="alpine_friend"]').click();await inviteStarted;
  assert.equal(await page.locator('[data-invite-friend="alpine_friend"]').innerText(),'✓ Invited','optimistic feedback appears before response');assert(await page.locator('[data-invite-friend="alpine_friend"]').isDisabled());
  releaseInvite();await page.waitForFunction(()=>document.querySelector('[data-invite-friend="alpine_friend"]').disabled);assert.deepEqual(posts,[{username:'alpine_friend'}],'only the selected username is sent once');
  await capture(page,`group-picker-invited-${width}-${theme}`,null,{fullPage:false});
  mode='invite-fail';await page.locator('[data-invite-friend="zora_trails"]').click();await page.waitForFunction(()=>document.querySelector('[data-invite-friend="zora_trails"]').disabled===false);assert.equal(await page.locator('[data-invite-friend="zora_trails"]').innerText(),'Invite','failed invitation restores its action');mode='list';
  await page.locator('#group-friend-search').fill('nobody');assert.match(await picker.innerText(),/No friends match ‘nobody’/);await capture(page,`group-picker-no-match-${width}-${theme}`,null,{fullPage:false});
  await page.locator('#group-friend-search').fill('');await page.locator('[data-group-share]').click();await page.waitForFunction(()=>fixtureShares.length===1);assert.equal(linkReads,1);assert.equal(await page.evaluate(()=>fixtureShares.length),1,'Share uses the platform share sheet');assert.match(await page.evaluate(()=>fixtureShares[0].text),/fictional-only/);
  await picker.locator('[data-close]').click();await picker.waitFor({state:'detached'});
  mode='empty';await page.locator('#group-header-invite').click();await page.getByText('None of your friends are on Kinetta yet.').waitFor();assert(await page.locator('[data-find-group-friends]').isVisible());await capture(page,`group-picker-empty-${width}-${theme}`,null,{fullPage:false});
  await picker.locator('[data-close]').click();await picker.waitFor({state:'detached'});
  mode='error';await page.locator('#group-header-invite').click();await page.locator('[data-group-friend-retry]').waitFor();assert(await page.locator('[data-group-share]').isVisible());await capture(page,`group-picker-error-${width}-${theme}`,null,{fullPage:false});
  mode='list';await page.locator('[data-group-friend-retry]').click();await page.locator('.group-friend-row').first().waitFor();assert.equal(await page.locator('.group-friend-row').count(),4,'Retry reloads friends');
  await picker.locator('[data-close]').click();await picker.waitFor({state:'detached'});
  mode='full';await context.route('**/api/groups/'+idDetail,route=>route.fulfill({json:{...detailGroup,member_count:50}}));await page.reload();await page.locator('#group-header-invite').click();await page.getByText('Group full',{exact:true}).waitFor();assert(await page.locator('[data-invite-friend="alpine_friend"]').isDisabled());await capture(page,`group-picker-full-${width}-${theme}`,null,{fullPage:false});await picker.locator('[data-close]').click();await picker.waitFor({state:'detached'});
  await context.route('**/api/groups/'+idDetail,route=>route.fulfill({json:{...detailGroup,joining_closed:true}}));mode='stopped';await page.reload();await page.locator('#group-header-invite').click();await page.locator('.group-friend-row').waitFor();assert.equal(await page.locator('.group-friend-row').count(),1,'joining stopped shows Joined friends only');assert(await page.locator('[data-group-share]').isHidden());await capture(page,`group-picker-stopped-${width}-${theme}`,null,{fullPage:false});
  assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
 }
 try{
  await require('./mixed_challenges_ui.cjs')(browser,base,shots);
  if(process.env.KINETTA_MIXED_CHALLENGES_ONLY==='1')return;
  async function eventDateJourney(theme){
   const {context,page,errors,groupDateChanges,ongoingState}=await open(theme);await openChallenge(page,idOngoing);
   assert.equal(await page.locator('.group-goal-period').innerText(),'Since Oct 1');
   const edit=async()=>{await page.locator('[data-challenge-options]').click();await page.locator('[data-challenge-edit]').click();await page.locator('.group-challenge-form').waitFor();};
   await edit();const date=page.getByLabel('End date',{exact:true}),remove=page.locator('[data-challenge-clear-date]');
   assert.equal(await date.inputValue(),'');assert(await remove.isHidden());assert.equal(await page.locator('.group-challenge-form p').count(),0,'no date helper paragraph');
   await date.fill('2026-11-14');await page.locator('.group-challenge-form button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.group-goal-period'));
   await edit();assert.equal(await date.inputValue(),'2026-11-14');await remove.click();await page.locator('.group-challenge-form button[type=submit]').click();await page.locator('.group-goal-period').waitFor();
   assert.deepEqual(groupDateChanges,[{event_date:'2026-11-14'},{event_date:null}]);assert.equal(ongoingState().updates[0].reactions.clap,1,'date edits preserve updates');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
  }
  if(process.env.KINETTA_GROUPS_DATE_ONLY==='1'){for(const theme of ['light','dark'])await eventDateJourney(theme);console.log('Group end date native row: unset/set/remove/save and preservation390 light/dark PASS');return;}
  async function checkCreateRetry(theme){
   const {context,page,errors}=await open(theme);const attempts=[];
   await context.route('**/api/groups/people',async route=>{const body=route.request().postDataJSON();attempts.push(body);
    if(attempts.length===1)return route.abort();
    return route.fulfill({json:{...empty,id:body.id,invite_url:`https://example.test/group-invite/${token}`}});
   });
   await page.goto(base+'/me/groups?create=1');await page.locator('#group-create-form [name=title]').fill('Fictional retry crew');
   const submit=page.locator('#group-create-form button[type=submit]');await submit.click();
   await page.waitForFunction(()=>document.querySelector('#group-create-form button[type=submit]')?.disabled===false);
   assert.equal(await page.locator('#group-create-form [name=title]').inputValue(),'Fictional retry crew');
   await submit.click();await page.locator('[data-group-share]').waitFor();
   assert.equal(attempts.length,2);assert.match(attempts[0].id,/^[0-9a-f-]{36}$/);assert.deepEqual(attempts[1],attempts[0]);
   await page.keyboard.press('Escape');await page.goto(base+'/me/groups?create=1');await page.locator('#group-create-form [name=title]').fill('Fictional second crew');
   await page.locator('#group-create-form button[type=submit]').click();await page.locator('[data-group-share]').waitFor();
   assert.notEqual(attempts[2].id,attempts[0].id,'a separate create sheet gets a fresh key');
   assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
  }
  if(process.env.KINETTA_GROUPS_CREATE_RETRY_ONLY==='1'){for(const theme of ['light','dark'])await checkCreateRetry(theme);console.log('Group create retry key390light/dark PASS');return;}
  for(const theme of ['light','dark'])await checkCreateRetry(theme);
  if(process.env.KINETTA_GROUPS_COMMENTS_ONLY==='1'){await require('./group_comments_ui.cjs')(browser,base,shots);return;}
  if(GROUP_PICKER_ONLY||GROUP_UPDATES_ONLY){for(const theme of ['light','dark'])for(const width of [390,330])await checkFriendPicker(theme,width);console.log('Groups friend picker 390/330 light/dark PASS');if(GROUP_PICKER_ONLY)return;}
  if(GROUP_LOADING_ONLY){
   for(const theme of ['light','dark'])await checkGroupLoading(theme);
   console.log('Groups list loading 390 light/dark PASS');return;
  }
  if(process.env.KINETTA_GROUPS_HOME_ONLY==='1'){
   for(const theme of ['light','dark'])for(const width of [390,330])for(const state of ['one','more','ongoing']){
    const {context,page,errors}=await open(theme,width,state,state==='ongoing'?'ongoing':'list');await page.goto(base+'/activity');await waitActivity(page);
    if(state==='ongoing')assert.equal(await page.locator('.feed-groups-strip').count(),0,'a stale dateless group stays off Home');
    else{assert.equal(await page.locator('.feed-groups-strip').getAttribute('aria-label'),'Next group event');assert.match(await page.locator('.feed-groups-copy b').innerText(),/Fictional Trail Group/);assert.equal(await page.locator('.feed-groups-more').count(),state==='more'?1:0);}
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Home groups fit the phone');await capture(page,`home-groups-${state}-${width}-${theme}`,null,{fullPage:false});
    if(state==='ongoing'){await page.goto(base+'/me/groups');await page.locator('.group-list-row').waitFor();assert.equal(await page.locator('.group-list-row small').innerText(),'You: 12 of 600 mi · Since Oct 1');await capture(page,`ongoing-list-${width}-${theme}`,null,{fullPage:false});}
    assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Home dated/undated groups, more count and Since date 390/330 light/dark PASS');return;
  }
  if(GROUP_HOME_EMPTY_ONLY){
   for(const theme of ['light','dark']){
    const {context,page,errors}=await open(theme,390,'none','none');await page.goto(base+'/activity?view=groups');await page.locator('#group-empty-create').waitFor();
    assert.equal(await page.locator('.home-groups h2').count(),0,'Home Groups does not repeat the selected tab as a heading');assert.equal(await page.locator('.home-groups-heading:visible').count(),0,'the populated-list Create action is hidden in the empty state');assert.equal(await page.locator('#home-group-list button').count(),1,'the empty state has one Create action');assert.equal(await page.locator('.group-empty p').innerText(),'Train together and see each other’s progress.','the empty state says what a group is');assert.equal(await page.locator('#group-empty-create').innerText(),'Create a group');
    const layout=await page.locator('.group-empty').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.querySelector('p'),b=el.querySelector('button'),pr=p.getBoundingClientRect(),br=b.getBoundingClientRect(),s=getComputedStyle(b),tab=document.querySelector('.home-view-switch').getBoundingClientRect(),nav=document.querySelector('nav.tabs').getBoundingClientRect();return{top:r.top,bottom:r.bottom,center:(pr.top+br.bottom)/2,spaceTop:tab.bottom,spaceBottom:nav.top,labelLines:Math.round(pr.height/parseFloat(getComputedStyle(p).lineHeight)),button:{width:br.width,height:br.height,fontSize:s.fontSize,fontWeight:s.fontWeight,background:s.backgroundColor,shadow:s.boxShadow}};});
    assert(layout.labelLines===1,`the label stays on one line at 390px (${theme}): ${JSON.stringify(layout)}`);assert(layout.button.height>=44&&parseFloat(layout.button.fontSize)<=16,`the Create action is a regular 44px control (${theme}): ${JSON.stringify(layout)}`);assert(layout.center>layout.spaceTop+(layout.spaceBottom-layout.spaceTop)*.32&&layout.center<layout.spaceTop+(layout.spaceBottom-layout.spaceTop)*.65,`the empty state sits in the upper-middle of the free space (${theme}): ${JSON.stringify(layout)}`);assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`the empty state fits at 390px (${theme})`);await capture(page,`groups-home-empty-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);
    await page.locator('#group-empty-create').click();await page.locator('#group-create-form').waitFor();await page.locator('.scrim [data-close]').click();await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Home Groups empty-state 390px light/dark PASS');return;
  }
  if(GROUP_INVITE_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {context,page,errors,linkJoinPosts,friendJoinPosts,friendDeclines}=await open(theme,width);await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
    await capture(page,`groups-invite-accept-${width}-${theme}`,null,{fullPage:false});const screen=page.locator('.group-invite-card');assert.equal(await screen.locator('h1').innerText(),'You’re invited to a group');assert.equal(await screen.locator('.friend-invite-caption').innerText(),'Join to see the group with its members.');assert.equal(await screen.locator('#group-accept').innerText(),'Join');assert.equal(await screen.locator('.friend-invite-symbol').count(),1);
    const linkSwitch=page.locator('[data-group-join-share]');assert.equal(await linkSwitch.isChecked(),true,'the link-join default is shown by a visible switch');
    assert(!/Dolomites|fictional_member|Fictional walk group/.test(await screen.innerText()),'the unauthenticated invite preview does not reveal group identity');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Group invite fits ${width}px (${theme})`);
    const button=await page.locator('#group-accept').boundingBox(),later=await page.locator('.friend-invite-later').boundingBox();assert(button.height>=44&&button.width>=width-90);assert(later.height>=44&&later.width>=44);
    const keepLinkShare=width===390&&theme==='light';if(!keepLinkShare)await linkSwitch.uncheck();await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));assert.deepEqual(linkJoinPosts,[{share_total:keepLinkShare}],'the current client sends the visible switch value to join');
    await page.goto(base+`/groups/invites/${friendInviteId}`);await page.locator('#group-friend-accept').waitFor();const friendScreen=page.locator('.group-invite-card');assert.match(await friendScreen.locator('h1').innerText(),/Fictional Trail Group/);assert.match(await friendScreen.locator('.friend-invite-handle').innerText(),/@fictional_host/);
    const friendSwitch=page.locator('[data-group-join-share]');assert.equal(await friendSwitch.isChecked(),true,'friend invite screen visibly defaults sharing on');const switchBox=await friendSwitch.boundingBox(),shareLabel=page.locator('.group-join-share'),shareLabelBox=await shareLabel.boundingBox(),switchStyle=await friendSwitch.evaluate(el=>({radius:getComputedStyle(el).borderRadius,width:getComputedStyle(el).width,height:getComputedStyle(el).height,thumb:getComputedStyle(el,'::after').width,thumbTransform:getComputedStyle(el,'::after').transform,labelWeight:getComputedStyle(el.parentElement).fontWeight,labelSize:getComputedStyle(el.parentElement).fontSize}));assert.equal(switchStyle.width,'51px');assert.equal(switchStyle.height,'31px');assert.equal(switchStyle.radius,'16px');assert.equal(switchStyle.thumb,'27px');assert(switchStyle.thumbTransform.includes('20'),'on-state knob sits at the right side of the track');assert.equal(switchStyle.labelWeight,'400');assert.equal(switchStyle.labelSize,'16px');assert(switchBox.width===51&&switchBox.height===31&&shareLabelBox.height>=44,'the pill switch has a 44px+ label tap target');await capture(page,`groups-friend-invite-accept-${width}-${theme}`,'.group-invite-card');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`friend group invite fits ${width}px (${theme})`);
    const decline=page.locator('#group-friend-decline'),declineBox=await decline.boundingBox();assert.equal(await decline.innerText(),'Decline');assert(declineBox.height>=44&&declineBox.width>=44,'Decline is a quiet 44px target');await decline.click();await page.waitForURL('**/activity');assert.deepEqual(friendDeclines,[{}],'Decline explicitly posts to the invite endpoint');
    await page.goto(base+`/groups/invites/${friendInviteId}`);await page.locator('#group-friend-accept').waitFor();const acceptSwitch=page.locator('[data-group-join-share]');
    const keepFriendShare=width===390&&theme==='light';if(!keepFriendShare)await acceptSwitch.uncheck();await page.locator('#group-friend-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));assert.deepEqual(friendJoinPosts,[{share_total:keepFriendShare}],'friend invite accept sends the visible switch value');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Groups invite acceptance 390/330 light/dark PASS');return;
  }
  if(GROUP_LIST_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {context,page,errors}=await open(theme,width,'none','list');await page.goto(base+'/me/groups');await page.locator('.group-list-card .group-list-row').nth(2).waitFor();
    assert.equal(await page.locator('.group-list-card .group-list-row').count(),3,`three fictional groups render at ${width}px (${theme})`);
    assert.equal(await page.locator('.group-list-row small').nth(1).innerText(),'2 members','the group list describes people rather than a goal');
    assert.equal(await page.locator('#group-new').innerText(),'Create','Create stays in the page header');assert(await page.locator('#group-new').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}),'Create remains a 44px target');
    const layout=await page.locator('.group-list-card').evaluate(card=>({rows:[...card.querySelectorAll('.group-list-row')].map(row=>{const r=row.getBoundingClientRect(),icon=row.querySelector('.ri'),i=icon?.getBoundingClientRect(),s=getComputedStyle(row),copy=row.querySelector('.grow').getBoundingClientRect();return{height:r.height,top:r.top,bottom:r.bottom,padding:s.padding,copyHeight:copy.height,icon:icon?.innerHTML,iconBox:i?{width:i.width,height:i.height}:null,background:s.backgroundColor,transform:s.transform};}),shadow:getComputedStyle(card).boxShadow,cardBackground:getComputedStyle(card).backgroundColor,dividers:[...card.querySelectorAll('.group-list-row + .group-list-row')].map(row=>getComputedStyle(row,'::before').borderTopWidth)}));
    assert(layout.rows.every(row=>row.height>=56&&row.height<=58),`group rows use 56px rhythm at ${width}px (${theme}): ${JSON.stringify(layout)}`);const groupGlyphs=await page.locator('.group-list-row .ri svg').evaluateAll(nodes=>nodes.map(icon=>icon.querySelectorAll('circle').length>=2&&!icon.querySelector('rect')));assert(groupGlyphs.every(Boolean),`each row uses a people glyph (${theme})`);assert(layout.dividers.every(border=>border==='1px'),'the grouped surface uses one-pixel inset dividers');assert.equal(layout.shadow,'none','the Groups list has no raised-card shadow');
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Groups list fits ${width}px (${theme})`);await capture(page,`groups-list-${width}-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Groups list 390/330 light/dark PASS');return;
  }
  if(GROUP_DETAIL_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {context,page,errors}=await open(theme,width);await page.goto(base+groupUrl(idDetail));await page.locator('#group-members').waitFor();
    assert.equal(await page.locator('.group-member').count(),3);assert(await page.locator('#group-panel-updates').isVisible());assert(await page.locator('#group-header-invite').isVisible(),'Invite is visible to members');assert(await page.locator('[data-group-add-challenge]').isVisible(),'every member can add');assert.equal(await page.locator('.group-member-value').count(),0,'the people page does not repeat challenge totals');
    await capture(page,`group-detail-members-${width}-${theme}`,null,{fullPage:false});await openChallenge(page,idDetail);
    assert.equal(await page.locator('.group-training-for').innerText(),'Training for Alpine weekend');assert.equal(await page.locator('.group-weekly-target').innerText(),'Weekly group target · 64.3 mi / week');assert.equal(await page.locator('.group-goal-value').innerText(),'214 mi');assert.equal(await page.locator('.group-member-total-only').innerText(),'Not shared');assert.equal(await page.locator('.group-member-rank,.group-week-cheer').count(),0);
    assert.equal(await page.locator('.group-goal-plan-link').getAttribute('href'),`/plan?new=1&race_day=${detailGroup.event_date}`);assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }console.log('People-first detail and legacy challenge390/330 light/dark PASS');return;
  }
  if(GROUP_UPDATES_ONLY){
   const {context,page,errors,postedUpdates,updatesState}=await open('light');await page.clock.setFixedTime(GROUP_UPDATE_NOW);await page.goto(base+groupUrl(idUpdates));await page.locator('#group-panel-updates').waitFor();await page.locator('.group-updates').waitFor();
   await page.locator('#group-update-text').fill(newUpdateText);await page.locator('.group-update-form button[type=submit]').click();await page.locator('[data-group-update="7003"]').waitFor();
   assert.equal(postedUpdates[0].text,newUpdateText);assert.equal(updatesState().updates[0].created,GROUP_UPDATE_NOW.toISOString(),'the new update returns the shared fixture instant');assert.equal(await page.locator('[data-group-update="7003"] p').innerText(),newUpdateText);
   const expectedTime=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:GROUP_UPDATE_CLOCK.timezone}).format(GROUP_UPDATE_NOW);
   assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .ph-txt small').innerText(),`Today at ${expectedTime}`,'the update timestamp uses the shared fixture instant and timezone');assert.deepEqual(errors,[]);
   await context.close();contexts.splice(contexts.indexOf(context),1);console.log('Group update fixed-clock Today label and post PASS');return;
  }
  {
   const {context,page,errors}=await open('light',330),posts=[];let fail=true,current={...challengeFixture(three),id:crypto.randomUUID(),legacy_goal:false,can_manage:true,note:'Keep this note',training_for:'Autumn miles'};
   await context.route('**/api/groups/'+idThree+'/challenges',async r=>{if(r.request().method()==='POST'){posts.push(r.request().postDataJSON());if(fail)return r.fulfill({status:503,json:{detail:'Fictional temporary error'}});}return r.fulfill({json:[current]});});
   await context.route('**/api/groups/'+idThree+'/challenges/'+current.id+'**',async r=>{const method=r.request().method(),p=new URL(r.request().url()).pathname,b=method==='GET'?null:r.request().postDataJSON();if(method==='PUT'){posts.push(b);current={...current,title:b.title,end_date:b.event_date,note:b.note,training_for:b.training_for};}if(p.endsWith('/sharing'))current.share_total=b.share_total;if(p.endsWith('/end'))current.ended_at=GROUP_UPDATE_NOW.toISOString();return r.fulfill({json:current});});
   await page.goto(base+groupUrl(idThree));await page.locator('[data-group-add-challenge]').click();await page.locator('.group-challenge-form [name=title]').fill('Retry miles');await page.locator('.group-challenge-form [name=event_date]').fill('2026-11-30');await page.locator('.group-challenge-form button[type=submit]').click();await page.getByText('Kinetta is having trouble right now. Please try again.',{exact:true}).waitFor();assert.equal(await page.locator('.group-challenge-form [name=title]').inputValue(),'Retry miles');fail=false;await page.locator('.group-challenge-form button[type=submit]').click();await page.locator('.group-challenge-form').waitFor({state:'detached'});assert.equal(posts[0].id,posts[1].id,'a failed submit retries the same challenge key');
   await page.goto(base+groupUrl(idThree)+'/challenges/'+current.id);await page.locator('[data-challenge-sharing]').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-challenge-sharing]').disabled);assert.equal(current.share_total,false);
   await page.locator('[data-challenge-options]').click();await page.locator('[data-challenge-edit]').click();await page.locator('[data-challenge-clear-date]').click();await page.locator('.group-challenge-form button[type=submit]').click();await page.locator('.group-challenge-form').waitFor({state:'detached'});assert.equal(posts.at(-1).note,'Keep this note');assert.equal(posts.at(-1).training_for,'Autumn miles');assert.equal(posts.at(-1).event_date,null);
   await page.locator('[data-challenge-options]').click();await page.locator('[data-challenge-end]').click();assert.equal(await page.locator('[data-yes]').count(),1,'ending requires confirmation');assert.equal(current.ended_at,null);await page.locator('[data-yes]').click();await page.locator('[data-challenge-options]').waitFor({state:'detached'});assert(current.ended_at);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
  }
  await require('./group_comments_ui.cjs')(browser,base);
  await checkGroupLoading('light');await checkGroupLoading('dark');
  for(const theme of ['light','dark']){
   let context,page,errors,postedGroups,postedUpdates,groupPreferences,updatesState,stripPosts,stripState,updateReactionPeopleReads,groupDateChanges,ongoingState,planSaves;
   ({context,page,errors}=await open(theme,390,'one'));await page.goto(base+'/activity');await waitActivity(page);
   assert.match(await page.locator('#activity-groups-strip').innerText(),/Fictional Trail Group · 31 wk to go/);assert.doesNotMatch(await page.locator('#activity-groups-strip').innerText(),/Dec 14/);assert.match(await page.locator('#activity-groups-strip').innerText(),/214 mi of 600 mi · from 4 of 6/);
   assert.equal(await page.locator('[data-group-strip-mute]').count(),0,'the Activity strip has no separate Mute control');
   const titleLayout=await page.locator('.feed-groups-copy b').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace};});assert(titleLayout.height<=titleLayout.lineHeight*1.2&&titleLayout.scrollWidth<=titleLayout.width+1,`short Activity title stays on one line at 390px (${theme}): ${JSON.stringify(titleLayout)}`);
   const oneStrip=await page.locator('#activity-groups-strip').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,actions:el.querySelectorAll('button').length}));assert(oneStrip.scrollWidth<=oneStrip.width+1&&oneStrip.actions===0,`one-group strip fits without a secondary action (${theme}): ${JSON.stringify(oneStrip)}`);
   await capture(page,`activity-groups-one-390-${theme}`,null,{fullPage:false});
   const groupLink=page.locator('.feed-groups-link');await groupLink.dispatchEvent('pointerdown',{pointerId:71,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:120,clientY:200});await page.waitForTimeout(600);await page.locator('#activity-groups-strip').dispatchEvent('pointerup',{pointerId:71,pointerType:'touch',isPrimary:true,button:0,buttons:0,clientX:120,clientY:200});await page.locator('[data-group-strip-show]').waitFor();assert.equal(await page.locator('#activity-groups-strip').innerText(),'Group strip is hidden\nShow');
   assert.equal(new URL(page.url()).pathname,'/activity','long-press mutes without following the group link');
   assert.equal(await page.locator('.feed-groups-link').count(),0,'muting hides event details');await capture(page,`activity-groups-muted-390-${theme}`,null,{fullPage:false});
   await page.locator('[data-group-strip-show]').click();await page.locator('.feed-groups-link').waitFor();assert.equal(await page.locator('[data-group-strip-mute]').count(),0);assert.equal(await page.locator('.feed-groups-link').count(),1,'Show restores the strip');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'more'));await page.goto(base+'/activity');await waitActivity(page);
   assert.equal(await page.locator('.feed-groups-more').innerText(),'+1');assert.equal(await page.locator('.feed-groups-more').getAttribute('href'),'/activity?view=groups');
   const moreTitleLayout=await page.locator('.feed-groups-copy b').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth};});assert(moreTitleLayout.height<=moreTitleLayout.lineHeight*1.2&&moreTitleLayout.scrollWidth<=moreTitleLayout.width+1,`short title stays on one line with +1 at 390px (${theme}): ${JSON.stringify(moreTitleLayout)}`);
   const moreStrip=await page.locator('#activity-groups-strip').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,actions:el.querySelectorAll('button').length,more:el.querySelector('.feed-groups-more').getBoundingClientRect().toJSON()}));assert(moreStrip.scrollWidth<=moreStrip.width+1&&moreStrip.actions===0&&moreStrip.more.width>=44&&moreStrip.more.height>=44,`multi-group strip fits with only the separate 44px +N action (${theme}): ${JSON.stringify(moreStrip)}`);
   await capture(page,`activity-groups-plus-one-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'none'));await page.goto(base+'/activity');await waitActivity(page);
   assert.equal(await page.locator('.feed-groups-strip').count(),0,'no strip is shown without an upcoming group');assert.equal(await page.locator('#activity-groups-strip').innerText(),'');
   await capture(page,`activity-groups-none-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'ongoing'));await page.goto(base+'/activity');await waitActivity(page);
   assert.equal(await page.locator('.feed-groups-strip').count(),0,'even a stale undated strip response stays hidden on Home');
   await capture(page,`activity-groups-ongoing-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'none','ongoing'));await page.goto(base+'/me/groups');await page.locator('.group-list-row').waitFor();
   assert.equal(await page.locator('.group-list-row small').innerText(),'2 members','the Groups list describes people');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,postedGroups}=await open(theme));
   await page.goto(base+'/me/friends?find=1');await page.locator('#fr-groups-discover').waitFor();
   assert.equal(await page.locator('#fr-groups-discover').getAttribute('href'),'/me/groups','Groups remains reachable from Find friends');
   await capture(page,`friends-groups-row-390-${theme}`);
   await page.goto(base+'/me/friends');await page.locator('#fr-groups').waitFor();await page.locator('#fr-groups').click();await page.waitForURL('**/me/groups');
   await page.locator('#group-empty-create').waitFor();
   assert(await page.locator('#group-new').isHidden(),'empty Groups has only its central Create action');
   assert.equal(await page.locator('#group-list button:visible').count(),1);
   await page.locator('#group-empty-create').click();await page.getByLabel('Group name').waitFor();
   assert.equal(await page.locator('#group-create-form').count(),1);assert.equal(await page.locator('#group-create-form select').count(),0,'units and advanced choices are not on Create');assert.equal(await page.locator('[name=training_for],[name=note],[name=goal_start_date]').count(),0);
   assert(await page.locator('.group-create-footer button[type=submit]').isDisabled());
   for(const width of [390,375,330])await checkCreateSheet(page,width,16,theme);
   await page.locator('[name=title]').fill('Fictional Alpine Weekend');await page.locator('#group-create-form button[type=submit]').click();await page.locator('[data-group-share]').waitFor();
   assert.match(postedGroups.at(-1).id,/^[0-9a-f-]{36}$/);assert.deepEqual(postedGroups.at(-1),{id:postedGroups.at(-1).id,title:'Fictional Alpine Weekend',time_zone:'America/New_York'},'only a retry key accompanies the name and timezone');
   assert.equal(await page.locator('[data-group-share]').count(),1,'One docked Share invite link action replaces raw URLs and copy actions');
   await page.keyboard.press('Escape');await context.close();contexts.splice(contexts.indexOf(context),1);

   await eventDateJourney(theme);

   ({context,page,errors}=await open(theme));await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
   assert.equal(await page.locator('.group-invite-card h1').innerText(),'You’re invited to a group');assert.equal(await page.locator('#group-accept').innerText(),'Join');assert(!/Fictional Trail Group|fictional_member/.test(await page.locator('.group-invite-card').innerText()));
   await capture(page,`groups-invite-accept-390-${theme}`);await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));
   assert.equal(await page.locator('.group-title h1').innerText(),'Fictional Trail Group');assert.equal(await page.locator('.group-goal').count(),0);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   for(const g of [empty,two,three,six,ten,full]){
    ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(g.id));await page.locator('#group-members').waitFor();assert.equal(await page.locator('.group-member').count(),Math.min(10,g.member_count));assert.equal(await page.locator('.group-member-rank,.group-member-value,.group-total-note').count(),0);assert(await page.locator('#group-panel-updates').isVisible());assert(await page.locator('#group-header-invite').isVisible());
    assert.equal(await page.locator('[data-group-invite]').count(),0,'Invite appears only in the header');if(g.member_count>10){await page.locator('[data-group-more]').click();assert.equal(await page.locator('.group-member').count(),g.member_count);}
    await openChallenge(page,g.id);assert.equal(await page.locator('.group-goal-value').innerText(),groupExpectedAmount(g));assert.equal(await page.locator('.group-goal-label').innerText(),`of 600 mi${g.total!==undefined?' together':''}`);assert.equal(await page.locator('.group-member-total-only').count(),g.members.filter(m=>m.value===undefined).length);assert.equal(await page.locator('.group-week-cheer').count(),0);
    const fill=await page.locator('.group-progress').evaluate(el=>el.value/el.max);assert(Math.abs(fill-(g.total??g.your_total)/600)<0.01);assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   ({context,page,errors,postedUpdates,groupPreferences,updatesState,updateReactionPeopleReads}=await open(theme));await page.clock.setFixedTime(GROUP_UPDATE_NOW);await page.goto(base+groupUrl(idUpdates));await page.locator('#group-panel-updates').waitFor();await page.locator('.group-updates').waitFor();
   assert.deepEqual(await page.locator('[data-group-update]').evaluateAll(nodes=>nodes.map(node=>node.dataset.groupUpdate)),['7001','7002'],'updates are newest first');
   assert.match(await page.locator('[data-group-update="7001"] p').innerText(),/Marathon/);
   assert.equal(await page.locator('[data-group-update="7001"] .group-update-badge').count(),0,'free text that mentions Marathon never creates achievement badge art');
   assert.equal(await page.locator('[data-group-update="7002"] .group-update-badge').getAttribute('data-showcase-code'),'journey','structured achievement metadata supplies the Group badge');
   assert.equal(await page.locator('[data-group-update="7002"] .group-update-badge').getAttribute('aria-label'),'Achievement badge, level 4');
   await page.waitForFunction(()=>{const photos=[...document.querySelectorAll('[data-group-update] .group-update-head .av img')];return photos.length===2&&photos.every(image=>image.complete&&image.naturalWidth>0);});
   assert.equal(await page.locator('[data-group-update] .group-update-head .av img').count(),2,'every Group-update author shows their photo');
   assert(await page.locator('[data-group-update="7002"] .group-update-badge img').evaluate(image=>image.complete&&image.naturalWidth>0),'the structured Group badge artwork loads');
   assert.equal(await page.locator('#group-update-text').getAttribute('maxlength'),'200');assert.equal(await page.locator('[data-group-recap-image]').count(),0,'recap art is not prepared until the person taps Share');
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'update page fits the phone');
   await page.evaluate(()=>{const r=document.querySelector('.group-updates').getBoundingClientRect();window.scrollTo(0,r.top+scrollY-130);});await capture(page,`groups-updates-390-${theme}`,'.group-updates');
   await page.locator('[data-update-options="7001"]').click();assert.equal(await page.locator('[data-update-action="report"]').innerText(),'Report comment');assert.equal(await page.locator('[data-update-action="delete"]').count(),0,'only an author or organizer can delete');await page.locator('[data-close]').last().click();
   await page.locator('[data-group-update="7001"] .reaction-more').click();const heart=page.locator('[role="menuitemradio"][data-react="heart"]').last();await heart.waitFor({state:'visible'});const reactionResponse=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reaction')&&r.request().method()==='POST');await heart.click();assert.equal((await reactionResponse).status(),200);
   await page.locator('[data-group-update="7001"] .reaction-count').click();const reactionSheet=page.locator('.reaction-sheet');await reactionSheet.waitFor({state:'visible'});await reactionSheet.locator('.reaction-person').first().waitFor();assert.equal(await reactionSheet.locator('.reaction-person').count(),2,'Group sheet starts with the viewer and another reactor');assert.equal(await reactionSheet.locator('.reaction-remove').count(),1,'the viewer can remove their Group reaction');const readsBeforeRemove=updateReactionPeopleReads(),removeResponse=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reaction')&&r.request().method()==='DELETE'),peopleAfterRemove=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reactions')&&r.request().method()==='GET');await reactionSheet.locator('.reaction-remove').click();assert.deepEqual(await(await removeResponse).json(),{my_reaction:null,reactions:{clap:1}},'Group removal returns the summary without a people list');await peopleAfterRemove;assert.equal(updateReactionPeopleReads(),readsBeforeRemove+1,'the names sheet reloads its people after remove');await page.waitForFunction(()=>{const label=document.querySelector('.reaction-sheet [data-reaction-filter=""]');return label?.textContent.replace(/\s+/g,' ').trim()==='All 1';});assert.equal((await reactionSheet.locator('[data-reaction-filter=""]').innerText()).replace(/\s+/g,' ').trim(),'All 1');assert.equal(await reactionSheet.locator('.reaction-person').count(),1,'the remaining reactor stays visible');assert.match(await reactionSheet.locator('.reaction-person').innerText(),/Fictional member/);assert.equal(await reactionSheet.locator('.reaction-remove').count(),0);await page.keyboard.press('Escape');
   const reportButton=page.locator('[data-update-options="7001"]');await reportButton.click();await page.locator('[data-update-action="report"]').click();await page.locator('#group-update-report-form').waitFor();assert.match(await page.locator('#group-update-report-form').innerText(),/aren’t told who sent it/);await page.locator('[data-close]').last().click();
   await page.locator('#group-update-text').fill(newUpdateText);await page.locator('.group-update-form button[type=submit]').click();await page.locator('[data-group-update="7003"]').waitFor();assert(await page.locator('#group-members').isVisible(),'posting keeps members visible');assert.equal(await page.locator('#group-panel-updates').isVisible(),true);assert.equal(postedUpdates[0].text,newUpdateText);assert.equal(updatesState().updates[0].created,GROUP_UPDATE_NOW.toISOString(),'the new update returns the shared fixture instant');assert.equal(await page.locator('[data-group-update="7003"] p').innerText(),newUpdateText);const expectedTime=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:GROUP_UPDATE_CLOCK.timezone}).format(GROUP_UPDATE_NOW);assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .ph-txt small').innerText(),`Today at ${expectedTime}`,'the update timestamp uses the shared fixture instant and timezone');await page.waitForFunction(()=>{const image=document.querySelector('[data-group-update="7003"] .group-update-head .av img');return image?.complete&&image.naturalWidth>0;});assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .av img').count(),1,'the current author photo appears on a newly added update');assert.equal(await page.locator('[data-group-update="7003"] .group-update-badge').count(),0,'an update without achievement metadata has no badge');
   await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="notifications"]').innerText(),'Mute group notifications');assert.equal(await page.locator('[data-gact="recap-consent"]').innerText(),'Include my name in the event recap');assert.match(await page.locator('[data-gact="monday-recap"]').innerText(),/Get Monday recap.*off by default/s);await capture(page,`groups-monday-recap-opt-in-390-${theme}`);
   const mondayResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/monday-recap')&&r.request().method()==='POST');await page.locator('[data-gact="monday-recap"]').click();assert.equal((await mondayResponse).status(),200);assert.deepEqual(groupPreferences.at(-1),{kind:'monday-recap',enabled:true});
   await page.locator('#group-options').click();await page.locator('[data-gact="monday-recap"]').waitFor();assert.match(await page.locator('[data-gact="monday-recap"]').innerText(),/Turn off Monday recap/);
   const muteGroupResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/notifications')&&r.request().method()==='POST');await page.locator('[data-gact="notifications"]').click();assert.equal((await muteGroupResponse).status(),200);assert.deepEqual(groupPreferences.find(item=>item.kind==='notifications'),{kind:'notifications',muted:true});
   await page.locator('#group-options').click();const consentResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/recap-consent')&&r.request().method()==='POST');await page.locator('[data-gact="recap-consent"]').click();assert.equal((await consentResponse).status(),200);assert.equal(updatesState().recap_consent,true);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await openChallenge(page,idEventDay);assert.equal(await page.locator('.group-event-day').innerText(),'Today’s the day');assert.equal(await page.locator('.group-recap').count(),0);assert.equal(await page.locator('.group-goal-plan-link').count(),0,'the Plan date must be in the future');await capture(page,`groups-event-day-390-${theme}`,'.group-event-day');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await openChallenge(page,idRecap);await page.locator('.group-recap').waitFor();assert.equal(await page.locator('.group-recap>strong').innerText(),'Together: 214 mi');assert.match(await page.locator('.group-recap-names').innerText(),/@alex · @fictional_friend/);assert.equal(await page.locator('.group-goal-plan-link').count(),0,'finished events do not offer Plan setup');await capture(page,`groups-recap-390-${theme}`,'.group-recap');await page.locator('[data-group-recap-share]').click();await page.locator('[data-group-recap-image]:visible').waitFor();assert.equal(await page.locator('[data-group-recap-send]').isEnabled(),true);await capture(page,`groups-recap-share-390-${theme}`,'.scrim');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await openChallenge(page,idSix);assert.equal(await page.locator('.group-week').nth(0).innerText(),'This week · +38 mi');assert.equal(await page.locator('.group-week').nth(1).innerText(),'Last week · 19 mi');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   console.log(`Groups ${theme}: create, generic invite/accept, empty and full roster states pass`);
  }
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330,'one');await page.goto(base+'/activity');await waitActivity(page);const title=page.locator('.feed-groups-copy b');assert.match(await title.innerText(),/Fictional Trail Group · 31 wk to go/);
   const layout=await title.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace};});assert(layout.height>=layout.lineHeight*0.9&&layout.scrollWidth<=layout.width+1&&layout.scrollHeight<=Math.ceil(layout.height)+1,`Activity title wraps cleanly at 330px (${theme}): ${JSON.stringify(layout)}`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');await capture(page,`activity-groups-one-330-${theme}`,null,{fullPage:false});await context.close();contexts.splice(contexts.indexOf(context),1);
   await eventDateJourney(theme);
  }
  const {context,page}=await open('light',330);await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').click();assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster has no horizontal overflow at 330px');await context.close();contexts.splice(contexts.indexOf(context),1);
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330);await openChallenge(page,idLongGoal);const goal=page.locator('.group-goal-label');
   assert.equal(await page.locator('.group-goal-value').innerText(),'214 sessions per scheduled strength training block');assert.equal(await goal.innerText(),'of 600 sessions per scheduled strength training block together');
   const layout=await goal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(layout.height>=layout.lineHeight*1.8,`long-unit goal wraps at 330px (${theme}): ${JSON.stringify(layout)}`);assert(layout.scrollWidth<=layout.width+1,`long-unit goal is not clipped horizontally (${theme})`);assert(layout.scrollHeight<=Math.ceil(layout.height)+1,`long-unit goal is not clipped vertically (${theme})`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');
   await capture(page,`groups-goal-long-units-330-${theme}`,'.group-goal');await context.close();contexts.splice(contexts.indexOf(context),1);

   const {context:ownContext,page:ownPage}=await open(theme,330);await openChallenge(ownPage,idLongOwnGoal);const ownGoal=ownPage.locator('.group-goal-label');
   assert.equal(await ownPage.locator('.group-goal-value').innerText(),'214 sessions per scheduled strength training block');assert.equal(await ownGoal.innerText(),'of 600 sessions per scheduled strength training block');
   const ownLayout=await ownGoal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(ownLayout.height>=ownLayout.lineHeight*1.8,`own-only long-unit goal wraps at 330px (${theme}): ${JSON.stringify(ownLayout)}`);assert(ownLayout.scrollWidth<=ownLayout.width+1,`own-only long-unit goal is not clipped horizontally (${theme})`);assert(ownLayout.scrollHeight<=Math.ceil(ownLayout.height)+1,`own-only long-unit goal is not clipped vertically (${theme})`);assert.notEqual(ownLayout.textOverflow,'ellipsis');assert.equal(ownLayout.whiteSpace,'normal');
   await capture(ownPage,`groups-goal-own-long-units-330-${theme}`,'.group-goal');await ownContext.close();contexts.splice(contexts.indexOf(ownContext),1);
  }
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
