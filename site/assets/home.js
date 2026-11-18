(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = document.body;
  const nav = document.querySelector('[data-site-nav]');
  addEventListener('scroll', () => nav?.classList.toggle('is-compact', scrollY > 48), {passive:true});

  const screenMap = {
    feed: ['feed','Home feed'],
    activity: ['activity','Activity detail'],
    food: ['talk','Kit food and weigh-in review'],
    progress: ['progress','Progress'],
    achievements: ['achievements','Achievements']
  };
  const story = document.querySelector('.home-story');
  const pinned = document.querySelector('[data-story-screen]');
  const pinnedDark = document.querySelector('[data-story-dark]');
  const steps = [...document.querySelectorAll('.story-step')];
  const jumpLinks = [...document.querySelectorAll('.home-jumps a')];
  const useStoryFallback = () => {
    body.dataset.storyMode = 'fallback';
    steps.forEach(step => step.classList.add('is-visible'));
  };
  const showScreen = key => {
    const item = screenMap[key];
    if (!item || !pinned) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const base = `assets/shots/${dark ? 'dark' : 'light'}-${item[0]}`;
    pinned.src = `${base}.webp`;
    pinned.srcset = `${base}-1x.webp 1x, ${base}.webp 2x`;
    if (pinnedDark) pinnedDark.srcset = `assets/shots/dark-${item[0]}-1x.webp 1x, assets/shots/dark-${item[0]}.webp 2x`;
    pinned.alt = `Fictional Kinetta ${item[1]} screen.`;
    body.dataset.story = key;
  };
  const setJump = key => {
    const target = key === 'progress' ? '#kit-week-demo' : `#story-${key}`;
    jumpLinks.forEach(link => link.setAttribute('aria-current', link.getAttribute('href') === target ? 'true' : 'false'));
  };
  const stickySupported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position', 'sticky');
  if (!reduce && story && pinned && steps.length && 'IntersectionObserver' in window && stickySupported) {
    try {
      const stepObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        showScreen(entry.target.dataset.screen);
        setJump(entry.target.dataset.screen);
      }), {rootMargin:'-35% 0px -45%'});
      steps.forEach(step => stepObserver.observe(step));
      body.dataset.storyMode = 'pinned';
      pinned.addEventListener('error', useStoryFallback);

      // Some browsers report sticky support but fail to keep this grid child in view.
      // Switch to each step's own screenshot if that happens, so the story never has a blank side.
      let checking = false;
      const checkPinnedStory = () => {
        if (checking || body.dataset.storyMode !== 'pinned' || innerWidth <= 900) return;
        checking = true;
        requestAnimationFrame(() => {
          checking = false;
          const storyBox = story.getBoundingClientRect(), pinBox = pinned.closest('.story-pin').getBoundingClientRect();
          const activeKey = body.dataset.story;
          const activeStep = steps.find(step => step.dataset.screen === activeKey);
          if (!activeStep) return;
          const stepBox = activeStep.getBoundingClientRect();
          const storyIsActive = storyBox.top < innerHeight && storyBox.bottom > 110 && stepBox.top < innerHeight * .8 && stepBox.bottom > innerHeight * .2;
          if (!storyIsActive) return;
          if (!pinned.complete) return;
          if (pinBox.top < 55 || pinBox.top > 165 || pinBox.bottom > innerHeight + 1) useStoryFallback();
        });
      };
      addEventListener('scroll', checkPinnedStory, {passive:true});
      addEventListener('resize', checkPinnedStory, {passive:true});
      checkPinnedStory();
    } catch {
      useStoryFallback();
    }
  } else if (story) {
    useStoryFallback();
  }

  const chat = document.querySelector('[data-kit-demo]');
  const playChat = () => {
    if (!chat) return;
    const line = chat.querySelector('[data-kit-line]'), response = chat.querySelector('[data-kit-response]'), text = '2 eggs and toast, weighed 165 this morning';
    line.textContent = ''; response.hidden = true;
    let i = 0;
    const tick = () => { line.textContent = text.slice(0, i++); if (i <= text.length) setTimeout(tick, reduce ? 0 : 34); else response.hidden = false; };
    tick();
  };
  chat?.querySelector('[data-kit-replay]')?.addEventListener('click', playChat);
  if (chat && !reduce) setTimeout(playChat, 700);

  const weekDemo = document.querySelector('[data-week-demo]');
  if (weekDemo) {
    const question = weekDemo.querySelector('[data-week-question]');
    const answer = weekDemo.querySelector('[data-week-answer]');
    const replay = weekDemo.querySelector('[data-week-replay]');
    const questionText = 'Am I improving?';
    const answerText = 'Your latest run total is below your recent average; this chart also shows stronger weeks. One week alone cannot establish a lasting trend.';
    let timers = [];
    const stopReplay = () => { timers.forEach(clearTimeout); timers = []; };
    const typeText = (node, text, done) => {
      let i = 0;
      const tick = () => {
        node.textContent = text.slice(0, i++);
        if (i <= text.length) timers.push(setTimeout(tick, 26));
        else done?.();
      };
      tick();
    };
    const playWeek = () => {
      stopReplay();
      if (reduce) { question.textContent = questionText; answer.textContent = answerText; return; }
      question.textContent = ''; answer.textContent = '';
      typeText(question, questionText, () => typeText(answer, answerText));
    };
    replay?.addEventListener('click', playWeek);
    if (!reduce && 'IntersectionObserver' in window) {
      const replayObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { playWeek(); replayObserver.disconnect(); }
      }, {threshold:.35});
      replayObserver.observe(weekDemo);
    }
  }

  const achievementObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.querySelectorAll('[data-achievement-bar]').forEach((bar, i) => { bar.style.setProperty('--fill', i ? '72%' : '58%'); });
    achievementObserver.unobserve(entry.target);
  }), {threshold:.3}) : null;
  if (achievementObserver) document.querySelectorAll('[data-achievements]').forEach(node => achievementObserver.observe(node));
})();
