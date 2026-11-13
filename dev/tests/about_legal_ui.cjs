'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'../../site'),shots=process.env.KINETTA_ABOUT_LEGAL_SHOTS;
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';if(!path.extname(name))name+='.html';const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,b=await chromium.launch();let cases=0;
 try{for(const width of [1280,390,330])for(const theme of ['light','dark'])for(const pageName of ['about','privacy','terms']){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())||u.origin!==base&&!['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return r.abort();return r.continue();});
   await p.goto(base+'/'+pageName+'.html');await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'));await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
   assert.equal(await p.locator('h1').count(),1,pageName+' has one page heading');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,pageName+' has no horizontal overflow');
   assert.deepEqual(await p.locator('nav[aria-label="Primary"] a').allInnerTexts(),['Home','Features','iPhone beta']);
   assert.equal(await p.locator('nav[aria-label="Primary"]').innerText().then(t=>/guide/i.test(t)),false,'Guide is absent from the main nav');
   assert.equal(await p.evaluate(()=>getComputedStyle(document.body).fontSize),'17px',pageName+' uses the shared body size');
   if(pageName==='about'){
    const frame=p.locator('.about-phone .frame');assert.equal(await frame.count(),1,'About has one framed phone');
    const box=await frame.boundingBox();assert(box&&box.width<=(width<=900?260:280)+1,'About phone stays compact');
    const img=p.locator('.about-phone img');assert((await img.getAttribute('alt')).length>20);
    assert((await img.evaluate(e=>e.currentSrc)).includes(theme==='dark'?'dark-today':'light-today'),'About phone matches the page theme');
    assert.equal(await p.locator('.about-phone').count(),1);
   }else{
    assert.equal(await p.locator('.policy').count(),1);
    assert.equal(await p.locator('.policy .phone-frame').count(),0,'Text pages have no phone imagery');
    assert.equal(await p.locator('.policy p:not(.date)').first().evaluate(e=>getComputedStyle(e).fontSize),'17px');
    assert.equal(await p.locator('.policy').evaluate(e=>getComputedStyle(e).paddingLeft),'20px','Text pages keep the site gutter');
    assert.equal(await p.locator('.policy h1').evaluate(e=>getComputedStyle(e).fontSize),width>=1200?'62px':'36px','Text page title follows the shared scale');
   }
   if(shots&&((width===1280&&theme==='light')||width===390)){
    fs.mkdirSync(shots,{recursive:true});await p.evaluate(()=>scrollTo(0,0));
    await p.screenshot({path:path.join(shots,`${pageName}-${width}-${theme}.png`),fullPage:pageName==='about'});
   }
   assert.deepEqual(errors,[]);cases++;
  }finally{await c.close();}
 }console.log(`About/legal pages: ${cases} selected width/theme/page cases PASS`);
 }finally{await b.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
