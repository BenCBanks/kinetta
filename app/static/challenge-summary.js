// Eager Me summary and pending signup continuation; full challenge pages load on demand.
'use strict';
var Challenges=(()=>{
  const number=(n,unit)=>Number(n).toLocaleString(undefined,{maximumFractionDigits:unit==='km'||unit==='mi'?(n>0&&n<.1?3:1):0});
  const total=q=>number(q.target,q.unit)+' '+q.unit;
  function summary(items){
    const active=items.filter(q=>q.member&&q.self&&!q.self.finished).sort((a,b)=>(a.self.days_left??Infinity)-(b.self.days_left??Infinity));
    return active.length?{active,count:active.length,first:active[0],progress:number(active[0].self.value,active[0].unit)+' / '+total(active[0])}:null;
  }
  async function mount(node,{me=false}={}){
    if(!node||!me)return;const owner=readOwner();try{const items=await api('/api/challenges');if(!node.isConnected||owner!==readOwner())return;const glance=summary(items);
      node.innerHTML=glance?`<div class="card list"><a class="row-link" href="/me/challenges"><span class="ri">${svg('people')}</span><span class="grow"><b>Challenges</b><small>${glance.count} active · ${glance.progress}</small></span><span class="chev">${svg('chev')}</span></a></div>`:'';
    }catch(_){/* The Me summary has always remained empty after an unavailable optional read. */}
  }
  async function resumeSignup(){
    if(App.me?.needs_email_confirm)return;const owner=readOwner(),before=location.pathname;
    try{const result=await api('/api/challenges/signup/continue',json('POST',{}));if(result.joined&&owner===readOwner()&&location.pathname===before){invalidate('/api/challenges');if(['/me','/welcome'].includes(before))go('/me/challenges/'+encodeURIComponent(result.joined));else if(before==='/me/challenges/'+result.joined)render();}}
    catch(_){/* The confirmed join intent is also retried by the server. */}
  }
  return{mount,resumeSignup,summary,number,total};
})();
