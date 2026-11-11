// Kinetta phone app — Part 5: friends and sharing (2026-10-11). Friends (found by name or username, approved by the
// other person), who sees each activity, which details they see, the Feed, read-only pages for friends' activities,
// cheers and comments. The server decides what anyone else gets (app/api_social.py); these pages only show it.
'use strict';

// The quick appreciation button. Its name lives only here, so it can be renamed in one place.
const CHEER = {verb: 'Cheers', done: 'Cheers sent', many: 'cheers', title: 'Cheers'};   // 'Cheers' everywhere (2026-10-12)
// The authenticated server catalog is shared by every footer and picker.
// Kept accounts can render offline before /api/me refreshes. A parity test keeps this bundle current.
const REACTION_FALLBACK=[
  ['clap','clapping hands','👏'],['muscle','flexed biceps','💪'],['fire','fire','🔥'],['heart','heart','❤️'],
  ['party','celebration','🎉'],['hands','raised hands','🙌'],['wow','surprise','😮'],['bolt','fast','⚡'],
  ['gold','gold medal','🥇'],['hundred','hundred points','💯'],['run','running','🏃'],['ride','cycling','🚴'],
  ['swim','swimming','🏊'],['starstruck','star-struck','🤩'],['mindblown','mind blown','🤯'],['mountain','mountain','⛰️'],
];
const REACTIONS=()=>App.me?.reaction_choices||REACTION_FALLBACK;
let closeReactionPicker = null;
const reactionKind=k=>({cheer:'clap',strong:'muscle',applause:'fire',laugh:'clap',hike:'mountain',lift:'muscle','🥾':'mountain'})[k]||k;
const reactionMark=kind=>'<span class="reaction-emoji" data-type="glyph" aria-hidden="true">'+esc(REACTIONS().find(([k])=>k===reactionKind(kind))?.[2]||'👏')+'</span>';
const reactionAddIcon=()=>'<svg class="reaction-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="13" r="7.5"/><path d="M6.5 14.5c.7 1 1.6 1.5 2.5 1.5s1.8-.5 2.5-1.5"/><path d="M6.5 10h.01 M11.5 10h.01"/><path d="M18.5 3.5v6 M15.5 6.5h6"/></svg>';
const reactionCompact=new Intl.NumberFormat('en',{notation:'compact',maximumSignificantDigits:2});
const reactionNumber=n=>n>=1000?reactionCompact.format(n):String(n);
const reactionCounts=s=>{const counts={};for(const[k,n]of Object.entries(s.reactions||{clap:Array.isArray(s.cheers)?s.cheers.length:s.cheers||0})){const kind=reactionKind(k);counts[kind]=(counts[kind]||0)+(+n||0);}return counts;};
function reactionOrder(s){
  const source=Array.isArray(s?.reaction_order)?s.reaction_order:Array.isArray(s?.cheers)?s.cheers.map(person=>person.kind||'clap'):[];
  return [...new Set(source.map(reactionKind).filter(kind=>REACTIONS().some(([key])=>key===kind)))];
}
function orderedReactionKinds(state){
  const first=new Map(reactionOrder(state).map((kind,index)=>[kind,index]));
  return REACTIONS().filter(([kind])=>state.reactions[kind]>0).sort((a,b)=>(state.reactions[b[0]]-state.reactions[a[0]])||((first.get(a[0])??Infinity)-(first.get(b[0])??Infinity)));
}
function reactionSummary(state){
  const used=orderedReactionKinds(state),shown=used.slice(0,3),extra=used.length-shown.length;
  const html=shown.map(([kind,label])=>'<span class="reaction-summary-emoji" data-summary-kind="'+esc(kind)+'">'+reactionMark(kind)+'<span class="reaction-summary-count">'+reactionNumber(state.reactions[kind])+'</span></span>').join('')+(extra?'<span class="reaction-summary-more">+'+extra+'</span>':'');
  const visible=shown.map(([kind,,emoji])=>emoji+reactionNumber(state.reactions[kind])).join('')+(extra?'+'+extra:'');
  const names=used.map(([kind,name])=>name+' '+reactionNumber(state.reactions[kind])).join(', ');
  const label=used.length?'See who reacted: '+visible+' ('+names+')':'See who reacted';
  return{used,html,label};
}
function reactionButtons(aid,s,detail=false,compact=false,moment=null,groupTarget=null){
  const selected=reactionKind(s.my_reaction??(s.cheered?'clap':null)),counts=reactionCounts(s),summary=reactionSummary({...s,reactions:counts});
  const label=REACTIONS().find(([k])=>k===selected)?.[1]||'clapping hands',triggerLabel=selected?'Your reaction: '+label+'. Change reaction':'React',triggerContent=selected?reactionMark(selected):reactionAddIcon()+'<span>React</span>';
  const attrs=REACTIONS().map(([k])=>'data-count-'+k+'="'+(counts[k]||0)+'"').join(' ');
  const choices=REACTIONS().map(([kind,label])=>'<button type="button" role="menuitemradio" aria-label="React with '+esc(label)+'" aria-checked="'+(selected===kind)+'" data-react="'+kind+'" tabindex="-1">'+reactionMark(kind)+'</button>').join('');
  const target=groupTarget?'data-group-reaction-group data-group-id="'+esc(groupTarget.id)+'" '+(groupTarget.updateId?'data-group-update-id="'+esc(groupTarget.updateId)+'"':'data-group-week="1"'):moment?'data-moment-reaction-group data-moment-owner="'+esc(moment.owner)+'" data-moment-week="'+esc(moment.week)+'"':'data-reaction-group data-aid="'+aid+'"';
  return '<div class="activity-reactions emoji-reactions'+(compact?' compact-reactions':'')+'" role="group" aria-label="Reactions" '+target+' data-mine="'+(selected||'')+'" data-reaction-order="'+reactionOrder(s).join(',')+'" '+attrs+'>'+
    '<div class="reaction-action"><button type="button" class="pf reaction-more" aria-label="'+esc(triggerLabel)+'" aria-haspopup="menu" aria-expanded="false">'+triggerContent+'</button></div>'+
    '<button type="button" class="pf reaction-count" aria-label="'+esc(summary.label)+'" aria-haspopup="dialog"'+(summary.used.length?'':' hidden')+'><span class="reaction-summary" aria-hidden="true">'+summary.html+'</span></button>'+
    '<div class="reaction-picker" role="menu" aria-label="Choose a reaction" hidden><div class="reaction-options">'+choices+'</div></div></div>';
}

function wireReactionGroup(group,aid,changed){
  if(!group||group.dataset.bound)return;group.dataset.bound='1';
  const momentOwner=group.dataset.momentOwner,momentWeek=group.dataset.momentWeek,isMoment=!!(momentOwner&&momentWeek),groupId=group.dataset.groupId,groupUpdateId=group.dataset.groupUpdateId,isGroup=!!groupId;
  const showPeople=()=>{close();const removeMine=()=>choose(null);if(isMoment)achievementMomentCheers(momentOwner,momentWeek,removeMine);else if(isGroup)groupReactionCheers(groupId,groupUpdateId||null,removeMine);else activityCheers(aid,removeMine);};
  const owner=readOwner(),active=()=>group.isConnected&&readOwner()===owner;
  const more=$('.reaction-more',group),main=more,summary=$('.reaction-summary',group),count=$('.reaction-count',group),picker=$('.reaction-picker',group),options=$$('[data-react]',picker);
  let busy=false,state={my_reaction:group.dataset.mine||null,reactions:Object.fromEntries(REACTIONS().map(([k])=>[k,+group.getAttribute('data-count-'+k)||0])),reaction_order:(group.dataset.reactionOrder||'').split(',').filter(Boolean)};
  let hoverTimer=null,leaveTimer=null,heldOpen=false,highlighted=null,anchorRect=null;
  const highlight=(button,buzz=true)=>{if(!active()||!button||button===highlighted)return;highlighted?.classList.remove('is-highlighted');highlighted=button;button.classList.add('is-highlighted');if(buzz&&typeof Haptics!=='undefined')Haptics.tick();};
  const focusOption=(button,buzz=true)=>{highlight(button,buzz);button.focus({preventScroll:true});};
  const close=(focus=false)=>{
    listen(false);
    clearTimeout(hoverTimer);clearTimeout(leaveTimer);if(picker.hidden){if(focus===true&&active())main.focus({preventScroll:true});return;}picker.hidden=true;more.setAttribute('aria-expanded','false');heldOpen=false;
    group.appendChild(picker);if(closeReactionPicker===close)closeReactionPicker=null;
    if(focus&&active())main.focus({preventScroll:true});
  };
  const open=(focus=false)=>{
    if(busy||!active())return;
    if(!picker.hidden){if(focus)focusOption(highlighted||options[0],false);return;}
    if(closeReactionPicker&&closeReactionPicker!==close)closeReactionPicker();closeReactionPicker=close;
    clearTimeout(hoverTimer);clearTimeout(leaveTimer);document.body.appendChild(picker);picker.hidden=false;more.setAttribute('aria-expanded','true');
    listen(true);
    const footer=group.closest('.post-ft,.detail-social')||group.parentElement;
    const link=group.closest('.post')?.querySelector('.post-link'),content=link||footer.parentElement?.querySelector('.detail-primary')||footer;
    const box=content.getBoundingClientRect(),style=link&&getComputedStyle(link),leftInset=style?parseFloat(style.paddingLeft)||0:0,rightInset=style?parseFloat(style.paddingRight)||0:0;
    const bounds={left:box.left+leftInset,right:box.right-rightInset,width:box.width-leftInset-rightInset},r=main.getBoundingClientRect(),vv=window.visualViewport;
    const width=Math.min(bounds.width,innerWidth-16),font=parseFloat(getComputedStyle(document.documentElement).fontSize);
    picker.style.width=width+'px';picker.style.setProperty('--reaction-columns',width>=426&&font<=16?'8':'4');
    const p=picker.getBoundingClientRect();anchorRect=r;
    const top=vv?.offsetTop||0,bottom=top+(vv?.height||innerHeight);
    picker.style.left=Math.max(8,Math.min(bounds.left,innerWidth-p.width-8))+'px';
    picker.style.top=Math.max(top+8,Math.min(r.top-p.height,bottom-p.height-8))+'px';
    highlighted?.classList.remove('is-highlighted');highlighted=null;if(typeof Haptics!=='undefined')Haptics.tick();
    if(focus)focusOption(options.find(b=>b.dataset.react===state.my_reaction)||options[0],false);
  };
  const draw=()=>{
    if(!active())return;
    const selected=state.my_reaction,label=REACTIONS().find(([k])=>k===selected)?.[1]||'clapping hands';
    group.dataset.mine=selected||'';group.dataset.reactionOrder=reactionOrder(state).join(',');more.dataset.kind=selected||'';
    const triggerLabel=selected?`Your reaction: ${label}. Change reaction`:'React';
    more.setAttribute('aria-label',triggerLabel);
    const triggerContent=selected?reactionMark(selected):`${reactionAddIcon()}<span>React</span>`;
    if(more._content!==triggerContent){more.innerHTML=triggerContent;more._content=triggerContent;}
    more.disabled=busy;group.setAttribute('aria-busy',String(busy));
    const compact=reactionSummary(state);
    if(summary._marks!==compact.html){summary.innerHTML=compact.html;summary._marks=compact.html;}
    count.hidden=!compact.used.length;count.disabled=busy;count.setAttribute('aria-label',compact.label);
    for(const b of options){b.setAttribute('aria-checked',String(selected===b.dataset.react));b.disabled=busy;}
  };
  group._sync=fresh=>{if(!busy&&active()){state={my_reaction:reactionKind(fresh.my_reaction),reactions:reactionCounts(fresh),reaction_order:reactionOrder(fresh)};draw();}};
  const stopWatching=(isMoment||isGroup)?null:SocialData.watch(aid,fresh=>{if(!active())return false;if(fresh)group._sync(fresh);});
  const choose=async(next)=>{
    const focused=document.activeElement,restoreFocus=group.contains(focused)||picker.contains(focused),host=group.parentElement;
    close();if(busy||!active()||state.my_reaction===next)return;
    busy=true;const was=state,counts={...state.reactions};
    const order=reactionOrder(state);if(state.my_reaction){counts[state.my_reaction]=Math.max(0,(counts[state.my_reaction]||0)-1);if(!counts[state.my_reaction])order.splice(order.indexOf(state.my_reaction),1);}if(next){if(!counts[next])order.push(next);counts[next]=(counts[next]||0)+1;}
    state={my_reaction:next,reactions:counts,reaction_order:order};draw();if(next&&typeof Haptics!=='undefined')Haptics.react();
    try{
      const path=isMoment?`/api/achievement-moments/${encodeURIComponent(momentOwner)}/${momentWeek}/reaction`:isGroup?(groupUpdateId?`/api/groups/${encodeURIComponent(groupId)}/updates/${encodeURIComponent(groupUpdateId)}/reaction`:`/api/groups/${encodeURIComponent(groupId)}/weekly-reaction`):`/api/activities/${aid}/reaction`;
      let fresh=await api(path,next?json('POST',{kind:next}):{method:'DELETE'});if(readOwner()!==owner)return;
      if(!isMoment&&!isGroup&&!fresh.reactions)fresh=await api(`/api/activities/${aid}/social`);if(readOwner()!==owner)return;
      if(!isMoment&&!isGroup){SocialData.remember(aid,fresh);socialChanged(aid);}if(active()){state={my_reaction:reactionKind(fresh.my_reaction),reactions:reactionCounts(fresh),reaction_order:reactionOrder(fresh)};changed?.(fresh);}return fresh;
    }catch(x){if(!isMoment&&!isGroup&&readOwner()===owner&&[401,403,404].includes(x.status))SocialData.forget(aid);if(active()){state=was;toast(x.message);}return null;}finally{busy=false;draw();if(restoreFocus&&readOwner()===owner&&(document.activeElement===document.body||document.activeElement===focused)){const button=active()?main:host?.querySelector('.reaction-more');if(button?.isConnected)button.focus({preventScroll:true});}}
  };
  cheerGesture(main,()=>{picker.hidden?open(true):close(true);},()=>{open();heldOpen=true;});
  // iOS keeps a held touch captured on its original button. Resolve the release
  // under the finger, so sliding onto a revealed choice selects it just once.
  const release=main.onpointerup,cancel=main.onpointercancel,move=main.onpointermove;
  main.onpointermove=e=>{move(e);if(heldOpen){const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-react]');if(b&&picker.contains(b))highlight(b);}};
  main.onpointerup=e=>{const held=heldOpen;release(e);if(held){const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-react]');if(b&&picker.contains(b))choose(b.dataset.react===state.my_reaction?null:b.dataset.react);}};
  main.onpointercancel=e=>{cancel(e);close();};
  main.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();open(true);}});
  if(!isMoment&&!isGroup)SocialData.warm(count,aid);
  count.onclick=e=>{e.preventDefault();e.stopPropagation();showPeople();};
  for(const b of options){b.onclick=e=>{e.preventDefault();e.stopPropagation();choose(b.dataset.react===state.my_reaction?null:b.dataset.react);if(active())main.focus({preventScroll:true});};b.addEventListener('pointerenter',()=>{if(!picker.hidden)highlight(b);});}
  picker.addEventListener('keydown',e=>{
    const i=options.indexOf(document.activeElement),columns=+(picker.style.getPropertyValue('--reaction-columns')||4);let next=null;
    if(e.key==='ArrowRight')next=(i+1)%options.length;
    if(e.key==='ArrowLeft')next=(i+options.length-1)%options.length;
    if(e.key==='ArrowDown')next=(i+columns)%options.length;
    if(e.key==='ArrowUp')next=(i+options.length-columns)%options.length;
    if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;
    if(next!==null){e.preventDefault();focusOption(options[next]);}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    if(e.key==='Tab')close(true);
  });
  const outside=e=>{if(!picker.hidden&&!group.contains(e.target)&&!picker.contains(e.target))close();};
  const escape=e=>{if(e.key==='Escape'&&!picker.hidden){e.preventDefault();close(true);}};
  // A queued page scroll can arrive after opening at the already-scrolled position.
  const scroll=e=>{if(picker.contains(e.target))return;if(!active()||!anchorRect){close();return;}const now=main.getBoundingClientRect();if(['left','top','width','height'].some(k=>Math.abs(now[k]-anchorRect[k])>.5))close();};
  const resize=()=>close();
  function listen(on){const method=on?'addEventListener':'removeEventListener';document[method]('pointerdown',outside,true);document[method]('keydown',escape);window[method]('scroll',scroll,true);window[method]('resize',resize);}
  const enter=e=>{if(e.pointerType==='mouse'&&matchMedia('(hover: hover)').matches){clearTimeout(leaveTimer);hoverTimer=setTimeout(()=>open(),250);}};
  const leave=e=>{if(e.pointerType==='mouse'){clearTimeout(hoverTimer);leaveTimer=setTimeout(()=>close(),200);}};
  const action=$('.reaction-action',group);action.addEventListener('pointerenter',enter);action.addEventListener('pointerleave',leave);
  picker.addEventListener('pointerenter',()=>clearTimeout(leaveTimer));picker.addEventListener('pointerleave',leave);
  viewResources.set(group,()=>{stopWatching?.();close();picker.remove();});
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
  'user-plus': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5 1.8 0 3.4.8 4.6 2.2M19 8v6M16 11h6"/>',
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
      show();
    }, 500);
  };
  button.onpointermove = (e) => { if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) clear(); };
  button.onpointerup = () => { if (held) suppressUntil = Date.now() + 1000; held = false; clear(); };
  button.onpointercancel = () => { held = false; clear(); }; button.onpointerleave = clear;
  button.onclick = (e) => {
    e.preventDefault(); e.stopPropagation(); clear();
    if (e.detail !== 0 && Date.now() < suppressUntil) { suppressUntil = 0; return; }
    toggle();
  };
  button.oncontextmenu = (e) => {
    e.preventDefault(); e.stopPropagation(); clear();
    if (Date.now() >= suppressUntil) { suppressUntil = Date.now() + 1000; show(); }
  };
  viewResources.set(button, clear);
}

