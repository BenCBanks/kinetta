// Kinetta phone app — Progress home route leaf. Loaded only for the Progress home and matched-route detail.
'use strict';

// ---------- Matched route ----------
function matchedRouteTrendHeadline(trend, points, foot) {
  const perMonth = trend ? Number(trend.slope_per_day) * 30 : null;
  if (!Number.isFinite(perMonth) || Math.abs(perMonth) < 1) return '';
  let amount;
  if (foot) {
    amount = Math.round(Math.abs(imp() ? perMonth * MI / 1000 : perMonth));
  } else {
    const avgPace = points.length ? points.reduce((sum, point) => sum + point.y, 0) / points.length : null;
    if (!(avgPace > Math.abs(perMonth))) return '';
    amount = Math.abs(1000 / (avgPace + perMonth) - 1000 / avgPace);
  }
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const change = foot ? `${amount} s${U.pu()}` : `${U.speed(amount)} ${U.su()}`;
  if (/^0(?:\.0+)?(?:\s|$)/.test(change)) return '';
  return `${perMonth < 0 ? 'Getting faster' : 'Getting slower'}: about ${change} per month on this route.`;
}
function routeActivityRate(a,sport) {
  const value=rate({...a,sport});return value.label==='Time'?'–':value.v+value.u;
}
route(/^\/route\/(\d+)$/, 'progress', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Routes')}</div>${skel(1)}<div class="sk block"></div>${skel(1)}`;
  wireBack(el, '/progress/routes');
  await load(`/api/routes/${id}`, (r) => {
    const acts = r.activities, foot = FOOT.includes(r.sport) || r.sport === 'walk';
    const pts = acts.filter((a) => a.elapsed_s > 0 && a.distance_m > 0).map((a) => ({x: new Date(a.start_time) / 864e5, y: a.elapsed_s / a.distance_m * 1000, id: a.id}));
    const t = r.pace_trend, e = r.efficiency_trend;
    let headline = matchedRouteTrendHeadline(t, pts, foot);
    if (e && t) { const effUp = e.slope_per_day > 0; headline += ` Recorded distance per heartbeat ${e.slope_per_day===0?'is unchanged':effUp?'increased':'decreased'}. Conditions and recording differences can affect this.`; }
    const best = acts.find((a) => a.id === r.fastest_id);
    const knownTimes=acts.filter(a=>a.elapsed_s>0),average=knownTimes.length===acts.length&&acts.length?dur(knownTimes.reduce((s,a)=>s+a.elapsed_s,0)/knownTimes.length):'–';
    el.innerHTML = `<div class="top">${backBtn('Routes')}<button class="icon-btn" id="r-edit" aria-label="Rename route">${svg('edit')}</button></div>
      <div class="card"><h1>${esc(r.name)}</h1><p class="muted">${acts.length} times · ${SPORT_NAMES[r.sport] || 'Activity'} · first ${esc(fdate(acts[0].start_time, {month: 'short', year: 'numeric'}))}</p>
        <div class="hero">${stat('Best', best&&best.elapsed_s>0?dur(best.elapsed_s):'–')}${stat('Average', average)}${stat('Distance', U.dist(acts[0].distance_m), U.du())}</div></div>
      ${r.line ? '<div class="map" id="r-map"></div>' : ''}
      <div class="card"><h2>${foot ? 'Pace' : 'Speed'} over time</h2>${headline ? `<div class="callout">${esc(headline)}</div>` : ''}<div id="r-chart"></div>
        <div class="badges"><span class="badge"><span class="route-fastest-key" aria-hidden="true">●</span> Fastest</span><span class="badge">- - Trend</span></div></div>
      <div class="card"><h2>Every time</h2>${[...acts].reverse().map((a) => `<a class="row-link" href="/activity/${a.id}" data-prefetch="/api/activities/${a.id}">
        <div><b>${a.id === r.fastest_id ? '<span class="badge pr">' + svg('trophy') + ' Fastest</span> ' : ''}${esc(fdate(a.start_time, {month: 'short', day: 'numeric', year: 'numeric'}))}</b><br><small class="muted">${esc(a.name)}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}${a.avg_temp != null ? ' · ' + U.temp(a.avg_temp) : ''}</small></div>
        <div class="r"><b class="num">${a.elapsed_s>0?dur(a.elapsed_s):'–'}</b><br><small class="muted num">${routeActivityRate(a,r.sport)}</small></div></a>`).join('')}</div>`;
    wireBack(el, '/progress/routes');
    requestAnimationFrame(() => dotChart($('#r-chart', el), pts, {yfmt: (v) => (foot ? U.pace(v) : U.speed(1000 / v)), invert: true, trend: t, best: r.fastest_id}));
    if (r.line) lazy($('#r-map', el), () => mapInto($('#r-map', el), [r.line], {sport: r.sport}).catch(() => {}));
    $('#r-edit', el).onclick = () => sheet('Rename route', `<form class="form"><label>Name<input name="name" value="${esc(r.name)}" maxlength="120" enterkeyhint="done"></label>
      <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (b, close) => {
      $('form', b).onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/api/routes/${id}`, json('PATCH', {name: $('input', b).value})); invalidate('/api/'); close(); render(); } catch (x) { toast(x.message); } };
    });
  });
});

