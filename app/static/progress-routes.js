// Kinetta phone app — Progress detail routes, loaded only when opened.
'use strict';

// ---------- Progress: Records list and per-distance history ----------
async function pRecordsLoaded(body, q) {
  const sport = q.get('sport') || 'run';
  body.innerHTML = `<div id="r-body">${skel(2)}</div>`;
  await load(`/api/records?sport=${sport}`, (r) => {
    const yr = new Date().getFullYear();
    $('#r-body', body).innerHTML = r.efforts.length ? `<div class="card"><table class="tbl"><thead><tr><th>Distance</th><th class="r">Best</th><th class="r">${yr}</th></tr></thead><tbody>
      ${r.efforts.map((e) => `<tr><td><a href="/records/${sport}/${e.distance_m}">${esc(e.label)}</a><br><small class="muted">${e.count} efforts</small></td>
        <td class="r"><a class="num" href="/activity/${e.top[0].activity_id}"><b>${dur(e.top[0].elapsed_s)}</b></a><br><small class="muted">${esc(fdate(e.top[0].start_time, {month: 'short', year: 'numeric'}))}</small></td>
        <td class="r num">${e.year ? dur(e.year.elapsed_s) : '–'}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Tap a distance for its PR history. Best efforts are found inside every ${SPORT_NAMES[sport].toLowerCase()}, not just races.</p></div>
      ${r.power_curve.length ? `<div class="card"><h2>Best power</h2><table class="tbl">${r.power_curve.map((p) => `<tr><td>${p.seconds < 60 ? p.seconds + ' s' : p.seconds / 60 + ' min'}</td><td class="r num">${p.watts} W</td></tr>`).join('')}</table></div>` : ''}`
      : `<div class="card empty"><b>No ${SPORT_NAMES[sport].toLowerCase()} records yet</b>They appear as soon as you upload activities with GPS or distance data.</div>`;
  });
}
async function pRecordHistoryLoaded(el, sport, dist) {
  el.innerHTML = `<div class="top">${backBtn('Records')}</div>${skel(2)}`;
  wireBack(el, `/progress?view=records&sport=${sport}`);
  await load(`/api/records/history?sport=${sport}&distance_m=${dist}`, (rows) => {
    const prs = rows.filter((r) => r.pr),owner=readOwner();let onlyPRs=false;
    const label = (rows[0] && rows[0].label) || '';
    el.innerHTML = `<div class="top">${backBtn('Records')}</div><div class="card"><h1>${esc(U.dist(+dist) + ' ' + U.du())} · ${SPORT_NAMES[sport]}</h1>
      <p class="muted">${rows.length} efforts · ${prs.length} times you set a new PR</p><div id="h-chart"></div></div>
      <div class="card"><div class="record-history-heading"><h2>Efforts</h2><div class="me-period" role="group" aria-label="Effort history"><button type="button" data-record-filter="all" aria-pressed="true">All</button><button type="button" data-record-filter="prs" aria-label="Personal records only" aria-pressed="false">PRs</button></div></div><p class="small muted">Fastest first</p><div id="h-all"></div></div>`;
    wireBack(el, `/progress?view=records&sport=${sport}`);
    const all = [...rows].sort((a, b) => a.elapsed_s - b.elapsed_s), allRow = (r, i) => `<a class="row-link record-effort" href="/activity/${r.activity_id}"><span class="record-rank num">${i + 1}</span><div class="record-effort-main"><b class="num">${dur(r.elapsed_s)}</b><br><small class="muted">${esc(r.name)}${r.pr?' · PR':''}</small></div><small class="muted">${esc(fdate(r.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</small></a>`;
    const drawAll = (n) => { const box = $('#h-all', el),list=onlyPRs?all.filter(r=>r.pr):all; if (!box||owner!==readOwner()) return; box.innerHTML = list.slice(0, n).map(allRow).join('') + (list.length > n ? `<button type="button" class="ghost wide" id="h-more">Show all ${list.length}</button>` : ''); const more = $('#h-more', box); if (more) more.onclick = () => drawAll(list.length); };
    drawAll(10);
    $$('[data-record-filter]',el).forEach(button=>button.onclick=()=>{if(!el.isConnected||owner!==readOwner())return;onlyPRs=button.dataset.recordFilter==='prs';$$('[data-record-filter]',el).forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.recordFilter==='prs')===onlyPRs)));drawAll(10);});
    const best = rows.reduce((b, r) => (!b || r.elapsed_s < b.elapsed_s ? r : b), null);
    requestAnimationFrame(() => dotChart($('#h-chart', el), rows.map((r) => ({x: new Date(r.start_time) / 864e5, y: r.elapsed_s, id: r.activity_id})), {yfmt: (v) => dur(v), invert: true, best: best && best.activity_id}));
  });
}

// ---------- Progress: growth over the years (2026-10-09) ----------
async function pTrends(body, q) {
  const sport = q.get('sport') || 'run', foot = sport !== 'ride';
  const R = getRange(q);
  body.innerHTML = `<div id="g-body">${skel(3)}</div>`;
  await load(`/api/progress/trends?sport=${sport}`, (r) => {
    const box = $('#g-body', body); if (!box) return;
    const noun = {run: 'runs', ride: 'rides', walk: 'walks'}[sport], one = noun.slice(0, -1);
    if (!r.months.length) { box.innerHTML = `<div class="card empty"><b>No ${noun} yet</b>Your pace and distance trends show up here.${startCta()}</div>`; return; }
    const today = new Date(r.today + 'T12:00'), M = {}; for (const m of r.months) M[m.m] = m;
    const N = (v) => Number(v || 0);
    const weeksIn = (y, m) => { const days = new Date(y, m, 0).getDate(); return (y === today.getFullYear() && m === today.getMonth() + 1 ? today.getDate() : days) / 7; };
    // derived numbers for a set of month rows + the weeks they cover
    const derive = (rows, weeks) => {
      const s = (k) => rows.reduce((a, x) => a + N(x[k]), 0), n = s('n'), rate=elapsedActivityRate(rows,sport), hrt = s('hr_t'), cadt = s('cad_t');
      return {n, weeks, wk: weeks ? toU(s('d')) / weeks : null, perwk: weeks ? n / weeks : null, avgd: n ? toU(s('d')) / n : null,
        pace: sport==='ride'?null:rate.value, speed: sport==='ride'?rate.value:null, hr: hrt ? s('hr_w') / hrt : null, cad: cadt ? s('cad_w') / cadt : null,
        longest: Math.max(0, ...rows.map((x) => N(x.longest))), climb: s('a'), pd:rate.distance, hrt};
    };
    const series = monthSeries(r.months[0].m, (ym) => { const [y, m] = ym.split('-').map(Number), row = M[ym]; return {ym, ...derive(row ? [row] : [], weeksIn(y, m))}; });
    // by year
    const years = {}; for (const p of series) { const y = p.d.getFullYear(); (years[y] = years[y] || []).push(p); }
    rangeBar(body.progressRange, R, +r.months[0].m.slice(0, 4));
    const yrows = Object.keys(years).filter((y) => inRange(R, +y)).sort().reverse().map((y) => ({y, ...derive(years[y].map((p) => M[p.ym]).filter(Boolean), years[y].reduce((a, p) => a + p.weeks, 0))}));
    const pace = (v) => (v ? U.pace(v) : '–'), spd = (v) => (v ? U.speed(v) : '–');
    const cy = yrows[0], ly = yrows[1];
    const cmp = (m) => {   // change vs last year; colored only where better/worse is clear (pace, speed)
      if (!cy || !ly || cy[m.k] == null || ly[m.k] == null) return '';
      const diff = cy[m.k] - ly[m.k], txt = m.fmt(Math.abs(diff));
      if (!/[1-9]/.test(txt.replace(/^0:00/, ''))) return '<span class="delta">same</span>';
      const up = diff > 0, cls = m.better ? ((m.better === 'lower') !== up ? 'good' : 'bad') : '';
      return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${esc(txt)}</span>`;
    };
    const metrics = [
      {k: 'wk', t: 'Weekly average distance', fmt: (v) => `${v.toFixed(1)} ${U.du()}`, color: 'run'},
      foot ? {k: 'pace', t: 'Average pace', fmt: (v) => pace(v) + U.pu(), axis: pace, invert: true, w: 'pd', color: 's1', better: 'lower'} : {k: 'speed', t: 'Average speed', fmt: (v) => `${spd(v)} ${U.su()}`, axis: spd, w: 'pd', color: 's1', better: 'higher'},
      {k: 'hr', t: 'Average heart rate', fmt: (v) => `${Math.round(v)} bpm`, w: 'hrt', color: 's2'},
      {k: 'avgd', t: `Average ${one} distance`, fmt: (v) => `${v.toFixed(1)} ${U.du()}`, w: 'n', color: 's3'},
      {k: 'perwk', t: `${noun[0].toUpperCase() + noun.slice(1)} per week`, fmt: (v) => v.toFixed(1), color: 's4'},
      ...(sport === 'run' ? [{k: 'cad', t: 'Average cadence', fmt: (v) => `${Math.round(v)} spm`, w: 'n', color: 's5'}] : []),
    ];
    const yearValue = (y, key) => ({
      distance: y.wk == null ? '–' : `${y.wk.toFixed(1)} ${U.du()}`,
      frequency: y.perwk == null ? '–' : y.perwk.toFixed(1),
      pace: foot ? pace(y.pace) : spd(y.speed),
      heart: y.hr ? `${Math.round(y.hr)} bpm` : '–',
      average: y.avgd == null ? '–' : `${y.avgd.toFixed(1)} ${U.du()}`,
      longest: y.longest ? `${toU(y.longest).toFixed(1)} ${U.du()}` : '–',
    })[key];
    const yearMetrics = y => [
      ['Distance / week', 'distance'], [`${noun[0].toUpperCase() + noun.slice(1)} / week`, 'frequency'],
      [foot ? `Pace ${U.pu()}` : `Speed ${U.su()}`, 'pace'], ['Heart rate', 'heart'],
      [`Average ${U.du()}`, 'average'], [`Longest ${U.du()}`, 'longest'],
    ].map(([label,key]) => `<div class="trend-year-metric"><small>${esc(label)}</small><b class="num">${esc(yearValue(y,key))}</b></div>`).join('');
    box.innerHTML = `<div class="card trend-years"><h2>By year</h2><div class="tblwrap trend-year-table"><table class="tbl yrs"><thead><tr><th>Year</th><th class="r">${U.du()}/wk</th><th class="r">${noun[0].toUpperCase() + noun.slice(1)}/wk</th><th class="r">${foot ? 'Pace ' + U.pu() : 'Speed ' + U.su()}</th><th class="r">HR bpm</th><th class="r">Avg ${U.du()}</th><th class="r">Longest ${U.du()}</th></tr></thead><tbody>
        ${yrows.map((y) => `<tr${+y.y === today.getFullYear() ? ' class="cur"' : ''}><td>${y.y}${+y.y === today.getFullYear() ? '<small class="muted"> so far</small>' : ''}</td><td class="r num"><b>${y.wk == null ? '–' : y.wk.toFixed(1)}</b></td><td class="r num">${y.perwk == null ? '–' : y.perwk.toFixed(1)}</td>
          <td class="r num">${foot ? pace(y.pace) : spd(y.speed)}</td><td class="r num">${y.hr ? Math.round(y.hr) : '–'}</td><td class="r num">${y.avgd == null ? '–' : y.avgd.toFixed(1)}</td><td class="r num">${y.longest ? toU(y.longest).toFixed(1) : '–'}</td></tr>`).join('')}</tbody></table></div>
      <div class="trend-year-cards">${yrows.map(y => `<section class="trend-year-row${+y.y === today.getFullYear() ? ' current' : ''}"><h3>${y.y}${+y.y === today.getFullYear() ? '<small> so far</small>' : ''}</h3><div class="trend-year-metrics">${yearMetrics(y)}</div></section>`).join('')}</div>
        <p class="small muted">${foot ? 'Pace = total elapsed time ÷ total distance' : 'Speed = total distance ÷ total elapsed time'}. Heart rate and cadence are weighted by moving time, from activities that recorded them.</p></div>
      ${metrics.map((m) => `<div class="card"><h2>${esc(m.t)}</h2>
        ${cy && cy[m.k] != null ? `<p class="small"><b class="num">${esc(m.fmt(cy[m.k]))}</b> in ${cy.y}${+cy.y === today.getFullYear() ? ' so far' : ''}${ly && ly[m.k] != null ? ` · ${esc(m.fmt(ly[m.k]))} in ${ly.y} ${cmp(m)}` : ''}</p>` : ''}
        <div id="g-${m.k}"></div></div>`).join('')}`;
    requestAnimationFrame(() => {
      for (const m of metrics) trendLine($(`#g-${m.k}`, box), series.map((p) => ({d: p.d, label: p.label+(p.ym===r.today.slice(0,7)?' · so far':''), y: m.k === 'wk' || m.k === 'perwk' ? p[m.k] : p.n ? p[m.k] : null, w: m.w ? p[m.w] : 1})), {fmt:v=>m.fmt(v)+(['wk','perwk'].includes(m.k)?'/week':''), yfmt: m.axis || ((v) => (Math.abs(v) >= 20 ? String(Math.round(v)) : v.toFixed(1))), color: m.color, invert: !!m.invert, keep: (p) => inRange(R, p.d.getFullYear())});
    });
  });
}
// The month at a glance (2026-10-11): what you did and how you ate, day by day. Each day shows its workout (the sport's
// icon, tinted) and a bar for food against that day's goal; the right column is each week's distance. Tap a day for it all.
const FOODST = {on: ['On target', 'within 10% of your goal'], over: ['Over', 'more than 10% over'], under: ['Under', 'more than 10% under'],
  partial: ['Partly logged', 'under half a usual day'], today: ['Today', 'so far'], logged: ['Logged', 'no goal set']};
async function pCalendar(body, q) {
  const now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, month = q.get('month') || cur;
  const [y, m] = month.split('-').map(Number), first = new Date(y, m - 1, 1);
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  await load(`/api/calendar/month?month=${month}`, (M) => {
    const S = M.summary, wk = (w) => (w.distance_m ? U.dist(w.distance_m, 1) : w.moving_s ? `${Math.round(w.moving_s / 60)}m` : '');
    const cell = (x) => {
      const a = x.acts[0], f = x.food, dn = new Date(x.d + 'T12:00').getDate();
      const label = [new Date(x.d + 'T12:00').toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'}),
        x.acts.length ? x.acts.map((z) => z.name).join(', ') : 'no workout', f ? `${r0(f.kcal)} kcal${f.status ? ', ' + FOODST[f.status][0].toLowerCase() : ''}` : 'no food logged'].join(': ');
      return `<button type="button" class="cd${x.in_month ? '' : ' out'}${x.today ? ' today' : ''}${a ? ' has s-' + esc(a.sport) : ''}" data-d="${esc(x.d)}" aria-label="${esc(label)}">
        <span class="cd-n">${dn}</span><span class="cd-i">${a ? svg(a.sport) + (x.acts.length > 1 ? '<i>+</i>' : '') : ''}</span>
        <span class="cd-f ${f && f.status ? esc(f.status) : ''}"></span></button>`;
    };
    let grid = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="cd-h">${d}</div>`).join('') + `<div class="cd-h">${esc(U.du())}</div>`;
    for (let i = 0; i < M.days.length; i += 7) grid += M.days.slice(i, i + 7).map(cell).join('') + `<div class="cd-w num">${esc(wk(M.weeks[i / 7]))}</div>`;
    body.innerHTML = `<div class="card cal2"><div class="cal-nav"><button class="icon-btn" id="c-prev" aria-label="Previous month">${svg('back')}</button>
        <h2>${esc(first.toLocaleDateString([], {month: 'long', year: 'numeric'}))}</h2><button class="icon-btn" id="c-next" aria-label="Next month"${month >= cur ? ' disabled' : ''}>${svg('chev')}</button></div>
      <div class="stats3">${stat('Trained', `${S.trained}`, `of ${S.days} days`)}${stat('On target', S.judged ? `${S.on_target}` : '–', S.judged ? `of ${S.judged}` : '')}${stat('Weigh-ins', S.weighed)}</div>
      <div class="cal-grid">${grid}</div>
      <div class="legend cal-legend"><span><span class="lg-i">${svg('run')}</span>Workout</span>${['on', 'over', 'under', 'partial'].map((k) => `<span><span class="cd-f ${k}"></span>${FOODST[k][0]}</span>`).join('')}</div></div>
      <p class="small muted cal-help">Each day shows your workout and a bar for what you ate against that day's goal. Tap a day for the details.${month < cur ? ` <a href="/progress/calendar">Back to this month</a>` : ''}</p>`;
    $('#c-prev', body).onclick = () => go(`/progress/calendar?month=${shift(-1)}`, {replace: true});
    $('#c-next', body).onclick = () => go(`/progress/calendar?month=${shift(1)}`, {replace: true});
    $$('.cd', body).forEach((b) => b.onclick = () => calDay(M.days.find((x) => x.d === b.dataset.d), M));
  });
}
function calDay(x, M) {
  const f = x.food, title = new Date(x.d + 'T12:00').toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'});
  sheet(title, `<h3 class="ghead">Training</h3>${x.acts.length ? `<div class="card list">${x.acts.map((a) => `<a class="row-link" href="/activity/${a.id}" data-close>${sportMark(a.sport)}
      <span class="grow"><b>${esc(a.name)}</b><small class="muted">${a.distance_m ? `${esc(U.dist(a.distance_m))} ${esc(U.du())} · ` : ''}${esc(activityElapsedText(a))}${a.moving_s!=null&&a.elapsed_s!==a.moving_s?` · ${esc(dur(a.moving_s))} moving`:''}</small></span><span class="chev">${svg('chev')}</span></a>`).join('')}</div>`
      : '<p class="small muted">Rest day: no workout.</p>'}
    <h3 class="ghead">Food</h3>${f ? `<div class="card cal-food"><div class="kv"><span>Eaten</span><b class="num">${r0(f.kcal)} kcal${f.goal ? ` <span class="muted">of ${r0(f.goal)}</span>` : ''}</b></div>
      <div class="kv"><span>Protein</span><b class="num">${r0(f.protein_g)} g${M.protein_target ? ` <span class="muted">of ${r0(M.protein_target)}</span>` : ''}</b></div>
      ${f.status ? `<div class="kv"><span>How it went</span><b><span class="cd-f ${esc(f.status)}"></span> ${esc(FOODST[f.status][0])} <span class="muted small">${esc(FOODST[f.status][1])}</span></b></div>` : ''}</div>`
      : '<p class="small muted">Nothing logged.</p>'}
    ${x.weight_kg ? `<h3 class="ghead">Weigh-in</h3><p class="num"><b>${esc(U.weight(x.weight_kg))} ${imp() ? 'lb' : 'kg'}</b></p>` : ''}
    <a class="ghost wide" href="/food?d=${esc(x.d)}" data-close>${svg('food')}Open this day's food log</a>`, (b, close) => {
    $$('[data-close]', b).forEach((l) => l.addEventListener('click', () => close()));
  });
}
async function pRoutes(body) {
  await load('/api/routes', (rows) => {
    body.innerHTML = rows.length ? `<div class="card progress-detail-links">${rows.map((r) => `<a class="row-link" href="/route/${r.id}" data-prefetch="/api/routes/${r.id}">
      <div class="hd act">${r.g ? miniRoute(polyFromGeo(r.g), r.sport === 'foot' ? 'walk' : r.sport) : ''}</div>
      <div class="grow"><b>${esc(r.name)}</b><br><small class="muted">${r.count} times · best ${dur(r.best_s)} · last ${esc(fdate(r.last, {month: 'short', day: 'numeric'}))}</small></div><span class="chev">${svg('chev')}</span></a>`).join('')}</div>
      <p class="small muted">Routes are matched automatically when you repeat the same start, finish, direction and distance.</p>`
      : '<div class="card empty"><b>No matched routes yet</b>Do the same route twice and it appears here with your trend.</div>';
  });
}
function polyFromGeo(g) {   // GeoJSON -> encoded polyline (re-use miniRoute)
  try { const c = JSON.parse(g).coordinates; let s = '', pl = 0, po = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
    for (const [lo, la] of c) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); s += enc(a - pl) + enc(b - po); pl = a; po = b; } return s; } catch (e) { return ''; }
}
async function pHeatmap(body, q) {
  const sport = q.get('sport') || '', owner = readOwner(), page = body.closest('.shell');
  page.classList.add('heatmap-page');
  body.innerHTML = '<section class="card progress-map-card heatmap-frame"><div class="heatmap-tools"><span class="heatmap-count" role="status" hidden></span></div><div class="map tall" id="h-map" role="region" aria-label="Your route heatmap"></div></section>';
  const lines = await api(`/api/heatmap${sport ? '?sport=' + sport : ''}`);
  if (!body.isConnected || owner !== readOwner()) return;
  const frame = $('.heatmap-frame',body), mapBox = $('#h-map',body), count = $('.heatmap-count',body);
  if (!lines.length) {
    frame.classList.add('heatmap-empty');
    mapBox.outerHTML = `<div class="heatmap-empty-copy"><b>Nothing to map yet</b><p>Every route you've done, on one map.</p><a class="primary wide" href="/track">Open Track</a></div>`;
    return;
  }
  // The endpoint returns at most5000 geometries, without dates or authoritative distance totals.
  count.textContent = lines.length === 5000 ? 'Showing 5,000 routes (limit)' : `${lines.length.toLocaleString()} mapped route${lines.length === 1 ? '' : 's'}`;
  count.hidden = false;
  const size = () => {
    if (!mapBox.isConnected) return;
    const nav = document.querySelector('nav.tabs'), rect = nav?.getBoundingClientRect();
    const bottom = rect?.height ? rect.top - 8 : innerHeight - 16;
    const height = Math.max(1, Math.floor(bottom - mapBox.getBoundingClientRect().top));
    mapBox.style.setProperty('--heatmap-width',document.documentElement.clientWidth+'px');
    mapBox.classList.toggle('heatmap-short',height<150);
    if (mapBox.style.height !== height+'px') mapBox.style.height = height+'px';
  };
  size();
  const view = await mapInto(mapBox, lines, {heat:true});
  if (!view || !mapBox.isConnected) return;
  const resize = () => { size(); if(mapBox.isConnected) view.map.invalidateSize({pan:true,animate:false}); };
  // Insets follow the real header/tabs, including native safe areas and enlarged text.
  const observer = new ResizeObserver(resize);
  for(const node of [page.querySelector('.top'),$('.heatmap-tools',body),document.querySelector('nav.tabs')])if(node)observer.observe(node);
  window.addEventListener('resize',resize);
  page.addEventListener('animationend',resize);
  resize();
  const bounds = view.group.getBounds();
  if(bounds.isValid()) {
    const h=mapBox.clientHeight,top=Math.min($('.heatmap-tools',body).getBoundingClientRect().height+24,h/3),bottom=Math.min(60,h/4);
    view.map.fitBounds(bounds,{paddingTopLeft:[18,top],paddingBottomRight:[18,bottom]});
  }
  const dispose = viewResources.get(mapBox);
  viewResources.set(mapBox,Object.assign(()=>{observer.disconnect();window.removeEventListener('resize',resize);page.removeEventListener('animationend',resize);dispose?.();},{keepVisual:true}));
}