function reactionPeopleSheet({initial=null,load,watch=null,removeMine=null}){
  cleanViews();const owner=readOwner();
  sheet('Reactions','<div class="reaction-filters" role="tablist" aria-label="Filter reactions"></div><div class="cheers-list social-people" role="list" aria-busy="true"></div><p class="social-read-status small muted" role="status"></p>',box=>{
    const list=$('.cheers-list',box),filters=$('.reaction-filters',box),status=$('.social-read-status',box),dialog=box.closest('.sheet'),current=()=>list.isConnected&&owner===readOwner();
    dialog.classList.add('reaction-sheet');let state=initial,filter=null,shown=null,filterMarkup=null;
    const draw=fresh=>{
      if(!current())return;
      state=fresh||{cheers:[]};const people=Array.isArray(state.cheers)?state.cheers:[],counts=people.reduce((all,p)=>{const kind=reactionKind(p.kind||'clap');all[kind]=(all[kind]||0)+1;return all;},{});
      if(filter&&!counts[filter])filter=null;
      const first=new Map(reactionOrder(state).map((kind,index)=>[kind,index]));
      const kinds=REACTIONS().filter(([kind])=>counts[kind]).sort((a,b)=>(counts[b[0]]-counts[a[0]])||((first.get(a[0])??Infinity)-(first.get(b[0])??Infinity)));
      const controls=[`<button type="button" role="tab" class="linkbtn" data-reaction-filter="" aria-selected="${!filter}" aria-label="Show all ${people.length} reactions">All <span>${people.length}</span></button>`,...kinds.map(([kind,label])=>`<button type="button" role="tab" class="linkbtn" data-reaction-filter="${kind}" aria-selected="${filter===kind}" aria-label="Show ${counts[kind]} ${esc(label)} reaction${counts[kind]===1?'':'s'}">${reactionMark(kind)} <span>${counts[kind]}</span></button>`)].join('');
      if(filters._markup!==controls){const focused=filters.contains(document.activeElement)?document.activeElement.dataset.reactionFilter:null;filters.innerHTML=controls;filters._markup=controls;if(focused!==null)($(`[data-reaction-filter="${focused}"]`,filters)||$('button',filters))?.focus({preventScroll:true});}
      for(const button of $$('[data-reaction-filter]',filters))button.onclick=()=>{if(!current())return;filter=button.dataset.reactionFilter||null;draw(state);$(`[data-reaction-filter="${filter||''}"]`,filters)?.focus({preventScroll:true});};
      const filtered=filter?people.filter(person=>reactionKind(person.kind||'clap')===filter):people;
      const html=cheersPeople(filtered,removeMine);if(shown!==html){list.innerHTML=html;shown=html;}
      list.setAttribute('aria-busy','false');
      for(const button of $$('[data-remove-reaction]',list))button.onclick=async event=>{
        event.preventDefault();event.stopPropagation();if(!current()||button.disabled)return;button.disabled=true;
        const result=await removeMine?.();if(!current())return;
        if(Array.isArray(result?.cheers)){draw(result);status.textContent='';}else await refresh();
        if(!current())return;
        ($(`[data-reaction-filter="${filter||''}"]`,filters)||$('button',filters))?.focus({preventScroll:true});
        if(button.isConnected)button.disabled=false;
      };
    };
    if(initial)draw(initial);
    if(watch)viewResources.set(list,watch(fresh=>{if(!current())return false;if(fresh)draw(fresh);}));
    const refresh=async()=>{try{const fresh=await load();if(!current()||!fresh)return;draw(fresh);status.textContent='';}
      catch(error){if(!current())return;if([401,403,404].includes(error.status))draw(null);list.setAttribute('aria-busy','false');status.innerHTML=`${esc(loadErrorCopy(error))} <button type="button" class="linkbtn" data-retry>Retry</button>`;$('[data-retry]',status).onclick=refresh;}};
    refresh();
  });
}

function activityCheers(aid,removeMine=null){
  const cached=SocialData.peek(aid);
  reactionPeopleSheet({initial:cached,load:()=>SocialData.read(aid),watch:changed=>SocialData.watch(aid,changed),removeMine});
}

function achievementMomentCheers(owner,week,removeMine=null){
  const path=`/api/achievement-moments/${encodeURIComponent(owner)}/${week}/reactions`;
  reactionPeopleSheet({load:()=>api(path),removeMine});
}

// the number on the Me tab: friend requests waiting; unread notifications belong to the Home bell
const Social = {
  at: 0,
  count: () => Number.isInteger(App.me?.friend_requests) ? App.me.friend_requests : 0,
  badge() {
    const a = $('nav.tabs a[data-tab="me"]'); if (!a) return;
    const n = Social.count(); let b = $('.tab-n', a);
    const un = (App.me && App.me.notifications) || 0;
    $$('.bell').forEach(link => link.setAttribute('aria-label', `Notifications${un ? `, ${un} new` : ''}`));
    if (typeof Native !== 'undefined' && Native.setBadge) Native.setBadge(un);
    $$('[data-friend-waiting]').forEach(node=>{const waiting=Number.isInteger(App.me?.friend_requests)?App.me.friend_requests:0;node.hidden=!waiting;node.textContent=`${waiting} waiting`;});
    if(Number.isInteger(App.me?.friend_count))$$('[data-friend-count]').forEach(node=>node.textContent=friendCountText(App.me.friend_count));
    $$('.bell-dot').forEach((d) => { d.hidden = !un; d.classList.toggle('many',un>9); d.textContent = un > 9 ? '9+' : un || ''; });
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tab-n'; a.append(b); }
    b.innerHTML = `${n > 9 ? '9+' : n}<span class="vh"> new friend request${n === 1 ? '' : 's'}</span>`;
  },
  refresh() {
    Social.badge();
    if (!App.me || !navigator.onLine) return;
    const account = readOwner();
    if (Social.owner !== account) { Social.owner = account; Social.at = 0; }
    if (Date.now() - Social.at < 60000) return;
    Social.at = Date.now();
    api('/api/notifications/count').then((r) => { if (account !== readOwner() || !App.me) return; App.me.notifications = r.unread; App.me.friend_requests = r.friend_requests;if(Number.isInteger(r.friend_count))App.me.friend_count=r.friend_count; Social.badge(); }).catch(() => {});
  },
  set(n) { if (App.me && n != null) { App.me.friend_requests = n; Social.badge(); } },
};

// ---------- Activity tab: the Feed (yours and your friends', newest first) ----------
// Both readers use the same (time, id) cursor, including activities starting at exactly the same time.
const FEED_N = 15;
// Own private workouts stay visible here. Cached rows explicitly private to someone else never paint.
const visibleFeedRows=rows=>rows.filter(a=>!a.owner||(App.me?.login&&a.owner.login===App.me.login)||a.visibility!=='me');
const feedRowKey=a=>`${a.kind==='achievement_moment'?'moment':'activity'}:${a.id}`;
function achievementBadgeMarkup(badge,className=''){
  const code=String(badge?.code||''),rank=Number(badge?.rank),icon=String(badge?.icon||'');
  if(!code||!Number.isSafeInteger(rank)||rank<1||rank>10000||!/^\/static\/[A-Za-z0-9_./-]+(?:\?v=[A-Za-z0-9._-]+)?$/.test(icon)||icon.includes('/../'))return '';
  return `<span class="me-featured-medal achievement-badge-art ${esc(className)}" data-showcase-code="${esc(code)}" role="img" aria-label="Achievement badge, level ${rank}"><img class="me-featured-icon" src="${esc(icon)}" alt="" aria-hidden="true" loading="eager" decoding="async"></span>`;
}
function feedCard(a,options={}){
  if(a.kind==='achievement_moment'){
    const p=a.owner,name=esc(p.name||p.login),track=a.is_track?svg('globe','achievement-moment-track'):'',extra=a.extra_count?` and ${a.extra_count} more`:'',badge=achievementBadgeMarkup(a.badge,'achievement-moment-badge');
    return `<article class="card achievement-moment" data-feed-key="${esc(feedRowKey(a))}"><div class="post-hd achievement-moment-body">
      <a class="post-av" href="${profileHref(p)}" aria-label="${name}’s profile">${avatar(p)}</a><div class="ph-txt achievement-moment-copy">
        <p><a class="achievement-moment-name" href="${profileHref(p)}">${name}</a> reached ${esc(a.title)}${track}${extra}</p></div>${badge}</div>
      <div class="post-ft"><time class="achievement-moment-time" datetime="${esc(a.start_time)}">${esc(when(a.start_time))}</time>${reactionButtons(null,a,false,true,{owner:p.login,week:a.week_start})}</div></article>`;
  }
  return postCard(a,options).replace('<article class="card post','<article data-feed-key="'+esc(feedRowKey(a))+'" class="card post');
}
async function feedPage(before,size=FEED_N) {
  const b=before?'&before='+encodeURIComponent(typeof before==='string'?before:before.start_time)+(before.id?'&before_id='+before.id:''):'';
  const [mine,theirs]=await Promise.all([readOnce(`/api/activities?limit=${size}${b}`),readOnce(`/api/feed/friends?limit=${size}${b}`)]);
  const all=visibleFeedRows(mine.concat(theirs)).sort((x,y)=>new Date(y.start_time)-new Date(x.start_time)||y.id-x.id),rows=all.slice(0,size);
  return {rows,more:all.length>size||mine.length===size||theirs.length===size,friends:rows.filter(a=>a.owner).length};
}

function activityGroupStripHtml(data){
  const group=data.next,combined=group.total!==undefined,value=Number(combined?group.total:group.your_total)||0,target=Number(group.goal_target)||0;
  const progress=Math.min(target||1,Math.max(0,value)),ongoing=group.event_state==='ongoing'||group.event_date==null, weeks=group.weeks_to_event||0;
  const timing=ongoing?'All time':group.days_to_event===0?'Event today':`${weeks} ${weeks===1?'week':'wk'} to go`;
  const more=data.more_count?`<a class="feed-groups-more" href="/me/groups" aria-label="See ${data.more_count} more ${data.more_count===1?'group':'groups'}">+${data.more_count}</a>`:'';
  return `<section class="feed-social-strip feed-groups-strip" aria-label="${ongoing?'Group goal':'Next group event'}"><div class="feed-groups-row">
    <a class="row-link feed-groups-link" href="/groups/${encodeURIComponent(group.id)}"><span class="ri">${svg('calendar')}</span><span class="grow feed-groups-copy"><b>${esc(group.title)} · ${esc(timing)}</b><small>${combined?'Together':'You'}: ${esc(groupAmount(value,group.goal_unit))} of ${esc(groupAmount(target,group.goal_unit))}</small><progress class="feed-group-progress" max="${target||1}" value="${progress}" aria-label="${combined?'Group progress':'Your progress'}" aria-valuetext="${esc(groupAmount(value,group.goal_unit))} of ${esc(groupAmount(target,group.goal_unit))}"></progress></span><span class="chev">${svg('chev')}</span></a>
    ${more}</div></section>`;
}
function activityGroupStripLongPress(box,mute){
  if(typeof box?.addEventListener!=='function')return;
  let timer=null,origin=null,pointerId=null,pointerType=null,suppressUntil=0,held=false;
  const inGroupLink=event=>event.target instanceof Element&&!!event.target.closest('.feed-groups-link');
  const cancel=()=>{clearTimeout(timer);timer=null;origin=null;pointerId=null;pointerType=null;};
  const fire=()=>{if(held)return;held=true;suppressUntil=Date.now()+1000;clearTimeout(timer);timer=null;mute();};
  const down=event=>{
    if(!inGroupLink(event)||event.target.closest('.feed-groups-more,[data-group-strip-show]')||event.isPrimary===false||event.button!==0)return;
    cancel();held=false;suppressUntil=0;origin={x:event.clientX,y:event.clientY};pointerId=event.pointerId;pointerType=event.pointerType;
    timer=setTimeout(()=>{if(box.isConnected&&origin)fire();},500);
  };
  const move=event=>{if(!held&&origin&&event.pointerId===pointerId&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)cancel();};
  const end=event=>{if(pointerId!==null&&event.pointerId!==pointerId)return;clearTimeout(timer);timer=null;if(held)suppressUntil=Date.now()+1000;origin=null;pointerId=null;pointerType=null;};
  const click=event=>{if(!inGroupLink(event)||event.detail===0||!(held||Date.now()<suppressUntil))return;event.preventDefault();event.stopPropagation();held=false;suppressUntil=0;};
  const context=event=>{if(!inGroupLink(event))return;if(origin&&pointerType!=='mouse'){event.preventDefault();fire();}else if(Date.now()<suppressUntil)event.preventDefault();};
  box.addEventListener('pointerdown',down);box.addEventListener('click',click,true);box.addEventListener('contextmenu',context);
  document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);
  viewResources.set(box,()=>{cancel();box.removeEventListener('pointerdown',down);box.removeEventListener('click',click,true);box.removeEventListener('contextmenu',context);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);});
}
async function activityGroupStrip(box,owner){
  const live=()=>box?.isConnected&&owner===readOwner();
  async function draw(){
    if(!live())return;
    try{
      const data=await api('/api/groups/activity-strip');if(!live())return;
      if(data.muted&&data.has_upcoming)box.innerHTML='<div class="feed-groups-muted"><span class="small muted">Group strip is hidden</span><button type="button" class="linkbtn" data-group-strip-show>Show</button></div>';
      else if(data.next)box.innerHTML=activityGroupStripHtml(data);
      else box.replaceChildren();
      box.dataset.loaded='true';
      $('[data-group-strip-show]',box)?.addEventListener('click',()=>change(false));
    }catch(_){if(live()){box.replaceChildren();box.dataset.loaded='true';}}
  }
  async function change(muted){
    if(!live())return;
    try{await api('/api/groups/activity-strip',json('POST',{muted}));if(live()){await draw();$(muted?'[data-group-strip-show]':'.feed-groups-link',box)?.focus({preventScroll:true});}}
    catch(error){if(live())toast(error.message);}
  }
  activityGroupStripLongPress(box,()=>change(true));
  return draw();
}

