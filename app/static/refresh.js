// Read-only screens refresh in place; chats, forms, maps and recording keep their gestures.
// The page follows the finger down and a small spinner turns in the gap above it; on release the page rests just
// below the spinner until fresh data arrives, then slides back. No text pill (Ben, 23 October: the old labels
// jittered and weren't needed). Screen readers still hear the status, and a failed refresh still says so.
'use strict';
IC.refresh='<path d="M20 11a8 8 0 1 0-2.34 6.66"/><path d="M20 4v7h-7"/>';
const PageRefresh=(()=>{
  const homes=new Set(['/me','/activity','/progress','/food']);
  const READY=56,HOLD=56,MAX=110;   // pull distance (px, after resistance) that refreshes, where the page rests, the furthest it goes
  let busy=false,failure=null,start=null,spinner=null,status=null,pulled=false,settleT=0,suppressClickUntil=0;
  const pageKey=()=>location.pathname+location.search;
  const available=()=>!!App.me&&homes.has(location.pathname)&&!document.querySelector('.scrim,.ph-view,.map-full')&&!document.documentElement.classList.contains('keyboard-open')&&!document.activeElement?.matches('input,textarea,select,[contenteditable]')&&!document.querySelector('.me-settings[open]');
  // mode: 'drag' follows the finger exactly; 'hold' and 'rest' glide to their place
  function pose(distance,mode){
    if(!spinner){
      spinner=document.createElement('div');spinner.className='ptr';spinner.setAttribute('aria-hidden','true');
      spinner.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'+IC.refresh+'</svg>';
      document.body.append(spinner);
    }
    const view=document.getElementById?.('page'),glide=mode!=='drag';
    clearTimeout(settleT);pulled=distance>0;
    if(view){view.style.transition=glide?'transform .3s cubic-bezier(.2,.8,.2,1)':'none';view.style.transform=distance?`translate3d(0,${distance.toFixed(2)}px,0)`:'';}
    spinner.className='ptr'+(glide?' glide':'')+(mode==='hold'?' spinning':'');
    // Centred in the gap the pull opens and visible almost at once: a pull that shows only empty space
    // looked broken (Ben, 25 October).
    spinner.style.opacity=String(Math.min(1,distance/24));
    spinner.style.transform=`translate3d(-50%,${(distance*.5-24).toFixed(2)}px,0)`;
    if(mode==='drag'){spinner.style.setProperty('--refresh-angle',`${distance*4}deg`);$('svg',spinner).style.transform=`rotate(${distance*4}deg)`;}
    else if(mode==='hold')$('svg',spinner).style.transform='';
    // once the page is back in place, drop the transition so it can't affect anything else
    if(!distance&&view)settleT=setTimeout(()=>{if(!pulled)view.style.transition='';},320);
  }
  function say(text){
    if(!status){status=document.createElement('div');status.className='vh';status.setAttribute('role','status');document.body.append(status);}
    status.textContent=text;
  }
  function failed(error){if(busy)failure=error;}
  async function run(){
    if(busy||!available())return;
    const owner=readOwner(),key=pageKey();busy=true;failure=null;start=null;
    pose(HOLD,'hold');say('Refreshing');
    App.scroll[key]=scrollY;
    invalidate('/api/',{health:false,keepData:true});
    if(typeof Social!=='undefined')Social.at=0;
    if(typeof SocialData!=='undefined')SocialData.invalidate();
    try{const work=render();pose(HOLD,'hold');await work;
      // Some home cards start their own reads after the route's first render.
      // Keep the spinner until those reads (and their dependent reads) settle.
      for(let pass=0;pass<5&&owner===readOwner()&&key===pageKey();pass++){
        const reads=typeof pendingReads==='undefined'?[]:[...pendingReads].filter(([k])=>JSON.parse(k)[0]===owner).map(([,promise])=>promise);
        if(!reads.length)break;
        const results=await Promise.allSettled(reads);failure||=results.find(r=>r.status==='rejected')?.reason;
      }
      if(owner===readOwner()&&key===pageKey()){
        if(failure||App.offline)toast('Couldn’t refresh. Your saved view is kept.');
        else say('Up to date');
      }}
    catch(e){if(owner===readOwner()&&key===pageKey())toast(e.message);}
    finally{busy=false;failure=null;pose(0,'rest');}
  }
  // The title and numbers are one large link. A vertical pull there should work
  // just like a pull on the surrounding card; ordinary taps still open it.
  const excluded=target=>!!target.closest('input,textarea,select,button,a:not(.post-link):not(.tfood-details):not(.latest-activity-link),[contenteditable],.leaflet-container,.media-gallery,.activity-media,.chart,.scrim,.ph-view');
  const reset=()=>{start=null;if(!busy&&pulled)pose(0,'rest');};
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
    start.distance=Math.min(dy*.6,MAX);pose(start.distance,'drag');
  },{passive:false});
  document.addEventListener('touchend',()=>{
    const moved=start?.distance>0,ready=start?.distance>=READY;start=null;
    if(moved)suppressClickUntil=Date.now()+700;
    if(ready)run();else if(!busy&&pulled)pose(0,'rest');
  },{passive:true});
  // Some WebViews synthesize a link click after a drag. Consume only that click,
  // and clear the guard on the next intentional touch or keyboard activation.
  document.addEventListener('click',event=>{if(event.detail!==0&&Date.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('pointerdown',()=>{suppressClickUntil=0;},{passive:true});
  document.addEventListener('touchcancel',reset,{passive:true});
  return {available,run,failed};
})();
