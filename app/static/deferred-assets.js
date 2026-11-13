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
    for(const node of document.querySelector('#after-first-useful-assets').content.children)document.head.append(node.cloneNode(true));
    for(const node of document.querySelector('#after-first-useful-scripts').content.children){
      const copy=document.createElement('script');copy.src=node.getAttribute('src');copy.async=false;document.body.append(copy);
    }
    document.querySelector('#after-first-useful-assets').remove();document.querySelector('#after-first-useful-scripts').remove();
  };
  if(useful()){start();return;}
  const root=document.getElementById('app');
  const observer=new MutationObserver(()=>{if(useful()){observer.disconnect();start();}});
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']});
  const timer=setInterval(()=>{if(useful()){clearInterval(timer);observer.disconnect();start();}},50);
})();
