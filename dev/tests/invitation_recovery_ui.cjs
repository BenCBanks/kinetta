// Actual route handlers, fictional saved-state model. Bridge transport is a browser stand-in.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(browser,base,out='')=>{
 const gid='00000000-0000-4000-8000-000000000099',code='fictional-recovery';
 const person={login:'fictional_host',name:'Fictional Host',photo:false};
 const group={id:gid,title:'Fictional crew',members:[],member_count:1,challenges:[],updates:[],is_organizer:false,closed:false,joining_closed:false};
 const challenge=member=>({code,kind:'distance',title:'Fictional miles',sports:['run'],target:100,unit:'km',start:'2026-11-01',end:'2026-12-31',creator:person.login,participants:1,member,owner:false,joining_closed:false,people:[],garmin_sources:[],self:member?{value:0,days_left:10,finished:false,complete:false}:null});
 const specs=[
  {name:'friend',route:'/add/'+code,read:'/api/friend-links/'+code+'/state',write:'/api/friend-links/'+code,button:'#af-yes',done:'/people/'+person.login},
  {name:'group',route:'/group-invite/'+code,read:'/api/group-invites/'+code+'/state',write:'/api/group-invites/'+code+'/accept',button:'#group-accept',done:'/groups/'+gid},
  {name:'addressed',route:'/groups/invites/77',read:'/api/group-friend-invites/77/state',write:'/api/group-friend-invites/77/accept',button:'#group-friend-accept',done:'/groups/'+gid},
  {name:'decline',route:'/groups/invites/77',read:'/api/group-friend-invites/77/state',write:'/api/group-friend-invites/77/decline',button:'#group-friend-decline',done:'/activity'},
  {name:'challenge',route:'/me/challenges/'+code,read:'/api/challenges/'+code,write:'/api/challenges/'+code+'/join',button:'#challenge-join'},
  {name:'public',route:'/_test/public-invite',read:'/api/challenges/'+code,write:'/api/challenges/'+code+'/join',button:'#challenge-public-join',done:'/me/challenges/'+code},
  {name:'request',route:'/me/friends?find=1',read:'/api/friends',write:'/api/friends/'+person.login+'/accept',button:'[data-request-accept]'},
  {name:'send',route:'/groups/'+gid,read:'/api/groups/'+gid+'/friends',write:'/api/groups/'+gid+'/friend-invites',button:'[data-invite-friend]',prepare:async p=>{await p.locator('#group-header-invite').click();}}
 ];
 for(const mode of ['web','bridge'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,serviceWorkers:'block'});
  const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run',app:mode==='bridge'}});assert(login.ok());
  if(mode==='bridge'){const {token}=await login.json();await c.addInitScript(({base,token})=>{const values={server:base,token};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='Preferences',Plugins:{Preferences:{get:async({key})=>({value:values[key]??null}),set:async({key,value})=>values[key]=value,remove:async({key})=>delete values[key]}}};},{base,token});}
  const p=await c.newPage();p.setDefaultTimeout(8000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  let spec,armed=false,member=false,declined=false,unreadable=false,fault='',writes=0,reads=0;
  await c.route('**/*',async r=>{
   const req=r.request(),u=new URL(req.url()),method=req.method();if(u.origin!==base)return r.abort();
   if(method==='GET'&&u.pathname===spec?.read)reads++;
   if(u.pathname==='/_test/public-invite')return r.fulfill({contentType:'text/html',body:'<button id="challenge-public-join" data-code="'+code+'" data-account="fictional-owner">Join challenge</button><p id="challenge-public-status"></p><script src="/static/challenge-public.js"></script>'});
   if(armed&&spec.name==='public'&&u.pathname.startsWith('/api/challenges/'))assert.equal(req.headers()['x-kinetta-account'],'fictional-owner');
   if(armed&&method==='GET'&&u.pathname===spec.read&&unreadable)return fault.includes('offline')?r.abort():r.fulfill({status:503,json:{detail:'Fictional outage'}});
   if(armed&&method!=='GET'&&u.pathname===spec.write){writes++;if(fault.startsWith('lost')){if(spec.name==='decline')declined=true;else member=true;return r.abort();}return fault==='offline'?r.abort():r.fulfill({status:503,json:{detail:'Fictional outage'}});}
   if(u.pathname==='/api/friend-links/'+code+'/state')return r.fulfill({json:{member,name:'@'+person.login,login:person.login}});
   if(u.pathname==='/api/group-invites/'+code+'/state')return r.fulfill({json:member?{member,id:gid,share_total:false}:{member}});
   if(u.pathname==='/api/group-friend-invites/77/state')return r.fulfill({json:member?{member,id:gid,share_total:false}:{member,declined,title:group.title,inviter:person.login}});
   if(u.pathname==='/api/groups/'+gid+'/friends')return r.fulfill({json:{friends:[{username:person.login,state:member?'invited':'none'}],can_invite:true}});
   if(u.pathname==='/api/groups/'+gid)return r.fulfill({json:group});
   if(u.pathname==='/api/groups/'+gid+'/challenges')return r.fulfill({json:[]});
   if(u.pathname==='/api/challenges/'+code)return r.fulfill({json:challenge(member)});
   if(u.pathname==='/api/friends')return r.fulfill({json:{friends:member?[person]:[],incoming:member?[]:[person],outgoing:[]}});
   if(u.pathname==='/api/people/search')return r.fulfill({json:[]});
   if(u.pathname==='/api/people/suggested')return r.fulfill({json:[]});
   return r.continue();
  });
  try{for(spec of specs.filter(s=>!process.env.KINETTA_INVITATION_CASE||process.env.KINETTA_INVITATION_CASE===s.name))for(fault of ['lost','503','offline','lost-offline','lost-503',...(['public','friend','group','addressed','challenge'].includes(spec.name)?['lost-reload','lost-reload-unreadable','503-reload']:[])].filter(f=>!process.env.KINETTA_INVITATION_FAULT||f===process.env.KINETTA_INVITATION_FAULT)){
   armed=false;member=false;declined=false;unreadable=false;writes=0;reads=0;
   await p.goto(base+spec.route);if(spec.prepare)await spec.prepare(p);await p.locator(spec.button).first().waitFor();
   if(spec.name==='group'||spec.name==='addressed')await p.locator('[data-group-join-share]').uncheck();
   armed=true;unreadable=fault.includes('offline')||fault==='lost-503';await p.locator(spec.button).first().click();
   if(fault.includes('reload')){
    await (spec.name==='public'?p.getByRole('button',{name:'Retry',exact:true}):p.locator('[data-sharing-state=unknown]')).waitFor();
    await require('./privacy_recovery_fixture.cjs')(p);
    // Keep the advanced clock through navigation, as a real later reload would.
    const later=await p.evaluate(()=>Date.now());await c.addInitScript(now=>{const clock=Date.now,offset=now-clock();Date.now=()=>clock()+offset;},later);
    unreadable=fault==='lost-reload-unreadable';reads=0;await p.reload();
    if(spec.name==='public'){
     assert.equal(await p.locator(spec.button).innerText(),'Retry','expired deadline keeps uncertainty on reload');
     await p.locator(spec.button).click();
    }
    if(unreadable){
     if(spec.name==='public')await p.waitForFunction(()=>document.querySelector('#challenge-public-status')?.textContent.includes('Not confirmed'));
     else{await p.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await p.locator(spec.button).count(),0,'failed initial GET cannot offer a join');}
     assert.equal(writes,1,'failed read after reload cannot repeat the write');unreadable=false;await p.reload();
     if(spec.name==='public')await p.locator(spec.button).click();
    }
    if(fault.startsWith('lost')){
     if(spec.done)await p.waitForURL(base+spec.done);else await p.locator('#challenge-invite').waitFor();
    }else if(spec.name==='public')await p.waitForFunction(()=>document.querySelector('#challenge-public-status')?.textContent.includes('Not joined'));
    else await p.locator(spec.button).waitFor({state:'visible'});
    assert(reads>0,'reload recovery checks membership');assert.equal(writes,1,'reload after deadline performs GET before any new join');
    if(spec.name==='public')assert.equal(await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':challenge:')).length),0,'confirmed membership read clears uncertainty');
    console.log('Invitation recovery '+mode+' '+theme+' '+spec.name+' '+fault+' PASS');continue;
   }
   if(spec.name==='public'){await p.getByRole('button',{name:'Retry',exact:true}).waitFor();unreadable=false;if(fault==='lost'){const previous=reads;await p.locator(spec.button).click();assert.equal(await p.locator('#challenge-public-status').innerText(),'Checking…');assert.equal(reads,previous,'early public Retry does not read before the bound');await require('./privacy_recovery_fixture.cjs')(p);}else{await require('./privacy_recovery_fixture.cjs')(p);await p.locator(spec.button).click();}}
   else if(spec.name!=='public'){const note=p.locator('[data-sharing-state=unknown]');await note.waitFor();assert(await p.locator(spec.button).first().isVisible(),'uncertain action keeps its position');assert.equal(await p.locator(spec.button).first().getAttribute('aria-disabled'),'true','uncertain action is blocked');
    if(out&&fault==='lost-offline'&&mode==='web'&&['friend','group','challenge'].includes(spec.name)){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'invite-'+spec.name+'-'+theme+'-unknown.png')});}
    unreadable=false;if(fault==='lost'){const previous=reads;await note.getByRole('button',{name:'Retry',exact:true}).click();await p.locator('[data-sharing-state=checking]').waitFor();assert.equal(reads,previous,'early Retry does not read before the bound');await require('./privacy_recovery_fixture.cjs')(p);}else{await require('./privacy_recovery_fixture.cjs')(p);await note.getByRole('button',{name:'Retry',exact:true}).click();}
   }
   const completed=fault.startsWith('lost');
   if(completed&&spec.done)await p.waitForURL(base+spec.done);
   else if(completed&&spec.name==='challenge')await p.locator('#challenge-invite').waitFor();
   else if(completed&&spec.name==='request')await p.locator('[data-request-accept]').waitFor({state:'detached'});
   else if(completed&&spec.name==='send')await p.getByRole('button',{name:'Invited @'+person.login,exact:true}).waitFor();
   else if(spec.name==='public')await p.waitForFunction(()=>document.querySelector('#challenge-public-status')?.textContent.includes('Not joined'));
   else await p.locator(spec.button).first().waitFor({state:'visible'});
   assert.equal(writes,1,'read-only recovery never repeats the write');assert.equal(member,completed&&spec.name!=='decline');assert.equal(declined,completed&&spec.name==='decline');
   if(!completed)assert.equal(new URL(p.url()).pathname,spec.route.split('?')[0],'failure cannot navigate as success');
   if(completed&&spec.done&&!['decline','public'].includes(spec.name)){armed=false;await p.goto(base+spec.route);await p.waitForURL(base+spec.done);assert.equal(writes,1,'reopening resumes the saved relationship');}
   console.log('Invitation recovery '+mode+' '+theme+' '+spec.name+' '+fault+' PASS');
  }assert.deepEqual(errors,[]);}finally{await c.close();}
 }
};
