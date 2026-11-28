'use strict';
// Unmodified built app, fictional API responses; no real account/export/delete.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=(process.env.KINETTA_URL||'http://localhost:8798').replace(/\/$/,''),out=process.env.KINETTA_EXPORT_OUT;
const fixture=require('./native-ui/appstore.cjs')(),key='F'.repeat(43),ready='/api/account/export-ready/'+key;
(async()=>{
 let checked=0;
 for(const engine of [chromium,webkit].filter(e=>!process.env.ENGINE||e.name()===process.env.ENGINE)){
  const browser=await engine.launch();
  try {for(const theme of ['light','dark'])for(const native of [false,true]){
   const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',timezoneId:'UTC',reducedMotion:'reduce'});
   try {
    let mode='busy',posts=0,deleted=0,release=null,heldStarted=null;
    await context.addInitScript(({theme,native,base})=>{
     if(location.protocol==='http:')localStorage.setItem('theme',theme);
     if(native){const prefs=new Map([['server',base],['token','fictional-export-token']]);window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'ios',isPluginAvailable:()=>false,Plugins:{Preferences:{get:async({key})=>({value:prefs.get(key)??null}),set:async({key,value})=>prefs.set(key,value),remove:async({key})=>prefs.delete(key)}}};}
    },{theme,native,base});
    await context.route('**/*',async route=>{
     const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
     if(!u.pathname.startsWith('/api/')||(u.pathname===ready&&process.env.KINETTA_EXPORT_REAL_DOWNLOAD))return route.continue();
     if(u.pathname==='/api/account/export-ready'||u.pathname==='/api/account/export-link'){
      assert.equal(req.method(),'POST');posts++;
      if(native)assert.equal(req.headers().authorization,'Bearer fictional-export-token','native preparation uses the saved session');
      if(mode==='hold')await new Promise(resolve=>{release=resolve;heldStarted?.();});
      if(mode==='offline')return route.abort('failed');
      if(mode==='busy')return route.fulfill({status:503,json:{detail:'Fictional temporary failure'}});
      if(mode==='rate')return route.fulfill({status:429,json:{detail:'You just downloaded your data - try again in 5 minutes'}});
      return route.fulfill({json:{path:mode==='bad-path'?'https://example.test/private':native?'/api/account/export/'+key:ready}});
     }
     if(u.pathname==='/api/account/delete'){deleted++;return route.fulfill({status:503,json:{detail:'Never delete in this fixture'}});}
     if(!['GET','HEAD'].includes(req.method()))return route.fulfill({json:{ok:true}});
     const data={...fixture.responses,'/api/me':{...fixture.responses['/api/me'],id:1,login:'alex',name:'Alex Example',first_name:'Alex',last_name:'Example',email:'alex@example.test',email_confirmed:true,setup_hidden:true,ai_ok:false},'/api/account/email/status':{bounced:false},'/api/groups/activity-strip':{muted:false},'/api/notifications/count':{unread:0,friend_requests:0}};
     assert(u.pathname in data,'missing fictional response '+u.pathname);return route.fulfill({json:data[u.pathname]});
    });
    function holdEntered(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Export request did not enter hold; mode='+mode+', posts='+posts)),8000);heldStarted=()=>{clearTimeout(timer);resolve();};});}
    const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto(base+'/me/settings');await p.locator('#m-export').waitFor();
    await p.evaluate(({native,real})=>{
     if(Native.on!==native)throw Error('native initialization mismatch');window.exportOffers=[];
     window.open=url=>{exportOffers.push(url);return null;};
     document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a?.pathname.startsWith('/api/account/export-ready/')){if(!real)e.preventDefault();exportOffers.push(a.pathname);}},true);
    },{native,real:!!process.env.KINETTA_EXPORT_REAL_DOWNLOAD});
    const control=p.locator('#m-export');await control.click();
    await p.waitForFunction(()=>document.querySelector('#m-export .inset-value')?.textContent==='Retry');
    assert.match(await p.locator('#toast').innerText(),/having trouble/);
    assert.equal(await control.getAttribute('aria-disabled'),null);assert.equal(posts,1);
    assert.equal(await p.evaluate(()=>exportOffers.length),0,'failed ZIP preparation never opens Safari/downloads');
    if(out&&!native){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`export-after-${engine.name()}-${theme}.png`),animations:'disabled'});}
    mode='hold';const started=holdEntered();const downloaded=process.env.KINETTA_EXPORT_REAL_DOWNLOAD&&!native?p.waitForEvent('download'):null;
    await Promise.all([control.click(),started]);assert.equal(await p.evaluate(()=>exportOffers.length),0,'no success/handoff before preparation finishes');
    mode='ok';release();await p.waitForFunction(()=>exportOffers.length===1);
    if(downloaded){const d=await downloaded;assert.equal(await d.failure(),null);assert.equal(fs.readFileSync(await d.path()).subarray(0,2).toString(),'PK');}
    assert.equal(await p.evaluate(()=>exportOffers[0]),native?base+'/api/account/export/'+key:ready);
    await p.waitForFunction(()=>document.querySelector('#m-export .inset-value').textContent==='Zip file');
    for(const failure of ['rate','offline','bad-path']){
     mode=failure;await control.click();await p.waitForFunction(()=>document.querySelector('#m-export .inset-value').textContent==='Retry');
     assert.equal(await control.getAttribute('aria-disabled'),null);
    }
    async function abandoned(selector,label){
     for(const kind of ['account','detached'])for(const outcome of ['ok','busy']){
      const node=await p.locator(selector).elementHandle(),beforeOffers=await p.evaluate(()=>exportOffers.length),prior=posts;
      mode='hold';const entered=holdEntered();
      await Promise.all([p.locator(selector).click(),entered]);
      assert.equal(await node.getAttribute('aria-disabled'),'true');
      await node.dispatchEvent('click');assert.equal(posts,prior+1,'pending clicks never repeat preparation');
      if(kind==='account')await p.evaluate(()=>{window.exportOriginalMe=App.me;App.me={...App.me,id:2,login:'other'};});
      else await node.evaluate(n=>{window.detachedExport={parent:n.parentNode,next:n.nextSibling};n.remove();});
      mode=outcome;release();
      await p.waitForFunction(n=>n.getAttribute('aria-disabled')===null,node);
      assert.equal(await node.evaluate(n=>(n.querySelector('.inset-value')||n).textContent),label,kind+' '+outcome+' restores the label');
      assert.equal(await p.evaluate(()=>exportOffers.length),beforeOffers,kind+' '+outcome+' never offers the old download');
      assert.doesNotMatch(await p.locator('#toast').innerText(),/Opening Safari|download is ready/,'abandoned work never reports success');
      if(kind==='account')await p.evaluate(()=>App.me=exportOriginalMe);
      else await node.evaluate(n=>detachedExport.parent.insertBefore(n,detachedExport.next));
      await node.dispose();
     }
    }
    await abandoned('#m-export','Zip file');
    await p.locator('#m-del').click();await p.locator('#del-export').waitFor();
    await p.locator('#del input[name=pw]').fill('fictional retained password');
    if(out&&!native)await p.screenshot({path:path.join(out,`delete-after-${engine.name()}-${theme}.png`),animations:'disabled'});
    mode='busy';await p.locator('#del-export').click();await p.waitForFunction(()=>document.querySelector('#del-export')?.textContent==='Retry download');
    assert.equal(await p.locator('#del input[name=pw]').inputValue(),'fictional retained password');assert.equal(deleted,0);
    await abandoned('#del-export','Download my data');
    assert.equal(deleted,0);assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    checked++;console.log(engine.name(),theme,native?'native Preferences bridge stand-in':'web','PASS');
   } finally {await context.close();}
  }} finally {await browser.close();}
 }
 console.log(checked+' export/retry/deletion contexts PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
