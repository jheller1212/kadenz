// Bump this on any change to the caching strategy to force old caches to purge.
const CACHE_NAME = "kadenz-v3";
const OFFLINE_ASSETS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS))
  );
  // Take over immediately so a fixed SW can replace a broken one without waiting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only same-origin GETs are our concern.
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) {
    return;
  }

  // Network-FIRST for page navigations. The HTML shell references hashed
  // `_next/static` chunks; serving a stale shell points at chunk URLs that no
  // longer exist after a deploy, which white-screens the app. Always try the
  // network so the shell (and its chunk refs) stay current; fall back to cache
  // only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Hashed build assets and app icons are immutable (content-hashed URLs /
  // versioned with deploys), so cache-FIRST is safe and makes repeat loads
  // instant and the app shell work fully offline.
  const url = new URL(req.url);
  const isImmutableAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|svg|ico)$/.test(url.pathname);
  if (isImmutableAsset) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Everything else (API calls, cross-origin): network only — personal data
  // must never be served stale from a cache.
});
