// Shared shell regressions with fictional records; all product writes and device/provider requests are blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {collectSpacing}=require('./spacing_dom.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest',out=process.env.KINETTA_SHELL_SHOTS;
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));assert(project==='kinettatest'||project.startsWith('kt-'));
assert.equal(Number(cp.execFileSync('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],{encoding:'utf8'}).trim()),Number(new URL(base).port));
const packet=process.env.KINETTA_SHELL_DETAIL_FIXTURE?JSON.parse(fs.readFileSync(process.env.KINETTA_SHELL_DETAIL_FIXTURE,'utf8')):null;
if(packet){assert.equal(packet.base,base);assert.equal(packet.project,project);}
const detail=packet?.detail||JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'activity_detail_fixture.py')],{env:{...process.env,KINETTA_URL:base,KINETTA_PROJECT:project},encoding:'utf8'}).trim().split('\n').at(-1));
const until=async(p,f,label)=>{for(let i=0;i<150;i++){if(await p.evaluate(f))return;await p.waitForTimeout(100);}throw Error(label);};
(async()=>{const b=await chromium.launch(),states={};let cases=0;try{
 for(const who of ['alex','zz_test_detail_owner']){const c=await b.newContext();assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:who,password:who==='alex'?'blue kettle morning run':'green teapot on the hill'}})).status(),200);states[who]=await c.storageState();await c.close();}
 for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}]){
  for(const who of ['alex','zz_test_detail_owner']){
   const c=await b.newContext({storageState:states[who],viewport:size,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[],writes=[],pending={hold:false,release:null};
   try{
    await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
    await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/food/foods'&&pending.hold)return new Promise(resolve=>pending.release=()=>r.continue().then(resolve,resolve));if(u.pathname==='/api/map-config')return r.fulfill({json:{kind:'raster',url:base+'/__shell_tile/{z}/{x}/{y}.svg',max_zoom:17,attribution:'Fictional tiles'}});if(u.pathname.startsWith('/__shell_tile/'))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#dde5ea" d="M0 0h256v256H0z"/></svg>'});if(!['GET','HEAD'].includes(q.method())){if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});writes.push(u.pathname);return r.fulfill({status:503,json:{detail:'Shell regression: mutation blocked'}});}return r.continue();});
    p.on('pageerror',e=>errors.push(e.message));
    const ready=async url=>{await p.goto(base+url);await until(p,()=>App.pageReady,'Page ready');};
    const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${name}-${size.width}-${theme}.png`)});}};
    if(who==='alex'){
     for(const url of ['/me/settings','/me/notifications','/me/friends','/progress?view=fitness','/food?view=overview','/food/meals','/progress/weight','/me/sharing','/people/alex','/me/devices']){
      if(url==='/food/meals'){pending.hold=true;try{await p.goto(base+url);for(let i=0;i<100&&!pending.release;i++)await p.waitForTimeout(20);assert(pending.release);assert(await p.locator('#tm-new').isDisabled(),'Header action is honest while the library loads');}finally{pending.hold=false;pending.release?.();}await until(p,()=>App.pageReady,'Library ready');assert(await p.locator('#tm-new').isEnabled());}else await ready(url);await p.locator('.subpage-header h1').waitFor();
      const h=await p.locator('.subpage-header').evaluate(n=>{const rect=e=>e.getBoundingClientRect().toJSON(),back=n.querySelector('.back,.progress-back'),title=n.querySelector('h1');return{back:rect(back),title:rect(title),font:parseFloat(getComputedStyle(title).fontSize),controls:[...n.querySelectorAll('button,a[href]')].map(rect),label:back.getAttribute('aria-label')||back.textContent.trim(),overflow:document.documentElement.scrollWidth>innerWidth+1};});
      assert(!h.overflow,url+' has no horizontal overflow');assert(h.font>=size.root*17/16-.1&&h.font<=size.root*1.25+.1,'Subpage type scale '+JSON.stringify({url,root:size.root,font:h.font}));const text=await p.locator('.subpage-header h1').innerText(),collected=await p.evaluate(collectSpacing,{screen:'shared header',rules:[]});assert(collected.texts.some(t=>t.text===text&&t.role==='section'),'Only the compact subpage title uses section sizing');assert(Math.abs(h.back.y+h.back.height/2-h.title.y-h.title.height/2)<2,'Back and title share one row '+JSON.stringify({url,root:size.root,back:h.back,title:h.title}));assert(h.label.length>0,'Back retains its accessible parent');
      for(const r of h.controls){assert(r.width>=43.9&&r.height>=43.9,'Header 44px target');assert(Math.abs(r.y+r.height/2-h.back.y-h.back.height/2)<2,'Actions share the header row');}
      if(url==='/food/meals'){await p.locator('#tm-new').click();await p.locator('#tm-food').waitFor();await p.keyboard.press('Escape');}
      await shot('header-'+url.replace(/\W+/g,'-'));cases++;
     }
     await ready('/activity');const rootTitle=await p.evaluate(collectSpacing,{screen:'tab root',rules:[]});assert(rootTitle.texts.some(t=>t.text==='Activity'&&t.role==='title'&&t.font>=size.root*28/16),'Tab roots retain the larger page-title contract');
     await ready('/me/settings');await p.locator('#m-name').click();await p.locator('#ac input').fill('Fictional unsaved draft');
     assert(await p.evaluate(()=>root.inert),'Sheet background is inert');assert((await p.locator('#ac .primary').boundingBox()).height>=44,'Shared form footer is 44px');await shot('name-sheet');
     await p.evaluate(()=>sheet('Additional review','<button type="button" id="shell-nested">Nested action</button>'));
     assert(await p.locator('#ac').evaluate(n=>n.closest('.scrim').inert));await p.keyboard.press('Tab');assert(await p.locator('.scrim').last().evaluate(n=>n.contains(document.activeElement)));
     await p.keyboard.press('Escape');assert.equal(await p.locator('#ac input').inputValue(),'Fictional unsaved draft');assert(await p.evaluate(()=>root.inert));assert.equal(await p.locator('#ac').evaluate(n=>n.closest('.scrim').inert),false);
     const back=await p.locator('#page [data-back]').boundingBox();await p.mouse.click(back.x+back.width/2,back.y+back.height/2);assert.equal(new URL(p.url()).pathname,'/me/settings','Covered Back cannot navigate');await until(p,()=>!document.querySelector('.scrim'),'Outside tap closes the sheet');assert.equal(await p.evaluate(()=>root.inert),false);assert(await p.locator('#m-name').evaluate(n=>document.activeElement===n));cases++;
    }else{
     await ready('/activity/'+detail.run);await p.locator('[data-media-photo]').first().click();await p.locator('.ph-view [data-del]').waitFor();await until(p,()=>document.querySelector('.ph-view img')?.naturalWidth>0,'Photo loaded');assert(await p.evaluate(()=>root.inert),'Photo background is inert');await shot('photo-viewer');
     await p.locator('.ph-view button:visible').last().focus();await p.keyboard.press('Tab');assert(await p.locator('.ph-view button:visible').first().evaluate(n=>document.activeElement===n),'Photo Tab cycles inside');
     let dialogs=0;p.on('dialog',async d=>{dialogs++;await d.dismiss();});const remove=await p.locator('.ph-view [data-del]').boundingBox();await p.mouse.click(remove.x+remove.width/2,remove.y+remove.height/2);assert.equal(dialogs,1,'Remove reaches its own confirmation, never background Edit');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>root.inert),false);assert(await p.locator('[data-media-photo]').first().evaluate(n=>document.activeElement===n),'Photo opener regains focus');cases++;
    }
    assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   }finally{await c.close();}
  }
 }
 }finally{await b.close();}console.log(`Shared shell: ${cases} header/modal/photo cases passed`);
})().catch(e=>{console.error(e);process.exit(1)});
