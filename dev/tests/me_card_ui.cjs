// Rendered Me card: tappable week bars and the all-time panel with thousands separators. Fictional demo account; the
// lifetime numbers are enlarged in the response (stand-in values) so separators are exercised. Nothing is written.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true}),p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
await c.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
 // Lifetime numbers at Ben's scale (fictional values) so separators and the all-time panel are exercised
 if(u.pathname.endsWith('/profile')){const resp=await r.fetch();const j=await resp.json();j.overview={...j.overview,activities:3044,distance_m:18964000,time_s:5568300};j.sports=[{sport:'run',activities:2938},{sport:'walk',activities:70},{sport:'ride',activities:19},{sport:'hike',activities:9}];return r.fulfill({response:resp,json:j});}
 return r.continue();});
await p.goto(base+'/me');for(let attempt=0;attempt<150;attempt++){if(await p.evaluate(()=>App.pageReady))break;await p.waitForTimeout(100);}assert(await p.evaluate(()=>App.pageReady),'Me route initialized');await p.waitForSelector('.me-card-total');
const total=await p.locator('.me-card-total').innerText();assert.match(total,/3,044/);assert.match(total,/11,784/);assert.match(total,/1,546h|1,547h/);
assert.match(await p.locator('.me-sport-chips').innerText(),/2,938/);assert.equal(await p.locator('.me-sport-chip .me-sport-ico svg').count(),4,'each sport chip has its icon');assert.equal(await p.locator('.me-sport-chip i').count(),0,'no coloured dots');
const label=p.locator('[data-week-label]'),before=await label.innerText(),weeks=p.locator('.me-week');assert.equal(await weeks.count(),7);
for(let i=0;i<7;i++){const bb=await weeks.nth(i).boundingBox();assert(bb.height>=44,'week target height');}
const y0=(await weeks.nth(0).boundingBox()).y;await weeks.nth(2).tap();if(size.root===16){assert.equal((await weeks.nth(0).boundingBox()).y,y0,'bars stay put');const tops=await p.$$eval('.me-card-total .stat',e=>e.map(x=>Math.round(x.getBoundingClientRect().top)));assert.equal(new Set(tops).size,1,'all-time on one row '+tops);const gaps=await p.$$eval('.me-card-total .stat b',e=>e.map(x=>{const r=document.createRange();r.selectNodeContents(x);const b=r.getBoundingClientRect();return [b.left,b.right];}));for(let i=1;i<gaps.length;i++)assert(gaps[i][0]-gaps[i-1][1]>=8,'all-time numbers keep a gap '+JSON.stringify(gaps));}const picked=await label.innerText();assert.notEqual(picked,before);assert.match(picked,/–[\s\S]*\d/);assert.equal(await weeks.nth(2).getAttribute('aria-pressed'),'true');
await p.locator('.me-card').scrollIntoViewIfNeeded();if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/me-card-${size.width}-${theme}.png`});}
await weeks.nth(2).tap();assert.equal(await label.innerText(),before,'second tap restores the total');
await weeks.nth(6).focus();await p.keyboard.press('Enter');assert.match(await label.innerText(),/–/);
const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!ov,'no overflow');
assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Me card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
