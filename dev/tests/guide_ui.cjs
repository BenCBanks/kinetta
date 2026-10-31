// Actual guide source and fictional accounts; every destination retained, no providers or real device actions.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,fn,arg){for(let n=0;n<160;n++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Guide did not settle');}
(async()=>{const b=await chromium.launch();try{
for(const state of ['new','typical','heavy'])for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}]){
 const c=await b.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_explore_'+state,password:'green teapot on the hill'}})).status(),200);
 await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
 await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({json:{}});}return r.continue();});
 await p.goto(base+'/me/explore');await until(p,()=>App.pageReady&&!!document.querySelector('#guide-results details'));
 await p.evaluate(state=>{const key='fit.guide:'+JSON.stringify([Native.base||location.origin,App.me.id])+':seen';store.set(key,[]);const ids=FEATURE_GUIDE.map(f=>guideId(f[1]));if(state!=='new')for(const id of ids.slice(0,state==='heavy'?ids.length:8))Discovery.visit('guide',id);render();},state);await until(p,()=>App.pageReady&&!!document.querySelector('#guide-results details'));
 const catalog=await p.evaluate(()=>FEATURE_GUIDE),ids=await p.locator('#guide-results details').evaluateAll(n=>n.map(e=>e.dataset.guideId));assert.equal(ids.length,59);assert.equal(new Set(ids).size,59);assert.equal(await p.locator('.feature-guide-card,select#guide-category').count(),0);
 const fresh=await p.locator('.guide-new:not(.seen)').count();assert.equal(fresh,state==='new'?59:state==='typical'?51:0,'New means this guide entry was opened');
 assert.equal(await p.locator('#guide-results .guide-open').count(),59);const actual=await p.locator('#guide-results .guide-open').evaluateAll(n=>n.map(e=>e.getAttribute('href')));assert.deepEqual(actual.slice().sort(),catalog.map(f=>f[3]).sort(),'every real destination retained');
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no horizontal overflow');assert(await p.locator('input').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16);
 for(const row of await p.locator('#guide-results summary,[data-guide-category]').all())assert((await row.boundingBox()).height>=44,'44px row/chip');
 if(size.width===390){const visible=await p.evaluate(()=>{const limit=document.querySelector('nav.tabs').getBoundingClientRect().top;return [...document.querySelectorAll('#guide-results summary')].filter(n=>n.getBoundingClientRect().bottom<=limit).length;});assert(visible>=10,'at least10 complete guide rows before tabs; got'+visible);}
 if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${state}-${size.width}-${theme}.png`});}
 // Search and category compose; clearing search keeps the category. Open/read marks only the current account.
 await p.locator('[data-guide-category="Food"]').click();await p.locator('input').fill('weight');const expected=catalog.filter(f=>f[0]==='Food'&&f.join(' ').toLowerCase().includes('weight'));assert.equal(await p.locator('#guide-results details').count(),expected.length);await p.locator('input').fill('');assert.equal(await p.locator('#guide-results details').count(),catalog.filter(f=>f[0]==='Food').length);
 await p.locator('[data-guide-category="All"]').click();const first=p.locator('#guide-results details').first();await first.locator('summary').click();await until(p,()=>document.querySelector('#guide-results details').open&&document.querySelector('#guide-results details .guide-new').classList.contains('seen'));assert.equal(await first.locator('.guide-how p').count(),2);assert.equal(await first.locator('.guide-new:not(.seen)').count(),0);assert((await first.locator('.guide-open').boundingBox()).height>=44);
 await p.reload();await until(p,()=>App.pageReady&&!!document.querySelector('#guide-results details'));assert.equal(await p.locator('#guide-results details').first().locator('.guide-new:not(.seen)').count(),0,'visit survives reload');
 await p.locator('input').fill('zz_no_such_fictional_feature');assert.match(await p.locator('#guide-results').innerText(),/No features match/);await p.locator('input').fill('');
 // Native guide still excludes unsupported browser-only imports, without removing other destinations.
 await p.evaluate(()=>{Native.on=true;render();});await until(p,()=>App.pageReady&&!!document.querySelector('#guide-results details'));const nativeLinks=await p.locator('.guide-open').evaluateAll(n=>n.map(e=>e.getAttribute('href')));assert(!nativeLinks.includes('/track/import')&&!nativeLinks.includes('/food/import'));assert.equal(nativeLinks.length,57);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Guide ${state} ${size.width}/${size.root} ${theme}:59 links/search/category/10-visible/44px/new/storage/native PASS`);
}
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
