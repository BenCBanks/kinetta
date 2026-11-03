// Rendered Me card: tappable week bars and aligned period totals with thousands separators. Fictional demo account; the
// lifetime numbers are enlarged in the response (stand-in values) so separators are exercised. Nothing is written.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
const addDays=(day,count)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);};
const chartFixture=today=>{const noon=new Date(today+'T12:00:00Z'),sunday=addDays(today,-noon.getUTCDay()),weekValues=[0,1800,6200,100,0,4300,2700,900,0,5500,3200,7800],dayValues=[1600,0,100,2500,800,0,900,1800,0,3000,700,2200,1500,4100];return {today,
 weeks:weekValues.map((distance_m,i)=>{const d=addDays(sunday,(i-11)*7),end=addDays(d,6);return{d,end:end>today?today:end,distance_m,today:i===11};}),
 days:dayValues.map((distance_m,i)=>({d:addDays(today,i-13),distance_m,today:i===13}))};};
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
await c.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}
 // Lifetime numbers at Ben's scale (fictional values) so separators and aligned period totals are exercised
 if(u.pathname.endsWith('/profile')){const resp=await r.fetch();const j=await resp.json();j.overview={...j.overview,activities:3044,distance_m:18964000,time_s:5568300};j.sports=[{sport:'run',activities:2938},{sport:'walk',activities:70},{sport:'ride',activities:19},{sport:'hike',activities:9}];j.mileage=chartFixture(j.mileage.today);return r.fulfill({response:resp,json:j});}
 return r.continue();});
