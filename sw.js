/* Calibrated Golf local app-shell cache
 * Purpose: make Home Screen/browser launches use a persistent local copy first,
 * while quietly refreshing that copy from Netlify/GitHub in the background.
 *
 * IMPORTANT:
 * - Never force-reloads an active round.
 * - New HTML is cached in the background and used on the NEXT launch/navigation.
 * - Same-origin static assets are cached too.
 * - API/auth/function traffic is deliberately excluded.
 */

'use strict';

const CACHE_PREFIX = 'calibrated-golf-shell-';
const CACHE_NAME = 'calibrated-golf-shell-v1';

self.addEventListener('install', event => {
  /* Activate immediately. No fragile install-time precache that could fail
     because of Index.html/index.html/path differences on a deployment. */
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function bypassPath(url) {
  const p = url.pathname;
  return (
    p.startsWith('/.netlify/functions/') ||
    p.startsWith('/api/') ||
    p.includes('/auth/') ||
    p.includes('/oauth/')
  );
}

function cacheableResponse(response) {
  return !!(
    response &&
    response.ok &&
    response.status === 200 &&
    (response.type === 'basic' || response.type === 'default')
  );
}

async function putSafe(cache, request, response) {
  if (!cacheableResponse(response)) return;
  try {
    await cache.put(request, response.clone());
  } catch (_) {}
}

/* Fast launch strategy:
 * 1. Return local cached copy immediately when available.
 * 2. Fetch newest copy in parallel.
 * 3. Replace cache silently for next launch.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: false });

  const updatePromise = fetch(request).then(async response => {
    await putSafe(cache, request, response);
    return response;
  }).catch(() => null);

  if (event) event.waitUntil(updatePromise.then(() => undefined));

  if (cached) return cached;

  const fresh = await updatePromise;
  if (fresh) return fresh;

  /* Last-resort offline fallback: use any cached navigation document
     from this app scope rather than a blank browser error page. */
  if (request.mode === 'navigate') {
    const keys = await cache.keys();
    for (const key of keys) {
      if (key.mode === 'navigate' || key.destination === 'document') {
        const fallback = await cache.match(key);
        if (fallback) return fallback;
      }
    }
  }

  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibrated Golf</title><body style="font-family:Arial,sans-serif;text-align:center;padding:40px">Calibrated Golf is offline and no local app copy is available yet. Open it once while online, then try again.</body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function isStaticAsset(request) {
  const d = request.destination;
  return (
    d === 'document' ||
    d === 'style' ||
    d === 'script' ||
    d === 'image' ||
    d === 'font' ||
    d === 'manifest' ||
    d === 'worker'
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }

  if (!sameOrigin(url) || bypassPath(url)) return;

  /* Navigation is the critical 7.5 MB app-shell path. */
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  /* Cache only static same-origin resources; leave dynamic requests alone. */
  if (isStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'CACHE_CURRENT_PAGE' && data.url) {
    event.waitUntil((async () => {
      let url;
      try { url = new URL(data.url, self.location.origin); } catch (_) { return; }
      if (!sameOrigin(url) || bypassPath(url)) return;

      url.hash = '';
      const request = new Request(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store'
      });

      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        await putSafe(cache, request, response);
      } catch (_) {}
    })());
  }

  if (data.type === 'CLEAR_CALIBRATED_CACHE') {
    event.waitUntil(caches.delete(CACHE_NAME));
  }
});
