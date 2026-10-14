// Start on the visible side of the phone; allow explicit play even with reduced motion.
(() => {
  const track = document.querySelector('svg.track');
  const toggle = document.querySelector('.track-toggle');
  if (!track || !toggle) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function setPlaying(playing) {
    if (playing) track.unpauseAnimations();
    else track.pauseAnimations();
    toggle.textContent = playing ? 'Pause animation' : 'Play animation';
    toggle.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + ' the track animation');
  }
  function preference() {
    track.setCurrentTime(0);
    setPlaying(!motion.matches);
  }
  preference();
  toggle.hidden = false;
  toggle.addEventListener('click', () => setPlaying(track.animationsPaused()));
  motion.addEventListener('change', preference);
})();