await p.goto(base+'/me');for(let attempt=0;attempt<150;attempt++){if(await p.evaluate(()=>App.pageReady))break;await p.waitForTimeout(100);}assert(await p.evaluate(()=>App.pageReady),'Me route initialized');await p.locator('.me-card-sections[aria-busy=false]').waitFor();await p.locator('.me-card-figures[data-card-period=totals] .me-metric-value').first().waitFor();
const total=(await p.locator('.me-card-figures[data-card-period=totals] .me-metric-value').allTextContents()).join(' ');assert.match(total,/3,044/);assert.match(total,/11,784/);assert.match(total,/1,546|1,547/);assert.match(await p.locator('[data-card-stat=time] dt').innerText(),/Time\s*\(h\)/);
assert.match(await p.locator('.me-sport-chips').innerText(),/2,938/);assert.equal(await p.locator('.me-sport-chip .me-sport-ico svg').count(),4,'each sport chip has its icon');assert.equal(await p.locator('.me-sport-chip i').count(),0,'no coloured dots');
const label=p.locator('[data-week-label]'),before=await label.innerText(),weeks=p.locator('.me-week');assert.equal(await weeks.count(),12,'Weeks shows twelve periods');assert.equal(await label.locator('span').innerText(),'This week','unselected label shows the current period');assert.equal(await label.locator('small').innerText(),await weeks.last().getAttribute('data-dist'),'unselected value matches the current period');
const chart=p.locator('.me-card-bars');
const checkChart=async()=>{if(size.width!==390||size.root!==16)return;const g=await p.evaluate(()=>{const rail=document.querySelector('.me-card-bars'),label=document.querySelector('[data-week-label]'),spans=[...rail.querySelectorAll('.me-week span')],zero=rail.querySelector('.me-week.zero span'),low=spans[3],nowBar=rail.querySelector('.me-week.now'),now=nowBar.querySelector('span'),bottom=Math.max(...[...label.children].map(n=>n.getBoundingClientRect().bottom)),top=Math.min(...spans.map(n=>n.getBoundingClientRect().top)),zeroBg=getComputedStyle(zero).backgroundColor,currentOpacity=getComputedStyle(now).opacity,transition=now.style.transition;now.style.transition='none';nowBar.classList.add('zero');const currentZero=[getComputedStyle(now).backgroundColor,getComputedStyle(now).opacity];nowBar.classList.remove('zero');now.style.transition=transition;return{width:rail.clientWidth,content:rail.scrollWidth,gap:top-bottom,bars:spans.map(n=>n.getBoundingClientRect().width),visibleGaps:spans.slice(1).map((n,i)=>n.getBoundingClientRect().left-spans[i].getBoundingClientRect().right),baseline:getComputedStyle(rail,'::after').height,baselineZ:Number(getComputedStyle(rail,'::after').zIndex),barZ:Number(getComputedStyle(rail.querySelector('.me-week')).zIndex),zero:zero&&[zero.getBoundingClientRect().width,zero.getBoundingClientRect().height],zeroBg,currentZero,low:low&&low.getBoundingClientRect().height,current:currentOpacity};});assert(g.content<=g.width,'all bars fit at390px without horizontal scrolling '+JSON.stringify(g));assert(g.gap>=8&&g.gap<=12,'caption-to-bars spacing is8–12px '+JSON.stringify(g));assert(g.bars.every(w=>w<=18.1),'visible bars are at most18px wide '+JSON.stringify(g));assert(g.visibleGaps.every(w=>w>=5.9),'visible bars keep a6px gap '+JSON.stringify(g));assert.equal(g.baseline,'1px','chart has a one-pixel baseline');assert(g.barZ>g.baselineZ,'zero ticks and short bars paint above the baseline');assert.deepEqual(g.zero,[2,2],'zero has only a2px muted tick');assert.deepEqual(g.currentZero,[g.zeroBg,'1'],'even a current zero stays a muted tick');assert(g.low>=4,'low non-zero distance remains visible '+JSON.stringify(g));assert.equal(g.current,'0.6','current period accent is about60% '+JSON.stringify(g));};
const checkPadding=async()=>{
 const g=await chart.evaluate(n=>{
  const body=n.closest('.me-card-body'),r=n.getBoundingClientRect(),b=body.getBoundingClientRect(),style=getComputedStyle(body);
  return{left:r.left,right:r.right,min:b.left+parseFloat(style.paddingLeft),max:b.right-parseFloat(style.paddingRight),overflow:getComputedStyle(n).overflowX,
   bars:[...n.querySelectorAll('.me-week')].map(button=>{const target=button.getBoundingClientRect(),bar=button.querySelector('span').getBoundingClientRect();return{width:target.width,height:target.height,label:button.getAttribute('aria-label'),left:bar.left-target.left,right:target.right-bar.right};})};
 });
 assert(g.left>=g.min-.02&&g.right<=g.max+.02,'chart stays inside normal card padding '+JSON.stringify(g));
 assert.equal(g.overflow,'hidden','fitted bars remain inside card padding');
 for(const bar of g.bars)assert(bar.height>=44&&bar.label&&bar.width>0,'each bar retains a labelled, tall touch/keyboard target '+JSON.stringify(bar));
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
for(let i=0;i<geometry.length;i++){assert(geometry[i].height>=44,'every day/week retains a44px-tall target');if(i){assert(Math.abs(geometry[i].y-geometry[i-1].y)<.02,'chart targets stay in one horizontal row');assert(Math.abs(geometry[i].x-geometry[i-1].x-geometry[i-1].width)<.02,'adjacent chart targets do not overlap or leave dead space');}}};
const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${size.width}-${size.root}-${theme}.png`});}};
await p.evaluate(()=>{window.__meChartHaptics=[];Native.haptic=kind=>window.__meChartHaptics.push(kind);});
await checkTargets();
await chart.scrollIntoViewIfNeeded();
const chartState=()=>chart.evaluate(n=>({left:n.scrollLeft,max:n.scrollWidth-n.clientWidth,atEnd:n.scrollWidth-n.clientWidth-n.scrollLeft<1}));
assert((await chartState()).atEnd,'the current week is initially visible at the right edge');
await chart.evaluate(n=>{n.scrollLeft=0;n.dispatchEvent(new Event('scroll'));});
if(size.width===390&&size.root===16)await shot('me-card-weeks-zero');
await p.locator('[data-period=days]').tap();await p.locator('.me-distance.days .me-week').first().waitFor();
assert.equal(await weeks.count(),14,'Days shows fourteen periods');assert.equal(await p.locator('[data-week-label] span').innerText(),'Today','unselected label shows the current day');assert.equal(await p.locator('[data-week-label] small').innerText(),await weeks.last().getAttribute('data-dist'),'unselected value matches today');
await checkChart();await checkPadding();await checkHeader();await checkTargets();
assert(await weeks.evaluateAll(nodes=>nodes.filter(n=>n.classList.contains('now')).every(n=>{const r=n.getBoundingClientRect(),b=n.parentElement.getBoundingClientRect();return r.left>=b.left-.02&&r.right<=b.right+.02;})),'today is exposed when Days first opens');
await chart.evaluate(n=>{n.scrollLeft=0;n.dispatchEvent(new Event('scroll'));});
if(size.width===390&&size.root===16)await shot('me-card-days-zero');
await p.locator('[data-period=weeks]').tap();await p.locator('.me-distance:not(.days) .me-week').first().waitFor();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert((await chartState()).left<1,'Weeks retains its independently chosen position');
await chart.scrollIntoViewIfNeeded();const pageY=await p.evaluate(()=>scrollY);
await weeks.nth(6).evaluate(n=>n.focus({preventScroll:true}));
assert((await chartState()).atEnd,'focus reveals an offscreen chart target');
assert.equal(await p.evaluate(()=>scrollY),pageY,'revealing a chart target does not move the page');
await p.locator('[data-period=days]').tap();await p.locator('.me-distance.days .me-week').first().waitFor();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert((await chartState()).left<1,'Days retains its independently chosen position');
await p.locator('[data-period=weeks]').tap();await p.locator('.me-distance:not(.days) .me-week').first().waitFor();

await p.evaluate(()=>{window.__meChartHaptics=[];});
const y0=await weeks.nth(0).evaluate(n=>n.getBoundingClientRect().y+scrollY);await weeks.nth(2).tap();if(size.root===16)assert.equal(await weeks.nth(0).evaluate(n=>n.getBoundingClientRect().y+scrollY),y0,'bars stay put in the document');if(size.width===390&&size.root===16){const tops=await p.$$eval('.me-card-numbers .me-metric-value',nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.equal(tops.length,3);assert(Math.max(...tops)-Math.min(...tops)<.1,'three headline values share one row');}const picked=await label.innerText();assert.notEqual(picked,before);assert.match(picked,/–[\s\S]*\d/);assert.equal(await weeks.nth(2).getAttribute('aria-pressed'),'true');
assert.deepEqual(await p.evaluate(()=>window.__meChartHaptics),['light'],'selecting a bar gives a light haptic');
const selectedStyle=await weeks.nth(2).locator('span').evaluate(n=>({shadow:getComputedStyle(n).boxShadow,opacity:getComputedStyle(n).opacity}));assert.equal(selectedStyle.shadow,'none','selected bar has no outline box');assert.equal(selectedStyle.opacity,'1','selected bar is solid accent');
if(size.width===390&&size.root===16)await shot('me-card-selected');
await weeks.nth(2).tap();assert.equal(await label.innerText(),before,'second tap restores the total');
await weeks.nth(6).focus();await p.keyboard.press('Enter');assert.match(await label.innerText(),/–/);
await p.evaluate(()=>{window.__meChartHaptics=[];});
await chart.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
const box0=await weeks.nth(0).boundingBox(),box3=await weeks.nth(3).boundingBox();await p.mouse.move(box0.x+box0.width/2,box0.y+box0.height/2);await p.mouse.down();await p.mouse.move(box3.x+box3.width/2,box3.y+box3.height/2,{steps:5});await p.mouse.up();assert.equal(await weeks.nth(3).getAttribute('aria-pressed'),'true','drag selects the bar under the pointer');const dragHaptics=await p.evaluate(()=>window.__meChartHaptics);assert(dragHaptics.length>=2&&dragHaptics.every(kind=>kind==='light'),'drag gives a light haptic for each selection change '+JSON.stringify(dragHaptics));
if(size.width===390&&size.root===16)await shot('me-card-selected-by-drag');
if(size.width===330&&size.root===24)await shot('me-card-large-text');
const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!ov,'no overflow');
assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Me card ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
