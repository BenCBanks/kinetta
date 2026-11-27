'use strict';

// Serialized into the page by Playwright: timestamps share performance.now()'s clock.
function openCommentsWithMetrics({id, initial}) {
 const metrics=window.__commentsOpenPerf={openedAt:performance.now(),shifts:[],heights:[],rowTimes:[],stop:false};
 try {
  metrics.observer=new PerformanceObserver(list=>metrics.shifts.push(...list.getEntries()
   .filter(entry=>!entry.hadRecentInput&&entry.startTime>=metrics.openedAt).map(entry=>entry.value)));
  // Keep buffered entries: a shift during opening may be delivered in a later batch.
  metrics.observer.observe({type:'layout-shift',buffered:true});
 } catch {}
 const sample=()=>{
  const sheet=document.querySelector('.social-sheet-round3')?.closest('.sheet'),rows=document.querySelectorAll('.social-sheet-round3 .comment').length;
  if(sheet)metrics.heights.push(sheet.getBoundingClientRect().height);
  metrics.rowTimes.push({at:performance.now(),rows});
  if(!metrics.stop)requestAnimationFrame(sample);
 };
 requestAnimationFrame(sample);
 commentsSheet(id,initial);
}
module.exports={openCommentsWithMetrics};
