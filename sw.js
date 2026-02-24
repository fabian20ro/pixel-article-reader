// Article Local Reader Service Worker.
//
// Cache policy:
// - Navigations: network-first, cache fallback.
// - Same-origin static assets: stale-while-revalidate.
// - Proxy/API requests: network-only.
//
// Bump SW_VERSION on releases that change cache behavior or app-shell wiring.
const SW_VERSION = '2026.02.24.5';
const CACHE_NAME = `article-reader-${SW_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './vendor/Readability.js',
  './vendor/turndown.js',
  './vendor/marked.js',
  './lib/article-controller.js',
  './lib/dom-refs.js',
  './lib/extractor.js',
  './lib/lang-detect.js',
  './lib/pwa-update-manager.js',
  './lib/release.js',
  './lib/settings-store.js',
  './lib/translator.js',
  './lib/media-session.js',
  './lib/tts-audio-fetcher.js',
  './lib/tts-engine.js',
  './lib/url-utils.js',
  './lib/queue-store.js',
  './lib/queue-controller.js',
];

const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (isProxyRequest(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isSameOriginStaticAsset(request, url)) {
    event.respondWith(handleStaticAssetRequest(request, event));
    return;
  }
});

function isProxyRequest(url) {
  return url.hostname.includes('workers.dev');
}

function isSameOriginStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === 'navigate') return false;

  return (
    STATIC_DESTINATIONS.has(request.destination)
    || /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|json)$/i.test(url.pathname)
  );
}

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      cache.put('./index.html', fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;

    throw new Error('Offline and no cached app shell available.');
  }
}

async function handleStaticAssetRequest(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(networkPromise.then(() => undefined));
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  return Response.error();
}
