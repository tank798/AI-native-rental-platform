const CACHE_NAME = "qihe-prototype-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/styles-v2.css",
  "./src/app.mjs",
  "./src/demand-parser.mjs",
  "./src/fixtures.mjs",
  "./src/simulation-engine.mjs",
  "./assets/app-icon.svg",
  "./assets/room-sunlit-v2.jpg",
  "./assets/room-lanehouse-v2.jpg",
  "./assets/room-compact-v2.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
