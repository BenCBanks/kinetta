(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});
  const screenMap = {
    feed: ['feed','Home feed'],
    activity: ['activity','Activity detail'],
    food: ['talk','Kit food and weigh-in review'],
    progress: ['progress','Progress'],
    achievements: ['achievements','Achievements']
  };
  const pinned = document.querySelector('[data-story-screen]'), pinnedDark = document.querySelector('[data-story-dark]');
  const showScreen = key => {
    const item=screenMap[key]; if (!item || !pinned) return;
    const dark=matchMedia('(prefers-color-scheme: dark)').matches,base=`assets/shots/${dark?'dark':'light'}-${item[0]}`;
    pinned.src=`${base}.webp`;pinned.srcset=`${base}-1x.webp 1x, ${base}.webp 2x`;
    if(pinnedDark)pinnedDark.srcset=`assets/shots/dark-${item[0]}-1x.webp 1x, assets/shots/dark-${item[0]}.webp 2x`;
    pinned.alt=`Fictional Kinetta ${item[1]} screen.`;document.body.dataset.story=key;
  };
  const steps=[...document.querySelectorAll('.story-step')];
  const jumpLinks=[...document.querySelectorAll('.home-jumps a')];
  const setJump=(key)=>{ const target=key==='progress'?'#progress-demo':`#story-${key}`; jumpLinks.forEach(link=>link.setAttribute('aria-current',link.getAttribute('href')===target?'true':'false')); };
  const stepObserver = new IntersectionObserver(entries => entries.forEach(entry => { if(!entry.isIntersecting) return; entry.target.classList.add('is-visible'); showScreen(entry.target.dataset.screen); setJump(entry.target.dataset.screen); }), {rootMargin:'-35% 0px -45%'});
  steps.forEach(step => stepObserver.observe(step));
  const chat=document.querySelector('[data-kit-demo]'); const playChat=()=>{if(!chat)return; const line=chat.querySelector('[data-kit-line]'), response=chat.querySelector('[data-kit-response]'), text='2 eggs and toast, weighed 165 this morning'; line.textContent=''; response.hidden=true; let i=0; const tick=()=>{line.textContent=text.slice(0,i++); if(i<=text.length) setTimeout(tick,reduce?0:34); else {response.hidden=false;}}; tick();}; chat?.querySelector('[data-kit-replay]')?.addEventListener('click',playChat); if(chat&&!reduce) setTimeout(playChat,700);
  const achievementObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return; entry.target.querySelectorAll('[data-achievement-bar]').forEach((bar,i)=>{bar.style.setProperty('--fill',i?'72%':'58%');}); achievementObserver.unobserve(entry.target);}),{threshold:.3}); document.querySelectorAll('[data-achievements]').forEach(node=>achievementObserver.observe(node));
})();
