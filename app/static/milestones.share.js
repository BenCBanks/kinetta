// On-demand milestone picture construction and delivery. The eager shell owns reads and celebration UI.
'use strict';
const MilestoneShare=(()=>{
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
  async function open(initial,changed,view=null,closeSource=null){
    const owner=readOwner(),path=location.pathname+location.search,live=()=>owner===readOwner()&&path===location.pathname+location.search&&(!view||view.isConnected);let item;
    try{item=(await Milestones.read({milestone_id:initial.id},5000)).items[0];if(!live())return;if(!item){toast('This milestone is no longer waiting for review.');changed?.();return;}await loadShareArt();if(!live())return;closeSource?.();}
    catch(e){if(live()){const status=view?.querySelector('.milestone-error');if(status){status.hidden=false;status.textContent=(e.message||'Picture sharing could not load.')+' Tap Share to try again.';}else toast((e.message||'Picture sharing could not load.')+' Tap Share to try again.');}return;}
    const valid=()=>owner===readOwner()&&path===location.pathname+location.search;
    let points=[],handed=false;
    const pictureItem={label:item.title,filename:'kinetta-milestone.png',note:item.private_activity?'This activity is set to Only me. The picture shows its time and distance.':'',controls:[{key:'identity',label:'Photo and username',checked:false}],
      valid,build:async state=>{if(!valid())throw Error('The account changed.');points=await routePoints(item);if(!valid())throw Error('The account changed.');return picture(item,state.identity,points);},
      beforeShare:async({values,setStatus,refresh,close,live})=>{
        if(handed){await Milestones.mark(item,'shared');if(live()){close();changed?.();}return false;}
        const fresh=(await Milestones.read({milestone_id:item.id},5000)).items[0];if(!live())return false;
        if(!fresh){setStatus('Your records changed. This milestone is no longer waiting for review.');changed?.();return false;}
        const freshPoints=await routePoints(fresh);if(!live())return false;
        if(signature(fresh,freshPoints)!==signature(item,points)){item=fresh;points=freshPoints;await refresh();setStatus('Your records changed. Review this updated picture, then share again.');return false;}
        return true;
      },
      onShare:async({blob,live,close,setStatus})=>{
        handed=await ShareArt.deliver(blob,'kinetta-milestone.png',live);if(handed&&live()){try{await Milestones.mark(item,'shared');if(live()){close();changed?.();}}catch(error){setStatus('Picture shared. Tap Share again to finish when connected.');}}return false;
      },
      afterSave:async({live,close})=>{await Milestones.mark(item,'shared');if(live()){close();changed?.();}}
    };
    ShareSheet.open({items:[pictureItem],actions:[{label:'Dismiss milestone',run:async({close,live})=>{try{await Milestones.mark(item,handed?'shared':'dismiss');if(live()){close();changed?.();}}catch(error){if(live())toast(error.message);}}}]});
  }
  return{open,picture,routePoints,values};
})();
