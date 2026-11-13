// Real Nutrition routes and shared chart helpers; fictional response facts, no provider or data writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const {fixtureSessions,settle,until}=require('./ui_fixture_browser.cjs');
const {initialize}=require('./spacing_screens.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Disposable local server only');
const row=(day,extra={})=>({day,today:false,eaten:1800,burned:2200,goal:1900,protein_g:100,carbs_g:200,fat_g:60,weight:null,trend:null,counted:true,deficit:400,total:400,...extra});
const earlier=row('2026-11-08',{weight:70,trend:70,total:400});
const middle=row('2026-11-09',{protein_g:0,total:800});
function payload(rows,days=30){return {rows,summary:{days,logged:rows.filter(r=>r.counted&&!r.today).length,past_days:rows.filter(r=>!r.today).length,avg_eaten:1800,avg_burned:2200,avg_goal:1900,avg_deficit:400,total_deficit:800,avg_protein_g:100,avg_carbs_g:200,avg_fat_g:60,predicted_kg:null,trend_change_kg:null,tdee:2100,meals:{}},targets:{protein_target:130},insights:[],top_foods:[]};}
const week=day=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
const date=(day,weekly=false)=>(weekly?'Week of ':'')+new Date(day+'T12:00:00Z').toLocaleDateString('en-US',weekly?{month:'short',day:'numeric'}:{weekday:'short',month:'short',day:'numeric'});
const number=v=>v==null?'–':Math.round(v).toLocaleString('en-US');
function columns(test){
 if(!test.days)return test.rows.map(r=>({...r,label:date(r.day),burned:r.eaten==null?null:r.burned,partial:r.today}));
 const groups=new Map();for(const r of test.rows){const k=week(r.day);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 return [...groups].map(([day,rows])=>{const known=rows.filter(r=>r.counted),weights=rows.filter(r=>r.weight!=null),c={label:date(day,true),partial:rows.some(r=>r.today),weight:weights.length?weights.reduce((s,r)=>s+r.weight,0)/weights.length:null,trend:[...rows].reverse().find(r=>r.trend!=null)?.trend};for(const key of ['eaten','burned','goal','protein_g']){const values=known.map(r=>r[key]).filter(v=>v!=null);c[key]=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}return c;});
}
async function readoutDate(p,id){return p.locator(id+' .chart-fact-date').evaluate(n=>[...n.childNodes].filter(x=>x.nodeType===Node.TEXT_NODE).map(x=>x.textContent).join('').trim());}
async function energyFacts(p,c){
 const dateLabel=await readoutDate(p,'#nt-energychart'),expected=[{label:'Eaten',value:number(c.eaten)}];
 expected.push({label:'Burned',value:number(c.burned)});
 if(c.goal)expected.push({label:'Goal',value:number(c.goal)});
 if(c.eaten!=null&&c.burned&&c.counted!==false&&!c.partial){const d=c.burned-c.eaten;expected.push({label:d>=0?'Deficit':'Surplus',value:number(Math.abs(d))});}
 if(c.counted===false&&c.eaten!=null&&!c.partial)expected.push({label:'Partly logged, not counted',value:null});
 if(c.weight!=null||c.trend!=null){const imperial=await p.evaluate(()=>App.me.units==='imperial'),fmt=v=>(v*(imperial?2.20462:1)).toFixed(1)+(imperial?' lb':' kg');expected.push({label:'Weight',value:c.weight==null?'–':fmt(c.weight),detail:c.trend!=null?'Trend '+fmt(c.trend).split(' ')[0]:''});}
 const actual=await p.locator('#nt-energychart .chart-fact').evaluateAll(ns=>ns.map(n=>({label:n.querySelector('.chart-fact-label').textContent.trim(),value:n.querySelector('b')?.textContent.trim()??null,detail:n.querySelector('.chart-fact-detail')?.textContent.trim()||''})));
 assert.equal(dateLabel,c.label+(c.partial?' (so far)':''),'selected Energy date is the visible date line');assert.deepEqual(actual,expected.map(f=>({detail:'',...f})),'selected Energy values and qualification match their visible fact labels');
}
async function cumulativeFacts(p,r){
 const dateLabel=await readoutDate(p,'#nt-cum'),fact=p.locator('#nt-cum .chart-fact'),value=await fact.locator(':scope > b').innerText(),detail=await fact.locator('.chart-fact-detail').innerText(),expectedTotal=number(Math.abs(r.total))+' kcal '+(r.total>=0?'deficit':'surplus'),expectedDetail=r.counted?(r.deficit==null?'resting calories not synced':'Day: '+number(Math.abs(r.deficit))+' kcal '+(r.deficit>=0?'deficit':'surplus')):'partly logged, not counted';
 assert.equal(dateLabel,date(r.day),'selected cumulative date is the visible date line');assert.equal(await fact.locator('.chart-fact-label').innerText(),'Total');assert.equal(value,expectedTotal,'selected cumulative total has its visible label and units');assert.equal(detail,expectedDetail,'selected cumulative qualification is human-readable');
}
const cases=[
 {name:'known',rows:[earlier,middle,row('2026-11-10',{protein_g:84,total:1200})],protein:'84 g',energy:/Deficit\s+400/,cum:/Nov 10.*Total\s+1,200 kcal deficit/},
 {name:'zero',rows:[earlier,middle,row('2026-11-10',{protein_g:0,total:1200})],protein:'0 g',energy:/Eaten\s+1,800/,cum:/Nov 10/},
 {name:'unknown',rows:[earlier,middle,row('2026-11-10',{eaten:null,burned:2200,protein_g:null,counted:false,deficit:null,total:800})],protein:'–',energy:/Eaten\s+–\s+Burned\s+–/,cum:/Nov 9.*Total\s+800 kcal deficit/},
 {name:'today',rows:[earlier,middle,row('2026-11-12',{today:true,protein_g:45,counted:false,total:800})],protein:'45 g',energy:/Nov 12 \(so far\)/,cum:/Nov 9/},
 {name:'uncounted',rows:[earlier,middle,row('2026-11-10',{counted:false,deficit:null,total:800})],protein:'100 g',energy:/Partly logged, not counted/,cum:/Nov 10.*partly logged, not counted/},
 {name:'missing-burn',rows:[earlier,middle,row('2026-11-10',{burned:null,deficit:null,total:800})],protein:'100 g',energy:/Burned\s+–/,cum:/Nov 10.*resting calories not synced/},
 {name:'weekly',days:365,rows:[earlier,middle,row('2026-11-10',{protein_g:80}),row('2026-11-12',{today:true,counted:false,protein_g:900})],protein:'40 g',energy:/Week of Nov 9 \(so far\)/,cum:/Nov 10/},
 {name:'weekly-unknown',days:365,rows:[row('2026-11-02'),row('2026-11-03',{protein_g:0,total:800}),row('2026-11-09',{protein_g:null,eaten:null,counted:false})],protein:'–',energy:/Week of Nov 9.*Eaten\s+–/,cum:/Nov 3.*Total\s+800 kcal deficit/},
 {name:'sparse',rows:[earlier,row('2026-11-10',{eaten:null,protein_g:null,counted:false})],protein:'–',energy:/Nov 10/,sparse:true},
 {name:'empty',rows:[row('2026-11-10',{eaten:null,protein_g:null,counted:false})],empty:true}
];
async function positions(p){return p.locator('#nt-body .chartbox svg').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y+scrollY,r.width,r.height];}));}
async function unchanged(p,before,label){const after=await positions(p);assert.equal(after.length,before.length);after.forEach((r,i)=>r.forEach((v,j)=>assert(Math.abs(v-before[i][j])<1,label+' geometry')));}
async function inspect(p,id,index,count,line=false,invalid=false){
 const svg=p.locator(id+' svg').first();await p.mouse.move(0,0);await svg.evaluate(n=>n.scrollIntoView({block:'center',inline:'nearest'}));
 const point=await svg.evaluate((n,{index,count,line,invalid})=>{const r=n.getBoundingClientRect(),W=n.viewBox.baseVal.width,L=Number(n.querySelector('.gl').getAttribute('x1')),R=W-Number(n.querySelector('.gl').getAttribute('x2'));
  const x=invalid?2:line?L+(W-L-R)*index/(count-1):L+(W-L-R)*(index+.5)/count;
  return {x:r.left+x/W*r.width,y:r.top+Math.min(40,r.height/2)};},{index,count,line,invalid});
 await p.mouse.click(point.x,point.y);
}
async function hint(p,id,visible){assert.equal(await p.locator(id+' .readout-hint').evaluate(n=>getComputedStyle(n).visibility!=='hidden'),visible,id+' hint lifetime');}
async function initial(p,id,pattern){
 assert.match((await p.locator(id+' .readout').innerText()).replace(/\s+/g,' '),pattern);
 await hint(p,id,true);
 assert.equal(await p.locator(id+' .hl[visibility="visible"],'+id+' .xh[visibility="visible"],'+id+' .xdot[visibility="visible"]').count(),0,id+' initialization has no active mark');
}
async function wrapped(p){assert(await p.locator('#nt-body .readout').evaluateAll(ns=>ns.every(n=>n.scrollWidth<=n.clientWidth+1&&[...n.children].every(c=>c.getBoundingClientRect().right<=n.getBoundingClientRect().right+1))),'readout facts wrap completely');}
async function insightHeader(p){
 const fit=await p.evaluate(()=>{const top=document.querySelector('.nutrition-detail .top'),title=top?.querySelector(':scope > h1'),controls=[...top.querySelectorAll('.acts > *')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};});return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,title:title&&{width:title.clientWidth,scroll:title.scrollWidth,whiteSpace:getComputedStyle(title).whiteSpace},controls};});
 assert.equal(fit.documentWidth,fit.width,`Insights header has no horizontal overflow at ${fit.width}px`);
 assert(fit.title&&fit.title.scroll<=fit.title.width+1&&fit.title.whiteSpace==='normal',`Insights title fits without clipping at ${fit.width}px: ${JSON.stringify(fit.title)}`);
 assert.equal(fit.controls.length,3,'help, notifications and Kit shortcuts remain available');
 assert(fit.controls.every(r=>r.width>=44&&r.height>=44&&r.left>=0&&r.right<=fit.width+1),`all Insights header targets remain at least 44px and inside ${fit.width}px: ${JSON.stringify(fit.controls)}`);
}
(async()=>{
 const browser=await chromium.launch();
 try{
  const auth=(await fixtureSessions(browser,base,[{login:'alex'}])).get('alex');
  for(const theme of ['light','dark'])for(const test of cases){
   const expectedColumns=columns(test),count=expectedColumns.length;
   const c=await browser.newContext({storageState:auth.storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:'UTC'}),p=await c.newPage(),writes=[],errors=[],external=[],facts=payload(test.rows,test.days);
   try{
    let delayedFont=theme==='light'&&test.name==='known',fontRequest;
    if(delayedFont)await c.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='.readout { font-family:"Source Serif 4" !important }';document.head.append(style);void document.fonts.load('14px "Source Serif 4"');}));
    await c.addInitScript(initialize,{root:16,native:false,base,id:auth.id});await p.clock.setFixedTime(new Date('2026-11-12T12:00:00Z'));
    p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base){external.push(u.pathname);return r.abort();}
     if(delayedFont&&u.pathname==='/static/fonts/source-serif-4.woff2'){fontRequest=r;return;}
     if(u.pathname==='/api/food/insights'&&q.method()==='GET')return r.fulfill({json:facts});
     if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});
     if(q.method()==='POST'&&u.pathname==='/api/milestones/celebrate')return r.fulfill({json:{items:[],pending:false}});
     if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.abort();}return r.continue();});
    const open=async view=>{await p.mouse.move(0,0);await p.goto(`${base}/food?view=${view}&r=${test.days||30}`,{waitUntil:'domcontentloaded'});await until(p,()=>typeof App!=='undefined'&&App.pageReady&&!!document.querySelector('#nt-body .card'),'Nutrition route');if(!test.empty)await p.locator(view==='macros'?'#nt-protein svg': '#nt-energychart svg').first().waitFor({state:'attached'});await p.locator('.nutrition-detail .top [data-kit-entry]').waitFor({state:'attached'});await insightHeader(p);
     if(delayedFont){
      for(let attempt=0;!fontRequest&&attempt<50;attempt++)await p.waitForTimeout(100);
      assert(fontRequest,'real font request held');assert.equal(await p.evaluate(()=>document.fonts.status),'loading');
      const hidden=async()=>assert(await p.locator('#nt-protein > *').evaluateAll(ns=>ns.every(n=>getComputedStyle(n).visibility==='hidden')),'pending-font draw children are not exposed');
      await hidden();assert.equal(await p.locator('#nt-protein .readout').evaluate(n=>n.style.minHeight),'','reservation waits for actual font metrics');
      await p.evaluate(cols=>{const box=document.querySelector('#nt-protein'),old=box.querySelector('.readout');periodBars(box,cols.map(c=>({label:c.label,partial:c.partial,readoutValue:c.protein_g,segs:[{k:'s3',v:c.protein_g||0}]})),{keys:[{k:'s3',name:'Protein'}],fmt:v=>Math.round(v).toLocaleString()+' g',yfmt:v=>String(Math.round(v)),avg:130,avgLabel:'Target',height:150,initialReadout:{initialIndex:cols.length-1,hint:'Tap a bar'}});if(old.isConnected)throw Error('old draw still mounted');globalThis.readoutRevealErrors=[];const observer=new MutationObserver(()=>{const ro=box.querySelector('.readout');if([...box.children].some(n=>getComputedStyle(n).visibility==='visible')&&!parseFloat(ro.style.minHeight))readoutRevealErrors.push('latest draw exposed before reservation');});observer.observe(box,{subtree:true,attributes:true,attributeFilter:['style']});globalThis.readoutRevealObserver=observer;},expectedColumns);
      await hidden();assert.equal(await p.locator('#nt-protein').evaluate(n=>n.style.visibility),'','persistent owner never acquires hidden state');assert.equal(await p.locator('#nt-protein .readout').evaluate(n=>n.style.minHeight),'','replacement waits for font metrics');
      delayedFont=false;await fontRequest.continue();await p.evaluate(()=>document.fonts.ready);
      assert(await p.locator('#nt-protein > *').evaluateAll(ns=>ns.every(n=>getComputedStyle(n).visibility==='visible')),'latest redraw reveals after fonts');assert(await p.locator('#nt-protein .readout').evaluate(n=>parseFloat(n.style.minHeight)>0),'latest draw reserves before reveal');assert.deepEqual(await p.evaluate(()=>{readoutRevealObserver.disconnect();return readoutRevealErrors;}),[],'stale font callback cannot expose latest draw early');
     }
     await p.evaluate(()=>document.fonts.ready);await settle(p);};
    const shot=async state=>{if(out&&['known','unknown','today','uncounted'].includes(test.name)){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/nutrition-readout-${test.name}-${state}-${theme}.png`,fullPage:true,animations:'disabled'});}};
    await open('macros');
    if(test.empty){assert.match(await p.locator('#nt-body').innerText(),/Nothing logged in this range/);assert.equal(await p.locator('.readout-hint').count(),0);}
    else{
     const ro=p.locator('#nt-protein .readout');assert.equal((await ro.locator('b').innerText()).trim(),test.protein);await initial(p,'#nt-protein',test.days?/Week of Nov/:/Nov 10|Nov 12/);assert.equal(await readoutDate(p,'#nt-protein'),expectedColumns.at(-1).label+(expectedColumns.at(-1).partial?' (so far)':''),'exact final represented Protein date or Week-of bucket as displayed');
     if(test.name==='today')assert.match(await ro.innerText(),/so far/);await shot('protein-initial');
     const before=await positions(p);await inspect(p,'#nt-protein',0,3,false,true);await hint(p,'#nt-protein',true);
     await inspect(p,'#nt-protein',0,count);await hint(p,'#nt-protein',false);await unchanged(p,before,'protein');
     await inspect(p,'#nt-protein',count-1,count);
     assert.equal((await ro.locator('b').innerText()).trim(),test.protein,'inspection preserves nullable value');await wrapped(p);await unchanged(p,before,'protein final');
     await p.mouse.move(0,0);await hint(p,'#nt-protein',false);await shot('protein-inspected');
    }
    await open('energy');
    if(test.empty){assert.match(await p.locator('#nt-body').innerText(),/Nothing logged in this range/);assert.equal(await p.locator('.readout-hint').count(),0);}
    else{
     await initial(p,'#nt-energychart',test.energy);const text=await p.locator('#nt-energychart .readout').innerText();
     if(['today','uncounted','unknown','missing-burn','weekly-unknown'].includes(test.name))assert.doesNotMatch(text,/Deficit|Surplus/);
     assert.equal(await p.locator('#nt-energychart .ro-edit').count(),test.days?0:1,'daily-only Edit link');
     if(!test.days)assert.equal(await p.locator('#nt-energychart .ro-edit').getAttribute('href'),'/food?d='+test.rows.at(-1).day);
     assert.equal(await p.locator('#nt-energychart .goal-ln').count(),1,'goal curve retained');
     if(test.sparse){assert.match(await p.locator('#nt-cum').innerText(),/A few more days/);assert.equal(await p.locator('#nt-cum .readout-hint').count(),0);}
     else await initial(p,'#nt-cum',test.cum);
     await shot('energy-initial');const before=await positions(p);
     await inspect(p,'#nt-energychart',0,3,false,true);await hint(p,'#nt-energychart',true);
     for(let i=0;i<count;i++){await inspect(p,'#nt-energychart',i,count);await energyFacts(p,expectedColumns[i]);await hint(p,'#nt-energychart',false);await unchanged(p,before,'energy');await wrapped(p);}
     if(!test.sparse){const points=test.rows.filter(r=>!r.today&&r.eaten!=null);await inspect(p,'#nt-cum',0,points.length,true,true);await hint(p,'#nt-cum',true);for(let i=0;i<points.length;i++){await inspect(p,'#nt-cum',i,points.length,true);await cumulativeFacts(p,points[i]);await hint(p,'#nt-cum',false);await unchanged(p,before,'cumulative');await wrapped(p);}}
     await p.mouse.move(0,0);await hint(p,'#nt-energychart',false);await shot('energy-inspected');
     await open('energy');await hint(p,'#nt-energychart',true);
     if(test.name==='known'){
      const controls=await p.evaluate(()=>{const box=document.createElement('div');document.querySelector('#nt-body').append(box);const cols=[{label:'Fixture',eaten:100,burned:200,goal:150}];energyChart(box,cols,{interactive:false,initialReadout:{initialIndex:0,hint:'Tap a bar'}});const staticHint=box.querySelector('.readout');energyChart(box,cols);const blank=box.querySelector('.readout').textContent;box.remove();return {staticHint:!!staticHint,blank};});
      assert.deepEqual(controls,{staticHint:false,blank:''},'static and legacy callers remain opt-out');
      await p.setViewportSize({width:330,height:844});await open('macros');await open('energy');await p.setViewportSize({width:390,height:844});await open('energy');
     }
    }
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'390px page fits');assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(`Nutrition initial readout ${test.name} 390 ${theme}: PASS`);
   }finally{await c.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
