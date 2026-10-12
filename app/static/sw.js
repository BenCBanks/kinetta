// Service worker (2026-10-10): keeps the app's own files on the phone so Kinetta opens without a connection.
// Pages: the saved copy first, refreshed in the background for next time (2026-10-12: the network adds about a second). /static files: saved copy first (their URLs carry ?v=, so a new
// version is a new URL), older versions of the same file are dropped. /api/ is never touched here: personal data
// goes to the network only (the app keeps its own small offline copy of a few screens).
const SHELL = 'fit-shell-1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.add('/').catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {   // the saved page at once (no wait on the network); a fresh copy is saved for next time
    const fresh = fetch(req).then((r) => { if (r.ok) { const c2 = r.clone(); caches.open(SHELL).then((c) => c.put('/', c2)); } return r; });
    e.respondWith(caches.match('/').then((hit) => hit || fresh).catch(() => fresh));
    e.waitUntil(fresh.catch(() => {}));
    return;
  }
  if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) {
        for (const old of await c.keys()) { const u = new URL(old.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(old); }
        c.put(req, r.clone());
      }
      return r;
    }));
  }
});

// Phone notifications (2026-10-11, notify.py): show what the server sent; a tap opens that page in Kinetta
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {body: e.data && e.data.text()}; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Kinetta', {body: d.body || '', tag: d.tag, data: {url: d.url || '/'},
      icon: '/static/icon-192.png', badge: '/static/icon-192.png'});
    if (d.badge && self.navigator && navigator.setAppBadge) navigator.setAppBadge(d.badge).catch(() => {});
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;          // only ever our own pages
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const w of wins) if (new URL(w.url).origin === url.origin) { await w.focus(); return w.navigate(url.href).catch(() => self.clients.openWindow(url.href)); }
    return self.clients.openWindow(url.href);
  })());
});
