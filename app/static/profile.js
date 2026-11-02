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
  function singlePeriod(value){
    const layout=normalize(value),selected=layout.sections.includes('totals')?'totals':'recent';let used=false;
    layout.sections=layout.sections.flatMap(k=>{if(k!=='recent'&&k!=='totals')return[k];if(used)return[];used=true;return[selected];});return layout;
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
  function content(r,value=r.layout){
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
      return `<section class="profile-activities"><h2 class="sec-head">Shared activities</h2><div class="feed-list" id="person-activities">${r.items.length?r.items.map(a=>postCard(a)).join(''):`<div class="card empty"><b>No shared activities yet</b>${r.mine?'Choose an activity and change its audience to share it.' : 'No activities shared with you.'}${r.mine?`<a class="ghost wide" href="${profileHref(App.me)}">Choose an activity</a>`:''}</div>`}</div><button type="button" class="ghost wide" id="person-more"${r.next?'':' hidden'}>Show more</button></section>`;
    }).join('');
  }
  function mount(box,r){
    const chart=box.querySelector('[data-profile-mileage]');
    if(chart)mileageChart(chart,r.mileage||{},'days',{shared:true});
    feedMaps(box);wireCheers(box);
  }
  return {defaults,normalize,singlePeriod,numbers,content,mount,distance,hours,labels:{sections,stats},sports};
})();