// The offer window uses the signed-in account's civil clock; the recap itself reuses Monday–Sunday dates.
function weeklyRecapWindow(now=new Date(),zone=tz()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now),get=k=>parts.find(p=>p.type===k)?.value;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),part=k=>date.find(p=>p.type===k)?.value;
  const today=`${part('year')}-${part('month')}-${part('day')}`,weekday=get('weekday'),hour=Number(get('hour')),offset=weekday==='Mon'?1:0;
  return {visible:weekday==='Mon'||weekday==='Sun'&&hour>=18,start:Recaps.startFor('week',today,offset),offset};
}
function weeklyRecapDismissKey(server,account,start){return `fit.weekly-recap:${server}:${account}:${start}`;}
function weeklyRecapUsual(rows,start){
  const weeks=new Map();for(const row of rows||[]){const day=String(row.p||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>=start)continue;
    const week=weeks.get(day)||{start:day,distance_m:0,time_s:0,activities:0};week.distance_m+=Number(row.d)||0;week.time_s+=Number(row.t)||0;week.activities+=Number(row.n)||0;weeks.set(day,week);}
  const past=[...weeks.values()].filter(w=>w.distance_m>0).sort((a,b)=>a.start.localeCompare(b.start)).slice(-6);
  return past.length>=3?{weeks:past.length,distance_m:past.reduce((n,w)=>n+w.distance_m,0)/past.length,time_s:past.reduce((n,w)=>n+w.time_s,0)/past.length}:null;
}
function weeklyRecapDays(data){
  const names=[['Mon','Monday'],['Tue','Tuesday'],['Wed','Wednesday'],['Thu','Thursday'],['Fri','Friday'],['Sat','Saturday'],['Sun','Sunday']],rows=data.days||[],byDay=new Map(rows.map(row=>[String(row.day).slice(0,10),row])),metric=rows.some(row=>Number(row.distance_m)>0)?'distance':'time',value=row=>metric==='distance'?Number(row.distance_m)||0:Number(row.time_s)||0,max=Math.max(1,...rows.map(value)),start=new Date(data.start+'T12:00:00Z');
  return Array.from({length:7},(_,i)=>{const day=new Date(start);day.setUTCDate(day.getUTCDate()+i);const iso=day.toISOString().slice(0,10),row=byDay.get(iso)||{},active=Number(row.activities)>0,amount=value(row);return{day:iso,label:names[i][0],name:names[i][1],active,activities:Number(row.activities)||0,distance_m:Number(row.distance_m)||0,time_s:Number(row.time_s)||0,metric,value:amount,level:active?Math.max(1,Math.round(amount/max*5)):0};});
}
function weeklyRecapMedals(data,catalog,start,end){
  return (data?.tracks||[]).flatMap(track=>(track.tiers||[]).filter(tier=>String(tier.day||'')>=start&&String(tier.day||'')<end).map(tier=>{
    const level=(catalog?.tracks?.[track.code]?.levels||[])[Math.max(0,Number(tier.rank)-1)];
    return {day:String(tier.day),rank:Number(tier.rank)||0,label:String(tier.name||level?.name||track.label||'Medal'),icon:typeof level?.icon==='string'?level.icon:''};
  })).sort((a,b)=>a.day.localeCompare(b.day)||a.rank-b.rank);
}
function weeklyRecapDateLabel(start,end){
  const first=new Date(start+'T12:00:00Z'),last=new Date(end+'T12:00:00Z');last.setUTCDate(last.getUTCDate()-1);
  const fmt=d=>fdate(d.toISOString(),{timeZone:'UTC',month:'short',day:'numeric'});return `${fmt(first)}–${fmt(last)}`;
}
function weeklyRecapPictureDateLabel(start,end){
  const first=new Date(start+'T12:00:00Z'),last=new Date(end+'T12:00:00Z');last.setUTCDate(last.getUTCDate()-1);
  const fmt=d=>d.toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});return `${fmt(first)}–${fmt(last)}`;
}
function weeklyRecapSportLabel(sport){const key=String(sport||'');return SPORT_NAMES[key]||key.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
function weeklyRecapShortDuration(seconds){
  const minutes=Math.max(0,Math.round((Number(seconds)||0)/60)),hours=Math.floor(minutes/60),remainder=minutes%60;
  return hours?`${hours}h ${remainder}m`:`${minutes}m`;
}
function weeklyRecapRecordDuration(seconds){const elapsed=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;}
function weeklyRecapSingleLine(ctx,value,max=896,size=26){
  const text=String(value);if(!ctx)return text;ctx.font=`600 ${size}px ${ShareArt.family()}`;if(ctx.measureText(text).width<=max)return text;
  const chars=[...text],suffix='...';let low=0,high=chars.length;
  while(low<high){const mid=Math.ceil((low+high)/2),candidate=chars.slice(0,mid).join('').trimEnd()+suffix;if(ctx.measureText(candidate).width<=max)low=mid;else high=mid-1;}
  return chars.slice(0,low).join('').trimEnd()+suffix;
}
function weeklyRecapHighlightLines(data,medals,ctx=null){
  const items=data.highlights||[],longest=items.find(item=>item.kind==='longest'),record=items.find(item=>item.kind==='record'),rows=[];
  if(longest)rows.push(`Longest ${(weeklyRecapSportLabel(longest.sport)||'activity').toLowerCase()} · ${U.dist(Number(longest.distance_m)||0,1)} ${U.du()}`);
  if(record)rows.push(`New ${weeklyRecapSportLabel(record.sport)||'activity'} record · ${weeklyRecapRecordDuration(record.elapsed_s)} · ${record.label||'Record'}`);
  if(medals?.length)rows.push(`New medal · ${medals[0].label}`);
  if(Number(data.streak_weeks)>=2)rows.push(`${data.streak_weeks}-week streak`);
  return rows.slice(0,2).map(row=>weeklyRecapSingleLine(ctx,row));
}
function weeklyRecapComparison(value,usual){
  if(!usual||!Number(usual)||!Number(value))return '';
  const percent=Math.round((Number(value)-Number(usual))/Number(usual)*100);if(Math.abs(percent)<=5)return 'About usual';
  return `${Math.abs(percent)}% ${percent<0?'less':'more'} than usual`;
}
function weeklyRecapFacts(data){
  const days=Number(data.active_days)||0,workouts=Number(data.activities)||0;
  if(!Number(data.distance_m)&&workouts)return `Active ${days} of 7 days`;
  return `Active ${days} of 7 days · ${workouts} workout${workouts===1?'':'s'}`;
}
function weeklyRecapHeroPlacement(g,value,unit,x,width){
  const family=ShareArt.family(),unitGap=unit?16:0;g.font=`600 28px ${family}`;const unitWidth=unit?g.measureText(unit).width:0,maxValue=Math.max(40,width-unitWidth-unitGap);
  let size=86;for(;size>48;size-=2){g.font=`800 ${size}px ${family}`;if(g.measureText(String(value)).width<=maxValue)break;}
  g.font=`800 ${size}px ${family}`;const valueWidth=g.measureText(String(value)).width;
  return{size,valueWidth,maxValue,unitX:x+valueWidth+unitGap,unitWidth,unitMax:Math.max(12,width-valueWidth-unitGap)};
}
function weeklyRecapLayout(data,usual,medals,ctx){
  const top=270,footer=1228,heroHeight=218,sectionGap=24,chartMinHeight=260,highlightHeadingHeight=42,highlightRowHeight=38,highlightFactGap=8,highlightTitleBaseline=25,highlightLineBaseline=25;
  const highlightLines=weeklyRecapHighlightLines(data,medals,ctx),highlightHeight=highlightLines.length?highlightHeadingHeight+highlightLines.length*highlightRowHeight:0;
  const factsBaseline=footer-32,factsTop=factsBaseline-30,highlightsBottom=factsTop-highlightFactGap,highlightsY=highlightsBottom-highlightHeight;
  const chartY=top+heroHeight+sectionGap,chartBottom=highlightHeight?highlightsY-sectionGap:factsTop-sectionGap,chartHeight=Math.max(chartMinHeight,chartBottom-chartY),rows=[];
  rows.push({kind:'hero',y:top,height:heroHeight});rows.push({kind:'chart',y:chartY,height:chartHeight});
  if(highlightHeight)rows.push({kind:'highlights',y:highlightsY,height:highlightHeight,lines:highlightLines});
  rows.push({kind:'facts',y:factsBaseline,height:30});
  return{rows,footer,metric:(data.days||[]).some(day=>Number(day.distance_m)>0)?'distance':'time',highlightHeadingHeight,highlightRowHeight,highlightTitleBaseline,highlightLineBaseline,sectionGap,highlightFactGap,chartMinHeight};
}
function weeklyRecapHtml(data,usual,medals){
  const best=data.owner_best_effort,days=weeklyRecapDays(data),shown=medals.slice(0,3),extra=medals.length-shown.length;
  const daySummary=d=>!d.active?'no workout':d.value>0?d.metric==='distance'?`${U.dist(d.value,1)} ${U.du()}`:dur(d.value,true):`${d.activities} workout${d.activities===1?'':'s'}`;
  return `<section class="card recap-offer weekly-recap" data-weekly-recap data-start="${esc(data.start)}"><div class="weekly-recap-copy">
    <div class="weekly-recap-head"><div><h2>Your week</h2><p class="small muted">${esc(weeklyRecapDateLabel(data.start,data.end))}</p></div><div class="weekly-recap-actions"><button type="button" class="icon-btn" data-weekly-recap-share aria-label="Share weekly recap">${svg('share')}</button><button type="button" class="icon-btn" data-weekly-recap-dismiss aria-label="Dismiss this week’s recap">${svg('close')}</button></div></div>
    <div class="weekly-recap-metrics"><div><b class="num">${esc(U.dist(data.distance_m||0,1))} ${esc(U.du())}</b><small>Distance${usual?` · ${esc(U.dist(usual.distance_m,1))} ${esc(U.du())} usual`:''}</small></div><div><b class="num">${esc(dur(data.time_s||0,true))}</b><small>Time${usual?` · ${esc(dur(usual.time_s,true))} usual`:''}</small></div></div>
    ${best||shown.length?`<div class="weekly-recap-highlights">${best?`<p class="weekly-recap-best"><b>Best effort</b> · ${esc(best.label)} · ${esc(dur(best.elapsed_s))}</p>`:''}${shown.length?`<div class="weekly-recap-medals" role="list" aria-label="New medals this week">${shown.map(m=>`<span class="weekly-recap-medal" role="listitem" aria-label="${esc(m.label)}"><img src="${esc(m.icon)}" alt="" aria-hidden="true" loading="eager" decoding="async"><span>${esc(m.label)}</span></span>`).join('')}${extra?`<span class="weekly-recap-medal-more">+${extra} more</span>`:''}</div>`:''}</div>`:''}
    <div class="weekly-recap-days" role="group" aria-label="Activity days, Monday to Sunday">${days.map(d=>`<span class="weekly-recap-day" role="img" aria-label="${esc(`${d.name}: ${daySummary(d)}`)}"><i class="weekly-recap-day-track" aria-hidden="true"><b class="weekly-recap-day-bar${d.active?' is-active':''}" data-level="${d.level}"></b></i><small aria-hidden="true">${d.label}</small></span>`).join('')}</div>
  </div></section>`;
}
let weeklyRecapCatalogPromise=null;
function weeklyRecapCatalog(){
  if(!weeklyRecapCatalogPromise)weeklyRecapCatalogPromise=fetch((Native.base||'')+'/static/profile.achievement-levels.json?v=__ASSET_HASH__',{credentials:Native.on?'omit':'same-origin',headers:Native.headers()}).then(r=>r.ok?r.json():{}).catch(()=>({}));
  return weeklyRecapCatalogPromise;
}
function weeklyRecapPicture(data,usual,medals,days){
  return (async()=>{
    await document.fonts.ready;const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
    const g=canvas.getContext('2d'),p=ShareArt.palette(),gradient=g.createLinearGradient(0,0,1080,1350);gradient.addColorStop(0,col('--share-action'));gradient.addColorStop(1,col('--share-brand'));
    g.fillStyle=gradient;g.fillRect(0,0,1080,1350);g.fillStyle=p.bg;g.beginPath();g.roundRect(54,48,972,1254,32);g.fill();
    const layout=weeklyRecapLayout(data,usual,medals,g),row=kind=>layout.rows.find(item=>item.kind===kind),hero=row('hero'),chart=row('chart'),highlights=row('highlights'),facts=row('facts'),M=92,W=896,tileWidth=416;
    ShareArt.text(g,'Your week',M,145,62,{color:p.text,max:W,weight:750});ShareArt.text(g,weeklyRecapPictureDateLabel(data.start,data.end),M,205,32,{color:p.muted,max:W});
    g.strokeStyle=p.line;g.lineWidth=2;g.beginPath();g.moveTo(M,244);g.lineTo(M+W,244);g.stroke();
    const distance=Number(data.distance_m)||0,time=Number(data.time_s)||0,hasDistance=distance>0;
    const heroItems=hasDistance?[
      {label:'Distance',value:U.dist(distance,1),unit:U.du(),comparison:weeklyRecapComparison(distance,usual?.distance_m)},
      {label:'Time',value:weeklyRecapShortDuration(time),unit:'',comparison:weeklyRecapComparison(time,usual?.time_s)},
    ]:[
      {label:'Workouts',value:String(Number(data.activities)||0),unit:'',comparison:''},
      {label:'Time',value:weeklyRecapShortDuration(time),unit:'',comparison:weeklyRecapComparison(time,usual?.time_s)},
    ];
    heroItems.forEach((item,i)=>{
      const x=M+i*448,placement=weeklyRecapHeroPlacement(g,item.value,item.unit,x,tileWidth);
      ShareArt.text(g,item.value,x,hero.y+92,placement.size,{color:p.text,max:placement.maxValue,weight:800});
      if(item.unit)ShareArt.text(g,item.unit,placement.unitX,hero.y+92,28,{color:p.muted,max:placement.unitMax});
      ShareArt.text(g,item.label,x,hero.y+132,28,{color:p.muted,max:tileWidth});
      if(item.comparison)ShareArt.text(g,item.comparison,x,hero.y+176,26,{color:p.soft,max:tileWidth});
    });
    const dayRows=days?.length?days:weeklyRecapDays(data),metric=layout.metric,max=Math.max(1,...dayRows.map(day=>metric==='distance'?Number(day.distance_m)||0:Number(day.time_s)||0)),plotTop=chart.y+78,plotBottom=chart.y+chart.height-30,step=W/7,barWidth=Math.min(72,step-28),trackHeight=14;
    ShareArt.text(g,metric==='distance'?`Daily distance · ${U.du()}`:'Daily active time',M,chart.y+28,28,{color:p.muted,max:W});
    const values=dayRows.map(day=>metric==='distance'?Number(day.distance_m)||0:Number(day.time_s)||0),tallest=values.indexOf(Math.max(...values));
    dayRows.forEach((day,i)=>{
      const x=M+step*i+(step-barWidth)/2,value=values[i],trackY=plotBottom-trackHeight;
      g.fillStyle=p.line;g.beginPath();g.roundRect(x,trackY,barWidth,trackHeight,7);g.fill();
      if(value>0){const barHeight=Math.max(trackHeight,(plotBottom-plotTop-24)*value/max),barY=plotBottom-barHeight;g.fillStyle=p.blue;g.beginPath();g.roundRect(x,barY,barWidth,barHeight,12);g.fill();
        if(i===tallest){const label=metric==='distance'?`${U.dist(value,1)} ${U.du()}`:weeklyRecapShortDuration(value);ShareArt.text(g,label,x+barWidth/2,barY-10,26,{color:p.soft,max:step-8,align:'center'});}
      }
      ShareArt.text(g,day.label,x+barWidth/2,plotBottom+34,26,{color:p.muted,max:step-4,align:'center'});
    });
    if(highlights){
      ShareArt.text(g,'Highlights',M,highlights.y+layout.highlightTitleBaseline,20,{color:p.muted,max:W});
      highlights.lines.forEach((line,i)=>ShareArt.text(g,line,M,highlights.y+layout.highlightHeadingHeight+layout.highlightLineBaseline+i*layout.highlightRowHeight,26,{color:p.text,max:W}));
    }
    ShareArt.text(g,weeklyRecapFacts(data),M,facts.y,27,{color:p.soft,max:W});
    g.strokeStyle=p.line;g.beginPath();g.moveTo(M,layout.footer);g.lineTo(M+W,layout.footer);g.stroke();drawMark(g,M+20,layout.footer+50,44,p.blue);ShareArt.text(g,'Kinetta',M+62,layout.footer+59,28,{color:p.text});ShareArt.text(g,'kinetta.app',M+W,layout.footer+57,24,{color:p.muted,align:'right'});
    return ShareArt.blob(canvas);
  })();
}
function weeklyRecapPictureAlt(data,usual,medals){
  const metric=(data.days||[]).some(day=>Number(day.distance_m)>0)?'daily distance':'daily active time',workouts=Number(data.activities)||0,summary=Number(data.distance_m)>0?`${U.dist(data.distance_m,1)} ${U.du()} distance`:`${workouts} workout${workouts===1?'':'s'}`,parts=[`Your week, ${weeklyRecapPictureDateLabel(data.start,data.end)}.`,`${summary}.`,`${weeklyRecapShortDuration(Number(data.time_s)||0)} time.`];
  const comparisons=[weeklyRecapComparison(data.distance_m,usual?.distance_m),weeklyRecapComparison(data.time_s,usual?.time_s)].filter(Boolean);if(comparisons.length)parts.push(comparisons.join('; '));parts.push(`${metric} chart.`,weeklyRecapFacts(data));const highlights=weeklyRecapHighlightLines(data,medals);if(highlights.length)parts.push(highlights.join('. '));return parts.filter(Boolean).join(' ');
}
function weeklyRecapPictureItem(data,usual,medals,days,valid=()=>true){
  const alt=weeklyRecapPictureAlt(data,usual,medals);
  return{label:'Weekly recap',filename:`kinetta-week-${data.start}.png`,valid,build:async()=>({blob:await weeklyRecapPicture(data,usual,medals,days),alt})};
}
function openWeeklyRecapShare(box,data,usual,medals,days){ShareSheet.open({items:[weeklyRecapPictureItem(data,usual,medals,days,()=>box.isConnected)]});}
async function weeklyRecapShareItem(){
  const owner=readOwner(),zone=tz(),window=weeklyRecapWindow(new Date(),zone);if(!window.visible)return null;
  const [data,volume,achievements]=await Promise.all([api(`/api/recaps?period=week&offset=${window.offset}`),api('/api/progress/volume?period=week'),api('/api/achievements')]);
  if(owner!==readOwner()||zone!==tz()||data.tz!==zone||data.start!==window.start||Number(data.activities)<=0)return null;
  const usual=weeklyRecapUsual(volume.rows,data.start);let medals=weeklyRecapMedals(achievements,null,data.start,data.end);if(medals.length)medals=weeklyRecapMedals(achievements,await weeklyRecapCatalog(),data.start,data.end);
  if(owner!==readOwner()||zone!==tz())return null;return weeklyRecapPictureItem(data,usual,medals,weeklyRecapDays(data),()=>owner===readOwner());
}
async function weeklyRecapOffer(box){
  if(!box||!box.isConnected||!App.me)return;const owner=readOwner(),zone=tz(),window=weeklyRecapWindow(new Date(),zone);if(!window.visible)return;
  const key=weeklyRecapDismissKey(serverKey(),App.me.id,window.start);if(store.get(key))return;
  try{
    const [data,volume,achievements]=await Promise.all([api(`/api/recaps?period=week&offset=${window.offset}`),api('/api/progress/volume?period=week'),api('/api/achievements')]);
    if(!box.isConnected||owner!==readOwner()||zone!==tz()||data.tz!==zone||data.start!==window.start||Number(data.activities)<=0)return;
    const usual=weeklyRecapUsual(volume.rows,data.start);let medals=weeklyRecapMedals(achievements,null,data.start,data.end);if(medals.length)medals=weeklyRecapMedals(achievements,await weeklyRecapCatalog(),data.start,data.end);
    if(!box.isConnected||owner!==readOwner()||zone!==tz()||store.get(key))return;
    const days=weeklyRecapDays(data);box.innerHTML=weeklyRecapHtml(data,usual,medals);
    const card=$('[data-weekly-recap]',box),dismiss=$('[data-weekly-recap-dismiss]',card),share=$('[data-weekly-recap-share]',card),live=()=>card.isConnected&&owner===readOwner();
    dismiss.onclick=()=>{if(!live())return;store.set(key,'dismissed');box.replaceChildren();};share.onclick=()=>{if(live())openWeeklyRecapShare(box,data,usual,medals,days);};
  }catch(_){/* The recap is optional; feed access must remain useful if one of its reads is offline. */}
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
function homeViewSwitch(view) {
  return `<nav class="home-view-switch" aria-label="Home view"><a href="/activity"${view==='feed'?' aria-current="page"':''}>Feed</a><a href="/activity?view=groups"${view==='groups'?' aria-current="page"':''}>Groups</a><a href="/me/challenges" data-home-challenges>Challenges</a></nav>`;
}
function wireHomeChallengeLink(el){
  const link=el?.querySelector?.('[data-home-challenges]');
  link?.addEventListener('click',event=>{if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.button>0)return;if(typeof Discovery!=='undefined')Discovery.visit('activity','challenges');});
}
async function homeGroups(el) {
  const owner=readOwner(),live=()=>el.isConnected&&owner===readOwner();
  el.innerHTML=`<div id="feed-top">${actTop(true,true)}</div>${homeViewSwitch('groups')}<section class="home-groups"><div class="home-groups-heading"><h2>Groups</h2><button type="button" class="linkbtn" id="home-group-new">Create</button></div><div id="home-group-list"><div class="card empty">Loading your groups…</div></div></section>`;
  wireHomeChallengeLink(el);
  const create=()=>groupCreateSheet(group=>{go('/groups/'+encodeURIComponent(group.id),{replace:true});groupInviteSheet(group.invite_url);});
  $('#home-group-new',el).onclick=create;
  try{
    const groups=await api('/api/groups');if(!live())return;
    const host=$('#home-group-list',el);
    host.innerHTML=groups.length?`<div class="card list">${groups.map(group=>`<a class="row-link group-list-row" href="/groups/${encodeURIComponent(group.id)}"><span class="ri">${svg('calendar')}</span><span class="grow"><b>${esc(group.title)}</b><small>${group.event_date?`${esc(groupDate(group.event_date,group.time_zone))} · `:'All time · '}${group.member_count} ${group.member_count===1?'member':'members'}</small></span>${svg('chev')}</a>`).join('')}</div>`:`<div class="group-empty"><p>Groups are private places to work toward a shared goal.</p><button type="button" class="primary" id="group-empty-create">Create a group</button></div>`;
    $('#group-empty-create',host)?.addEventListener('click',create);
  }catch(error){if(live()){$('#home-group-list',el).innerHTML=`<div class="card empty">${esc(loadErrorCopy(error))}<button type="button" class="ghost" id="group-retry">Retry</button></div>`;$('#group-retry',el)?.addEventListener('click',()=>go('/activity?view=groups',{replace:true}));}}
}
// An empty Home feed always offers a next step (#762): record or import a workout, or find friends to follow.
const feedEmpty=()=>`<div class="feed-empty"><p class="small muted">Your workouts, friends’ shared workouts and achievement moments appear here.</p><div class="btncol"><a class="primary wide" href="/track">Record or import a workout</a><a class="linkbtn" href="/me/friends?find=1">Find friends</a></div></div>`;
async function homeFeed(el) {
  el.classList?.add('activity-home');
  el.innerHTML=`<div id="feed-top">${actTop(true,true)}</div>${homeViewSwitch('feed')}<div id="activity-groups-strip"></div><div id="weekly-recap"></div><div id="feed-tools"></div>
    <div class="feed-list" id="ff-list">${skelFeed(3)}</div><button type="button" class="ghost feed-more" id="ff-more" hidden>Show more</button>`;
  wireHomeChallengeLink(el);
  const list=$('#ff-list',el),more=$('#ff-more',el),recap=$('#weekly-recap',el),groupStrip=$('#activity-groups-strip',el),account=readOwner();
  void activityGroupStrip(groupStrip,account);
  void weeklyRecapOffer(recap);
  let items=[],shown=null,pageRevision=0;
  const active=()=>account===readOwner()&&list.isConnected,tools=feedTools(el,()=>account===readOwner()&&list.isConnected);
  const draw=pg=>{
    if(!active())return;
    const visible=visibleFeedRows(pg.rows);pg={...pg,rows:visible,friends:visible.filter(a=>a.owner).length};
    const signature=JSON.stringify(pg),previous=items;items=pg.rows;
    if(signature===shown)return;
    shown=signature;
    if(items.length&&previous.length&&list.querySelectorAll){
      // Keep unchanged cards and their maps alive. Only new or changed records replace nodes.
      const nodes=new Map([...list.querySelectorAll(':scope > [data-feed-key]')].map(node=>[node.dataset.feedKey,node]));
      const old=new Map(previous.map(a=>[feedRowKey(a),JSON.stringify(a)])),retained=new Set();let cursor=list.firstElementChild;
      for(const a of items){
        const key=feedRowKey(a);
        let node=old.get(key)===JSON.stringify(a)?nodes.get(key):null;
        if(!node){const template=document.createElement('template');template.innerHTML=feedCard(a,{who:true,compact:true});node=template.content.firstElementChild;}
        if(node===cursor)cursor=cursor.nextElementSibling;else list.insertBefore(node,cursor);
        retained.add(node);
      }
      for(const node of [...list.children])if(!retained.has(node))node.remove();
    }else list.innerHTML=items.length?items.map(a=>feedCard(a,{who:true,compact:true})).join(''):feedEmpty();
    const invite=list.querySelector?.('[data-invite-empty]');if(invite)invite.onclick=inviteFriends;
    more.hidden=!pg.more;feedMaps(list);wireCheers(list);$$('[data-moment-reaction-group]',list).forEach(group=>wireReactionGroup(group));if(typeof cleanViews!=='undefined')cleanViews();
  };
  let hit=App.cache.get('feed:home');
  if(!hit){const k=kept('feed:home');if(k){hit={data:k,at:0};App.cache.set('feed:home',hit);}}
  if(hit)draw(hit.data);
  const revalidate=async()=>{
    if(!active())return;
    const version=++pageRevision,epoch=readEpoch('feed:home'),count=Math.max(FEED_N,items.length);
    const current=()=>active()&&version===pageRevision&&epoch===readEpoch('feed:home');
    let pg=await feedPage(undefined,Math.min(50,count));
    while(current()&&pg.more&&pg.rows.length<count){
      const next=await feedPage(pg.rows.at(-1),Math.min(50,count-pg.rows.length));
      pg={rows:pg.rows.concat(next.rows),more:next.more&&!!next.rows.length,friends:pg.friends+next.friends};
    }
    if(!current())return;
    App.cache.set('feed:home',{data:pg,at:Date.now()});keepFeed(pg);draw(pg);
  };
  // Pull-to-refresh uses this read-only hook instead of replacing the entire page.
  el.refresh=()=>Promise.all([revalidate(),tools.refresh(),weeklyRecapOffer(recap),activityGroupStrip(groupStrip,account)]);
  more.onclick=async()=>{
    if(more.disabled||!active()||!items.length)return;
    const epoch=readEpoch('feed:home');pageRevision++;more.disabled=true;more.textContent='Loading…';
    try{
      const pg=await feedPage(items.at(-1));if(!active()||epoch!==readEpoch('feed:home'))return;
      const joined={rows:items.concat(pg.rows),more:pg.more,friends:items.filter(a=>a.owner).length+pg.friends};
      App.cache.set('feed:home',{data:joined,at:App.cache.get('feed:home')?.at||0});draw(joined);
    }catch(x){if(active()&&epoch===readEpoch('feed:home'))toast(x.message);}
    finally{more.disabled=false;more.textContent='Show more';}
  };
  try{if(!hit||Date.now()-hit.at>=15000)await revalidate();}
  catch(x){if(!hit)throw x;if(typeof PageRefresh!=='undefined')PageRefresh.failed(x);}
  await tools.ready;
}

// Read-only own social facts never replace feed cards or their live maps.
function feedTools(el,current){
  if(typeof Discovery==='undefined')return{refresh:async()=>{},ready:Promise.resolve()};
  const host=$('#feed-tools',el),top=$('#feed-top',el),owner=readOwner();let challenges=[],ready=false,headerCleanup=()=>{};
  const live=()=>current()&&readOwner()===owner;
  function fitHeader(){
    headerCleanup();const heading=$('.top',top),actions=$('.acts',top),title=$('h1',top),context=document.createElement('canvas').getContext('2d');
    const update=()=>{if(!live()||!heading.isConnected)return;context.font=getComputedStyle(title).font;const buttons=[...actions.children],gap=8;
      const required=context.measureText(title.textContent).width+buttons.reduce((n,b)=>n+Math.max(44,b.getBoundingClientRect().width),0)+gap*buttons.length;
      el.toggleAttribute('data-compact-actions',required>heading.clientWidth+1);
    };
    const observer=new ResizeObserver(update);observer.observe(heading);observer.observe(actions);update();document.fonts.ready.then(update);
    headerCleanup=()=>observer.disconnect();viewResources.set(top,headerCleanup);
  }
  function draw(){
    if(!live())return;host.setAttribute('aria-busy',String(!ready));
    fitHeader();
    const summary=Challenges.summary(challenges),q=summary?.first;
    const timing=q?(q.start>isoDay(new Date())?'Starts '+new Date(q.start+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'}):q.self.complete?'Goal reached':q.self.days_left===0?'Ends today':q.self.days_left===1?'1 day left':q.self.days_left+' days left'):'';
    host.innerHTML=summary?`<div class="feed-social-strip" aria-label="Active challenge progress"><a class="row-link challenge-summary" data-feed-tool="challenges" href="/me/challenges/${encodeURIComponent(q.code)}"><span class="ri">${svg('trophy')}</span><span class="grow"><b>${summary.count>1?summary.count+' challenges':'Challenge'}</b><small>${esc(summary.progress)} · ${esc(timing)}</small></span><span class="chev">${svg('chev')}</span></a></div>`:'';
  }
  host.addEventListener('click',e=>{if(!live()||e.metaKey||e.ctrlKey||e.button>0)return;const tile=e.target.closest('[data-activity-feature],[data-feed-tool]');if(!tile)return;const id=tile.dataset.activityFeature||tile.dataset.feedTool;Discovery.visit('activity',id);
    if(id==='invite'||id==='challenge'){e.preventDefault();e.stopPropagation();if(id==='invite')KinettaCard.open();else Challenges.create();}
  });
  async function refresh(){if(live())host.setAttribute('aria-busy','true');await Promise.allSettled([api('/api/challenges').then(rows=>{if(live())challenges=rows;})]);ready=true;draw();}
  draw();const initial=refresh();return{refresh,ready:initial};
}

// ---------- someone else's activity (read-only); for your own: what others see ----------
route(/^\/activity\/friends\/(\d+)$/, 'activity', async (el, id) => {
  el.innerHTML = `<div class="top">${backBtn('Home')}</div>${skel(1)}<div class="sk block"></div>`;
  wireBack(el, '/activity');
  await load(`/api/shared/${id}`, (a) => drawShared(el, a), {maxAge: 30000});
});
const SHARED_SERIES = ['speed','hr','alt'];
function drawShared(el, a) {
  const mine = a.social.mine, sh = a.shares, r = rate(a);
  const hero = (a.distance_m ? stat('Distance', U.dist(a.distance_m), U.du()) : '') + stat('Moving time', U.time(a.moving_s || a.elapsed_s)) +
    (a.distance_m && sh.pace && r.label !== 'Time' ? stat(r.label, r.v, r.u) : '');
  const splits = imp() ? a.splits_mi : a.splits_km;
  const details = sportStats(a);
  const panes = {
    charts: `${activitySamples(a, SHARED_SERIES) ? '<div class="card activity-chart-card"><div id="s-charts" class="activity-charts"></div></div>' : ''}${a.zones ? `<div class="card"><h2>Heart-rate zones</h2>${zonesHtml(a.zones)}</div>` : ''}`,
    overview: details ? `<div class="card"><h2>Details</h2><div class="hero more">${details}</div></div>` : '<div class="card empty">No additional details were shared.</div>',
    splits: `${splits && splits.length > 1 ? `<div class="card"><h2>Splits</h2>${splitsTable(a, splits)}</div>` : ''}${a.laps && a.laps.length > 1 ? `<div class="card"><h2>Laps</h2>${lapsTable(a)}</div>` : ''}`,
  };
  el.classList.add('activity-detail');
  const bars=ActivityDetail.header(a,{mine:false,backLabel:mine?'Your activity':'Activity'});
  panes.overview=`${a.description?`<div class="card"><p class="desc">${esc(a.description)}</p></div>`:''}${a.device?`<p class="small muted">${esc(a.device)}</p>`:''}${panes.overview}`;
  el.innerHTML=`${a.line?`<div class="detail-map-hero map-head">${activityMedia(a,{mapId:'s-map',detail:true,full:true,compact:true})}${bars.floating}</div>${bars.sticky}`:bars.floating}${ActivityDetail.title(a,hero,{shared:true})}${mine?'<div class="callout">This is what others see of your activity.</div>':''}${!a.line?activityMedia(a,{mapId:'s-map',detail:true,compact:true}):''}
    ${a.ends_hidden?'<p class="small muted map-note">The start and end of the route are hidden.</p>':''}${activityTabs(panes)}${mine?'':`<p class="center"><button class="linkbtn muted" id="s-rb">Report or block ${esc(a.owner.name)}</button></p>`}`;
  let redrawCharts = null;
  wireActivityTabs(el, key => { if (key === 'charts') redrawCharts?.(); });
  ActivityDetail.wire(el,a,{mine:false,back:mine?`/activity/${a.id}`:'/activity',fallbackLabel:mine?'Your activity':'Activity'});
  if (!mine) $('#s-rb', el).onclick = () => reportSheet(a.owner, {activity_id: a.id});
  if (a.line) {
    const box = $('#s-map', el); let m = null;
    wireMediaMapFull(box, () => m, a.line, !!a.photos?.length);
    lazy(box, async () => {
      try {
        // start/finish markers as on the feed card (Ben, 2026-10-24); a shared line is already trimmed by the server
        m = await mapInto(box, [a.line], {sport: a.sport, still: !!a.photos?.length && !box.classList.contains('full')});
        if (m && a.photos?.length && !box.classList.contains('full')) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
      } catch (e) { if (box.isConnected) box.insertAdjacentHTML('beforeend', '<p class="empty">Map unavailable right now</p>'); }
    });
  }
  wireTalk($('#s-soc', el), a.id, a.social, new URLSearchParams(location.search).get('tab') === 'comments');
  wireActivityMedia(el);
  if (activitySamples(a, SHARED_SERIES)) {
    const box = $('#s-charts', el); let width = 0;
    redrawCharts = () => { if (!box.isConnected || !box.clientWidth) return; width = box.clientWidth; sharedCharts(box, a); };
    if (!$('[data-pane="charts"]', el).hidden) requestAnimationFrame(redrawCharts);
    const observer = new ResizeObserver(() => { if (box.isConnected && box.clientWidth && Math.abs(box.clientWidth - width) > 20) redrawCharts(); });
    observer.observe(box); viewResources.set(box, () => observer.disconnect());
  }
}
function sharedCharts(box, a) {
  const c = a.chart, x = c.d && (c.d[c.d.length - 1] > 100 || !c.t) ? c.d : c.t, byDist = x === c.d, rows = [];
  if (!x) { box.closest('.card').remove(); return; }
  const foot = FOOT.includes(a.sport) && a.sport !== 'swim';
  if (c.speed) rows.push(foot ? {name: 'Pace', vals: c.speed.map((v) => (v > 0.5 ? 1000 / v : null)), fmt: (v) => U.pace(v), unit: U.pu(), color: col('--s5'), invert: true, clip: true}
                              : {name: 'Speed', vals: c.speed, fmt: (v) => U.speed(v), unit: U.su(), color: col('--s5'), clip: true});
  if (c.hr) rows.push({name: 'Heart rate', short: 'HR', vals: c.hr, fmt: (v) => Math.round(v), unit: 'bpm', color: col('--s1'), avg: a.avg_hr});
  if (c.alt) rows.push({name: 'Elevation', short: 'Elev', vals: c.alt, fmt: (v) => U.elev(v), unit: U.eu(), color: col('--hike')});
  chartStack(box, x, rows, {xfmt: (v) => (byDist ? `${U.dist(v)} ${U.du()}` : dur(v))});
}

// The cheer and comment icons by an activity's title (2026-10-12, Ben: a little icon near the title, comments pop up
// from below). Both activity pages use them; the counts follow what happens in the comments sheet.
const detailShareButton=()=>`<button type="button" class="pf activity-share" data-detail-share aria-label="Share a picture of this activity">${svg('share')}</button>`;
const talkIcons=(s,aid,onShare)=>reactionButtons(aid,s,true)+`<button type="button" class="pf activity-comments" data-ttalk aria-label="Comments, ${s.comments.length}">${svg('comment')}<span class="num"${s.comments.length?'':' hidden'}>${s.comments.length?reactionNumber(s.comments.length):''}</span></button>`+(onShare?detailShareButton():'');
function wireTalk(box,aid,s,open,{hideEmpty=false,onShare=null}={}){
  if(!box)return;const owner=readOwner(),cached=SocialData.peek(aid);if(cached)s=cached;else SocialData.remember(aid,s);
  box.innerHTML=talkIcons(s,aid,onShare);const visibility=()=>{if(hideEmpty)box.hidden=!(s.cheers.length||s.comments.length);};visibility();cleanViews();
  const group=$('[data-reaction-group]',box),talk=$('[data-ttalk]',box);
  const update=fresh=>{if(!box.isConnected||owner!==readOwner())return;s=fresh;visibility();group?._sync?.(s);const count=$('.num',talk);count.hidden=!s.comments.length;count.textContent=s.comments.length?reactionNumber(s.comments.length):'';talk.setAttribute('aria-label',`Comments, ${s.comments.length}`);};
  wireReactionGroup(group,aid,update);SocialData.warm(talk,aid);
  const share=$('[data-detail-share]',box);if(share)share.onclick=()=>{if(owner===readOwner())onShare?.();};
  viewResources.set(talk,SocialData.watch(aid,fresh=>{if(!box.isConnected||owner!==readOwner())return false;if(fresh)update(fresh);else box.replaceChildren();}));
  talk.onclick=()=>commentsSheet(aid,s,update);
  if(open)commentsSheet(aid,s,update);
}
const cheerName = (c) => (c.login === App.me.login ? 'You' : c.name);
const cheersPeople = (cheers,removeMine=null) => {
  const ordered=[...cheers].sort((a,b)=>Number(b.login===App.me?.login)-Number(a.login===App.me?.login));
  return ordered.length?ordered.map(c=>{
    const kind=reactionKind(c.kind||'clap'),label=REACTIONS().find(([key])=>key===kind)?.[1]||'clapping hands',mine=c.login===App.me?.login;
    const emoji=`<span role="img" aria-label="Reacted with ${esc(label)}">${reactionMark(kind)}</span>`;
    return mine?`<div class="person reaction-person" role="listitem">${avatar(c)}<b>${esc(cheerName(c))}</b>${emoji}${removeMine?'<button type="button" class="linkbtn reaction-remove" data-remove-reaction aria-label="Remove your reaction">Remove</button>':''}</div>`:
      `<a class="person reaction-person" role="listitem" data-close href="${profileHref(c)}">${avatar(c)}<b>${esc(cheerName(c))}</b>${emoji}</a>`;
  }).join(''):'<p class="small muted">No reactions yet.</p>';
};
function socialChanged(aid) {
  invalidate('/api/shared/' + aid); invalidate('/api/activities/' + aid + '/social'); invalidate('/api/feed/friends'); invalidate('/api/activities?'); invalidateFeed();
}
// cheers and comments in a bottom sheet; onChange gets the new state so the icon underneath can follow
const QUICK_REPLIES=['Nice work!','Great effort','Way to go'];
function commentsSheet(aid, s, onChange) {
  cleanViews();
  const account=readOwner();if(s&&!SocialData.peek(aid))SocialData.remember(aid,s);const cached=SocialData.peek(aid);
  sheet('Comments', `<div class="social social-sheet"><div class="social-reactions"><span class="small muted">Reactions</span></div><div class="comments" aria-label="Comments" aria-busy="${!cached}">${cached?'':skel(2)}</div>
    <p class="social-read-status small muted" role="status"></p>
    <div class="c-quick" aria-label="Quick replies">${QUICK_REPLIES.map(t=>`<button type="button" class="c-chip" data-quick>${esc(t)}</button>`).join('')}</div>
    <form class="c-form"><span class="c-me" aria-hidden="true">${avatar(App.me)}</span><label class="vh" for="c-${aid}">Write a comment</label><textarea id="c-${aid}" name="text" maxlength="500" rows="1" placeholder="Write a comment…" required></textarea><button class="c-send" aria-label="Post comment" disabled>${svg('send')}</button></form></div>`,b=>{
    const box=$('.social',b),f=$('.c-form',box),status=$('.social-read-status',box),list=$('.comments',box),send=$('.c-send',f),quick=$('.c-quick',box);
    const current=()=>box.isConnected&&account===readOwner();
    // The composer stays obvious: the send button wakes up with text, and quick replies only fill the box (never post).
    box._sync=()=>{const empty=!f.text.value.trim();send.disabled=!!box._denied||send.dataset.posting==='1'||empty;quick.hidden=!empty||!!box._denied;
      f.text.style.height='auto';f.text.style.height=Math.min(f.text.scrollHeight+2,132)+'px';};
    box._owner=account;box._onChange=onChange;box._aid=aid;f.text.value=SocialData.draft(aid);f.text.oninput=()=>{if(!current())return;SocialData.draft(aid,f.text.value);box._sync();};
    $$('[data-quick]',quick).forEach(b=>b.onclick=()=>{if(!current())return;f.text.value=b.textContent;SocialData.draft(aid,f.text.value);box._sync();f.text.focus();});
    requestAnimationFrame(()=>{if(current())box._sync();});
    const update=(fresh,{posted=false}={})=>{if(!current()||!fresh)return;drawComments(box,aid,fresh,onChange);status.textContent=posted?'Comment posted.':'';if(posted)list.scrollTop=list.scrollHeight;onChange?.(fresh);};
    if(cached)drawComments(box,aid,cached,onChange);
    viewResources.set(box,SocialData.watch(aid,fresh=>{if(!current())return false;if(fresh)drawComments(box,aid,fresh,onChange);else{list.replaceChildren();$('.social-reactions',box).replaceChildren();box._denied=true;box._sync();}}));
    const refresh=async()=>{try{const fresh=await SocialData.read(aid);update(fresh);}
      catch(error){if(!current())return;if([401,403,404].includes(error.status)){list.replaceChildren();$('.social-reactions',box).replaceChildren();box._denied=true;box._sync();}
        list.setAttribute('aria-busy','false');status.innerHTML=`${esc(loadErrorCopy(error))} <button type="button" class="linkbtn" data-retry>Retry</button>`;$('[data-retry]',status).onclick=refresh;}};
    f.onsubmit=async event=>{event.preventDefault();if(!current())return;const raw=f.text.value,text=raw.trim(),button=send;if(!text||button.disabled)return;
      let denied=false;button.dataset.posting='1';button.setAttribute('aria-busy','true');box._sync();
      try{const fresh=await api(`/api/activities/${aid}/comments`,json('POST',{text}));if(account!==readOwner())return;
        SocialData.remember(aid,fresh);socialChanged(aid);
        if(f.text.value===raw){f.text.value='';if(SocialData.draft(aid)===raw)SocialData.draft(aid,'');}
        if(current())update(fresh,{posted:true});
      }catch(error){denied=[401,403,404].includes(error.status);if(account===readOwner()&&denied)SocialData.forget(aid);if(current())status.textContent=error.message;}
      finally{if(current()){if(denied)box._denied=true;delete button.dataset.posting;button.removeAttribute('aria-busy');box._sync();}}
    };
    refresh();
  });
}
function drawComments(box,aid,s,onChange){
  if(!box.isConnected||box._owner!==readOwner())return;box._social=s;
  const list=$('.comments',box),reactions=$('.social-reactions',box);
  let group=$('[data-reaction-group]',reactions);
  if(!group){reactions.innerHTML=reactionButtons(aid,s,false,true);group=$('[data-reaction-group]',reactions);wireReactionGroup(group,aid);}
  else group._sync?.(s);
  if(list.getAttribute('aria-busy')==='true')list.replaceChildren();list.setAttribute('aria-busy','false');
  const keep=new Set();let anchor=list.firstElementChild;
  for(const comment of s.comments){const id=String(comment.id);keep.add(id);let node=[...list.children].find(n=>n.dataset.commentId===id);const signature=JSON.stringify(comment);
    if(!node){node=document.createElement('div');node.className='comment';node.dataset.commentId=id;}
    if(node===anchor)anchor=anchor.nextElementSibling;else list.insertBefore(node,anchor);
    if(node._signature===signature)continue;node._signature=signature;
    node.innerHTML=`<a href="${profileHref(comment)}" data-close aria-label="View ${esc(comment.name)}'s profile">${avatar(comment)}</a><div class="c-body"><div class="c-hd"><a href="${profileHref(comment)}" data-close><b>${esc(comment.name)}</b></a><small class="muted">${esc(when(comment.created))}</small></div><p>${esc(comment.text)}</p><div class="c-acts">${comment.can_delete?`<button class="linkbtn danger" data-del="${comment.id}" aria-label="Delete comment from ${esc(comment.name)}">Delete</button>`:''}${comment.login!==App.me.login?`<button class="linkbtn muted" data-rep="${comment.id}" aria-label="Report comment from ${esc(comment.name)}">Report</button>`:''}</div></div>`;
    const after=fresh=>{if(box._owner!==readOwner())return;socialChanged(aid);SocialData.remember(aid,fresh);if(box.isConnected)drawComments(box,aid,fresh,onChange);onChange?.(fresh);};
    const del=$('[data-del]',node);if(del)del.onclick=async()=>{if(box._owner!==readOwner()||!await confirmSheet('Delete this comment?',{action:'Delete'})||box._owner!==readOwner())return;del.disabled=true;
      try{await api('/api/comments/'+comment.id,{method:'DELETE'});after({...SocialData.peek(aid)||box._social,comments:(SocialData.peek(aid)||box._social).comments.filter(c=>c.id!==comment.id)});}catch(error){if(box._owner===readOwner())toast(error.message);if(del.isConnected)del.disabled=false;}};
    const report=$('[data-rep]',node);if(report)report.onclick=()=>{if(box._owner===readOwner())reportSheet(comment,{comment_id:comment.id},()=>after({...box._social,comments:box._social.comments.filter(c=>c.login!==comment.login)}));};
  }
  for(const node of [...list.children])if(!keep.has(node.dataset.commentId))node.remove();
  if(!s.comments.length)list.innerHTML=`<div class="c-none"><span>${svg('comment')}</span><b>Start the conversation</b><p class="small muted">Only people who can see this activity can read its comments.</p></div>`;
  box._sync?.();
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
  const previous=document.activeElement,page=$('#page')||root,anchor=document.createComment('photo viewer');page.append(anchor);
  let i = start,changed=false,closed=false;
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
      if (!await confirmSheet('Remove this photo?', {action: 'Remove'})) return;
      del.disabled = true;
      try {
        await api('/api/activity-photos/' + p.id, {method: 'DELETE'});
        a.photos = ph.filter((x) => x.id !== p.id); photoChanged(a.id);changed=true;
        if(closed){if(page.isConnected)onChange();return;} // Refresh a still-open page after a late removal, never a different view.
        if (!a.photos.length) return close();
        i = Math.min(i, a.photos.length - 1); draw();
      } catch (x) { toast(x.message); del.disabled = false; }
    };
    $('[data-x]', v).focus();
  };
  const step = (d) => { const n = i + d; if (n >= 0 && n < a.photos.length) { i = n; draw(); } };
  const key = (e) => { if(!ModalStack.isTop(v))return;ModalStack.trap(e,v);if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); };
  let x0 = null;
  v.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  v.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) step(e.clientX < x0 ? 1 : -1); x0 = null; });
  function close() { if(closed)return;closed=true;const refresh=changed&&anchor.isConnected;document.removeEventListener('keydown', key);viewResources.delete(anchor);anchor.remove();releaseModal();v.remove();document.body.classList.remove('ph-open');if(previous?.isConnected)previous.focus({preventScroll:true});if(refresh)onChange(); } // Refresh the underlying page after the remaining photos are closed.
  document.addEventListener('keydown', key);
  document.body.append(v);const releaseModal=ModalStack.open(v);viewResources.set(anchor,close);document.body.classList.add('ph-open');
  draw();
}

