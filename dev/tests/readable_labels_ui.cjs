// Narrow enlarged-text regression: sign-up field labels and People last-active dates only.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initialize}=require('./spacing_screens.cjs');
async function exercise(browser,base){
 assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
 for(const width of [320,390,1280])for(const root of [16,24])for(const theme of ['light','dark']){
  const fixture=require('./native-ui/appstore.cjs')(),errors=[],unknown=[];
  const c=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   await c.addInitScript(initialize,{root,native:width<500,base,token:'fictional-labels',id:1});let signup=true;
   await c.route('**/*',r=>{const u=new URL(r.request().url()),key=u.pathname;
    if(u.origin!==base){unknown.push(u.origin);return r.abort();}
    if(!key.startsWith('/api/'))return r.continue();
    if(r.request().method()!=='GET'){unknown.push(r.request().method()+' '+key);return r.abort();}
    const data={...fixture.responses,'/api/terms':{version:1,draft:false,url:'https://kinetta.app/terms',privacy_url:'https://kinetta.app/privacy'},'/api/signup':{open:true,full:false,mail_available:true,age_required:true},'/api/setup':{needed:false},'/api/beta':{open:false},'/api/account/signin-email':{on:true},'/api/admin/me':{id:1,name:'Fictional Admin',login:'fictional_admin',csrf:'fictional',mfa:true},'/api/admin/people':{rows:[{id:2,name:'Avery Morgan',login:'avery',status:'active',created:'2026-11-25T12:00:00Z',last_active:'2026-11-27',email_confirmed:true,is_admin:false}],total:1,page:1,pages:1}};
    if(key==='/api/me'&&signup)return r.fulfill({status:401,json:{detail:'Sign in'}});
    if(!Object.hasOwn(data,key)){unknown.push(key);return r.fulfill({status:404,json:{detail:'Unprovided fixture'}});}
    return r.fulfill({json:data[key]});
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
   for(const [scene,url,selector,ratio] of [['signup','/signup','.account-enrollment label:not(.check):not([aria-hidden=true])',.8125],['people','/admin#people','.person-row time',.75]]){
    signup=scene==='signup';await p.goto(base+url);await p.locator(selector).first().waitFor();await p.evaluate(()=>document.fonts.ready);
    const measures=await p.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
     const range=document.createRange();range.selectNodeContents(node);if(node.matches('label'))range.setEnd(node.firstChild,node.firstChild.textContent.length);
     const rect=range.getBoundingClientRect(),box=node.getBoundingClientRect(),style=getComputedStyle(node);
     return{font:parseFloat(style.fontSize),text:rect.toJSON(),box:box.toJSON(),overflow:style.textOverflow,clip:style.overflow,scroll:document.documentElement.scrollWidth,width:innerWidth};
    }));
    assert(measures.length>=(scene==='signup'?6:1),'all visible field labels/date are measured');
    for(const m of measures){assert.equal(m.font,root*ratio,`${scene} label follows chosen text size`);assert(m.text.left>=m.box.left-1&&m.text.right<=m.box.right+1&&m.text.top>=m.box.top-1&&m.text.bottom<=m.box.bottom+1,`${scene} complete label fits: ${JSON.stringify(m)}`);assert(m.scroll<=m.width+1,`${scene} has no horizontal overflow`);}
    if(scene==='people'){
     const hierarchy=await p.locator('.person-row').evaluateAll(rows=>rows.map(row=>Object.fromEntries([['name','.person-row-main strong'],['status','.person-row-status>span'],['date','time']].map(([key,selector])=>[key,parseFloat(getComputedStyle(row.querySelector(selector)).fontSize)]))));
     for(const sizes of hierarchy){assert.equal(sizes.name,root*(width>=1100?.875:.9375),'name scales from its normal size');assert.equal(sizes.status,root*(width>=1100?.75:.8125),'status scales from its normal size');assert(sizes.date<=sizes.status&&sizes.status<=sizes.name,`date/status stay subordinate to name: ${JSON.stringify(sizes)}`);}
    }
    const target=p.locator(scene==='signup'?'button[type=submit]':'.person-row').first();const rect=await target.boundingBox();assert(rect&&rect.width>=44&&rect.height>=44,`${scene} keeps 44px control`);
    if(process.env.SHOT_DIR){fs.mkdirSync(process.env.SHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.SHOT_DIR,`${scene}-${width}-${root}-${theme}.png`),animations:'disabled'});}
   }
   assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);console.log(`Readable labels ${width}/${root}/${theme}: scaling, complete text, no overflow, targets PASS`);
  }finally{await c.close();}
 }
}
module.exports=exercise;
if(require.main===module){const {chromium,webkit}=require('playwright');(async()=>{const b=await(process.env.UI_BROWSER==='webkit'?webkit:chromium).launch();try{await exercise(b,process.env.KINETTA_URL||'http://localhost:8798');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});}
