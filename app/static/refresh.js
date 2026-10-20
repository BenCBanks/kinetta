// Read-only screens refresh in place; chats, forms, maps and recording keep their gestures.
'use strict';
IC.refresh='<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M18 17a7 7 0 0 1-12 1l-2-3"/>';
const PageRefresh=(()=>{
  const homes=new Set(['/me','/activity','/progress','/food']);
  let busy=false,failure=null,start=null,indicator=null;
  const pageKey=()=>location.pathname+location.search;
  const available=()=>!!App.me&&homes.has(location.pathname)&&!document.querySelector('.scrim,.ph-view,.map-full')&&!document.documentElement.classList.contains('keyboard-open')&&!document.activeElement?.matches('input,textarea,select,[contenteditable]')&&!document.querySelector('.me-settings[open]');
  function notice(text){
    if(!indicator){indicator=document.createElement('div');indicator.className='page-refresh-notice';indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');document.body.append(indicator);}
    indicator.textContent=text;indicator.hidden=false;
  }
  const hide=()=>{if(indicator){indicator.hidden=true;indicator.style.transform='';}};
  function failed(error){if(busy)failure=error;}
  async function run(){
    if(busy||!available())return;
    const owner=readOwner(),key=pageKey();busy=true;failure=null;start=null;
    notice('Refreshing…');$$('[data-page-refresh]').forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
    App.scroll[key]=scrollY;
    invalidate('/api/',{health:false,keepData:true});
    if(typeof Social!=='undefined')Social.at=0;
    try{await render();
      // Some home cards start their own reads after the route's first render.
      // Keep the refresh status until those reads (and their dependent reads) settle.
      for(let pass=0;pass<5&&owner===readOwner()&&key===pageKey();pass++){
        const reads=typeof pendingReads==='undefined'?[]:[...pendingReads].filter(([k])=>JSON.parse(k)[0]===owner).map(([,promise])=>promise);
        if(!reads.length)break;
        const results=await Promise.allSettled(reads);failure||=results.find(r=>r.status==='rejected')?.reason;
      }
      if(owner===readOwner()&&key===pageKey())toast(failure||App.offline?'Couldn’t refresh. Your saved view is kept.':'Up to date');}
    catch(e){if(owner===readOwner()&&key===pageKey())toast(e.message);}
    finally{busy=false;failure=null;hide();$$('[data-page-refresh]').forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy');});}
  }
  function mounted(el,path){
    if(!homes.has(path)||el.querySelector('[data-page-refresh]'))return;
    const heading=el.querySelector('.top');if(!heading)return;
    const button=document.createElement('button');button.type='button';button.className='icon-btn page-refresh-button';button.dataset.pageRefresh='1';button.setAttribute('aria-label','Refresh page');button.title='Refresh page';button.innerHTML=svg('refresh');button.disabled=busy;button.onclick=run;
    // The Me invitation moved out of the header, leaving room for this action.
    if(path==='/me')heading.querySelector('.acts')?.prepend(button);
    else (heading.querySelector('.acts')||heading).append(button);
  }
  const excluded=target=>!!target.closest('input,textarea,select,button,a,[contenteditable],.leaflet-container,.media-gallery,.activity-media,.chart,.scrim,.ph-view');
  const reset=()=>{start=null;if(!busy)hide();};
  document.addEventListener('touchstart',event=>{
    if(busy||!available()||event.touches.length!==1||scrollY>1||excluded(event.target)||getSelection()?.toString())return reset();
    for(let node=event.target;node&&node!==document.body;node=node.parentElement){if(node.scrollTop>0)return reset();}
    const touch=event.touches[0];start={x:touch.clientX,y:touch.clientY,distance:0,key:pageKey()};
  },{passive:true});
  document.addEventListener('touchmove',event=>{
    if(!start)return;
    if(event.touches.length!==1||!available()||pageKey()!==start.key||scrollY>1)return reset();
    const touch=event.touches[0],dx=Math.abs(touch.clientX-start.x),dy=touch.clientY-start.y;
    if(dy<0||dx>Math.max(12,dy))return reset();
    if(dy<12)return;
    if(event.cancelable)event.preventDefault();
    start.distance=Math.min(dy*.5,100);notice(start.distance>=64?'Release to refresh':'Pull to refresh');
    indicator.style.transform='translateY('+Math.round(Math.min(start.distance,64))+'px)';
  },{passive:false});
  document.addEventListener('touchend',()=>{const ready=start?.distance>=64;reset();if(ready)run();},{passive:true});
  document.addEventListener('touchcancel',reset,{passive:true});
  return {available,run,mounted,failed};
})();
