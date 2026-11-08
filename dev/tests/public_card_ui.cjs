// Public sharing settings and the exact exported picture, using only the fictional demo account.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{
 const browser=await chromium.launch(),login=await browser.newContext();
 assert((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).ok());
 const storageState=await login.storageState();await login.close();
 for(const size of [{width:390,height:844,root:16},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState,viewport:size,colorScheme:theme,timezoneId:'America/New_York',serviceWorkers:'block'}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
  await p.goto(base+'/me');await p.locator('[data-card-share]').click();await p.locator('[data-share-card]').click();
  const enabled=p.getByRole('switch',{name:'Share card',exact:true}),photo=p.locator('#card-photo'),sports=p.locator('#card-sports'),requests=p.locator('#card-requests'),thisWeek=p.getByRole('radio',{name:'This week',exact:true}),allTime=p.getByRole('radio',{name:'All time',exact:true}),none=p.getByRole('radio',{name:'None',exact:true});
  // Evaluate directly: older Playwright's waitForFunction injects eval, rejected by the app's strict CSP.
  const settled=async()=>{for(let attempt=0;attempt<150;attempt++){
   if(await p.evaluate(()=>{const img=document.querySelector('#card-picture'),toggle=document.querySelector('#card-enabled');return !!(img?.complete&&img.naturalWidth===1080&&toggle&&!toggle.disabled);}))return;
   await p.waitForTimeout(100);
  }throw Error('Card picture and settings did not settle');};
  await settled();assert.match(await p.title(),/Kinetta/);assert.equal(new URL(p.url()).pathname,'/me');
  assert.equal(await p.locator('#card-achievements').count(),0,'public Share card settings do not offer achievements');
  for(const x of [enabled,photo,sports,requests,thisWeek])assert(await x.isChecked());assert(!(await allTime.isChecked()));assert(!(await none.isChecked()));
  const setting=await c.request.get(base+'/api/card'),data=await setting.json();
  assert.equal(data.period,'this_week');assert.equal(data.preview.period,'this_week');assert(!Object.hasOwn(data.preview,'achievements'),'owner preview contains no public achievement data');
  assert(data.preview.sports.every(s=>s.activities>0));assert.match(await p.locator('#card-picture').getAttribute('alt'),/all-time activities/);
  const anonymous=await browser.newContext();assert((await anonymous.request.get(data.url)).ok());const cardCode=new URL(data.url).pathname.split('/').pop();
  const publicPage=await anonymous.newPage(),publicErrors=[];publicPage.on('pageerror',e=>publicErrors.push(e.message));
  await publicPage.goto(data.url);
  assert(await publicPage.getByRole('heading',{name:'@alex is on Kinetta'}).isVisible());
  assert(await publicPage.getByRole('link',{name:'Already a member? Log in'}).isVisible());
  assert.equal(await publicPage.locator('#public-card-request').count(),0,'anonymous visitors sign in before sending a friend request');
  assert.match(await publicPage.locator('main').innerText(),/Opening this card never makes you friends automatically/);
  assert.deepEqual(publicErrors,[]);await publicPage.close();
  if(out){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:`${out}/card-${size.width}-${theme}.png`});}
  // Unchecking sports changes both the actual API preview and the exported image, and can be restored.
  const first=await (await c.request.get(base+'/api/card/image.png')).body();
  if(out&&size.width===390)fs.writeFileSync(`${out}/card-this-week-${theme}.png`,first);
  if(out&&size.width===390)await p.screenshot({path:`${out}/card-settings-this-week-${theme}.png`,fullPage:true});
  await allTime.check();await settled();assert(await allTime.isChecked());assert.equal((await(await c.request.get(base+'/api/card')).json()).period,'all_time');
  const allTimeImage=await (await c.request.get(base+'/api/card/image.png')).body();assert(!first.equals(allTimeImage),'selected image changes with the chosen period');
  if(out&&size.width===390)fs.writeFileSync(`${out}/card-all-time-${theme}.png`,allTimeImage);
  if(out&&size.width===390)await p.screenshot({path:`${out}/card-settings-all-time-${theme}.png`,fullPage:true});
  await none.check();await settled();assert(await none.isChecked());assert.equal((await(await c.request.get(base+'/api/card')).json()).period,'none');
  const noneSettings=await(await c.request.get(base+'/api/card')).json();assert.equal(noneSettings.stats.length,0);assert(!('weekly' in noneSettings.preview)&&!('all_time' in noneSettings.preview),'None removes totals from the owner preview');
  const nonePublic=await(await anonymous.request.get(base+'/api/cards/'+cardCode)).json();assert.equal(nonePublic.period,'none');assert.equal(nonePublic.stats.length,0);assert(!('weekly' in nonePublic)&&!('all_time' in nonePublic),'None sends no totals to a guest');
  const noneImage=await(await c.request.get(base+'/api/card/image.png')).body();assert(!allTimeImage.equals(noneImage),'None removes the statistics block from the image');
  if(out&&size.width===390)fs.writeFileSync(`${out}/card-none-${theme}.png`,noneImage);
  if(out&&size.width===390)await p.screenshot({path:`${out}/card-settings-none-${theme}.png`,fullPage:true});
  await thisWeek.check();await settled();assert(await thisWeek.isChecked());assert.equal((await(await c.request.get(base+'/api/card')).json()).period,'this_week');
  await sports.uncheck();await settled();assert(!(await sports.isChecked()));assert.equal((await(await c.request.get(base+'/api/card')).json()).preview.sports.length,0);
  const hidden=await(await c.request.get(base+'/api/card/image.png')).body();assert(!first.equals(hidden));
  await sports.check();await settled();assert(await sports.isChecked());
  await enabled.uncheck();await settled();assert(await p.locator('#card-share').isDisabled());assert.equal((await anonymous.request.get(data.url)).status(),404);
  await p.reload();await p.locator('[data-card-share]').click();await p.locator('[data-share-card]').click();await settled();assert(!(await enabled.isChecked()),'off survives returning to the sheet');
  await enabled.check();await settled();assert((await anonymous.request.get(data.url)).ok());
  assert.equal(await p.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
  const qr=p.locator('#card-qr');await qr.click();assert(await p.getByRole('img',{name:'QR code for your Kinetta card'}).isVisible());
  assert.deepEqual(errors,[]);console.log(`Public card ${size.width}x${size.height}/${size.root} ${theme} PASS: weekly/all-time/none choices, matching image, public opt-out, sports, off persistence, public revocation, QR, console`);
  await anonymous.close();await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
