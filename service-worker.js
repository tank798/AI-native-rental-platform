const CACHE_NAME = "zhunaer-app-shell-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.css",
  "./src/app.mjs",
  "./src/bear-agent.mjs",
  "./src/task-lifecycle.mjs",
  "./src/demand-parser.mjs",
  "./src/supply-parser.mjs",
  "./src/marketplace-corpus.mjs",
  "./src/fixtures.mjs",
  "./src/simulation-engine.mjs",
  "./src/api-client.mjs",
  "./src/ui/safe-markup.mjs",
  "./assets/app-icon.svg",
  "./assets/bear-agent.svg",
  "./assets/bear-agent-anchor.png",
  "./assets/user-avatar.png",
  "./assets/room-sunlit.jpg",
  "./assets/room-lanehouse.jpg",
  "./assets/room-compact.jpg"
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
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
