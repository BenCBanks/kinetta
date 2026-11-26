'use strict';
const assert=require('node:assert/strict');
module.exports=async(p,base)=>{
 const ready=()=>p.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady&&App.page?.key===location.pathname+location.search),open=async path=>{await p.evaluate(path=>go(path),path);await ready();},tab=async key=>{await p.evaluate(key=>document.querySelector(`nav.tabs a[data-tab="${key}"]`).click(),key);await ready();};
 await p.route('**/api/coach/conversation*',r=>{const req=r.request(),u=new URL(req.url()),visit=req.method()==='POST'?req.postDataJSON()?.visit_id:u.searchParams.get('visit_id');return r.fulfill({json:u.pathname.endsWith('/threads')?{enabled:false}:{visit_id:visit,generation:'navigation-fixture',messages:[],before:null,ready:true}});});
 const original=await p.evaluate(()=>({ai_ok:App.me.ai_ok,kit_chat:App.me.kit_chat,coach:App.me.coach,ai_paused:App.me.ai_paused,ai_access:App.me.ai_access}));
 try{
  await p.evaluate(()=>{sessionStorage.removeItem('kinetta.sectionReturn');Object.assign(App.me,{ai_ok:true,kit_chat:true,coach:true,ai_paused:false,ai_access:{coach:{available:true,entitled:true}}});});
  await open('/activity');await open('/me/kit?from=activity');
  assert.equal(await p.locator('nav.tabs a[aria-current=page]').getAttribute('data-tab'),'activity','Kit keeps Home selected');
  assert.equal(await p.locator('.thread-heading .back').getAttribute('href'),'/activity','Kit Back returns to Home');
  await tab('me');assert.equal(new URL(p.url()).pathname,'/me','Home -> Kit -> Me lands on Me');
  await open('/me/kit?from=me');assert.equal(await p.locator('.thread-heading .back').getAttribute('href'),'/me');
  await tab('activity');await tab('me');assert.equal(new URL(p.url()).pathname,'/me','Me -> Kit -> Home -> Me lands on Me');
  await open('/activity');await p.evaluate(()=>{const state=sectionReturnStore();state.sections.me={path:'/me/kit?from=me',savedAt:Date.now(),y:0,open:[]};saveSectionReturnStore(state);});
  await tab('me');assert.equal(new URL(p.url()).pathname,'/me','pre-fix persisted Kit path is never restored');
  assert(!await p.evaluate(()=>JSON.stringify(sectionReturnStore()).includes('/me/kit')),'stale Kit path is removed');
  await open('/progress/weight?from=nutrition');assert.equal(await p.locator('nav.tabs a[aria-current=page]').getAttribute('data-tab'),'food','Weight preserves Nutrition origin');
  await tab('progress');assert.equal(new URL(p.url()).pathname,'/progress','Weight from Nutrition does not replace Progress');
  console.log('Kit browser navigation: Home/Me journeys, stale saved Kit, origin tab/Back and Weight PASS');
 }finally{await p.evaluate(original=>Object.assign(App.me,original),original);await p.unroute('**/api/coach/conversation*');await open('/activity');await p.evaluate(()=>sessionStorage.removeItem('kinetta.sectionReturn'));}
};
