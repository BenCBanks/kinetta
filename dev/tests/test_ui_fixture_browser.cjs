// Real browser guard boundary and axe failure detection, with in-memory fictional HTTP servers only.
'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),{chromium}=require('playwright'),{AxeBuilder}=require('@axe-core/playwright');
const {fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
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
  console.log('Shared browser boundary: local fictional account, real mutation/external blocking and deliberately broken/fixed axe control PASS');
 }finally{await opened?.c.close();await browser.close();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>other.close(resolve))]);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
