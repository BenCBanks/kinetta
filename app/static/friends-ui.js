// Find friends presentation. Search and sharing live in social.js.
'use strict';
const FriendsUI=(()=>{
 const identity=p=>`${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>`;
 const profile=(p,cls='')=>`<a class="person-link ${cls}" href="${profileHref(p)}" title="${esc(p.name)} · @${esc(p.login)}">${identity(p)}</a>`;
 const status=label=>`<span class="friend-status" role="status"><span aria-hidden="true">✓</span> ${label}</span>`;
 const bindLargeTitle=el=>{
  const bar=el.querySelector(':scope > .top.large-title'),heading=el.querySelector(':scope > .large-title-heading');if(!bar||!heading)return;
  bar.dataset.titleCollapsed=String(!('IntersectionObserver' in window));if(!('IntersectionObserver' in window))return;
  const observer=new IntersectionObserver(([entry])=>{bar.dataset.titleCollapsed=String(!entry.isIntersecting);},{rootMargin:'-56px 0px 0px 0px'});observer.observe(heading);viewResources.set(el,()=>observer.disconnect());
 };
 const shell=back=>`<div class="top large-title">${backBtn(back)}<h1 id="fr-title">Find friends</h1></div><div class="large-title-heading" data-type="title" aria-hidden="true">Find friends</div>
   <section id="fr-discover" class="friend-discovery" aria-label="Find people"><form class="searchbox people-search" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" placeholder="Name or @username" aria-label="Search name or @username" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"><button type="button" class="icon-btn" id="fr-clear" aria-label="Clear search" hidden>${svg('close')}</button></form><p class="small muted" id="fr-status" role="status" aria-live="polite"></p></section>
   <div id="fr-found"></div>
   <div id="fr-sections"><div id="fr-list-error" role="status"></div><div id="fr-requests"></div><section class="friend-suggest-section friend-more" hidden><div id="fr-suggest"></div></section>
   <button type="button" class="friend-invite-primary" id="fr-invite">Invite a friend</button>
   <section class="friend-more-ways"><h2>More ways</h2><a class="friend-more-row" id="fr-contacts" href="/me/friends/contacts">Find from contacts</a><a class="friend-more-row" id="fr-groups-discover" href="/me/groups">Groups</a><button type="button" class="friend-more-row" id="fr-sent-toggle" aria-expanded="false" aria-controls="fr-sent">Sent requests</button><div id="fr-sent" hidden></div></section></div>`;
 const requestSections=r=>`${r.incoming.length?`<section class="friend-request-section"><h3>Waiting for you</h3><div class="friend-inline-request-list">${r.incoming.map(p=>`<div class="person person-row fr-request">${profile(p)}<span class="friend-inline-actions"><button type="button" class="friend-inline-accept" data-request-accept="${esc(p.login)}">Accept</button><button type="button" class="friend-inline-muted" data-request-decline="${esc(p.login)}">Decline</button></span>${p.via_card?'<small class="muted card-origin">via your card</small>':''}</div>`).join('')}</div></section>`:''}
   ${r.outgoing.length?`<section class="friend-request-section"><h3>Sent</h3><div class="friend-inline-request-list">${r.outgoing.map(p=>`<div class="person person-row fr-request">${profile(p)}<button type="button" class="friend-inline-muted" data-request-cancel="${esc(p.login)}">Cancel</button></div>`).join('')}</div></section>`:''}`;
 const requestRow=(r,expanded=false)=>{const total=r.incoming.length+r.outgoing.length;if(!total)return '';return `<div class="social-list-group friend-request-group"><button type="button" class="list-row friend-request-summary" id="fr-requests-open" aria-label="Review friend requests" aria-expanded="${expanded}" aria-controls="fr-requests-content"><span class="ri">${svg('people')}</span><span class="grow"><b>Friend requests</b></span>${r.incoming.length?`<span class="count">${r.incoming.length}</span>`:''}${svg('chev')}</button><div class="friend-inline-requests" id="fr-requests-content"${expanded?'':' hidden'}>${requestSections(r)}</div></div>`;};
 const drawRequests=(container,r,live,refresh)=>{
  const expanded=$('#fr-requests-open',container)?.getAttribute('aria-expanded')==='true';
  container.innerHTML=requestRow(r,expanded);const toggle=$('#fr-requests-open',container),content=$('#fr-requests-content',container);if(!toggle||!content)return;
  toggle.onclick=()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));content.hidden=!open;};
  $$('[data-request-accept],[data-request-decline],[data-request-cancel]',content).forEach(button=>button.onclick=async()=>{
   if(!live()||!content.isConnected||button.disabled)return;button.disabled=true;
   try{const login=encodeURIComponent(button.dataset.requestAccept||button.dataset.requestDecline||button.dataset.requestCancel);if(button.hasAttribute('data-request-accept'))await api(`/api/friends/${login}/accept`,json('POST',{}));else if(button.hasAttribute('data-request-decline'))await api(`/api/friends/${login}/decline`,json('POST',{}));else await api(`/api/friends/${login}`,{method:'DELETE'});if(live())await refresh();}
   catch(x){if(live()&&content.isConnected){toast(x.message);button.disabled=false;}}
  });
 };
 async function mountList(el){
  el.classList.add('friends-page','friends-list-page');
  el.innerHTML=`<div class="top large-title">${backBtn('Me')}<h1 id="fr-title">Friends</h1><button type="button" class="linkbtn" id="fr-list-add">Add</button></div><div class="large-title-heading" data-type="title" aria-hidden="true">Friends</div>
    <div class="social-list-group" id="fr-social-links"><a class="list-row" id="fr-groups" href="/me/groups"><span class="ri">${svg('people')}</span><span class="grow"><b>Groups</b><small>Private groups and events</small></span>${svg('chev')}</a></div>
    <div id="fr-list-error" role="status"></div><div id="fr-requests"></div>
    <section class="friend-own" aria-label="Your friends"><h2 class="sec-head" id="fr-own-heading">Your friends</h2><div class="social-person-group" id="fr-own-list">${skel(1)}</div></section>`;
  wireBack(el,'/me');
  bindLargeTitle(el);
  $('#fr-list-add',el).onclick=inviteFriends;
  const owner=readOwner(),live=()=>owner===readOwner()&&el.isConnected;
  const list=$('#fr-own-list',el),heading=$('#fr-own-heading',el),requests=$('#fr-requests',el),error=$('#fr-list-error',el);
  let currentFriends=null,people=[],version=0;
  function draw(r){
    r={...r,friends:[...r.friends].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.login.localeCompare(b.login))};
    currentFriends=r;people=r.incoming.concat(r.friends,r.outgoing);App.me.friend_count=r.friends.length;Social.set(r.incoming.length);
    heading.innerHTML=`Your friends${r.friends.length?` <span class="count">${r.friends.length}</span>`:''}`;
    drawRequests(requests,r,live,refresh);
    list.innerHTML=r.friends.length?r.friends.map(p=>`<div class="person person-row fr-friend" data-friend-name="${esc((p.name+' '+p.login).toLocaleLowerCase())}">${profile(p,'fr-friend-link')}<button type="button" class="icon-btn" data-manage="${esc(p.login)}" aria-label="Manage friendship with ${esc(p.name)}">${svg('more')}</button></div>`).join(''):
      '<div class="friend-empty"><b>No friends yet</b><p>Search by name or @username, or tap Add to share an invite link.</p></div>';
    $$('[data-manage]',list).forEach(button=>button.onclick=()=>{
      if(!live())return;const p=people.find(person=>person.login===button.dataset.manage);if(p)friendshipSheet(p,refresh);
    });
  }
  async function loadFriends(){
    const request=++version;
    try{const r=await api('/api/friends');if(request!==version||!live())return;App.cache.set('/api/friends',{data:r,at:Date.now()});keep('/api/friends',r);draw(r);error.innerHTML='';}
    catch(x){if(request===version&&live()){error.innerHTML=`<p class="small muted">${currentFriends?'Your last friends list is shown. ':''}${esc(x.message)}</p><button type="button" class="ghost" id="fr-list-retry">Retry</button>`;$('#fr-list-retry',error).onclick=loadFriends;}}
  }
  async function refresh(){
    if(!live())return;invalidate('/api/feed/friends');invalidate('/api/people/');invalidate('/api/shared/');invalidate('/api/blocks');invalidateFeed();App.cache.delete('/api/friends');await loadFriends();
  }
  function action(body,close,selector,run){
    $$(selector,body).forEach(button=>button.onclick=async()=>{
      if(!live()||!body.isConnected||button.disabled)return;button.disabled=true;
      try{await run(button);if(!live())return;close();await refresh();}
      catch(x){if(live()&&body.isConnected){toast(x.message);button.disabled=false;}}
    });
  }
  const cached=screenHit('/api/friends')?.data||kept('/api/friends');if(cached)draw(cached);await loadFriends();
 }
 async function mountFind(el){
  const initial=new URLSearchParams(location.search),fromHome=initial.get('from')==='home';
  el.classList.add('friends-page');el.innerHTML=shell(fromHome?'Home':'Me');wireBack(el,fromHome?'/activity':'/me');bindLargeTitle(el);
  const pageOwner=readOwner(),live=()=>pageOwner===readOwner()&&el.isConnected;
  let currentFriends=null,friendLoadVersion=0,searchVersion=0,timer,last=null,people=[],known=[];
  const requests=$('#fr-requests',el),found=$('#fr-found',el),form=$('#fr-find',el),input=form.elements.q,clear=$('#fr-clear',el),statusText=$('#fr-status',el),suggest=$('#fr-suggest',el),error=$('#fr-list-error',el),sections=$('#fr-sections',el),sent=$('#fr-sent',el),sentToggle=$('#fr-sent-toggle',el);
  input.value=initial.get('q')||'';
  const who=login=>(people.find(p=>p.login===login)||{}).name||login;
  $('#fr-invite',el).onclick=inviteFriends;
  function drawListError(x){
    if(!live())return;error.innerHTML=`<p class="small muted">${currentFriends?'Requests may be out of date. ':''}${esc(x.message)}</p><button type="button" class="ghost" id="fr-list-retry">Retry</button>`;
    $('#fr-list-retry',error).onclick=loadFriends;
  }
  async function loadFriends(){
    const request=++friendLoadVersion;
    try{const r=await api('/api/friends');if(request!==friendLoadVersion||!live())return;App.cache.set('/api/friends',{data:r,at:Date.now()});keep('/api/friends',r);draw(r);error.innerHTML='';}
    catch(x){if(request===friendLoadVersion)drawListError(x);}
  }
  async function refresh(){
    if(!live())return;clearTimeout(timer);last=null;searchVersion++;
    invalidate('/api/feed/friends');invalidate('/api/people/');invalidate('/api/shared/');invalidate('/api/blocks');invalidateFeed();App.cache.delete('/api/friends');
    await loadFriends();await drawSuggest();if(input.value.trim()&&found.isConnected)await find(true);
  }
  const person=(p,action)=>`<div class="person person-row">${personLink(p)}<span class="btnrow tight">${action}</span></div>`;
  const btnFor=p=>p.status==='friends'?status('Friends'):p.status==='sent'||p.status==='incoming'?status('Requested'):`<button type="button" class="search-add" data-add="${esc(p.login)}" aria-label="Add ${esc(p.name)} as a friend">${svg('plus')}</button>`;
  const drawResults=(rows,pending=false)=>{
    rows=rows.filter(p=>p.login!==App.me.login);
    found.innerHTML=rows.length?rows.map(p=>person(p,btnFor(p))).join(''):pending?'<p class="small muted">Searching…</p>':'<p class="small muted">No people found. Try their full username, or check the spelling.</p>';
    $$('[data-add]',found).forEach(button=>button.onclick=async()=>{
      if(!live()||button.disabled)return;const label=button.getAttribute('aria-label');button.disabled=true;button.classList.add('is-pending');button.setAttribute('aria-busy','true');button.setAttribute('aria-label',label.replace(/^Add /,'Sending request to '));
      try{const r=await api('/api/friends',json('POST',{login:button.dataset.add}));if(!live())return;toast(r.status==='friends'?`You and ${r.name} are friends now`:`Request sent to ${r.name}`);await refresh();}
      catch(x){if(live()){toast(x.message);button.disabled=false;button.classList.remove('is-pending');button.removeAttribute('aria-busy');button.setAttribute('aria-label',label);button.innerHTML=svg('plus');}}
    });
  };
  async function find(again){
    const q=input.value.trim(),query=q.replace(/^@/,'').trim();clear.hidden=!q;sections.hidden=query.length>=2;
    if(!q){last=null;found.innerHTML='';statusText.textContent='';found.setAttribute('aria-busy','false');return;}
    if(query.length<2){last=null;found.innerHTML='';statusText.textContent='Type at least 2 characters to search.';found.setAttribute('aria-busy','false');return;}
    if(q===last&&!again)return;last=q;const request=++searchVersion;found.setAttribute('aria-busy','true');statusText.textContent='Searching…';
    try{const rows=await api('/api/people/search?q='+encodeURIComponent(q));if(request!==searchVersion||!live()||!found.isConnected)return;
      people=[...new Map(people.concat(rows).map(p=>[p.login,p])).values()];drawResults(rows);statusText.textContent=`${rows.length} ${rows.length===1?'person':'people'} found`;
    }catch(x){if(request===searchVersion&&live()&&found.isConnected){last=null;statusText.textContent='';found.innerHTML=`<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" data-retry>Retry search</button>`;$('[data-retry]',found).onclick=()=>find(true);}}
    finally{if(request===searchVersion)found.setAttribute('aria-busy','false');}
  }
  const queryHasResults=q=>q.replace(/^@/,'').trim().length>=2;
  const search=()=>{
    clearTimeout(timer);last=null;searchVersion++;
    const q=input.value.trim(),url=new URL(location.href);if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');url.searchParams.set('find','1');history.replaceState(history.state,'',url.pathname+url.search);
    sections.hidden=queryHasResults(q);
    if(!q){clear.hidden=true;found.innerHTML='';statusText.textContent='';found.setAttribute('aria-busy','false');return;}
    clear.hidden=false;const query=q.replace(/^@/,'').trim(),lower=query.toLocaleLowerCase();
    if(query.length<2){found.innerHTML='';found.setAttribute('aria-busy','false');statusText.textContent='Type at least 2 characters to search.';return;}
    drawResults(known.filter(p=>p.name.toLocaleLowerCase().includes(lower)||p.login.toLocaleLowerCase().includes(lower)).slice(0,20),true);
    found.setAttribute('aria-busy','true');statusText.textContent='Searching…';timer=setTimeout(()=>find(),180);
  };
  input.oninput=search;clear.onclick=()=>{input.value='';search();input.focus();};viewResources.set(form,()=>{clearTimeout(timer);searchVersion++;});
  form.onsubmit=e=>{e.preventDefault();clearTimeout(timer);find(true);};
  function drawDiscoverRequests(r){
    const incoming=r.incoming||[],outgoing=r.outgoing||[];
    requests.innerHTML=incoming.length?`<section class="friend-request-section" aria-labelledby="fr-waiting-title"><h2 id="fr-waiting-title" class="friend-section-title">Waiting for you <span class="friend-request-count">${incoming.length}</span></h2><div class="friend-inline-request-list">${incoming.map(p=>`<div class="person person-row fr-request">${profile(p)}<span class="friend-inline-actions"><button type="button" class="friend-inline-accept" data-request-accept="${esc(p.login)}">Accept</button><button type="button" class="friend-inline-muted" data-request-decline="${esc(p.login)}">Decline</button></span>${p.via_card?'<small class="muted card-origin">via your card</small>':''}</div>`).join('')}</div></section>`:'';
    sent.innerHTML=outgoing.length?`<div class="friend-inline-request-list">${outgoing.map(p=>`<div class="person person-row fr-request">${profile(p)}<button type="button" class="friend-inline-muted" data-request-cancel="${esc(p.login)}">Cancel</button></div>`).join('')}</div>`:'<p class="friend-sent-empty">No sent requests</p>';
    sentToggle.textContent=`Sent requests${outgoing.length?` · ${outgoing.length}`:''}`;
    $$('[data-request-accept],[data-request-decline],[data-request-cancel]',el).forEach(button=>button.onclick=async()=>{
      if(!live()||button.disabled)return;button.disabled=true;
      try{const login=encodeURIComponent(button.dataset.requestAccept||button.dataset.requestDecline||button.dataset.requestCancel);if(button.hasAttribute('data-request-accept'))await api(`/api/friends/${login}/accept`,json('POST',{}));else if(button.hasAttribute('data-request-decline'))await api(`/api/friends/${login}/decline`,json('POST',{}));else await api(`/api/friends/${login}`,{method:'DELETE'});if(live())await refresh();}
      catch(x){if(live()){toast(x.message);button.disabled=false;}}
    });
  }
  sentToggle.onclick=()=>{const open=sentToggle.getAttribute('aria-expanded')!=='true';sentToggle.setAttribute('aria-expanded',String(open));sent.hidden=!open;};
  const draw=r=>{
    currentFriends=r;App.me.friend_count=r.friends.length;Social.set(r.incoming.length);
    known=r.incoming.map(p=>({...p,status:'incoming'})).concat(r.friends.map(p=>({...p,status:'friends'})),r.outgoing.map(p=>({...p,status:'sent'})));
    people=[...new Map(people.concat(known).map(p=>[p.login,p])).values()];drawDiscoverRequests(r);
  };
  async function drawSuggest(){
    const rows=(await suggestedPeople()).slice(0,5);if(!live()||!suggest.isConnected)return;
    suggest.parentElement.hidden=!rows.length;if(!rows.length){suggest.innerHTML='';return;}
    peopleRow(suggest,rows,{title:'Suggested',invite:false,dismiss:false,compactAdd:true,onChange:loadFriends});
    const card=$('.pym',suggest),title=$('.pym-head h2',card),list=$('.pym-list',card);title.className='friend-suggest-title';list.classList.add('social-person-group','friend-suggestion-group');
    $$('.pym-row',list).forEach(row=>row.classList.add('person-row'));
    suggest.replaceChildren(title,list);
  }
  const cached=screenHit('/api/friends')?.data||kept('/api/friends');if(cached)draw(cached);
  const searching=find();
  await loadFriends();drawSuggest();await searching;
 }
 async function mount(el){const q=new URLSearchParams(location.search);return q.has('find')||q.has('q')?mountFind(el):mountList(el);}
 return Object.freeze({shell,requests:requestSections,mount});
})();