// Me leads with the card friends see, then a private dashboard (owner-approved mockup, 29 October 2026). The card uses the
// same server-filtered friend preview as the shared profile; Edit changes its sections in place.
const MeCard=(()=>{
  const firstName=me=>(me.name||'').trim().split(/\s+/)[0]||me.login;
  const short=d=>fdate(d+'T12:00',{month:'short',day:'numeric'});
  // The card itself, shared by Me and every profile page (Ben, 30 Oct 2026: the full profile is this card at full size,
  // then the shared activities). Friends shares the handle row without changing its audience or destination.
  function card(p,{mine=false,pills='',friends='',link=false,milestones=false}={}){
    const bio=(p.bio||'').trim(),photo=avatar(p,'lg');
    return `<section class="me-card" aria-label="${mine?'Your profile card':esc(p.name||p.login)+'’s profile card'}"><div class="me-card-banner">${pills}</div>
      <div class="me-card-body"><div class="me-card-id">${link?`<a class="me-card-avatar" href="${profileHref(p)}" aria-label="View your profile">${photo}</a>`:`<span class="me-card-avatar">${photo}</span>`}<div class="me-card-name"><h2>${esc(p.name||p.login)}</h2><div class="me-card-meta"><span data-type="secondary">@${esc(p.login)}</span>${friends}</div></div></div>
        ${bio?bio.length>140?`<details class="me-about"><summary>About me</summary><p>${esc(bio)}</p></details>`:`<p class="me-profile-bio">${esc(bio)}</p>`:''}
        <div class="me-card-sections" aria-busy="true">${skel(1)}</div>
        ${mine?`<p class="me-card-note">${svg('lock')}<span aria-hidden="true" title="Totals include your private workouts. Friends see the totals, not the workouts.">Private workouts count, but stay hidden</span><span class="vh">Totals include your private workouts. Friends see the totals, not the workouts.</span></p>`:''}${milestones?'<div data-me-milestones hidden></div>':''}</div></section>`;
  }
  const paintBars=box=>$$('.me-card-bars span',box).forEach(bar=>bar.style.height=bar.dataset.h*5+'px');
  // Reuse the recipient renderer without mounting any interactive controls in the miniature.
  function previewCard(root,data){
    const r={...data,mine:false},layout=ProfileLayout.singlePeriod(r.layout),savedPeriod=period;
    const friends=Number.isInteger(r.friend_count)?`<span class="me-friends-link">${svg('people')}<span>${friendCountText(r.friend_count)}</span></span>`:'';
    root.innerHTML=card(r.person,{mine:true,friends});const content=$('.me-card-sections',root);
    try{period='weeks';content.innerHTML=sections(r,layout,true);paintBars(content);}finally{period=savedPeriod;}
    content.setAttribute('aria-busy','false');
  }
  function shareSheet(){
    const owner=readOwner(),login=App.me.login;
    sheet('Share your profile',`<div class="profile-share-scroll" tabindex="0" role="region" aria-label="Profile preview"><p class="small muted profile-share-caption">Preview</p><div class="profile-share-preview" role="img" aria-label="Loading profile preview"><div class="profile-share-art" inert aria-hidden="true"></div></div><p class="small" id="profile-share-status" role="status">Loading preview…</p></div><div class="profile-share-actions"><button type="button" class="primary" data-share-link disabled>${svg('share')}Share profile link</button>${typeof KinettaCard==='undefined'?'':'<button type="button" class="ghost" data-share-card>Public card &amp; QR</button>'}</div>`,(body,close)=>{
      body.closest('.sheet').classList.add('profile-share-sheet');const scroll=$('.profile-share-scroll',body);
      // An already-scrolled preview owns the gesture; dragging the sheet header still dismisses.
      scroll.addEventListener('touchstart',e=>{if(scroll.scrollTop>0)e.stopPropagation();},{passive:true});
      const active=()=>body.isConnected&&owner===readOwner(),frame=$('.profile-share-preview',body),art=$('.profile-share-art',body),status=$('#profile-share-status',body),link=$('[data-share-link]',body);let revision=0,dispose=()=>{};
      const draw=async()=>{const version=++revision;dispose();frame.hidden=false;link.disabled=true;status.textContent='Loading preview…';
        try{const r=await api('/api/people/'+encodeURIComponent(login)+'/profile?as_friend=true&preview=member&limit=1');if(!active()||version!==revision)return;
          if(r.preview!=='member'||r.profile_hidden)throw Error(r.profile_hidden?'Your profile is hidden until your account is confirmed and active.':'The preview needs a server update.');
          previewCard(art,r);const card=$('.me-card',art);
          const fit=()=>{if(!active()||!card.isConnected||version!==revision){observer.disconnect();return;}const width=Math.max(358,frame.clientWidth/.9),scale=frame.clientWidth/width;art.style.width=width+'px';art.style.setProperty('--preview-scale',scale);$$('.me-sport-chips',art).forEach(fitSports);const height=Math.ceil(card.offsetHeight*scale)+'px';if(frame.style.height!==height)frame.style.height=height;};
          const observer=new ResizeObserver(fit);dispose=()=>observer.disconnect();observer.observe(frame);observer.observe(card);viewResources.set(frame,dispose);fit();document.fonts.ready.then(fit);
          frame.setAttribute('aria-label','Profile card preview: '+card.innerText.replace(/\s+/g,' ').trim());status.textContent='';link.disabled=false;
        }catch(x){if(active()&&version===revision){frame.hidden=true;art.replaceChildren();status.innerHTML=`${esc(x.message)} <button type="button" class="linkbtn" data-preview-retry>Try again</button>`;$('[data-preview-retry]',body).onclick=draw;}}
      };
      link.onclick=()=>{if(active()&&!link.disabled){close();shareProfile(App.me);}};
      const publicCard=$('[data-share-card]',body);if(publicCard)publicCard.onclick=()=>{if(active()){close();KinettaCard.open();}};
      draw();
    });
  }
  const ownPills=()=>`<button type="button" class="me-card-pill" data-card-edit>${svg('edit')}Edit</button><button type="button" class="me-card-pill" data-card-share aria-label="Share your profile">${svg('share')}</button>`;
  function ownFriends(count){
    const pending=Number.isInteger(App.me.friend_requests)?App.me.friend_requests:0;
    return `<a class="me-friends-link" href="/me/friends"><span class="me-friends-count"><span data-friend-count>${Number.isInteger(count)?friendCountText(count):'Friends'}</span>${svg('chev')}</span><span class="badge alert" data-friend-waiting${pending?'':' hidden'}>${pending} waiting</span></a>`;
  }
  function header(me){
    return `<header class="me-top"><h1>Hi, ${esc(firstName(me))}</h1><div class="me-profile-tools">${bellBtn()}<a class="icon-btn" href="/me/settings" aria-label="Settings">${svg('settings')}</a></div></header>
    ${card(me,{mine:true,link:true,pills:ownPills(),friends:ownFriends(me.friend_count),milestones:true})}
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
    if(!r.overview?.activities&&!r.shared_count)return `<div class="me-card-empty"><p>${r.mine===false?'No workouts to show yet.':'Your totals appear here once you have workouts.'}</p>${r.mine===false||full?'':'<a class="ghost wide" href="/me/goals?new=1">Set a goal</a>'}</div>`;
    const figures=key=>{
      const recent=key==='recent',row=(recent?r.recent?.current:r.overview)||{},name=recent?'Last 30 days':'All time',range=recent&&r.recent?.start?`${name}, ${short(r.recent.start)} – ${short(r.recent.end)}`:name;
      return `<div class="me-card-sec me-card-figures" role="group" data-card-period="${key}" aria-label="${esc(range)} workout totals"><p class="me-card-period" data-type="secondary" title="${esc(range)}">${name}</p><dl class="me-card-numbers me-numbers-${layout.stats.length}">${layout.stats.map(stat=>{
        const n=row[{activities:'activities',distance:'distance_m',time:'time_s',active_days:'active_days'}[stat]],unit=stat==='distance'?U.du():stat==='time'?'h':'',precise=stat==='time'&&n!=null?dur(n,true):null;let value=n==null?'—':stat==='distance'?ProfileLayout.distance(n):Number(n).toLocaleString();
        if(precise){const h=n/3600;value=h>0&&h<.005?'<0.01':(h>=100?Math.floor(h):h).toLocaleString(undefined,{maximumFractionDigits:h>=100?0:h>=1?1:2});}
        return `<div data-card-stat="${stat}"><dt data-type="secondary"><span>${ProfileLayout.labels.stats[stat]}</span>${unit?` <small>(${esc(unit)})</small>`:''}</dt><dd${precise?` title="${esc(precise)}"`:''}><b class="me-metric-value" data-type="stat"${precise?' aria-hidden="true"':''}>${esc(value)}</b>${precise?`<span class="vh">${esc(precise)}</span>`:''}</dd></div>`;
      }).join('')}</dl></div>`;
    };
    return ProfileLayout.singlePeriod(layout).sections.map(key=>{
      if(key==='recent'||key==='totals')return figures(key);
      if(key==='mileage')return distance(r);
      if(key==='sports'){
        const rows=layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(x=>x.sport===s)).filter(Boolean):[...(r.sports||[])].sort((a,b)=>b.activities-a.activities);
        return rows.length?`<div class="me-card-sec"><div class="me-sport-chips" role="group" aria-label="Sports totals">${rows.map(x=>`<span class="me-sport-chip"><span class="me-sport-ico" data-sport="${esc(x.sport)}" aria-hidden="true">${svg(SPORT_NAMES[x.sport]?x.sport:'other')}</span>${esc(SPORT_NAMES[x.sport]||x.sport)} · ${esc(Number(x.activities).toLocaleString())}</span>`).join('')}<span class="me-sport-more" data-type="secondary" hidden></span></div></div>`:'';
      }
      return '';
    }).join('');
  }
  function fitSports(rail){
    const chips=$$('.me-sport-chip',rail),more=$('.me-sport-more',rail);let count=Math.min(3,chips.length);chips.forEach((n,i)=>n.hidden=i>=count);more.hidden=count===chips.length;if(!more.hidden)more.textContent='+'+(chips.length-count);
    const fits=()=>{const a=rail.getBoundingClientRect(),b=(more.hidden?chips.at(-1):more).getBoundingClientRect();return b.left>=a.left-.01&&b.right<=a.right+.01;};
    // Reserve the omitted-count label too; never leave a partial sport at either edge.
    while(count&&!fits()){chips[--count].hidden=true;more.hidden=false;more.textContent='+'+(chips.length-count);}
    if(count<chips.length){const n=chips.length-count,names=chips.slice(count).map(x=>x.textContent.trim()).join(', ');more.title=names;more.innerHTML=`<span aria-hidden="true">+${n}</span><span class="vh">${n} more ${n===1?'sport':'sports'}: ${esc(names)}</span>`;}
  }
  // data: the profile page passes the response it already has; full: the activities follow the card (no link row, no
  // View full profile); onSaved: reread after a layout save. Someone else's card only gets the week taps.
  function mount(root,{reload,data:given=null,full=false,onSaved,onEditEnd,editOnLoad=false}={}){
    const owner=readOwner(),card=$('.me-card',root),box=$('.me-card-sections',card),live=()=>card.isConnected&&owner===readOwner();
    let data=given,editing=false,editRevision=0,chartCleanup=()=>{};
    const chartPositions=new Map();
    function chartScroll(){
      chartCleanup();
      const summaries=$$('.me-sport-chips',box).map(rail=>{
        let resized=0,cleaned=false;const update=()=>{if(!cleaned&&live()&&rail.isConnected)fitSports(rail);};
        const observer=new ResizeObserver(()=>{cancelAnimationFrame(resized);resized=requestAnimationFrame(update);});[rail,...rail.children].forEach(n=>observer.observe(n));update();
        const cleanup=()=>{if(cleaned)return;cleaned=true;cancelAnimationFrame(resized);observer.disconnect();viewResources.delete(rail);};viewResources.set(rail,cleanup);return cleanup;
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
    const bars=()=>{paintBars(box);chartScroll();}; // CSP blocks inline style attributes
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
      const start={name:App.me.name||'',bio:App.me.bio||'',layout:ProfileLayout.singlePeriod(App.me.profile_layout||data?.layout)};
      const value=structuredClone(start.layout),{sections:names,stats}=ProfileLayout.labels;
      let chosenPeriod=value.sections.includes('recent')?'recent':'totals',order=[...value.sections,...Object.keys(names).filter(k=>!value.sections.includes(k))].filter(k=>k!=='recent'&&k!=='totals'||k===chosenPeriod),busy=false;
      const sectionName=k=>k==='recent'||k==='totals'?'Numbers':names[k];
      const chip=(group,id,label,on)=>`<button type="button" class="me-chip" data-${group}="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      box.innerHTML=`<form class="me-card-editor" novalidate>
        <header class="me-editor-head"><button type="button" class="linkbtn" data-card-cancel>Cancel</button><b>Editing your card</b><button type="submit" class="linkbtn" data-card-save disabled>Save</button><p class="small muted" role="status" aria-live="polite" data-card-status></p></header>
        <div class="me-editor-identity"><button type="button" class="me-editor-photo" data-card-photo aria-label="Change profile photo">${avatar(App.me,'lg')}<small>Change</small></button>
          <div class="me-editor-fields"><label class="vh" for="card-name">Name</label><input id="card-name" name="name" value="${esc(start.name)}" maxlength="60" autocomplete="name" placeholder="Name" required aria-describedby="card-name-error"><small class="danger" id="card-name-error" role="alert"></small><span class="small muted">@${esc(App.me.login)}</span>
          <label class="vh" for="card-bio">Bio</label><textarea id="card-bio" name="bio" rows="2" maxlength="280" placeholder="Bio" aria-describedby="card-bio-count">${esc(start.bio)}</textarea><div class="me-editor-bio-label"><small class="muted" id="card-bio-count" data-card-bio-count>${start.bio.length}/280</small></div></div></div>
        <p class="small muted me-editor-privacy">Your name, photo and bio are visible to people who find your profile.</p>
        <h3 id="card-period-label">Period</h3><div class="me-chips" data-card-period role="group" aria-labelledby="card-period-label"></div>
        <h3>Sections</h3><div class="me-editor-sections" data-card-sections></div>
        <h3>Headline numbers <span>· up to 3</span></h3><div class="me-chips" data-card-stats></div>
        <h3>Featured sports <span>· up to 3 · none = all</span></h3><div class="me-chips" data-card-sports></div></form>`;
      const form=$('form',box),name=form.elements.name,bio=form.elements.bio,save=$('[data-card-save]',box),status=$('[data-card-status]',box),nameError=$('#card-name-error',box);
      const dirty=()=>name.value!==start.name||bio.value!==start.bio||JSON.stringify(value)!==JSON.stringify(start.layout);
      const changed=text=>{save.disabled=busy||!dirty();if(text)status.textContent=text;};
      const sizeBio=()=>{bio.style.height='auto';const style=getComputedStyle(bio),line=parseFloat(style.lineHeight)||22,padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;bio.style.height=Math.max(line*2+padding,Math.min(bio.scrollHeight,line*3+padding))+'px';};
      const rows=focus=>{
        $('[data-card-sections]',box).innerHTML=order.map((k,i)=>{const on=value.sections.includes(k);return `<div class="me-edit-row${on?'':' off'}"><label class="me-section-toggle switch-row"><span>${sectionName(k)}</span><input type="checkbox" role="switch" data-show="${k}" aria-label="Show ${sectionName(k)}"${on?' checked':''}></label><button type="button" class="icon-btn" data-move="${k}" data-step="-1" aria-label="Move ${sectionName(k)} up"${i?'':' disabled'}><span class="profile-up">${svg('down')}</span></button><button type="button" class="icon-btn" data-move="${k}" data-step="1" aria-label="Move ${sectionName(k)} down"${i===order.length-1?' disabled':''}>${svg('down')}</button></div>`;}).join('');
        $$('[data-show]',box).forEach(input=>input.onchange=()=>{if(!valid())return;const k=input.dataset.show;value.sections=order.filter(x=>x===k?input.checked:value.sections.includes(x));input.closest('.me-edit-row').classList.toggle('off',!input.checked);periodChoices();changed(`${sectionName(k)} ${input.checked?'shown':'hidden'}.`);});
        $$('[data-move]',box).forEach(button=>button.onclick=()=>{if(!valid())return;const i=order.indexOf(button.dataset.move),j=i+Number(button.dataset.step);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];value.sections=order.filter(k=>value.sections.includes(k));changed(`${names[button.dataset.move]} moved ${button.dataset.step==='1'?'down':'up'}.`);rows({key:button.dataset.move,step:button.dataset.step});});
        if(focus){const b=$(`[data-move="${focus.key}"][data-step="${focus.step}"]`,box);(b.disabled?$(`[data-show="${focus.key}"]`,box):b).focus({preventScroll:true});}
      };
      const periodChoices=()=>{
        const enabled=value.sections.includes(chosenPeriod),target=$('[data-card-period]',box);target.innerHTML=Object.entries({totals:'All time',recent:'Last 30 days'}).map(([k,l])=>chip('number-period',k,l,k===chosenPeriod)).join('');
        $$('[data-number-period]',target).forEach(button=>{button.disabled=!enabled;button.onclick=()=>{if(!valid()||!enabled)return;const k=button.dataset.numberPeriod;order=order.map(x=>x===chosenPeriod?k:x);value.sections=value.sections.map(x=>x===chosenPeriod?k:x);chosenPeriod=k;rows();periodChoices();$(`[data-number-period="${k}"]`,box).focus({preventScroll:true});changed('Period updated.');};});
      };
      const choices=(group,key,catalog,min)=>{
        const target=$(`[data-card-${key}]`,box);target.innerHTML=Object.entries(catalog).map(([k,l])=>chip(group,k,l,value[key].includes(k))).join('');
        $$(`[data-${group}]`,target).forEach(button=>button.onclick=()=>{if(!valid())return;const k=button.dataset[group],on=value[key].includes(k);if(on&&value[key].length<=min){status.textContent='Keep at least one number.';return;}if(!on&&value[key].length>=3){status.textContent='Choose up to three.';return;}value[key]=on?value[key].filter(x=>x!==k):[...value[key],k];button.setAttribute('aria-pressed',String(!on));changed(`${key==='stats'?'Headline numbers':'Featured sports'} updated.`);});
      };
      rows();periodChoices();choices('stat','stats',stats,1);choices('sport','sports',Object.fromEntries(ProfileLayout.sports.map(k=>[k,SPORT_NAMES[k]||k])),0);
      name.oninput=()=>{nameError.textContent='';name.removeAttribute('aria-invalid');changed();};
      bio.oninput=()=>{$('[data-card-bio-count]',box).textContent=bio.value.length+'/280';sizeBio();changed();};
      $('[data-card-photo]',box).onclick=()=>{if(!valid())return;profilePhotoSheet(()=>{if(!valid())return;const photo=$('[data-card-photo]',box);photo.innerHTML=avatar(App.me,'lg')+'<small>Change</small>';const original=$('.me-card-id .me-card-avatar',card);if(original)original.innerHTML=avatar(App.me,'lg');invalidate('/api/me');invalidate('/api/people/');keep('/api/me',App.me);status.textContent='Photo saved. Your other edits are kept.';});};
      const close=()=>{finish();if(fromSettings&&live())go('/me',{replace:true});};
      const cancel=$('[data-card-cancel]',box);cancel.onclick=()=>{if(valid()&&!busy&&(!dirty()||confirm('Discard your changes?')))close();};
      form.onsubmit=async e=>{
        e.preventDefault();if(!valid()||busy||!dirty())return;
        const trimmed=name.value.trim();if(!trimmed||trimmed.length>60){nameError.textContent='Enter a name between 1 and 60 characters.';name.setAttribute('aria-invalid','true');name.focus();return;}
        const body={name:trimmed,bio:bio.value.trim(),profile_layout:ProfileLayout.singlePeriod(value)};
        busy=true;cancel.disabled=true;save.disabled=true;save.textContent='Saving…';status.textContent='';
        try{
          const account=await api('/api/account',json('PUT',body));if(owner!==readOwner())return;
          App.me.name=account.name??body.name;App.me.bio=account.bio??body.bio;App.me.profile_layout=account.profile_layout||body.profile_layout;
          invalidate('/api/me');invalidate('/api/people/');invalidateFeed();keep('/api/me',App.me);
          if(valid()){finish(true);toast('Card saved');if(fromSettings)go('/me',{replace:true});else (onSaved||reload)?.();}
        }catch(x){if(valid()){status.textContent=x.message;save.textContent='Save';busy=false;cancel.disabled=false;changed();}}
      };
      sizeBio();if(focusName){card.scrollIntoView({block:'start'});name.focus({preventScroll:true});}else $('[data-show]',box)?.focus({preventScroll:true});
    }
    function finish(saved=false){editing=false;dim(false);draw();if(!data)load();$('[data-card-edit]',card).focus({preventScroll:true});onEditEnd?.({saved});}
    if(data?.mine===false){draw();return {};}
    if(!full&&card.querySelector('.me-card-avatar[href]'))card.addEventListener('click',e=>{
      if(!live()||editing||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.target.closest(CARD_OWN+',summary,.me-chart-scroll')||globalThis.getSelection?.()?.toString())return;
      go(profileHref(App.me));
    });
    $('[data-card-edit]',card).onclick=edit;
    $('[data-card-share]',card).onclick=shareSheet;
    if(data)draw();else load();
    return {edit};
  }
  return {header,card,ownPills,ownFriends,mount,firstName,openEditor:()=>go('/me?edit=profile')};
})();
