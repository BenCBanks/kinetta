'use strict';
// Only fixed feature names leave the page. No URLs, text or persistent browser identifiers.
const FeatureUsage=(()=>{
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
  return{open,event};
})();
