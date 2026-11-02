// External development tools: Playwright and Lighthouse (Apache-2.0); no product dependency.
// NODE_PATH points at their separately installed modules. Python performs the same target guard.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const [base,project,sessions,output]=process.argv.slice(2);
if(!base||!project||!sessions||!output)throw Error('Usage: mobile.cjs URL PROJECT SESSIONS_JSON OUTPUT_DIRECTORY');
execFileSync('python3',['-c','from guard import target; import sys; target(sys.argv[1],sys.argv[2])',base,project],{cwd:__dirname});
const url=new URL(base),person=JSON.parse(fs.readFileSync(sessions))[0];
fs.mkdirSync(output,{recursive:true,mode:0o700});
(async()=>{
 const lighthouse=(await import(pathToFileURL(require.resolve('lighthouse')).href)).default;
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;await new Promise(r=>server.close(r));
 const context=await chromium.launchPersistentContext(path.join(output,'browser-profile'),{headless:true,
  viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,serviceWorkers:'block',args:[`--remote-debugging-port=${port}`]});
 const blocked=[];
 try{
  await context.addCookies([{name:'fit_session',value:person.token,url:url.origin,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',r=>{
   const u=new URL(r.request().url());
   if(u.origin!==url.origin){blocked.push('external');return r.abort();}
   if(!['GET','HEAD'].includes(r.request().method())){blocked.push('write');return r.fulfill({status:204});}
   return r.continue();
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600*1024/8,
   uploadThroughput:750*1024/8,connectionType:'cellular4g'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const started=performance.now();await page.goto(url.origin+'/me',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>document.querySelector('#t-week')&&!document.querySelector('#page[data-home-loading]'),null,{timeout:120000});
  const useful=performance.now()-started;
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(x=>/\.(js|css)(\?|$)/.test(x.name))
   .map(x=>({kind:/\.js(\?|$)/.test(x.name)?'js':'css',encoded:x.encodedBodySize,decoded:x.decodedBodySize,transfer:x.transferSize})));
  await page.screenshot({path:path.join(output,'mobile-first-useful.png'),fullPage:false});
  await page.close();
  // Separate Lighthouse simulated mobile run; preserve only authentication, clear cold HTTP cache first.
  const clear=await context.newPage(),clearSession=await context.newCDPSession(clear);
  await clearSession.send('Network.clearBrowserCache');await clear.close();
  const result=await lighthouse(url.origin+'/me',{port,output:['html','json'],onlyCategories:['performance'],
   disableStorageReset:true,formFactor:'mobile',screenEmulation:{mobile:true,width:390,height:844,deviceScaleFactor:1,disabled:false},
   throttlingMethod:'simulate',throttling:{rttMs:150,throughputKbps:1600,cpuSlowdownMultiplier:4}});
  fs.writeFileSync(path.join(output,'lighthouse.html'),result.report[0]);
  fs.writeFileSync(path.join(output,'lighthouse.json'),result.report[1]);
  const summary={fictional:true,firstUsefulMs:useful,readiness:'Me insights and all tracked overview panels settled',
   actualThrottle:{latencyMs:150,downloadKbps:1600,uploadKbps:750,cpu:4},assets,blocked,
   lighthouseVersion:result.lhr.lighthouseVersion,runtimeError:result.lhr.runtimeError||null,
   audits:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time']
    .map(k=>[k,result.lhr.audits[k]?.numericValue]))};
  fs.writeFileSync(path.join(output,'mobile-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({firstUsefulMs:useful,lighthouseVersion:summary.lighthouseVersion,runtimeError:summary.runtimeError}));
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
