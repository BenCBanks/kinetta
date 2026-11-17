// Diagnostic-only 390px loading filmstrips for fictional main-screen fixtures.
// Run spacing_prepare.py first; screenshots/reports stay outside the repository.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {fixtureSessions}=require('./ui_fixture_browser.cjs');
const {initialize,scenes}=require('./spacing_screens.cjs');
const {seedWeeklyRecapDismissal}=require('./weekly_recap_fixture.cjs');
const screenshotClock=new Date(require('../screenshots/fixture-time.json').instant);
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

const base=process.env.KINETTA_URL||'http://localhost:8798';
const project=process.env.KINETTA_PROJECT||'kinettatest';
const fixturePath=process.env.KINETTA_SPACING_FIXTURES||`/tmp/${project}-spacing-fixtures.json`;
const output=path.resolve(process.env.KINETTA_LOADING_OUTPUT||`/tmp/${project}-loading-audit`);
const reportPath=path.join(output,'report.json');
const allScreens=['Home','Activity detail','Progress','Track ready','Nutrition day','Me','Friends'];
const wanted=process.env.KINETTA_LOADING_SCREENS?process.env.KINETTA_LOADING_SCREENS.split(','):allScreens;
assert(wanted.length>0&&wanted.every(name=>allScreens.includes(name)),'Loading audit screen selection is valid');
const themes=process.env.KINETTA_LOADING_THEMES?process.env.KINETTA_LOADING_THEMES.split(','):['light','dark'];
assert(themes.length>0&&themes.every(theme=>['light','dark'].includes(theme)),'Loading audit theme selection is valid');
const frames=[0,100,250,500,1000];
const width=Number(process.env.KINETTA_LOADING_WIDTH||390);
assert(Number.isInteger(width)&&width>=320&&width<=500,'Loading audit viewport width is supported');
const safe=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

async function state(page){
 return page.evaluate(()=>({
  readyState:document.readyState,
  height:document.documentElement.scrollHeight,
  viewportWidth:innerWidth,
  documentWidth:document.documentElement.scrollWidth,
  title:document.title,
  heading:document.querySelector('h1')?.textContent?.trim()||'',
  text:document.body?.innerText?.slice(0,240)||'',
  appReady:typeof App!=='undefined'&&!!App.pageReady,
  bootFailure:!!document.querySelector('#app .boot'),
  elapsed:Math.round(performance.now()-(window.__loadingAuditStart||performance.timeOrigin)),
  cls:window.__loadingAudit?.cls||0,
  shifts:window.__loadingAudit?.shifts||[],
  feedTools:document.querySelector('#feed-tools')?{busy:document.querySelector('#feed-tools').getAttribute('aria-busy'),posts:document.querySelectorAll('#ff-list .post').length}:null,
  calmPaint:window.__loadingAudit?.paint||null,
  postPaintCls:window.__loadingAudit?.postPaintCls||0,
  postPaintSectionMutations:window.__loadingAudit?.postPaintSectionMutations||0,
  postPaintMutations:window.__loadingAudit?.postPaintMutations||[]
 }));
}

async function captureFrame(page,file){
 const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await paint();
 try{await page.screenshot({path:file,animations:'disabled'});}
 catch(error){
  if(!/captureScreenshot|Unable to capture screenshot/.test(error.message))throw error;
  await page.waitForLoadState('domcontentloaded',{timeout:10000});
  await paint();
  await page.screenshot({path:file,animations:'disabled'});
 }
}

