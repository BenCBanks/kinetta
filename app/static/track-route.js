// Track route leaf — loaded only when /track is opened.
// This file intentionally runs without strict mode so the scoped route context can
// expose the eager recorder state without copying it.
(function (ctx) {
  with (ctx) {
  // You are here (Ben, 2026-10-26: always show exactly where you are, to prove it's accurate): an Apple Maps-style dot
  // with a ring the size of the GPS accuracy, so a wide ring honestly says the fix is rough; the label gives the number.
  function hereMarker(view, prev, lat, lon, accuracy) {
    const {L, map} = view, at = [lat, lon], r = Math.max(3, Math.min(Number(accuracy) || 0, 200));
    if (prev && map.hasLayer(prev.dot)) { prev.ring.setLatLng(at).setRadius(r); prev.dot.setLatLng(at); prev.dot.bringToFront(); return prev; }
    return {ring: L.circle(at, {radius: r, stroke: false, fillColor: col('--accent'), fillOpacity: .16, interactive: false}).addTo(map),
            dot: L.circleMarker(at, {radius: 8, weight: 3, color: '#fff', fillColor: col('--accent'), fillOpacity: 1, interactive: false}).addTo(map)};
  }
  const gpsText = (a) => Number.isFinite(+a) && a > 0 ? `GPS ±${Math.max(1, Math.round(imp() ? a * 3.28084 : a))} ${imp() ? 'ft' : 'm'}` : '';
  let follow = true;     // the live map follows you; "Whole route" shows everything so far
  let fitWhole=false;
  function lines() { const by = new Map(); for (const p of session.points) { if (!by.has(p.segment)) by.set(p.segment, []); by.get(p.segment).push([p.lat, p.lon]); } return [...by.values()].filter((a) => a.length > 1); }
  function drawRouteLines(view, routeLines=lines()) {
    const failed=$('.map-unavailable',view.el)?.hidden===false, color=view.routeColor?.() || col('--route');
    view.group.clearLayers();
    const renderer=failed?view.L.canvas({padding:.5}):null;
    for(const pts of routeLines)view.L.polyline(pts,{color,weight:4,opacity:.95,...(renderer?{renderer}:{})}).addTo(view.group);
    view.canvasRouteFallback=failed;
  }
  function watchTileFailures(view) {
    const note=$('.map-unavailable',view.el);if(!note||view.trackTileObserver)return;
    const observer=new MutationObserver(()=>drawRouteLines(view));observer.observe(note,{attributes:true,attributeFilter:['hidden']});
    view.trackTileObserver=observer;view.map.once('unload',()=>observer.disconnect());
  }
  function refreshMap() {
    if(session?.locationDenied)return;
    if (mapTimer) return;
    mapTimer = setTimeout(async () => {
      const el=$('#track-map'),recording=session?.id,expected=owner;
      try {
        if (!el || !session) return;
        const ln = lines(); el.hidden = false;
        if (!mapView || mapView.el !== el) {
          const view = await mapInto(el, ln, {sport: session.sport, still: false, ends: false});
          if(session?.id!==recording||readOwner()!==expected||!el.isConnected)return;
          if (view && el.isConnected) { mapView = {...view, el, here: null}; mapView.map.on('dragstart', () => { follow = false;fitWhole=false; followButton(); });el.addEventListener('wheel',()=>{follow=false;fitWhole=false;followButton();},{passive:true});el.addEventListener('touchstart',e=>{if(e.touches.length>1){follow=false;fitWhole=false;followButton();}},{passive:true}); }
        }
        if (!mapView || !el.isConnected) return;
        const {map, L} = mapView;watchTileFailures(mapView);drawRouteLines(mapView,ln);
        const last = session.points.at(-1);
        if (last) mapView.here = hereMarker(mapView, mapView.here, last.lat, last.lon, last.accuracy);
        if (follow && last) map.setView([last.lat, last.lon], Math.max(map.getZoom() || 0, 16), {animate: false});
        else if(fitWhole){const all=ln.flat();if(all.length)map.fitBounds(L.latLngBounds(all),{padding:[24,24],maxZoom:17,animate:false});fitWhole=false;}
        const chip = $('#track-gps-live'); if (chip) { chip.textContent = last ? gpsText(last.accuracy) : 'Finding GPS…'; chip.hidden = false; }
        followButton();
      } catch (_) { message = 'Map unavailable. Your timer and GPS recording continue.'; update(); }
      finally {
        mapTimer = null;
        // Resume, Pause or Finish can replace the map while its renderer is still loading.
        const current=$('#track-map');
        if(recording&&session?.id===recording&&session.gps&&owner===expected&&readOwner()===expected&&current?.isConnected&&current!==el&&mapView?.el!==current)refreshMap();
      }
    }, mapView?.el===$('#track-map')?1200:0);
  }
  function followButton() { const b = $('#track-follow'); if (b) { const label=follow?'Whole route':'Follow me';b.innerHTML = `${svg('track')}<span>${label}</span>`;b.setAttribute('aria-label',label);b.setAttribute('title',label);b.setAttribute('aria-pressed', String(!follow)); } }
  function discard() {
    const id=session?.id,account=readOwner(),live=()=>session?.id===id&&account===readOwner();if(!id)return;
    sheet('Discard this recording?', '<p>This removes the draft from this device. It has not been saved as an activity.</p><button class="ghost wide" id="tr-keep">Keep recording</button><button class="primary danger-btn wide" id="tr-discard">Discard recording</button>', (b, close) => {
      $('#tr-keep', b).onclick = close;
      $('#tr-discard', b).onclick = async () => {
        if(!live() || saving || photoBusy || reviewDraft?.request)return;
        const btn=$('#tr-discard',b),scope=key;btn.disabled=true;controlling=true;
        try {
          if(session.native){nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear',{id,discardIntervals:!!session.intervals});}
          if(!live())return;await TrackReviewStore.remove(scope,id);
          if(!live())return;stopGPS();store.del(scope);session=null;reviewDraft=null;message='';close();draw();sync();
        }catch(e){if(live()){toast(e.message);btn.disabled=false;}}finally{controlling=false;}
      };
    });
  }
  function discardReview() {
    const id=session?.id,account=readOwner(),live=()=>session?.id===id&&account===readOwner();if(!id)return;
    const distance=session.gps?`${U.dist(session.distance,2)} ${U.du()}`:'Indoor workout';
    const elapsed=session.native&&Number.isFinite(session.elapsedSeconds)?session.elapsedSeconds:((session.finishedAt||Date.now())-session.start)/1000;
    sheet('Discard this run?', `<p>${esc(distance)} · ${clock(elapsed)} will be deleted.</p><button class="primary danger-btn wide" id="tr-discard">Discard run</button><button class="ghost wide" id="tr-keep">Keep</button>`, (b, close) => {
      $('#tr-keep',b).onclick=close;
      $('#tr-discard',b).onclick=async()=>{
        if(!live()||saving||photoBusy||reviewDraft?.request)return;
        const btn=$('#tr-discard',b),scope=key;btn.disabled=true;controlling=true;
        try {
          if(session.native){nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear',{id,discardIntervals:!!session.intervals});}
          if(!live())return;await TrackReviewStore.remove(scope,id);
          if(!live())return;stopGPS();store.del(scope);session=null;reviewDraft=null;message='';saveError='';close();draw();sync();
        }catch(e){if(live()){toast(e.message);btn.disabled=false;}}finally{controlling=false;}
      };
    }, {noClose:true,role:'alertdialog'});
  }
  // The pre-save review leads with title, headline figures and media/charts; details and splits stay available below.
  function climb(points) {
    // ups of more than 3 m from the last low point, within one section; few or poor altitudes give no figure at all
    let gain = 0, ref = null, n = 0;
    for (const p of points) {
      if (!Number.isFinite(p.alt) || (Number.isFinite(p.valt) && p.valt > 15)) continue;
      n++;
      if (!ref || p.segment !== ref.segment) { ref = {alt: p.alt, segment: p.segment}; continue; }
      if (p.alt > ref.alt + 3) { gain += p.alt - ref.alt; ref.alt = p.alt; } else if (p.alt < ref.alt - 3) ref.alt = p.alt;
    }
    return n >= 10 ? gain : null;
  }
  // Same estimate as the server's energy.activity_kcal (no watch number exists for a phone recording yet): run ~1 kcal
  // per kg per km, walk/hike 0.6 plus climbing, ride 7 METs, anything else 5 METs. Profile weight, else 75 kg as there.
  function kcalEstimate(s, active, gain) {
    const kg = App.me?.weight_kg || 75, km = s.gps ? s.distance / 1000 : 0, h = active / 3600;
    if (s.sport === 'run' && km) return kg * km;
    if ((s.sport === 'walk' || s.sport === 'hike') && km) return kg * km * 0.6 + kg * (gain || 0) * 0.0098 / 0.25 / 4.184;
    return (s.sport === 'ride' ? 7 : 5) * kg * h;
  }
  function restoreReview() {
    if(session || !key || reviewRestore)return reviewRestore;
    const scope=key,expected=readOwner();
    reviewRestore=TrackReviewStore.pending(scope).then(d=>{
      if(!d || session || key!==scope || expected!==readOwner())return;
      const p=d.request,start=Date.parse(p.start);
      if(p.review_version!==1 || !Number.isFinite(start) || !Array.isArray(p.points) || !Number.isFinite(p.moving_s))return;
      session={...d.recording,id:d.id,sport:p.sport,sportLabel:p.sport_label,name:p.name,visibility:p.visibility,
        start,activeAt:start,activeMs:p.moving_s*1000,activeSeconds:p.moving_s,elapsedSeconds:p.elapsed_s,
        finishedAt:start+p.elapsed_s*1000,state:'review',points:p.points,distance:0,laps:p.laps};
      // The request owns the accepted GPS points; recover totals without joining pause sections.
      let anchor=null;for(const point of session.points){if(anchor?.segment!==point.segment)anchor=null;const step=TrackMath.step(anchor,point);if(step!==null){session.distance+=step;anchor=point;}}
      reviewDraft={...d,scope,id:d.id,loaded:true};persist();draw();
    }).catch(()=>{/* Ordinary Track setup remains usable; an existing review reports storage errors beside Retry. */});
    return reviewRestore;
  }
  function loadReview() {
    if(reviewDraft?.scope===key && reviewDraft.id===session.id)return;
    const scope=key,id=session.id,expected=readOwner(),draft={scope,id,photos:[],loaded:false};reviewDraft=draft;
    TrackReviewStore.read(scope,id).then(d=>{
      if(reviewDraft!==draft || session?.id!==id || key!==scope || expected!==readOwner())return;
      reviewDraft={...d,scope,id,loaded:true};if(d.request)session.name=d.request.name;draw();
    }).catch(e=>{if(reviewDraft===draft && expected===readOwner()){draft.error=e.message;draw();}});
  }
  function reviewPhotoHTML() {
    const d=reviewDraft,locked=saving || photoBusy || !d?.loaded || !!d.request;
    return `<div class="track-review-photos" aria-label="Activity photos">${d?.photos?.length ? `<div class="track-photo-list">${d.photos.map((image,i)=>`<figure><img src="${esc(image)}" alt="Selected activity photo ${i+1}"><button type="button" class="icon-btn" data-track-photo-remove="${i}" aria-label="Remove photo ${i+1}"${locked?' disabled':''}>${svg('close')}</button></figure>`).join('')}${!d?.request&&d.photos.length<10?`<button type="button" class="track-photo-add-tile" id="track-photos-add" aria-label="Add photos"${locked?' disabled':''}>${svg('plus')}</button>`:''}</div>`:''}
      ${!d?.photos?.length && !d?.request ? `<button type="button" class="track-review-photo-add" id="track-photos-add"${locked?' disabled':''}>${svg('camera')}<span>${photoBusy?'Preparing photos…':d?.loaded?'Add photos':'Opening photo storage…'}</span></button>`:''}
      ${!d?.request && (d?.photos?.length || 0)<10 ? `<input type="file" id="track-photos-file" accept="image/*" multiple hidden>`:''}
      ${d?.error?`<p class="small danger" role="alert">${esc(d.error)}</p><button type="button" class="ghost wide" id="track-review-retry">Retry photo storage</button>`:''}</div>`;
  }
  function wireReviewPhotos(live) {
    const add=$('#track-photos-add'),file=$('#track-photos-file');if(add)add.onclick=()=>file.click();
    if(file)file.onchange=async()=>{
      if(!live() || photoBusy || saving || !reviewDraft?.loaded || reviewDraft.request)return;
      const files=[...file.files];if(!files.length)return;
      const draft=reviewDraft,scope=key,id=session.id,expected=readOwner(),bound=()=>expected===readOwner()&&scope===key&&id===session?.id,current=()=>live()&&bound();
      if(files.length+draft.photos.length>10){toast('Choose up to 10 photos for this activity.');return;}
      photoBusy=true;const generation=++photoGeneration;draw();
      try {
        const photos=[...draft.photos];
        for(const f of files){if(f.size>20_000_000)throw Error('Choose photos under 20 MB each.');photos.push(await shrinkPhoto(f,1600));if(!current())return;}
        if(photos.reduce((n,p)=>n+p.length,0)>8_000_000)throw Error('These photos are too large together. Choose fewer photos.');
        const saved=await TrackReviewStore.photos(scope,id,photos);
        if(bound()){reviewDraft={...saved,scope,id,loaded:true};saveError='';}
      }catch(e){if(current())saveError=e.message || 'That photo could not be opened. Try a JPEG or PNG.';}
      finally{if(generation===photoGeneration){photoBusy=false;if(bound())draw();}}
    };
    $$('[data-track-photo-remove]').forEach(b=>b.onclick=async()=>{
      if(!live() || saving || photoBusy || reviewDraft?.request)return;
      const scope=key,id=session.id,expected=readOwner(),photos=reviewDraft.photos.filter((_,i)=>i!==+b.dataset.trackPhotoRemove);
      photoBusy=true;const generation=++photoGeneration;draw();
      try{const saved=await TrackReviewStore.photos(scope,id,photos);if(expected===readOwner()&&key===scope&&session?.id===id){reviewDraft={...saved,scope,id,loaded:true};saveError='';}}
      catch(e){if(live()&&expected===readOwner())saveError=e.message;}
      finally{if(generation===photoGeneration){photoBusy=false;if(expected===readOwner()&&key===scope&&session?.id===id)draw();}}
    });
    const retry=$('#track-review-retry');if(retry)retry.onclick=()=>{if(live()){reviewDraft=null;draw();}};
  }
  function reviewCharts() {
    const box=$('#track-review-charts');if(!box)return;
    const data=TrackReviewMath.samples(session,TrackMath),speed=speedSport(session),rows=[];
    if(data.speed.filter(v=>v>0).length>1)rows.push({name:speed?'Speed':'Pace',unit:speed?U.su():'/'+U.du(),color:col('--route'),
      vals:data.speed.map(v=>v>0?(speed?v*3600/(imp()?1609.344:1000):(imp()?1609.344:1000)/v):null),
      avg:session.distance>10?speed?session.distance/TrackMath.seconds(session)*3600/(imp()?1609.344:1000):TrackMath.seconds(session)/session.distance*(imp()?1609.344:1000):null,
      invert:!speed,fmt:v=>speed?v.toFixed(1):dur(v)});
    if(data.alt.filter(v=>v!=null).length>1)rows.push({name:'Elevation',unit:U.eu(),color:col('--s3'),vals:data.alt.map(v=>v==null?null:imp()?v*3.28084:v),fmt:v=>Math.round(v).toLocaleString()});
    if(rows.length){
      chartStack(box,data.t,rows,{xfmt:clock});
      const reveal=()=>box.classList.add('is-inspecting');
      box.querySelectorAll('.chartbox svg').forEach(svg=>{svg.addEventListener('pointerdown',reveal,{once:true});svg.addEventListener('keydown',reveal,{once:true});});
      box.querySelector('.readout button')?.addEventListener('click',()=>box.classList.remove('is-inspecting'));
    }else box.innerHTML='<p class="small muted">Not enough GPS samples for a chart.</p>';
  }
  function reviewHTML() {
    const active=TrackMath.seconds(session),elapsed=session.native && Number.isFinite(session.elapsedSeconds)?session.elapsedSeconds:((session.finishedAt || Date.now())-session.start)/1000;
    const avg=session.gps && session.distance>10 && active>0?session.distance/active:null,gain=session.gps?climb(session.points):null,start=new Date(session.start);
    const stat=(v,u,l)=>`<div><b class="num">${esc(v)}${u?`<i>${esc(u)}</i>`:''}</b><small>${esc(l)}</small></div>`;
    const headline=[session.gps && stat(U.dist(session.distance,2),U.du(),'Distance'),stat(clock(active),'','Active time'),avg && stat(rateText(session,avg),speedSport(session)?U.su():'/'+U.du(),speedSport(session)?'Avg speed':'Avg pace')].filter(Boolean).join('');
    const more=[elapsed-active>=30 && stat(clock(elapsed),'','Total time'),gain!=null && stat(U.elev(gain),U.eu(),'Elevation gain'),stat(Math.round(kcalEstimate(session,active,gain)).toLocaleString(),'kcal','Calories (est.)')].filter(Boolean).join('');
    const sp=session.splits || [],rows=sp.map((t,i)=>[`${unitName(session)} ${i+1}`,t-(i?sp[i-1]:0)]),rest=session.distance-sp.length*(session.splitMetres || 0);
    if(sp.length && session.splitMetres && rest>50)rows.push([`Last ${U.dist(rest,2)} ${U.du()}`,active-sp.at(-1)]);
    const laps=(session.laps || []).map((l,i)=>({distance_m:l.distance-(session.laps[i-1]?.distance || 0),moving_s:l.seconds-(session.laps[i-1]?.seconds || 0)}));
    const last=session.laps?.at(-1);if(last && active-last.seconds>=1)laps.push({distance_m:Math.max(0,session.distance-last.distance),moving_s:active-last.seconds});
    const when=`${start.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}, ${start.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`,frozen=!!reviewDraft?.request,locked=saving || photoBusy || !reviewDraft?.loaded;
    return `<section class="track-session track-review"><header class="track-review-top"><button type="button" id="track-review-back" aria-label="Back to recording">${svg('back')}<span>Recording</span></button><h2>Review</h2><button type="button" id="track-review-discard"${locked?' disabled':''}>Discard</button></header>
      <form class="form track-review-scroll" id="track-save-form">
      <div class="card track-review-primary"><p class="track-review-when">${esc(session.label)} · ${esc(when)}</p><label class="track-title"><span class="vh">Activity title</span><input name="activity_name" aria-label="Activity title" value="${esc(session.name ?? session.label)}" maxlength="200" autocomplete="off" enterkeyhint="done" required${saving?' disabled':''}></label>
      <div class="track-review-stats track-review-headlines">${headline}</div>
      ${session.gps && session.points.length>1?'<div class="map track-review-map-wrap" id="track-map-wrap"><div class="track-map" id="track-map"></div><button type="button" class="map-full" aria-label="Full-screen map">'+svg('expand')+'</button></div>':''}
      ${reviewPhotoHTML()}<div class="track-review-sharing"><label>Who can see this activity<select name="visibility"${saving ? ' disabled' : ''}>${!session.visibility && !App.me.share_default ? '<option value="">Use my saved sharing setting</option>' : ''}${Object.entries({me: 'Only me', friends: 'Approved friends', everyone: 'Everyone on Kinetta'}).map(([value, label]) => `<option value="${value}"${value === (reviewDraft?.request?.visibility || reviewDraft?.request?.expected_sharing_default || session.visibility || App.me.share_default) ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      ${session.gps?`<p class="small muted">Shared maps hide the start and end.${session.points.some(p=>p.segment!==session.points[0]?.segment)?' Shared previews show the longest recorded section.':''}</p>`:''}</div></div>
      ${session.gps?'<section class="card track-review-chart-card"><h2>Charts</h2><div class="activity-charts" id="track-review-charts"></div></section>':''}
      <details class="card track-review-details"${reviewDraft?.detailsOpen?' open':''}><summary>Details &amp; splits${svg('down')}</summary><div class="track-review-stats">${more}</div>
      ${session.intervals?'<section id="interval-live" class="track-interval-live" aria-label="Intervals"></section>':''}
      ${rows.length?`<div class="track-review-splits"><h3>Splits</h3>${rows.map(([label,time])=>`<div><span>${esc(label)}</span><b class="num">${clock(time)}</b></div>`).join('')}</div>`:''}
      ${laps.length?`<h3>Manual laps</h3><div class="tblwrap">${lapsTable({sport:session.sport,laps})}</div>`:''}</details>
      </form>
      <div class="track-review-dock"><p class="small danger" id="track-save-error" role="alert">${esc(saveError || (!saving && frozen?'Save not confirmed. Draft kept.':''))}</p><button type="submit" form="track-save-form" class="primary wide" id="track-save"${locked?' disabled':''}>${saving?'Saving…':frozen?'Retry save':'Save'}</button>${frozen&&!saving&&!photoBusy?`<a class="ghost wide track-check-saved" href="${profileHref(App.me)}">View my activities</a>`:''}</div></section>`;
  }
  function liveMapHTML(paused) {
    if(session.locationDenied)return `<div class="track-location-off" role="group" aria-label="Location is off"><div class="track-location-off-icon" aria-hidden="true">!</div><b>Location is off</b><button type="button" class="track-open-settings" id="track-open-settings">Open Settings</button><small>Your timer and controls still work.</small></div>`;
    const followLabel=follow?'Whole route':'Follow me';
    return `<div class="map track-map-wrap" id="track-map-wrap"><div class="track-map live-record-map" id="track-map"></div><span class="gps-chip" id="track-gps-live" hidden></span>
      <button type="button" class="track-follow-control" id="track-follow" aria-label="${followLabel}" title="${followLabel}" aria-pressed="${!follow}">${svg('track')}<span>${followLabel}</span></button>
      ${paused && !session.native ? '<button type="button" class="track-timer-link" id="track-timer">Continue without GPS</button>' : ''}</div>`;
  }
  function reflectLiveState(el) {
    const live=$('.track-live',el);if(!live||!session)return;
    const paused=session.state!=='recording';live.classList.toggle('is-paused',paused);live.classList.toggle('is-recording',!paused);
    const label=$('.track-time-label',live);if(label)label.textContent=paused?'Paused':'Time';
  }
  function draw() {
    const el = $('#track-content'); if (!el || !App.me) return;
    const renderRevision=++drawRevision;
    if (!session) { mapOverlay?.close();mapOverlay=null;reviewResize?.disconnect();reviewResize=null;cancelAnimationFrame(reviewResizeFrame);reviewResizeFrame=0;cancelAnimationFrame(mapControlsFrame);mapControlsFrame=0;const top=el.parentElement?.querySelector(':scope > .top');if(top){top.hidden=false;$('h1',top).textContent='Track';const acts=$('.acts',top);if(acts)acts.hidden=false;}ready(el,renderRevision);cleanViews();return; }
    const renderedId=session.id,renderedOwner=readOwner(),live=()=>session?.id===renderedId&&readOwner()===renderedOwner&&el.isConnected;
    const review = session.state === 'review', paused = session.state !== 'recording';
    const heldMap=review && el._trackReview && el._trackId===session.id?$('#track-map-wrap',el):null;
    const heldChart=heldMap && el._trackUnits===U.du()?$('#track-review-charts',el):null;
    const heldOverlay=heldMap?mapOverlay:null;
    mapOverlay?.close();mapOverlay=null;reviewResize?.disconnect();reviewResize=null;cancelAnimationFrame(reviewResizeFrame);reviewResizeFrame=0;cancelAnimationFrame(mapControlsFrame);mapControlsFrame=0;
    if(review)loadReview();
    const top = el.parentElement?.querySelector(':scope > .top'); if (top) top.hidden = true;
    if (review && !heldMap) { follow = false; fitWhole = true; }   // entering review fits the recording once
    el.innerHTML = review ? reviewHTML() : `<section class="track-session track-live ${display === 'stats' ? 'stats-expanded' : ''} ${paused ? 'is-paused' : 'is-recording'}"><div class="track-live-main">
      <header class="track-live-top"><h2><span class="rec-dot" aria-hidden="true"></span><span class="track-live-title-label">${esc(session.label)}</span>${session.gps?'<span class="track-gps-indicator" data-state="finding" aria-label="Finding GPS"><span class="track-gps-glyph" aria-hidden="true"></span><span class="track-gps-label">Finding GPS</span></span>':''}</h2>${session.gps ? `<div class="seg track-live-tabs" role="group" aria-label="Recording display"><button data-display="map" aria-pressed="${display === 'map'}">Map</button><button data-display="stats" aria-pressed="${display === 'stats'}">Stats</button></div>` : ''}</header>
      <p id="track-status" class="vh" role="status"></p>
      ${session.intervals?'<section id="interval-live" class="card track-interval-live" aria-label="Current interval"></section>':''}
      ${session.gps && display === 'map' ? `<div class="track-live-metrics" role="group" aria-label="Current workout"><div><b class="num"><span id="track-time"></span></b><small class="track-time-label">${paused?'Paused':'Time'}</small></div><div><b class="num"><span id="track-distance"></span><i>${U.du()}</i></b><small>Distance</small></div><div><b class="num"><span id="track-pace"></span><i>${speedSport(session)?U.su():'/'+U.du()}</i></b><small>${speedSport(session)?'Avg speed':'Avg pace'}</small></div></div>${liveMapHTML(paused)}` : `<div class="track-live-body track-live-stats"><div class="track-hero"><b class="num" id="track-time"></b><small>${paused?'Paused':'Time'}</small></div>${session.gps ? `<div class="track-live-metrics"><div><b class="num" id="track-distance"></b><small>Distance · ${U.du()}</small></div><div><b class="num" id="track-pace"></b><small>${speedSport(session)?'Avg speed':'Avg pace'} · ${speedSport(session)?U.su():'/'+U.du()}</small></div><div><b class="num" id="track-lap-pace"></b><small>${speedSport(session)?'Lap speed':'Lap pace'} · ${speedSport(session)?U.su():'/'+U.du()}</small></div></div><p class="small muted track-splits" id="track-splits"></p><p class="small muted track-gps-accuracy" id="track-gps-accuracy" hidden></p>` : '<p class="small muted">Indoor recording</p>'}</div>`}
      <div class="track-controls" role="group" aria-label="Recording controls">${paused ? `<span class="round-ctl round-ctl-discard"><button class="round-btn discard" id="track-discard" aria-label="Discard recording">${svg('trash')}</button><small>Discard</small></span><span class="round-ctl"><button class="round-btn go" id="track-pause" aria-label="Resume">${svg('play')}</button><small>Resume</small></span><span class="round-ctl"><button class="round-btn stop" id="track-finish" aria-label="Finish">${svg('stop')}</button><small>Finish</small></span>` : `${session.gps?`<span class="round-ctl"><button class="round-btn lap" id="track-lap" data-track-lap aria-label="Mark lap">${svg('flag')}</button><small>Lap</small></span>`:''}<span class="round-ctl"><button class="round-btn" id="track-pause" aria-label="Pause">${svg('pause')}</button><small>Pause</small></span><span class="round-ctl"><button class="round-btn stop" id="track-finish" aria-label="Finish">${svg('stop')}</button><small>Finish</small></span>`}</div>
      </div></section>`;
    if(heldMap)$('#track-map-wrap',el)?.replaceWith(heldMap);
    if(heldChart)$('#track-review-charts',el)?.replaceWith(heldChart);
    el._trackId=session.id;el._trackReview=review;el._trackUnits=U.du();
    $$('[data-display]', el).forEach((b) => b.onclick = () => { display = b.dataset.display; draw(); });
    cleanViews();
    const wrap=$('#track-map-wrap');if(wrap){mapOverlay=heldOverlay || wireMediaMapFull(wrap,()=>mapView?.el===$('#track-map')?mapView:null,lines,false,{tapArea:'.track-map',refitOnClose:review});const controls=$('.track-full-controls',wrap);if(controls){const observer=new ResizeObserver(()=>{if(!wrap.isConnected)return;cancelAnimationFrame(mapControlsFrame);mapControlsFrame=requestAnimationFrame(()=>{mapControlsFrame=0;if(wrap.isConnected)wrap.style.setProperty('--map-controls-height',Math.ceil(controls.getBoundingClientRect().height)+'px');});});observer.observe(controls);viewResources.set(controls,()=>{observer.disconnect();cancelAnimationFrame(mapControlsFrame);mapControlsFrame=0;});}}
    $$('[data-track-lap]',el).forEach(b=>b.onclick=markLap);
    $$('[data-track-pause]',el).forEach(b=>b.onclick=()=>$('#track-pause')?.click());
    $$('[data-track-finish]',el).forEach(b=>b.onclick=()=>$('#track-finish')?.click());
    $$('[data-track-follow]',el).forEach(b=>b.onclick=()=>{follow=true;fitWhole=false;refreshMap();followButton();});
    const fb = $('#track-follow', el); if (fb) fb.onclick = () => { follow = !follow;fitWhole=!follow; refreshMap(); followButton(); };
    update(); if (session.gps) refreshMap();
    if (!review) {
      const settings=$('#track-open-settings');if(settings)settings.onclick=async()=>{try{const open=window.Capacitor?.Plugins?.KinettaContacts?.openSettings;if(typeof open==='function')await open();else toast('Open your device settings and allow location for Kinetta.');}catch(_){toast('Settings could not be opened.');}};
      $('#track-pause').onclick = async () => { if(!live())return;if (session.state === 'recording') { await pause(); draw(); } else { await resume(); reflectLiveState(el); } };
      const finish = $('#track-finish'); if (finish) finish.onclick = async () => { if(!live())return;if (session.native) { await nativeControl('finish'); return; } await pause(); if (TrackMath.seconds(session) < 1) { message = 'Record at least one second before finishing.'; update(); return; } session.state = 'review'; message = 'Ready to save'; session.finishedAt = Date.now(); persist(); draw(); };
      const timer = $('#track-timer'); if (timer) timer.onclick = async () => { session.gps = false; await resume(); reflectLiveState(el); };
    } else {
      const form = $('#track-save-form'); form.elements.namedItem('activity_name').oninput = () => { session.name = form.elements.namedItem('activity_name').value; form.elements.namedItem('activity_name').setCustomValidity(''); persist(); };
      $('#track-review-back').onclick=()=>{if(!live()||saving)return;session.state='paused';session.finishedAt=null;message='';persist();draw();sync();};
      $('#track-review-discard').onclick=()=>{if(live()&&!saving&&!photoBusy&&!reviewDraft?.request)discardReview();};
      form.elements.namedItem('activity_name').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}};
      wireReviewPhotos(live);if(!heldChart)reviewCharts();
      const chart=$('#track-review-charts'),dock=$('.track-review-dock'),section=$('.track-review');let width=chart?.clientWidth;
      const observer=new ResizeObserver(()=>{if(!live()||reviewResizeFrame)return;reviewResizeFrame=requestAnimationFrame(()=>{reviewResizeFrame=0;if(!live())return;if(chart?.isConnected&&Math.abs(chart.clientWidth-width)>1){width=chart.clientWidth;reviewCharts();}if(section?.isConnected && dock?.isConnected){const height=Math.ceil(dock.getBoundingClientRect().height)+'px';section.style.setProperty('--track-dock-height',height);document.documentElement.style.setProperty('--track-review-dock-height',height);}});});
      if(chart)observer.observe(chart);if(dock)observer.observe(dock);reviewResize=observer;viewResources.set(form,()=>{observer.disconnect();cancelAnimationFrame(reviewResizeFrame);reviewResizeFrame=0;});
      const detail=$('.track-review-details');if(detail)detail.ontoggle=()=>{if(live()&&reviewDraft)reviewDraft.detailsOpen=detail.open;};
      if(saving||photoBusy||reviewDraft?.request)$$('input,select',form).forEach(field=>field.disabled=true);
      form.onsubmit = async (e) => {
        e.preventDefault();if(saving || photoBusy || !live() || !reviewDraft?.loaded)return;
        const field=form.elements.namedItem('activity_name'),name=field.value.trim();
        if(!reviewDraft.request && !name){field.setCustomValidity('Add an activity name');field.reportValidity();return;}field.setCustomValidity('');
        session.name=name;if(!persist())return;
        const active=session,k=key,expected=readOwner(),current=()=>session?.id===active.id && key===k && expected===readOwner();
        saving=true;saveError='';draw();let timeout;
        try {
          let capabilities;
          try{capabilities=await api('/api/track/capabilities');}catch(e){if(e.status===404 || e.status===422)throw Error('Update the Kinetta server before saving this review. Your draft is kept.');throw e;}
          if(capabilities.atomic_review!==1)throw Error('Update the Kinetta server before saving this review. Your draft is kept.');
          if(!current())return;
          if(active.intervals){if(!globalThis.Intervals)throw Error('Reload the app before saving private interval results.');await Intervals.verifySaveSupport();if(!current())return;}
          const payload = {visibility:session.visibility||undefined,expected_sharing_default:session.visibility?undefined:form.elements.namedItem('visibility').value||undefined,client_id: session.id, sport: session.sport, sport_label: session.sportLabel || null, name, start: new Date(session.start).toISOString(), elapsed_s: session.native&&Number.isFinite(session.elapsedSeconds)?session.elapsedSeconds:(session.finishedAt-session.start)/1000,moving_s:TrackMath.seconds(session),points:session.points,
            review_version:1,laps:session.laps || [],photos:reviewDraft.photos,...(session.intervals?{intervals:globalThis.Intervals?Intervals.resultPayload(session.intervals):session.intervals}:{})};
          const frozen=await TrackReviewStore.confirm(k,active.id,payload,{native:!!session.native,gps:!!session.gps,label:session.label,splitMetres:session.splitMetres,splits:session.splits,intervals:session.intervals});
          if(!current())return;reviewDraft={...frozen,scope:k,id:active.id,loaded:true};draw();
          const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),60000);
          const result=await api('/api/activities/track',{...json('POST',frozen.request),signal:controller.signal});
          if(!current())return;
          if(!Number.isSafeInteger(result?.id) || result.id<=0)throw Error('Save was not confirmed.');
          if(session.native){nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});if(!current())return;await TrackNative.call('clear',{id:session.id,intervalResultSaved:!!frozen.request.intervals});}
          if(!current())return;
          await TrackReviewStore.remove(k,active.id);if(!current())return;
          store.del(k);session=null;reviewDraft=null;invalidate('/api/');toast(result.duplicate?'Activity saved. Check its sharing on the activity.':'Activity saved');
          if(result.duplicate)go(`/activity/${result.id}`);else if(location.pathname==='/track')go(`/track?done=${result.id}`,{replace:true});else sync();
        } catch(x) {
          if(!current())return;
          if(x.code==='sharing_changed' && ['me','friends','everyone'].includes(x.detail?.sharing_default)){App.me.share_default=x.detail.sharing_default;keep('/api/me',App.me);}
          if(reviewDraft?.request && ([400,422].includes(x.status) || x.code==='sharing_changed')) {
            try{const reopened=await TrackReviewStore.reopen(k,active.id);if(!current())return;reviewDraft={...reopened,scope:k,id:active.id,loaded:true};}
            catch(_){/* Keep the exact confirmed request when local storage cannot acknowledge the reset. */}
          }
          saveError=x.offline || x.status>=500 || reviewDraft?.request && !x.status?'Save not confirmed. Draft kept.':x.message;
        } finally {
          clearTimeout(timeout);saving=false;if(current())draw();
        }
      };
    }
    const audience=$('#track-save-form select[name=visibility]');if(audience)audience.onchange=()=>{session.visibility=audience.value;persist();};
    const discarding=$('#track-discard');if(discarding)discarding.onclick=()=>{if(live()&&!photoBusy&&!reviewDraft?.request)discard();};
  }
  function ready(el,renderRevision) {
    // GPS recording is in the iPhone app only (Ben, 2026-10-24); a browser times indoor workouts, lifting and past entries.
    // A GPS draft already started in a browser can still be finished and saved (draw/resume above).
    const outdoor = TrackNative.supported ? OUTDOOR : [];
    const choices = recordingChoices();
    const quick = outdoor.length ? TRACK_QUICK : [0, 1, 2, 3].filter(i => i < choices.length);
    let selected = Math.min(choices.length-1, Math.max(0, +store.get(key + ':choice') || 0)),choiceRevision=0,planLoading=false;
    if(planIntent?.scope===key&&planIntent.owner===readOwner())selected=choices.findIndex(c=>c.sport==='run'&&!c.sportLabel);
    const done = new URLSearchParams(location.search).get('done'),doneId=done&&/^\d+$/.test(done)?done:null;
    if(new URLSearchParams(location.search).get('past')==='1'){const url=new URL(location.href);url.searchParams.delete('past');history.replaceState(null,'',url.pathname+url.search);setTimeout(()=>{if(el.isConnected)addActivitySheet();});}
    el.innerHTML = `${doneId ? `<div class="track-saved" role="status"><b>Activity saved</b><a href="/activity/${doneId}">View activity${svg('chev')}</a></div><div id="track-celebration" class="milestone-celebration-host" aria-live="polite"></div><div id="track-next-medal"></div>` : ''}<form class="form track-ready compact-ready" id="track-setup">${TrackNative.supported ? '' : `<p class="small muted track-gps-note">GPS recording is in the iPhone app.${App.me?.iphone_app ? ` <a href="${esc(App.me.iphone_app)}" target="_blank" rel="noopener">Get it</a>` : ''}</p>`}<div class="track-sport-row" role="group" aria-label="Common activities"><div class="track-quick">${quick.map(i => `<button type="button" data-quick="${i}" aria-pressed="${i===selected}" aria-label="${esc(choices[i].label)}">${svg(choices[i].lift?'workout':choices[i].sport)}${esc(choices[i].lift?'Lift':choices[i].label==='Treadmill run'?'Treadmill':choices[i].label)}</button>`).join('')}</div><button type="button" class="me-chip" id="track-other" aria-label="More activities"><span>More</span>${svg('down')}</button></div>
      <div class="track-ready-map-wrap" id="track-ready-map-wrap"><div class="track-ready-map" id="track-ready-map" aria-label="Map before recording"></div><button type="button" class="gps-chip track-location-action" id="track-location-action" data-state="enable">Enable location</button><span class="gps-chip track-location-status" id="track-gps-chip" role="status" aria-live="polite" hidden></span><button type="button" class="map-full" aria-label="Full-screen map">${svg('expand')}</button><button type="button" class="icon-btn track-locate" id="track-locate" aria-label="Locate me">${svg('track')}</button></div>
      <div id="track-plan" class="track-plan" hidden></div>
      <div class="track-recording-options" aria-label="This recording"><div id="track-interval-ready"></div><button type="button" class="me-chip" id="track-options" hidden></button></div>
      <div class="track-go"><button class="${outdoor.length?'round-btn start':'primary wide'}" id="track-start"><span>Start</span></button><a id="track-log-past" class="track-log-past" data-track-feature="past" href="/track?past=1">Log a past workout</a></div>
      <p class="small danger" id="track-ready-error" role="alert"></p><p class="small muted" id="track-guidance"></p>
      </form>
      <div id="track-open-lift"></div><section class="track-tools compact-track-tools" aria-labelledby="track-tools-h"><h2 class="sec-head" id="track-tools-h">Track tools</h2><div id="track-explore" class="track-tool-list"></div></section>`;
    if(doneId){
      Milestones.celebrate($('#track-celebration',el),doneId);
      const nextMedalNode=$('#track-next-medal',el),nextMedalOwner=readOwner();
      loadActivityDetail().then(()=>{
        if(nextMedalNode?.isConnected&&nextMedalOwner===readOwner())ActivityDetail.nextMedalForId(nextMedalNode,doneId);
      }).catch(()=>{});
    }
    let view=null,dot=null,located=false,here=null,loadingMap=false,centred=false,readyFollow=true;const readyOwner=readOwner(),readyLive=()=>renderRevision===drawRevision&&el.isConnected&&readyOwner===readOwner()&&!session;
    const gpsAction=$('#track-location-action'),gpsStatus=$('#track-gps-chip');let gpsState='enable';
    const setGPSState=(state,accuracy)=>{gpsState=state;if(!gpsAction||!gpsStatus)return;
      const action=state==='enable'||state==='denied';gpsAction.hidden=!action;gpsStatus.hidden=action;
      if(action){const label=state==='denied'?'Open settings':'Enable location';gpsAction.dataset.state=state;gpsAction.textContent=label;gpsAction.setAttribute('aria-label',label);}
      else{gpsStatus.textContent=state==='finding'?'Finding GPS':'GPS ready';gpsStatus.dataset.state=state;gpsStatus.title=state==='ready'&&gpsText(accuracy)?`GPS ready. Accuracy ${gpsText(accuracy)}.`:'';}
    };
    const quickRow=$('.track-sport-row',el),quickBox=$('.track-quick',el),more=$('#track-other',el),quickButtons=$$('[data-quick]',el);
    const fitQuick=()=>{
      if(!readyLive())return;
      const focused=document.activeElement;
      quickBox.hidden=false;quickButtons.forEach(b=>b.hidden=false);
      const label=(text,selectedHidden)=>{more.innerHTML=`<span>${esc(text)}</span>${svg('down')}`;more.setAttribute('aria-pressed',String(selectedHidden));more.setAttribute('aria-label',selectedHidden?'More activities, selected '+choices[selected].label:'More activities');};
      label('More',false);
      const widths=quickButtons.map(b=>b.getBoundingClientRect().width),gap=parseFloat(getComputedStyle(quickBox).columnGap)||8,outerGap=parseFloat(getComputedStyle(quickRow).columnGap)||8;
      const fit=(limit=Infinity)=>{
        const available=Math.max(0,quickRow.clientWidth-more.getBoundingClientRect().width-outerGap);let used=0,full=false;const shown=[];
        quickButtons.forEach((b,i)=>{const need=widths[i]+(shown.length?gap:0);b.hidden=full||shown.length>=limit||used+need>available;if(b.hidden)full=true;else{used+=need;shown.push(+b.dataset.quick);}});
        quickBox.hidden=!shown.length;quickBox.scrollLeft=0;return shown;
      };
      const shown=fit();
      if(!shown.includes(selected)){label(choices[selected].label,true);fit(shown.length);}
      if(quickButtons.includes(focused)&&focused.hidden)more.focus({preventScroll:true});
    };
    const quickResize=new ResizeObserver(fitQuick),quickFont=new MutationObserver(fitQuick);
    quickResize.observe(quickRow);quickFont.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
    viewResources.set(quickRow,()=>{quickResize.disconnect();quickFont.disconnect();});
    document.fonts?.ready.then(fitQuick);requestAnimationFrame(fitQuick);
    const guide = () => { const c=choices[selected];globalThis.Intervals?.mount($('#track-interval-ready'),c,{compact:true,changed:()=>{choiceRevision++;opts();}});$('#track-ready-map-wrap').hidden=!c.gps;el.classList.toggle('gps-ready',!!c.gps);ensureMap();$('#track-start').setAttribute('aria-label',c.lift?'Start lifting':`Start ${c.label.toLowerCase()}`);$('#track-guidance').textContent=c.lift?'Sets, reps and a rest timer.':c.gps?'GPS continues with your screen locked.':TrackNative.supported?'A timer, including with your screen locked.':'Keep this page open while the timer runs.'; };
    // The pre-start chips edit the existing device choices; the recorder remains their owner after Start.
    const opts=()=>{ const c=choices[selected],box=$('#track-options');if(!box)return;
      box.hidden=!c.gps;if(!c.gps)return;
      const o=recordOptions(c.sport),unit=imp()?'mile':'km';
      const intervals=globalThis.Intervals?.hasSelection()&&['run','walk'].includes(c.sport),paused=intervals?'off':o.autoPause?'on':'off';
      box.innerHTML=`${svg('sound')}<span>${o.voice?`1 ${imp()?'mi':'km'}`:'Off'} · Auto-pause ${paused}</span>`;
      box.setAttribute('aria-label',box.textContent.trim()+'. '+`${o.voice?'Spoken updates every '+unit:'Spoken updates off'}. Auto-pause ${paused}${intervals?' for intervals':''}. Recording settings`);
      box.title=box.getAttribute('aria-label');box.onclick=()=>prefs(c); };
    const prefs=(c)=>{ const o=recordOptions(c.sport),unit=imp()?'mile':'km';
      sheet('Recording settings',`<div class="track-pref-list"><div class="switch-row"><div class="track-voice-copy"><label for="track-voice"><b>Spoken updates</b></label><small>Hear your time and ${speedSport(c)?'speed':'pace'} at every ${unit}, even with the screen locked.</small></div><label class="track-switch-target" for="track-voice"><input type="checkbox" role="switch" id="track-voice"${o.voice?' checked':''}></label></div>
        <label class="switch-row"><span><b>Auto-pause</b><small>Stops the clock when you stop moving and starts it when you go. Saved for each kind of activity: this is for ${esc(c.label.toLowerCase())}.</small></span><input type="checkbox" role="switch" id="track-auto"${o.autoPause?' checked':''}></label></div>
        <button type="button" class="primary wide" data-done>Done</button>`,(b,close)=>{
        b.closest('.sheet').classList.add('track-recording-settings');
        $('#track-voice',b).onchange=(e)=>{store.set(key+':voice',e.target.checked);opts();};
        $('#track-auto',b).onchange=(e)=>{store.set(key+':auto:'+c.sport,e.target.checked);opts();};
        $('[data-done]',b).onclick=close;});
      Native.haptic?.('selection'); };
    const gear=$('#track-settings');if(gear)gear.onclick=()=>{const c=choices[selected];if(c.gps)prefs(c);else toast('Spoken updates and auto-pause are for GPS activities.');};
    const pick=(i,fromPlan=false)=>{if(!readyLive()||!choices[i])return;if(!fromPlan&&planIntent){planIntent=null;$('#track-plan').hidden=true;}selected=i;choiceRevision++;store.set(key+':choice',selected);fitQuick();$$('[data-quick]',el).forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.quick===i)));guide();opts();auto();};
    $('#track-other').onclick=()=>sheet('Activity',pickRows(choices.map((c,i)=>[String(i),c.label,c.gps?'GPS':c.lift?'Sets & reps':'Timer',c.lift?'workout':c.sport]),String(selected)),(b,close)=>{b.closest('.sheet').classList.add('track-sport-picker');$$('[data-pk]',b).forEach(x=>x.onclick=()=>{close();pick(+x.dataset.pk);});});
    $$('[data-quick]',el).forEach(b=>b.onclick=()=>{Native.haptic?.('selection');pick(+b.dataset.quick);});
    // Find the person at once when an outdoor activity is chosen, like other running apps. The iPhone app asks iOS
    // (permission is remembered); a browser locates by itself only after the person has already allowed it.
    const show=(lat,lon,accuracy,at)=>{if(!readyLive())return;located=true;here=[lat,lon,accuracy,at];setGPSState('ready',accuracy);if(!view||!$('#track-ready-map')?.isConnected)return;
      // street level, so the dot shows which side of the road you're on; later fixes keep it centred
      if(!centred&&readyFollow){view.map.setView([lat,lon],17);centred=true;}else if(readyFollow)view.map.panTo([lat,lon],{animate:true});
      dot=hereMarker(view,dot,lat,lon,accuracy); };
    const openLocationSettings=async()=>{try{const open=window.Capacitor?.Plugins?.KinettaContacts?.openSettings;if(typeof open==='function')await open();else toast('Open your device settings and allow location for Kinetta.');}catch(_){toast('Settings could not be opened.');}};
    const locate=async(quiet)=>{
      const button=$('#track-locate'),error=$('#track-ready-error');if(!button||button.disabled)return;
      button.disabled=true;if(!quiet)error.textContent='';
      try {
        if(TrackNative.supported){setGPSState('finding');const p=await TrackNative.locate({quiet});show(p.lat,p.lon,p.accuracy,p.timestamp);}
        else {
          if(!navigator.geolocation)throw new Error('Location is unavailable on this device.');
          if(quiet){const state=await navigator.permissions?.query({name:'geolocation'}).then((s)=>s.state,()=>null);if(state!=='granted')return;}
          setGPSState('finding');
          const p=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,maximumAge:15000,timeout:15000}));
          show(p.coords.latitude,p.coords.longitude,p.coords.accuracy,p.timestamp);
        }
      } catch(e) { const message=String(e?.message||''),denied=/allow location|location services are off|permission denied/i.test(message)||e?.code===1;if(quiet&&/has not been allowed yet/i.test(message))setGPSState('enable');else if(!quiet||TrackNative.supported)setGPSState(denied?'denied':'enable');if(!quiet&&button.isConnected&&!denied)error.textContent=e?.message && TrackNative.supported ? e.message : 'Allow location access to see where you are. You can still choose an indoor activity.'; }
      finally { if(button.isConnected)button.disabled=false; }
    };
    const auto=()=>{ if(!located&&choices[selected].gps)locate(true); };
    gpsAction.onclick=()=>gpsState==='denied'?openLocationSettings():locate(false);
    $('#track-locate').onclick=()=>{if(gpsState==='denied'){openLocationSettings();return;}centred=false;readyFollow=true;locate(false);};
    setGPSState('enable');
    pick(selected,true);
    const logPast=$('#track-log-past',el);if(logPast)logPast.onclick=e=>{if(!readyLive()||e.metaKey||e.ctrlKey||e.button>0)return;e.preventDefault();if(typeof Discovery!=='undefined')Discovery.visit('track','past');addActivitySheet();};
    // keep the dot live while you get ready, not just one fix from when the screen opened
    const tick=setInterval(()=>{ if(!readyLive()){clearInterval(tick);return;} if(located&&choices[selected].gps&&!document.hidden)locate(true); },8000);
    function ensureMap(){
      if(!choices[selected].gps||loadingMap)return;
      if(view){requestAnimationFrame(()=>{if(el.isConnected)view.map.invalidateSize();});return;}
      loadingMap=true;
      // Pan, pinch and full screen before Start, like the recording map (Ben, 30 Oct 2026); dragging stops following you.
      mapInto($('#track-ready-map'), []).then(v=>{if(!v)return;if(!readyLive()){v.map.remove();return;}view=v;view.map.on('dragstart',()=>{readyFollow=false;});
        // Opening or closing full screen resizes the map from its corner; keep the dot centred while it follows you.
        view.map.on('resize',()=>{if(readyFollow&&here&&centred)view.map.panTo([here[0],here[1]],{animate:false});});
        wireMediaMapFull($('#track-ready-map-wrap'),()=>view,[],false,{tapArea:'.track-ready-map',refitOnClose:false});if(here)show(...here);})
        .catch(()=>{if(el.isConnected)$('#track-ready-error').textContent='Map unavailable. Recording still works without map tiles.';})
        .finally(()=>{loadingMap=false;});
    }
    if(globalThis.Intervals&&new URLSearchParams(location.search).get('intervals')==='1'){const url=new URL(location.href);url.searchParams.delete('intervals');history.replaceState(null,'',url.pathname+url.search+url.hash);Intervals.library(()=>{guide();opts();});}
    $('#track-setup').onsubmit=async(e)=>{e.preventDefault();if(controlling||planLoading||!readyLive())return;const c=choices[selected];if(c.lift){if(globalThis.Intervals?.hasSelection()){const error=$('#track-ready-error');if(error)error.textContent='Intervals need an outdoor Run or Walk in the iPhone app. Change the activity or remove the loaded preset.';return;}startLiftSheet();return;}await begin(c.sport,c.label,c.sportLabel,c.gps);};
    // A plan-page Start carries an already checked choice; ordinary Track visits show today's own facts.
    const intent=planIntent?.scope===key&&planIntent.owner===readOwner()?planIntent:null;
    if(outdoor.length||intent)(intent?Promise.resolve({plan:{id:intent.planId}}):api('/api/plans/current')).then(d=>{if(!readyLive())return;const w=intent?.workout||d.today_workout;if(!d.plan||!w||(!intent&&w.day!==d.today)||w.status==='done'||w.type==='rest')return;
      const box=$('#track-plan'),canUse=!!intent||!!w.track_intervals||['easy','recovery','long'].includes(w.type);box.hidden=false;
      const label=intent?(w.day===isoDay(new Date())?'Selected today':'Selected '+new Date(w.day+'T12:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})):'Today';
      box.innerHTML=`<a href="/plan"><small>${esc(label)}</small><b>${esc(w.title)}</b></a>${canUse?'<button type="button" class="me-chip" data-plan-use>Use</button>':`<a class="me-chip" href="/plan">View plan</a>`}`;
      const button=$('[data-plan-use]',box);if(button)button.onclick=async()=>{if(!readyLive()||planLoading)return;const choice=choiceRevision,start=$('#track-start');planLoading=true;button.disabled=start.disabled=true;button.textContent='Loading…';$('#track-ready-error').textContent='';try{const loaded=await preparePlan(w,d.plan.id,{active:()=>readyLive()&&choice===choiceRevision,remember:false});if(!readyLive()||!loaded)return;pick(loaded.index,true);toast('Ready for your run. Press Start when you are.');}catch(e){if(readyLive())$('#track-ready-error').textContent=e.message;}finally{planLoading=false;if(button.isConnected){button.disabled=false;button.textContent='Use';start.disabled=controlling;}}};
    }).catch(()=>{});
    trackDiscovery($('#track-explore'),readyLive);
    liftNowCard($('#track-open-lift'));
  }
  function trackDiscovery(box,current){
    if(typeof Discovery==='undefined')return;let connections=null,health=null,settled=false;
    const draw=()=>{if(!current())return;const count=(connections?['apple','garmin_connect'].filter(k=>connections[k]).length:0)+(health?.on?1:0);
      const items=[{id:'connections',title:'Connections and import',icon:'watch',href:'/track/connections',
        description:Native.on?'Manage Health and connected apps →':'Connect apps or import older workouts →',teaser:count?`${count} connected`:''}];
      Discovery.render(box,items,{space:'track',ready:settled,attribute:'data-track-feature'});
    };Discovery.wire(box,'track',{attribute:'data-track-feature'});draw();
    Promise.allSettled([api('/api/connections',{maxAge:0}).then(value=>connections=value),...(Native.on?[Native.healthCall(Promise.all([Native.healthOn(),Native.healthStatus()]),'Health status is unavailable.',5000).then(([on,st])=>health={on,at:st?.last_success_at||st?.at,error:st?.error},()=>health={error:true})]:[])]).then(()=>{settled=true;draw();});
  }

    Track.__attachRoute({draw, refreshMap, restoreReview});
route(/^\/track$/, 'track', async (el) => {
      Track.sync();
      el.innerHTML = `<div class="top"><h1>Track</h1><div class="acts">${TrackNative.supported ? `<button type="button" class="icon-btn" id="track-settings" aria-label="Recording settings">${svg('gear')}</button>` : ''}</div></div><div id="track-content"></div>`;
      await Track.restoreReview();
      if (TrackNative.supported) { try { await Track.pullNative(); } catch(e) { toast(e.message); } }
      Track.draw();
    });
  }
})(Track.__routeContext());
