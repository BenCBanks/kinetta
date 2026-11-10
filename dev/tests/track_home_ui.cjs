// The real launch page and fictional API data; an idle native stand-in records calls without GPS/Health effects.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill',medalCase=process.env.KINETTA_MEDAL_CASE||'',medalTheme=process.env.KINETTA_MEDAL_THEME||'light',medalShare=process.env.KINETTA_MEDAL_SHARE||'on',medalWidth=Number(process.env.KINETTA_MEDAL_WIDTH)||390,trackWidth=Number(process.env.KINETTA_TRACK_WIDTH)||0;
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error(label);}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'track_fixture.py')],{env:process.env,stdio:'inherit'});
 const sizes=trackWidth?[{width:trackWidth,height:trackWidth===390?844:667,root:16}]:medalCase?[{width:390,height:844,root:16},{width:330,height:667,root:16}]:[{width:390,height:844,root:16}];
 const b=await chromium.launch(),cleanup=[];
 try{for(const who of ['empty','runner','lifter'])for(const native of [true,false])for(const size of sizes)for(const theme of ['light','dark']){
  if(process.env.KINETTA_TRACK_CASE&&process.env.KINETTA_TRACK_CASE!==`${who}-${native?'native':'browser'}-${size.width}-${theme}`)continue;
  if(medalCase&&(who!=='empty'||native||theme!==medalTheme||size.width!==medalWidth))continue;
  const c=await b.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});cleanup.push(c);
  const signed=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_'+who,password:pw,app:native}});assert.equal(signed.status(),200);
  const token=(await signed.json()).token,auth=native?{Authorization:'Bearer '+token}:{},get=url=>c.request.get(base+url,{headers:auth}),me=await(await get('/api/me')).json(),rows=await(await get('/api/interval-presets')).json(),saved=rows.find(r=>r.definition.name==='Fictional 3 / 1');
  await c.addInitScript(({base,token,native,root,saved,id,who})=>{
   window.trackFixtureCalls=[];document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px');
   if(!native)return;const prefs={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>['KinettaTrack','Preferences'].includes(n),Plugins:{Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>{prefs[key]=value;},remove:async({key})=>{delete prefs[key];}},KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({routePlanSupport:1}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()}),intervalCapabilities:async()=>({intervalCapabilities:{outdoor:true}}),start:async args=>{trackFixtureCalls.push(['start',args]);throw Error('Fictional recording blocked');}}}};
   const scope=JSON.stringify([base,id]);if(who==='runner')localStorage.setItem('intervals:'+scope+':selected',JSON.stringify(saved));if(who==='lifter')localStorage.setItem('kinetta.track:'+scope+':choice','10');
  },{base,token,native,root:size.root,saved,id:me.id,who});
  const p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);if(q.method()==='PUT'&&u.pathname.startsWith('/api/interval-presets/'))return r.continue();return r.fulfill({json:{}});}if(medalCase&&u.pathname==='/api/sharing')return r.fulfill({json:{share_achievements:medalShare!=='off'}});if(medalCase&&u.pathname==='/api/achievements'){const ride=medalCase==='ride',tracks=medalCase==='closest'?[{code:'sport:run',value:9000,tiers:[]},{code:'journey',value:41800,tiers:[]}]:[{code:ride?'sport:ride':'sport:run',value:ride?157233:medalCase==='none'?6000:medalCase==='boundary'?8333.333333333334:9000,tiers:[]}];return r.fulfill({json:{pending:false,tracks}});}if(medalCase&&u.pathname==='/api/activities/65201'){const ride=medalCase==='ride';return r.fulfill({json:{id:65201,sport:ride?'ride':'run',name:'Fictional saved workout',start_time:new Date().toISOString(),created:new Date().toISOString(),distance_m:ride?20000:5000,moving_s:1800,elapsed_s:1800,ascent_m:0,efforts:[],lifts:null}});}return r.continue();});
  await p.goto(base+(medalCase?'/track?done=65201':'/track'));const ready=()=>until(p,()=>App.pageReady&&!!document.querySelector('#track-start')&&document.querySelector('#track-explore')?.getAttribute('aria-busy')==='false','launch ready');await ready();
  if(medalCase){
   if(medalCase==='none'||medalShare==='off')await p.waitForTimeout(400);else await until(p,()=>!!document.querySelector('#track-next-medal .activity-next-medal'),'saved next medal');
   const line=p.locator('#track-next-medal .activity-next-medal');if(medalCase==='none'||medalShare==='off')assert.equal(await line.count(),0,'no line outside the close threshold or when sharing is off');else{
    const metric=await p.evaluate(()=>App.me?.units==='metric'),copy=line.locator('.activity-next-medal-copy'),actual=await copy.innerText();
    if(medalCase==='closest'){assert.equal(await line.getAttribute('href'),'/me/achievements/journey');assert.match(actual,/Marathon medal$/);}
    else{assert.equal(await line.getAttribute('href'),`/me/achievements/${medalCase==='ride'?'sport%3Aride':'sport%3Arun'}`);const remaining=medalCase==='ride'?(metric?'3.7 km':'2.3 mi'):(metric?'1 km':medalCase==='boundary'?'1 mi':'0.62 mi'),name=medalCase==='ride'?'Century':'10K',full=`${remaining} to your ${name} medal`,compact=`${remaining} to ${name}`,fullFits=await copy.evaluate((el,text)=>{const link=el.closest('a'),tight=link.classList.contains('is-tight'),font=link.style.fontSize,before=el.textContent;link.classList.remove('is-tight');link.style.removeProperty('font-size');el.textContent=text;const fits=el.scrollWidth<=el.clientWidth+1;el.textContent=before;if(tight)link.classList.add('is-tight');if(font)link.style.fontSize=font;return fits;},full);assert.equal(actual,fullFits?full:compact,'uses expanded medal wording only when it fits at '+size.width+'px');}
    const lineFit=await copy.evaluate(el=>{const link=el.closest('a'),box=link.parentElement,r=link.getBoundingClientRect(),b=box.getBoundingClientRect(),s=getComputedStyle(el);return{width:el.clientWidth,scroll:el.scrollWidth,height:el.getBoundingClientRect().height,lineHeight:parseFloat(s.lineHeight),whiteSpace:s.whiteSpace,ellipsis:s.textOverflow==='ellipsis'||/[…]|\.\.\./.test(el.textContent),inside:r.left>=b.left-1&&r.right<=b.right+1,boxWidth:box.clientWidth,boxScroll:box.scrollWidth};});assert(lineFit.scroll<=lineFit.width+1&&lineFit.height<=lineFit.lineHeight+1&&lineFit.whiteSpace==='nowrap'&&!lineFit.ellipsis&&lineFit.inside&&lineFit.boxScroll<=lineFit.boxWidth+1,'the medal copy stays on one unclipped line at '+size.width+'px: '+JSON.stringify(lineFit));
    const iconPath=new URL(await line.locator('img').getAttribute('src'),base).pathname;if(medalCase==='run'||medalCase==='boundary')assert(iconPath.endsWith('/sports_medal_flat.svg'), 'timer target uses the catalog medal art');if(medalCase==='ride')assert(iconPath.endsWith('/hundred_points_flat.svg'),'ride target keeps its catalog level art');
   }
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/track-saved-${medalCase}-${theme}.png`,fullPage:true,animations:'disabled'});}
   assert.deepEqual(errors,[]);assert(!writes.some(w=>!w.startsWith('/api/interval-presets/')&&w!=='/api/challenges/signup/continue'));console.log(`Saved workout ${medalCase} ${theme}: next-medal line and 25% threshold PASS`);await c.close();cleanup.pop();continue;
  }
  assert.equal(await p.locator('h1').innerText(),'Track');
  const tools=p.locator('#track-explore a');assert.equal(await tools.count(),1,'connections, import and Health share one Track tool');
  assert.equal(await tools.getAttribute('data-track-feature'),'connections');assert.equal(await tools.getAttribute('href'),'/track/connections');
  assert.equal(await tools.locator('.progress-tile-name b').innerText(),'Connections and import');
  assert.equal(await p.locator('#track-explore [data-track-feature=health]').count(),0,'Health is inside Connections');
  assert.equal(await p.locator('#track-explore [data-track-feature=explore]').count(),0,'Explore is removed from Track');
  assert.equal(await p.locator('#track-explore [data-track-feature=past]').count(),0,'past logging is outside Track tools');
  assert.equal(await p.locator('#track-log-past').innerText(),'Log a past workout');assert.equal(await p.locator('#track-log-past').getAttribute('href'),'/track?past=1');
  const pastBox=await p.locator('#track-log-past').boundingBox(),startBox=await p.locator('#track-start').boundingBox();
  assert(pastBox.height>=44&&pastBox.y>=startBox.y+startBox.height-1,'Log a past workout is a 44px link under Start');
  assert.equal(await p.locator('#track-kind,.track-other').count(),0,'no extra global choice row');
  assert.equal(await p.locator('.track-gps-note').count(),native?0:1,'GPS recording note appears only on the web');
  assert.equal(await p.locator('#track-explore').evaluate(n=>{const s=getComputedStyle(n);return `${s.display}/${s.flexDirection}/${s.rowGap}`;}),'flex/column/8px','Track tools are a plain one-column list with readable row gaps');
  assert.equal(await p.locator('#track-explore .progress-new:visible').count(),0,'Track tools have no unexplained New dots');
  const toolRows=await p.locator('#track-explore a').evaluateAll(nodes=>nodes.map(a=>{const title=a.querySelector('.progress-tile-name b'),range=document.createRange();range.selectNodeContents(title);const s=getComputedStyle(a);return{height:a.getBoundingClientRect().height,titleLines:range.getClientRects().length,titleFits:title.scrollWidth<=title.clientWidth+1,background:s.backgroundColor,radius:s.borderRadius,left:s.borderLeftWidth,right:s.borderRightWidth,bottom:s.borderBottomWidth,shadow:s.boxShadow};}));
  assert(toolRows.length===1&&toolRows.every(row=>row.height>=56&&row.titleLines===1&&row.titleFits),'the one-line tool row meets the 56px target and title fits '+JSON.stringify(toolRows));
  const wrapTitle=p.locator('#track-explore .progress-tile-name b').last(),originalTitle=await wrapTitle.textContent();await wrapTitle.evaluate(n=>{n.textContent='Connections and health across your connected training apps';});
  const wrapped=await wrapTitle.evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);const s=getComputedStyle(n);return{lines:range.getClientRects().length,fits:n.scrollWidth<=n.clientWidth+1,whiteSpace:s.whiteSpace,overflowWrap:s.overflowWrap};});
  assert(wrapped.lines>1&&wrapped.fits&&wrapped.whiteSpace==='normal'&&wrapped.overflowWrap==='anywhere','a long tool title wraps inside its row instead of clipping '+JSON.stringify(wrapped));await wrapTitle.evaluate((n,text)=>{n.textContent=text;},originalTitle);
  assert(toolRows.every(row=>row.background==='rgba(0, 0, 0, 0)'&&row.radius==='0px'&&row.left==='0px'&&row.right==='0px'&&row.bottom==='0px'&&row.shadow==='none'),'tool rows have no card boxes '+JSON.stringify(toolRows));
  assert(!/0 connected/.test(await p.locator('#track-explore').innerText()));assert.equal(await p.locator('#track-route').count(),0,'retired picker is not resurrected');
  for(const button of await p.locator('.track-quick button,.track-recording-options button').all())if(await button.isVisible()){const r=await button.boundingBox();assert(r.height>=44,'44px control');}
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no document overflow');
  if(size.root===16){const start=await p.locator('#track-start').boundingBox(),nav=await p.locator('nav.tabs').boundingBox(),more=await p.locator('#track-other').boundingBox();assert(start.y+start.height<nav.y,'Start above tabs');assert(more.x>=0&&more.x+more.width<=size.width,'More remains visible');if(!native){const first=await p.locator('#track-explore a').first().boundingBox();assert(first.y+first.height<nav.y,'browser first tool row visible');}}
  if(native&&who==='runner')await until(p,()=>!document.querySelector('#track-plan').hidden,'today workout');
  else assert(await p.locator('#track-plan').isHidden());
  if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${native?'native':'browser'}-${who}-${theme}.png`,fullPage:true,animations:'disabled'});}
  if(native&&who==='empty'&&size.width===390&&size.root===16&&theme==='dark'){
   const name='Fictional'+('longname'.repeat(13)),definition={schema:1,name,description:'',blocks:[{id:'main',repeat:3,steps:[{id:'run',action:'run',role:'effort',title:'',target:{kind:'time',amount:'3',unit:'min'}},{id:'walk',action:'walk',role:'recovery',title:'',target:{kind:'time',amount:'1',unit:'min'}}]}]};
   const created=await c.request.put(base+'/api/interval-presets/'+require('node:crypto').randomUUID(),{headers:{...auth,Origin:base},data:{mutation_id:require('node:crypto').randomUUID(),definition}});assert.equal(created.status(),200);const pin=await created.json();
   await p.evaluate(pin=>{store.set('intervals:'+JSON.stringify([Native.base,App.me.id])+':selected',pin);render();},pin);await ready();assert.equal(await p.locator('#interval-open').getAttribute('title'),name);assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'a long checked preset name cannot widen the phone');
  }
  await p.locator('#track-other').click();await p.waitForSelector('.pick-list');await p.locator('.pick-list [data-pk]').last().click();assert.equal(await p.locator('#track-other').getAttribute('aria-pressed'),'true');
  const firstQuick=p.locator('[data-quick]').first(),quickId=await firstQuick.getAttribute('data-quick');
  // A long selected activity may put the common prefix in More at a narrow phone width.
  if(await firstQuick.isVisible())await firstQuick.click();
  else{await p.locator('#track-other').click();await p.locator('.pick-list [data-pk="'+quickId+'"]').click();}
  assert.equal(await firstQuick.getAttribute('aria-pressed'),'true','The first common activity remains reachable directly or through More');
  if(native){
   await p.locator('#track-options').click();await p.waitForSelector('#track-voice');await p.locator('#track-voice').uncheck();await p.keyboard.press('Escape');assert.match(await p.locator('#track-options').getAttribute('aria-label'),/Spoken updates off/);
   await p.locator('#interval-open').click();await p.waitForSelector('#interval-library');if(who==='runner'){await p.locator('[data-remove]').click();assert.match(await p.locator('#interval-open').innerText(),/Intervals/);}await p.keyboard.press('Escape');
   if(who==='runner'){
    const before=(await(await get('/api/interval-presets')).json()).length;
    if(size.root===16&&theme==='light'){
     let release;const gate=new Promise(resolve=>release=resolve);await c.route(url=>/\/api\/interval-presets\/[0-9a-f-]+$/.test(url.pathname),async r=>{const response=await r.fetch();await gate;await r.fulfill({response});},{times:1});
     await p.locator('[data-plan-use]').click();assert(await p.locator('#track-start').isDisabled(),'Start waits for plan loading');await p.locator('#track-setup').dispatchEvent('submit');assert.deepEqual(await p.evaluate(()=>trackFixtureCalls),[],'Enter cannot start an older selection while loading');
     await p.locator('[data-quick="2"]').click();release();await until(p,()=>!document.querySelector('[data-plan-use]').disabled,'old plan reply finished');assert.equal(await p.evaluate(()=>Intervals.selected()),null,'a late plan reply keeps the newer choice');assert.equal(await p.locator('[data-quick="2"]').getAttribute('aria-pressed'),'true');
    }
    await p.locator('[data-plan-use]').click();await until(p,()=>Intervals.selected()?.definition.name.includes('Run/walk'),'plan snapshot loaded');
    assert.equal(await p.evaluate(()=>Intervals.selected().totals.seconds),1800);assert.deepEqual(await p.evaluate(()=>trackFixtureCalls),[],'Use does not start GPS');
    await p.locator('[data-plan-use]').click();await until(p,()=>!document.querySelector('[data-plan-use]').disabled,'repeat Use');const after=(await(await get('/api/interval-presets')).json()).length;assert(after<=before+1,'repeated Use creates no second preset');
    await p.locator('#track-start').click();await until(p,()=>document.querySelector('#track-ready-error').textContent.includes('Fictional recording blocked'),'stand-in blocked start');const call=await p.evaluate(()=>trackFixtureCalls[0]);assert.equal(call[1].sport,'run');assert.equal(call[1].intervalVoice,false);assert.equal(call[1].autoPause,false);
   }
  }
  await p.locator('#track-log-past').click();await p.waitForSelector('#ma');assert.equal(new URL(p.url()).pathname,'/track');assert(await p.evaluate(()=>Discovery.hasVisited('track','past')),'opening Log a past workout remembers its visit');await p.keyboard.press('Escape');await p.evaluate(()=>render());await ready();
  await p.locator('#track-explore a[data-track-feature=connections]').click();await p.waitForURL('**/track/connections');await p.locator('#c-health').waitFor();
  if(native){const importAction=p.locator('[data-import-history]');assert.equal(await importAction.count(),1,'native Connections keeps the browser import sub-screen');assert((await importAction.boundingBox()).height>=44,'native import action keeps a 44px target');await importAction.click();await p.waitForSelector('.sheet a[target=_blank]');assert.match(await p.locator('.sheet a[target=_blank]').getAttribute('href'),/\/track\/import$/);await p.keyboard.press('Escape');}
  else{const importLink=p.locator('a[href="/track/import"]');assert.equal(await importLink.count(),1,'web Connections keeps the import sub-screen');await importLink.click();await p.waitForURL('**/track/import');await until(p,()=>document.querySelector('h1')?.textContent==='Upload activities','existing import screen');assert.equal(new URL(p.url()).pathname,'/track/import','the existing import route still opens');}
  assert.equal((await get('/api/planned-routes')).status(),404,'parked API remains closed');
  assert.deepEqual(errors,[]);assert(!writes.some(w=>!w.startsWith('/api/interval-presets/')&&w!=='/api/challenges/signup/continue'),'no activity/Health/provider writes');console.log(`Track ${who} ${native?'native':'browser'} ${size.width}/${size.root} ${theme}: compact launch, choices, plan/intervals, settings and discovery PASS`);await c.close();cleanup.pop();
 }
 }finally{for(const c of cleanup)await c.close();for(const who of ['empty','runner','lifter']){const c=await b.newContext();try{const r=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_'+who,password:pw}});if(r.ok())await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
