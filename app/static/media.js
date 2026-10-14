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
function wireMediaMapFull(box, mapObject, line, still) {
  const btn = $('.map-full', box), spot = document.createComment('map');
  const refit = () => { const m = mapObject(); if (m) { m.map.invalidateSize({pan: false}); m.map.fitBounds(m.L.latLngBounds(decode(line)), {padding: [24, 24], animate: false}); } };
  const close = () => {
    if (!box.classList.contains('full')) return;
    viewResources.delete(spot);
    removeEventListener('keydown', key); removeEventListener('popstate', close);
    box.classList.remove('full'); document.body.classList.remove('map-open');
    const m = mapObject(); if (m && still) { m.map.dragging.disable(); m.map.touchZoom.disable(); }
    if (spot.parentNode) spot.replaceWith(box); else { box.remove(); return; }
    btn.innerHTML = svg('expand'); btn.setAttribute('aria-label', 'Full-screen map');
    if (box.isConnected) { refit(); btn.focus(); }
  };
  const key = (e) => { if (e.key === 'Escape') close(); };
  btn.onclick = (e) => {
    e.stopPropagation(); if (box.classList.contains('full')) { close(); return; }
    box.replaceWith(spot); document.body.append(box); box.classList.add('full'); document.body.classList.add('map-open');
    const m = mapObject(); if (m) { m.map.dragging.enable(); m.map.touchZoom.enable(); }
    btn.innerHTML = svg('close'); btn.setAttribute('aria-label', 'Close full-screen map'); refit();
    addEventListener('keydown', key); addEventListener('popstate', close, {once: true});
    viewResources.set(spot, () => { close(); removeEventListener('keydown', key); removeEventListener('popstate', close); });
  };
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
