// Fictional group fixtures. Captures group progress, Activity strip, updates, event day, recap and roster states.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',shots=process.env.KINETTA_SHOTS;
const GROUP_UPDATE_CLOCK=require('../screenshots/fixture-time.json'),GROUP_UPDATE_NOW=new Date(GROUP_UPDATE_CLOCK.instant),GROUP_UPDATE_TODAY=(()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:GROUP_UPDATE_CLOCK.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(GROUP_UPDATE_NOW),part=type=>parts.find(value=>value.type===type)?.value;return`${part('year')}-${part('month')}-${part('day')}`;})(),GROUP_UPDATES_ONLY=process.env.KINETTA_GROUPS_UPDATES_ONLY==='1',GROUP_LIST_ONLY=process.env.KINETTA_GROUPS_LIST_ONLY==='1',GROUP_DETAIL_ONLY=process.env.KINETTA_GROUPS_DETAIL_ONLY==='1',GROUP_INVITE_ONLY=process.env.KINETTA_GROUPS_INVITE_ONLY==='1';
const newUpdateText='Alex has the trail notes.';
const token='0123456789abcdef0123456789abcdef',idEmpty='00000000-0000-4000-8000-000000000001',idTwo='00000000-0000-4000-8000-000000000002',idThree='00000000-0000-4000-8000-000000000004',idFull='00000000-0000-4000-8000-000000000050',idLongGoal='00000000-0000-4000-8000-000000000003',idLongOwnGoal='00000000-0000-4000-8000-000000000005',idSix='00000000-0000-4000-8000-000000000006',idTen='00000000-0000-4000-8000-000000000010';
const idUpdates='00000000-0000-4000-8000-000000000011',idEventDay='00000000-0000-4000-8000-000000000012',idRecap='00000000-0000-4000-8000-000000000013',idOngoing='00000000-0000-4000-8000-000000000014',idDetail='00000000-0000-4000-8000-000000000017',idEscaped='00000000-0000-4000-8000-000000000018';
const empty={id:idEmpty,title:'Fictional Trail Group',event_date:'2026-11-14',goal_start_date:'2026-10-01',goal_sports:['run','ride'],training_for:'Spring goal',weekly_target:null,weekly_target_scope:null,time_zone:'America/New_York',note:'Fictional event weekend',goal_type:'distance',goal_target:600,goal_unit:'mi',your_total:12,your_this_week_total:12,days_to_event:7,weeks_to_event:1,event_state:'upcoming',weekly_reaction:{my_reaction:null,reactions:{}},updates:[],recap_consent:false,monday_recap_enabled:false,monday_recap:null,notifications_muted:false,members:[{username:'alex',organizer:true,sharing_total_only:true}],member_count:1,is_organizer:true,joining_closed:false,closed:false};
const two={...empty,id:idTwo,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}],member_count:2};
const three={...empty,id:idThree,total:214,this_week_total:38,this_week_contributors:3,sharing_member_count:3,weekly_target:64.3,weekly_target_scope:'group',members:[{username:'alex',organizer:true,value:12},{username:'fictional_friend',organizer:false,value:38},{username:'fictional_member',organizer:false,value:164}],member_count:3};delete three.your_total;delete three.your_this_week_total;
const detailGroup={...three,id:idDetail,members:[{username:'alex',organizer:true,sharing_total_only:true},...three.members.slice(1)]};
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
 await page.setViewportSize({width,height:844});
 await page.evaluate(size=>{document.documentElement.style.fontSize=size+'px';},root);
 const layout=await page.evaluate(()=>{
  const box=element=>{const r=element.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width};};
  const fields=document.querySelector('.group-create-fields'),date=document.querySelector('[name=event_date]'),name=document.querySelector('[name=title]'),grid=document.querySelector('.group-goal-fields');
  return{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,fields:{...box(fields),clientWidth:fields.clientWidth,scrollWidth:fields.scrollWidth},date:box(date),name:box(name),grid:box(grid),labels:[...document.querySelectorAll('.group-create-fields>label')].map(label=>({text:label.childNodes[0]?.textContent.trim(),...box(label)}))};
 });
 assert(layout.documentWidth<=width+1,`Groups create sheet has no page overflow at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 assert(layout.fields.scrollWidth<=layout.fields.clientWidth+1,`Groups fields have no horizontal scroll at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 assert(layout.date.x>=layout.fields.x-1&&layout.date.right<=layout.fields.right+1,`Event date remains inside the fields at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 assert(Math.abs(layout.date.width-layout.name.width)<=1,`Event date matches the name field width at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 assert(layout.grid.x>=layout.fields.x-1&&layout.grid.right<=layout.fields.right+1,`Goal grid remains inside the fields at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 assert(layout.labels.every(label=>label.x>=layout.fields.x-1&&label.right<=layout.fields.right+1),`Every Groups label remains visible at ${width}px / ${root}px (${theme}): ${JSON.stringify(layout)}`);
 return layout;
}
async function capture(page,name,selector,{hideChrome=false,fullPage=true}={}){
 if(!shots)return;await settle(page);fs.mkdirSync(shots,{recursive:true});const file=path.join(shots,name+'.png');
 if(hideChrome)await page.evaluate(()=>document.querySelectorAll('.group-top,nav.tabs').forEach(node=>{node.dataset.captureVisibility=node.style.visibility;node.style.visibility='hidden';}));
 try{if(selector)await page.locator(selector).screenshot({path:file});else await page.screenshot({path:file,fullPage});}
 finally{if(hideChrome)await page.evaluate(()=>document.querySelectorAll('[data-capture-visibility]').forEach(node=>{node.style.visibility=node.dataset.captureVisibility;delete node.dataset.captureVisibility;}));}
}
(async()=>{
 const browser=await chromium.launch(),contexts=[];
 async function open(theme,width=390,stripState='none',groupListState='none'){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:GROUP_UPDATE_CLOCK.timezone});contexts.push(context);
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200,'isolated demo account login');
  const postedGroups=[],postedUpdates=[],groupPreferences=[],stripPosts=[],groupDateChanges=[],groupList=groupListState==='list'?[{...ongoingGroup,title:'Fictional trail club'}, {...ongoingGroup,id:'00000000-0000-4000-8000-000000000015',title:'Morning miles group',event_date:'2026-12-31',weeks_to_event:8,event_state:'upcoming',training_for:'Marathon',total:214}, {...ongoingGroup,id:'00000000-0000-4000-8000-000000000016',title:'Weekend movement'}]:groupListState==='ongoing'?[ongoingGroup]:[],updateCheers=[{login:'fictional_member',name:'Fictional member',photo:false,kind:'clap'}];let updateReactionPeopleReads=0,stripData={...stripFixtures[stripState]},updatesState={...updatesGroup,monday_recap_enabled:false,monday_recap:null,updates:updatesGroup.updates.map(row=>({...row}))},ongoingState={...ongoingGroup,updates:ongoingGroup.updates.map(row=>({...row}))};
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method(),p=url.pathname;
   if(['/api/people/fictional_friend/photo','/api/people/fictional_member/photo','/api/people/alex/photo'].includes(p))return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4778b8"/><circle cx="32" cy="25" r="12" fill="#f2cfaa"/><path d="M8 64c2-17 11-25 24-25s22 8 24 25" fill="#243d5e"/></svg>'});
   if(p==='/api/groups/activity-strip'&&method==='GET')return route.fulfill({json:stripData});
   if(p==='/api/groups/activity-strip'&&method==='POST'){stripPosts.push(req.postDataJSON());stripData={...stripData,muted:req.postDataJSON().muted};return route.fulfill({json:{muted:stripData.muted}});}
   if(p==='/api/groups'&&method==='GET')return route.fulfill({json:groupList});
   if(p==='/api/groups'&&method==='POST'){const body=req.postDataJSON();postedGroups.push(body);const group=body.event_date===null?ongoingGroup:empty;return route.fulfill({json:{...group,invite_url:`https://example.test/group-invite/${token}`}});}
   if(p===`/api/group-invites/${token}`&&method==='GET')return route.fulfill({json:{available:true}});
   if(p===`/api/group-invites/${token}/accept`&&method==='POST')return route.fulfill({json:{...two,id:idEmpty}});
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
  return{context,page,errors,postedGroups,postedUpdates,groupPreferences,stripPosts,stripState:()=>stripData,updatesState:()=>updatesState,updateReactionPeopleReads:()=>updateReactionPeopleReads,groupDateChanges,ongoingState:()=>ongoingState};
 }
 try{
  if(GROUP_INVITE_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {context,page,errors}=await open(theme,width);await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
    await capture(page,`groups-invite-accept-${width}-${theme}`,null,{fullPage:false});const screen=page.locator('.group-invite-card');assert.equal(await screen.locator('h1').innerText(),'You’re invited to a group');assert.equal(await screen.locator('.friend-invite-caption').innerText(),'Join to see the group with its members.');assert.equal(await screen.locator('#group-accept').innerText(),'Join');assert.equal(await screen.locator('.friend-invite-symbol').count(),1);
    assert(!/Dolomites|fictional_member|Fictional walk group/.test(await screen.innerText()),'the unauthenticated invite preview does not reveal group identity');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Group invite fits ${width}px (${theme})`);
    const button=await page.locator('#group-accept').boundingBox(),later=await page.locator('.friend-invite-later').boundingBox();assert(button.height>=44&&button.width>=width-90);assert(later.height>=44&&later.width>=44);
    await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Groups invite acceptance 390/330 light/dark PASS');return;
  }
  if(GROUP_LIST_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    const {context,page,errors}=await open(theme,width,'none','list');await page.goto(base+'/me/groups');await page.locator('.group-list-card .group-list-row').nth(2).waitFor();
    assert.equal(await page.locator('.group-list-card .group-list-row').count(),3,`three fictional groups render at ${width}px (${theme})`);
    assert.equal(await page.locator('.group-list-row small').nth(1).innerText(),'214 of 600 mi · 8 weeks to go','the list shows shared progress and remaining time');
    assert.equal(await page.locator('#group-new').innerText(),'Create','Create stays in the page header');assert(await page.locator('#group-new').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}),'Create remains a 44px target');
    const layout=await page.locator('.group-list-card').evaluate(card=>({rows:[...card.querySelectorAll('.group-list-row')].map(row=>{const r=row.getBoundingClientRect(),icon=row.querySelector('.ri'),i=icon?.getBoundingClientRect(),s=getComputedStyle(row),copy=row.querySelector('.grow').getBoundingClientRect();return{height:r.height,top:r.top,bottom:r.bottom,padding:s.padding,copyHeight:copy.height,icon:icon?.innerHTML,iconBox:i?{width:i.width,height:i.height}:null,background:s.backgroundColor,transform:s.transform};}),shadow:getComputedStyle(card).boxShadow,cardBackground:getComputedStyle(card).backgroundColor,dividers:[...card.querySelectorAll('.group-list-row + .group-list-row')].map(row=>getComputedStyle(row,'::before').borderTopWidth)}));
    assert(layout.rows.every(row=>row.height>=56&&row.height<=58),`group rows use 56px rhythm at ${width}px (${theme}): ${JSON.stringify(layout)}`);const groupGlyphs=await page.locator('.group-list-row .ri svg').evaluateAll(nodes=>nodes.map(icon=>icon.querySelectorAll('circle').length>=2&&!icon.querySelector('rect')));assert(groupGlyphs.every(Boolean),`each row uses a people glyph (${theme})`);assert(layout.dividers.every(border=>border==='1px'),'the grouped surface uses one-pixel inset dividers');assert.equal(layout.shadow,'none','the Groups list has no raised-card shadow');
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Groups list fits ${width}px (${theme})`);await capture(page,`groups-list-${width}-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   console.log('Groups list 390/330 light/dark PASS');return;
  }
  if(GROUP_DETAIL_ONLY){
   for(const theme of ['light','dark'])for(const width of [390,330]){
    let {context,page,errors}=await open(theme,width);await page.goto(base+groupUrl(idDetail));await page.locator('#group-panel-members:visible').waitFor();
    assert.equal(await page.locator('.group-title .eyebrow').count(),0,'the group page drops the private-group eyebrow');assert.equal(await page.locator('.group-title-name svg').count(),1,'the lock sits beside the group title');
    assert.equal(await page.locator('.group-training-for').innerText(),'Training for Alpine weekend');assert.equal(await page.locator('.group-weekly-target').innerText(),'Weekly group target · 64.3 mi / week');
    assert.equal(await page.locator('.group-goal-value').innerText(),'214 mi');assert.equal(await page.locator('.group-goal-label').innerText(),'Together · Distance · of 600 mi · from 3 of 3 sharing');assert.equal(await page.locator('.group-progress').evaluate(el=>getComputedStyle(el).height),'6px');
    assert.equal((await page.locator('[role=tab][aria-selected=true]').innerText()).replace(/\s+/g,' ').trim(),'Members 3');assert.equal(await page.locator('#group-panel-members').getAttribute('aria-labelledby'),'group-tab-members');assert.equal(await page.locator('#group-panel-members h2.vh').count(),0,'tabpanel label comes from its Members tab');assert(await page.locator('[role=tab]').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)),'both tabs keep 44px touch targets');assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);assert.equal(await page.locator('.group-member').count(),3);assert.equal(await page.locator('.group-member-total-only').count(),1);assert.equal(await page.locator('.group-member-total-only').innerText(),'Total only');assert.equal(await page.locator('.group-member-value').count(),2);assert.notEqual(await page.locator('.group-member.is-viewer .group-member-name b').evaluate(el=>getComputedStyle(el).color),await page.locator('.group-member:not(.is-viewer) .group-member-name b').first().evaluate(el=>getComputedStyle(el).color),'the viewer name uses the brand color');
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`Members fits ${width}px (${theme})`);await capture(page,`group-detail-members-${width}-${theme}`,null,{fullPage:false});
    await page.locator('[data-group-tab=updates]').click();assert.equal(await page.locator('[data-group-tab=updates]').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#group-panel-updates').isVisible(),true);assert.equal(await page.locator('#group-panel-members').isVisible(),false);assert.equal(await page.locator('.group-update-empty').innerText(),'No updates yet.');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`empty Updates fits ${width}px (${theme})`);await capture(page,`group-detail-updates-empty-${width}-${theme}`,'.group-content-tabs',{hideChrome:true});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
    ({context,page,errors}=await open(theme,width));await page.goto(base+groupUrl(idUpdates));await page.locator('[data-group-tab=updates]').click();await page.locator('[data-group-update="7001"]').waitFor();assert.equal(await page.locator('[data-group-update]').count(),2);assert.equal(await page.locator('#group-panel-members').isVisible(),false);assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`populated Updates fits ${width}px (${theme})`);await capture(page,`group-detail-updates-${width}-${theme}`,'.group-content-tabs',{hideChrome:true});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   }
   const {context,page,errors}=await open('light',390);await page.goto(base+groupUrl(idEscaped));await page.locator('.group-training-for').waitFor();
   assert.equal(await page.locator('.group-training-for').innerText(),'Training for <img src=x onerror=alert(1)>');assert.equal(await page.locator('.group-training-for img').count(),0,'training text is escaped instead of parsed as markup');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   console.log('Groups detail tabs, privacy, goal and 390/330 light/dark captures PASS');return;
  }
  if(GROUP_UPDATES_ONLY){
   const {context,page,errors,postedUpdates,updatesState}=await open('light');await page.clock.setFixedTime(GROUP_UPDATE_NOW);await page.goto(base+groupUrl(idUpdates));await page.locator('[data-group-tab=updates]').click();await page.locator('.group-updates').waitFor();
   await page.locator('#group-update-text').fill(newUpdateText);await page.locator('.group-update-form button[type=submit]').click();await page.locator('[data-group-update="7003"]').waitFor();
   assert.equal(postedUpdates[0].text,newUpdateText);assert.equal(updatesState().updates[0].created,GROUP_UPDATE_NOW.toISOString(),'the new update returns the shared fixture instant');assert.equal(await page.locator('[data-group-update="7003"] p').innerText(),newUpdateText);
   const expectedTime=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:GROUP_UPDATE_CLOCK.timezone}).format(GROUP_UPDATE_NOW);
   assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .ph-txt small').innerText(),`Today at ${expectedTime}`,'the update timestamp uses the shared fixture instant and timezone');assert.deepEqual(errors,[]);
   await context.close();contexts.splice(contexts.indexOf(context),1);console.log('Group update fixed-clock Today label and post PASS');return;
  }
  for(const theme of ['light','dark']){
   let context,page,errors,postedGroups,postedUpdates,groupPreferences,updatesState,stripPosts,stripState,updateReactionPeopleReads,groupDateChanges,ongoingState;
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
   assert.equal(await page.locator('.feed-groups-more').innerText(),'+1');assert.equal(await page.locator('.feed-groups-more').getAttribute('href'),'/me/groups');
   const moreTitleLayout=await page.locator('.feed-groups-copy b').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth};});assert(moreTitleLayout.height<=moreTitleLayout.lineHeight*1.2&&moreTitleLayout.scrollWidth<=moreTitleLayout.width+1,`short title stays on one line with +1 at 390px (${theme}): ${JSON.stringify(moreTitleLayout)}`);
   const moreStrip=await page.locator('#activity-groups-strip').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,actions:el.querySelectorAll('button').length,more:el.querySelector('.feed-groups-more').getBoundingClientRect().toJSON()}));assert(moreStrip.scrollWidth<=moreStrip.width+1&&moreStrip.actions===0&&moreStrip.more.width>=44&&moreStrip.more.height>=44,`multi-group strip fits with only the separate 44px +N action (${theme}): ${JSON.stringify(moreStrip)}`);
   await capture(page,`activity-groups-plus-one-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'none'));await page.goto(base+'/activity');await waitActivity(page);
   assert.equal(await page.locator('.feed-groups-strip').count(),0,'no strip is shown without an upcoming group');assert.equal(await page.locator('#activity-groups-strip').innerText(),'');
   await capture(page,`activity-groups-none-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'ongoing'));await page.goto(base+'/activity');await waitActivity(page);
   assert.match(await page.locator('.feed-groups-copy b').innerText(),/Fictional trail club · All time/);assert.match(await page.locator('.feed-groups-copy small').innerText(),/You: 12 km of 100 km/);
   assert.equal(await page.locator('.feed-groups-strip').getAttribute('aria-label'),'Group goal','ongoing groups do not present an event countdown');assert.doesNotMatch(await page.locator('.feed-groups-strip').innerText(),/week to go|Event today/);
   await capture(page,`activity-groups-ongoing-390-${theme}`,null,{fullPage:false});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme,390,'none','ongoing'));await page.goto(base+'/me/groups');await page.locator('.group-list-row').waitFor();
   assert.equal(await page.locator('.group-list-row small').innerText(),'You: 12 of 600 mi · All time','the Groups list labels an ongoing personal target');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,postedGroups}=await open(theme));
   await page.goto(base+'/me/friends?find=1');await page.locator('#fr-groups-shortcut').waitFor();await page.waitForFunction(()=>document.querySelector('#fr-groups-count')?.textContent==='0 active groups');
   assert.equal(await page.locator('#fr-groups-discover').getAttribute('href'),'/me/groups');assert.equal(await page.locator('#fr-group-create').getAttribute('href'),'/me/groups?create=1','Create opens the group sheet directly');
   await capture(page,`friends-groups-row-390-${theme}`);await page.locator('#fr-group-create').click();await page.getByLabel('Group name').waitFor();
   assert.equal(new URL(page.url()).pathname,'/me/groups');assert.equal(new URL(page.url()).search,'','the one-time Create query is removed while its sheet is open');
   await page.locator('.group-create-footer [data-close]').click();await page.locator('#group-create-form').waitFor({state:'detached'});
   await page.goto(base+'/me/friends');await page.locator('#fr-groups').waitFor();await page.locator('#fr-groups').click();await page.waitForURL('**/me/groups');
   await page.waitForFunction(()=>App.pageReady&&!!document.querySelector('#group-new'));
   await page.locator('#group-new').click();await page.getByLabel('Group name').waitFor();
   const zone=page.locator('[name=time_zone]');
   assert.equal(await page.locator('#group-create-form').count(),1);assert.equal(await zone.inputValue(),'America/New_York');assert.equal(await zone.isVisible(),false,'the IANA zone picker stays hidden until Change');
   assert.equal(await page.locator('#group-zone-change').innerText(),'Eastern time · Change');assert(!/America\/New_York/.test(await page.locator('#group-create-form').innerText()),'the create sheet shows a friendly zone label');
   assert.match(await page.locator('#group-create-form').innerText(),/Only group members see the group/,'the privacy note stays on the create sheet');
   assert(await page.locator('.group-create-footer button[type=submit]').isVisible(),'Create stays visible in the sheet footer');
    const createDate=page.locator('[name=event_date]'),clearCreateDate=page.locator('#group-create-form [data-group-date-clear]');
    assert.match(await createDate.locator('xpath=..').innerText(),/Event date \(optional\)/);assert.equal(await createDate.inputValue(),'','new groups start without an event date');assert.equal(await clearCreateDate.isVisible(),false,'the clear control stays hidden until a date is entered');
    assert.equal(await page.locator('[name=goal_start_date]').inputValue(),GROUP_UPDATE_TODAY,'goal starts on the selected local day');assert.equal(await page.locator('[name=goal_sports]:checked').count(),9,'all sports are included by default');
   await checkCreateSheet(page,390,16,theme);
    await capture(page,`groups-create-no-date-390-${theme}`);
    const fields=page.locator('.group-create-fields');
    const scrollToSports=()=>fields.evaluate(el=>{const target=el.querySelector('.group-sports-field');el.scrollTop+=target.getBoundingClientRect().top-el.getBoundingClientRect().top;});
    await scrollToSports();await capture(page,`groups-create-goals-390-${theme}`,null,{fullPage:false});await fields.evaluate(el=>{el.scrollTop=0;});
    for(const width of [390,375,330]){await checkCreateSheet(page,width,16,theme);if(width===330){await capture(page,`groups-create-no-date-330-${theme}`);await scrollToSports();await capture(page,`groups-create-goals-330-${theme}`,null,{fullPage:false});await fields.evaluate(el=>{el.scrollTop=0;});}}
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='16px');
    await createDate.fill('2026-11-21');await clearCreateDate.waitFor({state:'visible'});await clearCreateDate.click();assert.equal(await createDate.inputValue(),'');assert.equal(await clearCreateDate.isVisible(),false,'Clear date removes the value and hides itself');
   await page.locator('#group-zone-change').click();await zone.waitFor({state:'visible'});await zone.evaluate(el=>el.blur());await zone.waitFor({state:'hidden'});assert.equal(await page.locator('#group-zone-change').innerText(),'Eastern time · Change','closing the picker without a selection restores the friendly action');
   await page.locator('#group-zone-change').click();await zone.waitFor({state:'visible'});await zone.selectOption('America/Los_Angeles');
   assert.equal(await page.locator('#group-zone-change').innerText(),'Pacific time · Change','the picker returns to a friendly label');assert.equal(await zone.isVisible(),false,'the picker closes after choosing a zone');
    await page.locator('[name=title]').fill('Fictional Alpine Weekend');
    for(const sport of ['run','ride','walk','hike','swim','row','ski','workout','other'])await page.locator(`[name=goal_sports][value="${sport}"]`).uncheck();
    await page.locator('#group-create-form button[type=submit]').click();assert.equal(postedGroups.length,0,'the form does not submit without a selected sport');assert.match(await page.locator('#toast').innerText(),/Choose at least one sport/,'the empty sports choice gets a clear prompt');
    for(const sport of ['run','ride'])await page.locator(`[name=goal_sports][value="${sport}"]`).check();
    await page.locator('[name=training_for]').fill('Half marathon');
   await page.locator('#group-create-form button[type=submit]').click();await page.locator('[data-group-copy]').waitFor();assert.equal(postedGroups.at(-1).time_zone,'America/Los_Angeles','the selected zone is submitted');
    assert.equal(postedGroups.at(-1).event_date,null,'the Create form submits an empty date as null');
    assert.equal(postedGroups.at(-1).goal_start_date,GROUP_UPDATE_TODAY);assert.equal(postedGroups.at(-1).training_for,'Half marathon');assert.deepEqual(postedGroups.at(-1).goal_sports,['run','ride']);
   assert.equal(await page.locator('.group-invite-actions button').count(),2,'The organizer can copy or share the private link');
   await page.keyboard.press('Escape');await context.close();contexts.splice(contexts.indexOf(context),1);

    ({context,page,errors,groupDateChanges,ongoingState}=await open(theme));await page.goto(base+groupUrl(idOngoing));await page.locator('.group-roster').waitFor();
    assert.equal(await page.locator('.group-title-summary').innerText(),'Distance · You: 12 mi');assert.equal(await page.locator('.group-goal-period').innerText(),'All time');
    assert.equal(await page.locator('.group-event-day,.group-recap').count(),0);assert.equal(await page.locator('.group-total-note,.group-member-value').count(),0,'two members do not reveal combined or individual amounts');
    assert.equal(await page.locator('[data-group-update="7010"] p').innerText(),'Fictional trail notes are ready.');
    await capture(page,`groups-ongoing-390-${theme}`);
    await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="recap-consent"]').count(),0,'dateless groups have no recap-consent prompt');
    await page.locator('[data-gact="event-date"]').click();const editDate=page.locator('#group-event-date-form [name=event_date]'),clearEditDate=page.locator('#group-event-date-form [data-group-date-clear]');
    assert.equal(await editDate.inputValue(),'');assert.equal(await clearEditDate.isVisible(),false);assert.match(await page.locator('#group-event-date-form').innerText(),/Clear the date for an ongoing goal/);
    await capture(page,`groups-edit-date-390-${theme}`);await editDate.fill('2026-11-14');
    const addDate=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await addDate).status(),200);
    await page.locator('.group-event-day').waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('.group-goal-period')&&document.querySelector('.group-title-summary')?.textContent.includes('week to go'));
    assert.equal(groupDateChanges.at(-1).event_date,'2026-11-14');assert.equal(await page.locator('[data-group-update="7010"]').count(),1);await page.evaluate(()=>document.querySelector('.toast')?.classList.remove('on'));await capture(page,`groups-dated-390-${theme}`);
    await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="recap-consent"]').count(),1,'adding a date enables recap consent');await page.locator('[data-close]').last().click();
    await page.locator('#group-options').click();await page.locator('[data-gact="event-date"]').click();await editDate.waitFor();await clearEditDate.click();assert.equal(await editDate.inputValue(),'');
    const clearDate=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await clearDate).status(),200);
    await page.locator('.group-goal-period').waitFor();assert.equal(await page.locator('.group-title-summary').innerText(),'Distance · You: 12 mi');assert.equal(await page.locator('[data-group-update="7010"]').count(),1);
    assert.equal(ongoingState().updates[0].reactions.clap,1,'changing the date preserves existing update reactions');assert.equal(await page.locator('.group-recap').count(),0);
    assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
   assert.equal(await page.locator('.group-invite-card h1').innerText(),'You’re invited to a group');assert.equal(await page.locator('#group-accept').innerText(),'Join');assert(!/Fictional Trail Group|fictional_member/.test(await page.locator('.group-invite-card').innerText()));
   await capture(page,`groups-invite-accept-390-${theme}`);await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));
   assert.equal(await page.locator('.group-title h1').innerText(),'Fictional Trail Group');assert.equal(await page.locator('.group-goal-value').innerText(),'12 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-goal-hint').innerText(),'Group totals appear with 3 members');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idEmpty));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),1);assert.equal(await page.locator('.group-goal-value').innerText(),'12 mi');assert.equal(await page.locator('.group-goal-label').innerText(),'Your total · Distance · of 600 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-member-total-only').innerText(),'Total only');assert.equal(await page.locator('.group-total-note').count(),0);assert.equal(await page.locator('.group-weekly-target').count(),0,'small groups do not suggest a misleading personal weekly pace');
   const oneBar=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(oneBar-2)<1,`one-member bar uses only own progress (${theme})`);
   assert.equal(await page.locator('.group-privacy').count(),0,'the shell does not repeat the privacy sentence');assert(!/Only members can see this group/.test(await page.locator('.group-page').innerText()));
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'group shell fits the phone');
   await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="monday-recap"]').count(),0,'groups under three members do not show a recap opt-in');await capture(page,`groups-options-one-member-390-${theme}`,'.scrim');await page.locator('[data-close]').last().click();
   await capture(page,`groups-shell-one-member-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idTwo));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),2);assert.equal(await page.locator('.group-goal-value').innerText(),'12 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-goal-hint').innerText(),'Group totals appear with 3 members');assert.equal(await page.locator('.group-total-note').count(),0);assert.equal(await page.locator('.group-member-total-only').count(),2);assert.equal(await page.locator('.group-weekly-target').count(),0,'two members still do not get a personal weekly pace');
   const twoBar=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(twoBar-2)<1,`two-member bar uses only own progress (${theme})`);
   await capture(page,`groups-shell-two-members-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,stripPosts,stripState}=await open(theme,390,'one'));await page.goto(base+groupUrl(idThree));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),3);assert.equal(await page.locator('.group-goal-value').innerText(),'214 mi');assert.equal(await page.locator('.group-goal-label').innerText(),'Together · Distance · of 600 mi · from 3 of 3 sharing');assert.equal(await page.locator('.group-week').innerText(),'This week · +38 mi · from 3 of 3 sharing');assert.equal(await page.locator('.group-goal-hint').count(),0);
   const threeFill=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(threeFill-214/600*100)<1,`three-member bar uses the combined total (${theme})`);
   assert.equal(await page.locator('.group-member-private-note').count(),0,'fully shared members need no privacy note');assert.equal(await page.locator('.group-member-value').count(),3,'shared amounts appear on member rows');assert.equal(await page.locator('.group-member-total-only').count(),0,'fully shared rows do not repeat privacy labels');
   assert.equal(await page.locator('.group-total-note').count(),0,'no explainer row is shown on Members');assert.equal(await page.locator('.group-member-rank').count(),3,'Members rows show their rank');
   await capture(page,`groups-shell-three-members-390-${theme}`);
   await page.locator('#group-options').click();const muteOption=page.locator('[data-gact="mute-strip"]');assert.equal(await muteOption.innerText(),'Mute Activity strip');await capture(page,`groups-options-mute-390-${theme}`,'.scrim');
   const muteResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/activity-strip')&&r.request().method()==='POST');await muteOption.click();assert.equal((await (await muteResponse).json()).muted,true,'group overflow mutes the Activity strip');assert.equal(stripPosts.at(-1).muted,true);assert.equal(stripState().muted,true);
   await page.goto(base+'/activity');await waitActivity(page);assert.equal(await page.locator('.feed-groups-muted').count(),1,'the overflow action hides the Activity strip');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,postedUpdates,groupPreferences,updatesState,updateReactionPeopleReads}=await open(theme));await page.clock.setFixedTime(GROUP_UPDATE_NOW);await page.goto(base+groupUrl(idUpdates));await page.locator('[data-group-tab=updates]').click();await page.locator('.group-updates').waitFor();
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
   await page.locator('[data-update-options="7001"]').click();assert.equal(await page.locator('[data-update-action="report"]').innerText(),'Report update');assert.equal(await page.locator('[data-update-action="delete"]').count(),0,'only an author or organizer can delete');await page.locator('[data-close]').last().click();
   await page.locator('[data-group-update="7001"] .reaction-more').click();const heart=page.locator('[role="menuitemradio"][data-react="heart"]').last();await heart.waitFor({state:'visible'});const reactionResponse=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reaction')&&r.request().method()==='POST');await heart.click();assert.equal((await reactionResponse).status(),200);
   await page.locator('[data-group-update="7001"] .reaction-count').click();const reactionSheet=page.locator('.reaction-sheet');await reactionSheet.waitFor({state:'visible'});await reactionSheet.locator('.reaction-person').first().waitFor();assert.equal(await reactionSheet.locator('.reaction-person').count(),2,'Group sheet starts with the viewer and another reactor');assert.equal(await reactionSheet.locator('.reaction-remove').count(),1,'the viewer can remove their Group reaction');const readsBeforeRemove=updateReactionPeopleReads(),removeResponse=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reaction')&&r.request().method()==='DELETE'),peopleAfterRemove=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reactions')&&r.request().method()==='GET');await reactionSheet.locator('.reaction-remove').click();assert.deepEqual(await(await removeResponse).json(),{my_reaction:null,reactions:{clap:1}},'Group removal returns the summary without a people list');await peopleAfterRemove;assert.equal(updateReactionPeopleReads(),readsBeforeRemove+1,'the names sheet reloads its people after remove');assert.equal((await reactionSheet.locator('[data-reaction-filter=""]').innerText()).replace(/\s+/g,' ').trim(),'All 1');assert.equal(await reactionSheet.locator('.reaction-person').count(),1,'the remaining reactor stays visible');assert.match(await reactionSheet.locator('.reaction-person').innerText(),/Fictional member/);assert.equal(await reactionSheet.locator('.reaction-remove').count(),0);await page.keyboard.press('Escape');
   const reportButton=page.locator('[data-update-options="7001"]');await reportButton.click();await page.locator('[data-update-action="report"]').click();await page.locator('#group-update-report-form').waitFor();assert.match(await page.locator('#group-update-report-form').innerText(),/aren’t told who sent it/);await page.locator('[data-close]').last().click();
   await page.locator('#group-update-text').fill(newUpdateText);await page.locator('.group-update-form button[type=submit]').click();await page.locator('[data-group-update="7003"]').waitFor();assert.equal(await page.locator('[data-group-tab=updates]').getAttribute('aria-selected'),'true','posting leaves the Updates tab selected');assert.equal(await page.locator('#group-panel-updates').isVisible(),true);assert.equal(postedUpdates[0].text,newUpdateText);assert.equal(updatesState().updates[0].created,GROUP_UPDATE_NOW.toISOString(),'the new update returns the shared fixture instant');assert.equal(await page.locator('[data-group-update="7003"] p').innerText(),newUpdateText);const expectedTime=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:GROUP_UPDATE_CLOCK.timezone}).format(GROUP_UPDATE_NOW);assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .ph-txt small').innerText(),`Today at ${expectedTime}`,'the update timestamp uses the shared fixture instant and timezone');await page.waitForFunction(()=>{const image=document.querySelector('[data-group-update="7003"] .group-update-head .av img');return image?.complete&&image.naturalWidth>0;});assert.equal(await page.locator('[data-group-update="7003"] .group-update-head .av img').count(),1,'the current author photo appears on a newly added update');assert.equal(await page.locator('[data-group-update="7003"] .group-update-badge').count(),0,'an update without achievement metadata has no badge');
   await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="notifications"]').innerText(),'Mute group notifications');assert.equal(await page.locator('[data-gact="recap-consent"]').innerText(),'Include my name in the event recap');assert.match(await page.locator('[data-gact="monday-recap"]').innerText(),/Get Monday recap.*off by default/s);await capture(page,`groups-monday-recap-opt-in-390-${theme}`);
   const mondayResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/monday-recap')&&r.request().method()==='POST');await page.locator('[data-gact="monday-recap"]').click();assert.equal((await mondayResponse).status(),200);assert.deepEqual(groupPreferences.at(-1),{kind:'monday-recap',enabled:true});
   await page.locator('#group-options').click();await page.locator('[data-gact="monday-recap"]').waitFor();assert.match(await page.locator('[data-gact="monday-recap"]').innerText(),/Turn off Monday recap/);
   const muteGroupResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/notifications')&&r.request().method()==='POST');await page.locator('[data-gact="notifications"]').click();assert.equal((await muteGroupResponse).status(),200);assert.deepEqual(groupPreferences.find(item=>item.kind==='notifications'),{kind:'notifications',muted:true});
   await page.locator('#group-options').click();const consentResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/recap-consent')&&r.request().method()==='POST');await page.locator('[data-gact="recap-consent"]').click();assert.equal((await consentResponse).status(),200);assert.equal(updatesState().recap_consent,true);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idEventDay));assert.equal(await page.locator('.group-event-day').innerText(),'Today’s the day');assert.equal(await page.locator('.group-recap').count(),0);await capture(page,`groups-event-day-390-${theme}`,'.group-event-day');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idRecap));await page.locator('.group-recap').waitFor();assert.equal(await page.locator('.group-recap>strong').innerText(),'Together: 214 mi');assert.match(await page.locator('.group-recap-names').innerText(),/@alex · @fictional_friend/);await capture(page,`groups-recap-390-${theme}`,'.group-recap');await page.locator('[data-group-recap-share]').click();await page.locator('[data-group-recap-image]:visible').waitFor();assert.equal(await page.locator('[data-group-recap-send]').isEnabled(),true);await capture(page,`groups-recap-share-390-${theme}`,'.scrim');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idSix));await page.locator('.group-week').first().waitFor();
   assert.equal(await page.locator('.group-week').nth(0).innerText(),'This week · +38 mi · from 4 of 6 sharing');assert.equal(await page.locator('.group-week').nth(1).innerText(),'Last week · 19 mi');await capture(page,`groups-weekly-six-members-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idTen));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),10);assert.equal(await page.locator('.group-week').nth(0).innerText(),'This week · +38 mi · from 4 of 10 sharing');assert.equal(await page.locator('.group-week').nth(1).innerText(),'Last week · 19 mi');assert.equal(await page.locator('.group-member-total-only').count(),10);await capture(page,`groups-roster-ten-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').waitFor();
   assert.equal(await page.locator('.group-member').count(),10);assert.equal(await page.locator('[data-group-more]').innerText(),'+ 40 more');
   await page.locator('[data-group-more]').click();assert.equal(await page.locator('.group-member').count(),50);assert.equal(await page.locator('[data-group-more]').count(),0);
   const weeklyReactionTarget=await page.locator('.group-week-cheer .reaction-more').boundingBox();assert(weeklyReactionTarget&&weeklyReactionTarget.width>=44&&weeklyReactionTarget.height>=44,`weekly reaction action keeps a 44px target (${theme}): ${JSON.stringify(weeklyReactionTarget)}`);
   assert.equal(await page.locator('.group-member-total-only').count(),50,'every hidden amount is labelled without disclosure');
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster fits the phone');
   await page.evaluate(()=>window.scrollTo(0,0));await capture(page,`groups-roster-full-390-${theme}`,'.group-roster',{hideChrome:true});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   console.log(`Groups ${theme}: create, generic invite/accept, empty and full roster states pass`);
  }
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330,'one');await page.goto(base+'/activity');await waitActivity(page);const title=page.locator('.feed-groups-copy b');assert.match(await title.innerText(),/Fictional Trail Group · 31 wk to go/);
   const layout=await title.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace};});assert(layout.height>=layout.lineHeight*0.9&&layout.scrollWidth<=layout.width+1&&layout.scrollHeight<=Math.ceil(layout.height)+1,`Activity title wraps cleanly at 330px (${theme}): ${JSON.stringify(layout)}`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');await capture(page,`activity-groups-one-330-${theme}`,null,{fullPage:false});await context.close();contexts.splice(contexts.indexOf(context),1);
   const ongoing=await open(theme,330);await ongoing.page.goto(base+groupUrl(idOngoing));await ongoing.page.locator('.group-roster').waitFor();assert(!(await ongoing.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'ongoing group fits at 330px');await capture(ongoing.page,`groups-ongoing-330-${theme}`);
   await ongoing.page.locator('#group-options').click();await ongoing.page.locator('[data-gact="event-date"]').click();await ongoing.page.locator('#group-event-date-form [name=event_date]').fill('2026-11-14');const add=ongoing.page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await ongoing.page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await add).status(),200);await ongoing.page.waitForFunction(()=>!document.querySelector('.group-goal-period')&&document.querySelector('.group-title-summary')?.textContent.includes('week to go'));assert(!(await ongoing.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'dated group fits at 330px');await ongoing.page.evaluate(()=>document.querySelector('.toast')?.classList.remove('on'));await capture(ongoing.page,`groups-dated-330-${theme}`);assert.deepEqual(ongoing.errors,[]);await ongoing.context.close();contexts.splice(contexts.indexOf(ongoing.context),1);
  }
  const {context,page}=await open('light',330);await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').click();assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster has no horizontal overflow at 330px');await context.close();contexts.splice(contexts.indexOf(context),1);
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330);await page.goto(base+groupUrl(idLongGoal));const goal=page.locator('.group-goal-label');
   assert.equal(await page.locator('.group-goal-value').innerText(),'214 sessions per scheduled strength training block');assert.equal(await goal.innerText(),'Together · Sessions · of 600 sessions per scheduled strength training block · from 3 of 3 sharing');
   const layout=await goal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(layout.height>=layout.lineHeight*1.8,`long-unit goal wraps at 330px (${theme}): ${JSON.stringify(layout)}`);assert(layout.scrollWidth<=layout.width+1,`long-unit goal is not clipped horizontally (${theme})`);assert(layout.scrollHeight<=Math.ceil(layout.height)+1,`long-unit goal is not clipped vertically (${theme})`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');
   await capture(page,`groups-goal-long-units-330-${theme}`,'.group-goal');await context.close();contexts.splice(contexts.indexOf(context),1);

   const {context:ownContext,page:ownPage}=await open(theme,330);await ownPage.goto(base+groupUrl(idLongOwnGoal));const ownGoal=ownPage.locator('.group-goal-label');
   assert.equal(await ownPage.locator('.group-goal-value').innerText(),'214 sessions per scheduled strength training block');assert.equal(await ownGoal.innerText(),'Your total · Sessions · of 600 sessions per scheduled strength training block');
   const ownLayout=await ownGoal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(ownLayout.height>=ownLayout.lineHeight*1.8,`own-only long-unit goal wraps at 330px (${theme}): ${JSON.stringify(ownLayout)}`);assert(ownLayout.scrollWidth<=ownLayout.width+1,`own-only long-unit goal is not clipped horizontally (${theme})`);assert(ownLayout.scrollHeight<=Math.ceil(ownLayout.height)+1,`own-only long-unit goal is not clipped vertically (${theme})`);assert.notEqual(ownLayout.textOverflow,'ellipsis');assert.equal(ownLayout.whiteSpace,'normal');
   await capture(ownPage,`groups-goal-own-long-units-330-${theme}`,'.group-goal');await ownContext.close();contexts.splice(contexts.indexOf(ownContext),1);
  }
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
