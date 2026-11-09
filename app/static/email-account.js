(() => {
  const DOMAIN_FIX = {
    'gmai.com':'gmail.com','gmial.com':'gmail.com','gamil.com':'gmail.com','gnail.com':'gmail.com','gmal.com':'gmail.com',
    'gmail.con':'gmail.com','gmail.cmo':'gmail.com','gmail.vom':'gmail.com','yaho.com':'yahoo.com','yahooo.com':'yahoo.com',
    'yahoo.con':'yahoo.com','hotmal.com':'hotmail.com','hotmial.com':'hotmail.com','hotmail.con':'hotmail.com',
    'outlok.com':'outlook.com','outllok.com':'outlook.com','outlook.con':'outlook.com','iclould.com':'icloud.com','icloud.con':'icloud.com',
  };
  const BAD_ENDING = {con:'com',cmo:'com',vom:'com'};
  const dismissed = new Set();
  const emailFields = form => [...form.querySelectorAll('input[type="email"]')];
  const eligible = form => form.id === 'em' || /^\/(?:signup|join)(?:\/|$)/.test(location.pathname);
  const correctedAddress = value => {
    const match = String(value || '').trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
    if (!match) return null;
    const [, local, domain] = match;
    let corrected = DOMAIN_FIX[domain];
    if (!corrected) {
      const ending = domain.match(/\.([a-z]+)$/)?.[1];
      if (BAD_ENDING[ending]) corrected = domain.slice(0, -(ending.length + 1)) + '.' + BAD_ENDING[ending];
    }
    return corrected && corrected !== domain ? `${local}@${corrected}` : null;
  };
  const suggestionText = (input, address) => {
    const originalDomain = String(input.value || '').trim().toLowerCase().split('@')[1] || '';
    const domain = address.split('@')[1];
    return /\.(?:con|cmo|vom)$/i.test(originalDomain) ? 'Did you mean .com?' : `Did you mean ${domain}?`;
  };
  function showSuggestion(input) {
    const form = input.form;
    if (!form || !eligible(form)) return;
    const label = input.closest('label');
    if (!label) return;
    let row = form.querySelector('.email-address-suggestion');
    const suggested = correctedAddress(input.value);
    if (!suggested) { row?.remove(); return; }
    if (!row) {
      row = document.createElement('div');
      row.className = 'email-address-suggestion';
      row.setAttribute('role', 'status');
      row.setAttribute('aria-live', 'polite');
      label.after(row);
    }
    if (row.dataset.suggested === suggested) return;
    row.dataset.suggested = suggested;
    row.replaceChildren();
    const text = document.createElement('span');
    text.textContent = suggestionText(input, suggested);
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'linkbtn';
    accept.textContent = 'Use suggestion';
    accept.addEventListener('click', () => {
      input.value = suggested;
      form.dataset.emailAddressConfirmed = '';
      form.querySelector('.email-address-review')?.remove();
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.focus();
    });
    row.append(text, accept);
  }
  function reviewAddress(form, input) {
    let review = form.querySelector('.email-address-review');
    if (!review) {
      review = document.createElement('div');
      review.className = 'email-address-review';
      review.innerHTML = '<p><strong>Check this address</strong></p><p class="email-address-value"></p><div class="email-address-actions"><button type="button" class="primary" data-email-use>Use this address</button><button type="button" class="linkbtn" data-email-edit>Edit email</button></div>';
      const submit = form.querySelector('button[type="submit"]');
      (submit?.parentElement || form).before(review);
      review.querySelector('[data-email-use]').addEventListener('click', () => {
        const field = emailFields(form)[0];
        if (!field || correctedAddress(field.value)) return;
        form.dataset.emailAddressConfirmed = field.value.trim().toLowerCase();
        review.hidden = true;
        form.requestSubmit();
      });
      review.querySelector('[data-email-edit]').addEventListener('click', () => {
        form.dataset.emailAddressConfirmed = '';
        review.hidden = true;
        input.focus();
      });
    }
    review.querySelector('.email-address-value').textContent = input.value.trim();
    review.hidden = false;
    review.scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  document.addEventListener('input', event => {
    const input = event.target;
    if (input?.matches?.('input[type="email"]') && input.form && eligible(input.form)) {
      input.form.dataset.emailAddressConfirmed = '';
      input.form.querySelector('.email-address-review')?.remove();
      showSuggestion(input);
    }
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !eligible(form)) return;
    const input = emailFields(form)[0];
    if (!input) return;
    const value = input.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return;
    if (correctedAddress(value)) {
      event.preventDefault(); event.stopImmediatePropagation();
      showSuggestion(input);
      input.focus();
      return;
    }
    if (form.dataset.emailAddressConfirmed === value) return;
    event.preventDefault(); event.stopImmediatePropagation();
    reviewAddress(form, input);
  }, true);
  function addHomeBanner() {
    const page = document.querySelector('#page');
    const me = typeof App !== 'undefined' ? App.me : null;
    const shouldShow = location.pathname === '/activity' && me?.needs_email_confirm;
    const existing = page?.querySelector('#email-confirm-banner');
    if (!page || !shouldShow) { existing?.remove(); return; }
    const key = String(me.id || me.login || 'account');
    if (dismissed.has(key)) { existing?.remove(); return; }
    if (existing) return;
    const banner = document.createElement('section');
    banner.id = 'email-confirm-banner';
    banner.className = 'email-confirm-banner';
    banner.setAttribute('aria-label', 'Confirm your email');
    banner.innerHTML = '<strong>Confirm your email so friends can find you</strong><div class="email-confirm-actions"><button type="button" class="linkbtn" data-email-resend>Resend</button><a class="linkbtn" href="/me/settings?email=add">Change email</a><button type="button" class="linkbtn" data-email-dismiss>Dismiss</button></div><p class="email-confirm-status" role="status" aria-live="polite"></p>';
    page.prepend(banner);
    banner.querySelector('[data-email-dismiss]').addEventListener('click', () => {
      dismissed.add(key);
      banner.remove();
    });
    banner.querySelector('[data-email-resend]').addEventListener('click', async event => {
      const button = event.currentTarget, status = banner.querySelector('.email-confirm-status');
      if (button.disabled) return;
      button.disabled = true; status.textContent = '';
      try {
        const reply = await api('/api/account/email/resend', json('POST', {login:me.pending_email || me.login}));
        status.textContent = reply.message || 'Check your inbox for a confirmation link.';
      } catch (error) { status.textContent = error.message || 'Could not resend the confirmation link. Try again.'; }
      finally { button.disabled = false; }
    });
  }
  function addSettingsNote() {
    const page = document.querySelector('#page');
    const me = typeof App !== 'undefined' ? App.me : null;
    if (!page || location.pathname !== '/me/settings' || !me?.needs_email_confirm) return;
    if (page.querySelector('#email-confirm-settings-note')) return;
    const note = document.createElement('p');
    note.id = 'email-confirm-settings-note';
    note.className = 'email-confirm-settings-note small muted';
    note.textContent = 'Your profile stays hidden from other people until you confirm your email.';
    page.prepend(note);
  }
  function addPendingChangeLink() {
    const resend = document.querySelector('#signup-resend');
    const panel = resend?.closest('.form');
    if (!panel || panel.querySelector('.email-confirm-change')) return;
    const address = panel.querySelector('p');
    if (!address) return;
    const link = document.createElement('a');
    link.className = 'email-confirm-change';
    link.href = '/me/settings?email=add';
    link.textContent = 'Change email';
    address.after(link);
  }
  function update() {
    document.querySelectorAll('form input[type="email"]').forEach(input => showSuggestion(input));
    addHomeBanner();
    addSettingsNote();
    addPendingChangeLink();
  }
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {childList:true, subtree:true});
  update();
})();
