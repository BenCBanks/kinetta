// Settings route and body sheet; shared Me/account helpers stay in pages.js.

route(/^\/me\/settings$/, 'me', async (el) => {
  const me = App.me, ch = `<span class="chev">${svg('chev')}</span>`;
  const unitsOwner = readOwner(), unitsAccountId = me.id;
  const row = (tag, attrs, ico, c, label, val = '') => `<${tag} class="row-link" ${attrs}><span class="ri ${c}">${svg(ico)}</span><span class="grow">${label}</span>${val ? `<span class="val">${val}</span>` : ''}${ch}</${tag}>`;
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Settings</h1><section class="me-settings">
    <h2 class="sec-head">Account</h2>
    <div class="card list">${row('button', 'id="m-name"', 'user', 'c-grey', 'Name', esc(me.name))}
      ${row('button', 'id="m-login"', 'user', 'c-grey', 'Username', esc(me.login))}
      ${row('button', 'id="m-email"', 'mail', 'c-grey', 'Email', esc(me.email ? (me.email_confirmed ? me.email : me.email + ' · not confirmed') : pendingEmail() ? 'Check your inbox' : 'Add'))}
      ${row('button', 'id="m-pw"', 'key', 'c-grey', 'Password', 'Change')}
      ${row('a', 'href="/me/devices"', 'shield', 'c-grey', 'Signed-in devices')}</div>
    <h2 class="sec-head">Profile &amp; sharing</h2>
    <div class="card list">${row('button', 'id="m-profile"', 'user', 'c-green', 'Edit profile')}
      ${row('a', 'href="/me/sharing"', 'lock', 'c-green', 'Sharing &amp; privacy')}</div>
    <h2 class="sec-head">Connections &amp; notifications</h2>
    <div class="card list">${row('a', 'href="/track/connections"', 'watch', 'c-brand', 'Connections')}
      ${row('a', 'href="/me/notifications"', 'bell', 'c-orange', 'Notifications')}<label class="row-link switch-row"><span class="ri c-brand">${svg('help')}</span><span class="grow">Show setup tips<small class="muted">Optional connection and profile reminders</small></span><input type="checkbox" role="switch" id="m-setup-tips"${me.setup_hidden?'':' checked'}></label>${(me.setup_skipped||[]).length?'<button type="button" class="row-link" id="m-setup-unskip"><span class="ri c-brand">'+svg('check')+'</span><span class="grow">Bring back skipped setup steps</span></button>':''}</div>
    <h2 class="sec-head">Units</h2>
    <div class="card list"><div class="row-link static"><span class="ri c-grey">${svg('ruler')}</span><span class="grow">Units</span><div class="me-period mileage-toggle units-toggle" role="group" aria-label="Units">
        <button data-u="imperial" aria-pressed="${me.units === 'imperial'}">mi · lb</button><button data-u="metric" aria-pressed="${me.units === 'metric'}">km · kg</button></div></div></div>
    <h2 class="sec-head">Body</h2>
    <div class="card list">${row('button', 'id="m-body"', 'heart', 'c-red', 'Body & heart rate', esc([me.max_hr ? `Max HR ${me.max_hr}` : '', me.weight_kg ? `${Math.round(U.weight(me.weight_kg))} ${imp() ? 'lb' : 'kg'}` : ''].filter(Boolean).join(' · ') || 'Set up'))}</div>
    <div class="card list" id="ai">${row('button','type="button" id="m-kit"','sparkle','c-green','Kit',me.ai_paused?'Paused':me.ai_ok?'On':'Off')}</div>
    <h2 class="sec-head">Help</h2>
    <div class="card list">${row('a', `href="mailto:${SUPPORT_EMAIL}"`, 'mail', 'c-brand', 'Help &amp; contact')}</div>
    <h2 class="sec-head">Your data</h2>
    <div class="card list">${row('a', 'id="m-export" href="/api/account/export" download', 'download', 'c-blue', 'Download my data', 'Zip file')}
      ${row('a', 'href="https://kinetta.app/terms" target="_blank" rel="noopener"', 'shield', 'c-green', 'Terms of Use')}
      ${row('a', 'href="https://kinetta.app/privacy" target="_blank" rel="noopener"', 'shield', 'c-green', 'Privacy policy')}
      ${row('button', 'id="m-del"', 'trash', 'c-red', '<span class="danger">Delete my account</span>')}</div>
    <div class="card list">${row('button', 'type="button" id="logout"', 'logout', 'c-red', '<span class="danger">Log out</span>')}</div>
    </section>`;
  wireBack(el, '/me');
  const unskip=$('#m-setup-unskip',el);if(unskip)unskip.onclick=async()=>{
    if(unskip.disabled)return;const owner=readOwner();unskip.disabled=true;
    try{await api('/api/profile',json('PUT',{setup_skipped:[]}));if(owner!==readOwner())return;App.me.setup_skipped=[];invalidate('/api/me');keep('/api/me',App.me);unskip.remove();toast('Skipped setup steps are back on Me');}
    catch(x){if(owner===readOwner()){unskip.disabled=false;toast(x.message);}}
  };
  $('#m-setup-tips',el).onchange=async e=>{
    const input=e.target,owner=readOwner(),hidden=!input.checked;input.disabled=true;
    try{await api('/api/profile',json('PUT',hidden?{setup_hidden:true}:{setup_hidden:false,setup_skipped:[]}));if(owner!==readOwner())return;App.me.setup_hidden=hidden;if(!hidden)App.me.setup_skipped=[];invalidate('/api/me');keep('/api/me',App.me);}
    catch(x){if(owner===readOwner()){input.checked=hidden;toast(x.message);}}finally{input.disabled=false;}
  };
  $('#m-profile', el).onclick = () => MeCard.openEditor();

  function openKitSettings(){
    const owner=readOwner();
    sheet('Kit',`<div id="kit-settings-panel"><p class="small muted">Kit can suggest training notes and estimate food. You can always log everything yourself.</p>${me.ai_paused?'<p class="small muted">Kit is paused. Manual logging still works.</p>':me.ai_access&&(!me.ai_access.food?.entitled||!me.ai_access.food?.available||!me.ai_access.coach?.entitled||!me.ai_access.coach?.available)?`<p class="small muted">Food estimates: ${me.ai_access.food?.entitled&&me.ai_access.food?.available?'available':'not available'} · Coaching: ${me.ai_access.coach?.entitled&&me.ai_access.coach?.available?'available':'not available'}.${me.ai_access.coach?.reason?' '+esc(me.ai_access.coach.reason):''}</p>`:!me.coach?'<p class="small muted">Kit is unavailable right now. Manual logging still works.</p>':''}<button type="button" class="linkbtn" id="m-ai-info">What gets shared?</button><div class="seg wide" role="group" aria-label="AI features"><button type="button" data-ai="1" aria-pressed="${!!me.ai_ok}">On</button><button type="button" data-ai="0" aria-pressed="${!me.ai_ok}">Off</button></div><div class="card list">${row('button','type="button" id="m-kit-memory"','sparkle','c-green','What Kit remembers')}${row('button','type="button" id="m-kit-history"','clock','c-green','Earlier Kit reviews')}</div><p class="err" role="alert"></p></div>`,(box,close)=>{
      const valid=()=>box.isConnected&&el.isConnected&&owner===readOwner();let saving=false;
      $('#m-ai-info',box).onclick=()=>{if(valid())sheet('Kit & data',aiExplain());};
      $('#m-kit-memory',box).onclick=()=>{if(valid()){close();KitChat.memorySettings();}};
      $('#m-kit-history',box).onclick=()=>{if(valid()){close();KitChat.savedReviews();}};
      $$('[data-ai]',box).forEach(button=>button.onclick=async()=>{
        if(!valid()||saving)return;const on=button.dataset.ai==='1';if(on===!!App.me.ai_ok)return;
        if(on){close();aiSheet(()=>{if(owner===readOwner())render();});return;}
        saving=true;button.disabled=true;
        try{await api('/api/profile',json('PUT',{ai_ok:false}));if(owner!==readOwner())return;App.me.ai_ok=me.ai_ok=false;keep('/api/me',App.me);invalidate('/api/coach');if(el.isConnected)$('#m-kit .val',el).textContent='Off';if(valid()){close();render();toast('AI features off - nothing is sent');}}
        catch(x){if(valid())$('.err',box).textContent=x.message;}finally{if(valid()){saving=false;button.disabled=false;}}
      });
    });
  }
  $('#m-kit',el).onclick=openKitSettings;
  if(location.hash==='#ai'){replacePageAddress(el,location.pathname+location.search);openKitSettings();}
  $('#m-name', el).onclick = () => {if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_account');accountSheet('name');};
  $('#m-login', el).onclick = () => {if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_account');accountSheet('login');};
  $('#m-pw', el).onclick = () => {if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_account');passwordSheet();};
  $('#m-email', el).onclick = () => {if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_account');emailSheet();};
  if (new URLSearchParams(location.search).get('email') === 'add') { replacePageAddress(el, '/me/settings'); emailSheet(); }
  $('#m-export', el).onclick = async (e) => {
    if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_data');
    if (!Native.on) { toast('Preparing your download - this can take a minute'); return; }
    e.preventDefault();        // the app can't save downloads: a one-time link opens in Safari, which saves it to Files
    try { const r = await api('/api/account/export-link', json('POST', {})); window.open(Native.base + r.path, '_blank'); toast('Opening Safari to download your data'); }
    catch (x) { toast(x.message); }
  };
  $('#m-del', el).onclick = () => {if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('settings_data');deleteSheet();};
  $$('.units-toggle button[data-u]', el).forEach((b) => b.onclick = async () => {
    const requested = b.dataset.u, current = App.me;
    if (!current || unitsOwner !== readOwner() || current.id !== unitsAccountId) return;
    const prev = current.units; current.units = requested; render();
    try { await api('/api/profile', json('PUT', {units: requested})); } catch (x) {
      const latest = App.me;
      if (unitsOwner === readOwner() && latest && latest.id === unitsAccountId) { latest.units = prev; render(); toast('Could not save: ' + x.message); }
    }
  });
  $('#m-body', el).onclick = () => bodySheet();
  if (new URLSearchParams(location.search).get('setup') === 'body') {
    replacePageAddress(el,'/me/settings'); bodySheet();
  }
  const logout = $('#logout', el);
  let leaving = false;
  logout.onclick = async () => {
    if (leaving) return;
    leaving = true; logout.disabled = true;
    const owner = readOwner(), account = App.me, valid = () => owner === readOwner();
    try {
      let chat=0;try{if(typeof FoodThread!=='undefined')chat=await FoodThread.pendingCount();}catch(e){if(valid())toast('Could not check unsent food messages. Try logging out again.');return;}
      let shortcuts=0;try{shortcuts=await Native.foodEntryPendingCount?.()||0;}catch(e){if(valid())toast(e.message);return;}
      if (!valid()) return;
      const n = Q.mine().length + chat + shortcuts;
      if (n && (!await confirmSheet('Log out?', {body: `${n} unsynced item${n === 1 ? '' : 's'} saved on this phone will be deleted if you log out.`, action: 'Log out'}) || !valid())) return;
      if (typeof FoodThread!=='undefined'){try{await FoodThread.eraseDevice();}catch(e){if(valid())toast('Could not remove unsent food photos from this phone. Retry logout to finish clearing them.');return;}}
      if (!valid()) return;
      if(typeof KitChat!=='undefined')KitChat.eraseDevice();
      if (typeof Track !== 'undefined') await Track.pause();
      if (!valid()) return;
      // A failed request can leave the browser cookie valid. Keep Settings visible so retry is honest.
      try { await api('/api/logout', json('POST', {})); }
      catch (e) { if(valid())toast('Could not log out. Check your connection and try again.'); return; }
      if (!valid()) return;
      const cleanup = Native.forget(), clearedOwner = readOwner();
      await cleanup;
      if (clearedOwner !== readOwner()) return;
      store.set('fit.queue', Q.all().filter((o) => o.who !== account.login)); forgetKept();
      App.me = null; App.cache.clear(); netbar(); history.replaceState(null, '', '/'); showLogin();
    } catch (e) { if(valid())toast(e.message || 'Could not log out. Try again.'); }
    finally { leaving = false; logout.disabled = false; }
  };
});

// heart rate, body and time zone (zones, effort, calorie needs) - a sheet, so the Me page stays a short list
function bodySheet() {
  const me = App.me,owner=readOwner(),initialWeight=String(U.weight(me.weight_kg));
  sheet('Body, heart rate & time zone', `<form class="form" id="m-form">
        <div class="two"><label>Max heart rate<input name="max_hr" inputmode="numeric" value="${esc(me.max_hr || '')}" placeholder="auto"></label>
        <label>Resting heart rate<input name="rest_hr" inputmode="numeric" value="${esc(me.rest_hr || '')}" placeholder="60"></label></div>
        <div class="two"><label>Sex (for calorie & effort estimates)<select name="sex"><option value="">—</option><option value="male"${me.sex === 'male' ? ' selected' : ''}>Male</option><option value="female"${me.sex === 'female' ? ' selected' : ''}>Female</option></select></label>
        <label>Birth year<input name="birth_year" inputmode="numeric" value="${esc(me.birth_year || '')}"></label></div>
        <div class="two"><div class="body-weight"><label for="body-weight">Weight (${imp() ? 'lb' : 'kg'})</label><div class="body-weight-input"><input id="body-weight" name="weight" inputmode="decimal" value="${esc(initialWeight)}"><button type="button" class="linkbtn" id="body-log-weight" aria-label="Log weight">Log</button></div></div>
        <label>Height (${imp() ? 'ft in' : 'cm'})<input name="height" value="${esc(me.height_cm ? (imp() ? `${Math.floor(me.height_cm / 2.54 / 12)} ${Math.round(me.height_cm / 2.54 % 12)}` : Math.round(me.height_cm)) : '')}" placeholder="${imp() ? '5 10' : '178'}"></label></div>
        <label>Time zone<select name="tz">${tzOptions(me.tz)}</select></label>
        <label>Everyday activity (outside workouts)<select name="activity_factor">${[[1.2, 'Mostly sitting'], [1.3, 'Some walking & standing'], [1.45, 'On my feet a lot']].map(([f, n]) => `<option value="${f}"${Math.abs((me.activity_factor || 1.2) - f) < .01 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="small muted">Logging a weigh-in updates this stored weight; daily calorie estimates prefer your weight trend. Height, age, sex and everyday activity complete the estimate, with workouts added each day. Heart rates set your zones; leave max HR blank to use your watch’s highest.</p>
        <div class="actions"><button class="primary wide">Save settings</button></div></form>`, (b, close) => {
    $('#body-log-weight',b).onclick=()=>{close();quickWeighIn({afterSave:()=>{if(owner===readOwner()&&location.pathname==='/me/settings'&&!document.querySelector('.scrim:not(.is-closing)'))render();}});};
    $('#m-form', b).onsubmit = async (e) => {
      e.preventDefault(); if(owner!==readOwner())return;const f = e.target, n = (v) => (v.trim() === '' ? null : Number(v));
      const w = n(f.weight.value);
      const hv = f.height.value.trim(), hn = hv.match(/\d+(\.\d+)?/g) || [];   // "5 10", "5'10", "70" (in) or "178" (cm)
      const height_cm = !hn.length ? null : imp() ? (hn.length > 1 ? +hn[0] * 12 + +hn[1] : +hn[0] < 9 ? +hn[0] * 12 : +hn[0]) * 2.54 : +hn[0];
      const body = {max_hr: n(f.max_hr.value), rest_hr: n(f.rest_hr.value), sex: f.sex.value || null, birth_year: n(f.birth_year.value), height_cm, activity_factor: +f.activity_factor.value, tz: f.tz.value || undefined};
      // An unchanged field must not overwrite a weigh-in synced while this sheet was open.
      if(f.weight.value!==initialWeight)body.weight_kg=w==null?null:imp()?w/2.20462:w;
      try { await api('/api/profile', json('PUT', body)); if(owner!==readOwner())return;Object.assign(App.me, body);keep('/api/me',App.me);close(); toast('Settings saved'); render(); } catch (x) { if(owner===readOwner()&&b.isConnected)toast(x.message); }
    };
  });
}
