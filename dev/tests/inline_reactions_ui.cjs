'use strict';
// Measure the real compact emoji footer/tray with fictional cards; no writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR,phase=process.env.PHASE||'before',sourceDir=process.env.SOURCE_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch(),reports=[];
 try{
  for(const size of [{width:390,root:16},{width:330,root:24}])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width:size.width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
   try{
    assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_inline_viewer',password:'green teapot on the hill'}})).status(),200);
    await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await c.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();if(sourceDir&&phase==='before'&&['social.js','pages.js','style.css','activity-home.css','explore.js'].some(file=>u.pathname==='/static/'+file)){const file=path.join(sourceDir,'app/static',path.basename(u.pathname));return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript'});}return ['GET','HEAD'].includes(r.method())?route.continue():route.fulfill({json:{}});});
    await p.goto(base+'/activity');await until(p,()=>App.pageReady&&document.querySelectorAll('article.post').length>=3,'Fictional feed ready');
    for(const state of ['empty','mixed','selected']){
     const card=p.locator('article.post').filter({hasText:'Fictional '+state+' run'});await card.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));await p.waitForTimeout(100);
     const metrics=await card.evaluate(card=>{const r=n=>{const x=n.getBoundingClientRect();return{x:x.x,y:x.y,width:x.width,height:x.height};};return{buttons:[...card.querySelectorAll('.post-ft button')].filter(n=>!n.hidden&&n.getClientRects().length&&getComputedStyle(n).display!=='none').map(n=>({label:n.getAttribute('aria-label'),text:n.textContent.trim(),...r(n)})),overflow:document.documentElement.scrollWidth>innerWidth+1,footer:r(card.querySelector('.post-ft'))};});
     const footer=await card.locator('.post-ft').boundingBox(),tabs=await p.locator('nav.tabs').boundingBox();assert(footer.y+footer.height<=tabs.y+1,'Footer is visible above navigation in evidence');
     if(out){fs.mkdirSync(out,{recursive:true});await card.screenshot({path:path.join(out,`${phase}-${state}-${theme}-${size.width}.png`)});}
     if(phase==='after'){
      assert.equal(await card.locator('[data-inline-react]').count(),0,'permanent legacy toggles are removed');assert(await card.locator('.reaction-main').isVisible());assert(await card.locator('.reaction-more').isVisible(),'the picker has a visible plus');
      assert(await card.locator('.post-ft .num:visible').evaluateAll(ns=>ns.every(n=>parseFloat(getComputedStyle(n).fontSize)>=15)),'Readable counters retain the minimum');assert.equal(metrics.overflow,false);assert(Math.max(...metrics.buttons.map(b=>b.y))-Math.min(...metrics.buttons.map(b=>b.y))<2,'Footer stays on one row');
      for(const b of metrics.buttons)assert(b.width>=44&&b.height>=44,JSON.stringify(b));for(let a=0;a<metrics.buttons.length;a++)for(let b=a+1;b<metrics.buttons.length;b++){const x=metrics.buttons[a],y=metrics.buttons[b],dx=Math.max(x.x-y.x-y.width,y.x-x.x-x.width),dy=Math.max(x.y-y.y-y.height,y.y-x.y-x.height);assert(dx>=7.5||dy>=7.5,'Neighbouring tap targets keep eight pixels');}
      await card.locator('.reaction-more').click();const tray=p.locator('.reaction-picker:not([hidden])');assert.equal(await tray.locator('[data-react]').count(),16);
      const geometry=await tray.evaluate(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,overflow:n.scrollWidth>n.clientWidth+1,choices:[...n.querySelectorAll('[data-react]')].map(b=>{const r=b.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height,right:r.right,bottom:r.bottom};})};});
      assert(geometry.left>=0&&geometry.right<=size.width,'entire tray fits the viewport');assert.equal(geometry.overflow,false,'tray does not scroll horizontally');assert.equal(new Set(geometry.choices.map(b=>b.y)).size,3,'six columns use three rows');for(const b of geometry.choices)assert(b.w>=44&&b.h>=44&&b.x>=geometry.left&&b.right<=geometry.right,'all sixteen full targets are visible');await p.keyboard.press('Escape');
     }
     reports.push({state,theme,...size,...metrics});
    }
    if(phase==='after'){
     const card=p.locator('article.post').filter({hasText:'Fictional mixed run'});await card.evaluate(n=>n.querySelector('[data-reaction-group]')._sync({my_reaction:'muscle',reactions:{clap:999999,muscle:1234567,fire:12000}}));
     const group=card.locator('[data-reaction-group]');assert.match(await group.locator('.reaction-main').getAttribute('aria-label'),/flexed biceps/);assert.match(await group.locator('.reaction-count').getAttribute('aria-label'),/2246566 reactions/);
     const numbers=await group.locator('.num:visible').evaluateAll(ns=>ns.map(n=>{const ink=document.createRange();ink.selectNodeContents(n);const a=ink.getBoundingClientRect(),b=n.closest('button').getBoundingClientRect();return{value:n.textContent,ink:{left:a.left,right:a.right},target:{left:b.left,right:b.right},font:getComputedStyle(n).fontSize};}));assert(numbers.every(n=>n.ink.left>=n.target.left-.5&&n.ink.right<=n.target.right+.5),'Large displayed counts fit their whole targets: '+JSON.stringify({size,theme,numbers}));
    }
    assert.deepEqual(errors,[]);
   }finally{await c.close();}
  }
  if(out)fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(reports,null,2));console.log(`Inline reactions ${phase}: ${reports.length} real card captures/measurements, both themes,390/default and330/enlarged PASS`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
