// A single final review for entered food: saving a recipe and logging are independent choices.
'use strict';
const FoodReview=(()=>{
  const sending=new Set();
  const changed=()=>dispatchEvent(new CustomEvent('food:review-state'));
  const number=input=>{const text=input.value.trim();return text===''?null:Number(text.replace(',','.'));};
  async function open({messages,draftId,meal,saveRecipe=false,draftForm=null,rememberForm=()=>{},active,accept}){
    const owner=readOwner(),id=newId();let prepared;
    try{prepared=await api('/api/food/thread/reviews',json('POST',{client_id:id,draft_id:draftId,messages}));}
    catch(e){toast(e.message);return;}
    if(!active()||owner!==readOwner())return;
    let review=prepared.review;
    // "Add to log" (owner, 19 Oct 2026): foods, one total, meal, one button. Recipe options sit behind a link.
    const chosen=Object.hasOwn(MEAL_NAMES,meal)?meal:guessMeal();
    sheet('Add to log',`<form class="form food-final-review" id="food-final-review">
      <div id="review-foods"></div><p class="review-total" id="review-totals"></p>
      <fieldset class="review-meals"><legend>Meal</legend>${Object.entries(MEAL_NAMES).map(([k,n])=>`<label><input type="radio" name="meal" value="${k}"${k===chosen?' checked':''}><span>${n}</span></label>`).join('')}</fieldset>
      <p class="err" id="review-error" role="status"></p><button class="primary wide" id="review-confirm">Add to log</button>
      <details class="review-more"${saveRecipe?' open':''}><summary>Save as a recipe, or log part of it</summary>
      <label class="check"><input type="checkbox" name="save_recipe"${saveRecipe?' checked':''}>Save as a recipe for later</label>
      <div id="review-name" hidden><label>Recipe name<input name="name" maxlength="80" autocomplete="off" placeholder="Name this recipe"></label></div>
      <div id="review-recipe-basis" hidden><h3>Whole recipe</h3><label>How is the whole recipe measured?<select name="basis"><option value="">Choose servings or weight</option><option value="servings">By servings</option><option value="weight">By cooked weight</option></select></label>
        <label id="review-yield" hidden>Servings in the whole recipe<input name="servings" inputmode="decimal" placeholder="How many does it make?"></label>
        <label id="review-weight" hidden>Whole cooked weight (g)<input name="total_g" inputmode="decimal" placeholder="Enter the total cooked weight"></label>
      </div>
      <label class="check"><input type="checkbox" name="log_today" checked>Add to today’s log</label>
      <div id="review-log-amount"><label>Amount to log<select name="amount_kind"><option value="whole">Everything listed above</option><option value="portion">Part of this recipe</option></select></label>
        <label id="review-portion" hidden><span id="review-portion-label">Your portion</span><input name="portion" inputmode="decimal" placeholder="How much did you eat?"></label>
      </div>
      <p class="small muted" id="review-explanation"></p><div id="review-portion-nutrition" aria-live="polite"></div></details>
    </form>`,(body,close)=>{
      guardFoodSheet(body,close,owner);const f=$('#food-final-review',body),save=f.elements.save_recipe,log=f.elements.log_today;
      const valid=()=>active()&&owner===readOwner()&&body.isConnected;
      const foods=()=>{const T=review.totals||{},g=k=>T[k]==null?null:`${Math.round(T[k])} g ${k.split('_')[0]}`;
        $('#review-foods',body).innerHTML=review.foods.map(e=>`<div class="review-food-row"><div><b>${esc(e.name)}</b><small class="muted">${esc(fmtAmount(e))} · ${esc(FoodThread.source(e))}</small></div><span class="num">${e.kcal==null?'':homeCalories(e.kcal)+' kcal'}</span></div>`).join('');
        $('#review-totals',body).innerHTML=`<b>≈ ${homeCalories(T.kcal||0)} kcal</b><small class="muted">${esc([g('protein_g'),g('carbs_g'),g('fat_g')].filter(Boolean).join(' · '))}</small>`;};
      const draw=()=>{
        const recipe=save.checked,basis=f.elements.basis.value,portion=log.checked&&f.elements.amount_kind.value==='portion';
        $('#review-name',body).hidden=!recipe;$('#review-recipe-basis',body).hidden=!recipe&&!portion;
        $('#review-yield',body).hidden=basis!=='servings';$('#review-weight',body).hidden=basis!=='weight';
        $('.review-meals',body).hidden=!log.checked;$('#review-log-amount',body).hidden=!log.checked;
        $('#review-portion',body).hidden=!portion;$('#review-portion-label',body).textContent=basis==='weight'?'Grams you ate':'Servings you ate';
        f.elements.name.required=recipe;f.elements.basis.required=recipe||portion;
        f.elements.servings.required=(recipe||portion)&&basis==='servings';f.elements.total_g.required=(recipe||portion)&&basis==='weight';f.elements.portion.required=portion;
        $('#review-explanation',body).textContent=recipe?'The foods above are the whole recipe. Choose its yield separately from how much you ate.':log.checked?'The entered food amounts will be logged. Saving a recipe is optional.':'Choose logging, saving a recipe, or both.';
        const total=basis==='weight'?number(f.elements.total_g):number(f.elements.servings),amount=number(f.elements.portion),factor=portion&&total>0&&amount>0?amount/total:1;
        $('#review-portion-nutrition',body).innerHTML=portion&&total>0&&amount>0?`<p class="small muted">Nutrition for your portion</p>${nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,review.totals[k]==null?null:review.totals[k]*factor])))}`:'';
        $('#review-confirm',body).textContent=recipe&&log.checked?'Save recipe and add to log':recipe?'Save recipe':'Add to log';
      };
      if(draftForm)for(const control of [...f.elements])if(control.name&&Object.hasOwn(draftForm,control.name)){
        if(control.type==='checkbox')control.checked=!!draftForm[control.name];else if(control.type==='radio')control.checked=control.value===draftForm[control.name];else control.value=String(draftForm[control.name]??'');
      }
      for(const control of [...f.elements])control.addEventListener('input',()=>{
        rememberForm(Object.fromEntries([...f.elements].filter(x=>x.name&&(x.type!=='radio'||x.checked)).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value])));draw();
      });
      foods();draw();
      f.onsubmit=async e=>{
        e.preventDefault();if(!valid())return;
        const recipe=save.checked,logging=log.checked,part=logging&&f.elements.amount_kind.value==='portion';
        if(!recipe&&!logging){$('#review-error',body).textContent='Choose logging, saving a recipe, or both.';return;}
        if(logging&&!f.elements.meal.value){$('#review-error',body).textContent='Choose a meal.';return;}
        const basis=recipe||part?f.elements.basis.value:'amounts';
        const request={confirm:true,save_recipe:recipe,log_today:logging,name:recipe?f.elements.name.value.trim():null,meal:logging?f.elements.meal.value:null,
          basis,servings:basis==='servings'?number(f.elements.servings):null,total_g:basis==='weight'?number(f.elements.total_g):null,whole:!part,portion:part?number(f.elements.portion):null};
        const button=$('#review-confirm',body),label=button.textContent;button.disabled=true;button.textContent='Saving…';$('#review-error',body).textContent='';
        sending.add(owner);changed();
        try{
          const result=await sendOrQueue(`/api/food/thread/reviews/${prepared.id}/confirm`,'POST',request,'Food review');
          if(owner!==readOwner())return;
          if(!result.queued)await accept(result);
          App.cache.delete('/api/dishes');invalidate('/api/food');
          if(!valid())return;close();
          toast(result.queued?'Saved on this phone · waiting to send':recipe&&logging?'Recipe saved and added to your log':recipe?'Recipe saved for later':'Added to your log');
        }catch(error){
          if(!valid())return;
          if(error.payload?.changed&&error.payload.review){review=error.payload.review;foods();draw();}
          $('#review-error',body).textContent=error.message;button.disabled=false;button.textContent=label;
        } finally {sending.delete(owner);changed();}
      };
    });
  }
  return {open,busy:()=>sending.has(readOwner())};
})();
