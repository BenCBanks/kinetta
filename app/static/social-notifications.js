// ---------- Notifications (2026-10-11, notify.py) ----------
// 2026-10-12 (Ben): the bell shows only your notifications; phone-notification settings live in Me > Settings
// (/me/notifications). /notifications lights no tab (it opens from several).
const PUSH_NAMES = {friends: 'Friend requests', cheers: 'Cheers & reactions', comments: 'Comments', dishes: 'Shared meals', activities: 'New workouts', milestones:'Milestones (at most one a day)',challenge_joins:'Someone joins your challenge',challenge_reminders:'Challenge reminders',challenge_finished:'Challenge finish pictures'};
const NOTE_ICON = {friend_request: 'people', friend_accepted: 'people', cheer: 'cheer', comment: 'comment', dish_shared: 'pot', activity_ready: 'check', report: 'lock', monthly_summary:'calendar'};
// One notification (2026-10-23, Ben: the list felt scrunched): the person's name in bold, a quoted comment on its own
// quieter line, a short time, and a dot for new ones instead of tinted rows.
function noteRow(n) {
  const name = n.who && n.who.name, text = String(n.text || '');
  let lead = '', rest = text, quote = '';
  if (name && rest.startsWith(name)) { lead = name; rest = rest.slice(name.length); }
  const q = rest.match(/^([\s\S]*?):\s*"([\s\S]*)"$/); if (q) { rest = q[1]; quote = q[2]; }
  const summary = n.kind === 'monthly_summary' && ['month','year'].includes(n.period_type) &&
    (n.period_type === 'month' ? /^\d{4}-\d{2}$/.test(n.period) : /^\d{4}$/.test(n.period));
  const summaryAttrs = summary ? ` data-summary-type="${n.period_type}" data-summary-period="${esc(n.period)}"` : '';
  return `<a class="note${n.read ? '' : ' unread'}"${summaryAttrs} href="${esc(n.link)}">
    <span class="note-av">${avatar(n.who)}<span class="note-k" data-kind="${esc(n.kind)}">${svg(NOTE_ICON[n.kind] || 'people')}</span></span>
    <span class="grow"><span class="note-t">${lead ? `<b>${esc(lead)}</b>` : ''}${esc(rest)}</span>${quote ? `<span class="note-q">“${esc(quote)}”</span>` : n.detail ? `<span class="note-q">${esc(n.detail)}</span>` : ''}<small>${esc(noteAgo(n.created))}</small></span>
    ${n.read ? '' : '<span class="note-dot" aria-label="New"></span>'}</a>`;
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
  return when(iso);
}
route(/^\/notifications$/, null, async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Notifications</h1><div id="nt-list">${skel(2)}</div>`;
  wireBack(el, '/today');
  await load('/api/notifications', (r) => {
    const list = $('#nt-list', el); if (!list) return;
    const fresh = r.items.filter((n) => !n.read), seen = r.items.filter((n) => n.read);
    const group = (title, items) => items.length ? `<section class="notes-group">${title ? `<h2 class="notes-h">${title}</h2>` : ''}<div class="card list notes">${items.map(noteRow).join('')}</div></section>` : '';
    list.innerHTML = r.items.length ? group(fresh.length ? 'New' : '', fresh) + group(fresh.length && seen.length ? 'Earlier' : '', seen)
      : `<div class="card empty"><b>Nothing yet</b>New workouts, friend requests, ${esc(CHEER.many)}, comments and shared meals show up here.</div>`;
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
    const meal=$('#np-meal-reminders',box);
    box.innerHTML=`<section class="card"><h2>iPhone notifications</h2>${content}</section>${kinds}<div id="np-meal-reminders"></div>`;
    const placeholder=$('#np-meal-reminders',box);
    // Keep a pending meal preference's controls and generation alive through phone-status refreshes.
    if(meal&&placeholder)placeholder.replaceWith(meal);
    mealReminderCard(meal||placeholder);
  };
  if (!Native.on) {
    render('<p class="small muted">Turn on phone alerts in the Kinetta iPhone app.</p>');return;
  }
  if (!Native.pushSupported) {
    render('<p class="small muted">Update Kinetta in TestFlight to enable phone alerts.</p>');return;
  }
  let status;
  try { status=await Native.pushStatus(); }
  catch (error) {
    if(valid()){
      render(`<p class="err" role="alert">${esc(error.message)}</p><div class="notification-phone-action"><button class="ghost sm" id="np-retry">Retry</button></div>`);
      $('#np-retry',box).onclick=()=>{if(valid())pushCard(box,r);};
    }
    return;
  }
  if(!valid())return;
  const hints={friends:'Requests and friendship updates.',cheers:'Reactions to your activities.',comments:'Replies to your activities.',dishes:'Meals shared with you.',activities:'When a watch or Health workout is ready.',milestones:'A new milestone, at most once a day.',challenge_joins:'When someone joins a challenge you host.',challenge_reminders:'A reminder while your challenge is active.',challenge_finished:'When a challenge finish picture is ready.'};
  const kinds=status.enabled?`<section class="card"><h2>Alert types</h2><div class="notification-choices" id="np-kinds">${Object.entries(PUSH_NAMES).map(([k,n])=>`<label class="switch-row"><span>${esc(k==='milestones'?'Milestones':n)}<small>${esc(hints[k])}</small></span><input type="checkbox" role="switch" name="${k}"${r.push[k]?' checked':''}></label>`).join('')}</div></section>`:'';
  render(`${!r.push_ready?'<p class="small muted">Server notification setup is not complete; the bell still works.</p>':''}
    ${status.enabled?'<p class="small muted">Alerts are on for this iPhone.</p><div class="notification-phone-action"><button class="ghost sm" id="np-off">Turn off on this iPhone</button></div>'
      :status.denied?'<p class="small muted">Allow Kinetta notifications in iPhone Settings.</p><div class="notification-phone-action"><button type="button" class="primary sm" id="np-settings">Open iPhone Settings</button></div>'
      :'<p class="small muted">Get alerts for the notification types you choose.</p><div class="notification-phone-action"><button class="primary sm" id="np-on">Turn on iPhone notifications</button></div>'}
    <p class="err" role="alert" id="np-error">${esc(message)}</p>`,kinds);
  const error=$('#np-error',box),on=$('#np-on',box),off=$('#np-off',box),settings=$('#np-settings',box);
  if(settings)settings.onclick=async()=>{if(!valid()||settings.disabled)return;settings.disabled=true;try{await Native.openPushSettings({enable:true});}catch(x){if(valid())error.textContent=x.message;}finally{if(valid())settings.disabled=false;}};
  const phoneAction=(button,run)=>{
    if(!button)return;button.onclick=async()=>{
      if(!valid()||button.disabled)return;button.disabled=true;error.textContent='';
      try{await run();if(valid())await pushCard(box,r);}
      catch(x){if(valid()){error.textContent=x.message;button.disabled=false;}}
    };
  };
  phoneAction(on,()=>Native.enablePush());phoneAction(off,()=>Native.disconnectPush({forget:true}));
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
    box.innerHTML=`<section class="card personal-notifications"><h2>Training & progress</h2><p class="small muted">Planned workouts and weekly summaries are off by default · ${esc(state.tz)}</p>
      <div class="notification-choices"><div class="personal-notice-choice"><label class="switch-row"><span>Planned workouts<small>Only when a workout is still due.</small></span><input type="checkbox" role="switch" data-personal="plan"${state.plan?' checked':''}${unavailable&&!state.plan?' disabled':''}></label>
      ${state.plan?`<label class="personal-notice-time">Reminder time<select data-personal="plan_time">${times.map(([k,v])=>`<option value="${k}"${state.plan_time===k?' selected':''}>${v}</option>`).join('')}</select></label>`:''}</div>
      <div class="personal-notice-choice"><label class="switch-row"><span>Weekly summary<small>Monday at 9 am.</small></span><input type="checkbox" role="switch" data-personal="weekly"${state.weekly?' checked':''}${unavailable&&!state.weekly?' disabled':''}></label></div>
      <div class="personal-notice-choice"><label class="switch-row"><span>Monthly summary<small>On the first of the month at 9 am.</small></span><input type="checkbox" role="switch" data-monthly-summary${monthlySummary?' checked':''}${unavailable&&!monthlySummary?' disabled':''}></label></div></div>
      ${unavailable?`<p class="small muted">${!state.push_ready?'Server notification setup is not complete.':Native.on?'Turn on iPhone notifications above.':'Turn on notifications in the Kinetta iPhone app first.'}</p>`:''}
      ${state.plan||state.weekly?'<details class="reminder-how"><summary>Delivery details</summary><p>New choices start at the next scheduled time. A weekly summary needs a workout or food logged in the last seven completed days. iOS may delay or suppress alerts. Delivered alerts cannot be recalled.</p></details>':''}
      <p class="small${error?' err':''}" role="status" data-personal-status>${esc(error)}</p></section>`;
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

async function mealReminderCard(box,message=''){
  if(!box)return;
  const account=readOwner();
  if(box.mealSaving===account){box.mealRefresh=true;return;}
  const generation=Symbol();box.mealGeneration=generation;
  const valid=()=>box.isConnected&&account===readOwner()&&box.mealGeneration===generation;
  const timeLabel=time=>new Date('2000-01-01T'+time+':00Z').toLocaleTimeString([],{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
  const draw=(state,error=message)=>{
    if(!valid())return;
    const unavailable=!state.push_ready||!state.device_ready,learned=state.times.filter(row=>row.ready);
    box.innerHTML=`<section class="card meal-reminders"><label class="switch-row"><span>Meal-time reminders<small>A quiet invitation to log.</small></span><input type="checkbox" role="switch" data-meal-reminders${state.enabled?' checked':''}${unavailable&&!state.enabled?' disabled':''}></label>
      <p class="small muted">Off by default · ${esc(state.tz)}. No streaks or calorie nudges.</p>
      ${unavailable?`<p class="small muted">${!state.push_ready?'Server notification setup is not complete.':Native.on?'Turn on iPhone notifications above.':'Turn on notifications in the Kinetta iPhone app first.'}</p>`:''}
      ${state.enabled?`<div class="meal-reminder-details">${learned.length?`<dl>${learned.map(row=>`<div><dt>${esc(MEAL_NAMES[row.meal])}</dt><dd>Around ${esc(timeLabel(row.time))}</dd></div>`).join('')}</dl>`:''}
      ${state.times.some(row=>!row.ready)?'<p class="small muted">Learning your usual times.</p>':''}
      <p class="small muted">7 am–9 pm · A meal already logged stays quiet.</p><details class="reminder-how"><summary>How times work</summary><p>Uses your first same-day log for each meal across the last 28 completed days, rounded to about 15 minutes. Needs 3 daytime logging days. Past-day uploads do not set a time; no default time is invented. Delivered alerts cannot be recalled.</p></details></div>`:''}
      <p class="small muted" role="status" data-meal-status></p><p class="err" role="alert">${esc(error)}</p></section>`;
    const toggle=$('[data-meal-reminders]',box);toggle.onchange=async()=>{
      if(!valid()||toggle.disabled)return;
      const enabled=toggle.checked,focused=globalThis.document?.activeElement===toggle;
      box.mealSaving=account;toggle.disabled=true;$('.err',box).textContent='';$('[data-meal-status]',box).textContent='Saving…';let failure='';
      const focus=()=>{const input=$('[data-meal-reminders]',box);if(focused&&!input?.disabled)input?.focus?.({preventScroll:true});};
      try{
        await api('/api/food/reminders',json('PUT',{enabled,confirmed:enabled}));if(!valid())return;
        Native.haptic('light');await loadSettings();focus();
      }catch(error){failure=error.message||'Reminder setting could not be saved.';if(valid()){toggle.checked=!enabled;toggle.disabled=false;draw(state,failure);focus();}}
      finally{
        if(box.mealSaving===account)box.mealSaving=null;
        if(valid()&&box.mealRefresh){box.mealRefresh=false;await mealReminderCard(box,failure);}
      }
    };
  };
  const loadSettings=async()=>{
    try{const state=await api('/api/food/reminders');if(valid())draw(state);}
    catch(error){if(valid()){box.innerHTML='<section class="card"><h2>Meal-time reminders</h2><p>Reminder settings could not load.</p><button class="ghost wide">Try again</button></section>';$('button',box).onclick=loadSettings;}}
  };box.innerHTML=skel(1);await loadSettings();
}
