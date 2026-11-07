'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const base=(process.env.KINETTA_URL||'http://localhost:8798').replace(/\/$/,'');
const out=process.env.KINETTA_CONTACTS_UI_OUT||'';
const password='blue kettle morning run';
const salt='fictional-contact-salt-0123456789';
const contacts=[
 {id:'fictional-contact-1',name:'Jordan Lee',hashes:[{kind:'email',digest:'a'.repeat(64)}]},
 {id:'fictional-contact-2',name:'Maya Chen',hashes:[{kind:'phone',digest:'b'.repeat(64)}]},
 {id:'fictional-contact-3',name:'Taylor Brooks',hashes:[{kind:'email',digest:'c'.repeat(64)}]},
];
const allHashes=contacts.flatMap(contact=>contact.hashes);

async function runTheme(browser,theme){
 let scenario='explain',matchBodies=[],writes=[],saltCalls=0,pluginCalls=0;
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'UTC'});
 await context.addInitScript(()=>{
  window.__contactsScenario='explain';window.__contactsPluginCalls=0;
  window.__contactsShares=[];
  Object.defineProperty(navigator,'share',{configurable:true,value:async options=>{window.__contactsShares.push(options);}});
  window.Capacitor={isNativePlatform:()=>false,getPlatform:()=> 'ios',Plugins:{KinettaContacts:{
   hashContacts:async()=>{window.__contactsPluginCalls++;const contacts=[
    {id:'fictional-contact-1',name:'Jordan Lee',hashes:[{kind:'email',digest:'a'.repeat(64)}]},
    {id:'fictional-contact-2',name:'Maya Chen',hashes:[{kind:'phone',digest:'b'.repeat(64)}]},
    {id:'fictional-contact-3',name:'Taylor Brooks',hashes:[{kind:'email',digest:'c'.repeat(64)}]},
   ];const batch={permission:window.__contactsScenario==='limited'?'limited':'authorized',contacts,hashes:contacts.flatMap(c=>c.hashes),truncated:false};window.__contactsLastBatch=batch;return batch;},
   openSettings:async()=>({}),
  }}};
 });
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base)return route.abort();
  if(url.pathname==='/api/contacts/salt') {saltCalls++;return route.fulfill({json:{salt}});}
  if(url.pathname==='/api/contacts/match'){
   const body=request.postDataJSON();matchBodies.push(body);
   if(scenario==='rate-limited')return route.fulfill({status:429,json:{error:'Contacts were checked in the last 24 hours. Try again tomorrow.'}});
   if(scenario==='empty')return route.fulfill({json:{matches:[]}});
   return route.fulfill({json:{matches:[{hash:'a'.repeat(64),login:'jordanfit'},{hash:'b'.repeat(64),login:'mayaride'}]}});
  }
  if(url.pathname==='/api/friends/link'&&request.method()==='GET')return route.fulfill({json:{url:'https://login.kinetta.app/add/fictional-invite'}});
  if(url.pathname==='/api/friends'&&request.method()==='GET')return route.fulfill({json:{friends:[],incoming:[],outgoing:[]}});
  if(url.pathname==='/api/friends'&&request.method()==='POST'){
   writes.push(request.postDataJSON());return route.fulfill({json:{status:'sent',name:'Fictional account'}});
  }
  if(url.pathname==='/api/contacts/settings'&&request.method()==='GET')return route.fulfill({json:{phone_e164:null,email_ready:true,find_by_email:true,find_by_phone:true}});
  if(url.pathname==='/api/sharing'&&request.method()==='GET')return route.fulfill({json:{default:'everyone',details:{},findable:true,trims:[],trim_m:0}});
  if(url.pathname==='/api/blocks'&&request.method()==='GET')return route.fulfill({json:[]});
  if(request.method()==='POST'&&url.pathname!=='/api/login')return route.fulfill({status:200,json:{ok:true}});
  if(!['GET','HEAD','POST'].includes(request.method()))return route.fulfill({status:200,json:{ok:true}});
  return route.continue();
 });
 const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password}});
 assert.equal(login.status(),200,'fictional demo login');
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const capture=async name=>{
  if(!out)return;
  fs.mkdirSync(out,{recursive:true});await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${name} has no horizontal overflow at 390px`);
  const title=page.locator('.contacts-page > .top h1');
  assert.equal(await title.innerText(),'Contacts',`${name} uses the short Contacts title`);
  assert.equal(await title.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,`${name} title fits without clipping`);
  await page.screenshot({path:path.join(out,`${name}-390-${theme}.png`),animations:'disabled'});
 };
 const enter=async mode=>{
  scenario=mode;await page.goto(base+'/me/friends?find=1');await page.locator('#contacts-entry').waitFor();
  await page.evaluate(mode=>window.__contactsScenario=mode,mode);
  await page.locator('#contacts-entry').click();await page.locator('#contacts-continue').waitFor();
 };

 await enter('explain');
 assert.equal(await page.locator('.contacts-intro').innerText().then(text=>text.includes('names and contact details stay on your iPhone')),true,'permission explanation precedes the native prompt');
 assert.equal(await page.evaluate(()=>window.__contactsPluginCalls),0,'opening the screen does not request Contacts access');
 assert.equal(saltCalls,0,'opening the screen does not request a salt');
 await capture('contacts-explainer');

 await enter('limited');
 await page.locator('#contacts-continue').click();await page.getByRole('heading',{name:'Limited access'}).waitFor();
 assert.equal(await page.locator('#contacts-check-selected').count(),1);
 assert.equal(matchBodies.length,0,'limited access waits for a second explicit tap before matching');
 await capture('contacts-limited');
 await page.locator('#contacts-check-selected').click();await page.getByRole('heading',{name:'On Kinetta',exact:true}).waitFor();
 assert.equal(await page.locator('.contacts-matched-list .contacts-person').count(),2,'the selected contacts continue to matching after confirmation');

 await enter('results');
 await page.locator('#contacts-continue').click();await page.getByRole('heading',{name:'On Kinetta',exact:true}).waitFor();
 assert.equal(await page.locator('.contacts-matched-list .contacts-person').count(),2,`only matching local contacts appear: ${await page.locator('.contacts-content').innerText()}`);
 assert.equal(await page.locator('#contacts-check-again').count(),0,'a successful daily check has no repeat action');
 assert.equal(await page.locator('.contacts-next-check').innerText(),'You can check again tomorrow');
 assert.deepEqual(await page.locator('.contacts-matched-list .contacts-person-copy b').allTextContents(),['Jordan Lee','Maya Chen']);
 assert.equal(await page.locator('.contacts-add').count(),2,'each result has a one-tap Add friend action');
 assert.equal(await page.locator('.contacts-invites').count(),1,`unmatched contacts remain an on-device invitation list: ${await page.locator('.contacts-content').innerText()}`);
 assert.match(await page.locator('.contacts-invites > summary').innerText(),/Not on Kinetta\s+1/);
 const addBox=await page.locator('.contacts-add').first().boundingBox();assert.equal(addBox.width,44);assert.equal(addBox.height,44);
 const stored=await page.evaluate(prefix=>Object.entries(localStorage).filter(([key])=>key.startsWith(prefix)),`kinetta.contacts.matches:`);
 assert.equal(stored.length,1);assert(!stored[0][1].includes('a'.repeat(64))&&!stored[0][1].includes('b'.repeat(64)),'hashes are not cached');
 assert.deepEqual(JSON.parse(stored[0][1]).rows,[{contactId:'fictional-contact-1',login:'jordanfit'},{contactId:'fictional-contact-2',login:'mayaride'}]);
 await capture('contacts-results');
 await page.locator('.contacts-add').first().click();await page.getByRole('status').getByText('Requested').waitFor();
 assert.deepEqual(writes,[{login:'jordanfit'}],'Add friend sends only the established public login handle');
 await page.locator('.contacts-invites > summary').click();await page.locator('[data-invite-contact]').click();
 const invite=page.getByRole('dialog',{name:'Invite Taylor Brooks'});await invite.waitFor();
 assert.match(await invite.innerText(),/Anyone who opens this link becomes your friend/);
 await invite.locator('#contacts-share-invite').click();
 await page.waitForFunction(()=>window.__contactsShares.length>0);
 const share=await page.evaluate(()=>window.__contactsShares.at(-1));
 assert.equal(share.url,'https://login.kinetta.app/add/fictional-invite');assert.equal(Object.hasOwn(share,'recipients'),false,'the share sheet leaves recipient selection to iOS');
 assert(!JSON.stringify(share).includes('Taylor Brooks'),'contact details are not placed in the invite share payload');
 await page.locator('#contacts-done').click();await page.waitForURL('**/me/friends?find=1');
 await page.locator('#contacts-entry').waitFor();
 assert.equal(await page.locator('#contacts-entry').count(),1,'Done returns to Find friends');
 assert.deepEqual(await page.evaluate(()=>({contacts:window.__contactsLastBatch.contacts.length,hashes:window.__contactsLastBatch.hashes.length})),{contacts:0,hashes:0},'leaving the screen scrubs contact names, IDs and hashes from transient memory');
 await page.goto(base+'/me/friends/contacts?return=welcome');await page.locator('#contacts-continue').waitFor();
 await page.locator('#contacts-continue').click();await page.getByRole('heading',{name:'On Kinetta',exact:true}).waitFor();
 await page.locator('#contacts-done').click();await page.waitForURL('**/me/friends?find=1');
 await page.locator('#contacts-entry').waitFor();
 assert.equal(await page.locator('#contacts-entry').count(),1,'Done returns to Find friends when Contacts was opened from Welcome');
 await enter('rate-limited');await page.locator('#contacts-continue').click();await page.getByRole('heading',{name:'On Kinetta',exact:true}).waitFor();
 assert.equal(await page.locator('.contacts-matched-list .contacts-person').count(),2,'429 shows saved matches when available');
 assert.equal(await page.locator('.contacts-next-check').innerText(),'You can check again tomorrow');
 assert.equal(await page.locator('#contacts-check-again').count(),0,'429 has no retry button');
 assert.equal(await page.getByRole('alert').count(),0,'429 is shown as a quiet availability line rather than an error');
 await capture('contacts-rate-limited');
 await page.goto(base+'/me/sharing');await page.locator('#contacts-cache-remove').waitFor();
 await page.locator('#contacts-cache-remove').click();
 assert.equal(await page.evaluate(prefix=>Object.keys(localStorage).filter(key=>key.startsWith(prefix)).length,'kinetta.contacts.matches:'),0,'Me → Sharing & privacy clears the local match cache');

 await enter('empty');await page.locator('#contacts-continue').click();await page.getByRole('heading',{name:'No one found yet'}).waitFor();
 assert.equal(await page.locator('.contacts-matched-list .contacts-person').count(),0,'unmatched contact names are not shown as Kinetta accounts');
 await capture('contacts-empty');
 assert.deepEqual(matchBodies.map(body=>Object.keys(body).sort()),[['hashes','salt'],['hashes','salt'],['hashes','salt'],['hashes','salt'],['hashes','salt']]);
 assert(matchBodies.every(body=>JSON.stringify(body).includes('digest')&&!JSON.stringify(body).includes('Jordan Lee')),'the server receives hashes only, never local contact details');
 assert.equal(saltCalls,5,'each explicit Contacts check gets a salt');
 assert.deepEqual(errors,[]);
 await context.close();
}

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const theme of ['light','dark'])await runTheme(browser,theme);}
 finally{await browser.close();}
 console.log('Contacts screen: permission, rate limit, cache cleanup, matched results, local-only invites and one-tap Add friend PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
