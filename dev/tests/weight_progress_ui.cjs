'use strict';
// Weight-only accounts on an isolated copy. No provider/device or UI write actions.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR,phase=process.env.PHASE||'before',width=Number(process.env.W||390),root=Number(process.env.ROOT||15);
const until=async(p,fn,label)=>{for(let i=0;i<150;i++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
const surfaces=[['progress','/progress'],['nutrition','/food'],['insights','/food?view=overview'],['weight','/food?view=weight'],['explore','/me/explore'],['body','/me/settings?setup=body']];
(async()=>{
 const browser=await chromium.launch(),reports=[];
 try{
  for(const state of ['empty','typical','health'])for(const theme of ['light','dark'])for(const [surface,href] of surfaces){
   if(process.env.SURFACE&&surface!==process.env.SURFACE)continue;
   const context=await browser.newContext({viewport:{width,height:width===330?667:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
   try{
    const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_weight_'+state,password:'green teapot on the hill'}});assert.equal(login.status(),200);
    await context.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),root);
    const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{}});}return route.continue();});
    await page.goto(base+href);
    if(surface==='body')await page.locator('#m-form [name=weight]').waitFor();
    else await until(page,()=>App.pageReady,'Page ready');
    if(surface==='progress')await page.locator('[data-progress-feature]').first().waitFor();
    if(surface==='nutrition'){await page.locator('[data-nutrition-feature=weight]').waitFor();await page.locator('#fd-explore').scrollIntoViewIfNeeded();}
    if(surface==='weight'){await page.locator('.wform').waitFor();await until(page,()=>!!document.querySelector('#nt-whist .card'),'Weight history ready');}
    if(surface==='explore'){await page.getByRole('searchbox',{name:'Search features'}).fill('weight');await page.locator('.guide-search').scrollIntoViewIfNeeded();}
    if(surface==='insights')await page.locator('.insights-log-weight,a[href*="/progress/weight"],a[href*="view=weight"]').first().waitFor();
    await page.waitForTimeout(150);
    const metrics=await page.evaluate(()=>{
     const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
     const rows=[...document.querySelectorAll('.weight-history-row')].slice(0,4).map(rect),controls=[...document.querySelectorAll('.wform input,.wform button,.weight-history-row button')].slice(0,5).map(rect);
     return {weightHeading:document.querySelector('.weight-heading')?rect(document.querySelector('.weight-heading')):null,overflow:document.documentElement.scrollWidth>innerWidth+1,rows,controls,pitch:rows.length>1?rows[1].y-rows[0].y:null,gap:rows.length>1?rows[1].y-rows[0].bottom:null,progressWeight:[...document.querySelectorAll('#p-explore a')].filter(a=>/weight/i.test(a.textContent)).length,bodyWeight:document.querySelector('#m-form [name=weight]')?.value||'',weightLinks:[...document.querySelectorAll('a')].filter(a=>/weight/i.test(a.textContent)).map(a=>({text:a.textContent.trim(),href:a.getAttribute('href')}))};
    });
    if(phase!=='before'&&surface==='progress'){assert.equal(metrics.progressWeight,1);assert.equal(metrics.overflow,false);const text=await page.locator('[data-progress-feature=weight]').textContent();assert(state==='empty'?/first weigh-in/.test(text):/latest/.test(text));}
    if(phase!=='before'&&surface==='weight'){assert.equal(new URL(page.url()).pathname,'/progress/weight');assert.equal(await page.locator('nav.tabs a[aria-current=page]').getAttribute('data-tab'),'progress');assert.equal(metrics.overflow,false);assert(await page.locator('.weight-heading').evaluate(header=>{const title=header.querySelector('h1'),range=document.createRange();range.selectNodeContents(title);const ink=range.getBoundingClientRect(),parent=header.getBoundingClientRect();return ink.left>=parent.left-1&&ink.right<=parent.right+1;}),'Weight header text fits');}
    assert.deepEqual(errors,[]);assert(writes.every(url=>url==='/api/challenges/signup/continue'),'Only blocked startup write');
    if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${phase}-${state}-${surface}-${theme}-${width}.png`)});}
    reports.push({state,surface,theme,...metrics});
   }finally{await context.close();}
  }
  if(out)fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(reports,null,2));
  console.log(`Weight ${phase}: ${reports.length} rendered weight-only surfaces, three histories, both themes; no runtime errors or UI/provider/device writes`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
