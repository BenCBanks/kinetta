// Advance only the page's wall clock past the real 25s recovery deadline.
// Mocked transport suites use this after a failed write, not fabricated status endpoints.
'use strict';
module.exports=async page=>{
 await page.evaluate(()=>{
  const until=Math.max(0,...Object.keys(localStorage).filter(k=>k.startsWith('kinetta.privacy-until:')).map(k=>Number(localStorage.getItem(k))||0));
  if(until>Date.now()){const now=Date.now,offset=until-now()+1;Date.now=()=>now()+offset;}
 });
};
