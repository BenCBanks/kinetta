'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const source=fs.readFileSync('app/static/upload-hash-worker.js','utf8');
(async()=>{
  for(const size of [0,3,55,56,63,64,65,1048575,1048576,1048577,8388617]){
    const data=size===3?Buffer.from('abc'):Buffer.alloc(size,173),expected=crypto.createHash('sha256').update(data).digest('hex');
    let result,largest=0;const self={postMessage:message=>{if(message.sha256)result=message.sha256;assert(!message.error);}};
    vm.runInNewContext(source,{self,Uint32Array,Uint8Array,DataView});
    const blob=new Blob([data]);await self.onmessage({data:{size,slice:(a,b)=>{largest=Math.max(largest,b-a);return blob.slice(a,b);}}});
    assert.equal(result,expected,'SHA-256 at padding/slice boundary '+size);assert(largest<=1048576,'bounded reads');
  }
  console.log('PASS incremental upload SHA-256: vectors, padding, multi-slice and bounded reads');
})().catch(e=>{console.error(e);process.exit(1);});
