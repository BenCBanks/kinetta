'use strict';
// Browser plugin unavailable: existing local Playwright, fictional SQL data, all writes blocked.
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR,session=JSON.parse(fs.readFileSync(process.env.FEATURE_UI_SESSION||'/tmp/kinetta-features-session.json','utf8'));
(async()=>{
 const browser=await chromium.launch();let checks=0;
 try{
  for(const width of [1440,1280,390,330])for(const theme of ['light','dark']){
   const height=width===390?844:width===330?700:900;
   const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   try{
    await context.addCookies([{name:'kinetta_admin',value:session.cookie,url:base+'/api',httpOnly:true,sameSite:'Strict'}]);
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());return u.origin!==base||!['GET','HEAD'].includes(r.method())?route.abort():route.continue();});
    const todayChecks=await require('./admin_today_checks.cjs').install(page,base);
    await page.goto(base+'/admin');await page.locator('#portal:not([hidden])').waitFor();
    const waitView=async view=>{await page.waitForFunction(view=>who&&current===view&&!document.querySelector('#portal').hidden&&document.querySelector('#content').textContent.trim()&&document.querySelector('#content').textContent!=='Loading…'&&(view!=='overview'||document.querySelector('#today-metrics')),view);assert.equal(await page.locator('#retry').isVisible(),false,'page loaded without fallback');};
    const goView=async(view,selector='.admin-nav')=>{await page.locator(selector+' [data-view='+view+']').click();await waitView(view);};
    assert.equal(new URL(page.url()).hash,'#today');
    const destinations=[['overview','today','Today'],['people','people','People'],['reports','reports','Reports'],['beta','requests','Requests'],['more','more','More']];
    for(const [view,hash,title] of destinations){
     await goView(view);assert.equal(new URL(page.url()).hash,'#'+hash);assert.equal(await page.locator('#admin-page-title').innerText(),title);
     assert.equal(await page.locator('.admin-nav [data-primary][aria-current=page]').count(),1);
     const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,nav:document.querySelector('.admin-nav').getBoundingClientRect().toJSON(),header:document.querySelector('.admin-header').getBoundingClientRect().toJSON(),title:document.querySelector('#admin-page-title').getBoundingClientRect().toJSON(),targets:[...document.querySelectorAll('.admin-nav [data-primary]')].map(n=>n.getBoundingClientRect().toJSON())}));
     assert(!geometry.overflow,'no overflow on '+title+' '+width);assert(geometry.targets.every(r=>r.width>=44&&r.height>=44),'all tabs have 44px targets');
     if(width<=700){assert.equal(geometry.nav.height,56);assert(geometry.targets.every(r=>r.height===56));assert.equal(geometry.nav.y+geometry.nav.height,height);}else assert.equal(geometry.nav.width,220);
     assert(geometry.title.y>=geometry.header.y&&geometry.title.y+geometry.title.height<=geometry.header.y+geometry.header.height,'title stays in one header row');
     if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`admin-${hash}-${width}-${theme}.png`),animations:'disabled'});}checks++;
    }
    for(const [view,hash] of [['usage','more/usage'],['readiness','more/readiness'],['logins','more/logins'],['audit','more/audit'],['invites','requests/invitations'],['requests','requests/data'],['segments','reports/segments']]){
     await page.goto(base+'/admin#'+hash);await waitView(view);assert.equal(new URL(page.url()).hash,'#'+hash);checks++;
    }
    await page.goto(base+'/admin#more');await waitView('more');await goView('usage','#content');await page.reload();await waitView('usage');
    await goView('people');await page.goBack();await waitView('usage');await page.goForward();await waitView('people');checks++;
    await page.goto(base+'/admin#unrecognized');await waitView('overview');assert.equal(new URL(page.url()).hash,'#today');
    await page.locator('.skip').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>current),'overview','skip link does not change the selected page');
    await page.locator('.admin-session summary').click();assert(await page.locator('#identity').isVisible());assert(await page.locator('#logout').isVisible());await page.locator('.admin-session summary').click();checks++;
    if(width<=700){await goView('more');await goView('features','#content');}else await goView('features');
    await page.locator('.feature-table').waitFor();await page.getByText('New counting is off',{exact:false}).waitFor();
    assert(await page.locator('.feature-funnel svg').count()>0,'real aggregate funnel visible');checks++;
    assert(await page.locator('.feature-funnel li>div>b').evaluateAll(ns=>ns.every(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length===1;})),'each milestone fraction stays on one line');
    assert(await page.locator('.feature-table tbody tr').first().evaluate(e=>e.getBoundingClientRect().top<700),'first data row stays in the first phone screen');checks++;
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
    const units=page.locator('td[data-label="user-days"]');assert(await units.count()>0);if(width<700){assert(await units.first().evaluate(e=>getComputedStyle(e,'::before').content.includes('user-days')));}else{assert(await units.first().innerText().then(x=>x.includes('user-days')));}checks++;
    const visible=await page.locator('.feature-table tbody tr').count();await page.locator('#feature-hidden').check();assert(await page.locator('.feature-table tbody tr').count()>visible);await page.locator('#feature-hidden').uncheck();checks++;
    const before=await page.locator('.feature-table tbody').innerText();await page.locator('#feature-sort').selectOption('uses:-1');assert.notEqual(await page.locator('.feature-table tbody').innerText(),before);checks++;
    for(const period of ['7','90','12m','30']){
     const response=page.waitForResponse(r=>r.url().includes('/api/admin/features?')&&r.url().includes('period='+period));await page.locator('#feature-period').selectOption(period);assert.equal((await response).status(),200);await page.locator('.feature-table').waitFor();checks++;
    }
    await page.locator('#feature-bucket').selectOption('day');await page.locator('.feature-table').waitFor();checks++;
    const fit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,controls:[...document.querySelectorAll('.feature-controls select')].map(e=>e.getBoundingClientRect().height)}));assert.equal(fit.overflow,false);assert(fit.controls.every(h=>h>=44));assert.deepEqual(errors,[]);checks++;
    if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`features-${width}-${theme}.png`),fullPage:true});await page.screenshot({path:path.join(out,`features-viewport-${width}-${theme}.png`)});await page.locator('.feature-funnel').screenshot({path:path.join(out,`features-funnel-${width}-${theme}.png`)});}
    checks+=await todayChecks();
    checks+=await require('./admin_queue_checks.cjs')(page,base);assert.deepEqual(errors,[]);
    console.log(`Features ${width}px ${theme}: real admin aggregates/funnel, small groups, sorts, all ranges, trend selector, controls and no overflow/errors PASS`);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 console.log(`Feature analytics: ${checks} rendered checks PASS; fictional browser evidence, no physical-device claim`);
})().catch(e=>{console.error(e);process.exit(1);});
