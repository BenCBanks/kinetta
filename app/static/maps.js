// One operator-owned basemap contract for Leaflet and exported pictures. No account data accompanies tile requests.
'use strict';
const MapTiles=(()=>{
  // Base label/road roles adapted from BSD @protomaps/basemaps; land/water are muted for Sky Blue.
  const palettes={"light":{"background":"#F3F5F7","earth":"#EDF0F3","park_a":"#E4EBE7","park_b":"#D4E1D9","hospital":"#e4dad9","industrial":"#d1dde1","school":"#e4ded7","wood_a":"#E1E8E1","wood_b":"#D3E2D3","pedestrian":"#e3e0d4","scrub_a":"#E7ECE4","scrub_b":"#DCE5DA","glacier":"#e7e7e7","sand":"#e2e0d7","beach":"#e8e4d0","aerodrome":"#dadbdf","runway":"#e9e9ed","water":"#D6E4EC","zoo":"#c6dcdc","military":"#dcdcdc","tunnel_other_casing":"#e0e0e0","tunnel_minor_casing":"#e0e0e0","tunnel_link_casing":"#e0e0e0","tunnel_major_casing":"#e0e0e0","tunnel_highway_casing":"#e0e0e0","tunnel_other":"#d5d5d5","tunnel_minor":"#d5d5d5","tunnel_link":"#d5d5d5","tunnel_major":"#d5d5d5","tunnel_highway":"#d5d5d5","pier":"#e0e0e0","buildings":"#DDE2E6","minor_service_casing":"#e0e0e0","minor_casing":"#e0e0e0","link_casing":"#e0e0e0","major_casing_late":"#e0e0e0","highway_casing_late":"#e0e0e0","other":"#ebebeb","minor_service":"#ebebeb","minor_a":"#ebebeb","minor_b":"#ffffff","link":"#ffffff","major_casing_early":"#e0e0e0","major":"#ffffff","highway_casing_early":"#e0e0e0","highway":"#ffffff","railway":"#a7b1b3","boundaries":"#adadad","bridges_other_casing":"#e0e0e0","bridges_minor_casing":"#e0e0e0","bridges_link_casing":"#e0e0e0","bridges_major_casing":"#e0e0e0","bridges_highway_casing":"#e0e0e0","bridges_other":"#ebebeb","bridges_minor":"#ffffff","bridges_link":"#ffffff","bridges_major":"#f5f5f5","bridges_highway":"#ffffff","roads_label_minor":"#4A535C","roads_label_minor_halo":"#F3F5F7","roads_label_major":"#4A535C","roads_label_major_halo":"#F3F5F7","ocean_label":"#526D85","subplace_label":"#4A535C","subplace_label_halo":"#F3F5F7","city_label":"#4A535C","city_label_halo":"#F3F5F7","state_label":"#4A535C","state_label_halo":"#F3F5F7","country_label":"#4A535C","address_label":"#4A535C","address_label_halo":"#F3F5F7","pois":{"blue":"#1A8CBD","green":"#20834D","lapis":"#315BCF","pink":"#EF56BA","red":"#F2567A","slategray":"#6A5B8F","tangerine":"#CB6704","turquoise":"#00C3D4"},"landcover":{"grassland":"#E5EBE5","barren":"#EDF0F3","urban_area":"#EDF0F3","farmland":"#E5EBE5","glacier":"#EDF0F3","scrub":"#E5EBE5","forest":"#E5EBE5"}},"dark":{"background":"#171B1F","earth":"#20262B","park_a":"#23332B","park_b":"#2B4034","hospital":"#252424","industrial":"#222222","school":"#262323","wood_a":"#243228","wood_b":"#2B3B2D","pedestrian":"#1e1e1e","scrub_a":"#2C3530","scrub_b":"#344139","glacier":"#1c1c1c","sand":"#212123","beach":"#28282a","aerodrome":"#1e1e1e","runway":"#333333","water":"#192D3B","zoo":"#222323","military":"#242323","tunnel_other_casing":"#141414","tunnel_minor_casing":"#141414","tunnel_link_casing":"#141414","tunnel_major_casing":"#141414","tunnel_highway_casing":"#141414","tunnel_other":"#292929","tunnel_minor":"#292929","tunnel_link":"#292929","tunnel_major":"#292929","tunnel_highway":"#292929","pier":"#333333","buildings":"#30383E","minor_service_casing":"#1f1f1f","minor_casing":"#1f1f1f","link_casing":"#1f1f1f","major_casing_late":"#1f1f1f","highway_casing_late":"#1f1f1f","other":"#333333","minor_service":"#333333","minor_a":"#3d3d3d","minor_b":"#333333","link":"#3d3d3d","major_casing_early":"#1f1f1f","major":"#3d3d3d","highway_casing_early":"#1f1f1f","highway":"#474747","railway":"#000000","boundaries":"#5b6374","bridges_other_casing":"#2b2b2b","bridges_minor_casing":"#1f1f1f","bridges_link_casing":"#1f1f1f","bridges_major_casing":"#1f1f1f","bridges_highway_casing":"#1f1f1f","bridges_other":"#333333","bridges_minor":"#333333","bridges_link":"#3d3d3d","bridges_major":"#3d3d3d","bridges_highway":"#474747","roads_label_minor":"#B4BCC4","roads_label_minor_halo":"#20262B","roads_label_major":"#B4BCC4","roads_label_major_halo":"#20262B","ocean_label":"#A3BDCE","subplace_label":"#B4BCC4","subplace_label_halo":"#20262B","city_label":"#B4BCC4","city_label_halo":"#20262B","state_label":"#B4BCC4","state_label_halo":"#20262B","country_label":"#B4BCC4","address_label":"#B4BCC4","address_label_halo":"#20262B","pois":{"blue":"#4299BB","green":"#30C573","lapis":"#2B5CEA","pink":"#EF56BA","red":"#F2567A","slategray":"#93939F","tangerine":"#F19B6E","turquoise":"#00C3D4"},"landcover":{"grassland":"#26332A","barren":"#20262B","urban_area":"#20262B","farmland":"#26332A","glacier":"#20262B","scrub":"#26332A","forest":"#26332A"}}};
  const style=(P,isDark)=>{const p=palettes[isDark?'dark':'light'];return {paintRules:P.paintRules(p),labelRules:P.labelRules(p,'en'),backgroundColor:p.background};};
  let pending=null,scope=null,renderer=null,configAt=0;
  const dark=()=>document.documentElement.dataset.theme==='dark'||document.documentElement.dataset.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches;
  const serverBase=()=>typeof Native!=='undefined'&&Native.base||'';
  async function config(){
    const server=serverBase()||location.origin;
    if(server!==scope){scope=server;pending=null;}
    if(pending&&Date.now()-configAt>300000)pending=null;
    if(!pending){
      configAt=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      pending=fetch(serverBase()+'/api/map-config',{credentials:'omit',mode:'cors',signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Map configuration unavailable');return r.json();}).then(c=>{if(server!==(serverBase()||location.origin))throw Error('Map server changed');return c;}).catch(e=>{if(scope===server)pending=null;throw e;}).finally(()=>clearTimeout(timer));
    }
    return pending;
  }
  function vector(){
    if(window.protomapsL)return Promise.resolve(window.protomapsL);
    if(!renderer)renderer=new Promise((ok,no)=>{const s=document.createElement('script');s.src='/static/vendor/protomaps-leaflet.js';s.onload=()=>ok(window.protomapsL);s.onerror=()=>{s.remove();renderer=null;no(Error('Map renderer unavailable'));};document.head.append(s);});
    return renderer;
  }
  function credit(c){return '© OpenStreetMap contributors'+(c.attribution?' · '+c.attribution:'');}
  function attribution(c){return '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>'+(c.attribution?' · '+(c.attribution_url?`<a href="${esc(c.attribution_url)}" target="_blank" rel="noopener noreferrer">${esc(c.attribution)}</a>`:esc(c.attribution)):'');}
  const tileUrl=(c,z,x,y,isDark=false)=>(isDark&&c.dark_url?c.dark_url:c.url).replace('{z}',z).replace('{x}',x).replace('{y}',y);
  async function raster(c,z,x,y,isDark=false,signal){
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    const timeout=setTimeout(abort,8000);let object;
    try{
      const response=await fetch(tileUrl(c,z,x,y,isDark),{credentials:'omit',mode:'cors',referrerPolicy:'strict-origin-when-cross-origin',signal:controller.signal});
      if(!response.ok)throw Error('Map unavailable');
      const blob=await response.blob();if(blob.size>4*1024*1024)throw Error('Map tile too large');
      object=URL.createObjectURL(blob);const image=new Image();image.src=object;await image.decode();return image;
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);if(object)URL.revokeObjectURL(object);}
  }
  // Convert failures into empty geographic layers before the renderer sees them. This avoids per-tile error logging.
  function protect(instance,failed,loaded){
    for(const view of instance.views.values()){
      const source=view.tileCache.source,get=source.get.bind(source);
      source.get=async(...args)=>{
        let timer;
        try{const rows=await Promise.race([get(...args),new Promise((_,no)=>timer=setTimeout(()=>no(Error('Map timeout')),8000))]);loaded();return rows;}
        catch(e){if(e.name!=='AbortError'){failed();}return new Map();}
        finally{clearTimeout(timer);}
      };
    }
    return instance;
  }
  async function mount(map,L,el){
    let layer=null,closed=false,version=0,failures=0,successes=0;
    const note=L.control({position:'bottomleft'});note.onAdd=()=>{const n=L.DomUtil.create('div','map-unavailable');n.hidden=true;n.setAttribute('role','status');n.textContent='Map unavailable ';const b=document.createElement('button');b.type='button';b.textContent='Retry';b.onclick=()=>draw();n.append(b);L.DomEvent.disableClickPropagation(n);return n;};note.addTo(map);
    const missing=()=>{const n=note.getContainer();if(n)n.hidden=false;};
    const update=()=>{const n=note.getContainer();if(n)n.hidden=!(failures>0&&failures>=successes);};
    const loaded=()=>{successes++;update();};
    async function draw(){
      const drawId=++version;failures=successes=0;
      if(layer){map.removeLayer(layer);layer=null;}
      try{
        const c=await config();if(closed||drawId!==version||!el.isConnected)return;
        if(c.kind==='off'){missing();return;}
        const onLoad=()=>{if(drawId===version&&!closed)loaded();};
        const isDark=dark(),fail=()=>{if(drawId!==version||closed)return;failures++;update();};
        // Light-only raster providers retain their actual palette. Use a dark blue route on that background.
        map.fire('basemaptheme',{light:c.kind==='raster'&&(!isDark||!c.dark_url)});
        map.setMaxZoom(c.max_zoom);
        if(c.kind==='raster'){
          const Raster=L.GridLayer.extend({createTile(coords,done){
            const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
            const controller=new AbortController();canvas.tileAbort=controller;
            raster(c,coords.z,coords.x,coords.y,isDark,controller.signal).then(image=>{
              if(closed||drawId!==version||controller.signal.aborted)return;
              canvas.getContext('2d').drawImage(image,0,0,256,256);onLoad();done(null,canvas);
            },error=>{if(closed||drawId!==version||controller.signal.aborted)return;fail();done(null,canvas);});return canvas;
          }});
          layer=new Raster({attribution:attribution(c),maxZoom:c.max_zoom});
          layer.on('tileunload',event=>event.tile.tileAbort?.abort());
        }else{
          const P=await vector();if(closed||drawId!==version||!el.isConnected)return;
          layer=protect(P.leafletLayer({url:c.url,...style(P,isDark),maxZoom:c.max_zoom,attribution:attribution(c)}),fail,onLoad);
        }
        if(closed||drawId!==version)return;layer.on('loading',()=>{if(drawId===version){failures=successes=0;update();}});layer.addTo(map);
      }catch(_){if(!closed&&drawId===version)missing();}
    }
    const media=matchMedia('(prefers-color-scheme: dark)'),theme=()=>draw();media.addEventListener('change',theme);
    const observer=new MutationObserver(theme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('online',theme);
    map.once('unload',()=>{closed=true;version++;media.removeEventListener('change',theme);observer.disconnect();window.removeEventListener('online',theme);});
    draw();
  }
  async function paint(g,pts,box,geometry){
    let c;try{c=await config();}catch(_){return 0;}
    if(c.kind==='off')return 0;
    const {z,k,n,cx,cy,mx,my,tx0,tx1,ty0,ty1,zf}=geometry;
    try{
      if(c.kind==='raster'){
        const jobs=[];for(let x=tx0;x<=tx1;x++)for(let y=ty0;y<=ty1;y++)jobs.push(raster(c,z,((x%2**z)+2**z)%2**z,y).then(im=>[im,x,y],()=>null));
        const got=(await Promise.all(jobs)).filter(Boolean);g.save();g.beginPath();g.rect(box.x,box.y,box.w,box.h);g.clip();for(const [im,x,y] of got)g.drawImage(im,(x*256-cx)*k+mx,(y*256-cy)*k+my,256*k+.5,256*k+.5);g.restore();return got.length;
      }
      const P=await vector(),canvas=document.createElement('canvas');canvas.width=box.w;canvas.height=box.h;let errors=0,count=0;
      const staticMap=protect(new P.Static({url:c.url,...style(P,false)}),()=>errors++,()=>count++);
      const x=cx+(box.x+box.w/2-mx)/k,y=cy+(box.y+box.h/2-my)/k;
      await staticMap.drawContext(canvas.getContext('2d'),box.w,box.h,{x:x/n*360-180,y:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI},zf);
      if(errors||!count)return 0;g.drawImage(canvas,box.x,box.y);return 1;
    }catch(_){return 0;}
  }
  return {config,mount,paint,credit,attribution,tileUrl,dark};
})();
