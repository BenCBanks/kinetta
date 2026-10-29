// Loaded maps stay below navigation/sheets; headings and restored food drafts stay readable. Uses fictional tiles/demo data.
// NODE_PATH=<existing Playwright install> KINETTA_URL=http://localhost:8798 node dev/tests/map_ui.cjs
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.KINETTA_URL||'http://localhost:8798';
// Older Chromium rejects waitForFunction's internal eval under the app's CSP. Direct function calls preserve that policy.
async function ready(page){for(let i=0;i<150;i++){if(await page.evaluate(()=>App.pageReady&&!document.querySelector('#page[data-home-loading]')))return;await page.waitForTimeout(100);}throw Error('Page did not become ready');}
const tile=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#4a7586" d="M0 0h256v256H0z"/><path stroke="#fff" d="m0 30 256 180"/></svg>');
(async()=>{
 const browser=await chromium.launch();
 try{
  const login=await browser.newContext();
  assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  const storageState=await login.storageState();await login.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const {width,height,root}=size;
   const context=await browser.newContext({storageState,viewport:{width,height},colorScheme:theme,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),root);
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await context.route('**/api/map-config',r=>r.fulfill({json:{kind:'raster',url:base+'/qa-map/{z}/{x}/{y}.png',dark_url:'',max_zoom:19,attribution:'Fictional test tiles',attribution_url:'',personal_default:false}}));
   await context.route('**/qa-map/**',r=>r.fulfill({contentType:'image/svg+xml',body:tile}));
   await page.goto(base+'/me');await ready(page);
   // Warm navigation matters: the initial entry animation can temporarily isolate otherwise escaping map panes.
   await page.evaluate(()=>go('/progress/segments'));await ready(page);await page.locator('#sg-map .leaflet-tile-loaded').first().waitFor();await page.waitForTimeout(650);
   await page.evaluate(()=>{const r=document.querySelector('#sg-map').getBoundingClientRect();scrollTo(0,scrollY+r.top-(innerHeight-180));});
   // Make transparent renderer layers participate in hit testing to verify their actual paint order.
   await page.locator('#sg-map canvas,#sg-map img').evaluateAll(nodes=>nodes.forEach(n=>n.style.setProperty('pointer-events','auto','important')));
   const hits=await page.locator('nav.tabs a').evaluateAll(links=>links.map(a=>{const r=a.getBoundingClientRect();return{name:a.textContent,above:a.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}));
   assert(hits.every(x=>x.above),'Loaded map paints over navigation: '+JSON.stringify(hits));
   await page.locator('nav.tabs a[href="/food"]').click();await page.waitForURL('**/food');await ready(page);
   await page.evaluate(()=>go('/food/describe'));const field=page.locator('#thread-text');await field.waitFor();await page.waitForTimeout(100);
   assert(await field.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Empty food placeholder is clipped');
   const draft='Oats and yogurt\nSave this draft.';await field.fill(draft);await page.evaluate(()=>go('/me'));await ready(page);await page.evaluate(()=>go('/food/describe'));await field.waitFor();await page.waitForTimeout(100);
   assert.equal(await field.inputValue(),draft);assert(await field.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Restored food draft is clipped');
   await field.fill('');
   await page.evaluate(()=>go('/segments/new'));await page.locator('#pl-map .leaflet-tile-loaded').first().waitFor();await page.locator('#pl-hint').waitFor();
   const separate=await page.evaluate(()=>{const a=document.querySelector('#pl-hint').getBoundingClientRect(),b=document.querySelector('#pl-map .leaflet-control-attribution').getBoundingClientRect();return a.top>=b.bottom||a.bottom<=b.top;});
   assert(separate,'Drawing instruction overlaps map credit');
   assert(await page.locator('.plan-title').evaluate(el=>{const text=el.firstChild;return [...el.textContent.matchAll(/\S+/g)].every(m=>{const range=document.createRange();range.setStart(text,m.index);range.setEnd(text,m.index+m[0].length);return range.getClientRects().length===1;});}),'A narrow heading splits a word across lines');
   const contrast=await page.locator('#pl-hint').evaluate(el=>{const s=getComputedStyle(el),lum=color=>color.match(/[\d.]+/g).slice(0,3).map(n=>+n/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),a=lum(s.color),b=lum(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
   assert(contrast>=4.5,'Drawing instruction has unreadable contrast');
   await page.locator('#pl-more').click();const sheet=page.locator('.scrim').last();await sheet.waitFor();
   assert(await sheet.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height-30));}),'Map paints over the open tools sheet');
   await sheet.getByRole('button',{name:'Close',exact:true}).click();await sheet.waitFor({state:'detached'});
   await page.evaluate(()=>go('/activity/1'));await ready(page);await page.locator('.hero .stat').first().waitFor();
   const statOverflow=await page.locator('.hero .stat').evaluateAll(es=>es.flatMap(e=>{const cell=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e.querySelector('b'));return [...range.getClientRects()].some(r=>r.left<cell.left-1||r.right>cell.right+1)?[e.innerText]:[];}));
   assert.deepEqual(statOverflow,[],'Activity values must fit their own cells, including enlarged text');
   const zoomStarted=await page.evaluate(async()=>{
    const box=document.createElement('div');box.className='map';Object.assign(box.style,{position:'fixed',top:'0',width:'300px',height:'240px'});document.body.append(box);
    const view=await mapInto(box,[[[38,-100],[38.001,-100.001]]]);view.map.setView([38,-100],10,{animate:false});view.map.setZoom(11);
    await new Promise(requestAnimationFrame);const started=!!view.map._animatingZoom;box.remove();cleanViews();return started;
   });
   assert(zoomStarted,'Exercise actual map disposal during an active zoom');await page.waitForTimeout(350);
   assert.deepEqual(errors,[]);await context.close();console.log(`Map layers, sheets and food composer: ${width}px/${root}px text ${theme} PASS`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
