'use strict';

async function waitForMaps(page, {advanceMapFade = false, requireMap = false} = {}){
  let visibleMaps=0;
  for(const preview of await page.locator('.fmap:visible').all()){
    if(!await preview.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    visibleMaps++;
    const deadline=Date.now()+15000;
    while(Date.now()<deadline&& !await preview.evaluate(el=>el.classList.contains('ready')))await page.waitForTimeout(100);
    if(!await preview.evaluate(el=>el.classList.contains('ready')))throw Error('Visible feed map did not initialize within 15 seconds');
  }
  for(const map of await page.locator('.leaflet-container:visible').all()){
    if(!await map.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    visibleMaps++;
    const snapshot=()=>map.evaluate(el=>{
      const box=el.getBoundingClientRect(),tiles=[...el.querySelectorAll('.leaflet-tile')].filter(tile=>{const r=tile.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<Math.min(box.right,innerWidth)&&r.right>Math.max(box.left,0)&&r.top<Math.min(box.bottom,innerHeight)&&r.bottom>Math.max(box.top,0);});
      return tiles.map(tile=>({id:tile.dataset.captureMapTileId ||= String(window.__captureMapTileId=(window.__captureMapTileId||0)+1),url:tile.currentSrc||tile.src||'(tile URL unavailable)',loaded:tile.classList.contains('leaflet-tile-loaded'),opacity:Number(getComputedStyle(tile).opacity)}));
    });
    let stable=0,previous='',tiles=[];
    const tileDeadline=Date.now()+15000;
    while(Date.now()<tileDeadline&&stable<3){
      tiles=await snapshot();const signature=JSON.stringify(tiles.map(tile=>[tile.id,tile.url,tile.loaded]));
      stable=tiles.length&&tiles.every(tile=>tile.loaded)&&signature===previous?stable+1:0;previous=signature;
      if(stable<3)await page.waitForTimeout(100);
    }
    const describeFailures=items=>items.filter(tile=>!tile.loaded||tile.opacity<0.999).map(tile=>`${tile.url} [${tile.loaded?'loaded':'not loaded'}, opacity ${tile.opacity}]`);
    if(stable<3){
      tiles=await snapshot();
      const failed=describeFailures(tiles);throw Error(`Visible basemap tiles did not become loaded and idle within 15 seconds; failed tiles: ${failed.length?failed.join('; '):'tile set kept changing or no visible tiles were found'}`);
    }
    if(advanceMapFade){
      // A later map or replacement tile can finish after another map's fade.
      // Advance only for newly loaded tile identities, after their loaded timestamp exists.
      const advanced=new Set();
      let opaqueStable=0,fadeSignature='',fadeTiles=[];const fadeDeadline=Date.now()+5000;
      while(Date.now()<fadeDeadline&&opaqueStable<3){
        fadeTiles=await snapshot();
        const newlyLoaded=fadeTiles.filter(tile=>tile.loaded&&!advanced.has(tile.id));
        if(newlyLoaded.length){
          await page.clock.setFixedTime(new Date(await page.evaluate(()=>Date.now())+250));
          for(const tile of newlyLoaded)advanced.add(tile.id);
          fadeTiles=await snapshot();
        }
        const failed=describeFailures(fadeTiles),signature=JSON.stringify(fadeTiles.map(tile=>[tile.id,tile.url,tile.opacity]));
        const opaque=fadeTiles.length>0&&failed.length===0&&fadeTiles.every(tile=>tile.opacity>=0.999);
        opaqueStable=opaque&&signature===fadeSignature?opaqueStable+1:0;fadeSignature=signature;
        if(opaqueStable<3)await page.waitForTimeout(100);
      }
      if(opaqueStable<3){
        fadeTiles=await snapshot();const failed=describeFailures(fadeTiles);
        throw Error(`Visible basemap tiles did not finish fading in within 5 seconds; failed tiles: ${failed.length?failed.join('; '):'tile opacity kept changing or stayed below 0.999'}`);
      }
    }
  }
  if(requireMap&&!visibleMaps)throw Error('Visible basemap map did not appear in the capture viewport');
  if(await page.locator('.map-unavailable:visible').count())throw Error('Visible basemap unavailable; the capture requires a loaded approved basemap');
}

// Track archive work independently of Playwright's route registry. Removing routes
// first can dispose route.fetch's request context while an upstream read is pending.
const relays=new WeakMap();
async function installArchiveRelay(context,{archiveOrigin,publishedOrigin,browserOrigin,requireRange=true,cache=null,onError=error=>{throw error;},log=console.log}){
  const state={pending:new Set(),closing:false};relays.set(context,state);
  await context.route(archiveOrigin+'/**',route=>{
    const request=route.request();
    if(state.closing)return route.abort();
    const work=(async()=>{
      const method=request.method(),range=request.headers().range;
      if(!['GET','HEAD'].includes(method)||requireRange&&method==='GET'&&!range)return route.abort();
      const cached=method==='GET'&&cache?.get(request.url(),range);
      if(cached){
        if(request.headers()['if-match']&&request.headers()['if-match']!==cached.headers.etag)throw Error('Capture request archive validator mismatch');
        await route.fulfill({...cached,headers:{...cached.headers,'access-control-allow-origin':browserOrigin,'access-control-expose-headers':'content-range,content-length,etag'}});return;
      }
      for(let attempt=0;;attempt++){
        const began=Date.now();
        try{
          const response=await route.fetch({headers:{...request.headers(),origin:publishedOrigin,referer:publishedOrigin+'/'},timeout:60_000});
          log(JSON.stringify({mapRange:range||'(HEAD)',attempt:attempt+1,status:response.status(),contentRange:response.headers()['content-range']||null,elapsedMs:Date.now()-began}));
          if(!response.ok()||range&&response.status()!==206)throw Error('Approved capture map source returned HTTP '+response.status());
          await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':browserOrigin,'access-control-expose-headers':'content-range,content-length,etag'}});
          return;
        }catch(error){
          // Navigation may cancel a browser request while its public Range read completes.
          // Other failures remain capture errors, even if a later map retry paints.
          const cancelled=!!request.failure();
          const transient=error?.name==='TimeoutError'||/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(error?.message||'');
          log(JSON.stringify({mapRange:range||'(HEAD)',attempt:attempt+1,elapsedMs:Date.now()-began,outcome:cancelled?'browser-cancelled':transient?'transport-error':'relay-error'}));
          if(cancelled)return;
          if(!transient||attempt>=1)throw error;
          await new Promise(resolve=>setTimeout(resolve,300));
        }
      }
    })().catch(async error=>{
      // Route callbacks must not become unhandled rejections during cleanup.
      try{await route.abort();}catch(_){} // The browser may already have cancelled it.
      onError(error);
    });
    state.pending.add(work);
    return work.finally(()=>state.pending.delete(work));
  });
}
async function closeCaptureContext(context){
  if(!context)return;
  const state=relays.get(context);
  if(state){state.closing=true;await Promise.allSettled([...state.pending]);}
  for(const page of context.pages())await page.unrouteAll({behavior:'wait'});
  await context.unrouteAll({behavior:'wait'});
  await context.close();
  relays.delete(context);
}
module.exports={waitForMaps,installArchiveRelay,closeCaptureContext};
