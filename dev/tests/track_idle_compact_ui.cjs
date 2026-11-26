// Fictional idle native shell: no location, recording, Health, provider or external tile calls.
'use strict';
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',phase=process.env.TRACK_CAPTURE_PHASE||'after',out=process.env.KINETTA_SHOTS;
const safeCSS=(body,size)=>body.replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g,(size.safeTop??47)+'px').replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g,(size.safeBottom??34)+'px');
async function until(page,fn){await page.waitForFunction(fn,null,{timeout:20000});}
(async()=>{
 cp.execFileSync('python3',['dev/tests/track_fixture.py'],{env:process.env,stdio:'inherit'});
 const browser=await(process.env.TRACK_BROWSER==='webkit'?webkit:chromium).launch(),metrics=[];
 try{for(const size of [{width:390,height:844},{width:375,height:667},{width:330,height:667},{width:390,height:844,safe:true},{width:375,height:667,safe:true,safeTop:20,safeBottom:0}])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true});
  const signed=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'zz_test_track_empty',password:'green teapot on the hill',app:true}});assert.equal(signed.status(),200);
  const token=(await signed.json()).token;
  await context.addInitScript(({base,token})=>{
   window.trackStarts=[];const prefs={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>['KinettaTrack','Preferences'].includes(n),Plugins:{Preferences:{get:async({key})=>({value:prefs[key]??null}),set:async({key,value})=>prefs[key]=value,remove:async({key})=>delete prefs[key]},KinettaTrack:{attach:async()=>({}),detach:async()=>({}),status:async()=>({}),locate:async()=>({lat:40.7812,lon:-73.9665,accuracy:12,timestamp:Date.now()}),intervalCapabilities:async()=>({intervalCapabilities:{outdoor:true}}),start:async args=>{trackStarts.push(args);throw Error('Fictional recording blocked');}}}};
  },{base,token});
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==base)return route.abort();
   if(phase==='before'&&process.env.TRACK_BASELINE_DIR){const name={'/static/app-shell.js':'app-shell.js','/static/pages.js':'pages.js','/static/track-route.js':'app/static/track-route.js','/static/track-route.css':'app/static/track-route.css'}[u.pathname];if(name){let body=fs.readFileSync(process.env.TRACK_BASELINE_DIR+'/'+name,'utf8');if(size.safe&&name.endsWith('.css'))body=safeCSS(body,size);return route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body});}}
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return route.fulfill({json:{}});}
   if(size.safe&&u.pathname.endsWith('.css')){const response=await route.fetch();return route.fulfill({response,body:safeCSS(await response.text(),size)});}
   if(u.pathname==='/api/map-config')return route.fulfill({json:{kind:'raster',url:base+'/__idle_tiles/light/{z}/{x}/{y}.svg',dark_url:base+'/__idle_tiles/dark/{z}/{x}/{y}.svg',max_zoom:18,attribution:'Protomaps'}});
   if(u.pathname.startsWith('/__idle_tiles/')){const dark=u.pathname.includes('/dark/');return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${dark?'#252d33':'#e4e9ee'}"/><path fill="${dark?'#294438':'#c5ddc9'}" d="M0 140L75 113 95 220 18 240zM190 0h66v70l-40 22z"/><path d="M-10 90Q45 104 87 82T170 73T267 88M-8 220Q58 193 104 214T265 195M83 -8Q102 40 90 92T103 264M208 -10Q183 43 201 94T187 268" fill="none" stroke="${dark?'#53606b':'#fff'}" stroke-width="8"/></svg>`});}return route.continue();});
  await page.goto(base+'/track');await until(page,()=>App.pageReady&&document.querySelector('#track-gps-chip')?.textContent==='GPS ready'&&document.querySelector('.leaflet-tile-loaded')&&document.querySelector('#track-explore')?.getAttribute('aria-busy')==='false');
  await page.waitForTimeout(250);
  const geometry=await page.evaluate(()=>{const rect=s=>{const n=document.querySelector(s),r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return{screen:innerHeight,document:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,header:rect('#page > .top'),shellPaddingTop:parseFloat(getComputedStyle(document.querySelector('#page')).paddingTop),map:rect('#track-ready-map'),selector:rect('.track-sport-row'),start:rect('#track-start'),past:rect('#track-log-past'),tabs:rect('nav.tabs'),gps:rect('#track-gps-chip'),locate:rect('#track-locate'),full:rect('.map-full'),attribution:rect('.leaflet-control-attribution'),options:[rect('#interval-open'),rect('#track-options')]};});
  metrics.push({width:size.width,theme,safe:!!size.safe,...geometry});
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${phase}-${size.width}-${theme}${size.safe?'-safe':''}.png`,animations:'disabled'});}
  if(phase!=='before'){
   const safeTop=size.safe?(size.safeTop??47):0;assert.equal(geometry.header.y,safeTop,'native header starts at the safe-area edge');assert.equal(geometry.shellPaddingTop,safeTop,'native shell adds no extra header gap');
   assert(geometry.document<=size.height+1,'idle page needs no vertical scroll: '+JSON.stringify(geometry));assert(geometry.scrollWidth<=size.width,'no horizontal scroll');
   assert(geometry.selector.height<=57&&geometry.selector.height>=44,'compact one-row selector');
   if(size.width===390)assert(geometry.map.height>=size.height/2,'map gets at least half the screen');
   assert(geometry.map.width>=size.width-32,'near full-width map');assert(geometry.start.bottom<=geometry.tabs.y-7,'Start clears tabs');assert(geometry.tabs.y-geometry.start.bottom<18,'Start is docked just above tabs: '+JSON.stringify(geometry));
   assert(Math.abs(geometry.options[0].width-geometry.options[1].width)<1&&Math.abs(geometry.options[0].y-geometry.options[1].y)<1,'equal options in one row');
   assert(Math.abs(geometry.gps.y-geometry.locate.y)<1&&Math.abs(geometry.full.y-geometry.locate.y)<1,'GPS and buttons share top inset');
   assert(geometry.attribution.right<=geometry.map.right&&geometry.attribution.bottom<=geometry.map.bottom&&geometry.attribution.bottom>=geometry.map.bottom-10,'visible bottom-right attribution');
   assert.equal(await page.locator('#track-explore a').count(),0,'Connections moves behind gear');
   await page.locator('#track-options').click();await page.locator('#track-voice').waitFor();await page.keyboard.press('Escape');
   await page.locator('#interval-open').click();await page.locator('#interval-library').waitFor();await page.keyboard.press('Escape');
   await page.locator('#track-settings').click();await page.locator('[data-track-feature=connections]').waitFor();
   const settings=await page.locator('.sheet .inset-row').evaluateAll(rows=>rows.map(n=>({height:n.getBoundingClientRect().height,chevron:n.querySelector('.chev svg')?.getBoundingClientRect().width})));assert(settings.every(n=>n.height>=44&&n.height<=56&&n.chevron===18),'settings use compact rows and standard chevrons: '+JSON.stringify(settings));
   if(out)await page.screenshot({path:`${out}/settings-${size.width}-${theme}${size.safe?'-safe':''}.png`,animations:'disabled'});
   await page.locator('[data-track-feature=connections]').click();await page.waitForURL('**/me/settings/connections');
   await page.goto(base+'/track');await page.locator('#track-start').waitFor();await page.locator('#track-log-past').click();await page.locator('#ma').waitFor();await page.keyboard.press('Escape');
   assert.deepEqual(await page.evaluate(()=>trackStarts),[],'configuration and past workout never start recording');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(p=>p!=='/api/challenges/signup/continue'),[]);await context.close();
  console.log(`Track idle ${phase} ${size.width}x${size.height} ${theme}${size.safe?' safe-area emulation':''}: map ${geometry.map.height}px / doc ${geometry.document}px`);
 }}finally{await browser.close();}
 if(out)fs.writeFileSync(out+'/geometry.json',JSON.stringify(metrics,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
