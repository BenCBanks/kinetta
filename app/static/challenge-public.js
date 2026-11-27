'use strict';
(()=>{
 const button=document.querySelector('#challenge-public-join');if(!button)return;
 const status=document.querySelector('#challenge-public-status'),path='/api/challenges/'+encodeURIComponent(button.dataset.code);let unknown=false;
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(url,{...options,headers:{...options.headers,'X-Kinetta-Account':button.dataset.account},signal:controller.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Error('Invitation could not be checked.');return data;}finally{clearTimeout(timer);}
 }
 button.onclick=async()=>{
  button.disabled=true;status.textContent='Checking invitation…';
  if(!unknown){try{await request(path+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(_){/* The join may already have committed. */}}
  try{const saved=await request(path);if(typeof saved?.member!=='boolean')throw Error();if(saved.member){location.href='/me/challenges/'+encodeURIComponent(button.dataset.code);return;}unknown=false;button.textContent='Join challenge';status.textContent='Not joined. Try again.';}
  catch(_){unknown=true;button.textContent='Retry';status.textContent='Not confirmed. Retry checks the invitation.';}
  finally{button.disabled=false;}
 };
})();
