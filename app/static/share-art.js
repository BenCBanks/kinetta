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
      const factLines=facts.flatMap(f=>lines(g,f,936,32)),stackTop=Math.max(y+70,360),stackBottom=1155,valueHeight=235,factHeight=factLines.length*48,spare=Math.max(0,stackBottom-stackTop-valueHeight-factHeight),sections=factLines.length?3:2,gap=spare/sections,valueTop=stackTop+gap;
      text(g,value,M,valueTop+120,148);if(unit)text(g,unit,M,valueTop+178,40,{color:p.soft});let factY=valueTop+valueHeight+gap;
      factLines.forEach(line=>{text(g,line,M,factY+35,32,{color:p.soft});factY+=48;});y=Math.max(stackBottom,factLines.length?factY+gap:factY);
    }else{
      y=hasMap?y+12:Math.max(y+80,520);text(g,value,M,y+120,148);if(unit)text(g,unit,M,y+178,40,{color:p.soft});y+=235;
      for(const fact of facts)for(const line of lines(g,fact,936,32)){text(g,line,M,y+35,32,{color:p.soft});y+=48;}
    }
    const list=[...new Set(sources)],credit=list.length?'Includes data from '+list.slice(0,2).join(', ')+(list.length>2?` + ${list.length-2} other Garmin devices`:''):'';
    if(qrLink){
      await loadQrCode();if(readOwner()!==pictureOwner)throw Error('The account changed.');
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
