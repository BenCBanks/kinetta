// Profile presentation is separate from audiences. Every number here is already filtered by the server.
'use strict';
const FEATURED_ACHIEVEMENT_LIMIT=4;
const ProfileLayout=(()=>{
  const sections={recent:'Recent progress',mileage:'Distance chart',totals:'All-time totals',sports:'Sports',activities:'Activities'};
  const stats={activities:'Activities',distance:'Distance',time:'Time',active_days:'Active days'};
  const watchedOpenProfileCards=new WeakSet();
  const sports=['run','ride','walk','hike','swim','workout','row','ski','other'];
  const defaults=()=>({sections:Object.keys(sections),stats:['activities','distance','time'],sports:[]});
  function normalize(value){
    const d=defaults(),v=value||{};
    for(const [key,catalog] of [['sections',sections],['stats',stats],['sports',Object.fromEntries(sports.map(s=>[s,s]))]]){
      if(Array.isArray(v[key]))d[key]=[...new Set(v[key])].filter(k=>Object.hasOwn(catalog,k)).slice(0,key==='sections'?5:3);
    }
    if(!d.stats.length)d.stats=defaults().stats;
    return d;
  }
  function singlePeriod(value){
    const layout=normalize(value),selected=layout.sections.includes('totals')?'totals':'recent';let used=false;
    layout.sections=layout.sections.flatMap(k=>{if(k!=='recent'&&k!=='totals')return[k];if(used)return[];used=true;return[selected];});return layout;
  }
  // Thousands separators (Ben, 30 Oct 2026: "3044" and "11784 mi" read poorly); 100+ hours drop the minutes.
  const big=n=>Number(n).toLocaleString();
  const distance=m=>{const v=U.dist(m,1),n=Number(v);return n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:1}):v;};
  const hours=s=>s>=360000?`${big(Math.floor(s/3600))}h`:dur(s,true);
  const achievementGlyphs={
    flame:'<path d="M12 2.4c-.2 2.7-1.5 4.5-3.3 6.3C6.8 10.6 5 12.5 5 15.3 5 19.1 8.1 22 12 22s7-2.9 7-6.7c0-3.2-1.8-5.8-4.2-8.4-.5 1.7-1.2 2.7-2.5 3.7.1-2.7-.7-5.5-2.3-8.2Z"/>',
    calendar:'<path d="M7 2h2v3h6V2h2v3h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V2Zm-2 8v10h14V10H5Z"/><path fill="var(--achievement-color)" d="M7 12h3v3H7zm5 0h3v3h-3zm5 0h2v3h-2z"/>',
    lightning:'<path d="M13.5 1.5 4 13.4a1 1 0 0 0 .8 1.6h5.6l-.9 7.5 10.6-13a1 1 0 0 0-.8-1.6h-5.7l.9-6.4a.6.6 0 0 0-1-.5Z"/>',
    stopwatch:'<path d="M9 2h6v2H9zM18.5 5.5l1.4-1.4 1.5 1.5L20 6.9a9 9 0 1 1-1.5-1.4ZM12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm1 2v4.2l3 1.8-1 1.7-4-2.4V9h2Z"/>',
    medal:'<path d="M6 2h5l1 6-3 2L6 2Zm12 0h-5l-1 6 3 2 3-8Zm-6 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>',
    waves:'<path d="M2 8.5c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.8 2v2c-2.4 0-2.4-2-4.8-2s-2.4 2-4.8 2-2.4-2-4.8-2-2.4 2-4.8 2v-2Zm0 5.5c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.8 2 2.4-2 4.8-2v2c-2.4 0-2.4 2-4.8 2s-2.4-2-4.8-2-2.4 2-4.8 2-2.4-2-4.8-2-2.4 2-4.8 2v-2Zm0 5c2.4 0 2.4-2 4.8-2s2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.8 2v2c-2.4 0-2.4-2-4.8-2s-2.4 2-4.8 2-2.4-2-4.8-2-2.4 2-4.8 2v-2Z"/>',
    castle:'<path d="M3 21V8l3 2V6l3 2V4h6v4l3-2v4l3-2v13H3Zm3-2h3v-4H6v4Zm9 0h3v-4h-3v4Zm-4-5h2v-3h-2v3Z"/>',
    bridge:'<path d="M2 18h20v3H2v-3Zm2-2V9h2v7H4Zm5 0v-5h2v5H9Zm5 0v-5h2v5h-2Zm5 0V9h2v7h-2ZM2 8c3.1 0 4.8-2 10-2s6.9 2 10 2v2c-4 0-5.6-2-10-2s-6 2-10 2V8Z"/>',
    acacia:'<path d="M11 13h2v9h-2v-9ZM3 11c0-2.2 2.1-3.8 4.4-3.4C8 4.7 10.1 3 12.7 3c2.9 0 5.2 2 5.4 4.8 1.7-.2 3.2 1.2 3.2 2.9 0 1.8-1.5 3.3-3.3 3.3H6.2C4.4 14 3 12.7 3 11Z"/>',
    globe:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/><path fill="var(--achievement-color)" d="M11 3.2c-2 2.2-3 5.1-3 8.8s1 6.7 3 8.8c-3.7-.4-6.7-4.2-6.7-8.8s3-8.4 6.7-8.8Zm2 0c2 2.1 3 5.1 3 8.8s-1 6.6-3 8.8c3.7-.4 6.7-4.2 6.7-8.8s-3-8.4-6.7-8.8ZM3.4 11h17.2v2H3.4z"/>',
    moon:'<path d="M19.4 15.8A8.5 8.5 0 0 1 8.2 4.6 9.5 9.5 0 1 0 19.4 15.8Z"/>',
    mountain:'<path d="m2 20 7.1-12 3.2 5.3 2.3-3.8L22 20H2Z"/><path fill="var(--achievement-color)" d="m9.1 10.8 1.3 2.1-1.1 1.5-1-1.7-2.8 4.8h5l2.1-3.5-1.5-2.5 1.2-2 2.6 4.2 1.1-1.9 3.4 5.7h-6.2l-1.2 2H5.7l-1-1.7z"/>',
    kettlebell:'<path d="M3.5 11.8C3.5 5.8 6.8 2.2 12 2.2C17.2 2.2 20.5 5.8 20.5 11.8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M8 7.8C5.8 7.8 4.7 9.3 4 11.3l-1.3 3.8C1.8 17.8 4 22 7 22h10c3 0 5.2-2.2 4.3-4.9L20 11.3c-.7-2-1.8-3.5-4-3.5-1.6 0-2.5 1.6-4 1.6s-2.4-1.6-4-1.6Z"/>',
    trophy:'<path d="M7 3h10v3h4v3a5 5 0 0 1-5 5h-.7A5 5 0 0 1 13 16.8V19h4v2H7v-2h4v-2.2A5 5 0 0 1 8.7 14H8a5 5 0 0 1-5-5V6h4V3Zm-2 5v1a3 3 0 0 0 2.5 3A8 8 0 0 1 7 8H5Zm14 0h-2a8 8 0 0 1-.5 4A3 3 0 0 0 19 9V8Z"/>',
    runner:'<circle cx="15.5" cy="4.5" r="2.5"/><path d="m12 8 4 1 2.2 3.2 3.2 1.1-.7 2-4-1.4-2-2.4-2 2.2 3.6 2.4 2.1 5.2h-2.3l-1.7-4-4.4-2.4-2.9 3.8H4.5l3.8-5.7 3.1-3.1-1.1-.6-2.4 2.5-3.3-.5.3-2.1 2.4.3L10 9.1A3 3 0 0 1 12 8Z"/>',
    bike:'<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><circle fill="var(--achievement-color)" cx="6" cy="17" r="1.8"/><circle fill="var(--achievement-color)" cx="18" cy="17" r="1.8"/><path d="M5 16h2.2l3-6.7h3.3l3.9 6.7H15l-2.6-4.4-2.1 4.4H5Zm4.2-8.6 1.4-2.9h2l2.1 2.7h3.4v2h-4.5L12 7.3l-1 2.1H8.8Zm8.3 9.6 1.8-1.1 2.3 1.9-1.3 1.6-2.8-2.4Z"/>',
    footprints:'<path d="M8 13.1c-1.8-.2-3.3 1.6-3.7 4.1-.3 2.1.6 3.6 2.1 3.8 1.8.2 3.4-1.5 3.8-3.9.3-2.2-.6-3.7-2.2-4Zm-.3-3.3c1.2 0 2.1-1.7 2-3.6S8.7 3 7.5 3 5.4 4.7 5.5 6.6s.9 3.2 2.2 3.2Zm4.2 1.3c1.1-.5 1.3-2.3.5-4s-2-2.6-3.1-2.1-1.3 2.3-.5 4 2 2.6 3.1 2.1Zm7.1 2c-1.6-.5-3.1.9-3.8 3.2-.6 2.1 0 3.8 1.5 4.3 1.7.5 3.4-.9 4.1-3 .6-2.2 0-4-1.8-4.5Zm-2.4-3.4c1.1-.2 1.7-2 1.3-3.8s-1.5-3-2.7-2.7-1.8 2-1.4 3.8 1.6 2.9 2.8 2.7Z"/>'
  };
  const achievementNumber=n=>Number.isFinite(Number(n))?Number(n).toLocaleString(undefined,{maximumFractionDigits:1}):'—';
  let achievementTextMeasure=null;
  function achievementTextWidth(text,size,{fontFamily='sans-serif',fontWeight='700',fontStyle='normal'}={}){
    if(!achievementTextMeasure&&typeof document!=='undefined')achievementTextMeasure=document.createElement('canvas').getContext('2d');
    if(!achievementTextMeasure)return null;
    achievementTextMeasure.font=`${fontStyle} ${fontWeight} ${size}px ${fontFamily}`;
    return achievementTextMeasure.measureText(String(text??'')).width;
  }
  function achievementTextFontSize(text,width,{fontFamily='sans-serif',fontWeight='700',fontStyle='normal',maxFontSize=12,minFontSize=10,step=1}={}){
    const minimum=Math.max(10,Number(minFontSize)||10),maximum=Math.max(minimum,Number(maxFontSize)||12),available=Number(width);
    if(!Number.isFinite(available)||available<=0||achievementTextWidth(text,maximum,{fontFamily,fontWeight,fontStyle})===null)return maximum;
    const value=String(text??''),decrement=Math.max(.5,Number(step)||1);
    for(let size=maximum;;size=Math.max(minimum,size-decrement)){
      if(achievementTextWidth(value,size,{fontFamily,fontWeight,fontStyle})<=available+.5||size<=minimum)return size;
    }
  }
  function compactAchievementText(text){
    const match=String(text??'').match(/^([\d,]+(?:\.\d+)?)(\s+.+)$/),value=Number(match?.[1]?.replace(/,/g,''));
    if(!match||!Number.isFinite(value)||value<1000)return '';
    let scale=value>=1e9?1e9:value>=1e6?1e6:1e3,suffix=scale===1e9?'b':scale===1e6?'m':'k';
    let rounded=Number((value/scale).toFixed(value/scale<10?1:0));
    if(rounded>=1000&&scale<1e9){scale*=1000;suffix=scale===1e9?'b':'m';rounded=Number((value/scale).toFixed(value/scale<10?1:0));}
    return `${rounded.toLocaleString(undefined,{maximumFractionDigits:1})}${suffix}${match[2]}`;
  }
  function fitAchievementText(element,{minFontSize=10,step=1}={}){
    if(!element)return 0;
    const style=getComputedStyle(element),remembered=Number(element.dataset.fitTextMax);
    const maxFontSize=Number.isFinite(remembered)&&remembered>0?remembered:parseFloat(style.fontSize)||12;
    const minimum=Math.max(10,Number(minFontSize)||10),source=element.dataset.fitTextSource??element.textContent;
    element.dataset.fitTextMax=String(maxFontSize);element.dataset.fitTextSource=source;element.textContent=source;
    const metrics={fontFamily:style.fontFamily,fontWeight:style.fontWeight,fontStyle:style.fontStyle,maxFontSize,minFontSize:minimum,step},width=element.clientWidth;
    let size=achievementTextFontSize(source,width,metrics);
    if(size<=minimum){
      const compact=compactAchievementText(source),fullWidth=achievementTextWidth(source,minimum,metrics);
      if(compact&&compact.length<String(source).length&&fullWidth!==null&&fullWidth>width+.5){element.textContent=compact;size=minimum;}
    }
    element.style.fontSize=`${size}px`;
    return size;
  }
  if(typeof window!=='undefined')window.KinettaTextFit=Object.freeze({fontSize:achievementTextFontSize,fitElement:fitAchievementText});
  function achievementQuantity(value,unit=''){
    const forms={week:['week','weeks'],weeks:['week','weeks'],hour:['hour','hours'],hours:['hour','hours'],h:['hour','hours'],workout:['workout','workouts'],workouts:['workout','workouts'],session:['session','sessions'],sessions:['session','sessions'],year:['year','years'],years:['year','years']};
    const label=forms[String(unit||'').toLowerCase()],shownUnit=label?(Number(value)===1?label[0]:label[1]):unit;
    return `${achievementNumber(value)}${shownUnit?' '+shownUnit:''}`;
  }
  let achievementCatalog=null,achievementCatalogPromise=null;
  function loadAchievementCatalog(){
    if(achievementCatalog)return Promise.resolve(achievementCatalog);
    if(!achievementCatalogPromise)achievementCatalogPromise=fetch('/static/profile.achievement-levels.json?v=__ASSET_HASH__').then(response=>{if(!response.ok)throw Error('Achievement levels are unavailable.');return response.json();}).then(data=>(achievementCatalog=data)).catch(()=>{achievementCatalogPromise=null;return {};});
    return achievementCatalogPromise;
  }
  function achievementDefinition(track){return achievementCatalog?.tracks?.[track?.code]||null;}
  function achievementRawValue(track){
    const value=Number(track?.value??track?.value_m??track?.value_kg??track?.value_s??track?.value_weeks??track?.value_years??track?.value_sessions);
    return Number.isFinite(value)&&value>=0?value:0;
  }
  function achievementCanonicalThreshold(tier){
    const value=Number(tier?.canonical_value);if(!Number.isFinite(value))return NaN;
    if(tier.canonical_unit==='km')return value*1000;
    if(tier.canonical_unit==='hours')return value*3600;
    return value;
  }
  function achievementTierAt(code,level){
    const def=achievementCatalog?.tracks?.[code],n=Math.max(1,Math.floor(Number(level)||1));if(!def)return null;
    if(!Array.isArray(def.levels)||!def.levels.length)return null;
    const displayName=tier=>App.me?.units==='metric'&&tier?.name==='First mile'&&tier?.display==='mi'?'First 1.6 km':tier?.name;
    if(n<=def.levels.length)return {...def.levels[n-1],name:displayName(def.levels[n-1]),level:n,threshold:achievementCanonicalThreshold(def.levels[n-1]),multiple:1};
    const last=def.levels.at(-1),multiple=n-def.levels.length+1;
    return {...last,level:n,name:`${displayName(last)} ×${multiple}`,threshold:achievementCanonicalThreshold(last)*multiple,
      canonical_value:Number(last.canonical_value)*multiple,display_value:Number(last.display_value)*multiple,multiple};
  }
  function achievementLevel(track){
    if(track?._sharedAchievement)return Math.max(0,Math.round(Number(track.level)||0));
    const def=achievementDefinition(track);if(!def)return Math.max(0,Math.round(Number(track.level)||track.tiers?.length||0));
    const value=achievementRawValue(track),firstActivityEarned=value>0||(track.tiers||[]).some(tier=>tier.trigger==='first_activity');let level=0;
    for(const tier of def.levels){
      if(tier.trigger==='first_activity'){if(firstActivityEarned)level++;else break;continue;}
      if(achievementCanonicalThreshold(tier)<=value+1e-7)level++;else break;
    }
    if(level===def.levels.length){const last=achievementCanonicalThreshold(def.levels.at(-1));
      if(last>0&&value>=last)level+=Math.max(0,Math.floor((value+1e-7)/last)-1);}
    return level;
  }
  function achievementCurrentTier(track){const level=achievementLevel(track);return level?achievementTierAt(track.code,level):null;}
  function achievementLevels(track){
    const def=achievementDefinition(track);return def?.levels?.map((_,i)=>achievementTierAt(track.code,i+1))||[];
  }
  const achievementLabels={consistency:'Consistency',years_active:'Years active',workouts:'Workouts',active_time:'Active time',journey:'Journey',climbing:'Climbing',lifted:'Lifted',personal_bests:'Personal bests','sport:run':'Run','sport:ride':'Ride','sport:walk-hike':'Walk & hike','sport:swim':'Swim','sport:lift':'Lift sessions'};
  function emptyAchievementTrack(code){
    const def=achievementCatalog?.tracks?.[code];if(!def?.levels?.length)return null;
    const imperial=App.me?.units!=='metric',unit=({journey:imperial?'mi':'km','sport:run':imperial?'mi':'km','sport:ride':imperial?'mi':'km','sport:walk-hike':imperial?'mi':'km','sport:swim':imperial?'mi':'km',climbing:imperial?'ft':'m',lifted:imperial?'lb':'kg',active_time:'hours'})[code]||def.levels[0].canonical_unit||'';
    return{code,label:achievementLabels[code]||code,value:0,display_value:0,display_unit:unit,tiers:[]};
  }
  function overviewAchievementTracks(data){
    const byCode=new Map((Array.isArray(data?.tracks)?data.tracks:[]).filter(track=>track?.code).map(track=>[track.code,track]));
    return Object.keys(achievementCatalog?.tracks||{}).map(code=>byCode.get(code)||emptyAchievementTrack(code)).filter(Boolean);
  }
  function achievementAsset(tier,className='profile-achievement-icon'){
    if(!tier?.icon)return '';
    const name=tier.asset_name||tier.fluent_asset||tier.name||'level';
    return `<img class="${className}" data-achievement-icon="${esc(name)}" src="${esc(tier.icon)}" alt="" aria-hidden="true" loading="${className==='profile-achievement-icon'?'eager':'lazy'}" decoding="async">`;
  }
  const achievementDay=track=>(track.tiers||[]).reduce((day,tier)=>String(tier.day||'')>day?String(tier.day):day,'')||String(track.day||'');
  function startedAchievements(data){return (Array.isArray(data?.tracks)?data.tracks:[]).filter(t=>t&&Array.isArray(t.tiers)&&t.tiers.length>0).sort((a,b)=>achievementDay(b).localeCompare(achievementDay(a))||achievementLevel(b)-achievementLevel(a));}
  function achievementDisplayOrder(tracks,{earnedByProgress=true}={}){return [...tracks].sort((a,b)=>{
    const rank=track=>achievementLevel(track)>0?0:achievementTrackStarted(track)?1:2,aRank=rank(a),bRank=rank(b);
    if(aRank!==bRank)return aRank-bRank;
    if(aRank===0&&!earnedByProgress)return achievementDay(b).localeCompare(achievementDay(a))||achievementLevel(b)-achievementLevel(a);
    const progress=achievementProgress(b)-achievementProgress(a);
    return Math.abs(progress)>1e-9?progress:achievementDay(b).localeCompare(achievementDay(a))||achievementLevel(b)-achievementLevel(a);
  });}
  async function featuredOptions(data,available){
    await loadAchievementCatalog();
    const eligible=new Set((Array.isArray(available)?available:[]).map(item=>item?.code).filter(code=>typeof code==='string'));
    return startedAchievements(data).filter(track=>eligible.has(track.code)).map(track=>{
      const level=achievementLevel(track),tier=achievementCurrentTier(track);
      return {code:track.code,label:track.code==='sport:lift'?'Lift sessions':track.label||track.code,
        detail:`Level ${level}${tier?.name?` · ${tier.name}`:''}`,icon:achievementAsset(tier,'me-featured-icon')};
    });
  }
  const achievementHref=track=>'/me/achievements/'+encodeURIComponent(track.code);
  function achievementJourneyGlyph(track){
    const label=String(track.tiers?.at(-1)?.label||track.label||'').toLowerCase();
    if(label.includes('marathon'))return 'medal';
    if(label.includes('tahoe'))return 'waves';
    if(label.includes('united kingdom')||label.includes('length of the uk')||/\buk\b/.test(label))return 'castle';
    if(label.includes('across the us')||label.includes('united states'))return 'bridge';
    if(label.includes('africa'))return 'acacia';
    if(label.includes('around the world')||label==='the world'||label.includes('world x'))return 'globe';
    if(label.includes('moon'))return 'moon';
    return 'globe';
  }
  function achievementGlyph(track){
    const icon=track.code==='journey'?achievementJourneyGlyph(track):({consistency:'flame',years_active:'calendar',workouts:'lightning',active_time:'stopwatch',climbing:'mountain',lifted:'kettlebell',personal_bests:'trophy','sport:run':'runner','sport:ride':'bike','sport:walk-hike':'footprints','sport:swim':'waves','sport:lift':'kettlebell'}[track.code]||'trophy');
    return `<svg class="profile-achievement-icon" data-achievement-icon="${icon}" viewBox="0 0 24 24" aria-hidden="true">${achievementGlyphs[icon]||achievementGlyphs.trophy}</svg>`;
  }
  function achievementValue(track){
    return achievementQuantity(track.display_value,track.display_unit||'');
  }
  function sharedAchievementTracks(data){
    return (Array.isArray(data?.tracks)?data.tracks:[]).map(track=>{
      const earned=(Array.isArray(track?.tiers)?track.tiers:[]).filter(tier=>Number.isInteger(Number(tier?.rank))&&Number(tier.rank)>0).sort((a,b)=>Number(a.rank)-Number(b.rank)),current=earned.at(-1),reportedLevel=Number(track?.level),rank=Number.isInteger(reportedLevel)&&reportedLevel>0?reportedLevel:Number(current?.rank),tier=rank?achievementTierAt(track.code,rank):null;
      if(!rank||!tier)return null;
      const total=track?.display_value,displayValue=total!=null&&Number.isFinite(Number(total))?Number(total):Number(current?.display_threshold??tier.display_value);
      return {...track,level:rank,display_value:displayValue,display_unit:track.display_unit||current?.display_unit||track.unit||tier.canonical_unit,tiers:earned,_sharedAchievement:true};
    }).filter(Boolean);
  }
  function achievementNext(track){
    const tier=achievementTierAt(track.code,achievementLevel(track)+1);if(tier)return tier.name;
    const next=track.next;if(!next)return '';
    if(['journey','climbing','lifted'].includes(track.code)&&next.label)return next.label;
    return achievementQuantity(next.display_threshold,next.display_unit||'');
  }
  function achievementThresholdText(track,tier){
    const raw=Number(tier?.canonical_value)||0,hint=Number(tier?.display_value),canonicalUnit=tier?.canonical_unit||'',code=track.code,imperial=App.me?.units!=='metric';
    const exact=n=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:1}):'—';
    if(tier?.trigger==='first_activity')return 'First activity';
    if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(code)){
      const km=canonicalUnit==='km'?raw:raw/1000;
      const value=imperial?(tier?.display==='mi'&&Number.isFinite(hint)?hint:km*1000/1609.344):km,unit=imperial?'mi':'km';
      return `${tier?.display==='km-fixed'&&!imperial?exact(value):achievementNumber(value)} ${unit}`;
    }
    if(code==='climbing')return `${achievementNumber(imperial&&Number.isFinite(hint)?hint:raw)} ${imperial?'ft':'m'}`;
    if(code==='lifted')return `${achievementNumber(imperial&&Number.isFinite(hint)?hint:raw)} ${imperial?'lb':'kg'}`;
    if(code==='active_time')return achievementQuantity(Number.isFinite(hint)?hint:canonicalUnit==='hours'?raw:raw/3600,'hours');
    const value=Number.isFinite(hint)?hint:Number(tier?.canonical_value)||0;
    if(code==='personal_bests')return `${achievementNumber(value)} ${value===1?'personal best':'personal bests'}`;
    return achievementQuantity(value,canonicalUnit);
  }
  function achievementRemainingText(track,tier){
    if(tier?.trigger==='first_activity')return 'First activity to go';
    const raw=Math.max(0,Number(tier?.threshold)-achievementRawValue(track)),imperial=App.me?.units!=='metric',code=track.code;
    let value=raw,unit=achievementDefinition(track)?.levels?.[0]?.canonical_unit||'';
    if(['journey','sport:run','sport:ride','sport:walk-hike','sport:swim'].includes(code)){value=raw/(imperial?1609.344:1000);unit=imperial?'mi':'km';}
    else if(code==='climbing'){value=raw*(imperial?3.28084:1);unit=imperial?'ft':'m';}
    else if(code==='lifted'){value=raw*(imperial?2.2046226218:1);unit=imperial?'lb':'kg';}
    else if(code==='active_time'){value=raw/3600;unit='hours';}
    if(code==='personal_bests')return `${achievementNumber(value)} ${value===1?'personal best':'personal bests'} left`;
    return `${achievementQuantity(value,unit)} left`;
  }
  function achievementLevelRow(track,tier,currentLevel,earnedTiers=new Map()){
    const next=tier.level===currentLevel+1,state=tier.level===currentLevel?'is-current':tier.level<currentLevel?'is-earned':next?'is-next':'is-upcoming',status=tier.level===currentLevel?'Current level':tier.level<currentLevel?'Earned':next?'Next level':'Coming up';
    const earned=earnedTiers.get(tier.level)||{},day=String(earned.day||''),dateOptions={month:'short',day:'numeric'};
    if(day&&Number(day.slice(0,4))!==new Date().getFullYear())dateOptions.year='numeric';
    const date=day?fdate(day+'T12:00',dateOptions):'',activityId=Number(earned.activity_id),href=Number.isSafeInteger(activityId)&&activityId>0?`/activity/${activityId}`:'';
    let meta='';
    if(tier.level<=currentLevel){const earnedTime=date?`<time datetime="${esc(day)}">${esc(date)}</time>`:'<span>Earned</span>';meta=`<span class="profile-achievement-level-earned">${earnedTime}${href?'<span class="profile-achievement-history-chevron" aria-hidden="true">›</span>':''}</span>`;}
    else if(next&&!achievementTrackStarted(track)&&tier.level===1)meta='<span class="profile-achievement-level-start-here">Start here</span>';
    else if(next&&achievementTrackStarted(track)){
      const progress=Math.round(achievementProgress(track)*100),remaining=achievementRemainingText(track,tier);
      meta=`<span class="profile-achievement-level-progress"><span class="profile-achievement-level-progressbar" role="progressbar" data-achievement-progress aria-label="Progress to Level ${tier.level}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span data-progress-fill></span></span><small>${esc(remaining)}</small></span>`;
    }
    const threshold=achievementThresholdText(track,tier),name=`Level ${tier.level} · ${threshold}`;
    const content=`${achievementAsset(tier,'profile-achievement-level-icon')}<span class="profile-achievement-level-copy"><span class="profile-achievement-level-title"><b>${esc(name)}</b></span><small>${esc(tier.name)}${tier.level===currentLevel?' · Current':''}</small></span><span class="profile-achievement-level-meta">${meta}</span>`;
    const spokenStatus=tier.level<=currentLevel?(date?`earned ${date}`:'earned'):status.toLowerCase(),accessibleLabel=`Level ${tier.level}, ${tier.name}, ${spokenStatus}`;
    return `<li class="profile-achievement-level-row ${state}" data-level="${tier.level}">${href?`<a class="profile-achievement-level-link" href="${href}" aria-label="${esc(accessibleLabel)}">${content}</a>`:`<span class="profile-achievement-level-content">${content}</span>`}</li>`;
  }
  function achievementLevelList(track,level,historyData){
    const named=achievementLevels(track),count=named.length,tailOpen=Boolean(achievementCatalog?.tail),earnedTiers=new Map((Array.isArray(historyData?.tiers)?historyData.tiers:[]).map(tier=>[Number(tier.rank),tier]).filter(([rank,tier])=>Number.isInteger(rank)&&rank>0&&tier));
    const hasTail=tailOpen&&level>=count,tailStart=level>count?level:count+1,tailRows=hasTail?Array.from({length:4},(_,i)=>achievementTierAt(track.code,tailStart+i)).filter(Boolean):[];
    return `<section class="profile-achievement-levels" aria-labelledby="profile-achievement-levels-title"><h2 class="sec-head" id="profile-achievement-levels-title">Levels</h2><ol class="profile-achievement-named-levels" aria-label="All named achievement levels">${named.map(tier=>achievementLevelRow(track,tier,level,earnedTiers)).join('')}</ol>${tailRows.length?`<ol class="profile-achievement-tail-levels" aria-label="Repeating levels">${tailRows.map(tier=>achievementLevelRow(track,tier,level,earnedTiers)).join('')}</ol><button class="profile-achievement-more" type="button" data-achievement-show-more data-next-level="${tailStart+4}">Show more</button>`:''}</section>`;
  }
  function sharedAchievementLevelList(track,historyData){
    const earned=new Map((Array.isArray(historyData?.tiers)?historyData.tiers:[]).map(row=>[Number(row.rank),{day:String(row.day||'')}]).filter(([rank])=>Number.isInteger(rank)&&rank>0));
    const levels=[...earned.keys()].sort((a,b)=>a-b).map(rank=>achievementTierAt(track.code,rank)).filter(Boolean);
    return levels.length?`<section class="profile-achievement-levels" aria-labelledby="profile-achievement-levels-title"><h2 class="sec-head" id="profile-achievement-levels-title">Earned levels</h2><ol class="profile-achievement-named-levels" aria-label="Earned achievement levels">${levels.map(tier=>achievementLevelRow(track,tier,achievementLevel(track),earned)).join('')}</ol></section>`:'<p class="small muted">No earned levels to show.</p>';
  }
  function wireAchievementLevelList(box,track,level,historyData){
    const section=box.querySelector('.profile-achievement-levels');if(!section)return;
    const more=section.querySelector('[data-achievement-show-more]');
    if(more)more.addEventListener('click',()=>{
      const start=Number(more.dataset.nextLevel),earnedTiers=new Map((Array.isArray(historyData?.tiers)?historyData.tiers:[]).map(row=>[Number(row.rank),row])),tiers=Array.from({length:4},(_,i)=>achievementTierAt(track.code,start+i)).filter(Boolean),list=section.querySelector('.profile-achievement-tail-levels');
      list.insertAdjacentHTML('beforeend',tiers.map(tier=>achievementLevelRow(track,tier,level,earnedTiers)).join(''));
      fitAchievementProgress(list);more.dataset.nextLevel=String(start+4);more.focus({preventScroll:true});
    });
  }
  function achievementProgress(track){
    const level=achievementLevel(track),current=achievementTierAt(track.code,level),next=achievementTierAt(track.code,level+1);
    const start=level?Number(current?.threshold)||0:0,end=Number(next?.threshold),value=achievementRawValue(track);
    return Number.isFinite(end)&&end>start&&Number.isFinite(value)?Math.max(0,Math.min(1,(value-start)/(end-start))):0;
  }
  function fitAchievementProgress(root){
    if(!root?.querySelectorAll)return;
    root.querySelectorAll('[data-achievement-progress]').forEach(bar=>{
      const fill=bar.querySelector('[data-progress-fill]'),value=Math.max(0,Math.min(100,Number(bar.getAttribute('aria-valuenow'))||0));
      if(fill)fill.style.width=`${value}%`;
    });
  }
  function achievementTrackStarted(track){return achievementLevel(track)>0||achievementRawValue(track)>0||(Array.isArray(track?.tiers)&&track.tiers.length>0);}
  function achievementMedalValue(track,{small=false}={}){
    const value=achievementValue(track);if(!small&&value.length<=9)return value;
    const raw=Number(track.display_value),unit=String(track.display_unit||'').toLowerCase();if(!Number.isFinite(raw))return value;
    const compact=number=>{const n=Math.abs(number);if(n>=1e9)return `${achievementNumber(number/1e9)}b`;if(n>=1e6)return `${achievementNumber(number/1e6)}m`;if(n>=1e5)return `${Math.round(number/1e3)}k`;if(n>=1e3)return `${achievementNumber(number/1e3)}k`;return achievementNumber(number);};
    const amount=compact(raw),shortUnit=({hour:'h',hours:'h',h:'h',week:'wk',weeks:'wk',year:'yr',years:'yr',workout:'wkt',workouts:'wkt',session:'sess',sessions:'sess',mi:'mi',km:'km',ft:'ft',m:'m',lb:'lb',kg:'kg'})[unit];
    return `${amount}${shortUnit?' '+shortUnit:''}`;
  }
  const achievementSections=[
    {id:'overall',title:'Overall',codes:['consistency','workouts','active_time','years_active','personal_bests']},
    {id:'distance',title:'Distance',codes:['journey','sport:run','sport:ride','sport:walk-hike','sport:swim','climbing']},
    {id:'strength',title:'Strength',codes:['lifted','sport:lift']}
  ];
  function achievementGrid(tracks,levelUps,pinnedCodes=new Set()){
    return achievementSections.map(section=>{
      const grouped=achievementDisplayOrder(tracks.filter(track=>section.codes.includes(track.code)));
      if(!grouped.length)return '';
      const id=`profile-achievement-group-${section.id}`;
      return `<section class="profile-achievement-group" aria-labelledby="${id}"><h2 class="sec-head profile-achievement-group-title" id="${id}">${section.title}</h2><div class="profile-achievement-list is-grid" role="list" aria-labelledby="${id}">${grouped.map(track=>achievementRow(track,levelUps,pinnedCodes,true)).join('')}</div></section>`;
    }).join('');
  }
  function sharedAchievementGrid(tracks,login){
    return achievementSections.map(section=>{
      const grouped=tracks.filter(track=>section.codes.includes(track.code)).sort((a,b)=>achievementDay(b).localeCompare(achievementDay(a))||achievementLevel(b)-achievementLevel(a));
      if(!grouped.length)return '';
      const id=`profile-achievement-group-${section.id}`;
      return `<section class="profile-achievement-group" aria-labelledby="${id}"><h2 class="sec-head profile-achievement-group-title" id="${id}">${section.title}</h2><div class="profile-achievement-list is-grid" role="list" aria-labelledby="${id}">${grouped.map(track=>sharedAchievementRow(track,login)).join('')}</div></section>`;
    }).join('');
  }
  function sharedAchievementRow(track,login='',{featured=false}={}){
    const label=track.code==='sport:lift'?'Lift sessions':track.label||track.code,level=achievementLevel(track),tier=achievementCurrentTier(track),href=login?`/people/${encodeURIComponent(login)}?view=achievements&track=${encodeURIComponent(track.code)}`:achievementHref(track);
    const secondary=featured?' data-type="secondary"':'';
    return `<a class="profile-achievement${featured?' me-featured-item':''}" role="listitem" href="${esc(href)}" aria-label="${esc(`${label}, Level ${level}${tier?`, ${tier.name}`:''}, ${achievementValue(track)}`)}" data-achievement-code="${esc(track.code)}"${featured?` data-showcase-code="${esc(track.code)}"`:''}>${achievementMedallion(track,{featured})}<span class="profile-achievement-name"${secondary}>${esc(label)}</span><span class="profile-achievement-next"${secondary}>${esc(`Level ${level}${tier?` · ${tier.name}`:''}`)}</span></a>`;
  }
  function achievementMedallion(track,{featured=false}={}){
    const started=achievementTrackStarted(track),level=achievementLevel(track),value=started?achievementMedalValue(track,{small:featured}):'',tier=achievementCurrentTier(track)||achievementTierAt(track.code,1);
    const tone=level>=6?'deep':String(level),secondary=featured?' data-type="secondary"':'';
    return `<span class="profile-achievement-medallion" data-level="${level}" data-level-tone="${tone}" aria-hidden="true">${achievementAsset(tier)||achievementGlyph(track)}${started?`<span class="profile-achievement-value"${secondary}>${esc(value)}</span><span class="profile-achievement-level"${secondary}>Lv ${level}</span>${Number(tier?.multiple)>1?`<span class="profile-achievement-multiple"${secondary}>×${Number(tier.multiple)}</span>`:''}`:''}</span>`;
  }
  function achievementRow(track,levelUps=new Set(),pinnedCodes=new Set(),showLevelCount=false){
    const label=track.code==='sport:lift'?'Lift sessions':track.label||track.code,level=achievementLevel(track),tier=achievementCurrentTier(track),value=achievementValue(track),next=achievementNext(track),up=levelUps.has(track.code),pinned=pinnedCodes.has(track.code),canPin=Array.isArray(track.tiers)&&track.tiers.length>0,started=achievementTrackStarted(track),earned=level>0,first=achievementTierAt(track.code,1),namedCount=achievementDefinition(track)?.levels?.length||0,maximum=namedCount&&!achievementCatalog?.tail?` of ${namedCount}`:'';
    const nextTier=achievementTierAt(track.code,level+1),remaining=nextTier?achievementRemainingText(track,nextTier):'',requirement=first?achievementThresholdText(track,first):'the first level',progress=showLevelCount?Math.round(achievementProgress(track)*100):0;
    const aria=earned?`${label}, Level ${level}${maximum}${tier?` ${tier.name}`:''}, ${value}${next?`. Next ${next}`:''}${pinned?', Pinned to profile':''}`:`${label}, future reward, ${started?'In progress':'Not started'}${nextTier?`. ${remaining} (${nextTier.name})`:''}`;
    const description=showLevelCount&&!earned?`Future reward. ${started?'In progress. ':'Not started. '}First reward: ${first?.name||'the first level'}; requires ${requirement}.`:showLevelCount&&!canPin?'In progress. Earn a level to feature this achievement.':`Long press to ${pinned?'remove this medal from':'pin this medal to'} your profile.`;
    const progressBar=showLevelCount?`<span class="profile-achievement-overview-progress" role="progressbar" data-achievement-progress aria-label="Progress to ${earned?'the next':'the first'} level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span data-progress-fill></span></span>`:'';
    const detail=showLevelCount?(nextTier?[nextTier.name,remaining].filter(Boolean).join(' · '):remaining||'All levels earned'):(next?`Next · ${next}`:'Highest tier');
    return `<a class="profile-achievement${up?' is-level-up':''}${showLevelCount&&!earned?' is-future':''}${showLevelCount&&!started?' is-unstarted':''}" role="listitem" href="${esc(achievementHref(track))}" aria-label="${esc(aria)}" aria-description="${esc(description)}" data-achievement-code="${esc(track.code)}" data-showcase-pinned="${pinned}" data-showcase-eligible="${canPin}">${achievementMedallion(track)}<span class="profile-achievement-name">${esc(label)}</span>${progressBar}<span class="profile-achievement-next">${esc(detail)}</span></a>`;
  }
  function achievementLevelUps(data){
    const owner=App.me?.id;if(owner==null)return new Set();
    const scope=`${Native.base||location.origin}:${owner}`,key=`kinetta.achievement-levels.v3:${scope}`,legacyKey=`kinetta.achievement-levels.v2:${scope}`;
    let previous=null,legacy=null;
    try{previous=JSON.parse(localStorage.getItem(key)||'null');if(!previous||typeof previous!=='object'||Array.isArray(previous))previous=null;}catch(_){previous=null;}
    try{legacy=JSON.parse(localStorage.getItem(legacyKey)||'null');if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))legacy=null;}catch(_){legacy=null;}
    const migrating=!previous&&!!legacy;if(migrating)previous=legacy;
    const latest={...(previous||{})},up=new Set();
    const insertedV3Levels={consistency:2,workouts:2,active_time:2,journey:2,climbing:2,lifted:1,'sport:run':2,'sport:ride':2,'sport:walk-hike':2,'sport:swim':2};
    for(const track of Array.isArray(data?.tracks)?data.tracks:[]){
      if(!track?.code)continue;const level=achievementLevel(track),had=previous&&Object.prototype.hasOwnProperty.call(previous,track.code),before=Number(previous?.[track.code]);
      const baseline=migrating&&Number.isFinite(before)?before+(insertedV3Levels[track.code]||0):before;
      if(had&&Number.isFinite(baseline)&&level>baseline)up.add(track.code);
      latest[track.code]=migrating?level:Math.max(Number.isFinite(before)?before:0,level);
    }
    try{localStorage.setItem(key,JSON.stringify(latest));}catch(_){/* animation is optional when storage is unavailable */}
    return up;
  }
  function achievementLevelUpHaptic(levelUps){if(levelUps.size)Native.achievementLevelUp?.();}
  function showcaseMarkup(data){
    const items=(Array.isArray(data?.items)?data.items:[]).slice(0,FEATURED_ACHIEVEMENT_LIMIT).map(item=>{
      const code=String(item?.code||''),rank=Number(item?.rank);
      if(!code||!Number.isInteger(rank)||rank<1)return null;
      const tier=achievementTierAt(code,rank);
      return tier?{code,name:tier.name,icon:achievementAsset(tier,'me-showcase-icon')}:null;
    }).filter(Boolean);
    const streak=Number(data?.day_streak),hasStreak=Number.isInteger(streak)&&streak>=2;
    if(!items.length&&!hasStreak)return '';
    const names=items.map(item=>item.name),label=[names.length?`Showcase: ${names.join(', ')}`:'',hasStreak?`${streak}-day activity streak`:'' ].filter(Boolean).join('. ');
    return `<span class="me-showcase-row" role="img" aria-label="${esc(label)}">${items.map(item=>`<span class="me-showcase-medal" data-showcase-code="${esc(item.code)}" aria-hidden="true">${item.icon}</span>`).join('')}${hasStreak?`<span class="me-showcase-streak" aria-hidden="true">${svg('flame')}<span>${streak}-day streak</span></span>`:''}</span>`;
  }
  function showcaseStreakMarkup(data){
    const streak=Number(data?.day_streak);if(!Number.isInteger(streak)||streak<2)return '';
    return `<span class="me-showcase-row" role="img" aria-label="${streak}-day activity streak"><span class="me-showcase-streak" aria-hidden="true">${svg('flame')}<span>${streak}-day streak</span></span></span>`;
  }
  function featuredShowcaseMarkup(showcase,achievementData,{sharedLogin=''}={}){
    const pinned=new Set((Array.isArray(showcase?.pinned)?showcase.pinned:[]).map(String)),tracks=new Map((Array.isArray(achievementData?.tracks)?achievementData.tracks:[]).map(track=>[String(track?.code||''),track]));
    // The server's item order is the automatic top-four selection when no pins exist.
    // If the server has no pins or automatic items, fill the rail with the highest earned tracks.
    let choices=(Array.isArray(showcase?.items)?showcase.items:[]).filter(item=>!pinned.size||pinned.has(String(item?.code||'')));
    if(!choices.length&&pinned.size)choices=[...pinned].map(code=>({code,rank:achievementLevel(tracks.get(code)||{})}));
    if(!choices.length&&!pinned.size)choices=[...tracks.values()].map(track=>({track,rank:achievementLevel(track)})).filter(item=>item.rank>0)
      .sort((a,b)=>b.rank-a.rank||achievementDay(b.track).localeCompare(achievementDay(a.track))||String(a.track.code).localeCompare(String(b.track.code)))
      .slice(0,FEATURED_ACHIEVEMENT_LIMIT).map(({track,rank})=>({code:track.code,rank}));
    const items=choices.slice(0,FEATURED_ACHIEVEMENT_LIMIT).map(item=>{
      const code=String(item?.code||''),track=tracks.get(code),reported=Number(item?.rank),rank=Math.max(Number.isInteger(reported)&&reported>0?reported:0,Number(track?.level)||achievementLevel(track||{}));
      if(!code||!track||!rank)return null;
      const tier=achievementTierAt(code,rank),value=achievementValue(track),medalTrack={...track,level:rank,_sharedAchievement:true};
      return tier&&value?{track:medalTrack}:null;
    }).filter(Boolean);
    const href=sharedLogin?`/people/${encodeURIComponent(sharedLogin)}?view=achievements`:'/me/achievements';
    if(!items.length)return sharedLogin?'':`<a class="linkbtn me-featured-empty-entry" href="${esc(href)}">Achievements ›</a>`;
    const heading=`<h3 class="me-featured-title" data-type="secondary"><span>Featured achievements</span><a href="${esc(href)}">See all</a></h3>`;
    const rail=`<div class="profile-achievement-list" role="list" aria-label="Featured achievements">${items.map(item=>sharedAchievementRow(item.track,sharedLogin,{featured:true})).join('')}</div>`;
    return `<div class="me-featured-achievements" role="group" aria-label="Featured achievements">${heading}${rail}</div>`;
  }
  function addAchievementCleanup(root,cleanup){
    const previous=viewResources.get(root);
    viewResources.set(root,Object.assign(()=>{cleanup();previous?.();},{keepVisual:previous?.keepVisual}));
  }
  function syncMeCardOpenLink(card){
    const link=card?.querySelector('.me-card-open-link');if(!link)return;
    const featured=card.querySelector('.me-featured-achievements');
    if(!featured){link.style.height='100%';return;}
    const cardTop=card.getBoundingClientRect().top,featuredTop=featured.getBoundingClientRect().top;
    link.style.height=`${Math.max(0,featuredTop-cardTop-8)}px`;
  }
  function watchMeCardOpenLink(root,card,featureSlot){
    if(!card?.querySelector('.me-card-open-link')||!featureSlot||watchedOpenProfileCards.has(card))return;
    watchedOpenProfileCards.add(card);
    const sync=()=>syncMeCardOpenLink(card),resize=new ResizeObserver(sync),mutations=new MutationObserver(sync);
    resize.observe(card);resize.observe(featureSlot);mutations.observe(card,{childList:true,subtree:true});sync();
    addAchievementCleanup(root,()=>{resize.disconnect();mutations.disconnect();watchedOpenProfileCards.delete(card);});
  }
  function fitAchievementValues(root){
    if(!root?.querySelectorAll)return;
    const fit=()=>{if(root.isConnected)root.querySelectorAll('.profile-achievement-value').forEach(value=>window.KinettaTextFit.fitElement(value));};
    const observer=new ResizeObserver(fit);observer.observe(root);addAchievementCleanup(root,()=>observer.disconnect());fit();document.fonts?.ready?.then(fit);
  }
  function wireAchievementPins(box,pinnedCodes){
    if(!box.querySelector('.profile-achievement-list.is-grid'))return;
    const owner=readOwner();
    let press=null,timer=0,suppressClick=false,suppressTimer=0,disposed=false;
    const pinAnchor=target=>{const anchor=target?.closest?.('.profile-achievement');return anchor&&box.contains(anchor)&&anchor.closest('.profile-achievement-list.is-grid')&&anchor.dataset.showcaseEligible==='true'?anchor:null;};
    const clearPress=()=>{clearTimeout(timer);timer=0;press=null;};
    const suppress=()=>{suppressClick=true;clearTimeout(suppressTimer);suppressTimer=setTimeout(()=>{suppressClick=false;},900);};
    const openOptions=anchor=>{
      const code=anchor.dataset.achievementCode,pinned=pinnedCodes.has(code),replace=!pinned&&pinnedCodes.size>=FEATURED_ACHIEVEMENT_LIMIT;
      sheet('Showcase',`<div class="card list"><button type="button" class="row-link" data-showcase-pin-action><span class="grow">${pinned?'Remove from profile':'Pin to profile'}</span>${svg('chev')}</button></div>`,(body,close)=>{
        const button=body.querySelector('[data-showcase-pin-action]');if(!button)return;
        button.onclick=async()=>{
          button.disabled=true;
          try{
            const result=await api('/api/achievements/showcase/pin',json('POST',{code,pinned:!pinned}));
            if(!box.isConnected||owner!==readOwner())return;
            pinnedCodes.clear();for(const item of Array.isArray(result?.pinned)?result.pinned:[])pinnedCodes.add(String(item));
            box.querySelectorAll('.profile-achievement-list.is-grid .profile-achievement').forEach(row=>{
              const active=pinnedCodes.has(row.dataset.achievementCode);row.dataset.showcasePinned=String(active);
              const label=row.getAttribute('aria-label')||'';row.setAttribute('aria-label',label.replace(/, Pinned to profile$/,'')+(active?', Pinned to profile':''));
              row.setAttribute('aria-description',`Long press to ${active?'remove this medal from':'pin this medal to'} your profile.`);
            });
            close();toast(result?.replaced||replace?'Pinned to profile. Oldest pin replaced.':pinned?'Removed from profile.':'Pinned to profile.');
          }catch(error){button.disabled=false;toast(error?.message||'Showcase could not be updated.');}
        };
      });
    };
    const onDown=e=>{
      if(e.button!==0||e.isPrimary===false)return;
      const anchor=pinAnchor(e.target);if(!anchor)return;
      clearPress();press={anchor,id:e.pointerId,x:e.clientX,y:e.clientY,fired:false};
      timer=setTimeout(()=>{if(!press||!press.anchor.isConnected)return;press.fired=true;suppress();openOptions(press.anchor);},520);
    };
    const onMove=e=>{if(!press||e.pointerId!==press.id)return;if(Math.hypot(e.clientX-press.x,e.clientY-press.y)>9)clearPress();};
    const onUp=e=>{if(!press||e.pointerId!==press.id)return;if(press.fired)suppress();clearPress();};
    const onClick=e=>{if(!suppressClick)return;const anchor=pinAnchor(e.target);if(anchor){e.preventDefault();e.stopPropagation();}suppressClick=false;clearTimeout(suppressTimer);};
    const onContext=e=>{const anchor=pinAnchor(e.target);if(anchor){e.preventDefault();suppress();openOptions(anchor);}};
    const onKey=e=>{const anchor=pinAnchor(e.target);if(anchor&&(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)){e.preventDefault();openOptions(anchor);}};
    document.addEventListener('click',onClick,true);box.addEventListener('pointerdown',onDown);document.addEventListener('pointermove',onMove,true);document.addEventListener('pointerup',onUp,true);document.addEventListener('pointercancel',onUp,true);
    box.addEventListener('contextmenu',onContext);box.addEventListener('keydown',onKey);
    const dispose=()=>{if(disposed)return;disposed=true;clearPress();clearTimeout(suppressTimer);document.removeEventListener('click',onClick,true);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('pointerup',onUp,true);document.removeEventListener('pointercancel',onUp,true);box.removeEventListener('pointerdown',onDown);box.removeEventListener('contextmenu',onContext);box.removeEventListener('keydown',onKey);};
    addAchievementCleanup(box,dispose);
  }
  async function mountShowcase(root,r,{shared=false,featured=false}={}){
    if(featured){
      const featureSlot=root?.querySelector?.('[data-me-featured]'),streakSlot=root?.querySelector?.('[data-me-showcase-streak]');
      if(!featureSlot&&!streakSlot)return;
      if(featureSlot?.dataset.loaded==='true'&&(!streakSlot||streakSlot.dataset.loaded==='true'))return;
      if(featureSlot?.dataset.loading==='true')return;
      const sharedProfile=r?.mine===false,login=r?.person?.login||r?.login||'';
      if(sharedProfile&&!login)return;
      const owner=readOwner();if(featureSlot)featureSlot.dataset.loading='true';
      try{
        const query=sharedProfile?`?login=${encodeURIComponent(login)}`:'', [data,_catalog,achievements]=await Promise.all([api('/api/achievements/showcase'+query),loadAchievementCatalog(),api('/api/achievements'+query)]);
        if(!root.isConnected||owner!==readOwner()||featureSlot&&!featureSlot.isConnected||streakSlot&&!streakSlot.isConnected)return;
        if(streakSlot){streakSlot.innerHTML=showcaseStreakMarkup(data);streakSlot.dataset.loaded='true';}
        if(!sharedProfile)achievementLevelUpHaptic(achievementLevelUps(achievements));
        if(featureSlot){const sharedData=sharedProfile?{tracks:sharedAchievementTracks(achievements)}:achievements;featureSlot.innerHTML=featuredShowcaseMarkup(data,sharedData,sharedProfile?{sharedLogin:login}:{});featureSlot.dataset.loading='';featureSlot.dataset.loaded='true';watchMeCardOpenLink(root,featureSlot.closest('.me-card'),featureSlot);}
      }catch(_){if(featureSlot)featureSlot.dataset.loading='';/* Achievements never block the Me card. */}
      return;
    }
    const slot=root?.querySelector?.('[data-me-showcase]');if(!slot)return;
    const owner=readOwner(),login=r?.person?.login||r?.login||App.me?.login;
    const asShared=shared||r?.mine===false,url=asShared&&login?`/api/achievements/showcase?login=${encodeURIComponent(login)}`:'/api/achievements/showcase';
    const ownSharedPreview=shared&&login&&App.me?.login&&String(login).toLowerCase()===String(App.me.login).toLowerCase();
    try{
      const [data,_catalog,sharing]=await Promise.all([api(url),loadAchievementCatalog(),ownSharedPreview?api('/api/sharing'):Promise.resolve(null)]);
      if(!root.isConnected||!slot.isConnected||owner!==readOwner())return;
      slot.innerHTML=showcaseMarkup(ownSharedPreview&&sharing?.share_achievements!==true?{items:[],day_streak:0}:data);
    }catch(_){/* The optional Showcase never blocks its profile card. */}
  }
  function achievementPage(el,requestedCode='',options={}){
    const owner=readOwner(),code=requestedCode?decodeURIComponent(requestedCode):'',sharedLogin=String(options.login||''),shared=!!sharedLogin,profile=options.returnPath||profileHref(App.me),active=()=>el.isConnected&&owner===readOwner(),query=shared?`?login=${encodeURIComponent(sharedLogin)}`:'';
    el.innerHTML=`<div class="top">${backBtn('Profile')}</div><div id="profile-achievement-page" aria-busy="true"><h1>${code?'Achievement history':'Achievements'}</h1><p class="small muted">Loading…</p></div>`;
    wireBack(el,profile,destination=>/^\/me\/achievements(?:\/|\?|$)/.test(destination.path)?'Achievements':'Profile');
    const box=$('#profile-achievement-page',el);
    Promise.all([api('/api/achievements'+query),loadAchievementCatalog(),code?api('/api/achievement-history/'+encodeURIComponent(code)+query):Promise.resolve(null),code?Promise.resolve({}):api('/api/achievements/showcase'+query).catch(()=>({}))]).then(([data,_catalog,historyData,showcase])=>{
      if(!active()||!box.isConnected)return;
      const tracks=shared?sharedAchievementTracks(data):startedAchievements(data),track=code?(tracks.find(t=>t.code===code)||(!shared&&emptyAchievementTrack(code))):null;
      if(code&&!track){box.innerHTML='<h1>Achievements</h1><p class="small muted">This track has no earned tiers yet.</p>';box.setAttribute('aria-busy','false');return;}
      if(!code){
        const levelUps=shared?new Set():achievementLevelUps(data),overviewTracks=shared?tracks:overviewAchievementTracks(data);
        const pinnedCodes=new Set((Array.isArray(showcase?.pinned)?showcase.pinned:[]).map(String)),groups=shared?sharedAchievementGrid(overviewTracks,sharedLogin):achievementGrid(overviewTracks,levelUps,pinnedCodes);
        box.innerHTML=`<h1>Achievements</h1>${groups||'<p class="small muted">No earned achievements yet.</p>'}`;
        fitAchievementValues(box);
        if(!shared){fitAchievementProgress(box);wireAchievementPins(box,pinnedCodes);achievementLevelUpHaptic(levelUps);}
        box.setAttribute('aria-busy','false');return;
      }
      const levelUps=shared?new Set():achievementLevelUps(data),label=track.label||track.code,value=achievementValue(track),next=achievementNext(track),level=achievementLevel(track),current=achievementCurrentTier(track),started=achievementTrackStarted(track);
      const header=shared?`<div class="profile-achievement-history-head" data-achievement-code="${esc(track.code)}">${achievementMedallion(track)}<div class="profile-achievement-history-copy"><h1>Achievement history</h1><p class="profile-achievement-current">${esc(label)} · Level ${level}${current?` · ${esc(current.name)}`:''}</p><p class="profile-achievement-current-value">${esc(value)}</p></div></div>`:`<div class="profile-achievement-history-head${!started?' is-unstarted':''}${levelUps.has(track.code)?' is-level-up':''}" data-achievement-code="${esc(track.code)}">${achievementMedallion(track)}<div class="profile-achievement-history-copy"><h1>${esc(label)}</h1><p class="profile-achievement-current">${started?`Level ${level}${current?` · ${esc(current.name)}`:''}`:'Not started'}</p>${started?`<p class="profile-achievement-current-value">${esc(value)}</p>${next?`<p class="profile-achievement-next-tier">Next · ${esc(next)}</p>`:''}`:''}</div></div>`;
      box.innerHTML=`${header}${shared?sharedAchievementLevelList(track,historyData):achievementLevelList(track,level,historyData)}`;
      if(!shared)wireAchievementLevelList(box,track,level,historyData);
      fitAchievementValues(box);
      fitAchievementProgress(box);
      if(!shared)achievementLevelUpHaptic(levelUps);
      box.setAttribute('aria-busy','false');
    }).catch(error=>{
      if(!active()||!box.isConnected)return;
      box.innerHTML=`<h1>Achievements</h1><p class="small err" role="alert">${esc(error?.message||'Achievements are unavailable.')}</p><button class="ghost" type="button" data-achievement-retry>Try again</button>`;
      box.setAttribute('aria-busy','false');
      $('[data-achievement-retry]',box).onclick=()=>achievementPage(el,requestedCode,options);
    });
  }
  function numbers(row,selected){
    return selected.map(key=>{
      if(key==='activities')return row.activities?stat('Activities',big(row.activities)):'';
      if(key==='distance')return row.distance_m>0?stat('Distance',distance(row.distance_m),U.du()):'';
      if(key==='time')return row.time_s>0?stat('Time',hours(row.time_s)):'';
      return row.active_days?stat('Active days',big(row.active_days)):'';
    }).join('');
  }
  function content(r,value=r.layout){
    const layout=normalize(value),any=!!r.overview?.activities;
    return layout.sections.map(section=>{
      if(section==='recent'){
        if(!any||!r.recent)return '';
        const recent=r.recent,now=recent.current,figures=numbers(now,layout.stats);
        return `<section class="card profile-progress"><h2>Last 30 days</h2><p class="small muted">${esc(fdate(recent.start+'T12:00',{month:'short',day:'numeric'}))} – ${esc(fdate(recent.end+'T12:00',{month:'short',day:'numeric'}))}</p>${figures?`<div class="profile-stats">${figures}</div>`:'<p class="small muted">No recorded values for these statistics.</p>'}<p class="small muted">${now.active_days} active ${now.active_days===1?'day':'days'} · ${recent.previous.activities} activities in the previous 30 days</p></section>`;
      }
      if(section==='mileage')return any?'<section class="card profile-mileage" data-profile-mileage aria-label="Shared distance chart"></section>':'';
      if(section==='totals'){
        const figures=any?numbers(r.overview,layout.stats):'';
        return figures?`<section class="card"><h2>All-time shared progress</h2><div class="profile-stats">${figures}</div></section>`:'';
      }
      if(section==='sports'){
        const rows=layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(row=>row.sport===s)).filter(Boolean):(r.sports||[]);
        return rows.length?`<section class="card"><h2>Sports</h2><div class="sport-overview">${rows.map(s=>`<div class="row"><b>${esc(SPORT_NAMES[s.sport]||s.sport)}</b><span class="num">${s.activities} ${s.activities===1?'activity':'activities'} · ${s.distance_m>0?U.dist(s.distance_m)+' '+U.du():dur(s.time_s,true)}</span></div>`).join('')}</div></section>`:'';
      }
      return `<section class="profile-activities"><h2 class="sec-head">Shared activities</h2><div class="feed-list" id="person-activities">${r.items.length?r.items.map(a=>postCard(a)).join(''):`<div class="card empty"><b>No shared activities yet</b>${r.mine?'Choose an activity and change its audience to share it.' : 'No activities shared with you.'}${r.mine?`<a class="ghost wide" href="${profileHref(App.me)}">Choose an activity</a>`:''}</div>`}</div><button type="button" class="ghost wide" id="person-more"${r.next?'':' hidden'}>Show more</button></section>`;
    }).join('');
  }
  function mount(box,r){
    const chart=box.querySelector('[data-profile-mileage]');
    if(chart)mileageChart(chart,r.mileage||{},'days',{shared:true});
    mountShowcase(box,r,{featured:r?.mine===false});feedMaps(box);wireCheers(box);
  }
  return {defaults,normalize,singlePeriod,numbers,content,mount,mountShowcase,featuredOptions,distance,hours,labels:{sections,stats},sports,achievementPage};
})();

