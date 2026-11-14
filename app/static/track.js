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
  let session = null, key = null, owner = null, watch = null, wake = null, message = '', saving = false, mapTimer = null, mapView = null, lastPersist = 0, nativeTask = null, controlling = false, display = 'map', nativeRevision = 0,refreshReadyDistance=null,drawRevision=0,mapControlsFrame=0,reviewResizeFrame=0;
  let planIntent=null;
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
      key = next; owner = App.me ? readOwner() : null; session = key ? store.get(key) : null; planIntent=null; message = '';
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
  // Route UI is a lazy leaf; these hooks stay no-op until /track loads it.
  const routeHooks = {};
  const draw = (...args) => routeHooks.draw?.(...args);
  const refreshMap = (...args) => routeHooks.refreshMap?.(...args);
  const restoreReview = (...args) => routeHooks.restoreReview?.(...args);
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
    const status = $('#track-status'); if (status) { status.textContent = idle ? 'Auto-paused · starts again when you move' : message || (session.state === 'recording' ? 'Recording' : 'Paused'); status.classList.toggle('vh', !idle && (!message || /^(Recording|Paused)$/.test(message))); }
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
  const OUTDOOR = [['run','Run'],['run','Trail run','Trail Running'],['ride','Ride'],['ride','Mountain bike','Mountain Biking'],['walk','Walk'],['hike','Hike'],['swim','Open-water swim','Open Water'],['row','Row on water'],['ski','Ski'],['other','Other outdoor activity']];
  const TRACK_QUICK = [0, 2, 4, 5, OUTDOOR.length];
  const recordingChoices=()=>[...(TrackNative.supported?OUTDOOR:[]).map(([sport,label,kind])=>({sport,label,sportLabel:kind,gps:true})),{label:'Lifting',lift:true},...HAND_KINDS.flatMap(([,rows])=>rows).filter(([, ,kind])=>kind!=='Strength Training').map(([sport,label,kind])=>({sport,label,sportLabel:kind,gps:false}))];
  const canPreparePlan=w=>!!w&&w.type!=='rest'&&w.status!=='done'&&/^\d{4}-\d{2}-\d{2}$/.test(w.day);
  async function preparePlan(workout,planId,{active=()=>true,remember=true}={}){
    sync();const scope=accountKey(),revision=readOwner();
    if(!scope||!Number.isSafeInteger(planId)||planId<=0||!canPreparePlan(workout))throw Error('Open your plan and choose the workout again.');
    if(!active())return null;
    if(TrackNative.supported)await pullNative();
    if(accountKey()!==scope||readOwner()!==revision||!active())return null;
    if(session)throw Error('Finish or discard your current recording before choosing a plan workout.');
    const current=()=>accountKey()===scope&&readOwner()===revision&&!session&&active();
    if(!current())return null;
    const loaded=workout.track_intervals?await Intervals.usePlan(workout,planId,{active:current}):Intervals.removeSelection();
    if(!current())return null;if(!loaded)throw Error('This device could not keep your workout selection. Try again.');
    const index=recordingChoices().findIndex(c=>c.sport==='run'&&!c.sportLabel);if(index<0)throw Error('Run is unavailable. Choose it from Track.');
    store.set(scope+':choice',index);
    if(remember)planIntent={scope,owner:revision,planId,workout:JSON.parse(JSON.stringify(workout))};
    return{index};
  }
  // One-tap shortcuts for the most common choices (2026-10-18 UI pass); everything else stays in the All activities list.
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
  const api = {get active() { return !!session; }, canPreparePlan, preparePlan, sync, draw, pause, resume, pullNative, restoreReview,
    __attachRoute(handlers) { Object.assign(routeHooks, handlers || {}); },
    __routeContext() {
      const ctx = {Track: api, TrackMath, OUTDOOR, TRACK_QUICK, routeHooks};
      Object.defineProperties(ctx, {
        session:{enumerable:true,get:()=>session,set:value=>{session=value}},key:{enumerable:true,get:()=>key,set:value=>{key=value}},owner:{enumerable:true,get:()=>owner,set:value=>{owner=value}},
        watch:{enumerable:true,get:()=>watch,set:value=>{watch=value}},wake:{enumerable:true,get:()=>wake,set:value=>{wake=value}},message:{enumerable:true,get:()=>message,set:value=>{message=value}},saving:{enumerable:true,get:()=>saving,set:value=>{saving=value}},
        mapTimer:{enumerable:true,get:()=>mapTimer,set:value=>{mapTimer=value}},mapView:{enumerable:true,get:()=>mapView,set:value=>{mapView=value}},lastPersist:{enumerable:true,get:()=>lastPersist,set:value=>{lastPersist=value}},nativeTask:{enumerable:true,get:()=>nativeTask,set:value=>{nativeTask=value}},
        controlling:{enumerable:true,get:()=>controlling,set:value=>{controlling=value}},display:{enumerable:true,get:()=>display,set:value=>{display=value}},nativeRevision:{enumerable:true,get:()=>nativeRevision,set:value=>{nativeRevision=value}},refreshReadyDistance:{enumerable:true,get:()=>refreshReadyDistance,set:value=>{refreshReadyDistance=value}},
        drawRevision:{enumerable:true,get:()=>drawRevision,set:value=>{drawRevision=value}},mapControlsFrame:{enumerable:true,get:()=>mapControlsFrame,set:value=>{mapControlsFrame=value}},reviewResizeFrame:{enumerable:true,get:()=>reviewResizeFrame,set:value=>{reviewResizeFrame=value}},planIntent:{enumerable:true,get:()=>planIntent,set:value=>{planIntent=value}},
        reviewDraft:{enumerable:true,get:()=>reviewDraft,set:value=>{reviewDraft=value}},reviewRestore:{enumerable:true,get:()=>reviewRestore,set:value=>{reviewRestore=value}},photoBusy:{enumerable:true,get:()=>photoBusy,set:value=>{photoBusy=value}},photoGeneration:{enumerable:true,get:()=>photoGeneration,set:value=>{photoGeneration=value}},
        saveError:{enumerable:true,get:()=>saveError,set:value=>{saveError=value}},mapOverlay:{enumerable:true,get:()=>mapOverlay,set:value=>{mapOverlay=value}},reviewResize:{enumerable:true,get:()=>reviewResize,set:value=>{reviewResize=value}}
      });
      const fns = {accountKey,stopGPS,persist,pause,sync,updateTab,adoptNative,pullNative,nativeControl,resume,draw,refreshMap,restoreReview,update,markLap,speedSport,unitName,rateText,announce,clock,recordOptions,begin,preparePlan,canPreparePlan,recordingChoices};
      Object.assign(ctx, fns);
      return ctx;
    },
    async leave() { if(TrackNative.supported) await TrackNative.detach();else await pause(); },
    async forgetDraft() { const scope=key;stopGPS();mapOverlay?.close();if(scope)store.del(scope);session=null;reviewDraft=null;if(scope)await TrackReviewStore.erase(scope); }
  };
  return api;
})();
