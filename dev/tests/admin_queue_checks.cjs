'use strict';
// Fictional portal replies only: every matched write is intercepted, never sent or emailed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function queueChecks(page,base){
 const stamp='2026-11-24T12:00:00Z',person={id:8101,name:'Zoe Stone',login:'zz_test_queue_zoe'},calls=[];
 let reported=true;
 let report={id:8201,what:'Comment: Fictional reported comment',reason:'abuse',note:'Fictional complaint',created:stamp,name:person.name,login:person.login};
 let review={report:{id:8201,kind:'comment',reason:'abuse',note:'Fictional complaint',created:stamp,reporter:'Nathan Demo'},person,item:{text:'Fictional reported comment'},photos:[],actions:[{value:'dismiss',label:'Dismiss report'},{value:'remove_comment',label:'Remove this comment'}],history:[],version:'fictional-item-version'};
 const request={id:'d2216b79-30d9-421f-8958-dd4cb2856fe1',user_id:person.id,kind:'export',status:'received',received:stamp,name:person.name,login:person.login,recorded_by:'Fictional administrator'};
 const beta={id:8301,name:'Ava Green',email:'ava@example.test',phone:'iphone',note:'Fictional applicant',status:'new',created:stamp};
 const pattern='**/api/admin/**',handler=async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname.slice('/api/admin'.length),method=req.method();let data;
  if(p==='/reports')data=reported?[report]:[];
  else if(p==='/review/8201'&&method==='GET')data=review;
  else if(p==='/review/8201'&&method==='POST'){calls.push({path:p,body:req.postDataJSON()});reported=false;data={ok:true};}
  else if(p==='/beta')data=[beta];
  else if(p==='/beta/8301/responses'&&method==='GET')data=[];
  else if(p==='/beta/8301/responses'&&method==='POST'){calls.push({path:p,body:req.postDataJSON()});data={id:'fictional-response',state:'queued',body:'Hello Ava,\n\nFictional complete preview.\n\nThe Kinetta team'};}
  else if(p==='/responses/fictional-response/send'){calls.push({path:p,body:req.postDataJSON()});data={state:'accepted'};}
  else if(p==='/invites'&&method==='GET')data=[{id:8401,note:'Fictional invitation',expires:'2030-01-01T00:00:00Z'}];
  else if(p==='/invites/8401'&&method==='DELETE'){calls.push({path:p});data={ok:true};}
  else if(p==='/data-requests'&&method==='GET')data={items:[request],before:null};
  else if(p==='/data-requests/'+request.id&&method==='POST'){calls.push({path:p,body:req.postDataJSON()});request.status='verified';data={ok:true};}
  else return route.fallback();
  return route.fulfill({json:data});
 };
 await page.route(pattern,handler);
 const go=async(hash,selector)=>{await page.goto(base+'/admin#'+hash);try{await page.locator(selector).first().waitFor();}catch(e){e.message+=' Queue fixture status: '+await page.locator('#error').textContent();throw e;}};
 try{
  await go('reports','[data-review]');await page.locator('[data-review]').first().focus();await page.keyboard.press('Enter');await page.locator('[data-decision=remove_comment]').waitFor();
  if(page.viewportSize().width>=1000){const list=await page.locator('.admin-report-workspace>.admin-queue').boundingBox(),detail=await page.locator('#report-detail').boundingBox();assert(detail.x>list.x+list.width,'desktop review sits alongside queue');assert.equal(await page.locator('#dialog').isVisible(),false);}else assert(await page.locator('#dialog').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'queue has no horizontal overflow');
  await page.locator('[data-decision=remove_comment]').click();
  await page.locator('#tool-form input[name=confirm]').fill('@'+person.login);await page.locator('#tool-form button[type=submit]').click();await page.locator('#dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>current==='reports'&&document.querySelector('#content').textContent.includes('No open reports.'));
  const removed=calls.find(c=>c.path==='/review/8201').body;assert.equal(removed.version,review.version);assert.equal(removed.confirm,person.login);assert.equal(removed.action,'remove_comment');assert(removed.request_key&&removed.requested_at);
  // Report-bound group moderation uses the same confirmation, with explicit cascade wording.
  reported=true;report={...report,what:'Group: Weekend runners'};
  review={...review,report:{...review.report,kind:'group'},item:{name:'Weekend runners',scope:'Reported group name only; members, totals and updates are not shown.'},actions:[{value:'dismiss',label:'Dismiss report'},{value:'remove_group',label:'Remove this group'}]};
  await page.reload();await go('reports','[data-review]');await page.locator('[data-review]').click();await page.locator('[data-decision=remove_group]').waitFor();
  assert.equal(await page.locator('.reported-item').innerText(),'Weekend runners\n\n'+review.item.scope);
  const shot=async(state,prefix='group-report')=>{if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SHOT_DIR,`${prefix}-${state}-${page.viewportSize().width}-${await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}.png`),animations:'disabled'});}};
  await shot('review');const beforeGroup=calls.length;
  await page.locator('[data-decision=remove_group]').click();await page.locator('#tool-form').waitFor();
  assert.match(await page.locator('#dialog-body').innerText(),/People keep their workouts/);assert.equal(calls.length,beforeGroup,'opening confirmation never removes');
  await shot('confirm');await page.locator('#close').click();assert.equal(calls.length,beforeGroup,'cancel never removes');
  await go('reports','[data-review]');await page.locator('[data-review]').click();await page.locator('[data-decision=remove_group]').click();
  await page.locator('#tool-form input[name=confirm]').fill('@'+person.login);await page.locator('#tool-form button[type=submit]').click();await page.locator('#dialog').waitFor({state:'hidden'});
  // Closing precedes its asynchronous queue refresh; let that finish before changing tabs.
  await page.waitForFunction(()=>current==='reports'&&document.querySelector('#content').textContent.includes('No open reports.'));
  const groupDecision=calls.at(-1).body;assert.equal(groupDecision.action,'remove_group');assert.equal(groupDecision.confirm,person.login);assert.equal(groupDecision.version,review.version);assert(groupDecision.request_key&&groupDecision.requested_at);
  reported=true;report={...report,what:'Group update: See you at the park on Saturday.'};
  review={...review,item:{id:8601,text:'See you at the park on Saturday.',scope:'Reported update only; other group updates are not shown.'},actions:[{value:'dismiss',label:'Dismiss report'},{value:'remove_group_update',label:'Remove this update'}]};
  await page.reload();await go('reports','[data-review]');await page.locator('[data-review]').click();await page.locator('[data-decision=remove_group_update]').waitFor();
  assert.equal(await page.locator('[data-decision=remove_group]').count(),0,'an update report never offers whole-group removal');
  assert.equal(await page.locator('.reported-item blockquote').innerText(),review.item.text);
  await shot('review','group-update');const beforeUpdate=calls.length;
  await page.locator('[data-decision=remove_group_update]').click();await page.locator('#tool-form').waitFor();
  assert.match(await page.locator('#dialog-body').innerText(),/only the reported update/);
  await shot('confirm','group-update');await page.locator('#close').click();assert.equal(calls.length,beforeUpdate,'cancel leaves the update untouched');
  await go('reports','[data-review]');await page.locator('[data-review]').click();await page.locator('[data-decision=remove_group_update]').click();
  await page.locator('#tool-form input[name=confirm]').fill('@'+person.login);await page.locator('#tool-form button[type=submit]').click();await page.locator('#dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>current==='reports'&&document.querySelector('#content').textContent.includes('No open reports.'));
  const updateDecision=calls.at(-1).body;assert.equal(updateDecision.action,'remove_group_update');assert.equal(updateDecision.version,review.version);assert.equal(updateDecision.confirm,person.login);assert(!('group_update_id' in updateDecision),'the server owns target selection');
  reported=true;review={...review,item:{text:report.what,scope:'Submitted report only; no current target is available.'},actions:[{value:'dismiss',label:'Dismiss report'}]};
  await page.reload();await go('reports','[data-review]');await page.locator('[data-review]').click();await page.locator('[data-decision=dismiss]').waitFor();
  assert.equal(await page.locator('[data-decision^=remove_group]').count(),0,'legacy reports cannot remove a guessed item');await shot('legacy','group-update');
  if(await page.locator('#dialog').isVisible())await page.locator('#close').click();
  await go('requests','[data-action=respond]');await page.locator('[data-action=respond]').first().click();await page.locator('#response button').click();await page.locator('#preview:not([hidden])').waitFor();
  assert((await page.locator('#preview').innerText()).includes('Fictional complete preview.'));assert(!calls.some(c=>c.path.endsWith('/send')),'preview never sends email');
  const sentRevision=await page.evaluate(()=>revision);await page.locator('#send').click();await page.waitForFunction(r=>revision>r&&current==='beta'&&document.querySelector('#requests [data-action=respond]'),sentRevision);
  assert.equal(calls.filter(c=>c.path.endsWith('/send')).length,1);if(await page.locator('#dialog').isVisible())await page.locator('#close').click();
  await go('requests/invitations','[data-action=revoke]');await page.locator('[data-action=revoke]').first().click();assert.equal(calls.some(c=>c.path==='/invites/8401'),false,'opening revoke never deletes');await page.locator('#close').click();
  await go('requests/data','[data-state=verified]');await page.locator('[data-state=verified]').first().click();await page.locator('#tool-form input[name=confirmed]').check();await page.locator('#tool-form button[type=submit]').click();await page.locator('#dialog').waitFor({state:'hidden'});
  const verified=calls.find(c=>c.path==='/data-requests/'+request.id).body;assert.equal(verified.status,'verified');assert.equal(verified.method,'signed_in');assert.equal(verified.confirmed,true);assert(verified.request_key&&verified.requested_at);
  assert(!calls.some(c=>/export|remove/.test(c.path)),'register never exports or removes an account');return 15;
 }finally{await page.unrouteAll({behavior:'wait'});}
};
