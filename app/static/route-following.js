// Route-only downloads and conservative position along a pinned plan. Never supplies workout distance or time.
'use strict';
const RouteMath = {
  decode(line){
    if(typeof line!=='string'||line.length>400000)throw Error('Invalid route line.');
    let i=0,lat=0,lon=0;const pts=[];
    while(i<line.length){const v=[];for(let k=0;k<2;k++){let value=0,shift=0,done=false;while(i<line.length&&shift<=30){const b=line.charCodeAt(i++)-63;if(b<0||b>63)throw Error('Invalid route line.');value+=(b&31)*2**shift;shift+=5;if(b<32){done=true;break;}}if(!done)throw Error('Incomplete route line.');v.push(value%2?-(Math.floor(value/2)+1):Math.floor(value/2));}
      lat+=v[0];lon+=v[1];if(Math.abs(lat)>9000000||Math.abs(lon)>18000000||pts.length>=50000)throw Error('Invalid route line.');pts.push([lat/1e5,lon/1e5]);}
    if(pts.length<2)throw Error('This route needs at least two points.');return pts;
  },
  metres(a,b){const r=Math.PI/180,x=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(Math.max(0,x)),Math.sqrt(Math.max(0,1-x)));},
  compile(points,breaks=[]){
    if(!Array.isArray(points)||points.length<2||points.length>50000)throw Error('This route has no usable map line.');
    const pts=points.map(p=>({lat:p[0],lon:p[1]}));if(pts.some(p=>![p.lat,p.lon].every(Number.isFinite)||Math.abs(p.lat)>90||Math.abs(p.lon)>180))throw Error('This route has invalid map points.');
    const gaps=new Set(breaks),m=[0];for(let i=1;i<pts.length;i++)m.push(m[i-1]+(gaps.has(i)?0:this.metres(pts[i-1],pts[i])));return{pts,m,total:m.at(-1),gaps};
  },
  fresh(fix,now){return fix&&[fix.lat,fix.lon,fix.accuracy,fix.at].every(Number.isFinite)&&fix.accuracy>=0&&fix.accuracy<=25&&Math.abs(fix.lat)<=90&&Math.abs(fix.lon)<=180&&fix.at<=now+1000&&now-fix.at<=15000;},
  startDistance(course,fix,now=Date.now()){return this.fresh(fix,now)?this.metres(course.pts[0],fix):null;},
  lower(a,x){let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(a[m]<x)l=m+1;else h=m;}return l;},
  position(course,fix,state={}){
    if(!fix||![fix.lat,fix.lon,fix.accuracy,fix.at].every(Number.isFinite)||fix.accuracy<0||fix.accuracy>25||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180)return{...state,known:false};
    if(state.last&&fix.at<=state.last.at)return{...state,known:false};
    if(state.beganNearStart==null)state={...state,beganNearStart:this.metres(course.pts[0],fix)<25};
    const old=state.last,step=old?this.metres(old,fix):0,heading=old&&step>=Math.max(8,old.accuracy,fix.accuracy)?old:null;
    if(old&&(fix.at-old.at>30000||fix.segment!==old.segment))return{...state,last:fix,known:false};
    const scale=Math.cos(fix.lat*Math.PI/180)*111195,dy=(lat)=> (lat-fix.lat)*111195,dx=(lon)=>(((lon-fix.lon+540)%360)-180)*scale;
    const lo=state.m==null?0:Math.max(0,state.m-25),hi=state.m==null?course.total:Math.min(course.total,state.m+Math.min(250,Math.max(60,old?(fix.at-old.at)/1000*30:60)));
    const first=Math.max(0,this.lower(course.m,lo)-1),last=Math.min(course.pts.length-1,this.lower(course.m,hi)+1),candidates=[];
    for(let i=first;i<last;i++){
      if(course.gaps.has(i+1))continue;
      const a=course.pts[i],b=course.pts[i+1],ax=dx(a.lon),ay=dy(a.lat),vx=dx(b.lon)-ax,vy=dy(b.lat)-ay,n=vx*vx+vy*vy;
      if(n<.01)continue;const f=Math.max(0,Math.min(1,-(ax*vx+ay*vy)/n)),distance=Math.hypot(ax+f*vx,ay+f*vy),m=course.m[i]+f*(course.m[i+1]-course.m[i]);
      if(m<lo||m>hi||distance>Math.max(20,fix.accuracy*1.5))continue;
      if(heading){const hx=-dx(heading.lon),hy=-dy(heading.lat),alignment=(hx*vx+hy*vy)/(Math.hypot(hx,hy)*Math.sqrt(n));if(alignment<.2)continue;}
      candidates.push({m,distance});
    }
    candidates.sort((a,b)=>a.distance-b.distance);let best=candidates[0];
    // At a loop's shared start/finish, start at zero only after movement establishes the outgoing direction.
    if(best&&state.m==null&&this.metres(course.pts[0],fix)<25&&heading){const outgoing=candidates.filter(c=>c.m<40).sort((a,b)=>a.distance-b.distance)[0];if(outgoing)best=outgoing;}
    const ambiguous=best&&candidates.some(c=>Math.abs(c.m-best.m)>60&&c.distance<=best.distance+Math.max(5,fix.accuracy));
    if(!best||ambiguous||(state.m!=null&&best.m<state.m-5)||(!heading&&state.m==null&&best.m>30))return{...state,last:fix,known:false};
    const m=Math.max(state.m??0,best.m),partway=state.partway??(m>50&&!state.beganNearStart);
    return{m,partway,beganNearStart:state.beganNearStart,last:fix,known:true,remaining:Math.max(0,course.total-m),complete:course.total-m<20};
  },
  replay(course,points,start,previous={}){
    let s=previous,offset=s.offset||0;if(offset>points.length){s={};offset=0;}
    for(let i=offset;i<points.length;i++){const p=points[i];s=this.position(course,{lat:p.lat,lon:p.lon,accuracy:p.accuracy,at:start+p.t*1000,segment:p.segment},s);}
    return{...s,offset:points.length};
  },
};
const RouteDownloads = (()=>{
  const prefix='kinetta.routeDownloads:',LIMIT=4*1024*1024,MAX=30;
  const account=()=>App.me?JSON.stringify([serverKey(),App.me.id]):null;
  let attached=null,checking=null;
  const key=()=>account()?prefix+account():null;
  const identity=r=>r.kind+':'+r.id;
  const bytes=s=>new TextEncoder().encode(s).length;
  function clean(r){
    if(!r||!['owned','shared'].includes(r.kind)||!Number.isSafeInteger(r.id)||r.id<1||!Number.isSafeInteger(r.version)||r.version<1||typeof r.name!=='string'||!r.name.trim()||r.name.length>120||!['run','walk','hike','ride'].includes(r.sport)||typeof r.line!=='string'||r.line.length>400000||!Number.isFinite(r.distance_m)||r.distance_m<=0||r.distance_m>500000)throw Error('This route is incomplete. Open it online and try again.');
    if(r.kind==='shared'&&!/^[a-f0-9]{64}$/.test(r.snapshot_key||''))throw Error('This shared route needs a fresh access check.');
    const points=RouteMath.decode(r.line),breaks=Array.isArray(r.breaks)?[...new Set(r.breaks)]:[];
    if(breaks.some(i=>!Number.isInteger(i)||i<1||i>=points.length))throw Error('Invalid route sections.');
    if(RouteMath.compile(points,breaks).total>501000)throw Error('This route is too long.');
    return{schema:1,kind:r.kind,id:r.id,version:r.version,name:r.name,sport:r.sport,distance_m:r.distance_m,line:r.line,
      snapshot_key:r.kind==='shared'?r.snapshot_key:null,warnings:(r.warnings||[]).slice(0,20).map(x=>String(typeof x==='string'?x:x.text||'').slice(0,300)).filter(Boolean),
      attribution:(r.attribution||[]).slice(0,10).map(x=>String(x).slice(0,300)),breaks,downloadedAt:Number.isFinite(r.downloadedAt)?r.downloadedAt:Date.now()};
  }
  function list(){attach();if(!key())return[];try{return(JSON.parse(localStorage.getItem(key()))||[]).flatMap(r=>{try{return[clean(r)]}catch(_){return[]}});}catch(_){return[];}}
  function write(rows){const k=key();if(!k)throw Error('Log in before saving a route.');const data=JSON.stringify(rows);if(rows.length>MAX||bytes(data)>LIMIT)throw Error('The route download limit is reached. Remove an unused route and try again.');try{localStorage.setItem(k,data);}catch(_){throw Error('This device could not save the route. Free some storage and retry. The previous complete copy is kept.');}}
  function save(value){const r=clean(value),rows=list().filter(x=>identity(x)!==identity(r));write([...rows,r]);return r;}
  function remove(kind,id){write(list().filter(x=>x.kind!==kind||x.id!==id));const chosen=PlanTrack.get();if(chosen?.kind===kind&&chosen.id===id){PlanTrack.set(null);if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('kinetta:route-selection'));}}
  const credits=['OpenStreetMap contributors — https://www.openstreetmap.org/copyright (where OpenStreetMap data is used).'];
  function fromOwned(r){
    const points=[],breaks=[];for(const leg of r.legs||[]){const pts=RouteMath.decode(leg.line);if(points.length&&Plan.metres(points.at(-1),pts[0])>1)breaks.push(points.length);for(const p of pts)if(!points.length||Plan.metres(points.at(-1),p)>.5)points.push(p);}
    const warnings=[...(r.warnings||[])];if(breaks.length)warnings.push('This route has gaps between planned sections. The gaps are not a verified path.');
    return clean({kind:'owned',id:r.id,version:r.loaded_version||r.version,name:r.name,sport:r.sport,distance_m:r.distance_m,line:points.length?Plan.enc(points):r.full_line||r.line,breaks,warnings,attribution:r.attribution||credits});
  }
  function fromShared(r){return clean({...r,kind:'shared',attribution:r.attribution||credits});}
  async function fetchRoute(kind,id,version=null){return kind==='shared'?fromShared(await api('/api/shared-routes/'+id)):fromOwned(await api('/api/planned-routes/'+id+(version?'?version='+version:'')));}
  async function authorized(kind,id,{offline=false,version=null,snapshot_key=null,alive=()=>true}={}){
    const owner=readOwner(),who=account(),cached=list().find(r=>r.kind===kind&&r.id===id&&(!version||r.version===version)&&(!snapshot_key||r.snapshot_key===snapshot_key));let r;
    if(!alive())throw Error('This page changed. Choose the route again.');
    try{if((offline||navigator.onLine===false)&&cached)r=cached;else r=await fetchRoute(kind,id,version);}
    catch(e){if(owner!==readOwner()||who!==account()||!alive())throw e;if([403,404,410].includes(e.status)){remove(kind,id);throw e;}if(e.offline&&cached)r=cached;else throw e;}
    if(owner!==readOwner()||who!==account()||!alive())throw Error('The account or page changed. Choose the route again.');
    if(kind==='shared'&&snapshot_key&&r.snapshot_key!==snapshot_key){remove(kind,id);throw Error('This shared route changed. Open it again before saving or selecting it.');}
    return r;
  }
  async function download(kind,id,options={}){return save(await authorized(kind,id,options));}
  async function choose(kind,id,options={}){const r=await authorized(kind,id,options);PlanTrack.set(r);return r;}
  function pin(){const r=PlanTrack.get();return r?JSON.parse(JSON.stringify(clean(r))):null;}
  async function beforeStart(){
    const r=pin(),owner=readOwner();if(!r)return null;
    if(navigator.onLine===false)return r;
    try{const fresh=await fetchRoute(r.kind,r.id,r.version);if(owner!==readOwner())throw Error('The account changed. Open Track again.');
      if(r.kind==='shared'&&r.snapshot_key!==fresh.snapshot_key){remove(r.kind,r.id);throw Error('This shared route changed. Review it again before starting.');}}
    catch(e){if(owner!==readOwner())throw e;if([403,404,410].includes(e.status))remove(r.kind,r.id);if(!e.offline&&![502,503,504].includes(e.status))throw e;}
    return r;
  }
  function size(r){return bytes(JSON.stringify(clean(r)));}
  function eraseDevice(){const k=key();if(k)localStorage.removeItem(k);}
  function purgeShared(k){if(!k)return;try{const rows=(JSON.parse(localStorage.getItem(k))||[]).filter(r=>r.kind!=='shared');if(rows.length)localStorage.setItem(k,JSON.stringify(rows));else localStorage.removeItem(k);}catch(_){try{localStorage.removeItem(k);}catch(_){}}}
  function attach(){const next=account();if(attached&&attached!==next){purgeShared(prefix+attached);try{const[server,id]=JSON.parse(attached),k=`kinetta.trackRoute:${server}:${id}`;if(JSON.parse(localStorage.getItem(k)||'null')?.kind==='shared')localStorage.removeItem(k);}catch(_){}}attached=next;}
  async function recheck(){
    attach();if(!account()||checking||navigator.onLine===false)return;
    const owner=readOwner();checking=(async()=>{for(const r of list()){try{const fresh=await fetchRoute(r.kind,r.id,r.version);if(owner!==readOwner())return;if(r.kind==='shared'&&fresh.snapshot_key!==r.snapshot_key){remove(r.kind,r.id);}}
      catch(e){if(owner!==readOwner())return;if([403,404,410].includes(e.status))remove(r.kind,r.id);}}})().finally(()=>checking=null);return checking;
  }
  function metadata(r){return r?{source_kind:r.kind,route_id:r.id,version:r.version,snapshot_key:r.snapshot_key||null,name:r.name,distance_m:r.distance_m}:null;}
  function sections(r){const points=RouteMath.decode(r.line),out=[];let at=0;for(const end of [...(r.breaks||[]),points.length]){const part=points.slice(at,end);if(part.length>1)out.push(part);at=end;}return out;}
  function tools(box,r){
    const owner=readOwner(),live=()=>box.isConnected&&owner===readOwner(),cached=list().find(x=>identity(x)===identity(r)),same=cached&&cached.version===r.version&&(r.kind!=='shared'||cached.snapshot_key===r.snapshot_key);
    box.innerHTML=`<p class="small muted" id="route-download-status" role="status">${same?`Route saved; offline basemap unavailable. ${(size(cached)/1024).toFixed(1)} kB · version ${cached.version}.`:cached?'Another version is saved on this device.':'Save the route line to follow it without a connection. Map tiles are not downloaded.'}</p><button class="ghost wide" id="route-device-save">${same?'Refresh route download':'Save route on this device'}</button>${cached?'<button class="linkbtn danger" id="route-device-remove">Remove device download</button>':''}<details class="small muted"><summary>Route credits</summary>${(r.attribution||credits).map(x=>`<p>${esc(x)}</p>`).join('')}</details>`;
    $('#route-device-save',box).onclick=async e=>{if(!live())return;const button=e.currentTarget;button.disabled=true;$('#route-download-status',box).textContent='Saving route…';try{await download(r.kind,r.id,{version:r.version,snapshot_key:r.snapshot_key,alive:live});if(live())tools(box,r);}catch(x){if(live())$('#route-download-status',box).textContent=x.message;}finally{if(live())button.disabled=false;}};
    const removeButton=$('#route-device-remove',box);if(removeButton)removeButton.onclick=()=>{if(!live())return;sheet('Remove route download','<p>This removes the route copy from this device. An active recording keeps its pinned route until you finish or discard it.</p><button class="primary wide" id="route-device-remove-confirm">Remove download</button><button class="ghost wide" data-close>Keep it</button>',(body,close)=>{$('#route-device-remove-confirm',body).onclick=()=>{if(!live())return;try{remove(r.kind,r.id);close();tools(box,r);}catch(x){toast(x.message);}};});};
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)recheck().catch(()=>{});});
  window.addEventListener('online',()=>recheck().catch(()=>{}));
  return{clean,list,save,remove,fromOwned,fromShared,download,choose,tools,sections,pin,beforeStart,size,eraseDevice,attach,recheck,metadata,identity};
})();
