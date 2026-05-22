// Door check-in service worker. Registered with broad scope (/) so it can
// front both /admin/checkin/* and /door/* — the public/_headers stanza
// serves this file with `Service-Worker-Allowed: /`.
//
// Strategy is deliberately tiny:
//   • Precache the shared shell on install (styles + checkin.js + sw.js).
//   • GET requests under /admin/api/checkin/ or /api/door/ are network-first
//     with stale-cache fallback so the offline client still gets a roster.
//   • Every other request passes straight through to fetch — no surprises
//     for the rest of the site.
//
// Every handler is wrapped so any unexpected failure falls back to a plain
// network fetch. The blast radius if this script is buggy is small.

const VERSION = 'checkin-v1';
const STATIC_CACHE = `door-static-${VERSION}`;
const ROSTER_CACHE = `door-roster-${VERSION}`;
const SHELL = [
  '/styles.css',
  '/checkin/checkin.css',
  '/checkin/checkin.js',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const c = await caches.open(STATIC_CACHE);
      await c.addAll(SHELL);
    } catch (err) {
      // Best-effort precache; offline can still work with whatever lands later.
      console.warn('[door-sw] precache failed', err);
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('door-') && k !== STATIC_CACHE && k !== ROSTER_CACHE)
            .map(k => caches.delete(k)),
      );
    } catch (err) {
      console.warn('[door-sw] activate cleanup failed', err);
    }
    await self.clients.claim();
  })());
});

function isRosterRequest(url) {
  return url.pathname.startsWith('/admin/api/checkin/')
      || url.pathname.startsWith('/api/door/');
}

function isShellRequest(url) {
  return SHELL.includes(url.pathname);
}

self.addEventListener('fetch', (event) => {
  try {
    const req = event.request;
    if (req.method !== 'GET') return; // mutations pass through untouched
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (isRosterRequest(url)) {
      event.respondWith(networkFirst(req, ROSTER_CACHE));
      return;
    }
    if (isShellRequest(url)) {
      event.respondWith(cacheFirst(req, STATIC_CACHE));
      return;
    }
    // Everything else: do nothing, browser handles normally.
  } catch (err) {
    console.warn('[door-sw] fetch handler error, falling through', err);
  }
});

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ ok: false, message: 'Offline and nothing cached.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}
