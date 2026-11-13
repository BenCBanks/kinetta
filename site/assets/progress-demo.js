/* Self-mounting, fictional Home-page Progress chart. Include this file beside progress-demo.css. */
(() => {
  'use strict';

  const scriptUrl = document.currentScript?.src || new URL('assets/progress-demo.js', document.baseURI).href;
  const styleUrl = new URL('progress-demo.css', scriptUrl).href;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const sports = {
    run: {name:'Run', base:25, min:15, max:35, pace:9.4, season:[.88,.9,.95,1,1.04,1.08,1.08,1.05,1,.98,.92,.86],
      weights:[0,.14,.17,0,.17,.34,.18]},
    ride: {name:'Ride', base:88, min:40, max:150, pace:3.55, season:[.58,.64,.8,.96,1.1,1.2,1.28,1.22,1.08,.94,.72,.61],
      weights:[0,.17,.19,.14,0,.34,.16]},
    swim: {name:'Swim', base:5.1*1760, min:2*1760, max:8*1760, pace:18.4, unit:'yd', season:[.82,.85,.91,.97,1.07,1.18,1.23,1.2,1.12,1.02,.9,.84],
      weights:[.13,.18,0,.18,.15,.22,.14]}
  };
  const periods = {week:'Week',month:'Month',year:'Year'};
  let stylePromise;

  function hash(text) {
    let value=2166136261;
    for(let i=0;i<text.length;i++) value=Math.imul(value^text.charCodeAt(i),16777619);
    return value>>>0;
  }
  function random(seed) {
    let value=seed>>>0;
    return()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  }
  function rounded(value) { return Math.round(value*10)/10; }
  function clamp(value,low,high) { return Math.max(low,Math.min(high,value)); }
  function weekDate(index) { return new Date(Date.UTC(2025,0,6+index*7)); }
  function dayDate(index,day) { return new Date(weekDate(index).getTime()+day*86400000); }
  function shortDate(date) { return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`; }
  function weekName(index) { return `Week of ${shortDate(weekDate(index))}`; }
  function weeklySeries(sportKey) {
    const sport=sports[sportKey],rng=random(hash(`kinetta-demo-2025-${sportKey}`)),cycle=[.84,1.02,1.17,.76];
    return Array.from({length:52},(_,index)=>{
      const date=weekDate(index),season=sport.season[date.getUTCMonth()];
      const phase=1+Math.floor(index/4)*.025; // gradual training block build
      let miles=sport.base*cycle[index%cycle.length]*(.8+rng()*.4)*phase*season;
      if(index===20)miles*=.38;                 // One low illness/travel week.
      if(index===30)miles*=1.12;                // Build into the race block.
      if(index===31)miles*=1.32;                // Peak week before race.
      if(index===32)miles*=.58;                 // Taper after the peak.
      if(index!==20)miles=clamp(miles,sport.min,sport.max);
      return rounded(miles);
    });
  }
  function monthGroups(weekly) {
    const totals=Array(12).fill(0);
    weekly.forEach((value,index)=>{ totals[weekDate(index).getUTCMonth()]+=value; });
    return totals.map(rounded);
  }
  function weekDays(sportKey,weekTotal,weekIndex) {
    const rng=random(hash(`kinetta-days-${sportKey}-${weekIndex}`)),weights=sports[sportKey].weights.map(weight=>weight?weight*(.72+rng()*.56):0);
    const total=weights.reduce((sum,value)=>sum+value,0)||1;
    return weights.map(weight=>rounded(weekTotal*weight/total));
  }
  function periodRows(sportKey,period) {
    const weekly=weeklySeries(sportKey);
    if(period==='week'){
      const index=31,values=weekDays(sportKey,weekly[index],index);
      return values.map((value,i)=>({label:dayNames[i],longLabel:`${dayNames[i]}, ${shortDate(dayDate(index,i))}`,value}));
    }
    if(period==='month'){
      return weekly.slice(19,24).map((value,i)=>({label:`W${i+1}`,longLabel:weekName(19+i),value}));
    }
    return monthGroups(weekly).map((value,i)=>({label:monthNames[i],longLabel:`${monthNames[i]} 2025`,value}));
  }
  function formatDistance(value,sportKey) {
    const sport=sports[sportKey];
    return sportKey==='swim'?`${Math.round(value).toLocaleString('en-US')} yd`:`${rounded(value).toFixed(1)} ${sport.unit||'mi'}`;
  }
  function formatDuration(minutes) {
    const total=Math.max(0,Math.round(minutes)),hours=Math.floor(total/60),mins=total%60;
    return hours?`${hours}h ${String(mins).padStart(2,'0')}m`:`${mins}m`;
  }
  function niceTop(value) {
    const raw=Math.max(.1,value),power=Math.pow(10,Math.floor(Math.log10(raw))),scaled=raw/power;
    const step=scaled<=1?1:scaled<=2?2:scaled<=2.5?2.5:scaled<=5?5:10;
    return step*power;
  }
  function ensureStyles() {
    if(stylePromise)return stylePromise;
    stylePromise=new Promise((resolve,reject)=>{
      let link=document.querySelector('link[data-progress-demo-styles]');
      if(link?.dataset.loaded==='true'){resolve();return;}
      if(!link){link=document.createElement('link');link.rel='stylesheet';link.href=styleUrl;link.dataset.progressDemoStyles='';document.head.append(link);}
      link.addEventListener('load',()=>{link.dataset.loaded='true';resolve();},{once:true});
      link.addEventListener('error',()=>reject(new Error('Progress demo stylesheet failed to load')),{once:true});
    });
    return stylePromise;
  }
  function metricTween(node,target,formatter) {
    node._progressTween=(node._progressTween||0)+1;
    const token=node._progressTween,from=Number(node.dataset.value)||0,start=performance.now(),duration=360;
    node.dataset.value=String(target);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){node.textContent=formatter(target);return;}
    const tick=now=>{
      if(token!==node._progressTween)return;
      const t=clamp((now-start)/duration,0,1),eased=1-Math.pow(1-t,3);
      node.textContent=formatter(from+(target-from)*eased);
      if(t<1)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function mount(root) {
    if(!(root instanceof Element)||root.dataset.progressDemoMounted==='true')return Promise.resolve(false);
    root.dataset.progressDemoMounted='true';
    return ensureStyles().then(()=>{
      let sportKey='run',period='week',rows=[],selected=0,frame=0;
      root.innerHTML=`<section class="pchart" aria-label="Interactive training progress">
        <div class="pchart-controls">
          <div class="pchart-group" role="group" aria-label="Time range">
            ${Object.entries(periods).map(([key,label])=>`<button type="button" data-period="${key}" aria-pressed="${key==='week'}">${label}</button>`).join('')}
          </div>
          <div class="pchart-group pchart-sports" role="group" aria-label="Sport">
            ${Object.entries(sports).map(([key,sport])=>`<button type="button" data-sport="${key}" aria-pressed="${key==='run'}">${sport.name}</button>`).join('')}
          </div>
        </div>
        <div class="pchart-summary">
          <p class="pchart-context" data-context aria-live="polite"></p>
          <dl class="pchart-metrics">
            <div><dt>Total</dt><dd><span data-total data-value="0">0.0 mi</span></dd></div>
            <div><dt>Moving time</dt><dd><span data-time data-value="0">0m</span></dd></div>
            <div><dt>Best effort</dt><dd><span data-best data-value="0">0.0 mi</span><small data-best-label></small></dd></div>
          </dl>
        </div>
        <div class="pchart-legend" aria-hidden="true"><span>Distance · miles</span><span data-average-label></span></div>
        <div class="pchart-plot-grid">
          <div class="pchart-axis" data-axis aria-hidden="true"></div>
          <div class="pchart-plot" data-plot role="group" aria-label="Distance by ${period}">
            <div class="pchart-average" data-average aria-hidden="true"><span>Average</span></div>
            <div class="pchart-bars" data-bars></div>
          </div>
        </div>
        <div class="pchart-labels" data-labels aria-hidden="true"></div>
      </section>`;
      const controls=root.querySelector('.pchart-controls'),bars=root.querySelector('[data-bars]');
      function setSelected(index) {
        selected=clamp(index,0,rows.length-1);
        bars.querySelectorAll('[data-bar]').forEach((button,i)=>{
          const active=i===selected;button.classList.toggle('is-selected',active);button.setAttribute('aria-pressed',String(active));
        });
        const row=rows[selected];
        root.querySelector('[data-context]').textContent=`${row.longLabel} · ${sports[sportKey].name} · ${formatDistance(row.value,sportKey)}`;
      }
      function render(animate=true) {
        rows=periodRows(sportKey,period);selected=rows.reduce((best,row,index)=>row.value>rows[best].value?index:best,0);
        const values=rows.map(row=>row.value),sum=values.reduce((a,b)=>a+b,0),average=sum/values.length,max=Math.max(...values),top=niceTop(max);
        const best=rows.reduce((a,b)=>b.value>a.value?b:a,rows[0]),sport=sports[sportKey];
        root.querySelector('[data-plot]').setAttribute('aria-label',`${sport.name} distance by ${period}`);
        const totalNode=root.querySelector('[data-total]'),timeNode=root.querySelector('[data-time]'),bestNode=root.querySelector('[data-best]');
        const distanceFormatter=value=>formatDistance(value,sportKey);
        const distancePerMile=sportKey==='swim'?1760:1;
        metricTween(totalNode,sum,distanceFormatter);metricTween(timeNode,sum/distancePerMile*sport.pace,formatDuration);metricTween(bestNode,best.value,distanceFormatter);
        root.querySelector('[data-best-label]').textContent=best.longLabel;
        root.querySelector('.pchart-legend span:first-child').textContent=`Distance · ${sport.unit||'miles'}`;
        root.querySelector('[data-average-label]').textContent=`Average ${formatDistance(average,sportKey)}`;
        const ticks=[top,top/2,0];root.querySelector('[data-axis]').innerHTML=ticks.map((tick,i)=>`<span class="pchart-tick pchart-tick-${i}">${rounded(tick).toFixed(tick%1?1:0)}</span>`).join('');
        root.querySelector('[data-average]').style.bottom=`${clamp(average/top*100,0,100)}%`;
        const start=++frame,plot=root.querySelector('[data-plot]'),plotHeight=plot.clientHeight||1;
        const previousHeights=[...bars.querySelectorAll('.pchart-fill')].map(fill=>fill.getBoundingClientRect().height/plotHeight*100);
        bars.style.setProperty('--bar-count',String(rows.length));
        bars.innerHTML=rows.map((row,index)=>`<button type="button" class="pchart-bar" data-bar="${index}" data-value="${row.value}" aria-label="${row.longLabel}: ${formatDistance(row.value,sportKey)}" aria-pressed="false"><span class="pchart-fill" style="height:${previousHeights[index]||0}%"></span></button>`).join('');
        root.querySelector('[data-labels]').style.setProperty('--bar-count',String(rows.length));
        root.querySelector('[data-labels]').innerHTML=rows.map(row=>`<span>${row.label}</span>`).join('');
        if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
          bars.offsetHeight;
          requestAnimationFrame(()=>{if(start!==frame)return;bars.querySelectorAll('[data-bar]').forEach((button,index)=>button.querySelector('.pchart-fill').style.height=`${clamp(values[index]/top*100,0,100)}%`);});
        }else bars.querySelectorAll('[data-bar]').forEach((button,index)=>button.querySelector('.pchart-fill').style.height=`${clamp(values[index]/top*100,0,100)}%`);
        setSelected(selected);
      }
      controls.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button)return;
        if(button.dataset.period){period=button.dataset.period;controls.querySelectorAll('[data-period]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));render();}
        if(button.dataset.sport){sportKey=button.dataset.sport;controls.querySelectorAll('[data-sport]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));render();}
      });
      bars.addEventListener('pointerover',event=>{if(event.pointerType==='mouse'){const button=event.target.closest('[data-bar]');if(button)setSelected(Number(button.dataset.bar));}});
      bars.addEventListener('focusin',event=>{const button=event.target.closest('[data-bar]');if(button)setSelected(Number(button.dataset.bar));});
      bars.addEventListener('click',event=>{const button=event.target.closest('[data-bar]');if(button)setSelected(Number(button.dataset.bar));});
      render(false);
      return true;
    }).catch(error=>{root.dataset.progressDemoMounted='error';throw error;});
  }
  window.KinettaProgressDemo={mount,version:'1'};
  const boot=()=>document.querySelectorAll('#progress-demo [data-progress-demo-mount]').forEach(root=>{mount(root).catch(error=>console.error(error));});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