// ---------- your own activity: cheers + comments by the title; who sees it lives in the Edit sheet ----------
async function ownSocial(el, a) {
  const box = $('#d-soc', el); if (!box) return;
  const owner=readOwner(),cached=SocialData.peek(a.id),current=()=>box.isConnected&&owner===readOwner();
  const onShare=()=>shareOut(a);
  if(cached){if(cached.visibility&&cached.details)a._social=cached;wireTalk(box,a.id,cached,new URLSearchParams(location.search).get('tab')==='comments',{hideEmpty:true,onShare});}
  else {box.innerHTML=detailShareButton()+'<span class="small muted" role="status">Loading reactions…</span>';const share=$('[data-detail-share]',box);share.onclick=()=>{if(current())onShare();};}
  try{const fresh=await SocialData.read(a.id,{ownerDetails:true});if(!fresh||!current())return;a._social=fresh;
    if(!cached)wireTalk(box,a.id,fresh,new URLSearchParams(location.search).get('tab')==='comments',{hideEmpty:true,onShare});
  }catch(error){if(current()&&!cached){box.hidden=false;box.innerHTML=detailShareButton()+'<button type="button" class="linkbtn" data-social-retry>Retry reactions</button>';$('[data-detail-share]',box).onclick=()=>{if(current())onShare();};$('[data-social-retry]',box).onclick=()=>ownSocial(el,a);}}
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
    <details class="sh-more"><summary>Choose what’s shared</summary><div class="checks">${detailChecks(s.details)}</div>
      <p class="small muted">Splits and laps are shared only with pace. Private notes and Kit’s notes are never shared.</p>
      ${s.custom ? '<button type="button" class="linkbtn" id="sh-usual">Use my usual details</button>' : ''}</details>
    ${s.visibility !== 'me' ? `<a class="small" href="/activity/friends/${aid}" data-close>Preview as a friend ›</a>` : ''}`;
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
  login=decodeURIComponent(login);
  const own=!!App.me&&login.toLowerCase()===App.me.login.toLowerCase(),owner=readOwner(),initial=new URLSearchParams(location.search);
  if(initial.get('view')==='achievements'){
    if(own){go('/me/achievements',{replace:true});return;}
    ProfileLayout.achievementPage(el,initial.get('track')||'',{login,returnPath:`/people/${encodeURIComponent(login)}`});return;
  }
  let revision=0,sport=initial.get('sport')||'',term=initial.get('q')||'',searchOpen=own&&initial.get('search')==='1',deferred=null;
  const path=()=>'/api/people/'+encodeURIComponent(login)+'/profile'+(own?'?limit=1':'');
    el.innerHTML=`<div class="top${own?' owner-profile-top':''}">${backBtn(own?'Me':'People')}<span class="profile-page-title">${own?'Your profile':'Profile'}</span>${own?'':`<a class="icon-btn" href="/me/friends?find=1" aria-label="Find friends">${svg('user-plus')}</a>`}</div><div id="person-profile">${skel(2)}</div>`;
  const box=$('#person-profile',el),active=()=>box.isConnected&&owner===readOwner();
  if(own){el.classList.add('has-back');el._backFallback='/me';const back=$('[data-back]',el);back.setAttribute('aria-label','Back to Me');back.onclick=()=>{if(active())go('/me');};}else wireBack(el,'/me/friends');
  function address(){const q=new URLSearchParams(location.search);q.delete('preview');q.delete('search');for(const [key,value] of [['sport',sport],['q',term]])value?q.set(key,value):q.delete(key);replacePageAddress(el,location.pathname+(q.size?'?'+q:'')+location.hash);}
  const draw=r=>{
    if(!active())return;
    if($('.me-card.editing',box)){deferred={data:r,version:revision,key:path(),epoch:readEpoch(path())};return;}
    const mine=Boolean(own&&r.mine);
    r={...r,mine,layout:ProfileLayout.normalize(r.layout)};
    const p=r.person,feed=mine||r.layout.sections.includes('activities');
    const action=r.status==='friends'?`<button type="button" class="me-card-pill" data-person-manage>${svg('check')}Friends</button>`:r.status==='sent'?'<button type="button" class="me-card-pill" data-person-action="cancel">Request sent</button>':r.status==='incoming'?`<button type="button" class="me-card-pill solid" data-person-action="accept">${svg('check')}Approve request</button>`:`<button type="button" class="me-card-pill solid" data-person-action="add">${svg('plus')}Add friend</button>`;
    const pills=mine?MeCard.ownPills():action+`<button type="button" class="me-card-pill" data-person-report aria-label="Report or block ${esc(p.name)}">${svg('more')}</button>`;
    const friends=mine?MeCard.ownFriends(r.friend_count):Number.isInteger(r.friend_count)?`<span class="me-friends-link">${svg('people')}<span>${friendCountText(r.friend_count)}</span></span>`:'';
    box.innerHTML=`${r.profile_hidden?'<p class="callout warn">Your profile is hidden until your account is confirmed and active.</p>':''}${MeCard.card(p,{viewer:mine?'owner':'friend',pills,friends})}
      ${mine?`<section class="profile-activities" aria-label="Your activities"><div id="workout-sync"></div><div class="profile-activity-tools"><h2>Activities</h2><div class="profile-list-filters"><button type="button" class="ghost" id="person-sport"></button><button type="button" class="icon-btn" id="person-search" aria-label="Search your activities" aria-expanded="${!!term||searchOpen}">${svg('search')}</button></div></div><form id="person-search-form" role="search"${term||searchOpen?'':' hidden'}><input type="search" name="q" aria-label="Search your activities" value="${esc(term)}" placeholder="Search names and descriptions" enterkeyhint="search"></form><div class="feed-list" id="person-activities" aria-busy="true">${skelFeed(2)}</div><button type="button" class="ghost wide feed-more" id="person-more" hidden>Show more</button></section>`:feed?ProfileLayout.content(r,{...r.layout,sections:['activities']}):''}`;
    MeCard.mount(box,{data:r,viewer:mine?'owner':'friend',mode:'profile',reload,onSaved:reload,onEditEnd:async({saved})=>{
      const held=deferred;deferred=null;if(saved||!held||!active()||held.version!==revision||held.key!==path())return;
      if(held.epoch!==readEpoch(held.key)){reload();return;}
      await draw(held.data);if(active()&&held.version===revision&&document.activeElement===document.body)$('[data-card-edit]',box)?.focus({preventScroll:true});
    }});ProfileLayout.mount(box,r,{shared:!mine});
    const act=$('[data-person-action]',box);
    if(act)act.onclick=async()=>{
      act.disabled=true;
      try{
        const url='/api/friends/'+encodeURIComponent(p.login);
        if(act.dataset.personAction==='cancel')await api(url,{method:'DELETE'});
        else if(act.dataset.personAction==='accept')await api(url+'/accept',json('POST',{}));
        else await api('/api/friends',json('POST',{login:p.login}));
        invalidate('/api/friends');invalidate('/api/people/');invalidate('/api/me');invalidateFeed();if(active())await reload();
      }catch(x){if(active()){toast(x.message);act.disabled=false;}}
    };
    const manage=$('[data-person-manage]',box);if(manage)manage.onclick=()=>friendshipSheet(p,({blocked})=>blocked?go('/me/friends',{replace:true}):reload());
    const report=$('[data-person-report]',box);if(report)report.onclick=()=>reportSheet(p,{},()=>go('/me/friends',{replace:true}));
    if(mine)return ownHistory(r);
    const more=$('#person-more',box);let next=r.next;
    if(more)more.onclick=async()=>{
      if(!next||more.disabled||!active())return;more.disabled=true;more.textContent='Loading…';const version=revision;
      try{const fresh=await api(path()+(path().includes('?')?'&':'?')+new URLSearchParams(next));if(!active()||version!==revision)return;
        $('#person-activities',box).insertAdjacentHTML('beforeend',fresh.items.map(a=>postCard(a)).join(''));next=fresh.next;more.hidden=!next;feedMaps(box);wireCheers(box);
      }catch(x){if(active()&&version===revision)toast(x.message);}finally{more.disabled=false;more.textContent='Show more';}
    };
  };
  async function ownHistory(r){
    // Raw owner rows stay out of every audience-filtered profile response and cache.
    const list=$('#person-activities',box),more=$('#person-more',box),form=$('#person-search-form',box),picker=$('#person-sport',box),search=$('#person-search',box),version=revision;
    const current=()=>active()&&version===revision&&list.isConnected,base=()=>'/api/activities?'+new URLSearchParams({limit:25,...(sport?{sport}:{}),...(term?{q:term}:{})});
    let sports=[...new Set((r.sports||[]).map(row=>row.sport))],rows=[],request=0,revalidating=false;
    load('/api/stats',stats=>{if(current())sports=[...new Set([...sports,...stats.years.map(row=>row.sport)])];}).catch(()=>{});
    const stopMore=()=>{viewResources.get(more)?.();viewResources.delete(more);};
    const arm=()=>{stopMore();if(!revalidating&&!more.hidden&&current())lazy(more,()=>{if(current()&&!more.disabled)more.click();});};
    const label=()=>{const name=SPORT_NAMES[sport]||'All sports';picker.innerHTML=esc(name)+svg('chev');picker.setAttribute('aria-label',name+', choose sport');};label();
    workoutSyncStatus($('#workout-sync',box));
    picker.onclick=()=>sheet('Sport',`<div class="profile-sport-options">${['',...sports].map(s=>`<button type="button" class="row-link" data-owner-sport="${esc(s)}" aria-pressed="${sport===s}"><span class="grow">${esc(SPORT_NAMES[s]||'All sports')}</span>${sport===s?svg('check'):''}</button>`).join('')}</div>`,(body,close)=>{$$('[data-owner-sport]',body).forEach(b=>b.onclick=()=>{if(!current())return;close();sport=b.dataset.ownerSport;term=form.elements.q.value.trim();address();label();loadRows();});});
    search.onclick=()=>{form.hidden=!form.hidden;search.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)form.elements.q.focus();};
    form.onsubmit=e=>{e.preventDefault();term=form.elements.q.value.trim();address();loadRows();};
    async function loadRows(){
      const key=base(),sequence=++request;stopMore();revalidating=true;rows=[];more.hidden=true;more.disabled=true;more.textContent='Show more';list.setAttribute('aria-busy','true');list.innerHTML=skelFeed(2);cleanViews();
      try{const data=await load(key,records=>{
        if(!current()||sequence!==request)return;rows=records;sports=[...new Set([...sports,...rows.map(a=>a.sport)])];
        list.innerHTML=rows.length?rows.map(a=>postCard(a,{lock:true})).join(''):`<div class="card empty"><b>${term||sport?'Nothing matches':'No activities yet'}</b>${term||sport?'Try another filter.':`Workouts from your watch arrive here on their own.${startCta()}`}</div>`;
        more.hidden=rows.length<25||rows.length%25!==0;list.setAttribute('aria-busy','false');feedMaps(list);wireCheers(list);arm();
      });if(data===null&&current()&&sequence===request)throw Error('Your activities changed. Try loading again.');}
      catch(x){if(current()&&sequence===request){rows=[];more.hidden=true;stopMore();showError(list,x);const retry=$('button',list);if(retry)retry.onclick=loadRows;}}
      finally{if(current()&&sequence===request){revalidating=false;more.disabled=false;list.setAttribute('aria-busy','false');arm();}}
    }
    more.onclick=async()=>{
      if(!current()||revalidating||more.hidden||more.disabled||!rows.length)return;stopMore();const key=base(),epoch=readEpoch(key),sequence=++request,last=rows.at(-1),focused=document.activeElement===more;let ok=false;
      more.disabled=true;more.textContent='Loading…';
      try{const page=await api(key+'&'+new URLSearchParams({before:last.start_time,before_id:last.id}));if(!current()||sequence!==request||epoch!==readEpoch(key))return;
        rows=rows.concat(page);App.cache.set(key,{data:rows,at:Date.now()});list.insertAdjacentHTML('beforeend',page.map(a=>postCard(a,{lock:true})).join(''));more.hidden=page.length<25;feedMaps(list);wireCheers(list);ok=true;
      }catch(x){if(current()&&sequence===request){toast(x.message);more.textContent='Retry';}}
      finally{if(current()&&sequence===request){more.disabled=false;if(more.textContent==='Loading…')more.textContent='Show more';if(ok)arm();if(focused&&!more.hidden&&document.activeElement===document.body)more.focus({preventScroll:true});}}
    };
    await loadRows();
  }
  async function reload(initial=false,focus=null){
    const version=++revision;deferred=null;let pending;
    if(!focus&&document.activeElement?.matches('[data-card-edit]'))focus='[data-card-edit]';
    if(!initial)invalidate('/api/people/');box.style.minHeight=box.getBoundingClientRect().height+'px';box.setAttribute('aria-busy','true');
    // Clear the previous projection immediately, including any private owner feed.
    box.innerHTML=skel(2);
    try{await load(path(),r=>{if(active()&&version===revision)pending=draw(r);},{maxAge:0});await pending;
      if(active()&&version===revision&&focus&&document.activeElement===document.body)$(focus,box)?.focus({preventScroll:true});
    }catch(x){if(active()&&version===revision)showError(box,x);}
    finally{if(active()&&version===revision){box.style.minHeight='';box.removeAttribute('aria-busy');}}
  }
  if(own&&initial.has('preview')&&!searchOpen)address();
  await reload(true);
  if(searchOpen)address();
});

const friendCountText = n => n===0?'No friends yet':`${n} ${n===1?'friend':'friends'}`;
function friendChangeSheet(p, block, onChange) {
  const owner=readOwner(),verb=block?'Block':'Remove';
  const message=block?`Neither of you can find or see the other on Kinetta. You stop being friends. They aren’t told.`:`You’ll stop seeing each other’s friends-only activities. They aren’t told.`;
  sheet(`${verb} ${p.name}?`, `<p>${esc(message)}</p><p class="err" role="alert"></p><div class="actions"><button type="button" class="ghost" data-keep>${block?'Cancel':'Keep'}</button><button type="button" class="primary danger-btn" data-confirm>${verb}</button></div>`,(b,close)=>{
    const live=()=>owner===readOwner()&&b.isConnected;
    $('[data-keep]',b).onclick=close;
    $('[data-confirm]',b).onclick=async()=>{
      if(!live()||$('[data-confirm]',b).disabled)return;
      $$('button',b).forEach(x=>x.disabled=true);
      try {
        await api(block?`/api/people/${encodeURIComponent(p.login)}/block`:`/api/friends/${encodeURIComponent(p.login)}`,block?json('POST',{}):{method:'DELETE'});
        if(owner!==readOwner())return;
        invalidate('/api/friends');invalidate('/api/people/');invalidate('/api/shared/');invalidate('/api/blocks');invalidateFeed();
        close();toast(block?`${p.name} is blocked`:'Friend removed');await onChange?.({blocked:block,login:p.login});
      }catch(x){if(live()){$('.err',b).textContent=x.message;$$('button',b).forEach(x=>x.disabled=false);}}
    };
  });
}
function friendshipSheet(p, onChange) {
  sheet(p.name, `<p>You’re friends on Kinetta.</p><a class="ghost wide" href="${profileHref(p)}" data-close>View profile</a><button class="ghost wide danger" type="button" data-remove>Remove friend</button><button class="ghost wide danger" type="button" data-block>Block</button>`,(b,close)=>{
    for(const [selector,block] of [['[data-remove]',false],['[data-block]',true]])$(selector,b).onclick=()=>{close();friendChangeSheet(p,block,onChange);};
  });
}

// ---------- finding friends (Ben, 25 October 2026: "a tad easier to quickly find your friends") ----------
// Your own invite link: whoever opens it while signed in becomes your friend at once; a new account through it, once its
// email is confirmed. The share sheet says so, so it goes only to people you'd add yourself.
async function inviteFriends() {
  const owner=readOwner(),same=()=>owner===readOwner();
  let link;
  try { link = await api('/api/friends/link'); } catch (x) { if(same())toast(x.message); return; }
  if(!same())return;
  const url = link.url.startsWith('/') ? appBase() + link.url : link.url;
  const text = `Join me on Kinetta so we can follow each other's workouts.`;
  const copySheet = () => sheet('Invite friends', `<p>Anyone who opens this link becomes your friend on Kinetta. It lasts 30 days, so share it only with people you’d add yourself.</p>
    <label class="form">Your invite link<input readonly value="${esc(url)}" aria-label="Invite link"></label>
    <div class="btncol"><button type="button" class="primary wide" id="iv-share">Share invite link</button><button type="button" class="ghost wide" id="iv-copy">Copy link</button><button type="button" class="ghost wide" id="iv-qr">Show QR code</button></div>
    <div class="invite-qr-code" id="iv-qr-code" hidden></div><p class="small muted" id="iv-status" role="status"></p><button type="button" class="linkbtn muted" id="iv-new">Make a new link (the old one stops working)</button>`, (b, close) => {
    const live=()=>same()&&b.isConnected;
    const input = $('input', b); input.onclick = () => input.select();
    $('#iv-share',b).onclick = async () => {
      if(!live())return;
      try {
        if(navigator.share)await navigator.share({title:'Find friends on Kinetta',text,url});
        else {await navigator.clipboard.writeText(`${text} ${url}`);}
        if(live())$('#iv-status',b).textContent=navigator.share?'Invite shared':'Link copied';
      } catch(e) { if(live()&&e.name!=='AbortError')$('#iv-status',b).textContent='Select and copy the invite link above.'; }
    };
    $('#iv-copy', b).onclick = async () => {
      if(!live())return;
      try { await navigator.clipboard.writeText(`${text} ${url}`); if(live())$('#iv-status', b).textContent = 'Link copied'; }
      catch { if(live()){input.select();$('#iv-status', b).textContent = 'Select and copy the link above.';} }
    };
    $('#iv-qr',b).onclick=async()=>{
      if(!live())return;
      const box=$('#iv-qr-code',b);box.hidden=false;
      if(box.firstElementChild||box.dataset.loading)return;
      box.dataset.loading='true';
      try {
        await loadQrCode();if(!live())return;
        const code=qrcode(0,'M');code.addData(url);code.make();const n=code.getModuleCount(),m=4,ns='http://www.w3.org/2000/svg';let path='';
        for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))path+=`M${x+m} ${y+m}h1v1h-1z`;
        const graphic=document.createElementNS(ns,'svg');graphic.setAttribute('viewBox',`0 0 ${n+2*m} ${n+2*m}`);graphic.setAttribute('role','img');graphic.setAttribute('aria-label','QR code for your Kinetta invite link');
        const background=document.createElementNS(ns,'rect');background.setAttribute('width',n+2*m);background.setAttribute('height',n+2*m);background.setAttribute('fill','#fff');
        const marks=document.createElementNS(ns,'path');marks.setAttribute('d',path);marks.setAttribute('fill','#000');graphic.append(background,marks);box.append(graphic);
      } catch { if(live()){box.hidden=true;$('#iv-status',b).textContent='The QR code could not be shown. Copy the invite link instead.';} }
      finally{delete box.dataset.loading;}
    };
    $('#iv-new', b).onclick = async () => {
      const button=$('#iv-new',b);if(!live()||button.disabled)return;button.disabled=true;
      try { await api('/api/friends/link/new', json('POST', {}));if(!live())return;close();toast('New invite link made');inviteFriends(); }
      catch (x) { if(live()){toast(x.message);button.disabled=false;} }
    };
  });
  copySheet();
}
const hiddenKey = () => 'kinetta.hideSuggest:' + readOwner();
const hiddenPeople = () => { try { return new Set(store.get(hiddenKey()) || []); } catch { return new Set(); } };
async function suggestedPeople() {
  try { const hidden = hiddenPeople(); return (await api('/api/people/suggested')).filter((p) => !hidden.has(p.login)); }
  catch (x) { return []; }
}
// A row of people to add, with why, and an invite tile. Used on the Friends feed (while you have few friends) and Friends.
function peopleRow(box, people, {title = 'People you may know', onChange, invite = true, dismiss = true, compactAdd = false} = {}) {
  const row = (p) => `<div class="person pym-row" data-login="${esc(p.login)}"><a class="person-link" href="${profileHref(p)}">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small>${esc(p.why)}</small></span></a>
      <span class="pym-actions"><button type="button" class="suggestion-add${compactAdd?' friend-circle-add':''}" data-add="${esc(p.login)}" aria-label="Add ${esc(p.name)} as a friend">${compactAdd?svg('plus'):'＋ Add'}</button>${dismiss?`<button type="button" class="icon-btn pym-hide" data-hide="${esc(p.login)}" aria-label="Hide ${esc(p.name)}">${svg('close')}</button>`:''}</span></div>`;
  if (!people.length && !invite) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="pym" aria-label="${esc(title)}"><div class="pym-head"><h2>${people.length ? esc(title) : 'Find your friends'}</h2>${invite ? '<button type="button" class="linkbtn" data-invite>Invite</button>' : ''}</div>
    ${people.length ? `<div class="pym-list">${people.map(row).join('')}</div>` : ''}</section>`;
  $$('[data-invite]', box).forEach((b) => b.onclick = inviteFriends);
  $$('[data-hide]', box).forEach((b) => b.onclick = () => {
    const hidden = hiddenPeople(); hidden.add(b.dataset.hide);
    try { store.set(hiddenKey(), [...hidden].slice(-200)); } catch { /* hiding is a convenience */ }
    b.closest('.pym-row').remove();
    if (!box.querySelector('.pym-row')) box.parentElement.hidden = true;
  });
  $$('[data-add]', box).forEach((b) => b.onclick = async () => {
    const owner=readOwner(),live=()=>owner===readOwner()&&box.isConnected;
    if(!live()||b.disabled)return;
    const label=b.getAttribute('aria-label');b.disabled = true;b.classList.add('is-pending');b.setAttribute('aria-busy','true');b.setAttribute('aria-label',label.replace(/^Add /,'Sending request to '));
    try {
      const r = await api('/api/friends', json('POST', {login: b.dataset.add}));
      if(!live())return;
      b.outerHTML = `<span class="friend-status" role="status"><span aria-hidden="true">✓</span> ${r.status === 'friends' ? 'Friends' : 'Requested'}</span>`;
      invalidate('/api/friends');invalidate('/api/people/');invalidateFeed();await onChange?.();
    } catch (x) { if(live()){toast(x.message);b.disabled=false;b.classList.remove('is-pending');b.removeAttribute('aria-busy');b.setAttribute('aria-label',label);b.innerHTML=compactAdd?svg('plus'):'＋ Add';} }
  });
}
// The page an invite link opens when you're signed in: who sent it, and one button.
route(/^\/add\/([\w-]+)$/, 'activity', async (el, code) => {
  el.innerHTML = `<div class="top">${backBtn('Home')}</div>${skel(1)}`;
  wireBack(el, '/activity');
  let who;
  try { who = await api('/api/friend-links/' + encodeURIComponent(code)); }
  catch (x) { el.innerHTML = `<div class="top">${backBtn('Home')}</div><div class="card empty"><b>This invite link doesn’t work</b>${esc(x.message)}<div class="btncol"><a class="ghost" href="/me/friends?find=1">Find friends</a></div></div>`; wireBack(el, '/activity'); return; }
  el.innerHTML = `<div class="top">${backBtn('Home')}</div><div class="card empty add-friend"><b>${esc(who.name)} invited you to be friends</b>
    You’ll each see the activities the other shares with friends. You can change that or stop being friends any time.
    <div class="btncol"><button class="primary" id="af-yes">Become friends</button><a class="ghost" href="/activity">Not now</a></div></div>`;
  wireBack(el, '/activity');
  $('#af-yes', el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/friend-links/' + encodeURIComponent(code), json('POST', {}));
      store.del('kinetta.friendLink'); invalidate('/api/friends'); invalidateFeed();
      toast(r.new ? `You and ${r.name} are friends now` : `You and ${r.name} were already friends`); go(profileHref(r), {replace: true});
    } catch (x) { toast(x.message); e.target.disabled = false; }
  };
});

route(/^\/me\/friends\/contacts$/, 'me', el=>ContactsUI.mount(el));
function installFriendListSearch(el){
  if(!el.classList.contains('friends-list-page'))return;
  const header=el.querySelector('.top'),list=el.querySelector('#fr-own-list'),requests=el.querySelector('#fr-requests');
  if(!header||!list||!requests)return;
  header.querySelector('#fr-browse')?.remove();
  const form=document.createElement('form');form.id='fr-list-find';form.className='searchbox people-search friend-list-search';form.setAttribute('role','search');
  form.innerHTML=`<span class="sb-ico">${svg('search')}</span><input type="search" name="q" placeholder="Find friends" aria-label="Search name or @username" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search">`;
  form.addEventListener('submit',event=>{
    event.preventDefault();const params=new URLSearchParams({find:'1'}),query=form.elements.q.value.trim();if(query)params.set('q',query);go('/me/friends?'+params.toString());
  });
  header.insertAdjacentElement('afterend',form);
  const invite=document.createElement('button');invite.type='button';invite.id='fr-list-invite';invite.className='row-link friend-action friend-list-invite';invite.setAttribute('aria-label','Invite friends');
  invite.innerHTML=`<span class="ri">${svg('share')}</span><span class="grow"><b>Invite friends</b><small>Share a link or QR code</small></span>${svg('chev')}`;
  invite.addEventListener('click',()=>inviteFriends());requests.insertAdjacentElement('afterend',invite);
  const updateInvite=()=>{invite.hidden=!!el.querySelector('#fr-list-retry')||list.querySelectorAll('.fr-friend').length>5;};
  const observer=new MutationObserver(updateInvite);observer.observe(list,{childList:true});updateInvite();viewResources.set(form,()=>observer.disconnect());
}
route(/^\/me\/friends$/, 'me', async el=>{const find=new URLSearchParams(location.search).has('find')||new URLSearchParams(location.search).has('q');await FriendsUI.mount(el);if(find)ContactsUI.addEntry(el);else installFriendListSearch(el);});

