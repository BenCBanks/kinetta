(() => {
  'use strict';
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});

  const question = document.querySelector('[data-week-question]');
  const answer = document.querySelector('[data-week-answer]');
  document.querySelectorAll('[data-week-example]').forEach(button => {
    button.addEventListener('click', () => {
      question.textContent = button.dataset.question;
      answer.textContent = button.dataset.answer;
    });
  });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const demos = [...document.querySelectorAll('[data-demo]')];
  const states = new Map(demos.map(demo => [demo,{visible:false,running:false}]));
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  const activeWait = async (demo,state,ms) => {
    let elapsed=0;
    while(elapsed<ms){if(reduced.matches)return false;if(state.visible&&!document.hidden)elapsed+=50;await wait(50);}
    return true;
  };
  function finalMeal(demo){
    const question=demo.querySelector('[data-chat-question]');question.textContent=question.dataset.fullText;
    demo.querySelector('[data-chat-typing]').setAttribute('aria-hidden','true');
    demo.querySelector('[data-chat-result]').setAttribute('aria-hidden','false');
    demo.querySelector('[data-chat-total]').textContent='515 kcal';
    const confirm=demo.querySelector('[data-chat-confirm]');confirm.textContent='✓ Lunch logged';confirm.setAttribute('aria-hidden','true');
    demo.querySelector('[data-chat-log]').setAttribute('aria-hidden','false');demo.dataset.demoState='complete';
  }
  async function mealLoop(demo,state){
    const question=demo.querySelector('[data-chat-question]'),typing=demo.querySelector('[data-chat-typing]'),result=demo.querySelector('[data-chat-result]'),total=demo.querySelector('[data-chat-total]'),confirm=demo.querySelector('[data-chat-confirm]'),logged=demo.querySelector('[data-chat-log]'),text=question.dataset.fullText;
    while(!reduced.matches){
      demo.dataset.demoState='typing';question.textContent='';typing.setAttribute('aria-hidden','false');result.setAttribute('aria-hidden','true');confirm.setAttribute('aria-hidden','true');logged.setAttribute('aria-hidden','true');confirm.textContent='Confirm lunch';total.textContent='0 kcal';
      if(!await activeWait(demo,state,650))break;
      for(let i=1;i<=text.length;i++){question.textContent=text.slice(0,i);if(!await activeWait(demo,state,48))return;}
      question.textContent=text;typing.setAttribute('aria-hidden','true');demo.dataset.demoState='matching';
      if(!await activeWait(demo,state,1200))break;
      result.setAttribute('aria-hidden','false');demo.dataset.demoState='matched';
      for(let n=0;n<=515;n+=35){total.textContent=`${Math.min(n,515)} kcal`;if(!await activeWait(demo,state,50))return;}
      total.textContent='515 kcal';confirm.setAttribute('aria-hidden','false');
      if(!await activeWait(demo,state,1600))break;
      demo.dataset.demoState='confirming';confirm.textContent='✓ Confirmed';
      if(!await activeWait(demo,state,260))break;
      confirm.setAttribute('aria-hidden','true');logged.setAttribute('aria-hidden','false');demo.dataset.demoState='complete';
      if(!await activeWait(demo,state,1800))break;
    }
    state.running=false;
  }
  const chartValues=[16,21,13,28,19,10.8],chartX=[12,62,112,162,212,262],chartY=[54,40,60,18,43,69];
  async function insightLoop(demo,state){
    const total=demo.querySelector('[data-week-total]'),readout=demo.querySelector('[data-week-readout]'),line=demo.querySelector('[data-week-line]'),marker=demo.querySelector('[data-week-marker]');
    while(!reduced.matches){
      demo.dataset.demoState='drawing';line.style.strokeDashoffset='1';marker.style.transform='translateX(-220px)';
      total.textContent='0.0';readout.textContent='16.0 mi';demo.style.setProperty('--readout-x',`${chartX[0]/280*100}%`);
      if(!await activeWait(demo,state,250))break;
      let elapsed=0,previous=performance.now();const duration=6000;
      while(elapsed<duration){
        if(reduced.matches){state.running=false;return;}
        await wait(50);const now=performance.now(),active=state.visible&&!document.hidden;if(active)elapsed+=now-previous;previous=now;
        if(active){
          const t=Math.min(1,elapsed/duration),position=t*(chartValues.length-1),index=Math.min(chartValues.length-2,Math.floor(position)),fraction=position-index,value=chartValues[index]+(chartValues[index+1]-chartValues[index])*fraction,x=chartX[index]+(chartX[index+1]-chartX[index])*fraction,y=chartY[index]+(chartY[index+1]-chartY[index])*fraction;
          total.textContent=value.toFixed(1);readout.textContent=`${value.toFixed(1)} mi`;demo.style.setProperty('--readout-x',`${x/280*100}%`);line.style.strokeDashoffset=String(1-t);marker.style.transform=`translate(${x-262}px,${y-69}px)`;
        }
      }
      total.textContent='10.8';readout.textContent='10.8 mi';demo.style.setProperty('--readout-x',`${chartX.at(-1)/280*100}%`);demo.dataset.demoState='complete';line.style.strokeDashoffset='0';marker.style.transform='translate(0,0)';
      if(!await activeWait(demo,state,1800))break;
    }
    state.running=false;
  }
  function setFinal(demo){
    if(demo.dataset.demo==='kit-chat')finalMeal(demo);
    else {demo.dataset.demoState='complete';demo.querySelector('[data-week-total]').textContent='10.8';demo.querySelector('[data-week-readout]').textContent='10.8 mi';demo.style.setProperty('--readout-x','88%');demo.querySelector('[data-week-line]').style.strokeDashoffset='0';demo.querySelector('[data-week-marker]').style.transform='translateX(0)';}
  }
  function start(demo){
    const state=states.get(demo);state.visible=true;
    if(reduced.matches){setFinal(demo);return;}
    if(state.running)return;state.running=true;
    (demo.dataset.demo==='kit-chat'?mealLoop:insightLoop)(demo,state);
  }
  function stop(demo){states.get(demo).visible=false;}
  if(reduced.matches)demos.forEach(setFinal);
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>entry.isIntersecting?start(entry.target):stop(entry.target)),{threshold:.28});
    demos.forEach(demo=>observer.observe(demo));
  }else demos.forEach(start);
  reduced.addEventListener?.('change',()=>demos.forEach(demo=>reduced.matches?setFinal(demo):start(demo)));
})();
