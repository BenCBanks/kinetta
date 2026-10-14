// Keep the homepage lap, while respecting the visitor's motion preference.
(() => {
  const track = document.querySelector('svg.track');
  if (!track) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function update() {
    if (motion.matches) {
      track.pauseAnimations();
      track.setCurrentTime(0);
    } else {
      track.unpauseAnimations();
    }
  }
  update();
  motion.addEventListener('change', update);
})();
