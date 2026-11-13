// Required app assets must offer recovery instead of leaving a launch mark or an unstyled screen.
'use strict';
globalThis.KinettaBoot=(()=>{
  let failed=false;
  // Browser sessions can begin identity discovery while the parser is still
  // downloading the eager app bundle. Native sessions must wait for native.js
  // to load its server and token first, so they keep the normal app path.
  let mePromise=null;
  if(typeof window!=='undefined'&&!window.Capacitor){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    mePromise=fetch('/api/me',{credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal})
      .then(async response=>{
        let body=null;try{body=await response.json();}catch(_){/* handled as an HTTP error below */}
        if(!response.ok){
          const detail=body&&body.detail;
          const error=new Error(typeof detail==='string'?detail:`Error ${response.status}`);error.status=response.status;error.payload=body;throw error;
        }
        return body;
      })
      .catch(error=>{
        if(error?.status)return Promise.reject(error);
        return Promise.reject(Object.assign(new Error(error?.name==='AbortError'?'This is taking too long. Try refreshing again.':"Can't reach Kinetta - check your connection."),{offline:true,status:error?.name==='AbortError'?504:undefined}));
      })
      .finally(()=>clearTimeout(timer));
  }
  const launching=()=>document.querySelector('#app .launch');
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
  return {get failed(){return failed;},showFailure,get me(){return mePromise;}};
})();
