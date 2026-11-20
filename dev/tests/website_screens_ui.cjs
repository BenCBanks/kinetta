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
    assert.deepEqual(await p.locator('nav[aria-label="Primary"] a').allInnerTexts(),name==='index'?['Features','Sign in']:['Home','Features','iPhone beta']);
    // Every tour picture is a complete, themed crop shown at no more than its natural width.
    const pics=await p.locator('main img[src*="assets/tour/"]').evaluateAll(xs=>xs.map(i=>({src:i.currentSrc,w:i.getBoundingClientRect().width,natural:i.naturalWidth/2,alt:i.alt})));
    assert(pics.every(i=>i.alt.length>20&&i.w<=i.natural*2/1.7+1&&i.src.includes(theme==='dark'?'-dark.':'-light.')),name+' tour picture theme, alt or upscaling');
    if(name==='index'){
     assert.equal(await p.locator('.home-hero .phone-frame').count(),1);
     assert.equal(await p.locator('.home-hero .btn').count(),1,'Home has one primary hero action');
     assert.equal(await p.locator('.home-beta-link').count(),1,'The beta link is secondary text');
     assert.equal(await p.locator('.home-jumps').count(),0,'The hero has no feature-chip row');
     assert.match(await p.locator('.home-hero h1').innerText(),/What you eat\. How you train\. One picture\./);
     assert.deepEqual(await p.locator('.home-proof-card').count(),2,'Home pairs Nutrition and Activity proof screens');
     assert.equal(await p.locator('.home-story').count(),0,'The oversized scroll story is removed');
     const nutrition=await p.locator('#home-food img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(nutrition.src.includes(`${theme}-nutrition-filled`));assert.match(nutrition.alt,/Fictional Nutrition day/);assert(nutrition.loaded,'filled Nutrition screenshot is loaded');
     const activity=await p.locator('#home-activity img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(activity.src.includes(`${theme}-activity-detail`));assert.match(activity.alt,/Fictional Activity detail/);assert(activity.loaded,'Activity map screenshot is loaded');
     const foodChat=await p.locator('.home-kit-chat img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(foodChat.src.includes(`${theme}-kit-food-chat`));assert.match(foodChat.alt,/Fictional Kit food review/);assert(foodChat.loaded,'Kit food chat screen is loaded inside its phone');
     assert.equal(await p.locator('[data-kit-replay]').count(),0,'Kit food chat is in the phone, not a detached replay card');
     assert.equal(await p.locator('.kit-week-demo').count(),1,'Home shows the Kit week insight section');
     assert.equal(await p.locator('[data-week-question]').innerText(),'Am I improving?');
     assert.equal(await p.locator('.home-kit-prompts li').count(),2,'Kit provides three one-line example questions including the replay question');
     assert.equal(await p.locator('.home-badges img').count(),1,'The badge explainer uses a real Achievements screen');
     const challengeCopy=(await p.locator('.home-challenges').innerText()).replace(/\s+/g,' ').trim();
     assert.match(challengeCopy,/distance, active days, activities, food logging days or protein goal days/i,'Home names the challenge goal types');
     assert.match(challengeCopy,/Joining is optional and never sends a friend request/,'challenge joining is clearly optional and does not imply a friend request');
     assert.match(challengeCopy,/not your food details or protein target/,'food details and protein targets remain private');
     assert.doesNotMatch(challengeCopy,/private by default|free during beta/i);
     assert.equal(await p.locator('.home-challenges-visuals figure').count(),2,'Challenges has one start sheet and one detail preview');
     for(const [selector,asset,alt] of [['.home-challenge-preview--start img',`challenge-start-${theme}`,/Start a challenge sheet.*Distance.*Active days.*Activities.*Food logging days.*Protein goal days/],['.home-challenge-preview--detail img',`challenge-detail-${theme}`,/challenge detail.*progress ring.*three participant totals/i]]){
      const image=await p.locator(selector).evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
      assert(image.src.includes(`assets/tour/${asset}.webp`),`${asset} uses the ${theme} capture`);assert.match(image.alt,alt);assert(image.loaded,`${asset} loaded`);
     }
     if(process.env.KINETTA_WEBSITE_SHOT_DIR&&dpr===1){fs.mkdirSync(process.env.KINETTA_WEBSITE_SHOT_DIR,{recursive:true});await p.locator('[data-site-nav],.skip-link').evaluateAll(nodes=>nodes.forEach(el=>el.style.visibility='hidden'));await p.locator('.home-challenges').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`challenges-${width}-${theme}.png`),animations:'disabled'});}
     assert.equal(await p.locator('.home-sharing .phone-frame').count(),0,'Sharing stays text-only');
     assert.equal(await p.locator('.tour-final .btn').count(),1,'Home ends with one clear account action');
     const heroImage=await p.locator('.home-hero img').evaluate(i=>({src:i.currentSrc,alt:i.alt}));
     assert(heroImage.src.includes(`home-tab-${theme}`),`Home hero uses the ${theme} real Home app capture`);
     assert.match(heroImage.alt,/Fictional Home feed.*completed 3-mile Morning Run.*route map and reactions/i);
     assert.equal(await p.locator('.standin-caption').count(),0,'Home hero has no composed-screen stand-in label');
     const header=await p.locator('[data-site-nav]').boundingBox();assert(header&&Math.abs(header.height-56)<=1,'Home keeps a one-row header');
     // The Challenges section includes two full app views in addition to the existing Home proof screens.
     const pageHeight=await p.evaluate(()=>document.documentElement.scrollHeight);if(width===390)assert(pageHeight<=5900,`Home stays below the mobile page-height ceiling with both challenge previews: ${pageHeight}px`);
     const phone=await p.locator('.home-hero .phone-frame').boundingBox();assert(phone&&phone.width<=320&&phone.x>=0&&phone.x+phone.width<=width,'Home hero phone stays fully in view');
     const targets=await p.locator('.home-page header nav a,.home-hero .btn,.home-hero .home-beta-link').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height};}));
     assert(targets.every(r=>r.w>=44&&r.h>=44),`Home header and hero actions keep 44px hit areas: ${JSON.stringify(targets)}`);
     const replay=await p.locator('[data-week-replay]').boundingBox();assert(replay&&replay.width>=44&&replay.height>=44,'Kit week replay remains a 44px target');
     await p.locator('[data-week-replay]').click();await until(p,()=>document.querySelector('[data-week-answer]')?.textContent?.length>40);
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
