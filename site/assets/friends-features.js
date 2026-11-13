(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const themeIsDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const friendsMap = {
    friends: ['assets/shots/light-friends.webp', 'assets/shots/dark-friends.webp', 'Fictional Kinetta Friends screen with three approved friends.'],
    photos: ['assets/shots/light-photos.webp', 'assets/shots/dark-photos.webp', 'Fictional Kinetta shared workout with an attached photo, reactions and comments.'],
    social: ['assets/shots/light-activity.webp', 'assets/shots/dark-activity.webp', 'Fictional Kinetta activity detail with reactions and comments.']
  };
  const pinned = document.querySelector('[data-friends-screen]');
  const pinnedDark = document.querySelector('[data-friends-dark]');
  const pinnedFrame = pinned?.closest('.friends-screen');
  const showFriendsScreen = key => {
    const item = friendsMap[key];
    if (!item || !pinned) return;
    pinned.src = themeIsDark() ? item[1] : item[0];
    if (pinnedDark) pinnedDark.srcset = item[1];
    pinned.alt = item[2];
    ['friends', 'photos', 'social'].forEach(state => pinnedFrame?.classList.toggle(`friends-screen--${state}`, key === state));
    pinnedFrame?.classList.toggle('friends-screen--clean', key === 'friends');
  };
  const steps = [...document.querySelectorAll('.friends-step[data-friends-screen-key]')];
  if (steps.length && pinned) {
    const reveal = step => {
      step.classList.add('is-visible');
      showFriendsScreen(step.dataset.friendsScreenKey);
    };
    if ('IntersectionObserver' in window && !reduce) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) reveal(entry.target);
      }), { rootMargin: '-20% 0px -25%', threshold: 0.08 });
      steps.forEach(step => observer.observe(step));
      // The scroll fallback covers browsers that settle a smooth scroll between observer thresholds.
      addEventListener('scroll', () => steps.forEach(step => {
        const box = step.getBoundingClientRect();
        if (box.top < innerHeight * .72 && box.bottom > innerHeight * .18) reveal(step);
      }), { passive: true });
    } else {
      steps.forEach(step => step.classList.add('is-visible'));
    }
  }

  const privacyCopy = {
    only: ['Only me', 'Only you see this in your history.'],
    friends: ['Friends', 'Friends see this in their feed.'],
    everyone: ['Everyone', 'Anyone on Kinetta can see this workout.']
  };
  const updatePrivacy = choice => {
    const value = privacyCopy[choice] ? choice : 'friends';
    const [label, status] = privacyCopy[value];
    document.querySelectorAll('[data-privacy-choice]').forEach(button => {
      const selected = button.dataset.privacyChoice === value;
      button.setAttribute('aria-checked', String(selected));
      button.classList.toggle('is-selected', selected);
      const check = button.querySelector('.privacy-check');
      if (check) check.textContent = selected ? '✓' : '';
    });
    document.querySelectorAll('[data-privacy-status]').forEach(node => { node.textContent = status; });
    document.querySelectorAll('[data-privacy-caption]').forEach(node => { node.textContent = `Audience: ${label}`; });
    document.querySelectorAll('[data-privacy-phone-label]').forEach(node => { node.textContent = label; });
  };
  document.querySelectorAll('[data-privacy-choice]').forEach(button => {
    button.addEventListener('click', () => updatePrivacy(button.dataset.privacyChoice));
  });
  updatePrivacy('friends');

  const featureMap = {
    training: {light: 'assets/shots/light-activity.webp', dark: 'assets/shots/dark-activity.webp', headline: 'Every run, mapped and measured.', copy: 'Record a route, then see the detail that makes the next run better.', link: 'Explore Training', href: 'training', alt: 'Fictional Kinetta Training activity screen with a route map and workout numbers.', capabilities: [['i-target', 'Route map', 'Start and finish privacy'], ['i-run', 'Splits, pace and heart rate', 'When the recording includes them'], ['i-spark', 'Compare repeats on a route', 'See what changed over time']]},
    food: {light: 'assets/shots/light-food.webp', dark: 'assets/shots/dark-food.webp', headline: 'Food that fits your day.', copy: 'Log a meal in plain language, then review portions and totals before they count.', link: 'Explore Food', href: 'food', alt: 'Fictional Kinetta Food screen with meals, calories and macro totals.', capabilities: [['i-pot', 'Quick food entries', 'Search, barcodes and plain language'], ['i-target', 'Portions you can check', 'Review estimates before saving'], ['i-flame', 'Calories and macros', 'See the day in context']]},
    friends: {light: 'assets/shots/light-friends.webp', dark: 'assets/shots/dark-friends.webp', headline: 'Share the good parts.', copy: 'Keep your routine yours, then choose the people who get to see a workout.', link: 'Explore Friends', href: 'friends', alt: 'Fictional Kinetta Friends screen with approved friends and audience controls.', capabilities: [['i-people', 'Approved friends', 'Find people by name or username'], ['i-target', 'Audience per workout', 'Only me, Friends or Everyone'], ['i-spark', 'Reactions and comments', 'Keep the useful part social']]},
    progress: {light: 'assets/shots/light-progress.webp', dark: 'assets/shots/dark-progress.webp', headline: 'See your weeks add up.', copy: 'Spot the shape of your training with varied weeks, totals and trends that stay readable.', link: 'Explore Progress', href: 'training#progress', alt: 'Fictional Kinetta Progress screen with varied weekly running totals.', capabilities: [['i-run', 'Weekly totals', 'Distance, workouts and time'], ['i-target', 'Pace and speed', 'Tap a point to inspect it'], ['i-spark', 'Real variation', 'Rest days, long runs and down weeks']]},
    kit: {light: 'assets/shots/light-talk.webp', dark: 'assets/shots/dark-talk.webp', headline: 'A second set of eyes on your log.', copy: 'Ask Kit about a meal or a training week, then decide what belongs in your records.', link: 'Explore Kit', href: 'food#kit', alt: 'Fictional Kinetta Kit food conversation with a review card.', capabilities: [['i-spark', 'Specific reviews', 'Food and training context when you ask'], ['i-target', 'Your call before saving', 'Review, edit or dismiss suggestions'], ['i-pot', 'Private by default', 'Your chats stay in your account']]}
  };
  const featureScreen = document.querySelector('[data-feature-screen]');
  const featureDark = document.querySelector('[data-feature-dark]');
  const featureCopy = document.querySelector('[data-feature-copy]');
  const featureHeadline = document.querySelector('[data-feature-headline]');
  const featureCapabilities = document.querySelector('[data-feature-capabilities]');
  const featureLink = document.querySelector('[data-feature-link]');
  const featureCopyPanel = document.querySelector('[data-feature-copy-panel]');
  const featureShowcase = document.querySelector('.feature-showcase');
  const featureTabs = [...document.querySelectorAll('[data-feature-tab]')];
  let featureKey = null;
  const positionFeaturePill = () => {
    const active = featureTabs.find(tab => tab.classList.contains('is-selected'));
    if (!active) return;
    document.querySelector('.feature-tabs')?.style.setProperty('--feature-pill-left', `${active.offsetLeft}px`);
    document.querySelector('.feature-tabs')?.style.setProperty('--feature-pill-width', `${active.offsetWidth}px`);
  };
  const transitionFeature = node => {
    if (!node || reduce) return;
    node.classList.remove('is-changing');
    void node.offsetWidth;
    node.classList.add('is-changing');
    setTimeout(() => node.classList.remove('is-changing'), 360);
  };
  const selectFeature = key => {
    const item = featureMap[key];
    if (!item || !featureScreen) return;
    const changing = featureKey !== null && featureKey !== key;
    featureKey = key;
    featureScreen.src = themeIsDark() ? item.dark : item.light;
    if (featureDark) featureDark.srcset = item.dark;
    featureScreen.alt = item.alt;
    if (featureHeadline) featureHeadline.textContent = item.headline;
    if (featureCopy) featureCopy.textContent = item.copy;
    if (featureCapabilities) featureCapabilities.innerHTML = item.capabilities.map(([icon, title, detail]) => `<li><svg aria-hidden="true"><use href="#${icon}"></use></svg><span><strong>${title}</strong><small>${detail}</small></span></li>`).join('');
    if (featureLink) { featureLink.href = item.href; featureLink.innerHTML = `${item.link} <span aria-hidden="true">→</span>`; }
    document.querySelectorAll('[data-feature-tab]').forEach(tab => {
      const active = tab.dataset.featureTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('is-selected', active);
    });
    positionFeaturePill();
    if (changing) { transitionFeature(featureScreen); transitionFeature(featureCopyPanel); }
  };
  featureTabs.forEach(tab => {
    tab.addEventListener('click', () => selectFeature(tab.dataset.featureTab));
    tab.addEventListener('keydown', event => {
      const index = featureTabs.indexOf(tab);
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? featureTabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      const target = featureTabs[(next + featureTabs.length) % featureTabs.length];
      target.focus();
      selectFeature(target.dataset.featureTab);
    });
  });
  if (featureShowcase) {
    const reveal = () => featureShowcase.classList.add('is-visible');
    if (reduce || !('IntersectionObserver' in window)) reveal();
    else {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          reveal();
          observer.disconnect();
        }
      }, { threshold: 0.12 });
      observer.observe(featureShowcase);
    }
  }
  addEventListener('resize', positionFeaturePill, {passive: true});
  selectFeature('training');
  positionFeaturePill();
})();
