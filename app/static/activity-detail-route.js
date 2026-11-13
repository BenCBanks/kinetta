// Kinetta phone app — Activity detail route leaf. Loaded only for activity detail routes.
'use strict';

// ---------- Activity detail ----------
const ZN = ['Easy', 'Aerobic', 'Tempo', 'Threshold', 'Max'];
function insights(a) {
  const out = [];
  if (a.efforts && a.efforts.some((e) => e.rank_then === 1)) {
    const prs = a.efforts.filter((e) => e.rank_then === 1).map((e) => e.label);
    out.push(['good', `New personal record${prs.length > 1 ? 's' : ''}`, prs.join(', ')]);
  }
  if (a.decoupling != null) {
    const d = a.decoupling;
    out.push([d < 5 ? 'good' : d < 10 ? '' : 'warn', `Heart-rate drift ${d.toFixed(1)}%`,
      d < 5 ? 'Your heart rate held steady for the pace: good aerobic fitness for this effort.' :
      d < 10 ? 'Some drift in the second half: normal for long or warm efforts.' : 'Big drift: heat, dehydration, fatigue or starting too fast.']);
  }
  if (a.zones) {
    const tot = a.zones.reduce((x, y) => x + y, 0), easy = (a.zones[0] + a.zones[1]) / tot;
    out.push(['', easy > .75 ? 'Mostly easy' : easy < .4 ? 'Hard session' : 'Mixed intensity',
      `${Math.round(easy * 100)}% of the time in zones 1–2${a.effort ? ` · effort ${Math.round(a.effort)}` : ''}.`]);
  }
  if (a.vo2max) out.push(['', `VO₂max estimate ${a.vo2max}`, 'From pace (hills adjusted) versus heart rate. Trends matter more than one run.']);
  if (a.route_count > 1) out.push(['', `You've done this route ${a.route_count} times`, 'See how you compare over time below.']);
  return out;
}
function sportStats(a) {
  const s = [];
  const add = (l, v, u) => { if (v != null && v !== '–') s.push(stat(l, v, u)); };
  if (a.sport === 'swim') {
    const r=rate(a); add('Pace', r.label==='Pace'?r.v:null, U.swu());
    add('Lengths', a.lengths); add('SWOLF', a.swolf ? Math.round(a.swolf) : null); add('Strokes', a.strokes ? Math.round(a.strokes) : null);
    add('Pool', a.pool_length_m ? `${Math.round(a.pool_length_m)} m` : null);
  }
  if (FOOT.includes(a.sport)) add('GAP', a.gap_s_per_km ? U.pace(a.gap_s_per_km) : null, U.pu());
  if (a.speed_available!==false && (['ride', 'ski', 'row'].includes(a.sport) || a.max_speed)) add('Max speed', a.max_speed ? U.speed(a.max_speed) : null, U.su());
  add('Elevation', a.ascent_m != null ? U.elev(a.ascent_m) : null, U.eu());
  if (['hike', 'ride', 'ski'].includes(a.sport)) { add('Climb rate', a.vam ? U.elev(a.vam) : null, U.eu() + '/h'); add('Highest', a.max_alt != null ? U.elev(a.max_alt) : null, U.eu()); }
  add('Avg HR', a.avg_hr ? Math.round(a.avg_hr) : null, 'bpm'); add('Max HR', a.max_hr ? Math.round(a.max_hr) : null, 'bpm');
  add('Effort', a.effort ? Math.round(a.effort) : null);
  if (a.avg_power) { add('Avg power', Math.round(a.avg_power), 'W'); add('Norm. power', a.norm_power ? Math.round(a.norm_power) : null, 'W'); }
  if (a.avg_cad) add('Cadence', Math.round(a.avg_cad), a.sport === 'ride' ? 'rpm' : 'spm');
  if (['walk', 'hike', 'run'].includes(a.sport)) add('Steps', a.steps ? Math.round(a.steps).toLocaleString() : null);
  if (a.avg_stride) add('Stride', (a.avg_stride / 1000).toFixed(2), 'm');
  if (a.avg_gct) add('Ground contact', Math.round(a.avg_gct), 'ms');
  if (a.avg_vo) add('Vert. osc.', (a.avg_vo / 10).toFixed(1), 'cm');
  add('Elapsed time', a.elapsed_s != null ? activityElapsedText(a) : null);
  add('Moving time', a.moving_s != null ? activityMovingText(a) : null);
  add('Calories', a.calories ? Math.round(a.calories) : null); add('Temp', a.avg_temp != null ? U.temp(a.avg_temp) : null);
  return s.join('');
}

