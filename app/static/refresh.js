// Read-only screens refresh in place; chats, forms, maps and recording keep their gestures.
'use strict';
IC.refresh='<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M18 17a7 7 0 0 1-12 1l-2-3"/>';
const PageRefresh=(()=>{
  const homes=new Set(['/me','/activity','/progress','/food']);
  let busy=false,failure=null,start=null,indicator=null,suppressClickUntil=0;
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
    notice('Refreshing…');
    App.scroll[key]=scrollY;
    invalidate('/api/',{health:false,keepData:true});
    if(typeof Social!=='undefined')Social.at=0;
    if(typeof SocialData!=='undefined')SocialData.invalidate();
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
    finally{busy=false;failure=null;hide();}
  }
  // The title and numbers are one large link. A vertical pull there should work
  // just like a pull on the surrounding card; ordinary taps still open it.
  const excluded=target=>!!target.closest('input,textarea,select,button,a:not(.post-link):not(.tfood-details):not(.latest-activity-link),[contenteditable],.leaflet-container,.media-gallery,.activity-media,.chart,.scrim,.ph-view');
  const reset=()=>{start=null;if(!busy)hide();};
  document.addEventListener('touchstart',event=>{
    suppressClickUntil=0;
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
    start.distance=Math.min(dy*.6,100);notice(start.distance>=54?'Release to refresh':'Pull to refresh');
    indicator.style.transform='translateY('+Math.round(Math.min(start.distance,54))+'px)';
  },{passive:false});
  document.addEventListener('touchend',()=>{const pulled=start?.distance>0,ready=start?.distance>=54;reset();if(pulled)suppressClickUntil=Date.now()+700;if(ready)run();},{passive:true});
  // Some WebViews synthesize a link click after a drag. Consume only that click,
  // and clear the guard on the next intentional touch or keyboard activation.
  document.addEventListener('click',event=>{if(event.detail!==0&&Date.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('pointerdown',()=>{suppressClickUntil=0;},{passive:true});
  document.addEventListener('touchcancel',reset,{passive:true});
  return {available,run,failed};
})();
