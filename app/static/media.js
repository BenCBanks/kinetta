// The route leads, followed by photos in one equally sized horizontal rail.
'use strict';
function activityMedia(a, {mapId = '', detail = false, full = false, openHref = ''} = {}) {
  const photos = a.photos || [], count = photos.length + (a.line ? 1 : 0);
  if (!count) return '';
  const map = a.line ? `<div class="media-item media-map"><div class="${detail ? 'map big lead' : 'fmap'}"${mapId ? ` id="${mapId}"` : ''} data-line="${esc(a.line)}" data-sport="${esc(a.sport)}" role="img" aria-label="Route map">
    ${detail ? '' : miniRoute(a.line, a.sport)}${full ? '<button class="map-full" id="d-full" aria-label="Full-screen map">' + svg('expand') + '</button>' : ''}</div></div>` : '';
  return `<div class="activity-media${detail ? ' detail-media' : ''}" data-media="${a.id}" data-media-photos="${esc(JSON.stringify(photos))}" data-media-mine="${!a.owner || a.owner.login === App.me.login}">
    <div class="media-track" tabindex="0" role="region" aria-label="Activity photos and route; swipe or use arrow buttons">${map}${photos.map((p, i) => `<button type="button" class="media-item media-photo" data-media-photo="${i}" aria-label="Open photo ${i + 1} of ${photos.length}">${pimg(photoSrc(p, true)).replace('alt=""', `alt="Activity photo ${i + 1}"`)}</button>`).join('')}</div>
    ${openHref ? `<a class="primary wide post-open" href="${esc(openHref)}">View activity ${svg('chev')}</a>` : ''}
    ${count > 1 ? `<div class="media-controls"><button type="button" class="icon-btn" data-media-step="-1" aria-label="Previous photo or map" disabled>${svg('back')}</button><span class="small muted num" data-media-position aria-live="polite">${a.line ? 'Map' : 'Photo 1'} · 1 of ${count}</span>${a.line && photos.length ? `<button class="linkbtn small" data-media-map>Map</button>` : ''}<button type="button" class="icon-btn" data-media-step="1" aria-label="Next photo or map">${svg('chev')}</button></div>` : ''}</div>`;
}
function wireMediaMapFull(box, mapObject, lines, still) {
  const btn = $('.map-full', box); if (!btn) return;
  const spot = document.createComment('map'), path = location.pathname + location.search;
  const token = 'map-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const routeLines = Array.isArray(lines) ? lines : [lines];
  let previousState, background = [], waitingBack = false, press = null, tap = false;
  const controls = 'button, a, input, select, .leaflet-control';
  const refit = () => {
    const m = mapObject(), points = routeLines.flatMap(line => typeof line === 'string' ? decode(line) : line);
    if (m) { m.map.invalidateSize({pan: false}); if (points.length) m.map.fitBounds(m.L.latLngBounds(points), {padding: [24, 24], animate: false}); }
  };
  const close = () => {
    if (!box.classList.contains('full')) return;
    waitingBack = false; viewResources.delete(spot);
    removeEventListener('keydown', key, true); if (App.mediaMapBack === back) delete App.mediaMapBack;
    box.classList.remove('full'); document.body.classList.remove('map-open');
    box.setAttribute('role', 'img'); box.setAttribute('aria-label', 'Route map'); box.removeAttribute('aria-modal');
    for (const [node, wasInert] of background) node.inert = wasInert; background = [];
    const m = mapObject(); if (m && still) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
    // Navigation/account changes must release the overlay without moving back to an old page.
    if (history.state?.kinettaMap === token) history.replaceState(previousState, '', location.href);
    if (!spot.isConnected) { box.remove(); return; }
    spot.replaceWith(box); btn.innerHTML = svg('expand'); btn.setAttribute('aria-label', 'Full-screen map');
    refit(); btn.focus({preventScroll: true});
  };
  const requestClose = () => {
    if (waitingBack) return;
    if (history.state?.kinettaMap === token && location.pathname + location.search === path) {
      waitingBack = true; history.back();
    } else close();
  };
  const back = () => { close(); return true; };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); requestClose(); }
    if (e.key === 'Tab') {
      const buttons = [...box.querySelectorAll('button, a[href], [tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length);
      if (!buttons.length) return;
      const i = buttons.indexOf(document.activeElement), next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
      e.preventDefault(); buttons[next].focus();
    }
  };
  const open = () => {
    if (box.classList.contains('full') || !box.isConnected) return;
    previousState = history.state; history.pushState({...previousState, kinettaMap: token}, '', location.href);
    box.replaceWith(spot); document.body.append(box); box.classList.add('full'); document.body.classList.add('map-open');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Activity route map'); box.setAttribute('aria-modal', 'true');
    background = [...document.body.children].filter(n => n !== box).map(n => [n, n.inert]);
    for (const [node] of background) node.inert = true;
    const m = mapObject(); if (m) { m.map.dragging.enable(); m.map.touchZoom.enable(); }
    btn.innerHTML = svg('close'); btn.setAttribute('aria-label', 'Close full-screen map'); refit(); btn.focus({preventScroll: true});
    addEventListener('keydown', key, true); App.mediaMapBack = back;
    viewResources.set(spot, close);
  };
  btn.onclick = e => { e.stopPropagation(); box.classList.contains('full') ? requestClose() : open(); };
  // A deliberate tap opens the map. Dragging, a photo-rail swipe, a pinch and map controls keep their jobs.
  box.addEventListener('pointerdown', e => {
    tap = false; press = null;
    if (!box.classList.contains('full') && e.isPrimary && e.button === 0 && !e.target.closest(controls))
      press = {id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now(), track: box.closest('.media-track'), scroll: box.closest('.media-track')?.scrollLeft};
  }, {passive: true});
  box.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press = null; }, {passive: true});
  box.addEventListener('pointercancel', () => { press = null; tap = false; }, {passive: true});
  box.addEventListener('pointerup', e => {
    tap = !!(press && press.id === e.pointerId && Date.now() - press.at < 600 && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 8 && (!press.track || press.track.scrollLeft === press.scroll));
    press = null;
  }, {passive: true});
  box.addEventListener('click', e => { if (tap && !box.classList.contains('full') && !e.target.closest(controls)) { e.stopPropagation(); tap = false; open(); } });
}

