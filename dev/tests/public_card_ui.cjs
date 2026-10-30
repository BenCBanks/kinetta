// Public sharing settings and the exact exported picture, using only the fictional demo account.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{
 const browser=await chromium.launch(),login=await browser.newContext();
 assert((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).ok());
 const storageState=await login.storageState();await login.close();
 for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState,viewport:size,colorScheme:theme,timezoneId:'America/New_York',serviceWorkers:'block'}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
  await p.goto(base+'/me');await p.locator('[data-card-share]').click();await p.locator('[data-share-card]').click();
  const enabled=p.getByRole('switch',{name:'Share card',exact:true}),photo=p.locator('#card-photo'),sports=p.locator('#card-sports'),requests=p.locator('#card-requests');
  const settled=async()=>{await p.waitForFunction(()=>{const img=document.querySelector('#card-picture'),toggle=document.querySelector('#card-enabled');return img?.complete&&img.naturalWidth===1080&&toggle&&!toggle.disabled;});};
  await settled();assert.match(await p.title(),/Kinetta/);assert.equal(new URL(p.url()).pathname,'/me');
  for(const x of [enabled,photo,sports,requests])assert(await x.isChecked());
  assert.deepEqual(await p.locator('[data-card-stat]:checked').evaluateAll(xs=>xs.map(x=>x.dataset.cardStat)),['distance_year','activity_weeks']);
  assert(await p.locator('[data-card-stat="activities_year"]').isDisabled(),'two-stat limit remains enforced');
  const setting=await c.request.get(base+'/api/card'),data=await setting.json();
  assert(data.preview.sports.every(s=>s.activities>0));assert.match(await p.locator('#card-picture').getAttribute('alt'),/all-time activities/);
  const anonymous=await browser.newContext();assert((await anonymous.request.get(data.url)).ok());
  if(out){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:`${out}/card-${size.width}-${theme}.png`});}
  // Unchecking sports changes both the actual API preview and the exported image, and can be restored.
  const first=await (await c.request.get(base+'/api/card/image.png')).body();
  if(out&&size.width===390&&theme==='light')fs.writeFileSync(`${out}/exported-card.png`,first);
  await sports.uncheck();await settled();assert(!(await sports.isChecked()));assert.equal((await(await c.request.get(base+'/api/card')).json()).preview.sports.length,0);
  const hidden=await(await c.request.get(base+'/api/card/image.png')).body();assert(!first.equals(hidden));
  await sports.check();await settled();assert(await sports.isChecked());
  await enabled.uncheck();await settled();assert(await p.locator('#card-share').isDisabled());assert.equal((await anonymous.request.get(data.url)).status(),404);
  await p.reload();await p.locator('[data-card-share]').click();await p.locator('[data-share-card]').click();await settled();assert(!(await enabled.isChecked()),'off survives returning to the sheet');
  await enabled.check();await settled();assert((await anonymous.request.get(data.url)).ok());
  const year=p.locator('[data-card-stat="distance_year"]'),food=p.locator('[data-card-stat="food_days_month"]');
  await year.uncheck();await settled();assert(!(await food.isDisabled()));await food.check();await settled();assert(await food.isChecked());
  await food.uncheck();await settled();await year.check();await settled();
  assert.equal(await p.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
  const qr=p.locator('#card-qr');await qr.click();assert(await p.getByRole('img',{name:'QR code for your Kinetta card'}).isVisible());
  assert.deepEqual(errors,[]);console.log(`Public card ${size.width}x${size.height}/${size.root} ${theme} PASS: defaults, image, sports, off persistence, public revocation, stat changes, QR, console`);
  await anonymous.close();await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
