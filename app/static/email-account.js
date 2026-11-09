(() => {
  const DOMAIN_FIX = {
    'gmai.com':'gmail.com','gmial.com':'gmail.com','gamil.com':'gmail.com','gnail.com':'gmail.com','gmal.com':'gmail.com',
    'gmail.con':'gmail.com','gmail.cmo':'gmail.com','gmail.vom':'gmail.com','yaho.com':'yahoo.com','yahooo.com':'yahoo.com',
    'yahoo.con':'yahoo.com','hotmal.com':'hotmail.com','hotmial.com':'hotmail.com','hotmail.con':'hotmail.com',
    'outlok.com':'outlook.com','outllok.com':'outlook.com','outlook.con':'outlook.com','iclould.com':'icloud.com','icloud.con':'icloud.com',
  };
  const BAD_ENDING = new Set(['con','cmo','vom']);
  const COUNTRY_TLDS = new Set('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw uk eu'.split(' '));
  const COMMON_TLDS = new Set('aero academy agency app art asia biz blog cafe camera careers cat charity church city cloud club com company computer coop design dev digital doctor email edu finance fitness flowers food fun games global gov group guru health homes house info int jobs law legal life link live mil mobi museum name net news online org page photography photo pizza place pro pub recipes run science services shop site social software solutions space store studio tech technology tel today travel tv university website wiki world xyz zone eu uk'.split(' '));
  const KNOWN_TLDS = new Set([...COUNTRY_TLDS, ...COMMON_TLDS]);
  const dismissed = new Set(), confirmedTypos = new Set();
  const appRoot = document.getElementById('app');
  const emailFields = form => [...form.querySelectorAll('input[type="email"]')];
  const eligible = form => form.id === 'em' || /^\/(?:signup|join)(?:\/|$)/.test(location.pathname);
  const normalized = value => String(value || '').trim().toLowerCase();
  const correctedAddress = value => {
    const match = normalized(value).match(/^([^@\s]+)@([^@\s]+)$/);
    if (!match) return null;
    const [, local, domain] = match;
    let corrected = DOMAIN_FIX[domain];
    if (!corrected) {
      const ending = domain.match(/\.([a-z]+)$/)?.[1];
      if (BAD_ENDING.has(ending)) corrected = domain.slice(0, -(ending.length + 1)) + '.com';
    }
    return corrected && corrected !== domain ? `${local}@${corrected}` : null;
  };
  const endingOf = value => normalized(value).split('@')[1]?.split('.').at(-1) || '';
  const suggestionText = (input, address) => BAD_ENDING.has(endingOf(input.value)) ? 'Did you mean .com?' : `Did you mean ${address.split('@')[1]}?`;
  const problem = value => {
    const ending = endingOf(value), suggestion = correctedAddress(value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized(value))) return null;
    if (suggestion) return {suggestion, hard:BAD_ENDING.has(ending)};
    return KNOWN_TLDS.has(ending) ? null : {invalid:true, hard:true};
  };
  function clearTypoConsent(form) {
    const old = form.dataset.emailTypoConfirmed;
    if (old) confirmedTypos.delete(old);
    form.dataset.emailTypoConfirmed = '';
  }
  function showSuggestion(input) {
    const form = input.form;
    if (!form || !eligible(form)) return;
    const row = form.querySelector('.email-address-suggestion');
    if (form.dataset.emailTypoConfirmed === normalized(input.value)) { row?.remove(); return; }
    const issue = problem(input.value);
    if (!issue) { row?.remove(); return; }
    let message = row;
    if (!message) {
      message = document.createElement('div');
      message.className = 'email-address-suggestion';
      message.setAttribute('role','status');
      message.setAttribute('aria-live','polite');
      input.closest('label')?.after(message);
    }
    const key = `${normalized(input.value)}|${issue.suggestion || 'invalid'}|${issue.hard}`;
    if (message.dataset.issue === key) return;
    message.dataset.issue = key;
    message.replaceChildren();
    const text = document.createElement('span');
    text.textContent = issue.suggestion ? suggestionText(input,issue.suggestion) : 'Check the ending after the last dot.';
    message.append(text);
    if (!issue.suggestion) return;
    const accept = document.createElement('button');
    accept.type = 'button'; accept.className = 'linkbtn';
    accept.textContent = issue.hard ? 'Use .com' : `Use ${issue.suggestion.split('@')[1]}`;
    accept.addEventListener('click', () => {
      clearTypoConsent(form);
      input.value = issue.suggestion;
      form.querySelector('.email-address-review')?.remove();
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();
    });
    message.append(accept);
    if (!issue.hard) {
      const keep = document.createElement('button');
      keep.type = 'button'; keep.className = 'linkbtn'; keep.textContent = 'Keep my address';
      keep.addEventListener('click', () => {
        clearTypoConsent(form);
        const address = normalized(input.value);
        form.dataset.emailTypoConfirmed = address;
        confirmedTypos.add(address);
        message.remove();
        input.focus();
      });
      message.append(keep);
    }
  }
  function reviewAddress(form, input) {
    let review = form.querySelector('.email-address-review');
    if (!review) {
      review = document.createElement('div');
      review.className = 'email-address-review';
      review.innerHTML = '<p><strong>Check this address</strong></p><p class="email-address-value"></p><div class="email-address-actions"><button type="button" class="primary" data-email-use>Use this address</button><button type="button" class="linkbtn" data-email-edit>Edit email</button></div>';
      const submit = form.querySelector('button[type="submit"]');
      if (submit?.parentElement === form) submit.before(review);
      else (submit?.parentElement || form).before(review);
      review.querySelector('[data-email-use]').addEventListener('click', () => {
        const field = emailFields(form)[0];
        const issue = field && problem(field.value);
        if (!field || issue?.invalid || issue?.hard || (issue?.suggestion && form.dataset.emailTypoConfirmed !== normalized(field.value))) {
          if (field) showSuggestion(field);
          review.hidden = true;
          return;
        }
        form.dataset.emailAddressConfirmed = normalized(field.value);
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
    review.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  const originalApi = api;
  api = async function(path, options = {}) {
    let email = null, addFlag = false;
    if (['/api/signup','/api/join','/api/beta','/api/account/email'].includes(path) && options.body) {
      try {
        const body = JSON.parse(options.body);
        email = normalized(body.email);
        if (email && confirmedTypos.has(email)) {
          body.confirm_typo = true;
          options = {...options,body:JSON.stringify(body)};
          addFlag = true;
        }
      } catch (_) { /* Keep the original request unchanged if it is not JSON. */ }
    }
    const result = await originalApi(path,options);
    if (addFlag) confirmedTypos.delete(email);
    return result;
  };
  if (typeof Native !== 'undefined' && typeof Native.signup === 'function') {
    const originalSignup = Native.signup;
    Native.signup = async body => {
      const email = normalized(body?.email), addFlag = email && confirmedTypos.has(email);
      const result = await originalSignup(addFlag ? {...body,confirm_typo:true} : body);
      if (addFlag) confirmedTypos.delete(email);
      return result;
    };
  }
  document.addEventListener('input', event => {
    const input = event.target;
    if (input?.matches?.('input[type="email"]') && input.form && eligible(input.form)) {
      clearTypoConsent(input.form);
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
    const value = normalized(input.value), issue = problem(value);
    if (issue?.invalid || issue?.hard || (issue?.suggestion && form.dataset.emailTypoConfirmed !== value)) {
      event.preventDefault(); event.stopImmediatePropagation();
      showSuggestion(input); input.focus(); return;
    }
    if (form.dataset.emailAddressConfirmed === value) return;
    event.preventDefault(); event.stopImmediatePropagation();
    reviewAddress(form,input);
  }, true);
  function addHomeBanner() {
    const page = appRoot?.querySelector('#page');
    const me = typeof App !== 'undefined' ? App.me : null;
    const shouldShow = location.pathname === '/activity' && me?.needs_email_confirm;
    const existing = page?.querySelector('#email-confirm-banner');
    if (!page || !shouldShow) { existing?.remove(); return; }
    const key = String(me.id || me.login || 'account');
    if (dismissed.has(key)) { existing?.remove(); return; }
    if (existing) return;
    const banner = document.createElement('section');
    banner.id = 'email-confirm-banner'; banner.className = 'email-confirm-banner';
    banner.setAttribute('aria-label','Confirm your email');
    banner.innerHTML = '<strong>Confirm your email so friends can find you</strong><div class="email-confirm-actions"><button type="button" class="linkbtn" data-email-resend>Resend</button><a class="linkbtn" href="/me/settings?email=add">Change email</a><button type="button" class="linkbtn" data-email-dismiss>Dismiss</button></div><p class="email-confirm-status" role="status" aria-live="polite"></p>';
    page.prepend(banner);
    banner.querySelector('[data-email-dismiss]').addEventListener('click', () => { dismissed.add(key); banner.remove(); });
    banner.querySelector('[data-email-resend]').addEventListener('click', async event => {
      const button = event.currentTarget, status = banner.querySelector('.email-confirm-status');
      if (button.disabled) return;
      button.disabled = true; status.textContent = '';
      try {
        const reply = await api('/api/account/email/resend',json('POST',{login:me.pending_email || me.login}));
        status.textContent = reply.message || 'Check your inbox for a confirmation link.';
      } catch (error) { status.textContent = error.message || 'Could not resend the confirmation link. Try again.'; }
      finally { button.disabled = false; }
    });
  }
  function pendingAddress(me) {
    try { return me?.pending_email || (typeof pendingEmail === 'function' ? pendingEmail() : null); }
    catch (_) { return me?.pending_email || null; }
  }
  function checkBounceOnce(panel,note) {
    if (panel.dataset.emailBounceChecked) return;
    panel.dataset.emailBounceChecked = '1';
    api('/api/account/email/status').then(result => {
      if (result.bounced && note.isConnected) note.textContent = 'The email provider could not deliver the message. Check the address or change it.';
    }).catch(() => {});
  }
  function addSettingsNotes() {
    const page = appRoot?.querySelector('#page'), me = typeof App !== 'undefined' ? App.me : null;
    if (!page || location.pathname !== '/me/settings' || !me) return;
    if (me.needs_email_confirm && !page.querySelector('#email-confirm-settings-note')) {
      const note = document.createElement('p');
      note.id = 'email-confirm-settings-note'; note.className = 'email-confirm-settings-note small muted';
      note.textContent = 'Your profile stays hidden from other people until you confirm your email.';
      page.prepend(note);
    }
    if (pendingAddress(me)) {
      let note = page.querySelector('#email-confirm-settings-bounce');
      if (!note) { note = document.createElement('p'); note.id = 'email-confirm-settings-bounce'; note.className = 'email-confirm-settings-note small muted'; page.prepend(note); }
      checkBounceOnce(page,note);
    }
  }
  function addPendingChangeLink() {
    const resend = appRoot?.querySelector('#signup-resend'), panel = resend?.closest('.form');
    if (!panel) return;
    const address = panel.querySelector('p');
    if (address && !panel.querySelector('.email-confirm-change')) {
      const link = document.createElement('a');
      link.className = 'email-confirm-change'; link.href = '/me/settings?email=add'; link.textContent = 'Change email';
      address.after(link);
    }
    let note = panel.querySelector('.email-confirm-bounce');
    if (!note) { note = document.createElement('p'); note.className = 'email-confirm-bounce small muted'; note.setAttribute('role','status'); panel.querySelector('#signup-resend-status')?.before(note); }
    checkBounceOnce(panel,note);
  }
  function update() {
    appRoot?.querySelectorAll('form input[type="email"]').forEach(input => showSuggestion(input));
    addHomeBanner(); addSettingsNotes(); addPendingChangeLink();
  }
  let updateQueued = false;
  const scheduleUpdate = () => {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => { updateQueued = false; update(); });
  };
  const observer = new MutationObserver(scheduleUpdate);
  if (appRoot) observer.observe(appRoot,{childList:true,subtree:true});
  update();
})();
