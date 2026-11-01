// Friends presentation only. Requests, confirmation, search and sharing stay in social.js.
'use strict';
const FriendsUI=(()=>{
 const term=q=>String(q||'').trim().replace(/^@/,'').toLocaleLowerCase();
 const matches=(p,q)=>!term(q)||p.name.toLocaleLowerCase().includes(term(q))||p.login.toLocaleLowerCase().includes(term(q));
 const identity=p=>`${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>`;
 const profile=(p,cls='')=>`<a class="person-link ${cls}" href="${profileHref(p)}" title="${esc(p.name)} · @${esc(p.login)}">${identity(p)}</a>`;
 const shell=back=>`<div class="top">${backBtn(back)}<h1 id="fr-title">Friends</h1><a class="icon-btn" href="${profileHref(App.me)}" aria-label="Your profile">${avatar(App.me)}</a></div>
   <section id="fr-discover" class="friend-discovery" aria-label="Find people"><div class="friend-search-line"><form class="searchbox people-search" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" placeholder="Name" aria-label="Find people by name or @username" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"><button type="button" class="icon-btn" id="fr-clear" aria-label="Clear search" hidden>${svg('close')}</button></form><button type="button" class="linkbtn" id="fr-browse">Browse ${svg('chev')}</button></div><p class="small muted" id="fr-status" role="status" aria-live="polite"></p></section>
   <div id="fr-list-error" role="status"></div><div id="fr-lists">${skel(1)}</div><div id="fr-found"></div><section class="friend-more"><div id="fr-suggest"></div></section>
   <div class="friend-footer"><div id="fr-sent"></div><button type="button" class="friend-footer-row" id="fr-invite">${svg('people')}<span>Invite a friend</span>${svg('chev')}</button><a class="friend-footer-row" href="/me/sharing" id="fr-sharing">${svg('lock')}<span>Sharing &amp; privacy</span>${svg('chev')}</a></div>`;
 const lists=r=>`${r.incoming.length?`<section class="friend-requests"><h2 class="sec-head">Waiting for you <span class="count">${r.incoming.length}</span></h2>${r.incoming.map(p=>`<div class="person fr-request">${profile(p)}<span class="btnrow tight"><button type="button" class="primary sm" data-ok="${esc(p.login)}">Approve</button><button type="button" class="ghost sm" data-no="${esc(p.login)}">Decline</button><button type="button" class="icon-btn" data-request-menu="${esc(p.login)}" aria-label="More about request from ${esc(p.name)}">${svg('more')}</button></span>${p.via_card?'<small class="muted card-origin">via your card</small>':''}</div>`).join('')}</section>`:''}
   <section class="friend-own"><h2 class="sec-head">${r.friends.length?`Your friends <span class="count">${r.friends.length}</span>`:'Your friends'}</h2><div id="fr-own-list">${r.friends.length?r.friends.map(p=>`<div class="person fr-friend" data-friend-name="${esc((p.name+' '+p.login).toLocaleLowerCase())}">${profile(p,'fr-friend-link')}<button type="button" class="icon-btn" data-manage="${esc(p.login)}" aria-label="Manage friendship with ${esc(p.name)}">${svg('more')}</button></div>`).join(''):'<div class="friend-empty"><p>Follow each other’s workouts.</p><div class="btnrow"><button type="button" class="ghost" data-find-people>Find people</button><button type="button" class="primary" data-invite-empty>Invite</button></div></div>'}</div><p class="small muted" id="fr-filter-empty" hidden>No friends match this search.</p></section>`;
 const sent=rows=>rows.length?`<button type="button" class="friend-footer-row" id="fr-sent-open"><span>${rows.length} ${rows.length===1?'request':'requests'} sent</span>${svg('chev')}</button>`:'';
 const sentRows=rows=>`<div class="friend-sent-list">${rows.map(p=>`<div class="person">${profile(p)}<button type="button" class="ghost sm" data-cancel="${esc(p.login)}">Cancel</button></div>`).join('')}</div>`;
 async function mount(el){
  el.classList.add('friends-page');el.innerHTML=shell('Me');
  wireBack(el, '/me');
  const pageOwner=readOwner();let currentFriends=null,filterText='',friendLoadVersion=0;
  const lists = $('#fr-lists', el), found = $('#fr-found', el), f = $('#fr-find', el), suggest = $('#fr-suggest', el);
  $('#fr-invite', el).onclick = inviteFriends;
  const drawSuggest=async()=>{const people=(await suggestedPeople()).slice(0,6);if(pageOwner!==readOwner()||!suggest.isConnected)return;suggest.parentElement.hidden=!people.length;if(people.length)peopleRow(suggest,people,{invite:false,onChange:()=>loadFriends()});else suggest.innerHTML='';};
  const person = (p, btns, cls = '') => `<div class="person ${cls}">${personLink(p)}${p.via_card?'<small class="muted card-origin">via your card</small>':''}<span class="btnrow tight">${btns}</span></div>`;
  const btnFor = (p) => ({friends: `<span class="badge on">${svg('check')} Friends</span>`,
    sent: `<button class="ghost sm" data-cancel="${esc(p.login)}">Cancel request</button>`,
    incoming: `<button class="primary sm" data-ok="${esc(p.login)}">Approve</button>`})[p.status] || `<button class="primary sm" data-add="${esc(p.login)}">${svg('plus')}Add</button>`;
  const filterFriends=()=>{
    if(!currentFriends)return;const q=input.value;let shown=0;
    $$('#fr-own-list .fr-friend',lists).forEach((row,i)=>{row.hidden=!matches(currentFriends.friends[i],q);if(!row.hidden)shown++;});
    const note=$('#fr-filter-empty',lists);if(note)note.hidden=!currentFriends.friends.length||shown>0;
  };
  const input = f.elements.q, clear = $('#fr-clear', el), status = $('#fr-status', el);
  const initial = new URLSearchParams(location.search);
  input.value = initial.get('q') || '';
  let last = null, people = [], known = [], browsing = false;
  const who = (login) => (people.find((p) => p.login === login) || {}).name || login;
  const drawListError = (x) => {
    if(!lists.isConnected||pageOwner!==readOwner())return;
    const box=$('#fr-list-error',el);box.innerHTML=`<p class="small muted">${currentFriends?'Showing your last friends list. ':''}${esc(x.message)}</p><button type="button" class="ghost" id="fr-list-retry">Retry friends</button>`;
    $('#fr-list-retry',box).onclick=loadFriends;
  };
  async function loadFriends(){
    const request=++friendLoadVersion;
    try{const r=await api('/api/friends');if(request!==friendLoadVersion||pageOwner!==readOwner()||!lists.isConnected)return;App.cache.set('/api/friends',{data:r,at:Date.now()});keep('/api/friends',r);draw(r);$('#fr-list-error',el).innerHTML='';}
    catch(x){if(request===friendLoadVersion)drawListError(x);}
  }
  const refresh = async (change) => {
    if(pageOwner!==readOwner()||!lists.isConnected)return;
    clearTimeout(t);searchVersion++;
    if(change?.login&&currentFriends){
      const r={...currentFriends};for(const k of ['friends','incoming','outgoing'])r[k]=r[k].filter(p=>p.login!==change.login);
      keep('/api/friends',r);draw(r);
    }
    invalidate('/api/feed/friends');invalidate('/api/people/');invalidate('/api/shared/');invalidate('/api/blocks');invalidateFeed();App.cache.delete('/api/friends');
    await loadFriends();if(found.isConnected)await find(true);
  };
  const act = (box, sel, fn) => $$(sel, box).forEach((b) => b.onclick = async () => {
    if(pageOwner!==readOwner()||!box.isConnected||b.disabled)return;
    b.disabled = true;
    try { if (await fn(b) === false) { b.disabled = false; return; } await refresh(); }
    catch (x) { if(pageOwner===readOwner()&&box.isConnected){toast(x.message); b.disabled = false;} }
  });
  const wire = (box) => {
    $$('[data-request-menu]',box).forEach(button=>button.onclick=()=>{
      const p=people.find(p=>p.login===button.dataset.requestMenu);if(!p)return;
      sheet(p.name,`<button type="button" class="ghost wide danger" id="fr-block-request">Block ${esc(p.name)}</button>`,(b,close)=>{const live=()=>pageOwner===readOwner()&&b.isConnected;if(!live()){close();return;}$('#fr-block-request',b).onclick=()=>{if(!live())return;close();friendChangeSheet(p,true,refresh);};});
    });
    $$('[data-manage]', box).forEach((button) => button.onclick = () => friendshipSheet(people.find(p => p.login === button.dataset.manage), refresh));
    act(box, '[data-add]', async (b) => { const r = await api('/api/friends', json('POST', {login: b.dataset.add})); toast(r.status === 'friends' ? `You and ${r.name} are friends now` : `Request sent to ${r.name}`); });
    act(box, '[data-ok]', async (b) => { await api(`/api/friends/${encodeURIComponent(b.dataset.ok)}/accept`, json('POST', {})); toast(`You and ${who(b.dataset.ok)} are friends now`); });
    act(box, '[data-no]', (b) => api(`/api/friends/${encodeURIComponent(b.dataset.no)}/decline`, json('POST', {})));
    act(box, '[data-cancel]', (b) => api('/api/friends/' + encodeURIComponent(b.dataset.cancel), {method: 'DELETE'}));
    $$('[data-blk]',box).forEach(b=>b.onclick=()=>friendChangeSheet(people.find(p=>p.login===b.dataset.blk),true,refresh));
  };
  const otherPeople=rows=>rows.filter(p=>p.status!=='friends'&&!currentFriends?.friends.some(f=>f.login===p.login)&&p.login!==App.me.login);
  const drawResults = (rows, pending = false) => {
    rows=otherPeople(rows);
    found.innerHTML = `<h2 class="sec-head">Others on Kinetta</h2><div class="card list">${rows.length ? rows.map((p) => person(p, btnFor(p))).join('') : pending ? '<p class="small muted">Searching…</p>' : '<p class="small muted">No people found. Try their full username, or check the spelling.</p>'}</div>`;
    wire(found);
  };
  let t, searchVersion = 0;
  async function find(again) {
    const q = input.value.trim();
    clear.hidden = !q && !browsing; suggest.hidden = !!q || browsing;
    if (!q && !browsing) { last = null; found.innerHTML = ''; status.textContent = ''; found.setAttribute('aria-busy', 'false'); return; }
    if (q === last && !again) return; last = q;
    const request = ++searchVersion;
    found.setAttribute('aria-busy', 'true'); status.textContent = 'Searching…';
    try {
      const r = await api('/api/people/search?q=' + encodeURIComponent(q));
      if (request !== searchVersion || !found.isConnected || pageOwner!==readOwner()) return;
      people = [...new Map(people.concat(r).map((p) => [p.login, p])).values()];
      drawResults(r);const count=otherPeople(r).length;status.textContent=`${count} other ${count===1?'person':'people'} found`;
    } catch (x) { if (request === searchVersion && found.isConnected) { last = null; status.textContent = ''; found.innerHTML = `<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" data-retry>Retry search</button>`; $('[data-retry]', found).onclick = () => find(true); } }
    finally { if (request === searchVersion) found.setAttribute('aria-busy', 'false'); }
  }
  const search = () => {
    clearTimeout(t); last = null; searchVersion++; browsing = false;filterFriends();
    const q = input.value.trim(), url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    url.searchParams.delete('find'); history.replaceState(history.state, '', url.pathname + url.search);
    if (!q) { find(); return; }
    clear.hidden = false; suggest.hidden = true;
    const term = q.replace(/^@/, '').toLocaleLowerCase();
    drawResults(known.filter(p => p.name.toLocaleLowerCase().includes(term) || p.login.toLocaleLowerCase().includes(term)).slice(0, 20), true);
    found.setAttribute('aria-busy', 'true'); status.textContent = 'Searching…';
    t = setTimeout(() => find(), 180);
  };
  input.oninput = search;
  clear.onclick = () => { input.value = ''; search(); input.focus(); };
  $('#fr-browse', el).onclick = async () => { clearTimeout(t); input.value = '';filterFriends(); browsing = true;await find(true);if(pageOwner===readOwner()&&found.isConnected)found.scrollIntoView({block:'start'}); };
  viewResources.set(f, () => { clearTimeout(t); searchVersion++; });
  f.onsubmit = (e) => { e.preventDefault(); clearTimeout(t); find(true); };
  const draw = (r) => {
    r={...r,friends:[...r.friends].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.login.localeCompare(b.login))};
    currentFriends=r;App.me.friend_count=r.friends.length;
    Social.set(r.incoming.length);
    known = r.incoming.map(p => ({...p, status:'incoming'})).concat(r.friends.map(p => ({...p,status:'friends'})), r.outgoing.map(p => ({...p,status:'sent'})));
    people = [...new Map(people.concat(known).map(p => [p.login, p])).values()];
    lists.innerHTML=FriendsUI.lists(r);filterFriends();
    $('#fr-invite',el).hidden=!r.friends.length;
    $('#fr-sent',el).innerHTML=sent(r.outgoing);const sentButton=$('#fr-sent-open',el);
    if(sentButton)sentButton.onclick=()=>sheet('Requests you sent',sentRows(currentFriends.outgoing),(b,close)=>{
      const live=()=>pageOwner===readOwner()&&b.isConnected;if(!live()){close();return;}act(b,'[data-cancel]',async button=>{await api('/api/friends/'+encodeURIComponent(button.dataset.cancel),{method:'DELETE'});close();});
    });
    const findButton=$('[data-find-people]',lists);if(findButton)findButton.onclick=()=>input.focus();
    const inviteButton=$('[data-invite-empty]',lists);if(inviteButton)inviteButton.onclick=inviteFriends;
    wire(lists);
  };
  const searching = find();
  if(initial.has('find')||initial.has('q'))input.focus();
  const cached=screenHit('/api/friends')?.data||kept('/api/friends');if(cached)draw(cached);
  await loadFriends();
  drawSuggest();
  api('/api/sharing').then(s=>{if(pageOwner===readOwner()&&el.isConnected&&VIS_SHORT[s.default])$('#fr-sharing span',el).textContent='New activities: '+VIS_SHORT[s.default];}).catch(()=>{});
  await searching;
 }
 return Object.freeze({shell,lists,sent,sentRows,matches,mount});
})();