function wireActivityMedia(root) {
  $$('.activity-media:not([data-media-on])', root).forEach((box) => {
    box.dataset.mediaOn = '1';
    const track = $('.media-track', box), items = $$('.media-item', track);
    if (!box.classList.contains('detail-media')) {
      const map = $('.media-map', box);
      if (map) map.onclick = () => go(`${box.dataset.mediaMine === 'true' ? '/activity/' : '/activity/friends/'}${box.dataset.media}`);
    }
    const photos = JSON.parse(box.dataset.mediaPhotos), a = {id: +box.dataset.media, photos};
    let index = 0;
    const update = (fromScroll = true) => {
      if (!track.clientWidth) return;
      if (fromScroll) index = Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
      const label = $('[data-media-position]', box);
      if (label) label.textContent = `${items[index].classList.contains('media-map') ? 'Map' : `Photo ${+items[index].dataset.mediaPhoto + 1}`} · ${index + 1} of ${items.length}`;
      const prev = $('[data-media-step="-1"]', box), next = $('[data-media-step="1"]', box);
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === items.length - 1;
    };
    const show = (i) => {
      index = Math.max(0, Math.min(items.length - 1, i));
      track.scrollTo({left: index * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      update(false);
    };
    track.addEventListener('scroll', () => update(), {passive: true});
    track.addEventListener('keydown', (e) => {
      if (e.target !== track || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); show(e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : index + (e.key === 'ArrowRight' ? 1 : -1));
    });
    $$('[data-media-step]', box).forEach((button) => button.onclick = () => show(index + +button.dataset.mediaStep));
    const map = $('[data-media-map]', box); if (map) map.onclick = () => show(0);
    $$('[data-media-photo]', box).forEach((button) => button.onclick = () => photoViewer(a, +button.dataset.mediaPhoto, box.dataset.mediaMine === 'true', () => render()));
    const resize = new ResizeObserver(() => { track.scrollLeft = index * track.clientWidth; update(); });
    resize.observe(track); viewResources.set(track, () => resize.disconnect());
    update();
  });
}
