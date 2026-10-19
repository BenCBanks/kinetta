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
    sheet('Review food',`<form class="form food-final-review" id="food-final-review">
      <div id="review-foods"></div><div id="review-totals"></div>
      <label class="check"><input type="checkbox" name="save_recipe"${saveRecipe?' checked':''}>Save as a recipe for later</label>
      <div id="review-name" hidden><label>Recipe name<input name="name" maxlength="80" autocomplete="off" placeholder="Name this recipe"></label></div>
      <div id="review-recipe-basis" hidden><h3>Whole recipe</h3><label>How is the whole recipe measured?<select name="basis"><option value="">Choose servings or weight</option><option value="servings">By servings</option><option value="weight">By cooked weight</option></select></label>
        <label id="review-yield" hidden>Servings in the whole recipe<input name="servings" inputmode="decimal" placeholder="How many does it make?"></label>
        <label id="review-weight" hidden>Whole cooked weight (g)<input name="total_g" inputmode="decimal" placeholder="Enter the total cooked weight"></label>
      </div>
      <label class="check"><input type="checkbox" name="log_today" checked>Log food today</label>
      <div id="review-destination"><h3>Your food today</h3><label>Meal today<select name="meal"><option value="">Choose a meal</option>${Object.entries(MEAL_NAMES).map(([k,n])=>`<option value="${k}"${k===meal?' selected':''}>${n}</option>`).join('')}</select></label></div>
      <div id="review-log-amount"><label>Amount to log<select name="amount_kind"><option value="whole">The entered amounts above</option><option value="portion">A portion of this recipe</option></select></label>
        <label id="review-portion" hidden><span id="review-portion-label">Your portion</span><input name="portion" inputmode="decimal" placeholder="How much did you eat?"></label>
      </div>
      <p class="small muted" id="review-explanation"></p><div id="review-portion-nutrition" aria-live="polite"></div>
      <p class="err" id="review-error" role="status"></p><button class="primary wide" id="review-confirm">Confirm</button>
    </form>`,(body,close)=>{
      guardFoodSheet(body,close,owner);const f=$('#food-final-review',body),save=f.elements.save_recipe,log=f.elements.log_today;
      const valid=()=>active()&&owner===readOwner()&&body.isConnected;
      const foods=()=>{$('#review-foods',body).innerHTML=review.foods.map(e=>`<div class="review-food-row"><div><b>${esc(e.name)}</b><small class="muted">${esc(FoodThread.source(e))}</small></div><span>${esc(fmtAmount(e))}</span></div>`).join('');$('#review-totals',body).innerHTML=nutGrid(review.totals);};
      const draw=()=>{
        const recipe=save.checked,basis=f.elements.basis.value,portion=log.checked&&f.elements.amount_kind.value==='portion';
        $('#review-name',body).hidden=!recipe;$('#review-recipe-basis',body).hidden=!recipe&&!portion;
        $('#review-yield',body).hidden=basis!=='servings';$('#review-weight',body).hidden=basis!=='weight';
        $('#review-destination',body).hidden=!log.checked;$('#review-log-amount',body).hidden=!log.checked;
        $('#review-portion',body).hidden=!portion;$('#review-portion-label',body).textContent=basis==='weight'?'Grams you ate':'Servings you ate';
        f.elements.name.required=recipe;f.elements.meal.required=log.checked;f.elements.basis.required=recipe||portion;
        f.elements.servings.required=(recipe||portion)&&basis==='servings';f.elements.total_g.required=(recipe||portion)&&basis==='weight';f.elements.portion.required=portion;
        $('#review-explanation',body).textContent=recipe?'The foods above are the whole recipe. Choose its yield separately from how much you ate.':log.checked?'The entered food amounts will be logged. Saving a recipe is optional.':'Choose logging, saving a recipe, or both.';
        const total=basis==='weight'?number(f.elements.total_g):number(f.elements.servings),amount=number(f.elements.portion),factor=portion&&total>0&&amount>0?amount/total:1;
        $('#review-portion-nutrition',body).innerHTML=portion&&total>0&&amount>0?`<p class="small muted">Nutrition for your portion</p>${nutGrid(Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,review.totals[k]==null?null:review.totals[k]*factor])))}`:'';
        $('#review-confirm',body).textContent=recipe&&log.checked?'Save recipe and log food':recipe?'Save recipe':'Log food';
      };
      if(draftForm)for(const control of [...f.elements])if(control.name&&Object.hasOwn(draftForm,control.name)){
        if(control.type==='checkbox')control.checked=!!draftForm[control.name];else control.value=String(draftForm[control.name]??'');
      }
      for(const control of [...f.elements])control.addEventListener('input',()=>{
        rememberForm(Object.fromEntries([...f.elements].filter(x=>x.name).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value])));draw();
      });
      foods();draw();
      f.onsubmit=async e=>{
        e.preventDefault();if(!valid())return;
        const recipe=save.checked,logging=log.checked,part=logging&&f.elements.amount_kind.value==='portion';
        if(!recipe&&!logging){$('#review-error',body).textContent='Choose logging, saving a recipe, or both.';return;}
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
          toast(result.queued?'Review saved on this phone · waiting to send':recipe&&logging?'Recipe saved and food logged':recipe?'Recipe saved for later':'Food logged');
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
