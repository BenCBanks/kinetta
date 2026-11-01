'use strict';
// Only fixed feature names leave the page. No URLs, text or persistent browser identifiers.
const FeatureUsage=(()=>{
  const explanationVersion='2026-11-01-v1';
  let owner=null,permission=null,lastView=null;
  const identity=()=>typeof App==='undefined'?null:App.me?.id;
  async function event(feature,expectedSession=readOwner()){
    const account=identity();if(!account||expectedSession!==readOwner())return;
    if(account!==owner){owner=account;permission=null;}
    try{
      permission??=api('/api/features/state').then(x=>x.enabled===true).catch(()=>false);
      if(!await permission||account!==identity()||account!==owner||expectedSession!==readOwner())return;
      await api('/api/features/open',json('POST',{feature}));
    }catch(_){/* Optional metrics never obstruct navigation, setup or a picture. */}
  }
  function open(path){
    const stamp=identity()+':'+location.pathname+location.search;if(stamp===lastView)return;lastView=stamp;
    const p=location.pathname,q=new URLSearchParams(location.search),feature=
      (p==='/food'&&q.get('view')&&q.get('view')!=='log'||p==='/progress'&&q.get('section')==='food')?'insights':
      p==='/progress/heatmap'?'heatmap':p==='/progress'&&q.get('view')==='fitness'?'fitness':
      p==='/me/explore'?'explore':p==='/me/kit'?'kit':p==='/me/settings'?'settings':
      p==='/me/sharing'?'settings_privacy':p==='/me/notifications'?'settings_notifications':null;
    if(feature)void event(feature);
  }
  async function settings(el,{folded=false}={}){
    const account=identity(),session=readOwner(),anchor=el.querySelector('#feature-metrics');if(!anchor)return;
    try{
      const value=await api('/api/features/state');
      if(account!==identity()||session!==readOwner()||!anchor.isConnected||!value.available&&!value.participating)return;
      anchor.innerHTML='<section class="card"><label class="switch-row"><span>Help improve Kinetta<small>Optional feature counts. No food text or routes.</small></span><input type="checkbox" role="switch" id="feature-metrics-choice"'+(value.participating?' checked':'')+'></label><details><summary>What is counted</summary><p>Reports use totals from your saved records, including workouts and food, plus feature opens, setup completion and broad food-entry actions. Reports show groups of at least three people. Anonymous daily totals stay for 13 months; temporary daily keys are discarded the next UTC day.</p><p>Turning this off stops new counts and excludes your saved records from feature reports. Earlier anonymous totals remain until expiry. Food-action labels stay with their food records until you delete them. This is optional and does not affect tracking or food logging. <a href="https://kinetta.app/privacy" target="_blank" rel="noopener">Privacy policy</a></p></details><p class="small" id="feature-metrics-status" role="status"></p></section>';
      if(folded){const card=anchor.querySelector('section'),details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Help improve Kinetta · Optional';while(card.firstChild)details.append(card.firstChild);details.prepend(summary);card.append(details);}
      const toggle=anchor.querySelector('input'),status=anchor.querySelector('#feature-metrics-status');
      const live=()=>account===identity()&&session===readOwner()&&anchor.isConnected;
      if(value.version!==explanationVersion&&!value.participating){toggle.disabled=true;status.textContent='Update Kinetta to review this optional setting.';return;}
      toggle.onchange=async()=>{
        const selected=toggle.checked;let unresolved=false;toggle.disabled=true;status.textContent='Saving…';
        const show=reply=>{
          if(typeof reply.participating!=='boolean'||typeof reply.enabled!=='boolean')throw Error('Could not check this setting.');
          toggle.checked=reply.participating;permission=Promise.resolve(reply.enabled);owner=account;
          status.textContent=reply.participating?'You’re taking part in optional usage counts.':'Optional usage counts are off.';
        };
        try{
          const reply=await api('/api/features/preferences',json('PUT',{enabled:selected,version:explanationVersion}));
          if(!live())return;show(reply);
        }catch(error){
          if(!live())return;
          try{const current=await api('/api/features/state');if(!live())return;show(current);if(current.participating!==selected)status.textContent=error.message||'Could not save. Try again.';}
          catch(_){
            if(!live())return;unresolved=true;permission=Promise.resolve(false);toggle.hidden=true;
            status.textContent='This setting’s status is unknown. Check it before changing it again.';
            const retry=document.createElement('button');retry.type='button';retry.textContent='Check setting';retry.onclick=async()=>{if(retry.disabled)return;retry.disabled=true;retry.textContent='Checking…';await settings(el,{folded});if(retry.isConnected){retry.disabled=false;retry.textContent='Check setting';}};anchor.querySelector('section').append(retry);
          }
        }finally{if(live()&&!unresolved)toggle.disabled=false;}
      };
    }catch(_){/* Settings stays usable if optional metrics status is unavailable. */}
  }
  return{open,event,settings};
})();
