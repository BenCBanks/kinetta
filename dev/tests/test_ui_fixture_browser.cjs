// Real browser guard boundary and axe failure detection, with in-memory fictional HTTP servers only.
'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),{chromium}=require('playwright'),{AxeBuilder}=require('@axe-core/playwright');
const {fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
// Exercise the production fixture entry point, without an app server or a handwritten Date replacement.
async function personaClockCases(browser,base,scene,sessions){
 const previous=process.env.KINETTA_SPACING_CLOCK,auth=sessions.get(scene.login),size={width:390,height:844,root:16};
 const cases=[['sunday-02',15,0,2],['sunday-19',15,0,19],['wednesday-12',18,3,12]];
 try{
  for(const zone of ['America/New_York','UTC','Asia/Tokyo'])for(const [mode,day,weekday,hour] of cases){
   process.env.KINETTA_SPACING_CLOCK=mode;
   const clockSessions=new Map(sessions);clockSessions.set(scene.login,{...auth,tz:zone});
   const opened=await fixturePage(browser,base,{},clockSessions,scene,size,'light');
   try{
    const {p}=opened,label=`${mode} in ${zone}`;
    const calendar=await p.evaluate(()=>{const d=new Date();return{zone:Intl.DateTimeFormat().resolvedOptions().timeZone,parts:[d.getFullYear(),d.getMonth()+1,d.getDate(),d.getDay(),d.getHours(),d.getMinutes()]};});
    assert.equal(calendar.zone,zone,`${label}: browser uses the persona timezone`);
    assert.deepEqual(calendar.parts,[2026,11,day,weekday,hour,0],`${label}: persona calendar matches the requested boundary`);
    await p.evaluate(()=>{
     window.__clockProbe={start:Date.now(),monotonic:performance.now(),timer:null,frame:false};
     setTimeout(()=>{window.__clockProbe.timer=Date.now();},60);
     requestAnimationFrame(()=>{window.__clockProbe.frame=true;});
    });
    await p.waitForFunction(()=>window.__clockProbe.timer!==null&&window.__clockProbe.frame,null,{timeout:3000,polling:50});
    const probe=await p.evaluate(()=>({...window.__clockProbe,end:new Date().getTime(),elapsed:performance.now()-window.__clockProbe.monotonic}));
    assert(probe.timer>probe.start,`${label}: Date.now advances while a timeout runs`);
    assert(probe.end>=probe.timer,`${label}: new Date follows the advancing clock`);
    assert(probe.elapsed>0,`${label}: the monotonic clock advances`);
    assert.deepEqual(opened.pageErrors,[],`${label}: no browser errors`);assert.deepEqual(opened.writes,[],`${label}: no app writes`);
   }finally{await opened.c.close();}
  }
  // A non-matrix fixture still keeps its explicit calendar fixed, with live timers.
  delete process.env.KINETTA_SPACING_CLOCK;
  const instant='2026-11-09T12:00:00Z',fixed=await fixturePage(browser,base,{me_today:{now:instant}},sessions,{...scene,todayPlan:true},size,'light');
  try{
   await fixed.p.evaluate(()=>{window.__fixedClockStart=Date.now();window.__fixedClockTimer=false;setTimeout(()=>{window.__fixedClockTimer=true;},60);});
   await fixed.p.waitForFunction(()=>window.__fixedClockTimer,null,{timeout:3000,polling:50});
   assert.deepEqual(await fixed.p.evaluate(()=>[window.__fixedClockStart,Date.now()]),[Date.parse(instant),Date.parse(instant)],'non-matrix Me Today fixture retains its fixed calendar');
  }finally{await fixed.c.close();}
  console.log('Persona clock matrix: three local boundaries in New York/UTC/Tokyo, advancing Date, live timeout/rAF and retained fixed scene clock PASS');
 }finally{if(previous===undefined)delete process.env.KINETTA_SPACING_CLOCK;else process.env.KINETTA_SPACING_CLOCK=previous;}
}
(async()=>{
 let mutations=0,external=0;const server=http.createServer((q,r)=>{
  if(q.url==='/api/login'){r.setHeader('Content-Type','application/json');return r.end(JSON.stringify({token:'fictional'}));}
  if(q.url==='/api/me'){r.setHeader('Content-Type','application/json');return r.end(JSON.stringify({id:1}));}
  if(q.method!=='GET')mutations++;
  r.setHeader('Content-Type','text/html');r.end('<html lang="en"><title>Fictional fixture</title><body><main><button id="ready">Ready</button></main><script>window.App={pageReady:true,me:{id:1}}</script></body></html>');
 }),other=http.createServer((q,r)=>{external++;r.end('unexpected');});
 const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));await listen(server);await listen(other);
 const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();let opened;
 try{
  const scene={name:'Guard fixture',login:'zz_test_guard',route:'/',ready:'#ready'},sessions=await fixtureSessions(browser,base,[scene]);
  opened=await fixturePage(browser,base,{},sessions,scene,{width:390,height:844,root:16},'light');
  await opened.p.evaluate(async external=>{await Promise.all([fetch('/forbidden',{method:'POST'}).catch(()=>{}),fetch(external).catch(()=>{})]);},'http://127.0.0.1:'+other.address().port+'/blocked');
  assert.equal(mutations,0);assert.equal(external,0);assert.deepEqual(opened.writes,['/forbidden']);
  await opened.p.evaluate(()=>{document.querySelector('#ready').textContent='';});
  let result=await new AxeBuilder({page:opened.p}).analyze();assert(result.violations.some(v=>v.id==='button-name'&&['serious','critical'].includes(v.impact)),'Broken control fails the same axe gate');
  await opened.p.evaluate(()=>document.querySelector('#ready').setAttribute('aria-label','Ready'));
  result=await new AxeBuilder({page:opened.p}).analyze();assert(!result.violations.some(v=>v.id==='button-name'));
  await assert.rejects(fixtureSessions(browser,'https://example.test',[scene]),/Disposable local/);
  await assert.rejects(fixtureSessions(browser,base,[{...scene,login:'real-account'}]),/Fictional fixture/);
  await personaClockCases(browser,base,scene,sessions);
  console.log('Shared browser boundary: local fictional account, real mutation/external blocking and deliberately broken/fixed axe control PASS');
 }finally{await opened?.c.close();await browser.close();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>other.close(resolve))]);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
