// Edit activity tightening (Hazel, 25 Nov): fictional account; every write is intercepted.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS;
function assertActivityStylesOwned(){const shared=fs.readFileSync(path.resolve(__dirname,'../../app/static/style.css'),'utf8'),owned=fs.readFileSync(path.resolve(__dirname,'../../app/static/activity-detail.css'),'utf8');assert.doesNotMatch(shared,/\.activity-edit-/,'Edit Activity selectors stay out of shared style.css');assert.match(owned,/\.activity-edit-group\s*\{/,'Edit Activity group styles stay with the activity detail screen');assert.match(owned,/\.sheet\.activity-editor\.pinned\s*>\s*header/,'Pinned editor header styles stay with the activity detail screen');}
assertActivityStylesOwned();
async function until(page,fn,label,arg){for(let i=0;i<150;i++){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Timed out: '+label);}
const image={name:'fictional-photo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2e80bd"/></svg>')};
(async()=>{
 const browser=await chromium.launch(),login=await browser.newContext();
 await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
 const storage=await login.storageState(),activities=await(await login.request.get(base+'/api/activities?limit=50')).json(),activity=activities.find(a=>a.sport==='run'&&!(a.photos||[]).length)||activities.find(a=>!(a.photos||[]).length);
 assert(activity,'demo activity without photos');
 for(const size of [{width:390,height:844},{width:330,height:667}])for(const theme of ['light','dark']){
  const context=await browser.newContext({storageState:storage,viewport:size,colorScheme:theme,serviceWorkers:'block',hasTouch:true,isMobile:true,timezoneId:'America/New_York'}),page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='16px'));
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();if(request.method()==='GET'&&url.pathname==='/api/activity-photos/900001')return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2e80bd"/></svg>'});if(!['GET','HEAD'].includes(request.method())){writes.push({method:request.method(),path:url.pathname,body:request.postDataJSON()});if(request.method()==='POST'&&/\/api\/activities\/\d+\/photos$/.test(url.pathname))return route.fulfill({json:{id:900001,w:64,h:64}});return route.fulfill({json:{}});}return route.continue();});
  const shot=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${name}-${size.width}-${theme}.png`});}};
  const open=async()=>{await page.locator('#d-edit').click();await page.waitForSelector('.sheet.pinned.activity-editor #e-form');await page.waitForSelector('#e-visibility-value:not(:text-is("Loading…"))');await page.waitForTimeout(300);};
  await page.goto(base+'/activity/'+activity.id);await until(page,()=>App.pageReady,'activity detail');await open();
  const sheet=page.locator('.sheet.pinned.activity-editor'),header=sheet.locator('header'),save=header.locator('button[form="e-form"]'),cancel=header.locator('[data-close]');
  assert.equal((await save.innerText()).trim(),'Save');assert.equal((await cancel.innerText()).trim(),'Cancel');
  for(const button of [save,cancel]){const box=await button.boundingBox();assert(box&&box.height>=43.5&&box.width>=43.5,'header action has a 44px tap target '+JSON.stringify(box));}
  assert.equal(await sheet.locator('#e-form .actions').count(),0,'Save stays in the header without a footer row');
  assert.equal(await sheet.locator('#e-primary').isVisible(),true);assert.equal(await sheet.locator('#e-more-view').isHidden(),true);
  assert.equal(await sheet.locator('#e-primary .activity-edit-group').count(),2,'primary fields are organized in two quiet groups');
  const title=sheet.locator('textarea[name="name"]'),description=sheet.locator('textarea[name="description"]');
  assert.equal(await title.getAttribute('aria-label'),'Title');assert.equal(await description.getAttribute('placeholder'),'Add description');
  const introStyle=await sheet.locator('.activity-edit-intro').evaluate(n=>({radius:getComputedStyle(n).borderRadius,border:getComputedStyle(n).borderWidth,titleSize:getComputedStyle(n.querySelector('.activity-edit-title')).fontSize,titleWeight:getComputedStyle(n.querySelector('.activity-edit-title')).fontWeight}));
  assert.deepEqual(introStyle,{radius:'12px',border:'0px',titleSize:'16px',titleWeight:'400'});
  assert.equal(await sheet.locator('#e-photo-count').innerText(),'0 of 10');
  assert.equal((await sheet.locator('#e-photo-add .ph-add').boundingBox()).height,44,'photo add stays a 44px row action');
  for(const selector of ['#e-sport-open','.activity-edit-photo-heading','#e-visibility-open','#e-more-open']){const box=await sheet.locator(selector).boundingBox();assert(box&&box.height>=44,`${selector} remains an accessible row`);}
  const originalTitle=await title.inputValue(),originalDescription=await description.inputValue();
  await title.fill('A deliberately long fictional activity title that wraps instead of getting cut off');
  const titleSize=await title.evaluate(n=>({height:n.clientHeight,scroll:n.scrollHeight}));assert(titleSize.height>48&&titleSize.scroll<=titleSize.height+1,'the title wraps and grows to show its full value');
  await description.fill(Array(8).fill('A fictional description line').join('\n'));
  const descriptionSize=await description.evaluate(n=>({height:n.clientHeight,scroll:n.scrollHeight,max:getComputedStyle(n).maxHeight}));assert(descriptionSize.height<=168&&descriptionSize.scroll>descriptionSize.height,'the description grows to six lines, then scrolls');
  await title.fill(originalTitle);await description.fill(originalDescription);
  await shot('edit-open-no-photos');
  await sheet.locator('#e-sport-open').click();await page.locator('.activity-sport-picker').waitFor({state:'visible'});await page.waitForTimeout(320);
  assert(await page.locator('.activity-sport-option[aria-checked="true"]').count()===1,'sport picker identifies the current sport');
  await shot('edit-sport-picker');await page.keyboard.press('Escape');await page.locator('.activity-sport-picker').waitFor({state:'detached'});
  await sheet.locator('#e-more-open').click();assert(await sheet.locator('#e-more-view').isVisible(),'More details opens a view inside the editor sheet');
  assert(await sheet.locator('#e-more-view').getByText('Gear',{exact:true}).isVisible());assert(await sheet.locator('#e-summary').isVisible());
  assert(await sheet.locator('#e-private-note').isVisible());assert(await sheet.locator('.activity-edit-commute').isVisible());assert(await sheet.locator('#e-del').isVisible());
  await shot('edit-more-details');await sheet.locator('#e-summary > summary').click();
  await sheet.locator('#e-form .e-fields').waitFor({state:'visible'});await sheet.evaluate(n=>n.scrollTo(0,n.scrollHeight));await page.waitForTimeout(120);
  const sheetTop=(await sheet.boundingBox()).y,headerTop=(await header.boundingBox()).y;assert(headerTop>=sheetTop-1&&headerTop<=sheetTop+1,'Cancel/title/Save stay pinned while More details scrolls');
  await sheet.evaluate(n=>n.scrollTo(0,0));await sheet.locator('#e-more-back').click();assert(await sheet.locator('#e-primary').isVisible());
  for(const [field,label] of [[title,'title'],[description,'description']]){
   await page.evaluate(()=>{window.KinettaKeyboard={height:300};window.dispatchEvent(new Event('kinetta:keyboard'));const keyboard=document.createElement('div');keyboard.id='fixture-keyboard';keyboard.setAttribute('aria-hidden','true');keyboard.innerHTML='<div>English (US)</div><div class="keys">q w e r t y u i o p</div><div class="keys">a s d f g h j k l</div><div class="keys">⇧ z x c v b n m ⌫</div><div class="keys">123　　space　　 return</div>';Object.assign(keyboard.style,{position:'fixed',zIndex:'4000',left:'0',right:'0',bottom:'0',height:'300px',boxSizing:'border-box',padding:'16px 10px',background:'#d8dbe0',color:'#292c31',font:'14px system-ui',textAlign:'center'});document.body.append(keyboard);});
   await field.focus();await page.waitForTimeout(250);const box=await field.boundingBox();assert(box&&box.y>=0&&box.y+box.height<=size.height-300+1,`${label} stays above the keyboard with a visible field: ${JSON.stringify(box)}`);assert.equal(await sheet.locator('.keyboard-done').count(),0,'the app adds no Done bar above the keyboard');await shot(`edit-keyboard-${label}`);
   if(label==='title')await field.fill('Keyboard draft remains after dismissal');
   await page.evaluate(()=>{window.KinettaKeyboard.height=0;window.dispatchEvent(new Event('kinetta:keyboard'));document.querySelector('#fixture-keyboard')?.remove();});await field.evaluate(n=>n.blur());
   if(label==='title'){assert.equal(await field.inputValue(),'Keyboard draft remains after dismissal','dismissing the keyboard keeps the draft');await field.fill(originalTitle);}
  }
  await sheet.locator('#e-photos [data-phfile]').setInputFiles([image,{...image,name:'fictional-photo-2.svg'},{...image,name:'fictional-photo-3.svg'}]);
  await until(page,()=>document.querySelector('#e-photo-count')?.textContent==='3 of 10','three photo count');
  const thumbs=sheet.locator('.activity-edit-thumb'),firstThumb=thumbs.first();assert.equal(await thumbs.count(),3);
  const thumbBox=await firstThumb.locator('.ph-th').boundingBox(),removeBox=await firstThumb.locator('.activity-edit-photo-remove').boundingBox();
  assert.equal(thumbBox.width,64);assert.equal(thumbBox.height,64);assert.equal((await firstThumb.locator('.ph-th').evaluate(n=>getComputedStyle(n).borderRadius)),'8px');
  assert(removeBox.width>=43.5&&removeBox.height>=43.5,'each photo has a 44px remove target');
  await shot('edit-open-three-photos');
  await firstThumb.locator('.activity-edit-photo-remove').click();await until(page,()=>document.querySelector('#e-photo-count')?.textContent==='2 of 10','photo removal');
  assert.equal(writes.filter(item=>item.path.includes('/photos')).length,0,'photo edits remain drafts until Save');
  await cancel.click();await page.getByRole('alertdialog',{name:'Discard your changes?'}).waitFor();await page.locator('[data-confirm-ok]').click();await sheet.waitFor({state:'detached'});
  assert.equal(writes.filter(item=>item.method==='DELETE').length,0,'discarding the photo draft never deletes a saved photo');
  // Save preserves the existing PATCH contract; no date/time or other new API field is introduced.
  await open();await title.fill('Fictional edited activity title');await description.fill('A short fictional description.');
  await sheet.locator('#e-sport-open').click();await page.waitForSelector('.activity-sport-picker');
  await page.locator('.activity-sport-option[aria-checked="false"]').first().click();
  await save.click();await page.waitForSelector('.scrim',{state:'detached'});
  const edit= writes.find(item=>item.method==='PATCH'&&item.path==='/api/activities/'+activity.id);
  assert(edit,'Save uses the existing activity PATCH endpoint');assert.equal(edit.body.name,'Fictional edited activity title');assert.equal(edit.body.description,'A short fictional description.');
  assert(edit.body.sport&&Object.hasOwn(edit.body,'sport_label'));assert(!Object.hasOwn(edit.body,'start_time'),'the redesign adds no date/time field');
  // Dirty cancellation still keeps the draft until the person chooses Discard.
  await open();await title.fill('Draft title kept');await cancel.click();await page.getByRole('alertdialog',{name:'Discard your changes?'}).waitFor();
  await shot('edit-discard-confirm');await page.locator('[data-confirm-cancel]').click();await page.locator('.confirm-sheet').waitFor({state:'detached'});
  assert.equal(await sheet.locator('textarea[name="name"]').inputValue(),'Draft title kept');
  await cancel.click();await page.locator('[data-confirm-ok]').click();await sheet.waitFor({state:'detached'});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'no horizontal overflow');assert.deepEqual(errors,[]);
  console.log(`Edit activity ${size.width}/${theme} PASS`);await context.close();
 }
 await login.close();await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
