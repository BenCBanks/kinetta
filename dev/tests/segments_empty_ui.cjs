// Fictional account and local map tiles; checks the new Nearby/Mine empty actions without external requests.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {setProgressFlags}=require('./progress_flags_fixture.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT,out=process.env.KINETTA_SHOTS,pw='green teapot on the hill',login='zz_test_segments_empty';
assert(project&&/^kt-[a-z0-9-]+$/.test(project),'isolated Kinetta test project required');
const tile=dark=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="${dark?'#20262b':'#edf1ec'}"/><path d="M0 48H256M0 126H256M48 0V256M150 0V256" stroke="${dark?'#414b51':'#fff'}" stroke-width="10"/><path d="M0 200C50 180 95 196 128 152S205 96 256 112" fill="none" stroke="${dark?'#25485b':'#b9d9e7'}" stroke-width="24"/></svg>`;
const env={...process.env};if(env.KINETTA_ACTIVITY_FIXTURE_TMPDIR)env.TMPDIR=env.KINETTA_ACTIVITY_FIXTURE_TMPDIR;
cp.execFileSync('python3',['-c',"import os,sys;sys.path.insert(0,'dev/tests');from kc import person;person('zz_test_segments_empty','River Runner')"],{env,stdio:'inherit'});
async function ready(page,filter){await page.waitForFunction(f=>App.pageReady&&document.querySelector(`[data-f="${f}"][aria-pressed="true"]`)&&document.querySelector('#sg-list .segment-empty'),filter,{timeout:15000});}
(async()=>{let browser;try{setProgressFlags(true);browser=await chromium.launch();
 for(const width of [390,330])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'UTC'}),errors=[],writes=[];
  assert.equal((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password:pw}})).status(),200,'fictional Segments account logs in');
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(request.method()==='GET'&&url.pathname==='/api/segments')return route.fulfill({json:[]});
   if(request.method()==='GET'&&url.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/fictional-segments/light/{z}/{x}/{y}.svg',dark_url:base+'/fictional-segments/dark/{z}/{x}/{y}.svg',max_zoom:17,attribution:'Fictional test basemap'}});
   if(request.method()==='GET'&&url.pathname.startsWith('/fictional-segments/'))return route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*'},body:tile(url.pathname.includes('/dark/'))});
   if(!['GET','HEAD'].includes(request.method())){if(url.pathname!=='/api/challenges/signup/continue')writes.push(`${request.method()} ${url.pathname}`);return route.fulfill({json:{}});}
   return route.continue();
  });
  // A new account has no saved map area. Give this fictional account a fixed centre so Nearby's
  // map and its "Move the map" instruction are both visible without asking for device location.
  await page.goto(base+'/activity');await page.waitForFunction(()=>App.pageReady&&App.me?.login==='zz_test_segments_empty',{timeout:15000});
  await page.evaluate(()=>MapArea.remember([39.5,-98.5],readOwner()));
  for(const filter of (process.env.KINETTA_SEGMENT_EMPTY_FILTERS||'near,mine').split(',')){
   await page.goto(base+`/progress/segments?f=${filter}`);await ready(page,filter);await page.evaluate(()=>document.fonts.ready);
   if(filter==='near')await page.locator('#sg-map .leaflet-tile-loaded').first().waitFor({timeout:10000});
   const copy=await page.locator('#sg-list .segment-empty').innerText();assert.match(copy,filter==='near'?/No segments here yet/:/You haven’t created a segment/);
   assert.match(copy,/Pick a stretch from one of your activities\./);assert.equal(await page.locator('#sg-empty-create').innerText(),'Create a segment');assert.equal(await page.locator('#sg-empty-create').getAttribute('type'),'button');
   if(filter==='near'){assert.match(copy,/Move the map to look around/);assert.equal(await page.locator('#sg-map').isHidden(),false);}else{assert.doesNotMatch(copy,/Move the map/);assert.equal(await page.locator('#sg-map').isHidden(),true);}
   const header=page.locator('a[aria-label="New segment"]');assert.equal(await header.innerText(),'New','New stays in the Segments header');assert(await header.isVisible());
   const selected=page.locator(`[data-f="${filter}"]`);assert.equal(await selected.evaluate(node=>getComputedStyle(node).textDecorationLine),'none','selected filter has no text underline');assert.equal(await selected.evaluate(node=>getComputedStyle(node,'::after').height),'2px','selected filter keeps its 2px indicator');
   const targets=await page.locator('.progress-segment-controls [data-f]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height};}));assert(targets.every(r=>r.width>=44&&r.height>=44),'Nearby/Mine filters keep 44px targets');
   const cta=await page.locator('#sg-empty-create').boundingBox(),guidance=await page.locator('#sg-list .segment-empty > p.small').first().boundingBox(),empty=await page.locator('#sg-list .segment-empty').boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(cta.height>=44&&cta.x>=0&&cta.x+cta.width<=viewport.width,'Create a segment stays a full-width touch target');assert(cta.y-guidance.y-guidance.height>=11.5,'12px separates the guidance from the Create a segment button');assert(empty.x>=0&&empty.x+empty.width<=viewport.width,'empty card fits the viewport width');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'Segments scene does not overflow horizontally');
   const spacing=JSON.parse(fs.readFileSync(path.join(__dirname,'spacing_exceptions.json'),'utf8'));
   const measured=require('./spacing_geometry.cjs').audit(await page.evaluate(require('./spacing_dom.cjs').collectSpacing,{screen:`Segments ${filter} empty`,rules:spacing}),spacing);assert.deepEqual(measured.violations,[],`changed-scene spacing ${filter}/${width}/${theme}`);
   if(width===390&&out){fs.mkdirSync(out,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,`segments-empty-${filter}-390-${theme}.png`),animations:'disabled'});}
   await page.locator('#sg-empty-create').click();await page.waitForFunction(()=>location.pathname==='/segments/new',{timeout:10000});assert.equal(new URL(page.url()).pathname,'/segments/new','Create a segment opens the existing creation route');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'empty views and opening the existing creation route make no writes');
   console.log(`Segments ${filter} empty ${width}px ${theme}: copy, action, header, filter underline and spacing PASS`);
  }
  await context.close();
 }
}finally{try{setProgressFlags(false);}finally{if(browser){const cleanup=await browser.newContext();try{await cleanup.request.post(base+'/api/login',{headers:{Origin:base},data:{login,password:pw}});await cleanup.request.post(base+'/api/account/delete',{headers:{Origin:base},data:{password:pw}});}finally{await cleanup.close();await browser.close();}}}}})().catch(error=>{console.error(error);process.exitCode=1;});
