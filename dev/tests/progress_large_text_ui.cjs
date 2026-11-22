// Isolated 24px accessibility check; ordinary Progress UI coverage stays at 16px.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const {setProgressFlags}=require('./progress_flags_fixture.cjs');
const {instant:fixtureInstant}=require('./fixture-clock.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(page,fn,label){for(let i=0;i<150;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label+' '+JSON.stringify(await page.evaluate(()=>({url:location.href,key:App?.page?.key,ready:App?.pageReady,scrollY,scrollHeight:document.documentElement.scrollHeight,clientHeight:innerHeight}))));}
(async()=>{
 setProgressFlags(false);
 cp.execFileSync('python3',[path.join(__dirname,'test_progress_overview.py')],{env:{...process.env,KINETTA_KEEP_PROGRESS:'1'},stdio:'inherit'});
 setProgressFlags(false);
 const browser=await chromium.launch();
 try{
  const login=await browser.newContext(),signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_overview_runner',password:'green teapot on the hill'}});
  assert.equal(signed.status(),200,'large-text Progress fixture login');
  const state=await login.storageState();await login.close();
  for(const theme of ['light','dark']){
   const context=await browser.newContext({storageState:state,viewport:{width:330,height:667},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'America/New_York'}),page=await context.newPage(),errors=[],writes=[];
   await page.clock.setFixedTime(fixtureInstant);
   await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='24px'));
   // The demo challenge continuation is unrelated to this read-only heading check.
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(url.pathname==='/api/notifications/count')return route.fulfill({json:{unread:0,friend_requests:0,friend_count:0}});if(!['GET','HEAD'].includes(request.method())){if(url.pathname!=='/api/challenges/signup/continue')writes.push(url.pathname);return route.abort();}return route.continue();});
   await page.goto(base+'/progress');await until(page,()=>typeof App!=='undefined'&&App.pageReady&&App.page?.key==='/progress','large-text Progress ready');
   await page.locator('#p-explore a').first().waitFor();await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{const root=document.scrollingElement;root.scrollTo({top:root.scrollHeight-root.clientHeight,behavior:'instant'});});
   await page.waitForFunction(()=>{const root=document.scrollingElement,heading=document.querySelector('.progress-home .sec-head');if(!heading||root.scrollTop<root.scrollHeight-root.clientHeight-1)return false;const rect=heading.getBoundingClientRect(),now={top:rect.top,bottom:rect.bottom,scrollTop:root.scrollTop,height:root.scrollHeight};const prior=window.__progressLargeTextLayout;const stable=prior&&Object.keys(now).every(key=>Math.abs(now[key]-prior[key])<.25)?(prior.stable||0)+1:0;window.__progressLargeTextLayout={...now,stable};return stable>=2;},{polling:'raf',timeout:10000});
   const settled=await page.waitForFunction(()=>{const heading=document.querySelector('.progress-home-heading'),section=document.querySelector('.progress-home .sec-head'),nav=document.querySelector('nav.tabs');if(!heading||!section||!nav)return false;const h=heading.getBoundingClientRect(),s=section.getBoundingClientRect(),n=nav.getBoundingClientRect();return{position:getComputedStyle(heading).position,heading:{top:s.top,bottom:s.bottom},sticky:{top:h.top,bottom:h.bottom},navTop:n.top,scrollY, max:document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight};},{timeout:30000});
   const geometry=await settled.jsonValue(),visibleHeaderBottom=geometry.position==='sticky'&&geometry.sticky.bottom>0?geometry.sticky.bottom:0;
   assert.equal(geometry.position,'sticky',`The Progress title and actions stay pinned at 330px/24px (${theme}): ${JSON.stringify(geometry)}`);
   assert(geometry.sticky.top>=-1&&geometry.sticky.bottom<=geometry.navTop,`The sticky title remains visible between the viewport and tab bar (${theme}): ${JSON.stringify(geometry)}`);
   assert(geometry.heading.top>=visibleHeaderBottom-1,`Explore your progress begins below the sticky title at 330px/24px (${theme}): ${JSON.stringify(geometry)}`);
   assert(geometry.heading.top>=0&&geometry.heading.bottom<=geometry.navTop+1,`The complete Explore heading is visible above navigation at 330px/24px (${theme}): ${JSON.stringify(geometry)}`);
   const share=await page.locator('#progress-share').boundingBox(),bell=await page.locator('.progress-home-heading .bell').boundingBox();assert(share&&bell&&share.width>=44&&share.height>=44&&bell.width>=44&&bell.height>=44,`Share and Notifications retain 44px targets (${theme})`);
   const kit=page.locator('.progress-home-heading .kit-help');if(await kit.count()){const box=await kit.boundingBox();assert(box&&box.width>=44&&box.height>=44,`Kit retains its 44px target (${theme})`);}
   const rowHeights=await page.locator('#p-explore .progress-tile').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));assert(rowHeights.length>0&&rowHeights.every(height=>height>=44),`Large-text Explore rows retain 44px targets (${theme}): ${JSON.stringify(rowHeights)}`);
   assert.deepEqual(writes,[],'large-text fixture performs no writes');assert.deepEqual(errors,[],'large-text Progress has no page errors');
   if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`progress-large-text-330-24-${theme}-bottom.png`),animations:'disabled'});}
   await context.close();
  }
  console.log('Progress large text: sticky title leaves the full section heading visible at the bottom, 330px/24px light/dark PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
