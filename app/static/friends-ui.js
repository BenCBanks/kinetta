// Find friends presentation. Requests stay available in a compact sheet; search and sharing live in social.js.
'use strict';
const FriendsUI=(()=>{
 const identity=p=>`${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">@${esc(p.login)}</small></span>`;
 const profile=(p,cls='')=>`<a class="person-link ${cls}" href="${profileHref(p)}" title="${esc(p.name)} · @${esc(p.login)}">${identity(p)}</a>`;
 const status=label=>`<span class="friend-status" role="status"><span aria-hidden="true">✓</span> ${label}</span>`;
 const shell=back=>`<div class="top">${backBtn(back)}<h1 id="fr-title">Find friends</h1></div>
   <section id="fr-discover" class="friend-discovery" aria-label="Find people"><form class="searchbox people-search" id="fr-find" role="search"><span class="sb-ico">${svg('search')}</span><input type="search" name="q" placeholder="Name or @username" aria-label="Search name or @username" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search"><button type="button" class="icon-btn" id="fr-clear" aria-label="Clear search" hidden>${svg('close')}</button></form><p class="small muted" id="fr-status" role="status" aria-live="polite"></p></section>
   <div class="friends-groups-shortcut" id="fr-groups-shortcut"><a class="row-link friend-action" id="fr-groups-discover" href="/me/groups"><span class="ri">${svg('calendar')}</span><span class="grow"><b>Groups</b><small id="fr-groups-count" aria-live="polite">Your private groups</small></span></a><a class="linkbtn" id="fr-group-create" href="/me/groups?create=1" aria-label="Create a group">Create</a></div>
   <div id="fr-found"></div><div id="fr-list-error" role="status"></div>
   <button type="button" class="row-link friend-action" id="fr-invite"><span class="ri">${svg('share')}</span><span class="grow"><b>Invite friends</b><small>Share a link or QR code</small></span>${svg('chev')}</button>
   <div id="fr-requests"></div><section class="friend-more" hidden><div id="fr-suggest"></div></section>`;
 const requestSections=r=>`${r.incoming.length?`<section class="friend-requests"><h2 class="sec-head">Waiting for you <span class="count">${r.incoming.length}</span></h2>${r.incoming.map(p=>`<div class="person fr-request">${profile(p)}<span class="btnrow tight"><button type="button" class="primary sm" data-request-accept="${esc(p.login)}">Approve</button><button type="button" class="ghost sm" data-request-decline="${esc(p.login)}">Decline</button><button type="button" class="icon-btn" data-request-menu="${esc(p.login)}" aria-label="More about request from ${esc(p.name)}">${svg('more')}</button></span>${p.via_card?'<small class="muted card-origin">via your card</small>':''}</div>`).join('')}</section>`:''}
   ${r.outgoing.length?`<section class="friend-requests"><h2 class="sec-head">You sent</h2><div class="friend-sent-list">${r.outgoing.map(p=>`<div class="person">${profile(p)}<button type="button" class="ghost sm" data-request-cancel="${esc(p.login)}">Cancel</button></div>`).join('')}</div></section>`:''}`;
 async function mountList(el){
  el.classList.add('friends-page','friends-list-page');
  el.innerHTML=`<div class="top">${backBtn('Me')}<h1 id="fr-title">Friends</h1><a class="icon-btn" id="fr-browse" href="/me/friends?find=1" aria-label="Find friends">${svg('user-plus')}</a></div>
    <a class="row-link friend-action" id="fr-groups" href="/me/groups"><span class="ri">${svg('calendar')}</span><span class="grow"><b>Groups</b><small>Plan an event together</small></span>${svg('chev')}</a>
    <div id="fr-list-error" role="status"></div><div id="fr-requests"></div>
    <section class="friend-own" aria-label="Your friends"><h2 class="sec-head" id="fr-own-heading">Your friends</h2><div id="fr-own-list">${skel(1)}</div></section>`;
  wireBack(el,'/me');
  const owner=readOwner(),live=()=>owner===readOwner()&&el.isConnected;
  const list=$('#fr-own-list',el),heading=$('#fr-own-heading',el),requests=$('#fr-requests',el),error=$('#fr-list-error',el);
  let currentFriends=null,people=[],version=0;
  function draw(r){
    r={...r,friends:[...r.friends].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.login.localeCompare(b.login))};
    currentFriends=r;people=r.incoming.concat(r.friends,r.outgoing);App.me.friend_count=r.friends.length;Social.set(r.incoming.length);
    heading.innerHTML=`Your friends${r.friends.length?` <span class="count">${r.friends.length}</span>`:''}`;
    requests.innerHTML=r.incoming.length+r.outgoing.length?`<button type="button" class="row-link friend-request-summary" id="fr-requests-open"><span>Requests (${r.incoming.length+r.outgoing.length})</span>${svg('chev')}</button>`:'';
    const requestButton=$('#fr-requests-open',requests);if(requestButton)requestButton.onclick=openRequests;
    list.innerHTML=r.friends.length?r.friends.map(p=>`<div class="person fr-friend" data-friend-name="${esc((p.name+' '+p.login).toLocaleLowerCase())}">${profile(p,'fr-friend-link')}<button type="button" class="icon-btn" data-manage="${esc(p.login)}" aria-label="Manage friendship with ${esc(p.name)}">${svg('more')}</button></div>`).join(''):
      '<div class="friend-empty"><p>No friends yet.</p><a class="row-link friend-action" id="fr-empty-browse" href="/me/friends?find=1"><span class="ri">'+svg('user-plus')+'</span><span class="grow"><b>Find friends</b><small>Search and suggestions</small></span>'+svg('chev')+'</a></div>';
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
  function openRequests(){
    if(!currentFriends||!live())return;
    sheet('Requests',requestSections(currentFriends),(body,close)=>{
      $$('[data-request-menu]',body).forEach(button=>button.onclick=()=>{
        if(!live()||!body.isConnected)return;const p=people.find(person=>person.login===button.dataset.requestMenu);if(!p)return;close();friendChangeSheet(p,true,refresh);
      });
      action(body,close,'[data-request-accept]',b=>api(`/api/friends/${encodeURIComponent(b.dataset.requestAccept)}/accept`,json('POST',{})));
      action(body,close,'[data-request-decline]',b=>api(`/api/friends/${encodeURIComponent(b.dataset.requestDecline)}/decline`,json('POST',{})));
      action(body,close,'[data-request-cancel]',b=>api('/api/friends/'+encodeURIComponent(b.dataset.requestCancel),{method:'DELETE'}));
    });
  }
  const cached=screenHit('/api/friends')?.data||kept('/api/friends');if(cached)draw(cached);await loadFriends();
 }
 async function mountFind(el){
  el.classList.add('friends-page');el.innerHTML=shell('Me');wireBack(el,'/me');
  const pageOwner=readOwner(),live=()=>pageOwner===readOwner()&&el.isConnected;
  let currentFriends=null,friendLoadVersion=0,searchVersion=0,timer,last=null,people=[],known=[];
  const requests=$('#fr-requests',el),found=$('#fr-found',el),form=$('#fr-find',el),input=form.elements.q,clear=$('#fr-clear',el),statusText=$('#fr-status',el),suggest=$('#fr-suggest',el),error=$('#fr-list-error',el),groupCount=$('#fr-groups-count',el);
  const initial=new URLSearchParams(location.search);input.value=initial.get('q')||'';
  const who=login=>(people.find(p=>p.login===login)||{}).name||login;
  $('#fr-invite',el).onclick=inviteFriends;
  async function loadGroupCount(){
    try{const groups=await api('/api/groups');if(!live())return;const count=groups.filter(group=>!group.closed).length;groupCount.textContent=`${count} active ${count===1?'group':'groups'}`;}
    catch{if(live())groupCount.textContent='Your private groups';}
  }
  loadGroupCount();
  function drawRequestRow(r){
    const count=r.incoming.length+r.outgoing.length;
    requests.innerHTML=count?`<button type="button" class="row-link friend-request-summary" id="fr-requests-open"><span>Requests (${count})</span>${svg('chev')}</button>`:'';
    const button=$('#fr-requests-open',requests);if(button)button.onclick=openRequests;
  }
  function requestAction(body,close,selector,run){
    $$(selector,body).forEach(button=>button.onclick=async()=>{
      if(!live()||!body.isConnected||button.disabled)return;button.disabled=true;
      try{await run(button);if(!live())return;close();await refresh();}
      catch(x){if(live()&&body.isConnected){toast(x.message);button.disabled=false;}}
    });
  }
  function openRequests(){
    if(!currentFriends||!live())return;
    sheet('Requests',requestSections(currentFriends),(body,close)=>{
      const requestLive=()=>live()&&body.isConnected;
      $$('[data-request-menu]',body).forEach(button=>button.onclick=()=>{
        if(!requestLive())return;const p=people.find(person=>person.login===button.dataset.requestMenu);if(!p)return;
        close();friendChangeSheet(p,true,refresh);
      });
      requestAction(body,close,'[data-request-accept]',b=>api(`/api/friends/${encodeURIComponent(b.dataset.requestAccept)}/accept`,json('POST',{})));
      requestAction(body,close,'[data-request-decline]',b=>api(`/api/friends/${encodeURIComponent(b.dataset.requestDecline)}/decline`,json('POST',{})));
      requestAction(body,close,'[data-request-cancel]',b=>api('/api/friends/'+encodeURIComponent(b.dataset.requestCancel),{method:'DELETE'}));
    });
  }
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
  const person=(p,action)=>`<div class="person">${personLink(p)}<span class="btnrow tight">${action}</span></div>`;
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
    const q=input.value.trim(),query=q.replace(/^@/,'').trim();clear.hidden=!q;suggest.hidden=!!q;
    if(!q){last=null;found.innerHTML='';statusText.textContent='';found.setAttribute('aria-busy','false');return;}
    if(query.length<2){last=null;found.innerHTML='';statusText.textContent='Type at least 2 characters to search.';found.setAttribute('aria-busy','false');return;}
    if(q===last&&!again)return;last=q;const request=++searchVersion;found.setAttribute('aria-busy','true');statusText.textContent='Searching…';
    try{const rows=await api('/api/people/search?q='+encodeURIComponent(q));if(request!==searchVersion||!live()||!found.isConnected)return;
      people=[...new Map(people.concat(rows).map(p=>[p.login,p])).values()];drawResults(rows);statusText.textContent=`${rows.length} ${rows.length===1?'person':'people'} found`;
    }catch(x){if(request===searchVersion&&live()&&found.isConnected){last=null;statusText.textContent='';found.innerHTML=`<p class="err" role="alert">${esc(x.message)}</p><button class="ghost" data-retry>Retry search</button>`;$('[data-retry]',found).onclick=()=>find(true);}}
    finally{if(request===searchVersion)found.setAttribute('aria-busy','false');}
  }
  const search=()=>{
    clearTimeout(timer);last=null;searchVersion++;
    const q=input.value.trim(),url=new URL(location.href);if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');url.searchParams.set('find','1');history.replaceState(history.state,'',url.pathname+url.search);
    suggest.hidden=!!q;
    if(!q){clear.hidden=true;found.innerHTML='';statusText.textContent='';found.setAttribute('aria-busy','false');return;}
    clear.hidden=false;const query=q.replace(/^@/,'').trim(),lower=query.toLocaleLowerCase();
    if(query.length<2){found.innerHTML='';found.setAttribute('aria-busy','false');statusText.textContent='Type at least 2 characters to search.';return;}
    drawResults(known.filter(p=>p.name.toLocaleLowerCase().includes(lower)||p.login.toLocaleLowerCase().includes(lower)).slice(0,20),true);
    found.setAttribute('aria-busy','true');statusText.textContent='Searching…';timer=setTimeout(()=>find(),180);
  };
  input.oninput=search;clear.onclick=()=>{input.value='';search();input.focus();};viewResources.set(form,()=>{clearTimeout(timer);searchVersion++;});
  form.onsubmit=e=>{e.preventDefault();clearTimeout(timer);find(true);};
  const draw=r=>{
    currentFriends=r;App.me.friend_count=r.friends.length;Social.set(r.incoming.length);
    known=r.incoming.map(p=>({...p,status:'incoming'})).concat(r.friends.map(p=>({...p,status:'friends'})),r.outgoing.map(p=>({...p,status:'sent'})));
    people=[...new Map(people.concat(known).map(p=>[p.login,p])).values()];drawRequestRow(r);
  };
  async function drawSuggest(){
    const rows=(await suggestedPeople()).slice(0,5);if(!live()||!suggest.isConnected)return;
    suggest.parentElement.hidden=!rows.length;if(rows.length)peopleRow(suggest,rows,{title:'Suggested',invite:false,dismiss:false,compactAdd:true,onChange:loadFriends});else suggest.innerHTML='';
  }
  const cached=screenHit('/api/friends')?.data||kept('/api/friends');if(cached)draw(cached);
  const searching=find();if(initial.has('find')||initial.has('q'))input.focus();
  await loadFriends();drawSuggest();await searching;
 }
 async function mount(el){const q=new URLSearchParams(location.search);return q.has('find')||q.has('q')?mountFind(el):mountList(el);}
 return Object.freeze({shell,requests:requestSections,mount});
})();
