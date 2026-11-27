/* Resumable web Strava archives. Recording files still use the existing importer. */
'use strict';
window.ActivityZipUpload={mount(el,valid,account,choose){
  const box=document.querySelector('#u-zip',el),prefix='/api/strava-import';
  let upload=null,file=null,fileHash='',audience,chunk=8*1024*1024,max=2*1024**3,busy=false,fileWork=false,message='',phase='',fraction=0,timer,control,worker,xhr,disposed=false;
  const live=()=>!disposed&&valid(),total=p=>['added','already_here','unreadable'].reduce((n,k)=>n+(p?.[k]||0),0);
  const terminal=()=>upload&&['done','failed','cancelled'].includes(upload.state);
  const errors={expired:'This upload expired. Choose the archive to start again.',not_strava_export:'Choose the ZIP from your Strava account export.',no_workouts:'No activities were found in this archive.',storage_full:'Import paused: storage is full. Check again later.',processing_failed:'This archive could not be processed. Choose a new export.'};
  const q=async(path,opts={})=>{
    if(!live()||control.signal.aborted)throw new Error('Stopped');
    const request=new AbortController(),parent=control.signal,abort=()=>request.abort(),timeout=setTimeout(abort,30000);
    parent.addEventListener('abort',abort,{once:true});let result;
    try{result=await api(prefix+path,{...opts,signal:request.signal});}finally{clearTimeout(timeout);parent.removeEventListener('abort',abort);}
    if(!live()||parent.aborted)throw new Error('Stopped');return result;
  };
  const paintProgress=()=>{if(live()){const progress=box.querySelector('progress');if(progress)progress.value=Math.min(1,fraction);}};
  function draw(){
    if(!live())return;
    document.querySelector('#u-file',el).disabled=busy;
    box.hidden=!upload&&!phase&&!message;
    const state=upload?.state,p=upload?.preview,r=upload?.result,displayedId=upload?.id,displayedAudience=audience;
    const title=phase||({uploading:'Upload paused',preview_queued:'Checking activities…',review:'Ready to import',importing:'Importing activities…',done:'Import complete',failed:'Import stopped',cancelled:'Upload cancelled'}[state]||'Strava history');
    let detail=state==='uploading'?`${(upload.received/1048576).toFixed(1)} of ${(upload.size/1048576).toFixed(1)} MB saved`:state==='importing'?`${total(r)} of ${total(p)} checked`:'';
    if(state==='uploading'&&!busy)detail+=' · Choose the same ZIP to resume.';
    const counts=(state==='review'||state==='done')?`<dl class="upload-counts">${[['added',state==='review'?'To add':'Added'],['already_here','Already here'],['unreadable','Couldn’t read']].map(([k,label])=>`<div><dt>${label}</dt><dd>${esc((state==='review'?p:r)?.[k]||0)}</dd></div>`).join('')}</dl>`:'';
    const progress=busy&&phase?fraction:state==='importing'?total(r)/Math.max(1,total(p)):state==='uploading'?upload.received/upload.size:null;
    box.innerHTML=`<div class="upload-status" role="status"><b>${esc(title)}</b>${detail?`<p class="small muted">${esc(detail)}</p>`:''}</div>
      ${progress!==null?`<progress max="1" value="${Math.min(1,progress)}" aria-label="${esc(title)}"></progress>`:''}${counts}
      ${state==='review'?`<div class="upload-privacy"><span>Activity privacy</span><b>${esc({me:'Only me',friends:'Friends',everyone:'Everyone'}[audience]||'')}</b></div>`:''}
      ${message||upload?.error_code?`<p class="upload-error" role="alert">${esc(message||errors[upload.error_code]||'This archive could not be read. Choose a new Strava export.')}</p>`:''}
      <div class="upload-actions">${busy?(fileWork?'<button type="button" data-upload="pause" class="ghost">Pause</button>':''):state==='review'?'<button type="button" data-upload="confirm" class="primary">Import activities</button>':state==='uploading'?`<button type="button" data-upload="resume" class="primary">${file?'Resume upload':'Choose ZIP to resume'}</button>`:terminal()?'<button type="button" data-upload="new" class="ghost">Choose another file</button>':message&&!upload?'<button type="button" data-upload="retry" class="ghost">Retry</button>':''}
      ${upload&&!terminal()?'<button type="button" data-upload="cancel" class="ghost">Cancel import</button>':''}${message&&upload&&!terminal()&&state!=='uploading'?'<button type="button" data-upload="retry" class="ghost">Retry</button>':''}</div>`;
    box.querySelectorAll('[data-upload]').forEach(button=>button.onclick=()=>actions[button.dataset.upload](displayedId,displayedAudience));
  }
  function stop(){clearTimeout(timer);control?.abort();worker?.terminate();worker=null;xhr?.abort();xhr=null;busy=false;fileWork=false;phase='';}
  async function act(fn){
    if(busy||!live())return;clearTimeout(timer);control=new AbortController();const own=control;busy=true;message='';draw();
    try{await fn();}catch(e){if(live()&&!own.signal.aborted)message=e.status===507?'Storage is full. Try again later.':e.message||'Connection interrupted. Retry to continue.';}
    finally{if(live()&&control===own&&!own.signal.aborted){busy=false;fileWork=false;phase='';draw();schedule();}}
  }
  async function refresh(){
    const stage=await q('/stage');upload=stage.upload;audience=stage.current_audience;chunk=Math.min(stage.chunk_size||chunk,8*1024*1024);max=stage.max_size||max;
  }
  function schedule(){
    clearTimeout(timer);
    if(live()&&!message&&['preview_queued','importing'].includes(upload?.state))timer=setTimeout(()=>act(async()=>{upload=await q('/uploads/'+upload.id);if(upload.state==='review')await refresh();if(upload.state==='done')invalidate('/api/');}),2000);
  }
  function digest(source){
    return new Promise((resolve,reject)=>{
      worker=new Worker('/static/upload-hash-worker.js?v=__ASSET_HASH__');fileWork=true;draw();
      const hasher=worker,cleanup=()=>{hasher.terminate();if(worker===hasher){worker=null;fileWork=false;draw();}};
      control.signal.addEventListener('abort',()=>{cleanup();reject(new Error('Stopped'));},{once:true});
      worker.onerror=()=>{cleanup();reject(new Error('Could not read this ZIP. Choose it again.'));};
      worker.onmessage=({data})=>{if(!live())return;if(data.sha256){cleanup();resolve(data.sha256);}else if(data.error){cleanup();reject(new Error(data.error));}else{fraction=data.received/source.size;paintProgress();}};
      worker.postMessage(source);
    });
  }
  function piece(bytes,offset,hash){
    return new Promise((resolve,reject)=>{
      const request=xhr=new XMLHttpRequest();request.open('PUT',Native.base+prefix+'/uploads/'+upload.id+'/pieces/'+offset);request.timeout=75000;
      for(const [key,value] of Object.entries({...Native.headers(),'X-Kinetta-Account':String(account),'Content-Type':'application/octet-stream','X-Content-Sha256':hash}))request.setRequestHeader(key,value);
      control.signal.addEventListener('abort',()=>request.abort(),{once:true});
      const signal=control.signal;
      request.upload.onprogress=e=>{if(!live()||signal.aborted)return;fraction=(offset+e.loaded)/file.size;paintProgress();};
      const done=()=>{if(xhr===request){fileWork=false;draw();}};
      request.onload=()=>{done();let body;try{body=JSON.parse(request.responseText);}catch{}if(request.status===200&&body)resolve(body);else reject(Object.assign(new Error(typeof body?.detail==='string'?body.detail:'Upload interrupted. Retry to continue.'),{status:request.status}));};
      request.onerror=request.ontimeout=request.onabort=()=>{done();reject(new Error('Connection interrupted. Retry to continue.'));};
      fileWork=true;draw();request.send(bytes);
    });
  }
  async function transfer(){
    // Always recover the committed offset, including when the preceding response was lost.
    const signal=control.signal;
    upload=await q('/uploads/'+upload.id);
    if(upload.state!=='uploading')return;
    if(file.size!==upload.size||fileHash!==upload.sha256)throw new Error('Choose the original ZIP to resume this upload.');
    if(new Date(upload.expires)<=new Date())throw new Error(errors.expired);
    while(upload.received<file.size){
      const offset=upload.received,bytes=await file.slice(offset,offset+chunk).arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      if(!live()||signal.aborted)return;
      phase='Uploading Strava history…';fraction=offset/file.size;draw();
      const next=await piece(bytes,offset,hash);
      if(!live()||signal.aborted)return;
      if(next.received<=offset||next.received>file.size)throw new Error('Upload position changed. Retry to continue.');
      upload=next;
    }
    phase='Checking archive…';draw();upload=await q('/uploads/'+upload.id+'/finalize',{method:'POST'});
  }
  const select=source=>act(async()=>{
    if(!source.size||source.size>max)throw new Error('Choose a ZIP smaller than 2 GB.');
    await refresh();
    if(upload&&!terminal()&&upload.state!=='uploading')throw new Error('Finish or cancel the current import first.');
    phase='Checking file…';fraction=0;draw();const hash=await digest(source);
    if(upload?.state==='uploading'&&(source.size!==upload.size||hash!==upload.sha256))throw new Error('This is a different ZIP. Choose the original, or cancel this import first.');
    file=source;fileHash=hash;
    if(!upload||terminal())upload=await q('/uploads',json('POST',{id:crypto.randomUUID(),size:source.size,sha256:hash}));
    await transfer();
  });
  const actions={
    pause:()=>{if(fileWork){stop();draw();}},
    resume:()=>file?act(transfer):choose(),
    retry:()=>act(async()=>{await refresh();if(!upload&&file)upload=await q('/uploads',json('POST',{id:crypto.randomUUID(),size:file.size,sha256:fileHash}));if(upload?.state==='uploading'&&file)await transfer();}),
    new:()=>{file=null;fileHash='';upload=null;message='';draw();choose();},
    cancel:()=>{stop();act(async()=>{await q('/uploads/'+upload.id,{method:'DELETE'});upload=null;file=null;});},
    confirm:(displayedId,displayedAudience)=>act(async()=>{
      await refresh();
      if(upload?.id!==displayedId)throw new Error(upload?.state==='review'?'The archive changed. Review this preview, then tap Import again.':'The archive changed. Check the updated import before continuing.');
      if(upload?.state!=='review')return;
      if(audience!==displayedAudience)throw new Error('Your activity privacy changed. Check it above, then tap Import again.');
      try{upload=await q('/uploads/'+displayedId+'/confirm',json('POST',{confirm:true,audience}));}
      catch(e){if(e.status===409)await refresh();throw e;}
    })
  };
  act(refresh);
  return {select,blocked:()=>busy||(upload&&!terminal()),dispose:()=>{disposed=true;stop();}};
}};
