/* Service assent is separate from age, AI and Health permission. No browser-only acceptance. */
globalThis.CommunityTerms = (() => {
  let shown = null;
  const links = '<a href="https://kinetta.app/terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="https://kinetta.app/privacy" target="_blank" rel="noopener">Privacy Policy</a>';
  function enrollment(form) {
    const place = document.createElement('div');
    place.innerHTML = `<p class="small muted" role="status">Checking the Terms of Use…</p>`;
    form.querySelector('.err').before(place);
    let current;
    const load = () => api('/api/terms').then(status => {
      if (!form.isConnected) throw Error('This account form has closed.');
      if (!current || current.version !== status.version || current.draft !== status.draft) {
        place.innerHTML = status.version ? `<label class="check"><input type="checkbox" name="terms_ok" required><span>By creating an account you agree to the ${links}.</span></label>`
          : `<p class="small muted">Read the ${links}. ${status.draft ? 'The service terms are a draft awaiting approval.' : 'Terms acceptance is not enabled on this server.'}</p>`;
      }
      current = status;
      return status;
    });
    let pending = load().catch(() => {
      if (form.isConnected) place.innerHTML = '<p class="small muted">Terms could not be loaded. Creating your account will retry.</p>';
      return null;
    });
    return async () => {
      await pending;
      const status = await load();
      if (status.version && !form.elements.terms_ok.checked) {
        form.elements.terms_ok.focus();
        throw Error('Read and accept the Terms of Use and Privacy Policy to create your account.');
      }
      return status.version;
    };
  }
  function check() {
    const me = App.me, terms = me?.terms, owner = readOwner();
    if (shown && (shown.owner !== owner || !terms?.required || shown.version !== terms.version)) { shown.close(); shown = null; }
    if (!terms?.required || shown || !App.pageReady || !document.querySelector('#page') || location.pathname === '/me/settings') return;
    const version = terms.version;
    let permitted = false;
    let node;
    const dismiss = sheet('Terms of Use', `<p>Please read the ${links} before continuing to publish content.</p>
      <p class="small muted">Version ${esc(version)}. Your AI and Health permissions stay separate.</p>
      <label class="check"><input type="checkbox" id="terms-agree"><span>I agree to these Terms of Use and the Privacy Policy.</span></label>
      <p class="err" role="alert"></p><button class="primary wide" id="terms-accept" disabled>Accept and continue</button>
      <button class="ghost wide" id="terms-data">Your data: download or delete</button>`, body => { node = body.closest('.scrim'); }, {canClose: () => permitted});
    const button = $('#terms-accept', node), tick = $('#terms-agree', node);
    let view;
    const close = () => { permitted = true; dismiss(); if (shown === view) shown = null; };
    view = {owner, version, close}; shown = view;
    const live = () => shown === view && node.isConnected && !node.classList.contains('is-closing') && owner === readOwner() && App.me?.terms?.version === version;
    $('[data-close]', node).hidden = true;
    tick.onchange = () => { button.disabled = !tick.checked; };
    $('#terms-data', node).onclick = () => { close(); go('/me/settings'); };
    button.onclick = async () => {
      if (!tick.checked || button.disabled || !live()) return;
      button.disabled = true; tick.disabled = true;
      try {
        const status = await api('/api/terms/accept', json('POST', {version}));
        if (!live()) return;
        App.me.terms = status; keep('/api/me', App.me); close();
      } catch (error) {
        if (!live()) return;
        if (error.status === 428) {
          try { refreshMe(await api('/api/me')); } catch (_) { /* The original error stays visible. */ }
          if (!live()) return;
        }
        $('.err', node).textContent = error.message;
        button.disabled = !tick.checked; tick.disabled = false;
      }
    };
  }
  return {enrollment, check, reset: () => { if (shown) shown.close(); }};
})();
