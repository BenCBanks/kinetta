// Exercise the actual detail-route read block with a deliberately delayed optional milestone response.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('  const milestoneOwner=readOwner()'),end=source.indexOf('\n});',start);
 let finish,owner='fictional-first',drawn=0,painted=0;
 const c={readOwner:()=>owner,Milestones:{read:()=>new Promise(resolve=>finish=resolve),paint:()=>painted++},load:async(path,draw)=>draw({owner:true}),drawDetail:()=>drawn++,$:()=>({})};
 vm.createContext(c);vm.runInContext('this.detail=async(el,id)=>{'+source.slice(start,end)+'};',c);
 const shortcuts=source.slice(source.indexOf('const ME_SHORTCUTS ='),source.indexOf(';',source.indexOf('const ME_SHORTCUTS ='))+1);vm.runInContext(shortcuts+'this.shortcuts=ME_SHORTCUTS;',c);assert(!c.shortcuts.some(([href])=>href.startsWith('/routes')),'The home shortcuts cannot expose the retired route library');assert(c.shortcuts.some(([href])=>href==='/progress/routes'),'Completed matched-route comparisons remain reachable');
 await c.detail({isConnected:true},42);assert.equal(drawn,1,'A pending celebration cannot delay the actual workout');assert.equal(painted,0);
 finish({items:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(painted,1);
 await c.detail({isConnected:true},43);owner='fictional-second';finish({items:[{}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(painted,1,'A late celebration cannot enter a new account');
 console.log('Activity detail loads before optional milestones; late-account decoration is discarded PASS');
})().catch(error=>{console.error(error);process.exit(1)});
