// Actual client with fictional API/bridge stand-ins; no camera, provider or diary writes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initialize}=require('./spacing_screens.cjs');
const {collectSpacing}=require('./spacing_dom.cjs'),{audit}=require('./spacing_geometry.cjs'),rules=require('./spacing_exceptions.json');
async function settle(p){await p.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});}
async function openFixture(browser,base,width,theme,native=false){
 assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
 const c=await browser.newContext({viewport:{width,height:width>500?900:width<=375?667:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce',isMobile:width<500,hasTouch:width<500,timezoneId:'UTC'});
 try{
  const responses=require('./native-ui/appstore.cjs')(true).responses,errors=[],unexpected=[],writes=[];
  responses['/api/food/thread']={...responses['/api/food/thread'],messages:[]};responses['/api/dishes/shared']=[];
  await c.addInitScript(initialize,{root:16,native,base,token:'fictional-food-grid-token',id:1});
  await c.route('**/*',async route=>{
   const q=route.request(),u=new URL(q.url());if(u.origin!==base){unexpected.push(u.origin);return route.abort();}
   if(!u.pathname.startsWith('/api/'))return route.continue();
   const key=u.pathname.startsWith('/api/food/thread/reviews/draft/')?'/api/food/thread':u.pathname;
   if(q.method()==='POST'&&key==='/api/food/thread/reviews/items'){
    const body=q.postDataJSON();writes.push({path:key,body});
    const first={id:10,client_id:body.client_id,kind:'user',body:body.items.map(i=>i.name).join(', '),state:'answered',created:'2026-11-02T12:00:00Z',captured_at:'2026-11-02T12:00:00Z',local_day:'2026-11-02',result:{review_only:true,draft_id:body.draft_id}};
    responses['/api/food/thread'].messages=[first,{id:11,reply_to:10,kind:'assistant',body:'Ready to review.',state:'answered',created:first.created,result:{kind:'preview',day:'2026-11-02',meal:'lunch',parts:[{index:0,status:'ready',manual:true,entries:body.items}]}}];
    return route.fulfill({json:responses['/api/food/thread']});
   }
   if(['/api/milestones/celebrate','/api/challenges/signup/continue'].includes(key))return route.fulfill({json:{items:[],pending:false}});
   if(q.method()!=='GET'){unexpected.push(q.method()+' '+key);return route.abort();}
   if(!Object.hasOwn(responses,key)){unexpected.push('GET '+key);return route.fulfill({status:404,json:{detail:'Unprovided fictional fixture'}});}
   return route.fulfill({json:responses[key]});
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  await p.goto(base+'/food/describe?meal=lunch');await p.locator('[data-thread-quick=scan]').waitFor();await p.waitForFunction(()=>typeof App!=='undefined'&&App.pageReady);await settle(p);
  return {c,p,errors,unexpected,writes};
 }catch(error){await c.close();throw error;}
}
module.exports=async function(browser,base){
 const measurements=[],out=process.env.SHOT_DIR;if(out)fs.mkdirSync(out,{recursive:true});
 for(const width of [320,330,375,390,440,1280])for(const theme of ['light','dark'])for(const native of [false,true]){
  const f=await openFixture(browser,base,width,theme,native),{p}=f;
  try{
   assert.equal(await p.evaluate(()=>Native.on),native,'web and iPhone bridge routes both mount');
   const buttons=p.locator('.thread-quick-actions > button');assert.deepEqual(await buttons.allTextContents(),['Scan','Photo','Usuals','Manual']);
   const geometry=await buttons.evaluateAll(nodes=>nodes.map(n=>{
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const icon=n.querySelector('svg'),glyph=icon.getBBox(),r=rect(icon),view=icon.viewBox.baseVal;
    return {button:rect(n),icon:r,label:rect(n.querySelector('span')),unclipped:glyph.x>=view.x&&glyph.y>=view.y&&glyph.x+glyph.width<=view.x+view.width&&glyph.y+glyph.height<=view.y+view.height};
   }));
   for(const row of geometry){assert(row.button.width>=44&&row.button.height>=44);assert.equal(row.icon.width,20);assert.equal(row.icon.height,20);assert(row.unclipped,'the complete icon fits its SVG viewBox');assert(row.icon.x>=row.button.x&&row.icon.right<=row.label.x,'icon has its own unclipped space');assert(Math.abs(row.icon.y+10-(row.button.y+row.button.height/2))<1,'icons are vertically centred');assert(row.label.right<=row.button.right+1,'label fits target');}
   assert.equal(geometry[0].button.y,geometry[1].button.y);assert.equal(geometry[2].button.y,geometry[3].button.y);assert(geometry[2].button.y>=geometry[0].button.bottom,'exactly two rows without overlapping targets');assert.equal(geometry[0].icon.x,geometry[2].icon.x);assert.equal(geometry[1].icon.x,geometry[3].icon.x);
   assert(geometry[2].button.y-geometry[0].button.bottom>=8,'rows have an 8px separation');
   const spacing=audit(await p.evaluate(collectSpacing,{screen:'Food entry grid',rules}),rules);assert.deepEqual(spacing.violations,[],'unchanged spacing audit passes');measurements.push({width,theme,native,violations:spacing.violations});
   const composer=await p.locator('.thread-compose-row').boundingBox();assert(composer.y+composer.height<=await p.evaluate(()=>innerHeight)-8,'composer remains inside the visible screen');assert(Math.abs(composer.y-geometry[3].button.bottom-8)<2,'grid stays 8px above composer');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const capture=async state=>{if(out&&(!native&&[330,390].includes(width)))await p.screenshot({path:path.join(out,`food-${state}-${width}-${theme}.png`)});};await capture('entry');
   await p.locator('#thread-text').fill('Fictional unsent food');await p.locator('#thread-text').blur();await settle(p);assert(await p.locator('.thread-quick-actions').evaluate(n=>n.inert),'draft hides and disables every shortcut');assert.equal(await p.locator('#thread-text').inputValue(),'Fictional unsent food');await p.locator('#thread-text').fill('');await p.locator('#thread-text').blur();await settle(p);
   // The new Manual shortcut uses the existing form, preserving validation and explicit diary confirmation.
   await p.locator('[data-thread-quick=manual]').click();const form=p.locator('#ty');await form.waitFor();assert.equal(await form.locator('button.primary').innerText(),'Review food');await form.locator('[name=name]').fill('Fictional yogurt');await form.locator('[name=kcal]').fill('200');await form.locator('[name=protein_g]').fill('10');await form.locator('[name=kcal]').blur();await settle(p);await capture('manual');await form.locator('button.primary').scrollIntoViewIfNeeded();await settle(p);await capture('manual-action');
   assert.equal(f.writes.length,0,'opening or editing manual entry never saves food');await form.locator('button.primary').click();await p.locator('#thread-review:not([hidden])').waitFor();await p.waitForFunction(()=>!document.querySelector('#ty'));await settle(p);assert.equal(await p.locator('#thread-review-add').innerText(),'Add to log');assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.items[0].kcal,200);assert.equal(f.writes[0].body.items[0].name,'Fictional yogurt');assert(await p.locator('.thread-quick-actions').isHidden(),'prepared review replaces shortcuts');await capture('review');
   assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[],'no provider, diary write or unprovided API');
  }finally{await f.c.close();}
 }
 if(out)fs.writeFileSync(path.join(out,'spacing-grid.json'),JSON.stringify(measurements,null,2));
 console.log('Food entry grid: 320/330/375/390/440/1280 light/dark web+bridge, whole icons, 44px targets, drafts and explicit manual review PASS');
};
module.exports.openFixture=openFixture;
