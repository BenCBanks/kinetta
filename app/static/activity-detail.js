// Shared detail presentation uses only the existing owner/shared response, never another account lookup.
'use strict';
const ActivityDetail=(()=>{
 const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 function secondary(a,{shared=false}={}){
  const rows=[],allowed=key=>!shared||a.shares?.[key]===true;
  if(allowed('elevation')&&positive(a.ascent_m))rows.push(stat('Elevation',U.elev(a.ascent_m),U.eu()));
  if(allowed('heart_rate')&&positive(a.avg_hr))rows.push(stat('Avg HR',Math.round(a.avg_hr),'bpm'));
  if(allowed('calories')&&positive(a.calories))rows.push(stat('Calories',Math.round(a.calories),'kcal'));
  if(!shared&&positive(a.avg_cad))rows.push(stat('Cadence',Math.round(a.avg_cad),a.sport==='ride'?'rpm':'spm'));
  return rows.length?`<div class="detail-secondary" aria-label="More workout numbers">${rows.slice(0,3).join('')}</div>`:'';
 }
 function date(a,{shared=false}={}){
  const when=fdate(a.start_time,{weekday:'short',month:'short',day:'numeric'}).replace(/,/g,''),visibility=!shared?{me:'Only me',friends:'Friends',everyone:'Everyone'}[a.visibility]:null;
  return `${esc(when)} · ${esc(ftime(a.start_time))}${visibility?' · '+esc(visibility):''}`;
 }
 let achievementCatalogPromise=null;
 function loadAchievementCatalog(){
  if(!achievementCatalogPromise)achievementCatalogPromise=fetch('/static/profile.achievement-levels.json?v=__ASSET_HASH__').then(r=>{if(!r.ok)throw Error('Achievement levels are unavailable.');return r.json();}).catch(error=>{achievementCatalogPromise=null;throw error;});
  return achievementCatalogPromise;
 }
 const finite=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
 function activityDelta(code,a){
  if(a.lift_open)return 0;
  const distance=finite(a.distance_m),active=finite(a.moving_s)||finite(a.elapsed_s);
  if(code==='workouts')return 1;
  if(code==='active_time')return active;
  if(code==='journey')return distance;
  if(code==='climbing')return finite(a.ascent_m);
  if(code==='lifted')return finite(a.lifts?.volume);
  if(code==='personal_bests')return Array.isArray(a.efforts)?a.efforts.filter(e=>Number(e.rank_then)===1).length:0;
  if(code==='sport:run'&&a.sport==='run')return distance;
  if(code==='sport:ride'&&a.sport==='ride')return distance;
  if(code==='sport:walk-hike'&&['walk','hike'].includes(a.sport))return distance;
  if(code==='sport:swim'&&a.sport==='swim')return distance;
  if(code==='sport:lift'&&a.sport==='workout')return 1;
  return 0;
 }
 function canonicalThreshold(tier){
  const value=Number(tier?.canonical_value);if(!Number.isFinite(value)||value<=0)return NaN;
  return tier.canonical_unit==='km'?value*1000:tier.canonical_unit==='hours'?value*3600:value;
 }
 function nextTier(track,catalog){
  const levels=catalog?.tracks?.[track?.code]?.levels;if(!Array.isArray(levels)||!levels.length)return null;
  const value=Number(track.value??track.value_m??track.value_kg??track.value_s??track.value_weeks??track.value_years??track.value_sessions);
  if(!Number.isFinite(value)||value<0)return null;
  const thresholds=levels.map(canonicalThreshold),index=thresholds.findIndex(n=>n>value+1e-7);
  if(index>=0)return {...levels[index],threshold:thresholds[index],level:index+1};
  const last=levels.at(-1),base=thresholds.at(-1);if(!(base>0))return null;
  const multiple=Math.floor((value+1e-7)/base)+1;
  return {...last,name:`${last.name} ×${multiple}`,threshold:base*multiple,level:levels.length+multiple-1,multiple};
 }
 function remainingText(code,value){
  if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(code)){
   const imperial=App.me?.units!=='metric',shown=imperial?value/1609.344:value/1000;
   return `${shown.toLocaleString(undefined,{maximumFractionDigits:shown<1?2:1})} ${imperial?'mi':'km'}`;
  }
  if(code==='climbing')return `${U.elev(value)} ${U.eu()}`;
  if(code==='lifted')return `${U.weight(value)} ${App.me?.units==='metric'?'kg':'lb'}`;
  if(code==='active_time')return `${(value/3600).toLocaleString(undefined,{maximumFractionDigits:1})} h`;
  const count=Math.max(0,Math.ceil(value-1e-9)).toLocaleString();
  if(code==='consistency')return `${count} ${Math.ceil(value-1e-9)===1?'week':'weeks'}`;
  if(code==='years_active')return `${count} ${Math.ceil(value-1e-9)===1?'year':'years'}`;
  if(code==='personal_bests')return `${count} ${Math.ceil(value-1e-9)===1?'personal best':'personal bests'}`;
  if(code==='sport:lift')return `${count} ${Math.ceil(value-1e-9)===1?'session':'sessions'}`;
  return `${count} workouts`;
 }
 function medalIcon(catalog,track,tier){
  const medalLevel=levels=>(Array.isArray(levels)?levels:[]).find(level=>String(level.asset_name||'').toLowerCase()==='sports medal');
  const medal=medalLevel(catalog?.tracks?.[track?.code]?.levels)||medalLevel(Object.values(catalog?.tracks||{}).flatMap(item=>item.levels||[]));
  const timer=/^(?:stopwatch|timer)$/i.test(String(tier?.asset_name||''));
  return (timer?medal?.icon:tier?.icon)||medal?.icon||tier?.icon||'';
 }
 function fitMedalCopy(link,full,compact){
  const copy=link.querySelector('.activity-next-medal-copy');if(!copy)return;
  copy.textContent=full;link.classList.remove('is-tight');link.style.removeProperty('font-size');
  if(copy.clientWidth&&copy.scrollWidth>copy.clientWidth+1)copy.textContent=compact;
  if(copy.clientWidth&&copy.scrollWidth>copy.clientWidth+1){
   link.classList.add('is-tight');
   for(let i=0;i<4&&copy.scrollWidth>copy.clientWidth+1;i++){
    const size=parseFloat(getComputedStyle(link).fontSize)||13;
    link.style.fontSize=`${Math.max(8,size*copy.clientWidth/copy.scrollWidth-.15)}px`;
   }
  }
  link.setAttribute('aria-label',copy.textContent);
 }
 function recent(a){
  const created=Date.parse(a.created||a.start_time||'');return Number.isFinite(created)&&created<=Date.now()+60_000&&Date.now()-created<=86_400_000;
 }
 async function paintNextMedal(node,a){
  if(!node||!a||a.owner||!recent(a))return;
  const owner=readOwner(),stamp=Symbol('next-medal');node._nextMedalStamp=stamp;node.replaceChildren();
  const live=()=>node.isConnected&&owner===readOwner()&&node._nextMedalStamp===stamp;
  try{
   const sharing=await api('/api/sharing');if(!live()||sharing?.share_achievements!==true)return;
   const [catalog]=await Promise.all([loadAchievementCatalog()]);if(!live())return;
   let data=null;
   for(let attempt=0;attempt<8;attempt++){
    data=await api('/api/achievements');if(!live())return;
    if(data?.pending!==true)break;
    if(attempt===7)return;
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   const candidates=(Array.isArray(data?.tracks)?data.tracks:[]).map(track=>{
    const delta=activityDelta(track.code,a),after=Number(track.value??track.value_m??track.value_kg??track.value_s??track.value_weeks??track.value_years??track.value_sessions);
    if(!(delta>0)||!Number.isFinite(after)||after<delta)return null;
    const before=after-delta,tier=nextTier(track,catalog);if(!tier)return null;
    const beforeGap=tier.threshold-before,remaining=tier.threshold-after;
    if(!(beforeGap>0)||remaining<0||remaining>beforeGap*.25+1e-7)return null;
    return {track,tier,remaining,ratio:remaining/beforeGap};
   }).filter(Boolean).sort((left,right)=>left.ratio-right.ratio||left.track.code.localeCompare(right.track.code));
   if(!live()||!candidates.length)return;
   const best=candidates[0],remaining=remainingText(best.track.code,best.remaining),full=`${remaining} to your ${best.tier.name} medal`,compact=`${remaining} to ${best.tier.name}`;
   const href=`/me/achievements/${encodeURIComponent(best.track.code)}`,icon=medalIcon(catalog,best.track,best.tier);
   node.innerHTML=`<a class="activity-next-medal" href="${esc(href)}"><span class="activity-next-medal-copy"></span><img src="${esc(icon)}" alt="" aria-hidden="true" loading="lazy" decoding="async"></a>`;
   const link=node.querySelector('.activity-next-medal'),fit=()=>fitMedalCopy(link,full,compact);fit();
   if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(fit);observer.observe(node);const dispose=viewResources.get(node);
    viewResources.set(node,()=>{observer.disconnect();dispose?.();});
   }
  }catch(_){/* The workout remains available if optional achievement data is unavailable. */}
 }
 async function nextMedalForId(node,id){
  if(!node||!/^\d+$/.test(String(id)))return;
  const owner=readOwner();try{const a=await api(`/api/activities/${id}`);if(node.isConnected&&owner===readOwner())await paintNextMedal(node,a);}catch(_){/* No optional line when the saved activity cannot be read. */}
 }
 function highlights(a,{shared=false}={}){
  if(shared)return '';
  const rows=[];
  if(a.route_id&&a.route_name)rows.push(`<a href="/route/${a.route_id}" class="detail-highlight" data-type="secondary">${svg('route')}Matched: ${esc(a.route_name)}</a>`);
  const best=(a.efforts||[]).find(e=>e.rank_then===1&&e.label);
  if(best)rows.push(`<button type="button" class="detail-highlight" data-type="secondary" data-detail-tab="efforts">${svg('trophy')}${esc(best.label)} best</button>`);
  return rows.length?`<div class="detail-highlights">${rows.join('')}</div>`:'';
 }
 function title(a,hero,{shared=false,socialId=shared?'s-soc':'d-soc'}={}){
  const kit=!shared&&(a.ai_note||kitChatOn())?`<button type="button" class="me-chip detail-kit" id="d-kit" aria-label="${kitChatOn()?'Ask Kit about this activity':'Kit’s workout note'}">${svg(kitChatOn()?'sparkle':'clock')}${kitChatOn()?'Kit':'Saved note'}</button>`:'';
  return `<section class="d-title card compact-detail-title"><div class="detail-title-row"><h1>${esc(a.name)}</h1></div><div class="detail-date-row">${sportMark(a.sport)}<p class="detail-date">${date(a,{shared})}</p>${kit}</div>${shared&&a.owner?`<a class="detail-owner" href="${profileHref(a.owner)}">${esc(a.owner.name)}</a>`:''}
    <div class="hero detail-primary">${hero}</div>${secondary(a,{shared})}${!shared?'<div id="d-celebration" class="milestone-celebration-host" aria-live="polite"></div><div id="d-next-medal"></div>':''}${highlights(a,{shared})}<div class="detail-social" id="${socialId}"${!shared?' hidden':''}></div>${!shared?'<div id="d-milestones"></div>':''}</section>`;
 }
 function header(a,{mine=true,mapped=!!a.line,backLabel='Activity'}={}){
  const bar=sticky=>`<header class="detail-bar ${mapped?(sticky?'detail-sticky':'detail-floating'):'top'}"${sticky?' hidden':''}><button type="button" class="back" data-back aria-label="Back to ${esc(backLabel)}">${svg('back')}<span>${esc(backLabel)}</span></button>${sticky?`<b class="detail-bar-title">${esc(a.name)}</b>`:''}<div class="acts">${mine?`<button type="button" class="icon-btn"${sticky?'':' id="d-send"'} data-detail-share aria-label="Share activity">${svg('share')}</button><button type="button" class="icon-btn"${sticky?'':' id="d-edit"'} data-detail-edit aria-label="Edit activity">${svg('edit')}</button>`:''}</div></header>`;
  return {floating:bar(false),sticky:mapped?bar(true):''};
 }
 function wire(root,a,{mine=true,back='/activity',fallbackLabel='Activity'}={}){
  wireBack(root,back,destination=>destination.history?destination.label:fallbackLabel);const first=$('[data-back]',root);$$('[data-back]',root).forEach(button=>button.onclick=first.onclick);
  if(mine){$$('[data-detail-share]',root).forEach(button=>button.onclick=()=>shareOut(a));$$('[data-detail-edit]',root).forEach(button=>button.onclick=()=>editActivity(a));paintNextMedal($('#d-next-medal',root),a);}
  $$('[data-detail-tab]',root).forEach(button=>button.onclick=()=>{const tab=$(`[data-dt="${button.dataset.detailTab}"]`,root);tab?.click();tab?.scrollIntoView({block:'nearest'});});
  const hero=$('.detail-map-hero',root),sticky=$('.detail-sticky',root);
  if(hero&&sticky){const observer=new IntersectionObserver(([entry])=>{if(root.isConnected)sticky.hidden=entry.isIntersecting||entry.boundingClientRect.bottom>0;});observer.observe(hero);viewResources.set(sticky,()=>observer.disconnect());}
 }
 return {secondary,date,highlights,title,header,wire,nextMedalForId};
})();
