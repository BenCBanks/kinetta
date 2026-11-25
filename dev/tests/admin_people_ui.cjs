// Fictional operator metadata and intercepted actions only; never send mail or change an account.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.SHOT_DIR;
const rows=[['Avery Morgan','avery','active'],['Riley Park','riley','unconfirmed'],['Jordan Reed','jordan','suspended'],...Array.from({length:18},(_,i)=>['Fictional Member','member_'+i,'active'])].map(([name,login,status],i)=>({id:i+2,name,login,status,created:'2026-11-25T12:00:00Z',last_active:i===1?null:'2026-11-24',email:login+'@example.test',email_confirmed:status!=='unconfirmed',is_admin:false,open_reports:0}));
const person=row=>({...row,connections:[],devices:[],imports:[],reports:[],audit:[],counts:{activities:12,food_entries:8,photos:0,photo_bytes:0,ai_requests_this_month:0},active_days_30:4,age:{birth_year:null},kit:{allowed:false,consent:false,status:'off'}});
(async()=>{const browser=await chromium.launch();let checks=0;try{for(const width of [390,330])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),requests=[],writes=[],errors=[];let fail=false;
 try{
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(!url.pathname.startsWith('/api/admin/'))return ['GET','HEAD'].includes(request.method())?route.continue():route.abort();
  requests.push(url.pathname+url.search);
  if(request.method()!=='GET'){writes.push({path:url.pathname,body:request.postDataJSON()});return route.fulfill({json:{ok:true}});}
  if(url.pathname==='/api/admin/me')return route.fulfill({json:{id:1,login:'fictional_admin',name:'Fictional Admin',csrf:'fictional-csrf',mfa:true}});
  if(url.pathname==='/api/admin/people'){
   if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Fictional connection failure'}});}
   const q=url.searchParams.get('q')?.toLowerCase()||'',status=url.searchParams.get('status');const found=rows.filter(r=>(!q||(r.name+' '+r.login).toLowerCase().includes(q))&&(!status||r.status===status));
   return route.fulfill({json:{rows:found,total:found.length,page:1,pages:1}});
  }
  const match=url.pathname.match(/^\/api\/admin\/people\/(\d+)$/);if(match)return route.fulfill({json:person(rows.find(r=>r.id===+match[1]))});
  return route.fulfill({json:{}});
 });
 await page.goto(base+'/admin#people');await page.locator('.person-row').first().waitFor();
 const shot=async state=>{if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`people-${state}-${width}-${theme}.png`),animations:'disabled'});}};
 const fits=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
 assert.deepEqual(await page.getByRole('tab').allTextContents(),['All','New','Unconfirmed','Suspended']);
 assert((await page.locator('.person-row').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height))).every(h=>h===60),'default rows are 60px');
 assert(await page.getByRole('tab').evaluateAll(nodes=>nodes.every(n=>{const s=getComputedStyle(n);return s.borderRadius==='0px'&&n.getBoundingClientRect().height>=44;})));
 assert(await page.getByRole('tab').evaluateAll(nodes=>nodes.every((n,i)=>{const text=document.createRange();text.selectNodeContents(n);const r=text.getBoundingClientRect(),b=n.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&(!i||b.left>=nodes[i-1].getBoundingClientRect().right);})), 'tab labels fit without overlap');
 await fits();await shot('all');checks+=4;
 await page.evaluate(()=>scrollTo(0,500));await page.waitForFunction(()=>Math.abs(document.querySelector('#people-find').getBoundingClientRect().top-document.querySelector('.admin-header').getBoundingClientRect().bottom)<2);checks++;
 await page.evaluate(()=>scrollTo(0,0));
 for(const [tab,status] of [['New',''],['Unconfirmed','unconfirmed'],['Suspended','suspended'],['All','']]){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/people');await page.getByRole('tab',{name:tab,exact:true}).click();const url=new URL((await response).url());assert.equal(url.searchParams.get('status')||'',status);if(tab==='New')assert.match(url.searchParams.get('joined_after'),/^\d{4}-\d{2}-\d{2}$/);await page.waitForFunction(()=>!document.querySelector('#people-list').hasAttribute('aria-busy'));checks++;
 }
 await page.locator('[data-open="2"]').click();await page.getByRole('dialog',{name:'Avery Morgan',exact:true}).waitFor();
 assert.equal(await page.locator('#dialog-body button.primary').count(),1);assert.equal(await page.locator('.person-primary button').innerText(),'Send password reset email');
 assert.match(await page.locator('.person-summary').innerText(),/Last active: Nov 24, 2026/);assert.doesNotMatch(await page.locator('.person-summary').innerText(),/\d+:\d+/);await shot('person');checks+=3;
 await page.locator('.person-primary button').click();await page.locator('#tool-form').waitFor();const input=page.locator('[name=confirm]');await input.fill('avery');await page.locator('#tool-form button[type=submit]').click();assert.equal(writes.length,0);assert.match(await input.evaluate(n=>n.validationMessage),/Type @avery exactly/);
 await input.fill('@avery');await shot('confirm');await page.locator('#tool-form button[type=submit]').click();await page.waitForFunction(()=>!!document.querySelector('.person-summary'));assert.equal(writes.length,1);assert.equal(writes[0].body.confirm,'avery');assert.equal(writes[0].path,'/api/admin/manage/2/reset-email');checks+=3;
 await page.locator('#close').click();
 for(const [id,label] of [[3,'Send confirmation email again'],[4,'Restore account']]){await page.locator(`[data-open="${id}"]`).click();await page.locator('.person-summary').waitFor();assert.equal(await page.locator('.person-primary button').innerText(),label);assert.equal(await page.locator('#dialog-body button.primary').count(),1);await page.locator('#close').click();checks++;}
 const search=page.locator('[name=q]');await search.fill('no such fictional person');await page.waitForFunction(()=>document.querySelector('#people-list').textContent.includes('No matching accounts'));await shot('empty');checks++;
 fail=true;await search.fill('Riley');await page.locator('#people-retry').waitFor();assert.equal(await search.inputValue(),'Riley');await shot('error');await page.locator('#people-retry').click();await page.locator('[data-open="3"]').waitFor();await fits();checks+=2;
 assert(requests.every(p=>/^\/api\/admin\/(me|people(?:\?|\/|$)|manage\/)/.test(p)),'no private-content endpoints');assert.deepEqual(errors,[]);checks++;
 console.log(`Admin People ${width}px ${theme}: sticky search, text tabs, 60px rows, date-only last active, contextual action and @username confirmation PASS`);
 }finally{await context.close();}
}}finally{await browser.close();}console.log(`Admin People: ${checks} checks PASS; fictional metadata and intercepted actions only`);})().catch(e=>{console.error(e);process.exitCode=1});
