<<<<<<< HEAD
const CACHE = "voicemate-v3";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/icon.svg", "/data/phrasebook.json"];
=======
const CACHE = "voicemate-v2";
const ASSETS = [
  "/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/icon.svg",
  "/data/phrasebook.json", "/docs/", "/docs/index.html"
];
>>>>>>> 86a23ef (documentation added)

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(ASSETS.map(url => cache.add(new Request(url, { cache: "reload" })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) return;
<<<<<<< HEAD
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match("/index.html"))));
});
=======
  const url = new URL(event.request.url);
  const key = url.pathname === "/docs" ? new Request("/docs/") : event.request;
  event.respondWith(
    caches.match(key).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(key, copy));
      return response;
    }).catch(() => caches.match(key).then(fallback => fallback || caches.match("/index.html"))))
  );
});
>>>>>>> 86a23ef (documentation added)
