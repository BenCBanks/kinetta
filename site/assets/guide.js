// Filtering stays local; no search terms leave the browser.
'use strict';
(() => {
 const input=document.getElementById('feature-search'),cards=[...document.querySelectorAll('.public-guide-card')];
 const update=()=>{const words=input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);let count=0;
  for(const card of cards){card.hidden=!words.every(w=>card.textContent.toLowerCase().includes(w));if(!card.hidden)count++;}
  document.getElementById('feature-count').textContent=`${count} feature${count===1?'':'s'}`;document.querySelector('.guide-empty').hidden=count>0;
 };input.addEventListener('input',update);update();
})();