route(/^\/activity\/(\d+)$/, 'activity', async (el, id) => {
  // Shaped like the page that's coming (map, then the title card and numbers) so nothing appears to rearrange.
  el.innerHTML = `<div class="map-head"><div class="map lead sk" aria-hidden="true"></div><div class="top over">${backBtn('Activity')}</div></div>
    <div class="card d-ph" aria-hidden="true"><div class="sk line short"></div><div class="sk big"></div><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></div>${skel(1)}`;
  wireBack(el, '/activity');
  SocialData.prefetch(id);
  const milestoneOwner=readOwner(),milestoneOffers=Milestones.read({activity_id:id}).catch(()=>({items:[]}));let milestoneDraw=0,openedEdit=false;
  const wantsEdit=new URLSearchParams(location.search).get('edit')==='1';
  await load(`/api/activities/${id}`, (a) => {
    const stamp=++milestoneDraw;drawDetail(el,a);
    Milestones.celebrate($('#d-celebration',el),id);
    // An optional celebration must not delay the workout, chart or food-energy summary.
    milestoneOffers.then(data=>{if(el.isConnected&&readOwner()===milestoneOwner&&stamp===milestoneDraw)Milestones.paint($('#d-milestones',el),data,{params:{activity_id:id}});}).catch(()=>{});
    if(!a.owner&&isoDay(new Date(a.start_time))===isoDay(new Date())){const box=document.createElement('div');box.id='workout-food-energy';el.querySelector('[data-pane="overview"]').prepend(box);workoutEnergy(box,id);}
    if(wantsEdit&&!openedEdit&&!a.owner&&Number(a.id)===Number(id)&&el.isConnected&&readOwner()===milestoneOwner&&location.pathname===`/activity/${id}`&&closeActivityEditor()){
      const query=new URLSearchParams(location.search);query.delete('edit');
      if(replacePageAddress(el,location.pathname+(query.size?'?'+query:'')+location.hash)){
        openedEdit=true;editActivity(a);
      }
    }
  }, {maxAge:60000});
});

// Sections (2026-10-12, Ben: "one huge long list"): the map, title and headline numbers stay on top; the rest is
// Charts lead; Details, Splits and Efforts retain the deeper information. ?tab= opens one. Cheers and
// comments are small icons by the title (comments open in a sheet; ?tab=comments opens it), sharing is in Edit, and
// the share button sends a link or a picture (2026-10-12).
const DTABS = [['charts', 'Charts'], ['splits', 'Splits'], ['efforts', 'Efforts'], ['overview', 'Details']];
// Shared activities draw only pace/speed, heart rate and elevation, so they check just those series.
const activitySamples = (a, series = ['speed','gap_speed','hr','alt','power','cad']) => {
  const c = a.chart;
  return !!(c && (c.t?.length >= 2 || c.d?.length >= 2) && series.some(k => c[k]?.filter(v => v != null && Number.isFinite(v)).length >= 2));
};
function activityTabs(panes) {
  const names = DTABS.filter(([key]) => panes[key]?.trim());
  return `<div class="seg wide dtabs" role="tablist" aria-label="Activity sections"${names.length < 2 ? ' hidden' : ''}>${names.map(([key,name]) => `<button type="button" role="tab" id="activity-tab-${key}" aria-controls="activity-pane-${key}" data-dt="${key}">${name}</button>`).join('')}</div>`
    + names.map(([key]) => `<section class="dpane" id="activity-pane-${key}" data-pane="${key}" role="tabpanel" aria-labelledby="activity-tab-${key}" hidden>${panes[key]}</section>`).join('');
}
function wireActivityTabs(el, onShow = () => {}) {
  const buttons = $$('[data-dt]', el), first = buttons[0]?.dataset.dt;
  const show = (key, remember = false) => {
    if (!buttons.some(b => b.dataset.dt === key)) key = first;
    buttons.forEach(b => { const active = b.dataset.dt === key; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
    $$('[data-pane]', el).forEach(p => p.hidden = p.dataset.pane !== key);
    onShow(key);
    if (remember) replacePageAddress(el,location.pathname + (key === first ? '' : '?tab=' + key));
  };
  buttons.forEach((button,index) => {
    button.onclick = () => show(button.dataset.dt, true);
    button.onkeydown = event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next == null) return; event.preventDefault(); show(buttons[next].dataset.dt, true); buttons[next].focus();
    };
  });
  const requested = new URLSearchParams(location.search).get('tab');
  show(requested === 'comments' ? first : requested || first);
}

