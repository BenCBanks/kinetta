// Actual private fictional histories and production predictions; no providers/devices or unrelated writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,label){for(let i=0;i<180;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);}
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'subpages_fixture.py')],{env:process.env,stdio:'inherit'});
 const b=await chromium.launch();try{
 for(const state of ['empty','typical','heavy']){
  const login=await b.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_subpages_'+state,password:'green teapot on the hill'}})).status(),200);const auth=await login.storageState(),data=await(await login.request.get(base+'/api/fitness?days=3650')).json();await login.close();
  for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:15},{width:390,height:844,root:16},{width:330,height:667,root:24}]){
   const c=await b.newContext({storageState:auth,viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(req.method())){if(u.pathname!=='/api/challenges/signup/continue')writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
   const ready=()=>until(p,()=>App.pageReady&&!!document.querySelector('#fi-pred .card')&&!document.querySelector('#fi-body .skeleton'),'Fitness ready');await p.goto(base+'/progress?view=fitness');await ready();await p.evaluate(()=>document.fonts.ready);
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'root does not overflow');assert((await p.evaluate(()=>document.documentElement.clientWidth))<=size.width+1,'configured viewport stays fixed');
   for(const card of await p.locator('#fi-pred > .card,#fi-body > .card').all())assert(await card.evaluate(n=>{const s=getComputedStyle(n);return [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].every(v=>parseFloat(v)>=16);}), '16px on every Fitness card');
   if(size.root<=16)for(const h of await p.locator('#fi-pred h2,#fi-body h2').all()){const v=await h.evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(v>=17&&v<=20,'section heading scale');}
   assert.equal(await p.locator('.discovery-grid').count(),0);assert.equal(await p.locator('#p-rng button').count(),1,'existing years choice remains in the first card');
   if(state==='empty'){assert.equal(await p.locator('.pred').count(),0);assert.match(await p.locator('#fi-pred').innerText(),/Run a mile or more/);}
   else{
    assert.equal(await p.locator('.pred > div').count(),4);assert.equal(await p.locator('.fitness-predictions .prediction-source').count(),1,'one complete shared source');const source=data.predictions[0].from;assert(source.distance_m>0&&source.elapsed_s>0);assert.equal(await p.locator('.fitness-predictions .prediction-source').getAttribute('href'),'/activity/'+source.activity_id);assert.match(await p.locator('.fitness-predictions .prediction-source').innerText(),/Based on your 5K/);
    const shown=await p.locator('.pred > div > b').allTextContents(),expected=await p.evaluate(rows=>rows.map(x=>dur(x.seconds)),data.predictions);assert.deepEqual(shown,expected,'displayed times equal unchanged API predictions');
    assert.equal(await p.locator('.prediction-method').getAttribute('open'),null);assert.match(await p.locator('.prediction-note').innerText(),/Estimates, not target paces/);
    const geometry=await p.evaluate(()=>{const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,h:r.height,w:r.width,b:r.bottom};},card=document.querySelector('.fitness-predictions'),grid=card.querySelector('.pred'),s=getComputedStyle(card),g=getComputedStyle(grid);return {padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),gap:[g.rowGap,g.columnGap].map(parseFloat),rows:[...grid.children].map(box),bad:[...grid.querySelectorAll('b')].filter(n=>n.scrollWidth>n.clientWidth+1).length};});assert(geometry.padding.every(v=>v>=16),'card padding: '+JSON.stringify(geometry));assert(geometry.gap.every(v=>v>=8));assert.equal(geometry.bad,0,'complete prediction times fit');for(const a of await p.locator('.prediction-source,.prediction-method > summary').all())assert((await a.boundingBox()).height>=44,'source/help44px targets');
    if(size.root<=16){const type=await p.locator('.fitness-predictions .pred b').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert(type>=20&&type<=24);const running=p.locator('#fi-body .card').first(),vdot=await running.locator('.bigstat').boundingBox(),nav=await p.locator('nav.tabs').boundingBox();assert(vdot.y+vdot.height<nav.y,'Running fitness and current VDOT remain on the first screen');}
    console.log('Fitness spacing',state,size.width,size.root,theme,JSON.stringify(geometry));
    await p.locator('.prediction-method summary').click();assert(await p.locator('.prediction-method').evaluate(n=>n.open));assert.match(await p.locator('.prediction-method').innerText(),/90 days/);await p.locator('.prediction-method summary').click();
    await p.locator('#p-vdot .chart-expand').click();await until(p,()=>!!document.querySelector('.fitness-inspect svg'),'full VDOT chart');await p.locator('.sheet [data-close]').click();assert.equal(await p.locator('.fitness-inspect').count(),0);
   }
   if(out){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/${state}-fitness-${size.width}-${size.root}-${theme}.png`});}
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Fitness ${state} ${size.width}/${size.root} ${theme} PASS`);
  }
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
