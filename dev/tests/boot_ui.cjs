'use strict';
// Anonymous, read-only browser checks. A real CSP-blocked proxy script must not hide the login/signup forms.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
(async()=>{
  const browser=await chromium.launch();
  try{
    for(const theme of ['light','dark'])for(const mode of ['optional','script','style']){
      const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block'});
      try{
        const page=await context.newPage(),errors=[];let blocked=0;
        page.on('pageerror',e=>errors.push(e.message));
        page.on('requestfailed',r=>{if(r.url()==='https://optional.invalid/static/beacon.js')blocked++;});
        await context.route('**/*',async route=>{
          const request=route.request(),url=new URL(request.url());
          if(!['GET','HEAD'].includes(request.method()))return route.abort();
          if(request.isNavigationRequest()&&request.frame()===page.mainFrame()){
            const response=await route.fetch(),html=await response.text();
            assert.match(response.headers()['content-security-policy'],/script-src 'self'/,'Keep the actual restrictive policy');
            const body=html.replace(/(<script src="\/static\/boot\.js\?v=[a-f0-9]{32}"><\/script>)/,'$1<script src="https://optional.invalid/static/beacon.js"></script>');
            assert.notEqual(body,html,'The blocked optional script runs immediately after the startup guard');
            return route.fulfill({response,body});
          }
          if(mode==='script'&&url.pathname==='/static/app.js')return route.abort();
          if(mode==='style'&&url.pathname==='/static/style.css')return route.abort();
          if(url.pathname==='/api/setup')return route.fulfill({json:{needed:false}});
          if(url.pathname==='/api/signup')return route.fulfill({json:{open:true,full:false}});
          if(url.pathname==='/api/beta')return route.fulfill({json:{open:false}});
          if(url.pathname==='/api/me')return route.fulfill({status:401,json:{detail:'Not logged in'}});
          return route.continue();
        });
        for(const screen of mode==='optional'?['login','signup']:['login']){
          await page.goto(base+(screen==='signup'?'/signup':'/'),{waitUntil:'networkidle'});
          if(mode==='optional'){
            await page.locator('.login form input[name="password"]').waitFor();
            if(screen==='signup')await page.locator('.login form input[name="email"]').waitFor();
            else await page.locator('.login form input[name="login"]').waitFor();
            assert.equal(await page.locator('#boot-reload').count(),0,'Optional scripts never cause fatal startup');
            assert.equal(await page.evaluate(()=>KinettaBoot.failed),false);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No horizontal clipping');
            if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,screen+'-'+theme+'.png')});}
          }else{
            await page.locator('#boot-reload').waitFor();
            assert.equal(await page.evaluate(()=>KinettaBoot.failed),true,'Required '+mode+' failure still gives recovery');
            assert.equal(await page.locator('.login form').count(),0);
          }
        }
        assert(blocked>0,'The browser actually blocked the optional script under CSP');
        // Later app files depend on app.js; its deliberate absence can also cause runtime errors.
        if(mode!=='script')assert.deepEqual(errors,[],'No runtime errors');
        console.log('Startup browser '+theme+' '+mode+' PASS');
      }finally{await context.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
