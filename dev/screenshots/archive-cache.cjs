'use strict';
// Capture transport only: real immutable archive bytes, never replacement tiles.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const limits=Object.freeze({entries:64,bytes:4*1024*1024,rangeBytes:256*1024,requestMs:30000,totalMs:120000});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const key=(url,etag,range)=>digest(`${url}\n${etag}\n${range}`);
function bounds(range){
  const match=/^bytes=(\d+)-(\d+)$/.exec(range||'');
  if(!match)throw Error('Capture cache requires one bounded byte range');
  const start=Number(match[1]),end=Number(match[2]),length=end-start+1;
  if(!Number.isSafeInteger(end)||!Number.isSafeInteger(start)||start<0||length<1||length>limits.rangeBytes)throw Error('Capture range exceeds its bound');
  return {start,end,length};
}
function planFor(approvedURL,plan){
  const url=new URL(approvedURL);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname==='tile.openstreetmap.org'||approvedURL!==plan.url)throw Error('Approved archive differs from the fictional range plan');
  if(!Array.isArray(plan.ranges)||!plan.ranges.length||plan.ranges.length>limits.entries||new Set(plan.ranges).size!==plan.ranges.length)throw Error('Invalid capture range count');
  if(plan.ranges.reduce((sum,range)=>sum+bounds(range).length,0)>limits.bytes)throw Error('Capture range plan exceeds byte cap');
}
class Retryable extends Error {}
async function prepareArchive(directory,{approvedURL,origin='https://login.kinetta.app',plan=require('./archive-ranges.json'),fetcher=fetch,log=console.log,requestMs=limits.requestMs,totalMs=limits.totalMs}={}){
  planFor(approvedURL,plan);
  fs.mkdirSync(directory,{mode:0o700}); // A fresh per-job directory, never a persistent/cross-run cache.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(totalMs,limits.totalMs));
  let etag,total,next=0;
  const entries=[];
  async function read(range){
    const wanted=bounds(range);
    for(let attempt=1;attempt<=2;attempt++){
      const began=Date.now();
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.min(requestMs,limits.requestMs))]);
      let response;
      try{
        response=await fetcher(approvedURL,{redirect:'error',signal,headers:{Range:range,Origin:origin,Referer:origin+'/',
          'Accept-Encoding':'identity',...(etag?{'If-Range':etag}:{})}});
        const headers=response.headers,tag=headers.get('etag'),contentRange=headers.get('content-range');
        log(JSON.stringify({mapPrepare:range,attempt,status:response.status,contentRange,elapsedMs:Date.now()-began}));
        if([408,429,500,502,503,504].includes(response.status))throw new Retryable('Transient archive response');
        const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange||'');
        if(response.status!==206||!match||+match[1]!==wanted.start||+match[2]!==wanted.end||!Number.isSafeInteger(+match[3])||+match[3]<=wanted.end)throw Error('Archive Content-Range mismatch');
        if(!/^"[^"\r\n]+"$/.test(tag||'')||(etag&&tag!==etag)||(total&&+match[3]!==total))throw Error('Archive validator changed or is missing');
        if(headers.has('content-length')&&+headers.get('content-length')!==wanted.length||headers.has('content-encoding')&&headers.get('content-encoding')!=='identity')throw Error('Archive response length/encoding mismatch');
        etag=tag;total=+match[3];
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>wanted.length)throw Error('Archive response exceeds range');chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if(size!==wanted.length)throw Error('Archive response is truncated');
        const file=key(approvedURL,etag,range)+'.bin',stored={};
        for(const name of ['etag','content-range','content-length','content-type','cache-control','last-modified','accept-ranges'])if(headers.has(name))stored[name]=headers.get(name);
        fs.writeFileSync(path.join(directory,file),body,{mode:0o600,flag:'wx'});
        entries.push({range,file,sha256:digest(body),headers:stored});
        log(JSON.stringify({mapPrepared:range,bytes:size,attempt,elapsedMs:Date.now()-began}));return;
      }catch(error){
        await response?.body?.cancel().catch(()=>{});
        const retryable=error instanceof Retryable||['TimeoutError','AbortError','TypeError'].includes(error.name);
        log(JSON.stringify({mapPrepare:range,attempt,outcome:retryable?'transport-error':'validation-error',elapsedMs:Date.now()-began}));
        if(controller.signal.aborted||!retryable||attempt===2)throw error;
      }
    }
  }
  async function worker(){while(next<plan.ranges.length&&!controller.signal.aborted)await read(plan.ranges[next++]);}
  try{
    await Promise.all([worker(),worker()]);
    if(controller.signal.aborted)throw Error('Capture archive preparation deadline exceeded');
    fs.writeFileSync(path.join(directory,'index.json'),JSON.stringify({url:approvedURL,etag,total,entries}),{mode:0o600,flag:'wx'});
    log(JSON.stringify({mapCachePrepared:true,ranges:entries.length,bytes:plan.ranges.reduce((sum,r)=>sum+bounds(r).length,0)}));
  }catch(error){controller.abort();throw error;}finally{clearTimeout(timer);}
}
function openArchiveCache(directory,approvedURL,log=console.log){
  const metadata=fs.readFileSync(path.join(directory,'index.json'));
  if(metadata.length>64*1024)throw Error('Capture cache index exceeds its bound');
  const index=JSON.parse(metadata);
  planFor(approvedURL,{url:index.url,ranges:index.entries.map(entry=>entry.range)});
  if(!/^"[^"\r\n]+"$/.test(index.etag||'')||!Number.isSafeInteger(index.total)||index.total<1)throw Error('Invalid capture cache validator');
  const entries=new Map();
  for(const entry of index.entries){
    const wanted=bounds(entry.range),expected=key(approvedURL,index.etag,entry.range)+'.bin';
    if(wanted.end>=index.total||entry.file!==expected||entry.headers.etag!==index.etag||entry.headers['content-range']!==`bytes ${wanted.start}-${wanted.end}/${index.total}`)throw Error('Invalid capture cache entry');
    const filename=path.join(directory,expected),stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.size!==wanted.length)throw Error('Capture cache bytes failed validation');
    const body=fs.readFileSync(filename);
    if(body.length!==wanted.length||digest(body)!==entry.sha256)throw Error('Capture cache bytes failed validation');
    entries.set(entry.range,{status:206,headers:entry.headers,body});
  }
  return {get(url,range){
    if(url!==approvedURL)return null;
    const entry=entries.get(range);
    log(JSON.stringify({mapCache:entry?'hit':'miss',mapRange:range,bytes:entry?.body.length||0}));return entry||null;
  }};
}
module.exports={prepareArchive,openArchiveCache,limits};
if(require.main===module){
  if(process.env.KINETTA_MAP_KIND==='vector')console.log('Vector URL template: existing capture relay retained; no archive cache');
  else prepareArchive(process.argv[2],{approvedURL:process.env.KINETTA_MAP_TILES}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
