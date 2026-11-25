// Required app assets must offer recovery instead of leaving a launch mark or an unstyled screen.
'use strict';
globalThis.KinettaBoot=(()=>{
  let failed=false;
  const launching=()=>document.querySelector('#app .launch');
  // The tiny head script runs before the app bundles. As soon as the parser
  // adds #app, replace the generic mark with a route-shaped, data-free shell.
  function showStartupSkeleton(){
    const launch=launching();if(!launch||launch.classList.contains('route-launch'))return false;
    const path=location.pathname.replace(/\/+$/,'')||'/activity';
    if(!/^\/(?:activity|progress|track|food|me|card)(?:\/|$)/.test(path))return false;
    const body=path.startsWith('/food')
      ? '<section class="card sk-card"><div class="sk line tiny"></div><div class="sk big"></div><div class="sk meter"></div><div class="sk line"></div><div class="sk line short"></div></section><section class="card sk-card"><div class="sk line mid"></div><div class="sk-row"><span class="grow"><span class="sk line"></span><span class="sk line tiny"></span></span></div></section>'
      : /^\/activity\/(?:friends\/)?\d+$/.test(path)
        ? '<section class="map-head"><div class="map lead sk" aria-hidden="true"></div></section><section class="card sk-card"><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></section>'
        : path.startsWith('/activity')
          ? '<section class="card sk-card"><div class="sk-row"><span class="sk dot round"></span><span class="grow"><span class="sk line short"></span><span class="sk line tiny"></span></span></div><div class="sk line mid"></div><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div><div class="sk block map"></div></section><section class="card sk-card"><div class="sk-row"><span class="sk dot round"></span><span class="grow"><span class="sk line short"></span><span class="sk line tiny"></span></span></div></section>'
          : path.startsWith('/progress')
            ? '<section class="card sk-card"><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div><div class="sk-bars">'+ '<span class="sk"></span>'.repeat(12) +'</div></section><section class="card sk-card"><div class="sk line mid"></div><div class="sk line"></div></section>'
            : path.startsWith('/track')
              ? '<section class="card sk-card"><div class="sk line mid"></div><div class="sk big"></div><div class="sk-row"><span class="sk dot round"></span><span class="grow"><span class="sk line"></span><span class="sk line tiny"></span></span></div></section>'
              : '<section class="card sk-card"><div class="sk-row"><span class="sk dot round"></span><span class="grow"><span class="sk line mid"></span><span class="sk line tiny"></span></span></div><div class="d-ph-stats"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></section><section class="card sk-card"><div class="sk line mid"></div><div class="sk-bars">'+ '<span class="sk"></span>'.repeat(12) +'</div></section>';
    launch.classList.add('route-launch');
    launch.innerHTML='<div class="launch-skeleton" aria-hidden="true">'+body+'</div>';
    return true;
  }
  if(typeof MutationObserver!=='undefined'&&document.documentElement){
    const observer=new MutationObserver(()=>{if(showStartupSkeleton())observer.disconnect();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    if(showStartupSkeleton())observer.disconnect();
  }
  // The app bootstrap makes the fresh no-store account read. A preload here
  // cannot satisfy that request and would fetch the same account twice.
  // Proxies can inject optional scripts. Only our bundled app files block startup, including Capacitor URLs.
  function requiredAsset(asset){
    try{
      const url=new URL(asset.src||asset.href,location.href),page=new URL(location.href);
      return url.protocol===page.protocol&&url.host===page.host&&url.pathname.startsWith('/static/');
    }catch{return false;}
  }
  function showFailure(){
    const root=document.getElementById('app');if(!root||document.getElementById('page'))return;
    root.innerHTML='<div class="boot"><h1>Kinetta couldn’t finish loading</h1><p>Check your connection, then try again.</p><button type="button" class="primary" id="boot-reload">Try again</button></div>';
    document.getElementById('boot-reload').onclick=()=>location.reload();
  }
  // Styles may fail before this script runs. By DOM readiness, parser-blocking styles have settled.
  addEventListener('DOMContentLoaded',()=>{
    if(failed||(launching()&&[...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>requiredAsset(link)&&!link.sheet))){failed=true;showFailure();}
    // Syntax failures and stalled startup still recover; incidental errors don't cancel a successful launch.
    setTimeout(()=>{if(launching())showFailure();},20000);
  });
  addEventListener('error',event=>{
    // Dynamic maps/photos have their own recovery. This guard is only for the initial app assets.
    if(!launching()&&document.readyState!=='loading')return;
    const asset=event.target;
    if((asset?.tagName==='SCRIPT'||(asset?.tagName==='LINK'&&asset.rel==='stylesheet'))&&requiredAsset(asset)){failed=true;showFailure();}
  },true);
  return {get failed(){return failed;},showFailure,showStartupSkeleton};
})();
