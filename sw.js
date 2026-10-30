/* Qi TCM — offline support.

   Bump VERSION on every release. It clears the previous cache and keeps the
   worker in step with the app.

   Strategy: network first, so a freshly uploaded version is picked up on the
   next launch, with the cached copy served whenever there's no signal.
   version.json is deliberately never cached — it's how the running app finds
   out that a newer build has been published. */

const VERSION = "2.0";
const CACHE = "qi-tcm-v" + VERSION;
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.webmanifest",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./js/app.js",
  "./js/util.js",
  "./js/state.js",
  "./js/store.js",
  "./js/money.js",
  "./js/backup.js",
  "./js/sheet.js",
  "./js/billing.js",
  "./js/records.js",
  "./js/patients.js",
  "./js/linkbills.js",
  "./js/settings.js",
  "./js/packages.js",
  "./js/qr.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // The version check must always hit the network, never the cache.
  if (new URL(e.request.url).pathname.endsWith("/version.json")) {
    e.respondWith(fetch(e.request).catch(() => new Response("{}", {
      headers: { "Content-Type": "application/json" }
    })));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
