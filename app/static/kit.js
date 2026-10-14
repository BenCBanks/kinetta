// Kit asks fixed application tools for facts. A proposed plan/food change still needs explicit confirmation.
'use strict';
route(/^\/me\/kit$/, 'me', async (el) => {
  el.innerHTML = `<div class="top">${backBtn('Me')}</div><h1>Ask Kit</h1>
    <div class="card"><p class="small">Ask about your training or food. Kit checks your own records and shows the numbers it used.</p>
      <form id="kit-form"><label>Your question<textarea name="question" rows="3" maxlength="1500" required placeholder="How much protein have I averaged since my plan started?"></textarea></label>
        <button class="primary wide" type="submit">Ask Kit</button></form><p class="err" role="alert" id="kit-error"></p></div>
    <div id="kit-answer"></div>`;
  wireBack(el, '/me');
  const form = $('#kit-form', el), error = $('#kit-error', el), out = $('#kit-answer', el);
  const account = App.me?.id;
  const valid = () => el.isConnected && App.me?.id === account;
  form.onsubmit = (event) => event.preventDefault();
  $('button[type=submit]', form).disabled = true;
  try {
    const me = await api('/api/me');
    if (!valid() || me.id !== account) return;
    App.me = me; keep('/api/me', me);
  } catch (e) { if (valid()) error.textContent = e.message; return; }
  if (!aiCan('coach')) { form.innerHTML = '<p>AI coaching is unavailable for this account or consent is off. Your training plan, activity history and food tools still work.</p><a href="/me/explore">Explore Kinetta</a>'; return; }
  if (!App.me?.coach_tools) {
    form.innerHTML = '<p class="small">Kit questions are not available yet.</p><a class="ghost wide" href="/me">Back to Me</a>';
    return;
  }
  if (!App.me?.coach || !App.me.ai_ok) {
    form.innerHTML = '<p class="small">Kit is off. Turn on AI features in Me to ask a question.</p><a class="ghost wide" href="/me#ai">AI features</a>';
    return;
  }
  if (new URLSearchParams(location.search).get('review') === 'plan')
    form.elements.question.value = 'Review my upcoming training. Use the plan options and recent load to explain whether an allowed adjustment would help.';
  $('button[type=submit]', form).disabled = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const question = form.elements.question.value.trim(); if (question.length < 3) return;
    const button = $('button[type=submit]', form); button.disabled = true; button.textContent = 'Checking your records…'; error.textContent = '';
    try {
      const response = await api('/api/coach/ask', json('POST', {question}));
      if (!valid()) return;
      out.innerHTML = `<div class="card"><h2>From your records</h2>${response.facts.length ? `<dl>${response.facts.map((f) => `<div class="kv"><dt>${esc(f.label)}</dt><dd class="num">${esc(f.value)}</dd></div>`).join('')}</dl>` : '<p class="small muted">No measurement could be verified for this answer.</p>'}
        <h3 class="ghead">Kit’s interpretation</h3><p>${esc(response.interpretation)}</p>
        ${response.limitations.length ? `<details><summary>Data limits</summary>${response.limitations.map((l) => `<p class="small muted">${esc(l)}</p>`).join('')}</details>` : ''}
        ${response.selection ? '<button class="ghost wide" id="kit-review">Review proposed change</button>' : ''}</div>`;
      const review = $('#kit-review', out); if (review) review.onclick = () => kitReview(response.selection);
    } catch (e) { if (valid()) error.textContent = e.message || 'Kit could not answer. Your question is kept so you can retry.'; }
    finally { if (valid()) { button.disabled = false; button.textContent = 'Ask Kit'; } }
  };
});

function kitReview(selection) {
  const candidate = selection.candidate;
  sheet('Review proposed change', `<p class="small">Nothing changes until you confirm.</p>
    ${selection.kind === 'plan' ? `<p>${esc(candidate.reason)}</p>${candidate.changes.map((w) => `<div class="card"><b>${esc(w.title)}</b><p class="small">${esc(w.day)} · ${esc(w.detail)}</p></div>`).join('')}`
      : `<p class="small">${esc(selection.day)}</p>${candidate.foods.map((f) => `<div class="kv"><span>${esc(f.name)}<small> ${esc(f.amount)} ${esc(f.unit)}</small></span><b>${r0(f.kcal)} kcal</b></div>`).join('')}
        ${nutGrid(candidate.totals)}<label>Log to<select id="kit-meal">${Object.entries(MEAL_NAMES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>`}
    <p class="err" role="alert"></p><button class="primary wide" id="kit-confirm">${selection.kind === 'plan' ? 'Confirm plan adjustment' : 'Confirm and log food'}</button>`, (body, close) => {
    const confirm = $('#kit-confirm', body), error = $('.err', body), owner = App.me?.id;
    let proposal = null; // Keep the same proposal ID when an acknowledgement is lost; confirmation is idempotent.
    const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
    confirm.onclick = async () => {
      if (owner !== App.me?.id) { close(); return; }
      confirm.disabled = true; error.textContent = ''; confirm.textContent = 'Checking and saving…';
      try {
        if (!proposal) proposal = await api('/api/coach/proposals', json('POST', {kind: selection.kind, candidate_id: selection.candidate_id,
          ...(selection.day ? {day: selection.day, meal: $('#kit-meal', body).value} : {})}));
        if (owner !== App.me?.id) return;
        // The proposal endpoint recomputes current candidates. Never apply a different proposal from the one shown.
        if (JSON.stringify(stable(proposal.payload.candidate)) !== JSON.stringify(stable(candidate))) throw new Error('The proposal changed. Ask Kit again to review the latest version.');
        await api(`/api/coach/proposals/${proposal.id}/confirm`, json('POST', {confirmed: true}));
        if (owner !== App.me?.id) return;
        close(); invalidate('/api/'); toast(selection.kind === 'plan' ? 'Plan adjustment saved' : 'Food logged');
        go(selection.kind === 'plan' ? '/plan' : '/food');
      } catch (e) { if (owner === App.me?.id) { error.textContent = e.message; confirm.disabled = false; confirm.textContent = 'Try confirmation again'; } }
    };
  });
}
