// Shared private feature tiles. Keep the original Progress storage key so existing visits remain seen.
'use strict';
const Discovery=(()=>{
  const key=space=>'fit.'+space+':'+JSON.stringify([Native.base||location.origin,App.me.id])+':seen';
  const seen=space=>{const value=store.get(key(space));return Array.isArray(value)?value:[];};
  function visit(space,id){if(!App.me)return;const value=seen(space);if(!value.includes(id))store.set(key(space),[...value,id]);}
  function render(box,items,{space,ready=false,attribute='data-discovery-feature'}={}){
    box.setAttribute('aria-busy',String(!ready));
    const visited=seen(space),ordered=[...items.filter(x=>x.teaser),...items.filter(x=>!x.teaser)];
    box.innerHTML=ordered.map(({id,title,description,icon,href,teaser})=>`<a class="card progress-tile" href="${esc(href)}" ${attribute}="${esc(id)}"><span class="progress-tile-name">${svg(icon)}<b>${esc(title)}</b><span class="progress-new${ready&&!teaser&&!visited.includes(id)?'':' seen'}"${ready&&!teaser&&!visited.includes(id)?' aria-label="New feature"':' aria-hidden="true"'}>New</span></span><span class="small muted">${esc((teaser||description).replace(/ →$/,'\u00a0→'))}</span></a>`).join('');
  }
  function wire(box,space,{attribute='data-discovery-feature'}={}){
    const owner=readOwner();box.addEventListener('click',e=>{const tile=e.target.closest('['+attribute+']');if(tile&&box.contains(tile)&&box.isConnected&&owner===readOwner())visit(space,tile.getAttribute(attribute));});
  }
  return {visit,render,wire};
})();
