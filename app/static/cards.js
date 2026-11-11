// Public cards start on and remain revocable; private friend invitations remain separate.
'use strict';
const KinettaCard=(()=>{
  async function picture(owner){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch((Native.base||'')+'/api/card/image.png',{headers:{...Native.headers(),'X-Kinetta-Account':String(App.me.id)},credentials:Native.on?'omit':'same-origin',signal:controller.signal});
      if(!r.ok)throw Error('Couldn’t load the card picture. Try again.');const b=await r.blob();if(owner!==readOwner())throw Error('The account changed.');return b;
    }finally{clearTimeout(timer);}
  }
  function makeShareItems(data,owner,profileLink=data.url){
    if(!data?.enabled||!data.url)return[];
    const alt='@'+data.preview.username+' on Kinetta. '+[...data.preview.sports.map(s=>(SPORT_NAMES[s.sport]||s.sport)+': '+Number(s.activities).toLocaleString()+' all-time activities'),...data.preview.stats.map(s=>s.value+' '+s.label),...(data.preview.achievements||[]).map(a=>a.value+' '+a.context)].join('. ');
    return[
      {label:'Me card',filename:'kinetta-card.png',link:profileLink,build:async()=>{const latest=await api('/api/card');if(owner!==readOwner()||!latest.enabled||latest.url!==data.url)throw Error('Your card changed. Reopen Share to refresh it.');return{blob:await picture(owner),alt,link:profileLink};}}
    ];
  }
  async function shareItems(profileLink){const owner=readOwner(),data=await api('/api/card');if(owner!==readOwner())return[];return makeShareItems(data,owner,profileLink||data.url);}
  async function open(){
    const owner=readOwner();let data,sharing;try{[data,sharing]=await Promise.all([api('/api/card'),api('/api/sharing')]);}catch(e){toast(e.message);return;}if(owner!==readOwner())return;
    sheet('Share your Kinetta',`<label class="switch-row"><span><b>Share card</b></span><input type="checkbox" role="switch" id="card-enabled"${data.enabled?' checked':''}></label><p class="small muted">Anyone with this link can see your card and ask to be your friend. You approve requests.</p><div class="card-preview"><img id="card-picture" alt="Your public Kinetta card"></div><fieldset class="card-options"><legend>What your card shows</legend><label class="check"><input type="checkbox" id="card-photo"${data.photo?' checked':''}>Profile photo</label><label class="check"><input type="checkbox" id="card-sports"${data.sports?' checked':''}>Sports</label><label class="check achievement-sharing-choice"><input type="checkbox" id="card-achievements"${sharing.share_achievements?' checked':''}><span><b>Achievements</b><small>Big milestones, once a week</small></span></label><p class="small muted">Sports show all-time counts of your completed activities. Sports and totals include Only me workouts; their details stay private.</p><fieldset class="card-period"><legend>Numbers</legend><label class="check"><input type="radio" name="card-period" value="this_week"${data.period==='this_week'?' checked':''}>This week</label><label class="check"><input type="radio" name="card-period" value="all_time"${data.period==='all_time'?' checked':''}>All time</label><label class="check"><input type="radio" name="card-period" value="none"${data.period==='none'?' checked':''}>None</label></fieldset><label class="check"><input type="checkbox" id="card-requests"${data.allow_requests?' checked':''}>Allow friend requests from my card</label></fieldset><p class="small muted" id="card-counts"></p><p id="card-status" class="small" role="status"></p><button type="button" class="ghost wide" id="card-retry" hidden>Retry picture</button><div class="btncol"><button type="button" class="primary wide" id="card-share">Share card</button><button type="button" class="ghost wide" id="card-copy">Copy link</button><button type="button" class="ghost wide" id="card-qr">Show QR code</button><button type="button" class="linkbtn" id="card-new">Make a new link</button></div>`,(b,close)=>{
      const route=location.pathname+location.search,live=()=>b.isConnected&&readOwner()===owner,qrLive=()=>live()&&location.pathname+location.search===route,status=$('#card-status',b),img=$('#card-picture',b);let blob=null,imageURL='',busy=false,qrLoading=false,seq=0;
      const disable=value=>{$$('input,button',b).forEach(x=>x.disabled=value);if(!value)for(const id of ['#card-share','#card-copy','#card-qr'])$(id,b).disabled=!data.enabled||!blob;};
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      viewResources.set(b,()=>{seq++;if(imageURL)URL.revokeObjectURL(imageURL);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
      const values=()=>({enabled:$('#card-enabled',b).checked,photo:$('#card-photo',b).checked,sports:$('#card-sports',b).checked,allow_requests:$('#card-requests',b).checked,period:$('input[name="card-period"]:checked',b).value});
      async function refresh(save=false,newLink=false,reload=false){
        if(busy)return;busy=true;blob=null;$('#card-retry',b).hidden=true;disable(true);status.textContent=save?'Saving…':'Loading picture…';const version=++seq;
        try{if(save)data=await api(newLink?'/api/card/new':'/api/card',newLink?{method:'POST'}:json('PUT',values()));else if(reload)data=await api('/api/card');if(!live()||version!==seq)return;
          blob=await picture(owner);if(!live()||version!==seq)return;if(imageURL)URL.revokeObjectURL(imageURL);imageURL=URL.createObjectURL(blob);img.src=imageURL;img.alt='@'+data.preview.username+' on Kinetta. '+[...data.preview.sports.map(s=>(SPORT_NAMES[s.sport]||s.sport)+': '+Number(s.activities).toLocaleString()+' all-time activities'),...data.preview.stats.map(s=>s.value+' '+s.label),...(data.preview.achievements||[]).map(a=>a.value+' '+a.context)].join('. ');status.textContent=data.enabled?'Your card is active.':'Your card is off. Only you can see this preview.';$('#card-counts',b).textContent=`Joined through your card: ${data.joined} · Requests waiting: ${data.waiting}`;
        }catch(e){if(live()){status.textContent=e.message;$('#card-retry',b).hidden=false;$('#card-enabled',b).checked=data.enabled;$('#card-photo',b).checked=data.photo;$('#card-sports',b).checked=data.sports;$('#card-requests',b).checked=data.allow_requests;$(`input[name="card-period"][value="${data.period}"]`,b).checked=true;}}
        finally{busy=false;if(live())disable(false);}
      }
      $('#card-retry',b).onclick=()=>refresh();
      $$('input',b).forEach(x=>x.onchange=()=>refresh(true));
      $('#card-achievements',b).onchange=async e=>{
        if(busy||!live())return;const on=e.target.checked;busy=true;disable(true);
        try{await api('/api/sharing',json('PUT',{share_achievements:on}));if(!live())return;sharing.share_achievements=on;invalidate('/api/');invalidateFeed();status.textContent='Saved.';}
        catch(error){if(live()){e.target.checked=!!sharing.share_achievements;status.textContent=error.message;}}
        finally{busy=false;if(live()){if(sharing.share_achievements===on)await refresh(false,false,true);else disable(false);}}
      };
      let shareLoading=false;
      $('#card-share',b).onclick=async()=>{if(busy||shareLoading||!blob||!data.enabled||!qrLive())return;shareLoading=true;const button=$('#card-share',b);button.disabled=true;status.textContent='Preparing picture sharing…';try{const items=makeShareItems(data,owner,data.url);await loadShareArt();if(!qrLive())return;close();ShareSheet.open({items});}catch(error){if(qrLive())status.textContent=(error.message||'Picture sharing could not load.')+' Tap Share card to try again.';}finally{shareLoading=false;if(qrLive())button.disabled=!data.enabled||!blob;}};
      $('#card-copy',b).onclick=async()=>{try{await navigator.clipboard.writeText(data.url);if(live())toast('Card link copied');}catch(e){if(live())sheet('Your card link',`<label class="form">Copy this link<input readonly value="${esc(data.url)}" aria-label="Card link"></label>`,(root,done)=>{guardFoodSheet(root,done,owner);$('input',root).select();});}};
      $('#card-qr',b).onclick=async()=>{
        if(busy||qrLoading||!qrLive()||!data.enabled)return;const link=data.url;qrLoading=true;
        try{await loadQrCode();if(!qrLive()||!data.enabled||data.url!==link)return;close();qr(link);}
        catch{if(qrLive())status.textContent='QR code could not load. Tap Show QR code to try again.';}
        finally{qrLoading=false;}
      };
      $('#card-new',b).onclick=()=>{close();sheet('Make a new card link?',`<p>The old link and QR code will stop working immediately. Existing friendships stay.</p><div class="actions"><button type="button" class="ghost" id="card-keep">Keep current link</button><button type="button" class="primary" id="card-rotate">Make new link</button></div>`,(confirm,leave)=>{guardFoodSheet(confirm,leave,owner);$('#card-keep',confirm).onclick=()=>{leave();open();};$('#card-rotate',confirm).onclick=async e=>{e.target.disabled=true;try{await api('/api/card/new',{method:'POST'});if(readOwner()!==owner)return;leave();open();}catch(x){toast(x.message);e.target.disabled=false;}};});};
      refresh();
    });
  }
  function qr(link){
    const owner=readOwner();sheet('Scan my Kinetta card',`<div class="card-qr-screen"><div id="card-qr-code"></div><p>Scan to see my card and send a friend request.</p><p class="small">${esc(link)}</p></div>`,(b,close)=>{
      const q=qrcode(0,'M');q.addData(link);q.make();const n=q.getModuleCount(),m=4,ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${n+2*m} ${n+2*m}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','QR code for your Kinetta card');let path='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))path+=`M${x+m} ${y+m}h1v1h-1z`;const rect=document.createElementNS(ns,'rect');rect.setAttribute('width',n+2*m);rect.setAttribute('height',n+2*m);rect.setAttribute('fill','#fff');svg.append(rect);const dark=document.createElementNS(ns,'path');dark.setAttribute('d',path);dark.setAttribute('fill','#000');svg.append(dark);$('#card-qr-code',b).append(svg);let wake=null,closed=false;
      const awake=async()=>{if(closed||document.hidden||readOwner()!==owner)return;try{if(Native.on)await Native.keepScreenAwake(true);else{const held=await navigator.wakeLock?.request('screen');if(closed||document.hidden||readOwner()!==owner)await held?.release();else wake=held;}}catch(_){/* Scanning still works when the browser cannot hold the screen awake. */}};
      const release=()=>{wake?.release().catch(()=>{});wake=null;if(Native.on)Native.keepScreenAwake(false).catch(()=>{});};
      const closeSelf=()=>close();App.closeActivityShare=closeSelf;
      const visible=()=>{if(document.hidden)release();else awake();};document.addEventListener('visibilitychange',visible);awake();viewResources.set(b,()=>{closed=true;release();document.removeEventListener('visibilitychange',visible);if(App.closeActivityShare===closeSelf)delete App.closeActivityShare;});
    });
  }
  async function preview(el,code){
    const owner=readOwner();let d;try{d=await api('/api/cards/'+encodeURIComponent(code));}catch(e){el.innerHTML=`<div class="top">${backBtn('Friends')}</div><h1>This card is no longer active</h1>`;wireBack(el,'/me/friends');return;}if(owner!==readOwner()||!el.isConnected)return;
    el.innerHTML=`<div class="top">${backBtn('Friends')}</div><h1>@${esc(d.username)} is on Kinetta</h1><img class="public-card-picture" src="${esc(d.url)}/image.png" alt="@${esc(d.username)} on Kinetta"><p>Opening a card never makes you friends automatically.</p>${d.allow_requests&&d.relationship==='none'?'<button type="button" class="primary wide" id="card-request">Send friend request</button>':`<p>${d.relationship==='friends'?'You’re already friends.':d.relationship==='request_sent'?'Request sent.':d.relationship==='self'?'This is your card.':d.relationship==='incoming'?'This person already sent you a request.':'Friend requests from this card are off.'}</p>`}<p role="status" id="card-request-status"></p>`;wireBack(el,'/me/friends');const request=$('#card-request',el);if(request)request.onclick=async()=>{request.disabled=true;try{const r=await api('/api/cards/'+encodeURIComponent(code)+'/request',{method:'POST'});if(owner!==readOwner()||!el.isConnected)return;$('#card-request-status',el).textContent=r.status==='friends'?'You’re already friends.':r.status==='incoming'?'Check your incoming friend requests.':'Request sent. The card owner will approve it.';invalidate('/api/friends');}catch(e){if(owner===readOwner()&&el.isConnected){$('#card-request-status',el).textContent=e.message;request.disabled=false;}}};
  }
  return{open,qr,shareItems,preview};
})();
route(/^\/card\/([A-Za-z0-9_-]{1,60})$/,'me',(el,code)=>KinettaCard.preview(el,code));
