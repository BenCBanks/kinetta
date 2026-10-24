// Device-local invitation; never sends a declined choice to the server.
'use strict';
const PushInvitation = (() => {
  const WAIT = 30 * 864e5, HOMES = new Set(['/me', '/activity', '/track', '/progress', '/food']);
  let checking = false, timer = null, open = null, skipped = new Set();
  const account = () => App.me && JSON.stringify([Native.base, App.me.id]);
  const shouldAsk = (choice, now = Date.now()) => !choice?.done && (choice?.asks || 0) < 2 && (choice?.lastAsked == null || now - choice.lastAsked >= WAIT);
  const contextAllowed = (c) => c.native && c.signedIn && c.ready && c.home && !c.hidden && !c.overlay && !c.keyboard && !c.recording && !c.health && !c.external;
  const context = (ownSheet = null) => ({native:Native.on, signedIn:!!App.me && !!Native.token, ready:App.pageReady,
    home:HOMES.has(location.pathname) && !location.search, hidden:document.hidden,
    overlay:[...document.querySelectorAll('.scrim')].some(s => s !== ownSheet),
    keyboard:document.documentElement.classList.contains('keyboard-open') || !!window.KinettaKeyboard?.height || !!document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]'),
    recording:(typeof Track !== 'undefined' && Track.active) || !!document.querySelector?.('#track-start:disabled'),
    health:!!(Native.connecting || Native.restingConnecting || Native.healthSetup), external:!!Native.pushEntryBlocked});
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; consider(); }, 1200); };
  async function consider() {
    if (open) {
      if (!open.node.isConnected) open = null;
      else {
        if (open.session !== readOwner() || !contextAllowed(context(open.node))) { open.close(); open = null; }
        return;
      }
    }
    if (checking) return;
    if (!contextAllowed(context())) {
      if (Native.on && App.me && HOMES.has(location.pathname) && !document.hidden) later();
      return;
    }
    const session = readOwner(), owner = account();
    if (skipped.has(session)) return;
    checking = true;
    const valid = () => session === readOwner() && owner === account() && contextAllowed(context());
    try {
      await Native.pushNavigationReady;
      if (!valid()) return;
      const choice = await Native.readPushInvitation();
      if (!valid()) return;
      if (!shouldAsk(choice)) { skipped.add(session); return; }
      const [settings, status, lifts] = await Promise.all([api('/api/notifications'), Native.pushStatus(), api('/api/lifts/sessions?limit=1')]);
      if (!valid()) return;
      if (!settings.push_ready || !status.supported || status.enabled || status.externalEntry) { skipped.add(session); return; }
      if (lifts.some(s => s.lift_open && Date.now() - new Date(s.start_time) < 4 * 3600e3)) return;
      const next = {asks:(choice?.asks || 0) + 1, lastAsked:Date.now(), done:false};
      // Reserve this ask before mounting, so repeated renders/relaunches cannot duplicate it.
      await Native.writePushInvitation(next, owner);
      if (!valid()) return;
      skipped.add(session);
      show(status, next, session, owner);
    } catch { skipped.add(session); /* Try again on the next ordinary app open. */ }
    finally { checking = false; if (!open) later(); }
  }
  function show(status, choice, session, owner) {
    const denied = !!status.denied;
    const close = sheet('Stay in the loop', `<div class="push-invitation">
      <p>Get notified when your workouts sync and friends cheer you on.</p>
      <p class="small muted" id="pi-explanation">${denied ? 'Notifications are blocked in iPhone Settings. Open Kinetta’s settings, turn on Allow Notifications, then return to the app.' : 'Choose which notifications you receive in Settings → Notifications.'}</p>
      <button type="button" class="primary wide" id="pi-enable">${denied ? 'Open iPhone Settings' : 'Turn on notifications'}</button>
      <button type="button" class="ghost wide" id="pi-later">Not now</button><p class="err" role="alert" id="pi-error"></p></div>`, (body, dismiss) => {
      const node = body.closest('.scrim'), enable = $('#pi-enable', body), error = $('#pi-error', body);
      open = {node, close:dismiss, session};
      let blocked = denied, busy = false;
      const valid = () => node.isConnected && session === readOwner() && owner === account();
      $('#pi-later', body).onclick = dismiss;
      enable.onclick = async () => {
        if (busy || !valid()) return;
        busy = true; enable.disabled = true; error.textContent = '';
        try {
          // Accepting the invitation ends automatic asks, even if Apple denies permission.
          await Native.writePushInvitation({...choice, done:true}, owner);
          if (!valid()) return;
          if (blocked) await Native.openPushSettings({enable:true}); else await Native.enablePush();
          if (!valid()) return;
          dismiss(); invalidate('/api/notifications');
        } catch (x) {
          if (!valid()) return;
          let fresh;
          try { fresh = await Native.pushStatus(); } catch {}
          if (!valid()) return;
          if (fresh?.denied) {
            blocked = true; enable.textContent = 'Open iPhone Settings';
            $('#pi-explanation', body).textContent = 'Notifications are blocked. Open Kinetta’s iPhone settings and turn on Allow Notifications.';
          }
          error.textContent = x.message || 'Notifications could not be enabled. Try again.';
        } finally { if (valid()) { busy = false; enable.disabled = false; } }
      };
    });
    // sheet() mounts synchronously; keep the same close handle for route/account suppression.
    if (open) open.close = close;
  }
  const observe = () => {
    new MutationObserver(() => { if (open) consider(); else later(); }).observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange', () => { if (document.hidden) { skipped = new Set(); consider(); } else later(); });
    window.addEventListener('kinetta:external-entry', () => { Native.pushEntryBlocked = true; consider(); });
    window.addEventListener('kinetta:keyboard', () => { if (open) consider(); else later(); });
  };
  if (Native.on) observe();
  return {consider, shouldAsk, contextAllowed};
})();
