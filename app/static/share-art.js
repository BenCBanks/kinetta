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

  async function achievementPicture({root,live=()=>true,outputHeight}={}){
    if(!root?.isConnected||!live())throw Error('The account changed.');
    const height=Math.max(400,Math.ceil(outputHeight||root.getBoundingClientRect().height+96));
    return domPicture(root,{live,outputHeight:height});
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
  const dataUrl=blob=>new Promise((yes,no)=>{const reader=new FileReader();reader.onload=()=>yes(reader.result);reader.onerror=()=>no(Error('Couldn’t read this picture'));reader.readAsDataURL(blob);});
  const imageFromBlob=(picture,timeout=4000)=>new Promise((yes,no)=>{const url=URL.createObjectURL(picture),image=new Image(),timer=setTimeout(()=>{URL.revokeObjectURL(url);no(Object.assign(Error('The card picture renderer timed out.'),{name:'TimeoutError'}));},timeout);image.onload=()=>{clearTimeout(timer);URL.revokeObjectURL(url);yes(image);};image.onerror=()=>{clearTimeout(timer);URL.revokeObjectURL(url);no(Object.assign(Error('The card picture SVG could not load.'),{name:'ImageError'}));};image.src=url;});
  const imageFromDataUrl=(source,timeout=4000)=>new Promise((yes,no)=>{const image=new Image();let settled=false;const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);image.onload=image.onerror=null;if(error)no(error);else yes(image);},timer=setTimeout(()=>{image.src='';finish(Object.assign(Error('The card picture renderer timed out.'),{name:'TimeoutError'}));},timeout);image.onload=()=>finish();image.onerror=()=>finish(Object.assign(Error('The card picture SVG could not load.'),{name:'ImageError'}));image.src=source;});
  const safeImage=(source,cache=new Map())=>{if(!source)return Promise.resolve(null);if(cache.has(source))return cache.get(source);const promise=(async()=>{let timer;const controller=new AbortController();try{const url=new URL(source,location.href);if(url.origin!==location.origin&&!source.startsWith('data:'))return null;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Profile image load timed out.'));},2500);});const response=await Promise.race([fetch(url,{credentials:url.origin===location.origin?'same-origin':'omit',cache:'force-cache',signal:controller.signal}),timeout]);if(!response.ok)return null;const picture=await response.blob(),image=await imageFromBlob(picture,1500);return image?{image,data:await dataUrl(picture)}:null;}catch(_){return null;}finally{clearTimeout(timer);}})();cache.set(source,promise);return promise;};
  const splitCssList=value=>{const parts=[];let start=0,depth=0;for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&!depth){parts.push(value.slice(start,i).trim());start=i+1;}}parts.push(value.slice(start).trim());return parts;};
  function shadowColor(value){
    let match=value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)/i);
    if(match)return{color:`rgb(${Math.round(Number(match[1])*255)} ${Math.round(Number(match[2])*255)} ${Math.round(Number(match[3])*255)})`,opacity:Number(match[4])};
    match=value.match(/rgba?\(([^)]*)\)/i);if(match){const parts=match[1].replace(/\//g,' ').split(/[\s,]+/).filter(Boolean);if(parts.length>=3){const channels=parts.slice(0,3).map(part=>part.endsWith('%')?Math.round(parseFloat(part)*2.55):Number(part));return{color:`rgb(${channels.join(' ')})`,opacity:parts[3]?(parts[3].endsWith('%')?parseFloat(parts[3])/100:Number(parts[3])):1};}}
    match=value.match(/#([\da-f]{3,8})\b/i);if(match){let hex=match[1];if(hex.length===3||hex.length===4)hex=[...hex].map(char=>char+char).join('');if(hex.length===6||hex.length===8)return{color:`rgb(${parseInt(hex.slice(0,2),16)} ${parseInt(hex.slice(2,4),16)} ${parseInt(hex.slice(4,6),16)})`,opacity:hex.length===8?parseInt(hex.slice(6,8),16)/255:1};}
    return null;
  }
  function medalShadowFilter(boxShadow,width,height,id){
    const layers=splitCssList(boxShadow).filter(layer=>layer!=='none'&&!layer.includes('inset'));
    const primitives=[];let number=0;
    for(const layer of layers){
      const lengths=[...layer.matchAll(/(-?(?:\d+\.?\d*|\.\d+))px/g)].map(match=>Number(match[1]));
      const colorText=layer.match(/color\(srgb[^)]*\)|rgba?\([^)]*\)|#[\da-f]{3,8}\b/i)?.[0],color=colorText&&shadowColor(colorText);
      if(lengths.length<2||!color)continue;
      const [dx,dy,blur=0,spread=0]=lengths,input=`shadowSource${number}`,blurred=`shadowBlur${number}`,flood=`shadowColor${number}`,shadow=`shadowLayer${number}`,offset=`shadowOffset${number}`;
      if(spread){const operator=spread>0?'dilate':'erode';primitives.push(`<feMorphology in="SourceAlpha" operator="${operator}" radius="${Math.abs(spread)/Math.max(1,Math.min(width,height))}" result="${input}"/>`);}else primitives.push(`<feComposite in="SourceAlpha" in2="SourceAlpha" operator="over" result="${input}"/>`);
      primitives.push(`<feGaussianBlur in="${input}" stdDeviation="${Math.max(0,blur/2/Math.max(1,width))} ${Math.max(0,blur/2/Math.max(1,height))}" result="${blurred}"/><feFlood flood-color="${color.color}" flood-opacity="${Math.max(0,Math.min(1,color.opacity))}" result="${flood}"/><feComposite in="${flood}" in2="${blurred}" operator="in" result="${shadow}"/><feOffset in="${shadow}" dx="${dx/Math.max(1,width)}" dy="${dy/Math.max(1,height)}" result="${offset}"/>`);
      number++;
    }
    if(!number)return null;
    const nodes=Array.from({length:number},(_,index)=>`<feMergeNode in="shadowOffset${index}"/>`).reverse().join('');
    return`<filter id="${id}" x="-0.35" y="-0.35" width="1.7" height="1.7" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${primitives.join('')}<feMerge>${nodes}<feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  }
  function paintBackground(context,value,box){
    const match=value.match(/^linear-gradient\((.*)\)$/);if(!match){context.fillStyle=value;context.fillRect(box.x,box.y,box.w,box.h);return;}
    const parts=splitCssList(match[1]);let angle=180,first=parts[0];if(/^(?:to\s|[-+\d.]+deg$)/i.test(first)){if(/deg$/i.test(first))angle=parseFloat(first);else angle=({right:90,left:270,bottom:180,top:0})[first.replace(/^to\s+/i,'')]||180;parts.shift();}
    const radians=(angle-90)*Math.PI/180,half=Math.abs(box.w*Math.cos(radians))/2+Math.abs(box.h*Math.sin(radians))/2,cx=box.x+box.w/2,cy=box.y+box.h/2,gradient=context.createLinearGradient(cx-Math.cos(radians)*half,cy-Math.sin(radians)*half,cx+Math.cos(radians)*half,cy+Math.sin(radians)*half);
    const stops=parts.map(part=>{const stop=part.match(/^(.*?)(?:\s+([\d.]+)%)?$/);return{color:stop[1].trim(),at:stop[2]===undefined?null:Number(stop[2])/100};});
    let previous=0;for(let i=0;i<stops.length;i++){const stop=stops[i];if(stop.at===null)stop.at=i===stops.length-1?1:i/(stops.length-1);stop.at=Math.max(previous,Math.min(1,stop.at));previous=stop.at;gradient.addColorStop(stop.at,stop.color);}context.fillStyle=gradient;context.fillRect(box.x,box.y,box.w,box.h);
  }
  async function canvasDomPicture(root,bounds,W,H,pad,scale,x,y,background,live,pictureOwner){
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const context=canvas.getContext('2d');context.fillStyle=background;context.fillRect(0,0,W,H);const rootStyle=getComputedStyle(root),rootRadiusValue=rootStyle.borderRadius||rootStyle.borderTopLeftRadius||'0',rootRadius=rootRadiusValue.endsWith('%')?Math.min(bounds.width,bounds.height)*parseFloat(rootRadiusValue)/100:Math.min(parseFloat(rootRadiusValue)||0,Math.min(bounds.width,bounds.height)/2);for(const layer of splitCssList(rootStyle.boxShadow||'none')){if(layer==='none'||layer.includes('inset'))continue;const lengths=[...layer.matchAll(/(-?[\d.]+)px/g)].map(match=>Number(match[1]));if(lengths.length<2)continue;const color=layer.match(/rgba?\([^)]*\)|#[\da-f]{3,8}/i)?.[0];if(!color)continue;context.save();context.translate(x,y);context.scale(scale,scale);context.shadowColor=color;context.shadowOffsetX=lengths[0];context.shadowOffsetY=lengths[1];context.shadowBlur=lengths[2]||0;context.fillStyle=rootStyle.backgroundColor||background;context.beginPath();context.roundRect(0,0,bounds.width,bounds.height,rootRadius);context.fill();context.restore();}context.save();context.translate(x,y);context.scale(scale,scale);context.beginPath();context.roundRect(0,0,bounds.width,bounds.height,rootRadius);context.clip();
    const nodes=[root,...root.querySelectorAll('*')],relative=node=>{const box=node.getBoundingClientRect();return{x:box.left-bounds.left,y:box.top-bounds.top,w:box.width,h:box.height};},radius=(style,box)=>{const value=style.borderRadius||style.borderTopLeftRadius||'0';if(value.endsWith('%'))return Math.min(box.w,box.h)*parseFloat(value)/100;const n=parseFloat(value);return Number.isFinite(n)?Math.min(n,Math.min(box.w,box.h)/2):0;},clip=(box,r)=>{if(!r)return;context.beginPath();context.roundRect(box.x,box.y,box.w,box.h,r);context.clip();};
    const images=new Map();await Promise.all(nodes.filter(node=>node.tagName==='IMG').map(node=>{const source=node.currentSrc||node.getAttribute('src');if(source&&!images.has(source))images.set(source,safeImage(source,images));return source?images.get(source):null;}));for(const node of nodes){const box=relative(node),style=getComputedStyle(node);if(!box.w||!box.h||node.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;context.save();context.globalAlpha=Number(style.opacity)||1;clip(box,radius(style,box));const imageSource=style.getPropertyValue('background-image'),bg=style.backgroundColor;if(imageSource&&imageSource!=='none'&&!imageSource.includes('url('))paintBackground(context,imageSource,box);else if(bg&&bg!=='transparent'&&!bg.endsWith(', 0)')){context.fillStyle=bg;context.fillRect(box.x,box.y,box.w,box.h);}if(node.tagName==='IMG'){const source=node.currentSrc||node.getAttribute('src'),loaded=source?await images.get(source):null;if(loaded){const image=loaded.image,fit=style.objectFit||'fill',natural=image.naturalWidth&&image.naturalHeight?{w:image.naturalWidth,h:image.naturalHeight}:box,ratio=fit==='cover'?Math.max(box.w/natural.w,box.h/natural.h):fit==='contain'?Math.min(box.w/natural.w,box.h/natural.h):1,w=fit==='fill'?box.w:natural.w*ratio,h=fit==='fill'?box.h:natural.h*ratio,cx=style.objectPosition.includes('right')?1:style.objectPosition.includes('center')?.5:0,cy=style.objectPosition.includes('bottom')?1:style.objectPosition.includes('center')?.5:0;context.drawImage(image,box.x+(box.w-w)*cx,box.y+(box.h-h)*cy,w,h);}}const widths=['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map(key=>parseFloat(style[key])||0),colors=['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor'].map(key=>style[key]);if(widths.every(width=>width>0&&width===widths[0])){context.strokeStyle=colors[0]||style.borderColor;context.lineWidth=widths[0];context.beginPath();context.roundRect(box.x+context.lineWidth/2,box.y+context.lineWidth/2,Math.max(0,box.w-context.lineWidth),Math.max(0,box.h-context.lineWidth),Math.max(0,radius(style,box)-context.lineWidth/2));context.stroke();}else{const paths=[[box.x,box.y,box.x+box.w,box.y],[box.x+box.w,box.y,box.x+box.w,box.y+box.h],[box.x+box.w,box.y+box.h,box.x,box.y+box.h],[box.x,box.y+box.h,box.x,box.y]];for(let side=0;side<4;side++){if(!widths[side])continue;context.strokeStyle=colors[side]||style.borderColor;context.lineWidth=widths[side];context.beginPath();context.moveTo(paths[side][0],paths[side][1]);context.lineTo(paths[side][2],paths[side][3]);context.stroke();}}context.restore();}
    for(const node of nodes){if(node.tagName!=='svg')continue;const box=relative(node);if(!box.w||!box.h)continue;try{const copy=node.cloneNode(true);copy.setAttribute('color',getComputedStyle(node).color);const image=await imageFromBlob(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}),1500);context.drawImage(image,box.x,box.y,box.w,box.h);}catch(_){}}
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let textNode;while((textNode=walker.nextNode())){const source=textNode.textContent;if(!source.trim())continue;const parent=textNode.parentElement,style=getComputedStyle(parent),box=parent.getBoundingClientRect();if(parent.closest('.vh,[hidden]')||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0||!box.width||!box.height)continue;context.save();context.globalAlpha=Number(style.opacity)||1;context.font=style.font||`${style.fontWeight||'400'} ${style.fontSize||'16px'} ${style.fontFamily||'system-ui'}`;if('letterSpacing'in context)context.letterSpacing=style.letterSpacing;context.fillStyle=style.color||'#15191d';context.textBaseline='top';const shadow=style.textShadow;if(shadow&&shadow!=='none'){const color=shadow.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)?.[0];if(color){context.shadowColor=color;context.shadowBlur=parseFloat(shadow.match(/([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px/)?.[3])||0;context.shadowOffsetX=parseFloat(shadow.match(/([\d.]+)px/)?.[1])||0;context.shadowOffsetY=parseFloat(shadow.match(/px\s+([\d.]+)px/)?.[1])||0;}}
      const value=style.textTransform==='uppercase'?source.toLocaleUpperCase():style.textTransform==='lowercase'?source.toLocaleLowerCase():source,range=document.createRange(),words=/\S+/g;let word;while((word=words.exec(value))){range.setStart(textNode,word.index);range.setEnd(textNode,word.index+word[0].length);const rect=range.getBoundingClientRect();if(rect.width&&rect.height)context.fillText(word[0],rect.left-bounds.left,rect.top-bounds.top);}context.restore();}
    context.restore();if(rootStyle.outlineStyle!=='none'&&parseFloat(rootStyle.outlineWidth)>0){context.save();context.translate(x,y);context.scale(scale,scale);context.strokeStyle=rootStyle.outlineColor;context.lineWidth=parseFloat(rootStyle.outlineWidth);context.beginPath();context.roundRect(-parseFloat(rootStyle.outlineOffset||0)-context.lineWidth/2,-parseFloat(rootStyle.outlineOffset||0)-context.lineWidth/2,bounds.width+2*(parseFloat(rootStyle.outlineOffset||0)+context.lineWidth/2),bounds.height+2*(parseFloat(rootStyle.outlineOffset||0)+context.lineWidth/2),rootRadius+parseFloat(rootStyle.outlineOffset||0));context.stroke();context.restore();}if(pictureOwner!==readOwner()||!live())throw Error('The account changed.');const pictureBlob=await blob(canvas),prior=window.__sharePictureDiagnostic||{};window.__sharePictureDiagnostic={...prior,mode:'canvasFallback',handledErrorName:prior.errorName||null,handledErrorMessage:prior.errorMessage||null,errorName:null,errorMessage:null,outputBytes:pictureBlob.size,exportedBlob:true};if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',pictureOwner);return{blob:pictureBlob,alt:root.getAttribute('aria-label')||'Your Kinetta profile card.'};
  }
  const structureSignature=nodes=>nodes.map(node=>`${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`).join('|');
  async function domPicture(root,{live=()=>true,prepareClone=()=>{},outputWidth=1080,outputHeight=1350}={}){
    const pictureOwner=readOwner();if(!root?.isConnected||!live())throw Error('The account changed.');
    let fontTimer;await Promise.race([Promise.resolve(document.fonts?.ready).catch(()=>undefined),new Promise(resolve=>{fontTimer=setTimeout(resolve,1000);})]);clearTimeout(fontTimer);if(!root.isConnected||pictureOwner!==readOwner()||!live())throw Error('The account changed.');
    const bounds=root.getBoundingClientRect(),sourceNodes=[root,...root.querySelectorAll('*')],clone=root.cloneNode(true);prepareClone(clone);const cloneNodes=[clone,...clone.querySelectorAll('*')];
    if(!bounds.width||!bounds.height)throw Error('The card picture could not fit clearly.');
    const W=Math.max(1,Math.floor(outputWidth)),H=Math.max(1,Math.floor(outputHeight)),pad=48,scale=Math.min((W-pad*2)/bounds.width,(H-pad*2)/bounds.height),x=(W-bounds.width*scale)/2,y=(H-bounds.height*scale)/2;
    const styleNames=['display','position','top','right','bottom','left','inset','z-index','box-sizing','width','height','min-width','min-height','max-width','max-height','margin','margin-top','margin-right','margin-bottom','margin-left','margin-inline','margin-inline-start','margin-inline-end','padding','padding-top','padding-right','padding-bottom','padding-left','color','background','background-color','background-image','background-position','background-size','background-repeat','background-origin','background-clip','border','border-top','border-right','border-bottom','border-left','border-radius','outline','outline-color','outline-style','outline-width','outline-offset','font','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','text-decoration','text-decoration-color','text-decoration-style','text-decoration-thickness','text-shadow','white-space','word-break','overflow-wrap','text-overflow','text-indent','opacity','visibility','align-items','align-content','align-self','justify-content','justify-items','flex','flex-basis','flex-direction','flex-wrap','order','gap','column-gap','row-gap','grid-template-columns','grid-template-rows','grid-column','grid-row','overflow','overflow-x','overflow-y','object-fit','object-position','clip','clip-path','vertical-align','transform','transform-origin','filter','box-shadow'];
    const rules=[],shadowFilters=[],pillShadowFilters=[];for(let i=0;i<sourceNodes.length;i++){
      const source=sourceNodes[i],target=cloneNodes[i],style=getComputedStyle(source);if(!target)continue;const id=String(i),nodeBounds=source.getBoundingClientRect(),medalFilter=source.classList?.contains('profile-achievement-medallion')?medalShadowFilter(style.boxShadow,nodeBounds.width,nodeBounds.height,`share-medal-shadow-${i}`):null,pillFilter=source.matches?.('.profile-achievement-level,.profile-achievement-multiple')?medalShadowFilter(style.boxShadow,nodeBounds.width,nodeBounds.height,`share-pill-shadow-${i}`):null,css=styleNames.map(name=>{let value=i===0&&name.startsWith('margin')?'0px':style.getPropertyValue(name);if(value.includes('url('))value='none';if((medalFilter||pillFilter)&&name==='box-shadow')value='none';return `${name}:${value};`;}).join('');
      if(medalFilter){
        shadowFilters.push(medalFilter);
        // Keep the shadow geometry inside this medal's paint layer, above card backgrounds
        // and behind its own glyph and Lv pill. The filter sees only the local circle alpha.
        const shadowSvg=target.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');
        shadowSvg.setAttribute('data-share-medal-shadow',id);shadowSvg.setAttribute('viewBox','0 0 100 100');shadowSvg.setAttribute('preserveAspectRatio','none');shadowSvg.setAttribute('aria-hidden','true');
        const circle=target.ownerDocument.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','50');circle.setAttribute('cy','50');circle.setAttribute('r','50');circle.setAttribute('fill',style.backgroundColor);circle.setAttribute('filter',`url(#share-medal-shadow-${i})`);shadowSvg.append(circle);target.insertBefore(shadowSvg,target.firstChild);
        rules.push(`[data-share-medal-shadow="${id}"]{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:-1;}[data-share-dom-id="${id}"]{isolation:isolate;}`);
      }
      if(pillFilter){
        pillShadowFilters.push(pillFilter);
        const radiusPx=Math.min(parseFloat(style.borderTopLeftRadius)||Math.min(nodeBounds.width,nodeBounds.height)/2,nodeBounds.width/2,nodeBounds.height/2),rx=Math.max(0,Math.min(50,radiusPx/Math.max(1,nodeBounds.width)*100)),ry=Math.max(0,Math.min(50,radiusPx/Math.max(1,nodeBounds.height)*100)),shadowSvg=target.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');
        shadowSvg.setAttribute('data-share-pill-shadow',id);shadowSvg.setAttribute('viewBox','0 0 100 100');shadowSvg.setAttribute('preserveAspectRatio','none');shadowSvg.setAttribute('aria-hidden','true');
        const pill=target.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');pill.setAttribute('x','0');pill.setAttribute('y','0');pill.setAttribute('width','100');pill.setAttribute('height','100');pill.setAttribute('rx',String(rx));pill.setAttribute('ry',String(ry));pill.setAttribute('fill',style.backgroundColor);pill.setAttribute('filter',`url(#share-pill-shadow-${i})`);shadowSvg.append(pill);target.insertBefore(shadowSvg,target.firstChild);
        rules.push(`[data-share-pill-shadow="${id}"]{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:-1;}[data-share-dom-id="${id}"]{isolation:isolate;}`);
      }
      target.removeAttribute('style');target.setAttribute('data-share-dom-id',id);rules.push(`[data-share-dom-id="${id}"]{${css}}`);
      if(source instanceof HTMLInputElement||source instanceof HTMLTextAreaElement)target.value=source.value;
    }
    const baselineSource=root.querySelector('.me-card-bars'),baselineClone=clone.querySelector('.me-card-bars');
    if(baselineSource&&baselineClone){const style=getComputedStyle(baselineSource,'::after');if(style.content!=='none'&&style.display!=='none'&&style.visibility!=='hidden'){const line=clone.ownerDocument.createElement('span');line.setAttribute('data-share-pseudo','chart-baseline');line.setAttribute('aria-hidden','true');baselineClone.append(line);const css=styleNames.map(name=>{let value=style.getPropertyValue(name);if(value.includes('url('))value='none';return`${name}:${value};`;}).join('');rules.push('[data-share-pseudo="chart-baseline"]{'+css+'}');}}
    const imageDependencies=new Map();await Promise.all([...clone.querySelectorAll('img')].map(async image=>{const source=image.currentSrc||image.getAttribute('src');image.setAttribute('crossorigin','anonymous');if(!source||source.startsWith('data:'))return;const dependency=await safeImage(source,imageDependencies);if(dependency)image.setAttribute('src',dependency.data);else image.removeAttribute('src');}));
    if(pictureOwner!==readOwner()||!live())throw Error('The account changed.');
    const markup=new XMLSerializer().serializeToString(clone),background=getComputedStyle(root).backgroundColor||'#fff',wrapper=`.share-dom-picture-root{width:${bounds.width}px;height:${bounds.height}px;transform:scale(${scale});transform-origin:top left;overflow:hidden;}`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${shadowFilters.join('')}${pillShadowFilters.join('')}</defs><style>${wrapper}${rules.join('')}</style><rect width="${W}" height="${H}" fill="${background}"/><foreignObject x="${x}" y="${y}" width="${bounds.width*scale}" height="${bounds.height*scale}"><div xmlns="http://www.w3.org/1999/xhtml" class="share-dom-picture-root">${markup}</div></foreignObject></svg>`;
    const blobBytes=new Blob([svg],{type:'image/svg+xml'}).size;window.__sharePictureDiagnostic={mode:'foreignObjectDataUrl',svgBytes:svg.length,blobBytes,sourceNodeCount:sourceNodes.length,cloneNodeCount:cloneNodes.length,sourceStructure:structureSignature(sourceNodes),cloneStructure:structureSignature(cloneNodes),sourceWidth:bounds.width,sourceHeight:bounds.height,outputWidth:W,outputHeight:H,scale,x,y,medalShadowFilterCount:shadowFilters.length,medalShadowLayerCount:clone.querySelectorAll('[data-share-medal-shadow]').length,pillShadowLayerCount:clone.querySelectorAll('[data-share-pill-shadow]').length,chartBaselineSerialized:!!clone.querySelector('[data-share-pseudo="chart-baseline"]')};
    // Data SVGs remain origin-clean in Chromium; Blob SVG foreignObjects taint canvas exports.
    try{const source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);if(source.length>2_000_000)throw new Error('The card picture is too large to render safely.');window.__sharePictureDiagnostic.dataUrlBytes=source.length;const image=await imageFromDataUrl(source);if(pictureOwner!==readOwner()||!live())throw Error('The account changed.');const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const context=canvas.getContext('2d');context.fillStyle=background;context.fillRect(0,0,W,H);context.drawImage(image,0,0,W,H);const pictureBlob=await blob(canvas);window.__sharePictureDiagnostic={...window.__sharePictureDiagnostic,mode:'foreignObjectDataUrl',outputBytes:pictureBlob.size,exportedBlob:true};if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',pictureOwner);return{blob:pictureBlob,alt:root.getAttribute('aria-label')||'Your Kinetta profile card.'};}
    catch(error){window.__sharePictureDiagnostic={...window.__sharePictureDiagnostic,mode:'canvasFallback',errorName:error.name,errorMessage:error.message};return canvasDomPicture(root,bounds,W,H,pad,scale,x,y,background,live,pictureOwner);}
  }
  return{palette,family,text,lines,blob,deliver,photo,simplePicture,achievementPicture,domPicture};
})();
const ShareSheet=(()=>{
  const save=(blob,name)=>{if(Native.on)return false;let url;try{url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;}catch(_){if(url)URL.revokeObjectURL(url);return false;}};
  function open({items,title='Share',actions=[]}){
    if(!items?.length)return;
    const owner=readOwner(),values=items.map(item=>Object.fromEntries((item.controls||[]).map(control=>[control.key,!!control.checked])));
    sheet(title,`<div class="share-sheet" data-unified-share>
      <div class="share-picture-row" role="radiogroup" aria-label="Pictures to share">${items.map((item,index)=>`<button type="button" role="radio" class="share-picture-choice" data-share-choice="${index}" data-busy="true" aria-checked="false" tabindex="-1"><span class="share-picture-frame" data-share-frame="${index}"><img data-share-image="${index}" alt="" hidden><span class="share-picture-loading" aria-hidden="true"></span></span><span class="share-picture-label">${esc(item.label)}</span></button>`).join('')}</div>
      <div class="share-picture-controls" data-share-controls></div><p class="share-picture-note small muted" data-share-note></p><p class="vh" data-share-description></p><p class="share-picture-status small muted" role="status" aria-live="polite"></p>
      <div class="share-picture-actions"><button type="button" class="primary wide" data-share-send disabled>${svg('share')}Share</button><button type="button" class="linkbtn wide" data-share-save disabled${Native.on?' hidden':''}>Save image</button>${actions.map((action,index)=>`<button type="button" class="linkbtn wide" data-share-action="${index}">${esc(action.label)}</button>`).join('')}</div>
    </div>`,(body,close)=>{
      const live=()=>body.isConnected&&owner===readOwner()&&items[selected]?.valid?.()!==false,row=$('.share-picture-row',body),controls=$('[data-share-controls]',body),note=$('[data-share-note]',body),status=$('.share-picture-status',body),send=$('[data-share-send]',body),saveButton=$('[data-share-save]',body);
      const cache=new Map(),versions=items.map(()=>0);let selected=-1,busy=false,scrollTimer=0,peekFrame=0;
      const updatePeekLabels=()=>{peekFrame=0;const bounds=row.getBoundingClientRect(),left=bounds.left,right=bounds.right;$$('[data-share-choice]',body).forEach(choice=>{const rect=choice.getBoundingClientRect(),visible=rect.left>=left-.5&&rect.right<=right+.5;choice.dataset.peeking=String(!visible);});};
      const schedulePeekLabels=()=>{if(peekFrame)return;peekFrame=requestAnimationFrame(updatePeekLabels);};
      const centeredChoice=()=>{const center=row.getBoundingClientRect().left+row.clientWidth/2;let best=-1,distance=Infinity;[...row.children].forEach((choice,index)=>{const rect=choice.getBoundingClientRect(),d=Math.abs(rect.left+rect.width/2-center);if(d<distance){best=index;distance=d;}});return best;};
      const syncCenteredChoice=()=>{const best=centeredChoice();if(best>=0&&best!==selected)select(best);schedulePeekLabels();};
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      const buttons=()=>{const current=cache.get(selected),disabled=busy||!current?.blob;send.disabled=disabled;saveButton.disabled=disabled;$$('[data-share-action]',body).forEach(button=>button.disabled=busy);};
      const renderControls=index=>{
        const item=items[index];controls.innerHTML=(item.controls||[]).map(control=>`<label class="check"><input type="checkbox" data-share-control="${esc(control.key)}"${values[index][control.key]?' checked':''}>${esc(control.label)}</label>`).join('');
        $$('[data-share-control]',controls).forEach(input=>input.onchange=()=>{values[index][input.dataset.shareControl]=input.checked;load(index,true);});
      };
      async function load(index,redraw=false){
        const old=cache.get(index);if(old&&!redraw)return old;
        if(old?.url)URL.revokeObjectURL(old.url);cache.delete(index);const stamp=++versions[index],item=items[index],image=$(`[data-share-image="${index}"]`,body),frame=$(`[data-share-frame="${index}"]`,body),choice=$(`[data-share-choice="${index}"]`,body);image.hidden=true;image.removeAttribute('src');image.alt='';if(frame)frame.style.removeProperty('--share-picture-ratio');
        choice.dataset.busy='true';const fitFrame=()=>{if(frame&&image.naturalWidth>0&&image.naturalHeight>0&&live()&&stamp===versions[index])frame.style.setProperty('--share-picture-ratio',String(image.naturalWidth/image.naturalHeight));};image.onload=fitFrame;if(index===selected){status.textContent='Preparing picture…';buttons();}
        try{
          const result=await item.build({...values[index]});const blob=result instanceof Blob?result:result?.blob;
          if(!blob)throw Error('Couldn’t prepare this picture. Try again.');if(!live()||stamp!==versions[index])return null;
          const record={blob,url:URL.createObjectURL(blob),filename:result.filename||item.filename||'kinetta.png',alt:result.alt||item.alt||item.label,link:result.link||item.link||null};cache.set(index,record);
          image.src=record.url;image.alt=record.alt;image.hidden=false;fitFrame();choice.dataset.busy='false';
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
      $$('[data-share-choice]',body).forEach(choice=>{choice.onclick=()=>select(Number(choice.dataset.shareChoice),true);choice.onkeydown=event=>{const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:['ArrowLeft','ArrowUp'].includes(event.key)?-1:0;if(!direction)return;event.preventDefault();select((Number(choice.dataset.shareChoice)+direction+items.length)%items.length,true,true);};});
      row.addEventListener('scroll',()=>{schedulePeekLabels();clearTimeout(scrollTimer);scrollTimer=setTimeout(syncCenteredChoice,120);},{passive:true});
      row.addEventListener('scrollend',syncCenteredChoice,{passive:true});
      if(typeof ResizeObserver==='function')new ResizeObserver(schedulePeekLabels).observe(row);
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
        try{if(item.beforeSave&&await item.beforeSave({blob:current.blob,filename:current.filename,link:current.link,values:{...values[selected]},live,close,refresh:()=>load(selected,true),setStatus:value=>{if(live())status.textContent=value;}})===false)return;if(!live())return;if(!save(current.blob,current.filename)){status.textContent='This device cannot save the picture here. Use Share instead.';return;}status.textContent='Picture saved.';await item.afterSave?.({blob:current.blob,values:{...values[selected]},close,live});}
        catch(error){if(live())status.textContent=error.message||'Couldn’t save this picture.';}
        finally{busy=false;if(live())buttons();}
      };
      $$('[data-share-action]',body).forEach(button=>button.onclick=async()=>{if(busy||!live())return;busy=true;buttons();try{await actions[Number(button.dataset.shareAction)].run({close,live});}catch(error){if(live())status.textContent=error.message||'Couldn’t update this milestone.';}finally{busy=false;if(live())buttons();}});
      viewResources.set(body,()=>{clearTimeout(scrollTimer);for(const record of cache.values())URL.revokeObjectURL(record.url);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      select(0);schedulePeekLabels();
    });
  }
  return{open};
})();
