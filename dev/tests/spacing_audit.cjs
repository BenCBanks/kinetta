// Local: prepare with KINETTA_URL/KINETTA_PROJECT python3 dev/tests/spacing_prepare.py, then run this file with
// NODE_PATH pointing to Playwright. KINETTA_SPACING_FIXTURES selects its JSON; KINETTA_SPACING_REPORT selects output.
// KINETTA_SPACING_SCREENS is a comma-separated local subset. CI runs every scene; all saves/devices are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {audit,validateExceptions,combineMeasurements}=require('./spacing_geometry.cjs'),{collectSpacing}=require('./spacing_dom.cjs'),{scenes,initialize,notificationState}=require('./spacing_screens.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Spacing evidence requires a disposable local server');
const fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_SPACING_FIXTURES||'/tmp/'+project+'-spacing-fixtures.json','utf8'));
assert.equal(fixtures.base,base);assert.equal(fixtures.project,project);
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'spacing_exceptions.json'),'utf8'));validateExceptions(rules);
const report=path.resolve(process.env.KINETTA_SPACING_REPORT||'/tmp/'+project+'-spacing-report.json'),pictures=process.env.KINETTA_SPACING_SHOTS;
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function until(p,fn,label){for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);}
async function settle(p){
 let previous='',stable=0;
 for(let n=0;n<100&&stable<3;n++){
  const now=await p.evaluate(()=>JSON.stringify([document.fonts.status,document.documentElement.scrollHeight,...[...document.querySelectorAll('button,input,select,textarea')].filter(n=>n.getBoundingClientRect().width).map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})]));
  stable=now===previous?stable+1:0;previous=now;if(stable<3)await p.waitForTimeout(100);
 }
 assert.equal(stable,3,'Measured control layout settles');
}
(async()=>{
 const browser=await chromium.launch(),results=[],errors=[],sessions=new Map();
 let selected=scenes(fixtures);if(process.env.KINETTA_SPACING_SCREENS){const names=process.env.KINETTA_SPACING_SCREENS.split(',');selected=selected.filter(s=>names.includes(s.name));assert.equal(selected.length,names.length,'Every selected scene exists');}
 try{
  // Reuse login state across sizes/themes to avoid needless sessions and login-rate pressure.
  for(const scene of selected){const key=scene.login+(scene.native?':native':'');if(sessions.has(key))continue;const c=await browser.newContext();try{
   const response=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:scene.login,password:scene.login==='alex'?'blue kettle morning run':'green teapot on the hill',app:!!scene.native}});assert.equal(response.status(),200,'Fixture login');
   const token=(await response.json()).token,headers=scene.native?{Authorization:'Bearer '+token}:{},me=await(await c.request.get(base+'/api/me',{headers})).json();
   sessions.set(key,{token,id:me.id,storageState:await c.storageState()});
  }finally{await c.close();}}
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}])for(const theme of ['light','dark'])for(const scene of selected){
   const auth=sessions.get(scene.login+(scene.native?':native':'')),c=await browser.newContext({storageState:auth.storageState,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:'UTC'}),writes=[],pageErrors=[];
   try{
    const liftData=scene.lift?await(await c.request.get(base+'/api/activities/'+scene.lift+'/lifts')).json():null;
    await c.addInitScript(initialize,{root:size.root,native:!!scene.native,base,token:auth.token,id:auth.id,lift:scene.lift,liftData});
    await c.route('**/*',r=>{const request=r.request(),u=new URL(request.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(request.method())){writes.push(u.pathname);return r.abort();}
     if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/__spacing_tiles/{z}/{x}/{y}.png',max_zoom:17,attribution:'Demo tiles'}});
     if(u.pathname.startsWith('/__spacing_tiles/'))return r.fulfill({contentType:'image/png',body:tile});
     if(scene.recap&&u.pathname==='/api/recaps')return r.fulfill({json:fixtures.recaps.matrix.typical[u.searchParams.get('period')]});
     if(scene.notifications&&u.pathname==='/api/notifications/personal')return r.fulfill({json:{plan:true,weekly:true,plan_time:'08:00',tz:'UTC',push_ready:true,device_ready:true}});
     if(scene.notifications&&u.pathname==='/api/food/reminders')return r.fulfill({json:{enabled:true,tz:'UTC',push_ready:true,device_ready:true,times:['breakfast','lunch','dinner'].map(meal=>({meal,ready:true,time:'12:15'}))}});
     return r.continue();
    });
    const p=await c.newPage();p.on('pageerror',e=>pageErrors.push(e.message));if(scene.recap)await p.clock.setFixedTime(new Date(fixtures.recaps.now));
    await p.goto(base+scene.route);await until(p,()=>typeof App!=='undefined'&&App.pageReady,'Page route settles');await p.locator(scene.ready).first().waitFor({state:'attached'});
    if(scene.notifications)await notificationState(p);
    if(scene.recap){await p.locator('#recap-entry').click();await until(p,()=>document.querySelector('#recap-preview')?.naturalWidth>0&&!document.querySelector('.recap-preview.busy'),'Recap picture ready');}
    await p.evaluate(()=>document.fonts.ready);
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
     end=await p.evaluate(()=>{const el=document.querySelector('.scrim .sheet')||document.scrollingElement,before=el.scrollTop;el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,before+Math.max(200,el.clientHeight*.7));return Math.abs(el.scrollTop-before)<1||el.scrollTop+el.clientHeight>=el.scrollHeight-1;});
    }
    assert(traversedEnd,'Vertical content fits the bounded audit traversal');
    // Hero limits apply to the whole card, including values encountered at different scroll positions.
    measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[],texts:[...allTexts.values()]},rules));
    // A sticky/header layer must not hide a target at every position where it can be fully in view.
    for(const t of exposure.values())if(t.bestUsable.width<43.98||t.bestUsable.height<43.98||t.seenFully&&!t.exposed)measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[{...t,rect:t.bestUsable,unreachable:t.seenFully&&!t.exposed}],texts:[]},rules));
    if(pictures){fs.mkdirSync(pictures,{recursive:true});await p.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.scrim .sheet')?.scrollTo(0,0);});await settle(p);await p.screenshot({path:path.join(pictures,scene.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+size.width+'-'+theme+'.png')});}
    const {violations,exceptionsUsed}=combineMeasurements(measurements,rules);
    results.push({screen:scene.name,width:size.width,root:size.root,theme,violations,exceptionsUsed});
    if(pageErrors.length||writes.length)errors.push({screen:scene.name,width:size.width,theme,pageErrors,writes});
    console.log(`${scene.name} ${size.width}/${size.root} ${theme}: ${violations.length} violations`);
    for(const v of violations.slice(0,8))console.log(`  ${v.metric}: ${v.element}${v.neighbour?' ↔ '+v.neighbour:''} measured ${JSON.stringify(v.actual)}, expected ${JSON.stringify(v.expected)}`);
   }catch(e){errors.push({screen:scene.name,width:size.width,theme,error:e.message});console.error(scene.name,e.message);}finally{await c.close();}
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
