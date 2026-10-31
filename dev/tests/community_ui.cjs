'use strict';
// Browser plugin not available. Real renderers, fictional demo records and blocked writes.
const {chromium}=require('playwright'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798', out=process.env.SHOT_DIR;
const until=async(p,fn,label)=>{for(let n=0;n<150;n++){if(await p.evaluate(fn))return;await p.waitForTimeout(50);}throw Error(label);};
const fixtureVersion='fixture-approved-v1';
(async()=>{
 const browser=await chromium.launch();let cases=0;
 try{
  for(const theme of ['light','dark'])for(const width of [390,330]){
   if(process.env.THEME&&process.env.THEME!==theme||process.env.WIDTH&&Number(process.env.WIDTH)!==width)continue;
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
   try{
    const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    let version=fixtureVersion,required=false,accepted=false,acceptCalls=0,acceptFail=true,acceptWait=null,signupCalls=[],reportCalls=[],reportWait=null;
    await context.route('**/*',async route=>{
     const request=route.request(),u=new URL(request.url());if(u.origin!==base)return route.abort();
     if(u.pathname==='/api/terms'&&request.method()==='GET')return route.fulfill({json:{version,document_version:version,draft:false,url:'https://kinetta.app/terms',privacy_url:'https://kinetta.app/privacy'}});
     if(u.pathname==='/api/signup'&&request.method()==='GET')return route.fulfill({json:{open:true,full:false}});
     if(u.pathname==='/api/me'&&request.method()==='GET'){
      const response=await route.fetch();if(response.status()!==200)return route.fulfill({response});
      const me=await response.json();me.terms={version,required:required&&!accepted,accepted_version:accepted?version:null,url:'https://kinetta.app/terms',privacy_url:'https://kinetta.app/privacy'};return route.fulfill({response,json:me});
     }
     if(u.pathname==='/api/terms/accept'){
      acceptCalls++;const submitted=request.postDataJSON();assert.equal(submitted.version,version);
      if(acceptWait){const wait=acceptWait;acceptWait=null;return wait(route,submitted);}
      if(acceptFail){acceptFail=false;return route.fulfill({status:503,json:{detail:'Fictional acceptance failure. Try again.'}});}
      accepted=true;return route.fulfill({json:{version,required:false,accepted_version:version,accepted_at:'2026-10-31T12:00:00Z'}});
     }
     if(u.pathname==='/api/signup'&&request.method()==='POST'){signupCalls.push(request.postDataJSON());return route.fulfill({status:503,json:{detail:'Fictional signup failure. Your draft stays here.'}});}
     if(u.pathname==='/api/reports'){
      reportCalls.push(request.postDataJSON());if(reportWait){const wait=reportWait;reportWait=null;return wait(route);}return route.fulfill({json:{ok:true,id:999999}});
     }
     if(!['GET','HEAD'].includes(request.method()))return route.fulfill({status:503,json:{detail:'Fictional test: writes blocked'}});
     return route.continue();
    });
    const shot=async name=>{if(out&&width===390){await p.waitForTimeout(250);fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`${name}-${theme}.png`),fullPage:name==='signup'});const metrics=await p.evaluate(()=>({url:location.pathname,title:document.title,buttons:[...document.querySelectorAll('.scrim:not(.is-closing) button')].filter(n=>n.getClientRects().length&&!n.hidden).map(n=>({text:n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))}));fs.writeFileSync(path.join(out,`${name}-${theme}.json`),JSON.stringify(metrics));}};
    const fit=async()=>{assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No horizontal overflow');};
    await p.goto(base+'/signup');await p.locator('input[name=terms_ok]').waitFor();
    assert.equal(await p.locator('a[href="https://kinetta.app/terms"]').count(),1);assert.equal(await p.locator('a[href="https://kinetta.app/privacy"]').count(),1);
    await p.locator('input[name=name]').fill('Casey Example');await p.locator('input[name=email]').fill('fictional@example.invalid');await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=age_ok]').check();
    await p.locator('input[name=terms_ok]').check();await shot('signup');await p.locator('input[name=terms_ok]').uncheck();
    await p.locator('button[type=submit]').click();assert.equal(signupCalls.length,0,'Agreement required before signup');
    await p.locator('input[name=terms_ok]').check();await fit();
    await p.locator('button[type=submit]').click();await until(p,()=>document.querySelector('.err')?.textContent.includes('Fictional signup failure'),'Signup failure visible');
    assert.equal(signupCalls.length,1);assert.equal(signupCalls[0].terms_version,version);assert.equal(await p.locator('input[name=name]').inputValue(),'Casey Example');assert(await p.locator('input[name=terms_ok]').isChecked());
    version='fixture-approved-v2';await p.locator('button[type=submit]').click();await until(p,()=>document.querySelector('.err')?.textContent.includes('Read and accept'),'New signup version needs fresh assent');
    assert.equal(signupCalls.length,1);assert.equal(await p.locator('input[name=terms_ok]').isChecked(),false);await p.locator('input[name=terms_ok]').check();await p.locator('button[type=submit]').click();await until(p,()=>document.querySelector('.err')?.textContent.includes('Fictional signup failure'),'Retry with new version');assert.equal(signupCalls.at(-1).terms_version,version);cases+=3;
    // Invitation/setup use this same real account form; their agreement is independent of the open-signup age checkbox.
    await p.evaluate(()=>showNewAccount({title:'Join Kinetta',button:'Create my account',send:async body=>{window.fixtureInviteBody=body;throw Error('Fictional invite failure');}}));
    await p.locator('input[name=terms_ok]').waitFor();assert.equal(await p.locator('input[name=age_ok]').count(),0);await p.locator('input[name=name]').fill('Invite Example');await p.locator('input[name=login]').fill('zz_test_terms_invite');await p.locator('input[name=password]').fill('fictional long passphrase');await p.locator('input[name=terms_ok]').check();await p.locator('button[type=submit]').click();await until(p,()=>window.fixtureInviteBody?.terms_version==='fixture-approved-v2','Invite includes accepted version');cases++;
    assert.equal((await context.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);
    required=true;accepted=false;version=fixtureVersion;await p.goto(base+'/progress');await p.locator('#terms-accept').waitFor();
    assert(await p.locator('#terms-accept').isDisabled());await p.keyboard.press('Escape');assert.equal(await p.locator('#terms-accept').count(),1);
    await shot('terms-sheet');await fit();await p.locator('#terms-agree').check();await p.locator('#terms-accept').click();await until(p,()=>document.querySelector('.scrim .err')?.textContent.includes('Fictional acceptance failure'),'Acceptance failure visible');assert(await p.locator('#terms-agree').isChecked());
    await p.locator('#terms-accept').click();await until(p,()=>!document.querySelector('#terms-accept'),'Accepted dialog closes');assert.equal(acceptCalls,2);await p.reload();await until(p,()=>App.pageReady,'Reload ready');assert.equal(await p.locator('#terms-accept').count(),0,'Shown once for accepted version');cases+=3;
    accepted=false;await p.evaluate(version=>{App.me.terms={version,required:true};CommunityTerms.check();},version);await p.locator('#terms-data').click();await until(p,()=>App.pageReady&&location.pathname==='/me/settings','Your data remains reachable');assert.equal(await p.locator('#terms-accept').count(),0);assert.equal(await p.locator('#m-export').count(),1);assert.equal(await p.locator('#m-del').count(),1);
    await p.locator('#m-del').click();await p.getByRole('dialog').waitFor();assert(await p.getByRole('dialog').getByText('Delete my account',{exact:true}).count());await p.getByRole('dialog').locator('[data-close]').first().click();
    await p.evaluate(()=>go('/progress'));await p.locator('#terms-accept').waitFor();cases++;
    // An older same-account response cannot clear the replacement prompt for a newer version.
    let release;acceptWait=(route,submitted)=>new Promise(resolve=>{release=()=>route.fulfill({json:{version:submitted.version,required:false,accepted_version:submitted.version}}).then(resolve);});
    await p.locator('#terms-agree').check();await p.locator('#terms-accept').click();await until(p,()=>document.querySelector('#terms-accept')?.disabled,'Pending acceptance disabled');
    for(let n=0;n<100&&!release;n++)await p.waitForTimeout(20);assert(release);
    version='fixture-approved-v3';await p.evaluate(version=>{App.me.terms={version,required:true};CommunityTerms.check();},version);await release();await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>App.me.terms.version),version);assert.equal(await p.locator('#terms-accept').count(),1);assert.equal(await p.locator('#terms-agree').isChecked(),false);cases++;
    await p.evaluate(()=>{App.me=null;showLogin();});assert.equal(await p.locator('#terms-accept').count(),0,'Session end removes terms dialog');cases++;
    required=false;await p.goto(base+'/me/settings');await until(p,()=>App.pageReady,'Settings ready');
    const feed=await (await context.request.get(base+'/api/feed/friends?limit=1')).json();assert(feed.length);const activity=feed[0];
    // Two taps from an actual feed card: activity, then Report or block.
    await p.evaluate(()=>go('/activity'));await until(p,()=>App.pageReady&&document.querySelector('article.post'),'Feed ready');
    await p.locator(`article.post[data-href="/activity/friends/${activity.id}"] .post-title`).click();await p.locator('#s-rb').waitFor();await p.locator('#s-rb').click();await p.locator('#rp-form').waitFor();assert.equal(await p.locator('#rp-block').count(),1);await shot('report-activity');await p.getByRole('dialog').locator('[data-close]').first().click();cases++;
    await p.evaluate(login=>go('/people/'+login),activity.owner.login);await p.locator('[data-person-report]').waitFor();await p.locator('[data-person-report]').click();await p.locator('#rp-form').waitFor();await shot('report-person');await p.getByRole('dialog').locator('[data-close]').first().click();cases++;
    // Stand-in shared recipe response; its real page, menu and report handler run unchanged.
    const recipes=await(await context.request.get(base+'/api/dishes')).json(),dish={...recipes[0],mine:false,owner:activity.owner};assert(dish.id);
    await context.route('**/api/dishes/'+dish.id,route=>route.fulfill({json:dish}));await p.evaluate(id=>go('/food/cook/'+id),dish.id);await p.locator('#dk-more').waitFor();await p.locator('#dk-more').click();await p.locator('#sm-report').click();await p.locator('#rp-form').waitFor();await shot('report-recipe');
    await p.locator('input[name=why][value=abuse]').check();let releaseReport;reportWait=route=>new Promise(resolve=>{releaseReport=()=>route.fulfill({status:503,json:{detail:'Fictional report failure'}}).then(resolve);});await p.locator('#rp-form button.primary').click();for(let n=0;n<100&&!releaseReport;n++)await p.waitForTimeout(20);assert(releaseReport);assert(await p.locator('#rp-form button.primary').isDisabled());assert(await p.locator('#rp-block').isDisabled());await p.evaluate(()=>document.querySelector('#rp-form').requestSubmit());assert.equal(reportCalls.length,1);await releaseReport();await until(p,()=>!document.querySelector('#rp-form button.primary')?.disabled,'Report retry enabled');assert.equal(reportCalls[0].dish_id,dish.id);await p.locator('#rp-form button.primary').click();await until(p,()=>!document.querySelector('#rp-form'),'Report retry succeeds');cases+=2;
    const challenge={code:'fictional-community-challenge',title:'November 2026 · distance: 10 km',kind:'distance',sports:['walk'],target:10,unit:'km',start:'2026-11-01',end:'2026-11-30',creator:activity.owner.login,participants:2,member:false,owner:false,joining_closed:false,url:base+'/challenge/fictional-community-challenge'};
    await context.route('**/api/challenges/'+challenge.code,route=>route.fulfill({json:challenge}));await p.evaluate(code=>go('/me/challenges/'+code),challenge.code);await p.locator('#challenge-report').waitFor();await p.locator('#challenge-report').click();await p.locator('#rp-form').waitFor();await shot('report-challenge');await p.locator('input[name=why][value=other]').check();await p.locator('#rp-form button.primary').click();await until(p,()=>!document.querySelector('#rp-form'),'Challenge report sent');assert.equal(reportCalls.at(-1).challenge_code,challenge.code);cases++;
    // The existing comment renderer exposes Report directly, with the same block/report sheet.
    await p.evaluate(owner=>{const box=document.querySelector('#page');box.innerHTML='<div id="community-comments"><div class="social-reactions"></div><div class="comments"></div></div>';const target=document.querySelector('#community-comments');target._owner=readOwner();drawComments(target,999999,{comments:[{id:999998,login:owner.login,name:owner.name,text:'Fictional friendly comment',created:'2026-10-31T12:00:00Z'}],cheers:[],reactions:{},my_reaction:null});},activity.owner);
    await p.locator('[data-rep="999998"]').click();await p.locator('#rp-form').waitFor();await shot('report-comment');assert.equal(await p.locator('#rp-block').count(),1);await p.getByRole('dialog').locator('[data-close]').first().click();cases++;
    await fit();assert.deepEqual(errors,[]);console.log(`Community ${width}px ${theme}: signup/version retry/invite, accept/failure/data escape/stale/session, five report surfaces PASS`);
   }finally{await context.close();}
  }
  console.log(`Community terms: ${cases} rendered journey checks passed`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
