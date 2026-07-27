// Bump this on any change to the caching strategy to force old caches to purge.
const CACHE_NAME = "kadenz-v3";
const OFFLINE_ASSETS = ["/manifest.webmanifest"];
// The cache name is stable across deploys, so hashed chunks from old builds
// would accumulate forever. Cap it and evict the oldest (cache.keys() returns
// in insertion order) whenever it grows past the limit.
const MAX_CACHE_ENTRIES = 250;

async function trimCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  // Delete the oldest overflow entries.
  const overflow = keys.length - MAX_CACHE_ENTRIES;
  await Promise.all(keys.slice(0, overflow).map((k) => cache.delete(k)));
}

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
      .then(() => trimCache())
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
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(req, clone).then(trimCache)
            );
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
              caches.open(CACHE_NAME).then((cache) =>
                cache.put(req, clone).then(trimCache)
              );
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

// ── Push notifications (workout reminders) ──────────────────────────────────
// The payload is plain JSON sent by lib/reminders/push.ts. This handler only
// runs at all on platforms that deliver web push to an installed PWA — see
// the reminders settings page copy for which those are.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — fall back to defaults below */
  }
  const title = data.title || "Kadenz";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "kadenz-reminder",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an existing tab if one's open, otherwise
// opens a new one at the reminder's target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
