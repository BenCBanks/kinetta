/* Runs after app modules load, before DOMContentLoaded. No production assets are changed. */
'use strict';
(() => {
  const cfg=globalThis.KinettaUIFixture;
  Native.autoSync=()=>Promise.resolve();Native.resumeFoodEntry=()=>Promise.resolve();
  const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  async function capture(){
    for(let n=0;n<150;n++){
      if(cfg.stage==='food'?document.querySelector('#thread-text'):document.querySelector('#dk-name'))break;
      await new Promise(ok=>setTimeout(ok,100));
    }
    if(cfg.stage==='review')finishDish(cfg.dish);
    await document.fonts.ready;await new Promise(ok=>setTimeout(ok,2000));
    // UIKit can report initial zero insets before didAppear; require a stable settled layout.
    let previous='',stable=0;for(let n=0;n<50&&stable<8;n++){const key=JSON.stringify([rect('.shell'),rect(cfg.stage==='food'?'.thread-heading':'.top'),visualViewport?.height]);stable=key===previous?stable+1:0;previous=key;await new Promise(ok=>setTimeout(ok,100));}
    const probe=document.createElement('div');probe.style.paddingTop='env(safe-area-inset-top,0px)';probe.style.paddingBottom='env(safe-area-inset-bottom,0px)';probe.style.position='fixed';probe.style.visibility='hidden';document.body.append(probe);const cs=getComputedStyle(probe),safeTop=parseFloat(cs.paddingTop)||0,safeBottom=parseFloat(cs.paddingBottom)||0;probe.remove();
    const result={fixture:true,run:cfg.run,stage:cfg.stage,root:cfg.root,theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light',native:Native.on,viewport:{width:innerWidth,height:innerHeight,offset:visualViewport?.offsetTop||0},safeTop,safeBottom,back:rect(cfg.stage==='food'?'.thread-heading .back':'.top .back'),header:rect(cfg.stage==='food'?'.thread-heading':'.top'),name:rect('#dk-name'),content:rect('.recipe-content'),composer:rect(cfg.stage==='food'?'#thread-composer':'#dk-add'),review:rect('#recipe-finish'),overflow:document.documentElement.scrollWidth>innerWidth+1,status:document.querySelector('#thread-status')?.textContent||'',errors:cfg.errors,requests:cfg.requests};
    globalThis.KinettaUIResult=result;
    if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});
  }
  addEventListener('DOMContentLoaded',()=>capture().catch(async e=>{const result={fixture:true,run:cfg.run,error:String(e),errors:cfg.errors};globalThis.KinettaUIResult=result;if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});}),{once:true});
})();
