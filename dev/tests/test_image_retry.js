// Exercise the production upload handlers with a selected fictional file and a busy server.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const busy=()=>Object.assign(Error('Photo processing is busy. Your photo is kept; try again shortly.'),{status:503});
function fixture(){
 const file={files:['fictional-a','fictional-b'],click(){throw Error('Retry must not reopen file picker');}},span={textContent:''},button={disabled:false,textContent:''},box={isConnected:true,innerHTML:''};
 let owner='fictional-a',shrinks=0,calls=[];const replies=[],me={id:1},c={App:{me},readOwner:()=>owner,EmailConfirmation:{lock:()=>false},svg:()=>'',avatar:()=>'',toast:()=>{},json:(method,body)=>({method,body}),shrinkPhoto:async file=>{shrinks++;return 'pixels:'+file;},syncMeTabPhoto(){},sheet:(_title,_html,open)=>open(box,()=>{}),$:(s)=>s==='span'?span:s.includes('file')?file:s.includes('rm')?null:button,$$:()=>[],pimg:()=>'',photoChanged:()=>{},invalidate:()=>{},invalidateFeed:()=>{},api:async(path,options)=>{calls.push({path,...options});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply||{id:calls.length,photo:'fictional-version'};}};
 vm.createContext(c);return {c,file,span,button,box,replies,calls,shrinks:()=>shrinks,switch:()=>{owner='fictional-b';c.App.me={id:2};}};
}
(async()=>{
 let f=fixture(),source=fs.readFileSync('app/static/pages.js','utf8');
 vm.runInContext(source.slice(source.indexOf('function profilePhotoSheet('),source.indexOf('// Questions, problems',source.indexOf('function profilePhotoSheet('))),f.c);
 f.c.profilePhotoSheet(()=>{});f.replies.push(busy());await f.file.onchange();assert.equal(f.button.textContent,'Retry photo');assert(!f.button.disabled);f.button.onclick();await tick();assert.equal(f.calls.length,2);assert.equal(f.shrinks(),1,'same prepared photo is retried');assert.equal(f.calls[0].body.image,f.calls[1].body.image);assert.equal(f.c.App.me.photo,'fictional-version');
 f.replies.push(busy());await f.file.onchange();f.switch();f.button.onclick();await tick();assert.equal(f.calls.length,3,'previous owner cannot retry under a different account');
 source=fs.readFileSync('app/static/social.js','utf8');f=fixture();vm.runInContext(source.slice(source.indexOf('const PHOTO_MAX ='),source.indexOf('async function saveActivityPhotoDraft(')),f.c);
 const activity={id:123,photos:[]};f.c.photoStrip(f.box,activity,true);f.replies.push({id:1},busy());await f.file.onchange();assert.equal(activity.photos.length,1);assert.equal(f.span.textContent,'Retry photo');assert(!f.button.disabled);f.button.onclick();await tick();assert.equal(f.calls.length,3);assert.equal(f.shrinks(),2);assert.equal(activity.photos.length,2);assert.equal(f.calls[1].body.image,f.calls[2].body.image,'resume starts at the failed file, without duplicating the first');
 f.c.photoStrip(f.box,activity,true);f.replies.push(busy());await f.file.onchange();const count=f.calls.length;f.switch();f.button.onclick();await tick();assert.equal(f.calls.length,count);
 // Each transient failure preserves the exact prepared image and all earlier successes.
 for(const error of [Object.assign(Error('Wait and retry'),{status:429}),Object.assign(Error('Offline'),{offline:true})]){
  f=fixture();vm.runInContext(fs.readFileSync('app/static/pages.js','utf8').split('function profilePhotoSheet(')[1].split('// Questions, problems')[0].replace(/^/,'function profilePhotoSheet('),f.c);
  f.c.profilePhotoSheet(()=>{});f.replies.push(error);await f.file.onchange();assert.equal(f.button.textContent,'Retry photo');f.button.onclick();await tick();assert.equal(f.shrinks(),1);assert.equal(f.calls.length,2);assert.equal(f.calls[0].body.image,f.calls[1].body.image);
  f=fixture();vm.runInContext(source.slice(source.indexOf('const PHOTO_MAX ='),source.indexOf('async function saveActivityPhotoDraft(')),f.c);
  const row={id:123,photos:[]};f.c.photoStrip(f.box,row,true);f.replies.push({id:1},error);await f.file.onchange();assert.equal(f.span.textContent,'Retry photo');f.button.onclick();await tick();assert.equal(row.photos.length,2);assert.equal(f.calls.length,3);assert.equal(f.shrinks(),2);assert.equal(f.calls[1].body.image,f.calls[2].body.image);
 }
 for(const status of [400,413]){
  f=fixture();vm.runInContext(fs.readFileSync('app/static/pages.js','utf8').split('function profilePhotoSheet(')[1].split('// Questions, problems')[0].replace(/^/,'function profilePhotoSheet('),f.c);f.c.profilePhotoSheet(()=>{});f.replies.push(Object.assign(Error('Choose a smaller photo'),{status}));await f.file.onchange();assert.equal(f.button.textContent,'Choose a photo');
 }
 // Deferred review drafts must also retain pending images until the server accepts them.
 vm.runInContext(source.slice(source.indexOf('async function saveActivityPhotoDraft('),source.indexOf('// full screen:',source.indexOf('async function saveActivityPhotoDraft('))),f.c);
 const review={id:124,_photoDraft:{initial:[],photos:[{pending:true,preview:'fictional-review-pixels'}]}};f.replies.push(busy());await assert.rejects(f.c.saveActivityPhotoDraft(review),e=>e.status===503);assert(review._photoDraft.photos[0].pending);await f.c.saveActivityPhotoDraft(review);assert.equal(review.photos.length,1);assert(!review._photoDraft);
 console.log('photo busy retry: profile, multi-file activity, partial success, review draft and account switch PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
