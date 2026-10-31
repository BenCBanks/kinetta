'use strict';
// Actual service worker + HTTP cache across two stamped builds, then offline.
// A temporary anonymous server serves only this fictional fixture; no API writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const until=async(fn,label)=>{for(let n=0;n<150;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(label);};
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kinetta-cache-'));let browser,server;
 try{
  const source=path.join(temp,'source');fs.mkdirSync(source);
  fs.copyFileSync(path.join(root,'app/static/sw.js'),path.join(source,'sw.js'));
  fs.writeFileSync(path.join(source,'index.html'),'<link rel="stylesheet" href="/static/style.css?v=__ASSET_HASH__"><script src="/static/app.js?v=__ASSET_HASH__" defer></script><p id="probe">Fictional cache check</p>');
  fs.writeFileSync(path.join(source,'app.js'),"navigator.serviceWorker.register('/sw.js');");
  const build=(name,color)=>{fs.writeFileSync(path.join(source,'style.css'),`#probe {color:${color}}`);const output=path.join(temp,name);execFileSync('python3',[path.join(root,'app/asset_build.py'),source,output]);return output;};
  const first=build('one','rgb(10, 20, 30)'),second=build('two','rgb(40, 50, 60)');let active=first,api=0;
  const shell=dir=>fs.readFileSync(path.join(dir,'sw.js'),'utf8').match(/const SHELL = '([^']+)'/)[1];
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/probe'){res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({count:++api}));return;}
   const name=url.pathname.startsWith('/static/')?url.pathname.slice(8):url.pathname==='/sw.js'?'sw.js':'index.html';
   if(!['sw.js','index.html','app.js','style.css'].includes(name)){res.writeHead(404);res.end();return;}
   res.setHeader('Cache-Control',url.searchParams.has('v')?'public, max-age=31536000, immutable':'no-cache');
   res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');
   res.end(fs.readFileSync(path.join(active,name)));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await until(()=>page.evaluate(()=>!!navigator.serviceWorker.controller),'Worker did not claim the page');
  await page.reload();await until(()=>page.evaluate(()=>getComputedStyle(document.querySelector('#probe')).color==='rgb(10, 20, 30)'),'First CSS did not load');
  const oldURL=await page.locator('link').getAttribute('href');
  active=second;await page.evaluate(async()=>{window.previousController=navigator.serviceWorker.controller;const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  await until(()=>page.evaluate(name=>caches.keys().then(keys=>keys.includes(name)),shell(second)),'Changed shell did not activate');
  await until(()=>page.evaluate(()=>navigator.serviceWorker.controller!==window.previousController),'Changed worker did not claim the page');
  await page.reload();await until(()=>page.evaluate(()=>getComputedStyle(document.querySelector('#probe')).color==='rgb(40, 50, 60)'),'Changed CSS remained stale');
  assert.notEqual(await page.locator('link').getAttribute('href'),oldURL);
  assert.deepEqual(await page.evaluate(()=>caches.keys()),[shell(second)]);
  const read=()=>page.evaluate(()=>fetch('/api/probe').then(r=>r.json()));assert.deepEqual(await read(),{count:1});assert.deepEqual(await read(),{count:2});
  // Wait for the worker's cache.put promises rather than relying on HTTP cache.
  await until(()=>page.evaluate(async name=>{const cache=await caches.open(name);return (await cache.keys()).some(r=>new URL(r.url).pathname==='/static/style.css');},shell(second)),'Updated assets were not saved offline');
  await context.setOffline(true);await page.reload();assert.equal(await page.locator('#probe').innerText(),'Fictional cache check');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#probe')).color),'rgb(40, 50, 60)');
  assert.deepEqual(errors,[]);console.log('Actual stamped worker: fresh CSS URL, new shell, old-cache removal, API bypass and offline reload PASS');
  await context.close();
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
