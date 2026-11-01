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
 function highlights(a,{shared=false}={}){
  if(shared)return '';
  const rows=[];
  if(a.route_id&&a.route_name)rows.push(`<a href="/route/${a.route_id}" class="detail-highlight" data-type="secondary">${svg('route')}Matched: ${esc(a.route_name)}</a>`);
  const best=(a.efforts||[]).find(e=>e.rank_then===1&&e.label);
  if(best)rows.push(`<button type="button" class="detail-highlight" data-type="secondary" data-detail-tab="efforts">${svg('trophy')}${esc(best.label)} best</button>`);
  return rows.length?`<div class="detail-highlights">${rows.join('')}</div>`:'';
 }
 function title(a,hero,{shared=false,socialId=shared?'s-soc':'d-soc'}={}){
  const kit=!shared&&(a.ai_note||aiCan('coach'))?`<button type="button" class="me-chip detail-kit" id="d-kit" aria-label="${kitChatOn()?'Ask Kit about this activity':'Kit’s workout note'}">${svg('sparkle')}Kit</button>`:'';
  return `<section class="d-title card compact-detail-title"><div class="detail-title-row"><h1>${esc(a.name)}</h1></div><div class="detail-date-row">${sportMark(a.sport)}<p class="detail-date">${date(a,{shared})}</p>${kit}</div>${shared&&a.owner?`<a class="detail-owner" href="${profileHref(a.owner)}">${esc(a.owner.name)}</a>`:''}
    <div class="hero detail-primary">${hero}</div>${secondary(a,{shared})}${highlights(a,{shared})}<div class="detail-social" id="${socialId}"${!shared?' hidden':''}></div>${!shared?'<div id="d-milestones"></div>':''}</section>`;
 }
 function header(a,{mine=true,mapped=!!a.line,backLabel='Activity'}={}){
  const bar=sticky=>`<header class="detail-bar ${mapped?(sticky?'detail-sticky':'detail-floating'):'top'}"${sticky?' hidden':''}><button type="button" class="back" data-back aria-label="Back to ${esc(backLabel)}">${svg('back')}<span>${esc(backLabel)}</span></button>${sticky?`<b class="detail-bar-title">${esc(a.name)}</b>`:''}<div class="acts">${mine?`<button type="button" class="icon-btn"${sticky?'':' id="d-send"'} data-detail-share aria-label="Share activity">${svg('share')}</button><button type="button" class="icon-btn"${sticky?'':' id="d-edit"'} data-detail-edit aria-label="Edit activity">${svg('edit')}</button>`:''}</div></header>`;
  return {floating:bar(false),sticky:mapped?bar(true):''};
 }
 function wire(root,a,{mine=true,back='/activity'}={}){
  wireBack(root,back);const first=$('[data-back]',root);$$('[data-back]',root).forEach(button=>button.onclick=first.onclick);
  if(mine){$$('[data-detail-share]',root).forEach(button=>button.onclick=()=>shareOut(a));$$('[data-detail-edit]',root).forEach(button=>button.onclick=()=>editActivity(a));}
  $$('[data-detail-tab]',root).forEach(button=>button.onclick=()=>{const tab=$(`[data-dt="${button.dataset.detailTab}"]`,root);tab?.click();tab?.scrollIntoView({block:'nearest'});});
  const hero=$('.detail-map-hero',root),sticky=$('.detail-sticky',root);
  if(hero&&sticky){const observer=new IntersectionObserver(([entry])=>{if(root.isConnected)sticky.hidden=entry.isIntersecting||entry.boundingClientRect.bottom>0;});observer.observe(hero);viewResources.set(sticky,()=>observer.disconnect());}
 }
 return {secondary,date,highlights,title,header,wire};
})();
