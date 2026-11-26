// ---------- Notifications (2026-10-11, notify.py) ----------
// 2026-10-12 (Ben): the bell shows only your notifications; phone-notification settings live in Me > Settings
// (/me/notifications). The inbox follows its entry tab, without becoming that tab’s saved root.
const PUSH_NAMES = {friends: 'Friend requests', cheers: 'Cheers & reactions', comments: 'Comments', dishes: 'Shared meals', activities: 'New workouts', milestones:'Milestones (at most one a day)',challenge_joins:'Someone joins your challenge',challenge_reminders:'Challenge reminders',challenge_finished:'Challenge finish pictures'};
const NOTE_ICON = {challenge_reminder:'trophy',challenge_join:'trophy',challenge_finished:'trophy',milestone:'trophy',friend_request: 'people', friend_accepted: 'people', group_invite:'people', cheer: 'cheer', group_update:'people', group_cheer:'cheer', group_monday_recap:'calendar', comment: 'comment', dish_shared: 'pot', activity_ready: 'check', streak_reminder:'check', report: 'lock', monthly_summary:'calendar'};
// Inbox copy is separate from push wording; old servers retain their original text.
function noteRow(n) {
  const name = n.who && n.who.name, text = String(n.compact_text || n.text || '') + (n.detail ? ' · '+n.detail : '');
  const leading = name && text.startsWith(name);
  const summary = n.kind === 'monthly_summary' && ['month','year'].includes(n.period_type) &&
    (n.period_type === 'month' ? /^\d{4}-\d{2}$/.test(n.period) : /^\d{4}$/.test(n.period));
  const summaryAttrs = summary ? ` data-summary-type="${n.period_type}" data-summary-period="${esc(n.period)}"` : '';
  return `<a class="note${n.read ? '' : ' unread'}"${summaryAttrs} href="${esc(n.link)}" aria-label="${esc(text)}${n.read ? '' : '. New'}. ${esc(noteAgo(n.created))}">
    <span class="note-av">${avatar(n.who)}<span class="note-k" data-kind="${esc(n.kind)}">${svg(NOTE_ICON[n.kind] || 'people')}</span></span>
    <span class="grow"><span class="note-t">${leading ? `<b>${esc(name)}</b>${esc(text.slice(name.length))}` : esc(text)}</span><small class="note-time">${esc(noteAgo(n.created))}</small></span></a>`;
}
// Same target, reaction, local date and read state only. The source count/read API stays unchanged.
function groupNotificationReactions(items) {
  const groups=new Map(),result=[];
  for(const item of items){
    if(item.kind!=='cheer'||!item.reaction_kind||!item.activity||!item.who?.login||!(item.compact_text||item.text||'').includes(' reacted ')){result.push(item);continue;}
    const key=JSON.stringify([item.link,item.reaction_kind,notificationDayKey(item.created),!!item.read]);
    const group=groups.get(key);
    if(!group){const row={...item};groups.set(key,{row,actors:new Set([item.who.login])});result.push(row);continue;}
    group.actors.add(item.who.login);
    const others=group.actors.size-1;
    if(others){
      const first=group.row, prefix=first.compact_text||first.text;
      const action=prefix.slice(prefix.indexOf(' reacted '));
      // Only use the server's checked reaction wording; no parsing of arbitrary notices.
      if(prefix.includes(' reacted '))first.compact_text=`${first.who.name} and ${others} other${others===1?'':'s'}${action}`;
    }
  }
  return result;
}
function summaryOffset(type, period) {
  if (!App.me?.tz || !Recaps) return null;
  const current = Recaps.today(App.me.tz);
  if (type === 'month') {
    if (!/^\d{4}-\d{2}$/.test(period)) return null;
    return Math.max(0, Number(current.slice(0,4))*12 + Number(current.slice(5,7)) - Number(period.slice(0,4))*12 - Number(period.slice(5,7)));
  }
  if (type === 'year' && /^\d{4}$/.test(period)) return Math.max(0, Number(current.slice(0,4)) - Number(period));
  return null;
}
function openSummary(type, period) {
  const offset = summaryOffset(type, period);
  if (offset === null) return;
  if (offset > 24) { go('/progress'); Recaps.open(); return; }
  Recaps.open({period:type,offset});
}
function noteAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  if (min < 12 * 60) return `${Math.round(min / 60)} hr ago`;
  if (min < 36 * 60) return 'Yesterday';
  if (min < 48 * 60) return '1 day ago';
  return new Date(iso).toLocaleDateString([], {month:'short',day:'numeric',timeZone:App.me?.tz||undefined});
}
function notificationDayKey(value) {
  const date=value instanceof Date?value:new Date(value), zone=App.me?.tz||Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{return date.toLocaleDateString('en-CA',{timeZone:zone});}catch{return date.toLocaleDateString('en-CA');}
}
function notificationDayGroups(items) {
  const today=notificationDayKey(new Date());
  return {today:items.filter(item=>notificationDayKey(item.created)===today),earlier:items.filter(item=>notificationDayKey(item.created)!==today)};
}
route(/^\/notifications$/, notificationEntryTab, async (el) => {
  el.classList.add('notification-center');
  const loadingRows=Array.from({length:3},()=>`<div class="note-loading" aria-hidden="true"><span class="sk note-loading-avatar"></span><span class="note-loading-copy"><span class="sk note-loading-line"></span><span class="sk note-loading-line note-loading-detail"></span></span></div>`).join('');
  el.innerHTML = `<div class="top">${backBtn('Home')}</div><h1>Notifications</h1><div id="nt-list"><div class="notification-loading" role="status" aria-busy="true"><span class="vh">Loading notifications…</span><div class="notes notification-loading-card" aria-hidden="true">${loadingRows}</div></div></div>`;
  wireBack(el, '/activity');
  await load('/api/notifications', (r) => {
    const list = $('#nt-list', el); if (!list) return;
    const group = (title, items) => items.length ? `<section class="notes-group">${title ? `<h2 class="notes-h">${title}</h2>` : ''}<div class="notes">${items.map(noteRow).join('')}</div></section>` : '';
    const days=notificationDayGroups(groupNotificationReactions(r.items));
    list.innerHTML = r.items.length ? group('Today',days.today) + group('Earlier',days.earlier)
      : `<p class="notifications-caught-up">You're all caught up</p>`;
    $$('[data-summary-period]',list).forEach(link=>link.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();openSummary(link.dataset.summaryType,link.dataset.summaryPeriod);
    }));
    const query=new URLSearchParams(location.search),month=query.get('summary'),year=query.get('year');
    if(month&&/^\d{4}-\d{2}$/.test(month))openSummary('month',month);
    else if(year&&/^\d{4}$/.test(year))openSummary('year',year);
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    if (r.unread) api('/api/notifications/read', json('POST', {})).then(() => { App.me.notifications = 0; Social.badge(); invalidate('/api/notifications'); }).catch(() => {});
  }, {maxAge: 0});
});
route(/^\/me\/notifications$/, 'me', async (el) => {
  const owner=readOwner(),active=()=>el.isConnected&&owner===readOwner();
  el.classList.add('notification-settings');
  el.innerHTML = `<div class="top">${backBtn('Settings')}</div><h1>Notifications</h1><div id="nt-push">${skel(1)}</div><div id="nt-personal"></div><div id="nt-email"></div>`;
  wireBack(el, '/me/settings');
  // Email when your account is signed in to from a new device (#232 I); only with a confirmed email.
  if (App.me.email && App.me.email_confirmed) api('/api/account/signin-email').then((r) => {
    const box = $('#nt-email', el); if (!box || !active()) return;
    box.innerHTML = `<div class="card"><h2>Email</h2><label class="switch-row"><span>New sign-in emails<small>When a new phone or browser signs in.</small></span><input type="checkbox" role="switch" id="nt-signin"${r.on ? ' checked' : ''}></label><p class="small muted">Sent to ${esc(App.me.email)}.</p></div>`;
    const box2 = $('#nt-signin', box);
    box2.onchange = async () => {
      if (!active() || box2.disabled) return;
      box2.disabled = true;
      try { await api('/api/account/signin-email', json('PUT', {on: box2.checked})); if (!active() || !box2.isConnected) return; toast(box2.checked ? 'Sign-in emails on' : 'Sign-in emails off'); }
      catch (x) { if (!active() || !box2.isConnected) return; box2.checked = !box2.checked; toast(x.message); }
      if (active() && box2.isConnected) box2.disabled = false;
    };
  }).catch(() => {});
  await load('/api/notifications', (r) => {
    const box = $('#nt-push', el); if (!box) return;
    pushCard(box, r);
  }, {maxAge: 0});
});
async function pushCard(box, r, message='') {
  if (!box) return;
  const account=readOwner();
  if(box.pushSaving===account){box.pushRefresh=true;return;}
  const generation=Symbol();box.pushGeneration=generation;
  const valid=()=>box.isConnected&&account===readOwner()&&box.pushGeneration===generation;
  if(!valid())return;
  personalNotificationCard($('#nt-personal',box.parentElement), '', r.push);
  const render=(content,kinds='')=>{
    if(!valid())return;
    box.innerHTML=`<section class="card"><h2>iPhone notifications</h2>${content}</section>${kinds}`;
  };
  const hints={friends:'Requests and friendship updates.',cheers:'Reactions to your activities.',comments:'Replies to your activities.',dishes:'Meals shared with you.',activities:'When a watch or Health workout is ready.',milestones:'A new milestone, at most once a day.',challenge_joins:'When someone joins a challenge you host.',challenge_reminders:'A reminder while your challenge is active.',challenge_finished:'When a challenge finish picture is ready.'};
  const alertTypes=()=>{
    const rows=keys=>keys.map(k=>`<label class="switch-row"><span>${esc(k==='milestones'?'Milestones':PUSH_NAMES[k])}<small>${esc(hints[k])}</small></span><input type="checkbox" role="switch" name="${k}"${r.push?.[k]?' checked':''}></label>`).join('');
    return `<section class="card notification-alerts"><h2>Alerts</h2><div id="np-kinds"><h3>Social</h3><div class="notification-choices">${rows(['friends','cheers','comments','dishes'])}</div><h3>Reminders</h3><div class="notification-choices">${rows(['activities','milestones','challenge_joins','challenge_reminders','challenge_finished'])}</div></div></section>`;
  };
  if (!Native.on) {
    render('<p class="small muted">Managed in the iPhone app.</p>');return;
  }
  let status, statusError='';
  if(!Native.pushSupported)statusError='Update Kinetta in TestFlight to enable phone alerts.';
  else try { status=await Native.pushStatus(); } catch(error) { statusError=error.message||'iPhone notification status is unavailable.'; }
  if(!valid())return;
  // Saved notification types do not depend on this phone's permission or registration.
  render(`${!r.push_ready?'<p class="small muted">Server notification setup is not complete; the bell still works.</p>':''}
    ${statusError?`<p class="err" role="alert">${esc(statusError)}</p>${Native.pushSupported?'<div class="notification-phone-action"><button class="ghost sm" id="np-retry">Retry</button></div>':''}`
      :status.enabled?'<p class="small muted">Manage alerts for this iPhone in Settings.</p><div class="notification-phone-action"><button type="button" class="ghost sm" id="np-settings">Open iPhone Settings</button></div>'
      :status.denied?'<p class="small muted">Allow Kinetta notifications in iPhone Settings.</p><div class="notification-phone-action"><button type="button" class="primary sm" id="np-settings">Open iPhone Settings</button></div>'
      :'<p class="small muted">Get alerts for the notification types you choose.</p><div class="notification-phone-action"><button class="primary sm" id="np-on">Turn on iPhone notifications</button></div>'}
    <p class="err" role="alert" id="np-error">${esc(message)}</p>`,alertTypes());
  const error=$('#np-error',box),on=$('#np-on',box),settings=$('#np-settings',box),retry=$('#np-retry',box);
  if(retry)retry.onclick=()=>{if(valid())pushCard(box,r);};
  if(settings)settings.onclick=async()=>{if(!valid()||settings.disabled)return;settings.disabled=true;try{await Native.openPushSettings({enable:!!status.denied});}catch(x){if(valid())error.textContent=x.message;}finally{if(valid())settings.disabled=false;}};
  const phoneAction=(button,run)=>{
    if(!button)return;button.onclick=async()=>{
      if(!valid()||button.disabled)return;button.disabled=true;error.textContent='';
      try{await run();if(valid())await pushCard(box,r);}
      catch(x){if(valid()){error.textContent=x.message;button.disabled=false;}}
    };
  };
  phoneAction(on,()=>Native.enablePush());
  const controls=$('#np-kinds',box);
  if(controls)controls.onchange=async event=>{
    const input=event.target,k=input.name,v=input.checked;
    if(!valid()||input.disabled||!Object.hasOwn(PUSH_NAMES,k))return;
    box.pushSaving=account;error.textContent='';$$('input',controls).forEach(field=>field.disabled=true);let failure='';
    try{const fresh=await api('/api/notifications/settings',json('PUT',{[k]:v}));if(valid()){r.push=fresh.push;invalidate('/api/notifications');}}
    catch(x){failure=x.message;if(valid()){input.checked=!v;error.textContent=failure;}}
    finally{
      if(box.pushSaving===account)box.pushSaving=null;
      if(valid()){
        $$('input',controls).forEach(field=>field.disabled=false);
        if(box.pushRefresh){box.pushRefresh=false;await pushCard(box,r,failure);}
      }
    }
  };
}

