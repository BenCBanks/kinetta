// Tap a screenshot to see it full size (2026-10-13, Ben: on a phone the shots were too small to read). The others in the
// same section come along: swipe sideways (or the arrows / arrow keys) to move between them, tap the picture or × to close.
(() => {
  'use strict';
  const frames = (sec) => [...sec.querySelectorAll('.frame img')];
  let dlg, strip, count, trigger;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  for (const img of frames(document)) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', 'Enlarge screenshot: ' + img.alt);
  }

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'zoom';
    dlg.setAttribute('aria-label', 'Screenshot, full size');
    dlg.innerHTML = '<div class="strip"></div><div class="bar"><span class="count" aria-live="polite"></span>'
      + '<button type="button" class="close" aria-label="Close">×</button></div>'
      + '<button type="button" class="nav prev" aria-label="Previous">‹</button><button type="button" class="nav next" aria-label="Next">›</button>';
    document.body.append(dlg);
    strip = dlg.querySelector('.strip'); count = dlg.querySelector('.count');
    dlg.querySelector('.close').onclick = () => dlg.close();
    dlg.querySelector('.prev').onclick = () => step(-1);
    dlg.querySelector('.next').onclick = () => step(1);
    strip.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') dlg.close(); });
    strip.addEventListener('scroll', () => show(at()), {passive: true});
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1);
      }
    });
    dlg.addEventListener('close', () => {
      document.documentElement.style.overflow = ''; strip.innerHTML = '';
      trigger?.focus({preventScroll: true});
    });
  }
  const at = () => Math.round(strip.scrollLeft / strip.clientWidth);
  const n = () => strip.children.length;
  function show(i) {
    count.textContent = `${i + 1} of ${n()}`;
    dlg.querySelector('.prev').disabled = i === 0;
    dlg.querySelector('.next').disabled = i === n() - 1;
  }
  function step(d) {
    const i = Math.max(0, Math.min(n() - 1, at() + d));
    strip.scrollTo({left: i * strip.clientWidth, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  }

  function open(img) {
    if (!dlg) build();
    trigger = img; trigger.focus({preventScroll: true});
    const sec = img.closest('section') || document.body, list = frames(sec), i = list.indexOf(img);
    strip.innerHTML = '';
    for (const x of list) {
      const slide = document.createElement('div'), big = document.createElement('img');
      slide.className = 'slide';
      big.loading = x === img ? 'eager' : 'lazy';
      big.src = x.currentSrc || x.src;     // the light or dark picture, whichever the page is showing
      big.alt = x.alt; big.width = 786; big.height = 1704;
      slide.append(big); strip.append(slide);
    }
    dlg.querySelector('.prev').hidden = dlg.querySelector('.next').hidden = list.length < 2;
    document.documentElement.style.overflow = 'hidden';
    dlg.showModal();
    strip.scrollLeft = i * strip.clientWidth;
    show(i);
  }

  document.addEventListener('click', (e) => {
    const img = e.target.closest('.frame img');
    if (img && !img.closest('.zoom')) { e.preventDefault(); open(img); }
  });
  document.addEventListener('keydown', (e) => {
    const img = e.target.closest('.frame img');
    if (img && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); open(img);
    }
  });
})();
