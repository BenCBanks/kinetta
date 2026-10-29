// Track owns every recording flow. Native iPhone GPS continues independently of WebView visibility.
'use strict';
if (typeof IC !== 'undefined') Object.assign(IC, {   // the recording controls (2026-10-26 Track redesign); tests load the maths alone
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.2"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  flag: '<path d="M5 21V4m0 1c4-4 10 4 14 0v10c-4 4-10-4-14 0"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
});
const TrackMath = {
  metres(a, b) {
    const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
    const x = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  },
  // Same distance rule as the server (analysis.track_step) and the iPhone recorder (#234 item 2): fixes worse than ±25 m
  // draw the map but add nothing, and distance counts only once you've moved further than the GPS error.
  step(anchor, p) {
    if (p.accuracy > 25) return null;
    if (!anchor) return 0;
    const m = this.metres(anchor, p);
    return m >= Math.max(5, anchor.accuracy, p.accuracy) ? m : null;
  },
  accept(s, position, now) {
    const c = position.coords, t = (position.timestamp - s.start) / 1000;
    if (![c.latitude, c.longitude, c.accuracy, t].every(Number.isFinite) || c.accuracy > 100 || c.accuracy < 0 || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || t < 0 || position.timestamp < s.activeAt || position.timestamp > now + 1000 || now - position.timestamp > 15000) return false;
    const last = s.points[s.points.length - 1];
    if (last && t <= last.t) return false;
    let p = {lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, t, segment: s.segment};
    if (last && last.segment === p.segment) {
      const dt = t - last.t, m = this.metres(last, p), max = {run: 12, walk: 4, hike: 4, ride: 30, swim: 4, row: 8, ski: 40}[s.sport] || 30;
      if (dt > 30) { s.segment++; p.segment = s.segment; }
      else if (m / dt > max) return false;
    }
    if (!s.anchor || s.anchor.segment !== p.segment) s.anchor = null;   // a new section never adds distance across the gap
    const before = s.distance, step = this.step(s.anchor, p);
    // moving again after a stop: a counted step, or the first fix of a new section (no GPS arrives while you stand still)
    if (step !== null) { s.distance += step; if (step > 0 || last) this.moved(s, position.timestamp); s.anchor = p; }
    p.active = this.seconds(s, position.timestamp);
    if (step > 0) {
      const boundary = Math.floor(s.distance / this.MILE) * this.MILE;
      if (boundary > before) {
        const from = s.distanceSeconds ?? (before === 0 ? 0 : p.active);
        s.mileLap = {distance: boundary, seconds: from + (p.active - from) * (boundary - before) / step};
      }
    }
    if(step!==null)s.distanceSeconds=p.active;
    // a split each full mile or km (#234 item 4): the active time when it was reached
    if (s.splitMetres) { s.splits = s.splits || []; while (s.distance >= (s.splits.length + 1) * s.splitMetres) s.splits.push(this.seconds(s, position.timestamp)); }
    s.points.push(p); return true;
  },
  // Auto-pause (#234 item 4, same rule in TrackRecordingState.swift): 15 s without moving stops the clock until you move
  // again, without a jump in the time shown. Only time beyond those 15 s is left out.
  AUTO_MS: 15000,
  idle(s, now) { return s.autoPause && s.state === 'recording' && s.lastMove != null ? Math.max(0, now - s.lastMove - this.AUTO_MS) : 0; },
  autoPaused(s, now = Date.now()) { return s.native&&typeof s.autoPausedNow==='boolean'?s.autoPausedNow:this.idle(s, now) > 0; },
  moved(s, at) { s.autoMs = (s.autoMs || 0) + this.idle(s, at); s.lastMove = at; },
  // On a manual pause the idle stretch so far is kept out; Resume counts as movement.
  settle(s, at) { s.autoMs = (s.autoMs || 0) + this.idle(s, at); s.lastMove = null; },
  seconds(s, now = Date.now()) { if(s.native&&Number.isFinite(s.activeSeconds)){const delta=typeof performance!=='undefined'&&Number.isFinite(s._snapshotClock)?Math.max(0,(performance.now()-s._snapshotClock)/1000):0;return s.activeSeconds+(s.state==='recording'&&!s.autoPausedNow?delta:0);}return Math.max(0, s.activeMs + (s.state === 'recording' ? Math.max(0, now - s.activeAt) : 0) - (s.autoMs || 0) - this.idle(s, now)) / 1000; },
  average(s, now = Date.now()) {const seconds=this.seconds(s,now);return s.distance>10 && seconds>0?s.distance/seconds:null;},
  MILE: 1609.344,
  lap(s, now = Date.now()) {
    const manual = s.laps?.length > 0, index = Math.floor(s.distance / this.MILE);
    // Older journals may not know the active time at a mile boundary. Keep that pace unknown until the next one.
    const mile=s.mileLap && Math.abs(s.mileLap.distance-index*this.MILE)<.01?s.mileLap:null;
    const base = manual ? s.laps.at(-1) : mile || {distance: index * this.MILE, seconds: index ? s.splitMetres===this.MILE && s.splits?.length===index?s.splits.at(-1):null : 0};
    return {manual, number: manual ? s.laps.length + 1 : index + 1,
      distance: Math.max(0, s.distance - base.distance), seconds: base.seconds == null ? null : Math.max(0, this.seconds(s, now) - base.seconds)};
  },
  markLap(s, id, now = Date.now()) {
    if (s.laps?.some(l => l.id === id)) return false;
    const seconds = this.seconds(s, now), previous = s.laps?.at(-1);
    if (!s.gps || s.state !== 'recording' || seconds - (previous?.seconds || 0) < 1 || (s.laps?.length || 0) >= 1000) return false;
    (s.laps ||= []).push({id, seconds, distance: s.distance, elapsed: Math.max(seconds, (now - s.start) / 1000),pointCount:s.points.length});
    return true;
  },
};
const Track = (() => {
  let session = null, key = null, owner = null, watch = null, wake = null, message = '', saving = false, mapTimer = null, mapView = null, lastPersist = 0, nativeTask = null, controlling = false, display = 'map', nativeRevision = 0,refreshReadyDistance=null,drawRevision=0;
  let reviewDraft=null,reviewRestore=null,photoBusy=false,photoGeneration=0,saveError='',mapOverlay=null,reviewResize=null;
  const accountKey = () => App.me ? 'kinetta.track:' + JSON.stringify([Native.base || location.origin, App.me.id]) : null;
  const stopGPS = () => { if (watch !== null) navigator.geolocation?.clearWatch(watch); watch = null; if (wake) wake.release().catch(() => {}); wake = null; };
  function persist(force = true) {
    if (!force && Date.now() - lastPersist < 5000) return true;
    try { localStorage.setItem(key, JSON.stringify(session)); lastPersist = Date.now(); return true; }
    catch (_) { if (session?.native) return true; message = 'This device cannot save your recording draft. Free some storage before continuing.'; pause(false); return false; }
  }
  async function pause(write = true) {
    if (session?.native) { await nativeControl('pause'); return; }
    if (session?.state === 'recording') { TrackMath.settle(session, Date.now()); session.activeMs += Math.max(0, Date.now() - session.activeAt); session.state = 'paused'; session.segment++; }
    if (/^(GPS connected|Timer running|Waiting for)/.test(message)) message = 'Paused';
    stopGPS(); if (write && session) persist(); update();
  }
  function sync() {
    const next = accountKey();
    if (next !== key || owner && owner !== readOwner()) {
      if (session && !session.native) pause();
      key = next; owner = App.me ? readOwner() : null; session = key ? store.get(key) : null; message = '';
      reviewDraft=null;photoBusy=false;photoGeneration++;saveError='';reviewRestore=null;
      if (session) {
        // No time is invented between the last durable checkpoint and opening Kinetta again.
        if (session.state === 'recording' && !session.native) { TrackMath.settle(session, session.checkpoint || session.activeAt); session.activeMs += Math.max(0, (session.checkpoint || session.activeAt) - session.activeAt); session.state = 'paused'; session.segment++; message = 'Recording paused when Kinetta closed. Resume when you are ready.'; persist(); }
      }
      restoreReview();
    }
    updateTab();
    if (TrackNative.supported && App.me) pullNative().catch(() => {});
  }
  function updateTab() {
    const tab = $('nav.tabs [data-tab="track"]');
    if (tab) { tab.classList.toggle('has-recording', !!session); tab.setAttribute('aria-label', session ? 'Track · ' + session.state : 'Track'); }
  }
  function adoptNative(result) {
    const incoming = result.session;
    if (!incoming) { if (session?.native && session.state!=='review') { session = null; store.del(key); } return; }
    const same = session?.id === incoming.id;
    const points = same && incoming.pointOffset === session.points.length ? [...session.points, ...incoming.points] : incoming.points;
    const name = same ? session.name : null,visibility=same?session.visibility:null,pinned=same?session.routePlan:null,pendingLap=same?session.pendingLap:null;
    session = {...incoming, points,_snapshotClock:typeof performance!=='undefined'?performance.now():0,routePlan:Object.prototype.hasOwnProperty.call(incoming,'routePlan')?incoming.routePlan:pinned}; if (typeof name==='string') session.name = name;if(visibility)session.visibility=visibility;
    session.lapSupport=result.lapSupport===1;
    if(pendingLap && !session.laps?.some(l=>l.id===pendingLap))session.pendingLap=pendingLap;
    message = result.message || ''; persist(); update(); refreshMap();
  }
  async function pullNative() {
    if (nativeTask || controlling || saving || !TrackNative.supported || !App.me) return nativeTask;
    const generation = nativeRevision, revision = readOwner(), before = session?.state, id = session?.id;
    nativeTask = (async () => {
      const result = await TrackNative.call('status', {id:session?.native ? session.id : null,since:session?.native ? session.points.length : 0});
      if (revision !== readOwner() || generation !== nativeRevision) return;
      adoptNative(result);
      if (id !== session?.id || before !== session?.state) draw();
    })().finally(() => { nativeTask = null; });
    return nativeTask;
  }
  async function nativeControl(method, args = {}, {redraw=true} = {}) {
    if (controlling || !session?.native) return;
    controlling = true; nativeRevision++; const revision = readOwner();let success=false;update();
    try { if(nativeTask) await nativeTask.catch(()=>{}); adoptNative(await TrackNative.call(method, {id:session.id,since:0,...args}));success=true; }
    catch (e) { if (revision === readOwner()) message = e.message; }
    finally { controlling = false; if (revision === readOwner()) { if(redraw)draw();else update(); sync(); } }
    return success;
  }
  async function resume() {
    if (!session || session.state === 'review' || saving) return;
    if (document.hidden) return;
    if (session.native) { await nativeControl('resume'); return; }
    session.state = 'recording'; session.activeAt = Date.now(); session.lastMove = session.activeAt; message = session.gps ? 'Waiting for a clear GPS signal…' : 'Timer running';
    if (!persist()) return;
    if (session.gps) {
      if (!navigator.geolocation || !window.isSecureContext) { message = 'GPS needs a secure connection and location support. You can use the timer instead.'; pause(); draw(); return; }
      const activeSession = session, activeOwner = owner;
      watch = navigator.geolocation.watchPosition((p) => {
        if (session !== activeSession || readOwner() !== activeOwner || session.state !== 'recording' || document.hidden) return;
        if (session.points.length >= 72000) { pause(); message = 'GPS point limit reached. Finish and save this session.'; draw(); return; }
        const before = (session.splits || []).length;
        if (TrackMath.accept(session, p, Date.now())) { if ((session.splits || []).length > before) announce(session); message = `GPS connected · ±${Math.round(p.coords.accuracy)} m`; session.checkpoint = Date.now(); persist(false); update(); refreshMap(); }
        else if (p.coords.accuracy > 100) { message = 'Weak GPS signal · waiting for better accuracy'; update(); }
      }, (e) => {
        if (session !== activeSession || readOwner() !== activeOwner || session.state !== 'recording') return;
        message = e.code === 1 ? 'Location permission denied. Allow it in device settings, or use the timer.' : 'GPS unavailable. Move into the open and retry, or use the timer.';
        pause(); draw();
      }, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
    }
    draw();
    try { if (navigator.wakeLock) { const lock = await navigator.wakeLock.request('screen'); if (session?.state === 'recording' && owner === readOwner()) wake = lock; else await lock.release(); } } catch (_) { /* foreground limitation remains visible */ }
    draw();
  }
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
  const speedSport = (x) => ['ride', 'ski'].includes(x.sport);
  const unitName = (x) => x.splitMetres > 1500 ? 'Mile' : 'Km';
  // metres per second as pace (/mi or /km) or, for rides and skiing, speed
  const rateText = (x, v) => speedSport(x) ? (v * 3600 / (imp() ? 1609.344 : 1000)).toFixed(1) : dur((imp() ? 1609.344 : 1000) / v);
  // the browser recorder speaks each split while its page is open; the iPhone app speaks it natively, even when locked
  function announce(x) {
    if (!x.voice || !window.speechSynthesis || x.native) return;
    const n = x.splits.length, total = x.splits[n - 1], last = total - (n > 1 ? x.splits[n - 2] : 0);
    const said = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, r = sec % 60; return [h ? h + (h > 1 ? ' hours' : ' hour') : '', m ? m + (m > 1 ? ' minutes' : ' minute') : '', r ? r + (r > 1 ? ' seconds' : ' second') : ''].filter(Boolean).join(' ') || '0 seconds'; };
    const unit = x.splitMetres > 1500 ? 'mile' : 'kilometre';
    try { speechSynthesis.speak(new SpeechSynthesisUtterance(`${n} ${unit}${n > 1 ? 's' : ''}. Time ${said(total)}. ${speedSport(x) ? `Last ${unit} at ${Math.round(3600 / last)} ${unit}s per hour` : `Last ${unit} ${said(last)}`}.`)); } catch (_) { /* no voice on this browser */ }
  }
  // 32:19, or 1:04:07 past an hour: no leading zeros on the big clock (2026-10-26)
  function clock(n) { n = Math.floor(n); const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, s2 = String(n % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`; }
  function update() {
    updateTab();
    if (!session || !App.me || accountKey() !== key) return;
    globalThis.Intervals?.updateLive($('#interval-live'),session,nativeControl);
    const time = $('#track-time'); if (time) time.textContent = clock(TrackMath.seconds(session));
    const d = $('#track-distance'); if (d) d.textContent = U.dist(session.distance, 2);
    const now = Date.now(), secs = TrackMath.seconds(session, now), idle = TrackMath.autoPaused(session, now),lap=TrackMath.lap(session,now);
    const averageSpeed=TrackMath.average(session,now),average=averageSpeed?rateText(session,averageSpeed):'—';
    const lapRate = lap.distance>=10 && lap.seconds>0 ? rateText(session,lap.distance/lap.seconds) : '—';
    const pace=$('#track-pace');if(pace)pace.textContent=average;
    const lp=$('#track-lap-pace');if(lp)lp.textContent=lapRate;
    const splits=$('#track-splits');if(splits)splits.textContent=`${lap.manual?'Lap':'Mile'} ${lap.number} · ${lap.manual?'manual':'automatic'}`;
    const mini={'time':clock(secs),'distance':U.dist(session.distance,2)+' '+U.du(),'average':average,'lap':lapRate};
    $$('[data-track-value]').forEach(n=>n.textContent=mini[n.dataset.trackValue]);
    $$('[data-track-lap]').forEach(b=>{b.disabled=controlling||saving||session.state!=='recording'||session.native&&!session.lapSupport;b.setAttribute('aria-label',session.pendingLap?'Retry marking lap':'Mark lap');const label=$('small',b.parentElement);if(label)label.textContent=session.pendingLap?'Retry lap':'Lap';});
    $$('[data-track-pause]').forEach(b=>b.disabled=controlling||saving);
    for(const id of ['track-pause','track-finish']){const b=$('#'+id);if(b)b.disabled=controlling||saving;}
    // plain Recording / Paused is what the dot shows; screen readers still hear it, sighted people see only news
    const status = $('#track-status'); if (status) { status.textContent = idle ? 'Auto-paused · starts again when you move' : message || (session.state === 'recording' ? 'Recording' : 'Paused'); status.classList.toggle('vh', !idle && !message); }
  }
  async function markLap() {
    if(!session?.gps || session.state!=='recording' || controlling || saving)return;
    const id=session.id,expected=readOwner(),previous=(session.laps || []).length;
    if(session.native) {
      if(!session.lapSupport){toast('Update the iPhone app to mark laps.');return;}
      session.pendingLap ||= crypto.randomUUID();persist();
      if(!await nativeControl('lap',{mark:session.pendingLap},{redraw:false}))return;
    } else {
      const before=session.laps?.slice();
      if(!TrackMath.markLap(session,crypto.randomUUID())){toast('Record a little longer before marking a lap.');return;}
      if(!persist()){session.laps=before;draw();return;}
      update();
    }
    if(session?.id!==id || readOwner()!==expected)return;
    const lap=session.laps?.[previous],before=session.laps?.[previous-1];
    if(lap)toast(`Lap ${previous+1} · ${U.dist(lap.distance-(before?.distance || 0),2)} ${U.du()} · ${clock(lap.seconds-(before?.seconds || 0))}`);
  }
  let fitWhole=false;
  function lines() { const by = new Map(); for (const p of session.points) { if (!by.has(p.segment)) by.set(p.segment, []); by.get(p.segment).push([p.lat, p.lon]); } return [...by.values()].filter((a) => a.length > 1); }
  function refreshMap() {
    if (mapTimer) return;
    mapTimer = setTimeout(async () => {
      try {
        const el = $('#track-map'); if (!el || !session) return;const recording=session.id,expected=owner;
        const ln = lines(); el.hidden = false;
        if (!mapView || mapView.el !== el) {
          const view = await mapInto(el, ln, {sport: session.sport, still: false, ends: false});
          if(session?.id!==recording||readOwner()!==expected||!el.isConnected)return;
          if (view && el.isConnected) { mapView = {...view, el, here: null}; mapView.map.on('dragstart', () => { follow = false;fitWhole=false; followButton(); });el.addEventListener('wheel',()=>{follow=false;fitWhole=false;followButton();},{passive:true});el.addEventListener('touchstart',e=>{if(e.touches.length>1){follow=false;fitWhole=false;followButton();}},{passive:true}); }
        }
        if (!mapView || !el.isConnected) return;
        const {map, L, group} = mapView; group.clearLayers();
        for (const pts of ln) L.polyline(pts, {color: col('--route'), weight: 4}).addTo(group);
        const last = session.points.at(-1);
        if (last) mapView.here = hereMarker(mapView, mapView.here, last.lat, last.lon, last.accuracy);
        if (follow && last) map.setView([last.lat, last.lon], Math.max(map.getZoom() || 0, 16), {animate: false});
        else if(fitWhole){const all=ln.flat();if(all.length)map.fitBounds(L.latLngBounds(all),{padding:[24,24],maxZoom:17,animate:false});fitWhole=false;}
        const chip = $('#track-gps-live'); if (chip) { chip.textContent = last ? gpsText(last.accuracy) : 'Finding GPS…'; chip.hidden = false; }
        followButton();
      } catch (_) { message = 'Map unavailable. Your timer and GPS recording continue.'; update(); }
      finally { mapTimer = null; }
    }, mapView?.el===$('#track-map')?1200:0);
  }
  function followButton() { const b = $('#track-follow'); if (b) { b.innerHTML = follow ? 'Whole route' : `${svg('track')}Follow me`; b.setAttribute('aria-pressed', String(!follow)); } }
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
    return `<div class="track-review-photos" aria-label="Activity photos">${d?.photos?.length ? `<div class="track-photo-list">${d.photos.map((image,i)=>`<figure><img src="${esc(image)}" alt="Selected activity photo ${i+1}"><button type="button" class="icon-btn" data-track-photo-remove="${i}" aria-label="Remove photo ${i+1}"${locked?' disabled':''}>${svg('close')}</button></figure>`).join('')}</div>`:''}
      ${!d?.request && (d?.photos?.length || 0)<10 ? `<button type="button" class="ghost wide" id="track-photos-add"${locked?' disabled':''}>${svg('camera')}${photoBusy?'Preparing photos…':d?.loaded?'Add photos':'Opening photo storage…'}</button><input type="file" id="track-photos-file" accept="image/*" multiple hidden>`:''}
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
    if(rows.length)chartStack(box,data.t,rows,{xfmt:clock});else box.innerHTML='<p class="small muted">Not enough GPS samples for a chart.</p>';
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
    return `<section class="track-session track-review"><p class="track-review-when">${esc(session.label)} · ${esc(when)}</p><form class="form" id="track-save-form">
      <div class="card track-review-primary"><label class="track-title">Title<input name="activity_name" value="${esc(session.name ?? session.label)}" maxlength="200" autocomplete="off" enterkeyhint="done" required${saving?' disabled':''}></label>
      <div class="track-review-stats track-review-headlines">${headline}</div>
      ${session.gps && session.points.length>1?'<div class="map track-review-map-wrap" id="track-map-wrap"><div class="track-map" id="track-map"></div><button type="button" class="map-full" aria-label="Full-screen map">'+svg('expand')+'</button></div>':''}
      ${reviewPhotoHTML()}</div>
      ${session.gps?'<section class="card track-review-chart-card"><h2>Charts</h2><div class="activity-charts" id="track-review-charts"></div></section>':''}
      <details class="card track-review-details"${reviewDraft?.detailsOpen?' open':''}><summary>Details &amp; splits${svg('down')}</summary><div class="track-review-stats">${more}</div>
      ${session.intervals?'<section id="interval-live" class="track-interval-live" aria-label="Intervals"></section>':''}
      ${rows.length?`<div class="track-review-splits"><h3>Splits</h3>${rows.map(([label,time])=>`<div><span>${esc(label)}</span><b class="num">${clock(time)}</b></div>`).join('')}</div>`:''}
      ${laps.length?`<h3>Manual laps</h3><div class="tblwrap">${lapsTable({sport:session.sport,laps})}</div>`:''}</details>
      <div class="card track-review-sharing"><label>Who can see this activity<select name="visibility"${saving ? ' disabled' : ''}>${!session.visibility && !App.me.share_default ? '<option value="">Use my saved sharing setting</option>' : ''}${Object.entries({me: 'Only me', friends: 'Approved friends', everyone: 'Everyone on Kinetta'}).map(([value, label]) => `<option value="${value}"${value === (reviewDraft?.request?.visibility || reviewDraft?.request?.expected_sharing_default || session.visibility || App.me.share_default) ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      ${session.gps?`<p class="small muted">Shared maps hide the start and end.${session.points.some(p=>p.segment!==session.points[0]?.segment)?' Shared previews show the longest recorded section.':''}</p>`:''}</div></form>
      ${frozen?'<a class="ghost wide track-check-saved" href="/me/activities">View my activities</a>':`<button class="ghost wide" id="track-continue"${locked?' disabled':''}>Continue recording</button><button class="linkbtn danger track-discard" id="track-discard"${locked?' disabled':''}>Discard recording</button>`}
      <div class="track-review-dock"><p class="small danger" id="track-save-error" role="alert">${esc(saveError || (!saving && frozen?'Save not confirmed. Draft kept.':''))}</p><button type="submit" form="track-save-form" class="primary wide" id="track-save"${locked?' disabled':''}>${saving?'Saving…':frozen?'Retry save':'Save activity'}</button></div></section>`;
  }
  function liveMapHTML(paused) {
    return `<div class="map track-map-wrap" id="track-map-wrap"><div class="track-map live-record-map" id="track-map"></div><span class="gps-chip" id="track-gps-live" hidden></span>
      <button type="button" class="map-full" aria-label="Full-screen map">${svg('expand')}</button><button type="button" class="map-chip" id="track-follow">Whole route</button>
      <div class="track-full-summary"><b class="num"><span data-track-value="time"></span> · <span data-track-value="distance"></span></b><small>${speedSport(session)?'Avg speed':'Avg'} <span data-track-value="average"></span> ${speedSport(session)?U.su():'/'+U.du()} · Lap <span data-track-value="lap"></span> ${speedSport(session)?U.su():'/'+U.du()}</small></div>
      <div class="track-full-controls">${paused?`<span class="round-ctl"><button type="button" class="round-btn go" data-track-pause aria-label="Resume">${svg('play')}</button><small>Resume</small></span><span class="round-ctl"><button type="button" class="round-btn stop" data-track-finish aria-label="Finish">${svg('stop')}</button><small>Finish</small></span>`:`<span class="round-ctl"><button type="button" class="round-btn lap" data-track-lap aria-label="Mark lap">${svg('flag')}</button><small>Lap</small></span><span class="round-ctl"><button type="button" class="round-btn" data-track-pause aria-label="Pause">${svg('pause')}</button><small>Pause</small></span>`}
      <span class="round-ctl"><button type="button" class="round-btn" data-track-follow aria-label="Follow me">${svg('track')}</button><small>Follow me</small></span></div></div>`;
  }
  function draw() {
    const el = $('#track-content'); if (!el || !App.me) return;
    const renderRevision=++drawRevision;
    if (!session) { mapOverlay?.close();mapOverlay=null;reviewResize?.disconnect();reviewResize=null;const top=el.parentElement?.querySelector(':scope > .top');if(top){top.hidden=false;$('h1',top).textContent='Track';const acts=$('.acts',top);if(acts)acts.hidden=false;}ready(el,renderRevision);cleanViews();return; }
    const renderedId=session.id,renderedOwner=readOwner(),live=()=>session?.id===renderedId&&readOwner()===renderedOwner&&el.isConnected;
    const review = session.state === 'review', paused = session.state !== 'recording';
    const heldMap=review && el._trackReview && el._trackId===session.id?$('#track-map-wrap',el):null;
    const heldChart=heldMap && el._trackUnits===U.du()?$('#track-review-charts',el):null;
    const heldOverlay=heldMap?mapOverlay:null;
    mapOverlay?.close();mapOverlay=null;reviewResize?.disconnect();reviewResize=null;
    if(review)loadReview();
    const top = el.parentElement?.querySelector(':scope > .top'); if (top) top.hidden = !review;   // the session header names it
    if(top && review){$('h1',top).textContent='Review activity';const acts=$('.acts',top);if(acts)acts.hidden=true;}
    if (review && !heldMap) { follow = false; fitWhole = true; }   // entering review fits the recording once
    el.innerHTML = review ? reviewHTML() : `<section class="track-session track-live ${display === 'stats' ? 'stats-expanded' : ''} ${paused ? 'is-paused' : 'is-recording'}"><div class="track-live-main"><div class="track-live-top"><h2><span class="rec-dot" aria-hidden="true"></span>${esc(session.label)}</h2>${session.gps && !review ? `<div class="seg" role="group" aria-label="Recording display"><button data-display="map" aria-pressed="${display === 'map'}">Map</button><button data-display="stats" aria-pressed="${display === 'stats'}">Stats</button></div>` : ''}</div>
      <p id="track-status" class="small muted" role="status"></p>
      ${session.intervals?'<section id="interval-live" class="card track-interval-live" aria-label="Current interval"></section>':''}
      <div class="track-hero"><b class="num" id="track-time"></b><small>Active time</small></div>
      ${session.gps ? `<div class="track-live-metrics"><div><b class="num" id="track-distance"></b><small>Distance · ${U.du()}</small></div><div><b class="num" id="track-pace"></b><small>${speedSport(session)?'Avg speed':'Avg pace'} · ${speedSport(session)?U.su():'/'+U.du()}</small></div><div><b class="num" id="track-lap-pace"></b><small>${speedSport(session)?'Lap speed':'Lap pace'} · ${speedSport(session)?U.su():'/'+U.du()}</small></div></div><p class="small muted track-splits" id="track-splits"></p>` : ''}
      ${session.gps && display === 'map' ? liveMapHTML(paused) : ''}
      ${`<div class="track-controls" role="group" aria-label="Recording controls">${paused ? `<span class="round-ctl round-ctl-discard"><button class="round-btn discard" id="track-discard" aria-label="Discard recording">${svg('trash')}</button><small>Discard</small></span><span class="round-ctl"><button class="round-btn go" id="track-pause" aria-label="Resume">${svg('play')}</button><small>Resume</small></span><span class="round-ctl"><button class="round-btn stop" id="track-finish" aria-label="Finish">${svg('stop')}</button><small>Finish</small></span>` : `${session.gps?`<span class="round-ctl"><button class="round-btn lap" id="track-lap" data-track-lap aria-label="Mark lap">${svg('flag')}</button><small>Lap</small></span>`:''}<span class="round-ctl"><button class="round-btn" id="track-pause" aria-label="Pause">${svg('pause')}</button><small>Pause</small></span>`}</div></div><p class="small muted">${session.native ? 'Recording continues with the screen locked or another app open.' : 'Browser recording pauses when you leave this page. Use the iPhone app for background GPS.'}</p>${paused && session.gps && !session.native ? '<button class="ghost wide" id="track-timer">Continue without GPS</button>' : ''}`}
      ${paused ? '' : `<button class="linkbtn danger track-discard" id="track-discard"${saving ? ' disabled' : ''}>Discard recording</button>`}</section>`;
    if(heldMap)$('#track-map-wrap',el)?.replaceWith(heldMap);
    if(heldChart)$('#track-review-charts',el)?.replaceWith(heldChart);
    el._trackId=session.id;el._trackReview=review;el._trackUnits=U.du();
    $$('[data-display]', el).forEach((b) => b.onclick = () => { display = b.dataset.display; draw(); });
    cleanViews();
    const wrap=$('#track-map-wrap');if(wrap){mapOverlay=heldOverlay || wireMediaMapFull(wrap,()=>mapView?.el===$('#track-map')?mapView:null,lines,false,{tapArea:'.track-map',refitOnClose:review});const controls=$('.track-full-controls',wrap);if(controls){const observer=new ResizeObserver(()=>{if(wrap.isConnected)wrap.style.setProperty('--map-controls-height',Math.ceil(controls.getBoundingClientRect().height)+'px');});observer.observe(controls);viewResources.set(controls,()=>observer.disconnect());}}
    $$('[data-track-lap]',el).forEach(b=>b.onclick=markLap);
    $$('[data-track-pause]',el).forEach(b=>b.onclick=()=>$('#track-pause')?.click());
    $$('[data-track-finish]',el).forEach(b=>b.onclick=()=>$('#track-finish')?.click());
    $$('[data-track-follow]',el).forEach(b=>b.onclick=()=>{follow=true;fitWhole=false;refreshMap();followButton();});
    const fb = $('#track-follow', el); if (fb) fb.onclick = () => { follow = !follow;fitWhole=!follow; refreshMap(); followButton(); };
    update(); if (session.gps) refreshMap();
    if (!review) {
      $('#track-pause').onclick = async () => { if(!live())return;if (session.state === 'recording') { await pause(); draw(); } else resume(); };
      const finish = $('#track-finish'); if (finish) finish.onclick = async () => { if(!live())return;if (session.native) { await nativeControl('finish'); return; } await pause(); if (TrackMath.seconds(session) < 1) { message = 'Record at least one second before finishing.'; update(); return; } session.state = 'review'; message = 'Ready to save'; session.finishedAt = Date.now(); persist(); draw(); };
      const timer = $('#track-timer'); if (timer) timer.onclick = () => { session.gps = false; resume(); };
    } else {
      const form = $('#track-save-form'); form.elements.namedItem('activity_name').oninput = () => { session.name = form.elements.namedItem('activity_name').value; form.elements.namedItem('activity_name').setCustomValidity(''); persist(); };
      const continuing=$('#track-continue');if(continuing)continuing.onclick=()=>{if(!live()||saving||photoBusy||reviewDraft?.request)return;session.state='paused';resume();};
      wireReviewPhotos(live);if(!heldChart)reviewCharts();
      const chart=$('#track-review-charts'),dock=$('.track-review-dock'),section=$('.track-review');let width=chart?.clientWidth;
      const observer=new ResizeObserver(()=>{if(!live())return;if(chart?.isConnected&&Math.abs(chart.clientWidth-width)>1){width=chart.clientWidth;reviewCharts();}if(section?.isConnected && dock?.isConnected){const height=Math.ceil(dock.getBoundingClientRect().height)+'px';section.style.setProperty('--track-dock-height',height);document.documentElement.style.setProperty('--track-review-dock-height',height);}});
      if(chart)observer.observe(chart);if(dock)observer.observe(dock);reviewResize=observer;viewResources.set(form,()=>observer.disconnect());
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
  const OUTDOOR = [['run','Run'],['run','Trail run','Trail Running'],['ride','Ride'],['ride','Mountain bike','Mountain Biking'],['walk','Walk'],['hike','Hike'],['swim','Open-water swim','Open Water'],['row','Row on water'],['ski','Ski'],['other','Other outdoor activity']];
  // One-tap shortcuts for the most common choices (2026-10-18 UI pass); everything else stays in the All activities list.
  const TRACK_QUICK = [0, 2, 4, 5, OUTDOOR.length];   // Run, Ride, Walk, Hike, then Lifting (the first choice after OUTDOOR)
  function ready(el,renderRevision) {
    const indoor = HAND_KINDS.flatMap(([, rows]) => rows).filter(([, , kind]) => kind !== 'Strength Training');
    // GPS recording is in the iPhone app only (Ben, 2026-10-24); a browser times indoor workouts, lifting and past entries.
    // A GPS draft already started in a browser can still be finished and saved (draw/resume above).
    const outdoor = TrackNative.supported ? OUTDOOR : [];
    const choices = [...outdoor.map(([sport,label,kind]) => ({sport,label,sportLabel:kind,gps:true})), {label:'Lifting',lift:true}, ...indoor.map(([sport,label,kind]) => ({sport,label,sportLabel:kind,gps:false}))];
    const quick = outdoor.length ? TRACK_QUICK : [0, 1, 2, 3].filter(i => i < choices.length);
    let selected = Math.min(choices.length-1, Math.max(0, +store.get(key + ':choice') || 0));
    const done = new URLSearchParams(location.search).get('done');
    el.innerHTML = `${done && /^\d+$/.test(done) ? `<div class="track-saved" role="status"><b>Activity saved</b><a href="/activity/${done}">View activity${svg('chev')}</a></div>` : ''}<form class="form track-ready" id="track-setup">${outdoor.length ? '' : `<p class="small muted track-gps-note">Record runs, rides and walks with GPS in the Kinetta iPhone app${App.me?.iphone_app ? ` (<a href="${esc(App.me.iphone_app)}" target="_blank" rel="noopener">get it through TestFlight</a>)` : ''}. Here you can time indoor workouts, log lifting and add past activities.</p>`}<div class="track-quick" role="group" aria-label="Common activities">${quick.map(i => `<button type="button" data-quick="${i}" aria-pressed="${i===selected}">${svg(choices[i].lift ? 'workout' : choices[i].sport)}<span>${esc(choices[i].label)}</span></button>`).join('')}</div><details class="track-other" id="track-other"><summary>${quick.includes(selected)?'More activities':esc(choices[selected].label)}${svg('down')}</summary><label>All activities<select id="track-kind">${choices.map((c,i) => `${i===0 && outdoor.length ? '<optgroup label="Outdoor · GPS">' : i===outdoor.length ? `${outdoor.length ? '</optgroup>' : ''}<optgroup label="Indoor · timer and sets">` : ''}<option value="${i}"${i===selected ? ' selected' : ''}>${esc(c.label)}${c.gps ? ' · GPS' : c.lift ? ' · sets & reps' : ' · timer'}</option>`).join('')}</optgroup></select></label></details>
      <div class="track-ready-map-wrap" id="track-ready-map-wrap"><div class="track-ready-map" id="track-ready-map" aria-label="Map before recording"></div><span class="gps-chip" id="track-gps-chip" role="status" hidden></span><button type="button" class="icon-btn track-locate" id="track-locate" aria-label="Locate me">${svg('track')}</button></div>
      <div class="track-go"><button class="round-btn start" id="track-start"><span>Start</span></button><small id="track-start-label"></small></div><div class="track-interval-ready" id="track-interval-ready"></div>
      <p class="small danger" id="track-ready-error" role="alert"></p>
      <button type="button" class="track-prefs" id="track-options" hidden></button><p class="small muted" id="track-guidance"></p>
      </form>
      <div id="track-open-lift"></div><section class="track-tools" aria-labelledby="track-tools-h"><h2 class="sec-head" id="track-tools-h">More ways to add</h2><div class="card list">${Native.on ? `<a class="row-link" href="/track/health">${svg('heart')}<span class="grow">Apple Health</span>${svg('chev')}</a>` : ''}<a class="row-link" href="/track/connections">${svg('watch')}<span class="grow">Connections<small class="muted gs-sub">${Native.on ? 'Garmin and Apple Health' : 'Garmin, Apple Health and other apps'}</small></span>${svg('chev')}</a><button class="row-link" id="track-past">${svg('calendar')}<span class="grow">Log a past activity</span>${svg('chev')}</button>${Native.on ? '' : `<a class="row-link" href="/track/import">${svg('upload')}<span class="grow">Import activity history</span>${svg('chev')}</a>`}</div></section>`;
    let view=null,dot=null,located=false,here=null,loadingMap=false,centred=false,readyFollow=true;const readyOwner=readOwner(),readyLive=()=>renderRevision===drawRevision&&el.isConnected&&readyOwner===readOwner()&&!session;
    const guide = () => { const c=choices[selected];globalThis.Intervals?.mount($('#track-interval-ready'),c);$('#track-ready-map-wrap').hidden=!c.gps;el.classList.toggle('gps-ready',!!c.gps);ensureMap();$('#track-start-label').textContent=c.lift?'Lifting':c.label;$('#track-start').setAttribute('aria-label',c.lift?'Start lifting':`Start ${c.label.toLowerCase()}`);$('#track-guidance').textContent=c.lift?'Exercises, sets, reps and a rest timer.':c.gps ? TrackNative.supported ? 'GPS keeps recording with your screen locked.' : 'Outdoor GPS recording. For screen-off and background recording, use the iPhone app.' : TrackNative.supported ? 'A timer for active time, including with the screen locked.' : 'Timer recording. Keep this browser page open.'; };
    // Spoken splits and auto-pause (#234 item 4): on by default, auto-pause off for rides; remembered on this device
    // Recording settings live in a sheet (Ben, 2026-10-26: big checkboxes up top weren't friendly); one quiet line
    // under Start says what's on and opens it. Same saved choices as before, per device.
    const opts=()=>{ const c=choices[selected],box=$('#track-options');if(!box)return;
      box.hidden=!c.gps;if(!c.gps)return;
      const o=recordOptions(c.sport),unit=imp()?'mile':'km';
      box.innerHTML=`${svg('sound')}<span>${o.voice?`Spoken every ${unit}`:'Spoken updates off'} · Auto-pause ${o.autoPause?'on':'off'}</span>${svg('chev')}`;
      box.onclick=()=>prefs(c); };
    const prefs=(c)=>{ const o=recordOptions(c.sport),unit=imp()?'mile':'km';
      sheet('Recording settings',`<div class="track-pref-list"><label class="switch-row"><span><b>Spoken updates</b><small>Hear your time and ${speedSport(c)?'speed':'pace'} at every ${unit}, even with the screen locked.</small></span><input type="checkbox" role="switch" id="track-voice"${o.voice?' checked':''}></label>
        <label class="switch-row"><span><b>Auto-pause</b><small>Stops the clock when you stop moving and starts it when you go. Saved for each kind of activity: this is for ${esc(c.label.toLowerCase())}.</small></span><input type="checkbox" role="switch" id="track-auto"${o.autoPause?' checked':''}></label></div>
        <button type="button" class="primary wide" data-done>Done</button>`,(b,close)=>{
        $('#track-voice',b).onchange=(e)=>{store.set(key+':voice',e.target.checked);opts();};
        $('#track-auto',b).onchange=(e)=>{store.set(key+':auto:'+c.sport,e.target.checked);opts();};
        $('[data-done]',b).onclick=close;});
      Native.haptic?.('selection'); };
    const gear=$('#track-settings');if(gear)gear.onclick=()=>{const c=choices[selected];if(c.gps)prefs(c);else toast('Spoken updates and auto-pause are for GPS activities.');};
    const pick=(i)=>{selected=i;setTimeout(opts);store.set(key+':choice',selected);$('#track-kind').value=String(i);const other=$('#track-other');other.open=false;$('summary',other).innerHTML=esc(quick.includes(i)?'More activities':choices[i].label)+svg('down');$$('[data-quick]',el).forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.quick===i)));guide();};
    $('#track-kind').onchange=(e)=>pick(+e.target.value);opts();
    $$('[data-quick]',el).forEach(b=>b.onclick=()=>{Native.haptic?.('selection');pick(+b.dataset.quick);});guide();
    // Find the person at once when an outdoor activity is chosen, like other running apps. The iPhone app asks iOS
    // (permission is remembered); a browser locates by itself only after the person has already allowed it.
    const show=(lat,lon,accuracy,at)=>{if(!readyLive())return;located=true;here=[lat,lon,accuracy,at];if(!view||!$('#track-ready-map')?.isConnected)return;
      // street level, so the dot shows which side of the road you're on; later fixes keep it centred
      if(!centred&&readyFollow){view.map.setView([lat,lon],17);centred=true;}else if(readyFollow)view.map.panTo([lat,lon],{animate:true});
      dot=hereMarker(view,dot,lat,lon,accuracy);const chip=$('#track-gps-chip');if(chip){chip.textContent=gpsText(accuracy);chip.hidden=!chip.textContent;} };
    const locate=async(quiet)=>{
      const button=$('#track-locate'),error=$('#track-ready-error');if(!button||button.disabled)return;
      button.disabled=true;if(!quiet)error.textContent='';
      try {
        if(TrackNative.supported){const p=await TrackNative.locate({quiet});show(p.lat,p.lon,p.accuracy,p.timestamp);}
        else {
          if(!navigator.geolocation)throw new Error('Location is unavailable on this device.');
          if(quiet){const state=await navigator.permissions?.query({name:'geolocation'}).then((s)=>s.state,()=>null);if(state!=='granted')return;}
          const p=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,maximumAge:15000,timeout:15000}));
          show(p.coords.latitude,p.coords.longitude,p.coords.accuracy,p.timestamp);
        }
      } catch(e) { if(!quiet&&button.isConnected)error.textContent=e?.message && TrackNative.supported ? e.message : 'Allow location access to see where you are. You can still choose an indoor activity.'; }
      finally { if(button.isConnected)button.disabled=false; }
    };
    const auto=()=>{ if(!located&&choices[selected].gps)locate(true); };
    $('#track-locate').onclick=()=>{centred=false;readyFollow=true;locate(false);};
    $('#track-kind').addEventListener('change',auto);auto();
    // keep the dot live while you get ready, not just one fix from when the screen opened
    const tick=setInterval(()=>{ if(!readyLive()){clearInterval(tick);return;} if(located&&choices[selected].gps&&!document.hidden)locate(true); },8000);
    function ensureMap(){
      if(!choices[selected].gps||loadingMap)return;
      if(view){requestAnimationFrame(()=>{if(el.isConnected)view.map.invalidateSize();});return;}
      loadingMap=true;
      mapInto($('#track-ready-map'), [], {still:true}).then(v=>{if(!v)return;if(!readyLive()){v.map.remove();return;}view=v;view.map.on('dragstart',()=>{readyFollow=false;});if(here)show(...here);})
        .catch(()=>{if(el.isConnected)$('#track-ready-error').textContent='Map unavailable. Recording still works without map tiles.';})
        .finally(()=>{loadingMap=false;});
    }
    globalThis.Intervals?.mount($('#track-interval-ready'),choices[selected]);
    if(globalThis.Intervals&&new URLSearchParams(location.search).get('intervals')==='1'){const url=new URL(location.href);url.searchParams.delete('intervals');history.replaceState(null,'',url.pathname+url.search+url.hash);Intervals.library(()=>Intervals.mount($('#track-interval-ready')));}
    $('#track-setup').onsubmit=async(e)=>{e.preventDefault();if(controlling||!readyLive())return;const c=choices[selected];if(c.lift){if(globalThis.Intervals?.hasSelection()){const error=$('#track-ready-error');if(error)error.textContent='Intervals need an outdoor Run or Walk in the iPhone app. Change the activity or remove the loaded preset.';return;}startLiftSheet();return;}await begin(c.sport,c.label,c.sportLabel,c.gps);};
    $('#track-past').onclick=()=>addActivitySheet();liftNowCard($('#track-open-lift'));
  }
  function recordOptions(sport) {
    const voice=store.get(key+':voice'),auto=store.get(key+':auto:'+sport);
    return {voice:voice==null?true:!!voice,autoPause:auto==null?['run','walk','hike'].includes(sport):!!auto,splitMetres:imp()?1609.344:1000};
  }
  async function begin(sport,label,sportLabel,gps) {
    if(session||controlling)return;
    const o=gps?recordOptions(sport):{voice:false,autoPause:false,splitMetres:imp()?1609.344:1000},revision=readOwner(),button=$('#track-start');
    const startError=$('#track-ready-error');if(startError)startError.textContent='';
    controlling=true;nativeRevision++;if(button){button.disabled=true;$('span',button).textContent='Starting…';}
    try{
      const intervalOptions=globalThis.Intervals?await Intervals.startOptions({sport,gps}):null;
      if(revision!==readOwner()||!button?.isConnected)return;
      if(revision!==readOwner()||!button?.isConnected)return;
      if(TrackNative.supported){
        if(nativeTask)await nativeTask.catch(()=>{});
        if(revision!==readOwner())return;
        adoptNative(await TrackNative.call('start',{id:crypto.randomUUID(),sport,label,sportLabel:sportLabel||null,gps,...o,...(intervalOptions||{})}));
        if(revision===readOwner()){draw();sync();window.scrollTo(0,0);}return;
      }
      const now=Date.now();session={id:crypto.randomUUID(),sport,label,sportLabel,gps,start:now,activeAt:now,checkpoint:now,activeMs:0,state:'paused',points:[],segment:0,distance:0,...o,splits:[],autoMs:0,lastMove:null};
      if(!persist()){draw();return;}resume();window.scrollTo(0,0);
    }catch(e){if(revision===readOwner()){const error=$('#track-ready-error');if(error)error.textContent=e.message;}}
    finally{controlling=false;if(button?.isConnected){button.disabled=false;$('span',button).textContent='Start';}}
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && session?.state === 'recording' && !session.native) { message = 'Paused while Kinetta was in the background. Resume when ready.'; pause(); draw(); } });
  window.addEventListener('pagehide', () => { if (session && !session.native) pause(); });
  setInterval(() => { if (!App.me || owner && readOwner() !== owner) { stopGPS(); if (session && !session.native) pause(); return; } if(!session)refreshReadyDistance?.(); if (session?.native) { if (!document.hidden && location.pathname === '/track') pullNative().catch((e)=>{message=e.message;update();});update();return; } if (session?.state === 'recording') { session.checkpoint = Date.now(); persist(false); update(); } }, 1000);
  return {get active() { return !!session; }, sync, draw, pause, pullNative, restoreReview, async leave() { if(TrackNative.supported) await TrackNative.detach();else await pause(); }, async forgetDraft() { const scope=key;stopGPS();mapOverlay?.close();if(scope)store.del(scope);session=null;reviewDraft=null;if(scope)await TrackReviewStore.erase(scope); }};
})();
route(/^\/track$/, 'track', async (el) => {
  Track.sync(); el.innerHTML = `<div class="top"><h1>Track</h1><div class="acts">${TrackNative.supported ? `<button type="button" class="icon-btn" id="track-settings" aria-label="Recording settings">${svg('gear')}</button>` : ''}</div></div><div id="track-content"></div>`;
  await Track.restoreReview();
  if (TrackNative.supported) { try { await Track.pullNative(); } catch(e) { toast(e.message); } }
  Track.draw();
});
