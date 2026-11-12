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
 const svg=p.locator(id+' svg').first();await p.mouse.move(0,0);await svg.scrollIntoViewIfNeeded();
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
(async()=>{
 const browser=await chromium.launch();
 try{
  const auth=(await fixtureSessions(browser,base,[{login:'alex'}])).get('alex');
  for(const theme of ['light','dark'])for(const test of cases){
   const count=test.days?new Set(test.rows.map(r=>{const d=new Date(r.day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);})).size:test.rows.length;
   const c=await browser.newContext({storageState:auth.storageState,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true,timezoneId:'UTC'}),p=await c.newPage(),writes=[],errors=[],external=[],facts=payload(test.rows,test.days);
   try{
    await c.addInitScript(initialize,{root:16,native:false,base,id:auth.id});await p.clock.setFixedTime(new Date('2026-11-12T12:00:00Z'));
    p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base){external.push(u.pathname);return r.abort();}
     if(u.pathname==='/api/food/insights'&&q.method()==='GET')return r.fulfill({json:facts});
     if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});
     if(q.method()==='POST'&&u.pathname==='/api/milestones/celebrate')return r.fulfill({json:{items:[],pending:false}});
     if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.abort();}return r.continue();});
    const open=async view=>{await p.mouse.move(0,0);await p.goto(`${base}/food?view=${view}&r=${test.days||30}`);await until(p,()=>typeof App!=='undefined'&&App.pageReady&&!!document.querySelector('#nt-body .card'),'Nutrition route');if(!test.empty)await p.locator(view==='macros'?'#nt-protein svg': '#nt-energychart svg').first().waitFor();await p.evaluate(()=>document.fonts.ready);await settle(p);};
    const shot=async state=>{if(out&&['known','unknown','today','uncounted'].includes(test.name)){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/nutrition-readout-${test.name}-${state}-${theme}.png`,fullPage:true,animations:'disabled'});}};
    await open('macros');
    if(test.empty){assert.match(await p.locator('#nt-body').innerText(),/Nothing logged in this range/);assert.equal(await p.locator('.readout-hint').count(),0);}
    else{
     const ro=p.locator('#nt-protein .readout');assert.equal((await ro.locator('b').innerText()).trim(),test.protein);await initial(p,'#nt-protein',test.days?/Week of Nov/:/Nov 10|Nov 12/);
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
     for(let i=0;i<count;i++){await inspect(p,'#nt-energychart',i,count);await hint(p,'#nt-energychart',false);await unchanged(p,before,'energy');await wrapped(p);}
     if(!test.sparse){const points=test.rows.filter(r=>!r.today&&r.eaten!=null).length;await inspect(p,'#nt-cum',0,points,true,true);await hint(p,'#nt-cum',true);for(let i=0;i<points;i++){await inspect(p,'#nt-cum',i,points,true);await hint(p,'#nt-cum',false);await unchanged(p,before,'cumulative');await wrapped(p);}}
     await p.mouse.move(0,0);await hint(p,'#nt-energychart',false);await shot('energy-inspected');
     await open('energy');await hint(p,'#nt-energychart',true);
     if(test.name==='known'){
      const controls=await p.evaluate(()=>{const box=document.createElement('div');document.querySelector('#nt-body').append(box);const cols=[{label:'Fixture',eaten:100,burned:200,goal:150}];energyChart(box,cols,{interactive:false,initialReadout:{initialIndex:0,hint:'Tap a bar'}});const staticHint=box.querySelector('.readout');energyChart(box,cols);const blank=box.querySelector('.readout').textContent;box.remove();return {staticHint:!!staticHint,blank};});
      assert.deepEqual(controls,{staticHint:false,blank:''},'static and legacy callers remain opt-out');
     }
    }
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'390px page fits');assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(`Nutrition initial readout ${test.name} 390 ${theme}: PASS`);
   }finally{await c.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
