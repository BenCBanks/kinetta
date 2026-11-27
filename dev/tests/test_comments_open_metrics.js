'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const {openCommentsWithMetrics}=require('./comments_open_metrics.cjs');
let callback,observed,opened,frame,disconnected=false;
const context={window:{},performance:{now:()=>100},
 PerformanceObserver:class {
  constructor(fn){callback=fn;}
  observe(options){observed=options;}
  disconnect(){disconnected=true;}
 },
 requestAnimationFrame:fn=>{frame=fn;},
 document:{querySelector:()=>({closest:()=>({getBoundingClientRect:()=>({height:506.4})})}),querySelectorAll:()=>[{},{}]},
 commentsSheet:(id,initial)=>{opened={id,initial};},
};
vm.runInNewContext('('+openCommentsWithMetrics.toString()+')({id:7,initial:{comments:[]}})',context);
const metrics=context.window.__commentsOpenPerf;
assert.equal(opened.id,7);assert.equal(metrics.openedAt,100);
assert.equal(observed.type,'layout-shift');assert.equal(observed.buffered,true);
const deliver=entries=>callback({getEntries:()=>entries});
deliver([{startTime:83,value:.01541,hadRecentInput:false}]);
assert.equal(metrics.shifts.length,0,'buffered activity-page shifts before opening are excluded');
deliver([{startTime:100,value:.0002,hadRecentInput:false},{startTime:101,value:.0003,hadRecentInput:false},{startTime:102,value:.5,hadRecentInput:true}]);
assert.equal(metrics.shifts.reduce((sum,value)=>sum+value,0),.0005,'opening boundary and later shifts still count; recent input is excluded');
deliver([{startTime:110,value:.002,hadRecentInput:false}]);
assert(metrics.shifts.reduce((sum,value)=>sum+value,0)>.001,'a genuine shift during opening still exceeds the unchanged CLS assertion');
frame();assert.equal(metrics.heights[0],506.4);assert.equal(metrics.rowTimes[0].rows,2);
metrics.stop=true;metrics.observer.disconnect();assert(disconnected);
console.log('Comments layout-shift window: buffered pre-open excluded; opening/later movement still fails at .001 PASS');
