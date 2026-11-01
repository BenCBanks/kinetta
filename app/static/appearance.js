// Device-only display preferences keep custom WebView glass aligned with iOS accessibility settings.
'use strict';
(() => {
  const capacitor=globalThis.Capacitor;
  if(!capacitor?.isNativePlatform?.())return;
  const plugin=capacitor.Plugins?.KinettaDisplayPreferences,root=document.documentElement;
  if(!plugin?.getState||!root)return; // An older bridge keeps the solid CSS fallback.
  let revision=0,closed=false;
  const handles=[];
  function remove(handle){try{Promise.resolve(handle.remove()).catch(()=>{});}catch{ /* The bridge may already be closing. */ }}
  function apply(state){
    if(typeof state?.reduceTransparency!=='boolean'||typeof state?.increaseContrast!=='boolean'){
      root.classList.remove('native-display-ready');return;
    }
    root.classList.toggle('native-reduce-transparency',state.reduceTransparency);
    root.classList.toggle('native-increase-contrast',state.increaseContrast);
    root.classList.add('native-display-ready');
  }
  async function refresh(){
    if(closed)return;
    const current=++revision;
    let timer;
    try{
      // Keep the solid fallback while a slow bridge is pending, but retain its real eventual reply.
      timer=setTimeout(()=>{if(!closed&&current===revision)root.classList.remove('native-display-ready');},2000);
      const state=await Promise.resolve().then(()=>plugin.getState());
      if(!closed&&current===revision)apply(state);
    }catch{
      if(!closed&&current===revision)root.classList.remove('native-display-ready');
    }finally{clearTimeout(timer);}
  }
  function listen(source,event,handler){
    try{
      Promise.resolve(source?.addListener?.(event,handler)).then(handle=>{
        if(!handle)return;
        if(closed)remove(handle);
        else handles.push(handle);
      }).catch(()=>{});
    }catch{ /* A failed listener must not prevent the initial read or foreground refresh. */ }
  }
  listen(plugin,'changed',state=>{if(!closed){++revision;apply(state);}});
  listen(capacitor.Plugins?.App,'appStateChange',({isActive})=>{if(isActive)refresh();});
  addEventListener('pagehide',()=>{
    closed=true;++revision;
    for(const handle of handles)remove(handle);
    handles.length=0;
  },{once:true});
  refresh();
})();
