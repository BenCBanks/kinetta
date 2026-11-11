// Quiet, private achievements. Sharing is deliberate; cancellation never dismisses an offer.
'use strict';
const Milestones=(()=>{
  const key=params=>new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null)).toString();
  async function read(params={},timeout=2500){
    const owner=readOwner(),controller=new AbortController(),end=Date.now()+timeout,timer=setTimeout(()=>controller.abort(),timeout);
    try{
      for(;;){const data=await api('/api/milestones?'+key(params),{signal:controller.signal});if(owner!==readOwner())throw Error('The account changed.');
        if(!data.pending||Date.now()+150>=end)return{items:data.items||[],pending:!!data.pending};await new Promise(ok=>setTimeout(ok,150));}
    }finally{clearTimeout(timer);}
  }
  const day=d=>new Date(d+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'});
  const pictureDuration=seconds=>{const minutes=Math.max(0,Math.round((Number(seconds)||0)/60)),hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}m`:`${minutes}m`;};
  function values(item){
    const d=item.details,metric=App.me.units==='metric',unit=metric?'km':'mi';let value='',label='',facts=[];
    if(item.kind==='best'){value=pictureDuration(d.seconds);label=d.label;}
    else if(item.kind==='year_distance'){value=d.amount.toLocaleString();label=d.unit;}
    else if(item.kind==='activity_weeks'){value=String(d.amount);label='active weeks in a row';}
    else if(item.kind==='food_days'){value=String(d.amount);label='days with food logged';}
    else if(d.distance_m>0){value=(d.distance_m/(metric?1000:1609.344)).toLocaleString(undefined,{maximumFractionDigits:1,minimumFractionDigits:1});label=unit;if(d.seconds>0)facts.push('Workout time: '+pictureDuration(d.seconds));}
    else if(d.seconds>0){value=pictureDuration(d.seconds);label='Workout time';}
    else{value=SPORT_NAMES[d.sport]||'Your progress';}
    return{value,unit:label,facts};
  }
  // Only single-workout milestones may carry a map. Totals/streaks also have triggering activity IDs.
  async function routePoints(item){
    if(!['sport','first_distance','best'].includes(item.kind)||!item.activity_id||item.private_activity)return [];
    const owner=readOwner(),id=encodeURIComponent(item.activity_id);
    const [activity,sharing]=await Promise.all([api(`/api/activities/${id}`),api(`/api/activities/${id}/social`)]);
    if(owner!==readOwner())throw Error('The account changed.');
    if(!['friends','everyone'].includes(activity.visibility)||!['friends','everyone'].includes(sharing.visibility)||sharing.details?.map!==true||!activity.line)return [];
    // Match the activity picture's checked endpoint hiding, including its default at saved zero.
    return trimRoute(decode(activity.line),sharing.trim_m||400);
  }
  const signature=(item,points)=>JSON.stringify([item.kind,item.activity_id,item.title,item.day,item.private_activity,item.details,item.garmin_source,points]);
  async function picture(item,identity=false,points=[]){return ShareArt.simplePicture({kicker:'Milestone',title:item.title,date:day(item.day),...values(item),sources:item.details.garmin_sources||[item.garmin_source].filter(Boolean),identity,routePoints:points});}
  async function mark(item,action){await api('/api/milestones/'+encodeURIComponent(item.id)+'/seen',json('POST',{action}));}
  const celebrationPalette={
    run:'var(--run)',ride:'var(--ride)',walk:'var(--walk)',hike:'var(--walk)',swim:'var(--swim)',workout:'var(--workout)',
    'sport:run':'var(--run)','sport:ride':'var(--ride)','sport:walk-hike':'var(--walk)','sport:swim':'var(--swim)','sport:lift':'var(--workout)',
    journey:'var(--color-brand)',consistency:'var(--color-brand)',years_active:'var(--color-brand)',workouts:'var(--color-brand)',
    active_time:'var(--color-brand)',climbing:'var(--hike)',lifted:'var(--workout)',personal_bests:'var(--color-brand)'
  };
  function celebrationCopy(items){
    const best=items.find(item=>item.kind==='best'),item=best||items[0];let copy;
    if(best){const d=best.details||{},label=d.label||best.title.replace(/^New\s+|\s+best$/gi,'').trim();copy=`New best: ${label} ${dur(d.seconds||0)}`;}
    else copy=`New medal: ${item.title}`;
    if(items.length>1)copy+=` · ${items.length-1} more`;
    return{copy,item};
  }
  function showCelebration(node,items){
    if(!node?.isConnected||!items.length)return;
    const {copy,item}=celebrationCopy(items),details=item.details||{},code=details.track||details.sport||'',reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.classList.add('milestone-celebration-host');node.replaceChildren();node.style.setProperty('--celebration-color',celebrationPalette[code]||'var(--color-brand)');
    const banner=document.createElement('div');banner.className='milestone-celebration-banner';banner.setAttribute('role','status');banner.textContent=copy;node.append(banner);
    if(!reduced){
      const particles=document.createElement('span');particles.className='milestone-celebration-particles';particles.setAttribute('aria-hidden','true');
      for(let i=0;i<30;i++){const particle=document.createElement('i');particle.style.setProperty('--burst-x',`${Math.round((Math.random()-.5)*48)}px`);particle.style.setProperty('--burst-y',`${Math.round(Math.random()*36)}px`);particle.style.setProperty('--burst-spin',`${Math.round((Math.random()-.5)*700)}deg`);particles.append(particle);}
      node.append(particles);
    }
    try{Native.achievementLevelUp?.();}catch(_){/* An optional haptic never blocks the saved activity. */}
    const timer=setTimeout(()=>{if(!node.isConnected)return;if(!reduced)banner.classList.add('is-fading');setTimeout(()=>{if(node.isConnected){node.replaceChildren();node.classList.remove('milestone-celebration-host');node.style.removeProperty('--celebration-color');}},reduced?0:260);},3000);
    const dispose=viewResources.get(node);viewResources.set(node,()=>{clearTimeout(timer);dispose?.();});
  }
  async function celebrate(node,activityId){
    if(!node||!/^\d+$/.test(String(activityId)))return;
    const owner=readOwner(),stamp=Symbol('milestone-celebration');node._celebrationStamp=stamp;
    const live=()=>node.isConnected&&owner===readOwner()&&node._celebrationStamp===stamp,end=Date.now()+3000;
    try{
      for(;;){if(!live())return;const data=await api('/api/milestones/celebrate',json('POST',{activity_id:Number(activityId)}));if(!live())return;
        if(!data?.pending){showCelebration(node,Array.isArray(data?.items)?data.items:[]);return;}
        if(Date.now()+150>=end)return;await new Promise(resolve=>setTimeout(resolve,150));
      }
    }catch(_){/* The optional celebration never blocks the workout or its detail. */}
  }
  function more(items,changed){
    sheet('Recent milestones',`<div class="card list milestone-list">${items.map((item,n)=>`<button type="button" class="row-link" data-milestone="${n}"><span class="grow"><b>${esc(item.title)}</b><small>${esc(day(item.day))}</small></span>${svg('chev')}</button>`).join('')}</div>`,(b,close)=>{
      const owner=readOwner();$$('[data-milestone]',b).forEach(button=>button.onclick=()=>{if(owner!==readOwner())return;const item=items[+button.dataset.milestone];open(item,changed,b,close);});
    });
  }
  function paint(node,data,{row=false,onChange,params={}}={}){
    if(!node?.isConnected)return;const owner=readOwner(),items=data.items||[];node.innerHTML='';
    if(row)node.hidden=!items.length;
    if(!items.length)return;const first=items[0],refresh=()=>{if(node.isConnected&&owner===readOwner())mount(node,{params,row,onChange});onChange?.();};
    if(row){
      const latest=[...items].sort((a,b)=>(Date.parse(b.occurred||b.day)||0)-(Date.parse(a.occurred||a.day)||0)),item=latest[0];
      node.innerHTML=`<div class="me-milestone-row"><button type="button" class="me-milestone-latest">${svg('trophy')}<span>${esc(item.title)}</span><span class="vh">. Review share picture</span></button>${items.length>1?'<button type="button" class="me-milestone-all">Recent milestones</button>':''}</div>`;
      $('.me-milestone-latest',node).onclick=()=>{if(owner===readOwner())open(item,refresh,node);};
      const all=$('.me-milestone-all',node);if(all)all.onclick=()=>{if(owner===readOwner())more(latest,refresh);};return;
    }
    node.innerHTML=`<section class="card milestone-banner" aria-label="Milestone"><div class="milestone-copy"><b>${esc(first.title)}</b>${items.length>1?`<button type="button" class="linkbtn milestone-more">+${items.length-1} more</button>`:''}</div><div class="milestone-actions"><button type="button" class="icon-btn milestone-share" aria-label="Share achievement picture">${svg('share')}</button><button type="button" class="icon-btn milestone-dismiss" aria-label="Dismiss milestone">${svg('close')}</button></div><p role="status" class="small milestone-error" hidden></p></section>`;
    $('.milestone-share',node).onclick=()=>open(first,refresh,node);
    const extra=$('.milestone-more',node);if(extra)extra.onclick=()=>more(items,refresh);
    $('.milestone-dismiss',node).onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await mark(first,'dismiss');if(owner===readOwner())refresh();}catch(error){if(node.isConnected&&owner===readOwner()){const status=$('.milestone-error',node);status.hidden=false;status.textContent=error.message;button.disabled=false;}}};
  }
  async function mount(node,{params={},row=false,onChange}={}){
    if(!node)return;const owner=readOwner(),generation=Symbol();node.milestoneGeneration=generation;
    try{const data=await read(params);if(node.isConnected&&owner===readOwner()&&node.milestoneGeneration===generation)paint(node,data,{row,onChange,params});}
    catch(_){/* Optional celebrations never block the person's food or workout records. */}
  }
  async function open(initial,changed,view=null,closeSource=null){
    const owner=readOwner(),path=location.pathname+location.search,live=()=>owner===readOwner()&&path===location.pathname+location.search&&(!view||view.isConnected);let item;
    try{item=(await read({milestone_id:initial.id},5000)).items[0];if(!live())return;if(!item){toast('This milestone is no longer waiting for review.');changed?.();return;}await loadShareArt();if(!live())return;closeSource?.();}
    catch(e){if(live()){const status=view?.querySelector('.milestone-error');if(status){status.hidden=false;status.textContent=(e.message||'Picture sharing could not load.')+' Tap Share to try again.';}else toast((e.message||'Picture sharing could not load.')+' Tap Share to try again.');}return;}
    const valid=()=>owner===readOwner()&&path===location.pathname+location.search;
    let points=[],handed=false;
    const pictureItem={label:item.title,filename:'kinetta-milestone.png',note:item.private_activity?'This activity is set to Only me. The picture shows its time and distance.':'',controls:[{key:'identity',label:'Photo and username',checked:false}],
      valid,build:async state=>{if(!valid())throw Error('The account changed.');points=await routePoints(item);if(!valid())throw Error('The account changed.');return picture(item,state.identity,points);},
      beforeShare:async({values,setStatus,refresh,close,live})=>{
        if(handed){await mark(item,'shared');if(live()){close();changed?.();}return false;}
        const fresh=(await read({milestone_id:item.id},5000)).items[0];if(!live())return false;
        if(!fresh){setStatus('Your records changed. This milestone is no longer waiting for review.');changed?.();return false;}
        const freshPoints=await routePoints(fresh);if(!live())return false;
        if(signature(fresh,freshPoints)!==signature(item,points)){item=fresh;points=freshPoints;await refresh();setStatus('Your records changed. Review this updated picture, then share again.');return false;}
        return true;
      },
      onShare:async({blob,live,close,setStatus})=>{
        handed=await ShareArt.deliver(blob,'kinetta-milestone.png',live);if(handed&&live()){try{await mark(item,'shared');if(live()){close();changed?.();}}catch(error){setStatus('Picture shared. Tap Share again to finish when connected.');}}return false;
      },
      afterSave:async({live,close})=>{await mark(item,'shared');if(live()){close();changed?.();}}
    };
    ShareSheet.open({items:[pictureItem],actions:[{label:'Dismiss milestone',run:async({close,live})=>{try{await mark(item,handed?'shared':'dismiss');if(live()){close();changed?.();}}catch(error){if(live())toast(error.message);}}}]});
  }
  return{read,mount,paint,open,picture,values,routePoints,celebrate};
})();
route(/^\/me\/milestones$/,'me',()=>go('/me',{replace:true}));
