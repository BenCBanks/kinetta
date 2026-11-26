// The saved turn identifies the server-validated preview; the browser never sends a write target.
function kitGoalReview(selection, options={}) {
  const candidate=selection.candidate,goal=candidate.goal,owner=readOwner();
  const label=(goal.sport?SPORT_NAMES[goal.sport]:'All sports')+' · '+({day:'Daily',week:'Weekly',month:'Monthly',year:'Yearly'}[goal.period]||goal.period)+' target';
  const clientId=options.scopeKey?.startsWith('kit:')?options.scopeKey.slice(4):null;
  sheet('Review goal change',`<p>${esc(label)}</p>
    <div class="kv"><span>Current target</span><b>${esc(candidate.before)}</b></div>
    <div class="kv"><span>New target</span><b>${esc(candidate.after)}</b></div>
    <p class="err" role="alert"></p>
    <button type="button" class="primary wide" id="kit-goal-confirm">Confirm goal change</button>`,(body,close)=>{
    const button=$('#kit-goal-confirm',body),error=$('.err',body);let busy=false;
    button.onclick=async()=>{
      if(busy)return;if(owner!==readOwner()){close();return;}
      busy=true;button.disabled=true;button.textContent='Checking and saving…';error.textContent='';
      try{
        if(!clientId)throw Error('Ask Kit for a fresh goal proposal.');
        const proposal=await api('/api/coach/conversation/goal-proposals',json('POST',{client_id:clientId,candidate_id:selection.candidate_id}));
        if(owner!==readOwner())return;
        const saved=await api('/api/coach/conversation/goal-proposals/'+proposal.id+'/confirm',json('POST',{confirmed:true}));
        if(owner!==readOwner())return;
        invalidate('/api/goals');close();
        sheet('Goal saved',`<p>${esc(label)}</p>
          <div class="kv"><span>Previous target</span><b>${esc(saved.receipt.before)}</b></div>
          <div class="kv"><span>Saved target</span><b>${esc(saved.receipt.after)}</b></div>
          <p class="small muted">${esc(new Date(saved.receipt.saved_at).toLocaleString())}</p>
          <button type="button" class="primary wide" id="kit-goal-done">Done</button>`,(box,done)=>$('#kit-goal-done',box).onclick=done);
      }catch(e){
        if(owner!==readOwner())return;
        error.textContent=e.message;button.disabled=e.status===409||e.status===404;
        button.textContent=button.disabled?'Ask Kit for a fresh proposal':'Try confirmation again';
      }finally{busy=false;}
    };
  });
}
