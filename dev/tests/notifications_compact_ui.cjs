'use strict';
// Fictional intercepted inbox; real shell/navigation. Blocks writes and external calls.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',before=process.env.NOTIFICATIONS_BEFORE==='1';
const now=Date.now(),who=name=>({name,login:name.toLowerCase().replaceAll(' ',''),photo:null});
const definitions=[
 ['challenge_reminder','Your 10 mi challenge ends Sunday','Your November 1–30 distance challenge ends in three days, on November 29.','/me/challenges/fictional',who('Kinetta')],
 ['activity_ready','Morning Run logged · 6.03 mi · 51 min','Nice run, Alex · Morning Run · 6.03 mi in 51 min','/activity/101?edit=1',who('Alex Example')],
 ['cheer','Sam Example reacted 💪 to Morning Run','Sam Example reacted 💪 to your Morning Run','/activity/101',who('Sam Example')],
 ['cheer','Jo Sample reacted 💪 to Morning Run','Jo Sample reacted 💪 to your Morning Run','/activity/101',who('Jo Sample')],
 ['comment','Taylor commented on Morning Run: "Great morning for a run!"','Taylor commented on your Morning Run: "Great morning for a run!"','/activity/101',who('Taylor')],
 ['friend_request','Morgan wants to be friends','Morgan wants to be friends','/me/friends',who('Morgan')],
 ['activity_ready','Evening Walk logged · 2.10 mi · 38 min','Good walk, Alex · Evening Walk · 2.10 mi in 38 min','/activity/102?edit=1',who('Alex Example')],
 ['dish_shared','Casey shared Vegetable pasta with you','Casey shared Vegetable pasta with you','/food/cook/103',who('Casey')],
 ['cheer','Jamie reacted 👍 to Evening Walk','Jamie reacted 👍 to your Evening Walk','/activity/102',who('Jamie')],
 ['friend_accepted','You and Robin are now friends','You and Robin are now friends','/activity',who('Robin')]
];
const items=definitions.map(([kind,compact_text,text,link,who],i)=>({id:i+1,kind,compact_text:['activity_ready','cheer'].includes(kind)?compact_text:undefined,text:before?text:kind==='challenge_reminder'?compact_text:text,link,who,read:i>4,created:new Date(now-(i+1)*60000).toISOString(),...(kind==='cheer'?{reaction_kind:i===8?'thumbsup':'strong',activity:i===8?'Evening Walk':'Morning Run'}:{})}));
(async()=>{const browser=await (process.env.NOTIFICATIONS_BROWSER==='webkit'?webkit:chromium).launch();const results=[];
try{for(const width of [390,330])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
 try{
  assert.equal((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
  let state='rows';await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/notifications'&&r.request().method()==='GET')return state==='error'?r.fulfill({status:503,json:{detail:'Could not load notifications'}}):r.fulfill({json:{items:state==='empty'?[]:items,unread:5,push:{}}});if(!['GET','HEAD'].includes(r.request().method()))return r.fulfill({json:{}});return r.continue();});
  const p=await context.newPage();p.setDefaultTimeout(15000);await p.goto(base+'/activity');await p.waitForFunction(()=>App.pageReady);await p.evaluate(()=>go('/notifications'));await p.locator('.note').first().waitFor();
  if(!before){
   assert.equal(await p.locator('.note').count(),9,'matching reactions share one row');
   assert.equal(await p.locator('.note').first().getAttribute('href'),items[0].link);
   assert.equal(await p.locator('.note').nth(1).getAttribute('href'),items[1].link);
   assert.match(await p.locator('.note').nth(2).innerText(),/Sam Example and 1 other reacted 💪/);
   const geometry=await p.evaluate(()=>{const rows=[...document.querySelectorAll('.note')],a=rows[0].querySelector('.av').getBoundingClientRect(),text=rows[0].querySelector('.grow').getBoundingClientRect();return {avatarLeft:a.left,avatarWidth:a.width,right:innerWidth-text.right,visible:rows.filter(n=>n.getBoundingClientRect().bottom<document.querySelector('nav').getBoundingClientRect().top).length,overflow:document.documentElement.scrollWidth>innerWidth+1,font:getComputedStyle(rows[0].querySelector('.note-t')).fontSize};});
   assert.equal(geometry.avatarLeft,16);assert.equal(geometry.avatarWidth,40);assert.equal(geometry.right,16);assert.equal(geometry.font,'15px');assert(!geometry.overflow);assert(geometry.visible>=7);results.push({width,theme,...geometry});
   assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'activity','Home stays highlighted');
  }
  if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.SHOT_DIR,`${before?'before':'after'}-${width}-${theme}.png`)});}
  if(!before){
   await p.evaluate(()=>document.querySelector('nav [data-tab="activity"]')?.click());await p.waitForURL(base+'/activity');
   await p.evaluate(()=>go('/notifications'));await p.locator('.note').first().waitFor();await p.locator('[data-back]').first().click();await p.waitForURL(base+'/activity');
   state='empty';await p.evaluate(()=>go('/notifications'));await p.getByText("You're all caught up").waitFor();
   if(process.env.SHOT_DIR)await p.screenshot({path:path.join(process.env.SHOT_DIR,`empty-${width}-${theme}.png`)});
   await p.evaluate(()=>go('/activity'));await p.waitForFunction(()=>App.pageReady);state='error';await p.evaluate(()=>{App.cache.delete('/api/notifications');store.del('fit.c:/api/notifications');go('/notifications');});await p.getByRole('button',{name:'Try again'}).waitFor();
   if(process.env.SHOT_DIR)await p.screenshot({path:path.join(process.env.SHOT_DIR,`error-${width}-${theme}.png`)});
   state='rows';await p.getByRole('button',{name:'Try again'}).click();await p.locator('.note').first().waitFor();
   await p.evaluate(()=>go('/me'));await p.waitForFunction(()=>App.pageReady);await p.evaluate(()=>go('/notifications'));await p.locator('.note').first().waitFor();
   assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'me','Me-origin inbox keeps Me selected');
   await p.locator('[data-back]').first().click();await p.waitForURL(base+'/me');
   await p.goto(base+'/notifications');await p.locator('.note').first().waitFor();assert.equal(await p.locator('nav.tabs [aria-current=page]').getAttribute('data-tab'),'activity','cold inbox defaults to Home');

  }
 }finally{await context.close();}
}}finally{await browser.close();}console.log(JSON.stringify(results));})().catch(e=>{console.error(e);process.exitCode=1;});
