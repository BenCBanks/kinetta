'use strict';

// Keep handlers installed until their asynchronous fetch/fulfill work finishes.
// Removing them first can let queued routes fall through while a prior callback
// is still preparing its response. Errors remain visible; none are ignored.
function activityRouteFixture(context){
 const pending=new Set();let draining=false;
 return {
  async route(pattern,handler){
   await context.route(pattern,route=>{
    if(draining)return route.abort();
    const task=Promise.resolve().then(()=>handler(route));pending.add(task);
    return task.finally(()=>pending.delete(task));
   });
  },
  async close(){
   draining=true;
   while(pending.size)await Promise.all([...pending]);
   await context.unrouteAll({behavior:'wait'});
   await context.close();
  },
 };
}
module.exports={activityRouteFixture};