// Me leads with the card friends see, then a private dashboard (owner-approved mockup, 29 October 2026). The card uses the
// same server-filtered friend preview as the shared profile; Edit changes its sections in place.
const MeCard=(()=>{
  const firstName=me=>(me.name||'').trim().split(/\s+/)[0]||me.login;
  const short=d=>fdate(d+'T12:00',{month:'short',day:'numeric'});
  // The card itself, shared by Me and every profile page (Ben, 30 Oct 2026: the full profile is this card at full size,
  // then the shared activities). Friends shares the handle row without changing its audience or destination.
  function card(p,{viewer='friend',pills='',friends='',link=false,milestones=false,showBio=true}={}){
    if(!['owner','friend','preview'].includes(viewer))throw new TypeError(`Unknown profile viewer: ${viewer}`);
    const mine=viewer==='owner';
    const bio=showBio?(p.bio||'').trim():'',photo=avatar(p,'lg'),name=esc(p.name||p.login),handle=`<span data-type="secondary">@${esc(p.login)}</span>`;
    const showcase=mine?'<span class="me-showcase-streak-slot" data-me-showcase-streak></span>':viewer==='friend'||viewer==='preview'?'':'<span class="me-showcase-slot" data-me-showcase></span>';
    const preview=mine&&location.pathname==='/me'?`<div class="me-card-preview-row"><button type="button" class="me-card-preview-action" data-card-preview>${svg('people')}View as friend</button></div>`:'';
    const initials=((p.name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?');
    const identity=link
      ? `<span class="me-card-profile-link"><span class="me-card-avatar">${photo}</span><span class="me-card-name"><span class="me-card-name-heading"><h2>${name}</h2><span class="me-profile-chevron" aria-hidden="true">${svg('chev')}</span></span>${showcase}<span class="me-card-meta">${handle}</span></span></span>${friends}`
      : `<span class="me-card-avatar">${photo}</span><div class="me-card-name"><h2>${name}</h2>${showcase}<div class="me-card-meta">${handle}${friends}</div></div>`;
    const openProfile=link?`<a class="me-card-open-link" href="${profileHref(p)}" aria-label="Open my profile"></a>`:'';
    return `<section class="me-card${link?' me-card-open':''}" aria-label="${mine?'Your profile card':esc(p.name||p.login)+'’s profile card'}">${openProfile}<div class="me-card-banner">${pills}</div>
      <div class="me-card-body"><div class="me-card-id${link?' me-card-id-link':''}">${identity}</div>${preview}
        ${bio?bio.length>140?`<details class="me-about"><summary>About me</summary><p>${esc(bio)}</p></details>`:`<p class="me-profile-bio">${esc(bio)}</p>`:''}
        <div class="me-card-sections" aria-busy="true">${skel(1)}</div>${featured?'<div class="me-featured-slot" data-me-featured></div>':''}
        ${milestones?'<div data-me-milestones hidden></div>':''}</div></section>`;
  }
  const paintBars=box=>$$('.me-card-bars span[data-h]',box).forEach(bar=>bar.style.height=(bar.dataset.h==='0'?'0':Math.max(4,bar.dataset.h*5))+'px');
  let openingShare=false,openingPreview=false;
  async function shareSheet(){
    if(openingShare)return;openingShare=true;const owner=readOwner(),login=App.me.login;
    try{
      const profileLink=`${appBase()}${profileHref(App.me)}`;
      const [profile,sharing,showcase,achievements,cardItems]=await Promise.all([api('/api/people/'+encodeURIComponent(login)+'/profile?as_friend=true&preview=member&limit=1'),api('/api/sharing').catch(()=>({share_achievements:false})),api('/api/achievements/showcase').catch(()=>({items:[]})),api('/api/achievements').catch(()=>({tracks:[]})),KinettaCard.shareItems(profileLink).catch(()=>[])]);
      if(owner!==readOwner())return;
      if(profile.profile_hidden)throw Error('Your profile is hidden until your account is confirmed and active.');
      if(profile.preview!=='member')throw Error('The preview needs a server update.');
      const items=cardItems.slice(0,1);
      if(sharing.share_achievements&&showcase.items?.length){
        const featured=await ProfileLayout.featuredOptions(achievements,showcase.items);if(owner!==readOwner())return;
        if(featured.length)items.push({label:'Achievements',filename:'kinetta-achievements.png',controls:[{key:'identity',label:'Photo and username',checked:false}],build:state=>ShareArt.simplePicture({kicker:'Achievements',title:'Your progress',value:String(featured.length),unit:'featured',facts:featured.map(item=>`${item.label} · ${item.detail}`),identity:!!state.identity})});
      }
      if(typeof weeklyRecapShareItem==='function'){const week=await weeklyRecapShareItem().catch(()=>null);if(owner!==readOwner())return;if(week)items.push(week);}
      const meCard=items.find(item=>item.label==='Me card');if(meCard){meCard.note='Private workouts count, but stay hidden';meCard.description='Totals include your private workouts. Friends see the totals, not the workouts.';}
      ShareSheet.open({items});
    }catch(error){if(owner===readOwner())toast(error.message||'Couldn’t prepare your pictures.');}
    finally{openingShare=false;}
  }
  function viewAsFriend(){
    if(openingPreview)return;openingPreview=true;
    const owner=readOwner(),login=String(App.me?.login||'');
    const load=async host=>{
      if(!host?.isConnected)return;
      host.setAttribute('aria-busy','true');host.innerHTML='<p class="small muted" role="status">Loading your shared profile…</p>';
      try{
        const profile=await api('/api/people/'+encodeURIComponent(login)+'/profile?as_friend=true&preview=member&limit=1');
        if(!host.isConnected||owner!==readOwner())return;
        if(profile.profile_hidden)throw Error('Your profile is hidden until your account is confirmed and active.');
        if(profile.preview!=='member')throw Error('The shared profile preview is unavailable.');
        const view={...profile,mine:false},friends=Number.isInteger(profile.friend_count)?`<span class="me-friends-link">${svg('people')}<span>${friendCountText(profile.friend_count)}</span></span>`:'';
        host.innerHTML=card(profile.person,{viewer:'preview',friends,showBio:true});
        mount(host,{data:view,viewer:'preview',mode:'profile'});ProfileLayout.mount(host,view);host.setAttribute('aria-busy','false');
      }catch(error){
        if(!host.isConnected||owner!==readOwner())return;
        host.innerHTML=`<p class="small err" role="alert">${esc(error?.message||'Your shared profile could not load.')}</p><button type="button" class="linkbtn" data-profile-preview-retry>Try again</button>`;
        $('[data-profile-preview-retry]',host).onclick=()=>load(host);
      }finally{openingPreview=false;}
    };
    sheet('This is what friends see','<div class="me-friend-preview" data-profile-preview aria-busy="true"><p class="small muted" role="status">Loading your shared profile…</p></div>',body=>load($('[data-profile-preview]',body)));
  }
  const ownPills=()=>`<button type="button" class="me-card-pill" data-card-edit>${svg('edit')}Edit</button><button type="button" class="me-card-pill" data-card-share aria-label="Share your profile">${svg('share')}</button>`;
  function ownFriends(count){
    const pending=Number.isInteger(App.me.friend_requests)?App.me.friend_requests:0;
    return `<a class="me-friends-link" href="/me/friends"><span class="me-friends-count"><span data-friend-count>${Number.isInteger(count)?friendCountText(count):'Friends'}</span>${svg('chev')}</span><span class="badge alert" data-friend-waiting${pending?'':' hidden'}>${pending} waiting</span></a>`;
  }
  function header(me){
    return `<header class="me-top"><h1>Hi, ${esc(firstName(me))}</h1><div class="me-profile-tools"><a class="icon-btn" href="/me/settings" aria-label="Settings">${svg('settings')}</a></div></header>
    ${card(me,{viewer:'owner',link:true,pills:ownPills(),friends:ownFriends(me.friend_count),milestones:true,showBio:false})}`;
  }
  // One distance chart, on the card, with a tiny Days / Weeks switch (Ben, 30 Oct 2026: no second chart below it).
  // Every bar is a button: tapping shows that period's range and distance; tap again restores the current period.
  let period='weeks';
  function distance(r){
    const weekly=period==='weeks',mileage=r.mileage||{},rows=(weekly?mileage.weeks:mileage.days)||[],visible=rows.slice(-(weekly?12:14)),top=Math.max(0,...visible.map(w=>w.distance_m||0));
    if(!(r.mileage?.weeks||[]).some(w=>w.distance_m>0))return '';
    const day=d=>fdate(d+'T12:00',{month:'short',day:'numeric'}),dist=w=>`${U.dist(w.distance_m||0,1)} ${U.du()}`;
    const when=w=>weekly?`${day(w.d)}–${day(w.end)}`:fdate(w.d+'T12:00',{weekday:'short',month:'short',day:'numeric'});
    const value=w=>dist(w),letter=w=>fdate(w.d+'T12:00',{weekday:'narrow'}),current=visible.find(w=>w.today)||visible.at(-1)||{distance_m:0},currentLabel=weekly?'This week':'Today';
    const toggle=`<div class="mileage-toggle me-period" role="group" aria-label="Distance chart period">${[['days','Days'],['weeks','Weeks']].map(([k,l])=>`<button type="button" data-period="${k}" aria-pressed="${period===k}"${k==='weeks'&&!r.mileage?.weeks?' disabled':''}>${l}</button>`).join('')}</div>`;
    return `<div class="me-card-sec me-distance${weekly?'':' days'}"><div class="me-card-head"><div class="me-card-label" data-week-label aria-live="polite"><span>${currentLabel}</span><small>${esc(value(current))}</small></div>${toggle}</div>
      <div class="me-chart-scroll"><div class="me-card-bars" role="group" aria-label="${weekly?'Weekly distance, last 12 weeks':'Daily distance, last 14 days'}">${visible.map(w=>{const zero=!(w.distance_m>0),h=zero?0:Math.max(1,Math.round((w.distance_m||0)/top*10));return `<button type="button" class="me-week${w.today?' now':''}${zero?' zero':''}" aria-pressed="false" data-range="${esc(when(w))}" data-dist="${esc(value(w))}" aria-label="${esc((w.today?(weekly?'This week, ':'Today, '):'')+when(w)+': '+value(w))}"><span data-h="${h}"></span>${weekly?'':`<i aria-hidden="true">${esc(letter(w))}</i>`}</button>`;}).join('')}</div></div></div>`;
  }
  function weekMetrics(row){
    const distance=Number(row.distance_m)||0,workouts=Number(row.activities)||0,time=Number(row.time_s)||0;
    return {distance:distance>0?U.dist(distance,1):'0',activities:workouts.toLocaleString(),time:time>0?U.time(time):'0m'};
  }
  function weeklyCard(r){
    if(!r.overview?.activities&&!r.shared_count)return `<div class="me-card-empty"><p>${r.mine===false?'No workouts to show yet.':'Your totals appear here once you have workouts.'}</p>${r.mine===false?"":'<a class="ghost wide" href="/me/goals?new=1">Set a goal</a>'}</div><div class="me-featured-slot" data-me-featured></div>`;
    const weeks=(r.mileage?.weeks||[]).slice(-12),current=weeks.find(w=>w.today)||weeks.at(-1)||{distance_m:0,activities:0,time_s:0},values=weekMetrics(current);
    const month=(week,index)=>{
      const start=new Date(week.d+'T12:00'),end=new Date((week.end||week.d)+'T12:00');
      if(index===0)return start.toLocaleDateString([],{month:'short'});
      for(const day=new Date(start);day<=end;day.setDate(day.getDate()+1))if(day.getDate()===1)return day.toLocaleDateString([],{month:'short'});
      return '';
    };
    const day=d=>fdate(d+'T12:00',{month:'short',day:'numeric'}),streak=Number(r.week_streak);
    const closeTo=typeof r.close_to==='string'&&r.close_to.trim()?`<p class="me-card-close-to small muted" data-close-to><span class="me-owner-only" data-type="secondary">Only you</span><span>${esc(r.close_to)}</span></p>`:'';
    const chart=weeks.length?`<div class="me-chart-scroll"><div class="me-card-bars" role="group" aria-label="Weekly distance, last 12 weeks">${weeks.map((w,i)=>{
      const zero=!(Number(w.distance_m)>0),h=zero?0:Math.max(1,Math.round(Number(w.distance_m)/Math.max(1,...weeks.map(row=>Number(row.distance_m)||0))*10)),label=w.today?'This week':`Week of ${day(w.d)}`,axisMonth=month(w,i),value=weekMetrics(w),aria=`${label}${axisMonth?`, ${axisMonth}`:''}: ${value.distance} ${U.du()}, ${value.activities} ${value.activities==='1'?'workout':'workouts'}, ${value.time}`;
      return `<button type="button" class="me-week${w.today?' now':''}${zero?' zero':''}" aria-pressed="false" data-range="${esc(w.d)}" data-distance="${esc(w.distance_m||0)}" data-activities="${esc(w.activities||0)}" data-time="${esc(w.time_s||0)}" data-current="${w.today?'true':'false'}" aria-label="${esc(aria)}"><span data-h="${h}"></span><span class="me-week-month" data-type="chart" aria-hidden="true">${esc(axisMonth)}</span></button>`;
    }).join('')}</div></div>`:'';
    const streakSlot=Number.isInteger(streak)&&streak>=2?`<span class="me-week-streak" data-week-streak="${streak}" role="img" aria-label="${streak}-week activity streak. Only you can see this.">${svg('flame')}<span aria-hidden="true">${streak}-week streak</span><span class="me-owner-only" data-type="secondary">Only you</span></span>`:'';
    return `<div class="me-card-sec me-card-weekly"><div class="me-card-head"><div class="me-card-label" data-week-label aria-live="polite"><span>This week</span></div>${streakSlot}</div>
      <dl class="me-card-numbers me-numbers-3"><div data-week-stat="distance"><dd><b class="me-metric-value" data-type="stat" data-week-value="distance">${esc(values.distance)}</b></dd><dt data-type="secondary">Distance <small>(${esc(U.du())})</small></dt></div><div data-week-stat="activities"><dd><b class="me-metric-value" data-type="stat" data-week-value="activities">${esc(values.activities)}</b></dd><dt data-type="secondary">Workouts</dt></div><div data-week-stat="time"><dd><b class="me-metric-value" data-type="stat" data-week-value="time">${esc(values.time)}</b></dd><dt data-type="secondary">Time</dt></div></dl>
      ${chart}${closeTo}</div><div class="me-featured-slot" data-me-featured></div>`;
  }
  function sections(r,layout,full){
    if(!r.overview?.activities&&!r.shared_count)return `<div class="me-card-empty"><p>${r.mine===false?'No workouts to show yet.':'Your totals appear here once you have workouts.'}</p>${r.mine===false||full?'':'<a class="ghost wide" href="/me/goals?new=1">Set a goal</a>'}</div>`;
    const figures=key=>{
      const recent=key==='recent',row=(recent?r.recent?.current:r.overview)||{},name=recent?'Last 30 days':'All time',range=recent&&r.recent?.start?`${name}, ${short(r.recent.start)} – ${short(r.recent.end)}`:name;
      return `<div class="me-card-sec me-card-figures" role="group" data-card-period="${key}" aria-label="${esc(range)} workout totals"><p class="me-card-period" data-type="secondary" title="${esc(range)}">${name}</p><dl class="me-card-numbers me-numbers-${layout.stats.length}">${layout.stats.map(stat=>{
        const n=row[{activities:'activities',distance:'distance_m',time:'time_s',active_days:'active_days'}[stat]],unit=stat==='distance'?U.du():stat==='time'?'h':'',precise=stat==='time'&&n!=null?dur(n,true):null;let value=n==null?'—':stat==='distance'?ProfileLayout.distance(n):Number(n).toLocaleString();
        if(precise){const h=n/3600;value=h>0&&h<.005?'<0.01':(h>=100?Math.floor(h):h).toLocaleString(undefined,{maximumFractionDigits:h>=100?0:h>=1?1:2});}
        return `<div data-card-stat="${stat}"><dt data-type="secondary"><span>${ProfileLayout.labels.stats[stat]}</span>${unit?` <small>(${esc(unit)})</small>`:''}</dt><dd${precise?` title="${esc(precise)}"`:''}><b class="me-metric-value" data-type="stat"${precise?' aria-hidden="true"':''}>${esc(value)}</b>${precise?`<span class="vh">${esc(precise)}</span>`:''}</dd></div>`;
      }).join('')}</dl></div>`;
    };
    return ProfileLayout.singlePeriod(layout).sections.map(key=>{
      if(key==='recent'||key==='totals')return figures(key);
      if(key==='mileage')return distance(r);
      if(key==='sports'){
        const rows=layout.sports.length?layout.sports.map(s=>(r.sports||[]).find(x=>x.sport===s)).filter(Boolean):[...(r.sports||[])].sort((a,b)=>b.activities-a.activities);
        return rows.length?`<div class="me-card-sec"><div class="me-sport-chips" role="group" aria-label="Sports totals">${rows.map(x=>`<span class="me-sport-chip"><span class="me-sport-ico" data-sport="${esc(x.sport)}" aria-hidden="true">${svg(SPORT_NAMES[x.sport]?x.sport:'other')}</span>${esc(SPORT_NAMES[x.sport]||x.sport)} · ${esc(Number(x.activities).toLocaleString())}</span>`).join('')}<span class="me-sport-more" data-type="secondary" hidden></span></div></div>`:'';
      }
      return '';
    }).join('');
  }
  function profileView(data,{viewer,mode='profile'}={}){
    if(!['owner','friend','preview'].includes(viewer))throw new TypeError(`Unknown profile viewer: ${viewer}`);
    if(!['landing','profile'].includes(mode))throw new TypeError(`Unknown profile mode: ${mode}`);
    const owner=viewer==='owner';
    if(mode==='landing'&&!owner)throw new TypeError('Only the owner can render the Me landing view.');
    const shared=owner?data:(()=>{const{week_streak,close_to,...payload}=data;return{...payload,mine:false};})();
    const layout=ProfileLayout.normalize(owner?App.me?.profile_layout||shared.layout:shared.layout);
    return {html:mode==='landing'?weeklyCard(shared):sections(shared,layout,true),owner,landing:mode==='landing'};
  }
  function fitSports(rail){
    const chips=$$('.me-sport-chip',rail),more=$('.me-sport-more',rail);let count=Math.min(3,chips.length);chips.forEach((n,i)=>n.hidden=i>=count);more.hidden=count===chips.length;if(!more.hidden)more.textContent='+'+(chips.length-count);
    const fits=()=>{const a=rail.getBoundingClientRect(),b=(more.hidden?chips.at(-1):more).getBoundingClientRect();return b.left>=a.left-.01&&b.right<=a.right+.01;};
    // Reserve the omitted-count label too; never leave a partial sport at either edge.
    while(count&&!fits()){chips[--count].hidden=true;more.hidden=false;more.textContent='+'+(chips.length-count);}
    if(count<chips.length){const n=chips.length-count,names=chips.slice(count).map(x=>x.textContent.trim()).join(', ');more.title=names;more.innerHTML=`<span aria-hidden="true">+${n}</span><span class="vh">${n} more ${n===1?'sport':'sports'}: ${esc(names)}</span>`;}
  }
  // Profile data is composed once for the explicit viewer; shared views cannot read owner-only weekly stats.
  function mount(root,{reload,data:given=null,viewer='owner',mode='landing',onSaved,onEditEnd,editOnLoad=false}={}){
    if(!['owner','friend','preview'].includes(viewer))throw new TypeError(`Unknown profile viewer: ${viewer}`);
    if(!['landing','profile'].includes(mode))throw new TypeError(`Unknown profile mode: ${mode}`);
    const ownerView=viewer==='owner';
    const owner=readOwner(),card=$('.me-card',root),box=$('.me-card-sections',card),live=()=>card.isConnected&&owner===readOwner();
    let data=given,editing=false,editRevision=0,chartCleanup=()=>{};
    const chartPositions=new Map();
    function chartScroll(){
      chartCleanup();
      const summaries=$$('.me-sport-chips',box).map(rail=>{
        let resized=0,cleaned=false;const update=()=>{if(!cleaned&&live()&&rail.isConnected)fitSports(rail);};
        const observer=new ResizeObserver(()=>{cancelAnimationFrame(resized);resized=requestAnimationFrame(update);});[rail,...rail.children].forEach(n=>observer.observe(n));update();
        const cleanup=()=>{if(cleaned)return;cleaned=true;cancelAnimationFrame(resized);observer.disconnect();viewResources.delete(rail);};viewResources.set(rail,cleanup);return cleanup;
      });
      const clearSummaries=()=>summaries.forEach(clean=>clean());
      chartCleanup=clearSummaries;const wrap=$('.me-card-bars',box);if(!wrap)return;
      const frame=wrap.parentElement,distance=wrap.closest('.me-distance'),mode=distance?.classList.contains('days')?'days':'weeks',saved=chartPositions.get(mode);let atEnd=false,cleaned=false;
      const update=()=>{if(!live()||!wrap.isConnected)return;const max=wrap.scrollWidth-wrap.clientWidth;atEnd=max-wrap.scrollLeft<1;frame.classList.toggle('has-before',wrap.scrollLeft>1);frame.classList.toggle('has-after',!atEnd);chartPositions.set(mode,wrap.scrollLeft);};
      const reveal=b=>{if(!b)return;const r=b.getBoundingClientRect(),left=r.left-wrap.getBoundingClientRect().left+wrap.scrollLeft;if(left<wrap.scrollLeft+4)wrap.scrollLeft=left-4;else if(left+r.width>wrap.scrollLeft+wrap.clientWidth-4)wrap.scrollLeft=left+r.width-wrap.clientWidth+4;};
      const focused=e=>{const b=e.target.closest('.me-week');if(b){reveal(b);update();}};
      wrap.addEventListener('scroll',update,{passive:true});wrap.addEventListener('focusin',focused);
      const observer=new ResizeObserver(()=>{if(!live()||!wrap.isConnected)return;if(atEnd)wrap.scrollLeft=wrap.scrollWidth;update();});observer.observe(wrap);
      const initial=requestAnimationFrame(()=>{if(!live()||!wrap.isConnected)return;if(saved!==undefined)wrap.scrollLeft=saved;else if(mode==='weeks')wrap.scrollLeft=wrap.scrollWidth;else reveal($('.me-week.now',wrap));update();});
      chartCleanup=()=>{if(cleaned)return;cleaned=true;clearSummaries();chartPositions.set(mode,wrap.scrollLeft);cancelAnimationFrame(initial);observer.disconnect();wrap.removeEventListener('scroll',update);wrap.removeEventListener('focusin',focused);viewResources.delete(wrap);};
      viewResources.set(wrap,chartCleanup);
    }
    const bars=()=>{paintBars(box);chartScroll();}; // CSP blocks inline style attributes
    // The heading swaps to the picked period's dates and distance, so the layout never shifts; tap again for the total.
    const weekTaps=()=>{const wrap=$('.me-card-bars',box),label=$('[data-week-label]',box);if(!wrap||!label)return;const [head,side]=[$('span',label),$('small',label)],[h0,s0]=[head.textContent,side.textContent];
      let pointer=null,ignorePointerClick=false,ignoreTimer=0;
      const selected=()=>$('.me-week[aria-pressed="true"]',wrap);
      const show=b=>{const prior=selected();if(prior===b)return false;$$('.me-week',wrap).forEach(x=>x.setAttribute('aria-pressed','false'));if(b)b.setAttribute('aria-pressed','true');
        head.textContent=b?b.dataset.range:h0;side.textContent=b?b.dataset.dist:s0;label.classList.toggle('picked',!!b);Native.haptic('light');return true;};
      const barAt=e=>{const shift=pointer.start.getBoundingClientRect().top-pointer.startTop;return document.elementFromPoint(e.clientX,e.clientY+shift)?.closest('.me-week');};
      const onDown=e=>{if(e.button!==0||e.isPrimary===false)return;const b=e.target.closest('.me-week');if(!b)return;pointer={id:e.pointerId,start:b,startTop:b.getBoundingClientRect().top,wasSelected:selected()===b,moved:false};if(!pointer.wasSelected)show(b);document.addEventListener('pointermove',onMove,true);document.addEventListener('pointerup',onUp,true);document.addEventListener('pointercancel',onCancel,true);};
      const onMove=e=>{if(!pointer||e.pointerId!==pointer.id)return;const b=barAt(e);if(!b)return;if(b!==pointer.start)pointer.moved=true;show(b);};
      const finish=(e,cancelled=false)=>{if(!pointer||e.pointerId!==pointer.id)return;const gesture=pointer,end=barAt(e);if(!cancelled&&!gesture.moved&&gesture.wasSelected&&end===gesture.start)show(null);pointer=null;ignorePointerClick=!cancelled;clearTimeout(ignoreTimer);if(ignorePointerClick)ignoreTimer=setTimeout(()=>{ignorePointerClick=false;},0);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('pointerup',onUp,true);document.removeEventListener('pointercancel',onCancel,true);};
      const onUp=e=>finish(e),onCancel=e=>finish(e,true);
      wrap.addEventListener('pointerdown',onDown);
      wrap.onclick=e=>{if(ignorePointerClick){ignorePointerClick=false;clearTimeout(ignoreTimer);return;}const b=e.target.closest('.me-week');if(b)show(selected()===b?null:b);};
      const cleanup=chartCleanup,dispose=()=>{cleanup();wrap.removeEventListener('pointerdown',onDown);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('pointerup',onUp,true);document.removeEventListener('pointercancel',onCancel,true);clearTimeout(ignoreTimer);};chartCleanup=dispose;viewResources.set(wrap,dispose);};
    const weeklyTaps=()=>{
      const wrap=$('.me-card-bars',box),label=$('[data-week-label]',box);if(!wrap||!label)return;
      const head=$('span',label),initial=Object.fromEntries($$('[data-week-stat]',box).map(n=>[n.dataset.weekStat,$('[data-week-value]',n).textContent]));
      let pointer=null,ignorePointerClick=false,ignoreTimer=0;
      const selected=()=>$('.me-week[aria-pressed="true"]',wrap);
      const values=row=>weekMetrics(row);
      const put=row=>{const next=row?values(row):initial;for(const key of ['distance','activities','time'])$(`[data-week-value="${key}"]`,box).textContent=next[key];};
      const show=(button,haptic=true)=>{const prior=selected();if(prior===button)return false;$$('.me-week',wrap).forEach(n=>n.setAttribute('aria-pressed','false'));if(button)button.setAttribute('aria-pressed','true');
        head.textContent=button&&button.dataset.current!=='true'?`${short(button.dataset.range)} week`:'This week';label.classList.toggle('picked',!!button);put(button?{distance_m:Number(button.dataset.distance),activities:Number(button.dataset.activities),time_s:Number(button.dataset.time)}:null);if(button&&haptic)Native.haptic('light');return true;};
      const barAt=e=>{const shift=pointer.start.getBoundingClientRect().top-pointer.startTop;return document.elementFromPoint(e.clientX,e.clientY+shift)?.closest('.me-week');};
      const onDown=e=>{if(e.button!==0||e.isPrimary===false)return;const button=e.target.closest('.me-week');if(!button)return;pointer={id:e.pointerId,start:button,startTop:button.getBoundingClientRect().top,moved:false};show(button);document.addEventListener('pointermove',onMove,true);document.addEventListener('pointerup',onUp,true);document.addEventListener('pointercancel',onCancel,true);};
      const onMove=e=>{if(!pointer||e.pointerId!==pointer.id)return;const button=barAt(e);if(button&&button!==pointer.start)pointer.moved=true;if(button)show(button);};
      const finish=(e,cancelled=false)=>{if(!pointer||e.pointerId!==pointer.id)return;pointer=null;ignorePointerClick=!cancelled;clearTimeout(ignoreTimer);if(ignorePointerClick)ignoreTimer=setTimeout(()=>{ignorePointerClick=false;},0);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('pointerup',onUp,true);document.removeEventListener('pointercancel',onCancel,true);};
      const onUp=e=>finish(e),onCancel=e=>finish(e,true);
      const outside=e=>{if(selected()&&!wrap.contains(e.target))show(null,false);};
      const onClick=e=>{if(ignorePointerClick){ignorePointerClick=false;clearTimeout(ignoreTimer);return;}const button=e.target.closest('.me-week');if(button)show(selected()===button?null:button);};
      wrap.addEventListener('pointerdown',onDown);wrap.addEventListener('click',onClick);
      document.addEventListener('click',outside,true);
      const cleanup=chartCleanup,dispose=()=>{cleanup();wrap.removeEventListener('pointerdown',onDown);wrap.removeEventListener('click',onClick);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('pointerup',onUp,true);document.removeEventListener('pointercancel',onCancel,true);document.removeEventListener('click',outside,true);clearTimeout(ignoreTimer);};chartCleanup=dispose;viewResources.set(wrap,dispose);
    };
    const periods=()=>$$('[data-period]',box).forEach(b=>b.onclick=()=>{if(b.dataset.period===period)return;period=b.dataset.period;draw();$(`[data-period="${period}"]`,box)?.focus({preventScroll:true});});
    const draw=()=>{if(!live()||editing||!data)return;chartCleanup();const view=profileView(data,{viewer,mode});box.setAttribute('aria-busy','false');box.innerHTML=view.html;bars();if(view.landing){weeklyTaps();ProfileLayout.mountShowcase(root,data,{featured:true});}else{weekTaps();periods();}};
    const loadCard=async()=>{
      try{
        if(!ownerView)throw new TypeError('A shared profile view requires its filtered profile payload.');
        const profileRead=api('/api/people/'+encodeURIComponent(App.me.login)+'/profile?as_friend=true&preview=friend&limit=1');
        const statsRead=mode==='landing'?load('/api/stats',()=>{}).catch(()=>null):Promise.resolve(null);
        const [profile,stats]=await Promise.all([profileRead,statsRead]);
        if(!live())return;
        data=stats?{...profile,week_streak:stats.week_streak,close_to:stats.close_to}:profile;draw();
        if(editOnLoad&&live()){editOnLoad=false;edit({focusName:true,fromSettings:true});}
      }
      catch(x){if(!live()||editing)return;box.setAttribute('aria-busy','false');box.innerHTML=`<p class="small muted">Your card’s numbers couldn’t load.</p><button type="button" class="ghost wide" data-card-retry>Try again</button>`;$('[data-card-retry]',box).onclick=()=>{box.innerHTML=skel(1);loadCard();};}
    };
    const dim=on=>{
      const page=root.parentElement;card.classList.toggle('editing',on);$('.me-card-banner',card).classList.toggle('hidden-tools',on);
      [...$$(':scope>:not(.me-card):not(.me-top)',root),...[...page.children].filter(x=>x!==root)].forEach(x=>{x.inert=on;x.classList.toggle('me-dim',on);});
    };
    function edit({focusName=false,fromSettings=false}={}){
      if(!live()||editing)return;chartCleanup();editing=true;dim(true);
      const revision=++editRevision,valid=()=>live()&&editing&&revision===editRevision;
      const start={name:App.me.name||'',bio:App.me.bio||'',layout:ProfileLayout.singlePeriod(App.me.profile_layout||data?.layout),featuredPins:[]};
      const value=structuredClone(start.layout),{sections:names,stats}=ProfileLayout.labels;
      let chosenPeriod=value.sections.includes('recent')?'recent':'totals',order=[...value.sections,...Object.keys(names).filter(k=>!value.sections.includes(k))].filter(k=>k!=='recent'&&k!=='totals'||k===chosenPeriod),busy=false;
      let featuredTracks=[],featuredPins=[],featuredBusy=false;
      const sectionName=k=>k==='recent'||k==='totals'?'Numbers':names[k];
      const chip=(group,id,label,on)=>`<button type="button" class="me-chip" data-${group}="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      box.innerHTML=`<form class="me-card-editor" novalidate>
        <header class="me-editor-head"><button type="button" class="linkbtn" data-card-cancel>Cancel</button><b>Editing your profile</b><button type="submit" class="linkbtn" data-card-save disabled>Save</button><p class="small muted" role="status" aria-live="polite" data-card-status></p></header>
        <div class="me-editor-identity"><button type="button" class="me-editor-photo" data-card-photo aria-label="Change profile photo">${avatar(App.me,'lg')}<small>Change</small></button>
          <div class="me-editor-fields"><label class="vh" for="card-name">Name</label><input id="card-name" name="name" value="${esc(start.name)}" maxlength="60" autocomplete="name" placeholder="Name" required aria-describedby="card-name-error"><small class="danger" id="card-name-error" role="alert"></small><span class="small muted">@${esc(App.me.login)}</span>
          <label class="vh" for="card-bio">Bio</label><textarea id="card-bio" name="bio" rows="2" maxlength="280" placeholder="Bio" aria-describedby="card-bio-count">${esc(start.bio)}</textarea><div class="me-editor-bio-label"><small class="muted" id="card-bio-count" data-card-bio-count>${start.bio.length}/280</small></div></div></div>
        <p class="small muted me-editor-privacy">Your name, photo and bio are visible to people who find your profile.</p>
        <h3 id="card-period-label">Period</h3><div class="me-chips" data-card-period role="group" aria-labelledby="card-period-label"></div>
        <h3>Sections</h3><div class="me-editor-sections" data-card-sections></div>
        <h3 id="card-featured-label">Featured achievements <span>· up to 4</span></h3><p class="small muted me-editor-featured-note">Choose achievements you've earned. Changes save with your profile; Cancel discards them. Use the arrows to set their order.</p>
        <div class="me-featured-editor" data-featured-list aria-labelledby="card-featured-label" aria-busy="true"><p class="small muted">Loading achievements…</p></div>
        <h3>Headline numbers <span>· up to 3</span></h3><div class="me-chips" data-card-stats></div>
        <h3>Featured sports <span>· up to 3 · none = all</span></h3><div class="me-chips" data-card-sports></div></form>`;
      const form=$('form',box),name=form.elements.name,bio=form.elements.bio,save=$('[data-card-save]',box),status=$('[data-card-status]',box),nameError=$('#card-name-error',box);
      const dirty=()=>name.value!==start.name||bio.value!==start.bio||JSON.stringify(value)!==JSON.stringify(start.layout)||JSON.stringify(featuredPins)!==JSON.stringify(start.featuredPins);
      const changed=text=>{save.disabled=busy||featuredBusy||!dirty();if(text)status.textContent=text;};
      const featuredTarget=$('[data-featured-list]',box),featuredLabel=track=>track.label||track.code;
      const renderFeatured=()=>{
        const byCode=new Map(featuredTracks.map(track=>[track.code,track])),selected=new Set(featuredPins),details=track=>esc(track.detail||'');
        const selectedRows=featuredPins.map((code,index)=>{
          const track=byCode.get(code);if(!track)return '';const label=featuredLabel(track);
          return `<div class="me-featured-row" role="listitem"><button type="button" class="me-featured-choice" data-featured-toggle="${esc(code)}" aria-pressed="true" aria-label="Remove ${esc(label)} from featured achievements"${featuredBusy?' disabled':''}><span class="me-featured-position">${index+1}</span>${track.icon||''}<span class="me-featured-copy"><b>${esc(label)}</b><small>${details(track)}</small></span></button><span class="me-featured-order" role="group" aria-label="Reorder ${esc(label)}"><button type="button" class="icon-btn me-featured-move-up" data-featured-move="${esc(code)}" data-step="-1" aria-label="Move ${esc(label)} up"${index===0||featuredBusy?' disabled':''}>${svg('down')}</button><button type="button" class="icon-btn" data-featured-move="${esc(code)}" data-step="1" aria-label="Move ${esc(label)} down"${index===featuredPins.length-1||featuredBusy?' disabled':''}>${svg('down')}</button></span></div>`;
        }).join('');
        const choices=featuredTracks.filter(track=>!selected.has(track.code)).map(track=>{
          const label=featuredLabel(track),disabled=featuredBusy||featuredPins.length>=FEATURED_ACHIEVEMENT_LIMIT;
          return `<button type="button" class="me-featured-choice" data-featured-toggle="${esc(track.code)}" aria-pressed="false" aria-label="Feature ${esc(label)}"${disabled?' disabled':''}>${track.icon||''}<span class="me-featured-copy"><b>${esc(label)}</b><small>${details(track)}</small></span><span class="me-featured-add">Add</span></button>`;
        }).join('');
        featuredTarget.setAttribute('aria-busy','false');
        if(!featuredTracks.length){featuredTarget.innerHTML='<p class="small muted">No achievements to feature yet.</p>';return;}
        featuredTarget.innerHTML=`${selectedRows?`<div class="me-featured-selected" role="list" aria-label="Featured achievements in order">${selectedRows}</div>`:'<p class="small muted">None featured.</p>'}<div class="me-featured-choices" role="group" aria-label="Choose achievements to feature">${choices}</div>`;
        $$('[data-featured-toggle]',featuredTarget).forEach(button=>button.onclick=()=>{
          if(!valid()||featuredBusy)return;const code=button.dataset.featuredToggle,next=featuredPins.includes(code)?featuredPins.filter(item=>item!==code):featuredPins.length<FEATURED_ACHIEVEMENT_LIMIT?[...featuredPins,code]:null;
          if(next){featuredPins=next;renderFeatured();changed('Featured achievements updated.');}
        });
        $$('[data-featured-move]',featuredTarget).forEach(button=>button.onclick=()=>{
          if(!valid()||featuredBusy)return;const next=[...featuredPins],i=next.indexOf(button.dataset.featuredMove),j=i+Number(button.dataset.step);
          if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];featuredPins=next;renderFeatured();changed('Featured achievements reordered.');
        });
      };
      const loadFeatured=async()=>{
        featuredTarget.setAttribute('aria-busy','true');featuredTarget.innerHTML='<p class="small muted">Loading achievements…</p>';
        try{
          const [data,showcase]=await Promise.all([api('/api/achievements'),api('/api/achievements/showcase')]);if(!valid())return;
          featuredTracks=await ProfileLayout.featuredOptions(data,showcase?.available);if(!valid())return;
          const earned=new Set(featuredTracks.map(track=>track.code));
          featuredPins=(Array.isArray(showcase?.pinned)?showcase.pinned:[]).map(String).filter((code,index,list)=>earned.has(code)&&list.indexOf(code)===index).slice(0,FEATURED_ACHIEVEMENT_LIMIT);
          start.featuredPins=[...featuredPins];renderFeatured();changed();
        }catch(error){
          if(!valid())return;featuredTarget.setAttribute('aria-busy','false');featuredTarget.innerHTML=`<p class="small err" role="alert">${esc(error?.message||'Achievements are unavailable.')} <button type="button" class="linkbtn" data-featured-retry>Try again</button></p>`;
          $('[data-featured-retry]',featuredTarget).onclick=loadFeatured;
        }
      };
      const sizeBio=()=>{bio.style.height='auto';const style=getComputedStyle(bio),line=parseFloat(style.lineHeight)||22,padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;bio.style.height=Math.max(line*2+padding,Math.min(bio.scrollHeight,line*3+padding))+'px';};
      const rows=focus=>{
        $('[data-card-sections]',box).innerHTML=order.map((k,i)=>{const on=value.sections.includes(k);return `<div class="me-edit-row${on?'':' off'}"><label class="me-section-toggle switch-row"><span>${sectionName(k)}</span><input type="checkbox" role="switch" data-show="${k}" aria-label="Show ${sectionName(k)}"${on?' checked':''}></label><button type="button" class="icon-btn" data-move="${k}" data-step="-1" aria-label="Move ${sectionName(k)} up"${i?'':' disabled'}><span class="profile-up">${svg('down')}</span></button><button type="button" class="icon-btn" data-move="${k}" data-step="1" aria-label="Move ${sectionName(k)} down"${i===order.length-1?' disabled':''}>${svg('down')}</button></div>`;}).join('');
        $$('[data-show]',box).forEach(input=>input.onchange=()=>{if(!valid())return;const k=input.dataset.show;value.sections=order.filter(x=>x===k?input.checked:value.sections.includes(x));input.closest('.me-edit-row').classList.toggle('off',!input.checked);periodChoices();changed(`${sectionName(k)} ${input.checked?'shown':'hidden'}.`);});
        $$('[data-move]',box).forEach(button=>button.onclick=()=>{if(!valid())return;const i=order.indexOf(button.dataset.move),j=i+Number(button.dataset.step);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];value.sections=order.filter(k=>value.sections.includes(k));changed(`${names[button.dataset.move]} moved ${button.dataset.step==='1'?'down':'up'}.`);rows({key:button.dataset.move,step:button.dataset.step});});
        if(focus){const b=$(`[data-move="${focus.key}"][data-step="${focus.step}"]`,box);(b.disabled?$(`[data-show="${focus.key}"]`,box):b).focus({preventScroll:true});}
      };
      const periodChoices=()=>{
        const enabled=value.sections.includes(chosenPeriod),target=$('[data-card-period]',box);target.innerHTML=Object.entries({totals:'All time',recent:'Last 30 days'}).map(([k,l])=>chip('number-period',k,l,k===chosenPeriod)).join('');
        $$('[data-number-period]',target).forEach(button=>{button.disabled=!enabled;button.onclick=()=>{if(!valid()||!enabled)return;const k=button.dataset.numberPeriod;order=order.map(x=>x===chosenPeriod?k:x);value.sections=value.sections.map(x=>x===chosenPeriod?k:x);chosenPeriod=k;rows();periodChoices();$(`[data-number-period="${k}"]`,box).focus({preventScroll:true});changed('Period updated.');};});
      };
      const choices=(group,key,catalog,min)=>{
        const target=$(`[data-card-${key}]`,box);target.innerHTML=Object.entries(catalog).map(([k,l])=>chip(group,k,l,value[key].includes(k))).join('');
        $$(`[data-${group}]`,target).forEach(button=>button.onclick=()=>{if(!valid())return;const k=button.dataset[group],on=value[key].includes(k);if(on&&value[key].length<=min){status.textContent='Keep at least one number.';return;}if(!on&&value[key].length>=3){status.textContent='Choose up to three.';return;}value[key]=on?value[key].filter(x=>x!==k):[...value[key],k];button.setAttribute('aria-pressed',String(!on));changed(`${key==='stats'?'Headline numbers':'Featured sports'} updated.`);});
      };
      rows();periodChoices();choices('stat','stats',stats,1);choices('sport','sports',Object.fromEntries(ProfileLayout.sports.map(k=>[k,SPORT_NAMES[k]||k])),0);
      name.oninput=()=>{nameError.textContent='';name.removeAttribute('aria-invalid');changed();};
      bio.oninput=()=>{$('[data-card-bio-count]',box).textContent=bio.value.length+'/280';sizeBio();changed();};
      $('[data-card-photo]',box).onclick=()=>{if(!valid())return;profilePhotoSheet(()=>{if(!valid())return;const photo=$('[data-card-photo]',box);photo.innerHTML=avatar(App.me,'lg')+'<small>Change</small>';const original=$('.me-card-id .me-card-avatar',card);if(original)original.innerHTML=avatar(App.me,'lg');invalidate('/api/me');invalidate('/api/people/');keep('/api/me',App.me);status.textContent='Photo saved. Your other edits are kept.';});};
      const close=()=>{finish();if(fromSettings&&live())go('/me',{replace:true});};
      const cancel=$('[data-card-cancel]',box);cancel.onclick=async()=>{if(!valid()||busy||featuredBusy)return;if(dirty()&&(!await confirmSheet('Discard your changes?',{body:'Your profile edits won’t be saved.',action:'Discard',cancel:'Keep editing'})||!valid()||busy||featuredBusy))return;close();};
      form.onsubmit=async e=>{
        e.preventDefault();if(!valid()||busy||featuredBusy||!dirty())return;
        const trimmed=name.value.trim();if(!trimmed||trimmed.length>60){nameError.textContent='Enter a name between 1 and 60 characters.';name.setAttribute('aria-invalid','true');name.focus();return;}
        const body={name:trimmed,bio:bio.value.trim(),profile_layout:ProfileLayout.singlePeriod(value)};
        const savePins=JSON.stringify(featuredPins)!==JSON.stringify(start.featuredPins);busy=true;featuredBusy=savePins;cancel.disabled=true;save.disabled=true;save.textContent='Saving…';status.textContent='';renderFeatured();
        try{
          if(name.value!==start.name||bio.value!==start.bio||JSON.stringify(value)!==JSON.stringify(start.layout)){
            const account=await api('/api/account',json('PUT',body));if(owner!==readOwner())return;
            App.me.name=account.name??body.name;App.me.bio=account.bio??body.bio;App.me.profile_layout=account.profile_layout||body.profile_layout;
            start.name=App.me.name;start.bio=App.me.bio;start.layout=ProfileLayout.singlePeriod(App.me.profile_layout||body.profile_layout);
            invalidate('/api/me');invalidate('/api/people/');invalidateFeed();keep('/api/me',App.me);
          }
          if(savePins){
            const result=await api('/api/achievements/showcase/pins',json('PUT',{pinned:featuredPins}));if(!valid())return;
            featuredPins=Array.isArray(result?.pinned)?result.pinned:[...featuredPins];start.featuredPins=[...featuredPins];invalidate('/api/achievements/showcase');
          }
          if(valid()){finish(true);toast('Card saved');if(fromSettings)go('/me',{replace:true});else (onSaved||reload)?.();}
        }catch(x){if(valid()){status.textContent=x.message;save.textContent='Save';busy=false;featuredBusy=false;cancel.disabled=false;renderFeatured();changed();}}
      };
      loadFeatured();
      sizeBio();if(focusName){card.scrollIntoView({block:'start'});name.focus({preventScroll:true});}else $('[data-show]',box)?.focus({preventScroll:true});
    }
    function finish(saved=false){editing=false;dim(false);draw();if(!data)loadCard();$('[data-card-edit]',card).focus({preventScroll:true});onEditEnd?.({saved});}
    if(!ownerView){ProfileLayout.mountShowcase(root,data);draw();return {};}
    $('[data-card-edit]',card).onclick=edit;
    $('[data-card-share]',card).onclick=shareSheet;
    $('[data-card-preview]',card)?.addEventListener('click',viewAsFriend);
    if(data)draw();else loadCard();
    return {edit};
  }
  return {header,card,ownPills,ownFriends,mount,profileView,firstName,openEditor:()=>go('/me?edit=profile')};
})();
