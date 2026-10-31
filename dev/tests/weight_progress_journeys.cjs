'use strict';
// Real rendered routes, read-only fictional histories; all writes/provider requests blocked.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const until=async(p,fn,label)=>{for(let i=0;i<150;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch();let cases=0;
 try{
  for(const size of [{width:390,root:15},{width:330,root:24}])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width:size.width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
   try{
    assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_weight_health',password:'green teapot on the hill'}})).status(),200);
    await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
    const p=await c.newPage(),errors=[];let holdWeights=false,weightsRelease;p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();if(holdWeights&&u.pathname==='/api/food/weights'&&u.search==='?days=3650'){holdWeights=false;const response=await route.fetch();await new Promise(resolve=>weightsRelease=resolve);return route.fulfill({response});}return ['GET','HEAD'].includes(r.method())?route.continue():route.fulfill({json:{}});});
    const ready=()=>until(p,()=>App.pageReady,'Page ready'),weight=()=>until(p,()=>App.pageReady&&location.pathname==='/progress/weight'&&!!document.querySelector('.wform'),'Weight ready');
    for(const [href,label] of [['/progress/weight','Progress'],['/food?view=weight','Nutrition'],['/food/weight','Nutrition'],['/food?view=weight&from=progress','Progress']]){
     await p.goto(base+href);await weight();assert.equal(await p.locator('[data-back]').innerText(),label);await p.locator('[data-back]').click();await ready();assert.equal(new URL(p.url()).pathname,label==='Progress'?'/progress':'/food');cases++;
    }
    for(const origin of ['/progress?sport=ride&period=month','/food?d=2026-10-10','/food?view=overview&days=90']){
     await p.goto(base+origin);await ready();const actual=new URL(p.url()).pathname+new URL(p.url()).search;
     if(origin.startsWith('/progress'))await p.locator('[data-progress-feature=weight]').click();else if(origin.includes('view=overview'))await p.locator('a[href*="/progress/weight"]').first().click();else await p.locator('[data-nutrition-feature=weight]').click();
     await weight();assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'progress');await p.reload();await weight();await p.locator('[data-back]').click();await ready();assert.equal(new URL(p.url()).pathname+new URL(p.url()).search,actual,'Back retains actual filters/date after reload');cases++;
    }
    await p.goto(base+'/me/explore');await ready();await p.getByRole('searchbox',{name:'Search features'}).fill('weight');await p.locator('details').filter({has:p.locator('a[href*="/progress/weight"]')}).locator('summary').click();await p.locator('a[href*="/progress/weight"]').first().click();await weight();assert.equal(await p.locator('[data-back]').innerText(),'Explore Kinetta');await p.locator('[data-back]').click();await ready();assert.equal(new URL(p.url()).pathname,'/me/explore');cases++;
    await p.goto(base+'/progress');await ready();holdWeights=true;await p.evaluate(()=>invalidate('/api/food'));await p.locator('[data-progress-feature=weight]').click();await weight();await p.locator('.wform input').fill('171.2');for(let n=0;n<100&&!weightsRelease;n++)await p.waitForTimeout(50);assert(weightsRelease,'Late weight read held');weightsRelease();await until(p,()=>App.cache.has('/api/food/weights?days=3650'),'Late weight read painted');assert.equal(await p.locator('.wform input').inputValue(),'171.2','Late read preserves typed weigh-in');assert(await p.locator('.wform input').evaluate(n=>n===document.activeElement&&n.selectionStart===5&&n.selectionEnd===5),'Late read preserves focused input and caret');await p.locator('.weight-heading h1').click();assert.equal(await p.locator('.wform input').inputValue(),'171.2','Background dismiss preserves draft');
    assert(await p.locator('.wform input').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));await p.locator('#weight-help').click();assert.match(await p.locator('.sheet').innerText(),/private|never appear/);await p.locator('.sheet header [data-close]').click();assert.equal(await p.locator('.wform input').inputValue(),'171.2');cases++;
    await p.goto(base+'/me/settings?setup=body');await ready();await p.locator('#m-form').waitFor();assert.equal(new URL(p.url()).search,'','Body deep-link query consumed without losing readiness');await p.getByRole('button',{name:'Log weight',exact:true}).click();await p.locator('#quick-weight').waitFor();assert.equal(await p.locator('#m-form').count(),0,'One form after quick-log shortcut');await p.locator('#quick-weight input').fill('173.4');await p.locator('.sheet header h2').click();assert.equal(await p.locator('#quick-weight input').inputValue(),'173.4','Quick-log draft survives background keyboard dismissal');cases++;
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);console.log(`Weight journeys ${size.width}/${size.root}px ${theme}: aliases, actual Back/reload, Nutrition/Insights/Explore, two-tap form, private help, Body shortcut and drafts PASS`);
   }finally{await c.close();}
  }
 }finally{await browser.close();}
 console.log(`Weight journeys: ${cases} rendered paths PASS`);
})().catch(error=>{console.error(error);process.exitCode=1;});
