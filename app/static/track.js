// Track owns every recording flow. Native iPhone GPS continues independently of WebView visibility.
'use strict';
if (typeof IC !== 'undefined') Object.assign(IC, {   // the recording controls (2026-10-26 Track redesign); tests load the maths alone
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.2"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
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
    const step = this.step(s.anchor, p);
    // moving again after a stop: a counted step, or the first fix of a new section (no GPS arrives while you stand still)
    if (step !== null) { s.distance += step; if (step > 0 || last) this.moved(s, position.timestamp); s.anchor = p; }
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
  // Pace or speed over the last ~30 s of samples [{t, d}] the screen keeps; null when too little movement to say.
  current(samples, now) {
    const recent = samples.filter((x) => now - x.t <= 30000);
    if (recent.length < 2) return null;
    const a = recent[0], b = recent[recent.length - 1], metres = b.d - a.d, secs = (b.t - a.t) / 1000;
    return metres >= 10 && secs >= 5 ? metres / secs : null;     // metres per second
  },
};
const Track = (() => {
  let session = null, key = null, owner = null, watch = null, wake = null, message = '', saving = false, mapTimer = null, mapView = null, lastPersist = 0, nativeTask = null, controlling = false, display = 'map', nativeRevision = 0,refreshReadyDistance=null,drawRevision=0;
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
    if(typeof RouteDownloads!=='undefined')RouteDownloads.attach();
    const next = accountKey();
    if (next !== key || owner && owner !== readOwner()) {
      if (session && !session.native) pause();
      key = next; owner = App.me ? readOwner() : null; session = key ? store.get(key) : null; message = '';
      if (session) {
        // No time is invented between the last durable checkpoint and opening Kinetta again.
        if (session.state === 'recording' && !session.native) { TrackMath.settle(session, session.checkpoint || session.activeAt); session.activeMs += Math.max(0, (session.checkpoint || session.activeAt) - session.activeAt); session.state = 'paused'; session.segment++; message = 'Recording paused when Kinetta closed. Resume when you are ready.'; persist(); }
      }
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
    if (!incoming) { if (session?.native) { session = null; store.del(key); } return; }
    const same = session?.id === incoming.id;
    const points = same && incoming.pointOffset === session.points.length ? [...session.points, ...incoming.points] : incoming.points;
    const name = same ? session.name : null,visibility=same?session.visibility:null,pinned=same?session.routePlan:null;
    session = {...incoming, points,_snapshotClock:typeof performance!=='undefined'?performance.now():0,routePlan:Object.prototype.hasOwnProperty.call(incoming,'routePlan')?incoming.routePlan:pinned}; if (name) session.name = name;if(visibility)session.visibility=visibility;
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
  async function nativeControl(method, args = {}) {
    if (controlling || !session?.native) return;
    controlling = true; nativeRevision++; const revision = readOwner();
    try { if(nativeTask) await nativeTask.catch(()=>{}); adoptNative(await TrackNative.call(method, {id:session.id,since:0,...args})); }
    catch (e) { if (revision === readOwner()) message = e.message; }
    finally { controlling = false; if (revision === readOwner()) { draw(); sync(); } }
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
  let samples = [];
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
    const now = Date.now(), secs = TrackMath.seconds(session, now), idle = TrackMath.autoPaused(session, now);
    if (session.state === 'recording') { samples.push({t: now, d: session.distance}); while (samples.length && now - samples[0].t > 35000) samples.shift(); } else samples = [];
    // the big number is your pace right now (last ~30 s); the average and the last split sit underneath (#234 item 4)
    const pace = $('#track-pace'); if (pace) { const v = idle ? null : TrackMath.current(samples, now), avg = session.distance > 10 && secs > 0 ? session.distance / secs : null;
      pace.textContent = v ? rateText(session, v) : avg ? rateText(session, avg) : '—';
      const label = $('#track-pace-label'); if (label) label.textContent = v || !avg ? (speedSport(session) ? 'Speed' : 'Pace') : (speedSport(session) ? 'Avg speed' : 'Avg pace'); }
    const splits = $('#track-splits'); if (splits) { const n = (session.splits || []).length, last = n ? session.splits[n - 1] - (n > 1 ? session.splits[n - 2] : 0) : 0;
      // the big number falls back to the average, so the average is only repeated here while it shows current pace
      const showsAvg = !(idle ? null : TrackMath.current(samples, now));
      splits.textContent = session.distance > 10 && secs > 0 ? [showsAvg ? '' : `Average ${rateText(session, session.distance / secs)}`, n ? `${unitName(session)} ${n} in ${dur(last)}` : ''].filter(Boolean).join(' · ') : ''; }
    // plain Recording / Paused is what the dot shows; screen readers still hear it, sighted people see only news
    updateRouteProgress();
    const status = $('#track-status'); if (status) { status.textContent = idle ? 'Auto-paused · starts again when you move' : message || (session.state === 'recording' ? 'Recording' : 'Paused'); status.classList.toggle('vh', !idle && !message); }
  }
  let routeCourse=null,routeState={},routeRecording=null,routeLine=null,fitWhole=false;
  function updateRouteProgress(){
    const box=$('#track-route-progress');if(!box||!session?.routePlan||typeof RouteMath==='undefined')return;
    const plan=session.routePlan;
    try{
      if(routeRecording!==session.id||routeLine!==plan.line){routeRecording=session.id;routeLine=plan.line;routeCourse=RouteMath.compile(RouteMath.decode(plan.line),plan.breaks||[]);routeState={};}
      routeState=RouteMath.replay(routeCourse,session.points,session.start,routeState);
      const current=RouteMath.fresh(routeState.last,Date.now()),label=$('#track-route-distance',box);
      label.textContent=routeState.known&&current?`${routeState.partway?'First matched partway · ':''}${routeState.complete?'Route complete · keep recording until you finish':`${U.dist(routeState.m)} ${U.du()} along · ${U.dist(routeState.remaining)} ${U.du()} remaining`}`:'Route position uncertain · recording continues';
    }catch(_){const label=$('#track-route-distance',box);if(label)label.textContent='Route position unavailable · recording continues';}
  }
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
        const {map, L, group} = mapView; group.clearLayers(); planOverlay(mapView, false);
        for (const pts of ln) L.polyline(pts, {color: col('--route'), weight: 4}).addTo(group);
        const last = session.points.at(-1);
        if (last) mapView.here = hereMarker(mapView, mapView.here, last.lat, last.lon, last.accuracy);
        if (follow && last) map.setView([last.lat, last.lon], Math.max(map.getZoom() || 0, 16), {animate: false});
        else if(fitWhole){const all=[...ln.flat(),...(session.routePlan?RouteMath.decode(session.routePlan.line):[])];if(all.length)map.fitBounds(L.latLngBounds(all),{padding:[24,24],maxZoom:17,animate:false});fitWhole=false;}
        const chip = $('#track-gps-live'); if (chip) { chip.textContent = last ? gpsText(last.accuracy) : 'Finding GPS…'; chip.hidden = false; }
        followButton();
      } catch (_) { message = 'Map unavailable. Your timer and GPS recording continue.'; update(); }
      finally { mapTimer = null; }
    }, 1200);
  }
  function followButton() { const b = $('#track-follow'); if (b) { b.innerHTML = follow ? 'Whole route' : `${svg('track')}Follow me`; b.setAttribute('aria-pressed', String(!follow)); } }
  function discard() {
    const id=session?.id,account=readOwner(),live=()=>session?.id===id&&account===readOwner();if(!id)return;
    sheet('Discard this recording?', '<p>This removes the draft from this device. It has not been saved as an activity.</p><button class="ghost wide" id="tr-keep">Keep recording</button><button class="primary danger-btn wide" id="tr-discard">Discard recording</button>', (b, close) => {
      $('#tr-keep', b).onclick = close;
      $('#tr-discard', b).onclick = async () => { if(!live())return;if (session.native) { const btn=$('#tr-discard',b);btn.disabled=true;try { nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear',{id}); } catch(e) { if(live()){toast(e.message);btn.disabled=false;}return; } }if(!live())return; stopGPS(); store.del(key); session = null; message = ''; close(); draw(); sync(); };
    });
  }
  function draw() {
    const el = $('#track-content'); if (!el || !App.me) return;
    const renderRevision=++drawRevision;
    if (!session) { ready(el,renderRevision); return; }
    const renderedId=session.id,renderedOwner=readOwner(),live=()=>session?.id===renderedId&&readOwner()===renderedOwner&&el.isConnected;
    const review = session.state === 'review', paused = session.state !== 'recording';
    const top = el.parentElement?.querySelector(':scope > .top'); if (top) top.hidden = !review;   // the session header names it
    el.innerHTML = `<section class="track-session track-live ${session.routePlan?'has-route':''} ${display === 'stats' ? 'stats-expanded' : ''} ${paused ? 'is-paused' : 'is-recording'}"><div class="track-live-top"><h2><span class="rec-dot" aria-hidden="true"></span>${esc(session.label)}</h2>${session.gps && !review ? `<div class="seg" role="group" aria-label="Recording display"><button data-display="map" aria-pressed="${display === 'map'}">Map</button><button data-display="stats" aria-pressed="${display === 'stats'}">Stats</button></div>` : ''}</div>
      <p id="track-status" class="small muted" role="status"></p>
      ${session.intervals?'<section id="interval-live" class="card track-interval-live" aria-label="Current interval"></section>':''}
      <div class="track-hero"><b class="num" id="track-time"></b><small>Active time</small></div>
      ${session.gps ? `<div class="track-live-metrics"><div><b class="num" id="track-distance"></b><small>Distance · ${U.du()}</small></div><div><b class="num" id="track-pace"></b><small><span id="track-pace-label">${speedSport(session) ? 'Speed' : 'Pace'}</span> · ${speedSport(session) ? U.du() + '/h' : '/' + U.du()}</small></div></div><p class="small muted track-splits" id="track-splits"></p>` : ''}
      ${session.routePlan?`<div class="track-plan-progress" id="track-route-progress" aria-label="Planned route progress"><b>${esc(session.routePlan.name)}</b><span id="track-route-distance" class="small muted"></span><small class="track-route-legend"><span>┄ Planned route</span><span>━ Recorded trail</span><span>● Your location</span></small></div>`:''}
      ${session.gps && display === 'map' ? '<div class="track-map-wrap"><div class="track-map live-record-map" id="track-map"></div><span class="gps-chip" id="track-gps-live" hidden></span><button type="button" class="map-chip" id="track-follow">Whole route</button></div>' : ''}
      ${review ? `<form class="form" id="track-save-form"><label>Activity name<input name="activity_name" value="${esc(session.name || session.label)}" maxlength="200" required${saving?' disabled':''}></label><label>Who can see this activity<select name="visibility"${saving?' disabled':''}>${!session.visibility&&!App.me.share_default?'<option value="">Use my saved sharing setting</option>':''}${Object.entries({me:'Only me',friends:'Approved friends',everyone:'Everyone on Kinetta'}).map(([value,label])=>`<option value="${value}"${value===(session.visibility||App.me.share_default)?' selected':''}>${label}</option>`).join('')}</select></label><p class="small muted">Shared maps hide the start and end using your privacy settings.</p>${session.points.some((p) => p.segment !== session.points[0]?.segment) ? '<p class="small muted">Your activity map keeps every recorded section. Shared previews show the longest continuous section.</p>' : ''}<button class="primary wide" id="track-save"${saving ? ' disabled' : ''}>${saving ? 'Saving…' : 'Save activity'}</button><p class="small danger" id="track-save-error" role="alert"></p></form><button class="ghost wide" id="track-continue"${saving ? ' disabled' : ''}>Continue recording</button>` : `<div class="track-controls" role="group" aria-label="Recording controls">${paused ? `<span class="round-ctl"><button class="round-btn go" id="track-pause" aria-label="Resume">${svg('play')}</button><small>Resume</small></span><span class="round-ctl"><button class="round-btn stop" id="track-finish" aria-label="Finish">${svg('stop')}</button><small>Finish</small></span>` : `<span class="round-ctl"><button class="round-btn" id="track-pause" aria-label="Pause">${svg('pause')}</button><small>Pause</small></span>`}</div><p class="small muted">${session.native ? 'Recording continues with the screen locked or another app open.' : 'Browser recording pauses when you leave this page. Use the iPhone app for background GPS.'}</p>${paused && session.gps && !session.native ? '<button class="ghost wide" id="track-timer">Continue without GPS</button>' : ''}`}
      <button class="linkbtn danger track-discard" id="track-discard"${saving ? ' disabled' : ''}>Discard recording</button></section>`;
    $$('[data-display]', el).forEach((b) => b.onclick = () => { display = b.dataset.display; draw(); });
    const fb = $('#track-follow', el); if (fb) fb.onclick = () => { follow = !follow;fitWhole=!follow; refreshMap(); followButton(); };
    update(); if (session.gps) refreshMap();
    if (!review) {
      $('#track-pause').onclick = async () => { if(!live())return;if (session.state === 'recording') { await pause(); draw(); } else resume(); };
      const finish = $('#track-finish'); if (finish) finish.onclick = async () => { if(!live())return;if (session.native) { await nativeControl('finish'); return; } await pause(); if (TrackMath.seconds(session) < 1) { message = 'Record at least one second before finishing.'; update(); return; } session.state = 'review'; message = 'Ready to save'; session.finishedAt = Date.now(); persist(); draw(); };
      const timer = $('#track-timer'); if (timer) timer.onclick = () => { session.gps = false; resume(); };
    } else {
      const form = $('#track-save-form'); form.elements.namedItem('activity_name').oninput = () => { session.name = form.elements.namedItem('activity_name').value; form.elements.namedItem('activity_name').setCustomValidity(''); persist(); };
      $('#track-continue').onclick = () => { if(!live())return;session.state = 'paused'; resume(); };
      form.onsubmit = async (e) => {
        e.preventDefault(); if (saving||!live()) return; const name = form.elements.namedItem('activity_name').value.trim(); if (!name) { form.elements.namedItem('activity_name').setCustomValidity('Add an activity name'); form.elements.namedItem('activity_name').reportValidity(); return; } form.elements.namedItem('activity_name').setCustomValidity('');
        session.name = name; persist(); saving = true; const active = session, k = key;
        const payload = {visibility:session.visibility||undefined,expected_sharing_default:session.visibility?undefined:form.elements.namedItem('visibility').value||undefined,client_id: session.id, sport: session.sport, sport_label: session.sportLabel || null, name, start: new Date(session.start).toISOString(), elapsed_s: session.native&&Number.isFinite(session.elapsedSeconds)?session.elapsedSeconds:(session.finishedAt - session.start) / 1000, moving_s: TrackMath.seconds(session), points: session.points,...(session.intervals?{intervals:globalThis.Intervals?Intervals.resultPayload(session.intervals):session.intervals}:{}),route_plan:typeof RouteDownloads!=='undefined'?RouteDownloads.metadata(session.routePlan):undefined};
        draw();
        try { const result = await api('/api/activities/track', json('POST', payload)); if (session?.id !== active.id || key !== k) return; if (session.native) { nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear', {id:session.id}); } store.del(k); session = null; invalidate('/api/'); toast(result.duplicate?'This activity was saved earlier. Check its sharing on the activity.':'Activity saved'); if(result.duplicate)go(`/activity/${result.id}`);else if (location.pathname === '/track') go(`/track?done=${result.id}`, {replace:true}); else sync(); }
        catch (x) { if (session?.id === active.id && key === k) { if(x.code==='sharing_changed'&&['me','friends','everyone'].includes(x.detail?.sharing_default)){App.me.share_default=x.detail.sharing_default;keep('/api/me',App.me);} draw(); const err = $('#track-save-error'); if (err) err.textContent = x.message + ' Your draft is kept. Retry when ready.'; } }
        finally { saving = false; if (session?.id === active.id && key === k) { const form=$('#track-save-form');if(form)$$('input,select',form).forEach(field=>field.disabled=false); const btn = $('#track-save'); if (btn) { btn.disabled = false; btn.textContent = 'Save activity'; } for (const id of ['track-continue', 'track-discard']) { const b = $('#' + id); if (b) b.disabled = false; } } }
      };
    }
    const audience=$('#track-save-form select[name=visibility]');if(audience)audience.onchange=()=>{session.visibility=audience.value;persist();};
    $('#track-discard').onclick = ()=>{if(live())discard();};
  }
  // A planned route (#276 item 10): drawn under you on the ready and live maps. Choosing one never starts GPS, asks for
  // location or changes the activity; it's only a line to follow by eye (turn-by-turn guidance is separate, #279).
  function planOverlay(v, fitIt) {
    if (!v || typeof PlanTrack === 'undefined') return;
    const r=session?session.routePlan:PlanTrack.get(),colour=col('--tx2');
    if(v.planLayer&&r?.line===v.planLine&&colour===v.planColour){if(fitIt)v.map.fitBounds(v.L.latLngBounds(RouteMath.decode(r.line)),{padding:[24,24],maxZoom:16});return;}
    if(v.planLayer){v.planLayer.remove();v.planLayer=null;}if(!r?.line)return;v.planLine=r.line;v.planColour=colour;
    const parts=typeof RouteDownloads!=='undefined'?RouteDownloads.sections(r):[decode(r.line)],pts=parts.flat(); if (pts.length < 2) return;
    v.planLayer = v.L.layerGroup([...parts.flatMap(p=>[v.L.polyline(p,{color:col('--card'),weight:8,opacity:.8,interactive:false}),v.L.polyline(p,{color:col('--tx2'),weight:4,opacity:1,dashArray:'5 9',interactive:false})]),
      v.L.marker(pts[0],{icon:endIcon(v.L,'start',loopEnds(pts[0],pts.at(-1))),interactive:false,keyboard:false}),v.L.marker(pts.at(-1),{icon:endIcon(v.L,'end',loopEnds(pts[0],pts.at(-1))),interactive:false,keyboard:false})]).addTo(v.map);
    for(const part of parts){const len=Plan.length(part),n=Math.min(6,Math.max(2,Math.round(len/300)));
      for(let k=1;k<n;k++){const section=Plan.slice(part,0,len*k/n),a=section.at(-2),b=section.at(-1);if(!a||!b)continue;
        const angle=Plan.bearing(a,b).toFixed(0),icon=v.L.divIcon({className:'plan-arrow track-plan-arrow',iconSize:[16,16],iconAnchor:[8,8],html:`<span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><g transform="rotate(${angle} 8 8)"><path d="M8 14V2M3 7l5-5 5 5"/></g></svg></span>`});v.L.marker(b,{icon,interactive:false,keyboard:false}).addTo(v.planLayer);
      }
    }
    if (fitIt) v.map.fitBounds(v.L.latLngBounds(pts), {padding: [24, 24], maxZoom: 16});
  }
  function routeRow(c, redraw,fix=null) {
    const box = $('#track-route'); if (!box || typeof PlanTrack === 'undefined') return;
    if (!c.gps) { box.innerHTML = ''; return; }
    const account=readOwner(),live=()=>box.isConnected&&account===readOwner()&&!controlling;
    const r = PlanTrack.get();
    box.innerHTML = r ? `<div class="track-route-chip">${svg('route')}<a class="grow" href="${r.kind==='shared'?'/routes/shared/'+r.id:'/routes/plan/'+r.id+'?version='+r.version}"><b>${esc(r.name)}</b><small class="muted">${U.dist(r.distance_m)} ${U.du()} · planned route</small></a><button type="button" class="linkbtn" id="track-route-change">Change</button><button type="button" class="icon-btn" id="track-route-clear" aria-label="Don't use a route">${svg('close')}</button></div>`
      : `<button type="button" class="track-prefs" id="track-route-change">${svg('route')}<span>Add a planned route</span>${svg('chev')}</button>`;
    if(r&&typeof RouteDownloads!=='undefined'){
      const note=document.createElement('p');note.className='small muted';note.textContent=(r.warnings?.length?r.warnings.join(' ')+' ':'')+'Route saved; offline basemap unavailable.'+(r.kind==='shared'?' Starting keeps this version until the workout is finished or discarded, even if the original is unshared.':'');
      const distanceNote=document.createElement('p');distanceNote.className='small muted';distanceNote.id='track-route-start-distance';let course=null;try{course=RouteMath.compile(RouteMath.decode(r.line),r.breaks||[]);}catch(_){}
      refreshReadyDistance=()=>{if(!distanceNote.isConnected)return;const distance=course?RouteMath.startDistance(course,fix):null;distanceNote.textContent=distance==null?'Distance to start needs a recent clear GPS fix.':`Straight-line distance to route start: ${U.dist(distance)} ${U.du()}.`;};box.append(distanceNote,note);refreshReadyDistance();
      const review=document.createElement('button');review.type='button';review.className='linkbtn';review.textContent='Review route';review.onclick=()=>{if(!live())return;sheet(r.name,`<p>${esc(SPORT_NAMES[r.sport])} · version ${r.version} · ${U.dist(r.distance_m)} ${U.du()}</p><p>Follow the dashed line from its start to its finish. Route progress is separate from your recorded distance. A workout already started keeps this snapshot if the original changes or is unshared.</p>${(r.warnings||[]).map(w=>`<p>${esc(w)}</p>`).join('')}<button class="primary wide" data-close>Ready</button>`);};box.append(review);
    }
    $('#track-route-change', box).onclick = () => {if(live())chooseRoute(c, redraw);};
    const x = $('#track-route-clear', box); if (x) x.onclick = () => { if(!live())return;PlanTrack.set(null); routeRow(c, redraw); redraw(); };
  }
  async function chooseRoute(c, redraw) {
    const account=readOwner(),alive=()=>account===readOwner()&&!session&&!controlling;let rows=RouteDownloads.list().map(r=>({...r,downloaded:true})),offline=false;
    try{if(navigator.onLine===false)offline=true;else{const online=await api('/api/planned-routes');for(const r of online)if(!rows.some(x=>x.kind==='owned'&&x.id===r.id&&x.version===r.version))rows.push({...r,kind:'owned'});}}
    catch(e){if(!alive())return;if(e.offline||e.status>=500)offline=true;else{toast(e.message);return;}}
    if(!alive())return;const sport=['run','walk','hike','ride'].includes(c.sport)?c.sport:'';rows.sort((a,b)=>(b.sport===sport)-(a.sport===sport));
    sheet('Choose a route',`${offline?'<p class="small muted">Offline: completed route downloads are available. Uncached map tiles will be missing.</p>':''}${rows.length?`<div class="list card">${rows.map((r,i)=>`<button class="row-link track-route-choice" data-r="${i}">${r.line?miniRoute(r.line,r.sport):''}<span class="grow"><b>${esc(r.name)}</b><small class="muted">${esc(SPORT_NAMES[r.sport])} · ${U.dist(r.distance_m)} ${U.du()} · version ${r.version}<br>${r.downloaded?'Saved on this device':'Online route'}${r.kind==='shared'?' · shared original':''}</small></span>${svg('chev')}</button>`).join('')}</div>`:'<p>No route downloads yet. Save a route while connected to use it offline.</p>'}<a class="ghost wide" href="/routes/new">Plan a route</a><a class="ghost wide" href="/routes?view=shared">Browse shared routes</a>`,(body,close)=>{
      $$('[data-r]',body).forEach(button=>button.onclick=async()=>{if(!alive()||!body.isConnected)return;button.disabled=true;const r=rows[+button.dataset.r];try{await RouteDownloads.choose(r.kind,r.id,{version:r.version,snapshot_key:r.snapshot_key,alive:()=>alive()&&body.isConnected});if(!alive()||!body.isConnected)return;close();routeRow(c,redraw);redraw();}catch(e){if(alive()&&body.isConnected)toast(e.message);}finally{if(button.isConnected)button.disabled=false;}});
    });
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
      <section class="card track-interval-ready" id="track-interval-ready" aria-label="Interval preset"></section>
      <div class="track-go"><button class="round-btn start" id="track-start"><span>Start</span></button><small id="track-start-label"></small></div><div class="track-route" id="track-route"></div>
      <p class="small danger" id="track-ready-error" role="alert"></p>
      <button type="button" class="track-prefs" id="track-options" hidden></button><p class="small muted" id="track-guidance"></p>
      </form>
      <div id="track-open-lift"></div><section class="track-tools" aria-labelledby="track-tools-h"><h2 class="sec-head" id="track-tools-h">More ways to add</h2><div class="card list">${Native.on ? `<a class="row-link" href="/track/health">${svg('heart')}<span class="grow">Apple Health</span>${svg('chev')}</a>` : ''}<a class="row-link" href="/track/connections">${svg('watch')}<span class="grow">Connections<small class="muted gs-sub">${Native.on ? 'Garmin and Apple Health' : 'Garmin, Apple Health and other apps'}</small></span>${svg('chev')}</a><button class="row-link" id="track-past">${svg('calendar')}<span class="grow">Log a past activity</span>${svg('chev')}</button>${Native.on ? '' : `<a class="row-link" href="/track/import">${svg('upload')}<span class="grow">Import activity history</span>${svg('chev')}</a>`}</div></section>`;
    let view=null,dot=null,located=false,here=null,loadingMap=false,centred=false,readyFollow=true;const readyOwner=readOwner(),readyLive=()=>renderRevision===drawRevision&&el.isConnected&&readyOwner===readOwner()&&!session;
    const guide = () => { const c=choices[selected];routeRow(c,()=>{if(view)planOverlay(view,!centred);},here?{lat:here[0],lon:here[1],accuracy:here[2],at:here[3]}:null);$('#track-ready-map-wrap').hidden=!c.gps;el.classList.toggle('gps-ready',!!c.gps);ensureMap();$('#track-start-label').textContent=c.lift?'Lifting':c.label;$('#track-start').setAttribute('aria-label',c.lift?'Start lifting':`Start ${c.label.toLowerCase()}`);$('#track-guidance').textContent=c.lift?'Exercises, sets, reps and a rest timer.':c.gps ? TrackNative.supported ? 'GPS keeps recording with your screen locked.' : 'Outdoor GPS recording. For screen-off and background recording, use the iPhone app.' : TrackNative.supported ? 'A timer for active time, including with the screen locked.' : 'Timer recording. Keep this browser page open.'; };
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
    const show=(lat,lon,accuracy,at)=>{if(!readyLive())return;located=true;here=[lat,lon,accuracy,at];routeRow(choices[selected],()=>{if(view)planOverlay(view,false);},{lat,lon,accuracy,at});if(!view||!$('#track-ready-map')?.isConnected)return;
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
      mapInto($('#track-ready-map'), [], {still:true}).then(v=>{if(!v)return;if(!readyLive()){v.map.remove();return;}view=v;view.map.on('dragstart',()=>{readyFollow=false;});planOverlay(view,!here);if(here)show(...here);})
        .catch(()=>{if(el.isConnected)$('#track-ready-error').textContent='Map unavailable. Recording still works without map tiles.';})
        .finally(()=>{loadingMap=false;});
    }
    globalThis.Intervals?.mount($('#track-interval-ready'));
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
    const o=gps?recordOptions(sport):{voice:false,autoPause:false,splitMetres:imp()?1609.344:1000},revision=readOwner(),button=$('#track-start'),hadRoute=gps&&typeof PlanTrack!=='undefined'&&!!PlanTrack.get();let problem=null;
    const startError=$('#track-ready-error');if(startError)startError.textContent='';
    controlling=true;nativeRevision++;if(button){button.disabled=true;$('span',button).textContent='Starting…';}
    try{
      const intervalOptions=globalThis.Intervals?await Intervals.startOptions({sport,gps}):null;
      if(revision!==readOwner()||!button?.isConnected)return;
      const routePlan=gps&&typeof RouteDownloads!=='undefined'?await RouteDownloads.beforeStart():null;
      if(revision!==readOwner()||!button?.isConnected)return;
      if(TrackNative.supported){
        if(nativeTask)await nativeTask.catch(()=>{});
        if(routePlan){const status=await TrackNative.call('status',{since:0});if(status.routePlanSupport!==1)throw Error('Update the iPhone app before starting with a planned route. Your route is saved.');}
        if(revision!==readOwner())return;
        adoptNative(await TrackNative.call('start',{id:crypto.randomUUID(),sport,label,sportLabel:sportLabel||null,gps,...o,...(intervalOptions||{}),...(routePlan?{routePlan}:{})}));
        if(revision===readOwner()){draw();sync();window.scrollTo(0,0);}return;
      }
      const now=Date.now();session={id:crypto.randomUUID(),sport,label,sportLabel,gps,start:now,activeAt:now,checkpoint:now,activeMs:0,state:'paused',points:[],segment:0,distance:0,...o,splits:[],autoMs:0,lastMove:null,routePlan};
      if(!persist()){draw();return;}resume();window.scrollTo(0,0);
    }catch(e){problem=e.message;if(revision===readOwner()){const error=$('#track-ready-error');if(error)error.textContent=e.message;}}
    finally{controlling=false;if(problem&&hadRoute&&!session&&revision===readOwner()&&!PlanTrack.get()){draw();const error=$('#track-ready-error');if(error)error.textContent=problem+' The route is no longer selected.';}if(button?.isConnected){button.disabled=false;$('span',button).textContent='Start';}}
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && session?.state === 'recording' && !session.native) { message = 'Paused while Kinetta was in the background. Resume when ready.'; pause(); draw(); } });
  window.addEventListener('kinetta:route-selection',()=>{if(!session&&!controlling&&location.pathname==='/track')draw();});
  window.addEventListener('pagehide', () => { if (session && !session.native) pause(); });
  setInterval(() => { if (!App.me || owner && readOwner() !== owner) { stopGPS(); if (session && !session.native) pause(); return; } if(!session)refreshReadyDistance?.(); if (session?.native) { if (!document.hidden && location.pathname === '/track') pullNative().catch((e)=>{message=e.message;update();});update();return; } if (session?.state === 'recording') { session.checkpoint = Date.now(); persist(false); update(); } }, 1000);
  return {get active() { return !!session; }, sync, draw, pause, pullNative, async leave() { if(TrackNative.supported) await TrackNative.detach();else await pause(); }, forgetDraft() { stopGPS(); if (key) store.del(key); session = null; }};
})();
route(/^\/track$/, 'track', async (el) => {
  Track.sync(); el.innerHTML = `<div class="top"><h1>Track</h1><div class="acts"><a class="linkbtn" href="/routes">${svg('route')}Routes</a>${TrackNative.supported ? `<button type="button" class="icon-btn" id="track-settings" aria-label="Recording settings">${svg('gear')}</button>` : ''}</div></div><div id="track-content"></div>`;
  if (TrackNative.supported) { try { await Track.pullNative(); } catch(e) { toast(e.message); } }
  Track.draw();
});
