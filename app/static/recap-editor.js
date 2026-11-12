'use strict';
// Action-loaded Progress recap editor; the eager shell owns dates, summaries and the private read cache.
const RecapEditor=(()=>{
  function create({aliases,periodArgs,defaultOffset,today,startFor,label,summary,read,scope,distance,unit,time}){
  const periods=[['week','Week'],['month','Month'],['year','Year']];
  const defaults={totals:true,calendar:true,highlights:true,streak:true,food:false,identity:false};
  const navLabel=(period,offset,start,end)=>{if(!offset)return 'This '+period;const first=new Date(start+'T12:00:00Z');if(period==='year')return String(first.getUTCFullYear());if(period==='month')return first.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});const last=end?new Date(end+'T12:00:00Z'):new Date(first);if(!end)last.setUTCDate(last.getUTCDate()+7);last.setUTCDate(last.getUTCDate()-1);const a=first.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'}),b=last.toLocaleDateString(undefined,{timeZone:'UTC',...(first.getUTCMonth()===last.getUTCMonth()?{day:'numeric'}:{month:'short',day:'numeric'})});return a+'–'+b+', '+last.getUTCFullYear();};
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
    let data=null,version=0,sending=false,defaultApplied=false,canShare=false,openingShare=false;
    const names=[['totals','Totals'],['calendar','Chart'],['highlights','Highlights'],['streak','Streak'],['food','Food'],['identity','Photo & username']];
    sheet('Share progress',`<div class="seg vis3 recap-periods" role="group" aria-label="Recap period">${periods.map(([k,v])=>`<button type="button" data-recap-period="${k}" aria-pressed="${k===period}"><span>${v}</span></button>`).join('')}</div><div class="recap-period-nav"><button type="button" class="icon-btn" data-recap-prev aria-label="Previous period">‹</button><span id="recap-period-label" aria-live="polite"></span><button type="button" class="icon-btn" data-recap-next aria-label="Next period">›</button></div><fieldset class="recap-options"><legend>Include</legend><div>${names.map(([k,v])=>`<button type="button" data-recap-option="${k}" aria-pressed="${options[k]}"${k==='streak'?' aria-label="Activity streak (two or more active weeks in a row)"':''} disabled><span>${v}</span></button>`).join('')}</div></fieldset><p class="small muted" id="recap-streak-help" role="status" hidden></p><p class="small muted" id="recap-description"></p><p class="small muted" id="recap-status" role="status" data-ready="false"></p><button type="button" class="ghost wide" id="recap-retry" hidden>Retry data</button><div class="recap-actions"><button type="button" class="primary wide" id="recap-share" disabled>Preview and share</button></div>`,(b,close)=>{
      b.closest('.sheet').classList.add('recap-sheet');
      const path=location.pathname+location.search,current=()=>owner===readOwner()&&path===location.pathname+location.search,live=()=>current()&&b.isConnected,button=$('#recap-share',b),status=$('#recap-status',b);
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
      button.onclick=async()=>{if(sending||openingShare||!canShare||!live())return;openingShare=true;const recap={...data,period,offset},selected={...options},filename=`kinetta-${data.start}.png`;
        const item={label:'Progress recap',filename,note:$('#recap-description',b).textContent,valid:current,build:async()=>{const result=await draw(recap,selected);if(!current())throw Error('The account changed.');if(typeof FeatureUsage!=='undefined')void FeatureUsage.event('share_picture',owner);return{...result,filename};},afterShare:()=>onShared?.(recap),afterSave:()=>onShared?.(recap)};
        button.disabled=true;status.textContent='Preparing picture sharing…';
        try{await loadShareArt();if(!live())return;close();ShareSheet.open({items:[item],title:'Share progress'});}
        catch(error){if(live())status.textContent=(error.message||'Picture sharing could not load.')+' Tap Preview and share to try again.';}
        finally{openingShare=false;if(live())controls();}
      };
      updateNav();
      make(true);
    });
  }
    return{open,draw};
  }
  return{create};
})();
