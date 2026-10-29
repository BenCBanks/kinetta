// A failed required script must offer recovery instead of leaving the launch mark forever.
'use strict';
globalThis.KinettaBoot=(()=>{
  let failed=false;
  const launching=()=>document.querySelector('#app .launch');
  function showFailure(){
    const root=document.getElementById('app');if(!root||document.getElementById('page'))return;
    root.innerHTML='<div class="boot"><h1>Kinetta couldn’t finish loading</h1><p>Check your connection, then try again.</p><button type="button" class="primary" id="boot-reload">Try again</button></div>';
    document.getElementById('boot-reload').onclick=()=>location.reload();
  }
  addEventListener('error',event=>{
    // Dynamic maps/photos have their own recovery. This guard is only for the initial app scripts.
    if(!launching())return;
    if(event.target?.tagName==='SCRIPT'||event.filename){failed=true;showFailure();}
  },true);
  return {get failed(){return failed;},showFailure};
})();