async function pMileage(body, q, {home=false}={}) {
  const sport = q.get('sport') || 'run', period = q.get('period') || 'week';
  const metric = progressMetricForSport(sport, q.get('metric') || 'distance'), paceMetric = metric === 'pace' || metric === 'speed';
  const R = {from: null, to: null}, scoped = false;   // Totals: the period sets how far back (date ranges live on Year over year)
  let restoreTableFocus=body.contains(document.activeElement)&&document.activeElement?.matches('[data-progress-view="table"]');
  body._hideProgressFilters=false;
  body.innerHTML = `<div id="m-body">${skelChart()}</div>`;   // Weeks / Months / Years: the button in the row at the top
  await load(`/api/progress/volume?period=${period}`, (r) => {
    const box = $('#m-body', body); if (!box) return;
    const keys = sport === 'all' ? VKEYS : VKEYS.filter((k) => k.k === sport);
    const by = {}; for (const x of r.rows) { const o = by[x.p] = by[x.p] || {}; o[x.s] = x; }
    if (!r.rows.length) { const empty = metric === 'pace' ? 'average pace' : metric === 'speed' ? 'average speed' : metric;
      body._hideProgressFilters=home;
      if (home) body._progressFilters?.remove();
      box.innerHTML = home ? `<div class="card empty"><p class="small muted">No activities yet. Your ${empty} totals appear here.</p></div>` : `<div class="card empty"><b>No activities yet</b>Your ${empty} totals by week, month and year show up here.${startCta()}</div>`;
      $('.totals-view-toggle',body)?.remove();return; }
    // every period from the first activity to today
    const today = new Date(r.today + 'T12:00'), first = new Date(r.rows[0].p + 'T12:00'), all = [];
    const start = (d) => { const x = new Date(d); if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); else if (period === 'month') x.setDate(1); else { x.setMonth(0); x.setDate(1); } return x; };
    for (let d = start(first); d <= today; ) { all.push(new Date(d)); if (period === 'week') d.setDate(d.getDate() + 7); else if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1); }
    const val = (d, f = 'd') => { const o = by[ymd(d)] || {}; return keys.reduce((s, k) => s + Number((o[k.k] || {})[f] || 0), 0); };
    const metricValue = d => { const distance = val(d, paceMetric ? 'pace_d' : 'd'), time = val(d, paceMetric ? 'pace_t' : 't');
      if (metric === 'distance') return toU(distance);
      if (metric === 'time') return time;
      return metric === 'speed' ? (time > 0 ? distance / time : 0) : (distance > 0 ? time / (distance / 1000) : 0);
    };
    const label = d => progressPeriodLabel(d, period);
    const show = scoped ? all.filter((d) => inRange(R, d.getFullYear())) : period === 'week' ? all.slice(-26) : period === 'month' ? all.slice(-24) : all;
    // A short history still draws normal-width bars (2026-10-18 UI pass): one first week was one bar across the whole
    // chart. Earlier empty periods are added to the chart only; averages and bests still use real periods.
    const minCols = {week: 8, month: 6, year: 4}[period];
    const chartDays = [...show];
    while (!scoped && chartDays.length && chartDays.length < minCols) {
      const d = new Date(chartDays[0]);
      if (period === 'week') d.setDate(d.getDate() - 7); else if (period === 'month') d.setMonth(d.getMonth() - 1); else d.setFullYear(d.getFullYear() - 1);
      chartDays.unshift(d);
    }
    if (!show.length) { box.innerHTML = '<div class="card empty"><b>Nothing in this range</b>Pick other years above.</div>'; return; }
    const pacePeriods = period === 'year' ? all : all.slice(-12), chartPeriods = paceMetric ? pacePeriods : chartDays;
    const shownDays=new Set(show.map(ymd));
    const cols = chartDays.map((d, i) => {
      const prev = chartDays[i - 1], tick = period === 'year' ? progressPeriodTick(d, period)
        : period === 'month' ? (d.getMonth() % 3 === 0 ? progressPeriodTick(d, period) : '')
        : (!prev || prev.getMonth() !== d.getMonth()) ? progressPeriodTick(d, period) : '';
      return {d, label: label(d), tick, tickLabel: progressPeriodTick(d, period), padded:!shownDays.has(ymd(d)), partial: i === chartDays.length - 1, segs: keys.map((k) => ({k: k.k, v: metric === 'time' ? Number(((by[ymd(d)] || {})[k.k] || {}).t || 0) : toU(Number(((by[ymd(d)] || {})[k.k] || {}).d || 0))}))};
    });
    const complete = all.slice(0, -1), recent = scoped ? show.filter((d) => d < all[all.length - 1]) : period === 'week' ? complete.slice(-52) : period === 'month' ? complete.slice(-12) : complete;
    const avg = paceMetric ? null : recent.length ? recent.reduce((s, d) => s + metricValue(d), 0) / recent.length : null;
    const pool = scoped ? show : all, entries = pool.map(d => ({d, value: metricValue(d)})).filter(x => x.value > 0);
    const bestEntry = entries.reduce((b, x) => !b || (paceMetric ? metric === 'speed' ? x.value > b.value : x.value < b.value : x.value > b.value) ? x : b, null);
    const rangeName = scoped ? (R.from === R.to ? String(R.from) : `${R.from || 'start'}–${R.to || 'now'}`) : '';
    const word = {week: 'week', month: 'month', year: 'year'}[period];
    const fmt = metric === 'distance' ? (v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${U.du()}` : metric === 'time' ? U.time : metric === 'speed' ? (v) => `${U.speed(v)} ${U.su()}` : (v) => `${U.pace(v)} ${U.pu()}`;
    const cur = all[all.length - 1], last = all[all.length - 2];
    const defaultPeriodLabel = 'This ' + word;
    const focusTable=restoreTableFocus||(body.contains(document.activeElement)&&document.activeElement?.matches('[data-progress-view="table"]'));restoreTableFocus=false;
    const displayValue = value => metric === 'distance' ? value.toFixed(1) : metric === 'time' ? (value ? U.time(value) : '–') : value ? (metric === 'speed' ? U.speed(value) : U.pace(value)) : '–';
    const statUnit = metric === 'distance' ? U.du() : metric === 'pace' ? U.pu() : metric === 'speed' ? U.su() : '';
    let avgValue = avg, bestValue = bestEntry?.value ?? null;
    if (paceMetric) {
      const distance = chartPeriods.reduce((n, d) => n + val(d, 'pace_d'), 0), time = chartPeriods.reduce((n, d) => n + val(d, 'pace_t'), 0);
      avgValue = metric === 'speed' ? (time > 0 ? distance / time : null) : (distance > 0 ? time / (distance / 1000) : null);
      const shown = chartPeriods.map(metricValue).filter(v => v > 0);
      bestValue = shown.length ? metric === 'speed' ? Math.max(...shown) : Math.min(...shown) : null;
    }
    const averageLabel = paceMetric
      ? {week: '12-wk avg', month: '12-mo avg', year: 'Year avg'}[period]
      : {week: 'Weekly avg', month: 'Monthly avg', year: 'Yearly avg'}[period];
    const bestLabel = paceMetric ? `Fastest ${word}` : `Best ${word}`;
    const table = metric === 'distance' || metric === 'time';
    const chartLabel = `${metric === 'speed' ? 'Average speed' : metric === 'pace' ? 'Average pace' : metric === 'time' ? 'Moving time' : 'Distance'} by ${period}`;
    box.innerHTML = `<div class="card"><div class="stats3 progress-total-stats">
        ${stat(defaultPeriodLabel, displayValue(metricValue(cur)), statUnit)}
        ${home&&avgValue==null?'':stat(averageLabel, avgValue == null ? '–' : displayValue(avgValue), statUnit).replace('class="stat"','class="stat progress-average"')}
        ${stat(bestLabel + (scoped ? ' (range)' : ''), bestValue == null ? '–' : displayValue(bestValue), statUnit)}</div>
        ${paceMetric ? `<p class="small muted progress-pace-window">${period === 'week' ? 'Weekly averages · last 12 weeks' : period === 'month' ? 'Monthly averages · last 12 months' : 'Yearly averages'}</p>` : home?'':`<p class="small muted">${last ? `Last ${word}: ${esc(fmt(metricValue(last)))} · ` : ''}best ${esc(label(bestEntry?.d || cur).replace('Week of ', 'week of '))}</p>`}
        <div class="totals-display"><div id="m-chart"${body._showTable?' hidden':''}></div>${table?`<div id="m-table" class="tbl-wrap"${body._showTable?'':' hidden'}><table class="tbl"><thead><tr><th>${period === 'week' ? 'Week of' : period === 'month' ? 'Month' : 'Year'}</th><th class="r">Distance ${U.du()}</th><th class="r">Moving time h/m/s</th><th class="r">Workouts</th><th class="r">Climb ${U.eu()}</th></tr></thead><tbody>
        ${[...show].reverse().map((d) => `<tr><td>${esc(progressTableLabel(d, period))}</td>
          <td class="r num">${toU(val(d)).toFixed(1)}</td><td class="r num">${val(d, 't') ? U.time(val(d, 't')) : '–'}</td><td class="r num">${val(d, 'n')}</td><td class="r num">${val(d, 'a') ? U.elev(val(d, 'a')) : '–'}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div>`;
    requestAnimationFrame(() => {
      const header = $('.progress-totals-header', body);
      if (home && table && header && !$('.totals-view-toggle', header)) {
        header.insertAdjacentHTML('beforeend', `<div class="totals-view-toggle" role="group" aria-label="Totals view"><button type="button" data-progress-view="chart" aria-pressed="${!body._showTable}" aria-controls="m-chart m-table">Chart</button><button type="button" data-progress-view="table" aria-pressed="${body._showTable === true}" aria-controls="m-chart m-table">Table</button></div>`);
      }
      if (paceMetric) {
        const points = chartPeriods.map(d => { const value = metricValue(d); return value > 0 ? {x: new Date(d).getTime() / 864e5, y: value, value, periodLabel: period === 'week' ? `Week of ${d.getDate()} ${d.toLocaleDateString([], {month: 'short'})}` : label(d), current: period === 'week' && ymd(d) === ymd(cur)} : null; }).filter(Boolean);
        const chart = $('#m-chart', box);
        dotChart(chart, points, {yfmt: v => metric === 'speed' ? U.speed(v) : U.pace(v), invert: metric === 'pace', line: true, height: home ? 150 : 180});
        const svgChart = $('#m-chart svg', box);
        if (svgChart) {
          svgChart.setAttribute('role', 'group');
          svgChart.setAttribute('aria-label', `${chartLabel}; ${period === 'week' ? 'last 12 weeks' : period === 'month' ? 'last 12 months' : 'all recorded years'}. Select a point to inspect its value.`);
          const dots = [...svgChart.querySelectorAll('.dotp')];
          if (dots.length) {
            const readout = document.createElement('div');
            readout.className = 'readout num progress-total-readout progress-dot-readout';
            readout.setAttribute('role', 'status'); readout.setAttribute('aria-live', 'polite'); readout.setAttribute('aria-atomic', 'true');
            readout.hidden = true;
            chart.append(readout);
            let selected = null;
            const show = index => {
              const point = index == null ? null : points[index];
              readout.hidden = !point;
              readout.innerHTML = point ? `<span>${point.periodLabel} · <b>${esc(displayValue(point.value))}</b>${statUnit ? ` ${esc(statUnit)}` : ''}</span>` : '';
              dots.forEach((dot, i) => {
                dot.setAttribute('aria-pressed', String(i === selected));
                dot.setAttribute('aria-label', `${points[i].periodLabel}: ${displayValue(points[i].value)}${statUnit ? ` ${statUnit}` : ''}`);
                dot.setAttribute('r', i === selected ? '7' : (dot.dataset.baseRadius || dot.getAttribute('r')));
              });
            const ringDot = dots[selected ?? points.findIndex(point => point.current)], ring = svgChart.querySelector('.progress-current-dot-ring'); if (ringDot && ring) { ring.setAttribute('cx', ringDot.getAttribute('cx')); ring.setAttribute('cy', ringDot.getAttribute('cy')); svgChart.append(ring); }
            };
            const choose = index => { selected = selected === index ? null : index; show(selected); };
            dots.forEach((dot, i) => {
              dot.dataset.baseRadius = dot.getAttribute('r');
              dot.setAttribute('role', 'button'); dot.setAttribute('tabindex', '0'); dot.setAttribute('aria-pressed', 'false');
              if (points[i].current) {
                dot.classList.add('progress-current-dot');
                dot.setAttribute('r', '5.5'); dot.dataset.baseRadius = '5.5';
                const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                ring.setAttribute('class', 'progress-current-dot-ring');
                ring.setAttribute('cx', dot.getAttribute('cx')); ring.setAttribute('cy', dot.getAttribute('cy'));
                ring.setAttribute('r', '8'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'var(--accent)');
                ring.setAttribute('stroke-width', '1.5'); ring.setAttribute('pointer-events', 'none'); ring.setAttribute('aria-hidden', 'true');
                svgChart.append(ring);
              }
              dot.onkeydown = e => {
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? dots.length - 1 : e.key === 'ArrowRight' ? Math.min(dots.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : null;
                if (next != null) { e.preventDefault(); dots[next].focus({preventScroll: true}); }
                else if (['Enter', ' '].includes(e.key)) { e.preventDefault(); choose(i); }
                else if (e.key === 'Escape') { e.preventDefault(); selected = null; show(null); }
              };
            });
            const nearest = e => {
              const matrix = svgChart.getScreenCTM(), rect = svgChart.getBoundingClientRect();
              if (!matrix || !rect.width) return null;
              const pointer = svgChart.createSVGPoint(); pointer.x = e.clientX; pointer.y = e.clientY;
              const local = pointer.matrixTransform(matrix.inverse()), radius = 22 * svgChart.viewBox.baseVal.width / rect.width;
              let best = null;
              dots.forEach((dot, i) => {
                const dx = local.x - Number(dot.getAttribute('cx')), dy = local.y - Number(dot.getAttribute('cy')), distance = Math.hypot(dx, dy);
                if (distance <= radius && (!best || distance < best.distance)) best = {index: i, distance};
              });
              return best?.index ?? null;
            };
            svgChart.addEventListener('click', e => {
              const target = e.target.closest?.('.dotp[role="button"]'), index = target ? dots.indexOf(target) : nearest(e);
              if (index != null && index >= 0) choose(index);
              if (target && document.activeElement === target) target.blur();
            });
            show(null);
          }
        }
      } else {
        periodBars($('#m-chart', box), cols, {keys, fmt, yfmt: metric === 'time' ? progressAxisTime : v => String(+v.toFixed(2)), step: metric === 'time' ? progressTimeStep : undefined, axisUnit:metric==='distance'?U.du():'', yTicks:3, avg, avgLabel: period === 'year' ? 'Yearly average' + (scoped ? ` (${rangeName})` : '') : `Average ${period} (${scoped ? rangeName : 'last 12 months'})`, avgLineLabel: avg>0?`avg ${fmt(avg)}`:'', ariaLabel:`${chartLabel}. Select a bar for its period total.`, readoutHint:`Tap a bar for that ${word}’s total`, height:home?165:190, distance:sport==='all'&&metric==='distance', inlineSelection:true});
      }
      if(focusTable&&body.isConnected&&document.activeElement===document.body)$('[data-progress-view="table"]',body)?.focus({preventScroll:true});
    });
  });
}

async function progressHome(el, q) {
  App.progressHome={owner:readOwner(),href:location.pathname+location.search};
  const sport = pSport(q), period = PPERIODS.some(p=>p[0]===q.get('period')) ? q.get('period') : 'week';
  const viewSport=forView(sport,'totals'),metric=progressMetricForSport(viewSport,q.get('metric')||'distance');
  let showTable=false;try{showTable=localStorage.getItem('fit.ptable')==='true';}catch(e){/* no storage */}
  const showTableToggle=metric==='distance'||metric==='time';
  el.innerHTML = `<div class="top progress-heading"><h1>Progress</h1><div class="acts">${bellBtn()}</div></div>
    <div class="progress-home"><div id="p-combined-week"></div><div id="p-home-totals" class="progress-home-totals">${skelChart()}</div>
    <div class="progress-pair"><a class="card progress-summary" href="/progress?view=fitness"><h2>${svg('flame')}Fitness</h2><span data-progress-fitness class="small muted">Form and race estimates →</span></a>
    <a class="card progress-summary" href="/progress?view=records"><h2>${svg('trophy')}Records</h2><span data-progress-record class="small muted">Your fastest times, after a timed run</span></a></div>
    <h2 class="sec-head">Explore your progress</h2><div class="progress-grid explore-list" id="p-explore"></div>
    ${foodUser()?'<a class="card progress-food-summary" href="/food?view=overview&from=progress"><h2>Food &amp; weight '+svg('chev')+'</h2><span class="small muted" data-progress-food>See your protein goals and weight trend →</span></a>':''}</div>`;
  wireProgressFocus(el); wireProgressPeriods(el);
  Discovery.wire($('#p-explore',el),'progress',{attribute:'data-progress-feature'});
  const totals=$('#p-home-totals',el), grid=$('#p-explore',el); progressTiles(grid);totals._showTable=showTableToggle&&showTable;
  progressFilters(el,totals,`<div class="progress-totals-header"><h2 class="progress-totals-title">Totals</h2>${sportBtn(viewSport)}</div>${progressPeriods(period)}${progressMetrics(viewSport,metric)}`);
  wireSport(el,viewSport);
  q.set('sport',viewSport);q.set('period',period);if(q.has('metric'))q.set('metric',metric);
  if ($('#p-combined-week',el)) combinedWeek($('#p-combined-week',el));
  const owner=readOwner(), valid=()=>el.isConnected&&owner===readOwner();
  await Promise.allSettled([
    pMileage(totals,q,{home:true}).catch(()=>{if(valid())totals.innerHTML='<div class="card empty">Distance by week, month and year →</div>';}),
    load('/api/progress/overview',o=>{
      if(!valid())return; progressTiles(grid,o,{ready:true});
      const r=o.record;if(r)$('[data-progress-record]',el).innerHTML=`<b>${esc(r.label)} · ${esc(dur(r.elapsed_s))}</b><small>${esc(fdate(r.start_time,{month:'short',day:'numeric',year:'numeric'}))}</small>`;
      const food=$('[data-progress-food]',el);if(food){const f=o.food,delta=f.weight_change_kg;
        food.textContent=(f.protein_days===null?'Set a protein goal to track your week':`Protein goal ${f.protein_days} of 7 days`)+(delta===null?'':` · weight ${delta>0?'+':delta<0?'−':''}${U.weight(Math.abs(delta))} ${imp()?'lb':'kg'}`);}
    }).catch(()=>{if(valid())progressTiles(grid,null,{ready:true});}),
    load('/api/fitness?days=60',f=>{
      if(!valid())return;const last=f.days.at(-1),p=f.predictions[0];
      if(last&&f.days.some(d=>d.fitness>0))$('[data-progress-fitness]',el).innerHTML=`<b>${last.form>5?'Fresh':last.form< -15?'Tired':'Training steadily'}</b>${p?`<small>${esc(p.label)} estimate ${esc(dur(p.seconds))}</small>`:''}`;
      else if(p)$('[data-progress-fitness]',el).innerHTML=`<b>${esc(p.label)} · ${esc(dur(p.seconds))}</b><small>Race estimate</small>`;
    }).catch(()=>{})
  ]);
}
route(/^\/progress$/, 'progress', async (el) => {
  const q = new URLSearchParams(location.search);
  if (q.get('section') === 'food') return foodProgress(el,q);
  if (!q.has('view')) return progressHome(el,q);
  const v0 = q.get('view') || 'totals';
  if(['totals','mileage'].includes(v0)||!PVIEWS.some(p=>p[0]===v0)&&!PMORE.some(m=>progressItemEnabled(m)&&m[0]===v0)){q.delete('view');return go('/progress'+(q.size?'?'+q:''),{replace:true});}
  if (v0 === 'plan') return go('/plan', {replace: true});
  if (PMORE.some((m) => m[0] === v0)) { q.delete('view'); return go(`/progress/${v0}${q.toString() ? '?' + q : ''}`, {replace: true}); }   // old addresses
  const view = v0 === 'mileage' ? 'totals' : PVIEWS.some((p) => p[0] === v0) ? v0 : 'totals', sport = pSport(q);
  const period = PPERIODS.some((p) => p[0] === q.get('period')) ? q.get('period') : 'week';
  pHead(el, view, view === 'lifting' || view === 'fitness' ? ''
    : sportBtn(forView(sport, view)) + (view === 'totals' ? progressPeriods(period) : ''));
  wireSport(el, sport);
  wireProgressPeriods(el);
  q.set('sport', forView(sport, view)); q.set('period', period);
  await ({totals: pMileage, fitness: pFitness, records: pRecords, lifting: pLifting}[view])($('#p-body', el), q);
});
