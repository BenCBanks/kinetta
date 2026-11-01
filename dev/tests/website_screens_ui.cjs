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
(async()=>{
 for(const page of ['index','training','food','friends','compare','guide','privacy']){
  const html=fs.readFileSync(path.join(root,page+'.html'),'utf8');assert(!html.includes('class="pshot"'));
  const assets=[...html.matchAll(/assets\/shots\/([a-z-]+\.webp)/g)].map(m=>m[1]);
  for(const theme of ['light','dark']){const unique=[...new Set(assets.filter(f=>f.startsWith(theme+'-')&&!f.endsWith('-1x.webp')))];const bytes=unique.reduce((n,f)=>n+fs.statSync(path.join(root,'assets/shots',f)).size,0);assert(bytes<1500000,page+' '+theme+' images exceed1.5MB');}
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,b=await chromium.launch();let checks=0;
 try{for(const width of [1280,390])for(const theme of ['light','dark'])for(const dpr of [1,2]){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme,deviceScaleFactor:dpr,reducedMotion:'reduce',serviceWorkers:'block'});
  try{let version='fictional-a',offline=false,imageFail=false,failedImages=0;await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())||u.origin!==base&&!['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();if(imageFail&&u.pathname.includes('/shots/')&&u.searchParams.get('capture')==='fictional-c'){failedImages++;return r.abort();}if(u.pathname.endsWith('/manifest.json'))return offline?r.abort():r.fulfill({json:{generated_at:version}});return r.continue();});
   for(const name of ['index','training','food','friends']){
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+name+'.html');await p.evaluate(()=>document.fonts.ready);
    const height=await p.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<height;y+=800){await p.evaluate(y=>scrollTo(0,y),y);await p.waitForTimeout(10);}await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"]')].every(i=>i.complete&&i.naturalWidth));
    const frames=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(i=>{const r=i.getBoundingClientRect(),f=i.closest('.frame,.phone').getBoundingClientRect();return{src:i.currentSrc,width:r.width,height:r.height,left:r.left,top:r.top,bottom:r.bottom,frameTop:f.top,frameBottom:f.bottom};}));
    assert(frames.length);assert(frames.every(i=>new URL(i.src).pathname.includes('/'+theme+'-')&&new URL(i.src).pathname.endsWith(dpr===1?'-1x.webp':'.webp')&&(dpr===1||!new URL(i.src).pathname.endsWith('-1x.webp'))));
    assert(frames.every(i=>Math.abs(i.height/i.width-1704/786)<.01&&i.top>=i.frameTop&&i.bottom<=i.frameBottom));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(width===1280)assert(frames.every(i=>i.width>=250&&i.width<=320));
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
     const controls=p.locator('.points .gallery-position');if(width===390){assert(await controls.isVisible());assert.equal(await controls.locator('span').innerText(),'1 of 3');await controls.getByRole('button',{name:'Next screenshot'}).click();await until(p,()=>document.querySelector('.points .gallery-position span').textContent==='2 of 3');}else assert.equal(await controls.isVisible(),false);
     version='fictional-b';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"],source[srcset*="assets/shots/"]')].every(e=>(!e.hasAttribute('src')||e.getAttribute('src').includes('fictional-b'))&&e.getAttribute('srcset').split(',').every(s=>/capture=fictional-b/.test(s)&&/ [12]x$/.test(s))));
     const before=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset')));
     imageFail=true;version='fictional-c';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));for(let n=0;n<100&&!failedImages;n++)await p.waitForTimeout(20);assert(failedImages);await p.waitForTimeout(100);assert.deepEqual(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset'))),before);assert(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
     imageFail=false;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await until(p,()=>[...document.querySelectorAll('img[src*="assets/shots/"]')].every(e=>e.getAttribute('srcset').includes('fictional-c')));
     const recovered=await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset')));offline=true;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(80);assert.deepEqual(await p.locator('img[src*="assets/shots/"]').evaluateAll(xs=>xs.map(x=>x.getAttribute('srcset'))),recovered);offline=false;
    }
    assert.deepEqual(errors,[]);checks++;await p.close();
   }
  }finally{await c.close();}
 }console.log('Website whole screens: '+checks+' page/size/theme/density cases PASS; complete frames, candidate refresh/offline, zoom/focus and visible swipe position');
 }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
