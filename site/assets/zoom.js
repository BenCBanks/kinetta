// Tap a screenshot to see it full size (2026-10-13, Ben: on a phone the shots were too small to read). The others in the
// same section come along: swipe sideways (or the arrows / arrow keys) to move between them. Tap anywhere outside the
// arrows (the picture or the dark space around it), press Escape or × to go back to where you were (2026-10-16, Ben).
(() => {
  'use strict';
  const selector = '.frame img, .phone img';
  const frames = (sec) => [...sec.querySelectorAll(selector)];
  let dlg, strip, count, trigger;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  for (const img of frames(document)) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', 'Enlarge screenshot: ' + img.alt);
  }

  for (const row of document.querySelectorAll('.shots, .pcards, .spot .pair, .points > .wrap')) {
    const slides = [...row.children].filter(el => el.matches('.frame') || el.querySelector('.frame'));
    if (slides.length < 2) continue;
    const gallery = document.createElement('div'); gallery.className = 'gallery';
    row.before(gallery); gallery.append(row);
    const controls = document.createElement('div'); controls.className = 'gallery-position';
    controls.innerHTML = '<button type="button" aria-label="Previous screenshot">‹</button><span aria-live="polite"></span><button type="button" aria-label="Next screenshot">›</button>';
    gallery.append(controls);
    const [prev, next] = controls.querySelectorAll('button'), label = controls.querySelector('span');
    const current = () => slides.reduce((best, slide, i) => Math.abs(slide.getBoundingClientRect().left-row.getBoundingClientRect().left-20) < Math.abs(slides[best].getBoundingClientRect().left-row.getBoundingClientRect().left-20) ? i : best, 0);
    const update = () => { controls.hidden = row.scrollWidth <= row.clientWidth+1; const i = current(); label.textContent = `${i+1} of ${slides.length}`; prev.disabled = i === 0; next.disabled = i === slides.length-1; };
    const move = delta => { const i = Math.max(0, Math.min(slides.length-1, current()+delta)); row.scrollTo({left:slides[i].offsetLeft-slides[0].offsetLeft, behavior:reducedMotion.matches?'instant':'smooth'}); };
    prev.onclick = () => move(-1); next.onclick = () => move(1);
    row.addEventListener('scroll', update, {passive:true}); new ResizeObserver(update).observe(row); update();
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
    strip.addEventListener('click', () => dlg.close());   // the picture or the space around it; a swipe doesn't click
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
      const full = new URL(x.currentSrc || x.src);
      full.pathname = full.pathname.replace(/-1x\.webp$/, '.webp');
      big.src = full.href; // Enlarge the matching theme at full capture resolution.
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
    const img = e.target.closest(selector);
    if (img && !img.closest('.zoom')) { e.preventDefault(); open(img); }
  });
  document.addEventListener('keydown', (e) => {
    const img = e.target.closest(selector);
    if (img && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); open(img);
    }
  });
})();
