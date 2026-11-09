// Local: prepare with KINETTA_URL/KINETTA_PROJECT python3 dev/tests/spacing_prepare.py, then run this file with
// NODE_PATH pointing to Playwright. KINETTA_SPACING_FIXTURES selects its JSON; KINETTA_SPACING_REPORT selects output.
// KINETTA_SPACING_SCREENS is a comma-separated local subset. CI runs every scene; all saves/devices are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {until,settle,fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
const {audit,validateExceptions,combineMeasurements}=require('./spacing_geometry.cjs'),{collectSpacing}=require('./spacing_dom.cjs'),{scenes,initialize,notificationState,modalState}=require('./spacing_screens.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Spacing evidence requires a disposable local server');
const fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_SPACING_FIXTURES||'/tmp/'+project+'-spacing-fixtures.json','utf8'));
assert.equal(fixtures.base,base);assert.equal(fixtures.project,project);
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'spacing_exceptions.json'),'utf8'));validateExceptions(rules);
const report=path.resolve(process.env.KINETTA_SPACING_REPORT||'/tmp/'+project+'-spacing-report.json'),pictures=process.env.KINETTA_SPACING_SHOTS;
(async()=>{
 const browser=await chromium.launch(),results=[],errors=[];let sessions;
 let selected=scenes(fixtures);if(process.env.KINETTA_SPACING_SCREENS){const names=process.env.KINETTA_SPACING_SCREENS.split(',');selected=selected.filter(s=>names.includes(s.name));assert.equal(selected.length,names.length,'Every selected scene exists');}
 try{
  sessions=await fixtureSessions(browser,base,selected);
  const clockMatrix=!!process.env.KINETTA_SPACING_CLOCK,sizes=clockMatrix?[{width:390,height:844,root:16}]:[{width:390,height:844,root:16},{width:330,height:667,root:16}],themes=clockMatrix?['light']:['light','dark'];
  for(const size of sizes)for(const theme of themes)for(const scene of selected){
   let c;const writes=[],pageErrors=[];
   try{
    const opened=await fixturePage(browser,base,fixtures,sessions,scene,size,theme);c=opened.c;const {p,auth}=opened;
    // Reuse the guarded context's live collectors throughout traversal.
    const writes=opened.writes,pageErrors=opened.pageErrors;
    if(scene.todayPlan){
     const row=p.locator('#t-today [data-today-activity]'),title=row.locator('.me-today-copy > b');
     assert.equal(await row.count(),1,'The deterministic Me Today fixture renders its planned activity row');
     assert.equal(await title.count(),1,'The planned activity row has a visible title');
     assert.equal(await row.locator('.me-today-copy > small').innerText(),'On your plan','The activity row is from the active plan');
     assert.equal(await row.getAttribute('href'),'/plan','Tapping the planned activity opens the plan');
     const font=await title.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
     assert(font>=size.root*15/16-.02&&font<=size.root+.02,`Today workout action text follows the body scale (${font}px at ${size.root}px root)`);
    }
    const measurements=[],seen=new Set(),allTexts=new Map(),exposure=new Map();
    const measure=async()=>{
     assert(await p.evaluate(id=>App.me?.id===id,auth.id),'The intended fictional account remains signed in');assert.equal(await p.locator('.login').count(),0,'The intended screen cannot be replaced by login');
     await p.locator(scene.recap?'#recap-preview':scene.ready).first().waitFor({state:'attached'});
     const snapshot=await p.evaluate(collectSpacing,{screen:scene.name,rules});
     for(const t of snapshot.texts)allTexts.set(t.key,t);
     const score=r=>Math.min(44,r.width)*Math.min(44,r.height);
     for(const t of snapshot.targets){const old=exposure.get(t.key),bestUsable=old&&score(old.bestUsable)>=score(t.usableRect)?old.bestUsable:t.usableRect;exposure.set(t.key,{...t,bestUsable,seenFully:old?.seenFully||t.fullyVisible,exposed:old?.exposed||t.hit});}
     const key=JSON.stringify(snapshot.targets.map(t=>[t.key,t.rect]));if(!seen.has(key)){measurements.push(audit(snapshot,rules));seen.add(key);}
    };
    const frame=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    // Traverse below the fold too. A sheet scrolls independently from its inert background.
    let end=false,traversedEnd=false;
    for(let step=0;step<30;step++){
     await settle(p);await measure();
     // Reveal every column/slide too, so a partly exposed rail item is measured when reachable.
     const rails=await p.evaluate(()=>{document.querySelectorAll('[data-spacing-rail]').forEach(n=>n.removeAttribute('data-spacing-rail'));let id=0;return[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return n.scrollWidth>n.clientWidth+1&&/auto|scroll/.test(getComputedStyle(n).overflowX)&&r.width>0&&r.bottom>0&&r.top<innerHeight;}).map(n=>{n.dataset.spacingRail=String(++id);return{id:n.dataset.spacingRail,start:n.scrollLeft,max:n.scrollWidth-n.clientWidth,width:n.clientWidth};});});
     for(const rail of rails){
      assert(rail.max/Math.max(1,rail.width)<30,'Horizontal rail fits the bounded audit traversal');
      // Half-width steps avoid skipping a card snap that fully exposes a corner control.
      for(let x=0;;x=Math.min(rail.max,x+Math.max(44,rail.width*.5))){await p.locator(`[data-spacing-rail="${rail.id}"]`).evaluate((n,x)=>{n.scrollLeft=x;},x);await frame();await measure();if(x>=rail.max)break;}
      await p.locator(`[data-spacing-rail="${rail.id}"]`).evaluate((n,x)=>{n.scrollLeft=x;},rail.start);await frame();
     }
     if(end){traversedEnd=true;break;}
     end=await p.evaluate(()=>{const sheet=document.querySelector('.scrim:not([inert]):not(.is-closing) .sheet'),body=sheet?.querySelector(':scope > .sbody'),el=body&&body.scrollHeight>body.clientHeight+1?body:sheet||document.querySelector('.ph-view:not([inert]),.map.full:not([inert])')||document.scrollingElement,before=el.scrollTop;el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,before+Math.max(200,el.clientHeight*.7));return Math.abs(el.scrollTop-before)<1||el.scrollTop+el.clientHeight>=el.scrollHeight-1;});
    }
    assert(traversedEnd,'Vertical content fits the bounded audit traversal');
    // Hero limits apply to the whole card, including values encountered at different scroll positions.
    measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[],texts:[...allTexts.values()]},rules));
    // A sticky/header layer must not hide a target at every position where it can be fully in view.
    for(const t of exposure.values())if(t.bestUsable.width<43.98||t.bestUsable.height<43.98||t.seenFully&&!t.exposed)measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[{...t,rect:t.bestUsable,unreachable:t.seenFully&&!t.exposed}],texts:[]},rules));
    if(pictures){fs.mkdirSync(pictures,{recursive:true});await p.evaluate(todayPlan=>{const section=todayPlan&&document.querySelector('#t-today .me-today');window.scrollTo(0,section?Math.max(0,window.scrollY+section.getBoundingClientRect().top-96):0);const sheet=document.querySelector('.scrim:not([inert]):not(.is-closing) .sheet'),body=sheet?.querySelector(':scope > .sbody'),el=body&&body.scrollHeight>body.clientHeight+1?body:sheet;el?.scrollTo(0,0);},!!scene.todayPlan);await settle(p);await p.screenshot({path:path.join(pictures,scene.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+size.width+'-'+theme+'.png')});}
    const {violations,exceptionsUsed}=combineMeasurements(measurements,rules);
    results.push({screen:scene.name,width:size.width,root:size.root,theme,violations,exceptionsUsed});
    const expectedWrites=['Activity detail','Activity photo viewer','Activity full map'].includes(scene.name)?new Set(['/api/milestones/celebrate']):new Set();
    const unexpectedWrites=writes.filter(path=>!expectedWrites.has(path));
    if(pageErrors.length||unexpectedWrites.length)errors.push({screen:scene.name,width:size.width,theme,pageErrors,writes:unexpectedWrites});
    console.log(`${scene.name} ${size.width}/${size.root} ${theme}: ${violations.length} violations`);
    for(const v of violations.slice(0,8))console.log(`  ${v.metric}: ${v.element}${v.neighbour?' ↔ '+v.neighbour:''} measured ${JSON.stringify(v.actual)}, expected ${JSON.stringify(v.expected)}`);
   }catch(e){errors.push({screen:scene.name,width:size.width,theme,error:e.message});console.error(scene.name,e.message);}finally{await c?.close();}
  }
 }finally{await browser.close();}
 fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify({results,errors},null,2));
 const failures=results.reduce((n,r)=>n+r.violations.length,0);console.log(`Spacing audit: ${results.length} cases, ${failures} violations, ${errors.length} loading/guard errors. Report: ${report}`);
 if(process.env.GITHUB_STEP_SUMMARY){
  const cell=v=>String(v).replace(/\|/g,'\\|').replace(/`/g,"'").replace(/\n/g,' ');
  let summary=`## Spacing audit\n\n${results.length} cases; ${failures} violations; ${errors.length} loading/guard errors. Fictional browser evidence is attached to this job.\n\n| Screen | Width/root | Theme | Violations |\n| --- | --- | --- | ---: |\n`;
  for(const r of results)summary+=`| ${cell(r.screen)} | ${r.width}/${r.root} | ${r.theme} | ${r.violations.length} |\n`;
  const first=results.flatMap(r=>r.violations).slice(0,30);
  if(first.length){summary+='\n| Screen | Element | Check | Measured | Required |\n| --- | --- | --- | --- | --- |\n';for(const v of first)summary+=`| ${cell(v.screen)} | ${cell(v.element)} | ${v.metric} | ${cell(JSON.stringify(v.actual))} | ${cell(JSON.stringify(v.expected))} |\n`;}
  for(const e of errors)summary+='\n'+cell(e.screen)+': '+cell(e.error||JSON.stringify(e))+'\n';
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 }
 if(failures||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
