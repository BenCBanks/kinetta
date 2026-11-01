// Rendered Me card: tappable week bars and the all-time panel with thousands separators. Fictional demo account; the
// lifetime numbers are enlarged in the response (stand-in values) so separators are exercised. Nothing is written.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true}),p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
await c.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
 // Lifetime numbers at Ben's scale (fictional values) so separators and the all-time panel are exercised
 if(u.pathname.endsWith('/profile')){const resp=await r.fetch();const j=await resp.json();j.overview={...j.overview,activities:3044,distance_m:18964000,time_s:5568300};j.sports=[{sport:'run',activities:2938},{sport:'walk',activities:70},{sport:'ride',activities:19},{sport:'hike',activities:9}];return r.fulfill({response:resp,json:j});}
 return r.continue();});
await p.goto(base+'/me');for(let attempt=0;attempt<150;attempt++){if(await p.evaluate(()=>App.pageReady))break;await p.waitForTimeout(100);}assert(await p.evaluate(()=>App.pageReady),'Me route initialized');await p.locator('.me-card-sections[aria-busy=false]').waitFor();await p.waitForSelector('.me-card-total');
const total=await p.locator('.me-card-total').innerText();assert.match(total,/3,044/);assert.match(total,/11,784/);assert.match(total,/1,546h|1,547h/);
assert.match(await p.locator('.me-sport-chips').innerText(),/2,938/);assert.equal(await p.locator('.me-sport-chip .me-sport-ico svg').count(),4,'each sport chip has its icon');assert.equal(await p.locator('.me-sport-chip i').count(),0,'no coloured dots');
const label=p.locator('[data-week-label]'),before=await label.innerText(),weeks=p.locator('.me-week');assert.equal(await weeks.count(),7);
const chart=p.locator('.me-card-bars');
const checkChart=async()=>{if(size.width!==390||size.root!==16)return;const g=await p.evaluate(()=>{const rail=document.querySelector('.me-card-bars'),label=document.querySelector('[data-week-label]'),bottom=Math.max(...[...label.children].map(n=>n.getBoundingClientRect().bottom)),top=Math.min(...[...rail.querySelectorAll('.me-week span')].map(n=>n.getBoundingClientRect().top));return{width:rail.clientWidth,content:rail.scrollWidth,gap:top-bottom};});assert(g.content<=g.width,'all seven days/weeks fit at390px without horizontal scrolling '+JSON.stringify(g));assert(g.gap>=8&&g.gap<=12,'caption-to-bars spacing is8–12px '+JSON.stringify(g));};
const checkPadding=async()=>{
 const g=await chart.evaluate(n=>{
  const body=n.closest('.me-card-body'),r=n.getBoundingClientRect(),b=body.getBoundingClientRect(),style=getComputedStyle(body);
  return{left:r.left,right:r.right,min:b.left+parseFloat(style.paddingLeft),max:b.right-parseFloat(style.paddingRight),overflow:getComputedStyle(n).overflowX,
   bars:[...n.querySelectorAll('.me-week')].map(button=>{const target=button.getBoundingClientRect(),bar=button.querySelector('span').getBoundingClientRect();return{left:bar.left-target.left,right:target.right-bar.right};})};
 });
 assert(g.left>=g.min-.02&&g.right<=g.max+.02,'chart stays inside normal card padding '+JSON.stringify(g));
 assert.equal(g.overflow,'auto','fallback scrolling clips offscreen bars inside padding');
 for(const bar of g.bars)assert(bar.left>=7.98&&bar.right>=7.98,'visible bars stay inset inside each full-width target '+JSON.stringify(bar));
};
const checkHeader=async()=>{
 if(size.root!==16)return;
 const g=await p.locator('.me-card-head').evaluate(n=>{
  const label=n.querySelector('[data-week-label]'),[name,total]=[...label.children].map(x=>x.getBoundingClientRect()),toggle=n.querySelector('.me-period').getBoundingClientRect();
  return{heading:[name.top,name.bottom],total:[total.top,total.bottom],toggle:[toggle.top,toggle.bottom],labelRight:label.getBoundingClientRect().right,toggleLeft:toggle.left,
   textCentres:[...label.children,...n.querySelectorAll('.me-period button')].map(x=>{const r=document.createRange();r.selectNodeContents(x);const b=r.getBoundingClientRect();return(b.top+b.bottom)/2;})};
 });
 assert(Math.max(...g.textCentres)-Math.min(...g.textCentres)<=2.5,'caption and Days/Weeks text align on one row '+JSON.stringify(g));
 assert(Math.abs(g.heading[0]-g.total[0])<.02,'heading and total share a row '+JSON.stringify(g));
 assert(Math.max(g.heading[0],g.total[0],g.toggle[0])<Math.min(g.heading[1],g.total[1],g.toggle[1]),'heading, total and Days/Weeks share one row '+JSON.stringify(g));
 assert(g.toggleLeft-g.labelRight>=7.98,'period controls stay separated from caption '+JSON.stringify(g));
};
await checkChart();await checkPadding();await checkHeader();
const checkTargets=async()=>{const geometry=await weeks.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
for(let i=0;i<7;i++){assert(geometry[i].height>=44&&geometry[i].width>=44,'every day/week has a44px target');if(i){assert(Math.abs(geometry[i].y-geometry[i-1].y)<.02,'chart targets stay in one horizontal row');assert(Math.abs(geometry[i].x-geometry[i-1].x-geometry[i-1].width)<.02,'adjacent chart targets do not overlap or leave dead space');}}};
await checkTargets();
await chart.scrollIntoViewIfNeeded();
const chartState=()=>chart.evaluate(n=>({left:n.scrollLeft,max:n.scrollWidth-n.clientWidth,atEnd:n.scrollWidth-n.clientWidth-n.scrollLeft<1}));
assert((await chartState()).atEnd,'the current week is initially visible at the right edge');
await chart.evaluate(n=>{n.scrollLeft=0;n.dispatchEvent(new Event('scroll'));});
await p.locator('[data-period=days]').tap();await p.locator('.me-distance.days .me-week').first().waitFor();
assert.equal(await weeks.count(),7,'all seven days remain present');
await checkChart();await checkPadding();await checkHeader();await checkTargets();
assert(await weeks.evaluateAll(nodes=>nodes.filter(n=>n.classList.contains('now')).every(n=>{const r=n.getBoundingClientRect(),b=n.parentElement.getBoundingClientRect();return r.left>=b.left-.02&&r.right<=b.right+.02;})),'today is exposed when Days first opens');
await chart.evaluate(n=>{n.scrollLeft=0;n.dispatchEvent(new Event('scroll'));});
await p.locator('[data-period=weeks]').tap();await p.locator('.me-distance:not(.days) .me-week').first().waitFor();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert((await chartState()).left<1,'Weeks retains its independently chosen position');
await chart.scrollIntoViewIfNeeded();const pageY=await p.evaluate(()=>scrollY);
await weeks.nth(6).evaluate(n=>n.focus({preventScroll:true}));
assert((await chartState()).atEnd,'focus reveals an offscreen chart target');
assert.equal(await p.evaluate(()=>scrollY),pageY,'revealing a chart target does not move the page');
await p.locator('[data-period=days]').tap();await p.locator('.me-distance.days .me-week').first().waitFor();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert((await chartState()).left<1,'Days retains its independently chosen position');
await p.locator('[data-period=weeks]').tap();await p.locator('.me-distance:not(.days) .me-week').first().waitFor();

