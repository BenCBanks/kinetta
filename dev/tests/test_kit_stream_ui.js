// Fragmented checked-block transport; no server or provider.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/kit.js','utf8'),extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
(async()=>{
 const block={kind:'paragraph',text:'Checked <plain> text.'},row={client_id:'c',state:'answered',answer:{answer_blocks:[block]}};
 let frames=[],draws=[],valid=true,c;
 const context={AbortController,TextDecoder,requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){},App:{me:{id:5}},Native:{base:'',on:false,headers:()=>({Authorization:'Bearer fixture'})},json:(method,body)=>({method,body:JSON.stringify(body)}),draw:chat=>draws.push(JSON.parse(JSON.stringify(chat.messages[0]))),answerBlocks:a=>a.answer_blocks?.every(b=>b.kind==='paragraph'&&typeof b.text==='string')?a.answer_blocks:null,
 fetch:async(_url,options)=>{assert.equal(options.headers['X-Kinetta-Account'],'5');assert.equal(options.headers.Authorization,'Bearer fixture');return {ok:true,status:200,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({async read(){if(!frames.length)return {done:true};const frame=frames.shift();if(typeof frame==='function')return frame();return {value:new TextEncoder().encode(frame)};},async cancel(){}})}}}};
 vm.createContext(context);vm.runInContext(extract('  async function streamAnswer(', '  async function answer('),context);
 const event=(name,data)=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
 const start=()=>{c={messages:[{client_id:'c',state:'pending'}]};draws=[];valid=true;};start();
 const b=event('block',{index:0,block}),done=event('complete',{message:row});
 frames=[': keep-alive\n\n',b.slice(0,7),b.slice(7),()=>{assert.equal(draws.length,1,'checked block paints before complete');assert.equal(draws[0].answer.facts.length,0);return {value:new TextEncoder().encode(done)}}];
 assert.equal((await context.streamAnswer(c,'c',{},()=>valid)).state,'answered');assert.equal(draws[0].answer.answer_blocks[0].text,block.text);
 for(const broken of [event('block',{index:1,block}),event('block',{index:0,block:{kind:'script',text:'raw'}}),event('error',{code:'access_changed'}),b]){
  start();frames=[broken];await assert.rejects(context.streamAnswer(c,'c',{},()=>valid));
 }
 start();frames=[b,()=>{valid=false;return {value:new TextEncoder().encode(done)}}];assert((await context.streamAnswer(c,'c',{},()=>valid)).cancelled);assert.equal(draws.length,1,'changed owner/visit has no later paint');
 for(const status of [429,503]){
  start();frames=[event('error',{code:status===429?'rate_limited':'unavailable',status,restore_draft:true,detail:'private provider text'})];
  await assert.rejects(context.streamAnswer(c,'c',{},()=>valid),error=>error.status===status&&error.restoreDraft===true&&!error.message.includes('private'));
 }
 assert.equal(c.streamController,null);console.log('Kit stream client: fragmented frames, first checked paint, no early actions, closed errors, truncation and owner/visit fence PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
