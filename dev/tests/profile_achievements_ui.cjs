'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const SCREENSHOT_CLOCK=require('../screenshots/fixture-time.json'),SCREENSHOT_NOW=new Date(SCREENSHOT_CLOCK.instant),SCREENSHOT_YEAR=SCREENSHOT_NOW.getUTCFullYear();
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../../app/static/profile.achievement-levels.json'),'utf8'));
for(const [code,track] of Object.entries(catalog.tracks)){
 const glyphs=track.levels.map(row=>row.emoji);
 for(let i=0;i<glyphs.length;i++){const nearby=glyphs.slice(i,i+3);assert.equal(new Set(nearby).size,nearby.length,`${code} level icon differs from the next two levels`);}
 for(const row of track.levels){const file=path.join(__dirname,'../../app/static',row.icon.replace(/^\/static\//,'').split('?')[0]);assert(fs.existsSync(file),`${code}/${row.name} has a local Fluent Flat SVG`);}
}
assert.deepEqual(catalog.tracks.workouts.levels.slice(0,2).map(row=>[row.name,row.asset_name]),[['Seed','Chestnut'],['Sprout','Seedling']],'Workouts uses the canonical starter badges and artwork');
assert.equal(catalog.version,4,'the fixture follows the canonical catalogue version');
assert.deepEqual(catalog.tracks.active_time.levels.slice(-2).map(row=>row.name),['A working year','Mastery (10,000 hours)']);
assert.doesNotMatch(JSON.stringify(catalog),/A year of days|Century club|blue whales ×/i);
assert.deepEqual(catalog.tracks.lifted.levels.slice(2,4).map(row=>row.name),['A school bus','A loaded semi truck']);
assert.equal(catalog.tracks.lifted.levels[6].name,'A jumbo jet');
assert.equal(catalog.tracks.journey.levels[0].canonical_value,42.195);
assert.equal(catalog.tracks['sport:ride'].levels[2].name,'Metric century');
assert.equal(catalog.tail.first_multiple,2);

const makeTrack=(code,label,level,value,displayValue,displayUnit,tiers,next)=>({code,label,level,value,display_value:displayValue,display_unit:displayUnit,tiers,next});
const tier=(rank,label,threshold,day,activity_id)=>({rank,label,title:label,threshold,unit:'count',day,activity_id});
const catalogValue=level=>{
 const value=Number(level.canonical_value)||0;
 return level.canonical_unit==='km'?value*1000:level.canonical_unit==='hours'?value*3600:value;
};
const v2History=(code,overrides={})=>{
 const definition=catalog.tracks[code],track=achievementFixture.tracks.find(row=>row.code===code);
 if(!definition||!track)return{code,tiers:[],pending:false};
 const value=Number(overrides[code]??track.value)||0;
 const levels=definition.levels.map((level,index)=>({rank:index+1,name:level.name,threshold:catalogValue(level)})).filter(level=>level.threshold<=value);
 const last=definition.levels.at(-1),base=catalogValue(last);let multiple=Math.max(2,Number(catalog.tail.first_multiple)||2);
 while(base>0&&base*multiple<=value&&levels.length<10000){levels.push({rank:levels.length+1,name:`${last.name} ×${multiple}`,threshold:base*multiple});multiple++;}
 return{code,pending:false,tiers:levels.map((level,index)=>({...level,day:code==='journey'&&level.rank===1?`${SCREENSHOT_YEAR-1}-10-01`:code==='journey'&&level.rank===3?'':new Date(Date.UTC(SCREENSHOT_YEAR,9,1+index)).toISOString().slice(0,10),activity_id:code==='journey'&&level.rank===2?null:3000+index,date_source:'activity'}))};
};
const stripCss='.profile-achievement-level-strip{padding:24px 16px}.profile-achievement-level-strip h1{margin:0 0 8px;font-size:1.35rem}.profile-achievement-level-strip>p{max-width:340px;margin:0 0 20px;color:var(--tx2)}.profile-achievement-level-swatches{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;max-width:358px}.profile-achievement-level-swatch{--achievement-palette-base:var(--run);display:flex;flex-direction:column;align-items:center;gap:7px}.profile-achievement-level-swatch .profile-achievement-medallion{flex-basis:34px;width:34px;height:34px}.profile-achievement-level-swatch .profile-achievement-icon{width:16px;height:16px}.profile-achievement-level-swatch small{color:var(--tx2);font-size:.7rem}.profile-achievement-level-swatch .profile-achievement-value,.profile-achievement-level-swatch .profile-achievement-level{display:none}:root[data-achievement-evidence="all-tracks"] nav.tabs,:root[data-achievement-evidence="track"] nav.tabs{display:none!important}';
const achievementFixture={pending:false,tracks:[
 makeTrack('journey','Journey',5,6099414,3790,'mi',[
  tier(1,'Marathon',42195,'2026-10-10',1001),tier(2,'Ironman 70.3',113137,'2026-10-17',1002),
  tier(3,'Ironman 140.6',226274,'2026-10-28',1003),tier(4,'Length of Britain',1406567,'2026-11-02',1004),tier(5,'Across the US',4506163,'2026-11-05',1005)],
  {label:'Length of Africa',threshold:7400000,display_threshold:4598.1,display_unit:'mi'}),
 makeTrack('workouts','Workouts',8,1120,1120,'workouts',[tier(8,'Grove',1000,'2026-11-04',1101)],
  {label:'Forest',threshold:1500,display_threshold:1500,display_unit:'workouts'}),
 makeTrack('lifted','Lifted',4,300000,661387,'lb',[tier(1,'A car',1500,'2026-09-10',1200),tier(2,'An elephant',6000,'2026-10-10',1201),tier(3,'A blue whale',150000,'2026-10-20',1202),tier(4,'2 blue whales',300000,'2026-11-03',1203)],
  {label:'3 blue whales',threshold:450000,display_threshold:992080,display_unit:'lb'}),
 makeTrack('sport:run','Run',4,80000,49.7,'mi',[tier(4,'Marathon',42195,'2026-11-02',1301)],
  {label:'84.4 km',threshold:84390,display_threshold:52.4,display_unit:'mi'}),
 makeTrack('active_time','Active time',6,3960000,1100,'h',[tier(6,'1,000 active hours',3600000,'2026-11-01',1401)],
  {label:'1,500 active hours',threshold:5400000,display_threshold:1500,display_unit:'h'}),
 makeTrack('years_active','Years active',5,5,5,'years',[tier(5,'5 years active',5,'2026-10-31',1501)],
  {label:'6 years active',threshold:6,display_threshold:6,display_unit:'years'}),
 makeTrack('consistency','Consistency',3,22,22,'weeks',[tier(3,'20 active weeks',20,'2026-10-30',1601)],
  {label:'52 active weeks',threshold:52,display_threshold:52,display_unit:'weeks'}),
 makeTrack('climbing','Climbing',3,17000,55774,'ft',[tier(3,'1 Everest',8849,'2026-10-29',1701)],
  {label:'2 Everests',threshold:17698,display_threshold:58064,display_unit:'ft'}),
 makeTrack('personal_bests','Personal bests',3,10,10,'bests',[tier(3,'10 personal bests',10,'2026-10-27',1801)],
  {label:'25 personal bests',threshold:25,display_threshold:25,display_unit:'bests'}),
 makeTrack('sport:ride','Ride',3,100000,62.1,'mi',[tier(3,'100 km',100000,'2026-10-26',1901)],
  {label:'200 km',threshold:200000,display_threshold:124.3,display_unit:'mi'}),
 makeTrack('sport:walk-hike','Walk & hike',3,30000,18.6,'mi',[tier(3,'Half marathon',21097.5,'2026-10-25',2001)],
  {label:'42.2 km',threshold:42195,display_threshold:26.2,display_unit:'mi'}),
 makeTrack('sport:swim','Swim',2,6000,3.7,'mi',[tier(2,'5 km',5000,'2026-10-24',2101)],
  {label:'10 km',threshold:10000,display_threshold:6.2,display_unit:'mi'}),
 makeTrack('sport:lift','Lift',3,22,22,'sessions',[tier(3,'10 lift sessions',10,'2026-10-23',2201)],
  {label:'25 lift sessions',threshold:25,display_threshold:25,display_unit:'sessions'})
]};
const historyUnits={consistency:'weeks',years_active:'years',workouts:'workouts',active_time:'seconds',journey:'m',climbing:'m',lifted:'kg',personal_bests:'bests','sport:run':'m','sport:ride':'m','sport:walk-hike':'m','sport:swim':'m','sport:lift':'sessions'};
const displayHistoryTier=(code,value,units)=>{
 if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(code))return units==='imperial'?[value/1609.344,'mi']:[value/1000,'km'];
 if(code==='climbing')return units==='imperial'?[value*3.28084,'ft']:[value,'m'];
 if(code==='lifted')return units==='imperial'?[value*2.2046226218,'lb']:[value,'kg'];
 if(code==='active_time')return [value/3600,'h'];
 return [value,historyUnits[code]||'count'];
};

let futureEvidence=false;
const until=async(page,fn,label,arg)=>{for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);};
const waitForHistoryTrack=async(page,code,label)=>{await page.locator('#profile-achievement-page .profile-achievement-history-head').waitFor({state:'visible'});await until(page,expected=>document.querySelector('#profile-achievement-page .profile-achievement-history-head')?.dataset.achievementCode===expected,label,code);await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();};
const screenshot=async(page,dir,name,options={})=>{if(!dir)return;fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`,animations:'disabled',...options});};
const expandAchievementLevels=async page=>{assert.equal(await page.locator('.profile-achievement-levels [data-achievement-show-all]').count(),0,'all named levels are visible without a disclosure');};
const brightness=color=>{const channels=(color.match(/[\d.]+/g)||[]).slice(0,3).map(Number);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
const assertMedalText=async(container,label)=>{
 assert.equal(await container.locator('.profile-achievement-ring').count(),0,`${label} badges have no circular progress ring`);
 const metrics=await container.locator('.profile-achievement-value').evaluateAll(nodes=>nodes.map(node=>{
  const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()],badge=node.closest('.profile-achievement-medallion').getBoundingClientRect();
  return{code:node.closest('[data-achievement-code]')?.dataset.achievementCode||'history',text:node.textContent.trim(),fontSize:parseFloat(getComputedStyle(node).fontSize),lines:new Set(rects.map(r=>Math.round(r.top*2)/2)).size,fits:node.scrollWidth<=node.clientWidth+1&&rects.every(r=>r.left>=badge.left-1&&r.right<=badge.right+1&&r.top>=badge.top-1&&r.bottom<=badge.bottom+1)};
 }));
 assert(metrics.length,`${label} includes medallion values`);
 assert(metrics.every(m=>m.fontSize>=10&&m.lines<=2&&m.fits),`${label} values stay within the medal at 10px or larger: ${JSON.stringify(metrics)}`);
};
const assertFeaturedRailInset=async(page,label)=>{
 const layout=await page.locator('.me-featured-achievements .profile-achievement-list').evaluate(node=>{const style=getComputedStyle(node),rail=node.getBoundingClientRect(),card=node.closest('.me-card').getBoundingClientRect(),items=[...node.children].map(item=>{const r=item.getBoundingClientRect(),medalNode=item.querySelector('.profile-achievement-medallion'),medal=medalNode.getBoundingClientRect(),name=item.querySelector('.profile-achievement-name'),caption=item.querySelector('.profile-achievement-next'),range=document.createRange(),icon=medalNode.querySelector('.profile-achievement-icon').getBoundingClientRect(),value=medalNode.querySelector('.profile-achievement-value').getBoundingClientRect(),level=medalNode.querySelector('.profile-achievement-level')?.getBoundingClientRect(),multiple=medalNode.querySelector('.profile-achievement-multiple')?.getBoundingClientRect(),overlap=(a,b)=>a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;range.selectNodeContents(name);return{left:r.left,right:r.right,top:r.top,height:r.height,medal:medal.width,name:name.textContent.trim(),nameFits:name.scrollWidth<=name.clientWidth+1,nameLines:new Set([...range.getClientRects()].map(rect=>rect.top)).size,captionFits:caption.scrollWidth<=caption.clientWidth+1,value:value.width,valueText:medalNode.querySelector('.profile-achievement-value').textContent.trim(),aria:item.getAttribute('aria-label'),badgesClear:[level,multiple].filter(Boolean).every(badge=>!overlap(badge,icon)&&!overlap(badge,value)&&(!level||!multiple||!overlap(level,multiple)))};});return{width:innerWidth,left:rail.left-card.left,right:card.right-rail.right,display:style.display,columns:style.gridTemplateColumns.split(' ').length,overflow:style.overflowX,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,gap:parseFloat(style.columnGap),items};});
 const medalRange=layout.width<=350?[56,60]:[68,72];
 assert(layout.left>=16&&layout.right>=16&&layout.display==='grid'&&layout.columns===4&&layout.overflow==='visible'&&layout.scrollWidth<=layout.clientWidth+1&&layout.gap>=8,`${label} shows the four-across Featured grid without horizontal scrolling: ${JSON.stringify(layout)}`);
 assert(layout.items.length===4&&layout.items.every(item=>item.top===layout.items[0].top&&item.height>=44&&item.left>=0&&item.right<=layout.width&&item.medal>=medalRange[0]&&item.medal<=medalRange[1]&&item.nameFits&&item.captionFits&&item.badgesClear),`${label} fits every medal, badge and wrapping label in one row without overlap: ${JSON.stringify(layout.items)}`);
 assert(layout.items.every(item=>item.name!=='Workouts'||item.nameLines===1),`${label} keeps Workouts on one line`);
};
const assertFeaturedHeading=async(page,heading,label)=>{
 const style=await heading.evaluate(node=>{
  const title=node.querySelector(':scope > span'),link=node.querySelector(':scope > a'),titleRange=document.createRange();titleRange.selectNodeContents(title);
  const titleBox=title.getBoundingClientRect(),textBox=titleRange.getBoundingClientRect(),linkBox=link.getBoundingClientRect(),box=node.getBoundingClientRect(),titleStyle=getComputedStyle(title),linkStyle=getComputedStyle(link),referenceBox=document.createElement('div');referenceBox.className='me-card-label';referenceBox.style.cssText='position:absolute;visibility:hidden;pointer-events:none';referenceBox.innerHTML='<span>All time</span>';node.closest('.me-card').append(referenceBox);const reference=referenceBox.querySelector('span'),referenceStyle=getComputedStyle(reference);
  const probe=document.createElement('i');probe.style.color='var(--accent)';node.append(probe);const accent=getComputedStyle(probe).color;probe.remove();
  const titleLines=new Set([...titleRange.getClientRects()].map(rect=>Math.round(rect.top*2)/2)).size;
  const result={text:title.textContent.trim(),titleLines,titleSize:titleStyle.fontSize,titleWeight:titleStyle.fontWeight,referenceSize:referenceStyle.fontSize,referenceWeight:referenceStyle.fontWeight,linkSize:linkStyle.fontSize,linkWeight:linkStyle.fontWeight,linkColor:linkStyle.color,accent,headRight:box.right,linkRight:linkBox.right,gap:linkBox.left-textBox.right,noOverlap:titleBox.right<=linkBox.left+1,sameRow:Math.abs(titleBox.top+titleBox.height/2-linkBox.top-linkBox.height/2)<2};referenceBox.remove();return result;
 });
 assert.equal(style.text,'Featured achievements',`${label} names the featured-achievements section`);
 assert.equal(style.titleLines,1,`${label} heading stays on one line`);
 assert.equal(style.titleSize,style.referenceSize,`${label} heading matches the All time card-label size`);
 assert.equal(style.titleWeight,style.referenceWeight,`${label} heading matches the All time card-label weight`);
 assert.equal(style.linkSize,'14px',`${label} link uses the normal link size`);
 assert.equal(style.linkWeight,'600',`${label} link uses the normal link weight`);
 assert.equal(style.linkColor,style.accent,`${label} link uses the app blue`);
 assert(Math.abs(style.headRight-style.linkRight)<1&&style.noOverlap&&style.gap>=8&&style.sameRow,`${label} link sits at the right of the one-line label with a visible gap: ${JSON.stringify(style)}`);
};
const assertLargeTextFit=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-value').evaluateAll(nodes=>nodes.map(node=>{
  node.style.fontSize='22px';delete node.dataset.fitTextMax;const fontSize=window.KinettaTextFit.fitElement(node),range=document.createRange();range.selectNodeContents(node);
  const badge=node.closest('.profile-achievement-medallion').getBoundingClientRect(),rects=[...range.getClientRects()];
  return{fontSize,width:node.clientWidth,scrollWidth:node.scrollWidth,lines:new Set(rects.map(r=>Math.round(r.top*2)/2)).size,fits:rects.every(r=>r.left>=badge.left-1&&r.right<=badge.right+1&&r.top>=badge.top-1&&r.bottom<=badge.bottom+1)};
 }));
 assert(metrics.length,`${label} includes medallion values`);
 assert(metrics.every(m=>m.fontSize>=10&&m.fontSize<=22&&m.scrollWidth<=m.width+1&&m.lines<=2&&m.fits),`${label} values fit at large text without going below 10px: ${JSON.stringify(metrics)}`);
 assert(metrics.some(m=>m.fontSize<22),`${label} scales a long value down in steps`);
};
const assertAchievementGridTextFit=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-name,.profile-achievement-next').evaluateAll(nodes=>nodes.map(node=>{
  const range=document.createRange();range.selectNodeContents(node);const card=node.closest('.profile-achievement').getBoundingClientRect(),rects=[...range.getClientRects()],style=getComputedStyle(node),lines=new Set(rects.map(rect=>Math.round(rect.top*2)/2)).size,caption=node.classList.contains('profile-achievement-next'),wrapsWithoutClipping=!caption||(style.whiteSpace==='normal'&&style.overflow==='visible'&&style.textOverflow==='clip'&&style.webkitLineClamp==='none'&&style.maxHeight==='none');
  return{text:node.textContent.trim(),caption,lines,fits:wrapsWithoutClipping&&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1&&rects.every(rect=>rect.left>=card.left-1&&rect.right<=card.right+1&&rect.top>=card.top-1&&rect.bottom<=card.bottom+1)};
 }));
 assert(metrics.length,`${label} includes achievement labels`);
 assert(metrics.every(row=>row.fits&&row.lines>=1),`${label} labels wrap without clipping inside their medal columns: ${JSON.stringify(metrics.filter(row=>!row.fits||row.lines<1))}`);
 const captions=metrics.filter(row=>row.caption);
 assert(captions.every(row=>!row.text.startsWith('Next ·')&&!row.text.includes('…')),`${label} next-level captions have no prefix or ellipsis: ${JSON.stringify(captions.filter(row=>row.text.startsWith('Next ·')||row.text.includes('…')))}`);
};
const assertAchievementCaptionSlots=async(container,label)=>{
 const metrics=await container.locator('.profile-achievement-next').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);return{text:node.textContent.trim(),height:node.getBoundingClientRect().height,minHeight:parseFloat(style.minHeight),lineHeight:parseFloat(style.lineHeight)};}));
 assert(metrics.length,`${label} includes next-level captions`);
 assert(metrics.every(cell=>cell.minHeight>=cell.lineHeight*2-1&&cell.height>=cell.minHeight-1),`${label} captions reserve two lines: ${JSON.stringify(metrics.filter(cell=>cell.minHeight<cell.lineHeight*2-1||cell.height<cell.minHeight-1))}`);
};
const assertProgressWidths=async(container,label)=>{
 const metrics=await container.locator('[data-achievement-progress]').evaluateAll(nodes=>nodes.map(bar=>{const track=bar.getBoundingClientRect(),fill=bar.querySelector('[data-progress-fill]').getBoundingClientRect(),value=Number(bar.getAttribute('aria-valuenow'));return{value,track:track.width,fill:fill.width,expected:track.width*value/100};}));
 assert(metrics.length,`${label} has progress bars`);
 assert(metrics.every(row=>Math.abs(row.fill-row.expected)<=1.25),`${label} fills match their accessible progress values: ${JSON.stringify(metrics.filter(row=>Math.abs(row.fill-row.expected)>1.25))}`);
};
const assertCompactFallback=async(page,label)=>{
 const result=await page.evaluate(()=>{const value=document.createElement('span');value.className='profile-achievement-value';value.style.width='50px';value.textContent='1,120 workouts';document.body.append(value);const fontSize=window.KinettaTextFit.fitElement(value),result={fontSize,text:value.textContent,source:value.dataset.fitTextSource};value.remove();return result;});
 assert.equal(result.text,'1.1k workouts',`${label} abbreviates when the full value would need text below 10px`);
 assert.equal(result.source,'1,120 workouts',`${label} preserves the complete source value for later resizing`);
 assert(result.fontSize>=10,`${label} never uses text below 10px`);
};
const assert330AchievementViews=async(page,base,setUnits,theme,shots)=>{
 await page.setViewportSize({width:330,height:844});await setUnits('metric');
 await page.goto(base+'/people/fictional_friend');await page.locator('.me-featured-achievements .profile-achievement-list').waitFor();await assertFeaturedHeading(page,page.locator('.me-featured-title'),'330px friend profile');await assertFeaturedRailInset(page,'330px friend profile');if(shots){fs.mkdirSync(shots,{recursive:true});await page.locator('.me-featured-achievements').screenshot({path:path.join(shots,`friend-featured-heading-330-${theme}.png`),animations:'disabled'});}
 await screenshot(page,shots,`friend-profile-featured-330-${theme}`);
 await page.goto(base+'/people/fictional_friend?view=achievements&track=sport%3Aride');await waitForHistoryTrack(page,'sport:ride','330px friend Ride history');
 assert.equal(await page.locator('#profile-achievement-page .profile-achievement-history-head h1').innerText(),'Achievement history','the compact friend track route keeps its page heading');
 assert.match(await page.locator('#profile-achievement-page .profile-achievement-history-head .profile-achievement-current').innerText(),/^Ride · Level \d+/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'330px friend history has no page-level horizontal overflow');await screenshot(page,shots,`achievement-shared-ride-history-330-${theme}`,{fullPage:true});
 futureEvidence=true;await page.evaluate(()=>invalidate('/api/achievements'));
 await page.goto(base+'/people/alex');await page.locator('.me-card-sections[aria-busy="false"]').waitFor();await page.locator('#person-profile [data-me-featured][data-loaded="true"]').waitFor();
 assert.equal(await page.locator('.profile-achievements').count(),0,'the full owner profile has no duplicate achievements grid');
 assert.equal(await page.locator('.me-featured-achievements').count(),1,'the full owner profile has one Featured achievement entry');
 await page.goto(base+'/me');await page.locator('.me-featured-achievements').waitFor();
 assert.equal(await page.locator('.me-featured-achievements').count(),1,'Featured is the only achievement entry point on Me');
 await assertFeaturedHeading(page,page.locator('.me-featured-title'),'330px Me card');
 assert(await page.locator('.me-featured-item').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>node.tagName==='A'&&node.getAttribute('href')===`/me/achievements/${encodeURIComponent(node.dataset.showcaseCode)}`)),'each Me Featured medal opens its own track');
 if(shots)await page.locator('.me-card').screenshot({path:path.join(shots,`achievement-me-card-entry-330-${theme}.png`),animations:'disabled'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'330px Me card has no page-level horizontal overflow');
 await setUnits('imperial');await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
 await assertMedalText(page.locator('#profile-achievement-page'),'330px achievements grid');
 await assertAchievementGridTextFit(page.locator('#profile-achievement-page'),'330px achievements grid');
 await assertAchievementCaptionSlots(page.locator('#profile-achievement-page'),'330px achievements grid');
 const upcoming=page.locator('#profile-achievement-page [data-achievement-code="active_time"]'),future=page.locator('#profile-achievement-page [data-achievement-code="years_active"]');
 assert.equal(await upcoming.locator('[data-achievement-progress]').getAttribute('aria-valuenow'),'5','1,800 active seconds are five percent of the first 10-hour reward');assert.match(await upcoming.getAttribute('aria-description'),/Future reward/,'the next badge is identified accessibly as future');
 assert.equal(await future.locator('[data-achievement-progress]').getAttribute('aria-valuenow'),'0','the later badge shows zero progress');assert.equal(await future.locator('.profile-achievement-next').innerText(),'First orbit · 1 year left');
 await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');await screenshot(page,shots,`achievement-grid-330-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
 await assertLargeTextFit(page.locator('#profile-achievement-page'),'330px large-text achievements grid');
 futureEvidence=false;await page.evaluate(()=>invalidate('/api/achievements'));
 await setUnits('metric');
 await page.goto(base+'/me/achievements/journey');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
 assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current-value').innerText(),'6,099.4 km','the long history value stays in metric units');
 await assertMedalText(page.locator('#profile-achievement-page'),'330px track history');await screenshot(page,shots,`achievement-history-330-${theme}`);
 await assertLargeTextFit(page.locator('#profile-achievement-page'),'330px large-text track history');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'330px track history has no page-level horizontal overflow');
 console.log(`Achievement medallions 330 ${theme}: profile, grid and track history fit normal and large text`);
};

