'use strict';
(()=>{
  let started=false;
  const useful=()=>{
    const page=document.querySelector('#page');if(!page)return false;
    if(page.querySelector('.me-card-sections[aria-busy="false"]')||page.querySelector('#feed-tools[aria-busy="false"]'))return true;
    if(page.querySelector('.login'))return true;
    return location.pathname!=='/'&&location.pathname!=='/activity'&&location.pathname!=='/me'&&typeof App!=='undefined'&&App.pageReady===true;
  };
  const start=()=>{
    if(started||!useful())return;started=true;
    for(const node of document.querySelector('#after-first-useful-assets').content.children){
      const copy=node.cloneNode(true);copy.dataset.deferredStylesheet='true';
      copy.addEventListener('load',()=>copy.dataset.deferredLoad='loaded',{once:true});
      copy.addEventListener('error',()=>copy.dataset.deferredLoad='error',{once:true});
      // Route styles are loaded before the route leaf renders. Keep the
      // shared styles ahead of them so a late shared sheet cannot undo the
      // route's full-bleed and map layout rules.
      const routeStyle=document.head.querySelector('link[data-route-style]');
      document.head.insertBefore(copy,routeStyle||null);
    }
    for(const node of document.querySelector('#after-first-useful-scripts').content.children){
      if(node.getAttribute('src')?.includes('/maps.js') && (globalThis.MapTiles || document.querySelector('script[src*="/maps.js"]')))continue;
      const copy=document.createElement('script');copy.src=node.getAttribute('src');copy.async=false;
      if(copy.src.includes('/feature-usage.js'))copy.addEventListener('load',()=>{
        if(typeof FeatureUsage!=='undefined'&&typeof App!=='undefined'&&App.me)FeatureUsage.open(location.pathname+location.search);
      },{once:true});
      document.body.append(copy);
    }
    document.querySelector('#after-first-useful-assets').remove();document.querySelector('#after-first-useful-scripts').remove();
  };
  if(useful()){start();return;}
  const root=document.getElementById('app');
  const observer=new MutationObserver(()=>{if(useful()){observer.disconnect();start();}});
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']});
  const timer=setInterval(()=>{if(useful()){clearInterval(timer);observer.disconnect();start();}},50);
})();
