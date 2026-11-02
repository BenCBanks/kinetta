// Actual Weight handlers with fictional replies. No weight write or device action reaches the server.
'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest',out=process.env.KINETTA_SHOTS;
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));assert(project==='kinettatest'||project.startsWith('kt-'));
assert.equal(Number(cp.execFileSync('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],{encoding:'utf8'}).trim()),Number(new URL(base).port));
const until=async(p,f,label)=>{for(let n=0;n<160;n++){if(await p.evaluate(f))return;await p.waitForTimeout(75);}throw Error(label);};
(async()=>{const browser=await chromium.launch();let cases=0;try{
 const auth=await browser.newContext();assert.equal((await auth.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const me=await(await auth.request.get(base+'/api/me')).json(),state=await auth.storageState();await auth.close();
 const today=new Date().toLocaleDateString('en-CA',{timeZone:me.tz||'UTC'}),previous=new Date(new Date(today+'T12:00Z').valueOf()-86400000).toISOString().slice(0,10),identity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const size of[{width:390,height:844,root:16},{width:330,height:740,root:24}])for(const theme of['light','dark']){
  const original=[{day:previous,kg:71,trend:71,source:'healthkit',source_label:'Apple Health · Fictional Scale'},{day:today,kg:70,trend:70.9,source:'manual',source_label:'Manual'}];let points=original.slice(),deleteCalls=0,undoCalls=0,failDelete=false,failUndo=false,restored=false;
  const c=await browser.newContext({storageState:state,viewport:size,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'}),p=await c.newPage(),errors=[],writes=[],dialogs=[];
  try{
   p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>{dialogs.push(d.type());d.dismiss();});
   await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();
    if(u.pathname==='/api/food/weights'&&q.method()==='GET')return r.fulfill({json:{points,trend_kg:70.9,rate_kg_per_week:null}});
    if(u.pathname==='/api/food/weights/'+previous&&q.method()==='DELETE'){deleteCalls++;if(failDelete){failDelete=false;return r.fulfill({status:503,json:{detail:'Fictional delete unavailable'}});}points=points.filter(x=>x.day!==previous);restored=false;return r.fulfill({json:{ok:true,undo_id:identity}});}
    if(u.pathname==='/api/food/weights/undo'&&q.method()==='POST'){undoCalls++;assert.deepEqual(q.postDataJSON(),{id:identity,confirmed:true});if(failUndo){failUndo=false;return r.fulfill({status:503,json:{detail:'Fictional Undo unavailable'}});}const replayed=restored;points=original.slice();restored=true;return r.fulfill({json:{ok:true,replayed}});}
    if(u.pathname==='/api/me'){const response=await r.fetch(),body=await response.json();return r.fulfill({response,json:{...body,weight_kg:70,weight_health_derived:false}});}
    if(!['GET','HEAD'].includes(q.method())){if(u.pathname==='/api/challenges/signup/continue')return r.fulfill({json:{}});writes.push(u.pathname);return r.abort();}return r.continue();
   });
   const ready=async()=>{await p.goto(base+'/progress/weight');await until(p,()=>App.pageReady&&document.querySelectorAll('.weight-history-row').length===2,'Initial weight history');};
   const remove=()=>p.locator('[data-del="'+previous+'"]').click();
   const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,`${name}-${size.width}-${theme}.png`)});}};
   await ready();const draft=await p.evaluate(()=>imp()?'163.4':'73.6');await p.locator('.wform input').fill(draft);await p.evaluate(()=>globalThis.weightDraftField=document.querySelector('.wform input'));
   await remove();await until(p,()=>document.querySelectorAll('.weight-history-row').length===1&&document.querySelector('#toast.on button'),'Deleted with Undo');assert.equal(await p.locator('.wform input').inputValue(),draft);assert(await p.evaluate(()=>weightDraftField===document.querySelector('.wform input')),'Deletion retains the actual unsaved input');await shot('weight-deleted');
   await p.locator('#toast button').click();await until(p,()=>document.querySelectorAll('.weight-history-row').length===2&&document.querySelector('#toast.on')?.textContent.includes('restored'),'Undo restores history');assert.equal(await p.locator('.wform input').inputValue(),draft);assert.match(await p.locator('#nt-whist').innerText(),/Apple Health · Fictional Scale/);assert.equal(undoCalls,1);await shot('weight-restored');cases++;
   failDelete=true;await remove();await until(p,()=>document.querySelector('#toast.on')?.textContent.includes('delete unavailable'),'Failed delete');assert.equal(await p.locator('.weight-history-row').count(),2);assert.equal(await p.locator('[data-del="'+previous+'"]').isDisabled(),false);cases++;
   await remove();await until(p,()=>!!document.querySelector('#toast.on button'),'Second Undo offered');failUndo=true;await p.locator('#toast button').click();await until(p,()=>document.querySelector('#toast.on')?.textContent.includes('Undo unavailable'),'Failed Undo keeps retry');assert.equal(await p.locator('.weight-history-row').count(),1);assert(await p.locator('#toast button').isVisible());await p.locator('#toast button').click();await until(p,()=>document.querySelectorAll('.weight-history-row').length===2,'Undo retry');assert.equal(await p.locator('.wform input').inputValue(),draft);cases++;
   await remove();await until(p,()=>!!document.querySelector('#toast.on button'),'Account guard Undo');const before=undoCalls;await p.evaluate(()=>App.me.id+=1000000);await p.locator('#toast button').click();await p.waitForTimeout(100);assert.equal(undoCalls,before,'A stale Undo never writes to another account');cases++;
   assert.equal(deleteCalls,4);assert.deepEqual(dialogs,[],'Delete and Undo need no confirmation dialog');assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('Weight Undo '+size.width+'/'+size.root+' '+theme+' PASS');
  }finally{await c.close();}
 }
 }finally{await browser.close();}console.log('Weight Undo: '+cases+' browser cases passed; product writes blocked');
})().catch(e=>{console.error(e);process.exit(1)});
