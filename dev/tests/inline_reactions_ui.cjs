'use strict';
// Capture/measure unchanged fictional feed cards before editing; no UI writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR,phase=process.env.PHASE||'before',sourceDir=process.env.SOURCE_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(100);}throw Error(label);};
(async()=>{
 const browser=await chromium.launch(),reports=[];
 try{
  for(const size of [{width:390,root:15},{width:330,root:24}])for(const theme of ['light','dark']){
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
     if(phase==='after'){const buttons=card.locator('[data-inline-react]');assert.equal(await buttons.count(),3);for(const kind of ['cheer','strong','applause'])assert.equal(await card.locator(`[data-inline-react="${kind}"]`).count(),1);
      assert.equal(await card.locator('.reaction-count > svg').count(),1,'People icon identifies the tappable reactor total');assert(await card.locator('.post-ft .num:visible').evaluateAll(ns=>ns.every(n=>parseFloat(getComputedStyle(n).fontSize)>=15)),'Readable counter labels keep the15px minimum');assert.equal(metrics.overflow,false);assert(Math.max(...metrics.buttons.map(b=>b.y))-Math.min(...metrics.buttons.map(b=>b.y))<2,'Footer stays on one row');
      assert(await card.locator('.reaction-inline').evaluateAll(ns=>ns.every(n=>{const s=getComputedStyle(n);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(n,'::before').content==='none';})),'Reaction faces remain unpainted');
      assert(await card.locator('.reaction-inline[aria-pressed=true]').evaluateAll(ns=>ns.every(n=>{const probe=document.createElement('i');probe.style.color='var(--accent)';n.append(probe);const same=getComputedStyle(n).color===getComputedStyle(probe).color;probe.remove();return same;})),'Selected reaction keeps the brand color');
      for(const b of metrics.buttons)assert(b.width>=44&&b.height>=44,JSON.stringify(b));for(let a=0;a<metrics.buttons.length;a++)for(let b=a+1;b<metrics.buttons.length;b++){const x=metrics.buttons[a],y=metrics.buttons[b],dx=Math.max(x.x-y.x-y.width,y.x-x.x-x.width),dy=Math.max(x.y-y.y-y.height,y.y-x.y-x.height);assert(dx>=7.5||dy>=7.5,'Neighbouring tap targets have8px separation');}}
     reports.push({state,theme,...size,...metrics});
    }
    if(phase==='after'){
     const card=p.locator('article.post').filter({hasText:'Fictional mixed run'});await card.evaluate(n=>n.querySelector('[data-reaction-group]')._sync({my_reaction:'strong',reactions:{cheer:999999,strong:1234567,applause:12000}}));
     const group=card.locator('[data-reaction-group]');assert.match(await group.locator('[data-inline-react=strong]').getAttribute('aria-label'),/1234567 reactions/);assert.match(await group.locator('.reaction-count').getAttribute('aria-label'),/2246566 reactions/);
     assert(await group.locator('.num:visible').evaluateAll(ns=>ns.every(n=>{const ink=document.createRange();ink.selectNodeContents(n);const a=ink.getBoundingClientRect(),b=n.closest('button').getBoundingClientRect();return a.left>=b.left-.5&&a.right<=b.right+.5;})),'Large displayed counts fit their whole targets');
    }
    assert.deepEqual(errors,[]);
   }finally{await c.close();}
  }
  if(out)fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(reports,null,2));console.log(`Inline reactions ${phase}: ${reports.length} real card captures/measurements, both themes,390/default and330/enlarged PASS`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
