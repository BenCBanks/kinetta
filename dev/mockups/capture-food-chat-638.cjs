// Static, fictional design checkpoint for Kinetta issue #638. No app server or writes.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=process.env.FOOD_CHAT_638_SHOT_DIR;
if(!out)throw new Error('Set FOOD_CHAT_638_SHOT_DIR to a private evidence directory.');
const states=['thinking','ready-one','ready-three','logged-one','logged-three','toast'];
const mime={'.css':'text/css','.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const server=http.createServer((req,res)=>{
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch(_){res.writeHead(400).end();return;}
  let file;
  if(pathname.startsWith('/static/'))file=path.join(root,'app',pathname.slice(1));
  else if(pathname.startsWith('/mockup/'))file=path.join(__dirname,pathname.slice('/mockup/'.length));
  else{res.writeHead(404).end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try{
    fs.mkdirSync(out,{recursive:true});
    for(const theme of ['light','dark'])for(const state of states){
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,colorScheme:theme,reducedMotion:'reduce'});
      const page=await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/mockup/food-chat-638.html?state=${state}`,{waitUntil:'networkidle'});
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:path.join(out,`food-chat-638-${state}-390-${theme}.png`),animations:'disabled'});
      await context.close();
      process.stdout.write(`${state} 390 ${theme}\n`);
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