module.exports=async({browser,storageState,base,shots})=>{
 const pendingOnly=process.env.KINETTA_ACHIEVEMENT_PENDING_ONLY==='1';
 const owner330Only=process.env.KINETTA_ACHIEVEMENT_OWNER_330_ONLY==='1';
 const runOnly=process.env.KINETTA_ACHIEVEMENT_RUN_ONLY==='1';
 const indexOnly=process.env.KINETTA_ACHIEVEMENT_INDEX_ONLY==='1';
 for(const theme of pendingOnly?['light']:['light','dark']){
  const context=await browser.newContext({storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:SCREENSHOT_CLOCK.timezone});
  const page=await context.newPage(),errors=[],writes=[],pinRequests=[],ownerAchievementCalls=[],ownerAchievementResponses=[],ownerHistoryCalls=[],sharedAchievementCalls=[],ownerShowcaseCalls=[];let journeyValue=6099414,workoutValue=1120,unitMode='imperial',unitLabelValues=null,legacyRunAward=null,runEvidenceState=null,deepRunFeatured=false,showcasePins=[],sharedShowcasePins=[],sharedShareEnabled=true,emptyOwnerAchievements=false,emptyOwnerShowcase=false,emptyFriendShowcase=false,emptyFriendAchievements=false,pendingAchievementResponses=[],pendingHistoryResponses=[],failOwnerAchievementOnce=false,sharedAchievementPending=false,pinPostGate=null,pinRaceKeepPending=false;
  const ownerShowcaseCodes=['journey','workouts','lifted','sport:run'];
  await page.clock.setFixedTime(SCREENSHOT_NOW);
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.__achievementVibrations=0;const original=navigator.vibrate?.bind(navigator);navigator.vibrate=(...args)=>{window.__achievementVibrations++;return original?original(...args):false;};});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base)return route.abort();
   if(request.method()==='GET'&&url.pathname.endsWith('/profile.css')){const response=await route.fetch();return route.fulfill({response,body:(await response.text())+'\n'+stripCss});}
   if(request.method()==='GET'&&url.pathname==='/api/me'){const response=await route.fetch(),data=await response.json();data.units=unitMode;return route.fulfill({response,json:data});}
   if(request.method()==='GET'&&url.pathname==='/api/people/fictional_friend/profile')return route.fulfill({json:{mine:true,week_streak:99,close_to:'PRIVATE-ONLY fictional friend marker',person:{login:'fictional_friend',name:'Fictional River Friend',photo:'fixture-photo-v1',bio:''},status:'friends',friend_count:4,profile_hidden:false,layout:{sections:['totals'],stats:['activities','distance','time'],sports:[]},overview:{activities:18,distance_m:4828032,time_s:1281600,active_days:32},recent:null,mileage:{weeks:[]},sports:[],items:[],shared_count:18}});
   if(request.method()==='GET'&&url.pathname==='/api/people/fictional_friend/photo')return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4778b8"/><circle cx="32" cy="25" r="12" fill="#f2cfaa"/><path d="M8 64c2-17 11-25 24-25s22 8 24 25" fill="#243d5e"/></svg>'});
   if(request.method()==='GET'&&url.pathname==='/api/achievements'){
    const data=JSON.parse(JSON.stringify(achievementFixture)),journey=data.tracks.find(t=>t.code==='journey'),workouts=data.tracks.find(t=>t.code==='workouts');
    if(url.searchParams.has('login'))sharedAchievementCalls.push(url.href);else ownerAchievementCalls.push(url.href);
    if(!url.searchParams.has('login')&&failOwnerAchievementOnce){failOwnerAchievementOnce=false;if(pendingAchievementResponses.length)pendingAchievementResponses.shift();ownerAchievementResponses.push({pageURL:page.url(),request:url.href,status:503,pending:null});return route.fulfill({status:503,json:{error:'Fictional temporary achievement refresh failure'}});}
    if(emptyOwnerAchievements&&!url.searchParams.has('login'))return route.fulfill({json:{pending:false,tracks:[]}});
    if(deepRunFeatured){const run=data.tracks.find(track=>track.code==='sport:run');if(run){run.value=160934.4;run.display_value=100;run.display_unit='mi';}}
    if(runEvidenceState&&!url.searchParams.has('login')){const run=data.tracks.find(track=>track.code==='sport:run');if(run){run.value=runEvidenceState.value;run.level=0;run.tiers=runEvidenceState.ownerLegacy?[{rank:0,label:'First run',title:'First run',day:'2024-03-05',legacy:true,quiet:true}]:[];run.display_value=unitMode==='metric'?runEvidenceState.value/1000:runEvidenceState.value/1609.344;run.display_unit=unitMode==='metric'?'km':'mi';}}
    if(futureEvidence){const next=data.tracks.find(t=>t.code==='active_time'),future=data.tracks.find(t=>t.code==='years_active');Object.assign(next,{value:1800,display_value:.5,display_unit:'hours',tiers:[]});Object.assign(future,{value:0,display_value:0,display_unit:'years',tiers:[]});}
    if(journey){journey.value=journeyValue;journey.display_value=unitMode==='imperial'?journeyValue/1609.344:journeyValue/1000;journey.display_unit=unitMode==='imperial'?'mi':'km';}
    if(workouts){workouts.value=workoutValue;workouts.display_value=workoutValue;}
    for(const track of data.tracks)if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(track.code)){const value=Number(track.value)||0;track.display_value=unitMode==='imperial'?value/1609.344:value/1000;track.display_unit=unitMode==='imperial'?'mi':'km';}
    for(const item of unitLabelValues||[]){const track=data.tracks.find(row=>row.code===item.code);if(track){track.display_value=item.value;track.display_unit=item.unit;}}
    for(const track of data.tracks)for(const item of track.tiers){const [shown,shownUnit]=displayHistoryTier(track.code,Number(item.threshold)||0,unitMode);item.unit=historyUnits[track.code]||item.unit;item.display_threshold=shown;item.display_unit=shownUnit;}
    if(url.searchParams.has('login')){
     if(!sharedShareEnabled)return route.fulfill({json:{pending:false,tracks:[]}});
     if(emptyFriendAchievements)return route.fulfill({json:{pending:false,tracks:[]}});
     const sharedSportValues={
      'sport:run':{level:11,display_value:11517,display_unit:'mi'},
      'sport:walk-hike':{level:8,display_value:191,display_unit:'mi'},
      'sport:swim':{level:7,display_value:54,display_unit:'mi'}
     };
     let tracks=data.tracks.filter(track=>track.tiers.length).map(track=>{
     const tiers=v2History(track.code,{journey:journeyValue,workouts:workoutValue}).tiers.map(item=>{const [display_threshold,display_unit]=displayHistoryTier(track.code,item.threshold,unitMode);return{rank:item.rank,label:item.name,title:item.name,day:item.day,threshold:item.threshold,unit:historyUnits[track.code]||'count',display_threshold,display_unit};});
     const total=sharedSportValues[track.code],earnedTiers=total?tiers.slice(0,1):tiers;
     return{code:track.code,label:track.label,level:total?.level??(tiers.at(-1)?.rank||0),unit:track.display_unit,...(total?{display_value:total.display_value,display_unit:total.display_unit}:{}),tiers:earnedTiers};
    });
     if(runEvidenceState?.sharedLegacyOnly){tracks=tracks.filter(track=>track.code!=='sport:run');tracks.push({code:'sport:run',label:'Run',level:0,unit:'km',tiers:[{rank:0,label:'First run',title:'First run',day:'2024-03-05',legacy:true}]});}
     return route.fulfill({json:{pending:sharedAchievementPending,tracks}});
    }
    if(!url.searchParams.has('login')&&pinRaceKeepPending)data.pending=true;
    else if(pendingAchievementResponses.length)data.pending=pendingAchievementResponses.shift();
    if(!url.searchParams.has('login'))ownerAchievementResponses.push({pageURL:page.url(),request:url.href,status:200,pending:data.pending});
    return route.fulfill({json:data});
   }
   if(request.method()==='GET'&&url.pathname==='/api/achievements/showcase'){
    if(url.searchParams.has('login')){
     if(!sharedShareEnabled)return route.fulfill({json:{items:[],pinned:[],day_streak:0}});
     if(emptyFriendShowcase)return route.fulfill({json:{items:[],pinned:[],day_streak:0}});
     const codes=sharedShowcasePins.length?sharedShowcasePins:['journey','workouts','lifted','sport:run'];
     return route.fulfill({json:{items:codes.map(code=>{const rank=v2History(code,{journey:journeyValue,workouts:workoutValue}).tiers.at(-1)?.rank||0;return{code,rank,icon:catalog.tracks[code].levels[rank-1]?.icon};}),pinned:sharedShowcasePins,day_streak:0}});
    }
    ownerShowcaseCalls.push(url.href);
    if(emptyOwnerShowcase)return route.fulfill({json:{items:[],pinned:showcasePins,day_streak:0}});
    const items=ownerShowcaseCodes.map(code=>({code,rank:achievementFixture.tracks.find(track=>track.code===code)?.tiers.at(-1)?.rank||1}));
    return route.fulfill({json:{items,pinned:showcasePins,day_streak:0}});
   }
   if(request.method()==='POST'&&url.pathname==='/api/achievements/showcase/pin'){
    const body=request.postDataJSON();pinRequests.push(body);let replaced=false;
    if(pinPostGate){const gate=pinPostGate;pinPostGate=null;gate.enter();await gate.wait;}
    if(body.pinned){if(!showcasePins.includes(body.code)){if(showcasePins.length>=4){showcasePins.shift();replaced=true;}showcasePins.push(body.code);}}
    else showcasePins=showcasePins.filter(code=>code!==body.code);
    return route.fulfill({json:{pinned:showcasePins,replaced}});
   }
   if(request.method()==='GET'&&url.pathname.startsWith('/api/achievement-history/')){
    if(!url.searchParams.has('login'))ownerHistoryCalls.push(url.href);
    const code=decodeURIComponent(url.pathname.slice('/api/achievement-history/'.length));
    const legacyRunHistory={rank:0,name:'First run',threshold:1,day:'2024-03-05',legacy:true};
    const history=code==='sport:run'&&runEvidenceState?{code,pending:false,tiers:(runEvidenceState.history||(runEvidenceState.sharedLegacyOnly?[legacyRunHistory]:[])).map(row=>({...row}))}:v2History(code,{'journey':journeyValue,'workouts':workoutValue});
    if(code==='sport:run'&&legacyRunAward&&!runEvidenceState)history.tiers.push({...legacyRunAward});
    if(!url.searchParams.has('login')&&pendingHistoryResponses.length)history.pending=pendingHistoryResponses.shift();
    if(url.searchParams.has('login'))history.tiers=history.tiers.map(({rank,name,threshold,day})=>({rank,name,threshold,day}));
    return route.fulfill({json:history});
   }
   if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{}});}
   return route.continue();
  });
  const setUnits=async units=>{unitMode=units;await page.evaluate(units=>{App.me.units=units;keep('/api/me',App.me);},units);};
  if(indexOnly){
   futureEvidence=true;
   await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   const index=page.locator('#profile-achievement-page');
   assert.deepEqual(await index.locator('.profile-achievement-group-title').allTextContents(),['Overall','Distance','Strength']);
   assert.deepEqual((await index.locator('.profile-achievement[data-achievement-code]').evaluateAll(nodes=>nodes.map(n=>n.dataset.achievementCode))).sort(),Object.keys(catalog.tracks).sort(),'owner index shows all 13 catalogue tracks');
   for(const [code,progress,caption] of [['active_time','5','First ten hours · 9.5 hours left'],['years_active','0','First orbit · 1 year left']]){
    const badge=index.locator(`[data-achievement-code="${code}"]`);
    assert.equal(await badge.locator('[data-achievement-progress]').getAttribute('aria-valuenow'),progress);
    assert.equal(await badge.locator('.profile-achievement-next').innerText(),caption);
    assert.match(await badge.getAttribute('aria-description'),/Future reward/);
   }
   await assertAchievementGridTextFit(index,'390px owner index with future rewards');await assertMedalText(index,'390px owner index');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'owner index fits the viewport');
   await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');
   await screenshot(page,shots,`achievement-index-390-${theme}`,{fullPage:true});
   assert.deepEqual(errors,[],'owner index has no browser errors');assert.deepEqual(writes.filter(url=>url!=='/api/challenges/signup/continue'),[],'owner index requests no writes beyond the intercepted startup continuation');
   console.log(`Achievement owner index 390 ${theme}: 13 tracks, 3 groups, future rewards and text fit PASS`);
   futureEvidence=false;await context.close();continue;
  }
  await page.goto(base+'/me');await until(page,()=>App.pageReady,'fixture login');await setUnits('imperial');await page.locator('[data-me-featured][data-loaded="true"]').waitFor();
  if(owner330Only){await page.setViewportSize({width:330,height:844});await page.goto(base+'/people/alex');await page.locator('.me-card-sections[aria-busy="false"]').waitFor();await page.locator('#person-profile [data-me-featured][data-loaded="true"]').waitFor();assert.equal(await page.locator('.profile-achievements').count(),0,'330px full owner profile has no duplicate catalog');assert.equal(await page.locator('.me-featured-achievements').count(),1,'330px full owner profile has one settled Featured entry');assert.equal(await page.locator('#person-profile .profile-achievement[data-achievement-code]').count(),4,'330px owner profile retains four featured badges');assert.deepEqual(errors,[],'330px owner featured path has no browser errors');assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[],'330px owner featured path makes no writes');console.log('Achievement owner profile 330px: settled Featured block, four badges, no writes PASS');await context.close();continue;}
  const waitForCallCount=async(calls,count,label)=>{for(let i=0;i<160;i++){if(calls.length>=count)return;await page.waitForTimeout(50);}throw Error('Timed out waiting for '+label);};
  const holdToPin=async code=>{
   const medal=page.locator('#profile-achievement-page .profile-achievement[data-achievement-code="'+code+'"]');await medal.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rect=await medal.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.waitForTimeout(570);await page.mouse.up();
   const action=page.locator('[data-showcase-pin-action]');await action.waitFor();return action;
  };
  const waitForPin=async(code,pinned)=>{const selector='#profile-achievement-page .profile-achievement[data-achievement-code="'+code+'"]';await until(page,state=>document.querySelector(state.selector)?.dataset.showcasePinned===state.pinned,'Showcase pin update',{selector,pinned:String(pinned)});};
  const pinSaveRaceCheck=async()=>{
   if(theme!=='light')return;
   // A dismissed pin sheet does not release the refresh fence while its save is in flight.
   showcasePins=['workouts'];pendingAchievementResponses=[true];pinRaceKeepPending=true;
   await page.goto(base+'/me/achievements?pin-save-race=1');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   let enterSave,releaseSave;const saveEntered=new Promise(resolve=>{enterSave=resolve;}),saveWait=new Promise(resolve=>{releaseSave=resolve;});pinPostGate={enter:enterSave,wait:saveWait};
   const beforeJourney=await page.locator('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value').innerText();
   const heldAction=await holdToPin('journey');assert.equal(await heldAction.innerText(),'Pin to profile','the held-save fixture starts from an unpinned medal');
   const clickSave=heldAction.click();await saveEntered;await page.keyboard.press('Escape');await page.locator('.sheet').waitFor({state:'detached'});
   const beforeRefreshCalls=ownerAchievementCalls.length,beforeRefreshShowcases=ownerShowcaseCalls.length;pinRaceKeepPending=false;pendingAchievementResponses=[false];journeyValue=8000000;
   await waitForCallCount(ownerAchievementCalls,beforeRefreshCalls+1,'settled poll while the dismissed pin save remains pending');await waitForCallCount(ownerShowcaseCalls,beforeRefreshShowcases+1,'stale showcase snapshot while the pin save remains pending');
   await page.waitForTimeout(100);
   assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value').innerText(),beforeJourney,'a settled poll cannot repaint the catalogue while the dismissed save is pending');
   releaseSave();await clickSave;await waitForPin('journey',true);await waitForPin('workouts',true);
   pendingAchievementResponses=[false];await waitForCallCount(ownerAchievementCalls,beforeRefreshCalls+2,'post-save settled catalogue refresh');await waitForCallCount(ownerShowcaseCalls,beforeRefreshShowcases+2,'post-save showcase refresh');
   await until(page,expected=>document.querySelector('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value')?.textContent.trim()!==expected,'post-save refreshed Journey value',beforeJourney);
   await waitForPin('journey',true);await waitForPin('workouts',true);
   assert.deepEqual(showcasePins,['workouts','journey'],'the next poll keeps both pins after applying fresh achievement values');
   assert.equal(pinRequests.length,1,'the held-save fixture sends exactly one intentional pin request');assert.deepEqual(pinRequests[0],{code:'journey',pinned:true},'the owner pin request carries only the selected fictional track and pin state');
   pinRequests.length=0;showcasePins=[];journeyValue=6099414;pendingAchievementResponses=[];
   await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  };
  const pendingLifecycleChecks=async()=>{
   if(theme!=='light')return;
   // A transient failed refresh leaves the visible catalogue in place; the next backoff settles it.
   pendingAchievementResponses=[true];const beforeInitialCatalogue=ownerAchievementResponses.length;await page.goto(base+'/me/achievements?pending=catalogue');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   const initialCatalogue=ownerAchievementResponses.slice(beforeInitialCatalogue).find(row=>row.pageURL.includes('/me/achievements?pending=catalogue')&&row.request.includes('/api/achievements'));
   assert.deepEqual(initialCatalogue&&{status:initialCatalogue.status,pending:initialCatalogue.pending},{status:200,pending:true},`the fixture arms pending on the catalogue request, not the preceding Me request: ${JSON.stringify(ownerAchievementResponses.slice(beforeInitialCatalogue))}`);
   const beforeErrorCalls=ownerAchievementCalls.length,beforeErrorValue=await page.locator('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value').innerText();
   pendingAchievementResponses=[true,false];failOwnerAchievementOnce=true;journeyValue=7000000;
   await waitForCallCount(ownerAchievementCalls,beforeErrorCalls+1,'catalogue refresh after temporary error');
   await page.waitForTimeout(100);assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value').innerText(),beforeErrorValue,'a failed pending refresh keeps the rendered catalogue unchanged');
   await waitForCallCount(ownerAchievementCalls,beforeErrorCalls+2,`settled catalogue refresh after retry: ${JSON.stringify(ownerAchievementResponses.slice(beforeInitialCatalogue))}`);
   await until(page,expected=>document.querySelector('#profile-achievement-page [data-achievement-code="journey"] .profile-achievement-value')?.textContent.trim()!==expected,'settled catalogue value',beforeErrorValue);
   const settledCatalogueCalls=ownerAchievementCalls.length;await page.waitForTimeout(8200);
   assert.equal(ownerAchievementCalls.length,settledCatalogueCalls,'the settled catalogue stops before the next scheduled poll');

   // Track history stays unchanged while only its history endpoint is pending, then settles both reads.
   pendingAchievementResponses=[true];pendingHistoryResponses=[true];const beforeHistoryCalls=ownerAchievementCalls.length;
   await page.goto(base+'/me/achievements/journey?pending=history');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   const beforeHistoryValue=await page.locator('.profile-achievement-current-value').innerText(),beforeHistoryRequests=ownerHistoryCalls.length;
   pendingAchievementResponses=[false,false];pendingHistoryResponses=[true];journeyValue=8000000;
   await waitForCallCount(ownerAchievementCalls,beforeHistoryCalls+1,'pending track history achievement refresh');await waitForCallCount(ownerHistoryCalls,beforeHistoryRequests+1,'pending track history refresh');
   await page.waitForTimeout(100);assert.equal(await page.locator('.profile-achievement-current-value').innerText(),beforeHistoryValue,'a history-only pending response keeps the old history content');
   pendingHistoryResponses=[false];
   await waitForCallCount(ownerAchievementCalls,beforeHistoryCalls+2,'settled track history achievement refresh');await waitForCallCount(ownerHistoryCalls,beforeHistoryRequests+2,'settled track history refresh');
   await until(page,expected=>document.querySelector('.profile-achievement-current-value')?.textContent.trim()!==expected,'settled track history value',beforeHistoryValue);

   // The Me Featured slot uses the same owner lifecycle and settles without a full profile reload.
   pendingAchievementResponses=[true];const beforeMeCalls=ownerAchievementCalls.length,beforeMeShowcaseCalls=ownerShowcaseCalls.length;
   await page.goto(base+'/me?pending=featured');await page.locator('[data-me-featured][data-loaded="true"]').waitFor();
   const beforeMeValue=await page.locator('[data-me-featured] [data-achievement-code="journey"] .profile-achievement-value').innerText();
   pendingAchievementResponses=[false];journeyValue=9000000;
   await waitForCallCount(ownerAchievementCalls,beforeMeCalls+1,'pending Me Featured refresh');await waitForCallCount(ownerShowcaseCalls,beforeMeShowcaseCalls+1,'Me Featured showcase refresh');
   await until(page,expected=>document.querySelector('[data-me-featured] [data-achievement-code="journey"] .profile-achievement-value')?.textContent.trim()!==expected,'settled Me Featured value',beforeMeValue);

   // Hidden and offline pages do not poll on their timer; returning to an available state resumes once.
   pendingAchievementResponses=[true];const beforeHiddenCalls=ownerAchievementCalls.length;
   await page.goto(base+'/me/achievements?pending=hidden');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   await page.evaluate(()=>{window.__fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__fixtureHidden});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForTimeout(2200);assert.equal(ownerAchievementCalls.length,beforeHiddenCalls+1,'a hidden pending page pauses its poll timer');
   await page.evaluate(()=>{window.__fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});pendingAchievementResponses=[false];
   await waitForCallCount(ownerAchievementCalls,beforeHiddenCalls+2,'visible pending page resume');
   pendingAchievementResponses=[true];const beforeOfflineCalls=ownerAchievementCalls.length;
   await page.goto(base+'/me/achievements?pending=offline');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
   await page.waitForTimeout(2200);assert.equal(ownerAchievementCalls.length,beforeOfflineCalls+1,'an offline pending page pauses its poll timer');
   await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});pendingAchievementResponses=[false];
   await waitForCallCount(ownerAchievementCalls,beforeOfflineCalls+2,'online pending page resume');

   // A shared pending response remains read-only and never starts owner polling.
   sharedAchievementPending=true;const beforeSharedCalls=sharedAchievementCalls.length,beforeSharedOwner=ownerAchievementCalls.length;
   await page.goto(base+'/people/fictional_friend?view=achievements&pending=shared');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   assert(sharedAchievementCalls.length>beforeSharedCalls,'the friend view loads its filtered achievement response');const sharedCallsAfterLoad=sharedAchievementCalls.length;await page.waitForTimeout(2200);
   assert.equal(sharedAchievementCalls.length,sharedCallsAfterLoad,'a shared pending response does not start a background refresh');assert.equal(ownerAchievementCalls.length,beforeSharedOwner,'a shared pending response never calls owner achievements');sharedAchievementPending=false;

   pendingAchievementResponses=[true];const beforeOwnerSwapCalls=ownerAchievementCalls.length;
   await page.goto(base+'/me/achievements?pending=owner-change');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   await page.evaluate(()=>{window.__pendingFixtureOwner=App.me;App.me={...App.me,id:'fictional-owner-swapped'};});await page.waitForTimeout(2200);
   assert.equal(ownerAchievementCalls.length,beforeOwnerSwapCalls+1,'a pending owner watcher stops when its captured owner changes');
   await page.evaluate(()=>{App.me=window.__pendingFixtureOwner;delete window.__pendingFixtureOwner;});

   // Navigating away stops the old page watcher; same-root reentry gets exactly one fresh watcher.
   pendingAchievementResponses=[true];const beforeReentryCalls=ownerAchievementCalls.length;
   await page.goto(base+'/me/achievements?pending=old-path');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   await page.evaluate(()=>go('/people/fictional_friend?pending=away'));await page.locator('#person-profile .me-card-sections[aria-busy="false"]').waitFor();await page.waitForTimeout(2200);
   assert.equal(ownerAchievementCalls.length,beforeReentryCalls+1,'the detached catalogue watcher does not poll after navigation');
   pendingAchievementResponses=[true,true];await page.evaluate(()=>go('/me/achievements?pending=reentry'));await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   await waitForCallCount(ownerAchievementCalls,beforeReentryCalls+3,'the reentered catalogue watcher');

   // Restore the ordinary fixture before the existing design and pin checks continue.
   pendingAchievementResponses=[];pendingHistoryResponses=[];failOwnerAchievementOnce=false;sharedAchievementPending=false;journeyValue=6099414;workoutValue=1120;
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});invalidate('/api/');go('/me/achievements');});
   await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  };
  if(runOnly){
   await setUnits('metric');
   runEvidenceState={value:0,history:[]};
   await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   const futureRun=page.locator('#profile-achievement-page [data-achievement-code="sport:run"]');
   assert.equal(await futureRun.getAttribute('data-showcase-eligible'),'false','an unearned canonical Run level cannot be pinned');
   await page.goto(base+'/me/achievements/sport%3Arun');await waitForHistoryTrack(page,'sport:run','zero-progress Run detail');await expandAchievementLevels(page);
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Not started','zero-distance Run opens as a future track');
   const runNamedCount=catalog.tracks['sport:run'].levels.length;
   assert.equal(await page.locator('.profile-achievement-named-levels li').count(),runNamedCount,'all canonical Run badges are discoverable before earning one');
   assert.equal(await page.locator('.profile-achievement-named-levels li.is-next .profile-achievement-level-copy>small').innerText(),'5K','the first future Run badge uses the canonical name');
   if(shots){await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-zero-future-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);}

   runEvidenceState={value:4000,history:[]};await page.goto(base+'/me/achievements/sport%3Arun');await waitForHistoryTrack(page,'sport:run','partial Run detail');await expandAchievementLevels(page);
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'In progress','sub-threshold Run remains in progress');
   assert.equal(await page.locator('.profile-achievement-current-value-context').innerText(),'Total distance run','the Running metric has its clear detail label');
   assert.equal(await page.locator('.profile-achievement-current-value').innerText(),'Total distance run\n4 km','the Run detail shows cumulative distance');
   assert.equal(await page.locator('.profile-achievement-named-levels li.is-next .profile-achievement-level-progressbar').count(),1,'partial Run progress points to the first future badge');
   if(shots){await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-partial-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);}

   const earnedRunValue=60000;runEvidenceState={value:earnedRunValue,history:v2History('sport:run',{'sport:run':earnedRunValue}).tiers};
   await page.goto(base+'/me/achievements/sport%3Arun');await waitForHistoryTrack(page,'sport:run','earned Run detail');await expandAchievementLevels(page);
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Level 4 · Marathon','earned Run detail shows the canonical fourth level');
   assert.equal(await page.locator('.profile-achievement-named-levels li.is-earned').count(),3,'the first three Run levels remain visible as earned history');
   assert.equal(await page.locator('.profile-achievement-named-levels li.is-current[data-level="4"]').count(),1,'the Marathon row is the current canonical Run level');
   if(shots){await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-earned-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);}

   const runRepeatMultiple=4,runRepeatValue=catalogValue(catalog.tracks['sport:run'].levels.at(-1))*runRepeatMultiple,runRepeatLevel=runNamedCount+runRepeatMultiple-1;
   runEvidenceState={value:runRepeatValue,history:v2History('sport:run',{'sport:run':runRepeatValue}).tiers};
   await page.goto(base+'/me/achievements/sport%3Arun');await waitForHistoryTrack(page,'sport:run','repeating Run detail');await expandAchievementLevels(page);
   const repeatList=page.locator('.profile-achievement-tail-levels'),repeatRows=repeatList.locator('li');
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'),String(runRepeatLevel),'Run reaches the selected repeat level after all named levels');
   assert.equal(await repeatRows.count(),Math.max(4,runRepeatLevel-runNamedCount+3),'the repeat list shows all earned repeats before three future rows');
   for(const rank of [runNamedCount+1,runNamedCount+2])assert.equal(await repeatList.locator(`li[data-level="${rank}"].is-earned`).count(),1,`earned repeat level ${rank} remains visible below the current level`);
   assert.equal(await repeatList.locator(`li.is-current[data-level="${runRepeatLevel}"]`).count(),1,'the current repeat is visible in the continuous history');
   assert.equal(await repeatList.locator(`li.is-next[data-level="${runRepeatLevel+1}"]`).count(),1,'the next repeat follows earned repeats');
   if(shots){await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-repeats-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);}
   const beforeMore=await repeatRows.count();await page.locator('[data-achievement-show-more]').click();assert.equal(await repeatRows.count(),beforeMore+4,'Show more appends future repeats after the full earned history');

   runEvidenceState={value:0,ownerLegacy:true,history:[{rank:0,name:'First run',threshold:1,day:'2024-03-05',legacy:true}]};
   await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   const legacyOwnerRun=page.locator('#profile-achievement-page [data-achievement-code="sport:run"]');
   assert.equal(await legacyOwnerRun.getAttribute('data-showcase-eligible'),'false','a saved rank-zero Run starter cannot be pinned');
   const legacyRect=await legacyOwnerRun.boundingBox();await page.mouse.move(legacyRect.x+legacyRect.width/2,legacyRect.y+legacyRect.height/2);await page.mouse.down();await page.waitForTimeout(570);await page.mouse.up();
   assert.equal(await page.locator('[data-showcase-pin-action]').count(),0,'long-pressing a legacy-only Run row opens no pin action');assert.equal(pinRequests.length,0,'legacy-only Run never submits a showcase pin request');

   runEvidenceState={value:0,sharedLegacyOnly:true,history:[{rank:0,name:'First run',threshold:1,day:'2024-03-05',legacy:true}]};
   await page.goto(base+'/people/fictional_friend?view=achievements');await page.locator('#profile-achievement-page [data-legacy-only="true"][data-achievement-code="sport:run"]').waitFor();
   const sharedLegacyRun=page.locator('#profile-achievement-page [data-legacy-only="true"][data-achievement-code="sport:run"]');
   assert.equal(await sharedLegacyRun.innerText(),'Run\nEarlier awards','the legacy-only Run track is discoverable in shared Achievements');
   assert.equal(await sharedLegacyRun.locator('.profile-achievement-medallion').count(),0,'the shared legacy-only row invents no canonical medal');
   await sharedLegacyRun.click();await waitForHistoryTrack(page,'sport:run','shared legacy-only Run detail');
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Run · Earlier awards','shared legacy-only detail is identified as earlier awards');
   assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').count(),0,'shared legacy-only detail has no canonical medal');
   assert.equal(await page.locator('.profile-achievement-current-value').count(),0,'shared legacy-only detail exposes no current or private value');
   assert.equal(await page.locator('.profile-achievement-history-section li').innerText(),'First run\nMar 5, 2024','shared legacy history keeps its saved label and date');
   assert.equal(await page.locator('#profile-achievement-page a[href^="/activity/"]').count(),0,'shared legacy history exposes no activity identifiers');
   assert.equal(await page.locator('.profile-achievement-levels,.profile-achievement-tail-note').count(),0,'shared legacy history exposes no future or repeat levels');
   assert.deepEqual(errors,[],'focused Run fixture has no browser errors');assert.deepEqual(writes.filter(write=>write!=='/api/challenges/signup/continue'),[],'focused Run fixture has no unexpected writes');
   await context.close();continue;
  }
  await pendingLifecycleChecks();
  await pinSaveRaceCheck();
  if(pendingOnly){assert.deepEqual(errors,[],'pending refresh fixture has no browser errors');assert.deepEqual(writes.filter(write=>write!=='/api/challenges/signup/continue'),[],'pending refresh fixture has no unexpected writes');await context.close();return;}
  const checkEmptyOwnerFriendEntry=async({capture=false}={})=>{
   const prior={showcasePins:[...showcasePins],sharedShowcasePins:[...sharedShowcasePins],sharedShareEnabled,emptyOwnerAchievements,emptyOwnerShowcase,emptyFriendShowcase,emptyFriendAchievements};
   try{
   emptyOwnerAchievements=true;emptyOwnerShowcase=true;showcasePins=['sport:run'];sharedShareEnabled=false;
   await page.goto(base+'/me');await page.locator('.me-featured-empty-entry').waitFor();
   const emptyLink=page.locator('.me-featured-empty-entry');
   assert.equal(await emptyLink.count(),1,'the empty owner slot has a single catalogue entry');
   assert.equal(await emptyLink.innerText(),'Achievements ›','an empty owner Featured slot has one plain catalogue link');
   assert.equal(await emptyLink.getAttribute('href'),'/me/achievements','the empty owner link opens the full catalogue');
   assert.equal(await page.locator('.me-featured-achievements,.me-featured-title').count(),0,'the empty owner slot has no Featured wrapper or heading');
   const ownerBounds=await emptyLink.evaluate(node=>{const rect=node.getBoundingClientRect(),slot=node.parentElement.getBoundingClientRect();return{width:rect.width,height:rect.height,left:rect.left,slotLeft:slot.left};});
   assert(ownerBounds.width>=44&&ownerBounds.height>=44&&Math.abs(ownerBounds.left-ownerBounds.slotLeft)<2,`the owner link is left aligned with a 44px target: ${JSON.stringify(ownerBounds)}`);
   if(capture&&shots)await screenshot(page,shots,`achievement-empty-owner-390-${theme}`,{fullPage:true});
   await emptyLink.click();await page.waitForURL('**/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
   assert.deepEqual(await page.locator('#profile-achievement-page .profile-achievement-group-title').allTextContents(),['Overall','Distance','Strength'],'the empty-state link opens the full grouped catalogue');
   assert.equal(await page.locator('#profile-achievement-page .profile-achievement').count(),Object.keys(catalog.tracks).length,'the empty-state link opens every catalog track');
   emptyFriendShowcase=true;emptyFriendAchievements=true;sharedShareEnabled=true;
   await page.goto(base+'/people/fictional_friend');await page.locator('.me-card-sections[aria-busy="false"]').waitFor();await until(page,()=>document.querySelector('[data-me-featured]')?.dataset.loaded==='true','empty friend showcase settles');
   assert.equal(await page.locator('.me-featured-empty-entry,.me-featured-achievements,.me-featured-title').count(),0,'an empty friend showcase exposes no owner catalogue entry or empty Featured heading');
   assert.doesNotMatch(await page.locator('#person-profile').innerText(),/Only you|PRIVATE-ONLY/,'friend view strips owner-only fields even when its fixture says mine=true');
   assert.deepEqual(errors,[],`no browser errors in empty ${theme} owner/friend regression`);
   assert.deepEqual(writes.filter(write=>write!=='/api/challenges/signup/continue'),[],'the empty owner/friend entry check performs no unmocked writes');
   console.log(`Achievement empty owner/friend 390 ${theme}: 44px owner link, full catalogue route, shared empty omitted PASS`);
   }finally{
    showcasePins=prior.showcasePins;sharedShowcasePins=prior.sharedShowcasePins;sharedShareEnabled=prior.sharedShareEnabled;
    emptyOwnerAchievements=prior.emptyOwnerAchievements;emptyOwnerShowcase=prior.emptyOwnerShowcase;emptyFriendShowcase=prior.emptyFriendShowcase;emptyFriendAchievements=prior.emptyFriendAchievements;
    await page.goto(base+'/me');await page.locator('.me-featured-achievements').waitFor();
   }
  };
  if(process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY==='1'){
   await checkEmptyOwnerFriendEntry({capture:true});
   await context.close();continue;
  }
  await checkEmptyOwnerFriendEntry();
  const keys=await page.evaluate(()=>{const scope=`${Native.base||location.origin}:${App.me.id}`;return{key:`kinetta.achievement-levels.v4:${scope}`,legacyKey:`kinetta.achievement-levels.v3:${scope}`};});
  const {key,legacyKey}=keys;
  await page.evaluate(({key,legacyKey})=>{localStorage.removeItem(key);localStorage.setItem(legacyKey,JSON.stringify({journey:3,workouts:5}));},{key,legacyKey});
  const webHaptic=await page.evaluate(()=>Native.achievementLevelUp());
  assert.equal(webHaptic,false,'the achievement success feedback is disabled on web');

  await page.goto(base+'/people/alex');await page.locator('.me-card-sections[aria-busy="false"]').waitFor();
  await page.locator('#person-profile [data-me-featured][data-loaded="true"]').waitFor();
  assert.equal(await page.locator('.profile-achievements').count(),0,'the full owner profile has no duplicate achievements grid');
  assert.equal(await page.locator('.me-featured-achievements').count(),1,'the full owner profile has one Featured achievement entry');
  await page.goto(base+'/me');await page.locator('.me-featured-achievements').waitFor();
  assert.equal(await page.locator('.me-featured-achievements').count(),1,'Featured is the only achievement entry point on Me');
  assert.equal(await page.getByRole('link',{name:'See all',exact:true}).count(),1,'Me has one link to the full achievement catalog');
  assert.equal(await page.locator('.me-featured-title a').getAttribute('href'),'/me/achievements','the Featured heading opens the full catalog');
  assert(await page.locator('.me-featured-item').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>node.tagName==='A'&&node.getAttribute('href')===`/me/achievements/${encodeURIComponent(node.dataset.showcaseCode)}`)),'every Featured medal opens its own track history');
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(saved.workouts,6,'catalogue v4 migrates the earned Workouts level without replaying haptics');
  assert.equal(await page.evaluate(()=>window.__achievementVibrations),0,'a web level up does not vibrate');
  if(shots)await page.locator('.me-card').screenshot({path:path.join(shots,`achievement-me-card-entry-390-${theme}.png`),animations:'disabled'});
  const featuredMedal=page.locator('.me-featured-item').first(),featuredTrack=await featuredMedal.getAttribute('data-showcase-code');
  await featuredMedal.click();await page.waitForURL(`**/me/achievements/${encodeURIComponent(featuredTrack)}`);await page.locator(`#profile-achievement-page .profile-achievement-history-head[data-achievement-code="${featuredTrack}"]`).waitFor();
  await page.goto(base+'/people/alex?view=achievements');await page.waitForURL('**/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-group').count(),3,'the old owner profile URL still opens the grouped catalog');
  await page.goto(base+'/me');await page.locator('.me-featured-achievements').waitFor();await page.locator('.me-featured-title a').click();await page.waitForURL('**/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  await page.goto(base+'/people/fictional_friend');await page.locator('.me-featured-achievements').waitFor();
  const featured=page.locator('.me-featured-achievements'),featuredTitle=featured.locator('h3.me-featured-title'),featuredLink=featured.locator('h3.me-featured-title a'),featuredRows=featured.locator('.profile-achievement-list:not(.is-grid) .profile-achievement');
  await assertFeaturedRailInset(page,'390px friend profile');
  await assertFeaturedHeading(page,featuredTitle,'390px friend profile');
  if(shots)await featured.screenshot({path:path.join(shots,`friend-featured-heading-390-${theme}.png`),animations:'disabled'});
  assert.equal(await featuredLink.getAttribute('href'),'/people/fictional_friend?view=achievements','a friend’s card opens their read-only achievement page');
  const linkColors=await featuredLink.evaluate(node=>{const probe=document.createElement('i');probe.style.color='var(--accent)';node.parentElement.append(probe);const expected=getComputedStyle(probe).color,actual=getComputedStyle(node).color;probe.remove();return{actual,expected};});assert.equal(linkColors.actual,linkColors.expected,'Achievements uses the same accent-blue link style as other section links');
  assert.deepEqual(await featuredRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.achievementCode)),['journey','workouts','lifted','sport:run'],'the public profile uses the automatic top four when no pins exist');
  const thirdMedalClearance=await featuredRows.nth(2).evaluate(node=>{const medal=node.querySelector('.profile-achievement-medallion'),badge=medal.querySelector('.profile-achievement-level'),card=node.closest('.me-card').getBoundingClientRect(),medalBox=medal.getBoundingClientRect(),badgeBox=badge.getBoundingClientRect();return{badge:card.right-badgeBox.right,glow:card.right-(medalBox.right+20)};});assert(thirdMedalClearance.badge>=0&&thirdMedalClearance.glow>=0,`the third medal's level badge and glow fit inside the 390px card: ${JSON.stringify(thirdMedalClearance)}`);
  const featuredVisual=await featuredRows.first().evaluate(node=>{const medal=node.querySelector('.profile-achievement-medallion'),rect=medal.getBoundingClientRect(),list=node.parentElement,style=getComputedStyle(list);return{width:rect.width,height:rect.height,level:medal.querySelector('.profile-achievement-level')?.textContent.trim(),value:medal.querySelector('.profile-achievement-value')?.textContent.trim(),name:node.querySelector('.profile-achievement-name')?.textContent.trim(),caption:node.querySelector('.profile-achievement-next')?.textContent.trim(),overflowX:style.overflowX,scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};});
  assert(featuredVisual.width>=68&&featuredVisual.width<=72&&featuredVisual.height===featuredVisual.width,`friend medals match the responsive Me-card size: ${JSON.stringify(featuredVisual)}`);assert.match(featuredVisual.level,/^Lv \d+$/);assert(featuredVisual.value&&featuredVisual.name,'friend medals show their earned value and track name');assert.match(featuredVisual.caption,/^Level \d+ · /,'the caption names only the earned level');assert.doesNotMatch(featuredVisual.caption,/Next|Coming up/,'the shared card does not reveal future progress');assert.equal(featuredVisual.overflowX,'visible');assert(featuredVisual.scrollWidth<=featuredVisual.clientWidth+1,'all four medals fit without a horizontal rail');assert(featuredVisual.pageWidth<=featuredVisual.viewport+1,'the grid does not widen the page');
  assert(await page.locator('.me-card-avatar .av img').evaluate(node=>node.complete&&node.naturalWidth>0),'the friend profile displays its fictional author photo');
  if(shots)await page.screenshot({path:path.join(shots,`friend-profile-featured-390-${theme}.png`),fullPage:true,animations:'disabled'});
  await featuredLink.click();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const sharedRowsAll=page.locator('#profile-achievement-page .profile-achievement-list.is-grid .profile-achievement');
  assert.equal(await sharedRowsAll.count(),13,'the shared read-only page lists every earned track');
  assert.deepEqual((await sharedRowsAll.evaluateAll(nodes=>nodes.map(node=>node.dataset.achievementCode))).sort(),Object.keys(catalog.tracks).sort(),'every catalog track with an earned level appears in the shared view');
  for(const [code,level,value] of [['sport:run','11','11,517 mi'],['sport:walk-hike','8','191 mi'],['sport:swim','7','54 mi']]){
   const row=page.locator(`#profile-achievement-page [data-achievement-code="${code}"]`);
   assert.equal(await row.locator('.profile-achievement-medallion').getAttribute('data-level'),level,`${code} trusts the server level when its shared tier history is incomplete`);
   assert.equal(await row.locator('.profile-achievement-value').innerText(),value,`${code} shows the current shared total instead of the last tier threshold`);
  }
  await screenshot(page,shots,`achievement-shared-catalog-390-${theme}`,{fullPage:true});
  assert.equal(await page.locator('#profile-achievement-page [data-showcase-pin-action],#profile-achievement-page [data-showcase-eligible],#profile-achievement-page [data-achievement-progress]').count(),0,'the shared page exposes no pin controls or future progress');
  await page.locator('#profile-achievement-page [data-achievement-code="sport:ride"]').click();await waitForHistoryTrack(page,'sport:ride','friend Ride history');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-history-head h1').innerText(),'Achievement history','friend track details keep the shared history heading');
  assert.match(await page.locator('#profile-achievement-page .profile-achievement-history-head .profile-achievement-current').innerText(),/^Ride · Level \d+/,'the track name remains visible below the shared history heading');
  await page.goto(base+'/people/fictional_friend?view=achievements&track=sport%3Aride');await waitForHistoryTrack(page,'sport:ride','direct friend Ride history');
  await screenshot(page,shots,`achievement-shared-ride-history-390-${theme}`,{fullPage:true});
  await page.goto(base+'/people/fictional_friend?view=achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  await page.locator('#profile-achievement-page [data-achievement-code="journey"]').click();await page.locator('#profile-achievement-page .profile-achievement-history-head[data-achievement-code="journey"]').waitFor();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const sharedRows=page.locator('#profile-achievement-page .profile-achievement-level-row'),sharedRowCount=await sharedRows.count();
  const expectedSharedJourneyLevels=v2History('journey',{journey:journeyValue,workouts:workoutValue}).tiers.length;
  assert.equal(sharedRowCount,expectedSharedJourneyLevels,`a shared track shows only its earned levels: ${JSON.stringify({url:page.url(),expectedSharedJourneyLevels,content:(await page.locator('#profile-achievement-page').innerText()).slice(0,300)})}`);
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-level-row.is-upcoming,#profile-achievement-page .profile-achievement-level-row.is-next').count(),0,'future levels stay private');
  assert.equal(await page.locator('#profile-achievement-page a[href^="/activity/"]').count(),0,'shared earned levels never link to an activity');
  sharedShowcasePins=['workouts','journey'];await page.goto(base+'/people/fictional_friend');await page.locator('.me-featured-achievements').waitFor();
  assert.deepEqual(await page.locator('.me-featured-achievements .profile-achievement-list:not(.is-grid) .profile-achievement').evaluateAll(nodes=>nodes.map(node=>node.dataset.achievementCode)),['workouts','journey'],'the friend’s pins override automatic medals');
  sharedShareEnabled=false;await page.reload();await page.locator('.me-card-sections[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.me-featured-achievements').count(),0,'turning achievement sharing off removes the featured section');
  sharedShareEnabled=true;sharedShowcasePins=[];
  await page.goto(base+'/me');await page.locator('.me-featured-achievements').waitFor();
  if(theme==='light'){
   deepRunFeatured=true;await page.evaluate(()=>invalidate('/api/achievements'));await page.goto(base+'/me');await page.locator('[data-me-featured][data-loaded="true"] .profile-achievement[data-achievement-code="sport:run"]').waitFor();
   const contrast=await page.locator('[data-me-featured][data-loaded="true"] .profile-achievement[data-achievement-code="sport:run"] .profile-achievement-value').evaluate(node=>{const channels=value=>{const normalized=value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);if(normalized)return normalized.slice(1,4).map(Number);const bytes=value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);if(bytes)return bytes.slice(1,4).map(channel=>Number(channel)/255);throw new Error(`Unsupported computed color format: ${value}`);},linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4,lum=value=>{const [r,g,b]=channels(value);return .2126*linear(r)+.7152*linear(g)+.0722*linear(b)},fg=getComputedStyle(node).color,bg=getComputedStyle(node.closest('.profile-achievement-medallion')).backgroundColor,a=lum(fg),b=lum(bg);return{fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
   assert(contrast.ratio>=4.5,`the deep green Run medal value meets 4.5:1 contrast: ${JSON.stringify(contrast)}`);
   deepRunFeatured=false;await page.evaluate(()=>invalidate('/api/achievements'));await page.goto(base+'/me');await page.locator('[data-me-featured][data-loaded="true"]').waitFor();
  }
  if(process.env.KINETTA_ACHIEVEMENT_FIT_ONLY==='1'){await assert330AchievementViews(page,base,setUnits,theme,shots);await context.close();continue;}
  unitLabelValues=[['consistency',1,'weeks'],['active_time',1,'h'],['workouts',1,'workouts'],['sport:lift',1,'sessions'],['years_active',1,'years']].map(([code,value,unit])=>({code,value,unit}));
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  for(const [code,label] of [['consistency','1 week'],['active_time','1 hour'],['workouts','1 workout'],['sport:lift','1 session'],['years_active','1 year']]){
   assert.equal(await page.locator(`#profile-achievement-page .profile-achievement[data-achievement-code="${code}"] .profile-achievement-value`).innerText(),label,`${code} uses its singular unit`);
  }
  unitLabelValues=[['consistency',2,'weeks'],['active_time',2,'h'],['workouts',2,'workouts'],['sport:lift',2,'sessions'],['years_active',2,'years']].map(([code,value,unit])=>({code,value,unit}));
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  for(const [code,medal,accessible] of [['consistency','2 weeks','2 weeks'],['active_time','2 hours','2 hours'],['workouts','2 wkt','2 workouts'],['sport:lift','2 sess','2 sessions'],['years_active','2 years','2 years']]){
   const row=page.locator(`#profile-achievement-page .profile-achievement[data-achievement-code="${code}"]`);assert.equal(await row.locator('.profile-achievement-value').innerText(),medal,`${code} keeps its medal label compact`);assert.match(await row.getAttribute('aria-label'),new RegExp(accessible.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`${code} retains its full spoken unit`);
  }
  unitLabelValues=null;

  await page.goto(base+'/me');await page.locator('.me-featured-title a').waitFor();
  assert.equal(await page.locator('.profile-achievements').count(),0,'the Me card does not duplicate the full catalog');
  await page.locator('.me-featured-title a').click();await page.waitForURL('**/me/achievements');
  await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const groups=page.locator('#profile-achievement-page .profile-achievement-group');
  assert.equal(await groups.count(),3,'started tracks are grouped into Overall, Distance and Strength');
  assert.deepEqual(await groups.locator('.profile-achievement-group-title').allTextContents(),['Overall','Distance','Strength'],'group headings use the requested order');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement').count(),13,'See all opens every started track');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-progress-count').count(),0,'the overview avoids repeating the medal level badge');
  assert.doesNotMatch(await page.locator('#profile-achievement-page [data-achievement-code="workouts"]').getAttribute('aria-label'),/Level \d+ of \d+/,'open-ended tracks do not claim a false maximum');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-overview-progress[role="progressbar"]').count(),13,'every track shows progress to its next level');
  await assertProgressWidths(page.locator('#profile-achievement-page'),'390px achievements overview');
  const workoutsProgress=await page.locator('#profile-achievement-page [data-achievement-code="workouts"] .profile-achievement-overview-progress').evaluate(bar=>({track:bar.getBoundingClientRect().width,fill:bar.querySelector('[data-progress-fill]').getBoundingClientRect().width,value:Number(bar.getAttribute('aria-valuenow'))}));
  assert(workoutsProgress.value>0&&workoutsProgress.value<100&&workoutsProgress.fill<workoutsProgress.track-1,'the Workouts progress bar is visibly partial');
  workoutValue=1001;await page.reload();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const zeroWorkoutsProgress=await page.locator('#profile-achievement-page [data-achievement-code="workouts"] .profile-achievement-overview-progress').evaluate(bar=>({track:bar.getBoundingClientRect().width,fill:bar.querySelector('[data-progress-fill]').getBoundingClientRect().width,value:Number(bar.getAttribute('aria-valuenow'))}));
  assert.equal(zeroWorkoutsProgress.value,0,'a nearly empty level can report zero rounded progress');assert(zeroWorkoutsProgress.track>0&&zeroWorkoutsProgress.fill<=1,'a zero progress bar stays visually empty');
  assert.equal(await page.locator('#profile-achievement-page .profile-achievement-ring').count(),0,'all achievement medallions omit progress rings');
  workoutValue=1120;await page.reload();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="active_time"] .profile-achievement-value').innerText(),'1.1k h','long time values use a compact medal label');
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="lifted"] .profile-achievement-value').innerText(),'661k lb','long strength values use a compact medal label');
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="workouts"] .profile-achievement-value').innerText(),'1.1k wkt','workout medals keep a compact unit');
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="sport:lift"] .profile-achievement-value').innerText(),'22 sess','session medals keep a compact unit');
  const groupCodes=[];
  for(let i=0;i<await groups.count();i++){
   const group=groups.nth(i),list=group.locator('.profile-achievement-list');
   assert.equal(await list.getAttribute('role'),'list');
   const grid=await list.evaluate(n=>{const cards=[...n.querySelectorAll('.profile-achievement')],tops=cards.map(c=>c.getBoundingClientRect().top);return{display:getComputedStyle(n).display,overflowX:getComputedStyle(n).overflowX,columns:getComputedStyle(n).gridTemplateColumns.split(/\s+/).length,firstRowSame:tops.length<3||Math.max(...tops.slice(0,3))-Math.min(...tops.slice(0,3))<1};});
   assert.equal(grid.display,'grid','each group keeps a vertical grid');assert.equal(grid.columns,4,'each group uses four columns at 390px');assert.equal(grid.firstRowSame,true,'each group begins with a four-column row');assert.equal(grid.overflowX,'visible','group grids do not scroll sideways');
   groupCodes.push(await list.locator('.profile-achievement').evaluateAll(nodes=>nodes.map(n=>n.dataset.achievementCode)));
  }
  assert.deepEqual(groupCodes,[
   ['workouts','active_time','consistency','years_active','personal_bests'],
   ['sport:run','climbing','journey','sport:walk-hike','sport:swim','sport:ride'],
   ['sport:lift','lifted']
  ],'each section sorts tracks by most progress first, without changing the profile rail');
  await assertAchievementGridTextFit(page.locator('#profile-achievement-page'),'390px achievements grid');
  const gridCells=await page.locator('#profile-achievement-page .profile-achievement-list.is-grid .profile-achievement').evaluateAll(nodes=>nodes.map(node=>{const caption=node.querySelector('.profile-achievement-next'),style=getComputedStyle(caption),range=document.createRange();range.selectNodeContents(caption);return{caption:caption.textContent.trim(),lines:new Set([...range.getClientRects()].map(rect=>Math.round(rect.top*2)/2)).size,whiteSpace:style.whiteSpace,overflow:style.overflow,textOverflow:style.textOverflow,minHeight:parseFloat(style.minHeight),lineHeight:parseFloat(style.lineHeight),height:caption.getBoundingClientRect().height,progressSlot:node.querySelector('.profile-achievement-overview-progress,.profile-achievement-overview-progress-placeholder')?.getBoundingClientRect().height||0};}));
  assert(gridCells.every(cell=>cell.whiteSpace==='normal'&&cell.overflow==='visible'&&cell.textOverflow==='clip'&&!cell.caption.startsWith('Next ·')&&!cell.caption.includes('…')&&cell.lines>=1),'grid captions wrap without clipping the reward name or criterion');assert(gridCells.every(cell=>cell.minHeight>=cell.lineHeight*2-1&&cell.height>=cell.minHeight-1),`every grid caption reserves two lines: ${JSON.stringify(gridCells.filter(cell=>cell.minHeight<cell.lineHeight*2-1||cell.height<cell.minHeight-1))}`);assert(gridCells.every(cell=>cell.progressSlot===3),'started and unstarted grid cells reserve the same progress row');
  const progressTrack=await page.locator('#profile-achievement-page .profile-achievement-overview-progress').first().evaluate(bar=>{const probe=document.createElement('i');probe.style.background='var(--line)';document.body.append(probe);const line=getComputedStyle(probe).backgroundColor;probe.remove();return{color:getComputedStyle(bar).backgroundColor,line};});
  assert.notEqual(progressTrack.color,progressTrack.line,'the empty progress track stays more visible than the divider in both themes');
  assert.equal(await page.locator('#profile-achievement-page [data-achievement-code="sport:lift"] .profile-achievement-name').innerText(),'Lift sessions','the grouped grid uses the requested Lift sessions track name');
  const gridFitsPage=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  assert(gridFitsPage,'the grouped grid does not widen the page');
  await assertMedalText(page.locator('#profile-achievement-page'),'grouped achievements grid');
  futureEvidence=true;await page.evaluate(()=>invalidate('/api/achievements'));await page.reload();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const nextBadge=page.locator('#profile-achievement-page [data-achievement-code="active_time"]'),futureBadge=page.locator('#profile-achievement-page [data-achievement-code="years_active"]');
  assert.deepEqual(await page.locator('.profile-achievement-group[aria-labelledby="profile-achievement-group-overall"] .profile-achievement').evaluateAll(nodes=>nodes.map(node=>node.dataset.achievementCode)),['workouts','consistency','personal_bests','active_time','years_active'],'earned badges come first, then the closest next goal, then future rewards');
  assert.equal(await nextBadge.locator('[data-achievement-progress]').getAttribute('aria-valuenow'),'5','1,800 active seconds are five percent of the first 10-hour reward');assert.match(await nextBadge.getAttribute('aria-description'),/Future reward/,'the next reward is identified accessibly as future');
  assert.equal(await nextBadge.locator('.profile-achievement-next').innerText(),'First ten hours · 9.5 hours left','the next reward shows its name and the correct remaining time');
  assert.equal(await futureBadge.locator('[data-achievement-progress]').getAttribute('aria-valuenow'),'0','the later reward has a zero progress bar');assert.equal(await futureBadge.locator('.profile-achievement-next').innerText(),'First orbit · 1 year left','the later reward shows its name and criterion');
  assert(Number(await futureBadge.locator('.profile-achievement-medallion').evaluate(node=>getComputedStyle(node).opacity))<1,'future medals use reduced opacity');
  await nextBadge.click();await waitForHistoryTrack(page,'active_time','in-progress future achievement detail');
  assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current-value').innerText(),'0.5 hours','an in-progress owner track keeps its API value on the detail route');
  assert.equal(await page.locator('.profile-achievement-named-levels li.is-next [role="progressbar"]').getAttribute('aria-valuenow'),'5','an in-progress owner detail keeps progress toward its first level');
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  await assertAchievementGridTextFit(page.locator('#profile-achievement-page'),'390px achievement list with future rewards');
  await assertMedalText(page.locator('#profile-achievement-page'),'390px achievement list with future rewards');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');
  await screenshot(page,shots,`achievement-grid-390-${theme}`,{fullPage:true});
  futureEvidence=false;await page.evaluate(()=>{delete document.documentElement.dataset.achievementEvidence;invalidate('/api/achievements');});await page.reload();await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  let pinAction=await holdToPin('workouts');assert.equal(await pinAction.innerText(),'Pin to profile','a long press opens the pin action');
  await screenshot(page,shots,'achievement-pin-action-390-'+theme);await pinAction.click();await page.locator('.sheet').waitFor({state:'detached'});
  await waitForPin('workouts',true);
  assert.deepEqual(showcasePins,['workouts'],'pinning stores the selected track');assert.match(await page.locator('#profile-achievement-page [data-achievement-code="workouts"]').getAttribute('aria-label'),/Pinned to profile/);
  assert.equal(new URL(page.url()).pathname,'/me/achievements','holding to pin does not open medal history');
  for(const code of ['journey','lifted','sport:run']){pinAction=await holdToPin(code);if(code==='sport:run')assert.equal(await pinAction.innerText(),'Pin to profile');await pinAction.click();await page.locator('.sheet').waitFor({state:'detached'});await waitForPin(code,true);}
  assert.deepEqual(showcasePins,['workouts','journey','lifted','sport:run'],'four featured pins fit the limit');
  pinAction=await holdToPin('consistency');assert.equal(await pinAction.innerText(),'Pin to profile');await pinAction.click();await page.locator('.sheet').waitFor({state:'detached'});
  await waitForPin('consistency',true);await waitForPin('workouts',false);
  assert.deepEqual(showcasePins,['journey','lifted','sport:run','consistency'],'a fifth pin replaces the oldest pin');
  assert.equal(pinRequests.length,5,'each pin action sends one owner-scoped update');
  const journey=page.locator('#profile-achievement-page [data-achievement-code="journey"]');assert.match(await journey.getAttribute('href'),/\/me\/achievements\/journey$/,'each medallion links to its history');
  await setUnits('metric');
  await journey.click();await waitForHistoryTrack(page,'journey','Journey history');
  assert.equal(await page.locator('[data-back]:visible').last().innerText(),'Achievements','the track ladder back button names the overview');
  const history=page.locator('.profile-achievement-history-head');await history.waitFor();assert.equal(await history.locator('h1').innerText(),'Journey');assert.equal(await page.locator('.profile-achievement-current').innerText(),'Level 5 · Across the US');assert.equal(await page.locator('.profile-achievement-current-value').innerText(),'6,099.4 km','the amount appears on its own header line');
  const journeyLevels=page.locator('.profile-achievement-levels');assert.equal(await journeyLevels.locator('h2').innerText(),'Levels');
  const namedJourneyLevels=journeyLevels.locator('.profile-achievement-named-levels');
  assert.deepEqual(await namedJourneyLevels.locator('li').evaluateAll(nodes=>nodes.map(n=>n.dataset.level)),Array.from({length:catalog.tracks.journey.levels.length},(_,i)=>String(i+1)),'the full named ladder is visible in level order');
  assert.equal(await journeyLevels.locator('[data-achievement-show-all]').count(),0,'the ladder has no hidden-level toggle');
  assert(await namedJourneyLevels.locator('li.is-next [role="progressbar"]').count(),'the next level is highlighted with progress');
  assert.match(await namedJourneyLevels.locator('li.is-next [role="progressbar"]+small').innerText(),/left$/,'the next level says how much remains without a dangling word');
  await assertProgressWidths(journeyLevels,'Journey next-level progress');
  const progressSpacing=await namedJourneyLevels.locator('li.is-next [role="progressbar"]').evaluate(bar=>parseFloat(getComputedStyle(bar.parentElement).marginTop));
  assert(progressSpacing>=3,'the next-level progress bar has room above it');
  assert(await namedJourneyLevels.locator('li.is-current time').count(),'an earned row shows its date');
  assert.equal(await namedJourneyLevels.locator('li.is-earned a[href="/activity/3000"]').count(),1,'earned levels link to their activity');
  const linkedEarned=namedJourneyLevels.locator('li[data-level="1"] a');
  assert.equal(await linkedEarned.getAttribute('aria-label'),`Level 1, Marathon, earned Oct 1, ${SCREENSHOT_YEAR-1}`,'activity links announce the earned level and its prior-year date');
  assert.equal(await namedJourneyLevels.locator('li[data-level="1"]').getAttribute('aria-label'),null,'the row does not override its link name');
  const noActivity=namedJourneyLevels.locator('li[data-level="2"]');
  assert.equal(await noActivity.locator('a').count(),0,'an earned level without activity_id stays noninteractive');
  assert.equal(await noActivity.locator('.profile-achievement-history-chevron').count(),0,'a non-link earned row has no chevron');
  assert.match(await noActivity.locator('time').innerText(),/Oct 2/,'a non-link earned row still shows its date');
  assert.match(await namedJourneyLevels.locator('li[data-level="3"] a').getAttribute('aria-label'),/, earned$/,'an earned level without a date is announced as earned');assert.doesNotMatch(await namedJourneyLevels.locator('li[data-level="3"] a').getAttribute('aria-label'),/earned level$/,'the accessible name does not append the word level');
  assert.equal(await namedJourneyLevels.locator('li.is-current').count(),1,'the reached level has a subtle current marker');
  const levelTone=await journeyLevels.evaluate(list=>({earned:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-earned')).opacity,current:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-current')).opacity,locked:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-upcoming')).opacity,earnedColor:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-current .profile-achievement-level-copy b')).color,lockedColor:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-upcoming .profile-achievement-level-copy b')).color,nextColor:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-next b')).color,bodyColor:getComputedStyle(document.querySelector('#profile-achievement-page')).color,currentBackground:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-current')).backgroundColor,currentShadow:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-current')).boxShadow,currentPad:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-current .profile-achievement-level-link,.profile-achievement-named-levels li.is-current .profile-achievement-level-content')).paddingLeft,earnedPad:getComputedStyle(list.querySelector('.profile-achievement-named-levels li.is-earned .profile-achievement-level-link,.profile-achievement-named-levels li.is-earned .profile-achievement-level-content')).paddingLeft}));
  assert.equal(levelTone.earned,'1','earned levels stay in full colour');assert.equal(levelTone.current,'1','the current level stays in full colour');assert.equal(levelTone.locked,'1','locked rows keep their full layout and icons');assert.notEqual(levelTone.lockedColor,levelTone.earnedColor,'only the text colour dims for later levels');assert.equal(levelTone.nextColor,levelTone.bodyColor,'the next level does not use link-blue text');assert.notEqual(levelTone.currentBackground,'rgba(0, 0, 0, 0)','the current level has a subtle tinted row');assert(levelTone.currentShadow.includes('inset'),'the current marker uses an inset shadow');assert.equal(levelTone.currentPad,levelTone.earnedPad,'the current marker does not shift the icon');
  const currentIconX=await namedJourneyLevels.locator('li.is-current .profile-achievement-level-icon').boundingBox(),earnedIconX=await namedJourneyLevels.locator('li.is-earned .profile-achievement-level-icon').first().boundingBox();assert(Math.abs(currentIconX.x-earnedIconX.x)<1,'the current-row icon aligns with earned-row icons');
  assert.equal(await journeyLevels.locator('.profile-achievement-tail-levels li').count(),0,'repeating levels wait until all named levels are earned');
  await assertMedalText(page.locator('#profile-achievement-page'),'Journey history');
  assert.equal(await namedJourneyLevels.locator('li.is-earned a').count(),3,'earned levels without activity IDs stay out of the link count');
  assert.equal(await journeyLevels.locator('.profile-achievement-history-section').count(),0,'earned levels appear once in the complete ladder');
  assert.doesNotMatch(await namedJourneyLevels.innerText(),/\d[\d,]*\.\d{2,}/,'level amounts never show more than one decimal place');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');
  await screenshot(page,shots,`achievement-history-390-${theme}`,{fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  const fixedMarathon=page.locator('.profile-achievement-named-levels li[data-level="1"]');
  assert.equal(await fixedMarathon.locator('b').innerText(),'Level 1 · 42.2 km','the race threshold uses at most one decimal in metric mode');
  assert.equal(await fixedMarathon.locator('small').innerText(),'Marathon','the fixed race name stays clear');
  assert.equal(await namedJourneyLevels.locator('li[data-level="2"] b').innerText(),'Level 2 · 70.3 mi','a mile-based milestone stays in miles in metric mode');
  await page.goto(base+'/me/achievements/sport%3Arun');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();await expandAchievementLevels(page);
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="2"] .profile-achievement-level-title b').innerText(),'Level 2 · 10 km','the canonical Run ladder uses its 10K second level');
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="2"] .profile-achievement-level-copy>small').innerText(),'10K','the canonical Run level keeps its requested name');
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="5"] b').innerText(),'Level 5 · 50 mi','the 50-mile milestone has no converted kilometre label');
  await setUnits('imperial');
  await page.goto(base+'/me');await until(page,()=>App.pageReady&&App.me?.units==='imperial','imperial profile before checking the canonical Run level name');
  legacyRunAward={rank:0,name:'First run',threshold:1,day:'2024-03-05',activity_id:90210,date_source:'legacy',legacy:true};
  await page.evaluate(()=>go('/me/achievements/sport%3Arun'));await waitForHistoryTrack(page,'sport:run','imperial Run history');await expandAchievementLevels(page);
  const legacyRunRows=page.locator('.profile-achievement-history-section .profile-achievement-history li');
  assert.equal(await legacyRunRows.count(),1,'a saved starter award remains visible apart from canonical levels');
  assert.equal(await legacyRunRows.first().locator('span').first().innerText(),'First run');
  assert.equal(await legacyRunRows.first().locator('time').getAttribute('datetime'),'2024-03-05','the saved legacy award date is preserved');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Level 4 · Marathon','a legacy rank-zero award does not change the canonical Run level');
  const runningLevels=page.locator('.profile-achievement-named-levels');
  for(const [level,name,distance] of [[1,'5K','5 km'],[2,'10K','10 km'],[3,'Half marathon','21.1 km'],[4,'Marathon','42.2 km']]){
   assert.equal(await runningLevels.locator(`li[data-level="${level}"] .profile-achievement-level-copy>small`).innerText(),name+(level===4?' · Current':''),`${name} keeps its race name in miles mode`);
   assert.equal(await runningLevels.locator(`li[data-level="${level}"] .profile-achievement-level-title b`).innerText(),`Level ${level} · ${distance}`,`${name} keeps its kilometre-based milestone distance`);
  }
  assert.equal(await page.locator('.profile-achievement-current').innerText(),'Level 4 · Marathon');assert.equal(await page.locator('.profile-achievement-current-value').innerText(),'Total distance run\n49.7 mi');assert.equal(await page.locator('.profile-achievement-current-value-context').innerText(),'Total distance run');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-run-levels-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  await page.goto(base+'/people/fictional_friend?view=achievements&track=sport%3Arun');await waitForHistoryTrack(page,'sport:run','shared Run history with legacy award');
  assert.equal(await page.locator('.profile-achievement-history-section .profile-achievement-history li').count(),1,'shared history retains the saved starter name and date');
  assert.equal(await page.locator('#profile-achievement-page a[href^="/activity/"]').count(),0,'shared legacy history contains no activity link or identifier');
  assert.equal(await page.locator('.profile-achievement-tail-note').count(),0,'shared history does not disclose future repeat levels');
  assert.equal(await page.locator('.profile-achievement-level-row.is-next,.profile-achievement-level-row.is-upcoming').count(),0,'shared history contains no future canonical levels');
  legacyRunAward=null;
  await page.goto(base+'/me/achievements/sport%3Aride');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();await expandAchievementLevels(page);
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="3"] .profile-achievement-level-copy>small').innerText(),'Metric century · Current');
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="3"] .profile-achievement-level-title b').innerText(),'Level 3 · 100 km','the Metric century keeps its kilometre-based milestone distance');

  await page.goto(base+'/me/achievements/sport%3Aswim');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();await expandAchievementLevels(page);
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="2"] .profile-achievement-level-copy>small').innerText(),'Ironman swim · Current');
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="2"] .profile-achievement-level-title b').innerText(),'Level 2 · 2.4 mi','the Ironman swim distance follows miles');


  journeyValue=113137;await setUnits('imperial');await page.goto(base+'/me/achievements/journey');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'),'2','Journey switches to the reached catalog level');
  assert.equal(await page.locator('.profile-achievement-history-head [data-achievement-icon]').getAttribute('data-achievement-icon'),'Person swimming','the current Journey level supplies its own icon');
  workoutValue=4500;await page.goto(base+'/me/achievements/workouts');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-tail-levels').evaluate(node=>getComputedStyle(node).marginTop),'0px','the repeating ladder continues without a gap');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'),'9','the canonical repeat ladder starts after its eight named levels');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Level 9 · Old-growth forest ×2');assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current-value').innerText(),'4,500 workouts');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-multiple').innerText(),'×2','the medal shows the tail multiplier badge');
  assert.equal(await page.locator('.profile-achievement-tail-levels li[data-level="9"] .profile-achievement-level-copy>small').innerText(),'Old-growth forest ×2 · Current');
  assert.equal(await page.locator('.profile-achievement-tail-levels li[data-level="10"] .profile-achievement-level-copy>small').innerText(),'Old-growth forest ×3');
  await expandAchievementLevels(page);
  const initialTailRows=await page.locator('.profile-achievement-tail-levels li').count();assert.equal(initialTailRows,4,'the open tail starts at its first level and shows earned rows before future rows');
  assert.equal(await page.locator('[data-achievement-show-more]').innerText(),'Show more');
  await page.locator('[data-achievement-show-more]').click();assert.equal(await page.locator('.profile-achievement-tail-levels li').count(),initialTailRows+4,'Show more appends four levels');

  workoutValue=1120;journeyValue=6099414;await setUnits('imperial');await page.goto(base+'/me/achievements/lifted');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current').innerText(),'Level 6 · Statue of Liberty');assert.equal(await page.locator('.profile-achievement-history-copy .profile-achievement-current-value').innerText(),'661,387 lb');
  await expandAchievementLevels(page);
  const liftedLevels=page.locator('.profile-achievement-named-levels');assert.equal(await liftedLevels.locator('li').count(),catalog.tracks.lifted.levels.length,'the named ladder includes every level without rendering an endless tail');
  assert.equal(await liftedLevels.locator('li[data-level="7"] .profile-achievement-level-title b').innerText(),'Level 7 · 875,000 lb','Lifted uses pounds in the existing miles preference');
  assert.equal(await liftedLevels.locator('li.is-earned a').count(),5,'earned Lifted levels link to their activities from the ladder');
  assert.doesNotMatch(await liftedLevels.innerText(),/NaN|undefined/,'the ladder does not render malformed targets');
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-lifted-levels-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);

  const allFixtureTracks=achievementFixture.tracks;
  achievementFixture.tracks=[
   makeTrack('workouts','Workouts',0,2,2,'workouts',[{...tier(0,'First workout',1,'2026-11-07',2301),legacy:true,quiet:true}],null),
   makeTrack('consistency','Consistency',0,1,1,'weeks',[{...tier(0,'First week',1,'2026-11-07',2301),legacy:true,quiet:true}],null),
   makeTrack('active_time','Active time',0,7200,2,'h',[{...tier(0,'First hour',3600,'2026-11-07',2301),legacy:true,quiet:true}],null),
   makeTrack('sport:run','Run',0,1609.344,1,'mi',[{...tier(0,'First run',1,'2026-11-07',2300),legacy:true,quiet:true}],null),
   makeTrack('sport:lift','Lift sessions',1,1,1,'sessions',[tier(1,'First set',1,'2026-11-07',2301)],null)
  ];
  // One run plus one lifting session gives the new account two total workouts.
  workoutValue=2;await setUnits('metric');await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('kinetta.achievement-levels.v'))localStorage.removeItem(key);});
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  const earlyShowcase=page.locator('#profile-achievement-page');
  assert.match(await earlyShowcase.innerText(),/5K/,'the new Run track points toward its first canonical level');
  assert.match(await earlyShowcase.innerText(),/Seed/,'the new-workout Showcase shows its first canonical level');
  assert.match(await earlyShowcase.locator('[data-achievement-code="sport:run"]').getAttribute('aria-label'),/5K/,'the Run row announces its next canonical badge');
  assert.equal(await earlyShowcase.locator('[data-achievement-code="sport:run"] .profile-achievement-value').innerText(),'1.6 km','the run medal value follows the metric preference');
  assert.equal(await earlyShowcase.locator('[data-achievement-code="sport:run"]').getAttribute('data-showcase-eligible'),'false','a saved rank-zero starter cannot be pinned as a canonical achievement');
  assert.match(await earlyShowcase.locator('[data-achievement-code="workouts"]').getAttribute('aria-label'),/Seed/,'the first future Workouts badge is announced by its canonical name');
  assert.equal(await earlyShowcase.locator('[data-achievement-code="workouts"] [data-achievement-icon]').getAttribute('data-achievement-icon'),'Chestnut','the first Workouts medal uses the canonical Seed art');
  assert.equal(catalog.tracks.workouts.levels[0].asset_name,'Chestnut','the Seed icon follows the canonical catalog');
  assert.equal(catalog.tracks.workouts.levels[1].asset_name,'Seedling','Sprout retains its canonical art');
  if(shots){fs.mkdirSync(shots,{recursive:true});await earlyShowcase.screenshot({path:`${shots}/achievement-early-showcase-390-${theme}.png`,animations:'disabled'});}
  await page.goto(base+'/me/achievements/years_active');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current').innerText(),'Not started','a new track clearly says it has not started');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-current-value').count(),0,'a new track does not show a zero value');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-level').count(),0,'a new track does not show a level badge');
  assert.equal(await page.locator('.profile-achievement-history-head [data-achievement-icon]').getAttribute('data-achievement-icon'),catalog.tracks.years_active.levels[0].asset_name,'a new track uses the first catalog medal');
  assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').evaluate(node=>getComputedStyle(node).filter),'grayscale(1)','the new-track page greys its medal');
  assert.equal(await page.locator('.profile-achievement-named-levels li').count(),catalog.tracks.years_active.levels.length,'an unstarted deep link opens with its full catalog ladder visible');
  assert.equal(await page.locator('.profile-achievement-named-levels li.is-next').getAttribute('data-level'),'1','the first level is highlighted as the next goal');
  assert.equal(await page.locator('.profile-achievement-named-levels li[data-level="1"] .profile-achievement-level-meta').innerText(),'Start here','an unstarted ladder points to its first level');
  assert.match(await page.locator('.profile-achievement-tail-note').innerText(),/After all named levels.*whole-number multiple/,'an unstarted owner can discover the repeating tail');
  achievementFixture.tracks=allFixtureTracks;
  const allFixtureTracksForFilter=achievementFixture.tracks;achievementFixture.tracks=allFixtureTracksForFilter.filter(track=>['lifted','sport:lift'].includes(track.code));
  await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  assert.deepEqual(await page.locator('.profile-achievement-group-title').allTextContents(),['Overall','Distance','Strength'],'every catalog group stays discoverable when some tracks are new');
  assert.equal(await page.locator('.profile-achievement-group .profile-achievement').count(),13,'the overview includes started and new tracks');
  const unstarted=page.locator('#profile-achievement-page [data-achievement-code="workouts"]');
  assert(await unstarted.evaluate(node=>node.classList.contains('is-unstarted')),'catalog-only tracks are shown quietly');
  assert.equal(await unstarted.locator('.profile-achievement-next').innerText(),'Seed · 10 workouts left','a future badge shows its canonical name and first criterion');
  assert.equal(await unstarted.locator('.profile-achievement-overview-progress').count(),1,'a future badge shows a visible progress track');
  assert.equal(await unstarted.locator('.profile-achievement-overview-progress').getAttribute('aria-valuenow'),'0','an unstarted badge has zero progress');
  assert.equal(await unstarted.locator('.profile-achievement-overview-progress-placeholder').count(),0,'the visible progress track replaces the blank placeholder');
  assert.equal(await unstarted.locator('.profile-achievement-progress-count').count(),0,'an unstarted track has no duplicate level text');
  assert.equal(await unstarted.locator('.profile-achievement-level').count(),0,'an unstarted track has no level badge');
  assert.equal(await unstarted.locator('.profile-achievement-value').count(),0,'an unstarted track has no medal value');
  assert.equal(await unstarted.locator('.profile-achievement-ring').count(),0,'an unstarted medal has no progress ring');
  assert.match(await unstarted.getAttribute('aria-description'),/First reward: Seed; requires 10 workouts/,'the goal and criterion are announced to assistive technology');
  assert.equal(await unstarted.locator('.profile-achievement-medallion').evaluate(node=>getComputedStyle(node).filter),'grayscale(1)','an unstarted medal is greyed quietly');
  assert(Number(await unstarted.locator('.profile-achievement-medallion').evaluate(node=>getComputedStyle(node).opacity))<1,'an unstarted medal has reduced opacity');
  const unstartedGrey=await page.locator('#profile-achievement-page .profile-achievement.is-unstarted').evaluateAll(nodes=>Object.fromEntries(nodes.filter(node=>['journey','workouts','years_active'].includes(node.dataset.achievementCode)).map(node=>[node.dataset.achievementCode,getComputedStyle(node.querySelector('.profile-achievement-medallion')).backgroundColor])));
  assert.equal(Object.keys(unstartedGrey).length,3,'the grey comparison includes Journey and two other unstarted medals');assert.equal(new Set(Object.values(unstartedGrey)).size,1,'every unstarted track uses the same quiet grey medal in light and dark themes');
  await assertAchievementGridTextFit(page.locator('#profile-achievement-page'),'390px catalog with unstarted tracks');
  await setUnits('imperial');await page.goto(base+'/me');await until(page,()=>App.pageReady&&App.me?.units==='imperial','imperial units before the unstarted overview capture');
  await page.evaluate(()=>go('/me/achievements'));await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='all-tracks');
  await screenshot(page,shots,`achievement-grid-unstarted-390-${theme}`,{fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
  assert.equal(await page.locator('.profile-achievement[data-achievement-code="workouts"]').getAttribute('data-showcase-eligible'),'false','an unearned track cannot be pinned');
  achievementFixture.tracks=allFixtureTracks;

  const captureCases=[
   {name:'few-level',code:'personal_bests',value:10},
   {name:'many-level',code:'climbing',value:17000},
   {name:'near-top',code:'sport:lift',nearTop:true},
   {name:'open-ended',code:'workouts',value:4500,workouts:4500},
   {name:'new-track',code:'years_active',empty:true},
   {name:'prior-year-no-link',code:'journey',value:6099414}
  ];
  for(const width of [390,330]){
   await page.setViewportSize({width,height:844});await setUnits('imperial');
   await page.goto(base+'/me');await until(page,()=>App.pageReady&&App.me?.units==='imperial','imperial profile before achievement ladder captures');
   for(const state of captureCases){
    achievementFixture.tracks=JSON.parse(JSON.stringify(allFixtureTracks));workoutValue=1120;journeyValue=6099414;unitLabelValues=null;
    if(state.empty)achievementFixture.tracks=achievementFixture.tracks.filter(track=>track.code!==state.code);
    else{
     const row=achievementFixture.tracks.find(track=>track.code===state.code);assert(row,`${state.name} fixture exists`);
     const value=state.nearTop?catalogValue(catalog.tracks[state.code].levels.at(-1))-1:state.value;
     row.value=value;row.display_value=state.code==='climbing'?(unitMode==='imperial'?value*3.28084:value):value;
     row.display_unit=state.code==='climbing'?(unitMode==='imperial'?'ft':'m'):row.display_unit;
     if(state.workouts)workoutValue=state.workouts;
    }
    await page.evaluate(()=>{invalidate('/api/');go('/me/achievements');});await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
    await page.locator('#profile-achievement-page [data-achievement-code="'+state.code+'"]').click();await waitForHistoryTrack(page,state.code,state.name+' achievement history');
    assert.equal(await page.locator('[data-back]:visible').last().innerText(),'Achievements',`${state.name} opens from the catalog and returns to Achievements`);
    const level=Number(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').getAttribute('data-level'));
    if(state.empty)assert.equal(level,0,'the new-track capture has no earned levels');
    if(state.nearTop)assert.equal(level,catalog.tracks[state.code].levels.length-1,'the near-top capture is one level below the named maximum');
    if(state.name==='many-level')assert.equal(await page.locator('.profile-achievement-tail-levels li').count(),0,'the open tail stays hidden before all named levels are earned');
    const ladder=page.locator('.profile-achievement-named-levels li');assert.equal(await ladder.count(),catalog.tracks[state.code].levels.length,`${state.name} shows every named level immediately`);
    if(state.empty){assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-value').count(),0,'the new-track medal has no value');assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-level').count(),0,'the new-track medal has no level badge');assert.equal(await page.locator('.profile-achievement-history-head .profile-achievement-medallion').evaluate(node=>getComputedStyle(node).filter),'grayscale(1)','an unstarted track page greys the medal');assert.equal(await page.locator('.profile-achievement-named-levels li.is-next [role="progressbar"]').count(),0,'an unstarted track has no progress bar');}
    else await assertMedalText(page.locator('#profile-achievement-page'),String(width)+'px '+state.name+' track');
    if(state.name==='prior-year-no-link'){
     const ladder=page.locator('.profile-achievement-named-levels');assert((await ladder.locator('li[data-level="1"] time').innerText()).includes(String(SCREENSHOT_YEAR-1)),'the screenshot includes an earlier-year earned date');assert.equal(await ladder.locator('li[data-level="2"] a').count(),0,'the screenshot includes an earned row without a link');assert.equal(await ladder.locator('li[data-level="2"] .profile-achievement-history-chevron').count(),0,'the non-link earned row has no chevron');
     assert.match(await ladder.locator('li[data-level="3"] a').getAttribute('aria-label'),/, earned$/,'the no-date earned row stays accessible');
    }
    assert.equal(await ladder.first().evaluate(row=>getComputedStyle(row).minHeight),'44px','achievement rows keep a 44px minimum');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px ${state.name} has no horizontal overflow`);
    await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');
    if(state.name==='prior-year-no-link'&&width===390){await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');await screenshot(page,shots,`achievement-prior-year-no-link-390-${theme}`,{fullPage:true});await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);}
    await screenshot(page,shots,`achievement-ladder-${width}-${state.name}-${theme}`,{fullPage:true});
    await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
    if(width===390&&['many-level','open-ended','new-track'].includes(state.name)){
     await expandAchievementLevels(page);
     assert.equal(await page.locator('.profile-achievement-named-levels li').count(),catalog.tracks[state.code].levels.length,`${state.name} expands every named level`);
     await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');
     await screenshot(page,shots,`achievement-ladder-expanded-${state.name}-390-${theme}`,{fullPage:true});
     await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
     if(state.name==='open-ended'){
      const tail=page.locator('.profile-achievement-tail-levels li'),initial=await tail.count();assert.equal(initial,4,'open-ended ladders show the current tail level and next three');
      await page.locator('[data-achievement-show-more]').click();assert.equal(await tail.count(),initial+4,'the tail control appends exactly four levels');
      await page.evaluate(()=>document.documentElement.dataset.achievementEvidence='track');
      await screenshot(page,shots,`achievement-ladder-tail-more-390-${theme}`,{fullPage:true});
      await page.evaluate(()=>delete document.documentElement.dataset.achievementEvidence);
     }
    }
   }
  }
  achievementFixture.tracks=allFixtureTracks;workoutValue=1120;journeyValue=6099414;unitLabelValues=null;await page.setViewportSize({width:390,height:844});await setUnits('imperial');

  workoutValue=1120;journeyValue=6099414;await page.goto(base+'/me/achievements');await page.locator('#profile-achievement-page[aria-busy="false"]').waitFor();
  await page.evaluate(()=>{
   const runner='<circle cx="15.5" cy="4.5" r="2.5"/><path d="m12 8 4 1 2.2 3.2 3.2 1.1-.7 2-4-1.4-2-2.4-2 2.2 3.6 2.4 2.1 5.2h-2.3l-1.7-4-4.4-2.4-2.9 3.8H4.5l3.8-5.7 3.1-3.1-1.1-.6-2.4 2.5-3.3-.5.3-2.1 2.4.3L10 9.1A3 3 0 0 1 12 8Z"/>';
   const cards=Array.from({length:8},(_,i)=>{
    const level=i+1,tone=level>=6?'deep':String(level);
    return `<div class="profile-achievement-level-swatch"><span class="profile-achievement-medallion" data-level="${level}" data-level-tone="${tone}" aria-hidden="true"><svg class="profile-achievement-icon" viewBox="0 0 24 24">${runner}</svg><span class="profile-achievement-value">49.7 mi</span><span class="profile-achievement-level">Lv ${level}</span></span><small>Lv ${level}</small></div>`;
   }).join('');
   document.body.innerHTML=`<main class="profile-achievement-level-strip"><h1>Run · selected sport colour</h1><p>Fictional progression through Lv 1–8 in Ben’s selected P2 palette.</p><div class="profile-achievement-level-swatches">${cards}</div></main>`;
  });
  const levelColors=await page.locator('.profile-achievement-level-swatch .profile-achievement-medallion').evaluateAll(nodes=>nodes.map(node=>({fill:getComputedStyle(node).backgroundColor,shadow:getComputedStyle(node).boxShadow})));
  const levelBrightness=levelColors.map(color=>brightness(color.fill));
  assert(levelBrightness.every((value,index)=>index===0||value<levelBrightness[index-1]),`P2 run medallions deepen at each level in ${theme}: ${JSON.stringify({levelBrightness,levelColors})}`);
  assert(!levelColors[4].shadow.includes('18px')&&levelColors.slice(5).every(color=>color.shadow.includes('18px')),'P2 adds the soft token-coloured glow from Lv 6 onward');
  if(shots){fs.mkdirSync(shots,{recursive:true});await page.locator('.profile-achievement-level-strip').screenshot({path:`${shots}/palette-p2-levels-390-${theme}.png`,animations:'disabled'});}
  await assert330AchievementViews(page,base,setUnits,theme,shots);
  assert.deepEqual(errors,[],`no browser errors in ${theme}`);assert.deepEqual(writes.filter(w=>w!=='/api/challenges/signup/continue'),[],`no unmocked writes in ${theme}`);
  console.log(`Achievement medallions 390 ${theme}: profile, all tracks, history, units, icons and web haptic guard PASS`);
  await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
 }
 if(owner330Only||indexOnly||process.env.KINETTA_ACHIEVEMENT_FIT_ONLY==='1'||process.env.KINETTA_ACHIEVEMENT_EMPTY_ENTRY_ONLY==='1'||process.env.KINETTA_ACHIEVEMENT_RUN_ONLY==='1')return;
 const nativeContext=await browser.newContext(),nativePage=await nativeContext.newPage();
 await nativeContext.addInitScript(()=>{
  window.__achievementHaptics=[];
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',Plugins:{Preferences:{get:async()=>({value:null}),set:async()=>{},remove:async()=>{}},KinettaHaptics:{tap:async({kind})=>{window.__achievementHaptics.push(kind);}}}};
 });
 await nativePage.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD'].includes(request.method()))return route.fulfill({json:{}});return route.continue();});
 await nativePage.goto(base+'/');
 const nativeResult=await nativePage.evaluate(()=>Native.achievementLevelUp());
 for(let i=0;i<20&&!(await nativePage.evaluate(()=>window.__achievementHaptics.length));i++)await nativePage.waitForTimeout(10);
 assert.equal(nativeResult,true,'the existing iOS Capacitor plugin is used when available');
 assert.deepEqual(await nativePage.evaluate(()=>window.__achievementHaptics),['success'],'a level up requests light success feedback once');
 await nativeContext.close();
 console.log('Achievement native bridge: mocked iPhone plugin receives one success haptic');
};
