// Fictional owner data and a server-response stand-in; no activity or provider writes run.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',pw='green teapot on the hill',out=process.env.KINETTA_EVIDENCE;
async function until(page,fn,label){for(let i=0;i<120;i++){if(await page.evaluate(fn))return;await page.waitForTimeout(100);}throw Error(label);}
(async()=>{
 const setup=cp.execFileSync('python3',[path.join(__dirname,'activity_detail_fixture.py')],{env:process.env,encoding:'utf8'}),ids=JSON.parse(setup.trim().split('\n').at(-1));console.log(setup.trim().split('\n')[0]);
 const browser=await chromium.launch(),contexts=[];
 async function open(surface,theme,{reduce=false,capture=false,width=390}={}){
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:reduce?'reduce':'no-preference',serviceWorkers:'block',isMobile:true,hasTouch:true,timezoneId:'UTC'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_owner',password:pw}})).status(),200);
  const page=await c.newPage(),errors=[],writes=[];let claims=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(request.method()==='POST'&&url.pathname==='/api/milestones/celebrate'){
    claims++;return route.fulfill({json:{pending:false,items:claims===1?[{code:'best:run:5000:fictional',kind:'best',title:'New 5K best',rank:101,details:{sport:'run',label:'5K',seconds:1450}}]:[]}});
   }
   if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.fulfill({json:{ok:true}});}
   return route.continue();
  });
  await page.goto(base+(surface==='detail'?`/activity/${ids.run}`:`/track?done=${ids.run}`));
  await until(page,()=>!!document.querySelector('.milestone-celebration-banner'),surface+' celebration');
  const banner=page.locator('.milestone-celebration-banner');assert.equal(await banner.innerText(),'New best: 5K 24:10');
  const particles=page.locator('.milestone-celebration-particles i');assert.equal(await particles.count(),reduce?0:30,'Reduce Motion removes the confetti only');
  assert.equal(await page.locator('.milestone-celebration-banner').getAttribute('role'),'status');
  assert.equal(await page.locator('.milestone-celebration-host').evaluate(n=>n.style.getPropertyValue('--celebration-color')),'var(--run)');
  assert(!/[…]|\.\.\./.test(await banner.innerText()),'the celebration never truncates its message');
  const geometry=await banner.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,client:el.clientWidth,scroll:el.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth};});
  assert(geometry.left>=0&&geometry.right<=geometry.viewport+1&&geometry.scroll<=geometry.client+1&&geometry.page<=geometry.viewport+1,'banner and page stay unclipped: '+JSON.stringify(geometry));
  if(capture){fs.mkdirSync(out,{recursive:true});await page.waitForTimeout(120);await page.screenshot({path:path.join(out,`celebration-${surface}-${theme}.png`)});}
  if(surface==='detail'&&!reduce){
   await page.evaluate(id=>Milestones.celebrate(document.querySelector('#d-celebration'),id),ids.run);
   await until(page,()=>document.querySelector('#d-celebration .milestone-celebration-banner')?.textContent==='New best: 5K 24:10','idempotent repeat request');
   assert.equal(claims,2);assert.equal(await particles.count(),30,'a replay does not replace or duplicate the first burst');
  }
  if(surface==='detail'&&reduce){await page.waitForTimeout(3300);assert.equal(await page.locator('.milestone-celebration-banner').count(),0,'the reduced-motion banner clears after three seconds');}
  assert.deepEqual(errors,[]);assert(writes.every(x=>['/api/milestones/celebrate','/api/challenges/signup/continue'].includes(x)),'only opt-in claim/signup writes run: '+JSON.stringify(writes));
  return {c,page,claims};
 }
 try{
  for(const theme of ['light','dark']){const result=await open('detail',theme,{capture:true});await result.c.close();contexts.splice(contexts.indexOf(result.c),1);}
  for(const theme of ['light','dark']){const result=await open('saved',theme,{capture:true});await result.c.close();contexts.splice(contexts.indexOf(result.c),1);}
  const reduced=await open('detail','light',{reduce:true});await reduced.c.close();contexts.splice(contexts.indexOf(reduced.c),1);
  const narrow=await open('detail','dark',{width:330});await narrow.c.close();contexts.splice(contexts.indexOf(narrow.c),1);
  console.log('Milestone celebration: detail/saved light/dark, one-shot replay, 30 medal-colour particles, Reduce Motion and three-second status PASS');
 }finally{
  for(const c of contexts)await c.close();
  for(const who of ['owner','friend']){const c=await browser.newContext();try{const response=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_detail_'+who,password:pw}});if(response.ok())await c.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await c.close();}}
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
