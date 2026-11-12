/* Runs after app modules load, before DOMContentLoaded. No production assets are changed. */
'use strict';
(() => {
  const cfg=globalThis.KinettaUIFixture;
  Native.autoSync=()=>Promise.resolve();Native.resumeFoodEntry=()=>Promise.resolve();
  if(cfg.store){Native.setBadge=()=>Promise.resolve();Native.haptic=()=>{};Challenges.resumeSignup=()=>Promise.resolve();}
  if(cfg.headerPage||cfg.store||cfg.groups){
    // Measure the real native layout without reading Health/GPS or registering alerts.
    Native.syncPush=()=>Promise.resolve();Native.healthOn=Native.foodHealthOn=async()=>false;Native.healthStatus=async()=>null;
    TrackNative.call=async method=>{if(method==='status')return {session:null};throw Error('Native header fixture blocked recording controls');};
    TrackNative.locate=async()=>{if(cfg.store)return cfg.store.position;throw Error('Native header fixture blocked GPS reads');};
  }
  if(cfg.recording){TrackNative.supported=false;TrackNative.call=()=>Promise.reject(Error('Native UI fixture blocked GPS controls'));}
  const rect=selector=>{const e=typeof selector==='string'?document.querySelector(selector):selector;if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  function paintedMap(scope=document){
    return [...scope.querySelectorAll('canvas.leaflet-tile-loaded')].some(c=>{try{
      const b=c.getBoundingClientRect(),m=c.closest('.leaflet-container').getBoundingClientRect(),x=Math.max(0,b.x,m.x),y=Math.max(0,b.y,m.y),right=Math.min(innerWidth,b.right,m.right),bottom=Math.min(innerHeight,b.bottom,m.bottom);
      if(right<=x||bottom<=y)return false;let opacity=1;for(let e=c;e;e=e.parentElement){const css=getComputedStyle(e);opacity*=Number(css.opacity);if(opacity<.95||css.visibility==='hidden'||css.display==='none')return false;}
      const sx=Math.floor((x-b.x)/b.width*c.width),sy=Math.floor((y-b.y)/b.height*c.height),w=Math.max(1,Math.floor((right-x)/b.width*c.width)),h=Math.max(1,Math.floor((bottom-y)/b.height*c.height));
      const d=c.getContext('2d').getImageData(sx,sy,w,h).data;let different=0;for(let i=0;i<d.length;i+=64)if(d[i+3]&&(d[i]!==d[0]||d[i+1]!==d[1]||d[i+2]!==d[2]))different++;return different>16;
    }catch(_){return false;}});
  }
  function storeReady(){
      const checks={
        'header-me':()=>document.querySelector('.me-card-sections[aria-busy="false"]')&&document.querySelectorAll('.me-week').length===7,
        activity:()=>document.querySelector('[data-dt="charts"][aria-selected="true"]')&&paintedMap()&&!document.querySelector('.map-unavailable:not([hidden])'),
        'header-track':()=>document.querySelector('#track-start')?.getAttribute('aria-label')==='Start run'&&!document.querySelector('#track-lap')&&paintedMap()&&!document.querySelector('.map-unavailable:not([hidden])'),
        'header-food':()=>document.querySelectorAll('#fd-meals [data-id]').length===2&&document.querySelector('#fd-sum').textContent.includes('915'),
        food:()=>document.querySelector('.thread-card [data-action="undo"]')&&document.querySelector('#thread-text'),
        'header-progress':()=>document.querySelector('#m-chart svg')&&document.querySelector('[data-progress-fitness]').textContent.includes('Training steadily'),
        'header-activity':()=>{const post=document.querySelector('#ff-list .post[data-href="/activity/friends/2"]');return post?.querySelector('.post-name')?.textContent==='Jordan Example'&&paintedMap(post)&&!post.querySelector('.map-unavailable:not([hidden])');},
      };
      return !!checks[cfg.stage]?.();
  }
  function storeMapTilesLoaded(){
    const selector={activity:'#d-map.leaflet-container','header-track':'#track-map.leaflet-container','header-activity':'#ff-list .post[data-href="/activity/friends/2"] .leaflet-container'}[cfg.stage];
    const map=selector&&document.querySelector(selector);if(!map)return false;
    const mapStyle=getComputedStyle(map),m=map.getBoundingClientRect();
    if(mapStyle.display==='none'||mapStyle.visibility==='hidden'||m.width<=0||m.height<=0||m.right<=0||m.bottom<=0||m.left>=innerWidth||m.top>=innerHeight)return false;
    const left=Math.max(0,m.left),top=Math.max(0,m.top),right=Math.min(innerWidth,m.right),bottom=Math.min(innerHeight,m.bottom);
    const visible=[...map.querySelectorAll('canvas.leaflet-tile')].filter(c=>{
      const s=getComputedStyle(c),r=c.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>left&&r.bottom>top&&r.left<right&&r.top<bottom;
    });
    return visible.length>0&&visible.every(c=>c.classList.contains('leaflet-tile-loaded'));
  }
  function storeActivityDiagnostics(){
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const visibility=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;};
    const opacity=e=>{let value=1;for(let n=e;n;n=n.parentElement)value*=Number(getComputedStyle(n).opacity);return value;};
    const canvases=[...document.querySelectorAll('.leaflet-container canvas.leaflet-tile-loaded')].map(c=>{
      const map=c.closest('.leaflet-container'),r=c.getBoundingClientRect(),m=map.getBoundingClientRect();let pixelVariation={readable:false,sampled:0,different:0,error:null};
      try{
        const left=Math.max(0,r.left,m.left),top=Math.max(0,r.top,m.top),right=Math.min(innerWidth,r.right,m.right),bottom=Math.min(innerHeight,r.bottom,m.bottom);
        if(right>left&&bottom>top&&r.width>0&&r.height>0){
          const sx=Math.max(0,Math.floor((left-r.left)/r.width*c.width)),sy=Math.max(0,Math.floor((top-r.top)/r.height*c.height));
          const w=Math.max(1,Math.min(c.width-sx,Math.floor((right-left)/r.width*c.width))),h=Math.max(1,Math.min(c.height-sy,Math.floor((bottom-top)/r.height*c.height)));
          const data=c.getContext('2d').getImageData(sx,sy,w,h).data;let different=0,sampled=0;
          for(let i=0;i<data.length;i+=64){sampled++;if(data[i+3]&&(data[i]!==data[0]||data[i+1]!==data[1]||data[i+2]!==data[2]))different++;}
          pixelVariation={readable:true,sampled,different,error:null};
        }
      }catch(e){pixelVariation.error=String(e?.name||'CanvasReadError');}
      return{box:box(c),mapBox:box(map),intersectsViewport:r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight,visible:visibility(c),effectiveOpacity:opacity(c),pixelVariation};
    });
    const resources=performance.getEntriesByType('resource').filter(r=>/map|tile|pmtiles/i.test(r.name)).slice(-30).map(r=>({kind:/pmtiles/i.test(r.name)?'pmtiles':/tile/i.test(r.name)?'tile':'map',initiator:r.initiatorType||'',status:Number.isFinite(r.responseStatus)?r.responseStatus:null,durationMs:Math.round(r.duration),transferBytes:r.transferSize||0}));
    const safeErrors=(cfg.errors||[]).map(e=>String(e).replace(/https?:\/\/[^\s"']+/gi,'[url]')).slice(-20);
    const maps=[...document.querySelectorAll('.leaflet-container')];
    const fixtureNow=Number(cfg.fixtureNow),dateNow=Date.now(),performanceNow=performance.now();
    return{
      stage:cfg.stage,clock:{dateNow:Number.isFinite(dateNow)?dateNow:null,fixtureNow:Number.isFinite(fixtureNow)?fixtureNow:null,performanceNow:Number.isFinite(performanceNow)?performanceNow:null,advanceAttempted:cfg.fixtureClockAdvanceAttempted===true,advanceApplied:cfg.fixtureClockAdvanceApplied===true},
      chartsSelected:document.querySelector('[data-dt="charts"]')?.getAttribute('aria-selected')==='true',chartsVisible:visibility(document.querySelector('[data-dt="charts"]')),
      mapContainers:maps.map(m=>({box:box(m),visible:visibility(m),effectiveOpacity:opacity(m),loadedTileElements:m.querySelectorAll('.leaflet-tile.leaflet-tile-loaded').length,totalTileElements:m.querySelectorAll('.leaflet-tile').length})),
      loadedCanvases:canvases,unavailable:[...document.querySelectorAll('.map-unavailable')].map(e=>({visible:visibility(e),hidden:e.hidden,box:box(e)})),resources,errors:safeErrors
    };
  }
  async function capture(){
    for(let n=0;n<150;n++){
      if(cfg.groups?(App.pageReady&&document.querySelector('#group-new')):cfg.headerPage?(App.pageReady&&document.querySelector('#page h1')):cfg.friends?(App.pageReady&&document.querySelector('#fr-own-list')):cfg.activity?(App.pageReady&&document.querySelector('.compact-detail-title')):cfg.recording?document.querySelector(cfg.stage==='track-review'?'#track-photos-add:not(:disabled)':'#track-lap'):cfg.stage==='food'?document.querySelector('#thread-text'):document.querySelector('#dk-name'))break;
      await new Promise(ok=>setTimeout(ok,100));
    }
    if(cfg.activity){let socialReady=false;for(let n=0;n<150;n++){const box=document.querySelector('#d-soc'),requested=cfg.requests.includes('/api/activities/1/social'),hasContent=cfg.activity.social.cheers.length||cfg.activity.social.comments.length;socialReady=!!box&&requested&&(hasContent?!box.hidden:box.hidden);if(socialReady)break;await new Promise(ok=>setTimeout(ok,100));}if(!socialReady)throw Error('Owner activity empty-social state did not finish loading');}
    if(cfg.groups){document.querySelector('#group-new')?.click();let ready=false;for(let n=0;n<150;n++){ready=!!document.querySelector('#group-create-form');if(ready)break;await new Promise(ok=>setTimeout(ok,100));}if(!ready)throw Error('Groups create form did not open');}
    if(cfg.store&&cfg.activity)document.querySelector('[data-dt=charts]')?.click();
    if(cfg.stage==='review')finishDish(cfg.dish);
    if(cfg.stage==='track-map')document.querySelector('#track-map-wrap .map-full')?.click();
    await document.fonts.ready;await new Promise(ok=>setTimeout(ok,2000));
    if(cfg.store){
      const mapStage=['activity','header-track','header-activity'].includes(cfg.stage);let advanceAttempted=false;
      for(let n=0;n<200&&!storeReady();n++){
        if(mapStage&&!advanceAttempted&&(cfg.stage!=='activity'||document.querySelector('[data-dt="charts"][aria-selected="true"]'))&&storeMapTilesLoaded()){
          advanceAttempted=true;cfg.fixtureClockAdvanceAttempted=true;cfg.fixtureClockAdvanceApplied=cfg.advanceFixtureClock?.(250)===true;
        }
        if(!storeReady())await new Promise(ok=>setTimeout(ok,100));
      }
      if(!storeReady())throw Error('Store scene did not finish painting: '+cfg.stage);
    }
    if(cfg.activityFeed){let ready=false;for(let n=0;n<150;n++){ready=!!document.querySelector('#ff-list .post[data-href="/activity/1"]')&&!!document.querySelector('#ff-list .post[data-href="/activity/friends/2"]');if(ready)break;await new Promise(ok=>setTimeout(ok,100));}if(!ready)throw Error('Fictional own and friend Activity cards did not finish rendering');}
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
    const result={fixture:true,store:!!cfg.store,blocked:cfg.blocked,bodyText:cfg.store?document.querySelector('#page')?.innerText:null,display:cfg.displayDiagnostics(),navigation,field:fieldSize,run:cfg.run,stage:cfg.stage,root:cfg.root,theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light',native:Native.on,viewport:{width:innerWidth,height:innerHeight,offset:visualViewport?.offsetTop||0},safeTop,safeBottom,back:rect(cfg.stage==='food'?'.thread-heading .back':'.top .back'),header:rect(cfg.stage==='food'?'.thread-heading':'.top'),name:rect('#dk-name'),content:rect('.recipe-content'),composer:rect(cfg.stage==='food'?'#thread-composer':'#dk-add'),review:rect('#recipe-finish'),overflow:document.documentElement.scrollWidth>innerWidth+1,status:document.querySelector('#thread-status')?.textContent||'',errors:cfg.errors,requests:cfg.requests};
    if(cfg.groups){const fields=document.querySelector('.group-create-fields');result.groups={fields:{...rect('.group-create-fields'),clientWidth:fields.clientWidth,scrollWidth:fields.scrollWidth},date:rect('[name=event_date]'),name:rect('[name=title]'),grid:rect('.group-goal-fields'),labels:[...document.querySelectorAll('.group-create-fields>label')].map(label=>rect(label))};}
    if(cfg.headerPage){
      const title=document.querySelector('#page h1'),shell=document.querySelector('#page'),header=title.closest('.top,.me-top'),glyph=document.createRange();glyph.selectNodeContents(title);
      const g=glyph.getBoundingClientRect(),css=getComputedStyle(shell),h=getComputedStyle(header);
      result.topBand={page:cfg.headerPage,title:rect('#page h1'),titleText:title.textContent,glyph:{y:g.y,height:g.height,bottom:g.bottom},shell:rect('#page'),header:{...rect(header.classList.contains('me-top')?'.me-top':'.top'),paddingTop:h.paddingTop,minHeight:h.minHeight,marginTop:h.marginTop},shellPaddingTop:parseFloat(css.paddingTop),scrollY,controls:[...header.querySelectorAll('a,button')].map(e=>{const r=e.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height};}).filter(r=>r.width&&r.height),children:[...shell.children].slice(0,4).map(e=>({tag:e.tagName,box:(()=>{const r=e.getBoundingClientRect();return {y:r.y,height:r.height};})(),display:getComputedStyle(e).display}))};
    }
    if(cfg.activityFeed){
      const rangeRects=el=>{const range=document.createRange();range.selectNodeContents(el);return[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}));};
      const measure=selector=>{const card=document.querySelector(selector),header=card?.querySelector('.post-hd'),name=card?.querySelector('.post-name'),date=card?.querySelector('.post-meta-date'),kind=card?.querySelector('.post-meta-kind');if(!card||!header||!name||!date||!kind)return null;const nr=name.getBoundingClientRect(),pseudo=getComputedStyle(name,'::before'),style=getComputedStyle(name);return{card:rect(selector),header:rect(selector+' .post-hd'),name:name.textContent.trim(),nameBox:rect(selector+' .post-name'),nameText:rangeRects(name),target:{x:nr.x+parseFloat(pseudo.left),y:nr.y+parseFloat(pseudo.top),width:parseFloat(pseudo.width),height:parseFloat(pseudo.height),right:nr.x+parseFloat(pseudo.left)+parseFloat(pseudo.width)},namePadding:style.padding,nameMargin:style.margin,dateText:date.textContent.trim(),dateRects:rangeRects(date),kindText:kind.textContent.trim(),kindRects:rangeRects(kind)};};
      result.activityMetadata={own:measure('#ff-list .post[data-href="/activity/1"]'),friend:measure('#ff-list .post[data-href="/activity/friends/2"]')};
    }
    if(cfg.friends){result.friends={title:document.querySelector('#fr-title')?.textContent,backLabel:document.querySelector('.top .back')?.getAttribute('aria-label'),findAction:rect('#fr-list-find'),requestRow:rect('#fr-requests-open'),requestLabel:document.querySelector('#fr-requests-open')?.textContent.trim()||'',counts:[document.querySelectorAll('.fr-friend').length,document.querySelectorAll('#fr-requests-open').length,document.querySelectorAll('.pym-tile').length],firstFriend:rect('.fr-friend'),empty:rect('.friend-empty'),emptyAction:rect('#fr-empty-browse'),controls:[...document.querySelectorAll('#fr-list-find,#fr-requests-open,[data-manage]')].map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height};}),fullChallenges:!!document.querySelector('#friends-challenges')};}
    if(cfg.activity){const bar=cfg.stage==='activity-sticky'?'.detail-sticky':cfg.stage==='activity-empty'?'.detail-bar.top':'.detail-floating';result.activity={scrollY,documentHeight:document.documentElement.scrollHeight,hero:rect('.detail-map-hero'),bar:rect(bar),back:rect(bar+' .back'),actions:[...document.querySelectorAll(bar+' .icon-btn')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};}),title:rect('.d-title'),tabs:rect('.dtabs'),expanded:!!document.querySelector('.map.full'),close:rect('.map.full .map-full'),secondary:document.querySelectorAll('.detail-secondary .stat').length,social:{hidden:document.querySelector('#d-soc').hidden,react:rect('#d-soc .reaction-more'),comments:rect('#d-soc [data-ttalk]')}};}
    if(cfg.recording){result.tracking={controls:rect(cfg.stage==='track-map'?'.track-full-controls':'.track-controls'),captions:[...document.querySelectorAll('.track-live-main .track-controls .round-ctl small')].map(e=>e.getBoundingClientRect().bottom),save:rect('#track-save'),tabs:rect('nav.tabs'),map:rect('#track-map-wrap'),average:document.querySelector('#track-pace')?.textContent,lap:document.querySelector('#track-lap-pace')?.textContent,photos:rect('#track-photos-add'),title:rect('input[name=activity_name]'),chart:rect('#track-review-charts'),expanded:!!document.querySelector('#track-map-wrap.full')};}
    if(cfg.store){
      result.sceneReady=storeReady();
      if(!result.sceneReady)result.storeDiagnostics=storeActivityDiagnostics();
    }
    globalThis.KinettaUIResult=result;
    if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});
  }
  addEventListener('DOMContentLoaded',()=>capture().catch(async e=>{const result={fixture:true,run:cfg.run,error:String(e),errors:cfg.errors,display:cfg.displayDiagnostics()};if(cfg.store&&cfg.stage==='activity')result.storeDiagnostics=storeActivityDiagnostics();globalThis.KinettaUIResult=result;if(Native.on)await Capacitor.Plugins.KinettaActivityShare.uiTestMetrics({value:JSON.stringify(result)});}),{once:true});
})();
