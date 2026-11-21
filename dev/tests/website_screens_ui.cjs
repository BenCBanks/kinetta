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
  const assets=[...html.matchAll(/assets\/shots\/([a-z0-9-]+\.webp)/g)].map(m=>m[1]);
  for(const theme of themes){const unique=[...new Set(assets.filter(f=>(f.startsWith(theme+'-')||f.includes(`-${theme}-`))&&!f.endsWith('-1x.webp')))];const bytes=unique.reduce((n,f)=>n+fs.statSync(path.join(root,'assets/shots',f)).size,0);assert(bytes<1500000,page+' '+theme+' images exceed1.5MB');}
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
     const homeOrder=await p.locator('main > section').evaluateAll(nodes=>nodes.map(n=>n.classList.contains('home-hero')?'hero':n.classList.contains('home-challenges')?'challenges':n.classList.contains('home-proof')?'food-and-activity':n.classList.contains('home-badges')?'achievements':'other'));
     assert.deepEqual(homeOrder.slice(0,3),['hero','challenges','food-and-activity'],'Challenges is the second Home hero, before Food and Achievements');
     assert.equal(await p.locator('main > .home-challenges').count(),1,'Challenges appears once on Home');
     assert(homeOrder.indexOf('achievements')>homeOrder.indexOf('food-and-activity'),'Achievements follows the Food section');
     assert.equal(await p.locator('#home-challenges-title').innerText(),"A shared goal. Everyone's progress.");
     const challengeTitle=await p.locator('#home-challenges-title').evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),left:el.getBoundingClientRect().left}));
     assert(challengeTitle.size>=36&&challengeTitle.size<=40,`${width}px Challenges heading stays 36–40px: ${JSON.stringify(challengeTitle)}`);
     if(width===390)assert.equal(Math.round(challengeTitle.left),20,'Challenges keeps 20px phone gutters');
     const challengeSpacing=await p.locator('.home-hero,.home-challenges,.home-proof').evaluateAll(([hero,challenges,food])=>({heroBottom:getComputedStyle(hero).paddingBottom,challengeTop:getComputedStyle(challenges).paddingTop,foodTop:getComputedStyle(food).paddingTop}));
     assert.equal(challengeSpacing.heroBottom,'0px','hero and Challenges use one shared section gap');
     assert(parseFloat(challengeSpacing.challengeTop)>=56&&parseFloat(challengeSpacing.challengeTop)<=64,`Challenges has 56–64px top spacing: ${JSON.stringify(challengeSpacing)}`);
     assert(parseFloat(challengeSpacing.foodTop)>=48&&parseFloat(challengeSpacing.foodTop)<=64,`Food follows Challenges with 48–64px spacing: ${JSON.stringify(challengeSpacing)}`);
     assert.equal(await p.locator('.home-hero .phone-frame').count(),1);
     assert.equal(await p.locator('.home-hero .btn').count(),1,'Home has one primary hero action');
     assert.equal(await p.locator('.home-beta-link').count(),1,'The beta link is secondary text');
     assert.equal(await p.locator('.home-jumps').count(),0,'The hero has no feature-chip row');
     assert.equal(await p.locator('.home-hero h1').innerText(),"Your meals, workouts and Kit's coaching, together.");
     assert.deepEqual(await p.locator('.home-proof-card').count(),2,'Home pairs Nutrition and Activity proof screens');
     assert.equal(await p.locator('.home-story').count(),0,'The oversized scroll story is removed');
     const nutrition=await p.locator('#home-food img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(nutrition.src.includes(`1319-kit-food-chat-${theme}`));assert.match(nutrition.alt,/Chicken sandwich and an apple for lunch.*two matched foods.*calorie estimate.*confirmed Lunch log/i);assert(nutrition.loaded,'captured Kit meal is loaded');
     assert.equal(await p.locator('#home-food h3').innerText(),'Log a meal in a sentence.');
     const mealFrame=await p.locator('#home-food .phone-frame').boundingBox();if(width===390)assert(mealFrame&&Math.round(mealFrame.width)===350&&mealFrame.height<=541,'390px meal crop shows the sentence, result and confirmation together');
     if(width===390){const nextCardLeft=await p.locator('#home-activity').evaluate(e=>e.getBoundingClientRect().left);assert(nextCardLeft>=width,`Food shows no clipped Activity text at the viewport edge (${nextCardLeft}px)`);}
     const activity=await p.locator('#home-activity img').evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
     assert(activity.src.includes(`${theme}-activity-detail`));assert.match(activity.alt,/Fictional Activity detail/);assert(activity.loaded,'Activity map screenshot is loaded');
     assert.equal(await p.locator('.home-kit-chat').count(),0,'The real Kit meal capture is not repeated in a second section');
     assert.equal(await p.locator('.kit-week-demo').count(),1,'Home shows the Kit week insight section');
     const kitPhone=p.locator('.phone-frame--kit-week');
     assert.equal(await kitPhone.locator('[data-week-question]').innerText(),'Am I improving?');
     assert.match(await kitPhone.locator('[data-week-answer]').innerText(),/10\.8 mi.*20\.6 mi average.*27\.9 mi/);
     assert.equal(await kitPhone.locator('[data-week-chart]').count(),1,'Kit insight chart lives inside the phone');
     assert.equal(await kitPhone.locator('.home-kit-prompts button').count(),2,'Example questions live inside the phone');
     assert.equal(await p.locator('.kit-week-demo > .wrap > .kit-week-copy .home-kit-prompts').count(),0,'No example questions sit outside the phone');
     assert.equal(await p.locator('[data-week-replay],.kit-week-demo-label,.kit-week-visual figcaption').count(),0,'No replay link or fictional sample captions remain');
     assert.equal(await kitPhone.locator('img').count(),0,'The scripted Kit demo is rendered as phone content, not website UI beside a screenshot');
     const exampleTarget=await kitPhone.locator('[data-week-example]').first().boundingBox();assert(exampleTarget&&exampleTarget.height>=44,'Kit example questions have 44px targets');
     const demoFit=await kitPhone.evaluate(frame=>{const screen=frame.querySelector('.kit-phone-screen'),content=frame.querySelector('.kit-phone-content');const r=content.getBoundingClientRect(),s=screen.getBoundingClientRect();return{bottom:r.bottom,screenBottom:s.bottom,scroll:content.scrollHeight,client:content.clientHeight};});
     assert(demoFit.bottom<=demoFit.screenBottom+1&&demoFit.scroll<=demoFit.client+1,`Kit demo content stays inside the phone screen: ${JSON.stringify(demoFit)}`);
     assert.equal(await p.locator('.home-badges img').count(),2,'Profile leads into the Achievements screen');
     const badgeExamples=await p.locator('.home-badges .home-badge-preview').evaluateAll(xs=>xs.map(x=>({caption:x.querySelector('figcaption')?.textContent.trim(),src:x.querySelector('img')?.currentSrc,width:x.querySelector('.phone-frame')?.getBoundingClientRect().width,loaded:x.querySelector('img')?.complete&&x.querySelector('img')?.naturalWidth>0})));
     assert.deepEqual(badgeExamples.map(x=>x.caption),['Open Achievements from your profile','Follow your progress in each sport.']);
     assert(badgeExamples[0].src.includes(`1319-profile-${theme}`)&&badgeExamples[0].loaded,'Profile capture uses Amber’s themed fictional Profile shot');
     assert(badgeExamples[1].src.includes(`${theme}-achievements`)&&badgeExamples[1].loaded,'existing themed Achievements capture remains');
     if(width===390){assert.equal(Math.round(badgeExamples[0].width),350,'Profile capture is 350px wide at 390px');assert(badgeExamples[1].width>=220&&badgeExamples[1].width<=240,'Achievements image stays 220–240px wide');}
     const challengeCopy=(await p.locator('.home-challenges').innerText()).replace(/\s+/g,' ').trim();
     assert.match(challengeCopy,/distance, active days, activities, food logging days or protein goal days/i,'Home names the challenge goal types');
     assert.doesNotMatch(challengeCopy,/never sends a friend request|not your food details|protein target/i,'Home has no defensive privacy disclaimer');
     assert.doesNotMatch(challengeCopy,/private by default|free during beta/i);
     const challengeOrder=await p.locator('.home-challenges-visuals figure').evaluateAll(nodes=>nodes.map(n=>({kind:n.classList.contains('home-challenge-preview--detail')?'progress':'create',caption:n.querySelector('figcaption')?.textContent.trim()})));
     assert.deepEqual(challengeOrder,[{kind:'progress',caption:"See everyone’s progress"},{kind:'create',caption:'Choose your challenge'}],'populated progress comes first and the creation sheet is labelled');
     assert.equal(challengeOrder.length,2,'Challenges has one progress image and one creation sheet');
     const attribution=p.locator('.home-challenges-attribution');assert.equal(await attribution.innerText(),'Fictional example members.');
     const attributionStyle=await attribution.evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,fontSize:parseFloat(s.fontSize)};});
     assert.equal(attributionStyle.background,'rgba(0, 0, 0, 0)','member attribution stays plain text without a box');assert.equal(attributionStyle.border,'0px');assert.equal(attributionStyle.shadow,'none');assert.equal(attributionStyle.fontSize,13);
     for(const [selector,asset,alt] of [['.home-challenge-preview--detail img',`challenge-detail-${theme}`,/Fictional challenge progress with a ring and participant totals/i],['.home-challenge-preview--start img',`challenge-start-${theme}`,/challenge creation sheet.*Distance.*Active days.*Activities.*Food logging days.*Protein goal days/i]]){
      const image=await p.locator(selector).evaluate(i=>({src:i.currentSrc,alt:i.alt,loaded:i.complete&&i.naturalWidth>0}));
      assert(image.src.includes(`assets/tour/${asset}.webp`),`${asset} uses the ${theme} capture`);assert.match(image.alt,alt);assert(image.loaded,`${asset} loaded`);
     }
     if(process.env.KINETTA_WEBSITE_SHOT_DIR&&dpr===1){
      fs.mkdirSync(process.env.KINETTA_WEBSITE_SHOT_DIR,{recursive:true});
       if(width===390)await p.screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`home-full-390-${theme}.png`),fullPage:true,animations:'disabled'});
      await p.locator('[data-site-nav],.skip-link').evaluateAll(nodes=>nodes.forEach(el=>el.style.visibility='hidden'));
       if(width===390){await p.locator('#home-food').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`food-390-${theme}.png`),animations:'disabled'});await p.locator('.home-badges').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`badges-390-${theme}.png`),animations:'disabled'});}
      await p.locator('.home-challenges').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`challenges-${width}-${theme}.png`),animations:'disabled'});
      if(width===390){await p.locator('.kit-week-demo').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`kit-demo-390-${theme}.png`),animations:'disabled'});await p.locator('.phone-frame--kit-week').screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`kit-phone-390-${theme}.png`),animations:'disabled'});}
     }
     assert.equal(await p.locator('.home-sharing .phone-frame').count(),0,'Sharing stays text-only');
     assert.equal(await p.locator('.tour-final .btn').count(),1,'Home ends with one clear account action');
     const heroImage=await p.locator('.home-hero img').evaluate(i=>({src:i.currentSrc,alt:i.alt}));
     assert(heroImage.src.includes(`1319-activity-detail-${theme}`),`Home hero uses the ${theme} real-map Activity capture`);
     assert.match(heroImage.alt,/Fictional Morning Run.*route through a city park.*streets and map attribution/i);
     assert.equal(await p.locator('.standin-caption').count(),0,'Home hero has no composed-screen stand-in label');
     const header=await p.locator('[data-site-nav]').boundingBox();assert(header&&Math.abs(header.height-56)<=1,'Home keeps a one-row header');
     // The Challenges section includes two full app views in addition to the existing Home proof screens.
     const pageHeight=await p.evaluate(()=>document.documentElement.scrollHeight);if(width===390)assert(pageHeight<=6500,`Home stays below the mobile page-height ceiling with full real Profile, Food, Achievements, challenge captures and attribution: ${pageHeight}px`);
     const phone=await p.locator('.home-hero .phone-frame').boundingBox();assert(phone&&phone.width<=320&&phone.x>=0&&phone.x+phone.width<=width,'Home hero phone stays fully in view');if(width===390)assert.equal(Math.round(phone.width),250,'real-map hero phone is about 250px wide at 390px');
     const targets=await p.locator('.home-page header nav a,.home-hero .btn,.home-hero .home-beta-link').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height};}));
     assert(targets.every(r=>r.w>=44&&r.h>=44),`Home header and hero actions keep 44px hit areas: ${JSON.stringify(targets)}`);
     await kitPhone.locator('[data-week-example]').first().click();
     assert.equal(await kitPhone.locator('[data-week-question]').innerText(),'How consistent was I?');
     assert.match(await kitPhone.locator('[data-week-answer]').innerText(),/4 of the last 6 weeks/,'In-phone example question plays its scripted answer');
     if(process.env.KINETTA_WEBSITE_SHOT_DIR&&dpr===1)await kitPhone.screenshot({path:path.join(process.env.KINETTA_WEBSITE_SHOT_DIR,`kit-phone-example-390-${theme}.png`),animations:'disabled'});
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
