/* Runs after app modules load, before DOMContentLoaded. No production assets are changed. */
'use strict';
(() => {
  const cfg=globalThis.KinettaUIFixture;
  Native.autoSync=()=>Promise.resolve();Native.resumeFoodEntry=()=>Promise.resolve();
  if(cfg.recording){TrackNative.supported=false;TrackNative.call=()=>Promise.reject(Error('Native UI fixture blocked GPS controls'));}
  const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  async function capture(){
    for(let n=0;n<150;n++){
      if(cfg.friends?(App.pageReady&&document.querySelector('#fr-own-list')&&document.querySelectorAll('.pym-tile').length===3):cfg.activity?(App.pageReady&&document.querySelector('.compact-detail-title')):cfg.recording?document.querySelector(cfg.stage==='track-review'?'#track-photos-add:not(:disabled)':'#track-lap'):cfg.stage==='food'?document.querySelector('#thread-text'):document.querySelector('#dk-name'))break;
      await new Promise(ok=>setTimeout(ok,100));
    }
    if(cfg.stage==='review')finishDish(cfg.dish);
    if(cfg.stage==='track-map')document.querySelector('#track-map-wrap .map-full')?.click();
    await document.fonts.ready;await new Promise(ok=>setTimeout(ok,2000));
    // Route startup restores scroll on its next frame; exercise scrolling only once it has settled.
    if(cfg.stage==='activity-sticky'){document.querySelector('.dtabs').scrollIntoView({block:'start'});for(let n=0;n<150;n++){if(!document.querySelector('.detail-sticky').hidden&&document.querySelector('.detail-map-hero').getBoundingClientRect().bottom<=0)break;await new Promise(ok=>setTimeout(ok,100));}}
    if(cfg.stage==='activity-map')document.querySelector('.map-full')?.click();
    // UIKit can initially report zero insets. Require a real status-bar inset and settled layout.
    const probe=document.createElement('div');probe.style.paddingTop='env(safe-area-inset-top,0px)';probe.style.paddingBottom='env(safe-area-inset-bottom,0px)';probe.style.position='fixed';probe.style.visibility='hidden';document.body.append(probe);
    let safeTop=0,safeBottom=0,previous='',stable=0;
    for(let n=0;n<150&&stable<8;n++){
      const cs=getComputedStyle(probe);safeTop=parseFloat(cs.paddingTop)||0;safeBottom=parseFloat(cs.paddingBottom)||0;
      const key=JSON.stringify([safeTop,safeBottom,rect('.shell'),rect(cfg.stage==='food'?'.thread-heading':'.top'),visualViewport?.height]);
      stable=key===previous&&(!Native.on||safeTop>=20)?stable+1:0;previous=key;await new Promise(ok=>setTimeout(ok,100));
    }
    probe.remove();if(Native.on&&(safeTop<20||stable<8))throw Error('Native safe-area layout did not settle');
    // Exercise the real read-only UIKit bridge; a silent old/missing plugin must fail this check.
    for(let n=0;n<50&&!document.documentElement.classList.contains('native-display-ready');n++)await new Promise(ok=>setTimeout(ok,100));
    const nav=document.querySelector('nav.tabs'),navStyle=getComputedStyle(nav),navigation={
      ready:document.documentElement.classList.contains('native-display-ready'),visible:navStyle.display!=='none',box:rect('nav.tabs'),
      items:[...nav.querySelectorAll('a')].map(a=>({text:a.querySelector('span').textContent,selected:a.getAttribute('aria-current')==='page',box:(()=>{const r=a.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};})(),label:(()=>{const r=a.querySelector('span').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};})()}))};
    const field=document.querySelector('#thread-text'),fieldSize=field?{...rect('#thread-text'),scrollHeight:field.scrollHeight,clientHeight:field.clientHeight}:null;
    const result={fixture:true,navigation,field:fieldSize,run:cfg.run,stage:cfg.stage,root:cfg.root,theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light',native:Native.on,viewport:{width:innerWidth,height:innerHeight,offset:visualViewport?.offsetTop||0},safeTop,safeBottom,back:rect(cfg.stage==='food'?'.thread-heading .back':'.top .back'),header:rect(cfg.stage==='food'?'.thread-heading':'.top'),name:rect('#dk-name'),content:rect('.recipe-content'),composer:rect(cfg.stage==='food'?'#thread-composer':'#dk-add'),review:rect('#recipe-finish'),overflow:document.documentElement.scrollWidth>innerWidth+1,status:document.querySelector('#thread-status')?.textContent||'',errors:cfg.errors,requests:cfg.requests};
    if(cfg.friends){const name=document.querySelector('.fr-request .person-link b');result.friends={title:document.querySelector('#fr-title')?.textContent,backLabel:document.querySelector('.top .back')?.getAttribute('aria-label'),search:rect('#fr-find'),searchFont:parseFloat(getComputedStyle(document.querySelector('#fr-find input')).fontSize),counts:[document.querySelectorAll('.fr-friend').length,document.querySelectorAll('.fr-request').length,document.querySelectorAll('.pym-tile').length],firstFriend:rect('.fr-friend'),requestPerson:rect('.fr-request .person-link'),requestActions:rect('.fr-request .btnrow'),requestNameFits:!name||name.scrollWidth<=name.clientWidth+1,empty:rect('[data-find-people]'),controls:[...document.querySelectorAll('[data-ok],[data-no],[data-request-menu],[data-manage],#fr-browse')].map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height};}),fullChallenges:!!document.querySelector('#friends-challenges')};}
    if(cfg.activity){const bar=cfg.stage==='activity-sticky'?'.detail-sticky':cfg.stage==='activity-empty'?'.detail-bar.top':'.detail-floating';result.activity={scrollY,documentHeight:document.documentElement.scrollHeight,hero:rect('.detail-map-hero'),bar:rect(bar),back:rect(bar+' .back'),actions:[...document.querySelectorAll(bar+' .icon-btn')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};}),title:rect('.d-title'),tabs:rect('.dtabs'),expanded:!!document.querySelector('.map.full'),close:rect('.map.full .map-full'),secondary:document.querySelectorAll('.detail-secondary .stat').length,socialHidden:document.querySelector('#d-soc').hidden};}
    if(cfg.recording){result.tracking={controls:rect(cfg.stage==='track-map'?'.track-full-controls':'.track-controls'),captions:[...document.querySelectorAll('.track-live-main .track-controls .round-ctl small')].map(e=>e.getBoundingClientRect().bottom),save:rect('#track-save'),tabs:rect('nav.tabs'),map:rect('#track-map-wrap'),average:document.querySelector('#track-pace')?.textContent,lap:document.querySelector('#track-lap-pace')?.textContent,photos:rect('#track-photos-add'),title:rect('input[name=activity_name]'),chart:rect('#track-review-charts'),expanded:!!document.querySelector('#track-map-wrap.full')};}
    globalThis.KinettaUIResult=result;
    if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});
  }
  addEventListener('DOMContentLoaded',()=>capture().catch(async e=>{const result={fixture:true,run:cfg.run,error:String(e),errors:cfg.errors};globalThis.KinettaUIResult=result;if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});}),{once:true});
})();
