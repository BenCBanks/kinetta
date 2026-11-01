// Real Welcome/Settings rendering; fictional account and counter transport stand-ins, no saved preferences.
'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
async function until(p,fn){for(let n=0;n<160;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error('Route did not settle');}
(async()=>{const browser=await chromium.launch();let checks=0;
try{for(const enabled of [false,true])for(const theme of ['light','dark'])for(const width of [390,330]){
 const c=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
 try{
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_feature_collection',password:'green teapot on the hill'}})).status(),200);
  const calls=[],errors=[],writes=[];let reads=0;
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),width===390?16:24);
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
   // Welcome's background challenge continuation is a no-op in this fictional renderer check.
   if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});
   if(u.pathname==='/api/features/state'){reads++;return r.fulfill({json:{enabled}});}
   if(u.pathname==='/api/features/open'){calls.push(q.postDataJSON());return r.fulfill({status:204});}
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/welcome','/me/settings']){
   await p.goto(base+route);await until(p,()=>App.pageReady&&App.page.key===location.pathname+location.search);
   assert.equal(await p.locator('#feature-metrics,#feature-metrics-choice').count(),0);
   assert(!(await p.locator('body').innerText()).includes('Help improve Kinetta'));
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
   if(out&&enabled){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`collection-${route==='/welcome'?'welcome':'settings'}-${width}-${theme}.png`)});}
  }
  if(enabled){for(let n=0;n<80&&!calls.length;n++)await p.waitForTimeout(25);assert.deepEqual(calls,[{feature:'settings'}]);}else{assert(reads>0);await p.waitForTimeout(150);assert.deepEqual(calls,[]);}
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);checks++;
  console.log(`Ordinary account ${enabled?'ON':'OFF'} ${width}/${theme}: Welcome/Settings navigation, operator gate, fixed payload and no per-person control PASS`);
 }finally{await c.close();}
}}finally{await browser.close();}console.log(`${checks} ordinary-account collection checks PASS (counter transport stand-in)`);
})().catch(e=>{console.error(e);process.exit(1);});
