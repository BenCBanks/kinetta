// Fictional archive preview + sharing stand-ins. No archive upload, import or provider call.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initialize}=require('./spacing_screens.cjs');
async function exercise(browser,base){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
 for(const width of [320,390])for(const theme of ['light','dark'])for(const native of [false]){
  const fixture=require('./native-ui/appstore.cjs')(true),errors=[],unknown=[],writes=[];
  const upload={id:'11111111-1111-4111-8111-111111111111',state:'review',size:100,received:100,preview:{added:12,already_here:3,unreadable:1}};
  let audience='everyone',mode='saved',stageReads=0,confirms=0,release,entered;
  const c=await browser.newContext({viewport:{width,height:width===390?844:667},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:true,hasTouch:true});
  try{
   await c.addInitScript(initialize,{root:16,native,base,token:'fictional-import-privacy',id:1});
   await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url()),key=u.pathname;
    if(u.origin!==base){unknown.push(u.origin);return r.abort();}
    if(!key.startsWith('/api/'))return r.continue();
    if(key==='/api/imports')return r.fulfill({json:[]});
    if(key==='/api/strava-import/stage'){stageReads++;return mode==='read-failed'?r.fulfill({status:503,json:{detail:'Check privacy again.'}}):r.fulfill({json:{upload,current_audience:audience}});}
    if(key==='/api/sharing'){
     if(q.method()==='PUT'){writes.push({key,body:q.postDataJSON()});assert.deepEqual(Object.keys(q.postDataJSON()),['default']);if(mode!=='rejected')audience=q.postDataJSON().default;
      if(mode==='delayed')await new Promise(resolve=>{release=resolve;entered();});
      if(mode==='lost')return r.abort('failed');
     }
     return r.fulfill({json:{default:audience}});
    }
    if(key.endsWith('/confirm')){confirms++;assert.deepEqual(q.postDataJSON(),{confirm:true,audience});upload.state='importing';return r.fulfill({json:upload});}
    if(['/api/challenges/signup/continue','/api/milestones/celebrate'].includes(key))return r.fulfill({json:{items:[],pending:false}});
    if(q.method()!=='GET'){unknown.push(q.method()+' '+key);return r.abort();}
    if(!Object.hasOwn(fixture.responses,key)){unknown.push(key);return r.fulfill({status:404,json:{detail:'Unprovided fictional fixture'}});}
    return r.fulfill({json:fixture.responses[key]});
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date(fixture.now));await p.goto(base+'/track/import');await p.locator('[data-upload=privacy]').waitFor();await p.waitForFunction(()=>!document.querySelector('#u-file').disabled,{},{timeout:10000});
   const capture=async state=>{if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.SHOT_DIR,`import-${state}-${width}-${theme}-${native?'bridge':'web'}.png`),animations:'disabled'});}};
   const row=await p.locator('.upload-privacy').boundingBox();assert(row&&row.height>=44&&row.x>=0&&row.x+row.width<=width,'audience is a full visible 44px target');await capture('review');const open=async()=>{await p.locator('[data-upload=privacy]').click();await p.locator('#upload-privacy-form').waitFor();};
   const save=async value=>{await p.locator('#upload-privacy-form select').selectOption(value);await p.getByRole('button',{name:'Save privacy',exact:true}).click();};
   await open();assert.match(await p.locator('#upload-privacy-form').innerText(),/Includes this import. Existing activities keep their audience/);await capture('sheet');
   await p.locator('#upload-privacy-form select').selectOption('me');await p.getByRole('button',{name:'Close',exact:true}).click();assert.equal(writes.length,0,'cancel never saves');assert.equal(confirms,0);
   await open();const beforeRead=stageReads;await save('me');await p.locator('#upload-privacy-form').waitFor({state:'detached'});assert(stageReads>beforeRead,'saved sharing is rechecked against the import stage');assert.match(await p.locator('.upload-privacy').innerText(),/Only me/);assert.equal(confirms,0,'saving privacy never starts import');assert.equal(new URL(p.url()).pathname,'/track/import','no navigation out of preview');await capture('saved');
   mode='rejected';await open();await save('friends');await p.locator('.setting-recovery').filter({hasText:'Not saved'}).waitFor();assert.equal(await p.locator('#upload-privacy-form select').inputValue(),'friends','rejected choice retained for explicit retry');assert.equal(confirms,0);assert.match(await p.locator('.upload-privacy').innerText(),/Only me/);await p.getByRole('button',{name:'Close',exact:true}).click();
   mode='read-failed';await open();await save('friends');await p.locator('.setting-recovery').filter({hasText:'Privacy not confirmed'}).waitFor();assert.match(await p.locator('.upload-privacy').innerText(),/Check privacy/,'failed readback cannot show an unconfirmed audience');await p.getByRole('button',{name:'Close',exact:true}).click();
   mode='saved';await p.locator('[data-upload=confirm]').click();await p.locator('.upload-error').filter({hasText:'privacy changed'}).waitFor();assert.equal(confirms,0,'unknown displayed privacy requires fresh review before import');assert.match(await p.locator('.upload-privacy').innerText(),/Friends/);
   // Lost response: read-only reconciliation after the outstanding-write fence, never an automatic second PUT.
   mode='lost';await open();await save('me');await p.locator('.setting-recovery').filter({hasText:'Privacy not confirmed'}).waitFor();const writeCount=writes.length;
   await p.clock.setFixedTime(new Date(new Date(fixture.now).getTime()+26000));mode='saved';await p.locator('.setting-recovery button').click();await p.locator('.setting-recovery').waitFor({state:'hidden'});assert.equal(writes.length,writeCount);assert.match(await p.locator('.upload-privacy').innerText(),/Only me/);await p.getByRole('button',{name:'Close',exact:true}).click();
   audience='everyone';await p.locator('[data-upload=confirm]').click();await p.locator('.upload-error').filter({hasText:'privacy changed'}).waitFor();assert.equal(confirms,0,'later saved-default change still requires another Import tap');
   // A pending save cannot paint a different account or leave its sheet open on route disposal.
   mode='delayed';await open();const pending=new Promise(resolve=>{entered=resolve;});await save('friends');await pending;
   await p.evaluate(()=>{forgetKept();App.me={...App.me,id:999};go('/track');});await p.waitForURL(base+'/track');release();await p.locator('#upload-privacy-form').waitFor({state:'detached'});assert.notEqual(await p.evaluate(()=>App.me.share_default),'friends');assert.equal(confirms,0);assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
   console.log(`Import privacy ${width}/${theme}/${native?'bridge':'web'}: explicit save, cancel, saved/rejected/readback/lost reply/stale audience/account fences PASS`);
  }finally{release?.();await c.close();}
 }
}
module.exports=exercise;
if(require.main===module){const {chromium,webkit}=require('playwright');(async()=>{const b=await(process.env.UI_BROWSER==='webkit'?webkit:chromium).launch();try{await exercise(b,process.env.KINETTA_URL||'http://localhost:8798');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});}
