/* =========================================================
   TortaLista · Service Worker
   - App shell: precache + cache-first (network-first para HTML)
   - CDN (Supabase SDK, fuentes): stale-while-revalidate
   - API de Supabase: nunca se cachea (datos siempre frescos)
   Subí la versión cada vez que cambies archivos.
   ========================================================= */
const VERSION = 'tortalista-v3';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Error en precache:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PATCH/DELETE van directo a la red

  const url = new URL(req.url);

  // Supabase (REST, Auth, Realtime): siempre red
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  // Navegación (HTML): red primero, caché como respaldo offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put('./index.html', copia));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // CDN: stale-while-revalidate
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const enCache = await cache.match(req);
        const deRed = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => enCache);
        return enCache || deRed;
      })
    );
    return;
  }

  // Archivos propios: caché primero
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (enCache) =>
          enCache ||
          fetch(req)
            .then((res) => {
              if (res.ok) {
                const copia = res.clone();
                caches.open(RUNTIME_CACHE).then((c) => c.put(req, copia));
              }
              return res;
            })
            .catch(() => new Response('Sin conexión', { status: 503, statusText: 'Offline' }))
      )
    );
  }
});
