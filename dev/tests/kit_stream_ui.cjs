// Fictional checked blocks through the actual fetch consumer; generation stays blocked.
'use strict';
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:9186',out=process.env.KINETTA_SHOTS||'/tmp/kit-stream-ui';
(async()=>{
 const browser=await(process.env.KIT_UI_BROWSER==='webkit'?webkit:chromium).launch();
 try{
  const login=await browser.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const state=await login.storageState();await login.close();
  for(const durable of [false,true])for(const width of [390,330])for(const theme of ['light','dark']){
   const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true});
   const p=await c.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
   const row={id:1,client_id:'fictional-stream-message',question:'Help me plan my next week',state:'pending'},blocks=[{kind:'paragraph',text:'Start with the days that fit your week.'},{kind:'paragraph',text:'Choose when your next easy workout fits, and leave room to rest.'}];
   let completed=false;
   await c.addInitScript(({blocks,row})=>{
    const original=window.fetch;window.fetch=async(input,opts)=>{
     if(String(input).endsWith('/fictional-stream-message/stream'))return new Response(new ReadableStream({start(controller){
      const send=(event,data)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));
      send('start',{version:1});send('block',{index:0,block:blocks[0]});
      window.finishFixtureStream=()=>{send('block',{index:1,block:blocks[1]});send('complete',{message:{...row,state:'answered',answer:{answer_blocks:blocks,facts:[],actions:['plan']}}});controller.close();};
     }}),{headers:{'Content-Type':'text/event-stream'}});
     return original(input,opts);
    };
   },{blocks,row});
   await c.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();
    if(u.pathname==='/api/me'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false,ai_access:{...(me.ai_access||{}),coach:{available:true,entitled:true}}}});}
    if(u.pathname==='/api/coach/conversation/threads')return route.fulfill({json:durable?{enabled:true,retention:'until_deleted',generation:'fixture-generation',conversations:[{conversation_id:'fixture-thread',title:'Fictional saved chat'}]}:{enabled:false}});
    if(durable&&u.pathname.startsWith('/api/coach/conversation/threads/'))return route.fulfill({json:{conversation_id:'fixture-thread',visit_id:'fixture-visit',generation:'fixture-generation',ready:true,stream_supported:true,messages:[completed?{...row,state:'answered',answer:{answer_blocks:blocks,facts:[],actions:['plan']}}:row]}});
    if(u.pathname==='/api/coach/conversation/visits'&&r.method()==='POST')return route.fulfill({json:{visit_id:'fixture-visit',generation:'fixture-generation',ready:true}});
    if(u.pathname==='/api/coach/conversation')return route.fulfill({json:{generation:'fixture-generation',ready:true,stream_supported:true,messages:[completed?{...row,state:'answered',answer:{answer_blocks:blocks,facts:[],actions:['plan']}}:row]}});
    if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{joined:null}});
    if(r.method()!=='GET'){writes.push(u.pathname);return route.fulfill({json:{}});}return route.continue();
   });
   await p.goto(base+'/me/kit');if(durable)await p.locator('[data-kit-retry]').click();await p.getByText(blocks[0].text,{exact:true}).waitFor();
   assert.equal(await p.getByText(blocks[1].text,{exact:true}).count(),0,'first checked block appears before completion');
   assert.equal(await p.locator('.kit-answer-followups').count(),0,'no action before complete');
   fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/kit-stream-${durable?'saved':'legacy'}-first-${width}-${theme}.png`});
   completed=true;await p.evaluate(()=>finishFixtureStream());await p.getByText('Training plan',{exact:true}).waitFor();
   assert.equal(await p.locator('.kit-answer-blocks>p').count(),2,'complete replaces, never duplicates partial blocks');
   const gap=await p.locator('.kit-answer-followups').evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling.getBoundingClientRect().bottom);assert(Math.abs(gap-12)<.6);
   await p.screenshot({path:`${out}/kit-stream-${durable?'saved':'legacy'}-complete-${width}-${theme}.png`});assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'stand-in stream makes no generation request');await c.close();
  }
 }finally{await browser.close();}
 console.log('Kit stream UI: legacy/saved-chat first checked paragraph before complete, authoritative replacement/action gap,390/330 light/dark PASS; stand-ins only');
})().catch(e=>{console.error(e);process.exitCode=1;});