// ---------- private event Groups (2026-11-07) ----------
const GROUP_GOALS={distance:'Distance',elevation:'Elevation',long_outings:'Long outings',sessions:'Sessions'};
function groupDate(value,zone){
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d,12));
  return new Intl.DateTimeFormat(undefined,{timeZone:zone,month:'short',day:'numeric',year:'numeric'}).format(date);
}
function groupNumber(value){return Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1});}
function groupAmount(value,unit){return `${groupNumber(value)} ${unit}`;}
function groupTimeZoneLabel(zone){
  if(zone==='UTC'||zone==='Etc/UTC')return 'UTC';
  try{const name=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(part=>part.type==='timeZoneName')?.value;if(name&&!/^GMT[+-]/.test(name))return name.replace(/\bTime\b/g,'time');}catch{}
  const place=zone.split('/').at(-1).replace(/_/g,' ');return `${place} time`;
}
function groupTimeZonePickerLabel(zone){const place=zone.split('/').slice(1).join(' · ').replace(/_/g,' ');return place?`${place} · ${groupTimeZoneLabel(zone)}`:groupTimeZoneLabel(zone);}
function groupTimeZoneOptions(current){
  let zones;
  try{zones=Intl.supportedValuesOf('timeZone');}catch{zones=['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Toronto','America/Vancouver','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'];}
  if(!zones.includes(current))zones.push(current);
  return [...new Set(zones)].sort((a,b)=>groupTimeZonePickerLabel(a).localeCompare(groupTimeZonePickerLabel(b))).map(zone=>`<option value="${esc(zone)}"${zone===current?' selected':''}>${esc(groupTimeZonePickerLabel(zone))}</option>`).join('');
}
function groupInviteSheet(url){
  const owner=readOwner();sheet('Invite to this group',`<p>People who open this link see only that they’re invited to a private group. They must sign in and accept.</p><p class="group-invite-link" tabindex="0">${esc(url)}</p>
    <div class="group-invite-actions"><button type="button" class="primary wide" data-group-copy>Copy invite link</button><button type="button" class="ghost wide" data-group-share>Share invite link</button></div>
    <button type="button" class="linkbtn wide" data-close>Done</button>`,(body,close)=>{
      const live=()=>owner===readOwner()&&body.isConnected;
      $('[data-group-copy]',body).onclick=async()=>{
        try{await navigator.clipboard.writeText(url);if(live())toast('Invite link copied');}
        catch{const field=document.createElement('textarea');field.value=url;field.setAttribute('readonly','');body.append(field);field.select();try{document.execCommand('copy');toast('Invite link copied');}catch{toast('Couldn’t copy the invite link');}field.remove();}
      };
      $('[data-group-share]',body).onclick=async()=>{try{if(navigator.share)await navigator.share({title:'Join my Kinetta group',url});else await navigator.clipboard.writeText(url);if(live()&&!navigator.share)toast('Invite link copied');}catch(e){if(e.name!=='AbortError'&&live())toast('Couldn’t share the invite link');}};
      $('[data-close]',body).onclick=close;
    });
}
function groupCreateSheet(done){
  const today=new Date().toLocaleDateString('en-CA'),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  sheet('Create a group',`<form class="form group-create-form" id="group-create-form"><div class="group-create-fields">
    <label>Group name<input name="title" maxlength="80" required autocomplete="off" placeholder="Dolomites hike"></label>
    <label>Event date (optional)<input name="event_date" type="date" min="${today}"></label><button class="group-date-clear" type="button" data-group-date-clear hidden>Clear date</button>
    <div class="group-time-zone"><button class="group-zone-change" type="button" id="group-zone-change">${esc(groupTimeZoneLabel(zone))} · Change</button><select class="group-zone-picker" name="time_zone" aria-label="Event time zone" required hidden>${groupTimeZoneOptions(zone)}</select></div>
    <label>Short note (optional)<textarea name="note" maxlength="280" rows="2"></textarea></label>
    <label>Shared goal<select name="goal_type"><option value="distance">Distance</option><option value="elevation">Elevation</option><option value="long_outings">Long outings</option><option value="sessions">Sessions</option></select></label>
    <div class="group-goal-fields"><label>Target<input name="goal_target" type="number" min="0.1" max="1000000" step="0.1" value="100" required></label><label>Units<select name="goal_unit"><option value="km">km</option><option value="mi">mi</option></select></label></div>
    <p class="small muted">Only group members see the group. Activities, routes, food and body data stay private.</p></div>
    <div class="group-create-footer"><button class="primary wide" type="submit">Create group</button><button class="linkbtn wide" type="button" data-close>Cancel</button></div></form>`,(body,close)=>{
      const form=$('#group-create-form',body),kind=form.elements.goal_type,unit=form.elements.goal_unit,target=form.elements.goal_target,zoneButton=$('#group-zone-change',form),zonePicker=form.elements.time_zone,date=form.elements.event_date,clearDate=$('[data-group-date-clear]',form);
      const setGoal=()=>{const options=kind.value==='distance'?[['km','km'],['mi','mi']]:kind.value==='elevation'?[['m','m'],['ft','ft']]:kind.value==='long_outings'?[['outings','outings']]:[['sessions','sessions']];unit.innerHTML=options.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');target.step=options[0][0]==='km'||options[0][0]==='mi'||options[0][0]==='m'||options[0][0]==='ft'?'0.1':'1';target.min=target.step;};
      kind.onchange=setGoal;setGoal();
      const syncDateClear=()=>{clearDate.hidden=!date.value;};date.oninput=syncDateClear;date.onchange=syncDateClear;
      clearDate.onclick=()=>{date.value='';syncDateClear();date.focus({preventScroll:true});};
      zoneButton.onclick=()=>{zonePicker.hidden=false;zoneButton.hidden=true;zonePicker.focus({preventScroll:true});try{zonePicker.showPicker?.();}catch{}};
      const closeZonePicker=()=>{if(zonePicker.hidden)return;zoneButton.textContent=`${groupTimeZoneLabel(zonePicker.value)} · Change`;zonePicker.hidden=true;zoneButton.hidden=false;};
      zonePicker.onchange=()=>{closeZonePicker();zoneButton.focus({preventScroll:true});};zonePicker.onblur=closeZonePicker;
      form.onsubmit=async event=>{event.preventDefault();const submit=$('button[type=submit]',form);if(submit.disabled)return;submit.disabled=true;
        const data={title:form.elements.title.value.trim(),event_date:date.value||null,time_zone:zonePicker.value,note:form.elements.note.value.trim(),goal_type:kind.value,goal_target:Number(target.value),goal_unit:unit.value};
        try{const group=await api('/api/groups',json('POST',data));if(!body.isConnected)return;close();done(group);}
        catch(error){if(body.isConnected){toast(error.message);submit.disabled=false;}}
      };
      $('[data-close]',body).onclick=close;
    });
}
function groupEventDateSheet(group,reload){
  sheet('Edit event date',`<form class="form group-create-form" id="group-event-date-form"><div class="group-create-fields">
    <label>Event date (optional)<input name="event_date" type="date" value="${esc(group.event_date||'')}"></label>
    <button class="group-date-clear" type="button" data-group-date-clear${group.event_date?'':' hidden'}>Clear date</button>
    <p class="small muted">Clear the date for an ongoing goal. Its total starts with this group.</p>
    </div><div class="group-create-footer"><button class="primary wide" type="submit">Save</button><button class="linkbtn wide" type="button" data-close>Cancel</button></div></form>`,(body,close)=>{
      const form=$('#group-event-date-form',body),date=form.elements.event_date,clearDate=$('[data-group-date-clear]',form);
      const syncDateClear=()=>{clearDate.hidden=!date.value;};date.oninput=syncDateClear;date.onchange=syncDateClear;
      clearDate.onclick=()=>{date.value='';syncDateClear();date.focus({preventScroll:true});};
      $('[data-close]',body).onclick=close;
      form.onsubmit=async event=>{event.preventDefault();const save=$('button[type=submit]',form);if(save.disabled)return;save.disabled=true;
        try{await api(`/api/groups/${encodeURIComponent(group.id)}/event-date`,json('PATCH',{event_date:date.value||null}));close();toast('Group updated');reload();}
        catch(error){if(body.isConnected){toast(error.message);save.disabled=false;}}
      };
    });
}
route(/^\/me\/groups$/, 'me', async el=>{
  const createRequested=new URLSearchParams(location.search).get('create')==='1';
  el.classList.add('groups-page');el.innerHTML=`<div class="top">${backBtn('Friends')}<h1>Groups</h1><button type="button" class="linkbtn" id="group-new">Create</button></div><div id="group-list"><div class="card empty">Loading your groups…</div></div>`;wireBack(el,'/me/friends');
  const live=()=>el.isConnected,create=()=>groupCreateSheet(group=>{go('/groups/'+encodeURIComponent(group.id),{replace:true});groupInviteSheet(group.invite_url);});
  $('#group-new',el).onclick=create;
  if(createRequested){const address=new URL(location.href);address.searchParams.delete('create');replacePageAddress(el,address.pathname+address.search+address.hash);create();}
  try{const groups=await api('/api/groups');if(!live())return;$('#group-list',el).innerHTML=groups.length?`<div class="card list">${groups.map(group=>`<a class="row-link group-list-row" href="/groups/${encodeURIComponent(group.id)}"><span class="ri">${svg('calendar')}</span><span class="grow"><b>${esc(group.title)}</b><small>${group.event_date?`${esc(groupDate(group.event_date,group.time_zone))} · `:'All time · '}${group.member_count} ${group.member_count===1?'member':'members'}</small></span>${svg('chev')}</a>`).join('')}</div>`:`<div class="group-empty"><p>Groups are private places to work toward a shared goal.</p><button type="button" class="primary" id="group-empty-create">Create a group</button></div>`;
    $('#group-empty-create',el)?.addEventListener('click',create);
  }catch(error){if(live())$('#group-list',el).innerHTML=`<div class="card empty">${esc(error.message)}<button type="button" class="ghost" id="group-retry">Retry</button></div>`;$('#group-retry',el)?.addEventListener('click',()=>go('/me/groups',{replace:true}));}
});
function groupRoster(group,expanded){
  const members=expanded?group.members:group.members.slice(0,10),rows=members.map(member=>`<div class="group-member"><span class="group-member-avatar" aria-hidden="true">${esc((member.username||'?').slice(0,1).toUpperCase())}</span><span class="group-member-name"><b>@${esc(member.username)}</b>${member.organizer?'<small>Organizer</small>':''}</span>${member.value!==undefined?`<span class="group-member-value">${esc(groupAmount(member.value,group.goal_unit))}</span>`:''}</div>`).join('');
  return `${rows}${!expanded&&group.member_count>10?`<button type="button" class="group-more linkbtn" data-group-more>+ ${group.member_count-10} more</button>`:''}`;
}
function groupReactionCheers(groupId,updateId=null,removeMine=null){
  const path=updateId?`/api/groups/${encodeURIComponent(groupId)}/updates/${encodeURIComponent(updateId)}/reactions`:`/api/groups/${encodeURIComponent(groupId)}/weekly-reactions`;
  reactionPeopleSheet({load:()=>api(path),removeMine});
}
function groupRecapPicture(group){
  return (async()=>{
    await document.fonts.ready;const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
    const measure=canvas.getContext('2d'),p=ShareArt.palette(),titleLines=ShareArt.lines(measure,group.title,888,58);
    const amount=group.recap.total!==undefined?`Together: ${groupAmount(group.recap.total,group.goal_unit)}`:`You: ${groupAmount(group.recap.your_total,group.goal_unit)}`;
    const amountLines=ShareArt.lines(measure,amount,888,66),names=group.recap.participants.length?group.recap.participants.map(name=>'@'+name).join(' · '):'No one chose to appear by name.';
    const nameLines=ShareArt.lines(measure,names,888,28);
    const contentEnd=246+titleLines.length*72+142+112+amountLines.length*82+112+58+nameLines.length*42;
    const footer=Math.max(1260,contentEnd+80);canvas.height=footer+90;
    const g=canvas.getContext('2d'),gradient=g.createLinearGradient(0,0,1080,canvas.height);gradient.addColorStop(0,col('--share-action'));gradient.addColorStop(1,col('--share-brand'));
    g.fillStyle=gradient;g.fillRect(0,0,1080,canvas.height);g.fillStyle=p.bg;g.beginPath();g.roundRect(54,48,972,canvas.height-96,32);g.fill();
    ShareArt.text(g,'Group recap',96,150,34,{color:p.muted,max:888});let y=246;
    for(const line of titleLines){ShareArt.text(g,line,96,y,58,{color:p.text,max:888,weight:750});y+=72;}
    ShareArt.text(g,groupDate(group.recap.event_date,group.time_zone),96,y+18,32,{color:p.soft,max:888});y+=142;
    g.strokeStyle=p.line;g.lineWidth=2;g.beginPath();g.moveTo(96,y);g.lineTo(984,y);g.stroke();y+=112;
    for(const line of amountLines){ShareArt.text(g,line,96,y,66,{color:p.text,max:888,weight:800});y+=82;}
    ShareArt.text(g,`${GROUP_GOALS[group.goal_type]||'Shared goal'} · Goal ${groupAmount(group.goal_target,group.goal_unit)}`,96,y,30,{color:p.soft,max:888});y+=112;
    ShareArt.text(g,'People who took part',96,y,32,{color:p.muted,max:888});y+=58;
    for(const line of nameLines){ShareArt.text(g,line,96,y,28,{color:p.text,max:888});y+=42;}
    g.strokeStyle=p.line;g.beginPath();g.moveTo(96,footer-30);g.lineTo(984,footer-30);g.stroke();drawMark(g,112,footer+27,42,p.blue);ShareArt.text(g,'Kinetta',154,footer+34,28,{color:p.text});ShareArt.text(g,'kinetta.app',984,footer+32,24,{color:p.muted,align:'right'});
    return ShareArt.blob(canvas);
  })();
}
function openGroupRecapShare(box,group){
  const owner=readOwner();sheet('Share event recap',`<div class="weekly-recap-share-stage"><img data-group-recap-image alt="Group event recap picture" hidden></div><p class="small muted" data-group-recap-status role="status">Preparing your picture…</p><button type="button" class="primary wide" data-group-recap-send disabled>Share</button>`,(body)=>{
    const live=()=>owner===readOwner()&&box.isConnected&&body.isConnected,image=$('[data-group-recap-image]',body),status=$('[data-group-recap-status]',body),button=$('[data-group-recap-send]',body);let picture=null;
    groupRecapPicture(group).then(blob=>{if(!live())return;picture=blob;image.alt=`Group recap for ${group.title}, ${groupDate(group.recap.event_date,group.time_zone)}. ${group.recap.total!==undefined?`Together: ${groupAmount(group.recap.total,group.goal_unit)}.`:`You: ${groupAmount(group.recap.your_total,group.goal_unit)}.`} ${group.recap.participants.length?`People who took part: ${group.recap.participants.map(n=>'@'+n).join(', ')}.`:'No one chose to appear by name.'}`;image.src=URL.createObjectURL(blob);image.hidden=false;status.textContent='Your group picture is ready.';button.disabled=false;}).catch(error=>{if(live())status.textContent=error.message||'Couldn’t make this picture.';});
    button.onclick=async()=>{if(!picture||button.disabled||!live())return;button.disabled=true;status.textContent='Opening share options…';try{await ShareArt.deliver(picture,`kinetta-group-recap-${group.recap.event_date}.png`,live);if(live())status.textContent='';}catch(error){if(live()){status.textContent=error.message||'Couldn’t share this picture.';button.disabled=false;}}};
  });
}
function groupRecapCard(group){
  if(!group.recap)return '';
  const recap=group.recap,value=recap.total!==undefined?`Together: ${groupAmount(recap.total,group.goal_unit)}`:`You: ${groupAmount(recap.your_total,group.goal_unit)}`;
  return `<section class="group-recap card" data-group-recap><div class="group-recap-head"><div><p class="eyebrow">Event recap</p><h2>${esc(groupDate(recap.event_date,group.time_zone))}</h2></div><button type="button" class="linkbtn" data-group-recap-share>Share</button></div><strong>${esc(value)}</strong><p class="group-recap-label">People who took part</p>${recap.participants.length?`<p class="group-recap-names">${recap.participants.map(name=>'@'+esc(name)).join(' · ')}</p>`:'<p class="group-recap-names">No one chose to appear by name.</p>'}</section>`;
}
function groupUpdateMarkup(group,update){
  const controls=update.can_delete||update.can_report?`<button type="button" class="icon-btn group-update-options" data-update-options="${update.id}" aria-label="Update options from @${esc(update.username)}">${svg('more')}</button>`:'';
  const author={login:update.username,name:update.name||update.username,photo:update.photo},badge=achievementBadgeMarkup(update.badge,'group-update-badge');
  return `<article class="group-update" data-group-update="${update.id}"><div class="post-hd group-update-head"><span class="post-av" aria-hidden="true">${avatar(author)}</span><div class="ph-txt"><b>@${esc(update.username)}</b><small>${esc(when(update.created))}</small></div>${controls}</div>${badge}<p>${esc(update.text)}</p>${reactionButtons(null,update,false,true,null,{id:group.id,updateId:update.id})}</article>`;
}
function groupUpdateMenu(group,update,reload){
  const opts=[];if(update.can_delete)opts.push('<button type="button" class="row-link danger" data-update-action="delete"><span>Delete update</span>'+svg('chev')+'</button>');
  if(update.can_report)opts.push('<button type="button" class="row-link" data-update-action="report"><span>Report update</span>'+svg('chev')+'</button>');
  groupActionSheet('Update options',`<div class="group-options-list">${opts.join('')}</div><button type="button" class="linkbtn wide" data-close>Cancel</button>`,(body,close)=>{
    $('[data-close]',body).onclick=close;$$('[data-update-action]',body).forEach(button=>button.onclick=()=>{close();
      if(button.dataset.updateAction==='delete')groupConfirm('Delete update?','This update and its cheers will be removed from the group.',async()=>{try{await api(`/api/groups/${encodeURIComponent(group.id)}/updates/${update.id}`,{method:'DELETE'});toast('Update deleted');reload();}catch(error){toast(error.message);}});
      else groupUpdateReport(group,update,reload);
    });
  });
}
function groupUpdateReport(group,update,reload){
  groupActionSheet('Report update',`<form class="form" id="group-update-report-form"><p class="small muted">The people who run this Kinetta see your report. Group members aren’t told who sent it.</p><div class="checks">${Object.entries(REPORT_WHY).map(([key,label])=>`<label class="check"><input type="radio" name="reason" value="${key}"> ${esc(label)}</label>`).join('')}</div><label>Anything else? (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label><button type="submit" class="primary wide">Send report</button><button type="button" class="linkbtn wide" data-close>Cancel</button></form>`,(body,close)=>{
    const form=$('#group-update-report-form',body);$('[data-close]',body).onclick=close;form.onsubmit=async event=>{event.preventDefault();const reason=form.elements.reason.value;if(!reason){toast('Choose a reason');return;}try{await api(`/api/groups/${encodeURIComponent(group.id)}/updates/${update.id}/report`,json('POST',{reason,note:form.elements.note.value}));close();toast('Report sent');reload();}catch(error){toast(error.message);}};
  });
}
function groupGoal(group){
  const combined=group.total!==undefined,value=Number(combined?group.total:group.your_total)||0,target=Number(group.goal_target)||0;
  const progressMax=target||1,progressValue=Math.min(progressMax,Math.max(0,value));
  const week=group.this_week_total!==undefined?`This week · +${groupNumber(group.this_week_total)} ${group.goal_unit} from ${group.this_week_contributors} of ${group.member_count} people`:`This week · You: ${groupAmount(group.your_this_week_total,group.goal_unit)}`;
  const weekHtml=group.this_week_total!==undefined||group.your_this_week_total!==undefined?`<small class="group-week">${esc(week)}</small>`:'';
  const weeklyCheer=group.event_state!=='complete'&&!group.closed?`<div class="group-week-cheer">${reactionButtons(null,group.weekly_reaction||{},false,true,null,{id:group.id})}</div>`:'';
  return `<section class="group-goal card" aria-label="Shared goal"><small>${esc(GROUP_GOALS[group.goal_type]||'Shared goal')}</small>${group.event_state==='ongoing'?'<small class="group-goal-period">All time</small>':''}<strong>${combined?'Together':'You'}: ${esc(groupAmount(value,group.goal_unit))} of ${esc(groupAmount(target,group.goal_unit))}</strong><progress class="group-progress" max="${progressMax}" value="${progressValue}" aria-label="${combined?'Group progress':'Your progress'}" aria-valuetext="${esc(groupAmount(value,group.goal_unit))} of ${esc(groupAmount(target,group.goal_unit))}"></progress>${weekHtml}${combined?'<small class="group-total-note">Your activity counts toward group totals.</small>':''}${weeklyCheer}${combined?'':'<small class="group-goal-hint">Group totals appear with 3 members</small>'}</section>`;
}
function groupPage(el,group){
  group={...group,event_state:group.event_state||(group.event_date==null?'ongoing':(group.days_to_event||0)===0?'today':'upcoming'),updates:group.updates||[],weekly_reaction:group.weekly_reaction||{my_reaction:null,reactions:{}}};
  let expanded=false;
  const reload=async()=>{invalidate('/api/groups/'+encodeURIComponent(group.id));try{const fresh=await api('/api/groups/'+encodeURIComponent(group.id));if(el.isConnected)groupPage(el,fresh);}catch(error){if(el.isConnected)toast(error.message);}};
  const draw=()=>{const weeks=group.weeks_to_event??Math.ceil(group.days_to_event/7),timing=group.event_state==='today'?"Today’s the day":group.event_state==='complete'?'Event complete':`${weeks} ${weeks===1?'week':'weeks'} to go`;
    const total=group.total!==undefined?`Together: ${groupAmount(group.total,group.goal_unit)}`:`You: ${groupAmount(group.your_total,group.goal_unit)}`;
    const summary=group.event_state==='ongoing'?`${GROUP_GOALS[group.goal_type]||'Shared goal'} · ${total}`:`${groupDate(group.event_date,group.time_zone)} · ${timing}`;
    el.innerHTML=`<div class="top group-top">${backBtn('Groups')}<span></span><button type="button" class="icon-btn" id="group-options" aria-label="Group options">${svg('more')}</button></div>
    <header class="group-title"><p class="eyebrow">Private group</p><h1>${esc(group.title)}</h1><p>${esc(summary)}</p>${group.note?`<p class="group-note">${esc(group.note)}</p>`:''}</header>
    ${groupGoal(group)}
    ${group.event_state==='today'?'<section class="group-event-day card">Today’s the day</section>':group.event_state==='complete'?groupRecapCard(group):''}
    <section class="group-roster card list"><h2>Members <span>${group.member_count}</span></h2>${group.members.some(member=>member.sharing_total_only)?'<p class="group-member-private-note">Some members keep their amount private</p>':''}<div id="group-members">${groupRoster(group,expanded)}</div></section>
    <section class="group-updates card" aria-label="Updates"><h2>Updates</h2><div class="group-update-list">${group.updates.length?group.updates.map(update=>groupUpdateMarkup(group,update)).join(''):'<p class="group-update-empty">No updates yet.</p>'}</div>${group.closed?'':'<form class="group-update-form"><label class="vh" for="group-update-text">Post an update</label><textarea id="group-update-text" name="text" maxlength="200" rows="2" placeholder="Share an update…" required></textarea><button type="submit" class="primary">Post an update</button><p class="group-update-status small muted" role="status"></p></form>'}</section>
    `;
    wireBack(el,'/me/groups');$('#group-options',el).onclick=()=>groupMenu(group,reload);$('[data-group-more]',el)?.addEventListener('click',()=>{expanded=true;draw();});
    $$('[data-group-reaction-group]',el).forEach(node=>wireReactionGroup(node,null));
    $$('[data-update-options]',el).forEach(button=>{const update=group.updates.find(item=>String(item.id)===button.dataset.updateOptions);if(update)button.onclick=()=>groupUpdateMenu(group,update,reload);});
    const share=$('[data-group-recap-share]',el);if(share)share.onclick=()=>openGroupRecapShare(el,group);
    const form=$('.group-update-form',el);if(form)form.onsubmit=async event=>{event.preventDefault();const text=form.elements.text.value.trim(),button=$('button[type=submit]',form),status=$('.group-update-status',form);if(!text||button.disabled)return;button.disabled=true;status.textContent='Posting…';try{await api(`/api/groups/${encodeURIComponent(group.id)}/updates`,json('POST',{text}));form.elements.text.value='';await reload();}catch(error){status.textContent=error.message;button.disabled=false;}};
  };
  draw();
}
function groupActionSheet(title,html,handler){sheet(title,html,handler);}
function groupMenu(group,reload){
  const opts=[];
  if(group.is_organizer&&!group.closed)opts.push('<button type="button" class="row-link" data-gact="event-date"><span>Edit event date</span>'+svg('chev')+'</button>');
  if(group.is_organizer&&!group.closed)opts.push(`<button type="button" class="row-link" data-gact="invite"><span>Invite people</span>${svg('chev')}</button>`,group.joining_closed?`<button type="button" class="row-link" data-gact="reopen"><span>Make a new invite</span>${svg('chev')}</button>`:`<button type="button" class="row-link" data-gact="stop"><span>Stop new members</span>${svg('chev')}</button>`);
  if(group.is_organizer&&group.member_count>1)opts.push(`<button type="button" class="row-link" data-gact="transfer"><span>Transfer organizer</span>${svg('chev')}</button>`,`<button type="button" class="row-link" data-gact="remove"><span>Remove a member</span>${svg('chev')}</button>`);
  if(group.is_organizer&&!group.closed)opts.push(`<button type="button" class="row-link danger" data-gact="close"><span>Close group</span>${svg('chev')}</button>`);
  if(group.event_date)opts.push(`<button type="button" class="row-link" data-gact="recap-consent"><span>${group.recap_consent?'Remove my name from the event recap':'Include my name in the event recap'}</span>${svg('chev')}</button>`);
  opts.push(`<button type="button" class="row-link" data-gact="notifications"><span>${group.notifications_muted?'Unmute group notifications':'Mute group notifications'}</span>${svg('chev')}</button>`,`<button type="button" class="row-link" data-gact="mute-strip"><span>Mute Activity strip</span>${svg('chev')}</button>`);
  opts.push(`<button type="button" class="row-link" data-gact="leave"><span>Leave group</span>${svg('chev')}</button>`,`<button type="button" class="row-link" data-gact="report"><span>Report group</span>${svg('chev')}</button>`);
  groupActionSheet('Group options',`<div class="group-options-list">${opts.join('')}</div><button type="button" class="linkbtn wide" data-close>Cancel</button>`,(body,close)=>{
    const run=async(path,method='POST',payload={})=>{try{await api(path,json(method,payload));close();toast('Group updated');reload();}catch(error){toast(error.message);}};
    $$('[data-gact]',body).forEach(button=>button.onclick=()=>{const action=button.dataset.gact;close();
      if(action==='invite'||action==='reopen')api('/api/groups/'+encodeURIComponent(group.id)+'/invites',json('POST',{})).then(r=>groupInviteSheet(r.invite_url)).catch(e=>toast(e.message));
      else if(action==='event-date')groupEventDateSheet(group,reload);
      else if(action==='stop')run('/api/groups/'+encodeURIComponent(group.id)+'/stop-joining');
      else if(action==='leave')groupConfirm('Leave group?','Your contribution will disappear from the group.',()=>run('/api/groups/'+encodeURIComponent(group.id)+'/leave'));
      else if(action==='close')groupConfirm('Close group?','People can no longer join this group.',()=>run('/api/groups/'+encodeURIComponent(group.id)+'/close'));
      else if(action==='transfer'||action==='remove')groupMemberAction(group,action==='transfer'?'Transfer organizer':'Remove a member',action==='transfer'?'transfer':'remove',reload);
      else if(action==='mute-strip')api('/api/groups/activity-strip',json('POST',{muted:true})).then(()=>toast('Activity strip hidden')).catch(error=>toast(error.message));
      else if(action==='notifications')run('/api/groups/'+encodeURIComponent(group.id)+'/notifications','POST',{muted:!group.notifications_muted});
      else if(action==='recap-consent')api('/api/groups/'+encodeURIComponent(group.id)+'/recap-consent',json('POST',{consent:!group.recap_consent})).then(()=>{toast(group.recap_consent?'Your name was removed from the recap':'Your name can appear in the recap');reload();}).catch(error=>toast(error.message));
      else if(action==='report')groupReport(group);
    });
    $('[data-close]',body).onclick=close;
  });
}
function groupConfirm(title,copy,yes){groupActionSheet(title,`<p>${esc(copy)}</p><div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="primary" data-yes>Continue</button></div>`,(body,close)=>{$('[data-close]',body).onclick=close;$('[data-yes]',body).onclick=()=>{close();yes();};});}
function groupMemberAction(group,title,action,reload){
  const members=group.members.filter(m=>!m.organizer),label=action==='transfer'?'Transfer organizer':'Remove member';
  groupActionSheet(title,`<div class="group-options-list">${members.map(m=>`<button type="button" class="row-link" data-member="${esc(m.username)}"><span>@${esc(m.username)}</span>${svg('chev')}</button>`).join('')}</div><button type="button" class="linkbtn wide" data-close>Cancel</button>`,(body,close)=>{
    $('[data-close]',body).onclick=close;$$('[data-member]',body).forEach(button=>button.onclick=()=>{const username=button.dataset.member;close();groupConfirm(`${label}?`,`@${username} will ${action==='transfer'?'become the organizer':'be removed from this group'}.`,async()=>{try{await api(`/api/groups/${encodeURIComponent(group.id)}/${action}`,json('POST',{username}));toast('Group updated');reload();}catch(error){toast(error.message);}});});
  });
}
function groupReport(group){
  groupActionSheet('Report group',`<form class="form" id="group-report-form"><p class="small muted">The people who run this Kinetta see your report. Group members aren’t told who sent it.</p><div class="checks">${Object.entries(REPORT_WHY).map(([key,label])=>`<label class="check"><input type="radio" name="reason" value="${key}"> ${esc(label)}</label>`).join('')}</div><label>Anything else? (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label><button type="submit" class="primary wide">Send report</button><button type="button" class="linkbtn wide" data-close>Cancel</button></form>`,(body,close)=>{
    const form=$('#group-report-form',body);$('[data-close]',body).onclick=close;form.onsubmit=async event=>{event.preventDefault();const reason=form.elements.reason.value;if(!reason){toast('Choose a reason');return;}try{await api('/api/groups/'+encodeURIComponent(group.id)+'/report',json('POST',{reason,note:form.elements.note.value}));close();toast('Report sent');}catch(error){toast(error.message);}};
  });
}
route(/^\/groups\/([0-9a-f-]{36})$/i,'activity',async(el,id)=>{
  el.classList.add('group-page');el._backFallback='/me/groups';el.innerHTML='<div class="card empty">Loading group…</div>';
  try{const group=await api('/api/groups/'+encodeURIComponent(id));if(el.isConnected)groupPage(el,group);}
  catch(error){if(el.isConnected)showError(el,error);}
});
route(/^\/group-invite\/([\w-]+)$/,'activity',async(el,token)=>{
  el.classList.add('group-invite-page');el.innerHTML='<div class="card empty">Checking invite…</div>';wireBack(el,'/activity');
  try{await api('/api/group-invites/'+encodeURIComponent(token));if(!el.isConnected)return;el.innerHTML=`<div class="top">${backBtn('Home')}</div><section class="group-invite-card"><p class="eyebrow">Kinetta Groups</p><h1>You’re invited to a private group</h1><p>Only members can see the group. Sign in and accept to join.</p><div class="btncol"><button type="button" class="primary" id="group-accept">Accept invitation</button><a class="ghost" href="/activity">Not now</a></div></section>`;wireBack(el,'/activity');$('#group-accept',el).onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const group=await api('/api/group-invites/'+encodeURIComponent(token)+'/accept',json('POST',{}));if(el.isConnected){toast('You joined the group');go('/groups/'+encodeURIComponent(group.id),{replace:true});}}catch(error){toast(error.message);button.disabled=false;}};}
  catch(error){if(!el.isConnected)return;if([403,404].includes(error.status)){el.innerHTML=`<div class="top">${backBtn('Home')}</div><section class="group-invite-card"><h1>This invite isn’t available</h1><p>Ask the organizer for a new group invite.</p><a class="ghost" href="/activity">Go to Home</a></section>`;wireBack(el,'/activity');}else showError(el,error);}
});

