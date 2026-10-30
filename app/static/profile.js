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
  return {defaults,normalize,numbers,content,mount,editor,editorHtml,labels:{sections,stats},sports};
})();

// Me leads with the card friends see, then a private dashboard (owner-approved mockup, 29 October 2026). The card uses the
// same server-filtered friend preview as the shared profile; Edit changes its sections in place.
const MeCard=(()=>{
  const firstName=me=>(me.name||'').trim().split(/\s+/)[0]||me.login;
  const short=d=>fdate(d+'T12:00',{month:'short',day:'numeric'});
  // The card itself, shared by Me and every profile page (Ben, 30 Oct 2026: the full profile is this card at full size,
  // then the shared activities). pills fill the banner; friends is the friend-count line.
  function card(p,{mine=false,pills='',friends='',link=false}={}){
    const bio=(p.bio||'').trim(),photo=avatar(p,'lg');
    return `<section class="me-card" aria-label="${mine?'Your profile card':esc(p.name||p.login)+'’s profile card'}"><div class="me-card-banner">${pills}</div>
      <div class="me-card-body"><div class="me-card-id">${link?`<a class="me-card-avatar" href="${profileHref(p)}" aria-label="View your shared profile">${photo}</a>`:`<span class="me-card-avatar">${photo}</span>`}<div class="me-card-name"><h2>${esc(p.name||p.login)}</h2><span>@${esc(p.login)}</span></div></div>
        ${bio?bio.length>140?`<details class="me-about"><summary>About me</summary><p>${esc(bio)}</p></details>`:`<p class="me-profile-bio">${esc(bio)}</p>`:''}
        ${friends}
        <div class="me-card-sections" aria-busy="true">${skel(1)}</div>
        ${mine?`<p class="me-card-note">${svg('lock')}<span>Your friends see this card. Totals include all your workouts; private ones never show details. Food, body data and Kit are never shown.</span></p>`:''}</div></section>`;
  }
  const ownPills=()=>`<button type="button" class="me-card-pill" data-card-edit>${svg('edit')}Edit</button><button type="button" class="me-card-pill" data-card-share aria-label="Share your profile">${svg('share')}</button>`;
  function ownFriends(count){
    const pending=Number.isInteger(App.me.friend_requests)?App.me.friend_requests:0;
    return `<a class="me-friends-link" href="/me/friends">${svg('people')}<span data-friend-count>${Number.isInteger(count)?friendCountText(count):'Friends'}</span><span class="badge alert" data-friend-waiting${pending?'':' hidden'}>${pending} waiting</span>${svg('chev')}</a>`;
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
    return `<div class="me-card-sec me-distance${weekly?'':' days'}"><div class="me-card-head"><div class="me-card-label" data-week-label aria-live="polite"><span>${weekly?'Distance · 7 weeks':'This week'}</span><small>${esc(U.dist(total,1))} ${esc(U.du())}</small></div>${toggle}</div>
      <div class="me-card-bars" role="group" aria-label="${weekly?'Weekly distance, last 7 weeks':'Daily distance this week'}">${rows.map(w=>`<button type="button" class="me-week${w.today?' now':''}${w.future?' future':''}" aria-pressed="false" data-range="${esc(when(w))}" data-dist="${esc(value(w))}" aria-label="${esc((w.today?(weekly?'This week, ':'Today, '):'')+when(w)+': '+value(w))}"><span data-h="${top?Math.max(2,Math.round((w.distance_m||0)/top*10)):2}"></span>${weekly?'':`<i aria-hidden="true">${esc(letter(w))}</i>`}</button>`).join('')}</div></div>`;
  }
  function sections(r,layout,full){
    if(!r.overview?.activities&&!r.shared_count)return `<p class="small muted me-card-empty">${r.mine===false?'No workouts to show yet.':'Your totals appear here once you have workouts.'}</p>`;
    return layout.sections.map(key=>{
      if(key==='recent'){const figures=ProfileLayout.numbers(r.recent.current,layout.stats);return figures?`<div class="me-card-sec"><div class="me-card-label"><span>Last 30 days</span><small>${esc(short(r.recent.start))} – ${esc(short(r.recent.end))}</small></div><div class="profile-stats">${figures}</div></div>`:'';}
      if(key==='mileage')return distance(r);
      if(key==='totals'){const figures=ProfileLayout.numbers(r.overview,layout.stats);return figures?`<div class="me-card-sec me-card-total"><div class="me-card-label"><span>All time</span></div><div class="profile-stats">${figures}</div></div>`:'';}
      if(key==='sports'){
        const rows=(layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(x=>x.sport===s)).filter(Boolean):(r.sports||[])).slice(0,4);
        return rows.length?`<div class="me-card-sec me-sport-chips">${rows.map(x=>`<span class="me-sport-chip"><span class="me-sport-ico" data-sport="${esc(x.sport)}" aria-hidden="true">${svg(SPORT_NAMES[x.sport]?x.sport:'other')}</span>${esc(SPORT_NAMES[x.sport]||x.sport)} · ${esc(Number(x.activities).toLocaleString())}</span>`).join('')}</div>`:'';
      }
      if(full)return '';
      return `<a class="me-card-row" href="${profileHref(App.me)}"><span class="grow"><b>${r.shared_count??r.items.length} shared ${(r.shared_count??r.items.length)===1?'activity':'activities'}</b><small>Shared with friends or everyone</small></span>${svg('chev')}</a>`;
    }).join('');
  }
  // data: the profile page passes the response it already has; full: the activities follow the card (no link row, no
  // View full profile); onSaved: reread after a layout save. Someone else's card only gets the week taps.
  function mount(root,{reload,data:given=null,full=false,onSaved}={}){
    const owner=readOwner(),card=$('.me-card',root),box=$('.me-card-sections',card),live=()=>card.isConnected&&owner===readOwner();
    let data=given,editing=false;
    const bars=()=>$$('.me-card-bars span',box).forEach(bar=>bar.style.height=bar.dataset.h*5+'px'); // CSP blocks inline style attributes
    // The heading swaps to the picked week's dates and distance, so the layout never shifts; tap again for the total.
    const weekTaps=()=>{const wrap=$('.me-card-bars',box),label=$('[data-week-label]',box);if(!wrap||!label)return;const [head,side]=[$('span',label),$('small',label)],[h0,s0]=[head.textContent,side.textContent];
      wrap.onclick=e=>{const b=e.target.closest('.me-week');if(!b)return;const on=b.getAttribute('aria-pressed')!=='true';
        $$('.me-week',wrap).forEach(x=>x.setAttribute('aria-pressed','false'));if(on)b.setAttribute('aria-pressed','true');
        head.textContent=on?b.dataset.range:h0;side.textContent=on?b.dataset.dist:s0;label.classList.toggle('picked',on);};};
    const periods=()=>$$('[data-period]',box).forEach(b=>b.onclick=()=>{if(b.dataset.period===period)return;period=b.dataset.period;draw();$(`[data-period="${period}"]`,box)?.focus({preventScroll:true});});
    const draw=()=>{if(!live()||editing||!data)return;box.setAttribute('aria-busy','false');box.innerHTML=sections(data,ProfileLayout.normalize(data.mine===false?data.layout:App.me.profile_layout||data.layout),full);bars();weekTaps();periods();};
    const load=async()=>{
      try{data=await api('/api/people/'+encodeURIComponent(App.me.login)+'/profile?as_friend=true&preview=friend&limit=1');draw();}
      catch(x){if(!live()||editing)return;box.setAttribute('aria-busy','false');box.innerHTML=`<p class="small muted">Your card’s numbers couldn’t load.</p><button type="button" class="ghost wide" data-card-retry>Try again</button>`;$('[data-card-retry]',box).onclick=()=>{box.innerHTML=skel(1);load();};}
    };
    const dim=on=>{
      const page=root.parentElement;card.classList.toggle('editing',on);$('.me-card-banner',card).classList.toggle('hidden-tools',on);
      [...$$(':scope>:not(.me-card):not(.me-top)',root),...[...page.children].filter(x=>x!==root)].forEach(x=>{x.inert=on;x.classList.toggle('me-dim',on);});
    };
    function edit(){
      if(!live()||editing)return;editing=true;dim(true);
      const start=ProfileLayout.normalize(App.me.profile_layout||data?.layout),value=structuredClone(start),{sections:names,stats}=ProfileLayout.labels;
      let order=[...value.sections,...Object.keys(names).filter(k=>!value.sections.includes(k))];
      const sports=[...new Set([...(data?.sports||[]).map(s=>s.sport),...value.sports])];
      const chip=(group,id,label,on)=>`<button type="button" class="me-chip" data-${group}="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      const paint=focus=>{
        box.innerHTML=`<div class="me-card-editor">${order.map((k,i)=>{const on=value.sections.includes(k);return `<div class="me-edit-row${on?'':' off'}"><span class="grow">${names[k]}</span><button type="button" class="me-chip" data-show="${k}" aria-pressed="${on}" aria-label="${on?'Hide':'Show'} ${names[k]}">${on?'Shown':'Hidden'}</button><button type="button" class="icon-btn" data-move="${k}" data-step="-1" aria-label="Move ${names[k]} up"${i?'':' disabled'}><span class="profile-up">${svg('down')}</span></button><button type="button" class="icon-btn" data-move="${k}" data-step="1" aria-label="Move ${names[k]} down"${i===order.length-1?' disabled':''}>${svg('down')}</button></div>`;}).join('')}
          <h3>Headline numbers · up to 3</h3><div class="me-chips">${Object.entries(stats).map(([k,l])=>chip('stat',k,l,value.stats.includes(k))).join('')}</div>
          ${sports.length?`<h3>Featured sports · up to 3</h3><p class="small muted">None chosen shows all your sports.</p><div class="me-chips">${sports.map(k=>chip('sport',k,SPORT_NAMES[k]||k,value.sports.includes(k))).join('')}</div>`:''}
          <button type="button" class="ghost wide" data-card-identity>${svg('user')}Name, photo &amp; bio</button>
          <p class="small muted" role="status" aria-live="polite" data-card-status></p>
          <div class="me-card-actions"><button type="button" class="ghost" data-card-cancel>Cancel</button><button type="button" class="primary" data-card-save>Save card</button></div></div>`;
        const status=$('[data-card-status]',box);
        $$('[data-show]',box).forEach(b=>b.onclick=()=>{const k=b.dataset.show;value.sections=order.filter(x=>x===k?!value.sections.includes(k):value.sections.includes(x));paint({show:k});});
        $$('[data-move]',box).forEach(b=>b.onclick=()=>{const i=order.indexOf(b.dataset.move),j=i+Number(b.dataset.step);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];value.sections=order.filter(x=>value.sections.includes(x));paint({move:b.dataset.move,step:b.dataset.step});});
        const pick=(group,key,list,min)=>$$(`[data-${group}]`,box).forEach(b=>b.onclick=()=>{const k=b.dataset[group],on=value[key].includes(k);
          if(on&&value[key].length<=min){status.textContent='Keep at least one number.';return;}
          if(!on&&value[key].length>=3){status.textContent='Choose up to three.';return;}
          value[key]=on?value[key].filter(x=>x!==k):[...value[key],k];paint({[group]:k});});
        pick('stat','stats',stats,1);pick('sport','sports',null,0);
        $('[data-card-identity]',box).onclick=()=>editProfile(App.me,reload);
        $('[data-card-cancel]',box).onclick=()=>finish();
        $('[data-card-save]',box).onclick=async e=>{
          const button=e.currentTarget;if(button.disabled)return;button.disabled=true;button.textContent='Saving…';status.textContent='';
          try{const r=await api('/api/account',json('PUT',{profile_layout:value}));if(owner!==readOwner())return;
            App.me.profile_layout=r.profile_layout||value;invalidate('/api/me');invalidate('/api/people/');keep('/api/me',App.me);if(live()){finish();toast('Card saved');onSaved?.();}}
          catch(x){if(!live())return;button.disabled=false;button.textContent='Save card';status.textContent=x.message;}
        };
        if(focus){const [k,v]=Object.entries(focus).find(([key])=>key!=='step');const target=$(`[data-${k}="${v}"]${k==='move'?`[data-step="${focus.step}"]`:''}`,box);(target&&!target.disabled?target:$(`[data-show="${focus.move||v}"]`,box))?.focus({preventScroll:true});}
      };
      paint();$('[data-show]',box)?.focus({preventScroll:true});
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
  return {header,card,ownPills,ownFriends,mount,firstName};
})();
