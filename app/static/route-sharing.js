// Shared originals always reauthorize. Deliberate private copies use the normal owned-route library.
'use strict';
const RouteShare = (() => {
  const scope = () => App.me ? `${serverKey()}:${App.me.id}:` : null;
  const key = (kind, id) => scope() ? `kinetta.routeShare:${scope()}${kind}:${id}` : null;
  const alive = (el, owner) => el.isConnected && owner === readOwner() && !el.closest('[inert]');
  const note = 'People receive only this preview. Deliberate copies, exports and screenshots cannot be recalled.';
  const audience = value => ({me:'Only me',friends:'Approved friends',everyone:'Everyone on this server'}[value] || value);
  function keep(kind,id,data) { const k=key(kind,id);if(k)try{localStorage.setItem(k,JSON.stringify(data));return true;}catch(_){}return false; }
  function eraseDevice(){if(!scope())return;const prefix=`kinetta.routeShare:${scope()}`;for(const k of Object.keys(localStorage))if(k.startsWith(prefix))localStorage.removeItem(k);}

  async function owner(route, previous) {
    const account=readOwner();let state;
    try{state=await api(`/api/planned-routes/${route.id}/sharing`);}catch(e){toast(e.message);return;}
    if(account!==readOwner())return;
    const saved=previous || store.get(key('draft',route.id)) || {};
    const draft={audience:state.audience==='me'?'friends':state.audience,name:route.name,description:'',start_m:0,end_m:route.distance_m,...saved};
    const full=Plan.enc(Plan.line(route.legs.map(l=>({line:l.line}))));
    sheet('Share this route',`<p>Currently <b>${esc(audience(state.audience))}</b>. A private edit does not update the shared copy.</p>
      ${state.disabled?'<p class="err" role="alert">Sharing was removed after a report. Your private route remains. Contact support before sharing it again.</p>':`<form class="form" id="route-share-form">
      <label>Who can see it<select name="audience"><option value="friends"${draft.audience==='friends'?' selected':''}>Approved friends</option><option value="everyone"${draft.audience==='everyone'?' selected':''}>Everyone on this server</option></select></label>
      <label>Public route name<input name="name" required maxlength="120" value="${esc(draft.name)}"></label>
      <label>Public description (optional)<textarea name="description" maxlength="2000" rows="3">${esc(draft.description)}</textarea></label><p class="small muted">Your private notes are not copied into this field.</p>
      <button type="button" class="ghost wide" id="route-share-stretch">Choose the shared stretch</button>
      <p id="route-share-selection" class="small muted">The server also applies your start/end protection.</p>
      <p class="err" id="route-share-error" role="alert"></p><button class="primary wide">Preview for recipients</button></form>`}
      ${state.audience!=='me'?'<button type="button" class="ghost wide" id="route-unshare">Make the original private</button><p class="small muted">This revokes the original link. Existing deliberate copies and downloads remain with their owners.</p>':''}`, (body,close)=>{
      const form=$('#route-share-form',body);
      const remember=()=>{if(!form||!alive(form,account))return;for(const name of ['audience','name','description'])draft[name]=form.elements[name].value;keep('draft',route.id,draft);};
      if(form){
        form.oninput=remember;
        $('#route-share-stretch',body).onclick=()=>{remember();close();stretchSheet('Choose the public stretch',full,{note:'<p>Your endpoint privacy protection still applies. The next preview shows the exact recipient route.</p>',onUse:async(a,z,done)=>{draft.start_m=a;draft.end_m=z;keep('draft',route.id,draft);done();owner(route,draft);}});};
        form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;remember();const button=$('button.primary',form);if(button.disabled)return;button.disabled=true;$('#route-share-error',body).textContent='';
          try{const p=await api(`/api/planned-routes/${route.id}/sharing/preview`,json('POST',draft));if(!alive(form,account))return;close();preview(route,draft,p);}
          catch(x){if(alive(form,account))$('#route-share-error',body).textContent=x.message+' Your draft is kept.';}finally{if(form.isConnected)button.disabled=false;}
        };
      }
      const unshare=$('#route-unshare',body);if(unshare)unshare.onclick=()=>{close();sheet('Make the original private?',`<p>Friends and other members lose access to this original route. ${esc(note)}</p><button class="primary wide" id="route-unshare-confirm">Make private</button><p class="err" role="alert" id="route-unshare-error"></p>`,(box,done)=>{
        $('#route-unshare-confirm',box).onclick=async e=>{const b=e.currentTarget;if(b.disabled)return;b.disabled=true;try{await api(`/api/planned-routes/${route.id}/unshare`,json('POST',{revision:state.revision}));if(!alive(box,account))return;done();toast('Original route is private');render();}catch(x){if(alive(box,account))$('#route-unshare-error',box).textContent=x.message;}finally{if(b.isConnected)b.disabled=false;}};
      });};
    });
  }

  function preview(route,draft,p){
    const account=readOwner(),r=p.route;
    sheet('Recipient preview',`<div class="plan-detail-map" id="route-preview-map"></div><h2>${esc(r.name)}</h2>
      <p>${esc(SPORT_NAMES[r.sport])} · ${U.dist(r.distance_m)} ${U.du()}${r.ascent_m==null?' · climb unknown':` · ↑ ${U.elev(r.ascent_m)} ${U.eu()}`}</p>
      ${r.description?`<p class="route-public-notes">${esc(r.description)}</p>`:''}<p>Visible to <b>${esc(audience(p.audience))}</b>.</p>
      <p class="small muted">This is the entire route and description recipients receive. It contains no activity times, hidden waypoints or private notes.</p><p>${esc(note)}</p>
      <label class="check-row"><input type="checkbox" id="route-share-confirmed"><span>I reviewed this exact route and audience</span></label>
      <button class="primary wide" id="route-share-publish">Share this preview</button><button class="ghost wide" id="route-share-back">Back to edit</button><p class="err" role="alert" id="route-share-publish-error"></p>`,(body,close)=>{
      mapInto($('#route-preview-map',body),[r.line],{sport:r.sport}).catch(()=>{});
      $('#route-share-back',body).onclick=()=>{close();owner(route,draft);};
      $('#route-share-publish',body).onclick=async e=>{const b=e.currentTarget;if(b.disabled)return;if(!$('#route-share-confirmed',body).checked){$('#route-share-publish-error',body).textContent='Confirm the route and audience before sharing.';return;}b.disabled=true;
        try{await api(`/api/planned-routes/${route.id}/sharing`,json('PUT',{preview_id:p.preview_id,confirmed:true}));if(!alive(body,account))return;store.del(key('draft',route.id));close();toast('Route shared');go(`/routes/shared/${route.id}`);}
        catch(x){if(alive(body,account))$('#route-share-publish-error',body).textContent=x.message+' Go back to review again if it changed.';}finally{if(b.isConnected)b.disabled=false;}
      };
    });
  }

  async function browse(body){
    const account=readOwner(),q=new URLSearchParams(location.search),scope=q.get('scope')||'everyone';
    body.innerHTML=`<p class="small muted">Shared plans, not live locations or activity records.</p>
      <form class="form route-find" id="route-shared-find"><input type="hidden" name="scope" value="${scope==='friends'?'friends':'everyone'}"><div class="chips" role="group" aria-label="Shared routes audience"><button type="button" class="chip" data-route-scope="everyone" aria-pressed="${scope==='everyone'}">Everyone routes</button><button type="button" class="chip" data-route-scope="friends" aria-pressed="${scope==='friends'}">Shared by friends</button></div>
      <label>Name<input type="search" name="q" maxlength="120" value="${esc(q.get('q')||'')}"></label>
      <details><summary>Sport, distance and map area</summary><label>Sport<select name="sport"><option value="">All sports</option>${PLAN_SPORTS.map(([s,n])=>`<option value="${s}"${q.get('sport')===s?' selected':''}>${n}</option>`).join('')}</select></label><div class="route-filter-pair"><label>Minimum distance (km)<input type="number" min="0" max="500" step=".1" name="min_km" value="${esc(q.get('min_km')||'')}"></label><label>Maximum distance (km)<input type="number" min="0" max="500" step=".1" name="max_km" value="${esc(q.get('max_km')||'')}"></label></div>
      <div class="route-filter-pair"><label>Minimum climb (m)<input type="number" min="0" max="30000" name="min_climb" value="${esc(q.get('min_climb')||'')}"></label><label>Maximum climb (m)<input type="number" min="0" max="30000" name="max_climb" value="${esc(q.get('max_climb')||'')}"></label></div>
      <p class="small muted">Move the map, then choose Search this map area. This never starts location tracking.</p><button type="button" class="ghost wide" id="route-search-area">Search this map area</button>${q.has('lat')?'<button type="button" class="ghost wide" id="route-search-anywhere">Search anywhere</button>':''}</details>
      <button class="primary wide">Search routes</button></form><div class="seg-map" id="route-shared-map" aria-label="Shared route search map"></div><p id="route-shared-status" role="status"></p><div id="route-shared-results">${skel(2)}</div><button class="ghost wide" id="route-shared-more" hidden>Show more</button>`;
    const form=$('#route-shared-find',body),params=()=>{const p=new URLSearchParams({view:'shared'});for(const name of ['scope','q','sport','min_km','max_km','min_climb','max_climb'])if(form.elements[name].value)p.set(name,form.elements[name].value);return p;};
    const search=p=>go('/routes?'+p,{replace:true});$$('[data-route-scope]',body).forEach(b=>b.onclick=()=>{form.elements.scope.value=b.dataset.routeScope;search(params());});form.onsubmit=e=>{e.preventDefault();const p=params();for(const name of ['lat','lon','radius_km'])if(q.has(name))p.set(name,q.get(name));search(p);};
    const mapBox=$('#route-shared-map',body);let map=null,displayed=[],fitted=false;const drawMap=()=>{if(!map)return;map.group.clearLayers();for(const r of displayed)map.L.polyline(decode(r.line),{color:col('--route'),weight:4}).addTo(map.group).on('click',()=>go(`/routes/shared/${r.id}`));if(displayed.length&&!fitted&&!q.has('lat')){map.map.fitBounds(map.L.latLngBounds(displayed.flatMap(r=>decode(r.line))),{padding:[24,24],maxZoom:14});fitted=true;}};
    mapInto(mapBox,[],{ends:false}).then(v=>{if(!alive(body,account))return;map=v;drawMap();if(q.has('lat')&&q.has('lon'))v.map.setView([+q.get('lat'),+q.get('lon')],12);}).catch(()=>{});
    $('#route-search-area',body).onclick=()=>{if(!map){toast('The map is still opening. Try again.');return;}const p=params(),center=map.map.getCenter();p.set('lat',center.lat.toFixed(5));p.set('lon',center.lng.toFixed(5));p.set('radius_km','10');search(p);};
    const anywhere=$('#route-search-anywhere',body);if(anywhere)anywhere.onclick=()=>search(params());
    let next=null,loading=false,seen=new Set();
    const load=async append=>{if(loading)return;loading=true;const more=$('#route-shared-more',body);more.disabled=true;$('#route-shared-status',body).textContent=append?'Finding more routes…':'Checking shared routes…';
      try{const p=new URLSearchParams(q);p.delete('view');if(append&&next)p.set('before',next);const d=await api('/api/shared-routes?'+p);if(!alive(body,account))return;
        const box=$('#route-shared-results',body);if(!append){box.innerHTML='';seen=new Set();displayed=[];map?.group.clearLayers();}
        for(const r of d.rows){if(seen.has(r.id))continue;seen.add(r.id);displayed.push(r);box.insertAdjacentHTML('beforeend',`<a class="card tap row-link" href="/routes/shared/${r.id}">${miniRoute(r.line,r.sport)}<span class="grow"><b>${esc(r.name)}</b><small class="muted">${esc(SPORT_NAMES[r.sport])} · ${U.dist(r.distance_m)} ${U.du()} · ${esc(r.owner.name)}</small></span>${svg('chev')}</a>`);if(map)map.L.polyline(decode(r.line),{color:col('--route'),weight:4}).addTo(map.group).on('click',()=>go(`/routes/shared/${r.id}`));}
        drawMap();if(!seen.size)box.innerHTML='<div class="card empty"><b>No shared routes here</b>Try a wider area, another name or Shared by friends.</div>';
        next=d.next;more.hidden=!next;$('#route-shared-status',body).textContent=seen.size?`${seen.size} shared route${seen.size===1?'':'s'} shown`:'No matching shared routes';
      }catch(e){if(alive(body,account)){$('#route-shared-status',body).textContent=e.message;$('#route-shared-more',body).hidden=false;$('#route-shared-more',body).textContent='Retry';}}
      finally{loading=false;if(more.isConnected)more.disabled=false;}
    };
    $('#route-shared-more',body).onclick=()=>load(!!next);await load(false);
  }

  async function page(el,id){
    const account=readOwner();let serial=0,at=0,current=null;
    el.innerHTML=`<div class="top">${backBtn('Shared routes')}</div><div id="shared-route-body">${skel(2)}</div>`;wireBack(el,'/routes?view=shared');
    const body=$('#shared-route-body',el);
    const unavailable=e=>{current=null;serial++;body.innerHTML=`<div class="card empty"><b>${e.status===404?'This shared route is unavailable':'Could not check this shared route'}</b>${e.status===404?'Its sharing or access may have changed. A deliberate private copy remains in your own routes.':esc(e.message)}<button class="ghost wide" id="shared-route-retry">Check again</button><a class="ghost wide" href="/routes">Your routes</a></div>`;cleanViews();$('#shared-route-retry',body).onclick=()=>load();};
    const failure=e=>{if(alive(el,account)){if([401,403,404,409].includes(e.status))unavailable(e);else toast(e.message);}};
    async function load(){const my=++serial;at=Date.now();try{const d=await api('/api/shared-routes/'+id);if(my!==serial||!alive(el,account))return;if(current?.snapshot_key===d.snapshot_key)return;current=d;draw(d);}catch(e){if(my===serial&&alive(el,account))unavailable(e);}}
    function draw(d){
      body.innerHTML=`<h1>${esc(d.name)}</h1><p class="muted">${esc(SPORT_NAMES[d.sport])} · Route plan · by ${esc(d.owner.name)}</p><div class="plan-detail-map" id="shared-route-map"></div>
        <div class="bigstat">${stat('Distance',`${U.dist(d.distance_m)} ${U.du()}`)}${stat('Climb',d.ascent_m==null?'Unknown':`${U.elev(d.ascent_m)} ${U.eu()}`)}</div>
        ${d.description?`<p class="route-public-notes">${esc(d.description)}</p>`:''}${d.warnings.length?`<p class="plan-warn">${esc(d.warnings.map(w=>w.text).join(' '))}</p>`:''}
        <p class="small muted">This is a planned route, not an activity or live location. You receive only the shared stretch.</p><button class="primary wide" id="shared-route-copy">Save a private copy</button>
        <div class="card list"><button class="row-link" id="shared-route-download">${svg('download')}<span class="grow">Download shared GPX</span>${svg('chev')}</button><button class="row-link" id="shared-route-link">${svg('share')}<span class="grow">Share this link</span>${svg('chev')}</button><button class="row-link" id="shared-route-report">${svg('flag')}<span class="grow">Report shared route</span>${svg('chev')}</button></div>`;
      cleanViews();mapInto($('#shared-route-map',body),[d.line],{sport:d.sport}).catch(()=>{});
      $('#shared-route-copy',body).onclick=()=>{if(alive(el,account))copy(d,el,failure);};
      $('#shared-route-download',body).onclick=()=>{if(alive(el,account))download(d,el,failure);};
      $('#shared-route-link',body).onclick=async()=>{if(!alive(el,account))return;const url=(Native.base||location.origin)+`/routes/shared/${id}`;try{if(navigator.share){await navigator.share({title:d.name,url});return;}}catch(e){if(e.name==='AbortError')return;}sheet('Share route link',`<p>People must sign in on this server and still have access. Sending the link changes no audience.</p><label>Link<input readonly value="${esc(url)}"></label>`);};
      $('#shared-route-report',body).onclick=()=>{if(alive(el,account))report(d,el,failure);};
    }
    const refresh=()=>{if(alive(el,account)&&!document.hidden&&Date.now()-at>3000){current=null;body.innerHTML=skel(2);cleanViews();load();}};
    document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);
    viewResources.set(el,()=>{serial++;document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);});await load();
  }

  function copy(d,el,failure){
    const account=readOwner(),prior=store.get(key('copy',d.id));const pending=prior?.snapshot_key===d.snapshot_key?prior:{client_id:crypto.randomUUID(),snapshot_key:d.snapshot_key};
    sheet('Save your own copy?',`<p>You will save only this shared ${U.dist(d.distance_m)} ${U.du()} route, named <b>${esc(d.name)}</b>. Your copy starts private and can be edited independently. Changes or removal of the original do not recall your copy.</p><button class="primary wide" id="shared-route-copy-confirm">Save private copy</button><p class="err" id="shared-route-copy-error" role="alert"></p>`,(body,close)=>{
      $('#shared-route-copy-confirm',body).onclick=async e=>{const b=e.currentTarget;if(b.disabled)return;if(!keep('copy',d.id,pending)){$('#shared-route-copy-error',body).textContent='This device could not keep the retry receipt. Free some storage and try again.';return;}b.disabled=true;
        try{const r=await api(`/api/shared-routes/${d.id}/copy`,json('POST',pending));if(!alive(body,account)||!alive(el,account))return;store.del(key('copy',d.id));close();invalidate('/api/planned-routes');toast('Private independent copy saved');go(`/routes/plan/${r.id}`);}
        catch(x){if(alive(body,account))$('#shared-route-copy-error',body).textContent=x.message+' If the response was lost, retry this confirmation or check your routes.';if([401,403,404].includes(x.status)){close();failure(x);}}
        finally{if(b.isConnected)b.disabled=false;}
      };
    });
  }

  function download(d,el,failure){
    const account=readOwner();sheet('Download shared route?',`<p>The file contains exactly the shared path, name and public description shown here. No hidden points, activity times or private notes. Downloads cannot be recalled.</p><button class="primary wide" id="shared-route-download-confirm">Download GPX</button><p class="err" id="shared-route-download-error" role="alert"></p>`,(body,close)=>{
      $('#shared-route-download-confirm',body).onclick=async e=>{const b=e.currentTarget;if(b.disabled)return;b.disabled=true;try{
        if(Native.on){const r=await api(`/api/shared-routes/${d.id}/gpx-link`,json('POST',{snapshot_key:d.snapshot_key}));if(!alive(body,account))return;window.open(Native.base+r.path,'_blank');toast('Opening Safari to download the shared route');}
        else{const response=await fetch(`/api/shared-routes/${d.id}/gpx?snapshot_key=${d.snapshot_key}`,{credentials:'same-origin',headers:{'X-Kinetta-Account':String(App.me.id)}});if(!response.ok)throw Object.assign(Error('The shared route changed or is unavailable. Check access again.'),{status:response.status});const blob=await response.blob();if(!alive(body,account)||!alive(el,account))return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='shared-route.gpx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}close();
      }catch(x){if(alive(body,account))$('#shared-route-download-error',body).textContent=x.message;if([401,403,404,409].includes(x.status)){close();failure(x);}}finally{if(b.isConnected)b.disabled=false;}};
    });
  }

  function report(d,el,failure){
    const account=readOwner();sheet('Report shared route',`<form class="form" id="shared-route-report-form"><label>Reason<select name="reason"><option value="unsafe">Unsafe or restricted access</option><option value="privacy">Personal location disclosed</option><option value="inaccurate">Inaccurate route</option><option value="abusive">Abusive name or description</option></select></label><label>What should the moderator check?<textarea name="note" maxlength="500" rows="3"></textarea></label><p class="small muted">A report does not remove a route automatically. Your identity is not shown to its creator.</p><button class="primary wide">Send report</button><p class="err" role="alert"></p></form>`,(body,close)=>{
      const f=$('#shared-route-report-form',body);f.onsubmit=async e=>{e.preventDefault();const b=$('button',f);if(b.disabled)return;b.disabled=true;try{await api(`/api/shared-routes/${d.id}/report`,json('POST',{reason:f.elements.reason.value,note:f.elements.note.value}));if(!alive(body,account)||!alive(el,account))return;close();toast('Report sent for review');}catch(x){if(alive(body,account))$('.err',f).textContent=x.message;if([401,403,404].includes(x.status)){close();failure(x);}}finally{if(b.isConnected)b.disabled=false;}};
    });
  }
  return {owner,browse,page,eraseDevice};
})();
route(/^\/routes\/shared\/(\d+)$/,'progress',(el,id)=>RouteShare.page(el,+id));
