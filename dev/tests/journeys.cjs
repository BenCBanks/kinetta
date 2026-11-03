// Real tap destinations and two explicit fictional writes; native/GPS/Kit transports are stand-ins.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {journeys}=require('./journey_scenes.cjs');
const {boundary,context,fixtureSessions,ready,assertDestination,until,closeSheets}=require('./journey_browser.cjs');
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
 const day=async()=>{const response=await f.c.request.get(base+'/api/food/day'+(f.foodDay?'?d='+f.foodDay:''));assert.equal(response.status(),200,'Read this fictional account through its browser cookie');return response.json();};
 const p=f.p,initial=await day();assert.match(initial.day,/^\d{4}-\d{2}-\d{2}$/);f.foodDay=initial.day;
 await p.locator('#fq-add').click();await p.locator('#thread-text').fill('1 serving fictional journey rice');
 await p.locator('#thread-send').click();await p.locator('#thread-review:visible').waitFor();
 assert.match(await p.locator('.compact-food').last().innerText(),/Fictional journey rice/i);
 const before=await day();assert.deepEqual(before.entries.map(row=>row.id),initial.entries.map(row=>row.id),'Draft did not log early');
 await p.locator('#thread-review').click();await p.locator('#review-confirm').click();
 await until(p,()=>!document.querySelector('#food-final-review'),'Explicit review confirmed');
 const after=await day(),added=after.entries.filter(row=>!initial.entries.some(old=>old.id===row.id));
 assert.equal(after.entries.length,initial.entries.length+1);assert.equal(added.length,1);assert.equal(added[0].kcal,130);
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
 assert(Math.abs(restored.y-position.y)<=4,'Feed scroll position is restored after loaded tools');
}
(async()=>{
 boundary();const fixtures=JSON.parse(fs.readFileSync(fixturesFile)),all=journeys(fixtures);
 const theme=process.env.KINETTA_JOURNEY_THEME||'light';assert(['light','dark'].includes(theme),'Known journey theme');
 const wanted=process.env.KINETTA_JOURNEY_CASE?.split(','),selected=wanted?all.filter(test=>wanted.includes(test.id)):all;
 assert(selected.length&&(!wanted||selected.length===wanted.length),'Every selected journey must exist');
 const started=Date.now();
 const remaining=Number(process.env.KINETTA_JOURNEY_DEADLINE_MS||started+120000)-started;assert(remaining>0,'Journey batch deadline already expired');
 const browser=await chromium.launch(),contexts=new Map(),results=[];
 let expired=false;const watchdog=setTimeout(()=>{expired=true;console.error('Journey batch deadline exceeded');browser.close().catch(()=>{});},Math.min(remaining,120000));
 try{
  const sessions=await fixtureSessions(browser,base,selected);
  for(const test of selected){
   if(expired)break;
   const key=[test.login,test.native?test.id:'browser',!!test.kit].join(':'),existing=contexts.has(key);
   const f=contexts.get(key)||await context(browser,base,fixtures,sessions,test,theme);contexts.set(key,f);f.test(test);
   try{
    if(existing)await f.p.evaluate(url=>go(url,{replace:true}),test.start);else await f.p.goto(base+test.start);
    await ready(f.p);
    if(test.startReady)await f.p.locator(test.startReady).waitFor({state:'attached'});
    if(test.action==='record'||test.action==='uncertainSave')await recording(f,test.action==='uncertainSave');
    else if(test.action==='food')await food(f);
    else if(test.action==='feedBack')await feedBack(f);
    else for(const selector of test.taps)await f.p.locator(selector).first().click();
    await assertDestination(f.p,test.end,{saved:f.saved,day:f.foodDay});
    const capture=process.env.KINETTA_JOURNEY_SHOTS&&['me-profile','track-save-detail','nutrition-log','notification-activity_ready'].includes(test.id);
    if(capture)await f.p.locator('#toast.on').waitFor({state:'hidden'});
    const endShot=capture?await f.p.screenshot():null;
    if(test.back){
     if(test.history)await f.p.goBack();else await f.p.locator('[data-back]:visible,.progress-back:visible,.thread-heading > .back').first().click();
     await assertDestination(f.p,test.back);
    }
    if(test.close)await closeSheets(f.p);
    assert.deepEqual(f.errors,[],'No page exception');
    assert.deepEqual(f.httpErrors,[],'No unexpected API failure');
    assert.deepEqual(f.blocked,[],'No unexpected navigation mutation');
    const targets=await f.p.evaluate(()=>window.journeyGoTargets||[]);results.push({id:test.id,login:test.login,passed:true,end:test.end.url,go:targets,writes:[...f.writes]});
    console.log('Journey '+test.id+': URL, title and key element PASS');
    if(endShot){
     fs.mkdirSync(process.env.KINETTA_JOURNEY_SHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.KINETTA_JOURNEY_SHOTS,test.id+'.png'),endShot);
    }
   }catch(error){
    if(process.env.KINETTA_JOURNEY_SHOTS){fs.mkdirSync(process.env.KINETTA_JOURNEY_SHOTS,{recursive:true});await f.p.screenshot({path:path.join(process.env.KINETTA_JOURNEY_SHOTS,test.id+'-failed.png')}).catch(()=>{});}
    results.push({id:test.id,login:test.login,passed:false,error:error.message,url:f.p.url(),go:await f.p.evaluate(()=>window.journeyGoTargets||[]).catch(()=>[])});
    console.error('Journey '+test.id+': FAIL '+error.message);contexts.delete(key);await f.c.close();
   }
  }
 }finally{clearTimeout(watchdog);for(const f of contexts.values())await f.c.close().catch(()=>{});await browser.close();}
 const result={fictional:true,theme,mode:expired?'PARTIAL timeout':process.env.KINETTA_JOURNEY_CASE?'PARTIAL selection':'complete',fixture_sha256:createHash('sha256').update(fs.readFileSync(fixturesFile)).digest('hex'),cases:results,elapsed_seconds:(Date.now()-started)/1000,standins:['Native recorder and GPS','Kit availability/conversation','Backend-generated notification list','Delayed Back challenge response']};
 const output=process.env.KINETTA_JOURNEY_REPORT||'/tmp/'+project+'-journeys-report.json';fs.writeFileSync(output,JSON.stringify(result,null,2));
 const failures=results.filter(row=>!row.passed);console.log(`Journeys: ${results.length-failures.length}/${results.length} passed in ${result.elapsed_seconds.toFixed(1)} seconds`);
 assert(!expired,'Journey batch must finish within its deadline');
 assert.equal(failures.length,0,failures.map(row=>row.id+': '+row.error).join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
