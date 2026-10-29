// Required app assets must offer recovery instead of leaving a launch mark or an unstyled screen.
'use strict';
globalThis.KinettaBoot=(()=>{
  let failed=false;
  const launching=()=>document.querySelector('#app .launch');
  function showFailure(){
    const root=document.getElementById('app');if(!root||document.getElementById('page'))return;
    root.innerHTML='<div class="boot"><h1>Kinetta couldn’t finish loading</h1><p>Check your connection, then try again.</p><button type="button" class="primary" id="boot-reload">Try again</button></div>';
    document.getElementById('boot-reload').onclick=()=>location.reload();
  }
  // Styles may fail before this script runs. By DOM readiness, parser-blocking styles have settled.
  addEventListener('DOMContentLoaded',()=>{
    if(failed||(launching()&&[...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>!link.sheet))){failed=true;showFailure();}
    // Syntax failures and stalled startup still recover; incidental errors don't cancel a successful launch.
    setTimeout(()=>{if(launching())showFailure();},20000);
  });
  addEventListener('error',event=>{
    // Dynamic maps/photos have their own recovery. This guard is only for the initial app assets.
    if(!launching()&&document.readyState!=='loading')return;
    if(event.target?.tagName==='SCRIPT'||(event.target?.tagName==='LINK'&&event.target.rel==='stylesheet')){failed=true;showFailure();}
  },true);
  return {get failed(){return failed;},showFailure};
})();
