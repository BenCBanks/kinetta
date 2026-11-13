'use strict';
// Fictional website tour crops; all external writes blocked, no app accounts or providers.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../site');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';if(!path.extname(name))name+='.html';
 let file=path.resolve(root,'.'+name),status=200;if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}if(!fs.existsSync(file)){file=path.join(root,'404.html');status=404;}
 res.writeHead(status,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
});
const until=async(p,fn)=>{for(let n=0;n<100;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(30);}throw Error('Website state did not settle');};
// Home, Training, Food, Friends and Features use complete cropped controls.
const tourPages=(process.env.KINETTA_WEBSITE_TOUR_PAGES||'index,training,food,friends,compare').split(',').filter(Boolean);
const widths=(process.env.KINETTA_WEBSITE_WIDTHS||'1280,390').split(',').map(Number);
const themes=(process.env.KINETTA_WEBSITE_THEMES||'light,dark').split(',');
const dprs=(process.env.KINETTA_WEBSITE_DPRS||'1,2').split(',').map(Number);
(async()=>{
 for(const page of ['index','training','food','friends','compare','privacy']){
  const html=fs.readFileSync(path.join(root,page+'.html'),'utf8');assert(!html.includes('class="pshot"'));
  const assets=[...html.matchAll(/assets\/shots\/([a-z-]+\.webp)/g)].map(m=>m[1]);
  for(const theme of themes){const unique=[...new Set(assets.filter(f=>f.startsWith(theme+'-')&&!f.endsWith('-1x.webp')))];const bytes=unique.reduce((n,f)=>n+fs.statSync(path.join(root,'assets/shots',f)).size,0);assert(bytes<1500000,page+' '+theme+' images exceed1.5MB');}
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,b=await chromium.launch();let checks=0;
  try{for(const width of widths)for(const theme of themes)for(const dpr of dprs){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme,deviceScaleFactor:dpr,reducedMotion:'reduce',serviceWorkers:'block'});
  try{await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())||u.origin!==base&&!['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();return r.continue();});
   for(const name of tourPages){
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+name+'.html');await p.evaluate(()=>document.fonts.ready);
    await p.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'));await until(p,()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' scrolls sideways');
    assert.deepEqual(await p.locator('nav[aria-label="Primary"] a').allInnerTexts(),['Home','Features','iPhone beta']);
    // Every tour picture is a complete, themed crop shown at no more than its natural width.
    const pics=await p.locator('main img[src*="assets/tour/"]').evaluateAll(xs=>xs.map(i=>({src:i.currentSrc,w:i.getBoundingClientRect().width,natural:i.naturalWidth/2,alt:i.alt})));
    assert(pics.every(i=>i.alt.length>20&&i.w<=i.natural*2/1.7+1&&i.src.includes(theme==='dark'?'-dark.':'-light.')),name+' tour picture theme, alt or upscaling');
    if(name==='index'){
     // Home is the pinned-phone story: keep its jump sections and reserved Progress mount present.
     assert.equal(await p.locator('.home-story').count(),1);assert.equal(await p.locator('.story-step').count(),5);
     assert.equal(await p.locator('[data-progress-demo-mount]').count(),1);
     assert.equal(await p.locator('.story-pin-label').count(),0);
    }
    if(name==='food'){
     assert.equal(await p.locator('.food-story .story-steps > h2').count(),0,'Food has one page heading, not a second stacked story heading');
     assert.equal(await p.locator('[data-food-screen="day"]').count(),1,'The whole-day step uses the Nutrition day screen');
     if(width>900){
      await p.emulateMedia({reducedMotion:'no-preference'});
      const pin=p.locator('[data-food-pinned-image]');
      for(const [step,shot] of [['day','food'],['meals','meals']]){
       await p.locator(`[data-food-screen="${step}"]`).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
       await p.waitForFunction(expected=>document.querySelector('[data-food-pinned-image]')?.getAttribute('src')?.includes(expected+'.webp'),shot);
       const frame=await p.locator('.food-story .story-pin .phone-frame').boundingBox();
       assert(frame&&frame.y>=0&&frame.y+frame.height<=900,`Food ${step} phone stays fully visible in the desktop viewport`);
      }
      assert((await pin.getAttribute('src')).includes('meals.webp'),'Recipes step shows the saved-recipes screen');
     }
    }
    if(name==='compare'){
     // Features is a large framed phone with five selectable areas and concrete copy.
     assert.deepEqual(await p.locator('[data-feature-tab]').allInnerTexts(),['Training','Food','Friends','Progress','Kit']);
     assert.equal(await p.locator('[data-feature-tab][aria-selected="true"]').innerText(),'Training');
     assert.equal(await p.locator('[data-feature-capabilities] li').count(),3,'Features starts with three concrete Training capabilities');
     assert.equal(await p.locator('[data-feature-headline]').innerText(),'Every run, mapped and measured.');
     assert.match(await p.locator('[data-feature-link]').innerText(),/^Explore Training/);
     assert(Number(await p.locator('.feature-tabs').evaluate(node=>parseFloat(getComputedStyle(node).getPropertyValue('--feature-pill-width'))))>=44,'the active tab has a filled pill width');
     if(width>=900){const phone=await p.locator('.feature-phone').boundingBox();assert(phone&&phone.width>=360,'desktop Features uses an Apple-scale phone');}
     const screenShape=await p.locator('[data-feature-screen]').evaluate(node=>{const r=node.getBoundingClientRect();return r.height/r.width;});assert(screenShape<2,'the Features screen ends above the app navigation artifacts');
     assert.match(await p.locator('[data-feature-screen]').getAttribute('src'),/activity\.webp/);
     await p.locator('[data-feature-tab="food"]').click();
     assert.match(await p.locator('[data-feature-screen]').getAttribute('src'),/food\.webp/);
     assert.match(await p.locator('[data-feature-screen]').getAttribute('alt'),/Food screen/);
     assert.equal(await p.locator('[data-feature-headline]').innerText(),'Food that fits your day.');
     assert.equal(await p.locator('[data-feature-capabilities] li').count(),3);
     assert.match(await p.locator('[data-feature-link]').innerText(),/^Explore Food/);
     const words=await p.locator('main').innerText().then(t=>t.trim().split(/\s+/).length);assert(words<=260,name+' copy grew to '+words+' words');
    }
    if(name==='compare'){
     assert.equal(await p.locator('.feature-reference tbody tr').count(),8);
     if(width===390&&theme==='light'&&dpr===1){const old=await c.newPage();await old.goto(base+'/guide');await old.waitForURL(url=>new URL(url).pathname==='/compare');assert.equal(await old.locator('h1').first().innerText(),'What Kinetta does.');await old.close();}
    }
    assert.deepEqual(errors,[]);checks++;await p.close();
   }
  }finally{await c.close();}
 }console.log('Website tour checks: '+checks+' selected page/size/theme/density cases PASS; themed crops, alt text, image scale, overflow and navigation labels');
 }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
