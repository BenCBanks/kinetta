(() => {
  'use strict';
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const demos = [...document.querySelectorAll('[data-demo]')];
  const states = new Map(demos.map(demo => [demo,{visible:false,running:false}]));
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  const activeWait = async (demo,state,ms) => {
    let elapsed=0;
    while(elapsed<ms){if(reduced.matches)return false;if(state.visible&&!document.hidden)elapsed+=50;await wait(50);}
    return true;
  };
  function scaleCanvas(demo){
    const viewport=demo.querySelector('.kit-chat-viewport,.kit-phone-viewport');
    const canvas=demo.querySelector('.kit-chat-canvas,.kit-phone-canvas');
    if(viewport&&canvas)canvas.style.setProperty('--phone-scale',String(viewport.clientWidth/393));
  }
  demos.forEach(demo=>{
    scaleCanvas(demo);
    const viewport=demo.querySelector('.kit-chat-viewport,.kit-phone-viewport');
    if(viewport&&'ResizeObserver' in window)new ResizeObserver(()=>scaleCanvas(demo)).observe(viewport);
  });
  function finalMeal(demo){
    const question=demo.querySelector('[data-chat-question]');question.textContent=question.dataset.fullText;
    demo.querySelector('[data-chat-typing]').setAttribute('aria-hidden','true');
    demo.querySelector('[data-chat-result]').setAttribute('aria-hidden','false');
    demo.querySelector('[data-chat-total]').textContent='55';
    demo.querySelector('[data-chat-log-bar]').setAttribute('aria-hidden','false');
    demo.dataset.demoState='complete';
  }
  async function mealLoop(demo,state){
    const question=demo.querySelector('[data-chat-question]'),typing=demo.querySelector('[data-chat-typing]'),result=demo.querySelector('[data-chat-result]'),total=demo.querySelector('[data-chat-total]'),logBar=demo.querySelector('[data-chat-log-bar]'),text=question.dataset.fullText;
    while(!reduced.matches){
      demo.dataset.demoState='typing';question.textContent='';typing.setAttribute('aria-hidden','true');result.setAttribute('aria-hidden','true');logBar.setAttribute('aria-hidden','true');total.textContent='0';
      for(let i=1;i<=text.length;i++){question.textContent=text.slice(0,i);if(!await activeWait(demo,state,23))return;}
      question.textContent=text;demo.dataset.demoState='matching';typing.setAttribute('aria-hidden','false');
      if(!await activeWait(demo,state,650))break;
      typing.setAttribute('aria-hidden','true');result.setAttribute('aria-hidden','false');demo.dataset.demoState='matched';
      logBar.setAttribute('aria-hidden','false');
      for(let n=0;n<=55;n+=5){total.textContent=String(Math.min(n,55));if(!await activeWait(demo,state,45))return;}
      total.textContent='55';demo.dataset.demoState='complete';
      if(!await activeWait(demo,state,2100))break;
    }
    state.running=false;
  }
  async function insightLoop(demo,state){
    const question=demo.querySelector('[data-week-question]'),typing=demo.querySelector('[data-week-typing]'),answer=demo.querySelector('.kit-week-answer'),copy=demo.querySelector('[data-week-answer]'),facts=demo.querySelector('[data-week-facts]'),insightText=copy.dataset.fullText;
    const values=[['[data-week-this]',10.8],['[data-week-average]',20.6],['[data-week-best]',27.9]];
    while(!reduced.matches){
      demo.dataset.demoState='typing';question.textContent='';typing.setAttribute('aria-hidden','true');answer.setAttribute('aria-hidden','true');copy.textContent='';facts.querySelectorAll('b').forEach(x=>x.textContent='0.0');
      const prompt=question.dataset.fullText;
      for(let i=1;i<=prompt.length;i++){question.textContent=prompt.slice(0,i);if(!await activeWait(demo,state,45))return;}
      question.textContent=prompt;typing.setAttribute('aria-hidden','false');
      if(!await activeWait(demo,state,650))break;
      typing.setAttribute('aria-hidden','true');answer.setAttribute('aria-hidden','false');if(!await activeWait(demo,state,50))break;demo.dataset.demoState='answering';
      for(let i=1;i<=insightText.length;i++){copy.textContent=insightText.slice(0,i);if(!await activeWait(demo,state,12))return;}
      copy.textContent=insightText;
      for(const [selector,value] of values){const target=facts.querySelector(selector);for(let n=0;n<=value*10;n+=Math.max(1,Math.ceil(value*10/18))){target.textContent=(Math.min(n,value*10)/10).toFixed(1);if(!await activeWait(demo,state,22))return;}target.textContent=value.toFixed(1);}
      demo.dataset.demoState='complete';
      if(!await activeWait(demo,state,2100))break;
    }
    state.running=false;
  }
  function setFinal(demo){
    if(demo.dataset.demo==='kit-chat')finalMeal(demo);
    else {
      const question=demo.querySelector('[data-week-question]');question.textContent=question.dataset.fullText;
      demo.querySelector('[data-week-typing]').setAttribute('aria-hidden','true');
      demo.querySelector('.kit-week-answer').setAttribute('aria-hidden','false');
      const answer=demo.querySelector('[data-week-answer]');answer.textContent=answer.dataset.fullText;
      demo.querySelector('[data-week-this]').textContent='10.8';
      demo.querySelector('[data-week-average]').textContent='20.6';
      demo.querySelector('[data-week-best]').textContent='27.9';
      demo.dataset.demoState='complete';
    }
  }
  function start(demo){
    const state=states.get(demo);state.visible=true;scaleCanvas(demo);
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
