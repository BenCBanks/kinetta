// Track owns every recording flow. Native iPhone GPS continues independently of WebView visibility.
'use strict';
const TrackMath = {
  metres(a, b) {
    const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
    const x = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
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
      else s.distance += m;
    }
    s.points.push(p); return true;
  },
  seconds(s, now = Date.now()) { return s.activeMs / 1000 + (s.state === 'recording' ? Math.max(0, now - s.activeAt) / 1000 : 0); },
};
const Track = (() => {
  let session = null, key = null, owner = null, watch = null, wake = null, message = '', saving = false, mapTimer = null, mapView = null, lastPersist = 0, nativeTask = null, controlling = false, display = 'map', nativeRevision = 0;
  const accountKey = () => App.me ? 'kinetta.track:' + JSON.stringify([Native.base || location.origin, App.me.id]) : null;
  const stopGPS = () => { if (watch !== null) navigator.geolocation?.clearWatch(watch); watch = null; if (wake) wake.release().catch(() => {}); wake = null; };
  function persist(force = true) {
    if (!force && Date.now() - lastPersist < 5000) return true;
    try { localStorage.setItem(key, JSON.stringify(session)); lastPersist = Date.now(); return true; }
    catch (_) { if (session?.native) return true; message = 'This device cannot save your recording draft. Free some storage before continuing.'; pause(false); return false; }
  }
  async function pause(write = true) {
    if (session?.native) { await nativeControl('pause'); return; }
    if (session?.state === 'recording') { session.activeMs += Math.max(0, Date.now() - session.activeAt); session.state = 'paused'; session.segment++; }
    if (/^(GPS connected|Timer running|Waiting for)/.test(message)) message = 'Paused';
    stopGPS(); if (write && session) persist(); update();
  }
  function sync() {
    const next = accountKey();
    if (next !== key || owner && owner !== readOwner()) {
      if (session && !session.native) pause();
      key = next; owner = App.me ? readOwner() : null; session = key ? store.get(key) : null; message = '';
      if (session) {
        // No time is invented between the last durable checkpoint and opening Kinetta again.
        if (session.state === 'recording' && !session.native) { session.activeMs += Math.max(0, (session.checkpoint || session.activeAt) - session.activeAt); session.state = 'paused'; session.segment++; message = 'Recording paused when Kinetta closed. Resume when you are ready.'; persist(); }
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
    const name = same ? session.name : null;
    session = {...incoming, points}; if (name) session.name = name;
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
  async function nativeControl(method) {
    if (controlling || !session?.native) return;
    controlling = true; nativeRevision++; const revision = readOwner();
    try { if(nativeTask) await nativeTask.catch(()=>{}); adoptNative(await TrackNative.call(method, {id:session.id,since:0})); }
    catch (e) { if (revision === readOwner()) message = e.message; }
    finally { controlling = false; if (revision === readOwner()) { draw(); sync(); } }
  }
  async function resume() {
    if (!session || session.state === 'review' || saving) return;
    if (document.hidden) return;
    if (session.native) { await nativeControl('resume'); return; }
    session.state = 'recording'; session.activeAt = Date.now(); message = session.gps ? 'Waiting for a clear GPS signal…' : 'Timer running';
    if (!persist()) return;
    if (session.gps) {
      if (!navigator.geolocation || !window.isSecureContext) { message = 'GPS needs a secure connection and location support. You can use the timer instead.'; pause(); draw(); return; }
      const activeSession = session, activeOwner = owner;
      watch = navigator.geolocation.watchPosition((p) => {
        if (session !== activeSession || readOwner() !== activeOwner || session.state !== 'recording' || document.hidden) return;
        if (session.points.length >= 24000) { pause(); message = 'GPS point limit reached. Finish and save this session.'; draw(); return; }
        if (TrackMath.accept(session, p, Date.now())) { message = `GPS connected · ±${Math.round(p.coords.accuracy)} m`; session.checkpoint = Date.now(); persist(false); update(); refreshMap(); }
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
  function clock(n) { n = Math.floor(n); return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
  function update() {
    updateTab();
    if (!session || !App.me || accountKey() !== key) return;
    const time = $('#track-time'); if (time) time.textContent = clock(TrackMath.seconds(session));
    const d = $('#track-distance'); if (d) d.textContent = U.dist(session.distance, 2);
    const pace = $('#track-pace'); if (pace) { const secs = TrackMath.seconds(session); pace.textContent = session.distance > 10 && secs > 0 ? (session.sport === 'ride' ? (session.distance / (imp() ? 1609.344 : 1000) / (secs / 3600)).toFixed(1) : dur(secs / (session.distance / (imp() ? 1609.344 : 1000)))) : '—'; }
    const status = $('#track-status'); if (status) status.textContent = message || (session.state === 'recording' ? 'Recording' : 'Paused');
  }
  function lines() { const by = new Map(); for (const p of session.points) { if (!by.has(p.segment)) by.set(p.segment, []); by.get(p.segment).push([p.lat, p.lon]); } return [...by.values()].filter((a) => a.length > 1); }
  function refreshMap() {
    if (mapTimer) return;
    mapTimer = setTimeout(async () => {
      try {
        const el = $('#track-map'); if (!el || !session) return;
        const ln = lines(); el.hidden = false;
        if (!mapView || mapView.el !== el) {
          const view = await mapInto(el, ln, {sport: session.sport, still: false, ends: false});
          if (view && el.isConnected) { mapView = {...view, el}; if (view.map.getZoom()>17) view.map.setZoom(17); if (!ln.length && session.points.length) { const p=session.points.at(-1);view.map.setView([p.lat,p.lon],15); } }
        } else {
          const {map, L, group} = mapView; group.clearLayers();
          for (const pts of ln) L.polyline(pts, {color: col('--' + session.sport), weight: 4}).addTo(group);
          if(ln.length) map.fitBounds(L.latLngBounds(ln.flat()), {padding: [12, 12], maxZoom: 17, animate: false});
        }
      } catch (_) { message = 'Map unavailable. Your timer and GPS recording continue.'; update(); }
      finally { mapTimer = null; }
    }, 1200);
  }
  function discard() {
    sheet('Discard this recording?', '<p>This removes the draft from this device. It has not been saved as an activity.</p><button class="ghost wide" id="tr-keep">Keep recording</button><button class="primary danger-btn wide" id="tr-discard">Discard recording</button>', (b, close) => {
      $('#tr-keep', b).onclick = close;
      $('#tr-discard', b).onclick = async () => { if (session.native) { const btn=$('#tr-discard',b);btn.disabled=true;try { nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear',{id:session.id}); } catch(e) { toast(e.message);btn.disabled=false;return; } } stopGPS(); store.del(key); session = null; message = ''; close(); draw(); sync(); };
    });
  }
  function draw() {
    const el = $('#track-content'); if (!el || !App.me) return;
    if (!session) { ready(el); return; }
    const review = session.state === 'review', paused = session.state !== 'recording';
    el.innerHTML = `<section class="track-session track-live ${display === 'stats' ? 'stats-expanded' : ''}"><div class="track-live-top"><h2>${esc(session.label)}</h2>${session.gps && !review ? `<div class="seg" role="group" aria-label="Recording display"><button data-display="map" aria-pressed="${display === 'map'}">Map</button><button data-display="stats" aria-pressed="${display === 'stats'}">Stats</button></div>` : ''}</div>
      <p id="track-status" class="small muted" role="status"></p>
      <div class="track-live-metrics">${session.gps ? `<div><small>Distance · ${U.du()}</small><b class="num" id="track-distance"></b></div>` : ''}<div><small>Active time</small><b class="num" id="track-time"></b></div>${session.gps ? `<div><small>${session.sport === 'ride' ? 'Avg. speed · ' + U.du() + '/h' : 'Avg. pace · /' + U.du()}</small><b class="num" id="track-pace"></b></div>` : ''}</div>
      ${session.gps && display === 'map' ? '<div class="track-map live-record-map" id="track-map"></div>' : ''}
      ${review ? `<form class="form" id="track-save-form"><label>Activity name<input name="activity_name" value="${esc(session.name || session.label)}" maxlength="200" required></label><p class="small muted">Private by default. You can change sharing after saving.</p>${session.points.some((p) => p.segment !== session.points[0]?.segment) ? '<p class="small muted">Your activity map keeps every recorded section. Shared previews show the longest continuous section.</p>' : ''}<button class="primary wide" id="track-save"${saving ? ' disabled' : ''}>${saving ? 'Saving…' : 'Save activity'}</button><p class="small danger" id="track-save-error" role="alert"></p></form><button class="ghost wide" id="track-continue"${saving ? ' disabled' : ''}>Continue recording</button>` : `<div class="track-actions ${paused ? '' : 'recording-actions'}"><button class="${paused ? 'ghost' : 'primary'}" id="track-pause">${paused ? 'Resume' : 'Pause'}</button>${paused ? '<button class="primary" id="track-finish">Finish</button>' : ''}</div><p class="small muted">${session.native ? 'Recording continues with the screen locked or another app open.' : 'Browser recording pauses when you leave this page. Use the iPhone app for background GPS.'}</p>${paused && session.gps && !session.native ? '<button class="ghost wide" id="track-timer">Continue without GPS</button>' : ''}`}
      <button class="linkbtn danger track-discard" id="track-discard"${saving ? ' disabled' : ''}>Discard recording</button></section>`;
    $$('[data-display]', el).forEach((b) => b.onclick = () => { display = b.dataset.display; draw(); });
    update(); if (session.gps) refreshMap();
    if (!review) {
      $('#track-pause').onclick = async () => { if (session.state === 'recording') { await pause(); draw(); } else resume(); };
      const finish = $('#track-finish'); if (finish) finish.onclick = async () => { if (session.native) { await nativeControl('finish'); return; } await pause(); if (TrackMath.seconds(session) < 1) { message = 'Record at least one second before finishing.'; update(); return; } session.state = 'review'; message = 'Ready to save'; session.finishedAt = Date.now(); persist(); draw(); };
      const timer = $('#track-timer'); if (timer) timer.onclick = () => { session.gps = false; resume(); };
    } else {
      const form = $('#track-save-form'); form.elements.namedItem('activity_name').oninput = () => { session.name = form.elements.namedItem('activity_name').value; form.elements.namedItem('activity_name').setCustomValidity(''); persist(); };
      $('#track-continue').onclick = () => { session.state = 'paused'; resume(); };
      form.onsubmit = async (e) => {
        e.preventDefault(); if (saving) return; const name = form.elements.namedItem('activity_name').value.trim(); if (!name) { form.elements.namedItem('activity_name').setCustomValidity('Add an activity name'); form.elements.namedItem('activity_name').reportValidity(); return; } form.elements.namedItem('activity_name').setCustomValidity('');
        session.name = name; persist(); saving = true; const active = session, k = key;
        const payload = {client_id: session.id, sport: session.sport, sport_label: session.sportLabel || null, name, start: new Date(session.start).toISOString(), elapsed_s: (session.finishedAt - session.start) / 1000, moving_s: TrackMath.seconds(session), points: session.points};
        draw();
        try { const result = await api('/api/activities/track', json('POST', payload)); if (session?.id !== active.id || key !== k) return; if (session.native) { nativeRevision++;if(nativeTask)await nativeTask.catch(()=>{});await TrackNative.call('clear', {id:session.id}); } store.del(k); session = null; invalidate('/api/'); toast('Activity saved'); if (location.pathname === '/track') go(`/track?done=${result.id}`, {replace:true}); else sync(); }
        catch (x) { if (session?.id === active.id && key === k) { draw(); const err = $('#track-save-error'); if (err) err.textContent = x.message + ' Your draft is kept. Retry when ready.'; } }
        finally { saving = false; if (session?.id === active.id && key === k) { const btn = $('#track-save'); if (btn) { btn.disabled = false; btn.textContent = 'Save activity'; } for (const id of ['track-continue', 'track-discard']) { const b = $('#' + id); if (b) b.disabled = false; } } }
      };
    }
    $('#track-discard').onclick = discard;
  }
  const OUTDOOR = [['run','Run'],['run','Trail run','Trail Running'],['ride','Ride'],['ride','Mountain bike','Mountain Biking'],['walk','Walk'],['hike','Hike'],['swim','Open-water swim','Open Water'],['row','Row on water'],['ski','Ski'],['other','Other outdoor activity']];
  // One-tap shortcuts for the most common choices (2026-10-18 UI pass); everything else stays in the All activities list.
  const TRACK_QUICK = [0, 2, 4, 5, OUTDOOR.length];   // Run, Ride, Walk, Hike, then Lifting (the first choice after OUTDOOR)
  function ready(el) {
    const indoor = HAND_KINDS.flatMap(([, rows]) => rows).filter(([, , kind]) => kind !== 'Strength Training');
    const choices = [...OUTDOOR.map(([sport,label,kind]) => ({sport,label,sportLabel:kind,gps:true})), {label:'Lifting',lift:true}, ...indoor.map(([sport,label,kind]) => ({sport,label,sportLabel:kind,gps:false}))];
    let selected = Math.min(choices.length-1, Math.max(0, +store.get(key + ':choice') || 0));
    const done = new URLSearchParams(location.search).get('done');
    el.innerHTML = `${done && /^\d+$/.test(done) ? `<div class="track-saved" role="status"><b>Activity saved</b><a href="/activity/${done}">View activity${svg('chev')}</a></div>` : ''}<form class="form track-ready" id="track-setup"><div class="track-quick" role="group" aria-label="Common activities">${TRACK_QUICK.map(i => `<button type="button" data-quick="${i}" aria-pressed="${i===selected}">${svg(choices[i].lift ? 'workout' : choices[i].sport)}<span>${esc(choices[i].label)}</span></button>`).join('')}</div><details class="track-other" id="track-other"><summary>${TRACK_QUICK.includes(selected)?'More activities':esc(choices[selected].label)}${svg('down')}</summary><label>All activities<select id="track-kind">${choices.map((c,i) => `${i===0 ? '<optgroup label="Outdoor · GPS">' : i===OUTDOOR.length ? '</optgroup><optgroup label="Indoor · timer and sets">' : ''}<option value="${i}"${i===selected ? ' selected' : ''}>${esc(c.label)}${c.gps ? ' · GPS' : c.lift ? ' · sets & reps' : ' · timer'}</option>`).join('')}</optgroup></select></label></details>
      <p class="small muted" id="track-guidance"></p><p class="small danger" id="track-ready-error" role="alert"></p><button class="primary wide" id="track-start">Start</button>
      <div class="track-ready-map-wrap" id="track-ready-map-wrap"><div class="track-ready-map" id="track-ready-map" aria-label="Map before recording"></div><button type="button" class="ghost track-locate" id="track-locate">${svg('track')}Locate me</button></div>
      </form>
      <div id="track-open-lift"></div><section class="track-tools" aria-labelledby="track-tools-h"><h2 class="sec-head" id="track-tools-h">More ways to add</h2><div class="card list">${Native.on ? `<a class="row-link" href="/track/health">${svg('heart')}<span class="grow">Apple Health</span>${svg('chev')}</a>` : ''}<a class="row-link" href="/track/connections">${svg('watch')}<span class="grow">Connections<small class="muted gs-sub">${Native.on ? 'Watch files and other apps' : 'Apple Health, watch files and other apps'}</small></span>${svg('chev')}</a><button class="row-link" id="track-past">${svg('calendar')}<span class="grow">Log a past activity</span>${svg('chev')}</button><a class="row-link" href="/track/import">${svg('upload')}<span class="grow">Upload activity files</span>${svg('chev')}</a></div></section>`;
    let view=null,dot=null,located=false,here=null,loadingMap=false;
    const guide = () => { const c=choices[selected];$('#track-ready-map-wrap').hidden=!c.gps;ensureMap();$('#track-start').textContent=c.lift?'Start lifting':`Start ${c.label.toLowerCase()}`;$('#track-guidance').textContent=c.lift?'Exercises, sets, reps and a rest timer.':c.gps ? TrackNative.supported ? 'GPS continues while your screen is locked or you use another app.' : 'Outdoor GPS recording. For screen-off and background recording, use the iPhone app.' : TrackNative.supported ? 'Track active time, including with the screen locked.' : 'Timer recording. Keep this browser page open.'; };
    const pick=(i)=>{selected=i;store.set(key+':choice',selected);$('#track-kind').value=String(i);const other=$('#track-other');other.open=false;$('summary',other).innerHTML=esc(TRACK_QUICK.includes(i)?'More activities':choices[i].label)+svg('down');$$('[data-quick]',el).forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.quick===i)));guide();};
    $('#track-kind').onchange=(e)=>pick(+e.target.value);
    $$('[data-quick]',el).forEach(b=>b.onclick=()=>{Native.haptic?.('selection');pick(+b.dataset.quick);});guide();
    // Find the person at once when an outdoor activity is chosen, like other running apps. The iPhone app asks iOS
    // (permission is remembered); a browser locates by itself only after the person has already allowed it.
    const show=(lat,lon)=>{ located=true;here=[lat,lon];if(!view||!$('#track-ready-map')?.isConnected)return;view.map.setView([lat,lon],15);
      if(dot)dot.setLatLng([lat,lon]);else dot=view.L.circleMarker([lat,lon],{radius:7,color:col('--accent'),fillOpacity:1}).addTo(view.map); };
    const locate=async(quiet)=>{
      const button=$('#track-locate'),error=$('#track-ready-error');if(!button||button.disabled)return;
      button.disabled=true;if(!quiet)error.textContent='';
      try {
        if(TrackNative.supported){const p=await TrackNative.locate();show(p.lat,p.lon);}
        else {
          if(!navigator.geolocation)throw new Error('Location is unavailable on this device.');
          if(quiet){const state=await navigator.permissions?.query({name:'geolocation'}).then((s)=>s.state,()=>null);if(state!=='granted')return;}
          const p=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,maximumAge:15000,timeout:15000}));
          show(p.coords.latitude,p.coords.longitude);
        }
      } catch(e) { if(button.isConnected)error.textContent=e?.message && TrackNative.supported ? e.message : 'Allow location access to see where you are. You can still choose an indoor activity.'; }
      finally { if(button.isConnected)button.disabled=false; }
    };
    const auto=()=>{ if(!located&&choices[selected].gps)locate(true); };
    $('#track-locate').onclick=()=>locate(false);
    $('#track-kind').addEventListener('change',auto);auto();
    function ensureMap(){
      if(!choices[selected].gps||loadingMap)return;
      if(view){requestAnimationFrame(()=>{if(el.isConnected)view.map.invalidateSize();});return;}
      loadingMap=true;
      mapInto($('#track-ready-map'), [], {still:true}).then(v=>{if(!v)return;view=v;if(here)show(...here);})
        .catch(()=>{if(el.isConnected)$('#track-ready-error').textContent='Map unavailable. Recording still works without map tiles.';})
        .finally(()=>{loadingMap=false;});
    }
    $('#track-setup').onsubmit=async(e)=>{e.preventDefault();if(controlling)return;const c=choices[selected];if(c.lift){startLiftSheet();return;}await begin(c.sport,c.label,c.sportLabel,c.gps);};
    $('#track-past').onclick=()=>addActivitySheet();liftNowCard($('#track-open-lift'));
  }
  async function begin(sport,label,sportLabel,gps) {
    if(session || controlling)return;
    if(TrackNative.supported){
      controlling=true;const revision=readOwner(),button=$('#track-start');button.disabled=true;button.textContent='Preparing…';
      try { adoptNative(await TrackNative.call('start',{id:crypto.randomUUID(),sport,label,sportLabel:sportLabel||null,gps}));if(revision===readOwner()){draw();sync();} }
      catch(e){if(revision===readOwner()){const error=$('#track-ready-error');if(error)error.textContent=e.message;}}
      finally{controlling=false;if(button.isConnected){button.disabled=false;button.textContent='Start';}}return;
    }
    const now=Date.now();session={id:crypto.randomUUID(),sport,label,sportLabel,gps,start:now,activeAt:now,checkpoint:now,activeMs:0,state:'paused',points:[],segment:0,distance:0};
    if(!persist()){draw();return;}resume();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && session?.state === 'recording' && !session.native) { message = 'Paused while Kinetta was in the background. Resume when ready.'; pause(); draw(); } });
  window.addEventListener('pagehide', () => { if (session && !session.native) pause(); });
  setInterval(() => { if (!App.me || owner && readOwner() !== owner) { stopGPS(); if (session && !session.native) pause(); return; } if (session?.native) { if (!document.hidden && location.pathname === '/track') pullNative().catch((e)=>{message=e.message;update();});update();return; } if (session?.state === 'recording') { session.checkpoint = Date.now(); persist(false); update(); } }, 1000);
  return {get active() { return !!session; }, sync, draw, pause, pullNative, async leave() { if(TrackNative.supported) await TrackNative.detach();else await pause(); }, forgetDraft() { stopGPS(); if (key) store.del(key); session = null; }};
})();
route(/^\/track$/, 'track', async (el) => {
  Track.sync(); el.innerHTML = `<div class="top"><h1>Track</h1></div><div id="track-content"></div>`;
  if (TrackNative.supported) { try { await Track.pullNative(); } catch(e) { toast(e.message); } }
  Track.draw();
});
