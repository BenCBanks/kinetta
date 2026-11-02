// Crawl concrete rendered href/data-href values, source literals and go() destinations observed in real journeys.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {scenes,journeys}=require('./journey_scenes.cjs'),{intention,literalTargets}=require('./link_contract.cjs');
const {fixturePage}=require('./ui_fixture_browser.cjs');
const {boundary,context,fixtureSessions,ready,settle}=require('./journey_browser.cjs');
const base=process.env.KINETTA_URL,project=process.env.KINETTA_PROJECT,partial=process.argv.includes('--rendered-only');
const collect=p=>p.evaluate(()=>[...document.querySelectorAll('a[href],[data-href]')].map(node=>{const raw=node.getAttribute('href')||node.dataset.href;if(!raw)return null;const url=new URL(raw,location.href);return {href:url.origin===location.origin?url.pathname+url.search+url.hash:url.href,label:node.getAttribute('aria-label')||node.textContent.trim(),source:location.pathname+location.search};}).filter(Boolean));
(async()=>{
 boundary();const started=Date.now(),fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_JOURNEY_FIXTURES||'/tmp/'+project+'-journeys.json'));
 const selected=scenes(fixtures),browser=await chromium.launch(),targets=new Map(),contexts=new Map(),outcomes=[];let registry,broken;
 const add=(link,login)=>{const result=intention(link,base,registry);if(result.kind!=='external'&&result.kind!=='local-document'&&!targets.has(link.href))targets.set(link.href,{link,login,result});};
 try{
  const sessions=await fixtureSessions(browser,base,[...selected,...journeys(fixtures)]);
  for(const scene of selected){
   const f=await fixturePage(browser,base,fixtures,sessions,scene,{width:390,height:844,root:16},'light');
   try{
    await settle(f.p);registry=registry||await f.p.evaluate(()=>App.pages.map(page=>({source:page.re.source,flags:page.re.flags})));
    for(const link of await collect(f.p))add(link,scene.login);
    if(scene.name==='Me'){
     const anchor=f.p.locator('a.mileage-progress').first();await anchor.waitFor();const original=await anchor.getAttribute('href');
     await anchor.evaluate(n=>n.setAttribute('href','/progress?view=training'));
     const bad=(await collect(f.p)).find(link=>link.href==='/progress?view=training');assert(bad,'Real rendered link was deliberately broken');
     assert.throws(()=>add(bad,scene.login),error=>{broken=error.message;return /unsupported view=training/.test(broken);});
     await anchor.evaluate((n,href)=>n.setAttribute('href',href),original);
    }
    assert.deepEqual(f.pageErrors,[],'No collection page exception');
   }finally{await f.c.close();}
  }
  assert(broken,'Broken View progress browser proof ran');
  const directory=path.resolve(__dirname,'../../app/static');
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.js'))){
   for(const href of literalTargets(fs.readFileSync(path.join(directory,name),'utf8')))add({href,label:'',source:name+' go()'},fixtures.journey.login);
  }
  if(!partial){
   const report=JSON.parse(fs.readFileSync(process.env.KINETTA_JOURNEY_REPORT||'/tmp/'+project+'-journeys-report.json'));
   assert.equal(report.cases.length,journeys(fixtures).length,'Full journey report required for observed dynamic go() coverage');
   for(const row of report.cases)for(const href of row.go)add({href,label:'',source:row.id+' observed go()'},fixtures.journey.login);
  }
  for(const {link,login,result} of targets.values()){
   const kit=result.url.pathname==='/me/kit',key=login+':'+kit;let f=contexts.get(key);
   if(!f){f=await context(browser,base,fixtures,sessions,{id:'link-crawl',login,kit});contexts.set(key,f);}
   if(result.kind==='document'){
    const response=await f.c.request.get(result.url.href);assert.equal(response.status(),200,link.href+' document');
    assert.equal(new URL(response.url()).origin,new URL(base).origin,'Internal download never escapes the fixture');
   }else{
    if(f.p.url().startsWith(base))await f.p.evaluate(url=>go(url),link.href);else await f.p.goto(new URL(link.href,base).href);
    await ready(f.p);await settle(f.p);
    const actual=new URL(f.p.url());assert.equal(actual.pathname.replace(/\/+$/,'')||'/me',result.canonical,`${link.source}: unexpected redirect for ${link.href}`);
    assert(await f.p.evaluate(()=>App.pages.some(page=>page.re.test(location.pathname.replace(/\/+$/,'')||'/me'))),'No unknown-route fallback');
    const titles=await f.p.locator('#page h1,.profile-page-title,.sheet h2').allTextContents();
    assert(titles.some(title=>title.trim()),'Destination has a visible page title: '+link.href);
    if(result.heading)assert(titles.some(title=>title.toLowerCase().includes(result.heading.toLowerCase())),`${link.href}: expected ${result.heading}, saw ${titles.join(' / ')}`);
    assert(!/^(?:Not available|Not found)$/.test(await f.p.locator('#page h1').first().textContent().catch(()=>'')),'Missing record destination: '+link.href);
    assert.deepEqual(f.errors,[],'No destination page exception');
    assert.deepEqual(f.httpErrors,[],'No destination API failure');
   }
   outcomes.push({source:link.source,path:result.url.pathname,kind:result.kind});
  }
 }finally{for(const f of contexts.values())await f.c.close();await browser.close();}
 const report={fictional:true,mode:partial?'PARTIAL rendered/static only':'complete including observed go()',scenes:selected.length,targets:outcomes,deliberately_broken_link:broken,elapsed_seconds:(Date.now()-started)/1000};
 fs.writeFileSync(process.env.KINETTA_LINK_REPORT||'/tmp/'+project+'-links-report.json',JSON.stringify(report,null,2));
 console.log(`Links: ${outcomes.length} destinations checked; broken view rejected (${report.mode})`);
})().catch(error=>{console.error(error);process.exitCode=1;});
