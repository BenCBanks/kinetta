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
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
