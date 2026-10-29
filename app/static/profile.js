// Profile presentation is separate from audiences. Every number here is already filtered by the server.
'use strict';
const ProfileLayout=(()=>{
  const sections={recent:'Recent progress',mileage:'Distance chart',totals:'All-time totals',sports:'Sports',activities:'Activities'};
  const stats={activities:'Activities',distance:'Distance',time:'Time',active_days:'Active days'};
  const sports=['run','ride','walk','hike','swim','workout','row','ski','other'];
  const defaults=()=>({sections:Object.keys(sections),stats:['activities','distance','time'],sports:[]});
  function normalize(value){
    const d=defaults(),v=value||{};
    for(const [key,catalog] of [['sections',sections],['stats',stats],['sports',Object.fromEntries(sports.map(s=>[s,s]))]]){
      if(Array.isArray(v[key]))d[key]=[...new Set(v[key])].filter(k=>Object.hasOwn(catalog,k)).slice(0,key==='sections'?5:3);
    }
    if(!d.stats.length)d.stats=defaults().stats;
    return d;
  }
  function numbers(row,selected){
    return selected.map(key=>{
      if(key==='activities')return row.activities?stat('Activities',row.activities):'';
      if(key==='distance')return row.distance_m>0?stat('Distance',U.dist(row.distance_m,1),U.du()):'';
      if(key==='time')return row.time_s>0?stat('Time',dur(row.time_s,true)):'';
      return row.active_days?stat('Active days',row.active_days):'';
    }).join('');
  }
  function content(r,value=r.layout,{preview=false}={}){
    const layout=normalize(value),any=!!r.overview?.activities;
    return layout.sections.map(section=>{
      if(section==='recent'){
        if(!any||!r.recent)return '';
        const recent=r.recent,now=recent.current,figures=numbers(now,layout.stats);
        return `<section class="card profile-progress"><h2>Last 30 days</h2><p class="small muted">${esc(fdate(recent.start+'T12:00',{month:'short',day:'numeric'}))} – ${esc(fdate(recent.end+'T12:00',{month:'short',day:'numeric'}))}</p>${figures?`<div class="profile-stats">${figures}</div>`:'<p class="small muted">No recorded values for these statistics.</p>'}<p class="small muted">${now.active_days} active ${now.active_days===1?'day':'days'} · ${recent.previous.activities} activities in the previous 30 days</p></section>`;
      }
      if(section==='mileage')return any?'<section class="card profile-mileage" data-profile-mileage aria-label="Shared distance chart"></section>':'';
      if(section==='totals'){
        const figures=any?numbers(r.overview,layout.stats):'';
        return figures?`<section class="card"><h2>All-time shared progress</h2><div class="profile-stats">${figures}</div></section>`:'';
      }
      if(section==='sports'){
        const rows=layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(row=>row.sport===s)).filter(Boolean):(r.sports||[]);
        return rows.length?`<section class="card"><h2>Sports</h2><div class="sport-overview">${rows.map(s=>`<div class="row"><b>${esc(SPORT_NAMES[s.sport]||s.sport)}</b><span class="num">${s.activities} ${s.activities===1?'activity':'activities'} · ${s.distance_m>0?U.dist(s.distance_m)+' '+U.du():dur(s.time_s,true)}</span></div>`).join('')}</div></section>`:'';
      }
      return `<section class="profile-activities"><h2 class="sec-head">Shared activities</h2><div class="feed-list" id="${preview?'draft-activities':'person-activities'}">${r.items.length?r.items.map(a=>postCard(a)).join(''):`<div class="card empty"><b>No shared activities yet</b>${r.mine?'Choose an activity and change its audience to share it.' : 'No activities shared with you.'}${r.mine&&!preview?'<a class="ghost wide" href="/me/activities">Choose an activity</a>':''}</div>`}</div>${preview?'':`<button type="button" class="ghost wide" id="person-more"${r.next?'':' hidden'}>Show more</button>`}</section>`;
    }).join('');
  }
  function mount(box,r){
    const chart=box.querySelector('[data-profile-mileage]');
    if(chart)mileageChart(chart,r.mileage||{},'days',{shared:true});
    feedMaps(box);wireCheers(box);
  }
  function editor(box,initial,{onChange=()=>{}}={}){
    let value=normalize(initial),order=[...value.sections,...Object.keys(sections).filter(k=>!value.sections.includes(k))],changed=false;
    const status=$('[data-layout-status]',box);
    const announce=text=>{status.textContent=text;changed=true;onChange();};
    function draw(focus){
      $('[data-layout-sections]',box).innerHTML=order.map((key,i)=>`<div class="profile-layout-row"><label><input type="checkbox" data-section="${key}"${value.sections.includes(key)?' checked':''}>${sections[key]}</label><div><button type="button" class="icon-btn" data-move="${key}" data-step="-1" aria-label="Move ${sections[key]} up"${i?'':' disabled'}><span class="profile-up">${svg('down')}</span></button><button type="button" class="icon-btn" data-move="${key}" data-step="1" aria-label="Move ${sections[key]} down"${i===order.length-1?' disabled':''}>${svg('down')}</button></div></div>`).join('');
      $$('[data-section]',box).forEach(input=>input.onchange=()=>{value.sections=order.filter(key=>key===input.dataset.section?input.checked:value.sections.includes(key));announce('Profile sections updated.');});
      $$('[data-move]',box).forEach(button=>button.onclick=()=>{
        const i=order.indexOf(button.dataset.move),next=i+Number(button.dataset.step);if(next<0||next>=order.length)return;
        [order[i],order[next]]=[order[next],order[i]];value.sections=order.filter(k=>value.sections.includes(k));announce(`${sections[button.dataset.move]} moved ${button.dataset.step==='1'?'down':'up'}.`);draw({key:button.dataset.move,step:button.dataset.step});
      });
      if(focus){const button=$(`[data-move="${focus.key}"][data-step="${focus.step}"]`,box);(button.disabled?$(`[data-section="${focus.key}"]`,box):button).focus({preventScroll:true});}
    }
    function choices(key,catalog){
      const target=$(`[data-layout-${key}]`,box);
      target.innerHTML=Object.entries(catalog).map(([id,label])=>`<label class="profile-choice"><input type="checkbox" data-choice="${key}" value="${id}"${value[key].includes(id)?' checked':''}>${esc(label)}</label>`).join('');
      $$(`[data-choice="${key}"]`,box).forEach(input=>input.onchange=()=>{
        if(input.checked&&value[key].length>=3){input.checked=false;status.textContent='Choose up to three.';return;}
        if(!input.checked&&key==='stats'&&value.stats.length===1){input.checked=true;status.textContent='Keep at least one statistic.';return;}
        value[key]=input.checked?[...value[key],input.value]:value[key].filter(k=>k!==input.value);announce(`${key==='stats'?'Statistics':'Featured sports'} updated.`);
      });
    }
    function all(){draw();choices('stats',stats);choices('sports',Object.fromEntries(sports.map(s=>[s,SPORT_NAMES[s]||s])));}
    all();$('[data-layout-reset]',box).onclick=()=>{value=defaults();order=Object.keys(sections);announce('Default layout restored. Save to keep it.');all();};
    return {value:()=>structuredClone(value),changed:()=>changed};
  }
  const editorHtml=()=>`<details class="profile-layout"><summary>Profile content &amp; layout</summary><p class="small muted">Choose sections and order. Activity audiences stay the same.</p><fieldset><legend>Sections</legend><div data-layout-sections></div></fieldset><fieldset><legend>Statistics · choose up to 3</legend><div class="profile-choices" data-layout-stats></div></fieldset><fieldset><legend>Featured sports · up to 3</legend><p class="small muted">Leave clear to show all your sports.</p><div class="profile-choices" data-layout-sports></div></fieldset><button type="button" class="ghost wide" data-layout-reset>Restore default layout</button><p class="small muted" data-layout-status role="status" aria-live="polite"></p></details><button type="button" class="ghost wide" id="pf-preview-draft">Preview profile</button><section id="pf-draft" hidden></section>`;
  return {defaults,normalize,numbers,content,mount,editor,editorHtml};
})();
