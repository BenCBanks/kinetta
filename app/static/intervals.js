// Private preset authoring is available in the browser; guidance belongs to the native recorder.
'use strict';
globalThis.Intervals=(()=>{
 const clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>crypto.randomUUID();
 const scope=()=>App.me?JSON.stringify([Native.base||location.origin,App.me.id]):null;
 const key=s=>'intervals:'+scope()+':'+s;
 const memory=new Map();
 const get=(name,fallback=null)=>scope()?(memory.has(key(name))?memory.get(key(name)):store.get(key(name)))??fallback:fallback;
 const put=(name,value)=>{if(!scope())throw Error('Sign in first.');const k=key(name);memory.set(k,clone(value));try{localStorage.setItem(k,JSON.stringify(value));return true;}catch{if(name==='selected'){memory.delete(k);toast('Could not load this preset on this device. Your previous selection and editor draft are kept.');}else toast('This device cannot keep an offline copy. Keep your editor open and save to the server.');return false;}};
 const clear=()=>{if(!scope())return;const prefix='intervals:'+scope()+':';try{for(const k of Object.keys(localStorage))if(k.startsWith(prefix))localStorage.removeItem(k);}catch{}for(const k of memory.keys())if(k.startsWith(prefix))memory.delete(k);};
 const selected=()=>{const raw=get('selected');if(!raw)return null;try{if(!/^[a-f0-9]{64}$/.test(raw.content_hash)||!Number.isInteger(raw.version)||raw.version<1||typeof raw.id!=='string')return null;return{...raw,...expand(raw.definition)};}catch{return null;}};
 function expand(raw){
  const plan=clone(raw),steps=[],totals={seconds:0,metres:0,by_action:{run:{seconds:0,metres:0},walk:{seconds:0,metres:0}}},ids=new Set();let count=0;
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const id=x=>{check(typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x)&&!ids.has(x),'Every block and step needs a unique ID.');ids.add(x);};
  check(plan.schema===1&&typeof plan.name==='string'&&plan.name.trim()&&plan.name.trim().length<=120,'Give the preset a name (1–120 characters).');plan.name=plan.name.trim();
  check(Array.isArray(plan.blocks)&&plan.blocks.length>0&&plan.blocks.length<=50,'Add between 1 and 50 blocks.');
  for(const block of plan.blocks){id(block.id);check(/^\d+$/.test(String(block.repeat))&&Number(block.repeat)>=1&&Number(block.repeat)<=100,'Executions must be a whole number from 1 to 100.');block.repeat=Number(block.repeat);check(Array.isArray(block.steps)&&block.steps.length>0,'Add a step to every block.');
   for(const s of block.steps){id(s.id);count++;check(count<=50,'Use at most 50 authored steps.');check(['run','walk'].includes(s.action)&&['effort','recovery','warmup','cooldown'].includes(s.role),'Choose an action and role.');const t=s.target,factors=t.kind==='time'?{s:1,min:60}:t.kind==='distance'?{m:1,km:1000,yd:.9144,mi:1609.344}:{};check(typeof t.amount==='string'&&/^\d{1,12}(?:\.\d{1,6})?$/.test(t.amount)&&Object.hasOwn(factors,t.unit),'Enter a positive target with a supported unit (up to six decimal places).');const value=Number(t.amount)*factors[t.unit],lo=t.kind==='time'?5:10,hi=t.kind==='time'?21600:100000;check(Number.isFinite(value)&&value>=lo&&value<=hi,`Targets must be ${lo}–${hi} ${t.kind==='time'?'seconds':'metres'}.`);}
   if(block.omit_final_recovery!=null){const last=block.steps.at(-1);check(last.id===block.omit_final_recovery&&last.action==='walk'&&last.role==='recovery','The omitted final recovery must be the last step, marked Walk and Recovery.');}
   for(let n=1;n<=block.repeat;n++)for(const s of block.steps){if(n===block.repeat&&s.id===block.omit_final_recovery)continue;const t=s.target,factor=t.kind==='time'?{s:1,min:60}[t.unit]:{m:1,km:1000,yd:.9144,mi:1609.344}[t.unit],value=Number(t.amount)*factor,k=t.kind==='time'?'seconds':'metres';steps.push({key:`${block.id}:${s.id}:${n}`,action:s.action,role:s.role,title:s.title,kind:t.kind,target:value,execution:n,executions:block.repeat,block:block.id});totals[k]+=value;totals.by_action[s.action][k]+=value;check(steps.length<=1000,'Use at most 1,000 expanded steps.');}
  }
  check(steps.length>0&&totals.seconds<=86400&&totals.metres<=500000,'Keep at least one step, at most 24 hours of timed targets and 500 km of distance targets.');return{definition:plan,steps,totals,mixed:!!(totals.seconds&&totals.metres)};
 }
 const time=n=>{const m=Math.floor(n/60),s=Math.round((n%60)*100)/100;return m?`${m} min${s?' '+s+' sec':''}`:`${s} sec`;};
 const dist=m=>`${U.dist(m,2)} ${U.du()}`;
 const target=s=>s.kind==='time'?time(s.target):dist(s.target);
 const label=s=>`${s.role==='warmup'?'Warm-up walk':s.role==='cooldown'?'Cool-down walk':s.action==='run'?'Run':'Walk'} ${target(s)}`;
 function total(p){const t=p.totals,n=p.steps?.length??p.step_count??expand(p.definition).steps.length;return[`${n} step${n===1?'':'s'}`,[t.seconds?time(t.seconds):'',t.metres?dist(t.metres):''].filter(Boolean).join(' + ')].filter(Boolean).join(' · ');}
 function preview(p){const f=simpleOf(p.definition),t=a=>a.unit==='s'||a.unit==='min'?time(Number(a.amount)*(a.unit==='min'?60:1)):`${a.amount} ${UNIT[a.unit]}`;const items=f?[f.warm?`Warm-up walk ${t(f.warm)}`:'',`Run ${t(f.run)}, then walk ${t(f.walk)} · ${f.repeat} time${f.repeat==='1'?'':'s'}`,f.cool?`Cool-down walk ${t(f.cool)}`:''].filter(Boolean):p.steps.map(label);return`<p class="interval-totals">${esc(total(p))}</p><ol class="interval-preview">${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;}
 // The simple builder: Run, Walk, Repeat, plus an optional warm-up and cool-down walk. Older presets with other
 // shapes still load, preview, start and delete; they just can't be opened in this builder.
 const UNIT={min:'min',s:'sec',m:'m',km:'km',yd:'yd',mi:'mi'};
 const distUnit=()=>imp()?'mi':'km';
 function simpleOf(def){
  const b=def.blocks,amt=t=>({amount:t.amount,unit:t.unit});
  const one=(blk,role)=>blk&&blk.repeat===1&&blk.steps.length===1&&blk.steps[0].action==='walk'&&blk.steps[0].role===role&&blk.steps[0].target.kind==='time'?blk.steps[0]:null;
  const warm=one(b[0],'warmup'),i=warm?1:0,main=b[i];
  if(!main||main.omit_final_recovery!=null||main.steps.length!==2)return null;
  const [r,w]=main.steps;if(r.action!=='run'||r.role!=='effort'||w.action!=='walk'||w.role!=='recovery')return null;
  const cool=one(b[i+1],'cooldown');if(b.length!==i+1+(cool?1:0))return null;
  return{name:def.name,run:amt(r.target),walk:amt(w.target),repeat:String(main.repeat),warm:warm?amt(warm.target):null,cool:cool?amt(cool.target):null};
 }
 const autoName=f=>`Run ${f.run.amount} ${UNIT[f.run.unit]} / Walk ${f.walk.amount} ${UNIT[f.walk.unit]} ×${f.repeat}`;
 function build(f,ids){
  const step=(id,action,role,t)=>({id,action,role,title:'',target:{kind:['s','min'].includes(t.unit)?'time':'distance',amount:String(t.amount).trim(),unit:t.unit}});
  const blocks=[];if(f.warm)blocks.push({id:ids.wb,repeat:1,steps:[step(ids.warm,'walk','warmup',f.warm)]});
  blocks.push({id:ids.main,repeat:String(f.repeat).trim(),steps:[step(ids.run,'run','effort',f.run),step(ids.walk,'walk','recovery',f.walk)]});
  if(f.cool)blocks.push({id:ids.cb,repeat:1,steps:[step(ids.cool,'walk','cooldown',f.cool)]});
  return{schema:1,name:(f.name.trim()||autoName(f)).slice(0,120),description:'',blocks};
 }
 // Pre-start entry below Start, styled like "Add a planned route": only for Run/Walk, or while intervals are loaded so they can be removed.
 let lastChoice=null;
 function entryHTML(){const p=selected(),stale=!p&&get('selected');return`<button type="button" class="track-prefs" id="interval-open">${svg('clock')}<span>${p?'Intervals: '+esc(p.definition.name):stale?'Intervals: reload needed':'Add run/walk intervals'}</span>${svg('chev')}</button>${p?`<p class="small muted track-interval-summary">${esc(total(p))}</p>`:''}`;}
 function mount(el,c=lastChoice){if(!el)return;lastChoice=c;if(c&&!(c.gps&&['run','walk'].includes(c.sport))&&!get('selected')){el.innerHTML='';return;}el.innerHTML=entryHTML();$('#interval-open',el).onclick=()=>library(()=>mount(el));}
 function library(changed=()=>{}){
  const who=scope(),revision=readOwner();if(!who)return;let rows=get('library',[]),closed=false;if(!Array.isArray(rows))rows=[];rows=rows.filter(p=>{try{return!!expand(p.definition);}catch{return false;}});
  sheet('Intervals','<div id="interval-library"></div>',(b,close)=>{
   const valid=()=>!closed&&scope()===who&&readOwner()===revision&&b.isConnected;
   const dismiss=()=>{closed=true;close();};
   const draw=(note='')=>{if(!valid())return;const p=selected(),loaded=get('selected');
    $('#interval-library',b).innerHTML=`${loaded?`<div class="interval-selected"><small class="muted">In Track</small><b>${p?esc(p.definition.name):'Your intervals need reloading'}</b>${p?`<p class="small muted">${esc(total(p))}</p>`:''}<button type="button" class="linkbtn" data-remove>Remove from Track</button></div>`:''}${rows.length?`<div class="card list interval-library-list">${rows.map((r,i)=>`<button type="button" class="row-link" data-open="${i}"><span class="grow">${esc(r.definition.name)}<small class="muted">${esc(total(r))}</small></span><span class="chev">${svg('chev')}</span></button>`).join('')}</div>`:''}${note?`<p class="small muted" role="status">${esc(note)}</p>`:''}<button type="button" class="primary wide" data-new>New intervals</button>${TrackNative.supported?'<button type="button" class="ghost wide" data-test>Test voice</button>':''}<p class="small muted">Kinetta tells you out loud when to run and when to walk. This is an early version: check you can hear it with your phone locked before you rely on it.</p>`;
    $('[data-new]',b).onclick=()=>{dismiss();editor({id:uid(),version:null,form:{name:'',run:{amount:'3',unit:'min'},walk:{amount:'1',unit:'min'},repeat:'3',warm:null,cool:null}},changed);};
    const remove=$('[data-remove]',b);if(remove)remove.onclick=()=>{if(!put('selected',null))return;changed();draw();};
    $$('[data-open]',b).forEach(button=>button.onclick=()=>{const r=clone(rows[+button.dataset.open]);dismiss();showPreview(r,changed);});
    const test=$('[data-test]',b);if(test)test.onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const result=await TrackNative.call('intervalTest',{voice:true,vibration:false});if(valid())toast(result.intervalTest||'Listen for the test prompt.');}catch(e){if(valid())toast(e.message);}finally{if(button.isConnected)button.disabled=false;}};
   };draw();
   api('/api/interval-presets').then(result=>{if(!valid())return;rows=result;put('library',rows);draw();}).catch(()=>{if(valid())draw(rows.length?'Offline: showing saved copies.':'');});
  });
 }
 function showPreview(p,changed){
  p={...p,...expand(p.definition)};const who=scope(),revision=readOwner(),form=simpleOf(p.definition);
  sheet(p.definition.name,`${preview(p)}<button type="button" class="primary wide" data-use>Use in Track</button>${form?'<button type="button" class="ghost wide" data-edit>Edit</button>':''}<button type="button" class="linkbtn danger wide" data-delete>Delete</button>`,(b,close)=>{
   $('[data-use]',b).onclick=()=>{if(scope()!==who)return;if(!put('selected',clone(p)))return;changed();close();toast('Intervals ready. Press Start when you are.');};
   const edit=$('[data-edit]',b);if(edit)edit.onclick=()=>{close();editor({id:p.id,version:p.version,form},changed);};
   $('[data-delete]',b).onclick=()=>{close();sheet('Delete these intervals?',`<p>${esc(p.definition.name)} will be removed from your list. Workouts you already recorded keep their results.</p><button class="primary danger-btn wide" data-confirm>Delete</button><button class="ghost wide" data-cancel>Keep</button>`,(box,done)=>{$('[data-cancel]',box).onclick=()=>{done();library(changed);};$('[data-confirm]',box).onclick=async e=>{e.currentTarget.disabled=true;try{await api('/api/interval-presets/'+p.id,json('DELETE',{expected_version:p.version}));if(scope()!==who||readOwner()!==revision)return;put('library',get('library',[]).filter(r=>r.id!==p.id));done();library(changed);}catch(e){if(scope()===who&&box.isConnected){toast(e.message);$('[data-confirm]',box).disabled=false;}}};});};
  });
 }
 function editor(initial,changed){
  const who=scope(),revision=readOwner(),f=clone(initial.form),ids={wb:uid(),warm:uid(),main:uid(),run:uid(),walk:uid(),cb:uid(),cool:uid()};
  let busy=false,mutation=uid(),attempted=null;
  sheet(initial.version?'Edit intervals':'New intervals','<div id="interval-editor"></div>',(b,close)=>{
   const valid=()=>scope()===who&&readOwner()===revision&&b.isConnected;
   const units=cur=>{const list=['min','s',distUnit()];if(!list.includes(cur))list.push(cur);return list.map(v=>`<option value="${v}"${v===cur?' selected':''}>${UNIT[v]}</option>`).join('');};
   const line=(k,name,lead=`<span>${name}</span>`)=>`<div class="interval-line">${lead}<input data-amount="${k}" inputmode="decimal" value="${esc(f[k].amount)}" aria-label="${name} amount"><select data-unit="${k}" aria-label="${name} unit">${units(f[k].unit)}</select></div>`;
   const extra=(k,name)=>{const lead=`<label class="interval-extra"><input type="checkbox" data-extra="${k}"${f[k]?' checked':''}> ${name}</label>`;return f[k]?line(k,name,lead):`<div class="interval-line">${lead}</div>`;};
   const refresh=()=>{if(!valid())return;const name=$('[data-name]',b);if(name)name.placeholder=autoName(f);try{$('#interval-sum',b).textContent=total(expand(build(f,ids)));$('#interval-error',b).textContent='';}catch(e){$('#interval-sum',b).textContent='';$('#interval-error',b).textContent=e.message;}};
   const draw=()=>{if(!valid())return;
    $('#interval-editor',b).innerHTML=`${line('run','Run')}${line('walk','Walk')}<div class="interval-line"><span>Repeat</span><input data-repeat inputmode="numeric" value="${esc(f.repeat)}" aria-label="Times to repeat"><span class="muted">times</span></div>${extra('warm','Warm-up')}${extra('cool','Cool-down')}<label class="interval-name">Name <span class="muted small">optional</span><input data-name maxlength="120" value="${esc(f.name)}"></label><p class="interval-totals" id="interval-sum" role="status"></p><p class="small danger" id="interval-error" role="alert"></p><button type="button" class="primary wide" data-save>Save and use in Track</button><button type="button" class="ghost wide" data-cancel>Cancel</button>`;
    $$('[data-amount]',b).forEach(input=>input.oninput=()=>{f[input.dataset.amount].amount=input.value;refresh();});
    $$('[data-unit]',b).forEach(input=>input.onchange=()=>{f[input.dataset.unit].unit=input.value;refresh();});
    $('[data-repeat]',b).oninput=e=>{f.repeat=e.target.value;refresh();};
    $$('[data-extra]',b).forEach(input=>input.onchange=()=>{f[input.dataset.extra]=input.checked?{amount:'5',unit:'min'}:null;draw();});
    $('[data-name]',b).oninput=e=>{f.name=e.target.value;};
    $('[data-cancel]',b).onclick=()=>{close();library(changed);};
    $('[data-save]',b).onclick=async e=>{if(busy)return;let plan;try{plan=expand(build(f,ids));}catch(x){$('#interval-error',b).textContent=x.message;return;}
     // A retry of the same content reuses its save ID, so a lost reply can't create a second copy.
     const body=JSON.stringify(plan.definition);if(attempted!==body){mutation=uid();attempted=body;}
     busy=true;const button=e.currentTarget;button.disabled=true;button.textContent='Saving…';
     try{const response=await api('/api/interval-presets/'+initial.id,json('PUT',{mutation_id:mutation,expected_version:initial.version,definition:plan.definition}));if(!valid())return;
      const rows=get('library',[]).filter(r=>r.id!==response.id),compact={...response,step_count:response.steps.length};delete compact.steps;rows.unshift(compact);put('library',rows);
      if(!put('selected',clone(response)))return;changed();close();toast('Intervals ready. Press Start when you are.');}
     catch(x){if(valid())$('#interval-error',b).textContent=x.message+' Nothing was lost; try again.';}
     finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent='Save and use in Track';}}};
    refresh();
   };draw();
  });
 }
 async function verifySaveSupport(){const who=scope(),revision=readOwner();let cap;try{cap=await api('/api/interval-presets/capabilities');}catch{throw Error('This server could not confirm support for private interval results. Update or reconnect before saving.');}if(who!==scope()||revision!==readOwner())throw Error('The recording account changed.');if(cap?.schema!==1||cap.private_results!==1)throw Error('Update this server before saving a workout with private interval results.');}
 async function startOptions({sport,gps}){const p=selected();if(!p){if(get('selected'))throw Error('Your intervals need reloading. Open Intervals to reload or remove them.');return null;}const who=scope(),revision=readOwner();if(!TrackNative.supported||!gps||!['run','walk'].includes(sport))throw Error('Intervals need an outdoor Run or Walk in the iPhone app. Change the activity or remove the intervals.');const cap=await TrackNative.call('intervalCapabilities');if(who!==scope()||revision!==readOwner())throw Error('The recording account changed.');if(!cap.intervalCapabilities?.outdoor)throw Error('Update the iPhone app to use intervals, or remove them to record normally.');expand(p.definition);
  // Spoken prompts only (Ben, 27 October 2026): no vibration option, and intervals keep their own auto-pause off.
  return{intervals:{id:p.id,version:p.version,content_hash:p.content_hash,definition:clone(p.definition)},intervalVoice:true,intervalVibration:false,autoPause:false};}
 function liveHTML(session){const state=session?.intervals;if(!state)return'';const phase=state.phases[state.index],active=state.status==='running',remaining=phase?Math.max(0,phase.target-(phase.kind==='time'?state.time-state.phase_time:state.phase_distance==null?0:state.distance-state.phase_distance-(state.phase_ignored_distance||0))):null,next=state.phases[state.index+1];return`<div class="interval-current"><div><small>${esc(state.pin.definition.name)}</small><h3>${active?(phase.action==='run'?'Run':'Walk'):state.status==='complete'?'Intervals done':'Intervals ended'}</h3></div><b>${active?esc(phase.kind==='time'?time(Math.ceil(remaining)):dist(remaining)):''}</b></div><p class="small muted">${active?`Step ${state.index+1} of ${state.phases.length}${next?' · Next: '+esc(label(next)):' · Last step'}${phase.kind==='distance'&&state.phase_distance==null?' · Waiting for GPS':''}`:'Recording continues until you press Finish.'}</p>${active&&session.state!=='review'?'<div class="interval-row-actions"><button type="button" data-interval-control="intervalSkip">Skip step</button><button type="button" data-interval-control="intervalEnd">End intervals</button></div>':''}`;}
 function updateLive(el,session,control){if(!el)return;const state=session?.intervals;if(!state)return;const signature=[state.pin.id,state.index,state.status,session.state].join(':');if(el.dataset.signature===signature){const next=document.createElement('div');next.innerHTML=liveHTML(session);const number=$('.interval-current b',el),status=$('p',el);if(number)number.textContent=$('.interval-current b',next).textContent;if(status)status.textContent=$('p',next).textContent;return;}el.dataset.signature=signature;el.innerHTML=liveHTML(session);$$('[data-interval-control]',el).forEach(button=>button.onclick=()=>{const end=button.dataset.intervalControl==='intervalEnd';sheet(end?'End intervals?':'Skip this step?',`<p>${end?'Your workout keeps recording without interval prompts.':'The next step starts now.'}</p><button class="primary wide" data-confirm>${end?'End intervals':'Skip step'}</button>`,(b,close)=>{$('[data-confirm]',b).onclick=async e=>{e.currentTarget.disabled=true;await control(button.dataset.intervalControl,{phase_key:state.phases[state.index]?.key});close();};});});}
 async function history(el,aid){
  if(!el)return;const who=scope(),revision=readOwner();el.innerHTML='<h2>Intervals</h2><p class="small muted">Loading…</p>';
  try{const sessions=await api('/api/activities/'+aid+'/intervals');if(!el.isConnected||scope()!==who||readOwner()!==revision)return;
   const labels={complete:'Done',skipped:'Skipped',ended:'Ended early',finished:'Workout finished'};
   el.innerHTML=sessions.map(state=>{const plan=expand(state.pin.definition),s=state.summary;return `<h2>Intervals</h2><p><b>${esc(state.pin.definition.name)}</b> · ${s.completed_steps} of ${s.planned_steps} steps done${s.skipped_steps?' · '+s.skipped_steps+' skipped':''}</p><div class="interval-history-table" tabindex="0" role="region" aria-label="Interval steps"><table><thead><tr><th scope="col">Step</th><th scope="col">Time · distance</th><th scope="col">Result</th></tr></thead><tbody>${state.results.map((r,i)=>{const phase=plan.steps[i],d=r.start_distance==null||r.end_distance==null?null:r.end_distance-r.start_distance-(r.unallocated_distance||0);return `<tr><td>${esc(label(phase))}</td><td>${esc(time(r.end_time-r.start_time))}${d==null?'':' · '+esc(dist(d))}</td><td>${esc(labels[r.outcome]||r.outcome)}</td></tr>`;}).join('')}</tbody></table></div><p class="small muted">Only you can see this, even when the activity is shared.</p>`;}).join('')||'<h2>Intervals</h2><p>No interval results for this activity.</p>';
  }catch(e){if(el.isConnected&&scope()===who&&readOwner()===revision){el.innerHTML='<h2>Intervals</h2><p class="small muted">Could not load your interval steps.</p><button type="button" class="ghost wide">Try again</button>';el.querySelector('button').onclick=()=>history(el,aid);}}
 }
 return{expand,builder:{simpleOf,build,autoName},preview,total,mount,library,selected,resultPayload:state=>({pin:clone(state.pin),status:state.status,results:clone(state.results),effects:clone(state.effects),effects_omitted:state.effects_omitted||0}),verifySaveSupport,hasSelection:()=>!!get('selected'),startOptions,updateLive,clear,history};
})();