async function coldFixturePage(browser,base,scene,sessions,theme){
 const auth=sessions.get(scene.login+(scene.native?':native':''));
 assert(auth&& (scene.login==='alex'||scene.login.startsWith('zz_test_')),'Fictional fixture session exists');
 const size={width,height:844,root:16},context=await browser.newContext({storageState:auth.storageState,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:'UTC'}),writes=[],pageErrors=[],failed=[];
 try{
  const liftData=scene.lift?await(await context.request.get(base+'/api/activities/'+scene.lift+'/lifts')).json():null;
  await context.addInitScript(initialize,{root:size.root,native:!!scene.native,base,token:auth.token,id:auth.id,lift:scene.lift,liftData});
  if(scene.dismissWeeklyRecap)await seedWeeklyRecapDismissal(context,{id:auth.id,tz:auth.tz},base,screenshotClock);
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{}});
   if(request.method()==='POST'&&url.pathname==='/api/milestones/celebrate')return route.fulfill({json:{items:[],pending:false}});
   if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.abort();}
   if(url.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/__loading_tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:'Demo tiles'}});
   if(url.pathname.startsWith('/__loading_tiles/'))return route.fulfill({contentType:'image/png',body:tile});
   if(request.method()==='GET'&&url.pathname.startsWith('/api/')){
    const delay=150+[...url.pathname].reduce((sum,char)=>(sum+char.charCodeAt(0))%251,0);
    await new Promise(resolve=>setTimeout(resolve,delay));
   }
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));page.on('requestfailed',request=>{const pathname=new URL(request.url()).pathname,error=request.failure()?.errorText||'failed';if(!(pathname.startsWith('/__loading_tiles/')&&error==='net::ERR_ABORTED'))failed.push(`${request.method()} ${pathname}: ${error}`);});
  await page.clock.setFixedTime(screenshotClock);
  await page.addInitScript(()=>{
   window.__loadingAuditStart=performance.now();window.__loadingAudit={cls:0,shifts:[],postPaintCls:0,postPaintSectionMutations:0,postPaintMutations:[]};
   document.addEventListener('kinetta:screen-painted',event=>{const root=event.target,sections={progress:'#p-combined-week,#p-home-totals,#p-explore',home:'#weekly-recap,#feed-tools,#ff-list,#activity-groups-strip',nutrition:'#fd-sum,#fd-meals',me:'#me-overview'}[event.detail.screen]||'';window.__loadingAudit.paint={screen:event.detail.screen,waitedMs:event.detail.waitedMs};window.__loadingAudit.postPaintAt=performance.now();const observer=new MutationObserver(records=>{for(const record of records)if(record.type==='childList'){const target=record.target.nodeType===1?record.target:record.target.parentElement,added=[...record.addedNodes].filter(node=>node.nodeType===1),removed=[...record.removedNodes].filter(node=>node.nodeType===1);if((target===root||target?.closest(sections))&&(added.length||removed.length)){window.__loadingAudit.postPaintSectionMutations++;const path=[];for(let node=target;node&&node!==root;node=node.parentElement)path.push(node.id||String(node.className||node.tagName||''));window.__loadingAudit.postPaintMutations.push({target:target?.id||String(target?.className||target?.tagName||''),path,added:added.length,removed:removed.length});}}});observer.observe(root,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),1800);});
   try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){window.__loadingAudit.cls+=entry.value;if(window.__loadingAudit.postPaintAt&&entry.startTime>window.__loadingAudit.postPaintAt)window.__loadingAudit.postPaintCls+=entry.value;window.__loadingAudit.shifts.push({at:Math.round(entry.startTime),value:entry.value,sources:(entry.sources||[]).slice(0,4).map(source=>({tag:source.node?.tagName||'',id:source.node?.id||'',className:String(source.node?.className||'').slice(0,80)}))});}}).observe({type:'layout-shift',buffered:true});}catch{}
  });
  return {context,page,auth,writes,pageErrors,failed};
 }catch(error){await context.close();throw error;}
}

