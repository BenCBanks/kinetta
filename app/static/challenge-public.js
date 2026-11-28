'use strict';
(()=>{
 const button=document.querySelector('#challenge-public-join');if(!button)return;
 const status=document.querySelector('#challenge-public-status'),path='/api/challenges/'+encodeURIComponent(button.dataset.code);
 const account=Number(button.dataset.account)||button.dataset.account,key='kinetta.privacy-until:'+JSON.stringify(['',account]);
 const uncertainKey=key+':challenge:'+button.dataset.code;
 const pending=()=>{const until=Number(localStorage.getItem(key));if(Number.isFinite(until)&&until>Date.now())return true;localStorage.removeItem(key);return false;};
 let unknown=false,busy=false,waiting=null;
 const unconfirmed=()=>{unknown=true;button.textContent='Retry';status.textContent="Couldn't confirm whether you joined.";};
 try{if(pending()||localStorage.getItem(uncertainKey))unconfirmed();}catch(_){/* A new write must persist its state before dispatch. */}
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(url,{...options,headers:{...options.headers,'X-Kinetta-Account':button.dataset.account},signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Error('Invitation could not be checked.');return data;}finally{clearTimeout(timer);}
 }
 button.onclick=async()=>{
  if(busy||waiting)return;busy=true;button.setAttribute('aria-disabled','true');status.textContent='Checking…';
  try{
   if(pending()){
    unknown=true;status.textContent='Checking…';
    const check=()=>{waiting=null;if(!button.isConnected)return;if(pending()){waiting=setTimeout(check,Math.min(1000,Math.max(1,Number(localStorage.getItem(key))-Date.now())));return;}button.onclick();};
    waiting=setTimeout(check,Math.min(1000,Math.max(1,Number(localStorage.getItem(key))-Date.now())));return;
   }
   if(!unknown){
    // Same finite grace period as the signed-in setting controls; no global GET gate.
    localStorage.setItem(key,String(Date.now()+25000));
    // Expiry allows a read, not another write. Keep uncertainty through reload
    // until this account's membership is actually checked.
    localStorage.setItem(uncertainKey,'1');
    try{await request(path+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});localStorage.removeItem(key);}
    catch(_){unconfirmed();return;}
   }
   const saved=await request(path);if(typeof saved?.member!=='boolean')throw Error();
   localStorage.removeItem(uncertainKey);
   if(saved.member){location.href='/me/challenges/'+encodeURIComponent(button.dataset.code);return;}
   unknown=false;button.textContent='Join challenge';status.textContent='Not joined. Try again.';
  }catch(_){unconfirmed();}
  finally{busy=false;if(!waiting)button.removeAttribute('aria-disabled');}
 };
})();
