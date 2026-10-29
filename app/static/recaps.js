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
  return{palette,text,lines,blob,deliver,photo,simplePicture};
})();
const Recaps=(()=>{
  const periods=[['this_week','This week'],['last_week','Last week'],['this_month','This month'],['last_month','Last month'],['this_year','This year']];
  const defaults={totals:true,calendar:true,highlights:true,streak:true,food:false,identity:false};
  const scope=()=>JSON.stringify([serverKey(),App.me?.id]);
  function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:App.me?.tz||'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
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
  async function read(period){
    const owner=readOwner(),start=startFor(period),key=`/api/recaps?period=${period}&start=${start}`;
    try{const d=await api('/api/recaps?period='+period);if(owner!==readOwner())throw Error('The account changed.');keep(key,d);return d;}
    catch(e){if(owner!==readOwner()||e.stale||[401,403,404].includes(e.status))throw e;const cached=kept(key);if(cached&&cached.tz===(App.me?.tz||'America/New_York'))return {...cached,from_cache:true};throw e;}
  }
  function calendar(g,d,y,height){
    const p=ShareArt.palette(),W=1080,M=72,by=new Map(d.days.map(x=>[x.day,x.activities]));
    ShareArt.text(g,'Activity calendar',M,y,28,{color:p.soft});y+=36;
    const begin=new Date(d.start+'T12:00:00Z');
    if(d.period==='this_year'){
      const counts=Array.from({length:12},(_,m)=>d.days.filter(x=>+x.day.slice(5,7)===m+1).length),top=Math.max(1,...counts),base=y+height-70;
      counts.forEach((n,i)=>{const x=M+i*78+8,h=n/top*(height-105);g.fillStyle=p.blue;if(n){g.beginPath();g.roundRect(x,base-h,48,h,8);g.fill();}ShareArt.text(g,new Date(Date.UTC(begin.getUTCFullYear(),i,1,12)).toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}),x+24,base+32,22,{align:'center',max:70,color:p.soft});});
      return;
    }
    const week=d.period.includes('week'),offset=week?0:(begin.getUTCDay()+6)%7,days=Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000),rows=week?1:Math.ceil((offset+days)/7),step=Math.min(60,(height-65)/rows),dx=(W-2*M)/7;
    for(let i=0;i<7;i++)ShareArt.text(g,new Date(Date.UTC(2026,0,5+i,12)).toLocaleDateString(undefined,{timeZone:'UTC',weekday:'narrow'}),M+dx*(i+.5),y+15,22,{align:'center',color:p.muted});
    for(let i=0;i<days;i++){
      const date=new Date(begin);date.setUTCDate(date.getUTCDate()+i);const day=date.toISOString().slice(0,10),column=(offset+i)%7,row=Math.floor((offset+i)/7),x=M+dx*(column+.5),cy=y+48+row*step,active=by.has(day);
      g.beginPath();g.arc(x,cy,Math.min(24,step/2-3),0,Math.PI*2);g.fillStyle=active?p.blue:p.tint;g.fill();ShareArt.text(g,date.getUTCDate(),x,cy+8,24,{align:'center',color:active?col('--color-on-action'):p.soft,max:dx-10});
    }
  }
  async function draw(d,o){
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const g=canvas.getContext('2d'),p=ShareArt.palette(),s=summary(d,o),M=72;
    g.fillStyle=p.bg;g.fillRect(0,0,1080,1350);let y=72;
    if(o.identity){
      const image=App.me.photo?await ShareArt.photo(`/api/people/${encodeURIComponent(App.me.login)}/photo?v=${App.me.photo}`):null;
      if(image){g.save();g.beginPath();g.arc(M+34,y+28,34,0,2*Math.PI);g.clip();g.drawImage(image,M,y-6,68,68);g.restore();}
      ShareArt.text(g,'@'+App.me.login,M+(image?94:0),y+40,32,{max:image?830:936,color:p.soft});y+=84;
    }
    ShareArt.text(g,s.title,M,y+48,54,{max:936});y+=86;
    if(s.hero){ShareArt.text(g,s.hero.value,M,y+116,132,{max:936});ShareArt.text(g,s.hero.label,M,y+170,44,{color:p.soft});if(s.secondary)ShareArt.text(g,s.secondary,M,y+222,31,{color:p.soft});y+=252;}
    if(o.calendar&&d.activities>0){const h=d.period==='this_year'?270:d.period.includes('week')?150:330;calendar(g,d,y+20,h);y+=h+36;}
    for(const line of s.highlights){ShareArt.text(g,line,M,y+38,32,{max:936});y+=48;}
    if(o.streak&&d.streak_weeks>=2){ShareArt.text(g,`${d.streak_weeks} active weeks in a row`,M,y+38,30,{color:p.soft});y+=48;}
    for(const line of s.food){ShareArt.text(g,line,M,y+38,30,{color:p.soft});y+=44;}
    if(!d.activities&&!(o.food&&d.food.logged_days)){ShareArt.text(g,'No activities in this period yet',M,470,44,{color:p.soft});}
    const credits=ShareArt.lines(g,s.credits,936,20),creditTop=1260-credits.length*25;
    if(credits.length&&y+20>creditTop)throw Error('Choose fewer sections so the source credit fits clearly.');
    credits.forEach((line,i)=>ShareArt.text(g,line,M,creditTop+i*25,20,{color:p.muted}));
    g.strokeStyle=p.line;g.lineWidth=2;g.beginPath();g.moveTo(M,1275);g.lineTo(1008,1275);g.stroke();drawMark(g,M+24,1311,48,p.blue);ShareArt.text(g,'Kinetta',M+62,1323,30);ShareArt.text(g,'kinetta.app',1008,1321,26,{align:'right',color:p.muted});
    return {blob:await ShareArt.blob(canvas),alt:s.alt};
  }
  function open(initial='this_month',onShared){
    const owner=readOwner(),prefKey='fit.recap.options:'+scope(),saved=store.get(prefKey);let options={...defaults,...Object.fromEntries(Object.entries(saved||{}).filter(([k,v])=>k in defaults&&typeof v==='boolean'))},period=initial,data=null,picture=null,url='',version=0,sending=false,defaultApplied=false;
    sheet('Share progress',`<div class="recap-preview busy"><img id="recap-preview" alt="Loading your picture"></div><div class="seg recap-periods" role="group" aria-label="Recap period">${periods.map(([k,v])=>`<button type="button" data-recap-period="${k}" aria-pressed="${k===period}">${v}</button>`).join('')}</div><fieldset class="recap-options"><legend>What’s included</legend>${[['totals','Totals'],['calendar','Calendar'],['highlights','Highlights'],['streak','Activity streak (2+ weeks)'],['food','Food'],['identity','Photo and username']].map(([k,v])=>`<label class="check"><input type="checkbox" data-recap-option="${k}" disabled${options[k]?' checked':''}>${v}</label>`).join('')}</fieldset><p class="small muted" id="recap-description"></p><p class="small muted" id="recap-status" role="status"></p><button type="button" class="ghost wide" id="recap-retry" hidden>Retry picture</button><div class="recap-actions"><button type="button" class="primary wide" id="recap-share" disabled>Share</button></div>`,(b,close)=>{
      const live=()=>owner===readOwner()&&b.isConnected,button=$('#recap-share',b),image=$('#recap-preview',b),status=$('#recap-status',b);
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      viewResources.set(b,()=>{version++;picture=null;if(url)URL.revokeObjectURL(url);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      async function make(reload=false){
        const run=++version;picture=null;button.disabled=true;$('.recap-preview',b).classList.add('busy');status.textContent='';$('#recap-retry',b).hidden=true;
        try{
          const fresh=reload||!data?await read(period):data;if(!live()||run!==version)return;data={...fresh,units:App.me?.units||fresh.units};
          if(!saved&&!defaultApplied){options.streak=data.streak_weeks>=2;const field=$('[data-recap-option="streak"]',b);field.checked=options.streak;}defaultApplied=true;
          const streakField=$('[data-recap-option="streak"]',b);streakField.checked=options.streak&&data.streak_weeks>=2;
          const description=['Totals and calendar include Only me workouts. Highlights use shared activities.',options.food?'Food shows only logged days and protein-goal days.':'No food details.',options.identity?'Includes your username and photo if available.':'No photo or username.','No maps, places or body details.'];$('#recap-description',b).textContent=description.join(' ');
          const result=await draw(data,options);if(!live()||run!==version)return;
          if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(result.blob);image.src=url;image.alt=result.alt;picture=result.blob;
          const hasData=data.activities>0||options.food&&data.food.logged_days>0,hasSections=options.totals||options.calendar&&data.activities>0||options.highlights&&data.highlights.length>0||options.streak&&data.streak_weeks>=2||options.food||options.identity;
          button.disabled=!hasData||!hasSections;if(data.from_cache)status.textContent='Using the last data loaded for this period.';if(!hasData)status.textContent=data.food.logged_days?'No activities in this period. Turn on Food to include your logged days, or choose another period.':'No activities in this period yet. Choose another period.';
        }catch(e){if(live()&&run===version){status.textContent=e.message;$('#recap-retry',b).hidden=false;}}
        finally{if(live()&&run===version){$('.recap-preview',b).classList.remove('busy');$$('[data-recap-option]',b).forEach(x=>x.disabled=!data||x.dataset.recapOption==='streak'&&data.streak_weeks<2);}}
      }
      $$('[data-recap-period]',b).forEach(x=>x.onclick=()=>{if(sending||!live())return;period=x.dataset.recapPeriod;data=null;$$('[data-recap-period]',b).forEach(p=>p.setAttribute('aria-pressed',String(p===x)));make(true);});
      $$('[data-recap-option]',b).forEach(x=>x.onchange=()=>{if(sending||!live())return;options[x.dataset.recapOption]=x.checked;store.set(prefKey,options);make();});
      $('#recap-retry',b).onclick=()=>make(true);
      button.onclick=async()=>{if(sending||!picture||!live())return;const run=version,blob=picture;sending=true;button.disabled=true;$$('input,[data-recap-period]',b).forEach(x=>x.disabled=true);
        try{const handedOff=await ShareArt.deliver(blob,`kinetta-${data.start}.png`,()=>live()&&run===version);if(handedOff&&live()&&run===version){onShared?.(data);}}
        catch(e){if(live()&&e.name!=='AbortError')status.textContent=e.message||'Couldn’t share this picture';}
        finally{sending=false;if(live()){$$('input,[data-recap-period]',b).forEach(x=>x.disabled=false);$('[data-recap-option="streak"]',b).disabled=data.streak_weeks<2;button.disabled=!picture;}}
      };
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
