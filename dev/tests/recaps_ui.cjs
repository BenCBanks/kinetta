// Actual recap data, canvas exports and sheet interactions. Fictional accounts, no sharing/provider calls.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS,pw='green teapot on the hill';
async function until(p,fn,label,arg){for(let i=0;i<150;i++){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(100);}throw Error('Timed out: '+label);}
const pictureReady=p=>until(p,()=>{const n=document.querySelector('#recap-preview');return n?.naturalWidth>0&&!document.querySelector('.recap-preview.busy');},'picture');
(async()=>{
 cp.execFileSync('python3',[path.join(__dirname,'recaps_ui_fixture.py')],{env:process.env,stdio:'inherit'});
 const browser=await chromium.launch(),contexts=[];
 async function open(state,theme,size,storageState){
  const c=await browser.newContext({viewport:size,colorScheme:theme,storageState,serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});contexts.push(c);
  assert.equal((await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_recap_ui_'+state,password:pw}})).status(),200);
  await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
  await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return u.origin!==base?r.abort():!['GET','HEAD'].includes(q.method())?r.fulfill({json:{}}):r.continue();});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await p.goto(base+'/progress');await until(p,()=>App.pageReady,'Progress');assert.equal(await p.title(),'Kinetta');await p.locator('#recap-entry').click();await pictureReady(p);return{c,p,errors};
 }
 try{
  for(const state of ['empty','typical','heavy'])for(const theme of ['light','dark'])for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:24}]){
   const {c,p,errors}=await open(state,theme,size);
   assert.equal(await p.locator('.recap-sheet .discovery-grid').count(),0);assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no horizontal overflow');
   const rows=await p.locator('[data-recap-period]').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().top));assert(rows.every(y=>Math.abs(y-rows[0])<1),'periods stay on one scrollable row');
   for(const n of await p.locator('[data-recap-period],[data-recap-option],[data-recap-format],.recap-preview,.recap-sheet [data-close]').all()){const r=await n.boundingBox();assert(r.width>=44&&r.height>=44,'44px controls');}
   assert.equal(await p.locator('[data-recap-option=food]').getAttribute('aria-pressed'),'false');assert.equal(await p.locator('[data-recap-option=identity]').getAttribute('aria-pressed'),'false');
   const clearance=await p.evaluate(()=>{const a=document.querySelector('.recap-options').getBoundingClientRect(),b=document.querySelector('#recap-share').getBoundingClientRect();return b.top-a.bottom;});assert(clearance>=0,'Share follows options');
   await p.locator('#recap-share').scrollIntoViewIfNeeded();assert(await p.locator('#recap-share').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Share reachable and unobscured');
   if(size.root===16)assert(await p.locator('.recap-sheet').evaluate(n=>n.scrollHeight-n.clientHeight<90),'at most a short scroll at390');
   await p.locator('[data-recap-period=this_week]').click();await pictureReady(p);
   const data=await(await c.request.get(base+'/api/recaps?period=this_week')).json();
   if(state==='typical'){assert.equal(data.distance_m,6437.376,'Only me run included in total');assert.equal(data.highlights[0].distance_m,1609.344,'Only me longest excluded from highlight');assert.equal(data.time_s,2100);}
   if(state==='heavy'){assert(data.streak_weeks>=80);assert(data.food.protein_goal_days>0);}
   assert.equal(await p.locator('#recap-share').isDisabled(),state==='empty');
   const alt=await p.locator('#recap-preview').getAttribute('alt');assert(!/PRIVATE|Fictional|weight|kcal/i.test(alt));assert.match(alt,/Activity chart/);if(state!=='empty')assert.match(alt,/Garmin/);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${state}-${size.width}-${theme}.png`});}
   await p.locator('[data-recap-format=story]').click();await pictureReady(p);assert.equal(await p.locator('#recap-preview').evaluate(n=>n.naturalWidth/n.naturalHeight),9/16);
   await p.locator('.recap-preview').click();assert(await p.locator('.recap-full').isVisible());await p.locator('.sheet [data-close]').last().click();
   await p.locator('.recap-sheet [data-close]').click();await until(p,()=>!document.querySelector('.sheet'),'close');await p.locator('#recap-entry').click();await pictureReady(p);assert.equal(await p.locator('[data-recap-format=story]').getAttribute('aria-pressed'),'true','format remembered for account');
   assert.deepEqual(errors,[]);await c.close();contexts.splice(contexts.indexOf(c),1);console.log(`Recaps ${state} ${size.width}/${size.root} ${theme}: controls/privacy/export/preview/prefs PASS`);
  }
  const {c,p,errors}=await open('heavy','light',{width:390,height:844,root:16});
  // Real canvas dimensions and bounded ink for every selected-section combination, not just default screenshots.
  for(const period of ['this_week','this_month','this_year']){
   const data=await(await c.request.get(base+'/api/recaps?period='+period)).json();
   const result=await p.evaluate(async d=>{
    const nativeFill=CanvasRenderingContext2D.prototype.fillText,nativeRound=CanvasRenderingContext2D.prototype.roundRect,fail=[];let canvas,stubs=[];
    CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,...args){if(h===8)stubs.push({g:this,x,y,w});return nativeRound.call(this,x,y,w,h,...args);};
    const luminance=rgb=>rgb.slice(0,3).reduce((sum,v,i)=>{v/=255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i];},0);
    CanvasRenderingContext2D.prototype.fillText=function(t,x,y){canvas=this.canvas;const m=this.measureText(t),left=this.textAlign==='right'?x-m.width:this.textAlign==='center'?x-m.width/2:x;if(left<0||left+m.width>canvas.width+1||y>canvas.height||y-m.actualBoundingBoxAscent<0)fail.push(String(t));return nativeFill.call(this,t,x,y);};
    try{for(const format of ['post','story'])for(let mask=0;mask<64;mask++){const options=Object.fromEntries(['totals','calendar','highlights','streak','food','identity'].map((k,i)=>[k,!!(mask&(1<<i))]));stubs=[];const r=await Recaps.draw(d,options,format);for(const s of stubs){const fg=luminance([...s.g.getImageData(Math.floor(s.x+s.w/2),Math.floor(s.y+4),1,1).data]),bg=luminance([...s.g.getImageData(Math.floor(s.x-4),Math.floor(s.y+4),1,1).data]);if((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)<3)fail.push('rest-day contrast');}if(canvas.width!==1080||canvas.height!==(format==='story'?1920:1350)||!r.blob.size)fail.push('size');}}finally{CanvasRenderingContext2D.prototype.fillText=nativeFill;CanvasRenderingContext2D.prototype.roundRect=nativeRound;}
    return fail;
   },data);assert.deepEqual(result,[],period+' all128 combinations fit canvas');
  }
  await p.locator('[data-recap-format=story]').click();await pictureReady(p);
  const second=await open('typical','light',{width:390,height:844,root:16},await c.storageState());assert.equal(await second.p.locator('[data-recap-format=post]').getAttribute('aria-pressed'),'true','another account does not inherit saved size');assert.deepEqual(second.errors,[]);await second.c.close();contexts.splice(contexts.indexOf(second.c),1);
  const month=await(await c.request.get(base+'/api/recaps?period=this_month')).json();let release;
  await c.route('**/api/recaps?period=this_month',r=>{release=()=>r.fulfill({json:month});});const held=p.waitForRequest('**/api/recaps?period=this_month');await p.locator('[data-recap-period=this_month]').click();await held;await p.locator('[data-recap-period=this_week]').click();await pictureReady(p);await release();await c.unroute('**/api/recaps?period=this_month');
  assert.equal(await p.locator('[data-recap-period=this_week]').getAttribute('aria-pressed'),'true','late period cannot replace newer choice');assert.match(await p.locator('#recap-preview').getAttribute('alt'),/^Week of/);
  await p.evaluate(()=>{ShareArt.deliver=async()=>{window.recapShareCalls=(window.recapShareCalls||0)+1;return false;};});await p.locator('#recap-share').click();await until(p,()=>window.recapShareCalls===1,'cancel stand-in');assert(await p.locator('#recap-share').isEnabled());
  // A cached period remains labelled when offline. Retry after a draw failure keeps selected options.
  await p.locator('[data-recap-period=this_month]').click();await pictureReady(p);
  await c.route('**/api/recaps?*',r=>r.abort());await p.locator('[data-recap-period=this_week]').click();await pictureReady(p);assert.match(await p.locator('#recap-status').innerText(),/last data loaded/);await c.unroute('**/api/recaps?*');
  await p.evaluate(()=>{const original=ShareArt.blob;ShareArt.blob=async canvas=>{ShareArt.blob=original;throw Error('Fictional draw failure');};});await p.locator('[data-recap-option=food]').click();await p.locator('#recap-retry').waitFor();assert(await p.locator('#recap-share').isDisabled());await p.locator('#recap-retry').click();await pictureReady(p);assert.equal(await p.locator('[data-recap-option=food]').getAttribute('aria-pressed'),'true');
  for(const key of await p.locator('[data-recap-option][aria-pressed=true]').evaluateAll(ns=>ns.map(n=>n.dataset.recapOption))){await p.locator(`[data-recap-option=${key}]`).click();await pictureReady(p);}assert(await p.locator('#recap-share').isDisabled(),'no sections cannot share');
  assert.deepEqual(errors,[]);console.log('Recaps:384 real-canvas option/period/format exports; cache/retry/cancel/no-section guards PASS');
 }finally{for(const c of contexts)await c.close().catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
