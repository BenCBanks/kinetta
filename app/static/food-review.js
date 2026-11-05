// A single final review for entered food: saving a recipe and logging are independent choices.
// Layout (owner, 20 Oct 2026): "Adding to <meal> today", the foods with tappable calories, one total, an optional
// "Save as a recipe" switch that reveals the recipe details, and one button that says what will happen.
'use strict';
const FoodReview=(()=>{
  const sending=new Set();
  const changed=()=>dispatchEvent(new CustomEvent('food:review-state'));
  const number=input=>{const text=input.value.trim();return text===''?null:Number(text.replace(',','.'));};
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const foodStamp=food=>stable({name:food.name,brand:food.brand??null,amount:Number(food.amount),unit:food.unit,
    nutrients:Object.fromEntries(FOOD_NUTRIENTS.map(key=>[key,food[key]??null])),source:food.source??null,ref:food.ref||{}});
  const foodSnapshot=foods=>Array.isArray(foods)?{count:foods.length,stamp:JSON.stringify(foods.map(foodStamp))}:null;
  const sameFoods=(snapshot,prepared)=>!!snapshot&&snapshot.count>0&&Array.isArray(prepared)&&snapshot.count===prepared.length&&
    snapshot.stamp===JSON.stringify(prepared.map(foodStamp));
  const kcalKnown=food=>nutrientKnown(food,'kcal')&&Number.isFinite(Number(food.kcal));
  // A calorie edit scales that food's other nutrients by the same ratio (the server applies the same rule).
  const edited=(e,kcal)=>{if(kcal==null)return e;const original=Number(e.kcal),r=Number.isFinite(original)&&original!==0?kcal/original:null,ref={...(e.ref||{})},out={...e,kcal,ref};
    if(Array.isArray(ref.unknown_nutrients))ref.unknown_nutrients=ref.unknown_nutrients.filter(key=>key!=='kcal');
    if(r!=null)for(const k of FOOD_NUTRIENTS)if(k!=='kcal'&&e[k]!=null)out[k]=e[k]*r;return out;};
  async function open({done=()=>{},messages,selection=null,expectedFoods,quickConfirm=false,draftId,meal,day=null,session=readOwner(),current=()=>true,location=()=>true,saveRecipe=false,draftForm=null,rememberForm=()=>{},active,accept}){
    const owner=readOwner(),expectedSnapshot=foodSnapshot(expectedFoods),messagesSnapshot=Array.isArray(messages)?messages.slice():[],selectionSnapshot=selection?.length?selection.map(item=>({message:item.message,parts:Array.isArray(item.parts)?item.parts.slice():[]})):null,id=newId();
    const stillOwned=()=>owner===readOwner()&&session===readOwner()&&active();
    const stillCurrent=()=>stillOwned()&&current(),stillLocated=()=>stillOwned()&&location();
    let prepared,body={client_id:id,draft_id:draftId,messages:messagesSnapshot};
    if(selectionSnapshot)body.selection=selectionSnapshot;
    try{prepared=await api('/api/food/thread/reviews',json('POST',body));}
    catch(e){if(stillCurrent())toast(e.message);return;}
    if(!stillCurrent())return;
    let review=prepared.review,kcal={},initialError='';
    const chosen=Object.hasOwn(MEAL_NAMES,meal)?meal:guessMeal();
    if(quickConfirm){
      if(sameFoods(expectedSnapshot,review?.foods)&&review.foods.every(kcalKnown)){
        const where=MEAL_NAMES[meal]||MEAL_NAMES[chosen]||'your log',request={confirm:true,save_recipe:false,log_today:true,...(day?{day}:{}),meal:chosen,basis:'amounts',whole:true};
        sending.add(owner);changed();
        try{
          if(!stillCurrent())return;
          const result=await sendOrQueue(`/api/food/thread/reviews/${prepared.id}/confirm`,'POST',request,'Food review');
          if(!stillCurrent())return;
          const accepted=!result.queued;if(accepted)await accept(result);
          if(accepted?!stillLocated():!stillCurrent())return;
          App.cache.delete('/api/dishes');invalidate('/api/food');
          if(accepted?!stillLocated():!stillCurrent())return;
          done(result);toast(result.queued?'Food is waiting to send. It’s not in your log yet.':`Added to ${where}`);return;
        }catch(error){
          if(!stillCurrent())return;
          if(error.payload?.changed&&error.payload.review){review=error.payload.review;initialError='Food details changed. Review the updated numbers before adding them to your log.';}
          else if(error.status>=400&&error.status<500&&![401,403].includes(error.status))initialError=error.message;
          else{toast(error.message);return;}
        }finally{sending.delete(owner);changed();}
      }else initialError='Food details changed. Check the updated amounts before adding them to your log.';
    }
    sheet('Add to log',`<form class="form food-final-review" id="food-final-review">
      <label id="review-recipe-name" hidden>Recipe name<input name="name" maxlength="80" autocomplete="off" placeholder="Name this recipe"></label>
      <div class="where review-where"><span class="muted">Adding to</span><span class="pill-sel"><select name="meal" aria-label="Meal">${Object.entries(MEAL_NAMES).map(([k,n])=>`<option value="${k}"${k===chosen?' selected':''}>${n}</option>`).join('')}</select>${svg('chev')}</span><span class="muted">${esc(day&&day!==isoDay(new Date())?dayLabel(day):'today')}</span></div>
      <div id="review-foods"></div><div class="review-total" id="review-totals"></div>
      <label class="switch-row"><span><b>Save as a recipe</b><small>Reuse it from My Recipes next time</small></span><input type="checkbox" role="switch" name="save_recipe"${saveRecipe?' checked':''}></label>
      <div id="review-recipe" hidden>
        <label>How is the whole recipe measured?<select name="basis"><option value="">Choose servings or weight</option><option value="servings">By servings</option><option value="weight">By cooked weight</option></select></label>
        <label id="review-yield" hidden>Servings in the whole recipe<input name="servings" inputmode="decimal" placeholder="How many does it make?"></label>
        <label id="review-weight" hidden>Whole cooked weight (g)<input name="total_g" inputmode="decimal" placeholder="Enter the total cooked weight"></label>
        <label class="check"><input type="checkbox" name="log_today" checked>Also add what I ate to ${day&&day!==isoDay(new Date())?esc(dayLabel(day))+'’s':'today’s'} log</label>
        <div id="review-log-amount"><label>What I ate<select name="amount_kind"><option value="whole">Everything listed above</option><option value="portion">Part of this recipe</option></select></label>
          <label id="review-portion" hidden><span id="review-portion-label">Your portion</span><input name="portion" inputmode="decimal" placeholder="How much did you eat?"></label>
          <div id="review-portion-nutrition" aria-live="polite"></div></div>
      </div>
      <p class="err" id="review-error" role="status"></p><button class="primary wide" id="review-confirm">Add to log</button>
    </form>`,(body,close)=>{
      guardFoodSheet(body,close,owner);const f=$('#food-final-review',body),save=f.elements.save_recipe,log=f.elements.log_today;
      const valid=()=>stillCurrent()&&body.isConnected;
      const shown=()=>review.foods.map((e,i)=>edited(e,kcal[i]));
      const totals=()=>{const foods=shown();return Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,!foods.length||foods.some(e=>!(k==='kcal'?kcalKnown(e):nutrientKnown(e,k)))?null:foods.reduce((n,e)=>n+Number(e[k]),0)]));};
      const foods=()=>{
        $('#review-foods',body).innerHTML=shown().map((e,i)=>`<div class="review-food-row"><div><b>${esc(e.name)}</b><small class="tf-macros">${esc(FoodNutrition.macros(e))}</small><small class="muted">${esc(fmtAmount(e))} · ${esc(FoodThread.source(e))}${kcal[i]!=null?' · Edited':''}</small></div><button type="button" class="kcal-edit num" data-kcal="${i}" aria-label="${kcalKnown(e)?'Change':'Add'} calories for ${esc(e.name)}">${kcalKnown(e)?homeCalories(e.kcal):'Add'}<small> kcal</small></button></div>`).join('');
        const T=totals(),g=k=>T[k]==null?`${k.split('_')[0]} unknown`:`${Math.round(T[k])} g ${k.split('_')[0]}`;
        $('#review-totals',body).innerHTML=`<div><span>Total</span><b class="num">${T.kcal==null?'Incomplete':'≈ '+homeCalories(T.kcal)+' kcal'}</b></div><small class="muted">${esc([g('protein_g'),g('carbs_g'),g('fat_g')].filter(Boolean).join(' · '))}</small>`;
        // Tap a calorie number to change it in place: a small number box, Enter or tapping away saves, Esc cancels.
        $$('[data-kcal]',body).forEach(b=>b.onclick=()=>{
          const i=+b.dataset.kcal,box=document.createElement('span');box.className='kcal-box';
          box.innerHTML=`<input type="number" inputmode="numeric" min="0" max="5000" step="1" value="${kcalKnown(shown()[i])?Math.round(shown()[i].kcal):''}" aria-label="Calories for ${esc(review.foods[i].name)}"><small>kcal</small>`;
          b.replaceWith(box);const input=$('input',box);input.focus();input.select();let finished=false;
          const finish=keep=>{if(finished)return;finished=true;const v=Number(input.value);
            if(keep&&input.value.trim()!==''&&Number.isFinite(v)&&v>=0&&v<=5000){if(kcalKnown(review.foods[i])&&Math.round(v)===Math.round(review.foods[i].kcal))delete kcal[i];else kcal[i]=Math.round(v);}
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
      foods();draw();if(initialError)$('#review-error',body).textContent=initialError;
      f.onsubmit=async e=>{
        e.preventDefault();if(!valid())return;
        const focused=document.activeElement;if(focused?.closest?.('.kcal-box')){focused.blur();return;}   // Enter in a calorie box saves that box first
        const recipe=save.checked,logging=!recipe||log.checked,part=recipe&&logging&&f.elements.amount_kind.value==='portion';
        if(logging&&!f.elements.meal.value){$('#review-error',body).textContent='Choose a meal.';return;}
        const basis=recipe?f.elements.basis.value:'amounts';
        const request={confirm:true,save_recipe:recipe,log_today:logging,...(day?{day}:{}),name:recipe?f.elements.name.value.trim():null,meal:logging?f.elements.meal.value:null,
          basis,servings:basis==='servings'?number(f.elements.servings):null,total_g:basis==='weight'?number(f.elements.total_g):null,whole:!part,portion:part?number(f.elements.portion):null,
          ...(Object.keys(kcal).length?{kcal:Object.fromEntries(Object.entries(kcal).map(([i,v])=>[String(i),v]))}:{})};
        const button=$('#review-confirm',body),label=button.textContent;button.disabled=true;button.textContent='Saving…';$('#review-error',body).textContent='';
        sending.add(owner);changed();
        try{
          const result=await sendOrQueue(`/api/food/thread/reviews/${prepared.id}/confirm`,'POST',request,'Food review');
          if(!stillCurrent())return;
          const accepted=!result.queued;if(accepted)await accept(result);
          if((accepted?!stillLocated():!stillCurrent())||!body.isConnected)return;
          App.cache.delete('/api/dishes');invalidate('/api/food');
          if((accepted?!stillLocated():!stillCurrent())||!body.isConnected)return;close();done(result);
          toast(result.queued?'Food is waiting to send. It’s not in your log yet.':recipe&&logging?'Recipe saved and added to your log':recipe?'Recipe saved for later':`Added to ${MEAL_NAMES[f.elements.meal.value]||'your log'}`);
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
