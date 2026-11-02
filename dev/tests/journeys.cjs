// Real tap destinations and two explicit fictional writes; native/GPS/Kit transports are stand-ins.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {journeys}=require('./journey_scenes.cjs');
const {boundary,context,fixtureSessions,ready,assertDestination,until}=require('./journey_browser.cjs');
const base=process.env.KINETTA_URL,project=process.env.KINETTA_PROJECT;
const fixturesFile=process.env.KINETTA_JOURNEY_FIXTURES||'/tmp/'+project+'-journeys.json';
async function recording(f,uncertain){
 const p=f.p;await p.locator('#track-start').click();await p.locator('#track-pause').waitFor();
 await p.locator('#track-pause').click();await p.locator('#track-finish').click();
 await p.locator('input[name=activity_name]').fill('Fictional journey recording');
 await p.locator('#track-save:not([disabled])').click();
 if(uncertain){await p.locator('.track-check-saved').click();return;}
 await p.locator('.track-saved a[href^="/activity/"]').click();assert(Number.isSafeInteger(f.saved),'Save returned a real activity ID');
}
async function food(f){
 const p=f.p;await p.locator('#fq-add').click();await p.locator('#thread-text').fill('1 serving fictional journey rice');
 await p.locator('#thread-send').click();await p.locator('#thread-review:visible').waitFor();
 assert.match(await p.locator('.compact-food').innerText(),/Fictional journey rice/i);
 const headers={Authorization:'Bearer '+f.auth.token},before=await(await f.c.request.get(base+'/api/food/day',{headers})).json();
 assert.equal(before.entries.length,0,'Draft did not log early');
 await p.locator('#thread-review').click();await p.locator('#review-confirm').click();
 await until(p,()=>!document.querySelector('#food-final-review'),'Explicit review confirmed');
 const after=await(await f.c.request.get(base+'/api/food/day',{headers})).json();
 assert.equal(after.entries.length,1);assert.equal(after.entries[0].kcal,130);
 await p.locator('.thread-heading .back').click();await ready(p);assert.match(await p.locator('#fd-meals').innerText(),/Fictional journey rice/i);
}
async function feedBack(f){
 const p=f.p,link=p.locator('.post .post-link').nth(4);await link.waitFor();await link.scrollIntoViewIfNeeded();
 const target=await link.getAttribute('href'),name=await link.locator('.post-title').innerText();
 // Playwright may scroll a target again immediately before the tap. Measure the actual navigation moment.
 await p.evaluate(()=>document.addEventListener('click',event=>{window.journeyFeedPosition={y:scrollY,top:event.target.closest('.post').getBoundingClientRect().top};},{capture:true,once:true}));await link.click();
 const position=await p.evaluate(()=>window.journeyFeedPosition);assert(position.y>100,'Exercise a genuinely scrolled feed');
 await assertDestination(p,{url:target,title:name,ready:'.compact-detail-title'});
 await p.locator('[data-back]:visible').first().click();await ready(p);
 await until(p,()=>document.querySelector('#feed-tools')?.getAttribute('aria-busy')==='false','Feed restored');
 const restored=await p.locator(`.post[data-href="${target}"]`).evaluate(n=>({y:scrollY,top:n.getBoundingClientRect().top}));
 assert(Math.abs(restored.top-position.top)<=4,`Same feed card stays in place: ${JSON.stringify(position)} → ${JSON.stringify(restored)}`);
}
(async()=>{
 boundary();const fixtures=JSON.parse(fs.readFileSync(fixturesFile)),all=journeys(fixtures);
 const selected=process.env.KINETTA_JOURNEY_CASE?all.filter(test=>test.id===process.env.KINETTA_JOURNEY_CASE):all;
 assert(selected.length,'Selected journey exists');const browser=await chromium.launch(),contexts=new Map(),results=[];
 const started=Date.now();
 try{
  const sessions=await fixtureSessions(browser,base,selected);
  for(const test of selected){
   const key=[test.login,test.native?test.id:'browser',!!test.kit].join(':'),existing=contexts.has(key);
   const f=contexts.get(key)||await context(browser,base,fixtures,sessions,test);contexts.set(key,f);f.test(test);
   try{
    if(existing)await f.p.evaluate(url=>go(url,{replace:true}),test.start);else await f.p.goto(base+test.start);
    await ready(f.p);
    if(test.action==='record'||test.action==='uncertainSave')await recording(f,test.action==='uncertainSave');
    else if(test.action==='food')await food(f);
    else if(test.action==='feedBack')await feedBack(f);
    else for(const selector of test.taps)await f.p.locator(selector).first().click();
    await assertDestination(f.p,test.end,{saved:f.saved});
    if(test.back){
     if(test.history)await f.p.goBack();else await f.p.locator('[data-back]:visible,.thread-heading > .back').first().click();
     await assertDestination(f.p,test.back);
    }
    if(test.close)await f.p.locator('.scrim:not([inert]) .sheet header [data-close]').first().click();
    assert.deepEqual(f.errors,[],'No page exception');
    const targets=await f.p.evaluate(()=>window.journeyGoTargets||[]);results.push({id:test.id,passed:true,end:test.end.url,go:targets});
    console.log('Journey '+test.id+': URL, title and key element PASS');
    if(process.env.KINETTA_JOURNEY_SHOTS&&['me-profile','track-save-detail','nutrition-log','notification-activity_ready'].includes(test.id)){
     fs.mkdirSync(process.env.KINETTA_JOURNEY_SHOTS,{recursive:true});await f.p.screenshot({path:path.join(process.env.KINETTA_JOURNEY_SHOTS,test.id+'.png')});
    }
   }catch(error){
    if(process.env.KINETTA_JOURNEY_SHOTS){fs.mkdirSync(process.env.KINETTA_JOURNEY_SHOTS,{recursive:true});await f.p.screenshot({path:path.join(process.env.KINETTA_JOURNEY_SHOTS,test.id+'-failed.png')}).catch(()=>{});}
    throw Error(test.id+': '+error.message,{cause:error});
   }
  }
 }finally{for(const f of contexts.values())await f.c.close();await browser.close();}
 const result={fictional:true,cases:results,elapsed_seconds:(Date.now()-started)/1000,standins:['Native recorder and GPS','Kit availability/conversation','Backend-generated notification list']};
 const output=process.env.KINETTA_JOURNEY_REPORT||'/tmp/'+project+'-journeys-report.json';fs.writeFileSync(output,JSON.stringify(result,null,2));
 console.log(`Journeys: ${results.length} passed in ${result.elapsed_seconds.toFixed(1)} seconds`);
})().catch(error=>{console.error(error);process.exitCode=1;});
