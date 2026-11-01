// Period pictures contain only deliberately selected aggregates. No map, intake, weight, real name or sharing analytics.
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

  async function simplePicture({kicker,title,date,value,unit,facts=[],sources=[],identity=false,qrLink=null}){
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
    y=Math.max(y+80,520);text(g,value,M,y+120,148);if(unit)text(g,unit,M,y+178,40,{color:p.soft});y+=235;
    for(const fact of facts)for(const line of lines(g,fact,936,32)){text(g,line,M,y+35,32,{color:p.soft});y+=48;}
    const list=[...new Set(sources)],credit=list.length?'Includes data from '+list.slice(0,2).join(', ')+(list.length>2?` + ${list.length-2} other Garmin devices`:''):'';
    if(qrLink){
      if(y+20>880)throw Error('The invitation picture needs more room. Try without photo and username.');
      const qr=qrcode(0,'M');qr.addData(qrLink);qr.make();const n=qr.getModuleCount(),quiet=4,cell=Math.floor(300/(n+quiet*2)),size=cell*(n+quiet*2),left=Math.floor((1080-size)/2),top=900;
      g.fillStyle='#fff';g.fillRect(left,top,size,size);g.fillStyle='#000';
      for(let row=0;row<n;row++)for(let x=0;x<n;x++)if(qr.isDark(row,x))g.fillRect(left+(x+quiet)*cell,top+(row+quiet)*cell,cell,cell);
      text(g,'Scan to join',540,1235,26,{align:'center',color:p.muted});
    }
    const creditLines=credit?lines(g,credit,936,22):[];const top=1260-creditLines.length*27;
    if(y+20>top)throw Error('The picture could not fit clearly. Try again without photo and username.');
    creditLines.forEach((line,n)=>text(g,line,M,top+n*27,22,{color:p.muted}));
    g.strokeStyle=p.line;g.lineWidth=2;g.beginPath();g.moveTo(M,1275);g.lineTo(1008,1275);g.stroke();drawMark(g,M+24,1311,48,p.blue);text(g,'Kinetta',M+62,1323,30);text(g,'kinetta.app',1008,1321,26,{align:'right',color:p.muted});
    return{blob:await blob(canvas),alt:[identity?'@'+App.me.login:'',kicker,title,date,value,unit,...facts,credit,qrLink?'Invitation: '+qrLink:''].filter(Boolean).join('. ')};
  }
  return{palette,family,text,lines,blob,deliver,photo,simplePicture};
})();
const Recaps=(()=>{
  const periods=[['this_week','Week'],['last_week','Last week'],['this_month','Month'],['last_month','Last month'],['this_year','Year']];
  const defaults={totals:true,calendar:true,highlights:true,streak:true,food:false,identity:false};
  const scope=()=>JSON.stringify([serverKey(),App.me?.id]);
  function today(zone=App.me?.tz){if(!zone)throw Error('Load your profile time zone before opening a recap.');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
  function startFor(period,day=today()){
    const d=new Date(day+'T12:00:00Z');
    if(period.includes('week'))d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7-(period==='last_week'?7:0));
    else if(period==='this_year'){d.setUTCMonth(0,1);}
    else{d.setUTCDate(1);if(period==='last_month')d.setUTCMonth(d.getUTCMonth()-1);}
    return d.toISOString().slice(0,10);
  }
  const label=d=>d.period.includes('week')?'Week of '+new Date(d.start+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}):new Date(d.start+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',...(d.period==='this_year'?{year:'numeric'}:{month:'long',year:'numeric'})});
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
    const alt=[title,hero&&hero.value+' '+hero.label,o.totals&&secondary,o.calendar&&d.activities>0&&'Activity calendar',...highlights,o.streak&&d.streak_weeks>=2&&`${d.streak_weeks} active weeks in a row`,...food,credits].filter(Boolean).join('. ');
    return {title,hero,secondary,highlights,food,credits,alt};
  }
  const recapKey=(period,start,zone)=>`/api/recaps?period=${period}&start=${start}&tz=${encodeURIComponent(zone)}`;
  const validFacts=(data,period,start,zone)=>data?.period===period&&data.start===start&&data.tz===zone;
  async function read(period){
    const owner=readOwner(),profileZone=App.me?.tz||null,metaKey=`/api/recaps?period=${period}&server_meta=1`;
    const changed=()=>owner!==readOwner()||(App.me?.tz||null)!==profileZone;
    try{
      const data=await api('/api/recaps?period='+period);
      if(changed())throw Object.assign(Error('Your account or time zone changed. Refresh and try again.'),{stale:true});
      if(data?.period!==period||!/^\d{4}-\d{2}-\d{2}$/.test(data.start)||typeof data.tz!=='string'||!data.tz)throw Error('The recap reply was incomplete. Try again.');
      if(profileZone&&data.tz!==profileZone)throw Object.assign(Error('Your time zone changed. Refresh and try again.'),{stale:true});
      // A request may cross midnight: the returned range, rather than its earlier request time, owns the cache key.
      keep(recapKey(data.period,data.start,data.tz),data);keep(metaKey,{period:data.period,start:data.start,tz:data.tz});return data;
    }catch(error){
      if(changed()||error.stale||[401,403,404].includes(error.status))throw error;
      const meta=kept(metaKey),zone=profileZone||(meta?.period===period?meta.tz:null);
      if(!zone)throw error;
      const start=startFor(period,today(zone));
      // Accept a compatible old cache only after checking its full range and timezone.
      const cached=kept(recapKey(period,start,zone))||kept(`/api/recaps?period=${period}&start=${start}`);
      if(validFacts(cached,period,start,zone))return {...cached,from_cache:true};
      throw error;
    }
  }

  // Export colours stay legible in either app theme, like the other ShareArt pictures.
  const ink=()=>({blue:col('--share-brand'),action:col('--share-action'),white:col('--share-on-action'),tint:col('--share-brand-soft')});
  function chartData(d){
    const distance=d.days.some(x=>x.distance_m>0),field=distance?'distance_m':'time_s',factor=distance?(d.units==='imperial'?1609.344:1000):60,by=new Map(d.days.map(x=>[x.day,x]));
    const year=d.period==='this_year',count=year?12:Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000),begin=new Date(d.start+'T12:00:00Z');
    return {unit:distance?unit(d):'min',year,bars:Array.from({length:count},(_,i)=>{
      const date=new Date(begin);year?date.setUTCMonth(i,1):date.setUTCDate(date.getUTCDate()+i);const day=date.toISOString().slice(0,10),rows=year?d.days.filter(x=>x.day.slice(0,7)===day.slice(0,7)):[by.get(day)].filter(Boolean);
      return{day,value:rows.reduce((n,x)=>n+(x[field]||0),0)/factor,active:rows.some(x=>x.activities>0),label:date.toLocaleDateString(undefined,{timeZone:'UTC',...(year?{month:'short'}:d.period.includes('week')?{weekday:'narrow'}:{day:'numeric'})})};
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
  function open(initial='this_month',onShared){
    const owner=readOwner(),prefKey='fit.recap.options:'+scope(),saved=store.get(prefKey);
    let options={...defaults,...Object.fromEntries(Object.entries(saved||{}).filter(([k,v])=>k in defaults&&typeof v==='boolean'))},period=initial,data=null,picture=null,url='',version=0,sending=false,defaultApplied=false,canShare=false;
    const names=[['totals','Totals'],['calendar','Chart'],['highlights','Highlights'],['streak','Streak'],['food','Food'],['identity','Photo & username']];
    sheet('Share progress',`<div class="recap-stage"><button type="button" class="recap-preview busy" aria-label="View full-size picture" disabled><img id="recap-preview" alt="Loading your picture"></button></div><div class="recap-period-wrap"><div class="seg recap-periods" role="group" aria-label="Recap period">${periods.map(([k,v])=>`<button type="button" data-recap-period="${k}" aria-pressed="${k===period}"><span>${v}</span></button>`).join('')}</div></div><fieldset class="recap-options"><legend>Include</legend><div>${names.map(([k,v])=>`<button type="button" data-recap-option="${k}" aria-pressed="${options[k]}"${k==='streak'?' aria-label="Activity streak (two or more active weeks in a row)"':''} disabled><span>${v}</span></button>`).join('')}</div></fieldset><p class="small muted" id="recap-streak-help" role="status" hidden></p><p class="small muted" id="recap-description"></p><p class="small muted" id="recap-status" role="status"></p><button type="button" class="ghost wide" id="recap-retry" hidden>Retry picture</button><div class="recap-actions"><button type="button" class="primary wide" id="recap-share" disabled>Share</button></div>`,(b,close)=>{
      b.closest('.sheet').classList.add('recap-sheet');
      const live=()=>owner===readOwner()&&b.isConnected,button=$('#recap-share',b),image=$('#recap-preview',b),preview=$('.recap-preview',b),status=$('#recap-status',b);
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;let stopPeriods=()=>{};
      viewResources.set(b,()=>{stopPeriods();version++;picture=null;if(url)URL.revokeObjectURL(url);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      function controls(){
        $$('[data-recap-option]',b).forEach(x=>{const k=x.dataset.recapOption,eligible=k!=='streak'||data?.streak_weeks>=2;x.disabled=sending||!data;if(eligible)x.removeAttribute('aria-disabled');else x.setAttribute('aria-disabled','true');x.setAttribute('aria-pressed',String(options[k]&&eligible));});
        $$('[data-recap-period]',b).forEach(x=>x.disabled=sending);preview.disabled=sending||!picture;button.disabled=sending||!canShare||!picture;
      }
      async function make(reload=false){
        $('#recap-streak-help',b).hidden=true;const run=++version;picture=null;canShare=false;controls();preview.classList.add('busy');status.textContent='';$('#recap-retry',b).hidden=true;
        try{
          const fresh=reload||!data?await read(period):data;if(!live()||run!==version)return;data={...fresh,units:App.me?.units||fresh.units};
          if(!saved&&!defaultApplied)options.streak=data.streak_weeks>=2;defaultApplied=true;
          $('#recap-description',b).textContent='Totals and chart include Only me workouts; highlights use shared activities. No maps, places or body details.'+(options.food?' Food: logged and protein-goal days only.':'')+(options.identity?' Includes your photo and username.':'');
          const result=await draw(data,options);if(!live()||run!==version)return;
          if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(result.blob);image.src=url;image.alt=result.alt;picture=result.blob;
          const hasData=data.activities>0||options.food&&data.food.logged_days>0,hasSections=options.totals||options.calendar||options.highlights&&data.highlights.length>0||options.streak&&data.streak_weeks>=2||options.food||options.identity;
          canShare=hasData&&hasSections;
          const messages=[];
          if(data.from_cache)messages.push('Using the last data loaded for this period.');
          if(!hasData)messages.push(data.food.logged_days?'No activities in this period. Turn on Food to include logged days, or choose another period.':'No activities in this period yet. Choose another period.');
          status.textContent=messages.join(' ');
        }catch(e){if(live()&&run===version){status.textContent=e.message;$('#recap-retry',b).hidden=false;}}
        finally{if(live()&&run===version){preview.classList.remove('busy');controls();}}
      }
      $$('[data-recap-period]',b).forEach(x=>x.onclick=()=>{if(sending||!live())return;period=x.dataset.recapPeriod;data=null;$$('[data-recap-period]',b).forEach(p=>p.setAttribute('aria-pressed',String(p===x)));make(true);});
      $$('[data-recap-option]',b).forEach(x=>x.onclick=()=>{if(sending||!live())return;const k=x.dataset.recapOption;if(k==='streak'&&data?.streak_weeks<2){const help=$('#recap-streak-help',b);help.textContent='Available after two active weeks in a row.';help.hidden=false;return;}options[k]=!options[k];store.set(prefKey,options);make();});
      preview.onclick=()=>{if(!picture||!live())return;sheet('Your progress picture',`<img class="recap-full" src="${esc(url)}" alt="${esc(image.alt)}">`);};
      $('#recap-retry',b).onclick=()=>make(true);
      button.onclick=async()=>{if(sending||!picture||!canShare||!live())return;const run=version,blob=picture;sending=true;controls();
        try{const handedOff=await ShareArt.deliver(blob,`kinetta-${data.start}.png`,()=>live()&&run===version);if(handedOff&&live()&&run===version)onShared?.(data);}
        catch(e){if(live()&&e.name!=='AbortError')status.textContent=e.message||'Couldn’t share this picture';}
        finally{sending=false;if(live())controls();}
      };
      // Snap whole groups of periods, so the resting edge never cuts through a word.
      const periodRow=$('.recap-periods',b),periodWrap=$('.recap-period-wrap',b),periodButtons=$$('[data-recap-period]',b);let periodWidth=0,periodFont='',periodFrame=0;
      const fades=()=>{periodWrap.classList.toggle('more-right',periodRow.scrollLeft<periodRow.scrollWidth-periodRow.clientWidth-1);periodWrap.classList.toggle('more-left',periodRow.scrollLeft>1);};
      const arrangePeriods=()=>{
        if(!live())return;const width=periodRow.clientWidth,font=getComputedStyle(periodButtons[0]).fontSize;
        if(!width||width===periodWidth&&font===periodFont)return;periodWidth=width;periodFont=font;
        const focused=document.activeElement,widths=periodButtons.map(x=>x.getBoundingClientRect().width),fragment=document.createDocumentFragment();let page=null,used=0;
        periodButtons.forEach((x,i)=>{const need=widths[i]+(used?8:0);if(!page||used+need>width-20){page=document.createElement('div');page.className='recap-period-page';fragment.append(page);used=0;}page.append(x);used+=widths[i]+(used?8:0);});
        periodRow.replaceChildren(fragment);const selected=$('[aria-pressed="true"]',periodRow);if(selected)periodRow.scrollLeft=selected.parentElement.offsetLeft;
        if(periodButtons.includes(focused))focused.focus({preventScroll:true});fades();
      };
      const schedulePeriods=()=>{cancelAnimationFrame(periodFrame);periodFrame=requestAnimationFrame(arrangePeriods);},periodResize=new ResizeObserver(schedulePeriods),periodFontChange=new MutationObserver(schedulePeriods);
      periodResize.observe(periodRow);periodFontChange.observe(document.documentElement,{attributes:true,attributeFilter:['style']});periodRow.addEventListener('scroll',fades,{passive:true});
      periodButtons.forEach(x=>x.addEventListener('focus',()=>{periodRow.scrollLeft=x.parentElement.offsetLeft;fades();}));
      stopPeriods=()=>{cancelAnimationFrame(periodFrame);periodResize.disconnect();periodFontChange.disconnect();};document.fonts?.ready.then(schedulePeriods);schedulePeriods();
      make(true);
    });
  }
  function entry(el){const acts=$('.progress-heading .acts',el);if(!acts||$('#recap-entry',el))return;const b=document.createElement('button');b.id='recap-entry';b.type='button';b.className='linkbtn';b.textContent='Share';b.setAttribute('aria-label','Share a progress picture');b.onclick=()=>{const p=$('#m-body',el)?new URLSearchParams(location.search).get('period')||'week':null;open(p==='week'?'this_week':p==='year'?'this_year':'this_month');};acts.prepend(b);}
  async function offer(box){
    if(!box||+today().slice(-2)>7)return;const owner=readOwner(),start=startFor('last_month'),key='fit.recap.offer:'+scope()+':'+start;
    if(store.get(key))return;
    try{const d=await read('last_month');if(owner!==readOwner()||!box.isConnected||!d.monthly_offer||store.get(key))return;
      box.innerHTML=`<section class="card recap-offer"><div><h2>Your ${esc(new Date(d.start+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'long'}))} is ready</h2><p class="small muted">Make a picture of your month.</p></div><div class="acts"><button type="button" class="ghost" data-recap-month>Share</button><button type="button" class="icon-btn" data-recap-dismiss aria-label="Dismiss monthly recap">${svg('close')}</button></div></section>`;
      const dismiss=reason=>{if(owner!==readOwner())return;store.set(key,reason);if(box.isConnected)box.innerHTML='';};$('[data-recap-dismiss]',box).onclick=()=>dismiss('dismissed');$('[data-recap-month]',box).onclick=()=>open('last_month',shared=>{if(shared.period==='last_month'&&shared.start===d.start)dismiss('shared');});
    }catch(_){/* A quiet optional offer must not replace the person's useful day. */}
  }
  return{open,entry,offer,draw,summary,startFor,today,label};
})();
