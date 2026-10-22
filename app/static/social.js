// Kinetta phone app — Part 5: friends and sharing (2026-10-11). Friends (found by name or username, approved by the
// other person), who sees each activity, which details they see, the Feed, read-only pages for friends' activities,
// cheers and comments. The server decides what anyone else gets (app/api_social.py); these pages only show it.
'use strict';

// The quick appreciation button. Its name lives only here, so it can be renamed in one place.
const CHEER = {verb: 'Cheers', done: 'Cheers sent', many: 'cheers', title: 'Cheers'};   // 'Cheers' everywhere (2026-10-12)
const REACTIONS=[['cheer','Cheers'],['strong','Strong'],['applause','Applause']];
let closeReactionPicker = null;
const reactionIcon = kind => kind==='strong'?'workout':kind==='applause'?'sparkle':'cheer';
function reactionButtons(aid,s,detail=false){
  const selected=s.my_reaction??(s.cheered?'cheer':null),counts=s.reactions||{cheer:Array.isArray(s.cheers)?s.cheers.length:s.cheers||0};
  return `<div class="activity-reactions" role="group" aria-label="Reactions" data-reaction-group data-aid="${aid}" data-mine="${selected||''}" ${REACTIONS.map(([k])=>`data-count-${k}="${counts[k]||0}"`).join(' ')}>
    <div class="reaction-action"><button type="button" class="pf cheer reaction-main" data-cheer="${aid}"${detail?' data-tcheer':''} aria-pressed="${!!selected}">${svg(reactionIcon(selected))}<span class="num">${Object.values(counts).reduce((n,count)=>n+(+count||0),0)}</span></button><button type="button" class="pf reaction-more" aria-label="Choose a reaction" aria-haspopup="menu" aria-expanded="false">${svg('down')}</button></div>
    <button type="button" class="pf reaction-count" aria-label="See who reacted" hidden></button>
    <div class="reaction-picker" role="menu" aria-label="Choose a reaction" hidden>${REACTIONS.map(([kind,label])=>`<button type="button" role="menuitemradio" aria-label="${label}" aria-checked="${selected===kind}" data-react="${kind}" tabindex="-1"><i class="reaction-badge" data-kind="${kind}">${svg(reactionIcon(kind))}</i><span>${label}</span></button>`).join('')}</div></div>`;
}
function wireReactionGroup(group,aid,changed){
  if(!group||group.dataset.bound)return;group.dataset.bound='1';
  const owner=readOwner(),active=()=>group.isConnected&&readOwner()===owner;
  const main=$('.reaction-main',group),more=$('.reaction-more',group),count=$('.reaction-count',group),picker=$('.reaction-picker',group),options=$$('[data-react]',picker);
  let busy=false,state={my_reaction:group.dataset.mine||null,reactions:Object.fromEntries(REACTIONS.map(([k])=>[k,+group.getAttribute('data-count-'+k)||0]))};
  let hoverTimer=null,leaveTimer=null,heldOpen=false;
  const close=(focus=false)=>{
    clearTimeout(hoverTimer);clearTimeout(leaveTimer);if(picker.hidden){if(focus===true&&active())main.focus({preventScroll:true});return;}picker.hidden=true;more.setAttribute('aria-expanded','false');heldOpen=false;
    group.appendChild(picker);if(closeReactionPicker===close)closeReactionPicker=null;
    if(focus&&active())main.focus({preventScroll:true});
  };
  const open=(focus=false)=>{
    if(busy||!active())return;
    if(closeReactionPicker&&closeReactionPicker!==close)closeReactionPicker();closeReactionPicker=close;
    clearTimeout(hoverTimer);clearTimeout(leaveTimer);document.body.appendChild(picker);picker.hidden=false;more.setAttribute('aria-expanded','true');
    const r=main.getBoundingClientRect(),p=picker.getBoundingClientRect(),vv=window.visualViewport;
    const top=vv?.offsetTop||0,bottom=top+(vv?.height||innerHeight),above=r.top-p.height-8;
    picker.style.left=Math.max(12,Math.min(r.left,innerWidth-p.width-12))+'px';
    picker.style.top=Math.max(top+8,Math.min(above>=top+8?above:r.bottom+8,bottom-p.height-8))+'px';
    if(focus)(options.find(b=>b.dataset.react===state.my_reaction)||options[0]).focus({preventScroll:true});
  };
  const draw=()=>{
    if(!active())return;
    const selected=state.my_reaction,label=REACTIONS.find(([k])=>k===selected)?.[1]||'Cheers';
    const used=REACTIONS.filter(([k])=>state.reactions[k]>0),total=used.reduce((n,[k])=>n+state.reactions[k],0);
    main.innerHTML=svg(reactionIcon(selected))+`<span class="num">${total}</span>`;main.dataset.kind=selected||'cheer';main.setAttribute('aria-pressed',String(!!selected));
    main.setAttribute('aria-label',`${selected?label+'. Tap to remove; hold to change':'Cheers. Tap to send; hold to choose'}. ${total} reaction${total===1?'':'s'}`);
    main.disabled=more.disabled=busy;group.setAttribute('aria-busy',String(busy));
    count.hidden=!total;count.innerHTML=`<span class="reaction-icons" aria-hidden="true">${used.map(([k])=>`<i class="reaction-badge" data-kind="${k}">${svg(reactionIcon(k))}</i>`).join('')}</span>`;
    count.setAttribute('aria-label',`${total} reaction${total===1?'':'s'}. See who reacted`);
    for(const b of options){b.setAttribute('aria-checked',String(selected===b.dataset.react));b.disabled=busy;}
  };
  group._sync=fresh=>{if(!busy&&active()){state={my_reaction:fresh.my_reaction,reactions:{...fresh.reactions}};draw();}};
  const choose=async(next)=>{
    const focused=document.activeElement,restoreFocus=group.contains(focused)||picker.contains(focused),host=group.parentElement;
    close();if(busy||!active()||state.my_reaction===next)return;
    busy=true;const was=state,counts={...state.reactions};
    if(state.my_reaction)counts[state.my_reaction]=Math.max(0,(counts[state.my_reaction]||0)-1);if(next)counts[next]=(counts[next]||0)+1;
    state={my_reaction:next,reactions:counts};draw();Native.haptic(next?'medium':'light');
    try{
      let fresh=await api(`/api/activities/${aid}/reaction`,next?json('POST',{kind:next}):{method:'DELETE'});if(!active())return;
      if(!fresh.reactions)fresh=await api(`/api/activities/${aid}/social`);if(!active())return;
      state={my_reaction:fresh.my_reaction,reactions:{...fresh.reactions}};socialChanged(aid);changed?.(fresh);
    }catch(x){if(active()){state=was;toast(x.message);}}finally{busy=false;draw();if(restoreFocus&&readOwner()===owner&&(document.activeElement===document.body||document.activeElement===focused)){const button=active()?main:host?.querySelector('.reaction-main');if(button?.isConnected)button.focus({preventScroll:true});}}
  };
  cheerGesture(main,()=>{if(!picker.hidden){close();return;}choose(state.my_reaction?null:'cheer');},()=>{open();heldOpen=true;});
  main.title='Tap to send or remove; hold to choose a reaction';
  // iOS keeps a held touch captured on its original button. Resolve the release
  // under the finger, so sliding onto a revealed choice selects it just once.
  const release=main.onpointerup,cancel=main.onpointercancel;
  main.onpointerup=e=>{const held=heldOpen;release(e);if(held){const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-react]');if(b&&picker.contains(b))choose(b.dataset.react);}};
  main.onpointercancel=e=>{cancel(e);close();};
  main.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();open(true);}});
  more.onclick=e=>{e.preventDefault();e.stopPropagation();picker.hidden?open(true):close(true);};
  count.onclick=e=>{e.preventDefault();e.stopPropagation();close();activityCheers(aid);};
  for(const b of options)b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(b.dataset.react);if(active())main.focus({preventScroll:true});};
  picker.addEventListener('keydown',e=>{
    const i=options.indexOf(document.activeElement);let next=null;
    if(['ArrowRight','ArrowDown'].includes(e.key))next=(i+1)%options.length;
    if(['ArrowLeft','ArrowUp'].includes(e.key))next=(i+options.length-1)%options.length;
    if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;
    if(next!==null){e.preventDefault();options[next].focus({preventScroll:true});}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    if(e.key==='Tab')close(true);
  });
  const outside=e=>{if(!picker.hidden&&!group.contains(e.target)&&!picker.contains(e.target))close();};
  const escape=e=>{if(e.key==='Escape'&&!picker.hidden){e.preventDefault();close(true);}};
  const scroll=e=>{if(!picker.contains(e.target))close();};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);
  const resize=()=>close();window.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);
  const enter=e=>{if(e.pointerType==='mouse'&&matchMedia('(hover: hover)').matches){clearTimeout(leaveTimer);hoverTimer=setTimeout(()=>open(),250);}};
  const leave=e=>{if(e.pointerType==='mouse'){clearTimeout(hoverTimer);leaveTimer=setTimeout(()=>close(),200);}};
  const action=$('.reaction-action',group);action.addEventListener('pointerenter',enter);action.addEventListener('pointerleave',leave);
  picker.addEventListener('pointerenter',()=>clearTimeout(leaveTimer));picker.addEventListener('pointerleave',leave);
  viewResources.set(group,()=>{close();picker.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);});
  draw();
}

