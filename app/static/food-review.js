// A single final review for entered food: saving a recipe and logging are independent choices.
// Layout (owner, 20 Oct 2026): "Adding to <meal> today", the foods with tappable calories, one total, an optional
// "Save as a recipe" switch that reveals the recipe details, and one button that says what will happen.
'use strict';
const FoodReview=(()=>{
  const sending=new Set();
  const changed=()=>dispatchEvent(new CustomEvent('food:review-state'));
  const number=input=>{const text=input.value.trim();return text===''?null:Number(text.replace(',','.'));};
  // A calorie edit scales that food's other nutrients by the same ratio (the server applies the same rule).
  const edited=(e,kcal)=>{if(kcal==null)return e;const r=e.kcal?kcal/e.kcal:null,out={...e,kcal};if(r!=null)for(const k of FOOD_NUTRIENTS)if(k!=='kcal'&&e[k]!=null)out[k]=e[k]*r;return out;};
  async function open({done=()=>{},messages,draftId,meal,saveRecipe=false,draftForm=null,rememberForm=()=>{},active,accept}){
    const owner=readOwner(),id=newId();let prepared;
    try{prepared=await api('/api/food/thread/reviews',json('POST',{client_id:id,draft_id:draftId,messages}));}
    catch(e){toast(e.message);return;}
    if(!active()||owner!==readOwner())return;
    let review=prepared.review,kcal={};
    const chosen=Object.hasOwn(MEAL_NAMES,meal)?meal:guessMeal();
    sheet('Add to log',`<form class="form food-final-review" id="food-final-review">
      <label id="review-recipe-name" hidden>Recipe name<input name="name" maxlength="80" autocomplete="off" placeholder="Name this recipe"></label>
      <div class="where review-where"><span class="muted">Adding to</span><span class="pill-sel"><select name="meal" aria-label="Meal">${Object.entries(MEAL_NAMES).map(([k,n])=>`<option value="${k}"${k===chosen?' selected':''}>${n}</option>`).join('')}</select>${svg('chev')}</span><span class="muted">today</span></div>
      <div id="review-foods"></div><div class="review-total" id="review-totals"></div>
      <label class="switch-row"><span><b>Save as a recipe</b><small>Reuse it from My Recipes next time</small></span><input type="checkbox" role="switch" name="save_recipe"${saveRecipe?' checked':''}></label>
      <div id="review-recipe" hidden>
        <label>How is the whole recipe measured?<select name="basis"><option value="">Choose servings or weight</option><option value="servings">By servings</option><option value="weight">By cooked weight</option></select></label>
        <label id="review-yield" hidden>Servings in the whole recipe<input name="servings" inputmode="decimal" placeholder="How many does it make?"></label>
        <label id="review-weight" hidden>Whole cooked weight (g)<input name="total_g" inputmode="decimal" placeholder="Enter the total cooked weight"></label>
        <label class="check"><input type="checkbox" name="log_today" checked>Also add what I ate to today’s log</label>
        <div id="review-log-amount"><label>What I ate<select name="amount_kind"><option value="whole">Everything listed above</option><option value="portion">Part of this recipe</option></select></label>
          <label id="review-portion" hidden><span id="review-portion-label">Your portion</span><input name="portion" inputmode="decimal" placeholder="How much did you eat?"></label>
          <div id="review-portion-nutrition" aria-live="polite"></div></div>
      </div>
      <p class="err" id="review-error" role="status"></p><button class="primary wide" id="review-confirm">Add to log</button>
    </form>`,(body,close)=>{
      guardFoodSheet(body,close,owner);const f=$('#food-final-review',body),save=f.elements.save_recipe,log=f.elements.log_today;
      const valid=()=>active()&&owner===readOwner()&&body.isConnected;
      const shown=()=>review.foods.map((e,i)=>edited(e,kcal[i]));
      const totals=()=>{const foods=shown();return Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,foods.some(e=>!nutrientKnown(e,k))?null:foods.reduce((n,e)=>n+e[k],0)]));};
      const foods=()=>{
        $('#review-foods',body).innerHTML=shown().map((e,i)=>`<div class="review-food-row"><div><b>${esc(e.name)}</b><small class="tf-macros">${esc(FoodNutrition.macros(e))}</small><small class="muted">${esc(fmtAmount(e))} · ${esc(FoodThread.source(e))}${kcal[i]!=null?' · Edited':''}</small></div><button type="button" class="kcal-edit num" data-kcal="${i}" aria-label="Change calories for ${esc(e.name)}">${e.kcal==null?'Add':homeCalories(e.kcal)}<small> kcal</small></button></div>`).join('');
        const T=totals(),g=k=>T[k]==null?`${k.split('_')[0]} unknown`:`${Math.round(T[k])} g ${k.split('_')[0]}`;
        $('#review-totals',body).innerHTML=`<div><span>Total</span><b class="num">≈ ${homeCalories(T.kcal||0)} kcal</b></div><small class="muted">${esc([g('protein_g'),g('carbs_g'),g('fat_g')].filter(Boolean).join(' · '))}</small>`;
        // Tap a calorie number to change it in place: a small number box, Enter or tapping away saves, Esc cancels.
        $$('[data-kcal]',body).forEach(b=>b.onclick=()=>{
          const i=+b.dataset.kcal,box=document.createElement('span');box.className='kcal-box';
          box.innerHTML=`<input type="number" inputmode="numeric" min="0" max="5000" step="1" value="${Math.round(shown()[i].kcal??0)}" aria-label="Calories for ${esc(review.foods[i].name)}"><small>kcal</small>`;
          b.replaceWith(box);const input=$('input',box);input.focus();input.select();let finished=false;
          const finish=keep=>{if(finished)return;finished=true;const v=Number(input.value);
            if(keep&&input.value.trim()!==''&&Number.isFinite(v)&&v>=0&&v<=5000){if(Math.round(v)===Math.round(review.foods[i].kcal??-1))delete kcal[i];else kcal[i]=Math.round(v);}
            foods();draw();Native.haptic?.('selection');};
          input.onblur=()=>finish(true);
          input.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();finish(true);}else if(ev.key==='Escape'){ev.preventDefault();finish(false);}};
        });
      };
      const draw=()=>{
        const recipe=save.checked,logging=!recipe||log.checked,basis=f.elements.basis.value,portion=recipe&&logging&&f.elements.amount_kind.value==='portion';
        $('#review-recipe-name',body).hidden=!recipe;$('#review-recipe',body).hidden=!recipe;$('.review-where',body).hidden=!logging;
        $('#review-yield',body).hidden=basis!=='servings';$('#review-weight',body).hidden=basis!=='weight';
        $('#review-log-amount',body).hidden=!logging;
        $('#review-portion',body).hidden=!portion;$('#review-portion-label',body).textContent=basis==='weight'?'Grams you ate':'Servings you ate';
        f.elements.name.required=recipe;f.elements.basis.required=recipe;
        f.elements.servings.required=recipe&&basis==='servings';f.elements.total_g.required=recipe&&basis==='weight';f.elements.portion.required=portion;
        const total=basis==='weight'?number(f.elements.total_g):number(f.elements.servings),amount=number(f.elements.portion),factor=portion&&total>0&&amount>0?amount/total:1,T=totals();
        $('#review-portion-nutrition',body).innerHTML=portion&&total>0&&amount>0?`<p class="small muted">Nutrition for your portion</p>${nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,T[k]==null?null:T[k]*factor])))}`:'';
        const where=MEAL_NAMES[f.elements.meal.value]||'your log';
        $('#review-confirm',body).textContent=recipe&&logging?`Save recipe and add to ${where}`:recipe?'Save recipe':`Add to ${where}`;
      };
      if(draftForm)for(const control of [...f.elements])if(control.name&&Object.hasOwn(draftForm,control.name)){
        if(control.type==='checkbox')control.checked=!!draftForm[control.name];else control.value=String(draftForm[control.name]??'');
      }
      for(const control of [...f.elements])control.addEventListener('input',()=>{
        rememberForm(Object.fromEntries([...f.elements].filter(x=>x.name&&x.type!=='number').map(x=>[x.name,x.type==='checkbox'?x.checked:x.value])));draw();
      });
      foods();draw();
      f.onsubmit=async e=>{
        e.preventDefault();if(!valid())return;
        const focused=document.activeElement;if(focused?.closest?.('.kcal-box')){focused.blur();return;}   // Enter in a calorie box saves that box first
        const recipe=save.checked,logging=!recipe||log.checked,part=recipe&&logging&&f.elements.amount_kind.value==='portion';
        if(logging&&!f.elements.meal.value){$('#review-error',body).textContent='Choose a meal.';return;}
        const basis=recipe?f.elements.basis.value:'amounts';
        const request={confirm:true,save_recipe:recipe,log_today:logging,name:recipe?f.elements.name.value.trim():null,meal:logging?f.elements.meal.value:null,
          basis,servings:basis==='servings'?number(f.elements.servings):null,total_g:basis==='weight'?number(f.elements.total_g):null,whole:!part,portion:part?number(f.elements.portion):null,
          ...(Object.keys(kcal).length?{kcal:Object.fromEntries(Object.entries(kcal).map(([i,v])=>[String(i),v]))}:{})};
        const button=$('#review-confirm',body),label=button.textContent;button.disabled=true;button.textContent='Saving…';$('#review-error',body).textContent='';
        sending.add(owner);changed();
        try{
          const result=await sendOrQueue(`/api/food/thread/reviews/${prepared.id}/confirm`,'POST',request,'Food review');
          if(owner!==readOwner())return;
          if(!result.queued)await accept(result);
          App.cache.delete('/api/dishes');invalidate('/api/food');
          if(!valid())return;close();done(result);
          toast(result.queued?'Saved on this phone · waiting to send':recipe&&logging?'Recipe saved and added to your log':recipe?'Recipe saved for later':'Added to your log');
        }catch(error){
          if(!valid())return;
          if(error.payload?.changed&&error.payload.review){review=error.payload.review;kcal={};foods();draw();}
          $('#review-error',body).textContent=error.message;button.disabled=false;button.textContent=label;
        } finally {sending.delete(owner);changed();}
      };
    });
  }
  return {open,busy:()=>sending.has(readOwner())};
})();
