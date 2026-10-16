// The native plugin owns GPS/time/durability. The WebView only reads snapshots and sends explicit controls.
'use strict';
const TrackNative = (() => {
  const C = window.Capacitor, plugin = Native.on && C?.Plugins?.KinettaTrack;
  const supported = !!plugin && (!C.isPluginAvailable || C.isPluginAvailable('KinettaTrack'));
  let bound = null, binding = null, boundAccount = null;
  const owner = () => App.me ? JSON.stringify([Native.base, App.me.id]) : null;
  async function invoke(method, args = {}, expected = readOwner()) {
    const account = owner();
    if (!supported || !account) throw new Error('Sign in to the iPhone app before recording.');
    const result = await Native.healthCall(plugin[method]({owner: account, ...args}), 'The iPhone recorder did not respond. Reopen Track to recover it.', method === 'start' || method === 'resume' ? 120000 : 15000);
    if (expected !== readOwner() || account !== owner()) throw Object.assign(new Error('The recording account changed.'), {stale: true});
    return result;
  }
  async function attach() {
    const revision = readOwner();
    if (bound === revision) return;
    if (!binding || binding.revision !== revision) {
      const promise = invoke('attach', {}, revision).then(() => { if (readOwner() === revision) { bound = revision;boundAccount=owner(); } });
      binding = {revision, promise};
    }
    try { await binding.promise; } finally { if (binding?.revision === revision) binding = null; }
  }
  async function call(method, args = {}) { await attach(); return invoke(method, args); }
  async function detach() {
    const account=owner() || boundAccount;
    if (!supported || !account) { bound=null;return; }
    // Capture the account before authentication disappears; never attach a new owner while stopping an old one.
    try { await Native.healthCall(plugin.detach({owner:account}), 'The iPhone recorder did not respond. Reopen Track before switching accounts.', 15000); } finally { if (boundAccount === account) { bound=null;boundAccount=null; } }
  }
  // One position for the map before Start, from Core Location: iOS remembers the permission, unlike the WebView's API.
  const locate = () => Native.healthCall(plugin.locate(), 'Location did not answer. Tap Locate me to try again.', 30000);
  return {supported, call, detach, owner, locate};
})();
