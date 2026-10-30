// The profile page is the Me card at full size, then the shared activities; the card's distance chart switches between
// days and weeks; Me's private area shows insights instead of a second chart (Ben, 30 Oct 2026). Fictional demo accounts
// (Alex, friend Jordan, Sam waiting for approval). Every write is intercepted, so nothing is saved.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
// Poll with page.evaluate: the app's Content Security Policy forbids the string evaluation waitForFunction uses.
async function until(page,fn,label,arg){for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);}
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
 const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));
 await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
 await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
 const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${theme}.png`});}};
 const settled=()=>p.waitForSelector('.me-card-sections[aria-busy=false]',{timeout:15000});
 const noOverflow=async where=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no overflow on '+where);

 // Me: one distance chart (on the card), private insights below the line.
 await p.goto(base+'/me');await until(p,()=>App.pageReady,'1');await settled();
 await p.waitForSelector('.me-insights',{timeout:15000});
 assert.equal(await p.locator('#me-distance, .mileage-heading').count(),0,'no second distance chart on Me');
 assert.match(await p.locator('.me-insights').innerText(),/This week so far[\s\S]*of your usual/);
 assert.equal(await p.locator('.me-insights a[href^="/progress"]').count(),1);
 // The week bar is drawn to scale inside its track (not squashed to a sliver).
 const [bar,track]=await p.$$eval('.me-insights .track, .me-insights .track .bar',e=>e.map(x=>x.getBoundingClientRect().width).reverse());assert(track>100&&bar<=track,'week track spans the card');
 // Days / Weeks on the card: seven bars either way, days carry weekday letters, a tap shows that day.
 const toggle=p.locator('.me-card .me-period [data-period="days"]');assert((await toggle.boundingBox()).height>=44,'44px toggle target');
 await toggle.click();await p.waitForSelector('.me-distance.days');
 assert.equal(await p.locator('.me-distance .me-week').count(),7);assert.equal(await p.locator('.me-distance .me-week i').count(),7,'weekday letters');
 assert.match(await p.locator('[data-week-label] span').innerText(),/This week/i);
 await p.locator('.me-distance .me-week.now').click();assert.match(await p.locator('[data-week-label] span').innerText(),/\d/,'tapped day shows its date');
 await p.locator('.me-card').scrollIntoViewIfNeeded();await shot('me-card-days');
 await p.locator('.me-card .me-period [data-period="weeks"]').click();await until(p,()=>!document.querySelector('.me-distance.days'),'2')
 assert.equal(await p.locator('.me-distance .me-week i').count(),0);
 await noOverflow('Me');

 // Your profile: the same card with Edit / Share pills, a slim preview switch, then the activities. No separate
 // Public card link; the card stays one tap inside Share.
 await p.goto(base+'/people/alex');await until(p,()=>App.pageReady,'3');await settled();
 assert.equal(await p.locator('.profile-page-title').innerText(),'Your profile');
 assert.equal(await p.locator('#person-profile .me-card [data-card-edit]').count(),1);assert.equal(await p.locator('#person-profile .me-card [data-card-share]').count(),1);
 assert.equal(await p.locator('#pf-card, #pf-edit-profile, #pf-share, .profile-progress, .profile-mileage').count(),0,'old profile parts are gone');
 assert.equal(await p.locator('#person-profile .me-card-row').count(),0,'no link row back to the same page');
 assert.equal(await p.locator('#person-profile .me-week').count(),7,'same distance chart as Me');
 assert((await p.locator('#person-activities .post, #person-activities .card').count())>0,'activities follow the card');
 await shot('profile-own');
 await p.locator('[data-card-share]').click();const share=p.locator('.sheet');await share.waitFor();
 assert.match(await share.innerText(),/Public card/);assert.doesNotMatch(await share.innerText(),/View full profile/);
 await p.keyboard.press('Escape');await share.waitFor({state:'detached'}).catch(()=>{});
 // Edit happens in place on the card, exactly as on Me; Cancel leaves everything as it was.
 await p.locator('[data-card-edit]').click();await p.waitForSelector('#person-profile .me-card.editing');
 assert.equal(await p.locator('#person-activities').evaluate(n=>!!n.closest('[inert]')),true,'activities dimmed while editing');
 await p.locator('[data-card-cancel]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'4')
 await p.locator('[data-audience="member"]').click();await until(p,()=>new URLSearchParams(location.search).get('preview')==='member','5');await settled();
 assert.equal(await p.locator('[data-audience="member"]').getAttribute('aria-pressed'),'true');
 await p.locator('.pf-preview').scrollIntoViewIfNeeded();await shot('profile-own-preview');
 await noOverflow('own profile');

 // Someone else's profile: the same card; the friendship button and ⋯ sit where Edit and Share are.
 await p.goto(base+'/people/jordan');await until(p,()=>App.pageReady,'6');await settled();
 assert.equal(await p.locator('.profile-page-title').innerText(),'Profile');
 assert.equal(await p.locator('.me-card-banner [data-person-manage]').count(),1);assert.equal(await p.locator('.me-card-banner [data-person-report]').count(),1);
 assert.equal(await p.locator('.me-card [data-card-edit], .me-card-note').count(),0,'no owner controls or owner note');
 await shot('profile-friend');
 await p.goto(base+'/people/sam');await until(p,()=>App.pageReady,'7');await settled();
 const approve=p.locator('.me-card-banner [data-person-action="accept"]');assert.equal(await approve.count(),1);assert((await approve.boundingBox()).height>=44);
 await noOverflow('request profile');
 assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);
 console.log(`Profile card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await inlineEditorChecks(b);await b.close();})().catch(e=>{console.error(e);process.exit(1);});