async function main(){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Loading audit requires a disposable local server');
 const fixtures=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
 assert.equal(fixtures.base,base);assert.equal(fixtures.project,project);
 const selected=scenes(fixtures).filter(scene=>wanted.includes(scene.name)).sort((a,b)=>wanted.indexOf(a.name)-wanted.indexOf(b.name));
 assert.deepEqual(selected.map(scene=>scene.name),wanted,'Every requested main screen has a fixture');
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch(),results=[],errors=[];
 try{
  const sessions=await fixtureSessions(browser,base,selected);
  for(const theme of themes)for(const scene of selected){
   let opened;
   try{
    opened=await coldFixturePage(browser,base,scene,sessions,theme);
    const {context:c,page:p,auth,writes,pageErrors,failed}=opened;
    await p.emulateMedia({reducedMotion:'no-preference'});
    const client=await c.newCDPSession(p);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled',{cacheDisabled:true});
    await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:51200,uploadThroughput:25600,connectionType:'cellular3g'});
    const begin=Date.now();
    await p.goto(base+scene.route,{waitUntil:'commit'});
    const filmstrip=[];
    for(const target of frames){
     const remaining=target-(Date.now()-begin);if(remaining>0)await p.waitForTimeout(remaining);
     const file=path.join(output,`${safe(scene.name)}-${width}-${theme}-${target}ms.png`);
     await captureFrame(p,file);
     filmstrip.push({target_ms:target,actual_ms:Date.now()-begin,...await state(p),file});
    }
    const firstUseful=scene.name==='Home'?'#ff-list .post':scene.ready;
    await p.waitForFunction(selector=>typeof App!=='undefined'&&App.pageReady&&!!document.querySelector(selector)?.getClientRects().length&&!document.querySelector('#app .boot'),firstUseful,{timeout:30000});
    const ready=await state(p);
    assert(ready.documentWidth<=ready.viewportWidth,`${scene.name} has no horizontal viewport overflow: ${ready.documentWidth} > ${ready.viewportWidth}`);
    if(['Home','Progress','Nutrition day','Me'].includes(scene.name)){
     const screen={Home:'home',Progress:'progress','Nutrition day':'nutrition',Me:'me'}[scene.name];
     await p.waitForFunction(name=>window.__loadingAudit?.paint?.screen===name,screen,{timeout:5000});
     await p.waitForTimeout(1900);
     const calm=await state(p);
     assert(calm.calmPaint&&calm.calmPaint.waitedMs<=1500,`${scene.name} paints once after its first reads or the 1.5s cap: ${JSON.stringify(calm.calmPaint)}`);
     assert(calm.postPaintCls<=0.02,`${scene.name} has no visible post-paint layout shift: ${calm.postPaintCls}`);
     assert.equal(calm.postPaintSectionMutations,0,`${scene.name} has no screen section inserted after first paint`);
     await captureFrame(p,path.join(output,`${safe(scene.name)}-${width}-${theme}-painted.png`));
     const home=scene.name==='Home',other=home?'/progress':scene.name==='Progress'?'/activity':scene.name==='Nutrition day'?'/me':'/food',back=home?'/activity':scene.name==='Progress'?'/progress':scene.name==='Nutrition day'?'/food':'/me',readySelector=home?'#ff-list':scene.name==='Progress'?'#p-explore':scene.name==='Nutrition day'?'#fd-sum':'.me-card-sections';
     await p.evaluate(path=>go(path),other);
     await p.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady,{timeout:15000});
     await p.evaluate(()=>{for(const value of App.cache.values())value.at=0;});
     await p.evaluate(path=>go(path),back);
     const immediateSelector=scene.name==='Nutrition day'?'#fd-sum .nutrition-day-summary':scene.name==='Me'?'.me-card-sections[aria-busy="false"]':readySelector;
     await p.waitForFunction(selector=>!document.querySelector('#page')?.hasAttribute('data-paint-gate')&&!!document.querySelector(selector)?.getClientRects().length,immediateSelector,{timeout:200});
     await p.waitForFunction(selector=>typeof App!=='undefined'&&App.pageReady&&!!document.querySelector(selector),readySelector,{timeout:15000});
     const revisit=await p.evaluate(selector=>({placeholder:!!document.querySelector('.paint-gate-placeholder'),busy:document.querySelector('#page')?.hasAttribute('aria-busy'),ready:!!document.querySelector(selector)?.getClientRects().length,feedRows:document.querySelectorAll('#ff-list .post').length}),readySelector);
     assert(!revisit.placeholder&&!revisit.busy,`${scene.name} revisits paint its account-scoped cached screen immediately: ${JSON.stringify(revisit)}`);
     assert(revisit.ready,`${scene.name} revisits keep the useful screen visible: ${JSON.stringify(revisit)}`);
     if(home&&width===390&&theme==='light'){
      await p.evaluate(()=>{window.__normalHomeFeed=homeFeed;homeFeed=()=>Promise.reject(Object.assign(Error('Fictional cached feed failure'),{status:503}));void go('/food');});
      await p.waitForFunction(()=>location.pathname==='/food'&&document.querySelector('#page')?.getBoundingClientRect().height>0,undefined,{timeout:10000});
      await p.evaluate(()=>void go('/activity'));
      await p.waitForSelector('#page .load-error',{timeout:5000});
      assert.match(await p.locator('#page .load-error').innerText(),/Couldn’t load|Couldn't load/,'a cached Home revisit preserves a failed screen read for the router error state');
      await p.evaluate(()=>{homeFeed=window.__normalHomeFeed;void go('/food');});
      await p.waitForFunction(()=>location.pathname==='/food'&&document.querySelector('#page')?.getBoundingClientRect().height>0,undefined,{timeout:10000});

      await p.evaluate(()=>{App.cache.delete('feed:home');localStorage.removeItem('fit.c:feed:home');void go('/activity');});
      await p.waitForSelector('#page[data-paint-gate]',{timeout:5000});
      const routeAt=await p.evaluate(()=>{const t=performance.now();void go('/food');return t;});
      await p.waitForFunction(start=>location.pathname==='/food'&&document.querySelector('#page')&&!document.querySelector('#page').hasAttribute('data-paint-gate')&&document.querySelector('#page').getBoundingClientRect().height>0&&performance.now()-start<=200,routeAt,{timeout:200});

      await p.evaluate(()=>{App.cache.delete('feed:home');localStorage.removeItem('fit.c:feed:home');window.__normalHomeFeed=homeFeed;homeFeed=()=>new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(Error('Fictional late feed failure'),{status:503})),1650));void go('/activity');});
      await p.waitForSelector('#page[data-paint-gate]',{timeout:5000});
      await p.waitForTimeout(1510);
      const revealed=await p.evaluate(()=>({gate:document.querySelector('#page')?.hasAttribute('data-paint-gate'),busy:document.querySelector('#page')?.hasAttribute('aria-busy'),error:!!document.querySelector('#page .load-error')}));
      assert.deepEqual(revealed,{gate:false,busy:false,error:false},'the cap reveals the real Home while its failed read is still pending');
      await p.waitForSelector('#page .load-error',{timeout:1000});
      assert.match(await p.locator('#page .load-error').innerText(),/Couldn’t load|Couldn't load/,'an API rejection after the reveal cap still reaches the error screen');
      await p.evaluate(()=>{homeFeed=window.__normalHomeFeed;});
     }
    }
    assert.equal(await p.evaluate(id=>App.me?.id===id,auth.id),true,'Intended fictional fixture account remains signed in');
    assert.deepEqual(pageErrors,[],`${scene.name} has no browser errors`);
    assert.deepEqual(failed,[],`${scene.name} has no failed requests`);
    assert.deepEqual(writes,[],`${scene.name} loading makes no writes`);
    results.push({screen:scene.name,theme,route:scene.route,filmstrip,ready_ms:ready.elapsed,final_cls:ready.cls,shifts:ready.shifts});
    console.log(`${scene.name} ${theme}: ready ${ready.elapsed}ms, CLS ${ready.cls.toFixed(4)}, ${ready.shifts.length} layout shifts`);
   }catch(error){
    const diagnostic=opened?{state:await state(opened.page).catch(()=>null),failed:opened.failed,pageErrors:opened.pageErrors}:null;
    errors.push({screen:scene.name,theme,error:error.message,diagnostic});console.error(`${scene.name} ${theme}: ${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
   }
   finally{await opened?.context.close();}
  }
 }finally{await browser.close();}
 const report={diagnostic_only:true,fictional:true,viewport:`${width}x844`,themes:['light','dark'],network:'150ms RTT plus deterministic 150–400ms delay per API request; cache disabled',frames_ms:frames,results,errors};
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 console.log(`Loading audit: ${results.length}/${wanted.length*themes.length} screen/theme cases, ${errors.length} errors; ${reportPath}`);
 if(errors.length||results.length!==wanted.length*themes.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
