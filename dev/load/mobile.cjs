// External development tools: Playwright and Lighthouse; neither is a product dependency.
// NODE_PATH points to their separately installed modules. Python performs the same target guard.
process.umask(0o077);
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const [base,project,sessions,output]=process.argv.slice(2);
if(!base||!project||!sessions||!output)throw Error('Usage: mobile.cjs URL PROJECT SESSIONS_JSON OUTPUT_DIRECTORY');
execFileSync('python3',['-c','from guard import target; import sys; target(sys.argv[1],sys.argv[2])',base,project],{cwd:__dirname});
const url=new URL(base),person=JSON.parse(fs.readFileSync(sessions))[0],root=path.resolve(__dirname,'../..');
fs.mkdirSync(output,{recursive:true,mode:0o700});
(async()=>{
 const lighthouse=(await import(pathToFileURL(require.resolve('lighthouse')).href)).default;
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;await new Promise(r=>server.close(r));
 const context=await chromium.launchPersistentContext(path.join(output,'browser-profile'),{headless:true,
  viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,serviceWorkers:'block',args:[`--remote-debugging-port=${port}`]});
 const blocked=[],requests=[],requestRows=new Map(),pageErrors=[],consoleErrors=[];
 try{
  await context.addCookies([{name:'fit_session',value:person.token,url:url.origin,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',r=>{
   const request=r.request(),u=new URL(request.url()),local=u.origin===url.origin;
   if(!local){blocked.push({kind:'external',method:request.method(),path:'[external]'});return r.abort();}
   if(!['GET','HEAD'].includes(request.method())){
    blocked.push({kind:'write',method:request.method(),path:u.pathname});
    return r.fulfill({status:204});
   }
   return r.continue();
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600*1024/8,
   uploadThroughput:750*1024/8,connectionType:'cellular4g'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const started=performance.now(),elapsed=()=>Math.round((performance.now()-started)*10)/10;
  page.on('request',request=>{
   const u=new URL(request.url()),entry={path:u.origin===url.origin?u.pathname:'[external]',method:request.method(),
    type:request.resourceType(),startMs:elapsed(),status:null,endMs:null,failure:null};
   requests.push(entry);requestRows.set(request,entry);
  });
  page.on('response',response=>{const row=requestRows.get(response.request());if(row){row.status=response.status();row.endMs=elapsed();}});
  page.on('requestfailed',request=>{const row=requestRows.get(request);if(row){row.failure=request.failure()?.errorText||'failed';row.endMs=elapsed();}});
  page.on('pageerror',error=>pageErrors.push(String(error.message||error)));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.goto(url.origin+'/me',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>{
   const root=document.querySelector('#page');
   return !!(root&&!root.hasAttribute('data-home-loading')&&root.querySelector('.me-card-sections[aria-busy="false"]'));
  },null,{timeout:120000});
  const useful=elapsed();
  const usefulCapture=await page.evaluate(cutoff=>{
   const entries=performance.getEntriesByType('resource').filter(x=>x.startTime<=cutoff);
   const clean=x=>{const u=new URL(x.name,location.href);return {path:u.origin===location.origin?u.pathname:'[external]',kind:/\.js(\?|$)/.test(u.pathname+u.search)?'js':/\.css(\?|$)/.test(u.pathname+u.search)?'css':'other',
    startMs:Math.round(x.startTime*10)/10,durationMs:Math.round(x.duration*10)/10,encoded:x.encodedBodySize,decoded:x.decodedBodySize,transfer:x.transferSize};};
   return entries.map(clean);
  },useful);
  const assets=usefulCapture.filter(x=>x.kind==='js'||x.kind==='css');
  await page.screenshot({path:path.join(output,'mobile-first-useful.png'),fullPage:false});
  await page.waitForFunction(()=>{
   const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const card=document.querySelector('.me-card'),values=card?.querySelector('.me-card-sections[aria-busy="false"]');
   const share=card?.querySelector('[data-card-share]'),add=document.querySelector('[data-today-add]');
   return !!(visible(card)&&visible(values)&&values.textContent.trim()&&visible(share)&&!share.disabled&&visible(add)&&!add.disabled);
  },null,{timeout:120000});
  const actions=elapsed();
  const actionState=await page.evaluate(()=>{
   const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const card=document.querySelector('.me-card'),values=card?.querySelector('.me-card-sections[aria-busy="false"]');
   const share=card?.querySelector('[data-card-share]'),add=document.querySelector('[data-today-add]');
   return {cardVisible:visible(card),cardValuesReady:visible(values)&&!!values.textContent.trim(),cardValueCharacters:values?.textContent.trim().length||0,
    shareVisible:visible(share),shareEnabled:!!share&&!share.disabled,addFoodVisible:visible(add),addFoodEnabled:!!add&&!add.disabled};
  });
  await page.screenshot({path:path.join(output,'mobile-card-actions-ready.png'),fullPage:false});
  const browserRequests=requests.filter(x=>x.startMs<=actions),usefulRequests=browserRequests.filter(x=>x.startMs<=useful);
  const requestFailures=browserRequests.filter(x=>x.failure||((x.status||0)>=400)).map(x=>({path:x.path,method:x.method,status:x.status,failure:x.failure}));
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  await page.close();
  // Separate Lighthouse simulated-mobile run. Interception remains context-wide for reads/writes.
  const clear=await context.newPage(),clearSession=await context.newCDPSession(clear);
  await clearSession.send('Network.clearBrowserCache');await clear.close();
  const result=await lighthouse(url.origin+'/me',{port,output:['html','json'],onlyCategories:['performance'],
   disableStorageReset:true,formFactor:'mobile',screenEmulation:{mobile:true,width:390,height:844,deviceScaleFactor:1,disabled:false},
   throttlingMethod:'simulate',throttling:{rttMs:150,throughputKbps:1600,cpuSlowdownMultiplier:4}});
  fs.writeFileSync(path.join(output,'lighthouse.html'),result.report[0]);
  fs.writeFileSync(path.join(output,'lighthouse.json'),result.report[1]);
  const summary={fictional:true,sourceSha,firstUsefulMs:useful,cardActionsReadyMs:actions,
   readiness:{firstUseful:'#page is not data-home-loading and .me-card-sections[aria-busy="false"] exists',
    cardActions:'visible Me values plus enabled [data-card-share] and Today [data-today-add]',...actionState},
   profile:{viewport:'390x844',latencyMs:150,downloadKbps:1600,uploadKbps:750,cpu:4,cacheDisabled:true,serviceWorkers:'blocked'},
   requests:{toFirstUseful:usefulRequests.length,toCardActions:browserRequests.length,failedOrHttpError:requestFailures.length,
    blockedAttempts:blocked.length,jsCssResourcesToFirstUseful:assets.length,resourceTimingEntriesToFirstUseful:usefulCapture.length,
    details:browserRequests},
   assetsAtFirstUseful:assets,blocked,pageErrors,consoleErrors,requestFailures,lighthouseVersion:result.lhr.lighthouseVersion,
   lighthouseRuntimeError:result.lhr.runtimeError||null,
   lighthouseAudits:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time']
    .map(k=>[k,result.lhr.audits[k]?.numericValue]))};
  fs.writeFileSync(path.join(output,'mobile-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({sourceSha,firstUsefulMs:useful,cardActionsReadyMs:actions,requestsToUseful:usefulRequests.length,
   requestsToActions:browserRequests.length,requestErrors:requestFailures.length,blockedAttempts:blocked.length,
   pageErrors:pageErrors.length,consoleErrors:consoleErrors.length,lighthouseVersion:summary.lighthouseVersion,
   lighthouseRuntimeError:summary.lighthouseRuntimeError}));
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
