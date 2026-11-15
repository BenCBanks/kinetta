// Fictional account only; verify Explore rows at compact and standard phone widths.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kinetta-1025-explore-shots';
(async()=>{const b=await chromium.launch();try{
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await b.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_explore_new',password:'green teapot on the hill'}})).status(),200);
  await p.goto(base+'/me/explore');await p.locator('.guide-hint').nth(2).waitFor();
  assert.deepEqual(await p.locator('.guide-hint h2').allInnerTexts(),['React','Health app','Hide start and end']);
  assert.deepEqual(await p.locator('.guide-hint p').allInnerTexts(),['Choose an emoji on a workout.','Connect Health to import workouts.','Trim the map on shared routes.']);
  assert.deepEqual(await p.locator('.guide-hint').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['/activity','/track/connections','/me/sharing']);
  assert.equal(await p.locator('.guide-hints.social-list-group').count(),1,'one grouped surface holds every feature');
  assert.equal(await p.locator('.guide-page .back-circle').getAttribute('aria-label'),'Back to Track');
  assert.equal(await p.locator('.guide-page .back-circle > span.vh').count(),1,'back label is available to assistive technology and hidden visually');
  assert.equal(await p.locator('input,details,.guide-categories').count(),0,'no searchable or step-by-step catalog');
  const layout=await p.evaluate(()=>({width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,rows:[...document.querySelectorAll('.guide-hint')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};})}));
  assert(layout.width<=layout.client+1,'no horizontal overflow');assert(layout.rows.every(r=>r.left>=12&&r.right<=layout.client-12&&r.height>=56),'rows fit the page with 56px minimum targets');
  if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/explore-${width}-${theme}.png`});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(`Explore rows ${width} ${theme}: destinations, copy, targets and no writes PASS`);await c.close();
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
