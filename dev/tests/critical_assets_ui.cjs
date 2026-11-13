'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.KINETTA_URL||'http://localhost:8914';
const ready={me:'.me-card-sections[aria-busy="false"]',home:'#feed-tools[aria-busy="false"]'};
const deferredScripts=['haptics.js','maps.js','cards.js','feature-usage.js','refresh.js','password-visibility.js','email-account.js'];
const firstScreenCss=fs.readFileSync(path.resolve(__dirname,'../../app/static/first-screen.css'),'utf8');
const themeCss=fs.readFileSync(path.resolve(__dirname,'../../app/static/theme.css'),'utf8');
const sharedEffectTokens=['--weight-body','--weight-support','--weight-title','--weight-display','--weight-number','--motion-press','--motion-settle','--motion-ease','--elevation-rest','--elevation-raised','--elevation-sheet','--surface-card','--surface-raised','--surface-sheet','--accent-gradient'];
for(const token of new Set([...themeCss.matchAll(/(--(?:weight|motion|elevation|surface|accent-gradient)[\w-]*)\s*:/g)].map(match=>match[1])))assert.ok(firstScreenCss.includes(`${token}:`),`critical CSS keeps shared token ${token}`);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const theme of ['light','dark'])for(const [name,path] of [['me','/me'],['home','/']]){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,colorScheme:theme,timezoneId:'UTC',serviceWorkers:'block'});
   const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
   assert.equal(login.status(),200,'fictional demo login');
   const held=[],heldUrls=[],errors=[];const page=await context.newPage();
   page.on('pageerror',error=>errors.push(error.message));
   page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==base)return route.abort();
    if(!['GET','HEAD'].includes(req.method()))return route.fulfill({status:204});
    if(url.pathname.endsWith('.css')&&url.pathname!=='/static/first-screen.css'||deferredScripts.some(asset=>url.pathname.endsWith('/'+asset))){
      heldUrls.push(url.pathname);
      await new Promise(resolve=>held.push(async()=>{await route.continue();resolve();}));return;
    }
    return route.continue();
   });
   await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForSelector(ready[name],{state:'attached',timeout:120000});
   await page.waitForFunction(()=>!!document.querySelector('link[href*="/static/style.css"]'));
   await page.waitForFunction(assets=>assets.every(asset=>[...document.querySelectorAll('script[src]')].some(script=>new URL(script.src).pathname.endsWith('/'+asset))),deferredScripts);
   await page.waitForTimeout(100);
   assert.deepEqual([...new Set(heldUrls.filter(path=>path.endsWith('.js')).map(path=>path.split('/').pop()))].sort(),[...deferredScripts].sort(),`${name} ${theme}: optional JS waits until first useful`);
   const before=await page.evaluate(tokens=>{
    const selectors=['.shell','.top','nav.tabs','.me-card','.me-card-body','#feed-tools','.activity-home .feed-list','.post-card'];
    const styles=Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return[selector,null];const s=getComputedStyle(el);return[selector,{display:s.display,position:s.position,padding:s.padding,gap:s.gap,fontSize:s.fontSize,fontWeight:s.fontWeight,borderRadius:s.borderRadius,backgroundColor:s.backgroundColor,color:s.color,maxWidth:s.maxWidth,boxShadow:s.boxShadow,transform:s.transform}];}));
    const root=getComputedStyle(document.documentElement);styles.sharedTokens=Object.fromEntries(tokens.map(token=>[token,root.getPropertyValue(token).trim()]));return styles;
   },sharedEffectTokens);
   assert.ok(before['.shell'],'first-screen shell is styled');
   assert.equal(before['nav.tabs']?.position,'fixed','navigation is styled before deferred CSS');
   assert.ok(before['.me-card']||before['#feed-tools'],'the expected first screen exists');
   assert.equal(errors.length,0,`${name} ${theme}: no page or console errors before deferred assets`);
   const shot=`/tmp/dash-960-rebased-${name}-${theme}-critical.png`;
   await page.screenshot({path:shot,fullPage:false});
   for(const resume of held.splice(0))await resume();
   await page.waitForFunction(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].every(link=>!!link.sheet),null,{timeout:120000});
   await page.waitForFunction(assets=>assets.every(asset=>performance.getEntriesByType('resource').some(row=>new URL(row.name).pathname.endsWith('/'+asset))),deferredScripts,{timeout:120000});
   const after=await page.evaluate(tokens=>{
    const selectors=['.shell','.top','nav.tabs','.me-card','.me-card-body','#feed-tools','.activity-home .feed-list','.post-card'];
    const styles=Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector);if(!el)return[selector,null];const s=getComputedStyle(el);return[selector,{display:s.display,position:s.position,padding:s.padding,gap:s.gap,fontSize:s.fontSize,fontWeight:s.fontWeight,borderRadius:s.borderRadius,backgroundColor:s.backgroundColor,color:s.color,maxWidth:s.maxWidth,boxShadow:s.boxShadow,transform:s.transform}];}));
    const root=getComputedStyle(document.documentElement);styles.sharedTokens=Object.fromEntries(tokens.map(token=>[token,root.getPropertyValue(token).trim()]));return styles;
   },sharedEffectTokens);
   assert.deepEqual(before,after,`${name} ${theme}: deferred CSS must not restyle first screen`);
   assert.equal(errors.length,0,`${name} ${theme}: no page or console errors after deferred assets`);
   await context.close();
   console.log(`${name} ${theme}: no deferred-style visual delta (${shot})`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
