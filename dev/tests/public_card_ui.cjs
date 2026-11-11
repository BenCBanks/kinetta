// Public sharing settings and the exact exported picture, using only the fictional demo account.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{
 const browser=await chromium.launch(),login=await browser.newContext();
 assert((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).ok());
 const storageState=await login.storageState();await login.close();
 const qrOnly=process.env.KINETTA_PUBLIC_CARD_CASE==='qr',cases=qrOnly?[{size:{width:390,height:844,root:16},theme:'light'}]:[{width:390,height:844,root:16},{width:1280,height:900,root:16}].flatMap(size=>['light','dark'].map(theme=>({size,theme})));
 for(const {size,theme} of cases){
  const c=await browser.newContext({storageState,viewport:size,colorScheme:theme,timezoneId:'America/New_York',serviceWorkers:'block'}),p=await c.newPage(),errors=[],qrRequests=[];let qrFailures=0,expectedQrFailurePending=false,qrConsoleFailures=0;
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'){let resourcePath='';try{resourcePath=new URL(m.location().url).pathname;}catch{}if(expectedQrFailurePending&&m.text().startsWith('Failed to load resource')&&resourcePath==='/static/vendor/qrcode.js'){qrConsoleFailures++;return;}errors.push(m.text());}});
  p.on('request',r=>{if(new URL(r.url()).pathname==='/static/vendor/qrcode.js')qrRequests.push(r.url());});
  p.on('requestfailed',r=>{if(new URL(r.url()).pathname==='/static/vendor/qrcode.js'){qrFailures++;if(!expectedQrFailurePending)errors.push('Unexpected QR asset request failure');}else errors.push(`Request failed: ${r.url()}`);});
  p.on('requestfailed',r=>{if(new URL(r.url()).pathname==='/static/vendor/qrcode.js')qrFailures++;else errors.push(`Request failed: ${r.url()}`);});
  await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
  const ready=async()=>{for(let attempt=0;attempt<150;attempt++){if(await p.evaluate(()=>App.pageReady))return;await p.waitForTimeout(100);}throw Error('Me did not become ready');};
  await p.goto(base+'/me');await ready();await p.evaluate(()=>KinettaCard.open());
  const enabled=p.getByRole('switch',{name:'Share card',exact:true}),photo=p.locator('#card-photo'),sports=p.locator('#card-sports'),requests=p.locator('#card-requests'),thisWeek=p.getByRole('radio',{name:'This week',exact:true}),allTime=p.getByRole('radio',{name:'All time',exact:true}),none=p.getByRole('radio',{name:'None',exact:true});
  // Evaluate directly: older Playwright's waitForFunction injects eval, rejected by the app's strict CSP.
  const settled=async()=>{for(let attempt=0;attempt<150;attempt++){
   if(await p.evaluate(()=>{const img=document.querySelector('#card-picture'),toggle=document.querySelector('#card-enabled');return !!(img?.complete&&img.naturalWidth===1080&&toggle&&!toggle.disabled);}))return;
   await p.waitForTimeout(100);
  }throw Error('Card picture and settings did not settle');};
  const waitForSocialWarmup=async()=>{for(let attempt=0;attempt<100;attempt++){if(await p.evaluate(()=>performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname==='/static/social.js')))return;await p.waitForTimeout(50);}throw Error('Me Social warmup did not complete');};
  const checkQr=async()=>{
   let failQr=true;await p.route('**/static/vendor/qrcode.js*',route=>{if(failQr){failQr=false;expectedQrFailurePending=true;return route.abort();}return route.continue();});
   const qr=p.locator('#card-qr');await qr.click();
   for(let attempt=0;attempt<100;attempt++){if((await p.locator('#card-status').textContent()).includes('could not load'))break;await p.waitForTimeout(50);}
   await p.waitForTimeout(50);expectedQrFailurePending=false;
   assert.match(await p.locator('#card-status').innerText(),/QR code could not load/,'a failed lazy QR load leaves the card sheet open with a retry message');assert.equal(qrRequests.length,1,'QR is requested only after the card action');assert.equal(qrFailures,1,'the fixture fails the first QR asset request only');
   await qr.click();assert(await p.getByRole('img',{name:'QR code for your Kinetta card'}).isVisible(),'the existing card QR screen remains available after retry');assert.equal(qrRequests.length,2,'a failed script request can retry once');await p.unroute('**/static/vendor/qrcode.js*');
   await p.reload();await ready();await p.evaluate(()=>KinettaCard.open());await settled();
   let qrStarted=false,releaseQr;await p.route('**/static/vendor/qrcode.js*',async route=>{qrStarted=true;await new Promise(resolve=>{releaseQr=resolve;});await route.continue();});
   await p.locator('#card-qr').evaluate(button=>{window.__pendingCardQrSheet=button.closest('.sheet');});await p.locator('#card-qr').click();
   for(let attempt=0;attempt<100&&!qrStarted;attempt++)await p.waitForTimeout(20);assert(qrStarted,'the card QR action starts its lazy request');
   await p.evaluate(()=>go('/activity'));for(let attempt=0;attempt<100;attempt++){if(await p.evaluate(()=>location.pathname==='/activity'&&App.pageReady))break;await p.waitForTimeout(50);}
   assert.equal(new URL(p.url()).pathname,'/activity','the test navigates while card QR is pending');releaseQr();
   for(let attempt=0;attempt<100;attempt++){if(qrRequests.length===3)break;await p.waitForTimeout(20);}
   assert.equal(qrRequests.length,3,'the pending QR asset finishes after navigation');assert.equal(await p.getByRole('dialog',{name:'Scan my Kinetta card'}).count(),0,'a stale card callback does not open a QR sheet after navigation');
   assert.equal(await p.evaluate(()=>window.__pendingCardQrSheet?.querySelector('#card-qr-code svg')||null),null,'the detached card sheet is not updated after navigation');
  };
  await settled();assert.match(await p.title(),/Kinetta/);assert.equal(new URL(p.url()).pathname,'/me');
  await waitForSocialWarmup();assert.equal(qrRequests.length,0,'neither cold Me nor post-Me Social warmup loads QR');
  if(qrOnly){await checkQr();assert.deepEqual(errors,[]);console.log('Public card QR: Me/Social warmup stay QR-free; the card action lazily retries a failed asset PASS');await c.close();continue;}
  for(const x of [enabled,photo,sports,requests,thisWeek])assert(await x.isChecked());assert(!(await allTime.isChecked()));assert(!(await none.isChecked()));
  const setting=await c.request.get(base+'/api/card'),data=await setting.json();
  assert.equal(data.period,'this_week');assert.equal(data.preview.period,'this_week');
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
  const achievements=p.locator('#card-achievements'),sharingBefore=(await(await c.request.get(base+'/api/sharing')).json()).share_achievements;
  await achievements.uncheck();await settled();const hiddenAchievements=(await(await c.request.get(base+'/api/card')).json()).preview;
  assert(!('achievements' in hiddenAchievements),'the owner preview omits featured items when achievement sharing is off');
  await achievements.check();await settled();const sharedAchievements=(await(await c.request.get(base+'/api/card')).json()).preview;
  assert(Array.isArray(sharedAchievements.achievements),'the opted-in owner preview returns only featured achievements');
  if(sharingBefore)await achievements.check();else await achievements.uncheck();await settled();
  await enabled.uncheck();await settled();assert(await p.locator('#card-share').isDisabled());assert.equal((await anonymous.request.get(data.url)).status(),404);
  await p.reload();await ready();await p.evaluate(()=>KinettaCard.open());await settled();assert(!(await enabled.isChecked()),'off survives returning to the sheet');
  await enabled.check();await settled();assert((await anonymous.request.get(data.url)).ok());
  assert.equal(await p.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
  await checkQr();
  assert.deepEqual(errors,[]);console.log(`Public card ${size.width}x${size.height}/${size.root} ${theme} PASS: weekly/all-time/none choices, matching image, public opt-out, sports, off persistence, public revocation, QR, console`);
  await anonymous.close();await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
