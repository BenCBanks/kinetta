// Refresh the real screenshot set after a scheduled capture, including an already-open tab.
(() => {
  let version;
  async function refresh() {
    try {
      const url = new URL('assets/shots/manifest.json', document.baseURI);
      const response = await fetch(url, {cache: 'no-store'});
      if (!response.ok) return;
      const manifest = await response.json(), next = manifest.generated_at;
      if (!next || next === version) return;
      version = next;
      for (const el of document.querySelectorAll('img[src*="assets/shots/"], source[srcset*="assets/shots/"]')) {
        const attr = el.tagName === 'SOURCE' ? 'srcset' : 'src';
        const image = new URL(el.getAttribute(attr), document.baseURI);
        image.searchParams.set('capture', version); el.setAttribute(attr, image.href);
      }
    } catch (_) { /* keep the last usable pictures while offline */ }
  }
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
