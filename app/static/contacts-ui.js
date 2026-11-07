// On-demand Contacts matching. Contact names/identifiers stay in memory; only matched local IDs and public handles are cached.
'use strict';
const ContactsUI = (() => {
  const plugin = () => window.Capacitor?.Plugins?.KinettaContacts;
  const available = () => window.Capacitor?.getPlatform?.() === 'ios' && typeof plugin()?.hashContacts === 'function';
  const cacheKey = () => `kinetta.contacts.matches:${JSON.stringify([Native.base || location.origin, App.me?.id])}`;
  const savedMatches = () => {
    const saved = store.get(cacheKey());
    return saved && Array.isArray(saved.rows) ? saved.rows : [];
  };
  const saveMatches = rows => store.set(cacheKey(), {
    at: Date.now(), rows: rows.map(row => ({contactId: String(row.contactId), login: row.login})),
  });
  const icon = name => svg(name);
  const rowLink = `<a class="row-link contacts-entry" href="/me/friends/contacts"><span class="ri">${icon('people')}</span><span class="grow"><b>Contacts on Kinetta</b></span>${icon('chev')}</a>`;
  const welcomeLink = () => available() ? '<a class="ghost wide contacts-welcome-link" href="/me/friends/contacts?return=welcome">Contacts on Kinetta</a>' : '';

  function addEntry(el) {
    if (!available() || !el?.isConnected || $('#contacts-entry', el)) return;
    const search = $('#fr-discover', el);
    if (!search) return;
    const link = document.createElement('div');
    link.innerHTML = rowLink;
    const anchor = link.firstElementChild;
    anchor.id = 'contacts-entry';
    search.insertAdjacentElement('afterend', anchor);
  }

  function addPrivacyRemoval(box) {
    if (!box?.isConnected || $('#contacts-cache-remove', box)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'contacts-cache-remove'; button.className = 'linkbtn contacts-cache-remove';
    button.textContent = 'Remove my contacts';
    button.onclick = () => { store.del(cacheKey()); toast('Saved contact matches removed'); };
    $('#sh-contact-discovery', box)?.append(button);
  }

  function mount(el) {
    el.classList.add('contacts-page');
    const owner = readOwner();
    const transient = {batch:null, hashMap:null, rows:null, contacts:null, current:null, invitations:null, statuses:null};
    const discardHashes = batch => {
      if (Array.isArray(batch?.hashes)) batch.hashes.length = 0;
      for (const contact of batch?.contacts || []) if (Array.isArray(contact.hashes)) contact.hashes.length = 0;
    };
    const discardBatch = batch => {
      if (!batch || typeof batch !== 'object') return;
      discardHashes(batch);
      for (const contact of batch.contacts || []) {
        if (!contact || typeof contact !== 'object') continue;
        contact.id = ''; contact.name = '';
      }
      if (Array.isArray(batch.contacts)) batch.contacts.length = 0;
    };
    let disposed = false;
    const live = () => !disposed && el.isConnected && owner === readOwner();
    viewResources.set(el, () => {
      if (disposed) return;
      disposed = true;
      discardBatch(transient.batch);
      transient.batch = null;
      transient.hashMap?.clear(); transient.hashMap = null;
      transient.contacts?.clear(); transient.contacts = null;
      transient.statuses?.clear(); transient.statuses = null;
      for (const rows of [transient.rows, transient.current, transient.invitations]) rows?.splice(0);
      transient.rows = transient.current = transient.invitations = null;
      el.replaceChildren();
    });
    const returnTo = new URLSearchParams(location.search).get('return') === 'welcome' ? '/welcome?step=workouts' : '/me/friends?find=1';
    const back = () => go(returnTo);
    const frame = (body, actions = '') => {
      if (!live()) return;
      el.innerHTML = `<div class="top">${backBtn('Find friends')}<h1>Contacts</h1></div><main class="contacts-content">${body}${actions}</main>`;
      wireBack(el, returnTo);
    };
    const intro = message => {
      frame(`<section class="contacts-intro"><h2>See who you know</h2>
        <p>See which of your contacts use Kinetta. We compare salted email and phone hashes; names and contact details stay on your iPhone.</p>
        <p class="contacts-private">We don’t keep your contacts.</p>${message ? `<p class="contacts-status" role="alert">${esc(message)}</p>` : ''}</section>`,
        `<div class="contacts-actions"><button type="button" class="primary wide" id="contacts-continue"${available() ? '' : ' disabled'}>Continue</button>
          <button type="button" class="linkbtn wide" id="contacts-not-now">Not now</button></div>`);
      $('#contacts-not-now', el).onclick = back;
      const button = $('#contacts-continue', el);
      if (button && available()) button.onclick = () => begin();
    };
    const message = (title, copy, actions) => frame(`<section class="contacts-state"><h2>${esc(title)}</h2><p>${esc(copy)}</p></section>`,
      `<div class="contacts-actions">${actions}</div>`);

    function limited(batch, salt) {
      message('Limited access', 'Your iPhone lets Kinetta check selected contacts only. You can change this any time in Settings.',
        `<button type="button" class="primary wide" id="contacts-check-selected">Check selected contacts</button>
         <button type="button" class="linkbtn wide" id="contacts-manage-access">Manage access</button>
         <button type="button" class="linkbtn wide" id="contacts-not-now">Not now</button>`);
      $('#contacts-check-selected', el).onclick = () => check(batch, salt);
      $('#contacts-manage-access', el).onclick = async () => {
        try { await plugin().openSettings(); } catch { toast('Settings could not be opened.'); }
      };
      $('#contacts-not-now', el).onclick = back;
    }

    async function begin() {
      if (!live() || !available()) return;
      const button = $('#contacts-continue', el);
      if (button) { button.disabled = true; button.textContent = 'Opening contacts…'; }
      try {
        const {salt} = await api('/api/contacts/salt');
        if (!live()) return;
        const batch = await plugin().hashContacts({salt});
        if (!live()) { discardBatch(batch); return; }
        transient.batch = batch;
        if (batch.permission === 'limited') return limited(batch, salt);
        if (batch.permission !== 'authorized') return permissionOff(batch.permission);
        await check(batch, salt);
      } catch (error) {
        if (live()) intro(error.message || 'Contacts could not be read. Try again.');
      }
    }

    function permissionOff(permission) {
      const title = permission === 'restricted' ? 'Contacts are restricted' : 'Contacts access is off';
      message(title, 'Allow Contacts access in iPhone Settings to check your contacts.',
        `<button type="button" class="primary wide" id="contacts-open-settings">Open Settings</button>
         <button type="button" class="linkbtn wide" id="contacts-not-now">Not now</button>`);
      $('#contacts-open-settings', el).onclick = async () => {
        try { await plugin().openSettings(); } catch { toast('Settings could not be opened.'); }
      };
      $('#contacts-not-now', el).onclick = back;
    }

    const contactMap = batch => {
      const map = new Map();
      for (const contact of batch.contacts || []) for (const item of contact.hashes || []) {
        if (item?.digest && !map.has(item.digest)) map.set(item.digest, contact);
      }
      return map;
    };

    async function check(batch, salt) {
      if (!live()) return;
      const local = contactMap(batch), send = $('#contacts-check-selected', el) || $('#contacts-continue', el);
      transient.hashMap = local;
      if (send) { send.disabled = true; send.textContent = 'Checking…'; }
      frame('<section class="contacts-loading" role="status">Checking your contacts…</section>');
      if (!(batch.hashes || []).length) {
        discardHashes(batch); local.clear(); transient.hashMap = null;
        transient.rows = [];
        saveMatches([]);
        return renderMatches(batch, transient.rows);
      }
      try {
        const response = await api('/api/contacts/match', json('POST', {salt, hashes: batch.hashes || []}));
        if (!live()) return;
        const rows = [], seen = new Set(); transient.rows = rows;
        for (const match of response.matches || []) {
          const contact = local.get(match.hash);
          if (!contact || typeof match.login !== 'string' || !match.login || seen.has(match.login)) continue;
          seen.add(match.login); rows.push({contactId: String(contact.id), login: match.login});
        }
        const names = new Map((batch.contacts || []).map(contact => [String(contact.id), contact.name || 'Contact']));
        rows.sort((a, b) => names.get(a.contactId).localeCompare(names.get(b.contactId)) || a.login.localeCompare(b.login));
        saveMatches(rows);
        response.matches?.splice(0); names.clear(); seen.clear();
        discardHashes(batch); local.clear(); transient.hashMap = null;
        await renderMatches(batch, rows);
      } catch (error) {
        if (!live()) return;
        if (error.status === 429) {
          const present = new Set((batch.contacts || []).map(contact => String(contact.id)));
          const cached = savedMatches().filter(row => present.has(String(row.contactId)));
          present.clear(); transient.rows = cached;
          saveMatches(cached);
          discardHashes(batch); local.clear(); transient.hashMap = null;
          return renderMatches(batch, cached, {cached:true, rateLimited:true});
        }
        discardHashes(batch); local.clear(); transient.hashMap = null;
        message('Could not check contacts', 'Try again when you have a connection.',
          `<button type="button" class="primary wide" id="contacts-retry">Try again</button><button type="button" class="linkbtn wide" id="contacts-not-now">Not now</button>`);
        $('#contacts-retry', el).onclick = () => begin();
        $('#contacts-not-now', el).onclick = back;
      }
    }

    async function renderMatches(batch, rows, {cached = false, rateLimited = false} = {}) {
      const contacts = new Map((batch.contacts || []).map(contact => [String(contact.id), contact])); transient.contacts = contacts;
      const current = rows.map(row => ({...row, contact: contacts.get(String(row.contactId))})).filter(row => row.contact); transient.current = current;
      const matchedContacts = new Set(current.map(row => String(row.contactId)));
      const inviteContacts = (batch.contacts || []).filter(contact => !matchedContacts.has(String(contact.id))); transient.invitations = inviteContacts;
      matchedContacts.clear();
      let relations = {friends: [], incoming: [], outgoing: []};
      try { relations = await api('/api/friends'); } catch { /* Keep Add available if relation status is temporarily unavailable. */ }
      if (!live()) return;
      const statuses = new Map([
        ...(relations.friends || []).map(person => [person.login, 'friends']),
        ...(relations.incoming || []).map(person => [person.login, 'incoming']),
        ...(relations.outgoing || []).map(person => [person.login, 'sent']),
      ]); transient.statuses = statuses;
      const status = login => statuses.get(login);
      const resultRows = current.map(row => {
        const name = row.contact.name || 'Contact', relation = status(row.login);
        const action = relation === 'friends' ? '<span class="contacts-friend-status">Friends</span>'
          : relation === 'sent' ? '<span class="contacts-friend-status">Requested</span>'
          : `<button type="button" class="contacts-add" data-login="${esc(row.login)}" data-name="${esc(name)}" aria-label="Add ${esc(name)} as a friend">${icon('plus')}</button>`;
        return `<div class="contacts-person"><span class="contacts-avatar" aria-hidden="true">${esc(name.trim().slice(0, 1).toUpperCase() || '?')}</span>
          <span class="contacts-person-copy"><b>${esc(name)}</b><small>@${esc(row.login)}</small></span>${action}</div>`;
      }).join('');
      const body = current.length
        ? `<h2 class="contacts-section-title">On Kinetta</h2>${cached ? '<p class="contacts-note" role="status">Showing your saved matches.</p>' : ''}<div class="contacts-list contacts-matched-list" role="list">${resultRows}</div>`
        : rateLimited
          ? `<section class="contacts-empty"><h2>No saved matches</h2><p>There are no previous results saved on this iPhone.</p></section>`
        : `<section class="contacts-empty"><h2>No one found yet</h2><p>None of these contacts matched an account that can be found by email or phone.</p><a class="linkbtn" href="/me/friends?find=1">Search by name or username</a></section>`;
      const invitations = inviteContacts.length
        ? `<details class="contacts-invites"><summary>Not on Kinetta <span>${inviteContacts.length}</span></summary><div class="contacts-list" role="list">${inviteContacts.map(contact => `<div class="contacts-person"><span class="contacts-avatar" aria-hidden="true">${esc((contact.name || 'Contact').trim().slice(0,1).toUpperCase() || '?')}</span><span class="contacts-person-copy"><b>${esc(contact.name || 'Contact')}</b></span><button type="button" class="contacts-invite linkbtn" data-invite-contact="${esc(contact.id)}" data-invite-name="${esc(contact.name || 'Contact')}">Invite</button></div>`).join('')}</div></details>`
        : '';
      frame(body + invitations, `<div class="contacts-actions"><p class="contacts-next-check" role="status">You can check again tomorrow</p><button type="button" class="linkbtn wide" id="contacts-done">Done</button></div>`);
      $('#contacts-done', el).onclick = back;
      el.querySelectorAll('.contacts-add').forEach(button => {
        button.onclick = async () => {
          if (!live() || button.disabled) return;
          button.disabled = true; button.setAttribute('aria-busy', 'true');
          try {
            const result = await api('/api/friends', json('POST', {login: button.dataset.login}));
            if (!live()) return;
            const state = result.status === 'friends' ? 'Friends' : 'Requested';
            button.outerHTML = `<span class="contacts-friend-status" role="status">${state}</span>`;
            invalidate('/api/friends'); invalidate('/api/people/'); invalidateFeed();
          } catch (error) {
            if (live()) { toast(error.message); button.disabled = false; button.removeAttribute('aria-busy'); }
          }
        };
      });
      el.querySelectorAll('[data-invite-contact]').forEach(button => {
        button.onclick = async () => {
          if (!live() || button.disabled) return;
          button.disabled = true;
          try {
            const link = await api('/api/friends/link');
            if (!live()) return;
            const url = link.url.startsWith('/') ? appBase() + link.url : link.url;
            const name = button.dataset.inviteName;
            button.disabled = false;
            sheet(`Invite ${name}`, `<p>Anyone who opens this link becomes your friend on Kinetta. Share it only with someone you’d add yourself.</p><button type="button" class="primary wide" id="contacts-share-invite">Share invite link</button><p class="small muted" id="contacts-share-status" role="status"></p>`, async (body, close) => {
              $('#contacts-share-invite', body).onclick = async () => {
                try {
                  if (navigator.share) await navigator.share({title:'Find friends on Kinetta',text:'Join me on Kinetta so we can follow each other’s workouts.',url});
                  else await navigator.clipboard.writeText(`Join me on Kinetta so we can follow each other’s workouts. ${url}`);
                  close();
                } catch (error) {
                  if (error.name === 'AbortError') return;
                  $('#contacts-share-status', body).textContent = 'The invite could not be shared. Try again.';
                }
              };
            });
          } catch (error) {
            if (live()) { toast(error.message); button.disabled = false; }
          }
        };
      });
    }

    if (!available()) {
      message('Use Kinetta on iPhone', 'Contact matching is available in the Kinetta iPhone app.',
        `<button type="button" class="primary wide" id="contacts-not-now">Back to Find friends</button>`);
      $('#contacts-not-now', el).onclick = back;
      return;
    }
    intro('');
  }

  return Object.freeze({available, addEntry, addPrivacyRemoval, welcomeLink, mount});
})();
