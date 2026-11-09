// One shared confirm sheet (#763): no browser confirm() boxes remain, Cancel sits left of the named action,
// and only the action button answers yes. Escape, the scrim, a swipe and Cancel all answer no.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir='app/static';
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){
  const lines=fs.readFileSync(path.join(dir,file),'utf8').split('\n');
  // The browser box always takes a message; a local confirm(photos) helper in food.js is a different function.
  lines.forEach((line,i)=>assert(!/(^|[^.\w])(window\.)?confirm\(\s*['"`]/.test(line),`${file}:${i+1} uses the browser confirm(); use confirmSheet()`));
}
const source=fs.readFileSync('app/static/app.js','utf8'),code=source.slice(source.indexOf('function confirmSheet('),source.indexOf('// ---------- router'));
(async()=>{
  let last;const buttons={};
  const c={esc:s=>String(s).replace(/</g,'&lt;'),$:(sel)=>buttons[sel],sheet:(title,html,mount,opts)=>{let shut=false;const close=()=>{if(shut)return;shut=true;opts.onClose();};last={title,html,close};mount({},close);}};
  vm.createContext(c);vm.runInContext(code,c);
  for(const key of ['[data-confirm-cancel]','[data-confirm-ok]'])buttons[key]={};
  let answer=c.confirmSheet('Delete <b>this</b>?',{body:'It is removed.',action:'Delete'});
  assert.equal(last.title,'Delete <b>this</b>?');
  assert(last.html.indexOf('data-confirm-cancel')<last.html.indexOf('data-confirm-ok'),'Cancel comes first (left)');
  assert.match(last.html,/class="primary danger-btn" data-confirm-ok>Delete</);assert.match(last.html,/<p>It is removed\.<\/p>/);
  buttons['[data-confirm-ok]'].onclick();assert.equal(await answer,true,'the action answers yes');
  answer=c.confirmSheet('Restart this plan?',{action:'Restart',danger:false});assert.match(last.html,/class="primary" data-confirm-ok>Restart</);assert(!last.html.includes('<p>'),'no empty body line');
  buttons['[data-confirm-cancel]'].onclick();assert.equal(await answer,false,'Cancel answers no');
  answer=c.confirmSheet('Remove this photo?',{action:'Remove'});last.close();assert.equal(await answer,false,'Escape, scrim or swipe answers no');
  answer=c.confirmSheet('Discard?',{action:'Discard',cancel:'Keep editing'});assert.match(last.html,/data-confirm-cancel>Keep editing</);buttons['[data-confirm-ok]'].onclick();buttons['[data-confirm-cancel]'].onclick();assert.equal(await answer,true,'the first choice wins');
  console.log('Confirm sheet: no browser confirm(), Cancel left, named action right, only the action answers yes PASS');
})().catch(e=>{console.error(e);process.exit(1);});