const VIS = {me: 'Only me', friends: 'Friends', everyone: 'Everyone on this Kinetta'};
const VIS_SHORT = {me: 'Only me', friends: 'Friends', everyone: 'Everyone'};
const DETAIL_NAMES = {map: 'Map', heart_rate: 'Heart rate', pace: 'Pace and speed', splits: 'Splits and laps', elevation: 'Elevation',
  calories: 'Calories', description: 'Description', device: 'Device or watch'};
Object.assign(IC, {
  // a party popper (2026-10-12, was a star): the cone fills in once you've cheered
  cheer: '<path class="cone" d="M3.5 20.5 8 9l7 7z"/><path d="M10.5 6.5c.4-1.4-.3-2.4-1.3-2.8M17.5 13.5c1.4-.4 2.4.3 2.8 1.3M13 9.5c1-2.3 2.6-3.4 5-3.2"/><path d="M14.5 3v1M20.5 9h-1M18 4.8l-.7.7M21 4l-.1.1"/>',
  comment: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5M15 15c2.6 0 4.6 1.6 5.5 4.5"/>',
});
const trimName = (m) => (!m ? 'Off' : imp() ? {200: '⅛ mi', 400: '¼ mi', 800: '½ mi'}[m] : `${m} m`);
const profileHref = (p) => `/people/${encodeURIComponent(p.login)}`;
const personLink = (p, label = p.name) => `<a class="person-link" href="${profileHref(p)}">${avatar(p)}<span class="grow"><b>${esc(label)}</b><small class="muted">@${esc(p.login)}</small></span></a>`;

// A tap reacts immediately. A long press opens reaction choices and consumes the following click.
function cheerGesture(button, toggle, show) {
  if (!button || button.dataset.cheerBound) return;
  button.dataset.cheerBound = '1';
  button.title = 'Tap to send or remove this reaction. Hold to choose a reaction.';
  let timer = null, origin = null, suppressUntil = 0, held = false;
  const clear = () => { clearTimeout(timer); timer = null; origin = null; button.classList.remove('cheer-wait'); };
  button.onpointerdown = (e) => {
    clear(); held = false; suppressUntil = 0;
    if (e.isPrimary === false || e.button !== 0) return;
    origin = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => {
      clear();
      if (!button.isConnected) return;
      held = true; suppressUntil = Date.now() + 1000;
      Native.haptic('selection'); show();
    }, 500);
  };
  button.onpointermove = (e) => { if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) clear(); };
  button.onpointerup = () => { if (held) suppressUntil = Date.now() + 1000; held = false; clear(); };
  button.onpointercancel = () => { held = false; clear(); }; button.onpointerleave = clear;
  button.onclick = (e) => {
    e.preventDefault(); e.stopPropagation(); clear();
    if (e.detail !== 0 && Date.now() < suppressUntil) { suppressUntil = 0; return; }
    toggle();
    try { if (!localStorage.getItem('fit.cheerHint')) { localStorage.setItem('fit.cheerHint', '1'); toast('Tip: hold Cheers to choose Strong or Applause'); } } catch (x) { /* private mode */ }
  };
  button.oncontextmenu = (e) => {
    e.preventDefault(); e.stopPropagation(); clear();
    if (Date.now() >= suppressUntil) { suppressUntil = Date.now() + 1000; show(); }
  };
  viewResources.set(button, clear);
}

function shareActivity(href) {
  const owner=readOwner(),url=`${appBase()}${href}`,active=()=>owner===readOwner();
  const copy=()=>{if(!active())return;sheet('Share activity',`<p>Only people in this activity’s audience can open this link. They need to sign in to Kinetta.</p><label>Activity link<input readonly value="${esc(url)}"></label><button type="button" class="primary wide" data-copy-activity>Copy link</button><p class="small muted" data-copy-status role="status"></p>`,box=>{
    const input=$('input',box);input.onclick=()=>input.select();
    $('[data-copy-activity]',box).onclick=async()=>{if(!active())return;try{await navigator.clipboard.writeText(url);if(active()&&box.isConnected)$('[data-copy-status]',box).textContent='Link copied';}catch{if(active()&&box.isConnected){input.select();$('[data-copy-status]',box).textContent='Select and copy the link above.';}}};
  });};
  if(navigator.share)navigator.share({title:'Activity on Kinetta',url}).catch(error=>{if(error.name!=='AbortError')copy();});
  else copy();
}

