'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareArchive,openArchiveCache,limits}=require('./archive-cache.cjs');
const url='https://archive.example.test/fixture.pmtiles',origin='https://capture.example.test';
const plan={url,ranges:['bytes=0-3','bytes=4-7','bytes=8-11']};
const response=(range,override={})=>{
  const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range);
  return new Response(Buffer.alloc(+end-+start+1,Number(start)),{status:206,headers:{etag:'"fictional-version"','content-range':`bytes ${start}-${end}/100`,...override}});
};
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kinetta-archive-cache-test-'));
 try{
  const logs=[],requests=[];let active=0,maximum=0;
  const fetcher=async(target,options)=>{
   requests.push(options.headers.Range);assert.equal(target,url);assert.equal(options.redirect,'error');assert.equal(options.headers.Origin,origin);
   maximum=Math.max(maximum,++active);await new Promise(r=>setTimeout(r,5));active--;return response(options.headers.Range);
  };
  const directory=path.join(root,'valid');
  await prepareArchive(directory,{approvedURL:url,origin,plan,fetcher,log:line=>logs.push(JSON.parse(line))});
  assert.equal(maximum,2);assert.equal(requests.length,3);
  assert.equal(fs.statSync(directory).mode&0o777,0o700);
  const cache=openArchiveCache(directory,url,line=>logs.push(JSON.parse(line)));
  assert.equal(cache.get(url,'bytes=4-7').body.toString('hex'),'04040404');
  assert.equal(cache.get(url+'?other','bytes=4-7'),null);
  assert.equal(cache.get(url,'bytes=90-93'),null);
  assert.equal(requests.length,3,'cache reads never make extra upstream calls');
  assert(logs.some(row=>row.mapCache==='hit'));assert(logs.some(row=>row.mapPrepared));
  await assert.rejects(prepareArchive(directory,{approvedURL:url,plan,fetcher}),/EEXIST/,'cache must be fresh per job');
  assert.throws(()=>openArchiveCache(directory,url+'/other'),/differs/);
  const index=JSON.parse(fs.readFileSync(path.join(directory,'index.json')));
  fs.writeFileSync(path.join(directory,index.entries[0].file),'bad');
  assert.throws(()=>openArchiveCache(directory,url),/bytes failed/);

  let attempts=0;
  await prepareArchive(path.join(root,'retry'),{approvedURL:url,plan:{url,ranges:['bytes=0-3']},log:()=>{},fetcher:async(_,options)=>{
   if(++attempts===1)throw new TypeError('fictional transport failure');return response(options.headers.Range);
  }});assert.equal(attempts,2);
  for(const status of [503,429]){
   attempts=0;await prepareArchive(path.join(root,'http-'+status),{approvedURL:url,plan:{url,ranges:['bytes=0-3']},log:()=>{},fetcher:async(_,options)=>++attempts===1?new Response(null,{status}):response(options.headers.Range)});
   assert.equal(attempts,2);
  }
  const bad=[
   ['full-archive',()=>new Response(Buffer.alloc(4),{status:200})],
   ['range',r=>response(r,{'content-range':'bytes 1-4/100'})],
   ['missing-etag',r=>response(r,{etag:''})],
   ['weak-etag',r=>response(r,{etag:'W/"version"'})],
   ['length',r=>response(r,{'content-length':'99'})],
   ['encoding',r=>response(r,{'content-encoding':'gzip'})],
   ['truncated',()=>new Response(Buffer.alloc(3),{status:206,headers:{etag:'"v"','content-range':'bytes 0-3/100'}})],
   ['oversized',()=>new Response(Buffer.alloc(5),{status:206,headers:{etag:'"v"','content-range':'bytes 0-3/100'}})]
  ];
  for(const [name,make] of bad){
   const dir=path.join(root,name);attempts=0;
   await assert.rejects(prepareArchive(dir,{approvedURL:url,plan:{url,ranges:['bytes=0-3']},log:()=>{},fetcher:async(_,options)=>{attempts++;return make(options.headers.Range);}}));
   assert.equal(attempts,1,`${name} is not retried`);assert(!fs.existsSync(path.join(dir,'index.json')),'invalid data never publishes a cache index');
  }
  attempts=0;
  await assert.rejects(prepareArchive(path.join(root,'changed'),{approvedURL:url,plan,log:()=>{},fetcher:async(_,options)=>response(options.headers.Range,{etag:`"${++attempts}"`})}),/validator/);
  attempts=0;
  await assert.rejects(prepareArchive(path.join(root,'exhausted'),{approvedURL:url,plan:{url,ranges:['bytes=0-3']},log:()=>{},fetcher:async()=>{attempts++;throw new TypeError('transport');}}));
  assert.equal(attempts,2,'only one retry');
  let cancelled=false;
  await assert.rejects(prepareArchive(path.join(root,'deadline'),{approvedURL:url,plan:{url,ranges:['bytes=0-3']},totalMs:15,log:()=>{},fetcher:async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{cancelled=true;reject(new DOMException('deadline','AbortError'));},{once:true}))}));
  assert(cancelled,'total deadline cancels in-flight read');
  for(const invalid of [
   {url:url+'/other',ranges:plan.ranges},{url,ranges:['bytes=0-']},{url,ranges:['bytes=0-3','bytes=0-3']},
   {url,ranges:[`bytes=0-${limits.rangeBytes}`]},
   {url,ranges:Array.from({length:limits.entries+1},(_,i)=>`bytes=${i}-${i}`)},
   {url,ranges:Array.from({length:17},(_,i)=>`bytes=${i*limits.rangeBytes}-${(i+1)*limits.rangeBytes-1}`)}
  ])await assert.rejects(prepareArchive(path.join(root,'invalid'),{approvedURL:url,plan:invalid,fetcher:()=>assert.fail('invalid plan must never fetch')}));
  console.log('Archive cache: exact source/ranges, validators/bytes, concurrency/caps, retry/deadline, no stale reuse and corruption refusal PASS');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
