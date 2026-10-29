// The real title writer retains an unsaved name and offers a working retry, even with no ingredients yet.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/cook.js','utf8'),code=source.slice(source.indexOf('  const nm ='),source.indexOf("  wireSeg(el, 'sv'"));
(async()=>{
  const title={value:'Fictional new title',style:{},scrollHeight:40},status={textContent:'',innerHTML:''},retry={},rename={};let attempts=0,live=true;
  const c={d:{id:99,name:'Untitled recipe'},el:{},active:()=>live,App:{cache:new Map()},api:async()=>{if(++attempts===1)throw Error('Temporary failure');return {id:99,name:title.value};},json:(method,body)=>({method,body}),toast(){},$:(s)=>({'#dk-name':title,'#recipe-title-status':status,'#dk-title-retry':retry,'#dk-rename':rename}[s])};
  vm.createContext(c);vm.runInContext(code,c);
  await title.onchange();assert.equal(title.value,'Fictional new title');assert.match(status.innerHTML,/Title not saved/);assert.equal(c.d.name,'Untitled recipe');assert.equal(typeof retry.onclick,'function');
  await retry.onclick();assert.equal(attempts,2);assert.equal(status.textContent,'Title saved');assert.equal(c.d.name,'Fictional new title');
  live=false;title.value='Old account draft';await title.onchange();assert.equal(attempts,2,'a stale editor cannot write into a new session');
  assert(!source.includes('Tap Done to try again'),'recovery names a control that exists');
  console.log('Recipe title: failed save keeps the draft, explicit retry works without ingredients, stale editor cannot write PASS');
})().catch(e=>{console.error(e);process.exit(1)});