// ---------- report or block someone (App Store guideline 1.2): from their activity or one of their comments ----------
const REPORT_WHY = {spam: 'Spam', abuse: 'Harassment or abuse', inappropriate: 'Inappropriate', other: 'Something else'};
function reportSheet(p, what = {}, onBlocked) {
  let why = null, pending = false; const owner = readOwner();
  sheet(`${p.name}`, `<form class="form" id="rp-form"><h3 class="ghead">Report ${what.comment_id ? 'this comment' : what.activity_id ? 'this activity' : what.dish_id ? 'this recipe' : what.challenge_code ? 'this challenge' : 'this person'}</h3>
    <div class="checks">${Object.entries(REPORT_WHY).map(([k, n]) => `<label class="check"><input type="radio" name="why" value="${k}"> ${esc(n)}</label>`).join('')}</div>
    <label>Anything else? (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label>
    <p class="small muted">The people who run this Kinetta see your report and what was reported. ${esc(p.name)} isn't told who reported it.</p>
    <div class="actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Send report</button></div>
    <h3 class="ghead">Block ${esc(p.name)}</h3>
    <p class="small muted">You stop being friends, they can't see your activities, find you or ask to be friends, and you won't see their activities, cheers or comments. They aren't told. Undo it under Me › Sharing.</p>
    <button type="button" class="ghost wide danger" id="rp-block">Block ${esc(p.name)}</button></form>`, (b, close) => {
    const f = $('#rp-form', b), send = $('button.primary', f), block = $('#rp-block', b);
    const live = () => owner === readOwner() && b.isConnected && !b.closest('.scrim')?.classList.contains('is-closing');
    f.onchange = () => { why = (f.querySelector('input[name=why]:checked') || {}).value || null; };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (pending || !live()) return;
      if (!why) { toast('Choose what is wrong'); return; }
      pending = true; send.disabled = true; block.disabled = true;
      try { await api('/api/reports', json('POST', {login: p.login, reason: why, note: f.note.value.trim() || null, ...what})); if (live()) { close(); toast('Thanks. Your report was sent'); } }
      catch (x) { if (live()) toast(x.message); }
      finally { pending = false; if (live()) { send.disabled = false; block.disabled = false; } }
    };
    block.onclick=()=>{if(pending||!live())return;close();friendChangeSheet(p,true,()=>{if(onBlocked)onBlocked();else go('/activity',{replace:true});});};
  });
}

