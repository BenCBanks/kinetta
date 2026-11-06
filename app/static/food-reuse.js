'use strict';
// Optional own-food shortcuts never clear the composer or call an AI provider.
function foodReuseChips({box,field,live,choose,day,excluded=()=>[]}){
  let timer,controller,generation=0,busy=false;
  const normalize=value=>String(value||'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const matches=(a,b)=>{const x=normalize(a),y=normalize(b);return !!x&&!!y&&(x===y||x.includes(' '+y+' ')||x.startsWith(y+' ')||x.endsWith(' '+y)||y.includes(' '+x+' ')||y.startsWith(x+' ')||y.endsWith(' '+x));};
  const clear=()=>{clearTimeout(timer);controller?.abort();generation++;box.replaceChildren();box.hidden=true;};
  const update=()=>{
    clear();const text=field.value.trim().slice(0,200),version=generation;
    if(text.length<2||!live())return;
    timer=setTimeout(async()=>{
      if(!live()||version!==generation)return;
      controller=new AbortController();
      try{
        const result=await api('/api/food/meals-chat/reuse?q='+encodeURIComponent(text)+'&day='+encodeURIComponent(day()),{signal:controller.signal});
        if(!live()||version!==generation)return;
        const recent=excluded();let shown=0;
        for(const item of result.items||[]){
          if(recent.some(name=>matches(name,item.name)))continue;
          const button=document.createElement('button');button.type='button';
          const add=document.createElement('span');add.className='reuse-add-icon';add.innerHTML=svg('plus');
          const name=document.createElement('span');name.className='reuse-name';name.textContent=item.name;
          const calories=document.createElement('span');calories.className='reuse-kcal';calories.textContent=' · '+homeCalories(item.totals.kcal)+' kcal';
          button.append(add,name,calories);
          button.setAttribute('aria-label','Add '+item.name+' · '+homeCalories(item.totals.kcal)+' kcal');
          button.onclick=async()=>{if(busy||!live()||version!==generation)return;busy=true;box.querySelectorAll('button').forEach(n=>n.disabled=true);
            try{await choose(item);}finally{busy=false;if(live()&&version===generation)box.querySelectorAll('button').forEach(n=>n.disabled=false);}};
          box.append(button);if(++shown===3)break;
        }
        box.hidden=!box.children.length;
      }catch(_){/* Typing and ordinary food entry remain available without suggestions. */}
    },400);
  };
  field.addEventListener('input',update);update();
  return{clear,refresh:update,dispose(){clear();field.removeEventListener('input',update);}};
}
