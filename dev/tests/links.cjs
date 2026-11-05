// Crawl concrete rendered href/data-href values, source literals and go() destinations observed in real journeys.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {scenes,journeys}=require('./journey_scenes.cjs'),{intention,literalTargets,fetchDocument}=require('./link_contract.cjs');
const {fixturePage}=require('./ui_fixture_browser.cjs');
const {boundary,context,fixtureSessions,ready,visibleTitles,closeSheets}=require('./journey_browser.cjs');
const base=process.env.KINETTA_URL,project=process.env.KINETTA_PROJECT,partial=process.argv.includes('--rendered-only');
let checking='collecting initial scenes';
const collect=p=>p.evaluate(()=>[...document.querySelectorAll('a[href],[data-href]')].map(node=>{const raw=node.getAttribute('href')||node.dataset.href;if(!raw)return null;const url=new URL(raw,location.href);return {href:url.origin===location.origin?url.pathname+url.search+url.hash:url.href,label:node.getAttribute('aria-label')||node.textContent.trim(),source:location.pathname+location.search,download:node.hasAttribute('download')};}).filter(Boolean));
(async()=>{
 boundary();const started=Date.now(),fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_JOURNEY_FIXTURES||'/tmp/'+project+'-journeys.json'));
 const selected=scenes(fixtures),recursive=new Set(['alex',fixtures.journey.login]);
 const remaining=Number(process.env.KINETTA_JOURNEY_DEADLINE_MS||started+240000)-started;assert(remaining>0,'Journey batch deadline already expired');
 const browser=await chromium.launch(),targets=new Map(),contexts=new Map(),outcomes=[];let registry,broken,discovered=0,probe;
 let expired=false;const watchdog=setTimeout(()=>{expired=true;console.error('Link check exceeded its deadline at '+checking);browser.close().catch(()=>{});},Math.min(remaining,240000));
 const add=(link,login)=>{
  const result=intention(link,base,registry,login);discovered++;if(['external','local-document'].includes(result.kind))return;
  const url=new URL(result.url);url.searchParams.sort();const key=login+' '+url.pathname+url.search+url.hash;
  if(!targets.has(key)){assert(targets.size<1000,'Link graph exceeded 1000 destinations; inspect its growth instead of truncating coverage');targets.set(key,{link,login,result});}
 };
 try{
  const sessions=await fixtureSessions(browser,base,[...selected,...selected.map(scene=>({...scene,native:false})),...journeys(fixtures)]);
  for(const scene of selected){
   const f=await fixturePage(browser,base,fixtures,sessions,scene,{width:390,height:844,root:16},'light');
   try{
    // Deferred routes are declared by the eager router but intentionally do not
    // enter App.pages until their bundle loads. Recognize those exact patterns
    // here; each discovered destination is still opened below and must register
    // a real App.pages route after loading.
    registry=registry||await f.p.evaluate(()=>[
     ...App.pages.map(page=>({source:page.re.source,flags:page.re.flags})),
     ...lazyRouteBundles.map(({re})=>({source:re.source,flags:re.flags})),
    ]);
    for(const link of await collect(f.p))add(link,scene.login);
    if(scene.name==='Me'){
     const anchor=f.p.locator('a.mileage-progress').first();await anchor.waitFor();const original=await anchor.getAttribute('href');
     await anchor.evaluate(n=>n.setAttribute('href','/progress?view=training'));
     const bad=(await collect(f.p)).find(link=>link.href==='/progress?view=training');assert(bad,'Real rendered link was deliberately broken');
     assert.throws(()=>add(bad,scene.login),error=>{broken=error.message;return /unsupported view=training/.test(broken);});
     await anchor.evaluate((n,href)=>n.setAttribute('href',href),original);
     await f.p.evaluate(()=>{const h=document.createElement('h1');h.hidden=true;h.dataset.linkHeadingProof='';h.textContent='Fictional hidden heading proof';document.querySelector('#page').append(h);});
     assert(!(await visibleTitles(f.p)).includes('Fictional hidden heading proof'),'A hidden matching heading cannot validate a destination');
     await f.p.locator('[data-link-heading-proof]').evaluate(h=>h.remove());
    }
    assert.deepEqual(f.pageErrors,[],'No collection page exception');
   }finally{await f.c.close();}
  }
  assert(broken,'Broken View progress browser proof ran');
  const directory=path.resolve(__dirname,'../../app/static');
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.js'))){
   for(const href of literalTargets(fs.readFileSync(path.join(directory,name),'utf8')))add({href,label:'',source:name+' go()'},href==='/segments/review'?fixtures.journey.login:'alex');
  }
  if(!partial){
   const report=JSON.parse(fs.readFileSync(process.env.KINETTA_JOURNEY_REPORT||'/tmp/'+project+'-journeys-report.json'));
   assert.equal(report.mode,'complete','A selected journey is not full dynamic go() coverage');
   assert(report.cases.every(row=>row.passed),'All journeys must pass before complete link acceptance');
   assert.equal(report.fixture_sha256,createHash('sha256').update(fs.readFileSync(process.env.KINETTA_JOURNEY_FIXTURES||'/tmp/'+project+'-journeys.json')).digest('hex'),'Journey report must match this fixture');
   assert.deepEqual(report.cases.map(row=>row.id).sort(),journeys(fixtures).map(row=>row.id).sort(),'Full journey report required for observed dynamic go() coverage');
   for(const row of report.cases)for(const href of row.go)add({href,label:'',source:row.id+' observed go()'},row.login);
  }
  for(const {link,login,result} of targets.values()){
   checking=login+' '+link.source+': '+link.href;
   const kit=result.url.pathname==='/me/kit',key=login+':'+kit;let f=contexts.get(key);
   if(!f){
    if(contexts.size>=2){const oldest=contexts.keys().next().value;await contexts.get(oldest).c.close();contexts.delete(oldest);}
    f=await context(browser,base,fixtures,sessions,{id:'link-crawl',login,kit});
   }else contexts.delete(key);
   contexts.set(key,f);
   f.test({id:'link-crawl',login,kit,segmentReview:!!result.segmentReview});
   probe=f.p;
   if(result.kind==='document'){
    const response=await fetchDocument(f.c.request,result.url.href,base);
    assert.equal(new URL(response.url()).origin,new URL(base).origin,'Internal document redirect must stay inside the fixture');
   }else if(result.kind==='download'){
    assert.equal(result.url.pathname,'/api/account/export','Only the explicit account export action is treated as a download');
    assert(link.download,'Account export must keep its download marker');
   }else{
    await closeSheets(f.p);
    if(result.segmentReview){
     assert.equal(login,fixtures.journey.login,'Review draft must belong to this account');
     if(!f.p.url().startsWith(base)){await f.p.goto(base+'/progress/segments');await ready(f.p);}
     await f.p.evaluate(d=>{window.journeyGoTargets.length=0;Segments.review(d);},fixtures.journey.segment);
    }else if(f.p.url().startsWith(base))await f.p.evaluate(url=>{window.journeyGoTargets.length=0;go(url);},link.href);else await f.p.goto(new URL(link.href,base).href);
    if(result.dialog)await f.p.locator(result.dialog.ready).waitFor({state:'visible'});else await ready(f.p);
    if(result.segmentReview){assert.equal(await f.p.locator('#sr-form input[name=name]').inputValue(),fixtures.journey.segment.name);assert(await f.p.locator('#sr-form input[name=aud][value=me]').isChecked());assert(await f.p.locator('#sr-create').isEnabled());}
    const actual=new URL(f.p.url());assert.equal(actual.pathname.replace(/\/+$/,'')||'/me',result.canonical,`${link.source}: unexpected redirect for ${link.href}`);
    assert(await f.p.evaluate(()=>App.pages.some(page=>page.re.test(location.pathname.replace(/\/+$/,'')||'/me'))),'No unknown-route fallback');
    const titles=await visibleTitles(f.p);
    if(result.titleInput){const field=f.p.locator(result.titleInput);await field.waitFor({state:'visible'});titles.push(await field.inputValue());}
    // The set logger intentionally has no heading: its loaded exercise rows identify that editor.
    if(result.ready)await f.p.locator(result.ready).first().waitFor({state:'visible'});
    else assert(titles.some(title=>title.trim()),'Destination has a visible page title: '+link.href);
    if(result.heading)assert(titles.some(title=>title.toLowerCase().includes(result.heading.toLowerCase())),`${link.href}: expected ${result.heading}, saw ${titles.join(' / ')}`);
    assert(!titles.some(title=>/^(?:Not available|Not found)$/.test(title.trim())),'Missing record destination: '+link.href);
    assert.deepEqual(f.errors,[],'No destination page exception');
    assert.deepEqual(f.httpErrors,[],'No destination API failure');
    assert.deepEqual(f.blocked,[],'No unexpected destination mutation');
    if(recursive.has(login))for(const next of await collect(f.p))add(next,login);
    for(const href of await f.p.evaluate(()=>window.journeyGoTargets||[]))add({href,label:'',source:link.href+' observed go()'},login);
   }
   outcomes.push({login,source:link.source,href:link.href,canonical:result.canonical,kind:result.kind});
   if(outcomes.length%25===0)console.log(`Links: ${outcomes.length} checked, ${targets.size} discovered`);
  }
 }catch(error){
  if(probe){const details=await probe.evaluate(()=>({url:location.href,headings:[...document.querySelectorAll('#page h1,.sheet h2')].map(n=>({text:n.textContent,display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility,box:n.getBoundingClientRect().toJSON()})),text:document.querySelector('#page')?.innerText.slice(0,1000)})).catch(()=>null);console.error(JSON.stringify(details));}
  throw error;
 }finally{clearTimeout(watchdog);for(const f of contexts.values())await f.c.close().catch(()=>{});await browser.close();}
 assert(!expired,'Link check must finish within four minutes');
 const report={fictional:true,mode:partial?'PARTIAL without journey go() coverage':'complete including journey go()',recursive_accounts:[...recursive],scenes:selected.length,validated_links:discovered,targets:outcomes,deliberately_broken_link:broken,elapsed_seconds:(Date.now()-started)/1000};
 fs.writeFileSync(process.env.KINETTA_LINK_REPORT||'/tmp/'+project+'-links-report.json',JSON.stringify(report,null,2));
 console.log(`Links: ${outcomes.length} destinations checked; broken view rejected (${report.mode})`);
})().catch(error=>{console.error('Link check failed at '+checking);console.error(error);process.exitCode=1;});
