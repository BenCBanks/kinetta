(() => {
  'use strict';
  const screens = {
    activity: ['assets/shots/light-activity.webp','assets/shots/dark-activity.webp','Fictional Kinetta run detail with a route map, workout numbers and chart.'],
    splits: ['assets/shots/light-activity-splits.webp','assets/shots/dark-activity-splits.webp','Fictional Kinetta run detail showing mile splits.'],
    profile: ['assets/shots/light-progress.webp','assets/shots/dark-progress.webp','Fictional Kinetta Progress chart with a Run sport picker and Week, Month and Year views.'],
    lift: ['assets/shots/light-lift.webp','assets/shots/dark-lift.webp','Fictional strength session with current and previous sets.'],
    plan: ['assets/shots/light-plan.webp','assets/shots/dark-plan.webp','Fictional 10K plan with the next workout and this week’s schedule.'],
    progress: ['assets/shots/light-progress.webp','assets/shots/dark-progress.webp','Fictional weekly running totals and a varied distance history chart.'],
    route: ['assets/shots/light-route.webp','assets/shots/dark-route.webp','Fictional matched route with repeat count, best time and recent activities.']
  };
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');
  const story = document.querySelector('.training-story');
  const pinned = document.querySelector('[data-training-pinned]');
  const pinnedDark = document.querySelector('[data-training-dark]');
  const mobile = document.querySelector('[data-training-mobile]');
  const mobileDark = document.querySelector('[data-training-mobile-dark]');
  const steps = [...document.querySelectorAll('[data-training-screen]')];
  let active = 'activity', runView = 'map';

  const sourceFor = key => screens[key === 'activity' && runView === 'splits' ? 'splits' : key] || screens.activity;
  const refresh = () => {
    const [light, dark, alt] = sourceFor(active);
    const selected = prefersDark.matches ? dark : light;
    if (pinned) { pinned.src = selected; pinned.alt = alt; }
    if (pinnedDark) pinnedDark.srcset = dark;
    if (mobile && active === 'activity') { mobile.src = selected; mobile.alt = alt; }
    if (mobileDark && active === 'activity') mobileDark.srcset = dark;
  };
  document.querySelectorAll('[data-run-view]').forEach(button => button.addEventListener('click', () => {
    runView = button.dataset.runView;
    document.querySelectorAll('[data-run-view]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.runView === runView)));
    if (active === 'activity') refresh();
  }));
  prefersDark.addEventListener?.('change', refresh);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      active = entry.target.dataset.trainingScreen;
      story?.setAttribute('data-active-screen', active);
      entry.target.classList.add('is-visible');
      refresh();
    }), {rootMargin:'-35% 0px -45%'});
    steps.forEach(step => observer.observe(step));
  } else {
    steps.forEach(step => step.classList.add('is-visible'));
  }
  refresh();
})();
