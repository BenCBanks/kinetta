// Real fictional histories and existing charts; no providers, devices or unrelated writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label='Insights ready'){for(let i=0;i<160;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,ready:globalThis.App?.pageReady,text:document.querySelector('#nt-body')?.innerText.slice(0,500)}))));}
const ready=p=>until(p,()=>App.pageReady&&!!document.querySelector('#nt-body .insights-summary,#nt-body .insights-empty'));
(async()=>{const b=await chromium.launch();try{
 for(const state of ['empty','low','typical','heavy','unknown']){
 const login=await b.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_insights_'+state,password:'green teapot on the hill'}})).status(),200);const auth=await login.storageState();await login.close();
 for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:15},{width:390,height:844,root:16},{width:330,height:667,root:24}]){
 const c=await b.newContext({storageState:auth,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
 await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD','OPTIONS'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
 for(const entry of ['nutrition','progress'])for(const range of ['7','30','365','since']){
 await p.goto(base+`/food?view=overview&r=${range}`+(entry==='progress'?'&from=progress':''));await ready(p);
 const data=await p.evaluate(async range=>{const saved=range==='since'?(await api('/api/food/insights?days=7')).deficit_start:null;return api('/api/food/insights?'+(saved?'since='+saved:'days='+range)+'&brief=1');},range);
 const ctl=await p.locator('#n-range').boundingBox(),main=await p.locator('#nt-body').boundingBox();assert(ctl.y+ctl.height<=main.y+1,'range above main content');assert.equal(await p.locator('#nt-body #n-range,#n-insights').count(),0);
 assert.equal(await p.locator('.nutrition-back').getAttribute('aria-label'),'Back to '+(entry==='progress'?'Progress':'Nutrition'));
 const title=await p.locator('.top h1').evaluate(n=>({h:n.getBoundingClientRect().height,line:parseFloat(getComputedStyle(n).lineHeight)}));assert(title.h<=title.line+1,'Insights title stays whole on one line');
 const controlType=await p.locator('#n-range').evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),height:n.getBoundingClientRect().height}));assert(controlType.font>=15&&controlType.height>=44,'readable44px range target');const face=await p.locator('#n-range').evaluate(n=>{const s=getComputedStyle(n,'::before');return n.getBoundingClientRect().height-parseFloat(s.top)-parseFloat(s.bottom);});assert(Math.abs(face-36)<1,'36px range face inside44px hit area');
 assert.equal(await p.locator('.insights-links a').count(),6);for(const link of await p.locator('.insights-links a').all())assert((await link.boundingBox()).height>=44);
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'no document overflow');
 if(state==='empty'){assert.equal(await p.locator('.insights-empty').count(),1);assert.equal(await p.locator('.insights-figures').count(),0);}
 else{
 const spacing=await p.evaluate(()=>{const card=document.querySelector('.insights-summary'),grid=document.querySelector('.insights-figures'),s=getComputedStyle(card),g=getComputedStyle(grid),r=document.querySelector('.insights-chart').getBoundingClientRect(),first=grid.getBoundingClientRect();return {padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),row:parseFloat(g.rowGap),column:parseFloat(g.columnGap),chartGap:first.top-r.bottom};});assert(spacing.padding.every(n=>n>=16),'16px card padding');assert(spacing.row>=8&&spacing.column>=8&&spacing.chartGap>=8,'8px between independent chart/stat targets: '+JSON.stringify(spacing));
 const dates=await p.locator('#nt-overview-chart svg text').evaluateAll(ns=>ns.filter(n=>+n.getAttribute('y')>=137).map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right};}));for(let i=1;i<dates.length;i++)assert(dates[i].left>=dates[i-1].right,'readable overview date labels do not overlap');
 assert.equal(await p.locator('.insights-figure').count(),4);assert.equal(await p.locator('#nt-overview-chart svg').count(),1);assert.equal((await p.locator('#nt-overview-chart .legend').innerText()).includes('Burned'),false,'overview shows eaten/actual goal only');
 assert.match(await p.locator('.insights-coverage').innerText(),new RegExp('Logged '+data.summary.logged+' of '+data.summary.past_days+' days'));
 const low=data.summary.logged<7||data.summary.logged/data.summary.past_days<.25;assert.equal(await p.locator('.low-data').count(),Number(low));if(low&&data.summary.logged)assert.match(await p.locator('.insights-figures').innerText(),new RegExp('from '+data.summary.logged+' day'));
 if(state==='unknown'){assert.equal(data.summary.avg_protein_g,null);assert.match(await p.locator('.insights-figures').innerText(),/Protein data missing/);}
 if(state==='low')assert.equal(await p.locator('.insights-log-weight').count(),1);
 if(state==='typical'&&size.width===390){const figs=await p.locator('.insights-figures').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(figs.y+figs.height<nav.y,'chart and figures fit before tab bar');}
 if(size.root<=16)for(const line of await p.locator('.insights-copy .insight>span:last-child').all()){const height=await line.evaluate(e=>e.offsetHeight),lh=await line.evaluate(e=>parseFloat(getComputedStyle(e).lineHeight));assert(height<=lh*2+1,'brief insight at most two lines');}
 }
 if(out&&range==='30'){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${state}-${entry}-${size.width}-${theme}.png`});}
 console.log(`Insights ${state} ${entry} ${range} ${size.width}/${size.root} ${theme} PASS`);
 }
 // The same route/range memory and six actual detail destinations, then the weigh-in form.
 await p.locator('#n-range').click();await p.locator('[data-pk="7"]').click();await ready(p);assert.equal(new URL(p.url()).searchParams.get('r'),'7');assert.equal(await p.evaluate(()=>localStorage.getItem('fit.nrange')),'7');
 await p.evaluate(()=>go('/food?view=overview&from=progress'));await ready(p);assert.match(await p.locator('#n-range').innerText(),/7/);
 const links=await p.locator('.insights-links a').evaluateAll(a=>a.map(n=>n.getAttribute('href')));for(const href of links){await p.evaluate(h=>go(h),href);await until(p,()=>App.pageReady);assert.equal(new URL(p.url()).searchParams.get('view'),new URL(href,base).searchParams.get('view'));assert.equal(await p.locator('.nutrition-back').getAttribute('aria-label'),'Back to Progress');}
 await p.evaluate(()=>go('/food?view=weight&from=progress'));await until(p,()=>!!document.querySelector('.wform input'));assert.equal(await p.locator('.wform input').isVisible(),true);
 await p.evaluate(()=>go('/food?view=overview'));await ready(p);if(state!=='empty'){await p.locator('.insights-chart').click();await until(p,()=>App.pageReady&&!!document.querySelector('#nt-energychart svg'));assert.match(await p.locator('#nt-energychart .legend').innerText(),/Burned/);}
 if(state==='typical'&&size.width===390){
 await p.evaluate(()=>go('/me'));await until(p,()=>App.pageReady&&!!document.querySelector('.me-insights .mileage-progress'));
 const view=p.locator('.me-insights .mileage-progress');assert.equal(await view.getAttribute('href'),'/progress');
 if(out)await p.locator('.me-insights').screenshot({path:`${out}/me-insights-${theme}.png`});
 await view.click();await until(p,()=>App.pageReady&&!!document.querySelector('.progress-home-totals'));assert.equal(new URL(p.url()).pathname,'/progress');assert.equal(new URL(p.url()).searchParams.get('view'),null);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();}
 }
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
