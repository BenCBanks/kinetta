// Rendered settings and destination controls. Fictional preferences; all actual writes/delivery blocked.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
async function until(p,test){for(let n=0;n<120;n++){if(await p.evaluate(test))return;await p.waitForTimeout(100);}throw Error('Control did not settle');}
async function ready(p){for(let n=0;n<120;n++){if(await p.evaluate(()=>App.pageReady))return;await p.waitForTimeout(100);}throw Error('View did not settle');}
(async()=>{
 const browser=await chromium.launch();
 try{
  const login=await browser.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const auth=await login.storageState();await login.close();
  for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16},{width:330,height:844,root:24},{width:1280,height:900,root:16}])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:auth,viewport:{width:size.width,height:size.height},colorScheme:theme,serviceWorkers:'block'}),p=await c.newPage(),errors=[],writes=[],puts=[];let state={plan:false,weekly:false,plan_time:'08:00',tz:'America/New_York',push_ready:true,device_ready:true},failRead=false,failWrite=false,hold=false,release;
   const held=async()=>{for(let n=0;n<100;n++){if(release)return;await p.waitForTimeout(50);}throw Error('Preference request did not reach the controlled hold');};
   p.on('pageerror',e=>errors.push(e.message));await c.addInitScript(root=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=root+'px'),size.root);
   await c.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await c.route('**/api/**',async r=>{
    const q=r.request(),path=new URL(q.url()).pathname;
    if(path==='/api/challenges/signup/continue')return r.fulfill({json:{}});
    if(path==='/api/notifications/personal'){
     if(q.method()==='PUT'){
      const data=q.postDataJSON();puts.push(data);if(hold)await new Promise(resolve=>release=resolve);
      if(failWrite){failWrite=false;return r.fulfill({status:503,json:{detail:'Fictional save unavailable'}});}
      state={...state,...Object.fromEntries(Object.entries(data).filter(([k])=>k!=='confirmed'))};return r.fulfill({json:state});
     }
     if(failRead){failRead=false;return r.fulfill({status:503,json:{detail:'Fictional read unavailable'}});}
     return r.fulfill({json:state});
    }
    if(!['GET','HEAD','OPTIONS'].includes(q.method())){writes.push(path);return r.abort();}
    return r.continue();
   });
   await p.goto(base+'/me/notifications');await ready(p);await p.locator('[data-personal=plan]').waitFor();assert.equal(puts.length,0);assert(!(await p.locator('[data-personal=plan]').isChecked()));assert(!(await p.locator('[data-personal=weekly]').isChecked()));
   hold=true;release=null;await p.locator('[data-personal=plan]').check();await p.locator('[data-personal-status]').filter({hasText:'Saving'}).waitFor();await held();assert.equal(await p.locator('[data-personal]:disabled').count(),2);await p.locator('[data-personal=weekly]').evaluate(el=>el.click());assert.equal(puts.length,1);assert(puts[0].confirmed);hold=false;release();await until(p,()=>!document.querySelector('[data-personal=plan]').disabled);assert(await p.locator('[data-personal=plan]').isChecked());
   await p.locator('[data-personal=plan_time]').focus();await p.locator('[data-personal=plan_time]').selectOption('18:00');await until(p,()=>!document.querySelector('[data-personal=plan_time]').disabled);assert.equal(puts.at(-1).confirmed,false);assert.equal(await p.evaluate(()=>document.activeElement.dataset.personal),'plan_time','Saved control retains keyboard focus');
   failWrite=true;hold=true;release=null;await p.locator('[data-personal=weekly]').check();await held();await p.evaluate(()=>personalNotificationCard(document.querySelector('#nt-personal')));hold=false;release();await p.getByRole('status').filter({hasText:'Fictional save unavailable'}).waitFor();assert(!(await p.locator('[data-personal=weekly]').isChecked()));
   if(out){fs.mkdirSync(out,{recursive:true});await p.locator('.personal-notifications').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await p.screenshot({path:`${out}/personal-error-${size.width}-${size.root}-${theme}.png`});}
   await p.locator('[data-personal=weekly]').check();await until(p,()=>!document.querySelector('[data-personal=weekly]').disabled);assert(await p.locator('[data-personal=weekly]').isChecked());
   await p.reload();await ready(p);await p.locator('[data-personal=plan]').waitFor();assert(await p.locator('[data-personal=plan]').isChecked());assert.equal(await p.locator('[data-personal=plan_time]').inputValue(),'18:00');
   if(out){fs.mkdirSync(out,{recursive:true});await p.locator('.personal-notifications').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await p.waitForTimeout(150);await p.screenshot({path:`${out}/personal-${size.width}-${size.root}-${theme}.png`});}
   failRead=true;await p.reload();await ready(p);await p.getByText('Notification settings could not load.',{exact:true}).waitFor();await p.locator('#nt-personal').getByRole('button',{name:'Retry',exact:true}).click();await p.locator('[data-personal=plan]').waitFor();
   state={...state,push_ready:false,device_ready:false};await p.reload();await ready(p);await p.locator('[data-personal=plan]').waitFor();assert(!(await p.locator('[data-personal=plan]').isDisabled()),'Off remains available');await p.locator('[data-personal=plan]').uncheck();await until(p,()=>document.querySelector('[data-personal=plan]').disabled);assert(!(await p.locator('[data-personal=plan]').isChecked()));
   await p.goto(base+'/progress?section=activity&review=week');await ready(p);await p.locator('.combined-week[open]').waitFor();assert(await p.getByText('Your week in review',{exact:true}).isVisible());
   if(out)await p.screenshot({path:`${out}/weekly-${size.width}-${size.root}-${theme}.png`});
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();console.log(`Personal notifications/settings/retry/summary: ${size.width}px/${size.root}px ${theme} PASS`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
