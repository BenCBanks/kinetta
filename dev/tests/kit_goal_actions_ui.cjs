// Fictional stand-in answer; no model, external requests or goal writes.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:9191',out=process.env.KINETTA_SHOTS||'/tmp/dash-kit-goal';
const cid='9cfe6994-e18e-4824-bc87-1da1f9486507',generation='d4d61926-c625-4b93-8b77-1c529bda4bd3',pid='fe5cc342-8c7a-4245-b832-e87777db4f32';
const candidate={candidate_id:'a'.repeat(64),goal:{id:4,sport:'run',period:'week',metric:'distance',target:20000},value:30,unit:'km',target:30000,before:'20 km',after:'30 km'};
const selection={kind:'goal',candidate_id:candidate.candidate_id,candidate,confirmation_required:true};
async function main(){
 const browser=await chromium.launch(),login=await browser.newContext();fs.mkdirSync(out,{recursive:true});
 try{
  const response=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
  assert.equal(response.status(),200);const state=await login.storageState();
  for(const width of [390,330])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',deviceScaleFactor:2,isMobile:true,hasTouch:true,timezoneId:'UTC'}),p=await c.newPage(),errors=[];
   let creates=0,confirms=0,fail=false,hold=null,seen;
   let confirmSeen=new Promise(resolve=>{seen=resolve;});
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){
     const res=await route.fetch(),me=await res.json();return route.fulfill({response:res,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});
    }
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:req.postDataJSON().visit_id,generation,ready:true}});
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation,ready:true,messages:[{client_id:cid,question:'Change my weekly running goal to 30 km.',state:'answered',answer:{interpretation:'Review the proposed target before confirming.',selection,facts:[],actions:[],follow_ups:[]}}]}});
    if(u.pathname==='/api/coach/conversation/goal-proposals'){
     creates++;assert.deepEqual(req.postDataJSON(),{client_id:cid,candidate_id:candidate.candidate_id});
     return route.fulfill({json:{id:pid,payload:{candidate},status:'pending'}});
    }
    if(u.pathname==='/api/coach/conversation/goal-proposals/'+pid+'/confirm'){
     confirms++;assert.deepEqual(req.postDataJSON(),{confirmed:true});
     await new Promise(resolve=>{hold=resolve;seen();});
     return route.fulfill(fail?{status:409,json:{detail:'Your goal changed. Ask Kit for a fresh proposal.'}}:{json:{status:'applied',already_applied:false,receipt:{before:'20 km',after:'30 km',saved_at:'2026-11-26T12:00:00Z'}}});
    }
    if(req.method()!=='GET')return route.fulfill({json:{}});
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');
   await p.getByRole('button',{name:'Review proposed change'}).click();
   await p.getByRole('button',{name:'Confirm goal change'}).waitFor();
   await p.waitForFunction(()=>document.fonts.status==='loaded');
   assert.equal(creates,0,'Opening preview does not store a proposal or change the goal');
   await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getComputedTiming().iterations!==Infinity));
   await p.screenshot({path:`${out}/preview-${width}-${theme}.png`});
   const geometry=await p.locator('#kit-goal-confirm').boundingBox();assert(geometry.height>=44&&geometry.x>=0&&geometry.x+geometry.width<=width);
   await p.locator('#kit-goal-confirm').click();
   await p.waitForFunction(()=>document.querySelector('#kit-goal-confirm')?.disabled===true);
   await p.locator('#kit-goal-confirm').evaluate(button=>button.click());
   await confirmSeen;
   await p.screenshot({path:`${out}/saving-${width}-${theme}.png`});hold();
   await p.getByRole('heading',{name:'Goal saved',exact:true}).waitFor();
   assert.equal(creates,1);assert.equal(confirms,1,'Disabled confirm prevents double submission');
   assert(await p.getByText('30 km',{exact:true}).isVisible());
   await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getComputedTiming().iterations!==Infinity));
   await p.screenshot({path:`${out}/saved-${width}-${theme}.png`});
   await p.getByRole('button',{name:'Done',exact:true}).click();fail=true;hold=null;confirmSeen=new Promise(resolve=>{seen=resolve;});
   await p.getByRole('button',{name:'Review proposed change'}).click();await p.locator('#kit-goal-confirm').click();
   await confirmSeen;hold();
   await p.getByText('Your goal changed. Ask Kit for a fresh proposal.',{exact:true}).waitFor();
   assert(await p.locator('#kit-goal-confirm').isDisabled(),'A stale goal requires a new preview');
   await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getComputedTiming().iterations!==Infinity));
   await p.screenshot({path:`${out}/stale-${width}-${theme}.png`});
   assert.deepEqual(errors,[]);await c.close();
  }
  console.log('Kit goal UI: 390/330 light/dark preview, explicit confirmation, one submit, receipt and stale error PASS');
 }finally{await login.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1);});
