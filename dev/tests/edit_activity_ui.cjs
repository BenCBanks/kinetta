// Edit activity (Ben, 30 Oct 2026): Cancel · Save stay pinned at the top while the form scrolls, the order puts the
// common choices first, Delete sits alone at the bottom, and closing with changes asks first. Fictional demo account;
// every write is intercepted, so nothing is saved or deleted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
// Poll with page.evaluate: the app's Content Security Policy forbids the string evaluation waitForFunction uses.
async function until(page,fn,label,arg){for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);}
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
const [act]=await(await l.request.get(base+'/api/activities?limit=1')).json();assert(act,'demo activity');
for(const size of [{width:390,height:844,root:16}])for(const theme of ['light','dark']){
 const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));
 await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
 await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+u.pathname);return r.fulfill({json:{}});}return r.continue();});
 const shot=async name=>{if(out&&size.root===16){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${theme}.png`});}};
 const open=async()=>{await p.locator('#d-edit').click();await p.waitForSelector('.sheet.pinned #e-form');await p.waitForSelector('#e-share .seg');await p.waitForTimeout(400);}; // let the sheet finish sliding in
 await p.goto(base+'/activity/'+act.id);await until(p,()=>App.pageReady,'page');await open();
 const sheet=p.locator('.sheet.pinned'),head=sheet.locator('header'),save=head.locator('button[form="e-form"]'),cancel=head.locator('[data-close]');
 assert.equal((await save.innerText()).trim(),'Save');assert.equal((await cancel.innerText()).trim(),'Cancel');
 for(const button of [save,cancel]){const bb=await button.boundingBox();assert(bb.height>=43.5&&bb.width>=43.5,'44px header buttons (sub-pixel while the sheet slides in) '+JSON.stringify(bb));}
 // Order: title, kind, who can see it, notes, then the grouped details; Delete last, alone, not beside Save.
 const order=await p.$$eval('#e-form > *',e=>e.map(x=>x.id||x.className||x.tagName));
 const at=k=>order.findIndex(x=>x.includes(k));
 assert(at('e-share')<at('e-details-head')&&at('e-details-head')<at('e-summary')&&at('e-del')===order.length-1,'order: '+order.join(','));
 assert.equal(await p.locator('#e-form .actions').count(),0,'no bottom button row');
 assert.match(await p.locator('#e-share').innerText(),/Choose what’s shared/);
 const top0=(await head.boundingBox()).y;await shot('edit-open');
 // Scroll to the bottom: the header (and Save) stays where it was; Delete is reachable.
 await sheet.evaluate(n=>n.scrollTo(0,n.scrollHeight));await p.waitForTimeout(200);
 // Only the small grab bar scrolls away; the header then sits flush with the sheet's top edge.
 const [hy,sy]=[(await head.boundingBox()).y,(await sheet.boundingBox()).y];assert(hy>=sy-1&&hy<=top0,'header stays pinned at the top: '+hy+' sheet '+sy);assert(await save.isVisible());
 await p.locator('#e-del').scrollIntoViewIfNeeded();await shot('edit-bottom');
 // Untouched: Cancel closes at once.
 await cancel.click();await p.waitForSelector('.scrim',{state:'detached'});
 // Changed: Cancel asks; dismissing the question keeps the sheet and the draft; accepting discards.
 await open();await p.locator('#e-form input[name="name"]').fill('Draft title kept');
 // The question is the shared confirm sheet: Keep editing on the left, red Discard on the right.
 const ask=async()=>{await p.locator('.confirm-sheet').waitFor();assert.equal(await p.getByRole('alertdialog',{name:'Discard your changes?'}).count(),1);const [keep,discard]=await p.locator('.confirm-sheet .btnrow button').all();assert.equal(await keep.innerText(),'Keep editing');assert.equal(await discard.innerText(),'Discard');for(const b of [keep,discard])assert((await b.boundingBox()).height>=44,'44px confirm buttons');assert((await keep.boundingBox()).x<(await discard.boundingBox()).x,'Cancel sits left of the action');};
 await cancel.click();await ask();await shot('discard-confirm');await p.locator('[data-confirm-cancel]').click();await p.locator('.confirm-sheet').waitFor({state:'detached'});assert.equal(await p.locator('#e-form input[name="name"]').inputValue(),'Draft title kept','draft kept');
 await p.keyboard.press('Escape');await ask();await p.keyboard.press('Escape');await p.locator('.confirm-sheet').waitFor({state:'detached'});assert.equal(await p.locator('.sheet.pinned').count(),1,'Escape asks too, and Escape on the question keeps editing');
 // Save from the pinned header sends the edit (intercepted) and closes without asking.
 await save.click();await p.waitForSelector('.scrim',{state:'detached'});
 assert(writes.some(w=>w==='PATCH /api/activities/'+act.id),'saved from the header: '+writes.join(','));
 await open();await p.locator('#e-form select[name="kind"]').selectOption({index:1});await cancel.click();await ask();await p.locator('[data-confirm-ok]').click();await p.waitForSelector('.scrim',{state:'detached'});assert.equal(writes.filter(w=>w.startsWith('PATCH')).length,1,'a changed choice asks, and Discard closes without saving');
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no overflow');
 assert.deepEqual(errors,[]);assert.equal(writes.filter(w=>w.startsWith('DELETE')).length,0,'nothing deleted');
 console.log(`Edit activity ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
