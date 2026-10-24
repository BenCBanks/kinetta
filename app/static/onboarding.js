// Optional goal setup: estimates are previews; only Save targets writes the account.
'use strict';
const NUTRITION_GOALS = [
  ['lose_weight', 'Lose weight', 'A gentle, steady change'],
  ['maintain', 'Maintain', 'Keep weight steady'],
  ['build_muscle', 'Build muscle', 'Support strength and gradual gain'],
  ['eat_healthier', 'Eat healthier', 'Start with a balanced daily aim'],
  ['fuel_training', 'Fuel training', 'A starting point alongside your workouts'],
];
const goalDrafts = new Map();
function goalDraft() {
  const key = readOwner();
  if (!goalDrafts.has(key)) {
    const m = App.me;
    goalDrafts.set(key, {goal: m.nutrition_goal || '', pace_percent: m.goal_pace_percent ?? .5,
      activity_factor: m.activity_factor || 1.2, weight_kg: m.weight_kg ?? null,
      height_cm: m.height_cm ?? null, birth_year: m.birth_year ?? null, sex: m.sex || null, edited: new Set()});
  }
  const draft = goalDrafts.get(key);
  for (const k of ['activity_factor','weight_kg','height_cm','birth_year','sex']) {
    if (!draft.edited.has(k)) draft[k] = App.me[k] ?? (k === 'activity_factor' ? 1.2 : null);
  }
  return draft;
}
function goalPayload(draft) {
  return {goal:draft.goal, pace_percent:draft.pace_percent,
    ...Object.fromEntries([...draft.edited].map(k=>[k,draft[k]]))};
}
const watchSetupNote = 'Have a watch? Apple Watch, Garmin and others can send workouts through Apple Health. Optional.';
route(/^\/food\/setup$/, 'food', async (el) => {
  const owner = readOwner(), draft = goalDraft();
  const here = () => el.isConnected && readOwner() === owner;
  let revision = 0;
  const message = (text) => { if (here()) { $('#gs-error', el).textContent = text; $('#gs-error', el).focus(); } };
  const skip = () => { go('/food'); }; // No writes, no permission requests; the goal remains available later.
  function questions() {
    const original = {...draft};
    el.innerHTML = `<div class="top">${backBtn('Nutrition')}</div><div class="goal-setup">
      <p class="eyebrow">Optional setup · 1 of 2</p><h1>What matters to you?</h1>
      <p>A starting point for calories and protein. You can change it any time.</p>
      <form id="gs-form" class="form"><fieldset class="goal-options"><legend class="eyebrow">Your nutrition goal</legend>
        ${NUTRITION_GOALS.map(([key, name, help]) => `<label class="goal-choice"><input type="radio" name="goal" value="${key}"${draft.goal === key ? ' checked' : ''} required><span><b>${name}</b><small>${help}</small></span></label>`).join('')}</fieldset>
      <div id="gs-pace" hidden><label>Weekly pace<select name="pace_percent">
        ${[[0, 'Keep weight steady'], [.25, 'Gentle · 0.25% of body weight'], [.5, 'Steady · 0.5% of body weight'], [1, 'Up to 1% of body weight']].map(([n,label]) => `<option value="${n}"${draft.pace_percent === n ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <p class="small muted">Per week. Your calorie suggestion will never go below estimated resting burn; that may mean a slower pace.</p></div>
      <label>Everyday activity<select name="activity_factor">${ACTIVITY_LEVELS.map(([n,label]) => `<option value="${n}"${Math.abs(draft.activity_factor - n) < .01 ? ' selected' : ''}>${label}</option>`).join('')}</select><small class="muted">Outside workouts; exercise is not included in this estimate.</small></label>
      <details class="goal-body"><summary>Body details · optional</summary><p class="small muted">Private. These improve the estimate. Leaving them out is fine.</p>
        <div class="goal-fields"><label>Weight (${imp() ? 'lb' : 'kg'})<input name="weight" type="number" inputmode="decimal" step="any" min="${imp() ? 25 * 2.20462 : 25}" max="${imp() ? 300 * 2.20462 : 300}" value="${draft.weight_kg == null ? '' : +(draft.weight_kg * (imp() ? 2.20462 : 1)).toFixed(1)}"></label>
        <label>Height (${imp() ? 'in' : 'cm'})<input name="height" type="number" inputmode="decimal" step="any" min="${imp() ? 100 / 2.54 : 100}" max="${imp() ? 250 / 2.54 : 250}" value="${draft.height_cm == null ? '' : +(draft.height_cm / (imp() ? 2.54 : 1)).toFixed(1)}"></label>
        <label>Birth year<input name="birth_year" type="number" inputmode="numeric" min="1920" max="${new Date().getFullYear() - 18}" value="${draft.birth_year ?? ''}"></label>
        <label>Sex for estimates<select name="sex"><option value="">Not specified</option><option value="female"${draft.sex === 'female' ? ' selected' : ''}>Female</option><option value="male"${draft.sex === 'male' ? ' selected' : ''}>Male</option></select></label></div></details>
      <p class="small muted">${watchSetupNote}</p>
      <p id="gs-error" class="goal-error" role="alert" tabindex="-1"></p>
      <div class="goal-actions"><button class="primary wide" type="submit">See my estimate</button><button type="button" class="linkbtn wide" id="gs-skip">Not now</button></div></form></div>`;
    wireBack(el, '/food');
    const f = $('#gs-form', el), initialWeight = f.elements.weight.value, initialHeight = f.elements.height.value;
    const capture = (event) => {
      const key = {weight:'weight_kg',height:'height_cm',birth_year:'birth_year',sex:'sex',activity_factor:'activity_factor'}[event?.target?.name];
      if (key) draft.edited.add(key);
      const num = name => f.elements[name].value === '' ? null : Number(f.elements[name].value);
      Object.assign(draft, {goal:f.elements.goal.value, pace_percent:Number(f.elements.pace_percent.value), activity_factor:Number(f.elements.activity_factor.value),
        weight_kg:f.elements.weight.value === initialWeight ? original.weight_kg : num('weight') == null ? null : num('weight') / (imp() ? 2.20462 : 1), height_cm:f.elements.height.value === initialHeight ? original.height_cm : num('height') == null ? null : num('height') * (imp() ? 2.54 : 1), birth_year:num('birth_year'), sex:f.elements.sex.value || null});
      $('#gs-pace', el).hidden = !['lose_weight','build_muscle'].includes(draft.goal);
    };
    f.oninput = capture;
    f.onchange = e => { capture(e); if (e.target.name === 'goal') Native.haptic?.('selection'); };
    capture(); $('#gs-skip', el).onclick = skip;
    f.onsubmit = async e => {
      e.preventDefault(); capture(); if (!f.reportValidity()) return;
      const sent = ++revision, data = goalPayload(draft);
      if (!['lose_weight','build_muscle'].includes(data.goal)) data.pace_percent = 0;
      const button = f.querySelector('[type=submit]'); button.disabled = true;
      // Immediate in-place feedback while retaining the draft and all navigation.
      button.textContent = 'Estimating…';
      const timer = setTimeout(() => { if (here() && sent === revision) $('#gs-error',el).innerHTML = skel(1); },300);
      try {
        const suggestion = await api('/api/food/target-suggestion',json('POST',data));
        if (here() && sent === revision) review(data,suggestion);
      } catch (x) { if (here() && sent === revision) message(x.message); }
      finally { clearTimeout(timer); if (button.isConnected) { button.disabled = false; button.textContent = 'See my estimate'; } }
    };
  }
  function review(data, suggestion) {
    const s = suggestion, label = NUTRITION_GOALS.find(([key]) => key === data.goal)[1];
    el.innerHTML = `<div class="top">${backBtn('Your goal')}</div><div class="goal-setup">
      <p class="eyebrow">Optional setup · 2 of 2</p><h1>Your starting targets</h1><p>${esc(label)} · estimates, ready to edit.</p>
      <form id="gs-save" class="form"><div class="card goal-estimate"><div class="goal-fields">
        <label>Calories (kcal/day)<input name="kcal_target" type="number" inputmode="numeric" min="${s.resting_floor}" max="10000" step="1" value="${s.kcal_target}" required></label>
        <label>Protein (g/day)<input name="protein_target" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${s.protein_target}" required></label></div>
        <p class="small muted">An estimate, not a prescription. Nothing has been saved.</p></div>
      ${s.weight_assumed ? '<p class="small muted">Rough estimate using 75 kg (about 165 lb). Add your weight for a more personal starting point.</p>' : ''}
      ${s.floor_applied ? '<p class="callout">A gentler pace keeps your suggestion at or above estimated resting burn.</p>' : ''}
      <details class="goal-explanation"><summary>How we worked this out</summary>
        <p>${s.method === 'mifflin' ? 'Resting burn uses the Mifflin–St Jeor formula with your body details.' : 'Resting burn uses a rough weight-based estimate because some body details are missing.'}</p>
        ${s.weight_assumed ? '<p>Without a weight, we used 75 kg (about 165 lb). Add your weight for a more personal estimate.</p>' : ''}
        <p>About ${r0(s.resting_kcal)} kcal resting × ${s.activity_factor} for everyday activity = about ${r0(s.daily_needs)} kcal/day, before workouts.</p>
        <p>${s.pace_percent ? `${s.pace_percent}% of body weight per week uses about 7,700 kcal per kg of change. This is only a starting estimate, not a promised rate.` : 'No weight-change adjustment.'} We round calories to 10 and never suggest less than ${r0(s.resting_floor)} kcal/day, estimated resting burn.</p>
        <p>Protein: ${s.protein_g_per_kg} g per kg of body weight, rounded to 5 g. ${data.goal === 'fuel_training' ? 'This is your everyday target. You can set a different target for an individual day.' : 'Your food target stays separate from calories burned.'}</p>
      </details><p class="small muted">Your other macro targets, daily overrides and Apple Health choices stay unchanged.</p>
      <p id="gs-error" class="goal-error" role="alert" tabindex="-1"></p>
      <div class="goal-actions"><button class="primary wide" type="submit">Save targets</button><button type="button" class="ghost wide" id="gs-back">Change details</button><button type="button" class="linkbtn wide" id="gs-skip">Not now</button></div></form></div>`;
    const f = $('#gs-save',el), back = () => { revision++; questions(); };
    $('#gs-back',el).onclick = back; $('.back',el)?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();back();});
    $('#gs-skip',el).onclick = skip;
    f.onsubmit = async e => {
      e.preventDefault(); if (!f.reportValidity()) return;
      const body = {...data,kcal_target:Number(f.elements.kcal_target.value),protein_target:Number(f.elements.protein_target.value)};
      const button = f.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Saving…';
      try {
        const saved = await api('/api/food/goal-setup',json('PUT',body));
        goalDrafts.delete(owner);
        if (readOwner() !== owner) return;
        refreshMe({...App.me,...saved.profile}); invalidate('/api/food');
        if (!here()) return;
        Native.haptic?.('success'); toast('Targets saved'); go('/food');
      } catch (x) { if (here()) message(x.message); }
      finally { if (button.isConnected) { button.disabled = false; button.textContent = 'Save targets'; } }
    };
  }
  questions();
});
