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
    training: ['assets/shots/light-activity.webp', 'assets/shots/dark-activity.webp', 'Training', 'Route and numbers, together.', 'Fictional Kinetta Training activity screen with a route map and workout numbers.'],
    food: ['assets/shots/light-food.webp', 'assets/shots/dark-food.webp', 'Food', 'Meals, portions and totals.', 'Fictional Kinetta Food screen with meals, calories and macro totals.'],
    friends: ['assets/shots/light-friends.webp', 'assets/shots/dark-friends.webp', 'Friends', 'Share with people you choose.', 'Fictional Kinetta Friends screen with approved friends and audience controls.'],
    progress: ['assets/shots/light-progress.webp', 'assets/shots/dark-progress.webp', 'Progress', 'A varied week, at a glance.', 'Fictional Kinetta Progress screen with varied weekly running totals.'],
    kit: ['assets/shots/light-talk.webp', 'assets/shots/dark-talk.webp', 'Kit', 'A review before you save.', 'Fictional Kinetta Kit food conversation with a review card.']
  };
  const featureScreen = document.querySelector('[data-feature-screen]');
  const featureDark = document.querySelector('[data-feature-dark]');
  const featureCopy = document.querySelector('[data-feature-copy]');
  const featureLabel = document.querySelector('[data-feature-label]');
  const selectFeature = key => {
    const item = featureMap[key];
    if (!item || !featureScreen) return;
    featureScreen.src = themeIsDark() ? item[1] : item[0];
    if (featureDark) featureDark.srcset = item[1];
    featureScreen.alt = item[4];
    if (featureCopy) featureCopy.textContent = item[3];
    if (featureLabel) featureLabel.textContent = '';
    document.querySelectorAll('[data-feature-tab]').forEach(tab => {
      const active = tab.dataset.featureTab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('is-selected', active);
    });
  };
  const featureTabs = [...document.querySelectorAll('[data-feature-tab]')];
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
  const featureShowcase = document.querySelector('.feature-showcase');
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
  selectFeature('training');
})();
