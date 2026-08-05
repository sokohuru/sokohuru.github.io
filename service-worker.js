/* Soko Huru — Service Worker
   Strategy:
   - App shell (HTML/CSS/JS/icons): cache-first, versioned, refreshed on deploy
   - Product/API/dynamic data: network-first, falls back to cache when offline
   - Images: stale-while-revalidate
   - Navigation requests offline: serve cached page, else /offline.html
   Bump CACHE_VERSION on every deploy that changes cached files. */

const CACHE_VERSION = "sokohuru-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Core files needed for the app to load offline.
// Adjust paths to match your actual build output (e.g. add /styles.css, /app.js if separate).
const APP_SHELL = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isImageRequest(request) {
  return request.destination === "image";
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

// Treat Firebase/Firestore/remote data calls as "data" — network-first.
function isDataRequest(url) {
  return (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebasestorage.googleapis.com") ||
    url.pathname.startsWith("/api/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept writes (orders, reviews, etc.)

  const url = new URL(request.url);

  // 1. Navigations — network first, cached shell fallback, then offline page.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(
          () =>
            caches.match("/index.html").then((cached) => cached || caches.match("/offline.html"))
        )
    );
    return;
  }

  // 2. Live data (Firebase/API) — network first, cache as fallback only.
  if (isDataRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 3. Images — stale-while-revalidate.
  if (isImageRequest(request)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((response) => {
              cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // 4. Everything else (CSS/JS/fonts/app shell) — cache first, network fallback.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
    )
  );
});

// Optional: allow the page to trigger skipWaiting after showing an "update available" prompt.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
