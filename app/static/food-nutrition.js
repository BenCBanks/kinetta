// Read-only nutrition previews use the same unrounded amounts sent for review.
'use strict';
const FoodNutrition=(()=>{
  const values=e=>Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,nutrientKnown(e,k)?e[k]:null]));
  const multiply=(v,f)=>Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,v[k]==null?null:v[k]*f]));
  function rounded(k,v){
    if(v==null)return null;const f=10**(['sodium_mg','sugar_g','saturated_fat_g'].includes(k)?4:1),n=v*f,low=Math.floor(n);
    return (Math.abs(n-low-.5)<1e-9?(low%2?low+1:low):Math.round(n))/f;
  }
  function scale(e,amount,fromSource=false){
    let v=multiply(values(e),amount/e.amount);const ref=e.ref||{},src=ref.origin_ref||ref;
    if(fromSource){
      if(ref.origin==='catalog'&&src.per100&&(e.unit==='g'||e.unit==='serving'&&src.serving?.g>0))v=multiply(src.per100,(e.unit==='g'?amount:amount*src.serving.g)/100);
      else if(ref.per_serving&&(e.unit==='serving'||e.unit==='g'&&ref.serving?.g>0))v=multiply(ref.per_serving,e.unit==='g'?amount/ref.serving.g:amount);
    }
    return {...e,amount,...Object.fromEntries(FOOD_NUTRIENTS.map(k=>[k,rounded(k,v[k])]))};
  }
  const macros=e=>MACROS.map(([k,name])=>`${name} ${nutrientKnown(e,k)?r1(e[k])+' g':'unknown'}`).join(' · ');
  function basis(e){
    const ref=e.ref||{},src=ref.origin_ref||ref,serving=src.serving||ref.serving||{};
    if(src.per_serving)return {label:serving.label||'1 serving',values:values({...src.per_serving,ref:{unknown_nutrients:src.unknown_nutrients}}),factor:src.basis_unit===e.unit&&src.basis_amount>0?e.amount/src.basis_amount:portionFactor(e,serving)};
    if(src.per100){
      // Older catalog records did not distinguish a 100 g fallback from a
      // declared serving. Per 100 g is the honest comparison in that case.
      const declared=serving.g>0&&!serving.is_default&&(serving.g!==100||serving.is_default===false||!['off','usda'].includes(src.source)),g=declared?serving.g:100;
      return {label:declared?(serving.label||`${r1(g)} g`):'100 g',per100:!declared,
        note:!declared&&serving.label&&serving.label!=='100 g'?`Source serving: ${serving.label}. Its weight is unavailable.`:'',
        values:multiply(src.per100,g/100),factor:e.unit==='g'?e.amount/g:e.unit==='serving'?e.amount*(serving.g||0)/g:null};
    }
    if(e.unit==='serving'&&e.amount>0)return {label:serving.label||'1 serving',values:multiply(values(e),1/e.amount),factor:e.amount};
    if(serving.g>0&&e.unit==='g')return {label:serving.label||`${r1(serving.g)} g`,values:multiply(values(e),serving.g/e.amount),factor:e.amount/serving.g};
    return {label:'Serving unavailable',values:{},factor:null};
  }
  function portionFactor(e,serving){return e.unit==='serving'?e.amount:e.unit==='g'&&serving.g>0?e.amount/serving.g:null;}
  function html(e,source){
    const b=basis(e),rows=[['kcal','Calories','kcal'],['fat_g','Fat','g'],['saturated_fat_g','Saturated fat','g'],['carbs_g','Carbohydrates','g'],['fiber_g','Fibre','g'],['sugar_g','Sugars','g'],['protein_g','Protein','g'],['sodium_mg','Sodium','mg']];
    const ref=e.ref||{},src=ref.origin_ref||ref;
    return `<div class="food-label"><p class="food-label-source">${e.brand?`<b>${esc(e.brand)}</b> · `:''}${esc(source)}</p>${src.package_size?`<p class="small muted">Package: ${esc(src.package_size)}</p>`:''}
      <table role="table"><caption class="vh">Nutrition for ${esc(e.name)}</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Nutrition</th><th role="columnheader" scope="col">${b.per100?'Per 100 g':'Per serving'}<small>${esc(b.label)}</small></th><th role="columnheader" scope="col">Chosen amount<small>${esc(fmtAmount(e))}</small></th></tr></thead><tbody role="rowgroup">${rows.filter(([k])=>['kcal','protein_g','carbs_g','fat_g'].includes(k)||nutrientKnown(e,k)||b.values[k]!=null).map(([k,label,unit])=>`<tr role="row"><th role="rowheader" scope="row">${label}</th><td role="cell" class="num">${nutrientNumber(b.values[k]??null,unit)}</td><td role="cell" class="num">${nutrientNumber(nutrientKnown(e,k)?e[k]:null,unit)}</td></tr>`).join('')}</tbody></table>
      ${b.note?`<p class="small muted">${esc(b.note)}</p>`:''}${ref.origin==='ai'?'<p class="small muted">Kit’s estimate. Check and change it before logging.</p>':''}</div>`;
  }
  return {values,scale,macros,basis,html};
})();