route(/^\/progress\/routes$/, 'progress', async el => { pHead(el,'routes',''); await pRoutes($('#p-body',el)); });
route(/^\/progress\/(trends|calendar|heatmap)$/, 'progress', async (el, view) => {
  if (view === 'calendar' && !appFeatureEnabled('progress_calendar')) return go('/progress', {replace: true});
  const q = new URLSearchParams(location.search), sport = pSport(q), withSport = view === 'trends' || view === 'heatmap';
  pHead(el, view, (withSport ? sportBtn(forView(sport, view)) : '') + (view === 'trends' ? '<span class="rng" id="p-rng"></span>' : ''));
  wireSport(el, sport);
  q.set('sport', forView(sport, view));
  await ({trends: pTrends, calendar: pCalendar, routes: pRoutes, heatmap: pHeatmap}[view])($('#p-body', el), q);
});

// Use the existing sheet lifecycle for focus, Escape, Back and account cleanup.
function fitnessChart(box, title, draw) {
  box.innerHTML = '<div data-fitness-plot></div><button type="button" class="linkbtn chart-expand">'+svg('expand')+' View full screen</button>';
  let closeFull = null;
  viewResources.set(box, () => closeFull?.());
  const plot = $('[data-fitness-plot]', box), open = () => {
    if(!$('svg',plot))return;
    const owner = readOwner();
    const selected = chartViews.get(plot)?.state();
    sheet(title, '<div class="fitness-inspect"><p class="small muted">Pinch or scroll to zoom. Drag to move through dates. Tap or hover for exact values.</p><div data-full-chart></div></div>', (body, close) => {
      closeFull = close;
      body.closest('.sheet')?.querySelector('[data-close]')?.focus({preventScroll:true});
      const mount = $('[data-full-chart]', body);
      const redraw = () => {
        if (owner !== readOwner()) return close();
        if (!mount.isConnected) return;
        const view = chartViews.get(mount)?.state() ?? selected;
        const focused = mount.contains(document.activeElement);
        draw(mount, Math.max(220, Math.min(600, innerHeight * .52)), {view,interactive:true});
        $('.fitness-inspect > p',body).hidden=!$('svg',mount);
        if (focused) $('svg',mount)?.focus({preventScroll:true});
      };
      requestAnimationFrame(redraw);
      window.addEventListener('resize', redraw);
      viewResources.set(mount, () => {window.removeEventListener('resize', redraw);if(closeFull === close)closeFull = null;});
    });
  };
  draw(plot, 170);
  // The chart itself and the labelled button both open the larger analysis view.
  const graph = $('.chartbox', plot);
  if (graph) { graph.setAttribute('role','button'); graph.tabIndex=0; graph.setAttribute('aria-label','View '+title+' full screen'); graph.onclick=open; graph.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}}; }
  $('.chart-expand',box).hidden=!graph;$('.chart-expand',box).onclick=open;
}
async function pFitnessLoaded(body, q) {
  const R = getRange(q), nowY = new Date().getFullYear();
  const days = R.from ? Math.min(3650, Math.ceil((Date.now() - new Date(R.from, 0, 1)) / 864e5) + 1) : 3650;
  // The year filter stays with Running fitness; it filters the charts, not the predictions.
  body.innerHTML = `<div id="fi-summary"></div><div id="fi-pred">${skel(1)}</div><div id="fi-body">${skel(1)}</div>`;
  await load(`/api/fitness?days=${days}`, (f0) => {
    const summaryBox = $('#fi-summary', body), box = $('#fi-body', body), pbox = $('#fi-pred', body); if (!box) return;
    const f = {...f0, days: f0.days.filter((d) => inRange(R, +d.d.slice(0, 4)))};
    const last = f0.days[f0.days.length - 1] || {fitness: 0, fatigue: 0, form: 0};
    if (summaryBox && f0.days.some(d => d.fitness > 0)) {
      const form = last.form, [kind, word] = form > 5 ? ['good', 'Fresh'] : form < -15 ? ['warn', 'Tired'] : ['', 'Training steadily'];
      const mini = (label, value) => `<span><b class="num">${esc(value)}</b><small>${esc(label)}</small></span>`;
      summaryBox.innerHTML = `<section class="card me-form fitness-current" aria-label="Fitness and form"><span class="me-form-top"><span class="grow"><small>Fitness &amp; form</small><b class="status-word ${kind}">${word}</b></span></span>
        <span class="me-form-nums">${mini('Fitness', Math.round(last.fitness))}${mini('Form', (form > 0 ? '+' : '') + Math.round(form))}${f0.vdot_now ? mini('Run score', f0.vdot_now) : ''}</span>
        ${f0.ramp_7d > 8 ? '<span class="callout warn">Your training load jumped this week. Build up gradually to stay healthy.</span>' : ''}</section>`;
    }
    const predictionSourceDetail = p => {
      const source = p.from || {};
      const date = Number.isFinite(Date.parse(source.start_time)) ? fdate(source.start_time, {month:'short', day:'numeric'}) : 'date unavailable';
      const effort = source.label ? `${esc(source.label)} · ${esc(dur(source.elapsed_s))} · ${esc(date)}` : 'Source unavailable';
      return `<li class="prediction-source"><span>${esc(p.label)}</span><span>${effort}</span></li>`;
    };
    const predictionBestReference = p => Number.isFinite(p.best_s) && p.best_s > 0
      ? `${esc(dur(p.best_s))}${Number.isInteger(p.best_year) ? ` · ${p.best_year}` : ''}`
      : null;
    pbox.innerHTML = f.predictions.length ? `<div class="card fitness-predictions">
        <h2>Race predictions</h2>
        <div class="pred">${f.predictions.map(p => { const best = predictionBestReference(p); return `<div class="prediction-cell">
          <small class="muted prediction-distance">${esc(p.label)}</small>
          <b class="num prediction-time">${dur(p.seconds)}</b>
          <small class="muted num prediction-pace">${esc(U.pace(p.seconds / p.distance_m * 1000))}${esc(U.pu())}</small>
          ${best ? `<small class="muted pbest prediction-best">Best ${best}</small>` : ''}
        </div>`; }).join('')}</div>
        <p class="small muted prediction-note">Estimates from current fitness, not target paces.</p>
        <details class="prediction-method"><summary>How estimates work</summary>
          <p class="small muted">Each estimate uses the recent effort from the past 90 days that best matches that race distance, plus your last 8 weeks of running mileage. Course, weather and race-day pacing aren’t included.</p>
          <div class="prediction-sources"><p class="small muted">Recent efforts used</p><ul>${f.predictions.map(predictionSourceDetail).join('')}</ul></div>
        </details></div>`
      : '<div class="card"><h2>Race predictions</h2><p class="muted">Run a mile or more in the last 90 days and predictions appear here.</p></div>';
    box.innerHTML = `<div class="card fitness-running"><div class="fitness-running-heading"><h2>Running fitness</h2><span class="rng" id="fi-range"></span></div>${f.vdot_months.length ? `<div class="bigstat">${stat('Run score · 90 days', f.vdot_now || '–')}${stat(R.from || R.to ? 'Best in range' : 'Best ever', ((v) => (v.length ? Math.max(...v).toFixed(1) : '–'))(f.vdot_months.filter((m) => inRange(R, +m.m.slice(0, 4))).map((m) => m.v)))}</div><div id="p-vdot"></div>
        <p class="small muted">Run score rates your best efforts of a mile or longer; higher means faster. It isn’t a measured VO₂max.</p>` : '<p class="muted">Needs runs of a mile or longer.</p>'}</div>
      <div class="card"><h2>Fitness, fatigue & form</h2>
      <div class="bigstat">${stat('Fitness', Math.round(last.fitness))}${stat('Form', (last.form > 0 ? '+' : '') + Math.round(last.form))}</div>
      <div id="p-load"></div><p class="small muted">Form is fitness (about 6 weeks of training) minus fatigue (the last week): above zero means fresh.</p></div>`;
    rangeBar($('#fi-range', box), R, f0.vdot_months.length ? +f0.vdot_months[0].m.slice(0, 4) : f0.days.length ? +f0.days[0].d.slice(0, 4) : nowY);
    requestAnimationFrame(() => {
      fitnessChart($('#p-load', box), 'Training load', (mount, height, options) => loadChart(mount, f.days, {height,...options}));
      if (f.vdot_months.length) fitnessChart($('#p-vdot', box), 'Monthly best run score', (mount, height, options) => {trendLine(mount, monthSeries(f.vdot_months[0].m, (m) => { const r = f.vdot_months.find((x) => x.m === m); return r ? {y: r.v} : {y: null}; }),
        {fmt: (v) => v.toFixed(1), rollName:'6-month average of monthly bests', color: 'brand', height, ...options, keep: (p) => inRange(R, p.d.getFullYear())});
        const key=$('.legend span:last-child',mount);if(key)key.lastChild.textContent='Monthly best';});
    });
  });
}
