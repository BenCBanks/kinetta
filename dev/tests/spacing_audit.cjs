// Local: prepare with KINETTA_URL/KINETTA_PROJECT python3 dev/tests/spacing_prepare.py, then run this file with
// NODE_PATH pointing to Playwright. KINETTA_SPACING_FIXTURES selects its JSON; KINETTA_SPACING_REPORT selects output.
// KINETTA_SPACING_SCREENS is a comma-separated local subset. CI runs every scene; all saves/devices are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {until,settle,fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
const {audit,validateExceptions,combineMeasurements}=require('./spacing_geometry.cjs'),{collectSpacing}=require('./spacing_dom.cjs'),{scenes,initialize,notificationState,modalState}=require('./spacing_screens.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Spacing evidence requires a disposable local server');
const fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_SPACING_FIXTURES||'/tmp/'+project+'-spacing-fixtures.json','utf8'));
assert.equal(fixtures.base,base);assert.equal(fixtures.project,project);if(fixtures.me_today?.plan)assert.equal(fixtures.me_today.plan.today,fixtures.me_today.today,'Me Today plan response and its shared-clock fixture use the same account day');
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'spacing_exceptions.json'),'utf8'));validateExceptions(rules);
const report=path.resolve(process.env.KINETTA_SPACING_REPORT||'/tmp/'+project+'-spacing-report.json'),pictures=process.env.KINETTA_SPACING_SHOTS;
const collectVisualOverlaps=()=>{
 const selector=el=>{if(el.id)return'#'+CSS.escape(el.id);const parts=[];for(let n=el;n&&n!==document.body&&parts.length<5;n=n.parentElement){if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}let part=n.tagName.toLowerCase();if(typeof n.className==='string'&&n.className.trim())part+='.'+n.className.trim().split(/\s+/).slice(0,2).map(CSS.escape).join('.');const same=n.parentElement?[...n.parentElement.children].filter(s=>s.tagName===n.tagName):[];if(same.length>1)part+=`:nth-of-type(${same.indexOf(n)+1})`;parts.unshift(part);}return parts.join(' > ');},
  rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};},
  visible=el=>{const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0||el.closest('.vh:not(.subpage-header .vh)'))return false;const ring=el.closest('.calorie-ring-wrap');if(ring&&ring!==el)return false;for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;},
  isVisual=el=>{const name=typeof el.className==='string'?el.className:el.className?.baseVal||'';return /(?:^|[\s_-])(?:badge|medal|medallion|ring|avatar)(?:$|[\s_-])/i.test(name)||el.classList.contains('av');},
  overlap=(a,b)=>({x:Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),y:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)}),
  candidates=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&isVisual(el)),out=new Map(),add=(a,b,ar,br)=>{const d=overlap(ar,br);if(d.x<=1||d.y<=1)return;const key=[selector(a),selector(b)].sort().join('|');out.set(key,{metric:'badge-overlap',element:selector(a),neighbour:selector(b),actual:{horizontal:d.x,vertical:d.y},expected:'no intersection over 1px',box:ar,neighbourBox:br});};
 for(const el of candidates){
  const own=rect(el),boundary=el.closest('.profile-achievement-list,.profile-achievement-sport-cards,.me-featured-achievements,.achievement-share-badges,.achievement-share-track-grid,.achievement-share-all-rows,.achievement-share-card,.profile-achievement-history-head,.post-hd,.me-card,.card')||el.parentElement;
  let branch=el;
  for(let parent=el.parentElement;parent;branch=parent,parent=parent.parentElement){
   const siblings=[...parent.children].filter(node=>node!==branch&&visible(node));
   for(const sibling of siblings){
    add(el,sibling,own,rect(sibling));const walker=document.createTreeWalker(sibling,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()){
     if(!node.textContent.trim()||!visible(node.parentElement))continue;const range=document.createRange();range.selectNodeContents(node);
     for(const line of range.getClientRects())add(el,node.parentElement,own,{x:line.x,y:line.y,width:line.width,height:line.height});
    }
   }
   if(parent===boundary)break;
  }
 }
 return[...out.values()];
};
async function verifyVisualOverlapCollector(browser){
 const page=await browser.newPage();
 try{
  await page.setContent(`<style>body{margin:0}.profile-achievement-list{position:absolute;width:60px;height:30px}.profile-achievement{position:absolute;inset:0}.profile-achievement-medallion,.profile-achievement-name{position:absolute;top:0;height:20px}.profile-achievement-medallion{left:0;width:20px}.profile-achievement-name{font:12px/20px sans-serif;white-space:nowrap}.overlap .profile-achievement-name{left:18px}.one-pixel .profile-achievement-name{left:19px}.calorie-ring-wrap{position:absolute;left:0;top:60px;width:40px;height:40px}.calorie-ring{width:40px;height:40px}.calorie-ring-label{position:absolute;inset:0}.test-overlap .external-label{position:absolute;left:38px;top:70px;width:20px;height:20px}.test-clear .external-label{position:absolute;left:41px;top:70px;width:20px;height:20px}</style><div class="profile-achievement-list overlap"><div class="profile-achievement"><span class="profile-achievement-medallion"></span><span class="profile-achievement-name">Run</span></div></div><div class="profile-achievement-list one-pixel" style="left:100px"><div class="profile-achievement"><span class="profile-achievement-medallion"></span><span class="profile-achievement-name">Run</span></div></div><div class="test-overlap"><div class="calorie-ring-wrap"><svg class="calorie-ring"></svg><div class="calorie-ring-label">1,210 kcal</div></div><span class="vh">Accessible label</span><span class="external-label">Run</span></div><div class="test-clear" style="top:120px"><div class="calorie-ring-wrap"><svg class="calorie-ring"></svg><div class="calorie-ring-label">1,210 kcal</div></div><span class="vh">Accessible label</span><span class="external-label">Run</span></div>`);
  const overlaps=await page.evaluate(collectVisualOverlaps);assert.equal(overlaps.length,2,'visual overlap collector flags >1px while ignoring a 1px touch and intentional ring internals');assert(overlaps.some(v=>v.element.includes('profile-achievement-medallion')&&v.neighbour.includes('profile-achievement-name')),'the synthetic badge-label overlap exceeds the threshold');assert(overlaps.some(v=>v.element.includes('calorie-ring-wrap')&&v.neighbour.includes('external-label')),'the ring wrapper still detects an overlapping external label');
 }finally{await page.close();}
}
async function waitForRouteStyles(p){
 const ready=()=>[...document.querySelectorAll('link[data-route-style]')].every(link=>!!link.sheet);
 await p.waitForFunction(ready,null,{timeout:30000});
 // A loaded sheet can still be one frame behind style recalculation. Let the
 // browser apply it before collecting geometry for the first scene measure.
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function waitForPaintGate(p){
 await p.waitForFunction(()=>{const page=document.querySelector('#page');return page&&!page.hasAttribute('data-paint-gate');},null,{timeout:30000});
}
(async()=>{
 const browser=await chromium.launch(),results=[],errors=[];let sessions;
 const overlapScenes=new Set([
  'Me','Me Today plan','Sharing & privacy','Track ready','Lifting with sets','Lifting blank sets',
  'Progress','Fitness','Nutrition day','Add food','Recipes and foods','Groups','Group create',
  'Group empty roster','Group full roster','Invite acceptance','Settings','Notifications',
  'Share progress','Nutrition Insights','Account name sheet','Pinned save sheet','Quick weight sheet',
  'Share card choices','Public link confirmation'
 ]);
 let selected=scenes(fixtures).map(s=>s.name==='Home'?{...s,visualOverlapCheck:true}:overlapScenes.has(s.name)?{...s,visualOverlapCheck:true,visualOverlapOnly:true}:s);
 selected.push(
  {name:'Achievements',login:'alex',route:'/me/achievements#run',ready:'#profile-achievement-page[aria-busy="false"]',visualOverlapCheck:true,visualOverlapOnly:true},
  {name:'Your profile',login:'alex',route:'/people/alex?q=spacing-no-match',ready:'#person-profile .me-card-sections[aria-busy="false"]',visualOverlapCheck:true,visualOverlapOnly:true},
  {name:'Friend profile',login:'zz_test_fc_typical',route:'/people/zz_test_fc_peer00',ready:'#person-profile .me-card-sections[aria-busy="false"]',visualOverlapCheck:true,visualOverlapOnly:true}
 );
 if(process.env.KINETTA_SPACING_SCREENS){const names=process.env.KINETTA_SPACING_SCREENS.split(',');selected=selected.filter(s=>names.includes(s.name));assert.equal(selected.length,names.length,'Every selected scene exists');}
 try{
  await verifyVisualOverlapCollector(browser);
  sessions=await fixtureSessions(browser,base,selected);
  const clockMatrix=!!process.env.KINETTA_SPACING_CLOCK,sizes=clockMatrix?[{width:390,height:844,root:16}]:[{width:390,height:844,root:16},{width:330,height:667,root:16}],themes=clockMatrix?['light']:['light','dark'];
  for(const size of sizes)for(const theme of themes)for(const scene of selected){
   let c;const writes=[],pageErrors=[];
   try{
    const opened=await fixturePage(browser,base,fixtures,sessions,scene,size,theme);c=opened.c;const {p,auth}=opened;
    await waitForRouteStyles(p);
    // The first-fold shell is intentionally aria-hidden. Wait for its real route
    // content before checking selectors or measuring controls/text.
    await waitForPaintGate(p);
    if(scene.detailRedesign){
     await p.locator('#d-map .leaflet-tile-loaded').first().waitFor({state:'attached'});
     await p.evaluate(()=>document.fonts.ready);
     assert(await p.locator('.activity-charts .readout').isHidden(),'Activity detail starts without the chart range row');
    }
    // Reuse the guarded context's live collectors throughout traversal.
    const writes=opened.writes,pageErrors=opened.pageErrors;
    if(scene.todayPlan){
     const row=p.locator('#t-today [data-today-plan]'),title=row.locator('.me-today-title'),value=row.locator('.me-today-value');
     assert.equal(await row.count(),1,'The deterministic Me Today fixture renders its planned workout row');
     assert.equal(await p.locator('#t-today').getAttribute('data-loaded-day'),fixtures.me_today.today,'The Me Today fixture and its page clock use the same day');
     assert.equal(await title.count(),1,'The planned workout row has one visible title');
     assert.equal(await title.innerText(),fixtures.me_today.workout_title,'The row names the fixture’s active plan workout');
     assert.equal(await value.innerText(),fixtures.me_today.workout_amount,'The row shows the fixture’s planned workout amount once');
     assert.equal(await row.getAttribute('href'),'/plan','Tapping the planned workout opens the plan');
     const font=await title.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
     assert(font>=size.root*15/16-.02&&font<=size.root+.02,`Today workout title follows the body scale (${font}px at ${size.root}px root)`);
    }
    const measurements=[],seen=new Set(),allTexts=new Map(),exposure=new Map(),visualOverlaps=new Map();
    const measure=async()=>{
     assert(await p.evaluate(id=>App.me?.id===id,auth.id),'The intended fictional account remains signed in');assert.equal(await p.locator('.login').count(),0,'The intended screen cannot be replaced by login');
     await waitForPaintGate(p);
     await p.locator(scene.recap?'[data-share-image="0"]':scene.ready).first().waitFor({state:'attached'});
     const snapshot=await p.evaluate(collectSpacing,{screen:scene.name,rules});
     if(scene.visualOverlapCheck)for(const v of await p.evaluate(collectVisualOverlaps))visualOverlaps.set(JSON.stringify([v.metric,v.element,v.neighbour].sort()),{screen:scene.name,...v});
     for(const t of snapshot.texts)allTexts.set(t.key,t);
     const score=r=>Math.min(44,r.width)*Math.min(44,r.height);
     for(const t of snapshot.targets){const old=exposure.get(t.key),bestUsable=old&&score(old.bestUsable)>=score(t.usableRect)?old.bestUsable:t.usableRect;exposure.set(t.key,{...t,bestUsable,seenFully:old?.seenFully||t.fullyVisible,exposed:old?.exposed||t.hit});}
     const key=JSON.stringify(snapshot.targets.map(t=>[t.key,t.rect]));if(!seen.has(key)){if(!scene.visualOverlapOnly)measurements.push(audit(snapshot,rules));seen.add(key);}
    };
    const frame=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    // Traverse below the fold too. A sheet scrolls independently from its inert background.
    let end=false,traversedEnd=false;
    for(let step=0;step<30;step++){
     await settle(p);await measure();
     // Reveal every column/slide too, so a partly exposed rail item is measured when reachable.
     const rails=await p.evaluate(()=>{document.querySelectorAll('[data-spacing-rail]').forEach(n=>n.removeAttribute('data-spacing-rail'));let id=0;return[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return n.scrollWidth>n.clientWidth+1&&/auto|scroll/.test(getComputedStyle(n).overflowX)&&r.width>0&&r.bottom>0&&r.top<innerHeight;}).map(n=>{n.dataset.spacingRail=String(++id);return{id:n.dataset.spacingRail,start:n.scrollLeft,max:n.scrollWidth-n.clientWidth,width:n.clientWidth};});});
     for(const rail of rails){
      assert(rail.max/Math.max(1,rail.width)<30,'Horizontal rail fits the bounded audit traversal');
      // Half-width steps avoid skipping a card snap that fully exposes a corner control.
      for(let x=0;;x=Math.min(rail.max,x+Math.max(44,rail.width*.5))){await p.locator(`[data-spacing-rail="${rail.id}"]`).evaluate((n,x)=>{n.scrollLeft=x;},x);await frame();await measure();if(x>=rail.max)break;}
      await p.locator(`[data-spacing-rail="${rail.id}"]`).evaluate((n,x)=>{n.scrollLeft=x;},rail.start);await frame();
     }
     if(end){traversedEnd=true;break;}
     end=await p.evaluate(()=>{const sheet=document.querySelector('.scrim:not([inert]):not(.is-closing) .sheet'),body=sheet?.querySelector(':scope > .sbody'),el=body&&body.scrollHeight>body.clientHeight+1?body:sheet||document.querySelector('.ph-view:not([inert]),.map.full:not([inert])')||document.scrollingElement,before=el.scrollTop;el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,before+Math.max(200,el.clientHeight*.7));return Math.abs(el.scrollTop-before)<1||el.scrollTop+el.clientHeight>=el.scrollHeight-1;});
    }
    assert(traversedEnd,'Vertical content fits the bounded audit traversal');
    // Hero limits apply to the whole card, including values encountered at different scroll positions.
    if(!scene.visualOverlapOnly)measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[],texts:[...allTexts.values()]},rules));
    // A sticky/header layer must not hide a target at every position where it can be fully in view.
    if(!scene.visualOverlapOnly)for(const t of exposure.values())if(t.bestUsable.width<43.98||t.bestUsable.height<43.98||t.seenFully&&!t.exposed)measurements.push(audit({screen:scene.name,rootFont:size.root,targets:[{...t,rect:t.bestUsable,unreachable:t.seenFully&&!t.exposed}],texts:[]},rules));
    if(pictures){fs.mkdirSync(pictures,{recursive:true});await p.evaluate(todayPlan=>{const section=todayPlan&&document.querySelector('#t-today .me-today');window.scrollTo(0,section?Math.max(0,window.scrollY+section.getBoundingClientRect().top-96):0);const sheet=document.querySelector('.scrim:not([inert]):not(.is-closing) .sheet'),body=sheet?.querySelector(':scope > .sbody'),el=body&&body.scrollHeight>body.clientHeight+1?body:sheet;el?.scrollTo(0,0);},!!scene.todayPlan);await settle(p);await p.screenshot({path:path.join(pictures,scene.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+size.width+'-'+theme+'.png')});}
    const {violations,exceptionsUsed}=combineMeasurements(measurements,rules),allViolations=[...violations,...visualOverlaps.values()];
    results.push({screen:scene.name,width:size.width,root:size.root,theme,violations:allViolations,exceptionsUsed});
    const expectedWrites=['Activity detail','Activity photo viewer','Activity full map'].includes(scene.name)?new Set(['/api/milestones/celebrate']):new Set();
    const unexpectedWrites=writes.filter(path=>!expectedWrites.has(path));
    if(pageErrors.length||unexpectedWrites.length)errors.push({screen:scene.name,width:size.width,theme,pageErrors,writes:unexpectedWrites});
    console.log(`${scene.name} ${size.width}/${size.root} ${theme}: ${allViolations.length} violations`);
    for(const v of allViolations.slice(0,8))console.log(`  ${v.metric}: ${v.element}${v.neighbour?' ↔ '+v.neighbour:''} measured ${JSON.stringify(v.actual)}, expected ${JSON.stringify(v.expected)}`);
   }catch(e){errors.push({screen:scene.name,width:size.width,theme,error:e.message});console.error(scene.name,e.message);}finally{await c?.close();}
  }
 }finally{await browser.close();}
 fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify({results,errors},null,2));
 const failures=results.reduce((n,r)=>n+r.violations.length,0);console.log(`Spacing audit: ${results.length} cases, ${failures} violations, ${errors.length} loading/guard errors. Report: ${report}`);
 if(process.env.GITHUB_STEP_SUMMARY){
  const cell=v=>String(v).replace(/\|/g,'\\|').replace(/`/g,"'").replace(/\n/g,' ');
  let summary=`## Spacing audit\n\n${results.length} cases; ${failures} violations; ${errors.length} loading/guard errors. Fictional browser evidence is attached to this job.\n\n| Screen | Width/root | Theme | Violations |\n| --- | --- | --- | ---: |\n`;
  for(const r of results)summary+=`| ${cell(r.screen)} | ${r.width}/${r.root} | ${r.theme} | ${r.violations.length} |\n`;
  const first=results.flatMap(r=>r.violations).slice(0,30);
  if(first.length){summary+='\n| Screen | Element | Check | Measured | Required |\n| --- | --- | --- | --- | --- |\n';for(const v of first)summary+=`| ${cell(v.screen)} | ${cell(v.element)} | ${v.metric} | ${cell(JSON.stringify(v.actual))} | ${cell(JSON.stringify(v.expected))} |\n`;}
  for(const e of errors)summary+='\n'+cell(e.screen)+': '+cell(e.error||JSON.stringify(e))+'\n';
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 }
 if(failures||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
