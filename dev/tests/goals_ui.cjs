// Rendered Goals sheet: daily calories + macros together, one-day calories folded below. Fictional demo account;
// both saves are answered by stand-ins, so no target or day goal is written.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,test,label){for(let n=0;n<120;n++){if(await p.evaluate(test))return;await p.waitForTimeout(100);}throw Error(label);}
const ready=p=>until(p,()=>App.pageReady,'View did not settle');
(async()=>{
 const browser=await chromium.launch();
 try{
  const login=await browser.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const auth=await login.storageState();await login.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:auth,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[],writes=[],targets=[],dayGoals=[];
   p.on('pageerror',e=>errors.push(e.message));await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await c.route('**/api/**',async r=>{
    const q=r.request(),where=new URL(q.url()).pathname;
    if(where==='/api/challenges/signup/continue')return r.fulfill({json:{}});
    if(q.method()==='PUT'&&where==='/api/food/targets'){targets.push(q.postDataJSON());return r.fulfill({json:{ok:true}});}
    if(q.method()==='PUT'&&where==='/api/food/day-goal'){dayGoals.push(q.postDataJSON());return r.fulfill({json:{ok:true}});}
    if(!['GET','HEAD','OPTIONS'].includes(q.method())){writes.push(where);return r.abort();}
    return r.continue();
   });
   const open=async()=>{await p.locator('#fd-goal').click();await p.locator('.sheet[aria-label="Goals"]').waitFor();};
   await p.goto(base+'/food');await ready(p);await p.locator('#fd-goal').waitFor();
   assert.match(await p.locator('#fd-goal').getAttribute('aria-label'),/goals/i);
   assert.equal((await p.locator('#fd-goal').innerText()).trim(),'Goals');
   const type=await p.locator('#fd-goal').evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),weight:getComputedStyle(n).fontWeight}));assert(type.font>=15&&(size.root>16||type.font<=16),'Goals label follows the body type scale');assert.equal(type.weight,'500','Goals uses medium weight');
   const control=await p.locator('#fd-goal').boundingBox();assert(control.width>control.height&&Math.abs(control.height-44)<1,'Goals is an inline44px action');const parts=await p.locator('#fd-goal').evaluate(n=>{const a=n.querySelector('svg').getBoundingClientRect(),b=n.querySelector('span').getBoundingClientRect();return {icon:{x:a.x,y:a.y,w:a.width,h:a.height},label:{x:b.x,y:b.y,w:b.width,h:b.height}};});assert(parts.icon.w===18&&parts.icon.h===18,'bounded target icon');assert(parts.label.x>=parts.icon.x+parts.icon.w+5,'Goals label follows icon');assert(Math.abs(parts.label.y+parts.label.h/2-parts.icon.y-parts.icon.h/2)<1,'icon and label aligned');
   await open();
   const sheet=p.locator('.sheet[aria-label="Goals"]');
   // The four everyday goals are visible together without opening anything, with full labels inside the sheet.
   const fields=['kcal_target','protein_target','carbs_target','fat_target'];
   const box=await sheet.boundingBox();
   for(const name of fields){const f=sheet.locator(`#tg [name="${name}"]`);assert(await f.isVisible(),name+' visible');const r=await f.boundingBox();assert(r.x>=box.x&&r.x+r.width<=box.x+box.width+1,name+' inside sheet');assert(await f.evaluate(e=>e.offsetHeight)>=44,name+' 44px target');}
   assert.equal(await sheet.locator('#tg [name="fiber_target"]').isVisible(),false,'Fiber stays folded under More targets');
   assert.equal(await p.evaluate(()=>document.querySelector('.sheet .sbody').scrollWidth<=document.querySelector('.sheet .sbody').clientWidth+1),true,'No sideways overflow');
   // Running macro check against the calorie target.
   await sheet.locator('[name="kcal_target"]').fill('2011');await sheet.locator('[name="protein_target"]').fill('150');await sheet.locator('[name="carbs_target"]').fill('200');await sheet.locator('[name="fat_target"]').fill('67');
   assert.match(await sheet.locator('#tg-sum').innerText(),/add up to 2,003 kcal, matching your calorie target/);
   await sheet.locator('[name="kcal_target"]').fill('1500');
   assert.match(await sheet.locator('#tg-sum').innerText(),/503 kcal more than your calorie target/);
   await sheet.locator('[name="kcal_target"]').fill('2011');
   if(size.width===390&&out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`goals-${theme}.png`)});}
   await sheet.getByRole('button',{name:'Save daily targets'}).click();await until(p,()=>!document.querySelector('.sheet[aria-label="Goals"]:not([inert])')&&!document.querySelector('.scrim:not([inert]) .sheet'),'Sheet closes after saving targets');
   assert.equal(targets.length,1);assert.deepEqual([targets[0].kcal_target,targets[0].protein_target,targets[0].carbs_target,targets[0].fat_target],[2011,150,200,67]);
   // One-day calories: folded, secondary, and saved separately.
   await ready(p);await open();const s2=p.locator('.scrim:not([inert]) .sheet[aria-label="Goals"]');
   const day=s2.locator('details.goal-day');assert.equal(await day.evaluate(d=>d.open),false,'One-day calories start folded');
   await day.locator('summary').click();await s2.locator('#dg [name="k"]').fill('1800');
   if(size.width===390&&out)await p.screenshot({path:path.join(out,`goals-day-${theme}.png`)});
   await s2.getByRole('button',{name:/^Save for /}).click();await until(p,()=>!document.querySelector('.scrim:not([inert]) .sheet'),'Sheet closes after saving the day');
   assert.equal(dayGoals.length,1);assert.equal(dayGoals[0].kcal,1800);assert.match(dayGoals[0].day,/^\d{4}-\d{2}-\d{2}$/);
   // Labelled Explore entry and Me use this same everyday-goals form.
   await p.goto(base+'/food');await ready(p);await p.locator('[data-nutrition-feature="goals"]').click();await p.locator('.sheet[aria-label="Goals"] #tg').waitFor();
   assert.deepEqual(await p.locator('.sheet #tg input').evaluateAll(xs=>xs.filter(e=>['kcal_target','protein_target','carbs_target','fat_target'].includes(e.name)).map(e=>e.name)),fields);
   await p.locator('.sheet [data-close]').click();
   await p.evaluate(()=>targetsSheet());await p.locator('.sheet[aria-label="Goals"] #tg').waitFor();
   assert.deepEqual(await p.locator('.sheet #tg input').evaluateAll(xs=>xs.filter(e=>['kcal_target','protein_target','carbs_target','fat_target'].includes(e.name)).map(e=>e.name)),fields);
   await p.locator('.sheet [data-close]').click();
   assert.deepEqual(errors,[],'No runtime errors');assert.deepEqual(writes,[],'No other writes');
   console.log(`Goals sheet ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
