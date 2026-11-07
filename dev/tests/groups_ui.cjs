// Fictional group fixtures. Captures the create, explicit invite, empty and full roster states.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',shots=process.env.KINETTA_SHOTS;
const token='0123456789abcdef0123456789abcdef',idEmpty='00000000-0000-4000-8000-000000000001',idFull='00000000-0000-4000-8000-000000000050';
const empty={id:idEmpty,title:'Dolomites hike',event_date:'2026-11-14',time_zone:'America/New_York',note:'Fictional event weekend',goal_type:'distance',goal_target:600,goal_unit:'mi',total:214,days_to_event:7,members:[{username:'alex',organizer:true,sharing_total_only:true}],member_count:1,is_organizer:true,joining_closed:false,closed:false};
const full={...empty,id:idFull,members:Array.from({length:50},(_,i)=>({username:`fictional_member_${String(i+1).padStart(2,'0')}`,organizer:i===0,sharing_total_only:true})),member_count:50};
const groupUrl=id=>`/groups/${id}`;
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;const a=[...document.querySelectorAll('.scrim,.sheet')].flatMap(x=>x.getAnimations());await Promise.all(a.map(x=>x.finished.catch(()=>{})));});}
async function capture(page,name,selector,{hideChrome=false}={}){
 if(!shots)return;await settle(page);fs.mkdirSync(shots,{recursive:true});const file=path.join(shots,name+'.png');
 if(hideChrome)await page.evaluate(()=>document.querySelectorAll('.group-top,nav.tabs').forEach(node=>{node.dataset.captureVisibility=node.style.visibility;node.style.visibility='hidden';}));
 try{if(selector)await page.locator(selector).screenshot({path:file});else await page.screenshot({path:file,fullPage:true});}
 finally{if(hideChrome)await page.evaluate(()=>document.querySelectorAll('[data-capture-visibility]').forEach(node=>{node.style.visibility=node.dataset.captureVisibility;delete node.dataset.captureVisibility;}));}
}
(async()=>{
 const browser=await chromium.launch(),contexts=[];
 async function open(theme,width=390){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'});contexts.push(context);
  const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200,'isolated demo account login');
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method(),p=url.pathname;
   if(p==='/api/groups'&&method==='GET')return route.fulfill({json:[]});
   if(p==='/api/groups'&&method==='POST')return route.fulfill({json:{...empty,invite_url:`https://example.test/group-invite/${token}`}});
   if(p===`/api/group-invites/${token}`&&method==='GET')return route.fulfill({json:{available:true}});
   if(p===`/api/group-invites/${token}/accept`&&method==='POST')return route.fulfill({json:{...empty,member_count:2,members:[...empty.members,{username:'fictional_friend',organizer:false,sharing_total_only:true}]}});
   if(p===`/api/groups/${idEmpty}`&&method==='GET')return route.fulfill({json:empty});
   if(p===`/api/groups/${idFull}`&&method==='GET')return route.fulfill({json:full});
   if(p.startsWith('/api/groups/')&&method==='POST')return route.fulfill({json:{ok:true,invite_url:`https://example.test/group-invite/${token}`}});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  return{context,page,errors};
 }
 try{
  for(const theme of ['light','dark']){
   let {context,page,errors}=await open(theme);
   await page.goto(base+'/me/friends');await page.locator('#fr-groups').waitFor();await page.locator('#fr-groups').click();await page.waitForURL('**/me/groups');
   await page.waitForFunction(()=>App.pageReady&&!!document.querySelector('#group-new'));
   await page.locator('#group-new').click();await page.getByLabel('Group name').waitFor();
   assert.equal(await page.locator('#group-create-form').count(),1);assert.equal(await page.locator('[name=time_zone]').inputValue(),'America/New_York');
   assert(await page.locator('.group-create-footer button[type=submit]').isVisible(),'Create stays visible in the sheet footer');
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'create sheet fits the phone');
   await capture(page,`groups-create-390-${theme}`);
   await page.locator('[name=title]').fill('Fictional Alpine Weekend');await page.locator('[name=event_date]').fill('2026-11-21');
   await page.locator('#group-create-form button[type=submit]').click();await page.locator('[data-group-copy]').waitFor();
   assert.equal(await page.locator('.group-invite-actions button').count(),2,'The organizer can copy or share the private link');
   await page.keyboard.press('Escape');await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+`/group-invite/${token}`);await page.locator('#group-accept').waitFor();
   assert.match(await page.locator('.group-invite-card').innerText(),/You’re invited to a private group/);assert(!/Dolomites|fictional_member/.test(await page.locator('.group-invite-card').innerText()));
   await capture(page,`groups-invite-accept-390-${theme}`);await page.locator('#group-accept').click();await page.waitForURL('**'+groupUrl(idEmpty));
   assert.equal(await page.locator('.group-title h1').innerText(),'Dolomites hike');assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idEmpty));await page.locator('.group-roster').waitFor();
   assert.equal(await page.locator('.group-member').count(),1);assert.match(await page.locator('.group-page').innerText(),/Together: 214 mi of 600 mi/);
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'group shell fits the phone');
   await capture(page,`groups-shell-empty-roster-390-${theme}`);assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);

   ({context,page,errors}=await open(theme));await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').waitFor();
   assert.equal(await page.locator('.group-member').count(),10);assert.equal(await page.locator('[data-group-more]').innerText(),'+ 40 more');
   await page.locator('[data-group-more]').click();assert.equal(await page.locator('.group-member').count(),50);assert.equal(await page.locator('[data-group-more]').count(),0);
   assert.match(await page.locator('.group-member').nth(1).innerText(),/Sharing total only/);
   assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster fits the phone');
   await page.evaluate(()=>window.scrollTo(0,0));await capture(page,`groups-roster-full-390-${theme}`,'.group-roster',{hideChrome:true});assert.deepEqual(errors,[]);await context.close();contexts.splice(contexts.indexOf(context),1);
   console.log(`Groups ${theme}: create, generic invite/accept, empty and full roster states pass`);
  }
  const {context,page}=await open('light',330);await page.goto(base+groupUrl(idFull));await page.locator('[data-group-more]').click();assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'full roster has no horizontal overflow at 330px');await context.close();contexts.splice(contexts.indexOf(context),1);
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