async function inlineEditorChecks(browser){
 const cp=require('node:child_process'),path=require('node:path'),pw='green teapot on the hill';
 cp.execFileSync('python3',['-c',"import sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_card_editor');person('zz_test_card_other')"],{cwd:path.join(__dirname,'../..'),env:process.env,stdio:'inherit'});
 const auth=await browser.newContext(),login=(c,n)=>c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:n,password:pw}});
 const layout={sections:['recent','mileage','totals','sports','activities'],stats:['activities','distance','time'],sports:[]};
 await login(auth,'zz_test_card_editor');const storage=await auth.storageState();
 try{
 for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState:storage,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],puts=[];let fail=false,hold=false,held;
  await c.request.put(base+'/api/account',{headers:{Origin:base},data:{name:'River Fixture',bio:'',profile_layout:layout}});
  p.on('pageerror',e=>errors.push(e.message));
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='PUT'&&u.pathname==='/api/account'){puts.push(q.postDataJSON());if(fail){fail=false;return r.fulfill({status:503,json:{detail:'Fictional save failed'}});}if(hold){held=r;return;}return r.continue();}if(q.method()==='PUT'&&u.pathname==='/api/me/photo')return r.continue();if(!['GET','HEAD'].includes(q.method()))return r.fulfill({json:{}});return r.continue();});
  const ready=()=>until(p,()=>App.pageReady,'editor route ready');
  const open=async()=>{await p.locator('[data-card-edit]').click();await p.waitForSelector('.me-card.editing');};
  const close=async()=>{await p.locator('[data-card-cancel]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'editor closed');};
  await p.goto(base+'/me');await ready();await p.waitForSelector('.me-card-sections[aria-busy=false]');await open();
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.show),'recent','Edit pill focuses the first section switch');
  assert(await p.locator('[data-card-save]').isDisabled());assert.equal(await p.locator('#pf-editor,#pf-draft,[data-card-identity],.me-card-actions').count(),0,'old sheet and bottom Save removed');
  assert.equal(await p.locator('[data-show][role=switch]').count(),5);assert(await p.locator('[data-move=recent][data-step="-1"]').isDisabled());assert(await p.locator('[data-move=activities][data-step="1"]').isDisabled());
  const card=p.locator('.me-card'),header=p.locator('.me-editor-head');
  if(size.root===16){const h=(await card.boundingBox()).height;assert(h<=size.height*1.3,`default editor is compact: ${h}px`);}
  await card.scrollIntoViewIfNeeded();await p.evaluate(()=>scrollTo(0,document.querySelector('.me-card').offsetTop));
  if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/card-editor-default-${theme}.png`});}
  await p.evaluate(()=>scrollBy(0,180));assert((await header.boundingBox()).y<=2,'header remains pinned');
  await p.locator('#card-name').fill('');await p.locator('[data-card-save]').click();assert.match(await p.locator('#card-name-error').innerText(),/1 and 60/);assert.equal(puts.length,0,'empty name writes nothing');
  await p.locator('#card-name').fill('Brook Fixture');await p.locator('#card-bio').fill('Fictional trails and weekend rides.');
  await p.locator('[data-show=activities]').uncheck();await p.locator('[data-move=recent][data-step="1"]').click();
  await p.locator('[data-stat=time]').click();await p.locator('[data-stat=active_days]').click();await p.locator('[data-sport=run]').click();
  assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  assert.match(await p.locator('[data-card-bio-count]').innerText(),/35\/280/);
  // Cancelling is deliberate; rejecting the dialog retains every draft field and layout choice.
  p.once('dialog',async d=>{assert.equal(d.message(),'Discard your changes?');await d.dismiss();});await p.locator('[data-card-cancel]').click();assert(await p.locator('.me-card.editing').count());
  // The existing photo picker opens inside this editor without losing drafts.
  await p.locator('[data-card-photo]').click();await p.waitForSelector('#pp-file',{state:'attached'});const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.fillStyle='#2563eb';g.fillRect(0,0,128,128);return c.toDataURL('image/png').split(',')[1];});await p.locator('#pp-file').setInputFiles({name:'fictional-avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForSelector('.sheet',{state:'detached'});await p.waitForSelector('[data-card-photo] img');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');
  fail=true;await p.locator('[data-card-save]').click();await until(p,()=>document.querySelector('[data-card-status]')?.textContent.includes('Fictional save failed'),'inline save error');assert(await p.locator('[data-card-status]').isVisible(),'save failure stays under the pinned header');assert.equal(await p.locator('#card-name').inputValue(),'Brook Fixture');assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert(!(await p.locator('[data-card-save]').isDisabled()));
  await p.locator('[data-card-save]').click();await until(p,()=>!document.querySelector('.me-card.editing'),'save closes editor');await p.waitForSelector('.me-card-name h2');assert.equal(await p.locator('.me-card-name h2').innerText(),'Brook Fixture');
  assert.deepEqual(Object.keys(puts.at(-1)).sort(),['bio','name','profile_layout']);
  await p.reload();await ready();assert.equal(await p.locator('.me-card-name h2').innerText(),'Brook Fixture');await open();assert.equal(await p.locator('#card-bio').inputValue(),'Fictional trails and weekend rides.');assert(!(await p.locator('[data-show=activities]').isChecked()));assert.equal(await p.locator('.me-edit-row').first().locator('[data-show]').getAttribute('data-show'),'mileage');await close();
  await p.evaluate(()=>go('/me/settings'));await p.waitForURL('**/me/settings');await ready();assert.match(await p.locator('#m-profile').innerText(),/Name, photo, bio & layout/);await p.locator('#m-profile').click();await p.waitForURL('**/me?edit=profile');await p.waitForSelector('.me-card.editing');await until(p,()=>document.activeElement.id==='card-name','Settings focuses Name');assert.equal(await p.locator('#pf-editor').count(),0);await close();await p.waitForURL('**/me');await ready();
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no enlarged-text overflow');
  // A delayed save response cannot update the account or editor that is now signed in.
  await p.waitForSelector('.me-card-sections[aria-busy=false]');await open();await p.locator('#card-name').fill('Delayed Fixture');hold=true;await p.locator('[data-card-save]').click();for(let i=0;i<100&&!held;i++)await p.waitForTimeout(50);assert(held);
  await login(c,'zz_test_card_other');await p.evaluate(async()=>refreshMe(await api('/api/me')));await until(p,()=>App.me.login==='zz_test_card_other','new account');const other=await p.evaluate(()=>App.me.name);await held.fulfill({json:{name:'Old response',profile_layout:layout}});await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>App.me.name),other);assert.equal(await p.locator('.me-card.editing').count(),0);
  assert.deepEqual(errors,[]);console.log(`Inline card editor ${size.width}/${size.root} ${theme}: pinned header, height, atomic retry/reload, drafts/cancel, Settings focus and stale account PASS`);await c.close();
 }
 }finally{for(const n of ['zz_test_card_editor','zz_test_card_other']){await login(auth,n);await auth.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}await auth.close();}
}
