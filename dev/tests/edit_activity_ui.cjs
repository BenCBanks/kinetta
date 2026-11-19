// Edit activity (Ben, 30 Oct 2026): Cancel · Save stay pinned at the top while the form scrolls, the order puts the
// common choices first, Delete sits alone at the bottom, and closing with changes asks first. Fictional demo account;
// every write is intercepted, so nothing is saved or deleted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
function assertActivityStylesOwned(){const shared=fs.readFileSync(path.resolve(__dirname,'../../app/static/style.css'),'utf8'),owned=fs.readFileSync(path.resolve(__dirname,'../../app/static/activity-detail.css'),'utf8');assert.doesNotMatch(shared,/\.activity-edit-/,'Edit Activity selectors stay out of shared style.css');assert.doesNotMatch(shared,/\.sheet\.pinned header/,'Pinned activity editor header stays out of shared style.css');assert.match(owned,/\.activity-edit-form\s*\{/,'Edit Activity form styles belong to activity-detail.css');assert.match(owned,/\.sheet\.pinned header\s*\{/,'Pinned activity header styles belong to activity-detail.css');}
assertActivityStylesOwned();
// Poll with page.evaluate: the app's Content Security Policy forbids the string evaluation waitForFunction uses.
async function until(page,fn,label,arg){for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);}
(async()=>{const b=await chromium.launch();const l=await b.newContext();await l.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});const st=await l.storageState();
const activities=await(await l.request.get(base+'/api/activities?limit=50')).json(),act=activities.find(a=>a.sport==='run'&&!(a.photos||[]).length)||activities.find(a=>!(a.photos||[]).length);assert(act,'demo activity without photos');
for(const size of [{width:390,height:844,root:16},{width:330,height:667,root:16}])for(const theme of ['light','dark']){
 const c=await b.newContext({storageState:st,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));
 await c.addInitScript(r=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=r+'px'),size.root);
 await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base)return r.abort();if(q.method()==='GET'&&u.pathname==='/api/activity-photos/900001')return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#2e80bd"/></svg>'});if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+u.pathname);if(q.method()==='POST'&&/\/api\/activities\/\d+\/photos$/.test(u.pathname))return r.fulfill({json:{id:900001,w:64,h:48}});return r.fulfill({json:{}});}return r.continue();});
 const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/${name}-${size.width}-${theme}.png`});}};
 const open=async()=>{await p.locator('#d-edit').click();await p.waitForSelector('.sheet.pinned #e-form');await p.waitForSelector('#e-visibility-value:not(:text-is("Loading…"))');await p.waitForTimeout(400);}; // let the sheet finish sliding in
 await p.goto(base+'/activity/'+act.id);await until(p,()=>App.pageReady,'page');await open();
 const sheet=p.locator('.sheet.pinned'),head=sheet.locator('header'),save=head.locator('button[form="e-form"]'),cancel=head.locator('[data-close]');
 assert.equal((await save.innerText()).trim(),'Save');assert.equal((await cancel.innerText()).trim(),'Cancel');
 for(const button of [save,cancel]){const bb=await button.boundingBox();assert(bb.height>=43.5&&bb.width>=43.5,'44px header buttons (sub-pixel while the sheet slides in) '+JSON.stringify(bb));}
 // Order: title, sport, photos, description, visibility, then More details.
 const order=await p.$$eval('#e-primary > *',e=>e.map(x=>x.id||x.querySelector('input,select,textarea')?.name||x.className||x.tagName));
 const at=k=>order.findIndex(x=>x.includes(k));
 assert(at('name')>=0&&at('kind')>at('name')&&at('activity-edit-photos')>at('kind')&&at('e-description')>at('activity-edit-photos')&&at('e-visibility-open')>at('e-description')&&at('e-more')>at('e-visibility-open'),'order: '+order.join(','));
 assert.equal(await p.locator('#e-photo-count').innerText(),'0 of 10','photo count uses the existing activity limit');assert.equal((await p.locator('#e-photos .ph-add').innerText()).trim(),'Add photos','empty state is one plain Add photos action');
 assert.equal(await p.locator('#e-form .actions').count(),0,'no bottom button row');
 assert.equal(await p.locator('#e-visibility-view').isHidden(),true,'Visibility starts as a row');
 assert.match(await p.locator('#e-visibility-value').innerText(),/Only me|Friends|Everyone/,'row shows the current audience');
 assert.match(await p.locator('#e-description [data-opt="description"]').innerText(),/Add description/,'description starts as one action row');
 await p.locator('#e-visibility-open').click();await p.locator('#e-visibility-view').waitFor({state:'visible'});await p.locator('#e-share-fields .seg').waitFor();
 assert(await p.locator('#e-primary').isHidden(),'opening Visibility replaces the main form with a sub-view');assert.match(await p.locator('#e-share-fields').innerText(),/Choose what’s shared/);assert.match(await p.locator('#e-share-fields .vis-note').innerText(),/Only you|Friends you have approved|Anyone with an account/);
 for(const option of await p.locator('#e-share-fields [data-vis]').all()){const box=await option.boundingBox();assert(box&&box.height>=48,'Visibility choice has a 48px target: '+JSON.stringify(box));}
 const selected=p.locator('#e-share-fields [data-vis][aria-pressed="true"]');assert.equal(await selected.count(),1,'one audience is selected');assert(await selected.locator('.activity-vis-check').isVisible(),'selection uses a checkmark');
 await shot('edit-visibility');await p.locator('#e-visibility-back').click();assert(await p.locator('#e-primary').isVisible(),'Back returns to the editor');
 await p.locator('#e-more > summary').click();assert(await p.locator('#e-summary').isVisible());assert(await p.locator('#e-form select[name="gear"]').isVisible());assert(await p.locator('#e-private-note [data-opt="private_note"]').isVisible());
 const rowSelectors=['#e-description .opt-add','#e-visibility-open','#e-more > summary','#e-summary > summary','.activity-edit-gear-row','#e-private-note .opt-add','.activity-edit-commute'];
 for(const selector of rowSelectors){const row=p.locator(selector),box=await row.boundingBox();assert(box&&box.height>=48,`${selector} has a 48px row: ${JSON.stringify(box)}`);const style=await row.evaluate(n=>({fontSize:getComputedStyle(n).fontSize,fontWeight:getComputedStyle(n).fontWeight}));assert.equal(style.fontSize,'16px',`${selector} uses 16px text`);assert.equal(style.fontWeight,'400',`${selector} uses regular weight`);}
 const visBox=await p.locator('#e-visibility-open').boundingBox(),moreBox=await p.locator('#e-more > summary').boundingBox();assert(visBox.y+visBox.height<=moreBox.y+0.5,'Visibility and More details rows do not overlap');
 const titleStyle=await p.locator('#e-share-fields .ghead').evaluate(n=>({text:n.textContent.trim(),fontSize:getComputedStyle(n).fontSize,fontWeight:getComputedStyle(n).fontWeight,letterSpacing:getComputedStyle(n).letterSpacing}));assert.deepEqual(titleStyle,{text:'Who can see it',fontSize:'17px',fontWeight:'600',letterSpacing:'normal'},'Visibility sub-view has a normal title');
 await shot('edit-more-details');
 await p.locator('#e-more > summary').click();await shot('edit-open');
 const top0=(await head.boundingBox()).y;await shot('edit-open');
 // Scroll to the bottom: the header (and Save) stays where it was; Delete is reachable.
 await sheet.evaluate(n=>n.scrollTo(0,n.scrollHeight));await p.waitForTimeout(200);
 // Only the small grab bar scrolls away; the header then sits flush with the sheet's top edge.
 const [hy,sy]=[(await head.boundingBox()).y,(await sheet.boundingBox()).y];assert(hy>=sy-1&&hy<=top0,'header stays pinned at the top: '+hy+' sheet '+sy);assert(await save.isVisible());
 await p.locator('#e-more > summary').click();await p.locator('#e-del').scrollIntoViewIfNeeded();await shot('edit-bottom');
 const ask=async()=>{await p.locator('.confirm-sheet').waitFor();assert.equal(await p.getByRole('alertdialog',{name:'Discard your changes?'}).count(),1);const [keep,discard]=await p.locator('.confirm-sheet .btnrow button').all();assert.equal(await keep.innerText(),'Keep editing');assert.equal(await discard.innerText(),'Discard');for(const b of [keep,discard])assert((await b.boundingBox()).height>=44,'44px confirm buttons');assert((await keep.boundingBox()).x<(await discard.boundingBox()).x,'Cancel sits left of the action');};
 // A pending photo appears in the section; Cancel asks and discards it without an upload.
 await p.locator('#e-photos [data-phfile]').setInputFiles({name:'fictional-photo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#2e80bd"/></svg>')});await until(p,()=>document.querySelector('#e-photo-count')?.textContent==='1 of 10','photo count update');assert.equal(await p.locator('#e-photos .ph-th').count(),1,'uploaded photo appears as a thumbnail');assert.equal((await p.locator('#e-photos .ph-add').innerText()).trim(),'Add','filled section offers Add more');await shot('edit-photos');
 await cancel.click();await ask();await p.locator('[data-confirm-ok]').click();await p.locator('.confirm-sheet').waitFor({state:'detached'});await p.waitForSelector('.sheet.pinned',{state:'detached'});assert(!writes.some(w=>w==='POST /api/activities/'+act.id+'/photos'),'Cancel discards pending photos');
 // Changed: Cancel asks; dismissing the question keeps the form draft; Escape on the question keeps editing.
 await open();assert.equal(await p.locator('#e-photo-count').innerText(),'0 of 10','Cancel removed the discarded photo draft on the next edit');await p.locator('#e-form input[name="name"]').fill('Draft title kept');
 // The question is the shared confirm sheet: Keep editing on the left, red Discard on the right.
 await cancel.click();await ask();await shot('discard-confirm');await p.locator('[data-confirm-cancel]').click();await p.locator('.confirm-sheet').waitFor({state:'detached'});assert.equal(await p.locator('#e-form input[name="name"]').inputValue(),'Draft title kept','draft kept');
 await p.keyboard.press('Escape');await ask();await p.keyboard.press('Escape');await p.locator('.confirm-sheet').waitFor({state:'detached'});assert.equal(await p.locator('.sheet.pinned').count(),1,'Escape asks too, and Escape on the question keeps editing');
 // Save from the pinned header sends the edit (intercepted) and closes without asking.
 await p.locator('#e-photos [data-phfile]').setInputFiles({name:'fictional-photo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#2e80bd"/></svg>')});await until(p,()=>document.querySelector('#e-photo-count')?.textContent==='1 of 10','saved photo count');await shot('edit-photos');
 await save.click();await p.waitForSelector('.scrim',{state:'detached'});
 assert(writes.some(w=>w==='PATCH /api/activities/'+act.id),'saved from the header: '+writes.join(','));
 assert(writes.some(w=>w==='POST /api/activities/'+act.id+'/photos'),'Save commits the pending activity photo');
 await open();await p.locator('#e-form select[name="kind"]').selectOption({index:1});await cancel.click();await ask();await p.locator('[data-confirm-ok]').click();await p.waitForSelector('.scrim',{state:'detached'});assert.equal(writes.filter(w=>w.startsWith('PATCH')).length,1,'a changed choice asks, and Discard closes without saving');
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no overflow');
 assert.deepEqual(errors,[]);assert.equal(writes.filter(w=>w.startsWith('DELETE')).length,0,'nothing deleted');
 console.log(`Edit activity ${size.width}x${size.height}/${size.root} ${theme} PASS`);await c.close();}
await b.close();})().catch(e=>{console.error(e);process.exit(1);});
