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
  function values(item){
    const d=item.details,metric=App.me.units==='metric',unit=metric?'km':'mi';let value='',label='',facts=[];
    if(item.kind==='best'){value=dur(d.seconds);label=d.label;}
    else if(item.kind==='year_distance'){value=d.amount.toLocaleString();label=d.unit;}
    else if(item.kind==='activity_weeks'){value=String(d.amount);label='active weeks in a row';}
    else if(item.kind==='food_days'){value=String(d.amount);label='days with food logged';}
    else if(d.distance_m>0){value=(d.distance_m/(metric?1000:1609.344)).toLocaleString(undefined,{maximumFractionDigits:1,minimumFractionDigits:1});label=unit;if(d.seconds>0)facts.push('Workout time: '+dur(d.seconds));}
    else if(d.seconds>0){value=dur(d.seconds);label='Workout time';}
    else{value=SPORT_NAMES[d.sport]||'Your progress';}
    return{value,unit:label,facts};
  }
  const signature=item=>JSON.stringify([item.title,item.day,item.private_activity,item.details,item.garmin_source]);
  async function picture(item,identity=false){return ShareArt.simplePicture({kicker:'Milestone',title:item.title,date:day(item.day),...values(item),sources:item.details.garmin_sources||[item.garmin_source].filter(Boolean),identity});}
  async function mark(item,action){await api('/api/milestones/'+encodeURIComponent(item.id)+'/seen',json('POST',{action}));}
  function more(items,changed){
    sheet('Recent milestones',`<div class="card list milestone-list">${items.map((item,n)=>`<button type="button" class="row-link" data-milestone="${n}"><span class="grow"><b>${esc(item.title)}</b><small>${esc(day(item.day))}</small></span>${svg('chev')}</button>`).join('')}</div>`,(b,close)=>{
      const owner=readOwner();$$('[data-milestone]',b).forEach(button=>button.onclick=()=>{if(owner!==readOwner())return;const item=items[+button.dataset.milestone];close();open(item,changed);});
    });
  }
  function paint(node,data,{row=false,onChange,params={}}={}){
    if(!node?.isConnected)return;const owner=readOwner(),items=data.items||[];node.innerHTML='';
    if(row)node.hidden=!items.length;
    if(!items.length)return;const first=items[0],refresh=()=>{if(node.isConnected&&owner===readOwner())mount(node,{params,row,onChange});onChange?.();};
    if(row){
      const latest=[...items].sort((a,b)=>(Date.parse(b.occurred||b.day)||0)-(Date.parse(a.occurred||a.day)||0)),item=latest[0];
      node.innerHTML=`<div class="me-milestone-row"><button type="button" class="me-milestone-latest" aria-label="Only you: ${esc(item.title)}. Review share picture">${svg('trophy')}<span class="grow"><small>Only you</small><span>${esc(item.title)}</span></span></button>${items.length>1?'<button type="button" class="me-milestone-all">See all</button>':''}</div>`;
      $('.me-milestone-latest',node).onclick=()=>{if(owner===readOwner())open(item,refresh);};
      const all=$('.me-milestone-all',node);if(all)all.onclick=()=>{if(owner===readOwner())more(latest,refresh);};return;
    }
    node.innerHTML=`<section class="card milestone-banner" aria-label="Milestone"><div class="milestone-copy"><b>${esc(first.title)}</b>${items.length>1?`<button type="button" class="linkbtn milestone-more">+${items.length-1} more</button>`:''}</div><div class="milestone-actions"><button type="button" class="ghost milestone-share">Share</button><button type="button" class="icon-btn milestone-dismiss" aria-label="Dismiss milestone">${svg('close')}</button></div><p role="status" class="small milestone-error" hidden></p></section>`;
    $('.milestone-share',node).onclick=()=>open(first,refresh);
    const extra=$('.milestone-more',node);if(extra)extra.onclick=()=>more(items,refresh);
    $('.milestone-dismiss',node).onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await mark(first,'dismiss');if(owner===readOwner())refresh();}catch(error){if(node.isConnected&&owner===readOwner()){const status=$('.milestone-error',node);status.hidden=false;status.textContent=error.message;button.disabled=false;}}};
  }
  async function mount(node,{params={},row=false,onChange}={}){
    if(!node)return;const owner=readOwner(),generation=Symbol();node.milestoneGeneration=generation;
    try{const data=await read(params);if(node.isConnected&&owner===readOwner()&&node.milestoneGeneration===generation)paint(node,data,{row,onChange,params});}
    catch(_){/* Optional celebrations never block the person's food or workout records. */}
  }
  async function open(initial,changed){
    const owner=readOwner();let item;
    try{item=(await read({milestone_id:initial.id},5000)).items[0];if(!item){toast('This milestone is no longer waiting for review.');changed?.();return;}}
    catch(e){if(owner===readOwner())toast(e.message);return;}
    if(owner!==readOwner())return;
    let current=null,url='',version=0,sending=false,handed=false;
    sheet('Share milestone',`<div class="milestone-body"><p class="milestone-private"${item.private_activity?'':' hidden'}>This activity is set to Only me. The picture shows its time and distance.</p><label class="check"><input type="checkbox" id="milestone-identity">Photo and username</label><div class="milestone-preview"><img id="milestone-picture" alt="Loading your picture"></div><p role="status" class="small" id="milestone-status"></p><button type="button" class="ghost wide" id="milestone-retry" hidden>Retry picture</button></div><div class="milestone-share-actions"><button type="button" class="primary wide" id="milestone-share" disabled>Share</button><button type="button" class="linkbtn wide" id="milestone-dismiss">Dismiss milestone</button></div>`,(b,close)=>{
      const live=()=>b.isConnected&&owner===readOwner(),status=$('#milestone-status',b),button=$('#milestone-share',b),identity=$('#milestone-identity',b),image=$('#milestone-picture',b);
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      viewResources.set(b,()=>{version++;if(url)URL.revokeObjectURL(url);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      async function draw(){$('.milestone-private',b).hidden=!item.private_activity;const stamp=++version;button.disabled=true;current=null;$('#milestone-retry',b).hidden=true;status.textContent='Creating picture…';
        try{const result=await picture(item,identity.checked);if(!live()||stamp!==version)return;current=result;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(result.blob);image.src=url;image.alt=result.alt;status.textContent='Review the picture before sharing.';button.disabled=false;}
        catch(e){if(live()&&stamp===version){status.textContent=e.message;$('#milestone-retry',b).hidden=false;}}
      }
      identity.onchange=draw;$('#milestone-retry',b).onclick=draw;
      button.onclick=async()=>{if(sending||!current)return;sending=true;button.disabled=true;identity.disabled=true;
        try{if(handed){await mark(item,'shared');if(live()){close();changed?.();}return;}const fresh=(await read({milestone_id:item.id},5000)).items[0];if(!live())return;if(!fresh){status.textContent='Your records changed. This milestone is no longer waiting for review.';current=null;changed?.();return;}
          if(signature(fresh)!==signature(item)){item=fresh;await draw();status.textContent='Your records changed. Review this updated picture, then share again.';return;}
          handed=await ShareArt.deliver(current.blob,'kinetta-milestone.png',live);if(handed&&live()){await mark(item,'shared');if(live()){close();changed?.();}}
        }catch(e){if(live()&&e.name!=='AbortError'){status.textContent=handed?'Picture shared. Tap Finish to dismiss the milestone when connected.':e.message;if(handed)button.textContent='Finish';}}
        finally{sending=false;if(live()){button.disabled=!current;identity.disabled=handed;}}
      };
      $('#milestone-dismiss',b).onclick=async e=>{e.currentTarget.disabled=true;try{await mark(item,handed?'shared':'dismiss');if(live()){close();changed?.();}}catch(error){if(live()){status.textContent=error.message;e.target.disabled=false;}}};
      draw();
    });
  }
  return{read,mount,paint,open,picture,values};
})();
route(/^\/me\/milestones$/,'me',()=>go('/me',{replace:true}));
