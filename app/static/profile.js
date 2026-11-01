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
  // Thousands separators (Ben, 30 Oct 2026: "3044" and "11784 mi" read poorly); 100+ hours drop the minutes.
  const big=n=>Number(n).toLocaleString();
  const distance=m=>{const v=U.dist(m,1),n=Number(v);return n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:1}):v;};
  const hours=s=>s>=360000?`${big(Math.floor(s/3600))}h`:dur(s,true);
  function numbers(row,selected){
    return selected.map(key=>{
      if(key==='activities')return row.activities?stat('Activities',big(row.activities)):'';
      if(key==='distance')return row.distance_m>0?stat('Distance',distance(row.distance_m),U.du()):'';
      if(key==='time')return row.time_s>0?stat('Time',hours(row.time_s)):'';
      return row.active_days?stat('Active days',big(row.active_days)):'';
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
  return {defaults,normalize,numbers,content,mount,distance,hours,labels:{sections,stats},sports};
})();

// Me leads with the card friends see, then a private dashboard (owner-approved mockup, 29 October 2026). The card uses the
// same server-filtered friend preview as the shared profile; Edit changes its sections in place.
const MeCard=(()=>{
  const firstName=me=>(me.name||'').trim().split(/\s+/)[0]||me.login;
  const short=d=>fdate(d+'T12:00',{month:'short',day:'numeric'});
  // The card itself, shared by Me and every profile page (Ben, 30 Oct 2026: the full profile is this card at full size,
  // then the shared activities). Friends shares the handle row without changing its audience or destination.
  function card(p,{mine=false,pills='',friends='',link=false}={}){
    const bio=(p.bio||'').trim(),photo=avatar(p,'lg');
    return `<section class="me-card" aria-label="${mine?'Your profile card':esc(p.name||p.login)+'’s profile card'}"><div class="me-card-banner">${pills}</div>
      <div class="me-card-body"><div class="me-card-id">${link?`<a class="me-card-avatar" href="${profileHref(p)}" aria-label="View your shared profile">${photo}</a>`:`<span class="me-card-avatar">${photo}</span>`}<div class="me-card-name"><h2>${esc(p.name||p.login)}</h2><div class="me-card-meta"><span data-type="secondary">@${esc(p.login)}</span>${friends}</div></div></div>
        ${bio?bio.length>140?`<details class="me-about"><summary>About me</summary><p>${esc(bio)}</p></details>`:`<p class="me-profile-bio">${esc(bio)}</p>`:''}
        <div class="me-card-sections" aria-busy="true">${skel(1)}</div>
        ${mine?`<p class="me-card-note">${svg('lock')}<span>Friends see this card. Private workouts count in totals, never in detail.</span></p>`:''}</div></section>`;
  }
  const ownPills=()=>`<button type="button" class="me-card-pill" data-card-edit>${svg('edit')}Edit</button><button type="button" class="me-card-pill" data-card-share aria-label="Share your profile">${svg('share')}</button>`;
  function ownFriends(count){
    const pending=Number.isInteger(App.me.friend_requests)?App.me.friend_requests:0;
    return `<a class="me-friends-link" href="/me/friends"><span class="me-friends-count"><span data-friend-count>${Number.isInteger(count)?friendCountText(count):'Friends'}</span>${svg('chev')}</span><span class="badge alert" data-friend-waiting${pending?'':' hidden'}>${pending} waiting</span></a>`;
  }
  function header(me){
    return `<header class="me-top"><h1>Hi, ${esc(firstName(me))}</h1><div class="me-profile-tools">${bellBtn()}<a class="icon-btn" href="/me/settings" aria-label="Settings">${svg('settings')}</a></div></header>
    ${card(me,{mine:true,link:true,pills:ownPills(),friends:ownFriends(me.friend_count)})}
    <div class="me-divider"><span>${svg('lock')}Only you below this line</span></div>`;
  }
  // One distance chart, on the card, with a tiny Days / Weeks switch (Ben, 30 Oct 2026: no second chart below it).
  // Every bar is a button: tapping one shows its dates and distance in place of the total; tap again for the total.
  let period='weeks';
  function distance(r){
    const weekly=period==='weeks',all=mileagePeriods(r.mileage||{}),rows=(weekly?all.weeks:all.days)||[],top=Math.max(0,...rows.map(w=>w.distance_m||0));
    if(!(r.mileage?.weeks||[]).some(w=>w.distance_m>0))return '';
    const total=rows.reduce((n,w)=>n+(w.distance_m||0),0),day=d=>fdate(d+'T12:00',{month:'short',day:'numeric'}),dist=w=>`${U.dist(w.distance_m||0,1)} ${U.du()}`;
    const when=w=>weekly?`${day(w.d)}–${day(w.end)}`:fdate(w.d+'T12:00',{weekday:'short',month:'short',day:'numeric'});
    const value=w=>w.future?'Not yet':dist(w),letter=w=>fdate(w.d+'T12:00',{weekday:'narrow'});
    const toggle=`<div class="mileage-toggle me-period" role="group" aria-label="Distance chart period">${[['days','Days'],['weeks','Weeks']].map(([k,l])=>`<button type="button" data-period="${k}" aria-pressed="${period===k}"${k==='weeks'&&!all.weeks?' disabled':''}>${l}</button>`).join('')}</div>`;
    return `<div class="me-card-sec me-distance${weekly?'':' days'}"><div class="me-card-head"><div class="me-card-label" data-week-label aria-live="polite"><span>${weekly?'7 weeks':'This week'}</span><small>${esc(U.dist(total,1))} ${esc(U.du())}</small></div>${toggle}</div>
      <div class="me-chart-scroll"><div class="me-card-bars" role="group" aria-label="${weekly?'Weekly distance, last 7 weeks':'Daily distance this week'}">${rows.map(w=>`<button type="button" class="me-week${w.today?' now':''}${w.future?' future':''}" aria-pressed="false" data-range="${esc(when(w))}" data-dist="${esc(value(w))}" aria-label="${esc((w.today?(weekly?'This week, ':'Today, '):'')+when(w)+': '+value(w))}"><span data-h="${top?Math.max(2,Math.round((w.distance_m||0)/top*10)):2}"></span>${weekly?'':`<i aria-hidden="true">${esc(letter(w))}</i>`}</button>`).join('')}</div></div></div>`;
  }
  function sections(r,layout,full){
    if(!r.overview?.activities&&!r.shared_count)return `<p class="small muted me-card-empty">${r.mine===false?'No workouts to show yet.':'Your totals appear here once you have workouts.'}</p>`;
    const periods=layout.sections.filter(k=>k==='totals'||k==='recent'&&r.recent),order=ProfileLayout.defaults().sections;
    // Combine the default presentation or adjacent periods; keep custom nonadjacent section ordering intact.
    const combined=periods.length===2&&(Math.abs(layout.sections.indexOf('recent')-layout.sections.indexOf('totals'))===1||layout.sections.every((k,i,a)=>!i||order.indexOf(k)>order.indexOf(a[i-1])));
    const figures=keys=>`<div class="me-card-sec me-summary-scroll"><div class="me-stats-scroll" role="region" aria-label="Workout totals"><table class="me-stats"><thead data-type="secondary"><tr><th scope="col" aria-label="Period"></th>${layout.stats.map(k=>`<th scope="col">${ProfileLayout.labels.stats[k]}</th>`).join('')}</tr></thead><tbody>${keys.map(k=>{
      const row=k==='recent'?r.recent.current:r.overview,label=k==='recent'?'Last 30 days':'All time',range=k==='recent'?`${label}, ${short(r.recent.start)} – ${short(r.recent.end)}`:label;
      return `<tr data-card-period="${k}"><th scope="row" data-type="secondary" aria-label="${esc(range)}">${k==='recent'?'Last <span>30 days</span>':'<span>All time</span>'}</th>${layout.stats.map(stat=>{
        const field={activities:'activities',distance:'distance_m',time:'time_s',active_days:'active_days'}[stat],n=row[field],value=n==null?'—':stat==='distance'?ProfileLayout.distance(n):stat==='time'?ProfileLayout.hours(n).replace(/\s+/g,''):Number(n).toLocaleString();
        return `<td><b class="me-metric-value" data-type="stat">${esc(value)}</b>${stat==='distance'&&n!=null?`<small>${esc(U.du())}</small>`:''}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div></div>`;
    return layout.sections.map(key=>{
      if(key==='recent'||key==='totals')return !periods.includes(key)||combined&&key!==periods[0]?'':figures(combined?periods:[key]);
      if(key==='mileage')return distance(r);
      if(key==='sports'){
        const rows=(layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(x=>x.sport===s)).filter(Boolean):(r.sports||[])).slice(0,4);
        return rows.length?`<div class="me-card-sec me-summary-scroll"><div class="me-sport-chips" role="region" aria-label="Sports totals">${rows.map(x=>`<span class="me-sport-chip"><span class="me-sport-ico" data-sport="${esc(x.sport)}" aria-hidden="true">${svg(SPORT_NAMES[x.sport]?x.sport:'other')}</span>${esc(SPORT_NAMES[x.sport]||x.sport)} · ${esc(Number(x.activities).toLocaleString())}</span>`).join('')}</div></div>`:'';
      }
      if(full)return '';
      return `<a class="me-card-row" href="${profileHref(App.me)}"><span class="grow">${r.shared_count??r.items.length} shared ${(r.shared_count??r.items.length)===1?'activity':'activities'}</span>${svg('chev')}</a>`;
    }).join('');
  }
  // data: the profile page passes the response it already has; full: the activities follow the card (no link row, no
  // View full profile); onSaved: reread after a layout save. Someone else's card only gets the week taps.
  function mount(root,{reload,data:given=null,full=false,onSaved,editOnLoad=false}={}){
    const owner=readOwner(),card=$('.me-card',root),box=$('.me-card-sections',card),live=()=>card.isConnected&&owner===readOwner();
    let data=given,editing=false,editRevision=0,chartCleanup=()=>{};
    const chartPositions=new Map();
    function chartScroll(){
      chartCleanup();
      const summaries=$$('.me-summary-scroll',box).map(frame=>{
        const rail=frame.firstElementChild,update=()=>{if(!live()||!frame.isConnected)return;const max=rail.scrollWidth-rail.clientWidth;frame.classList.toggle('has-before',rail.scrollLeft>1);frame.classList.toggle('has-after',max-rail.scrollLeft>1);rail.tabIndex=max>1?0:-1;};
        const observer=new ResizeObserver(update);observer.observe(rail);rail.addEventListener('scroll',update,{passive:true});update();let cleaned=false;
        const cleanup=()=>{if(cleaned)return;cleaned=true;observer.disconnect();rail.removeEventListener('scroll',update);viewResources.delete(rail);};viewResources.set(rail,cleanup);return cleanup;
      });
      const clearSummaries=()=>summaries.forEach(clean=>clean());
      chartCleanup=clearSummaries;const wrap=$('.me-card-bars',box);if(!wrap)return;
      const frame=wrap.parentElement,mode=wrap.closest('.me-distance').classList.contains('days')?'days':'weeks',saved=chartPositions.get(mode);let atEnd=false,cleaned=false;
      const update=()=>{if(!live()||!wrap.isConnected)return;const max=wrap.scrollWidth-wrap.clientWidth;atEnd=max-wrap.scrollLeft<1;frame.classList.toggle('has-before',wrap.scrollLeft>1);frame.classList.toggle('has-after',!atEnd);chartPositions.set(mode,wrap.scrollLeft);};
      const reveal=b=>{if(!b)return;const r=b.getBoundingClientRect(),left=r.left-wrap.getBoundingClientRect().left+wrap.scrollLeft;if(left<wrap.scrollLeft+4)wrap.scrollLeft=left-4;else if(left+r.width>wrap.scrollLeft+wrap.clientWidth-4)wrap.scrollLeft=left+r.width-wrap.clientWidth+4;};
      const focused=e=>{const b=e.target.closest('.me-week');if(b){reveal(b);update();}};
      wrap.addEventListener('scroll',update,{passive:true});wrap.addEventListener('focusin',focused);
      const observer=new ResizeObserver(()=>{if(!live()||!wrap.isConnected)return;if(atEnd)wrap.scrollLeft=wrap.scrollWidth;update();});observer.observe(wrap);
      const initial=requestAnimationFrame(()=>{if(!live()||!wrap.isConnected)return;if(saved!==undefined)wrap.scrollLeft=saved;else if(mode==='weeks')wrap.scrollLeft=wrap.scrollWidth;else reveal($('.me-week.now',wrap));update();});
      chartCleanup=()=>{if(cleaned)return;cleaned=true;clearSummaries();chartPositions.set(mode,wrap.scrollLeft);cancelAnimationFrame(initial);observer.disconnect();wrap.removeEventListener('scroll',update);wrap.removeEventListener('focusin',focused);viewResources.delete(wrap);};
      viewResources.set(wrap,chartCleanup);
    }
    const bars=()=>{$$('.me-card-bars span',box).forEach(bar=>bar.style.height=bar.dataset.h*5+'px');chartScroll();}; // CSP blocks inline style attributes
    // The heading swaps to the picked week's dates and distance, so the layout never shifts; tap again for the total.
    const weekTaps=()=>{const wrap=$('.me-card-bars',box),label=$('[data-week-label]',box);if(!wrap||!label)return;const [head,side]=[$('span',label),$('small',label)],[h0,s0]=[head.textContent,side.textContent];
      wrap.onclick=e=>{const b=e.target.closest('.me-week');if(!b)return;const on=b.getAttribute('aria-pressed')!=='true';
        $$('.me-week',wrap).forEach(x=>x.setAttribute('aria-pressed','false'));if(on)b.setAttribute('aria-pressed','true');
        head.textContent=on?b.dataset.range:h0;side.textContent=on?b.dataset.dist:s0;label.classList.toggle('picked',on);};};
    const periods=()=>$$('[data-period]',box).forEach(b=>b.onclick=()=>{if(b.dataset.period===period)return;period=b.dataset.period;draw();$(`[data-period="${period}"]`,box)?.focus({preventScroll:true});});
    const draw=()=>{if(!live()||editing||!data)return;chartCleanup();box.setAttribute('aria-busy','false');box.innerHTML=sections(data,ProfileLayout.normalize(data.mine===false?data.layout:App.me.profile_layout||data.layout),full);bars();weekTaps();periods();};
    const load=async()=>{
      try{data=await api('/api/people/'+encodeURIComponent(App.me.login)+'/profile?as_friend=true&preview=friend&limit=1');draw();if(editOnLoad&&live()){editOnLoad=false;edit({focusName:true,fromSettings:true});}}
      catch(x){if(!live()||editing)return;box.setAttribute('aria-busy','false');box.innerHTML=`<p class="small muted">Your card’s numbers couldn’t load.</p><button type="button" class="ghost wide" data-card-retry>Try again</button>`;$('[data-card-retry]',box).onclick=()=>{box.innerHTML=skel(1);load();};}
    };
    const dim=on=>{
      const page=root.parentElement;card.classList.toggle('editing',on);$('.me-card-banner',card).classList.toggle('hidden-tools',on);
      [...$$(':scope>:not(.me-card):not(.me-top)',root),...[...page.children].filter(x=>x!==root)].forEach(x=>{x.inert=on;x.classList.toggle('me-dim',on);});
    };
    function edit({focusName=false,fromSettings=false}={}){
      if(!live()||editing)return;chartCleanup();editing=true;dim(true);
      const revision=++editRevision,valid=()=>live()&&editing&&revision===editRevision;
      const start={name:App.me.name||'',bio:App.me.bio||'',layout:ProfileLayout.normalize(App.me.profile_layout||data?.layout)};
      const value=structuredClone(start.layout),{sections:names,stats}=ProfileLayout.labels;
      let order=[...value.sections,...Object.keys(names).filter(k=>!value.sections.includes(k))],busy=false;
      const chip=(group,id,label,on)=>`<button type="button" class="me-chip" data-${group}="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      box.innerHTML=`<form class="me-card-editor" novalidate>
        <header class="me-editor-head"><button type="button" class="linkbtn" data-card-cancel>Cancel</button><b>Editing your card</b><button type="submit" class="linkbtn" data-card-save disabled>Save</button><p class="small muted" role="status" aria-live="polite" data-card-status></p></header>
        <div class="me-editor-identity"><button type="button" class="me-editor-photo" data-card-photo aria-label="Change profile photo">${avatar(App.me,'lg')}<small>Change</small></button>
          <div class="me-editor-fields"><label class="vh" for="card-name">Name</label><input id="card-name" name="name" value="${esc(start.name)}" maxlength="60" autocomplete="name" placeholder="Name" required aria-describedby="card-name-error"><small class="danger" id="card-name-error" role="alert"></small><span class="small muted">@${esc(App.me.login)}</span>
          <label class="vh" for="card-bio">Bio</label><textarea id="card-bio" name="bio" rows="2" maxlength="280" placeholder="Bio" aria-describedby="card-bio-count">${esc(start.bio)}</textarea><div class="me-editor-bio-label"><small class="muted" id="card-bio-count" data-card-bio-count>${start.bio.length}/280</small></div></div></div>
        <p class="small muted me-editor-privacy">Your name, photo and bio are visible to people who find your profile.</p>
        <h3>Sections</h3><div class="me-editor-sections" data-card-sections></div>
        <h3>Headline numbers <span>· up to 3</span></h3><div class="me-chips" data-card-stats></div>
        <h3>Featured sports <span>· up to 3 · none = all</span></h3><div class="me-chips" data-card-sports></div></form>`;
      const form=$('form',box),name=form.elements.name,bio=form.elements.bio,save=$('[data-card-save]',box),status=$('[data-card-status]',box),nameError=$('#card-name-error',box);
      const dirty=()=>name.value!==start.name||bio.value!==start.bio||JSON.stringify(value)!==JSON.stringify(start.layout);
      const changed=text=>{save.disabled=busy||!dirty();if(text)status.textContent=text;};
      const sizeBio=()=>{bio.style.height='auto';const style=getComputedStyle(bio),line=parseFloat(style.lineHeight)||22,padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;bio.style.height=Math.max(line*2+padding,Math.min(bio.scrollHeight,line*3+padding))+'px';};
      const rows=focus=>{
        $('[data-card-sections]',box).innerHTML=order.map((k,i)=>{const on=value.sections.includes(k);return `<div class="me-edit-row${on?'':' off'}"><label class="me-section-toggle switch-row"><span>${names[k]}</span><input type="checkbox" role="switch" data-show="${k}" aria-label="Show ${names[k]}"${on?' checked':''}></label><button type="button" class="icon-btn" data-move="${k}" data-step="-1" aria-label="Move ${names[k]} up"${i?'':' disabled'}><span class="profile-up">${svg('down')}</span></button><button type="button" class="icon-btn" data-move="${k}" data-step="1" aria-label="Move ${names[k]} down"${i===order.length-1?' disabled':''}>${svg('down')}</button></div>`;}).join('');
        $$('[data-show]',box).forEach(input=>input.onchange=()=>{if(!valid())return;const k=input.dataset.show;value.sections=order.filter(x=>x===k?input.checked:value.sections.includes(x));input.closest('.me-edit-row').classList.toggle('off',!input.checked);changed(`${names[k]} ${input.checked?'shown':'hidden'}.`);});
        $$('[data-move]',box).forEach(button=>button.onclick=()=>{if(!valid())return;const i=order.indexOf(button.dataset.move),j=i+Number(button.dataset.step);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];value.sections=order.filter(k=>value.sections.includes(k));changed(`${names[button.dataset.move]} moved ${button.dataset.step==='1'?'down':'up'}.`);rows({key:button.dataset.move,step:button.dataset.step});});
        if(focus){const b=$(`[data-move="${focus.key}"][data-step="${focus.step}"]`,box);(b.disabled?$(`[data-show="${focus.key}"]`,box):b).focus({preventScroll:true});}
      };
      const choices=(group,key,catalog,min)=>{
        const target=$(`[data-card-${key}]`,box);target.innerHTML=Object.entries(catalog).map(([k,l])=>chip(group,k,l,value[key].includes(k))).join('');
        $$(`[data-${group}]`,target).forEach(button=>button.onclick=()=>{if(!valid())return;const k=button.dataset[group],on=value[key].includes(k);if(on&&value[key].length<=min){status.textContent='Keep at least one number.';return;}if(!on&&value[key].length>=3){status.textContent='Choose up to three.';return;}value[key]=on?value[key].filter(x=>x!==k):[...value[key],k];button.setAttribute('aria-pressed',String(!on));changed(`${key==='stats'?'Headline numbers':'Featured sports'} updated.`);});
      };
      rows();choices('stat','stats',stats,1);choices('sport','sports',Object.fromEntries(ProfileLayout.sports.map(k=>[k,SPORT_NAMES[k]||k])),0);
      name.oninput=()=>{nameError.textContent='';name.removeAttribute('aria-invalid');changed();};
      bio.oninput=()=>{$('[data-card-bio-count]',box).textContent=bio.value.length+'/280';sizeBio();changed();};
      $('[data-card-photo]',box).onclick=()=>{if(!valid())return;profilePhotoSheet(()=>{if(!valid())return;const photo=$('[data-card-photo]',box);photo.innerHTML=avatar(App.me,'lg')+'<small>Change</small>';const original=$('.me-card-id .me-card-avatar',card);if(original)original.innerHTML=avatar(App.me,'lg');invalidate('/api/me');invalidate('/api/people/');keep('/api/me',App.me);status.textContent='Photo saved. Your other edits are kept.';});};
      const close=()=>{finish();if(fromSettings&&live())go('/me',{replace:true});};
      $('[data-card-cancel]',box).onclick=()=>{if(valid()&&(!dirty()||confirm('Discard your changes?')))close();};
      form.onsubmit=async e=>{
        e.preventDefault();if(!valid()||busy||!dirty())return;
        const trimmed=name.value.trim();if(!trimmed||trimmed.length>60){nameError.textContent='Enter a name between 1 and 60 characters.';name.setAttribute('aria-invalid','true');name.focus();return;}
        const body={name:trimmed,bio:bio.value.trim(),profile_layout:structuredClone(value)};
        busy=true;save.disabled=true;save.textContent='Saving…';status.textContent='';
        try{
          const account=await api('/api/account',json('PUT',body));if(owner!==readOwner())return;
          App.me.name=account.name??body.name;App.me.bio=account.bio??body.bio;App.me.profile_layout=account.profile_layout||body.profile_layout;
          invalidate('/api/me');invalidate('/api/people/');invalidateFeed();keep('/api/me',App.me);
          if(valid()){finish();toast('Card saved');if(fromSettings)go('/me',{replace:true});else (onSaved||reload)?.();}
        }catch(x){if(valid()){status.textContent=x.message;save.textContent='Save';busy=false;changed();}}
      };
      sizeBio();if(focusName){card.scrollIntoView({block:'start'});name.focus({preventScroll:true});}else $('[data-show]',box)?.focus({preventScroll:true});
    }
    function finish(){editing=false;dim(false);draw();if(!data)load();$('[data-card-edit]',card).focus({preventScroll:true});}
    if(data?.mine===false){draw();return {};}
    $('[data-card-edit]',card).onclick=edit;
    $('[data-card-share]',card).onclick=()=>sheet('Share your profile',`<p class="small muted">Friends see the card on Me. Other members see only activities shared with everyone.</p><button type="button" class="primary wide" data-share-link>${svg('share')}Share profile link</button>${typeof KinettaCard==='undefined'?'':'<button type="button" class="ghost wide" data-share-card>Public card &amp; QR</button>'}${full?'':`<a class="ghost wide" href="${profileHref(App.me)}" data-close>View full profile</a>`}`,(b,close)=>{
      $('[data-share-link]',b).onclick=()=>{close();shareProfile(App.me);};
      const cardButton=$('[data-share-card]',b);if(cardButton)cardButton.onclick=()=>{close();KinettaCard.open();};
    });
    if(data)draw();else load();
    return {edit};
  }
  return {header,card,ownPills,ownFriends,mount,firstName,openEditor:()=>go('/me?edit=profile')};
})();
