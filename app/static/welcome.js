// Welcome steps after a new account (#232 F): profile, Kit, who sees your activities, bring in workouts (with optional friends).
// Kit's step shows only while it's off and this server offers it: new accounts start with AI off until they say yes (2026-10-26).
// Save and continue saves this step; Skip keeps existing choices; Not now returns to Me. Get started on Me reopens it until there's history.
'use strict';
const WELCOME_AUDIENCE = [
  ['everyone', 'Everyone on Kinetta', 'Anyone with a Kinetta account can see your activities and follow along.'],
  ['friends', 'Approved friends', 'Only people you accept as friends see your activities.'],
  ['me', 'Only me', 'Your activities stay private. You can share single ones later.'],
];
route(/^\/welcome$/, 'me', async (el) => {
  const owner = readOwner();let currentStep='';const here = (id=currentStep) => el.isConnected && readOwner() === owner && currentStep===id;
  const access = Object.values(App.me?.ai_access || {});
  const offerKit = !App.me?.ai_ok && (access.length ? access.some((a) => a.available && a.entitled) : !!App.me?.coach);
  const k = offerKit ? 1 : 0, total = 3 + k;
  const frame = (id,n, title, intro, body, next = 'Save and continue') => {
    currentStep=id;const query=new URLSearchParams(location.search);query.set('step',id);replacePageAddress(el,'/welcome?'+query);
    el.innerHTML = `<div class="welcome"><p class="eyebrow">Welcome · ${n} of ${total}</p><h1>${title}</h1><p class="muted">${intro}</p>${body}
      <p class="err" role="alert" id="wc-err"></p>
      <div class="welcome-actions"><button class="primary wide" id="wc-next">${next}</button>${n < total ? '<button class="linkbtn wide" id="wc-skip">Skip this step</button>' : ''}<button class="linkbtn wide" id="wc-leave">Not now</button></div></div>`;
    $('#wc-leave', el).onclick = () => go('/me');
  };
  // Saves, then moves on; a failure keeps the step and what was typed.
  const step = (save, then) => async () => {
    const id=currentStep,controls=$$('.welcome-actions button',el);controls.forEach(button=>button.disabled=true); $('#wc-err', el).textContent = '';
    try { await save(); if (here(id)) then(); }
    catch (x) { if (here(id)) { $('#wc-err', el).textContent = x.message;controls.forEach(button=>button.disabled=false); } }
  };
  function profile() {
    const me = App.me;
    frame('profile',1, 'Your profile', 'Shown with your name to friends and people who find you. Your photo and bio are optional. Skip keeps your current profile.',
      `<div class="welcome-photo"><button type="button" class="av-edit" id="wc-photo" aria-label="${me.photo ? 'Change' : 'Add'} profile photo">${avatar(me, 'xl')}<span class="av-cam">${svg('camera')}</span></button></div>
      <form class="form" id="wc-form"><label>Name<input name="name" value="${esc(me.name)}" maxlength="60" required autocomplete="name" enterkeyhint="next"></label>
      <label>Bio · optional<textarea name="bio" rows="3" maxlength="280" placeholder="What you enjoy, what you’re working toward…">${esc(me.bio || '')}</textarea></label>
      <p class="small muted" id="wc-count">${(me.bio || '').length}/280</p></form>`);
    const f = $('#wc-form', el);
    $('#wc-photo', el).onclick = () => profilePhotoSheet(() => { keep('/api/me', App.me); if (here('profile')) { const keepName = f.elements.name.value, keepBio = f.elements.bio.value; profile(); const g = $('#wc-form', el); g.elements.name.value = keepName; g.elements.bio.value = keepBio; } });
    f.elements.bio.oninput = () => { $('#wc-count', el).textContent = `${f.elements.bio.value.length}/280`; };
    f.onsubmit = (e) => { e.preventDefault(); $('#wc-next', el).click(); };
    const after = offerKit ? kit : audience;
    $('#wc-skip', el).onclick = after;
    $('#wc-next', el).onclick = step(async () => {
      if (!f.reportValidity()) throw new Error('Add your name to continue.');
      const name = f.elements.name.value.trim(), bio = f.elements.bio.value.trim();
      if (name === me.name && bio === (me.bio || '')) return;
      const r = await api('/api/account', json('PUT', {name, bio}));
      if(!here('profile'))return;App.me.name = r.name || name; App.me.bio = bio; keep('/api/me', App.me); invalidate('/api/people/');
    }, after);
  }
  function kit() {
    frame('kit',2, 'Turn on Kit?', 'Kit can estimate food nutrition and help explain your training. Check food estimates and portions before logging; they can be wrong.',
      `<p class="small muted">Only what a request needs goes to ${esc(App.me.ai_provider || 'the AI provider')}, never your whole account. Sharing Health or Garmin data with Kit needs separate permission. Turn Kit off any time in Me.</p>
      <details class="welcome-kit"><summary>What Kit sees</summary>${aiExplain()}</details><p class="small">Kit is for people 18 or older.</p>${aiAdultBox()}`, 'Turn on Kit');
    $('#wc-skip', el).textContent='Keep Kit off';$('#wc-skip', el).onclick = audience;
    $('#wc-next', el).onclick = step(async () => {
      if (!$('[name=ai_adult]', el).checked) throw new Error('Tick the box to confirm you’re 18 or older.');
      await api('/api/profile', json('PUT', {ai_ok: true, ai_adult: true}));
      if(!here('kit'))return;App.me.ai_ok = true; keep('/api/me', App.me); invalidate('/api/coach'); toast('Kit is on');
    }, audience);
  }
  async function audience() {
    frame('audience',2 + k, 'Who sees your activities', 'This applies to new activities. You can choose differently on any one of them. Skip keeps your current choice.', `<div id="wc-aud">${skel(1)}</div>`);
    $('#wc-skip', el).onclick = workouts;
    let current=null;$('#wc-next',el).disabled=true;
    try { const saved=(await api('/api/sharing')).default;if(!WELCOME_AUDIENCE.some(([value])=>value===saved))throw Error();current=saved; } catch (x) { if(here('audience'))$('#wc-err',el).textContent='Your current choice couldn’t load. Choose an audience, or skip to keep it.'; }
    if (!here('audience')) return;
    $('#wc-aud', el).innerHTML = `<fieldset class="goal-options"><legend class="vh">Who sees your activities</legend>${WELCOME_AUDIENCE.map(([k, name, help]) =>
      `<label class="goal-choice"><input type="radio" name="aud" value="${k}"${k === current ? ' checked' : ''}><span><b>${name}</b><small>${help}</small></span></label>`).join('')}</fieldset>
      <p class="small muted">Shared maps trim the start and end to reduce location clues. Other parts of a route or its photos can still reveal places.</p>`;
    $('#wc-next',el).disabled=false;$('#wc-next', el).onclick = step(async () => {
      const pick = $('input[name="aud"]:checked', el)?.value;
      if(!pick)throw Error('Choose who sees new activities, or skip to keep your current choice.');
      if (pick !== current) await api('/api/sharing', json('PUT', {default: pick}));
    }, workouts);
  }
  function workouts() {
    const card = (href, ico, title, sub) => `<a class="row-link" href="${href}"><span class="ri c-brand">${svg(ico)}</span><span class="grow">${title}<small class="muted gs-sub">${sub}</small></span><span class="chev">${svg('chev')}</span></a>`;
    // In the iPhone app, the Health app leads: one tap, one permission screen, then the recent workouts import (2026-10-24)
    const health = Native.on;
    frame('workouts',3 + k, 'Bring in your workouts', health ? 'Connect to the Health app to bring in workouts from your iPhone, Apple Watch and other apps. Weight reading has its own control in Connections.' : 'Pick one now, or come back to it from Get started on Me.',
      `${health ? '<button class="primary wide" id="wc-health">' + svg('heart') + ' Connect to the Health app</button><p class="small muted">The Health app shows one screen where you choose what to share. You can change it any time in the Health app.</p><p class="err" role="alert" id="wc-health-err"></p>' : ''}
      <div class="card list">${card('/track', 'track', 'Record with this phone', 'Runs, rides, walks and lifting. Your phone asks for location when you start.')}
      <div id="wc-connections">${card('/track/connections', 'watch', 'Workout connections', 'Check which connections are available.')}</div>
      ${Native.on ? '' : card('/track/import', 'upload', 'Upload files or a Strava export', 'GPX, FIT and TCX files, or the zip file Strava gives you.')}</div><details class="welcome-kit"><summary>Find friends · optional</summary><div id="wc-inv"></div><a class="linkbtn wide" href="/me/friends?find=1">Search by name or username</a>${ContactsUI.welcomeLink()}</details>`, 'Done');
    $('#wc-skip', el)?.remove();
    $('#wc-next', el).onclick = complete;friends();
    api('/api/connections').then(connections=>{if(!here('workouts'))return;const available=connections.garmin_connect_available||connections.garmin_connect;$('#wc-connections',el).innerHTML=card('/track/connections','watch',available?'Garmin Connect':'Workout connections',available?'Manage Garmin workout syncing in Connections.':'Garmin Connect isn’t available for this account.');}).catch(()=>{});
    const h = health ? $('#wc-health', el) : null;
    if (h) {
      Native.healthOn().then((done) => { if (done && h.isConnected && here('workouts')) { h.textContent = 'Health app connected'; h.disabled = true; $('#wc-next', el).textContent = 'Done'; } }).catch(() => {});
      h.onclick = async () => {
        h.disabled = true; h.textContent = 'Opening Health app…'; $('#wc-health-err', el).textContent = '';
        try {
          await Native.connectAppleHealth();
          if (!here('workouts')) return;
          Native.autoSync(); toast('Health app connected. Bringing in your recent workouts…'); complete();
        } catch (x) { if (here('workouts')) { $('#wc-health-err', el).textContent = x.message; h.disabled = false; h.innerHTML = svg('heart') + ' Connect to the Health app'; } }
      };
    }
  }
  function complete(){if(!here('workouts'))return;if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('welcome_complete');toast('You’re all set');go('/me');}
  async function friends() {
    let who = null;
    try { who = (await api('/api/account/inviter')).inviter; } catch (x) { /* search still works */ }
    if (!here('workouts') || !who) return;
    $('#wc-inv', el).innerHTML = `<div class="card person">${avatar(who)}<span class="grow"><b>${esc(who.name)}</b><small class="muted">Invited you</small></span><button class="primary sm" id="wc-friend">Become friends</button></div>`;
    const b = $('#wc-friend', el);
    b.onclick = async () => {
      b.disabled = true;
      try { const r = await api('/api/friends', json('POST', {login: who.login}));if(!here('workouts')||!b.isConnected)return;b.textContent = r.status === 'friends' ? 'Friends' : 'Request sent'; }
      catch (x) { if(here('workouts')&&b.isConnected){toast(x.message);b.disabled=false;} }
    };
  }
  const requested=new URLSearchParams(location.search).get('step');
  const steps={profile,kit:offerKit?kit:audience,audience,workouts};
  return (Object.hasOwn(steps,requested)?steps[requested]:profile)();
});
