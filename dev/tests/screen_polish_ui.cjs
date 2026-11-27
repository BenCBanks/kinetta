// Four bounded visual regressions; fictional API responses, no writes or providers.
'use strict';
const assert=require('node:assert/strict');
module.exports=async function({browser,storageState,base}){
 for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState,viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'}),p=await c.newPage();
  let groups=[],groupsError=false;const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/*',async r=>{
   const u=new URL(r.request().url());if(u.origin!==base)return r.abort();
   if(u.pathname==='/api/me'){const response=await r.fetch(),data=await response.json();return r.fulfill({response,json:{...data,food_user:true}});}
   if(u.pathname==='/api/groups')return groupsError?r.fulfill({status:503,json:{detail:'Fictional unavailable groups'}}):r.fulfill({json:groups});
   if(u.pathname==='/api/account/devices')return r.fulfill({json:[
    {id:'fictional-current',device:'Fictional iPhone',this:true,last_used:'2026-11-27T12:00:00Z',signed_in:'2026-11-26T12:00:00Z'},
    {id:'fictional-other',device:'Fictional browser',this:false,last_used:'2026-11-26T12:00:00Z',signed_in:'2026-11-25T12:00:00Z'}]});
   if(!['GET','HEAD'].includes(r.request().method()))return r.fulfill({json:{}});
   return r.continue();
  });
  const visit=async route=>{await p.goto(base+route);await p.waitForFunction(()=>App.pageReady);await p.evaluate(()=>document.fonts.ready);};
  try{
   await visit('/me/settings');await p.locator('#m-kit').click();
   for(const [id,label]of [['m-kit-memory','What Kit remembers'],['m-kit-history','Earlier Kit reviews']]){
    const row=p.locator('#'+id);await row.waitFor({state:'visible'});assert.equal(await row.innerText(),label);assert.equal(await row.locator('.inset-label').innerText(),label);assert.equal(await row.locator('.inset-value').count(),0,'destination is a label, not a value');
    assert((await row.boundingBox()).height>=44,'Kit row keeps its tap target');
   }
   await p.keyboard.press('Escape');
   await visit('/me/groups');await p.locator('#group-empty-create').waitFor();assert(await p.locator('#group-new').isHidden(),'empty Groups has one Create action');
   await p.locator('#group-empty-create').click();await p.locator('#group-create-form').waitFor();await p.keyboard.press('Escape');
   groups=[{id:'fictional-group',title:'Saturday crew',member_count:3}];await visit('/me/groups');await p.locator('.group-list-row').waitFor();assert(await p.locator('#group-new').isVisible(),'populated Groups retains Create');assert.equal(await p.locator('#group-empty-create').count(),0);
   await p.locator('#group-new').click();await p.locator('#group-create-form').waitFor();await p.keyboard.press('Escape');
   groupsError=true;await visit('/me/groups');await p.locator('#group-retry').waitFor();assert(await p.locator('#group-new').isVisible(),'failed load retains Create');
   await visit('/me/devices');await p.locator('.device-row').first().waitFor();
   const current=p.locator('.device-row').filter({hasText:'Fictional iPhone'});assert.equal((await current.innerText()).match(/This device/g)?.length,1);assert.match(await current.locator('small').innerText(),/^Last used .+ · signed in .+/);assert.equal(await p.locator('[data-dv="fictional-other"]').count(),1,'other device keeps Sign out');
   await visit('/progress');await p.locator('#p-explore[aria-busy=false]').waitFor();
   for(const width of [390,330]){
    await p.setViewportSize({width,height:844});
    // Short and deliberately long values exercise the real responsive row CSS.
    for(const long of [false,true]){
     const rows=await p.locator('#p-explore .progress-tile').evaluateAll((nodes,long)=>{
      return nodes.map(n=>{const label=n.querySelector('b'),value=n.querySelector('.small');if(!value)return null;value.textContent=long?'1,234,567 workouts recorded':'7 repeats';const a=label.getBoundingClientRect(),b=value.getBoundingClientRect(),row=n.getBoundingClientRect();return {label:label.textContent,lines:Math.round(a.height/parseFloat(getComputedStyle(label).lineHeight)),clear:a.right<=b.left+1,valueFits:value.scrollWidth<=value.clientWidth+1,inside:b.right<=row.right+1,height:row.height};}).filter(Boolean);
     },long);
     assert(rows.every(r=>r.clear&&r.valueFits&&r.inside&&r.height>=56),`${width}px rows wrap without overlap: ${JSON.stringify(rows)}`);
     if(width===390&&!long)for(const label of ['Matched routes','Food & weight']){const row=rows.find(r=>r.label===label);assert(row,'fixture exposes '+label);assert.equal(row.lines,1,label+' uses available space');}
    }
   }
   assert.deepEqual(errors,[]);console.log('Four screen polish regressions 390/330',theme,'PASS');
  }finally{await c.close();}
 }
};
