// A few short hints for features that are easy to miss.
'use strict';
const FEATURE_HINTS = [
  ['React', 'Choose an emoji on a workout.', '/activity'],
  ['Health app', 'Connect Health to import workouts.', '/track/connections'],
  ['Hide start and end', 'Trim the map on shared routes.', '/me/sharing'],
];

route(/^\/me\/explore$/, 'track', (el) => {
  el.classList.add('guide-page');
  el.innerHTML = `<div class="top"><button class="back-circle" type="button" data-back aria-label="Back">${svg('back')}</button></div><h1>Explore Kinetta</h1>
    <nav class="guide-hints social-list-group" aria-label="Explore features">${FEATURE_HINTS.map(([label, text, href]) =>
      `<a class="guide-hint list-row" href="${href}"><span class="guide-hint-copy"><h2>${esc(label)}</h2><p>${esc(text)}</p></span><span class="chev" aria-hidden="true">${svg('chev')}</span></a>`
    ).join('')}</nav>`;
  wireBack(el, '/track');
});
