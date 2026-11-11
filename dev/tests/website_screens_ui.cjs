'use strict';
// Whole fictional website screens; all external writes blocked, no app accounts or providers.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../site');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';if(!path.extname(name))name+='.html';
 const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
});
const until=async(p,fn)=>{for(let n=0;n<100;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(30);}throw Error('Website state did not settle');};
const pages=(process.env.KINETTA_WEBSITE_PAGES||'index,training,food,friends').split(',');
const widths=(process.env.KINETTA_WEBSITE_WIDTHS||'1280,390').split(',').map(Number);
const themes=(process.env.KINETTA_WEBSITE_THEMES||'light,dark').split(',');
const dprs=(process.env.KINETTA_WEBSITE_DPRS||'1,2').split(',').map(Number);
(async()=>{
 for(const page of ['index','training','food','friends','compare','guide','privacy']){
  const html=fs.readFileSync(path.join(root,page+'.html'),'utf8');assert(!html.includes('class="pshot"'));
  const assets=[...html.matchAll(/assets\/shots\/([a-z-]+\.webp)/g)].map(m=>m[1]);
  for(const theme of themes){const unique=[...new Set(assets.filter(f=>f.startsWith(theme+'-')&&!f.endsWith('-1x.webp')))];const bytes=unique.reduce((n,f)=>n+fs.statSync(path.join(root,'assets/shots',f)).size,0);assert(bytes<1500000,page+' '+theme+' images exceed1.5MB');}
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,b=await chromium.launch();let checks=0;
 try{for(const width of widths)for(const theme of themes)for(const dpr of dprs){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme,deviceScaleFactor:dpr,reducedMotion:'reduce',serviceWorkers:'block'});
  try{let version='fictional-a',offline=false,imageFail=false,failedImages=0;await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())||u.origin!==base&&!['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();if(imageFail&&u.pathname.includes('/shots/')&&u.searchParams.get('capture')==='fictional-c'){failedImages++;return r.abort();}if(u.pathname.endsWith('/manifest.json'))return offline?r.abort():r.fulfill({json:{generated_at:version}});return r.continue();});
   for(const name of pages){
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+name+'.html');await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>document.querySelectorAll('img[src*="assets/shots/"]').forEach(i=>i.loading='eager'));
    const height=await p.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<height;y+=800){await p.evaluate(y=>scrollTo(0,y),y);await p.waitForTimeout(10);}await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"]')].every(i=>i.complete&&i.naturalWidth));
    const frames=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(i=>{const r=i.getBoundingClientRect(),f=i.closest('.frame,.phone').getBoundingClientRect();return{src:i.currentSrc,width:r.width,height:r.height,left:r.left,top:r.top,bottom:r.bottom,frameTop:f.top,frameBottom:f.bottom};}));
    assert(frames.length);assert(frames.every(i=>new URL(i.src).pathname.includes('/'+theme+'-')&&new URL(i.src).pathname.endsWith(dpr===1?'-1x.webp':'.webp')&&(dpr===1||!new URL(i.src).pathname.endsWith('-1x.webp'))));
    assert(frames.every(i=>Math.abs(i.height/i.width-1704/786)<.01&&i.top>=i.frameTop&&i.bottom<=i.frameBottom));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(width===1280){const minFrame=name==='index'?200:250;assert(frames.every(i=>i.width>=minFrame&&i.width<=320));}
    if(width===390){for(const controls of await p.locator('.gallery-position').all()){
     if(!await controls.isVisible())continue;
     const position=async index=>controls.evaluate((el,i)=>{const row=el.previousElementSibling,slides=[...row.children].filter(e=>e.matches('.frame')||e.querySelector('.frame')),image=slides[i].querySelector('img'),r=image.getBoundingClientRect();return{left:r.left,right:r.right,count:el.querySelector('span').textContent};},index);
     let initial=await position(0);assert.match(initial.count,/^1 of /);assert(initial.left>=0&&initial.right<=390,'First whole phone must be visible, including four-screen galleries');
     await controls.getByRole('button',{name:'Next screenshot'}).click();for(let n=0;n<100&&!(await position(1)).count.startsWith('2 of ');n++)await p.waitForTimeout(20);const next=await position(1);assert.match(next.count,/^2 of /);assert(next.left>=0&&next.right<=390,'Next must align one whole phone');
     await controls.getByRole('button',{name:'Previous screenshot'}).click();for(let n=0;n<100&&!(await position(0)).count.startsWith('1 of ');n++)await p.waitForTimeout(20);assert.match((await position(0)).count,/^1 of /);
    }}
    await p.evaluate(()=>scrollTo(0,0));
    const image=p.locator('.phone img,.frame img').first();await image.focus();await p.keyboard.press('Enter');await p.locator('dialog.zoom').waitFor({state:'visible'});await until(p,()=>document.querySelector('dialog.zoom .slide img')?.naturalWidth===786);assert(!new URL(await p.locator('dialog.zoom .slide img').first().getAttribute('src')).pathname.endsWith('-1x.webp'));await p.keyboard.press('Escape');assert(await image.evaluate(i=>document.activeElement===i));
    if(name==='index'){
     const order=await p.locator('main > section').evaluateAll(xs=>xs.map(x=>x.classList.contains('home-hero')?'hero':x.classList.contains('home-core')?'core':x.classList.contains('home-disciplines')?'disciplines':x.classList.contains('home-more')?'more':x.classList.contains('home-trust')?'trust':x.classList.contains('home-final')?'beta':'unexpected'));
     assert.deepEqual(order,['hero','core','disciplines','more','trust','beta']);assert.deepEqual(await p.locator('.home-core-grid h3').allInnerTexts(),['Record','Food','Friends']);assert.equal(await p.locator('a.btn').count(),3);
     const nav=await p.locator('nav[aria-label=\"Primary\"] a').allInnerTexts();assert.deepEqual(nav,['Home','Features','Guide','Download']);
     const homeLink=p.locator('nav[aria-label=\"Primary\"] a[aria-current=\"page\"]');assert.equal(await homeLink.innerText(),'Home');const active=await homeLink.evaluate(a=>({weight:getComputedStyle(a).fontWeight,background:getComputedStyle(a).backgroundColor,underline:getComputedStyle(a,'::after').height}));assert.equal(active.weight,'700');assert.equal(active.underline,'2px');assert.equal(active.background,'rgba(0, 0, 0, 0)');
     const core=await p.locator('.home-core-grid').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,columns:getComputedStyle(e).gridTemplateColumns}));assert.equal(core.client,core.scroll);if(width<=560)assert.equal(core.columns.split(' ').length,1);
     assert.deepEqual(await p.locator('.home-trust li').allInnerTexts(),['Choose who sees your workouts','Export your data.','No ads.']);
     assert.equal(await p.locator('.home-trust li a').getAttribute('href'),'privacy');
     const trust=await p.locator('.home-trust').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,items:[...e.querySelectorAll('li')].map(x=>{const r=x.getBoundingClientRect();return{top:Math.round(r.top),bottom:Math.round(r.bottom)}}),scroll:e.scrollWidth,client:e.clientWidth}));
     const bodyColor=await p.locator('body').evaluate(e=>getComputedStyle(e).color);assert.equal(trust.background,'rgba(0, 0, 0, 0)');assert.equal(trust.color,bodyColor);
     assert.equal(trust.scroll,trust.client);if(width>560)assert.equal(new Set(trust.items.map(x=>x.top)).size,1,'Trust row should stay on one line when desktop width allows');
     const record=p.locator('.home-core-grid article').first().locator('picture');assert.match(await record.locator('img').getAttribute('alt'),/completed run.*route map.*pace/i);assert.match(await record.locator('img').getAttribute('srcset'),/light-activity-1x\.webp 1x, assets\/shots\/light-activity\.webp 2x/);assert.match(await record.locator('source').getAttribute('srcset'),/dark-activity-1x\.webp 1x, assets\/shots\/dark-activity\.webp 2x/);
     const mainWords=await p.locator('main').innerText().then(t=>t.trim().split(/\s+/).filter(Boolean).length);assert(mainWords<=170,'Home main copy exceeds ~150 words: '+mainWords);console.log('Home main words='+mainWords+'; CTAs=3; trust=sharing/export/no-ads');
     version='fictional-b';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"],source[srcset*="assets/shots/"]')].every(e=>(!e.hasAttribute('src')||e.getAttribute('src').includes('fictional-b'))&&e.getAttribute('srcset').split(',').every(s=>/capture=fictional-b/.test(s)&&/ [12]x$/.test(s))));
     const before=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset')));
     imageFail=true;version='fictional-c';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));for(let n=0;n<100&&!failedImages;n++)await p.waitForTimeout(20);assert(failedImages);await p.waitForTimeout(100);assert.deepEqual(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset'))),before);assert(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
     imageFail=false;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"]')].every(e=>e.getAttribute('srcset').includes('fictional-c')));
     const recovered=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset')));offline=true;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(80);assert.deepEqual(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset'))),recovered);offline=false;
    }
    assert.deepEqual(errors,[]);checks++;await p.close();
   }
  }finally{await c.close();}
 }console.log('Website screen checks: '+checks+' selected page/size/theme/density cases PASS; complete frames, candidate refresh/offline, zoom/focus and visible swipe position');
 }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
