// Real owner/friend APIs and fictional demo geometry. No provider, device or sharing effects.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const fixtureInstant=new Date(require('../screenshots/fixture-time.json').instant);
const base=process.env.KINETTA_URL||'http://localhost:8798',pw='green teapot on the hill',out=process.env.KINETTA_EVIDENCE,fs=require('node:fs'),medalKind=process.env.KINETTA_MEDAL_CASE||'',medalTheme=process.env.KINETTA_MEDAL_THEME||'light',medalWidth=Number(process.env.KINETTA_MEDAL_WIDTH)||390,detailCases=(process.env.KINETTA_DETAIL_CASE||'').split(',').filter(Boolean),loadCases=(process.env.KINETTA_DETAIL_LOAD_CASE??'cold-me,retry,repeat,track-done,track-failure,track-unmount,track-owner,track-owner-original').split(',').filter(Boolean);
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
async function assertNoDetailTitleBand(locator){
 const result=await locator.evaluate(el=>{const host=getComputedStyle(el),pseudo=getComputedStyle(el,'::after');return{content:pseudo.content,pseudoImage:pseudo.backgroundImage,hostImage:host.backgroundImage,borderTop:host.borderTopWidth};});
 assert(result.content==='none'&&result.pseudoImage==='none'&&result.hostImage==='none'&&result.borderTop==='0px',`activity detail map has no title band or top edge: ${JSON.stringify(result)}`);
}
async function assertShareChoiceSelection(p,label){
 const row=p.locator('.share-picture-row'),choices=p.locator('.share-picture-choice');
 const settled=async expected=>{await p.waitForTimeout(260);const state=await row.evaluate((node,expected)=>{const bounds=node.getBoundingClientRect(),center=bounds.left+bounds.width/2;return[...node.querySelectorAll('.share-picture-choice')].map(choice=>{const r=choice.getBoundingClientRect(),frame=choice.querySelector('.share-picture-frame');return{index:Number(choice.dataset.shareChoice),aria:choice.getAttribute('aria-checked'),distance:Math.abs(r.left+r.width/2-center),outline:getComputedStyle(frame).outline,peeking:choice.dataset.peeking};}).sort((a,b)=>a.distance-b.distance).slice(0,1)[0];},expected);assert.equal(state.index,expected,`${label}: choice ${expected+1} is centered after scroll-snap`);assert.equal(state.aria,'true',`${label}: centered choice ${expected+1} is aria-checked`);assert.match(state.outline,/solid/ ,`${label}: centered choice ${expected+1} has the selection outline`);assert.equal(state.peeking,'false',`${label}: centered choice ${expected+1} is fully visible`);};
 await choices.nth(0).locator('img').waitFor({state:'visible'});await settled(0);
 for(const expected of [1,0]){await choices.nth(expected).evaluate(node=>node.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'}));await settled(expected);}
 await p.keyboard.press('Escape');await p.locator('[data-unified-share]').waitFor({state:'detached'});
}
const missingElapsedCases={'missing-elapsed-null':null,'missing-elapsed-zero':0,'missing-elapsed-negative':-1};
(async()=>{
 const output=cp.execFileSync('python3',[path.join(__dirname,'activity_detail_fixture.py')],{env:process.env,encoding:'utf8'});console.log(output.trim());const ids=JSON.parse(output.trim().split('\n').at(-1));
 const b=await chromium.launch(),contexts=[];
async function open(kind,theme,size,mouse=false,comments=false,reaction=false,loadOptions={}){
  const friend=kind==='friend',missingElapsed=Object.hasOwn(missingElapsedCases,kind),id=ids[friend||missingElapsed?'run':kind],c=await b.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:!mouse,hasTouch:!mouse,timezoneId:'UTC'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_'+(friend?'friend':'owner'),password:pw}})).status(),200);
  if(reaction)assert.equal((await c.request.post(base+`/api/activities/${id}/reaction`,{headers:{Origin:base,'Content-Type':'application/json'},data:{kind:'clap'}})).status(),200,'fictional detail reaction fixture');
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  if(out)await c.addInitScript(()=>{window.__KINETTA_SCREENSHOT_MODE__=true;});
  const p=await c.newPage(),errors=[],writes=[],detailAssets=[],routeScriptOrder=[];let detailAttempts=0;await p.clock.setFixedTime(fixtureInstant);p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  p.on('request',q=>{const path=new URL(q.url()).pathname;if(path==='/static/activity-detail.js')detailAssets.push(q.url());if(['/static/social.js','/static/segments.js','/static/activity-detail.js'].includes(path))routeScriptOrder.push(path);});
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/static/activity-detail.js'&&loadOptions.failDetailFirst&&detailAttempts++===0)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(u.pathname===`/api/activities/${id}/comments`)return r.continue();return r.fulfill({json:{}});}if(medalKind&&u.pathname===`/api/activities/${id}`){return r.fetch().then(async response=>{const activity=await response.json(),ride=medalKind==='ride';activity.created=fixtureInstant.toISOString();activity.sport=ride?'ride':'run';activity.distance_m=ride?20000:5000;return r.fulfill({response,json:activity});});}if(medalKind&&u.pathname==='/api/sharing')return r.fulfill({json:{share_achievements:true}});if(medalKind&&u.pathname==='/api/achievements'){const ride=medalKind==='ride';return r.fulfill({json:{pending:false,tracks:[{code:ride?'sport:ride':'sport:run',value:ride?157233:9000,tiers:[]}]}});}if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/__detail_tiles/light/{z}/{x}/{y}.svg',dark_url:base+'/__detail_tiles/dark/{z}/{x}/{y}.svg',max_zoom:17,attribution:'Fictional mapping and terrain tiles'}});if(u.pathname.startsWith('/__detail_tiles/'))return r.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${u.pathname.includes('/dark/')?'#20262B':'#EDF0F3'}"/></svg>`});return r.continue();});
  if(missingElapsed)await c.route(`**/api/activities/${id}`,async r=>{
   if(r.request().method()!=='GET')return r.fallback();
   const response=await r.fetch(),activity=await response.json();
   // Keep the fictional activity's identity, access and geometry; change only the summary inputs.
   return r.fulfill({response,json:{...activity,distance_m:8046.72,elapsed_s:missingElapsedCases[kind],moving_s:2400}});
  });
  await p.goto(base+(friend?'/activity/friends/':'/activity/')+id+(comments?'?tab=comments':''));if(!loadOptions.noWait)await until(p,()=>App.pageReady&&!!document.querySelector('.compact-detail-title'),'detail ready');return{c,p,id,errors,writes,friend,detailAssets,routeScriptOrder};
 }
 async function assertDetailActionRow(p,label){
  const row=p.locator('#d-soc'),react=row.locator('.reaction-more'),comments=row.locator('.activity-comments'),share=row.locator('[data-detail-share]'),counts=row.locator('.reaction-count');
  assert.equal(await react.count(),1,`${label}: React is present`);assert.equal(await comments.count(),1,`${label}: Comments is present`);assert.equal(await share.count(),1,`${label}: Share is present`);
  const [r,c,s,box,viewportWidth]=await Promise.all([react.boundingBox(),comments.boundingBox(),share.boundingBox(),row.boundingBox(),p.evaluate(()=>innerWidth)]);assert(r&&c&&s&&box,`${label}: action row is rendered`);
  assert(Math.max(r.y,c.y,s.y)-Math.min(r.y,c.y,s.y)<=2.01,`${label}: React, Comments and Share stay on one row`);
  assert(c.x>=r.x+r.width+7.5&&s.x>=c.x+c.width+7.5,`${label}: Share follows React and Comments`);
  assert(box.x>=0&&box.x+box.width<=viewportWidth+1&&await row.evaluate(n=>n.scrollWidth<=n.clientWidth+1),`${label}: action row fits the viewport`);
  if(await counts.isVisible()){const count=await counts.boundingBox();assert(count.x>=s.x+s.width&&Math.abs(count.x+count.width-box.x-box.width)<1,`${label}: emoji counts stay at the far right`);}
 }
 async function trackDoneFixture({failDetail=false,holdDetail=false,instrument=false}={}){
  const c=await b.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_owner',password:pw}})).status(),200);
  const p=await c.newPage(),assets=[],writes=[],activityReads=[],errors=[];let attempts=0,releaseGate=()=>{},signalHeld=()=>{};
  await p.clock.setFixedTime(fixtureInstant);
  const gate=new Promise(resolve=>{releaseGate=resolve;}),held=new Promise(resolve=>{signalHeld=resolve;});
  p.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/static/activity-detail.js')assets.push(url.pathname);if(request.method()==='GET'&&url.pathname===`/api/activities/${ids.run}`)activityReads.push(url.pathname);});
  p.on('pageerror',error=>errors.push(error.message));
  if(instrument)await p.addInitScript(()=>{window.__trackDetailCalls=[];window.__firstTrackMedalNode=null;window.__currentTrackMedalNode=null;});
  await c.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/static/activity-detail.js'){
    attempts++;if(failDetail&&attempts===1)return route.abort();
    if((holdDetail&&attempts===1)||instrument){
     const response=await route.fetch(),body=await response.text();
     if(holdDetail&&attempts===1){signalHeld();await gate;}
     const probe=instrument?'\n;(()=>{const original=ActivityDetail.nextMedalForId;ActivityDetail.nextMedalForId=(node,id)=>{window.__trackDetailCalls.push({owner:App.me?.login,connected:node.isConnected,original:node===window.__firstTrackMedalNode,current:node===window.__currentTrackMedalNode,id});return original(node,id);};})();':'';
     return route.fulfill({response,body:body+probe});
    }
    return route.continue();
   }
   if(request.method()==='GET'&&url.pathname===`/api/activities/${ids.run}`){
    return route.fulfill({json:{id:Number(ids.run),created:fixtureInstant.toISOString(),sport:'run',distance_m:5000,moving_s:1500,elapsed_s:1500}});
   }
   if(request.method()==='GET'&&url.pathname==='/api/sharing')return route.fulfill({json:{share_achievements:true}});
   if(request.method()==='GET'&&url.pathname==='/api/achievements')return route.fulfill({json:{pending:false,tracks:[{code:'sport:run',value:9000}]}});
   if(request.method()==='POST'&&url.pathname==='/api/milestones/celebrate')return route.fulfill({status:204});
   if(!['GET','HEAD'].includes(request.method())){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
   return route.continue();
  });
  await p.goto(base+`/track?done=${ids.run}`);await until(p,()=>App.pageReady&&!!document.querySelector('.track-saved'),'saved Track screen');
  return{c,p,assets,writes,activityReads,errors,held,release:releaseGate};
 }
 try{
  if(loadCases.includes('cold-me')){
   const c=await b.newContext({viewport:{width:390,height:844},colorScheme:'light',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
   assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_owner',password:pw}})).status(),200);
   const p=await c.newPage(),detailAssets=[],errors=[];p.on('request',request=>{if(new URL(request.url()).pathname==='/static/activity-detail.js')detailAssets.push(request.url());});p.on('pageerror',error=>errors.push(error.message));
   await c.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(request.method()==='POST'&&url.pathname==='/api/challenges/signup/continue')return route.fulfill({status:204});if(!['GET','HEAD'].includes(request.method()))return route.abort();return route.continue();});
   await p.goto(base+'/me');await until(p,()=>App.pageReady&&!!document.querySelector('.me-card-sections[aria-busy="false"]'),'cold Me ready without ActivityDetail');assert.equal(detailAssets.length,0,'cold Me makes no ActivityDetail request');assert.equal(await p.evaluate(()=>performance.getEntriesByType('resource').some(item=>new URL(item.name).pathname==='/static/activity-detail.js')),false,'cold Me has no ActivityDetail resource');assert.deepEqual(errors,[]);await c.close();contexts.splice(contexts.indexOf(c),1);
  }
  if(process.env.KINETTA_DETAIL_ROW_ONLY==='1'){
   const size={width:330,height:667,root:16}, {c,p,errors}=await open('lifting','dark',size,false,false,true);await until(p,()=>!!document.querySelector('#d-soc [data-detail-share]'),'detail Share action');await assertDetailActionRow(p,'330px dark activity detail');assert.deepEqual(errors,[]);console.log('Activity detail action row 330px/16px dark: React, Comments, Share and right-side counts PASS');await c.close();contexts.splice(contexts.indexOf(c),1);return;
  }
  for(const kind of ['run','paused','treadmill','ride','lifting','empty','friend',...Object.keys(missingElapsedCases)])for(const size of (medalKind?[{width:390,height:844,root:16},{width:330,height:667,root:16}]:[{width:390,height:844,root:16}]))for(const theme of ['light','dark']){
   const name=`${kind}-${size.width}-${theme}`;if(detailCases.length&&!detailCases.includes(name))continue;
   if(medalKind&&(kind!==medalKind||theme!==medalTheme||size.width!==medalWidth))continue;
   const {c,p,errors,writes,friend,detailAssets,routeScriptOrder}=await open(kind,theme,size),mapped=['run','paused','ride','friend'].includes(kind);
   assert.equal(detailAssets.length,1,`${name} loads the deferred ActivityDetail script once`);
   if(kind==='run'||kind==='paused'||kind==='friend')assert.deepEqual(routeScriptOrder,kind==='friend'?['/static/social.js','/static/activity-detail.js']:['/static/social.js','/static/segments.js','/static/activity-detail.js'],`${name} loads route prerequisites before ActivityDetail`);
   if(medalKind){
    await until(p,()=>!!document.querySelector('.activity-next-medal'),'detail next medal');
    const line=p.locator('.activity-next-medal'),copy=line.locator('.activity-next-medal-copy'),metric=await p.evaluate(()=>App.me?.units==='metric'),remaining=medalKind==='ride'?(metric?'3.7 km':'2.3 mi'):(metric?'1 km':'0.6 mi'),level=medalKind==='ride'?'Century':'10K',full=`${remaining} to your ${level} medal`,compact=`${remaining} to ${level}`,actual=await copy.innerText(),fullFits=await copy.evaluate((el,text)=>{const link=el.closest('a'),tight=link.classList.contains('is-tight'),font=link.style.fontSize,before=el.textContent;link.classList.remove('is-tight');link.style.removeProperty('font-size');el.textContent=text;const fits=el.scrollWidth<=el.clientWidth+1;el.textContent=before;if(tight)link.classList.add('is-tight');if(font)link.style.fontSize=font;return fits;},full);assert.equal(actual,fullFits?full:compact,'keeps the expanded medal copy only when it fits at '+size.width+'px');
    const fit=await p.locator('#d-next-medal').evaluate(box=>{const link=box.querySelector('.activity-next-medal'),copy=link.querySelector('.activity-next-medal-copy'),r=link.getBoundingClientRect(),b=box.getBoundingClientRect(),s=getComputedStyle(copy);return{width:copy.clientWidth,scroll:copy.scrollWidth,height:copy.getBoundingClientRect().height,lineHeight:parseFloat(s.lineHeight),whiteSpace:s.whiteSpace,ellipsis:s.textOverflow==='ellipsis'||/[…]|\.\.\./.test(copy.textContent),inside:r.left>=b.left-1&&r.right<=b.right+1,boxWidth:box.clientWidth,boxScroll:box.scrollWidth,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth};});assert(fit.scroll<=fit.width+1&&fit.height<=fit.lineHeight+1&&fit.whiteSpace==='nowrap'&&!fit.ellipsis&&fit.inside&&fit.boxScroll<=fit.boxWidth+1&&fit.documentWidth<=fit.viewport+1,'detail medal text stays on one unclipped line at '+size.width+'px: '+JSON.stringify(fit));
    const iconPath=new URL(await line.locator('img').getAttribute('src'),base).pathname;assert(iconPath.endsWith(medalKind==='ride'?'/hundred_points_flat.svg':'/sports_medal_flat.svg'),'uses the catalog Fluent medal art');assert.equal(await line.getAttribute('aria-label'),actual);
    if(mapped)await until(p,()=>!!document.querySelector('#d-map .leaflet-tile-loaded'),'fictional map tiles');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`detail-next-${medalKind}-${theme}.png`),fullPage:true,animations:'disabled'});}
    assert.deepEqual(errors,[]);assert(await p.locator('[data-detail-edit]').count()>=1);console.log(`Activity detail ${medalKind} ${theme}: next-medal line PASS`);await c.close();contexts.splice(contexts.indexOf(c),1);continue;
   }
   if(kind==='paused'){
    assert.deepEqual(await p.locator('.detail-primary .stat small').allTextContents(),['Distance','Elapsed time','Pace'],'paused-run detail leads with elapsed time and elapsed pace');
    assert.deepEqual(await p.locator('.detail-moving .stat small').allTextContents(),['Moving time','Moving pace'],'paused-run detail adds moving time and moving pace beneath elapsed stats');
    assert.deepEqual(await p.locator('.detail-moving .stat b').allTextContents(),['40m','8:00/mi'],'moving stats use the moving duration for pace');
    const card=await p.evaluate(async id=>{const a=await api(`/api/activities/${id}`),host=document.createElement('div');host.innerHTML=postCard(a,{compact:true});document.body.append(host);const result={distance:a.distance_m,elapsed:a.elapsed_s,moving:a.moving_s,labels:[...host.querySelectorAll('.post-map-metric .vh')].map(n=>n.textContent),values:[...host.querySelectorAll('.post-map-metric b')].map(n=>n.textContent)};host.remove();return result;},ids.paused);
    assert.equal(card.distance,8046.72,'feed preserves recorded five-mile distance');assert.equal(card.elapsed,3000);assert.equal(card.moving,2400);assert(card.labels.includes('Pace')&&card.labels.includes('Time'),'feed shows pace and whole-activity time');assert(card.values.includes('50m'),'feed duration is the 50-minute elapsed time');
    await p.getByRole('tab',{name:'Details',exact:true}).click();const details=p.locator('#activity-pane-overview');await details.waitFor({state:'visible'});const detail=await details.innerText();assert.match(detail,/Elapsed time[\s\S]*?50m/i);assert.match(detail,/Moving time[\s\S]*?40m/i,'detail exposes both durations even with a ten-minute difference');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`activity-elapsed-paused-detail-390-${theme}.png`),fullPage:true,animations:'disabled'});}
    await until(p,()=>!!document.querySelector('#d-send'),'paused-run header Share action');await p.locator('#d-send').click();await p.locator('.share-sheet').waitFor();await p.waitForFunction(()=>{const image=document.querySelector('[data-share-image="0"]');return image&&!image.hidden&&image.complete&&image.naturalWidth>0;});
    assert.equal(await p.locator('.share-picture-label').first().innerText(),'Activity card');assert.equal(await p.locator('[data-share-save]').isEnabled(),true,'elapsed-first activity card is ready to save/share');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`activity-elapsed-paused-share-390-${theme}.png`),fullPage:true,animations:'disabled'});}
    assert.deepEqual(errors,[]);assert(!writes.some(x=>!['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(x)),'paused-run feed/detail/share proof performs no unrelated writes');await c.close();contexts.splice(contexts.indexOf(c),1);console.log(`Paused run elapsed summary feed/detail/share ${theme} PASS`);continue;
   }
   if(Object.hasOwn(missingElapsedCases,kind)){
    const primary=p.locator('.detail-primary .stat'),metric=await p.evaluate(()=>App.me?.units==='metric');
    assert.deepEqual(await primary.locator('small').allTextContents(),['Distance','Elapsed time'],'unavailable elapsed does not invent a whole-activity Pace');
    assert.equal(await primary.nth(0).locator('b').evaluate(n=>n.firstChild.textContent),metric?'8.0':'5.0','recorded five-mile distance survives unavailable elapsed');
    assert.equal(await primary.nth(0).locator('i').innerText(),metric?'km':'mi');
    assert.equal(await primary.nth(1).locator('b').innerText(),'–','elapsed stays unavailable instead of falling back to moving time');
    await p.getByRole('tab',{name:'Details',exact:true}).click();
    const details=p.locator('#activity-pane-overview');await details.waitFor({state:'visible'});
    const rows=await details.locator('.stat').evaluateAll(nodes=>nodes.map(n=>({label:n.querySelector('small').textContent,value:n.querySelector('b').textContent})));
    assert.deepEqual(rows.filter(row=>row.label==='Moving time'),[{label:'Moving time',value:'40m'}],'known moving time remains available in Details');
    assert(!rows.some(row=>row.label==='Elapsed time'||row.label==='Pace'),'Details does not fabricate elapsed time or whole-activity pace');
    assert.doesNotMatch(await p.locator('.detail-primary').innerText()+await details.innerText(),/NaN|Infinity/);
    assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'missing-elapsed detail fits phone width');
    if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`activity-${name}.png`),fullPage:true,animations:'disabled'});}
    assert.deepEqual(errors,[]);assert(!writes.some(x=>!['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(x)),'missing-elapsed detail performs no unrelated writes');
    await c.close();contexts.splice(contexts.indexOf(c),1);console.log(`Activity detail ${name}: recorded distance/unavailable elapsed/retained moving time PASS`);continue;
   }
   if(!friend)await until(p,()=>!!document.querySelector('#d-soc [data-ttalk]'),'owner reactions read');
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no document overflow');assert.equal(await p.locator('.discovery-grid').count(),0);
   const bar=p.locator(mapped?'.detail-floating':'.detail-bar.top');assert.equal(await bar.locator('.back').innerText(),'Activity');
   for(const control of await bar.locator('button').all()){const r=await control.boundingBox();assert(r.height>=44&&r.width>=44,'44px navigation/action');}
   assert.equal(await p.locator('.detail-secondary .stat').count()<=3,true);
   if(kind==='run'&&size.root===16){
    assert(await p.locator('.detail-title-row h1').evaluate(n=>n.getBoundingClientRect().height<=parseFloat(getComputedStyle(n).lineHeight)+1),'The normal fictional activity name fits a compact title row');
    const labels=await p.locator('.detail-primary .stat small').evaluateAll(ns=>ns.map(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects().length;}));assert(labels.every(n=>n===1),'Primary metric labels remain on one line');
    const highlights=await p.locator('.detail-highlights .detail-highlight').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().top));assert(highlights.length<2||Math.abs(highlights[0]-highlights[1])<.02,'Route and record metadata stay together at normal phone width');
    const chart=await p.locator('#d-charts').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(chart.y<nav.y,'The first chart starts above the tabs: '+JSON.stringify({chart,nav}));
   }

   if(friend){assert.equal(await p.locator('[data-detail-share],[data-detail-edit],#d-kit,.detail-highlights,#d-milestones').count(),0);assert.equal(await p.locator('#s-soc [data-detail-share]').count(),0);assert(!/Only me|Friends|Cadence|Calories/.test(await p.locator('.d-title').innerText()),'only permitted friend fields');assert.match(await p.locator('.d-title').innerText(),/Avg HR/,'heart rate appears for the sharing preference');assert(await p.locator('.detail-owner').isVisible());assert(await p.locator('#s-rb').isVisible());}
   else assert.equal(await p.locator('#d-soc').isVisible(),false,'an empty private activity hides its social footer');
   if(mapped){
    const map=p.locator(friend?'#s-map':'#d-map');await until(p,()=>!!document.querySelector('.leaflet-container'),'actual Leaflet');const hero=await p.locator('.detail-map-hero').boundingBox();assert(Math.abs(hero.x)<1&&Math.abs(hero.y)<1&&Math.abs(hero.width-size.width)<1,'full bleed top map');const expectedHero=Math.min(408,Math.max(264,size.height*.46));assert(Math.abs(hero.height-expectedHero)<=1,`detail header map grows about 20%: ${JSON.stringify({hero,expectedHero})}`);await assertNoDetailTitleBand(p.locator('.detail-map-hero'));assert.equal(await map.locator('.leaflet-control-zoom').count(),0,'coarse pointer uses pinch');
    if(kind==='run')for(const selector of ['.detail-floating .back','.detail-floating [data-detail-share]','.detail-floating [data-detail-edit]'])assert(await p.locator(selector).isVisible(),`${selector} stays floating over the map`);
    if(kind==='run'){
     await until(p,()=>!!document.querySelector('#d-map .leaflet-tile-loaded'),'fictional basemap loaded');await p.evaluate(()=>document.fonts.ready);
     if(size.width===390){await p.locator('[data-detail-share]').first().click();await p.locator('[data-unified-share]').waitFor();await assertShareChoiceSelection(p,`${name} share chooser`);}
     if(out){fs.mkdirSync(out,{recursive:true});await p.locator('.detail-map-hero').screenshot({path:path.join(out,`detail-header-${size.width}-${theme}.png`),animations:'disabled'});await p.screenshot({path:path.join(out,`detail-media-${size.width}-${theme}.png`),animations:'disabled'});}
     const controls=await p.locator('.detail-map-hero [data-media-step]').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),others=[...document.querySelectorAll('.detail-floating .back,.detail-floating button,.detail-map-hero .map-full,.detail-map-hero .leaflet-control-attribution,.detail-map-hero .map-unavailable:not([hidden])')].map(x=>x.getBoundingClientRect());return{rect:r.toJSON(),hit:n.disabled||n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),overlap:others.some(b=>b.width>0&&b.height>0&&Math.min(r.right,b.right)>Math.max(r.left,b.left)+.02&&Math.min(r.bottom,b.bottom)>Math.max(r.top,b.top)+.02)};}));
     assert(controls.every(x=>x.rect.width>=44&&x.rect.height>=44&&x.hit&&!x.overlap),'photo controls keep44px hit areas clear of toolbar, map controls and credits: '+JSON.stringify(controls));
     const tools=await p.locator('.detail-map-hero [data-media-step],.detail-map-hero .map-full').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().toJSON()).sort((a,b)=>a.left-b.left));assert(tools.every((r,i)=>i===0||Math.abs(r.top-tools[0].top)<.02&&r.left-tools[i-1].right>=7.98),'media tools share one row with8px gaps: '+JSON.stringify(tools));
     const credit=await map.locator('.leaflet-control-attribution').evaluate(el=>{const box=el.closest('.leaflet-container').getBoundingClientRect(),r=el.getBoundingClientRect();return{map:box.toJSON(),credit:r.toJSON(),overflow:el.scrollWidth>el.clientWidth+1,inside:r.left>=box.left-.02&&r.right<=box.right+.02&&r.top>=box.top-.02&&r.bottom<=box.bottom+.02};});assert(credit.inside&&!credit.overflow,'complete map credit fits the hero: '+JSON.stringify(credit));
     await p.locator('.detail-map-hero [data-media-step="1"]').click();await until(p,()=>document.querySelector('.detail-map-hero [data-media-position]')?.textContent.startsWith('Photo 1')&&Math.abs(document.querySelector('.detail-media .media-track').scrollLeft-document.querySelector('.detail-media .media-track').clientWidth)<1,'Next photo');
     await p.locator('.detail-map-hero [data-media-step="-1"]').click();await until(p,()=>document.querySelector('.detail-map-hero [data-media-position]')?.textContent.startsWith('Map')&&document.querySelector('.detail-media .media-track').scrollLeft<1,'Previous returns to map');
    }
    if(size.root===16){const tabs=await p.locator('.dtabs').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(tabs.y+tabs.height<nav.y,'analysis tabs in first screen');}
    await p.locator('.detail-primary').scrollIntoViewIfNeeded();await p.evaluate(()=>document.querySelector('.dtabs').scrollIntoView({block:'start'}));await until(p,()=>!document.querySelector('.detail-sticky').hidden,'compact sticky header');assert.equal((await p.locator('.detail-sticky').boundingBox()).y,0);await p.evaluate(()=>scrollTo(0,0));await until(p,()=>document.querySelector('.detail-sticky').hidden,'floating header restored');
    await map.locator('.map-full').click();await until(p,()=>!!document.querySelector('.map.full'),'full map');assert.equal(await p.locator('.map.full .leaflet-control-zoom').count(),0);assert(await p.locator('nav.tabs').evaluate(n=>n.closest('#app').inert));await p.keyboard.press('Escape');await until(p,()=>!document.querySelector('.map.full'),'map close');
    if(kind==='run'&&size.width===330&&theme==='dark'){
     await c.route('**/api/map-config',r=>r.fulfill({json:{kind:'off'}}));await p.reload();await until(p,()=>!!document.querySelector('#d-map .map-unavailable:not([hidden])'),'offline detail map');
     const feedback=await p.locator('#d-map .map-unavailable').evaluate(el=>{const r=el.getBoundingClientRect(),box=el.closest('.leaflet-container').getBoundingClientRect(),button=el.querySelector('button'),b=button.getBoundingClientRect(),tools=[...document.querySelectorAll('.detail-map-hero [data-media-step],.detail-map-hero .map-full')].map(n=>n.getBoundingClientRect());return{rect:r.toJSON(),inside:r.left>=box.left&&r.right<=box.right&&r.top>=box.top&&r.bottom<=box.bottom,hit:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),overlap:tools.some(t=>Math.min(t.right,r.right)>Math.max(t.left,r.left)+.02&&Math.min(t.bottom,r.bottom)>Math.max(t.top,r.top)+.02)};});assert(feedback.rect.width>=100&&feedback.inside&&feedback.hit&&!feedback.overlap,'offline notice and Retry remain visible beside the media tools: '+JSON.stringify(feedback));
     if(out)await p.screenshot({path:path.join(out,'detail-media-offline-330-dark.png'),animations:'disabled'});
    }
   }else{assert.equal(await p.locator('.detail-map-hero,.detail-sticky').count(),0,'indoor uses ordinary header');if(kind==='empty')assert.equal(await p.locator('.detail-secondary').count(),0,'no invented empty stats');}
   const buttons=p.locator('[data-dt]'),order=await buttons.evaluateAll(nodes=>nodes.map(n=>n.dataset.dt));assert.deepEqual(order,['charts','splits','efforts','overview'].filter(key=>order.includes(key)),'analysis order');
   for(const tab of await buttons.all()){if(!(await tab.isVisible())){assert(await p.locator(`[data-pane="${await tab.getAttribute('data-dt')}"]`).isVisible(),'single section is already open');continue;}const key=await tab.getAttribute('data-dt');await tab.click();assert(await p.locator(`[data-pane="${key}"]`).isVisible());assert.equal(await tab.getAttribute('aria-selected'),'true');}
   if(kind==='run'){
    assert.equal(await p.locator('.detail-highlights').isVisible(),false,'mapped detail keeps route and record links in their detail sections');
    await p.locator('[data-dt=overview]').click();assert.match(await p.locator('[data-pane=overview]').innerText(),/Fictional river loop/,'matched route remains in Overview');
    await p.locator('[data-dt=efforts]').click();assert(await p.locator('[data-pane=efforts]').isVisible());assert.match(await p.locator('[data-pane=efforts]').innerText(),/Best efforts/,'personal records remain in Efforts');
   }
   if(!friend){const details=p.locator('[data-dt=overview]');if(await details.isVisible())await details.click();assert.equal(await p.locator('[data-phadd]').count(),1,'photo action retained in Details');assert(await p.locator('#d-comment-open').isVisible(),'first comment remains reachable without zero counts');await p.evaluate(()=>scrollTo(0,0));await bar.locator('[data-detail-edit]').click();await p.waitForSelector('#e-form');assert(await p.locator('#e-form').isVisible());await p.keyboard.press('Escape');}
   assert.deepEqual(errors,[]);assert(!writes.some(x=>!['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(x)),'layout/actions do not write private data');console.log(`Activity detail ${name}: layout/actions/tabs/empty/permitted fields/map modal PASS`);await c.close();contexts.splice(contexts.indexOf(c),1);
  }
  if(loadCases.includes('retry')){
   const retry=await open('run','light',{width:390,height:844,root:16},false,false,false,{failDetailFirst:true,noWait:true});
   try{await retry.p.locator('.load-error').waitFor();assert.equal(retry.detailAssets.length,1,'first detail request fails');await retry.p.locator('#retry').click();await until(retry.p,()=>App.pageReady&&!!document.querySelector('.compact-detail-title'),'ActivityDetail after explicit retry');assert.equal(retry.detailAssets.length,2,'failed detail promise is cleared for retry');assert.deepEqual(retry.errors,[]);}finally{await retry.c.close();contexts.splice(contexts.indexOf(retry.c),1);}
  }
  if(loadCases.includes('repeat')){
   const repeated=await open('run','light',{width:390,height:844,root:16});
   try{await repeated.p.evaluate(()=>go('/activity'));await until(repeated.p,()=>App.pageReady&&!!document.querySelector('#ff-list'),'Activity after detail');await repeated.p.evaluate(id=>go(`/activity/${id}`),repeated.id);await until(repeated.p,()=>App.pageReady&&!!document.querySelector('.compact-detail-title'),'repeated own detail route');assert.equal(repeated.detailAssets.length,1,'repeated detail navigation reuses one loaded script');assert.deepEqual(repeated.errors,[]);}finally{await repeated.c.close();contexts.splice(contexts.indexOf(repeated.c),1);}
  }
  if(loadCases.includes('track-done')){
   const done=await trackDoneFixture();
   try{await done.p.locator('.activity-next-medal').waitFor();assert.equal(done.assets.length,1,'Track done loads ActivityDetail on demand once');assert.equal(done.activityReads.length,1,'the saved activity medal lookup reads its existing activity');assert(!done.writes.some(item=>item.startsWith('POST /api/activities')),'the optional medal lookup does not save another activity');assert(await done.p.locator('#track-start').isVisible(),'Track remains ready after the medal lookup');assert.deepEqual(done.errors,[]);}finally{await done.c.close();contexts.splice(contexts.indexOf(done.c),1);}
  }
  if(loadCases.includes('track-failure')){
   const failed=await trackDoneFixture({failDetail:true});
   try{await failed.p.waitForTimeout(100);assert.equal(failed.assets.length,1,'the optional ActivityDetail request was attempted once');assert(await failed.p.locator('#track-start').isVisible(),'failed optional medal code leaves Track usable');assert.deepEqual(failed.errors,[]);}finally{await failed.c.close();contexts.splice(contexts.indexOf(failed.c),1);}
  }
  if(loadCases.includes('track-unmount')){
   const delayed=await trackDoneFixture({holdDetail:true});
   try{await delayed.held;await delayed.p.evaluate(()=>go('/me'));await until(delayed.p,()=>App.pageReady&&!!document.querySelector('.me-card-sections'),'leave Track while ActivityDetail is loading');delayed.release();await delayed.p.waitForFunction(()=>classicScriptsLoaded.has(ACTIVITY_DETAIL_ROUTE_ASSET));await delayed.p.waitForTimeout(100);assert.equal(delayed.activityReads.length,0,'unmount prevents a stale saved-activity medal lookup');assert.deepEqual(delayed.errors,[]);}finally{delayed.release();await delayed.c.close();contexts.splice(contexts.indexOf(delayed.c),1);}
  }
  if(loadCases.includes('track-owner')){
   const delayed=await trackDoneFixture({holdDetail:true,instrument:true});
   try{
    await delayed.held;await delayed.p.evaluate(()=>{window.__firstTrackMedalNode=document.querySelector('#track-next-medal');});
    assert.equal((await delayed.c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_friend',password:pw}})).status(),200);const response=await delayed.c.request.get(base+'/api/me');assert.equal(response.status(),200);await delayed.p.evaluate(profile=>refreshMe(profile),await response.json());await until(delayed.p,()=>App.me?.login==='zz_test_detail_friend','Track owner changed while ActivityDetail is loading');
    await delayed.p.evaluate(()=>{window.__currentTrackMedalNode=document.querySelector('#track-next-medal');});const nodes=await delayed.p.evaluate(()=>({oldConnected:window.__firstTrackMedalNode.isConnected,same:window.__firstTrackMedalNode===window.__currentTrackMedalNode,newConnected:window.__currentTrackMedalNode.isConnected}));assert.deepEqual(nodes,{oldConnected:false,same:false,newConnected:true},'account change replaces the original slot with a connected new-owner slot');
    delayed.release();await delayed.p.waitForFunction(()=>classicScriptsLoaded.has(ACTIVITY_DETAIL_ROUTE_ASSET));await delayed.p.waitForFunction(()=>window.__trackDetailCalls.length===1);const calls=await delayed.p.evaluate(()=>window.__trackDetailCalls);assert.deepEqual(calls.map(({owner,connected,original,current})=>({owner,connected,original,current})),[{owner:'zz_test_detail_friend',connected:true,original:false,current:true}],'only the legitimate new-owner callback runs; the stale original callback is skipped');assert.equal(delayed.activityReads.length,1,'the new owner gets one legitimate saved-activity lookup');assert.deepEqual(delayed.errors,[]);
   }finally{delayed.release();await delayed.c.close();contexts.splice(contexts.indexOf(delayed.c),1);}
  }
  if(loadCases.includes('track-owner-original')){
   const delayed=await trackDoneFixture({holdDetail:true,instrument:true});
   try{
    await delayed.held;await delayed.p.evaluate(()=>{window.__trackNextMedalNode=document.querySelector('#track-next-medal');window.__firstTrackMedalNode=window.__trackNextMedalNode;window.__currentTrackMedalNode=window.__trackNextMedalNode;App.me={...App.me,id:App.me.id+1000000};});
    assert.equal(await delayed.p.evaluate(()=>window.__trackNextMedalNode.isConnected),true,'synthetic owner change keeps the original slot connected');
    delayed.release();await delayed.p.waitForFunction(()=>classicScriptsLoaded.has(ACTIVITY_DETAIL_ROUTE_ASSET));await delayed.p.waitForTimeout(100);assert.deepEqual(await delayed.p.evaluate(()=>window.__trackDetailCalls),[],'owner mismatch skips the original connected-node callback');assert.equal(delayed.activityReads.length,0,'owner mismatch prevents an old-session activity lookup');assert.deepEqual(delayed.errors,[]);
   }finally{delayed.release();await delayed.c.close();contexts.splice(contexts.indexOf(delayed.c),1);}
  }
  if(!medalKind&&!process.env.KINETTA_DETAIL_CASE){const {c,p,errors}=await open('lifting','dark',{width:330,height:667,root:16},false,false,true);await until(p,()=>!!document.querySelector('#d-soc [data-detail-share]'),'detail Share action');await assertDetailActionRow(p,'Activity detail 330px dark');assert.deepEqual(errors,[]);await c.close();contexts.splice(contexts.indexOf(c),1);console.log('Activity detail action row 330px/16px dark PASS');}
  if(!process.env.KINETTA_DETAIL_CASE||process.env.KINETTA_DETAIL_CASE==='actions'){
   const {c,p,errors}=await open('run','light',{width:390,height:844,root:16},true);await until(p,()=>!!document.querySelector('.leaflet-container'),'mouse map');assert.equal(await p.locator('#d-map .leaflet-control-zoom').count(),0,'photo rail starts still');await p.locator('#d-map .map-full').click();assert(await p.locator('.map.full .leaflet-control-zoom').isVisible(),'expanded photo map supports mouse zoom');await p.locator('.map.full .leaflet-control-zoom-in').click();await p.keyboard.press('Escape');await until(p,()=>!document.querySelector('.map.full'),'mouse map closed');assert.equal(await p.locator('#d-map .leaflet-control-zoom').count(),0,'inline rail restored');assert.deepEqual(errors,[]);await c.close();contexts.splice(contexts.indexOf(c),1);
   const item=await open('empty','light',{width:390,height:844,root:16},false,true);await item.p.waitForSelector('.c-form');assert.equal(await item.p.locator('#d-soc').isVisible(),false,'an empty private activity hides its social footer');await item.p.keyboard.press('Escape');await item.p.locator('#d-comment-open').click();await item.p.waitForSelector('.c-form');await item.p.locator('.c-form textarea').fill('Fictional private workout note');await item.p.locator('.c-send').click();await until(item.p,()=>document.querySelector('.social-read-status')?.textContent==='Comment posted.','own comment saved');await item.p.keyboard.press('Escape');assert(await item.p.locator('#d-soc').isVisible(),'the owner footer appears when the activity has a comment');assert(await item.p.locator('#d-soc .reaction-more').isVisible());assert.match(await item.p.locator('#d-soc [data-ttalk]').getAttribute('aria-label'),/1/);assert.deepEqual(item.errors,[]);await item.c.close();contexts.splice(contexts.indexOf(item.c),1);
   console.log('Activity detail actions: mouse zoom/keyboard restoration, empty-owner comment deep link and live social update PASS');
  }
  if(detailCases.includes('tabs-polish')){
   for(const theme of ['light','dark']){
    const {c,p,errors,writes}=await open('run',theme,{width:390,height:844,root:16},false);
    for(const [key,label] of [['overview','Details'],['splits','Splits'],['efforts','Efforts']]){
     const tab=p.getByRole('tab',{name:label,exact:true});await tab.click();
     const pane=p.locator(`#activity-pane-${key}`);await pane.waitFor({state:'visible'});
     assert.equal(await tab.getAttribute('aria-selected'),'true',`${label} exposes the selected tab state`);
     assert.equal(await pane.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,`${label} content fits the 390px viewport`);
     if(key==='splits'){
      assert(await pane.locator('tbody tr').count()>=4,'fictional split table has varied rows');
      const best= pane.locator('tbody tr.best .bar');assert.equal(await best.evaluate(n=>getComputedStyle(n).borderRadius),'999px','split bars use rounded ends');
      assert.match(await best.evaluate(n=>getComputedStyle(n).backgroundImage),/gradient/,'fastest split uses the accent gradient');
     }
     if(key==='overview'){
      const details=pane.locator('.hero.more'),stats=details.locator('.stat');assert.equal(await stats.count(),6,'Details keeps six non-duplicate stats in the named grid');
      assert.deepEqual(await details.evaluate(n=>{const s=getComputedStyle(n);return{columns:s.gridTemplateColumns.split(' ').length,rule:s.borderTopWidth};}),{columns:3,rule:'0px'},'Details uses a clean 3-column tile grid without the old hairline');
      assert.notEqual(await stats.first().evaluate(n=>getComputedStyle(n).backgroundColor),await details.evaluate(n=>getComputedStyle(n.closest('.card')).backgroundColor),'Details tiles use a distinct soft surface');
      assert.equal(await stats.first().locator('small').evaluate(n=>getComputedStyle(n).fontSize),'12px','stat labels are 12px');
      assert.equal(await stats.first().locator('small').evaluate(n=>getComputedStyle(n).fontWeight),'500','stat labels are medium');
      assert.equal(await stats.first().locator('b').evaluate(n=>getComputedStyle(n).fontSize),'20px','stat values are 20px');
      assert.equal(await stats.first().locator('b').evaluate(n=>getComputedStyle(n).fontWeight),'700','stat values are bold');
      assert.match(await stats.first().locator('b').evaluate(n=>getComputedStyle(n).fontVariantNumeric),/tabular-nums/);
      for(const title of ['Details','Insights'])assert.equal(await pane.getByRole('heading',{name:title,exact:true}).evaluate(n=>getComputedStyle(n).fontSize),'17px',`${title} heading is 17px`);
      const record=pane.locator('.insight-icon.good'),hard=pane.locator('.insight-icon:not(.good)');assert(await record.locator('svg').count(),'new personal record uses a trophy icon');assert(await hard.locator('svg').count(),'hard session uses a flame icon');
      for(const icon of [record,hard])assert.deepEqual(await icon.evaluate(n=>{const r=n.getBoundingClientRect();return[Math.round(r.width),Math.round(r.height)];}),[28,28],'insight icon uses a 28px tinted circle');
      for(const title of ['New personal record','Hard session'])assert.equal(await pane.locator('.insight').filter({hasText:title}).locator('b').evaluate(n=>getComputedStyle(n).fontWeight),'700',`${title} title is strong`);
      const route=pane.locator('a.card.tap[href^="/route/"]');assert.notEqual(await route.evaluate(n=>getComputedStyle(n).boxShadow),'none','matched route is raised');
      const compare=route.locator('.more');assert.match(await compare.evaluate(n=>getComputedStyle(n).backgroundImage),/gradient/,'Compare uses the brand gradient');
     }
     if(key==='efforts'){
      assert.match(await pane.innerText(),/Best efforts[\s\S]*5K[\s\S]*Current PR/,'Efforts keeps the fictional personal record and context');
      assert.equal(await pane.getByRole('heading',{name:'Best efforts',exact:true}).evaluate(n=>getComputedStyle(n).fontSize),'17px','Best efforts heading is 17px');
      const pr=pane.locator('.medal.m1'),time=pane.locator('.effort-time').first();assert.equal(await pr.innerText(),'PR');
      assert.equal(await pr.evaluate(n=>getComputedStyle(n).borderWidth),'2px','PR medal has a visible gradient rim');assert.match(await pr.evaluate(n=>getComputedStyle(n).backgroundImage),/gradient/,'PR medal has the #981 gradient finish');assert.match(await pr.evaluate(n=>getComputedStyle(n).boxShadow),/inset/,'PR medal has a specular rim highlight');
      assert.equal(await time.evaluate(n=>getComputedStyle(n).fontSize),'18px','effort time is 18px');assert.equal(await time.evaluate(n=>getComputedStyle(n).fontWeight),'700','effort time is bold');
      assert.match(await time.evaluate(n=>getComputedStyle(n).fontVariantNumeric),/tabular-nums/);const effortBar=pane.locator('.effort-bar').first();assert.equal(await effortBar.evaluate(n=>n.getAttribute('aria-hidden')),'true');assert.match(await effortBar.locator('linearGradient').getAttribute('id'),/^activity-effort-/,'each effort has its own comparison gradient');assert(Number(await effortBar.locator('rect').getAttribute('width'))>0,'each effort has a visible bar scaled against the PR');
     }
     if(out){
      await p.evaluate(()=>{const tabs=document.querySelector('.dtabs');window.scrollTo(0,Math.max(0,window.scrollY+tabs.getBoundingClientRect().top-90));});
      await p.waitForTimeout(150);fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`activity-tabs-${key}-390-${theme}.png`),animations:'disabled'});
     }
    }
    assert.deepEqual(errors,[]);assert(!writes.some(x=>!['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(x)),'tab review performs no unrelated writes');
    await c.close();contexts.splice(contexts.indexOf(c),1);
   }
   console.log('Activity Details, Splits and Efforts 390px light/dark: named panes, varied splits, gradients, no overflow PASS');
  }
  if(loadCases.length)console.log(`ActivityDetail lazy loading: ${loadCases.join(', ')} PASS`);
 }finally{for(const c of contexts)await c.close();for(const who of ['owner','friend']){const c=await b.newContext();try{const r=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_'+who,password:pw}});if(r.ok())await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
