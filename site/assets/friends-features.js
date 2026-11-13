(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const themeIsDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const friendsMap = {
    friends: ['assets/shots/light-friends.webp', 'assets/shots/dark-friends.webp', 'Fictional Kinetta Friends screen with three approved friends.'],
    feed: ['assets/shots/light-feed.webp', 'assets/shots/dark-feed.webp', 'Fictional Kinetta shared workout feed with a route map and reactions.'],
    profile: ['assets/shots/light-profile.webp', 'assets/shots/dark-profile.webp', 'Fictional Kinetta profile with weekly totals and featured achievements.']
  };
  const pinned = document.querySelector('[data-friends-screen]');
  const pinnedDark = document.querySelector('[data-friends-dark]');
  const showFriendsScreen = key => {
    const item = friendsMap[key];
    if (!item || !pinned) return;
    pinned.src = themeIsDark() ? item[1] : item[0];
    if (pinnedDark) pinnedDark.srcset = item[1];
    pinned.alt = item[2];
  };
  const steps = [...document.querySelectorAll('.friends-step[data-friends-screen-key]')];
  if (steps.length && pinned) {
    if ('IntersectionObserver' in window && !reduce) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) showFriendsScreen(entry.target.dataset.friendsScreenKey);
      }), { rootMargin: '-34% 0px -45%' });
      steps.forEach(step => observer.observe(step));
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
  document.querySelectorAll('[data-feature-tab]').forEach(tab => tab.addEventListener('click', () => selectFeature(tab.dataset.featureTab)));
  selectFeature('training');
})();