const y0=await weeks.nth(0).evaluate(n=>n.getBoundingClientRect().y+scrollY);await weeks.nth(2).tap();if(size.root===16)assert.equal(await weeks.nth(0).evaluate(n=>n.getBoundingClientRect().y+scrollY),y0,'bars stay put in the document');if(size.width===390&&size.root===16){const tops=await p.$$eval('.me-card-total .stat',e=>e.map(x=>Math.round(x.getBoundingClientRect().top)));assert.equal(new Set(tops).size,1,'all-time on one row '+tops);const gaps=await p.$$eval('.me-card-total .stat b',e=>e.map(x=>{const r=document.createRange();r.selectNodeContents(x);const b=r.getBoundingClientRect();return [b.left,b.right];}));for(let i=1;i<gaps.length;i++)assert(gaps[i][0]-gaps[i-1][1]>=8,'all-time numbers keep a gap '+JSON.stringify(gaps));}const picked=await label.innerText();assert.notEqual(picked,before);assert.match(picked,/–[\s\S]*\d/);assert.equal(await weeks.nth(2).getAttribute('aria-pressed'),'true');
await p.locator('.me-card').scrollIntoViewIfNeeded();if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/me-card-${size.width}-${size.root}-${theme}.png`});}
await weeks.nth(2).tap();assert.equal(await label.innerText(),before,'second tap restores the total');
await weeks.nth(6).focus();await p.keyboard.press('Enter');assert.match(await label.innerText(),/–/);
const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!ov,'no overflow');
assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Me card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
