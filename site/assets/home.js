(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});
  const screenMap = {
    feed: ['assets/shots/light-feed.webp','assets/shots/dark-feed.webp','Home feed'],
    activity: ['assets/shots/light-activity.webp','assets/shots/dark-activity.webp','Activity detail'],
    food: ['assets/shots/light-home-food-day.webp','assets/shots/dark-home-food-day.webp','Nutrition diary with food logged'],
    progress: ['assets/shots/light-progress.webp','assets/shots/dark-progress.webp','Progress'],
    achievements: ['assets/shots/light-profile.webp','assets/shots/dark-profile.webp','Achievements']
  };
  const pinned = document.querySelector('[data-story-screen]'), pinnedDark = document.querySelector('[data-story-dark]');
  const foodButtons=[...document.querySelectorAll('[data-kit-replay]')];
  const foodImages=[...document.querySelectorAll('[data-food-phone-screen]')];
  const foodDarkSources=[...document.querySelectorAll('[data-food-phone-dark]')];
  let foodChatPlaying=false;
  const setFoodPhone = playing => {
    foodChatPlaying=playing;
    const key=playing?'chat':'day';
    foodImages.forEach(image=>{
      const candidates=image.dataset[`${key}Srcset`];
      if(!candidates)return;
      image.closest('.phone-frame')?.classList.add('is-swapping');
      image.srcset=candidates;
      image.src=candidates.split(',')[0].trim().split(' ')[0];
      image.alt=playing?'Fictional Kit conversation reviewing a meal against today’s logged diary.':'Fictional Nutrition diary with breakfast and lunch logged today.';
      if(reduce)image.closest('.phone-frame')?.classList.remove('is-swapping');
      else setTimeout(()=>image.closest('.phone-frame')?.classList.remove('is-swapping'),220);
    });
    foodDarkSources.forEach(source=>{source.srcset=source.dataset[`${key}Srcset`]||source.srcset;});
    foodButtons.forEach(button=>{button.setAttribute('aria-pressed',String(playing));button.textContent=playing?'Show logged day':'Play chat in phone';});
  };
  const showScreen = key => { const item=screenMap[key]; if (!item || !pinned) return; const dark=matchMedia('(prefers-color-scheme: dark)').matches; if(key==='food')setFoodPhone(false); pinned.src=dark?item[1]:item[0]; if(pinnedDark)pinnedDark.srcset=item[1]; pinned.alt=`Fictional Kinetta ${item[2]} screen.`; document.body.dataset.story=key; };
  const steps=[...document.querySelectorAll('.story-step')];
  const jumpLinks=[...document.querySelectorAll('.home-jumps a')];
  const setJump=(key)=>{ const target=key==='progress'?'#progress-demo':`#story-${key}`; jumpLinks.forEach(link=>link.setAttribute('aria-current',link.getAttribute('href')===target?'true':'false')); };
  const stepObserver = new IntersectionObserver(entries => entries.forEach(entry => { if(!entry.isIntersecting) return; entry.target.classList.add('is-visible'); showScreen(entry.target.dataset.screen); setJump(entry.target.dataset.screen); }), {rootMargin:'-35% 0px -45%'});
  steps.forEach(step => stepObserver.observe(step));
  foodButtons.forEach(button=>button.addEventListener('click',()=>setFoodPhone(!foodChatPlaying)));
  const countObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting||entry.target.dataset.done)return; entry.target.dataset.done='1'; const target=Number(entry.target.dataset.count); const start=performance.now(), duration=reduce?0:800; const tick=now=>{const t=duration?Math.min(1,(now-start)/duration):1; entry.target.textContent=(target%1? (target*t).toFixed(1):Math.round(target*t)); if(t<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick);}),{threshold:.35}); document.querySelectorAll('[data-count]').forEach(node=>countObserver.observe(node));
  const achievementObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return; entry.target.querySelectorAll('[data-achievement-bar]').forEach((bar,i)=>{bar.style.setProperty('--fill',i?'72%':'58%');}); achievementObserver.unobserve(entry.target);}),{threshold:.3}); document.querySelectorAll('[data-achievements]').forEach(node=>achievementObserver.observe(node));
})();
