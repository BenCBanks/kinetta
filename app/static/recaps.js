'use strict';
// Eager date/summary/cache and entry shell; editor and picture composition load only on explicit intent.
const Recaps=(()=>{
  const aliases={this_week:['week',0],last_week:['week',1],this_month:['month',0],last_month:['month',1],this_year:['year',0]};
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
  const distance=d=>(d.distance_m/(d.units==='imperial'?1609.344:1000)).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});
  const unit=d=>d.units==='imperial'?'mi':'km';
  function time(seconds){const n=Math.max(0,Math.round(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60);return h?`${h.toLocaleString()}h${m?' '+m+'m':''}`:m?`${m}m`:n+'s';}  // same as U.time (#765)
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

  let editorPromise=null,opening=null;
  function editor(){
    if(!editorPromise)editorPromise=Promise.resolve().then(()=>loadRecapEditor()).then(()=>RecapEditor.create({aliases,periodArgs,defaultOffset,today,startFor,label,summary,read,scope,distance,unit,time})).catch(error=>{editorPromise=null;throw error;});
    return editorPromise;
  }
  function open(initial,onShared){
    const owner=readOwner(),zone=App.me?.tz,path=location.pathname+location.search;
    if(opening?.owner===owner&&opening.zone===zone&&opening.path===path)return opening.promise;
    const intent={owner,zone,path},current=()=>opening===intent&&owner===readOwner()&&zone===App.me?.tz&&path===location.pathname+location.search;
    intent.promise=(async()=>{
      try{const view=await editor();if(current())view.open(initial,onShared);}
      catch(error){if(current())toast((error.message||'Progress recap could not load.')+' Tap Share to try again.');}
      finally{if(opening===intent)opening=null;}
    })();
    opening=intent;return intent.promise;
  }
  async function draw(data,options){
    const owner=readOwner(),zone=App.me?.tz,view=await editor();
    if(owner!==readOwner()||zone!==App.me?.tz)throw Error('Your account or time zone changed. Refresh and try again.');
    return view.draw(data,options);
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
