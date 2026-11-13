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
  const chat=document.querySelector('[data-kit-demo]'); const playChat=()=>{if(!chat)return; const line=chat.querySelector('[data-kit-line]'), response=chat.querySelector('[data-kit-response]'), text='2 eggs and toast, weighed 165 this morning'; line.textContent=''; response.hidden=true; let i=0; const tick=()=>{line.textContent=text.slice(0,i++); if(i<=text.length) setTimeout(tick,reduce?0:34); else {response.hidden=false;}}; tick();}; chat?.querySelector('[data-kit-replay]')?.addEventListener('click',playChat); if(chat&&!reduce) setTimeout(playChat,700);
  const countObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting||entry.target.dataset.done)return; entry.target.dataset.done='1'; const target=Number(entry.target.dataset.count); const start=performance.now(), duration=reduce?0:800; const tick=now=>{const t=duration?Math.min(1,(now-start)/duration):1; entry.target.textContent=(target%1? (target*t).toFixed(1):Math.round(target*t)); if(t<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick);}),{threshold:.35}); document.querySelectorAll('[data-count]').forEach(node=>countObserver.observe(node));
  const achievementObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return; entry.target.querySelectorAll('[data-achievement-bar]').forEach((bar,i)=>{bar.style.setProperty('--fill',i?'72%':'58%');}); achievementObserver.unobserve(entry.target);}),{threshold:.3}); document.querySelectorAll('[data-achievements]').forEach(node=>achievementObserver.observe(node));
})();
