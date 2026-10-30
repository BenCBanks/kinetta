// Real fictional accounts and real overview responses. No production data or AI/provider calls.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(await p.evaluate(()=>({url:location.href,key:App.page?.key,ready:App.pageReady,body:document.body.textContent.slice(0,200)}))));}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'test_progress_overview.py')],{env:{...process.env,KINETTA_KEEP_PROGRESS:'1'},stdio:'inherit'});
 const b=await chromium.launch(),cleanup=[];
 try{
 for(const who of ['empty','runner','food']){
  const login=await b.newContext();const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_overview_'+who,password:'green teapot on the hill'}});assert.equal(signed.status(),200,'fixture login: '+await signed.text());const state=await login.storageState();cleanup.push(login);
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark']){
   if(process.env.KINETTA_PROGRESS_CASE&&process.env.KINETTA_PROGRESS_CASE!==`${who}-${size.width}-${theme}`)continue;
   const c=await b.newContext({storageState:state,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>App.pageReady&&App.page?.key===location.pathname+location.search,'ready');
   const home=async()=>{if(p.url()==='about:blank')await p.goto(base+'/progress');else await p.evaluate(()=>go('/progress'));await p.waitForURL(base+'/progress');await ready();await p.waitForSelector('#p-explore a');};
   const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/progress-${who}-${name}-${theme}.png`,fullPage:true});}};
   const fits=async label=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),label+' has no overflow');
   await home();assert.equal(await p.locator('h1').innerText(),'Progress');assert.equal(await p.locator('.progress-focus, .view-nav, .pbar').count(),0,'no global control rows');
   assert.equal(await p.locator('#p-explore a').count(),7);assert.equal(await p.locator('.progress-food-summary').count(),who==='food'?1:0);
   assert.equal(await p.locator('#p-sport').evaluate(n=>!!n.closest('.card')),true,'sport inside the chart card');
   for(const btn of await p.locator('[data-progress-period]').all())assert((await btn.boundingBox()).height>=44);
   if(who==='empty'){assert(!/0 (activities mapped|loops|segment bests)/.test(await p.locator('#p-explore').innerText()));assert.equal(await p.locator('.progress-new:not(.seen)').count(),7);}
   if(who==='runner'){assert.match(await p.locator('#p-explore a').first().innerText(),/Heatmap[\s\S]*2 activities mapped/);assert.equal(await p.locator('[data-progress-feature="heatmap"] .progress-new:not(.seen)').count(),0);assert.match(await p.locator('[data-progress-record]').innerText(),/5K/);}
   if(who==='food'){assert.match(await p.locator('[data-progress-food]').innerText(),/Protein goal 1 of 7 days.*weight/);}
   if(size.root===16){const height=(await p.locator('#p-home-totals .card').first().boundingBox()).height;assert(height<=(who==='empty'||who==='food'?150:330),'compact totals: '+height);assert.equal(await p.locator('.progress-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),2);if(who==='runner')assert.match(await p.locator('[data-progress-fitness]').innerText(),/(Fresh|Tired|Training steadily)[\s\S]*estimate/);}
   await fits('home');await shot('home');
   await p.locator('[data-progress-period="month"]').click();await ready();assert.equal(await p.locator('[data-progress-period="month"]').getAttribute('aria-pressed'),'true');
   await p.locator('#p-sport').click();await p.locator('[data-pk="all"]').click();await ready();assert.equal(await p.evaluate(()=>localStorage.getItem('fit.psport')),'all');
   await p.locator('.progress-totals-title').click();await p.waitForURL('**/progress?view=totals');await ready();assert.match(await p.locator('.progress-back').getAttribute('href'),/period=month/,'back keeps home filters');await p.locator('.progress-back').click();await p.waitForURL(/period=month/);await p.waitForSelector('.progress-home');await ready();await home();
   // Every tile has a direct destination and every Progress detail has a Home arrow, including old addresses.
   for(const url of ['/progress?view=totals','/progress?view=fitness','/progress?view=records','/progress?view=lifting','/progress/trends','/progress/calendar','/progress/routes','/progress/segments','/progress/heatmap','/progress?section=food','/progress?section=food&foodview=weight','/progress?view=training','/progress?view=heatmap']){
    if(['/progress?view=fitness','/progress?section=food','/progress/heatmap'].includes(url))await p.goto(base+url);else await p.evaluate(url=>go(url),url);await ready();assert.equal(await p.locator('.progress-back[href^="/progress"]').count(),1,url+' home arrow');assert.equal(await p.locator('.progress-focus').count(),0);await fits(url);
    if(url.includes('view=fitness')||url.includes('/trends'))assert.equal(await p.locator('#p-rng button').count(),1,'years filter survives first-card refresh');
    await p.locator('.progress-back').click();await p.waitForURL(base+'/progress');await p.waitForSelector('.progress-home');await ready();assert.equal(await p.locator('.progress-home').count(),1);
   }
   await home();await p.evaluate(()=>document.addEventListener('click',e=>{if(e.target.closest('[data-progress-feature="lifting"]'))globalThis.progressLeaveScroll=scrollY;},{capture:true}));await p.locator('[data-progress-feature="lifting"]').click();await p.waitForURL('**/progress?view=lifting');await ready();const y=await p.evaluate(()=>globalThis.progressLeaveScroll);await p.locator('.progress-back').click();await p.waitForURL(base+'/progress');await p.waitForSelector('.progress-home');await ready();await until(p,target=>Math.abs(scrollY-Math.min(target,document.documentElement.scrollHeight-innerHeight))<8,'home preserves available scroll',y);
   assert.equal(await p.locator('[data-progress-feature="lifting"] .progress-new:not(.seen)').count(),0,'visited tile drops New');
   // Failed overview/fitness/volume requests retain descriptions and navigation, without an error banner.
   await c.route('**/api/progress/overview',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await c.route('**/api/fitness?*',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await c.route('**/api/progress/volume?*',r=>r.fulfill({status:503,json:{detail:'Fictional unavailable response'}}));
   await p.goto(base+'/progress');await ready();assert.equal(await p.locator('#p-explore a').count(),7);assert.equal(await p.locator('.err, .error-page').count(),0);await fits('unavailable');
   assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[]);console.log(`Progress ${who} ${size.width}/${size.root} ${theme}: cards, filters, legacy addresses, scroll, New and unavailable PASS`);await c.close();
  }
 }
 }finally{for(const c of cleanup){await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:'green teapot on the hill'}});await c.close();}await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
