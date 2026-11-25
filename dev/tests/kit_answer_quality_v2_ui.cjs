// Fictional Kit answer-quality v2 examples: client-only fact hygiene at phone width.
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.KINETTA_URL||'http://localhost:8798',out=process.env.KINETTA_SHOTS||'/tmp/kit-answer-quality-v2';
const generation='fixture-kit-quality-v2-generation';
const examples=[
 {name:'harder-run',question:'Did the run feel harder than usual?',answer:{
   verdict:'Your 6.1 mi run was a harder effort than last time on this route.',
   reason:'Average heart rate was 172 bpm against 158 bpm last time.',
   facts:[
    {path:['runs',0,'distance_m'],value:9817.4,display_value:'6.1 mi'},
    {path:['runs',0,'avg_hr'],value:172,display_value:'172 bpm'},
    {path:['efforts',0,'avg_hr'],value:158,display_value:'158 bpm'},
    {path:['runs',0,'effort'],value:123.8,display_value:'123.8'},
    {path:['runs',0,'pace_s_per_km'],value:525,display_value:'8:45 /mi'},
    {path:['efforts',0,'pace_s_per_km'],value:545,display_value:'9:05 /mi'}
   ],
   follow_ups:['Would you like to compare my workouts?','What is the next step?','How did you feel?']
 }},
 {name:'recorded-session',question:'How did the session go?',answer:{
   verdict:'The session was recorded consistently.',
   reason:'48 minutes, averaging 172 bpm.',
   facts:[
    {path:['runs',0,'moving_s'],value:2880,display_value:'48 min'},
    {path:['runs',0,'avg_hr'],value:172,display_value:'172 bpm'},
    {path:['efforts',0,'avg_hr'],value:158,display_value:'158 bpm'},
    {path:['runs',0,'effort'],value:123.8,display_value:'123.8'},
    {path:['runs',0,'pace_s_per_km'],value:525,display_value:'8:45 /mi'}
   ],
   follow_ups:['Would you like to compare my workouts?','Are you ready to train again?','My legs feel heavy today']
 }}
];
async function main(){
 const browser=await chromium.launch(),login=await browser.newContext();
 try{
  const signed=await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});
  assert.equal(signed.status(),200,'fictional demo account signs in');
  const state=await login.storageState();
  for(const theme of ['light','dark'])for(const example of examples){
   const c=await browser.newContext({storageState:state,viewport:{width:390,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'America/New_York'}),p=await c.newPage(),errors=[],writes=[];
   const visit='fixture-kit-quality-v2-'+example.name+'-'+theme;
   p.on('pageerror',e=>errors.push(e.message));
   await c.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'&&req.method()==='GET'){
     const response=await route.fetch(),me=await response.json();
     return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});
    }
    if(u.pathname==='/api/coach/conversation/visits'&&req.method()==='POST')return route.fulfill({json:{visit_id:visit,generation,ready:true}});
    if(u.pathname==='/api/coach/conversation'&&req.method()==='GET')return route.fulfill({json:{generation,ready:true,before:null,messages:[{id:1,client_id:'fixture-kit-quality-'+example.name,question:example.question,state:'answered',answer:example.answer}]}});
    if(u.pathname==='/api/challenges/signup/continue'&&req.method()==='POST')return route.fulfill({json:{joined:null}});
    if(['POST','PUT','PATCH','DELETE'].includes(req.method())){writes.push(u.pathname);return route.fulfill({json:{}});}
    return route.continue();
   });
   await p.goto(base+'/me/kit?from=progress');
   const article=p.locator('#kit-messages article');await article.locator('.kit-answer').waitFor({state:'visible'});
   const rows=article.locator('.kit-facts > div');
   assert.equal(await rows.count(),example.name==='harder-run'?2:2,`${example.name} ${theme}: duplicate and bare effort rows are hidden`);
   const text=await article.innerText();
   assert(!text.includes('123.8'),`${example.name} ${theme}: bare Effort is not shown`);
   assert(text.includes('This run')&&text.includes('Last run on this route'),`${example.name} ${theme}: source labels are visible`);
   if(example.name==='harder-run'){
    assert.equal((text.match(/6\.1 mi/g)||[]).length,1,'repeated distance is present only in the answer copy');
    assert.equal((text.match(/172 bpm/g)||[]).length,1,'repeated current heart rate is present only in the answer copy');
   }else{
    assert.equal((text.match(/48 min/g)||[]).length,1,'repeated duration is present only in the answer copy');
    assert.equal((text.match(/172 bpm/g)||[]).length,1,'repeated heart rate is present only in the answer copy');
   }
   const followups=await article.locator('[data-kit-followup]').allTextContents();
   assert(followups.length>=1&&followups.length<=2,`${example.name} ${theme}: only first-person follow-ups remain`);
   assert(followups.every(q=>!/^What|^Are you|^How did you/i.test(q)),`${example.name} ${theme}: non-first-person follow-ups are hidden`);
   assert.deepEqual(errors,[],`${example.name} ${theme}: no page errors`);assert.deepEqual(writes,[],`${example.name} ${theme}: no writes or provider calls`);
   if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`kit-quality-${example.name}-390-${theme}.png`),animations:'disabled'});}
   await c.close();
  }
  console.log('Kit answer quality v2: fictional duplicate facts, source labels, Effort suppression and first-person follow-ups pass at 390px light/dark.');
 }finally{await login.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1);});
