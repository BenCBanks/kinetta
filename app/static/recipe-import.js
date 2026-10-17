'use strict';
const RecipeImport=(()=>{
  const ownerKey=()=>App.me?JSON.stringify([serverKey(),App.me.id]):null;
  const key=owner=>'fit.recipe.draft:'+owner;
  const labels={site:'Published by site',ingredients:'Matched ingredients',estimated_ingredients:'Ingredients · includes AI estimates',entered:'Entered by you',unknown:'Unknown'};
  let current;
  const active=c=>current===c&&c.el.isConnected&&c.owner===ownerKey()&&c.session===readOwner();
  const valid=(c,id)=>active(c)&&c.id===id;
  function remember(c){if(active(c))store.set(key(c.owner),{id:c.id,url:c.url,editor:c.editor,mode:c.mode,at:Date.now()});}
  const kcal=n=>n==null?'Unknown':(n>0&&n<2.5?'&lt;5':Math.round(n/5)*5)+' kcal';
  const grams=n=>n==null?'Unknown':Math.round(n*10)/10+' g';
  function totals(values,sources){return `<dl class="recipe-nutrients">${[['kcal','Calories'],['protein_g','Protein'],['carbs_g','Carbs'],['fat_g','Fat'],['fiber_g','Fiber'],...EXTRA_NUTRIENTS.map(([k,label])=>[k,label])].map(([k,label])=>`<div><dt>${label}</dt><dd><b>${k==='kcal'?kcal(values[k]):nutrientNumber(values[k],k==='sodium_mg'?'mg':'g')}</b>${sources?`<small>${esc(labels[sources[k]]||'Unknown')}</small>`:''}</dd></div>`).join('')}</dl>`;}
  function shell(c,title,content){if(!active(c))return;const changed=c.screen!==title;c.screen=title;c.el.innerHTML=`<div class="top">${backBtn('My Recipes')}</div><h1>${title}</h1><div class="recipe-import">${content}</div>`;wireBack(c.el,'/food/meals');if(changed)window.scrollTo(0,0);}
  function start(c,message=''){
    shell(c,'Recipe from a link',`<p class="muted">Read the recipe, then check its servings and nutrition before saving.</p><form class="form" id="recipe-url-form"><label>Recipe link<input type="url" name="url" value="${esc(c.url||'')}" placeholder="https://…" autocomplete="url" required></label>${message?`<p class="callout" role="status">${esc(message)}</p>`:''}<button class="primary wide" type="submit">Read recipe</button></form><button class="ghost wide" id="recipe-screenshot">Use a recipe screenshot</button><button class="linkbtn" id="recipe-type">Create a recipe yourself</button>`);
    if(!active(c))return;
    const form=$('#recipe-url-form',c.el);form.url.oninput=()=>{c.url=form.url.value;remember(c);};
    form.onsubmit=e=>{e.preventDefault();c.mode='link';c.url=form.url.value.trim();c.id=newId();c.editor=null;remember(c);read(c);};
    $('#recipe-screenshot',c.el).onclick=()=>screenshot(c);
    $('#recipe-type',c.el).onclick=e=>{if(active(c))newDish(e.currentTarget);};
  }
  function screenshot(c){if(!active(c))return;
    if(!aiCan('food')){toast('Recipe screenshots need food AI enabled in Me. You can still create a recipe yourself.');return;}
    const file=document.createElement('input');file.type='file';file.accept='image/*';file.multiple=true;
    file.onchange=async()=>{if(!active(c))return;await reviewFoodPhotos([...file.files],async images=>{if(!active(c))return;c.mode='photo';c.url='';c.id=newId();c.editor=null;c.photos=images;remember(c);await read(c);},{recipe:true,active:()=>active(c)});};file.click();
  }
  function waiting(c,message='Reading this recipe…'){
    shell(c,'Recipe from a link',`<div role="status" aria-live="polite">${skel(2)}<p>${esc(message)}</p></div><button class="ghost wide" id="recipe-cancel">Cancel read</button>`);
    const cancel=$('#recipe-cancel',c.el);if(cancel)cancel.onclick=()=>discard(c);
  }
  async function discard(c){if(!active(c))return;const id=c.id;
    try{if(id)await api('/api/recipe-links/'+id,json('DELETE',{}));if(!valid(c,id))return;c.id=null;c.editor=null;c.review=null;store.del(key(c.owner));start(c,'Draft discarded.');}
    catch(e){if(active(c))toast('Could not discard yet. '+e.message);}
  }
  async function read(c){const id=c.id;waiting(c);try{const data=c.mode==='photo'?(c.photos?await api('/api/recipe-links/photo',json('POST',{client_id:id,images:c.photos})):await api('/api/recipe-links/'+id)):await api('/api/recipe-links/read',json('POST',{client_id:id,url:c.url}));if(valid(c,id)){c.photos=null;receive(c,data);}}catch(e){if(valid(c,id))retry(c,e.message);}}
  function retry(c,message){shell(c,'Recipe from a link',`<p class="callout" role="status">${esc(message)}</p><div class="btncol"><button class="primary wide" id="recipe-retry">Retry read</button><button class="ghost wide" id="recipe-new">Edit link</button><button class="ghost wide" id="recipe-shot">Use a recipe screenshot</button></div>`);
    $('#recipe-retry',c.el).onclick=()=>read(c);$('#recipe-new',c.el).onclick=()=>start(c);$('#recipe-shot',c.el).onclick=()=>screenshot(c);
  }
  function receive(c,data){if(!active(c))return;
    c.data=data;
    if(data.state==='pending'){waiting(c,'Still reading. You can leave this screen and return.');setTimeout(()=>refresh(c),1500);return;}
    if(data.state==='saved'){store.del(key(c.owner));if(data.saved_dish_id){go('/food/cook/'+data.saved_dish_id,{replace:true});}else start(c,'The saved recipe was deleted.');return;}
    if(data.state!=='ready'){
      // A new attempt is created only by the next explicit Retry tap.
      c.id=null;remember(c);
      shell(c,'Recipe from a link',`<p class="callout" role="status">${esc(data.message||'This draft is no longer available.')}</p><button class="primary wide" id="recipe-read-again">${c.mode==='photo'?'Choose screenshot again':'Read link again'}</button><button class="ghost wide" id="recipe-fallback">Use a recipe screenshot</button><button class="linkbtn" id="recipe-change">Edit link</button>`);
      $('#recipe-read-again',c.el).onclick=()=>{if(c.mode==='photo'){screenshot(c);return;}c.id=newId();remember(c);read(c);};$('#recipe-fallback',c.el).onclick=()=>screenshot(c);$('#recipe-change',c.el).onclick=()=>start(c);return;
    }
    if(c.editor&&data.candidates[c.editor.candidate]){editor(c);return;}
    if(data.candidates.length===1){choose(c,0);return;}
    shell(c,'Choose the recipe',`<div class="card list">${data.candidates.map((r,i)=>`<button class="row tap" data-candidate="${i}"><span><b>${esc(r.name)}</b><small>${esc(r.yield_text.join(' · ')||'Check servings')}</small></span>${svg('chev')}</button>`).join('')}</div>`);
    $$('[data-candidate]',c.el).forEach(b=>b.onclick=()=>choose(c,+b.dataset.candidate));
  }
  async function refresh(c){if(!active(c)||!c.id)return;const id=c.id;try{const d=await api('/api/recipe-links/'+id);if(valid(c,id))receive(c,d);}catch(e){if(valid(c,id))retry(c,e.message);}}
  function choose(c,index){const r=c.data.candidates[index];c.editor={candidate:index,name:r.name.slice(0,80),servings:r.servings&&r.servings<=50?r.servings:'',lines:r.ingredients.join('\n'),basis:r.nutrition.calories!=null?'published':'ingredients'};c.review=null;remember(c);editor(c);}
  function capture(c,form){c.revision=(c.revision||0)+1;const e=c.editor;e.name=form.recipe_name.value;e.servings=form.servings.value;e.lines=form.ingredients.value;e.basis=form.basis.value;
    if(e.basis==='entered'||e.valuesDirty){e.valuesRaw=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,form[k].value]));e.values=Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,form[k].value.trim()===''?null:Number(form[k].value.replace(',','.'))]));}remember(c);return {candidate:e.candidate,name:e.name,servings:Number(e.servings.replace?.(',','.')||e.servings),lines:e.lines.split('\n').map(s=>s.trim()).filter(Boolean),basis:e.basis,...(e.values?{values:e.values}:{})};}
  function editor(c,message=''){
    c.revision=(c.revision||0)+1;
    const e=c.editor,r=c.data.candidates[e.candidate],values={kcal:r.nutrition.calories,protein_g:r.nutrition.protein,carbs_g:r.nutrition.carbs,fat_g:r.nutrition.fat,fiber_g:r.nutrition.fiber,sodium_mg:r.nutrition.sodium,sugar_g:r.nutrition.sugar,saturated_fat_g:r.nutrition.saturated_fat,...(e.values||{})};
    shell(c,'Review your recipe',`<p class="small muted">Draft only · nothing is logged or saved to My Recipes yet.</p><form class="form" id="recipe-editor"><label>Recipe name<input name="recipe_name" value="${esc(e.name)}" maxlength="80" required></label><label>Servings in the whole recipe<input name="servings" value="${esc(e.servings)}" inputmode="decimal" required></label>${r.needs_servings_review?`<p class="small muted">The site says ${esc(r.yield_text.join(' · ')||'no clear serving count')}. Enter the number of portions this makes.</p>`:''}<label>Ingredients · one per line<textarea name="ingredients" rows="5" required>${esc(e.lines)}</textarea></label><label for="recipe-basis">Nutrition to use</label><select id="recipe-basis" name="basis"><option value="published"${!r.source_url?' disabled':''}${e.basis==='published'?' selected':''}>Site numbers</option><option value="ingredients"${e.basis==='ingredients'?' selected':''}>Matched ingredients</option><option value="entered"${e.basis==='entered'?' selected':''}>My own numbers</option></select><details${e.basis==='entered'?' open':''}><summary>Per-serving nutrition</summary><p class="small muted">Leave an unknown number blank. A published zero stays zero.</p><div class="recipe-fields">${[['kcal','Calories (kcal)'],['protein_g','Protein (g)'],['carbs_g','Carbs (g)'],['fat_g','Fat (g)'],['fiber_g','Fiber (g)'],...EXTRA_NUTRIENTS.map(([k,label,unit])=>[k,label+' ('+unit+')'])].map(([k,label])=>`<label>${label}<input name="${k}" inputmode="decimal" value="${esc(e.valuesRaw?.[k]??values[k]??'')}"></label>`).join('')}</div></details>${message?`<p class="callout" role="status">${esc(message)}</p>`:''}<p class="small muted">Published numbers describe the site’s original recipe. If you change ingredients, use ingredient totals or enter your own numbers.</p><button class="primary wide" type="submit">Review nutrition</button></form><button class="ghost wide" id="recipe-discard">Discard draft</button>`);
    const form=$('#recipe-editor',c.el);
    form.oninput=ev=>{if(FOOD_NUTRIENTS.includes(ev.target.name))e.valuesDirty=true;capture(c,form);const button=$('button.primary',form);button.disabled=false;button.textContent='Review nutrition';};
    form.basis.onchange=()=>{capture(c,form);if(e.basis==='published'){e.values=null;e.valuesRaw=null;e.valuesDirty=false;}remember(c);editor(c);};
    form.onsubmit=async event=>{event.preventDefault();const id=c.id,body=capture(c,form),revision=c.revision,btn=$('button.primary',form);if(body.values&&Object.values(body.values).some(v=>v!=null&&!Number.isFinite(v))){toast('Check the nutrition numbers; leave unknown values blank.');return;}btn.disabled=true;btn.textContent='Reviewing…';try{const review=await api('/api/recipe-links/'+c.id+'/review',json('POST',body));if(!valid(c,id)||revision!==c.revision)return;c.review=review;preview(c);}catch(x){if(valid(c,id)&&revision===c.revision){btn.disabled=false;btn.textContent='Review nutrition';toast(x.message);}}};
    $('#recipe-discard',c.el).onclick=()=>discard(c);
  }
  function preview(c,message=''){
    c.revision=(c.revision||0)+1;
    const r=c.review;
    shell(c,'Ready to save?',`<div class="card"><h2>${esc(r.name)}</h2><p class="muted">Makes ${esc(r.servings)} servings · amounts below are for one serving.</p>${totals(r.per_serving,r.sources)}${r.source_url?`<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer" class="linkbtn">View original recipe</a>`:'<p class="small muted">Recipe screenshot · AI estimates. Check the assumed amounts.</p>'}</div><details class="card recipe-matches"${r.matching.some(m=>m.source==='ai')?' open':''}><summary>Ingredients and portions</summary>${r.matching.map(m=>`<p><b>${esc(m.text)}</b><br>${m.status==='ready'?(m.source==='ai'?'AI estimate':'Matched to your foods'):'Needs nutrition'}${m.entries?m.entries.map(e=>`<br>${esc(e.name)} · ${esc(e.amount)} ${esc(e.unit)}${e.ref?.origin_notes?`<br>${esc(e.ref.origin_notes)}`:''}`).join(''):''}</p>`).join('')}</details>${r.site_recipe_changed?'<p class="callout">Ingredients changed. The site’s published values still describe its original recipe.</p>':''}${r.pending.length?`<details class="card"${r.sources.kcal==='site'?'':' open'}><summary>Unmatched ingredients (${r.pending.length})</summary><p class="small muted">${r.sources.kcal==='site'?'Optional while using the site’s numbers. Ingredient estimates will not replace published values.':'Their missing values are unknown, not zero.'}${r.totals.kcal==null?' You can save this recipe for later; add calories before logging a portion.':''}</p>${r.matching.map((m,i)=>m.status==='ready'?'':`<div class="recipe-pending"><span>${esc(m.text)}</span>${aiCan('food')?`<button class="ghost sm" data-estimate="${i}">Estimate this ingredient</button>`:''}</div>`).join('')}</details>`:''}<p class="small muted">Saving keeps this recipe private. Log your portion separately from My Recipes.</p>${message?`<p class="callout" role="status">${esc(message)}</p>`:''}<button class="primary wide" id="recipe-save">${r.totals.kcal==null?'Save for later':'Save recipe'}</button><button class="ghost wide" id="recipe-edit">Edit draft</button><button class="linkbtn" id="recipe-discard">Discard draft</button>`);
    $('#recipe-edit',c.el).onclick=()=>editor(c);$('#recipe-discard',c.el).onclick=()=>discard(c);
    $$('[data-estimate]',c.el).forEach(b=>b.onclick=()=>estimate(c,+b.dataset.estimate));
    $('#recipe-save',c.el).onclick=async()=>{const id=c.id,b=$('#recipe-save',c.el);b.disabled=true;b.textContent='Saving…';$('#recipe-edit',c.el).disabled=true;$('#recipe-discard',c.el).disabled=true;try{const saved=await api('/api/recipe-links/'+c.id+'/save',json('POST',{baseline:r.baseline,confirmed:true}));if(!valid(c,id))return;store.del(key(c.owner));invalidate('/api/dishes');go('/food/cook/'+saved.dish.id,{replace:true});toast('Recipe saved. Log a portion from My Recipes.');}catch(e){if(!valid(c,id))return;if(e.status===409){try{c.review=await api('/api/recipe-links/'+c.id+'/review',json('POST',r.input));if(active(c))preview(c,'The recipe changed. Check the updated nutrition, then tap Save again.');}catch(x){if(active(c))editor(c,x.message);}}else if(e.status===404||e.status===410){receive(c,{state:'cancelled',message:e.message});}else{b.disabled=false;b.textContent='Retry save';$('#recipe-edit',c.el).disabled=false;$('#recipe-discard',c.el).disabled=false;toast(e.message);}}};
  }
  function estimate(c,index){const id=c.id,revision=c.revision,line=c.review.matching[index].text;
    sheet('Estimate unmatched ingredient?',`<p>Only <b>${esc(line)}</b> will go to the existing food AI service. Known ingredients and site nutrition stay as they are. Check its assumed portion before saving.</p><button class="primary wide" id="recipe-estimate-confirm">Estimate this ingredient</button><button class="ghost wide" id="recipe-estimate-cancel">Keep it unknown</button>`,(b,close)=>{guardFoodSheet(b,close,c.session);$('#recipe-estimate-cancel',b).onclick=close;$('#recipe-estimate-confirm',b).onclick=async()=>{if(!active(c))return;const btn=$('#recipe-estimate-confirm',b);btn.disabled=true;btn.textContent='Estimating…';const identity=newId();try{const result=await api('/api/recipe-links/'+c.id+'/estimate',json('POST',{candidate:c.editor.candidate,index,client_id:identity,confirmed:true}));if(!valid(c,id))return;close();if(revision!==c.revision){toast('Estimate kept in your draft. Review nutrition when ready.');return;}if(result.processing){preview(c,'An estimate is already running. Keep this draft and review again shortly.');return;}c.review=await api('/api/recipe-links/'+c.id+'/review',json('POST',c.review.input));if(valid(c,id)&&revision===c.revision)preview(c,result.cancelled?'The estimate was cancelled.':'AI estimate added to this draft. Check the portion and numbers.');}catch(e){if(active(c)){btn.disabled=false;btn.textContent='Retry estimate';toast(e.message);}}};});
  }
  async function open(el){const owner=ownerKey();if(!owner)return;const saved=store.get(key(owner));const url=new URLSearchParams(location.search).get('url');const c=current={el,owner,session:readOwner(),id:saved?.id||null,url:url||saved?.url||'',editor:saved?.editor||null,data:null,review:null,mode:saved?.mode||'link'};
    viewResources.set(el,()=>{c.photos=null;if(current===c)current=null;});
    if(url&&url!==saved?.url){c.id=null;c.editor=null;}
    if(c.id){waiting(c,'Opening your draft…');await refresh(c);}else start(c);
  }
  function eraseDevice(){const owner=ownerKey();if(owner)store.del(key(owner));if(current?.owner===owner){current.photos=null;current=null;}}
  return {open,eraseDevice};
})();
route(/^\/food\/recipe-link$/,'food',RecipeImport.open);
