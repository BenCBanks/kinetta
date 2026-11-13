(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});
  const screenMap = {
    feed: ['assets/shots/light-feed.webp','assets/shots/dark-feed.webp','Home feed'],
    activity: ['assets/shots/light-activity.webp','assets/shots/dark-activity.webp','Activity detail'],
    food: ['assets/shots/light-talk.webp','assets/shots/dark-talk.webp','Kit food chat'],
    progress: ['assets/shots/light-progress.webp','assets/shots/dark-progress.webp','Progress'],
    achievements: ['assets/shots/light-profile.webp','assets/shots/dark-profile.webp','Achievements']
  };
  const pinned = document.querySelector('[data-story-screen]'), pinnedDark = document.querySelector('[data-story-dark]'), label = document.querySelector('[data-story-label]');
  const showScreen = key => { const item=screenMap[key]; if (!item || !pinned) return; const dark=matchMedia('(prefers-color-scheme: dark)').matches; pinned.src=dark?item[1]:item[0]; if(pinnedDark) pinnedDark.srcset=item[1]; pinned.alt=`Fictional Kinetta ${item[2]} screen.`; if(label) label.textContent=item[2]; document.body.dataset.story=key; };
  const steps=[...document.querySelectorAll('.story-step')];
  const stepObserver = new IntersectionObserver(entries => entries.forEach(entry => { if(!entry.isIntersecting) return; entry.target.classList.add('is-visible'); showScreen(entry.target.dataset.screen); }), {rootMargin:'-35% 0px -45%'});
  steps.forEach(step => stepObserver.observe(step));
  const chartData = {
    week:{run:{bars:[42,68,54,74,48,88,34],distance:'40.6',time:'6h 16m',best:'9:47'},ride:{bars:[32,55,70,45,82,60,28],distance:'126.4',time:'8h 04m',best:'22:14'},swim:{bars:[18,28,46,24,56,38,20],distance:'8.2',time:'3h 12m',best:'1:42'}},
    month:{run:{bars:[45,52,61,74,66,83,72,90],distance:'168.2',time:'27h 40m',best:'8:58'},ride:{bars:[40,65,58,78,70,86,63,92],distance:'520.8',time:'31h 20m',best:'20:42'},swim:{bars:[25,34,45,52,38,64,48,70],distance:'34.6',time:'12h 04m',best:'1:38'}},
    year:{run:{bars:[30,40,55,46,62,70,76,88],distance:'1,248',time:'198h',best:'8:41'},ride:{bars:[42,55,70,63,80,72,90,96],distance:'4,812',time:'276h',best:'19:58'},swim:{bars:[15,24,32,40,46,58,64,78],distance:'364',time:'128h',best:'1:34'}}
  };
  const demo=document.querySelector('[data-progress-demo]');
  if(demo){ let period='week', sport='run'; const chart=demo.querySelector('[data-chart]'); const render=()=>{const d=chartData[period][sport]; chart.innerHTML=d.bars.map((value,i)=>`<button class="chart-bar${i===d.bars.length-1?' is-selected':''}" style="--bar-height:${value}%" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i%7]} · ${Math.round(value/10*10)/10} mi" data-value="${value}"></button>`).join(''); demo.querySelector('[data-stat="distance"]').textContent=d.distance; demo.querySelector('[data-stat="time"]').textContent=d.time; demo.querySelector('[data-stat="best"]').textContent=d.best; demo.querySelector('[data-chart-period]').textContent=`${period==='week'?'Nov 2–8':period==='month'?'October':'2026'} · ${sport[0].toUpperCase()+sport.slice(1)}`; chart.querySelectorAll('.chart-bar').forEach((bar,i)=>bar.addEventListener('click',()=>{chart.querySelectorAll('.chart-bar').forEach(x=>x.classList.remove('is-selected'));bar.classList.add('is-selected');demo.querySelector('[data-chart-selected]').textContent=`${bar.getAttribute('aria-label')}`;}));};
    demo.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{period=button.dataset.period;demo.querySelectorAll('[data-period]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));render();}));
    demo.querySelectorAll('[data-sport]').forEach(button=>button.addEventListener('click',()=>{sport=button.dataset.sport;demo.querySelectorAll('[data-sport]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));render();})); render(); }
  const chat=document.querySelector('[data-kit-demo]'); const playChat=()=>{if(!chat)return; const line=chat.querySelector('[data-kit-line]'), response=chat.querySelector('[data-kit-response]'), text='2 eggs and toast, weighed 165 this morning'; line.textContent=''; response.hidden=true; let i=0; const tick=()=>{line.textContent=text.slice(0,i++); if(i<=text.length) setTimeout(tick,reduce?0:34); else {response.hidden=false;}}; tick();}; chat?.querySelector('[data-kit-replay]')?.addEventListener('click',playChat); if(chat&&!reduce) setTimeout(playChat,700);
  const countObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting||entry.target.dataset.done)return; entry.target.dataset.done='1'; const target=Number(entry.target.dataset.count); const start=performance.now(), duration=reduce?0:800; const tick=now=>{const t=duration?Math.min(1,(now-start)/duration):1; entry.target.textContent=(target%1? (target*t).toFixed(1):Math.round(target*t)); if(t<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick);}),{threshold:.35}); document.querySelectorAll('[data-count]').forEach(node=>countObserver.observe(node));
  const achievementObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return; entry.target.querySelectorAll('[data-achievement-bar]').forEach((bar,i)=>{bar.style.setProperty('--fill',i?'72%':'58%');}); achievementObserver.unobserve(entry.target);}),{threshold:.3}); document.querySelectorAll('[data-achievements]').forEach(node=>achievementObserver.observe(node));
})();
