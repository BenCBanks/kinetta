// Fictional account only; verify the short hints in both themes at 390px.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
(async()=>{const b=await chromium.launch();try{
 for(const theme of ['light','dark']){
  const c=await b.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_explore_new',password:'green teapot on the hill'}})).status(),200);
  await p.goto(base+'/me/explore');await p.locator('.guide-hint').nth(2).waitFor();
  assert.deepEqual(await p.locator('.guide-hint h2').allInnerTexts(),['React','Health app','Hide where it starts and ends']);
  assert.deepEqual(await p.locator('.guide-hint p').allInnerTexts(),['Hold it on an activity for more emoji.','Open it from Connections to import workouts and weight.','Leave it on when sharing a route to trim its map.']);
  assert.equal(await p.locator('input,details,.guide-categories').count(),0,'no searchable or step-by-step catalog');
  const layout=await p.evaluate(()=>({width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,rows:[...document.querySelectorAll('.guide-hint')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};})}));
  assert(layout.width<=layout.client+1,'no horizontal overflow');assert(layout.rows.every(r=>r.left>=15&&r.right<=375),'16px page gutter stays clear');
  if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/explore-hints-390-${theme}.png`});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(`Explore hints 390 ${theme}: labels, copy, gutters and no writes PASS`);await c.close();
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