async function personalNotificationCard(box,message='',pushPreferences=null){
  if(!box)return;
  if(pushPreferences){box.personalPushSource=pushPreferences;box.personalPush={...pushPreferences};}
  else if(!box.personalPush)box.personalPush={};
  const owner=readOwner();
  // A native permission refresh must not replace controls during their pending write.
  if(box.personalSaving===owner){box.personalRefresh=true;return;}
  const generation=Symbol();box.personalGeneration=generation;
  const valid=()=>box.isConnected&&owner===readOwner()&&box.personalGeneration===generation;
  const times=[['07:00','7 am'],['08:00','8 am'],['12:00','Noon'],['18:00','6 pm'],['20:00','8 pm']];
  const draw=(state,error=message)=>{
    if(!valid())return;
    const unavailable=!state.push_ready||!state.device_ready;
    const monthlySummary=box.personalPush.monthly_summary!==false;
    const web=!Native.on,expanded=(box.querySelector?.('details.personal-notifications')?.open??box.personalExpanded)===true;
    const savedRows=keys=>keys.map(k=>`<div class="switch-row saved-alert-row" data-saved-alert="${k}"><span>${esc(k==='milestones'?'Milestones':PUSH_NAMES[k])}</span><span class="muted">${box.personalPush[k]===true?'On':box.personalPush[k]===false?'Off':'Not set'}</span></div>`).join('');
    const phoneSetup=unavailable?`<p class="small muted">${!state.push_ready?'Server notification setup is not complete.':web?'For iPhone alerts, turn on notifications in the Kinetta iPhone app.':'Turn on iPhone notifications above.'}</p>`:'';
    box.innerHTML=`<${web?'details':'section'} class="card personal-notifications${web?' chev-row':''}"${web&&expanded?' open':''}>${web?`<summary>Saved alert preferences</summary><h2>iPhone alerts</h2><p class="small muted">Change Social and Reminders in the iPhone app.</p><h3>Social</h3>${savedRows(['friends','cheers','comments','dishes'])}<h3>Reminders</h3>${savedRows(['activities','milestones','challenge_joins','challenge_reminders','challenge_finished'])}`:''}<h2>Training & progress</h2><p class="small muted">${web?'iPhone alerts':'Planned workouts, weekly summaries and streak reminders are off by default'} · ${esc(state.tz)}</p>
      <div class="notification-choices"><div class="personal-notice-choice"><label class="switch-row"><span>Planned workouts<small>Only when a workout is still due.</small></span><input type="checkbox" role="switch" data-personal="plan"${state.plan?' checked':''}${unavailable&&!state.plan?' disabled':''}></label>
      ${state.plan?`<label class="personal-notice-time">Reminder time<select data-personal="plan_time">${times.map(([k,v])=>`<option value="${k}"${state.plan_time===k?' selected':''}>${v}</option>`).join('')}</select></label>`:''}</div>
      <div class="personal-notice-choice"><label class="switch-row"><span>Weekly summary<small>Monday at 9 am.</small></span><input type="checkbox" role="switch" data-personal="weekly"${state.weekly?' checked':''}${unavailable&&!state.weekly?' disabled':''}></label></div>
      <div class="personal-notice-choice"><label class="switch-row"><span>Monthly summary<small>On the first of the month at 9 am.</small></span><input type="checkbox" role="switch" data-monthly-summary${monthlySummary?' checked':''}${web&&unavailable&&!monthlySummary?' disabled':''}></label></div>
      ${web?`</div>${phoneSetup}<h2>Bell reminder</h2><p class="small muted">Available on the web and iPhone.</p><div class="notification-choices">`:''}<div class="personal-notice-choice"><label class="switch-row"><span>Streak reminder<small>Friday at 6 pm · only if you have not logged a workout this week.</small></span><input type="checkbox" role="switch" data-personal="streak"${state.streak?' checked':''}></label></div></div>
      ${web?'':phoneSetup}
      ${state.plan||state.weekly||state.streak?'<p class="settings-footnote">Weekly summaries need a recent activity or food log. iPhone alerts may be delayed.</p>':''}
      <p class="small${error?' err':''}" role="status" data-personal-status>${esc(error)}</p></${web?'details':'section'}>`;
    const disclosure=box.querySelector?.('details.personal-notifications');
    if(disclosure)disclosure.ontoggle=()=>{if(valid()&&disclosure.isConnected)box.personalExpanded=disclosure.open;};
    $$('[data-personal]',box).forEach(input=>input.onchange=async()=>{
      if(!valid()||input.disabled)return;
      const key=input.dataset.personal,value=input.type==='checkbox'?input.checked:input.value;
      const focused=globalThis.document?.activeElement===input;
      const restoreFocus=()=>{const field=$(`[data-personal="${key}"]`,box);if(focused&&field&&!field.disabled)field.focus({preventScroll:true});};
      let failure='';
      box.personalSaving=owner;
      $$('[data-personal],[data-monthly-summary]',box).forEach(field=>field.disabled=true);
      $('[data-personal-status]',box).textContent='Saving…';
      try{
        const fresh=await api('/api/notifications/personal',json('PUT',{[key]:value,confirmed:value===true}));
        if(!valid())return;draw(fresh,'');restoreFocus();Native.haptic('light');
      }catch(error){failure=error.message||'This setting could not be saved.';if(valid()){draw(state,failure);restoreFocus();}}
      finally{
        if(box.personalSaving===owner)box.personalSaving=null;
        if(valid()&&box.personalRefresh){box.personalRefresh=false;await personalNotificationCard(box,failure,box.personalPush);}
      }
    });
    const summaryInput=$('[data-monthly-summary]',box);
    summaryInput.onchange=async()=>{
      if(!valid()||summaryInput.disabled)return;
      const enabled=summaryInput.checked,focused=globalThis.document?.activeElement===summaryInput;
      const restoreFocus=()=>{const field=$('[data-monthly-summary]',box);if(focused&&field&&!field.disabled)field.focus({preventScroll:true});};
      let failure='';box.personalSaving=owner;
      const controls=$$('[data-personal],[data-monthly-summary]',box).map(field=>[field,field.disabled]);
      const restoreControls=()=>controls.forEach(([field,disabled])=>{if(field.isConnected)field.disabled=disabled;});
      const status=$('[data-personal-status]',box);
      controls.forEach(([field])=>{field.disabled=true;});
      if(status){status.textContent='Saving…';status.classList.remove('err');}
      try{
        const fresh=await api('/api/notifications/settings',json('PUT',{monthly_summary:enabled}));
        if(!valid())return;box.personalPush={...(fresh.push||box.personalPush),monthly_summary:enabled};
        if(box.personalPushSource)box.personalPushSource.monthly_summary=enabled;
        if(status){status.textContent='';status.classList.remove('err');}
        summaryInput.checked=enabled;restoreControls();
        invalidate('/api/notifications');restoreFocus();Native.haptic('light');
      }catch(error){failure=error.message||'This setting could not be saved.';if(valid()){
        box.personalPush={...box.personalPush,monthly_summary:!enabled};summaryInput.checked=!enabled;
        if(status){status.textContent=failure;status.classList.add('err');}
        restoreControls();restoreFocus();
      }}
      finally{
        if(box.personalSaving===owner)box.personalSaving=null;
        if(valid()&&box.personalRefresh){box.personalRefresh=false;await personalNotificationCard(box,failure,box.personalPush);}
      }
    };
  };
  const loadSettings=async()=>{
    try{const state=await api('/api/notifications/personal');if(valid())draw(state);}
    catch(error){if(valid()){box.innerHTML='<section class="card"><h2>Training & progress</h2><p>Notification settings could not load.</p><button class="ghost wide">Retry</button></section>';$('button',box).onclick=loadSettings;}}
  };
  box.innerHTML=skel(1);await loadSettings();
}
