// Fictional group fixtures. Captures group progress, Activity strip, updates, event day, recap and roster states.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',shots=process.env.KINETTA_SHOTS;
const token='0123456789abcdef0123456789abcdef',idEmpty='00000000-0000-4000-8000-000000000001',idTwo='00000000-0000-4000-8000-000000000002',idThree='00000000-0000-4000-8000-000000000004',idFull='00000000-0000-4000-8000-000000000050',idLongGoal='00000000-0000-4000-8000-000000000003',idLongOwnGoal='00000000-0000-4000-8000-000000000005',idSix='00000000-0000-4000-8000-000000000006',idTen='00000000-0000-4000-8000-000000000010';
const idUpdates='00000000-0000-4000-8000-000000000011',idEventDay='00000000-0000-4000-8000-000000000012',idRecap='00000000-0000-4000-8000-000000000013',idOngoing='00000000-0000-4000-8000-000000000014';
const empty={id:idEmpty,title:'Dolomites hike',event_date:'2026-11-14',time_zone:'America/New_York',note:'Fictional event weekend',goal_type:'distance',goal_target:600,goal_unit:'mi',your_total:12,your_this_week_total:12,days_to_event:7,weeks_to_event:1,event_state:'upcoming',weekly_reaction:{my_reaction:null,reactions:{}},updates:[],recap_consent:false,notifications_muted:false,members:[{username:'alex',organizer:true,sharing_total_only:true}],member_count:1,is_organizer:true,joining_closed:false,closed:false};
const two={...empty,id:idTwo,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}],member_count:2};
const three={...empty,id:idThree,total:214,this_week_total:38,this_week_contributors:3,members:[{username:'alex',organizer:true,value:12},{username:'fictional_friend',organizer:false,value:38},{username:'fictional_member',organizer:false,value:164}],member_count:3};delete three.your_total;delete three.your_this_week_total;
const full={...three,id:idFull,members:Array.from({length:50},(_,i)=>({username:`fictional_member_${String(i+1).padStart(2,'0')}`,organizer:i===0,sharing_total_only:true})),member_count:50};
const longGoal={...three,id:idLongGoal,goal_type:'sessions',goal_target:600,goal_unit:'sessions'};
const longOwnGoal={...empty,id:idLongOwnGoal,goal_type:'sessions',goal_target:600,goal_unit:'sessions',your_total:214};
const six={...three,id:idSix,members:Array.from({length:6},(_,i)=>({username:i?'fictional_member_'+i:'alex',organizer:i===0,sharing_total_only:true})),member_count:6,this_week_contributors:4};
const ten={...six,id:idTen,members:Array.from({length:10},(_,i)=>({username:i?'fictional_member_'+i:'alex',organizer:i===0,sharing_total_only:true})),member_count:10};
const updatesGroup={...three,id:idUpdates,updates:[
 {id:7001,username:'fictional_friend',name:'Fictional friend',photo:false,text:'Water stop is set for the trailhead.',created:'2026-11-07T11:40:00Z',can_delete:false,can_report:true,my_reaction:null,reactions:{}},
 {id:7002,username:'fictional_member',name:'Fictional member',photo:false,text:'I’ll bring the printed route notes.',created:'2026-11-07T11:20:00Z',can_delete:false,can_report:true,my_reaction:'clap',reactions:{clap:1}}
]};
const eventDay={...empty,id:idEventDay,event_state:'today',days_to_event:0,weeks_to_event:0,event_date:'2026-11-07'};
const recapGroup={...three,id:idRecap,event_state:'complete',days_to_event:0,weeks_to_event:0,event_date:'2026-11-02',recap:{event_date:'2026-11-02',total:214,participants:['alex','fictional_friend']},updates:[]};
const ongoingGroup={...empty,id:idOngoing,event_date:null,event_state:'ongoing',days_to_event:null,weeks_to_event:null,your_total:12,your_this_week_total:12,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}],member_count:2,updates:[{id:7010,username:'fictional_friend',name:'Fictional friend',photo:false,text:'Fictional trail notes are ready.',created:'2026-11-07T11:40:00Z',can_delete:false,can_report:true,my_reaction:null,reactions:{clap:1}}]};
const stripGroup={id:idThree,title:'Dolomites hike',event_date:'2026-12-14',time_zone:'America/New_York',goal_target:600,goal_unit:'mi',total:214,member_count:6,days_to_event:217,weeks_to_event:31};
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
 async function open(theme,width=390,stripState='none'){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'});contexts.push(context);
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200,'isolated demo account login');
  const postedGroups=[],postedUpdates=[],groupPreferences=[],stripPosts=[],groupDateChanges=[];let stripData={...stripFixtures[stripState]},updatesState={...updatesGroup,updates:updatesGroup.updates.map(row=>({...row}))},ongoingState={...ongoingGroup,updates:ongoingGroup.updates.map(row=>({...row}))};
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method(),p=url.pathname;
   if(p==='/api/groups/activity-strip'&&method==='GET')return route.fulfill({json:stripData});
   if(p==='/api/groups/activity-strip'&&method==='POST'){stripPosts.push(req.postDataJSON());stripData={...stripData,muted:req.postDataJSON().muted};return route.fulfill({json:{muted:stripData.muted}});}
   if(p==='/api/groups'&&method==='GET')return route.fulfill({json:[]});
   if(p==='/api/groups'&&method==='POST'){const body=req.postDataJSON();postedGroups.push(body);const group=body.event_date===null?ongoingGroup:empty;return route.fulfill({json:{...group,invite_url:`https://example.test/group-invite/${token}`}});}
   if(p===`/api/group-invites/${token}`&&method==='GET')return route.fulfill({json:{available:true}});
   if(p===`/api/group-invites/${token}/accept`&&method==='POST')return route.fulfill({json:{...two,id:idEmpty}});
   if(p===`/api/groups/${idEmpty}`&&method==='GET')return route.fulfill({json:empty});
   if(p===`/api/groups/${idTwo}`&&method==='GET')return route.fulfill({json:two});
   if(p===`/api/groups/${idThree}`&&method==='GET')return route.fulfill({json:three});
   if(p===`/api/groups/${idFull}`&&method==='GET')return route.fulfill({json:full});
   if(p===`/api/groups/${idLongGoal}`&&method==='GET')return route.fulfill({json:longGoal});
   if(p===`/api/groups/${idLongOwnGoal}`&&method==='GET')return route.fulfill({json:longOwnGoal});
   if(p===`/api/groups/${idSix}`&&method==='GET')return route.fulfill({json:six});
   if(p===`/api/groups/${idTen}`&&method==='GET')return route.fulfill({json:ten});
   if(p===`/api/groups/${idUpdates}`&&method==='GET')return route.fulfill({json:updatesState});
   if(p===`/api/groups/${idEventDay}`&&method==='GET')return route.fulfill({json:eventDay});
   if(p===`/api/groups/${idRecap}`&&method==='GET')return route.fulfill({json:recapGroup});
   if(p===`/api/groups/${idUpdates}/updates`&&method==='POST'){
    const body=req.postDataJSON(),row={id:7003,username:'alex',name:'Alex Rivera',photo:false,text:body.text,created:new Date().toISOString(),can_delete:true,can_report:false,my_reaction:null,reactions:{}};
    postedUpdates.push(body);updatesState.updates.unshift(row);return route.fulfill({json:row});
   }
   if(p===`/api/groups/${idUpdates}/updates/7001/reaction`&&method==='POST')return route.fulfill({json:{my_reaction:'heart',reactions:{clap:1,heart:1}}});
   if(p===`/api/groups/${idUpdates}/updates/7001/reactions`&&method==='GET')return route.fulfill({json:{cheers:[{login:'fictional_member',name:'Fictional member',photo:false,kind:'clap'}]}});
   if(p===`/api/groups/${idUpdates}/notifications`&&method==='POST'){groupPreferences.push({kind:'notifications',...req.postDataJSON()});updatesState.notifications_muted=req.postDataJSON().muted;return route.fulfill({json:{muted:updatesState.notifications_muted}});}
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
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  return{context,page,errors,postedGroups,postedUpdates,groupPreferences,stripPosts,stripState:()=>stripData,updatesState:()=>updatesState,groupDateChanges,ongoingState:()=>ongoingState};
 }
 try{
  for(const theme of ['light','dark']){
   let context,page,errors,postedGroups,postedUpdates,groupPreferences,updatesState,stripPosts,stripState;
   ({context,page,errors}=await open(theme,390,'one'));await page.goto(base+'/activity');await waitActivity(page);
   assert.match(await page.locator('#activity-groups-strip').innerText(),/Dolomites hike · 31 wk to go/);assert.doesNotMatch(await page.locator('#activity-groups-strip').innerText(),/Dec 14/);assert.match(await page.locator('#activity-groups-strip').innerText(),/Together: 214 mi of 600 mi/);
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
   await checkCreateSheet(page,390,16,theme);
    await capture(page,`groups-create-no-date-390-${theme}`);
    for(const width of [390,375,330]){await checkCreateSheet(page,width,16,theme);if(width===330)await capture(page,`groups-create-no-date-330-${theme}`);}
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='16px');
    await createDate.fill('2026-11-21');await clearCreateDate.waitFor({state:'visible'});await clearCreateDate.click();assert.equal(await createDate.inputValue(),'');assert.equal(await clearCreateDate.isVisible(),false,'Clear date removes the value and hides itself');
   await page.locator('#group-zone-change').click();await zone.waitFor({state:'visible'});await zone.evaluate(el=>el.blur());await zone.waitFor({state:'hidden'});assert.equal(await page.locator('#group-zone-change').innerText(),'Eastern time · Change','closing the picker without a selection restores the friendly action');
   await page.locator('#group-zone-change').click();await zone.waitFor({state:'visible'});await zone.selectOption('America/Los_Angeles');
   assert.equal(await page.locator('#group-zone-change').innerText(),'Pacific time · Change','the picker returns to a friendly label');assert.equal(await zone.isVisible(),false,'the picker closes after choosing a zone');
    await page.locator('[name=title]').fill('Fictional Alpine Weekend');
   await page.locator('#group-create-form button[type=submit]').click();await page.locator('[data-group-copy]').waitFor();assert.equal(postedGroups.at(-1).time_zone,'America/Los_Angeles','the selected zone is submitted');
    assert.equal(postedGroups.at(-1).event_date,null,'the Create form submits an empty date as null');
   assert.equal(await page.locator('.group-invite-actions button').count(),2,'The organizer can copy or share the private link');
   await page.keyboard.press('Escape');await context.close();contexts.splice(contexts.indexOf(context),1);

    ({context,page,errors,groupDateChanges,ongoingState}=await open(theme));await page.goto(base+groupUrl(idOngoing));await page.locator('.group-roster').waitFor();
    assert.equal(await page.locator('.group-title>p:nth-of-type(2)').innerText(),'Distance · You: 12 mi');assert.equal(await page.locator('.group-goal-period').innerText(),'All time');
    assert.equal(await page.locator('.group-event-day,.group-recap').count(),0);assert.equal(await page.locator('.group-total-note,.group-member-value').count(),0,'two members do not reveal combined or individual amounts');
    assert.equal(await page.locator('[data-group-update="7010"] p').innerText(),'Fictional trail notes are ready.');
    await capture(page,`groups-ongoing-390-${theme}`);
    await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="recap-consent"]').count(),0,'dateless groups have no recap-consent prompt');
    await page.locator('[data-gact="event-date"]').click();const editDate=page.locator('#group-event-date-form [name=event_date]'),clearEditDate=page.locator('#group-event-date-form [data-group-date-clear]');
    assert.equal(await editDate.inputValue(),'');assert.equal(await clearEditDate.isVisible(),false);assert.match(await page.locator('#group-event-date-form').innerText(),/Clear the date for an ongoing goal/);
    await capture(page,`groups-edit-date-390-${theme}`);await editDate.fill('2026-11-14');
    const addDate=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await addDate).status(),200);
    await page.locator('.group-event-day').waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('.group-goal-period')&&document.querySelector('.group-title>p:nth-of-type(2)')?.textContent.includes('week to go'));
    assert.equal(groupDateChanges.at(-1).event_date,'2026-11-14');assert.equal(await page.locator('[data-group-update="7010"]').count(),1);await capture(page,`groups-dated-390-${theme}`);
    await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="recap-consent"]').count(),1,'adding a date enables recap consent');await page.locator('[data-close]').last().click();
    await page.locator('#group-options').click();await page.locator('[data-gact="event-date"]').click();await editDate.waitFor();await clearEditDate.click();assert.equal(await editDate.inputValue(),'');
    const clearDate=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await clearDate).status(),200);
    await page.locator('.group-goal-period').waitFor();assert.equal(await page.locator('.group-title>p:nth-of-type(2)').innerText(),'Distance · You: 12 mi');assert.equal(await page.locator('[data-group-update="7010"]').count(),1);
    assert.equal(ongoingState().updates[0].reactions.clap,1,'changing the date preserves existing update reactions');assert.equal(await page.locator('.group-recap').count(),0);
    assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
   assert.match(await page.locator('.group-invite-card').innerText(),/You’re invited to a private group/);assert(!/Dolomites|fictional_member/.test(await page.locator('.group-invite-card').innerText()));
   await capture(page,`groups-invite-accept-390-${theme}`);await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));
   assert.equal(await page.locator('.group-title h1').innerText(),'Dolomites hike');assert.equal(await page.locator('.group-goal>strong').innerText(),'You: 12 mi of 600 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-goal-hint').innerText(),'Group totals appear with 3 members');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idEmpty));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),1);assert.equal(await page.locator('.group-goal>strong').innerText(),'You: 12 mi of 600 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-member-private-note').innerText(),'Some members keep their amount private');assert.equal(await page.locator('.group-total-note').count(),0);assert.equal(await page.locator('.group-member').filter({hasText:'Sharing total only'}).count(),0);
   const oneBar=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(oneBar-2)<1,`one-member bar uses only own progress (${theme})`);
   assert.equal(await page.locator('.group-privacy').count(),0,'the shell does not repeat the privacy sentence');assert(!/Only members can see this group/.test(await page.locator('.group-page').innerText()));
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'group shell fits the phone');
   await capture(page,`groups-shell-one-member-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idTwo));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),2);assert.equal(await page.locator('.group-goal>strong').innerText(),'You: 12 mi of 600 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · You: 12 mi');assert.equal(await page.locator('.group-goal-hint').innerText(),'Group totals appear with 3 members');assert.equal(await page.locator('.group-total-note').count(),0);assert.equal(await page.locator('.group-member-private-note').innerText(),'Some members keep their amount private');
   const twoBar=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(twoBar-2)<1,`two-member bar uses only own progress (${theme})`);
   await capture(page,`groups-shell-two-members-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,stripPosts,stripState}=await open(theme,390,'one'));await page.goto(base+groupUrl(idThree));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),3);assert.equal(await page.locator('.group-goal>strong').innerText(),'Together: 214 mi of 600 mi');assert.equal(await page.locator('.group-week').innerText(),'This week · +38 mi from 3 of 3 people');assert.equal(await page.locator('.group-goal-hint').count(),0);
   const threeFill=await page.locator('.group-progress').evaluate(el=>el.value/el.max*100);assert(Math.abs(threeFill-214/600*100)<1,`three-member bar uses the combined total (${theme})`);
   assert.equal(await page.locator('.group-member-private-note').count(),0,'fully shared members need no privacy note');assert.equal(await page.locator('.group-member-value').count(),3,'shared amounts appear on member rows');assert.equal(await page.locator('.group-member').filter({hasText:'Sharing total only'}).count(),0,'rows do not repeat sharing labels');
   assert.equal(await page.locator('.group-total-note').innerText(),'Your activity counts toward group totals.');
   await capture(page,`groups-shell-three-members-390-${theme}`);
   await page.locator('#group-options').click();const muteOption=page.locator('[data-gact="mute-strip"]');assert.equal(await muteOption.innerText(),'Mute Activity strip');await capture(page,`groups-options-mute-390-${theme}`,'.scrim');
   const muteResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/activity-strip')&&r.request().method()==='POST');await muteOption.click();assert.equal((await (await muteResponse).json()).muted,true,'group overflow mutes the Activity strip');assert.equal(stripPosts.at(-1).muted,true);assert.equal(stripState().muted,true);
   await page.goto(base+'/activity');await waitActivity(page);assert.equal(await page.locator('.feed-groups-muted').count(),1,'the overflow action hides the Activity strip');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors,postedUpdates,groupPreferences,updatesState}=await open(theme));await page.goto(base+groupUrl(idUpdates));await page.locator('.group-updates').waitFor();
   assert.deepEqual(await page.locator('[data-group-update]').evaluateAll(nodes=>nodes.map(node=>node.dataset.groupUpdate)),['7001','7002'],'updates are newest first');
   assert.equal(await page.locator('#group-update-text').getAttribute('maxlength'),'200');assert.equal(await page.locator('[data-group-recap-image]').count(),0,'recap art is not prepared until the person taps Share');
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'update page fits the phone');
   await page.evaluate(()=>{const r=document.querySelector('.group-updates').getBoundingClientRect();window.scrollTo(0,r.top+scrollY-130);});await capture(page,`groups-updates-390-${theme}`,'.group-updates');
   await page.locator('[data-update-options="7001"]').click();assert.equal(await page.locator('[data-update-action="report"]').innerText(),'Report update');assert.equal(await page.locator('[data-update-action="delete"]').count(),0,'only an author or organizer can delete');await page.locator('[data-close]').last().click();
   await page.locator('[data-group-update="7001"] .reaction-more').click();const heart=page.locator('[role="menuitemradio"][data-react="heart"]').last();await heart.waitFor({state:'visible'});const reactionResponse=page.waitForResponse(r=>r.url().endsWith('/updates/7001/reaction')&&r.request().method()==='POST');await heart.click();assert.equal((await reactionResponse).status(),200);
   const reportButton=page.locator('[data-update-options="7001"]');await reportButton.click();await page.locator('[data-update-action="report"]').click();await page.locator('#group-update-report-form').waitFor();assert.match(await page.locator('#group-update-report-form').innerText(),/aren’t told who sent it/);await page.locator('[data-close]').last().click();
   await page.locator('#group-update-text').fill('Alex has the trail notes.');await page.locator('.group-update-form button[type=submit]').click();await page.locator('[data-group-update="7003"]').waitFor();assert.equal(postedUpdates[0].text,'Alex has the trail notes.');assert.equal(await page.locator('[data-group-update="7003"] p').innerText(),'Alex has the trail notes.');
   await page.locator('#group-options').click();assert.equal(await page.locator('[data-gact="notifications"]').innerText(),'Mute group notifications');assert.equal(await page.locator('[data-gact="recap-consent"]').innerText(),'Include my name in the event recap');
   const muteGroupResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/notifications')&&r.request().method()==='POST');await page.locator('[data-gact="notifications"]').click();assert.equal((await muteGroupResponse).status(),200);assert.deepEqual(groupPreferences[0],{kind:'notifications',muted:true});
   await page.locator('#group-options').click();const consentResponse=page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idUpdates+'/recap-consent')&&r.request().method()==='POST');await page.locator('[data-gact="recap-consent"]').click();assert.equal((await consentResponse).status(),200);assert.equal(updatesState().recap_consent,true);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idEventDay));assert.equal(await page.locator('.group-event-day').innerText(),'Today’s the day');assert.equal(await page.locator('.group-recap').count(),0);await capture(page,`groups-event-day-390-${theme}`,'.group-event-day');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idRecap));await page.locator('.group-recap').waitFor();assert.equal(await page.locator('.group-recap>strong').innerText(),'Together: 214 mi');assert.match(await page.locator('.group-recap-names').innerText(),/@alex · @fictional_friend/);await capture(page,`groups-recap-390-${theme}`,'.group-recap');await page.locator('[data-group-recap-share]').click();await page.locator('[data-group-recap-image]:visible').waitFor();assert.equal(await page.locator('[data-group-recap-send]').isEnabled(),true);await capture(page,`groups-recap-share-390-${theme}`,'.scrim');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idSix));await page.locator('.group-week').waitFor();
   assert.equal(await page.locator('.group-week').innerText(),'This week · +38 mi from 4 of 6 people');await capture(page,`groups-weekly-six-members-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idTen));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),10);assert.equal(await page.locator('.group-week').innerText(),'This week · +38 mi from 4 of 10 people');assert.equal(await page.locator('.group-member-private-note').count(),1);await capture(page,`groups-roster-ten-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').waitFor();
   assert.equal(await page.locator('.group-member').count(),10);assert.equal(await page.locator('[data-group-more]').innerText(),'+ 40 more');
   await page.locator('[data-group-more]').click();assert.equal(await page.locator('.group-member').count(),50);assert.equal(await page.locator('[data-group-more]').count(),0);
   assert.equal(await page.locator('.group-member').filter({hasText:'Sharing total only'}).count(),0,'private amounts are not repeated on roster rows');assert.equal(await page.locator('.group-member-private-note').count(),1,'one quiet note explains private amounts');
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster fits the phone');
   await page.evaluate(()=>window.scrollTo(0,0));await capture(page,`groups-roster-full-390-${theme}`,'.group-roster',{hideChrome:true});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   console.log(`Groups ${theme}: create, generic invite/accept, empty and full roster states pass`);
  }
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330,'one');await page.goto(base+'/activity');await waitActivity(page);const title=page.locator('.feed-groups-copy b');assert.match(await title.innerText(),/Dolomites hike · 31 wk to go/);
   const layout=await title.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{height:r.height,lineHeight:parseFloat(s.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:s.textOverflow,whiteSpace:s.whiteSpace};});assert(layout.height>=layout.lineHeight*0.9&&layout.scrollWidth<=layout.width+1&&layout.scrollHeight<=Math.ceil(layout.height)+1,`Activity title wraps cleanly at 330px (${theme}): ${JSON.stringify(layout)}`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');await capture(page,`activity-groups-one-330-${theme}`,null,{fullPage:false});await context.close();contexts.splice(contexts.indexOf(context),1);
   const ongoing=await open(theme,330);await ongoing.page.goto(base+groupUrl(idOngoing));await ongoing.page.locator('.group-roster').waitFor();assert(!(await ongoing.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'ongoing group fits at 330px');await capture(ongoing.page,`groups-ongoing-330-${theme}`);
   await ongoing.page.locator('#group-options').click();await ongoing.page.locator('[data-gact="event-date"]').click();await ongoing.page.locator('#group-event-date-form [name=event_date]').fill('2026-11-14');const add=ongoing.page.waitForResponse(r=>r.url().endsWith('/api/groups/'+idOngoing+'/event-date')&&r.request().method()==='PATCH');await ongoing.page.locator('#group-event-date-form button[type=submit]').click();assert.equal((await add).status(),200);await ongoing.page.waitForFunction(()=>!document.querySelector('.group-goal-period')&&document.querySelector('.group-title>p:nth-of-type(2)')?.textContent.includes('week to go'));assert(!(await ongoing.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'dated group fits at 330px');await capture(ongoing.page,`groups-dated-330-${theme}`);assert.deepEqual(ongoing.errors,[]);await ongoing.context.close();contexts.splice(contexts.indexOf(ongoing.context),1);
  }
  const {context,page}=await open('light',330);await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').click();assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster has no horizontal overflow at 330px');await context.close();contexts.splice(contexts.indexOf(context),1);
  for(const theme of ['light','dark']){
   const {context,page}=await open(theme,330);await page.goto(base+groupUrl(idLongGoal));const goal=page.locator('.group-goal>strong');
   assert.equal(await goal.innerText(),'Together: 214 sessions of 600 sessions');
   const layout=await goal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(layout.height>=layout.lineHeight*1.8,`long-unit goal wraps at 330px (${theme})`);assert(layout.scrollWidth<=layout.width+1,`long-unit goal is not clipped horizontally (${theme})`);assert(layout.scrollHeight<=Math.ceil(layout.height)+1,`long-unit goal is not clipped vertically (${theme})`);assert.notEqual(layout.textOverflow,'ellipsis');assert.equal(layout.whiteSpace,'normal');
   await capture(page,`groups-goal-long-units-330-${theme}`,'.group-goal');await context.close();contexts.splice(contexts.indexOf(context),1);

   const {context:ownContext,page:ownPage}=await open(theme,330);await ownPage.goto(base+groupUrl(idLongOwnGoal));const ownGoal=ownPage.locator('.group-goal>strong');
   assert.equal(await ownGoal.innerText(),'You: 214 sessions of 600 sessions');
   const ownLayout=await ownGoal.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return{height:rect.height,lineHeight:parseFloat(style.lineHeight),width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace};});
   assert(ownLayout.height>=ownLayout.lineHeight*1.8,`own-only long-unit goal wraps at 330px (${theme}): ${JSON.stringify(ownLayout)}`);assert(ownLayout.scrollWidth<=ownLayout.width+1,`own-only long-unit goal is not clipped horizontally (${theme})`);assert(ownLayout.scrollHeight<=Math.ceil(ownLayout.height)+1,`own-only long-unit goal is not clipped vertically (${theme})`);assert.notEqual(ownLayout.textOverflow,'ellipsis');assert.equal(ownLayout.whiteSpace,'normal');
   await capture(ownPage,`groups-goal-own-long-units-330-${theme}`,'.group-goal');await ownContext.close();contexts.splice(contexts.indexOf(ownContext),1);
  }
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
