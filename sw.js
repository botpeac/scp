/* Shwe Calculator Pro - Service Worker
   Cache-first for app shell, network-first for live data (gold price), stale-while-revalidate for CDN libs.
   Note: PWA requires HTTPS (or localhost). */

const CACHE_VERSION = "v1.0.0";
const APP_SHELL_CACHE = `shwe-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `shwe-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./shwe_calculator_modern_ui_pwa.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helpers
async function cacheFirst(req) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  // Only cache successful basic responses
  if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    // Cache opaque too (e.g., CDN) so it works offline after first visit
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;

    // For navigation requests, fall back to cached app shell
    if (req.mode === "navigate") {
      const shell = await caches.open(APP_SHELL_CACHE);
      const fallback = await shell.match("./shwe_calculator_modern_ui_pwa.html", { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw e;
  }
}

// Fetch routing
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== "GET") return;

  // Same-origin HTML / app assets => cache-first
  if (url.origin === self.location.origin) {
    const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
    const isAsset =
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".json") ||
      url.pathname.endsWith(".ico") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".webp");

    if (isHTML || isAsset) {
      event.respondWith(cacheFirst(req));
      return;
    }
  }

  // Gold price / API-like fetches => network-first (prefer latest)
  // (Adjust these matchers if you change your gold data endpoint)
  if (/goldprice\.org/i.test(url.hostname) || /gold/i.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // CDN libs => stale-while-revalidate
  if (/cdnjs\.cloudflare\.com/i.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});
