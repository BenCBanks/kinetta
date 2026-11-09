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
  window.milestoneArt={draws:[],texts:[],positions:[],calls:0};const a=window.milestoneArt,paint=MapTiles.paint;
  MapTiles.paint=async(g,points,box,geometry)=>{a.draws.push({points,box});return paint(g,points,box,geometry);};
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){a.texts.push(String(text));if(this.canvas?.width===1080&&this.canvas?.height===1350)a.positions.push({text:String(text),y:Number(args[1])||0});return fill.call(this,text,...args);};
  const simple=ShareArt.simplePicture;ShareArt.simplePicture=async options=>{const result=await simple(options);a.blob=result.blob;return result;};
  ShareArt.deliver=async()=>{a.calls++;return false;};
 });
 const item={id:'33333333-3333-4333-8333-333333333333',activity_id:987654,kind:'sport',title:'First hike on Kinetta',day:'2026-11-01',private_activity:false,details:{distance_m:7200,seconds:5400,sport:'hike',garmin_sources:['Garmin Demo']}};
 const points=Array.from({length:61},(_,n)=>[40+n*.001,-75+Math.sin(n/7)*.006]);
 const encoded=points.map(([lat,lon],i)=>[Math.round(lat*1e5)-(i?Math.round(points[i-1][0]*1e5):0),Math.round(lon*1e5)-(i?Math.round(points[i-1][1]*1e5):0)].map(n=>{let v=n<0?~(n<<1):n<<1,s='';while(v>=32){s+=String.fromCharCode((32|(v&31))+63);v>>=5;}return s+String.fromCharCode(v+63);}).join('')).join('');
 let scenario='route',trim=0,receipts=[],currentItem=item;
 await p.route('**/api/milestones?*',r=>r.fulfill({json:{items:[{...currentItem,private_activity:scenario==='private'}],pending:false}}));
 await p.route('**/api/activities/987654',r=>r.fulfill({json:{id:item.activity_id,visibility:scenario==='private'?'me':'friends',line:scenario==='no-gps'?null:encoded}}));
 await p.route('**/api/activities/987654/social',r=>r.fulfill({json:{visibility:scenario==='private'?'me':'friends',details:{map:scenario!=='map-off'},trim_m:trim}}));
 await p.route('**/api/milestones/*/seen',r=>{receipts.push(r.request().postDataJSON());return r.fulfill({json:{}});});
 for(const name of ['route','no-gps','trimmed','private','map-off']){
  scenario=name;trim=name==='trimmed'?800:0;const captureItem=name==='no-gps'&&theme==='dark'?{...item,title:'Fictional time-only milestone',details:{...item.details,distance_m:0}}:item;currentItem=captureItem;await p.evaluate(()=>{window.milestoneArt.draws=[];window.milestoneArt.texts=[];window.milestoneArt.positions=[];});
  await p.evaluate(item=>Milestones.open(item),captureItem);await ready();
  const got=await p.evaluate(()=>window.milestoneArt);const mapped=['route','trimmed'].includes(name);assert.equal(got.draws.length,mapped?1:0,name+' map presence');
  if(name==='no-gps'){
   const timeOnly=Number(captureItem.details.distance_m)===0,expectedValue=timeOnly?'1h 30m':await p.evaluate(()=>U.dist(7200,1)),amount=got.positions.find(row=>row.text===expectedValue),fact=got.positions.find(row=>timeOnly?row.text==='Workout time':row.text==='Workout time: 1h 30m');assert(amount&&fact,`mapless milestone keeps a readable value and compact time (${expectedValue}, ${JSON.stringify(got.positions.map(row=>row.text))})`);assert(!/\b\d+:\d{2}(?::\d{2})?\b/.test([...got.texts,await p.locator('[data-share-image="0"]').getAttribute('alt')].join(' ')),'milestone picture omits seconds');
   const pixels=await p.evaluate(async()=>{const blob=window.milestoneArt.blob,url=URL.createObjectURL(blob),image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,1080,1350).data,bg=(600*1080+40)*4,counts=new Uint16Array(1350);for(let y=250;y<1228;y++)for(let x=60;x<1020;x++){const i=(y*1080+x)*4;if(Math.max(Math.abs(data[i]-data[bg]),Math.abs(data[i+1]-data[bg+1]),Math.abs(data[i+2]-data[bg+2]))>24)counts[y]++;}let run=0,maxBlankRun=0;for(let y=250;y<1228;y++){if(counts[y]===0){run++;maxBlankRun=Math.max(maxBlankRun,run);}else run=0;}URL.revokeObjectURL(url);return{maxBlankRun,inkRows:[...counts].map((n,y)=>n?y:-1).filter(y=>y>=0)};});
   assert(pixels.inkRows.some(y=>y>=amount.y-170&&y<amount.y)&&pixels.inkRows.some(y=>y>=fact.y-48&&y<=fact.y),'mapless milestone value and time are visible in the rendered pixels');assert(pixels.maxBlankRun<=(timeOnly?420:320),'mapless milestone has no large empty row gap: '+pixels.maxBlankRun+'px');
  }
  if(mapped){assert(got.texts.some(x=>x.includes('OpenStreetMap'))&&got.texts.some(x=>x.includes('Demo map tiles')),'configured map attribution visible');const actual=got.draws[0].points;assert(actual.length>1&&actual.length<points.length);assert(actual[0][0]>points[0][0]&&actual.at(-1)[0]<points.at(-1)[0],'both endpoints hidden');assert.equal(got.draws[0].box.under>0,true,'credit has route-free space');}
  const alt=await p.locator('[data-share-image="0"]').getAttribute('alt');assert(alt.includes(captureItem.title),'alt text keeps the fictional milestone title');if(name==='no-gps'&&theme==='dark')assert(alt.includes('1h 30m')&&alt.includes('Workout time'),'time-only milestone alt text keeps its compact value');else assert.match(alt,/Milestone.*First hike.*(?:7.2.*km|4.5.*mi).*Workout time: 1h 30m/);assert(!alt.includes('@alex'),'identity off');
  assert(got.texts.includes('Kinetta')&&got.texts.some(x=>x.includes('Garmin Demo')),'brand/device credit present');
  if(out&&name!=='map-off'){
   const blob=await p.evaluate(async()=>Array.from(new Uint8Array(await window.milestoneArt.blob.arrayBuffer())));fs.mkdirSync(out,{recursive:true});const filename=name==='no-gps'&&theme==='dark'?'milestone-time-only.png':`milestone-${name==='no-gps'?'mapless':name}-${theme}.png`;fs.writeFileSync(`${out}/${filename}`,Buffer.from(blob));
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
