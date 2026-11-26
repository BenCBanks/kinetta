// Fictional checked conversational answer; all generation and writes are blocked.
'use strict';
const {webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:9191',out=process.env.KINETTA_SHOTS;
(async()=>{const browser=await webkit.launch();try{
 const login=await browser.newContext();assert.equal((await login.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}})).status(),200);const state=await login.storageState();await login.close();
 for(const width of [390,330])for(const theme of ['light','dark']){
  const c=await browser.newContext({storageState:state,viewport:{width,height:844},colorScheme:theme,serviceWorkers:'block',isMobile:true,hasTouch:true}),p=await c.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));
  const blocks=[{kind:'paragraph',text:'You said you prefer walking. Choose a day for your next walk before adding anything else.'},{kind:'paragraph',text:'Which day would work around your schedule?'}];
  await c.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();
   if(u.pathname==='/api/me'){const response=await route.fetch(),me=await response.json();return route.fulfill({response,json:{...me,ai_ok:true,coach:true,kit_chat:true,ai_paused:false}});}
   if(u.pathname==='/api/coach/conversation/visits')return route.fulfill({json:{visit_id:'fictional-visit',generation:'fictional-generation',ready:true}});
   if(u.pathname==='/api/coach/conversation')return route.fulfill({json:{generation:'fictional-generation',ready:true,messages:[{id:1,client_id:'fictional-context',question:'What should I focus on next?',state:'answered',answer:{answer_blocks:blocks,facts:[],actions:['goals'],follow_ups:[]}}]}});
   if(u.pathname==='/api/challenges/signup/continue')return route.fulfill({json:{joined:null}});
   if(r.method()!=='GET'){writes.push(u.pathname);return route.fulfill({json:{}});}return route.continue();
  });
  await p.goto(base+'/me/kit');await p.getByText(blocks[1].text,{exact:true}).waitFor();await p.evaluate(()=>document.fonts.ready);
  assert.equal(await p.locator('.kit-answer-blocks>p').count(),2);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const box of await p.locator('.kit-answer-blocks p').evaluateAll(els=>els.map(el=>({w:el.clientWidth,scroll:el.scrollWidth}))))assert(box.scroll<=box.w+1);
  if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:`${out}/context-${width}-${theme}.png`,animations:'disabled'});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await c.close();
 }
 console.log('Contextual coach checked-paragraph stand-in:390/330 light/dark WebKit,no clipping or writes PASS');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
