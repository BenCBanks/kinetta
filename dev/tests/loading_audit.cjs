// Diagnostic-only 390px loading filmstrips for fictional main-screen fixtures.
// Run spacing_prepare.py first; screenshots/reports stay outside the repository.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
const {scenes}=require('./spacing_screens.cjs');

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
const safe=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

async function state(page){
 return page.evaluate(()=>({
  readyState:document.readyState,
  height:document.documentElement.scrollHeight,
  title:document.title,
  heading:document.querySelector('h1')?.textContent?.trim()||'',
  text:document.body?.innerText?.slice(0,240)||'',
  elapsed:Math.round(performance.now()-(window.__loadingAuditStart||performance.timeOrigin)),
  cls:window.__loadingAudit?.cls||0,
  shifts:window.__loadingAudit?.shifts||[]
 }));
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
    opened=await fixturePage(browser,base,fixtures,sessions,scene,{width:390,height:844,root:16},theme);
    const {c,p,auth,writes,pageErrors}=opened;
    await p.emulateMedia({reducedMotion:'no-preference'});
    const client=await c.newCDPSession(p);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled',{cacheDisabled:true});
    await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:51200,uploadThroughput:25600,connectionType:'cellular3g'});
    await p.addInitScript(()=>{
     window.__loadingAuditStart=performance.now();window.__loadingAudit={cls:0,shifts:[]};
     try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){window.__loadingAudit.cls+=entry.value;window.__loadingAudit.shifts.push({at:Math.round(entry.startTime),value:entry.value,sources:(entry.sources||[]).slice(0,4).map(source=>({tag:source.node?.tagName||'',id:source.node?.id||'',className:String(source.node?.className||'').slice(0,80)}))});}}).observe({type:'layout-shift',buffered:true});}catch{}
    });
    const begin=Date.now();
    await p.goto(base+scene.route,{waitUntil:'commit'});
    const filmstrip=[];
    for(const target of frames){
     const remaining=target-(Date.now()-begin);if(remaining>0)await p.waitForTimeout(remaining);
     const file=path.join(output,`${safe(scene.name)}-${theme}-${target}ms.png`);
     await p.screenshot({path:file,animations:'disabled'});
     filmstrip.push({target_ms:target,actual_ms:Date.now()-begin,...await state(p),file});
    }
    await p.locator(scene.ready).first().waitFor({state:'attached',timeout:30000});
    const ready=await state(p);
    assert.equal(await p.evaluate(id=>App.me?.id===id,auth.id),true,'Intended fictional fixture account remains signed in');
    assert.deepEqual(pageErrors,[],`${scene.name} has no browser errors`);
    assert.deepEqual(writes,[],`${scene.name} loading makes no writes`);
    results.push({screen:scene.name,theme,route:scene.route,filmstrip,ready_ms:ready.elapsed,final_cls:ready.cls,shifts:ready.shifts});
    console.log(`${scene.name} ${theme}: ready ${ready.elapsed}ms, CLS ${ready.cls.toFixed(4)}, ${ready.shifts.length} layout shifts`);
   }catch(error){errors.push({screen:scene.name,error:error.message});console.error(`${scene.name}: ${error.message}`);}
   finally{await opened?.c.close();}
  }
 }finally{await browser.close();}
 const report={diagnostic_only:true,fictional:true,viewport:'390x844',themes:['light','dark'],network:'150ms latency, 400kbps down, 200kbps up; cache disabled',frames_ms:frames,results,errors};
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 console.log(`Loading audit: ${results.length}/${wanted.length*themes.length} screen/theme cases, ${errors.length} errors; ${reportPath}`);
 if(errors.length||results.length!==wanted.length*themes.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
