// Actual shared-picture photo boundary: authenticated binary reads, no cookie dependence in native, late owner guard.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/recaps.js','utf8');let owner='first',request,resolve,objects=0,revoked=[];
const context={AbortController,setTimeout,clearTimeout,readOwner:()=>owner,Native:{on:true,base:'https://example.test',headers:()=>({Authorization:'Bearer fictional-token'})},URL:{createObjectURL:()=> 'blob:fictional-'+(++objects),revokeObjectURL:url=>revoked.push(url)},Image:class{async decode(){}},fetch:(url,options)=>new Promise(ok=>{request={url,options};resolve=ok})};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const ShareArt='),source.indexOf('const Recaps='))+'\nthis.art=ShareArt;',context);
(async()=>{
 let pending=context.art.photo('/api/people/demo/photo?v=1');assert.equal(request.url,'https://example.test/api/people/demo/photo?v=1');assert.equal(request.options.headers.Authorization,'Bearer fictional-token');assert.equal(request.options.credentials,'omit');resolve({ok:true,blob:async()=>({size:100})});assert((await pending).src.startsWith('blob:'));assert.equal(revoked.length,1);
 pending=context.art.photo('/api/people/demo/photo?v=1');owner='another-account';resolve({ok:true,blob:async()=>({size:100})});assert.equal(await pending,null);assert.equal(objects,1,'A late account response cannot create a reusable old-owner blob');
 context.Native.on=false;context.Native.base='';pending=context.art.photo('/api/people/demo/photo?v=1');assert.equal(request.options.credentials,'same-origin');resolve({ok:false});assert.equal(await pending,null);
 context.Native.on=true;let expire;context.setTimeout=fn=>{expire=fn;return 1;};context.clearTimeout=()=>{};context.Image=class{decode(){return new Promise(()=>{});}};
 pending=context.art.photo('/api/people/demo/photo?v=2');resolve({ok:true,blob:async()=>({size:100})});await new Promise(ok=>setImmediate(ok));expire();assert.equal(await pending,null,'An unresponsive decoder cannot hang the picture');assert.equal(revoked.length,2,'Timed-out decoding releases its blob');
 console.log('Share-picture identity photos: authenticated native read, browser cookie, bounded binary, revoked URL and late-owner isolation PASS');
})().catch(error=>{console.error(error);process.exit(1)});
