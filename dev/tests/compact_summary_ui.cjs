// Real client, fictional read-only data and iPhone bridge; no provider/device calls.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initialize}=require('./spacing_screens.cjs');
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});}
async function exercise(browser,base,{assertLayout=true}={}){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'disposable loopback only');
 const rows=[],out=process.env.COMPACT_SHOTS;
 for(const width of [320,375,390])for(const theme of ['light','dark'])for(const native of [false,true]){
  const fixture=require('./native-ui/appstore.cjs')(true),responses=fixture.responses,errors=[],unexpected=[];
  Object.assign(responses['/api/me'],{ai_ok:true,coach:true,kit_chat:true,ai_access:{coach:{available:true,entitled:true}}});
  const c=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});
  try{
   await c.addInitScript(initialize,{root:16,native,base,token:'fictional-compact-summary',id:1});
   await c.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),key=url.pathname;
    if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
    if(native&&key.endsWith('.css')){const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g,'59px').replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g,'34px')});}
    // Route data is unchanged; no real map requests or availability claims in a geometry test.
    if(key==='/api/map-config')return route.fulfill({json:{kind:'off'}});
    if(!key.startsWith('/api/'))return route.continue();
    if(['/api/milestones/celebrate','/api/challenges/signup/continue'].includes(key))return route.fulfill({json:{items:[],pending:false}});
    if(request.method()!=='GET'){unexpected.push(request.method()+' '+key);return route.abort();}
    if(!Object.hasOwn(responses,key)){unexpected.push('GET '+key);return route.fulfill({status:404,json:{detail:'Unprovided fictional fixture'}});}
    return route.fulfill({json:responses[key]});
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date(fixture.now));
   await p.goto(base+'/activity/1');await p.locator('.detail-primary .stat').first().waitFor();await p.waitForFunction(()=>App.pageReady);await settle(p);
   assert.equal(await p.evaluate(()=>Native.on),native,'bridge and browser both mount');
   const summary=await p.locator('.detail-primary .stat').evaluateAll(nodes=>nodes.map(n=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};};return{label:n.querySelector('small').textContent,value:n.querySelector('b').textContent,number:box(n.querySelector('b')),labelBox:box(n.querySelector('small'))};}));
   assert.deepEqual(summary.map(s=>s.label),['Distance','Elapsed time','Pace (elapsed)'],'elapsed-pace distinction retained');
   assert.equal(summary.length,3);assert(summary[2].labelBox.height>0);
   if(assertLayout){
    assert(Math.max(...summary.map(s=>s.number.y))-Math.min(...summary.map(s=>s.number.y))<1,'all three values share a top baseline despite wrapped pace label: '+JSON.stringify(summary));
    assert(Math.max(...summary.map(s=>s.number.bottom))-Math.min(...summary.map(s=>s.number.bottom))<1,'all three value baselines align');
    assert(summary.every(s=>s.labelBox.y>=s.number.bottom),'labels stay beneath their values');
    if(width===320)assert(summary[2].labelBox.height>20,'320px fixture really wraps the pace label');
   }
   const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${name}-${width}-${theme}-${native?'bridge':'web'}.png`),animations:'disabled'});}};
   await shot('activity');
   await p.goto(base+'/progress');await p.locator('#p-explore a').first().waitFor();await p.waitForFunction(()=>App.pageReady);await p.locator('.progress-home-heading [data-kit-entry]').waitFor();await settle(p);
   const header=await p.locator('.progress-home-heading').evaluate(node=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return{title:box(node.querySelector('h1')),actions:[...node.querySelector('.acts').children].map(box),text:node.querySelector('h1').textContent,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(header.text,'Progress');assert.equal(header.actions.length,3,'Share, Notifications and Kit all retained');
   if(assertLayout){
    assert(!header.overflow,'page has no horizontal overflow');
    assert(header.actions.every(a=>a.width>=44&&a.height>=44),'all actions retain44px targets');
    assert(header.actions.every(a=>a.y<header.title.bottom&&a.bottom>header.title.y),'every action shares the title row: '+JSON.stringify(header));
    assert(header.actions[0].x>=header.title.right,'title and actions do not overlap');
    assert(header.actions.at(-1).right<=width,'last action stays on screen');
   }
   await shot('progress');
   // The sticky compact state and large-text wrapping must keep every control reachable too.
   if(assertLayout){
    await p.evaluate(()=>scrollTo(0,200));await p.waitForFunction(()=>document.querySelector('.progress-home-heading').classList.contains('is-compact'));await settle(p);
    const sticky=await p.locator('.progress-home-heading').boundingBox();assert(sticky.y>=-1&&sticky.y+sticky.height<await p.evaluate(()=>innerHeight),'compact heading stays visible');
    await p.evaluate(()=>{scrollTo(0,0);document.documentElement.style.fontSize='24px';dispatchEvent(new Event('scroll'));});await settle(p);
    assert(await p.locator('.progress-home-heading').evaluate(n=>n.classList.contains('is-large-text')),'large-text layout remains active');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'large text remains on screen');
    for(const target of await p.locator('.progress-home-heading .acts > *').all()){const box=await target.boundingBox();assert(box.width>=44&&box.height>=44&&box.x>=0&&box.x+box.width<=width,'large text retains every44px target');}
   }
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[],'no unprovided API, provider or write');rows.push({width,theme,native,summary,header});
  }finally{await c.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(rows,null,2));
 console.log(`Compact summary: ${rows.length} contexts, value alignment, single-row header,44px targets, sticky and large-text ${assertLayout?'PASS':'CAPTURE ONLY'}`);
 return rows;
}
module.exports=exercise;
if(require.main===module){const {chromium,webkit}=require('playwright');(async()=>{const browser=await (process.env.COMPACT_BROWSER==='webkit'?webkit:chromium).launch();try{await exercise(browser,process.env.KINETTA_URL||'http://localhost:8798',{assertLayout:process.env.COMPACT_CAPTURE_BEFORE!=='1'});}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});}
