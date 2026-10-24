/* Simuverse service worker (built by serviceWorkerPlugin.ts; the placeholders below are filled in at build time).
 *
 * - The app shell (index.html and the hashed JS/CSS) and the core catalogues are precached on install,
 *   so the app starts and the sky, solar system, galaxies and Explore work offline.
 * - Everything else under data/ and textures/ (ephemeris chunks, images, planet textures, the Milky Way)
 *   is cached as it is used, stale-while-revalidate, up to RUNTIME_MAX_ENTRIES.
 * - Gaia star tiles are not cached here: the app keeps them in IndexedDB (see packages/data/src/cache.ts).
 * - A new version waits until the page asks it to take over, so a running page never loses its chunks.
 */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = `simuverse-shell-${VERSION}`;
const RUNTIME_CACHE = 'simuverse-runtime-v1';
const RUNTIME_MAX_ENTRIES = 400;
const scope = new URL(self.registration.scope);
// Static servers often send `Vary: Origin`, which would stop module-script requests matching the precache.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, scope)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('simuverse-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 'index.html'));
  } else if (path.startsWith('assets/') || PRECACHE.includes(path)) {
    // Hashed, or part of this version: a new deployment brings a new worker and cache.
    event.respondWith(cacheFirst(req));
  } else if (path.startsWith('data/stars/t/')) {
    // IndexedDB has these.
  } else if (path.startsWith('data/') || path.startsWith('textures/')) {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function networkFirst(req, fallbackPath) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL_CACHE)).put(new URL(fallbackPath, scope), res.clone());
    return res;
  } catch {
    return (await caches.match(new URL(fallbackPath, scope), MATCH)) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(RUNTIME_CACHE)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, event) {
  const hit = await caches.match(req, { ...MATCH, ignoreSearch: true });
  const update = fetch(req).then(async (res) => {
    if (res.ok && res.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(req, res.clone());
      await trim(cache);
    }
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => undefined));
    return hit;
  }
  return update;
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    // Cache keys come back in insertion order, and a refreshed entry is re-inserted: the oldest go first.
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - RUNTIME_MAX_ENTRIES; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}
