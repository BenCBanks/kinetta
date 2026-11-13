(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dark = matchMedia('(prefers-color-scheme: dark)');

  document.querySelectorAll('[data-food-story]').forEach(root => {
    const pinned = root.querySelector('[data-food-pinned-image]');
    const darkSource = root.querySelector('[data-food-dark]');
    const steps = [...root.querySelectorAll('[data-food-screen]')];
    let active = steps[0]?.dataset.foodScreen || '';

    const refresh = () => {
      const step = steps.find(item => item.dataset.foodScreen === active);
      if (!pinned || !step) return;
      const shot = active === 'day' ? 'food' : active;
      const light = `assets/shots/light-${shot}.webp`;
      const night = `assets/shots/dark-${shot}.webp`;
      const alt = step.dataset.foodAlt || 'Kinetta Nutrition screen with demo data.';
      pinned.src = dark.matches ? night : light;
      pinned.alt = alt;
      if (darkSource) darkSource.srcset = night;
    };
    const activate = step => {
      active = step.dataset.foodScreen;
      steps.forEach(item => item.classList.toggle('is-visible', item === step));
      root.dataset.activeScreen = active;
      refresh();
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) activate(entry.target);
      }), {rootMargin:'-35% 0px -45%'});
      steps.forEach(step => observer.observe(step));
    } else {
      steps.forEach(step => step.classList.add('is-visible'));
    }
    dark.addEventListener?.('change', refresh);
    refresh();

    const chat = root.querySelector('[data-chat-demo]');
    if (!chat) return;
    const line = chat.querySelector('[data-chat-line]');
    const reply = chat.querySelector('[data-chat-reply]');
    const replay = chat.querySelector('[data-chat-replay]');
    const text = line?.textContent || '';
    replay?.addEventListener('click', () => {
      if (!line || !reply) return;
      reply.hidden = true;
      if (reduce) {
        line.textContent = text;
        reply.hidden = false;
        return;
      }
      line.textContent = '';
      let index = 0;
      const tick = () => {
        line.textContent = text.slice(0, index++);
        if (index <= text.length) setTimeout(tick, 28);
        else reply.hidden = false;
      };
      tick();
    });
  });
})();
