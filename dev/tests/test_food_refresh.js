// A late food write refreshes the visible log once without replacing a newer page/account or active chat.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/food.js','utf8');let listener,frame,draws=0,owner='one',page={};
const c={document:{addEventListener:(name,fn)=>{assert.equal(name,'food:changed');listener=fn;}},location:{pathname:'/food'},readOwner:()=>owner,$:()=>page,requestAnimationFrame:fn=>{frame=fn;return 1;},render:()=>draws++};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let foodRefreshFrame='),source.indexOf('const refresh =')),c);
listener();listener();assert(frame);frame();assert.equal(draws,1,'coalesce invalidations for the same visible food page');
listener();owner='two';frame();assert.equal(draws,1,'old account completion cannot redraw the new account');
listener();page={};frame();assert.equal(draws,1,'a replaced page is not redrawn');
c.location.pathname='/food/describe';frame=null;listener();assert.equal(frame,null,'do not replace a conversation or draft');
console.log('Food refresh: late writes coalesce; route, page and account guards preserve active work');