function activityCheers(aid) {
  const owner=readOwner();
  sheet('Reactions', '<div class="cheers-list" aria-live="polite">Loading…</div>', async (box) => {
    const list = $('.cheers-list', box);
    try { const s = await api(`/api/activities/${aid}/social`); if (list.isConnected&&owner===readOwner()) list.innerHTML = cheersPeople(s.cheers); }
    catch (x) { if (list.isConnected) list.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p>`; }
  });
}

// the number on the Me tab: unread notifications (or friend requests waiting, if more); checked at most once a minute
const Social = {
  at: 0,
  count: () => Math.max((App.me && App.me.notifications) || 0, (App.me && App.me.friend_requests) || 0),
  badge() {
    const a = $('nav.tabs a[data-tab="me"]'); if (!a) return;
    const n = Social.count(); let b = $('.tab-n', a);
    const un = (App.me && App.me.notifications) || 0;
    if (typeof Native !== 'undefined' && Native.setBadge) Native.setBadge(un);
    $$('.bell-dot').forEach((d) => { d.hidden = !un; d.textContent = un > 9 ? '9+' : un || ''; });
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tab-n'; a.append(b); }
    b.innerHTML = `${n > 9 ? '9+' : n}<span class="vh"> new notification${n > 1 ? 's' : ''}</span>`;
  },
  refresh() {
    Social.badge();
    if (!App.me || !navigator.onLine) return;
    const account = readOwner();
    if (Social.owner !== account) { Social.owner = account; Social.at = 0; }
    if (Date.now() - Social.at < 60000) return;
    Social.at = Date.now();
    api('/api/notifications/count').then((r) => { if (account !== readOwner() || !App.me) return; App.me.notifications = r.unread; App.me.friend_requests = r.friend_requests; Social.badge(); }).catch(() => {});
  },
  set(n) { if (App.me && n != null) { App.me.friend_requests = n; Social.badge(); } },
};

// ---------- Activity tab: the Feed (yours and your friends', newest first) ----------
// Two lists merged by start time. Each page asks both for the next N before the oldest card shown, keeps the newest N,
// and the rest comes again on the next page, so nothing is skipped or shown twice.
const FEED_N = 15;
async function feedPage(before,size=FEED_N) {
  const b = before ? '&before=' + encodeURIComponent(before) : '';
  const [mine, theirs] = await Promise.all([readOnce(`/api/activities?limit=${size}${b}`), readOnce(`/api/feed/friends?limit=${size}${b}`)]);
  const all = mine.concat(theirs).sort((x, y) => new Date(y.start_time) - new Date(x.start_time));
  // the next page asks for "older than the last card", so activities sharing the last card's start time all go on this page
  let n = Math.min(size, all.length);
  while (n && n < all.length && +new Date(all[n].start_time) === +new Date(all[n - 1].start_time)) n++;
  return {rows: all.slice(0, n), more: all.length > n || mine.length === size || theirs.length === size, friends: all.slice(0,n).filter(a=>a.owner).length};
}
// Persist only a small opening view; deeper browsing stays in this account's memory cache.
function keepFeed(pg){
  const rows=pg.rows.slice(0,FEED_N);
  keep('feed:home',{rows,more:pg.more||pg.rows.length>rows.length,friends:rows.filter(a=>a.owner).length});
}
// The feed's first page, fetched quietly after the app opens (see warmTabs in app.js).
function warmFeed() {
  if (App.cache.has('feed:home')) return;
  const account = readOwner(), epoch = readEpoch('feed:home');
  feedPage().then((pg) => { if (account === readOwner() && epoch === readEpoch('feed:home') && !App.cache.has('feed:home')) { App.cache.set('feed:home', {data: pg, at: Date.now()}); keepFeed(pg); } }).catch(() => {});
}
async function homeFeed(el) {
  el.innerHTML = `${actTop(false, true)}${whoseSeg('')}
    <a class="people-search-entry" href="/me/friends?find=1">${svg('search')}<span>Find people</span>${svg('chev')}</a>
    <div class="feed-list" id="ff-list">${skel(3)}</div><button class="ghost feed-more" id="ff-more" hidden>Show more</button>`;
  wireWhose(el);
  const list = $('#ff-list', el), more = $('#ff-more', el);
  let items = [];
  const draw = (pg) => {
    items = pg.rows;
    list.innerHTML = items.length ? items.map((a) => postCard(a, {who: true})).join('') : `<div class="card empty"><b>Nothing here yet</b>
      Your activities and the ones your friends share show up here.${startCta()}<div class="btncol"><a class="ghost" href="/me/friends">Find your friends</a></div></div>`;
    more.hidden = !pg.more; feedMaps(list); wireCheers(list);
  };
  let hit = App.cache.get('feed:home');
  if (!hit) { const k = kept('feed:home'); if (k) { hit = {data: k, at: 0}; App.cache.set('feed:home', hit); } }   // saved on this phone: show at once
  if (hit) draw(hit.data);
  const account = readOwner(), epoch = readEpoch('feed:home');
  // A fresh cached feed already contains the current cards/maps. Avoid fetching and rebuilding it.
  const fresh = hit && Date.now() - hit.at < 15000;
  let pageRevision=0;
  const active=()=>account===readOwner()&&list.isConnected;
  const current=()=>active()&&epoch===readEpoch('feed:home')&&pageRevision===0;
  more.onclick = async () => {
    if(more.disabled||!active()||!items.length)return;
    const revision=readEpoch('feed:home');pageRevision++;
    more.disabled = true; more.textContent = 'Loading…';
    try {
      const pg = await feedPage(items[items.length - 1].start_time);
      if(!active()||revision!==readEpoch('feed:home'))return;
      items = items.concat(pg.rows);
      App.cache.set('feed:home',{data:{rows:items,more:pg.more,friends:items.filter(a=>a.owner).length},at:App.cache.get('feed:home')?.at||0});
      list.insertAdjacentHTML('beforeend', pg.rows.map((a) => postCard(a, {who: true})).join('')); more.hidden = !pg.more; feedMaps(list); wireCheers(list);
    } catch (x) { if(active()&&revision===readEpoch('feed:home'))toast(x.message); }
    finally { more.disabled = false; more.textContent = 'Show more'; }
  };
  try { if (!fresh) {
    // Revalidate the depth already browsed, so a detail visit never drops loaded pages.
    const count=Math.max(FEED_N,hit?.data.rows.length||0);
    let pg=await feedPage(undefined,Math.min(50,count));
    while(current()&&pg.more&&pg.rows.length<count){
      const next=await feedPage(pg.rows.at(-1).start_time,Math.min(50,count-pg.rows.length));
      pg={rows:pg.rows.concat(next.rows),more:next.more&&!!next.rows.length,friends:pg.friends+next.friends};
    }
    if(!current())return;
    App.cache.set('feed:home', {data: pg, at: Date.now()}); keepFeed(pg);
    if(!hit||JSON.stringify(hit.data)!==JSON.stringify(pg))draw(pg);
  } }
  catch (x) { if (!hit) throw x; if(typeof PageRefresh!=='undefined')PageRefresh.failed(x); }

}

// ---------- someone else's activity (read-only); for your own: what others see ----------
route(/^\/activity\/friends\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn()}</div>${skel(1)}<div class="sk block"></div>`;
  wireBack(el, '/activity');
  await load(`/api/shared/${id}`, (a) => drawShared(el, a), {maxAge: 30000});
});
function drawShared(el, a) {
  const mine = a.social.mine, sh = a.shares, r = rate(a);
  const hero = (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', dur(a.moving_s || a.elapsed_s)) +
    (a.distance_m && sh.pace ? stat(r.label, r.v, r.u) : '');
  const splits = imp() ? a.splits_mi : a.splits_km;
  el.innerHTML = `<div class="top">${backBtn(mine ? 'Back' : 'Feed')}</div>
    ${mine ? '<div class="callout">This is what others see of your activity.</div>' : ''}
    <div class="d-title card"><div class="post-hd"><a class="post-person" href="${profileHref(a.owner)}">${avatar(a.owner)}<span class="ph-txt"><b>${esc(a.owner.name)}</b>
      <small>${esc(fdate(a.start_time, {weekday: 'long', month: 'long', day: 'numeric'}))} at ${esc(ftime(a.start_time))}${a.device ? ' · ' + esc(a.device) : ''}</small></span></a>${sportMark(a.sport)}</div>
      <div class="t-row"><h1>${esc(a.name)}</h1><span class="t-soc" id="s-soc"></span></div>
      ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
      <div class="hero">${hero}</div>${sportStats(a) ? `<div class="hero more">${sportStats(a)}</div>` : ''}<div class="cpile"></div></div>
    ${activityMedia(a, {mapId: 's-map', detail: true, full: true})}
    ${a.ends_hidden ? '<p class="small muted map-note">The start and end of the route are hidden.</p>' : ''}
    ${a.chart ? '<div class="card"><h2>Charts</h2><div id="s-charts"></div></div>' : ''}
    ${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}
    ${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}
    ${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}
    ${mine ? '' : `<p class="center"><button class="linkbtn muted" id="s-rb">Report or block ${esc(a.owner.name)}</button></p>`}`;
  wireBack(el, mine ? `/activity/${a.id}` : '/activity');
  if (!mine) $('#s-rb', el).onclick = () => reportSheet(a.owner, {activity_id: a.id});
  if (a.line) {
    const box = $('#s-map', el); let m = null;
    wireMediaMapFull(box, () => m, a.line, !!a.photos?.length);
    lazy(box, async () => {
      try {
        m = await mapInto(box, [a.line], {sport: a.sport, ends: false, still: !!a.photos?.length && !box.classList.contains('full')});
        if (m && a.photos?.length && !box.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
      } catch (e) { if (box.isConnected) box.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
    });
  }
  wireTalk($('#s-soc', el), a.id, a.social, new URLSearchParams(location.search).get('tab') === 'comments');
  wireActivityMedia(el);
  if (a.chart) requestAnimationFrame(() => sharedCharts($('#s-charts', el), a));
}
function sharedCharts(box, a) {
  const c = a.chart, x = c.d && c.d[c.d.length - 1] > 100 ? c.d : c.t, byDist = x === c.d, rows = [];
  if (!x) { box.closest('.card').remove(); return; }
  const foot = FOOT.includes(a.sport) && a.sport !== 'swim';
  if (c.speed) rows.push(foot ? {name: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s1'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s1'), clip: true});
  if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s2'), avg: a.avg_hr});
  if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
  chartStack(box, x, rows, {xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v))});
}

// The cheer and comment icons by an activity's title (2026-10-12, Ben: a little icon near the title, comments pop up
// from below). Both activity pages use them; the counts follow what happens in the comments sheet.
const talkIcons=(s,aid)=>reactionButtons(aid,s,true)+`<button type="button" class="pf activity-comments" data-ttalk aria-label="Comments, ${s.comments.length}">${svg('comment')}<span class="num">${s.comments.length}</span></button>`;
function wireTalk(box,aid,s,open){
  if(!box)return;const owner=readOwner();
  const pile=box.closest('.d-title')&&$('.cpile',box.closest('.d-title'));
  const draw=()=>{if(!box.isConnected||owner!==readOwner())return;box.innerHTML=talkIcons(s,aid);cleanViews();
    if(pile)pile.innerHTML=''; // The compact count already opens the people list.
    wireReactionGroup($('[data-reaction-group]',box),aid,fresh=>{s=fresh;draw();});
    $('[data-ttalk]',box).onclick=()=>commentsSheet(aid,s,fresh=>{s=fresh;draw();});
  };draw();if(open)commentsSheet(aid,s,fresh=>{s=fresh;draw();});
}
// Who sent cheers (2026-10-12, Ben): up to three faces and "Jordan Lee and 2 others" under the activity's numbers; a tap
// lists everyone. The same list opens from the comments sheet.
const cheerName = (c) => (c.login === App.me.login ? 'You' : c.name);
function cheerPile(cheers) {
  if (!cheers.length) return '';
  const first = cheerName(cheers[0]), more = cheers.length - 1;
  return `<button type="button" class="cheer-pile" data-cpile><span class="faces">${cheers.slice(0, 3).map((c) => avatar(c)).join('')}</span>
    <span class="grow"><b>Reactions</b> from ${esc(first)}${more ? ` and ${more} other${more > 1 ? 's' : ''}` : ''}</span><span class="chev">${svg('chev')}</span></button>`;
}
const cheersPeople = (cheers) => `<div class="card list">${cheers.length ? cheers.map((c) => `<div class="person" data-close>${personLink(c, cheerName(c))}<small>${esc(REACTIONS.find(([kind])=>kind===(c.kind||'cheer'))?.[1]||'Cheers')}</small></div>`).join('') : '<p class="small muted">No reactions yet.</p>'}</div>`;
function cheersSheet(cheers) { sheet(`Reactions · ${cheers.length}`, cheersPeople(cheers)); }
function socialChanged(aid) {
  invalidate('/api/shared/' + aid); invalidate('/api/activities/' + aid + '/social'); invalidate('/api/feed/friends'); invalidate('/api/activities?'); invalidateFeed();
}
// cheers and comments in a bottom sheet; onChange gets the new state so the icon underneath can follow
function commentsSheet(aid, s, onChange) {
  const account = readOwner();
  sheet('Comments', '<div class="social" aria-live="polite"><p class="muted">Loading comments…</p></div>', (b) => {
    const box = $('.social', b);
    const current = () => box.isConnected && account === readOwner();
    const fetchComments = async () => {
      box.innerHTML = '<p class="muted">Loading comments…</p>';
      try { const fresh = await api(`/api/activities/${aid}/social`); if (current()) drawComments(box, aid, fresh, onChange); }
      catch (x) {
        if (!current()) return;
        box.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p><button type="button" class="ghost wide" data-retry>Retry</button>`;
        $('[data-retry]', box).onclick = fetchComments;
      }
    };
    if (s) drawComments(box, aid, s, onChange); else fetchComments();
  });
}
function drawComments(box, aid, s, onChange) {
  const account = readOwner();
  const names = s.cheers.map((c) => c.name);
  const who = names.length ? `<button type="button" class="small cheer-who" data-cwho>${svg('cheer')}<span class="grow"><b>Reactions</b> from ${esc(names.length > 3 ? names.slice(0, 3).join(', ') + ` and ${names.length - 3} more` : names.join(', '))}</span><span class="chev">${svg('chev')}</span></button>` : '';
  box.innerHTML = `${who}<div class="comments">${s.comments.length ? s.comments.map((c) => `<div class="comment"><a href="${profileHref(c)}" data-close aria-label="View ${esc(c.name)}'s profile">${avatar(c)}</a><div class="c-body"><div class="c-hd"><a href="${profileHref(c)}" data-close><b>${esc(c.name)}</b></a><small class="muted">${esc(when(c.created))}</small></div><p>${esc(c.text)}</p><div class="c-acts">${c.can_delete ? `<button class="linkbtn danger" data-del="${c.id}" aria-label="Delete comment from ${esc(c.name)}">Delete</button>` : ''}${c.login !== App.me.login ? `<button class="linkbtn muted" data-rep="${c.id}" aria-label="Report comment from ${esc(c.name)}">Report</button>` : ''}</div></div></div>`).join('')
      : '<p class="small muted c-none">No comments yet.</p>'}</div>
    <form class="form c-form"><label class="vh" for="c-${aid}">Add a comment</label><textarea id="c-${aid}" name="text" maxlength="500" rows="2" placeholder="Add a comment" required></textarea>
      <button class="primary wide">Post comment</button></form>`;
  const cw = $('[data-cwho]', box); if (cw) cw.onclick = () => cheersSheet(s.cheers);
  const after = (fresh) => { if (account !== readOwner()) return; socialChanged(aid); s = {...s, ...fresh}; drawComments(box, aid, s, onChange); if (onChange) onChange(s); };
  $$('[data-del]', box).forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this comment?')) return;
    b.disabled = true;
    try { await api('/api/comments/' + b.dataset.del, {method: 'DELETE'}); after({comments: s.comments.filter((c) => String(c.id) !== b.dataset.del)}); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
  $$('[data-rep]', box).forEach((b) => b.onclick = () => {
    const c = s.comments.find((x) => String(x.id) === b.dataset.rep);
    reportSheet(c, {comment_id: c.id}, () => after({comments: s.comments.filter((x) => x.login !== c.login)}));
  });
  const f = $('.c-form', box);
  f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    const btn = $('button', f); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Posting…';
    try { after(await api(`/api/activities/${aid}/comments`, json('POST', {text}))); }
    catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Post comment'; }
  };
}

// ---------- activity photos (2026-10-12, api_photos.py) ----------
// A row of small photos on the activity page (the owner also gets an Add button); a tap opens them full screen. The
// phone shrinks each photo first (1600 px); the server saves it again without its hidden details (where it was taken).
const PHOTO_MAX = 10;
const photoSrc = (p, thumb) => `/api/activity-photos/${p.id}${thumb ? '?size=thumb' : ''}`;
function photoChanged(aid) {
  invalidate('/api/activities/' + aid); invalidate('/api/shared/' + aid); invalidate('/api/activities?'); invalidate('/api/feed/friends'); invalidateFeed();
}
function photoStrip(box, a, mine, {controlsOnly = false, afterChange = null} = {}) {
  if (!box) return;
  const ph = a.photos || [];
  if (!ph.length && !mine) { box.innerHTML = ''; return; }
  const canAdd = mine && ph.length < PHOTO_MAX;
  box.innerHTML = `<div class="ph-strip${ph.length && !controlsOnly ? '' : ' empty'}">${controlsOnly ? '' : ph.map((p, i) => `<button type="button" class="ph-th" data-ph="${i}" aria-label="Photo ${i + 1} of ${ph.length}">${pimg(photoSrc(p, true))}</button>`).join('')}
    ${canAdd ? `<button type="button" class="ph-add" data-phadd>${svg('camera')}<span>${ph.length ? 'Add' : 'Add photos'}</span></button><input type="file" accept="image/*" multiple hidden data-phfile>` : ''}</div>`;
  $$('[data-ph]', box).forEach((b) => b.onclick = () => photoViewer(a, +b.dataset.ph, mine, () => photoStrip(box, a, mine)));
  const add = $('[data-phadd]', box), file = $('[data-phfile]', box);
  if (!add) return;
  add.onclick = () => file.click();
  file.onchange = async () => {
    const files = [...file.files].slice(0, PHOTO_MAX - ph.length); if (!files.length) return;
    add.disabled = true;
    let done = 0;
    for (const f of files) {
      $('span', add).textContent = files.length > 1 ? `Adding ${done + 1} of ${files.length}…` : 'Adding…';
      try {
        const image = await shrinkPhoto(f, 1600);
        a.photos = [...(a.photos || []), await api(`/api/activities/${a.id}/photos`, json('POST', {image}))]; done++;
      } catch (x) { toast(x.message || "That photo couldn't be added"); break; }
    }
    if (done) photoChanged(a.id);
    if (afterChange) afterChange(); else photoStrip(box, a, mine);
  };
}
// full screen: swipe or the arrows for the next one; the owner can remove one
function photoViewer(a, start, mine, onChange) {
  let i = start;
  const v = document.createElement('div');
  v.className = 'ph-view'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', 'Photos');
  const draw = () => {
    const ph = a.photos, p = ph[i];
    v.innerHTML = `<div class="ph-bar"><button type="button" class="icon-btn" data-x aria-label="Close">${svg('close')}</button><span class="num">${i + 1} of ${ph.length}</span>
        ${mine ? `<button type="button" class="icon-btn" data-del aria-label="Remove this photo">${svg('trash')}</button>` : '<span class="ph-sp"></span>'}</div>
      <div class="ph-stage">${pimg(photoSrc(p), `width="${p.w}" height="${p.h}"`).replace('alt=""', `alt="Photo ${i + 1} of ${ph.length}"`)}</div>
      ${ph.length > 1 ? `<button type="button" class="ph-nav prev" data-step="-1" aria-label="Previous photo"${i ? '' : ' hidden'}>${svg('back')}</button>
        <button type="button" class="ph-nav next" data-step="1" aria-label="Next photo"${i < ph.length - 1 ? '' : ' hidden'}>${svg('back')}</button>` : ''}`;
    $('[data-x]', v).onclick = close;
    $$('[data-step]', v).forEach((b) => b.onclick = () => step(+b.dataset.step));
    const del = $('[data-del]', v);
    if (del) del.onclick = async () => {
      if (!confirm('Remove this photo?')) return;
      del.disabled = true;
      try {
        await api('/api/activity-photos/' + p.id, {method: 'DELETE'});
        a.photos = ph.filter((x) => x.id !== p.id); photoChanged(a.id); onChange();
        if (!a.photos.length) return close();
        i = Math.min(i, a.photos.length - 1); draw();
      } catch (x) { toast(x.message); del.disabled = false; }
    };
    $('[data-x]', v).focus();
  };
  const step = (d) => { const n = i + d; if (n >= 0 && n < a.photos.length) { i = n; draw(); } };
  const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); };
  let x0 = null;
  v.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  v.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) step(e.clientX < x0 ? 1 : -1); x0 = null; });
  function close() { document.removeEventListener('keydown', key); v.remove(); document.body.classList.remove('ph-open'); }
  document.addEventListener('keydown', key);
  document.body.append(v); document.body.classList.add('ph-open');
  draw();
}

// ---------- your own activity: cheers + comments by the title; who sees it lives in the Edit sheet ----------
async function ownSocial(el, a) {
  const box = $('#d-soc', el); if (!box) return;
  let s;
  try { s = await api(`/api/activities/${a.id}/social`); } catch (x) { return; }
  if (!box.isConnected) return;
  a._social = s;
  wireTalk(box, a.id, s, new URLSearchParams(location.search).get('tab') === 'comments');
}
function detailChecks(d) {
  return Object.entries(DETAIL_NAMES).map(([k, n]) => `<label class="check"><input type="checkbox" name="${k}"${d[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('');
}
const readChecks = (f) => Object.fromEntries(Object.keys(DETAIL_NAMES).map((k) => [k, f[k].checked]));
function visSeg(cur) {
  return `<div class="seg wide vis3" role="group" aria-label="Who can see it">${Object.keys(VIS).map((v) => `<button type="button" data-vis="${v}" aria-pressed="${v === cur}">${VIS_SHORT[v]}</button>`).join('')}</div>`;
}
function wireSeg(box, attr, onPick) {
  $$(`[data-${attr}]`, box).forEach((b) => b.onclick = () => {
    $$(`[data-${attr}]`, box).forEach((o) => o.setAttribute('aria-pressed', String(o === b))); onPick(b.dataset[attr]);
  });
}
// Sharing inside the Edit sheet (2026-10-12, Ben: not so prominent on every run). Returns save(), which sends the
// choice only when something changed.
function shareFields(box, aid, s) {
  let vis = s.visibility, usual = false;
  box.innerHTML = `<h3 class="ghead">Who can see it</h3>${visSeg(vis)}<p class="small muted vis-note"></p>
    <details class="sh-more"><summary>What they see</summary><div class="checks">${detailChecks(s.details)}</div>
      <p class="small muted">Splits and laps are shared only with pace. Private notes and Kit’s notes are never shared.</p>
      ${s.custom ? '<button type="button" class="linkbtn" id="sh-usual">Use my usual details</button>' : ''}</details>
    ${s.visibility !== 'me' ? `<a class="small" href="/activity/friends/${aid}" data-close>See what they see ›</a>` : ''}`;
  const note = $('.vis-note', box);
  const say = () => { note.textContent = vis === 'me' ? 'Only you. Nobody else can see it.' : vis === 'friends' ? 'Friends you have approved.' : 'Anyone with an account on this Kinetta server.'; };
  say(); wireSeg(box, 'vis', (v) => { vis = v; say(); });
  const u = $('#sh-usual', box); if (u) u.onclick = () => { usual = true; u.textContent = 'Your usual details will be used'; u.disabled = true; };
  return async () => {
    const d = Object.fromEntries(Object.keys(DETAIL_NAMES).map((k) => [k, $(`input[name="${k}"]`, box).checked]));
    const changed = Object.keys(d).some((k) => d[k] !== s.details[k]), body = {visibility: vis};
    if (usual) body.usual_details = true; else if (changed) body.details = d;
    if (vis === s.visibility && !usual && !changed) return;
    await api(`/api/activities/${aid}/sharing`, json('PUT', body)); socialChanged(aid);
  };
}

// ---------- Me > Friends: search by name or username, requests, your friends ----------
const profileTab = (login) => App.me && decodeURIComponent(login).toLowerCase() === App.me.login.toLowerCase() ? 'me' : 'activity';
route(/^\/people\/([^/]+)$/, profileTab, async (el, login) => {
  login = decodeURIComponent(login);
  const own = !!App.me && login.toLowerCase() === App.me.login.toLowerCase();
  el.innerHTML = `<div class="top">${backBtn(own ? 'Me' : 'People')}<a class="icon-btn" href="/me/friends?find=1" aria-label="Find people">${svg('search')}</a></div><div id="person-profile">${skel(2)}</div>`;
  wireBack(el, own ? '/me' : '/me/friends');
  const box = $('#person-profile', el);
  const path0 = '/api/people/' + encodeURIComponent(login) + '/profile' + (own ? '?as_friend=true' : '');
  const draw = (r) => {
    const p = r.person;
    // Your own profile is shown the way friends see it, with your name, bio and photo editable in place (2026-10-16, Ben)
    const action = r.mine ? '' :
      r.status === 'friends' ? `<button type="button" class="ghost" data-person-manage>Friends ${svg('more')}</button>` :
      r.status === 'sent' ? '<button class="ghost" data-person-action="cancel">Request sent</button>' :
      r.status === 'incoming' ? '<button class="primary" data-person-action="accept">Approve request</button>' : '<button class="primary" data-person-action="add">Add friend</button>';
    const pencil = `<span class="pf-pen" aria-hidden="true">${svg('edit')}</span>`;
    box.innerHTML = `${r.mine ? '<div class="pf-preview"><b>Your profile, as friends see it</b><span>Only shared workouts appear here. You choose what to show.</span></div>' : ''}
      <div class="profile public-profile">${r.mine ? `<button type="button" class="av-edit" id="pf-photo" aria-label="Change profile photo">${avatar(p, 'lg')}<span class="av-cam">${svg('camera')}</span></button>` : avatar(p, 'lg')}<div>${r.mine ? `<button type="button" class="pf-edit" id="pf-name" aria-label="Edit your name"><h1>${esc(p.name)}</h1>${pencil}</button>` : `<h1>${esc(p.name)}</h1>`}<div class="sub">@${esc(p.login)}</div><small class="muted">Joined ${esc(fdate(p.created, {month: 'long', year: 'numeric'}))}</small></div></div>
      ${r.mine ? `<button type="button" class="pf-edit pf-bio${p.bio ? '' : ' empty'}" id="pf-bio" aria-label="${p.bio ? 'Edit your bio' : 'Add a bio'}"><span class="profile-bio">${p.bio ? esc(p.bio) : 'Add a bio — a line about you for friends'}</span>${pencil}</button>` : p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}<div class="profile-actions">${r.mine ? '<button type="button" class="primary" id="pf-edit-profile">Edit profile</button><button type="button" class="ghost" id="pf-share">Share profile</button>' : action + '<button class="ghost" data-person-report>Report or block</button>'}</div>
      ${r.mine ? '<div class="profile-tools"><a href="/activity?view=mine">Manage workouts</a><a href="/me/sharing">Sharing &amp; privacy</a></div>' : ''}
      ${profileProgress(r.recent, r.mine)}
      <section class="card profile-mileage" id="profile-mileage" aria-label="Shared distance chart"></section><div class="card"><h2>All-time shared progress</h2><div class="hero">${stat('Activities', r.overview.activities)}${stat('Distance', U.dist(r.overview.distance_m), U.du())}${r.overview.time_s >= 3600 ? stat('Time', (r.overview.time_s / 3600).toLocaleString([], {maximumFractionDigits: 1}), 'h') : stat('Time', dur(r.overview.time_s, true))}</div>
        <div class="sport-overview">${(r.sports || []).map((s) => `<div class="row"><b>${esc(SPORT_NAMES[s.sport] || s.sport)}</b><span class="num">${s.activities} activities · ${s.distance_m ? U.dist(s.distance_m) + ' ' + U.du() : dur(s.time_s, true)}</span></div>`).join('')}</div><p class="small muted">${r.mine ? 'Activities set to “Only me” are left out here, as they are for everyone else.' : 'Only activities this person shares with you are included.'}</p></div>
      <h2 class="sec-head">Shared activities</h2><div class="feed-list" id="person-activities">${r.items.length ? r.items.map((a) => postCard(a)).join('') : `<div class="card empty"><b>No shared activities yet</b>${r.mine ? 'Choose a workout and use Sharing to add it to your profile.<a class="ghost wide" href="/activity?view=mine">Choose a workout</a>' : 'This person has not shared any activities you can see.'}</div>`}</div>
      <button class="ghost wide" id="person-more"${r.next ? '' : ' hidden'}>Show more</button>`;
    mileageChart($('#profile-mileage', box), r.mileage || {});
    feedMaps(box); wireCheers(box);
    if (r.mine) wireProfileEditing(box, p, reload);
    const act = $('[data-person-action]', box);
    if (act) act.onclick = async () => {
      act.disabled = true;
      try {
        const path = '/api/friends/' + encodeURIComponent(p.login);
        if (act.dataset.personAction === 'cancel') await api(path, {method: 'DELETE'});
        else if (act.dataset.personAction === 'accept') await api(path + '/accept', json('POST', {}));
        else await api('/api/friends', json('POST', {login: p.login}));
        invalidate('/api/friends'); invalidate('/api/people/'); invalidateFeed();
        if (box.isConnected) draw(await api(path0));
      } catch (x) { toast(x.message); act.disabled = false; }
    };
    const manage = $('[data-person-manage]', box);
    if (manage) manage.onclick = () => friendshipSheet(p, ({blocked}) => blocked ? go('/me/friends', {replace:true}) : reload());
    const report = $('[data-person-report]', box);
    if (report) report.onclick = () => reportSheet(p, {}, () => go('/me/friends', {replace: true}));
    const more = $('#person-more', box);
    let next = r.next;
    more.onclick = async () => {
      if (!next) return; more.disabled = true;
      try {
        const query = new URLSearchParams(next);
        const fresh = await api(path0 + (path0.includes('?') ? '&' : '?') + query);
        if (!box.isConnected) return;
        $('#person-activities', box).insertAdjacentHTML('beforeend', fresh.items.map((a) => postCard(a)).join(''));
        next = fresh.next; more.hidden = !next; feedMaps(box); wireCheers(box);
      } catch (x) { toast(x.message); }
      more.disabled = false;
    };
  };
  const reload = async () => { invalidate('/api/people/'); try { const r = await api(path0); if (box.isConnected) draw(r); } catch (x) { toast(x.message); } };
  await load(path0, draw, {maxAge: 0});
});

function friendshipSheet(p, onChange) {
  sheet(p.name, `<p>You’re friends on Kinetta.</p><a class="ghost wide" href="${profileHref(p)}" data-close>View profile</a><button class="ghost wide danger" type="button" data-remove>Remove friend</button><button class="ghost wide danger" type="button" data-block>Block</button><p class="err" role="alert"></p>`, (b, close) => {
    const change = (selector, block) => {
      const button = $(selector, b);
      button.onclick = async () => {
        const message = block ? `Block ${p.name}? Neither of you can find or see the other on Kinetta. They aren’t told.` : `Remove ${p.name} from your friends? You’ll stop seeing each other’s friends-only activities.`;
        if (!confirm(message)) return;
        $$('button', b).forEach(x => x.disabled = true);
        try {
          await api(block ? `/api/people/${encodeURIComponent(p.login)}/block` : `/api/friends/${encodeURIComponent(p.login)}`, block ? json('POST', {}) : {method:'DELETE'});
          invalidate('/api/friends'); invalidate('/api/people/'); invalidate('/api/shared/'); invalidate('/api/blocks'); invalidateFeed();
          close(); toast(block ? `${p.name} is blocked` : 'Friend removed'); await onChange({blocked:block});
        } catch (x) { $('.err', b).textContent = x.message; $$('button', b).forEach(x => x.disabled = false); }
      };
    };
    change('[data-remove]', false); change('[data-block]', true);
  });
}

// These numbers are calculated on the server from the same workouts the viewer can open.
function profileProgress(recent, mine) {
  if (!recent) return '';
  const now = recent.current, before = recent.previous;
  return `<section class="card profile-progress"><h2>Last 30 days</h2><p class="small muted">${esc(fdate(recent.start + 'T12:00', {month:'short',day:'numeric'}))} – ${esc(fdate(recent.end + 'T12:00', {month:'short',day:'numeric'}))}</p>
    ${now.activities ? `<div class="stats3">${stat('Workouts', now.activities)}${now.distance_m > 0 ? stat('Distance', U.dist(now.distance_m, 1), U.du()) : stat('Active days', now.active_days)}${stat('Time', dur(now.time_s, true))}</div><p class="profile-consistency"><b>${now.active_days} active ${now.active_days === 1 ? 'day' : 'days'}</b> · ${before.activities} ${before.activities === 1 ? 'workout' : 'workouts'} in the previous 30 days</p>` : `<p class="muted">${mine ? 'Your shared workouts will build your progress here.' : 'No shared workouts in this period.'}</p>`}
    <p class="small muted">${mine ? 'Your progress from workouts shared with friends or everyone.' : 'Based on workouts shared with you.'}</p></section>`;
}

function shareProfile(p) {
  const url = `${appBase()}${profileHref(p)}`;
  const copySheet = () => sheet('Share your profile', `<p>People need a Kinetta account to open your profile. Your sharing choices still apply.</p><label class="form">Profile link<input readonly value="${esc(url)}" aria-label="Profile link"></label><button type="button" class="primary wide" id="pf-copy">Copy link</button><p class="small muted" id="pf-copy-status" role="status"></p>`, (b) => {
    const input = $('input', b); input.onclick = () => input.select();
    $('#pf-copy', b).onclick = async () => {
      try { await navigator.clipboard.writeText(url); $('#pf-copy-status', b).textContent = 'Link copied'; }
      catch { input.select(); $('#pf-copy-status', b).textContent = 'Select and copy the link above.'; }
    };
  });
  if (navigator.share) navigator.share({title: `${p.name} on Kinetta`, url}).catch((e) => { if (e.name !== 'AbortError') copySheet(); });
  else copySheet();
}

// One editor saves identity fields together; errors leave both drafts in place.
function wireProfileEditing(box, p, reload) {
  const photo = () => profilePhotoSheet(() => { invalidate('/api/me'); keep('/api/me', App.me); reload(); });
  $('#pf-photo', box).onclick = photo;
  $('#pf-share', box).onclick = () => shareProfile(p);
  const edit = (focus) => sheet('Edit profile', `<form class="form" id="pf-editor">
    <p class="small muted">Your name, photo and bio are visible to people who find your profile. Workouts follow your sharing choices.</p>
    <button type="button" class="ghost wide" id="pf-editor-photo">${svg('camera')}Change profile photo</button>
    <label>Name<input name="name" value="${esc(p.name)}" maxlength="60" required autocomplete="name" enterkeyhint="next"></label>
    <label>Bio<textarea name="bio" rows="3" maxlength="280" placeholder="What you enjoy, what you’re working toward…">${esc(p.bio || '')}</textarea></label>
    <p class="small muted" id="pf-bio-count">${(p.bio || '').length}/280</p><p class="err" role="alert"></p>
    <div class="actions"><button type="button" class="ghost" data-cancel>Cancel</button><button class="primary" type="submit">Save profile</button></div></form>`, (b, close) => {
    const form = $('#pf-editor', b), save = $('[type="submit"]', form);
    $('#pf-editor-photo', b).onclick = photo;
    form.elements.bio.oninput = () => { $('#pf-bio-count', b).textContent = `${form.elements.bio.value.length}/280`; };
    $('[data-cancel]', form).onclick = close;
    if (focus) form.elements[focus].focus();
    form.onsubmit = async (e) => {
      e.preventDefault(); if (save.disabled) return;
      const name = form.elements.name.value.trim(), bio = form.elements.bio.value.trim();
      save.disabled = true; save.textContent = 'Saving…'; $('.err', form).textContent = '';
      try {
        const account = await api('/api/account', json('PUT', {name, bio}));
        App.me.name = account.name; App.me.bio = bio;
        invalidate('/api/me'); invalidate('/api/people/'); invalidateFeed(); keep('/api/me', App.me);
        close(); toast('Profile saved'); reload();
      } catch (x) { $('.err', form).textContent = x.message; save.disabled = false; save.textContent = 'Save profile'; }
    };
  });
  $('#pf-edit-profile', box).onclick = () => edit();
  $('#pf-name', box).onclick = () => edit('name');
  $('#pf-bio', box).onclick = () => edit('bio');
}

route(/^\/me\/friends$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}<a class="icon-btn" href="${profileHref(App.me)}" aria-label="Your profile">${avatar(App.me)}</a></div><h1>Friends</h1>
    <form class="searchbox people-search" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span>
      <input type="search" name="q" placeholder="Name or @username" aria-label="Search people" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"><button type="button" class="icon-btn" id="fr-clear" aria-label="Clear search" hidden>${svg('close')}</button></form>
    <p class="small muted people-search-help">Find someone on Kinetta, or <button type="button" class="linkbtn" id="fr-browse">browse people</button>.</p>
    <p class="small muted" id="fr-status" role="status" aria-live="polite"></p><div id="fr-found"></div><div id="fr-lists">${skel(1)}</div>
    <a class="card tap row-link" href="/me/sharing"><span class="ri c-green">${svg('lock')}</span><span class="grow"><b>Sharing</b><small class="muted">Default audience for new activities, and shared details</small></span><span class="chev">${svg('chev')}</span></a>`;
  wireBack(el, '/me');
  const lists = $('#fr-lists', el), found = $('#fr-found', el), f = $('#fr-find', el);
  const person = (p, btns, cls = '') => `<div class="person ${cls}">${personLink(p)}<span class="btnrow tight">${btns}</span></div>`;
  const btnFor = (p) => ({friends: `<span class="badge on">${svg('check')} Friends</span>`,
    sent: `<button class="ghost sm" data-cancel="${esc(p.login)}">Cancel request</button>`,
    incoming: `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button>`})[p.status] || `<button class="primary sm" data-add="${esc(p.login)}">${svg('plus')}Add</button>`;
  const input = f.elements.q, clear = $('#fr-clear', el), status = $('#fr-status', el);
  const initial = new URLSearchParams(location.search);
  input.value = initial.get('q') || '';
  let last = null, people = [], known = [], browsing = false;
  const who = (login) => (people.find((p) => p.login === login) || {}).name || login;
  const drawListError = (x) => {
    if (!lists.isConnected) return;
    lists.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" id="fr-list-retry">Retry friends</button>`;
    $('#fr-list-retry', lists).onclick = () => render();
  };
  const refresh = async () => {
    clearTimeout(t); searchVersion++;
    // A removed/blocked friendship also invalidates previously opened shared details.
    invalidate('/api/feed/friends'); invalidate('/api/people/'); invalidate('/api/shared/'); invalidate('/api/blocks'); invalidateFeed(); App.cache.delete('/api/friends');
    await load('/api/friends', draw, {maxAge: 0}).catch(drawListError);
    if (found.isConnected) await find(true);
  };
  const act = (box, sel, fn) => $$(sel, box).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { if (await fn(b) === false) { b.disabled = false; return; } await refresh(); }
    catch (x) { toast(x.message); b.disabled = false; }
  });
  const wire = (box) => {
    $$('[data-manage]', box).forEach((button) => button.onclick = () => friendshipSheet(people.find(p => p.login === button.dataset.manage), refresh));
    act(box, '[data-add]', async (b) => { const r = await api('/api/friends', json('POST', {login: b.dataset.add})); toast(r.status === 'friends' ? `You and ${r.name} are friends now` : `Request sent to ${r.name}`); });
    act(box, '[data-ok]', async (b) => { await api(`/api/friends/${encodeURIComponent(b.dataset.ok)}/accept`, json('POST', {})); toast(`You and ${who(b.dataset.ok)} are friends now`); });
    act(box, '[data-no]', (b) => api(`/api/friends/${encodeURIComponent(b.dataset.no)}/decline`, json('POST', {})));
    act(box, '[data-cancel]', (b) => api('/api/friends/' + encodeURIComponent(b.dataset.cancel), {method: 'DELETE'}));
    act(box, '[data-blk]', async (b) => {
      if (!confirm(`Block ${who(b.dataset.blk)}? They can't see your activities, find you or ask to be friends, and you won't see theirs. They aren't told.`)) return false;
      await api(`/api/people/${encodeURIComponent(b.dataset.blk)}/block`, json('POST', {})); toast(`${who(b.dataset.blk)} is blocked`);
    });
  };
  const drawResults = (rows, pending = false) => {
    found.innerHTML = `<h2 class="sec-head">${browsing ? 'People on Kinetta' : 'Search results'}</h2><div class="card list">${rows.length ? rows.map((p) => person(p, btnFor(p))).join('') : pending ? '<p class="small muted">Searching…</p>' : '<p class="small muted">No people found. Try their full username, or check the spelling.</p>'}</div>`;
    wire(found);
  };
  let t, searchVersion = 0;
  async function find(again) {
    const q = input.value.trim();
    clear.hidden = !q && !browsing; lists.hidden = !!q || browsing;
    if (!q && !browsing) { last = null; found.innerHTML = ''; status.textContent = ''; found.setAttribute('aria-busy', 'false'); return; }
    if (q === last && !again) return; last = q;
    const request = ++searchVersion;
    found.setAttribute('aria-busy', 'true'); status.textContent = 'Searching…';
    try {
      const r = await api('/api/people/search?q=' + encodeURIComponent(q));
      if (request !== searchVersion || !found.isConnected) return;
      people = [...new Map(people.concat(r).map((p) => [p.login, p])).values()];
      drawResults(r); status.textContent = `${r.length}${r.length === 20 ? '+' : ''} ${r.length === 1 ? 'person' : 'people'} found`;
    } catch (x) { if (request === searchVersion && found.isConnected) { last = null; status.textContent = ''; found.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" data-retry>Retry search</button>`; $('[data-retry]', found).onclick = () => find(true); } }
    finally { if (request === searchVersion) found.setAttribute('aria-busy', 'false'); }
  }
  const search = () => {
    clearTimeout(t); last = null; searchVersion++; browsing = false;
    const q = input.value.trim(), url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    url.searchParams.delete('find'); history.replaceState(history.state, '', url.pathname + url.search);
    if (!q) { find(); return; }
    clear.hidden = false; lists.hidden = true;
    const term = q.replace(/^@/, '').toLocaleLowerCase();
    drawResults(known.filter(p => p.name.toLocaleLowerCase().includes(term) || p.login.toLocaleLowerCase().includes(term)).slice(0, 20), true);
    found.setAttribute('aria-busy', 'true'); status.textContent = 'Searching…';
    t = setTimeout(() => find(), 180);
  };
  input.oninput = search;
  clear.onclick = () => { input.value = ''; search(); input.focus(); };
  $('#fr-browse', el).onclick = () => { clearTimeout(t); input.value = ''; browsing = true; find(true); };
  viewResources.set(f, () => { clearTimeout(t); searchVersion++; });
  f.onsubmit = (e) => { e.preventDefault(); clearTimeout(t); find(true); };
  const draw = (r) => {
    Social.set(r.incoming.length);
    known = r.incoming.map(p => ({...p, status:'incoming'})).concat(r.friends.map(p => ({...p,status:'friends'})), r.outgoing.map(p => ({...p,status:'sent'})));
    people = [...new Map(people.concat(known).map(p => [p.login, p])).values()];
    lists.innerHTML = (r.incoming.length ? `<h2 class="sec-head">Waiting for you <span class="count">${r.incoming.length}</span></h2><div class="card list">${r.incoming.map((p) =>
        person(p, `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button><button class="ghost sm" data-no="${esc(p.login)}">Decline</button><button class="ghost sm danger" data-blk="${esc(p.login)}" aria-label="Block ${esc(p.name)}">Block</button>`, 'req')).join('')}</div>` : '') +
      `<h2 class="sec-head">Your friends${r.friends.length ? ` <span class="count">${r.friends.length}</span>` : ''}</h2><div class="card list">${r.friends.length ? r.friends.map((p) => person(p, `<button class="icon-btn" type="button" data-manage="${esc(p.login)}" aria-label="Manage friendship with ${esc(p.name)}">${svg('more')}</button>`)).join('')
        : '<p class="small muted">No friends yet. Search for someone above. They approve it first, then you each see what the other shares with friends.</p>'}</div>` +
      (r.outgoing.length ? `<h2 class="sec-head">Requests you sent</h2><div class="card list">${r.outgoing.map((p) => person(p, `<button class="ghost sm" data-cancel="${esc(p.login)}">Cancel</button>`)).join('')}</div>` : '');
    wire(lists);
  };
  const searching = find();
  if (initial.has('find')) input.focus();
  await load('/api/friends', draw, {maxAge: 0}).catch(drawListError);
  await searching;
});

// ---------- report or block someone (App Store guideline 1.2): from their activity or one of their comments ----------
const REPORT_WHY = {spam: 'Spam', abuse: 'Harassment or abuse', inappropriate: 'Inappropriate', other: 'Something else'};
function reportSheet(p, what = {}, onBlocked) {
  let why = null;
  sheet(`${p.name}`, `<form class="form" id="rp-form"><h3 class="ghead">Report ${what.comment_id ? 'this comment' : what.activity_id ? 'this activity' : 'this person'}</h3>
    <div class="checks">${Object.entries(REPORT_WHY).map(([k, n]) => `<label class="check"><input type="radio" name="why" value="${k}"> ${esc(n)}</label>`).join('')}</div>
    <label>Anything else? (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label>
    <p class="small muted">The people who run this Kinetta see your report and what was reported. ${esc(p.name)} isn't told who reported it.</p>
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Send report</button></div>
    <h3 class="ghead">Block ${esc(p.name)}</h3>
    <p class="small muted">You stop being friends, they can't see your activities, find you or ask to be friends, and you won't see their activities, cheers or comments. They aren't told. Undo it under Me › Sharing.</p>
    <button type="button" class="ghost wide danger" id="rp-block">Block ${esc(p.name)}</button></form>`, (b, close) => {
    const f = $('#rp-form', b);
    f.onchange = () => { why = (f.querySelector('input[name=why]:checked') || {}).value || null; };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (!why) { toast('Choose what is wrong'); return; }
      try { await api('/api/reports', json('POST', {login: p.login, reason: why, note: f.note.value.trim() || null, ...what})); close(); toast('Thanks. Your report was sent'); }
      catch (x) { toast(x.message); }
    };
    $('#rp-block', b).onclick = async () => {
      try {
        await api(`/api/people/${encodeURIComponent(p.login)}/block`, json('POST', {})); invalidate('/api/'); invalidateFeed();
        close(); toast(`${p.name} is blocked`);
        if (onBlocked) onBlocked(); else go('/activity', {replace: true});
      } catch (x) { toast(x.message); }
    };
  });
}

// ---------- Me > Sharing: the usual choices for new activities ----------
route(/^\/me\/sharing$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Sharing</h1><div id="sh-body">${skel(2)}</div>`;
  wireBack(el, '/me');
  const sharingOwner=readOwner(),s = await api('/api/sharing'), box = $('#sh-body', el);
  if(!el.isConnected)return;
  box.innerHTML = `<div class="card"><h2>Who sees new activities</h2>${visSeg(s.default)}
      <p class="small muted">New accounts start with Everyone on Kinetta. Your saved choice applies to new activities; older activities keep their own setting. You can choose a different audience before saving a phone recording.</p></div>
    <div class="card"><h2>What others see</h2><form class="checks" id="sh-d">${detailChecks(s.details)}</form>
      <p class="small muted">Distance, time and the type of activity are always shown to the people who can see it. Splits and laps are shared only with pace. Private notes and Kit’s notes are never shared. You can choose differently on each activity.</p></div>
    <div class="card"><h2>Friend search</h2><label class="check"><input type="checkbox" id="sh-find"${s.findable ? ' checked' : ''}> Let people find me by name</label>
      <p class="small muted">Off: you don't show up when people on this Kinetta search for friends. Friends you already have, and anyone who types your exact username, can still find you.</p></div>
    <div class="card"><h2>Hide the start and end of your route</h2>
      <div class="seg wide trim4" role="group" aria-label="Hide the start and end">${s.trims.map((m) => `<button type="button" data-trim="${m}" aria-pressed="${m === s.trim_m}">${esc(trimName(m))}</button>`).join('')}</div>
      <p class="small muted">Shared maps leave out this much at the start and at the end, so others can't see where you live. A route too short for that is shared without a map.</p></div>
    <div class="card list" id="sh-blocked"><h2>Blocked people</h2><p class="small muted">Loading…</p></div>`;
  const drawBlocked = (rows) => {
    const b = $('#sh-blocked', box); if (!b) return;
    b.innerHTML = `<h2>Blocked people</h2>${rows.length ? rows.map((p) => `<div class="person">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>
      <button class="ghost sm" data-unblk="${esc(p.login)}">Unblock</button></div>`).join('') : '<p class="small muted">No one. To block someone, open one of their activities or comments and choose Report or block.</p>'}`;
    $$('[data-unblk]', b).forEach((x) => x.onclick = async () => {
      x.disabled = true;
      try { await api(`/api/people/${encodeURIComponent(x.dataset.unblk)}/block`, {method: 'DELETE'}); invalidate('/api/'); drawBlocked(await api('/api/blocks')); toast('Unblocked'); }
      catch (e) { toast(e.message); x.disabled = false; }
    });
  };
  load('/api/blocks', drawBlocked, {maxAge: 0}).catch(() => {});
  const save = async (body, msg) => {
    if(sharingOwner!==readOwner()||!box.isConnected)return;
    const controls=$$('button[data-vis],button[data-trim],#sh-d input',box);controls.forEach(b=>b.disabled=true);
    try {
      await api('/api/sharing',json('PUT',body));if(sharingOwner!==readOwner())return;
      if(body.default){s.default=body.default;App.me.share_default=body.default;keep('/api/me',App.me);}
      if(body.trim_m!==undefined)s.trim_m=body.trim_m;
      if(body.details)s.details=body.details;
      invalidate('/api/');if(box.isConnected)toast(msg);
    }catch(x){
      if(sharingOwner===readOwner()&&box.isConnected){
        $$('[data-vis]',box).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.vis===s.default)));
        $$('[data-trim]',box).forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.trim===s.trim_m)));
        $$('input',f).forEach(b=>b.checked=!!s.details[b.name]);toast(x.message);
      }
    }finally{if(sharingOwner===readOwner()&&box.isConnected)controls.forEach(b=>b.disabled=false);}
  };
  wireSeg(box, 'vis', (v) => save({default: v}, `New activities: ${VIS[v].toLowerCase()}`));
  wireSeg(box, 'trim', (m) => save({trim_m: +m}, m === '0' ? 'Maps show the whole route' : `Maps hide the first and last ${trimName(+m)}`));
  const f = $('#sh-d', box); f.onchange = () => save({details: readChecks(f)}, 'Saved');
  $('#sh-find', box).onchange = async (e) => {
    if(sharingOwner!==readOwner()||!box.isConnected)return;
    const on = e.target.checked;
    try { await api('/api/sharing', json('PUT', {findable: on})); toast(on ? 'People can find you by name' : "You're hidden from friend search"); }
    catch (x) { e.target.checked = !on; toast(x.message); }
  };
});

// ---------- Notifications (2026-10-11, notify.py) ----------
// 2026-10-12 (Ben): the bell shows only your notifications; phone-notification settings live in Me > Settings
// (/me/notifications). /notifications lights no tab (it opens from several).
const PUSH_NAMES = {friends: 'Friend requests', cheers: 'Cheers & reactions', comments: 'Comments', dishes: 'Shared meals', activities: 'New workouts'};
const NOTE_ICON = {friend_request: 'people', friend_accepted: 'people', cheer: 'cheer', comment: 'comment', dish_shared: 'pot', activity_ready: 'check', report: 'lock'};
route(/^\/notifications$/, null, async (el) => {
  el.innerHTML = `<div class="top">${backBtn()}</div><h1>Notifications</h1><div id="nt-list">${skel(2)}</div>`;
  wireBack(el, '/today');
  await load('/api/notifications', (r) => {
    const list = $('#nt-list', el); if (!list) return;
    list.innerHTML = r.items.length ? `<div class="card list notes">${r.items.map((n) => `<a class="note${n.read ? '' : ' unread'}" href="${esc(n.link)}">
        <span class="note-av">${avatar(n.who)}<span class="note-k">${svg(NOTE_ICON[n.kind] || 'people')}</span></span>
        <span class="grow"><span class="note-t">${esc(n.text)}</span><small class="muted">${esc(when(n.created))}</small></span></a>`).join('')}</div>`
      : `<div class="card empty"><b>Nothing yet</b>New workouts, friend requests, ${esc(CHEER.many)}, comments and shared meals show up here.</div>`;
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    if (r.unread) api('/api/notifications/read', json('POST', {})).then(() => { App.me.notifications = 0; Social.badge(); invalidate('/api/notifications'); }).catch(() => {});
  }, {maxAge: 0});
});
route(/^\/me\/notifications$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Notification settings</h1><div id="nt-push">${skel(1)}</div>`;
  wireBack(el, '/me');
  await load('/api/notifications', (r) => {
    const box = $('#nt-push', el); if (!box) return;
    pushCard(box, r);
  }, {maxAge: 0});
});
async function pushCard(box, r) {
  if (!box) return;
  if (!Native.on) {
    box.innerHTML = '<div class="card"><h2>iPhone notifications</h2><p>Open Kinetta’s native iPhone app to turn on phone notifications. Your notification history stays available here.</p></div><div id="np-meal-reminders"></div>';
    mealReminderCard($('#np-meal-reminders',box));
    return;
  }
  if (!Native.pushSupported) {
    box.innerHTML = '<div class="card"><h2>iPhone notifications</h2><p>Update Kinetta from TestFlight to enable iPhone notifications.</p></div>';
    return;
  }
  const account = readOwner();
  let status;
  try { status = await Native.pushStatus(); }
  catch (e) { if (box.isConnected) box.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; return; }
  if (!box.isConnected || account !== readOwner()) return;
  box.innerHTML = `<div class="card"><h2>iPhone notifications</h2>
    ${!r.push_ready ? '<p class="small muted">The server’s Apple notification setup is not complete yet. Your notifications still appear under the bell.</p>' : ''}
    ${status.enabled ? `<div class="checks one" id="np-kinds">${Object.entries(PUSH_NAMES).map(([k, n]) => `<label class="check"><input type="checkbox" name="${k}"${r.push[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <button class="ghost wide" id="np-off">Turn off on this iPhone</button>`
      : status.denied ? '<p class="small muted">Notifications are blocked for Kinetta. Allow them in iPhone Settings → Notifications → Kinetta, then return here.</p><button type="button" class="primary wide" id="np-settings">Open iPhone Settings</button>'
      : `<p class="small muted">Get an alert on this iPhone for friend requests, Cheers and other reactions, comments, meals shared with you, and new workouts from your watch or Apple Health. Choose which ones after turning them on.</p>
        <button class="primary wide" id="np-on">Turn on iPhone notifications</button>`}
    <p class="err" role="alert" id="np-error"></p></div><div id="np-meal-reminders"></div>`;
  mealReminderCard($('#np-meal-reminders',box));
  const error = $('#np-error', box), b = $('#np-on', box), off = $('#np-off', box);
  const settings = $('#np-settings', box);
  if (settings) settings.onclick = async () => { if (account !== readOwner()) return; try { await Native.openPushSettings({enable:true}); } catch (x) { error.textContent = x.message; } };
  if (b) b.onclick = async () => {
    b.disabled = true; b.textContent = 'Connecting…'; error.textContent = '';
    try { await Native.enablePush(); if (box.isConnected && account === readOwner()) pushCard(box, r); }
    catch (x) { error.textContent = x.message; b.disabled = false; b.textContent = 'Turn on iPhone notifications'; }
  };
  if (off) off.onclick = async () => {
    off.disabled = true; error.textContent = '';
    try { await Native.disconnectPush({forget: true}); if (box.isConnected && account === readOwner()) pushCard(box, r); }
    catch (x) { error.textContent = x.message; off.disabled = false; }
  };
  const kinds = $('#np-kinds', box);
  if (kinds) kinds.onchange = async (e) => {
    const k = e.target.name, v = e.target.checked; e.target.disabled = true;
    try { const fresh = await api('/api/notifications/settings', json('PUT', {[k]: v})); if (account === readOwner()) { r.push = fresh.push; invalidate('/api/notifications'); } }
    catch (x) { e.target.checked = !v; error.textContent = x.message; }
    finally { e.target.disabled = false; }
  };
}

async function mealReminderCard(box){
  if(!box)return;const account=readOwner(),valid=()=>box.isConnected&&account===readOwner();
  const draw=async()=>{
    try{
      const state=await api('/api/food/reminders');if(!valid())return;
      const timeLabel=time=>new Date('2000-01-01T'+time+':00Z').toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
      box.innerHTML=`<section class="card meal-reminders"><h2>Meal-time reminders <span class="small muted">Optional</span></h2><p>A quiet invitation to log on your registered iPhones. Off by default. No streaks or calorie nudges.</p>
        <dl>${state.times.map(row=>`<div><dt>${esc(MEAL_NAMES[row.meal])}</dt><dd>${row.ready?'Around '+esc(timeLabel(row.time)):'Building your usual time'}</dd></div>`).join('')}</dl>
        <p class="small muted">Around your usual logging times · 7 am–9 pm (${esc(state.tz)}). A meal already logged stays quiet.</p><details class="reminder-how"><summary>How times work</summary><p>Uses your first same-day log for each meal across the last 28 completed days, rounded to about 15 minutes. Needs 3 daytime logging days. Past-day uploads do not set a time; no default time is invented.</p></details>
        ${!state.push_ready?'<p class="small muted">The server’s Apple notification setup is not complete yet. Reminders cannot start until it is ready.</p>':!state.device_ready?`<p class="small muted">${Native.on?'First turn on iPhone notifications above. Allow Kinetta notifications in your phone’s Settings.':'Open the Kinetta iPhone app to turn on notifications.'}</p>`:''}
        <label class="check"><input type="checkbox" data-meal-reminders${state.enabled?' checked':''}${!state.enabled&&(!state.push_ready||!state.device_ready)?' disabled':''}> Remind me around my usual meal times</label>
        <p class="small muted">Turn this off here any time. An alert already delivered to a phone cannot be recalled.</p><p class="err" role="alert"></p></section>`;
      const toggle=$('[data-meal-reminders]',box);toggle.onchange=async()=>{
        if(!valid())return;const enabled=toggle.checked;toggle.disabled=true;$('.err',box).textContent='';
        try{await api('/api/food/reminders',json('PUT',{enabled,confirmed:enabled}));if(!valid())return;Native.haptic('light');await draw();}
        catch(error){if(valid()){toggle.checked=!enabled;toggle.disabled=false;$('.err',box).textContent=error.message||'Reminder setting could not be saved.';}}
      };
    }catch(error){if(valid()){box.innerHTML='<section class="card"><h2>Meal-time reminders</h2><p>Reminder settings could not load.</p><button class="ghost wide">Try again</button></section>';$('button',box).onclick=draw;}}
  };box.innerHTML=skel(1);await draw();
}
