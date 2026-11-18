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
     // Home keeps one complete app screen in the hero and supplies a real Kit insight replay.
     assert.equal(await p.locator('.home-hero .phone-frame').count(),1);
     assert.equal(await p.locator('.home-hero .btn').count(),2);
     assert.equal(await p.locator('.home-hero .tour-access a').count(),2);
     assert.deepEqual(await p.locator('.home-jumps a').allInnerTexts(),['Feed','Activity','Food','Progress','Achievements']);
     assert.equal(await p.locator('.home-story [data-screen]').count(),5);
     assert.match(await p.locator('.home-hero h1').innerText(),/Track workouts\. Log food\. See progress\./);
     assert.equal(await p.locator('.progress-demo').count(),0,'The old interactive Progress demo is gone');
     assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/href="#kit-week-demo"[^>]*>Progress</,'Progress jump now targets the Kit week section');
     assert.equal(await p.locator('.kit-week-demo').count(),1,'Home shows the Kit week insight section');
     assert.match(await p.locator('.kit-week-demo h2').innerText(),/Ask Kit about your week/);
     assert.equal((await p.locator('[data-week-question]').innerText()).trim(),'How did my week go?');
     assert.match((await p.locator('[data-week-answer]').innerText()).trim(),/latest run total is below your recent average/);
     assert.match((await p.locator('.kit-week-demo').innerText()),/scripted stand-in|sample response/i);
     const insight=await p.locator('.kit-week-visual img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(insight.src.includes(`${theme}-kit-insight-progress`),`Kit week section uses the real ${theme} insight image`);
     assert.match(insight.alt,/Fictional Kit insight/);assert(insight.loaded,'Kit insight screenshot is loaded');
     assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/data-story-screen[^>]*loading="eager"/,'Pinned story image is eager so it is ready before the sticky story begins');
     assert.equal(await p.locator('.story-step .step-phone').count(),5,'Each Home story step has its own phone fallback');
     if(width>900){
      const active=p.locator('.story-step').first();await active.scrollIntoViewIfNeeded();
      const firstPhone=await active.locator('.step-phone').evaluate(el=>getComputedStyle(el).display);
      assert.notEqual(firstPhone,'none','Reduced-motion mode uses per-step phones at desktop width');
      await p.evaluate(()=>scrollTo(0,0));
     }
     assert.equal(await p.locator('[data-kit-replay]').count(),1,'Kit chat can be replayed');
     assert.equal(await p.locator('.home-achievement-tracks').count(),1,'Home explains the Run achievement tracks in its current text-led story');
     assert.equal((await p.locator('.home-achievement-tracks').innerText()).trim(),'Run tracks include distance, workouts, longest and fastest efforts.');
     const heroImage=await p.locator('.home-hero img').evaluate(i=>({src:i.currentSrc,alt:i.alt,srcset:i.getAttribute('srcset')}));
     assert(heroImage.src.includes(`${theme}-feed`),`Home hero uses the ${theme} feed (${heroImage.src})`);
     assert.match(heroImage.alt,/fictional Kinetta Home feed/i);
     assert.match(heroImage.srcset,/feed-1x\.webp(?:\?[^ ]*)? 1x,.*feed\.webp(?:\?[^ ]*)? 2x/);
     const header=await p.locator('[data-site-nav]').boundingBox();assert(header&&Math.abs(header.height-56)<=1,'Home keeps a one-row 56px header');
     const phone=await p.locator('.home-hero .phone-frame').boundingBox();assert(phone&&phone.width<=320&&phone.x>=0&&phone.x+phone.width<=width,'Home hero phone stays fully in view');
     const targets=await p.locator('.home-page header nav a,.home-hero .btn,.home-hero .tour-access a').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height};}));
     assert(targets.every(r=>r.w>=44&&r.h>=44),`Home header and hero actions keep 44px hit areas: ${JSON.stringify(targets)}`);
     const replay=await p.locator('[data-week-replay]').boundingBox();assert(replay&&replay.width>=44&&replay.height>=44,'Kit week replay remains a 44px target');
     await p.locator('[data-week-replay]').click();await until(p,()=>document.querySelector('[data-week-answer]')?.textContent?.length>40);
     if(width>900){
      const noJs=await c.newPage();await noJs.route('**/assets/home.js*',route=>route.abort());await noJs.goto(base+'/index.html');
      const fallback=await noJs.locator('.story-step').evaluateAll(nodes=>nodes.map(n=>({display:getComputedStyle(n.querySelector('.step-phone')).display,opacity:getComputedStyle(n).opacity})));
      assert.equal(fallback.length,5);assert(fallback.every(item=>item.display!=='none'&&item.opacity==='1'),'Per-step phones and story text remain visible without JavaScript');await noJs.close();
      const noSticky=await c.newPage();await noSticky.emulateMedia({reducedMotion:'no-preference'});await noSticky.addInitScript(()=>{const original=CSS.supports.bind(CSS);CSS.supports=(...args)=>args[0]==='position'&&args[1]==='sticky'?false:original(...args);});
      await noSticky.goto(base+'/index.html');await noSticky.waitForFunction(()=>document.body.dataset.storyMode==='fallback');
      const failedSticky=await noSticky.locator('.story-step').evaluateAll(nodes=>nodes.map(n=>({display:getComputedStyle(n.querySelector('.step-phone')).display,opacity:getComputedStyle(n).opacity})));
      assert.equal(failedSticky.length,5);assert(failedSticky.every(item=>item.display!=='none'&&item.opacity==='1'),'Per-step phones and story text replace the pinned phone if sticky is unsupported');await noSticky.close();
      const pinned=await c.newPage();await pinned.emulateMedia({reducedMotion:'no-preference'});await pinned.goto(base+'/index.html');await pinned.waitForFunction(()=>document.body.dataset.storyMode==='pinned');
      for(const [step,shot] of [['progress','progress'],['achievements','achievements']]){
       await pinned.locator(`#story-${step}`).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
       await pinned.waitForFunction(expected=>document.body.dataset.story===expected,step);
       await pinned.waitForFunction(expected=>{const i=document.querySelector('[data-story-screen]');return i?.currentSrc?.includes(expected)&&i.complete&&i.naturalWidth>0;},`${theme}-${shot}`);
       const pin=await pinned.locator('.story-pin').boundingBox();assert(pin&&pin.y<900&&pin.y+pin.height>0,`Desktop pinned phone remains in the viewport for ${step}`);
       await pinned.waitForTimeout(250);assert.equal(await pinned.locator('body').getAttribute('data-story-mode'),'pinned',`Desktop keeps the pinned layout while ${step} image finishes loading`);
      }
      await pinned.close();
     }
    }
    if(name==='food'){
     assert.equal(await p.locator('.food-story .story-steps > h2').count(),0,'Food has one page heading, not a second stacked story heading');
     assert.equal(await p.locator('[data-food-screen="day"]').count(),1,'The whole-day step uses the Nutrition day screen');
     await p.goto(base+'/food.html#food-hero-title');await p.evaluate(()=>document.fonts.ready);
     const headingOffset=await p.evaluate(()=>{const h=document.querySelector('#food-hero-title'),e=h?.previousElementSibling,n=document.querySelector('header.top');return{eyebrowTop:e?.getBoundingClientRect().top,navBottom:n?.getBoundingClientRect().bottom,scrollMargin:getComputedStyle(h).scrollMarginTop};});
     assert(headingOffset.eyebrowTop>=headingOffset.navBottom,`Food hero eyebrow clears sticky nav at ${width}px (${headingOffset.eyebrowTop}px vs ${headingOffset.navBottom}px)`);
     assert.equal(headingOffset.scrollMargin,'40px','Food hero heading adds enough scroll margin to keep its eyebrow visible');
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
     const featureShots={training:'activity',food:'food',friends:'friends',progress:'progress',kit:'kit-food-chat'};
     for(const [tab,shot] of Object.entries(featureShots)){
      await p.locator(`[data-feature-tab="${tab}"]`).click();
      await p.waitForFunction(expected=>{const i=document.querySelector('[data-feature-screen]');return i?.getAttribute('src')?.includes(expected+'.webp')&&i.complete&&i.naturalWidth>0;},`${theme}-${shot}`);
      const image=await p.locator('[data-feature-screen]').evaluate(i=>({src:i.getAttribute('src'),complete:i.complete&&i.naturalWidth>0}));
      assert.match(image.src,new RegExp(`${theme}-${shot}\\.webp$`),`Features ${tab} tab maps to the ${theme} ${shot} screenshot`);
      assert(image.complete,`Features ${tab} screenshot loaded`);
     }
     assert.match(await p.locator('[data-feature-capabilities]').innerText(),/You choose what to share/,'Kit copy uses accurate sharing language');
     const words=await p.locator('main').innerText().then(t=>t.trim().split(/\s+/).length);assert(words<=260,name+' copy grew to '+words+' words');
    }
    if(name==='compare'){
     assert.equal(await p.locator('.feature-reference tbody tr').count(),8);
     if(width===390&&theme==='light'&&dpr===1){const old=await c.newPage();await old.goto(base+'/guide');await old.waitForURL(url=>new URL(url).pathname==='/compare');assert.equal(await old.locator('h1').first().innerText(),'Every run, mapped and measured.');await old.close();}
    }
    assert.deepEqual(errors,[]);checks++;await p.close();
   }
  }finally{await c.close();}
 }console.log('Website tour checks: '+checks+' selected page/size/theme/density cases PASS; themed crops, alt text, image scale, overflow and navigation labels');
 }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