function drawDetail(el, a) {
  const r = rate(a);
  const hero = a.lifts && !a.distance_m ? headline(a) : (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Elapsed time', activityElapsedText(a)) + (a.distance_m && r.label!=='Time' ? stat(r.label, r.v, r.u) : '');
  const ins = insights(a);
  const splits = imp() ? a.splits_mi : a.splits_km;
  const more = sportStats(a);
  const pane = {
    overview: `${a.power_curve && a.power_curve.length ? `<div class="card"><h2>Power curve</h2><table class="tbl">${a.power_curve.map(p => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r">${p.watts} W</td></tr>`).join('')}</table></div>` : ''}${a.has_intervals?'<section class="card" id="activity-interval-history"></section>':''}${liftCard(a)}${more ? `<div class="card"><h2>Details</h2><div class="hero more">${more}</div>
        ${a.gear_name ? `<p class="small muted">Gear: ${esc(a.gear_name)}</p>` : ''}</div>` : ''}
      ${a.private_note ? `<div class="card"><h2>Private note</h2><p class="small">${esc(a.private_note)}</p></div>` : ''}
      ${ins.length ? `<div class="card"><h2>Insights</h2>${ins.map(([k, t, d]) => `<div class="insight"><span class="dot ${k}"></span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join('')}</div>` : ''}
      ${a.route_id ? `<a class="card tap" href="/route/${a.route_id}" data-prefetch="/api/routes/${a.route_id}"><h2>${esc(a.route_name)}<span class="more">Compare ›</span></h2><p>Matched route · ${a.route_count} activities. See your trend on this route.</p></a>` : ''}
      ${a.line && appFeatureEnabled('progress_segments') ? '<div id="d-segments"></div>' : ''}`,
    splits: `${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
      ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}`,
    charts: `${activitySamples(a) ? '<div class="card activity-chart-card"><div id="d-charts" class="activity-charts"></div></div>' : ''}
      ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
`,
    efforts: `${a.efforts && a.efforts.length ? `<div class="card"><h2>Best efforts</h2>${effortsTable(a)}</div>` : ''}
      ${a.similar && a.similar.length ? `<div class="card"><h2>Similar efforts</h2>${similarHtml(a)}</div>` : ''}`,
  };
  if (!pane.overview.trim()) pane.overview = '<div class="card empty">No additional details were recorded.</div>';
  const bars=ActivityDetail.header(a);el.classList.add('activity-detail');
  const recorded=[a.sport_label,a.device].filter(Boolean).map(esc).join(' · ');
  pane.overview=`${a.description?`<div class="card"><p class="desc">${esc(a.description)}</p></div>`:''}${recorded?`<p class="small muted">${recorded}</p>`:''}${pane.overview}<div class="card" id="d-photo-actions">${a.source==='healthkit'&&!a.line&&['run','ride','walk','hike'].includes(a.sport)?'<button class="linkbtn" type="button" id="d-add-map">Add the map</button>':''}<div class="detail-owner-tools"><div id="d-photos"></div><button type="button" class="linkbtn" id="d-comment-open">Comment</button></div></div>`;
  el.innerHTML=`${a.line?`<div class="detail-map-hero map-head">${activityMedia(a,{mapId:'d-map',detail:true,full:true,compact:true})}${bars.floating}</div>${bars.sticky}`:bars.floating}${ActivityDetail.title(a,hero)}${!a.line&&a.photos?.length?activityMedia(a,{mapId:'d-map',detail:true,compact:true}):''}${Object.keys(a.summary_overrides||{}).length?'<p class="small muted corrected-note">You edited these numbers. Records and splits are hidden until you restore the recorded values in Edit.</p>':''}${activityTabs(pane)}`;
  let drawCharts = null;
  wireActivityTabs(el, key => { if (key === 'charts' && drawCharts) { requestAnimationFrame(drawCharts); drawCharts = null; } });
  ActivityDetail.wire(el,a);
  const segBox = appFeatureEnabled('progress_segments') ? $('#d-segments', el) : null; if (segBox) lazy(segBox, () => Segments.activityCard(segBox, a.id));   // segment times, routes and segments from this activity (#278)
  const addMap=$('#d-add-map',el);if(addMap&&Native.on)addMap.remove();if(addMap&&!Native.on)addMap.onclick=()=>sheet('Add the original map',`<p>Some apps send a workout summary to the Health app without its GPS route. Your workout summary is already here.</p><p>For a Garmin recording:</p><ol><li>Open the matching activity on the Garmin Connect website.</li><li>Choose the settings gear, then <b>Export Original</b>.</li><li>Upload the downloaded ZIP or FIT file here.</li></ol><p class="small muted">Kinetta matches the sport, start time and distance. A matching file adds the map to this workout without making a second activity. Your edited title and numbers stay.</p><a class="primary wide" href="/track/import?map_for=${a.id}">Upload the original file</a>`,(body,close)=>{body.classList.add('activity-map-help');body.querySelector('a').onclick=()=>close();});
  if(a.has_intervals)globalThis.Intervals?.history($('#activity-interval-history',el),a.id);
  ownSocial(el, a);
  $('#d-comment-open',el).onclick=()=>commentsSheet(a.id,SocialData.peek(a.id),()=>{});
  photoStrip($('#d-photos', el), a, true, {controlsOnly: true, afterChange: () => render()});
  wireActivityMedia(el);
  if (a.lifts) fillLiftCard(el, a);
  const kb = $('#d-kit', el);
  if (kb) kb.onclick = () => kitChatOn() ? go(KitChat.href('activity',a.id)) : activityKit(a);
  let marker = null, pts = null, mapObj = null;
  const mapBox = $('#d-map', el);
  if (a.line) lazy(mapBox, async () => {
    try {
      const m = await mapInto(mapBox, a.track_lines?.length ? a.track_lines : [a.line], {sport: a.sport, still: !!a.photos?.length && !mapBox.classList.contains('full')});
      mapObj = m; pts = decode(a.line);
      if (m && a.photos?.length && !mapBox.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
    }
    catch (e) { console.error('map', e); if (mapBox.isConnected) mapBox.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
  });
  if (a.line) wireMediaMapFull(mapBox, () => mapObj, a.track_lines?.length ? a.track_lines : [a.line], !!a.photos?.length);
  if (activitySamples(a)) {
    const c = a.chart, x = c.d && (c.d[c.d.length - 1] > 100 || !c.t) ? c.d : c.t, byDist = x === c.d;
    const rows = [];
    const sp = c.speed && FOOT.includes(a.sport) && a.sport !== 'swim';
    if (c.speed) rows.push(sp ? {name: 'Pace', short: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s5'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s5'), clip: true});
    if (c.gap_speed && sp) rows.push({name: 'Grade-adjusted pace', short: 'GAP', vals: c.gap_speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s2'), invert: true, clip: true, avg: a.gap_s_per_km});
    if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s1'), avg: a.avg_hr});
    if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
    if (c.power) rows.push({name: 'Power', vals: c.power, fmt: (v) => Math.round(v), unit: 'W', color: col('--s4'), clip: true, avg: a.avg_power});
    if (c.cad) rows.push({name: 'Cadence', short: 'Cad', vals: c.cad, fmt: (v) => Math.round(v), unit: a.sport === 'ride' ? 'rpm' : 'spm', color: col('--s3'), clip: true, avg: a.avg_cad});
    const box = $('#d-charts', el);
    const draw = () => { if (!box.isConnected) return; chartStack(box, x, rows, {
      xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v)),
      onIndex: (i) => {   // move a dot along the map with the crosshair
        if (!mapObj || !mapBox?.isConnected || !pts || !pts.length || !c.d) return;
        const frac = (c.d[i] - c.d[0]) / (c.d[c.d.length - 1] - c.d[0] || 1), p = pts[Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)))];
        if (!marker) marker = mapObj.L.circleMarker(p, {radius: 7, color: '#fff', weight: 2, fillColor: col('--s5'), fillOpacity: 1}).addTo(mapObj.map);
        else marker.setLatLng(p);
      }}); };
    let w = 0;
    drawCharts = () => { w = box.clientWidth; draw(); };
    if (!$('[data-pane="charts"]', el).hidden) { requestAnimationFrame(drawCharts); drawCharts = null; }
    const observer = new ResizeObserver(() => { if (box.isConnected && w && box.clientWidth && Math.abs(box.clientWidth - w) > 20) { w = box.clientWidth; draw(); } });
    observer.observe(box); viewResources.set(box, () => observer.disconnect());
  }
}
function splitsTable(a, splits) {
  const foot = FOOT.includes(a.sport);
  const paces = splits.map((s) => s.pace_s_per_km).filter(Boolean), fastest = Math.min(...paces), slowest = Math.max(...paces);
  const hasEl = splits.some((s) => s.elev_m != null), hasHr = splits.some((s) => s.avg_hr);
  return `<table class="tbl"><thead><tr><th>${U.du()}</th><th>${foot ? 'Pace ' + U.pu() : 'Speed ' + U.su()}</th><th></th>${foot && splits.some((s) => s.gap_s_per_km) ? `<th class="r">GAP ${U.pu()}</th>` : ''}${hasEl ? `<th class="r">Elev ${U.eu()}</th>` : ''}${hasHr ? '<th class="r">HR bpm</th>' : ''}</tr></thead><tbody>
    ${splits.map((s) => {
      const full = Math.abs(s.distance_m - (imp() ? MI : 1000)) < 5;
      const w = s.pace_s_per_km ? (fastest / s.pace_s_per_km) : 0;
      return `<tr class="${s.pace_s_per_km === fastest ? 'best' : ''}"><td>${full ? s.n : U.dist(s.distance_m)}</td>
        <td class="num">${foot ? U.pace(s.pace_s_per_km) : U.speed(1000 / s.pace_s_per_km)}</td><td class="barcell"><div class="bar${s.pace_s_per_km === slowest ? ' slow' : ''}" data-w="${(0.25 + 0.75 * ((w - fastest / slowest) / (1 - fastest / slowest || 1))).toFixed(3)}"></div></td>
        ${foot && splits.some((x) => x.gap_s_per_km) ? `<td class="r num">${U.pace(s.gap_s_per_km)}</td>` : ''}
        ${hasEl ? `<td class="r num">${s.elev_m != null ? (s.elev_m > 0 ? '+' : '') + U.elev(s.elev_m) : '–'}</td>` : ''}${hasHr ? `<td class="r num">${s.avg_hr || '–'}</td>` : ''}</tr>`;
    }).join('')}</tbody></table>`;
}
function lapsTable(a) {
  const foot = FOOT.includes(a.sport), hasHr = a.laps.some((l) => l.avg_hr);
  return `<table class="tbl"><thead><tr><th>Lap</th><th>${U.du()}</th><th>Time</th><th class="r">${foot ? 'Pace ' + U.pu() : 'Speed ' + U.su()}</th>${hasHr ? '<th class="r">HR bpm</th>' : ''}</tr></thead><tbody>
    ${a.laps.map((l, i) => { const spk = l.distance_m ? (l.moving_s || l.elapsed_s) / l.distance_m * 1000 : null;
      return `<tr><td>${i + 1}</td><td class="num">${U.dist(l.distance_m)}</td><td class="num">${dur(l.moving_s || l.elapsed_s)}</td>
        <td class="r num">${spk ? (foot ? U.pace(spk) : U.speed(1000 / spk)) : '–'}</td>${hasHr ? `<td class="r num">${l.avg_hr ? Math.round(l.avg_hr) : '–'}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
}
function effortsTable(a) {
  return `<table class="tbl"><tbody>${a.efforts.map((e) => `<tr><td>${e.rank_then <= 3 ? `<span class="medal m${e.rank_then}" title="${['', 'Personal record', '2nd best', '3rd best'][e.rank_then]} at the time">${e.rank_then === 1 ? 'PR' : e.rank_then}</span>` : ''}${esc(e.label)}</td>
    <td class="r num">${dur(e.elapsed_s)}</td><td class="r small muted">${e.rank_now === 1 ? 'Current PR' : `#${e.rank_now} all-time`}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">Medals show how it ranked when you ran it. <a href="/progress?view=records&sport=${esc(a.sport)}">All records ›</a></p>`;
}
function zonesHtml(z) {
  const tot = z.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zones">${z.map((s, i) => `<div class="zone" data-zone="${i+1}" role="img" aria-label="Zone ${i+1}, ${ZN[i]}, ${dur(s,true)}, ${Math.round(s/tot*100)} percent"><span class="zone-name"><i aria-hidden="true"></i>Z${i + 1}</span><div><div class="zone-track"><div class="bar z${i + 1}" data-w="${(s / tot).toFixed(3)}"></div></div><small class="muted">${ZN[i]}</small></div><span class="num r">${dur(s, true)}<small class="muted">${Math.round(s/tot*100)}%</small></span></div>`).join('')}</div>`;
}
function similarHtml(a) {
  const mineRate = rate(a), foot = FOOT.includes(a.sport);
  const mine = mineRate.label==='Time'?null:foot?Number(a.elapsed_s)/Number(a.distance_m)*1000:Number(a.distance_m)/Number(a.elapsed_s);
  return a.similar.map((s) => {
    const peerRate=rate({...s,sport:a.sport}),p=peerRate.label==='Time'?null:foot?Number(s.elapsed_s)/Number(s.distance_m)*1000:Number(s.distance_m)/Number(s.elapsed_s);
    const diff = mine!=null&&p!=null ? foot?p-mine:mine-p : null;
    const same = diff == null ? false : foot ? Math.abs(diff)<2 : U.speed(Math.abs(diff))<0.1;
    const cmp = diff == null ? '' : same ? 'same pace' : `${diff > 0 ? 'you were' : 'it was'} ${foot ? Math.round(Math.abs(imp() ? diff * MI / 1000 : diff)) + ' s' + U.pu() : U.speed(Math.abs(diff)) + ' ' + U.su()} faster`;
    return `<a class="row-link" href="/activity/${s.id}" data-prefetch="/api/activities/${s.id}"><div><b>${esc(s.name)}</b><br><small class="muted">${esc(fdate(s.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))} · ${U.dist(s.distance_m)} ${U.du()}${s.same_route ? ' · same route' : ''}</small></div>
      <div class="r"><b class="num">${p!=null ? peerRate.v + peerRate.u : '–'}</b><br><small class="muted">${esc(cmp)}</small></div></a>`;
  }).join('');
}

function editActivity(a) {
  // the same grouped kinds as Add an activity (2026-10-13, Ben: Edit only had the nine sports); a kind from an import that
  // isn't in the list (Strava's "Trail Run") stays as the first choice
  const kinds = HAND_KINDS.flatMap(([, list], gi) => list.map(([sp, , lb], i) => ({v: `${gi}.${i}`, sp, lb: lb || null})));
  const cur = kinds.find((k) => k.sp === a.sport && k.lb === (a.sport_label || null)) || (!a.sport_label && kinds.find((k) => k.sp === a.sport && !k.lb));
  const keep = cur ? '' : `<option value="keep" selected>${esc(a.sport_label || SPORT_NAMES[a.sport] || 'Activity')}</option>`;
  const kindOpts = keep + HAND_KINDS.map(([g, list], gi) => `<optgroup label="${esc(g)}">${list.map(([, n], i) => `<option value="${gi}.${i}"${cur && cur.v === `${gi}.${i}` ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
  // "1:34:50", "34:50" or plain minutes ("95") -> seconds; anything else -> NaN
  const clockSecs=(v)=>{const p=v.split(':');if(p.length>3||p.some((x)=>!/^\d+([.,]\d+)?$/.test(x.trim())))return NaN;const n=p.map((x)=>Number(x.trim().replace(',','.')));return p.length===1?n[0]*60:p.length===2?n[0]*60+n[1]:n[0]*3600+n[1]*60+n[2]};
  const summaryFields=[['distance_m','Distance',imp()?'mi':'km',imp()?1609.344:1000],['moving_s','Moving time','h:mm:ss',1],['elapsed_s','Total duration','h:mm:ss',1],['ascent_m','Elevation gain',imp()?'ft':'m',imp()?0.3048:1],['calories','Energy','kcal',1],['avg_hr','Average heart rate','bpm',1],['max_hr','Maximum heart rate','bpm',1]];
  const initial={};
  // times as 1:34:50 like everywhere else in the app; heart rate, energy and climb as whole numbers (2026-10-16)
  const isTime=(key)=>key.endsWith('_s');
  const correctionFields=summaryFields.map(([key,label,unit,scale])=>{const value=a[key]==null?'':isTime(key)?dur(a[key]):key==='distance_m'?String(Math.round(a[key]/scale*100)/100):String(Math.round(a[key]/scale));initial[key]=value;return `<label>${label} (${unit})<input name="summary_${key}" inputmode="${isTime(key)?'text':'decimal'}" value="${value}" placeholder="Not recorded" aria-label="${label} in ${isTime(key)?'hours, minutes and seconds':unit}"></label>${Object.hasOwn(a.summary_overrides||{},key)?`<label class="check"><input type="checkbox" name="restore_${key}"> Use recorded ${label.toLowerCase()}</label>`:''}`}).join('');
  // Redesigned 30 Oct 2026 (Ben): Cancel · Save stay pinned at the top; the most-used choices come first, the rarer
  // details are grouped, and Delete sits alone at the bottom, away from Save.
  let dirty = false, closeEdit = null, asking = false;
  // Closing with unsaved edits asks first in the shared confirm sheet; the editor stays open until Discard.
  const canClose = () => {
    if (!dirty) return true;
    const editor = $('#e-form')?.closest('.sheet'), after = editor?._afterDiscard;
    if (editor) editor._afterDiscard = null;
    if (!asking) { asking = true; confirmSheet('Discard your changes?', {body: 'Your edits to this activity won’t be saved.', action: 'Discard', cancel: 'Keep editing'}).then((ok) => { asking = false; if (ok && closeEdit) { closeEdit(); if (after) after(); } }); }
    return false;
  };
  sheet('Edit activity', `<form class="form" id="e-form">
    <label>Title<input name="name" value="${esc(a.name)}" maxlength="200" enterkeyhint="done"></label>
    <label>What did you do?<span class="selbox"><select name="kind">${kindOpts}</select>${svg('chev')}</span></label>
    <div id="e-share" class="e-share"><p class="small muted">Loading sharing…</p></div>
    ${optionalText('description', 'Description', 'Add a description', a.description)}
    ${optionalText('private_note', 'Private note (only you)', 'Add a private note', a.private_note)}
    <h3 class="ghead e-details-head">Details</h3>
    <details id="e-summary" class="fold-row"><summary><span class="ri c-brand">${svg('edit')}</span><span class="grow"><b>Distance, time & heart rate</b><small>Fix numbers your watch got wrong</small></span><span class="chev">${svg('chev')}</span></summary><div class="form e-fields"><p class="small muted">Your edits stay when the Health app syncs again. Leave a box empty if it wasn't recorded. Changing distance or time hides records and splits; tick “Use recorded” to undo an edit.</p>${correctionFields}</div></details>
    <label>Gear<span class="selbox"><select name="gear"><option value="">None</option></select>${svg('chev')}</span></label>
    <label class="check"><input type="checkbox" name="commute"${a.commute ? ' checked' : ''}> Commute</label>
    <button type="button" class="e-delete" id="e-del">Delete activity</button></form>`, async (body, close) => {
    closeEdit = close;
    body.closest('.sheet').classList.add('activity-editor');
    const f = $('#e-form', body), btn = body.closest('.sheet').querySelector('button[form="e-form"]');
    // Any edit (typing, a choice, a sharing button) means closing asks first; opening the fold-outs doesn't count.
    const touched = () => { dirty = true; };
    f.addEventListener('input', touched); f.addEventListener('change', touched);
    f.addEventListener('click', (e) => { if (e.target.closest('.seg button, #sh-usual')) touched(); });
    wireOptionalText(f);
    let saveShare = null;   // sharing (2026-10-12): moved here from the activity page
    (a._social ? Promise.resolve(a._social) : api(`/api/activities/${a.id}/social`))
      .then((s) => { if (f.isConnected) saveShare = shareFields($('#e-share', body), a.id, s); })
      .catch(() => { $('#e-share', body).innerHTML = '<p class="small muted">Sharing could not load. Try again later.</p>'; });
    api('/api/gear').then((gear) => { f.gear.insertAdjacentHTML('beforeend', gear.filter((g) => !g.retired || g.id === a.gear_id).map((g) => `<option value="${g.id}"${g.id === a.gear_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')); }).catch(() => {});
    f.onsubmit = async (e) => {
      e.preventDefault();
      const k = kinds.find((x) => x.v === f.kind.value);
      // by tag: the sharing choices below include a checkbox also named "description" (it made Save wipe the text)
      const text = (name) => f.querySelector(`textarea[name="${name}"]`).value;
      const body2 = {description: text('description'), private_note: text('private_note'), commute: f.commute.checked};
      if (k) { body2.sport = k.sp; body2.sport_label = k.lb || ''; }
      if (f.name.value !== a.name) body2.name = f.name.value;   // left alone, a name nobody typed follows the kind ("Lunch Yoga")
      if (f.gear.value) body2.gear_id = +f.gear.value; else body2.clear_gear = true;
      body2.restore_summary=[];
      for(const [key,label,,scale] of summaryFields){if(f.elements['restore_'+key]?.checked){body2.restore_summary.push(key);continue}const value=f.elements['summary_'+key].value.trim();if(value===initial[key])continue;const number=value===''?null:isTime(key)?clockSecs(value):Number(value.replace(',','.'))*scale;if(number!==null&&!Number.isFinite(number)){toast(isTime(key)?`Enter ${label.toLowerCase()} like 1:34:50`:'Enter a valid '+label.toLowerCase());return}body2[key]=number}
      if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api(`/api/activities/${a.id}`, json('PATCH', body2));
        if (saveShare) await saveShare();
        invalidate('/api/'); close(); toast('Saved'); render();
      } catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Save'; }
    };
    $('#e-del', body).onclick = async () => {
      if (!await confirmSheet(`Delete “${a.name}”?`, {body: 'This can’t be undone.', action: 'Delete'})) return;
      try { await api(`/api/activities/${a.id}`, {method: 'DELETE'}); invalidate('/api/'); close(); toast('Activity deleted'); go('/activity', {replace: true}); }
      catch (x) { toast(x.message); }
    };
  }, {save: 'e-form', canClose});
}

