// A few short hints for features that are easy to miss.
'use strict';
const FEATURE_HINTS = [
  ['React', 'Hold it on an activity for more emoji.'],
  ['Health app', 'Open it from Connections to import workouts and weight.'],
  ['Hide where it starts and ends', 'Leave it on when sharing a route to trim its map.'],
];

route(/^\/me\/explore$/, 'track', (el) => {
  el.classList.add('guide-page');
  el.innerHTML = `<div class="top">${backBtn('Track')}</div><h1>Explore Kinetta</h1>
    <section class="guide-hints" aria-label="Hints">${FEATURE_HINTS.map(([label, text]) =>
      `<article class="guide-hint"><h2>${esc(label)}</h2><p>${esc(text)}</p></article>`
    ).join('')}</section>`;
  wireBack(el, '/track');
});