// ---------- Me > Sharing: the usual choices for new activities ----------
route(/^\/me\/sharing$/, 'me', async (el) => {
  el.classList.add('sharing-settings');
  el.innerHTML = `<div class="top">${backBtn('Settings')}</div><h1>Sharing &amp; privacy</h1><div id="sh-body">${skel(2)}</div>`;
  wireBack(el, '/me/settings');
  const sharingOwner=readOwner(),[s,contacts] = await Promise.all([api('/api/sharing'),api('/api/contacts/settings')]), box = $('#sh-body', el);
  if(!el.isConnected)return;
  box.innerHTML = `<p class="small muted" id="sharing-default-disclosure">New accounts share activities and achievements with everyone signed in. You can change this here any time.</p>
    <div class="card"><h2>Who sees new activities</h2>${visSeg(s.default)}
      <p class="small muted">Applies to new activities. Older activities keep their audience; you can change it for each workout.</p></div>
    <div class="card"><h2>What others see</h2><form class="sharing-switches" id="sh-d">${Object.entries(DETAIL_NAMES).map(([key,name])=>`<label class="switch-row"><span>${esc(name)}</span><input type="checkbox" role="switch" name="${key}"${s.details[key]?' checked':''}></label>`).join('')}</form>
      <p class="small muted">Distance, time and type are always shown to that audience. Splits and laps need pace. Private notes and Kit notes are never shared.</p></div>
    <div class="card" id="sh-achievements-card"><label class="switch-row"><span>Share achievements</span><input type="checkbox" role="switch" id="sh-achievements" aria-describedby="sh-achievements-help"${s.share_achievements?' checked':''}></label>
      <p class="small muted" id="sh-achievements-help">When sharing is on, everyone signed in can see your achievements and the ones you feature.</p></div>
    <div class="card"><h2>Friend search</h2><label class="check"><input type="checkbox" id="sh-find"${s.findable ? ' checked' : ''}> Let people find me by name</label>
      <p class="small muted">Off: you don't show up when people on this Kinetta search for friends. Friends you already have, and anyone who types your exact username, can still find you.</p></div>
    <div class="card" id="sh-contact-discovery"><h2>How people can find you</h2>
      <div class="sharing-switches"><label class="switch-row"><span>Let people who have my email find me</span><input type="checkbox" role="switch" id="sh-find-email"${contacts.find_by_email?' checked':''}></label>
        <label class="switch-row"><span>Let people who have my phone number find me</span><input type="checkbox" role="switch" id="sh-find-phone"${contacts.find_by_phone?' checked':''}></label></div>
      <p class="small muted">People with your email or phone in their contacts can find your Kinetta account. Your phone is never shown on your profile.</p>
      <p class="small muted">${contacts.email_ready?'Your confirmed email is ready for matching.':'Confirm an email in Settings → Account to be found by email.'}</p>
      <form id="sh-contact-phone"><label class="form">Phone number<input type="tel" name="phone_e164" autocomplete="tel" inputmode="tel" maxlength="40" placeholder="+1 555 010 1234" value="${esc(contacts.phone_e164||'')}"></label>
        <p class="small muted">Optional. Not verified. Enter the country code; this number is used only to help people find you.</p>
        <button type="submit" class="ghost" id="sh-phone-save" disabled>Save phone number</button><p class="small muted" id="sh-contact-status" role="status" aria-live="polite"></p></form></div>
    <div class="card"><h2>Hide the start and end of your route</h2>
      <div class="seg wide trim4" role="group" aria-label="Hide the start and end">${s.trims.map((m) => `<button type="button" data-trim="${m}" aria-pressed="${m === s.trim_m}">${esc(trimName(m))}</button>`).join('')}</div>
      <p class="small muted">Shared maps leave out this much at the start and at the end, so others can't see where you live. A route too short for that is shared without a map.</p></div>
    ${appFeatureEnabled('progress_segments') ? '<div id="sh-segments"></div>' : ''}
    <div class="card list" id="sh-blocked"><h2>Blocked people</h2><p class="small muted">Loading…</p></div>`;
  ContactsUI.addPrivacyRemoval(box);
  if (appFeatureEnabled('progress_segments') && typeof Segments !== 'undefined' && $('#sh-segments', box)) Segments.settingsRow($('#sh-segments', box));
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
    const controls=$$('button[data-vis],button[data-trim],#sh-d input,#sh-find,#sh-achievements',box);controls.forEach(b=>b.disabled=true);
    try {
      await api('/api/sharing',json('PUT',body));if(sharingOwner!==readOwner())return;
      if(body.default){s.default=body.default;App.me.share_default=body.default;keep('/api/me',App.me);}
      if(body.trim_m!==undefined)s.trim_m=body.trim_m;
      if(body.details)s.details=body.details;
      if(body.share_achievements!==undefined)s.share_achievements=body.share_achievements;
      invalidate('/api/');if(box.isConnected)toast(msg);
    }catch(x){
      if(sharingOwner===readOwner()&&box.isConnected){
        $$('[data-vis]',box).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.vis===s.default)));
        $$('[data-trim]',box).forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.trim===s.trim_m)));
        $$('input',f).forEach(b=>b.checked=!!s.details[b.name]);$('#sh-achievements',box).checked=!!s.share_achievements;toast(x.message);
      }
    }finally{if(sharingOwner===readOwner()&&box.isConnected)controls.forEach(b=>b.disabled=false);}
  };
  wireSeg(box, 'vis', (v) => save({default: v}, `New activities: ${VIS[v].toLowerCase()}`));
  wireSeg(box, 'trim', (m) => save({trim_m: +m}, m === '0' ? 'Maps show the whole route' : `Maps hide the first and last ${trimName(+m)}`));
  const f = $('#sh-d', box); f.onchange = () => save({details: readChecks(f)}, 'Saved');
  $('#sh-achievements',box).onchange=e=>save({share_achievements:e.target.checked},'Saved');
  $('#sh-find', box).onchange = async (e) => {
    if(sharingOwner!==readOwner()||!box.isConnected)return;
    const on = e.target.checked;
    try { await api('/api/sharing', json('PUT', {findable: on})); toast(on ? 'People can find you by name' : "You're hidden from friend search"); }
    catch (x) { e.target.checked = !on; toast(x.message); }
  };
  for(const [field,id] of [['find_by_email','sh-find-email'],['find_by_phone','sh-find-phone']]){
    const input=$('#'+id,box);
    input.onchange=async()=>{
      if(sharingOwner!==readOwner()||!box.isConnected)return;
      const on=input.checked;input.disabled=true;
      try{
        const updated=await api('/api/contacts/settings',json('PUT',{[field]:on}));
        if(sharingOwner!==readOwner()||!box.isConnected)return;
        contacts[field]=updated[field];toast(on?'People can find you this way':"People can't find you this way");
      }catch(x){if(sharingOwner===readOwner()&&box.isConnected){input.checked=!on;toast(x.message);}}
      finally{if(sharingOwner===readOwner()&&box.isConnected)input.disabled=false;}
    };
  }
  const phoneForm=$('#sh-contact-phone',box),phoneInput=phoneForm.elements.phone_e164,phoneSave=$('#sh-phone-save',box),phoneStatus=$('#sh-contact-status',box);
  const updatePhoneButton=()=>{phoneSave.disabled=sharingOwner!==readOwner()||phoneInput.value.trim()===(contacts.phone_e164||'');};
  phoneInput.oninput=updatePhoneButton;
  phoneForm.onsubmit=async e=>{
    e.preventDefault();if(sharingOwner!==readOwner()||!box.isConnected||phoneSave.disabled)return;
    phoneSave.disabled=true;phoneStatus.textContent='';
    try{
      const updated=await api('/api/contacts/settings',json('PUT',{phone_e164:phoneInput.value.trim()||null}));
      if(sharingOwner!==readOwner()||!box.isConnected)return;
      contacts.phone_e164=updated.phone_e164;phoneInput.value=updated.phone_e164||'';
      phoneStatus.textContent=contacts.phone_e164?'Phone number saved.':'Phone number removed.';
    }catch(x){if(sharingOwner===readOwner()&&box.isConnected)phoneStatus.textContent=x.message;}
    finally{if(sharingOwner===readOwner()&&box.isConnected)updatePhoneButton();}
  };
});
