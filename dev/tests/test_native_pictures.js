// Run the production private-image loader with deferred responses. No real images, account or network.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/native.js','utf8'),begin=source.indexOf('  // photos (app.js pimg)'),end=source.indexOf('  N.forget =',begin);assert(begin>0&&end>begin);
const tick=()=>new Promise(setImmediate);
(async()=>{
 let owner='session-a',images=[],requests=[],objects=0,revoked=[];
 const N={base:'https://one.example.test',token:'fictional-a',headers(){return{Authorization:'Bearer '+this.token}}};
 const context={N,on:true,readOwner:()=>owner,AbortController,WeakMap,Map,URL:{createObjectURL:()=> 'blob:fictional-'+(++objects),revokeObjectURL:url=>revoked.push(url)},Event:class{},MutationObserver:class{observe(){}},document:{querySelectorAll:()=>images.filter(im=>im.dataset.asrc)},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
 vm.createContext(context);vm.runInContext(source.slice(begin,end)+'\nthis.fillPictures=fill;',context);
 const image=()=>({dataset:{asrc:'/api/people/demo/photo?v=1'},isConnected:true,removeAttribute(){delete this.dataset.asrc},dispatchEvent(){this.failed=true}});
 const a=image();images=[a];context.fillPictures();assert.equal(requests.length,1);assert.equal(requests[0].options.credentials,'omit');
 owner='session-b';N.base='https://two.example.test';N.token='fictional-b';const b=image();images=[b];context.fillPictures();assert.equal(requests.length,2,'Another server/session must never reuse the first private photo');assert.equal(requests[0].options.signal.aborted,true);
 requests[0].resolve({ok:true,blob:async()=>({})});await tick();assert(!a.src,'A late old-session response cannot paint');
 requests[1].resolve({ok:true,blob:async()=>({})});await tick();assert.equal(b.src,'blob:fictional-1');assert.equal(requests[1].options.headers.Authorization,'Bearer fictional-b');assert.equal(requests[1].options.cache,'no-store');
 const same=image();images=[same];context.fillPictures();await tick();assert.equal(requests.length,2,'Same-session reuse is allowed');assert.equal(same.src,b.src);
 owner='new-login-to-same-account';N.clearPictures();assert(revoked.includes('blob:fictional-1'));const next=image();images=[next];context.fillPictures();assert.equal(requests.length,3,'A fresh login must revalidate permission');
 console.log('Private native photos: server/session isolation, fresh permission check, aborted old request, late-response guard and revoked object URLs PASS');
})().catch(error=>{console.error(error);process.exit(1)});
