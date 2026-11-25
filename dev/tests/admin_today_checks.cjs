'use strict';
// The endpoint contract is from #1537. Fictional replies; no configuration or account writes.
const assert=require('node:assert/strict');
const snapshot={day:'2026-11-25',zone:'UTC',counts:{new_signups:5,unconfirmed:12,open_reports:3,kit_requests:17},needs_attention:[
 {key:'reports',label:'Open reports',count:3,severity:'red',destination:'reports'},
 {key:'email_failures',label:'Email delivery failures in the past 24 hours',count:2,severity:'red',destination:'readiness'},
 {key:'imports',label:'Failed imports in the past 24 hours',count:4,severity:'amber',destination:'people?issue=imports'},
 {key:'connections',label:'Failed connections',count:1,severity:'amber',destination:'people?issue=connections'},
 {key:'unconfirmed',label:'Unconfirmed accounts',count:12,severity:'amber',destination:'people?status=unconfirmed'},
 {key:'email',label:'Email',count:1,severity:'amber',destination:'readiness'},
 {key:'authenticator',label:'Portal authenticator',count:1,severity:'red',destination:'readiness'},
 {key:'backup',label:'Recent backup',count:1,severity:'amber',destination:'readiness'}],services:[
 {key:'database',label:'Database',status:'available',source:'this request'},
 {key:'email',label:'Email',status:'not_configured',source:'configuration'},
 {key:'kit',label:'Kit',status:'disabled',source:'configuration'},
 {key:'authenticator',label:'Portal authenticator',status:'disabled',source:'configuration'},
 {key:'backup',label:'Recent backup',status:'needs_check',source:'administrator evidence'}]};
module.exports={snapshot,install:async function(page,base){
 let data=structuredClone(snapshot),fail=false,visits=0;
 await page.route('**/api/admin/today',route=>route.fulfill(fail?{status:503,json:{detail:'Fictional temporary outage'}}:{json:data}));
 return async function checks(){
  const open=async()=>{await page.goto(base+'/admin?fixture='+ ++visits+'#today');await page.locator('#today-metrics').waitFor();};
  await open();assert.deepEqual(await page.locator('#today-metrics dd').allTextContents(),['5','12','3','17']);
  assert((await page.locator('.today-services').innerText()).includes('Recorded evidence'));assert((await page.locator('.today-services').innerText()).includes('Not configured'));
  for(const [i,row] of snapshot.needs_attention.entries())assert.equal(await page.locator('[data-attention="'+i+'"] strong').count(),['email','authenticator','backup'].includes(row.key)?0:1,'configuration rows have no artificial count; real queue counts stay');
  const fit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,metrics:document.querySelector('#today-metrics').getBoundingClientRect().toJSON(),attention:document.querySelector('.today-attention').getBoundingClientRect().toJSON(),services:document.querySelector('.today-services').getBoundingClientRect().toJSON(),targets:[...document.querySelectorAll('[data-attention]')].map(b=>b.getBoundingClientRect().height)}));
  assert(!fit.overflow);assert(fit.targets.every(h=>h>=44));
  if(page.viewportSize().width>=1000){assert(fit.services.x>fit.attention.x+fit.attention.width);assert(fit.attention.y+fit.attention.height<page.viewportSize().height,'all eight attention items above desktop fold');}
  await page.locator('[data-attention="4"]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>current==='people'&&peopleState.status==='unconfirmed');
  assert.equal(await page.evaluate(()=>peopleState.issue),'','status link clears older issue filter');
  await open();await page.locator('[data-attention="2"]').click();await page.waitForFunction(()=>current==='people'&&peopleState.issue==='imports');assert.equal(await page.evaluate(()=>peopleState.status),'');
  data={...snapshot,counts:{new_signups:0,unconfirmed:0,open_reports:0,kit_requests:0},needs_attention:[]};await open();assert.equal(await page.locator('#today-metrics dd').first().innerText(),'0');assert((await page.locator('.today-attention').innerText()).includes('No items need attention.'));
  fail=true;await page.goto(base+'/admin?fixture='+ ++visits+'#today');await page.locator('#retry:not([hidden])').waitFor();assert.equal(await page.locator('#today-metrics').count(),0,'failed read never appears as zero success');
  fail=false;data=structuredClone(snapshot);await page.locator('#retry').click();await page.locator('#today-metrics').waitFor();assert.equal(await page.locator('#today-metrics dd').first().innerText(),'5');
  await page.goto(base+'/admin#more/overview');await page.locator('#overview-metrics').waitFor();assert.equal(await page.evaluate(()=>current),'service','old overview and totals stay reachable');
  return 12;
 };
}};
