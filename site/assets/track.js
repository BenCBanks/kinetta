// Start on the visible side of the phone; allow explicit play even with reduced motion.
(() => {
  const track = document.querySelector('svg.track');
  const toggle = document.querySelector('.track-toggle');
  if (!track || !toggle) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function setPlaying(playing) {
    if (playing) track.unpauseAnimations();
    else track.pauseAnimations();
    toggle.innerHTML = playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
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
