// Actual milestone canvas and handoff with fictional owner responses. No export leaves the browser.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
module.exports=async function milestonePictures(p,theme,out){
 const ready=async()=>{for(let i=0;i<150;i++){if(await p.evaluate(()=>document.querySelector('[data-share-image="0"]')?.naturalWidth>0&&!document.querySelector('[data-share-send]').disabled))return;await p.waitForTimeout(100);}throw Error('Milestone picture did not finish');};
 const origin=new URL(p.url()).origin;
 await p.route('**/api/map-config',r=>r.fulfill({json:{kind:'raster',url:origin+'/milestone-demo-tiles/{z}/{x}/{y}.svg',max_zoom:18,attribution:'Demo map tiles'}}));
 await p.route('**/milestone-demo-tiles/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9f0e6"/><path d="M0 190 Q130 120 256 160" stroke="#b8d6e6" stroke-width="36" fill="none"/><path d="M-10 40 L270 110 M50 -10 L150 270" stroke="white" stroke-width="12"/><path d="M-10 40 L270 110 M50 -10 L150 270" stroke="#ccd1cf" stroke-width="2"/></svg>'}));
 await p.evaluate(()=>{
  window.milestoneOriginals={paint:MapTiles.paint,fill:CanvasRenderingContext2D.prototype.fillText,simple:ShareArt.simplePicture,deliver:ShareArt.deliver};
  window.milestoneArt={draws:[],texts:[],calls:0};const a=window.milestoneArt,paint=MapTiles.paint;
  MapTiles.paint=async(g,points,box,geometry)=>{a.draws.push({points,box});return paint(g,points,box,geometry);};
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){a.texts.push(String(text));return fill.call(this,text,...args);};
  const simple=ShareArt.simplePicture;ShareArt.simplePicture=async options=>{const result=await simple(options);a.blob=result.blob;return result;};
  ShareArt.deliver=async()=>{a.calls++;return false;};
 });
 const item={id:'33333333-3333-4333-8333-333333333333',activity_id:987654,kind:'sport',title:'First hike on Kinetta',day:'2026-11-01',private_activity:false,details:{distance_m:7200,seconds:5400,sport:'hike',garmin_sources:['Garmin Demo']}};
 const points=Array.from({length:61},(_,n)=>[40+n*.001,-75+Math.sin(n/7)*.006]);
 const encoded=points.map(([lat,lon],i)=>[Math.round(lat*1e5)-(i?Math.round(points[i-1][0]*1e5):0),Math.round(lon*1e5)-(i?Math.round(points[i-1][1]*1e5):0)].map(n=>{let v=n<0?~(n<<1):n<<1,s='';while(v>=32){s+=String.fromCharCode((32|(v&31))+63);v>>=5;}return s+String.fromCharCode(v+63);}).join('')).join('');
 let scenario='route',trim=0,receipts=[];
 await p.route('**/api/milestones?*',r=>r.fulfill({json:{items:[{...item,private_activity:scenario==='private'}],pending:false}}));
 await p.route('**/api/activities/987654',r=>r.fulfill({json:{id:item.activity_id,visibility:scenario==='private'?'me':'friends',line:scenario==='no-gps'?null:encoded}}));
 await p.route('**/api/activities/987654/social',r=>r.fulfill({json:{visibility:scenario==='private'?'me':'friends',details:{map:scenario!=='map-off'},trim_m:trim}}));
 await p.route('**/api/milestones/*/seen',r=>{receipts.push(r.request().postDataJSON());return r.fulfill({json:{}});});
 for(const name of ['route','no-gps','trimmed','private','map-off']){
  scenario=name;trim=name==='trimmed'?800:0;await p.evaluate(()=>{window.milestoneArt.draws=[];window.milestoneArt.texts=[];});
  await p.evaluate(item=>Milestones.open(item),item);await ready();
  const got=await p.evaluate(()=>window.milestoneArt);const mapped=['route','trimmed'].includes(name);assert.equal(got.draws.length,mapped?1:0,name+' map presence');
  if(mapped){assert(got.texts.some(x=>x.includes('OpenStreetMap'))&&got.texts.some(x=>x.includes('Demo map tiles')),'configured map attribution visible');const actual=got.draws[0].points;assert(actual.length>1&&actual.length<points.length);assert(actual[0][0]>points[0][0]&&actual.at(-1)[0]<points.at(-1)[0],'both endpoints hidden');assert.equal(got.draws[0].box.under>0,true,'credit has route-free space');}
  const alt=await p.locator('[data-share-image="0"]').getAttribute('alt');assert.match(alt,/Milestone.*First hike.*(?:7.2.*km|4.5.*mi).*Workout time/);assert(!alt.includes('@alex'),'identity off');
  assert(got.texts.includes('Kinetta')&&got.texts.some(x=>x.includes('Garmin Demo')),'brand/device credit present');
  if(out&&name!=='map-off'){
   const blob=await p.evaluate(async()=>Array.from(new Uint8Array(await window.milestoneArt.blob.arrayBuffer())));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/milestone-${name}-${theme}.png`,Buffer.from(blob));
  }
  await p.keyboard.press('Escape');
 }
 // Revalidate privacy and geometry just before delivery, then require a fresh deliberate Share tap.
 scenario='route';trim=400;await p.evaluate(item=>Milestones.open(item),item);await ready();scenario='map-off';
 await p.locator('[data-share-send]').click();await ready();assert.match(await p.locator('.share-picture-status').innerText(),/Review this updated picture/);assert.equal(await p.evaluate(()=>window.milestoneArt.calls),0,'stale map never handed off');
 await p.locator('[data-share-send]').click();await ready();assert.equal(await p.evaluate(()=>window.milestoneArt.calls),1);assert.equal(receipts.length,0,'cancel never dismisses');await p.keyboard.press('Escape');
 scenario='route';await p.evaluate(item=>Milestones.open(item),item);await ready();trim=800;
 await p.locator('[data-share-send]').click();await ready();assert.equal(await p.evaluate(()=>window.milestoneArt.calls),1,'changed crop requires review');await p.keyboard.press('Escape');
 // A successful handoff followed by a failed receipt retries only the receipt, with no coordinates.
 scenario='route';await p.evaluate(item=>Milestones.open(item),item);await ready();
 await p.evaluate(()=>{ShareArt.deliver=async()=>{window.milestoneArt.calls++;return true;};window.milestoneReceiptApi=api;let fail=true;api=async(path,...args)=>{if(path.endsWith('/seen')&&fail){fail=false;throw Error('Fictional receipt failure');}return window.milestoneReceiptApi(path,...args);};});
 await p.locator('[data-share-send]').click();await p.locator('.share-picture-status').getByText(/Picture shared/).waitFor();
 const draws=await p.evaluate(()=>window.milestoneArt.draws.length);await p.route('**/api/activities/987654**',r=>r.abort());await p.locator('[data-share-send]').click();await p.locator('[data-unified-share]').waitFor({state:'detached'});
 assert.equal(await p.evaluate(()=>window.milestoneArt.calls),2,'receipt retry does not deliver twice');assert.equal(await p.evaluate(()=>window.milestoneArt.draws.length),draws,'receipt retry does not refetch/redraw');await p.unroute('**/api/activities/987654**');assert.deepEqual(receipts,[{action:'shared'}],'receipt carries action only');await p.evaluate(()=>{api=window.milestoneReceiptApi;delete window.milestoneReceiptApi;});
 await p.evaluate(()=>{const o=window.milestoneOriginals;MapTiles.paint=o.paint;CanvasRenderingContext2D.prototype.fillText=o.fill;ShareArt.simplePicture=o.simple;ShareArt.deliver=o.deliver;delete window.milestoneOriginals;});
 await p.unroute('**/api/milestones?*');await p.unroute('**/api/activities/987654');await p.unroute('**/api/activities/987654/social');await p.unroute('**/api/milestones/*/seen');
 console.log('Milestone route/no-GPS/endpoint trim/private/map-off and stale privacy/crop handoff PASS',theme);
};
