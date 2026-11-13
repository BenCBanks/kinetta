'use strict';
// Fictional website tour crops; all external writes blocked, no app accounts or providers.
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
// Home, Training, Food, Friends, Features and Guide use complete cropped controls.
const tourPages=(process.env.KINETTA_WEBSITE_TOUR_PAGES||'index,training,food,friends,compare,guide').split(',').filter(Boolean);
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
  try{await c.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())||u.origin!==base&&!['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();return r.continue();});
   for(const name of tourPages){
    const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+name+'.html');await p.evaluate(()=>document.fonts.ready);
    await p.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'));await until(p,()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' scrolls sideways');
    assert.deepEqual(await p.locator('nav[aria-label="Primary"] a').allInnerTexts(),['Home','Features','Guide','iPhone beta']);
    // Every tour picture is a complete, themed crop shown at no more than its natural width.
    const pics=await p.locator('main img[src*="assets/tour/"]').evaluateAll(xs=>xs.map(i=>({src:i.currentSrc,w:i.getBoundingClientRect().width,natural:i.naturalWidth/2,alt:i.alt})));
    assert(pics.every(i=>i.alt.length>20&&i.w<=i.natural*2/1.7+1&&i.src.includes(theme==='dark'?'-dark.':'-light.')),name+' tour picture theme, alt or upscaling');
    if(name==='index'||name==='compare'){
     // The workout map comes first, the recorded numbers underneath.
     const workout=await p.locator('.tour-workout img').evaluateAll(xs=>xs.map(i=>({src:i.currentSrc,top:i.getBoundingClientRect().top})));
     assert.equal(workout.length,2);assert.match(workout[0].src,/activity-map-/);assert.match(workout[1].src,/activity-result-/);assert(workout[0].top<workout[1].top);
     // Audience controls, never a shared ride, prove the sharing claim.
     assert.equal(await p.locator('img[src*="friends-route"]').count(),0);assert.equal(await p.locator('img[src*="sharing-default-"]').count(),1);
     const words=await p.locator('main').innerText().then(t=>t.trim().split(/\s+/).length);assert(words<=(name==='index'?110:260),name+' copy grew to '+words+' words');
    }
    if(name==='compare'){
     assert.deepEqual(await p.locator('.tour-scope').allInnerTexts(),['New workouts · Settings','One workout · Edit']);
     assert.equal(await p.locator('img[src*="sharing-workout-"]').count(),1);assert.equal(await p.locator('.feature-reference tbody tr').count(),8);
    }
    if(name==='guide'){await p.locator('#feature-search').fill('recipes');assert(await p.locator('.public-guide-card:visible').count()>0,'Guide search found nothing');}
    assert.deepEqual(errors,[]);checks++;await p.close();
   }
  }finally{await c.close();}
 }console.log('Website tour checks: '+checks+' selected page/size/theme/density cases PASS; themed crops, alt text, image scale, overflow and navigation labels');
 }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
