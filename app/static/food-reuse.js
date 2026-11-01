'use strict';
// Optional own-food shortcuts never clear the composer or call an AI provider.
function foodReuseChips({box,field,live,choose,day}){
  let timer,controller,generation=0,busy=false;
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
        for(const item of (result.items||[]).slice(0,3)){
          const button=document.createElement('button');button.type='button';button.className='ghost';
          button.textContent='↺ '+item.name+' · '+homeCalories(item.totals.kcal)+' kcal';
          button.setAttribute('aria-label','Reuse '+item.name+' · '+homeCalories(item.totals.kcal)+' kcal');
          button.onclick=async()=>{if(busy||!live()||version!==generation)return;busy=true;box.querySelectorAll('button').forEach(n=>n.disabled=true);
            try{await choose(item);}finally{busy=false;if(live()&&version===generation)box.querySelectorAll('button').forEach(n=>n.disabled=false);}};
          box.append(button);
        }
        box.hidden=!box.children.length;
      }catch(_){/* Typing and ordinary food entry remain available without suggestions. */}
    },400);
  };
  field.addEventListener('input',update);update();
  return{clear,dispose(){clear();field.removeEventListener('input',update);}};
}
