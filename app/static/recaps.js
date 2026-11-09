// Period pictures contain only selected aggregates. Single-workout milestone pictures may add an approved, cropped route.
'use strict';
const ShareArt=(()=>{
  const palette=()=>({bg:col('--share-surface'),text:col('--share-text'),soft:col('--share-text-secondary'),muted:col('--share-text-muted'),line:col('--share-divider'),blue:col('--share-action'),tint:col('--share-soft')});
  const family=()=>getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()||'system-ui';
  function text(g,value,x,y,size=36,{color=palette().text,weight=600,max=936,align='left'}={}){
    let n=size;g.textAlign=align;g.textBaseline='alphabetic';g.fillStyle=color;
    do{g.font=`${weight} ${n}px ${family()}`;if(g.measureText(String(value)).width<=max)break;n-=2;}while(n>18);
    g.fillText(String(value),x,y);return n;
  }
  function lines(g,value,max,size=24){g.font=`500 ${size}px ${family()}`;const out=[];let line='';for(const word of String(value).split(' ')){if(g.measureText(line+' '+word).width>max&&line){out.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)out.push(line);return out;}
  const blob=canvas=>new Promise((yes,no)=>canvas.toBlob(b=>b?yes(b):no(Error('Couldn’t draw this picture')),'image/png'));
  async function deliver(picture,filename,live,link=null){
    const file=new File([picture],filename,{type:'image/png'});if(!live())return false;
    if(Native.activityShareSupported){
      const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(Error('Couldn’t open this picture'));r.readAsDataURL(picture);});
      if(!live())return false;const result=await Native.shareActivityPicture(data,'system',link);return result?.handedOff===true||result?.cancelled===false;
    }
    if(Native.on)throw Error('This version of the Kinetta app cannot share pictures. Update the app to continue.');
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],...(link?{url:link}:{} )});return live();}
    const url=URL.createObjectURL(picture),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Picture saved');return true;
  }
  async function photo(path){
    const owner=readOwner(),controller=new AbortController();let object,timer;
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},4000);});
    const load=async()=>{
      try{
        const response=await fetch((Native.base||'')+path,{credentials:Native.on?'omit':'same-origin',cache:'no-store',headers:Native.headers(),signal:controller.signal});
        if(!response.ok||owner!==readOwner()||controller.signal.aborted)return null;const data=await response.blob();if(data.size>4*1024*1024||owner!==readOwner()||controller.signal.aborted)return null;
        object=URL.createObjectURL(data);const image=new Image();image.src=object;await image.decode();return owner===readOwner()&&!controller.signal.aborted?image:null;
      }catch(_){return null;}
    };
    try{return await Promise.race([load(),timeout]);}finally{clearTimeout(timer);if(object)URL.revokeObjectURL(object);}
  }

  async function simplePicture({kicker,title,date,value,unit,facts=[],sources=[],identity=false,qrLink=null,routePoints=[],routeTrimmed=true}){
    const pictureOwner=readOwner();
    await document.fonts.ready;const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
    const g=canvas.getContext('2d'),p=palette(),M=72;g.fillStyle=p.bg;g.fillRect(0,0,1080,1350);let y=85;
    if(identity){
      const image=App.me.photo?await photo(`/api/people/${encodeURIComponent(App.me.login)}/photo?v=${App.me.photo}`):null;
      if(image){g.save();g.beginPath();g.arc(M+34,y+20,34,0,Math.PI*2);g.clip();g.drawImage(image,M,y-14,68,68);g.restore();}
      text(g,'@'+App.me.login,M+(image?94:0),y+35,34,{max:image?830:936,color:p.soft});y+=100;
    }
    text(g,kicker,M,y+30,28,{color:p.muted});y+=85;
    for(const line of lines(g,title,936,56)){text(g,line,M,y+45,56);y+=70;}
    if(date){text(g,date,M,y+38,32,{color:p.soft});y+=70;}
    const hasMap=routePoints.length>1&&!qrLink;
    if(!hasMap&&!qrLink){
      // Simple pictures use the available frame instead of leaving a fixed hole above the footer.
      const factLines=facts.flatMap(f=>lines(g,f,936,32)),stackTop=Math.max(y+70,360),stackBottom=1155,valueHeight=235,factHeight=factLines.length*48,spare=stackBottom-stackTop-valueHeight-factHeight,gap=factLines.length?Math.max(32,spare):0,valueTop=stackTop+(factLines.length?0:Math.max(0,spare/2));
      text(g,value,M,valueTop+120,148);if(unit)text(g,unit,M,valueTop+178,40,{color:p.soft});let factY=stackTop+valueHeight+gap;
      factLines.forEach(line=>{text(g,line,M,factY+35,32,{color:p.soft});factY+=48;});y=Math.max(stackBottom,factY);
    }else{
      y=hasMap?y+12:Math.max(y+80,520);text(g,value,M,y+120,148);if(unit)text(g,unit,M,y+178,40,{color:p.soft});y+=235;
      for(const fact of facts)for(const line of lines(g,fact,936,32)){text(g,line,M,y+35,32,{color:p.soft});y+=48;}
    }
    const list=[...new Set(sources)],credit=list.length?'Includes data from '+list.slice(0,2).join(', ')+(list.length>2?` + ${list.length-2} other Garmin devices`:''):'';
    if(qrLink){
      if(y+20>880)throw Error('The invitation picture needs more room. Try without photo and username.');
      const qr=qrcode(0,'M');qr.addData(qrLink);qr.make();const n=qr.getModuleCount(),quiet=4,cell=Math.floor(300/(n+quiet*2)),size=cell*(n+quiet*2),left=Math.floor((1080-size)/2),top=900;
      g.fillStyle='#fff';g.fillRect(left,top,size,size);g.fillStyle='#000';
      for(let row=0;row<n;row++)for(let x=0;x<n;x++)if(qr.isDark(row,x))g.fillRect(left+(x+quiet)*cell,top+(row+quiet)*cell,cell,cell);
      text(g,'Scan to join',540,1235,26,{align:'center',color:p.muted});
    }
    const creditLines=credit?lines(g,credit,936,22):[];const top=1260-creditLines.length*27;
    let mapCredit='';
    if(hasMap){
      const config=await MapTiles.config().catch(()=>null),credit=config?MapTiles.credit(config):'',attribution=credit?lines(g,credit,912,20):[];
      const box={x:M,y:y+22,w:936,h:top-y-48,pad:64,top:0,under:attribution.length*25+12};
      if(box.h<180)throw Error('The picture could not fit clearly. Try again without photo and username.');
      // Only cropped points reach the renderer. Use the configured activity-picture tiles and projection.
      g.save();g.beginPath();g.roundRect(box.x,box.y,box.w,box.h,24);g.clip();
      try{
        g.fillStyle=p.tint;g.fillRect(box.x,box.y,box.w,box.h);
        g.filter='grayscale(.45) brightness(1.03) contrast(.95)';
        const {tiles,P}=await mapPlace(g,routePoints,box);g.filter='none';
        if(tiles){g.fillStyle='rgba(255,255,255,.14)';g.fillRect(box.x,box.y,box.w,box.h);mapCredit=credit;}
        g.lineJoin=g.lineCap='round';
        const path=()=>{g.beginPath();routePoints.forEach((point,i)=>{const [x,y]=P(point);if(i)g.lineTo(x,y);else g.moveTo(x,y);});};
        path();g.strokeStyle='rgba(255,255,255,.95)';g.lineWidth=26;g.stroke();
        path();g.strokeStyle=p.blue;g.lineWidth=13;g.stroke();
      }finally{g.restore();}
      // Attribution stays outside the clipped map, with its own bounded space above device credits.
      if(attribution.length*25>box.h-100)throw Error('The map credit could not fit clearly.');
      if(mapCredit){g.fillStyle=p.bg;g.fillRect(M,box.y+box.h-attribution.length*25-12,936,attribution.length*25+12);attribution.forEach((line,n)=>text(g,line,M+12,box.y+box.h-(attribution.length-1-n)*25-5,20,{color:p.muted,max:912}));}
      y=top-24;
    }
    if(y+20>top)throw Error('The picture could not fit clearly. Try again without photo and username.');
    creditLines.forEach((line,n)=>text(g,line,M,top+n*27,22,{color:p.muted}));
    g.strokeStyle=p.line;g.lineWidth=2;g.beginPath();g.moveTo(M,1275);g.lineTo(1008,1275);g.stroke();drawMark(g,M+24,1311,48,p.blue);text(g,'Kinetta',M+62,1323,30);text(g,'kinetta.app',1008,1321,26,{align:'right',color:p.muted});
    const pictureBlob=await blob(canvas);if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',pictureOwner);
    return{blob:pictureBlob,alt:[identity?'@'+App.me.login:'',kicker,title,date,value,unit,...facts,credit,hasMap?(routeTrimmed?'Route with start and end hidden':'Route with start and end visible'):'',mapCredit,qrLink?'Invitation: '+qrLink:''].filter(Boolean).join('. ')};
  }
  return{palette,family,text,lines,blob,deliver,photo,simplePicture};
})();
const ShareSheet=(()=>{
  const save=(blob,name)=>{if(Native.on)return false;let url;try{url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;}catch(_){if(url)URL.revokeObjectURL(url);return false;}};
  function open({items,title='Share',actions=[]}){
    if(!items?.length)return;
    const owner=readOwner(),values=items.map(item=>Object.fromEntries((item.controls||[]).map(control=>[control.key,!!control.checked])));
    sheet(title,`<div class="share-sheet" data-unified-share>
      <div class="share-picture-row" role="radiogroup" aria-label="Pictures to share">${items.map((item,index)=>`<button type="button" role="radio" class="share-picture-choice" data-share-choice="${index}" data-busy="true" aria-checked="false" tabindex="-1"><span class="share-picture-frame"><img data-share-image="${index}" alt="" hidden><span class="share-picture-loading" aria-hidden="true">Loading…</span></span><span class="share-picture-label">${esc(item.label)}</span></button>`).join('')}</div>
      <div class="share-picture-controls" data-share-controls></div><p class="share-picture-note small muted" data-share-note></p><p class="vh" data-share-description></p><p class="share-picture-status small muted" role="status" aria-live="polite"></p>
      <div class="share-picture-actions"><button type="button" class="primary wide" data-share-send disabled>${svg('share')}Share</button><button type="button" class="linkbtn wide" data-share-save disabled${Native.on?' hidden':''}>Save image</button>${actions.map((action,index)=>`<button type="button" class="linkbtn wide" data-share-action="${index}">${esc(action.label)}</button>`).join('')}</div>
    </div>`,(body,close)=>{
      const live=()=>body.isConnected&&owner===readOwner()&&items[selected]?.valid?.()!==false,row=$('.share-picture-row',body),controls=$('[data-share-controls]',body),note=$('[data-share-note]',body),status=$('.share-picture-status',body),send=$('[data-share-send]',body),saveButton=$('[data-share-save]',body);
      const cache=new Map(),versions=items.map(()=>0);let selected=-1,busy=false,scrollTimer=0;
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      const buttons=()=>{const current=cache.get(selected),disabled=busy||!current?.blob;send.disabled=disabled;saveButton.disabled=disabled;$$('[data-share-action]',body).forEach(button=>button.disabled=busy);};
      const renderControls=index=>{
        const item=items[index];controls.innerHTML=(item.controls||[]).map(control=>`<label class="check"><input type="checkbox" data-share-control="${esc(control.key)}"${values[index][control.key]?' checked':''}>${esc(control.label)}</label>`).join('');
        $$('[data-share-control]',controls).forEach(input=>input.onchange=()=>{values[index][input.dataset.shareControl]=input.checked;load(index,true);});
      };
      async function load(index,redraw=false){
        const old=cache.get(index);if(old&&!redraw)return old;
        if(old?.url)URL.revokeObjectURL(old.url);cache.delete(index);const stamp=++versions[index],item=items[index],image=$(`[data-share-image="${index}"]`,body),choice=$(`[data-share-choice="${index}"]`,body);image.hidden=true;image.removeAttribute('src');image.alt='';
        choice.dataset.busy='true';if(index===selected){status.textContent='Preparing picture…';buttons();}
        try{
          const result=await item.build({...values[index]});const blob=result instanceof Blob?result:result?.blob;
          if(!blob)throw Error('Couldn’t prepare this picture. Try again.');if(!live()||stamp!==versions[index])return null;
          const record={blob,url:URL.createObjectURL(blob),filename:result.filename||item.filename||'kinetta.png',alt:result.alt||item.alt||item.label,link:result.link||item.link||null};cache.set(index,record);
          image.src=record.url;image.alt=record.alt;image.hidden=false;choice.dataset.busy='false';
          if(index===selected){status.textContent='';buttons();}
          return record;
        }catch(error){if(live()&&stamp===versions[index]){image.hidden=true;image.removeAttribute('src');image.alt='';choice.dataset.busy='false';if(index===selected){status.textContent=error.message||'Couldn’t make this picture.';buttons();}}return null;}
      }
      function select(index,scroll=false,focus=false){
        if(index<0||index>=items.length)return;selected=index;
        $$('[data-share-choice]',body).forEach((choice,i)=>{choice.setAttribute('aria-checked',String(i===index));choice.tabIndex=i===index?0:-1;});
        if(scroll)row.children[index]?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});if(focus)row.children[index]?.focus({preventScroll:true});
        renderControls(index);note.textContent=items[index].note||'';$('[data-share-description]',body).textContent=items[index].description||'';const current=cache.get(index);status.textContent=current?'':'Preparing picture…';buttons();load(index);
      }
      $$('[data-share-choice]',body).forEach(choice=>{choice.onclick=()=>select(Number(choice.dataset.shareChoice));choice.onkeydown=event=>{const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:['ArrowLeft','ArrowUp'].includes(event.key)?-1:0;if(!direction)return;event.preventDefault();select((Number(choice.dataset.shareChoice)+direction+items.length)%items.length,true,true);};});
      row.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{
        const center=row.getBoundingClientRect().left+row.clientWidth/2;let best=0,distance=Infinity;
        [...row.children].forEach((slide,index)=>{const rect=slide.getBoundingClientRect(),d=Math.abs(rect.left+rect.width/2-center);if(d<distance){best=index;distance=d;}});if(best!==selected)select(best);
      },80);},{passive:true});
      send.onclick=async()=>{
        const current=cache.get(selected),item=items[selected];if(!current||busy||!live())return;busy=true;buttons();
        try{if(item.beforeShare&&await item.beforeShare({blob:current.blob,filename:current.filename,link:current.link,values:{...values[selected]},live,close,refresh:()=>load(selected,true),setStatus:value=>{if(live())status.textContent=value;}})===false)return;
          const handed=item.onShare?await item.onShare({blob:current.blob,filename:current.filename,link:current.link,values:{...values[selected]},live,close,setStatus:value=>{if(live())status.textContent=value;}}):await ShareArt.deliver(current.blob,current.filename,live,current.link);
          if(handed&&live())await item.afterShare?.({blob:current.blob,values:{...values[selected]},close,live});
        }catch(error){if(live()&&error.name!=='AbortError')status.textContent=error.message||'Couldn’t share this picture.';}
        finally{busy=false;if(live())buttons();}
      };
      saveButton.onclick=async()=>{
        const current=cache.get(selected),item=items[selected];if(!current||busy||!live())return;busy=true;buttons();
        try{if(!save(current.blob,current.filename)){status.textContent='This device cannot save the picture here. Use Share instead.';return;}status.textContent='Picture saved.';await item.afterSave?.({blob:current.blob,values:{...values[selected]},close,live});}
        catch(error){if(live())status.textContent=error.message||'Couldn’t save this picture.';}
        finally{busy=false;if(live())buttons();}
      };
      $$('[data-share-action]',body).forEach(button=>button.onclick=async()=>{if(busy||!live())return;busy=true;buttons();try{await actions[Number(button.dataset.shareAction)].run({close,live});}catch(error){if(live())status.textContent=error.message||'Couldn’t update this milestone.';}finally{busy=false;if(live())buttons();}});
      viewResources.set(body,()=>{clearTimeout(scrollTimer);for(const record of cache.values())URL.revokeObjectURL(record.url);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      select(0);
    });
  }
  return{open};
})();
const Recaps=(()=>{
  const periods=[['week','Week'],['month','Month'],['year','Year']];
  const aliases={this_week:['week',0],last_week:['week',1],this_month:['month',0],last_month:['month',1],this_year:['year',0]};
  const defaults={totals:true,calendar:true,highlights:true,streak:true,food:false,identity:false};
  const scope=()=>JSON.stringify([serverKey(),App.me?.id]);
  function today(zone=App.me?.tz){if(!zone)throw Error('Load your profile time zone before opening a recap.');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
  const periodArgs=(period,offset=0)=>aliases[period]?{period:aliases[period][0],offset:aliases[period][1]}:{period,offset};
  function defaultOffset(period,day=today()){return +day.slice(-2)<=7&&(period==='month'||period==='year'&&day.slice(5,7)==='01')?1:0;}
  const requestAlias=(period,offset)=>period==='week'?({0:'this_week',1:'last_week'}[offset]||null):period==='month'?({0:'this_month',1:'last_month'}[offset]||null):period==='year'&&offset===0?'this_year':null;
  function startFor(period,day=today(),offset=0){
    ({period,offset}=periodArgs(period,offset));
    const d=new Date(day+'T12:00:00Z');
    if(period==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7-7*offset);
    else if(period==='year'){d.setUTCMonth(0,1);d.setUTCFullYear(d.getUTCFullYear()-offset);}
    else{d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-offset);}
    return d.toISOString().slice(0,10);
  }
  const label=d=>{const p=periodArgs(d.period,d.offset||0).period,date=new Date(d.start+'T12:00:00Z');return p==='week'?'Week of '+date.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}):date.toLocaleDateString(undefined,{timeZone:'UTC',...(p==='year'?{year:'numeric'}:{month:'long',year:'numeric'})});};
  const navLabel=(period,offset,start,end)=>{if(!offset)return 'This '+period;const first=new Date(start+'T12:00:00Z');if(period==='year')return String(first.getUTCFullYear());if(period==='month')return first.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});const last=end?new Date(end+'T12:00:00Z'):new Date(first);if(!end)last.setUTCDate(last.getUTCDate()+7);last.setUTCDate(last.getUTCDate()-1);const a=first.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'}),b=last.toLocaleDateString(undefined,{timeZone:'UTC',...(first.getUTCMonth()===last.getUTCMonth()?{day:'numeric'}:{month:'short',day:'numeric'})});return a+'–'+b+', '+last.getUTCFullYear();};
  const distance=d=>(d.distance_m/(d.units==='imperial'?1609.344:1000)).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});
  const unit=d=>d.units==='imperial'?'mi':'km';
  function time(seconds){const n=Math.max(0,Math.round(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60);return h?`${h} h${m?' '+m+' m':''}`:m?`${m} m`:n+' s';}
  function summary(d,o){
    const title=label(d),sport=SPORT_NAMES[d.top_sport]||'activity';let hero=null;
    if(o.totals){
      if(d.distance_m>0)hero={value:distance(d),label:unit(d)};
      else if(d.time_s>0)hero={value:time(d.time_s),label:d.top_sport==='workout'?'of lifting':'active time'};
      else if(d.active_days>0)hero={value:String(d.active_days),label:d.active_days===1?'active day':'active days'};
      else if(o.food&&d.food.logged_days)hero={value:String(d.food.logged_days),label:'days with food logged'};
    }
    const secondary=d.activities?[`${d.active_days} active ${d.active_days===1?'day':'days'}`,d.time_s?time(d.time_s):`${d.activities} ${d.activities===1?'activity':'activities'}`,sport].join(' · '):'';
    const highlights=o.highlights?d.highlights.map(h=>h.kind==='longest'?`Longest: ${distance({...d,distance_m:h.distance_m})} ${unit(d)} ${(SPORT_NAMES[h.sport]||h.sport).toLowerCase()}`:`New ${h.label} best · ${dur(h.elapsed_s)}`):[];
    const food=o.food?[`Logged food ${d.food.logged_days} of ${Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000)} days`,...(d.food.protein_goal_days!==null?[`Met protein goal ${d.food.protein_goal_days} days`]:[])]:[];
    const activityShown=o.totals||o.calendar||o.highlights||o.streak&&d.streak_weeks>=2;
    const credits=activityShown&&d.garmin_sources.length?'Includes data from '+d.garmin_sources.join(', '):'';
    const alt=[title,hero&&hero.value+' '+hero.label,o.totals&&secondary,o.calendar&&d.activities>0&&'Activity chart',...highlights,o.streak&&d.streak_weeks>=2&&`${d.streak_weeks} active weeks in a row`,...food,credits].filter(Boolean).join('. ');
    return {title,hero,secondary,highlights,food,credits,alt};
  }
  const recapKey=(period,offset,start,zone)=>`/api/recaps?period=${period}&offset=${offset}&start=${start}&tz=${encodeURIComponent(zone)}`;
  function validFacts(data,period,offset,start,zone){
    const resolved=periodArgs(data?.period,data?.offset??0);
    return resolved.period===period&&resolved.offset===offset&&data?.start===start&&data?.tz===zone;
  }
  async function read(period,offset){
    const owner=readOwner(),profileZone=App.me?.tz||null,metaKey=`/api/recaps?period=${period}&offset=${offset}&server_meta=1`,alias=requestAlias(period,offset);
    const changed=()=>owner!==readOwner()||(App.me?.tz||null)!==profileZone;
    try{
      const query='/api/recaps?period='+encodeURIComponent(alias||period)+(alias?'':'&offset='+offset),raw=await api(query);
      if(changed())throw Object.assign(Error('Your account or time zone changed. Refresh and try again.'),{stale:true});
      if(raw?.period!==(alias||period)||!/^\d{4}-\d{2}-\d{2}$/.test(raw.start)||!/^\d{4}-\d{2}-\d{2}$/.test(raw.end)||typeof raw.tz!=='string'||!raw.tz)throw Error('The recap reply was incomplete. Try again.');
      if(alias?raw.offset!=null&&raw.offset!==0:raw.offset!==offset)throw Error('The recap reply was incomplete. Try again.');
      if(profileZone&&raw.tz!==profileZone)throw Object.assign(Error('Your time zone changed. Refresh and try again.'),{stale:true});
      const data={...raw,period,offset};
      // A request may cross midnight: the returned range, rather than its earlier request time, owns the cache key.
      keep(recapKey(period,offset,data.start,data.tz),data);keep(metaKey,{period,start:data.start,tz:data.tz});return data;
    }catch(error){
      if(changed()||error.stale||[401,403,404].includes(error.status))throw error;
      const legacyAlias=alias||requestAlias(period,offset),legacyMeta=legacyAlias&&kept(`/api/recaps?period=${legacyAlias}&server_meta=1`),meta=kept(metaKey),zone=profileZone||(meta?.period===period?meta.tz:null)||(legacyMeta?.period===legacyAlias?legacyMeta.tz:null);
      if(!zone)throw error;
      const start=startFor(period,today(zone),offset);
      // Accept a compatible old cache only after checking its full range and timezone.
      const cached=kept(recapKey(period,offset,start,zone))||kept(legacyAlias&&`/api/recaps?period=${legacyAlias}&start=${start}`)||kept(`/api/recaps?period=${period}&start=${start}`);
      if(validFacts(cached,period,offset,start,zone))return {...cached,period,offset,from_cache:true};
      throw error;
    }
  }

  // Export colours stay legible in either app theme, like the other ShareArt pictures.
  const ink=()=>({blue:col('--share-brand'),action:col('--share-action'),white:col('--share-on-action'),tint:col('--share-brand-soft')});
  function chartData(d){
    const distance=d.days.some(x=>x.distance_m>0),field=distance?'distance_m':'time_s',factor=distance?(d.units==='imperial'?1609.344:1000):60,by=new Map(d.days.map(x=>[x.day,x]));
    const year=d.period==='year'||d.period==='this_year',count=year?12:Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000),begin=new Date(d.start+'T12:00:00Z');
    return {unit:distance?unit(d):'min',year,bars:Array.from({length:count},(_,i)=>{
      const date=new Date(begin);year?date.setUTCMonth(i,1):date.setUTCDate(date.getUTCDate()+i);const day=date.toISOString().slice(0,10),rows=year?d.days.filter(x=>x.day.slice(0,7)===day.slice(0,7)):[by.get(day)].filter(Boolean);
      return{day,value:rows.reduce((n,x)=>n+(x[field]||0),0)/factor,active:rows.some(x=>x.activities>0),label:date.toLocaleDateString(undefined,{timeZone:'UTC',...(year?{month:'short'}:d.period==='week'||d.period.includes('week')?{weekday:'narrow'}:{day:'numeric'})})};
    })};
  }
  function chart(g,d,x,y,w,h,p){
    const data=chartData(d),M=32,top=Math.max(1,...data.bars.map(b=>b.value)),step=(w-2*M)/data.bars.length,base=y+h-66,room=h-150;
    ShareArt.text(g,`${data.year?'Monthly':'Daily'} ${data.unit==='min'?'active time':'distance'} · ${data.unit}`,x+M,y+45,28,{color:p.white,max:w-2*M-200});
    ShareArt.text(g,'0–'+top.toLocaleString(undefined,{maximumFractionDigits:1})+' '+data.unit,x+w-M,y+45,25,{align:'right',color:p.white,max:200});
    data.bars.forEach((b,i)=>{
      const bw=Math.min(data.year?48:64,step*.65),height=b.value?Math.max(12,b.value/top*room):b.active?16:8,left=x+M+step*(i+.5)-bw/2;
      g.fillStyle=p.white;g.globalAlpha=.12;g.beginPath();g.roundRect(left,base-room,bw,room,Math.min(10,bw/2));g.fill();
      g.fillStyle=b.active?p.white:p.tint;g.globalAlpha=b.active?1:.8;g.beginPath();g.roundRect(left,base-height,bw,height,Math.min(10,bw/2));g.fill();g.globalAlpha=1;
      if(data.bars.length<=12||i%7===0||i===data.bars.length-1)ShareArt.text(g,b.label,left+bw/2,base+37,data.year?23:26,{align:'center',color:p.white,max:Math.max(42,step-4)});
      if(data.bars.length===7&&b.value)ShareArt.text(g,b.value.toLocaleString(undefined,{maximumFractionDigits:1}),left+bw/2,base-height-14,26,{align:'center',color:p.white,max:step-4});
    });
  }
  function tiles(d,o){
    const items=[];
    if(o.highlights)for(const h of d.highlights)items.push(h.kind==='longest'?{label:'Longest shared '+(SPORT_NAMES[h.sport]||h.sport).toLowerCase(),value:distance({...d,distance_m:h.distance_m})+' '+unit(d)}:{label:'New '+h.label+' best',value:dur(h.elapsed_s)});
    if(o.streak&&d.streak_weeks>=2)items.push({label:'Active weeks in a row',value:String(d.streak_weeks)});
    if(o.food){items.push({label:'Days with food logged',value:String(d.food.logged_days)});if(d.food.protein_goal_days!==null)items.push({label:'Days meeting protein goal',value:String(d.food.protein_goal_days)});}
    return items;
  }
  async function draw(d,o){
    await document.fonts.ready;
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
    const g=canvas.getContext('2d'),p=ink(),s=summary(d,o),M=72,W=936,H=canvas.height;
    const gradient=g.createLinearGradient(0,0,1080,H);gradient.addColorStop(0,p.action);gradient.addColorStop(1,p.blue);g.fillStyle=gradient;g.fillRect(0,0,1080,H);
    let y=72;
    if(o.identity){
      const image=App.me.photo?await ShareArt.photo(`/api/people/${encodeURIComponent(App.me.login)}/photo?v=${App.me.photo}`):null;
      if(image){g.save();g.beginPath();g.arc(M+28,y+24,28,0,2*Math.PI);g.clip();g.drawImage(image,M,y-4,56,56);g.restore();}
      ShareArt.text(g,'@'+App.me.login,M+(image?80:0),y+36,30,{color:p.white,max:image?856:W});y+=82;
    }
    ShareArt.text(g,s.title,M,y+42,43,{color:p.white,max:W});y+=86;
    const creditLines=s.credits?ShareArt.lines(g,s.credits,W,23):[],footer=H-118-creditLines.length*29,items=tiles(d,o),rows=[];
    if(o.totals)rows.push({kind:'hero',weight:1.15});
    if(o.calendar)rows.push({kind:'chart',weight:1.4});
    for(let i=0;i<items.length;i+=2)rows.push({kind:'tiles',items:items.slice(i,i+2),weight:.65});
    // With only Totals selected, let the existing facts carry the lower part of the poster.
    if(rows.length===1&&rows[0].kind==='hero'&&d.activities)rows.push({kind:'tiles',weight:.8,items:[{label:'Active days',value:String(d.active_days)},{label:'Active time',value:time(d.time_s)}]});
    if(!rows.length)rows.push({kind:'empty',weight:1});
    const gap=24,available=footer-30-y-gap*(rows.length-1),weight=rows.reduce((n,r)=>n+r.weight,0);
    for(const row of rows){
      const h=available*row.weight/weight;
      if(row.kind==='hero'){
        const hero=s.hero||{value:d.activities?'Your progress':'No activities yet',label:''},single=!s.hero;
        if(single){
          drawMark(g,540,y+h*.32,Math.min(420,h*.6),p.white);
          ShareArt.text(g,hero.value,540,y+h*.8,Math.min(96,h*.18),{align:'center',color:p.white,max:W,weight:800});
          y+=h+gap;continue;
        }
        const valueSize=Math.min(single?96:260,h*.52),unitSize=Math.min(64,valueSize*.4),baseline=y+h*.43;
        // Reserve room for the unit before fitting the number; both use the same baseline.
        g.font=`650 ${unitSize}px ${ShareArt.family()}`;const unitWidth=hero.label?g.measureText(hero.label).width+22:0;
        const actual=ShareArt.text(g,hero.value,M,baseline,valueSize,{color:p.white,max:Math.max(280,W-unitWidth),weight:800});
        g.font=`800 ${actual}px ${ShareArt.family()}`;const valueWidth=g.measureText(hero.value).width;
        if(hero.label)ShareArt.text(g,hero.label,M+valueWidth+22,baseline,unitSize,{color:p.white,max:W-valueWidth-22});
        if(s.secondary)ShareArt.text(g,s.secondary,M,y+h*.72,32,{color:p.white,max:W});
      }else if(row.kind==='chart')chart(g,d,M,y,W,h,p);
      else if(row.kind==='tiles')row.items.forEach((tile,i)=>{
        const w=(W-gap*(row.items.length-1))/row.items.length,x=M+i*(w+gap);g.fillStyle=p.white;g.beginPath();g.roundRect(x,y,w,h,30);g.fill();
        if(h>400){
          const labelSize=Math.min(78,h*.12),lines=ShareArt.lines(g,tile.label,w-64,labelSize),valueSize=Math.min(300,h*.35);
          lines.forEach((line,j)=>ShareArt.text(g,line,x+32,y+70+j*labelSize*1.2,labelSize,{color:p.blue,max:w-64}));
          ShareArt.text(g,tile.value,x+32,y+h*.8,valueSize,{color:p.blue,max:w-64,weight:800});
        }else{
          ShareArt.text(g,tile.label,x+32,y+40,25,{color:p.blue,max:w-64});
          ShareArt.text(g,tile.value,x+32,y+h-28,Math.min(130,h*.4,Math.max(28,h-90)),{color:p.blue,max:w-64,weight:800});
        }
      });
      else{
        ShareArt.text(g,'Your progress',M,y+h*.42,112,{color:p.white,max:W,weight:800});
        ShareArt.text(g,o.identity?'Made with Kinetta':'Choose what to include',M,y+h*.62,44,{color:p.white,max:W});
      }
      y+=h+gap;
    }
    creditLines.forEach((line,i)=>ShareArt.text(g,line,M,footer+25+i*29,23,{color:p.white}));
    g.strokeStyle=p.white;g.globalAlpha=.35;g.lineWidth=2;g.beginPath();g.moveTo(M,H-88);g.lineTo(1008,H-88);g.stroke();g.globalAlpha=1;
    drawMark(g,M+24,H-45,48,p.white);ShareArt.text(g,'Kinetta',M+62,H-33,30,{color:p.white});ShareArt.text(g,'kinetta.app',1008,H-35,26,{align:'right',color:p.white});
    const chartInfo=chartData(d),chartAlt=o.calendar?chartInfo.bars.filter(b=>b.active).map(b=>`${b.day}: ${b.value.toLocaleString(undefined,{maximumFractionDigits:1})} ${chartInfo.unit}`).join('; '):'';
    return {blob:await ShareArt.blob(canvas),alt:[o.identity?'@'+App.me.login:'',s.alt,o.calendar?'Activity chart. '+(chartAlt||'No active days'):''].filter(Boolean).join('. ')};
  }
  function open(initial,onShared){
    const owner=readOwner(),prefKey='fit.recap.options:'+scope(),saved=store.get(prefKey);
    let options={...defaults,...Object.fromEntries(Object.entries(saved||{}).filter(([k,v])=>k in defaults&&typeof v==='boolean'))};
    let period,offset;
    if(initial&&typeof initial==='object'&&['week','month','year'].includes(initial.period)){period=initial.period;offset=Math.max(0,Math.min(24,Number.isInteger(initial.offset)?initial.offset:0));}
    else if(typeof initial==='string'&&aliases[initial]){({period,offset}=periodArgs(initial));}
    else if(typeof initial==='string'&&['week','month','year'].includes(initial)){period=initial;offset=defaultOffset(period);}
    else{period='month';offset=defaultOffset(period);}
    let data=null,version=0,sending=false,defaultApplied=false,canShare=false;
    const names=[['totals','Totals'],['calendar','Chart'],['highlights','Highlights'],['streak','Streak'],['food','Food'],['identity','Photo & username']];
    sheet('Share progress',`<div class="seg vis3 recap-periods" role="group" aria-label="Recap period">${periods.map(([k,v])=>`<button type="button" data-recap-period="${k}" aria-pressed="${k===period}"><span>${v}</span></button>`).join('')}</div><div class="recap-period-nav"><button type="button" class="icon-btn" data-recap-prev aria-label="Previous period">‹</button><span id="recap-period-label" aria-live="polite"></span><button type="button" class="icon-btn" data-recap-next aria-label="Next period">›</button></div><fieldset class="recap-options"><legend>Include</legend><div>${names.map(([k,v])=>`<button type="button" data-recap-option="${k}" aria-pressed="${options[k]}"${k==='streak'?' aria-label="Activity streak (two or more active weeks in a row)"':''} disabled><span>${v}</span></button>`).join('')}</div></fieldset><p class="small muted" id="recap-streak-help" role="status" hidden></p><p class="small muted" id="recap-description"></p><p class="small muted" id="recap-status" role="status" data-ready="false"></p><button type="button" class="ghost wide" id="recap-retry" hidden>Retry data</button><div class="recap-actions"><button type="button" class="primary wide" id="recap-share" disabled>Preview and share</button></div>`,(b,close)=>{
      b.closest('.sheet').classList.add('recap-sheet');
      const live=()=>owner===readOwner()&&b.isConnected,button=$('#recap-share',b),status=$('#recap-status',b);
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      viewResources.set(b,()=>{version++;if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      const periodLabel=$('#recap-period-label',b),previous=$('[data-recap-prev]',b),next=$('[data-recap-next]',b);
      function updateNav(){
        const matches=data?.period===period&&data?.offset===offset,start=matches?data.start:startFor(period,today(),offset);
        periodLabel.textContent=navLabel(period,offset,start,matches?data.end:null);
        previous.disabled=offset>=24;next.disabled=offset<=0;
        previous.setAttribute('aria-label','Previous '+period);next.setAttribute('aria-label','Next '+period);
      }
      function controls(){
        $$('[data-recap-option]',b).forEach(x=>{const k=x.dataset.recapOption,eligible=k!=='streak'||data?.streak_weeks>=2;x.disabled=sending||!data;if(eligible)x.removeAttribute('aria-disabled');else x.setAttribute('aria-disabled','true');x.setAttribute('aria-pressed',String(options[k]&&eligible));});
        $$('[data-recap-period],[data-recap-prev],[data-recap-next]',b).forEach(x=>{if(x.matches('[data-recap-prev]'))x.disabled=sending||offset>=24;else if(x.matches('[data-recap-next]'))x.disabled=sending||offset<=0;else x.disabled=sending;});button.disabled=sending||!canShare;
      }
      async function make(reload=false){
        $('#recap-streak-help',b).hidden=true;const run=++version;canShare=false;status.dataset.ready='false';controls();status.textContent='';$('#recap-retry',b).hidden=true;
        try{
          const fresh=reload||!data||data.period!==period||data.offset!==offset?await read(period,offset):data;if(!live()||run!==version)return;data={...fresh,units:App.me?.units||fresh.units};updateNav();
          if(!saved&&!defaultApplied)options.streak=data.streak_weeks>=2;defaultApplied=true;
          $('#recap-description',b).textContent='Totals and chart include Only me workouts; highlights use shared activities. No maps, places or body details.'+(options.food?' Food: logged and protein-goal days only.':'')+(options.identity?' Includes your photo and username.':'');
          const hasData=data.activities>0||options.food&&data.food.logged_days>0,hasSections=options.totals||options.calendar||options.highlights&&data.highlights.length>0||options.streak&&data.streak_weeks>=2||options.food||options.identity;
          canShare=hasData&&hasSections;
          const messages=[];
          if(data.from_cache)messages.push('Using the last data loaded for this period.');
          if(!hasData)messages.push(data.food.logged_days?'No activities in this period. Turn on Food to include logged days, or choose another period.':'No activities in this period yet. Choose another period.');
          status.textContent=messages.join(' ');
        }catch(e){if(live()&&run===version){status.textContent=e.message;$('#recap-retry',b).hidden=false;}}
        finally{if(live()&&run===version){status.dataset.ready='true';controls();}}
      }
      $$('[data-recap-period]',b).forEach(x=>x.onclick=()=>{if(sending||!live())return;period=x.dataset.recapPeriod;offset=defaultOffset(period);data=null;$$('[data-recap-period]',b).forEach(p=>p.setAttribute('aria-pressed',String(p===x)));updateNav();make(true);});
      previous.onclick=()=>{if(sending||offset>=24||!live())return;offset++;data=null;updateNav();make(true);};
      next.onclick=()=>{if(sending||offset<=0||!live())return;offset--;data=null;updateNav();make(true);};
      $$('[data-recap-option]',b).forEach(x=>x.onclick=()=>{if(sending||!live())return;const k=x.dataset.recapOption;if(k==='streak'&&data?.streak_weeks<2){const help=$('#recap-streak-help',b);help.textContent='Available after two active weeks in a row.';help.hidden=false;return;}options[k]=!options[k];store.set(prefKey,options);make();});
      $('#recap-retry',b).onclick=()=>make(true);
      button.onclick=()=>{if(sending||!canShare||!live())return;const recap={...data,period,offset},selected={...options},filename=`kinetta-${data.start}.png`;
        const item={label:'Progress recap',filename,note:$('#recap-description',b).textContent,valid:()=>owner===readOwner(),build:async()=>{const result=await draw(recap,selected);if(owner!==readOwner())throw Error('The account changed.');if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',owner);return{...result,filename};},afterShare:()=>onShared?.(recap),afterSave:()=>onShared?.(recap)};
        close();ShareSheet.open({items:[item],title:'Share progress'});
      };
      updateNav();
      make(true);
    });
  }
  function entry(el){const acts=$('.progress-heading .acts',el);if(!acts||$('#recap-entry',el))return;const b=document.createElement('button');b.id='recap-entry';b.type='button';b.className='linkbtn';b.textContent='Share';b.setAttribute('aria-label','Share a progress picture');b.onclick=()=>open();acts.prepend(b);}
  async function offer(box){
    if(!box)return;
    try{if(+today().slice(-2)>7)return;const owner=readOwner(),start=startFor('month',today(),1),key='fit.recap.offer:'+scope()+':'+start;
      if(store.get(key))return;const d=await read('month',1);if(owner!==readOwner()||!box.isConnected||!d.monthly_offer||store.get(key))return;
      box.innerHTML=`<section class="card recap-offer"><div><h2>Your ${esc(new Date(d.start+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'long'}))} is ready</h2><p class="small muted">Make a picture of your month.</p></div><div class="acts"><button type="button" class="ghost" data-recap-month>Share</button><button type="button" class="icon-btn" data-recap-dismiss aria-label="Dismiss monthly recap">${svg('close')}</button></div></section>`;
      const dismiss=reason=>{if(owner!==readOwner())return;store.set(key,reason);if(box.isConnected)box.innerHTML='';};$('[data-recap-dismiss]',box).onclick=()=>dismiss('dismissed');$('[data-recap-month]',box).onclick=()=>open({period:'month',offset:1},shared=>{if(shared.period==='month'&&shared.offset===1&&shared.start===d.start)dismiss('shared');});
    }catch(_){/* A quiet optional offer must not replace the person's useful day. */}
  }
  return{open,entry,offer,draw,summary,startFor,today,label};
})();
