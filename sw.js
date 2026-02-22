// ArticleVoice Service Worker — cache-first for app shell, network-only for proxy.

const CACHE_NAME = 'article-voice-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/lib/extractor.js',
  '/lib/tts-engine.js',
  '/lib/lang-detect.js',
  '/lib/url-utils.js',
  '/vendor/Readability.js',
  '/manifest.json',
];

// ── Install: pre-cache app shell ────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ──────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for CORS proxy requests (don't cache articles)
  if (url.hostname.includes('workers.dev')) {
    return; // Let the browser handle it normally
  }

  // Network-only for non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Cache-first for app shell assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful GET responses for app assets
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
