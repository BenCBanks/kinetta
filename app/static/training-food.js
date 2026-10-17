// Optional, deterministic training-day food guidance. Opening this page never saves a preference.
'use strict';
const TrainingFood=(()=>{
  const source='https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf';
  const key=D=>'fit.training-note:'+JSON.stringify([serverKey(),App.me.id,D.day]);
  function card(D){
    const t=D.training;if(!t?.relevant||t.reason==='under18')return '';
    if(!t.adult)return '<p class="small muted"><a href="/food/training-days">Food on training days · optional guidance for adults</a></p>';
    const note=t.note&&!store.get(key(D))?`<aside class="card training-food-card"><p>${esc(t.note)}</p><button class="linkbtn" data-training-dismiss>Dismiss for today</button></aside>`:'';
    return `${note}<details class="card training-food-card"><summary>Food on training days · ${t.kind==='long'?'long day':t.kind==='rest'?'rest day':'active day'}</summary>
      ${t.planned?`<p>${esc(t.planned.title)} · about ${t.planned.estimated_minutes} minutes planned.</p>`:''}
      <p>${t.normal==null&&t.custom==null?'Set a nutrition goal to use training-day adjustments.':t.custom!=null?'Your explicit goal for this day takes priority.':t.extra?`${r0(t.normal)} kcal usual goal + ${r0(t.extra)} kcal extra training allowance.`:t.enabled?'Your usual goal stays in place on rest days and days within your usual training.':'Training-day target adjustment is off. Your usual food goal stays in place.'}</p>
      ${t.extra?`<p class="small muted">Uses the larger of planned or recorded exercise, less a conservative allowance for usual exercise (${r0(t.usual_exercise)} kcal). Estimates can be rough; your normal target is never reduced.</p>`:''}
      <details><summary>General carbohydrate reference</summary><p>Grams of carbohydrate per kilogram of body weight each day. For athletes, the range depends on training intensity and volume:</p><ul>${t.ranges.map(r=>`<li>${esc(r.label)}: ${r.min}–${r.max} g/kg/day.</li>`).join('')}</ul><p>These are reference ranges, not a new macro prescription. Food preferences and individual needs matter.</p><a class="small" href="${source}" target="_blank" rel="noopener noreferrer">ACSM / Academy / Dietitians of Canada position paper · Table1</a></details>
      <p class="small muted">General guidance for healthy adults, not medical advice. If a condition affects your nutrition, get individual guidance from your clinician or dietitian.</p><a class="linkbtn" href="/food/training-days">Adjust targets on training days</a></details>`;
  }
  function wire(el,D){const b=$('[data-training-dismiss]',el);if(b){const owner=readOwner();b.onclick=()=>{if(readOwner()!==owner||!el.isConnected)return;store.set(key(D),true);b.closest('aside').remove();};}}
  async function settings(el){
    const owner=readOwner();el.innerHTML=`<div class="top">${backBtn('Nutrition')}</div><h1>Food on training days</h1><div id="training-settings">${skel(1)}</div>`;wireBack(el,'/food');const box=$('#training-settings',el);
    try{
      const t=await api('/api/food/training-days');if(owner!==readOwner()||!box.isConnected)return;
      if(t.reason==='under18'){box.innerHTML='<p>This optional guidance is for adults 18 and older.</p>';return;}
      box.innerHTML=`<p>Optional general guidance for healthy adults, not medical advice. No AI is used.</p><form class="form" id="training-settings-form">
        <label class="check"><input type="checkbox" name="enabled"${t.enabled?' checked':''}>Adjust targets on training days</label>
        <p class="small muted" id="training-default-note">${t.override===null?`Following your goal and plan default: ${t.default_enabled?'on':'off'}.`:'Using your saved choice.'} On by default for Fuel training or an active plan; off otherwise. You can change this any time.</p>
        <p>Your normal target will not go down. A goal you set for one day takes priority.</p>
        ${!t.adult?'<label class="check"><input type="checkbox" name="adult">I am 18 or older and want general training nutrition guidance.</label><p class="small muted">Optional. Without adult confirmation, training-day guidance and automatic adjustments stay inactive. Your normal food log still works.</p>':''}
        <button class="primary wide" type="submit">Save choice</button><p id="training-save-status" role="status"></p>
        <button class="linkbtn" type="button" data-training-default>Use goal &amp; plan default</button><details><summary>How the allowance works</summary><p>Extra calories allow for planned or recorded exercise above your usual training, without counting an accepted check-in’s exercise twice. Protein and other macro targets stay as you set them. Guidance appears alongside a plan or recent workouts.</p></details></form><p class="small muted">Reference: <a href="${source}" target="_blank" rel="noopener noreferrer">2016 sports-nutrition position paper, Table1</a>. Published athlete ranges guide the reference text; the calorie allowance is Kinetta’s conservative estimate.</p>`;
      const f=$('#training-settings-form',box),status=$('#training-save-status',box);let busy=false;
      const save=async(enabled)=>{
        if(busy||owner!==readOwner()||!f.isConnected)return;
        if(enabled===true&&!t.adult&&!f.adult?.checked){status.textContent='Confirm you are 18 or older to enable general training guidance, or leave adjustment off.';f.adult?.focus();return;}
        busy=true;const button=$('button.primary',f);button.disabled=true;status.textContent='Saving…';
        try{
          const body={enabled};if(f.adult)body.adult_confirmed=f.adult.checked;
          await api('/api/food/training-days',json('PUT',body));if(owner!==readOwner()||!f.isConnected)return;
          invalidate('/api/food');invalidate('/api/activity-food');App.me.training_day_targets=enabled;if(f.adult)App.me.training_food_adult_confirmed=f.adult.checked;
          status.textContent='Saved.';$('#training-default-note',f).textContent=enabled===null?'Following your goal and plan default.':`Your saved choice: ${enabled?'on':'off'}.`;if(enabled===null)await settings(el);
        }catch(e){if(owner===readOwner()&&f.isConnected)status.textContent=e.message;}finally{busy=false;if(button.isConnected)button.disabled=false;}
      };
      f.onsubmit=e=>{e.preventDefault();save(f.enabled.checked);};$('[data-training-default]',f).onclick=()=>save(null);
    }catch(e){if(owner!==readOwner()||!box.isConnected)return;box.innerHTML='<p>Training-day choices could not load.</p><button class="ghost">Try again</button>';$('button',box).onclick=()=>settings(el);}
  }
  route(/^\/food\/training-days$/,'food',settings);
  function eraseDevice(){
    if(!App.me)return true;
    const prefix='fit.training-note:'+JSON.stringify([serverKey(),App.me.id]).slice(0,-1)+',';
    try{for(const k of Object.keys(localStorage))if(k.startsWith(prefix))localStorage.removeItem(k);return true;}catch(e){return false;}
  }
  return {card,wire,eraseDevice};
})();
